/*
 * kid-card-manage-stats.js — view-mode toggle and distributions
 *
 * Layout:
 *   1. Cards view-mode toggle + setter
 *   2. Loading spinner
 *   3. Stats view + summary
 *   4. Card-stat accessors + capsule label getter
 *   5. Distribution tab normalizer
 *   6. Distribution histogram builders (accuracy / count / speed / last-seen)
 */

// =====================================================================
// === 1. Cards view-mode toggle + setter
// =====================================================================

function setupCardsViewModeToggle() {
    const buttons = document.querySelectorAll('[data-cards-view-toggle]');
    buttons.forEach((btn) => {
        btn.addEventListener('click', () => {
            const mode = btn.getAttribute('data-cards-view-toggle');
            setCardsViewMode(normalizeCardsViewMode(mode));
        });
    });
    const statsContainer = document.getElementById('cardsStatsView');
    if (statsContainer) {
        const handleBucketActivate = (target) => {
            const tabBtn = target.closest('[data-distribution-tab]');
            if (tabBtn) {
                const next = normalizeDistributionTab(tabBtn.getAttribute('data-distribution-tab'));
                if (next !== currentDistributionTab) {
                    currentDistributionTab = next;
                    try { localStorage.setItem(DISTRIBUTION_TAB_STORAGE_KEY, next); } catch (_err) {}
                    renderStatsView();
                }
                return;
            }
            const clearBtn = target.closest('[data-clear-bucket]');
            if (clearBtn) {
                const key = clearBtn.getAttribute('data-clear-bucket') || '';
                if (key) {
                    selectedBucketByPanel.delete(key);
                    renderStatsView();
                }
                return;
            }
            const slot = target.closest('[data-bucket-index]');
            if (!slot) return;
            const key = slot.getAttribute('data-panel-key') || '';
            const idx = Number.parseInt(slot.getAttribute('data-bucket-index'), 10);
            if (!key || !Number.isInteger(idx)) return;
            const current = selectedBucketByPanel.get(key);
            if (current === idx) {
                selectedBucketByPanel.delete(key);
            } else {
                selectedBucketByPanel.set(key, idx);
            }
            renderStatsView();
        };
        statsContainer.addEventListener('click', (event) => {
            handleBucketActivate(event.target);
        });
        statsContainer.addEventListener('keydown', (event) => {
            if (event.key !== 'Enter' && event.key !== ' ') return;
            const slot = event.target.closest && event.target.closest('[data-bucket-index]');
            if (!slot) return;
            event.preventDefault();
            handleBucketActivate(slot);
        });
    }
    setCardsViewMode(currentCardsViewMode);
}

function setCardsViewMode(mode) {
    const next = normalizeCardsViewMode(mode);
    currentCardsViewMode = next;
    try {
        localStorage.setItem(CARDS_VIEW_MODE_STORAGE_KEY, next);
    } catch (_err) {}
    document.body.classList.toggle('cards-view-mode-queue', next === 'queue');
    document.body.classList.toggle('cards-view-mode-stats', next === 'stats');
    document.querySelectorAll('[data-cards-view-toggle]').forEach((btn) => {
        const isActive = btn.getAttribute('data-cards-view-toggle') === next;
        btn.classList.toggle('active', isActive);
        btn.setAttribute('aria-pressed', isActive ? 'true' : 'false');
    });
    if (next === 'queue' || next === 'stats') {
        if (sharedDeckCardsHaveLoaded) {
            if (next === 'stats') renderStatsView();
        } else {
            renderCardsLoadingSpinner();
            ensureSharedDeckCardsLoaded().catch((error) => {
                console.error('Error loading shared deck cards:', error);
                showError(error.message || 'Failed to load cards.');
                currentCards = [];
                resetAndDisplayCards(currentCards);
            });
        }
    }
}

// =====================================================================
// === 2. Loading spinner
// =====================================================================

function renderCardsLoadingSpinner() {
    const targetId = currentCardsViewMode === 'stats' ? 'cardsStatsView'
        : currentCardsViewMode === 'queue' ? 'cardsGrid'
        : null;
    if (!targetId) return;
    const target = document.getElementById(targetId);
    if (!target) return;
    target.innerHTML = `
        <div class="app-spinner-block" style="grid-column: 1 / -1;" role="status" aria-label="Loading cards">
            <span class="app-spinner" aria-hidden="true"></span>
        </div>
    `;
}

// =====================================================================
// === 3. Stats view + summary
// =====================================================================

function renderStatsView() {
    const container = document.getElementById('cardsStatsView');
    if (!container) return;
    const cards = Array.isArray(currentCards) ? currentCards : [];
    const practiced = cards.filter((card) => getCardPracticeCount(card) > 0);
    const uniqueCount = practiced.length;
    const attemptTotal = practiced.reduce((sum, card) => sum + getCardPracticeCount(card), 0);
    if (!practiced.length) {
        container.innerHTML = `
            ${renderStatsSummary(uniqueCount, attemptTotal)}
            <div class="cards-view-placeholder">Practice a few cards to unlock card distributions.</div>
        `;
        return;
    }
    const getCardCapsuleLabel = makeCardCapsuleLabelGetter();
    const getCardHref = (cardId) => {
        const qs = new URLSearchParams();
        qs.set('id', String(kidId || ''));
        qs.set('cardId', String(cardId || ''));
        if (categoryKey) qs.set('categoryKey', categoryKey);
        const from = currentSharedScope === SHARED_SCOPE_LESSON_READING
            ? 'lesson-reading'
            : (currentSharedScope === SHARED_SCOPE_TYPE2 ? 'type2' : 'cards');
        qs.set('from', from);
        return `/kid-card-report.html?${qs.toString()}`;
    };
    const tabDefs = [
        { key: 'accuracy', label: 'Correct Rate', build: () => buildAccuracyDistribution(practiced, getCardCapsuleLabel, getCardHref) },
        { key: 'counts', label: 'Practice Count', build: () => buildPracticeCountDistribution(practiced, getCardCapsuleLabel, getCardHref) },
        { key: 'speed', label: 'Avg Speed', build: () => buildSpeedDistribution(practiced, getCardCapsuleLabel, getCardHref) },
        { key: 'ema', label: 'EMA Speed', build: () => buildEmaSpeedDistribution(practiced, getCardCapsuleLabel, getCardHref) },
        { key: 'recency', label: 'Last Seen', build: () => buildLastSeenDistribution(practiced, getCardCapsuleLabel, getCardHref) },
    ];
    const activeTabKey = normalizeDistributionTab(currentDistributionTab);
    const activeTab = tabDefs.find((t) => t.key === activeTabKey) || tabDefs[0];
    const tabsHtml = tabDefs.map((t) => {
        const active = t.key === activeTab.key ? ' active' : '';
        return `<button type="button" class="cards-distribution-tab${active}" data-distribution-tab="${t.key}" aria-pressed="${active ? 'true' : 'false'}">${escapeHtml(t.label)}</button>`;
    }).join('');
    container.innerHTML = `
        ${renderStatsSummary(uniqueCount, attemptTotal)}
        <div class="cards-distribution-card distribution-card">
            <h2 class="paradigm-panel-title"><span class="paradigm-panel-title-icon">${(typeof window !== 'undefined' && typeof window.ICON_PATHS === 'object' && window.ICON_PATHS['layout-grid']) ? `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#6366f1" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${window.ICON_PATHS['layout-grid']}</svg>` : ''}</span><span class="paradigm-panel-heading">Distribution</span></h2>
            <div class="cards-distribution-tabs" role="tablist">${tabsHtml}</div>
            <div class="distribution-card-body">
                ${renderDistributionPanel(activeTab.build())}
            </div>
        </div>
    `;
}

function renderStatsSummary(uniqueCount, attemptTotal) {
    const iconSvg = (name) => (typeof window !== 'undefined' && typeof window.icon === 'function')
        ? window.icon(name, { strokeWidth: 2, className: '' })
        : '';
    const tile = (iconColor, iconName, label, value) => `
        <div class="summary-stat-card">
            <div class="summary-stat-icon summary-stat-icon-${iconColor}" aria-hidden="true">${iconSvg(iconName)}</div>
            <div class="summary-stat-body">
                <div class="summary-stat-label">${escapeHtml(label)}</div>
                <div class="summary-stat-value summary-stat-value-${iconColor}">${escapeHtml(String(value))}</div>
            </div>
        </div>
    `;
    return `
        <div class="summary-stats-row">
            ${tile('purple', 'check', 'Practiced Cards', uniqueCount)}
            ${tile('green', 'bar-chart-3', 'Practiced Counts', attemptTotal)}
        </div>
    `;
}

// =====================================================================
// === 4. Card-stat accessors + capsule label getter
// =====================================================================

function getCardPracticeCount(card) {
    const attempts = Number.parseInt(card?.lifetime_attempts, 10);
    return Number.isInteger(attempts) ? Math.max(0, attempts) : 0;
}

function getCardCorrectRatePct(card) {
    if (getCardPracticeCount(card) <= 0) return null;
    const wrongRate = Number(card?.overall_wrong_rate);
    if (!Number.isFinite(wrongRate)) return null;
    return Math.max(0, Math.min(100, 100 - wrongRate));
}

function getCardAverageSpeedMs(card) {
    if (getCardPracticeCount(card) <= 0) return null;
    const avgMs = Number(card?.practice_priority_avg_correct_response_time);
    if (Number.isFinite(avgMs) && avgMs > 0) return avgMs;
    return null;
}

function getCardEmaSpeedMs(card) {
    if (getCardPracticeCount(card) <= 0) return null;
    const emaMs = Number(card?.practice_priority_correct_time_ema);
    if (Number.isFinite(emaMs) && emaMs > 0) return emaMs;
    return null;
}

function getCardDaysSinceLastSeen(card) {
    if (getCardPracticeCount(card) <= 0) return null;
    const seenAt = card?.last_seen_at;
    if (!seenAt) return null;
    const seenMs = new Date(seenAt).getTime();
    if (!Number.isFinite(seenMs)) return null;
    const dayDiff = Math.floor((Date.now() - seenMs) / (24 * 60 * 60 * 1000));
    return Math.max(0, dayDiff);
}

function makeCardCapsuleLabelGetter() {
    return (card) => {
        const front = String(card?.front || '').trim();
        const back = String(card?.back || '').trim();
        return front || back;
    };
}

const selectedBucketByPanel = new Map();
// =====================================================================
// === 5. Distribution tab normalizer
// =====================================================================

const DISTRIBUTION_TAB_STORAGE_KEY = 'kidCardManage.distributionTab';
const DISTRIBUTION_TAB_KEYS = ['accuracy', 'counts', 'speed', 'ema', 'recency'];
function normalizeDistributionTab(value) {
    return DISTRIBUTION_TAB_KEYS.includes(value) ? value : 'accuracy';
}
let currentDistributionTab = (() => {
    try {
        return normalizeDistributionTab(localStorage.getItem(DISTRIBUTION_TAB_STORAGE_KEY));
    } catch (_err) {
        return 'accuracy';
    }
})();

// =====================================================================
// === 6. Distribution histogram builders (accuracy / count / speed / last-seen)
// =====================================================================

function buildAccuracyDistribution(cards, getCardCapsuleLabel, getCardHref) {
    const panelKey = 'accuracy';
    return buildHistogramDistribution({
        panelKey,
        selectedBucketIndex: selectedBucketByPanel.get(panelKey),
        title: 'Correct Rate',
        tone: 'accuracy',
        formatValue: formatPercentLabel,
        getValue: getCardCorrectRatePct,
        getCardCapsuleLabel,
        getCardHref,
        percentileMarkers: [10, 95],
        bucketing: {
            snapUnit: 1,
            minClamp: 0,
            maxClamp: 100,
            formatRange: (min, max) => `${formatBoundaryNumber(min)}–${formatBoundaryNumber(max)}%`,
        },
        topLists: [
            { title: 'Highest 5', mode: 'highest', count: 5 },
            { title: 'Lowest 5', mode: 'lowest', count: 5 },
        ],
        cards,
    });
}

function buildPracticeCountDistribution(cards, getCardCapsuleLabel, getCardHref) {
    const panelKey = 'counts';
    return buildHistogramDistribution({
        panelKey,
        selectedBucketIndex: selectedBucketByPanel.get(panelKey),
        title: 'Practice Count',
        tone: 'counts',
        formatValue: formatCountLabel,
        getValue: getCardPracticeCount,
        getCardCapsuleLabel,
        getCardHref,
        bucketing: {
            snapUnit: 1,
            minClamp: 1,
            isInteger: true,
            formatRange: formatIntegerCaptureRange,
        },
        topLists: [
            { title: 'Top 5', mode: 'highest', count: 5 },
            { title: 'Bottom 5', mode: 'lowest', count: 5 },
        ],
        cards,
    });
}

function buildSpeedDistribution(cards, getCardCapsuleLabel, getCardHref) {
    const panelKey = 'speed';
    return buildHistogramDistribution({
        panelKey,
        selectedBucketIndex: selectedBucketByPanel.get(panelKey),
        title: 'Avg Speed',
        tone: 'speed',
        formatValue: formatSpeedLabel,
        getValue: getCardAverageSpeedMs,
        getCardCapsuleLabel,
        getCardHref,
        bucketing: {
            snapUnit: 1000,
            minClamp: 0,
            anchorLo: 'dataMin',
            formatRange: (min, max) => `${formatBoundarySeconds(min)}–${formatBoundarySeconds(max)}s`,
        },
        topLists: [
            { title: 'Slowest 5', mode: 'highest', count: 5 },
            { title: 'Fastest 5', mode: 'lowest', count: 5 },
        ],
        cards,
    });
}

function buildEmaSpeedDistribution(cards, getCardCapsuleLabel, getCardHref) {
    const panelKey = 'ema';
    return buildHistogramDistribution({
        panelKey,
        selectedBucketIndex: selectedBucketByPanel.get(panelKey),
        title: 'EMA Speed',
        tone: 'speed',
        formatValue: formatSpeedLabel,
        getValue: getCardEmaSpeedMs,
        getCardCapsuleLabel,
        getCardHref,
        bucketing: {
            snapUnit: 1000,
            minClamp: 0,
            anchorLo: 'dataMin',
            formatRange: (min, max) => `${formatBoundarySeconds(min)}–${formatBoundarySeconds(max)}s`,
        },
        topLists: [
            { title: 'Slowest 5', mode: 'highest', count: 5 },
            { title: 'Fastest 5', mode: 'lowest', count: 5 },
        ],
        cards,
    });
}

function buildLastSeenDistribution(cards, getCardCapsuleLabel, getCardHref) {
    const panelKey = 'recency';
    return buildHistogramDistribution({
        panelKey,
        selectedBucketIndex: selectedBucketByPanel.get(panelKey),
        title: 'Days Since Last Seen',
        tone: 'recency',
        formatValue: formatDaysLabel,
        getValue: getCardDaysSinceLastSeen,
        getCardCapsuleLabel,
        getCardHref,
        bucketing: {
            snapUnit: 1,
            minClamp: 0,
            isInteger: true,
            anchorLo: 'dataMin',
            formatRange: formatIntegerCaptureRange,
        },
        topLists: [
            { title: 'Stalest 5', mode: 'highest', count: 5 },
            { title: 'Freshest 5', mode: 'lowest', count: 5 },
        ],
        cards,
    });
}
