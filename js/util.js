// Small helpers: paths, file types, hashing, base64.
export const enc = new TextEncoder();
export const dec = new TextDecoder();

export const dirname = p => { const i = p.lastIndexOf('/'); return i < 0 ? '' : p.slice(0, i); };
export const basename = p => p.slice(p.lastIndexOf('/') + 1);
export const join = (...a) => a.filter(Boolean).join('/');
export const extOf = p => { const b = basename(p), i = b.lastIndexOf('.'); return i <= 0 ? '' : b.slice(i + 1).toLowerCase(); };
export const stem = p => { const b = basename(p), i = b.lastIndexOf('.'); return i <= 0 ? b : b.slice(0, i); };

const TEXT = new Set('md markdown txt text json yml yaml toml csv tsv xml html htm css js mjs ts py sh rs go c h cpp java kt log ini conf cfg org tex rst'.split(' '));
const IMG = new Set('png jpg jpeg gif webp svg avif bmp ico'.split(' '));
const AUD = new Set('mp3 wav ogg m4a flac opus aac'.split(' '));
const VID = new Set('mp4 webm mov mkv ogv'.split(' '));

export const isMarkdown = p => ['md', 'markdown'].includes(extOf(p));
export const isNote = p => isMarkdown(p) || ['txt', 'text'].includes(extOf(p));
export const isText = p => TEXT.has(extOf(p)) || extOf(p) === '';
export function kindOf(p) {
  const e = extOf(p);
  if (isText(p)) return 'text';
  if (IMG.has(e)) return 'image';
  if (AUD.has(e)) return 'audio';
  if (VID.has(e)) return 'video';
  if (e === 'pdf') return 'pdf';
  return 'other';
}
const MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml', avif: 'image/avif', bmp: 'image/bmp', ico: 'image/x-icon',
  pdf: 'application/pdf', mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', m4a: 'audio/mp4', flac: 'audio/flac', opus: 'audio/ogg', aac: 'audio/aac',
  mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime', mkv: 'video/x-matroska', ogv: 'video/ogg', md: 'text/markdown', txt: 'text/plain', json: 'application/json' };
export const mimeOf = p => MIME[extOf(p)] || 'application/octet-stream';

export function uniquePath(p, exists) {
  if (!exists(p)) return p;
  const d = dirname(p), s = stem(p), e = extOf(p);
  for (let i = 2; ; i++) { const c = join(d, `${s} ${i}${e ? '.' + e : ''}`); if (!exists(c)) return c; }
}
export const sanitizeName = n => n.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '-').replace(/^\.+/, '').trim();
export const naturalCmp = (a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });

export async function gitBlobSha(bytes) {
  const head = enc.encode(`blob ${bytes.length}\0`);
  const all = new Uint8Array(head.length + bytes.length);
  all.set(head); all.set(bytes, head.length);
  const h = new Uint8Array(await crypto.subtle.digest('SHA-1', all));
  return Array.from(h, b => b.toString(16).padStart(2, '0')).join('');
}
export function bytesToB64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
export async function pool(items, n, fn) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) await fn(items[i++]);
  }));
}
