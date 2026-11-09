// GSB Field Ops service worker — keeps the app usable with no signal.
const CACHE_NAME = 'gsb-field-ops-v3';
const SHELL_FILES = ['./', './index.html', './manifest.json', './icon-192x192.png', './icon-512x512.png'];
// The Firebase libraries are what the app needs to start; save them so it can open without signal.
const FIREBASE_LIBS = [
  'https://www.gstatic.com/firebasejs/12.16.0/firebase-app-compat.js',
  'https://www.gstatic.com/firebasejs/12.16.0/firebase-auth-compat.js',
  'https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore-compat.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await Promise.all([
      ...SHELL_FILES.map((u) => cache.add(u).catch(() => {})),
      ...FIREBASE_LIBS.map((u) => fetch(new Request(u, { mode: 'no-cors' })).then((res) => cache.put(u, res)).catch(() => {})),
    ]);
  })());
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
  );
  self.clients.claim();
});

function saveCopy(req, res) {
  try {
    if (res && (res.ok || res.type === 'opaque')) {
      const copy = res.clone();
      caches.open(CACHE_NAME).then((c) => c.put(req, copy)).catch(() => {});
    }
  } catch (e) {}
}

// Our own files: newest copy when there is signal; if the network is down or very slow, the saved copy.
function networkFirst(req) {
  return new Promise((resolve) => {
    let done = false;
    const url = new URL(req.url);
    const keep = !url.searchParams.has('vcheck');
    const saved = () => caches.match(req, { ignoreSearch: true }).then((c) => c || (req.mode === 'navigate' ? caches.match('./index.html') : undefined));
    const timer = setTimeout(() => {
      saved().then((c) => { if (c && !done) { done = true; resolve(c); } });
    }, 4500);
    fetch(req, { cache: 'no-store' })
      .then((res) => {
        clearTimeout(timer);
        if (keep) saveCopy(req, res);
        if (!done) { done = true; resolve(res); }
      })
      .catch(() => {
        clearTimeout(timer);
        if (done) return;
        saved().then((c) => { done = true; resolve(c || Response.error()); });
      });
  });
}

// Versioned libraries never change: use the saved copy first (also makes the app start faster).
function cacheFirst(req) {
  return caches.match(req).then((c) => c || fetch(req).then((res) => { saveCopy(req, res); return res; }));
}

// Fonts: show the saved copy instantly, refresh it quietly in the background.
function staleWhileRevalidate(req) {
  return caches.match(req).then((c) => {
    const net = fetch(req).then((res) => { saveCopy(req, res); return res; }).catch(() => c);
    return c || net;
  });
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin === self.location.origin) { event.respondWith(networkFirst(req)); return; }
  if (url.hostname === 'www.gstatic.com' && url.pathname.startsWith('/firebasejs/')) { event.respondWith(cacheFirst(req)); return; }
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') { event.respondWith(staleWhileRevalidate(req)); return; }
  // Everything else (Firestore, sign-in, email) goes straight to the network, untouched.
});
