(function () {
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
