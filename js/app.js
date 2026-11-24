import * as M from './model.js';
import * as G from './sync.js';
import * as U from './util.js';
import * as P from './preview.js';
import * as E from './editor-tools.js';
import * as T from './media.js';
import { $, h, debounce, ls, toast, stamp, mdUrl, fmtSize } from './dom.js';
import { icon } from './icons.js';
import { promptText, confirmBox, pickFolder, showMenu, hideMenu } from './dialogs.js';
import { prefs, applyPrefs } from './theme.js';
import { openSettings } from './settings.js';
import { openAllFiles } from './alltree.js';

const MAX_FILE = 25 * 1024 * 1024;   // keep uploads phone- and API-friendly

/* ---------------------------------------------------------------- state */
const S = {
  view: 'notes', current: null, dir: '', q: '', kind: null, shownSha: null,
  mode: ls.get('mode', 'edit'), altMode: 'preview',     // view mode for markdown / for other previewable text (csv, json, code…)
  expanded: new Set(ls.get('expanded', [])),
  fresh: null,                       // path of a just-created, still-untouched note (discarded if left empty)
};
const ed = $('#ed'), pane = $('#pane'), preview = $('#preview'), titleEl = $('#title');
const wide = matchMedia('(min-width: 980px)'), narrow = matchMedia('(max-width: 820px)'), finePointer = matchMedia('(hover: hover) and (pointer: fine)');
let dirtyEd = false, saveT, flushing = Promise.resolve(), swReg = null;

/* ---------------------------------------------------------------- mobile drawer */
let navWatcher = null;
function openNav() {
  document.body.classList.add('nav-open');
  if (narrow.matches && !navWatcher && 'CloseWatcher' in window) {      // Android back button closes the drawer
    try { navWatcher = new CloseWatcher(); navWatcher.onclose = () => { navWatcher = null; document.body.classList.remove('nav-open'); }; } catch { /* needs user activation */ }
  }
}
function closeNav() {
  document.body.classList.remove('nav-open');
  navWatcher?.destroy(); navWatcher = null;
}

/* ---------------------------------------------------------------- tree */
const saveExpanded = () => ls.set('expanded', [...S.expanded]);
function expandTo(dir) { let p = ''; for (const s of dir.split('/').filter(Boolean)) { p = U.join(p, s); S.expanded.add(p); } saveExpanded(); }
const displayName = p => U.isNote(p) ? U.stem(p) : U.basename(p);
const fileIcon = p => U.iconOf(p, M.files.get(p));

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

function row({ type, path, depth, name, ico, active, open }) {
  const isDir = type === 'dir';
  const r = h('div', {
    class: `row ${isDir ? 'folder' : 'file'}${active ? ' active' : ''}${open ? ' open' : ''}`, style: `--d:${depth}`, role: 'treeitem', tabindex: '-1',
    draggable: finePointer.matches ? 'true' : null, 'data-path': path, 'data-type': type,
    'aria-expanded': isDir ? String(!!open) : null, 'aria-selected': isDir ? null : String(!!active),
  },
    isDir ? icon('chev', 'chev') : h('span', { style: 'width:14px;flex:none' }),
    icon(ico, 'fi'), h('span', { class: 'name' }, name),
    h('button', { class: 'more', 'aria-label': `Actions for ${name}`, onclick: e => { e.stopPropagation(); const b = e.currentTarget.getBoundingClientRect(); showMenu(isDir ? folderMenu(path) : fileMenu(path), b.right, b.bottom + 4, true); } }, icon('more')));
  r.addEventListener('click', () => isDir ? toggleDir(path) : openFile(path));
  r.addEventListener('contextmenu', e => { e.preventDefault(); showMenu(isDir ? folderMenu(path) : fileMenu(path), e.clientX, e.clientY); });
  r.addEventListener('dragstart', e => { e.dataTransfer.setData('text/x-note', JSON.stringify({ path, type })); e.dataTransfer.effectAllowed = 'move'; document.body.classList.add('dragging'); });
  r.addEventListener('dragend', () => document.body.classList.remove('dragging'));
  if (isDir) {
    r.addEventListener('dragover', e => { e.preventDefault(); e.stopPropagation(); r.classList.add('drop'); });
    r.addEventListener('dragleave', e => { if (!r.contains(e.relatedTarget)) r.classList.remove('drop'); });
    r.addEventListener('drop', e => { e.preventDefault(); e.stopPropagation(); r.classList.remove('drop'); handleDrop(e, path); });
  }
  return r;
}
function toggleDir(path) { S.dir = path; S.expanded.has(path) ? S.expanded.delete(path) : S.expanded.add(path); saveExpanded(); renderTree(); }

function renderTree() {
  const el = $('#tree');
  if (S.q) return renderSearch(el);
  const keep = el.scrollTop, frag = document.createDocumentFragment();
  el.setAttribute('role', 'tree');
  const pins = M.getPins().filter(M.exists);
  if (pins.length) {
    frag.append(h('div', { class: 'sec' }, 'Pinned'));
    for (const p of pins) frag.append(row({ type: 'file', path: p, depth: 0, name: displayName(p), ico: fileIcon(p), active: p === S.current }));
    frag.append(h('div', { class: 'sec' }, 'Notes'));
  }
  const walk = (n, depth) => {
    for (const d of [...n.dirs.values()].sort((a, b) => U.naturalCmp(a.name, b.name))) {
      const open = S.expanded.has(d.path);
      frag.append(row({ type: 'dir', path: d.path, depth, name: d.name, ico: 'folder', open }));
      if (open) walk(d, depth + 1);
    }
    for (const f of n.files.sort((a, b) => U.naturalCmp(a.path, b.path))) frag.append(row({ type: 'file', path: f.path, depth, name: displayName(f.path), ico: fileIcon(f.path), active: f.path === S.current }));
  };
  const root = M.buildTree(prefs.hidden); root.files = root.files.filter(f => f.path !== 'calendar.ics');      // the Calendar manages this file
  walk(root, 0);
  if (!frag.querySelector('.row')) {
    const msg = !G.configured() ? 'No notes yet. Create one, or connect GitHub in Settings to load your repo.'
      : G.status.state === 'syncing' ? (G.status.msg || 'Syncing your notes…') : 'No notes yet. Tap “New note” to start.';
    frag.append(h('div', { class: 'empty-tree' }, msg));
  }
  el.replaceChildren(frag);
  el.scrollTop = keep;
}
const treeEl = $('#tree');
treeEl.addEventListener('dragover', e => { e.preventDefault(); treeEl.classList.add('drop-root'); });
treeEl.addEventListener('dragleave', e => { if (!treeEl.contains(e.relatedTarget)) treeEl.classList.remove('drop-root'); });
treeEl.addEventListener('drop', e => { e.preventDefault(); treeEl.classList.remove('drop-root'); handleDrop(e, ''); });
treeEl.addEventListener('keydown', e => {        // arrow-key navigation
  const rows = [...treeEl.querySelectorAll('.row')], i = rows.indexOf(document.activeElement);
  const go = j => { e.preventDefault(); rows[Math.max(0, Math.min(rows.length - 1, j))]?.focus(); };
  if (e.key === 'ArrowDown') go(i + 1); else if (e.key === 'ArrowUp') go(i - 1);
  else if ((e.key === 'Enter' || e.key === ' ') && i >= 0) { e.preventDefault(); rows[i].click(); }
  else if (e.key === 'ArrowRight' && rows[i]?.dataset.type === 'dir' && !S.expanded.has(rows[i].dataset.path)) rows[i].click();
  else if (e.key === 'ArrowLeft' && rows[i]?.dataset.type === 'dir' && S.expanded.has(rows[i].dataset.path)) rows[i].click();
});

async function handleDrop(e, destDir) {
  document.body.classList.remove('dragging');
  if (e.dataTransfer.files.length) return uploadFiles([...e.dataTransfer.files], destDir);
  try { const { path, type } = JSON.parse(e.dataTransfer.getData('text/x-note')); await moveInto(path, type, destDir); } catch { /* not ours */ }
}

/* pull down on the list to sync */
function bindPullToRefresh(el, ptr, onRefresh) {
  let y0 = null, ready = false;
  const reset = () => { y0 = null; ready = false; ptr.classList.remove('pulling', 'ready'); ptr.style.removeProperty('--p'); };
  ptr.append(icon('sync'));
  el.addEventListener('touchstart', e => { y0 = el.scrollTop <= 0 && e.touches.length === 1 ? e.touches[0].clientY : null; }, { passive: true });
  el.addEventListener('touchmove', e => {
    if (y0 == null) return;
    const dy = e.touches[0].clientY - y0;
    if (dy <= 0 || el.scrollTop > 0) { if (dy <= 0) reset(); return; }
    if (e.cancelable) e.preventDefault();
    const p = Math.min(dy * .5, 72);
    ptr.style.setProperty('--p', p); ptr.classList.add('pulling');
    ready = p >= 56; ptr.classList.toggle('ready', ready);
  }, { passive: false });
  const end = async () => {
    if (!ready) return reset();
    reset(); navigator.vibrate?.(8);
    ptr.classList.add('loading');
    try { await onRefresh(); } finally { ptr.classList.remove('loading'); }
  };
  el.addEventListener('touchend', end); el.addEventListener('touchcancel', reset);
}

/* ---------------------------------------------------------------- search */
function renderSearch(el) {
  const q = S.q.toLowerCase(), hits = [];
  for (const r of M.files.values()) {
    if (r.deleted || r.path === 'calendar.ics' || (!prefs.hidden && U.isHidden(r.path))) continue;
    const nameHit = r.path.toLowerCase().includes(q);
    let snip = '';
    if (typeof r.content === 'string') {
      const i = r.content.toLowerCase().indexOf(q);
      if (i >= 0) snip = r.content.slice(Math.max(0, i - 30), i + q.length + 60).replace(/\s+/g, ' ');
      else if (!nameHit) continue;
    } else if (!nameHit) continue;
    hits.push({ r, snip, nameHit });
  }
  hits.sort((a, b) => b.nameHit - a.nameHit || U.naturalCmp(a.r.path, b.r.path));
  const mark = t => { const i = t.toLowerCase().indexOf(q); return i < 0 ? t : [t.slice(0, i), h('mark', {}, t.slice(i, i + q.length)), t.slice(i + q.length)]; };
  el.setAttribute('role', 'list');
  el.replaceChildren(...(hits.length ? hits.slice(0, 80).map(({ r, snip }) =>
    h('div', { class: 'hit', role: 'listitem', onclick: () => openFile(r.path) }, h('b', {}, mark(displayName(r.path))), h('small', {}, U.dirname(r.path) || 'Top level'), snip && h('small', {}, mark(snip))))
    : [h('div', { class: 'empty-tree' }, 'Nothing found')]));
}

/* ---------------------------------------------------------------- file operations */
async function openFile(path) {
  if (S.view === 'calendar') await setView('notes');
  await flush();
  if (!M.exists(path)) return;
  await discardFresh(path);
  S.current = path; S.dir = U.dirname(path); S.altMode = 'preview';   // csv/json/code open as a preview; Edit is one tap away
  ls.set('last', path);
  expandTo(S.dir);
  await showFile(path);
  renderTree();
  closeNav();
}
function closeFile() {
  S.current = null; S.kind = null; S.fresh = null; dirtyEd = false;
  $('#main').classList.remove('has-file');
  renderTree();
  if (narrow.matches) openNav();
}
/** A note created with "New note" that was left empty and unnamed is removed instead of cluttering the repo. */
async function discardFresh(next) {
  const p = S.fresh;
  if (!p || p === next) return;
  S.fresh = null;
  const r = M.files.get(p);
  if (r && !r.deleted && S.current === p && !ed.value.trim() && U.stem(p).startsWith('Untitled')) await M.remove(p);
}
async function newNote(dir = S.dir) {
  const p = U.uniquePath(U.join(dir, 'Untitled.txt'), M.exists);
  await M.create(p, '');
  if (dir) expandTo(dir);
  await openFile(p);
  S.fresh = p;
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
  inp.value = ''; inp.onchange = () => uploadFiles([...inp.files], dir);
  inp.click();
}
/** Returns the paths that were added (files over the size limit are skipped). */
async function addFiles(files, dir) {
  const added = [];
  for (const f of files) {
    if (f.size > MAX_FILE) { toast(`“${f.name}” is over ${fmtSize(MAX_FILE)} and was skipped`); continue; }
    let name = U.sanitizeName(f.name || '') || 'file';
    if (!U.extOf(name) && U.extForMime(f.type)) name += '.' + U.extForMime(f.type);   // e.g. a pasted picture without a name
    if (/^image\.\w+$/i.test(name)) name = `pasted-${stamp()}.${U.extOf(name)}`;
    const p = U.uniquePath(U.join(dir, name), M.exists);
    await M.create(p, f);
    added.push(p);
  }
  return added;
}
async function uploadFiles(files, dir) {
  const added = await addFiles(files, dir);
  if (!added.length) return;
  if (dir) expandTo(dir);
  toast(added.length === 1 ? `Added ${U.basename(added[0])}` : `Added ${added.length} files`);
  if (added.length === 1) openFile(added[0]);
}
async function renameItem(path, type) {
  await flush();
  const val = await promptText({ title: type === 'dir' ? 'Rename folder' : 'Rename', value: type === 'file' && U.isNote(path) ? U.stem(path) : U.basename(path), ok: 'Rename' });
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
  S.current = m(S.current); S.dir = m(S.dir) ?? ''; S.fresh = m(S.fresh);
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
  toast(`Moved to ${destDir ? U.basename(destDir) : 'top level'}`);
}
/** Deleting is immediate with an Undo toast (folders ask first). Git history keeps old versions as well. */
async function deleteItem(path, type) {
  await flush();
  const under = type === 'dir' ? M.livePaths().filter(p => p.startsWith(path + '/')) : [path];
  const count = under.filter(p => !p.endsWith('/.gitkeep')).length;
  if (type === 'dir' && count > 0 && !await confirmBox({ title: `Delete “${U.basename(path)}”?`, body: `This folder and its ${count} file${count === 1 ? '' : 's'} will be deleted. You’ll be able to undo for a few seconds.`, ok: 'Delete', danger: true })) return;
  const snapshot = under.map(p => ({ ...M.files.get(p) })), pins = M.getPins();
  const wasOpen = S.current && (S.current === path || S.current.startsWith(path + '/'));
  type === 'dir' ? await M.removeDir(path) : await M.remove(path);
  if (wasOpen) closeFile();
  renderTree();
  toast(`Deleted “${type === 'dir' ? U.basename(path) : displayName(path)}”`, {
    action: 'Undo',
    onAction: async () => { await M.restore(snapshot); if (pins.length) await M.setPins(pins); renderTree(); toast('Restored'); },
  });
}
async function duplicate(path) {
  await flush();
  const e = U.extOf(path), to = U.uniquePath(U.join(U.dirname(path), `${U.stem(path)} copy${e ? '.' + e : ''}`), M.exists);
  const { content } = await M.ensureContent(path);
  await M.create(to, content);
  openFile(to);
}
async function downloadFile(path) {
  if (M.needsApproval(path)) {
    if (!await confirmBox({ title: 'Use mobile data?', body: `“${U.basename(path)}” (${fmtSize(M.sizeOf(M.files.get(path)) ?? 0)}) isn’t on this device yet.`, ok: 'Download' })) return;
    M.approve(path);
  }
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
/** Not downloaded and on mobile data: show what it is and let the user decide. */
function renderNeedDownload(path) {
  const r = M.files.get(path), size = M.sizeOf(r);
  pane.dataset.mode = 'view'; $('#main').classList.add('has-file');
  $('#viewer').replaceChildren(h('div', { class: 'filecard' }, h('div', { class: 'badge' }, icon('cloud')), h('b', {}, U.basename(path)),
    h('span', {}, `${U.labelOf(path)}${size != null ? ' · ' + fmtSize(size) : ''} · not on this device yet`), h('span', {}, 'You’re on mobile data, so it wasn’t downloaded.'),
    h('div', { class: 'viewer-actions' }, h('button', { class: 'primary', onclick: () => { M.approve(path); showFile(path); } }, icon('download'), size != null ? `Download (${fmtSize(size)})` : 'Download'))));
  S.kind = 'other'; S.shownSha = r.sha;
  syncHeader(); buildToolbar(); updateStats();
}
async function showFile(path) {
  let r = M.files.get(path);
  if (M.needsApproval(path)) return renderNeedDownload(path);
  let k = U.kindOf(path, r);
  if (U.isAmbiguous(path) && !r.kind) {                              // no trustworthy extension: look at the content
    try { k = await M.resolveKind(path); } catch { /* offline and not downloaded: fall back to the extension */ }
    if (S.current !== path) return;
    r = M.files.get(path);                                           // sniffing may have replaced the record (e.g. Blob -> text)
  }
  S.kind = k; S.shownSha = r.sha;
  $('#main').classList.add('has-file');
  if (k === 'text') {
    try { ed.value = (r.content ?? (await M.ensureContent(path)).content) ?? ''; }
    catch (e) { ed.value = ''; toast('Could not load this file: ' + e.message); }
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
  if (document.activeElement !== titleEl) titleEl.value = note ? U.stem(p) : U.basename(p);
  $('#crumb').textContent = U.dirname(p).split('/').filter(Boolean).join('  ›  ') || 'Notes';
  $('#modes').hidden = !U.previewOf(p);
}
titleEl.addEventListener('keydown', e => {
  if (e.key === 'Enter') { e.preventDefault(); (S.kind === 'text' ? ed : titleEl).focus(); }
  if (e.key === 'Escape') { titleEl.value = ''; titleEl.blur(); }
});
titleEl.addEventListener('change', async () => {
  const p = S.current; if (!p) return;
  await flush();
  const ok = titleEl.value.trim() && await doRename(p, 'file', titleEl.value);
  titleEl.blur();
  if (!ok) titleEl.value = '';
  syncHeader();
});

function effMode() {
  const t = S.current && U.previewOf(S.current);
  if (!t) return 'edit';
  const m = t === 'md' ? S.mode : S.altMode;
  return m === 'split' ? (t === 'md' ? 'edit' : 'preview') : m;      // the old side-by-side view is gone: one view at a time
}
function setMode(id) {
  if (U.previewOf(S.current) === 'md') { S.mode = id; ls.set('mode', id); } else S.altMode = id;
  applyMode(); if (id === 'edit') ed.focus();
}
function applyMode() {
  const m = effMode();
  pane.dataset.mode = m;
  const all = [['edit', 'pencil', 'Edit'], ['preview', 'eye', 'Preview']];
  const modes = all.filter(x => x[0] !== m);                            // one button that flips to the other view
  $('#modes').classList.add('single');
  $('#modes').replaceChildren(...modes.map(([id, ic, label]) => h('button', { class: id === m ? 'on' : '', title: label, 'aria-label': label, 'aria-pressed': String(id === m), onclick: () => setMode(id) }, icon(ic), h('span', {}, label))));
  if (m !== 'edit') renderPreview();
  $('#toolbar').hidden = !(U.isNote(S.current || '') && m !== 'preview');
}
wide.addEventListener('change', () => S.kind === 'text' && applyMode());
narrow.addEventListener('change', () => S.kind === 'text' && applyMode());

function fileCard(path, r) {
  return h('div', { class: 'filecard' }, h('div', { class: 'badge' }, icon(U.iconOf(path, r))), h('b', {}, U.basename(path)), h('span', {}, `${U.labelOf(path)} · ${fmtSize(r?.content?.size ?? 0)}`));
}
async function renderViewer(path, k) {
  const v = $('#viewer');
  v.replaceChildren(h('div', { class: 'filecard' }, 'Loading…'));
  const acts = h('div', { class: 'viewer-actions' }, h('button', { class: 'tonal', onclick: () => downloadFile(path) }, icon('download'), 'Download'));
  try {
    const r = M.files.get(path);
    if (k === 'font' || k === 'office' || k === 'archive' || k === 'pdf') {            // rich previews, built in docs.js
      const box = h('div', { class: 'docview' });
      const blob = await M.getBlob(path);
      if (S.current !== path) return;
      v.replaceChildren(box, acts);
      if (k === 'pdf') acts.append(h('a', { class: 'ghost', href: URL.createObjectURL(blob), target: '_blank', rel: 'noopener' }, icon('open'), 'Open in new tab'));
      try { await (await import('./docs.js')).renderBinary(box, k, path, blob); }
      catch (e) { console.warn(e); v.replaceChildren(fileCard(path, M.files.get(path)), h('p', { class: 'dim' }, 'Couldn’t draw a preview: ' + (e.message || e)), acts); }
      return;
    }
    if (k === 'other' || k === 'text') { await M.ensureContent(path); if (S.current !== path) return; v.replaceChildren(fileCard(path, M.files.get(path)), acts); return; }
    const url = k === 'image' ? await T.display(path) : await P.blobUrl(path);       // pictures: scaled-down version first
    if (S.current !== path) return;                                  // user moved on while it loaded
    if (k === 'image') v.replaceChildren(h('img', { src: url, alt: U.basename(path), 'data-path': path, decoding: 'async' }), acts);
    else if (k === 'video') v.replaceChildren(h('video', { src: url, controls: true }), acts);
    else if (k === 'audio') v.replaceChildren(h('audio', { src: url, controls: true }), acts);
    else if (k === 'pdf') { acts.append(h('a', { class: 'ghost', href: url, target: '_blank', rel: 'noopener' }, icon('open'), 'Open in new tab')); v.replaceChildren(h('iframe', { src: url, title: U.basename(path) }), acts); }
  } catch (e) {
    v.replaceChildren(h('div', { class: 'filecard' }, G.configured() ? 'Could not load this file: ' + e.message : 'This file isn’t on this device yet. Connect GitHub to download it.'));
  }
}

/* ---------------------------------------------------------------- editor */
async function doFlush() {
  if (!dirtyEd || !S.current || S.kind !== 'text') return;
  dirtyEd = false;
  await M.saveText(S.current, ed.value);
  scheduleSync();
}
/** Save pending edits. Calls are chained so an older save can never overwrite a newer one. */
function flush() { clearTimeout(saveT); return flushing = flushing.then(doFlush).catch(console.error); }
const lazyPreview = debounce(() => { if (pane.dataset.mode !== 'edit') renderPreview(); }, 150);
ed.addEventListener('input', () => { dirtyEd = true; if (ed.value.trim()) S.fresh = null; clearTimeout(saveT); saveT = setTimeout(flush, 400); lazyPreview(); updateStats(); });
ed.addEventListener('blur', flush);
function updateStats() {
  const words = S.kind === 'text' ? (ed.value.match(/\S+/g) || []).length : -1;
  $('#stats').textContent = words < 0 ? '' : words === 0 ? 'Empty' : `${words} word${words === 1 ? '' : 's'}`;
}
E.bindKeys(ed, () => S.current);

function pickAttach() { const inp = $('#filePick'); inp.value = ''; inp.onchange = () => attach([...inp.files]); inp.click(); }
function buildToolbar() {
  const b = (ic, title, run) => h('button', { class: 'icon', title, 'aria-label': title, onmousedown: e => e.preventDefault(), onclick: run }, icon(ic));
  const attachBtn = b('clip', 'Attach file or photo', pickAttach);
  if (!U.isMarkdown(S.current)) { $('#toolbar').replaceChildren(attachBtn); return; }
  $('#toolbar').replaceChildren(
    b('bold', 'Bold (Ctrl+B)', () => E.wrap(ed, '**', '**', 'bold')), b('italic', 'Italic (Ctrl+I)', () => E.wrap(ed, '*', '*', 'italic')),
    b('heading', 'Heading', () => E.cycleHeading(ed)), h('i', { class: 'sep' }),
    b('list', 'Bulleted list', () => E.linePrefix(ed, '- ')), b('check', 'Checklist', () => E.linePrefix(ed, '- [ ] ')), b('quote', 'Quote', () => E.linePrefix(ed, '> ')),
    b('code', 'Code', () => E.codeSnippet(ed)), b('link', 'Link (Ctrl+K)', () => E.linkSnippet(ed)), h('i', { class: 'sep' }), attachBtn);
}

/** Store files in `attachments/` next to the note and insert a reference (markdown link or plain path). */
async function attach(files) {
  if (!files.length || !S.current || S.kind !== 'text') return;
  const added = await addFiles(files, U.join(U.dirname(S.current), 'attachments'));
  if (!added.length) return;
  const md = U.isMarkdown(S.current);
  E.insertText(ed, added.map(p => {
    const rel = 'attachments/' + U.basename(p);
    if (!md) return rel;
    return U.kindOf(p) === 'image' ? `![${U.stem(p)}](${mdUrl(rel)})` : `[${U.basename(p)}](${mdUrl(rel)})`;
  }).join('\n') + '\n');
  toast(added.length === 1 ? 'Attached' : `Attached ${added.length} files`);
}
ed.addEventListener('paste', e => { const fs = [...(e.clipboardData?.files || [])]; if (fs.length && U.isNote(S.current)) { e.preventDefault(); attach(fs); } });
ed.addEventListener('dragover', e => { if (e.dataTransfer.types.includes('Files')) e.preventDefault(); });
ed.addEventListener('drop', e => { if (e.dataTransfer.files.length && U.isNote(S.current)) { e.preventDefault(); attach([...e.dataTransfer.files]); } });

/* ---------------------------------------------------------------- picture lightbox */
let lightbox = null;
function closeLightbox() { lightbox?.remove(); lightbox = null; removeEventListener('keydown', lightboxKey, true); }
function lightboxKey(e) { if (e.key === 'Escape') { e.stopPropagation(); closeLightbox(); } }
/** Show the full-size picture. The scaled version is shown straight away while the original loads. */
async function openLightbox(path, from) {
  closeLightbox();
  const img = h('img', { alt: U.basename(path), src: from || '' });
  lightbox = h('div', { id: 'lightbox', role: 'dialog', 'aria-label': U.basename(path), onclick: closeLightbox }, img, h('button', { class: 'icon', 'aria-label': 'Close', onclick: closeLightbox }, icon('x')));
  document.body.append(lightbox); addEventListener('keydown', lightboxKey, true);
  try { const u = await T.blobUrl(path); if (lightbox?.contains(img)) { const full = new Image(); full.src = u; await full.decode().catch(() => {}); if (lightbox?.contains(img)) img.src = u; } }
  catch (e) { toast('Could not load the picture: ' + e.message); }
}
document.addEventListener('click', e => {
  const im = e.target.closest('#preview img[data-path], #viewer img[data-path]');
  if (im) openLightbox(im.dataset.path, im.currentSrc || im.src);
});

/* ---------------------------------------------------------------- markdown preview */
function renderPreview() {
  if (!S.current || !U.previewOf(S.current)) return;
  return P.render(preview, ed.value, S.current).catch(e => { console.error(e); preview.textContent = 'Preview unavailable. It needs to load once while online.'; });
}
preview.addEventListener('change', e => {
  const c = e.target;
  if (c.type !== 'checkbox') return;
  const at = P.taskMarkerPos(ed.value, +c.dataset.i);
  if (at < 0) return;
  ed.setRangeText(c.checked ? 'x' : ' ', at, at + 1, 'preserve');
  ed.dispatchEvent(new Event('input'));
});
preview.addEventListener('click', async e => {
  const a = e.target.closest('a');
  if (!a) return;
  if (a.dataset.local) { e.preventDefault(); openFile(a.dataset.local); }
  else if (a.dataset.wiki) {
    e.preventDefault();
    const p = P.findNote(a.dataset.wiki);
    if (p) return openFile(p);
    if (await confirmBox({ title: 'Create note?', body: `“${a.dataset.wiki}” doesn’t exist yet.`, ok: 'Create' })) {
      const to = U.uniquePath(U.join(S.dir, U.sanitizeName(a.dataset.wiki) + '.txt'), M.exists);
      await M.create(to, ''); openFile(to);
    }
  } else if (a.getAttribute('href')?.startsWith('#')) e.preventDefault();
});

/* ---------------------------------------------------------------- sync scheduling & status */
let syncT, pollT, lastResume = 0;
/** Push local edits soon (debounced). */
function scheduleSync(ms = 2500) {
  if (!G.configured() || G.status.fatal) return;
  clearTimeout(syncT); syncT = setTimeout(() => G.sync(), ms);
}
async function syncNow() {
  await flush();
  if (!G.configured()) return openSettings(true, settingsCtx);
  if (G.status.state === 'error' && G.status.fatal) return openSettings(false, settingsCtx);
  G.sync({ force: true });
}
/** Check for remote changes when the app comes back to the foreground. Cheap: one conditional request. */
function resumeSync() {
  if (Date.now() - lastResume < 8000) return;
  lastResume = Date.now();
  G.sync(); swReg?.update().catch(() => {});
}
function schedulePoll() {
  clearTimeout(pollT);
  if (!prefs.poll || !G.configured()) return;
  const s = navigator.connection?.saveData ? Math.max(prefs.poll, 300) : prefs.poll;
  pollT = setTimeout(async () => { if (document.visibilityState === 'visible') await G.sync(); schedulePoll(); }, s * 1000);
}
const ago = t => { const s = (Date.now() - t) / 1000; return s < 10 ? 'just now' : s < 60 ? `${s | 0}s ago` : s < 3600 ? `${(s / 60) | 0}m ago` : s < 86400 ? `${(s / 3600) | 0}h ago` : `${(s / 86400) | 0}d ago`; };
function renderStatus() {
  const st = G.status, n = M.pendingCount(), el = $('#status'), on = G.configured();
  let s = 'idle', text;
  if (!on) { s = 'off'; text = n ? 'Local only. Tap to connect GitHub' : 'Not connected. Tap to connect GitHub'; }
  else if (st.state === 'syncing') { s = 'syncing'; text = st.msg || 'Syncing…'; }
  else if (prefetch.running && st.state !== 'error') { s = 'syncing'; text = `Downloading files ${prefetch.done}/${prefetch.total}`; }
  else if (st.state === 'error') { s = 'error'; text = st.msg; }
  else if (st.state === 'offline') { s = 'pending'; text = `Offline${n ? ` · ${n} change${n > 1 ? 's' : ''} waiting` : ''}`; }
  else if (n) { s = 'pending'; text = `${n} change${n > 1 ? 's' : ''} to sync`; }
  else text = st.at ? `Synced ${ago(st.at)}` : 'Up to date';
  document.body.dataset.sync = s; el.dataset.s = s; el.title = text; el.lastChild.textContent = text;
  const b = $('#btnSync2');                                      // phone top bar
  b.classList.toggle('spin', st.state === 'syncing'); b.classList.toggle('pending', on && n > 0 && st.state !== 'syncing');
}
G.onStatus(() => { renderStatus(); if (G.status.state !== 'syncing') { renderTree(); if (G.status.state === 'idle') schedulePrefetch(); } });
setInterval(renderStatus, 30000);
addEventListener('online', () => G.sync());
addEventListener('focus', resumeSync);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') flush().then(() => { if (M.pendingCount()) G.sync(); });   // push before the OS freezes us
  else { resumeSync(); renderStatus(); }
});
addEventListener('pagehide', flush);

/* ---- files that aren't downloaded yet: fetch them on Wi-Fi, ask on mobile data ---- */
let prefetch = { running: false, done: 0, total: 0 }, prefetchT;
const stopPrefetch = () => !navigator.onLine || (prefs.files === 'smart' && M.metered());
async function prefetchFiles() {
  if (prefetch.running || !G.configured() || prefs.files === 'manual' || stopPrefetch() || G.status.state === 'syncing') return;
  const todo = [...M.files.values()].filter(r => !r.deleted && r.content == null && (r.size ?? 0) <= 100 * 1024 * 1024).sort((x, y) => (x.size ?? 0) - (y.size ?? 0));
  if (!todo.length) return;
  prefetch = { running: true, done: 0, total: todo.length };
  renderStatus();
  try {
    for (const r of todo) {                                       // one at a time, only while the page is idle and visible, so typing and scrolling stay smooth
      if (stopPrefetch()) break;
      if (document.visibilityState !== 'visible') { await new Promise(res => setTimeout(res, 2000)); }
      await new Promise(res => (window.requestIdleCallback || setTimeout)(res, { timeout: 1500 }));
      try { await M.ensureContent(r.path); } catch { /* skipped; retried next time */ }
      prefetch.done++; renderStatus();
    }
  } finally { prefetch.running = false; renderStatus(); }
}
const schedulePrefetch = (ms = 6000) => { clearTimeout(prefetchT); prefetchT = setTimeout(prefetchFiles, ms); };
navigator.connection?.addEventListener?.('change', () => { schedulePrefetch(500); if (S.current && S.kind === 'other' && !M.needsApproval(S.current)) showFile(S.current); });
addEventListener('online', () => schedulePrefetch());
document.addEventListener('preview-refresh', () => renderPreview());

/* model changes (local edits, sync downloads) */
let raf, needTree = false;
M.subscribe(kind => {
  needTree ||= kind !== 'content';
  cancelAnimationFrame(raf);
  raf = requestAnimationFrame(() => {
    if (needTree) renderTree();
    needTree = false;
    renderStatus();
    if (M.pendingCount()) scheduleSync();
    const p = S.current; if (!p) return;
    const r = M.files.get(p);
    if (!r || r.deleted) { closeFile(); return; }
    syncHeader();
    if (S.kind === 'text' && !dirtyEd && typeof r.content === 'string' && r.content !== ed.value) {   // updated by a sync
      const [a, b] = [ed.selectionStart, ed.selectionEnd];
      ed.value = r.content; ed.setSelectionRange(Math.min(a, r.content.length), Math.min(b, r.content.length));
      if (pane.dataset.mode !== 'edit') renderPreview();
      updateStats();
    } else if (S.kind !== 'text' && r.sha !== S.shownSha) { S.shownSha = r.sha; renderViewer(p, S.kind); }
  });
});

/* ---------------------------------------------------------------- notes / calendar views */
let calCtl = null;
async function setView(v) {
  if (v === S.view) { if (v === 'calendar' && narrow.matches) closeNav(); return; }
  S.view = v; document.body.dataset.view = v;
  for (const t of document.querySelectorAll('#tabs button')) { const on = t.dataset.view === v; t.classList.toggle('on', on); t.setAttribute('aria-selected', String(on)); }
  if (v === 'calendar') {
    await flush();
    if (!calCtl) { const { initCalendar } = await import('./calendar.js'); calCtl = initCalendar($('#cal'), { openSettings: () => openSettings(false, settingsCtx) }); }
    calCtl.show(); if (narrow.matches) closeNav();
  } else calCtl?.hide();
}

/* ---------------------------------------------------------------- global UI wiring */
const settingsCtx = {
  onWiped: () => { closeFile(); renderTree(); renderStatus(); },
  onConnected: () => { renderStatus(); schedulePoll(); $('#emptyConnect').hidden = true; },
  onPollChanged: schedulePoll,
  onFilesChanged: () => schedulePrefetch(300),
  onHiddenChanged: () => renderTree(),
  onCalendarChanged: () => calCtl?.reloadGoogle?.(),
};
function toggleFocus() {
  const on = document.body.classList.toggle('focus');
  if (!on) document.body.classList.remove('side-hidden');
  toast(on ? 'Focus mode. Press Esc to leave.' : 'Back to normal');
}
$('#btnMenu').addEventListener('click', () => {
  if (narrow.matches) return openNav();
  if (document.body.classList.contains('focus')) return toggleFocus();
  ls.set('side', document.body.classList.toggle('side-hidden'));      // desktop: collapse / expand the notes list
});
if (ls.get('side', false)) document.body.classList.add('side-hidden');
$('#scrim').addEventListener('click', closeNav);
addEventListener('keydown', e => {
  const mod = e.ctrlKey || e.metaKey, k = e.key.toLowerCase();
  if (e.key === 'Escape') { closeNav(); hideMenu(); if (document.body.classList.contains('focus')) toggleFocus(); }
  if (mod && k === 's') { e.preventDefault(); syncNow(); }
  if (mod && k === 'e' && S.kind === 'text' && U.previewOf(S.current)) { e.preventDefault(); setMode(effMode() === 'edit' ? 'preview' : 'edit'); }
  if (mod && k === 'f' && !e.shiftKey && document.activeElement !== ed) { e.preventDefault(); document.body.classList.remove('side-hidden', 'focus'); openNav(); $('#q').focus(); }
});

/* ---------------------------------------------------------------- launch intents (share sheet, shortcut) */
async function handleLaunch() {
  const q = new URLSearchParams(location.search);
  if (![...q.keys()].length) return false;
  history.replaceState(null, '', location.pathname);
  if (q.has('new')) { await newNote(''); return true; }
  const title = q.get('title') || '', text = q.get('text') || '', url = q.get('url') || '';
  if (!title && !text && !url) return false;
  const body = [text, url].filter(Boolean).join('\n') || title;
  const name = U.sanitizeName((title || body.split('\n')[0]).slice(0, 60)) || 'Shared';
  const p = U.uniquePath(`${name}.txt`, M.exists);
  await M.create(p, body + '\n');
  await openFile(p);
  toast('Saved to your notes');
  return true;
}

/* ---------------------------------------------------------------- service worker: auto-update */
function setupServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  let seenController = !!navigator.serviceWorker.controller, reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', async () => {
    if (!seenController) { seenController = true; return; }     // first install taking control: nothing to replace
    if (reloading) return;
    reloading = true;
    await flush();                                               // never lose typing to an update
    location.reload();
  });
  navigator.serviceWorker.register('sw.js').then(reg => { swReg = reg; reg.update().catch(() => {}); }).catch(() => {});
}

/* ---------------------------------------------------------------- boot */
async function boot() {
  const ic = (sel, ...nodes) => $(sel).append(...nodes);
  ic('#btnSync2', icon('sync')); ic('#btnSide', icon('more'));
  ic('#searchIcon', icon('search')); ic('#btnMenu', icon('menu'));
  ic('#btnNote', icon('plus')); ic('#btnMore', icon('more'));
  applyPrefs();
  M.hooks.gate = () => prefs.files === 'smart' && M.metered();
  bindPullToRefresh(treeEl, $('#ptr'), () => G.configured() ? G.sync({ force: true }) : openSettings(true, settingsCtx));

  $('#btnSync2').onclick = $('#status').onclick = syncNow;
  $('#status').onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); syncNow(); } };
  $('#emptyConnect').onclick = () => openSettings(true, settingsCtx);
  $('#btnNote').onclick = () => newNote();
  $('#btnSide').onclick = e => {
    const b = e.currentTarget.getBoundingClientRect();
    showMenu([
      { icon: 'folderPlus', label: 'New folder', run: () => newFolder() },
      { icon: 'upload', label: 'Upload files', run: () => pickUpload() },
      { icon: 'tree', label: 'All files', run: () => openAllFiles(openFile, S.current) },
      '-',
      { icon: 'gear', label: 'Settings', run: () => openSettings(false, settingsCtx) },
    ], b.right, b.bottom + 4, true);
  };
  for (const t of document.querySelectorAll('#tabs button')) t.onclick = () => setView(t.dataset.view);
  $('#btnMore').onclick = e => {
    const b = e.currentTarget.getBoundingClientRect(), p = S.current;
    if (!p) return;
    showMenu([
      S.kind === 'text' && U.isNote(p) && { icon: 'clip', label: 'Attach file', run: pickAttach },
      { icon: 'focus', label: document.body.classList.contains('focus') ? 'Exit focus mode' : 'Focus mode', run: toggleFocus },
      '-', ...fileMenu(p)].filter(Boolean), b.right, b.bottom + 4, true);
  };
  $('#q').addEventListener('input', debounce(e => { S.q = e.target.value.trim(); renderTree(); }, 120));
  $('#q').addEventListener('keydown', e => { if (e.key === 'Escape') { e.target.value = ''; S.q = ''; renderTree(); } });

  const signIn = /[#&](access_token|error)=/.test(location.hash) ? await import('./gcal.js').then(g => g.finishSignIn()) : null;
  await M.load();
  const launched = await handleLaunch();
  const last = ls.get('last', null);
  if (!launched && last && M.exists(last)) { S.current = last; S.dir = U.dirname(last); await showFile(last); }
  renderTree(); renderStatus();
  if (!S.current && narrow.matches) openNav();                   // on a phone, start at the list
  if (G.configured()) { G.sync(); schedulePoll(); }
  else if (!localStorage.getItem('welcomed')) { localStorage.setItem('welcomed', '1'); openSettings(true, settingsCtx); }
  $('#emptyConnect').hidden = G.configured();
  if (signIn) { toast(signIn.email ? `Signed in as ${signIn.email}` : signIn.error); openSettings(false, settingsCtx, { accounts: true }); }
  requestAnimationFrame(() => requestAnimationFrame(() => document.body.classList.remove('booting')));
  const idle = window.requestIdleCallback || (f => setTimeout(f, 1500));
  idle(() => { setupServiceWorker(); T.prune(); });             // after first paint: nothing competes with startup
  if (matchMedia('(display-mode: standalone)').matches) navigator.storage?.persist?.().catch(() => {});   // installed app only: browsers like Firefox show a permission prompt for this
}
boot();
