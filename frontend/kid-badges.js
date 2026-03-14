(function initKidBadgesPage(global) {
    const API_BASE = `${window.location.origin}/api`;
    const params = new URLSearchParams(window.location.search);
    const kidId = String(params.get('id') || '').trim();
    const from = String(params.get('from') || '').trim().toLowerCase();

    const titleEl = document.getElementById('kidBadgeTitle');
    const backBtn = document.getElementById('kidBadgeBackBtn');
    const errorEl = document.getElementById('kidBadgeError');
    const loadingEl = document.getElementById('kidBadgeLoading');
    const startPanelEl = document.getElementById('kidBadgeStartPanel');
    const summaryEl = document.getElementById('kidBadgeSummary');
    const earnedCountEl = document.getElementById('kidBadgeEarnedCount');
    const comingCountEl = document.getElementById('kidBadgeComingCount');
    const earnedGridEl = document.getElementById('kidBadgeEarnedGrid');
    const comingGridEl = document.getElementById('kidBadgeComingGrid');
    const detailModalEl = document.getElementById('kidBadgeDetailModal');
    const detailCloseBtn = document.getElementById('kidBadgeDetailCloseBtn');
    const detailBodyEl = document.getElementById('kidBadgeDetailBody');
    const detailArtEl = document.getElementById('kidBadgeDetailArt');
    const detailTitleEl = document.getElementById('kidBadgeDetailTitle');
    const detailStateEl = document.getElementById('kidBadgeDetailState');
    const detailMetaEl = document.getElementById('kidBadgeDetailMeta');
    const detailTextEl = document.getElementById('kidBadgeDetailText');

    const state = {
        payload: null,
        detailItem: null,
    };

    function escapeHtml(value) {
        return String(value || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function showError(message) {
        const text = String(message || '').trim();
        if (!text) {
            errorEl.textContent = '';
            errorEl.classList.add('hidden');
            return;
        }
        errorEl.textContent = text;
        errorEl.classList.remove('hidden');
    }

    function setLoading(isLoading) {
        loadingEl.classList.toggle('hidden', !isLoading);
    }

    function formatDateTime(value) {
        const text = String(value || '').trim();
        if (!text) {
            return '-';
        }
        const parsed = new Date(text);
        if (Number.isNaN(parsed.getTime())) {
            return text;
        }
        return parsed.toLocaleString([], {
            month: 'short',
            day: 'numeric',
            year: 'numeric',
        });
    }

    function formatProgress(item) {
        const value = Number(item && item.progressValue);
        const threshold = Number(item && item.thresholdValue);
        if (!Number.isFinite(value) || !Number.isFinite(threshold) || threshold <= 0) {
            return '';
        }
        const roundedValue = Math.max(0, Math.floor(value));
        const roundedThreshold = Math.max(0, Math.floor(threshold));
        return `${roundedValue}/${roundedThreshold}`;
    }

    function resolveBackHref() {
        if (!kidId) {
            return '/';
        }
        if (from === 'kid-home') {
            return `/kid-practice-home.html?id=${encodeURIComponent(kidId)}`;
        }
        return '/';
    }

    function getPaletteKey(item) {
        return String(item && item.paletteKey ? item.paletteKey : '').trim().toLowerCase() || 'global';
    }

    function resolveBadgeImageUrl(item) {
        const imageUrl = String(item && item.badgeImageUrl ? item.badgeImageUrl : '').trim();
        if (imageUrl) {
            return imageUrl;
        }
        const imagePath = String(item && item.badgeImagePath ? item.badgeImagePath : '').trim();
        if (imagePath) {
            return `/${imagePath.replace(/^\/+/, '')}`;
        }
        return '';
    }

    function renderMysteryBadgeArt() {
        return '<span class="kid-badge-art-mystery" aria-hidden="true"><span class="kid-badge-art-mystery-mark">?</span></span>';
    }

    function renderBadgeArt(item, options = {}) {
        const imageUrl = resolveBadgeImageUrl(item);
        const alt = `${String(item && item.title ? item.title : 'Badge')} badge art`;
        if (options && options.conceal) {
            return renderMysteryBadgeArt();
        }
        if (imageUrl) {
            return `<img src="${escapeHtml(imageUrl)}" alt="${escapeHtml(alt)}">`;
        }
        return '<span class="kid-badge-art-fallback">🏅</span>';
    }

    function renderGridItems(containerEl, items, section) {
        if (!containerEl) {
            return;
        }
        if (!Array.isArray(items) || items.length <= 0) {
            containerEl.innerHTML = '<div class="kid-badge-title">No badges yet</div>';
            return;
        }
        containerEl.innerHTML = items.map((item, index) => {
            const stateClass = item && item.isEarned ? 'earned' : 'locked';
            const paletteKey = getPaletteKey(item);
            const shouldConcealArt = section === 'coming' || !Boolean(item && item.isEarned);
            return `
                <button
                    type="button"
                    class="kid-badge-card ${stateClass} kid-badge-palette-${escapeHtml(paletteKey)}"
                    data-badge-section="${escapeHtml(section)}"
                    data-badge-index="${index}"
                >
                    <span class="kid-badge-art-wrap kid-badge-palette-${escapeHtml(paletteKey)}">
                        ${renderBadgeArt(item, { conceal: shouldConcealArt })}
                    </span>
                    <span class="kid-badge-title">${escapeHtml(item && item.title ? item.title : 'Badge')}</span>
                </button>
            `;
        }).join('');
    }

    function renderSummary(payload) {
        const summary = payload && payload.summary ? payload.summary : {};
        const trackingStartedAt = payload && payload.trackingStartedAt
            ? formatDateTime(payload.trackingStartedAt)
            : 'Not started';
        summaryEl.innerHTML = `
            <div class="kid-badge-summary-box">
                <p class="kid-badge-summary-label">Started</p>
                <p class="kid-badge-summary-value">${escapeHtml(trackingStartedAt)}</p>
            </div>
            <div class="kid-badge-summary-box">
                <p class="kid-badge-summary-label">Earned</p>
                <p class="kid-badge-summary-value">${Number(summary.earnedCount || 0)}</p>
            </div>
            <div class="kid-badge-summary-box">
                <p class="kid-badge-summary-label">Next</p>
                <p class="kid-badge-summary-value">${Number(summary.comingCount || 0)}</p>
            </div>
            <div class="kid-badge-summary-box">
                <p class="kid-badge-summary-label">New</p>
                <p class="kid-badge-summary-value">${Number(summary.newAwardCount || 0)}</p>
            </div>
        `;
        summaryEl.classList.remove('hidden');
    }

    function selectCard(section, index) {
        const list = section === 'earned'
            ? (state.payload && state.payload.earned ? state.payload.earned : [])
            : (state.payload && state.payload.comingNext ? state.payload.comingNext : []);
        const item = list[index];
        if (!item) {
            return;
        }
        state.detailItem = item;
        openDetailModal(item);
    }

    function openDetailModal(item) {
        if (!item) {
            return;
        }
        const paletteKey = getPaletteKey(item);
        detailArtEl.className = `kid-badge-detail-art kid-badge-palette-${paletteKey}`;
        detailBodyEl.className = `kid-badge-detail-body kid-badge-palette-${paletteKey}`;
        detailTitleEl.textContent = String(item.title || 'Badge');
        const isEarned = Boolean(item.isEarned);
        detailArtEl.innerHTML = renderBadgeArt(item, { conceal: !isEarned });
        detailStateEl.textContent = isEarned ? 'Earned' : 'Locked';
        detailStateEl.className = `kid-badge-detail-state ${isEarned ? 'earned' : 'locked'}`;
        if (isEarned) {
            detailMetaEl.textContent = formatDateTime(item.awardedAt);
            detailTextEl.textContent = String(item.reasonText || item.goalText || '');
        } else {
            const progressText = formatProgress(item);
            detailMetaEl.textContent = progressText ? `Progress: ${progressText}` : 'Not earned yet';
            detailTextEl.textContent = String(item.goalText || '');
        }
        detailModalEl.classList.remove('hidden');
    }

    function closeDetailModal() {
        detailModalEl.classList.add('hidden');
    }

    function handleGridClick(event) {
        const card = event.target.closest('.kid-badge-card');
        if (!card) {
            return;
        }
        const section = String(card.getAttribute('data-badge-section') || '');
        const index = Number.parseInt(card.getAttribute('data-badge-index') || '', 10);
        if (!Number.isInteger(index) || (section !== 'earned' && section !== 'coming')) {
            return;
        }
        selectCard(section, index);
    }

    function renderPage(payload) {
        state.payload = payload || {};
        const kidName = String(payload && payload.kidName ? payload.kidName : 'Kid').trim() || 'Kid';
        titleEl.textContent = `${kidName}'s Badges`;
        document.title = `${kidName} - Badges - Kids Daily Chores`;
        backBtn.href = resolveBackHref();

        const trackingEnabled = Boolean(payload && payload.trackingEnabled);
        startPanelEl.classList.toggle('hidden', trackingEnabled);

        const earned = Array.isArray(payload && payload.earned) ? payload.earned : [];
        const comingNext = Array.isArray(payload && payload.comingNext) ? payload.comingNext : [];
        earnedCountEl.textContent = String(earned.length);
        comingCountEl.textContent = String(comingNext.length);

        renderSummary(payload);
        renderGridItems(earnedGridEl, earned, 'earned');
        renderGridItems(comingGridEl, comingNext, 'coming');
    }

    async function loadBadges() {
        setLoading(true);
        showError('');
        try {
            const response = await fetch(`${API_BASE}/kids/${encodeURIComponent(kidId)}/badges`);
            const payload = await response.json().catch(() => ({}));
            if (!response.ok) {
                throw new Error(payload.error || `Failed to load badges (HTTP ${response.status})`);
            }
            renderPage(payload);
        } catch (error) {
            console.error('Error loading badges:', error);
            showError(error.message || 'Failed to load badges.');
        } finally {
            setLoading(false);
        }
    }

    function handleBackdrop(event) {
        if (event.target === detailModalEl) {
            closeDetailModal();
        }
    }

    document.addEventListener('DOMContentLoaded', () => {
        if (!kidId) {
            window.location.href = '/';
            return;
        }
        backBtn.href = resolveBackHref();
        earnedGridEl.addEventListener('click', handleGridClick);
        comingGridEl.addEventListener('click', handleGridClick);
        detailCloseBtn.addEventListener('click', closeDetailModal);
        document.addEventListener('keydown', (event) => {
            if (event.key === 'Escape') {
                closeDetailModal();
            }
        });
        void loadBadges();
    });

    global.KidBadgesPage = {
        handleBackdrop,
    };
}(window));
