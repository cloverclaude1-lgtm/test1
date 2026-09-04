// ---------------------------------------------------------------------------
// LightStage service worker — offline mode.
//
// This app has no backend in normal use (audio decode/analysis is Web Audio
// API, the lighting engine and 3D render are pure JS/Three.js, and Save/Open
// Project already go through local Blob downloads and the file picker), so
// the only thing standing between "online" and "offline" is whether the
// browser can fetch the app's own static files. This worker makes sure it
// can, once it's been loaded at least once.
//
// Vite's build output has hashed, per-build filenames for the JS/CSS
// bundles, so there's no fixed list of them to precache ahead of time.
// Instead: cache-first with runtime population — whatever gets fetched
// (including the hashed bundle) gets cached as it's requested, so by the
// time the very first page load finishes, the whole app shell is cached for
// next time. Bump CACHE_NAME when this file changes meaningfully so old
// entries get cleared out on the next activate.
// ---------------------------------------------------------------------------

const CACHE_NAME = 'lightstage-v1';

// A few stable (non-hashed) files worth precaching explicitly on install,
// so the very first offline visit already has something to serve even
// before a prior online visit has populated the rest of the cache.
const PRECACHE_URLS = ['./', './index.html', './manifest.json', './icon.svg', './demo-song.wav'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((names) => Promise.all(names.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  // Only handle same-origin GETs — anything else (POST, cross-origin) passes through untouched.
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;

  event.respondWith(
    caches.match(req).then((cached) => {
      // Always try the network too, so the cache stays fresh across app updates —
      // failures here are expected while offline and are silently ignored.
      const networkFetch = fetch(req)
        .then((res) => {
          if (res && res.status === 200) {
            const copy = res.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
          }
          return res;
        })
        .catch(() => null);

      if (cached) return cached; // stale-while-revalidate: serve cached instantly, refresh in the background

      // Nothing cached yet for this exact request — wait on the network. If that also
      // fails (offline + never seen this URL before) and it's a page navigation, fall
      // back to the cached app shell so reloading while offline still boots the app.
      return networkFetch.then((res) => res || (req.mode === 'navigate' ? caches.match('./index.html') : undefined));
    }),
  );
});
