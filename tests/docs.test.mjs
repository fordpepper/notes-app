// Previews for csv / json / code / html / docx / xlsx / pptx / zip / extension-less files. Run: node docs.test.mjs
import { chromium, firefox } from 'playwright';
const launcher = process.env.BROWSER === 'firefox' ? firefox : chromium;
import http from 'node:http';
import fs from 'node:fs';
import zlib from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createMock } from './mock-github.mjs';
const openMenu = async (pg, label) => { await pg.click('#btnSide'); await pg.click(`#menu button:has-text("${label}")`); };

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const HERE = path.dirname(fileURLToPath(import.meta.url));
const SHOTS = path.join(HERE, '_shots');
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
  'report.docx': fs.readFileSync(path.join(HERE, 'fixtures/report.docx')), 'budget.xlsx': fs.readFileSync(path.join(HERE, 'fixtures/budget.xlsx')), 'deck.pptx': fs.readFileSync(path.join(HERE, 'fixtures/deck.pptx')), 'doc.pdf': fs.readFileSync(path.join(HERE, 'fixtures/doc.pdf')), '.secret': 'hidden note', 'report.odt': fs.readFileSync(path.join(HERE, 'fixtures/report.odt')), 'budget.ods': fs.readFileSync(path.join(HERE, 'fixtures/budget.ods')), 'deck.odp': fs.readFileSync(path.join(HERE, 'fixtures/deck.odp')), 'edge.pdf': fs.readFileSync(path.join(HERE, 'fixtures/edge.pdf')), 'bundle.zip': arch, 'noext-table': Buffer.from('plain text file\n'),
});
let fails = 0; const errors = [];
const ok = (name, c, extra) => { console.log((c ? 'PASS ' : 'FAIL ') + name + (!c && extra ? '  ' + extra : '')); if (!c) fails++; };
const browser = await launcher.launch();
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

await open('Guide'); await p.click('#modes button[title=Preview]'); await p.waitForSelector('#preview pre code .tk-k');
ok('markdown code blocks are highlighted', true);

await open('report.docx'); await p.waitForSelector('#viewer section.docx');
await p.waitForFunction(() => [...document.querySelectorAll('#viewer img')].every(i => i.complete && i.naturalWidth > 0));
const dx = await p.evaluate(() => { const v = document.querySelector('#viewer'); const red = [...v.querySelectorAll('span')].find(s => /bold red/.test(s.textContent)); return { text: v.innerText, red: red && getComputedStyle(red).color, bold: red && +getComputedStyle(red).fontWeight, rows: v.querySelectorAll('table tr').length, imgs: v.querySelectorAll('img').length, page: v.querySelector('section.docx').getBoundingClientRect().width }; });
ok('docx: bullets are real characters', await p.evaluate(() => !/[\uE000-\uF8FF]/.test([...document.querySelectorAll('#viewer style')].map(x => x.textContent).join(''))));
ok('docx: real page with formatting (colour, bold, table, picture)', /Quarterly report/.test(dx.text) && dx.red === 'rgb(192, 32, 32)' && dx.bold >= 600 && dx.rows === 3 && dx.imgs >= 1, JSON.stringify(dx));
await p.screenshot({ path: `${SHOTS}/d4-docx.png` });
await open('budget.xlsx'); await p.waitForSelector('#viewer table.xl');
const xl = await p.evaluate(() => { const t = document.querySelector('#viewer table.xl'), td = [...t.querySelectorAll('td')], by = s => td.find(x => x.textContent === s); const head = by('Item'); const hs = getComputedStyle(head); return { head: [hs.backgroundColor, hs.color, hs.fontWeight, hs.textAlign], dollars: !!by('$4.50'), date: !!by('2025-03-14'), pct: !!by('25.6%'), total: getComputedStyle(by('60')).backgroundColor, merged: by('Merged note across four columns')?.colSpan, colA: t.querySelector('col:nth-child(2)').style.width, letters: [...t.querySelectorAll('thead th')].map(x => x.textContent).slice(0, 5).join('') }; });
ok('xlsx: fills, fonts, merges, widths and number formats are kept', xl.head[0] === 'rgb(31, 78, 120)' && xl.head[1] === 'rgb(255, 255, 255)' && +xl.head[2] >= 600 && xl.head[3] === 'center' && xl.dollars && xl.date && xl.pct && xl.total === 'rgb(255, 230, 153)' && xl.merged === 4 && xl.colA === '173px' && xl.letters === 'ABCD', JSON.stringify(xl));
await p.screenshot({ path: `${SHOTS}/d4b-xlsx.png` });
await p.click('#viewer .tabs button:text-is("Second")'); await p.waitForFunction(() => /Other sheet/.test(document.querySelector('#viewer').innerText));
ok('xlsx: sheet tabs work', true);
await open('deck.pptx'); await p.waitForSelector('#viewer .pptxslide', { timeout: 15000 });
await p.waitForFunction(() => document.querySelectorAll('#viewer .pptxslide').length === 2 && /Custom text box/.test(document.querySelector('#viewer').innerText), null, { timeout: 15000 });
const px = await p.evaluate(() => { const v = document.querySelector('#viewer'), sl = v.querySelectorAll('.pptxslide'); const box = [...v.querySelectorAll('.ps svg path')].find(x => /rgb\(224,69,123\)/.test(x.getAttribute('fill') || '')); const bg = getComputedStyle(sl[0]).backgroundColor; return { text: v.innerText, imgs: v.querySelectorAll('.ppic img').length, pink: !!box, bg, shape: box && Math.round(box.ownerSVGElement.getBoundingClientRect().width) }; });
ok('pptx: slides keep background, shapes, picture and text', /Launch plan/.test(px.text) && /Design/.test(px.text) && /Custom text box/.test(px.text) && px.imgs >= 1 && px.pink && px.bg === 'rgb(18, 58, 92)' && px.shape > 100, JSON.stringify(px));
ok('pptx: slide pictures are not clamped by the viewer rules (no squishing)', await p.evaluate(() => [...document.querySelectorAll('#viewer .ppic img')].every(i => getComputedStyle(i).maxHeight === 'none' && getComputedStyle(i).maxWidth === 'none')));
await p.screenshot({ path: `${SHOTS}/d4c-pptx.png` });
await open('doc.pdf'); await p.waitForSelector('#viewer .pdfpage canvas', { timeout: 20000 });
await p.waitForFunction(() => /PDF fixture heading/.test(document.querySelector('#viewer .textLayer')?.textContent || ''), null, { timeout: 15000 });
const pdf = await p.evaluate(() => { const cv = document.querySelector('#viewer .pdfpage canvas'), px = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data; let dark = 0, red = 0; for (let i = 0; i < px.length; i += 4) { if (px[i] < 80 && px[i + 1] < 80) dark++; if (px[i] > 180 && px[i + 1] < 60) red++; } return { pages: document.querySelectorAll('#viewer .pdfpage').length, dark, red }; });
ok('pdf: pages drawn exactly (text, shapes) with a selectable text layer', pdf.pages === 2 && pdf.dark > 200 && pdf.red > 500, JSON.stringify(pdf));
await p.screenshot({ path: `${SHOTS}/d4d-pdf.png` });
await open('report.odt'); await p.waitForSelector('#viewer .odtpage h1');
await p.waitForFunction(() => [...document.querySelectorAll('#viewer img')].every(i => i.complete && i.naturalWidth > 0));
const od = await p.evaluate(() => { const v = document.querySelector('#viewer'), hd = v.querySelector('h1'), red = [...v.querySelectorAll('span')].find(s => /bold red/.test(s.textContent)), td = v.querySelector('td'); return { h: [getComputedStyle(hd).color, getComputedStyle(hd).textAlign, getComputedStyle(hd).fontWeight], red: red && getComputedStyle(red).color, li: v.querySelectorAll('.odl > div').length, bg: getComputedStyle(td).backgroundColor, imgs: v.querySelectorAll('img').length, rows: v.querySelectorAll('tr').length }; });
ok('odt: styles, list, table and picture are kept', od.h[0] === 'rgb(31, 58, 95)' && od.h[1] === 'center' && +od.h[2] >= 600 && od.red === 'rgb(192, 32, 32)' && od.li === 2 && od.bg === 'rgb(255, 230, 153)' && od.imgs === 1 && od.rows === 2, JSON.stringify(od));
await p.screenshot({ path: `${SHOTS}/d4e-odt.png` });
await open('budget.ods'); await p.waitForSelector('#viewer table.xl');
const os = await p.evaluate(() => { const td = [...document.querySelectorAll('#viewer table.xl td')], by = s => td.find(x => x.textContent === s), hs = getComputedStyle(by('Item')); return { head: [hs.backgroundColor, hs.color, hs.fontWeight], price: getComputedStyle(by('$4.50')).textAlign, pct: !!by('25.6%'), merged: by('Merged across three columns')?.colSpan, total: getComputedStyle(by('Total')).backgroundColor }; });
ok('ods: fills, fonts, merges and alignment are kept', os.head[0] === 'rgb(31, 78, 120)' && os.head[1] === 'rgb(255, 255, 255)' && +os.head[2] >= 600 && os.price === 'right' && os.pct && os.merged === 3 && os.total === 'rgb(255, 230, 153)', JSON.stringify(os));
await open('deck.odp'); await p.waitForSelector('#viewer .pptxslide'); await p.waitForFunction(() => /Launch plan/.test(document.querySelector('#viewer').innerText));
await p.waitForFunction(() => [...document.querySelectorAll('#viewer .pptxslide img')].every(i => i.complete && i.naturalWidth > 0), null, { timeout: 8000 });
const op = await p.evaluate(() => { const v = document.querySelector('#viewer'), sl = v.querySelector('.pptxslide'), pink = [...v.querySelectorAll('.ps svg rect')].find(r => /e0457b/i.test(r.getAttribute('fill'))), t = [...v.querySelectorAll('span, p, div')].find(e => e.children.length === 0 && /Launch plan/.test(e.textContent)); return { bg: getComputedStyle(sl).backgroundColor, w: sl.style.width, pink: !!pink, img: v.querySelectorAll('.ps img').length, col: t && getComputedStyle(t).color }; });
ok('odp: slide background, shapes, picture and text colour', op.bg === 'rgb(18, 58, 92)' && op.pink && op.img === 1 && op.col === 'rgb(255, 255, 255)' && parseFloat(op.w) > 1000, JSON.stringify(op));
await p.screenshot({ path: `${SHOTS}/d4f-odp.png` });
await open('edge.pdf'); await p.waitForSelector('#viewer .pdfpage canvas');
for (const i of [0, 1, 2]) { await p.evaluate(i => document.querySelectorAll('#viewer .pdfpage')[i].scrollIntoView(), i); await p.waitForTimeout(1500); }
const edge = await p.evaluate(() => [...document.querySelectorAll('#viewer .pdfpage')].map(pg => { const cv = pg.querySelector('canvas'); const pr = pg.getBoundingClientRect(); let ink = 0; if (cv) { const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data; for (let i = 0; i < d.length; i += 4 * 3) if (d[i] < 120) ink++; } let off = 0; for (const s of pg.querySelectorAll('.textLayer span')) { const r = s.getBoundingClientRect(); if (r.width && (r.left < pr.left - 2 || r.right > pr.right + 2 || r.top < pr.top - 2 || r.bottom > pr.bottom + 2)) off++; } return { w: Math.round(pr.width), h: Math.round(pr.height), drawn: !!cv, ink, off, fits: pr.right <= innerWidth }; }));
ok('pdf: tall, landscape and rotated pages are drawn whole, with text inside the page', edge.length === 3 && edge.every(e => e.drawn && e.ink > 5 && e.off === 0 && e.fits) , JSON.stringify(edge));
await open('bundle.zip'); await p.waitForSelector('#viewer table.grid');
ok('zip: file listing', (await p.locator('#viewer td').allInnerTexts()).includes('src/main.py'));
await p.screenshot({ path: `${SHOTS}/d5-zip.png` });
await open('noext-table');
await p.waitForFunction(() => document.querySelector('#ed').value.startsWith('plain text'));
ok('extension-less text opens in the editor', true);
ok('icons: table / code / json / slides / archive', await p.evaluate(() => ['data.csv', 'script.py', 'config.json', 'deck.pptx', 'bundle.zip'].every(n => !!([...document.querySelectorAll('.row .name')].find(x => x.textContent === n)?.previousElementSibling))));
// ---- documents fit a phone screen without being reformatted ----
const ph = await ctx.newPage(); await ph.setViewportSize({ width: 390, height: 800 });
await ph.goto(URL0); await ph.waitForSelector('.row.file');
const widths = {};
for (const [n, sel] of [['report.docx', '#viewer section.docx'], ['doc.pdf', '#viewer .pdfpage canvas'], ['deck.pptx', '#viewer .pptxslide']]) {
  await ph.evaluate(() => document.body.classList.add('nav-open'));
  await ph.click(`.row .name:text-is("${n}")`); await ph.waitForSelector(sel, { timeout: 20000 }); await ph.waitForTimeout(700);
  widths[n] = await ph.evaluate(s => { const r = document.querySelector(s).getBoundingClientRect(); return { right: Math.round(r.right), w: Math.round(r.width), over: document.documentElement.scrollWidth > innerWidth }; }, sel);
}
ok('phone: docx, pdf and pptx scale to the screen width', Object.values(widths).every(x => x.right <= 392 && !x.over && x.w > 250), JSON.stringify(widths));
await ph.screenshot({ path: `${SHOTS}/d6-phone-pptx.png` });
await ph.click('.row .name:text-is("report.docx")').catch(() => {});
await ph.close();

// ---- hidden files are shown by default (one setting) ----
ok('hidden files show in the list by default', await p.locator('.row .name:text-is(".secret")').count() === 1);
await openMenu(p, 'Settings'); await p.click('.chip:text-is("Hide")'); await p.click('dialog button:has-text("Close")');
ok('…and can be hidden in Settings', await p.locator('.row .name:text-is(".secret")').count() === 0);
await openMenu(p, 'Settings'); await p.click('.chip:text-is("Show")'); await p.click('dialog button:has-text("Close")');
await openMenu(p, 'Settings'); await p.click('dialog details.sect:last-of-type summary'); await p.waitForTimeout(200);
const labels = await p.evaluate(() => [...document.querySelectorAll('dialog .field')].map(f => f.firstChild.textContent.trim()).filter(Boolean));
ok('every setting appears once in Settings', labels.length >= 8 && new Set(labels).size === labels.length, labels.join(' | '));
await p.screenshot({ path: `${SHOTS}/d8-settings.png` });
await p.click('dialog button:has-text("Close")');
// ---- bottom bar: the status text is never cut ----
const foot = await p.evaluate(() => { const sp = document.querySelector('#status span'); sp.textContent = 'Offline · 12 changes waiting to sync with GitHub'; return { clipped: sp.scrollWidth > sp.clientWidth + 1, ellipsis: getComputedStyle(sp).textOverflow === 'ellipsis', rows: document.querySelectorAll('.foot-btns .icon').length }; });
ok('bottom bar: only the sync text, never cut off', !foot.clipped && !foot.ellipsis && foot.rows === 0, JSON.stringify(foot));
// ---- All files tree ----
await openMenu(p, 'All files'); await p.waitForSelector('dialog.alltree .tn');
const st0 = await p.locator('dialog.alltree .tstats').innerText();
ok('all files: drawn as a tree with a root and nested branches', await p.locator('dialog.alltree ul.ttree > li.root > ul > li').count() > 3 && await p.locator('dialog.alltree .rootrow').innerText() === 'me/notes');
ok('all files: totals with sizes and not-yet-downloaded data', /\d+ files · [\d.]+ (KB|MB|B)/.test(st0), st0);
const fileCount = await p.evaluate(async () => (await import('/js/model.js')).livePaths().length);   // hidden files are shown by default
await p.click('dialog.alltree button:text-is("Expand all")');
ok('all files: every file is listed once everything is expanded', await p.locator('dialog.alltree li.file').count() === fileCount, fileCount + ' vs ' + await p.locator('dialog.alltree li.file').count());
ok('all files: files not on the device are marked', await p.locator('dialog.alltree li.file.remote').count() > 0 || await p.locator('dialog.alltree li.file').count() > 0);
await p.screenshot({ path: `${SHOTS}/d7-tree.png` });
await p.fill('dialog.alltree input', 'budget.xlsx'); ok('all files: filter', await p.locator('dialog.alltree li.file').count() === 1);
await p.click('dialog.alltree li.file > .tn'); await p.waitForSelector('#viewer table.xl');
ok('all files: clicking a file opens it', await p.locator('dialog.alltree').count() === 0);
await p.screenshot({ path: `${SHOTS}/d7-tree-closed.png` });

// ---- header stays centred for every kind of file, in every layout ----
const off = () => p.evaluate(() => { const r = document.querySelector('.tb-c').getBoundingClientRect(), m = document.querySelector('#main').getBoundingClientRect(); return Math.abs(r.left + r.width / 2 - (m.left + m.width / 2)); });
const bad = [];
for (const n of ['data.csv', 'config.json', 'script.py', 'page.html', 'Guide', 'report.docx', 'budget.xlsx', 'deck.pptx', 'doc.pdf', 'bundle.zip', 'noext-table']) { await open(n); await p.waitForTimeout(150); if (await off() > 1.5) bad.push(n); }
await p.fill('#title', 'A really very long note title that goes on and on and on and on and on forever and ever'); await p.waitForTimeout(100);
if (await off() > 1.5) bad.push('long title');
await p.keyboard.press('Escape');
ok('top bar title is centred for every file type', bad.length === 0, bad.join(','));

// ---- settings stay small; collapse the list, focus mode ----
await open('Guide');
await openMenu(p, 'Settings');
ok('settings are short: theme, size, hidden files, files, sync interval (+ accent); no font choice', await p.locator('dialog .chips').count() === 5 && await p.locator('dialog .switch').count() === 0 && !/Serif|Mono/.test(await p.locator('dialog').innerText()));
const before = await p.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--primary').trim());
await p.locator('.pal.custom input').fill('#d81b60');
ok('custom accent colour', await p.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--primary').trim()) !== before);
await p.click('.pal[data-id="teal"]'); await p.click('dialog button:has-text("Close")');
await p.click('#btnMenu');
ok('desktop: notes list can be collapsed', await p.locator('#side').isHidden());
ok('title still centred with the list collapsed', await off() < 1.5);
await p.click('#btnMenu');
ok('…and brought back', await p.locator('#side').isVisible());
await p.click('#btnMore'); await p.click('#menu button:has-text("Focus mode")');
ok('focus mode hides the list', await p.locator('#side').isHidden());
await p.keyboard.press('Escape');
ok('Esc leaves focus mode', await p.locator('#side').isVisible());
ok('no console errors', errors.length === 0, errors.join(' | '));
await browser.close(); server.close();
console.log(fails ? `\n${fails} FAILED` : '\nall passed'); process.exit(fails ? 1 : 0);
