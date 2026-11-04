// End-to-end check of import / enable / disable / conflicts / backups on a fake game folder.
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const { Manager, parseNexusName } = require('../src/core/manager');
const { run7z } = require('../src/core/archive');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cp77mm-test-'));
const gameDir = path.join(root, 'Cyberpunk 2077');
const dataDir = path.join(root, 'data');
const srcDir = path.join(root, 'src');

function write(p, content = 'x') {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content);
}
const exists = (rel) => fs.existsSync(path.join(gameDir, rel));
const read = (rel) => fs.readFileSync(path.join(gameDir, rel), 'utf8');

async function zip(name, files) {
  const dir = path.join(srcDir, name);
  for (const [rel, content] of Object.entries(files)) write(path.join(dir, rel), content);
  const out = path.join(srcDir, `${name}.zip`);
  await run7z(['a', out, path.join(dir, '*'), '-bso0']);
  return out;
}

(async () => {
  write(path.join(gameDir, 'bin/x64/Cyberpunk2077.exe'));
  write(path.join(gameDir, 'r6/config/inputUserMappings.xml'), 'vanilla');

  // Loose .archive files wrapped in a folder, Nexus-style name.
  const a = await zip('Better Lights-1234-1-2-1700000000', { 'Better Lights/better_lights.archive': 'A1', 'Better Lights/readme.txt': 'r' });
  // Proper layout + overwrites a vanilla file.
  const b = await zip('Input Fix', { 'r6/config/inputUserMappings.xml': 'modded', 'archive/pc/mod/better_lights.archive': 'B1' });
  // CET mod (folder with init.lua) and loose redscript.
  const c = await zip('Cool CET Mod', { 'CoolMod/init.lua': 'print(1)', 'CoolMod/data/x.json': '{}' });
  const d = await zip('ScriptOnly', { 'thing.reds': 'module A' });
  const bad = await zip('Empty', { 'readme.md': 'nothing' });

  const m = new Manager(dataDir, 'en');
  m.setGamePath(path.join(gameDir, 'bin', 'x64')); // resolves up to the root
  assert.strictEqual(m.gameDir, gameDir);

  const res = await m.importPaths([a, b, c, d, bad]);
  assert.deepStrictEqual(res.map((r) => r.ok), [true, true, true, true, false]);
  assert.strictEqual(res[4].error, 'E_NO_FILES');

  const [ma, mb, mc, md] = res.slice(0, 4).map((r) => m.mod(r.id));
  assert.strictEqual(ma.name, 'Better Lights');
  assert.strictEqual(ma.version, '1.2');
  assert.ok(ma.nexusUrl.endsWith('/1234'));
  assert.deepStrictEqual(ma.files, ['archive/pc/mod/better_lights.archive']);
  assert.deepStrictEqual(mc.files.sort(), ['bin/x64/plugins/cyber_engine_tweaks/mods/CoolMod/data/x.json', 'bin/x64/plugins/cyber_engine_tweaks/mods/CoolMod/init.lua']);
  assert.deepStrictEqual(md.files, ['r6/scripts/ScriptOnly/thing.reds']);

  // autoEnable: everything is deployed, b (enabled later) wins the conflict.
  assert.strictEqual(read('archive/pc/mod/better_lights.archive'), 'B1');
  assert.strictEqual(read('r6/config/inputUserMappings.xml'), 'modded');
  assert.ok(exists('bin/x64/plugins/cyber_engine_tweaks/mods/CoolMod/init.lua'));

  const st = m.getState();
  const sa = st.mods.find((x) => x.id === ma.id);
  assert.deepStrictEqual(sa.conflicts, [mb.id]);
  assert.deepStrictEqual(st.mods.find((x) => x.id === mc.id).missing, ['cet']);

  // Disabling the winner hands the file back to the other mod and restores vanilla.
  m.disable(mb.id);
  assert.strictEqual(read('archive/pc/mod/better_lights.archive'), 'A1');
  assert.strictEqual(read('r6/config/inputUserMappings.xml'), 'vanilla');

  // Profiles.
  m.createProfile('Lights only');
  m.setAll(false);
  assert.ok(!exists('archive/pc/mod/better_lights.archive'));
  assert.ok(!exists('bin/x64/plugins/cyber_engine_tweaks/mods/CoolMod'), 'empty CET mod folder is pruned');
  assert.ok(!exists('r6/scripts/ScriptOnly'));
  assert.ok(exists('r6/config/inputUserMappings.xml'), 'vanilla file untouched');
  m.applyProfile(m.state.profiles[0].id);
  assert.deepStrictEqual(m.state.mods.filter((x) => x.enabled).map((x) => x.id).sort(), [ma.id, mc.id, md.id].sort());

  // Re-importing the same name updates in place and keeps it enabled.
  m.update(ma.id, { notes: 'keep me' });
  const again = await m.importPaths([a]);
  assert.ok(again[0].updated);
  const updated = m.mod(again[0].id);
  assert.strictEqual(updated.notes, 'keep me');
  assert.ok(updated.enabled);
  assert.ok(m.state.profiles[0].mods.includes(updated.id));

  // Delete removes files and staging.
  m.remove(updated.id);
  assert.ok(!exists('archive/pc/mod/better_lights.archive'));
  assert.ok(!fs.existsSync(path.join(m.storageDir, updated.id)));

  // State survives a reload.
  const m2 = new Manager(dataDir, 'en');
  assert.strictEqual(m2.state.mods.length, 3);

  fs.rmSync(root, { recursive: true, force: true });
  console.log('All core tests passed');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
