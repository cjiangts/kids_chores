(function initFamilyUserSwitcher(window, document) {
    const DEFAULT_HREF = '/family-home.html';
    const API_BASE = `${window.location.origin}/api`;
    const LAST_VIEWED_KID_STORAGE_KEY = 'parent_admin_last_kid_id_v1';
    const CURRENT_USER_MODE_STORAGE_KEY = 'family_current_user_mode_v1';
    const CURRENT_USER_NAME_STORAGE_KEY = 'family_current_user_name_v1';
    const CURRENT_USER_AVATAR_STORAGE_KEY = 'family_current_user_avatar_v1';

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

    function readKidIdFromUrl() {
        try {
            const params = new URLSearchParams(window.location.search || '');
            return String(params.get('id') || params.get('kidId') || '').trim();
        } catch (error) {
            return '';
        }
    }

    function currentKidId() {
        return readKidIdFromUrl() || readSession(LAST_VIEWED_KID_STORAGE_KEY);
    }

    function normalizeRewardBucketTotals(value) {
        const source = value && typeof value === 'object' ? value : {};
        const result = {};
        Object.entries(source).forEach(([bucket, entry]) => {
            const normalized = String(bucket || '').trim().toLowerCase();
            if (!normalized) return;
            result[normalized] = Number.parseInt(entry?.totalPoints ?? entry ?? 0, 10) || 0;
        });
        return result;
    }

    function currentBalanceFromPointData(data) {
        const rewardTotals = normalizeRewardBucketTotals(data?.rewardBucketTotals);
        const firstRewardBucket = Object.keys(rewardTotals)[0];
        if (firstRewardBucket) return rewardTotals[firstRewardBucket];
        if (data && Object.prototype.hasOwnProperty.call(data, 'totalPoints')) {
            return Number.parseInt(data.totalPoints, 10) || 0;
        }
        return null;
    }

    function formatPoints(value) {
        return `${Number.parseInt(value, 10) || 0} pts`;
    }

    // The switcher always reflects the current user held in cache — never a
    // per-page override. Parent-only pages are always the parent.
    function currentUser() {
        if (isParentOnlyPage()) {
            return { name: 'Parent', icon: 'user-cog', mode: 'parent' };
        }
        const mode = readSession(CURRENT_USER_MODE_STORAGE_KEY).toLowerCase();
        if (mode === 'kid') {
            return {
                name: readSession(CURRENT_USER_NAME_STORAGE_KEY) || 'Kid',
                icon: 'user',
                avatarUrl: readSession(CURRENT_USER_AVATAR_STORAGE_KEY),
                kidId: currentKidId(),
                mode: 'kid',
            };
        }
        return { name: 'Parent', icon: 'user-cog', mode: 'parent' };
    }

    function avatarHtml(url) {
        return `<img class="family-user-switcher__icon family-user-switcher__avatar" src="${escapeHtml(url)}" alt="" loading="lazy">`;
    }

    function render(container, options = {}) {
        if (!container) return;
        const name = String(options.name || '').trim() || 'Parent';
        const href = String(options.href || DEFAULT_HREF);
        const iconName = String(options.icon || 'user');
        const avatarUrl = String(options.avatarUrl || '').trim();
        const title = String(options.title || `Switch user from ${name}`);
        const extraClass = String(options.className || '').trim();
        const pointsHtml = options.showPoints
            ? '<span class="family-user-switcher__points" data-family-user-points hidden></span>'
            : '';
        container.innerHTML = `
            <a class="family-user-switcher${extraClass ? ` ${escapeHtml(extraClass)}` : ''}" href="${escapeHtml(href)}" aria-label="${escapeHtml(title)}" title="${escapeHtml(title)}">
                ${avatarUrl ? avatarHtml(avatarUrl) : iconHtml(iconName)}
                <span class="family-user-switcher__label">${escapeHtml(name)}${pointsHtml}</span>
            </a>
        `;
    }

    async function loadKidPoints(container, kidId) {
        const normalizedKidId = String(kidId || '').trim();
        const target = container?.querySelector?.('[data-family-user-points]');
        if (!target || !normalizedKidId) return;
        container.dataset.familyUserPointsKidId = normalizedKidId;
        try {
            const response = await fetch(`${API_BASE}/kids/${encodeURIComponent(normalizedKidId)}/points?limit=1`, {
                headers: { Accept: 'application/json' },
            });
            const data = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`);
            if (container.dataset.familyUserPointsKidId !== normalizedKidId) return;
            const balance = currentBalanceFromPointData(data);
            if (balance === null) return;
            target.textContent = ` · ${formatPoints(balance)}`;
            target.hidden = false;
            const link = container.querySelector('.family-user-switcher');
            if (link) {
                const title = `${link.getAttribute('title') || ''} · ${formatPoints(balance)}`.trim();
                link.setAttribute('title', title);
                link.setAttribute('aria-label', title);
            }
        } catch (error) {
            target.hidden = true;
        }
    }

    function renderAuto(container) {
        if (!container) return;
        const user = currentUser();
        render(container, {
            name: user.name,
            icon: user.icon,
            avatarUrl: user.avatarUrl,
            href: container.getAttribute('data-user-href') || DEFAULT_HREF,
            title: `Switch user from ${user.name}`,
            showPoints: user.mode === 'kid',
        });
        if (user.mode === 'kid') {
            loadKidPoints(container, user.kidId);
        }
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
