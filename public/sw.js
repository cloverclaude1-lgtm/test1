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
// Instead: cache-first with runtime population for hashed/immutable assets —
// whatever gets fetched gets cached as it's requested, so by the time the
// very first page load finishes, the whole app shell is cached for next
// time. Bump CACHE_NAME when this file changes meaningfully so old entries
// get cleared out on the next activate.
//
// Navigations and index.html are the one exception: they're NOT
// content-hashed, so a stale cached index.html can end up pointing at a
// hashed bundle filename from an OLD build while the actual server has since
// moved on to a new one — a returning visitor would then load a real page
// shell fetching a JS chunk that either doesn't exist anymore or is stale,
// which reads as "half the app doesn't work" with no obvious cause. Those
// specifically go network-first (falling back to cache only when offline)
// so an online visit always gets an index.html that matches what's actually
// on the server right now.
// ---------------------------------------------------------------------------

const CACHE_NAME = 'lightstage-v2';

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

  // Page navigations: network-first. Falls back to the cached shell only when the
  // network is actually unavailable (offline) — an online visit always gets the
  // index.html that matches what's on the server right now, so it never ends up
  // pointing at a stale/mismatched hashed bundle filename from an older build.
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res && res.status === 200) {
            const copy = res.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
          }
          return res;
        })
        .catch(() => caches.match(req).then((cached) => cached || caches.match('./index.html'))),
    );
    return;
  }

  // Everything else (hashed JS/CSS bundles, manifest, icon, demo song): cache-first
  // with background revalidation. Safe to be this aggressive here because Vite's
  // bundle filenames are content-hashed — once a given URL is cached, its content
  // can never change out from under it.
  event.respondWith(
    caches.match(req).then((cached) => {
      const networkFetch = fetch(req)
        .then((res) => {
          if (res && res.status === 200) {
            const copy = res.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
          }
          return res;
        })
        .catch(() => null);

      return cached || networkFetch;
    }),
  );
});
