// Reuse Home and session grading; only their data source and available actions differ.
window.OfflineParentClient = { active: false, blocked: false };
(() => {
    const originalFetch = window.fetch.bind(window);
    let authToken;
    window.OfflineParentClient.ready = (async () => {
        const setup = await window.OfflineSetupStore.getBoundSetup();
        if (setup?.status !== 'active') return;
        authToken = await window.OfflineParentAuth.token(setup);
        if (!authToken) {
            window.OfflineParentClient.blocked = true;
            location.replace('/family-home.html');
            return;
        }
        window.OfflineParentClient.active = true;
        window.OfflineParentClient.setup = setup;
        const dayKey = `offline-review-day:${setup.id}`;
        const reviewDay = new URLSearchParams(location.search).get('offlineDay') || sessionStorage.getItem(dayKey);
        if (reviewDay) sessionStorage.setItem(dayKey, reviewDay);
        window.OfflineParentClient.reviewDay = reviewDay;
        if (reviewDay && location.pathname === '/admin.html') {
            const heading = document.querySelector('.page-header-with-back h1, .page-header h1');
            if (heading) heading.append(` · ${reviewDay}`);
        }
        window.OfflinePracticeClient = { active: true };
        document.documentElement.classList.add('offline-parent-active');
        window.KidAppNavigation?.render();
    })();
    window.fetch = async (input, options) => {
        await window.OfflineParentClient.ready;
        const request = new Request(input, options);
        const url = new URL(request.url);
        if (window.OfflineParentClient.active && url.origin === location.origin && url.pathname.startsWith('/api/')
            && !url.pathname.startsWith('/api/offline/')) {
            const headers = new Headers(request.headers);
            headers.set('X-Offline-Parent', authToken);
            if (window.OfflineParentClient.reviewDay) headers.set('X-Offline-Day', window.OfflineParentClient.reviewDay);
            return originalFetch(new Request(request, { headers }));
        }
        return originalFetch(request);
    };
    // Also reject stale links / controls retained by browser history or another render.
    document.addEventListener('click', (event) => {
        if (!window.OfflineParentClient.active) return;
        const forbidden = event.target.closest('[data-cell-link], [data-cell-toggle], [data-row-opt-toggle], [data-kid-delete], [data-off-app-opt-toggle], [data-unadded-subject-toggle], [data-off-app-inactive-toggle], [data-off-app-add-open], #editToggleBtn, #deleteSessionBtn');
        const link = event.target.closest('a[href]');
        const path = link ? new URL(link.href, location.origin).pathname : '';
        if (forbidden || (path && !['/admin.html', '/family-home.html', '/kid-session-report.html', '/offline/home.html'].includes(path))) {
            event.preventDefault();
            event.stopImmediatePropagation();
        }
    }, true);
})();
