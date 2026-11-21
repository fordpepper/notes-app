// Drives the real app in headless Chromium against an in-memory GitHub. Run: node e2e.test.mjs
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createMock } from './mock-github.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SHOTS = path.join(path.dirname(fileURLToPath(import.meta.url)), '_shots');
fs.mkdirSync(SHOTS, { recursive: true });
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };

// static server; sw.js gets a BUILD stamp we can change to simulate a new deploy
let build = '__BUILD__', cssExtra = '';
const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x'); let f = path.join(ROOT, u.pathname === '/' ? 'index.html' : decodeURIComponent(u.pathname));
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory() || /node_modules|tests/.test(u.pathname)) { res.writeHead(404).end('nf'); return; }
  let body = fs.readFileSync(f);
  if (u.pathname === '/sw.js') body = Buffer.from(body.toString().replace('__BUILD__', build));
  if (u.pathname === '/style.css') body = Buffer.from(body.toString() + cssExtra);
  res.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'text/plain', 'cache-control': 'no-cache' }).end(body);
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const URL0 = `http://127.0.0.1:${server.address().port}/`;

const gh = createMock();
gh.seed({
  'Projects/todo.md': '# Todo\n\n- [ ] first\n- [x] second\n\nSee [[Ideas]] and ![pic](pic.png)',
  'Projects/pic.png': Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGD4DwABBAEAHnOcQAAAAABJRU5ErkJggg==', 'base64'),
  'Ideas.txt': 'bulb', 'Shopping list.txt': 'milk\neggs',
});
async function mockGitHub(ctx) {
  await ctx.route('https://api.github.com/**', async route => {
    const rq = route.request(), u = new URL(rq.url());
    const res = gh.handle(rq.method(), u.pathname, rq.headers(), rq.postData() ? JSON.parse(rq.postData()) : null);
    gh.log.push(`${rq.method()} ${u.pathname.replace('/repos/me/notes', '')} -> ${res.status}`);
    const cors = { 'access-control-allow-origin': '*', 'access-control-expose-headers': 'ETag', ...res.headers };
    if (res.raw) return route.fulfill({ status: 200, headers: cors, body: res.raw });
    return route.fulfill({ status: res.status, headers: { ...cors, 'content-type': 'application/json' }, body: res.json ? JSON.stringify(res.json) : '' });
  });
}

let fails = 0;
const ok = (name, c, extra) => { console.log((c ? 'PASS ' : 'FAIL ') + name + (!c && extra ? '  ' + extra : '')); if (!c) fails++; };
const errors = [];
const watch = page => { page.on('pageerror', e => errors.push(e.message)); page.on('console', m => m.type() === 'error' && !/Failed to load resource|net::ERR/.test(m.text()) && errors.push(m.text())); };
const idle = (page, ms = 8000) => page.waitForFunction(() => document.querySelector('#status').dataset.s === 'idle' && /Synced|Up to date/.test(document.querySelector('#status').textContent), null, { timeout: ms });
const browser = await chromium.launch();

/* ============================== DESKTOP ============================== */
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
await mockGitHub(ctx);
const page = await ctx.newPage(); watch(page);
const vendorRequests = []; page.on('request', r => /\/vendor\//.test(r.url()) && vendorRequests.push(r.url()));
await page.goto(URL0);
await page.waitForSelector('dialog.modal');
ok('first run shows the connect dialog', await page.locator('dialog h3').innerText() === 'Connect your notes repo');
await page.fill('dialog input[placeholder="yourname/notes"]', 'me/notes');
await page.fill('dialog input[type=password]', 'github_pat_x');
await page.click('dialog button.primary');
await page.waitForSelector('dialog', { state: 'detached' });
await page.waitForSelector('.row.folder');
await idle(page);
ok('repo folders + notes appear', await page.locator('.row.folder .name').first().innerText() === 'Projects' && await page.locator('.row .name', { hasText: 'Shopping list' }).count() === 1);
ok('.txt shown without extension', await page.locator('.row .name', { hasText: /^Ideas$/ }).count() === 1);
ok('markdown libraries NOT downloaded until a .md is opened', vendorRequests.length === 0);
await page.screenshot({ path: `${SHOTS}/1-desktop-tree.png` });

// plain-text note
await page.click('.row .name:text-is("Shopping list")');
ok('txt note loads in editor', (await page.inputValue('#ed')) === 'milk\neggs');
ok('txt note: no mode switcher, attach-only toolbar', await page.locator('#modes').isHidden() && await page.locator('#toolbar button').count() === 1);
ok('still no markdown libraries after opening a txt', vendorRequests.length === 0);

// markdown note (existing repos may have them)
await page.click('.row.folder');
await page.click('.row.file:has-text("todo")');
await page.waitForSelector('#preview h1');
ok('md note previews (libs loaded on demand)', vendorRequests.length === 2);
await page.waitForFunction(() => document.querySelector('#preview img')?.src?.startsWith('blob:'));
ok('relative image resolved from repo', true);
ok('wiki link recognised', await page.locator('#preview a.wiki').innerText() === 'Ideas');
await page.locator('#preview input[type=checkbox]').first().check();
await page.waitForTimeout(100);
ok('checkbox toggles the source', (await page.inputValue('#ed')).includes('- [x] first'));
await page.screenshot({ path: `${SHOTS}/2-desktop-split.png` });

// typing: list continuation
await page.click('#ed'); await page.keyboard.press('Control+End');
await page.keyboard.type('\n- alpha'); await page.keyboard.press('Enter'); await page.keyboard.type('beta');
ok('list continuation', (await page.inputValue('#ed')).endsWith('- alpha\n- beta'));

// new note: created as .txt, in the selected folder; empty untouched ones vanish
await page.click('#btnNote');
await page.waitForSelector('#title:focus');
await page.keyboard.type('Meeting notes'); await page.keyboard.press('Enter');
await page.keyboard.type('agenda\n- one');
ok('Enter after the title jumps into the text', (await page.inputValue('#ed')).startsWith('agenda'));
await page.waitForTimeout(600);
ok('new note is .txt in the open folder', await page.locator('.row.file.active .name').innerText() === 'Meeting notes' && await page.locator('#crumb').innerText() === 'Projects');
const before = await page.locator('.row.file').count();
await page.click('#btnNote'); await page.waitForSelector('#title:focus');
await page.click('.row .name:text-is("Ideas")');
await page.waitForTimeout(300);
ok('an untouched new note is discarded when you leave it', await page.locator('.row .name', { hasText: 'Untitled' }).count() === 0 && await page.locator('.row.file').count() === before);

// folder + move
await page.click('#btnFolder'); await page.fill('dialog input', 'Archive'); await page.keyboard.press('Enter');
await page.waitForSelector('.row.folder:has-text("Archive")');
await page.click('.row .name:text-is("Meeting notes")');
await page.click('.row.file.active .more', { force: true });
await page.click('#menu button:has-text("Move to")');
await page.click('.folderlist button:has-text("Archive")');
await page.waitForTimeout(250);
ok('moved into Archive', (await page.locator('#crumb').innerText()).includes('Archive'));

// attachment into a txt note inserts the relative path
const [fc] = await Promise.all([page.waitForEvent('filechooser'), page.click('#toolbar button[title^="Attach"]')]);
await fc.setFiles({ name: 'doc.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 fake') });
await page.waitForTimeout(300);
ok('attachment path inserted', (await page.inputValue('#ed')).includes('attachments/doc.pdf'));

// search
await page.fill('#q', 'bulb'); await page.waitForSelector('.hit');
ok('content search', await page.locator('.hit b').innerText() === 'Ideas');
await page.fill('#q', '');

// delete with Undo
await page.click('.row .name:text-is("Ideas")');
await page.click('#btnMore'); await page.click('#menu button:has-text("Delete")');
await page.waitForSelector('#toast.show.has-action');
ok('delete is immediate and offers Undo', await page.locator('.row .name:text-is("Ideas")').count() === 0 && /Deleted/.test(await page.locator('#toast').innerText()));
await page.click('#toast button');
await page.waitForSelector('.row .name:text-is("Ideas")');
ok('Undo brings it back', true);

// the colour palette drives the whole UI: logo, favicon, controls
const prim = () => page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--primary').trim());
const primBefore = await prim(), favBefore = await page.evaluate(() => decodeURIComponent(document.querySelector('link[rel=icon]').href));
await page.click('#btnSettings');
await page.click('.pal[data-id="rose"]');
const primAfter = await prim();
ok('palette changes the primary colour', primAfter !== primBefore && /^#[0-9a-f]{6}$/.test(primAfter));
ok('tonal colours follow too', await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--secondary-container').trim()) !== '');
ok('favicon follows the palette', (await page.evaluate(() => decodeURIComponent(document.querySelector('link[rel=icon]').href))).includes(primAfter) && !favBefore.includes(primAfter));
await page.screenshot({ path: `${SHOTS}/3-settings-rose.png` });
await page.click('.chip:text-is("Black")');
ok('black theme applies', await page.evaluate(() => getComputedStyle(document.body).backgroundColor) === 'rgb(0, 0, 0)');
await page.click('.switch[data-part="stats"]');
ok('word count can be hidden', await page.evaluate(() => getComputedStyle(document.querySelector('#stats')).display) === 'none');
await page.click('.switch[data-part="stats"]');
await page.click('dialog button:has-text("Close")');
await page.reload(); await page.waitForSelector('.row');
ok('appearance persisted across reload', await page.evaluate(() => document.documentElement.dataset.theme === 'black' && JSON.parse(localStorage.prefs).palette === 'rose'));
await page.click('#btnSettings'); await page.click('.chip:text-is("Match system")'); await page.click('.pal[data-id="teal"]'); await page.click('dialog button:has-text("Close")');

// push
await page.click('#btnSync'); await idle(page);
const T = gh.tree();
ok('pushed: new .txt note in its folder', T.has('Archive/Meeting notes.txt') && gh.text('Archive/Meeting notes.txt').includes('agenda'));
ok('pushed: attachment', T.has('Archive/attachments/doc.pdf'));
ok('pushed: md edit + checkbox', gh.text('Projects/todo.md').includes('- [x] first') && gh.text('Projects/todo.md').endsWith('- beta'));
ok('no Untitled note leaked into the repo', ![...T.keys()].some(k => /Untitled/.test(k)));
ok('undo-after-delete left the repo unchanged', gh.has('Ideas.txt'));

// data use: an idle poll is a single conditional request
await page.click('#btnSync'); await idle(page);      // first check after a push learns the new ETag
gh.resetLog(); await page.click('#btnSync'); await idle(page);
ok('idle sync = 1 request (304)', gh.log.length === 1 && /304/.test(gh.log[0]), gh.log.join(' | '));

// offline: reload from the service worker cache
await ctx.setOffline(true);
await page.reload(); await page.waitForSelector('.row.file');
ok('app loads fully offline', await page.locator('.row.file').count() > 0);
await page.click('.row .name:text-is("Shopping list")');
ok('notes readable offline', (await page.inputValue('#ed')).startsWith('milk'));
await page.click('#ed'); await page.keyboard.press('Control+End'); await page.keyboard.type('\nbread');
await page.waitForTimeout(800);
ok('offline edit is queued, not lost', await page.evaluate(() => document.querySelector('#status').textContent) !== '' );
await ctx.setOffline(false);
await page.click('#btnSync'); await idle(page, 10000);
ok('queued edit pushed once online', gh.text('Shopping list.txt').endsWith('bread'));

/* ============================== AUTO-UPDATE ============================== */
const up = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage(); watch(up);
await up.context().route('https://api.github.com/**', r => r.abort());
build = 'build-one';
await up.goto(URL0); await up.waitForSelector('#btnNote');
await up.evaluate(() => navigator.serviceWorker.ready); await up.waitForFunction(() => navigator.serviceWorker.controller);
await up.evaluate(() => { window.__marker = 'old page'; });
let caches1 = await up.evaluate(() => caches.keys());
ok('versioned app cache created', caches1.includes('notes-app-build-one'), caches1.join());
build = 'build-two'; cssExtra = '\nbody{outline:0 solid red}/*v2*/';
await up.evaluate(() => navigator.serviceWorker.getRegistration().then(r => r.update()));
await up.waitForFunction(() => window.__marker === undefined, null, { timeout: 8000 });
ok('new version installs and the page reloads by itself (no double refresh)', true);
await up.waitForSelector('#btnNote');
const caches2 = await up.evaluate(() => caches.keys());
ok('old build cache is removed', !caches2.includes('notes-app-build-one') && caches2.includes('notes-app-build-two'), caches2.join());
ok('new CSS is served after the update', (await up.evaluate(() => fetch('style.css').then(r => r.text()))).includes('/*v2*/'));
await up.context().close();

/* ============================== PHONE ============================== */
const mctx = await browser.newContext({ viewport: { width: 390, height: 800 }, hasTouch: true, isMobile: true, colorScheme: 'dark' });
await mockGitHub(mctx);
await mctx.addInitScript(() => { if (!localStorage.getItem('cfg')) { localStorage.setItem('cfg', JSON.stringify({ token: 't', owner: 'me', repo: 'notes', branch: '', root: '' })); localStorage.setItem('welcomed', '1'); } });
const m = await mctx.newPage(); watch(m);
await m.goto(URL0);
await m.waitForSelector('.row.file'); await idle(m);
ok('phone starts at the notes list (drawer open)', await m.evaluate(() => document.body.classList.contains('nav-open')));
await m.waitForTimeout(450);
await m.screenshot({ path: `${SHOTS}/4-phone-list.png` });
await m.tap('.row .name:text-is("Shopping list")');
await m.waitForSelector('#main.has-file');
ok('opening a note closes the drawer', await m.evaluate(() => !document.body.classList.contains('nav-open')));
ok('sync button is right there in the top bar', await m.locator('#btnSync2').isVisible());
await m.waitForTimeout(450);
await m.screenshot({ path: `${SHOTS}/5-phone-note.png` });

// a change made elsewhere arrives with ONE tap on the top-bar button
gh.set('Shopping list.txt', 'milk\neggs\nFROM LAPTOP');
await m.tap('#btnSync2'); await m.waitForFunction(() => document.querySelector('#ed').value.includes('FROM LAPTOP'), null, { timeout: 6000 });
ok('one tap on top-bar sync pulls the change into the open note', true);

// returning to the app pulls automatically
gh.set('Shopping list.txt', 'milk\neggs\nFROM LAPTOP\nAUTO');
await m.evaluate(() => { window.dispatchEvent(new Event('focus')); });
await m.waitForFunction(() => document.querySelector('#ed').value.includes('AUTO'), null, { timeout: 6000 }).catch(() => {});
await m.waitForTimeout(100);
ok('coming back to the app syncs without any tap', (await m.inputValue('#ed')).includes('AUTO'));

// pull-to-refresh on the list
await m.tap('#btnMenu'); await m.waitForSelector('body.nav-open');
gh.set('Brand new.txt', 'hi'); gh.resetLog();
await m.evaluate(async () => {
  const el = document.querySelector('#tree'), mk = y => new Touch({ identifier: 1, target: el, clientX: 150, clientY: y });
  const fire = (type, y) => el.dispatchEvent(new TouchEvent(type, { touches: type === 'touchend' ? [] : [mk(y)], changedTouches: [mk(y)], bubbles: true, cancelable: true }));
  fire('touchstart', 300); for (const y of [340, 380, 420, 460]) fire('touchmove', y); fire('touchend', 460);
});
await m.waitForSelector('.row .name:text-is("Brand new")', { timeout: 6000 }).catch(() => {});
ok('pull-to-refresh on the list syncs', await m.locator('.row .name:text-is("Brand new")').count() === 1, gh.log.join(' | '));

// delete on phone with undo
await m.tap('.row .name:text-is("Brand new") >> xpath=.. >> .more');
await m.tap('#menu button:has-text("Delete")');
await m.waitForSelector('#toast.show.has-action', { timeout: 4000 });
ok('phone delete shows Undo', await m.locator('#toast button').isVisible());
await m.tap('#toast button');
await m.waitForSelector('.row .name:text-is("Brand new")');

ok('no horizontal overflow on phone', await m.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
ok('touch rows are finger-sized', (await m.locator('.row').first().boundingBox()).height >= 44);
await m.tap('.row.folder:has-text("Projects")'); await m.tap('.row .name:text-is("todo")');
await m.tap('#modes button[title=Preview]'); await m.waitForSelector('#preview h1');
ok('markdown preview works on phone', true);
await m.waitForTimeout(450);
await m.screenshot({ path: `${SHOTS}/6-phone-dark.png` });
await m.tap('#btnMenu'); await m.waitForSelector('body.nav-open');
await m.waitForTimeout(450);
await m.screenshot({ path: `${SHOTS}/7-phone-drawer.png` });

ok('no console errors anywhere', errors.length === 0, errors.join(' || '));
console.log(fails ? `\n${fails} FAILED` : '\nall passed');
await browser.close(); server.close(); process.exit(fails ? 1 : 0);
