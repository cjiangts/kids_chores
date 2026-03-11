(function initKidBadgeShelfModal(global) {
    const state = {
        apiBase: `${window.location.origin}/api`,
        modalEl: null,
        titleEl: null,
        subtitleEl: null,
        tabEarnedBtn: null,
        tabComingBtn: null,
        panelEarnedEl: null,
        panelComingEl: null,
        currentKidId: '',
        currentKidName: '',
        payload: null,
        activeTab: 'earned',
        renderedTabs: {
            earned: false,
            coming: false,
        },
        selectedIndexByTab: {
            earned: 0,
            coming: 0,
        },
    };
    const payloadCache = new Map();
    const summaryCache = new Map();
    function escapeHtml(value) {
        return String(value || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function getPaletteKey(item) {
        const categoryKey = String(item && item.categoryKey ? item.categoryKey : '').trim().toLowerCase();
        if (categoryKey === 'chinese_characters') {
            return 'characters';
        }
        if (categoryKey === 'chinese_writing') {
            return 'writing';
        }
        if (categoryKey === 'chinese_reading') {
            return 'reading';
        }
        if (categoryKey === 'math') {
            return 'math';
        }
        return 'global';
    }

    function formatDate(value) {
        const text = String(value || '').trim();
        if (!text) {
            return 'Not earned yet';
        }
        const parsed = new Date(text);
        if (Number.isNaN(parsed.getTime())) {
            return text;
        }
        return parsed.toLocaleDateString([], {
            month: 'short',
            day: 'numeric',
            year: 'numeric',
        });
    }

    function resolveBadgeImageUrl(item) {
        const imageUrl = String(item && item.badgeImageUrl ? item.badgeImageUrl : '').trim();
        if (imageUrl) {
            return imageUrl;
        }
        const imagePath = String(item && item.badgeImagePath ? item.badgeImagePath : '').trim();
        if (!imagePath) {
            return '';
        }
        return `/${imagePath.replace(/^\/+/, '')}`;
    }

    function renderMysteryBadgeArt() {
        return '<span class="badge-art-mystery" aria-hidden="true"><span class="badge-art-mystery-mark">?</span></span>';
    }

    function renderBadgeArt(item, themeKey, options = {}) {
        const imageUrl = resolveBadgeImageUrl(item);
        const title = String(item && item.title ? item.title : 'Badge');
        if (options && options.conceal) {
            return renderMysteryBadgeArt();
        }
        if (imageUrl) {
            return `<img src="${escapeHtml(imageUrl)}" alt="${escapeHtml(title)} badge art" loading="lazy" decoding="async">`;
        }
        return `<span class="badge-theme-${escapeHtml(themeKey)}">🏅</span>`;
    }

    function ensureModalDom() {
        if (state.modalEl) {
            return;
        }
        const wrapper = document.createElement('div');
        wrapper.id = 'kidBadgeShelfModal';
        wrapper.className = 'modal hidden';
        wrapper.innerHTML = `
            <div class="modal-content modal-large badge-modal-content">
                <div class="badge-modal-top">
                    <div class="badge-modal-title-wrap">
                        <h2 id="kidBadgeShelfTitle">Badges</h2>
                        <p id="kidBadgeShelfSubtitle">Earn badges by practicing.</p>
                    </div>
                    <button type="button" class="back-btn badge-modal-close" data-badge-action="close">Close</button>
                </div>

                <div class="badge-tab-nav" role="tablist" aria-label="Badge tabs">
                    <button type="button" class="badge-tab-btn active" data-badge-tab="earned" aria-selected="true">Earned (0)</button>
                    <button type="button" class="badge-tab-btn" data-badge-tab="coming" aria-selected="false">Next (0)</button>
                </div>

                <div id="kidBadgeShelfPanelEarned" class="badge-tab-panel"></div>
                <div id="kidBadgeShelfPanelComing" class="badge-tab-panel hidden"></div>
            </div>
        `;
        document.body.appendChild(wrapper);
        state.modalEl = wrapper;
        state.titleEl = wrapper.querySelector('#kidBadgeShelfTitle');
        state.subtitleEl = wrapper.querySelector('#kidBadgeShelfSubtitle');
        state.tabEarnedBtn = wrapper.querySelector('[data-badge-tab="earned"]');
        state.tabComingBtn = wrapper.querySelector('[data-badge-tab="coming"]');
        state.panelEarnedEl = wrapper.querySelector('#kidBadgeShelfPanelEarned');
        state.panelComingEl = wrapper.querySelector('#kidBadgeShelfPanelComing');

        wrapper.addEventListener('click', (event) => {
            if (event.target === wrapper) {
                close();
                return;
            }
            const closeBtn = event.target.closest('[data-badge-action="close"]');
            if (closeBtn) {
                close();
                return;
            }
            const cardBtn = event.target.closest('.badge-card[data-badge-tab][data-badge-index]');
            if (cardBtn) {
                const tabName = String(cardBtn.getAttribute('data-badge-tab') || '').trim();
                const index = Number.parseInt(cardBtn.getAttribute('data-badge-index') || '', 10);
                if (!Number.isInteger(index) || index < 0) {
                    return;
                }
                const panelKey = tabName === 'coming' ? 'coming' : 'earned';
                if (state.selectedIndexByTab[panelKey] === index) {
                    return;
                }
                state.selectedIndexByTab[panelKey] = index;
                updateSelectedCardState(panelKey);
                updateDetailPanel(panelKey);
                return;
            }
            const tabBtn = event.target.closest('.badge-tab-btn[data-badge-tab]');
            if (tabBtn) {
                const tabName = String(tabBtn.getAttribute('data-badge-tab') || '').trim();
                setActiveTab(tabName === 'coming' ? 'coming' : 'earned');
            }
        });

        document.addEventListener('keydown', (event) => {
            if (event.key === 'Escape' && state.modalEl && !state.modalEl.classList.contains('hidden')) {
                close();
            }
        });
    }

    function setActiveTab(tabName) {
        const nextTab = tabName === 'coming' ? 'coming' : 'earned';
        state.activeTab = nextTab;
        if (!state.renderedTabs[nextTab] && state.payload) {
            renderPanel(nextTab);
            state.renderedTabs[nextTab] = true;
        }
        if (state.tabEarnedBtn) {
            const active = nextTab === 'earned';
            state.tabEarnedBtn.classList.toggle('active', active);
            state.tabEarnedBtn.setAttribute('aria-selected', active ? 'true' : 'false');
        }
        if (state.tabComingBtn) {
            const active = nextTab === 'coming';
            state.tabComingBtn.classList.toggle('active', active);
            state.tabComingBtn.setAttribute('aria-selected', active ? 'true' : 'false');
        }
        if (state.panelEarnedEl) {
            state.panelEarnedEl.classList.toggle('hidden', nextTab !== 'earned');
        }
        if (state.panelComingEl) {
            state.panelComingEl.classList.toggle('hidden', nextTab !== 'coming');
        }
    }

    function getItemsForTab(tabName) {
        if (!state.payload || typeof state.payload !== 'object') {
            return [];
        }
        if (tabName === 'coming') {
            return Array.isArray(state.payload.comingNext) ? state.payload.comingNext : [];
        }
        return Array.isArray(state.payload.earned) ? state.payload.earned : [];
    }

    function buildDetailPanelShellHtml() {
        return `
            <div class="badge-detail-panel badge-fill-global" data-badge-role="detail-panel">
                <div class="badge-detail-art badge-theme-global" data-badge-role="detail-art"></div>
                <div>
                    <div class="badge-detail-title-row">
                        <div class="badge-detail-title" data-badge-role="detail-title"></div>
                        <span class="badge-detail-state" data-badge-role="detail-state"></span>
                    </div>
                    <div class="badge-detail-date" data-badge-role="detail-date"></div>
                    <div class="badge-detail-reason" data-badge-role="detail-reason"></div>
                </div>
            </div>
        `;
    }

    function getDetailState(item, tabName) {
        const isEarned = tabName === 'earned';
        const themeKey = getPaletteKey(item);
        const title = String(item && item.title ? item.title : 'Badge');
        const stateText = isEarned ? 'Earned' : 'Locked';
        const reasonText = isEarned
            ? String(item && item.reasonText ? item.reasonText : item && item.goalText ? item.goalText : '')
            : String(item && item.goalText ? item.goalText : item && item.reasonText ? item.reasonText : '');
        const dateText = isEarned ? formatDate(item && item.awardedAt) : 'Not earned yet';
        return {
            isEarned,
            themeKey,
            title,
            stateText,
            reasonText,
            dateText,
        };
    }

    function buildCardHtml(item, tabName, index, selectedIndex) {
        const themeKey = getPaletteKey(item);
        const cardClasses = ['badge-card', `badge-fill-${themeKey}`];
        if (tabName === 'coming') {
            cardClasses.push('locked');
        }
        if (index === selectedIndex) {
            cardClasses.push('selected');
        }
        return `
            <button
                type="button"
                class="${cardClasses.join(' ')}"
                data-badge-tab="${escapeHtml(tabName)}"
                data-badge-index="${index}"
                title="${escapeHtml(item && item.title ? item.title : 'Badge')}"
            >
                <span class="badge-art badge-theme-${escapeHtml(themeKey)}">${renderBadgeArt(item, themeKey, { conceal: tabName === 'coming' })}</span>
            </button>
        `;
    }

    function updateSelectedCardState(tabName) {
        const panelEl = tabName === 'coming' ? state.panelComingEl : state.panelEarnedEl;
        if (!panelEl) {
            return;
        }
        const currentSelected = panelEl.querySelector('.badge-card.selected');
        if (currentSelected) {
            currentSelected.classList.remove('selected');
        }
        const selectedIndex = Number.parseInt(state.selectedIndexByTab[tabName], 10);
        if (!Number.isInteger(selectedIndex) || selectedIndex < 0) {
            return;
        }
        const nextSelected = panelEl.querySelector(`.badge-card[data-badge-index="${selectedIndex}"]`);
        if (nextSelected) {
            nextSelected.classList.add('selected');
        }
    }

    function updateDetailPanel(tabName) {
        const panelEl = tabName === 'coming' ? state.panelComingEl : state.panelEarnedEl;
        if (!panelEl) {
            return;
        }
        const items = getItemsForTab(tabName);
        if (items.length <= 0) {
            return;
        }
        const detailPanelEl = panelEl.querySelector('[data-badge-role="detail-panel"]');
        if (!detailPanelEl) {
            return;
        }
        const selectedIndexRaw = Number.parseInt(state.selectedIndexByTab[tabName], 10);
        const selectedIndex = Number.isInteger(selectedIndexRaw)
            ? Math.max(0, Math.min(items.length - 1, selectedIndexRaw))
            : 0;
        state.selectedIndexByTab[tabName] = selectedIndex;
        const detail = getDetailState(items[selectedIndex], tabName);
        detailPanelEl.className = `badge-detail-panel badge-fill-${detail.themeKey}`;

        const artEl = detailPanelEl.querySelector('[data-badge-role="detail-art"]');
        if (artEl) {
            artEl.className = `badge-detail-art badge-theme-${detail.themeKey}`;
            artEl.innerHTML = renderBadgeArt(items[selectedIndex], detail.themeKey, { conceal: !detail.isEarned });
        }

        const titleEl = detailPanelEl.querySelector('[data-badge-role="detail-title"]');
        if (titleEl) {
            titleEl.textContent = detail.title;
        }

        const stateEl = detailPanelEl.querySelector('[data-badge-role="detail-state"]');
        if (stateEl) {
            stateEl.className = `badge-detail-state ${detail.isEarned ? 'earned' : 'locked'}`;
            stateEl.textContent = detail.stateText;
        }

        const dateEl = detailPanelEl.querySelector('[data-badge-role="detail-date"]');
        if (dateEl) {
            dateEl.textContent = detail.dateText;
        }

        const reasonEl = detailPanelEl.querySelector('[data-badge-role="detail-reason"]');
        if (reasonEl) {
            reasonEl.textContent = detail.reasonText;
        }
    }

    function renderPanel(tabName) {
        const panelEl = tabName === 'coming' ? state.panelComingEl : state.panelEarnedEl;
        if (!panelEl) {
            return;
        }
        const items = getItemsForTab(tabName);
        if (items.length <= 0) {
            panelEl.innerHTML = `
                <section class="badge-panel-section">
                    <div class="badge-panel-empty">${tabName === 'earned' ? 'No badges earned yet.' : 'No upcoming badges right now.'}</div>
                </section>
            `;
            return;
        }
        const currentSelectedRaw = Number.parseInt(state.selectedIndexByTab[tabName], 10);
        const selectedIndex = Number.isInteger(currentSelectedRaw)
            ? Math.max(0, Math.min(items.length - 1, currentSelectedRaw))
            : 0;
        state.selectedIndexByTab[tabName] = selectedIndex;
        const gridHtml = items
            .map((item, index) => buildCardHtml(item, tabName, index, selectedIndex))
            .join('');
        panelEl.innerHTML = `
            <section class="badge-panel-section">
                ${buildDetailPanelShellHtml()}
                <div class="badge-scroll-area">
                    <div class="badge-grid">${gridHtml}</div>
                </div>
            </section>
        `;
        updateDetailPanel(tabName);
    }

    function renderPayload() {
        const payload = state.payload && typeof state.payload === 'object' ? state.payload : {};
        const kidName = String(state.currentKidName || payload.kidName || 'Kid').trim() || 'Kid';
        if (state.titleEl) {
            state.titleEl.textContent = `${kidName}'s Badges`;
        }
        const trackingEnabled = Boolean(payload.trackingEnabled);
        if (state.subtitleEl) {
            state.subtitleEl.textContent = trackingEnabled
                ? 'Earn badges by practicing.'
                : 'Ask parent to start rewards.';
        }
        const earnedCount = Array.isArray(payload.earned) ? payload.earned.length : 0;
        const comingCount = Array.isArray(payload.comingNext) ? payload.comingNext.length : 0;
        if (state.tabEarnedBtn) {
            state.tabEarnedBtn.textContent = `Earned (${earnedCount})`;
        }
        if (state.tabComingBtn) {
            state.tabComingBtn.textContent = `Next (${comingCount})`;
        }
        renderPanel(state.activeTab);
        state.renderedTabs[state.activeTab] = true;
        setActiveTab(state.activeTab);
    }

    function renderLoading() {
        const loadingHtml = `
            <section class="badge-panel-section">
                <div class="badge-panel-empty">Loading badges...</div>
            </section>
        `;
        if (state.panelEarnedEl) {
            state.panelEarnedEl.innerHTML = loadingHtml;
        }
        if (state.panelComingEl) {
            state.panelComingEl.innerHTML = loadingHtml;
        }
        if (state.tabEarnedBtn) {
            state.tabEarnedBtn.textContent = 'Earned (...)';
        }
        if (state.tabComingBtn) {
            state.tabComingBtn.textContent = 'Next (...)';
        }
    }

    function renderError(errorMessage) {
        const message = String(errorMessage || 'Failed to load badges.');
        const html = `
            <section class="badge-panel-section">
                <div class="badge-panel-empty">${escapeHtml(message)}</div>
            </section>
        `;
        if (state.panelEarnedEl) {
            state.panelEarnedEl.innerHTML = html;
        }
        if (state.panelComingEl) {
            state.panelComingEl.innerHTML = html;
        }
    }

    function buildSummaryFromPayload(payload) {
        const summary = payload && payload.summary ? payload.summary : {};
        return {
            ok: true,
            trackingEnabled: Boolean(payload && payload.trackingEnabled),
            earnedCount: Number(summary.earnedCount || 0),
            comingCount: Number(summary.comingCount || 0),
            pendingCelebrationCount: Number(summary.pendingCelebrationCount || 0),
            payload,
        };
    }

    async function fetchKidBadgePayload({ kidId, apiBase, forceRefresh = false }) {
        const normalizedKidId = String(kidId || '').trim();
        if (!normalizedKidId) {
            throw new Error('kidId is required');
        }
        const base = String(apiBase || state.apiBase || `${window.location.origin}/api`).trim();
        const cacheKey = `${base}::${normalizedKidId}`;
        if (!forceRefresh && payloadCache.has(cacheKey)) {
            return payloadCache.get(cacheKey);
        }
        const response = await fetch(`${base}/kids/${encodeURIComponent(normalizedKidId)}/badges`);
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
            throw new Error(payload.error || `Failed to load badges (HTTP ${response.status})`);
        }
        payloadCache.set(cacheKey, payload);
        summaryCache.set(cacheKey, buildSummaryFromPayload(payload));
        return payload;
    }

    async function fetchKidBadgeSummary({ kidId, apiBase, forceRefresh = false }) {
        const normalizedKidId = String(kidId || '').trim();
        if (!normalizedKidId) {
            throw new Error('kidId is required');
        }
        const base = String(apiBase || state.apiBase || `${window.location.origin}/api`).trim();
        const cacheKey = `${base}::${normalizedKidId}`;
        if (!forceRefresh) {
            if (summaryCache.has(cacheKey)) {
                return summaryCache.get(cacheKey);
            }
            if (payloadCache.has(cacheKey)) {
                const cachedSummary = buildSummaryFromPayload(payloadCache.get(cacheKey));
                summaryCache.set(cacheKey, cachedSummary);
                return cachedSummary;
            }
        }
        const response = await fetch(`${base}/kids/${encodeURIComponent(normalizedKidId)}/badges/summary`);
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
            throw new Error(payload.error || `Failed to load badge summary (HTTP ${response.status})`);
        }
        const summary = buildSummaryFromPayload(payload);
        summaryCache.set(cacheKey, summary);
        return summary;
    }

    function openModal() {
        ensureModalDom();
        if (state.modalEl) {
            state.modalEl.classList.remove('hidden');
        }
    }

    function close() {
        if (state.modalEl) {
            state.modalEl.classList.add('hidden');
        }
    }

    async function open({ kidId, kidName, apiBase, forceRefresh = true } = {}) {
        ensureModalDom();
        state.currentKidId = String(kidId || '').trim();
        state.currentKidName = String(kidName || '').trim();
        if (apiBase) {
            state.apiBase = String(apiBase);
        }
        state.activeTab = 'earned';
        state.renderedTabs.earned = false;
        state.renderedTabs.coming = false;
        state.selectedIndexByTab.earned = 0;
        state.selectedIndexByTab.coming = 0;
        openModal();
        renderLoading();
        try {
            const payload = await fetchKidBadgePayload({
                kidId: state.currentKidId,
                apiBase: state.apiBase,
                forceRefresh,
            });
            state.payload = payload || {};
            renderPayload();
            return state.payload;
        } catch (error) {
            console.error('Error loading badge shelf modal payload:', error);
            state.payload = null;
            renderError(error.message || 'Failed to load badges.');
            return null;
        }
    }

    async function getSummary({ kidId, apiBase, forceRefresh = false } = {}) {
        try {
            return await fetchKidBadgeSummary({ kidId, apiBase, forceRefresh });
        } catch (error) {
            return {
                ok: false,
                trackingEnabled: false,
                earnedCount: 0,
                comingCount: 0,
                pendingCelebrationCount: 0,
                error: error.message || 'Failed to load badges.',
            };
        }
    }

    global.KidBadgeShelfModal = {
        open,
        close,
        getSummary,
        openModal,
        fetchKidBadgePayload,
    };
}(window));
