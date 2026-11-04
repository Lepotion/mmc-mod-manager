// FOMOD installs, conflict winner and the Doctor on a fake game folder.
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const { Manager } = require('../src/core/manager');
const { run7z } = require('../src/core/archive');
const doctor = require('../src/core/doctor');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mmc-feat-'));
const gameDir = path.join(root, 'Cyberpunk 2077');
const write = (p, c = 'x') => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, c); };
const read = (rel) => fs.readFileSync(path.join(gameDir, rel), 'utf8');
const exists = (rel) => fs.existsSync(path.join(gameDir, rel));

const MODULE_CONFIG = `<?xml version="1.0" encoding="UTF-16"?>
<config xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <moduleName>Test LUT</moduleName>
  <requiredInstallFiles><folder source="core" destination="" /></requiredInstallFiles>
  <installSteps order="Explicit">
    <installStep name="Look">
      <optionalFileGroups order="Explicit">
        <group name="Preset" type="SelectExactlyOne">
          <plugins order="Explicit">
            <plugin name="Preset A">
              <description>Warm</description>
              <files><file source="opts\\a.archive" destination="archive\\pc\\mod\\a.archive" /></files>
              <conditionFlags><flag name="lut">a</flag></conditionFlags>
              <typeDescriptor><type name="Recommended" /></typeDescriptor>
            </plugin>
            <plugin name="Preset B">
              <description>Cold</description>
              <files><file source="opts\\b.archive" destination="archive\\pc\\mod" /></files>
              <conditionFlags><flag name="lut">b</flag></conditionFlags>
              <typeDescriptor><type name="Optional" /></typeDescriptor>
            </plugin>
          </plugins>
        </group>
      </optionalFileGroups>
    </installStep>
    <installStep name="B extras">
      <visible><flagDependency flag="lut" value="b" /></visible>
      <optionalFileGroups>
        <group name="Extras" type="SelectAny">
          <plugins>
            <plugin name="Rain"><description>r</description>
              <files><file source="opts\\rain.archive" destination="archive\\pc\\mod\\rain.archive" /></files>
              <typeDescriptor><type name="Optional" /></typeDescriptor></plugin>
          </plugins>
        </group>
      </optionalFileGroups>
    </installStep>
  </installSteps>
  <conditionalFileInstalls><patterns>
    <pattern><dependencies operator="And"><flagDependency flag="lut" value="a" /></dependencies>
      <files><file source="opts\\a-patch.archive" destination="archive\\pc\\mod\\a-patch.archive" /></files></pattern>
  </patterns></conditionalFileInstalls>
</config>`;

(async () => {
  write(path.join(gameDir, 'bin/x64/Cyberpunk2077.exe'));
  const m = new Manager(path.join(root, 'data'), 'en');
  m.setGamePath(gameDir);

  // ----- FOMOD (UTF-16 with BOM, wrapped in a folder) -----
  const src = path.join(root, 'src', 'Test LUT');
  write(path.join(src, 'Test LUT v1/core/archive/pc/mod/core.archive'), 'core');
  for (const f of ['a', 'b', 'rain', 'a-patch']) write(path.join(src, `Test LUT v1/opts/${f}.archive`), f);
  write(path.join(src, 'Test LUT v1/fomod/ModuleConfig.xml'), Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(MODULE_CONFIG, 'utf16le')]));
  const zip = path.join(root, 'src', 'Test LUT.zip');
  await run7z(['a', zip, path.join(src, '*'), '-bso0']);

  // No prompt: recommended defaults → preset A + its conditional patch.
  let [r] = await m.importPaths([zip]);
  assert.ok(r.ok, r.error);
  let mod = m.mod(r.id);
  assert.deepStrictEqual(mod.files.sort(), ['archive/pc/mod/a-patch.archive', 'archive/pc/mod/a.archive', 'archive/pc/mod/core.archive']);
  assert.deepStrictEqual(mod.fomod.choices, ['0:0:0']);
  assert.strictEqual(read('archive/pc/mod/a.archive'), 'a');

  // The wizard picks preset B + the extra from the step that only B unlocks; A's files go away.
  const asked = [];
  m.fomodPrompt = async ({ cfg, initial }) => {
    asked.push({ steps: cfg.steps.length, initial });
    return new Set(['0:0:1', '1:0:0']);
  };
  [r] = await m.importPaths([zip]);
  assert.ok(r.ok && r.updated, r.error);
  mod = m.mod(r.id);
  assert.deepStrictEqual(asked, [{ steps: 2, initial: ['0:0:0'] }], 'previous choices are offered again');
  assert.deepStrictEqual(mod.files.sort(), ['archive/pc/mod/b.archive', 'archive/pc/mod/core.archive', 'archive/pc/mod/rain.archive']);
  assert.ok(!exists('archive/pc/mod/a.archive'));

  // Cancelling the wizard installs nothing and keeps the old version.
  m.fomodPrompt = async () => null;
  [r] = await m.importPaths([zip]);
  assert.strictEqual(r.error, 'E_FOMOD_CANCEL');
  assert.strictEqual(m.state.mods.length, 1);
  m.fomodPrompt = null;

  // ----- conflict winner -----
  const mk = (name, content) => { const d = path.join(root, 'src', name); write(path.join(d, 'archive/pc/mod/shared.archive'), content); return d; };
  const [ra, rb] = await m.importPaths([mk('Mod A', 'A'), mk('Mod B', 'B')]);
  assert.strictEqual(read('archive/pc/mod/shared.archive'), 'B');
  m.makeWinner(ra.id);
  assert.strictEqual(read('archive/pc/mod/shared.archive'), 'A');
  const info = m.getState().mods.find((x) => x.id === ra.id).conflictInfo;
  assert.deepStrictEqual(info, [{ id: rb.id, shared: 1, mine: 1 }]);
  m.disable(ra.id);
  assert.strictEqual(read('archive/pc/mod/shared.archive'), 'B', 'file goes back to the other mod');
  m.enable(ra.id);

  // ----- doctor -----
  const sd = path.join(root, 'src', 'ScriptMod');
  write(path.join(sd, 'r6/scripts/ScriptMod/main.reds'), 'x');
  await m.importPaths([sd]);
  write(path.join(gameDir, 'r6/logs/redscript_rCURRENT.log'), [
    '[INFO - Mon, 3 Nov 2026 10:00:00] Compiling 12 files',
    '[ERROR - Mon, 3 Nov 2026 10:00:01] At r6\\scripts\\ScriptMod\\main.reds:12:4: unresolved reference Foo',
    '[ERROR - Mon, 3 Nov 2026 10:00:02] At r6\\scripts\\ScriptMod\\main.reds:12:4: unresolved reference Foo',
    '[INFO - Mon, 3 Nov 2026 10:00:03] Done with 0 errors? no — summary line',
  ].join('\n'));
  write(path.join(gameDir, 'red4ext/logs/red4ext.log'), '[2026-11-03 10:00:00] [RED4ext] [error] Something unknown happened\n[2026-11-03 10:00:00] [RED4ext] [warning] meh\n');
  const res = doctor.run(m);
  const logMod = res.issues.find((i) => i.kind === 'logMod');
  assert.ok(logMod, JSON.stringify(res.issues));
  assert.strictEqual(m.mod(logMod.mod).name, 'ScriptMod');
  assert.strictEqual(logMod.lines.length, 1, 'repeated lines are merged');
  assert.strictEqual(logMod.lines[0].count, 2);
  assert.ok(res.issues.find((i) => i.kind === 'logOther' && i.logName === 'RED4ext'));
  assert.ok(res.issues.find((i) => i.kind === 'missing' && m.mod(i.mod).name === 'ScriptMod'), 'redscript not installed');
  assert.ok(res.issues.find((i) => i.kind === 'conflict'));
  const rl = res.logs.find((l) => l.name === 'RED4ext');
  assert.strictEqual(rl.errorCount, 1);
  assert.strictEqual(rl.warnCount, 1);

  // ----- culprit finder -----
  const fwDir = path.join(root, 'src', 'RED4ext');
  write(path.join(fwDir, 'red4ext/RED4ext.dll'), 'fw');
  const suspectDirs = ['S1', 'S2', 'S3', 'S4', 'S5'].map((n) => {
    const d = path.join(root, 'src', n);
    write(path.join(d, `archive/pc/mod/${n}.archive`), n);
    return d;
  });
  const [fw] = await m.importPaths([fwDir, ...suspectDirs]);
  const fwId = fw.id;
  const culprit = m.state.mods.find((x) => x.name === 'S4').id;
  const before = m.state.mods.filter((x) => x.enabled).map((x) => x.id).sort();
  m.bisectStart();
  let rounds = 0;
  while (!m.state.bisect.culprit) {
    assert.ok(m.mod(fwId).enabled, 'framework stays on');
    m.bisectAnswer(m.mod(culprit).enabled);
    assert.ok(++rounds < 10);
  }
  assert.strictEqual(m.state.bisect.culprit, culprit);
  assert.deepStrictEqual(m.state.mods.filter((x) => x.enabled).map((x) => x.id).sort(), before, 'mods are back as they were');
  m.bisectEnd(true);
  assert.ok(!m.mod(culprit).enabled);
  assert.strictEqual(m.state.bisect, null);

  // ----- history -----
  const age = () => { const h = m.state.history; h[h.length - 1].at -= 10000; };
  age();
  const snapshotBefore = m.state.history[m.state.history.length - 1].id;
  m.disable(fwId);
  age();
  const hist = m.getState().history;
  assert.deepStrictEqual(hist[0].off, ['RED4ext']);
  m.restoreHistory(snapshotBefore);
  assert.ok(m.mod(fwId).enabled, 'rollback re-enabled the mod');

  // ----- collections: a local mod with a Nexus link is shared -----
  const collections = require('../src/core/collections');
  m.update(culprit, { nexusUrl: 'https://www.nexusmods.com/cyberpunk2077/mods/4198' });
  const built = collections.build(m.state.mods, { name: 'x', by: '', onlyEnabled: false });
  assert.ok(collections.decode(built.code).items.some((it) => it.id === 4198));

  fs.rmSync(root, { recursive: true, force: true });
  console.log('All feature tests passed');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
