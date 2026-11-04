// Share codes, collection install (NightCoop for real, Nexus via the free-account queue) and update version checks.
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const collections = require('../src/core/collections');
const { compare } = require('../src/core/selfupdate');
const { Manager } = require('../src/core/manager');
const { Online } = require('../src/core/online');

assert.ok(compare('1.10.0', '1.9.2') > 0);
assert.ok(compare('v1.2.0', '1.2.0') === 0);
assert.ok(compare('1.2.0-beta', '1.3.0') < 0);

const mods = [
  { name: 'Codeware', enabled: true, version: '1.21.2', origin: { type: 'nexus', modId: 7780, fileId: 111 } },
  { name: 'Old Nexus zip', enabled: false, version: '1.0', origin: { type: 'nexus', modId: 4198 } },
  { name: 'NightCoop', enabled: true, origin: { type: 'nightcoop', version: '0.2.0-beta', variant: '2.5' } },
  { name: 'My local mod', enabled: true, origin: null },
];
const all = collections.build(mods, { name: 'Test set', by: 'Choom', onlyEnabled: false });
assert.strictEqual(all.count, 3);
assert.deepStrictEqual(all.skipped, ['My local mod']);
assert.ok(all.code.startsWith('MMC1-'));
const enabledOnly = collections.build(mods, { name: 'x', by: '', onlyEnabled: true });
assert.strictEqual(enabledOnly.count, 2);

const decoded = collections.decode(`  ${all.code.slice(0, 20)}\n${all.code.slice(20)}  `); // pasted with line breaks
assert.strictEqual(decoded.name, 'Test set');
assert.strictEqual(decoded.by, 'Choom');
assert.deepStrictEqual(decoded.items.map((i) => i.t), ['nx', 'nx', 'nc']);
assert.strictEqual(decoded.items[1].f, null);
assert.strictEqual(decoded.items[1].e, false);
assert.throws(() => collections.decode('hello'), /E_COLL_CODE/);
assert.throws(() => collections.decode('MMC1-AAAA'), /E_COLL_CODE/);

(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mmc-coll-'));
  const gameDir = path.join(root, 'Cyberpunk 2077');
  fs.mkdirSync(path.join(gameDir, 'bin', 'x64'), { recursive: true });
  fs.writeFileSync(path.join(gameDir, 'bin', 'x64', 'Cyberpunk2077.exe'), 'x');
  const m = new Manager(path.join(root, 'data'), 'en');
  m.setGamePath(gameDir);
  const online = new Online(m, { encrypt: (s) => `plain:${s}`, decrypt: (s) => s.slice(6), progress: () => {} });

  // Friend without a Nexus login: NightCoop installs, Nexus items report the missing login.
  const code = collections.build([mods[0], mods[2]], { name: 'c', by: '', onlyEnabled: false }).code;
  let r = await online.installCollection(code);
  assert.strictEqual(r.queued, 0);
  assert.strictEqual(r.jobs, 1, 'NightCoop became a background job');
  assert.strictEqual(r.results.find((x) => !x.ok).error, 'E_NEXUS_LOGIN');
  await online.idle();
  assert.ok(m.state.mods.find((x) => x.key === 'nightcoop'), 'NightCoop installed');
  assert.strictEqual(collections.preview(m.state.mods, collections.decode(code)).items[1].status, 'have');

  // Free account: Nexus items go to the queue, which advances as nxm:// installs arrive.
  m.state.settings.nexusUser = { name: 'Friend', premium: false };
  const two = collections.build([mods[0], { name: 'TweakXL', enabled: false, origin: { type: 'nexus', modId: 4197, fileId: 222 } }], { name: 'c', by: '', onlyEnabled: false }).code;
  r = await online.installCollection(two);
  assert.strictEqual(r.queued, 2);
  assert.deepStrictEqual(online.queue.items.map((i) => i.modId), [7780, 4197]);
  assert.strictEqual(online.onNxmInstalled(999, []), null, 'unrelated nxm install leaves the queue alone');
  assert.strictEqual(online.onNxmInstalled(7780, [{ ok: false }]).modId, 4197);
  assert.strictEqual(online.queueSkip(), null);
  assert.strictEqual(online.queue, null);

  fs.rmSync(root, { recursive: true, force: true });
  console.log('All collection tests passed');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
