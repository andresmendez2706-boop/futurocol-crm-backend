// Service worker de la app instalable (PWA).
// Estrategia "primero la red": siempre se usa la versión más nueva publicada; la copia guardada
// solo se usa si no hay conexión. Los datos del CRM (/api) NUNCA se guardan en el teléfono.
const CACHE = 'futurocol-shell-v1';
const SHELL = ['/', '/index.html', '/css/styles.css', '/js/main.js', '/js/core.js', '/js/ui.js', '/img/logo.png', '/img/favicon.png', '/offline.html'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;
  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      })
      .catch(async () => (await caches.match(req)) || (req.mode === 'navigate' ? caches.match('/offline.html') : Response.error())),
  );
});
