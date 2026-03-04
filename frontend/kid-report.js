const API_BASE = `${window.location.origin}/api`;

const params = new URLSearchParams(window.location.search);
const kidId = params.get('id');

const reportTitle = document.getElementById('reportTitle');
const errorMessage = document.getElementById('errorMessage');
const summaryGrid = document.getElementById('summaryGrid');
const dailyChartBody = document.getElementById('dailyChartBody');
const dailyLegend = document.getElementById('dailyLegend');
const dailyChartNewerBtn = document.getElementById('dailyChartNewerBtn');
const dailyChartOlderBtn = document.getElementById('dailyChartOlderBtn');
const dailyChartPageLabel = document.getElementById('dailyChartPageLabel');
const reportBody = document.getElementById('reportBody');
const startedHeader = document.getElementById('startedHeader');
let reportTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
let dailyChartRows = [];
let dailyChartCategories = [];
let dailyChartPageIndex = 0;
let reportSessions = [];
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
    normalizeSessionType,
} = window.DeckCategoryCommon;

document.addEventListener('DOMContentLoaded', async () => {
    if (!kidId) {
        window.location.href = '/admin.html';
        return;
    }
    if (dailyChartNewerBtn) {
        dailyChartNewerBtn.addEventListener('click', () => {
            if (dailyChartPageIndex <= 0) return;
            dailyChartPageIndex -= 1;
            renderDailyMinutesChartPage();
            renderTablePage();
        });
    }
    if (dailyChartOlderBtn) {
        dailyChartOlderBtn.addEventListener('click', () => {
            const pageCount = getDatePageCount(dailyChartRows, (row) => String(row?.date || ''), DAILY_CHART_PAGE_SIZE);
            if (dailyChartPageIndex >= (pageCount - 1)) return;
            dailyChartPageIndex += 1;
            renderDailyMinutesChartPage();
            renderTablePage();
        });
    }
    await loadReport();
});

async function loadReport() {
    try {
        showError('');
        await loadReportTimezone();
        const response = await fetch(`${API_BASE}/kids/${kidId}/report`);
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }
        const data = await response.json();
        const kidName = (data.kid && data.kid.name) ? data.kid.name : 'Kid';
        const sessions = Array.isArray(data.sessions) ? data.sessions : [];
        reportSessions = sessions;
        reportCategoryThemeByKey = buildCategoryThemeByKey(sessions);
        reportTitle.textContent = `${kidName}'s Practice Report`;
        renderSummary(sessions);
        renderDailyMinutesChart(sessions);
        renderTable(sessions);
    } catch (error) {
        console.error('Error loading report:', error);
        showError('Failed to load practice report.');
    }
}

async function loadReportTimezone() {
    try {
        const response = await fetch(`${API_BASE}/parent-settings/timezone`);
        if (!response.ok) {
            if (startedHeader) {
                startedHeader.textContent = `Started (${reportTimezone})`;
            }
            return;
        }
        const data = await response.json().catch(() => ({}));
        const tz = String(data.familyTimezone || '').trim();
        if (tz) {
            reportTimezone = tz;
        }
        if (startedHeader) {
            startedHeader.textContent = `Started (${reportTimezone})`;
        }
    } catch (error) {
        // Keep browser timezone.
        if (startedHeader) {
            startedHeader.textContent = `Started (${reportTimezone})`;
        }
    }
}

function renderSummary(sessions) {
    const allTotals = summarizeSessions(sessions);
    const todayKey = formatDateKey(new Date().toISOString());
    const weeklyStartKey = todayKey ? shiftDateKey(todayKey, -6) : '';
    const todaySessions = sessions.filter((session) => getSessionDateKey(session) === todayKey);
    const weeklySessions = sessions.filter((session) => {
        const key = getSessionDateKey(session);
        return !!key && !!weeklyStartKey && key >= weeklyStartKey && key <= todayKey;
    });
    const todayTotals = summarizeSessions(todaySessions);
    const weeklyTotals = summarizeSessions(weeklySessions);
    const weeklyRangeLabel = (weeklyStartKey && todayKey) ? `${weeklyStartKey} → ${todayKey}` : 'Past 7 days';

    summaryGrid.innerHTML = `
        <div class="summary-card"><div class="label">Total Sessions</div><div class="value">${allTotals.count}</div><div class="label">Elapsed: ${allTotals.elapsedMinutes.toFixed(1)} min</div><div class="label">Active: ${allTotals.activeMinutes.toFixed(1)} min</div></div>
        <div class="summary-card"><div class="label">Weekly Total</div><div class="value">${weeklyTotals.count}</div><div class="label">${weeklyRangeLabel}</div><div class="label">Elapsed: ${weeklyTotals.elapsedMinutes.toFixed(1)} min</div><div class="label">Active: ${weeklyTotals.activeMinutes.toFixed(1)} min</div></div>
        <div class="summary-card"><div class="label">Today</div><div class="value">${todayTotals.count}</div><div class="label">${todayKey || 'Today'}</div><div class="label">Elapsed: ${todayTotals.elapsedMinutes.toFixed(1)} min</div><div class="label">Active: ${todayTotals.activeMinutes.toFixed(1)} min</div></div>
    `;
}

function renderTable(sessions) {
    reportSessions = Array.isArray(sessions) ? sessions : [];
    renderTablePage();
}

function renderTablePage() {
    const sessions = Array.isArray(reportSessions) ? reportSessions : [];
    const view = buildDatePageView(sessions, getSessionDateKey, dailyChartPageIndex, DAILY_CHART_PAGE_SIZE);

    if (sessions.length === 0 || view.pageItems.length === 0) {
        reportBody.innerHTML = `<tr><td colspan="8" style="color:#666;">No practice sessions yet.</td></tr>`;
        return;
    }

    reportBody.innerHTML = view.pageItems.map((session) => `
        <tr>
            <td class="shared-report-table-action-cell"><a href="/kid-session-report.html?id=${encodeURIComponent(kidId)}&sessionId=${encodeURIComponent(session.id)}" class="tab-link secondary mini-link-btn table-action-btn">View</a></td>
            <td>${renderType(session.type, session)}</td>
            <td>${formatDateTime(session.started_at)}</td>
            <td>${formatDurationMinutes(session)}</td>
            <td>${formatResponseMinutes(session)}</td>
            <td>${safeNum(session.answer_count)}</td>
            <td>${safeNum(session.right_count)}</td>
            <td>${safeNum(session.wrong_count)}</td>
        </tr>
    `).join('');
}

function renderDailyMinutesChart(sessions) {
    const dailyMap = new Map();
    const categoryTotals = new Map();
    const categoryLabelByKey = new Map();

    sessions.forEach((session) => {
        const minutes = getSessionResponseMinutes(session);
        const dayKey = formatDateKey(session.started_at || session.completed_at);
        if (!dayKey) return;
        const sessionType = normalizeSessionType(session.type);
        if (!sessionType) return;
        const categoryKey = sessionType;
        const categoryLabel = String(session?.category_display_name || '').trim();
        if (!categoryLabelByKey.has(categoryKey)) {
            categoryLabelByKey.set(categoryKey, categoryLabel);
        }

        if (!dailyMap.has(dayKey)) {
            dailyMap.set(dayKey, { byCategory: {}, total: 0 });
        }
        const row = dailyMap.get(dayKey);
        row.byCategory[categoryKey] = (Number(row.byCategory[categoryKey]) || 0) + minutes;
        row.total += minutes;
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

    renderDailyLegend();
    dailyChartPageIndex = 0;
    renderDailyMinutesChartPage();
}

function renderDailyLegend() {
    if (!dailyLegend) {
        return;
    }
    const categories = Array.isArray(dailyChartCategories) ? dailyChartCategories : [];
    if (categories.length === 0) {
        dailyLegend.innerHTML = '';
        dailyLegend.style.display = 'none';
        return;
    }
    dailyLegend.style.display = '';
    dailyLegend.innerHTML = categories.map((category) => `
        <span><span class="legend-dot" style="background:${escapeHtml(category.color)}"></span>${escapeHtml(category.label)}</span>
    `).join('');
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

    const pageRows = view.pageItems;
    const maxTotal = Math.max(...pageRows.map((r) => r.total), 1);

    dailyChartBody.innerHTML = pageRows.map((row) => {
        const segments = categories.map((category) => {
            const minutes = Number(row?.byCategory?.[category.key]) || 0;
            const pct = (minutes / maxTotal) * 100;
            return renderDailyMinutesSegment({
                label: category.label,
                minutes,
                pct,
                color: category.color,
            });
        }).join('');
        return `
            <div class="daily-row">
                <div class="daily-date">${row.date} · ${row.total.toFixed(1)} min</div>
                <div class="daily-bar-track">
                    ${segments}
                </div>
            </div>
        `;
    }).join('');
}

function renderDailyMinutesSegment({ label, minutes, pct, color }) {
    const safeMinutes = Number.isFinite(Number(minutes)) ? Math.max(0, Number(minutes)) : 0;
    const safePct = Number.isFinite(Number(pct)) ? Math.max(0, Number(pct)) : 0;
    if (safeMinutes <= 0 || safePct <= 0) {
        return '';
    }
    const minuteText = safeMinutes.toFixed(1);
    const tinyClass = safePct < 5 ? ' daily-seg-tiny' : '';
    const safeColor = String(color || '#4f83ff');
    return `
        <div class="daily-seg${tinyClass}" style="width:${safePct.toFixed(2)}%;background:${escapeHtml(safeColor)}" title="${escapeHtml(label)} ${minuteText} min">
            <span class="daily-seg-min">${minuteText}</span>
        </div>
    `;
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
        const categoryKey = normalizeSessionType(session?.type);
        if (!categoryKey) {
            continue;
        }
        if (!totalsByKey.has(categoryKey)) {
            totalsByKey.set(categoryKey, 0);
            countByKey.set(categoryKey, 0);
        }
        totalsByKey.set(
            categoryKey,
            (Number(totalsByKey.get(categoryKey)) || 0) + getSessionResponseMinutes(session),
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
            const first = pageDateKeys[0] || '';
            const last = pageDateKeys[pageDateKeys.length - 1] || '';
            const range = (first && last) ? `${first} → ${last}` : `Page ${pageIndex + 1}`;
            labelEl.textContent = `${range} · ${pageIndex + 1}/${pageCount}`;
        }
    }
    if (newerBtn) {
        newerBtn.disabled = pageCount <= 0 || pageIndex <= 0;
    }
    if (olderBtn) {
        olderBtn.disabled = pageCount <= 0 || pageIndex >= (pageCount - 1);
    }
}

function renderType(type, session = null) {
    const categoryKey = normalizeSessionType(type || session?.type);
    const displayName = escapeHtml(String(session?.category_display_name || '').trim());
    const theme = getCategoryColorTheme(categoryKey || displayName);
    const pillBg = String(theme?.bar || DEFAULT_CATEGORY_COLOR_THEME.bar);
    return `<span class="type-pill" style="background:${escapeHtml(pillBg)};color:#ffffff;">${displayName}</span>`;
}

function formatDateTime(iso) {
    const dt = parseUtcTimestamp(iso);
    if (Number.isNaN(dt.getTime())) return '-';
    return dt.toLocaleString(undefined, {
        timeZone: reportTimezone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
    });
}

function formatDurationMinutes(session) {
    const minutes = getSessionDurationMinutes(session);
    return minutes.toFixed(1);
}

function formatResponseMinutes(session) {
    const minutes = getSessionResponseMinutes(session);
    return minutes.toFixed(1);
}

function formatAvgSeconds(avgMs) {
    const ms = Number(avgMs);
    if (!Number.isFinite(ms)) return '0.00';
    return (Math.max(0, ms) / 1000).toFixed(2);
}

function safeNum(value) {
    const num = Number(value);
    return Number.isFinite(num) ? num : 0;
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

function getSessionDurationMinutes(session) {
    if (!session || typeof session !== 'object') return 0;
    const start = parseUtcTimestamp(session.started_at);
    const end = parseUtcTimestamp(session.completed_at);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
        return 0;
    }
    return Math.max(0, (end.getTime() - start.getTime()) / 60000);
}

function getSessionResponseMinutes(session) {
    if (!session || typeof session !== 'object') return 0;
    const totalResponseMs = Number(session.total_response_ms);
    if (!Number.isFinite(totalResponseMs)) {
        return 0;
    }
    return Math.max(0, totalResponseMs / 60000);
}

function summarizeSessions(sessions) {
    const list = Array.isArray(sessions) ? sessions : [];
    return {
        count: list.length,
        elapsedMinutes: list.reduce((sum, session) => sum + getSessionDurationMinutes(session), 0),
        activeMinutes: list.reduce((sum, session) => sum + getSessionResponseMinutes(session), 0),
    };
}

function shiftDateKey(dateKey, deltaDays) {
    const text = String(dateKey || '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
        return '';
    }
    const dt = new Date(`${text}T00:00:00Z`);
    if (Number.isNaN(dt.getTime())) {
        return '';
    }
    const delta = Number.parseInt(deltaDays, 10) || 0;
    dt.setUTCDate(dt.getUTCDate() + delta);
    const y = dt.getUTCFullYear();
    const m = String(dt.getUTCMonth() + 1).padStart(2, '0');
    const d = String(dt.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
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

function escapeHtml(raw) {
    return String(raw || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}
