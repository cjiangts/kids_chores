/*
 * Retirement worker for the removed offline mode.
 *
 * Browsers with the former worker still registered periodically request this
 * exact URL. Installing this short-lived replacement lets them discard both
 * the registration and its Cache Storage on their next navigation.
 */
self.addEventListener('install', function () {
    self.skipWaiting();
});

self.addEventListener('activate', function (event) {
    event.waitUntil((async function () {
        const cacheNames = await caches.keys();
        await Promise.all(cacheNames.map(function (cacheName) {
            return caches.delete(cacheName);
        }));
        await self.registration.unregister();
    })());
});
