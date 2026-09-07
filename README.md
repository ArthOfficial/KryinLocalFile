# KryinLocalFile 🚀

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Platform](https://img.shields.io/badge/Platform-Windows%20%7C%20Linux%20%7C%20macOS-0078D6.svg)](https://github.com/ArthOfficial/KryinLocalFile)
[![Node.js](https://img.shields.io/badge/Node.js-24%2B-339933.svg)](https://nodejs.org/)
[![Subsystem](https://img.shields.io/badge/Subsystem-Windows%20GUI%20(Zero--Console)-purple.svg)](#zero-console-gui-mode)

**KryinLocalFile** is an ultra-fast, peer-to-peer Local Area Network (LAN) file storage and streaming hub. It enables instantaneous sharing of multi-gigabyte files between PCs, laptops, iPhones, and Android devices across your local Wi-Fi network without relying on third-party cloud services or internet bandwidth.

Packaged as a standalone portable Windows executable (`KryinLocalFile.exe`) with **zero-console GUI execution** and a built-in **Windows Startup Background Service toggle**.

---

## ✨ Features

- 🖥️ **Zero-Console Execution**: Compiled with the Windows GUI PE subsystem. Double-clicking the `.exe` opens your sleek browser dashboard directly without any flashing black terminal windows.
- 🔄 **Windows Autostart (Background Service)**: Toggle "Start with Windows" directly from the web interface. Runs silently in the background on startup (`--background`) ready for LAN requests.
- ⚡ **High-Speed Chunked Streaming**: Automatically slices large files into 50MB chunks with automatic retry logic and server-side reassembly, easily handling 10GB+ files without memory leaks.
- 📱 **Cross-Platform LAN Sharing**: Connect any phone, tablet, or computer on the same Wi-Fi using the displayed LAN IP address.
- 🛡️ **Host Security & Remote RBAC**: Local server host enjoys full direct access. Remote clients across the network can view and download files, but require the Host Admin Password to delete files.
- 🎨 **Minimalist Engineering UI**: Dark responsive interface with real-time transfer progress, live upload speeds, search filtering, and file category pills (Documents, Media, Archives).
- 🛑 **Host Server Controls**: Gracefully shut down or toggle startup autostart right from the navigation bar.

---

## 🚀 Quick Start

### Option 1: Run the Standalone Binary (No Node.js Required)

1. Download or locate `KryinLocalFile.exe`.
2. Double-click **`KryinLocalFile.exe`**.
3. Your default browser will automatically open to `http://localhost:3000`.
4. Other devices on your local Wi-Fi can connect to `http://<YOUR_LOCAL_IP>:3000`.

### Option 2: Run from Source

```bash
# Clone the repository
git clone https://github.com/ArthOfficial/KryinLocalFile.git
cd KryinLocalFile

# Install dependencies
npm install

# Start the server
npm start
```

---

## ⚙️ Configuration (`config.json`)

You can customize port, password, and browser behavior in `config.json`:

```json
{
  "port": 3000,
  "adminPassword": "kryinadmin",
  "allowRemoteDeleteWithPassword": true,
  "autoOpenBrowser": true
}
```

| Field | Type | Description | Default |
|---|---|---|---|
| `port` | `number` | Port for the HTTP server to listen on | `3000` |
| `adminPassword` | `string` | Password required by remote LAN devices to delete files | `"kryinadmin"` |
| `allowRemoteDeleteWithPassword` | `boolean` | Allow remote network users to delete files with password | `true` |
| `autoOpenBrowser` | `boolean` | Automatically open default browser on manual launch | `true` |

---

## 🔄 Windows Autostart & Background Mode

KryinLocalFile features deep integration with the Windows user registry:

- **Enable via Web UI**: Toggle **"Start with Windows"** in the top navigation bar.
- **Silent Boot**: On system restart, Windows launches `KryinLocalFile.exe --background`.
  - No command prompt is displayed.
  - No browser tab pops up.
  - The server runs silently in the background, serving files to your phone and local network.
- **Registry Key**: Managed in `HKCU\Software\Microsoft\Windows\CurrentVersion\Run\KryinLocalFile` (requires no administrator elevation).

---

## 🛠️ Building Standalone Executable

To compile your own zero-console `.exe` from source:

```bash
# Build standalone KryinLocalFile.exe
npm run build:exe
```

### Build Pipeline Overview:
1. **`build-assets.js`**: Compiles frontend assets (`index.html`, `style.css`, `app.js`) into base64 embedded golden master fallbacks.
2. **`esbuild`**: Bundles backend dependencies into `dist/bundle.js`.
3. **`node SEA`**: Generates Single Executable Application blob (`dist/sea-prep.blob`).
4. **`postject`**: Injects SEA blob into Node container.
5. **`PE Subsystem Patch`**: Automatically patches PE header offset to Subsystem `2` (Windows GUI), eliminating the terminal window.

---

## 📡 API Reference

### System & Status
- `GET /api/status` — Returns host status, local IP, port, and security settings.
- `GET /api/autostart` — Checks Windows registry autostart status.
- `POST /api/autostart` — `{ "enabled": boolean }` (Host only) Updates Windows autostart.
- `POST /api/system/shutdown` — (Host only) Gracefully terminates the background server.

### File Operations
- `GET /api/files` — Returns list of files, sizes, timestamps, and types.
- `GET /api/download/:filename` — Downloads requested file from shared storage.
- `DELETE /api/files/:filename` — Deletes file (direct for host; header `x-admin-password` required for LAN clients).

### Upload Endpoints
- `PUT /api/upload/chunk` — Streams individual 50MB file binary chunks with headers `x-upload-id`, `x-chunk-index`, `x-total-chunks`, `x-filename`.
- `POST /api/upload/complete` — Reassembles all uploaded chunks into the final destination file.

---

## 🔒 Security Architecture

- **No Blind IP Spoofing**: `isHostRequest` checks socket-level IP bindings directly, preventing attackers from bypassing delete permissions using spoofed `X-Forwarded-For` headers.
- **Sanitized Paths**: All incoming filenames are sanitized using `path.basename` to prevent directory traversal attacks.
- **LAN Protection**: Remote clients cannot delete files or access administrative system commands without authentication.

---

## 📄 License

This project is licensed under the [MIT License](LICENSE) — see the [LICENSE](LICENSE) file for details.
