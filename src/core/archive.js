// Archive extraction: zip/7z through bundled 7-Zip, rar through unrar (wasm).
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const ARCHIVE_EXT = new Set(['.zip', '.7z', '.rar']);

function sevenZipPath() {
  // Inside a packaged app the binary lives in app.asar.unpacked.
  return require('7zip-bin').path7za.replace('app.asar', 'app.asar.unpacked');
}

function run7z(args) {
  return new Promise((resolve, reject) => {
    const proc = spawn(sevenZipPath(), args, { windowsHide: true });
    let stderr = '';
    proc.stderr.on('data', (d) => (stderr += d));
    proc.on('error', reject);
    // Exit code 1 means "warnings" (e.g. locked file attributes) and is fine.
    proc.on('close', (code) =>
      code <= 1 ? resolve() : reject(new Error(stderr.trim() || `7-Zip exit code ${code}`)));
  });
}

async function extract(file, dest) {
  fs.mkdirSync(dest, { recursive: true });
  if (path.extname(file).toLowerCase() === '.rar') {
    const { createExtractorFromFile } = require('node-unrar-js');
    const extractor = await createExtractorFromFile({ filepath: file, targetPath: dest });
    // Files are written lazily while iterating.
    for (const _ of extractor.extract().files);
    return;
  }
  await run7z(['x', file, `-o${dest}`, '-y', '-bso0', '-bsp0']);
}

module.exports = { extract, ARCHIVE_EXT, run7z };
