/* Service Worker (safe, CORS-friendly)
 * - Avoids intercepting cross-origin requests (fixes Tailwind CDN CORS error)
 * - No CDN/third-party pre-cache
 * - Robust caching strategies:
 *    - navigation (HTML): network-first, fallback to cache
 *    - same-origin static GET: cache-first, then network & update cache
 * - Safe pre-cache with try/catch per-asset (no install fail on 404)
 */

const CACHE_VERSION = 'v2';
const STATIC_CACHE = `journal-static-${CACHE_VERSION}`;

// Keep this list SAME-ORIGIN only. Do NOT put external/CDN URLs here.
const APP_SHELL = [
  './',
  './index.html',
  './app.js',
  './styles.css',
  './styles33.css',
  './manifest.json',
  './manifest33.json',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

async function safePrecache(cache, assets) {
  for (const url of assets) {
    try {
      const res = await fetch(url, { cache: 'no-cache' });
      if (res && res.ok) await cache.put(url, res.clone());
    } catch (e) {
      // ignore missing files
      // console.warn('[SW] precache skip', url, e);
    }
  }
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(STATIC_CACHE);
      await safePrecache(cache, APP_SHELL);
      self.skipWaiting();
    })()
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.map(k => {
        if (k.startsWith('journal-static-') && k !== STATIC_CACHE) {
          return caches.delete(k);
        }
      }));
      await self.clients.claim();
    })()
  );
});

function isSameOrigin(req) {
  try {
    const u = new URL(req.url);
    return u.origin === self.location.origin;
  } catch {
    return false;
  }
}

async function cacheFirst(event) {
  const cache = await caches.open(STATIC_CACHE);
  const cached = await cache.match(event.request);
  if (cached) return cached;

  const res = await fetch(event.request);
  if (res && res.ok && res.type === 'basic') {
    cache.put(event.request, res.clone());
  }
  return res;
}

async function networkFirstHTML(event) {
  const cache = await caches.open(STATIC_CACHE);
  try {
    const res = await fetch(event.request);
    if (res && res.ok) cache.put(event.request, res.clone());
    return res;
  } catch {
    const cached = await cache.match(event.request);
    if (cached) return cached;
    // last resort: return cached index.html for SPA navigation
    const fallback = await cache.match('./index.html');
    if (fallback) return fallback;
    throw new Error('Offline and no cached page');
  }
}

self.addEventListener('fetch', (event) => {
  const { request } = event;

  // Only handle GET
  if (request.method !== 'GET') return;

  // Skip cross-origin to avoid CORS issues (e.g., cdn.tailwindcss.com)
  if (!isSameOrigin(request)) return;

  // HTML navigations: network-first
  if (request.mode === 'navigate' || request.headers.get('accept')?.includes('text/html')) {
    event.respondWith(networkFirstHTML(event));
    return;
  }

  // Same-origin static GET: cache-first
  event.respondWith(cacheFirst(event));
});

// Optional: allow page to trigger skipWaiting() after SW update
self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});
