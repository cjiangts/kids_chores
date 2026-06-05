window.BackButtonCommon = (() => {
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

    function bindBackButton(button) {
        if (!button) {
            return;
        }
        if (button.dataset.backButtonBound === '1') {
            return;
        }
        button.dataset.backButtonBound = '1';
        button.addEventListener('click', (event) => {
            event.preventDefault();
            goBack();
        });
    }

    function goBack() {
        if (canUseHistoryBack()) {
            window.history.back();
        }
    }

    function bindDeclaredBackButtons(root = document) {
        root.querySelectorAll('[data-back-button]').forEach((button) => {
            bindBackButton(button);
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => bindDeclaredBackButtons());
    } else {
        bindDeclaredBackButtons();
    }

    return {
        bindBackButton,
        bindDeclaredBackButtons,
        canUseHistoryBack,
        goBack,
    };
})();
