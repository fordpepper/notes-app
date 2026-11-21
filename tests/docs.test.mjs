// Previews for csv / json / code / html / docx / xlsx / pptx / zip / extension-less files. Run: node docs.test.mjs
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

// --- tiny zip writer (deflate for most files, stored for one) ---
const crcT = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = b => { let c = ~0; for (const x of b) c = crcT[(c ^ x) & 255] ^ (c >>> 8); return ~c >>> 0; };
function zip(files) {
  const parts = [], cd = []; let off = 0, i = 0;
  for (const [name, content] of Object.entries(files)) {
    const raw = Buffer.from(content), method = i++ % 2 ? 0 : 8, data = method === 8 ? zlib.deflateRawSync(raw) : raw, nb = Buffer.from(name);
    const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(method, 8); lh.writeUInt32LE(crc(raw), 14); lh.writeUInt32LE(data.length, 18); lh.writeUInt32LE(raw.length, 22); lh.writeUInt16LE(nb.length, 26);
    const ch = Buffer.alloc(46); ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(method, 10); ch.writeUInt32LE(crc(raw), 16); ch.writeUInt32LE(data.length, 20); ch.writeUInt32LE(raw.length, 24); ch.writeUInt16LE(nb.length, 28); ch.writeUInt32LE(off, 42);
    parts.push(lh, nb, data); cd.push(ch, nb); off += 30 + nb.length + data.length;
  }
  const cdb = Buffer.concat(cd), end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(cd.length / 2, 8); end.writeUInt16LE(cd.length / 2, 10); end.writeUInt32LE(cdb.length, 12); end.writeUInt32LE(off, 16);
  return Buffer.concat([...parts, cdb, end]);
}
const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
const docx = zip({ '[Content_Types].xml': '<Types/>', 'word/document.xml': `<?xml version="1.0"?><w:document ${W}><w:body><w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Quarterly report</w:t></w:r></w:p><w:p><w:r><w:rPr><w:b/></w:rPr><w:t>Bold words</w:t></w:r><w:r><w:t xml:space="preserve"> and plain.</w:t></w:r></w:p><w:tbl><w:tr><w:tc><w:p><w:r><w:t>Cell A</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Cell B</w:t></w:r></w:p></w:tc></w:tr></w:tbl></w:body></w:document>` });
const xlsx = zip({
  'xl/workbook.xml': '<workbook xmlns:r="r"><sheets><sheet name="Budget" sheetId="1" r:id="rId1"/><sheet name="Second" sheetId="2" r:id="rId2"/></sheets></workbook>',
  'xl/_rels/workbook.xml.rels': '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Target="worksheets/sheet2.xml"/></Relationships>',
  'xl/sharedStrings.xml': '<sst><si><t>Item</t></si><si><t>Coffee</t></si><si><t>Amount</t></si></sst>',
  'xl/worksheets/sheet1.xml': '<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>2</v></c></row><row r="2"><c r="A2" t="s"><v>1</v></c><c r="B2"><v>42.5</v></c></row></sheetData></worksheet>',
  'xl/worksheets/sheet2.xml': '<worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Other sheet</t></is></c></row></sheetData></worksheet>',
});
const pptx = zip({ 'ppt/slides/slide1.xml': '<p:sld xmlns:a="a" xmlns:p="p"><a:p><a:r><a:t>Launch plan</a:t></a:r></a:p><a:p><a:r><a:t>Ship on Friday</a:t></a:r></a:p></p:sld>', 'ppt/slides/slide2.xml': '<p:sld xmlns:a="a" xmlns:p="p"><a:p><a:r><a:t>Next steps</a:t></a:r></a:p></p:sld>' });
const arch = zip({ 'readme.txt': 'hello', 'src/main.py': 'print(1)', 'src/': '' });

const gh = createMock();
gh.seed({
  'data.csv': 'name,qty,price\n"Smith, J",3,4.50\nDoe,10,"1,200"\n', 'config.json': '{"name":"notes","list":[1,2,{"deep":true}],"empty":[],"nested":{"a":null,"b":"text"}}',
  'bad.json': '{"oops": }', 'script.py': '# comment\ndef greet(name):\n    return "hi " + name  # trailing\nprint(greet("x"), 42)\n', 'page.html': '<h1 id="x">Hello page</h1>',
  'Guide.md': '# Guide\n\n```js\nconst a = "str"; // note\nfunction f() { return 1 }\n```\n',
  'report.docx': docx, 'budget.xlsx': xlsx, 'deck.pptx': pptx, 'bundle.zip': arch, 'noext-table': Buffer.from('plain text file\n'),
});
let fails = 0; const errors = [];
const ok = (name, c, extra) => { console.log((c ? 'PASS ' : 'FAIL ') + name + (!c && extra ? '  ' + extra : '')); if (!c) fails++; };
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
await ctx.route('https://api.github.com/**', async route => {
  const rq = route.request(), u = new URL(rq.url());
  const res = gh.handle(rq.method(), u.pathname, rq.headers(), rq.postData() ? JSON.parse(rq.postData()) : null);
  const cors = { 'access-control-allow-origin': '*', 'access-control-expose-headers': 'ETag', ...res.headers };
  if (res.raw) return route.fulfill({ status: 200, headers: cors, body: res.raw });
  return route.fulfill({ status: res.status, headers: { ...cors, 'content-type': 'application/json' }, body: res.json ? JSON.stringify(res.json) : '' });
});
await ctx.addInitScript(() => { if (!localStorage.getItem('cfg')) { localStorage.setItem('cfg', JSON.stringify({ token: 't', owner: 'me', repo: 'notes', branch: '', root: '' })); localStorage.setItem('welcomed', '1'); } });
const p = await ctx.newPage();
p.on('pageerror', e => !/sandboxed/.test(e.message) && errors.push(e.message)); p.on('console', m => m.type() === 'error' && !/Failed to load resource|net::ERR|sandboxed/.test(m.text()) && errors.push(m.text()));
await p.goto(URL0); await p.waitForSelector('.row.file');
const open = async name => { await p.click(`.row .name:text-is("${name}")`); };

await open('data.csv'); await p.waitForSelector('#preview table.grid');
ok('csv shows as a table with quoted commas', (await p.locator('#preview td').allInnerTexts()).includes('Smith, J') && (await p.locator('#preview thead th').allInnerTexts()).includes('price'));
ok('numbers are right-aligned', await p.locator('#preview td.num').count() >= 3);
await p.screenshot({ path: `${SHOTS}/d1-csv.png` });
ok('csv can still be edited (switch to Edit)', await (async () => { await p.click('#modes button[title=Edit]'); return (await p.inputValue('#ed')).startsWith('name,qty'); })());

await open('config.json'); await p.waitForSelector('#preview .jsonview');
ok('json is a collapsible tree', await p.locator('#preview details.jd').count() >= 3 && (await p.locator('#preview .jsonview').innerText()).includes('"notes"'));
await p.screenshot({ path: `${SHOTS}/d2-json.png` });
await open('bad.json'); await p.waitForSelector('#preview .banner');
ok('invalid json explains the error and shows the text', /Not valid JSON/.test(await p.locator('#preview .banner').innerText()));

await open('script.py'); await p.waitForFunction(() => /greet/.test(document.querySelector('#preview .code')?.textContent || ''));
ok('code is syntax highlighted with line numbers', await p.locator('#preview .tk-k').count() >= 2 && await p.locator('#preview .tk-s').count() >= 1 && await p.locator('#preview .tk-c').count() >= 2 && (await p.locator('#preview .gutter').innerText()).startsWith('1\n2'));
await p.screenshot({ path: `${SHOTS}/d3-code.png` });

await open('page.html'); await p.waitForSelector('#preview iframe.htmlview');
ok('html renders in a sandboxed frame', (await p.locator('iframe.htmlview').getAttribute('sandbox')) === '' && (await p.frameLocator('iframe.htmlview').locator('h1').innerText()) === 'Hello page');

await open('Guide'); await p.waitForSelector('#preview pre code .tk-k');
ok('markdown code blocks are highlighted', true);

await open('report.docx'); await p.waitForSelector('#viewer .docpage');
ok('docx: headings, bold and tables', await p.locator('#viewer h1').innerText() === 'Quarterly report' && await p.locator('#viewer b').innerText() === 'Bold words' && (await p.locator('#viewer td').allInnerTexts()).join() === 'Cell A,Cell B');
await p.screenshot({ path: `${SHOTS}/d4-docx.png` });
await open('budget.xlsx'); await p.waitForSelector('#viewer table.grid');
ok('xlsx: first sheet as a table (shared strings + numbers)', (await p.locator('#viewer td').allInnerTexts()).join('|').includes('Coffee') && (await p.locator('#viewer td').allInnerTexts()).includes('42.5'));
await p.click('#viewer .tabs button:text-is("Second")'); await p.waitForFunction(() => /Other sheet/.test(document.querySelector('#viewer').innerText));
ok('xlsx: sheet tabs work', true);
await open('deck.pptx'); await p.waitForSelector('#viewer .slide');
ok('pptx: slide text', await p.locator('#viewer .slide').count() === 2 && /Launch plan/.test(await p.locator('#viewer .slide').first().innerText()));
await open('bundle.zip'); await p.waitForSelector('#viewer table.grid');
ok('zip: file listing', (await p.locator('#viewer td').allInnerTexts()).includes('src/main.py'));
await p.screenshot({ path: `${SHOTS}/d5-zip.png` });
await open('noext-table');
await p.waitForFunction(() => document.querySelector('#ed').value.startsWith('plain text'));
ok('extension-less text opens in the editor', true);
ok('icons: table / code / json / slides / archive', await p.evaluate(() => ['data.csv', 'script.py', 'config.json', 'deck.pptx', 'bundle.zip'].every(n => !!([...document.querySelectorAll('.row .name')].find(x => x.textContent === n)?.previousElementSibling))));
// ---- header stays centred for every kind of file, in every layout ----
const off = () => p.evaluate(() => { const r = document.querySelector('.tb-c').getBoundingClientRect(), m = document.querySelector('#main').getBoundingClientRect(); return Math.abs(r.left + r.width / 2 - (m.left + m.width / 2)); });
const bad = [];
for (const n of ['data.csv', 'config.json', 'script.py', 'page.html', 'Guide', 'report.docx', 'budget.xlsx', 'deck.pptx', 'bundle.zip', 'noext-table']) { await open(n); await p.waitForTimeout(150); if (await off() > 1.5) bad.push(n); }
await p.fill('#title', 'A really very long note title that goes on and on and on and on and on forever and ever'); await p.waitForTimeout(100);
if (await off() > 1.5) bad.push('long title');
await p.keyboard.press('Escape');
ok('top bar title is centred for every file type', bad.length === 0, bad.join(','));

// ---- hide / show parts of the UI, collapse the list, focus mode ----
await open('Guide');
await p.click('#btnSettings');
const parts = { search: '.search', actions: '#btnFolder', icons: '.row .fi', status: '#status', stats: '#stats', toolbar: '#toolbar' };
for (const [k, sel] of Object.entries(parts)) {
  await p.click(`.switch[data-part="${k}"]`);
  const vis = await p.evaluate(s => { const e = document.querySelector(s); const c = getComputedStyle(e); return c.display !== 'none' && c.visibility !== 'hidden'; }, sel);
  ok(`can hide: ${k}`, !vis);
  await p.click(`.switch[data-part="${k}"]`);
}
await p.click('.pal[data-id="custom"]'); await p.waitForSelector('.seed input[type=color]');
const before = await p.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--primary').trim());
await p.locator('.seed input[type=color]').first().fill('#d81b60');
ok('custom palette: own colours drive the scheme', await p.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--primary').trim()) !== before);
await p.click('.chip:text-is("Wide")'); await p.click('.chip:text-is("Extra round")'); await p.click('.chip:text-is("Compact")');
ok('width, corners and density are variables', await p.evaluate(() => { const c = getComputedStyle(document.documentElement); return c.getPropertyValue('--content-w').trim() === '960px' && +c.getPropertyValue('--shape') > 1 && c.getPropertyValue('--row-h').trim() === '40px'; }));
await p.click('.pal[data-id="teal"]'); await p.click('.chip:text-is("Comfortable") >> nth=1'); await p.click('.chip:text-is("Rounded")'); await p.click('dialog button:has-text("Close")');
await p.click('#btnMenu');
ok('desktop: notes list can be collapsed', await p.locator('#side').isHidden());
ok('title still centred with the list collapsed', await off() < 1.5);
await p.click('#btnMenu');
ok('…and brought back', await p.locator('#side').isVisible());
await p.click('#btnMore'); await p.click('#menu button:has-text("Focus mode")');
ok('focus mode hides list and toolbar', await p.locator('#side').isHidden() && await p.locator('#toolbar').isHidden());
await p.keyboard.press('Escape');
ok('Esc leaves focus mode', await p.locator('#side').isVisible());
ok('no console errors', errors.length === 0, errors.join(' | '));
await browser.close(); server.close();
console.log(fails ? `\n${fails} FAILED` : '\nall passed'); process.exit(fails ? 1 : 0);
