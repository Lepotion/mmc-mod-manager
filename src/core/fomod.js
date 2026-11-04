// Reads fomod/ModuleConfig.xml into a plain model and copies the chosen files into a staging folder.
const fs = require('fs');
const path = require('path');
const { XMLParser } = require('fast-xml-parser');
const logic = require('../shared/fomod-logic');

const arr = (x) => (x == null ? [] : Array.isArray(x) ? x : [x]);
const text = (x) => (typeof x === 'string' ? x : x?.['#text'] ?? '');
const norm = (p) => String(p ?? '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');

// Finds the folder that holds fomod/ModuleConfig.xml (archives often wrap it in one or two folders).
function findFomod(root, depth = 3) {
  const queue = [{ dir: root, d: 0 }];
  while (queue.length) {
    const { dir, d } = queue.shift();
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    const fomodDir = entries.find((e) => e.isDirectory() && e.name.toLowerCase() === 'fomod');
    if (fomodDir) {
      const cfg = fs.readdirSync(path.join(dir, fomodDir.name)).find((f) => f.toLowerCase() === 'moduleconfig.xml');
      if (cfg) return { base: dir, configPath: path.join(dir, fomodDir.name, cfg) };
    }
    if (d < depth) for (const e of entries) if (e.isDirectory()) queue.push({ dir: path.join(dir, e.name), d: d + 1 });
  }
  return null;
}

// ModuleConfig.xml is often UTF-16 with a BOM.
function readXml(file) {
  const buf = fs.readFileSync(file);
  if (buf[0] === 0xff && buf[1] === 0xfe) return buf.toString('utf16le').replace(/^﻿/, '');
  if (buf[0] === 0xfe && buf[1] === 0xff) return Buffer.from(buf).swap16().toString('utf16le').replace(/^﻿/, '');
  return buf.toString('utf8').replace(/^﻿/, '');
}

const fileRefs = (node) =>
  node
    ? [
        ...arr(node.file).map((f) => ({ source: norm(f.source), destination: f.destination == null ? null : norm(f.destination), folder: false, priority: Number(f.priority) || 0 })),
        ...arr(node.folder).map((f) => ({ source: norm(f.source), destination: f.destination == null ? null : norm(f.destination), folder: true, priority: Number(f.priority) || 0 })),
      ]
    : [];

function dep(node) {
  if (!node) return null;
  return {
    op: node.operator === 'Or' ? 'Or' : 'And',
    items: [
      ...arr(node.flagDependency).map((d) => ({ flag: d.flag, value: d.value ?? '' })),
      ...arr(node.fileDependency).map((d) => ({ file: norm(d.file), state: d.state })),
      ...arr(node.dependencies).map(dep),
    ],
  };
}

// The schema's default order is "Ascending" (alphabetical); "Explicit" keeps the file order.
const ordered = (items, order) => (order === 'Explicit' ? items : [...items].sort((a, b) => String(a.name).localeCompare(String(b.name))));

function parseFomod(configPath) {
  const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '', textNodeName: '#text', parseTagValue: false, parseAttributeValue: false, trimValues: true });
  const doc = parser.parse(readXml(configPath));
  const c = doc.config;
  if (!c) throw new Error('E_FOMOD_BAD');

  const plugin = (p) => {
    const dt = p.typeDescriptor?.dependencyType;
    return {
      name: p.name || '',
      description: text(p.description).trim(),
      image: p.image?.path ? norm(p.image.path) : null,
      files: fileRefs(p.files),
      flags: arr(p.conditionFlags?.flag).map((f) => ({ name: f.name, value: text(f) })),
      type: p.typeDescriptor?.type?.name || null,
      typePatterns: dt ? { default: dt.defaultType?.name || 'Optional', patterns: arr(dt.patterns?.pattern).map((pt) => ({ dep: dep(pt.dependencies), type: pt.type?.name })) } : null,
    };
  };

  const steps = ordered(arr(c.installSteps?.installStep), c.installSteps?.order).map((st) => ({
    name: st.name || '',
    visible: dep(st.visible),
    groups: ordered(arr(st.optionalFileGroups?.group), st.optionalFileGroups?.order).map((g) => ({
      name: g.name || '',
      type: g.type || 'SelectAny',
      plugins: ordered(arr(g.plugins?.plugin), g.plugins?.order).map(plugin),
    })),
  }));

  return {
    name: text(c.moduleName).trim(),
    image: c.moduleImage?.path ? norm(c.moduleImage.path) : null,
    required: fileRefs(c.requiredInstallFiles),
    steps,
    conditional: arr(c.conditionalFileInstalls?.patterns?.pattern).map((pt) => ({ dep: dep(pt.dependencies), files: fileRefs(pt.files) })),
  };
}

function fileDeps(cfg) {
  const out = new Set();
  const visit = (d) => d && d.items.forEach((it) => (it.items ? visit(it) : 'file' in it && out.add(it.file)));
  cfg.steps.forEach((st) => {
    visit(st.visible);
    st.groups.forEach((g) => g.plugins.forEach((p) => p.typePatterns?.patterns.forEach((pt) => visit(pt.dep))));
  });
  cfg.conditional.forEach((c) => visit(c.dep));
  return [...out];
}

// Images for the wizard as data: URLs (they live in the temporary extraction folder).
function loadImages(cfg, base) {
  const mime = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.bmp': 'image/bmp', '.webp': 'image/webp' };
  const paths = new Set([cfg.image, ...cfg.steps.flatMap((s) => s.groups.flatMap((g) => g.plugins.map((p) => p.image)))].filter(Boolean));
  const images = {};
  let budget = 24 * 1024 * 1024;
  for (const p of paths) {
    const file = path.join(base, p);
    const type = mime[path.extname(p).toLowerCase()];
    try {
      const size = fs.statSync(file).size;
      if (!type || size > 4 * 1024 * 1024 || size > budget) continue;
      budget -= size;
      images[p] = `data:${type};base64,${fs.readFileSync(file).toString('base64')}`;
    } catch {}
  }
  return images;
}

function copyTree(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, e.name);
    const d = path.join(dest, e.name);
    if (e.isDirectory()) copyTree(s, d);
    else if (e.isFile()) fs.copyFileSync(s, d);
  }
}

// Copies the files picked by `selected` into `stagingDir`, laid out like the game folder.
function stage(cfg, base, selected, fileState, stagingDir) {
  fs.mkdirSync(stagingDir, { recursive: true });
  for (const f of logic.filesFor(cfg, selected, fileState)) {
    const src = path.join(base, f.source);
    if (!f.source || !fs.existsSync(src)) continue;
    if (f.folder) {
      copyTree(src, path.join(stagingDir, f.destination || ''));
      continue;
    }
    let dest = f.destination || f.source;
    // Some authors give a folder as the destination of a file.
    if (f.destination && !path.extname(f.destination) && path.extname(f.source)) dest = `${f.destination}/${path.basename(f.source)}`;
    const to = path.join(stagingDir, dest);
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(src, to);
  }
}

module.exports = { findFomod, parseFomod, fileDeps, loadImages, stage };
