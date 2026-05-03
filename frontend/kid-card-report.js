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
const trendChart = document.getElementById('trendChart');
const historyList = document.getElementById('historyList');
let reportTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
let currentKidName = '';
let currentCardFront = '';
let currentCardBack = '';
let currentDeckName = '';
document.addEventListener('DOMContentLoaded', async () => {
    if (!kidId || !cardId) {
        window.location.href = '/admin.html';
        return;
    }

    bindBackButton();
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
        currentKidName = String(kidName || '').trim();
        currentCardFront = String(card.front || '').trim();
        currentCardBack = String(card.back || '').trim();
        currentDeckName = String(card.deck_name || '').trim();

        const cardLabel = getCardDisplayLabel(card.front, card.back, from) || `#${card.id || cardId}`;
        pageTitle.textContent = `${kidName} · Card ${cardLabel}`;
        document.title = `${kidName} - Card Report - Kids Daily Chores`;

        renderTrend(attempts);
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

function renderTrend(attempts) {
    if (!attempts.length) {
        trendChart.innerHTML = `<div class="chart-empty">No attempts yet for this card.</div>`;
        return;
    }

    const nowDate = new Date();
    const items = attempts.map((item, index) => {
        const ts = item.session_completed_at || item.session_started_at || item.timestamp;
        const dt = parseUtcTimestamp(ts);
        const daysAgo = Number.isNaN(dt.getTime())
            ? 0
            : Math.max(0, calendarDayDiff(nowDate, dt, reportTimezone));
        const ms = getAttemptDisplayResponseMs(item);
        return {
            index,
            ts,
            ms,
            daysAgo,
            correctness: resolveCorrectness(item),
        };
    });

    const maxMs = Math.max(...items.map((it) => it.ms), 1);
    const useMinutesUnit = maxMs >= 60000;
    items.forEach((it) => {
        it.title = `#${it.index + 1} · ${formatResponseTime(it.ms)} · ${formatDateTime(it.ts)}`;
    });

    const maxDays = Math.max(7, ...items.map((it) => it.daysAgo));
    const stepMs = pickTrendTimeStepMs(maxMs);
    const yMax = Math.max(stepMs, Math.ceil(maxMs / stepMs) * stepMs);
    const yTicks = [];
    for (let v = 0; v <= yMax + 0.5; v += stepMs) yTicks.push(v);

    const MAX_OFFSET_PX = 130;
    const TOP_PADDING_PX = 14;
    items.forEach((it) => {
        it.xPct = (it.daysAgo / maxDays) * 100;
        it.bottomPx = (it.ms / yMax) * MAX_OFFSET_PX;
    });

    const sorted = [...items].sort((a, b) => a.bottomPx - b.bottomPx || a.index - b.index);
    const stageHeight = MAX_OFFSET_PX + TOP_PADDING_PX;

    const markerHtml = sorted.map((it) => {
        return `<div class="trend-marker ${it.correctness}" style="left:${it.xPct.toFixed(2)}%; bottom:${it.bottomPx.toFixed(1)}px;" title="${escapeHtml(it.title)}"></div>`;
    }).join('');

    const tickSegments = 6;
    const gridVHtml = Array.from({ length: tickSegments + 1 }, (_, i) => {
        const pct = (i / tickSegments) * 100;
        return `<div class="trend-grid-line-v" style="left:${pct}%"></div>`;
    }).join('');
    const gridHHtml = yTicks.slice(1).map((v) => {
        const posPx = (v / yMax) * MAX_OFFSET_PX;
        return `<div class="trend-grid-line-h" style="bottom:${posPx.toFixed(1)}px;"></div>`;
    }).join('');
    const yLabelHtml = yTicks.map((v) => {
        const posPx = (v / yMax) * MAX_OFFSET_PX;
        return `<div class="trend-yaxis-label" style="bottom:${posPx.toFixed(1)}px;">${escapeHtml(formatTrendResponseTime(v, useMinutesUnit))}</div>`;
    }).join('');
    const tickLabelHtml = Array.from({ length: tickSegments + 1 }, (_, i) => {
        const pct = (i / tickSegments) * 100;
        const dayValue = Math.round((i / tickSegments) * maxDays);
        return `<div class="trend-numberline-tick-label" style="left:${pct}%">${dayValue}d</div>`;
    }).join('');

    const legendCounts = items.reduce((acc, it) => {
        acc[it.correctness] = (acc[it.correctness] || 0) + 1;
        return acc;
    }, {});
    const legendOrder = [
        ['right', 'Right'],
        ['half', 'Half'],
        ['fixed', 'Fixed'],
        ['wrong', 'Wrong'],
        ['pending', 'Ungraded'],
    ];
    const legendParts = legendOrder
        .filter(([key]) => legendCounts[key])
        .map(([key, label]) => `<span class="trend-legend-dot ${key}"></span> ${label} (${legendCounts[key]})`);
    const legendHtml = legendParts.length
        ? `<div class="trend-legend">${legendParts.join('<span class="trend-legend-sep">·</span>')}</div>`
        : '';

    trendChart.innerHTML = `${legendHtml}
        <div class="trend-numberline">
            <div class="trend-numberline-stage">
                <div class="trend-yaxis-col" style="height:${stageHeight}px;">${yLabelHtml}</div>
                <div class="trend-plot-col">
                    <div class="trend-numberline-arrows" style="height:${stageHeight}px;">
                        <div class="trend-grid">${gridHHtml}${gridVHtml}</div>
                        ${markerHtml}
                    </div>
                    <div class="trend-numberline-axis"></div>
                    <div class="trend-numberline-tick-labels">${tickLabelHtml}</div>
                </div>
            </div>
        </div>`;
}

function pickTrendTimeStepMs(maxMs) {
    const targetTicks = 4;
    const rough = Math.max(1, maxMs) / targetTicks;
    const candidates = [
        500, 1000, 2000, 2500, 5000, 10000, 15000, 20000, 30000,
        60000, 120000, 180000, 300000, 600000, 1200000,
    ];
    for (const c of candidates) {
        if (c >= rough) return c;
    }
    return Math.ceil(rough / 60000) * 60000;
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
        const itemTimestamp = item.session_completed_at || item.session_started_at || item.timestamp;
        const daysAgoLabel = formatDaysAgo(itemTimestamp);
        const daysAgoSuffix = daysAgoLabel ? ` <span class="history-days-ago">(${escapeHtml(daysAgoLabel)})</span>` : '';
        const sessionUrl = buildSessionReportUrl(item);
        const chevronHtml = sessionUrl ? '<span class="history-chevron" aria-hidden="true">›</span>' : '';
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
            const lessonReadingAudioAttrs = from === 'lesson-reading'
                ? ` data-result-id="${Number.isFinite(Number(item.result_id)) ? Number(item.result_id) : ''}" data-response-time-ms="${Math.round(rawMs)}"`
                : '';
            const downloadFilename = buildAudioDownloadFilename(item);
            const downloadUrl = buildAudioDownloadUrl(item, downloadFilename);
            const downloadButtonHtml = item.audio_url
                ? `<a class="tab-link secondary mini-link-btn answer-report-link audio-download-link" href="${escapeHtml(downloadUrl)}" download="${escapeHtml(downloadFilename)}">Download</a>`
                : '';
            const goToSessionButtonHtml = sessionUrl
                ? `<a class="tab-link secondary mini-link-btn answer-report-link" href="${escapeHtml(sessionUrl)}">Go to Session ›</a>`
                : '';
            const audioBlockHtml = item.audio_url
                ? `
                    <div class="audio-history-row">
                        <audio class="attempt-audio js-simple-audio" preload="metadata" src="${escapeHtml(item.audio_url)}"${lessonReadingAudioAttrs}></audio>
                    </div>
                `
                : '';
            return `
                <div class="history-item type3-history-item"${resultIdAttr !== null ? ` id="result-${resultIdAttr}" data-result-id="${resultIdAttr}"` : ''}>
                    <div class="history-head-row">
                        <div class="history-title-stack">
                            ${detailHtml}
                        </div>
                        <div class="answer-head-actions">
                            ${renderType3HistoryStatusHtml(correctness)}
                            ${downloadButtonHtml}
                            ${goToSessionButtonHtml}
                        </div>
                    </div>
                    ${audioBlockHtml}
                    <div class="meta">
                        ${formatDateTime(itemTimestamp)}${daysAgoSuffix}
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
            const idAttrPart = resultIdAttr !== null ? ` id="result-${resultIdAttr}" data-result-id="${resultIdAttr}"` : '';
            const itemOpen = sessionUrl
                ? `<a class="history-item history-item-link"${idAttrPart} href="${escapeHtml(sessionUrl)}">`
                : `<div class="history-item"${idAttrPart}>`;
            const itemClose = sessionUrl ? '</a>' : '</div>';
            return `
                ${itemOpen}
                    <div class="history-head-row">
                        <div class="history-title-stack">
                            <div class="history-primary">${escapeHtml(prompt)}</div>
                            <div class="history-type4-details">
                                <span class="history-type4-submitted-label">Submitted:</span> ${submittedPills}
                            </div>
                        </div>
                        <div class="history-status-side">
                            <div class="history-time-badge">Avg ${escapeHtml(responseTimeLabel)}</div>
                            <span class="pill ${statusClass}">${statusText}</span>
                        </div>
                    </div>
                    <div class="meta">
                        ${formatDateTime(itemTimestamp)}${daysAgoSuffix}
                        · Session #${safeNum(item.session_id)}
                    </div>
                    ${chevronHtml}
                ${itemClose}
            `;
        }
        const prompt = getType1AttemptPrompt(item);
        const answer = getType1AttemptAnswer(item) || 'n/a';
        const submittedPills = getType1AttemptSubmittedPills(item);
        const resultIdAttr = Number.isFinite(Number(item?.result_id)) ? Number(item.result_id) : null;
        const retryFixCount = getRetryFixCount(item);
        const retryBadgeHtml = retryFixCount > 0
            ? `<span class="history-retry-badge" title="${escapeHtml(getRetryFixLabel(retryFixCount))}">${escapeHtml(getRetryFixShortLabel(retryFixCount))}</span>`
            : '';
        const idAttrPart = resultIdAttr !== null ? ` id="result-${resultIdAttr}" data-result-id="${resultIdAttr}"` : '';
        const itemOpen = sessionUrl
            ? `<a class="history-item history-item-link"${idAttrPart} href="${escapeHtml(sessionUrl)}">`
            : `<div class="history-item"${idAttrPart}>`;
        const itemClose = sessionUrl ? '</a>' : '</div>';
        return `
            ${itemOpen}
                <div class="history-head-row">
                    <div class="history-title-stack">
                        <div class="history-primary${isChineseLikeText(prompt) ? ' chinese-specific' : ''}">${renderMathHtml(prompt)}</div>
                        <div class="history-type4-details">
                            <span class="history-type4-submitted-label">Right:</span> ${escapeHtml(answer)} <span class="answer-type3-sep" aria-hidden="true">·</span>
                            <span class="history-type4-submitted-label">Submitted:</span> ${submittedPills}
                        </div>
                    </div>
                    <div class="history-status-side">
                        <div class="history-time-badge">${escapeHtml(responseTimeLabel)}</div>
                        ${retryBadgeHtml}
                        <span class="pill ${statusClass}">${statusText}</span>
                    </div>
                </div>
                <div class="meta">
                    ${formatDateTime(itemTimestamp)}${daysAgoSuffix}
                    · Session #${safeNum(item.session_id)}
                </div>
                ${chevronHtml}
            ${itemClose}
        `;
    }).join('');

    if (from === 'lesson-reading' && window.LessonReadingDurationBackfill) {
        window.LessonReadingDurationBackfill.attach(historyList, { kidId });
    }
    if (window.SimpleAudioPlayer) {
        window.SimpleAudioPlayer.attach(historyList, { selector: 'audio.js-simple-audio' });
    }
}

function buildSessionReportUrl(item) {
    const sessionId = Number(item?.session_id);
    if (!Number.isFinite(sessionId) || sessionId <= 0 || !kidId) {
        return '';
    }
    const fromSuffix = from === 'kid-home' ? '&from=kid-home' : '';
    return `/kid-session-report.html?id=${encodeURIComponent(kidId)}&sessionId=${encodeURIComponent(sessionId)}${fromSuffix}`;
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

function getType1AttemptPrompt(item) {
    return String(item?.front || currentCardFront || 'Card').trim() || 'Card';
}

function getType1AttemptAnswer(item) {
    return String(item?.back || currentCardBack || '').trim();
}

function getLoggedSubmittedAnswers(item) {
    return Array.isArray(item?.submitted_answers)
        ? item.submitted_answers
            .map((value) => String(value || '').trim())
            .filter(Boolean)
        : [];
}

function getLoggedSubmittedGrades(item) {
    return Array.isArray(item?.submitted_grades)
        ? item.submitted_grades.map((value) => Number(value))
        : [];
}

function isType1PromptAudioGrade(value) {
    const grade = Math.trunc(Number(value));
    return grade === 3 || grade === -3;
}

function renderPromptAudioAssistMarker() {
    return `
        <span class="history-audio-assist-marker" title="Read-aloud used" aria-label="Read-aloud used">
            <svg width="11" height="11" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                <path d="M3.5 7.75h3.7l3.8-3.05a.75.75 0 0 1 1.22.58v9.44a.75.75 0 0 1-1.22.58L7.2 12.25H3.5A1.5 1.5 0 0 1 2 10.75v-1.5a1.5 1.5 0 0 1 1.5-1.5Z"></path>
                <path d="M14.15 7.45a.75.75 0 0 1 1.06.07A3.8 3.8 0 0 1 16.1 10a3.8 3.8 0 0 1-.89 2.48.75.75 0 0 1-1.13-.99A2.3 2.3 0 0 0 14.6 10c0-.56-.19-1.08-.52-1.49a.75.75 0 0 1 .07-1.06Z"></path>
            </svg>
        </span>
    `;
}

function getType4AttemptSubmittedPills(item) {
    const submittedAnswers = getLoggedSubmittedAnswers(item);
    if (submittedAnswers.length === 0) {
        return '<span class="history-type4-pill tried-pill">-</span>';
    }
    const grades = getLoggedSubmittedGrades(item);
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

function getType1AttemptSubmittedPills(item) {
    const submittedAnswers = getLoggedSubmittedAnswers(item);
    if (submittedAnswers.length === 0) {
        return '<span class="history-type4-pill tried-pill">n/a</span>';
    }
    const grades = getLoggedSubmittedGrades(item);
    return submittedAnswers
        .map((answer, index) => {
            const grade = Number(grades[index]);
            const cls = grade === 2
                ? 'partial-pill'
                : (grade > 0 ? 'answer-pill' : 'tried-pill');
            const audioAssistHtml = isType1PromptAudioGrade(grade) ? renderPromptAudioAssistMarker() : '';
            return `
                <span class="history-type4-pill-wrap${audioAssistHtml ? ' has-audio-assist' : ''}">
                    <span class="history-type4-pill ${cls}">${escapeHtml(answer)}</span>
                    ${audioAssistHtml}
                </span>
            `;
        })
        .join('');
}

function isChineseLikeText(value) {
    return /[\u3400-\u9fff\uf900-\ufaff]/.test(String(value || ''));
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

function formatDaysAgo(iso) {
    const dt = parseUtcTimestamp(iso);
    if (Number.isNaN(dt.getTime())) return '';
    const dayDiff = calendarDayDiff(new Date(), dt, reportTimezone);
    if (dayDiff <= 0) return 'today';
    if (dayDiff === 1) return '1 day ago';
    return `${dayDiff} days ago`;
}

function calendarDayDiff(later, earlier, timeZone) {
    const fmt = new Intl.DateTimeFormat('en-CA', {
        timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    });
    const toUtcDay = (d) => {
        const [y, m, day] = fmt.format(d).split('-').map(Number);
        return Date.UTC(y, m - 1, day);
    };
    return Math.round((toUtcDay(later) - toUtcDay(earlier)) / (24 * 60 * 60 * 1000));
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
