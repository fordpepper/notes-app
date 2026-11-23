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
const gh = createMock(); gh.seed({ 'Notes.txt': 'hello', 'calendar.ics': ics });

// ---- mocked Google: sign-in script + Calendar API
const gcalLog = []; let gEvents = [{ id: 'g1', etag: '"1"', summary: 'Google lunch', status: 'confirmed', start: { dateTime: new Date(now.getFullYear(), now.getMonth(), 12, 12, 0).toISOString() }, end: { dateTime: new Date(now.getFullYear(), now.getMonth(), 12, 13, 0).toISOString() } }];
const browser = await launcher.launch();
async function session(viewport, { google = true } = {}) {
  const ctx = await browser.newContext({ viewport });
  await ctx.route('https://api.github.com/**', async route => {
    const rq = route.request(), u = new URL(rq.url());
    const res = gh.handle(rq.method(), u.pathname, rq.headers(), rq.postData() ? JSON.parse(rq.postData()) : null);
    const cors = { 'access-control-allow-origin': '*', 'access-control-expose-headers': 'ETag', ...res.headers };
    if (res.raw) return route.fulfill({ status: 200, headers: cors, body: res.raw });
    return route.fulfill({ status: res.status, headers: { ...cors, 'content-type': 'application/json' }, body: res.json ? JSON.stringify(res.json) : '' });
  });
  if (google) {
    await ctx.route('https://accounts.google.com/gsi/client', r => r.fulfill({ contentType: 'text/javascript', body: `window.google={accounts:{oauth2:{initTokenClient:c=>({requestAccessToken:()=>setTimeout(()=>c.callback({access_token:'tok-123',expires_in:3600}),20)}),revoke:(t,cb)=>{window.__revoked=t;cb&&cb()}}}};` }));
    await ctx.route('https://www.googleapis.com/calendar/v3/**', async route => {
      const rq = route.request(), u = new URL(rq.url()), cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };
      if (rq.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
      const h = rq.headers(); gcalLog.push(`${rq.method()} ${u.pathname.replace('/calendar/v3', '')} auth=${h.authorization} inm=${h['if-none-match'] || ''}`);
      const json = (o, st = 200, extra = {}) => route.fulfill({ status: st, headers: { ...cors, 'content-type': 'application/json', ...extra }, body: JSON.stringify(o) });
      if (u.pathname.endsWith('/users/me/calendarList')) return json({ items: [{ id: 'primary', summary: 'me@gmail.com', primary: true, backgroundColor: '#4285f4', selected: true, accessRole: 'owner' }] });
      if (/\/events$/.test(u.pathname) && rq.method() === 'GET') { const et = '"v' + gEvents.length + gEvents.map(e => e.summary).join('') + '"'; if (h['if-none-match'] === et) return route.fulfill({ status: 304, headers: cors }); return json({ etag: et, items: gEvents }, 200, { etag: et }); }
      if (/\/events$/.test(u.pathname) && rq.method() === 'POST') { const b = rq.postDataJSON(); const ev = { id: 'g' + (gEvents.length + 1), etag: '"n"', status: 'confirmed', ...b }; gEvents.push(ev); return json(ev); }
      const m = /\/events\/([^/]+)$/.exec(u.pathname);
      if (m && rq.method() === 'PATCH') { const i = gEvents.findIndex(e => e.id === m[1]); Object.assign(gEvents[i], rq.postDataJSON()); return json(gEvents[i]); }
      if (m && rq.method() === 'DELETE') { gEvents = gEvents.filter(e => e.id !== m[1]); return route.fulfill({ status: 204, headers: cors }); }
      return json({}, 404);
    });
  }
  await ctx.addInitScript(() => { if (!localStorage.getItem('cfg')) { localStorage.setItem('cfg', JSON.stringify({ token: 't', owner: 'me', repo: 'notes', branch: '', root: '' })); localStorage.setItem('welcomed', '1'); } });
  const p = await ctx.newPage(); p.on('pageerror', e => errors.push(e.message)); p.on('console', m => m.type() === 'error' && !/Failed to load resource|net::ERR/.test(m.text()) && errors.push(m.text()));
  await p.goto(URL0); await p.waitForSelector('.row.file');
  return { p, ctx };
}
const chips = p => p.locator('#cal .cd .ce .n').allInnerTexts();

const { p, ctx } = await session({ width: 1280, height: 900 });
ok('sidebar is clean: search, new, menu, tabs, status', await p.locator('#side button:visible').evaluateAll(b => b.map(x => x.id || x.dataset.view)).then(l => l.filter(Boolean).join(',') === 'btnNote,btnSide,notes,calendar'));
await p.click('#tabs button[data-view=calendar]'); await p.waitForSelector('#cal .cd');
ok('calendar opens with the month grid (42 days)', await p.locator('#cal .cd').count() === 42);
ok('ICS events from the repo show up (timed, multi-day, repeating)', (await chips(p)).filter(t => t === 'Dentist').length === 1 && (await chips(p)).filter(t => t === 'Trip').length === 2 && (await chips(p)).filter(t => t === 'Weekly run').length >= 4, (await chips(p)).join('|'));
ok('without an account it offers Google as optional', /Connect Google Calendar \(optional\)/.test(await p.locator('.cal-acct').innerText()));
await p.screenshot({ path: `${SHOTS}/c1-month.png` });

// create a local event
await p.click('.cal-head .primary'); await p.waitForSelector('dialog.evdlg');
await p.fill('dialog.evdlg input[placeholder=Title]', 'Team meeting');
await p.selectOption('dialog.evdlg select >> nth=0', 'FREQ=DAILY');   // repeat daily
await p.fill('dialog.evdlg input[placeholder=Place]', 'Room 4');
await p.click('dialog.evdlg .primary');
await p.waitForFunction(() => document.querySelectorAll('#cal .ce .n').length > 0 && [...document.querySelectorAll('#cal .ce .n')].some(n => n.textContent === 'Team meeting'));
ok('new event is saved, repeats daily', (await chips(p)).filter(t => t === 'Team meeting').length >= 7);
await p.click('#status'); await p.waitForFunction(() => document.querySelector('#status').dataset.s === 'idle');
const pushed = gh.text('calendar.ics');
ok('it is written to calendar.ics in the repo (and old events + alarm are kept)', /SUMMARY:Team meeting/.test(pushed) && /RRULE:FREQ=DAILY/.test(pushed) && /SUMMARY:Dentist/.test(pushed) && /BEGIN:VALARM/.test(pushed) && /LOCATION:Main St\\, 5/.test(pushed), pushed.slice(0, 300));
// edit + delete
await p.locator('#cal .cd .ce:has(.n:text-is("Dentist"))').click(); await p.waitForSelector('dialog.evdlg');
ok('editor shows the event details', await p.inputValue('dialog.evdlg input[placeholder=Title]') === 'Dentist' && await p.inputValue('dialog.evdlg input[placeholder=Place]') === 'Main St, 5');
await p.fill('dialog.evdlg input[placeholder=Title]', 'Dentist (moved)'); await p.click('dialog.evdlg .primary');
await p.waitForFunction(() => [...document.querySelectorAll('#cal .ce .n')].some(n => n.textContent === 'Dentist (moved)'));
await p.locator('#cal .cd .ce:has(.n:text-is("Dentist (moved)"))').click(); await p.click('dialog.evdlg .danger'); await p.click('dialog:has(h3:text("Delete this event?")) .danger');
await p.waitForFunction(() => ![...document.querySelectorAll('#cal .ce .n')].some(n => /Dentist/.test(n.textContent)));
ok('events can be edited and deleted', true);
// back to notes
await p.click('#tabs button[data-view=notes]'); await p.click('.row .name:text-is("Notes")');
ok('switching back to notes works', await p.locator('#cal').isHidden() && (await p.inputValue('#ed')) === 'hello');

// ---- Google (optional)
await p.click('#tabs button[data-view=calendar]');
await openMenu(p, 'Settings'); await p.click('dialog details.sect:has(summary:has-text("Calendar")) summary');
await p.fill('dialog input[placeholder*=googleusercontent]', 'test-client.apps.googleusercontent.com');
await p.click('dialog button:has-text("Connect Google Calendar")');
await p.waitForSelector('dialog .calsel');
ok('connect: account name and calendar list appear', /me@gmail.com/.test(await p.locator('dialog details.sect:has(summary:has-text("Calendar"))').innerText()));
await p.click('dialog button:has-text("Close")');
await p.waitForFunction(() => [...document.querySelectorAll('#cal .ce .n')].some(n => n.textContent === 'Google lunch'));
ok('Google events show next to local ones', true);
ok('API calls carry the token', gcalLog.some(l => /calendarList auth=Bearer tok-123/.test(l)) && gcalLog.some(l => /\/calendars\/primary\/events auth=Bearer tok-123/.test(l)));
await p.screenshot({ path: `${SHOTS}/c2-google.png` });
// reopening asks with the stored etag: a 304 needs no body
await p.click('.cal-acct button:has-text("Refresh")'); await p.waitForTimeout(500);
ok('refresh uses a conditional request (nothing new = no data)', gcalLog.some(l => /events auth=Bearer tok-123 inm="v/.test(l)));
// create on Google
await p.click('.cal-head .primary'); await p.waitForSelector('dialog.evdlg');
await p.fill('dialog.evdlg input[placeholder=Title]', 'From the app'); await p.selectOption('dialog.evdlg select >> nth=1', 'primary'); await p.click('dialog.evdlg .primary');
await p.waitForFunction(() => [...document.querySelectorAll('#cal .ce .n')].some(n => n.textContent === 'From the app'));
ok('creating an event on Google works', gEvents.some(e => e.summary === 'From the app') && gcalLog.some(l => /^POST \/calendars\/primary\/events/.test(l)));
await p.locator('#cal .cd .ce:has(.n:text-is("From the app"))').click(); await p.fill('dialog.evdlg input[placeholder=Title]', 'Renamed'); await p.click('dialog.evdlg .primary');
await p.waitForFunction(() => [...document.querySelectorAll('#cal .ce .n')].some(n => n.textContent === 'Renamed'));
ok('editing a Google event patches it', gEvents.some(e => e.summary === 'Renamed') && gcalLog.some(l => /^PATCH /.test(l)));
await p.locator('#cal .cd .ce:has(.n:text-is("Renamed"))').click(); await p.click('dialog.evdlg .danger'); await p.click('dialog:has(h3:text("Delete this event?")) .danger');
await p.waitForFunction(() => ![...document.querySelectorAll('#cal .ce .n')].some(n => n.textContent === 'Renamed'));
ok('deleting a Google event deletes it there', !gEvents.some(e => e.summary === 'Renamed') && gcalLog.some(l => /^DELETE /.test(l)));
// disconnect
await openMenu(p, 'Settings'); await p.click('dialog details.sect:has(summary:has-text("Calendar")) summary'); await p.click('dialog button:has-text("Disconnect")'); await p.click('dialog button:has-text("Close")');
ok('disconnect removes Google events and revokes the token', await p.evaluate(() => window.__revoked) === 'tok-123' && !(await chips(p)).includes('Google lunch'));
await ctx.close();

// ---- phone
const ph = await session({ width: 390, height: 800 }, { google: false });
await ph.p.evaluate(() => document.body.classList.add('nav-open')); await ph.p.click('#tabs button[data-view=calendar]'); await ph.p.waitForSelector('#cal .cd'); await ph.p.waitForTimeout(500);
ok('phone: calendar fits the screen and the drawer closes', await ph.p.evaluate(() => document.documentElement.scrollWidth <= innerWidth && !document.body.classList.contains('nav-open')));
await ph.p.screenshot({ path: `${SHOTS}/c3-phone.png` });
ok('no console errors', errors.length === 0, errors.join(' | '));
await browser.close(); server.close();
console.log(fails ? `\n${fails} FAILED` : '\nall passed'); process.exit(fails ? 1 : 0);
