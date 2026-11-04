// Mod storage, deployment into the game folder, conflicts, backups and profiles.
//
// Mods are staged in <storage>/<id>/files using the game folder layout. Enabling a mod
// copies its files into the game; `deployed` remembers which mod owns each game file,
// and vanilla/unmanaged files that get overwritten are moved to `backups` first.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { normalize, computeTags, LOOSE_EXT, walk } = require('./layout');
const { extract, ARCHIVE_EXT } = require('./archive');
const fomod = require('./fomod');
const fomodLogic = require('../shared/fomod-logic');
const game = require('./game');

const PROTECTED_DIRS = new Set([
  'archive', 'archive/pc', 'archive/pc/mod', 'archive/pc/content', 'bin', 'bin/x64', 'bin/x64/plugins',
  'bin/x64/plugins/cyber_engine_tweaks', 'bin/x64/plugins/cyber_engine_tweaks/mods', 'r6', 'r6/scripts',
  'r6/tweaks', 'r6/cache', 'r6/config', 'red4ext', 'red4ext/plugins', 'engine', 'engine/config',
  'engine/tools', 'mods',
]);

const newId = () => Date.now().toString(36) + crypto.randomBytes(3).toString('hex');
const keyOf = (rel) => rel.toLowerCase();

function moveFile(src, dest) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  try {
    fs.renameSync(src, dest);
  } catch {
    // Different drives: copy + delete.
    fs.copyFileSync(src, dest);
    fs.unlinkSync(src);
  }
}

// "Better Lighting-1234-1-2-1700000000" -> name, Nexus id and version.
function parseNexusName(base) {
  const m = base.match(/^(.+?)-(\d{3,})-([\w-]+?)-(\d{9,11})$/);
  if (!m) return { name: base.replace(/[_]+/g, ' ').trim(), version: '', nexusId: null };
  return { name: m[1].replace(/[_]+/g, ' ').trim(), version: m[3].replace(/-/g, '.'), nexusId: Number(m[2]) };
}

class Manager {
  constructor(dataDir, defaultLanguage = 'en') {
    this.dataDir = dataDir;
    this.statePath = path.join(dataDir, 'state.json');
    this.defaultLanguage = defaultLanguage;
    this.load();
  }

  get storageDir() { return this.state.settings.storagePath || path.join(this.dataDir, 'mods'); }
  get backupDir() { return path.join(this.dataDir, 'backups'); }
  get tmpDir() { return path.join(this.dataDir, 'tmp'); }
  get gameDir() { return this.state.settings.gamePath; }
  mod(id) {
    const m = this.state.mods.find((x) => x.id === id);
    if (!m) throw new Error('E_NO_MOD');
    return m;
  }
  modFile(mod, rel) { return path.join(this.storageDir, mod.id, 'files', rel); }

  load() {
    const defaults = {
      settings: { gamePath: '', language: this.defaultLanguage, storagePath: '', autoEnable: true, confirmDelete: true },
      mods: [],
      deployed: {},
      backups: {},
      profiles: [],
    };
    let saved = {};
    try { saved = JSON.parse(fs.readFileSync(this.statePath, 'utf8')); } catch {}
    this.state = { ...defaults, ...saved, settings: { ...defaults.settings, ...(saved.settings || {}) } };
  }

  save() {
    this.recordHistory();
    fs.mkdirSync(this.dataDir, { recursive: true });
    const tmp = this.statePath + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(this.state, null, 2));
    fs.renameSync(tmp, this.statePath);
  }

  // ---------- state for the UI ----------

  getState() {
    const frameworks = game.frameworkStatus(this.gameDir);
    const installed = new Set(frameworks.filter((f) => f.installed).map((f) => f.id));
    const owners = new Map(); // file key -> mod ids that ship it
    for (const m of this.state.mods) {
      for (const f of m.files) {
        const k = keyOf(f);
        if (!owners.has(k)) owners.set(k, []);
        owners.get(k).push(m.id);
      }
    }

    const mods = this.state.mods.map((m) => {
      const tags = computeTags(m.files);
      // Per conflicting mod: how many files we share and how many of them this mod currently wins.
      const shared = new Map();
      for (const f of m.files) {
        const k = keyOf(f);
        for (const o of owners.get(k)) {
          if (o === m.id) continue;
          const s = shared.get(o) || { id: o, shared: 0, mine: 0 };
          s.shared++;
          if (this.state.deployed[k] === m.id) s.mine++;
          shared.set(o, s);
        }
      }
      const conflicts = new Set(shared.keys());
      const provides = new Set(frameworks.filter((fw) => m.files.some((f) => keyOf(f) === fw.file.toLowerCase())).map((fw) => fw.id));
      // NightCoop ships its own RED4ext; its redscript part is an optional Let There Be Flight bridge.
      const requires = m.origin?.type === 'nightcoop'
        ? []
        : [...new Set(tags.map((t) => game.TAG_REQUIRES[t]).filter(Boolean))].filter((r) => !provides.has(r));
      const { files, ...rest } = m;
      return {
        ...rest,
        fileCount: files.length,
        tags,
        conflicts: [...conflicts],
        conflictInfo: [...shared.values()],
        requires,
        missing: requires.filter((r) => !installed.has(r)),
      };
    });

    const requiredBy = {};
    for (const m of mods) for (const r of m.requires) requiredBy[r] = (requiredBy[r] || 0) + 1;

    const { nexusKey, ...settings } = this.state.settings;
    return {
      settings,
      storageDir: this.storageDir,
      game: {
        valid: game.isGameDir(this.gameDir),
        path: this.gameDir,
        store: this.gameDir ? game.detectStore(this.gameDir) : null,
        unmanaged: this.unmanagedFiles().length,
      },
      mods,
      frameworks: frameworks.map((f) => ({ ...f, requiredBy: requiredBy[f.id] || 0 })),
      profiles: this.state.profiles,
      history: (this.state.history || []).slice().reverse().map((h) => ({ id: h.id, at: h.at, count: h.enabled.length, on: h.on, off: h.off })),
      bisect: this.state.bisect,
    };
  }

  setSettings(patch) {
    const allowed = ['language', 'autoEnable', 'confirmDelete', 'ncVariant', 'onboarded', 'autoModUpdates'];
    for (const k of allowed) if (k in patch) this.state.settings[k] = patch[k];
    this.save();
  }

  // Moves deployed mods to the new game folder.
  setGamePath(dir) {
    const resolved = game.resolveGameDir(dir);
    if (!resolved) throw new Error('E_NOT_GAME_DIR');
    if (this.gameDir && path.resolve(this.gameDir).toLowerCase() === resolved.toLowerCase()) return;
    const active = this.enabledInOrder();
    if (game.isGameDir(this.gameDir)) for (const m of [...active].reverse()) this.disable(m.id);
    else this.forgetDeployment();
    this.state.settings.gamePath = resolved;
    for (const m of active) this.enable(m.id);
    this.save();
  }

  forgetDeployment() {
    this.state.deployed = {};
    this.state.backups = {};
    for (const m of this.state.mods) m.enabled = false;
  }

  enabledInOrder() {
    return this.state.mods.filter((m) => m.enabled).sort((a, b) => a.enabledAt - b.enabledAt);
  }

  // ---------- import ----------

  // `overrides` carries metadata from online sources: name, version, author, nexusUrl,
  // key (stable identity used to find the previous install) and origin.
  async importPaths(paths, onProgress = () => {}, overrides = {}) {
    const results = [];
    for (let i = 0; i < paths.length; i++) {
      const name = overrides.name || path.basename(paths[i]);
      onProgress({ phase: 'import', i, n: paths.length, name });
      try {
        results.push({ ok: true, ...(await this.importOne(paths[i], overrides)) });
      } catch (e) {
        results.push({ ok: false, file: name, error: e.message });
      } finally {
        this.save();
      }
    }
    onProgress({ phase: 'done', i: paths.length, n: paths.length });
    return results;
  }

  async importOne(src, overrides = {}) {
    const stat = fs.statSync(src);
    const base = path.basename(src);
    const x = path.extname(base).toLowerCase();
    const meta = parseNexusName(stat.isDirectory() ? base : base.slice(0, base.length - x.length));
    if (overrides.name) meta.name = overrides.name;
    if (overrides.version) meta.version = overrides.version;
    const id = newId();
    const tmp = path.join(this.tmpDir, id);
    const staging = `${tmp}-fomod`;

    // Same name or same source already installed: treat as an update and keep user data.
    const key = overrides.key || (meta.nexusId ? `nexus:${meta.nexusId}` : null);
    const prev =
      (key && this.state.mods.find((m) => m.key === key)) ||
      this.state.mods.find((m) => m.name.toLowerCase() === meta.name.toLowerCase());

    try {
      let root = src;
      if (!stat.isDirectory()) {
        if (ARCHIVE_EXT.has(x)) {
          await extract(src, tmp);
        } else if (LOOSE_EXT.has(x)) {
          fs.mkdirSync(tmp, { recursive: true });
          fs.copyFileSync(src, path.join(tmp, base));
        } else {
          throw new Error('E_UNSUPPORTED');
        }
        root = tmp;
      }

      // FOMOD installer: ask which options to install (or reuse known choices), then stage them.
      let fomodChoices = null;
      const found = fomod.findFomod(root);
      if (found) {
        const cfg = fomod.parseFomod(found.configPath);
        const fileState = (f) => (game.isGameDir(this.gameDir) && fs.existsSync(path.join(this.gameDir, f)) ? 'Active' : 'Missing');
        let selected;
        if (overrides.fomodChoices) selected = new Set(overrides.fomodChoices);
        else if (this.fomodPrompt) {
          selected = await this.fomodPrompt({ cfg, base: found.base, name: meta.name, initial: prev?.fomod?.choices || null, fileState });
          if (!selected) throw new Error('E_FOMOD_CANCEL');
        } else selected = fomodLogic.autoSelect(cfg, fileState);
        fomod.stage(cfg, found.base, selected, fileState, staging);
        fomodChoices = [...selected];
        root = staging;
      }

      const { map, skipped } = normalize(root, meta.name);
      if (!map.length) throw new Error('E_NO_FILES');

      const filesDir = path.join(this.storageDir, id, 'files');
      let size = 0;
      for (const { src: from, dest } of map) {
        const to = path.join(filesDir, dest);
        fs.mkdirSync(path.dirname(to), { recursive: true });
        fs.copyFileSync(from, to);
        size += fs.statSync(to).size;
      }

      const mod = {
        id,
        key,
        origin: overrides.origin || (meta.nexusId ? { type: 'nexus', modId: meta.nexusId } : null),
        name: prev && !overrides.name ? prev.name : meta.name,
        version: meta.version || '',
        author: overrides.author || prev?.author || '',
        nexusUrl: overrides.nexusUrl || (meta.nexusId ? `https://www.nexusmods.com/cyberpunk2077/mods/${meta.nexusId}` : prev?.nexusUrl || ''),
        notes: prev?.notes || '',
        source: base,
        installedAt: Date.now(),
        enabled: false,
        enabledAt: 0,
        size,
        skipped: skipped.slice(0, 50),
        fomod: fomodChoices ? { choices: fomodChoices } : null,
        files: map.map((m) => m.dest),
      };

      const wasEnabled = prev?.enabled;
      if (prev) {
        for (const p of this.state.profiles) p.mods = p.mods.map((m) => (m === prev.id ? id : m));
        this.remove(prev.id);
      }
      this.state.mods.push(mod);
      if ((wasEnabled ?? this.state.settings.autoEnable) && game.isGameDir(this.gameDir)) this.enable(id);
      return { id, name: mod.name, updated: !!prev };
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
      fs.rmSync(staging, { recursive: true, force: true });
    }
  }

  // ---------- deployment ----------

  enable(id) {
    const mod = this.mod(id);
    if (mod.enabled) return;
    if (!game.isGameDir(this.gameDir)) throw new Error('E_NO_GAME');
    const { deployed, backups } = this.state;
    for (const rel of mod.files) {
      const k = keyOf(rel);
      const dest = path.join(this.gameDir, rel);
      if (!deployed[k] && fs.existsSync(dest)) {
        moveFile(dest, path.join(this.backupDir, rel));
        backups[k] = rel;
      }
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.copyFileSync(this.modFile(mod, rel), dest);
      deployed[k] = mod.id;
    }
    mod.enabled = true;
    mod.enabledAt = Date.now();
    this.save();
  }

  disable(id) {
    const mod = this.mod(id);
    if (!mod.enabled) return;
    const { deployed, backups } = this.state;
    const others = this.enabledInOrder().filter((m) => m.id !== id).reverse();
    for (const rel of mod.files) {
      const k = keyOf(rel);
      if (deployed[k] !== id) continue;
      const dest = path.join(this.gameDir, rel);
      fs.rmSync(dest, { force: true });
      // Hand the file back to the most recently enabled mod that also ships it.
      const next = others.find((m) => m.files.some((f) => keyOf(f) === k));
      if (next) {
        fs.copyFileSync(this.modFile(next, next.files.find((f) => keyOf(f) === k)), dest);
        deployed[k] = next.id;
        continue;
      }
      delete deployed[k];
      if (backups[k]) {
        const backup = path.join(this.backupDir, backups[k]);
        if (fs.existsSync(backup)) moveFile(backup, dest);
        delete backups[k];
      } else {
        this.pruneEmptyDirs(path.dirname(rel));
      }
    }
    mod.enabled = false;
    this.save();
  }

  pruneEmptyDirs(relDir) {
    let rel = relDir.split(path.sep).join('/');
    while (rel && rel !== '.' && !PROTECTED_DIRS.has(rel.toLowerCase())) {
      const abs = path.join(this.gameDir, rel);
      try {
        if (fs.readdirSync(abs).length) return;
        fs.rmdirSync(abs);
      } catch {
        return;
      }
      rel = path.posix.dirname(rel);
    }
  }

  // Puts this mod's version of every shared file into the game and makes it the newest
  // (so it also keeps winning when other mods get toggled later).
  makeWinner(id) {
    const mod = this.mod(id);
    if (!mod.enabled) return this.enable(id);
    for (const rel of mod.files) {
      const k = keyOf(rel);
      if (this.state.deployed[k] === id) continue;
      const dest = path.join(this.gameDir, rel);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.copyFileSync(this.modFile(mod, rel), dest);
      this.state.deployed[k] = id;
    }
    mod.enabledAt = Date.now();
    this.save();
  }

  setEnabled(id, on) {
    on ? this.enable(id) : this.disable(id);
  }

  setAll(on) {
    if (on) for (const m of this.state.mods.filter((m) => !m.enabled)) this.enable(m.id);
    else for (const m of this.enabledInOrder().reverse()) this.disable(m.id);
  }

  update(id, patch) {
    const mod = this.mod(id);
    for (const k of ['name', 'version', 'notes', 'nexusUrl']) if (typeof patch[k] === 'string') mod[k] = patch[k].slice(0, 5000);
    if (!mod.name.trim()) mod.name = mod.source;
    this.save();
  }

  remove(id) {
    const mod = this.mod(id);
    if (mod.enabled) this.disable(id);
    fs.rmSync(path.join(this.storageDir, id), { recursive: true, force: true });
    this.state.mods = this.state.mods.filter((m) => m.id !== id);
    for (const p of this.state.profiles) p.mods = p.mods.filter((m) => m !== id);
    this.save();
  }

  files(id) {
    return this.mod(id).files;
  }

  modFolder(id) {
    return path.join(this.storageDir, this.mod(id).id, 'files');
  }

  // Game files in archive/pc/mod that were not installed through the manager.
  unmanagedFiles() {
    if (!game.isGameDir(this.gameDir)) return [];
    const dir = path.join(this.gameDir, 'archive', 'pc', 'mod');
    if (!fs.existsSync(dir)) return [];
    return walk(dir).map((f) => `archive/pc/mod/${f.split(path.sep).join('/')}`).filter((f) => !this.state.deployed[keyOf(f)]);
  }

  // ---------- history ----------

  // Remembers every change of the enabled set. Bursts (enable all, a profile, a rollback)
  // within a few seconds become one entry. Paused while the culprit finder is switching mods.
  recordHistory() {
    if (this.state.bisect && !this.state.bisect.culprit) return;
    const enabled = this.state.mods.filter((m) => m.enabled).map((m) => m.id).sort();
    const h = (this.state.history ||= []);
    const last = h[h.length - 1];
    if (last && last.enabled.join() === enabled.join()) return;
    const now = Date.now();
    const merge = last && h.length > 1 && now - last.at < 4000;
    const base = merge ? h[h.length - 2] : last;
    const name = (id) => this.state.mods.find((m) => m.id === id)?.name || '?';
    const diff = base
      ? { on: enabled.filter((id) => !base.enabled.includes(id)).map(name), off: base.enabled.filter((id) => !enabled.includes(id)).map((id) => base.names?.[id] || name(id)) }
      : { on: [], off: [] };
    // Names of the enabled mods, so entries stay readable after a mod is deleted.
    const names = Object.fromEntries(enabled.map((id) => [id, name(id)]));
    const entry = { id: merge ? last.id : newId(), at: now, enabled, names, ...diff };
    if (merge) h[h.length - 1] = entry;
    else h.push(entry);
    if (h.length > 60) h.splice(0, h.length - 60);
  }

  // Enables exactly these mods (in this order), disables the rest.
  applySet(ids) {
    const want = new Set(ids);
    for (const m of this.enabledInOrder().reverse()) if (!want.has(m.id)) this.disable(m.id);
    for (const id of ids) if (this.state.mods.some((m) => m.id === id)) this.enable(id);
  }

  restoreHistory(id) {
    const entry = (this.state.history || []).find((h) => h.id === id);
    if (!entry) throw new Error('E_NO_MOD');
    this.applySet(entry.enabled);
    this.save();
  }

  // ---------- culprit finder ----------
  //
  // Halves the enabled mods each round: the user launches the game and says whether the problem
  // is still there. Frameworks always stay on, since other mods depend on them.

  frameworkModIds() {
    const fw = new Set(game.FRAMEWORKS.map((f) => f.file.toLowerCase()));
    return this.state.mods.filter((m) => m.files.some((f) => fw.has(f.toLowerCase()))).map((m) => m.id);
  }

  bisectStart() {
    if (this.state.bisect) throw new Error('E_BISECT_RUNNING');
    const original = this.enabledInOrder().map((m) => m.id);
    const fw = new Set(this.frameworkModIds());
    const always = original.filter((id) => fw.has(id));
    const candidates = original.filter((id) => !fw.has(id));
    if (candidates.length < 2) throw new Error('E_BISECT_FEW');
    const testing = candidates.slice(0, Math.ceil(candidates.length / 2));
    this.state.bisect = { original, always, candidates, testing, round: 1, rounds: Math.ceil(Math.log2(candidates.length)), culprit: null };
    this.applySet([...always, ...testing]);
    this.save();
  }

  bisectAnswer(problem) {
    const b = this.state.bisect;
    if (!b || b.culprit) return;
    b.candidates = problem ? b.testing : b.candidates.filter((id) => !b.testing.includes(id));
    if (b.candidates.length <= 1) {
      b.culprit = b.candidates[0] || null;
      this.applySet(b.original);
    } else {
      b.testing = b.candidates.slice(0, Math.ceil(b.candidates.length / 2));
      b.round++;
      this.applySet([...b.always, ...b.testing]);
    }
    this.save();
  }

  // Back to the mods that were on before the search; optionally leaves the culprit off.
  bisectEnd(disableCulprit = false) {
    const b = this.state.bisect;
    if (!b) return;
    this.applySet(b.original);
    this.state.bisect = null;
    if (disableCulprit && b.culprit && this.state.mods.some((m) => m.id === b.culprit)) this.disable(b.culprit);
    this.save();
  }

  // ---------- profiles ----------

  createProfile(name) {
    this.state.profiles.push({ id: newId(), name: String(name).slice(0, 80), mods: this.enabledInOrder().map((m) => m.id), createdAt: Date.now() });
    this.save();
  }

  updateProfile(id) {
    const p = this.state.profiles.find((x) => x.id === id);
    if (p) p.mods = this.enabledInOrder().map((m) => m.id);
    this.save();
  }

  applyProfile(id) {
    const p = this.state.profiles.find((x) => x.id === id);
    if (p) this.applySet(p.mods);
  }

  deleteProfile(id) {
    this.state.profiles = this.state.profiles.filter((p) => p.id !== id);
    this.save();
  }
}

module.exports = { Manager, parseNexusName };
