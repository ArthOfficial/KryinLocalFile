/**
 * Local File Hub - Client Application
 * =========================================================================
 * Author: Arth Purohit (https://arth-hub.vercel.app/)
 * GitHub: https://github.com/ArthOfficial
 * Copyright (c) Arth Purohit. All rights reserved.
 * 
 * Peer-to-peer LAN storage, chunked streaming file transfer, real Wi-Fi IP
 * sharing, password-protected Windows autostart & server shutdown host controls.
 * =========================================================================
 */

(() => {
    'use strict';

    // Core Constants & Attribution Tokens
    const AUTHOR_NAME = 'Arth';
    const AUTHOR_TARGET_URL = 'https://arth-hub.vercel.app/';
    const INTEGRITY_TOKEN = 'ARTH_PUROHIT_VERIFIED_AUTH';
    const CHUNK_SIZE = 50 * 1024 * 1024; // 50MB chunks
    const MAX_RETRIES = 3;
    const RETRY_DELAY_MS = 1500;

    // State
    let isHostUser = false;
    let allFiles = [];
    let activeFilter = 'all';
    let searchQuery = '';
    let pendingDeleteTarget = null;
    let currentLanUrl = '';

    // DOM Elements
    const dropZone = document.getElementById('drop-zone');
    const fileInput = document.getElementById('file-input');
    const fileList = document.getElementById('file-list');
    const refreshBtn = document.getElementById('refresh-btn');
    const searchInput = document.getElementById('search-input');
    const filterPills = document.querySelectorAll('.filter-pill');
    const storageStats = document.getElementById('storage-stats');
    const connectionBadge = document.getElementById('connection-badge');
    const connectionLabel = document.getElementById('connection-label');

    // Real LAN Share Pill
    const lanSharePill = document.getElementById('lan-share-pill');
    const lanUrlDisplay = document.getElementById('lan-url-display');
    const copyLanBtn = document.getElementById('copy-lan-btn');

    // Host Controls
    const hostControls = document.getElementById('host-controls');
    const autostartToggle = document.getElementById('autostart-toggle');
    const shutdownBtn = document.getElementById('shutdown-btn');

    // Host Action Password Modal Elements
    const hostActionModal = document.getElementById('host-action-modal');
    const hostActionTitle = document.getElementById('host-action-title');
    const hostActionSubtitle = document.getElementById('host-action-subtitle');
    const hostPasswordInput = document.getElementById('host-password-input');
    const hostActionCancelBtn = document.getElementById('host-action-cancel-btn');
    const hostActionConfirmBtn = document.getElementById('host-action-confirm-btn');

    // Progress Elements
    const progressContainer = document.getElementById('progress-container');
    const progressFill = document.getElementById('progress-fill');
    const progressPercent = document.getElementById('progress-percent');
    const progressFilename = document.getElementById('progress-filename');
    const progressDetail = document.getElementById('progress-detail');

    // Modal Elements
    const deleteModal = document.getElementById('delete-modal');
    const deleteModalSubtitle = document.getElementById('delete-modal-subtitle');
    const deleteTargetFilename = document.getElementById('delete-target-filename');
    const deletePasswordGroup = document.getElementById('delete-password-group');
    const adminPasswordInput = document.getElementById('admin-password-input');
    const modalCancelBtn = document.getElementById('modal-cancel-btn');
    const modalConfirmDeleteBtn = document.getElementById('modal-confirm-delete-btn');
    const toast = document.getElementById('toast');

    // ============================================
    //  INITIALIZATION
    // ============================================
    async function init() {
        await checkSystemStatus();
        await loadFiles();
        bindEvents();
    }

    // System Status, Real LAN IP, and Host Detection
    async function checkSystemStatus() {
        try {
            const res = await fetch('/api/status', {
                headers: { 'X-Arth-Signature': INTEGRITY_TOKEN }
            });
            if (!res.ok) throw new Error('Status check failed');
            const data = await res.json();

            isHostUser = Boolean(data.isHost);
            currentLanUrl = data.lanUrl || `http://${data.serverIp}:${data.port || 3000}`;

            const dot = connectionBadge.querySelector('.status-dot');

            if (isHostUser) {
                dot.className = 'status-dot host';
                connectionLabel.textContent = 'Server Host (Direct Access)';
                if (hostControls) {
                    hostControls.style.display = 'inline-flex';
                    initAutostartStatus();
                }
            } else {
                dot.className = 'status-dot client';
                connectionLabel.textContent = 'Connected via LAN';
                if (hostControls) {
                    hostControls.style.display = 'none';
                }
            }

            // Display Real LAN URL for sharing with other devices on Wi-Fi
            if (lanSharePill && lanUrlDisplay && data.serverIp && data.serverIp !== '127.0.0.1') {
                lanUrlDisplay.textContent = currentLanUrl;
                lanSharePill.style.display = 'inline-flex';
            }
        } catch (err) {
            const dot = connectionBadge.querySelector('.status-dot');
            dot.className = 'status-dot';
            connectionLabel.textContent = 'Offline';
            showToast('Unable to connect to local server.', 'error', 'Connection Error');
        }
    }

    // Initialize Windows Autostart Status
    async function initAutostartStatus() {
        try {
            const res = await fetch('/api/autostart', {
                headers: { 'X-Arth-Signature': INTEGRITY_TOKEN }
            });
            if (!res.ok) return;
            const data = await res.json();
            if (data.supported && autostartToggle) {
                autostartToggle.checked = Boolean(data.enabled);
            }
        } catch (e) {
            console.warn('Could not query autostart status:', e);
        }
    }

    // Helper: Modal Password Prompt for Host Actions (Requires 2026)
    function promptHostPassword(title, subtitle, onConfirm, onCancel) {
        if (!hostActionModal) return;

        hostActionTitle.textContent = title;
        hostActionSubtitle.textContent = subtitle;
        hostPasswordInput.value = '';
        hostActionModal.classList.add('visible');
        setTimeout(() => hostPasswordInput.focus(), 100);

        function cleanup() {
            hostActionModal.classList.remove('visible');
            hostActionConfirmBtn.onclick = null;
            hostActionCancelBtn.onclick = null;
            hostPasswordInput.onkeydown = null;
        }

        hostActionCancelBtn.onclick = () => {
            cleanup();
            if (onCancel) onCancel();
        };

        hostActionConfirmBtn.onclick = () => {
            const password = hostPasswordInput.value.trim();
            if (!password) {
                showToast('Please enter host password (default: 2026)', 'warning');
                hostPasswordInput.focus();
                return;
            }
            cleanup();
            onConfirm(password);
        };

        hostPasswordInput.onkeydown = (e) => {
            if (e.key === 'Enter') hostActionConfirmBtn.click();
            if (e.key === 'Escape') hostActionCancelBtn.click();
        };
    }

    // ============================================
    //  FILE LISTING & FILTERING
    // ============================================
    async function loadFiles() {
        try {
            const res = await fetch('/api/files', {
                headers: { 'X-Arth-Signature': INTEGRITY_TOKEN }
            });
            if (!res.ok) throw new Error('Failed to load files');
            allFiles = await res.json();
            renderFiles();
        } catch (err) {
            console.error(err);
            fileList.innerHTML = `<li class="empty-state">Unable to load files from server.</li>`;
        }
    }

    function renderFiles() {
        let filtered = allFiles.slice();

        // Category filter
        if (activeFilter !== 'all') {
            filtered = filtered.filter(f => matchesCategory(f.name, activeFilter));
        }

        // Search query
        if (searchQuery.trim()) {
            const q = searchQuery.toLowerCase().trim();
            filtered = filtered.filter(f => f.name.toLowerCase().includes(q));
        }

        // Update stats
        const totalBytes = allFiles.reduce((acc, f) => acc + (f.size || 0), 0);
        storageStats.textContent = `${allFiles.length} file${allFiles.length === 1 ? '' : 's'} • ${formatFileSize(totalBytes)}`;

        if (filtered.length === 0) {
            fileList.innerHTML = `<li class="empty-state">${searchQuery ? 'No matching files found.' : 'No files uploaded yet.'}</li>`;
            return;
        }

        fileList.innerHTML = '';
        filtered.forEach(file => {
            const li = document.createElement('li');
            li.className = 'file-row';

            const sizeStr = formatFileSize(file.size);
            const dateStr = new Date(file.mtime).toLocaleDateString(undefined, {
                year: 'numeric',
                month: 'short',
                day: 'numeric'
            });

            const iconSvg = getFileIcon(file.name);

            li.innerHTML = `
                <div class="file-primary">
                    <div class="file-type-icon">${iconSvg}</div>
                    <div class="file-details">
                        <span class="file-title" title="${escapeHtml(file.name)}">${escapeHtml(file.name)}</span>
                        <div class="file-metadata">
                            <span>${sizeStr}</span>
                            <span>•</span>
                            <span>${dateStr}</span>
                        </div>
                    </div>
                </div>
                <div class="file-actions">
                    <a href="/api/download/${encodeURIComponent(file.name)}" class="btn-file-download" download title="Download">
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                            <polyline points="7 10 12 15 17 10"></polyline>
                            <line x1="12" y1="15" x2="12" y2="3"></line>
                        </svg>
                        <span>Download</span>
                    </a>
                    <button type="button" class="btn-file-delete" data-filename="${escapeHtml(file.name)}" title="Delete file">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <polyline points="3 6 5 6 21 6"></polyline>
                            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                        </svg>
                    </button>
                </div>
            `;

            const deleteBtn = li.querySelector('.btn-file-delete');
            deleteBtn.addEventListener('click', () => {
                promptDeleteFile(file.name);
            });

            fileList.appendChild(li);
        });
    }

    function matchesCategory(filename, category) {
        const ext = filename.split('.').pop().toLowerCase();
        if (category === 'docs') {
            return ['pdf', 'doc', 'docx', 'txt', 'rtf', 'csv', 'xlsx', 'xls', 'pptx', 'md'].includes(ext);
        }
        if (category === 'media') {
            return ['jpg', 'jpeg', 'png', 'gif', 'svg', 'webp', 'mp4', 'mov', 'avi', 'mkv', 'mp3', 'wav', 'flac'].includes(ext);
        }
        if (category === 'archives') {
            return ['zip', 'rar', 'tar', 'gz', '7z', 'bz2', 'iso'].includes(ext);
        }
        return true;
    }

    function getFileIcon(filename) {
        const ext = filename.split('.').pop().toLowerCase();
        if (['pdf', 'doc', 'docx', 'txt', 'md', 'rtf'].includes(ext)) {
            return `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line></svg>`;
        }
        if (['jpg', 'jpeg', 'png', 'gif', 'svg', 'webp'].includes(ext)) {
            return `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><circle cx="8.5" cy="8.5" r="1.5"></circle><polyline points="21 15 16 10 5 21"></polyline></svg>`;
        }
        if (['mp4', 'mov', 'avi', 'mkv', 'webm'].includes(ext)) {
            return `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="23 7 16 12 23 17 23 7"></polygon><rect x="1" y="5" width="15" height="14" rx="2" ry="2"></rect></svg>`;
        }
        if (['mp3', 'wav', 'flac', 'aac', 'ogg'].includes(ext)) {
            return `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18V5l12-2v13"></path><circle cx="6" cy="18" r="3"></circle><circle cx="18" cy="16" r="3"></circle></svg>`;
        }
        if (['zip', 'rar', '7z', 'tar', 'gz'].includes(ext)) {
            return `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 8v13H3V8"></path><path d="M1 3h22v5H1z"></path><line x1="10" y1="12" x2="14" y2="12"></line></svg>`;
        }
        if (['js', 'html', 'css', 'json', 'py', 'java', 'c', 'cpp', 'ts'].includes(ext)) {
            return `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="16 18 22 12 16 6"></polyline><polyline points="8 6 2 12 8 18"></polyline></svg>`;
        }
        return `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"></path><polyline points="13 2 13 9 20 9"></polyline></svg>`;
    }

    // ============================================
    //  DELETE WORKFLOW (HOST OR PASSWORD)
    // ============================================
    function promptDeleteFile(filename) {
        pendingDeleteTarget = filename;
        deleteTargetFilename.textContent = filename;

        if (isHostUser) {
            deleteModalSubtitle.textContent = 'Permanently delete this file from local storage.';
            deletePasswordGroup.style.display = 'none';
            adminPasswordInput.value = '';
        } else {
            deleteModalSubtitle.textContent = 'Server host authorization required to delete this file.';
            deletePasswordGroup.style.display = 'flex';
            adminPasswordInput.value = '';
            setTimeout(() => adminPasswordInput.focus(), 100);
        }

        deleteModal.classList.add('visible');
    }

    function closeDeleteModal() {
        deleteModal.classList.remove('visible');
        pendingDeleteTarget = null;
        adminPasswordInput.value = '';
    }

    async function executeDelete() {
        if (!pendingDeleteTarget) return;

        const filename = pendingDeleteTarget;
        const headers = {
            'X-Arth-Signature': INTEGRITY_TOKEN
        };

        if (!isHostUser) {
            const pass = adminPasswordInput.value.trim();
            if (!pass) {
                showToast('Please enter host admin password to authorize deletion.', 'warning', 'Password Required');
                adminPasswordInput.focus();
                return;
            }
            headers['X-Admin-Password'] = pass;
        }

        modalConfirmDeleteBtn.disabled = true;
        modalConfirmDeleteBtn.textContent = 'Deleting...';

        try {
            const res = await fetch(`/api/files/${encodeURIComponent(filename)}`, {
                method: 'DELETE',
                headers: headers
            });

            const data = await res.json();

            if (res.ok) {
                showToast(`"${filename}" deleted successfully.`, 'success');
                closeDeleteModal();
                await loadFiles();
            } else {
                showToast(data.error || 'Failed to delete file.', 'error', 'Action Denied');
                if (data.requiresPassword) {
                    deletePasswordGroup.style.display = 'flex';
                    adminPasswordInput.focus();
                }
            }
        } catch (err) {
            showToast('Network error while requesting file deletion.', 'error', 'Error');
        } finally {
            modalConfirmDeleteBtn.disabled = false;
            modalConfirmDeleteBtn.textContent = 'Delete Permanently';
        }
    }

    // ============================================
    //  FILE UPLOADS (DIRECT & CHUNKED STREAMING)
    // ============================================
    async function handleFiles(files) {
        const fileArr = Array.from(files);
        for (let i = 0; i < fileArr.length; i++) {
            const file = fileArr[i];
            try {
                if (file.size > CHUNK_SIZE) {
                    await uploadFileInChunks(file);
                } else {
                    await uploadFileDirect(file);
                }
                showToast(`"${file.name}" uploaded successfully.`, 'success');
            } catch (err) {
                console.error('Upload failed:', err);
                showToast(`Failed to upload "${file.name}": ${err.message}`, 'error', 'Upload Error');
            } finally {
                hideProgress();
            }
        }
        await loadFiles();
    }

    // Direct single-request upload
    function uploadFileDirect(file) {
        return new Promise((resolve, reject) => {
            showProgress(file.name);
            const formData = new FormData();
            formData.append('file', file);

            const xhr = new XMLHttpRequest();
            xhr.upload.addEventListener('progress', (e) => {
                if (e.lengthComputable) {
                    const pct = Math.round((e.loaded / e.total) * 100);
                    updateProgress(pct, e.loaded, e.total);
                }
            });

            xhr.addEventListener('load', () => {
                if (xhr.status >= 200 && xhr.status < 300) {
                    completeProgress();
                    resolve();
                } else {
                    reject(new Error(`Server responded with HTTP ${xhr.status}`));
                }
            });

            xhr.addEventListener('error', () => reject(new Error('Network connection failure during upload.')));
            xhr.addEventListener('abort', () => reject(new Error('Upload transfer aborted.')));

            xhr.open('POST', '/api/upload');
            xhr.setRequestHeader('X-Arth-Signature', INTEGRITY_TOKEN);
            xhr.send(formData);
        });
    }

    // Chunked Streaming Upload
    async function uploadFileInChunks(file) {
        const totalChunks = Math.ceil(file.size / CHUNK_SIZE);
        const uploadId = generateUploadId();

        showProgress(file.name);
        updateProgressDetail(`Initiating chunked stream (0 of ${totalChunks} chunks)...`);

        for (let i = 0; i < totalChunks; i++) {
            const start = i * CHUNK_SIZE;
            const end = Math.min(file.size, start + CHUNK_SIZE);
            const chunk = file.slice(start, end);

            let attempts = 0;
            let uploaded = false;

            while (attempts < MAX_RETRIES && !uploaded) {
                try {
                    attempts++;
                    await uploadChunkWithProgress(chunk, i, totalChunks, uploadId, file.name, (loadedInChunk) => {
                        const totalLoaded = start + loadedInChunk;
                        const pct = Math.round((totalLoaded / file.size) * 100);
                        updateProgress(pct, totalLoaded, file.size);
                        updateProgressDetail(`Streaming chunk ${i + 1}/${totalChunks} (attempt ${attempts})...`);
                    });
                    uploaded = true;
                } catch (err) {
                    if (attempts >= MAX_RETRIES) {
                        throw new Error(`Chunk ${i + 1} failed after ${MAX_RETRIES} attempts: ${err.message}`);
                    }
                    updateProgressDetail(`Chunk ${i + 1} retrying in ${RETRY_DELAY_MS / 1000}s...`);
                    await sleep(RETRY_DELAY_MS);
                }
            }
        }

        // Finalize assemble
        updateProgressDetail('Reassembling file chunks on server...');
        const completeRes = await fetch('/api/upload/complete', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Arth-Signature': INTEGRITY_TOKEN
            },
            body: JSON.stringify({
                uploadId: uploadId,
                filename: file.name,
                totalChunks: totalChunks
            })
        });

        if (!completeRes.ok) {
            const errorJson = await completeRes.json().catch(() => ({}));
            throw new Error(errorJson.error || 'Server failed to reassemble chunks.');
        }

        completeProgress();
    }

    function uploadChunkWithProgress(blob, chunkIndex, totalChunks, uploadId, filename, onProgress) {
        return new Promise((resolve, reject) => {
            const xhr = new XMLHttpRequest();

            xhr.upload.addEventListener('progress', (e) => {
                if (e.lengthComputable && onProgress) {
                    onProgress(e.loaded);
                }
            });

            xhr.addEventListener('load', () => {
                if (xhr.status >= 200 && xhr.status < 300) {
                    resolve();
                } else {
                    reject(new Error(`HTTP ${xhr.status}`));
                }
            });

            xhr.addEventListener('error', () => reject(new Error('Network error')));
            xhr.addEventListener('abort', () => reject(new Error('Aborted')));

            xhr.open('PUT', '/api/upload/chunk');
            xhr.setRequestHeader('Content-Type', 'application/octet-stream');
            xhr.setRequestHeader('X-Upload-Id', uploadId);
            xhr.setRequestHeader('X-Chunk-Index', chunkIndex);
            xhr.setRequestHeader('X-Total-Chunks', totalChunks);
            xhr.setRequestHeader('X-Filename', encodeURIComponent(filename));
            xhr.setRequestHeader('X-Arth-Signature', INTEGRITY_TOKEN);
            xhr.send(blob);
        });
    }

    // ============================================
    //  PROGRESS UTILITIES
    // ============================================
    function showProgress(filename) {
        progressContainer.classList.add('visible');
        progressFill.style.width = '0%';
        progressFill.classList.remove('complete');
        progressPercent.textContent = '0%';
        progressFilename.textContent = filename;
        progressDetail.textContent = 'Transfer starting...';
    }

    function updateProgress(percent, loaded, total) {
        progressFill.style.width = `${percent}%`;
        progressPercent.textContent = `${percent}%`;
        progressDetail.textContent = `${formatFileSize(loaded)} of ${formatFileSize(total)}`;
    }

    function updateProgressDetail(text) {
        progressDetail.textContent = text;
    }

    function completeProgress() {
        progressFill.style.width = '100%';
        progressFill.classList.add('complete');
        progressPercent.textContent = '100%';
        progressDetail.textContent = 'Upload complete.';
    }

    function hideProgress() {
        progressContainer.classList.remove('visible');
    }

    // ============================================
    //  EVENT BINDINGS
    // ============================================
    function bindEvents() {
        // Refresh: Re-reads files and updates UI without full page reload
        refreshBtn.addEventListener('click', async () => {
            const icon = refreshBtn.querySelector('.refresh-icon');
            if (icon) {
                icon.classList.remove('spinning');
                void icon.offsetWidth;
                icon.classList.add('spinning');
            }
            await loadFiles();
            await checkSystemStatus();
            showToast(`File list refreshed (${allFiles.length} files)`, 'success');
        });

        // Copy LAN URL button
        if (copyLanBtn) {
            copyLanBtn.addEventListener('click', async () => {
                if (!currentLanUrl) return;
                try {
                    await navigator.clipboard.writeText(currentLanUrl);
                    copyLanBtn.textContent = 'Copied!';
                    copyLanBtn.classList.add('copied');
                    showToast(`Copied ${currentLanUrl} to clipboard! Open this on your phone or laptop.`, 'success', 'URL Copied');
                    setTimeout(() => {
                        copyLanBtn.textContent = 'Copy';
                        copyLanBtn.classList.remove('copied');
                    }, 2000);
                } catch (e) {
                    showToast('Failed to copy to clipboard', 'error');
                }
            });
        }

        // Search Input
        searchInput.addEventListener('input', (e) => {
            searchQuery = e.target.value;
            renderFiles();
        });

        // Filter Pills
        filterPills.forEach(pill => {
            pill.addEventListener('click', () => {
                filterPills.forEach(p => p.classList.remove('active'));
                pill.classList.add('active');
                activeFilter = pill.dataset.filter;
                renderFiles();
            });
        });

        // Drop Zone
        dropZone.addEventListener('click', () => fileInput.click());
        dropZone.addEventListener('dragover', (e) => {
            e.preventDefault();
            dropZone.classList.add('dragover');
        });
        dropZone.addEventListener('dragleave', () => {
            dropZone.classList.remove('dragover');
        });
        dropZone.addEventListener('drop', (e) => {
            e.preventDefault();
            dropZone.classList.remove('dragover');
            if (e.dataTransfer && e.dataTransfer.files.length > 0) {
                handleFiles(e.dataTransfer.files);
            }
        });

        fileInput.addEventListener('change', () => {
            if (fileInput.files && fileInput.files.length > 0) {
                handleFiles(fileInput.files);
                fileInput.value = '';
            }
        });

        // Host Autostart Toggle with Password Authentication (2026)
        if (autostartToggle) {
            autostartToggle.addEventListener('click', (e) => {
                e.preventDefault(); // Pause toggle until password is confirmed
                const desiredState = !autostartToggle.checked;

                promptHostPassword(
                    'Windows Startup Autostart',
                    desiredState
                        ? 'Enter password (2026) to enable background autostart on boot.'
                        : 'Enter password (2026) to disable background autostart.',
                    async (password) => {
                        try {
                            const res = await fetch('/api/autostart', {
                                method: 'POST',
                                headers: {
                                    'Content-Type': 'application/json',
                                    'X-Arth-Signature': INTEGRITY_TOKEN
                                },
                                body: JSON.stringify({ enabled: desiredState, password: password })
                            });
                            const result = await res.json();
                            if (res.ok && result.success) {
                                autostartToggle.checked = desiredState;
                                showToast(desiredState ? 'Windows autostart enabled (runs in background on boot)' : 'Windows autostart disabled', 'success');
                            } else {
                                showToast(result.error || 'Password invalid or autostart update failed', 'error');
                            }
                        } catch (err) {
                            showToast('Error connecting to server for autostart', 'error');
                        }
                    }
                );
            });
        }

        // Host Shutdown Button with Password Authentication (2026)
        if (shutdownBtn) {
            shutdownBtn.addEventListener('click', () => {
                promptHostPassword(
                    'Stop Local File Server',
                    'Enter password (2026) to gracefully stop the local background server.',
                    async (password) => {
                        try {
                            const res = await fetch('/api/system/shutdown', {
                                method: 'POST',
                                headers: {
                                    'Content-Type': 'application/json',
                                    'X-Arth-Signature': INTEGRITY_TOKEN
                                },
                                body: JSON.stringify({ password: password })
                            });
                            const result = await res.json();
                            if (res.ok && result.success) {
                                showToast('Server has been shut down.', 'info');
                                document.body.innerHTML = `
                                    <div style="display:flex; align-items:center; justify-content:center; min-height:100vh; background:#0c0e11; color:#f0f3f6; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; text-align:center;">
                                        <div style="padding: 24px; border: 1px solid #242930; border-radius: 12px; background: #14171b; max-width: 400px;">
                                            <div style="width: 44px; height: 44px; border-radius: 50%; background: rgba(45, 104, 196, 0.15); display: flex; align-items: center; justify-content: center; margin: 0 auto 16px;">
                                                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#60a5fa" stroke-width="2"><path d="M18.36 6.64a9 9 0 1 1-12.73 0"></path><line x1="12" y1="2" x2="12" y2="12"></line></svg>
                                            </div>
                                            <h2 style="font-size:20px; font-weight:600; margin-bottom:8px;">Local File Hub Stopped</h2>
                                            <p style="color:#8d96a0; font-size:13px; line-height:1.5;">The background server has been safely stopped. You can close this browser tab.</p>
                                        </div>
                                    </div>`;
                            } else {
                                showToast(result.error || 'Invalid password to stop server.', 'error');
                            }
                        } catch (err) {
                            showToast('Error sending shutdown command', 'error');
                        }
                    }
                );
            });
        }

        // Modal Controls
        modalCancelBtn.addEventListener('click', closeDeleteModal);
        modalConfirmDeleteBtn.addEventListener('click', executeDelete);
        deleteModal.addEventListener('click', (e) => {
            if (e.target === deleteModal) closeDeleteModal();
        });
        adminPasswordInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') executeDelete();
        });
    }

    // ============================================
    //  HELPERS
    // ============================================
    let toastTimeout = null;
    function showToast(message, type = 'info', title = '') {
        let iconSvg = '';
        if (type === 'success') {
            iconSvg = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"></polyline></svg>`;
            if (!title) title = 'Success';
        } else if (type === 'error') {
            iconSvg = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>`;
            if (!title) title = 'Error';
        } else if (type === 'warning') {
            iconSvg = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>`;
            if (!title) title = 'Notice';
        } else {
            iconSvg = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>`;
            if (!title) title = 'Info';
        }

        toast.innerHTML = `
            <div class="toast-icon">${iconSvg}</div>
            <div class="toast-content">
                <div class="toast-title">${escapeHtml(title)}</div>
                <div class="toast-message">${escapeHtml(message)}</div>
            </div>
        `;
        toast.className = `toast-notification show ${type}`;

        if (toastTimeout) clearTimeout(toastTimeout);
        toastTimeout = setTimeout(() => {
            toast.className = 'toast-notification';
        }, 3800);
    }

    function formatFileSize(bytes) {
        if (!bytes || bytes <= 0) return '0 B';
        const units = ['B', 'KB', 'MB', 'GB', 'TB'];
        const i = Math.floor(Math.log(bytes) / Math.log(1024));
        return (bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1) + ' ' + units[i];
    }

    function generateUploadId() {
        return 'upl-' + Math.random().toString(36).substring(2, 9) + Date.now().toString(36);
    }

    function escapeHtml(str) {
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

    function sleep(ms) {
        return new Promise(res => setTimeout(res, ms));
    }

    // Start App
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
