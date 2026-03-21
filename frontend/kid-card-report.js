const API_BASE = `${window.location.origin}/api`;

const params = new URLSearchParams(window.location.search);
const kidId = params.get('id');
const cardId = params.get('cardId');
const from = params.get('from');
const categoryKey = window.DeckCategoryCommon.normalizeCategoryKey(params.get('categoryKey'));
const hashResultMatch = String(window.location.hash || '').match(/^#result-(\d+)$/);
const targetResultId = Number.parseInt(
    params.get('resultId')
    || (hashResultMatch ? hashResultMatch[1] : ''),
    10
);
const BEHAVIOR_TYPE_I = 'type_i';
const BEHAVIOR_TYPE_II = 'type_ii';
const BEHAVIOR_TYPE_III = 'type_iii';
const BEHAVIOR_TYPE_IV = 'type_iv';

const pageTitle = document.getElementById('pageTitle');
const backBtn = document.getElementById('backBtn');
const errorMessage = document.getElementById('errorMessage');
const summaryGrid = document.getElementById('summaryGrid');
const trendChart = document.getElementById('trendChart');
const historyList = document.getElementById('historyList');
let reportTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
let currentKidName = '';
let currentCardFront = '';
let currentCardBack = '';
let currentDeckName = '';
let trendAttemptsFull = [];
let trendResizeRafId = 0;

document.addEventListener('DOMContentLoaded', async () => {
    if (!kidId || !cardId) {
        window.location.href = '/admin.html';
        return;
    }

    bindBackButton();
    bindTrendResize();
    await loadCardReport();
});

function bindBackButton() {
    window.ReportBackButtonCommon?.bindBackButton(backBtn, resolveBackHref());
}

function resolveBackHref() {
    if (from === 'cards') {
        const qs = new URLSearchParams();
        qs.set('id', String(kidId || ''));
        if (categoryKey) {
            qs.set('categoryKey', categoryKey);
        }
        return `/kid-card-manage.html?${qs.toString()}`;
    }
    if (from === 'type2') {
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
        currentKidName = String(kidName || '').trim();
        currentCardFront = String(card.front || '').trim();
        currentCardBack = String(card.back || '').trim();
        currentDeckName = String(card.deck_name || '').trim();

        const cardLabel = getCardDisplayLabel(card.front, card.back, from) || `#${card.id || cardId}`;
        pageTitle.textContent = `${kidName} · Card ${cardLabel}`;
        document.title = `${kidName} - Card Report - Kids Daily Chores`;

        renderSummary(card, summary, attempts);
        trendAttemptsFull = attempts;
        renderTrend(trendAttemptsFull);
        renderHistory(attempts);
        scrollToTargetAttempt();
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
    let avgMs = Math.max(0, Number(summary?.avg_response_ms) || 0);
    if (from === 'lesson-reading' && Array.isArray(attempts) && attempts.length) {
        const passed = attempts.filter((a) => a?.grade_status === 'pass');
        if (passed.length) {
            const sum = passed.reduce((s, a) => s + getAttemptDisplayResponseMs(a), 0);
            avgMs = sum / passed.length;
        } else {
            avgMs = 0;
        }
    }
    const avgTimeLabel = avgMs > 0 ? formatResponseTime(avgMs) : '-';

    summaryGrid.innerHTML = `
        <div class="summary-card"><div class="label">Card</div><div class="value">${escapeHtml(getCardDisplayLabel(card.front, card.back, from) || '-')}</div></div>
        <div class="summary-card"><div class="label">Attempts</div><div class="value">${attemptsCount}</div></div>
        <div class="summary-card"><div class="label">Right / Wrong</div><div class="value">${right} / ${wrong}</div></div>
        <div class="summary-card"><div class="label">Avg Time</div><div class="value">${avgTimeLabel}</div></div>
    `;
}

function renderTrend(attempts) {
    if (!attempts.length) {
        trendChart.innerHTML = `<div class="chart-empty">No attempts yet for this card.</div>`;
        return;
    }

    const totalCount = attempts.length;
    const shownAttempts = getTrendVisibleAttempts(attempts);
    const shownCount = shownAttempts.length;
    const maxMs = Math.max(...shownAttempts.map((item) => getAttemptDisplayResponseMs(item)), 1);
    const trendUseMinutesUnit = maxMs >= 60000;
    const minHeight = 6;
    const firstVisibleIndex = totalCount - shownCount;
    const bars = shownAttempts.map((item, index) => {
        const rawMs = getAttemptDisplayResponseMs(item);
        const scaled = Math.max(minHeight, Math.round((rawMs / maxMs) * 170));
        const responseLabel = formatTrendResponseTime(rawMs, trendUseMinutesUnit);
        const label = `${formatResponseTime(rawMs)} · ${formatDateTime(item.session_completed_at || item.session_started_at || item.timestamp)}`;
        const correctness = resolveCorrectness(item);
        return `
            <div class="trend-col">
                <div class="trend-value">${escapeHtml(responseLabel)}</div>
                <div class="trend-bar ${correctness}" title="${escapeHtml(`#${firstVisibleIndex + index + 1} ${label}`)}" style="height:${scaled}px"></div>
            </div>
        `;
    }).join('');
    const windowNote = totalCount > shownCount
        ? ` Showing latest ${shownCount} of ${totalCount} attempts to fit screen.`
        : '';
    const hasFixed = shownAttempts.some((item) => resolveCorrectness(item) === 'fixed');
    const hasHalf = shownAttempts.some((item) => resolveCorrectness(item) === 'half');
    const hasPending = shownAttempts.some((item) => resolveCorrectness(item) === 'pending');
    const legendBits = ['Green = right first try', 'red = wrong'];
    if (hasFixed) {
        legendBits.push('yellow = fixed in retry');
    }
    if (hasHalf) {
        legendBits.push('purple = half right');
    }
    if (hasPending) {
        legendBits.push('gray = ungraded');
    }

    trendChart.innerHTML = `
        <div class="trend-bars">${bars}</div>
        <div class="chart-legend">Each bar is one attempt in time order. Height = average response time. ${legendBits.join(', ')}.${windowNote}</div>
    `;
}

function getTrendVisibleAttempts(attempts) {
    const list = Array.isArray(attempts) ? attempts : [];
    if (list.length <= 1) {
        return list;
    }
    const containerWidth = Math.max(
        Number(trendChart?.clientWidth || 0),
        Number(trendChart?.getBoundingClientRect?.().width || 0)
    );
    if (!Number.isFinite(containerWidth) || containerWidth <= 120) {
        return list;
    }
    const colWidthPx = 29;
    const colGapPx = 3;
    const innerPaddingPx = 14; // 6px + 6px horizontal padding + borders
    const availableWidth = Math.max(0, containerWidth - innerPaddingPx);
    const maxVisible = Math.max(
        6,
        Math.floor((availableWidth + colGapPx) / (colWidthPx + colGapPx))
    );
    if (list.length <= maxVisible) {
        return list;
    }
    return list.slice(list.length - maxVisible);
}

function bindTrendResize() {
    window.addEventListener('resize', () => {
        if (!trendAttemptsFull.length) {
            return;
        }
        if (trendResizeRafId) {
            window.cancelAnimationFrame(trendResizeRafId);
        }
        trendResizeRafId = window.requestAnimationFrame(() => {
            trendResizeRafId = 0;
            renderTrend(trendAttemptsFull);
        });
    });
}

function formatTrendResponseTime(ms, useMinutesUnit) {
    const rawMs = Math.max(0, Number(ms) || 0);
    if (useMinutesUnit) {
        const totalSeconds = Math.round(rawMs / 1000);
        const minutes = Math.floor(totalSeconds / 60);
        const seconds = totalSeconds % 60;
        return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
    }
    return `${(rawMs / 1000).toFixed(1)}s`;
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
        const rawMs = getAttemptDisplayResponseMs(item);
        const responseTimeLabel = formatResponseTime(rawMs);
        const correctness = resolveCorrectness(item);
        const statusClass = correctness;
        const statusText = getCorrectnessLabel(correctness);
        const lessonReadingAudioAttrs = from === 'lesson-reading'
            ? ` data-result-id="${Number.isFinite(Number(item.result_id)) ? Number(item.result_id) : ''}" data-response-time-ms="${Math.round(rawMs)}"`
            : '';
        const downloadFilename = buildAudioDownloadFilename(item);
        const downloadUrl = buildAudioDownloadUrl(item, downloadFilename);
        const downloadButtonHtml = item.audio_url
            ? `<a class="tab-link secondary mini-link-btn answer-report-link audio-download-link" href="${escapeHtml(downloadUrl)}" download="${escapeHtml(downloadFilename)}">Download</a>`
            : '';
        const audioBlockHtml = item.audio_url
            ? `
                <div class="audio-history-row">
                    <audio class="attempt-audio js-simple-audio" preload="metadata" src="${escapeHtml(item.audio_url)}"${lessonReadingAudioAttrs}></audio>
                </div>
            `
            : '';
        if (isType3Attempt(item)) {
            const resultIdAttr = Number.isFinite(Number(item?.result_id)) ? Number(item.result_id) : null;
            const sourceDeckLabel = formatSourceDeckLabel(currentDeckName);
            const detailBits = [];
            if (currentCardBack) {
                detailBits.push(`<span class="answer-type3-back">${escapeHtml(currentCardBack)}</span>`);
            }
            if (sourceDeckLabel) {
                detailBits.push(`<span class="answer-type3-source">Source: ${escapeHtml(sourceDeckLabel)}</span>`);
            }
            const detailHtml = detailBits.length
                ? `<div class="answer-type3-details">${detailBits.join('<span class="answer-type3-sep" aria-hidden="true">·</span>')}</div>`
                : '';
            return `
                <div class="history-item type3-history-item"${resultIdAttr !== null ? ` id="result-${resultIdAttr}" data-result-id="${resultIdAttr}"` : ''}>
                    <div class="history-head-row">
                        <div class="history-title-stack">
                            <div class="history-primary chinese-specific">${escapeHtml(currentCardFront || 'Card')}</div>
                            ${detailHtml}
                        </div>
                        <div class="answer-head-actions">
                            ${renderType3HistoryStatusHtml(correctness)}
                            ${downloadButtonHtml}
                        </div>
                    </div>
                    ${audioBlockHtml}
                    <div class="meta">
                        ${formatDateTime(item.session_completed_at || item.session_started_at || item.timestamp)}
                        · Session #${safeNum(item.session_id)}
                    </div>
                </div>
            `;
        }
        if (isType4Attempt(item)) {
            const prompt = getType4AttemptPrompt(item);
            const answer = getType4AttemptAnswer(item) || '-';
            const submittedPills = getType4AttemptSubmittedPills(item);
            const resultIdAttr = Number.isFinite(Number(item?.result_id)) ? Number(item.result_id) : null;
            return `
                <div class="history-item"${resultIdAttr !== null ? ` id="result-${resultIdAttr}" data-result-id="${resultIdAttr}"` : ''}>
                    <div class="history-head-row">
                        <div class="history-title-stack">
                            <div class="history-primary">${escapeHtml(prompt)} <span class="history-type4-pill answer-pill">${escapeHtml(answer)}</span></div>
                            <div class="history-type4-details">
                                ${submittedPills}
                            </div>
                        </div>
                        <div class="history-status-side">
                            <div class="history-time-badge">Avg ${escapeHtml(responseTimeLabel)}</div>
                            <span class="pill ${statusClass}">${statusText}</span>
                        </div>
                    </div>
                    <div class="meta">
                        ${formatDateTime(item.session_completed_at || item.session_started_at || item.timestamp)}
                        · Session #${safeNum(item.session_id)}
                    </div>
                </div>
            `;
        }
        const resultIdAttr = Number.isFinite(Number(item?.result_id)) ? Number(item.result_id) : null;
        const retryFixCount = getRetryFixCount(item);
        const retryBadgeHtml = retryFixCount > 0
            ? `<span class="history-retry-badge" title="${escapeHtml(getRetryFixLabel(retryFixCount))}">${escapeHtml(getRetryFixShortLabel(retryFixCount))}</span>`
            : '';
        return `
            <div class="history-item"${resultIdAttr !== null ? ` id="result-${resultIdAttr}" data-result-id="${resultIdAttr}"` : ''}>
                <div class="history-head-row">
                    <div class="history-title-stack">
                        <div class="history-primary">${escapeHtml(formatType(item.session_category_display_name))}</div>
                        <div class="meta-inline">${escapeHtml(responseTimeLabel)}</div>
                    </div>
                    <div class="history-status-side">
                        ${retryBadgeHtml}
                        <span class="pill ${statusClass}">${statusText}</span>
                        ${downloadButtonHtml}
                    </div>
                </div>
                <div class="meta">
                    ${formatDateTime(item.session_completed_at || item.session_started_at || item.timestamp)}
                    · Session #${safeNum(item.session_id)}
                </div>
                ${audioBlockHtml}
            </div>
        `;
    }).join('');

    if (from === 'lesson-reading' && window.LessonReadingDurationBackfill) {
        window.LessonReadingDurationBackfill.attach(historyList, { kidId });
    }
    if (window.SimpleAudioPlayer) {
        window.SimpleAudioPlayer.attach(historyList, { selector: 'audio.js-simple-audio' });
    }
}

function scrollToTargetAttempt() {
    if (!Number.isFinite(targetResultId) || targetResultId <= 0 || !historyList) {
        return;
    }
    const targetId = `result-${targetResultId}`;
    const tryScroll = (behavior = 'smooth') => {
        const target = document.getElementById(targetId)
            || historyList.querySelector(`.history-item[data-result-id="${targetResultId}"]`);
        if (!target) {
            return false;
        }
        historyList.querySelectorAll('.history-item.targeted-history-item').forEach((node) => {
            if (node !== target) {
                node.classList.remove('targeted-history-item');
            }
        });
        target.classList.add('targeted-history-item');
        const rect = target.getBoundingClientRect();
        const targetTop = Math.max(
            0,
            rect.top + window.scrollY - Math.max(24, (window.innerHeight - rect.height) / 2)
        );
        window.scrollTo({ top: targetTop, behavior });
        return true;
    };

    window.requestAnimationFrame(() => {
        tryScroll('auto');
        window.setTimeout(() => { tryScroll('smooth'); }, 140);
        window.setTimeout(() => { tryScroll('smooth'); }, 420);
    });
}

function resolveCorrectness(item) {
    const scoreRaw = Number(item?.correct_score);
    if (Number.isFinite(scoreRaw)) {
        if (scoreRaw === 1) return 'right';
        if (scoreRaw === 2) return 'half';
        if (scoreRaw <= -2) return 'fixed';
        if (scoreRaw < 0) return 'wrong';
        return 'pending';
    }
    if (item?.correct === true || item?.correct === 1) {
        return 'right';
    }
    if (item?.correct === false || item?.correct === 0) {
        return 'wrong';
    }
    return 'pending';
}

function getCorrectnessLabel(correctness) {
    if (correctness === 'right') {
        return 'Right';
    }
    if (correctness === 'half') {
        return 'Half';
    }
    if (correctness === 'fixed') {
        return 'Fixed';
    }
    if (correctness === 'wrong') {
        return 'Wrong';
    }
    return 'Ungraded';
}

function getAttemptDisplayResponseMs(item) {
    const avgMs = Math.max(0, Number(item?.avg_response_ms) || 0);
    if (avgMs > 0) {
        return avgMs;
    }
    return Math.max(0, Number(item?.response_time_ms) || 0);
}

function isType4Attempt(item) {
    return String(item?.session_behavior_type || '').trim().toLowerCase() === BEHAVIOR_TYPE_IV;
}

function isType3Attempt(item) {
    return String(item?.session_behavior_type || '').trim().toLowerCase() === BEHAVIOR_TYPE_III;
}

function isType1OrType2Attempt(item) {
    const behaviorType = String(item?.session_behavior_type || '').trim().toLowerCase();
    return behaviorType === BEHAVIOR_TYPE_I || behaviorType === BEHAVIOR_TYPE_II;
}

function getRetryFixCount(item) {
    if (!isType1OrType2Attempt(item)) {
        return 0;
    }
    const scoreRaw = Number(item?.correct_score);
    if (!Number.isFinite(scoreRaw) || scoreRaw > -2) {
        return 0;
    }
    return Math.max(1, Math.abs(Math.trunc(scoreRaw)) - 1);
}

function getRetryFixLabel(retryFixCount) {
    return retryFixCount === 1
        ? 'Fixed after 1 retry'
        : `Fixed after ${retryFixCount} retries`;
}

function getRetryFixShortLabel(retryFixCount) {
    return retryFixCount === 1 ? '1 retry' : `${retryFixCount} retries`;
}

function getType4AttemptPrompt(item) {
    return String(item?.materialized_prompt || currentCardFront || 'Problem').trim() || 'Problem';
}

function getType4AttemptAnswer(item) {
    return String(item?.materialized_answer || '').trim();
}

function getType4AttemptSubmittedPills(item) {
    const submittedAnswers = Array.isArray(item?.submitted_answers)
        ? item.submitted_answers
            .map((value) => String(value || '').trim())
            .filter(Boolean)
        : [];
    if (submittedAnswers.length === 0) {
        return '<span class="history-type4-pill tried-pill">-</span>';
    }
    const grades = Array.isArray(item?.submitted_grades) ? item.submitted_grades : [];
    const hasGrades = grades.length > 0;
    const score = Number(item?.correct_score);
    const isResolved = score === 1 || score <= -2;
    const expectedAnswer = getType4AttemptAnswer(item);
    return submittedAnswers
        .map((a, i) => {
            let cls = 'tried-pill';
            if (hasGrades) {
                const grade = Number(grades[i]);
                if (grade === 1 || grade <= -2) cls = 'answer-pill';
                else if (grade === 2) cls = 'partial-pill';
            } else {
                const isLast = i === submittedAnswers.length - 1;
                if (a === expectedAnswer) {
                    cls = isLast && isResolved ? 'answer-pill' : 'answer-pill';
                } else if (isLast && isResolved) {
                    cls = 'partial-pill';
                }
            }
            return `<span class="history-type4-pill ${cls}">${escapeHtml(a)}</span>`;
        })
        .join('');
}

function getType3GradeStatusClass(correctness) {
    if (correctness === 'right') {
        return 'pass';
    }
    if (correctness === 'wrong' || correctness === 'fixed') {
        return 'fail';
    }
    return 'pending';
}

function getType3GradeStatusText(correctness) {
    const gradeClass = getType3GradeStatusClass(correctness);
    if (gradeClass === 'pass') {
        return 'Status: Pass';
    }
    if (gradeClass === 'fail') {
        return 'Status: Fail';
    }
    return 'Status: Pending';
}

function renderType3HistoryStatusHtml(correctness) {
    const gradeClass = getType3GradeStatusClass(correctness);
    return `<div class="grade-status ${gradeClass}">${escapeHtml(getType3GradeStatusText(correctness))}</div>`;
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

function sanitizeFilenamePart(value, fallback) {
    const cleaned = String(value || '')
        .replace(/[\\/:*?"<>|]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    return cleaned || fallback;
}

function resolveAudioExtension(item) {
    return '.mp3';
}

function buildAudioDownloadFilename(item) {
    const kidPart = sanitizeFilenamePart(currentKidName, 'Kid');
    const frontPart = sanitizeFilenamePart(currentCardFront, 'Card');
    const base = `${kidPart}-${frontPart}`.slice(0, 120);
    return `${base}${resolveAudioExtension(item)}`;
}

function resolveAudioFileName(item) {
    const explicit = String(item?.audio_file_name || '').trim();
    if (explicit) {
        return explicit;
    }
    const audioUrl = String(item?.audio_url || '').trim();
    if (!audioUrl) {
        return '';
    }
    try {
        const parsed = new URL(audioUrl, window.location.origin);
        const parts = parsed.pathname.split('/');
        return decodeURIComponent(parts[parts.length - 1] || '').trim();
    } catch (error) {
        return '';
    }
}

function buildAudioDownloadUrl(item, downloadFilename) {
    const fileName = resolveAudioFileName(item);
    if (!fileName) {
        return String(item?.audio_url || '').trim();
    }
    const path = `/api/kids/${encodeURIComponent(String(kidId || ''))}/lesson-reading/audio/${encodeURIComponent(fileName)}/download-mp3`;
    const query = new URLSearchParams();
    query.set('downloadName', String(downloadFilename || '').replace(/\.mp3$/i, ''));
    return `${path}?${query.toString()}`;
}

function getCardDisplayLabel(front, back, source) {
    const frontText = String(front || '').trim();
    const backText = String(back || '').trim();

    if (source === 'cards' || source === 'lesson-reading') {
        return frontText || backText;
    }
    if (source === 'type2') {
        return backText || frontText;
    }

    return backText || frontText;
}

function formatSourceDeckLabel(deckName) {
    const text = String(deckName || '').trim();
    if (!text) {
        return '';
    }
    if (categoryKey && text === `${categoryKey}_orphan`) {
        return 'Personal Deck';
    }
    const materializedMatch = text.match(/^shared_deck_\d+__(.+)$/);
    if (materializedMatch && String(materializedMatch[1] || '').trim()) {
        return String(materializedMatch[1] || '').trim();
    }
    return text;
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
