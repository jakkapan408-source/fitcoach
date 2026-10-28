// FitCoach service worker: offline app shell + cache AI model/library after first download
const VER = 'fitcoach-v1';
const SHELL = ['./', 'index.html', 'app.js', 'data.js', 'anim.js', 'pose.js', 'manifest.webmanifest', 'icons/icon-192.png', 'icons/apple-touch-icon.png'];
self.addEventListener('install', (e) => { e.waitUntil(caches.open(VER).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== VER && k !== 'fitcoach-cdn').map((k) => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  if (u.hostname === 'cdn.jsdelivr.net' || u.hostname === 'storage.googleapis.com') {
    // AI library + model: cache-first (large, versioned)
    e.respondWith(caches.open('fitcoach-cdn').then(async (c) => { const hit = await c.match(e.request); if (hit) return hit; const r = await fetch(e.request); if (r.ok) c.put(e.request, r.clone()); return r; }));
    return;
  }
  if (u.origin === location.origin) {
    // app files: network-first so updates arrive, fallback to cache offline
    e.respondWith(fetch(e.request).then((r) => { if (r.ok) caches.open(VER).then((c) => c.put(e.request, r.clone())); return r; }).catch(() => caches.match(e.request, { ignoreSearch: true }).then((r) => r || caches.match('index.html'))));
  }
});
