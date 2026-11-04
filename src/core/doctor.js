// "Doctor": reads the logs of the game's mod frameworks, finds errors and works out which mod they come from.
const fs = require('fs');
const os = require('os');
const path = require('path');
const game = require('./game');

const TAIL = 512 * 1024; // only the end of each log matters: the last game session
const ERROR_RE = /\[(?:error|critical|fatal)\]|\[ERROR\b|\bERROR\s*[:\-|]|\berror:|\bfailed to\b|\bexception\b/i;
const WARN_RE = /\[(?:warn|warning)\]|\[WARN\b|\bWARNING\s*[:\-|]/i;
// Lines that look like errors but are just summaries ("0 errors", "no errors").
const NOISE_RE = /\b0 errors?\b|\bno errors?\b|without errors/i;

// Known logs (relative to the game folder) plus every *.log in plugin folders.
const KNOWN_LOGS = [
  { id: 'redscript', name: 'redscript', file: 'r6/logs/redscript_rCURRENT.log' },
  { id: 'red4ext', name: 'RED4ext', file: 'red4ext/logs/red4ext.log' },
  { id: 'cet', name: 'Cyber Engine Tweaks', file: 'bin/x64/plugins/cyber_engine_tweaks/cyber_engine_tweaks.log' },
];
const LOG_DIRS = ['red4ext/logs', 'red4ext/plugins', 'bin/x64/plugins/cyber_engine_tweaks/mods'];

function readTail(file) {
  const fd = fs.openSync(file, 'r');
  try {
    const size = fs.fstatSync(fd).size;
    const len = Math.min(size, TAIL);
    const buf = Buffer.alloc(len);
    fs.readSync(fd, buf, 0, len, size - len);
    return buf.toString('utf8');
  } finally {
    fs.closeSync(fd);
  }
}

function findLogs(gameDir) {
  const logs = new Map();
  for (const l of KNOWN_LOGS) if (fs.existsSync(path.join(gameDir, l.file))) logs.set(l.file.toLowerCase(), l);
  for (const dir of LOG_DIRS) {
    const abs = path.join(gameDir, dir);
    if (!fs.existsSync(abs)) continue;
    // Direct *.log files and one level of plugin / mod folders.
    const scan = (d, rel, depth) => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const r = `${rel}/${e.name}`;
        if (e.isFile() && e.name.toLowerCase().endsWith('.log')) {
          if (!logs.has(r.toLowerCase())) logs.set(r.toLowerCase(), { id: r, name: path.basename(e.name, '.log'), file: r });
        } else if (e.isDirectory() && depth < 1) scan(path.join(d, e.name), r, depth + 1);
      }
    };
    try {
      scan(abs, dir, 0);
    } catch {}
  }
  return [...logs.values()];
}

// Words that identify a mod in log lines: file names and its own folder names.
function modTokens(mod) {
  const tokens = new Set();
  for (const f of mod.files) {
    const parts = f.toLowerCase().split('/');
    const base = parts[parts.length - 1];
    if (base.length > 5) tokens.add(base);
    const folderAt = { r6: 2, red4ext: 2, mods: 1, bin: 5 }[parts[0]];
    const folder = folderAt != null ? parts[folderAt] : null;
    if (folder && folder.length > 3 && parts.length > folderAt + 1) tokens.add(folder);
  }
  return [...tokens];
}

// A framework's own log mentions the framework on every line, so when another mod is named too,
// the line is about that mod.
function attribute(line, index, logOwners) {
  const low = line.toLowerCase().replace(/\\/g, '/');
  const ids = index.filter(({ tokens }) => tokens.some((tk) => low.includes(tk))).map(({ id }) => id);
  const specific = ids.filter((id) => !logOwners.has(id));
  return specific.length ? specific : ids;
}

// Lines are compared without timestamps so the same error repeated many times shows once.
const signature = (line) => line.replace(/^\s*\[[^\]]*\d{2}:\d{2}[^\]]*\]\s*/, '').replace(/\d+/g, '#').trim();

function crashReports() {
  const dir = path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'REDEngine', 'ReportQueue');
  try {
    return fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => fs.statSync(path.join(dir, e.name)).mtimeMs)
      .sort((a, b) => b - a);
  } catch {
    return [];
  }
}

function run(manager) {
  const st = manager.getState();
  const gameDir = manager.gameDir;
  if (!game.isGameDir(gameDir)) throw new Error('E_NO_GAME');
  const index = manager.state.mods.map((m) => ({ id: m.id, tokens: modTokens(m) }));
  const issues = [];

  // Static checks first: things that are wrong even before launching the game.
  for (const m of st.mods.filter((x) => x.enabled && x.missing.length)) {
    issues.push({ level: 'error', kind: 'missing', mod: m.id, requires: m.missing });
  }
  const pairs = new Set();
  for (const m of st.mods.filter((x) => x.enabled)) {
    for (const c of m.conflictInfo) {
      const other = st.mods.find((x) => x.id === c.id);
      const key = [m.id, c.id].sort().join();
      if (!other?.enabled || pairs.has(key)) continue;
      pairs.add(key);
      issues.push({ level: 'info', kind: 'conflict', mod: m.id, other: c.id, shared: c.shared, mine: c.mine });
    }
  }
  if (st.game.unmanaged) issues.push({ level: 'info', kind: 'unmanaged', count: st.game.unmanaged });

  // Logs from the last game session.
  const logs = [];
  const lastModChange = Math.max(0, ...manager.state.mods.map((m) => Math.max(m.installedAt || 0, m.enabledAt || 0)));
  for (const l of findLogs(gameDir)) {
    const abs = path.join(gameDir, l.file);
    let content;
    let mtime;
    try {
      content = readTail(abs);
      mtime = fs.statSync(abs).mtimeMs;
    } catch {
      continue;
    }
    const logDir = path.posix.dirname(l.file.toLowerCase());
    const logOwners = new Set(manager.state.mods.filter((m) => m.files.some((f) => f.toLowerCase().startsWith(`${logDir}/`))).map((m) => m.id));
    const errors = new Map();
    let warnCount = 0;
    for (const line of content.split(/\r?\n/)) {
      if (!line.trim() || NOISE_RE.test(line)) continue;
      if (ERROR_RE.test(line)) {
        const sig = signature(line);
        const e = errors.get(sig) || { text: line.trim().slice(0, 400), count: 0, mods: attribute(line, index, logOwners) };
        e.count++;
        errors.set(sig, e);
      } else if (WARN_RE.test(line)) warnCount++;
    }
    const list = [...errors.values()];
    logs.push({ id: l.id, name: l.name, file: l.file, mtime, errorCount: list.reduce((n, e) => n + e.count, 0), warnCount, stale: mtime < lastModChange });

    // One issue per mod that shows up in this log, plus one for errors no mod could be matched to.
    const byMod = new Map();
    const loose = [];
    for (const e of list) {
      if (!e.mods.length) loose.push(e);
      for (const id of e.mods) byMod.set(id, [...(byMod.get(id) || []), e]);
    }
    for (const [id, errs] of byMod) issues.push({ level: 'error', kind: 'logMod', mod: id, log: l.file, logName: l.name, lines: errs.slice(-8) });
    if (loose.length) issues.push({ level: 'warn', kind: 'logOther', log: l.file, logName: l.name, lines: loose.slice(-8), count: loose.length });
  }

  const crashes = crashReports();
  if (crashes.length && Date.now() - crashes[0] < 14 * 24 * 3600 * 1000) issues.push({ level: 'warn', kind: 'crash', at: crashes[0], count: crashes.length });

  const order = { error: 0, warn: 1, info: 2 };
  issues.sort((a, b) => order[a.level] - order[b.level]);
  return { checkedAt: Date.now(), issues, logs, lastModChange };
}

module.exports = { run, modTokens, findLogs };
