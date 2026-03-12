window.ReportBackButtonCommon = (() => {
    function canUseHistoryBack() {
        if (!window.history || window.history.length <= 1) {
            return false;
        }
        const referrer = String(document.referrer || '').trim();
        if (!referrer) {
            return false;
        }
        try {
            const refUrl = new URL(referrer, window.location.origin);
            return refUrl.origin === window.location.origin;
        } catch (error) {
            return false;
        }
    }

    function bindBackButton(button, fallbackHref) {
        if (!button) {
            return;
        }
        button.href = fallbackHref;
        button.addEventListener('click', (event) => {
            if (!canUseHistoryBack()) {
                return;
            }
            event.preventDefault();
            window.history.back();
        });
    }

    return {
        bindBackButton,
        canUseHistoryBack,
    };
})();
