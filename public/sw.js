// Minimal service worker: makes the app installable and lets it open offline.
// Pages and code = network-first (a new deploy shows up on the next open), saved copy only when offline; API/data requests = network-first too.
// Bump CACHE when the shell files change in a way that must not be served stale.
//
// TEMPLATE: copy into the app's public/sw.js, then:
//   - set CACHE to a name unique to the app (e.g. 'photoshare-v1')
//   - set SHELL to that app's own shell files
//   - add any other same-origin GET paths that must always hit the network (never be cached),
//     such as OAuth redirects, alongside the existing '/api/' bypass below
const CACHE = 'badminton-v6';
const SHELL = ['/', '/js/sim.js', '/js/ai.js', '/js/audio.js', '/js/render.js', '/js/main.js', '/manifest.webmanifest', '/icon-192.png', '/icon-512.png', '/apple-touch-icon.png', '/install.js'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin) return; // photos etc. load from the network as usual

  if (url.pathname.startsWith('/api/')) {
    e.respondWith(
      fetch(req).then((res) => {
        if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
        return res;
      }).catch(() => caches.match(req).then((hit) => hit || Response.error())),
    );
    return;
  }

  // Pages and code: network first, so a new deploy shows up on the very next open. The saved copy is only the offline fallback.
  e.respondWith(
    fetch(req).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
      return res;
    }).catch(() => caches.match(req).then((hit) => hit || caches.match('/'))),
  );
});
