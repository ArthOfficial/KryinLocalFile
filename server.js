/**
 * Local File Hub - Storage & Sharing Server
 * =========================================================================
 * Author: Arth Purohit (https://arth-hub.vercel.app/)
 * GitHub: https://github.com/ArthOfficial
 * Copyright (c) Arth Purohit. All rights reserved.
 * 
 * Fast peer-to-peer LAN storage, chunked streaming file upload, real Wi-Fi IP
 * resolution, Windows autostart background execution, and zero-console browser launcher.
 * =========================================================================
 */

const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const os = require('os');
const cors = require('cors');
const { exec, execSync, spawn } = require('child_process');

// App & Core Path Resolutions (Compatible with both Node.js and standalone .exe builds)
const app = express();
const ROOT_DIR = process.cwd();
const CLOUD_DIR = path.join(ROOT_DIR, 'cloud');
const TEMP_DIR = path.join(CLOUD_DIR, '.tmp');

// Locate static public directory
let PUBLIC_DIR = path.join(__dirname, 'public');
if (!fs.existsSync(PUBLIC_DIR)) {
    PUBLIC_DIR = path.join(ROOT_DIR, 'public');
}

// Ensure cloud directories exist
if (!fs.existsSync(CLOUD_DIR)) {
    fs.mkdirSync(CLOUD_DIR, { recursive: true });
}
if (!fs.existsSync(TEMP_DIR)) {
    fs.mkdirSync(TEMP_DIR, { recursive: true });
}

// Load configuration
let config = {
    port: 20260,
    adminPassword: 'kryinadmin',
    hostActionPassword: '2026',
    allowRemoteDeleteWithPassword: true,
    autoOpenBrowser: true
};
const configPath = path.join(ROOT_DIR, 'config.json');
if (fs.existsSync(configPath)) {
    try {
        config = { ...config, ...JSON.parse(fs.readFileSync(configPath, 'utf8')) };
    } catch (e) {
        console.warn('Notice: Could not parse config.json, using default configuration.');
    }
}

let PORT = process.env.PORT || config.port || 20260;
let ADMIN_PASSWORD = config.adminPassword || 'kryinadmin';
let HOST_ACTION_PASSWORD = config.hostActionPassword || '2026';

// App Tokens & Author Info
const AUTHOR_SIGNATURE = 'ARTH_PUROHIT_VERIFIED_AUTH';
const AUTHOR_INFO = {
    author: 'Arth Purohit',
    portfolio: 'https://arth-hub.vercel.app/',
    github: 'https://github.com/ArthOfficial',
    app: 'Local File Hub'
};

let embeddedAssets = null;
try {
    embeddedAssets = require('./embeddedAssets');
} catch (e) {
    embeddedAssets = null;
}

app.use(cors());
app.use(express.json());

// Deliver critical UI assets (serves disk file or falls back to compiled embedded assets)
app.get('/style.css', (req, res) => {
    const diskPath = path.join(PUBLIC_DIR, 'style.css');
    if (fs.existsSync(diskPath)) {
        return res.sendFile(diskPath);
    }
    if (embeddedAssets && embeddedAssets.styleCss) {
        res.setHeader('Content-Type', 'text/css; charset=utf-8');
        return res.send(embeddedAssets.styleCss);
    }
    res.status(404).send('Not found');
});

app.get('/app.js', (req, res) => {
    const diskPath = path.join(PUBLIC_DIR, 'app.js');
    if (fs.existsSync(diskPath)) {
        return res.sendFile(diskPath);
    }
    if (embeddedAssets && embeddedAssets.appJs) {
        res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
        return res.send(embeddedAssets.appJs);
    }
    res.status(404).send('Not found');
});

app.get('/', (req, res) => {
    const diskPath = path.join(PUBLIC_DIR, 'index.html');
    if (fs.existsSync(diskPath)) {
        return res.sendFile(diskPath);
    }
    if (embeddedAssets && embeddedAssets.indexHtml) {
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        return res.send(embeddedAssets.indexHtml);
    }
    res.status(404).send('Not found');
});

// Helper: Resolve Real LAN IP (ignores VirtualBox, WSL, Hyper-V, Docker, and loopbacks)
let _cachedLanIp = null;
let _cachedLanIpTime = 0;

function getRealLanIp() {
    const now = Date.now();
    if (_cachedLanIp && (now - _cachedLanIpTime < 15000)) {
        return _cachedLanIp;
    }

    const ifaces = os.networkInterfaces();
    const candidates = [];

    for (const [name, addrs] of Object.entries(ifaces)) {
        const lower = name.toLowerCase();
        // Skip virtual / container / bridge / tunnel adapters
        if (
            lower.includes('wsl') ||
            lower.includes('vethernet') ||
            lower.includes('virtual') ||
            lower.includes('vbox') ||
            lower.includes('vmware') ||
            lower.includes('loopback') ||
            lower.includes('pseudo') ||
            lower.includes('docker') ||
            lower.includes('tap') ||
            lower.includes('vpn') ||
            lower.includes('host-only')
        ) {
            continue;
        }

        for (const a of addrs) {
            if (a.family === 'IPv4' && !a.internal) {
                // Skip VirtualBox host-only default network 192.168.56.x and APIPA
                if (a.address.startsWith('192.168.56.') || a.address.startsWith('169.254.')) {
                    continue;
                }
                candidates.push({
                    name,
                    address: a.address,
                    isWifi: lower.includes('wi-fi') || lower.includes('wlan') || lower.includes('wireless')
                });
            }
        }
    }

    // Prioritize active Wi-Fi / physical Ethernet over other adapters
    candidates.sort((a, b) => (b.isWifi ? 1 : 0) - (a.isWifi ? 1 : 0));
    _cachedLanIp = candidates[0] ? candidates[0].address : '127.0.0.1';
    _cachedLanIpTime = now;
    return _cachedLanIp;
}

// Helper: Detect if incoming request originates from the local host computer
function isHostRequest(req) {
    const remoteAddr = req.socket.remoteAddress || req.connection?.remoteAddress || '';
    const cleanIp = remoteAddr.replace('::ffff:', '').trim();
    const realLanIp = getRealLanIp();

    return (
        cleanIp === '127.0.0.1' ||
        cleanIp === '::1' ||
        cleanIp === 'localhost' ||
        cleanIp === realLanIp
    );
}

// Middleware: Integrity check on mutative API requests
function verifySystemIntegrity(req, res, next) {
    const sig = req.headers['x-arth-signature'];
    if (sig && sig !== AUTHOR_SIGNATURE) {
        return res.status(423).json({
            error: 'System signature mismatch.',
            author: AUTHOR_INFO.author,
            portfolio: AUTHOR_INFO.portfolio,
            github: AUTHOR_INFO.github
        });
    }
    next();
}

// Windows Autostart Registry Configuration
const REG_KEY = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run';
const REG_VAL = 'KryinLocalFile';

function getExePath() {
    const targetExe = path.join(ROOT_DIR, 'KryinLocalFile.exe');
    if (fs.existsSync(targetExe)) {
        return targetExe;
    }
    const legacyExe = path.join(ROOT_DIR, 'FileManagerLocal.exe');
    if (fs.existsSync(legacyExe)) {
        return legacyExe;
    }
    return process.execPath;
}

function checkAutostart(callback) {
    if (process.platform !== 'win32') {
        return callback(null, false);
    }
    exec(`reg query "${REG_KEY}" /v "${REG_VAL}"`, (err, stdout) => {
        if (err || !stdout) {
            return callback(null, false);
        }
        return callback(null, stdout.includes(REG_VAL));
    });
}

function setAutostart(enable, callback) {
    if (process.platform !== 'win32') {
        return callback(new Error('Autostart is only supported on Windows'));
    }
    if (enable) {
        const exePath = getExePath();
        const cmd = `reg add "${REG_KEY}" /v "${REG_VAL}" /t REG_SZ /d "\\"${exePath}\\" --background" /f`;
        exec(cmd, (err) => {
            if (err) return callback(err);
            callback(null, true);
        });
    } else {
        const cmd = `reg delete "${REG_KEY}" /v "${REG_VAL}" /f`;
        exec(cmd, () => {
            callback(null, false);
        });
    }
}

// Multer storage for single-request uploads
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, CLOUD_DIR);
    },
    filename: (req, file, cb) => {
        const safeName = path.basename(file.originalname);
        cb(null, safeName);
    }
});

const upload = multer({
    storage: storage,
    limits: { fileSize: 10 * 1024 * 1024 * 1024 } // 10 GB limit
});

// ============================================
//  CORE API ENDPOINTS
// ============================================

// API: System status, Real LAN IP, and Host / Client detection
app.get('/api/status', (req, res) => {
    const isHost = isHostRequest(req);
    const realLanIp = getRealLanIp();
    res.json({
        isHost: isHost,
        serverIp: realLanIp,
        lanUrl: `http://${realLanIp}:${PORT}`,
        port: PORT,
        configuredPort: config.port,
        fallbackFromPort: portFallbackOccurred ? originalRequestedPort : null,
        author: AUTHOR_INFO.author,
        portfolio: AUTHOR_INFO.portfolio,
        github: AUTHOR_INFO.github,
        app: AUTHOR_INFO.app,
        allowRemoteDelete: config.allowRemoteDeleteWithPassword
    });
});

// API: Check Windows Autostart Status
app.get('/api/autostart', (req, res) => {
    checkAutostart((err, enabled) => {
        res.json({
            supported: process.platform === 'win32',
            enabled: !!enabled,
            isHost: isHostRequest(req)
        });
    });
});

// API: Toggle Windows Autostart (Host Only with Password Protection)
app.post('/api/autostart', (req, res) => {
    if (!isHostRequest(req)) {
        return res.status(403).json({ error: 'Permission Denied: Only the host computer can configure autostart.' });
    }
    const { enabled, password } = req.body || {};
    if (password !== HOST_ACTION_PASSWORD) {
        return res.status(401).json({ error: 'Access Denied: Wrong attempt. Unauthorized attempt recorded.' });
    }
    setAutostart(!!enabled, (err, newState) => {
        if (err) {
            return res.status(500).json({ error: 'Failed to update Windows registry', details: err.message });
        }
        res.json({ success: true, enabled: newState });
    });
});

// API: Gracefully Shut Down Server (Host Only with Password Protection)
app.post('/api/system/shutdown', (req, res) => {
    if (!isHostRequest(req)) {
        return res.status(403).json({ error: 'Permission Denied: Only the host computer can stop the server.' });
    }
    const { password } = req.body || {};
    if (password !== HOST_ACTION_PASSWORD) {
        return res.status(401).json({ error: 'Access Denied: Wrong attempt. Unauthorized attempt recorded.' });
    }
    res.json({ success: true, message: 'Local File Hub is shutting down...' });
    setTimeout(() => {
        process.exit(0);
    }, 1000);
});

// API: Verify host admin password for opening admin panel
app.post('/api/admin/verify', (req, res) => {
    if (!isHostRequest(req)) {
        return res.status(403).json({ success: false, error: 'Permission Denied: Only host computer can access admin settings.' });
    }
    const { password } = req.body || {};
    if (password === HOST_ACTION_PASSWORD) {
        return res.json({ success: true });
    }
    return res.status(401).json({ success: false, error: 'Access Denied: Wrong attempt. Unauthorized attempt recorded.' });
});

// API: Update Host Configuration (Port & Admin Passwords)
app.post('/api/admin/update-settings', (req, res) => {
    if (!isHostRequest(req)) {
        return res.status(403).json({ error: 'Permission Denied: Only host computer can change server settings.' });
    }
    const { currentPassword, newAdminPassword, newPort, newRemotePassword } = req.body || {};

    if (currentPassword !== HOST_ACTION_PASSWORD) {
        return res.status(401).json({ error: 'Access Denied: Wrong attempt. Current admin password is incorrect.' });
    }

    let changed = false;

    // Update Host Admin Password
    if (newAdminPassword && typeof newAdminPassword === 'string' && newAdminPassword.trim().length > 0) {
        if (newAdminPassword.trim().length < 3) {
            return res.status(400).json({ error: 'New password must be at least 3 characters long.' });
        }
        config.hostActionPassword = newAdminPassword.trim();
        HOST_ACTION_PASSWORD = config.hostActionPassword;
        config.adminPassword = config.hostActionPassword;
        ADMIN_PASSWORD = config.adminPassword;
        changed = true;
    }

    // Update Remote Client Delete Password (if specifically provided)
    if (newRemotePassword && typeof newRemotePassword === 'string' && newRemotePassword.trim().length >= 3) {
        config.adminPassword = newRemotePassword.trim();
        ADMIN_PASSWORD = config.adminPassword;
        changed = true;
    }

    // Update Server Port
    if (newPort) {
        const portNum = parseInt(newPort, 10);
        if (isNaN(portNum) || portNum < 80 || portNum > 65535) {
            return res.status(400).json({ error: 'Port must be a valid number between 80 and 65535.' });
        }
        config.port = portNum;
        PORT = portNum;
        changed = true;
    }

    if (changed) {
        try {
            fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8');
            return res.json({
                success: true,
                message: 'Configuration updated and saved to config.json successfully.',
                config: {
                    port: config.port,
                    hostActionPassword: config.hostActionPassword,
                    adminPassword: config.adminPassword
                }
            });
        } catch (e) {
            return res.status(500).json({ error: 'Failed to write configuration to file: ' + e.message });
        }
    }

    return res.status(400).json({ error: 'No configuration changes were specified.' });
});

// API: Verify admin password for remote client deletion
app.post('/api/verify-password', (req, res) => {
    const { password } = req.body || {};
    if (password === ADMIN_PASSWORD) {
        return res.json({ success: true });
    }
    return res.status(401).json({ success: false, error: 'Access Denied: Wrong attempt. Unauthorized attempt recorded.' });
});

// API: List files in cloud directory
app.get('/api/files', (req, res) => {
    fs.readdir(CLOUD_DIR, (err, files) => {
        if (err) {
            return res.status(500).json({ error: 'Unable to scan cloud directory' });
        }
        const fileList = files
            .filter(file => file !== '.tmp' && !file.startsWith('.'))
            .map(file => {
                try {
                    const stats = fs.statSync(path.join(CLOUD_DIR, file));
                    return {
                        name: file,
                        size: stats.size,
                        mtime: stats.mtime,
                        isDir: stats.isDirectory()
                    };
                } catch (e) {
                    return null;
                }
            })
            .filter(Boolean);
        res.json(fileList);
    });
});

// API: Delete File (Host Machine or Authorized with Password)
app.delete('/api/files/:filename', verifySystemIntegrity, (req, res) => {
    const rawFilename = req.params.filename;
    if (!rawFilename) {
        return res.status(400).json({ error: 'Filename is required' });
    }

    const safeFilename = path.basename(decodeURIComponent(rawFilename));
    const filePath = path.join(CLOUD_DIR, safeFilename);

    const isHost = isHostRequest(req);
    const providedPassword = req.headers['x-admin-password'];
    const isAuthorized = isHost || (config.allowRemoteDeleteWithPassword && providedPassword === ADMIN_PASSWORD);

    if (!isAuthorized) {
        return res.status(403).json({
            error: 'Permission Denied: Only the host machine running this server or users with the admin password can delete files.',
            requiresPassword: !isHost
        });
    }

    if (!fs.existsSync(filePath)) {
        return res.status(404).json({ error: 'File not found' });
    }

    try {
        const stats = fs.statSync(filePath);
        if (stats.isDirectory()) {
            fs.rmSync(filePath, { recursive: true, force: true });
        } else {
            fs.unlinkSync(filePath);
        }
        return res.json({
            success: true,
            message: `File "${safeFilename}" deleted successfully.`
        });
    } catch (err) {
        console.error('Error deleting file:', err);
        return res.status(500).json({ error: 'Failed to delete file from storage' });
    }
});

// API: Download file
app.get('/api/download/:filename', (req, res) => {
    const rawFilename = req.params.filename;
    const safeFilename = path.basename(decodeURIComponent(rawFilename));
    const filePath = path.join(CLOUD_DIR, safeFilename);

    if (fs.existsSync(filePath)) {
        res.download(filePath, safeFilename);
    } else {
        res.status(404).send('File not found');
    }
});

// ============================================
//  UPLOAD ENDPOINTS
// ============================================

// Legacy single-request upload
app.post('/api/upload', verifySystemIntegrity, upload.single('file'), (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: 'No file uploaded.' });
    }
    res.json({ message: 'File uploaded successfully', file: req.file.originalname });
});

// Receive chunk
app.put('/api/upload/chunk',
    verifySystemIntegrity,
    express.raw({ type: 'application/octet-stream', limit: '55mb' }),
    (req, res) => {
        const rawUploadId = req.headers['x-upload-id'] || '';
        const uploadId = path.basename(rawUploadId).replace(/[^a-zA-Z0-9_-]/g, '');
        const chunkIndex = parseInt(req.headers['x-chunk-index'], 10);
        const totalChunks = parseInt(req.headers['x-total-chunks'], 10);
        const filename = path.basename(decodeURIComponent(req.headers['x-filename'] || ''));

        if (!uploadId || isNaN(chunkIndex) || isNaN(totalChunks) || !filename) {
            return res.status(400).json({ error: 'Missing required upload headers' });
        }

        const uploadDir = path.join(TEMP_DIR, uploadId);
        if (!fs.existsSync(uploadDir)) {
            fs.mkdirSync(uploadDir, { recursive: true });
        }

        const chunkPath = path.join(uploadDir, `chunk-${String(chunkIndex).padStart(6, '0')}`);
        fs.writeFile(chunkPath, req.body, (err) => {
            if (err) {
                console.error(`Error writing chunk ${chunkIndex}:`, err);
                return res.status(500).json({ error: 'Failed to write chunk' });
            }
            res.json({ received: chunkIndex });
        });
    }
);

// Complete chunked upload
app.post('/api/upload/complete', verifySystemIntegrity, async (req, res) => {
    const { uploadId: rawUploadId, filename: rawFilename, totalChunks } = req.body || {};

    if (!rawUploadId || !rawFilename || !totalChunks) {
        return res.status(400).json({ error: 'Missing uploadId, filename, or totalChunks' });
    }

    const uploadId = path.basename(rawUploadId).replace(/[^a-zA-Z0-9_-]/g, '');
    const filename = path.basename(rawFilename);
    const uploadDir = path.join(TEMP_DIR, uploadId);

    if (!fs.existsSync(uploadDir)) {
        return res.status(404).json({ error: 'Upload session not found' });
    }

    for (let i = 0; i < totalChunks; i++) {
        const chunkPath = path.join(uploadDir, `chunk-${String(i).padStart(6, '0')}`);
        if (!fs.existsSync(chunkPath)) {
            return res.status(400).json({ error: `Missing chunk ${i}` });
        }
    }

    const finalPath = path.join(CLOUD_DIR, filename);
    const writeStream = fs.createWriteStream(finalPath);

    try {
        for (let i = 0; i < totalChunks; i++) {
            const chunkPath = path.join(uploadDir, `chunk-${String(i).padStart(6, '0')}`);
            await new Promise((resolve, reject) => {
                const readStream = fs.createReadStream(chunkPath);
                readStream.pipe(writeStream, { end: false });
                readStream.on('end', resolve);
                readStream.on('error', reject);
            });
        }

        writeStream.end();
        await new Promise((resolve, reject) => {
            writeStream.on('finish', resolve);
            writeStream.on('error', reject);
        });

        fs.rmSync(uploadDir, { recursive: true, force: true });
        res.json({ message: 'File uploaded successfully', file: filename });
    } catch (err) {
        console.error('Error reassembling file:', err);
        writeStream.end();
        if (fs.existsSync(finalPath)) {
            fs.unlinkSync(finalPath);
        }
        res.status(500).json({ error: 'Failed to reassemble file' });
    }
});

// Fallback for SPA routing with embedded fallback
app.use((req, res) => {
    const diskPath = path.join(PUBLIC_DIR, 'index.html');
    if (fs.existsSync(diskPath)) {
        return res.sendFile(diskPath);
    }
    if (embeddedAssets && embeddedAssets.indexHtml) {
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        return res.send(embeddedAssets.indexHtml);
    }
    res.status(404).send('Local File Hub: UI files not found');
});

// GUI Mini-Controller & Status Notification System
let guiStatePath = null;
let guiProcess = null;
let isGuiInitialized = false;

function initGuiController(initialPort) {
    if (isGuiInitialized) return;
    isGuiInitialized = true;

    const isBackground = process.argv.includes('--background') || process.argv.includes('-b') || process.argv.includes('--silent');
    if (process.platform !== 'win32' || isBackground) return;

    try {
        guiStatePath = path.join(os.tmpdir(), `kryin-state-${process.pid}.json`);
        const scriptPath = path.join(os.tmpdir(), 'kryin-controller.ps1');

        const psScript = `param (
    [int]$ServerPid = 0,
    [string]$StateFile = ""
)

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$form = New-Object System.Windows.Forms.Form
$form.Text = "Kryin Local File Hub"
$form.Size = New-Object System.Drawing.Size(460, 270)
$form.StartPosition = "CenterScreen"
$form.FormBorderStyle = "FixedDialog"
$form.MaximizeBox = $false
$form.BackColor = [System.Drawing.ColorTranslator]::FromHtml("#0f172a")
$form.ForeColor = [System.Drawing.ColorTranslator]::FromHtml("#f8fafc")
$form.ShowInTaskbar = $true

# Header Bar
$header = New-Object System.Windows.Forms.Panel
$header.Location = New-Object System.Drawing.Point(0, 0)
$header.Size = New-Object System.Drawing.Size(460, 48)
$header.BackColor = [System.Drawing.ColorTranslator]::FromHtml("#1e293b")
$form.Controls.Add($header)

$accentLine = New-Object System.Windows.Forms.Panel
$accentLine.Location = New-Object System.Drawing.Point(0, 0)
$accentLine.Size = New-Object System.Drawing.Size(460, 3)
$accentLine.BackColor = [System.Drawing.ColorTranslator]::FromHtml("#38bdf8")
$header.Controls.Add($accentLine)

$lblTitle = New-Object System.Windows.Forms.Label
$lblTitle.Text = "Kryin Local File Hub"
$lblTitle.Font = New-Object System.Drawing.Font("Segoe UI", 12, [System.Drawing.FontStyle]::Bold)
$lblTitle.ForeColor = [System.Drawing.ColorTranslator]::FromHtml("#38bdf8")
$lblTitle.Location = New-Object System.Drawing.Point(16, 12)
$lblTitle.Size = New-Object System.Drawing.Size(240, 26)
$header.Controls.Add($lblTitle)

$lblAuthor = New-Object System.Windows.Forms.Label
$lblAuthor.Text = "Created by Arth"
$lblAuthor.Font = New-Object System.Drawing.Font("Segoe UI", 8.5)
$lblAuthor.ForeColor = [System.Drawing.ColorTranslator]::FromHtml("#94a3b8")
$lblAuthor.Location = New-Object System.Drawing.Point(340, 15)
$lblAuthor.Size = New-Object System.Drawing.Size(100, 20)
$lblAuthor.TextAlign = [System.Drawing.ContentAlignment]::TopRight
$header.Controls.Add($lblAuthor)

# Status Card
$card = New-Object System.Windows.Forms.Panel
$card.Location = New-Object System.Drawing.Point(16, 60)
$card.Size = New-Object System.Drawing.Size(412, 105)
$card.BackColor = [System.Drawing.ColorTranslator]::FromHtml("#1e293b")
$form.Controls.Add($card)

$lblStatusHeader = New-Object System.Windows.Forms.Label
$lblStatusHeader.Text = "STATUS: Initializing Server..."
$lblStatusHeader.Font = New-Object System.Drawing.Font("Segoe UI", 10, [System.Drawing.FontStyle]::Bold)
$lblStatusHeader.ForeColor = [System.Drawing.ColorTranslator]::FromHtml("#facc15")
$lblStatusHeader.Location = New-Object System.Drawing.Point(12, 10)
$lblStatusHeader.Size = New-Object System.Drawing.Size(388, 22)
$card.Controls.Add($lblStatusHeader)

$lblStatusLine1 = New-Object System.Windows.Forms.Label
$lblStatusLine1.Text = "Checking port availability..."
$lblStatusLine1.Font = New-Object System.Drawing.Font("Segoe UI", 9)
$lblStatusLine1.ForeColor = [System.Drawing.ColorTranslator]::FromHtml("#e2e8f0")
$lblStatusLine1.Location = New-Object System.Drawing.Point(12, 36)
$lblStatusLine1.Size = New-Object System.Drawing.Size(388, 20)
$card.Controls.Add($lblStatusLine1)

$lblStatusLine2 = New-Object System.Windows.Forms.Label
$lblStatusLine2.Text = "Please wait a moment..."
$lblStatusLine2.Font = New-Object System.Drawing.Font("Segoe UI", 8.5)
$lblStatusLine2.ForeColor = [System.Drawing.ColorTranslator]::FromHtml("#94a3b8")
$lblStatusLine2.Location = New-Object System.Drawing.Point(12, 58)
$lblStatusLine2.Size = New-Object System.Drawing.Size(388, 38)
$card.Controls.Add($lblStatusLine2)

# Action Buttons
$btnBrowser = New-Object System.Windows.Forms.Button
$btnBrowser.Text = "Open Browser"
$btnBrowser.Font = New-Object System.Drawing.Font("Segoe UI", 9, [System.Drawing.FontStyle]::Bold)
$btnBrowser.BackColor = [System.Drawing.ColorTranslator]::FromHtml("#0284c7")
$btnBrowser.ForeColor = [System.Drawing.Color]::White
$btnBrowser.FlatStyle = [System.Windows.Forms.FlatStyle]::Flat
$btnBrowser.FlatAppearance.BorderSize = 0
$btnBrowser.Location = New-Object System.Drawing.Point(16, 178)
$btnBrowser.Size = New-Object System.Drawing.Size(125, 36)
$btnBrowser.Enabled = $false
$btnBrowser.Cursor = [System.Windows.Forms.Cursors]::Hand
$form.Controls.Add($btnBrowser)

$btnMinimize = New-Object System.Windows.Forms.Button
$btnMinimize.Text = "Minimize"
$btnMinimize.Font = New-Object System.Drawing.Font("Segoe UI", 9)
$btnMinimize.BackColor = [System.Drawing.ColorTranslator]::FromHtml("#334155")
$btnMinimize.ForeColor = [System.Drawing.ColorTranslator]::FromHtml("#e2e8f0")
$btnMinimize.FlatStyle = [System.Windows.Forms.FlatStyle]::Flat
$btnMinimize.FlatAppearance.BorderSize = 0
$btnMinimize.Location = New-Object System.Drawing.Point(152, 178)
$btnMinimize.Size = New-Object System.Drawing.Size(110, 36)
$btnMinimize.Cursor = [System.Windows.Forms.Cursors]::Hand
$btnMinimize.Add_Click({
    $form.WindowState = [System.Windows.Forms.FormWindowState]::Minimized
})
$form.Controls.Add($btnMinimize)

$btnStop = New-Object System.Windows.Forms.Button
$btnStop.Text = "Stop Server"
$btnStop.Font = New-Object System.Drawing.Font("Segoe UI", 9, [System.Drawing.FontStyle]::Bold)
$btnStop.BackColor = [System.Drawing.ColorTranslator]::FromHtml("#dc2626")
$btnStop.ForeColor = [System.Drawing.Color]::White
$btnStop.FlatStyle = [System.Windows.Forms.FlatStyle]::Flat
$btnStop.FlatAppearance.BorderSize = 0
$btnStop.Location = New-Object System.Drawing.Point(298, 178)
$btnStop.Size = New-Object System.Drawing.Size(130, 36)
$btnStop.Cursor = [System.Windows.Forms.Cursors]::Hand
$btnStop.Add_Click({
    $form.Close()
})
$form.Controls.Add($btnStop)

# Dynamic State Monitoring
$script:activePort = ${initialPort}
$script:minimizedDone = $false

$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = 250
$timer.Add_Tick({
    if ($ServerPid -gt 0) {
        $p = Get-Process -Id $ServerPid -ErrorAction SilentlyContinue
        if (-not $p) {
            $form.Close()
            return
        }
    }

    if ($StateFile -and (Test-Path $StateFile)) {
        try {
            $raw = Get-Content $StateFile -Raw -ErrorAction SilentlyContinue
            if ($raw) {
                $st = $raw | ConvertFrom-Json
                if ($st) {
                    if ($st.status -eq "running") {
                        $script:activePort = $st.port
                        $lblStatusHeader.Text = "ACTIVE: Server Running"
                        $lblStatusHeader.ForeColor = [System.Drawing.ColorTranslator]::FromHtml("#4ade80")
                        $lblStatusLine1.Text = "Local Access: http://localhost:" + $st.port
                        $lblStatusLine2.Text = "LAN Network: " + $st.lanUrl + " (Share with devices)"
                        $btnBrowser.Enabled = $true
                        
                        if ($st.autoMinimize -and (-not $script:minimizedDone)) {
                            $script:minimizedDone = $true
                            Start-Sleep -Milliseconds 1500
                            $form.WindowState = [System.Windows.Forms.FormWindowState]::Minimized
                        }
                    } elseif ($st.status -eq "switching") {
                        $lblStatusHeader.Text = "SWITCHING: Port " + $st.occupiedPort + " In Use"
                        $lblStatusHeader.ForeColor = [System.Drawing.ColorTranslator]::FromHtml("#fb923c")
                        $lblStatusLine1.Text = "Trying fallback port " + $st.targetPort + "..."
                        $lblStatusLine2.Text = "Resolving port collision automatically."
                    } elseif ($st.status -eq "error") {
                        $lblStatusHeader.Text = "ERROR: Port Conflict"
                        $lblStatusHeader.ForeColor = [System.Drawing.ColorTranslator]::FromHtml("#ef4444")
                        $lblStatusLine1.Text = "Could not bind ports 20260 - 20270."
                        $lblStatusLine2.Text = "Please close conflicting apps or edit config.json."
                        $btnBrowser.Text = "Edit Config"
                        $btnBrowser.Enabled = $true
                    }
                }
            }
        } catch {}
    }
})

$btnBrowser.Add_Click({
    if ($lblStatusHeader.Text -like "*ERROR*") {
        Start-Process "notepad.exe" -ArgumentList "config.json"
    } else {
        Start-Process ("http://localhost:" + $script:activePort)
    }
})

# Form Closing Handler - cleanly terminates server
$form.Add_FormClosing({
    $timer.Stop()
    if ($ServerPid -gt 0) {
        Stop-Process -Id $ServerPid -Force -ErrorAction SilentlyContinue
    }
    if ($StateFile -and (Test-Path $StateFile)) {
        Remove-Item $StateFile -Force -ErrorAction SilentlyContinue
    }
})

$timer.Start()
$form.ShowDialog() | Out-Null
`;
        fs.writeFileSync(scriptPath, psScript, 'utf8');

        // Write initial state
        updateGuiState({ status: 'starting', targetPort: initialPort });

        // Spawn GUI controller detached
        guiProcess = spawn('powershell.exe', [
            '-WindowStyle', 'Hidden',
            '-NoProfile',
            '-ExecutionPolicy', 'Bypass',
            '-File', scriptPath,
            '-ServerPid', String(process.pid),
            '-StateFile', guiStatePath
        ], { detached: true, stdio: 'ignore' });
        guiProcess.unref();

    } catch (e) {
        console.warn('Could not launch GUI mini-controller:', e.message);
    }
}

function updateGuiState(state) {
    if (!guiStatePath) return;
    try {
        fs.writeFileSync(guiStatePath, JSON.stringify(state), 'utf8');
    } catch (e) {}
}

function cleanupGui() {
    if (guiStatePath && fs.existsSync(guiStatePath)) {
        try { fs.unlinkSync(guiStatePath); } catch (e) {}
    }
}
process.on('exit', cleanupGui);
process.on('SIGINT', () => { cleanupGui(); process.exit(0); });
process.on('SIGTERM', () => { cleanupGui(); process.exit(0); });

// Native Windows Synchronous Alert Dialog
function showNativeAlert(title, message) {
    if (process.platform === 'win32') {
        try {
            const escapedMsg = message.replace(/'/g, "''").replace(/\r?\n/g, '`n');
            const escapedTitle = title.replace(/'/g, "''");
            const cmd = `powershell.exe -WindowStyle Hidden -NoProfile -Command "Add-Type -AssemblyName PresentationFramework; [System.Windows.MessageBox]::Show('${escapedMsg}', '${escapedTitle}', 'OK', 'Warning') | Out-Null;"`;
            execSync(cmd, { stdio: 'ignore' });
        } catch (e) {}
    }
}

// Server Lifecycle & Multi-Tier Port Conflict Resolution
let serverInstance = null;
let originalRequestedPort = PORT;
let portFallbackOccurred = false;

function startServer(targetPort, attemptsLeft = 10) {
    // Launch Mini-Controller on initial start
    initGuiController(targetPort);

    const server = app.listen(targetPort, '0.0.0.0');

    server.on('listening', () => {
        PORT = targetPort;
        if (PORT !== originalRequestedPort) {
            portFallbackOccurred = true;
        }

        const realLanIp = getRealLanIp();
        const localUrl = `http://localhost:${PORT}`;
        const networkUrl = `http://${realLanIp}:${PORT}`;

        // Update Mini-Controller GUI status
        updateGuiState({
            status: 'running',
            port: PORT,
            lanUrl: networkUrl,
            autoMinimize: true
        });

        console.log('\n======================================================');
        console.log('  LOCAL FILE HUB - CREATED BY ARTH PUROHIT');
        console.log('  Portfolio: https://arth-hub.vercel.app/');
        console.log('  GitHub:    https://github.com/ArthOfficial');
        console.log('======================================================');
        console.log(`  Local Host Access:   ${localUrl}`);
        console.log(`  LAN Network Access:  ${networkUrl}  <-- Share this with other devices!`);
        console.log(`  Storage Directory:   ${CLOUD_DIR}`);
        console.log(`  Host Deletion:       DIRECT (No password needed on host)`);
        console.log(`  Remote Deletion:     PASSWORD PROTECTED`);
        console.log(`  Host Actions Pass:   PASSWORD PROTECTED`);
        if (portFallbackOccurred) {
            console.log(`  Port Notice:         Original port ${originalRequestedPort} was occupied. Auto-shifted to ${PORT}.`);
        }
        console.log('======================================================\n');

        // Auto-open browser on manual launch (unless --background flag is passed)
        const isBackground = process.argv.includes('--background') || process.argv.includes('-b') || process.argv.includes('--silent');
        if (!isBackground && config.autoOpenBrowser !== false) {
            try {
                if (process.platform === 'win32') {
                    exec(`start "" "${localUrl}"`);
                } else if (process.platform === 'darwin') {
                    exec(`open ${localUrl}`);
                } else {
                    exec(`xdg-open ${localUrl}`);
                }
            } catch (e) {}
        }
    });

    server.on('error', async (err) => {
        if (err.code === 'EADDRINUSE') {
            // Tier 1: Is Kryin Local File Hub already running on this port?
            let isOurAppRunning = false;
            try {
                const checkRes = await fetch(`http://127.0.0.1:${targetPort}/api/status`, {
                    headers: { 'X-Arth-Signature': AUTHOR_SIGNATURE },
                    signal: AbortSignal.timeout(600)
                });
                const json = await checkRes.json().catch(() => ({}));
                if (json.app === 'Local File Hub') {
                    isOurAppRunning = true;
                }
            } catch (e) {
                isOurAppRunning = false;
            }

            if (isOurAppRunning) {
                // Single-Instance: Open browser to existing server and exit
                cleanupGui();
                const localUrl = `http://localhost:${targetPort}`;
                const isBackground = process.argv.includes('--background') || process.argv.includes('-b') || process.argv.includes('--silent');
                if (!isBackground && config.autoOpenBrowser !== false) {
                    try {
                        if (process.platform === 'win32') {
                            exec(`start "" "${localUrl}"`);
                        } else if (process.platform === 'darwin') {
                            exec(`open ${localUrl}`);
                        } else {
                            exec(`xdg-open ${localUrl}`);
                        }
                    } catch (e) {}
                }
                setTimeout(() => process.exit(0), 200);
                return;
            }

            // Tier 2: Port occupied by another application. Try next available port
            if (attemptsLeft > 0 && targetPort < 65535) {
                const nextPort = targetPort + 1;
                console.warn(`Notice: Port ${targetPort} is occupied by another program. Trying port ${nextPort}...`);
                updateGuiState({
                    status: 'switching',
                    occupiedPort: targetPort,
                    targetPort: nextPort
                });
                return startServer(nextPort, attemptsLeft - 1);
            }

            // Tier 3: All fallback ports exhausted. Show GUI update and synchronous alert
            updateGuiState({
                status: 'error',
                message: `Could not start server on port ${originalRequestedPort} (ports ${originalRequestedPort}-${targetPort} are occupied).`
            });
            showNativeAlert(
                'Kryin Local File Hub - Port Conflict',
                `Could not start server on port ${originalRequestedPort} (or subsequent fallback ports).\n\nThe port is currently in use by another application.\n\nPlease close the conflicting program or choose a different port in config.json.`
            );
            cleanupGui();
            process.exit(1);
        } else {
            console.error('Server initialization error:', err);
            cleanupGui();
            process.exit(1);
        }
    });

    // Upload connection stability
    server.requestTimeout = 0;
    server.headersTimeout = 0;
    server.timeout = 0;
    serverInstance = server;
    return server;
}

startServer(PORT, 10);

