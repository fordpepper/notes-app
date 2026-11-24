// Calendar: local events in calendar.ics (synced through the repo) + optional Google Calendar. Run: node calendar.test.mjs
import { chromium, firefox } from 'playwright';
const launcher = process.env.BROWSER === 'firefox' ? firefox : chromium;
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createMock } from './mock-github.mjs';
const openMenu = async (pg, label) => { await pg.click('#btnSide'); await pg.click(`#menu button:has-text("${label}")`); };

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SHOTS = path.join(path.dirname(fileURLToPath(import.meta.url)), '_shots');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x'); const f = path.join(ROOT, u.pathname === '/' ? 'index.html' : decodeURIComponent(u.pathname));
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory() || /node_modules|tests/.test(u.pathname)) { res.writeHead(404).end('nf'); return; }
  res.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream', 'cache-control': 'no-cache' }).end(fs.readFileSync(f));
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const URL0 = `http://127.0.0.1:${server.address().port}/`;
let fails = 0; const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (!c && x ? '  ' + x : '')); if (!c) fails++; };
const errors = [];
const pad = n => String(n).padStart(2, '0'), now = new Date();
const ymd = (d, h) => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}${h == null ? '' : `T${pad(h)}0000`}`;
const day = n => new Date(now.getFullYear(), now.getMonth(), Math.min(n, 28));
const ics = `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:one@x\r\nDTSTART:${ymd(day(10), 9)}\r\nDTEND:${ymd(day(10), 10)}\r\nSUMMARY:Dentist\r\nLOCATION:Main St\\, 5\r\nEND:VEVENT\r\nBEGIN:VEVENT\r\nUID:two@x\r\nDTSTART;VALUE=DATE:${ymd(day(15))}\r\nDTEND;VALUE=DATE:${ymd(day(17))}\r\nSUMMARY:Trip\r\nEND:VEVENT\r\nBEGIN:VEVENT\r\nUID:three@x\r\nDTSTART:${ymd(day(2), 18)}\r\nDTEND:${ymd(day(2), 19)}\r\nSUMMARY:Weekly run\r\nRRULE:FREQ=WEEKLY\r\nBEGIN:VALARM\r\nTRIGGER:-PT15M\r\nEND:VALARM\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n`;
const feedIcs = `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:f1\r\nDTSTART;TZID=America/New_York:${ymd(day(14), 9)}\r\nDTEND;TZID=America/New_York:${ymd(day(14), 10)}\r\nSUMMARY:Feed meeting\r\nEND:VEVENT\r\nBEGIN:VEVENT\r\nUID:f2\r\nDTSTART:${ymd(day(15), 9)}\r\nDTEND:${ymd(day(15), 10)}\r\nRRULE:FREQ=DAILY;COUNT=5\r\nEXDATE:${ymd(day(17), 9)}\r\nSUMMARY:Feed daily\r\nEND:VEVENT\r\nBEGIN:VEVENT\r\nUID:f3\r\nDTSTART:${ymd(day(20), 9)}\r\nDTEND:${ymd(day(20), 10)}\r\nSTATUS:CANCELLED\r\nSUMMARY:Feed cancelled\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n`;
const gh = createMock(); gh.seed({ 'Notes.txt': 'hello', 'calendar.ics': ics, '.google/links.txt': 'Work | https://calendar.google.com/calendar/ical/x/private-abc/basic.ics\n', '.google/1.ics': feedIcs });

// ---- mocked Google: sign-in script + Calendar API. Two accounts: tok-1 = me@gmail.com, tok-2 = work@corp.com
const gcalLog = [], authLog = [], revoked = [], deny = { v: false }; let nTok = 0;
const at = (d, h) => new Date(now.getFullYear(), now.getMonth(), d, h, 0).toISOString();
const gEvents = { 'tok-1': [{ id: 'g1', etag: '"1"', summary: 'Google lunch', status: 'confirmed', start: { dateTime: at(12, 12) }, end: { dateTime: at(12, 13) } }], 'tok-2': [{ id: 'w1', etag: '"1"', summary: 'Work sync', status: 'confirmed', start: { dateTime: at(13, 9) }, end: { dateTime: at(13, 10) } }] };
const EMAIL = { 'tok-1': 'me@gmail.com', 'tok-2': 'work@corp.com' };
const browser = await launcher.launch();
async function session(viewport, { google = true, storage, setup } = {}) {
  const ctx = await browser.newContext({ viewport, acceptDownloads: true });
  await ctx.route('https://api.github.com/**', async route => {
    const rq = route.request(), u = new URL(rq.url());
    const res = gh.handle(rq.method(), u.pathname, rq.headers(), rq.postData() ? JSON.parse(rq.postData()) : null);
    const cors = { 'access-control-allow-origin': '*', 'access-control-expose-headers': 'ETag', ...res.headers };
    if (res.raw) return route.fulfill({ status: 200, headers: cors, body: res.raw });
    return route.fulfill({ status: res.status, headers: { ...cors, 'content-type': 'application/json' }, body: res.json ? JSON.stringify(res.json) : '' });
  });
  if (google) {
    await ctx.route('https://accounts.google.com/o/oauth2/v2/auth*', r => {
      const q = new URL(r.request().url()).searchParams, hint = q.get('login_hint'), prompt = q.get('prompt') || '', back = h => r.fulfill({ status: 302, headers: { location: `${q.get('redirect_uri')}#${h}&state=${q.get('state')}` } });
      authLog.push(`${prompt}|${hint || ''}|${q.get('response_type')}|${q.get('scope').includes('calendar.events')}`);
      if (prompt === 'none' && deny.v) return back('error=login_required');
      if (hint === 'denied@x.com') return back('error=access_denied');
      const t = hint === 'work@corp.com' ? 'tok-2' : hint === 'me@gmail.com' ? 'tok-1' : 'tok-' + (++nTok);
      back(`access_token=${t}&token_type=Bearer&expires_in=3600`);
    });
    await ctx.route('https://oauth2.googleapis.com/revoke', r => { revoked.push(new URLSearchParams(r.request().postData()).get('token')); r.fulfill({ status: 200, body: '' }); });
    await ctx.route('https://www.googleapis.com/calendar/v3/**', async route => {
      const rq = route.request(), u = new URL(rq.url()), cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };
      if (rq.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
      const h = rq.headers(), tok = (h.authorization || '').replace('Bearer ', ''); gcalLog.push(`${rq.method()} ${u.pathname.replace('/calendar/v3', '')} auth=${tok} inm=${h['if-none-match'] || ''}`);
      const json = (o, st = 200, extra = {}) => route.fulfill({ status: st, headers: { ...cors, 'content-type': 'application/json', ...extra }, body: JSON.stringify(o) });
      const list = gEvents[tok] || [];
      if (u.pathname.endsWith('/users/me/calendarList')) return json({ items: [{ id: EMAIL[tok], summary: EMAIL[tok], primary: true, backgroundColor: tok === 'tok-1' ? '#4285f4' : '#e8590c', selected: true, accessRole: 'owner' }] });
      if (/\/events$/.test(u.pathname) && rq.method() === 'GET') { const et = '"v' + list.map(e => e.summary).join('') + '"'; if (h['if-none-match'] === et) return route.fulfill({ status: 304, headers: cors }); return json({ etag: et, items: list }, 200, { etag: et }); }
      if (/\/events$/.test(u.pathname) && rq.method() === 'POST') { const ev = { id: 'n' + list.length, etag: '"n"', status: 'confirmed', ...rq.postDataJSON() }; list.push(ev); return json(ev); }
      const m = /\/events\/([^/]+)$/.exec(u.pathname);
      if (m && rq.method() === 'PATCH') { Object.assign(list.find(e => e.id === m[1]), rq.postDataJSON()); return json({}); }
      if (m && rq.method() === 'DELETE') { const i = list.findIndex(e => e.id === m[1]); if (i >= 0) list.splice(i, 1); return route.fulfill({ status: 204, headers: cors }); }
      return json({}, 404);
    });
  }
  await ctx.addInitScript(([st, sup]) => {
    if (!localStorage.getItem('cfg') && !sessionStorage.getItem('fresh')) { if (!st) localStorage.setItem('welcomed', '1'); if (!st) localStorage.setItem('cfg', JSON.stringify({ token: 'ghp_secret_value_123', owner: 'me', repo: 'notes', branch: '', root: '' })); }
    if (sup) eval(sup);
  }, [storage, setup || '']);
  const p = await ctx.newPage(); p.on('pageerror', e => errors.push(e.message)); p.on('console', m => m.type() === 'error' && !/Failed to load resource|net::ERR/.test(m.text()) && errors.push(m.text()));
  await p.goto(URL0); if (!storage) await p.waitForSelector('.row.file');
  return { p, ctx };
}
const chips = p => p.locator('#cal .cd .ce .n').allInnerTexts();
const hasChip = (p, t) => p.waitForFunction(t => [...document.querySelectorAll('#cal .ce .n')].some(n => n.textContent === t), t);
const noChip = (p, t) => p.waitForFunction(t => ![...document.querySelectorAll('#cal .ce .n')].some(n => n.textContent === t), t);
const title = p => p.locator('.cal-title h2').innerText();
const monthName = (d, o = 0) => new Date(d.getFullYear(), d.getMonth() + o, 15).toLocaleDateString(undefined, { month: 'long', year: 'numeric' }).toLowerCase();
const settings = async p => { await openMenu(p, 'Settings'); await p.waitForSelector('dialog.full'); if (!await p.locator('dialog details.sect:has(summary:has-text("Accounts"))[open]').count()) await p.click('dialog details.sect:has(summary:has-text("Accounts")) summary'); };
const until = async (f, ms = 4000) => { for (let t = 0; t < ms; t += 100) { if (f()) return true; await new Promise(r => setTimeout(r, 100)); } return false; };
const closeSettings = p => p.click('dialog button:has-text("Close")');

const { p, ctx } = await session({ width: 1280, height: 900 });
ok('sidebar is clean: search, new, menu, tabs, status', await p.locator('#side button:visible').evaluateAll(b => b.map(x => x.id || x.dataset.view)).then(l => l.filter(Boolean).join(',') === 'btnNote,btnSide,notes,files,calendar'));
ok('no sync button is shown twice (menu has no Sync now)', await (async () => { await p.click('#btnSide'); const t = await p.locator('#menu button').allInnerTexts(); await p.keyboard.press('Escape'); return !t.some(x => /Sync/.test(x)); })());
await p.click('#tabs button[data-view=calendar]'); await p.waitForSelector('#cal .cd');
await p.waitForTimeout(400);
ok('calendar is a long run of weeks, not one month', await p.locator('#cal .wk').count() >= 60);
ok('title is the current month and today is on screen', (await title(p)).toLowerCase().includes(monthName(now)) && await p.locator('#cal .cd.today').evaluate(e => { const r = e.getBoundingClientRect(), s = document.querySelector('.cal-scroll').getBoundingClientRect(); return r.top >= s.top && r.bottom <= s.bottom; }));
ok('a multi-day event is one continuous bar across its days', await p.locator('#cal .sp:has-text("Trip")').evaluate(b => { const c = b.parentElement.querySelector('.cd').getBoundingClientRect().width, w = b.getBoundingClientRect().width; return Math.abs(w - 2 * c) < 6 && b.getBoundingClientRect().height > 10; }));
ok('ICS events from the repo show up (timed, multi-day, repeating)', (await chips(p)).filter(t => t === 'Dentist').length === 1 && (await chips(p)).filter(t => t === 'Trip').length === 0 && await p.locator('#cal .sp:has-text("Trip")').count() === 1 && (await chips(p)).filter(t => t === 'Weekly run').length >= 3);
ok('linked calendars (secret iCal address) show read-only events; EXDATE and cancelled are honoured', (await chips(p)).filter(t => t === 'Feed meeting').length === 1 && (await chips(p)).filter(t => t === 'Feed daily').length === 4 && !(await chips(p)).includes('Feed cancelled'), (await chips(p)).join('|'));
ok('calendar view has only Today and Event buttons, no account buttons', (await p.locator('#cal .cal-head button:visible').allInnerTexts()).map(s => s.trim()).join(',') === 'Today,Event' && await p.locator('#cal button:has-text("Google"), #cal button:has-text("Connect"), #cal button:has-text("account")').count() === 0);
await p.screenshot({ path: `${SHOTS}/c1-month.png` });
{ await settings(p); await p.click('dialog details.sect:has(summary:has-text("Calendars")) summary');
  ok('settings: links are listed, and one click opens GitHub with the workflow prefilled', (await p.inputValue('dialog textarea[aria-label="Calendar links"]')).includes('private-abc') && /github\.com\/me\/notes\/new\/.*calendar-links\.yml[\s\S]*cron/.test(decodeURIComponent(await p.locator('dialog a.btn').getAttribute('href'))));
  await closeSettings(p); }

// scrolling like Apple Calendar: continuous, in both directions, header follows
const scroll = (y, rel) => p.evaluate(([y, rel]) => { const s = document.querySelector('.cal-scroll'); s.scrollTop = rel ? s.scrollTop + y : y; return s.scrollTop; }, [y, rel]);
const wkh = await p.locator('#cal .wk').first().evaluate(e => e.getBoundingClientRect().height);
await scroll(wkh * 14, true); await p.waitForTimeout(300);
const t2 = (await title(p)).toLowerCase();
ok('scrolling down moves through the months and the title follows', t2 !== monthName(now) && t2.length > 5, t2);
await scroll(wkh * 80, true); await p.waitForTimeout(300);
ok('it keeps going (window extends), no jump to the top', await p.locator('#cal .wk').count() > 78 && await p.evaluate(() => document.querySelector('.cal-scroll').scrollTop) > wkh * 60);
await scroll(-wkh * 400, true); await p.waitForTimeout(400);
const rowsBefore = await p.locator('#cal .wk').count();
await scroll(0); await p.waitForTimeout(400);
ok('scrolling far up also extends upward', await p.locator('#cal .wk').count() > rowsBefore && await p.evaluate(() => document.querySelector('.cal-scroll').scrollTop) > wkh);
for (let i = 0; i < 14; i++) { await scroll(wkh * 40, true); await p.waitForTimeout(120); }
ok('scrolling for years keeps the page light (old weeks are dropped) and the view does not jump', await p.locator('#cal .wk').count() <= 26 * 8 && await p.evaluate(() => { const s = document.querySelector('.cal-scroll'); return s.scrollTop > 0 && s.scrollTop < s.scrollHeight - s.clientHeight; }));
await p.click('#cal .cal-head button:has-text("Today")'); await p.waitForTimeout(500);
await p.click('#cal .cal-head button:has-text("Today")'); await p.waitForTimeout(1800);
ok('Today scrolls back', (await title(p)).toLowerCase().includes(monthName(now)));
await p.evaluate(() => document.querySelector('.cal-scroll').focus()); await p.keyboard.press('ArrowDown');
ok('arrow keys move the selected day by a week', await p.locator('.cal-day h3').innerText() !== '' && await p.locator('#cal .cd.sel').count() === 1);

// create a local event (single save button in the sheet header)
await p.click('.cal-head .primary'); await p.waitForSelector('dialog.evdlg');
await p.fill('dialog.evdlg input[placeholder=Title]', 'Team meeting');
await p.selectOption('dialog.evdlg select[aria-label=Repeat]', 'FREQ=DAILY');
await p.fill('dialog.evdlg input[placeholder=Place]', 'Room 4');
await p.click('dialog.evdlg .evbar .strong');
await hasChip(p, 'Team meeting');
ok('new event is saved, repeats daily', (await chips(p)).filter(t => t === 'Team meeting').length >= 5);
await p.click('#status'); await p.waitForFunction(() => document.querySelector('#status').dataset.s === 'idle');
const pushed = gh.text('calendar.ics');
ok('it is written to calendar.ics in the repo (old events + alarm kept)', /SUMMARY:Team meeting/.test(pushed) && /RRULE:FREQ=DAILY/.test(pushed) && /SUMMARY:Dentist/.test(pushed) && /BEGIN:VALARM/.test(pushed) && /LOCATION:Main St\\, 5/.test(pushed));
await p.locator('#cal .cd .ce:has(.n:text-is("Dentist"))').click(); await p.waitForSelector('dialog.evdlg');
ok('editor shows the event details', await p.inputValue('dialog.evdlg input[placeholder=Title]') === 'Dentist' && await p.inputValue('dialog.evdlg input[placeholder=Place]') === 'Main St, 5');
await p.fill('dialog.evdlg input[placeholder=Title]', 'Dentist (moved)'); await p.click('dialog.evdlg .evbar .strong');
await hasChip(p, 'Dentist (moved)');
await p.locator('#cal .cd .ce:has(.n:text-is("Dentist (moved)"))').click(); await p.click('dialog.evdlg .evdel'); await p.click('dialog:has(h3:text("Delete this event?")) .danger');
await noChip(p, 'Dentist (moved)');
ok('events can be edited and deleted', true);
await p.click('#tabs button[data-view=files]'); await p.click('.row .name:text-is("Notes")');
ok('switching back to notes works', await p.locator('#cal').isHidden() && (await p.inputValue('#ed')) === 'hello');

// ---- settings: accounts block
await settings(p);
const sb = await p.evaluate(() => { const d = document.querySelector('dialog.full'), row = d.querySelector('.btnrow'); return { fonts: /\bFont\b|Serif|Mono/.test(d.innerText), btns: [...row.children].map(b => b.textContent), same: [...row.children].every(b => b.parentElement === row), rowTops: new Set([...row.children].map(b => Math.round(b.getBoundingClientRect().top))).size, labels: [...d.querySelectorAll('button')].filter(b => b.offsetParent).map(b => b.textContent.trim()) }; });
ok('no font options', !sb.fonts);
ok('all login / transfer buttons sit together in one row', sb.same && sb.btns.join('|') === 'Add Google account|Import calendar file|Export settings|Import settings', JSON.stringify(sb.btns));
ok('settings has no duplicated buttons', (() => { const seen = new Map(); for (const l of sb.labels) seen.set(l, (seen.get(l) || 0) + 1); return [...seen].every(([l, n]) => n === 1 || l === ''); })(), JSON.stringify(sb.labels));
await p.screenshot({ path: `${SHOTS}/c4-settings.png` });
// built-in client ID, then an own one
await p.click('#addGoogle');
ok('no client ID typed in: the field is empty and the button still works (built-in ID)', await p.inputValue('dialog input[aria-label="Google OAuth client ID"]') === ''); await p.click('#addGoogle'); await p.waitForFunction(() => document.querySelectorAll('.acct').length >= 2);
if (!await p.locator('dialog details.adv[open]').count()) await p.click('dialog details.adv summary');
await p.fill('dialog input[aria-label="Google OAuth client ID"]', 'test-client.apps.googleusercontent.com');
await p.click('#addGoogle'); await p.waitForFunction(() => document.querySelectorAll('.acct').length >= 3);

const accts = await p.locator('.acct b').allInnerTexts();
ok('two Google accounts can be signed in at once', accts.includes('me@gmail.com') && accts.includes('work@corp.com'), accts.join(','));
ok('second sign-in lets you choose the account', authLog.slice(0, 2).join() === 'select_account||token|true,select_account||token|true');
await p.click('dialog details.sect:has(summary:has-text("Calendars")) summary');
ok('calendars of both accounts are listed', (await p.locator('dialog .calsel').allInnerTexts()).join('|').includes('me@gmail.com') && (await p.locator('dialog .calsel').allInnerTexts()).join('|').includes('work@corp.com'));
await closeSettings(p);
await p.click('#tabs button[data-view=calendar]');
await hasChip(p, 'Google lunch'); await hasChip(p, 'Work sync');
ok('events of both accounts show together', true);
ok('each call uses its own account token', gcalLog.some(l => /calendars\/me%40gmail.com\/events auth=tok-1/.test(l)) && gcalLog.some(l => /calendars\/work%40corp.com\/events auth=tok-2/.test(l)), gcalLog.join('\n'));
await p.screenshot({ path: `${SHOTS}/c2-google.png` });
// create on the second account
await p.click('.cal-head .primary'); await p.waitForSelector('dialog.evdlg');
await p.fill('dialog.evdlg input[placeholder=Title]', 'From the app'); await p.selectOption('dialog.evdlg select[aria-label=Calendar]', 'work@corp.com|work@corp.com'); await p.click('dialog.evdlg .evbar .strong');
await hasChip(p, 'From the app');
ok('creating an event goes to the chosen account', gEvents['tok-2'].some(e => e.summary === 'From the app') && !gEvents['tok-1'].some(e => e.summary === 'From the app') && gcalLog.some(l => /^POST \/calendars\/work%40corp.com\/events auth=tok-2/.test(l)));
await p.locator('#cal .cd .ce:has(.n:text-is("From the app"))').first().click(); await p.fill('dialog.evdlg input[placeholder=Title]', 'Renamed'); await p.click('dialog.evdlg .evbar .strong');
await hasChip(p, 'Renamed');
ok('editing patches it on that account', gEvents['tok-2'].some(e => e.summary === 'Renamed') && gcalLog.some(l => /^PATCH .* auth=tok-2/.test(l)));
await p.locator('#cal .cd .ce:has(.n:text-is("Renamed"))').first().click(); await p.click('dialog.evdlg .evdel'); await p.click('dialog:has(h3:text("Delete this event?")) .danger');
await noChip(p, 'Renamed');
ok('deleting removes it there', !gEvents['tok-2'].some(e => e.summary === 'Renamed') && gcalLog.some(l => /^DELETE .* auth=tok-2/.test(l)));
// conditional requests on reload
for (let i = 0; i < 2; i++) { await p.reload(); await p.waitForSelector('.row.file'); await p.click('#tabs button[data-view=calendar]'); await hasChip(p, 'Google lunch'); await p.waitForTimeout(400); }
ok('revisits use conditional requests (nothing new = no body)', await until(() => gcalLog.some(l => /events auth=tok-1 inm="v/.test(l))));
// remove one account
await settings(p); await p.locator('.acct:has(b:text-is("work@corp.com")) button:has-text("Remove")').click(); await closeSettings(p);
await noChip(p, 'Work sync');
ok('removing an account removes only its events and revokes its token', (await chips(p)).includes('Google lunch') && revoked.join() === 'tok-2');

// expired token: renewed quietly, otherwise a note that leads to settings
await p.evaluate(() => { const g = JSON.parse(localStorage.gcal); g.accounts.forEach(a => a.exp = 0); localStorage.gcal = JSON.stringify(g); });
await p.reload(); await p.waitForSelector('.row.file'); await p.click('#tabs button[data-view=calendar]'); await hasChip(p, 'Google lunch');
ok('an expired Google session is renewed without any button', gcalLog.filter(l => /calendarList/.test(l)).length >= 0 && authLog.at(-1).startsWith('none|me@gmail.com|'));
deny.v = true; await p.evaluate(() => { const g = JSON.parse(localStorage.gcal); g.accounts.forEach(a => a.exp = 0); localStorage.gcal = JSON.stringify(g); });
await p.reload(); await p.waitForSelector('.row.file'); await p.click('#tabs button[data-view=calendar]');
await p.waitForSelector('.cal-sub button');
ok('if Google needs you again, the calendar only says so and points to Settings', /needs sign-in/.test(await p.locator('.cal-sub button').innerText()) && await p.locator('#cal button:has-text("Add")').count() === 0);
await p.click('.cal-sub button'); await p.waitForSelector('dialog.full');
ok('…which opens Settings where the Sign in button is', await p.locator('.acct button:has-text("Sign in")').count() === 1);
await closeSettings(p);

// ---- export + import (one encrypted file)
await p.waitForTimeout(3000);
await openMenu(p, 'Settings'); await p.click('dialog .pal[data-id=violet]'); await p.waitForTimeout(3500); await closeSettings(p);
await p.reload(); await p.waitForSelector('.row.file'); await settings(p);
await p.click('dialog button:has-text("Export settings")'); await p.waitForSelector('dialog:has(h3:text("Export settings"))');
await p.fill('dialog:has(h3:text("Export settings")) input[placeholder="Passphrase"]', 'short'); await p.fill('dialog:has(h3:text("Export settings")) input[placeholder="Repeat passphrase"]', 'short'); await p.click('dialog:has(h3:text("Export settings")) .primary');
ok('a weak passphrase is refused', /at least 8/.test(await p.locator('dialog:has(h3:text("Export settings")) .err').innerText()));
await p.fill('dialog:has(h3:text("Export settings")) input[placeholder="Passphrase"]', 'correct horse battery'); await p.fill('dialog:has(h3:text("Export settings")) input[placeholder="Repeat passphrase"]', 'correct horse battery');
const [dl] = await Promise.all([p.waitForEvent('download'), p.click('dialog:has(h3:text("Export settings")) .primary')]);
const vaultPath = path.join(SHOTS, 'vault.notesvault'); await dl.saveAs(vaultPath); const vault = fs.readFileSync(vaultPath, 'utf8');
ok('export is one file named .notesvault', /\.notesvault$/.test(dl.suggestedFilename()) && JSON.parse(vault).data.length > 100);
ok('it is encrypted: no token, repo, client ID or account in plain text', !/ghp_secret_value_123|me@gmail|googleusercontent|violet|"owner"/.test(vault));
await ctx.close();

// a brand-new device
const nd = await session({ width: 1280, height: 900 }, { storage: 'empty' });
await nd.p.waitForSelector('dialog.full');
const [fc] = await Promise.all([nd.p.waitForEvent('filechooser'), nd.p.click('dialog button:has-text("Import settings")')]); await fc.setFiles(vaultPath);
await nd.p.waitForSelector('dialog:has(h3:text("Import settings"))');
await nd.p.fill('dialog:has(h3:text("Import settings")) input[type=password]', 'wrong passphrase!'); await nd.p.click('dialog:has(h3:text("Import settings")) .primary');
await nd.p.waitForTimeout(500);
// wrong passphrase: error is shown on the settings page behind, dialog closed
ok('a wrong passphrase is rejected', /Wrong passphrase/.test(await nd.p.locator('dialog.full .err').allInnerTexts().then(a => a.join(' '))) && await nd.p.evaluate(() => !localStorage.getItem('cfg')));
const [fc2] = await Promise.all([nd.p.waitForEvent('filechooser'), nd.p.click('dialog button:has-text("Import settings")')]); await fc2.setFiles(vaultPath);
await nd.p.waitForSelector('dialog:has(h3:text("Import settings"))');
await nd.p.fill('dialog:has(h3:text("Import settings")) input[type=password]', 'correct horse battery'); await nd.p.click('dialog:has(h3:text("Import settings")) .primary');
await nd.p.click('dialog:has(h3:text("Replace settings on this device?")) .primary');
await nd.p.waitForSelector('dialog.full .acct:has(b:text-is("me@gmail.com"))', { timeout: 15000 }); await nd.p.waitForSelector('.row.file', { timeout: 15000 });
const after = await nd.p.evaluate(() => ({ cfg: JSON.parse(localStorage.cfg), pal: JSON.parse(localStorage.prefs).palette, g: JSON.parse(localStorage.gcal) }));
ok('import restores repo, token, colours and Google accounts on the new device', after.cfg.owner === 'me' && after.cfg.token === 'ghp_secret_value_123' && after.pal === 'violet' && after.g.clientId.startsWith('test-client') && after.g.accounts.map(a => a.email).sort().join() === 'me@gmail.com', JSON.stringify(after.g));
ok('notes sync straight away from the same repo', (await nd.p.locator('.row.file .name').allInnerTexts()).includes('Notes'));
ok('imported accounts sign themselves in (no Sign in button to press), tokens were never exported', await nd.p.locator('.acct:has(b:text-is("me@gmail.com")) button:has-text("Sign in")').count() === 0 && await nd.p.locator('.acct:has(b:text-is("me@gmail.com")) small:text("connected")').count() === 1 && authLog.some(l => l.startsWith('|me@gmail.com|token')) && !/tok-1/.test(vault), authLog.join(' ; '));
// import an .ics file (e.g. from Apple Calendar)
const appleIcs = `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:apple-1@icloud\r\nDTSTART:${ymd(day(20), 14)}\r\nDTEND:${ymd(day(20), 15)}\r\nSUMMARY:From Apple\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n`;
const icsPath = path.join(SHOTS, 'apple.ics'); fs.writeFileSync(icsPath, appleIcs);
const [fc3] = await Promise.all([nd.p.waitForEvent('filechooser'), nd.p.click('dialog button:has-text("Import calendar file")')]); await fc3.setFiles(icsPath);
await nd.p.waitForSelector('#toast.show'); await closeSettings(nd.p);
await nd.p.click('#tabs button[data-view=calendar]'); await hasChip(nd.p, 'From Apple');
ok('an .ics file (Apple Calendar export) can be imported', true);
await nd.ctx.close();

// ---- settings follow the repo: a third device that only connects to the repo gets colours and accounts, never tokens
const th = await session({ width: 1280, height: 900 });
await th.p.waitForFunction(() => JSON.parse(localStorage.prefs || '{}').palette === 'violet', null, { timeout: 15000 }).catch(() => {});
const got = await th.p.evaluate(() => ({ pal: JSON.parse(localStorage.prefs).palette, g: JSON.parse(localStorage.gcal || '{}') }));
ok('colours and Google accounts arrive through the repo', got.pal === 'violet' && (got.g.accounts || []).map(a => a.email).join() === 'me@gmail.com', JSON.stringify(got));
ok('the repo itself holds no token', !/tok-|access_token/.test(gh.text('.notes-app.json')));
await th.p.waitForFunction(() => JSON.parse(localStorage.gcal || '{}').accounts?.[0]?.token, null, { timeout: 15000 }).catch(() => {});
ok('the arrived account signs itself in on the new device (no button to press)', await th.p.evaluate(() => !!JSON.parse(localStorage.gcal).accounts[0].token));
await th.ctx.close();

// ---- phone
const ph = await session({ width: 390, height: 800 });
await ph.p.evaluate(() => document.body.classList.add('nav-open')); await ph.p.click('#tabs button[data-view=calendar]'); await ph.p.waitForSelector('#cal .cd'); await ph.p.waitForTimeout(500);
const pm = await ph.p.evaluate(() => { const s = document.querySelector('.cal-scroll'), w = document.querySelector('.cal-day'), g = document.querySelector('.cal-grid').getBoundingClientRect(); return { x: document.documentElement.scrollWidth <= innerWidth, nav: !document.body.classList.contains('nav-open'), scrolls: s.scrollHeight > s.clientHeight * 3, wide: s.scrollWidth <= s.clientWidth, dayBelow: w.getBoundingClientRect().top >= g.bottom - 1, wk: document.querySelector('.wk').getBoundingClientRect().height, head: document.querySelector('.cal-head').getBoundingClientRect().height <= 60 }; });
ok('phone: weeks scroll up and down, no sideways scroll, day list underneath', pm.x && pm.nav && pm.scrolls && pm.wide && pm.dayBelow && pm.wk >= 50 && pm.head, JSON.stringify(pm));
await ph.p.screenshot({ path: `${SHOTS}/c3-phone.png` });
for (const [w, hgt] of [[390, 800], [360, 640], [320, 568]]) {
  await ph.p.setViewportSize({ width: w, height: hgt }); await ph.p.waitForTimeout(150);
  await ph.p.click('.cal-head .primary'); await ph.p.waitForSelector('dialog.evdlg'); await ph.p.waitForTimeout(250);
  const fit = await ph.p.evaluate(() => { const d = document.querySelector('dialog.evdlg'), b = d.querySelector('.evbody'), dr = d.getBoundingClientRect(); const over = [...d.querySelectorAll('input, select, textarea, button, label')].filter(e => e.offsetParent).filter(e => { const r = e.getBoundingClientRect(); return r.right > dr.right + .5 || r.left < dr.left - .5; }).map(e => e.tagName + (e.type || '')); return { sx: b.scrollWidth <= b.clientWidth && d.scrollWidth <= d.clientWidth, sy: b.scrollHeight <= b.clientHeight, over, doc: document.documentElement.scrollWidth <= innerWidth, bottom: dr.bottom <= innerHeight + 1 }; });
  ok(`phone ${w}×${hgt}: new-event sheet fits, no scrolling in any direction`, fit.sx && fit.sy && !fit.over.length && fit.doc && fit.bottom, JSON.stringify(fit));
  if (w === 390) await ph.p.screenshot({ path: `${SHOTS}/c5-editor.png` });
  await ph.p.click('dialog.evdlg .evbar .text:first-child'); await ph.p.waitForTimeout(100);
}
// phone settings: nothing is stretched (collapsed sections stay compact, single buttons keep their natural width)
for (const [w, hgt] of [[390, 800], [360, 640]]) {
  await ph.p.setViewportSize({ width: w, height: hgt }); await ph.p.evaluate(() => document.querySelector('#btnMenu')?.click()); await ph.p.waitForTimeout(200);
  await ph.p.evaluate(() => document.querySelector('#btnSide')?.click()); await ph.p.locator('#menu button:has-text("Settings")').click(); await ph.p.waitForSelector('dialog.full');
  for (const t of ['Calendars', 'More']) await ph.p.locator(`dialog details.sect:has(> summary:has-text("${t}")) > summary`).click();
  const st = await ph.p.evaluate(() => { const box = document.querySelector('dialog .mbody').getBoundingClientRect(); const wd = sel => [...document.querySelectorAll(sel)].map(e => Math.round(e.getBoundingClientRect().width)); return { sect: Math.max(...[...document.querySelectorAll('dialog details.sect:not([open])')].map(e => e.getBoundingClientRect().height), 0), resync: wd('dialog button.ghost'), auto: wd('dialog a.btn'), body: Math.round(box.width) }; });
  ok(`phone ${w}: settings buttons keep their natural width and collapsed sections stay compact`, st.sect <= 60 && st.resync.every(x => x < st.body * .6) && st.auto.every(x => x < st.body * .8), JSON.stringify(st));
  await ph.p.click('dialog button:has-text("Close")');
}
// a sign-in address that this app did not start is ignored and cleaned from the address bar
{ const before = await ph.p.evaluate(() => localStorage.gcal); await ph.p.goto(URL0 + '?t=1#access_token=evil&state=nope&expires_in=3600'); await ph.p.waitForSelector('.row.file');
  ok('a foreign access_token in the address is ignored and removed', await ph.p.evaluate(() => localStorage.gcal) === before && await ph.p.evaluate(() => location.hash) === ''); }
ok('no console errors', errors.length === 0, errors.join(' | '));
await browser.close(); server.close();
console.log(fails ? `\n${fails} FAILED` : '\nall passed'); process.exit(fails ? 1 : 0);
