// Pictures: object URLs and scaled-down previews.
// Big photos are decoded once into a ~1280px WebP that is cached on the device (Cache API, keyed by git sha),
// so lists, markdown previews and the file viewer load fast and the full-size file is only opened on demand.
import * as M from './model.js';
import { sniff } from './util.js';

const MAX = 1080, MIN_BYTES = 100 * 1024, CACHE = 'notes-thumbs-v1';
const RASTER = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/avif', 'image/bmp']);

const urlCache = new Map();
/** Object URL for the full stored file (cached per content version). */
export async function blobUrl(path) {
  const r = M.files.get(path);
  if (!r || r.deleted) throw new Error('File not found');
  const key = path + ':' + r.sha;
  if (!urlCache.has(key)) { await M.resolveKind(path).catch(() => {}); urlCache.set(key, URL.createObjectURL(await M.getBlob(path))); }
  return urlCache.get(key);
}

// ---- limit concurrent decode/download work so a note with many pictures stays responsive ----
let active = 0; const waiting = [];
const slot = () => active < 2 ? (active++, Promise.resolve()) : new Promise(r => waiting.push(r));
const free = () => { const n = waiting.shift(); n ? n() : active--; };

const mem = new Map();        // sha -> thumbnail object URL, or null when the original is small enough to use as is
const pending = new Map();
const key = sha => `${location.origin}/__thumb/${sha}-${MAX}`;

/** Already-known source for an image, without waiting (avoids flicker when a preview re-renders). */
export function peek(path) {
  const r = M.files.get(path);
  if (!r) return undefined;
  const t = mem.get(r.sha);
  return t ?? (t === null ? urlCache.get(path + ':' + r.sha) : undefined);
}

/** Scaled-down object URL for an image, or null if the original should be used. */
export function thumb(path) {
  const r = M.files.get(path);
  if (!r || r.deleted) return Promise.resolve(null);
  const sha = r.sha;
  if (mem.has(sha)) return Promise.resolve(mem.get(sha));
  if (!pending.has(sha)) pending.set(sha, build(path, sha).then(u => { mem.set(sha, u); return u; }, () => null).finally(() => pending.delete(sha)));
  return pending.get(sha);
}
/** What to show in the page: the scaled version when there is one, else the original. */
export async function display(path) { return (await thumb(path)) || blobUrl(path); }

async function build(path, sha) {
  const c = typeof caches === 'object' ? await caches.open(CACHE).catch(() => null) : null;
  const hit = await c?.match(key(sha));
  if (hit) return hit.headers.get('x-original') ? null : URL.createObjectURL(await hit.blob());
  await slot();
  try {
    await M.resolveKind(path).catch(() => {});
    const out = await make(await M.getBlob(path));
    await c?.put(key(sha), out ? new Response(out, { headers: { 'content-type': out.type } }) : new Response('', { headers: { 'x-original': '1' } })).catch(() => {});
    return out ? URL.createObjectURL(out) : null;
  } finally { free(); }
}

async function make(blob) {
  if (blob.size < MIN_BYTES || typeof createImageBitmap !== 'function') return null;
  const head = new Uint8Array(await blob.slice(0, 262144).arrayBuffer());
  const mime = sniff(head)?.mime || blob.type;
  if (!RASTER.has(mime)) return null;                      // gif/svg keep their animation / sharpness
  const d = dims(head, mime);
  if (d && Math.max(d.w, d.h) <= MAX) return null;         // already small in pixels
  let bmp = await createImageBitmap(blob, d ? (d.w >= d.h ? { resizeWidth: MAX } : { resizeHeight: MAX }) : undefined);
  const big = Math.max(bmp.width, bmp.height);
  if (big > MAX * 1.02) {
    const k = MAX / big, b2 = await createImageBitmap(bmp, { resizeWidth: Math.round(bmp.width * k), resizeHeight: Math.round(bmp.height * k), resizeQuality: 'high' });
    bmp.close(); bmp = b2;
  }
  const cv = typeof OffscreenCanvas === 'function' ? new OffscreenCanvas(bmp.width, bmp.height) : Object.assign(document.createElement('canvas'), { width: bmp.width, height: bmp.height });
  cv.getContext('2d').drawImage(bmp, 0, 0); bmp.close();
  const enc = (type, q) => cv.convertToBlob ? cv.convertToBlob({ type, quality: q }) : new Promise(r => cv.toBlob(r, type, q));
  let out = await enc('image/webp', .78);
  if (out && out.type !== 'image/webp' && mime === 'image/jpeg') out = await enc('image/jpeg', .85);
  return out && out.size < blob.size * .9 ? out : null;
}

/** Pixel size read from the file header (no decoding). */
function dims(b, mime) {
  const u16 = i => (b[i] << 8) | b[i + 1], u32 = i => ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0;
  const l16 = i => b[i] | (b[i + 1] << 8), l24 = i => b[i] | (b[i + 1] << 8) | (b[i + 2] << 16);
  if (mime === 'image/png') return { w: u32(16), h: u32(20) };
  if (mime === 'image/webp') {
    const t = String.fromCharCode(...b.slice(12, 16));
    if (t === 'VP8 ') return { w: l16(26) & 0x3fff, h: l16(28) & 0x3fff };
    if (t === 'VP8L') { const v = (b[21] | (b[22] << 8) | (b[23] << 16) | (b[24] << 24)) >>> 0; return { w: (v & 0x3fff) + 1, h: ((v >> 14) & 0x3fff) + 1 }; }
    if (t === 'VP8X') return { w: l24(24) + 1, h: l24(27) + 1 };
  }
  if (mime === 'image/jpeg') {
    for (let i = 2; i + 9 < b.length;) {
      if (b[i] !== 0xff) { i++; continue; }
      const m = b[i + 1];
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { h: u16(i + 5), w: u16(i + 7) };
      i += (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7) || m === 0xff) ? (m === 0xff ? 1 : 2) : 2 + u16(i + 2);
    }
  }
  return null;
}

/** Drop cached thumbnails of files that no longer exist. Cheap; run when idle. */
export async function prune() {
  try {
    const c = await caches.open(CACHE), live = new Set([...M.files.values()].map(r => r.sha));
    for (const req of await c.keys()) { const sha = req.url.split('/__thumb/')[1]?.split('-')[0]; if (!live.has(sha)) await c.delete(req); }
  } catch { /* no Cache API */ }
}
