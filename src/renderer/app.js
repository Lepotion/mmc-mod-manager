const bridge = window.api;

const S = {
  state: null,
  page: 'mods',
  filter: 'all',
  search: '',
  sort: 'name',
  selected: null,
  files: {}, // mod id -> file list cache
  showAllFiles: false,
  nc: null, // nightcoop.net releases feed
  ncError: null,
  lookup: null, // Nexus mod opened on the Nexus page
  lookupRef: '',
  ob: { step: 0, nxm: true, autoDetected: false }, // first-run wizard
  coll: { name: '', onlyEnabled: false, built: null, building: false, code: '', preview: null },
  doc: { result: null, loading: false, error: null },
  jobs: [], // background downloads from the main process
  // Nexus catalog browser
  cat: { text: '', sort: 'popular', category: '', mods: [], total: 0, loading: false, loaded: false, error: null, req: 0, detail: null, detailId: null },
};

// ---------- helpers ----------

const $ = (sel, root = document) => root.querySelector(sel);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const ICONS = {
  mods: '<path d="M12 2 3 7v10l9 5 9-5V7z"/><path d="m3 7 9 5 9-5M12 12v10"/>',
  frameworks: '<rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><path d="M14 17.5h7M17.5 14v7"/>',
  profiles: '<path d="M4 6h16M4 12h16M4 18h10"/><circle cx="18" cy="18" r="2"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  play: '<path d="M7 4v16l13-8z" fill="currentColor"/>',
  folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M5 7l1 13h12l1-13M9 7V4h6v3"/>',
  link: '<path d="M10 14a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1"/><path d="M14 10a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1"/>',
  warn: '<path d="M12 3 2 21h20z"/><path d="M12 10v5M12 18v.01"/>',
  conflict: '<path d="M7 4v10M7 14l-3-3M7 14l3-3M17 20V10M17 10l-3 3M17 10l3 3"/>',
  box: '<path d="M12 2 3 7v10l9 5 9-5V7z"/><path d="m3 7 9 5 9-5M12 12v10"/>',
  search2: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5M8 11h6"/>',
  check: '<path d="m5 12 5 5 9-10"/>',
  upload: '<path d="M12 16V4M7 9l5-5 5 5"/><path d="M4 15v4a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-4"/>',
  refresh: '<path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 4v7h-7"/>',
  power: '<path d="M12 3v9"/><path d="M6.3 6.3a8 8 0 1 0 11.4 0"/>',
  nightcoop: '<circle cx="8" cy="8" r="3"/><circle cx="16" cy="8" r="3"/><path d="M2 20c0-3.3 2.7-6 6-6 1.5 0 2.9.6 4 1.5 1.1-.9 2.5-1.5 4-1.5 3.3 0 6 2.7 6 6"/>',
  nexus: '<path d="M12 3v12M7 10l5 5 5-5"/><path d="M5 21h14"/>',
  download: '<path d="M12 4v12M7 11l5 5 5-5"/><path d="M4 20h16"/>',
  downloads: '<path d="M12 3v11M7 9l5 5 5-5"/><rect x="3" y="17" width="18" height="4" rx="1"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 3.6-7 8-7s8 3 8 7"/>',
  logout: '<path d="M15 4h4v16h-4M10 8l-4 4 4 4M6 12h10"/>',
  star: '<path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z"/>',
  update: '<path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 4v7h-7"/>',
  catalog: '<path d="M3 9h18l-1.5-5h-15z"/><path d="M4 9v11h16V9"/><path d="M9 20v-6h6v6"/>',
  heart: '<path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
  collections: '<rect x="3" y="7" width="14" height="13" rx="1"/><path d="M7 4h13v13"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="1"/><path d="M16 8V4H4v12h4"/>',
  doctor: '<path d="M3 12h4l2-5 4 10 2-5h6"/>',
};
const icon = (name, extra = '') =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" ${extra}>${ICONS[name]}</svg>`;

function fmtSize(b) {
  const u = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  while (b >= 1024 && i < u.length - 1) { b /= 1024; i++; }
  return `${i ? b.toFixed(1) : b} ${u[i]}`;
}
const vtag = (v) => `v${esc(String(v).replace(/^v/i, ''))}`;
const fmtDate = (ts) => new Date(ts).toLocaleDateString(currentLang === 'ru' ? 'ru-RU' : 'en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' });

function errText(e) {
  const msg = e?.message || String(e);
  const code = (msg.match(/^(E[A-Z_]+)/) || [])[1];
  return code && I18N.en[`err.${code}`] ? t(`err.${code}`) : msg;
}

async function call(channel, ...args) {
  const r = await bridge.invoke(channel, ...args);
  if (!r.ok) throw new Error(r.error);
  return r.data;
}

// Runs a state-changing call, applies the returned state and reports errors.
async function act(channel, args = [], { busy = true, ok } = {}) {
  if (busy) showProgress(t('progress.working'));
  try {
    const data = await call(channel, ...args);
    if (data && data.mods) setState(data);
    if (ok) toast(ok);
    return data;
  } catch (e) {
    toast(errText(e), 'err');
    await refresh();
  } finally {
    if (busy) hideProgress();
  }
}

function setState(state) {
  S.state = state;
  if (S.selected && !state.mods.some((m) => m.id === S.selected)) S.selected = null;
  setLang(state.settings.language);
  render();
}

async function refresh() {
  setState(await call('state:get'));
}

const modById = (id) => S.state.mods.find((m) => m.id === id);
const hasIssues = (m) => m.conflicts.length > 0 || m.missing.length > 0;
const fwName = (id) => S.state.frameworks.find((f) => f.id === id)?.name || id;

// ---------- toasts / modals / progress ----------

function toast(text, kind = 'ok', onClick = null) {
  const el = document.createElement('div');
  el.className = `toast ${kind} ${onClick ? 'clickable' : ''}`;
  el.textContent = text;
  if (onClick) el.addEventListener('click', () => { el.remove(); onClick(); });
  $('#toasts').appendChild(el);
  setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 300); }, kind === 'err' ? 6000 : 3200);
}

// `sticky` modals ignore Escape and clicks outside (e.g. an installer waiting for an answer).
function modal(html, onMount, { sticky = false, cls = '' } = {}) {
  return new Promise((resolve) => {
    const root = document.createElement('div');
    root.className = 'modal-backdrop';
    root.innerHTML = `<div class="modal cut ${cls}">${html}</div>`;
    const close = (v) => { root.remove(); document.removeEventListener('keydown', onKey); resolve(v); };
    const onKey = (e) => { if (e.key === 'Escape' && !sticky) close(null); };
    root.addEventListener('mousedown', (e) => { if (e.target === root && !sticky) close(null); });
    document.addEventListener('keydown', onKey);
    $('#modalRoot').appendChild(root);
    onMount(root, close);
  });
}

function confirmDialog(title, text, okLabel, danger = false) {
  return modal(
    `<h3>${esc(title)}</h3><p>${esc(text)}</p>
     <div class="actions"><button class="btn ghost" data-v="0">${t('common.cancel')}</button>
     <button class="btn ${danger ? 'danger' : 'primary'}" data-v="1">${esc(okLabel)}</button></div>`,
    (root, close) => {
      root.querySelectorAll('[data-v]').forEach((b) => b.addEventListener('click', () => close(b.dataset.v === '1')));
      root.querySelector('[data-v="1"]').focus();
    },
  );
}

function promptDialog(title, placeholder) {
  return modal(
    `<h3>${esc(title)}</h3><input class="input" maxlength="80" placeholder="${esc(placeholder)}">
     <div class="actions"><button class="btn ghost" data-v="0">${t('common.cancel')}</button>
     <button class="btn primary" data-v="1">${t('common.save')}</button></div>`,
    (root, close) => {
      const input = root.querySelector('input');
      const submit = () => input.value.trim() && close(input.value.trim());
      input.addEventListener('keydown', (e) => e.key === 'Enter' && submit());
      root.querySelector('[data-v="0"]').addEventListener('click', () => close(null));
      root.querySelector('[data-v="1"]').addEventListener('click', submit);
      input.focus();
    },
  );
}

function pickDialog(title, items) {
  return modal(
    `<h3>${esc(title)}</h3><div class="pick-list">${items.map((it, i) => `<button class="pick-item" data-i="${i}">${esc(it)}</button>`).join('')}</div>
     <div class="actions"><button class="btn ghost" data-c>${t('common.cancel')}</button></div>`,
    (root, close) => {
      root.querySelectorAll('[data-i]').forEach((b) => b.addEventListener('click', () => close(Number(b.dataset.i))));
      root.querySelector('[data-c]').addEventListener('click', () => close(null));
    },
  );
}

function showProgress(title, frac = null, count = '') {
  const el = $('#progress');
  el.innerHTML = `<div class="progress-box cut"><div class="progress-title">${esc(title)}</div>
    <div class="bar ${frac === null ? 'indet' : ''}"><div style="width:${Math.round((frac || 0) * 100)}%"></div></div>
    <div class="progress-count">${esc(count)}</div></div>`;
  el.classList.add('show');
}
const hideProgress = () => $('#progress').classList.remove('show');

bridge.onProgress((p) => {
  if (p.phase === 'import') showProgress(t('progress.import', { name: p.name }), p.i / p.n, `${p.i + 1} / ${p.n}`);
  if (p.phase === 'download') {
    showProgress(t('progress.download', { name: p.name }), p.total ? p.received / p.total : null, p.total ? `${fmtSize(p.received)} / ${fmtSize(p.total)}` : fmtSize(p.received));
  }
  if (p.phase === 'collection') showProgress(t('progress.collection', { name: p.name }), p.i / p.n, `${p.i + 1} / ${p.n}`);
  if (p.phase === 'done') hideProgress();
});

// An nxm:// link was clicked in the browser while the app is open (or launched it).
bridge.onExternal(({ results, missing, error, state }) => {
  hideProgress();
  setState(state);
  if (error) return toast(errText(new Error(error)), 'err');
  showResults(results);
  offerDeps(missing);
});

// ---------- FOMOD installer wizard ----------

bridge.onFomod((p) => fomodWizard(p).then((choices) => bridge.fomodAnswer(p.id, choices)));

function fomodWizard({ name, cfg, images, initial, fileStates }) {
  const L = window.FomodLogic;
  const fileState = (f) => fileStates[f] || 'Missing';
  const exists = (id) => { const [s, g, p] = id.split(':').map(Number); return !!cfg.steps[s]?.groups[g]?.plugins[p]; };
  const selected = new Set((initial || []).filter(exists));
  // Steps the user already saw (or that came with earlier choices) keep their selection as is.
  const inited = new Set([...selected].map((id) => Number(id.split(':')[0])));
  const visibleSteps = () => cfg.steps.map((_, s) => s).filter((s) => L.stepVisible(cfg, s, selected, fileState));
  let cur = visibleSteps()[0] ?? -1;
  let focus = null;

  // No steps at all: only required files.
  if (cur < 0) return Promise.resolve([]);

  return modal('', (root, close) => {
    const box = root.querySelector('.modal');

    const draw = () => {
      if (!inited.has(cur)) {
        inited.add(cur);
        const { flags } = L.walk(cfg, selected, fileState, cur);
        for (const id of L.defaultsForStep(cfg, cur, flags, fileState)) selected.add(id);
      }
      const { flags } = L.walk(cfg, selected, fileState, cur);
      const st = cfg.steps[cur];
      const vis = visibleSteps();
      const pos = vis.indexOf(cur);
      const last = pos === vis.length - 1;
      const valid = st.groups.every((_, gi) => L.groupValid(cfg, cur, gi, selected));
      const single = (g) => g.type === 'SelectExactlyOne' || g.type === 'SelectAtMostOne';

      const fp = focus && cfg.steps[focus.s]?.groups[focus.g]?.plugins[focus.p];
      const shown = fp || st.groups.flatMap((g, gi) => g.plugins.map((p, pi) => (selected.has(L.pid(cur, gi, pi)) ? p : null))).find(Boolean);
      const img = (shown?.image && images[shown.image]) || (cfg.image && images[cfg.image]);

      box.innerHTML = `
        <div class="fo-head"><div class="nc-kicker">${t('fomod.kicker')}</div><h3>${esc(cfg.name || name)}</h3>
          <div class="fo-step">${esc(t('fomod.step', { n: pos + 1, total: vis.length }))}${st.name ? ` · ${esc(st.name)}` : ''}</div></div>
        <div class="fo-body">
          <div class="fo-groups">${st.groups.map((g, gi) => `
            <div class="fo-group"><div class="d-label"><span>${esc(g.name)}</span><span class="fo-rule">${t(`fomod.type.${g.type}`)}</span></div>
            ${g.plugins.map((p, pi) => {
              const id = L.pid(cur, gi, pi);
              const type = L.pluginType(p, flags, fileState);
              const locked = type === 'Required' || g.type === 'SelectAll';
              const off = type === 'NotUsable';
              return `<div class="fo-opt ${selected.has(id) ? 'on' : ''} ${off ? 'off' : ''} ${locked ? 'locked' : ''} ${single(g) ? 'radio' : ''}" data-fid="${id}">
                <span class="fo-mark"></span><span class="fo-name">${esc(p.name)}</span>
                ${type === 'Recommended' ? `<span class="badge ok">${t('fomod.recommended')}</span>` : ''}
                ${type === 'Required' ? `<span class="badge no">${t('fomod.required')}</span>` : ''}
              </div>`;
            }).join('')}
            ${L.groupValid(cfg, cur, gi, selected) ? '' : `<div class="fo-need">${t(`fomod.need.${g.type}`)}</div>`}
            </div>`).join('')}
          </div>
          <div class="fo-side">
            ${img ? `<img src="${img}" alt="">` : ''}
            ${shown ? `<div class="fo-desc-title">${esc(shown.name)}</div><div class="fo-desc">${esc(shown.description || '')}</div>` : ''}
          </div>
        </div>
        <div class="actions">
          <button class="btn ghost" data-fo="cancel">${t('common.cancel')}</button>
          <span class="spacer"></span>
          <button class="btn" data-fo="back" ${pos > 0 ? '' : 'disabled'}>${t('ob.back')}</button>
          <button class="btn primary cut" data-fo="${last ? 'finish' : 'next'}" ${valid ? '' : 'disabled'}>${last ? t('fomod.install') : t('ob.next')}</button>
        </div>`;
    };

    box.addEventListener('mouseover', (e) => {
      const opt = e.target.closest('[data-fid]');
      if (!opt) return;
      const [s, g, p] = opt.dataset.fid.split(':').map(Number);
      if (focus?.s === s && focus.g === g && focus.p === p) return;
      focus = { s, g, p };
      const pl = cfg.steps[s].groups[g].plugins[p];
      const side = box.querySelector('.fo-side');
      const im = (pl.image && images[pl.image]) || (cfg.image && images[cfg.image]);
      side.innerHTML = `${im ? `<img src="${im}" alt="">` : ''}<div class="fo-desc-title">${esc(pl.name)}</div><div class="fo-desc">${esc(pl.description || '')}</div>`;
    });

    box.addEventListener('click', (e) => {
      const opt = e.target.closest('[data-fid]');
      if (opt && !opt.classList.contains('off') && !opt.classList.contains('locked')) {
        const id = opt.dataset.fid;
        const [s, gi] = id.split(':').map(Number);
        const g = cfg.steps[s].groups[gi];
        if (g.type === 'SelectExactlyOne' || g.type === 'SelectAtMostOne') {
          const had = selected.has(id);
          g.plugins.forEach((_, pi) => selected.delete(L.pid(s, gi, pi)));
          if (!had || g.type === 'SelectExactlyOne') selected.add(id);
        } else if (selected.has(id)) selected.delete(id);
        else selected.add(id);
        return draw();
      }
      const btn = e.target.closest('[data-fo]');
      if (!btn || btn.disabled) return;
      const vis = visibleSteps();
      if (btn.dataset.fo === 'cancel') return close(null);
      if (btn.dataset.fo === 'back') cur = vis[vis.indexOf(cur) - 1] ?? cur;
      if (btn.dataset.fo === 'next') cur = vis[vis.indexOf(cur) + 1] ?? cur;
      if (btn.dataset.fo === 'finish') return close([...selected]);
      focus = null;
      draw();
    });

    draw();
  }, { sticky: true, cls: 'fo-modal' });
}

// ---------- dependencies ----------

async function offerDeps(missing) {
  if (!missing?.length) return;
  const ok = await confirmDialog(t('deps.title'), t('deps.text', { list: missing.map((m) => m.name).join(', ') }), t('deps.install'));
  if (ok) installDeps(missing);
}

async function installDeps(items) {
  showProgress(t('progress.working'));
  try {
    const r = await call('deps:install', items.map(({ modId, name }) => ({ modId, name })));
    showResults(r.results);
    setState(r.state);
    if (r.jobs) toast(t('jobs.addedN', { n: r.jobs }), 'info');
    if (r.queued) toast(t('coll.queued', { n: r.queued }), 'info');
  } catch (e) {
    toast(errText(e), 'err');
  } finally {
    hideProgress();
  }
}

// ---------- game running ----------

bridge.onState((st) => setState(st));

// When the game closes, the Doctor checks the fresh logs by itself.
bridge.onGameRunning(async (running) => {
  const was = S.state.running;
  S.state.running = running;
  render();
  if (!was || running || !S.state.game.valid) return;
  await runDoctor();
  const errors = S.doc.result?.issues.filter((i) => i.level === 'error').length || 0;
  if (errors) toast(t('run.doctorFound', { n: errors }), 'err', () => go('doctor'));
  else if (S.doc.result) toast(t('run.doctorClean'), 'ok');
});

// ---------- background downloads ----------

const JOB_ACTIVE = new Set(['queued', 'downloading', 'installing']);
const activeJobs = () => S.jobs.filter((j) => JOB_ACTIVE.has(j.status));
const jobFor = (match) => S.jobs.find((j) => JOB_ACTIVE.has(j.status) && match(j));
const jobPct = (j) => (j.status === 'installing' ? 100 : j.total ? Math.min(100, Math.round((j.received / j.total) * 100)) : 0);
const jobsKey = () => S.jobs.map((j) => `${j.id}:${j.status}`).join();

let lastJobsKey = '';
bridge.onJobs((jobs) => {
  S.jobs = jobs;
  const key = jobsKey();
  const statusChanged = key !== lastJobsKey;
  lastJobsKey = key;
  renderNav();
  renderGameCard();
  if (S.page === 'downloads') renderDownloads();
  // Other pages only redraw when a job starts or finishes; progress ticks just update the numbers.
  if (statusChanged) {
    if (S.page === 'nightcoop') renderNightCoop();
    if (S.cat.detailId) renderDrawer();
  } else {
    for (const j of jobs) document.querySelectorAll(`[data-job-pct="${j.id}"]`).forEach((el) => (el.textContent = `${jobPct(j)}%`));
  }
});

function fmtEta(j) {
  if (j.status !== 'downloading' || !j.speed || !j.total) return '';
  const s = Math.round((j.total - j.received) / j.speed);
  if (s < 60) return t('jobs.etaSec', { n: Math.max(1, s) });
  return t('jobs.etaMin', { n: Math.round(s / 60) });
}

function renderDownloads() {
  const active = activeJobs();
  const done = S.jobs.filter((j) => !JOB_ACTIVE.has(j.status)).reverse();
  const row = (j) => {
    const pct = jobPct(j);
    const sizes = j.total ? `${fmtSize(j.received)} / ${fmtSize(j.total)}` : j.received ? fmtSize(j.received) : '';
    const meta = [t(`jobs.status.${j.status}`), j.status === 'downloading' ? sizes : '', j.speed && j.status === 'downloading' ? `${fmtSize(j.speed)}/s` : '', fmtEta(j)].filter(Boolean).join(' · ');
    return `<div class="job ${j.status}">
      <div class="job-icon">${icon(j.kind === 'nightcoop' ? 'nightcoop' : 'download')}</div>
      <div class="job-main">
        <div class="job-top"><span class="job-name">${esc(j.name)}</span><span class="job-meta">${esc(meta)}</span></div>
        ${JOB_ACTIVE.has(j.status) ? `<div class="bar ${j.status === 'installing' || (j.status === 'downloading' && !j.total) ? 'indet' : ''}"><div style="width:${pct}%"></div></div>` : ''}
        ${j.status === 'error' ? `<div class="job-err">${esc(errText(new Error(j.error)))}</div>` : ''}
      </div>
      <div class="job-act">
        ${j.status === 'queued' || j.status === 'downloading' ? `<button class="btn sm ghost" data-job-cancel="${j.id}">${icon('close')}${t('common.cancel')}</button>` : ''}
        ${j.status === 'done' && j.modId && modById(j.modId) ? `<button class="btn sm" data-select-mod="${j.modId}">${t('doc.showMod')}</button>` : ''}
      </div>
    </div>`;
  };
  $('#page').innerHTML = `${pageHead(t('jobs.title'), t('jobs.subtitle'),
      done.length ? `<button class="btn ghost" data-action="jobsClear">${t('jobs.clear')}</button>` : '')}
    <div class="page-body"><div class="settings" style="max-width:900px">
      ${active.length ? `<div class="d-label">${esc(t('jobs.activeN', { n: active.length }))}</div><div class="jobs">${active.map(row).join('')}</div>` : ''}
      ${!S.jobs.length ? `<div class="empty"><div class="big-icon">${icon('download', 'stroke-width="1.2"')}</div><h3>${t('jobs.emptyTitle')}</h3><p>${t('jobs.emptyText')}</p>
        <button class="btn primary cut" data-page="catalog">${icon('catalog')}${t('nav.catalog')}</button></div>` : ''}
      ${done.length ? `<div class="d-label" style="margin-top:8px">${t('jobs.finished')}</div><div class="jobs">${done.map(row).join('')}</div>` : ''}
    </div></div>`;
}

function showResults(results = []) {
  for (const r of results) {
    if (r.ok) toast(t(r.updated ? 'toast.updated' : 'toast.installed', { name: r.name }));
    else toast(t('toast.failed', { file: r.file, error: errText(new Error(r.error)) }), 'err');
  }
  const last = [...results].reverse().find((r) => r.ok);
  if (last) {
    S.selected = last.id;
    delete S.files[last.id];
  }
}

// ---------- rendering ----------

function render() {
  if (!S.state) return;
  renderNav();
  renderGameCard();
  const pages = { mods: renderMods, downloads: renderDownloads, doctor: renderDoctor, catalog: renderCatalog, collections: renderCollections, nightcoop: renderNightCoop, nexus: renderNexus, frameworks: renderFrameworks, profiles: renderProfiles, settings: renderSettings };
  pages[S.page]();
  renderDrawer();
  renderOnboarding();
  $('#dropTitle').textContent = t('mods.drop');
  $('#dropHint').textContent = t('mods.dropHint');
}

function renderNav() {
  const missingFw = S.state.frameworks.some((f) => f.requiredBy && !f.installed);
  const updates = S.state.mods.filter((m) => m.update).length;
  const items = [
    ['mods', `<span class="count">${S.state.mods.length}</span>`],
    ['catalog', ''],
    ['downloads', activeJobs().length ? `<span class="count accent">${activeJobs().length}</span>` : ''],
    ['collections', S.state.queue ? `<span class="count accent">${S.state.queue.left}</span>` : ''],
    ['nightcoop', ncUpdate() ? '<span class="dot-new"></span>' : ''],
    ['nexus', updates ? `<span class="count accent">${updates}</span>` : S.state.nexus.user ? '' : '<span class="dot-off"></span>'],
    ['doctor', S.doc.result?.issues.some((i) => i.level === 'error') ? '<span class="dot-err"></span>' : ''],
    ['frameworks', missingFw ? '<span class="dot-warn"></span>' : ''],
    ['profiles', S.state.profiles.length ? `<span class="count">${S.state.profiles.length}</span>` : ''],
    ['settings', ''],
  ];
  $('#nav').innerHTML = items
    .map(([id, extra]) => `<button class="nav-btn ${S.page === id ? 'active' : ''} ${id === 'nightcoop' ? 'featured' : ''}" data-page="${id}">${icon(id)}<span>${t(`nav.${id}`)}</span>${extra}</button>`)
    .join('');
}

function renderGameCard() {
  const g = S.state.game;
  const upd = S.state.app.update;
  const updCard = upd
    ? `<div class="upd-card cut"><div class="label">${t('upd.available')}</div>
        <div class="upd-ver">v${esc(upd.version)}</div>
        <button class="btn sm cyan block" data-action="installUpdate">${icon('download')}${t('upd.install')}</button></div>`
    : '';
  // Downloads in progress: total progress, click opens the Downloads tab.
  const act = activeJobs();
  const got = act.reduce((n, j) => n + (j.status === 'installing' ? j.total : j.received), 0);
  const all = act.reduce((n, j) => n + j.total, 0);
  const dlCard = act.length && S.page !== 'downloads'
    ? `<div class="dl-mini cut" data-page="downloads" role="button">
        <div class="label">${esc(t('jobs.mini', { n: act.length }))}</div>
        <div class="dl-mini-name">${esc(act[0].name)}${act.length > 1 ? ` +${act.length - 1}` : ''}</div>
        <div class="bar ${all ? '' : 'indet'}"><div style="width:${all ? Math.round((got / all) * 100) : 0}%"></div></div>
      </div>`
    : '';
  $('#gameCard').innerHTML = dlCard + updCard + (g.valid
    ? `<div class="game-card cut">
        <div class="label">${t(`game.store.${g.store}`)}</div>
        <div class="title">Cyberpunk 2077</div>
        <div class="meta"><span class="status-dot"></span>${esc(t('mods.subtitle', { n: S.state.mods.length, e: S.state.mods.filter((m) => m.enabled).length }))}</div>
        ${S.state.running
          ? `<div class="running cut"><span class="pulse"></span>${t('run.running')}</div>`
          : `<button class="btn primary launch block cut" data-action="launch">${icon('play')}${t('game.launch')}</button>`}
      </div>`
    : `<div class="game-card cut">
        <div class="label">Cyberpunk 2077</div>
        <div class="meta" style="margin-top:6px"><span class="status-dot off"></span>${t('game.notSet')}</div>
        <button class="btn cyan block" data-action="goSettings">${t('game.setup')}</button>
      </div>`);
}

function pageHead(title, sub, actions = '') {
  return `<div class="page-head"><div><h1 class="page-title">${title}</h1><div class="page-sub">${sub}</div></div>
    <div class="head-actions">${actions}</div></div>`;
}

// ----- mods page -----

function filteredMods() {
  const q = S.search.trim().toLowerCase();
  let list = S.state.mods.filter((m) => {
    if (S.filter === 'enabled' && !m.enabled) return false;
    if (S.filter === 'disabled' && m.enabled) return false;
    if (S.filter === 'issues' && !hasIssues(m)) return false;
    return !q || m.name.toLowerCase().includes(q) || m.tags.some((tg) => t(`tag.${tg}`).toLowerCase().includes(q)) || (m.notes || '').toLowerCase().includes(q);
  });
  const sorters = {
    name: (a, b) => a.name.localeCompare(b.name),
    date: (a, b) => b.installedAt - a.installedAt,
    size: (a, b) => b.size - a.size,
  };
  return list.sort(sorters[S.sort]);
}

function renderMods() {
  const mods = S.state.mods;
  const enabled = mods.filter((m) => m.enabled).length;
  const g = S.state.game;

  if (!g.valid) {
    $('#page').innerHTML = `${pageHead(`${t('mods.title')}`, '')}
      <div class="page-body"><div class="empty">
        <div class="big-icon">${icon('box', 'stroke-width="1.2"')}</div>
        <h3>${t('onboard.title')}</h3><p>${t('onboard.text')}</p>
        <div class="row"><button class="btn primary cut" data-action="detect">${icon('search')}${t('settings.detect')}</button>
        <button class="btn" data-action="browse">${icon('folder')}${t('settings.browse')}</button></div>
      </div></div>`;
    return;
  }

  const count = (f) => mods.filter(f).length;
  const chips = [
    ['all', mods.length],
    ['enabled', enabled],
    ['disabled', mods.length - enabled],
    ['issues', count(hasIssues)],
  ];

  $('#page').innerHTML = `
    ${pageHead(`${t('mods.title')}`, esc(t('mods.subtitle', { n: mods.length, e: enabled })),
      `<button class="btn ghost" data-action="enableAll" ${mods.length === enabled ? 'disabled' : ''}>${t('mods.enableAll')}</button>
       <button class="btn ghost" data-action="disableAll" ${!enabled ? 'disabled' : ''}>${t('mods.disableAll')}</button>
       <button class="btn primary cut" data-action="install">${icon('plus')}${t('mods.install')}</button>`)}
    ${bisectBanner()}
    ${S.state.running ? `<div class="banner notice warn">${t('run.banner')}</div>` : ''}
    ${g.unmanaged ? `<div class="banner notice info">${esc(t('mods.unmanaged', { n: g.unmanaged }))}</div>` : ''}
    <div class="toolbar">
      <div class="search">${icon('search')}<input id="search" placeholder="${t('mods.search')}" value="${esc(S.search)}"></div>
      <div class="chips">${chips.map(([id, n]) => `<button class="chip ${S.filter === id ? 'active' : ''}" data-filter="${id}">${t(`filter.${id}`)}<span class="n">${n}</span></button>`).join('')}</div>
      <div class="spacer"></div>
      <select class="input select-sm" id="sort">${['name', 'date', 'size'].map((s) => `<option value="${s}" ${S.sort === s ? 'selected' : ''}>${t(`sort.${s}`)}</option>`).join('')}</select>
    </div>
    <div class="mods-split">
      <div class="mod-list" id="modList"></div>
      <div class="details" id="details"></div>
    </div>`;
  renderModList();
  renderDetails();
}

function modRow(m) {
  const flags = [];
  if (m.update) flags.push(`<span class="flag info">${icon('update')}${t('mod.updateShort')}</span>`);
  if (m.missing.length) flags.push(`<span class="flag err">${icon('warn')}${esc(t('mod.missingShort', { list: m.missing.map(fwName).join(', ') }))}</span>`);
  if (m.conflicts.length) flags.push(`<span class="flag warn">${icon('conflict')}${t('mod.conflictCount', { n: m.conflicts.length })}</span>`);
  return `<div class="mod-row ${m.enabled ? '' : 'off'} ${S.selected === m.id ? 'selected' : ''}" data-id="${m.id}">
    <label class="switch" data-stop><input type="checkbox" data-toggle="${m.id}" ${m.enabled ? 'checked' : ''}><span class="track"></span></label>
    <div class="mod-main">
      <div class="mod-name" title="${esc(m.name)}">${esc(m.name)}</div>
      <div class="mod-sub">${m.version ? `<span class="mod-ver">${vtag(m.version)}</span>` : ''}${m.tags.map((tg) => `<span class="tag ${tg}">${t(`tag.${tg}`)}</span>`).join('')}</div>
    </div>
    <div class="mod-flags">${flags.join('')}</div>
    <div class="mod-size">${fmtSize(m.size)}</div>
    <div class="mod-date">${fmtDate(m.installedAt)}</div>
  </div>`;
}

function renderModList() {
  const el = $('#modList');
  if (!el) return;
  if (!S.state.mods.length) {
    el.innerHTML = `<div class="empty">
      <div class="big-icon">${icon('upload', 'stroke-width="1.2"')}</div>
      <h3>${t('mods.empty.title')}</h3><p>${t('mods.empty.text')}</p>
      <button class="btn primary cut" data-action="install">${icon('plus')}${t('mods.install')}</button></div>`;
    return;
  }
  const list = filteredMods();
  el.innerHTML = list.length ? list.map(modRow).join('') : `<div class="empty"><p>${t('mods.noResults')}</p></div>`;
}

function renderDetails() {
  const el = $('#details');
  if (!el) return;
  const m = S.selected && modById(S.selected);
  if (!m) {
    el.innerHTML = `<div class="details-empty">${icon('box', 'stroke-width="1.2"')}<div>${t('mods.selectHint')}</div></div>`;
    return;
  }

  const conflicts = m.conflicts.map(modById).filter(Boolean);
  const files = S.files[m.id];
  const shown = files ? (S.showAllFiles ? files : files.slice(0, 120)) : null;

  el.innerHTML = `
    <div class="d-head">
      <div class="d-name">${esc(m.name)}</div>
      <div class="d-status">
        <span class="status-dot ${m.enabled ? '' : 'off'}"></span>${m.enabled ? t('mod.enabled') : t('mod.disabled')}
        ${m.tags.map((tg) => `<span class="tag ${tg}">${t(`tag.${tg}`)}</span>`).join('')}
      </div>
      <div class="d-actions">
        <button class="btn sm ${m.enabled ? '' : 'primary'}" data-action="toggleSelected">${icon('power')}${m.enabled ? t('mod.disable') : t('mod.enable')}</button>
        <button class="btn sm" data-action="openModFolder">${icon('folder')}${t('mod.openFolder')}</button>
        ${m.nexusUrl ? `<button class="btn sm cyan" data-action="openNexus">${icon('link')}${t('mod.openNexus')}</button>` : ''}
        <button class="btn sm icon danger" data-action="deleteSelected" title="${t('mod.delete')}">${icon('trash')}</button>
      </div>
    </div>

    ${m.update ? `<div class="d-section"><div class="notice info">${esc(t('mod.updateAvail', { v: m.update.version || '?' }))}
      <div style="margin-top:8px"><button class="btn sm cyan" data-action="updateSelected">${icon('download')}${t('mod.updateNow')}</button></div></div></div>` : ''}

    ${m.missing.length ? `<div class="d-section"><div class="notice err"><b>${t('mod.missing')}:</b>
      <ul class="link-list">${m.missing.map((r) => `<li>${icon('warn', 'width="14" height="14"')}<a data-url="${esc(S.state.frameworks.find((f) => f.id === r)?.url)}">${esc(fwName(r))}</a></li>`).join('')}</ul>
      <button class="btn sm primary" style="margin-top:8px" data-fw-install="${esc(m.missing.join(','))}">${icon('download')}${t('deps.installMissing')}</button></div></div>` : ''}

    ${conflicts.length ? `<div class="d-section"><div class="d-label">${t('mod.conflicts')}</div>
      <div class="notice warn">${t('mod.conflictsHint')}</div>
      <div class="nx-files">${m.conflictInfo.map((ci) => {
        const c = modById(ci.id);
        if (!c) return '';
        const winsAll = ci.mine === ci.shared;
        return `<div class="nx-file"><div style="min-width:0">
            <div class="nx-file-name"><a class="link" data-select="${c.id}">${esc(c.name)}</a>${c.enabled ? '' : `<span class="muted">(${t('mod.disabled').toLowerCase()})</span>`}</div>
            <div class="build-meta">${esc(t('mod.sharedFiles', { n: ci.shared }))} · ${esc(m.enabled && c.enabled ? (winsAll ? t('mod.winsAll') : ci.mine ? t('mod.winsSome', { n: ci.mine }) : t('mod.losesAll')) : t('mod.noClash'))}</div>
          </div>${m.enabled && c.enabled && !winsAll ? `<button class="btn sm" data-winner="${m.id}">${t('mod.makeWinner')}</button>` : winsAll && m.enabled && c.enabled ? `<span class="badge ok">${t('mod.winner')}</span>` : ''}</div>`;
      }).join('')}</div></div>` : ''}

    <div class="d-section">
      <div class="stats">
        <div class="stat"><div class="k">${t('mod.files')}</div><div class="v">${m.fileCount}</div></div>
        <div class="stat"><div class="k">${t('mod.size')}</div><div class="v">${fmtSize(m.size)}</div></div>
        <div class="stat"><div class="k">${t('mod.installed')}</div><div class="v">${fmtDate(m.installedAt)}</div></div>
        <div class="stat"><div class="k">${t('mod.source')}</div><div class="v" title="${esc(m.source)}">${esc(m.source)}</div></div>
      </div>
    </div>

    <div class="d-section">
      <div class="field"><label>${t('mod.name')}</label><input class="input" data-field="name" value="${esc(m.name)}"></div>
      <div class="field-row">
        <div class="field" style="width:110px"><label>${t('mod.version')}</label><input class="input" data-field="version" value="${esc(m.version)}"></div>
        <div class="field" style="flex:1"><label>${t('mod.nexus')}</label><input class="input" data-field="nexusUrl" value="${esc(m.nexusUrl)}" placeholder="https://www.nexusmods.com/…"></div>
      </div>
      <div class="field" style="margin:0"><label>${t('mod.notes')}</label><textarea class="input" data-field="notes" placeholder="${t('mod.notesPh')}">${esc(m.notes)}</textarea></div>
    </div>

    <div class="d-section">
      <div class="d-label"><span>${t('mod.fileList')}</span><span class="mono">${m.fileCount}</span></div>
      <div class="file-list">${shown ? shown.map((f) => {
        const i = f.lastIndexOf('/');
        return `<div title="${esc(f)}"><span class="dir">${esc(f.slice(0, i + 1))}</span>${esc(f.slice(i + 1))}</div>`;
      }).join('') : '…'}</div>
      ${files && files.length > shown.length ? `<button class="btn sm ghost" style="margin-top:6px" data-action="showAllFiles">${t('mod.showAll', { n: files.length })}</button>` : ''}
      ${m.skipped?.length ? `<div class="notice warn" style="margin-top:10px">${esc(t('mod.skipped', { n: m.skipped.length }))}<div class="mono" style="font-size:11px;margin-top:4px">${m.skipped.map(esc).join('<br>')}</div></div>` : ''}
    </div>`;

  if (!files) {
    call('mods:files', m.id).then((f) => { S.files[m.id] = f; if (S.selected === m.id) renderDetails(); }).catch(() => {});
  }
}

// ----- NightCoop -----

const NC_SITE = 'https://nightcoop.net/';
const NC_DISCORD = 'https://discord.gg/6UvSdSmaTM';
const ncMod = () => S.state.mods.find((m) => m.key === 'nightcoop');
const ncLatest = () => S.nc && (S.nc.releases.find((r) => r.version === S.nc.latest) || S.nc.releases[0]);
const localized = (obj) => (obj && (obj[currentLang] || obj.en)) || '';
const yankReason = (y) => (typeof y === 'string' ? y : localized(y?.reason) || y?.reason || '');

function ncUpdate() {
  const mod = ncMod();
  const latest = ncLatest();
  return !!(mod && latest && !latest.yanked && mod.origin?.version !== latest.version);
}

function ncVariant(rel) {
  const variants = rel?.game || [];
  const saved = S.state.settings.ncVariant;
  return variants.includes(saved) ? saved : variants[0] || null;
}

async function loadNightCoop(force = false) {
  try {
    S.nc = await call('nc:releases', force);
    S.ncError = null;
  } catch (e) {
    S.ncError = errText(e);
  }
  renderNav();
  if (S.page === 'nightcoop') renderNightCoop();
}

function renderNightCoop() {
  const mod = ncMod();
  const latest = ncLatest();
  const installed = mod?.origin?.version || null;
  const variant = ncVariant(latest);
  const fileFor = (rel) => (rel.files || []).filter((f) => f.kind === 'mod').find((f) => !f.game || f.game.includes(variant)) || rel.files?.[0];
  const g = S.state.game;

  const ncJob = jobFor((j) => j.kind === 'nightcoop');
  let primary;
  if (ncJob) {
    primary = ncJob.status === 'installing'
      ? `<button class="btn primary launch cut" data-page="downloads">${icon('downloads')}${t('jobs.status.installing')}…</button>`
      : `<button class="btn primary launch cut" data-page="downloads">${icon('downloads')}${esc(t('nc.downloading', { v: ncJob.ref.version }))} <span data-job-pct="${ncJob.id}">${jobPct(ncJob)}%</span></button>`;
  }
  else if (!latest) primary = '';
  else if (!mod) primary = `<button class="btn primary launch cut" data-nc-install="${esc(latest.version)}" ${g.valid ? '' : 'disabled'}>${icon('download')}${t('nc.install', { v: latest.version })}</button>`;
  else if (ncUpdate()) primary = `<button class="btn primary launch cut" data-nc-install="${esc(latest.version)}">${icon('update')}${t('nc.update', { v: latest.version })}</button>`;
  else primary = `<button class="btn" data-nc-install="${esc(installed)}">${icon('refresh')}${t('nc.reinstall')}</button>`;

  const status = mod
    ? `<span class="nc-chip ${mod.enabled ? 'ok' : ''}"><span class="status-dot ${mod.enabled ? '' : 'off'}"></span>${esc(t('nc.installedVer', { v: installed || mod.version }))}</span>
       ${mod.origin?.protocol != null ? `<span class="nc-chip">${esc(t('nc.protocol', { n: mod.origin.protocol }))}</span>` : ''}
       ${mod.origin?.variant ? `<span class="nc-chip">${esc(t('nc.forGame', { v: mod.origin.variant }))}</span>` : ''}`
    : `<span class="nc-chip"><span class="status-dot off"></span>${t('nc.notInstalled')}</span>`;

  const lf = latest && fileFor(latest);
  const side = latest
    ? `<div class="nc-side">
        <div class="nc-side-label">${t('nc.latest')}</div>
        <div class="nc-side-ver">${vtag(latest.version)} <span class="badge ${latest.channel === 'beta' ? 'beta' : 'ok'}">${esc(latest.channel || '')}</span></div>
        <div class="stats" style="margin-top:14px">
          <div class="stat"><div class="k">${t('nc.date')}</div><div class="v">${esc(latest.date || '—')}</div></div>
          <div class="stat"><div class="k">${t('nc.game')}</div><div class="v">${esc((latest.game || []).join(' · '))}</div></div>
          <div class="stat"><div class="k">${t('nc.protocolK')}</div><div class="v">${esc(latest.protocol ?? '—')}</div></div>
          <div class="stat"><div class="k">${t('mod.size')}</div><div class="v">${lf ? fmtSize(lf.size) : '—'}</div></div>
        </div>
      </div>`
    : `<div class="nc-side"><div class="muted">${S.ncError ? esc(S.ncError) : t('nc.loading')}</div>
        ${S.ncError ? `<button class="btn sm" style="margin-top:10px" data-action="ncReload">${icon('refresh')}${t('nc.retry')}</button>` : ''}</div>`;

  const variants = latest?.game || [];
  const builds = S.nc
    ? S.nc.releases.map((r) => {
        const f = fileFor(r);
        const isInstalled = installed === r.version;
        return `<div class="build-row ${r.yanked ? 'yanked' : ''}">
          <div><div class="build-ver">${vtag(r.version)} ${r.version === S.nc.latest ? `<span class="badge active">${t('nc.newest')}</span>` : ''}
            <span class="badge ${r.channel === 'beta' ? 'beta' : 'ok'}">${esc(r.channel || '')}</span></div>
            <div class="build-meta">${esc(r.date || '')} · ${esc(t('nc.protocol', { n: r.protocol ?? '—' }))} · ${f ? fmtSize(f.size) : ''}</div>
            ${r.yanked ? `<div class="build-yank">${icon('warn', 'width="13" height="13"')} ${esc(t('nc.yanked'))}${yankReason(r.yanked) ? `: ${esc(yankReason(r.yanked))}` : ''}</div>` : ''}
          </div>
          ${ncJob?.ref.version === r.version ? `<button class="btn sm" data-page="downloads">${icon('downloads')}<span data-job-pct="${ncJob.id}">${jobPct(ncJob)}%</span></button>`
            : isInstalled ? `<span class="badge ok">${t('nc.isInstalled')}</span>`
            : `<button class="btn sm" data-nc-install="${esc(r.version)}" ${g.valid && !ncJob ? '' : 'disabled'}>${icon('download')}${t('nc.installThis')}</button>`}
        </div>`;
      }).join('')
    : '';

  const notes = latest ? (latest.notes?.[currentLang] || latest.notes?.en || []) : [];

  $('#page').innerHTML = `<div class="page-body nc-page">
    <section class="nc-hero cut">
      <div class="nc-hero-main">
        <div class="nc-kicker">${t('nc.kicker')}</div>
        <h1 class="nc-title">NIGHT<span>COOP</span></h1>
        <p class="nc-desc">${t('nc.desc')}</p>
        <p class="nc-unofficial">${t('nc.unofficial')}</p>
        <div class="nc-status">${status}</div>
        <div class="nc-actions">
          ${primary}
          ${mod ? `<button class="btn ${mod.enabled ? '' : 'cyan'}" data-action="ncToggle">${icon('power')}${mod.enabled ? t('mod.disable') : t('mod.enable')}</button>
                   <button class="btn icon danger" data-action="ncDelete" title="${t('mod.delete')}">${icon('trash')}</button>` : ''}
          <span class="spacer"></span>
          <button class="btn ghost sm" data-url="${NC_SITE}">${icon('link')}${t('nc.site')}</button>
          <button class="btn ghost sm" data-url="${NC_DISCORD}">${icon('link')}Discord</button>
        </div>
        ${!g.valid ? `<div class="notice warn" style="margin-top:14px">${t('err.E_NO_GAME')}</div>` : ''}
      </div>
      ${side}
    </section>

    ${variants.length > 1 ? `<div class="set-group cut nc-variant">
      <div><h4>${t('nc.variantTitle')}</h4><div class="hint" style="margin:0">${t('nc.variantHint')}</div></div>
      <div class="chips">${variants.map((v) => `<button class="chip ${v === variant ? 'active' : ''}" data-nc-variant="${esc(v)}">${t('nc.gameVer', { v })}</button>`).join('')}</div>
    </div>` : ''}

    <div class="nc-cols">
      <div class="set-group cut">
        <h4>${latest ? esc(t('nc.whatsNew', { v: latest.version })) : t('nc.whatsNewEmpty')}</h4>
        ${latest?.title ? `<div class="hint">${esc(localized(latest.title))}</div>` : ''}
        <ul class="nc-notes">${notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>
      </div>
      <div class="set-group cut">
        <h4>${t('nc.allBuilds')}</h4>
        <div class="hint">${t('nc.protocolHint')}</div>
        <div class="builds">${builds}</div>
        <div class="notice info" style="margin-top:12px">${t('nc.red4extNote')}</div>
      </div>
    </div>
  </div>`;
}

// ----- Nexus -----

function renderNexus() {
  const nx = S.state.nexus;
  const user = nx.user;
  const withNexus = S.state.mods.filter((m) => m.origin?.type === 'nexus');
  const updates = S.state.mods.filter((m) => m.update);

  const account = user
    ? `<div class="nx-account">
        <div class="nx-avatar">${user.avatar ? `<img src="${esc(user.avatar)}" alt="">` : icon('user')}</div>
        <div style="flex:1;min-width:0">
          <div class="card-title">${esc(user.name)}</div>
          <div class="card-sub">${user.premium ? t('nexus.premiumText') : t('nexus.freeText')}</div>
        </div>
        <span class="badge ${user.premium ? 'active' : 'no'}">${user.premium ? 'Premium' : t('nexus.free')}</span>
        <button class="btn sm ghost" data-action="nexusLogout">${icon('logout')}${t('nexus.logout')}</button>
      </div>`
    : `<div class="hint">${t('nexus.loginText')}</div>
       ${nx.sso ? `<button class="btn primary cut" data-action="nexusSso">${icon('user')}${t('nexus.sso')}</button><div class="nx-or">${t('nexus.or')}</div>` : ''}
       <div class="set-row">
         <input class="input mono" id="nexusKey" type="password" placeholder="${t('nexus.keyPh')}" autocomplete="off">
         <button class="btn ${nx.sso ? '' : 'primary'}" data-action="nexusLogin">${t('nexus.login')}</button>
       </div>
       <div style="margin-top:8px"><a class="link" data-url="${esc(nx.keyPage)}">${t('nexus.whereKey')}</a></div>`;

  const lk = S.lookup;
  const lookup = !user ? '' : `<div class="set-group cut">
      <h4>${t('nexus.byLink')}</h4>
      <div class="hint">${t('nexus.byLinkHint')}</div>
      <div class="set-row">
        <input class="input" id="nexusRef" placeholder="https://www.nexusmods.com/cyberpunk2077/mods/107" value="${esc(S.lookupRef)}">
        <button class="btn primary" data-action="nexusLookup">${icon('search')}${t('nexus.find')}</button>
      </div>
      ${lk ? `<div class="nx-mod">
        ${lk.picture ? `<img class="nx-pic" src="${esc(lk.picture)}" alt="">` : ''}
        <div class="nx-mod-info">
          <div class="card-title">${esc(lk.name)}</div>
          <div class="card-sub">${esc(t('nexus.by', { author: lk.author || '?' }))} · ${vtag(lk.version || '?')}</div>
          <div class="nx-summary">${esc(lk.summary)}</div>
          <button class="btn sm ghost" style="margin-top:6px" data-url="${esc(lk.url)}">${icon('link')}${t('nexus.openPage')}</button>
        </div>
      </div>
      <div class="nx-files">${lk.files.map((f) => `<div class="nx-file ${lk.highlightFile === f.fileId ? 'hl' : ''}">
          <div style="min-width:0">
            <div class="nx-file-name">${esc(f.name)} ${f.version ? `<span class="mod-ver">${vtag(f.version)}</span>` : ''}</div>
            <div class="build-meta"><span class="tag">${esc(t(`nexus.cat.${f.category}`))}</span> ${fmtSize(f.size)} · ${f.uploaded ? fmtDate(f.uploaded) : ''}</div>
            ${f.description ? `<div class="nx-file-desc">${esc(f.description)}</div>` : ''}
          </div>
          ${lk.installed === f.fileId ? `<span class="badge ok">${t('nc.isInstalled')}</span>`
            : user.premium ? `<button class="btn sm primary" data-nx-install="${lk.modId}:${f.fileId}" ${S.state.game.valid ? '' : 'disabled'}>${icon('download')}${t('nexus.install')}</button>`
            : `<button class="btn sm cyan" data-url="https://www.nexusmods.com/cyberpunk2077/mods/${lk.modId}?tab=files&file_id=${f.fileId}">${icon('link')}${t('nexus.getOnSite')}</button>`}
        </div>`).join('')}</div>` : ''}
    </div>`;

  const updatesCard = !user ? '' : `<div class="set-group cut">
      <div class="check-row" style="padding-top:0">
        <div><h4>${t('nexus.updates')}</h4><div class="hint" style="margin:0">${esc(t('nexus.updatesHint', { n: withNexus.length }))}</div></div>
        <button class="btn" data-action="checkUpdates" ${withNexus.length ? '' : 'disabled'}>${icon('refresh')}${t('nexus.check')}</button>
      </div>
      <div class="check-row">
        <div><div>${t('nexus.autoCheck')}</div><div class="hint" style="margin:2px 0 0">${t('nexus.autoCheckHint')}</div></div>
        <label class="switch"><input type="checkbox" data-setting="autoModUpdates" ${S.state.settings.autoModUpdates ? 'checked' : ''}><span class="track"></span></label>
      </div>
      ${updates.length > 1 ? `<button class="btn primary cut" style="margin-top:4px" data-action="updateAll">${icon('download')}${t('nexus.updateAll', { n: updates.length })}</button>` : ''}
      ${updates.length ? `<div class="nx-files">${updates.map((m) => `<div class="nx-file">
          <div><div class="nx-file-name">${esc(m.name)}</div><div class="build-meta">${vtag(m.version || '?')} → ${vtag(m.update.version || '?')}</div></div>
          <button class="btn sm cyan" data-nx-update="${m.id}">${icon('download')}${t('mod.updateNow')}</button></div>`).join('')}</div>` : ''}
    </div>`;

  $('#page').innerHTML = `${pageHead('Nexus Mods', `${t('nexus.subtitle')}<br><span class="muted" style="font-size:12px">${t('nexus.unofficial')}</span>`)}
    <div class="page-body"><div class="settings">
      <div class="set-group cut"><h4>${t('nexus.account')}</h4>${account}</div>
      <div class="set-group cut">
        <div class="check-row" style="padding:0">
          <div><h4>${t('nexus.nxm')}</h4><div class="hint" style="margin:0">${t('nexus.nxmHint')}</div></div>
          <label class="switch"><input type="checkbox" data-nxm ${nx.nxm ? 'checked' : ''}><span class="track"></span></label>
        </div>
      </div>
      ${lookup}
      ${updatesCard}
    </div></div>`;
}

function nexusSso() {
  const slug = S.state.nexus.sso;
  const id = crypto.randomUUID();
  let ws;
  modal(
    `<h3>${t('nexus.sso')}</h3><p>${t('nexus.ssoWaiting')}</p>
     <div class="bar indet"><div></div></div>
     <div class="actions"><button class="btn ghost" data-c>${t('common.cancel')}</button></div>`,
    (root, close) => {
      root.querySelector('[data-c]').addEventListener('click', () => close(null));
      ws = new WebSocket('wss://sso.nexusmods.com');
      ws.onopen = () => {
        ws.send(JSON.stringify({ id, token: null, protocol: 2 }));
        call('open:url', `https://www.nexusmods.com/sso?id=${id}&application=${encodeURIComponent(slug)}`);
      };
      ws.onmessage = async (e) => {
        const msg = JSON.parse(e.data);
        if (msg.success && msg.data?.api_key) {
          close(null);
          await act('nexus:login', [msg.data.api_key], { ok: t('nexus.welcome') });
        } else if (!msg.success) {
          close(null);
          toast(msg.error || t('nexus.ssoFailed'), 'err');
        }
      };
      ws.onerror = () => { close(null); toast(t('nexus.ssoFailed'), 'err'); };
    },
  ).then(() => ws && ws.close());
}

// ----- culprit finder -----

function bisectBanner() {
  const b = S.state.bisect;
  if (!b) return '';
  if (b.culprit) {
    const m = modById(b.culprit);
    return `<div class="banner bisect done cut">
      <div class="bisect-main"><div class="nc-kicker">${t('bis.kicker')}</div>
        <div class="bisect-title">${esc(t('bis.found', { mod: m?.name || '?' }))}</div>
        <div class="muted">${t('bis.foundText')}</div></div>
      <div class="d-actions">
        <button class="btn danger" data-bisect-end="1">${icon('power')}${t('bis.disableIt')}</button>
        <button class="btn ghost" data-bisect-end="0">${t('bis.keepAll')}</button>
      </div></div>`;
  }
  const names = b.testing.map((id) => modById(id)?.name).filter(Boolean);
  return `<div class="banner bisect cut">
    <div class="bisect-main"><div class="nc-kicker">${esc(t('bis.round', { n: b.round, total: Math.max(b.rounds, b.round) }))}</div>
      <div class="bisect-title">${esc(t('bis.test', { n: names.length + b.always.length }))}</div>
      <div class="muted">${esc(t('bis.left', { n: b.candidates.length }))}</div></div>
    <div class="d-actions">
      ${S.state.running ? `<span class="running small"><span class="pulse"></span>${t('run.running')}</span>` : `<button class="btn primary cut" data-action="launch">${icon('play')}${t('game.launch')}</button>`}
      <button class="btn danger" data-bisect="1">${t('bis.problem')}</button>
      <button class="btn cyan" data-bisect="0">${t('bis.fine')}</button>
      <button class="btn ghost" data-bisect-end="0">${t('common.cancel')}</button>
    </div></div>`;
}

// ----- doctor -----

async function runDoctor() {
  S.doc = { ...S.doc, loading: true, error: null };
  if (S.page === 'doctor') renderDoctor();
  try {
    S.doc.result = await call('doctor:run');
  } catch (e) {
    S.doc.error = errText(e);
  }
  S.doc.loading = false;
  renderNav();
  if (S.page === 'doctor') renderDoctor();
}

function docIssue(is) {
  const mod = is.mod && modById(is.mod);
  const name = mod ? mod.name : '?';
  const lines = (list) => `<details class="doc-lines"><summary>${esc(t('doc.showLines', { n: list.length }))}</summary>
    ${list.map((l) => `<div class="mono">${esc(l.text)}${l.count > 1 ? ` <span class="muted">×${l.count}</span>` : ''}</div>`).join('')}</details>`;
  let title = '';
  let body = '';
  let acts = '';
  if (is.kind === 'missing') {
    title = t('doc.missing', { mod: name });
    body = esc(t('doc.missingText', { list: is.requires.map(fwName).join(', ') }));
    acts = `<button class="btn sm primary" data-fw-install="${esc(is.requires.join(','))}">${icon('download')}${t('deps.installMissing')}</button>`;
  } else if (is.kind === 'logMod') {
    title = t('doc.logMod', { mod: name, log: is.logName });
    body = `${t('doc.logModText')}${lines(is.lines)}`;
    acts = `${mod?.enabled ? `<button class="btn sm danger" data-doc-disable="${is.mod}">${icon('power')}${t('mod.disable')}</button>` : ''}
      <button class="btn sm" data-open-log="${esc(is.log)}">${icon('link')}${t('doc.openLog')}</button>
      <button class="btn sm ghost" data-select-mod="${is.mod}">${t('doc.showMod')}</button>`;
  } else if (is.kind === 'logOther') {
    title = t('doc.logOther', { log: is.logName, n: is.count });
    body = `${t('doc.logOtherText')}${lines(is.lines)}`;
    acts = `<button class="btn sm" data-open-log="${esc(is.log)}">${icon('link')}${t('doc.openLog')}</button>`;
  } else if (is.kind === 'conflict') {
    const other = modById(is.other);
    const winner = is.mine === is.shared ? name : is.mine === 0 ? other?.name : null;
    title = t('doc.conflict', { a: name, b: other?.name || '?' });
    body = esc(t('doc.conflictText', { n: is.shared })) + (winner ? ` ${esc(t('doc.conflictWinner', { mod: winner }))}` : ` ${esc(t('doc.conflictMixed'))}`);
    acts = `<button class="btn sm" data-winner="${is.mod}">${esc(t('doc.makeWinner', { mod: name }))}</button>
      <button class="btn sm" data-winner="${is.other}">${esc(t('doc.makeWinner', { mod: other?.name || '?' }))}</button>`;
  } else if (is.kind === 'unmanaged') {
    title = t('doc.unmanaged');
    body = esc(t('mods.unmanaged', { n: is.count }));
  } else if (is.kind === 'crash') {
    title = t('doc.crash', { date: new Date(is.at).toLocaleString(currentLang === 'ru' ? 'ru-RU' : 'en-GB') });
    body = t('doc.crashText');
  }
  return `<div class="doc-issue ${is.level}">
    <div class="doc-icon">${icon(is.level === 'info' ? 'conflict' : 'warn')}</div>
    <div class="doc-main"><div class="doc-title">${esc(title)}</div><div class="doc-text">${body}</div>
      ${acts ? `<div class="d-actions" style="margin-top:10px">${acts}</div>` : ''}</div></div>`;
}

function renderDoctor() {
  const d = S.doc;
  const r = d.result;
  const counts = r ? { error: 0, warn: 0, info: 0, ...r.issues.reduce((o, i) => ({ ...o, [i.level]: (o[i.level] || 0) + 1 }), {}) } : null;
  const allStale = r && r.logs.length && r.logs.every((l) => l.stale);
  $('#page').innerHTML = `${pageHead(t('doc.title'), t('doc.subtitle'),
      `<button class="btn primary cut" data-action="runDoctor" ${d.loading || !S.state.game.valid ? 'disabled' : ''}>${icon('refresh')}${t('doc.run')}</button>`)}
    <div class="page-body"><div class="settings" style="max-width:900px">
      ${bisectBanner().replace('banner ', '')}
      ${!S.state.game.valid ? `<div class="notice warn">${t('err.E_NO_GAME')}</div>` : ''}
      ${d.error ? `<div class="notice err">${esc(d.error)}</div>` : ''}
      ${!S.state.bisect && S.state.game.valid ? `<div class="set-group cut bisect-start">
        <div><h4>${t('bis.title')}</h4><div class="hint" style="margin:0">${esc(t('bis.intro', { n: Math.max(1, Math.ceil(Math.log2(Math.max(2, S.state.mods.filter((m) => m.enabled).length)))) }))}</div></div>
        <button class="btn" data-action="bisectStart">${icon('search')}${t('bis.start')}</button>
      </div>` : ''}
      ${d.loading && !r ? `<div class="cat-card skeleton" style="height:120px;min-height:0"></div>` : ''}
      ${r ? `
        <div class="doc-summary">
          <div class="doc-stat error"><b>${counts.error}</b>${t('doc.errors')}</div>
          <div class="doc-stat warn"><b>${counts.warn}</b>${t('doc.warnings')}</div>
          <div class="doc-stat info"><b>${counts.info}</b>${t('doc.notes')}</div>
          <div class="doc-when">${esc(t('doc.checked', { time: new Date(r.checkedAt).toLocaleTimeString(currentLang === 'ru' ? 'ru-RU' : 'en-GB') }))}</div>
        </div>
        ${allStale ? `<div class="notice info">${t('doc.stale')}</div>` : ''}
        ${!r.logs.length ? `<div class="notice info">${t('doc.noLogs')}</div>` : ''}
        ${r.issues.length ? r.issues.map(docIssue).join('') : `<div class="doc-ok cut">${icon('check')}<div><b>${t('doc.allGood')}</b><div class="muted">${t('doc.allGoodText')}</div></div></div>`}
        ${r.logs.length ? `<div class="set-group cut"><h4>${t('doc.logs')}</h4>
          <div class="nx-files">${r.logs.map((l) => `<div class="nx-file"><div style="min-width:0">
              <div class="nx-file-name">${esc(l.name)} ${l.errorCount ? `<span class="badge beta">${esc(t('doc.nErrors', { n: l.errorCount }))}</span>` : `<span class="badge ok">OK</span>`}</div>
              <div class="build-meta">${esc(l.file)} · ${fmtDate(l.mtime)} ${new Date(l.mtime).toLocaleTimeString(currentLang === 'ru' ? 'ru-RU' : 'en-GB', { hour: '2-digit', minute: '2-digit' })}${l.warnCount ? ` · ${esc(t('doc.nWarnings', { n: l.warnCount }))}` : ''}</div>
            </div><button class="btn sm ghost" data-open-log="${esc(l.file)}">${t('doc.openLog')}</button></div>`).join('')}</div></div>` : ''}
      ` : ''}
    </div></div>`;
  if (!r && !d.loading && !d.error && S.state.game.valid) runDoctor();
}

// ----- collections (share codes) -----

function renderCollections() {
  const c = S.coll;
  const user = S.state.nexus.user;
  const q = S.state.queue;
  const pv = c.preview;
  const todo = pv ? pv.items.filter((it) => it.status !== 'have') : [];
  const nexusTodo = todo.filter((it) => it.t === 'nx').length;
  const statusBadge = { have: ['ok', 'coll.have'], install: ['active', 'coll.willInstall'], change: ['beta', 'coll.willChange'] };

  const queueBanner = q
    ? `<div class="notice info coll-queue">
        <div><b>${esc(t('coll.queueTitle', { left: q.left, total: q.total }))}</b>
          <div>${esc(t('coll.queueNext', { name: q.next }))}</div></div>
        <div class="d-actions">
          <button class="btn sm cyan" data-action="queueOpen">${icon('link')}${t('coll.queueOpen')}</button>
          <button class="btn sm" data-action="queueSkip">${t('coll.queueSkip')}</button>
          <button class="btn sm ghost" data-action="queueCancel">${t('common.cancel')}</button>
        </div></div>`
    : '';

  const share = `<div class="set-group cut">
      <h4>${t('coll.shareTitle')}</h4>
      <div class="hint">${t('coll.shareHint')}</div>
      <div class="field"><label>${t('coll.name')}</label>
        <input class="input" id="collName" maxlength="80" value="${esc(c.name)}" placeholder="${esc(t('coll.namePh', { user: user?.name || 'MMC' }))}"></div>
      <div class="check-row"><span>${t('coll.onlyEnabled')}</span>
        <label class="switch"><input type="checkbox" data-coll-only ${c.onlyEnabled ? 'checked' : ''}><span class="track"></span></label></div>
      <button class="btn primary cut" data-action="collBuild" style="margin-top:6px" ${c.building ? 'disabled' : ''}>${icon(c.building ? 'refresh' : 'collections', c.building ? 'class="spin"' : '')}${c.building ? t('coll.building') : t('coll.build')}</button>
      ${c.built?.identified?.length ? `<div class="notice info" style="margin-top:12px">${esc(t('coll.identified', { n: c.built.identified.length }))}
          <div style="font-size:12px;margin-top:4px">${c.built.identified.map((x) => esc(x.name)).join(', ')}</div></div>` : ''}
      ${c.built?.leftOutDisabled ? `<div class="notice info" style="margin-top:10px">${esc(t('coll.leftOutDisabled', { n: c.built.leftOutDisabled }))}</div>` : ''}
      ${c.built ? (c.built.code
        ? `<div class="coll-code-wrap">
            <textarea class="input mono coll-code" readonly id="collOut">${esc(c.built.code)}</textarea>
            <div class="set-row" style="justify-content:space-between">
              <span class="muted">${esc(t('coll.inCode', { n: c.built.count }))} · ${esc(t('coll.codeLen', { n: c.built.code.length }))}</span>
              <button class="btn sm cyan" data-action="collCopy">${icon('copy')}${t('coll.copy')}</button>
            </div></div>`
        : `<div class="notice warn" style="margin-top:12px">${t('coll.nothing')}</div>`) : ''}
      ${c.built?.skipped?.length ? `<div class="notice warn" style="margin-top:10px">${esc(t('coll.skipped', { n: c.built.skipped.length }))}
          <div class="mono" style="font-size:11.5px;margin-top:4px">${c.built.skipped.slice(0, 20).map(esc).join('<br>')}${c.built.skipped.length > 20 ? '<br>…' : ''}</div></div>` : ''}
    </div>`;

  const receive = `<div class="set-group cut">
      <h4>${t('coll.receiveTitle')}</h4>
      <div class="hint">${t('coll.receiveHint')}</div>
      <textarea class="input mono coll-code" id="collCode" placeholder="MMC1-…">${esc(c.code)}</textarea>
      <button class="btn" data-action="collPreview" style="margin-top:8px">${icon('search')}${t('coll.check')}</button>
      ${pv ? `<div class="coll-preview">
          <div class="card-title">${esc(pv.name || t('coll.untitled'))}</div>
          ${pv.by ? `<div class="card-sub">${esc(t('coll.from', { user: pv.by }))}</div>` : ''}
          <div class="nx-files">${pv.items.map((it) => {
            const [cls, key] = statusBadge[it.status];
            return `<div class="nx-file"><div style="min-width:0">
                <div class="nx-file-name">${esc(it.n || `#${it.id}`)} ${it.v ? `<span class="mod-ver">${vtag(it.v)}</span>` : ''}</div>
                <div class="build-meta"><span class="tag ${it.t === 'nc' ? 'archive' : ''}">${it.t === 'nc' ? 'NightCoop' : 'Nexus'}</span>${it.e ? '' : ` ${t('coll.disabledInCode')}`}</div>
              </div><span class="badge ${cls}">${t(key)}</span></div>`;
          }).join('')}</div>
          ${nexusTodo && !user ? `<div class="notice err" style="margin-top:10px">${t('coll.needLogin')} <button class="btn sm" data-page="nexus">${t('nexus.login')}</button></div>` : ''}
          ${nexusTodo && user && !user.premium ? `<div class="notice info" style="margin-top:10px">${esc(t('coll.freeHint', { n: nexusTodo }))}</div>` : ''}
          ${!S.state.game.valid ? `<div class="notice warn" style="margin-top:10px">${t('err.E_NO_GAME')}</div>` : ''}
          <button class="btn primary cut" style="margin-top:12px" data-action="collInstall" ${todo.length && S.state.game.valid ? '' : 'disabled'}>
            ${icon('download')}${todo.length ? t('coll.installN', { n: todo.length }) : t('coll.allHave')}</button>
        </div>` : ''}
    </div>`;

  $('#page').innerHTML = `${pageHead(t('coll.title'), t('coll.subtitle'))}
    <div class="page-body">${queueBanner}<div class="nc-cols coll-cols">${share}${receive}</div></div>`;
}

// ----- catalog (browse Nexus) -----

const CATEGORIES = [
  'Armour and Clothing', 'Gameplay', 'Appearance', 'User Interface', 'Visuals and Graphics', 'Vehicles', 'Weapons',
  'Modders Resources', 'Utilities', 'Characters', 'Animations', 'Locations', 'Apartment', 'Audio', 'Scripts',
  'Crafting', 'Atelier Shop', 'Miscellaneous',
];

function fmtCount(n) {
  if (n >= 1e6) return `${(n / 1e6).toFixed(n >= 1e7 ? 0 : 1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(n >= 1e4 ? 0 : 1)}K`;
  return String(n);
}

const catName = (k) => (I18N.en[`cat.c.${k}`] ? t(`cat.c.${k}`) : k);
const installedNexus = (modId) => S.state.mods.find((m) => m.key === `nexus:${modId}`);
// Installed through the manager, or a framework that is already in the game folder.
const hasNexusMod = (modId) => !!installedNexus(modId) || S.state.frameworks.some((f) => f.nexus === modId && f.installed);

// Nexus descriptions are BBCode; everything is escaped first, then a safe subset becomes HTML.
const ENTITIES = { lt: '<', gt: '>', amp: '&', quot: '"', '#39': "'", nbsp: ' ' };

function bbcode(src) {
  // Nexus stores some characters as HTML entities; decode them so esc() doesn't double-escape.
  const decoded = src.replace(/<br\s*\/?>/gi, '\n').replace(/&(lt|gt|amp|quot|#39|nbsp);/g, (_, e) => ENTITIES[e]);
  let s = esc(decoded).replace(/&lt;br\s*\/?&gt;/gi, '\n');
  s = s.replace(/\[(\/?)(b|i|u|s)\]/gi, '<$1$2>');
  s = s.replace(/\[url=(?:&quot;)?(https:\/\/[^\]\s]+?)(?:&quot;)?\]([\s\S]*?)\[\/url\]/gi, (_, u, txt) => `<a class="link" data-url="${u}">${txt}</a>`);
  s = s.replace(/\[url\](https:\/\/[^[\s]+?)\[\/url\]/gi, (_, u) => `<a class="link" data-url="${u}">${u}</a>`);
  s = s.replace(/\[img\](https:\/\/[^[\s]+?)\[\/img\]/gi, (_, u) => `<img src="${u}" loading="lazy" alt="">`);
  s = s.replace(/\[\*\]/g, '\n• ').replace(/\[line\]/gi, '<hr>');
  s = s.replace(/\[\/?[a-z]+(=[^\]]*)?\]/gi, '');
  return s.replace(/\n{3,}/g, '\n\n').replace(/\n/g, '<br>');
}

async function catLoad(reset) {
  const c = S.cat;
  const req = ++c.req;
  if (reset) { c.mods = []; c.total = 0; }
  c.loading = true;
  renderCatalogList();
  try {
    const r = await call('catalog:search', { text: c.text, sort: c.sort, category: c.category, offset: c.mods.length, count: 24 });
    if (req !== c.req) return;
    c.mods = c.mods.concat(r.mods);
    c.total = r.total;
    c.error = null;
  } catch (e) {
    if (req === c.req) c.error = errText(e);
  } finally {
    if (req === c.req) {
      c.loading = false;
      c.loaded = true;
      if (S.page === 'catalog') renderCatalogList();
    }
  }
}

function renderCatalog() {
  const c = S.cat;
  const prevScroll = $('#catBody')?.scrollTop || 0;
  $('#page').innerHTML = `
    ${pageHead(t('cat.title'), `<span id="catSub">${c.total ? esc(t('cat.subtitle', { n: c.total.toLocaleString(currentLang === 'ru' ? 'ru-RU' : 'en-GB') })) : t('cat.subtitleEmpty')}</span>`)}
    <div class="toolbar">
      <div class="search">${icon('search')}<input id="catSearch" placeholder="${t('cat.search')}" value="${esc(c.text)}"></div>
      <select class="input select-sm" id="catCategory">
        <option value="">${t('cat.allCats')}</option>
        ${CATEGORIES.map((k) => `<option value="${esc(k)}" ${c.category === k ? 'selected' : ''}>${esc(t(`cat.c.${k}`))}</option>`).join('')}
      </select>
      <div class="spacer"></div>
      <div class="chips">${['popular', 'downloads', 'updated', 'new'].map((s) => `<button class="chip ${c.sort === s ? 'active' : ''}" data-cat-sort="${s}">${t(`cat.sort.${s}`)}</button>`).join('')}</div>
    </div>
    <div class="page-body" id="catBody"><div class="cat-grid" id="catGrid"></div><div id="catFoot" class="cat-foot"></div></div>`;
  $('#catBody').addEventListener('scroll', (e) => {
    const el = e.currentTarget;
    if (!c.loading && c.mods.length < c.total && el.scrollTop + el.clientHeight > el.scrollHeight - 400) catLoad(false);
  });
  if (!c.loaded && !c.loading) catLoad(true);
  else {
    renderCatalogList();
    $('#catBody').scrollTop = prevScroll;
  }
}

function catCard(m) {
  const inst = installedNexus(m.modId);
  return `<div class="cat-card" data-cat-open="${m.modId}">
    <div class="cat-thumb">${m.thumb ? `<img src="${esc(m.thumb)}" loading="lazy" alt="">` : ''}
      ${inst ? `<span class="cat-badge ${inst.update ? 'upd' : ''}">${inst.update ? t('mod.updateShort') : t('nc.isInstalled')}</span>` : ''}
      ${m.category ? `<span class="cat-cat">${esc(catName(m.category))}</span>` : ''}
    </div>
    <div class="cat-body">
      <div class="cat-name" title="${esc(m.name)}">${esc(m.name)}</div>
      <div class="cat-author">${esc(t('nexus.by', { author: m.author || '?' }))}</div>
      <div class="cat-sum">${esc(m.summary)}</div>
      <div class="cat-stats"><span>${icon('download')}${fmtCount(m.downloads)}</span><span>${icon('heart')}${fmtCount(m.endorsements)}</span>${m.version ? `<span class="mono">${vtag(m.version)}</span>` : ''}</div>
    </div>
  </div>`;
}

function renderCatalogList() {
  const grid = $('#catGrid');
  if (!grid) return;
  const c = S.cat;
  grid.innerHTML = c.mods.map(catCard).join('') + (c.loading ? '<div class="cat-card skeleton"></div>'.repeat(c.mods.length ? 4 : 12) : '');
  const sub = $('#catSub');
  if (sub && c.total) sub.textContent = t('cat.subtitle', { n: c.total.toLocaleString(currentLang === 'ru' ? 'ru-RU' : 'en-GB') });
  $('#catFoot').innerHTML = c.error
    ? `<div class="notice err">${esc(c.error)} <button class="btn sm" data-action="catRetry">${t('nc.retry')}</button></div>`
    : !c.loading && c.loaded && !c.mods.length ? `<div class="empty" style="min-height:200px"><p>${t('mods.noResults')}</p></div>`
    : !c.loading && c.mods.length < c.total ? `<button class="btn" data-action="catMore">${t('cat.more')}</button>` : '';
}

async function catOpen(modId) {
  const c = S.cat;
  c.detailId = modId;
  c.detail = c.mods.find((m) => m.modId === modId) || null; // card data while the full detail loads
  c.detailFull = false;
  c.showOld = false;
  renderDrawer();
  try {
    const d = await call('catalog:detail', modId);
    if (c.detailId !== modId) return;
    c.detail = d;
    c.detailFull = true;
  } catch (e) {
    toast(errText(e), 'err');
  }
  renderDrawer();
}

function renderDrawer() {
  const root = $('#drawer');
  const c = S.cat;
  if (!c.detailId || !c.detail) { root.innerHTML = ''; return; }
  const d = c.detail;
  const user = S.state.nexus.user;
  const inst = installedNexus(d.modId);
  const prevScroll = root.querySelector('.drawer')?.scrollTop || 0;

  const dlButton = (f) => {
    const job = jobFor((j) => j.kind === 'nexus' && j.ref.modId === d.modId && j.ref.fileId === f.fileId);
    if (job) return `<button class="btn sm" data-page="downloads">${icon('downloads')}<span data-job-pct="${job.id}">${jobPct(job)}%</span></button>`;
    if (inst?.origin?.fileId === f.fileId) return `<span class="badge ok">${t('nc.isInstalled')}</span>`;
    if (!user) return `<button class="btn sm" data-action="catLogin">${t('cat.loginToDl')}</button>`;
    return `<button class="btn sm ${f.category === 'MAIN' ? 'primary' : ''}" data-cat-dl="${d.modId}:${f.fileId}" ${S.state.game.valid ? '' : 'disabled'}>${icon('download')}${user.premium ? t('nexus.install') : t('cat.download')}</button>`;
  };

  root.innerHTML = `<div class="drawer-backdrop" data-cat-close></div>
    <aside class="drawer">
      <div class="drawer-hero" ${d.picture ? `style="background-image:url('${esc(d.picture)}')"` : ''}>
        <button class="btn icon drawer-close" data-cat-close title="${t('common.close')}">${icon('close')}</button>
      </div>
      <div class="drawer-body">
        <div class="d-name">${esc(d.name)}</div>
        <div class="cat-author" style="margin-top:4px">${esc(t('nexus.by', { author: d.author || '?' }))}${d.category ? ` · ${esc(catName(d.category))}` : ''}</div>
        <div class="cat-stats big"><span>${icon('download')}${fmtCount(d.downloads)}</span><span>${icon('heart')}${fmtCount(d.endorsements)}</span>
          ${d.version ? `<span class="mono">${vtag(d.version)}</span>` : ''}${d.updatedAt ? `<span>${fmtDate(d.updatedAt)}</span>` : ''}</div>
        <div class="d-actions" style="margin:12px 0 4px">
          ${inst ? `<button class="btn sm" data-select-mod="${inst.id}">${icon('mods')}${t('cat.inLibrary')}</button>` : ''}
          <button class="btn sm cyan" data-url="${esc(d.url || `https://www.nexusmods.com/cyberpunk2077/mods/${d.modId}`)}">${icon('link')}${t('nexus.openPage')}</button>
        </div>
        <p class="nx-summary">${esc(d.summary)}</p>
        ${c.detailFull && d.requirements?.length ? (() => {
          const reqs = d.requirements.map((r) => ({ ...r, have: hasNexusMod(r.modId) }));
          const missing = reqs.filter((r) => !r.have);
          return `<div class="d-label" style="margin-top:18px">${t('deps.requires')}</div>
            <div class="req-list">${reqs.map((r) => `<span class="req ${r.have ? 'ok' : ''}">${icon(r.have ? 'check' : 'warn', 'width="13" height="13"')}${esc(r.name)}</span>`).join('')}</div>
            ${missing.length && user ? `<button class="btn sm" style="margin-top:8px" data-action="catDeps">${icon('download')}${t('deps.installMissingN', { n: missing.length })}</button>` : ''}`;
        })() : ''}

        <div class="d-label" style="margin-top:18px">${t('cat.files')}</div>
        ${user && !user.premium ? `<div class="notice info" style="margin-bottom:8px">${t('cat.freeHint')}</div>` : ''}
        ${!S.state.game.valid ? `<div class="notice warn" style="margin-bottom:8px">${t('err.E_NO_GAME')}</div>` : ''}
        <div class="nx-files" style="margin-top:0">${c.detailFull
          ? d.files.filter((f) => c.showOld || f.category !== 'OLD_VERSION').map((f) => `<div class="nx-file">
              <div style="min-width:0">
                <div class="nx-file-name">${esc(f.name)} ${f.version ? `<span class="mod-ver">${vtag(f.version)}</span>` : ''}</div>
                <div class="build-meta"><span class="tag">${esc(t(`nexus.cat.${f.category}`))}</span> ${fmtSize(f.size)}${f.uploaded ? ` · ${fmtDate(f.uploaded)}` : ''}</div>
                ${f.description ? `<div class="nx-file-desc">${esc(f.description)}</div>` : ''}
              </div>${dlButton(f)}</div>`).join('') || `<div class="muted">—</div>`
          : `<div class="cat-card skeleton" style="height:64px"></div>`}</div>
        ${c.detailFull && !c.showOld && d.files.some((f) => f.category === 'OLD_VERSION')
          ? `<button class="btn sm ghost" style="margin-top:6px" data-action="catShowOld">${t('cat.oldVersions', { n: d.files.filter((f) => f.category === 'OLD_VERSION').length })}</button>` : ''}

        ${c.detailFull && d.description ? `<div class="d-label" style="margin-top:20px">${t('cat.description')}</div><div class="bb">${bbcode(d.description)}</div>` : ''}
      </div>
    </aside>`;
  const drawer = root.querySelector('.drawer');
  if (prevScroll) drawer.scrollTop = prevScroll;
}

function catClose() {
  S.cat.detailId = null;
  S.cat.detail = null;
  renderDrawer();
}

async function catDownload(modId, fileId) {
  showProgress(t('progress.working'));
  try {
    const r = await call('catalog:download', modId, fileId);
    if (r.opened) toast(t('cat.openedSite'), 'info');
    if (r.started) toast(t('jobs.added'), 'info');
    if (r.results) showResults(r.results);
    setState(r.state);
    hideProgress();
    offerDeps(r.missing);
  } catch (e) {
    toast(errText(e), 'err');
  } finally {
    hideProgress();
  }
}

// ----- first-run wizard -----

function renderOnboarding() {
  const el = $('#onboard');
  if (S.state.settings.onboarded) {
    el.classList.add('hidden');
    el.innerHTML = '';
    return;
  }
  el.classList.remove('hidden');
  const { step } = S.ob;
  const user = S.state.nexus.user;
  const g = S.state.game;
  const lang = S.state.settings.language;
  let body;

  if (step === 0) {
    body = `
      <div class="ob-logo">${document.querySelector('.logo').outerHTML}</div>
      <div class="ob-brand"><b>MMC</b> MOD MANAGER</div>
      <div class="ob-corp">MongaManiaCorporation</div>
      <h2 class="ob-title">${t('ob.welcome')}</h2>
      <p class="ob-text">${t('ob.welcomeText')}</p>
      <p class="ob-unofficial">${t('about.unofficialShort')}</p>
      <div class="lang-switch ob-lang">
        <button class="lang-opt ${lang === 'ru' ? 'active' : ''}" data-lang="ru"><span class="code">RU</span>Русский</button>
        <button class="lang-opt ${lang === 'en' ? 'active' : ''}" data-lang="en"><span class="code">EN</span>English</button>
      </div>
      <div class="ob-foot"><span></span><button class="btn primary cut" data-action="obNext">${t('ob.start')}</button></div>`;
  } else if (step === 1) {
    body = user
      ? `<h2 class="ob-title">${t('ob.nexusDone')}</h2>
        <div class="nx-account ob-user">
          <div class="nx-avatar">${user.avatar ? `<img src="${esc(user.avatar)}" alt="">` : icon('user')}</div>
          <div style="flex:1"><div class="card-title">${esc(user.name)}</div>
            <div class="card-sub">${user.premium ? t('nexus.premiumText') : t('nexus.freeText')}</div></div>
          <span class="badge ${user.premium ? 'active' : 'no'}">${user.premium ? 'Premium' : t('nexus.free')}</span>
        </div>
        <div class="check-row ob-check"><div><b>${t('nexus.nxm')}</b><div class="hint" style="margin:2px 0 0">${t('ob.nxmHint')}</div></div>
          <label class="switch"><input type="checkbox" data-ob-nxm ${S.ob.nxm ? 'checked' : ''}><span class="track"></span></label></div>
        <div class="ob-foot"><button class="btn ghost" data-action="obBack">${t('ob.back')}</button>
          <button class="btn primary cut" data-action="obNext">${t('ob.next')}</button></div>`
      : `<h2 class="ob-title">${t('ob.nexusTitle')}</h2>
        <p class="ob-text">${t('ob.nexusText')}</p>
        <ol class="ob-howto">
          <li>${t('ob.how1')} <a class="link" data-url="${esc(S.state.nexus.keyPage)}">${t('ob.howLink')}</a></li>
          <li>${t('ob.how2')}</li>
          <li>${t('ob.how3')}</li>
        </ol>
        <div class="set-row">
          <input class="input mono" id="obKey" type="password" placeholder="${t('nexus.keyPh')}" autocomplete="off">
          <button class="btn primary" data-action="obLogin">${t('nexus.login')}</button>
        </div>
        <div class="ob-safe">${icon('check', 'width="14" height="14"')} ${t('ob.safe')}</div>
        <div class="ob-foot"><button class="btn ghost" data-action="obBack">${t('ob.back')}</button>
          <button class="btn" data-action="obSkip">${t('ob.skip')}</button></div>`;
  } else {
    body = `<h2 class="ob-title">${t('ob.gameTitle')}</h2>
      <p class="ob-text">${t('ob.gameText')}</p>
      ${g.valid
        ? `<div class="notice info ob-game">${icon('check', 'width="16" height="16"')}<div><b>${t(`game.store.${g.store}`)}</b><div class="mono">${esc(g.path)}</div></div></div>`
        : `<div class="notice warn">${t('detect.none')}</div>`}
      <div class="set-row" style="margin-top:12px">
        <button class="btn" data-action="detect">${icon('search')}${t('settings.detect')}</button>
        <button class="btn" data-action="browse">${icon('folder')}${t('settings.browse')}</button>
      </div>
      <div class="ob-foot"><button class="btn ghost" data-action="obBack">${t('ob.back')}</button>
        <button class="btn primary cut" data-action="obFinish">${g.valid ? t('ob.finish') : t('ob.later')}</button></div>`;
  }

  const dots = [0, 1, 2].map((i) => `<span class="ob-dot ${i === step ? 'on' : i < step ? 'done' : ''}"></span>`).join('');
  el.innerHTML = `<div class="ob-card cut"><div class="ob-steps">${dots}</div>${body}</div>`;
  if (step === 1 && !user) $('#obKey')?.focus();
}

async function obGo(step) {
  S.ob.step = step;
  renderOnboarding();
  if (step === 2 && !S.state.game.valid && !S.ob.autoDetected) {
    S.ob.autoDetected = true;
    const found = await call('game:detect').catch(() => []);
    if (found.length === 1) await act('game:setPath', [found[0].path], { busy: false });
    else if (found.length > 1) detectGame();
  }
}

// ----- frameworks -----

function renderFrameworks() {
  const fws = S.state.frameworks;
  $('#page').innerHTML = `${pageHead(t('fw.title'), t('fw.subtitle'))}
    <div class="page-body"><div class="grid">${fws.map((f) => {
      const need = !f.installed && f.requiredBy;
      return `<div class="card cut ${f.installed ? 'ok' : need ? 'need' : ''}"><div class="corner"></div>
        <div class="card-top"><div class="card-title">${esc(f.name)}</div>
          <span class="badge ${f.installed ? 'ok' : 'no'}">${f.installed ? t('fw.installed') : t('fw.missing')}</span></div>
        <div class="card-sub">${f.requiredBy ? esc(t('fw.requiredBy', { n: f.requiredBy })) : t('fw.notRequired')}</div>
        <div class="card-sub mono" style="font-size:11px">${esc(f.file)}</div>
        <div class="card-foot">
          ${f.installed ? '' : `<button class="btn sm ${need ? 'primary' : ''}" data-fw-install="${f.id}" ${S.state.game.valid ? '' : 'disabled'}>${icon('download')}${t('fw.install')}</button>`}
          <button class="btn sm ghost" data-url="${esc(f.url)}">${icon('link')}Nexus</button>
        </div>
      </div>`;
    }).join('')}</div></div>`;
}

// ----- profiles -----

function renderProfiles() {
  const enabledIds = S.state.mods.filter((m) => m.enabled).map((m) => m.id).sort().join();
  const profiles = S.state.profiles;
  $('#page').innerHTML = `${pageHead(t('profiles.title'), t('profiles.subtitle'),
      `<button class="btn primary cut" data-action="createProfile" ${S.state.game.valid ? '' : 'disabled'}>${icon('plus')}${t('profiles.create')}</button>`)}
    <div class="page-body">${profiles.length ? `<div class="grid">${profiles.map((p) => {
      const active = [...p.mods].sort().join() === enabledIds;
      const names = p.mods.map(modById).filter(Boolean).map((m) => m.name);
      return `<div class="card cut ${active ? 'ok' : ''}"><div class="corner"></div>
        <div class="card-top"><div class="card-title">${esc(p.name)}</div>${active ? `<span class="badge active">${t('profiles.active')}</span>` : ''}</div>
        <div class="card-sub">${esc(t('profiles.mods', { n: names.length }))}</div>
        <div class="card-sub" style="font-size:12px">${esc(names.slice(0, 6).join(' · '))}${names.length > 6 ? ' …' : ''}</div>
        <div class="card-foot">
          <button class="btn sm primary" data-profile-apply="${p.id}" ${active ? 'disabled' : ''}>${t('profiles.apply')}</button>
          <button class="btn sm" data-profile-update="${p.id}">${t('profiles.update')}</button>
          <button class="btn sm icon danger" data-profile-delete="${p.id}" title="${t('profiles.delete')}">${icon('trash')}</button>
        </div></div>`;
    }).join('')}</div>` : `<div class="empty" style="height:auto;min-height:0;padding:30px 20px"><div class="big-icon" style="width:56px;height:56px">${icon('profiles', 'stroke-width="1.2"')}</div><p style="margin:0">${t('profiles.empty')}</p></div>`}
      ${historyBlock()}</div>`;
}

// Every change of the enabled set, newest first, with a one-click rollback.
function historyBlock() {
  const h = S.state.history || [];
  if (h.length < 2) return '';
  const when = (ts) => new Date(ts).toLocaleString(currentLang === 'ru' ? 'ru-RU' : 'en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
  const list = (names, cls, sign) => names.length ? `<span class="hist-${cls}">${sign} ${esc(names.slice(0, 4).join(', '))}${names.length > 4 ? ` ${esc(t('hist.more', { n: names.length - 4 }))}` : ''}</span>` : '';
  return `<div class="set-group cut" style="margin-top:20px">
    <h4>${t('hist.title')}</h4><div class="hint">${t('hist.hint')}</div>
    <div class="nx-files">${h.slice(0, 30).map((e, i) => `<div class="nx-file">
        <div style="min-width:0">
          <div class="nx-file-name">${esc(when(e.at))} <span class="mod-ver">${esc(t('profiles.mods', { n: e.count }))}</span></div>
          <div class="hist-diff">${list(e.on, 'on', '+')}${list(e.off, 'off', '−')}${!e.on.length && !e.off.length ? `<span class="muted">${t('hist.start')}</span>` : ''}</div>
        </div>
        ${i === 0 ? `<span class="badge ok">${t('hist.now')}</span>` : `<button class="btn sm" data-history="${e.id}">${icon('refresh')}${t('hist.restore')}</button>`}
      </div>`).join('')}</div>
  </div>`;
}

// ----- settings -----

function renderSettings() {
  const st = S.state.settings;
  const g = S.state.game;
  const check = (key) => `<label class="switch"><input type="checkbox" data-setting="${key}" ${st[key] ? 'checked' : ''}><span class="track"></span></label>`;
  $('#page').innerHTML = `${pageHead(t('settings.title'), '')}
    <div class="page-body"><div class="settings">
      <div class="set-group cut">
        <h4>${t('settings.language')}</h4>
        <div class="lang-switch" style="margin-top:10px">
          <button class="lang-opt ${st.language === 'ru' ? 'active' : ''}" data-lang="ru"><span class="code">RU</span>Русский</button>
          <button class="lang-opt ${st.language === 'en' ? 'active' : ''}" data-lang="en"><span class="code">EN</span>English</button>
        </div>
      </div>
      <div class="set-group cut">
        <h4>${t('settings.game')}</h4>
        <div class="hint">${esc(t('settings.gameHint'))}</div>
        <div class="set-row">
          <input class="input mono" readonly value="${esc(g.path || '')}" placeholder="—">
          <button class="btn" data-action="detect">${icon('search')}${t('settings.detect')}</button>
          <button class="btn" data-action="browse">${icon('folder')}${t('settings.browse')}</button>
          <button class="btn icon" data-open="game" ${g.valid ? '' : 'disabled'} title="${t('settings.open')}">${icon('folder')}</button>
        </div>
      </div>
      <div class="set-group cut">
        <h4>${t('settings.storage')}</h4>
        <div class="hint">${t('settings.storageHint')}</div>
        <div class="set-row"><input class="input mono" readonly value="${esc(S.state.storageDir)}">
          <button class="btn" data-open="storage">${icon('folder')}${t('settings.open')}</button></div>
      </div>
      <div class="set-group cut">
        <h4>${t('settings.behavior')}</h4>
        <div class="check-row"><span>${t('settings.autoEnable')}</span>${check('autoEnable')}</div>
        <div class="check-row"><span>${t('settings.confirmDelete')}</span>${check('confirmDelete')}</div>
      </div>
      <div class="set-group cut">
        <h4>${t('upd.title')}</h4>
        <div class="check-row">
          <div><div>MMC Mod Manager <span class="mono">v${esc(S.state.app.version)}</span></div>
            <div class="hint" style="margin:2px 0 0">${S.state.app.updates ? (S.state.app.update ? esc(t('upd.found', { v: S.state.app.update.version })) : t('upd.hint')) : t('upd.notConfigured')}</div></div>
          ${S.state.app.update
            ? `<button class="btn cyan" data-action="installUpdate">${icon('download')}${t('upd.install')}</button>`
            : `<button class="btn" data-action="checkUpdate" ${S.state.app.updates ? '' : 'disabled'}>${icon('refresh')}${t('upd.check')}</button>`}
        </div>
      </div>
      <div class="set-group cut">
        <h4>${t('settings.danger')}</h4>
        <div class="check-row"><span class="muted">${t('settings.disableAllText')}</span>
          <button class="btn danger" data-action="disableAll" ${S.state.mods.some((m) => m.enabled) ? '' : 'disabled'}>${t('mods.disableAll')}</button></div>
        <div class="notice info" style="margin-top:10px">${t('settings.about')}</div>
      </div>
      ${aboutBlock()}
    </div></div>`;
}

// What the app is, who it is (not) affiliated with, what it sends where and why, and its licenses.
function aboutBlock() {
  const hosts = [
    ['api.nexusmods.com, nexusmods.com', 'about.netNexus'],
    ['staticdelivery.nexusmods.com', 'about.netImages'],
    ['nightcoop.net', 'about.netNightcoop'],
    ['github.com, api.github.com', 'about.netGithub'],
    ['Steam / Epic Games / GOG Galaxy', 'about.netLaunch'],
  ];
  return `<div class="set-group cut">
    <h4>${t('about.title')}</h4>
    <div class="about-brand"><b>MMC Mod Manager</b> <span class="mono">v${esc(S.state.app.version)}</span> · MongaManiaCorporation</div>
    <div class="notice warn" style="margin:10px 0">${t('about.unofficial')}</div>
    <div class="hint" style="margin-bottom:6px">${t('about.free')}</div>
    <div class="hint" style="margin-bottom:12px">${t('about.openSource')} <a class="link" data-url="https://github.com/Lepotion/mmc-mod-manager">github.com/Lepotion/mmc-mod-manager</a></div>

    <div class="d-label">${t('about.netTitle')}</div>
    <div class="nx-files" style="margin-top:0">${hosts.map(([h, key]) => `<div class="nx-file"><div>
        <div class="nx-file-name mono" style="font-size:12.5px">${esc(h)}</div><div class="build-meta" style="font-family:var(--font);font-size:12.5px">${t(key)}</div>
      </div></div>`).join('')}</div>
    <div class="notice info" style="margin-top:10px">${t('about.noTelemetry')}</div>
    <div class="hint" style="margin-top:10px">${t('about.storage')}</div>

    <div class="d-actions" style="margin-top:14px">
      <button class="btn" data-action="showLicenses">${icon('copy')}${t('about.licenses')}</button>
      <button class="btn ghost" data-open="data">${icon('folder')}${t('about.openData')}</button>
    </div>
  </div>`;
}

async function showLicenses() {
  let text = '';
  try {
    text = await call('app:notices');
  } catch (e) {
    return toast(errText(e), 'err');
  }
  modal(`<h3>${t('about.licenses')}</h3><p class="hint">${t('about.licensesHint')}</p>
    <pre class="licenses">${esc(text)}</pre>
    <div class="actions"><button class="btn primary" data-c>${t('common.close')}</button></div>`,
  (root, close) => root.querySelector('[data-c]').addEventListener('click', () => close()), { cls: 'lic-modal' });
}

// ---------- actions ----------

async function importPaths(paths) {
  if (!paths.length) return;
  if (!S.state.game.valid) return toast(t('err.E_NO_GAME'), 'err');
  showProgress(t('progress.import', { name: paths[0].split(/[\\/]/).pop() }), 0, `1 / ${paths.length}`);
  try {
    const { results, state } = await call('mods:import', paths);
    S.page = 'mods';
    showResults(results);
    setState(state);
  } catch (e) {
    toast(errText(e), 'err');
  } finally {
    hideProgress();
  }
}

async function detectGame() {
  showProgress(t('progress.working'));
  let found = [];
  try { found = await call('game:detect'); } finally { hideProgress(); }
  if (!found.length) return toast(t('detect.none'), 'info');
  let pick = 0;
  if (found.length > 1) {
    pick = await pickDialog(t('detect.pick'), found.map((f) => `${t(`game.store.${f.store}`)} — ${f.path}`));
    if (pick === null) return;
  }
  await act('game:setPath', [found[pick].path], { ok: t('detect.found', { path: found[pick].path }) });
}

async function deleteMod(id) {
  const m = modById(id);
  if (!m) return;
  if (S.state.settings.confirmDelete && !(await confirmDialog(t('confirm.deleteTitle'), t('confirm.deleteText', { name: m.name }), t('common.delete'), true))) return;
  await act('mods:delete', [id], { ok: t('toast.deleted') });
}

// Downloads + installs (Nexus / NightCoop) and reports each result.
async function runInstall(channel, args) {
  showProgress(t('progress.working'));
  try {
    const { results, missing, started, state } = await call(channel, ...args);
    if (started) toast(t('jobs.added'), 'info');
    showResults(results);
    setState(state);
    hideProgress();
    offerDeps(missing);
    return results;
  } catch (e) {
    toast(errText(e), 'err');
  } finally {
    hideProgress();
  }
}

async function nexusLookup() {
  const ref = $('#nexusRef')?.value.trim();
  if (!ref) return;
  S.lookupRef = ref;
  showProgress(t('progress.working'));
  try {
    S.lookup = await call('nexus:lookup', ref);
    renderNexus();
  } catch (e) {
    toast(errText(e), 'err');
  } finally {
    hideProgress();
  }
}

async function nexusUpdate(id) {
  showProgress(t('progress.working'));
  try {
    const r = await call('nexus:updateMod', id);
    if (r.openUrl) {
      call('open:url', r.openUrl);
      toast(t('nexus.clickOnSite'), 'info');
    }
    if (r.started) toast(t('jobs.added'), 'info');
    if (r.results) showResults(r.results);
    setState(r.state);
  } catch (e) {
    toast(errText(e), 'err');
  } finally {
    hideProgress();
  }
}

const actions = {
  showLicenses,
  bisectStart: async () => {
    if (await confirmDialog(t('bis.title'), t('bis.confirm'), t('bis.start'))) act('bisect:start');
  },
  updateAll: async () => {
    showProgress(t('progress.working'));
    try {
      const r = await call('nexus:updateAll');
      setState(r.state);
      if (r.jobs) toast(t('jobs.addedN', { n: r.jobs }), 'info');
      if (r.queued) toast(t('coll.queued', { n: r.queued }), 'info');
    } catch (e) {
      toast(errText(e), 'err');
    } finally {
      hideProgress();
    }
  },
  jobsClear: () => call('jobs:clear').then((jobs) => { S.jobs = jobs; renderDownloads(); }),
  runDoctor,
  catDeps: () => {
    const d = S.cat.detail;
    if (d?.requirements) installDeps(d.requirements.filter((r) => !hasNexusMod(r.modId)));
  },
  collBuild: async () => {
    S.coll.name = $('#collName')?.value.trim() || '';
    const name = S.coll.name || t('coll.namePh', { user: S.state.nexus.user?.name || 'MMC' });
    S.coll.building = true;
    renderCollections();
    try {
      S.coll.built = await call('coll:build', { name, onlyEnabled: S.coll.onlyEnabled });
      // Found Nexus links were saved on the mods; refresh so the mod details show them.
      if (S.coll.built.identified?.length) await refresh();
    } catch (e) {
      toast(errText(e), 'err');
    }
    S.coll.building = false;
    if (S.page === 'collections') renderCollections();
  },
  collCopy: async () => {
    await call('clip:write', S.coll.built.code);
    toast(t('coll.copied'), 'info');
  },
  collPreview: async () => {
    S.coll.code = $('#collCode')?.value.trim() || '';
    if (!S.coll.code) return;
    try {
      S.coll.preview = await call('coll:preview', S.coll.code);
    } catch (e) {
      S.coll.preview = null;
      toast(errText(e), 'err');
    }
    renderCollections();
  },
  collInstall: async () => {
    showProgress(t('progress.working'));
    try {
      const r = await call('coll:install', S.coll.code);
      showResults(r.results);
      setState(r.state);
      if (r.jobs) toast(t('jobs.addedN', { n: r.jobs }), 'info');
      if (r.queued) toast(t('coll.queued', { n: r.queued }), 'info');
      S.coll.preview = await call('coll:preview', S.coll.code).catch(() => null);
      renderCollections();
    } catch (e) {
      toast(errText(e), 'err');
    } finally {
      hideProgress();
    }
  },
  queueOpen: () => act('coll:queueOpen', [], { busy: false }),
  queueSkip: () => act('coll:queueSkip', [], { busy: false }),
  queueCancel: () => act('coll:queueCancel', [], { busy: false }),
  checkUpdate: async () => {
    const st = await act('app:checkUpdate', [], { busy: true });
    if (st?.app) toast(st.app.update ? t('upd.found', { v: st.app.update.version }) : t('upd.latest'), 'info');
  },
  installUpdate: async () => {
    const u = S.state.app.update;
    if (!u) return;
    if (!(await confirmDialog(t('upd.confirmTitle', { v: u.version }), t('upd.confirmText'), t('upd.install')))) return;
    await act('app:installUpdate');
  },
  catMore: () => catLoad(false),
  catShowOld: () => { S.cat.showOld = true; renderDrawer(); },
  catRetry: () => catLoad(S.cat.mods.length === 0),
  catLogin: () => { catClose(); go('nexus'); },
  obNext: () => obGo(S.ob.step + 1),
  obBack: () => obGo(S.ob.step - 1),
  obSkip: () => obGo(2),
  obLogin: () => {
    const key = $('#obKey')?.value.trim();
    if (key) act('nexus:login', [key], { ok: t('nexus.welcome') });
  },
  obFinish: async () => {
    if (S.state.nexus.user && S.ob.nxm && !S.state.nexus.nxm) await call('nexus:setNxm', true).catch(() => {});
    await act('settings:set', [{ onboarded: true }], { busy: false });
  },
  ncReload: () => loadNightCoop(true),
  ncToggle: () => { const m = ncMod(); if (m) act('mods:setEnabled', [m.id, !m.enabled]); },
  ncDelete: () => { const m = ncMod(); if (m) deleteMod(m.id); },
  nexusSso,
  nexusLookup,
  nexusLogin: () => {
    const key = $('#nexusKey')?.value.trim();
    if (key) act('nexus:login', [key], { ok: t('nexus.welcome') });
  },
  nexusLogout: () => { S.lookup = null; act('nexus:logout', [], { busy: false }); },
  checkUpdates: async () => {
    const r = await act('nexus:checkUpdates');
    if (r && !r.mods) { setState(r.state); toast(r.found ? t('nexus.updatesFound', { n: r.found }) : t('nexus.noUpdates'), 'info'); }
  },
  updateSelected: () => nexusUpdate(S.selected),
  launch: async () => {
    try { await call('game:launch'); toast(t('game.launched'), 'info'); } catch (e) { toast(errText(e), 'err'); }
  },
  goSettings: () => go('settings'),
  install: async () => importPaths(await call('mods:pick')),
  detect: detectGame,
  browse: () => act('game:browse', [], { busy: false }),
  enableAll: () => act('mods:setAll', [true], { ok: t('toast.allEnabled') }),
  disableAll: async () => {
    if (await confirmDialog(t('confirm.disableAllTitle'), t('settings.disableAllText'), t('mods.disableAll'), true)) {
      await act('mods:setAll', [false], { ok: t('toast.allDisabled') });
    }
  },
  toggleSelected: () => { const m = modById(S.selected); if (m) act('mods:setEnabled', [m.id, !m.enabled]); },
  openModFolder: () => call('mods:openFolder', S.selected),
  openNexus: () => { const m = modById(S.selected); if (m?.nexusUrl) call('open:url', m.nexusUrl); },
  deleteSelected: () => deleteMod(S.selected),
  showAllFiles: () => { S.showAllFiles = true; renderDetails(); },
  createProfile: async () => {
    const name = await promptDialog(t('profiles.namePrompt'), t('profiles.namePh'));
    if (name) await act('profiles:create', [name], { busy: false, ok: t('profiles.saved') });
  },
};

function go(page) {
  S.page = page;
  render();
  $('#page').scrollTop = 0;
}

function selectMod(id) {
  if (S.selected !== id) S.showAllFiles = false;
  S.selected = id;
  for (const row of document.querySelectorAll('.mod-row')) row.classList.toggle('selected', row.dataset.id === id);
  renderDetails();
}

document.addEventListener('click', async (e) => {
  const el = e.target.closest('[data-page],[data-action],[data-filter],[data-url],[data-select],[data-lang],[data-open],[data-profile-apply],[data-profile-update],[data-profile-delete],[data-nc-install],[data-nc-variant],[data-nx-install],[data-nx-update],[data-cat-open],[data-cat-close],[data-cat-dl],[data-cat-sort],[data-select-mod],[data-fw-install],[data-winner],[data-doc-disable],[data-open-log],[data-job-cancel],[data-history],[data-bisect],[data-bisect-end],.mod-row');
  if (!el || el.disabled) return;
  if (e.target.closest('[data-stop]')) return;
  const d = el.dataset;
  if (d.history) return act('history:restore', [d.history], { ok: t('hist.restored') });
  if (d.bisect) return act('bisect:answer', [d.bisect === '1']);
  if (d.bisectEnd) return act('bisect:end', [d.bisectEnd === '1'], { ok: t('bis.ended') });
  if (d.page) { catClose(); return go(d.page); }
  if (d.jobCancel) return call('jobs:cancel', d.jobCancel).then((jobs) => { S.jobs = jobs; renderDownloads(); renderNav(); renderGameCard(); });
  if (d.fwInstall) {
    const fws = d.fwInstall.split(',').map((id) => S.state.frameworks.find((f) => f.id === id)).filter(Boolean);
    return installDeps(fws.map((f) => ({ modId: f.nexus, name: f.name })));
  }
  if (d.winner) {
    await act('mods:makeWinner', [d.winner], { ok: t('mod.winnerSet', { mod: modById(d.winner)?.name || '' }) });
    if (S.page === 'doctor') runDoctor();
    return;
  }
  if (d.docDisable) { await act('mods:setEnabled', [d.docDisable, false]); return runDoctor(); }
  if (d.openLog) return call('open:gameFile', d.openLog).catch((err) => toast(errText(err), 'err'));
  if (d.catOpen) return catOpen(Number(d.catOpen));
  if ('catClose' in d) return catClose();
  if (d.catDl) { const [modId, fileId] = d.catDl.split(':').map(Number); return catDownload(modId, fileId); }
  if (d.catSort) { S.cat.sort = d.catSort; S.cat.loaded = false; return renderCatalog(); }
  if (d.selectMod) { catClose(); S.page = 'mods'; S.selected = d.selectMod; return render(); }
  if (d.ncInstall) return runInstall('nc:install', [d.ncInstall, ncVariant(ncLatest())]);
  if (d.ncVariant) return act('settings:set', [{ ncVariant: d.ncVariant }], { busy: false });
  if (d.nxInstall) {
    const [modId, fileId] = d.nxInstall.split(':').map(Number);
    const results = await runInstall('nexus:install', [modId, fileId]);
    if (results?.some((r) => r.ok) && S.lookup) { S.lookup.installed = fileId; if (S.page === 'nexus') renderNexus(); }
    return;
  }
  if (d.nxUpdate) return nexusUpdate(d.nxUpdate);
  if (d.action) return actions[d.action]?.();
  if (d.filter) { S.filter = d.filter; return renderMods(); }
  if (d.url) return call('open:url', d.url);
  if (d.select) return selectMod(d.select);
  if (d.lang) return act('settings:set', [{ language: d.lang }], { busy: false });
  if (d.open) return call('open:path', d.open);
  if (d.profileApply) {
    const p = S.state.profiles.find((x) => x.id === d.profileApply);
    return act('profiles:apply', [d.profileApply], { ok: t('profiles.applied', { name: p?.name }) });
  }
  if (d.profileUpdate) return act('profiles:update', [d.profileUpdate], { ok: t('profiles.saved') });
  if (d.profileDelete) return act('profiles:delete', [d.profileDelete], { busy: false });
  if (el.classList.contains('mod-row')) return selectMod(d.id);
});

document.addEventListener('change', async (e) => {
  const el = e.target;
  if (el.dataset.toggle) return act('mods:setEnabled', [el.dataset.toggle, el.checked]);
  if ('nxm' in el.dataset) return act('nexus:setNxm', [el.checked], { busy: false });
  if ('obNxm' in el.dataset) { S.ob.nxm = el.checked; return; }
  if ('collOnly' in el.dataset) { S.coll.onlyEnabled = el.checked; return; }
  if (el.dataset.setting) return act('settings:set', [{ [el.dataset.setting]: el.checked }], { busy: false });
  if (el.id === 'sort') { S.sort = el.value; return renderModList(); }
  if (el.id === 'catCategory') { S.cat.category = el.value; return catLoad(true); }
  if (el.dataset.field && S.selected) {
    try {
      // Update quietly so the inputs keep focus.
      S.state = await call('mods:update', S.selected, { [el.dataset.field]: el.value });
      renderModList();
      renderNav();
      if (el.dataset.field === 'name') $('.d-name').textContent = modById(S.selected).name;
    } catch (err) {
      toast(errText(err), 'err');
    }
  }
});

let catSearchTimer;
document.addEventListener('input', (e) => {
  if (e.target.id === 'search') { S.search = e.target.value; renderModList(); }
  if (e.target.id === 'collCode') S.coll.code = e.target.value;
  if (e.target.id === 'collName') S.coll.name = e.target.value;
  if (e.target.id === 'catSearch') {
    S.cat.text = e.target.value;
    clearTimeout(catSearchTimer);
    catSearchTimer = setTimeout(() => catLoad(true), 350);
  }
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && e.target.id === 'nexusRef') return nexusLookup();
  if (e.key === 'Enter' && e.target.id === 'nexusKey') return actions.nexusLogin();
  if (e.key === 'Enter' && e.target.id === 'obKey') return actions.obLogin();
  if (e.key === 'Escape' && S.cat.detailId && !$('#modalRoot').children.length) return catClose();
  if (e.ctrlKey && e.key.toLowerCase() === 'f' && S.page === 'mods') { e.preventDefault(); $('#search')?.focus(); }
  if (e.key === 'Delete' && S.page === 'mods' && S.selected && !/INPUT|TEXTAREA/.test(document.activeElement.tagName)) deleteMod(S.selected);
});

// ---------- drag & drop ----------

let dragDepth = 0;
const dropEl = $('#drop');
const isFileDrag = (e) => [...(e.dataTransfer?.types || [])].includes('Files');
window.addEventListener('dragenter', (e) => { if (!isFileDrag(e)) return; e.preventDefault(); dragDepth++; dropEl.classList.add('show'); });
window.addEventListener('dragover', (e) => { if (isFileDrag(e)) e.preventDefault(); });
window.addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; dropEl.classList.remove('show'); } });
window.addEventListener('drop', (e) => {
  e.preventDefault();
  dragDepth = 0;
  dropEl.classList.remove('show');
  const paths = [...e.dataTransfer.files].map((f) => bridge.pathForFile(f)).filter(Boolean);
  importPaths(paths);
});

$('.drop-icon').innerHTML = icon('upload', 'stroke-width="1.4"');
refresh().then(() => {
  loadNightCoop();
  if (S.state.app.updates) call('app:checkUpdate').then(setState).catch(() => {});
});
