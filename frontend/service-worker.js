/* Cache immutable frontend assets and family-scoped avatars. Never cache pages or APIs. */
var AVATAR_CACHE = 'kids-chores-avatar-v1';
// Bump this whenever frontend assets change in a release. Asset filenames are
// stable, so the cache name is the deployment version that invalidates them.
var STATIC_CACHE = 'kids-chores-static-v3';
var AVATAR_PATH_RE = /^\/api\/kids\/[^/]+\/avatar$/;
var VERSIONED_STATIC_PATH_RE = /\.(?:js|css|webmanifest|png|ico)$/i;
var FONT_PATH_RE = /^\/fonts\/.+\.(?:ttf|otf|woff2?)$/i;

function isVersionedAvatar(request) {
    if (request.method !== 'GET') return false;
    var url = new URL(request.url);
    return url.origin === self.location.origin
        && AVATAR_PATH_RE.test(url.pathname)
        && Boolean(url.searchParams.get('v'))
        && Boolean(url.searchParams.get('f'));
}

function isCacheableStaticAsset(request) {
    if (request.method !== 'GET') return false;
    var url = new URL(request.url);
    if (url.origin !== self.location.origin) return false;
    return (VERSIONED_STATIC_PATH_RE.test(url.pathname) && url.pathname !== '/service-worker.js')
        || FONT_PATH_RE.test(url.pathname);
}

function isExpectedCachedResponse(request, response) {
    var contentType = response.headers.get('Content-Type') || '';
    var pathname = new URL(request.url).pathname;
    if (AVATAR_PATH_RE.test(pathname)) return /^image\/png\b/i.test(contentType);
    if (/\.js$/i.test(pathname)) return /(?:java|ecma)script/i.test(contentType);
    if (/\.css$/i.test(pathname)) return /^text\/css\b/i.test(contentType);
    if (/\.webmanifest$/i.test(pathname)) return /^(?:application\/manifest\+json|application\/json)\b/i.test(contentType);
    if (/\.(?:png|ico)$/i.test(pathname)) return /^image\/(?:png|x-icon|vnd\.microsoft\.icon)\b/i.test(contentType);
    // Local fonts are served under a stable filename. Accept their normal font
    // MIME types (and Flask's octet-stream fallback), never a login HTML page.
    return /^(?:font\/|application\/(?:font-|x-font-|octet-stream))/i.test(contentType);
}

async function cacheFirst(request, cacheName) {
    var cache = await caches.open(cacheName);
    var cached = await cache.match(request);
    if (cached) return cached;
    var response = await fetch(request);
    if (response.ok && isExpectedCachedResponse(request, response)) {
        try {
            await cache.put(request, response.clone());
        } catch (_) {
            // Storage can be unavailable or full; the network response still
            // lets the page work normally.
        }
    }
    return response;
}

self.addEventListener('install', function (event) {
    event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', function (event) {
    event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', function (event) {
    if (isVersionedAvatar(event.request)) {
        event.respondWith(cacheFirst(event.request, AVATAR_CACHE));
    } else if (isCacheableStaticAsset(event.request)) {
        event.respondWith(cacheFirst(event.request, STATIC_CACHE));
    }
});
