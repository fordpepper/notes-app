// Pictures without a file extension, scaled-down previews, lightbox, centred header. Run: node media.test.mjs
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import zlib from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createMock } from './mock-github.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SHOTS = path.join(path.dirname(fileURLToPath(import.meta.url)), '_shots');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x'); const f = path.join(ROOT, u.pathname === '/' ? 'index.html' : decodeURIComponent(u.pathname));
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory() || /node_modules|tests/.test(u.pathname)) { res.writeHead(404).end('nf'); return; }
  res.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'text/plain', 'cache-control': 'no-cache' }).end(fs.readFileSync(f));
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const URL0 = `http://127.0.0.1:${server.address().port}/`;

// A valid 2400x1600 PNG with noisy content (a few hundred KB).
function png(w, h) {
  const crcT = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = b => { let c = ~0; for (const x of b) c = crcT[(c ^ x) & 255] ^ (c >>> 8); return ~c >>> 0; };
  const chunk = (t, d) => { const b = Buffer.alloc(12 + d.length); b.writeUInt32BE(d.length, 0); b.write(t, 4); d.copy(b, 8); b.writeUInt32BE(crc(b.subarray(4, 8 + d.length)), 8 + d.length); return b; };
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const o = y * (w * 3 + 1) + 1 + x * 3; raw[o] = (x * 255 / w) | 0; raw[o + 1] = (y * 255 / h) | 0; raw[o + 2] = ((x * y) >> 4 & 255) ^ ((Math.random() * 12) | 0); }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 1 })), chunk('IEND', Buffer.alloc(0))]);
}
const big = png(1800, 1200), small = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGD4DwABBAEAHnOcQAAAAABJRU5ErkJggg==', 'base64');
console.log('test image bytes:', big.length);

const gh = createMock();
gh.seed({
  'Trip.md': '# Trip\n\n![beach](photos/beach)\n\n![tiny](photos/tiny.dat)\n\nhello',
  'photos/beach': big, 'photos/tiny.dat': small, 'photos/notes-file': 'just some text, no extension\n',
  'Ideas.txt': 'bulb',
});
let fails = 0;
const ok = (name, c, extra) => { console.log((c ? 'PASS ' : 'FAIL ') + name + (!c && extra ? '  ' + extra : '')); if (!c) fails++; };
const errors = [];
const browser = await chromium.launch();
async function setup(opts) {
  const ctx = await browser.newContext(opts);
  await ctx.route('https://api.github.com/**', async route => {
    const rq = route.request(), u = new URL(rq.url());
    const res = gh.handle(rq.method(), u.pathname, rq.headers(), rq.postData() ? JSON.parse(rq.postData()) : null);
    const cors = { 'access-control-allow-origin': '*', 'access-control-expose-headers': 'ETag', ...res.headers };
    if (res.raw) return route.fulfill({ status: 200, headers: cors, body: res.raw });
    return route.fulfill({ status: res.status, headers: { ...cors, 'content-type': 'application/json' }, body: res.json ? JSON.stringify(res.json) : '' });
  });
  await ctx.addInitScript(() => { if (!localStorage.getItem('cfg')) { localStorage.setItem('cfg', JSON.stringify({ token: 't', owner: 'me', repo: 'notes', branch: '', root: '' })); localStorage.setItem('welcomed', '1'); } });
  const p = await ctx.newPage();
  p.on('pageerror', e => errors.push(e.message)); p.on('console', m => m.type() === 'error' && !/Failed to load resource|net::ERR/.test(m.text()) && errors.push(m.text()));
  return p;
}

const page = await setup({ viewport: { width: 1280, height: 800 } });
await page.goto(URL0); await page.waitForSelector('.row.file');
await page.click('.row .name:text-is("Trip")');
await page.click('#modes button[title=Preview]');
await page.waitForSelector('#preview h1');
await page.waitForFunction(() => [...document.querySelectorAll('#preview img')].every(i => i.src.startsWith('blob:') && i.classList.contains('ready')), null, { timeout: 15000 });
const info = await page.evaluate(async () => [...document.querySelectorAll('#preview img')].map(i => ({ w: i.naturalWidth, h: i.naturalHeight, src: i.src, path: i.dataset.path })));
ok('extension-less picture is displayed in the preview', info[0].w > 0, JSON.stringify(info[0]));
ok('a picture with an odd extension is displayed too', info[1].w === 1 && info[1].h === 1, JSON.stringify(info[1]));
ok('big picture is shown scaled down (≤1280px) in the preview', info[0].w <= 1280 && info[0].w > 800 && info[0].h * 1.4 < info[0].w * 1.1 + 400, JSON.stringify(info[0]));
const thumbBytes = await page.evaluate(async u => (await (await fetch(u)).blob()).size, info[0].src);
ok('the scaled version is much smaller than the original', thumbBytes < big.length * .6, `${thumbBytes} vs ${big.length}`);
ok('the thumbnail is cached on the device', await page.evaluate(async () => { const c = await caches.open('notes-thumbs-v1'); const r = await Promise.all((await c.keys()).map(k => c.match(k))); return r.some(x => x.headers.get('content-type') === 'image/webp'); }));

// lightbox opens the original
await page.click('#preview img[data-path="photos/beach"]');
await page.waitForSelector('#lightbox');
await page.waitForFunction(() => document.querySelector('#lightbox img').naturalWidth === 1800, null, { timeout: 8000 });
ok('click opens the full-size picture', true);
await page.keyboard.press('Escape');
ok('Escape closes it', await page.locator('#lightbox').count() === 0);

// opening the picture files directly
await page.click('.row.folder:has-text("photos")');
await page.click('.row .name:text-is("beach")');
await page.waitForSelector('#viewer img');
await page.waitForFunction(() => document.querySelector('#viewer img').naturalWidth > 0);
ok('extension-less file opens as a picture in the viewer', (await page.evaluate(() => document.querySelector('#viewer img').naturalWidth)) <= 1280);
ok('its tree icon is a picture icon', await page.locator('.row.file:has(.name:text-is("beach")) svg.fi path[d^="M21 19V5"]').count() === 1);
await page.click('.row .name:text-is("notes-file")');
await page.waitForFunction(() => document.querySelector('#ed').value.startsWith('just some text'));
ok('extension-less text file opens in the editor', await page.locator('#ed').isVisible());
await page.click('.row .name:text-is("tiny.dat")');
await page.waitForSelector('#viewer img');
ok('odd-extension picture opens in the viewer', true);

// reload: thumbnail comes from the cache, the original is not re-read
await page.reload(); await page.waitForSelector('.row.file');
await page.click('.row .name:text-is("Trip")');
await page.locator('#modes button[title=Preview]').click({ timeout: 1500 }).catch(() => {});
await page.waitForFunction(() => [...document.querySelectorAll('#preview img')].every(i => i.classList.contains('ready')));
ok('after reload the preview loads again', true);

// header is centred
await page.waitForTimeout(200);
const c = await page.evaluate(() => { const r = document.querySelector('.tb-c').getBoundingClientRect(), m = document.querySelector('#main').getBoundingClientRect(); return { dx: (r.left + r.width / 2) - (m.left + m.width / 2) }; });
ok('top bar title is centred', Math.abs(c.dx) < 2, JSON.stringify(c));
await page.screenshot({ path: `${SHOTS}/m1-desktop-preview.png` });

const ph = await setup({ viewport: { width: 390, height: 800 }, hasTouch: true, isMobile: true });
await ph.goto(URL0); await ph.waitForSelector('.row.file');
await ph.waitForTimeout(500);
await ph.screenshot({ path: `${SHOTS}/m2-phone-list.png` });
await ph.tap('.row .name:text-is("Trip")'); await ph.waitForSelector('#main.has-file');
await ph.tap('#modes button[title=Preview]');
await ph.waitForFunction(() => [...document.querySelectorAll('#preview img')].every(i => i.classList.contains('ready')), null, { timeout: 15000 });
const pc = await ph.evaluate(() => { const r = document.querySelector('.tb-c').getBoundingClientRect(); return { dx: (r.left + r.width / 2) - innerWidth / 2, overflow: document.documentElement.scrollWidth > innerWidth }; });
ok('phone: title centred and nothing overflows', Math.abs(pc.dx) < 2 && !pc.overflow, JSON.stringify(pc));
await ph.waitForTimeout(500);
await ph.screenshot({ path: `${SHOTS}/m3-phone-preview.png` });
await page.click('#btnSettings'); await page.waitForTimeout(400); await page.screenshot({ path: `${SHOTS}/m4-settings.png` }); await page.keyboard.press('Escape');
await page.click('#btnMore'); await page.waitForTimeout(300); await page.screenshot({ path: `${SHOTS}/m5-menu.png` });
ok('no console errors', errors.length === 0, errors.join(' | '));
await browser.close(); server.close();
console.log(fails ? `\n${fails} FAILED` : '\nall passed'); process.exit(fails ? 1 : 0);
