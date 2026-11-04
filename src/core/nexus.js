// Nexus Mods public API (v1) and nxm:// link parsing.
const API = 'https://api.nexusmods.com/v1';
const GAME = 'cyberpunk2077';
const APP = { name: 'MMC Mod Manager', version: '1.7.0' };

const modUrl = (modId) => `https://www.nexusmods.com/${GAME}/mods/${modId}`;
const fileUrl = (modId, fileId) => `${modUrl(modId)}?tab=files&file_id=${fileId}`;
const API_KEY_PAGE = 'https://www.nexusmods.com/users/myaccount?tab=api%20access';

async function api(key, route) {
  const res = await fetch(API + route, {
    headers: { apikey: key, accept: 'application/json', 'Application-Name': APP.name, 'Application-Version': APP.version },
  });
  if (res.status === 401) throw new Error('E_NEXUS_KEY');
  if (res.status === 403) throw new Error('E_NEXUS_PREMIUM');
  if (res.status === 404) throw new Error('E_NEXUS_NOT_FOUND');
  if (res.status === 429) throw new Error('E_NEXUS_RATE');
  if (!res.ok) throw new Error(`Nexus HTTP ${res.status}`);
  return res.json();
}

const validate = (key) => api(key, '/users/validate.json');
const modInfo = (key, modId) => api(key, `/games/${GAME}/mods/${modId}.json`);
const modFiles = (key, modId) => api(key, `/games/${GAME}/mods/${modId}/files.json`);

// Free accounts must pass the key/expires pair from an nxm:// link; Premium can omit it.
function downloadLinks(key, modId, fileId, nxm) {
  const q = nxm?.key ? `?key=${encodeURIComponent(nxm.key)}&expires=${encodeURIComponent(nxm.expires)}` : '';
  return api(key, `/games/${GAME}/mods/${modId}/files/${fileId}/download_link.json${q}`);
}

// nxm://cyberpunk2077/mods/107/files/12345?key=...&expires=...&user_id=...
function parseNxm(link) {
  const u = new URL(link);
  const parts = u.pathname.split('/').filter(Boolean);
  if (u.protocol !== 'nxm:' || parts[0] !== 'mods' || parts[2] !== 'files') throw new Error('E_NXM_LINK');
  return {
    game: u.hostname.toLowerCase(),
    modId: Number(parts[1]),
    fileId: Number(parts[3]),
    key: u.searchParams.get('key'),
    expires: u.searchParams.get('expires'),
  };
}

// Accepts a mod page URL (optionally with file_id) or a bare mod id.
function parseModRef(text) {
  const s = String(text || '').trim();
  const m = s.match(/nexusmods\.com\/cyberpunk2077\/mods\/(\d+)/i) || s.match(/^(\d+)$/);
  if (!m) throw new Error('E_NEXUS_REF');
  const f = s.match(/file_id=(\d+)/i);
  return { modId: Number(m[1]), fileId: f ? Number(f[1]) : null };
}

// Follows the file_updates chain to the newest replacement of `fileId`.
function newestFile(filesResponse, fileId) {
  const next = new Map((filesResponse.file_updates || []).map((u) => [u.old_file_id, u.new_file_id]));
  let cur = fileId;
  const seen = new Set();
  while (next.has(cur) && !seen.has(cur)) {
    seen.add(cur);
    cur = next.get(cur);
  }
  return (filesResponse.files || []).find((f) => f.file_id === cur) || null;
}

// ---------- catalog (public GraphQL v2, no key needed) ----------

const GQL = 'https://api.nexusmods.com/v2/graphql';
const GAME_ID = 3333;
// The "Slow download" page; its button hands an nxm:// link to the registered mod manager.
const managerDownloadUrl = (modId, fileId) => `${modUrl(modId)}?tab=files&file_id=${fileId}&nmm=1`;

const CATEGORIES = [
  'Armour and Clothing', 'Gameplay', 'Appearance', 'User Interface', 'Visuals and Graphics', 'Vehicles', 'Weapons',
  'Modders Resources', 'Utilities', 'Characters', 'Animations', 'Locations', 'Apartment', 'Audio', 'Scripts',
  'Crafting', 'Atelier Shop', 'Miscellaneous',
];
const SORTS = { popular: 'endorsements', downloads: 'downloads', updated: 'updatedAt', new: 'createdAt' };

async function gql(query, variables) {
  const res = await fetch(GQL, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'Application-Name': APP.name, 'Application-Version': APP.version },
    body: JSON.stringify({ query, variables }),
  });
  if (res.status === 429) throw new Error('E_NEXUS_RATE');
  if (!res.ok) throw new Error(`Nexus HTTP ${res.status}`);
  const j = await res.json();
  if (j.errors?.length) throw new Error(j.errors[0].message);
  return j.data;
}

const MOD_FIELDS = 'modId name summary version author downloads endorsements thumbnailUrl pictureUrl updatedAt createdAt modCategory { name }';
const REQ_FIELDS = 'modRequirements { nexusRequirements { nodes { modId modName notes gameId } } }';

// Other Cyberpunk mods this mod needs (external links and other games are left out).
const toRequirements = (node) =>
  (node?.modRequirements?.nexusRequirements?.nodes || [])
    .filter((r) => Number(r.modId) > 0 && (!r.gameId || Number(r.gameId) === GAME_ID))
    .map((r) => ({ modId: Number(r.modId), name: r.modName || `#${r.modId}`, notes: (r.notes || '').slice(0, 200) }));

async function requirements(modId) {
  const data = await gql(`query($ids: [CompositeIdInput!]!) { legacyMods(ids: $ids) { nodes { ${REQ_FIELDS} } } }`, { ids: [{ gameId: GAME_ID, modId }] });
  return toRequirements(data.legacyMods.nodes[0]);
}

async function searchMods({ text = '', sort = 'popular', category = '', offset = 0, count = 24 } = {}) {
  const filter = {
    gameDomainName: [{ value: GAME, op: 'EQUALS' }],
    adultContent: [{ value: false, op: 'EQUALS' }],
  };
  if (text.trim()) filter.name = [{ value: text.trim(), op: 'WILDCARD' }];
  if (category) filter.categoryName = [{ value: category, op: 'EQUALS' }];
  const data = await gql(
    `query($filter: ModsFilter, $sort: [ModsSort!], $offset: Int, $count: Int) {
      mods(filter: $filter, sort: $sort, offset: $offset, count: $count) { totalCount nodes { ${MOD_FIELDS} } }
    }`,
    { filter, sort: [{ [SORTS[sort] || SORTS.popular]: { direction: 'DESC' } }], offset, count: Math.min(count, 100) },
  );
  return { total: data.mods.totalCount, mods: data.mods.nodes.map(toCard) };
}

function toCard(n) {
  return {
    modId: n.modId,
    name: n.name,
    summary: n.summary || '',
    version: n.version || '',
    author: n.author || '',
    downloads: n.downloads || 0,
    endorsements: n.endorsements || 0,
    thumb: n.thumbnailUrl || n.pictureUrl || '',
    picture: n.pictureUrl || n.thumbnailUrl || '',
    category: n.modCategory?.name || '',
    updatedAt: n.updatedAt ? Date.parse(n.updatedAt) : 0,
  };
}

async function catalogDetail(modId) {
  const data = await gql(
    `query($ids: [CompositeIdInput!]!, $modId: ID!, $gameId: ID!) {
      legacyMods(ids: $ids) { nodes { ${MOD_FIELDS} description ${REQ_FIELDS} } }
      modFiles(modId: $modId, gameId: $gameId) { fileId name version category sizeInBytes date description }
    }`,
    { ids: [{ gameId: GAME_ID, modId }], modId, gameId: GAME_ID },
  );
  const node = data.legacyMods.nodes[0];
  if (!node) throw new Error('E_NEXUS_NOT_FOUND');
  const order = { MAIN: 0, UPDATE: 1, OPTIONAL: 2, MISCELLANEOUS: 3, OLD_VERSION: 4 };
  const files = (data.modFiles || [])
    .filter((f) => f.category in order)
    .map((f) => ({
      fileId: f.fileId,
      name: f.name,
      version: f.version || '',
      category: f.category,
      size: Number(f.sizeInBytes) || 0,
      uploaded: (f.date || 0) * 1000,
      description: (f.description || '').replace(/<[^>]+>/g, '').slice(0, 300),
    }))
    .sort((a, b) => order[a.category] - order[b.category] || b.uploaded - a.uploaded);
  return { ...toCard(node), description: (node.description || '').slice(0, 20000), files, requirements: toRequirements(node), url: modUrl(modId) };
}

module.exports = {
  GAME, APP, API_KEY_PAGE, CATEGORIES, modUrl, fileUrl, managerDownloadUrl,
  validate, modInfo, modFiles, downloadLinks, parseNxm, parseModRef, newestFile, searchMods, catalogDetail, requirements,
};
