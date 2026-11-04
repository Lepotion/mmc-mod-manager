// Share codes: a compressed list of Nexus / NightCoop mods a friend can install in one go.
// Mods installed from local files can't be shared, since there is nowhere to download them from.
const zlib = require('zlib');

const PREFIX = 'MMC1-';
const MAX_ITEMS = 500;

function encode(payload) {
  return PREFIX + zlib.deflateRawSync(Buffer.from(JSON.stringify(payload))).toString('base64url');
}

function decode(code) {
  const s = String(code || '').replace(/\s+/g, '');
  if (!s.startsWith(PREFIX)) throw new Error('E_COLL_CODE');
  let data;
  try {
    const raw = zlib.inflateRawSync(Buffer.from(s.slice(PREFIX.length), 'base64url'), { maxOutputLength: 1 << 20 });
    data = JSON.parse(raw.toString('utf8'));
  } catch {
    throw new Error('E_COLL_CODE');
  }
  if (!data || data.v !== 1 || !Array.isArray(data.m) || data.m.length > MAX_ITEMS) throw new Error('E_COLL_CODE');
  const str = (x, n = 200) => String(x ?? '').slice(0, n);
  const items = data.m
    .map((it) => {
      if (it.t === 'nx' && Number.isInteger(it.id) && it.id > 0) {
        // FOMOD choices of the sender, "step:group:plugin" ids.
        const c = Array.isArray(it.c) ? it.c.filter((x) => typeof x === 'string' && /^\d+:\d+:\d+$/.test(x)).slice(0, 500) : null;
        return { t: 'nx', id: it.id, f: Number.isInteger(it.f) ? it.f : null, n: str(it.n), v: str(it.v, 40), e: it.e !== 0, c: c?.length ? c : null };
      }
      if (it.t === 'nc' && it.v) return { t: 'nc', v: str(it.v, 40), g: it.g ? str(it.g, 10) : null, n: 'NightCoop', e: it.e !== 0 };
      return null;
    })
    .filter(Boolean);
  return { name: str(data.n, 80), by: str(data.by, 80), items };
}

function build(mods, { name, by, onlyEnabled }) {
  const items = [];
  const skipped = [];
  for (const m of mods) {
    if (onlyEnabled && !m.enabled) continue;
    const e = m.enabled ? 1 : 0;
    // Installed from Nexus, or a local install whose Nexus page is known from its link.
    const linked = Number((m.nexusUrl || '').match(/nexusmods\.com\/cyberpunk2077\/mods\/(\d+)/i)?.[1]) || null;
    const modId = m.origin?.type === 'nexus' && m.origin.modId ? m.origin.modId : linked;
    if (m.origin?.type === 'nightcoop') {
      items.push({ t: 'nc', v: m.origin.version, g: m.origin.variant, e });
    } else if (modId) {
      const item = { t: 'nx', id: modId, f: (m.origin?.modId === modId && m.origin.fileId) || null, n: m.name, v: m.version, e };
      if (m.fomod?.choices?.length) item.c = m.fomod.choices;
      items.push(item);
    } else {
      skipped.push(m.name);
    }
  }
  return { code: items.length ? encode({ v: 1, n: name, by, m: items }) : '', count: items.length, skipped };
}

// What will happen to each item on this PC.
function preview(mods, payload) {
  return {
    ...payload,
    items: payload.items.map((it) => {
      const linkId = (m) => Number((m.nexusUrl || '').match(/nexusmods\.com\/cyberpunk2077\/mods\/(\d+)/i)?.[1]);
      const have = mods.find((m) => m.key === (it.t === 'nc' ? 'nightcoop' : `nexus:${it.id}`) || (it.t === 'nx' && linkId(m) === it.id));
      let status = 'install';
      if (have) {
        const same = it.t === 'nc' ? have.origin?.version === it.v : it.f ? have.origin?.fileId === it.f : true;
        status = same ? 'have' : 'change';
      }
      return { ...it, status };
    }),
  };
}

module.exports = { encode, decode, build, preview, PREFIX };
