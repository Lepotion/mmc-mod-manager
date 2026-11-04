const { app, BrowserWindow, ipcMain, dialog, shell, safeStorage, clipboard } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn, execFile } = require('child_process');
const { Manager } = require('./core/manager');
const { Online } = require('./core/online');
const nexus = require('./core/nexus');
const collections = require('./core/collections');
const fomod = require('./core/fomod');
const doctor = require('./core/doctor');
const selfupdate = require('./core/selfupdate');
const { download } = require('./core/download');
const game = require('./core/game');
const config = require('./config');

let win;
let manager;
let online;

// A second launch (e.g. from an nxm:// link) hands its arguments to the running window.
const primary = app.requestSingleInstanceLock();
if (!primary) {
  app.quit();
} else {
  app.on('second-instance', (_e, argv) => {
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
    const link = findNxm(argv);
    if (link) handleNxm(link);
  });
}

const findNxm = (argv) => argv.find((a) => /^nxm:\/\//i.test(a));

// In development the protocol must point at electron.exe + the project folder.
const protocolArgs = () => (app.isPackaged ? [process.execPath, []] : [process.execPath, [path.resolve(process.argv[1] || '.')]]);
const nxmRegistered = () => app.isDefaultProtocolClient('nxm', ...protocolArgs());

function createWindow() {
  win = new BrowserWindow({
    width: 1340,
    height: 840,
    minWidth: 1020,
    minHeight: 640,
    show: false,
    backgroundColor: '#090a0f',
    title: 'MMC Mod Manager',
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#090a0f', symbolColor: '#d9d7c8', height: 40 },
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.removeMenu();
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.once('ready-to-show', () => win.show());
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
}

const send = (channel, payload) => win && !win.isDestroyed() && win.webContents.send(channel, payload);

let latestUpdate = null; // last selfupdate.checkLatest() result
let gameRunning = false;

// Game files are locked while Cyberpunk runs; the window shows it and re-checks logs after it closes.
function pollGame() {
  execFile('tasklist', ['/FI', 'IMAGENAME eq Cyberpunk2077.exe', '/NH', '/FO', 'CSV'], { windowsHide: true }, (err, out) => {
    const running = !err && /cyberpunk2077\.exe/i.test(out);
    if (running === gameRunning) return;
    gameRunning = running;
    send('game-running', running);
  });
}

// Nexus update check in the background, at most every 6 hours. Off by default: the Nexus API
// policy asks that a user's key is only used for actions the user started, so the user has to
// switch this on in the settings.
async function autoCheckUpdates() {
  const s = manager.state.settings;
  if (!s.nexusUser || !s.autoModUpdates || Date.now() - (s.lastModUpdateCheck || 0) < 6 * 3600 * 1000) return;
  try {
    await online.checkUpdates();
    s.lastModUpdateCheck = Date.now();
    manager.save();
    send('state', state());
  } catch {}
}

const state = () => ({
  ...manager.getState(),
  running: gameRunning,
  nexus: { user: manager.state.settings.nexusUser || null, sso: config.nexusAppSlug || '', nxm: nxmRegistered(), keyPage: nexus.API_KEY_PAGE },
  queue: online.queue && { next: online.queue.items[0].name, left: online.queue.items.length, total: online.queue.total },
  app: { version: app.getVersion(), updates: !!config.updateRepo, update: latestUpdate?.newer ? latestUpdate : null },
});

const openQueued = (item) => item && shell.openExternal(nexus.managerDownloadUrl(item.modId, item.fileId));

// After queueing site downloads (free Nexus accounts): make sure nxm:// links come back to us.
function startQueue(r) {
  if (!r.queued) return;
  const [exe, args] = protocolArgs();
  if (!nxmRegistered()) app.setAsDefaultProtocolClient('nxm', exe, args);
  openQueued(online.queue.items[0]);
}

// FOMOD wizard: the import waits while the window asks the user (answers bypass the IPC queue).
const fomodWaiting = new Map();
let fomodSeq = 0;
function fomodPrompt({ cfg, base, name, initial, fileState }) {
  return new Promise((resolve) => {
    const id = ++fomodSeq;
    fomodWaiting.set(id, resolve);
    const fileStates = Object.fromEntries(fomod.fileDeps(cfg).map((f) => [f, fileState(f)]));
    send('fomod', { id, name, cfg, images: fomod.loadImages(cfg, base), initial, fileStates });
  });
}
ipcMain.on('fomod:answer', (_e, id, choices) => {
  const resolve = fomodWaiting.get(id);
  fomodWaiting.delete(id);
  resolve?.(Array.isArray(choices) ? new Set(choices.map(String)) : null);
});

// File operations must never overlap, so every call goes through one queue.
let queue = Promise.resolve();
function enqueue(fn) {
  const run = queue.then(async () => {
    try {
      return { ok: true, data: await fn() };
    } catch (e) {
      return { ok: false, error: e.message || String(e) };
    }
  });
  queue = run;
  return run;
}

// Runs fn in the file-operation queue and passes its result or error through.
const serial = (fn) => enqueue(fn).then((r) => {
  if (!r.ok) throw new Error(r.error);
  return r.data;
});

// nxm:// link from the browser: the download becomes a background job.
async function handleNxm(link) {
  try {
    await online.handleNxm(link);
  } catch (e) {
    send('external', { error: e.message || String(e), state: state() });
  }
}

const handlers = {
  'state:get': () => state(),
  'settings:set': (patch) => (manager.setSettings(patch), state()),
  'game:detect': () => game.detect(),
  'game:setPath': (p) => (manager.setGamePath(p), state()),
  'game:browse': async () => {
    const r = await dialog.showOpenDialog(win, { properties: ['openDirectory'] });
    if (r.canceled || !r.filePaths[0]) return null;
    manager.setGamePath(r.filePaths[0]);
    return state();
  },
  // Through the store's launcher when possible, so Steam / Epic / GOG Galaxy show the game as running.
  'game:launch': async () => {
    const modded = manager.getState().mods.some((m) => m.enabled && m.tags.includes('redmod'));
    const plan = await game.launchPlan(manager.gameDir, { modded });
    if (plan.url) return shell.openExternal(plan.url);
    spawn(plan.exe, plan.args, { cwd: plan.cwd, detached: true, stdio: 'ignore' }).unref();
  },
  'mods:pick': async () => {
    const r = await dialog.showOpenDialog(win, {
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: 'Mods', extensions: ['zip', '7z', 'rar', 'archive', 'xl', 'reds', 'yaml', 'yml'] },
        { name: '*', extensions: ['*'] },
      ],
    });
    return r.canceled ? [] : r.filePaths;
  },
  'mods:import': async (paths) => {
    const results = await manager.importPaths(paths, (p) => send('progress', p));
    return { results, state: state() };
  },
  'mods:setEnabled': (id, on) => (manager.setEnabled(id, on), state()),
  'mods:setAll': (on) => (manager.setAll(on), state()),
  'mods:update': (id, patch) => (manager.update(id, patch), state()),
  'mods:delete': (id) => (manager.remove(id), state()),
  'mods:files': (id) => manager.files(id),
  'mods:openFolder': (id) => shell.openPath(manager.modFolder(id)),
  'profiles:create': (name) => (manager.createProfile(name), state()),
  'profiles:update': (id) => (manager.updateProfile(id), state()),
  'profiles:apply': (id) => (manager.applyProfile(id), state()),
  'profiles:delete': (id) => (manager.deleteProfile(id), state()),

  'nexus:login': async (key) => (await online.login(key), state()),
  'nexus:logout': () => (online.logout(), state()),
  'nexus:setNxm': (on) => {
    const [exe, args] = protocolArgs();
    if (on) app.setAsDefaultProtocolClient('nxm', exe, args);
    else app.removeAsDefaultProtocolClient('nxm', exe, args);
    return state();
  },
  'nexus:lookup': (ref) => online.lookup(ref),
  'nexus:install': async (modId, fileId) => (await online.nexusJob(modId, fileId), { started: true, state: state() }),
  // items: [{ modId, name }] — dependencies or frameworks to install.
  'deps:install': async (items) => {
    const r = await online.installItems(items.map((x) => ({ t: 'nx', id: Number(x.modId), n: String(x.name || ''), e: true })));
    startQueue(r);
    return { ...r, state: state() };
  },
  'mods:makeWinner': (id) => (manager.makeWinner(id), state()),
  'history:restore': (id) => (manager.restoreHistory(id), state()),
  'bisect:start': () => (manager.bisectStart(), state()),
  'bisect:answer': (problem) => (manager.bisectAnswer(!!problem), state()),
  'bisect:end': (disableCulprit) => (manager.bisectEnd(!!disableCulprit), state()),
  'nexus:updateAll': async () => {
    const items = manager.state.mods
      .filter((m) => m.update && m.origin?.type === 'nexus')
      .map((m) => ({ t: 'nx', id: m.origin.modId, f: m.update.fileId, n: m.name, e: m.enabled, c: m.fomod?.choices || null }));
    const r = await online.installItems(items);
    startQueue(r);
    return { ...r, state: state() };
  },
  'doctor:run': () => doctor.run(manager),
  'open:gameFile': (rel) => {
    const file = path.resolve(manager.gameDir, String(rel));
    if (!file.toLowerCase().startsWith(path.resolve(manager.gameDir).toLowerCase() + path.sep)) throw new Error('E_NO_GAME');
    return shell.openPath(file);
  },
  'nexus:checkUpdates': async () => ({ found: await online.checkUpdates(), state: state() }),
  'nexus:updateMod': async (id) => ({ ...(await online.updateMod(id)), state: state() }),

  // Premium installs right away; free accounts get the site's download page, whose button
  // comes back to us as an nxm:// link.
  'catalog:download': async (modId, fileId) => {
    const user = manager.state.settings.nexusUser;
    if (!user) throw new Error('E_NEXUS_LOGIN');
    if (user.premium) return (await online.nexusJob(modId, fileId), { started: true, state: state() });
    const [exe, args] = protocolArgs();
    if (!nxmRegistered()) app.setAsDefaultProtocolClient('nxm', exe, args);
    await shell.openExternal(nexus.managerDownloadUrl(modId, fileId));
    return { opened: true, state: state() };
  },

  // Mods without a known Nexus page are looked up by their link or name first, so they can be shared too.
  'coll:build': async (opts) => {
    const user = manager.state.settings.nexusUser;
    const pool = manager.state.mods.filter((m) => !opts.onlyEnabled || m.enabled);
    const identified = await online.identifyMods(pool);
    const built = collections.build(manager.state.mods, { name: opts.name, by: user?.name || '', onlyEnabled: !!opts.onlyEnabled });
    return { ...built, identified, leftOutDisabled: opts.onlyEnabled ? manager.state.mods.filter((m) => !m.enabled).length : 0 };
  },
  'coll:preview': (code) => collections.preview(manager.state.mods, collections.decode(code)),
  'coll:install': async (code) => {
    const r = await online.installCollection(code);
    startQueue(r);
    return { ...r, state: state() };
  },
  'coll:queueOpen': () => (openQueued(online.queue?.items[0]), state()),
  'coll:queueSkip': () => (openQueued(online.queueSkip()), state()),
  'coll:queueCancel': () => ((online.queue = null), state()),
  'clip:write': (text) => clipboard.writeText(String(text)),

  'app:checkUpdate': async () => {
    latestUpdate = await selfupdate.checkLatest(config.updateRepo, app.getVersion());
    return state();
  },
  // Downloads the new installer and runs it silently; it replaces this app and starts it again.
  'app:installUpdate': async () => {
    const u = latestUpdate;
    if (!u?.newer || !u.url) throw new Error('E_UPDATE_NONE');
    if (!app.isPackaged) return shell.openExternal(u.page);
    const dest = path.join(app.getPath('temp'), `mmc-update-${Date.now()}`, u.name);
    await download(u.url, dest, {
      sha256: u.sha256,
      onProgress: (received, total) => send('progress', { phase: 'download', name: `MMC Mod Manager ${u.version}`, received, total: total || u.size }),
    });
    if (!fs.existsSync(dest)) throw new Error('E_UPDATE_NONE');
    spawn(dest, ['/S', '--force-run'], { detached: true, stdio: 'ignore' }).unref();
    setTimeout(() => app.quit(), 300);
  },

  'nc:releases': (force) => online.ncReleases(force),
  'nc:install': async (version, variant) => (await online.ncJob(version, variant), { started: true, state: state() }),

  'open:path': (which) => {
    const target = { game: manager.gameDir, storage: manager.storageDir, data: manager.dataDir }[which];
    if (target) return shell.openPath(target);
  },
  'open:url': (url) => {
    if (/^https:\/\//.test(url)) return shell.openExternal(url);
  },
};

// These only read state, open dialogs or talk to the network, so they skip the file-operation
// queue and answer right away even while a big mod is being installed.
Object.assign(handlers, {
  'catalog:search': (params) => nexus.searchMods(params),
  'catalog:detail': (modId) => nexus.catalogDetail(modId),
  'app:notices': () => fs.readFileSync(path.join(__dirname, '..', 'build', 'THIRD_PARTY_NOTICES.txt'), 'utf8'),
  'jobs:list': () => online.jobList(),
  'jobs:cancel': (id) => (online.cancelJob(Number(id)), online.jobList()),
  'jobs:clear': () => (online.clearFinished(), online.jobList()),
});
const UNQUEUED = new Set([
  'state:get', 'game:detect', 'game:launch', 'mods:pick', 'mods:files', 'mods:openFolder', 'nexus:lookup', 'doctor:run',
  'open:gameFile', 'coll:build', 'coll:preview', 'coll:queueOpen', 'clip:write', 'app:checkUpdate', 'nc:releases',
  'open:path', 'open:url', 'app:notices', 'catalog:search', 'catalog:detail', 'jobs:list', 'jobs:cancel', 'jobs:clear', 'nexus:checkUpdates',
]);

async function direct(fn) {
  try {
    return { ok: true, data: await fn() };
  } catch (e) {
    return { ok: false, error: e.message || String(e) };
  }
}

for (const [channel, fn] of Object.entries(handlers)) {
  ipcMain.handle(channel, (_e, ...args) => (UNQUEUED.has(channel) ? direct : enqueue)(() => fn(...args)));
}

app.whenReady().then(() => {
  if (!primary) return;
  const lang = app.getLocale().toLowerCase().startsWith('ru') ? 'ru' : 'en';
  manager = new Manager(app.getPath('userData'), lang);
  manager.fomodPrompt = fomodPrompt;
  online = new Online(manager, {
    encrypt: (s) => (safeStorage.isEncryptionAvailable() ? safeStorage.encryptString(s).toString('base64') : `plain:${s}`),
    decrypt: (s) => (s.startsWith('plain:') ? s.slice(6) : safeStorage.decryptString(Buffer.from(s, 'base64'))),
    serial,
    jobsChanged: (jobs) => send('jobs', jobs),
    // A background install finished: the window shows the result and offers missing requirements.
    jobDone: (job, results, extra) => send('external', { results, missing: extra.missing || [], state: state() }),
    openUrl: openQueued,
  });
  createWindow();

  pollGame();
  setInterval(pollGame, 4000);
  setTimeout(autoCheckUpdates, 8000);

  const link = findNxm(process.argv);
  if (link) win.webContents.once('did-finish-load', () => handleNxm(link));
});

app.on('window-all-closed', () => app.quit());
