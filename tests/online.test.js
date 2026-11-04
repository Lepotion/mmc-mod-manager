// Nexus helpers (offline) and a real NightCoop download + install into a fake game folder.
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const nexus = require('../src/core/nexus');
const { Manager } = require('../src/core/manager');
const { Online, MAX_PARALLEL } = require('../src/core/online');

const n = nexus.parseNxm('nxm://cyberpunk2077/mods/107/files/98765?key=abc&expires=1700000000&user_id=42');
assert.deepStrictEqual(n, { game: 'cyberpunk2077', modId: 107, fileId: 98765, key: 'abc', expires: '1700000000' });
assert.throws(() => nexus.parseNxm('nxm://cyberpunk2077/collections/x'), /E_NXM_LINK/);
assert.deepStrictEqual(nexus.parseModRef('https://www.nexusmods.com/cyberpunk2077/mods/4198?tab=files&file_id=55'), { modId: 4198, fileId: 55 });
assert.deepStrictEqual(nexus.parseModRef(' 2380 '), { modId: 2380, fileId: null });
assert.throws(() => nexus.parseModRef('hello'), /E_NEXUS_REF/);

const files = { files: [{ file_id: 1 }, { file_id: 2 }, { file_id: 3, version: '1.3' }], file_updates: [{ old_file_id: 1, new_file_id: 2 }, { old_file_id: 2, new_file_id: 3 }] };
assert.strictEqual(nexus.newestFile(files, 1).file_id, 3);
assert.strictEqual(nexus.newestFile(files, 3).file_id, 3);

(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mmc-online-'));
  const gameDir = path.join(root, 'Cyberpunk 2077');
  fs.mkdirSync(path.join(gameDir, 'bin', 'x64'), { recursive: true });
  fs.writeFileSync(path.join(gameDir, 'bin', 'x64', 'Cyberpunk2077.exe'), 'x');

  const m = new Manager(path.join(root, 'data'), 'en');
  m.setGamePath(gameDir);
  const events = [];
  const online = new Online(m, { encrypt: (s) => `plain:${s}`, decrypt: (s) => s.slice(6), jobsChanged: (jobs) => events.push(...jobs.map((j) => j.status)) });

  const feed = await online.ncReleases();
  const oldest = feed.releases[feed.releases.length - 1];
  const latest = feed.releases.find((r) => r.version === feed.latest);

  // Old build first, then update to the latest: must replace, not duplicate.
  let res = await online.ncInstall(oldest.version, '2.5');
  assert.ok(res[0].ok, res[0].error);
  res = await online.ncInstall(latest.version, '2.5');
  assert.ok(res[0].ok, res[0].error);
  assert.ok(res[0].updated);

  const ncMods = m.state.mods.filter((x) => x.key === 'nightcoop');
  assert.strictEqual(ncMods.length, 1);
  const mod = ncMods[0];
  assert.strictEqual(mod.origin.version, latest.version);
  assert.strictEqual(mod.origin.variant, '2.5');
  assert.ok(mod.enabled);
  assert.ok(events.includes('downloading') && events.includes('done'), 'job status reported');
  assert.ok(fs.existsSync(path.join(gameDir, 'red4ext', 'RED4ext.dll')), 'RED4ext from the archive is deployed');
  assert.ok(mod.files.every((f) => /^(bin|red4ext|r6)\//.test(f)), 'files land under bin/, red4ext/ and r6/');
  assert.deepStrictEqual(m.getState().mods.find((x) => x.key === 'nightcoop').missing, [], 'NightCoop is self-contained');
  console.log(`NightCoop ${latest.version}: ${mod.files.length} files deployed`);

  // Background jobs: cancelling a download leaves nothing behind.
  const before = m.state.mods.length;
  const job = await online.ncJob(oldest.version, '2.5');
  setTimeout(() => online.cancelJob(job.id), 50);
  await assert.rejects(online.finished(job), /E_CANCELED/);
  assert.strictEqual(job.status, 'canceled');
  assert.strictEqual(m.state.mods.length, before);
  assert.strictEqual(m.state.mods.find((x) => x.key === 'nightcoop').origin.version, latest.version, 'installed build untouched');

  // At most MAX_PARALLEL downloads at once; the rest wait.
  let running = 0;
  let peak = 0;
  const slow = () => online.startJob({
    name: 'slow',
    kind: 'test',
    prepare: async () => {
      running++;
      peak = Math.max(peak, running);
      await new Promise((r) => setTimeout(r, 150));
      running--;
      throw new Error('E_TEST');
    },
  });
  const jobs = Array.from({ length: 7 }, slow);
  await online.idle();
  assert.strictEqual(peak, MAX_PARALLEL);
  assert.ok(jobs.every((j) => j.status === 'error' && j.error === 'E_TEST'));

  fs.rmSync(root, { recursive: true, force: true });
  console.log('All online tests passed');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
