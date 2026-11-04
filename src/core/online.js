// Downloads from Nexus Mods and nightcoop.net, then installs through the Manager.
//
// Downloads are background jobs: up to MAX_PARALLEL run at once outside the file-operation queue
// and can be cancelled; only the install step goes through `io.serial` (one file operation at a time).
const fs = require('fs');
const path = require('path');
const nexus = require('./nexus');
const { download } = require('./download');
const { sanitize } = require('./layout');
const collections = require('./collections');
const game = require('./game');

const NC_BASE = 'https://nightcoop.net/';
const NC_KEY = 'nightcoop';
const MAX_PARALLEL = 3;
const KEEP_FINISHED = 40;
const ACTIVE = new Set(['queued', 'downloading', 'installing']);

class Online {
  /**
   * @param {import('./manager').Manager} manager
   * @param {{
   *   encrypt: (s: string) => string, decrypt: (s: string) => string,
   *   serial?: (fn: () => Promise<any>) => Promise<any>,
   *   jobsChanged?: (jobs: object[]) => void,
   *   jobDone?: (job: object, results: object[], extra: object) => void,
   *   openUrl?: (item: object) => void,
   * }} io
   */
  constructor(manager, io) {
    this.m = manager;
    this.io = { serial: (fn) => fn(), jobsChanged: () => {}, jobDone: () => {}, openUrl: () => {}, ...io };
    this.ncCache = null;
    // Free Nexus accounts install collections one site click at a time: { items, total }.
    this.queue = null;
    this.jobs = [];
    this.jobSeq = 0;
    this.running = 0;
    this.private = new Map(); // job id -> { spec, ctl, settle }
  }

  // ---------- Nexus account ----------

  get key() {
    const enc = this.m.state.settings.nexusKey;
    if (!enc) return null;
    try {
      return this.io.decrypt(enc);
    } catch {
      return null;
    }
  }

  requireKey() {
    const key = this.key;
    if (!key) throw new Error('E_NEXUS_LOGIN');
    return key;
  }

  async login(apiKey) {
    const key = String(apiKey || '').trim();
    if (!key) throw new Error('E_NEXUS_KEY');
    const u = await nexus.validate(key);
    Object.assign(this.m.state.settings, {
      nexusKey: this.io.encrypt(key),
      nexusUser: { id: u.user_id, name: u.name, premium: !!u.is_premium, avatar: u.profile_url || '' },
    });
    this.m.save();
  }

  logout() {
    delete this.m.state.settings.nexusKey;
    delete this.m.state.settings.nexusUser;
    this.m.save();
  }

  // ---------- background jobs ----------

  jobList() {
    return this.jobs.map((j) => ({ ...j }));
  }

  changed() {
    if (this.changeTimer) return;
    this.changeTimer = setTimeout(() => {
      this.changeTimer = null;
      this.io.jobsChanged(this.jobList());
    }, 200);
  }

  /**
   * spec.prepare({ dir, signal, onProgress, job }) downloads and returns { dest, overrides };
   * spec.after(results) runs after a successful install and may return extra data for the UI.
   */
  startJob({ name, kind, ref = {}, size = 0, prepare, after }) {
    const job = { id: ++this.jobSeq, name, kind, ref, status: 'queued', received: 0, total: size, speed: 0, error: null, modId: null, createdAt: Date.now() };
    let settle;
    const done = new Promise((resolve, reject) => (settle = { resolve, reject }));
    done.catch(() => {}); // callers that don't wait must not cause unhandled rejections
    this.private.set(job.id, { spec: { prepare, after }, ctl: new AbortController(), settle, done });
    this.jobs.push(job);
    const finished = this.jobs.filter((j) => !ACTIVE.has(j.status));
    if (finished.length > KEEP_FINISHED) this.jobs = this.jobs.filter((j) => ACTIVE.has(j.status) || finished.slice(-KEEP_FINISHED).includes(j));
    this.changed();
    this.pump();
    return job;
  }

  // Resolves with the install results of a job (or rejects with its error).
  finished(job) {
    return this.private.get(job.id)?.done ?? Promise.resolve(job.results || []);
  }

  pump() {
    while (this.running < MAX_PARALLEL) {
      const next = this.jobs.find((j) => j.status === 'queued');
      if (!next) return;
      this.running++;
      next.status = 'downloading';
      this.runJob(next).finally(() => {
        this.running--;
        this.changed();
        this.pump();
      });
    }
  }

  async runJob(job) {
    const { spec, ctl, settle } = this.private.get(job.id);
    const dir = path.join(this.m.tmpDir, `job-${job.id}-${Date.now()}`);
    let results = null;
    try {
      let mark = { t: Date.now(), r: 0 };
      const onProgress = (received, total) => {
        job.received = received;
        if (total) job.total = total;
        const now = Date.now();
        if (now - mark.t >= 700) {
          job.speed = Math.max(0, (received - mark.r) / ((now - mark.t) / 1000));
          mark = { t: now, r: received };
        }
        this.changed();
      };
      const { dest, overrides } = await spec.prepare({ dir, signal: ctl.signal, onProgress, job });
      if (ctl.signal.aborted) throw new Error('E_CANCELED');

      job.status = 'installing';
      job.speed = 0;
      this.changed();
      results = await this.io.serial(() => this.m.importPaths([dest], () => {}, overrides));
      const ok = results.find((r) => r.ok);
      if (!ok) throw new Error(results[0]?.error || 'E_NO_FILES');
      job.modId = ok.id;
      job.status = 'done';
      job.results = results;
      const extra = (spec.after && (await spec.after(results).catch(() => ({})))) || {};
      this.io.jobDone(job, results, extra);
      settle.resolve(results);
    } catch (e) {
      const msg = e.message || String(e);
      job.status = msg === 'E_CANCELED' || msg === 'E_FOMOD_CANCEL' ? 'canceled' : 'error';
      job.error = msg;
      job.results = results || [{ ok: false, file: job.name, error: msg }];
      if (job.status === 'error') this.io.jobDone(job, job.results, {});
      settle.reject(new Error(msg));
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
      this.private.delete(job.id);
      this.changed();
    }
  }

  cancelJob(id) {
    const job = this.jobs.find((j) => j.id === id);
    const p = this.private.get(id);
    if (!job || !p || job.status === 'installing') return;
    p.ctl.abort();
    if (job.status === 'queued') {
      job.status = 'canceled';
      job.error = 'E_CANCELED';
      p.settle.reject(new Error('E_CANCELED'));
      this.private.delete(id);
    }
    this.changed();
  }

  clearFinished() {
    this.jobs = this.jobs.filter((j) => ACTIVE.has(j.status));
    this.changed();
  }

  // Resolves once no job is waiting, downloading or installing (used by tests).
  async idle() {
    while (this.jobs.some((j) => ACTIVE.has(j.status))) await new Promise((r) => setTimeout(r, 100));
  }

  // ---------- Nexus mods ----------

  async lookup(ref) {
    const { modId, fileId } = nexus.parseModRef(ref);
    const key = this.requireKey();
    const [info, res] = await Promise.all([nexus.modInfo(key, modId), nexus.modFiles(key, modId)]);
    const order = { MAIN: 0, UPDATE: 1, OPTIONAL: 2, MISCELLANEOUS: 3, OLD_VERSION: 4, ARCHIVED: 5 };
    const files = (res.files || [])
      .filter((f) => f.category_name !== 'ARCHIVED')
      .map((f) => ({
        fileId: f.file_id,
        name: f.name,
        version: f.version || '',
        category: f.category_name || 'MISCELLANEOUS',
        size: f.size_in_bytes || (f.size_kb || 0) * 1024,
        fileName: f.file_name,
        uploaded: (f.uploaded_timestamp || 0) * 1000,
        description: (f.description || '').replace(/<[^>]+>/g, '').slice(0, 300),
      }))
      .sort((a, b) => (order[a.category] ?? 9) - (order[b.category] ?? 9) || b.uploaded - a.uploaded);
    return {
      modId,
      highlightFile: fileId,
      name: info.name,
      author: info.author,
      version: info.version,
      summary: (info.summary || '').replace(/<[^>]+>/g, ''),
      picture: info.picture_url || '',
      url: nexus.modUrl(modId),
      files,
      installed: this.m.state.mods.find((m) => m.key === `nexus:${modId}`)?.origin?.fileId || null,
    };
  }

  /**
   * Starts a background download + install of one Nexus file.
   * opts: { name, fomodChoices, deps (offer missing requirements, default true), after }
   */
  async nexusJob(modId, fileId, nxm = null, opts = {}) {
    const key = this.requireKey();
    // nxm:// keys expire within minutes, so the download link is fetched right away.
    const earlyLinks = nxm ? await nexus.downloadLinks(key, modId, fileId, nxm) : null;
    return this.startJob({
      name: opts.name || `Nexus #${modId}`,
      kind: 'nexus',
      ref: { modId, fileId },
      prepare: async ({ dir, signal, onProgress, job }) => {
        const [info, res] = await Promise.all([nexus.modInfo(key, modId), nexus.modFiles(key, modId)]);
        const file = (res.files || []).find((f) => f.file_id === fileId);
        job.name = info.name;
        if (file?.size_in_bytes) job.total = file.size_in_bytes;
        this.changed();
        const links = earlyLinks || (await nexus.downloadLinks(key, modId, fileId, null));
        if (!links?.length) throw new Error('E_NEXUS_LINK');
        const dest = path.join(dir, sanitize(file?.file_name || `nexus-${modId}-${fileId}.zip`));
        await download(links[0].URI, dest, { signal, onProgress });
        return {
          dest,
          overrides: {
            name: info.name,
            version: file?.version || info.version,
            author: info.author,
            nexusUrl: nexus.modUrl(modId),
            key: `nexus:${modId}`,
            origin: { type: 'nexus', modId, fileId, category: file?.category_name || '' },
            fomodChoices: opts.fomodChoices || null,
          },
        };
      },
      after: async (results) => {
        const extra = opts.after ? (await opts.after(results)) || {} : {};
        if (opts.deps !== false) extra.missing = await this.missingRequirements(modId);
        return extra;
      },
    });
  }

  // Blocking variant (download + install), for callers outside the IPC queue.
  async installNexusFile(modId, fileId, nxm = null, opts = {}) {
    return this.finished(await this.nexusJob(modId, fileId, nxm, { deps: false, ...opts }));
  }

  handleNxm(link) {
    const n = nexus.parseNxm(link);
    if (n.game !== nexus.GAME) throw new Error('E_NXM_GAME');
    // A queued collection item brings the sender's FOMOD choices along and opens the next page when done.
    const queued = this.queue?.items.find((x) => x.modId === n.modId);
    return this.nexusJob(n.modId, n.fileId, { key: n.key, expires: n.expires }, {
      name: queued?.name,
      fomodChoices: queued?.c,
      deps: !queued,
      after: async (results) => {
        if (queued) this.io.openUrl(await this.io.serial(async () => this.onNxmInstalled(n.modId, results)));
      },
    });
  }

  // Requirements of a Nexus mod that are neither installed through the manager nor present as frameworks.
  async missingRequirements(modId) {
    const reqs = await nexus.requirements(modId).catch(() => []);
    const fws = game.frameworkStatus(this.m.gameDir);
    return reqs.filter(
      (r) => r.modId !== modId && !this.m.state.mods.some((m) => m.key === `nexus:${r.modId}`) && !fws.some((f) => f.nexus === r.modId && f.installed),
    );
  }

  // Marks mods whose installed Nexus file has a newer replacement.
  async checkUpdates() {
    const key = this.requireKey();
    let found = 0;
    for (const mod of this.m.state.mods.filter((m) => m.origin?.type === 'nexus' && m.origin.fileId)) {
      try {
        const res = await nexus.modFiles(key, mod.origin.modId);
        const newest = nexus.newestFile(res, mod.origin.fileId);
        mod.update = newest && newest.file_id !== mod.origin.fileId ? { fileId: newest.file_id, version: newest.version || '' } : null;
        if (mod.update) found++;
      } catch (e) {
        if (e.message === 'E_NEXUS_RATE' || e.message === 'E_NEXUS_KEY') throw e;
      }
    }
    this.m.save();
    return found;
  }

  // Premium downloads in the background; free accounts get the file page to click "Mod Manager Download".
  async updateMod(id) {
    const mod = this.m.mod(id);
    if (!mod.update || mod.origin?.type !== 'nexus') return null;
    if (!this.m.state.settings.nexusUser?.premium) return { openUrl: nexus.fileUrl(mod.origin.modId, mod.update.fileId) };
    await this.nexusJob(mod.origin.modId, mod.update.fileId, null, { name: mod.name, fomodChoices: mod.fomod?.choices });
    return { started: true };
  }

  // ---------- collections ----------

  /**
   * Finds the Nexus page of mods that were installed from local files (exact name match),
   * so they can go into share codes. Matches are saved as the mod's Nexus link (visible and
   * editable in the mod details); misses are not searched again for a day.
   */
  async identifyMods(mods) {
    const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9а-яё]+/gi, '');
    const todo = mods.filter(
      (m) => !m.origin && !/nexusmods\.com\/cyberpunk2077\/mods\/\d+/i.test(m.nexusUrl || '') && !(m.nexusLookupAt > Date.now() - 24 * 3600 * 1000),
    );
    const found = [];
    const worker = async () => {
      for (let m = todo.shift(); m; m = todo.shift()) {
        try {
          const { mods: hits } = await nexus.searchMods({ text: m.name, sort: 'downloads', count: 10 });
          const hit = hits.find((h) => norm(h.name) === norm(m.name));
          if (hit) {
            m.nexusUrl = nexus.modUrl(hit.modId);
            found.push({ name: m.name, modId: hit.modId });
          } else m.nexusLookupAt = Date.now();
        } catch {}
      }
    };
    await Promise.all(Array.from({ length: 4 }, worker));
    if (found.length || mods.some((m) => m.nexusLookupAt)) this.m.save();
    return found;
  }

  // Codes made from mods imported as Nexus-named zips only know the mod id: take its newest main file.
  async resolveFile(item) {
    if (item.f) return item.f;
    const d = await nexus.catalogDetail(item.id);
    const file = d.files.find((f) => f.category === 'MAIN') || d.files[0];
    if (!file) throw new Error('E_NEXUS_LINK');
    return file.fileId;
  }

  async installCollection(code) {
    const payload = collections.preview(this.m.state.mods, collections.decode(code));
    return this.installItems(payload.items.filter((it) => it.status !== 'have'));
  }

  // Starts installs of collection-style items: { t: 'nx', id, f?, n, e, c? } or { t: 'nc', v, g, e }.
  // Premium and NightCoop become background jobs; free accounts get a queue of site pages to click through.
  async installItems(todo) {
    const user = this.m.state.settings.nexusUser;
    const variant = this.m.state.settings.ncVariant;
    const results = [];
    const queue = [];
    let jobs = 0;
    // Items switched off in the collection are installed and then disabled.
    const keepDisabled = (it) => async (res) => {
      const ok = res.find((r) => r.ok);
      if (ok && !it.e) await this.io.serial(async () => this.m.disable(ok.id));
    };

    for (const it of todo) {
      try {
        if (it.t === 'nc') {
          await this.ncJob(it.v, variant || it.g, { after: keepDisabled(it) });
          jobs++;
        } else if (!user) {
          results.push({ ok: false, file: it.n, error: 'E_NEXUS_LOGIN' });
        } else {
          const fileId = await this.resolveFile(it);
          if (user.premium) {
            await this.nexusJob(it.id, fileId, null, { name: it.n, fomodChoices: it.c, deps: false, after: keepDisabled(it) });
            jobs++;
          } else queue.push({ modId: it.id, fileId, name: it.n, e: it.e, c: it.c });
        }
      } catch (e) {
        results.push({ ok: false, file: it.n, error: e.message });
      }
    }
    if (queue.length) {
      const known = new Set((this.queue?.items || []).map((x) => x.modId));
      const fresh = queue.filter((x) => !known.has(x.modId));
      this.queue = this.queue ? { items: [...this.queue.items, ...fresh], total: this.queue.total + fresh.length } : { items: fresh, total: fresh.length };
    }
    return { results, jobs, queued: queue.length };
  }

  // Called after an nxm:// install; returns the next queued item to open, if any.
  onNxmInstalled(modId, results) {
    if (!this.queue) return null;
    const idx = this.queue.items.findIndex((x) => x.modId === modId);
    if (idx < 0) return null;
    const [item] = this.queue.items.splice(idx, 1);
    const ok = results.find((r) => r.ok);
    if (ok && !item.e) this.m.disable(ok.id);
    if (!this.queue.items.length) this.queue = null;
    return this.queue?.items[0] || null;
  }

  queueSkip() {
    this.queue?.items.shift();
    if (!this.queue?.items.length) this.queue = null;
    return this.queue?.items[0] || null;
  }

  // ---------- NightCoop ----------

  async ncReleases(force = false) {
    if (!force && this.ncCache && Date.now() - this.ncCache.at < 5 * 60 * 1000) return this.ncCache.data;
    const res = await fetch(new URL('releases.json', NC_BASE), { cache: 'no-store' });
    if (!res.ok) throw new Error(`nightcoop.net HTTP ${res.status}`);
    const data = await res.json();
    if (!Array.isArray(data.releases)) throw new Error('E_NC_FEED');
    this.ncCache = { at: Date.now(), data };
    return data;
  }

  async ncJob(version, variant, opts = {}) {
    const feed = await this.ncReleases();
    const rel = feed.releases.find((r) => r.version === version);
    if (!rel) throw new Error('E_NC_VERSION');
    const files = (rel.files || []).filter((f) => f.kind === 'mod');
    const file = files.find((f) => !f.game || f.game.includes(variant)) || files[0];
    if (!file) throw new Error('E_NC_VERSION');
    const url = new URL(file.url, NC_BASE);
    if (url.hostname !== new URL(NC_BASE).hostname) throw new Error('E_NC_FEED');

    return this.startJob({
      name: `NightCoop ${rel.version}`,
      kind: 'nightcoop',
      ref: { version: rel.version },
      size: file.size,
      prepare: async ({ dir, signal, onProgress }) => {
        const dest = path.join(dir, sanitize(file.name));
        await download(url.href, dest, { sha256: file.sha256, signal, onProgress });
        return {
          dest,
          overrides: {
            name: 'NightCoop',
            version: rel.version,
            author: 'NightCoop',
            nexusUrl: '',
            key: NC_KEY,
            origin: { type: 'nightcoop', version: rel.version, protocol: rel.protocol, variant: file.game?.[0] || null, build: rel.build || '' },
          },
        };
      },
      after: opts.after,
    });
  }

  // Blocking variant (download + install), for callers outside the IPC queue.
  async ncInstall(version, variant) {
    return this.finished(await this.ncJob(version, variant));
  }
}

module.exports = { Online, NC_KEY, MAX_PARALLEL };
