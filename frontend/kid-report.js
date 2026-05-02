const API_BASE = `${window.location.origin}/api`;

const params = new URLSearchParams(window.location.search);
const kidId = params.get('id');
const from = String(params.get('from') || '').trim().toLowerCase();

const reportTitle = document.getElementById('reportTitle');
const backBtn = document.getElementById('backBtn');
const errorMessage = document.getElementById('errorMessage');
const summaryGrid = document.getElementById('summaryGrid');
const reportCategoryFilter = document.getElementById('reportCategoryFilter');
const dailyChartBody = document.getElementById('dailyChartBody');
const dailyChartNewerBtn = document.getElementById('dailyChartNewerBtn');
const dailyChartOlderBtn = document.getElementById('dailyChartOlderBtn');
const dailyChartPageLabel = document.getElementById('dailyChartPageLabel');
const dailyChartLegend = document.getElementById('dailyChartLegend');
const sessionsList = document.getElementById('sessionsList');
const reportSessionsView = document.getElementById('reportSessionsView');
const reportCardsView = document.getElementById('reportCardsView');
const cardsViewBody = document.getElementById('cardsViewBody');
const collapsedDayKeys = new Set();
let reportTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
let dailyChartRows = [];
let dailyChartCategories = [];
let dailyChartPageIndex = 0;
let reportSessions = [];
let filteredSessions = [];
let selectedCategoryKey = '';
let selectedReportView = 'sessions';
let reportCategoryThemeByKey = new Map();
const cardsViewCacheByCategoryKey = new Map();
const DAILY_CHART_PAGE_SIZE = 7;
const CATEGORY_COLOR_PALETTE = [
    { bar: '#3b82f6', pillBg: '#e8f1ff', pillText: '#1e4f9f' }, // blue
    { bar: '#f59e0b', pillBg: '#fff4de', pillText: '#9a5b00' }, // orange
    { bar: '#10b981', pillBg: '#e6faf3', pillText: '#0d6b57' }, // green
    { bar: '#8b5cf6', pillBg: '#efe8ff', pillText: '#5a3aa6' }, // purple
    { bar: '#ef4444', pillBg: '#fdecec', pillText: '#a33131' }, // red
    { bar: '#06b6d4', pillBg: '#e7fafd', pillText: '#0a6c83' }, // cyan
    { bar: '#84cc16', pillBg: '#f1fadf', pillText: '#4e7d08' }, // lime
    { bar: '#ec4899', pillBg: '#fdeaf3', pillText: '#9c2d63' }, // pink
    { bar: '#6366f1', pillBg: '#ececff', pillText: '#4043a3' }, // indigo
    { bar: '#f97316', pillBg: '#fff0e5', pillText: '#a34a0d' }, // deep orange
    { bar: '#14b8a6', pillBg: '#e5fbf8', pillText: '#0b6b62' }, // teal
    { bar: '#a855f7', pillBg: '#f4eaff', pillText: '#6f33aa' }, // violet
];
const DEFAULT_CATEGORY_COLOR_THEME = CATEGORY_COLOR_PALETTE[0];
const {
    normalizeCategoryKey,
    normalizeBehaviorType,
} = window.DeckCategoryCommon;

document.addEventListener('DOMContentLoaded', async () => {
    if (!kidId) {
        window.location.href = '/admin.html';
        return;
    }
    renderInitialLoadingState();
    if (backBtn) {
        backBtn.href = from === 'kid-home'
            ? `/kid-practice-home.html?id=${encodeURIComponent(kidId)}`
            : '/admin.html';
    }
    if (dailyChartNewerBtn) {
        dailyChartNewerBtn.addEventListener('click', () => {
            if (dailyChartPageIndex <= 0) return;
            dailyChartPageIndex -= 1;
            renderDailyMinutesChartPage();
            renderSessionsList();
        });
    }
    if (dailyChartOlderBtn) {
        dailyChartOlderBtn.addEventListener('click', () => {
            const pageCount = getDatePageCount(dailyChartRows, (row) => String(row?.date || ''), DAILY_CHART_PAGE_SIZE);
            if (dailyChartPageIndex >= (pageCount - 1)) return;
            dailyChartPageIndex += 1;
            renderDailyMinutesChartPage();
            renderSessionsList();
        });
    }
    if (sessionsList) {
        sessionsList.addEventListener('click', (event) => {
            const toggle = event.target.closest('.day-group-toggle');
            if (!toggle) return;
            event.preventDefault();
            const group = toggle.closest('.day-group');
            if (!group) return;
            const dayKey = group.getAttribute('data-day-key') || '';
            if (group.classList.toggle('collapsed')) {
                collapsedDayKeys.add(dayKey);
            } else {
                collapsedDayKeys.delete(dayKey);
            }
        });
    }
    await loadReport();
});

function renderInitialLoadingState() {
    if (dailyChartPageLabel) {
        dailyChartPageLabel.textContent = 'Loading kid records...';
    }
    if (dailyChartLegend) {
        dailyChartLegend.innerHTML = '';
        dailyChartLegend.style.display = 'none';
    }
    if (dailyChartBody) {
        dailyChartBody.innerHTML = '<div class="daily-chart-status">Loading kid records...</div>';
    }
    if (sessionsList) {
        sessionsList.innerHTML = '<div class="sessions-empty">Loading kid records...</div>';
    }
    if (cardsViewBody) {
        cardsViewBody.innerHTML = '<div class="cards-view-placeholder">Select a category to view card distributions.</div>';
    }
    if (dailyChartNewerBtn) {
        dailyChartNewerBtn.disabled = true;
    }
    if (dailyChartOlderBtn) {
        dailyChartOlderBtn.disabled = true;
    }
}

async function loadReport() {
    try {
        showError('');
        const response = await fetch(`${API_BASE}/kids/${kidId}/report`);
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }
        const data = await response.json();
        const familyTimezone = String(data.family_timezone || '').trim();
        if (familyTimezone) {
            reportTimezone = familyTimezone;
        }
        const kidName = (data.kid && data.kid.name) ? data.kid.name : 'Kid';
        const sessions = Array.isArray(data.sessions) ? data.sessions : [];
        reportSessions = sessions;
        reportCategoryThemeByKey = buildCategoryThemeByKey(sessions);
        seedCollapsedDays(sessions);
        reportTitle.textContent = `${kidName}'s Practice Report`;
        document.title = `${kidName} - Practice Report - Kids Daily Chores`;
        renderCategoryFilter(sessions);
        renderFilteredViews();
    } catch (error) {
        console.error('Error loading report:', error);
        showError('Failed to load practice report.');
        document.title = 'Kid Practice Report - Kids Daily Chores';
    }
}

function renderSummary(sessions) {
    const totals = summarizeSessions(sessions);
    const showCardsToggle = Boolean(selectedCategoryKey);
    const summaryCards = [{
        key: 'sessions',
        title: 'Sessions',
        metrics: [
            { label: 'Total Sessions', value: String(totals.count) },
            { label: 'Active Minutes', value: totals.activeMinutes.toFixed(1) },
        ],
    }];
    if (showCardsToggle) {
        summaryCards.push({
            key: 'cards',
            title: 'Cards',
            metrics: [
                { label: 'Practiced Cards', value: String(totals.uniqueCards) },
                { label: 'Practiced Counts', value: String(totals.practicedCards) },
            ],
        });
    }
    summaryGrid.innerHTML = `
        <div class="summary-toggle-group${showCardsToggle ? '' : ' summary-toggle-group-single'}" role="tablist" aria-label="Report views">
            ${summaryCards.map((card) => renderSummaryToggleCard(card)).join('')}
        </div>
    `;
    summaryGrid.querySelectorAll('.summary-toggle-card').forEach((btn) => {
        btn.addEventListener('click', () => {
            setSelectedReportView(btn.getAttribute('data-report-view') || 'sessions');
        });
    });
}

function renderSummaryToggleCard(card) {
    const isActive = card?.key === selectedReportView;
    const metrics = Array.isArray(card?.metrics) ? card.metrics : [];
    const viewKey = String(card?.key || 'sessions');
    const controlsId = viewKey === 'cards' ? 'reportCardsView' : 'reportSessionsView';
    return `
        <button
            type="button"
            class="summary-toggle-card${isActive ? ' active' : ''}"
            data-report-view="${escapeHtml(viewKey)}"
            aria-pressed="${isActive ? 'true' : 'false'}"
            aria-controls="${escapeHtml(controlsId)}"
        >
            <div class="summary-toggle-card-title">${escapeHtml(String(card?.title || ''))}</div>
            <div class="summary-toggle-metrics">
                ${metrics.map((metric) => `
                    <div class="summary-toggle-metric">
                        <div class="summary-toggle-metric-label">${escapeHtml(String(metric?.label || ''))}</div>
                        <div class="summary-toggle-metric-value">${escapeHtml(String(metric?.value || '0'))}</div>
                    </div>
                `).join('')}
            </div>
        </button>
    `;
}

function seedCollapsedDays(sessions) {
    const todayKey = formatDateKey(new Date().toISOString());
    collapsedDayKeys.clear();
    for (const session of (Array.isArray(sessions) ? sessions : [])) {
        const dayKey = getSessionDateKey(session);
        if (dayKey && dayKey !== todayKey) {
            collapsedDayKeys.add(dayKey);
        }
    }
}

function getFilteredSessions() {
    const sessions = Array.isArray(reportSessions) ? reportSessions : [];
    if (!selectedCategoryKey) {
        return sessions;
    }
    return sessions.filter((session) => normalizeCategoryKey(session?.type) === selectedCategoryKey);
}

function renderFilteredViews() {
    const filtered = getFilteredSessions();
    filteredSessions = filtered;
    if (!selectedCategoryKey && selectedReportView === 'cards') {
        selectedReportView = 'sessions';
    }
    renderSummary(filtered);
    renderDailyMinutesChart(filtered);
    renderCardsView(filtered);
    renderReportView();
    renderSessionsList();
}

function setSelectedReportView(nextView) {
    const normalizedView = nextView === 'cards' ? 'cards' : 'sessions';
    if (selectedReportView === normalizedView) {
        return;
    }
    selectedReportView = normalizedView;
    renderSummary(filteredSessions);
    if (selectedReportView === 'cards') {
        renderCardsView(filteredSessions);
    }
    renderReportView();
}

function renderReportView() {
    const cardsViewAvailable = Boolean(selectedCategoryKey);
    const showSessionsView = !cardsViewAvailable || selectedReportView !== 'cards';
    if (reportSessionsView) {
        reportSessionsView.classList.toggle('hidden', !showSessionsView);
    }
    if (reportCardsView) {
        reportCardsView.classList.toggle('hidden', showSessionsView || !cardsViewAvailable);
    }
}

function renderCardsView(sessions) {
    if (!cardsViewBody) {
        return;
    }
    const categoryKey = normalizeCategoryKey(selectedCategoryKey);
    if (!categoryKey) {
        cardsViewBody.innerHTML = '<div class="cards-view-placeholder">Select a category to view card distributions.</div>';
        return;
    }
    const behaviorType = getSelectedCategoryBehaviorType(categoryKey, sessions);
    const categoryLabel = getSelectedCategoryDisplayName(categoryKey, sessions);
    if (!behaviorType) {
        cardsViewBody.innerHTML = '<div class="cards-view-placeholder">Card distributions are unavailable for this category.</div>';
        return;
    }
    const cacheEntry = cardsViewCacheByCategoryKey.get(categoryKey);
    if (!cacheEntry) {
        cardsViewBody.innerHTML = selectedReportView === 'cards'
            ? '<div class="cards-view-placeholder">Loading card distributions...</div>'
            : '<div class="cards-view-placeholder">Open Cards to view card distributions.</div>';
        if (selectedReportView === 'cards') {
            void ensureCardsViewDataLoaded(categoryKey, behaviorType, sessions);
        }
        return;
    }
    if (cacheEntry.status === 'loading') {
        cardsViewBody.innerHTML = '<div class="cards-view-placeholder">Loading card distributions...</div>';
        return;
    }
    if (cacheEntry.status === 'error') {
        cardsViewBody.innerHTML = `
            <div class="cards-view-placeholder">
                Failed to load card distributions.
                <button type="button" class="cards-view-retry-btn" data-category-key="${escapeHtml(categoryKey)}">Retry</button>
            </div>
        `;
        const retryBtn = cardsViewBody.querySelector('.cards-view-retry-btn');
        if (retryBtn) {
            retryBtn.addEventListener('click', () => {
                cardsViewCacheByCategoryKey.delete(categoryKey);
                void ensureCardsViewDataLoaded(categoryKey, behaviorType, sessions, true);
            });
        }
        return;
    }
    renderCardsDistributionView(cacheEntry.cards, behaviorType, cacheEntry.dailyProgressRows, cacheEntry.familyTimezone);
}

async function ensureCardsViewDataLoaded(categoryKey, behaviorType, sessions, forceReload = false) {
    const key = normalizeCategoryKey(categoryKey);
    const normalizedBehaviorType = normalizeBehaviorType(behaviorType);
    if (!key || !normalizedBehaviorType) {
        return;
    }
    const existing = cardsViewCacheByCategoryKey.get(key);
    if (!forceReload && existing && (existing.status === 'loading' || existing.status === 'ready')) {
        return;
    }
    cardsViewCacheByCategoryKey.set(key, { status: 'loading', cards: [], dailyProgressRows: [], familyTimezone: '' });
    if (normalizeCategoryKey(selectedCategoryKey) === key && selectedReportView === 'cards') {
        renderCardsView(sessions);
    }
    try {
        const [cardsResp, dailyResp] = await Promise.all([
            fetch(buildCardsViewApiUrl(key, normalizedBehaviorType)),
            fetch(buildDailyProgressApiUrl(key)),
        ]);
        const cardsData = await cardsResp.json().catch(() => ({}));
        if (!cardsResp.ok) {
            throw new Error(cardsData.error || `Failed to load cards (HTTP ${cardsResp.status})`);
        }
        const dailyData = await dailyResp.json().catch(() => ({}));
        if (!dailyResp.ok) {
            throw new Error(dailyData.error || `Failed to load daily progress (HTTP ${dailyResp.status})`);
        }
        const cards = Array.isArray(cardsData.cards) ? cardsData.cards : [];
        const dailyProgressRows = Array.isArray(dailyData.rows) ? dailyData.rows : [];
        const familyTimezone = String(dailyData.family_timezone || '').trim();
        cardsViewCacheByCategoryKey.set(key, {
            status: 'ready',
            cards,
            dailyProgressRows,
            familyTimezone,
        });
    } catch (error) {
        console.error('Error loading cards view data:', error);
        cardsViewCacheByCategoryKey.set(key, {
            status: 'error',
            cards: [],
            dailyProgressRows: [],
            familyTimezone: '',
        });
    }
    if (normalizeCategoryKey(selectedCategoryKey) === key && selectedReportView === 'cards') {
        renderCardsView(filteredSessions);
    }
}

function buildDailyProgressApiUrl(categoryKey) {
    const url = new URL(`${API_BASE}/kids/${encodeURIComponent(kidId)}/report/cards/daily-progress`);
    url.searchParams.set('categoryKey', String(categoryKey || ''));
    return url.toString();
}

function buildCardsViewApiUrl(categoryKey, behaviorType) {
    const baseUrl = window.DeckCategoryCommon.buildKidScopedApiUrl({
        kidId,
        scope: getCardsViewScopeForBehaviorType(behaviorType),
        path: '/shared-decks/cards',
        categoryKey,
        apiBase: API_BASE,
    });
    const url = new URL(baseUrl);
    url.searchParams.set('includePracticedFromOther', '1');
    return url.toString();
}

function getCardsViewScopeForBehaviorType(behaviorType) {
    const normalized = normalizeBehaviorType(behaviorType);
    if (normalized === 'type_ii') {
        return 'type2';
    }
    if (normalized === 'type_iii') {
        return 'lesson-reading';
    }
    if (normalized === 'type_iv') {
        return 'type4';
    }
    return 'cards';
}

function getSelectedCategoryBehaviorType(categoryKey, sessions) {
    const key = normalizeCategoryKey(categoryKey);
    const combined = [
        ...(Array.isArray(sessions) ? sessions : []),
        ...(Array.isArray(reportSessions) ? reportSessions : []),
    ];
    for (const session of combined) {
        if (normalizeCategoryKey(session?.type) !== key) {
            continue;
        }
        const behaviorType = normalizeBehaviorType(session?.behavior_type);
        if (behaviorType) {
            return behaviorType;
        }
    }
    return '';
}

function getSelectedCategoryDisplayName(categoryKey, sessions) {
    const key = normalizeCategoryKey(categoryKey);
    const combined = [
        ...(Array.isArray(sessions) ? sessions : []),
        ...(Array.isArray(reportSessions) ? reportSessions : []),
    ];
    for (const session of combined) {
        if (normalizeCategoryKey(session?.type) !== key) {
            continue;
        }
        const label = String(session?.category_display_name || '').trim();
        if (label) {
            return label;
        }
    }
    return key || 'Cards';
}

function renderCardsDistributionView(cards, behaviorType, dailyProgressRows, familyTimezone) {
    const list = Array.isArray(cards) ? cards : [];
    const practicedCards = list.filter((card) => getCardPracticeCount(card) > 0);
    if (!practicedCards.length) {
        cardsViewBody.innerHTML = `
            <div class="cards-view-placeholder">Practice a few cards to unlock card distributions.</div>
        `;
        return;
    }
    const getCardCapsuleLabel = makeCardCapsuleLabelGetter(behaviorType);
    const panels = [
        buildAccuracyDistribution(practicedCards, getCardCapsuleLabel),
        buildPracticeCountDistribution(practicedCards, getCardCapsuleLabel),
        buildSpeedDistribution(practicedCards, getCardCapsuleLabel),
        buildLastSeenDistribution(practicedCards, getCardCapsuleLabel),
    ];
    const dailyProgress = buildDailyProgressChart(dailyProgressRows, familyTimezone);
    cardsViewBody.innerHTML = `
        ${dailyProgress ? renderDailyProgressPanel(dailyProgress) : ''}
        <div class="cards-distribution-grid">
            ${panels.map((panel) => renderDistributionPanel(panel)).join('')}
        </div>
    `;
}

function renderDistributionPanel(panel) {
    const bars = Array.isArray(panel?.bars) ? panel.bars : [];
    const percentiles = Array.isArray(panel?.percentiles) ? panel.percentiles : [];
    const toneClass = String(panel?.tone || '').trim();
    const tickValues = Array.isArray(panel?.tickValues) ? panel.tickValues : [];
    const yMax = Number(panel?.yMax) || 0;
    if (!bars.length || panel?.emptyMessage) {
        return `
            <div class="cards-distribution-card">
                <div class="cards-distribution-card-head">
                    <div class="cards-distribution-card-title">${escapeHtml(String(panel?.title || ''))}</div>
                </div>
                <div class="cards-view-placeholder">${escapeHtml(String(panel?.emptyMessage || 'No data yet.'))}</div>
            </div>
        `;
    }
    const topLists = Array.isArray(panel?.topLists) ? panel.topLists : [];
    return `
        <div class="cards-distribution-card">
            <div class="cards-distribution-card-head">
                <div class="cards-distribution-card-title">${escapeHtml(String(panel?.title || ''))}</div>
            </div>
            <div class="cards-distribution-body">
                <div class="cards-distribution-chart">
                    <div class="cards-distribution-y-label">${escapeHtml(String(panel?.yAxisLabel || 'Cards'))}</div>
                    <div class="cards-distribution-y-axis">
                        ${tickValues.map((tickValue) => `
                            <div class="cards-distribution-y-tick" style="bottom:${getHistogramVerticalPositionPct(tickValue, yMax).toFixed(2)}%">
                                ${escapeHtml(formatCompactCountLabel(tickValue))}
                            </div>
                        `).join('')}
                    </div>
                    <div class="cards-distribution-grid-layer">
                        ${tickValues.map((tickValue) => `
                            <div class="cards-distribution-grid-line" style="bottom:${getHistogramVerticalPositionPct(tickValue, yMax).toFixed(2)}%"></div>
                        `).join('')}
                    </div>
                    <div class="cards-distribution-marker-layer">
                        ${percentiles.map((marker) => `
                            <div class="cards-distribution-marker ${escapeHtml(String(marker?.className || ''))}" style="left:${Math.max(0, Math.min(100, Number(marker?.positionPct) || 0)).toFixed(2)}%">
                                <div class="cards-distribution-marker-badge">
                                    <div class="cards-distribution-marker-name">${escapeHtml(String(marker?.label || ''))}</div>
                                    <div class="cards-distribution-marker-value">${escapeHtml(String(marker?.valueLabel || ''))}</div>
                                </div>
                                <div class="cards-distribution-marker-line"></div>
                            </div>
                        `).join('')}
                    </div>
                    <div class="cards-distribution-bars" style="grid-template-columns: repeat(${bars.length}, minmax(0, 1fr));">
                        ${bars.map((bar) => {
                            const count = Math.max(0, Number(bar?.count) || 0);
                            const heightPct = yMax > 0 ? (count / yMax) * 100 : 0;
                            return `
                                <div class="cards-distribution-bar-slot">
                                    <div class="cards-distribution-bar-stack">
                                        <div class="cards-distribution-bar-count">${escapeHtml(formatCompactCountLabel(count))}</div>
                                        <div class="cards-distribution-bar ${escapeHtml(toneClass)}" style="height:${Math.max(0, Math.min(100, heightPct)).toFixed(2)}%"></div>
                                    </div>
                                    <div class="cards-distribution-bar-label">${escapeHtml(String(bar?.label || ''))}</div>
                                </div>
                            `;
                        }).join('')}
                    </div>
                    <div class="cards-distribution-baseline"></div>
                </div>
                ${topLists.length ? `
                    <div class="cards-distribution-sidebar">
                        ${topLists.map((list) => `
                            <div class="cards-distribution-toplist">
                                <div class="cards-distribution-toplist-title">${escapeHtml(String(list?.title || ''))}</div>
                                <ol class="cards-distribution-toplist-items">
                                    ${(Array.isArray(list?.entries) ? list.entries : []).map((entry) => {
                                        const href = buildDistributionCardReportHref(entry?.cardId);
                                        const tag = href ? 'a' : 'span';
                                        const hrefAttr = href ? ` href="${escapeHtml(href)}"` : '';
                                        return `
                                        <li class="cards-distribution-toplist-row">
                                            <${tag} class="cards-distribution-toplist-item"${hrefAttr}>
                                                <span class="cards-distribution-toplist-front">${escapeHtml(String(entry?.front || ''))}</span>
                                                <span class="cards-distribution-toplist-value">${escapeHtml(String(entry?.valueLabel || ''))}</span>
                                            </${tag}>
                                        </li>
                                    `;
                                    }).join('')}
                                </ol>
                            </div>
                        `).join('')}
                    </div>
                ` : ''}
            </div>
        </div>
    `;
}

function makeCardCapsuleLabelGetter(behaviorType) {
    const normalized = normalizeBehaviorType(behaviorType);
    return (card) => {
        const front = String(card?.front || '').trim();
        const back = String(card?.back || '').trim();
        if (normalized === 'type_ii') {
            return back || front;
        }
        return front || back;
    };
}

function buildAccuracyDistribution(cards, getCardCapsuleLabel) {
    return buildHistogramDistribution({
        title: 'Correct Rate',
        tone: 'accuracy',
        formatValue: formatPercentLabel,
        getValue: getCardCorrectRatePct,
        getCardCapsuleLabel,
        percentileMarkers: [10, 90],
        bucketing: {
            snapUnit: 1,
            minClamp: 0,
            maxClamp: 100,
            formatRange: (min, max) => `${formatBoundaryNumber(min)}–${formatBoundaryNumber(max)}%`,
        },
        topLists: [
            { title: 'Lowest 5', mode: 'lowest', count: 5 },
        ],
        cards,
    });
}

function buildPracticeCountDistribution(cards, getCardCapsuleLabel) {
    return buildHistogramDistribution({
        title: 'Practice Count',
        tone: 'counts',
        formatValue: formatCountLabel,
        getValue: getCardPracticeCount,
        getCardCapsuleLabel,
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

function buildSpeedDistribution(cards, getCardCapsuleLabel) {
    return buildHistogramDistribution({
        title: 'Average Speed',
        tone: 'speed',
        formatValue: formatSpeedLabel,
        getValue: getCardAverageSpeedMs,
        getCardCapsuleLabel,
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

function buildLastSeenDistribution(cards, getCardCapsuleLabel) {
    return buildHistogramDistribution({
        title: 'Days Since Last Seen',
        tone: 'recency',
        formatValue: formatDaysLabel,
        getValue: getCardDaysSinceLastSeen,
        getCardCapsuleLabel,
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

function buildDailyProgressChart(dailyProgressRows, familyTimezone) {
    const rows = Array.isArray(dailyProgressRows) ? dailyProgressRows : [];
    const validRows = [];
    for (const row of rows) {
        const cardId = Number(row?.card_id);
        const date = String(row?.date || '').trim();
        const attempts = Math.max(0, Number.parseInt(row?.attempts, 10) || 0);
        const correct = Math.max(0, Number.parseInt(row?.correct, 10) || 0);
        const rtSum = Math.max(0, Number.parseInt(row?.correct_response_time_ms_sum, 10) || 0);
        const rtCount = Math.max(0, Number.parseInt(row?.correct_response_time_count, 10) || 0);
        if (!Number.isFinite(cardId) || cardId <= 0 || !date || attempts <= 0) {
            continue;
        }
        validRows.push({ cardId, date, attempts, correct, rtSum, rtCount });
    }
    if (!validRows.length) {
        return null;
    }
    const rowsByDate = new Map();
    for (const row of validRows) {
        if (!rowsByDate.has(row.date)) {
            rowsByDate.set(row.date, []);
        }
        rowsByDate.get(row.date).push(row);
    }
    const sortedDates = Array.from(rowsByDate.keys()).sort();
    const firstDate = sortedDates[0];
    const lastDate = sortedDates[sortedDates.length - 1];
    const startEpoch = parseDateKeyToEpochUtc(firstDate);
    const lastDataEpoch = parseDateKeyToEpochUtc(lastDate);
    if (!Number.isFinite(startEpoch) || !Number.isFinite(lastDataEpoch) || lastDataEpoch < startEpoch) {
        return null;
    }
    const todayDateKey = getTodayDateKeyInTimezone(familyTimezone);
    const todayEpoch = parseDateKeyToEpochUtc(todayDateKey);
    const endEpoch = Number.isFinite(todayEpoch) && todayEpoch > lastDataEpoch
        ? todayEpoch
        : lastDataEpoch;
    const dayMs = 24 * 60 * 60 * 1000;
    const cardCum = new Map();
    const practicedSet = new Set();
    const learnedSet = new Set();
    const points = [];
    let dayIndex = 0;
    let cumRtSumMs = 0;
    let cumRtCount = 0;
    for (let epoch = startEpoch; epoch <= endEpoch; epoch += dayMs) {
        dayIndex += 1;
        const dateStr = formatEpochUtcToDateKey(epoch);
        const dayRows = rowsByDate.get(dateStr) || [];
        for (const row of dayRows) {
            let cum = cardCum.get(row.cardId);
            if (!cum) {
                cum = { attempts: 0, correct: 0 };
                cardCum.set(row.cardId, cum);
            }
            cum.attempts += row.attempts;
            cum.correct += row.correct;
            practicedSet.add(row.cardId);
            if (cum.attempts >= 5 && (cum.correct / cum.attempts) >= 0.8) {
                learnedSet.add(row.cardId);
            }
            cumRtSumMs += row.rtSum;
            cumRtCount += row.rtCount;
        }
        const avgCorrectRtSec = cumRtCount > 0 ? (cumRtSumMs / cumRtCount) / 1000 : null;
        points.push({
            dayIndex,
            date: dateStr,
            practiced: practicedSet.size,
            learned: learnedSet.size,
            avgCorrectRtSec,
        });
    }
    const yMax = Math.max(1, points.reduce((max, p) => Math.max(max, p.practiced, p.learned), 0));
    let rtMin = Infinity;
    let rtMax = 0;
    for (const p of points) {
        const v = Number(p.avgCorrectRtSec);
        if (!Number.isFinite(v)) continue;
        if (v < rtMin) rtMin = v;
        if (v > rtMax) rtMax = v;
    }
    const hasRtData = Number.isFinite(rtMin) && rtMax > 0;
    return {
        title: 'Daily Progress',
        firstDate,
        lastDate,
        totalDays: points.length,
        points,
        yMax,
        rtMin: hasRtData ? rtMin : null,
        rtMax: hasRtData ? rtMax : 0,
    };
}

function getTodayDateKeyInTimezone(timezone) {
    const tz = String(timezone || '').trim();
    try {
        const formatter = new Intl.DateTimeFormat('en-CA', {
            timeZone: tz || undefined,
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
        });
        const parts = formatter.formatToParts(new Date());
        const year = parts.find((p) => p.type === 'year')?.value;
        const month = parts.find((p) => p.type === 'month')?.value;
        const day = parts.find((p) => p.type === 'day')?.value;
        if (year && month && day) {
            return `${year}-${month}-${day}`;
        }
    } catch (_) {
        // fall through to UTC fallback
    }
    return formatEpochUtcToDateKey(Date.now());
}

function parseDateKeyToEpochUtc(dateStr) {
    const text = String(dateStr || '').trim();
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
    if (!match) return NaN;
    return Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

function formatEpochUtcToDateKey(epochMs) {
    const dt = new Date(epochMs);
    if (Number.isNaN(dt.getTime())) return '';
    const y = dt.getUTCFullYear();
    const m = String(dt.getUTCMonth() + 1).padStart(2, '0');
    const d = String(dt.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

function renderDailyProgressPanel(chart) {
    const points = Array.isArray(chart?.points) ? chart.points : [];
    if (!points.length) return '';
    const totalDays = Math.max(1, Number(chart?.totalDays) || points.length);
    const yMax = Math.max(1, Number(chart?.yMax) || 0);
    const yTicks = buildDailyProgressYTicks(yMax);
    const axisMax = yTicks[yTicks.length - 1] || yMax;
    const rtMaxRaw = Number(chart?.rtMax) || 0;
    const rtMinRaw = Number(chart?.rtMin);
    const hasRtData = rtMaxRaw > 0 && Number.isFinite(rtMinRaw);
    const rtTicks = hasRtData ? buildResponseTimeYTicks(rtMinRaw, rtMaxRaw) : [];
    const rtAxisMin = rtTicks.length ? rtTicks[0] : 0;
    const rtAxisMax = rtTicks.length ? rtTicks[rtTicks.length - 1] : 0;
    const rtAxisRange = rtAxisMax - rtAxisMin;
    const xTicks = buildDailyProgressXTicks(totalDays);
    const positionForDay = (dayIndex) => totalDays <= 1
        ? 50
        : ((dayIndex - 1) / (totalDays - 1)) * 100;
    const positionForValue = (value) => axisMax <= 0
        ? 0
        : (Number(value) / axisMax) * 100;
    const positionForRt = (value) => rtAxisRange <= 0
        ? 0
        : ((Number(value) - rtAxisMin) / rtAxisRange) * 100;
    const buildLinePath = (key) => points
        .map((point, idx) => {
            const x = positionForDay(point.dayIndex).toFixed(2);
            const y = (100 - positionForValue(point[key])).toFixed(2);
            return `${idx === 0 ? 'M' : 'L'}${x},${y}`;
        })
        .join(' ');
    const buildResponseTimePath = () => {
        const segments = [];
        let pendingMove = true;
        for (const point of points) {
            const value = Number(point.avgCorrectRtSec);
            if (!Number.isFinite(value)) {
                pendingMove = true;
                continue;
            }
            const x = positionForDay(point.dayIndex).toFixed(2);
            const y = (100 - positionForRt(value)).toFixed(2);
            segments.push(`${pendingMove ? 'M' : 'L'}${x},${y}`);
            pendingMove = false;
        }
        return segments.join(' ');
    };
    const practicedPath = buildLinePath('practiced');
    const learnedPath = buildLinePath('learned');
    const responseTimePath = hasRtData ? buildResponseTimePath() : '';
    const lastPoint = points[points.length - 1] || { practiced: 0, learned: 0, avgCorrectRtSec: null };
    const lastRtValue = Number(lastPoint?.avgCorrectRtSec);
    const lastRtLabel = Number.isFinite(lastRtValue) ? `${lastRtValue.toFixed(2)}s` : '—';
    const formatRtTick = (tick) => {
        const num = Number(tick);
        if (!Number.isFinite(num)) return '';
        return Number.isInteger(num) ? `${num}s` : `${num.toFixed(1)}s`;
    };
    return `
        <div class="cards-distribution-card daily-progress-card${hasRtData ? ' has-response-time' : ''}">
            <div class="cards-distribution-card-head">
                <div class="cards-distribution-card-title">${escapeHtml(String(chart?.title || 'Daily Progress'))}</div>
                <div class="daily-progress-legend">
                    <span class="daily-progress-legend-item practiced"><span class="daily-progress-legend-swatch"></span>Practiced (${escapeHtml(String(lastPoint.practiced))})</span>
                    <span class="daily-progress-legend-item learned"><span class="daily-progress-legend-swatch"></span>Learned (${escapeHtml(String(lastPoint.learned))})</span>
                    ${hasRtData ? `<span class="daily-progress-legend-item response-time"><span class="daily-progress-legend-swatch"></span>Avg correct response (${escapeHtml(lastRtLabel)})</span>` : ''}
                </div>
            </div>
            <div class="daily-progress-chart">
                <div class="daily-progress-y-label">Cards</div>
                <div class="daily-progress-y-axis">
                    ${yTicks.map((tick) => `
                        <div class="daily-progress-y-tick" style="bottom:${positionForValue(tick).toFixed(2)}%">${escapeHtml(String(tick))}</div>
                    `).join('')}
                </div>
                ${hasRtData ? `
                    <div class="daily-progress-y-label daily-progress-y-label-right">Response</div>
                    <div class="daily-progress-y-axis daily-progress-y-axis-right">
                        ${rtTicks.map((tick) => `
                            <div class="daily-progress-y-tick" style="bottom:${positionForRt(tick).toFixed(2)}%">${escapeHtml(formatRtTick(tick))}</div>
                        `).join('')}
                    </div>
                ` : ''}
                <div class="daily-progress-plot">
                    <div class="daily-progress-grid">
                        ${yTicks.map((tick) => `
                            <div class="daily-progress-grid-line" style="bottom:${positionForValue(tick).toFixed(2)}%"></div>
                        `).join('')}
                    </div>
                    <svg class="daily-progress-svg" viewBox="0 0 100 100" preserveAspectRatio="none">
                        <path class="daily-progress-line practiced" d="${practicedPath}" />
                        <path class="daily-progress-line learned" d="${learnedPath}" />
                        ${responseTimePath ? `<path class="daily-progress-line response-time" d="${responseTimePath}" />` : ''}
                    </svg>
                    <div class="daily-progress-x-axis">
                        ${xTicks.map((tick) => {
                            const isLast = tick === totalDays;
                            return `
                            <div class="daily-progress-x-tick${isLast ? ' is-today' : ''}" style="left:${positionForDay(tick).toFixed(2)}%">Day ${escapeHtml(String(tick))}${isLast ? '<div class="daily-progress-x-tick-today">(today)</div>' : ''}</div>
                        `;
                        }).join('')}
                    </div>
                </div>
            </div>
        </div>
    `;
}

function buildResponseTimeYTicks(rtMin, rtMax) {
    const lo = Math.max(0, Math.floor(Number(rtMin) || 0));
    const hi = Math.max(lo + 1, Number(rtMax) || lo + 1);
    const span = Math.max(1, hi - lo);
    const step = getNiceHistogramStep(span / 4);
    const axisMax = lo + Math.max(step, Math.ceil(span / step) * step);
    const ticks = [];
    for (let value = lo; value <= axisMax; value += step) {
        ticks.push(value);
    }
    return ticks;
}

function buildDailyProgressYTicks(yMax) {
    const safeMax = Math.max(1, Number(yMax) || 0);
    const step = getNiceHistogramStep(safeMax / 4);
    const axisMax = Math.max(step, Math.ceil(safeMax / step) * step);
    const ticks = [];
    for (let value = 0; value <= axisMax; value += step) {
        ticks.push(value);
    }
    return ticks;
}

function buildDailyProgressXTicks(totalDays) {
    const days = Math.max(1, Number(totalDays) || 1);
    if (days === 1) return [1];
    const desiredCount = Math.min(6, days);
    const ticks = new Set();
    for (let i = 0; i < desiredCount; i += 1) {
        const fraction = i / (desiredCount - 1);
        const day = Math.round(1 + fraction * (days - 1));
        ticks.add(day);
    }
    return Array.from(ticks).sort((a, b) => a - b);
}

function buildDistributionCardReportHref(cardId) {
    const numericCardId = Number(cardId);
    if (!kidId || !Number.isFinite(numericCardId) || numericCardId <= 0) {
        return '';
    }
    const qs = new URLSearchParams();
    qs.set('id', String(kidId));
    qs.set('cardId', String(numericCardId));
    qs.set('from', 'cards');
    if (selectedCategoryKey) {
        qs.set('categoryKey', String(selectedCategoryKey));
    }
    return `/kid-card-report.html?${qs.toString()}`;
}

function buildTopCardLists(rated, configs, formatValue, getCardCapsuleLabel) {
    const lists = Array.isArray(configs) ? configs : [];
    if (!lists.length || !Array.isArray(rated) || !rated.length) {
        return [];
    }
    const labelOf = typeof getCardCapsuleLabel === 'function'
        ? getCardCapsuleLabel
        : (card) => String(card?.front || '').trim();
    const ascending = rated.slice().sort((a, b) => a.value - b.value);
    return lists.map((cfg) => {
        const count = Math.max(1, Number(cfg?.count) || 5);
        const slice = cfg?.mode === 'highest'
            ? ascending.slice(-count).reverse()
            : ascending.slice(0, count);
        return {
            title: String(cfg?.title || ''),
            entries: slice.map((entry) => ({
                cardId: Number(entry.card?.id) || 0,
                front: String(labelOf(entry.card) || '').trim() || '—',
                valueLabel: formatValue(entry.value),
            })),
        };
    });
}

function formatIntegerCaptureRange(min, max) {
    const lo = Math.ceil(min);
    const hi = Math.floor(max);
    if (lo > hi) {
        return `${Math.round(min)}–${Math.round(max)}`;
    }
    return lo === hi ? String(lo) : `${lo}–${hi}`;
}

function buildHistogramDistribution(options = {}) {
    const cards = Array.isArray(options?.cards) ? options.cards : [];
    const getValue = typeof options?.getValue === 'function' ? options.getValue : () => null;
    const formatValue = typeof options?.formatValue === 'function' ? options.formatValue : (v) => String(v);
    const bucketing = options?.bucketing || {};
    const values = [];
    const rated = [];
    for (const card of cards) {
        const value = Number(getValue(card));
        if (Number.isFinite(value)) {
            values.push(value);
            rated.push({ card, value });
        }
    }

    const bucketDefinitions = buildDynamicBuckets(values, bucketing);

    if (!values.length || !bucketDefinitions.length) {
        return {
            title: String(options?.title || ''),
            tone: String(options?.tone || ''),
            emptyMessage: 'No practiced-card data yet.',
        };
    }

    const bars = buildHistogramBars(values, bucketDefinitions);
    const maxValue = Math.max(...values);
    const percentiles = buildHistogramPercentiles(values, bars, maxValue, options?.formatValue, options?.percentileMarkers);
    const yAxis = buildHistogramCountAxis(Math.max(...bars.map((bar) => Number(bar?.count) || 0), 0));
    const getCardCapsuleLabel = typeof options?.getCardCapsuleLabel === 'function'
        ? options.getCardCapsuleLabel
        : (card) => String(card?.front || '').trim();
    const topLists = buildTopCardLists(rated, options?.topLists, formatValue, getCardCapsuleLabel);
    return {
        title: String(options?.title || ''),
        tone: String(options?.tone || ''),
        yAxisLabel: 'Cards',
        bars,
        percentiles,
        yMax: yAxis.max,
        tickValues: yAxis.ticks,
        topLists,
    };
}

const HISTOGRAM_BUCKET_COUNT = 7;

function buildDynamicBuckets(values, bucketing = {}) {
    if (!Array.isArray(values) || !values.length) {
        return [];
    }
    const formatRange = typeof bucketing?.formatRange === 'function'
        ? bucketing.formatRange
        : (min, max) => `${min}–${max}`;
    const snapUnit = Math.max(1e-9, Number(bucketing?.snapUnit) || 1);
    const isInteger = !!bucketing?.isInteger;
    const minClamp = Number.isFinite(bucketing?.minClamp) ? Number(bucketing.minClamp) : -Infinity;
    const maxClamp = Number.isFinite(bucketing?.maxClamp) ? Number(bucketing.maxClamp) : Infinity;

    const dataMin = Math.min(...values);
    const dataMax = Math.max(...values);
    if (dataMin === dataMax) {
        return [{ min: dataMin, max: dataMax, label: formatRange(dataMin, dataMax) }];
    }

    const range = dataMax - dataMin;
    const step = Math.max(snapUnit, Math.ceil(range / HISTOGRAM_BUCKET_COUNT / snapUnit) * snapUnit);
    const totalWidth = step * HISTOGRAM_BUCKET_COUNT;
    const overflow = totalWidth - range;

    const anchorLo = String(bucketing?.anchorLo || '').toLowerCase();
    let lo = anchorLo === 'datamin'
        ? Math.floor(dataMin / snapUnit) * snapUnit
        : Math.floor((dataMin - overflow / 2) / snapUnit) * snapUnit;
    if (lo < minClamp) {
        lo = Math.ceil(minClamp / snapUnit) * snapUnit;
    }
    if (lo + totalWidth > maxClamp) {
        const cappedLo = Math.floor((maxClamp - totalWidth) / snapUnit) * snapUnit;
        lo = Math.max(Math.ceil(minClamp / snapUnit) * snapUnit, cappedLo);
    }

    const buckets = [];
    for (let i = 0; i < HISTOGRAM_BUCKET_COUNT; i++) {
        const bMin = lo + (i * step);
        const bMaxExclusive = bMin + step;
        const bucketMax = isInteger ? bMaxExclusive - 1 : bMaxExclusive;
        buckets.push({
            min: bMin,
            max: bucketMax,
            label: formatRange(bMin, bucketMax),
        });
    }
    return buckets;
}

function buildHistogramBars(values, bucketDefinitions) {
    const bars = bucketDefinitions.map((definition) => ({
        label: String(definition?.label || ''),
        min: Number(definition?.min) || 0,
        max: Number.isFinite(definition?.max) ? Number(definition.max) : null,
        count: 0,
    }));
    for (const value of values) {
        const bar = findHistogramBucket(value, bars);
        if (bar) {
            bar.count += 1;
        }
    }
    return bars;
}

function buildHistogramPercentiles(values, bucketDefinitions, observedMax, formatValue, percentileMarkers) {
    const sortedValues = values.slice().sort((a, b) => a - b);
    const formatter = typeof formatValue === 'function' ? formatValue : (value) => String(value);
    const requested = Array.isArray(percentileMarkers) && percentileMarkers.length
        ? percentileMarkers
        : [50, 90];
    const markers = requested.map((percentile) => ({
        percentile,
        label: `P${percentile}`,
        className: `p${percentile}`,
    }));
    const groups = [];
    for (const marker of markers) {
        const value = getPercentileValue(sortedValues, marker.percentile);
        const valueLabel = formatter(value);
        const last = groups[groups.length - 1];
        if (last && last.valueLabel === valueLabel) {
            last.labels.push(marker.label);
            last.classNames.push(marker.className);
            continue;
        }
        groups.push({
            value,
            valueLabel,
            positionPct: getHistogramMarkerPositionPct(value, bucketDefinitions, observedMax),
            labels: [marker.label],
            classNames: [marker.className],
        });
    }
    return groups.map((group) => ({
        label: group.labels.join(' · '),
        className: group.classNames.join(' '),
        valueLabel: group.valueLabel,
        positionPct: group.positionPct,
    }));
}

function buildHistogramCountAxis(maxCount) {
    const safeMax = Math.max(1, Number(maxCount) || 0);
    const step = getNiceHistogramStep(safeMax / 4);
    const axisMax = Math.max(step, Math.ceil(safeMax / step) * step);
    const ticks = [];
    for (let value = 0; value <= axisMax; value += step) {
        ticks.push(value);
    }
    return {
        max: axisMax,
        ticks,
    };
}

function getNiceHistogramStep(rawStep) {
    const value = Math.max(1, Number(rawStep) || 1);
    const magnitude = 10 ** Math.floor(Math.log10(value));
    const normalized = value / magnitude;
    if (normalized <= 1) return magnitude;
    if (normalized <= 2) return 2 * magnitude;
    if (normalized <= 5) return 5 * magnitude;
    return 10 * magnitude;
}

function getHistogramVerticalPositionPct(value, maxValue) {
    if (!Number.isFinite(value) || !Number.isFinite(maxValue) || maxValue <= 0) {
        return 0;
    }
    return (value / maxValue) * 100;
}

function findHistogramBucket(value, bucketDefinitions) {
    const list = Array.isArray(bucketDefinitions) ? bucketDefinitions : [];
    for (const bucket of list) {
        const min = Number(bucket?.min) || 0;
        const max = Number.isFinite(bucket?.max) ? Number(bucket.max) : null;
        if (value < min) {
            continue;
        }
        if (max === null || value <= max) {
            return bucket;
        }
    }
    return list[list.length - 1] || null;
}

function getHistogramMarkerPositionPct(value, bucketDefinitions, observedMax) {
    const buckets = Array.isArray(bucketDefinitions) ? bucketDefinitions : [];
    if (!buckets.length || !Number.isFinite(value)) {
        return 50;
    }
    const bucketIndex = Math.max(0, buckets.findIndex((bucket) => findHistogramBucket(value, buckets) === bucket));
    const bucket = buckets[bucketIndex] || buckets[0];
    const min = Number(bucket?.min) || 0;
    const rawMax = Number.isFinite(bucket?.max) ? Number(bucket.max) : Math.max(observedMax, min);
    const max = rawMax > min ? rawMax : min;
    const range = max - min;
    const fraction = range > 0 ? (value - min) / range : 0.5;
    const slotInset = 0.12;
    const slotWidth = 1 / buckets.length;
    const normalized = (bucketIndex + slotInset + (Math.max(0, Math.min(1, fraction)) * (1 - (slotInset * 2)))) * slotWidth;
    return normalized * 100;
}

function getPercentileValue(sortedValues, percentile) {
    const list = Array.isArray(sortedValues) ? sortedValues : [];
    if (!list.length) {
        return 0;
    }
    if (list.length === 1) {
        return list[0];
    }
    const clamped = Math.max(0, Math.min(100, Number(percentile) || 0));
    const index = (clamped / 100) * (list.length - 1);
    const lowerIndex = Math.floor(index);
    const upperIndex = Math.ceil(index);
    const lowerValue = list[lowerIndex];
    const upperValue = list[upperIndex];
    if (lowerIndex === upperIndex) {
        return lowerValue;
    }
    const weight = index - lowerIndex;
    return lowerValue + ((upperValue - lowerValue) * weight);
}

function formatCompactCountLabel(value) {
    const num = Number(value);
    if (!Number.isFinite(num)) {
        return '';
    }
    if (Math.abs(num) >= 1000) {
        const compact = Math.round((num / 1000) * 10) / 10;
        return `${trimTrailingZeros(compact.toFixed(1))}k`;
    }
    return String(Math.round(num));
}

function formatPercentLabel(value) {
    if (!Number.isFinite(value)) {
        return '';
    }
    const rounded = Math.round(value * 10) / 10;
    return `${Number.isInteger(rounded) ? rounded.toFixed(0) : rounded.toFixed(1)}%`;
}

function formatCountLabel(value) {
    if (!Number.isFinite(value)) {
        return '';
    }
    return String(Math.round(value));
}

function formatSpeedLabel(value) {
    if (!Number.isFinite(value) || value <= 0) {
        return '';
    }
    const seconds = value / 1000;
    if (seconds >= 10) {
        return `${Math.round(seconds)}s`;
    }
    if (seconds >= 1) {
        return `${trimTrailingZeros(seconds.toFixed(1))}s`;
    }
    return `${trimTrailingZeros(seconds.toFixed(2))}s`;
}

function trimTrailingZeros(text) {
    return String(text || '').replace(/\.0+$/, '').replace(/(\.\d*?)0+$/, '$1');
}

function formatBoundaryNumber(value) {
    if (!Number.isFinite(value)) {
        return '';
    }
    if (Number.isInteger(value)) {
        return String(value);
    }
    return trimTrailingZeros(value.toFixed(1));
}

function formatBoundarySeconds(ms) {
    if (!Number.isFinite(ms)) {
        return '';
    }
    const seconds = ms / 1000;
    if (Number.isInteger(seconds)) {
        return String(seconds);
    }
    return trimTrailingZeros(seconds.toFixed(1));
}

function getCardPracticeCount(card) {
    const attempts = Number.parseInt(card?.lifetime_attempts, 10);
    return Number.isInteger(attempts) ? Math.max(0, attempts) : 0;
}

function getCardCorrectRatePct(card) {
    if (getCardPracticeCount(card) <= 0) {
        return null;
    }
    const wrongRate = Number(card?.overall_wrong_rate);
    if (!Number.isFinite(wrongRate)) {
        return null;
    }
    return Math.max(0, Math.min(100, 100 - wrongRate));
}

function getCardAverageSpeedMs(card) {
    const avgMs = Number(card?.avg_response_time_ms);
    if (Number.isFinite(avgMs) && avgMs > 0) {
        return avgMs;
    }
    const fallback = Number(card?.practice_priority_avg_correct_response_time);
    if (Number.isFinite(fallback) && fallback > 0) {
        return fallback;
    }
    return null;
}

function getCardDaysSinceLastSeen(card) {
    if (getCardPracticeCount(card) <= 0) {
        return null;
    }
    const seenAt = card?.last_seen_at;
    if (!seenAt) {
        return null;
    }
    const seenMs = new Date(seenAt).getTime();
    if (!Number.isFinite(seenMs)) {
        return null;
    }
    const dayDiff = Math.floor((Date.now() - seenMs) / (24 * 60 * 60 * 1000));
    return Math.max(0, dayDiff);
}

function formatDaysLabel(value) {
    const days = Number(value);
    if (!Number.isFinite(days)) {
        return '–';
    }
    const rounded = Math.max(0, Math.round(days));
    return `${rounded}d`;
}

function renderCategoryFilter(sessions) {
    if (!reportCategoryFilter) {
        return;
    }
    const labelByKey = new Map();
    const orderedKeys = [];
    for (const session of (Array.isArray(sessions) ? sessions : [])) {
        const key = normalizeCategoryKey(session?.type);
        if (!key || labelByKey.has(key)) {
            continue;
        }
        const label = String(session?.category_display_name || '').trim() || key;
        labelByKey.set(key, label);
        orderedKeys.push(key);
    }
    orderedKeys.sort((a, b) => String(labelByKey.get(a)).localeCompare(String(labelByKey.get(b))));

    if (selectedCategoryKey && !labelByKey.has(selectedCategoryKey)) {
        selectedCategoryKey = '';
    }

    const buttons = [{ key: '', label: 'All' }].concat(
        orderedKeys.map((key) => ({
            key,
            label: labelByKey.get(key),
        })),
    );

    reportCategoryFilter.innerHTML = buttons.map((btn) => {
        const isActive = btn.key === selectedCategoryKey;
        return `<button type="button" class="report-category-filter-btn${isActive ? ' active' : ''}" data-category-key="${escapeHtml(btn.key)}">${escapeHtml(btn.label)}</button>`;
    }).join('');

    reportCategoryFilter.querySelectorAll('.report-category-filter-btn').forEach((btn) => {
        btn.addEventListener('click', () => {
            const nextKey = btn.getAttribute('data-category-key') || '';
            if (nextKey === selectedCategoryKey) {
                return;
            }
            selectedCategoryKey = nextKey;
            reportCategoryFilter.querySelectorAll('.report-category-filter-btn').forEach((other) => {
                const otherKey = other.getAttribute('data-category-key') || '';
                other.classList.toggle('active', otherKey === selectedCategoryKey);
            });
            dailyChartPageIndex = 0;
            if (selectedCategoryKey) {
                collapsedDayKeys.clear();
            } else {
                seedCollapsedDays(reportSessions);
            }
            renderFilteredViews();
        });
    });
}

function renderSessionsList() {
    if (!sessionsList) return;
    const sessions = Array.isArray(filteredSessions) ? filteredSessions : [];
    const view = buildDatePageView(sessions, getSessionDateKey, dailyChartPageIndex, DAILY_CHART_PAGE_SIZE);

    if (sessions.length === 0 || view.pageItems.length === 0) {
        sessionsList.innerHTML = `<div class="sessions-empty">No practice sessions yet.</div>`;
        return;
    }

    const byDay = new Map();
    for (const session of view.pageItems) {
        const dayKey = getSessionDateKey(session);
        if (!dayKey) continue;
        if (!byDay.has(dayKey)) byDay.set(dayKey, []);
        byDay.get(dayKey).push(session);
    }
    const orderedDays = Array.from(byDay.keys()).sort((a, b) => b.localeCompare(a));

    sessionsList.innerHTML = orderedDays.map((dayKey) => {
        const items = byDay.get(dayKey) || [];
        items.sort((a, b) => String(b.started_at || '').localeCompare(String(a.started_at || '')));
        const dayTotals = summarizeSessions(items);
        const isCollapsed = collapsedDayKeys.has(dayKey);
        const cards = items.map((session) => renderSessionCard(session)).join('');
        return `
            <div class="day-group${isCollapsed ? ' collapsed' : ''}" data-day-key="${escapeHtml(dayKey)}">
                <div class="day-group-header">
                    <div class="day-group-title">${escapeHtml(formatDayHeading(dayKey))}</div>
                    <div class="day-group-summary">${dayTotals.count} ${dayTotals.count === 1 ? 'session' : 'sessions'} · ${dayTotals.activeMinutes.toFixed(1)} min</div>
                    <button type="button" class="day-group-toggle" aria-label="Toggle">⌃</button>
                </div>
                <div class="day-group-body">${cards}</div>
            </div>
        `;
    }).join('');
}

function renderSessionCard(session) {
    const theme = getCategoryColorTheme(normalizeCategoryKey(session?.type));
    const displayName = String(session?.category_display_name || '').trim() || String(session?.type || '');
    const glyph = String(session?.category_emoji || '').trim() || '🧩';
    const sessionUrl = `/kid-session-report.html?id=${encodeURIComponent(kidId)}&sessionId=${encodeURIComponent(session.id)}${from === 'kid-home' ? '&from=kid-home' : ''}`;
    const time = formatSessionTime(session.started_at);
    const mode = formatPracticeMode(session.practice_mode);
    const subParts = [time, mode].filter((part) => part && part !== '-');
    const totalMins = (getSessionResponseMinutes(session) + getSessionRetryResponseMinutes(session)).toFixed(1);
    const result = getSessionResultMeta(session);
    const retries = safeNum(session.retry_count);
    return `
        <a href="${sessionUrl}" class="session-card">
            <div class="session-icon" style="background:${escapeHtml(theme?.pillBg || '#eef2fb')}">${escapeHtml(glyph)}</div>
            <div class="session-info">
                <div class="session-title">${escapeHtml(displayName)}</div>
                <div class="session-sub">${escapeHtml(subParts.join(' · '))}</div>
            </div>
            <div class="session-stats">
                <div class="session-mins">${totalMins}<span class="session-mins-unit">min</span></div>
                ${result ? `<div class="session-result" style="color:${escapeHtml(result.color)}">${escapeHtml(result.text)}</div>` : ''}
                <div class="session-retries">Retries ${retries}</div>
            </div>
            <div class="session-chevron">›</div>
        </a>
    `;
}

function getSessionResultMeta(session) {
    const SESSION_RESULT_SUCCESS_COLOR = '#15803d';
    const SESSION_RESULT_ERROR_COLOR = '#dc2626';
    const right = safeNum(session?.right_count);
    const wrong = safeNum(session?.wrong_count);
    const total = right + wrong;
    if (total <= 0) return null;
    if (wrong > 0) {
        return {
            text: `Correct ${right} / ${total}`,
            color: SESSION_RESULT_ERROR_COLOR,
        };
    }
    return {
        text: `Completed ${right} ${right === 1 ? 'item' : 'items'}`,
        color: SESSION_RESULT_SUCCESS_COLOR,
    };
}

function formatSessionTime(iso) {
    const dt = parseUtcTimestamp(iso);
    if (Number.isNaN(dt.getTime())) return '';
    return dt.toLocaleTimeString(undefined, {
        timeZone: reportTimezone,
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
    });
}

function formatDayHeading(dayKey) {
    const dt = parseDateKeyToUtcNoon(dayKey);
    if (!dt) return dayKey;
    return new Intl.DateTimeFormat(undefined, {
        timeZone: reportTimezone,
        weekday: 'short',
        month: 'short',
        day: 'numeric',
        year: 'numeric',
    }).format(dt);
}

function renderDailyMinutesChart(sessions) {
    const dailyMap = new Map();
    const categoryTotals = new Map();
    const categoryLabelByKey = new Map();

    sessions.forEach((session) => {
        const minutes = getSessionCombinedActiveMinutes(session);
        const rightCards = safeNum(session?.right_count);
        const wrongCards = safeNum(session?.wrong_count);
        const cards = rightCards + wrongCards;
        const dayKey = formatDateKey(session.started_at || session.completed_at);
        if (!dayKey) return;
        const sessionType = normalizeCategoryKey(session.type);
        if (!sessionType) return;
        const categoryKey = sessionType;
        const categoryLabel = String(session?.category_display_name || '').trim();
        if (!categoryLabelByKey.has(categoryKey)) {
            categoryLabelByKey.set(categoryKey, categoryLabel);
        }

        if (!dailyMap.has(dayKey)) {
            dailyMap.set(dayKey, { byCategory: {}, total: 0, cards: 0, rightCards: 0, wrongCards: 0 });
        }
        const row = dailyMap.get(dayKey);
        row.byCategory[categoryKey] = (Number(row.byCategory[categoryKey]) || 0) + minutes;
        row.total += minutes;
        row.cards += cards;
        row.rightCards += rightCards;
        row.wrongCards += wrongCards;
        categoryTotals.set(categoryKey, (Number(categoryTotals.get(categoryKey)) || 0) + minutes);
    });

    const orderedCategoryKeys = Array.from(categoryTotals.entries())
        .sort((a, b) => b[1] - a[1])
        .map(([categoryKey]) => categoryKey);
    dailyChartCategories = orderedCategoryKeys.map((categoryKey) => ({
        key: categoryKey,
        label: String(categoryLabelByKey.get(categoryKey) || ''),
        color: getCategoryColorTheme(categoryKey).bar,
    }));

    dailyChartRows = Array.from(dailyMap.entries())
        .map(([date, v]) => ({ date, ...v }))
        .sort((a, b) => b.date.localeCompare(a.date));

    dailyChartPageIndex = 0;
    renderDailyMinutesChartPage();
}

function renderDailyMinutesChartPage() {
    const rows = Array.isArray(dailyChartRows) ? dailyChartRows : [];
    const categories = Array.isArray(dailyChartCategories) ? dailyChartCategories : [];
    const view = buildDatePageView(rows, (row) => String(row?.date || ''), dailyChartPageIndex, DAILY_CHART_PAGE_SIZE);
    dailyChartPageIndex = view.pageIndex;
    syncDatePagerControls({
        newerBtn: dailyChartNewerBtn,
        olderBtn: dailyChartOlderBtn,
        labelEl: dailyChartPageLabel,
        view,
        emptyLabel: 'No data',
    });

    if (rows.length === 0 || view.pageItems.length === 0) {
        dailyChartBody.innerHTML = `<div style="color:#666;font-size:0.9rem;">No active response time yet.</div>`;
        return;
    }

    const pageRows = view.pageItems.slice().sort((a, b) => String(a.date).localeCompare(String(b.date)));
    const maxTotal = Math.max(...pageRows.map((r) => r.total), 1);
    const showCards = Boolean(selectedCategoryKey);
    const maxCards = showCards ? Math.max(...pageRows.map((r) => Number(r?.cards) || 0), 1) : 1;
    const MINUTES_FILTER_COLOR = '#3b82f6';
    const RIGHT_CARDS_FILTER_COLOR = '#16a34a';
    const WRONG_CARDS_FILTER_COLOR = '#dc2626';

    const columns = pageRows.map((row) => {
        const total = Number(row?.total) || 0;
        const cards = Number(row?.cards) || 0;
        const rightCards = Number(row?.rightCards) || 0;
        const wrongCards = Number(row?.wrongCards) || 0;
        const heightPct = (total / maxTotal) * 100;
        let segments = '';
        if (total > 0) {
            if (showCards) {
                segments = `<div class="daily-vbar-seg" style="height:100%;background:${MINUTES_FILTER_COLOR}" title="${total.toFixed(1)} min"></div>`;
            } else {
                segments = categories.map((category) => {
                    const minutes = Number(row?.byCategory?.[category.key]) || 0;
                    if (minutes <= 0) return '';
                    const segPct = (minutes / total) * 100;
                    return `<div class="daily-vbar-seg" style="height:${segPct.toFixed(2)}%;background:${escapeHtml(category.color)}" title="${escapeHtml(category.label)} ${minutes.toFixed(1)} min"></div>`;
                }).join('');
            }
        }
        const dateLabel = formatDailyVBarDate(row.date);
        const safeHeightPct = Math.max(2, heightPct);
        const minutesBarWrapClass = `daily-vbar-bar-wrap${showCards ? '' : ' daily-vbar-bar-wrap-single'}`;
        const minutesBar = total > 0
            ? `<div class="daily-vbar-total" style="bottom:${safeHeightPct.toFixed(2)}%">${total.toFixed(1)}</div>
               <div class="daily-vbar-bar" style="height:${safeHeightPct.toFixed(2)}%">${segments}</div>`
            : '';
        let cardsBarWrap = '';
        if (showCards) {
            const cardsHeightPct = (cards / maxCards) * 100;
            const safeCardsHeightPct = Math.max(2, cardsHeightPct);
            const cardsSegments = [
                rightCards > 0
                    ? `<div class="daily-vbar-seg" style="height:${((rightCards / cards) * 100).toFixed(2)}%;background:${RIGHT_CARDS_FILTER_COLOR}" title="${rightCards} ${rightCards === 1 ? 'right card' : 'right cards'}"></div>`
                    : '',
                wrongCards > 0
                    ? `<div class="daily-vbar-seg" style="height:${((wrongCards / cards) * 100).toFixed(2)}%;background:${WRONG_CARDS_FILTER_COLOR}" title="${wrongCards} ${wrongCards === 1 ? 'wrong card' : 'wrong cards'}"></div>`
                    : '',
            ].join('');
            const cardsBar = cards > 0
                ? `<div class="daily-vbar-total" style="bottom:${safeCardsHeightPct.toFixed(2)}%">${cards}</div>
                   <div class="daily-vbar-bar" style="height:${safeCardsHeightPct.toFixed(2)}%">${cardsSegments}</div>`
                : '';
            cardsBarWrap = `<div class="daily-vbar-bar-wrap">${cardsBar}</div>`;
        }
        return `
            <div class="daily-vbar-col">
                <div class="daily-vbar-plot">
                    <div class="${minutesBarWrapClass}">${minutesBar}</div>
                    ${cardsBarWrap}
                </div>
                <div class="daily-vbar-date">
                    <div class="daily-vbar-date-weekday">${escapeHtml(dateLabel.weekday)}</div>
                    <div class="daily-vbar-date-md">${escapeHtml(dateLabel.monthDay)}</div>
                </div>
            </div>
        `;
    }).join('');

    if (dailyChartLegend) {
        let legendItems;
        let legendPrefix = '';
        if (showCards) {
            legendItems = [
                { color: MINUTES_FILTER_COLOR, label: 'Active minutes' },
                { color: RIGHT_CARDS_FILTER_COLOR, label: 'Right cards' },
                { color: WRONG_CARDS_FILTER_COLOR, label: 'Wrong cards' },
            ];
        } else {
            const visibleCategoryKeys = new Set();
            pageRows.forEach((row) => {
                Object.entries(row?.byCategory || {}).forEach(([key, minutes]) => {
                    if ((Number(minutes) || 0) > 0) visibleCategoryKeys.add(key);
                });
            });
            legendItems = categories
                .filter((category) => visibleCategoryKeys.has(category.key))
                .map((category) => ({
                    color: category.color,
                    label: String(category.label || '').trim() || category.key,
                }));
            if (legendItems.length > 0) {
                legendPrefix = '<span class="daily-chart-legend-prefix">Active minutes:</span>';
            }
        }
        dailyChartLegend.innerHTML = legendPrefix + legendItems.map((item) => {
            const swatch = `<span class="daily-chart-legend-swatch" style="background:${escapeHtml(item.color || '#cccccc')}"></span>`;
            return `<span class="daily-chart-legend-item">${swatch}${escapeHtml(item.label)}</span>`;
        }).join('');
        dailyChartLegend.style.display = legendItems.length > 0 ? '' : 'none';
    }

    dailyChartBody.innerHTML = `<div class="daily-vbar-chart">${columns}</div>`;
}

function formatDailyChartRangeLabel(pageDateKeys) {
    const sorted = pageDateKeys.slice().sort();
    const first = parseDateKeyToUtcNoon(sorted[0]);
    const last = parseDateKeyToUtcNoon(sorted[sorted.length - 1]);
    if (!first || !last) {
        return '';
    }
    const fmtMD = new Intl.DateTimeFormat(undefined, { timeZone: reportTimezone, month: 'short', day: 'numeric' });
    const fmtMDY = new Intl.DateTimeFormat(undefined, { timeZone: reportTimezone, month: 'short', day: 'numeric', year: 'numeric' });
    const firstYear = first.getUTCFullYear();
    const lastYear = last.getUTCFullYear();
    if (firstYear !== lastYear) {
        return `${fmtMDY.format(first)} – ${fmtMDY.format(last)}`;
    }
    if (sorted.length === 1) {
        return fmtMDY.format(first);
    }
    return `${fmtMD.format(first)} – ${fmtMD.format(last)}, ${lastYear}`;
}

function parseDateKeyToUtcNoon(dateKey) {
    const text = String(dateKey || '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
        return null;
    }
    const dt = new Date(`${text}T12:00:00Z`);
    return Number.isNaN(dt.getTime()) ? null : dt;
}

function formatDailyVBarDate(dateKey) {
    const text = String(dateKey || '').trim();
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
    if (!match) {
        return { weekday: text, monthDay: '' };
    }
    const dt = new Date(`${text}T12:00:00Z`);
    if (Number.isNaN(dt.getTime())) {
        return { weekday: text, monthDay: '' };
    }
    const weekday = new Intl.DateTimeFormat(undefined, { timeZone: reportTimezone, weekday: 'short' }).format(dt);
    const monthDay = new Intl.DateTimeFormat(undefined, { timeZone: reportTimezone, month: 'short', day: 'numeric' }).format(dt);
    return { weekday, monthDay };
}

function getCategoryColorTheme(categoryKey) {
    const key = String(categoryKey || '').trim().toLowerCase();
    if (!key) {
        return DEFAULT_CATEGORY_COLOR_THEME;
    }
    const existing = reportCategoryThemeByKey.get(key);
    if (existing) {
        return existing;
    }
    const nextTheme = CATEGORY_COLOR_PALETTE[
        reportCategoryThemeByKey.size % CATEGORY_COLOR_PALETTE.length
    ] || DEFAULT_CATEGORY_COLOR_THEME;
    reportCategoryThemeByKey.set(key, nextTheme);
    return nextTheme;
}

function buildCategoryThemeByKey(sessions) {
    const totalsByKey = new Map();
    const countByKey = new Map();
    for (const session of (Array.isArray(sessions) ? sessions : [])) {
        const categoryKey = normalizeCategoryKey(session?.type);
        if (!categoryKey) {
            continue;
        }
        if (!totalsByKey.has(categoryKey)) {
            totalsByKey.set(categoryKey, 0);
            countByKey.set(categoryKey, 0);
        }
        totalsByKey.set(
            categoryKey,
            (Number(totalsByKey.get(categoryKey)) || 0) + getSessionCombinedActiveMinutes(session),
        );
        countByKey.set(categoryKey, (Number(countByKey.get(categoryKey)) || 0) + 1);
    }

    const orderedKeys = Array.from(totalsByKey.keys()).sort((a, b) => {
        const minuteDiff = (Number(totalsByKey.get(b)) || 0) - (Number(totalsByKey.get(a)) || 0);
        if (Math.abs(minuteDiff) > 0.00001) {
            return minuteDiff;
        }
        const sessionDiff = (Number(countByKey.get(b)) || 0) - (Number(countByKey.get(a)) || 0);
        if (sessionDiff !== 0) {
            return sessionDiff;
        }
        return String(a).localeCompare(String(b));
    });

    const themeByKey = new Map();
    for (let i = 0; i < orderedKeys.length; i += 1) {
        const key = orderedKeys[i];
        const theme = CATEGORY_COLOR_PALETTE[i % CATEGORY_COLOR_PALETTE.length] || DEFAULT_CATEGORY_COLOR_THEME;
        themeByKey.set(key, theme);
    }
    return themeByKey;
}

function getSessionDateKey(session) {
    return formatDateKey(session?.started_at || session?.completed_at);
}

function getDatePageCount(items, getDateKey, pageSize) {
    return buildDatePageView(items, getDateKey, 0, pageSize).pageCount;
}

function buildDatePageView(items, getDateKey, requestedPageIndex, pageSize) {
    const source = Array.isArray(items) ? items : [];
    const size = Math.max(1, Number.parseInt(pageSize, 10) || 7);
    const seen = new Set();
    const dateKeys = [];
    for (const item of source) {
        const key = String(getDateKey(item) || '').trim();
        if (!key || seen.has(key)) {
            continue;
        }
        seen.add(key);
        dateKeys.push(key);
    }

    const pageCount = dateKeys.length > 0 ? Math.ceil(dateKeys.length / size) : 0;
    const safePageIndex = pageCount > 0
        ? Math.max(0, Math.min(Number.parseInt(requestedPageIndex, 10) || 0, pageCount - 1))
        : 0;
    const start = safePageIndex * size;
    const pageDateKeys = dateKeys.slice(start, start + size);
    const pageDateSet = new Set(pageDateKeys);
    const pageItems = source.filter((item) => pageDateSet.has(String(getDateKey(item) || '').trim()));

    return {
        pageIndex: safePageIndex,
        pageCount,
        pageDateKeys,
        pageItems,
    };
}

function syncDatePagerControls({ newerBtn, olderBtn, labelEl, view, emptyLabel }) {
    const pageCount = Number.isFinite(Number(view?.pageCount)) ? Number(view.pageCount) : 0;
    const pageIndex = Number.isFinite(Number(view?.pageIndex)) ? Number(view.pageIndex) : 0;
    const pageDateKeys = Array.isArray(view?.pageDateKeys) ? view.pageDateKeys : [];

    if (labelEl) {
        if (pageCount <= 0 || pageDateKeys.length === 0) {
            labelEl.textContent = emptyLabel || 'No data';
        } else {
            labelEl.textContent = formatDailyChartRangeLabel(pageDateKeys);
        }
    }
    if (newerBtn) {
        newerBtn.disabled = pageCount <= 0 || pageIndex <= 0;
    }
    if (olderBtn) {
        olderBtn.disabled = pageCount <= 0 || pageIndex >= (pageCount - 1);
    }
}

function safeNum(value) {
    const num = Number(value);
    return Number.isFinite(num) ? num : 0;
}

function formatPracticeMode(mode) {
    const m = String(mode || '').trim().toLowerCase();
    if (m === 'self') return 'Self';
    if (m === 'parent') return 'Parent';
    if (m === 'multi') return 'Multi';
    if (m === 'input') return 'Input';
    return '-';
}

function parseUtcTimestamp(raw) {
    if (!raw) return new Date(NaN);
    const text = String(raw).trim();
    if (!text) return new Date(NaN);
    const hasZone = /(?:Z|[+\-]\d{2}:\d{2})$/.test(text);
    return new Date(hasZone ? text : `${text}Z`);
}

function formatDateKey(iso) {
    const dt = parseUtcTimestamp(iso);
    if (Number.isNaN(dt.getTime())) return '';
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: reportTimezone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    }).formatToParts(dt);
    const y = parts.find((p) => p.type === 'year')?.value || '';
    const m = parts.find((p) => p.type === 'month')?.value || '';
    const d = parts.find((p) => p.type === 'day')?.value || '';
    return y && m && d ? `${y}-${m}-${d}` : '';
}

function getSessionResponseMinutes(session) {
    if (!session || typeof session !== 'object') return 0;
    const totalResponseMs = Number(session.total_response_ms);
    if (!Number.isFinite(totalResponseMs)) {
        return 0;
    }
    return Math.max(0, totalResponseMs / 60000);
}

function getSessionRetryResponseMinutes(session) {
    if (!session || typeof session !== 'object') return 0;
    const retryResponseMs = Number(session.retry_total_response_ms);
    if (!Number.isFinite(retryResponseMs)) {
        return 0;
    }
    return Math.max(0, retryResponseMs / 60000);
}

function getSessionCombinedActiveMinutes(session) {
    return getSessionResponseMinutes(session) + getSessionRetryResponseMinutes(session);
}

function summarizeSessions(sessions) {
    const list = Array.isArray(sessions) ? sessions : [];
    const rightCards = list.reduce((sum, session) => sum + safeNum(session?.right_count), 0);
    const wrongCards = list.reduce((sum, session) => sum + safeNum(session?.wrong_count), 0);
    const uniqueCardIds = new Set();
    for (const session of list) {
        for (const rawCardId of (Array.isArray(session?.practiced_card_ids) ? session.practiced_card_ids : [])) {
            const cardId = Number.parseInt(rawCardId, 10);
            if (cardId > 0) {
                uniqueCardIds.add(cardId);
            }
        }
    }
    return {
        count: list.length,
        rightCards,
        wrongCards,
        practicedCards: rightCards + wrongCards,
        uniqueCards: uniqueCardIds.size,
        activeMinutes: list.reduce((sum, session) => sum + getSessionCombinedActiveMinutes(session), 0),
    };
}

function showError(message) {
    if (message) {
        const text = String(message);
        if (errorMessage) {
            errorMessage.textContent = '';
            errorMessage.classList.add('hidden');
        }
        if (showError._lastMessage !== text) {
            window.alert(text);
            showError._lastMessage = text;
        }
    } else {
        showError._lastMessage = '';
        if (errorMessage) {
            errorMessage.classList.add('hidden');
        }
    }
}
