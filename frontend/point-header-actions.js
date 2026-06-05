(function initPointHeaderActions(window, document) {
    function iconHtml(name) {
        if (typeof window.icon === 'function') {
            return window.icon(name, { className: 'icon', size: 18 });
        }
        return `<span class="icon" data-icon="${name}" data-icon-size="18"></span>`;
    }

    function renderLogPoints(host) {
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
