(function initFamilyUserSwitcher(window, document) {
    const DEFAULT_HREF = '/family-home.html';

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
        render(container, {
            name: container.getAttribute('data-user-name') || 'Parent',
            icon: container.getAttribute('data-user-icon') || 'user-cog',
            href: container.getAttribute('data-user-href') || DEFAULT_HREF,
            title: container.getAttribute('data-user-title') || 'Switch user from Parent',
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

    window.FamilyUserSwitcher = { render, renderAuto, boot };
})(window, document);
