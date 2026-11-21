// Modal dialogs and the context menu.
import { h, $ } from './dom.js';
import { icon } from './icons.js';
import * as M from './model.js';

export function modal(build) {
  return new Promise(res => {
    const d = h('dialog', { class: 'modal' });
    const close = v => { res(v); d.close(); };
    d.addEventListener('close', () => { res(null); d.remove(); });
    build(d, close);
    document.body.append(d);
    d.showModal();
  });
}

export function promptText({ title, value = '', label = 'Name', ok = 'OK', body }) {
  return modal((d, close) => {
    const inp = h('input', { value, autocomplete: 'off', spellcheck: 'false', enterkeyhint: 'done' });
    d.append(h('form', { onsubmit: e => { e.preventDefault(); close(inp.value.trim() || null); } },
      h('div', { class: 'mbody' }, h('h3', {}, title), body && h('p', {}, body), h('label', { class: 'field' }, label, inp)),
      h('div', { class: 'mfoot' }, h('button', { type: 'button', class: 'ghost', onclick: () => close(null) }, 'Cancel'), h('button', { class: 'primary' }, ok))));
    setTimeout(() => { inp.focus(); inp.select(); }, 30);
  });
}

export const confirmBox = ({ title, body, ok = 'OK', danger }) => modal((d, close) => d.append(
  h('div', { class: 'mbody' }, h('h3', {}, title), h('p', {}, body)),
  h('div', { class: 'mfoot' }, h('button', { class: 'ghost', onclick: () => close(false) }, 'Cancel'), h('button', { class: danger ? 'danger' : 'primary', onclick: () => close(true) }, ok)))).then(v => !!v);

/** Resolves to a folder path ('' = top level) or null if cancelled. */
export const pickFolder = ({ title, exclude }) => modal((d, close) => {
  const list = h('div', { class: 'folderlist' }, ['', ...M.allDirs()].map(p => {
    const off = exclude && (p === exclude || p.startsWith(exclude + '/'));
    return h('button', { disabled: off, style: `--d:${p ? p.split('/').length : 0}`, onclick: () => close({ path: p }) }, icon('folder'), p ? p.slice(p.lastIndexOf('/') + 1) : 'Top level');
  }));
  d.append(h('div', { class: 'mbody' }, h('h3', {}, title), list), h('div', { class: 'mfoot' }, h('button', { class: 'ghost', onclick: () => close(null) }, 'Cancel')));
}).then(v => v ? v.path : null);

// ---- context menu ----
const menuEl = $('#menu');
export function showMenu(items, x, y, alignRight) {
  menuEl.replaceChildren(...items.map(it => it === '-' ? h('hr') : h('button', { role: 'menuitem', class: it.danger ? 'danger-i' : '', onclick: () => { hideMenu(); it.run(); } }, icon(it.icon), it.label)));
  menuEl.classList.add('show');
  const w = menuEl.offsetWidth, hh = menuEl.offsetHeight;
  menuEl.style.left = Math.max(8, Math.min(alignRight ? x - w : x, innerWidth - w - 8)) + 'px';
  menuEl.style.top = Math.max(8, Math.min(y, innerHeight - hh - 8)) + 'px';
  menuEl.querySelector('button')?.focus({ preventScroll: true });
}
export const hideMenu = () => menuEl.classList.remove('show');
document.addEventListener('pointerdown', e => { if (!menuEl.contains(e.target)) hideMenu(); }, true);
addEventListener('resize', hideMenu);
menuEl.addEventListener('keydown', e => {
  const bs = [...menuEl.querySelectorAll('button')], i = bs.indexOf(document.activeElement);
  if (e.key === 'ArrowDown') { e.preventDefault(); bs[(i + 1) % bs.length].focus(); }
  if (e.key === 'ArrowUp') { e.preventDefault(); bs[(i - 1 + bs.length) % bs.length].focus(); }
});
