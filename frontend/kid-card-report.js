const API_BASE = `${window.location.origin}/api`;

const params = new URLSearchParams(window.location.search);
const kidId = params.get('id');
const cardId = params.get('cardId');
const from = params.get('from');
const categoryKey = String(params.get('categoryKey') || '').trim().toLowerCase();

const pageTitle = document.getElementById('pageTitle');
const backBtn = document.getElementById('backBtn');
const errorMessage = document.getElementById('errorMessage');
const summaryGrid = document.getElementById('summaryGrid');
const trendChart = document.getElementById('trendChart');
const historyList = document.getElementById('historyList');
const {
    SESSION_TYPE_CHINESE_CHARACTERS,
} = window.DeckCategoryCommon;
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
    const type1Category = categoryKey || (from === 'reading' ? SESSION_TYPE_CHINESE_CHARACTERS : 'math');
    if (from === 'reading' || from === 'cards') {
        const qs = new URLSearchParams();
        qs.set('id', String(kidId || ''));
        if (type1Category) {
            qs.set('categoryKey', type1Category);
        }
        return `/kid-card-manage.html?${qs.toString()}`;
    }
    if (from === 'type2' || from === 'writing') {
        const qs = new URLSearchParams();
        qs.set('id', String(kidId || ''));
        if (categoryKey) {
            qs.set('categoryKey', categoryKey);
        }
        return `/kid-card-manage.html?${qs.toString()}`;
    }
    if (from === 'lesson-reading') {
        const qs = new URLSearchParams();
        qs.set('id', String(kidId || ''));
        if (categoryKey) {
            qs.set('categoryKey', categoryKey);
        }
        return `/kid-card-manage.html?${qs.toString()}`;
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
        document.title = `${kidName} - Card Report - Kids Daily Chores`;

        renderSummary(card, summary, attempts);
        renderTrend(attempts);
        renderHistory(attempts);
    } catch (error) {
        console.error('Error loading card report:', error);
        showError('Failed to load card report.');
        document.title = 'Card Report - Kids Daily Chores';
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
        // Keep browser timezone.
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
        const lessonReadingAudioAttrs = from === 'lesson-reading'
            ? ` data-result-id="${Number.isFinite(Number(item.result_id)) ? Number(item.result_id) : ''}" data-response-time-ms="${rawMs}"`
            : '';
        return `
            <div class="history-item">
                ${formatType(item.session_category_display_name)} · ${responseTimeLabel}
                <span class="pill ${statusClass}">${statusText}</span>
                <div class="meta">
                    ${formatDateTime(item.session_completed_at || item.session_started_at || item.timestamp)}
                    · Session #${safeNum(item.session_id)}
                </div>
                ${item.audio_url ? `<audio class="attempt-audio" controls preload="none" src="${escapeHtml(item.audio_url)}"${lessonReadingAudioAttrs}></audio>` : ''}
            </div>
        `;
    }).join('');

    if (from === 'lesson-reading' && window.LessonReadingDurationBackfill) {
        window.LessonReadingDurationBackfill.attach(historyList, { kidId });
    }
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

function formatType(sessionCategoryDisplayName = '') {
    return String(sessionCategoryDisplayName || '').trim();
}

function getCardDisplayLabel(front, back, source) {
    const frontText = String(front || '').trim();
    const backText = String(back || '').trim();

    if (source === 'cards') {
        return frontText || backText;
    }
    if (source === 'lesson-reading') {
        return frontText || backText;
    }
    if (source === 'reading') {
        return frontText || backText;
    }
    if (source === 'type2' || source === 'writing') {
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
