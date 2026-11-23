// Optional Google Calendar sync (no server): Google's sign-in token flow in the browser + the Calendar REST API.
// You bring your own OAuth client ID (Settings → Accounts). Several Google accounts can be connected at once.
// Nothing is requested until you add an account. Access tokens last about an hour and are never written to exports.
import { ls } from './dom.js';
import { dkey, tkey, parseKey } from './ics.js';

const API = 'https://www.googleapis.com/calendar/v3', SCOPE = 'https://www.googleapis.com/auth/calendar';
const KEY = 'gcal', CACHE = 'gcal-cache';

function read() {
  const s = ls.get(KEY, {});
  if (!s.accounts) {                                   // older single-account format
    const old = s.token || s.calendars?.length ? [{ email: s.name || 'Google account', token: s.token || '', exp: s.exp || 0, calendars: s.calendars || [] }] : [];
    return { clientId: s.clientId || '', accounts: old };
  }
  return { clientId: s.clientId || '', accounts: s.accounts };
}
const write = s => ls.set(KEY, s);
const patchAccount = (email, fn) => { const s = read(); s.accounts = s.accounts.map(a => a.email === email ? fn(a) : a); write(s); };

export const state = read;
export const accounts = () => read().accounts;
export const account = email => accounts().find(a => a.email === email);
export const live = a => !!(a?.token && a.exp > Date.now());
/** Shipped with the app so people only press "Sign in". A client ID is public by design (it is not a secret).
 *  Create a "Web application" client once in Google Cloud Console, then put its ID here. */
export const DEFAULT_CLIENT_ID = '';
export const clientId = () => read().clientId || DEFAULT_CLIENT_ID;
export const hasClientId = () => !!clientId();
export const setClientId = id => { const s = read(); s.clientId = id.trim(); write(s); };
export const anyLive = () => accounts().some(live);
export const anyExpired = () => accounts().some(a => !live(a));

function loadGis() {
  if (window.google?.accounts?.oauth2) return Promise.resolve();
  return new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client'; s.async = true;
    s.onload = () => res(); s.onerror = () => rej(new Error('Could not reach Google sign-in. Are you offline?'));
    document.head.append(s);
  });
}
/** Asks Google for an access token. `hint` picks a known account; without it Google shows its account chooser. */
async function token({ hint, silent } = {}) {
  const clientId_ = clientId();
  if (!clientId_) throw new Error('Google sign-in is not set up in this copy of the app. Add a client ID under Settings → Accounts → Repository, token and Google client ID.');
  await loadGis();
  return new Promise((res, rej) => {
    const tc = window.google.accounts.oauth2.initTokenClient({
      client_id: clientId_, scope: SCOPE,
      callback: r => r.error ? rej(new Error(r.error_description || r.error)) : res({ token: r.access_token, exp: Date.now() + Math.max(60, (+r.expires_in || 3600) - 60) * 1000 }),
      error_callback: e => rej(new Error(e?.type === 'popup_closed' ? 'Sign-in was cancelled.' : e?.message || 'Google sign-in failed')),
    });
    tc.requestAccessToken({ prompt: silent ? 'none' : hint ? '' : 'select_account', ...(hint ? { hint } : {}) });
  });
}

async function call(tok, path, { method = 'GET', body, headers } = {}) {
  const r = await fetch(API + path, { method, headers: { Authorization: 'Bearer ' + tok, ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined });
  if (!r.ok && r.status !== 304) { const j = await r.json().catch(() => ({})); throw Object.assign(new Error(r.status === 401 ? 'Google sign-in expired.' : j.error?.message || `Google Calendar error ${r.status}`), { expired: r.status === 401 }); }
  return r;
}
async function api(email, path, opt) {
  const a = account(email);
  if (!live(a)) throw Object.assign(new Error(`${email} needs to sign in again.`), { expired: true, email });
  try { return await call(a.token, path, opt); } catch (e) { if (e.expired) patchAccount(email, x => ({ ...x, exp: 0 })); throw Object.assign(e, { email }); }
}

const toCalendars = (items, old = []) => {
  const prev = new Map(old.map(c => [c.id, c]));
  return (items || []).map(c => ({ id: c.id, name: c.summary, color: c.backgroundColor || '#4285f4', primary: !!c.primary, writable: /owner|writer/.test(c.accessRole || ''), on: prev.has(c.id) ? prev.get(c.id).on : c.selected !== false }));
};
const LIST = '/users/me/calendarList?fields=items(id,summary,primary,backgroundColor,selected,accessRole)';

/** Opens Google's popup (call from a click). Adds the account, or refreshes it when it is already known. Returns its email. */
export async function connect(hint) {
  const t = await token({ hint });
  const items = (await (await call(t.token, LIST)).json()).items || [];
  const email = items.find(c => c.primary)?.id || hint;
  if (!email) throw new Error('Google did not say which account this is.');
  const s = read(), old = s.accounts.find(a => a.email === email);
  const next = { email, ...t, calendars: toCalendars(items, old?.calendars) };
  s.accounts = old ? s.accounts.map(a => a.email === email ? next : a) : [...s.accounts, next];
  write(s); return email;
}
/** Quietly renews an expired token when Google still has the session. Never throws. */
export async function renew(email) {
  try { const t = await token({ hint: email, silent: true }); patchAccount(email, a => ({ ...a, ...t })); return true; } catch { return false; }
}
export async function disconnect(email) {
  const a = account(email);
  if (a?.token && live(a)) { try { await loadGis(); window.google.accounts.oauth2.revoke(a.token, () => {}); } catch { /* offline: the token expires by itself within the hour */ } }
  const s = read(); s.accounts = s.accounts.filter(x => x.email !== email); write(s);
  const c = ls.get(CACHE, {}); for (const k of Object.keys(c)) if (k.startsWith(email + '|')) delete c[k]; ls.set(CACHE, c);
}
export async function refreshCalendars(email) {
  const items = (await (await api(email, LIST)).json()).items || [];
  patchAccount(email, a => ({ ...a, calendars: toCalendars(items, a.calendars) }));
}
export const setCalendarOn = (email, id, on) => patchAccount(email, a => ({ ...a, calendars: a.calendars.map(c => c.id === id ? { ...c, on } : c) }));

/** What gets exported: no access tokens, they expire in an hour anyway. */
export const exportState = () => { const s = read(); return { clientId: s.clientId, accounts: s.accounts.map(a => ({ email: a.email, calendars: a.calendars })) }; };
export const importState = o => write({ clientId: o?.clientId || '', accounts: (o?.accounts || []).map(a => ({ email: a.email, token: '', exp: 0, calendars: a.calendars || [] })) });

const norm = (it, cal, email) => {
  const allDay = !!it.start?.date, start = allDay ? it.start.date : tkey(new Date(it.start.dateTime)), end = allDay ? it.end.date : tkey(new Date(it.end.dateTime));
  return { id: it.id, title: it.summary || '(no title)', start, end, allDay, notes: it.description || '', location: it.location || '', source: 'google', acct: email, calId: cal.id, color: cal.color, writable: cal.writable, etag: it.etag, recurring: !!it.recurringEventId };
};
const ckey = (email, cal, from, to) => `${email}|${cal.id}|${dkey(from)}|${dkey(to)}`;
/** Events of one calendar in [from, to). Conditional requests (ETag) make "nothing changed" a bodyless 304. */
export async function events(email, cal, from, to) {
  const ck = ckey(email, cal, from, to), cache = ls.get(CACHE, {}), hit = cache[ck];
  const q = `/calendars/${encodeURIComponent(cal.id)}/events?singleEvents=true&orderBy=startTime&maxResults=250&timeMin=${encodeURIComponent(from.toISOString())}&timeMax=${encodeURIComponent(to.toISOString())}&fields=${encodeURIComponent('etag,nextPageToken,items(id,etag,summary,description,location,status,start,end,recurringEventId)')}`;
  const r = await api(email, q, { headers: hit?.etag ? { 'If-None-Match': hit.etag } : {} });
  if (r.status === 304 && hit) return hit.items.map(it => norm(it, cal, email));
  const j = await r.json(); let items = j.items || [], next = j.nextPageToken;
  for (let i = 0; next && i < 4; i++) { const more = await (await api(email, q + '&pageToken=' + next)).json(); items = items.concat(more.items || []); next = more.nextPageToken; }
  items = items.filter(it => it.status !== 'cancelled' && (it.start?.date || it.start?.dateTime));
  const fresh = ls.get(CACHE, {}); fresh[ck] = { etag: j.etag, items }; ls.set(CACHE, fresh);     // re-read: parallel months must not overwrite each other
  return items.map(it => norm(it, cal, email));
}
export const cachedEvents = (email, cal, from, to) => (ls.get(CACHE, {})[ckey(email, cal, from, to)]?.items || []).map(it => norm(it, cal, email));

const body = ev => {
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const o = { summary: ev.title, description: ev.notes || '', location: ev.location || '' };
  if (ev.allDay) { o.start = { date: ev.start.slice(0, 10) }; o.end = { date: ev.end.slice(0, 10) }; }
  else { o.start = { dateTime: parseKey(ev.start).toISOString(), timeZone: tz }; o.end = { dateTime: parseKey(ev.end || ev.start).toISOString(), timeZone: tz }; }
  if (ev.rrule !== undefined) o.recurrence = ev.rrule ? ['RRULE:' + ev.rrule] : [];
  return o;
};
const forget = () => localStorage.removeItem(CACHE);
const path = (calId, id) => `/calendars/${encodeURIComponent(calId)}/events${id ? '/' + encodeURIComponent(id) : ''}`;
export async function create(email, calId, ev) { const j = await (await api(email, path(calId), { method: 'POST', body: body(ev) })).json(); forget(); return j; }
export async function update(ev) { const j = await (await api(ev.acct, path(ev.calId, ev.id), { method: 'PATCH', body: body({ ...ev, rrule: undefined }) })).json(); forget(); return j; }
export async function remove(ev) { await api(ev.acct, path(ev.calId, ev.id), { method: 'DELETE' }); forget(); }
