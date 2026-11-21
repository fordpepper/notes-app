// Previews for everything that isn't a picture: tables (csv/tsv), JSON, code, HTML, Word/Excel/PowerPoint/OpenDocument,
// zip archives and fonts. Loaded on demand, no libraries (zip files are read with the browser's built-in inflate).
import { h, fmtSize } from './dom.js';
import { icon } from './icons.js';
import * as U from './util.js';

const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/* ------------------------------------------------------------------ code highlighting */
const KEYWORDS = new Set(`if else elif for foreach while do return function fn func def class struct enum trait impl interface type extends implements import export from as default new try catch except finally throw throws raise switch case break continue async await yield lambda pass with in is not and or del global nonlocal assert const let var mut pub use mod crate where match loop static void public private protected package namespace using final abstract override virtual this self super typeof instanceof delete defer go chan select range
int long short float double char bool boolean string str byte u8 u16 u32 u64 i8 i16 i32 i64 usize isize f32 f64 true false null nil none undefined None True False
select from where join left right inner outer on group by order having insert into values update set create table alter drop index primary key foreign references limit offset union distinct and or not null like between exists begin end
echo fi then esac done elif export local readonly source`.split(/\s+/));
const KW_CI = new Set(['sql']);
const HASH = new Set('py sh bash zsh fish rb yml yaml toml ini conf cfg r pl ps1 env gitignore'.split(' '));
const DASH = new Set(['sql', 'lua']);
const MARKUP = new Set(['xml', 'html', 'htm', 'vue', 'svelte']);

/** Syntax-highlight `src` into safe HTML (generic tokenizer: comments, strings, numbers, keywords, tags, keys). */
const ALIAS = { javascript: 'js', typescript: 'ts', python: 'py', shell: 'sh', rust: 'rs', golang: 'go', ruby: 'rb', 'c++': 'cpp', csharp: 'java', markup: 'html', yml: 'yml', jsonc: 'json' };
export function highlight(src, ext = '') {
  ext = ALIAS[ext] || ext;
  if (src.length > 400_000) return esc(src);                       // too big to colour smoothly
  const parts = [];
  if (!HASH.has(ext) && !DASH.has(ext) || ext === 'sql') parts.push('\\/\\*[\\s\\S]*?\\*\\/');
  if (MARKUP.has(ext)) parts.push('<!--[\\s\\S]*?-->');
  if (ext === 'py') parts.push('"""[\\s\\S]*?"""', "'''[\\s\\S]*?'''");
  if (HASH.has(ext)) parts.push('#[^\\n]*'); else if (DASH.has(ext)) parts.push('--[^\\n]*'); else if (!MARKUP.has(ext)) parts.push('\\/\\/[^\\n]*');
  const nC = parts.length;
  parts.push('"(?:\\\\.|[^"\\\\\\n])*"', "'(?:\\\\.|[^'\\\\\\n])*'", '`(?:\\\\.|[^`\\\\])*`');      // strings
  const s0 = nC, s1 = parts.length;
  if (MARKUP.has(ext)) parts.push('<\\/?[A-Za-z][\\w:.-]*', '\\/?>');
  parts.push('\\b0x[0-9a-fA-F]+\\b|\\b\\d+(?:\\.\\d+)?(?:e[+-]?\\d+)?\\b', '[A-Za-z_$][\\w$]*');
  const nTag = MARKUP.has(ext) ? 2 : 0, nNum = s1 + nTag, nWord = nNum + 1;
  const re = new RegExp(parts.map(p => `(${p})`).join('|'), 'g');
  let out = '', last = 0, m;
  const ci = KW_CI.has(ext);
  while ((m = re.exec(src))) {
    out += esc(src.slice(last, m.index)); last = re.lastIndex;
    const t = m[0]; let cls = '';
    const g = m.findIndex((x, i) => i && x !== undefined) - 1;
    if (g < nC) cls = 'c';
    else if (g < s1) cls = 's';
    else if (g < nNum) cls = 't';
    else if (g === nNum) cls = 'n';
    else if (KEYWORDS.has(ci ? t.toLowerCase() : t)) cls = 'k';
    else if (src[last] === '(') cls = 'f';
    else if (/^[A-Z][A-Za-z0-9]+$/.test(t) && ext !== 'json') cls = 'y';
    out += cls ? `<span class="tk-${cls}">${esc(t)}</span>` : esc(t);
  }
  out += esc(src.slice(last));
  if (['yml', 'yaml', 'toml', 'ini', 'conf', 'cfg', 'env'].includes(ext)) out = out.replace(/^([ \t-]*)([\w.-]+)(?=\s*[:=])/gm, '$1<span class="tk-y">$2</span>');
  return out;
}

export function renderCode(box, src, ext) {
  const lines = src.split('\n').length;
  box.replaceChildren(h('div', { class: 'codeview' },
    h('pre', { class: 'gutter', 'aria-hidden': 'true' }, Array.from({ length: lines }, (_, i) => i + 1).join('\n')),
    h('pre', { class: 'code' }, h('code', {})),
  ));
  box.querySelector('code').innerHTML = highlight(src, ext);
}

/* ------------------------------------------------------------------ tables */
export function parseCsv(text, delim) {
  const rows = []; let row = [], f = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; }
    else if (c === '"' && f === '') q = true;
    else if (c === delim) { row.push(f); f = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(f); rows.push(row); row = []; f = ''; }
    else f += c;
  }
  if (f !== '' || row.length) { row.push(f); rows.push(row); }
  return rows;
}
const NUM = /^[-+]?[\d.,]+%?$/;
/** Render rows (array of arrays) as a scrollable table with a sticky header. */
export function tableOf(rows, { header = true } = {}) {
  const cols = Math.max(1, ...rows.map(r => r.length)), PAGE = 1000;
  const head = header ? rows[0] || [] : null, body = header ? rows.slice(1) : rows;
  const tb = h('tbody', {});
  let shown = 0;
  const more = h('button', { class: 'tonal', onclick: () => add() }, 'Show more rows');
  const add = () => {
    for (const r of body.slice(shown, shown + PAGE)) tb.append(h('tr', {}, h('th', { class: 'rn' }, ++shown), ...Array.from({ length: cols }, (_, i) => h('td', { class: NUM.test((r[i] || '').trim()) ? 'num' : '' }, r[i] ?? ''))));
    more.hidden = shown >= body.length;
  };
  add();
  return h('div', { class: 'tablewrap' },
    h('div', { class: 'tablemeta' }, `${body.length.toLocaleString()} row${body.length === 1 ? '' : 's'} · ${cols} column${cols === 1 ? '' : 's'}`),
    h('div', { class: 'tablescroll' }, h('table', { class: 'grid' }, head && h('thead', {}, h('tr', {}, h('th', { class: 'rn' }, ''), ...Array.from({ length: cols }, (_, i) => h('th', {}, head[i] ?? '')))), tb)),
    more);
}
export function renderTable(box, src, ext) {
  const first = src.split('\n', 1)[0], delim = ext === 'tsv' ? '\t' : [',', ';', '\t'].map(d => [d, first.split(d).length]).sort((a, b) => b[1] - a[1])[0][0];
  const rows = parseCsv(src, delim).filter(r => r.length > 1 || r[0] !== '');
  box.replaceChildren(rows.length ? tableOf(rows) : h('div', { class: 'filecard' }, 'This file is empty.'));
}

/* ------------------------------------------------------------------ JSON */
function jsonNode(key, v, depth) {
  const k = key === null ? null : h('span', { class: 'tk-y' }, typeof key === 'number' ? key : JSON.stringify(key));
  const kv = k && [k, ': '];
  if (v !== null && typeof v === 'object') {
    const arr = Array.isArray(v), ents = Object.entries(v);
    const [o, c] = arr ? ['[', ']'] : ['{', '}'];
    if (!ents.length) return h('div', { class: 'jl' }, kv, o + c);
    return h('details', { class: 'jd', open: depth < 2 },
      h('summary', {}, kv, o, h('span', { class: 'jm' }, ` ${ents.length} ${arr ? 'item' : 'key'}${ents.length === 1 ? '' : 's'} `), h('span', { class: 'jc' }, c)),
      h('div', { class: 'jb' }, ents.map(([a, b]) => jsonNode(arr ? +a : a, b, depth + 1)), h('div', { class: 'jl jend' }, c)));
  }
  const cls = typeof v === 'string' ? 's' : typeof v === 'number' ? 'n' : 'k';
  return h('div', { class: 'jl' }, kv, h('span', { class: 'tk-' + cls }, JSON.stringify(v)));
}
export function renderJson(box, src) {
  let data;
  try { data = JSON.parse(src.replace(/^﻿/, '')); }
  catch (e) { box.replaceChildren(h('div', { class: 'banner' }, icon('json'), 'Not valid JSON: ' + e.message), h('div', { class: 'codeview-wrap' })); renderCode(box.lastChild, src, 'json'); return; }
  if (src.length > 1_500_000) return renderCode(box, JSON.stringify(data, null, 2), 'json');
  box.replaceChildren(h('div', { class: 'jsonview' }, jsonNode(null, data, 0)));
}

/* ------------------------------------------------------------------ html */
export const renderHtml = (box, src, name) => box.replaceChildren(h('iframe', { class: 'htmlview', sandbox: '', srcdoc: src, title: name }));

/* ------------------------------------------------------------------ zip container */
export async function readZip(blob) {
  const tail = new Uint8Array(await blob.slice(Math.max(0, blob.size - 66000)).arrayBuffer()), t = new DataView(tail.buffer);
  let e = tail.length - 22;
  while (e >= 0 && t.getUint32(e, true) !== 0x06054b50) e--;
  if (e < 0) throw new Error('Not a zip file');
  const count = t.getUint16(e + 10, true), cdSize = t.getUint32(e + 12, true), cdOff = t.getUint32(e + 16, true);
  if (cdOff === 0xffffffff) throw new Error('Zip64 archives are too large to preview');
  const cd = new Uint8Array(await blob.slice(cdOff, cdOff + cdSize).arrayBuffer()), d = new DataView(cd.buffer);
  const entries = []; let p = 0;
  for (let i = 0; i < count && p + 46 <= cd.length && d.getUint32(p, true) === 0x02014b50; i++) {
    const nlen = d.getUint16(p + 28, true), elen = d.getUint16(p + 30, true), clen = d.getUint16(p + 32, true);
    entries.push({ name: new TextDecoder().decode(cd.subarray(p + 46, p + 46 + nlen)), method: d.getUint16(p + 10, true), csize: d.getUint32(p + 20, true), size: d.getUint32(p + 24, true), off: d.getUint32(p + 42, true) });
    p += 46 + nlen + elen + clen;
  }
  const byName = new Map(entries.map(x => [x.name, x]));
  const bytes = async x => {
    const lh = new DataView(await blob.slice(x.off, x.off + 30).arrayBuffer()), start = x.off + 30 + lh.getUint16(26, true) + lh.getUint16(28, true);
    const data = blob.slice(start, start + x.csize);
    if (x.method === 0) return new Uint8Array(await data.arrayBuffer());
    if (x.method !== 8) throw new Error('Unsupported compression');
    return new Uint8Array(await new Response(data.stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer());
  };
  return { entries, has: n => byName.has(n), bytes: n => bytes(byName.get(n)), text: async n => new TextDecoder().decode(await bytes(byName.get(n))), xml: async n => new DOMParser().parseFromString(await (async () => new TextDecoder().decode(await bytes(byName.get(n))))(), 'application/xml') };
}
const tags = (n, name) => [...n.getElementsByTagName(name)];
/** Parse an xlsx part. Tolerates producers that prefix every element (<x:row>) and huge sheets (keeps the first `maxRows` rows). */
async function looseXml(z, name, maxRows) {
  let t = await z.text(name), truncated = false;
  const m = /^(?:<\?xml[^>]*\?>\s*)?<(\w+):\w+[\s>]/.exec(t);
  if (m) t = t.replace(new RegExp('<(/?)' + m[1] + ':', 'g'), '<$1');
  if (maxRows) {
    const a = t.indexOf('<sheetData'), b = t.lastIndexOf('</sheetData>');
    if (a > 0 && b > a) {
      let pos = a, n = 0;
      while (n <= maxRows && (pos = t.indexOf('<row', pos + 1)) > 0 && pos < b) n++;
      if (n > maxRows && pos > 0 && pos < b) { t = t.slice(0, pos) + t.slice(b); truncated = true; }
    }
  }
  return { doc: new DOMParser().parseFromString(t, 'application/xml'), truncated };
}
const textOf = (n, name) => tags(n, name).map(x => x.textContent).join('');

/* ------------------------------------------------------------------ Excel / OpenDocument spreadsheet */
const colIndex = ref => { let n = 0; for (const ch of /^[A-Z]+/i.exec(ref)[0].toUpperCase()) n = n * 26 + ch.charCodeAt(0) - 64; return n - 1; };
const colName = i => { let s = ''; for (i++; i > 0; i = (i - 1) / 26 | 0) s = String.fromCharCode(65 + (i - 1) % 26) + s; return s; };
/* ------------------------------------------------------------------ archives */
async function renderArchive(box, z) {
  const rows = z.entries.slice(0, 2000).map(e => [e.name, e.name.endsWith('/') ? '' : fmtSize(e.size)]);
  box.replaceChildren(tableOf([['Name', 'Size'], ...rows]), z.entries.length > 2000 && h('p', { class: 'dim' }, `…and ${z.entries.length - 2000} more`));
}

/* ------------------------------------------------------------------ fonts */
let fontN = 0;
async function renderFont(box, blob, name) {
  const fam = 'preview-font-' + ++fontN, url = URL.createObjectURL(blob);
  const face = new FontFace(fam, `url(${url})`); await face.load(); document.fonts.add(face);
  const sample = h('div', { class: 'fs-edit', contenteditable: 'true', spellcheck: 'false', style: `font-family:${fam}` }, 'The quick brown fox jumps over the lazy dog');
  box.replaceChildren(h('div', { class: 'fontview' },
    h('h3', {}, name), sample,
    h('div', { class: 'fs-sets', style: `font-family:${fam}` }, [48, 32, 24, 16, 12].map(s => h('div', { style: `font-size:${s}px` }, 'Sphinx of black quartz, judge my vow 0123456789')),
      h('div', { style: 'font-size:28px;letter-spacing:.04em' }, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'), h('div', { style: 'font-size:28px;letter-spacing:.04em' }, 'abcdefghijklmnopqrstuvwxyz'))));
}

/** Text-based previews (the file's text is passed in). */
export function renderText(box, src, path, type) {
  const ext = U.extOf(path);
  if (type === 'table') return renderTable(box, src, ext);
  if (type === 'json') return renderJson(box, src);
  if (type === 'html') return renderHtml(box, src, U.basename(path));
  return renderCode(box, src, ext);
}
/** Binary previews: font | office | archive. Throws if the file can't be read (caller shows a download card). */
export async function renderBinary(box, kind, path, blob) {
  const ext = U.extOf(path);
  if (kind === 'font') return renderFont(box, blob, U.basename(path));
  if (kind === 'pdf') return renderPdf(box, blob);
  if (!U.ZIPPED.has(ext)) throw new Error('No preview for this format');
  const z = await readZip(blob);
  if (kind === 'archive') return renderArchive(box, z);
  const fam = { docm: 'docx', dotx: 'docx', dotm: 'docx', xlsm: 'xlsx', xltx: 'xlsx', xltm: 'xlsx', pptm: 'pptx', potx: 'pptx', ppsx: 'pptx', ppsm: 'pptx' }[ext] || ext;
  if (fam === 'docx') return renderDocx(box, blob);
  if (fam === 'xlsx') return renderXlsx(box, z);
  if (fam === 'pptx') return (await import('./pptx.js')).renderPptx(box, z);
  if (ext === 'odt') return (await import('./odf.js')).renderOdt(box, z);
  if (ext === 'ods') return (await import('./odf.js')).renderOds(box, z);
  if (ext === 'odp') return (await import('./odf.js')).renderOdp(box, z);
  return renderArchive(box, z);        // odp etc.: show what's inside
}

/* ------------------------------------------------------------------ PDF (pdf.js, loaded when you open one) */
let pdfjs;
async function loadPdfjs() {
  if (!pdfjs) {
    pdfjs = await import('../vendor/pdf.min.js');
    pdfjs.GlobalWorkerOptions.workerSrc = new URL('../vendor/pdf.worker.min.js', import.meta.url).href;
  }
  return pdfjs;
}
/** Pages are drawn exactly as in the file, fitted to the available width, and only when they scroll into view. */
export async function renderPdf(box, blob) {
  const P = await loadPdfjs();
  const base = new URL('../vendor/pdfjs/', import.meta.url).href;       // fonts, colour profiles and image decoders, fetched only when a file needs them
  const doc = await P.getDocument({ data: new Uint8Array(await blob.arrayBuffer()), standardFontDataUrl: base + 'standard_fonts/', cMapUrl: base + 'cmaps/', cMapPacked: true, wasmUrl: base + 'wasm/', iccUrl: base + 'iccs/', isEvalSupported: false }).promise;
  const wrap = h('div', { class: 'pdfdoc' });
  box.replaceChildren(h('div', { class: 'tablemeta' }, `${doc.numPages} page${doc.numPages === 1 ? '' : 's'}`), wrap);
  const sizes = await Promise.all(Array.from({ length: Math.min(doc.numPages, 80) }, (_, i) => doc.getPage(i + 1).then(pg => pg.getViewport({ scale: 1 }))));   // real page sizes up front: no layout jumps
  const first = sizes[0], holders = [];
  const cssWidth = () => Math.max(200, Math.min(wrap.clientWidth || 800, 1000));
  const draw = async el => {
    const n = +el.dataset.n, page = await doc.getPage(n), vp1 = page.getViewport({ scale: 1 }), k = cssWidth() / vp1.width;
    const vp = page.getViewport({ scale: k });
    let dpr = Math.min(devicePixelRatio || 1, 2.5);                  // keep huge or very tall pages inside what browsers can draw
    dpr = Math.min(dpr, Math.sqrt(12e6 / (vp.width * vp.height)), 8000 / Math.max(vp.width, vp.height));
    const hi = page.getViewport({ scale: k * dpr });
    if (!el.isConnected) return;
    el.style.width = vp.width + 'px'; el.style.height = vp.height + 'px';
    const cv = h('canvas', { width: Math.floor(hi.width), height: Math.floor(hi.height) });
    el.replaceChildren(cv);
    await page.render({ canvasContext: cv.getContext('2d'), canvas: cv, viewport: hi }).promise;
    const tl = h('div', { class: 'textLayer' }); tl.style.setProperty('--scale-factor', vp.scale); tl.style.setProperty('--total-scale-factor', vp.scale); el.append(tl);
    new P.TextLayer({ textContentSource: page.streamTextContent(), container: tl, viewport: vp }).render().catch(() => {});
  };
  const io = new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) { io.unobserve(e.target); draw(e.target).catch(console.warn); } }), { rootMargin: '900px 0px' });
  const layout = () => {
    const w = cssWidth();
    holders.forEach((el, i) => { const s = sizes[i] || first; io.unobserve(el); el.replaceChildren(); el.style.width = w + 'px'; el.style.height = Math.round(w * s.height / s.width) + 'px'; io.observe(el); });
  };
  for (let n = 1; n <= doc.numPages; n++) { const el = h('div', { class: 'pdfpage', 'data-n': n }); holders.push(el); wrap.append(el); }
  layout();
  let lastW = cssWidth(), t;
  new ResizeObserver(() => { clearTimeout(t); t = setTimeout(() => { if (!wrap.isConnected) return; const w = cssWidth(); if (Math.abs(w - lastW) > 8) { lastW = w; layout(); } }, 200); }).observe(wrap);
}

/* ------------------------------------------------------------------ Word (docx-preview: real page layout) */
function fit(holder, selector) {
  const apply = () => {
    const pages = [...holder.querySelectorAll(selector)];
    if (!pages.length || !holder.clientWidth) return;
    const w = Math.max(...pages.map(p => p.offsetWidth));
    holder.style.setProperty('--fit', Math.min(1, (holder.clientWidth - 2) / w));
  };
  new ResizeObserver(apply).observe(holder); apply();
}
async function renderDocx(box, blob) {
  const { renderAsync } = await import('../vendor/docx-preview.js');
  const holder = h('div', { class: 'docxview' });
  box.replaceChildren(holder);
  await renderAsync(blob, holder, holder, { className: 'docx', inWrapper: true, breakPages: true, ignoreLastRenderedPageBreak: true, renderHeaders: true, renderFooters: true, renderFootnotes: true, renderEndnotes: true, useBase64URL: true });
  // Word draws bullets with the Symbol / Wingdings fonts, which most devices don't have: swap in real characters.
  const BUL = { 0xF0B7: '•', 0xF0A7: '▪', 0xF0D8: '➢', 0xF0FC: '✓', 0xF076: '❖', 0xF0A8: '◻' };
  for (const st of holder.querySelectorAll('style')) st.textContent = st.textContent
    .replace(/content:\s*"([\uE000-\uF8FF])/g, (_, c) => `content:"${BUL[c.charCodeAt(0)] || '•'}`)
    .replace(/font-family:\s*"?(Symbol|Wingdings[^;"]*|Webdings)"?\s*;/gi, 'font-family:inherit;');
  await centerTables(holder, blob);
  fit(holder, '.docx-wrapper > section.docx');
}
/** Word centres (or right-aligns) tables relative to the text area, even when they are wider than it; the library always floats them left. */
async function centerTables(holder, blob) {
  try {
    const doc = await (await readZip(blob)).xml('word/document.xml');
    const defs = [...doc.getElementsByTagName('w:tbl')].map(t => {
      const pr = [...t.children].find(c => c.nodeName === 'w:tblPr'), q = pr && [...pr.children].find(c => c.nodeName === 'w:tblpPr');
      const jc = pr && [...pr.children].find(c => c.nodeName === 'w:jc')?.getAttribute('w:val');
      return { how: q?.getAttribute('w:tblpXSpec') || jc, anchor: q?.getAttribute('w:horzAnchor') || 'margin' };     // floating tables carry their position in tblpPr
    });
    const tables = [...holder.querySelectorAll('section.docx table')];
    if (tables.length !== defs.length) return;
    tables.forEach((t, i) => {
      const { how, anchor } = defs[i];
      if (!['center', 'right', 'end'].includes(how)) return;
      const sec = t.closest('section'), onPage = anchor === 'page' && sec;
      const avail = onPage ? sec.clientWidth : t.parentElement.clientWidth, w = t.offsetWidth;
      if (!avail || !w) return;
      const pad = onPage ? parseFloat(getComputedStyle(sec).paddingLeft) || 0 : 0;
      t.style.float = 'none'; t.style.marginLeft = ((how === 'center' ? (avail - w) / 2 : avail - w) - pad) + 'px';
    });
  } catch (e) { console.warn(e); }
}

/* ------------------------------------------------------------------ Excel (cell styles, widths, merges, number formats) */
const BUILTIN_FMT = { 1: '0', 2: '0.00', 3: '#,##0', 4: '#,##0.00', 9: '0%', 10: '0.00%', 14: 'yyyy-mm-dd', 15: 'd-mmm-yy', 16: 'd-mmm', 17: 'mmm-yy', 22: 'yyyy-mm-dd hh:mm', 45: 'mm:ss', 46: '[h]:mm:ss', 47: 'mm:ss.0' };
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
function formatCell(v, code, date1904) {
  if (v === '' || v == null) return '';
  if (!code || /^general$/i.test(code)) { const n = +v; return v !== '' && !isNaN(n) && /^-?[\d.]+(e[+-]?\d+)?$/i.test(v) ? String(+n.toPrecision(12)) : v; }
  let n = +v;
  if (isNaN(n)) return v;
  if (date1904) n += 1462;
  const clean = code.split(';')[n < 0 && code.includes(';') ? 1 : 0].replace(/"([^"]*)"/g, '$1').replace(/\[\$([^\]-]*)[^\]]*\]/g, '$1').replace(/\[[^\]]*\]/g, m => /^\[(h+|m+|s+)\]$/i.test(m) ? m : '').replace(/_.|\\./g, '').replace(/\*./g, '');
  if (/[dmyhs]/i.test(clean.replace(/[#0.,%]/g, '')) && /y|d|h|s|m/i.test(clean) && !/^[#0,.%$€£\s-]+$/.test(clean)) {   // date / time
    const dt = new Date(Math.round((n - 25569) * 86400000)), p = x => String(x).padStart(2, '0');
    if (isNaN(dt)) return v;
    const Y = dt.getUTCFullYear(), M = dt.getUTCMonth(), D = dt.getUTCDate(), hh = dt.getUTCHours(), mi = dt.getUTCMinutes(), ss = dt.getUTCSeconds(), ampm = /am\/pm/i.test(clean);
    return clean.replace(/am\/pm/ig, hh < 12 ? 'AM' : 'PM').replace(/yyyy|yy|mmmm|mmm|mm|m|dddd|ddd|dd|d|hh|h|ss|s/gi, t => {
      switch (t.toLowerCase()) {
        case 'yyyy': return Y; case 'yy': return p(Y % 100); case 'mmmm': return MONTHS[M]; case 'mmm': return MONTHS[M].slice(0, 3);
        case 'mm': return /h|s/i.test(clean) && !/[dy]/i.test(clean) ? p(mi) : p(M + 1); case 'm': return M + 1; case 'dd': return p(D); case 'd': return D;
        case 'hh': return p(ampm ? (hh % 12) || 12 : hh); case 'h': return ampm ? (hh % 12) || 12 : hh; case 'ss': return p(ss); case 's': return ss; default: return t;
      }
    });
  }
  const pct = clean.includes('%'), dec = (/\.(0+)/.exec(clean)?.[1].length) ?? ((/\.(#+)/.exec(clean)?.[1].length) ? 0 : 0), thou = /#,#|0,0/.test(clean);
  let x = pct ? n * 100 : n; const neg = x < 0 && !code.includes(';'); x = Math.abs(x);
  let s = x.toFixed(dec); if (thou) s = s.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const pre = /^([^#0.,]*)/.exec(clean)[1].replace(/%/g, ''), suf = /([^#0.,%]*)%?$/.exec(clean)[1];
  return (neg ? '-' : '') + pre + s + (pct ? '%' : '') + suf.replace(/%/g, '');
}
function themeColors(x) {
  const names = ['lt1', 'dk1', 'lt2', 'dk2', 'accent1', 'accent2', 'accent3', 'accent4', 'accent5', 'accent6'], out = [];
  const scheme = x?.getElementsByTagName('a:clrScheme')[0];
  for (const n of names) { const e = scheme?.getElementsByTagName('a:' + n)[0]?.firstElementChild; out.push(e ? '#' + (e.getAttribute('lastClr') || e.getAttribute('val')) : { lt1: '#ffffff', dk1: '#000000' }[n] || '#808080'); }
  return out;
}
const INDEXED = ['#000000', '#ffffff', '#ff0000', '#00ff00', '#0000ff', '#ffff00', '#ff00ff', '#00ffff'];
function tint(hex, t) {
  const c = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
  return '#' + c.map(v => Math.round(t < 0 ? v * (1 + t) : v + (255 - v) * t).toString(16).padStart(2, '0')).join('');
}
async function renderXlsx(box, z) {
  const theme = themeColors(z.has('xl/theme/theme1.xml') ? await z.xml('xl/theme/theme1.xml') : null);
  const lx = async n => (await looseXml(z, n)).doc;
  const color = e => {
    if (!e) return null;
    if (e.getAttribute('rgb')) return '#' + e.getAttribute('rgb').slice(-6);
    if (e.getAttribute('theme') != null) { const c = theme[+e.getAttribute('theme')] || '#000000'; return +e.getAttribute('tint') ? tint(c, +e.getAttribute('tint')) : c; }
    if (e.getAttribute('indexed') != null) return INDEXED[+e.getAttribute('indexed')] || null;
    return null;
  };
  const st = { fonts: [], fills: [], borders: [], xfs: [], fmts: new Map() };
  if (z.has('xl/styles.xml')) {
    const s = await lx('xl/styles.xml');
    for (const n of tags(s, 'numFmt')) st.fmts.set(+n.getAttribute('numFmtId'), n.getAttribute('formatCode'));
    const kids = (tag, child) => tags(s, tag)[0] ? [...tags(s, tag)[0].children].filter(c => c.nodeName === child) : [];
    st.fonts = kids('fonts', 'font').map(f => ({ b: !!f.getElementsByTagName('b')[0], i: !!f.getElementsByTagName('i')[0], u: !!f.getElementsByTagName('u')[0], sz: +f.getElementsByTagName('sz')[0]?.getAttribute('val') || 11, name: f.getElementsByTagName('name')[0]?.getAttribute('val'), color: color(f.getElementsByTagName('color')[0]) }));
    st.fills = kids('fills', 'fill').map(f => { const p = f.getElementsByTagName('patternFill')[0]; return p && p.getAttribute('patternType') === 'solid' ? color(p.getElementsByTagName('fgColor')[0]) : null; });
    st.borders = kids('borders', 'border').map(b => Object.fromEntries(['left', 'right', 'top', 'bottom'].map(side => { const e = b.getElementsByTagName(side)[0], sty = e?.getAttribute('style'); return [side, sty ? { sty, color: color(e.getElementsByTagName('color')[0]) || '#000000' } : null]; })));
    st.xfs = [...(tags(s, 'cellXfs')[0]?.children || [])].map(x => { const al = x.getElementsByTagName('alignment')[0]; return { fmt: +x.getAttribute('numFmtId') || 0, font: +x.getAttribute('fontId') || 0, fill: +x.getAttribute('fillId') || 0, border: +x.getAttribute('borderId') || 0, h: al?.getAttribute('horizontal'), v: al?.getAttribute('vertical'), wrap: al?.getAttribute('wrapText') === '1', indent: +al?.getAttribute('indent') || 0, rot: +al?.getAttribute('textRotation') || 0 }; });
  }
  const base = st.fonts[0] || { sz: 11, name: 'Calibri' };
  const shared = z.has('xl/sharedStrings.xml') ? tags(await lx('xl/sharedStrings.xml'), 'si').map(si => [...si.getElementsByTagName('t')].filter(t => t.parentNode.nodeName !== 'rPh').map(t => t.textContent).join('')) : [];
  const wb = await lx('xl/workbook.xml'), rels = new Map(), date1904 = wb.getElementsByTagName('workbookPr')[0]?.getAttribute('date1904') === '1';
  for (const r of tags(await lx('xl/_rels/workbook.xml.rels'), 'Relationship')) rels.set(r.getAttribute('Id'), r.getAttribute('Target'));
  const sheets = tags(wb, 'sheet').map((s, i) => { let t = rels.get(s.getAttribute('r:id')) || `worksheets/sheet${i + 1}.xml`; t = t.replace(/^\/?(xl\/)?/, 'xl/'); return { name: s.getAttribute('name'), path: t, hidden: s.getAttribute('state') === 'hidden' }; }).filter(s => !s.hidden && !s.path.includes('chartsheets') && z.has(s.path));
  const BORDER_W = { thin: 1, hair: 1, medium: 2, thick: 3, double: 3, dashed: 1, dotted: 1 };
  const side = b => b ? `${BORDER_W[b.sty] || 1}px ${b.sty === 'dashed' ? 'dashed' : b.sty === 'dotted' ? 'dotted' : b.sty === 'double' ? 'double' : 'solid'} ${b.color}` : '';

  const build = async sh => {
    const MAXR = 3000, MAXC = 80, { doc: x, truncated } = await looseXml(z, sh.path, MAXR);
    const cols = new Map(), merges = [], cover = new Set(), cells = [], heights = new Map();
    for (const c of tags(x, 'col')) for (let i = +c.getAttribute('min'); i <= Math.min(+c.getAttribute('max'), MAXC); i++) cols.set(i - 1, { w: +c.getAttribute('width') || 8.43, hide: c.getAttribute('hidden') === '1' });
    const fmtPr = x.getElementsByTagName('sheetFormatPr')[0], defW = +fmtPr?.getAttribute('defaultColWidth') || 8.43, defH = +fmtPr?.getAttribute('defaultRowHeight') || 15;
    let maxR = 0, maxC = 0;
    for (const m of tags(x, 'mergeCell')) { const [a, b] = m.getAttribute('ref').split(':'); if (!b) continue; const r1 = +/\d+/.exec(a) - 1, c1 = colIndex(a), r2 = +/\d+/.exec(b) - 1, c2 = colIndex(b); merges.push({ r1, c1, r2, c2 }); for (let r = r1; r <= r2; r++) for (let c = c1; c <= c2; c++) if (r !== r1 || c !== c1) cover.add(r + ',' + c); maxR = Math.max(maxR, r2); maxC = Math.max(maxC, c2); }
    for (const r of tags(x, 'row')) {
      const ri = +r.getAttribute('r') - 1; if (ri >= MAXR) break;
      if (r.getAttribute('ht')) heights.set(ri, +r.getAttribute('ht'));
      if (r.getAttribute('hidden') === '1') heights.set(ri, 0);
      for (const c of tags(r, 'c')) {
        const ci = colIndex(c.getAttribute('r')); if (ci >= MAXC) continue;
        const t = c.getAttribute('t'), vEl = c.getElementsByTagName('v')[0], v = vEl?.textContent ?? '';
        const val = t === 's' ? shared[+v] ?? '' : t === 'inlineStr' ? textOf(c, 't') : t === 'b' ? (v === '1' ? 'TRUE' : 'FALSE') : t === 'e' ? v : v;
        cells[ri] ||= []; cells[ri][ci] = { val, t, s: +c.getAttribute('s') || 0 };
        if (val !== '' || +c.getAttribute('s')) { maxR = Math.max(maxR, ri); maxC = Math.max(maxC, ci); }
      }
    }
    const widthPx = c => Math.round(((cols.get(c)?.w ?? defW) * 7) + 5);
    const tb = h('tbody', {});
    const head = h('tr', {}, h('th', { class: 'corner' }), ...Array.from({ length: maxC + 1 }, (_, c) => cols.get(c)?.hide ? null : h('th', { class: 'colh' }, colName(c))));
    for (let r = 0; r <= maxR; r++) {
      const ht = heights.get(r); if (ht === 0) continue;
      const tr = h('tr', { style: `height:${Math.round((ht || defH) * 4 / 3)}px` }, h('th', { class: 'rowh' }, r + 1));
      for (let c = 0; c <= maxC; c++) {
        if (cols.get(c)?.hide || cover.has(r + ',' + c)) continue;
        const cell = cells[r]?.[c], xf = st.xfs[cell?.s || 0] || {}, f = st.fonts[xf.font] || base, fill = st.fills[xf.fill], bd = st.borders[xf.border] || {};
        const m = merges.find(q => q.r1 === r && q.c1 === c);
        let text = cell ? (cell.t === 's' || cell.t === 'inlineStr' || cell.t === 'str' || cell.t === 'e' ? cell.val : formatCell(cell.val, st.fmts.get(xf.fmt) || BUILTIN_FMT[xf.fmt], date1904)) : '';
        const numeric = cell && !['s', 'inlineStr', 'str', 'e', 'b'].includes(cell.t) && cell.val !== '' && !isNaN(+cell.val);
        const align = xf.h && xf.h !== 'general' ? xf.h : numeric ? 'right' : cell?.t === 'b' || cell?.t === 'e' ? 'center' : 'left';
        const css = [`text-align:${align === 'centerContinuous' ? 'center' : align}`, `vertical-align:${xf.v === 'top' ? 'top' : xf.v === 'center' ? 'middle' : 'bottom'}`];
        if (fill) css.push(`background:${fill}`);
        if (f.color) css.push(`color:${f.color}`);
        if (f.b) css.push('font-weight:700'); if (f.i) css.push('font-style:italic'); if (f.u) css.push('text-decoration:underline');
        if (f.sz && f.sz !== base.sz) css.push(`font-size:${f.sz * 4 / 3}px`);
        if (f.name && f.name !== base.name) css.push(`font-family:"${f.name}",sans-serif`);
        for (const sd of ['left', 'right', 'top', 'bottom']) if (bd[sd]) css.push(`border-${sd}:${side(bd[sd])}`);
        if (xf.indent) css.push(`padding-left:${4 + xf.indent * 9}px`);
        let content = text;
        const rowPx = Math.round(((ht || defH) * 4 / 3));
        if (xf.rot && text !== '') {                                // rotated text (e.g. vertical column headings)
          const stacked = xf.rot === 255, up = xf.rot > 0 && xf.rot <= 90;
          content = h('div', { class: 'xrot', style: `writing-mode:vertical-rl;${stacked ? 'text-orientation:upright;' : ''}${up ? 'transform:rotate(180deg);' : ''}max-height:${m ? 9999 : rowPx}px;margin:auto` }, text);
          css.push('text-align:center', 'padding:0');
        } else if (xf.wrap && text !== '') {                        // wrapped text keeps the row height, like Excel
          css.push('white-space:normal;overflow-wrap:break-word');
          content = h('div', { class: 'xwrap', style: `max-height:${m ? Math.max(rowPx, (m.r2 - m.r1 + 1) * rowPx) : rowPx}px` }, text);
        }
        tr.append(h('td', { style: css.join(';'), colspan: m ? m.c2 - m.c1 + 1 : null, rowspan: m ? m.r2 - m.r1 + 1 : null }, content));
      }
      tb.append(tr);
    }
    const colgroup = h('colgroup', {}, h('col', { style: 'width:46px' }), ...Array.from({ length: maxC + 1 }, (_, c) => cols.get(c)?.hide ? null : h('col', { style: `width:${widthPx(c)}px` })));
    return h('div', {}, truncated && h('div', { class: 'tablemeta' }, `Showing the first ${MAXR.toLocaleString()} rows`), h('div', { class: 'xlscroll' }, h('table', { class: 'xl', style: `font-size:${base.sz * 4 / 3}px;font-family:"${base.name || 'Calibri'}",Carlito,Arial,sans-serif` }, colgroup, h('thead', {}, head), tb)));
  };
  const view = h('div', {}), tabs = h('div', { class: 'seg tabs' });
  const show = async i => {
    [...tabs.children].forEach((b, j) => b.classList.toggle('on', i === j));
    view.replaceChildren(h('div', { class: 'filecard' }, 'Loading…'));
    view.replaceChildren(await build(sheets[i]));
  };
  sheets.forEach((s, i) => tabs.append(h('button', { onclick: () => show(i) }, s.name)));
  box.replaceChildren(sheets.length > 1 && tabs, view); await show(0);
}
