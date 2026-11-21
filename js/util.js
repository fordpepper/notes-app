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
/** Extensions we trust. Anything else (no extension, odd extension) is identified from the file's content. */
const KNOWN = new Set([...TEXT, ...IMG, ...AUD, ...VID, 'pdf']);
export const isAmbiguous = p => !KNOWN.has(extOf(p));
/** `rec.kind` is set once a file without a trustworthy extension has been identified by its content. */
export function kindOf(p, rec) {
  if (rec?.kind) return rec.kind;
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
const EXT = {};
for (const [e, m] of Object.entries(MIME)) EXT[m] ??= e;
export const extForMime = m => EXT[m] || '';
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

export const isHidden = p => p.split('/').some(s => s.startsWith('.'));
export const EMPTY_SHA = 'e69de29bb2d1d6434b8b29ae775ad8c2e48c5391';   // git blob sha of an empty file

const ascii = (b, at, s) => [...s].every((c, i) => b[at + i] === c.charCodeAt(0));
/** Identify a file from its first bytes: { kind, mime } or null when it isn't a recognised media type. */
export function sniff(b) {
  if (b.length < 4) return null;
  if (b[0] === 0x89 && ascii(b, 1, 'PNG')) return { kind: 'image', mime: 'image/png' };
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { kind: 'image', mime: 'image/jpeg' };
  if (ascii(b, 0, 'GIF8')) return { kind: 'image', mime: 'image/gif' };
  if (ascii(b, 0, 'RIFF')) {
    if (ascii(b, 8, 'WEBP')) return { kind: 'image', mime: 'image/webp' };
    if (ascii(b, 8, 'WAVE')) return { kind: 'audio', mime: 'audio/wav' };
  }
  if (b[0] === 0 && b[1] === 0 && b[2] === 1 && b[3] === 0 && b[4] > 0) return { kind: 'image', mime: 'image/x-icon' };
  if (ascii(b, 0, 'BM') && b[6] === 0 && b[7] === 0 && b[8] === 0 && b[9] === 0) return { kind: 'image', mime: 'image/bmp' };
  if (ascii(b, 0, '%PDF')) return { kind: 'pdf', mime: 'application/pdf' };
  if (ascii(b, 4, 'ftyp')) {
    const brand = String.fromCharCode(...b.slice(8, 12));
    if (/^avi[fs]$/.test(brand)) return { kind: 'image', mime: 'image/avif' };
    if (/^(heic|heix|hevc|mif1|msf1)$/.test(brand)) return { kind: 'other', mime: 'image/heic' };
    if (brand === 'M4A ' || brand === 'M4B ') return { kind: 'audio', mime: 'audio/mp4' };
    return { kind: 'video', mime: brand === 'qt  ' ? 'video/quicktime' : 'video/mp4' };
  }
  if (b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) return { kind: 'video', mime: 'video/webm' };
  if (ascii(b, 0, 'OggS')) return { kind: 'audio', mime: 'audio/ogg' };
  if (ascii(b, 0, 'fLaC')) return { kind: 'audio', mime: 'audio/flac' };
  if (ascii(b, 0, 'ID3') || (b[0] === 0xff && (b[1] & 0xe0) === 0xe0)) return { kind: 'audio', mime: 'audio/mpeg' };
  const head = dec.decode(b.subarray(0, 1024)).replace(/^\uFEFF/, '').trimStart();
  if (/^(<\?xml[^>]*\?>\s*)?(<!--[\s\S]*?-->\s*)*(<!DOCTYPE svg[^>]*>\s*)?<svg[\s>]/i.test(head)) return { kind: 'image', mime: 'image/svg+xml' };
  return null;
}
/** True if the bytes look like UTF-8 text (no NULs, valid encoding). */
export function looksText(b) {
  if (b.includes(0)) return false;
  try { new TextDecoder('utf-8', { fatal: true }).decode(b, { stream: true }); return true; } catch { return false; }
}
