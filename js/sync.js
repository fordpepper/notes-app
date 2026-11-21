// GitHub sync via the Git Data API (no backend needed).
//
// Request budget (data usage matters on mobile):
//   nothing changed ........ 1 conditional request -> "304 Not Modified" (headers only)
//   local edits only ....... blobs + tree + commit + ref update (no listing needed)
//   remote changed ......... ref + commit + one tree listing + only the changed files
// Only notes are downloaded eagerly; images, PDFs and other files are fetched when opened.
import * as M from './model.js';
import { dec, bytesToB64, uniquePath, dirname, basename, stem, extOf, join, pool, EMPTY_SHA } from './util.js';

const API = 'https://api.github.com';
export const getCfg = () => { try { return JSON.parse(localStorage.getItem('cfg')); } catch { return null; } };
export function setCfg(c) { resetState(); c ? localStorage.setItem('cfg', JSON.stringify(c)) : localStorage.removeItem('cfg'); }
export const configured = () => { const c = getCfg(); return !!(c && c.token && c.owner && c.repo); };
export const normRoot = s => { s = (s || '').trim().replace(/^\/+|\/+$/g, ''); return s ? s + '/' : ''; };
export function parseRepo(s) {
  const m = (s || '').trim().replace(/^https?:\/\/github\.com\//, '').replace(/\.git$/, '').replace(/\/+$/, '').split('/');
  return m.length >= 2 && m[0] && m[1] ? { owner: m[0], repo: m[1] } : null;
}

// What we know about the remote as of the last successful sync: { head, tree, etag }
const stateKey = c => `sync:${c.owner}/${c.repo}@${c.branch || ''}`;
const loadState = c => { try { return JSON.parse(localStorage.getItem(stateKey(c))); } catch { return null; } };
const saveState = (c, s) => localStorage.setItem(stateKey(c), JSON.stringify(s));
export function resetState() { for (const k of Object.keys(localStorage)) if (k.startsWith('sync:')) localStorage.removeItem(k); }

export const status = { state: 'idle', msg: '', at: null, fatal: false };
const subs = new Set();
export const onStatus = f => subs.add(f);
function setStatus(state, msg = '', fatal = false) {
  status.state = state; status.msg = msg; status.fatal = fatal;
  if (state === 'idle') status.at = Date.now();
  subs.forEach(f => f(status));
}

async function req(cfg, path, opts = {}, raw = false) {
  return fetch(API + path, {
    ...opts, cache: 'no-store',
    headers: {
      Authorization: 'Bearer ' + cfg.token,
      Accept: raw ? 'application/vnd.github.raw+json' : 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(opts.body ? { 'Content-Type': 'application/json' } : {}),
      ...opts.headers,
    },
  });
}
async function check(r) {
  if (r.ok) return r;
  const t = await r.json().catch(() => ({}));
  throw Object.assign(new Error(t.message || r.statusText), { status: r.status });
}
const gh = async (cfg, path, opts) => { const r = await check(await req(cfg, path, opts)); return r.status === 204 ? null : r.json(); };
const repoPath = c => `/repos/${c.owner}/${c.repo}`;
const refPath = b => b.split('/').map(encodeURIComponent).join('/');

export async function testConnection(cfg) {
  const info = await gh(cfg, repoPath(cfg));
  if (info.permissions && info.permissions.push === false) throw Object.assign(new Error('This token can only read the repo. Give it "Contents: Read and write".'), { status: 403 });
  return { branch: info.default_branch, private: info.private };
}

M.hooks.fetchBlob = async sha => {
  const c = getCfg();
  return (await check(await req(c, `${repoPath(c)}/git/blobs/${sha}`, {}, true))).arrayBuffer();
};

function friendly(e) {
  // Only genuine network failures count as offline (fetch rejects with a TypeError); anything else is a real error.
  if (!navigator.onLine || (e instanceof TypeError && /fetch|network|load failed/i.test(e.message))) return null;
  if (e.status === 401) return { msg: 'GitHub rejected the token. Update it in Settings.', fatal: true };
  if (e.status === 403) return /rate limit/i.test(e.message) ? { msg: 'GitHub rate limit hit. Try again in a few minutes.' } : { msg: 'The token has no write access to this repo.', fatal: true };
  if (e.status === 404) return { msg: 'Repo or branch not found. Check the name and the token’s access.', fatal: true };
  if (e.status === 409) return { msg: 'The repo is empty. Create a first commit (e.g. a README) on GitHub.', fatal: true };
  return { msg: e.message || 'Sync failed' };
}

const defaultBranch = {};
let running = null;
/** Sync now. `force` only shows progress and retries after fatal errors; it never costs extra data. */
export function sync({ force = false } = {}) {
  if (!configured()) { setStatus('unconfigured'); return Promise.resolve(); }
  if (status.fatal && !force) return Promise.resolve();
  return running ??= doSync(force).catch(e => {
    const f = friendly(e);
    if (f === null) setStatus('offline'); else { console.error(e); setStatus('error', f.msg, f.fatal); }
  }).finally(() => { running = null; });
}

async function fetchHead(cfg, rp, branch, st) {
  const r = await req(cfg, `${rp}/git/ref/heads/${refPath(branch)}`, { headers: st?.etag ? { 'If-None-Match': st.etag } : {} });
  if (r.status === 304) return { head: st.head, etag: st.etag };
  const j = await (await check(r)).json();
  return { head: j.object.sha, etag: r.headers.get('ETag') };
}

async function doSync(force) {
  const cfg = getCfg(), rp = repoPath(cfg), root = normRoot(cfg.root);
  if (force) setStatus('syncing');
  for (let attempt = 0; attempt < 3; attempt++) {
    const branch = cfg.branch || (defaultBranch[rp] ??= (await gh(cfg, rp)).default_branch);
    const st = attempt === 0 && M.files.size ? loadState(cfg) : null;   // after a failed push, start fresh
    const { head, etag } = await fetchHead(cfg, rp, branch, st);
    const unchanged = st && st.head === head;                  // remote untouched since our last sync
    if (unchanged && M.pendingCount() === 0) {
      if (etag && etag !== st.etag) saveState(cfg, { ...st, etag });      // remember it so the next poll is a bodyless 304
      setStatus('idle'); return;
    }

    setStatus('syncing');
    let treeSha, remote = null;
    if (unchanged && st.tree) {
      treeSha = st.tree;                                    // remote is exactly what we last saw: skip the listing
    } else {
      const commit = await gh(cfg, `${rp}/git/commits/${head}`);
      treeSha = commit.tree.sha;
      const tree = await gh(cfg, `${rp}/git/trees/${treeSha}?recursive=1`);
      if (tree.truncated) console.warn('Repo tree is truncated by GitHub; very large repos are not fully supported.');
      remote = new Map(); const sizes = new Map();
      for (const t of tree.tree) if (t.type === 'blob' && t.path.startsWith(root) && /^100(644|755)$/.test(t.mode)) { remote.set(t.path.slice(root.length), t.sha); sizes.set(t.path.slice(root.length), t.size); }
      const downloads = await reconcile(remote, sizes);
      let done = 0;
      await pool(downloads, 8, async d => {
        await download(d);
        setStatus('syncing', `Downloading ${++done}/${downloads.length}`);
        if (done % 25 === 0) M.emit();
      });
      M.emit();
    }

    try {
      const pushed = await push(cfg, rp, root, branch, head, treeSha, remote);
      saveState(cfg, pushed ? { head: pushed.head, tree: pushed.tree, etag: null } : { head, tree: treeSha, etag });
      setStatus('idle'); M.emit(); return;
    } catch (e) {
      if ((e.status === 422 || e.status === 409) && attempt < 2) continue;   // branch moved under us: retry from scratch
      throw e;
    }
  }
}

const conflictName = p => join(dirname(p), `${stem(p)} (conflict ${new Date().toISOString().slice(0, 10)})${extOf(p) ? '.' + extOf(p) : ''}`);

/** Compare the remote listing with local records. Applies the trivial outcomes and returns what to download. */
async function reconcile(remote, sizes) {
  const downloads = [], writes = [];
  for (const p of new Set([...remote.keys(), ...M.files.keys()])) {
    const R = remote.get(p), L = M.files.get(p);
    if (!L) { downloads.push({ path: p, sha: R, base: null, size: sizes.get(p) }); continue; }
    if (L.deleted) {
      if (R === undefined) writes.push(M.drop(p));                                // gone on both sides
      else if (R !== L.synced) downloads.push({ path: p, sha: R, base: null, size: sizes.get(p) });   // changed remotely: restore it
      continue;                                                                    // else: push the delete
    }
    if (R === undefined) {
      if (L.synced) {                                                              // deleted remotely
        if (L.sha === L.synced) writes.push(M.drop(p)); else writes.push(M.put({ ...L, synced: null }));
      }
      continue;                                                                    // never pushed: will push
    }
    if (L.sha === R) { if (L.synced !== R || (L.size == null && sizes.has(p))) writes.push(M.put({ ...L, synced: R, size: L.size ?? sizes.get(p) })); continue; }
    if (L.synced === R) continue;                                                  // only local changed: push
    if (L.sha === L.synced) { downloads.push({ path: p, sha: R, base: L.sha, size: sizes.get(p) }); continue; }   // only remote changed
    // Both changed: remote wins at the original path, the local version is kept as a conflict copy.
    if (p !== M.PINS) {
      const copy = uniquePath(conflictName(p), q => M.exists(q) || remote.has(q));
      writes.push(M.put({ ...L, path: copy, synced: null }));
    }
    downloads.push({ path: p, sha: R, base: L.sha, size: sizes.get(p) });
  }
  await Promise.all(writes);
  return downloads;
}

async function download({ path, sha, base, size }) {
  let content = null;                                    // null = fetched on demand
  if (sha === EMPTY_SHA) content = M.isEager(path) ? '' : new Blob([]);
  else if (M.isEager(path)) content = dec.decode(await M.hooks.fetchBlob(sha));
  const cur = M.files.get(path);
  if (cur && !cur.deleted && cur.sha !== base) return;   // edited while downloading: next sync sorts it out
  await M.put({ path, content, sha, synced: sha, size, mtime: Date.now() });
}

function commitMessage(dirty) {
  const dels = dirty.filter(r => r.deleted).length;
  const verb = dels === dirty.length ? 'Delete' : 'Update';
  const names = dirty.filter(r => !basename(r.path).startsWith('.') || r.path === M.PINS).map(r => basename(r.path));
  return dirty.length <= 3 && names.length === dirty.length ? `${verb} ${names.join(', ')}` : `${verb} ${dirty.length} files`;
}

async function push(cfg, rp, root, branch, head, baseTree, remote) {
  const dirty = [...M.files.values()].filter(M.isDirty);
  if (!dirty.length) return null;
  const entries = [], pushed = [];
  await pool(dirty, 4, async r => {
    if (r.deleted) {
      if (remote && !remote.has(r.path)) { pushed.push({ path: r.path, deleted: true }); return; }   // nothing to delete remotely
      entries.push({ path: root + r.path, mode: '100644', type: 'blob', sha: null });
      pushed.push({ path: r.path, deleted: true });
      return;
    }
    let sha = r.sha;
    if (r.content != null) {
      const b = await gh(cfg, `${rp}/git/blobs`, { method: 'POST', body: JSON.stringify({ content: bytesToB64(await M.toBytes(r.content)), encoding: 'base64' }) });
      sha = b.sha;
    }
    entries.push({ path: root + r.path, mode: '100644', type: 'blob', sha });
    pushed.push({ path: r.path, sha });
  });
  let newHead = head, newTree = baseTree;
  if (entries.length) {
    const tree = await gh(cfg, `${rp}/git/trees`, { method: 'POST', body: JSON.stringify({ base_tree: baseTree, tree: entries }) });
    const commit = await gh(cfg, `${rp}/git/commits`, { method: 'POST', body: JSON.stringify({ message: commitMessage(dirty), tree: tree.sha, parents: [head] }) });
    await gh(cfg, `${rp}/git/refs/heads/${refPath(branch)}`, { method: 'PATCH', body: JSON.stringify({ sha: commit.sha, force: false }) });
    newHead = commit.sha; newTree = tree.sha;
  }
  for (const p of pushed) {
    const cur = M.files.get(p.path);
    if (p.deleted) { if (cur?.deleted) await M.drop(p.path); }
    else if (cur && !cur.deleted) await M.put({ ...cur, synced: p.sha });
  }
  return { head: newHead, tree: newTree };
}
