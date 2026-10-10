(function () {
    // iOS Safari may discard an otherwise fresh HTTP image cache between page
    // navigations. The worker retains versioned immutable assets locally.
    // Keep this in sync with STATIC_CACHE in service-worker.js. localStorage
    // survives the standalone-app session reset below, unlike sessionStorage.
    var SERVICE_WORKER_RELEASE = 'v3';
    var SERVICE_WORKER_STORAGE_KEY = 'kids_chores_service_worker_release';

    // Shared request helper: identical requests made by two page components
    // reuse one in-flight response. The family timezone is the only current
    // caller allowed to persist its value across browser sessions.
    var requestPromises = new Map();
    var REQUEST_CACHE_PREFIX = 'kids_chores_request_cache_v1:';
    var ACTIVE_FAMILY_STORAGE_KEY = 'kids_chores_active_family_id_v1';

    function requestCacheKey(url) {
        return REQUEST_CACHE_PREFIX + encodeURIComponent(String(url));
    }

    function persistentCacheKey(url) {
        try {
            var familyId = String(localStorage.getItem(ACTIVE_FAMILY_STORAGE_KEY) || '').trim();
            return familyId ? requestCacheKey('family:' + familyId + ':' + url) : null;
        } catch (_) { return null; }
    }

    function rememberFamilyId(data) {
        var familyId = String(data && data.familyId || '').trim();
        if (!familyId) return;
        try { localStorage.setItem(ACTIVE_FAMILY_STORAGE_KEY, familyId); } catch (_) { /* ignore */ }
    }

    function getCachedJson(url, ttlMs, persist) {
        try {
            if (persist) {
                var persistentKey = persistentCacheKey(url);
                var persistent = persistentKey && JSON.parse(localStorage.getItem(persistentKey) || 'null');
                if (persistent && persistent.data) return persistent.data;
            } else {
                var saved = JSON.parse(sessionStorage.getItem(requestCacheKey(url)) || 'null');
                if (saved && saved.expiresAt > Date.now()) return saved.data;
            }
        } catch (_) { /* Storage is an optional optimization. */ }
        return null;
    }

    function saveCachedJson(url, data, ttlMs, persist) {
        if (!ttlMs && !persist) return;
        try {
            if (persist) {
                rememberFamilyId(data);
                var persistentKey = persistentCacheKey(url);
                if (persistentKey) localStorage.setItem(persistentKey, JSON.stringify({ data: data }));
            } else {
                sessionStorage.setItem(requestCacheKey(url), JSON.stringify({
                    expiresAt: Date.now() + ttlMs,
                    data: data
                }));
            }
        } catch (_) { /* Storage is an optional optimization. */ }
    }

    window.KidsChoresRequestCache = {
        getJson: function (url, options) {
            var ttlMs = Number(options && options.ttlMs) || 0;
            var persist = Boolean(options && options.persist);
            var cached = (ttlMs || persist) ? getCachedJson(url, ttlMs, persist) : null;
            if (cached) return Promise.resolve(cached);
            var key = String(url);
            if (requestPromises.has(key)) return requestPromises.get(key);
            var request = fetch(url, { headers: { Accept: 'application/json' } })
                .then(function (response) {
                    return response.json().catch(function () { return {}; })
                        .then(function (data) {
                            if (!response.ok) {
                                throw new Error(data.error || 'Request failed (' + response.status + ')');
                            }
                            saveCachedJson(url, data, ttlMs, persist);
                            return data;
                        });
                })
                .finally(function () { requestPromises.delete(key); });
            requestPromises.set(key, request);
            return request;
        },
        invalidate: function (url) {
            try { sessionStorage.removeItem(requestCacheKey(url)); } catch (_) { /* ignore */ }
            try {
                var persistentKey = persistentCacheKey(url);
                if (persistentKey) localStorage.removeItem(persistentKey);
            } catch (_) { /* ignore */ }
        },
        storeJson: function (url, data, options) {
            saveCachedJson(url, data, Number(options && options.ttlMs) || 0, Boolean(options && options.persist));
        }
    };

    function enableAvatarCache() {
        if (!('serviceWorker' in navigator)) return;
        // Calling register on every navigation makes Safari revalidate the
        // worker every time. Check once per release instead.
        try {
            if (localStorage.getItem(SERVICE_WORKER_STORAGE_KEY) === SERVICE_WORKER_RELEASE) return;
            localStorage.setItem(SERVICE_WORKER_STORAGE_KEY, SERVICE_WORKER_RELEASE);
        } catch (_) { /* If storage is blocked, retain the normal behavior. */ }
        navigator.serviceWorker.register('/service-worker.js', { scope: '/' })
            .catch(function () {
                try { localStorage.removeItem(SERVICE_WORKER_STORAGE_KEY); } catch (_) { /* ignore */ }
                // Regular HTTP cache remains the fallback.
            });
        if ('caches' in window) {
            caches.keys()
                .then(function (cacheNames) {
                    return Promise.all(cacheNames
                        .filter(function (name) {
                            return name !== 'kids-chores-avatar-v1'
                                && name !== 'kids-chores-static-v3';
                        })
                        .map(function (name) { return caches.delete(name); }));
                })
                .catch(function () { /* Best-effort cleanup only. */ });
        }
    }

    enableAvatarCache();

    var HOME_PATH = '/family-home.html';
    var DEFAULT_TIMEOUT_MS = 30 * 60 * 1000;
    var timeoutMs = Number(window.APP_IDLE_HOME_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS;
    var timerId = null;
    var lastActivityAt = Date.now();
    var ignoredPaths = {
        '/': true,
        '/index.html': true,
        '/family-login.html': true,
        '/family-register.html': true,
        '/kid-practice.html': true
    };
    ignoredPaths[HOME_PATH] = true;

    function currentPath() {
        return String(window.location.pathname || '/');
    }

    function clearDockUserState() {
        try {
            var standalone = Boolean(window.navigator && window.navigator.standalone)
                || Boolean(window.matchMedia && window.matchMedia('(display-mode: standalone)').matches);
            if (!standalone) return;
            var startedKey = 'dock_app_session_started_v1';
            var freshEntry = !document.referrer || sessionStorage.getItem(startedKey) !== '1';
            if (!freshEntry) return;
            try { sessionStorage.clear(); } catch (_) { /* ignore */ }
            try { sessionStorage.setItem(startedKey, '1'); } catch (_) { /* ignore */ }
            [
                'family_current_user_mode_v1',
                'family_current_user_name_v1',
                'family_current_user_avatar_v1',
                'parent_admin_last_kid_id_v1',
                'family_last_kid_url_v1'
            ].forEach(function (key) {
                try { localStorage.removeItem(key); } catch (_) { /* ignore */ }
            });
            if (currentPath() !== HOME_PATH) {
                window.location.replace(HOME_PATH);
            }
        } catch (_) {
            // Best-effort reset only.
        }
    }

    clearDockUserState();

    function shouldRun() {
        if (timeoutMs <= 0) return false;
        return !ignoredPaths[currentPath()];
    }

    function goHomeIfIdle() {
        if (!shouldRun()) return;
        if (Date.now() - lastActivityAt >= timeoutMs) {
            window.location.replace(HOME_PATH);
            return;
        }
        schedule();
    }

    function schedule() {
        window.clearTimeout(timerId);
        timerId = window.setTimeout(goHomeIfIdle, timeoutMs);
    }

    function markActivity() {
        if (!shouldRun()) return;
        lastActivityAt = Date.now();
        schedule();
    }

    if (!shouldRun()) return;

    ['pointerdown', 'pointermove', 'keydown', 'touchstart', 'scroll', 'focus'].forEach(function (eventName) {
        window.addEventListener(eventName, markActivity, { passive: true, capture: true });
    });
    document.addEventListener('visibilitychange', function () {
        if (document.visibilityState === 'visible') {
            goHomeIfIdle();
        }
    });
    window.addEventListener('pageshow', function () {
        goHomeIfIdle();
    });
    schedule();
})();
