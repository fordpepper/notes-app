// Appearance: Material 3 style colour palettes generated from seed colours, plus layout preferences.
// A palette = up to three seed colours (primary, secondary, tertiary). From each seed we build tonal steps
// (OKLCH, so lightness is perceptually even) and map them onto the Material colour roles for light, dark and black.
import { ls } from './dom.js';

export const PALETTES = {
  teal:     { name: 'Teal',     seeds: ['#0e8f7e'] },
  blue:     { name: 'Blue',     seeds: ['#1a73e8'] },
  indigo:   { name: 'Indigo',   seeds: ['#5b6cf0'] },
  violet:   { name: 'Violet',   seeds: ['#8b5cf6'] },
  rose:     { name: 'Rose',     seeds: ['#e0457b'] },
  orange:   { name: 'Sunset',   seeds: ['#e8672e'] },
  amber:    { name: 'Amber',    seeds: ['#d99a14'] },
  green:    { name: 'Forest',   seeds: ['#3da35d'] },
  ocean:    { name: 'Ocean',    seeds: ['#1a73e8', '#0e8f7e', '#8b5cf6'] },   // multi-seed palettes
  berry:    { name: 'Berry',    seeds: ['#a3366f', '#e8672e', '#5b6cf0'] },
  graphite: { name: 'Graphite', seeds: ['#6b6f76'] },
};
export const VIBRANCE = [['muted', 'Muted', .55], ['normal', 'Balanced', 1], ['vivid', 'Vivid', 1.3]];
export const WIDTHS = [['narrow', 'Narrow', 600], ['normal', 'Comfortable', 680], ['wide', 'Wide', 960], ['full', 'Full', 99999]];
export const FONTS = [['sans', 'Sans'], ['serif', 'Serif'], ['mono', 'Mono']];
export const SPACING = [['tight', 'Tight', 1.42], ['normal', 'Normal', 1.6], ['relaxed', 'Relaxed', 1.82]];
export const SHAPES = [['sharp', 'Sharp', .45], ['normal', 'Rounded', 1], ['soft', 'Extra round', 1.6]];
export const DENSITY = [['comfortable', 'Comfortable'], ['compact', 'Compact']];
/** Parts of the interface that can be hidden: key → label */
export const PARTS = [
  ['search', 'Search bar'], ['actions', 'New folder and upload buttons'], ['icons', 'File and folder icons'],
  ['status', 'Sync status text'], ['stats', 'Word count'], ['toolbar', 'Formatting bar'],
];

const DEFAULTS = { theme: 'auto', palette: 'teal', seeds: ['#0e8f7e', '', ''], vibrance: 'normal', width: 'normal', font: 'sans', spacing: 'normal', shape: 'normal', density: 'comfortable', size: 17, poll: 120, hide: [] };
export const prefs = { ...DEFAULTS, ...ls.get('prefs', {}) };
// migrations: v1 purple default, v2 single accent colour -> palettes, v3 text sizes
if (!prefs.v) { if (prefs.accent === '#6d5ae6') prefs.accent = '#0e8f7e'; prefs.v = 2; }
if (prefs.v < 3) { prefs.size = { 15: 15, 16: 17, 18: 19, 20: 21 }[prefs.size] ?? 17; prefs.v = 3; }
if (prefs.v < 4) {
  const hit = Object.entries(PALETTES).find(([, p]) => p.seeds.length === 1 && p.seeds[0].toLowerCase() === (prefs.accent || '').toLowerCase());
  if (hit) prefs.palette = hit[0]; else if (prefs.accent) { prefs.palette = 'custom'; prefs.seeds = [prefs.accent, '', '']; }
  delete prefs.accent; prefs.v = 4; ls.set('prefs', prefs);
}
export const savePrefs = () => ls.set('prefs', prefs);

/* ---------------- colour maths (OKLCH) ---------------- */
const rgb = c => [1, 3, 5].map(i => parseInt(c.slice(i, i + 2), 16) / 255);
const lin = c => c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4;
const gam = c => c <= .0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - .055;
const hex = a => '#' + a.map(v => Math.round(Math.max(0, Math.min(1, gam(Math.max(0, v)))) * 255).toString(16).padStart(2, '0')).join('');
function toOklch(c) {
  const [r, g, b] = rgb(c).map(lin);
  const l = Math.cbrt(.4122214708 * r + .5363325363 * g + .0514459929 * b), m = Math.cbrt(.2119034982 * r + .6806995451 * g + .1073969566 * b), s = Math.cbrt(.0883024619 * r + .2817188376 * g + .6299787005 * b);
  const A = 1.9779984951 * l - 2.4285922050 * m + .4505937099 * s, B = .0259040371 * l + .7827717662 * m - .8086757660 * s;
  return { C: Math.hypot(A, B), h: Math.atan2(B, A) };
}
function fromOklch(L, C, h) {
  const a = C * Math.cos(h), b = C * Math.sin(h);
  const l = (L + .3963377774 * a + .2158037573 * b) ** 3, m = (L - .1055613458 * a - .0638541728 * b) ** 3, s = (L - .0894841775 * a - 1.2914855480 * b) ** 3;
  return [4.0767416621 * l - 3.3077115913 * m + .2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - .3413193965 * s, -.0041960863 * l - .7034186147 * m + 1.7076147010 * s];
}
const inGamut = c => c.every(v => v >= -.0005 && v <= 1.0005);
/** Colour of hue h / chroma C at Material tone (0 = black, 100 = white); chroma is reduced to fit the screen gamut. */
function tone({ h, C }, t) {
  if (t <= 0) return '#000000';
  if (t >= 100) return '#ffffff';
  const L = Math.cbrt(t > 8 ? ((t + 16) / 116) ** 3 : t / 903.3);
  let lo = 0, hi = C;
  if (inGamut(fromOklch(L, hi, h))) lo = hi; else for (let i = 0; i < 14; i++) { const mid = (lo + hi) / 2; inGamut(fromOklch(L, mid, h)) ? lo = mid : hi = mid; }
  return hex(fromOklch(L, lo, h));
}

/** Seeds → palettes. Missing secondary/tertiary seeds are derived like Material does (same hue muted / hue shifted). */
function palettes(seeds, vibrance) {
  const k = (VIBRANCE.find(v => v[0] === vibrance) || VIBRANCE[1])[2];
  const [p, s, t] = seeds.map(x => /^#[0-9a-f]{6}$/i.test(x || '') ? toOklch(x) : null);
  const base = p || toOklch('#0e8f7e'), mono = base.C < .03;
  const pc = mono ? 0 : Math.min(.22, Math.max(base.C, .12) * k);
  const mk = (seed, fh, fc) => seed ? { h: seed.h, C: seed.C < .03 ? 0 : Math.min(.22, Math.max(seed.C, .08) * k) } : { h: fh, C: fc };
  return {
    primary: { h: base.h, C: pc },
    secondary: mk(s, base.h, pc * .34),
    tertiary: mk(t, base.h + 1.05, pc * .55),
    neutral: { h: base.h, C: mono ? 0 : .007 * Math.min(k, 1.3) },
    variant: { h: base.h, C: mono ? 0 : .014 * Math.min(k, 1.3) },
    error: { h: 0.45, C: .19 },
  };
}
const ROLES = {   // role: [palette, light tone, dark tone]
  primary: ['primary', 40, 80], 'on-primary': ['primary', 100, 20], 'primary-container': ['primary', 90, 30], 'on-primary-container': ['primary', 10, 90],
  secondary: ['secondary', 40, 80], 'on-secondary': ['secondary', 100, 20], 'secondary-container': ['secondary', 90, 30], 'on-secondary-container': ['secondary', 10, 90],
  tertiary: ['tertiary', 40, 80], 'on-tertiary': ['tertiary', 100, 20], 'tertiary-container': ['tertiary', 90, 30], 'on-tertiary-container': ['tertiary', 10, 90],
  error: ['error', 40, 80], 'on-error': ['error', 100, 20], 'error-container': ['error', 90, 30], 'on-error-container': ['error', 10, 90],
  surface: ['neutral', 98, 6], 'surface-lowest': ['neutral', 100, 4], 'surface-low': ['neutral', 96, 10], 'surface-container': ['neutral', 94, 12],
  'surface-high': ['neutral', 92, 17], 'surface-highest': ['neutral', 90, 22],
  'on-surface': ['neutral', 10, 90], 'on-surface-variant': ['variant', 30, 80], outline: ['variant', 50, 60], 'outline-variant': ['variant', 80, 30],
  'inverse-surface': ['neutral', 20, 90], 'inverse-on-surface': ['neutral', 95, 20], 'inverse-primary': ['primary', 80, 40],
};
const BLACK = { surface: 0, 'surface-lowest': 0, 'surface-low': 4, 'surface-container': 8, 'surface-high': 13, 'surface-highest': 18 };

/** CSS custom properties for one mode: 'light' | 'dark' | 'black' */
export function scheme(seeds, vibrance, mode) {
  const P = palettes(seeds, vibrance), dark = mode !== 'light', out = {};
  for (const [role, [pal, l, d]] of Object.entries(ROLES)) {
    const t = dark ? (mode === 'black' && role in BLACK ? BLACK[role] : d) : l, q = P[pal];
    out['--' + role] = tone(role === 'primary' || role.startsWith('on-') && t > 15 && t < 85 ? q : { h: q.h, C: q.C * (t >= 85 ? .5 : t <= 32 && t > 0 ? .8 : 1) }, t);   // pale/deep containers are softer than the key colour
  }
  out['--scrim'] = '#000'; out['--warn'] = dark ? '#f5b84a' : '#9a6700'; out['--ok'] = dark ? '#6dd58c' : '#1b7f3c';
  return out;
}
const css = o => Object.entries(o).map(([k, v]) => `${k}:${v}`).join(';');

export const seedsOf = (p = prefs) => p.palette === 'custom' ? p.seeds : (PALETTES[p.palette] || PALETTES.teal).seeds;
/** Three colours to show on a palette card. */
export function swatch(seeds, vibrance = 'normal') {
  const s = scheme(seeds, vibrance, 'light');
  return [s['--primary'], s['--secondary-container'], s['--tertiary']];
}

function layoutVars() {
  const pick = (list, v) => list.find(x => x[0] === v) || list[1] || list[0];
  const fonts = { sans: 'var(--font)', serif: 'Charter, "Iowan Old Style", Georgia, "Noto Serif", serif', mono: 'var(--mono)' };
  return {
    '--content-w': pick(WIDTHS, prefs.width)[2] + 'px', '--ed-font': fonts[prefs.font] || fonts.sans, '--ed-lh': pick(SPACING, prefs.spacing)[2],
    '--shape': pick(SHAPES, prefs.shape)[2], '--ed-size': prefs.size + 'px', '--row-h': prefs.density === 'compact' ? '30px' : '36px',
  };
}

function setFavicon(primary, container) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" rx="112" fill="${primary}"/><path d="M158 104h146l74 74v210a24 24 0 0 1-24 24H158a24 24 0 0 1-24-24V128a24 24 0 0 1 24-24z" fill="#fff"/><path d="M304 104v52a24 24 0 0 0 24 24h50z" fill="${container}"/><rect x="176" y="224" width="160" height="16" rx="8" fill="${primary}"/><rect x="176" y="272" width="160" height="16" rx="8" fill="${container}"/><rect x="176" y="320" width="104" height="16" rx="8" fill="${container}"/></svg>`;
  document.querySelector('link[rel=icon]').href = 'data:image/svg+xml,' + encodeURIComponent(svg);
}

const dark = matchMedia('(prefers-color-scheme: dark)');
export function applyPrefs() {
  const r = document.documentElement, seeds = seedsOf();
  if (prefs.theme === 'auto') r.removeAttribute('data-theme'); else r.dataset.theme = prefs.theme;
  const mode = prefs.theme === 'auto' ? (dark.matches ? 'dark' : 'light') : prefs.theme;
  const lay = layoutVars(), all = {};
  for (const m of ['light', 'dark', 'black']) all[m] = css({ ...scheme(seeds, prefs.vibrance, m), ...lay });   // cached so the next start paints in the right colours at once
  ls.set('tv', all);
  for (const [k, v] of Object.entries({ ...scheme(seeds, prefs.vibrance, mode), ...lay })) r.style.setProperty(k, v);
  r.style.setProperty('color-scheme', mode === 'light' ? 'light' : 'dark');
  for (const [k] of PARTS) r.classList.toggle('hide-' + k, prefs.hide.includes(k));
  const light = scheme(seeds, prefs.vibrance, 'light');
  setFavicon(light['--primary'], light['--primary-container']);
  const m = document.querySelector('meta[name=theme-color]'); if (m) m.content = r.style.getPropertyValue('--surface');
}
dark.addEventListener('change', () => prefs.theme === 'auto' && applyPrefs());
