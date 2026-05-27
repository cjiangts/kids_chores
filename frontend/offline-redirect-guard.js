/**
 * Synchronous offline-mode guard.
 *
 * Once this device owns one or more offline packs, the only useful page is
 * the per-kid practice home (Sync lives there). Visiting any other URL is a
 * dead-end and may even trip the Service-Worker shell fallback, causing a
 * redirect loop (e.g. /admin.html → SW falls back to kid-practice-home.html
 * which has no ?id= → redirects to / → SW falls back → ...).
 *
 * This guard runs synchronously from <head> on every non-practice page and
 * redirects to the owned kid's practice home before any page JS executes.
 * It reads a simple localStorage flag maintained by offline-storage.js so
 * we don't need to open IndexedDB synchronously.
 *
 * Pages that intentionally skip this guard:
 *   - kid-practice-home.html  (the destination)
 *   - kid-practice.html       (the practice runtime)
 *   - index.html / family-register.html (login still needs to be reachable)
 */
(function () {
    try {
        var raw = localStorage.getItem('offline_owned_kid_ids_v1');
        if (!raw) return;
        var ids;
        try { ids = JSON.parse(raw); } catch (_) { return; }
        if (!Array.isArray(ids) || ids.length === 0) return;
        var current = String(location.pathname || '');
        if (current === '/kid-practice-home.html' || current === '/kid-practice.html') return;
        var ownedId = String(ids[0] || '');
        if (!ownedId) return;
        location.replace('/kid-practice-home.html?id=' + encodeURIComponent(ownedId));
    } catch (_) { /* ignore */ }
})();
