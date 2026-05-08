window.ReportHeroAction = (() => {
    function escAttr(value) {
        return String(value == null ? '' : value)
            .replace(/&/g, '&amp;')
            .replace(/"/g, '&quot;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');
    }

    function escText(value) {
        return String(value == null ? '' : value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');
    }

    function iconHtml(name, opts) {
        if (!name || typeof window.icon !== 'function') return '';
        return window.icon(name, opts);
    }

    function renderActionLinkHtml(opts) {
        const { id, href, label, leadingIcon, trailingIcon } = opts || {};
        const idAttr = id ? ` id="${escAttr(id)}"` : '';
        const lead = iconHtml(leadingIcon, { size: 16, strokeWidth: 2.2 });
        const trail = iconHtml(trailingIcon, { size: 16, strokeWidth: 2.4 });
        return `<a${idAttr} class="report-hero-action" href="${escAttr(href || '#')}">${lead}<span>${escText(label)}</span>${trail}</a>`;
    }

    return { renderActionLinkHtml };
})();
