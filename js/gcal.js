// Optional Google Calendar sync (no server): Google's sign-in token flow in the browser + the Calendar REST API.
// You bring your own OAuth client ID (Settings → Calendar). Nothing is requested until you connect.
import { ls } from './dom.js';
import { dkey, tkey, parseKey, addDays } from './ics.js';

const API = 'https://www.googleapis.com/calendar/v3', SCOPE = 'https://www.googleapis.com/auth/calendar';
const KEY = 'gcal', CACHE = 'gcal-cache';
const blank = { clientId: '', token: '', exp: 0, name: '', calendars: [] };
export const state = () => ({ ...blank, ...ls.get(KEY, {}) });
const save = patch => ls.set(KEY, { ...state(), ...patch });
export const hasClientId = () => !!state().clientId;
export const connected = () => { const s = state(); return !!(s.token && s.exp > Date.now()); };
export const expired = () => { const s = state(); return !!(s.clientId && s.token && s.exp <= Date.now()); };
export const setClientId = id => save({ clientId: id.trim() });

function loadGis() {
  if (window.google?.accounts?.oauth2) return Promise.resolve();
  return new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client'; s.async = true;
    s.onload = () => res(); s.onerror = () => rej(new Error('Could not reach Google sign-in. Are you offline?'));
    document.head.append(s);
  });
}
/** Opens Google's consent popup (must be called from a click). Resolves when we have a token. */
export async function connect() {
  const { clientId } = state();
  if (!clientId) throw new Error('Add your Google OAuth client ID first.');
  await loadGis();
  return new Promise((res, rej) => {
    const tc = window.google.accounts.oauth2.initTokenClient({
      client_id: clientId, scope: SCOPE,
      callback: r => { if (r.error) return rej(new Error(r.error_description || r.error)); save({ token: r.access_token, exp: Date.now() + Math.max(60, (+r.expires_in || 3600) - 60) * 1000 }); res(); },
      error_callback: e => rej(new Error(e?.type === 'popup_closed' ? 'Sign-in was cancelled.' : e?.message || 'Google sign-in failed')),
    });
    tc.requestAccessToken({ prompt: state().calendars.length ? '' : 'consent' });
  });
}
export function disconnect() {
  const t = state().token;
  try { if (t && window.google?.accounts?.oauth2) window.google.accounts.oauth2.revoke(t, () => {}); } catch { /* ignore */ }
  ls.set(KEY, { ...blank, clientId: state().clientId }); localStorage.removeItem(CACHE);
}

async function api(path, { method = 'GET', body, headers } = {}) {
  const s = state();
  if (!s.token || s.exp <= Date.now()) throw Object.assign(new Error('Google session expired. Reconnect to keep syncing.'), { expired: true });
  const r = await fetch(API + path, { method, headers: { Authorization: 'Bearer ' + s.token, ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined });
  if (r.status === 401) { save({ exp: 0 }); throw Object.assign(new Error('Google session expired. Reconnect to keep syncing.'), { expired: true }); }
  if (!r.ok && r.status !== 304) { const j = await r.json().catch(() => ({})); throw new Error(j.error?.message || `Google Calendar error ${r.status}`); }
  return r;
}

export async function refreshCalendars() {
  const j = await (await api('/users/me/calendarList?fields=items(id,summary,primary,backgroundColor,selected,accessRole)')).json();
  const old = new Map(state().calendars.map(c => [c.id, c]));
  const calendars = (j.items || []).map(c => ({ id: c.id, name: c.summary, color: c.backgroundColor || '#4285f4', primary: !!c.primary, writable: /owner|writer/.test(c.accessRole || ''), on: old.has(c.id) ? old.get(c.id).on : c.selected !== false }));
  save({ calendars, name: calendars.find(c => c.primary)?.name || state().name });
  return calendars;
}
export const setCalendarOn = (id, on) => save({ calendars: state().calendars.map(c => c.id === id ? { ...c, on } : c) });

const norm = (it, cal) => {
  const allDay = !!it.start?.date, start = allDay ? it.start.date : tkey(new Date(it.start.dateTime)), end = allDay ? it.end.date : tkey(new Date(it.end.dateTime));
  return { id: it.id, title: it.summary || '(no title)', start, end, allDay, notes: it.description || '', location: it.location || '', source: 'google', calId: cal.id, color: cal.color, writable: cal.writable, etag: it.etag, recurring: !!it.recurringEventId };
};
/** Events of one calendar in [from, to). Conditional requests (ETag) make "nothing changed" a bodyless 304. */
export async function events(cal, from, to) {
  const ck = `${cal.id}|${dkey(from)}|${dkey(to)}`, cache = ls.get(CACHE, {}), hit = cache[ck];
  const q = `/calendars/${encodeURIComponent(cal.id)}/events?singleEvents=true&orderBy=startTime&maxResults=250&timeMin=${encodeURIComponent(from.toISOString())}&timeMax=${encodeURIComponent(to.toISOString())}&fields=${encodeURIComponent('etag,nextPageToken,items(id,etag,summary,description,location,status,start,end,recurringEventId)')}`;
  const r = await api(q, { headers: hit?.etag ? { 'If-None-Match': hit.etag } : {} });
  if (r.status === 304 && hit) return hit.items.map(it => norm(it, cal));
  const j = await r.json(); let items = j.items || [], token = j.nextPageToken;
  for (let i = 0; token && i < 4; i++) { const more = await (await api(q + '&pageToken=' + token)).json(); items = items.concat(more.items || []); token = more.nextPageToken; }
  items = items.filter(it => it.status !== 'cancelled' && (it.start?.date || it.start?.dateTime));
  cache[ck] = { etag: j.etag, items }; ls.set(CACHE, cache);
  return items.map(it => norm(it, cal));
}
export const cachedEvents = (cal, from, to) => (ls.get(CACHE, {})[`${cal.id}|${dkey(from)}|${dkey(to)}`]?.items || []).map(it => norm(it, cal));

const body = ev => {
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const o = { summary: ev.title, description: ev.notes || '', location: ev.location || '' };
  if (ev.allDay) { o.start = { date: ev.start.slice(0, 10) }; o.end = { date: ev.end.slice(0, 10) }; }
  else { o.start = { dateTime: parseKey(ev.start).toISOString(), timeZone: tz }; o.end = { dateTime: parseKey(ev.end || ev.start).toISOString(), timeZone: tz }; }
  if (ev.rrule !== undefined) o.recurrence = ev.rrule ? ['RRULE:' + ev.rrule] : [];
  return o;
};
const forget = () => localStorage.removeItem(CACHE);
export async function create(calId, ev) { const j = await (await api(`/calendars/${encodeURIComponent(calId)}/events`, { method: 'POST', body: body(ev) })).json(); forget(); return j; }
export async function update(ev) { const j = await (await api(`/calendars/${encodeURIComponent(ev.calId)}/events/${encodeURIComponent(ev.id)}`, { method: 'PATCH', body: body({ ...ev, rrule: undefined }) })).json(); forget(); return j; }
export async function remove(ev) { await api(`/calendars/${encodeURIComponent(ev.calId)}/events/${encodeURIComponent(ev.id)}`, { method: 'DELETE' }); forget(); }
export { addDays };
