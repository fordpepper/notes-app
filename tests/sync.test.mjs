// Sync engine + model tests against an in-memory GitHub. Run: node sync.test.mjs
import 'fake-indexeddb/auto';
import { createMock } from './mock-github.mjs';

const mem = {};
globalThis.localStorage = { getItem: k => mem[k] ?? null, setItem: (k, v) => { mem[k] = String(v); }, removeItem: k => { delete mem[k]; }, key: i => Object.keys(mem)[i], get length() { return Object.keys(mem).length; } };
Object.defineProperty(localStorage, Symbol.iterator, { value: undefined });
Object.keys = new Proxy(Object.keys, { apply: (t, th, [o]) => o === localStorage ? Object.keys(mem) : Reflect.apply(t, th, [o]) });
Object.defineProperty(globalThis, 'navigator', { value: { onLine: true }, configurable: true });

const gh = createMock();
globalThis.fetch = async (url, o = {}) => {
  const u = new URL(url), headers = Object.fromEntries(Object.entries(o.headers || {}).map(([k, v]) => [k.toLowerCase(), v]));
  const res = gh.handle(o.method || 'GET', u.pathname, headers, o.body ? JSON.parse(o.body) : null);
  gh.log.push(`${o.method || 'GET'} ${u.pathname.replace('/repos/me/notes', '')} -> ${res.status}`);
  const buf = res.raw ? res.raw.buffer.slice(res.raw.byteOffset, res.raw.byteOffset + res.raw.length) : null;
  return {
    ok: res.status >= 200 && res.status < 300, status: res.status, statusText: String(res.json?.message || ''),
    headers: { get: k => res.headers?.[k.toLowerCase()] ?? null },
    json: async () => res.json, arrayBuffer: async () => buf,
  };
};

const M = await import('../js/model.js');
const S = await import('../js/sync.js');
const U = await import('../js/util.js');
let fails = 0;
const t = (name, c) => { console.log((c ? 'PASS ' : 'FAIL ') + name); if (!c) fails++; };

gh.seed({ 'README.md': 'hello', 'a/one.txt': 'one', 'pic.png': Buffer.from([1, 2, 3, 255]), '.obsidian/app.json': '{"x":1}', 'data.json': '{"big":true}', 'keep/.gitkeep': '' });
S.setCfg({ token: 't', owner: 'me', repo: 'notes', branch: '', root: '' });
const info = await S.testConnection(S.getCfg()); t('connection test', info.branch === 'main' && info.private === true);

// ---- first pull
await S.sync();
t('notes downloaded eagerly', M.files.get('a/one.txt')?.content === 'one' && M.files.get('README.md').content === 'hello');
t('binary is lazy', M.files.get('pic.png').content === null);
t('hidden files are lazy', M.files.get('.obsidian/app.json').content === null);
t('non-note text is lazy', M.files.get('data.json').content === null);
t('empty .gitkeep needs no download', M.files.get('keep/.gitkeep').content != null);
t('clean after pull', M.pendingCount() === 0);
t('lazy file fetched on demand', (await M.ensureContent('data.json')).content === '{"big":true}');
t('lazy binary fetched on demand', (await (await M.getBlob('pic.png')).arrayBuffer()).byteLength === 4);

// ---- request budget
gh.resetLog(); await S.sync();
t('idle sync = ONE request, answered 304', gh.log.length === 1 && /304/.test(gh.log[0]));

await M.saveText('a/one.txt', 'one edited'); gh.resetLog(); await S.sync();
t('local-only push skips the tree listing', gh.count(/GET \/git\/(trees|commits)/) === 0 && gh.text('a/one.txt') === 'one edited');
t('local-only push request count (ref, blob, tree, commit, ref update)', gh.log.length === 5);
t('commit message names the file', gh.message() === 'Update one.txt');
gh.resetLog(); await S.sync(); t('idle again after our own push: 1 request, no listing', gh.log.length === 1 && gh.count(/GET \/git\/trees/) === 0);

gh.set('remote-new.txt', 'from phone'); gh.resetLog(); await S.sync();
t('remote change: pulled', M.files.get('remote-new.txt')?.content === 'from phone');
t('remote change: ref + commit + tree + 1 blob only', gh.log.length === 4);
t('remote change was not re-downloaded for unchanged files', gh.count(/GET \/git\/blobs/) === 1);

// ---- edits, moves, deletes in one commit
await M.create('b/new.txt', 'brand new ünïcode ✓'); await M.makeDir('empty'); await M.move('README.md', 'docs/README.md');
const before = gh.head; await S.sync();
t('pushed new utf8', gh.text('b/new.txt') === 'brand new ünïcode ✓');
t('pushed .gitkeep for empty folder', gh.has('empty/.gitkeep'));
t('moved file', !gh.has('README.md') && gh.text('docs/README.md') === 'hello');
t('single commit for many changes', gh.commits.get(gh.head).parent === before);
t('clean after push', M.pendingCount() === 0);
await M.move('pic.png', 'media/pic.png'); await S.sync();
t('moving a never-downloaded binary works (reuses its blob)', gh.has('media/pic.png') && !gh.has('pic.png'));

// ---- remote deletes / conflicts
gh.del('remote-new.txt'); await S.sync(); t('remote delete applied locally', !M.exists('remote-new.txt'));
await M.saveText('b/new.txt', 'LOCAL'); gh.set('b/new.txt', 'REMOTE'); await S.sync();
t('conflict: remote wins at path', M.files.get('b/new.txt').content === 'REMOTE');
const copy = [...M.files.keys()].find(k => k.includes('conflict'));
t('conflict: local version kept + pushed as a copy', copy && M.files.get(copy).content === 'LOCAL' && gh.text(copy) === 'LOCAL');

// ---- delete + undo
const snap = [{ ...M.files.get('a/one.txt') }];
await M.remove('a/one.txt'); t('deleted locally', !M.exists('a/one.txt'));
await M.restore(snap); t('undo restores it', M.exists('a/one.txt') && M.files.get('a/one.txt').content === 'one edited');
t('undo before sync leaves nothing to push', M.pendingCount() === 0);
await M.remove('a/one.txt'); await S.sync(); t('delete pushed', !gh.has('a/one.txt'));
await M.restore(snap); await S.sync(); t('undo AFTER the delete was pushed re-creates it', gh.text('a/one.txt') === 'one edited');

// ---- pins
await M.setPins(['b/new.txt']); await S.sync(); t('pins synced', gh.text('.notes-app.json').includes('b/new.txt'));
await M.moveDir('b', 'z'); t('pins follow moves', M.getPins()[0] === 'z/new.txt');
await S.sync(); t('dir moved remotely', gh.has('z/new.txt') && ![...gh.tree().keys()].some(k => k.startsWith('b/')));
await M.removeDir('z'); t('pins pruned on delete', M.getPins().length === 0); await S.sync();

// ---- race: branch moves between our reads and our push
await M.create('race.txt', 'r');
const orig = globalThis.fetch; let raced = false;
globalThis.fetch = async (u, o) => { if (!raced && /git\/blobs$/.test(u) && o?.method === 'POST') { raced = true; gh.set('other.txt', 'x'); } return orig(u, o); };
await S.sync(); globalThis.fetch = orig;
t('push race retried transparently', gh.text('race.txt') === 'r' && gh.text('other.txt') === 'x' && S.status.state === 'idle');

// ---- errors
gh.failNext = { status: 401, message: 'Bad credentials' }; await S.sync({ force: true });
t('401 is reported and marked fatal', S.status.state === 'error' && S.status.fatal && /token/i.test(S.status.msg));
gh.resetLog(); await S.sync(); t('fatal error stops background polling', gh.log.length === 0);
await S.sync({ force: true }); t('manual sync retries and recovers', S.status.state === 'idle' && !S.status.fatal);
gh.failNext = { status: 500, message: 'boom' }; await S.sync({ force: true }); t('transient error not fatal', S.status.state === 'error' && !S.status.fatal);
await S.sync({ force: true });

// ---- offline
const online = globalThis.fetch; globalThis.fetch = async () => { throw new TypeError('Failed to fetch'); };
await M.create('offline.txt', 'x'); await S.sync({ force: true }); t('network failure = offline, edits kept', S.status.state === 'offline' && M.pendingCount() === 1);
globalThis.fetch = online; await S.sync(); t('pending edits pushed once back online', gh.text('offline.txt') === 'x' && M.pendingCount() === 0);

// ---- folder prefix + reset
S.setCfg({ token: 't', owner: 'me', repo: 'notes', branch: '', root: '/vault/' });
await M.wipe(); gh.set('vault/n.txt', 'in vault'); gh.set('outside.txt', 'no');
await S.sync(); t('root prefix: pull only inside the folder', M.files.get('n.txt')?.content === 'in vault' && !M.files.has('outside.txt'));
await M.create('m.txt', 'm'); await S.sync(); t('root prefix: push inside the folder', gh.text('vault/m.txt') === 'm');
S.setCfg(null); t('disconnect clears sync state', Object.keys(mem).every(k => !k.startsWith('sync:')));

console.log(fails ? `\n${fails} FAILED` : '\nall passed'); process.exit(fails ? 1 : 0);
