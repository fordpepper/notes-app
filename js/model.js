// Local, offline-first file model. Every file is a record:
//   { path, content: string | Blob | null (not downloaded yet), sha: git blob sha of content,
//     synced: sha that exists on GitHub at this path as of last sync (null = never pushed),
//     deleted?: true (tombstone, waiting to be pushed), mtime }
// A record is "dirty" (needs pushing) when sha !== synced.
import { db } from './db.js';
import { enc, dirname, join, gitBlobSha, mimeOf } from './util.js';

export const files = new Map();
export const hooks = { fetchBlob: null };   // set by sync.js: sha -> ArrayBuffer
const subs = new Set();
export const subscribe = f => (subs.add(f), () => subs.delete(f));
export const emit = () => subs.forEach(f => f());

export const isDirty = r => r.deleted ? !!r.synced : r.sha !== r.synced;
export const pendingCount = () => { let n = 0; for (const r of files.values()) if (isDirty(r)) n++; return n; };
export const exists = p => { const r = files.get(p); return !!r && !r.deleted; };
export const livePaths = () => [...files.values()].filter(r => !r.deleted).map(r => r.path);
export const dirExists = d => { const pre = d + '/'; for (const r of files.values()) if (!r.deleted && r.path.startsWith(pre)) return true; return false; };

export const put = r => { files.set(r.path, r); return db.put(r); };
export const drop = p => { files.delete(p); return db.del(p); };
export async function load() { for (const r of await db.all()) files.set(r.path, r); emit(); }
export async function wipe() { files.clear(); await db.clear(); emit(); }

export const toBytes = async c => typeof c === 'string' ? enc.encode(c) : new Uint8Array(await c.arrayBuffer());

export async function saveText(path, text) {
  const r = files.get(path);
  if (!r || r.deleted) return;
  const sha = await gitBlobSha(enc.encode(text));
  const cur = files.get(path);
  if (!cur || cur.deleted || (cur.sha === sha && cur.content === text)) return;
  await put({ ...cur, content: text, sha, mtime: Date.now() });
  emit();
}

export async function create(path, content = '') {
  const sha = await gitBlobSha(await toBytes(content));
  const old = files.get(path);
  await put({ path, content, sha, synced: old?.synced ?? null, mtime: Date.now() });
  emit();
  return path;
}

async function removeOne(path) {
  const r = files.get(path);
  if (!r) return;
  if (r.synced) await put({ path, deleted: true, synced: r.synced }); else await drop(path);
}
export async function remove(path) { await removeOne(path); await prunePins(); emit(); }
export async function removeDir(dir) {
  for (const p of livePaths()) if (p.startsWith(dir + '/')) await removeOne(p);
  await prunePins(); emit();
}

async function moveOne(from, to) {
  const r = files.get(from);
  if (!r || r.deleted || from === to) return;
  const old = files.get(to);
  await put({ path: to, content: r.content, sha: r.sha, synced: old?.synced ?? null, mtime: Date.now() });
  await removeOne(from);
}
export async function move(from, to) { await moveOne(from, to); await remapPins(from, to); emit(); }
export async function moveDir(from, to) {
  for (const p of livePaths()) if (p.startsWith(from + '/')) await moveOne(p, to + p.slice(from.length));
  await remapPins(from, to); emit();
}
export async function makeDir(dir) { await create(join(dir, '.gitkeep'), ''); }

// Binary content, downloading lazily from GitHub when needed.
export async function getBlob(path) {
  let r = files.get(path);
  if (!r || r.deleted) throw new Error('File not found');
  if (r.content == null) {
    if (!hooks.fetchBlob) throw new Error('Not connected to GitHub');
    const buf = await hooks.fetchBlob(r.sha);
    const blob = new Blob([buf], { type: mimeOf(path) });
    r = files.get(path);
    if (r && !r.deleted && r.sha === (await gitBlobSha(new Uint8Array(buf)))) await put({ ...r, content: blob });
    return blob;
  }
  return typeof r.content === 'string' ? new Blob([r.content], { type: mimeOf(path) }) : r.content.type ? r.content : new Blob([r.content], { type: mimeOf(path) });
}

// ---- pins (stored in the repo so they sync between devices) ----
export const PINS = '.notes-app.json';
export function getPins() {
  const r = files.get(PINS);
  if (!r || r.deleted || typeof r.content !== 'string') return [];
  try { return JSON.parse(r.content).pins || []; } catch { return []; }
}
export async function setPins(arr) {
  const text = JSON.stringify({ pins: arr }, null, 2) + '\n';
  if (exists(PINS)) await saveText(PINS, text); else await create(PINS, text);
}
async function prunePins() {
  const pins = getPins(), keep = pins.filter(exists);
  if (keep.length !== pins.length) await setPins(keep);
}
async function remapPins(from, to) {
  const pins = getPins();
  const next = pins.map(p => p === from ? to : p.startsWith(from + '/') ? to + p.slice(from.length) : p);
  if (next.some((p, i) => p !== pins[i])) await setPins(next);
}

// ---- folder tree for the sidebar ----
export function buildTree() {
  const root = { name: '', path: '', dirs: new Map(), files: [] };
  for (const r of files.values()) {
    if (r.deleted) continue;
    const parts = r.path.split('/');
    let n = root;
    for (let i = 0; i < parts.length - 1 && n; i++) {
      if (parts[i].startsWith('.')) { n = null; break; }
      let d = n.dirs.get(parts[i]);
      if (!d) { d = { name: parts[i], path: join(n.path, parts[i]), dirs: new Map(), files: [] }; n.dirs.set(parts[i], d); }
      n = d;
    }
    const name = parts[parts.length - 1];
    if (n && !name.startsWith('.')) n.files.push(r);
  }
  return root;
}
export function allDirs() {
  const out = [];
  (function walk(n) { for (const d of n.dirs.values()) { out.push(d.path); walk(d); } })(buildTree());
  return out.sort();
}
