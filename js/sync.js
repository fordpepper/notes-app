// GitHub sync via the Git Data API (no backend needed).
// Pull: fetch the branch tree, compare blob SHAs with local records, download what changed.
// Push: upload changed blobs and make ONE commit for all local changes.
import * as M from './model.js';
import { dec, enc, bytesToB64, isText, uniquePath, dirname, stem, extOf, join, pool } from './util.js';

const API = 'https://api.github.com';
export const getCfg = () => { try { return JSON.parse(localStorage.getItem('cfg')); } catch { return null; } };
export const setCfg = c => c ? localStorage.setItem('cfg', JSON.stringify(c)) : localStorage.removeItem('cfg');
export const configured = () => { const c = getCfg(); return !!(c && c.token && c.owner && c.repo); };
export const normRoot = s => { s = (s || '').trim().replace(/^\/+|\/+$/g, ''); return s ? s + '/' : ''; };
export function parseRepo(s) {
  const m = (s || '').trim().replace(/^https?:\/\/github\.com\//, '').replace(/\.git$/, '').replace(/\/+$/, '').split('/');
  return m.length >= 2 && m[0] && m[1] ? { owner: m[0], repo: m[1] } : null;
}

export const status = { state: 'idle', msg: '', at: null };
const subs = new Set();
export const onStatus = f => subs.add(f);
function setStatus(state, msg = '') { status.state = state; status.msg = msg; if (state === 'idle') status.at = Date.now(); subs.forEach(f => f(status)); }

async function gh(cfg, path, opts = {}, raw = false) {
  const r = await fetch(API + path, {
    ...opts, cache: 'no-store',
    headers: {
      Authorization: 'Bearer ' + cfg.token,
      Accept: raw ? 'application/vnd.github.raw+json' : 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(opts.body ? { 'Content-Type': 'application/json' } : {}),
    },
  });
  if (!r.ok) {
    const t = await r.json().catch(() => ({}));
    const e = new Error(t.message || r.statusText); e.status = r.status; throw e;
  }
  return raw ? r : r.status === 204 ? null : r.json();
}
const repoPath = c => `/repos/${c.owner}/${c.repo}`;

export async function testConnection(cfg) {
  const info = await gh(cfg, repoPath(cfg));
  if (info.permissions && info.permissions.push === false) throw Object.assign(new Error('This token can only read the repo. Give it "Contents: Read and write".'), { status: 403 });
  return { branch: info.default_branch, private: info.private };
}

M.hooks.fetchBlob = async sha => {
  const c = getCfg();
  return (await gh(c, `${repoPath(c)}/git/blobs/${sha}`, {}, true)).arrayBuffer();
};

function friendly(e) {
  if (!navigator.onLine || e instanceof TypeError) return null;
  if (e.status === 401) return 'GitHub rejected the token — update it in Settings.';
  if (e.status === 403) return /rate limit/i.test(e.message) ? 'GitHub rate limit hit — try again in a few minutes.' : 'The token has no write access to this repo.';
  if (e.status === 404) return 'Repo or branch not found (check the name and that the token can access it).';
  if (e.status === 409) return 'The repo is empty — create a first commit (e.g. a README) on GitHub first.';
  return e.message || 'Sync failed';
}

const defaultBranch = {};
let running = null;
export function sync({ force = false } = {}) {
  if (!configured()) { setStatus('unconfigured'); return Promise.resolve(); }
  return running ??= doSync(force).catch(e => {
    const m = friendly(e);
    if (m === null) setStatus('offline'); else { console.error(e); setStatus('error', m); }
  }).finally(() => { running = null; });
}

async function doSync(force) {
  const cfg = getCfg(), rp = repoPath(cfg), root = normRoot(cfg.root);
  setStatus('syncing');
  const lastKey = `head:${cfg.owner}/${cfg.repo}@${cfg.branch}`;
  for (let attempt = 0; attempt < 3; attempt++) {
    const branch = cfg.branch || (defaultBranch[rp] ??= (await gh(cfg, rp)).default_branch);
    const head = (await gh(cfg, `${rp}/git/ref/heads/${encodeURIComponent(branch).replace(/%2F/g, '/')}`)).object.sha;
    if (!force && head === localStorage.getItem(lastKey) && M.pendingCount() === 0) { setStatus('idle'); return; }

    const commit = await gh(cfg, `${rp}/git/commits/${head}`);
    const tree = await gh(cfg, `${rp}/git/trees/${commit.tree.sha}?recursive=1`);
    if (tree.truncated) console.warn('Repo tree is truncated by GitHub; very large repos are not fully supported.');
    const remote = new Map();
    for (const t of tree.tree) if (t.type === 'blob' && t.path.startsWith(root) && /^100(644|755)$/.test(t.mode)) remote.set(t.path.slice(root.length), t.sha);

    const downloads = await reconcile(remote);
    let done = 0;
    await pool(downloads, 8, async d => { await download(cfg, d); setStatus('syncing', `Downloading ${++done}/${downloads.length}`); if (done % 20 === 0) M.emit(); });
    M.emit();

    try {
      const newHead = await push(cfg, rp, root, branch, head, commit.tree.sha);
      localStorage.setItem(lastKey, newHead || head);
      setStatus('idle'); M.emit(); return;
    } catch (e) {
      if ((e.status === 422 || e.status === 409) && attempt < 2) continue;   // branch moved under us: retry
      throw e;
    }
  }
}

const conflictName = p => join(dirname(p), `${stem(p)} (conflict ${new Date().toISOString().slice(0, 10)})${extOf(p) ? '.' + extOf(p) : ''}`);

async function reconcile(remote) {
  const downloads = [], writes = [];
  for (const p of new Set([...remote.keys(), ...M.files.keys()])) {
    const R = remote.get(p), L = M.files.get(p);
    if (!L) { downloads.push({ path: p, sha: R, base: null }); continue; }
    if (L.deleted) {
      if (R === undefined) writes.push(M.drop(p));                       // gone on both sides
      else if (R !== L.synced) downloads.push({ path: p, sha: R, base: null });  // changed remotely: restore
      continue;                                                           // else: push the delete
    }
    if (R === undefined) {
      if (L.synced) {                                                     // deleted remotely
        if (L.sha === L.synced) writes.push(M.drop(p)); else writes.push(M.put({ ...L, synced: null }));
      }
      continue;                                                           // never pushed: will push
    }
    if (L.sha === R) { if (L.synced !== R) writes.push(M.put({ ...L, synced: R })); continue; }
    if (L.synced === R) continue;                                         // only local changed: push
    if (L.sha === L.synced) { downloads.push({ path: p, sha: R, base: L.sha }); continue; }  // only remote changed
    // both changed: remote wins at the original path, local version is kept as a conflict copy
    if (p !== M.PINS) {
      const copy = uniquePath(conflictName(p), q => M.exists(q) || remote.has(q));
      writes.push(M.put({ ...L, path: copy, synced: null }));
    }
    downloads.push({ path: p, sha: R, base: L.sha });
  }
  await Promise.all(writes);
  return downloads;
}

async function download(cfg, { path, sha, base }) {
  let content = null;
  if (isText(path)) content = dec.decode(await M.hooks.fetchBlob(sha));
  const cur = M.files.get(path);
  if (cur && !cur.deleted && cur.sha !== base) return;      // edited while we were downloading: next sync sorts it out
  await M.put({ path, content, sha, synced: sha, mtime: Date.now() });
}

async function push(cfg, rp, root, branch, head, baseTree) {
  const dirty = [...M.files.values()].filter(M.isDirty);
  if (!dirty.length) return null;
  const entries = [], pushed = [];
  await pool(dirty, 4, async r => {
    if (r.deleted) { entries.push({ path: root + r.path, mode: '100644', type: 'blob', sha: null }); pushed.push({ path: r.path, deleted: true }); return; }
    let sha = r.sha;
    if (r.content != null) {
      const b = await gh(cfg, `${rp}/git/blobs`, { method: 'POST', body: JSON.stringify({ content: bytesToB64(await M.toBytes(r.content)), encoding: 'base64' }) });
      sha = b.sha;
    }
    entries.push({ path: root + r.path, mode: '100644', type: 'blob', sha });
    pushed.push({ path: r.path, sha });
  });
  const n = dirty.length;
  const tree = await gh(cfg, `${rp}/git/trees`, { method: 'POST', body: JSON.stringify({ base_tree: baseTree, tree: entries }) });
  const commit = await gh(cfg, `${rp}/git/commits`, { method: 'POST', body: JSON.stringify({ message: `Update ${n} note${n > 1 ? 's' : ''}`, tree: tree.sha, parents: [head] }) });
  await gh(cfg, `${rp}/git/refs/heads/${branch}`, { method: 'PATCH', body: JSON.stringify({ sha: commit.sha, force: false }) });
  for (const p of pushed) {
    const cur = M.files.get(p.path);
    if (p.deleted) { if (cur?.deleted) await M.drop(p.path); }
    else if (cur && !cur.deleted) await M.put({ ...cur, synced: p.sha });
  }
  return commit.sha;
}
