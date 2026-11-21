// OpenDocument viewers: text (.odt), spreadsheets (.ods) and presentations (.odp), drawn with their own styles.
import { h } from './dom.js';

const kids = (el, ...n) => el ? [...el.children].filter(c => n.includes(c.nodeName)) : [];
const kid = (el, n) => { if (!el) return null; for (const c of el.children) if (c.nodeName === n) return c; return null; };
const all = (doc, n) => [...doc.getElementsByTagName(n)];
const MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', svg: 'image/svg+xml', webp: 'image/webp', bmp: 'image/bmp' };

/** "2.5cm" / "12pt" / "0.5in" / "10px" -> CSS px (96 dpi). Percentages and unknown values give null. */
function len(v) {
  const m = /^(-?[\d.]+)\s*(cm|mm|in|pt|px|pc)?$/.exec((v || '').trim());
  if (!m) return null;
  const n = +m[1], u = m[2] || 'px';
  return n * { cm: 37.7953, mm: 3.77953, in: 96, pt: 4 / 3, px: 1, pc: 16 }[u];
}
const px = v => { const n = len(v); return n == null ? null : Math.round(n * 100) / 100; };

/* ------------------------------------------------------------------ styles */
const PROP_KINDS = { 'style:text-properties': 'text', 'style:paragraph-properties': 'para', 'style:table-cell-properties': 'cell', 'style:table-column-properties': 'col', 'style:table-row-properties': 'row', 'style:graphic-properties': 'gfx', 'style:drawing-page-properties': 'page', 'style:table-properties': 'table', 'style:page-layout-properties': 'layout' };
function collect(docs) {
  const S = { styles: new Map(), fonts: new Map(), layouts: new Map(), masters: new Map(), lists: new Map(), images: new Map(), gradients: new Map(), docs };
  for (const doc of docs) {
    for (const f of all(doc, 'style:font-face')) S.fonts.set(f.getAttribute('style:name'), f.getAttribute('svg:font-family') || f.getAttribute('style:name'));
    for (const st of [...all(doc, 'style:style'), ...all(doc, 'style:default-style')]) {
      const fam = st.getAttribute('style:family'), name = st.getAttribute('style:name') || '', key = `${fam}:${name}`, props = {};
      for (const c of st.children) { const k = PROP_KINDS[c.nodeName]; if (k) { props[k] ||= {}; for (const a of c.attributes) props[k][a.name] = a.value; } }
      S.styles.set(key, { parent: st.getAttribute('style:parent-style-name'), family: fam, props, defaultCell: st.getAttribute('style:default-cell-style-name'), list: st.getAttribute('style:list-style-name'), name: st.getAttribute('style:name') });
    }
    for (const pl of all(doc, 'style:page-layout')) { const p = kid(pl, 'style:page-layout-properties'); if (p) S.layouts.set(pl.getAttribute('style:name'), Object.fromEntries([...p.attributes].map(a => [a.name, a.value]))); }
    for (const mp of all(doc, 'style:master-page')) S.masters.set(mp.getAttribute('style:name'), mp);
    for (const ls of all(doc, 'text:list-style')) S.lists.set(ls.getAttribute('style:name'), ls);
    for (const im of all(doc, 'draw:fill-image')) S.images.set(im.getAttribute('draw:name'), im.getAttribute('xlink:href'));
    for (const g of all(doc, 'draw:gradient')) S.gradients.set(g.getAttribute('draw:name'), g);
  }
  return S;
}
/** Merged properties of a named style (parents first; a family default underneath). */
function resolve(S, fam, name) {
  const out = {};
  const merge = st => { if (!st) return; if (st.parent) merge(S.styles.get(`${fam}:${st.parent}`)); for (const k in st.props) out[k] = { ...(out[k] || {}), ...st.props[k] }; };
  merge(S.styles.get(`${fam}:`));
  if (name) merge(S.styles.get(`${fam}:${name}`));
  return out;
}
const rgb = v => v && v !== 'transparent' ? v : null;
function textCss(t, S) {
  if (!t) return '';
  const c = [];
  if (t['fo:font-weight'] === 'bold' || +t['fo:font-weight'] >= 600) c.push('font-weight:700');
  if (t['fo:font-style'] === 'italic') c.push('font-style:italic');
  const dec = [];
  if (t['style:text-underline-style'] && t['style:text-underline-style'] !== 'none') dec.push('underline');
  if (t['style:text-line-through-style'] && t['style:text-line-through-style'] !== 'none') dec.push('line-through');
  if (dec.length) c.push(`text-decoration:${dec.join(' ')}`);
  if (rgb(t['fo:color'])) c.push(`color:${t['fo:color']}`);
  if (rgb(t['fo:background-color'])) c.push(`background:${t['fo:background-color']}`);
  const fs = t['fo:font-size'];
  if (fs) c.push(fs.endsWith('%') ? `font-size:${parseFloat(fs)}%` : `font-size:${px(fs)}px`);
  const fam = S.fonts.get(t['style:font-name'] || '') || t['fo:font-family'];
  if (fam) c.push(`font-family:${/[\s,]/.test(fam) && !fam.includes('"') && !fam.includes("'") ? `"${fam.replace(/'/g, '')}"` : fam.replace(/'/g, '"')},sans-serif`);
  if (t['fo:text-transform'] === 'uppercase') c.push('text-transform:uppercase');
  if (t['fo:font-variant'] === 'small-caps') c.push('font-variant:small-caps');
  if (t['style:text-position']) { const p = parseFloat(t['style:text-position']); if (p) c.push(`vertical-align:${p > 0 ? 'super' : 'sub'};font-size:.75em`); }
  if (t['fo:letter-spacing'] && px(t['fo:letter-spacing'])) c.push(`letter-spacing:${px(t['fo:letter-spacing'])}px`);
  return c.join(';');
}
function border(v) { if (!v || v === 'none') return null; const m = /^([\d.]+\w*)\s+(\w+)\s+(#\w+)/.exec(v); return m ? `${Math.max(1, px(m[1]) || 1)}px ${m[2] === 'double' ? 'double' : m[2]} ${m[3]}` : null; }
function paraCss(p) {
  if (!p) return '';
  const c = [], al = p['fo:text-align'];
  if (al) c.push(`text-align:${{ start: 'left', end: 'right', center: 'center', justify: 'justify', left: 'left', right: 'right' }[al] || 'left'}`);
  for (const [a, n] of [['margin-left', 'margin-left'], ['margin-right', 'margin-right'], ['margin-top', 'margin-top'], ['margin-bottom', 'margin-bottom'], ['text-indent', 'text-indent']]) { const v = px(p['fo:' + a]); if (v != null) c.push(`${n}:${v}px`); }
  const lh = p['fo:line-height']; if (lh) c.push(`line-height:${lh.endsWith('%') ? parseFloat(lh) / 100 : px(lh) + 'px'}`);
  if (rgb(p['fo:background-color'])) c.push(`background:${p['fo:background-color']}`);
  const b = border(p['fo:border']); if (b) c.push(`border:${b}`);
  for (const s of ['left', 'right', 'top', 'bottom']) { const bs = border(p['fo:border-' + s]); if (bs) c.push(`border-${s}:${bs}`); }
  const pad = px(p['fo:padding']); if (pad != null) c.push(`padding:${pad}px`);
  if (p['fo:break-before'] === 'page') c.push('break-before:page');
  return c.join(';');
}
function cellCss(cl) {
  if (!cl) return '';
  const c = [];
  if (rgb(cl['fo:background-color'])) c.push(`background:${cl['fo:background-color']}`);
  const b = border(cl['fo:border']); if (b) c.push(`border:${b}`);
  for (const s of ['left', 'right', 'top', 'bottom']) { const bs = border(cl['fo:border-' + s]); if (bs) c.push(`border-${s}:${bs}`); }
  const va = cl['style:vertical-align']; if (va) c.push(`vertical-align:${va === 'middle' ? 'middle' : va === 'bottom' ? 'bottom' : 'top'}`);
  const pad = px(cl['fo:padding']); if (pad != null) c.push(`padding:${pad}px`);
  if (cl['fo:wrap-option'] === 'wrap') c.push('white-space:normal;overflow-wrap:anywhere');
  return c.join(';');
}

/* ------------------------------------------------------------------ shared: text content */
function makeCtx(z, S) {
  const urls = new Map();
  return { z, S, async img(href) {
    if (!href) return null;
    if (!urls.has(href)) { const ext = href.split('.').pop().toLowerCase(); urls.set(href, z.has(href) && MIME[ext] ? URL.createObjectURL(new Blob([await z.bytes(href)], { type: MIME[ext] })) : null); }
    return urls.get(href);
  } };
}
const NUMFMT = { 1: n => n, a: n => String.fromCharCode(96 + ((n - 1) % 26) + 1), A: n => String.fromCharCode(64 + ((n - 1) % 26) + 1), i: n => roman(n).toLowerCase(), I: n => roman(n) };
function roman(n) { const m = [[1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'], [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']]; let s = ''; for (const [v, r] of m) while (n >= v) { s += r; n -= v; } return s; }

/** Inline content of a paragraph/span/link. */
async function inline(el, ctx, out) {
  for (const n of el.childNodes) {
    if (n.nodeType === 3) { out.append(n.nodeValue.replace(/\s+/g, ' ')); continue; }
    if (n.nodeType !== 1) continue;
    switch (n.nodeName) {
      case 'text:span': { const sp = h('span', { style: textCss(resolve(ctx.S, 'text', n.getAttribute('text:style-name')).text, ctx.S) }); await inline(n, ctx, sp); out.append(sp); break; }
      case 'text:a': { const a = h('a', { href: n.getAttribute('xlink:href') || null, target: '_blank', rel: 'noopener noreferrer', style: 'color:#0b5cd5;text-decoration:underline' }); await inline(n, ctx, a); out.append(a); break; }
      case 'text:s': out.append(' '.repeat(+n.getAttribute('text:c') || 1)); break;
      case 'text:tab': out.append(h('span', { style: 'display:inline-block;width:2em' })); break;
      case 'text:line-break': out.append(h('br')); break;
      case 'draw:frame': { const f = await frame(n, ctx, true); if (f) out.append(f); break; }
      case 'text:note': case 'text:bookmark': case 'text:bookmark-start': case 'text:bookmark-end': case 'office:annotation': break;
      default: await inline(n, ctx, out);                 // fields, page numbers, text:meta, etc.
    }
  }
}
async function paragraph(el, ctx, tag = 'p', extra = '') {
  const st = resolve(ctx.S, 'paragraph', el.getAttribute('text:style-name'));
  const p = h(tag, { style: [paraCss(st.para), textCss(st.text, ctx.S), extra].filter(Boolean).join(';') + ';margin-block:0;white-space:normal' });
  await inline(el, ctx, p);
  if (!p.childNodes.length) p.append(h('br'));
  return p;
}
/** draw:frame in a text document: a picture (or text box) with its size. */
async function frame(el, ctx, inlineFlow) {
  const w = px(el.getAttribute('svg:width')), hh = px(el.getAttribute('svg:height'));
  const im = kid(el, 'draw:image'), tb = kid(el, 'draw:text-box');
  if (im) {
    const url = await ctx.img(im.getAttribute('xlink:href'));
    return url ? h('img', { src: url, alt: el.getAttribute('draw:name') || '', style: `${w ? `width:${w}px;` : ''}${hh ? `height:${hh}px;` : ''}max-width:100%;${inlineFlow ? 'vertical-align:bottom' : 'display:block'}` }) : null;
  }
  if (tb) { const box = h('div', { style: `${w ? `width:${w}px;` : ''}border:1px solid #ccc;padding:6px;display:inline-block` }); await blocks(tb, ctx, box); return box; }
  return null;
}

/* ------------------------------------------------------------------ text documents */
async function blocks(root, ctx, out, depth = 0) {
  for (const n of root.children) {
    switch (n.nodeName) {
      case 'text:h': { const lvl = Math.min(6, +n.getAttribute('text:outline-level') || 1), st = resolve(ctx.S, 'paragraph', n.getAttribute('text:style-name')); out.append(await paragraph(n, ctx, 'h' + lvl, st.text?.['fo:font-size'] ? '' : `font-size:${[0, 2, 1.6, 1.3, 1.15, 1.05, 1][lvl]}em;font-weight:700;margin-top:.8em`)); break; }
      case 'text:p': out.append(await paragraph(n, ctx)); break;
      case 'text:list': out.append(await list(n, ctx, 0, null)); break;
      case 'table:table': out.append(await docTable(n, ctx)); break;
      case 'text:section': case 'text:table-of-content': case 'text:index-body': case 'text:index-title': await blocks(n, ctx, out, depth); break;
      case 'draw:frame': { const f = await frame(n, ctx, false); if (f) out.append(f); break; }
    }
  }
}
async function list(el, ctx, level, inherited) {
  const styleName = el.getAttribute('text:style-name') || inherited, ls = styleName && ctx.S.lists.get(styleName);
  const lv = ls && [...ls.children].find(c => +c.getAttribute('text:level') === level + 1);
  const wrap = h('div', { class: 'odl', style: 'margin-left:1.4em' });
  let i = +el.getAttribute('text:start-value') || 0;
  for (const li of el.children) {
    if (li.nodeName !== 'text:list-item' && li.nodeName !== 'text:list-header') continue;
    i++;
    let label = '•';
    if (lv?.nodeName === 'text:list-level-style-number') { const f = NUMFMT[lv.getAttribute('style:num-format') || '1'] || NUMFMT[1]; label = (lv.getAttribute('style:num-prefix') || '') + f(i) + (lv.getAttribute('style:num-suffix') || '.'); }
    else if (lv?.nodeName === 'text:list-level-style-bullet') label = lv.getAttribute('text:bullet-char') || '•';
    const row = h('div', { style: 'display:flex;gap:.5em' }, h('span', { style: 'flex:none;min-width:1.2em;text-align:right' }, label));
    const body = h('div', { style: 'flex:1;min-width:0' });
    for (const c of li.children) { if (c.nodeName === 'text:p' || c.nodeName === 'text:h') body.append(await paragraph(c, ctx)); else if (c.nodeName === 'text:list') body.append(await list(c, ctx, level + 1, styleName)); }
    row.append(body); wrap.append(row);
  }
  return wrap;
}
async function docTable(el, ctx) {
  const cols = [];
  for (const c of kids(el, 'table:table-column')) { const w = px(resolve(ctx.S, 'table-column', c.getAttribute('table:style-name')).col?.['style:column-width']); for (let i = 0; i < Math.min(+c.getAttribute('table:number-columns-repeated') || 1, 60); i++) cols.push(w); }
  const tb = h('tbody', {});
  const rows = [...el.children].flatMap(c => c.nodeName === 'table:table-row' ? [c] : ['table:table-header-rows', 'table:table-rows'].includes(c.nodeName) ? kids(c, 'table:table-row') : []);
  for (const r of rows) {
    const tr = h('tr', {});
    for (const c of kids(r, 'table:table-cell')) {
      const rep = Math.min(+c.getAttribute('table:number-columns-repeated') || 1, 20), st = resolve(ctx.S, 'table-cell', c.getAttribute('table:style-name'));
      for (let k = 0; k < rep; k++) {
        const td = h('td', { style: cellCss(st.cell) + ';vertical-align:' + (st.cell?.['style:vertical-align'] === 'middle' ? 'middle' : 'top'), colspan: +c.getAttribute('table:number-columns-spanned') > 1 ? c.getAttribute('table:number-columns-spanned') : null, rowspan: +c.getAttribute('table:number-rows-spanned') > 1 ? c.getAttribute('table:number-rows-spanned') : null });
        await blocks(c, ctx, td); tr.append(td);
      }
    }
    tb.append(tr);
  }
  return h('table', { style: 'border-collapse:collapse;margin:.4em 0;max-width:100%' }, cols.some(Boolean) && h('colgroup', {}, cols.map(w => h('col', { style: w ? `width:${w}px` : '' }))), tb);
}
export async function renderOdt(box, z) {
  const ctx = makeCtx(z, collect([await z.xml('content.xml'), ...(z.has('styles.xml') ? [await z.xml('styles.xml')] : [])]));
  const content = ctx.S.docs[0], body = content.getElementsByTagName('office:text')[0];
  const mp = ctx.S.masters.values().next().value, layout = mp && ctx.S.layouts.get(mp.getAttribute('style:page-layout-name')) || {};
  const W = px(layout['fo:page-width']) || 794, m = s => px(layout['fo:margin-' + s]) ?? 76;
  const page = h('div', { class: 'odtpage', style: `width:${W}px;padding:${m('top')}px ${m('right')}px ${m('bottom')}px ${m('left')}px;min-height:${px(layout['fo:page-height']) || 1123}px` });
  const holder = h('div', { class: 'odtview' }, page);
  box.replaceChildren(holder);
  await blocks(body, ctx, page);
  fitWidth(holder, page, W);
}
function fitWidth(holder, el, W) {
  const apply = () => { const k = Math.min(1, (holder.clientWidth - 2) / W); holder.style.setProperty('--fit', k); };
  new ResizeObserver(apply).observe(holder); apply();
}

/* ------------------------------------------------------------------ spreadsheets */
const NUMERIC = new Set(['float', 'percentage', 'currency', 'date', 'time']);
export async function renderOds(box, z) {
  const ctx = makeCtx(z, collect([await z.xml('content.xml'), ...(z.has('styles.xml') ? [await z.xml('styles.xml')] : [])]));
  const sheets = all(ctx.S.docs[0], 'table:table').filter(t => t.parentNode.nodeName === 'office:spreadsheet');
  const MAXR = 3000, MAXC = 80;
  const build = sh => {
    const cols = []; let defaults = [];
    for (const c of kids(sh, 'table:table-column')) { const w = px(resolve(ctx.S, 'table-column', c.getAttribute('table:style-name')).col?.['style:column-width']) || 85; for (let i = 0; i < Math.min(+c.getAttribute('table:number-columns-repeated') || 1, MAXC); i++) { cols.push(w); defaults.push(c.getAttribute('table:default-cell-style-name')); } }
    const rows = [...sh.children].flatMap(c => c.nodeName === 'table:table-row' ? [c] : ['table:table-header-rows', 'table:table-row-group'].includes(c.nodeName) ? kids(c, 'table:table-row') : []);
    const tb = h('tbody', {}); let maxC = 0, rn = 0, truncated = false;
    const trs = [];
    for (const r of rows) {
      const rep = +r.getAttribute('table:number-rows-repeated') || 1, rh = px(resolve(ctx.S, 'table-row', r.getAttribute('table:style-name')).row?.['style:row-height']);
      const cells = []; let ci = 0;
      for (const c of kids(r, 'table:table-cell', 'table:covered-table-cell')) {
        const crep = +c.getAttribute('table:number-columns-repeated') || 1, empty = !c.textContent.trim() && !c.getAttribute('table:style-name');
        const n = empty ? Math.min(crep, 1) : Math.min(crep, MAXC - ci);
        if (empty && crep > 1) { ci += crep; continue; }
        for (let k = 0; k < n && ci < MAXC; k++, ci++) cells.push({ c, ci });
        if (!empty) { } maxC = Math.max(maxC, ci);
      }
      const blank = !cells.length || cells.every(x => !x.c.textContent.trim() && !x.c.getAttribute('table:style-name'));
      for (let k = 0; k < (blank ? Math.min(rep, 1) : Math.min(rep, 50)); k++) { if (rn >= MAXR) { truncated = true; break; } rn++; trs.push({ cells, rh }); }
      if (blank && rep > 1) rn += 0;
      if (truncated) break;
    }
    const head = h('tr', {}, h('th', { class: 'corner' }), ...Array.from({ length: maxC }, (_, i) => h('th', { class: 'colh' }, colLetters(i))));
    trs.forEach(({ cells, rh }, ri) => {
      const tr = h('tr', { style: rh ? `height:${rh}px` : '' }, h('th', { class: 'rowh' }, ri + 1));
      for (const { c, ci } of cells) {
        if (c.nodeName === 'table:covered-table-cell') continue;
        const sn = c.getAttribute('table:style-name') || defaults[ci], st = resolve(ctx.S, 'table-cell', sn);
        const text = [...c.children].filter(x => x.nodeName === 'text:p').map(p => p.textContent).join('\n');
        const vt = c.getAttribute('office:value-type'), al = st.para?.['fo:text-align'];
        const css = [cellCss(st.cell), textCss(st.text, ctx.S), `text-align:${al ? { start: 'left', end: 'right', center: 'center', left: 'left', right: 'right' }[al] || 'left' : NUMERIC.has(vt) ? 'right' : 'left'}`];
        tr.append(h('td', { style: css.filter(Boolean).join(';'), colspan: +c.getAttribute('table:number-columns-spanned') > 1 ? c.getAttribute('table:number-columns-spanned') : null, rowspan: +c.getAttribute('table:number-rows-spanned') > 1 ? c.getAttribute('table:number-rows-spanned') : null }, text));
      }
      tb.append(tr);
    });
    const colgroup = h('colgroup', {}, h('col', { style: 'width:46px' }), ...Array.from({ length: maxC }, (_, i) => h('col', { style: `width:${cols[i] || 85}px` })));
    return h('div', {}, truncated && h('div', { class: 'tablemeta' }, `Showing the first ${MAXR.toLocaleString()} rows`), h('div', { class: 'xlscroll' }, h('table', { class: 'xl', style: 'font-size:14.5px;font-family:"Liberation Sans",Arial,sans-serif' }, colgroup, h('thead', {}, head), tb)));
  };
  const view = h('div', {}), tabs = h('div', { class: 'seg tabs' });
  const show = i => { [...tabs.children].forEach((b, j) => b.classList.toggle('on', i === j)); view.replaceChildren(build(sheets[i])); };
  sheets.forEach((s, i) => tabs.append(h('button', { onclick: () => show(i) }, s.getAttribute('table:name'))));
  box.replaceChildren(sheets.length > 1 && tabs, view);
  if (sheets.length) show(0); else view.replaceChildren(h('div', { class: 'filecard' }, 'This spreadsheet is empty.'));
}
const colLetters = i => { let s = ''; for (i++; i > 0; i = (i - 1) / 26 | 0) s = String.fromCharCode(65 + (i - 1) % 26) + s; return s; };

/* ------------------------------------------------------------------ presentations */
export async function renderOdp(box, z) {
  const ctx = makeCtx(z, collect([await z.xml('content.xml'), ...(z.has('styles.xml') ? [await z.xml('styles.xml')] : [])]));
  const pages = all(ctx.S.docs[0], 'draw:page');
  const sizeOf = pg => { const mp = ctx.S.masters.get(pg.getAttribute('draw:master-page-name')), l = mp && ctx.S.layouts.get(mp.getAttribute('style:page-layout-name')) || {}; return [px(l['fo:page-width']) || 1058, px(l['fo:page-height']) || 595]; };
  const [W, H] = pages[0] ? sizeOf(pages[0]) : [1058, 595];
  const outer = h('div', { class: 'pptxdeck' });
  box.replaceChildren(h('div', { class: 'tablemeta' }, `${pages.length} slide${pages.length === 1 ? '' : 's'}`), outer);
  new ResizeObserver(() => outer.style.setProperty('--k', Math.min(1, (outer.clientWidth || W) / W))).observe(outer);
  const holders = pages.map((pg, i) => { const [w, hh] = sizeOf(pg), holder = h('div', { class: 'pptxholder', style: `--w:${w}px;--h:${hh}px` }); outer.append(holder); return [holder, pg, w, hh]; });
  const io = new IntersectionObserver(es => es.forEach(e => {
    if (!e.isIntersecting) return; io.unobserve(e.target);
    const [holder, pg, w, hh] = holders.find(x => x[0] === e.target);
    drawPage(pg, w, hh, ctx).then(stage => holder.replaceChildren(stage)).catch(err => { console.warn(err); holder.replaceChildren(h('div', { class: 'filecard' }, 'This slide could not be drawn.')); });
  }), { rootMargin: '800px 0px' });
  holders.forEach(([hd]) => io.observe(hd));
}
async function fillOf(gfx, ctx) {
  const f = gfx?.['draw:fill'];
  if (!f || f === 'none') return { none: true };
  if (f === 'solid') return { color: gfx['draw:fill-color'] || '#729fcf', opacity: gfx['draw:opacity'] ? parseFloat(gfx['draw:opacity']) / 100 : 1 };
  if (f === 'bitmap') { const url = await ctx.img(ctx.S.images.get(gfx['draw:fill-image-name'])); return url ? { image: url } : { none: true }; }
  if (f === 'gradient') { const g = ctx.S.gradients.get(gfx['draw:fill-gradient-name']); if (g) { const a = (+(g.getAttribute('draw:angle') || 0) / 10) || 0, s = g.getAttribute('draw:start-color') || '#fff', e = g.getAttribute('draw:end-color') || '#000'; return { css: g.getAttribute('draw:style') === 'radial' ? `radial-gradient(circle,${e},${s})` : `linear-gradient(${180 - a}deg,${s},${e})` }; } }
  return { none: true };
}
async function drawPage(pg, W, H, ctx) {
  const stage = h('div', { class: 'pptxslide', style: `width:${W}px;height:${H}px;background:#fff` });
  const ps = resolve(ctx.S, 'drawing-page', pg.getAttribute('draw:style-name')).page || {};
  const bg = await fillOf({ 'draw:fill': ps['draw:fill'], 'draw:fill-color': ps['draw:fill-color'], 'draw:fill-image-name': ps['draw:fill-image-name'], 'draw:fill-gradient-name': ps['draw:fill-gradient-name'] }, ctx);
  if (bg.color) stage.style.background = bg.color; else if (bg.image) stage.style.background = `url(${bg.image}) center/cover`; else if (bg.css) stage.style.background = bg.css;
  const master = ctx.S.masters.get(pg.getAttribute('draw:master-page-name'));
  if (master) for (const el of master.children) await shape(el, stage, ctx, true);
  for (const el of pg.children) await shape(el, stage, ctx, false);
  return stage;
}
async function shape(el, parent, ctx, isMaster) {
  const n = el.nodeName;
  if (!/^draw:(frame|rect|ellipse|circle|line|connector|custom-shape|path|polygon|polyline|g|text-box)$/.test(n)) return;
  if (el.getAttribute('presentation:placeholder') === 'true' || (isMaster && /^(header|footer|date-time|page-number)$/.test(el.getAttribute('presentation:class') || ''))) return;
  if (n === 'draw:g') { for (const c of el.children) await shape(c, parent, ctx, isMaster); return; }
  const gs = resolve(ctx.S, 'graphic', el.getAttribute('draw:style-name')), ps = resolve(ctx.S, 'presentation', el.getAttribute('presentation:style-name'));
  const gfx = { ...(gs.gfx || {}), ...(ps.gfx || {}) }, text = { ...(gs.text || {}), ...(ps.text || {}) }, para = { ...(gs.para || {}), ...(ps.para || {}) };
  let x = px(el.getAttribute('svg:x')) || 0, y = px(el.getAttribute('svg:y')) || 0, w = px(el.getAttribute('svg:width')), hh = px(el.getAttribute('svg:height'));
  const x1 = px(el.getAttribute('svg:x1')), y1 = px(el.getAttribute('svg:y1')), x2 = px(el.getAttribute('svg:x2')), y2 = px(el.getAttribute('svg:y2'));
  if (n === 'draw:line' || n === 'draw:connector') { x = Math.min(x1, x2); y = Math.min(y1, y2); w = Math.abs(x2 - x1) || 1; hh = Math.abs(y2 - y1) || 1; }
  if (w == null || hh == null) return;
  let rot = 0;
  const tf = el.getAttribute('draw:transform');
  if (tf) { const r = /rotate\s*\(\s*(-?[\d.e-]+)/.exec(tf), t = /translate\s*\(\s*(-?[\d.]+)(\w*)\s+(-?[\d.]+)(\w*)/.exec(tf); if (r) rot = -parseFloat(r[1]) * 180 / Math.PI; if (t) { x += len(t[1] + (t[2] || 'px')) || 0; y += len(t[3] + (t[4] || 'px')) || 0; } }
  const box = h('div', { class: 'ps', style: `left:${x}px;top:${y}px;width:${w}px;height:${hh}px${rot ? `;transform:rotate(${rot}deg)` : ''}` });
  const fill = await fillOf(gfx, ctx), stroke = gfx['draw:stroke'] && gfx['draw:stroke'] !== 'none' ? { c: gfx['svg:stroke-color'] || '#3465a4', w: px(gfx['svg:stroke-width']) || 1 } : null;
  const geom = n === 'draw:custom-shape' ? (kid(el, 'draw:enhanced-geometry')?.getAttribute('draw:type') || 'rectangle') : n.replace('draw:', '');
  const svgNS = 'http://www.w3.org/2000/svg', mk = (t, a) => { const e = document.createElementNS(svgNS, t); for (const k in a) e.setAttribute(k, a[k]); return e; };
  const needsSvg = ['draw:rect', 'draw:ellipse', 'draw:circle', 'draw:custom-shape', 'draw:line', 'draw:connector', 'draw:path', 'draw:polygon', 'draw:polyline'].includes(n) && (!fill.none || stroke);
  if (needsSvg) {
    const svg = mk('svg', { width: w, height: hh, viewBox: `0 0 ${w} ${hh}` }); svg.setAttribute('class', 'pgeom'); svg.style.cssText = `width:${w}px;height:${hh}px;overflow:visible`;
    const fillAttr = fill.color ? fill.color : 'none';
    const common = { fill: n === 'draw:line' || n === 'draw:connector' || n === 'draw:polyline' ? 'none' : fillAttr, 'fill-opacity': fill.opacity ?? 1, stroke: stroke ? stroke.c : 'none', 'stroke-width': stroke ? stroke.w : 0 };
    let el2;
    if (n === 'draw:line' || n === 'draw:connector') el2 = mk('line', { x1: x1 - x, y1: y1 - y, x2: x2 - x, y2: y2 - y, ...common, stroke: stroke?.c || '#000', 'stroke-width': stroke?.w || 1 });
    else if (n === 'draw:path' || n === 'draw:polygon' || n === 'draw:polyline') {
      const vb = (el.getAttribute('svg:viewBox') || `0 0 ${w} ${hh}`).split(/\s+/).map(Number), d = n === 'draw:path' ? el.getAttribute('svg:d') : 'M' + el.getAttribute('draw:points').trim().split(/\s+/).map(p => p.replace(',', ' ')).join('L') + (n === 'draw:polygon' ? 'Z' : '');
      el2 = mk('path', { d, transform: `scale(${w / (vb[2] || w)},${hh / (vb[3] || hh)}) translate(${-vb[0]},${-vb[1]})`, ...common });
    } else if (/ellipse|circle/.test(geom)) el2 = mk('ellipse', { cx: w / 2, cy: hh / 2, rx: w / 2, ry: hh / 2, ...common });
    else if (/diamond/.test(geom)) el2 = mk('path', { d: `M${w / 2} 0L${w} ${hh / 2}L${w / 2} ${hh}L0 ${hh / 2}Z`, ...common });
    else if (/triangle/.test(geom)) el2 = mk('path', { d: `M${w / 2} 0L${w} ${hh}L0 ${hh}Z`, ...common });
    else el2 = mk('rect', { width: w, height: hh, rx: /round/.test(geom) ? Math.min(w, hh) * .16 : 0, ...common });
    svg.append(el2); box.append(svg);
  } else if (fill.image || fill.css) box.style.background = fill.image ? `url(${fill.image}) center/cover` : fill.css;
  const im = kid(el, 'draw:image');
  if (im) { const url = await ctx.img(im.getAttribute('xlink:href')); if (url) box.append(h('img', { src: url, alt: '', draggable: 'false', style: 'position:absolute;inset:0;width:100%;height:100%;object-fit:fill' })); }
  const tb = kid(el, 'draw:text-box'), src = tb || el;
  const paras = kids(src, 'text:p', 'text:list', 'text:h');
  if (paras.length) {
    const va = gfx['draw:textarea-vertical-align'], pad = px(gfx['fo:padding-left']) ?? px(gfx['fo:padding']) ?? 7;
    const t = h('div', { class: 'ptext', style: `padding:${px(gfx['fo:padding-top']) ?? pad}px ${pad}px;justify-content:${va === 'middle' ? 'center' : va === 'bottom' ? 'flex-end' : 'flex-start'};${textCss(text, ctx.S)};${paraCss(para)}` });
    for (const p of paras) { if (p.nodeName === 'text:list') t.append(await list(p, ctx, 0, null)); else t.append(await paragraph(p, ctx)); }
    box.append(t);
  }
  parent.append(box);
}
