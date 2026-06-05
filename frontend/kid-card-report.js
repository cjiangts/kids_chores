/*
 * kid-card-report.js — single-card history page
 *
 * Layout:
 *   1. DOM refs + module constants + DOMContentLoaded bootstrap
 *   2. Report data fetch
 *   3. Hero block (card header + stats card)
 *   4. Trend chart + period selector
 *   5. History list rendering
 *   6. Scroll-to-target + attempt classifiers
 *   7. Attempt prompt / answer / logged-choice accessors
 *   8. Formatting helpers (response time, date, type label)
 *   9. Error display
 */

// =====================================================================
// === 1. DOM refs + module constants + DOMContentLoaded bootstrap
// =====================================================================

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
const errorMessage = document.getElementById('errorMessage');
const cardReportHero = document.getElementById('cardReportHero');
const trendChart = document.getElementById('trendChart');
const trendLegend = document.getElementById('trendLegend');
const trendPeriodBtns = document.getElementById('trendPeriodBtns');
const trendFootnote = document.getElementById('trendFootnote');
const historyList = document.getElementById('historyList');
const TREND_EMA_ALPHA = 0.067;
const TREND_EMA_HALF_LIFE_ATTEMPTS = Math.round(Math.log(0.5) / Math.log(1 - TREND_EMA_ALPHA));
let currentTrendAttempts = [];
let currentTrendPeriodDays = 0;
let reportTimezone = '';
let currentKidName = '';
let currentCardFront = '';
let currentCardBack = '';
let currentDeckName = '';
document.addEventListener('DOMContentLoaded', async () => {
    if (!kidId || !cardId) {
        window.location.href = '/admin.html';
        return;
    }

    await loadCardReport();
});

// =====================================================================
// === 2. Report data fetch
// =====================================================================

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

        pageTitle.textContent = `${kidName} · Card History`;
        document.title = `${kidName} - Card Report - Kids Daily Chores`;

        renderHero(card, attempts);
        renderTrend(attempts);
        renderHistory(attempts);
        scrollToTargetAttempt();
        if (window.hydrateIcons) window.hydrateIcons(document);
    } catch (error) {
        console.error('Error loading card report:', error);
        showError('Failed to load card report.');
        document.title = 'Card Report - Kids Daily Chores';
    }
}

async function loadReportTimezone() {
    const response = await fetch(`${API_BASE}/parent-settings/timezone`);
    if (!response.ok) {
        throw new Error(`Timezone request failed (${response.status})`);
    }
    const data = await response.json().catch(() => ({}));
    const tz = String(data.familyTimezone || '').trim();
    if (!tz) {
        throw new Error('familyTimezone missing from timezone response');
    }
    reportTimezone = tz;
}

// =====================================================================
// === 3. Hero block (card header + stats card)
// =====================================================================

function renderHero(card, attempts) {
    if (!cardReportHero) return;

    const cardLabel = getCardDisplayLabel(card?.front, card?.back)
        || `#${card?.id || cardId}`;
    const labelText = String(cardLabel || '');
    const len = [...labelText].length;
    let sizeClass = 'size-xl';
    if (len > 12) sizeClass = 'size-sm';
    else if (len > 6) sizeClass = 'size-md';
    else if (len > 2) sizeClass = 'size-lg';
    const labelClasses = ['card-report-hero-icon-text', sizeClass];
    if (isChineseLikeText(labelText)) labelClasses.push('chinese-specific');

    const counts = { right: 0, fixed: 0, wrong: 0, half: 0, pending: 0 };
    attempts.forEach((item) => {
        const correctness = resolveCorrectness(item);
        counts[correctness] = (counts[correctness] || 0) + 1;
    });

    const total = attempts.length;

    const isType3 = attempts.some(isType3Attempt);
    const middleStat = isType3
        ? { key: 'pending', icon: 'help', value: String(counts.pending), label: 'ungraded' }
        : { key: 'fixed', icon: 'rotate-ccw', value: String(counts.fixed), label: 'fixed' };
    const stats = [
        { key: 'attempts', icon: 'layers', value: String(total), label: 'attempts' },
        { key: 'right', icon: 'check', value: String(counts.right), label: 'right' },
        middleStat,
        { key: 'wrong', icon: 'x', value: String(counts.wrong), label: 'wrong' },
    ];

    const statsHtml = stats.map((s) => `
        <div class="hero-stat hero-stat--${s.key}">
            <span class="hero-stat-iconbox">${window.icon ? window.icon(s.icon, { size: 14, strokeWidth: 2.4 }) : ''}</span>
            <span class="hero-stat-value">${escapeHtml(s.value)}</span>
            <span class="hero-stat-label">${escapeHtml(s.label)}</span>
        </div>
    `).join('');

    const subjectName = resolveSubjectDisplayName(attempts);
    const sourceDeckLabel = formatSourceDeckLabel(currentDeckName);
    const metaBits = [];
    if (subjectName) {
        const subjectIcon = window.icon ? window.icon('book-open', { size: 12, strokeWidth: 2.4 }) : '';
        metaBits.push(`<span class="report-hero-meta-item"><span class="report-hero-meta-icon">${subjectIcon}</span><span class="report-hero-meta-value">${escapeHtml(subjectName)}</span></span>`);
    }
    if (sourceDeckLabel) {
        const deckIcon = window.icon ? window.icon('layers', { size: 12, strokeWidth: 2.4 }) : '';
        metaBits.push(`<span class="report-hero-meta-item"><span class="report-hero-meta-icon">${deckIcon}</span><span class="report-hero-meta-value">${escapeHtml(sourceDeckLabel)}</span></span>`);
    }
    const metaHtml = metaBits.length
        ? `<div class="report-hero-meta">${metaBits.join('')}</div>`
        : '';

    const manageBtnHtml = window.ReportHeroAction.renderActionLinkHtml({
        id: 'cardStatsBtn',
        href: buildCardStatsHref(card),
        label: 'Card Stats',
        leadingIcon: 'bar-chart-3',
        trailingIcon: 'arrow-right',
    });

    cardReportHero.innerHTML = `
        <div class="card-report-hero">
            <div class="card-report-hero-icon">
                <span class="${labelClasses.join(' ')}">${escapeHtml(labelText)}</span>
            </div>
            <div class="card-report-hero-content">
                <div class="report-hero-meta-row">
                    ${metaHtml}
                    ${manageBtnHtml}
                </div>
                <div class="card-report-hero-stats">${statsHtml}</div>
            </div>
        </div>
    `;
}

function buildCardStatsHref(card) {
    const qs = new URLSearchParams();
    qs.set('id', String(kidId || ''));
    if (categoryKey) {
        qs.set('categoryKey', categoryKey);
    }
    const focusId = String(card?.id || cardId || '').trim();
    if (focusId) {
        qs.set('cardId', focusId);
    }
    return `/kid-card-manage.html?${qs.toString()}`;
}

function resolveSubjectDisplayName(attempts) {
    for (const item of attempts || []) {
        const name = String(item?.session_category_display_name || '').trim();
        if (name) {
            return name;
        }
    }
    const key = String(categoryKey || '').trim();
    if (!key) {
        return '';
    }
    return key.charAt(0).toUpperCase() + key.slice(1);
}

// =====================================================================
// === 4. Trend chart + period selector
// =====================================================================

function renderTrend(attempts) {
    currentTrendAttempts = Array.isArray(attempts) ? attempts : [];
    if (trendLegend) trendLegend.innerHTML = '';
    if (trendFootnote) trendFootnote.textContent = '';
    if (!currentTrendAttempts.length) {
        renderTrendPeriodBtns(0);
        trendChart.innerHTML = `<div class="chart-empty">No attempts yet for this card.</div>`;
        return;
    }

    const nowDate = new Date();
    const allItems = currentTrendAttempts.map((item, index) => {
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

    const fullSpanDays = Math.max(0, ...allItems.map((it) => it.daysAgo));
    renderTrendPeriodBtns(fullSpanDays);

    const periodDays = currentTrendPeriodDays > 0 ? currentTrendPeriodDays : 0;
    const items = periodDays > 0
        ? allItems.filter((it) => it.daysAgo <= periodDays)
        : allItems;

    if (!items.length) {
        trendChart.innerHTML = `<div class="chart-empty">No attempts in this period.</div>`;
        return;
    }

    const maxMs = Math.max(...items.map((it) => it.ms), 1);
    const useMinutesUnit = maxMs >= 60000;
    items.forEach((it) => {
        it.title = `#${it.index + 1} · ${formatResponseTime(it.ms)} · ${formatDateTime(it.ts)}`;
    });

    const maxDays = periodDays > 0
        ? Math.max(1, periodDays)
        : Math.max(7, ...items.map((it) => it.daysAgo));
    const stepMs = pickTrendTimeStepMs(maxMs);
    const yMax = Math.max(stepMs, Math.ceil(maxMs / stepMs) * stepMs);
    const yTicks = [];
    for (let v = 0; v <= yMax + 0.5; v += stepMs) yTicks.push(v);

    const MAX_OFFSET_PX = 180;
    const TOP_PADDING_PX = 14;
    items.forEach((it) => {
        it.xPct = (1 - it.daysAgo / maxDays) * 100;
        it.bottomPx = (it.ms / yMax) * MAX_OFFSET_PX;
    });

    const sorted = [...items].sort((a, b) => a.bottomPx - b.bottomPx || a.index - b.index);
    const stageHeight = MAX_OFFSET_PX + TOP_PADDING_PX;

    const markerHtml = sorted.map((it) => {
        return `<div class="trend-marker ${it.correctness}" style="left:${it.xPct.toFixed(2)}%; bottom:${it.bottomPx.toFixed(1)}px;" title="${escapeHtml(it.title)}"></div>`;
    }).join('');

    const chronoItems = [...items].sort((a, b) => {
        const at = parseUtcTimestamp(a.ts).getTime() || 0;
        const bt = parseUtcTimestamp(b.ts).getTime() || 0;
        return at - bt;
    });
    let avgSum = 0;
    let avgCount = 0;
    const avgPoints = chronoItems.map((it) => {
        const isCorrect = it.correctness === 'right';
        if (isCorrect && it.ms > 0) {
            avgSum += it.ms;
            avgCount += 1;
        }
        if (avgCount === 0) return null;
        const avg = avgSum / avgCount;
        const x = it.xPct;
        const y = stageHeight - (avg / yMax) * MAX_OFFSET_PX;
        return { x, y };
    }).filter((p) => p !== null);
    if (avgPoints.length && avgPoints[avgPoints.length - 1].x < 100) {
        const last = avgPoints[avgPoints.length - 1];
        avgPoints.push({ x: 100, y: last.y });
    }
    const avgPathPoints = avgPoints.map((p) => `${p.x.toFixed(2)},${p.y.toFixed(1)}`).join(' ');
    const showAvgLine = avgPoints.length >= 2;
    const avgLineHtml = showAvgLine
        ? `<svg preserveAspectRatio="none" viewBox="0 0 100 ${stageHeight}" style="position:absolute; inset:0; width:100%; height:100%; pointer-events:none;">
            <polyline points="${avgPathPoints}" fill="none" stroke="#5b6acf" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke" opacity="0.85" />
           </svg>`
        : '';
    const finalAvgMs = avgCount ? avgSum / avgCount : 0;
    const finalAvgLabel = avgCount ? formatTrendResponseTime(finalAvgMs, useMinutesUnit) : '';

    let emaRaw = 0;
    let emaCount = 0;
    let emaCorrected = null;
    const emaPoints = chronoItems.map((it) => {
        const isCorrect = it.correctness === 'right';
        if (isCorrect && it.ms > 0) {
            emaRaw = TREND_EMA_ALPHA * it.ms + (1 - TREND_EMA_ALPHA) * emaRaw;
            emaCount += 1;
            emaCorrected = emaRaw / (1 - Math.pow(1 - TREND_EMA_ALPHA, emaCount));
        }
        if (emaCorrected === null) return null;
        const x = it.xPct;
        const y = stageHeight - (emaCorrected / yMax) * MAX_OFFSET_PX;
        return { x, y };
    }).filter((p) => p !== null);
    if (emaPoints.length && emaPoints[emaPoints.length - 1].x < 100) {
        const last = emaPoints[emaPoints.length - 1];
        emaPoints.push({ x: 100, y: last.y });
    }
    const emaPathPoints = emaPoints.map((p) => `${p.x.toFixed(2)},${p.y.toFixed(1)}`).join(' ');
    const showEmaLine = emaPoints.length >= 2;
    const emaLineHtml = showEmaLine
        ? `<svg preserveAspectRatio="none" viewBox="0 0 100 ${stageHeight}" style="position:absolute; inset:0; width:100%; height:100%; pointer-events:none;">
            <polyline points="${emaPathPoints}" fill="none" stroke="#e07a3d" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke" opacity="0.9" />
           </svg>`
        : '';
    const finalEmaLabel = emaCorrected !== null ? formatTrendResponseTime(emaCorrected, useMinutesUnit) : '';

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
        const dayValue = Math.round((1 - i / tickSegments) * maxDays);
        let label;
        if (i === tickSegments) {
            label = 'today';
        } else if (i === 0) {
            label = `${dayValue}d ago`;
        } else {
            label = `${dayValue}d`;
        }
        return `<div class="trend-numberline-tick-label" style="left:${pct}%">${escapeHtml(label)}</div>`;
    }).join('');

    const presentCorrectness = new Set(items.map((it) => it.correctness));
    const legendOrder = [
        ['right', 'Right'],
        ['half', 'Half'],
        ['fixed', 'Fixed'],
        ['wrong', 'Wrong'],
        ['pending', 'Ungraded'],
    ];
    const legendParts = legendOrder
        .filter(([key]) => presentCorrectness.has(key))
        .map(([key, label]) => `<span><span class="trend-legend-dot ${key}"></span>${label}</span>`);
    if (showAvgLine) {
        legendParts.push(`<span><span class="trend-legend-line"></span>Avg ${escapeHtml(finalAvgLabel)}</span>`);
    }
    if (showEmaLine) {
        legendParts.push(`<span><span class="trend-legend-line ema"></span>EMA ${escapeHtml(finalEmaLabel)}</span>`);
    }
    if (trendLegend) {
        trendLegend.innerHTML = legendParts.join('');
    }
    if (trendFootnote) {
        trendFootnote.textContent = `Avg and EMA include only fully-correct (green) attempts. EMA half-life ≈ ${TREND_EMA_HALF_LIFE_ATTEMPTS} attempts.`;
    }

    trendChart.innerHTML = `
        <div class="trend-numberline">
            <div class="trend-numberline-stage">
                <div class="trend-yaxis-col" style="height:${stageHeight}px;">
                    ${yLabelHtml}
                </div>
                <div class="trend-plot-col">
                    <div class="trend-numberline-arrows" style="height:${stageHeight}px;">
                        <div class="trend-grid">${gridHHtml}${gridVHtml}</div>
                        ${avgLineHtml}
                        ${emaLineHtml}
                        ${markerHtml}
                    </div>
                    <div class="trend-numberline-axis"></div>
                    <div class="trend-numberline-tick-labels">${tickLabelHtml}</div>
                </div>
            </div>
        </div>`;
}

function renderTrendPeriodBtns(fullSpanDays) {
    if (!trendPeriodBtns) return;
    const presets = [7, 14, 30, 90].filter((d) => fullSpanDays > d);
    if (!presets.length) {
        trendPeriodBtns.hidden = true;
        trendPeriodBtns.innerHTML = '';
        if (currentTrendPeriodDays !== 0) currentTrendPeriodDays = 0;
        return;
    }
    if (currentTrendPeriodDays !== 0 && !presets.includes(currentTrendPeriodDays)) {
        currentTrendPeriodDays = 0;
    }
    const opts = [...presets.map((d) => ({ days: d, label: `${d}d` })), { days: 0, label: 'All' }];
    trendPeriodBtns.hidden = false;
    trendPeriodBtns.innerHTML = opts
        .map((o) => {
            const active = o.days === currentTrendPeriodDays ? ' active' : '';
            return `<button type="button" class="trend-period-btn${active}" data-period-days="${o.days}">${o.label}</button>`;
        })
        .join('');
    trendPeriodBtns.querySelectorAll('button[data-period-days]').forEach((btn) => {
        btn.addEventListener('click', () => {
            const days = Number(btn.dataset.periodDays) || 0;
            if (days === currentTrendPeriodDays) return;
            currentTrendPeriodDays = days;
            renderTrend(currentTrendAttempts);
        });
    });
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

// =====================================================================
// === 5. History list rendering
// =====================================================================

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

    const currentSessionId = sorted.length ? Number(sorted[0]?.session_id) : null;

    historyList.innerHTML = sorted.map((item) => {
        const rawMs = getAttemptDisplayResponseMs(item);
        const responseTimeLabel = formatResponseTime(rawMs);
        const correctness = resolveCorrectness(item);
        const itemTimestamp = item.session_completed_at || item.session_started_at || item.timestamp;
        const daysAgoLabel = formatDaysAgo(itemTimestamp);
        const isToday = daysAgoLabel === 'today';
        const daysAgoBadge = daysAgoLabel ? `<span class="history-days-badge${isToday ? ' is-today' : ''}">${escapeHtml(daysAgoLabel)}</span>` : '';
        const sessionUrl = buildSessionReportUrl(item);
        const chevronHtml = sessionUrl ? '<span class="history-chevron" aria-hidden="true">›</span>' : '';
        const isCurrentSession = currentSessionId !== null
            && Number.isFinite(currentSessionId)
            && Number(item?.session_id) === currentSessionId;
        const currentSessionClass = isCurrentSession ? ' current-session-item' : '';
        const toneClass = correctness ? ` tone-${correctness}` : '';
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
            const goToSessionIcon = window.icon ? window.icon('arrow-right', { size: 14, strokeWidth: 2.4 }) : '';
            const goToSessionButtonHtml = sessionUrl
                ? `<a class="go-to-session-btn" href="${escapeHtml(sessionUrl)}"><span>Go to Session</span>${goToSessionIcon}</a>`
                : '';
            const audioBlockHtml = window.AudioHistoryCommon.renderRow({
                item,
                audioExtraAttrs: lessonReadingAudioAttrs,
            });
            return `
                <div class="history-item type3-history-item${currentSessionClass}${toneClass}"${resultIdAttr !== null ? ` id="result-${resultIdAttr}" data-result-id="${resultIdAttr}"` : ''}>
                    <div class="history-head-row">
                        <div class="history-title-stack">
                            ${detailHtml}
                        </div>
                        <div class="answer-head-actions">
                            ${goToSessionButtonHtml}
                        </div>
                    </div>
                    ${audioBlockHtml}
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
                ? `<a class="history-item history-item-link${currentSessionClass}${toneClass}"${idAttrPart} href="${escapeHtml(sessionUrl)}">`
                : `<div class="history-item${currentSessionClass}${toneClass}"${idAttrPart}>`;
            const itemClose = sessionUrl ? '</a>' : '</div>';
            return `
                ${itemOpen}
                    <div class="history-type4-details">
                        <span class="history-details-main">
                            <span class="history-detail-group">
                                <span class="history-type4-submitted-label">Question:</span> <span class="history-type4-pill question-pill">${escapeHtml(prompt)}</span>
                                <span class="history-type4-submitted-label">Answer:</span> <span class="history-type4-pill answer-pill">${escapeHtml(answer)}</span>
                            </span>
                            <span class="history-detail-group submitted-group">
                                <span class="history-type4-submitted-label">Submitted:</span> ${submittedPills}
                            </span>
                        </span>
                        <span class="history-detail-group history-time-group">
                            <span class="history-time-badge">${escapeHtml(responseTimeLabel)}</span>
                            ${daysAgoBadge}
                        </span>
                    </div>
                    ${chevronHtml}
                ${itemClose}
            `;
        }
        const answer = getType1AttemptAnswer(item) || 'n/a';
        const isType2 = String(item?.session_behavior_type || '').trim().toLowerCase() === BEHAVIOR_TYPE_II;
        const submittedPills = getType1AttemptSubmittedPills(item);
        const submittedGroupHtml = isType2
            ? ''
            : `<span class="history-detail-group submitted-group">
                            <span class="history-type4-submitted-label">Submitted:</span> ${submittedPills}
                        </span>`;
        const resultIdAttr = Number.isFinite(Number(item?.result_id)) ? Number(item.result_id) : null;
        const idAttrPart = resultIdAttr !== null ? ` id="result-${resultIdAttr}" data-result-id="${resultIdAttr}"` : '';
        const itemOpen = sessionUrl
            ? `<a class="history-item history-item-link${currentSessionClass}${toneClass}"${idAttrPart} href="${escapeHtml(sessionUrl)}">`
            : `<div class="history-item${currentSessionClass}${toneClass}"${idAttrPart}>`;
        const itemClose = sessionUrl ? '</a>' : '</div>';
        return `
            ${itemOpen}
                <div class="history-type4-details">
                    <span class="history-details-main">
                        <span class="history-detail-group">
                            <span class="history-type4-submitted-label">Answer:</span> <span class="history-type4-pill answer-pill">${escapeHtml(answer)}</span>
                        </span>
                        ${submittedGroupHtml}
                    </span>
                    <span class="history-detail-group history-time-group">
                        <span class="history-time-badge">${escapeHtml(responseTimeLabel)}</span>
                        ${daysAgoBadge}
                    </span>
                </div>
                ${chevronHtml}
            ${itemClose}
        `;
    }).join('');

    if (from === 'lesson-reading' && window.LessonReadingDurationBackfill) {
        window.LessonReadingDurationBackfill.attach(historyList, { kidId });
    }
    window.AudioHistoryCommon.attachPlayers(historyList);
}

function buildSessionReportUrl(item) {
    const sessionId = Number(item?.session_id);
    if (!Number.isFinite(sessionId) || sessionId <= 0 || !kidId) {
        return '';
    }
    const fromSuffix = from === 'kid-home' ? '&from=kid-home' : '';
    return `/kid-session-report.html?id=${encodeURIComponent(kidId)}&sessionId=${encodeURIComponent(sessionId)}${fromSuffix}`;
}

// =====================================================================
// === 6. Scroll-to-target + attempt classifiers
// =====================================================================

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

// =====================================================================
// === 7. Attempt prompt / answer / logged-choice accessors
// =====================================================================

function getType4AttemptPrompt(item) {
    return String(item?.materialized_prompt || currentCardFront || 'Problem').trim() || 'Problem';
}

function getType4AttemptAnswer(item) {
    return String(item?.materialized_answer || '').trim();
}

function getType1AttemptAnswer(item) {
    return String(item?.back || currentCardBack || '').trim();
}

function getLoggedSubmittedAnswers(item) {
    return Array.isArray(item?.submitted_answers)
        ? item.submitted_answers.map((value) => String(value == null ? '' : value))
        : [];
}

function getLoggedSubmittedGrades(item) {
    return Array.isArray(item?.submitted_grades)
        ? item.submitted_grades.map((value) => Number(value))
        : [];
}

function isType1PromptAudioGrade(value) {
    const grade = Math.trunc(Number(value));
    return grade === 3 || grade === -3 || grade === -7;
}

function isType1IdkGrade(value) {
    const grade = Math.trunc(Number(value));
    return grade === -9 || grade === -7;
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
            const isIdk = isType1IdkGrade(grade);
            const cls = grade === 2
                ? 'partial-pill'
                : (grade > 0 ? 'answer-pill' : 'tried-pill');
            const audioAssistHtml = isType1PromptAudioGrade(grade) ? renderPromptAudioAssistMarker() : '';
            const displayText = isIdk ? "I don't know" : answer;
            return `
                <span class="history-type4-pill-wrap${audioAssistHtml ? ' has-audio-assist' : ''}">
                    <span class="history-type4-pill ${cls}${isIdk ? ' idk-pill' : ''}">${escapeHtml(displayText)}</span>
                    ${audioAssistHtml}
                </span>
            `;
        })
        .join('');
}

// =====================================================================
// === 8. Formatting helpers (response time, date, type label)
// =====================================================================

function isChineseLikeText(value) {
    return /[\u3400-\u9fff\uf900-\ufaff]/.test(String(value || ''));
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

function getCardDisplayLabel(front, back) {
    const frontText = String(front || '').trim();
    const backText = String(back || '').trim();
    return frontText || backText;
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
    let label = materializedMatch && String(materializedMatch[1] || '').trim()
        ? String(materializedMatch[1]).trim()
        : text;
    if (categoryKey && label.toLowerCase().startsWith(`${categoryKey.toLowerCase()}_`)) {
        label = label.slice(categoryKey.length + 1);
    }
    return label;
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
    return `${dayDiff}d ago`;
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

// =====================================================================
// === 9. Error display
// =====================================================================

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
