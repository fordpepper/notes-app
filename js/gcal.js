// Optional Google Calendar sync (no server): Google's browser sign-in (redirect, access token in the address) + the Calendar REST API.
// You bring your own OAuth client ID (Settings → Accounts). Several Google accounts can be connected at once.
// Nothing is requested until you add an account. Access tokens last about an hour and are never written to exports.
import { ls } from './dom.js';
import { dkey, tkey, parseKey } from './ics.js';

const API = 'https://www.googleapis.com/calendar/v3', SCOPE = 'https://www.googleapis.com/auth/calendar.calendarlist.readonly https://www.googleapis.com/auth/calendar.events';
const KEY = 'gcal', CACHE = 'gcal-cache';

function read() {
  const s = ls.get(KEY, {});
  if (!s.accounts) {                                   // older single-account format
    const old = s.token || s.calendars?.length ? [{ email: s.name || 'Google account', token: s.token || '', exp: s.exp || 0, calendars: s.calendars || [] }] : [];
    return { clientId: s.clientId || '', accounts: old };
  }
  return { clientId: s.clientId || '', accounts: s.accounts };
}
const write = s => { ls.set(KEY, s); document.dispatchEvent(new Event('settings-local')); };
const patchAccount = (email, fn) => { const s = read(); s.accounts = s.accounts.map(a => a.email === email ? fn(a) : a); write(s); };

export const state = read;
export const accounts = () => read().accounts;
export const account = email => accounts().find(a => a.email === email);
export const live = a => !!(a?.token && a.exp > Date.now());
/** Shipped with the app so people only press "Sign in". A client ID is public by design (it is not a secret).
 *  Create a "Web application" client once in Google Cloud Console, then put its ID here. */
export const DEFAULT_CLIENT_ID = '153287173251-0nj08f57jqc818qp6r6rv0lmd71jao4f.apps.googleusercontent.com';
export const clientId = () => read().clientId || DEFAULT_CLIENT_ID;
export const hasClientId = () => !!clientId();
export const setClientId = id => { const s = read(); s.clientId = id.trim(); write(s); };
export const anyLive = () => accounts().some(live);
export const anyExpired = () => accounts().some(a => !live(a));

const PEND = 'gcal-pending', REDIRECT = () => location.origin + location.pathname.replace(/[^/]*$/, '');
const rnd = () => [...crypto.getRandomValues(new Uint8Array(16))].map(b => b.toString(16).padStart(2, '0')).join('');
/** Google's sign-in address (the "implicit" browser flow: the access token comes back in the page address). Works on every browser,
 *  including phones and installed apps, because it is a normal page visit and needs no popup. `hint` picks a known account. */
function authUrl({ hint, silent, state }) {
  const id = clientId();
  if (!id) throw new Error('Google sign-in is not set up in this copy of the app. Add a client ID under Settings → Accounts → Repository, token and Google client ID.');
  const q = new URLSearchParams({ client_id: id, redirect_uri: REDIRECT(), response_type: 'token', scope: SCOPE, include_granted_scopes: 'true', state });
  if (hint) q.set('login_hint', hint);
  if (silent) q.set('prompt', 'none'); else if (!hint) q.set('prompt', 'select_account');
  return 'https://accounts.google.com/o/oauth2/v2/auth?' + q;
}
const fromHash = hash => { const q = new URLSearchParams(hash.replace(/^#/, '')); return { state: q.get('state'), error: q.get('error'), token: q.get('access_token'), exp: Date.now() + Math.max(60, (+q.get('expires_in') || 3600) - 60) * 1000 }; };

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

async function addFromToken(t, hint) {
  const items = (await (await call(t.token, LIST)).json()).items || [];
  const email = items.find(c => c.primary)?.id || hint;
  if (!email) throw new Error('Google did not say which account this is.');
  const s = read(), old = s.accounts.find(a => a.email === email);
  const next = { email, token: t.token, exp: t.exp, calendars: toCalendars(items, old?.calendars) };
  s.accounts = old ? s.accounts.map(a => a.email === email ? next : a) : [...s.accounts, next];
  write(s); return email;
}
/** Leaves for Google's sign-in page (call from a click); Google sends the person back to the app, where finishSignIn() adds the account.
 *  Adds a new account (account chooser) or, with `hint`, signs a known one in again. Never returns. */
export function connect(hint) {
  const state = rnd(), url = authUrl({ hint, state });
  ls.set(PEND, { state, hint: hint || '', t: Date.now() });
  location.assign(url);
  return new Promise(() => {});
}
const AUTO = 'gcal-auto';
/** After importing settings the accounts have no token yet. Signs them in one after the other with no clicks: each visit to Google
 *  names the account (login_hint) and Google, which already knows this app's permission, sends straight back. Returns true when it leaves the page. */
export function autoSignIn() {
  const q = ls.get(AUTO, null);
  if (!q) return false;
  const todo = (q.list || []).filter(e => account(e) && !live(account(e)));
  if (!todo.length || !navigator.onLine || Date.now() - q.t > 600000) { localStorage.removeItem(AUTO); return false; }
  ls.set(AUTO, { ...q, list: todo.slice(1) });
  try { connect(todo[0]); } catch { localStorage.removeItem(AUTO); return false; }
  return true;
}
/** Call once at startup: when the page was opened by Google's redirect, takes the token from the address. Resolves to {email} or {error}, or null. */
export async function finishSignIn() {
  if (!/[#&](access_token|error)=/.test(location.hash)) return null;
  const r = fromHash(location.hash), pend = ls.get(PEND, null);
  history.replaceState(null, '', location.pathname + location.search);
  if (!pend || pend.state !== r.state || Date.now() - pend.t > 1800000) return null;
  localStorage.removeItem(PEND);
  if (r.error || !r.token) localStorage.removeItem(AUTO);
  if (r.error || !r.token) return { error: r.error === 'access_denied' ? 'Sign-in was cancelled.' : `Google sign-in failed (${r.error || 'no token'}).` };
  try { return { email: await addFromToken(r, pend.hint) }; } catch (e) { return { error: e.message }; }
}
/** Quietly renews an expired token in a hidden frame when Google still has the session (not possible in every browser). Never throws. */
export function renew(email) {
  return new Promise(res => {
    let state, f; try { state = rnd(); f = document.createElement('iframe'); f.hidden = true; f.setAttribute('aria-hidden', 'true'); f.src = authUrl({ hint: email, silent: true, state }); } catch { return res(false); }
    const end = ok => { clearTimeout(t); removeEventListener('message', on); f.remove(); res(ok); };
    const on = e => {
      if (e.origin !== location.origin || e.source !== f.contentWindow || typeof e.data?.gcal !== 'string') return;
      const r = fromHash(e.data.gcal);
      if (r.state !== state || !r.token) return end(false);
      patchAccount(email, a => ({ ...a, token: r.token, exp: r.exp })); end(true);
    };
    const t = setTimeout(() => end(false), 8000);
    addEventListener('message', on); document.body.append(f);
  });
}
export async function disconnect(email) {
  const a = account(email);
  if (a?.token && live(a)) { try { await fetch('https://oauth2.googleapis.com/revoke', { method: 'POST', mode: 'no-cors', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'token=' + encodeURIComponent(a.token) }); } catch { /* offline: the token expires by itself within the hour */ } }
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
export const importState = o => { const e = (o?.accounts || []).map(a => a.email); if (e.length) ls.set(AUTO, { list: e, t: Date.now() }); return write({ clientId: o?.clientId || '', accounts: (o?.accounts || []).map(a => ({ email: a.email, token: '', exp: 0, calendars: a.calendars || [] })) }); };

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
/** Accounts and calendar choices arriving from the repo (no tokens: a device keeps its own sign-ins and renews quietly). */
export const applySynced = o => {
  const cur = read(), by = new Map(cur.accounts.map(a => [a.email, a]));
  write({ clientId: o?.clientId || '', accounts: (o?.accounts || []).map(a => ({ token: '', exp: 0, ...by.get(a.email), email: a.email, calendars: a.calendars || [] })) });
};
