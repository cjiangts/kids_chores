const API_BASE = `${window.location.origin}/api`;

const params = new URLSearchParams(window.location.search);
const kidId = params.get('id');
const cardId = params.get('cardId');
const from = params.get('from');

const pageTitle = document.getElementById('pageTitle');
const backBtn = document.getElementById('backBtn');
const errorMessage = document.getElementById('errorMessage');
const summaryGrid = document.getElementById('summaryGrid');
const trendChart = document.getElementById('trendChart');
const historyList = document.getElementById('historyList');
let reportTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

document.addEventListener('DOMContentLoaded', async () => {
    if (!kidId || !cardId) {
        window.location.href = '/admin.html';
        return;
    }

    backBtn.href = resolveBackHref();
    await loadCardReport();
});

function resolveBackHref() {
    if (from === 'reading') {
        return `/kid-reading-manage.html?id=${encodeURIComponent(kidId)}`;
    }
    if (from === 'writing') {
        return `/kid-writing-manage.html?id=${encodeURIComponent(kidId)}`;
    }
    if (from === 'math') {
        return `/kid-math-manage.html?id=${encodeURIComponent(kidId)}`;
    }
    return `/admin.html`;
}

async function loadCardReport() {
    try {
        showError('');
        await loadReportTimezone();
        const response = await fetch(`${API_BASE}/kids/${kidId}/report/cards/${cardId}`);
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }

        const data = await response.json();
        const kidName = data.kid?.name || 'Kid';
        const card = data.card || {};
        const attempts = Array.isArray(data.attempts) ? data.attempts : [];
        const summary = data.summary || {};

        const cardLabel = String(card.back || card.front || `#${card.id || cardId}`).trim();
        pageTitle.textContent = `${kidName} · Card ${cardLabel}`;

        renderSummary(card, summary);
        renderTrend(attempts);
        renderHistory(attempts);
    } catch (error) {
        console.error('Error loading card report:', error);
        showError('Failed to load card report.');
    }
}

async function loadReportTimezone() {
    try {
        const response = await fetch(`${API_BASE}/parent-settings/timezone`);
        if (!response.ok) {
            return;
        }
        const data = await response.json().catch(() => ({}));
        const tz = String(data.familyTimezone || '').trim();
        if (tz) {
            reportTimezone = tz;
        }
    } catch (error) {
        // Keep browser timezone fallback.
    }
}

function renderSummary(card, summary) {
    const attempts = safeNum(summary.attempt_count);
    const right = safeNum(summary.right_count);
    const wrong = safeNum(summary.wrong_count);
    const avgSeconds = Math.max(0, Number(summary.avg_response_ms) || 0) / 1000;
    const accuracy = Math.max(0, Number(summary.accuracy_pct) || 0);

    summaryGrid.innerHTML = `
        <div class="summary-card"><div class="label">Card</div><div class="value">${escapeHtml(card.back || card.front || '-')}</div></div>
        <div class="summary-card"><div class="label">Attempts</div><div class="value">${attempts}</div></div>
        <div class="summary-card"><div class="label">Right / Wrong</div><div class="value">${right} / ${wrong}</div></div>
        <div class="summary-card"><div class="label">Accuracy</div><div class="value">${accuracy.toFixed(1)}%</div></div>
        <div class="summary-card"><div class="label">Avg Time</div><div class="value">${avgSeconds.toFixed(2)}s</div></div>
        <div class="summary-card"><div class="label">Hardness</div><div class="value">${Number(card.hardness_score || 0).toFixed(2)}</div></div>
    `;
}

function renderTrend(attempts) {
    if (!attempts.length) {
        trendChart.innerHTML = `<div class="chart-empty">No attempts yet for this card.</div>`;
        return;
    }

    const maxMs = Math.max(...attempts.map((item) => Math.max(0, Number(item.response_time_ms) || 0)), 1);
    const minHeight = 6;
    const bars = attempts.map((item, index) => {
        const rawMs = Math.max(0, Number(item.response_time_ms) || 0);
        const scaled = Math.max(minHeight, Math.round((rawMs / maxMs) * 170));
        const label = `${(rawMs / 1000).toFixed(2)}s · ${formatDateTime(item.session_completed_at || item.session_started_at || item.timestamp)}`;
        return `<div class="trend-bar ${item.correct ? 'right' : 'wrong'}" title="${escapeHtml(`#${index + 1} ${label}`)}" style="height:${scaled}px"></div>`;
    }).join('');

    trendChart.innerHTML = `
        <div class="trend-bars">${bars}</div>
        <div class="chart-legend">Each bar is one attempt in time order. Height = response time. Green = right, red = wrong.</div>
    `;
}

function renderHistory(attempts) {
    if (!attempts.length) {
        historyList.innerHTML = `<div class="chart-empty">No practice history yet.</div>`;
        return;
    }

    const sorted = [...attempts].sort((a, b) => {
        const aTime = parseUtcTimestamp(a?.session_completed_at || a?.session_started_at || a?.timestamp).getTime();
        const bTime = parseUtcTimestamp(b?.session_completed_at || b?.session_started_at || b?.timestamp).getTime();
        return bTime - aTime;
    });

    historyList.innerHTML = sorted.map((item) => {
        const rawMs = Math.max(0, Number(item.response_time_ms) || 0);
        const seconds = (rawMs / 1000).toFixed(2);
        const statusClass = item.correct ? 'right' : 'wrong';
        const statusText = item.correct ? 'Right' : 'Wrong';
        return `
            <div class="history-item">
                ${formatType(item.session_type)} · ${seconds}s
                <span class="pill ${statusClass}">${statusText}</span>
                <div class="meta">
                    ${formatDateTime(item.session_completed_at || item.session_started_at || item.timestamp)}
                    · Session #${safeNum(item.session_id)}
                </div>
            </div>
        `;
    }).join('');
}

function formatType(type) {
    if (type === 'flashcard') return 'Chinese Reading';
    if (type === 'math') return 'Math';
    if (type === 'writing') return 'Chinese Writing';
    return String(type || '-');
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

function parseUtcTimestamp(raw) {
    if (!raw) return new Date(NaN);
    const text = String(raw).trim();
    if (!text) return new Date(NaN);
    const hasZone = /(?:Z|[+\-]\d{2}:\d{2})$/.test(text);
    return new Date(hasZone ? text : `${text}Z`);
}

function safeNum(value) {
    const num = Number(value);
    return Number.isFinite(num) ? num : 0;
}

function escapeHtml(text) {
    return String(text || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function showError(message) {
    if (message) {
        errorMessage.textContent = message;
        errorMessage.classList.remove('hidden');
    } else {
        errorMessage.classList.add('hidden');
    }
}
