// "All files": the whole repo drawn as a real tree (branch lines), with sizes and whether each file is on this device yet.
import * as M from './model.js';
import * as U from './util.js';
import * as G from './sync.js';
import { h, fmtSize } from './dom.js';
import { icon } from './icons.js';
import { modal } from './dialogs.js';
import { prefs } from './theme.js';

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
    const expanded = new Set(), treeEl = h('ul', { class: 'ttree', role: 'tree' }), stats = h('p', { class: 'tstats' });
    let q = '';
    for (let p = U.dirname(current || ''); p; p = U.dirname(p)) expanded.add(p);
    const allDirs = n => [n, ...[...n.dirs.values()].flatMap(allDirs)];
    const cfg = G.getCfg(), rootName = cfg ? `${cfg.owner}/${cfg.repo}` : 'This device';
    const paint = () => {
      const root = build(prefs.hidden, q);
      stats.textContent = root.count ? `${root.count.toLocaleString()} file${root.count === 1 ? '' : 's'} · ${fmtSize(root.size)}${root.remote ? ` · ${fmtSize(root.remote)} not on this device yet` : ''}` : 'No files';
      const branch = n => {
        const ul = h('ul', { role: 'group' });
        for (const dir of [...n.dirs.values()].sort((a, b) => U.naturalCmp(a.name, b.name))) {
          const open = q.trim() || expanded.has(dir.path);
          const li = h('li', { class: 'dir' + (open ? ' open' : ''), role: 'treeitem', 'aria-expanded': String(!!open) },
            h('div', { class: 'tn', tabindex: '0', onclick: () => { expanded.has(dir.path) ? expanded.delete(dir.path) : expanded.add(dir.path); paint(); }, onkeydown: e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.currentTarget.click(); } } },
              icon('folder', 'fi'), h('span', { class: 'name' }, dir.name), h('span', { class: 'meta' }, `${dir.count} · ${fmtSize(dir.size)}`)));
          if (open) li.append(branch(dir));
          ul.append(li);
        }
        for (const r of n.files.sort((a, b) => U.naturalCmp(a.path, b.path))) {
          const here = M.isLocal(r), size = M.sizeOf(r);
          ul.append(h('li', { class: 'file' + (here ? '' : ' remote') + (r.path === current ? ' active' : ''), role: 'treeitem' },
            h('div', { class: 'tn', tabindex: '0', title: r.path, onclick: () => { close(true); onOpen(r.path); }, onkeydown: e => { if (e.key === 'Enter') e.currentTarget.click(); } },
              icon(U.iconOf(r.path, r), 'fi'), h('span', { class: 'name' }, U.basename(r.path)), h('span', { class: 'meta' }, size == null ? '' : fmtSize(size)), here ? h('span', { class: 'st' }) : icon('cloud', 'st cloud'))));
        }
        return ul;
      };
      treeEl.replaceChildren(h('li', { class: 'root open', role: 'treeitem', 'aria-expanded': 'true' }, h('div', { class: 'tn rootrow' }, icon('folder', 'fi'), h('span', { class: 'name' }, rootName)), root.count ? branch(root) : h('div', { class: 'empty-tree' }, 'Nothing here')));
    };
    const search = h('input', { type: 'search', placeholder: 'Filter files', 'aria-label': 'Filter files', autocomplete: 'off', oninput: e => { q = e.target.value; paint(); } });
    d.append(h('div', { class: 'mbody' }, h('h3', {}, 'All files'), stats,
      h('div', { class: 'ttools' }, search, h('button', { type: 'button', class: 'text', onclick: () => { allDirs(build(prefs.hidden, '')).forEach(n => n.path && expanded.add(n.path)); paint(); } }, 'Expand all'),
        h('button', { type: 'button', class: 'text', onclick: () => { expanded.clear(); paint(); } }, 'Collapse all')), h('div', { class: 'tlist' }, treeEl)),
      h('div', { class: 'mfoot' }, h('button', { type: 'button', class: 'text', onclick: () => close(null) }, 'Close')));
    paint();
    setTimeout(() => treeEl.querySelector('.active')?.scrollIntoView({ block: 'center' }), 30);
  });
}
