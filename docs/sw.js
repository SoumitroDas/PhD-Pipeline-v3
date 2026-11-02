const CACHE = 'phd-command-v3-cache-v14';
const SHELL = ['./', './index.html', './manifest.json'];
const CDN = [
  'https://cdn.tailwindcss.com',
  'https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/hammer.js/2.0.8/hammer.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/css/all.min.css'
];
self.addEventListener('install', e => e.waitUntil((async () => {
  const c = await caches.open(CACHE);
  await c.addAll(SHELL);
  await Promise.allSettled(CDN.map(u => c.add(u)));
  await self.skipWaiting();
})()));
self.addEventListener('activate', e => e.waitUntil((async () => {
  for (const k of await caches.keys()) if (k !== CACHE) await caches.delete(k);
  await self.clients.claim();
})()));
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const u = new URL(req.url);
  if (/google(usercontent)?\.com$/.test(u.hostname) && u.hostname !== 'fonts.googleapis.com' || u.searchParams.has('secret')) return;
  if (req.mode === 'navigate') {
    e.respondWith(fetch(req).then(r => { caches.open(CACHE).then(c => c.put(req, r.clone())); return r; }).catch(() => caches.match('./index.html')));
    return;
  }
  e.respondWith(caches.match(req).then(hit => hit || fetch(req).then(r => {
    if (r.ok || r.type === 'opaque') caches.open(CACHE).then(c => c.put(req, r.clone()));
    return r;
  })));
});
