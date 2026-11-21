// Appearance: theme, accent colour (applied to UI, logo, favicon), text size.
import { ls } from './dom.js';

export const DEFAULT_ACCENT = '#0e8f7e';
export const ACCENTS = ['#0e8f7e', '#2f7de1', '#5b6cf0', '#8b5cf6', '#e0457b', '#e8672e', '#d99a14', '#3da35d'];
export const prefs = { theme: 'auto', accent: DEFAULT_ACCENT, size: 16, poll: 120, ...ls.get('prefs', {}) };
// v1 prefs saved the old default purple; move those to the new default (a deliberately chosen colour is kept).
if (!prefs.v) { if (prefs.accent === '#6d5ae6') prefs.accent = DEFAULT_ACCENT; prefs.v = 2; ls.set('prefs', prefs); }
export const savePrefs = () => ls.set('prefs', prefs);

const rgb = c => [1, 3, 5].map(i => parseInt(c.slice(i, i + 2), 16));
const hex = a => '#' + a.map(v => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('');
const mix = (c, t, k) => hex(rgb(c).map((v, i) => v + (t[i] - v) * k));
function luminance(c) {
  const [r, g, b] = rgb(c).map(v => { v /= 255; return v <= .03928 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; });
  return .2126 * r + .7152 * g + .0722 * b;
}
const contrast = (a, b) => { const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p); return (x + .05) / (y + .05); };

function setFavicon(accent) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${mix(accent, [255, 255, 255], .18)}"/><stop offset="1" stop-color="${mix(accent, [0, 0, 0], .22)}"/></linearGradient></defs><rect width="512" height="512" rx="112" fill="url(#g)"/><path d="M158 104h146l74 74v210a24 24 0 0 1-24 24H158a24 24 0 0 1-24-24V128a24 24 0 0 1 24-24z" fill="#fff"/><path d="M304 104v52a24 24 0 0 0 24 24h50z" fill="${mix(accent, [255, 255, 255], .75)}"/><rect x="176" y="224" width="160" height="16" rx="8" fill="${accent}"/><rect x="176" y="272" width="160" height="16" rx="8" fill="${mix(accent, [255, 255, 255], .5)}"/><rect x="176" y="320" width="104" height="16" rx="8" fill="${mix(accent, [255, 255, 255], .5)}"/></svg>`;
  document.querySelector('link[rel=icon]').href = 'data:image/svg+xml,' + encodeURIComponent(svg);
}

export function applyPrefs() {
  const r = document.documentElement;
  if (prefs.theme === 'auto') r.removeAttribute('data-theme'); else r.dataset.theme = prefs.theme;
  const a = /^#[0-9a-f]{6}$/i.test(prefs.accent) ? prefs.accent : DEFAULT_ACCENT;
  r.style.setProperty('--accent', a);
  r.style.setProperty('--accent-fg', contrast(a, '#ffffff') >= 3.6 ? '#ffffff' : '#1a1a1d');
  r.style.setProperty('--ed-size', prefs.size + 'px');
  setFavicon(a);
  requestAnimationFrame(() => document.querySelector('meta[name=theme-color]').content = getComputedStyle(document.body).backgroundColor);
}
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyPrefs);
