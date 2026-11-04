// Game folder detection (Steam / GOG / Epic), framework checks and launching.
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

const EXE_REL = path.join('bin', 'x64', 'Cyberpunk2077.exe');

const FRAMEWORKS = [
  { id: 'cet', name: 'Cyber Engine Tweaks', file: 'bin/x64/plugins/cyber_engine_tweaks.asi', nexus: 107 },
  { id: 'red4ext', name: 'RED4ext', file: 'red4ext/RED4ext.dll', nexus: 2380 },
  { id: 'redscript', name: 'redscript', file: 'engine/tools/scc.exe', nexus: 1511 },
  { id: 'archivexl', name: 'ArchiveXL', file: 'red4ext/plugins/ArchiveXL/ArchiveXL.dll', nexus: 4198 },
  { id: 'tweakxl', name: 'TweakXL', file: 'red4ext/plugins/TweakXL/TweakXL.dll', nexus: 4197 },
  { id: 'codeware', name: 'Codeware', file: 'red4ext/plugins/Codeware/Codeware.dll', nexus: 7780 },
  { id: 'inputloader', name: 'Input Loader', file: 'red4ext/plugins/input_loader/input_loader.dll', nexus: 4575 },
  { id: 'modsettings', name: 'Mod Settings', file: 'red4ext/plugins/mod_settings/mod_settings.dll', nexus: 4885 },
];

// Which framework a mod tag depends on.
const TAG_REQUIRES = { cet: 'cet', redscript: 'redscript', tweakxl: 'tweakxl', archivexl: 'archivexl', red4ext: 'red4ext' };

function isGameDir(dir) {
  return !!dir && fs.existsSync(path.join(dir, EXE_REL));
}

// Accept the game root, bin/x64, or the exe itself.
function resolveGameDir(p) {
  let dir = p;
  for (let i = 0; i < 3 && dir; i++) {
    if (isGameDir(dir)) return dir;
    dir = path.dirname(dir);
  }
  return null;
}

function detectStore(dir) {
  if (/steamapps/i.test(dir)) return 'steam';
  if (fs.existsSync(path.join(dir, '.egstore'))) return 'epic';
  try {
    if (fs.readdirSync(dir).some((f) => /^goggame-.*\.info$/i.test(f))) return 'gog';
  } catch {}
  return 'other';
}

function regQuery(key, value) {
  return new Promise((resolve) => {
    execFile('reg', ['query', key, '/v', value], { windowsHide: true }, (err, out) => {
      if (err) return resolve(null);
      const m = out.match(new RegExp(`${value}\\s+REG_\\w+\\s+(.+)`, 'i'));
      resolve(m ? m[1].trim() : null);
    });
  });
}

function steamLibraries(steamRoot) {
  const libs = [steamRoot];
  try {
    const vdf = fs.readFileSync(path.join(steamRoot, 'steamapps', 'libraryfolders.vdf'), 'utf8');
    for (const m of vdf.matchAll(/"path"\s+"([^"]+)"/g)) libs.push(m[1].replace(/\\\\/g, '\\'));
  } catch {}
  return libs;
}

async function detect() {
  const candidates = [];
  const steamRoot = await regQuery('HKCU\\Software\\Valve\\Steam', 'SteamPath');
  for (const root of [steamRoot && path.normalize(steamRoot), 'C:\\Program Files (x86)\\Steam'].filter(Boolean)) {
    for (const lib of steamLibraries(root)) candidates.push(path.join(lib, 'steamapps', 'common', 'Cyberpunk 2077'));
  }

  for (const key of ['HKLM\\SOFTWARE\\WOW6432Node\\GOG.com\\Games\\1423049311', 'HKLM\\SOFTWARE\\GOG.com\\Games\\1423049311']) {
    const p = await regQuery(key, 'path');
    if (p) candidates.push(p);
  }

  const epicDir = 'C:\\ProgramData\\Epic\\EpicGamesLauncher\\Data\\Manifests';
  try {
    for (const f of fs.readdirSync(epicDir).filter((f) => f.endsWith('.item'))) {
      const item = JSON.parse(fs.readFileSync(path.join(epicDir, f), 'utf8'));
      if (/cyberpunk/i.test(item.DisplayName || '')) candidates.push(item.InstallLocation);
    }
  } catch {}

  for (const drive of 'CDEFGH') {
    for (const sub of ['Games\\Cyberpunk 2077', 'GOG Games\\Cyberpunk 2077', 'SteamLibrary\\steamapps\\common\\Cyberpunk 2077', 'Epic Games\\Cyberpunk2077', 'Program Files\\Epic Games\\Cyberpunk2077']) {
      candidates.push(`${drive}:\\${sub}`);
    }
  }

  const found = new Map();
  for (const c of candidates) {
    if (c && isGameDir(c)) found.set(path.resolve(c).toLowerCase(), { path: path.resolve(c), store: detectStore(c) });
  }
  return [...found.values()];
}

const STEAM_APP_ID = 1091500;
const GOG_GAME_ID = '1423049311';
const EPIC_MANIFESTS = 'C:\\ProgramData\\Epic\\EpicGamesLauncher\\Data\\Manifests';

function epicManifest(gameDir) {
  try {
    for (const f of fs.readdirSync(EPIC_MANIFESTS).filter((x) => x.endsWith('.item'))) {
      const item = JSON.parse(fs.readFileSync(path.join(EPIC_MANIFESTS, f), 'utf8'));
      if (item.InstallLocation && path.resolve(item.InstallLocation).toLowerCase() === path.resolve(gameDir).toLowerCase()) return item;
    }
  } catch {}
  return null;
}

/**
 * How to start the game so its store sees it running (Steam "playing", playtime, overlay):
 * { url } to open, or { exe, args, cwd } to spawn. `modded` adds -modded for REDmod mods.
 */
async function launchPlan(gameDir, { modded = false } = {}) {
  if (!isGameDir(gameDir)) throw new Error('E_NO_GAME');
  const extra = modded ? ['-modded'] : [];
  const store = detectStore(gameDir);

  if (store === 'steam') {
    const steamExe = await regQuery('HKCU\\Software\\Valve\\Steam', 'SteamExe');
    if (steamExe && fs.existsSync(path.normalize(steamExe))) {
      return { exe: path.normalize(steamExe), args: ['-applaunch', String(STEAM_APP_ID), ...extra], cwd: path.dirname(path.normalize(steamExe)) };
    }
    return { url: `steam://rungameid/${STEAM_APP_ID}` };
  }
  if (store === 'epic') {
    const item = epicManifest(gameDir);
    if (item?.AppName) {
      const id = item.CatalogNamespace && item.CatalogItemId ? `${item.CatalogNamespace}:${item.CatalogItemId}:${item.AppName}` : item.AppName;
      return { url: `com.epicgames.launcher://apps/${encodeURIComponent(id)}?action=launch&silent=true` };
    }
  }
  if (store === 'gog') {
    const dir = await regQuery('HKLM\\SOFTWARE\\WOW6432Node\\GOG.com\\GalaxyClient\\paths', 'client');
    const galaxy = dir && path.join(dir, 'GalaxyClient.exe');
    if (galaxy && fs.existsSync(galaxy)) return { exe: galaxy, args: ['/command=runGame', `/gameId=${GOG_GAME_ID}`, `/path=${gameDir}`], cwd: dir };
  }
  return { exe: path.join(gameDir, EXE_REL), args: extra, cwd: path.join(gameDir, 'bin', 'x64') };
}

function frameworkStatus(gameDir) {
  return FRAMEWORKS.map((fw) => ({
    ...fw,
    url: `https://www.nexusmods.com/cyberpunk2077/mods/${fw.nexus}`,
    installed: isGameDir(gameDir) && fs.existsSync(path.join(gameDir, fw.file)),
  }));
}

module.exports = { detect, isGameDir, resolveGameDir, detectStore, frameworkStatus, launchPlan, FRAMEWORKS, TAG_REQUIRES, EXE_REL };
