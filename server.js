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

// Native Port Process Inspector & Process Killer (Ultra-Lightweight, Zero-Overhead)
function getProcessOnPort(port) {
    if (process.platform !== 'win32') return null;
    try {
        const netstat = execSync('netstat -ano -p tcp', { encoding: 'utf8' });
        const lines = netstat.split('\n');
        for (const line of lines) {
            if (line.includes(':' + port) && line.includes('LISTENING')) {
                const parts = line.trim().split(/\s+/);
                const pid = parts[parts.length - 1];
                if (pid && !isNaN(pid) && parseInt(pid) > 0) {
                    let procName = 'Unknown Application';
                    try {
                        const task = execSync(`tasklist /fi "PID eq ${pid}" /fo csv /nh`, { encoding: 'utf8' });
                        const match = task.match(/"([^"]+)"/);
                        if (match) procName = match[1];
                    } catch (e) {}
                    return { pid: parseInt(pid), name: procName };
                }
            }
        }
    } catch (e) {}
    return null;
}

function promptKillProcess(port, proc) {
    if (process.platform !== 'win32') return false;
    try {
        const title = 'Kryin Local File Hub - Port Conflict';
        const lines = [
            `Port ${port} is currently in use by another application:`,
            '',
            `  • Application:  ${proc.name}`,
            `  • Process ID:   ${proc.pid}`,
            `  • Kill Command: taskkill /F /PID ${proc.pid}`,
            '',
            `Would you like to terminate this process to free port ${port}?`,
            '',
            `• Click [YES] to terminate ${proc.name} and start on port ${port}.`,
            `• Click [NO]  to keep it running and automatically switch to the next port.`
        ];

        const psScript = `
Add-Type -AssemblyName PresentationFramework
$msg = @"
${lines.join('\r\n')}
"@
$res = [System.Windows.MessageBox]::Show($msg, '${title}', 'YesNo', 'Question')
Write-Output $res
`;
        const encoded = Buffer.from(psScript, 'utf16le').toString('base64');
        const cmd = `powershell.exe -WindowStyle Hidden -NoProfile -EncodedCommand ${encoded}`;
        const result = execSync(cmd, { encoding: 'utf8' }).trim();
        return result.includes('Yes');
    } catch (e) {
        return false;
    }
}

function killProcess(pid) {
    try {
        execSync(`taskkill /F /PID ${pid}`, { stdio: 'ignore' });
        return true;
    } catch (e) {
        return false;
    }
}

function showNativeAlert(title, message) {
    if (process.platform === 'win32') {
        try {
            const cleanMsg = message.replace(/\r?\n/g, '\r\n');
            const psScript = `
Add-Type -AssemblyName PresentationFramework
$msg = @"
${cleanMsg}
"@
[System.Windows.MessageBox]::Show($msg, '${title}', 'OK', 'Warning') | Out-Null
`;
            const encoded = Buffer.from(psScript, 'utf16le').toString('base64');
            const cmd = `powershell.exe -WindowStyle Hidden -NoProfile -EncodedCommand ${encoded}`;
            execSync(cmd, { stdio: 'ignore' });
        } catch (e) {}
    }
}

// API: Shutdown Server Gracefully (from Admin Settings)
const handleShutdown = (req, res) => {
    if (!isHostRequest(req)) {
        return res.status(403).json({ error: 'Permission Denied: Only host computer can shutdown the server.' });
    }
    const { password } = req.body || {};
    if (password !== HOST_ACTION_PASSWORD) {
        return res.status(401).json({ error: 'Access Denied: Wrong attempt.' });
    }

    res.json({ success: true, message: 'Server is shutting down.' });
    setTimeout(() => {
        process.exit(0);
    }, 400);
};

app.post('/api/admin/shutdown', handleShutdown);
app.post('/api/system/shutdown', handleShutdown);

// Windows System Tray Integration (Tray Icon in Taskbar Notification Area with Right-Click Menu)
let trayProcess = null;

function startSystemTray(port, lanUrl) {
    if (process.platform !== 'win32') return;
    if (trayProcess) {
        try { trayProcess.kill(); } catch (e) {}
    }

    try {
        const trayScriptPath = path.join(os.tmpdir(), 'kryin-tray.ps1');
        const exePath = (process.execPath || '').replace(/'/g, "''");

        const psTrayScript = `param (
    [int]$ServerPid = 0,
    [int]$Port = ${port},
    [string]$LanUrl = "${lanUrl}",
    [string]$ExePath = "${exePath}"
)

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$notify = New-Object System.Windows.Forms.NotifyIcon

try {
    if ($ExePath -and (Test-Path $ExePath)) {
        $notify.Icon = [System.Drawing.Icon]::ExtractAssociatedIcon($ExePath)
    } else {
        $notify.Icon = [System.Drawing.SystemIcons]::Application
    }
} catch {
    $notify.Icon = [System.Drawing.SystemIcons]::Application
}

$notify.Text = "Kryin Local File Hub - Port $Port"
$notify.Visible = $true

# Context Menu (Right-Click like Docker / OneDrive)
$menu = New-Object System.Windows.Forms.ContextMenuStrip

$header = $menu.Items.Add("Kryin Local File Hub (v2026)")
$header.Enabled = $false

$sep0 = $menu.Items.Add("-")

$menuOpen = $menu.Items.Add("Open in Browser")
$menuOpen.Font = New-Object System.Drawing.Font("Segoe UI", 9, [System.Drawing.FontStyle]::Bold)
$menuOpen.Add_Click({
    Start-Process "http://localhost:$Port"
})

$menuLan = $menu.Items.Add("Copy LAN Link ($LanUrl)")
$menuLan.Add_Click({
    [System.Windows.Forms.Clipboard]::SetText($LanUrl)
    $notify.ShowBalloonTip(2000, "Kryin Local File Hub", "LAN URL copied to clipboard!\`n$LanUrl", [System.Windows.Forms.ToolTipIcon]::Info)
})

$menuConfig = $menu.Items.Add("Settings / Change Port (config.json)")
$menuConfig.Add_Click({
    Start-Process "notepad.exe" -ArgumentList "config.json"
})

$sep1 = $menu.Items.Add("-")

$menuStop = $menu.Items.Add("Stop Server")
$menuStop.ForeColor = [System.Drawing.Color]::Red
$menuStop.Add_Click({
    $notify.Visible = $false
    if ($ServerPid -gt 0) {
        Stop-Process -Id $ServerPid -Force -ErrorAction SilentlyContinue
    }
    [System.Windows.Forms.Application]::Exit()
})

$notify.ContextMenuStrip = $menu

# Left double-click opens browser
$notify.Add_DoubleClick({
    Start-Process "http://localhost:$Port"
})

# Balloon notification near taskbar tray arrow
$notify.ShowBalloonTip(3000, "Kryin Local File Hub", "Server active on port $Port.\`nRight-click this tray icon to manage or stop.", [System.Windows.Forms.ToolTipIcon]::Info)

# Watch parent server process
$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = 1000
$timer.Add_Tick({
    if ($ServerPid -gt 0) {
        $p = Get-Process -Id $ServerPid -ErrorAction SilentlyContinue
        if (-not $p) {
            $notify.Visible = $false
            [System.Windows.Forms.Application]::Exit()
        }
    }
})
$timer.Start()

[System.Windows.Forms.Application]::Run()
`;

        fs.writeFileSync(trayScriptPath, psTrayScript, 'utf8');

        trayProcess = spawn('powershell.exe', [
            '-WindowStyle', 'Hidden',
            '-NoProfile',
            '-ExecutionPolicy', 'Bypass',
            '-File', trayScriptPath,
            '-ServerPid', String(process.pid),
            '-Port', String(port),
            '-LanUrl', lanUrl,
            '-ExePath', process.execPath
        ], { detached: true, stdio: 'ignore' });
        trayProcess.unref();

    } catch (e) {
        console.warn('System tray initialization notice:', e.message);
    }
}

function stopSystemTray() {
    if (trayProcess) {
        try { trayProcess.kill(); } catch (e) {}
    }
}
process.on('exit', stopSystemTray);
process.on('SIGINT', () => { stopSystemTray(); process.exit(0); });
process.on('SIGTERM', () => { stopSystemTray(); process.exit(0); });

// Server Lifecycle & Intelligent Conflict Resolution
let serverInstance = null;
let originalRequestedPort = PORT;
let portFallbackOccurred = false;

function startServer(targetPort, attemptsLeft = 10) {
    const server = app.listen(targetPort, '0.0.0.0');

    server.on('listening', () => {
        PORT = targetPort;
        if (PORT !== originalRequestedPort) {
            portFallbackOccurred = true;
        }

        const realLanIp = getRealLanIp();
        const localUrl = `http://localhost:${PORT}`;
        const networkUrl = `http://${realLanIp}:${PORT}`;

        // Initialize Windows System Tray Icon (under the taskbar arrow)
        startSystemTray(PORT, networkUrl);

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
                    signal: AbortSignal.timeout(500)
                });
                const json = await checkRes.json().catch(() => ({}));
                if (json.app === 'Local File Hub') {
                    isOurAppRunning = true;
                }
            } catch (e) {
                isOurAppRunning = false;
            }

            if (isOurAppRunning) {
                // Single-Instance: Bring up existing server's browser tab and exit cleanly
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

            // Tier 2: Another application is using this port - inspect process and offer to kill
            const conflictingProc = getProcessOnPort(targetPort);
            const isBackground = process.argv.includes('--background') || process.argv.includes('-b') || process.argv.includes('--silent');

            if (conflictingProc && !isBackground) {
                const shouldKill = promptKillProcess(targetPort, conflictingProc);
                if (shouldKill) {
                    const killed = killProcess(conflictingProc.pid);
                    if (killed) {
                        // Wait 300ms for OS socket release, then retry targetPort
                        setTimeout(() => {
                            startServer(targetPort, attemptsLeft);
                        }, 300);
                        return;
                    }
                }
            }

            // Tier 3: Try next available fallback port
            if (attemptsLeft > 0 && targetPort < 65535) {
                const nextPort = targetPort + 1;
                console.warn(`Notice: Port ${targetPort} is occupied. Trying next port ${nextPort}...`);
                return startServer(nextPort, attemptsLeft - 1);
            }

            // Tier 4: All fallback ports exhausted. Show clear warning alert
            showNativeAlert(
                'Kryin Local File Hub - Port Conflict',
                `Could not start server on port ${originalRequestedPort} (or fallback ports up to ${targetPort}).\n\nAll attempted ports are currently in use by other applications.\n\nPlease close conflicting programs or select an available port in config.json.`
            );
            process.exit(1);
        } else {
            console.error('Server initialization error:', err);
            process.exit(1);
        }
    });

    // Connection stability
    server.requestTimeout = 0;
    server.headersTimeout = 0;
    server.timeout = 0;
    serverInstance = server;
    return server;
}

startServer(PORT, 10);

