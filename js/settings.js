// Settings / connect dialog.
import * as M from './model.js';
import * as G from './sync.js';
import { h, toast } from './dom.js';
import { modal, confirmBox } from './dialogs.js';
import { icon } from './icons.js';
import * as GC from './gcal.js';
import * as FD from './feeds.js';
import { prefs, savePrefs, applyPrefs, PALETTES, swatch } from './theme.js';
import * as V from './vault.js';

const DOTS = ['teal', 'blue', 'indigo', 'violet', 'rose', 'orange', 'green', 'graphite'];

const SIZES = [[15, 'Small'], [17, 'Medium'], [19, 'Large'], [21, 'Extra large']];
const FILES = [['smart', 'Smart'], ['manual', 'Only when opened'], ['always', 'Always']];
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

/** Asks for a passphrase (twice when creating one). Resolves with the passphrase, or null if cancelled. */
function askPass({ title, body, ok, again }) {
  return modal((d, close) => {
    const a = h('input', { type: 'password', autocomplete: again ? 'new-password' : 'current-password', placeholder: 'Passphrase', 'aria-label': 'Passphrase' });
    const b = again && h('input', { type: 'password', autocomplete: 'new-password', placeholder: 'Repeat passphrase', 'aria-label': 'Repeat passphrase' });
    const err = h('div', { class: 'err', role: 'alert' });
    d.append(h('form', { onsubmit: e => {
      e.preventDefault();
      if (again && a.value.length < 8) { err.textContent = 'Use at least 8 characters.'; return; }
      if (again && a.value !== b.value) { err.textContent = 'The two passphrases differ.'; return; }
      if (!a.value) return;
      close(a.value);
    } }, h('div', { class: 'mbody' }, h('h3', {}, title), h('p', {}, body), a, b, err),
    h('div', { class: 'mfoot' }, h('button', { type: 'button', class: 'text', onclick: () => close(null) }, 'Cancel'), h('button', { class: 'primary' }, ok))));
    setTimeout(() => a.focus(), 30);
  });
}
const pickFile = accept => new Promise(res => {
  const i = h('input', { type: 'file', accept, style: 'position:fixed;left:-9999px;top:0;opacity:0' }), done = f => { i.remove(); res(f); };
  i.onchange = () => done(i.files[0] || null);                  // a cancelled picker just leaves this idle input behind; it goes away with the dialog
  (document.querySelector('dialog[open]') || document.body).append(i); i.click();                         // must be in the page: Firefox does not fire change for detached inputs
});
const download = (name, text) => { const a = h('a', { href: URL.createObjectURL(new Blob([text], { type: 'application/json' })), download: name }); document.body.append(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000); };

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

    /* ---- accounts: GitHub + any number of Google accounts, then one row of buttons ---- */
    const accErr = h('div', { class: 'err', role: 'alert' }), accRows = h('div', { class: 'accts' }), calBox = h('div', { class: 'group' }), accSum = h('small', {}), calSum = h('small', {});
    const clientId = h('input', { value: GC.state().clientId, placeholder: 'xxxx.apps.googleusercontent.com', autocomplete: 'off', spellcheck: 'false', autocapitalize: 'off', 'aria-label': 'Google OAuth client ID', onchange: e => GC.setClientId(e.target.value) });
    const changed = () => { paintAccounts(); ctx.onCalendarChanged?.(); };
    const guard = fn => async () => { accErr.textContent = ''; try { await fn(); } catch (e) { accErr.textContent = e.message; } };
    const acct = (name, sub, ...btns) => h('div', { class: 'acct' }, h('div', {}, h('b', {}, name), h('small', {}, sub)), ...btns);
    function paintAccounts() {
      const gs = GC.accounts();
      accSum.textContent = [cfg.owner ? 'GitHub' : '', gs.length ? `${gs.length} Google` : ''].filter(Boolean).join(' · ') || 'None yet';
      accRows.replaceChildren(
        old && acct('GitHub', `${old.owner}/${old.repo}`, h('button', { type: 'button', class: 'text', onclick: async () => {
          const n = M.pendingCount();
          if (!await confirmBox({ title: 'Disconnect and erase local copy?', body: n ? `${n} change${n > 1 ? 's' : ''} haven’t synced yet and will be lost. Your GitHub repo is untouched.` : 'Your GitHub repo is untouched.', ok: 'Erase', danger: true })) return;
          G.setCfg(null); await M.wipe(); ctx.onWiped(); close(true);
        } }, 'Disconnect')),
        ...gs.map(a => acct(a.email, GC.live(a) ? 'Google · connected' : 'Google · sign in again',
          !GC.live(a) && h('button', { type: 'button', class: 'text', onclick: guard(async () => { await GC.connect(a.email); changed(); }) }, 'Sign in'),
          h('button', { type: 'button', class: 'text', onclick: async () => { await GC.disconnect(a.email); changed(); } }, 'Remove'))));
      const live = gs.filter(GC.live);
      calSum.textContent = gs.length ? `${live.reduce((n, a) => n + a.calendars.filter(c => c.on).length, 0)} shown` : 'Notes only';
      calBox.replaceChildren(
        h('p', {}, 'Events you add here are saved in calendar.ics in your notes repo and work offline. Add a Google account (above) to see and edit its calendars too.'),
        ...live.flatMap(a => [h('h5', {}, a.email), ...a.calendars.map(c => h('label', { class: 'setting calsel' }, h('span', { class: 'cdot', style: `background:${c.color}` }), c.name,
          h('input', { type: 'checkbox', class: 'switch', checked: c.on, onchange: e => { GC.setCalendarOn(a.email, c.id, e.target.checked); ctx.onCalendarChanged?.(); } })))]));
    }
    paintAccounts();
    const addGoogle = guard(async () => {
      GC.setClientId(clientId.value);
      if (!GC.hasClientId()) { adv.open = true; clientId.focus(); throw new Error('Google sign-in needs a client ID. Paste one here; the steps are in the README.'); }
      await GC.connect(); changed();
    });
    const linksArea = h('textarea', { rows: 3, class: 'links', placeholder: 'Work | https://calendar.google.com/calendar/ical/…/basic.ics', spellcheck: 'false', autocapitalize: 'off', 'aria-label': 'Calendar links', 
      onchange: async e => { try { await FD.saveLinks(e.target.value); paintLinks(); ctx.onCalendarChanged?.(); if (G.configured()) G.sync({ force: true }); } catch (ex) { accErr.textContent = ex.message; } } });
    linksArea.value = FD.linksText();
    const linkNote = h('div', { class: 'linknote' });
    function paintLinks() {
      const n = FD.parseLinks(linksArea.value).length;
      linkNote.replaceChildren(...(!n ? [] : !G.configured() ? ['Connect GitHub first, so the links can be fetched.'] : FD.hasWorkflow() ? [`${n} calendar${n > 1 ? 's' : ''}, updated about every 15 minutes.`]
        : [h('a', { class: 'tonal btn', href: FD.workflowUrl(G.getCfg()), target: '_blank', rel: 'noopener' }, 'Turn on automatic updates'), h('small', {}, 'Opens GitHub with the file filled in. Press “Commit new file”, once.')]));
    }
    paintLinks();
    const importCal = guard(async () => {
      const f = await pickFile('.ics,text/calendar'); if (!f) return;
      const { importEvents } = await import('./calendar.js'), r = await importEvents(await f.text());
      toast(r.added ? `Added ${r.added} event${r.added > 1 ? 's' : ''} to your calendar` : 'Those events were already there'); ctx.onCalendarChanged?.();
    });
    const exportAll = guard(async () => {
      const pass = await askPass({ title: 'Export settings', body: 'Everything is saved in one file: GitHub repo and token, Google client ID and accounts, colours and other settings. The file is encrypted with this passphrase, so write it down.', ok: 'Export', again: true });
      if (!pass) return;
      const data = { cfg: G.getCfg(), prefs, gcal: GC.exportState() };
      download(`notes-settings-${new Date().toISOString().slice(0, 10)}.notesvault`, await V.seal(data, pass));
      toast('Settings exported');
    });
    const importAll = guard(async () => {
      const f = await pickFile('.notesvault,application/json,.json'); if (!f) return;
      const text = await f.text(), pass = await askPass({ title: 'Import settings', body: 'Enter the passphrase you chose when exporting.', ok: 'Import' });
      if (!pass) return;
      const data = await V.open(text, pass);
      if (!await confirmBox({ title: 'Replace settings on this device?', body: 'GitHub, Google accounts and appearance will be replaced by the file’s. Your notes then sync from the same repo.', ok: 'Import' })) return;
      const cur = G.getCfg(), nxt = data.cfg, other = !!cur && (!nxt || ['owner', 'repo', 'branch', 'root'].some(k => (cur[k] || '') !== (nxt[k] || '')));
      if (other) await M.wipe();
      G.setCfg(nxt || null);
      if (data.prefs) localStorage.setItem('prefs', JSON.stringify(data.prefs));
      localStorage.removeItem('tv');
      GC.importState(data.gcal);
      location.reload();
    });

    const adv = h('details', { class: 'adv', open: !G.configured() || first },
      h('summary', {}, G.configured() ? 'Repository, token and Google client ID' : 'Repository and token'),
      field('GitHub repository', repo), field('GitHub access token', token, h('span', {}, 'Create a ', h('a', { href: 'https://github.com/settings/personal-access-tokens/new', target: '_blank', rel: 'noopener' }, 'fine-grained token'), ' for just your notes repo with ', h('b', {}, 'Contents: Read and write'), '. It stays on this device.')),
      field('Branch', branch), field('Folder inside the repo', root, 'Only sync this subfolder, e.g. “notes”. Empty = whole repo.'),
      field(GC.DEFAULT_CLIENT_ID ? 'Own Google client ID (optional)' : 'Google OAuth client ID', clientId, h('span', {}, GC.DEFAULT_CLIENT_ID ? 'Not needed: the app already has one. Only fill this in to use your own Google project. ' : 'Needed once to add Google accounts. ', 'Create a “Web application” client in ', h('a', { href: 'https://console.cloud.google.com/apis/credentials', target: '_blank', rel: 'noopener' }, 'Google Cloud Console'), ', turn on the Google Calendar API and add ', h('b', {}, location.origin), ' as an authorised JavaScript origin.')));
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
        h('details', { class: 'sect', open: !G.configured() || first },
          h('summary', {}, 'Accounts', accSum),
          h('div', { class: 'group' },
            accRows,
            adv,
            h('div', { class: 'btnrow' },
              h('button', { type: 'button', class: 'tonal', id: 'addGoogle', onclick: addGoogle }, 'Add Google account'),
              h('button', { type: 'button', class: 'tonal', onclick: importCal, title: 'For example exported from Apple Calendar' }, 'Import calendar file'),
              h('button', { type: 'button', class: 'tonal', onclick: exportAll }, 'Export settings'),
              h('button', { type: 'button', class: 'tonal', onclick: importAll }, 'Import settings')),
            accErr)),
        group('Appearance',
          labelled('Theme', chips(THEMES, () => prefs.theme, v => set('theme', v))),
          labelled('Accent colour', palBox),
          labelled('Text size', chips(SIZES, () => prefs.size, v => set('size', +v))),
          labelled('Hidden files', chips([[true, 'Show'], [false, 'Hide']], () => prefs.hidden, v => { set('hidden', v === true || v === 'true'); ctx.onHiddenChanged?.(); }))),
        h('details', { class: 'sect' }, h('summary', {}, 'Calendars', calSum), calBox,
          h('div', { class: 'group' }, h('h5', {}, 'Calendar links, no sign-in'),
            h('p', {}, 'Google Calendar → Settings → your calendar → Integrate calendar → “Secret address in iCal format”. Paste it here, one per line, optionally as “Name | link”. Public iCloud and Outlook calendar links work too. These calendars are read-only. Keep your notes repo private: the link gives read access to that calendar.'),
            linksArea, linkNote)),
        h('details', { class: 'sect' },
          h('summary', {}, 'More'),
          h('div', { class: 'group' },
            labelled('Files', chips(FILES, () => prefs.files, v => { set('files', v); ctx.onFilesChanged?.(); })),
            h('p', {}, 'Notes are always kept on the device. Smart: other files download by themselves on Wi-Fi and ask first on mobile data.'),
            labelled('Check for updates', chips(POLLS, () => prefs.poll, v => { set('poll', +v); ctx.onPollChanged?.(); })),
            old && h('button', { type: 'button', class: 'ghost', onclick: () => { G.resetState(); close(true); toast('Checking everything against GitHub…'); G.sync({ force: true }); } }, 'Full resync'))),
        err),
      h('div', { class: 'mfoot' },
        h('button', { type: 'button', class: 'text', onclick: () => close(null) }, first ? 'Later' : 'Close'), save));
    d.classList.add('full');
    d.append(form);
  });
}
