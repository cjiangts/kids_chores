(function initPointHeaderActions(window, document) {
    const CURRENT_USER_MODE_STORAGE_KEY = 'family_current_user_mode_v1';

    function isParentOnlyPage() {
        const path = window.location.pathname || '';
        return document.body.classList.contains('parent-admin-page')
            || path.endsWith('/admin.html')
            || path.endsWith('/point-log.html')
            || path.endsWith('/point-rules.html')
            || path.endsWith('/parent-rewards.html')
            || path.endsWith('/parent-settings.html');
    }

    function isKidUserMode() {
        if (isParentOnlyPage()) return false;
        try {
            if (!window.sessionStorage) return false;
            return String(window.sessionStorage.getItem(CURRENT_USER_MODE_STORAGE_KEY) || '').trim().toLowerCase() === 'kid';
        } catch (error) {
            return false;
        }
    }

    function iconHtml(name) {
        if (typeof window.icon === 'function') {
            return window.icon(name, { className: 'icon', size: 18 });
        }
        return `<span class="icon" data-icon="${name}" data-icon-size="18"></span>`;
    }

    function renderLogPoints(host) {
        if (isKidUserMode()) {
            host.innerHTML = '';
            host.classList.add('hidden');
            return;
        }
        host.classList.remove('hidden');
        host.innerHTML = `
            <a href="/point-log.html" class="back-btn btn-secondary page-header-back-btn">
                ${iconHtml('pencil')}
                <span>Log Points</span>
            </a>
        `;
        if (typeof window.hydrateIcons === 'function') {
            window.hydrateIcons(host);
        }
    }

    function boot() {
        document.querySelectorAll('[data-point-header-action="log-points"]').forEach(renderLogPoints);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', boot);
    } else {
        boot();
    }
})(window, document);
