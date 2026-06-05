(function initKidAppNavigation(window, document) {
    const LAST_VIEWED_KID_STORAGE_KEY = 'parent_admin_last_kid_id_v1';
    const NAV_ID = 'kidAppNavigation';
    const PAGE_PATHS = {
        home: '/admin.html',
        practice: '/kid-practice-home.html',
        rewards: '/kid-rewards.html',
    };
    const ITEMS = [
        { key: 'home', label: 'Home', icon: 'home' },
        { key: 'practice', label: 'Practice', icon: 'graduation-cap' },
        { key: 'rewards', label: 'Rewards', icon: 'gift' },
    ];

    const state = {
        kidId: readKidIdFromUrl() || readLastViewedKidId(),
    };

    function readKidIdFromUrl() {
        try {
            const params = new URLSearchParams(window.location.search || '');
            return String(params.get('id') || params.get('kidId') || '').trim();
        } catch (error) {
            return '';
        }
    }

    function readLastViewedKidId() {
        try {
            if (!window.sessionStorage) return '';
            return String(window.sessionStorage.getItem(LAST_VIEWED_KID_STORAGE_KEY) || '').trim();
        } catch (error) {
            return '';
        }
    }

    function persistLastViewedKidId(kidId) {
        const normalized = String(kidId || '').trim();
        try {
            if (!window.sessionStorage || !normalized) return;
            window.sessionStorage.setItem(LAST_VIEWED_KID_STORAGE_KEY, normalized);
        } catch (error) {
            // best-effort navigation memory
        }
    }

    function activeKey() {
        const path = window.location.pathname || '';
        if (path.endsWith('/kid-practice-home.html')) return 'practice';
        if (
            path.endsWith('/kid-rewards.html')
            || path.endsWith('/point-log.html')
            || path.endsWith('/point-rules.html')
        ) return 'rewards';
        return 'home';
    }

    function hrefFor(item) {
        if (item.key === 'home') return PAGE_PATHS.home;
        const kidId = String(state.kidId || '').trim();
        if (!kidId) return PAGE_PATHS[item.key];
        return `${PAGE_PATHS[item.key]}?id=${encodeURIComponent(kidId)}`;
    }

    function iconHtml(name) {
        if (typeof window.icon !== 'function') return '';
        return window.icon(name, {
            className: 'kid-app-nav__icon',
            size: 24,
            strokeWidth: 2.35,
        });
    }

    function render() {
        let nav = document.getElementById(NAV_ID);
        if (!nav) {
            nav = document.createElement('nav');
            nav.id = NAV_ID;
            nav.className = 'kid-app-nav';
            nav.setAttribute('aria-label', 'Main kid navigation');
            document.body.classList.add('has-kid-app-nav');
        }
        placeNav(nav);
        const active = activeKey();
        nav.innerHTML = ITEMS.map((item) => {
            const isActive = item.key === active;
            return `
                <a class="kid-app-nav__item${isActive ? ' is-active' : ''}" href="${hrefFor(item)}"${isActive ? ' aria-current="page"' : ''}>
                    ${iconHtml(item.icon)}
                    <span class="kid-app-nav__label">${item.label}</span>
                </a>
            `;
        }).join('');
    }

    function placeNav(nav) {
        const headerRow = document.querySelector('.page-header-with-back .page-header-row');
        if (!headerRow) {
            if (nav.parentNode !== document.body) {
                document.body.appendChild(nav);
            }
            return;
        }
        headerRow.classList.add('kid-app-nav-row');
        const actions = headerRow.querySelector('.page-header-actions');
        if (actions && nav.nextSibling !== actions) {
            headerRow.insertBefore(nav, actions);
            return;
        }
        if (!actions && nav.parentNode !== headerRow) {
            headerRow.appendChild(nav);
        }
    }

    function setKidId(kidId) {
        const normalized = String(kidId || '').trim();
        if (!normalized || normalized === state.kidId) {
            if (!state.kidId && normalized) state.kidId = normalized;
            render();
            return;
        }
        state.kidId = normalized;
        persistLastViewedKidId(normalized);
        render();
    }

    function setKids(kids) {
        const list = Array.isArray(kids) ? kids : [];
        if (state.kidId && list.some((kid) => String(kid?.id || '') === state.kidId)) {
            render();
            return;
        }
        const lastId = readLastViewedKidId();
        const fallback = list.find((kid) => String(kid?.id || '') === lastId) || list[list.length - 1];
        setKidId(String(fallback?.id || ''));
    }

    function boot() {
        const urlKidId = readKidIdFromUrl();
        if (urlKidId) {
            state.kidId = urlKidId;
            persistLastViewedKidId(urlKidId);
        }
        render();
    }

    window.KidAppNavigation = {
        render,
        setKidId,
        setKids,
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', boot);
    } else {
        boot();
    }
})(window, document);
