// Calendar view: a month grid with a day list. Events live in `calendar.ics` in the notes repo (synced like any note);
// Google Calendar events are shown and edited too when an account is connected (optional).
import * as M from './model.js';
import * as I from './ics.js';
import * as GC from './gcal.js';
import { h, toast } from './dom.js';
import { icon } from './icons.js';
import { modal, confirmBox } from './dialogs.js';

export const FILE = 'calendar.ics';
const pad = n => String(n).padStart(2, '0');
const localEvents = () => { const r = M.files.get(FILE); return r && !r.deleted && typeof r.content === 'string' ? I.parseICS(r.content) : []; };
async function saveLocal(events) { const text = I.toICS(events); M.exists(FILE) ? await M.saveText(FILE, text) : await M.create(FILE, text); }
const firstDay = () => { try { const l = new Intl.Locale(navigator.language), w = l.weekInfo || l.getWeekInfo?.(); return (w?.firstDay ?? 1) % 7; } catch { return 1; } };
const sameDay = (a, b) => I.dkey(a) === I.dkey(b);
const fmtTime = k => I.parseKey(k).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

export function initCalendar(root, { openSettings }) {
  let month = new Date(); month.setDate(1); month.setHours(0, 0, 0, 0);
  let selected = new Date(), open = false, gevents = [], gkey = '', loading = false, error = '';

  const range = () => { const first = new Date(month), off = (first.getDay() - firstDay() + 7) % 7, start = I.addDays(first, -off); return { start, end: I.addDays(start, 42) }; };
  const all = () => {
    const { start, end } = range();
    const local = localEvents().flatMap(e => I.occurrences(e, start, end));
    const g = GC.connected() || GC.expired() ? gevents : [];
    return [...local, ...g];
  };
  const onDay = (evs, day) => {
    const k = I.dkey(day);
    return evs.filter(e => { const s = e.start.slice(0, 10); let en = e.end.slice(0, 10); if (e.allDay || (e.end.slice(11) === '00:00' && en > s)) { en = I.dkey(I.addDays(I.parseKey(en), -1)); } return s <= k && k <= (en < s ? s : en); })
      .sort((a, b) => (b.allDay - a.allDay) || a.start.localeCompare(b.start));
  };

  async function loadGoogle() {
    if (!GC.connected()) { gevents = GC.expired() ? gevents : []; error = GC.expired() ? 'Google session expired.' : ''; render(); return; }
    const { start, end } = range(), cals = GC.state().calendars.filter(c => c.on), key = I.dkey(start);
    gevents = cals.flatMap(c => GC.cachedEvents(c, start, end)); gkey = key; loading = true; error = ''; render();
    try { gevents = (await Promise.all(cals.map(c => GC.events(c, start, end)))).flat(); }
    catch (e) { error = e.message; }
    loading = false; render();
  }
  async function connectGoogle() {
    try { await GC.connect(); await GC.refreshCalendars(); await loadGoogle(); } catch (e) { toast(e.message); }
  }

  /* ---------------------------------------------------------------- event editor */
  function editor(ev, day) {
    const isNew = !ev;
    const now = new Date(day || selected); now.setHours(Math.max(8, new Date().getHours() + 1), 0, 0, 0);
    const base = ev ? { ...ev } : { id: 'e' + Math.random().toString(36).slice(2, 10), title: '', allDay: false, start: I.tkey(now), end: I.tkey(new Date(now.getTime() + 3600000)), source: 'local', rrule: '' };
    if (ev?.series) { const raw = localEvents().find(x => x.id === ev.id); if (raw) Object.assign(base, raw); }
    const target = base.source === 'google' ? base.calId : 'local';
    return modal((d, close) => {
      d.classList.add('evdlg');
      const title = h('input', { value: base.title, placeholder: 'Title', autocomplete: 'off', 'aria-label': 'Title' });
      const allDay = h('input', { type: 'checkbox', checked: !!base.allDay, class: 'cb' });
      const sd = h('input', { type: 'date', value: base.start.slice(0, 10) }), st = h('input', { type: 'time', value: base.allDay ? '09:00' : base.start.slice(11, 16) });
      // all-day end dates are stored exclusive; show them inclusive
      const endIncl = base.allDay ? I.dkey(I.addDays(I.parseKey(base.end), -1)) : base.end.slice(0, 10);
      const ed = h('input', { type: 'date', value: endIncl < base.start.slice(0, 10) ? base.start.slice(0, 10) : endIncl }), et = h('input', { type: 'time', value: base.allDay ? '10:00' : base.end.slice(11, 16) });
      const where = h('input', { value: base.location || '', placeholder: 'Place', autocomplete: 'off' });
      const notes = h('textarea', { rows: 3, placeholder: 'Notes' }); notes.value = base.notes || '';
      const known = I.REPEATS.some(r => r[0] === (base.rrule || ''));
      const rep = h('select', {}, ...I.REPEATS.map(([v, l]) => h('option', { value: v, selected: v === (base.rrule || '') }, l)), !known && h('option', { value: base.rrule, selected: true }, 'Custom (kept)'));
      const cals = GC.connected() ? GC.state().calendars.filter(c => c.writable) : [];
      const which = h('select', { disabled: !isNew }, h('option', { value: 'local', selected: target === 'local' }, 'Notes (calendar.ics)'), ...cals.map(c => h('option', { value: c.id, selected: target === c.id }, c.name)));
      const sync = () => { st.hidden = et.hidden = allDay.checked; };
      allDay.onchange = sync; sync();
      const err = h('div', { class: 'err', role: 'alert' });
      const save = async e => {
        e?.preventDefault();
        const ad = allDay.checked, sk = ad ? sd.value : `${sd.value}T${st.value || '09:00'}`;
        let ek = ad ? I.dkey(I.addDays(I.parseKey(ed.value || sd.value), 1)) : `${ed.value || sd.value}T${et.value || st.value || '10:00'}`;
        if (!sd.value) { err.textContent = 'Pick a start date.'; return; }
        if (ek < sk) ek = ad ? I.dkey(I.addDays(I.parseKey(sd.value), 1)) : sk;
        const next = { ...base, title: title.value.trim() || '(no title)', allDay: ad, start: sk, end: ek, location: where.value.trim(), notes: notes.value.trim(), rrule: rep.value };
        try {
          if ((isNew ? which.value : target) === 'local') {
            const list = localEvents(), i = list.findIndex(x => x.id === next.id);
            const rec = { ...next, source: 'local', extra: i >= 0 ? list[i].extra : [] };
            i >= 0 ? list[i] = rec : list.push(rec); await saveLocal(list);
          } else if (isNew) { await GC.create(which.value, next); await loadGoogle(); }
          else { await GC.update(next); await loadGoogle(); }
          selected = I.parseKey(sk); if (selected.getMonth() !== month.getMonth() || selected.getFullYear() !== month.getFullYear()) { month = new Date(selected.getFullYear(), selected.getMonth(), 1); loadGoogle(); }
          close(true); render();
        } catch (ex) { err.textContent = ex.message; if (ex.expired) render(); }
      };
      const del = async () => {
        if (!await confirmBox({ title: 'Delete this event?', body: base.series || base.rrule ? 'This removes the whole repeating series.' : `“${base.title}” will be deleted.`, ok: 'Delete', danger: true })) return;
        try {
          if (target === 'local') await saveLocal(localEvents().filter(x => x.id !== base.id)); else { await GC.remove(base); await loadGoogle(); }
          close(true); render();
        } catch (ex) { err.textContent = ex.message; }
      };
      const writable = base.writable !== false;
      d.append(h('form', { onsubmit: save },
        h('div', { class: 'mbody' }, h('h3', {}, isNew ? 'New event' : 'Event'),
          h('label', { class: 'field' }, 'Title', title),
          h('label', { class: 'setting' }, 'All day', allDay),
          h('div', { class: 'dtrow' }, h('label', { class: 'field' }, 'Starts', h('span', { class: 'dts' }, sd, st)), h('label', { class: 'field' }, 'Ends', h('span', { class: 'dts' }, ed, et))),
          h('label', { class: 'field' }, 'Repeat', rep), h('label', { class: 'field' }, 'Place', where), h('label', { class: 'field' }, 'Notes', notes),
          (cals.length || !isNew) && h('label', { class: 'field' }, 'Calendar', which), err),
        h('div', { class: 'mfoot' }, !isNew && writable && h('button', { type: 'button', class: 'danger', style: 'margin-right:auto', onclick: del }, 'Delete'),
          h('button', { type: 'button', class: 'text', onclick: () => close(null) }, 'Cancel'), writable && h('button', { class: 'primary' }, 'Save'))));
      setTimeout(() => title.focus(), 30);
    });
  }

  /* ---------------------------------------------------------------- view */
  function chip(ev) {
    const c = ev.color || 'var(--primary)';
    return h('button', { class: 'ce' + (ev.allDay ? ' ad' : ''), style: `--c:${c}`, title: `${ev.title}${ev.allDay ? '' : ' · ' + fmtTime(ev.start)}`, onclick: e => { e.stopPropagation(); editor(ev); } },
      !ev.allDay && h('span', { class: 't' }, fmtTime(ev.start)), h('span', { class: 'n' }, ev.title));
  }
  function render() {
    if (!open) return;
    const evs = all(), { start } = range(), fd = firstDay(), today = new Date();
    const names = Array.from({ length: 7 }, (_, i) => I.addDays(new Date(2023, 0, 1 + fd + i), 0).toLocaleDateString(undefined, { weekday: 'short' }));
    const cells = Array.from({ length: 42 }, (_, i) => {
      const day = I.addDays(start, i), list = onDay(evs, day), more = list.length - 3;
      return h('div', { class: 'cd' + (day.getMonth() !== month.getMonth() ? ' out' : '') + (sameDay(day, today) ? ' today' : '') + (sameDay(day, selected) ? ' sel' : ''), role: 'gridcell', tabindex: '0', 'aria-label': day.toDateString(),
        onclick: () => { selected = day; render(); }, ondblclick: () => editor(null, day), onkeydown: e => { if (e.key === 'Enter') { selected = day; render(); } } },
        h('span', { class: 'dn' }, day.getDate()), h('div', { class: 'cs' }, list.slice(0, 3).map(chip), more > 0 && h('span', { class: 'more' }, `+${more}`)));
    });
    const dayList = onDay(evs, selected);
    const connectedG = GC.connected(), exp = GC.expired();
    const head = h('div', { class: 'cal-head' },
      h('h2', {}, month.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })),
      h('div', { class: 'cal-nav' },
        h('button', { class: 'icon', 'aria-label': 'Previous month', onclick: () => { month = new Date(month.getFullYear(), month.getMonth() - 1, 1); loadGoogle(); render(); } }, icon('back')),
        h('button', { class: 'text', onclick: () => { month = new Date(today.getFullYear(), today.getMonth(), 1); selected = today; loadGoogle(); render(); } }, 'Today'),
        h('button', { class: 'icon', 'aria-label': 'Next month', style: 'transform:scaleX(-1)', onclick: () => { month = new Date(month.getFullYear(), month.getMonth() + 1, 1); loadGoogle(); render(); } }, icon('back'))),
      h('button', { class: 'primary', onclick: () => editor(null, selected) }, icon('plus'), 'Event'));
    const account = h('div', { class: 'cal-acct' },
      connectedG ? h('span', { class: 'dim' }, loading ? 'Syncing Google Calendar…' : `Google Calendar${GC.state().name ? ' · ' + GC.state().name : ''}`)
        : exp ? h('button', { class: 'text', onclick: connectGoogle }, 'Reconnect Google Calendar')
        : h('button', { class: 'text', onclick: () => GC.hasClientId() ? connectGoogle() : openSettings() }, 'Connect Google Calendar (optional)'),
      connectedG && h('button', { class: 'text', onclick: () => loadGoogle() }, 'Refresh'), error && h('span', { class: 'err' }, error));
    const panel = h('aside', { class: 'cal-day' }, h('h3', {}, selected.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })),
      dayList.length ? dayList.map(ev => h('button', { class: 'ev', style: `--c:${ev.color || 'var(--primary)'}`, onclick: () => editor(ev) },
        h('span', { class: 'when' }, ev.allDay ? 'All day' : `${fmtTime(ev.start)}–${fmtTime(ev.end)}`), h('b', {}, ev.title), ev.location && h('small', {}, ev.location), ev.source === 'google' && h('small', { class: 'dim' }, 'Google'))) : h('p', { class: 'dim' }, 'Nothing planned.'),
      h('button', { class: 'text', onclick: () => editor(null, selected) }, icon('plus'), 'Add event'));
    root.replaceChildren(head, account, h('div', { class: 'cal-body' }, h('div', { class: 'cal-grid', role: 'grid' }, h('div', { class: 'wd' }, names.map(n => h('span', {}, n))), h('div', { class: 'cells' }, cells)), panel));
  }

  M.subscribe(() => { if (open) render(); });
  return {
    get open() { return open; },
    show() { open = true; root.hidden = false; render(); if (GC.connected()) loadGoogle(); },
    hide() { open = false; root.hidden = true; },
    newEvent: () => editor(null, selected),
    render, reloadGoogle: loadGoogle,
  };
}
