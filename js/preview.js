// Markdown preview. marked + DOMPurify (~45 KB gzipped) are only downloaded when a .md file is previewed.
import * as M from './model.js';
import * as U from './util.js';

let libs;
const loadLibs = () => libs ??= Promise.all([import('../vendor/marked.js'), import('../vendor/purify.js')])
  .then(([m, p]) => ({ marked: m.marked, DOMPurify: p.default }));

const urlCache = new Map();
/** Object URL for a stored file (cached per content version). */
export async function blobUrl(path) {
  const r = M.files.get(path);
  if (!r || r.deleted) throw new Error('File not found');
  const key = path + ':' + r.sha;
  if (!urlCache.has(key)) urlCache.set(key, URL.createObjectURL(await M.getBlob(path)));
  return urlCache.get(key);
}

export function resolvePath(base, rel) {
  rel = rel.split(/[?#]/)[0];
  try { rel = decodeURIComponent(rel); } catch { /* keep raw */ }
  const parts = rel.startsWith('/') ? [] : base.split('/').filter(Boolean);
  for (const s of rel.split('/')) { if (s === '..') parts.pop(); else if (s && s !== '.') parts.push(s); }
  return parts.join('/');
}
const isExternal = u => /^([a-z][a-z0-9+.-]*:|\/\/)/i.test(u);

export function findNote(name) {
  const n = name.trim().toLowerCase();
  return M.livePaths().find(p => U.isNote(p) && !U.isHidden(p) && (p.toLowerCase() === n || p.toLowerCase() === n + '.md' || p.toLowerCase() === n + '.txt' || U.stem(p).toLowerCase() === n));
}

let seq = 0;
/** Render markdown `src` (belonging to note `path`) into `box`. */
export async function render(box, src, path) {
  const id = ++seq;
  const { marked, DOMPurify } = await loadLibs();
  if (id !== seq) return;                                  // a newer render superseded this one
  const text = src.replace(/\[\[([^\]\n|]+)(?:\|([^\]\n]+))?\]\]/g, (_, n, a) => `[${a || n}](#wiki/${encodeURIComponent(n.trim())})`);
  box.innerHTML = DOMPurify.sanitize(marked.parse(text, { gfm: true, breaks: true }));
  const base = U.dirname(path);
  for (const a of box.querySelectorAll('a[href]')) {
    const href = a.getAttribute('href');
    if (href.startsWith('#wiki/')) { const name = decodeURIComponent(href.slice(6)); a.classList.add('wiki'); a.dataset.wiki = name; if (!findNote(name)) a.classList.add('missing'); }
    else if (isExternal(href)) { a.target = '_blank'; a.rel = 'noopener noreferrer'; }
    else if (!href.startsWith('#')) { const p = resolvePath(base, href); if (M.exists(p)) a.dataset.local = p; }
  }
  for (const el of box.querySelectorAll('img[src], video[src], audio[src]')) {
    const s = el.getAttribute('src');
    if (isExternal(s)) continue;
    const p = resolvePath(base, s);
    if (M.exists(p)) { el.removeAttribute('src'); blobUrl(p).then(u => { el.src = u; }).catch(() => { el.alt = 'Could not load ' + p; }); }
  }
  box.querySelectorAll('input[type=checkbox]').forEach((c, i) => { c.disabled = false; c.dataset.i = i; });
}

/** Position of the `index`-th task checkbox marker in `src` (the character inside [ ]), or -1. */
export function taskMarkerPos(src, index) {
  const re = /^([\s>]*(?:[-*+]|\d+[.)])\s+\[)([ xX])(\])/;
  let pos = 0, idx = -1, fence = false;
  for (const line of src.split('\n')) {
    if (/^\s*(```|~~~)/.test(line)) fence = !fence;
    else if (!fence) { const m = line.match(re); if (m && ++idx === index) return pos + m[1].length; }
    pos += line.length + 1;
  }
  return -1;
}
