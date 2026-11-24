// Local, offline-first file model. Every file is a record:
//   { path, content: string | Blob | null (not downloaded yet), sha: git blob sha of content,
//     synced: sha that exists on GitHub at this path as of last sync (null = never pushed),
//     deleted?: true (tombstone, waiting to be pushed), mtime }
// A record is "dirty" (needs pushing) when sha !== synced.
import { db } from './db.js';
import { enc, dec, join, gitBlobSha, mimeOf, isText, isNote, isHidden, isAmbiguous, kindOf, sniff, looksText } from './util.js';

export const files = new Map();
export const hooks = { fetchBlob: null, gate: null };   // fetchBlob: set by sync.js (sha -> ArrayBuffer); gate: set by the app (true = ask before downloading)
/** True on mobile data (or with Data Saver on): large downloads should wait for the user's OK. Unknown networks count as unmetered. */
export const metered = () => { const c = navigator.connection; return !!c && (c.type === 'cellular' || c.saveData === true); };
const approved = new Set();
export const approve = p => approved.add(p);
export const needsApproval = p => { const r = files.get(p); return !!(hooks.gate && r && !r.deleted && r.content == null && !approved.has(p) && hooks.gate()); };
const subs = new Set();
/** kind: 'tree' (structure/other changes) or 'content' (only a note's text changed) */
export const subscribe = f => (subs.add(f), () => subs.delete(f));
export const emit = (kind = 'tree') => subs.forEach(f => f(kind));

export const PINS = '.notes-app.json';
/** Files we always keep downloaded: notes (searchable, editable offline) and the pins file. */
export const isEager = p => p === PINS || p === 'calendar.ics' || p.startsWith('.google/') || (isNote(p) && !isHidden(p));   // the calendar must be readable offline too

/** Size in bytes: from the content if it's on this device, else the size GitHub told us. */
export const sizeOf = r => r.content == null ? (r.size ?? null) : typeof r.content === 'string' ? enc.encode(r.content).length : r.content.size;
export const isLocal = r => r.content != null;
export const isDirty = r => r.deleted ? !!r.synced : r.sha !== r.synced;
export const pendingCount = () => { let n = 0; for (const r of files.values()) if (isDirty(r)) n++; return n; };
export const exists = p => { const r = files.get(p); return !!r && !r.deleted; };
export const livePaths = () => { const out = []; for (const r of files.values()) if (!r.deleted) out.push(r.path); return out; };
export const dirExists = d => { const pre = d + '/'; for (const r of files.values()) if (!r.deleted && r.path.startsWith(pre)) return true; return false; };

export const put = r => { files.set(r.path, r); return db.put(r); };
export const putBatch = rs => { for (const r of rs) files.set(r.path, r); return db.putMany(rs); };
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
  emit('content');
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
/** Undo a delete: put snapshots of the removed records back. */
export async function restore(records) {
  for (const r of records) {
    const old = files.get(r.path);
    await put({ ...r, deleted: undefined, synced: old?.synced ?? null, mtime: Date.now() });
  }
  emit();
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
export const makeDir = dir => create(join(dir, '.gitkeep'), '');

/** Make sure a record's content is on this device (downloads it by blob sha if needed). */
export async function ensureContent(path) {
  const r = files.get(path);
  if (!r || r.deleted) throw new Error('File not found');
  if (r.content != null) return r;
  if (needsApproval(path)) throw Object.assign(new Error('Not downloaded yet. Waiting for your OK to use mobile data.'), { needsApproval: true });
  if (!hooks.fetchBlob) throw new Error('Not connected to GitHub');
  const buf = await hooks.fetchBlob(r.sha);
  const content = isText(path) && !isAmbiguous(path) ? dec.decode(buf) : new Blob([buf], { type: mimeOf(path) });
  const cur = files.get(path);
  if (cur && !cur.deleted && cur.sha === r.sha && cur.content == null) { const n = { ...cur, content }; await put(n); return n; }
  return { ...r, content };
}
export async function getBlob(path) {
  const { content, mime } = await ensureContent(path);
  const type = mime || mimeOf(path);
  if (typeof content === 'string') return new Blob([content], { type });
  return content.type && content.type !== 'application/octet-stream' ? content : new Blob([content], { type });
}

/**
 * What is this file? Trusts well-known extensions; for a missing or unusual extension it looks at the
 * content (magic bytes), so a picture displays as a picture even if it isn't called *.png. Remembered on the record.
 */
export async function resolveKind(path) {
  const r0 = files.get(path);
  if (!r0 || r0.deleted) throw new Error('File not found');
  if (r0.kind || !isAmbiguous(path)) return kindOf(path, r0);
  const r = await ensureContent(path), c = r.content;
  const bytes = typeof c === 'string' ? enc.encode(c.slice(0, 4096)) : new Uint8Array(await c.slice(0, 4096).arrayBuffer());
  const s = sniff(bytes), kind = s ? s.kind : looksText(bytes) ? 'text' : 'other', mime = s?.mime;
  let content = c;
  if (kind === 'text' && typeof c !== 'string') content = dec.decode(await c.arrayBuffer());
  else if (mime && typeof c !== 'string') content = new Blob([c], { type: mime });
  const cur = files.get(path);
  if (cur && !cur.deleted && cur.sha === r.sha) await put({ ...cur, content, kind, mime });
  return kind;
}

// ---- pins (stored in the repo so they sync between devices) ----
const readApp = () => {
  const r = files.get(PINS);
  if (!r || r.deleted || typeof r.content !== 'string') return {};
  try { const o = JSON.parse(r.content); return o && typeof o === 'object' ? o : {}; } catch { return {}; }
};
async function writeApp(o) {
  const text = JSON.stringify(o, null, 2) + '\n';
  if (exists(PINS)) await saveText(PINS, text); else await create(PINS, text);
}
export function getPins() { const p = readApp().pins; return Array.isArray(p) ? p : []; }
export const setPins = arr => writeApp({ ...readApp(), pins: arr });
/** App settings (colours, Google accounts without tokens…) live in the same repo file, so every device gets them. */
export const getSettings = () => { const s = readApp().settings; return s && typeof s === 'object' && s.data ? s : null; };
export const setSettings = s => writeApp({ ...readApp(), pins: getPins(), settings: s });
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
export function buildTree(showHidden = false) {
  const root = { name: '', path: '', dirs: new Map(), files: [] };
  for (const r of files.values()) {
    if (r.deleted) continue;
    const parts = r.path.split('/');
    let n = root;
    for (let i = 0; i < parts.length - 1 && n; i++) {
      if ((!showHidden || (i === 0 && parts[0] === '.google')) && parts[i].startsWith('.')) { n = null; break; }   // .google holds the calendar-link files: internal
      let d = n.dirs.get(parts[i]);
      if (!d) { d = { name: parts[i], path: join(n.path, parts[i]), dirs: new Map(), files: [] }; n.dirs.set(parts[i], d); }
      n = d;
    }
    const name = parts[parts.length - 1];
    if (n && r.path !== PINS && (showHidden || !name.startsWith('.'))) n.files.push(r);   // the app's own settings file stays out of sight
  }
  return root;
}
export function allDirs() {
  const out = [];
  (function walk(n) { for (const d of n.dirs.values()) { out.push(d.path); walk(d); } })(buildTree());
  return out.sort();
}
