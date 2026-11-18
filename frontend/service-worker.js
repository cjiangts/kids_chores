/* Cache every same-origin non-API GET. Settings can clear this cache at once. */
importScripts('/offline/store.js', '/offline/practice-data.js', '/offline/practice-api.js', '/offline/parent-api.js');
var APP_CACHE = 'kids-chores-offline-v6';
var PACKAGE_CACHE_PREFIX = 'offline-package-';
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

async function refreshUi(cache, key, request) {
    var response = await fetch(new Request(request, { cache: 'no-store' }));
    if (response.ok && !response.redirected) {
        try { await cache.put(key, response.clone()); } catch (_) { /* Keep the saved offline copy. */ }
    }
    return response;
}

async function cacheFirst(request, event) {
    var cache = await caches.open(APP_CACHE);
    var url = new URL(request.url);
    // Page query strings identify client-side data, not a different HTML file.
    // Store one shell per path; versioned avatar URLs intentionally stay distinct.
    var cacheKey = url.pathname.startsWith('/api/') ? request : url.origin + url.pathname;
    var cached = await cache.match(cacheKey);
    // Serve saved UI immediately; deployed fixes arrive in the background.
    var refreshOfflineUi = url.pathname.startsWith('/offline/');
    if (cached) {
        if (refreshOfflineUi) event.waitUntil(refreshUi(cache, cacheKey, request).catch(function () {}));
        return cached;
    }
    var response;
    try {
        response = await fetch(refreshOfflineUi ? new Request(request, { cache: 'no-store' }) : request);
    } catch (error) {
        if (cached) return cached;
        throw error;
    }
    if (!response.ok && cached) return cached;
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
            .filter(function (name) { return name.startsWith('kids-chores-offline-') && name !== APP_CACHE; })
            .map(function (name) { return caches.delete(name); }));
        await self.clients.claim();
    })());
});

self.addEventListener('fetch', function (event) {
    var url = new URL(event.request.url);
    if (url.origin === self.location.origin) event.respondWith(serveRequest(event.request, event));
});

async function serveRequest(request, event) {
    // Explicit downloads bypass the ordinary app cache and always read the server.
    if (request.headers.get('X-Offline-Download') === '1') return fetch(request);
    var url = new URL(request.url);
    // Package lifecycle requests always belong to the server, including multipart uploads.
    if (url.pathname.startsWith('/api/offline/')) return fetch(request);
    var setup;
    try { setup = await self.OfflineSetupStore.getBoundSetup(); } catch (_) { /* Online fallback. */ }
    if (setup) {
        var home = '/offline/home.html';
        var login = url.pathname === '/family-login.html';
        var familyHome = setup.status === 'active' && ['/family-home.html', '/'].includes(url.pathname);
        var practiceHome = setup.status === 'active' && ['/kid-practice-home.html', '/kid-practice.html'].includes(url.pathname)
            && url.searchParams.get('id') === String(setup.kidId);
        var sheet = setup.status === 'active' && ['/writing-sheet-print.html', '/math-sheet-print.html'].includes(url.pathname);
        var parent = setup.status === 'active' && (url.pathname === '/admin.html'
            || (url.pathname === '/kid-session-report.html' && url.searchParams.get('id') === String(setup.kidId)));
        if (request.mode === 'navigate' && url.pathname !== home && !login && !sheet && !familyHome && !practiceHome && !parent) {
            return Response.redirect(new URL(home + '?' + new URLSearchParams({ id: setup.kidId, packageId: setup.id }), self.location.origin), 302);
        }
        if (setup.status === 'active' && url.pathname.startsWith('/api/')) {
            var parentResponse = await self.OfflineParentApi.handle(request, setup);
            if (parentResponse) return parentResponse;
            if (url.pathname === '/api/family-auth/status') return self.OfflinePracticeApi.json({ authenticated: true });
            if (url.pathname === '/api/kids' && ['family_home', 'practice_nav', 'reward_nav'].includes(url.searchParams.get('view'))) {
                return self.OfflinePracticeApi.json([{ id: setup.kidId, name: setup.manifest.kidName,
                    avatarUrl: setup.manifest.practiceConfig?.avatarUrl,
                    offlineMode: { id: setup.id, status: setup.status } }]);
            }
            var local = await self.OfflinePracticeApi.handle(request, setup);
            if (local) return local;
        }
        if (request.method === 'GET') {
            var cache = await caches.open(PACKAGE_CACHE_PREFIX + setup.id);
            var key = url.pathname.startsWith('/api/') ? url.href : url.origin + url.pathname;
            var cached = await cache.match(key);
            // Background refresh never delays cached pages, scripts or styles.
            var entryUi = url.pathname.startsWith('/offline/') || url.pathname.startsWith('/family-home.')
                || /\.(js|css|html)$/.test(url.pathname);
            if (cached) {
                if (entryUi) event.waitUntil(refreshUi(cache, key, request).catch(function () {}));
                return cached;
            }
            if (entryUi) {
                return refreshUi(cache, key, request);
            }
            if (!url.pathname.startsWith('/api/')) {
                // Existing active packages can acquire dependencies of an updated entry UI.
                var asset = await fetch(request);
                if (asset.ok && !asset.redirected) {
                    try { await cache.put(key, asset.clone()); } catch (_) { /* Storage is optional for UI updates. */ }
                }
                return asset;
            }
        }
        var familyRead = request.method === 'GET' && (AVATAR_PATH_RE.test(url.pathname)
            || (url.pathname === '/api/kids' && url.searchParams.get('view') === 'family_home'));
        if (setup.status === 'active' && url.pathname.startsWith('/api/')
                && !url.pathname.startsWith('/api/offline/') && !url.pathname.startsWith('/api/family-auth/') && !familyRead) {
            return new Response(JSON.stringify({ error: 'This request is not included in the offline package.' }), {
                status: 503, headers: { 'Content-Type': 'application/json' },
            });
        }
    }
    return isCacheableAppRequest(request) ? cacheFirst(request, event) : fetch(request);
}
