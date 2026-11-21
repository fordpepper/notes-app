// PowerPoint renderer. Draws each slide at its design size (so text wraps exactly as in PowerPoint) and scales it to fit.
// Supports: theme colours/fonts, master + layout inheritance (positions, text styles, decorative shapes, backgrounds),
// text (bullets, spacing, sizes, colours), pictures (cropping, SVG, alpha), preset + custom shapes, gradients, lines/arrows,
// groups, tables (with table styles), simple charts, and SmartArt (via its stored drawing).
import { h } from './dom.js';

const EMU = 9525;                                   // EMU per CSS px at 96 dpi
const K = 4 / 3;                                    // pt -> px
const kids = (el, ...n) => el ? [...el.children].filter(c => n.includes(c.localName)) : [];
const kid = (el, n) => { if (!el) return null; for (const c of el.children) if (c.localName === n) return c; return null; };
const path = (el, ...names) => { for (const n of names) { el = kid(el, n); if (!el) return null; } return el; };
const num = (el, a, d = 0) => { const v = el?.getAttribute(a); return v == null || v === '' ? d : +v; };
const dirOf = p => p.slice(0, p.lastIndexOf('/') + 1);
function resolve(base, target) {
  if (target.startsWith('/')) return target.slice(1);
  const out = [];
  for (const s of (dirOf(base) + target).split('/')) { if (s === '..') out.pop(); else if (s && s !== '.') out.push(s); }
  return out.join('/');
}
const MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', svg: 'image/svg+xml', webp: 'image/webp', bmp: 'image/bmp', tif: 'image/tiff', tiff: 'image/tiff' };

/* ------------------------------------------------------------------ colours */
const hex2 = s => [0, 2, 4].map(i => parseInt(s.slice(i, i + 2), 16));
function toHsl([r, g, b]) {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2; let hh = 0, s = 0;
  if (mx !== mn) { const d = mx - mn; s = l > .5 ? d / (2 - mx - mn) : d / (mx + mn); hh = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; hh /= 6; }
  return [hh, s, l];
}
function fromHsl([hh, s, l]) {
  if (s === 0) return [l, l, l].map(v => Math.round(v * 255));
  const q = l < .5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q, f = t => { t = (t + 1) % 1; return t < 1 / 6 ? p + (q - p) * 6 * t : t < .5 ? q : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p; };
  return [f(hh + 1 / 3), f(hh), f(hh - 1 / 3)].map(v => Math.round(v * 255));
}
const PRESET_CLR = { black: '000000', white: 'ffffff', red: 'ff0000', green: '008000', blue: '0000ff', yellow: 'ffff00', gray: '808080', grey: '808080', orange: 'ffa500', purple: '800080', silver: 'c0c0c0', navy: '000080', teal: '008080', lime: '00ff00', cyan: '00ffff', magenta: 'ff00ff', maroon: '800000', olive: '808000', pink: 'ffc0cb', brown: 'a52a2a', darkgray: 'a9a9a9', lightgray: 'd3d3d3' };
const COLOR_NAMES = new Set(['srgbClr', 'schemeClr', 'sysClr', 'prstClr', 'hslClr', 'scrgbClr']);
/** Resolve a DrawingML colour (the element itself, or the first colour child of `el`) to { r, g, b, a }. `ph` = colour to use for phClr. */
function colorOf(el, ctx, ph) {
  const c = el && (COLOR_NAMES.has(el.localName) ? el : [...el.children].find(x => COLOR_NAMES.has(x.localName)));
  if (!c) return null;
  let rgb;
  const v = c.getAttribute('val');
  switch (c.localName) {
    case 'srgbClr': rgb = hex2(v); break;
    case 'sysClr': rgb = hex2(c.getAttribute('lastClr') || (v === 'window' ? 'ffffff' : '000000')); break;
    case 'prstClr': rgb = hex2(PRESET_CLR[v] || '000000'); break;
    case 'schemeClr': {
      if (v === 'phClr') { if (!ph) return null; rgb = [ph.r, ph.g, ph.b]; break; }
      const name = ctx.clrMap[v] || v, hx = ctx.theme.colors[name] || ctx.theme.colors[{ bg1: 'lt1', tx1: 'dk1', bg2: 'lt2', tx2: 'dk2' }[name]] || '000000';
      rgb = hex2(hx); break;
    }
    default: rgb = [0, 0, 0];
  }
  let a = 1;
  for (const m of c.children) {
    const n = m.localName, val = num(m, 'val') / 100000;
    if (n === 'alpha') a = val;
    else if (n === 'lumMod') { const t = toHsl(rgb); t[2] = Math.min(1, t[2] * val); rgb = fromHsl(t); }
    else if (n === 'lumOff') { const t = toHsl(rgb); t[2] = Math.max(0, Math.min(1, t[2] + val)); rgb = fromHsl(t); }
    else if (n === 'satMod') { const t = toHsl(rgb); t[1] = Math.min(1, t[1] * val); rgb = fromHsl(t); }
    else if (n === 'satOff') { const t = toHsl(rgb); t[1] = Math.max(0, Math.min(1, t[1] + val)); rgb = fromHsl(t); }
    else if (n === 'tint') rgb = rgb.map(x => Math.round(x * val + 255 * (1 - val)));
    else if (n === 'shade') rgb = rgb.map(x => Math.round(x * val));
  }
  return { r: rgb[0], g: rgb[1], b: rgb[2], a };
}
const css = c => c ? (c.a < 1 ? `rgba(${c.r},${c.g},${c.b},${c.a})` : `rgb(${c.r},${c.g},${c.b})`) : 'none';

/* ------------------------------------------------------------------ package + theme */
async function relsOf(z, part) {
  const rp = dirOf(part) + '_rels/' + part.slice(part.lastIndexOf('/') + 1) + '.rels', m = new Map();
  if (!z.has(rp)) return m;
  for (const r of (await z.xml(rp)).getElementsByTagName('Relationship')) m.set(r.getAttribute('Id'), { type: r.getAttribute('Type').split('/').pop(), target: r.getAttribute('TargetMode') === 'External' ? null : resolve(part, r.getAttribute('Target')) });
  return m;
}
function parseTheme(x) {
  const colors = {}, fonts = { major: 'Calibri', minor: 'Calibri' };
  const cs = x.getElementsByTagNameNS('*', 'clrScheme')[0];
  for (const c of cs ? cs.children : []) { const e = c.firstElementChild; if (e) colors[c.localName] = e.getAttribute('lastClr') || e.getAttribute('val') || '000000'; }
  const mj = x.getElementsByTagNameNS('*', 'majorFont')[0], mn = x.getElementsByTagNameNS('*', 'minorFont')[0];
  if (mj) fonts.major = kid(mj, 'latin')?.getAttribute('typeface') || fonts.major;
  if (mn) fonts.minor = kid(mn, 'latin')?.getAttribute('typeface') || fonts.minor;
  const fmt = x.getElementsByTagNameNS('*', 'fmtScheme')[0];
  return { colors, fonts, lnStyles: kids(kid(fmt, 'lnStyleLst'), 'ln'), fillStyles: kids(kid(fmt, 'fillStyleLst'), 'solidFill', 'gradFill', 'noFill', 'blipFill', 'pattFill'), bgFills: kids(kid(fmt, 'bgFillStyleLst'), 'solidFill', 'gradFill', 'noFill', 'blipFill', 'pattFill') };
}

/* ------------------------------------------------------------------ text properties */
function parseRPr(el, ctx, ph) {
  const o = {};
  if (!el) return o;
  for (const a of ['sz', 'b', 'i', 'u', 'strike', 'baseline', 'cap', 'spc']) if (el.hasAttribute(a)) o[a] = el.getAttribute(a);
  const sf = kid(el, 'solidFill'); if (sf) o.color = colorOf(sf, ctx, ph);
  const lat = kid(el, 'latin'); if (lat) o.font = lat.getAttribute('typeface');
  if (kid(el, 'hlinkClick')) o.link = true;
  const hl = kid(el, 'highlight'); if (hl) o.highlight = colorOf(hl, ctx, ph);
  return o;
}
function parsePPr(el, ctx, ph) {
  const o = {};
  if (!el) return o;
  for (const a of ['algn', 'marL', 'indent', 'lvl']) if (el.hasAttribute(a)) o[a] = el.getAttribute(a);
  const sp = (n) => { const e = kid(el, n); if (!e) return; const p = kid(e, 'spcPct'), q = kid(e, 'spcPts'); return p ? { pct: num(p, 'val') / 100000 } : q ? { pts: num(q, 'val') / 100 } : undefined; };
  const a = sp('lnSpc'), b = sp('spcBef'), c = sp('spcAft'); if (a) o.lnSpc = a; if (b) o.spcBef = b; if (c) o.spcAft = c;
  if (kid(el, 'buNone')) { o.buNone = true; o.buChar = o.buAuto = undefined; }
  const bc = kid(el, 'buChar'); if (bc) { o.buChar = bc.getAttribute('char'); o.buNone = false; o.buAuto = undefined; }
  const ba = kid(el, 'buAutoNum'); if (ba) { o.buAuto = { type: ba.getAttribute('type'), start: num(ba, 'startAt', 1) }; o.buNone = false; o.buChar = undefined; }
  const bf = kid(el, 'buFont'); if (bf) o.buFont = bf.getAttribute('typeface');
  const bcl = kid(el, 'buClr'); if (bcl) o.buClr = colorOf(bcl, ctx, ph);
  const bsz = kid(el, 'buSzPct'); if (bsz) o.buSz = num(bsz, 'val') / 100000;
  const d = kid(el, 'defRPr'); if (d) o.def = parseRPr(d, ctx, ph);
  return o;
}
const mergeP = (a, b) => { const o = { ...a }; for (const k in b) if (b[k] !== undefined && k !== 'def') o[k] = b[k]; o.def = { ...(a.def || {}), ...(b.def || {}) }; return o; };
/** Paragraph properties for level `lvl`, merged over a chain of list-style elements (base first). */
function levelProps(lists, lvl, ctx, ph) {
  let acc = { def: {} };
  for (const l of lists) if (l) acc = mergeP(acc, parsePPr(kid(l, 'lvl' + (lvl + 1) + 'pPr'), ctx, ph));
  return acc;
}

/* ------------------------------------------------------------------ preset geometry */
const ss = (w, h) => Math.min(w, h);
const poly = pts => 'M' + pts.map(p => p.join(' ')).join('L') + 'Z';
function star(n, w, h, inner = .382) {
  const pts = [];
  for (let i = 0; i < n * 2; i++) { const r = i % 2 ? inner : 1, ang = -Math.PI / 2 + i * Math.PI / n; pts.push([(w / 2 + Math.cos(ang) * r * w / 2).toFixed(1), (h / 2 + Math.sin(ang) * r * h / 2).toFixed(1)]); }
  return poly(pts);
}
function arrow(dir, w, h, a) {
  const horiz = dir === 'right' || dir === 'left', L = horiz ? w : h, T = horiz ? h : w;
  const shaft = T * (a.adj1 ?? 50000) / 100000, head = Math.min(ss(w, h) * (a.adj2 ?? 50000) / 100000, L);
  const y0 = (T - shaft) / 2, y1 = y0 + shaft;
  let pts = [[0, y0], [L - head, y0], [L - head, 0], [L, T / 2], [L - head, T], [L - head, y1], [0, y1]];
  if (dir === 'left') pts = pts.map(([x, y]) => [L - x, y]);
  if (dir === 'down' || dir === 'up') pts = pts.map(([x, y]) => [y, dir === 'down' ? x : L - x]);
  return poly(pts);
}
const ell = (cx, cy, rx, ry) => `M${cx - rx} ${cy}A${rx} ${ry} 0 1 0 ${cx + rx} ${cy}A${rx} ${ry} 0 1 0 ${cx - rx} ${cy}Z`;
const PRESETS = {
  rect: (w, h) => `M0 0H${w}V${h}H0Z`,
  roundRect: (w, h, a) => { const r = Math.min(w, h) * Math.min(a.adj ?? 16667, 50000) / 100000; return `M${r} 0H${w - r}A${r} ${r} 0 0 1 ${w} ${r}V${h - r}A${r} ${r} 0 0 1 ${w - r} ${h}H${r}A${r} ${r} 0 0 1 0 ${h - r}V${r}A${r} ${r} 0 0 1 ${r} 0Z`; },
  ellipse: (w, h) => ell(w / 2, h / 2, w / 2, h / 2),
  triangle: (w, h, a) => poly([[0, h], [w * (a.adj ?? 50000) / 100000, 0], [w, h]]),
  rtTriangle: (w, h) => poly([[0, 0], [w, h], [0, h]]),
  diamond: (w, h) => poly([[w / 2, 0], [w, h / 2], [w / 2, h], [0, h / 2]]),
  parallelogram: (w, h, a) => { const x = ss(w, h) * (a.adj ?? 25000) / 100000; return poly([[x, 0], [w, 0], [w - x, h], [0, h]]); },
  trapezoid: (w, h, a) => { const x = ss(w, h) * (a.adj ?? 25000) / 100000; return poly([[x, 0], [w - x, 0], [w, h], [0, h]]); },
  pentagon: (w, h) => star(5, w, h, 1).replace(/^M[^L]*L/, 'M') && poly([0, 1, 2, 3, 4].map(i => { const ang = -Math.PI / 2 + i * 2 * Math.PI / 5; return [w / 2 + Math.cos(ang) * w / 2, h / 2 + Math.sin(ang) * h / 2]; })),
  hexagon: (w, h, a) => { const x = ss(w, h) * (a.adj ?? 25000) / 100000; return poly([[x, 0], [w - x, 0], [w, h / 2], [w - x, h], [x, h], [0, h / 2]]); },
  octagon: (w, h, a) => { const x = ss(w, h) * (a.adj ?? 29289) / 100000; return poly([[x, 0], [w - x, 0], [w, x], [w, h - x], [w - x, h], [x, h], [0, h - x], [0, x]]); },
  star4: (w, h) => star(4, w, h, .38), star5: (w, h) => star(5, w, h), star6: (w, h) => star(6, w, h, .5), star8: (w, h) => star(8, w, h, .7), star10: (w, h) => star(10, w, h, .7),
  rightArrow: (w, h, a) => arrow('right', w, h, a), leftArrow: (w, h, a) => arrow('left', w, h, a), upArrow: (w, h, a) => arrow('up', w, h, a), downArrow: (w, h, a) => arrow('down', w, h, a),
  chevron: (w, h, a) => { const x = ss(w, h) * (a.adj ?? 50000) / 100000; return poly([[0, 0], [w - x, 0], [w, h / 2], [w - x, h], [0, h], [x, h / 2]]); },
  homePlate: (w, h, a) => { const x = ss(w, h) * (a.adj ?? 50000) / 100000; return poly([[0, 0], [w - x, 0], [w, h / 2], [w - x, h], [0, h]]); },
  plus: (w, h, a) => { const x = ss(w, h) * (a.adj ?? 25000) / 100000; return poly([[x, 0], [w - x, 0], [w - x, x], [w, x], [w, h - x], [w - x, h - x], [w - x, h], [x, h], [x, h - x], [0, h - x], [0, x], [x, x]]); },
  donut: (w, h, a) => { const t = ss(w, h) * (a.adj ?? 25000) / 100000; return ell(w / 2, h / 2, w / 2, h / 2) + ell(w / 2, h / 2, w / 2 - t, h / 2 - t); },
  heart: (w, h) => `M${w / 2} ${h}C${-w * .15} ${h * .45} ${w * .2} ${-h * .1} ${w / 2} ${h * .3}C${w * .8} ${-h * .1} ${w * 1.15} ${h * .45} ${w / 2} ${h}Z`,
  line: (w, h) => `M0 0L${w} ${h}`,
  bentConnector3: (w, h, a) => { const x = w * (a.adj1 ?? 50000) / 100000; return `M0 0H${x}V${h}H${w}`; },
};
Object.assign(PRESETS, { straightConnector1: PRESETS.line, flowChartProcess: PRESETS.rect, flowChartDecision: PRESETS.diamond, flowChartConnector: PRESETS.ellipse, flowChartTerminator: (w, h) => PRESETS.roundRect(w, h, { adj: 50000 }),
  round2SameRect: PRESETS.roundRect, round1Rect: PRESETS.roundRect, round2DiagRect: PRESETS.roundRect, snipRoundRect: PRESETS.roundRect, wedgeRoundRectCallout: PRESETS.roundRect, wedgeRectCallout: PRESETS.rect, cloud: PRESETS.ellipse, ellipseRibbon: PRESETS.rect,
  bentConnector2: PRESETS.bentConnector3, bentConnector4: PRESETS.bentConnector3, bentConnector5: PRESETS.bentConnector3, curvedConnector3: PRESETS.bentConnector3, mathPlus: PRESETS.plus, pentagonArrow: PRESETS.homePlate });
const OPEN_SHAPES = new Set(['line', 'straightConnector1', 'bentConnector2', 'bentConnector3', 'bentConnector4', 'bentConnector5', 'curvedConnector3']);

function custPath(g, w, h) {
  let d = '';
  for (const p of kids(kid(g, 'pathLst'), 'path')) {
    const pw = num(p, 'w') || w, ph = num(p, 'h') || h, sx = w / pw, sy = h / ph;
    const pt = e => `${(num(e, 'x') * sx).toFixed(2)} ${(num(e, 'y') * sy).toFixed(2)}`;
    let cur = [0, 0];
    for (const c of p.children) {
      const pts = kids(c, 'pt');
      if (c.localName === 'moveTo') { d += 'M' + pt(pts[0]); cur = [num(pts[0], 'x') * sx, num(pts[0], 'y') * sy]; }
      else if (c.localName === 'lnTo') { d += 'L' + pt(pts[0]); cur = [num(pts[0], 'x') * sx, num(pts[0], 'y') * sy]; }
      else if (c.localName === 'cubicBezTo') { d += 'C' + pts.map(pt).join(' '); cur = [num(pts[2], 'x') * sx, num(pts[2], 'y') * sy]; }
      else if (c.localName === 'quadBezTo') { d += 'Q' + pts.map(pt).join(' '); cur = [num(pts[1], 'x') * sx, num(pts[1], 'y') * sy]; }
      else if (c.localName === 'arcTo') {
        const wr = num(c, 'wR') * sx, hr = num(c, 'hR') * sy, st = num(c, 'stAng') / 60000 * Math.PI / 180, sw = num(c, 'swAng') / 60000 * Math.PI / 180;
        const cx = cur[0] - wr * Math.cos(st), cy = cur[1] - hr * Math.sin(st), en = st + sw, ex = cx + wr * Math.cos(en), ey = cy + hr * Math.sin(en);
        d += `A${wr} ${hr} 0 ${Math.abs(sw) > Math.PI ? 1 : 0} ${sw > 0 ? 1 : 0} ${ex.toFixed(2)} ${ey.toFixed(2)}`; cur = [ex, ey];
      } else if (c.localName === 'close') d += 'Z';
    }
  }
  return d;
}

/* ------------------------------------------------------------------ the renderer */
const svgNS = 'http://www.w3.org/2000/svg';
const svgEl = (n, attrs = {}, ...ch) => { const e = document.createElementNS(svgNS, n); for (const k in attrs) if (attrs[k] != null) e.setAttribute(k, attrs[k]); e.append(...ch); return e; };
const NUM_FMT = { arabicPeriod: n => n + '.', arabicParenR: n => n + ')', alphaLcPeriod: n => String.fromCharCode(96 + ((n - 1) % 26) + 1) + '.', alphaUcPeriod: n => String.fromCharCode(64 + ((n - 1) % 26) + 1) + '.', alphaLcParenR: n => String.fromCharCode(96 + ((n - 1) % 26) + 1) + ')', romanLcPeriod: n => roman(n).toLowerCase() + '.', romanUcPeriod: n => roman(n) + '.' };
function roman(n) { const m = [[1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'], [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']]; let s = ''; for (const [v, r] of m) while (n >= v) { s += r; n -= v; } return s; }

export async function renderPptx(box, z) {
  const pres = await z.xml('ppt/presentation.xml');
  const prels = await relsOf(z, 'ppt/presentation.xml');
  const sz = pres.getElementsByTagNameNS('*', 'sldSz')[0], W = num(sz, 'cx', 9144000) / EMU, H = num(sz, 'cy', 6858000) / EMU;
  const slideIds = [...pres.getElementsByTagNameNS('*', 'sldId')].map(s => prels.get(s.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id') || s.getAttribute('r:id'))?.target).filter(Boolean);
  const defaultText = kid(pres.documentElement, 'defaultTextStyle');
  const urls = new Map();
  const imageUrl = async part => {
    if (!part || !z.has(part)) return null;
    if (!urls.has(part)) { const ext = part.split('.').pop().toLowerCase(); urls.set(part, MIME[ext] ? URL.createObjectURL(new Blob([await z.bytes(part)], { type: MIME[ext] })) : null); }
    return urls.get(part);
  };
  const tableStyles = z.has('ppt/tableStyles.xml') ? await z.xml('ppt/tableStyles.xml') : null;
  const cache = new Map();
  const load = async (part, kind) => { if (!cache.has(part)) cache.set(part, (async () => ({ x: await z.xml(part), rels: await relsOf(z, part) }))()); return cache.get(part); };

  const outer = h('div', { class: 'pptxdeck' });
  box.replaceChildren(h('div', { class: 'tablemeta' }, `${slideIds.length} slide${slideIds.length === 1 ? '' : 's'}`), outer);
  const holders = [];
  const fit = () => { const k = Math.min(1, (outer.clientWidth || W) / W); outer.style.setProperty('--k', k); };
  new ResizeObserver(fit).observe(outer);

  async function drawSlide(part, holder, index) {
    const S = await load(part), sld = S.x.documentElement;
    const layoutPart = [...S.rels.values()].find(r => r.type === 'slideLayout')?.target;
    const L = layoutPart ? await load(layoutPart) : null;
    const masterPart = L && [...L.rels.values()].find(r => r.type === 'slideMaster')?.target;
    const M = masterPart ? await load(masterPart) : null;
    const themePart = M && [...M.rels.values()].find(r => r.type === 'theme')?.target;
    const T = themePart ? await load(themePart) : null;
    const clrMapEl = M && kid(M.x.documentElement, 'clrMap'), clrMap = {};
    if (clrMapEl) for (const a of clrMapEl.attributes) clrMap[a.name] = a.value; else Object.assign(clrMap, { bg1: 'lt1', tx1: 'dk1', bg2: 'lt2', tx2: 'dk2' });
    const ctx = { z, tableStylesDoc: tableStyles, defaultTextEl: defaultText, theme: T ? parseTheme(T.x) : { colors: {}, fonts: { major: 'Calibri', minor: 'Calibri' }, lnStyles: [], fillStyles: [], bgFills: [] }, clrMap, imageUrl, load, slideNo: index + 1 };
    const master = M?.x.documentElement, layout = L?.x.documentElement;
    const txStyles = kid(master, 'txStyles');
    const spTree = el => path(el, 'cSld', 'spTree');
    const phShapes = tree => kids(tree, 'sp', 'pic').filter(s => phOf(s));
    const lShapes = layout ? phShapes(spTree(layout)) : [], mShapes = master ? phShapes(spTree(master)) : [];

    const stage = h('div', { class: 'pptxslide', style: `width:${W}px;height:${H}px` });
    // background: slide -> layout -> master
    const bgOf = async (root, rels, partCtx) => {
      const bg = path(root, 'cSld', 'bg'); if (!bg) return null;
      const pr = kid(bg, 'bgPr'); if (pr) return fillStyle(pr, ctx, null, { rels, part: partCtx });
      const ref = kid(bg, 'bgRef'); if (ref) { const c = colorOf(ref, ctx); const idx = num(ref, 'idx'); const f = idx > 1000 ? ctx.theme.bgFills[idx - 1001] : ctx.theme.fillStyles[idx - 1]; return f ? fillStyle({ children: [f] }, ctx, c, { rels, part: partCtx }) : c ? { type: 'solid', color: c } : null; }
      return null;
    };
    const bg = (await bgOf(sld, S.rels, part)) || (L && (await bgOf(layout, L.rels, layoutPart))) || (M && (await bgOf(master, M.rels, masterPart))) || { type: 'solid', color: { r: 255, g: 255, b: 255, a: 1 } };
    await applyBg(stage, bg, ctx, { rels: S.rels });

    const build = async (tree, scope) => { for (const el of tree.children) { const n = await shape(el, ctx, scope); if (n) scope.target.append(n); } };
    const inheritedDeco = async (root, scopeBase) => { const tree = spTree(root); if (!tree) return; const frag = { ...scopeBase, target: stage, onlyDeco: true }; await build(tree, frag); };
    const showMaster = sld.getAttribute('showMasterSp') !== '0' && (!layout || layout.getAttribute('showMasterSp') !== '0');
    if (showMaster && M) await inheritedDeco(master, { part: masterPart, rels: M.rels, layoutShapes: [], masterShapes: [], txStyles, defaultText });
    if (L && sld.getAttribute('showMasterSp') !== '0') await inheritedDeco(layout, { part: layoutPart, rels: L.rels, layoutShapes: [], masterShapes: [], txStyles, defaultText });
    const scope = { part, rels: S.rels, layoutShapes: lShapes, masterShapes: mShapes, txStyles, defaultText, target: stage, slide: true, tree: spTree(sld) };
    await build(spTree(sld), scope);
    holder.replaceChildren(stage); holder.dataset.drawn = '1';
  }

  slideIds.forEach((part, i) => {
    const holder = h('div', { class: 'pptxholder', style: `--w:${W}px;--h:${H}px` });
    outer.append(holder); holders.push([holder, part, i]);
  });
  fit();
  const io = new IntersectionObserver(es => es.forEach(e => {
    if (!e.isIntersecting) return;
    io.unobserve(e.target);
    const [holder, part, i] = holders.find(x => x[0] === e.target);
    drawSlide(part, holder, i).catch(err => { console.warn(err); holder.replaceChildren(h('div', { class: 'filecard' }, 'This slide could not be drawn.')); });
  }), { rootMargin: '800px 0px' });
  holders.forEach(([hd]) => io.observe(hd));
}

const phOf = el => { const nv = kid(el, 'nvSpPr') || kid(el, 'nvPicPr') || kid(el, 'nvGraphicFramePr') || kid(el, 'nvCxnSpPr'); return path(nv, 'nvPr', 'ph'); };
function findPh(list, ph) {
  const idx = ph.getAttribute('idx'), type = ph.getAttribute('type') || 'body', norm = t => ({ ctrTitle: 'title', subTitle: 'body' }[t] || t);
  return list.find(s => { const p = phOf(s); return idx != null && p.getAttribute('idx') === idx && (p.getAttribute('type') || 'body') === (ph.getAttribute('type') || 'body'); })
    || list.find(s => { const p = phOf(s); return idx != null && p.getAttribute('idx') === idx; })
    || list.find(s => { const p = phOf(s); return norm(p.getAttribute('type') || 'body') === norm(type); });
}
function xfrmOf(el) {
  const x = kid(kid(el, 'spPr') || kid(el, 'grpSpPr'), 'xfrm') || kid(el, 'xfrm');
  if (!x) return null;
  const off = kid(x, 'off'), ext = kid(x, 'ext');
  return { x: num(off, 'x') / EMU, y: num(off, 'y') / EMU, w: num(ext, 'cx') / EMU, h: num(ext, 'cy') / EMU, rot: num(x, 'rot') / 60000, fx: x.getAttribute('flipH') === '1', fy: x.getAttribute('flipV') === '1', chOff: kid(x, 'chOff'), chExt: kid(x, 'chExt') };
}

/* ------------------------------------------------------------------ fills and lines */
function gradStops(g, ctx, phc) {
  return kids(kid(g, 'gsLst'), 'gs').map(s => ({ pos: num(s, 'pos') / 1000, color: colorOf(s, ctx, phc) })).filter(s => s.color);
}
/** Returns { type: 'none'|'solid'|'grad'|'blip', ... } from the fill child of `parent`, or undefined if none specified. */
async function fillStyle(parent, ctx, phc, sc) {
  for (const c of parent.children) {
    switch (c.localName) {
      case 'noFill': return { type: 'none' };
      case 'solidFill': { const col = colorOf(c, ctx, phc); return col ? { type: 'solid', color: col } : undefined; }
      case 'gradFill': { const lin = kid(c, 'lin'), path = kid(c, 'path'); return { type: 'grad', stops: gradStops(c, ctx, phc), angle: lin ? num(lin, 'ang') / 60000 : 90, radial: !!path }; }
      case 'pattFill': { const col = colorOf(kid(c, 'fgClr'), ctx, phc); return col ? { type: 'solid', color: col } : undefined; }
      case 'blipFill': { const b = kid(c, 'blip'), rid = b?.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'embed') || b?.getAttribute('r:embed'); const url = rid && await ctx.imageUrl(sc.rels.get(rid)?.target); return url ? { type: 'blip', url } : undefined; }
    }
  }
}
async function applyBg(el, f, ctx, sc) {
  if (!f) return;
  if (f.type === 'solid') el.style.background = css(f.color);
  else if (f.type === 'grad') el.style.background = gradCss(f);
  else if (f.type === 'blip') el.style.background = `url(${f.url}) center/cover`;
}
const gradCss = f => f.radial ? `radial-gradient(circle, ${f.stops.map(s => `${css(s.color)} ${s.pos}%`).join(',')})` : `linear-gradient(${(f.angle + 90) % 360}deg, ${f.stops.map(s => `${css(s.color)} ${s.pos}%`).join(',')})`;
function lineStyle(spPr, style, ctx) {
  const ln = kid(spPr, 'ln'), ref = kid(style, 'lnRef');
  let w = 0, color = null, dash = null, none = false, head = null, tail = null;
  if (ref && num(ref, 'idx') > 0) { const base = ctx.theme.lnStyles[num(ref, 'idx') - 1]; const phc = colorOf(ref, ctx); w = base ? num(base, 'w') / EMU : 1; color = phc; if (base) { const sf = kid(base, 'solidFill'); if (sf) color = colorOf(sf, ctx, phc) || color; } }
  if (ln) {
    if (ln.hasAttribute('w')) w = num(ln, 'w') / EMU;
    if (kid(ln, 'noFill')) none = true;
    const sf = kid(ln, 'solidFill'); if (sf) { color = colorOf(sf, ctx, color); none = false; }
    const gf = kid(ln, 'gradFill'); if (gf) { color = gradStops(gf, ctx)[0]?.color || color; none = false; }
    const pd = kid(ln, 'prstDash')?.getAttribute('val'); if (pd && pd !== 'solid') dash = { dash: '8 4', sysDash: '4 2', dot: '1.5 3', sysDot: '1.5 1.5', lgDash: '12 4', dashDot: '8 3 1.5 3' }[pd] || '6 3';
    head = kid(ln, 'headEnd')?.getAttribute('type'); tail = kid(ln, 'tailEnd')?.getAttribute('type');
  }
  if (none || !color || (!ln && !ref)) return null;
  return { w: Math.max(w, .5), color, dash, head: head && head !== 'none' ? head : null, tail: tail && tail !== 'none' ? tail : null };
}

/* ------------------------------------------------------------------ text */
function fontFamily(name, ctx) {
  if (!name) return null;
  if (name === '+mj-lt') name = ctx.theme.fonts.major; else if (name === '+mn-lt') name = ctx.theme.fonts.minor;
  return `"${name}", ${/calibri/i.test(name) ? 'Carlito, ' : ''}${/cambria/i.test(name) ? 'Caladea, ' : ''}Arial, "Noto Sans", sans-serif`;
}
function textBody(tx, ctx, sc, opt) {
  const { lists, phColor, fontRefColor, box, cell } = opt;
  const bp = kid(tx, 'bodyPr');
  const ins = { l: (num(bp, 'lIns', 91440)) / EMU, t: num(bp, 'tIns', 45720) / EMU, r: num(bp, 'rIns', 91440) / EMU, b: num(bp, 'bIns', 45720) / EMU };
  const fs = kid(bp, 'normAutofit'), scale = fs && fs.hasAttribute('fontScale') ? num(fs, 'fontScale') / 100000 : 1, lnRed = fs && fs.hasAttribute('lnSpcReduction') ? num(fs, 'lnSpcReduction') / 100000 : 0;
  const anchor = bp?.getAttribute('anchor') || 't', vert = bp?.getAttribute('vert');
  const wrap = bp?.getAttribute('wrap') !== 'none';
  const root = h('div', { class: 'ptext', style: `padding:${ins.t}px ${ins.r}px ${ins.b}px ${ins.l}px;justify-content:${anchor === 'ctr' ? 'center' : anchor === 'b' ? 'flex-end' : 'flex-start'};${wrap ? '' : 'white-space:nowrap;'}${vert && vert !== 'horz' ? `writing-mode:${vert === 'vert270' ? 'vertical-rl;transform:rotate(180deg)' : 'vertical-rl'};` : ''}` });
  let counters = [];
  for (const p of kids(tx, 'p')) {
    const pPr = kid(p, 'pPr'), lvl = num(pPr, 'lvl', 0);
    const props = mergeP(levelProps(lists, lvl, ctx, phColor), parsePPr(pPr, ctx, phColor));
    const base = { ...props.def };
    const baseSize = (base.sz ? +base.sz / 100 : 18) * scale;
    const para = h('div', { class: 'ppara' });
    const marL = num({ getAttribute: () => props.marL }, 'x', 0) / EMU, indent = num({ getAttribute: () => props.indent }, 'x', 0) / EMU;
    para.style.paddingLeft = marL + 'px'; para.style.textIndent = indent + 'px';
    para.style.textAlign = { l: 'left', ctr: 'center', r: 'right', just: 'justify', dist: 'justify' }[props.algn] || 'left';
    const ls = props.lnSpc;
    para.style.lineHeight = ls ? (ls.pct ? String(Math.max(.5, (ls.pct - lnRed) * 1.2)) : `${ls.pts * K}px`) : '1.2';
    const sp = s => s ? (s.pts != null ? s.pts * K : s.pct * baseSize * K) : 0;
    para.style.marginTop = sp(props.spcBef) + 'px'; para.style.marginBottom = sp(props.spcAft) + 'px';
    const hasText = [...p.children].some(c => ['r', 'fld', 'br'].includes(c.localName) && (c.localName !== 'r' || kid(c, 't')?.textContent));
    // bullets (only for paragraphs that have text)
    if (hasText && !props.buNone && (props.buChar || props.buAuto)) {
      let label = props.buChar;
      if (props.buAuto) { counters.length = lvl + 1; counters[lvl] = (counters[lvl] ?? props.buAuto.start - 1) + 1; label = (NUM_FMT[props.buAuto.type] || (n => n + '.'))(counters[lvl]); }
      else counters.length = lvl;
      const hang = Math.max(-indent, 0);
      const bu = h('span', { class: 'pbu', style: `display:inline-block;width:${hang || 18}px;text-indent:0;margin-left:${hang ? 0 : 0}px;${props.buClr ? `color:${css(props.buClr)};` : ''}${props.buFont && /wingdings|symbol/i.test(props.buFont) ? '' : props.buFont ? `font-family:${fontFamily(props.buFont, ctx)};` : ''}${props.buSz ? `font-size:${props.buSz * 100}%;` : ''}` }, label === '§' || label === '' ? '▪' : label === 'Ø' ? '➢' : label === 'ü' ? '✓' : label);
      para.append(bu);
    } else if (hasText) counters.length = Math.min(counters.length, lvl);
    let last = null;
    for (const c of p.children) {
      if (c.localName === 'br') { para.append(h('br')); continue; }
      if (c.localName !== 'r' && c.localName !== 'fld') continue;
      const rp = { ...base, ...parseRPr(kid(c, 'rPr'), ctx, phColor) };
      let text = kid(c, 't')?.textContent ?? '';
      if (c.localName === 'fld' && /slidenum/i.test(c.getAttribute('type') || '')) text = String(ctx.slideNo);
      const size = (rp.sz ? +rp.sz / 100 : 18) * scale;
      const col = rp.color || fontRefColor || (opt.defaultColor);
      const st = [`font-size:${size * K}px`];
      if (col) st.push(`color:${css(col)}`);
      if (rp.b === '1') st.push('font-weight:700'); if (rp.i === '1') st.push('font-style:italic');
      const dec = []; if (rp.u && rp.u !== 'none') dec.push('underline'); if (rp.strike && rp.strike !== 'noStrike') dec.push('line-through'); if (rp.link && !rp.u) dec.push('underline'); if (dec.length) st.push(`text-decoration:${dec.join(' ')}`);
      const ff = fontFamily(rp.font || (opt.defaultFont), ctx) || fontFamily('+mn-lt', ctx); st.push(`font-family:${ff}`);
      if (rp.cap === 'all') st.push('text-transform:uppercase'); else if (rp.cap === 'small') st.push('font-variant:small-caps');
      if (rp.spc) st.push(`letter-spacing:${+rp.spc / 100 * K}px`);
      if (rp.baseline && +rp.baseline) st.push(`vertical-align:${+rp.baseline > 0 ? 'super' : 'sub'};font-size:${size * K * .65}px`);
      if (rp.highlight) st.push(`background:${css(rp.highlight)}`);
      para.append(h('span', { style: st.join(';') }, text));
      last = rp;
    }
    if (!para.childNodes.length || !hasText) {              // empty paragraph keeps its height
      const e = parseRPr(kid(p, 'endParaRPr'), ctx, phColor), size = ((e.sz || base.sz) ? +(e.sz || base.sz) / 100 : 18) * scale;
      para.append(h('span', { style: `font-size:${size * K}px;font-family:${fontFamily(base.font, ctx) || fontFamily('+mn-lt', ctx)}` }, '​'));
    }
    root.append(para);
  }
  return root;
}

/* ------------------------------------------------------------------ shapes */
async function shape(el, ctx, sc) {
  const n = el.localName;
  if (n === 'AlternateContent') { const f = kid(el, 'Fallback') || kid(el, 'Choice'); const out = []; if (f) for (const c of f.children) { const s = await shape(c, ctx, sc); if (s) out.push(s); } const w = h('div', { style: 'display:contents' }); w.append(...out); return w; }
  if (!['sp', 'pic', 'cxnSp', 'grpSp', 'graphicFrame'].includes(n)) return null;
  const ph = phOf(el);
  if (sc.onlyDeco && ph) return null;                        // master/layout placeholders are only prompts
  if (el.getAttribute('hidden') === '1' || kid(kid(el, 'nvSpPr') || kid(el, 'nvPicPr') || kid(el, 'nvGrpSpPr') || kid(el, 'nvGraphicFramePr') || kid(el, 'nvCxnSpPr'), 'cNvPr')?.getAttribute('hidden') === '1') return null;
  let lay = null, mas = null;
  if (ph && sc.slide) { lay = findPh(sc.layoutShapes, ph); mas = findPh(sc.masterShapes, ph); }
  let t = xfrmOf(el) || (lay && xfrmOf(lay)) || (mas && xfrmOf(mas));
  if (!t) return null;
  const wrap = h('div', { class: 'ps', style: `left:${t.x}px;top:${t.y}px;width:${t.w}px;height:${t.h}px${t.rot ? `;transform:rotate(${t.rot}deg)` : ''}` });

  if (n === 'grpSp') {
    const co = t.chOff, ce = t.chExt, cw = num(ce, 'cx') / EMU || t.w, chh = num(ce, 'cy') / EMU || t.h, ox = num(co, 'x') / EMU, oy = num(co, 'y') / EMU;
    const inner = h('div', { class: 'pgroup', style: `width:${cw}px;height:${chh}px;transform:scale(${t.w / cw || 1},${t.h / chh || 1}) translate(${-ox}px,${-oy}px);transform-origin:0 0;left:${ox}px;top:${oy}px` });
    // children are laid out in the child coordinate space, so the inner box starts at the child origin
    inner.style.left = '0'; inner.style.top = '0'; inner.style.transform = `scale(${t.w / cw || 1},${t.h / chh || 1})`;
    const cscope = { ...sc, target: inner, off: [ox, oy] };
    for (const c of el.children) { const s = await shape(c, ctx, { ...cscope, shift: [ox, oy] }); if (s) { if (sc && cscope.shift) { s.style.marginLeft = -ox + 'px'; s.style.marginTop = -oy + 'px'; } inner.append(s); } }
    wrap.append(inner);
    if (t.fx || t.fy) wrap.style.transform = `${wrap.style.transform || ''} scale(${t.fx ? -1 : 1},${t.fy ? -1 : 1})`;
    return wrap;
  }
  if (n === 'graphicFrame') return await frame(el, wrap, t, ctx, sc);

  const spPr = kid(el, 'spPr'), style = kid(el, 'style');
  const fillRef = kid(style, 'fillRef'), refCol = fillRef ? colorOf(fillRef, ctx) : null;
  let fill = spPr ? await fillStyle(spPr, ctx, refCol, sc) : undefined;
  if (!fill && fillRef && num(fillRef, 'idx') > 0 && refCol) { const base = ctx.theme.fillStyles[num(fillRef, 'idx') - 1]; fill = base ? await fillStyle({ children: [base] }, ctx, refCol, sc) : { type: 'solid', color: refCol }; }
  if (!fill && lay) { const ls = kid(lay, 'spPr'); if (ls) fill = await fillStyle(ls, ctx, null, sc); }
  const line = lineStyle(spPr, style, ctx) || (lay && lineStyle(kid(lay, 'spPr'), null, ctx));
  const geom = kid(spPr, 'prstGeom'), cust = kid(spPr, 'custGeom');
  const prst = geom?.getAttribute('prst') || (n === 'cxnSp' ? 'line' : 'rect');
  const adj = {}; for (const g of kids(kid(geom, 'avLst'), 'gd')) adj[g.getAttribute('name')] = +/-?\d+/.exec(g.getAttribute('fmla') || '')?.[0];
  const flip = (t.fx || t.fy) ? `transform:scale(${t.fx ? -1 : 1},${t.fy ? -1 : 1})` : '';

  if (n === 'pic') {
    const bf = kid(el, 'blipFill'), blip = kid(bf, 'blip');
    const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
    const svgId = [...(blip?.getElementsByTagNameNS('*', 'svgBlip') || [])][0]?.getAttributeNS(R, 'embed');
    const rid = blip?.getAttributeNS(R, 'embed') || blip?.getAttribute('r:embed');
    const target = (svgId && sc.rels.get(svgId)?.target) || (rid && sc.rels.get(rid)?.target);
    const url = target && await ctx.imageUrl(target);
    const clip = h('div', { class: 'ppic', style: `${flip}` });
    if (prst === 'ellipse') clip.style.borderRadius = '50%'; else if (prst === 'roundRect') clip.style.borderRadius = Math.min(t.w, t.h) * Math.min(adj.adj ?? 16667, 50000) / 100000 + 'px';
    if (url) {
      const sr = kid(bf, 'srcRect'), l = num(sr, 'l') / 100000, tp = num(sr, 't') / 100000, r = num(sr, 'r') / 100000, b = num(sr, 'b') / 100000;
      const iw = t.w / (1 - l - r || 1), ih = t.h / (1 - tp - b || 1);
      const img = h('img', { src: url, alt: '', draggable: 'false', style: `width:${iw}px;height:${ih}px;left:${-l * iw}px;top:${-tp * ih}px` });
      const am = kid(blip, 'alphaModFix'); if (am) img.style.opacity = num(am, 'amt') / 100000;
      if (kid(blip, 'grayscl')) img.style.filter = 'grayscale(1)';
      clip.append(img);
    } else if (target) clip.append(h('div', { class: 'pmissing' }, '🖼'));
    wrap.append(clip);
    if (line) wrap.style.boxShadow = `inset 0 0 0 ${line.w}px ${css(line.color)}`;
    return wrap;
  }

  // geometry (SVG)
  const needSvg = cust || fill?.type === 'solid' || fill?.type === 'grad' || line || fill?.type === 'blip';
  if (needSvg) {
    const open = OPEN_SHAPES.has(prst) && !cust;
    const d = cust ? custPath(cust, t.w, t.h) : (PRESETS[prst] || PRESETS.rect)(t.w, t.h, adj);
    const svg = svgEl('svg', { width: t.w, height: t.h, viewBox: `0 0 ${t.w} ${t.h}`, class: 'pgeom', style: `width:${t.w}px;height:${t.h}px;${flip}`, overflow: 'visible' });
    const defs = svgEl('defs'); svg.append(defs);
    const gid = 'g' + Math.random().toString(36).slice(2, 8);
    let fillAttr = open ? 'none' : 'none';
    if (!open && fill?.type === 'solid') fillAttr = css(fill.color);
    else if (!open && fill?.type === 'grad' && fill.stops.length) {
      const ang = (fill.angle || 0) * Math.PI / 180;
      const g = fill.radial ? svgEl('radialGradient', { id: gid }) : svgEl('linearGradient', { id: gid, x1: .5 - Math.cos(ang) / 2, y1: .5 - Math.sin(ang) / 2, x2: .5 + Math.cos(ang) / 2, y2: .5 + Math.sin(ang) / 2 });
      for (const s of fill.stops) g.append(svgEl('stop', { offset: s.pos + '%', 'stop-color': css({ ...s.color, a: 1 }), 'stop-opacity': s.color.a }));
      defs.append(g); fillAttr = `url(#${gid})`;
    } else if (!open && fill?.type === 'blip') {
      defs.append(svgEl('clipPath', { id: gid }, svgEl('path', { d })));
      svg.append(svgEl('image', { href: fill.url, width: t.w, height: t.h, preserveAspectRatio: 'xMidYMid slice', 'clip-path': `url(#${gid})` })); fillAttr = 'none';
    }
    const p = svgEl('path', { d, fill: fillAttr, 'fill-rule': 'evenodd' });
    if (line) {
      p.setAttribute('stroke', css({ ...line.color, a: 1 })); p.setAttribute('stroke-width', line.w); if (line.color.a < 1) p.setAttribute('stroke-opacity', line.color.a); if (line.dash) p.setAttribute('stroke-dasharray', line.dash);
      const mk = (id, end) => { if (!end) return; const m = svgEl('marker', { id, markerWidth: 6, markerHeight: 6, refX: 3, refY: 3, orient: 'auto-start-reverse', markerUnits: 'strokeWidth' }, svgEl('path', { d: end === 'oval' ? 'M3 0a3 3 0 1 0 .01 0Z' : 'M0 0L6 3L0 6Z', fill: css({ ...line.color, a: 1 }) })); defs.append(m); return `url(#${id})`; };
      const a = mk(gid + 'h', line.head), b2 = mk(gid + 't', line.tail); if (a) p.setAttribute('marker-start', a); if (b2) p.setAttribute('marker-end', b2);
    }
    svg.append(p); wrap.append(svg);
  }
  const tx = kid(el, 'txBody');
  if (tx && kid(tx, 'p')) {
    const lists = [];
    const phType = ph?.getAttribute('type') || (ph ? 'body' : null);
    const ts = sc.txStyles;
    if (ph) lists.push(kid(ts, ['title', 'ctrTitle'].includes(phType) ? 'titleStyle' : ['dt', 'ftr', 'sldNum'].includes(phType) ? 'otherStyle' : 'bodyStyle'));
    else if (sc.slide) lists.push(sc.defaultText || kid(ts, 'otherStyle'));
    else lists.push(kid(ts, 'otherStyle'));
    if (mas) lists.push(kid(kid(mas, 'txBody'), 'lstStyle'));
    if (lay) lists.push(kid(kid(lay, 'txBody'), 'lstStyle'));
    lists.push(kid(tx, 'lstStyle'));
    const fontRef = kid(style, 'fontRef'), fontCol = fontRef ? colorOf(fontRef, ctx) : null;
    const defaultColor = { r: 0, g: 0, b: 0, a: 1 }, tx1 = ctx.theme.colors[ctx.clrMap.tx1 || 'dk1'];
    const bodyLayoutBp = lay && kid(kid(lay, 'txBody'), 'bodyPr');
    let node = textBody(tx, ctx, sc, { lists, fontRefColor: fontCol, defaultColor: tx1 ? { r: hex2(tx1)[0], g: hex2(tx1)[1], b: hex2(tx1)[2], a: 1 } : defaultColor });
    if (bodyLayoutBp && !kid(tx, 'bodyPr')?.attributes.length) { const a = bodyLayoutBp.getAttribute('anchor'); if (a) node.style.justifyContent = a === 'ctr' ? 'center' : a === 'b' ? 'flex-end' : 'flex-start'; }
    wrap.append(node);
  }
  return wrap;
}

/* ------------------------------------------------------------------ tables, charts, SmartArt */
async function frame(el, wrap, t, ctx, sc) {
  const gd = path(el, 'graphic', 'graphicData'), uri = gd?.getAttribute('uri') || '';
  const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  if (uri.endsWith('/table')) { wrap.append(table(kid(gd, 'tbl'), t, ctx, sc)); return wrap; }
  if (uri.endsWith('/chart')) {
    const c = kid(gd, 'chart'), part = sc.rels.get(c?.getAttributeNS(R, 'id') || c?.getAttribute('r:id'))?.target;
    if (part) { try { wrap.append(chartSvg((await ctx.load(part)).x, t.w, t.h, ctx)); } catch (e) { console.warn(e); } }
    return wrap;
  }
  if (uri.endsWith('/diagram')) {
    const rel = kid(gd, 'relIds'), dm = sc.rels.get(rel?.getAttributeNS(R, 'dm') || rel?.getAttribute('r:dm'))?.target;
    let drawing = null;
    if (dm && ctx.z.has(dm)) { const ext = (await ctx.load(dm)).x.getElementsByTagNameNS('*', 'dataModelExt')[0]; drawing = ext && sc.rels.get(ext.getAttribute('relId'))?.target; }
    drawing ||= [...sc.rels.values()].find(r => r.type === 'diagramDrawing')?.target;
    if (drawing && ctx.z.has(drawing)) {
      const D = await ctx.load(drawing), inner = h('div', { class: 'pgroup', style: `width:${t.w}px;height:${t.h}px` });
      const tree = D.x.getElementsByTagNameNS('*', 'spTree')[0];
      for (const c of tree ? tree.children : []) { const s = await shape(c, ctx, { ...sc, rels: D.rels, slide: false, layoutShapes: [], masterShapes: [], target: inner }); if (s) inner.append(s); }
      wrap.append(inner);
    }
    return wrap;
  }
  return wrap;                                                // video/ole etc: nothing to draw
}
function table(tbl, t, ctx, sc) {
  const grid = kids(kid(tbl, 'tblGrid'), 'gridCol').map(g => num(g, 'w') / EMU);
  const pr = kid(tbl, 'tblPr'), flags = { first: pr?.getAttribute('firstRow') === '1', band: pr?.getAttribute('bandRow') === '1', last: pr?.getAttribute('lastRow') === '1', firstCol: pr?.getAttribute('firstCol') === '1' };
  const styleId = kid(pr, 'tableStyleId')?.textContent, styles = {};
  if (styleId && sc.tableStyles !== false) {
    const root = ctx.tableStylesDoc;
    const st = root && [...root.getElementsByTagNameNS('*', 'tblStyle')].find(s => s.getAttribute('styleId') === styleId);
    if (st) for (const part of st.children) { const tcs = kid(part, 'tcStyle'), tcTx = kid(part, 'tcTxStyle'); styles[part.localName] = { fill: tcs && kid(kid(tcs, 'fill'), 'solidFill') ? colorOf(kid(kid(tcs, 'fill'), 'solidFill'), ctx) : null, bold: tcTx?.getAttribute('b') === 'on', color: tcTx ? colorOf(tcTx, ctx) : null, bd: tcs && kid(tcs, 'tcBdr') }; }
  }
  const tb = h('table', { class: 'ptable', style: `width:${t.w}px` }, h('colgroup', {}, grid.map(w => h('col', { style: `width:${w}px` }))));
  const rows = kids(tbl, 'tr'), body = h('tbody', {});
  const rowspans = [];
  rows.forEach((tr, ri) => {
    const row = h('tr', { style: `height:${num(tr, 'h') / EMU}px` });
    let ci = 0;
    for (const tc of kids(tr, 'tc')) {
      if (tc.getAttribute('hMerge') === '1' || tc.getAttribute('vMerge') === '1') { ci++; continue; }
      const tcPr = kid(tc, 'tcPr'), part = flags.first && ri === 0 ? styles.firstRow : flags.last && ri === rows.length - 1 ? styles.lastRow : flags.band ? (ri % 2 ? styles.band2H : styles.band1H) : null;
      const st = [];
      const own = tcPr && kid(tcPr, 'solidFill') ? colorOf(kid(tcPr, 'solidFill'), ctx) : null;
      const fill = own || part?.fill || styles.wholeTbl?.fill; if (fill) st.push(`background:${css(fill)}`);
      const bdr = side => { const ln = tcPr && kid(tcPr, 'ln' + side); if (ln && kid(ln, 'solidFill')) return `${Math.max(1, num(ln, 'w', 12700) / EMU)}px solid ${css(colorOf(kid(ln, 'solidFill'), ctx))}`; if (ln && kid(ln, 'noFill')) return 'none'; return null; };
      for (const [s, n] of [['L', 'left'], ['R', 'right'], ['T', 'top'], ['B', 'bottom']]) { const b = bdr(s); if (b) st.push(`border-${n}:${b}`); }
      const anchor = tcPr?.getAttribute('anchor'); st.push(`vertical-align:${anchor === 'ctr' ? 'middle' : anchor === 'b' ? 'bottom' : 'top'}`);
      st.push(`padding:${num(tcPr, 'marT', 45720) / EMU}px ${num(tcPr, 'marR', 91440) / EMU}px ${num(tcPr, 'marB', 45720) / EMU}px ${num(tcPr, 'marL', 91440) / EMU}px`);
      const tx = kid(tc, 'txBody');
      const td = h('td', { style: st.join(';'), colspan: num(tc, 'gridSpan', 1) > 1 ? num(tc, 'gridSpan') : null, rowspan: num(tc, 'rowSpan', 1) > 1 ? num(tc, 'rowSpan') : null });
      if (tx) {
        const tx1 = ctx.theme.colors[ctx.clrMap.tx1 || 'dk1'], base = part?.color || (tx1 ? { r: hex2(tx1)[0], g: hex2(tx1)[1], b: hex2(tx1)[2], a: 1 } : null);
        const node = textBody(tx, ctx, sc, { lists: [kid(ctx.defaultTextEl, 'lvl1pPr') ? ctx.defaultTextEl : null], defaultColor: base });
        node.style.padding = '0'; node.style.display = 'block'; if (part?.bold) node.style.fontWeight = '700';
        td.append(node);
      }
      row.append(td); ci += num(tc, 'gridSpan', 1);
    }
    body.append(row);
  });
  tb.append(body);
  return tb;
}

/** Simple charts (bar/column, line, area, pie, doughnut) drawn from the values stored in the file. */
function chartSvg(doc, w, h2, ctx) {
  const plot = doc.getElementsByTagNameNS('*', 'plotArea')[0];
  const types = ['barChart', 'bar3DChart', 'lineChart', 'line3DChart', 'areaChart', 'pieChart', 'pie3DChart', 'doughnutChart'];
  const chart = plot && [...plot.children].find(c => types.includes(c.localName));
  const svg = svgEl('svg', { width: w, height: h2, viewBox: `0 0 ${w} ${h2}`, class: 'pchart', style: `width:${w}px;height:${h2}px;font-family:Arial,sans-serif` });
  if (!chart) return svg;
  const kind = chart.localName.replace('3D', '');
  const palette = ['accent1', 'accent2', 'accent3', 'accent4', 'accent5', 'accent6'].map(n => ctx.theme.colors[n] ? `#${ctx.theme.colors[n]}` : '#888');
  const vals = n => [...n.getElementsByTagNameNS('*', 'pt')].map(p => p.textContent);
  const series = kids(chart, 'ser').map((s, i) => {
    const sp = kid(s, 'spPr'), sf = sp && kid(sp, 'solidFill'), c = sf ? colorOf(sf, ctx) : null;
    return { name: s.getElementsByTagNameNS('*', 'tx')[0]?.textContent.trim() || '', cats: kid(s, 'cat') ? vals(kid(s, 'cat')) : [], v: kid(s, 'val') ? vals(kid(s, 'val')).map(Number) : [], color: c ? css(c) : palette[i % palette.length], dpts: kids(s, 'dPt').map(d => ({ idx: num(kid(d, 'idx'), 'val'), color: kid(kid(d, 'spPr'), 'solidFill') ? css(colorOf(kid(kid(d, 'spPr'), 'solidFill'), ctx)) : null })) };
  });
  if (!series.length) return svg;
  const title = doc.getElementsByTagNameNS('*', 'title')[0]?.textContent.trim(), cats = series[0].cats, legendRight = doc.getElementsByTagNameNS('*', 'legendPos')[0]?.getAttribute('val') === 'r';
  const showVal = chart.getElementsByTagNameNS('*', 'showVal')[0]?.getAttribute('val') === '1';
  const T = (x, y, s, o = {}) => { const e = svgEl('text', { x, y, 'font-size': o.size || 12, 'text-anchor': o.anchor || 'middle', fill: o.fill || '#444', 'font-weight': o.bold ? 700 : 400 }); e.textContent = s; return e; };
  let top = 10, bottom = 10, left = 10, right = 10;
  if (title) { svg.append(T(w / 2, 22, title, { size: 16, bold: true, fill: '#222' })); top = 36; }
  const legendItems = kind === 'pieChart' || kind === 'doughnutChart' ? cats.map((c, i) => ({ name: c, color: series[0].dpts.find(d => d.idx === i)?.color || palette[i % palette.length] })) : series.map(s => ({ name: s.name, color: s.color }));
  if (doc.getElementsByTagNameNS('*', 'legend')[0] && legendItems.length > 0 && (series.length > 1 || kind.startsWith('pie') || kind === 'doughnutChart')) {
    if (legendRight) { right = 130; legendItems.forEach((it, i) => { svg.append(svgEl('rect', { x: w - 120, y: top + 8 + i * 20, width: 10, height: 10, fill: it.color })); svg.append(T(w - 105, top + 17 + i * 20, it.name, { anchor: 'start', size: 11 })); }); }
    else { bottom = 30; let x = 20; legendItems.forEach(it => { svg.append(svgEl('rect', { x, y: h2 - 22, width: 10, height: 10, fill: it.color })); svg.append(T(x + 14, h2 - 13, it.name, { anchor: 'start', size: 11 })); x += 30 + it.name.length * 6.5; }); }
  }
  if (kind === 'pieChart' || kind === 'doughnutChart') {
    const s = series[0], total = s.v.reduce((a, b) => a + Math.max(b, 0), 0) || 1, cx = (left + w - right) / 2, cy = (top + h2 - bottom) / 2, r = Math.min(w - left - right, h2 - top - bottom) / 2 - 6;
    let ang = -Math.PI / 2;
    s.v.forEach((v, i) => {
      const a2 = ang + Math.max(v, 0) / total * Math.PI * 2, big = a2 - ang > Math.PI ? 1 : 0, ir = kind === 'doughnutChart' ? r * .55 : 0;
      const p = [[cx + r * Math.cos(ang), cy + r * Math.sin(ang)], [cx + r * Math.cos(a2), cy + r * Math.sin(a2)], [cx + ir * Math.cos(a2), cy + ir * Math.sin(a2)], [cx + ir * Math.cos(ang), cy + ir * Math.sin(ang)]];
      const d = ir ? `M${p[0]}A${r} ${r} 0 ${big} 1 ${p[1]}L${p[2]}A${ir} ${ir} 0 ${big} 0 ${p[3]}Z` : `M${cx} ${cy}L${p[0]}A${r} ${r} 0 ${big} 1 ${p[1]}Z`;
      svg.append(svgEl('path', { d, fill: s.dpts.find(x => x.idx === i)?.color || palette[i % palette.length], stroke: '#fff', 'stroke-width': 1.5 }));
      if (showVal || true) { const m = (ang + a2) / 2, rr = r * (ir ? .78 : .62); if (v / total > .04) svg.append(T(cx + rr * Math.cos(m), cy + rr * Math.sin(m) + 4, showVal ? String(+v.toFixed(2)) : Math.round(v / total * 100) + '%', { fill: '#fff', size: 12, bold: true })); }
      ang = a2;
    });
    return svg;
  }
  const stacked = chart.getElementsByTagNameNS('*', 'grouping')[0]?.getAttribute('val')?.includes('tacked');
  const horiz = chart.getElementsByTagNameNS('*', 'barDir')[0]?.getAttribute('val') === 'bar';
  const n = Math.max(...series.map(s => s.v.length)), all = series.flatMap(s => s.v);
  const sums = Array.from({ length: n }, (_, i) => series.reduce((a, s) => a + (s.v[i] || 0), 0));
  let max = Math.max(...(stacked ? sums : all), 0), min = Math.min(...all, 0);
  const step = (() => { const raw = (max - min) / 5 || 1, p = 10 ** Math.floor(Math.log10(raw)), f = raw / p; return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * p; })();
  max = Math.ceil(max / step) * step; min = Math.floor(min / step) * step;
  const X0 = left + 40, X1 = w - right, Y0 = top + 6, Y1 = h2 - bottom - 22, sy = v => Y1 - (v - min) / (max - min || 1) * (Y1 - Y0);
  for (let v = min; v <= max + 1e-9; v += step) { svg.append(svgEl('line', { x1: X0, x2: X1, y1: sy(v), y2: sy(v), stroke: '#ddd' })); svg.append(T(X0 - 6, sy(v) + 4, +v.toFixed(4), { anchor: 'end', size: 11 })); }
  const bw = (X1 - X0) / Math.max(n, 1);
  for (let i = 0; i < n; i++) svg.append(T(X0 + bw * (i + .5), Y1 + 16, cats[i] ?? '', { size: 11 }));
  if (kind === 'barChart') {
    const gw = bw * .72, per = stacked ? gw : gw / series.length;
    series.forEach((s, si) => s.v.forEach((v, i) => {
      const base = stacked ? series.slice(0, si).reduce((a, q) => a + (q.v[i] || 0), 0) : 0, x = X0 + bw * i + (bw - gw) / 2 + (stacked ? 0 : si * per);
      const y1 = sy(base + Math.max(v, 0)), y2 = sy(base + Math.min(v, 0) || 0);
      svg.append(svgEl('rect', { x, y: Math.min(sy(base), sy(base + v)), width: per * .92, height: Math.abs(sy(base + v) - sy(base)), fill: s.dpts.find(d => d.idx === i)?.color || s.color }));
      if (showVal) svg.append(T(x + per * .46, Math.min(sy(base), sy(base + v)) - 4, String(+v.toFixed(2)), { size: 11 }));
    }));
  } else {
    series.forEach(s => {
      const pts = s.v.map((v, i) => [X0 + bw * (i + .5), sy(v)]);
      if (kind === 'areaChart') svg.append(svgEl('path', { d: `M${pts[0][0]} ${sy(0)}L${pts.map(p => p.join(' ')).join('L')}L${pts[pts.length - 1][0]} ${sy(0)}Z`, fill: s.color, 'fill-opacity': .55 }));
      svg.append(svgEl('path', { d: 'M' + pts.map(p => p.join(' ')).join('L'), fill: 'none', stroke: s.color, 'stroke-width': 2.5, 'stroke-linejoin': 'round' }));
      pts.forEach((p, i) => { svg.append(svgEl('circle', { cx: p[0], cy: p[1], r: 3.5, fill: s.color })); if (showVal) svg.append(T(p[0], p[1] - 8, String(+s.v[i].toFixed(2)), { size: 11 })); });
    });
  }
  return svg;
}
