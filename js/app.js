import * as M from './model.js';
import * as G from './sync.js';
import * as U from './util.js';
import { marked } from '../vendor/marked.js';
import DOMPurify from '../vendor/purify.js';

/* ---------------------------------------------------------------- helpers */
const $ = s => document.querySelector(s);
const h = (tag, props, ...kids) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (k === 'style') e.setAttribute('style', v);
    else e.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat()) if (c != null && c !== false) e.append(c.nodeType ? c : document.createTextNode(c));
  return e;
};
const ICONS = {
  file: '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/>',
  note: '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4M10 9H8M16 13H8M16 17H8"/>',
  image: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.1-3.1a2 2 0 0 0-2.8 0L6 21"/>',
  folder: '<path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.7-.9l-.8-1.2A2 2 0 0 0 7.9 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/>',
  folderPlus: '<path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.7-.9l-.8-1.2A2 2 0 0 0 7.9 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/><path d="M12 10v6M9 13h6"/>',
  chev: '<path d="m9 18 6-6-6-6"/>',
  plus: '<path d="M5 12h14M12 5v14"/>',
  upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/>',
  sync: '<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8M21 3v5h-5M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16M8 16H3v5"/>',
  sliders: '<path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6"/>',
  search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
  menu: '<path d="M4 12h16M4 6h16M4 18h16"/>',
  more: '<circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/>',
  star: '<path d="m12 2 3.1 6.3 6.9 1-5 4.9 1.2 6.9-6.2-3.3-6.2 3.3L7 14.2 2 9.3l6.9-1z"/>',
  clip: '<path d="m21.4 11.1-9.2 9.2a6 6 0 0 1-8.5-8.5l8.6-8.6a4 4 0 1 1 5.7 5.7l-8.6 8.6a2 2 0 0 1-2.8-2.8l8.5-8.5"/>',
  bold: '<path d="M6 12h9a4 4 0 0 1 0 8H7a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h7a4 4 0 0 1 0 8"/>',
  italic: '<path d="M19 4h-9M14 20H5M15 4 9 20"/>',
  heading: '<path d="M6 12h12M6 20V4M18 20V4"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
  check: '<path d="m9 11 3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>',
  quote: '<path d="M3 21c3 0 7-1 7-8V5c0-1.25-.76-2-2-2H4c-1.25 0-2 .75-2 2v6c0 1.25.75 2 2 2 1 0 1 0 1 1v1c0 1-1 2-2 2s-1 0-1 1z"/><path d="M15 21c3 0 7-1 7-8V5c0-1.25-.76-2-2-2h-4c-1.25 0-2 .75-2 2v6c0 1.25.75 2 2 2h.75c0 2.25.25 4-2.75 4v3z"/>',
  code: '<path d="m16 18 6-6-6-6M8 6l-6 6 6 6"/>',
  link: '<path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/>',
  trash: '<path d="M3 6h18M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/>',
  pencil: '<path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/>',
  eye: '<path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/>',
  columns: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M12 3v18"/>',
  move: '<path d="M5 9l-3 3 3 3M9 5l3-3 3 3M15 19l-3 3-3-3M19 9l3 3-3 3M2 12h20M12 2v20"/>',
  copy: '<rect x="8" y="8" width="14" height="14" rx="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
};
const icon = (n, cls) => { const t = document.createElement('template'); t.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"${cls ? ` class="${cls}"` : ''}>${ICONS[n]}</svg>`; return t.content.firstChild; };
const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
const ls = { get: (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } }, set: (k, v) => localStorage.setItem(k, JSON.stringify(v)) };
const stamp = () => new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14).replace(/^(\d{8})/, '$1-');
const mdUrl = p => p.split('/').map(encodeURIComponent).join('/').replace(/\(/g, '%28').replace(/\)/g, '%29');
const fmtSize = n => n < 1024 ? n + ' B' : n < 1048576 ? (n / 1024).toFixed(0) + ' KB' : (n / 1048576).toFixed(1) + ' MB';

let toastT;
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), 2800); }

/* ---------------------------------------------------------------- state */
const S = {
  current: null, dir: '', mode: ls.get('mode', 'split'),
  expanded: new Set(ls.get('expanded', [])), q: '',
  kind: null, shownSha: null,
};
const prefs = { theme: 'auto', accent: '#6d5ae6', ...ls.get('prefs', {}) };
const ed = $('#ed'), pane = $('#pane'), preview = $('#preview'), titleEl = $('#title');
const wide = matchMedia('(min-width: 980px)');
let dirtyEd = false;

function applyPrefs() {
  const r = document.documentElement;
  if (prefs.theme === 'auto') r.removeAttribute('data-theme'); else r.dataset.theme = prefs.theme;
  r.style.setProperty('--accent', prefs.accent);
  const lum = c => { const n = parseInt(c.slice(1), 16); return ((n >> 16) * .299 + ((n >> 8) & 255) * .587 + (n & 255) * .114); };
  r.style.setProperty('--accent-fg', lum(prefs.accent) > 175 ? '#1a1a1d' : '#fff');
  requestAnimationFrame(() => $('meta[name=theme-color]').content = getComputedStyle(document.body).backgroundColor);
}
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyPrefs);

/* ---------------------------------------------------------------- dialogs */
function modal(build) {
  return new Promise(res => {
    const d = h('dialog', { class: 'modal' });
    const close = v => { res(v); d.close(); };
    d.addEventListener('close', () => { res(null); d.remove(); });
    build(d, close);
    document.body.append(d);
    d.showModal();
  });
}
function promptText({ title, value = '', label = 'Name', ok = 'OK', body }) {
  return modal((d, close) => {
    const inp = h('input', { value, autocomplete: 'off', spellcheck: 'false', enterkeyhint: 'done' });
    const f = h('form', { method: 'dialog', onsubmit: e => { e.preventDefault(); close(inp.value.trim() || null); } },
      h('div', { class: 'mbody' }, h('h3', {}, title), body && h('p', {}, body), h('label', { class: 'field' }, label, inp)),
      h('div', { class: 'mfoot' }, h('button', { type: 'button', class: 'ghost', onclick: () => close(null) }, 'Cancel'), h('button', { class: 'primary' }, ok)));
    d.append(f);
    setTimeout(() => { inp.focus(); const dot = value.lastIndexOf('.'); inp.setSelectionRange(0, dot > 0 && !value.endsWith('/') && /^\w{1,5}$/.test(value.slice(dot + 1)) ? dot : value.length); }, 30);
  });
}
function confirmBox({ title, body, ok = 'OK', danger }) {
  return modal((d, close) => d.append(
    h('div', { class: 'mbody' }, h('h3', {}, title), h('p', {}, body)),
    h('div', { class: 'mfoot' }, h('button', { class: 'ghost', onclick: () => close(false) }, 'Cancel'), h('button', { class: danger ? 'danger' : 'primary', onclick: () => close(true) }, ok)))).then(v => !!v);
}
function pickFolder({ title, exclude }) {
  return modal((d, close) => {
    const dirs = ['', ...M.allDirs()];
    const list = h('div', { class: 'folderlist' }, dirs.map(p => {
      const off = exclude && (p === exclude || p.startsWith(exclude + '/'));
      const depth = p ? p.split('/').length : 0;
      return h('button', { disabled: off, style: `--d:${depth}`, onclick: () => close({ path: p }) }, icon('folder'), p ? U.basename(p) : 'Top level');
    }));
    d.append(h('div', { class: 'mbody' }, h('h3', {}, title), list), h('div', { class: 'mfoot' }, h('button', { class: 'ghost', onclick: () => close(null) }, 'Cancel')));
  }).then(v => v ? v.path : null);
}

/* ---------------------------------------------------------------- context menu */
const menuEl = $('#menu');
function showMenu(items, x, y, alignRight) {
  menuEl.replaceChildren(...items.map(it => it === '-' ? h('hr') : h('button', { role: 'menuitem', class: it.danger ? 'danger-i' : '', onclick: () => { hideMenu(); it.run(); } }, icon(it.icon), it.label)));
  menuEl.classList.add('show');
  const w = menuEl.offsetWidth, hh = menuEl.offsetHeight;
  menuEl.style.left = Math.max(8, Math.min(alignRight ? x - w : x, innerWidth - w - 8)) + 'px';
  menuEl.style.top = Math.max(8, Math.min(y, innerHeight - hh - 8)) + 'px';
}
const hideMenu = () => menuEl.classList.remove('show');
document.addEventListener('pointerdown', e => { if (!menuEl.contains(e.target)) hideMenu(); }, true);
addEventListener('resize', hideMenu);
$('#tree').addEventListener('scroll', hideMenu);

function fileMenu(path) {
  const pinned = M.getPins().includes(path);
  return [
    { icon: 'pencil', label: 'Rename', run: () => renameItem(path, 'file') },
    { icon: 'move', label: 'Move to…', run: () => moveItem(path, 'file') },
    { icon: 'copy', label: 'Duplicate', run: () => duplicate(path) },
    U.isNote(path) && { icon: 'star', label: pinned ? 'Unpin' : 'Pin to top', run: () => togglePin(path) },
    { icon: 'download', label: 'Download', run: () => downloadFile(path) },
    '-', { icon: 'trash', label: 'Delete', danger: true, run: () => deleteItem(path, 'file') },
  ].filter(Boolean);
}
const folderMenu = path => [
  { icon: 'plus', label: 'New note here', run: () => newNote(path) },
  { icon: 'folderPlus', label: 'New folder here', run: () => newFolder(path) },
  { icon: 'upload', label: 'Upload files here', run: () => pickUpload(path) },
  '-',
  { icon: 'pencil', label: 'Rename', run: () => renameItem(path, 'dir') },
  { icon: 'move', label: 'Move to…', run: () => moveItem(path, 'dir') },
  '-', { icon: 'trash', label: 'Delete folder', danger: true, run: () => deleteItem(path, 'dir') },
];

/* ---------------------------------------------------------------- tree */
function saveExpanded() { ls.set('expanded', [...S.expanded]); }
function expandTo(dir) { const parts = dir.split('/').filter(Boolean); let p = ''; for (const s of parts) { p = U.join(p, s); S.expanded.add(p); } saveExpanded(); }
const displayName = p => U.isNote(p) ? U.stem(p) : U.basename(p);
const fileIcon = p => { const k = U.kindOf(p); return k === 'image' ? 'image' : U.isNote(p) ? 'note' : 'file'; };

function row({ type, path, depth, name, ico, active, open, pinned }) {
  const r = h('div', { class: `row ${type === 'dir' ? 'folder' : 'file'}${active ? ' active' : ''}${open ? ' open' : ''}`, style: `--d:${depth}`, draggable: 'true', 'data-path': path, 'data-type': type, role: 'treeitem' },
    type === 'dir' ? icon('chev', 'chev') : h('span', { style: 'width:14px' }),
    icon(ico, 'fi'), h('span', { class: 'name' }, name), pinned && icon('star', 'pinmark'),
    h('button', { class: 'more', 'aria-label': 'More', onclick: e => { e.stopPropagation(); const b = e.currentTarget.getBoundingClientRect(); showMenu(type === 'dir' ? folderMenu(path) : fileMenu(path), b.right, b.bottom + 4, true); } }, icon('more')));
  r.addEventListener('click', () => type === 'dir' ? toggleDir(path) : openFile(path));
  r.addEventListener('contextmenu', e => { e.preventDefault(); showMenu(type === 'dir' ? folderMenu(path) : fileMenu(path), e.clientX, e.clientY); });
  r.addEventListener('dragstart', e => { e.dataTransfer.setData('text/x-note', JSON.stringify({ path, type })); e.dataTransfer.effectAllowed = 'move'; document.body.classList.add('dragging'); });
  r.addEventListener('dragend', () => document.body.classList.remove('dragging'));
  if (type === 'dir') {
    r.addEventListener('dragover', e => { e.preventDefault(); e.stopPropagation(); r.classList.add('drop'); });
    r.addEventListener('dragleave', e => { if (!r.contains(e.relatedTarget)) r.classList.remove('drop'); });
    r.addEventListener('drop', e => { e.preventDefault(); e.stopPropagation(); r.classList.remove('drop'); handleDrop(e, path); });
  }
  return r;
}
function toggleDir(path) { S.dir = path; if (S.expanded.has(path)) S.expanded.delete(path); else S.expanded.add(path); saveExpanded(); renderTree(); }

function renderTree() {
  const el = $('#tree');
  if (S.q) return renderSearch(el);
  const keep = el.scrollTop;
  el.replaceChildren();
  el.setAttribute('role', 'tree');
  const pins = M.getPins().filter(M.exists);
  if (pins.length) {
    el.append(h('div', { class: 'sec' }, 'Pinned'));
    for (const p of pins) el.append(row({ type: 'file', path: p, depth: 0, name: displayName(p), ico: fileIcon(p), active: p === S.current }));
    el.append(h('div', { class: 'sec' }, 'All notes'));
  }
  const walk = (n, depth) => {
    for (const d of [...n.dirs.values()].sort((a, b) => U.naturalCmp(a.name, b.name))) {
      const open = S.expanded.has(d.path);
      el.append(row({ type: 'dir', path: d.path, depth, name: d.name, ico: 'folder', open }));
      if (open) walk(d, depth + 1);
    }
    for (const f of n.files.sort((a, b) => U.naturalCmp(a.path, b.path))) el.append(row({ type: 'file', path: f.path, depth, name: displayName(f.path), ico: fileIcon(f.path), active: f.path === S.current }));
  };
  walk(M.buildTree(), 0);
  if (!el.querySelector('.row')) el.append(h('div', { class: 'empty-tree' }, G.configured() ? (G.status.state === 'syncing' ? 'Syncing your notes…' : 'No notes yet. Create one with the button above.') : 'No notes yet. Create one, or connect GitHub in settings to load your repo.'));
  el.scrollTop = keep;
}
$('#tree').addEventListener('dragover', e => { e.preventDefault(); $('#tree').classList.add('drop-root'); });
$('#tree').addEventListener('dragleave', e => { if (!$('#tree').contains(e.relatedTarget)) $('#tree').classList.remove('drop-root'); });
$('#tree').addEventListener('drop', e => { e.preventDefault(); $('#tree').classList.remove('drop-root'); handleDrop(e, ''); });

async function handleDrop(e, destDir) {
  document.body.classList.remove('dragging');
  if (e.dataTransfer.files.length) return uploadFiles([...e.dataTransfer.files], destDir);
  try { const { path, type } = JSON.parse(e.dataTransfer.getData('text/x-note')); await moveInto(path, type, destDir); } catch { /* not ours */ }
}

/* ---------------------------------------------------------------- search */
function renderSearch(el) {
  const q = S.q.toLowerCase(), hits = [];
  for (const r of M.files.values()) {
    if (r.deleted || U.basename(r.path).startsWith('.') || r.path.split('/').some(s => s.startsWith('.'))) continue;
    const nameHit = r.path.toLowerCase().includes(q);
    let snip = '';
    if (typeof r.content === 'string') {
      const i = r.content.toLowerCase().indexOf(q);
      if (i >= 0) snip = r.content.slice(Math.max(0, i - 30), i + q.length + 60).replace(/\s+/g, ' ');
      else if (!nameHit) continue;
    } else if (!nameHit) continue;
    hits.push({ r, snip, nameHit });
    if (hits.length >= 60) break;
  }
  hits.sort((a, b) => b.nameHit - a.nameHit);
  el.replaceChildren(...(hits.length ? hits.map(({ r, snip }) => {
    const mark = t => { const i = t.toLowerCase().indexOf(q); return i < 0 ? t : [t.slice(0, i), h('mark', {}, t.slice(i, i + q.length)), t.slice(i + q.length)]; };
    return h('div', { class: 'hit', onclick: () => { openFile(r.path); } }, h('b', {}, mark(displayName(r.path))), h('small', {}, U.dirname(r.path) || 'Top level'), snip && h('small', {}, mark(snip)));
  }) : [h('div', { class: 'empty-tree' }, 'Nothing found')]));
}

/* ---------------------------------------------------------------- file operations */
async function openFile(path) {
  await flush();
  if (!M.exists(path)) return;
  S.current = path; S.dir = U.dirname(path);
  ls.set('last', path);
  expandTo(S.dir);
  await showFile(path);
  renderTree();
  closeNav();
}
function closeFile() {
  S.current = null; S.kind = null;
  $('#main').classList.remove('has-file');
  renderTree();
}
async function newNote(dir = S.dir) {
  const p = U.uniquePath(U.join(dir, 'Untitled.txt'), M.exists);
  await M.create(p, '');
  if (dir) expandTo(dir);
  await openFile(p);
  titleEl.focus(); titleEl.select();
}
async function newFolder(dir = S.dir) {
  const name = await promptText({ title: 'New folder', label: 'Folder name', ok: 'Create' });
  const n = name && U.sanitizeName(name);
  if (!n) return;
  const p = U.join(dir, n);
  if (M.dirExists(p)) return toast('That folder already exists');
  await M.makeDir(p);
  expandTo(p); S.dir = p; renderTree();
}
function pickUpload(dir = S.dir) {
  const inp = $('#filePick');
  inp.value = '';
  inp.onchange = () => uploadFiles([...inp.files], dir);
  inp.click();
}
async function uploadFiles(files, dir) {
  if (!files.length) return;
  let last;
  for (const f of files) { last = U.uniquePath(U.join(dir, U.sanitizeName(f.name) || 'file'), M.exists); await M.create(last, f); }
  if (dir) expandTo(dir);
  toast(files.length === 1 ? `Added ${U.basename(last)}` : `Added ${files.length} files`);
  if (files.length === 1) openFile(last);
}
async function renameItem(path, type) {
  await flush();
  const cur = U.basename(path);
  const val = await promptText({ title: type === 'dir' ? 'Rename folder' : 'Rename', value: type === 'file' && U.isNote(path) ? U.stem(path) : cur, ok: 'Rename' });
  if (val) await doRename(path, type, val);
}
async function doRename(path, type, input) {
  let name = U.sanitizeName(input);
  if (!name) return false;
  if (type === 'file' && U.isNote(path) && U.extOf(name) !== U.extOf(path)) name += '.' + U.extOf(path);
  const to = U.join(U.dirname(path), name);
  if (to === path) return true;
  if (type === 'dir' ? M.dirExists(to) : M.exists(to)) { toast('Something with that name already exists'); return false; }
  type === 'dir' ? await M.moveDir(path, to) : await M.move(path, to);
  remapState(path, to);
  renderTree(); syncHeader();
  return true;
}
function remapState(from, to) {
  const m = p => p === from ? to : p && p.startsWith(from + '/') ? to + p.slice(from.length) : p;
  S.current = m(S.current); S.dir = m(S.dir) ?? '';
  S.expanded = new Set([...S.expanded].map(m)); saveExpanded();
  if (S.current) ls.set('last', S.current);
}
async function moveItem(path, type) {
  await flush();
  const dest = await pickFolder({ title: `Move “${U.basename(path)}” to…`, exclude: type === 'dir' ? path : null });
  if (dest !== null) await moveInto(path, type, dest);
}
async function moveInto(src, type, destDir) {
  if (U.dirname(src) === destDir) return;
  const to = U.join(destDir, U.basename(src));
  await flush();
  if (type === 'dir') {
    if (destDir === src || destDir.startsWith(src + '/')) return toast('A folder can’t go inside itself');
    if (M.dirExists(to)) return toast('A folder with that name is already there');
    await M.moveDir(src, to); remapState(src, to);
  } else {
    const t = U.uniquePath(to, M.exists);
    await M.move(src, t); remapState(src, t);
  }
  if (destDir) expandTo(destDir);
  renderTree(); syncHeader();
  toast(`Moved to ${destDir || 'top level'}`);
}
async function deleteItem(path, type) {
  const n = type === 'dir' ? M.livePaths().filter(p => p.startsWith(path + '/') && !p.endsWith('/.gitkeep')).length : 0;
  const ok = await confirmBox({ title: type === 'dir' ? `Delete “${U.basename(path)}”?` : `Delete “${displayName(path)}”?`, body: type === 'dir' ? `This folder and its ${n} file${n === 1 ? '' : 's'} will be removed here and on GitHub at the next sync. (Git history keeps old versions.)` : 'It will be removed here and on GitHub at the next sync. (Git history keeps the old version.)', ok: 'Delete', danger: true });
  if (!ok) return;
  dirtyEd = false;
  type === 'dir' ? await M.removeDir(path) : await M.remove(path);
  if (S.current && (S.current === path || S.current.startsWith(path + '/'))) closeFile();
  renderTree();
}
async function duplicate(path) {
  await flush();
  const r = M.files.get(path);
  const to = U.uniquePath(U.join(U.dirname(path), `${U.stem(path)} copy.${U.extOf(path)}`.replace(/\.$/, '')), M.exists);
  await M.create(to, r.content ?? await M.getBlob(path));
  openFile(to);
}
async function downloadFile(path) {
  try {
    const blob = await M.getBlob(path);
    const a = h('a', { href: URL.createObjectURL(blob), download: U.basename(path) });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 20000);
  } catch (e) { toast(e.message); }
}
async function togglePin(path) {
  const pins = M.getPins();
  await M.setPins(pins.includes(path) ? pins.filter(p => p !== path) : [...pins, path]);
  renderTree(); syncHeader();
}

/* ---------------------------------------------------------------- main view */
async function showFile(path) {
  const r = M.files.get(path), k = U.kindOf(path);
  S.kind = k; S.shownSha = r.sha;
  $('#main').classList.add('has-file');
  if (k === 'text') {
    ed.value = r.content ?? await (await M.getBlob(path)).text();
    ed.classList.toggle('mono', !U.isNote(path));
    dirtyEd = false;
    applyMode();
    ed.scrollTop = 0; preview.scrollTop = 0;
  } else {
    pane.dataset.mode = 'view';
    await renderViewer(path, k);
  }
  syncHeader(); buildToolbar(); updateStats();
}
function syncHeader() {
  const p = S.current;
  if (!p || !M.exists(p)) return;
  const note = U.isNote(p);
  const shown = note ? U.stem(p) : U.basename(p);
  if (document.activeElement !== titleEl) titleEl.value = shown;
  sizeTitle();
  $('#titleExt').textContent = '';
  $('#crumb').textContent = U.dirname(p).split('/').filter(Boolean).join('  ›  ') || 'Top level';
  const pinned = M.getPins().includes(p);
  const pb = $('#btnPin'); pb.classList.toggle('on', pinned); pb.title = pinned ? 'Unpin' : 'Pin to top'; pb.hidden = !note;
  pb.firstChild.style.fill = pinned ? 'currentColor' : 'none';
  $('#modes').hidden = !U.isMarkdown(p);
}
const sizeTitle = () => { titleEl.style.width = Math.min(Math.max(titleEl.value.length + 1, 6), 60) + 'ch'; };
titleEl.addEventListener('input', sizeTitle);
titleEl.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); (S.kind === 'text' ? ed : titleEl).focus(); } if (e.key === 'Escape') { titleEl.value = ''; syncHeader(); titleEl.blur(); } });
titleEl.addEventListener('change', async () => {
  const p = S.current; if (!p) return;
  await flush();
  const ok = titleEl.value.trim() && await doRename(p, 'file', titleEl.value);
  if (!ok) { titleEl.value = ''; syncHeader(); }
  titleEl.blur(); syncHeader();
});

function effMode() {
  if (!S.current || !U.isMarkdown(S.current)) return 'edit';
  return S.mode === 'split' && !wide.matches ? 'edit' : S.mode;
}
function applyMode() {
  const m = effMode();
  pane.dataset.mode = m;
  const modes = [['edit', 'pencil', 'Edit'], ...(wide.matches ? [['split', 'columns', 'Split']] : []), ['preview', 'eye', 'Preview']];
  $('#modes').replaceChildren(...modes.map(([id, ic, label]) => h('button', { class: id === m ? 'on' : '', title: label, 'aria-pressed': id === m, onclick: () => { S.mode = id; ls.set('mode', id); applyMode(); if (id === 'edit') ed.focus(); } }, icon(ic), h('span', {}, label))));
  if (m !== 'edit') renderPreview();
  $('#toolbar').hidden = !(U.isNote(S.current || '') && m !== 'preview');
}
wide.addEventListener('change', () => S.kind === 'text' && applyMode());

async function renderViewer(path, k) {
  const v = $('#viewer');
  v.replaceChildren(h('div', { class: 'filecard' }, 'Loading…'));
  const acts = h('div', { class: 'viewer-actions' }, h('button', { class: 'ghost', onclick: () => downloadFile(path) }, icon('download'), 'Download'));
  try {
    const url = await blobUrl(path), r = M.files.get(path);
    const open = h('a', { class: 'ghost', href: url, target: '_blank', rel: 'noopener', style: 'text-decoration:none;display:inline-flex;align-items:center;height:34px;padding:0 12px;border-radius:8px' }, 'Open in new tab');
    if (k === 'image') v.replaceChildren(h('img', { src: url, alt: U.basename(path) }), acts);
    else if (k === 'video') v.replaceChildren(h('video', { src: url, controls: true }), acts);
    else if (k === 'audio') v.replaceChildren(h('audio', { src: url, controls: true }), acts);
    else if (k === 'pdf') { acts.append(open); v.replaceChildren(h('iframe', { src: url, title: U.basename(path) }), acts); }
    else v.replaceChildren(h('div', { class: 'filecard' }, icon('file'), h('div', {}, U.basename(path)), h('small', {}, r?.content ? fmtSize(r.content.size ?? r.content.length) : 'Not downloaded yet')), acts);
  } catch (e) { v.replaceChildren(h('div', { class: 'filecard' }, 'Could not load this file: ' + e.message)); }
}

/* ---------------------------------------------------------------- editor */
async function flush() {
  clearTimeout(saveT);
  if (!dirtyEd || !S.current || S.kind !== 'text') return;
  dirtyEd = false;
  await M.saveText(S.current, ed.value);
  scheduleSync();
}
let saveT;
const lazyPreview = debounce(() => { if (pane.dataset.mode !== 'edit') renderPreview(); }, 120);
ed.addEventListener('input', () => { dirtyEd = true; clearTimeout(saveT); saveT = setTimeout(flush, 500); lazyPreview(); updateStats(); });
ed.addEventListener('blur', flush);
function updateStats() {
  const s = $('#stats');
  if (S.kind !== 'text') { s.textContent = ''; return; }
  const words = (ed.value.match(/\S+/g) || []).length;
  s.textContent = `${words} word${words === 1 ? '' : 's'}`;
}

function insertText(t) {
  ed.focus();
  if (!document.execCommand('insertText', false, t)) { ed.setRangeText(t, ed.selectionStart, ed.selectionEnd, 'end'); ed.dispatchEvent(new Event('input')); }
}
function wrap(l, r = l, ph = '') {
  const s = ed.selectionStart, sel = ed.value.slice(s, ed.selectionEnd);
  if (sel && ed.value.slice(s - l.length, s) === l && ed.value.slice(ed.selectionEnd, ed.selectionEnd + r.length) === r) {
    ed.setSelectionRange(s - l.length, ed.selectionEnd + r.length); insertText(sel); ed.setSelectionRange(s - l.length, s - l.length + sel.length); return;
  }
  const body = sel || ph;
  insertText(l + body + r);
  ed.setSelectionRange(s + l.length, s + l.length + body.length);
}
function lineRange() {
  const v = ed.value, s = ed.selectionStart, e = ed.selectionEnd;
  const a = v.lastIndexOf('\n', s - 1) + 1; let b = v.indexOf('\n', e); if (b < 0) b = v.length;
  return [a, b];
}
function linePrefix(pre) {
  const [a, b] = lineRange(), lines = ed.value.slice(a, b).split('\n');
  const all = lines.every(l => l.startsWith(pre));
  const out = lines.map(l => all ? l.slice(pre.length) : pre + l).join('\n');
  ed.setSelectionRange(a, b); insertText(out); ed.setSelectionRange(a, a + out.length);
}
function cycleHeading() {
  const [a, b] = lineRange(), line = ed.value.slice(a, b), m = line.match(/^(#{1,5}) /);
  const out = m ? (m[1].length >= 3 ? line.slice(m[0].length) : '#' + line) : '# ' + line;
  ed.setSelectionRange(a, b); insertText(out);
}
function codeSnippet() {
  const sel = ed.value.slice(ed.selectionStart, ed.selectionEnd);
  if (sel.includes('\n')) { insertText('```\n' + sel + '\n```'); } else wrap('`', '`', 'code');
}
function linkSnippet() {
  const s = ed.selectionStart, sel = ed.value.slice(s, ed.selectionEnd) || 'text';
  insertText(`[${sel}](url)`);
  ed.setSelectionRange(s + sel.length + 3, s + sel.length + 6);
}
function buildToolbar() {
  const b = (ic, title, run) => h('button', { class: 'icon', title, 'aria-label': title, onmousedown: e => e.preventDefault(), onclick: run }, icon(ic));
  const att = b('clip', 'Attach file or photo', () => { const inp = $('#filePick'); inp.value = ''; inp.onchange = () => attach([...inp.files]); inp.click(); });
  if (!U.isMarkdown(S.current)) { $('#toolbar').replaceChildren(att); return; }
  $('#toolbar').replaceChildren(
    b('bold', 'Bold (Ctrl+B)', () => wrap('**', '**', 'bold')), b('italic', 'Italic (Ctrl+I)', () => wrap('*', '*', 'italic')),
    b('heading', 'Heading', cycleHeading), h('i', { class: 'sep' }),
    b('list', 'Bulleted list', () => linePrefix('- ')), b('check', 'Checklist', () => linePrefix('- [ ] ')), b('quote', 'Quote', () => linePrefix('> ')),
    b('code', 'Code', codeSnippet), b('link', 'Link (Ctrl+K)', linkSnippet), h('i', { class: 'sep' }),
    att);
}

async function attach(files) {
  if (!files.length || !S.current || S.kind !== 'text') return;
  const dir = U.join(U.dirname(S.current), 'attachments');
  const out = [];
  for (const f of files) {
    let name = U.sanitizeName(f.name || 'file') || 'file';
    if (/^image\.\w+$/i.test(name)) name = `pasted-${stamp()}.${U.extOf(name)}`;
    const p = U.uniquePath(U.join(dir, name), M.exists);
    await M.create(p, f);
    const url = mdUrl('attachments/' + U.basename(p));
    if (!U.isMarkdown(S.current)) { out.push('attachments/' + U.basename(p)); continue; }
    out.push(U.kindOf(p) === 'image' ? `![${U.stem(p)}](${url})` : `[${U.basename(p)}](${url})`);
  }
  insertText(out.join('\n') + '\n');
  toast(files.length === 1 ? 'Attached' : `Attached ${files.length} files`);
}
ed.addEventListener('paste', e => { const fs = [...(e.clipboardData?.files || [])]; if (fs.length && U.isNote(S.current)) { e.preventDefault(); attach(fs); } });
ed.addEventListener('dragover', e => { if (e.dataTransfer.types.includes('Files')) e.preventDefault(); });
ed.addEventListener('drop', e => { if (e.dataTransfer.files.length && U.isNote(S.current)) { e.preventDefault(); attach([...e.dataTransfer.files]); } });

ed.addEventListener('keydown', e => {
  const mod = e.ctrlKey || e.metaKey;
  if (mod && !e.shiftKey && !e.altKey) {
    const k = e.key.toLowerCase();
    if (k === 'b' && U.isMarkdown(S.current)) { e.preventDefault(); wrap('**', '**', 'bold'); return; }
    if (k === 'i' && U.isMarkdown(S.current)) { e.preventDefault(); wrap('*', '*', 'italic'); return; }
    if (k === 'k' && U.isMarkdown(S.current)) { e.preventDefault(); linkSnippet(); return; }
  }
  if (e.isComposing) return;
  if (e.key === 'Tab') {
    e.preventDefault();
    const [a, b] = lineRange();
    if (ed.selectionStart !== ed.selectionEnd || e.shiftKey) {
      const lines = ed.value.slice(a, b).split('\n');
      const out = lines.map(l => e.shiftKey ? l.replace(/^( {1,2}|\t)/, '') : '  ' + l).join('\n');
      ed.setSelectionRange(a, b); insertText(out); ed.setSelectionRange(a, a + out.length);
    } else insertText('  ');
    return;
  }
  if (e.key === 'Enter' && !e.shiftKey && !mod && U.isNote(S.current) && ed.selectionStart === ed.selectionEnd) {
    const v = ed.value, s = ed.selectionStart, ls0 = v.lastIndexOf('\n', s - 1) + 1, line = v.slice(ls0, s);
    let m = line.match(/^(\s*)(?:([-*+])|(\d+)([.)]))\s+(\[[ xX]\]\s+)?(.*)$/);
    if (m) {
      e.preventDefault();
      if (!m[6]) { ed.setSelectionRange(ls0, s); insertText(''); return; }       // empty item: leave the list
      const marker = m[2] || `${+m[3] + 1}${m[4]}`;
      insertText(`\n${m[1]}${marker} ${m[5] ? '[ ] ' : ''}`);
      return;
    }
    m = line.match(/^(\s*>+)\s?(.*)$/);
    if (m) { e.preventDefault(); if (!m[2]) { ed.setSelectionRange(ls0, s); insertText(''); } else insertText(`\n${m[1]} `); }
  }
});

/* ---------------------------------------------------------------- markdown preview */
const urlCache = new Map();
async function blobUrl(path) {
  const r = M.files.get(path);
  const key = path + ':' + r.sha;
  if (!urlCache.has(key)) urlCache.set(key, URL.createObjectURL(await M.getBlob(path)));
  return urlCache.get(key);
}
function resolvePath(base, rel) {
  rel = rel.split(/[?#]/)[0];
  try { rel = decodeURIComponent(rel); } catch { /* keep raw */ }
  const parts = rel.startsWith('/') ? [] : base.split('/').filter(Boolean);
  for (const s of rel.split('/')) { if (s === '..') parts.pop(); else if (s && s !== '.') parts.push(s); }
  return parts.join('/');
}
const isExternal = u => /^([a-z][a-z0-9+.-]*:|\/\/)/i.test(u);
function findNote(name) {
  const n = name.trim().toLowerCase();
  return M.livePaths().find(p => U.isNote(p) && (p.toLowerCase() === n || p.toLowerCase() === n + '.md' || U.stem(p).toLowerCase() === n));
}
function renderPreview() {
  if (!S.current || !U.isMarkdown(S.current)) return;
  const src = ed.value.replace(/\[\[([^\]\n|]+)(?:\|([^\]\n]+))?\]\]/g, (_, n, a) => `[${a || n}](#wiki/${encodeURIComponent(n.trim())})`);
  const box = preview, base = U.dirname(S.current);
  box.innerHTML = DOMPurify.sanitize(marked.parse(src, { gfm: true, breaks: true }));
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
    if (M.exists(p)) { el.removeAttribute('src'); blobUrl(p).then(u => el.src = u).catch(() => { el.alt = 'Could not load ' + p; }); }
  }
  box.querySelectorAll('input[type=checkbox]').forEach((c, i) => { c.disabled = false; c.dataset.i = i; });
}
preview.addEventListener('change', e => {
  const c = e.target; if (c.type !== 'checkbox') return;
  const re = /^([\s>]*(?:[-*+]|\d+[.)])\s+\[)([ xX])(\])/;
  let pos = 0, idx = -1, fence = false;
  for (const line of ed.value.split('\n')) {
    if (/^\s*(```|~~~)/.test(line)) fence = !fence;
    else if (!fence && re.test(line) && ++idx === +c.dataset.i) {
      const at = pos + line.match(re)[1].length;
      ed.setRangeText(c.checked ? 'x' : ' ', at, at + 1, 'preserve');
      ed.dispatchEvent(new Event('input'));
      return;
    }
    pos += line.length + 1;
  }
});
preview.addEventListener('click', async e => {
  const a = e.target.closest('a'); if (!a) return;
  if (a.dataset.local) { e.preventDefault(); openFile(a.dataset.local); }
  else if (a.dataset.wiki) {
    e.preventDefault();
    const p = findNote(a.dataset.wiki);
    if (p) return openFile(p);
    if (await confirmBox({ title: 'Create note?', body: `“${a.dataset.wiki}” doesn’t exist yet.`, ok: 'Create' })) {
      const to = U.uniquePath(U.join(S.dir, U.sanitizeName(a.dataset.wiki) + '.txt'), M.exists);
      await M.create(to, ''); openFile(to);
    }
  } else if (a.getAttribute('href')?.startsWith('#')) { e.preventDefault(); }
});

/* ---------------------------------------------------------------- settings / connect */
const ACCENTS = ['#6d5ae6', '#2f7de1', '#14a38b', '#3f9d3f', '#e8772e', '#e0457b'];
async function openSettings(first) {
  const old = G.getCfg();
  const cfg = old || {};
  return modal((d, close) => {
    const repo = h('input', { value: cfg.owner ? `${cfg.owner}/${cfg.repo}` : '', placeholder: 'yourname/notes', autocomplete: 'off', spellcheck: 'false', autocapitalize: 'off' });
    const token = h('input', { type: 'password', value: cfg.token || '', placeholder: 'github_pat_…', autocomplete: 'off', spellcheck: 'false' });
    const branch = h('input', { value: cfg.branch || '', placeholder: 'default branch', autocapitalize: 'off', spellcheck: 'false' });
    const root = h('input', { value: cfg.root || '', placeholder: 'whole repo', autocapitalize: 'off', spellcheck: 'false' });
    const theme = h('select', {}, ['auto', 'light', 'dark'].map(t => h('option', { value: t, selected: prefs.theme === t }, t === 'auto' ? 'Match system' : t[0].toUpperCase() + t.slice(1))));
    let accent = prefs.accent;
    const sw = h('div', { class: 'swatches' }, ACCENTS.map(c => h('button', { type: 'button', class: c === accent ? 'on' : '', style: `background:${c};color:${c}`, 'aria-label': c, onclick: e => { accent = c; sw.querySelectorAll('button').forEach(b => b.classList.toggle('on', b === e.currentTarget)); } })));
    const err = h('div', { class: 'err' });
    const save = h('button', { class: 'primary' }, G.configured() ? 'Save' : 'Connect');
    const f = h('form', {
      onsubmit: async e => {
        e.preventDefault(); err.textContent = '';
        prefs.theme = theme.value; prefs.accent = accent; ls.set('prefs', prefs); applyPrefs();
        if (!repo.value.trim() && !token.value.trim()) { close(true); return; }
        const r = G.parseRepo(repo.value);
        if (!r) { err.textContent = 'Enter the repo as owner/name.'; return; }
        if (!token.value.trim()) { err.textContent = 'Paste an access token.'; return; }
        const next = { token: token.value.trim(), ...r, branch: branch.value.trim(), root: G.normRoot(root.value) };
        save.disabled = true; save.textContent = 'Checking…';
        try {
          const info = await G.testConnection(next);
          if (!next.branch) next.branch = '';
          const changedRepo = old && (old.owner !== next.owner || old.repo !== next.repo || old.branch !== next.branch || old.root !== next.root);
          if (changedRepo && !(await confirmBox({ title: 'Switch repository?', body: 'This device’s local copy will be replaced with the new repo. Changes not yet synced will be lost.', ok: 'Switch', danger: true }))) { save.disabled = false; save.textContent = 'Save'; return; }
          if (changedRepo) { await M.wipe(); closeFile(); }
          G.setCfg(next);
          close(true);
          toast(info.private ? 'Connected to your private repo' : 'Connected');
          G.sync({ force: true });
        } catch (ex) {
          err.textContent = ex.status === 401 ? 'GitHub rejected that token.' : ex.status === 404 ? 'Repo not found — check the name, and that the token has access to it.' : ex.message || 'Could not connect';
          save.disabled = false; save.textContent = G.configured() ? 'Save' : 'Connect';
        }
      },
    },
      h('div', { class: 'mbody' },
        h('h3', {}, first ? 'Connect your notes repo' : 'Settings'),
        h('p', {}, first ? 'Notes stay on this device and sync with a GitHub repo. You can also skip this and use the app offline for now.' : 'Sync and appearance.'),
        h('label', { class: 'field' }, 'Repository', repo),
        h('label', { class: 'field' }, 'Access token', token,
          h('small', {}, 'Create a ', h('a', { href: 'https://github.com/settings/personal-access-tokens/new', target: '_blank', rel: 'noopener' }, 'fine-grained token'), ': pick only your notes repo, then Permissions → ', h('b', {}, 'Contents: Read and write'), '. It is stored only on this device.')),
        h('details', {}, h('summary', { style: 'cursor:pointer;color:var(--muted);font-size:13px' }, 'Advanced'),
          h('div', { style: 'display:grid;gap:12px;margin-top:10px' },
            h('label', { class: 'field' }, 'Branch', branch),
            h('label', { class: 'field' }, 'Folder inside the repo', root, h('small', {}, 'Only sync this subfolder, e.g. “notes”. Empty = whole repo.')))),
        h('label', { class: 'field' }, 'Theme', theme),
        h('div', { class: 'field' }, 'Accent colour', sw),
        err),
      h('div', { class: 'mfoot' },
        old && h('button', { type: 'button', class: 'danger', style: 'margin-right:auto', onclick: async () => {
          const n = M.pendingCount();
          if (await confirmBox({ title: 'Disconnect and erase local copy?', body: n ? `${n} change${n > 1 ? 's' : ''} haven’t synced yet and will be lost. Your GitHub repo is untouched.` : 'Your GitHub repo is untouched.', ok: 'Erase', danger: true })) { G.setCfg(null); await M.wipe(); closeFile(); close(true); renderStatus(); }
        } }, 'Disconnect'),
        h('button', { type: 'button', class: 'ghost', onclick: () => close(null) }, first ? 'Later' : 'Close'), save));
    d.append(f);
  });
}

/* ---------------------------------------------------------------- sync scheduling & status */
let syncT;
function scheduleSync(ms = 4000) { if (!G.configured() || G.status.state === 'error') return; clearTimeout(syncT); syncT = setTimeout(() => G.sync(), ms); }
async function syncNow() { await flush(); if (!G.configured()) return openSettings(true); G.sync({ force: true }); }
function ago(t) { const s = (Date.now() - t) / 1000; return s < 10 ? 'just now' : s < 60 ? `${s | 0}s ago` : s < 3600 ? `${(s / 60) | 0}m ago` : s < 86400 ? `${(s / 3600) | 0}h ago` : `${(s / 86400) | 0}d ago`; }
function renderStatus() {
  const st = G.status, n = M.pendingCount(), el = $('#status');
  let s = 'idle', text = '';
  if (!G.configured()) { s = 'off'; text = n ? `Local only · ${n} unsaved to GitHub` : 'Local only — tap to connect GitHub'; }
  else if (st.state === 'syncing') { s = 'syncing'; text = st.msg || 'Syncing…'; }
  else if (st.state === 'error') { s = 'error'; text = st.msg; }
  else if (st.state === 'offline') { s = 'pending'; text = `Offline${n ? ` · ${n} pending` : ''}`; }
  else if (n) { s = 'pending'; text = `${n} change${n > 1 ? 's' : ''} to sync`; }
  else { text = st.at ? `Synced ${ago(st.at)}` : 'Up to date'; }
  $('#emptyConnect').hidden = G.configured();
  el.dataset.s = s; el.title = text; el.lastChild.textContent = text;
  $('#btnSync').classList.toggle('spin', st.state === 'syncing');
}
G.onStatus(() => { renderStatus(); if (G.status.state !== 'syncing') renderTree(); });
setInterval(renderStatus, 30000);
setInterval(() => { if (document.visibilityState === 'visible' && G.configured()) G.sync(); }, 60000);
addEventListener('online', () => G.sync());
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush(); else G.sync(); });
addEventListener('pagehide', flush);

/* model changes (local edits, sync downloads) */
let raf;
M.subscribe(() => {
  cancelAnimationFrame(raf);
  raf = requestAnimationFrame(() => {
    renderTree(); renderStatus();
    if (M.pendingCount()) scheduleSync();
    const p = S.current; if (!p) return;
    const r = M.files.get(p);
    if (!r || r.deleted) { closeFile(); return; }
    syncHeader();
    if (S.kind === 'text' && !dirtyEd && typeof r.content === 'string' && r.content !== ed.value) {
      const [a, b] = [ed.selectionStart, ed.selectionEnd];
      ed.value = r.content; ed.setSelectionRange(Math.min(a, r.content.length), Math.min(b, r.content.length));
      if (pane.dataset.mode !== 'edit') renderPreview(); updateStats();
    } else if (S.kind !== 'text' && r.sha !== S.shownSha) { S.shownSha = r.sha; renderViewer(p, S.kind); }
  });
});

/* ---------------------------------------------------------------- navigation (mobile drawer) */
const closeNav = () => document.body.classList.remove('nav-open');
$('#btnMenu').addEventListener('click', () => document.body.classList.add('nav-open'));
$('#scrim').addEventListener('click', closeNav);
addEventListener('keydown', e => {
  if (e.key === 'Escape') { closeNav(); hideMenu(); }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); syncNow(); }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'e' && S.kind === 'text' && U.isMarkdown(S.current)) { e.preventDefault(); S.mode = effMode() === 'edit' ? (wide.matches ? 'split' : 'preview') : 'edit'; ls.set('mode', S.mode); applyMode(); }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f' && !e.shiftKey && document.activeElement !== ed) { e.preventDefault(); document.body.classList.add('nav-open'); $('#q').focus(); }
});

/* ---------------------------------------------------------------- boot */
async function boot() {
  $('#btnSync').append(icon('sync')); $('#btnSettings').append(icon('sliders'));
  $('#searchIcon').append(icon('search')); $('#btnMenu').append(icon('menu'));
  $('#btnNote').append(icon('plus'), 'New note'); $('#btnFolder').append(icon('folderPlus')); $('#btnUpload').append(icon('upload'));
  $('#btnPin').append(icon('star')); $('#btnMore').append(icon('more'));
  $('#emptyNew').append(icon('plus'), 'New note');
  applyPrefs();

  $('#btnSync').onclick = syncNow;
  $('#status').onclick = syncNow;
  $('#btnSettings').onclick = () => openSettings(false);
  $('#emptyConnect').onclick = () => openSettings(true);
  $('#btnNote').onclick = () => newNote();
  $('#emptyNew').onclick = () => newNote();
  $('#btnFolder').onclick = () => newFolder();
  $('#btnUpload').onclick = () => pickUpload();
  $('#btnPin').onclick = () => S.current && togglePin(S.current);
  $('#btnMore').onclick = e => { const b = e.currentTarget.getBoundingClientRect(); if (S.current) showMenu(fileMenu(S.current), b.right, b.bottom + 4, true); };
  $('#q').addEventListener('input', debounce(e => { S.q = e.target.value.trim(); renderTree(); }, 120));

  await M.load();
  const last = ls.get('last', null);
  if (last && M.exists(last)) { S.current = last; S.dir = U.dirname(last); await showFile(last); }
  renderTree(); renderStatus();
  if (G.configured()) G.sync();
  else if (!localStorage.getItem('welcomed')) { localStorage.setItem('welcomed', '1'); openSettings(true); }
  $('#emptyConnect').hidden = G.configured();

  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
  if (navigator.storage?.persist) navigator.storage.persist().catch(() => {});
}
boot();
