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
