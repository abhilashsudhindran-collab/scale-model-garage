// Service worker: app opens offline. App files: network first (updates arrive), cache fallback.
// Big library files: cache first. Google sign-in/API traffic is never touched (cross-origin passes through).
// Cache names start with "smg-" (the R0 test kit on the same site uses "sgr0-").
const CACHE = 'smg-s1-0.49.0';
const SHELL = ['./', './index.html', './manifest.webmanifest', './css/app.css', './icons/icon-192.png', './icons/icon-512.png', './icons/icon.svg', './icons/favicon-32.png', './icons/apple-touch-icon.png',
  './js/app.js', './js/store.js', './js/idb.js', './js/ids.js', './js/rules.js', './js/schema.js', './js/google.js',
  './js/setup.js', './js/sync.js', './js/images.js', './js/barcode.js', './js/md5.js', './js/timing.js', './js/backup.js', './js/ai.js', './js/audit.js', './js/insights.js', './js/wishlist.js', './js/health.js', './js/sort.js', './js/review.js', './js/lines.js', './js/money.js', './js/share.js', './js/crop.js', './js/export.js', './js/brands.js', './js/colours.js', './js/qr.js', './js/moments.js', './vendor/qrcode/qrcode.mjs'];
const BIG = ['/vendor/'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL.map(u => new Request(u, { cache: 'reload' })))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith('smg-') && k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
// Share into the app (s1-0.49.0, D16): photos/text shared from WhatsApp or the gallery arrive here as a POST.
// They are kept on this phone only (cache 'smg-share'), then the app opens #/share to use them.
const SHARE = 'smg-share';
const SHARED = (k) => new URL('shared/' + k, self.registration.scope).href; // not app files: kept out of the offline list
async function receiveShare(req) {
  try {
    const form = await req.formData();
    const c = await caches.open(SHARE);
    for (const k of await c.keys()) await c.delete(k);
    const files = form.getAll('photos').filter(f => f && typeof f === 'object' && f.size);
    let i = 0;
    for (const f of files.slice(0, 20)) await c.put(SHARED(i++), new Response(f, { headers: { 'Content-Type': f.type || 'image/jpeg', 'X-Name': encodeURIComponent(f.name || `photo-${i}.jpg`), 'X-Modified': String(f.lastModified || Date.now()) } }));
    const meta = { n: i, title: String(form.get('title') || ''), text: String(form.get('text') || ''), url: String(form.get('url') || ''), at: Date.now() };
    await c.put(SHARED('meta'), new Response(JSON.stringify(meta), { headers: { 'Content-Type': 'application/json' } }));
  } catch (err) { /* nothing usable was shared: the app says so */ }
  return Response.redirect(new URL('#/share', self.registration.scope).href, 303);
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method === 'POST' && url.origin === self.location.origin && url.pathname.endsWith('/share-target')) { e.respondWith(receiveShare(req)); return; }
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;
  if (!url.pathname.startsWith(new URL('./', self.location).pathname)) return; // only this app's files
  if (BIG.some(p => url.pathname.includes(p))) {
    e.respondWith(caches.match(req).then(hit => hit || fetch(req).then(res => { if (res.ok) { const c = res.clone(); caches.open(CACHE).then(x => x.put(req, c)); } return res; })));
    return;
  }
  // cache: 'no-cache' = always ask the server (a quick 'not modified' when unchanged), so a new release never mixes
  // new code with a style file the browser kept for up to 10 min (B's phone, 25 Nov: s1-0.36.2 code, old layout).
  e.respondWith(fetch(req, { cache: 'no-cache' }).then(res => {
    if (res.ok) { const c = res.clone(); caches.open(CACHE).then(x => x.put(req, c)); }
    return res;
  }).catch(() => caches.match(req, { ignoreSearch: true }).then(r => r || (req.mode === 'navigate' ? caches.match('./index.html') : undefined))));
});
