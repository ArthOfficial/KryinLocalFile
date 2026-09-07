/**
 * Standalone Windows Executable (.exe) Builder
 * =========================================================================
 * Packages the entire Kryin Local File Hub server and embedded frontend assets
 * into a single, self-contained Windows binary (KryinLocalFile.exe) with
 * zero-console GUI execution.
 * =========================================================================
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT_DIR = __dirname;
const DIST_DIR = path.join(ROOT_DIR, 'dist');
const OUTPUT_EXE = path.join(ROOT_DIR, 'KryinLocalFile.exe');

console.log('========================================================');
console.log('  BUILDING STANDALONE EXECUTABLE (KryinLocalFile.exe)    ');
console.log('========================================================\n');

try {
    // 1. Compile embedded UI assets
    console.log('[1/6] Compiling embedded assets...');
    execSync('node build-assets.js', { stdio: 'inherit', cwd: ROOT_DIR });

    // 2. Ensure dist directory exists
    if (!fs.existsSync(DIST_DIR)) {
        fs.mkdirSync(DIST_DIR, { recursive: true });
    }

    // 3. Bundle entire backend + dependencies into a single JS file with esbuild
    console.log('[2/6] Bundling backend and dependencies with esbuild (minified)...');
    execSync('npx --yes esbuild server.js --bundle --minify --platform=node --target=node24 --outfile=dist/bundle.js', {
        stdio: 'inherit',
        cwd: ROOT_DIR
    });

    // 4. Generate Node SEA blob
    console.log('[3/6] Generating Single Executable Application blob...');
    execSync('node --experimental-sea-config sea-config.json', {
        stdio: 'inherit',
        cwd: ROOT_DIR
    });

    // 5. Copy Node runtime to output exe
    console.log('[4/6] Preparing binary container...');
    if (fs.existsSync(OUTPUT_EXE)) {
        try { fs.unlinkSync(OUTPUT_EXE); } catch (e) { }
    }
    fs.copyFileSync(process.execPath, OUTPUT_EXE);

    // Strip stale digital signature entry so Windows treats it as a clean unsigned binary instead of a corrupted signature
    const fdPrep = fs.openSync(OUTPUT_EXE, 'r+');
    const prepBuf = Buffer.alloc(1024);
    fs.readSync(fdPrep, prepBuf, 0, 1024, 0);
    const peOffsetPrep = prepBuf.readUInt32LE(0x3c);
    const magicPrep = prepBuf.readUInt16LE(peOffsetPrep + 24);
    const certDirOffset = peOffsetPrep + 24 + (magicPrep === 0x20b ? 112 : 96) + 4 * 8;
    fs.writeSync(fdPrep, Buffer.alloc(8, 0), 0, 8, certDirOffset);
    fs.closeSync(fdPrep);

    // 6. Inject blob into exe using postject
    console.log('[5/6] Injecting application blob into binary...');
    execSync(
        `npx --yes postject "${OUTPUT_EXE}" NODE_SEA_BLOB dist/sea-prep.blob --sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2`,
        { stdio: 'inherit', cwd: ROOT_DIR }
    );

    const stats = fs.statSync(OUTPUT_EXE);
    const sizeMb = (stats.size / (1024 * 1024)).toFixed(1);

    console.log('\n========================================================');
    console.log('  BUILD COMPLETE!');
    console.log(`  Executable: ${OUTPUT_EXE} (${sizeMb} MB)`);
    console.log('  Self-contained Windows executable ready with native console terminal.');
    console.log('========================================================\n');
} catch (error) {
    console.error('\nBuild failed:', error.message);
    process.exit(1);
}
