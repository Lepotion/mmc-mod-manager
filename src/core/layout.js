// Maps the contents of an extracted mod onto the Cyberpunk 2077 game folder layout.
const fs = require('fs');
const path = require('path');

const KNOWN_ROOTS = ['archive', 'bin', 'r6', 'red4ext', 'engine', 'mods', 'tools'];
const SKIP_EXT = new Set([
  '.txt', '.md', '.pdf', '.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp',
  '.url', '.html', '.htm', '.nfo', '.psd', '.rtf', '.docx',
]);
const LOOSE_EXT = new Set(['.archive', '.xl', '.reds', '.yaml', '.yml', '.tweak']);

const ext = (name) => path.extname(name).toLowerCase();
const toPosix = (p) => p.split(path.sep).join('/');

function listDir(dir) {
  return fs.readdirSync(dir, { withFileTypes: true });
}

function walk(dir, base = dir, out = []) {
  for (const e of listDir(dir)) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, base, out);
    else if (e.isFile()) out.push(path.relative(base, p));
  }
  return out;
}

function hasFile(dir, name) {
  return listDir(dir).some((e) => e.isFile() && e.name.toLowerCase() === name);
}

const isKnownRoot = (name) => KNOWN_ROOTS.includes(name.toLowerCase());
const isCetMod = (dir) => hasFile(dir, 'init.lua');
const isRedMod = (dir) => hasFile(dir, 'info.json') && fs.existsSync(path.join(dir, 'archives'));

function sanitize(name) {
  return name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').trim() || 'mod';
}

// Skip wrapper folders like "MyMod-v1.2/MyMod/archive/..." until real content appears.
function findRoot(dir) {
  let cur = dir;
  for (let depth = 0; depth < 8; depth++) {
    const entries = listDir(cur).filter((e) => !(e.isFile() && SKIP_EXT.has(ext(e.name))));
    const dirs = entries.filter((e) => e.isDirectory());
    const files = entries.filter((e) => e.isFile());
    if (files.length || dirs.length !== 1 || isKnownRoot(dirs[0].name)) break;
    const next = path.join(cur, dirs[0].name);
    // Keep the folder itself so its name becomes the CET/REDmod mod folder name.
    if (isCetMod(next) || isRedMod(next)) break;
    cur = next;
  }
  return cur;
}

/**
 * @returns {{ map: {src: string, dest: string}[], skipped: string[] }}
 * dest is a game-relative POSIX path, e.g. "archive/pc/mod/foo.archive".
 */
function normalize(srcDir, modName) {
  const root = findRoot(srcDir);
  const group = sanitize(modName);
  const map = [];
  const skipped = [];
  const add = (src, dest) => map.push({ src, dest: toPosix(dest) });

  const addTree = (dir, prefix) => {
    for (const f of walk(dir)) add(path.join(dir, f), path.join(prefix, f));
  };

  const addLoose = (file, rel, groupName) => {
    const x = ext(file);
    if (SKIP_EXT.has(x)) return;
    if (x === '.archive' || x === '.xl') add(file, path.join('archive/pc/mod', path.basename(file)));
    else if (x === '.reds') add(file, path.join('r6/scripts', groupName, rel));
    else if (x === '.yaml' || x === '.yml' || x === '.tweak') add(file, path.join('r6/tweaks', groupName, rel));
    else skipped.push(toPosix(path.relative(srcDir, file)));
  };

  if (isCetMod(root)) {
    addTree(root, path.join('bin/x64/plugins/cyber_engine_tweaks/mods', group));
    return { map, skipped };
  }
  if (isRedMod(root)) {
    addTree(root, path.join('mods', group));
    return { map, skipped };
  }

  for (const e of listDir(root)) {
    const p = path.join(root, e.name);
    if (e.isDirectory()) {
      if (isKnownRoot(e.name)) addTree(p, e.name.toLowerCase());
      else if (isCetMod(p)) addTree(p, path.join('bin/x64/plugins/cyber_engine_tweaks/mods', e.name));
      else if (isRedMod(p)) addTree(p, path.join('mods', e.name));
      else for (const f of walk(p)) addLoose(path.join(p, f), f, e.name);
    } else if (e.isFile()) {
      addLoose(p, e.name, group);
    }
  }

  // Two sources landing on the same destination: last one wins.
  const seen = new Map();
  for (const m of map) seen.set(m.dest.toLowerCase(), m);
  return { map: [...seen.values()], skipped };
}

function computeTags(files) {
  const tags = new Set();
  for (const raw of files) {
    const f = raw.toLowerCase();
    if (f.startsWith('bin/x64/plugins/cyber_engine_tweaks')) tags.add('cet');
    else if (f.startsWith('archive/pc/mod/')) tags.add(f.endsWith('.xl') ? 'archivexl' : 'archive');
    else if (f.startsWith('r6/scripts/')) tags.add('redscript');
    else if (f.startsWith('r6/tweaks/')) tags.add('tweakxl');
    else if (f.startsWith('red4ext/')) tags.add('red4ext');
    else if (f.startsWith('mods/')) tags.add('redmod');
    else if (f.startsWith('bin/x64/')) tags.add('plugin');
    else if (f.startsWith('engine/')) tags.add('engine');
    else tags.add('other');
  }
  return [...tags];
}

module.exports = { normalize, computeTags, sanitize, LOOSE_EXT, walk };
