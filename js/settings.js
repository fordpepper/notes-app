// Settings / connect dialog.
import * as M from './model.js';
import * as G from './sync.js';
import { h, toast } from './dom.js';
import { modal, confirmBox } from './dialogs.js';
import { icon } from './icons.js';
import { prefs, savePrefs, applyPrefs, PALETTES, FONTS, swatch } from './theme.js';

const DOTS = ['teal', 'blue', 'indigo', 'violet', 'rose', 'orange', 'green', 'graphite'];

const SIZES = [[15, 'Small'], [17, 'Medium'], [19, 'Large'], [21, 'Extra large']];
const POLLS = [[60, 'Every minute'], [120, 'Every 2 min'], [300, 'Every 5 min'], [0, 'Manual']];
const THEMES = [['auto', 'Match system'], ['light', 'Light'], ['dark', 'Dark'], ['black', 'Black']];

/** Single-choice chips; `get` reads the current value, `set` stores it. */
function chips(opts, get, set) {
  const box = h('div', { class: 'chips', role: 'radiogroup' });
  const paint = () => box.replaceChildren(...opts.map(([v, label]) => {
    const on = String(get()) === String(v);
    return h('button', { type: 'button', class: 'chip' + (on ? ' on' : ''), role: 'radio', 'aria-checked': String(on), onclick: () => { set(v); paint(); } }, on && icon('tick'), label);
  }));
  paint();
  return box;
}

/** ctx: { onWiped(): the local copy was erased, onConnected(): connection saved } */
export function openSettings(first, ctx) {
  const old = G.getCfg() || null, cfg = old || {};
  return modal((d, close) => {
    const field = (label, input, hint) => h('label', { class: 'field' }, label, input, hint && h('small', {}, hint));
    const repo = h('input', { value: cfg.owner ? `${cfg.owner}/${cfg.repo}` : '', placeholder: 'yourname/notes', autocomplete: 'off', spellcheck: 'false', autocapitalize: 'off' });
    const token = h('input', { type: 'password', value: cfg.token || '', placeholder: 'github_pat_…', autocomplete: 'off', spellcheck: 'false' });
    const branch = h('input', { value: cfg.branch || '', placeholder: 'default branch', autocapitalize: 'off', spellcheck: 'false' });
    const root = h('input', { value: cfg.root || '', placeholder: 'whole repo', autocapitalize: 'off', spellcheck: 'false' });

    // Appearance and layout apply (and save) immediately.
    const set = (k, v) => { prefs[k] = v; savePrefs(); applyPrefs(); };
    const group = (title, ...kids) => h('div', { class: 'group' }, h('h4', {}, title), ...kids);
    const labelled = (label, el) => h('div', { class: 'field' }, label, el);

    const palBox = h('div', { class: 'palettes', role: 'radiogroup', 'aria-label': 'Accent colour' });
    const paintPal = () => {
      const dot = (id, bg, label) => h('button', { type: 'button', class: 'pal' + (prefs.palette === id ? ' on' : ''), 'data-id': id, role: 'radio', 'aria-checked': String(prefs.palette === id), 'aria-label': label, style: `background:${bg}`,
        onclick: () => { set('palette', id); paintPal(); } }, icon('tick'));
      const custom = h('label', { class: 'pal custom' + (prefs.palette === 'custom' ? ' on' : ''), 'data-id': 'custom', title: 'Pick any colour' }, icon('tick'),
        h('input', { type: 'color', value: prefs.seeds[0] || '#0e8f7e', 'aria-label': 'Custom colour', oninput: e => { prefs.seeds = [e.target.value, '', '']; set('palette', 'custom'); } , onchange: () => paintPal() }));
      palBox.replaceChildren(...DOTS.map(id => dot(id, swatch(PALETTES[id].seeds)[0], PALETTES[id].name)), custom);
    };
    paintPal();

    const err = h('div', { class: 'err', role: 'alert' });
    const save = h('button', { class: 'primary' }, G.configured() ? 'Save' : 'Connect');
    const form = h('form', {
      onsubmit: async e => {
        e.preventDefault(); err.textContent = '';
        if (!repo.value.trim() && !token.value.trim()) return close(true);
        const r = G.parseRepo(repo.value);
        if (!r) { err.textContent = 'Enter the repo as owner/name.'; return; }
        if (!token.value.trim()) { err.textContent = 'Paste an access token.'; return; }
        const next = { token: token.value.trim(), ...r, branch: branch.value.trim(), root: G.normRoot(root.value) };
        const same = old && ['token', 'owner', 'repo', 'branch', 'root'].every(k => (old[k] || '') === next[k]);
        if (same) return close(true);
        save.disabled = true; save.textContent = 'Checking…';
        try {
          const info = await G.testConnection(next);
          const changedRepo = old && ['owner', 'repo', 'branch', 'root'].some(k => (old[k] || '') !== next[k]);
          if (changedRepo && !(await confirmBox({ title: 'Switch repository?', body: 'This device’s local copy will be replaced with the new repo. Changes not yet synced will be lost.', ok: 'Switch', danger: true }))) {
            save.disabled = false; save.textContent = 'Save'; return;
          }
          if (changedRepo) { await M.wipe(); ctx.onWiped(); }
          G.setCfg(next);
          close(true);
          toast(info.private ? 'Connected to your private repo' : 'Connected');
          ctx.onConnected();
          G.sync({ force: true });
        } catch (ex) {
          err.textContent = ex.status === 401 ? 'GitHub rejected that token.' : ex.status === 404 ? 'Repo not found. Check the name, and that the token has access to it.' : (ex instanceof TypeError ? 'No connection to GitHub.' : ex.message || 'Could not connect');
          save.disabled = false; save.textContent = G.configured() ? 'Save' : 'Connect';
        }
      },
    },
      h('div', { class: 'mbody' },
        h('h3', {}, first ? 'Connect your notes repo' : 'Settings'),
        first && h('p', {}, 'Notes stay on this device and sync with a GitHub repo. You can skip this and use the app offline for now.'),
        h('details', { class: 'sect', open: !G.configured() },
          h('summary', {}, 'GitHub', h('small', {}, cfg.owner ? `${cfg.owner}/${cfg.repo}` : 'Not connected')),
          h('div', { class: 'group' },
            field('Repository', repo),
            field('Access token', token, h('span', {}, 'Create a ', h('a', { href: 'https://github.com/settings/personal-access-tokens/new', target: '_blank', rel: 'noopener' }, 'fine-grained token'), ' for just your notes repo with ', h('b', {}, 'Contents: Read and write'), '. It stays on this device.')),
            field('Branch', branch), field('Folder inside the repo', root, 'Only sync this subfolder, e.g. “notes”. Empty = whole repo.'))),
        group('Appearance',
          labelled('Theme', chips(THEMES, () => prefs.theme, v => set('theme', v))),
          labelled('Accent colour', palBox),
          labelled('Text size', chips(SIZES, () => prefs.size, v => set('size', +v)))),
        h('details', { class: 'sect' },
          h('summary', {}, 'More'),
          h('div', { class: 'group' },
            labelled('Font', chips(FONTS, () => prefs.font, v => set('font', v))),
            labelled('Check for updates', chips(POLLS, () => prefs.poll, v => { set('poll', +v); ctx.onPollChanged?.(); })),
            old && h('button', { type: 'button', class: 'ghost', onclick: () => { G.resetState(); close(true); toast('Checking everything against GitHub…'); G.sync({ force: true }); } }, 'Full resync'))),
        err),
      h('div', { class: 'mfoot' },
        old && h('button', { type: 'button', class: 'danger', style: 'margin-right:auto', onclick: async () => {
          const n = M.pendingCount();
          if (!await confirmBox({ title: 'Disconnect and erase local copy?', body: n ? `${n} change${n > 1 ? 's' : ''} haven’t synced yet and will be lost. Your GitHub repo is untouched.` : 'Your GitHub repo is untouched.', ok: 'Erase', danger: true })) return;
          G.setCfg(null); await M.wipe(); ctx.onWiped(); close(true);
        } }, 'Disconnect'),
        h('button', { type: 'button', class: 'text', onclick: () => close(null) }, first ? 'Later' : 'Close'), save));
    d.classList.add('full');
    d.append(form);
  });
}
