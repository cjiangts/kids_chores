/**
 * Minimal Service Worker for offline practice mode.
 *
 * Strategy:
 *   - Pre-cache the practice app shell (HTML / JS / CSS) so a refresh on
 *     the practice or practice-home pages while offline does not turn into
 *     a blank page.
 *   - On install: warm the SHELL cache.
 *   - On fetch:
 *       * Same-origin GET for shell assets   -> cache-first (SHELL)
 *       * Same-origin GET that already lives in the runtime cache
 *         (audio blobs etc. prefetched at acquire time)  -> cache-first
 *       * Everything else (API, auth)  -> network-only
 *   - On activate: drop any cache whose name isn't ours (one-shot cleanup
 *     of legacy versioned names like `offline-shell-v4`).
 *
 * The runtime cache (`offline-runtime`) is populated by the foreground
 * page during acquirePack(). The SW just reads from it.
 *
 * Cache names are intentionally unversioned. Any time the SW source bytes
 * change, the browser reinstalls, the install handler re-fetches every
 * SHELL_URL fresh from the network, and `cache.put` overwrites the entries
 * in place. For non-shell shell-listed file edits, stale-while-revalidate
 * in the fetch handler updates entries on next request. There is nothing
 * to bump.
 */

const SHELL_CACHE = 'offline-shell';
const RUNTIME_CACHE = 'offline-runtime';

const SHELL_URLS = [
    '/kid-practice.html',
    '/kid-practice-home.html',
    '/index.html',
    '/offline-redirect-guard.js',
    '/styles.css',
    '/subject-icons.css',
    '/home-redesign-v4.css',
    '/kid-badge-shelf-modal.css',
    '/kid-badge-celebration.css',
    '/audio-history-common.css',
    '/fonts-local.css',
    '/fonts/HuaWenKaiTi.ttf',
    '/icons.js',
    '/subject-icons.js',
    '/deck-category-common.js',
    '/practice-star-badge-common.js',
    '/practice-ui-common.js',
    '/practice-manage-common.js',
    '/practice-judge-mode.js',
    '/practice-progress.js',
    '/practice-session.js',
    '/practice-session-flow.js',
    '/writing-audio-sequence.js',
    '/simple-audio-player.js',
    '/audio-history-common.js',
    '/audio-common.js',
    '/recording-visualizer.js',
    '/kid-badge-shelf-modal.js',
    '/kid-badge-celebration.js',
    '/offline-storage.js',
    '/offline-common.js',
    '/kid-practice-core.js',
    '/kid-practice-type1.js',
    '/kid-practice-type2.js',
    '/kid-practice-type3.js',
    '/kid-practice-type4.js',
    '/kid-practice-home.js',
];

self.addEventListener('install', (event) => {
    event.waitUntil((async () => {
        const cache = await caches.open(SHELL_CACHE);
        // Pre-cache best-effort: skip individual failures.
        await Promise.all(SHELL_URLS.map(async (url) => {
            try {
                const res = await fetch(url, { credentials: 'same-origin' });
                if (res && res.ok) await cache.put(url, res.clone());
            } catch (_) { /* ignore */ }
        }));
        await self.skipWaiting();
    })());
});

self.addEventListener('activate', (event) => {
    event.waitUntil((async () => {
        const keep = new Set([SHELL_CACHE, RUNTIME_CACHE]);
        const keys = await caches.keys();
        await Promise.all(keys.filter((k) => !keep.has(k)).map((k) => caches.delete(k)));
        await self.clients.claim();
    })());
});

self.addEventListener('fetch', (event) => {
    const req = event.request;
    if (req.method !== 'GET') return;
    const url = new URL(req.url);
    if (url.origin !== self.location.origin) return;

    const isApi = url.pathname.startsWith('/api/');
    const isAuth = url.pathname.startsWith('/family-');

    event.respondWith((async () => {
        // The runtime cache is populated by acquirePack() with audio blobs
        // whose URLs are /api/kids/.../{type2,cards}/audio/... — those need
        // to be served from cache even though they share the /api/ prefix.
        const runtimeCache = await caches.open(RUNTIME_CACHE);
        const runtimeHit = await runtimeCache.match(req);
        if (runtimeHit) return runtimeHit;

        // API + auth never use the shell cache and never get cached on miss.
        if (isApi || isAuth) return fetch(req);

        const shellCache = await caches.open(SHELL_CACHE);
        const shellHit = await shellCache.match(req, { ignoreSearch: true });
        if (shellHit) {
            // Stale-while-revalidate for the shell.
            event.waitUntil((async () => {
                try {
                    const fresh = await fetch(req);
                    if (fresh && fresh.ok) await shellCache.put(req, fresh.clone());
                } catch (_) { /* offline */ }
            })());
            return shellHit;
        }
        try {
            return await fetch(req);
        } catch (e) {
            // Fall back to whatever we have, otherwise rethrow.
            const fallback = await shellCache.match('/kid-practice-home.html');
            if (fallback) return fallback;
            throw e;
        }
    })());
});
