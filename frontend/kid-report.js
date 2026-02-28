const API_BASE = `${window.location.origin}/api`;

const params = new URLSearchParams(window.location.search);
const kidId = params.get('id');

const reportTitle = document.getElementById('reportTitle');
const errorMessage = document.getElementById('errorMessage');
const summaryGrid = document.getElementById('summaryGrid');
const dailyChartBody = document.getElementById('dailyChartBody');
const dailyChartNewerBtn = document.getElementById('dailyChartNewerBtn');
const dailyChartOlderBtn = document.getElementById('dailyChartOlderBtn');
const dailyChartPageLabel = document.getElementById('dailyChartPageLabel');
const reportBody = document.getElementById('reportBody');
const startedHeader = document.getElementById('startedHeader');
let reportTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
let dailyChartRows = [];
let dailyChartPageIndex = 0;
let reportSessions = [];
const DAILY_CHART_PAGE_SIZE = 7;

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
        // Keep browser timezone fallback.
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
        reportBody.innerHTML = `<tr><td colspan="9" style="color:#666;">No practice sessions yet.</td></tr>`;
        return;
    }

    reportBody.innerHTML = view.pageItems.map((session) => `
        <tr>
            <td>#${safeNum(session.id)}</td>
            <td>${renderType(session.type)}</td>
            <td>${formatDateTime(session.started_at)}</td>
            <td>${formatDurationMinutes(session)}</td>
            <td>${formatResponseMinutes(session)}</td>
            <td>${safeNum(session.answer_count)}</td>
            <td>${safeNum(session.right_count)}</td>
            <td>${safeNum(session.wrong_count)}</td>
            <td><a href="/kid-session-report.html?id=${encodeURIComponent(kidId)}&sessionId=${encodeURIComponent(session.id)}" class="tab-link secondary" style="padding:0.3rem 0.55rem; font-size:0.78rem;">View</a></td>
        </tr>
    `).join('');
}

function renderDailyMinutesChart(sessions) {
    const dailyMap = new Map();

    sessions.forEach((session) => {
        const minutes = getSessionResponseMinutes(session);
        const dayKey = formatDateKey(session.started_at || session.completed_at);
        if (!dayKey) return;

        if (!dailyMap.has(dayKey)) {
            dailyMap.set(dayKey, { reading: 0, math: 0, writing: 0, lessonReading: 0, total: 0 });
        }
        const row = dailyMap.get(dayKey);
        if (session.type === 'flashcard') row.reading += minutes;
        if (session.type === 'math') row.math += minutes;
        if (session.type === 'writing') row.writing += minutes;
        if (session.type === 'lesson_reading') row.lessonReading += minutes;
        row.total += minutes;
    });

    dailyChartRows = Array.from(dailyMap.entries())
        .map(([date, v]) => ({ date, ...v }))
        .sort((a, b) => b.date.localeCompare(a.date));

    dailyChartPageIndex = 0;
    renderDailyMinutesChartPage();
}

function renderDailyMinutesChartPage() {
    const rows = Array.isArray(dailyChartRows) ? dailyChartRows : [];
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
        const readingPct = (row.reading / maxTotal) * 100;
        const mathPct = (row.math / maxTotal) * 100;
        const writingPct = (row.writing / maxTotal) * 100;
        const lessonReadingPct = (row.lessonReading / maxTotal) * 100;
        return `
            <div class="daily-row">
                <div class="daily-date">${row.date}</div>
                <div class="daily-bar-track">
                    ${renderDailyMinutesSegment('daily-seg-reading', 'Characters', row.reading, readingPct)}
                    ${renderDailyMinutesSegment('daily-seg-math', 'Math', row.math, mathPct)}
                    ${renderDailyMinutesSegment('daily-seg-writing', 'Writing', row.writing, writingPct)}
                    ${renderDailyMinutesSegment('daily-seg-lesson-reading', 'Reading', row.lessonReading, lessonReadingPct)}
                </div>
                <div class="daily-total">${row.total.toFixed(1)} min</div>
            </div>
        `;
    }).join('');
}

function renderDailyMinutesSegment(segmentClass, label, minutes, pct) {
    const safeMinutes = Number.isFinite(Number(minutes)) ? Math.max(0, Number(minutes)) : 0;
    const safePct = Number.isFinite(Number(pct)) ? Math.max(0, Number(pct)) : 0;
    if (safeMinutes <= 0 || safePct <= 0) {
        return '';
    }
    const minuteText = safeMinutes.toFixed(1);
    const tinyClass = safePct < 5 ? ' daily-seg-tiny' : '';
    return `
        <div class="${segmentClass}${tinyClass}" style="width:${safePct.toFixed(2)}%" title="${label} ${minuteText} min">
            <span class="daily-seg-min">${minuteText}</span>
        </div>
    `;
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

function renderType(type) {
    if (type === 'flashcard') {
        return '<span class="type-pill type-reading">Chinese Characters</span>';
    }
    if (type === 'math') {
        return '<span class="type-pill type-math">Math</span>';
    }
    if (type === 'writing') {
        return '<span class="type-pill type-writing">Chinese Writing</span>';
    }
    if (type === 'lesson_reading') {
        return '<span class="type-pill type-lesson-reading">Chinese Reading</span>';
    }
    return '<span class="type-pill">Unknown</span>';
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
