const API_BASE = `${window.location.origin}/api`;

const params = new URLSearchParams(window.location.search);
const kidId = params.get('id');

const reportTitle = document.getElementById('reportTitle');
const errorMessage = document.getElementById('errorMessage');
const summaryGrid = document.getElementById('summaryGrid');
const dailyChartBody = document.getElementById('dailyChartBody');
const reportBody = document.getElementById('reportBody');
const startedHeader = document.getElementById('startedHeader');
let reportTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

document.addEventListener('DOMContentLoaded', async () => {
    if (!kidId) {
        window.location.href = '/admin.html';
        return;
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
    const total = sessions.length;
    const readingSessions = sessions.filter((s) => s.type === 'flashcard');
    const mathSessions = sessions.filter((s) => s.type === 'math');
    const writingSessions = sessions.filter((s) => s.type === 'writing');
    const reading = readingSessions.length;
    const math = mathSessions.length;
    const writing = writingSessions.length;
    const totalMinutes = sessions.reduce((sum, session) => sum + getSessionDurationMinutes(session), 0);
    const readingMinutes = readingSessions.reduce((sum, session) => sum + getSessionDurationMinutes(session), 0);
    const mathMinutes = mathSessions.reduce((sum, session) => sum + getSessionDurationMinutes(session), 0);
    const writingMinutes = writingSessions.reduce((sum, session) => sum + getSessionDurationMinutes(session), 0);

    summaryGrid.innerHTML = `
        <div class="summary-card"><div class="label">Total Sessions</div><div class="value">${total}</div><div class="label">${totalMinutes.toFixed(2)} min</div></div>
        <div class="summary-card"><div class="label">Chinese Characters</div><div class="value">${reading}</div><div class="label">${readingMinutes.toFixed(2)} min</div></div>
        <div class="summary-card"><div class="label">Math</div><div class="value">${math}</div><div class="label">${mathMinutes.toFixed(2)} min</div></div>
        <div class="summary-card"><div class="label">Chinese Writing</div><div class="value">${writing}</div><div class="label">${writingMinutes.toFixed(2)} min</div></div>
    `;
}

function renderTable(sessions) {
    if (sessions.length === 0) {
        reportBody.innerHTML = `<tr><td colspan="10" style="color:#666;">No practice sessions yet.</td></tr>`;
        return;
    }

    reportBody.innerHTML = sessions.map((session) => `
        <tr>
            <td>#${safeNum(session.id)}</td>
            <td>${renderType(session.type)}</td>
            <td>${formatDateTime(session.started_at)}</td>
            <td>${formatDurationMinutes(session)}</td>
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
        const minutes = getSessionDurationMinutes(session);
        const dayKey = formatDateKey(session.started_at || session.completed_at);
        if (!dayKey) return;

        if (!dailyMap.has(dayKey)) {
            dailyMap.set(dayKey, { reading: 0, math: 0, writing: 0, total: 0 });
        }
        const row = dailyMap.get(dayKey);
        if (session.type === 'flashcard') row.reading += minutes;
        if (session.type === 'math') row.math += minutes;
        if (session.type === 'writing') row.writing += minutes;
        row.total += minutes;
    });

    const rows = Array.from(dailyMap.entries())
        .map(([date, v]) => ({ date, ...v }))
        .sort((a, b) => b.date.localeCompare(a.date));

    if (rows.length === 0) {
        dailyChartBody.innerHTML = `<div style="color:#666;font-size:0.9rem;">No completed practice time yet.</div>`;
        return;
    }

    const maxTotal = Math.max(...rows.map((r) => r.total), 1);
    dailyChartBody.innerHTML = rows.map((row) => {
        const readingPct = (row.reading / maxTotal) * 100;
        const mathPct = (row.math / maxTotal) * 100;
        const writingPct = (row.writing / maxTotal) * 100;
        return `
            <div class="daily-row">
                <div class="daily-date">${row.date}</div>
                <div class="daily-bar-track">
                    <div class="daily-seg-reading" style="width:${readingPct.toFixed(2)}%"></div>
                    <div class="daily-seg-math" style="width:${mathPct.toFixed(2)}%"></div>
                    <div class="daily-seg-writing" style="width:${writingPct.toFixed(2)}%"></div>
                </div>
                <div class="daily-values">R ${row.reading.toFixed(2)} · M ${row.math.toFixed(2)} · W ${row.writing.toFixed(2)} · T ${row.total.toFixed(2)}</div>
            </div>
        `;
    }).join('');
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
    return minutes.toFixed(2);
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
    const wallClockMinutes = (!Number.isNaN(start.getTime()) && !Number.isNaN(end.getTime()))
        ? Math.max(0, (end.getTime() - start.getTime()) / 60000)
        : 0;
    const responseMs = Math.max(0, Number(session.total_response_ms) || 0);
    const responseMinutes = responseMs / 60000;
    return Math.max(wallClockMinutes, responseMinutes);
}

function showError(message) {
    if (message) {
        errorMessage.textContent = message;
        errorMessage.classList.remove('hidden');
    } else {
        errorMessage.classList.add('hidden');
    }
}
