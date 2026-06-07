(function initFamilyUserSwitcher(window, document) {
    const DEFAULT_HREF = '/family-home.html';
    const CURRENT_USER_MODE_STORAGE_KEY = 'family_current_user_mode_v1';
    const CURRENT_USER_NAME_STORAGE_KEY = 'family_current_user_name_v1';

    function escapeHtml(value) {
        return String(value ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    function iconHtml(name) {
        if (typeof window.icon !== 'function') return '';
        return window.icon(name || 'user', {
            className: 'family-user-switcher__icon',
            size: 18,
            strokeWidth: 2.25,
        });
    }

    function isParentOnlyPage() {
        const path = window.location.pathname || '';
        return document.body.classList.contains('parent-admin-page')
            || path.endsWith('/admin.html')
            || path.endsWith('/point-log.html')
            || path.endsWith('/point-rules.html')
            || path.endsWith('/parent-rewards.html')
            || path.endsWith('/parent-settings.html');
    }

    function readSession(key) {
        try {
            if (!window.sessionStorage) return '';
            return String(window.sessionStorage.getItem(key) || '').trim();
        } catch (error) {
            return '';
        }
    }

    // The switcher always reflects the current user held in cache — never a
    // per-page override. Parent-only pages are always the parent.
    function currentUser() {
        if (isParentOnlyPage()) {
            return { name: 'Parent', icon: 'user-cog' };
        }
        const mode = readSession(CURRENT_USER_MODE_STORAGE_KEY).toLowerCase();
        if (mode === 'kid') {
            return { name: readSession(CURRENT_USER_NAME_STORAGE_KEY) || 'Kid', icon: 'user' };
        }
        return { name: 'Parent', icon: 'user-cog' };
    }

    function render(container, options = {}) {
        if (!container) return;
        const name = String(options.name || '').trim() || 'Parent';
        const href = String(options.href || DEFAULT_HREF);
        const iconName = String(options.icon || 'user');
        const title = String(options.title || `Switch user from ${name}`);
        const extraClass = String(options.className || '').trim();
        container.innerHTML = `
            <a class="family-user-switcher${extraClass ? ` ${escapeHtml(extraClass)}` : ''}" href="${escapeHtml(href)}" aria-label="${escapeHtml(title)}" title="${escapeHtml(title)}">
                ${iconHtml(iconName)}
                <span class="family-user-switcher__label">${escapeHtml(name)}</span>
            </a>
        `;
    }

    function renderAuto(container) {
        if (!container) return;
        const user = currentUser();
        render(container, {
            name: user.name,
            icon: user.icon,
            href: container.getAttribute('data-user-href') || DEFAULT_HREF,
            title: `Switch user from ${user.name}`,
        });
    }

    function boot() {
        document.querySelectorAll('[data-family-user-switcher]').forEach(renderAuto);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', boot);
    } else {
        boot();
    }

    window.FamilyUserSwitcher = { render, renderAuto, boot, currentUser };
})(window, document);
