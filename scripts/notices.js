// Writes build/THIRD_PARTY_NOTICES.txt: every third-party component shipped in the installer,
// why it is there, its license and the full license text. Runs before each `npm run dist`;
// the app shows the file in Settings → About → Licenses.
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8').replace(/\r\n/g, '\n').trim();
const version = (pkg) => require(path.join(root, 'node_modules', pkg, 'package.json')).version;

const components = [
  {
    name: `Electron ${version('electron')}`,
    why: 'Application shell (window, file access, installer runtime).',
    license: 'MIT',
    home: 'https://www.electronjs.org/',
    texts: ['node_modules/electron/LICENSE'],
  },
  {
    name: 'Chromium (inside Electron)',
    why: 'Renders the interface.',
    license: 'BSD-3-Clause and others',
    home: 'https://www.chromium.org/',
    note: 'The full list of Chromium licenses is in LICENSES.chromium.html in the program folder.',
  },
  {
    name: `7-Zip command line (7za.exe), via 7zip-bin ${version('7zip-bin')}`,
    why: 'Unpacks .zip and .7z mod archives.',
    license: '7-Zip: GNU LGPL 2.1+ with BSD 3-clause parts; 7zip-bin wrapper: MIT',
    home: 'https://www.7-zip.org/ (source code: https://www.7-zip.org/download.html)',
    texts: ['licenses/7-Zip.txt', 'node_modules/7zip-bin/LICENSE.txt'],
  },
  {
    name: `UnRAR (compiled to WebAssembly), via node-unrar-js ${version('node-unrar-js')}`,
    why: 'Unpacks .rar mod archives. Only extracts; it cannot create RAR files.',
    license: 'UnRAR license (freeware, extraction only); node-unrar-js wrapper: MIT',
    home: 'https://www.rarlab.com/ , https://github.com/YuJianrong/node-unrar.js',
    texts: ['licenses/unRAR.txt', 'node_modules/node-unrar-js/LICENSE.md'],
  },
  {
    name: `fast-xml-parser ${version('fast-xml-parser')}`,
    why: 'Reads FOMOD installers (fomod/ModuleConfig.xml).',
    license: 'MIT',
    home: 'https://github.com/NaturalIntelligence/fast-xml-parser',
    texts: ['node_modules/fast-xml-parser/LICENSE'],
  },
  {
    name: `strnum ${version('strnum')}`,
    why: 'Used by fast-xml-parser.',
    license: 'MIT',
    home: 'https://github.com/NaturalIntelligence/strnum',
    texts: ['node_modules/strnum/LICENSE'],
  },
];

const line = '='.repeat(78);
const out = [
  'MMC Mod Manager — third-party components / сторонние компоненты',
  '',
  'MMC Mod Manager is an unofficial fan project. It is not made, approved or endorsed by',
  'CD PROJEKT RED, Nexus Mods or the NightCoop authors. All trademarks belong to their owners.',
  '',
  'MMC Mod Manager itself is free software under the GNU General Public License v3 (see LICENSE).',
  `Source code: ${require(path.join(root, 'package.json')).homepage}`,
  '',
  'The components below are shipped inside the installer under their own licenses.',
  '',
];
for (const c of components) {
  out.push(line, c.name, `Why: ${c.why}`, `License: ${c.license}`, `Home: ${c.home}`);
  if (c.note) out.push(c.note);
  for (const t of c.texts || []) out.push('', `--- ${path.basename(t)} ---`, read(t));
  out.push('');
}
fs.mkdirSync(path.join(root, 'build'), { recursive: true });
fs.writeFileSync(path.join(root, 'build', 'THIRD_PARTY_NOTICES.txt'), `${out.join('\n')}\n`);
console.log(`notices: ${components.length} components → build/THIRD_PARTY_NOTICES.txt`);
