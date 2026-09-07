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
const { exec } = require('child_process');

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
    port: 3000,
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

let PORT = process.env.PORT || config.port || 3000;
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
function getRealLanIp() {
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
    return candidates[0] ? candidates[0].address : '127.0.0.1';
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

// Server Initialization
const server = app.listen(PORT, '0.0.0.0', () => {
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
    console.log('======================================================\n');

    // Auto-open browser on manual launch (unless --background flag is passed)
    const isBackground = process.argv.includes('--background') || process.argv.includes('-b') || process.argv.includes('--silent');
    if (!isBackground && config.autoOpenBrowser !== false) {
        try {
            if (process.platform === 'win32') {
                exec(`start ${localUrl}`);
            } else if (process.platform === 'darwin') {
                exec(`open ${localUrl}`);
            } else {
                exec(`xdg-open ${localUrl}`);
            }
        } catch (e) {}
    }
});

// Upload connection stability
server.requestTimeout = 0;
server.headersTimeout = 0;
server.timeout = 0;
