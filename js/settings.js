// Settings / connect dialog.
import * as M from './model.js';
import * as G from './sync.js';
import { h, toast } from './dom.js';
import { modal, confirmBox } from './dialogs.js';
import { prefs, savePrefs, applyPrefs, ACCENTS } from './theme.js';

const SIZES = [[15, 'Small'], [16, 'Medium'], [18, 'Large'], [20, 'Extra large']];
const POLLS = [[60, 'Every minute'], [120, 'Every 2 minutes'], [300, 'Every 5 minutes'], [0, 'Only when I tap sync']];

const select = (opts, current, onChange) => h('select', { onchange: e => onChange(e.target.value) },
  opts.map(([v, label]) => h('option', { value: v, selected: String(v) === String(current) }, label)));

/** ctx: { onWiped(): the local copy was erased, onConnected(): connection saved } */
export function openSettings(first, ctx) {
  const old = G.getCfg() || null, cfg = old || {};
  return modal((d, close) => {
    const field = (label, input, hint) => h('label', { class: 'field' }, label, input, hint && h('small', {}, hint));
    const repo = h('input', { value: cfg.owner ? `${cfg.owner}/${cfg.repo}` : '', placeholder: 'yourname/notes', autocomplete: 'off', spellcheck: 'false', autocapitalize: 'off' });
    const token = h('input', { type: 'password', value: cfg.token || '', placeholder: 'github_pat_…', autocomplete: 'off', spellcheck: 'false' });
    const branch = h('input', { value: cfg.branch || '', placeholder: 'default branch', autocapitalize: 'off', spellcheck: 'false' });
    const root = h('input', { value: cfg.root || '', placeholder: 'whole repo', autocapitalize: 'off', spellcheck: 'false' });

    // Appearance applies (and saves) immediately.
    const set = (k, v) => { prefs[k] = v; savePrefs(); applyPrefs(); };
    const swatches = h('div', { class: 'swatches' });
    const color = h('input', { type: 'color', value: prefs.accent, 'aria-label': 'Custom colour', oninput: e => { set('accent', e.target.value); paint(); } });
    const paint = () => {
      swatches.replaceChildren(...ACCENTS.map(c => h('button', { type: 'button', class: c === prefs.accent ? 'on' : '', style: `background:${c};color:${c}`, 'aria-label': c, onclick: () => { set('accent', c); color.value = c; paint(); } })), h('label', { class: 'custom' + (ACCENTS.includes(prefs.accent) ? '' : ' on'), title: 'Custom colour' }, color));
    };
    paint();

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
        h('div', { class: 'group' },
          field('Repository', repo),
          field('Access token', token, h('span', {}, 'Create a ', h('a', { href: 'https://github.com/settings/personal-access-tokens/new', target: '_blank', rel: 'noopener' }, 'fine-grained token'), ' for just your notes repo with ', h('b', {}, 'Contents: Read and write'), '. It stays on this device.')),
          h('details', {}, h('summary', {}, 'Advanced'),
            h('div', { class: 'group' }, field('Branch', branch), field('Folder inside the repo', root, 'Only sync this subfolder, e.g. “notes”. Empty = whole repo.')))),
        h('div', { class: 'group' },
          h('h4', {}, 'Appearance'),
          field('Theme', select([['auto', 'Match system'], ['light', 'Light'], ['dark', 'Dark'], ['black', 'Black (OLED)']], prefs.theme, v => set('theme', v))),
          h('div', { class: 'field' }, 'Accent colour', swatches),
          field('Text size', select(SIZES, prefs.size, v => set('size', +v)))),
        h('div', { class: 'group' },
          h('h4', {}, 'Sync'),
          field('Check for changes', select(POLLS, prefs.poll, v => { set('poll', +v); ctx.onPollChanged?.(); }), 'Checking is nearly free (a tiny request), and always happens when you open the app. Edits are pushed a few seconds after you stop typing.'),
          old && h('button', { type: 'button', class: 'ghost', onclick: () => { G.resetState(); close(true); toast('Checking everything against GitHub…'); G.sync({ force: true }); } }, 'Full resync (if something looks wrong)')),
        err),
      h('div', { class: 'mfoot' },
        old && h('button', { type: 'button', class: 'danger', style: 'margin-right:auto', onclick: async () => {
          const n = M.pendingCount();
          if (!await confirmBox({ title: 'Disconnect and erase local copy?', body: n ? `${n} change${n > 1 ? 's' : ''} haven’t synced yet and will be lost. Your GitHub repo is untouched.` : 'Your GitHub repo is untouched.', ok: 'Erase', danger: true })) return;
          G.setCfg(null); await M.wipe(); ctx.onWiped(); close(true);
        } }, 'Disconnect'),
        h('button', { type: 'button', class: 'ghost', onclick: () => close(null) }, first ? 'Later' : 'Close'), save));
    d.append(form);
  });
}
