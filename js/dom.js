// Tiny DOM + misc helpers shared by the UI modules.
export const $ = s => document.querySelector(s);

export function h(tag, props, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat()) if (c != null && c !== false) e.append(c.nodeType ? c : document.createTextNode(c));
  return e;
}
export const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
export const ls = {
  get: (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
  set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage full/blocked */ } },
};
export const stamp = () => { const d = new Date(), p = n => String(n).padStart(2, '0'); return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`; };
export const mdUrl = p => p.split('/').map(encodeURIComponent).join('/').replace(/\(/g, '%28').replace(/\)/g, '%29');
export const fmtSize = n => n < 1024 ? n + ' B' : n < 1048576 ? (n / 1024).toFixed(0) + ' KB' : (n / 1048576).toFixed(1) + ' MB';
export const wait = ms => new Promise(r => setTimeout(r, ms));

let toastT;
/** Brief message at the bottom; optionally with one action button (e.g. Undo). */
export function toast(msg, { action, onAction, ms } = {}) {
  const t = $('#toast');
  t.replaceChildren(msg);
  t.classList.toggle('has-action', !!action);
  if (action) t.append(h('button', { onclick: () => { t.classList.remove('show'); onAction(); } }, action));
  t.classList.add('show');
  clearTimeout(toastT);
  toastT = setTimeout(() => t.classList.remove('show'), ms ?? (action ? 7000 : 2800));
}
