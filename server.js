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

// Helper to parse JSON with comments (supports // and /* */ comments)
function parseJsonWithComments(str) {
    if (!str || typeof str !== 'string') return {};
    try {
        return JSON.parse(str);
    } catch (e) {
        try {
            const clean = str
                .replace(/\/\*[\s\S]*?\*\//g, '')
                .replace(/(^|[^\\:])\/\/.*$/gm, '$1');
            return JSON.parse(clean);
        } catch (e2) {
            return {};
        }
    }
}

// Load configuration from config.json (Central properties file)
let config = {
    "//_comment_showTerminal": "Set to true to show the default server terminal with startup details, IP addresses, and live error logs (closing it stops server), or false to run hidden",
    showTerminal: true,
    port: 20260,
    hostActionPassword: '2026',
    deletePassword: 'kryinadmin',
    adminPassword: 'kryinadmin',
    allowRemoteDeleteWithPassword: true,
    autoOpenBrowser: true
};

let configPath = path.join(ROOT_DIR, 'config.json');
if (!fs.existsSync(configPath)) {
    const exeConfigPath = path.join(path.dirname(process.execPath), 'config.json');
    if (fs.existsSync(exeConfigPath)) {
        configPath = exeConfigPath;
    }
}

if (fs.existsSync(configPath)) {
    try {
        const rawContent = fs.readFileSync(configPath, 'utf8');
        config = { ...config, ...parseJsonWithComments(rawContent) };
    } catch (e) {
        console.warn('Notice: Could not parse config.json, using configuration from file/defaults.');
    }
} else {
    // Auto-create config.json so the user can easily view and edit all server properties in one place
    try {
        const initialConfig = {
            "//_comment_showTerminal": "Set to true to show the default server terminal with startup details, IP addresses, and live error logs (closing it stops server), or false to run hidden",
            "showTerminal": true,
            "port": 20260,
            "hostActionPassword": "2026",
            "deletePassword": "kryinadmin",
            "adminPassword": "kryinadmin",
            "allowRemoteDeleteWithPassword": true,
            "autoOpenBrowser": true
        };
        fs.writeFileSync(configPath, JSON.stringify(initialConfig, null, 2), 'utf8');
    } catch (e) {}
}

// Native Windows Console Visibility Control
function setConsoleVisibility(visible) {
    if (process.platform !== 'win32') return;
    try {
        const action = visible ? 5 : 0; // 5 = SW_SHOW, 0 = SW_HIDE
        const psScript = path.join(os.tmpdir(), 'kryin-console-visibility.ps1');
        if (!fs.existsSync(psScript)) {
            const code = `param([int]$Action = 0)
$sig = @'
using System;
using System.Runtime.InteropServices;
public class Win32Con {
    [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
    [DllImport("kernel32.dll")] public static extern IntPtr GetConsoleWindow();
}
'@
if (-not ([System.Management.Automation.PSTypeName]'Win32Con').Type) {
    Add-Type -TypeDefinition $sig -ErrorAction SilentlyContinue
}
$h = [Win32Con]::GetConsoleWindow()
if ($h -ne [IntPtr]::Zero) {
    [Win32Con]::ShowWindow($h, $Action)
}
`;
            fs.writeFileSync(psScript, code, 'utf8');
        }
        exec(`powershell.exe -NoProfile -ExecutionPolicy Bypass -File "${psScript}" -Action ${action}`, {
            windowsHide: true,
            stdio: 'ignore'
        });
    } catch (e) {}
}

const isBackgroundMode = process.argv.includes('--background') || process.argv.includes('-b') || process.argv.includes('--silent');
if (config.showTerminal === false || isBackgroundMode) {
    setConsoleVisibility(false);
}

const INSTANCE_LOCK_FILE = path.join(os.tmpdir(), 'kryin-hub.lock');

// Instant Single-Instance Check (< 5ms): Brings up browser and prevents duplicates on repeated double-clicks
function checkSingleInstance() {
    if (fs.existsSync(INSTANCE_LOCK_FILE)) {
        try {
            const data = JSON.parse(fs.readFileSync(INSTANCE_LOCK_FILE, 'utf8'));
            if (data && data.pid && data.pid !== process.pid) {
                let isAlive = false;
                try {
                    process.kill(data.pid, 0);
                    isAlive = true;
                } catch (e) {
                    isAlive = false;
                }
                if (isAlive) {
                    const targetPort = data.port || config.port || 20260;
                    const isBackground = process.argv.includes('--background') || process.argv.includes('-b') || process.argv.includes('--silent');
                    if (!isBackground && config.autoOpenBrowser !== false) {
                        try {
                            if (process.platform === 'win32') {
                                exec(`start "" "http://localhost:${targetPort}"`, { windowsHide: true });
                            } else if (process.platform === 'darwin') {
                                exec(`open http://localhost:${targetPort}`);
                            } else {
                                exec(`xdg-open http://localhost:${targetPort}`);
                            }
                        } catch (e) {}
                    }
                    process.exit(0);
                }
            }
        } catch (e) {}
    }
}
checkSingleInstance();

let PORT = process.env.PORT || config.port || 20260;
let ADMIN_PASSWORD = config.deletePassword || config.adminPassword || 'kryinadmin';
let HOST_ACTION_PASSWORD = config.hostActionPassword || '2026';

function isValidHostPassword(pass) {
    if (!pass) return false;
    const clean = String(pass).trim();
    return clean === (config.hostActionPassword || HOST_ACTION_PASSWORD);
}

function isValidDeletePassword(pass) {
    if (!pass) return false;
    const clean = String(pass).trim();
    const currentDelete = config.deletePassword || config.adminPassword || ADMIN_PASSWORD;
    const currentHost = config.hostActionPassword || HOST_ACTION_PASSWORD;
    return clean === currentDelete || clean === currentHost;
}

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

// Request logging for console terminal
app.use((req, res, next) => {
    if (req.url !== '/favicon.ico' && !req.url.startsWith('/style.css') && !req.url.startsWith('/app.js') && !req.url.startsWith('/logo.png')) {
        const start = Date.now();
        res.on('finish', () => {
            const duration = Date.now() - start;
            console.log(`[${new Date().toLocaleTimeString()}] ${req.method} ${req.url} - ${res.statusCode} (${duration}ms)`);
        });
    }
    next();
});

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

app.get('/favicon.ico', (req, res) => {
    const diskPath = path.join(PUBLIC_DIR, 'favicon.ico');
    if (fs.existsSync(diskPath)) {
        return res.sendFile(diskPath);
    }
    if (embeddedAssets && embeddedAssets.faviconIco) {
        res.setHeader('Content-Type', 'image/x-icon');
        return res.send(Buffer.from(embeddedAssets.faviconIco, 'base64'));
    }
    res.status(404).send('Not found');
});

app.get('/logo.png', (req, res) => {
    const diskPath = path.join(PUBLIC_DIR, 'logo.png');
    if (fs.existsSync(diskPath)) {
        return res.sendFile(diskPath);
    }
    if (embeddedAssets && embeddedAssets.logoPng) {
        res.setHeader('Content-Type', 'image/png');
        return res.send(Buffer.from(embeddedAssets.logoPng, 'base64'));
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
    exec(`reg query "${REG_KEY}" /v "${REG_VAL}"`, { windowsHide: true }, (err, stdout) => {
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
        exec(cmd, { windowsHide: true }, (err) => {
            if (err) return callback(err);
            callback(null, true);
        });
    } else {
        const cmd = `reg delete "${REG_KEY}" /v "${REG_VAL}" /f`;
        exec(cmd, { windowsHide: true }, () => {
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
        allowRemoteDelete: config.allowRemoteDeleteWithPassword,
        showTerminal: Boolean(config.showTerminal)
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
    if (!isValidHostPassword(password)) {
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
    if (!isValidHostPassword(password)) {
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
    if (isValidHostPassword(password)) {
        return res.json({ success: true });
    }
    return res.status(401).json({ success: false, error: 'Access Denied: Wrong attempt. Unauthorized attempt recorded.' });
});

// API: Update Host Configuration (Port, Master Admin Password, & File Deletion Password)
app.post('/api/admin/update-settings', (req, res) => {
    if (!isHostRequest(req)) {
        return res.status(403).json({ error: 'Permission Denied: Only host computer can change server settings.' });
    }
    const { currentPassword, newAdminPassword, newDeletePassword, newPort, newRemotePassword } = req.body || {};

    if (!isValidHostPassword(currentPassword)) {
        return res.status(401).json({ error: 'Access Denied: Wrong attempt. Current admin password is incorrect.' });
    }

    let changed = false;

    // Update Master Host Admin Password
    if (newAdminPassword && typeof newAdminPassword === 'string' && newAdminPassword.trim().length > 0) {
        if (newAdminPassword.trim().length < 3) {
            return res.status(400).json({ error: 'New admin password must be at least 3 characters long.' });
        }
        config.hostActionPassword = newAdminPassword.trim();
        HOST_ACTION_PASSWORD = config.hostActionPassword;
        changed = true;
    }

    // Update File Deletion Password (for remote clients deleting files)
    const targetDeletePass = newDeletePassword || newRemotePassword;
    if (targetDeletePass && typeof targetDeletePass === 'string' && targetDeletePass.trim().length > 0) {
        if (targetDeletePass.trim().length < 3) {
            return res.status(400).json({ error: 'New deletion password must be at least 3 characters long.' });
        }
        config.adminPassword = targetDeletePass.trim();
        config.deletePassword = targetDeletePass.trim();
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

    // Update showTerminal setting
    const { showTerminal } = req.body || {};
    if (typeof showTerminal === 'boolean') {
        config.showTerminal = showTerminal;
        changed = true;
        setConsoleVisibility(config.showTerminal);
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
    if (isValidDeletePassword(password)) {
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
    const isAuthorized = isHost || (config.allowRemoteDeleteWithPassword && isValidDeletePassword(providedPassword));

    if (!isAuthorized) {
        return res.status(403).json({
            error: 'Permission Denied: Only the host machine running this server or users with the deletion password can delete files.',
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
        const netstat = execSync('netstat -ano -p tcp', { encoding: 'utf8', windowsHide: true });
        const lines = netstat.split('\n');
        for (const line of lines) {
            if (line.includes(':' + port) && line.includes('LISTENING')) {
                const parts = line.trim().split(/\s+/);
                const pid = parts[parts.length - 1];
                if (pid && !isNaN(pid) && parseInt(pid) > 0) {
                    let procName = 'Unknown Application';
                    try {
                        const task = execSync(`tasklist /fi "PID eq ${pid}" /fo csv /nh`, { encoding: 'utf8', windowsHide: true });
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
        const result = execSync(cmd, { encoding: 'utf8', windowsHide: true }).trim();
        return result.includes('Yes');
    } catch (e) {
        return false;
    }
}

function killProcess(pid) {
    try {
        execSync(`taskkill /F /PID ${pid}`, { stdio: 'ignore', windowsHide: true });
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
            execSync(cmd, { stdio: 'ignore', windowsHide: true });
        } catch (e) {}
    }
}

// API: Shutdown Server Gracefully (from Admin Settings)
const handleShutdown = (req, res) => {
    if (!isHostRequest(req)) {
        return res.status(403).json({ error: 'Permission Denied: Only host computer can shutdown the server.' });
    }
    const { password } = req.body || {};
    if (!isValidHostPassword(password)) {
        return res.status(401).json({ error: 'Access Denied: Wrong attempt.' });
    }

    res.json({ success: true, message: 'Server is shutting down.' });
    setTimeout(() => {
        process.exit(0);
    }, 400);
};

app.post('/api/admin/shutdown', handleShutdown);
app.post('/api/system/shutdown', handleShutdown);

// Clean exit and single-instance lockfile cleanup
function cleanupOnExit() {
    try {
        if (fs.existsSync(INSTANCE_LOCK_FILE)) fs.unlinkSync(INSTANCE_LOCK_FILE);
    } catch (e) {}
}
process.on('exit', cleanupOnExit);
process.on('SIGINT', () => { cleanupOnExit(); process.exit(0); });
process.on('SIGTERM', () => { cleanupOnExit(); process.exit(0); });

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

        try {
            fs.writeFileSync(INSTANCE_LOCK_FILE, JSON.stringify({ pid: process.pid, port: PORT }), 'utf8');
        } catch (e) {}

        const realLanIp = getRealLanIp();
        const localUrl = `http://localhost:${PORT}`;
        const networkUrl = `http://${realLanIp}:${PORT}`;

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

        // Auto-open browser immediately on manual launch
        const isBackground = process.argv.includes('--background') || process.argv.includes('-b') || process.argv.includes('--silent');
        if (!isBackground && config.autoOpenBrowser !== false) {
            try {
                if (process.platform === 'win32') {
                    exec(`start "" "${localUrl}"`, { windowsHide: true });
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
                    signal: AbortSignal.timeout(150)
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
                            exec(`start "" "${localUrl}"`, { windowsHide: true });
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

