// sw.js — keeps SubSync working offline.
// Network first, so site updates show straight away; the cached copy is used
// only when there's no connection. Bump CACHE when the file list changes.

const CACHE = 'gaia-subsync-v1';

const ASSETS = [
  './',
  './css/subsync.css',
  './js/app.js',
  './js/api.js',
  './js/srtParser.js',
  './js/syncEngine.js',
  './js/translator.js',
  './js/store.js',
  './js/clock.js',
  './js/speechAutoSync.js',
  './js/movieId.js',
  './js/subtitleFinder.js',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  '../../css/styles.css',
  '../../css/app-shell.css',
  '../../js/app-shell.js',
  '../../assets/logo-96.png',
];

// Only this tool's files and the shared site styles and scripts are cached.
// Sign-in, the API and everything on other sites go straight to the network.
const OURS = /^\/(tools\/subsync\/|css\/|js\/|assets\/)/;

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (url.origin !== self.location.origin || e.request.method !== 'GET' || !OURS.test(url.pathname)) return;

  e.respondWith(
    fetch(e.request)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(e.request, copy));
        }
        return res;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: true }).then((hit) => hit || Response.error()))
  );
});
