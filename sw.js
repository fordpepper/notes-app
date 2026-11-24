// Offline app shell with zero background traffic:
//  - every deploy has its own cache (BUILD is stamped in by the workflow); files are served from it, never re-checked
//  - a new sw.js (= new BUILD) installs in the background, activates immediately, and the page reloads once
//  - vendor/ libraries live in their own long-lived cache so updates don't re-download them
const BUILD = '__BUILD__';
const DEV = BUILD.startsWith('__');          // local development: always try the network first
const APP = `notes-app-${BUILD}`, LIB = 'notes-lib-v1', KEEP = new Set([APP, LIB, 'notes-thumbs-v1']);   // thumbnails survive updates
const SHELL = ['./', 'index.html', 'style.css', 'manifest.webmanifest', 'icons/icon.svg', 'icons/icon-192.png',
  'js/app.js', 'js/db.js', 'js/model.js', 'js/sync.js', 'js/util.js', 'js/dom.js', 'js/icons.js', 'js/theme.js',
  'js/dialogs.js', 'js/settings.js', 'js/preview.js', 'js/media.js', 'js/docs.js', 'js/pptx.js', 'js/odf.js', 'js/ics.js', 'js/gcal.js', 'js/feeds.js', 'js/settingsync.js', 'js/vault.js', 'js/calendar.js', 'js/alltree.js', 'js/editor-tools.js'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(APP).then(c => c.addAll(SHELL.map(u => new Request(u, { cache: 'reload' })))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => !KEEP.has(k)).map(k => caches.delete(k)));
    await self.clients.claim();
    // One-time migration: pages running the very first app version can't reload themselves after an update, so do it for them.
    if (keys.includes('notes-v1')) for (const c of await self.clients.matchAll({ type: 'window' })) c.navigate(c.url).catch(() => {});
  })());
});
self.addEventListener('fetch', e => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin) return;
  e.respondWith((async () => {
    const cache = await caches.open(url.pathname.includes('/vendor/') ? LIB : APP);
    const store = res => { if (res.ok) cache.put(req, res.clone()); return res; };
    if (DEV) return fetch(req).then(store).catch(async () => (await cache.match(req, { ignoreSearch: true })) || Response.error());
    return (await cache.match(req, { ignoreSearch: true })) || fetch(req).then(store).catch(() => Response.error());
  })());
});
