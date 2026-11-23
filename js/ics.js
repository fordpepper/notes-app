// iCalendar (.ics) reading and writing, plus simple recurrence expansion. Times are kept as local "floating" values:
//   all-day: "YYYY-MM-DD"   timed: "YYYY-MM-DDTHH:mm"
const pad = n => String(n).padStart(2, '0');
export const dkey = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const tkey = d => `${dkey(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
export const parseKey = s => { const [y, m, d] = s.slice(0, 10).split('-').map(Number), t = s.length > 10 ? s.slice(11, 16).split(':').map(Number) : [0, 0]; return new Date(y, m - 1, d, t[0], t[1]); };
export const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };

const unescapeText = s => s.replace(/\\n/gi, '\n').replace(/\\([,;\\])/g, '$1');
const escapeText = s => (s || '').replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/,/g, '\\,').replace(/;/g, '\\;');
function fold(line) { const out = []; while (line.length > 74) { out.push(line.slice(0, 74)); line = ' ' + line.slice(74); } out.push(line); return out.join('\r\n'); }

/** "20261123", "20261123T090000", "20261123T090000Z" -> key string (UTC values are converted to local time). */
function icsDate(v, params) {
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/.exec(v.trim());
  if (!m) return null;
  if (m[4] == null || /VALUE=DATE(?!-)/i.test(params || '')) return { key: `${m[1]}-${m[2]}-${m[3]}`, allDay: true };
  if (m[7]) return { key: tkey(new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0)))), allDay: false };
  return { key: `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}`, allDay: false };
}

export function parseICS(text) {
  const lines = (text || '').replace(/\r\n?/g, '\n').replace(/\n[ \t]/g, '').split('\n');
  const events = []; let cur = null, depth = 0;
  for (const raw of lines) {
    if (raw === 'BEGIN:VEVENT') { cur = { extra: [] }; depth = 0; continue; }
    if (!cur) continue;
    if (raw === 'END:VEVENT' && depth === 0) {
      if (cur.start) {
        if (!cur.end) cur.end = cur.allDay ? dkey(addDays(parseKey(cur.start), 1)) : cur.start;
        cur.id ||= 'e' + Math.random().toString(36).slice(2, 10); cur.source = 'local';
        events.push(cur);
      }
      cur = null; continue;
    }
    if (/^BEGIN:/.test(raw)) depth++;
    if (/^END:/.test(raw)) depth--;
    if (depth > 0 || /^(BEGIN|END):/.test(raw)) { cur.extra.push(raw); continue; }      // keep alarms and other nested blocks untouched
    const i = raw.indexOf(':'); if (i < 0) continue;
    const head = raw.slice(0, i), val = raw.slice(i + 1), [name, ...pr] = head.split(';'), params = pr.join(';');
    switch (name.toUpperCase()) {
      case 'UID': cur.id = val; break;
      case 'SUMMARY': cur.title = unescapeText(val); break;
      case 'DESCRIPTION': cur.notes = unescapeText(val); break;
      case 'LOCATION': cur.location = unescapeText(val); break;
      case 'RRULE': cur.rrule = val; break;
      case 'DTSTART': { const d = icsDate(val, params); if (d) { cur.start = d.key; cur.allDay = d.allDay; } break; }
      case 'DTEND': { const d = icsDate(val, params); if (d) cur.end = d.key; break; }
      case 'DTSTAMP': case 'CREATED': case 'LAST-MODIFIED': case 'SEQUENCE': break;
      default: cur.extra.push(raw);
    }
  }
  return events;
}

export function toICS(events) {
  const out = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//notes-app//EN', 'CALSCALE:GREGORIAN'];
  const stamp = new Date().toISOString().replace(/[-:]|\.\d+/g, '');
  const dt = (k, allDay) => allDay ? `;VALUE=DATE:${k.replace(/-/g, '')}` : `:${k.replace(/[-:]/g, '')}00`;
  for (const e of events) {
    out.push('BEGIN:VEVENT', `UID:${e.id}`, `DTSTAMP:${stamp}`, `DTSTART${dt(e.start, e.allDay)}`, `DTEND${dt(e.end || e.start, e.allDay)}`, fold(`SUMMARY:${escapeText(e.title)}`));
    if (e.location) out.push(fold(`LOCATION:${escapeText(e.location)}`));
    if (e.notes) out.push(fold(`DESCRIPTION:${escapeText(e.notes)}`));
    if (e.rrule) out.push(`RRULE:${e.rrule}`);
    for (const x of e.extra || []) out.push(fold(x));
    out.push('END:VEVENT');
  }
  out.push('END:VCALENDAR');
  return out.join('\r\n') + '\r\n';
}

/* ---------------------------------------------------------------- recurrence */
const DAYS = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
export const REPEATS = [['', 'Does not repeat'], ['FREQ=DAILY', 'Every day'], ['FREQ=WEEKLY', 'Every week'], ['FREQ=MONTHLY', 'Every month'], ['FREQ=YEARLY', 'Every year']];
function parseRule(r) { const o = {}; for (const p of r.split(';')) { const [k, v] = p.split('='); o[k] = v; } return o; }

/** Occurrences of `ev` that touch [from, to). Each is a copy with its own start/end. */
export function occurrences(ev, from, to) {
  const s = parseKey(ev.start), e = parseKey(ev.end || ev.start), len = e - s;
  const make = d => { const ns = ev.allDay ? dkey(d) : tkey(d), ne = ev.allDay ? dkey(new Date(d.getTime() + len)) : tkey(new Date(d.getTime() + len)); return { ...ev, start: ns, end: ne, series: !!ev.rrule }; };
  if (!ev.rrule) return e > from && s < to ? [make(s)] : [];
  const r = parseRule(ev.rrule), step = Math.max(1, +r.INTERVAL || 1), until = r.UNTIL ? icsDate(r.UNTIL.replace(/Z$/, ''))?.key : null, max = +r.COUNT || Infinity;
  const out = []; let n = 0;
  const push = d => { const o = make(d); if (until && dkey(d) > until.slice(0, 10)) return false; if (++n > max) return false; if (parseKey(o.end) > from && d < to) out.push(o); return d < to; };
  if (r.FREQ === 'DAILY') for (let d = new Date(s); d < to && out.length < 500; d = addDays(d, step)) { if (!push(d)) break; }
  else if (r.FREQ === 'WEEKLY') {
    const days = r.BYDAY ? r.BYDAY.split(',').map(x => DAYS.indexOf(x.slice(-2))).filter(x => x >= 0) : [s.getDay()];
    const weekStart = addDays(s, -s.getDay());
    for (let w = new Date(weekStart); w < to && out.length < 500; w = addDays(w, 7 * step)) {
      let stop = false;
      for (const dow of [...days].sort((a, b) => a - b)) { const d = addDays(w, dow); d.setHours(s.getHours(), s.getMinutes()); if (d < s) continue; if (!push(d)) { stop = true; break; } }
      if (stop) break;
    }
  } else if (r.FREQ === 'MONTHLY') for (let i = 0; out.length < 500; i += step) { const d = new Date(s.getFullYear(), s.getMonth() + i, s.getDate(), s.getHours(), s.getMinutes()); if (d.getDate() !== s.getDate()) continue; if (d >= to && !until) break; if (!push(d)) break; }
  else if (r.FREQ === 'YEARLY') for (let i = 0; out.length < 500; i += step) { const d = new Date(s.getFullYear() + i, s.getMonth(), s.getDate(), s.getHours(), s.getMinutes()); if (d >= to && !until) break; if (!push(d)) break; }
  else return e > from && s < to ? [make(s)] : [];
  return out;
}
