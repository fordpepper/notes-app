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
const textOf = (n, name) => tags(n, name).map(x => x.textContent).join('');

/* ------------------------------------------------------------------ Word / OpenDocument text */
async function renderDocx(box, z) {
  const doc = await z.xml('word/document.xml'), rels = new Map();
  if (z.has('word/_rels/document.xml.rels')) for (const r of tags(await z.xml('word/_rels/document.xml.rels'), 'Relationship')) rels.set(r.getAttribute('Id'), r.getAttribute('Target'));
  const urls = [];
  const run = r => {
    let out = [];
    for (const c of r.children) {
      if (c.nodeName === 'w:t') out.push(c.textContent);
      else if (c.nodeName === 'w:tab') out.push('\t');
      else if (c.nodeName === 'w:br') out.push(h('br'));
      else if (c.nodeName === 'w:drawing') for (const b of tags(c, 'a:blip')) { const t = rels.get(b.getAttribute('r:embed')), img = h('img', { alt: '' }); if (t && z.has('word/' + t)) z.bytes('word/' + t).then(by => { const u = URL.createObjectURL(new Blob([by], { type: U.mimeOf(t) })); urls.push(u); img.src = u; }); out.push(img); }
    }
    const pr = r.getElementsByTagName('w:rPr')[0], on = n => { const e = pr?.getElementsByTagName(n)[0]; return e && e.getAttribute('w:val') !== '0' && e.getAttribute('w:val') !== 'false'; };
    if (on('w:b')) out = [h('b', {}, out)]; if (on('w:i')) out = [h('i', {}, out)]; if (on('w:u')) out = [h('u', {}, out)];
    return out;
  };
  const para = p => {
    const style = p.getElementsByTagName('w:pStyle')[0]?.getAttribute('w:val') || '', hm = /^Heading(\d)$/i.exec(style) || (/^Title$/i.test(style) ? [0, 1] : null);
    const kids = [...p.getElementsByTagName('w:r')].flatMap(run);
    const li = p.getElementsByTagName('w:numPr')[0];
    if (!kids.length && !hm) return h('p', { class: 'gap' });
    return h(hm ? 'h' + Math.min(4, +hm[1]) : 'p', { class: li ? 'li' : '' }, li && '•  ', kids);
  };
  const body = doc.getElementsByTagName('w:body')[0], out = [];
  for (const n of body ? body.children : []) {
    if (n.nodeName === 'w:p') out.push(para(n));
    else if (n.nodeName === 'w:tbl') out.push(h('table', { class: 'docx-table' }, h('tbody', {}, [...n.children].filter(x => x.nodeName === 'w:tr').map(tr => h('tr', {}, [...tr.children].filter(x => x.nodeName === 'w:tc').map(tc => h('td', {}, tags(tc, 'w:p').map(para))))))));
  }
  box.replaceChildren(h('article', { class: 'md docpage' }, out.length ? out : h('p', {}, 'This document is empty.')));
}
async function renderOdt(box, z) {
  const doc = await z.xml('content.xml'), out = [];
  const walk = n => { for (const c of n.children) {
    if (c.nodeName === 'text:h') out.push(h('h' + Math.min(4, +c.getAttribute('text:outline-level') || 1), {}, c.textContent));
    else if (c.nodeName === 'text:p') out.push(h('p', {}, c.textContent));
    else walk(c);
  } };
  walk(doc.getElementsByTagName('office:text')[0] || doc.documentElement);
  box.replaceChildren(h('article', { class: 'md docpage' }, out.length ? out : h('p', {}, 'This document is empty.')));
}

/* ------------------------------------------------------------------ Excel / OpenDocument spreadsheet */
const colIndex = ref => { let n = 0; for (const ch of /^[A-Z]+/i.exec(ref)[0].toUpperCase()) n = n * 26 + ch.charCodeAt(0) - 64; return n - 1; };
async function renderXlsx(box, z) {
  const shared = z.has('xl/sharedStrings.xml') ? tags(await z.xml('xl/sharedStrings.xml'), 'si').map(si => textOf(si, 't')) : [];
  const wb = await z.xml('xl/workbook.xml'), rels = new Map();
  for (const r of tags(await z.xml('xl/_rels/workbook.xml.rels'), 'Relationship')) rels.set(r.getAttribute('Id'), r.getAttribute('Target'));
  const sheets = tags(wb, 'sheet').map((s, i) => { let t = rels.get(s.getAttribute('r:id')) || `worksheets/sheet${i + 1}.xml`; t = t.replace(/^\/?(xl\/)?/, 'xl/'); return { name: s.getAttribute('name'), path: t }; });
  const load = async s => {
    const x = await z.xml(s.path), rows = [];
    for (const r of tags(x, 'row')) {
      const ri = +r.getAttribute('r') - 1, row = rows[ri] = [];
      for (const c of tags(r, 'c')) {
        const t = c.getAttribute('t'), v = c.getElementsByTagName('v')[0]?.textContent ?? '';
        row[colIndex(c.getAttribute('r'))] = t === 's' ? shared[+v] ?? '' : t === 'inlineStr' ? textOf(c, 't') : t === 'b' ? (v === '1' ? 'TRUE' : 'FALSE') : v;
      }
      if (rows.length > 20000) break;
    }
    return Array.from(rows, r => r || []);
  };
  const view = h('div', {}), tabs = h('div', { class: 'seg tabs' });
  const show = async i => {
    [...tabs.children].forEach((b, j) => b.classList.toggle('on', i === j));
    view.replaceChildren(h('div', { class: 'filecard' }, 'Loading…'));
    const rows = await load(sheets[i]);
    view.replaceChildren(rows.length ? tableOf(rows, { header: false }) : h('div', { class: 'filecard' }, 'This sheet is empty.'));
  };
  sheets.forEach((s, i) => tabs.append(h('button', { onclick: () => show(i) }, s.name)));
  box.replaceChildren(sheets.length > 1 && tabs, view); await show(0);
}
async function renderOds(box, z) {
  const doc = await z.xml('content.xml'), tbls = tags(doc, 'table:table');
  const grid = t => tags(t, 'table:table-row').slice(0, 5000).flatMap(r => { const row = []; for (const c of [...r.children].filter(c => c.nodeName === 'table:table-cell' || c.nodeName === 'table:covered-table-cell')) { const rep = Math.min(+c.getAttribute('table:number-columns-repeated') || 1, 50); for (let i = 0; i < rep; i++) row.push(c.textContent); } while (row.length && row[row.length - 1] === '') row.pop(); return [row]; });
  const rows = grid(tbls[0] || doc.documentElement);
  box.replaceChildren(tableOf(rows, { header: false }));
}

/* ------------------------------------------------------------------ PowerPoint */
async function renderPptx(box, z) {
  const slides = z.entries.map(e => /^ppt\/slides\/slide(\d+)\.xml$/.exec(e.name)).filter(Boolean).sort((a, b) => a[1] - b[1]);
  const cards = [];
  for (const [name, n] of slides) {
    const x = await z.xml(name), lines = tags(x, 'a:p').map(p => textOf(p, 'a:t').trim()).filter(Boolean);
    cards.push(h('section', { class: 'slide' }, h('small', {}, `Slide ${n}`), lines.length ? [h('h3', {}, lines[0]), ...lines.slice(1).map(l => h('p', {}, l))] : h('p', { class: 'dim' }, 'No text on this slide')));
  }
  box.replaceChildren(h('div', { class: 'slides' }, cards.length ? cards : h('div', { class: 'filecard' }, 'No slides found.')));
}

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
  if (!U.ZIPPED.has(ext)) throw new Error('No preview for this format');
  const z = await readZip(blob);
  if (kind === 'archive') return renderArchive(box, z);
  if (ext === 'docx') return renderDocx(box, z);
  if (ext === 'xlsx') return renderXlsx(box, z);
  if (ext === 'pptx') return renderPptx(box, z);
  if (ext === 'odt') return renderOdt(box, z);
  if (ext === 'ods') return renderOds(box, z);
  return renderArchive(box, z);        // odp etc.: show what's inside
}
