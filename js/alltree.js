// "All files": the whole repo as one tree, with sizes and whether each file is on this device yet.
import * as M from './model.js';
import * as U from './util.js';
import { h, fmtSize } from './dom.js';
import { icon } from './icons.js';
import { modal } from './dialogs.js';

function build(showHidden, q) {
  const root = { name: '', path: '', dirs: new Map(), files: [], size: 0, count: 0, remote: 0 };
  const needle = q.trim().toLowerCase();
  for (const r of M.files.values()) {
    if (r.deleted || (!showHidden && U.isHidden(r.path)) || (needle && !r.path.toLowerCase().includes(needle))) continue;
    const size = M.sizeOf(r) ?? 0, here = M.isLocal(r);
    let n = root; n.size += size; n.count++; if (!here) n.remote += size;
    const parts = r.path.split('/');
    for (let i = 0; i < parts.length - 1; i++) {
      let d = n.dirs.get(parts[i]);
      if (!d) { d = { name: parts[i], path: U.join(n.path, parts[i]), dirs: new Map(), files: [], size: 0, count: 0, remote: 0 }; n.dirs.set(parts[i], d); }
      n = d; n.size += size; n.count++; if (!here) n.remote += size;
    }
    n.files.push(r);
  }
  return root;
}

export function openAllFiles(onOpen, current) {
  return modal((d, close) => {
    d.classList.add('full', 'alltree');
    const expanded = new Set(), listEl = h('div', { class: 'tlist', role: 'tree' }), stats = h('p', { class: 'tstats' });
    let showHidden = false, q = '';
    for (let p = U.dirname(current || ''); p; p = U.dirname(p)) expanded.add(p);
    const walkDirs = n => [n, ...[...n.dirs.values()].flatMap(walkDirs)];
    const paint = () => {
      const root = build(showHidden, q), rows = [];
      stats.textContent = root.count ? `${root.count.toLocaleString()} file${root.count === 1 ? '' : 's'} · ${fmtSize(root.size)}${root.remote ? ` · ${fmtSize(root.remote)} not on this device yet` : ''}` : 'No files';
      const walk = (n, depth) => {
        for (const dir of [...n.dirs.values()].sort((a, b) => U.naturalCmp(a.name, b.name))) {
          const open = q.trim() || expanded.has(dir.path);
          rows.push(h('div', { class: 'trow dir' + (open ? ' open' : ''), style: `--d:${depth}`, role: 'treeitem', 'aria-expanded': String(!!open), tabindex: '0', onclick: () => { expanded.has(dir.path) ? expanded.delete(dir.path) : expanded.add(dir.path); paint(); } },
            icon('chev', 'chev'), icon('folder', 'fi'), h('span', { class: 'name' }, dir.name), h('span', { class: 'meta' }, `${dir.count} · ${fmtSize(dir.size)}`)));
          if (open) walk(dir, depth + 1);
        }
        for (const r of n.files.sort((a, b) => U.naturalCmp(a.path, b.path))) {
          const here = M.isLocal(r), size = M.sizeOf(r);
          rows.push(h('div', { class: 'trow file' + (here ? '' : ' remote') + (r.path === current ? ' active' : ''), style: `--d:${depth}`, role: 'treeitem', tabindex: '0', title: r.path, onclick: () => { close(true); onOpen(r.path); } },
            h('span', { class: 'sp' }), icon(U.iconOf(r.path, r), 'fi'), h('span', { class: 'name' }, U.basename(r.path)),
            h('span', { class: 'meta' }, size == null ? '' : fmtSize(size)), here ? h('span', { class: 'st' }) : icon('cloud', 'st cloud')));
        }
      };
      walk(root, 0);
      listEl.replaceChildren(...(rows.length ? rows : [h('div', { class: 'empty-tree' }, 'Nothing here')]));
    };
    const search = h('input', { type: 'search', placeholder: 'Filter files', 'aria-label': 'Filter files', autocomplete: 'off', oninput: e => { q = e.target.value; paint(); } });
    const hid = h('button', { type: 'button', class: 'chip', onclick: e => { showHidden = !showHidden; e.currentTarget.classList.toggle('on', showHidden); paint(); } }, 'Hidden files');
    d.append(h('div', { class: 'mbody' }, h('h3', {}, 'All files'), stats,
      h('div', { class: 'ttools' }, search, h('button', { type: 'button', class: 'text', onclick: () => { walkDirs(build(showHidden, '')).forEach(n => n.path && expanded.add(n.path)); paint(); } }, 'Expand all'),
        h('button', { type: 'button', class: 'text', onclick: () => { expanded.clear(); paint(); } }, 'Collapse all'), hid), listEl),
      h('div', { class: 'mfoot' }, h('button', { type: 'button', class: 'text', onclick: () => close(null) }, 'Close')));
    paint();
    setTimeout(() => listEl.querySelector('.active')?.scrollIntoView({ block: 'center' }), 30);
  });
}
