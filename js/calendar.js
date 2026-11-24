// Calendar view: one continuous, vertically scrolling stretch of weeks (like Apple Calendar), with the chosen day's
// events underneath (phone) or beside (desktop). Events live in `calendar.ics` in the notes repo and sync like any note.
// Google Calendar events from any number of connected accounts are shown and edited too; accounts are added in Settings only.
import * as M from './model.js';
import * as I from './ics.js';
import * as GC from './gcal.js';
import * as FD from './feeds.js';
import { h, toast } from './dom.js';
import { icon } from './icons.js';
import { modal, confirmBox } from './dialogs.js';

export const FILE = 'calendar.ics';
const localEvents = () => { const r = M.files.get(FILE); return r && !r.deleted && typeof r.content === 'string' ? I.parseICS(r.content) : []; };
async function saveLocal(events) { const text = I.toICS(events); M.exists(FILE) ? await M.saveText(FILE, text) : await M.create(FILE, text); }
/** Adds the events of an .ics file (for instance exported from Apple Calendar) to calendar.ics. Same UID = same event. */
export async function importEvents(text) {
  const incoming = I.parseICS(text);
  if (!incoming.length) throw new Error('No events found in that file.');
  const list = localEvents(), ids = new Set(list.map(e => e.id));
  const fresh = incoming.filter(e => !ids.has(e.id));
  if (fresh.length) await saveLocal([...list, ...fresh]);
  return { added: fresh.length, skipped: incoming.length - fresh.length };
}

const startOfDay = d => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
const firstDay = () => { try { const l = new Intl.Locale(navigator.language), w = l.weekInfo || l.getWeekInfo?.(); return (w?.firstDay ?? 1) % 7; } catch { return 1; } };
const fmtTime = k => I.parseKey(k).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
const ym = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
const uid = () => 'e' + Math.random().toString(36).slice(2, 10);
const BLOCK = 26, MAXW = BLOCK * 8, PHONE = matchMedia('(max-width: 640px)');

const sig = () => [FILE, FD.LINKS, ...FD.feeds().map(f => `${FD.DIR}${f.n}.ics`)].map(p => M.files.get(p)?.sha || '').join();

export function initCalendar(root, { openSettings }) {
  const fd = firstDay(), today = startOfDay(new Date());
  const weekStart = d => I.addDays(startOfDay(d), -((d.getDay() - fd + 7) % 7));
  let open = false, sel = today, first, nWeeks, wk = 100, lastSha = '', loading = 0, error = '', renewed = false;
  const chipDay = new Map(); let spans = [];
  const byDay = new Map(), gdata = new Map(), loaded = new Map();
  let titleEl, subEl, scroller, weeksEl, panel, wdEl, hh = 28, raf = 0, ensureT = 0;

  /* ---------------------------------------------------------------- data */
  const activeG = key => { const [email, calId] = key.split('|'); return !!GC.account(email)?.calendars.some(c => c.id === calId && c.on); };
  function gather() {
    const from = first, to = I.addDays(first, nWeeks * 7), seen = new Set(), list = localEvents().flatMap(e => I.occurrences(e, from, to));
    for (const e of FD.events(from, to)) list.push(e);
    for (const [k, v] of gdata) if (activeG(k)) for (const e of v) { const id = `${e.acct}|${e.calId}|${e.id}|${e.start}`; if (!seen.has(id)) { seen.add(id); list.push(e); } }
    byDay.clear(); chipDay.clear(); spans = [];
    const put = (m, k, e) => (m.get(k) || m.set(k, []).get(k)).push(e);
    for (const e of list) {
      const s = e.start.slice(0, 10); let en = e.end.slice(0, 10);
      if (e.allDay || (e.end.slice(11) === '00:00' && en > s)) en = I.dkey(I.addDays(I.parseKey(en), -1));
      if (en < s) en = s;
      if (en > s) spans.push({ e, s, en });                                  // several days: drawn as one continuous bar
      for (let d = I.parseKey(s), n = 0; I.dkey(d) <= en && n < 400; d = I.addDays(d, 1), n++) { const k = I.dkey(d); put(byDay, k, e); if (en === s) put(chipDay, k, e); }
    }
    for (const m of [byDay, chipDay]) for (const l of m.values()) l.sort((a, b) => (b.allDay - a.allDay) || a.start.localeCompare(b.start));
    spans.sort((a, b) => a.s.localeCompare(b.s) || b.en.localeCompare(a.en));
  }
  const visibleRows = () => { const a = Math.max(0, Math.floor(scroller.scrollTop / wk)), b = Math.min(nWeeks - 1, Math.floor((scroller.scrollTop + scroller.clientHeight) / wk)); return [a, b]; };

  async function ensure(force) {
    if (!open || !scroller) return;
    if (!renewed) { renewed = true; await Promise.all(GC.accounts().filter(a => !GC.live(a)).map(a => GC.renew(a.email))); }
    const [a, b] = visibleRows(), months = new Map();
    for (let i = a; i <= b; i++) for (const off of [0, 6]) { const d = I.addDays(first, i * 7 + off); months.set(ym(d), new Date(d.getFullYear(), d.getMonth(), 1)); }
    const jobs = []; let cached = false;
    for (const acct of GC.accounts().filter(GC.live)) for (const cal of acct.calendars.filter(c => c.on)) for (const [m, from] of months) {
      const key = `${acct.email}|${cal.id}|${m}`, to = new Date(from.getFullYear(), from.getMonth() + 1, 1);
      if (!gdata.has(key)) { const c = GC.cachedEvents(acct.email, cal, from, to); if (c.length) { gdata.set(key, c); cached = true; } }
      if (!force && Date.now() - (loaded.get(key) || 0) < 120000) continue;
      loaded.set(key, Date.now());
      jobs.push(GC.events(acct.email, cal, from, to).then(v => { gdata.set(key, v); }, e => { loaded.delete(key); if (!e.expired) error = e.message; }));
    }
    if (cached) rebuild();
    if (!jobs.length) { paintHead(); return; }
    loading++; error = ''; paintHead();
    await Promise.all(jobs); loading--;
    rebuild();
  }
  const refetch = () => { loaded.clear(); gdata.clear(); error = ''; rebuild(); ensure(true); };

  /* ---------------------------------------------------------------- event editor */
  function editor(ev, day) {
    const isNew = !ev;
    const at = new Date(day || sel); at.setHours(Math.max(8, new Date().getHours() + 1), 0, 0, 0);
    const base = ev ? { ...ev } : { id: uid(), title: '', allDay: false, start: I.tkey(at), end: I.tkey(new Date(at.getTime() + 3600000)), source: 'local', rrule: '' };
    if (ev?.series && ev.source === 'local') { const raw = localEvents().find(x => x.id === ev.id); if (raw) Object.assign(base, raw); }
    const target = base.source === 'google' ? `${base.acct}|${base.calId}` : 'local';
    return modal((d, close) => {
      d.classList.add('evdlg');
      const input = (props, ...k) => h('input', { autocomplete: 'off', ...props }, ...k);
      const title = input({ class: 'evtitle', value: base.title, placeholder: 'Title', 'aria-label': 'Title', enterkeyhint: 'done' });
      const allDay = input({ type: 'checkbox', checked: !!base.allDay, class: 'switch', 'aria-label': 'All day' });
      const sd = input({ type: 'date', value: base.start.slice(0, 10), 'aria-label': 'Start date' }), st = input({ type: 'time', value: base.allDay ? '09:00' : base.start.slice(11, 16), 'aria-label': 'Start time' });
      const endIncl = base.allDay ? I.dkey(I.addDays(I.parseKey(base.end), -1)) : base.end.slice(0, 10);       // all-day end dates are stored exclusive; shown inclusive
      const ed = input({ type: 'date', value: endIncl < base.start.slice(0, 10) ? base.start.slice(0, 10) : endIncl, 'aria-label': 'End date' }), et = input({ type: 'time', value: base.allDay ? '10:00' : base.end.slice(11, 16), 'aria-label': 'End time' });
      const where = input({ value: base.location || '', placeholder: 'Place', 'aria-label': 'Place' });
      const notes = h('textarea', { rows: 2, placeholder: 'Notes', 'aria-label': 'Notes' }); notes.value = base.notes || '';
      const known = I.REPEATS.some(r => r[0] === (base.rrule || ''));
      const rep = h('select', { 'aria-label': 'Repeat' }, ...I.REPEATS.map(([v, l]) => h('option', { value: v, selected: v === (base.rrule || '') }, l)), !known && h('option', { value: base.rrule, selected: true }, 'Custom (kept)'));
      const multi = GC.accounts().filter(GC.live).length > 1;
      const choices = GC.accounts().filter(GC.live).flatMap(a => a.calendars.filter(c => c.writable).map(c => [`${a.email}|${c.id}`, multi ? `${c.name} (${a.email})` : c.name]));
      const which = h('select', { 'aria-label': 'Calendar', disabled: !isNew }, h('option', { value: 'local', selected: target === 'local' }, 'Notes'), ...choices.map(([v, l]) => h('option', { value: v, selected: target === v }, l)),
        !isNew && target !== 'local' && !choices.some(c => c[0] === target) && h('option', { value: target, selected: true }, base.acct));
      const sync = () => { st.hidden = et.hidden = allDay.checked; };
      allDay.onchange = sync; sync();
      const err = h('div', { class: 'err', role: 'alert' });
      const writable = base.writable !== false;
      const save = async e => {
        e?.preventDefault();
        const ad = allDay.checked, sk = ad ? sd.value : `${sd.value}T${st.value || '09:00'}`;
        let ek = ad ? I.dkey(I.addDays(I.parseKey(ed.value || sd.value), 1)) : `${ed.value || sd.value}T${et.value || st.value || '10:00'}`;
        if (!sd.value) { err.textContent = 'Pick a start date.'; return; }
        if (ek < sk) ek = ad ? I.dkey(I.addDays(I.parseKey(sd.value), 1)) : sk;
        const next = { ...base, title: title.value.trim() || '(no title)', allDay: ad, start: sk, end: ek, location: where.value.trim(), notes: notes.value.trim(), rrule: rep.value };
        const dest = isNew ? which.value : target;
        try {
          if (dest === 'local') {
            const list = localEvents(), i = list.findIndex(x => x.id === next.id);
            const rec = { ...next, source: 'local', extra: i >= 0 ? list[i].extra : [] };
            i >= 0 ? list[i] = rec : list.push(rec); await saveLocal(list);
          } else if (isNew) { const [email, ...c] = dest.split('|'); await GC.create(email, c.join('|'), next); refetch(); }
          else { await GC.update(next); refetch(); }
          close(true); sel = startOfDay(I.parseKey(sk)); rebuild(); goTo(sel);
        } catch (ex) { err.textContent = ex.message; }
      };
      const del = async () => {
        if (!await confirmBox({ title: 'Delete this event?', body: base.series || base.rrule ? 'This removes the whole repeating series.' : `“${base.title}” will be deleted.`, ok: 'Delete', danger: true })) return;
        try {
          if (target === 'local') await saveLocal(localEvents().filter(x => x.id !== base.id)); else { await GC.remove(base); refetch(); }
          close(true); rebuild();
        } catch (ex) { err.textContent = ex.message; }
      };
      const row = (label, ...ctl) => h('label', { class: 'evrow' }, h('span', {}, label), ...ctl);
      d.append(h('form', { class: 'evform', onsubmit: save },
        h('header', { class: 'evbar' }, h('button', { type: 'button', class: 'text', onclick: () => close(null) }, 'Cancel'), h('h3', {}, isNew ? 'New event' : 'Event'), writable ? h('button', { class: 'text strong' }, 'Save') : h('span')),
        h('div', { class: 'evbody' },
          title,
          h('div', { class: 'evgroup' },
            row('All day', allDay), row('Starts', h('span', { class: 'when2' }, sd, st)), row('Ends', h('span', { class: 'when2' }, ed, et)),
            row('Repeat', rep), (choices.length || !isNew) && row('Calendar', which)),
          h('div', { class: 'evgroup' }, where, notes),
          err, !isNew && writable && h('button', { type: 'button', class: 'evdel', onclick: del }, 'Delete event'))));
      setTimeout(() => isNew && title.focus(), 30);
    });
  }

  /* ---------------------------------------------------------------- rows */
  const sameDay = (a, b) => I.dkey(a) === I.dkey(b);
  function chip(ev) {
    const c = ev.color || 'var(--primary)';
    return h('button', { type: 'button', class: 'ce' + (ev.allDay ? ' ad' : ''), style: `--c:${c}`, tabindex: '-1', title: `${ev.title}${ev.allDay ? '' : ' · ' + fmtTime(ev.start)}`, onclick: e => { e.stopPropagation(); editor(ev); } },
      !ev.allDay && h('span', { class: 't' }, fmtTime(ev.start)), h('span', { class: 'n' }, ev.title));
  }
  function cell(day, lanes = 0) {
    const k = I.dkey(day), list = chipDay.get(k) || [], cap = PHONE.matches ? 4 : Math.max(1, Math.floor((wk - 30) / 19)), room = Math.max(1, cap - lanes), shown = list.length > room ? room - 1 : list.length;
    const label = day.getDate() === 1 ? day.toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) : String(day.getDate());
    return h('div', { class: 'cd' + (day.getMonth() % 2 ? ' odd' : '') + (sameDay(day, today) ? ' today' : '') + (sameDay(day, sel) ? ' sel' : ''), role: 'gridcell', 'data-k': k, 'aria-label': day.toDateString(), 'aria-selected': String(sameDay(day, sel)) },
      h('span', { class: 'dn' }, label), h('div', { class: 'cs' }, list.slice(0, shown).map(chip), list.length > shown && h('span', { class: 'more' }, `${list.length - shown} more`)));
  }
  /** Multi-day events of one week: each gets a lane and spans its columns, joined to the neighbouring weeks. */
  function bars(w0) {
    const a = I.dkey(w0), b = I.dkey(I.addDays(w0, 6)), col = k => Math.round((I.parseKey(k) - w0) / 86400000), ends = [], out = [];
    const cap = PHONE.matches ? 4 : Math.max(1, Math.floor((wk - 30) / 19));
    for (const { e, s, en } of spans) {
      if (en < a || s > b) continue;
      const c0 = Math.max(0, col(s)), c1 = Math.min(6, col(en));
      let l = ends.findIndex(x => x < c0); if (l < 0) l = ends.length; ends[l] = c1;
      if (l < Math.max(1, cap - 1)) out.push({ e, l, c0, c1, cl: s < a, cr: en > b });
    }
    return out;
  }
  function weekRow(i) {
    const w0 = I.addDays(first, i * 7), bs = bars(w0), lanes = bs.reduce((m, x) => Math.max(m, x.l + 1), 0);
    return h('div', { class: 'wk', role: 'row', style: `--lanes:${lanes}` }, Array.from({ length: 7 }, (_, d) => cell(I.addDays(w0, d), lanes)),
      bs.map(({ e, l, c0, c1, cl, cr }) => h('button', { type: 'button', class: 'sp' + (e.allDay ? ' ad' : '') + (cl ? ' cl' : '') + (cr ? ' cr' : ''), tabindex: '-1', title: e.title,
        style: `--c:${e.color || 'var(--primary)'};--l:${l};--c0:${c0};--n:${c1 - c0 + 1}`, onclick: ev => { ev.stopPropagation(); editor(e); } }, h('span', {}, e.title))));
  }

  function rebuild() {
    if (!open || !weeksEl) return;
    gather();
    weeksEl.replaceChildren(...Array.from({ length: nWeeks }, (_, i) => weekRow(i)));
    paintDay(); paintHead();
  }
  function extend(up) {
    const add = Array.from({ length: BLOCK }, (_, i) => i);
    if (up) { first = I.addDays(first, -BLOCK * 7); nWeeks += BLOCK; gather(); weeksEl.prepend(...add.map(weekRow)); scroller.scrollTop += BLOCK * wk; }
    else { const n0 = nWeeks; nWeeks += BLOCK; gather(); weeksEl.append(...add.map(i => weekRow(n0 + i))); }
    if (nWeeks > MAXW) trim(up);
    clearTimeout(ensureT); ensureT = setTimeout(() => ensure(), 150);
  }
  /** Keeps the page light however far you scroll: drops a block of weeks on the side you scrolled away from. */
  function trim(up) {
    const kids = weeksEl.children;
    if (up) for (let i = 0; i < BLOCK; i++) kids[kids.length - 1].remove();
    else { for (let i = 0; i < BLOCK; i++) kids[0].remove(); first = I.addDays(first, BLOCK * 7); scroller.scrollTop -= BLOCK * wk; }
    nWeeks -= BLOCK; gather();
  }
  function setWindow(around) { first = I.addDays(weekStart(around), -20 * 7); nWeeks = BLOCK * 3; }
  const rowOf = d => Math.round((weekStart(d) - first) / 604800000);
  function goTo(date, smooth) {
    if (!open || !scroller) return;
    const r = rowOf(date);
    if (r < 3 || r > nWeeks - 4) { setWindow(date); rebuild(); smooth = false; }
    const top = (rowOf(date) - 1) * wk;
    scroller.scrollTo({ top: Math.max(0, top), behavior: smooth ? 'smooth' : 'instant' });
    scrolled(); ensure();
  }

  /* ---------------------------------------------------------------- header, day panel */
  function paintHead() {
    if (!titleEl) return;
    const row = Math.min(nWeeks - 1, Math.max(0, Math.floor((scroller.scrollTop + wk * .5) / wk))), d = I.addDays(first, row * 7 + 3);
    const t = d.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
    if (titleEl.textContent !== t) titleEl.textContent = t;
    const out = GC.accounts().filter(a => !GC.live(a));
    subEl.replaceChildren(...[error ? h('span', { class: 'err' }, error) : loading ? 'Updating…' : null,
      out.length && !loading ? h('button', { type: 'button', class: 'text', onclick: () => openSettings() }, out.length === 1 ? `${out[0].email} needs sign-in` : `${out.length} Google accounts need sign-in`) : null].filter(Boolean));
    subEl.hidden = !subEl.childNodes.length;
  }
  function paintDay() {
    if (!panel) return;
    const list = byDay.get(I.dkey(sel)) || [];
    panel.replaceChildren(h('h3', {}, sel.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })),
      ...(list.length ? list.map(ev => h('button', { type: 'button', class: 'ev', style: `--c:${ev.color || 'var(--primary)'}`, onclick: () => editor(ev) },
        h('span', { class: 'when' }, ev.allDay ? 'All day' : `${fmtTime(ev.start)} – ${fmtTime(ev.end)}`), h('b', {}, ev.title), ev.location && h('small', {}, ev.location),
        ev.source !== 'local' && h('small', { class: 'dim' }, ev.acct))) : [h('p', { class: 'dim' }, 'Nothing planned.')]));
  }
  function select(day) {
    sel = startOfDay(day);
    for (const c of weeksEl.querySelectorAll('.cd.sel')) { c.classList.remove('sel'); c.setAttribute('aria-selected', 'false'); }
    const c = weeksEl.querySelector(`.cd[data-k="${I.dkey(sel)}"]`); c?.classList.add('sel'); c?.setAttribute('aria-selected', 'true');
    paintDay();
  }
  function scrolled() {
    raf = 0;
    if (scroller.scrollTop < wk * 3) extend(true);
    else if (scroller.scrollTop + scroller.clientHeight > hh + (nWeeks - 3) * wk) extend(false);
    paintHead();
    clearTimeout(ensureT); ensureT = setTimeout(() => ensure(), 200);
  }

  /* ---------------------------------------------------------------- layout */
  function layout() {
    if (!scroller || !scroller.clientHeight) return;
    const old = wk, rows = scroller.scrollTop / old;
    hh = wdEl.offsetHeight || 28;
    wk = Math.round(Math.min(190, Math.max(PHONE.matches ? 54 : 104, (scroller.clientHeight - hh) / (PHONE.matches ? 6 : 5.6))));
    weeksEl.style.setProperty('--wk', wk + 'px');
    if (old !== wk) { scroller.scrollTop = rows * wk; if (PHONE.matches || old) rebuild(); }
  }
  function build() {
    titleEl = h('h2'); subEl = h('div', { class: 'cal-sub', hidden: true });
    const names = Array.from({ length: 7 }, (_, i) => new Date(2023, 0, 1 + fd + i).toLocaleDateString(undefined, { weekday: 'short' }));
    wdEl = h('div', { class: 'wd', 'aria-hidden': 'true' }, names.map(n => h('span', {}, n)));
    weeksEl = h('div', { class: 'weeks', role: 'grid', 'aria-label': 'Calendar' });
    scroller = h('div', { class: 'cal-scroll', tabindex: '0' }, wdEl, weeksEl);
    panel = h('aside', { class: 'cal-day', 'aria-live': 'polite' });
    root.replaceChildren(
      h('div', { class: 'cal-head' }, h('div', { class: 'cal-title' }, titleEl, subEl),
        h('button', { type: 'button', class: 'text', onclick: () => { select(today); goTo(today, true); } }, 'Today'),
        h('button', { type: 'button', class: 'primary', 'aria-label': 'New event', onclick: () => editor(null, sel) }, icon('plus'), h('span', {}, 'Event'))),
      h('div', { class: 'cal-main' }, h('div', { class: 'cal-grid' }, scroller), panel));
    scroller.addEventListener('scroll', () => { if (!raf) raf = requestAnimationFrame(scrolled); }, { passive: true });
    weeksEl.addEventListener('click', e => { const c = e.target.closest('.cd'); if (c) select(I.parseKey(c.dataset.k)); });
    weeksEl.addEventListener('dblclick', e => { const c = e.target.closest('.cd'); if (c && !e.target.closest('.ce, .sp')) editor(null, I.parseKey(c.dataset.k)); });
    scroller.addEventListener('keydown', e => {
      const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[e.key];
      if (!step) return;
      e.preventDefault(); const next = I.addDays(sel, step); select(next);
      const el = weeksEl.querySelector(`.cd[data-k="${I.dkey(next)}"]`); if (!el) return goTo(next);
      const y = el.parentElement.offsetTop - hh; if (y < scroller.scrollTop) scroller.scrollTop = y; else if (y + wk > scroller.scrollTop + scroller.clientHeight - hh) scroller.scrollTop = y + wk - scroller.clientHeight + hh * 2;
    });
    new ResizeObserver(() => layout()).observe(scroller);
    PHONE.addEventListener?.('change', () => { layout(); rebuild(); });
  }

  M.subscribe(() => { if (!open) return; const s = sig(); if (s !== lastSha) { lastSha = s; rebuild(); } });
  return {
    get open() { return open; },
    show() {
      open = true; root.hidden = false; renewed = false;
      if (!scroller) build();
      lastSha = sig();
      sel = startOfDay(sel); setWindow(sel); layout(); rebuild();
      requestAnimationFrame(() => { layout(); goTo(sel); });
    },
    hide() { open = false; root.hidden = true; },
    newEvent: () => editor(null, sel),
    render: rebuild, reloadGoogle: refetch,
  };
}
