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
        return `/kid-math-manage-v2.html?id=${encodeURIComponent(kidId)}`;
    }
    if (from === 'lesson-reading') {
        return `/kid-lesson-reading-manage.html?id=${encodeURIComponent(kidId)}`;
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

        const cardLabel = getCardDisplayLabel(card.front, card.back, from) || `#${card.id || cardId}`;
        pageTitle.textContent = `${kidName} · Card ${cardLabel}`;

        renderSummary(card, summary, attempts);
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

function renderSummary(card, summary, attempts) {
    const attemptsCount = safeNum(summary.attempt_count);
    const right = safeNum(summary.right_count);
    const wrong = safeNum(summary.wrong_count);
    const bestMs = Array.isArray(attempts) && attempts.length > 0
        ? attempts.reduce((best, item) => {
            const value = Math.max(0, Number(item?.response_time_ms) || 0);
            return value < best ? value : best;
        }, Number.POSITIVE_INFINITY)
        : Number.POSITIVE_INFINITY;
    const bestTimeLabel = Number.isFinite(bestMs) ? formatResponseTime(bestMs) : '-';

    summaryGrid.innerHTML = `
        <div class="summary-card"><div class="label">Card</div><div class="value">${escapeHtml(getCardDisplayLabel(card.front, card.back, from) || '-')}</div></div>
        <div class="summary-card"><div class="label">Attempts</div><div class="value">${attemptsCount}</div></div>
        <div class="summary-card"><div class="label">Right / Wrong</div><div class="value">${right} / ${wrong}</div></div>
        <div class="summary-card"><div class="label">Best Time</div><div class="value">${bestTimeLabel}</div></div>
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
        const label = `${formatResponseTime(rawMs)} · ${formatDateTime(item.session_completed_at || item.session_started_at || item.timestamp)}`;
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
        const responseTimeLabel = formatResponseTime(rawMs);
        const statusClass = item.correct ? 'right' : 'wrong';
        const statusText = item.correct ? 'Right' : 'Wrong';
        return `
            <div class="history-item">
                ${formatType(item.session_type)} · ${responseTimeLabel}
                <span class="pill ${statusClass}">${statusText}</span>
                <div class="meta">
                    ${formatDateTime(item.session_completed_at || item.session_started_at || item.timestamp)}
                    · Session #${safeNum(item.session_id)}
                </div>
                ${item.audio_url ? `<audio class="attempt-audio" controls preload="none" src="${escapeHtml(item.audio_url)}"></audio>` : ''}
            </div>
        `;
    }).join('');
}

function formatResponseTime(ms) {
    const rawMs = Math.max(0, Number(ms) || 0);
    if (from === 'lesson-reading') {
        const totalSeconds = Math.floor(rawMs / 1000);
        const minutes = Math.floor(totalSeconds / 60);
        const seconds = totalSeconds % 60;
        return `${minutes}:${String(seconds).padStart(2, '0')}`;
    }
    return `${(rawMs / 1000).toFixed(2)}s`;
}

function formatType(type) {
    if (type === 'flashcard') return 'Chinese Characters';
    if (type === 'math') return 'Math';
    if (type === 'writing') return 'Chinese Writing';
    if (type === 'lesson_reading') return 'Chinese Reading';
    return String(type || '-');
}

function getCardDisplayLabel(front, back, source) {
    const frontText = String(front || '').trim();
    const backText = String(back || '').trim();

    if (source === 'math') {
        return frontText || backText;
    }
    if (source === 'lesson-reading') {
        return frontText || backText;
    }
    if (source === 'reading') {
        return frontText || backText;
    }
    if (source === 'writing') {
        return backText || frontText;
    }

    return backText || frontText;
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
