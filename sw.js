// Service worker: uygulama dosyalarını önbelleğe alır, çevrimdışı çalıştırır.
// Uygulama kodunu değiştirdiğinde VERSION'ı artır; telefonlar bir sonraki açılışta yeni sürümü alır.
// İBB ve okul sitesi istekleri önbelleğe alınmaz, doğrudan ağa gider.

const VERSION = 'v1.1.0';
const CACHE = `kampus-${VERSION}`;

const SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/app.css',
  './js/app.js',
  './js/core.js',
  './js/iett.js',
  './js/config.js',
  './js/debug.js',
  './data/shuttle.json',
  './data/km18.json',
  './fonts/barlow-condensed-latin-600-normal.woff2',
  './fonts/barlow-condensed-latin-700-normal.woff2',
  './fonts/barlow-condensed-latin-ext-600-normal.woff2',
  './fonts/barlow-condensed-latin-ext-700-normal.woff2',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png',
  './icons/icon-32.png',
  './icons/favicon.svg',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((c) => c.addAll(SHELL.map((u) => new Request(u, { cache: 'reload' }))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('kampus-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // İBB / okul sitesi: dokunma

  // Veri dosyaları: önbellekten hemen ver, arkada güncelle (program düzeltmeleri sürüm artırmadan da gelsin)
  if (url.pathname.includes('/data/')) {
    event.respondWith(
      caches.open(CACHE).then(async (cache) => {
        const cached = await cache.match(req, { ignoreSearch: true });
        const fresh = fetch(req).then((res) => {
          if (res.ok) cache.put(req, res.clone());
          return res;
        }).catch(() => null);
        return cached || (await fresh) || new Response('{}', { status: 503, headers: { 'Content-Type': 'application/json' } });
      }),
    );
    return;
  }

  // Sayfa gezintisi: önbellekteki index.html
  if (req.mode === 'navigate') {
    event.respondWith(
      caches.match('./index.html').then((cached) => cached || fetch(req)),
    );
    return;
  }

  // Diğer uygulama dosyaları: önce önbellek
  event.respondWith(
    caches.match(req, { ignoreSearch: true }).then((cached) => cached || fetch(req).then((res) => {
      if (res.ok && res.type === 'basic') {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy));
      }
      return res;
    })),
  );
});
