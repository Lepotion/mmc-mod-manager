// Streams a URL to disk with progress, cancellation (AbortSignal) and an optional SHA-256 check.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

async function download(url, dest, { headers = {}, onProgress = () => {}, sha256, signal } = {}) {
  let res;
  try {
    res = await fetch(url, { headers, redirect: 'follow', signal });
  } catch (e) {
    if (signal?.aborted) throw new Error('E_CANCELED');
    throw e;
  }
  if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
  const total = Number(res.headers.get('content-length')) || 0;
  fs.mkdirSync(path.dirname(dest), { recursive: true });

  const out = fs.createWriteStream(dest);
  const hash = crypto.createHash('sha256');
  let received = 0;
  let lastReport = 0;
  try {
    for await (const chunk of res.body) {
      hash.update(chunk);
      received += chunk.length;
      if (!out.write(chunk)) await new Promise((r) => out.once('drain', r));
      if (Date.now() - lastReport > 120) {
        lastReport = Date.now();
        onProgress(received, total);
      }
    }
  } catch (e) {
    await new Promise((r) => out.end(r));
    fs.rmSync(dest, { force: true });
    if (signal?.aborted) throw new Error('E_CANCELED');
    throw e;
  }
  await new Promise((r) => out.end(r));
  onProgress(received, total);

  if (sha256 && hash.digest('hex') !== sha256.toLowerCase()) {
    fs.rmSync(dest, { force: true });
    throw new Error('E_CHECKSUM');
  }
  return dest;
}

module.exports = { download };
