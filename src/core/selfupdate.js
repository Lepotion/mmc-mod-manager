// Updates of the manager itself, published as GitHub Releases with the Setup .exe attached.
const API = 'https://api.github.com/repos';

// "1.10.0" > "1.9.2"; pre-release suffixes are ignored.
function compare(a, b) {
  const pa = String(a).replace(/^v/i, '').split(/[.-]/).map((x) => parseInt(x, 10) || 0);
  const pb = String(b).replace(/^v/i, '').split(/[.-]/).map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < 3; i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) - (pb[i] || 0);
  return 0;
}

async function checkLatest(repo, current) {
  if (!repo) return null;
  const res = await fetch(`${API}/${repo}/releases/latest`, {
    headers: { accept: 'application/vnd.github+json', 'user-agent': 'MMC-Mod-Manager' },
  });
  if (res.status === 404) return { version: null, newer: false };
  if (!res.ok) throw new Error(`GitHub HTTP ${res.status}`);
  const r = await res.json();
  const version = String(r.tag_name || '').replace(/^v/i, '');
  const asset = (r.assets || []).find((a) => /setup.*\.exe$/i.test(a.name));
  return {
    version,
    newer: !!asset && compare(version, current) > 0,
    notes: String(r.body || '').slice(0, 4000),
    page: r.html_url,
    url: asset?.browser_download_url || null,
    name: asset?.name || null,
    size: asset?.size || 0,
    sha256: asset?.digest?.startsWith('sha256:') ? asset.digest.slice(7) : null,
  };
}

module.exports = { checkLatest, compare };
