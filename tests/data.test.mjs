// Download policy: Wi-Fi downloads everything by itself, mobile data asks first. Run: node data.test.mjs
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createMock } from './mock-github.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x'); const f = path.join(ROOT, u.pathname === '/' ? 'index.html' : decodeURIComponent(u.pathname));
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory() || /node_modules|tests/.test(u.pathname)) { res.writeHead(404).end('nf'); return; }
  res.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream', 'cache-control': 'no-cache' }).end(fs.readFileSync(f));
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const URL0 = `http://127.0.0.1:${server.address().port}/`;
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGD4DwABBAEAHnOcQAAAAABJRU5ErkJggg==', 'base64');
let fails = 0; const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (!c && x ? '  ' + x : '')); if (!c) fails++; };
const browser = await chromium.launch();

async function session(connection, files) {
  const gh = createMock(); gh.seed({ 'Notes.txt': 'hello', 'Trip.md': '# Trip\n\n![x](pic.png)\n', 'pic.png': png, 'data.bin': Buffer.alloc(3000, 7) });
  const blobGets = [];
  const ctx = await browser.newContext({ viewport: { width: 1100, height: 800 } });
  await ctx.route('https://api.github.com/**', async route => {
    const rq = route.request(), u = new URL(rq.url());
    if (/\/git\/blobs\//.test(u.pathname) && rq.method() === 'GET') blobGets.push(u.pathname.split('/').pop());
    const res = gh.handle(rq.method(), u.pathname, rq.headers(), rq.postData() ? JSON.parse(rq.postData()) : null);
    const cors = { 'access-control-allow-origin': '*', 'access-control-expose-headers': 'ETag', ...res.headers };
    if (res.raw) return route.fulfill({ status: 200, headers: cors, body: res.raw });
    return route.fulfill({ status: res.status, headers: { ...cors, 'content-type': 'application/json' }, body: res.json ? JSON.stringify(res.json) : '' });
  });
  await ctx.addInitScript(([conn, files]) => {
    if (conn) Object.defineProperty(navigator, 'connection', { value: { ...conn, addEventListener() {} }, configurable: true });
    if (!localStorage.getItem('cfg')) { localStorage.setItem('cfg', JSON.stringify({ token: 't', owner: 'me', repo: 'notes', branch: '', root: '' })); localStorage.setItem('welcomed', '1'); if (files) localStorage.setItem('prefs', JSON.stringify({ files, v: 4 })); }
  }, [connection, files]);
  const p = await ctx.newPage(); const errors = [];
  p.on('pageerror', e => errors.push(e.message));
  await p.goto(URL0); await p.waitForSelector('.row.file');
  return { p, gh, blobGets, errors, ctx, sha: n => { const t = gh.commitsTree?.(); return null; } };
}
const until = async (p, fn, arg, ms = 15000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await p.evaluate(fn, arg)) return true; await new Promise(r => setTimeout(r, 200)); } return false; };
const local = (p, name) => p.evaluate(async n => (await import('/js/model.js')).files.get(n)?.content != null, name);

// 1. Wi-Fi: everything downloads by itself
{
  const { p, ctx, errors } = await session({ type: 'wifi' });
  await until(p, async () => { const M = await import('/js/model.js'); return [...M.files.values()].every(r => r.content != null); });
  ok('wifi: files that were never opened are downloaded automatically', await local(p, 'pic.png') && await local(p, 'data.bin'));
  await p.click('#btnTree'); await p.waitForSelector('dialog.alltree');
  ok('wifi: tree shows nothing left to download', await p.locator('dialog.alltree li.file.remote').count() === 0);
  ok('wifi: no errors', errors.length === 0, errors.join('|')); await ctx.close();
}
// 2. Mobile data: nothing downloads, opening asks
{
  const { p, ctx, blobGets, errors } = await session({ type: 'cellular' });
  await p.waitForTimeout(2500);
  const eagerOnly = blobGets.length;
  ok('mobile data: pictures and other files are not downloaded in the background', !(await local(p, 'pic.png')) && !(await local(p, 'data.bin')));
  await p.click('.row .name:text-is("data.bin")');
  await p.waitForSelector('#viewer .filecard');
  const card = await p.locator('#viewer').innerText();
  ok('mobile data: opening shows size and a Download button instead of loading', /Download \(3 KB\)/.test(card) && /mobile data/.test(card), card);
  ok('mobile data: nothing was fetched meanwhile', blobGets.length === eagerOnly && !(await local(p, 'data.bin')));
  await p.click('#viewer button:has-text("Download")');
  ok('mobile data: after the OK it downloads', await until(p, async () => (await import('/js/model.js')).files.get('data.bin').content != null));
  await p.click('.row .name:text-is("Trip")'); await p.click('#modes button[title=Preview]');
  await p.waitForSelector('#preview .imgask');
  ok('mobile data: pictures in a note wait behind a tap', /Load picture/.test(await p.locator('#preview .imgask').innerText()) && !(await local(p, 'pic.png')));
  await p.click('#preview .imgask');
  await p.waitForFunction(() => document.querySelector('#preview img')?.src?.startsWith('blob:'), null, { timeout: 8000 });
  ok('mobile data: tapping loads the picture', await local(p, 'pic.png'));
  ok('mobile data: no errors', errors.length === 0, errors.join('|')); await ctx.close();
}
// 3. Data Saver counts as mobile data
{
  const { p, ctx } = await session({ type: 'wifi', saveData: true });
  await p.waitForTimeout(2000);
  ok('data saver: behaves like mobile data', !(await local(p, 'data.bin'))); await ctx.close();
}
// 4. "Only when opened": no background download, no questions
{
  const { p, ctx } = await session({ type: 'wifi' }, 'manual');
  await p.waitForTimeout(2000);
  ok('manual: nothing downloads by itself', !(await local(p, 'data.bin')));
  await p.click('.row .name:text-is("data.bin")');
  ok('manual: opening just downloads it', await until(p, async () => (await import('/js/model.js')).files.get('data.bin').content != null) && await p.locator('#viewer .primary:has-text("Download (")').count() === 0); await ctx.close();
}
// 5. "Always": downloads even on mobile data
{
  const { p, ctx } = await session({ type: 'cellular' }, 'always');
  ok('always: downloads on mobile data too', await until(p, async () => (await import('/js/model.js')).files.get('data.bin')?.content != null)); await ctx.close();
}
await browser.close(); server.close();
console.log(fails ? `\n${fails} FAILED` : '\nall passed'); process.exit(fails ? 1 : 0);
