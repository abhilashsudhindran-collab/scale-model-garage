// Service worker: app opens offline. App files: network first (updates arrive), cache fallback.
// Big library files: cache first. Google sign-in/API traffic is never touched (cross-origin passes through).
// Cache names start with "smg-" (the R0 test kit on the same site uses "sgr0-").
const CACHE = 'smg-s1-0.27.0';
const SHELL = ['./', './index.html', './manifest.webmanifest', './css/app.css', './icons/icon-192.png', './icons/icon-512.png', './icons/icon.svg', './icons/favicon-32.png', './icons/apple-touch-icon.png',
  './js/app.js', './js/store.js', './js/idb.js', './js/ids.js', './js/rules.js', './js/schema.js', './js/google.js',
  './js/setup.js', './js/sync.js', './js/images.js', './js/barcode.js', './js/md5.js', './js/timing.js', './js/backup.js', './js/ai.js', './js/crop.js', './js/export.js', './js/brands.js', './js/colours.js'];
const BIG = ['/vendor/'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL.map(u => new Request(u, { cache: 'reload' })))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith('smg-') && k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;
  if (!url.pathname.startsWith(new URL('./', self.location).pathname)) return; // only this app's files
  if (BIG.some(p => url.pathname.includes(p))) {
    e.respondWith(caches.match(req).then(hit => hit || fetch(req).then(res => { if (res.ok) { const c = res.clone(); caches.open(CACHE).then(x => x.put(req, c)); } return res; })));
    return;
  }
  e.respondWith(fetch(req).then(res => {
    if (res.ok) { const c = res.clone(); caches.open(CACHE).then(x => x.put(req, c)); }
    return res;
  }).catch(() => caches.match(req, { ignoreSearch: true }).then(r => r || (req.mode === 'navigate' ? caches.match('./index.html') : undefined))));
});
