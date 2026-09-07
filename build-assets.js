const fs = require('fs');
const path = require('path');

const publicDir = path.join(__dirname, 'public');
const indexHtmlB64 = Buffer.from(fs.readFileSync(path.join(publicDir, 'index.html'), 'utf8')).toString('base64');
const styleCssB64 = Buffer.from(fs.readFileSync(path.join(publicDir, 'style.css'), 'utf8')).toString('base64');
const appJsB64 = Buffer.from(fs.readFileSync(path.join(publicDir, 'app.js'), 'utf8')).toString('base64');

const content = `// Kryin Local File Hub - Embedded Assets
// Copyright (c) 2026 Kryin

const _d = (b64) => Buffer.from(b64, 'base64').toString('utf8');

const _assets = {
    _h: "${indexHtmlB64}",
    _s: "${styleCssB64}",
    _j: "${appJsB64}"
};

module.exports = {
    get indexHtml() { return _d(_assets._h); },
    get styleCss() { return _d(_assets._s); },
    get appJs() { return _d(_assets._j); },
    rawAssets: _assets
};
`;

fs.writeFileSync(path.join(__dirname, 'embeddedAssets.js'), content, 'utf8');
console.log('Kryin embedded assets compiled successfully.');
