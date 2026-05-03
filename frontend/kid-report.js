const API_BASE = `${window.location.origin}/api`;

const params = new URLSearchParams(window.location.search);
const kidId = params.get('id');
const from = String(params.get('from') || '').trim().toLowerCase();

const reportTitle = document.getElementById('reportTitle');
const backBtn = document.getElementById('backBtn');
const errorMessage = document.getElementById('errorMessage');
const summaryGrid = document.getElementById('summaryGrid');
const reportCategoryFilter = document.getElementById('reportCategoryFilter');
const kidNavGroup = document.getElementById('kidNavGroup');
const dailyChartBody = document.getElementById('dailyChartBody');
const dailyChartNewerBtn = document.getElementById('dailyChartNewerBtn');
const dailyChartOlderBtn = document.getElementById('dailyChartOlderBtn');
const dailyChartPageLabel = document.getElementById('dailyChartPageLabel');
const dailyChartLegend = document.getElementById('dailyChartLegend');
const sessionsList = document.getElementById('sessionsList');
const reportSessionsView = document.getElementById('reportSessionsView');
const collapsedDayKeys = new Set();
let reportTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
let dailyChartRows = [];
let dailyChartCategories = [];
let dailyChartPageIndex = 0;
let reportSessions = [];
let filteredSessions = [];
let selectedCategoryKey = String(params.get('cat') || '').trim();
let cachedKidsForNav = [];
let reportCategoryThemeByKey = new Map();
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
    loadKidNav();
    await loadReport();
});

async function loadKidNav() {
    if (!kidNavGroup) {
        return;
    }
    try {
        const response = await fetch(`${API_BASE}/kids`);
        if (!response.ok) {
            return;
        }
        const kids = await response.json();
        cachedKidsForNav = Array.isArray(kids) ? kids : [];
        renderKidNav();
    } catch (error) {
        console.error('Error loading kids for nav:', error);
    }
}

function renderKidNav() {
    if (!kidNavGroup) {
        return;
    }
    const kids = Array.isArray(cachedKidsForNav) ? cachedKidsForNav : [];
    if (kids.length < 2) {
        kidNavGroup.classList.add('hidden');
        kidNavGroup.innerHTML = '';
        return;
    }
    kidNavGroup.innerHTML = kids.map((kid) => {
        const id = String(kid?.id || '').trim();
        const name = String(kid?.name || '').trim() || 'Kid';
        const isActive = id === String(kidId);
        if (isActive) {
            return `<span class="kid-nav-card active" role="tab" aria-selected="true">${escapeHtml(name)}</span>`;
        }
        const href = buildKidReportHref(id);
        return `<a class="kid-nav-card" role="tab" aria-selected="false" href="${escapeHtml(href)}">${escapeHtml(name)}</a>`;
    }).join('');
    kidNavGroup.classList.remove('hidden');
}

function buildKidReportHref(targetKidId) {
    const qs = new URLSearchParams();
    qs.set('id', String(targetKidId));
    if (selectedCategoryKey) {
        qs.set('cat', selectedCategoryKey);
    }
    if (from === 'kid-home') {
        qs.set('from', 'kid-home');
    }
    return `/kid-report.html?${qs.toString()}`;
}

function syncCategoryQueryParam() {
    try {
        const url = new URL(window.location.href);
        if (selectedCategoryKey) {
            url.searchParams.set('cat', selectedCategoryKey);
        } else {
            url.searchParams.delete('cat');
        }
        window.history.replaceState(null, '', url.toString());
    } catch (error) {
        // ignore — non-critical
    }
}

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
        const sessions = Array.isArray(data.sessions) ? data.sessions : [];
        reportSessions = sessions;
        reportCategoryThemeByKey = buildCategoryThemeByKey(sessions);
        seedCollapsedDays(sessions);
        reportTitle.textContent = 'Practice Report';
        document.title = 'Practice Report - Kids Daily Chores';
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
    summaryGrid.innerHTML = `
        <div class="summary-toggle-group summary-toggle-group-single">
            <div class="summary-toggle-card active">
                <div class="summary-toggle-card-title">Sessions</div>
                <div class="summary-toggle-metrics">
                    <div class="summary-toggle-metric">
                        <div class="summary-toggle-metric-label">Total Sessions</div>
                        <div class="summary-toggle-metric-value">${escapeHtml(String(totals.count))}</div>
                    </div>
                    <div class="summary-toggle-metric">
                        <div class="summary-toggle-metric-label">Active Minutes</div>
                        <div class="summary-toggle-metric-value">${escapeHtml(totals.activeMinutes.toFixed(1))}</div>
                    </div>
                </div>
            </div>
        </div>
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
    renderSummary(filtered);
    renderDailyMinutesChart(filtered);
    renderSessionsList();
}

function renderCategoryFilter(sessions) {
    if (!reportCategoryFilter) {
        return;
    }
    const labelByKey = new Map();
    const emojiByKey = new Map();
    const orderedKeys = [];
    for (const session of (Array.isArray(sessions) ? sessions : [])) {
        const key = normalizeCategoryKey(session?.type);
        if (!key) {
            continue;
        }
        if (!emojiByKey.has(key)) {
            const emoji = String(session?.category_emoji || '').trim();
            if (emoji) {
                emojiByKey.set(key, emoji);
            }
        }
        if (labelByKey.has(key)) {
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
    syncCategoryQueryParam();
    renderKidNav();

    const buttons = [{ key: '', label: 'All', emoji: '' }].concat(
        orderedKeys.map((key) => ({
            key,
            label: labelByKey.get(key),
            emoji: emojiByKey.get(key) || '🧩',
        })),
    );

    reportCategoryFilter.innerHTML = buttons.map((btn) => {
        const isActive = btn.key === selectedCategoryKey;
        const emojiHtml = btn.emoji
            ? `<span class="report-category-filter-emoji" aria-hidden="true">${escapeHtml(btn.emoji)}</span>`
            : '';
        return `<button type="button" class="report-category-filter-btn${isActive ? ' active' : ''}" data-category-key="${escapeHtml(btn.key)}">${emojiHtml}<span class="report-category-filter-label">${escapeHtml(btn.label)}</span></button>`;
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
            syncCategoryQueryParam();
            renderKidNav();
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
            <div class="session-icon">${escapeHtml(glyph)}</div>
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
    return {
        count: list.length,
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
