(function initKidAppNavigation(window, document) {
    const LAST_VIEWED_KID_STORAGE_KEY = 'parent_admin_last_kid_id_v1';
    const CURRENT_USER_MODE_STORAGE_KEY = 'family_current_user_mode_v1';
    const NAV_ID = 'kidAppNavigation';
    const MOBILE_NAV_QUERY = '(max-width: 899px)';
    const PAGE_PATHS = {
        home: '/admin.html',
        log_points: '/point-log.html',
        practice: '/kid-practice-home.html',
        parent_rewards: '/parent-rewards.html',
        kid_rewards: '/kid-rewards.html',
        stats: '/stats.html',
        settings: '/parent-settings.html',
    };
    const PARENT_ITEMS = [
        { key: 'home', label: 'Home', icon: 'home' },
        { key: 'log_points', label: 'Log Points', icon: 'clipboard-list' },
        { key: 'rewards', label: 'Rewards', icon: 'gift', path: PAGE_PATHS.parent_rewards },
        { key: 'stats', label: 'Stats', icon: 'bar-chart-3' },
        { key: 'settings', label: 'Settings', icon: 'settings' },
    ];
    const KID_ITEMS = [
        { key: 'practice', label: 'Practice', icon: 'graduation-cap' },
        { key: 'rewards', label: 'Rewards', icon: 'gift', path: PAGE_PATHS.kid_rewards },
        { key: 'stats', label: 'Stats', icon: 'bar-chart-3' },
    ];

    const state = {
        kidId: readKidIdFromUrl() || readLastViewedKidId(),
        suppressed: false,
    };

    function readKidIdFromUrl() {
        try {
            const params = new URLSearchParams(window.location.search || '');
            return String(params.get('id') || params.get('kidId') || '').trim();
        } catch (error) {
            return '';
        }
    }

    function readCurrentUserMode() {
        try {
            if (!window.sessionStorage) return '';
            const mode = String(window.sessionStorage.getItem(CURRENT_USER_MODE_STORAGE_KEY) || '').trim().toLowerCase();
            return mode === 'kid' || mode === 'parent' ? mode : '';
        } catch (error) {
            return '';
        }
    }

    function persistCurrentUserMode(mode) {
        const normalized = String(mode || '').trim().toLowerCase();
        if (normalized !== 'kid' && normalized !== 'parent') return;
        try {
            if (window.sessionStorage) {
                window.sessionStorage.setItem(CURRENT_USER_MODE_STORAGE_KEY, normalized);
            }
        } catch (error) {
            // best-effort identity mode memory
        }
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

    function navigationMode() {
        if (isParentOnlyPage()) return 'parent';
        return readCurrentUserMode() === 'kid' ? 'kid' : 'parent';
    }

    function isOfflinePracticePage() {
        const path = window.location.pathname || '';
        if (!path.endsWith('/kid-practice-home.html') && !path.endsWith('/kid-practice.html')) {
            return false;
        }
        try {
            const params = new URLSearchParams(window.location.search || '');
            return String(params.get('offline') || '').trim() === '1';
        } catch (error) {
            return false;
        }
    }

    function shouldSuppressNavigation() {
        return state.suppressed || isOfflinePracticePage();
    }

    function itemsForMode() {
        return navigationMode() === 'kid' ? KID_ITEMS : PARENT_ITEMS;
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
        if (path.endsWith('/point-log.html')) return 'log_points';
        if (path.endsWith('/stats.html')) return 'stats';
        if (
            path.endsWith('/parent-settings.html')
            || path.endsWith('/point-rules.html')
        ) return 'settings';
        if (
            path.endsWith('/kid-rewards.html')
            || path.endsWith('/parent-rewards.html')
        ) return 'rewards';
        return 'home';
    }

    function hrefFor(item) {
        if (item.key === 'home') return PAGE_PATHS.home;
        if (item.key === 'settings') return PAGE_PATHS.settings;
        const basePath = item.path || PAGE_PATHS[item.key];
        const kidId = String(state.kidId || '').trim();
        if (!kidId) return basePath;
        return `${basePath}?id=${encodeURIComponent(kidId)}`;
    }

    function iconHtml(name) {
        if (typeof window.icon !== 'function') return '';
        return window.icon(name, {
            className: 'kid-app-nav__icon',
            size: 24,
            strokeWidth: 2,
        });
    }

    function escapeHtml(value) {
        return String(value ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    function kidName(kid) {
        return String(kid?.name || '').trim() || '...';
    }

    function getKidInitial(name) {
        const trimmed = String(name || '').trim();
        if (!trimmed) return '?';
        return String.fromCodePoint(trimmed.codePointAt(0)).toUpperCase();
    }

    function hashStringToToneIndex(value, toneCount = 6) {
        const s = String(value || '');
        let hash = 0;
        for (let i = 0; i < s.length; i += 1) {
            hash = ((hash << 5) - hash) + s.charCodeAt(i);
            hash |= 0;
        }
        const m = Math.max(1, toneCount);
        return ((hash % m) + m) % m;
    }

    function kidAvatarHtml(kid) {
        const avatarUrl = String(kid?.avatarUrl || '').trim();
        if (avatarUrl) {
            return `<span class="kid-initial-avatar kid-initial-avatar--photo" style="background-image:url('${avatarUrl.replace(/'/g, '%27')}')" aria-hidden="true"></span>`;
        }
        const initial = getKidInitial(kid?.name);
        const tone = hashStringToToneIndex(kid?.id || kid?.name);
        return `<span class="kid-initial-avatar kid-initial-avatar--tone-${tone}" aria-hidden="true">${escapeHtml(initial)}</span>`;
    }

    function renderKidAvatarSwitcher(container, kids, options = {}) {
        if (!container) return;
        const list = Array.isArray(kids) ? kids : [];
        const hideWhenLessThan = Number.isInteger(options.hideWhenLessThan)
            ? options.hideWhenLessThan
            : 2;
        if (list.length < hideWhenLessThan) {
            container.innerHTML = '';
            container.classList.add('hidden');
            container.onclick = null;
            return;
        }
        const selectedKidId = String(options.selectedKidId || state.kidId || '').trim();
        container.innerHTML = list.map((kid) => {
            const id = String(kid?.id || '');
            const isActive = id === selectedKidId;
            const href = typeof options.hrefForKid === 'function'
                ? String(options.hrefForKid(kid) || '')
                : '';
            const tagName = href && !isActive ? 'a' : 'button';
            const actionAttr = tagName === 'a'
                ? ` href="${escapeHtml(href)}"`
                : ' type="button"';
            return `
                <${tagName}${actionAttr} class="kid-avatar-switcher-item${isActive ? ' active' : ''}" role="tab" aria-selected="${isActive ? 'true' : 'false'}" data-kid-id="${escapeHtml(id)}">
                    ${kidAvatarHtml(kid)}
                    <span class="kid-avatar-switcher-name">${escapeHtml(kidName(kid))}</span>
                </${tagName}>
            `;
        }).join('');
        container.classList.remove('hidden');
        container.onclick = (event) => {
            const item = event.target && event.target.closest
                ? event.target.closest('[data-kid-id]')
                : null;
            if (!item) return;
            const kidId = String(item.getAttribute('data-kid-id') || '').trim();
            const kid = list.find((entry) => String(entry?.id || '') === kidId);
            if (!kidId || !kid) return;
            if (options.persist !== false) setKidId(kidId);
            if (typeof options.onSelect === 'function') {
                options.onSelect(kidId, kid, event);
            }
        };
    }

    function render() {
        if (shouldSuppressNavigation()) {
            removeNav();
            return;
        }
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
        const mode = navigationMode();
        const items = itemsForMode();
        nav.classList.toggle('kid-app-nav--kid-mode', mode === 'kid');
        nav.classList.toggle('kid-app-nav--parent-mode', mode !== 'kid');
        nav.style.setProperty('--kid-app-nav-count', String(items.length));
        nav.setAttribute('aria-label', mode === 'kid' ? 'Kid navigation' : 'Parent navigation');
        nav.innerHTML = items.map((item) => {
            const isActive = item.key === active;
            return `
                <a class="kid-app-nav__item${isActive ? ' is-active' : ''}" href="${hrefFor(item)}"${isActive ? ' aria-current="page"' : ''}>
                    ${iconHtml(item.icon)}
                    <span class="kid-app-nav__label">${item.label}</span>
                </a>
            `;
        }).join('');
    }

    function removeNav() {
        const nav = document.getElementById(NAV_ID);
        if (nav && nav.parentNode) {
            nav.parentNode.removeChild(nav);
        }
        document.body.classList.remove('has-kid-app-nav');
        const headerRow = document.querySelector('.page-header-with-back .page-header-row');
        if (headerRow) {
            headerRow.classList.remove('kid-app-nav-row');
        }
    }

    function isMobileNavLayout() {
        try {
            return Boolean(window.matchMedia && window.matchMedia(MOBILE_NAV_QUERY).matches);
        } catch (error) {
            return false;
        }
    }

    function placeNav(nav) {
        const headerRow = document.querySelector('.page-header-with-back .page-header-row');
        // On mobile the nav is a fixed bottom bar — keep it as a direct child of
        // <body> so iOS WebKit pins it to the viewport instead of trapping it
        // inside the (flex) header and letting it drift while the page scrolls.
        // The in-header placement is desktop-only (centered pill needs the
        // relatively-positioned header row as its containing block).
        if (!headerRow || isMobileNavLayout()) {
            if (headerRow) headerRow.classList.remove('kid-app-nav-row');
            if (nav.parentNode !== document.body) {
                document.body.appendChild(nav);
            }
            return;
        }
        headerRow.classList.add('kid-app-nav-row');
        const actions = Array.from(headerRow.children).find((el) => (
            el.classList.contains('page-header-end') || el.classList.contains('page-header-actions')
        ));
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

    function getKidId() {
        return String(state.kidId || '').trim();
    }

    function setSuppressed(value) {
        state.suppressed = Boolean(value);
        if (state.suppressed) {
            removeNav();
            return;
        }
        render();
    }

    function watchViewport() {
        try {
            if (!window.matchMedia) return;
            const mq = window.matchMedia(MOBILE_NAV_QUERY);
            const handler = () => render();
            if (typeof mq.addEventListener === 'function') {
                mq.addEventListener('change', handler);
            } else if (typeof mq.addListener === 'function') {
                mq.addListener(handler);
            }
        } catch (error) {
            // best-effort responsive re-homing of the nav
        }
    }

    function boot() {
        if (isParentOnlyPage()) {
            persistCurrentUserMode('parent');
        }
        const urlKidId = readKidIdFromUrl();
        if (urlKidId) {
            state.kidId = urlKidId;
            persistLastViewedKidId(urlKidId);
        }
        render();
        watchViewport();
    }

    window.KidAppNavigation = {
        getKidId,
        getMode: navigationMode,
        remove: removeNav,
        render,
        renderKidAvatarSwitcher,
        setKidId,
        setKids,
        setSuppressed,
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', boot);
    } else {
        boot();
    }
})(window, document);
