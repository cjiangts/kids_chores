/**
 * Synchronous offline-mode guard.
 *
 * Once this device owns one or more offline packs, the useful pages are the
 * offline hub (family-home, where you pick a kid and Sync) and the per-kid
 * practice runtime. Visiting any other URL is a dead-end and may even trip the
 * Service-Worker shell fallback, causing a redirect loop (e.g. /admin.html →
 * SW falls back to a page with no ?id= → redirects to / → SW falls back → ...).
 *
 * This guard runs synchronously from <head> on every other page and redirects
 * to the offline hub before any page JS executes. It reads a simple
 * localStorage flag maintained by offline-storage.js so we don't need to open
 * IndexedDB synchronously.
 *
 * Pages that intentionally skip this guard:
 *   - family-home.html        (the offline hub: kid switch + per-kid Sync)
 *   - kid-practice-home.html  (per-kid practice home)
 *   - kid-practice.html       (the practice runtime)
 */
(function () {
    try {
        var raw = localStorage.getItem('offline_owned_kid_ids_v1');
        if (!raw) return;
        var ids;
        try { ids = JSON.parse(raw); } catch (_) { return; }
        if (!Array.isArray(ids) || ids.length === 0) return;
        var current = String(location.pathname || '');
        if (current === '/family-home.html'
            || current === '/kid-practice-home.html'
            || current === '/kid-practice.html') return;
        location.replace('/family-home.html');
    } catch (_) { /* ignore */ }
})();
