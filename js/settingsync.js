// Keeps colours, preferences and the Google account list (never tokens) identical on every device, through the repo file .notes-app.json.
// The newest change wins. Each device signs in to Google itself; known accounts are renewed quietly where Google allows it.
import * as M from './model.js';
import * as G from './sync.js';
import * as GC from './gcal.js';
import { prefs, applyPrefs, savePrefs } from './theme.js';
import { ls } from './dom.js';

const snap = () => ({ prefs: { ...prefs }, gcal: GC.exportState() });
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
let applying = false, timer = 0;

export function initSettingsSync({ onApplied }) {
  const push = async () => {
    if (!G.configured()) return;
    const data = snap(), remote = M.getSettings();
    if (remote && same(remote.data, data)) return;
    const t = Math.max(Date.now(), (remote?.t || 0) + 1);
    ls.set('settings-t', t);
    await M.setSettings({ t, data });
  };
  const pull = () => {
    const remote = M.getSettings();
    if (!remote) return;
    if (remote.t <= ls.get('settings-t', 0) || same(remote.data, snap())) { if (remote.t > ls.get('settings-t', 0)) ls.set('settings-t', remote.t); return; }
    let arrived = [];
    applying = true;
    try {
      const d = remote.data;
      if (d.prefs) { for (const k of Object.keys(prefs)) delete prefs[k]; Object.assign(prefs, d.prefs); savePrefs(); applyPrefs(); }
      if (d.gcal) { arrived = (d.gcal.accounts || []).map(a => a.email).filter(e => !GC.account(e)); GC.applySynced(d.gcal); }
      ls.set('settings-t', remote.t);
    } finally { applying = false; }
    onApplied?.();
    // a new account from another device signs itself in (one quick visit to Google), unless you're in the middle of typing
    if (arrived.length && navigator.onLine && !document.activeElement?.matches?.('textarea, input')) GC.signInArrived(arrived);
  };
  const schedule = () => { clearTimeout(timer); timer = setTimeout(() => push().catch(console.warn), 1500); };
  document.addEventListener('settings-local', () => { if (!applying) { ls.set('settings-t', Date.now()); schedule(); } });
  M.subscribe(kind => { if (kind === 'tree') pull(); });
  // after each completed sync: publish local changes the repo doesn't have yet (also ones made before this module started, e.g. a sign-in that reloaded the page)
  G.onStatus(() => {
    if (G.status.state !== 'idle' || !G.configured() || applying) return;
    const remote = M.getSettings();
    if (!remote || (remote.t <= ls.get('settings-t', 0) && !same(remote.data, snap()))) schedule();
  });
  pull();
}
