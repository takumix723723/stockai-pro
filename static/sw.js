/* StockAI Pro Service Worker v4 — 軽量・ネットワーク優先 */
const CACHE_VERSION = 'stockai-pro-v45';
const STATIC_CACHE = `${CACHE_VERSION}-core`;

const PRECACHE = [
  '/offline',
  '/static/style.css',
  '/static/api-cache.js',
  '/static/script.js',
  '/static/search.js',
  '/static/watchlist.js',
  '/static/theme.js',
  '/static/stock-chart-periods.js',
  '/static/stock-simulator.js',
  '/static/trade-scenarios.js',
  '/static/ipo.js',
  '/static/manifest.json',
  '/static/icons/icon-192.png',
  '/static/icons/apple-touch-icon.png',
  '/static/icons/favicon.ico',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(STATIC_CACHE)
      .then((cache) => cache.addAll(PRECACHE).catch(() => {}))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((k) => k.startsWith('stockai-pro-') && k !== STATIC_CACHE)
            .map((k) => caches.delete(k))
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

async function offlineFallback() {
  const cache = await caches.open(STATIC_CACHE);
  return (await cache.match('/offline')) || Response.error();
}

function isPrecachedPath(pathname) {
  return PRECACHE.some((p) => p === pathname || p === pathname.replace(/\/$/, ''));
}

function isAppRoute(pathname) {
  return (
    pathname === '/' ||
    pathname === '/offline' ||
    pathname === '/ipo' ||
    pathname.startsWith('/ipo/') ||
    pathname.startsWith('/stock/')
  );
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (url.pathname.startsWith('/api/')) {
    event.respondWith(fetch(request));
    return;
  }

  if (request.mode === 'navigate' || isAppRoute(url.pathname)) {
    event.respondWith(
      fetch(request).catch(() => caches.match(request).then((r) => r || offlineFallback()))
    );
    return;
  }

  if (url.pathname.startsWith('/static/') && isPrecachedPath(url.pathname)) {
    event.respondWith(
      caches.match(request).then((cached) => cached || fetch(request))
    );
  }
});
