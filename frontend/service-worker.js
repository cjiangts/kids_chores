/* Cache every same-origin non-API GET. Settings can clear this cache at once. */
var APP_CACHE = 'kids-chores-offline-v1';
var AVATAR_PATH_RE = /^\/api\/kids\/[^/]+\/avatar$/;

function isCacheableAppRequest(request) {
    if (request.method !== 'GET') return false;
    var url = new URL(request.url);
    if (url.origin !== self.location.origin || url.pathname === '/service-worker.js') return false;
    // Avatar URLs contain a change version, so they are the single safe API
    // exception. Everything else under /api remains live.
    if (AVATAR_PATH_RE.test(url.pathname)) return Boolean(url.searchParams.get('v'));
    // The root response varies by login state; cache concrete pages instead.
    return !url.pathname.startsWith('/api/') && url.pathname !== '/';
}

async function cacheFirst(request) {
    var cache = await caches.open(APP_CACHE);
    var url = new URL(request.url);
    // Page query strings identify client-side data, not a different HTML file.
    // Store one shell per path; versioned avatar URLs intentionally stay distinct.
    var cacheKey = url.pathname.startsWith('/api/') ? request : url.origin + url.pathname;
    var cached = await cache.match(cacheKey);
    if (cached) return cached;
    var response = await fetch(request);
    if (response.ok && response.type === 'basic') {
        try { await cache.put(cacheKey, response.clone()); } catch (_) { /* Storage is optional. */ }
    }
    return response;
}

self.addEventListener('install', function (event) {
    event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', function (event) {
    event.waitUntil((async function () {
        var names = await caches.keys();
        await Promise.all(names
            .filter(function (name) { return name !== APP_CACHE; })
            .map(function (name) { return caches.delete(name); }));
        await self.clients.claim();
    })());
});

self.addEventListener('fetch', function (event) {
    if (isCacheableAppRequest(event.request)) event.respondWith(cacheFirst(event.request));
});
