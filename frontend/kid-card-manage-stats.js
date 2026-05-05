// Stats / report views: cards-view-mode toggle, report renderer wiring, distribution histograms, daily progress chart.
function setupCardsViewModeToggle() {
    const buttons = document.querySelectorAll('[data-cards-view-toggle]');
    buttons.forEach((btn) => {
        btn.addEventListener('click', () => {
            const mode = btn.getAttribute('data-cards-view-toggle');
            setCardsViewMode(normalizeCardsViewMode(mode));
        });
    });
    const statsContainer = document.getElementById('cardsStatsView');
    if (statsContainer) {
        const handleBucketActivate = (target) => {
            const clearBtn = target.closest('[data-clear-bucket]');
            if (clearBtn) {
                const key = clearBtn.getAttribute('data-clear-bucket') || '';
                if (key) {
                    selectedBucketByPanel.delete(key);
                    renderStatsView();
                }
                return;
            }
            const slot = target.closest('[data-bucket-index]');
            if (!slot) return;
            const key = slot.getAttribute('data-panel-key') || '';
            const idx = Number.parseInt(slot.getAttribute('data-bucket-index'), 10);
            if (!key || !Number.isInteger(idx)) return;
            const current = selectedBucketByPanel.get(key);
            if (current === idx) {
                selectedBucketByPanel.delete(key);
            } else {
                selectedBucketByPanel.set(key, idx);
            }
            renderStatsView();
        };
        statsContainer.addEventListener('click', (event) => {
            handleBucketActivate(event.target);
        });
        statsContainer.addEventListener('keydown', (event) => {
            if (event.key !== 'Enter' && event.key !== ' ') return;
            const slot = event.target.closest && event.target.closest('[data-bucket-index]');
            if (!slot) return;
            event.preventDefault();
            handleBucketActivate(slot);
        });
    }
    setCardsViewMode(currentCardsViewMode);
}

function setCardsViewMode(mode) {
    const next = normalizeCardsViewMode(mode);
    currentCardsViewMode = next;
    try {
        localStorage.setItem(CARDS_VIEW_MODE_STORAGE_KEY, next);
    } catch (_err) {}
    document.body.classList.toggle('cards-view-mode-queue', next === 'queue');
    document.body.classList.toggle('cards-view-mode-stats', next === 'stats');
    document.body.classList.toggle('cards-view-mode-report', next === 'report');
    document.querySelectorAll('[data-cards-view-toggle]').forEach((btn) => {
        const isActive = btn.getAttribute('data-cards-view-toggle') === next;
        btn.classList.toggle('active', isActive);
        btn.setAttribute('aria-pressed', isActive ? 'true' : 'false');
    });
    if (next === 'stats') {
        renderStatsView();
    } else if (next === 'report') {
        loadReportViewIfNeeded();
    }
}

let reportRenderer = null;
let reportLoadState = 'idle';

function getReportRenderer() {
    if (reportRenderer) return reportRenderer;
    const summaryGrid = document.getElementById('reportSummaryGrid');
    if (!summaryGrid) return null;
    reportRenderer = window.KidReportCommon.createReport({
        elements: {
            summaryGrid,
            dailyChartBody: document.getElementById('reportDailyChartBody'),
            dailyChartLegend: document.getElementById('reportDailyChartLegend'),
            dailyChartPageLabel: document.getElementById('reportDailyChartPageLabel'),
            dailyChartNewerBtn: document.getElementById('reportDailyChartNewerBtn'),
            dailyChartOlderBtn: document.getElementById('reportDailyChartOlderBtn'),
        },
        fixedCategoryKey: categoryKey,
        clickBarToSession: true,
        buildSessionUrl: (session) => {
            const qs = new URLSearchParams();
            qs.set('id', String(kidId));
            qs.set('sessionId', String(session?.id || ''));
            qs.set('from', 'kid-card-manage');
            if (categoryKey) qs.set('categoryKey', categoryKey);
            return `/kid-session-report.html?${qs.toString()}`;
        },
    });
    return reportRenderer;
}

async function loadReportViewIfNeeded() {
    const renderer = getReportRenderer();
    if (!renderer) return;
    if (reportLoadState === 'loading' || reportLoadState === 'loaded') return;
    reportLoadState = 'loading';
    renderer.renderInitialLoading();
    try {
        const response = await fetch(`${API_BASE}/kids/${kidId}/report`);
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }
        const data = await response.json();
        const sessions = Array.isArray(data.sessions) ? data.sessions : [];
        renderer.setData({ sessions, familyTimezone: data.family_timezone });
        reportLoadState = 'loaded';
    } catch (error) {
        console.error('Error loading report view:', error);
        reportLoadState = 'error';
        renderer.renderInitialLoading('Failed to load practice report.');
    }
}

function renderStatsView() {
    const container = document.getElementById('cardsStatsView');
    if (!container) return;
    const cards = Array.isArray(currentCards) ? currentCards : [];
    const practiced = cards.filter((card) => getCardPracticeCount(card) > 0);
    const uniqueCount = practiced.length;
    const attemptTotal = practiced.reduce((sum, card) => sum + getCardPracticeCount(card), 0);
    if (!practiced.length) {
        container.innerHTML = `
            ${renderStatsSummary(uniqueCount, attemptTotal)}
            <div class="cards-view-placeholder">Practice a few cards to unlock card distributions.</div>
        `;
        return;
    }
    const getCardCapsuleLabel = makeCardCapsuleLabelGetter(currentBehaviorType);
    const panels = [
        buildAccuracyDistribution(practiced, getCardCapsuleLabel),
        buildPracticeCountDistribution(practiced, getCardCapsuleLabel),
        buildSpeedDistribution(practiced, getCardCapsuleLabel),
        buildLastSeenDistribution(practiced, getCardCapsuleLabel),
    ];
    const dailyProgress = buildDailyProgressChart(currentDailyProgressRows, currentFamilyTimezone);
    container.innerHTML = `
        ${renderStatsSummary(uniqueCount, attemptTotal)}
        ${dailyProgress ? renderDailyProgressPanel(dailyProgress) : ''}
        <div class="cards-distribution-grid">
            ${panels.map((panel) => renderDistributionPanel(panel)).join('')}
        </div>
    `;
}

function renderStatsSummary(uniqueCount, attemptTotal) {
    return `
        <div class="cards-stats-summary">
            <span>Practiced Cards <strong>${escapeHtml(String(uniqueCount))}</strong></span>
            <span>Practiced Counts <strong>${escapeHtml(String(attemptTotal))}</strong></span>
        </div>
    `;
}

function getCardPracticeCount(card) {
    const attempts = Number.parseInt(card?.lifetime_attempts, 10);
    return Number.isInteger(attempts) ? Math.max(0, attempts) : 0;
}

function getCardCorrectRatePct(card) {
    if (getCardPracticeCount(card) <= 0) return null;
    const wrongRate = Number(card?.overall_wrong_rate);
    if (!Number.isFinite(wrongRate)) return null;
    return Math.max(0, Math.min(100, 100 - wrongRate));
}

function getCardAverageSpeedMs(card) {
    const avgMs = Number(card?.avg_response_time_ms);
    if (Number.isFinite(avgMs) && avgMs > 0) return avgMs;
    const fallback = Number(card?.practice_priority_avg_correct_response_time);
    if (Number.isFinite(fallback) && fallback > 0) return fallback;
    return null;
}

function getCardDaysSinceLastSeen(card) {
    if (getCardPracticeCount(card) <= 0) return null;
    const seenAt = card?.last_seen_at;
    if (!seenAt) return null;
    const seenMs = new Date(seenAt).getTime();
    if (!Number.isFinite(seenMs)) return null;
    const dayDiff = Math.floor((Date.now() - seenMs) / (24 * 60 * 60 * 1000));
    return Math.max(0, dayDiff);
}

function makeCardCapsuleLabelGetter(behaviorType) {
    return (card) => {
        const front = String(card?.front || '').trim();
        const back = String(card?.back || '').trim();
        if (behaviorType === BEHAVIOR_TYPE_TYPE_II) return back || front;
        return front || back;
    };
}

const selectedBucketByPanel = new Map();

function buildAccuracyDistribution(cards, getCardCapsuleLabel) {
    const panelKey = 'accuracy';
    return buildHistogramDistribution({
        panelKey,
        selectedBucketIndex: selectedBucketByPanel.get(panelKey),
        title: 'Correct Rate',
        tone: 'accuracy',
        formatValue: formatPercentLabel,
        getValue: getCardCorrectRatePct,
        getCardCapsuleLabel,
        percentileMarkers: [10, 90],
        bucketing: {
            snapUnit: 1,
            minClamp: 0,
            maxClamp: 100,
            formatRange: (min, max) => `${formatBoundaryNumber(min)}–${formatBoundaryNumber(max)}%`,
        },
        topLists: [
            { title: 'Highest 5', mode: 'highest', count: 5 },
            { title: 'Lowest 5', mode: 'lowest', count: 5 },
        ],
        cards,
    });
}

function buildPracticeCountDistribution(cards, getCardCapsuleLabel) {
    const panelKey = 'counts';
    return buildHistogramDistribution({
        panelKey,
        selectedBucketIndex: selectedBucketByPanel.get(panelKey),
        title: 'Practice Count',
        tone: 'counts',
        formatValue: formatCountLabel,
        getValue: getCardPracticeCount,
        getCardCapsuleLabel,
        bucketing: {
            snapUnit: 1,
            minClamp: 1,
            isInteger: true,
            formatRange: formatIntegerCaptureRange,
        },
        topLists: [
            { title: 'Top 5', mode: 'highest', count: 5 },
            { title: 'Bottom 5', mode: 'lowest', count: 5 },
        ],
        cards,
    });
}

function buildSpeedDistribution(cards, getCardCapsuleLabel) {
    const panelKey = 'speed';
    return buildHistogramDistribution({
        panelKey,
        selectedBucketIndex: selectedBucketByPanel.get(panelKey),
        title: 'Average Speed',
        tone: 'speed',
        formatValue: formatSpeedLabel,
        getValue: getCardAverageSpeedMs,
        getCardCapsuleLabel,
        bucketing: {
            snapUnit: 1000,
            minClamp: 0,
            anchorLo: 'dataMin',
            formatRange: (min, max) => `${formatBoundarySeconds(min)}–${formatBoundarySeconds(max)}s`,
        },
        topLists: [
            { title: 'Slowest 5', mode: 'highest', count: 5 },
            { title: 'Fastest 5', mode: 'lowest', count: 5 },
        ],
        cards,
    });
}

function buildLastSeenDistribution(cards, getCardCapsuleLabel) {
    const panelKey = 'recency';
    return buildHistogramDistribution({
        panelKey,
        selectedBucketIndex: selectedBucketByPanel.get(panelKey),
        title: 'Days Since Last Seen',
        tone: 'recency',
        formatValue: formatDaysLabel,
        getValue: getCardDaysSinceLastSeen,
        getCardCapsuleLabel,
        bucketing: {
            snapUnit: 1,
            minClamp: 0,
            isInteger: true,
            anchorLo: 'dataMin',
            formatRange: formatIntegerCaptureRange,
        },
        topLists: [
            { title: 'Stalest 5', mode: 'highest', count: 5 },
            { title: 'Freshest 5', mode: 'lowest', count: 5 },
        ],
        cards,
    });
}

function buildDailyProgressChart(dailyProgressRows, familyTimezone) {
    const rows = Array.isArray(dailyProgressRows) ? dailyProgressRows : [];
    const validRows = [];
    for (const row of rows) {
        const cardId = Number(row?.card_id);
        const date = String(row?.date || '').trim();
        const attempts = Math.max(0, Number.parseInt(row?.attempts, 10) || 0);
        const correct = Math.max(0, Number.parseInt(row?.correct, 10) || 0);
        const rtSum = Math.max(0, Number.parseInt(row?.correct_response_time_ms_sum, 10) || 0);
        const rtCount = Math.max(0, Number.parseInt(row?.correct_response_time_count, 10) || 0);
        if (!Number.isFinite(cardId) || cardId <= 0 || !date || attempts <= 0) continue;
        validRows.push({ cardId, date, attempts, correct, rtSum, rtCount });
    }
    if (!validRows.length) return null;
    const rowsByDate = new Map();
    for (const row of validRows) {
        if (!rowsByDate.has(row.date)) rowsByDate.set(row.date, []);
        rowsByDate.get(row.date).push(row);
    }
    const sortedDates = Array.from(rowsByDate.keys()).sort();
    const firstDate = sortedDates[0];
    const lastDate = sortedDates[sortedDates.length - 1];
    const startEpoch = parseDateKeyToEpochUtc(firstDate);
    const lastDataEpoch = parseDateKeyToEpochUtc(lastDate);
    if (!Number.isFinite(startEpoch) || !Number.isFinite(lastDataEpoch) || lastDataEpoch < startEpoch) return null;
    const todayDateKey = getTodayDateKeyInTimezone(familyTimezone);
    const todayEpoch = parseDateKeyToEpochUtc(todayDateKey);
    const endEpoch = Number.isFinite(todayEpoch) && todayEpoch > lastDataEpoch ? todayEpoch : lastDataEpoch;
    const dayMs = 24 * 60 * 60 * 1000;
    const cardCum = new Map();
    const practicedSet = new Set();
    const learnedSet = new Set();
    const points = [];
    let dayIndex = 0;
    let cumRtSumMs = 0;
    let cumRtCount = 0;
    for (let epoch = startEpoch; epoch <= endEpoch; epoch += dayMs) {
        dayIndex += 1;
        const dateStr = formatEpochUtcToDateKey(epoch);
        const dayRows = rowsByDate.get(dateStr) || [];
        for (const row of dayRows) {
            let cum = cardCum.get(row.cardId);
            if (!cum) {
                cum = { attempts: 0, correct: 0 };
                cardCum.set(row.cardId, cum);
            }
            cum.attempts += row.attempts;
            cum.correct += row.correct;
            practicedSet.add(row.cardId);
            if (cum.attempts >= 5 && (cum.correct / cum.attempts) >= 0.8) {
                learnedSet.add(row.cardId);
            }
            cumRtSumMs += row.rtSum;
            cumRtCount += row.rtCount;
        }
        const avgCorrectRtSec = cumRtCount > 0 ? (cumRtSumMs / cumRtCount) / 1000 : null;
        points.push({
            dayIndex,
            date: dateStr,
            practiced: practicedSet.size,
            learned: learnedSet.size,
            avgCorrectRtSec,
        });
    }
    const yMax = Math.max(1, points.reduce((max, p) => Math.max(max, p.practiced, p.learned), 0));
    let rtMin = Infinity;
    let rtMax = 0;
    for (const p of points) {
        const v = Number(p.avgCorrectRtSec);
        if (!Number.isFinite(v)) continue;
        if (v < rtMin) rtMin = v;
        if (v > rtMax) rtMax = v;
    }
    const hasRtData = Number.isFinite(rtMin) && rtMax > 0;
    return {
        title: 'Daily Progress',
        firstDate,
        lastDate,
        totalDays: points.length,
        points,
        yMax,
        rtMin: hasRtData ? rtMin : null,
        rtMax: hasRtData ? rtMax : 0,
    };
}

function getTodayDateKeyInTimezone(timezone) {
    const tz = String(timezone || '').trim();
    try {
        const formatter = new Intl.DateTimeFormat('en-CA', {
            timeZone: tz || undefined,
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
        });
        const parts = formatter.formatToParts(new Date());
        const year = parts.find((p) => p.type === 'year')?.value;
        const month = parts.find((p) => p.type === 'month')?.value;
        const day = parts.find((p) => p.type === 'day')?.value;
        if (year && month && day) return `${year}-${month}-${day}`;
    } catch (_) {
        // fall through to UTC fallback
    }
    return formatEpochUtcToDateKey(Date.now());
}

function parseDateKeyToEpochUtc(dateStr) {
    const text = String(dateStr || '').trim();
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
    if (!match) return NaN;
    return Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

function formatEpochUtcToDateKey(epochMs) {
    const dt = new Date(epochMs);
    if (Number.isNaN(dt.getTime())) return '';
    const y = dt.getUTCFullYear();
    const m = String(dt.getUTCMonth() + 1).padStart(2, '0');
    const d = String(dt.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

function buildDailyProgressYTicks(yMax) {
    const safeMax = Math.max(1, Number(yMax) || 0);
    const step = getNiceHistogramStep(safeMax / 4);
    const axisMax = Math.max(step, Math.ceil(safeMax / step) * step);
    const ticks = [];
    for (let value = 0; value <= axisMax; value += step) ticks.push(value);
    return ticks;
}

function buildResponseTimeYTicks(rtMin, rtMax) {
    const lo = Math.max(0, Math.floor(Number(rtMin) || 0));
    const hi = Math.max(lo + 1, Number(rtMax) || lo + 1);
    const span = Math.max(1, hi - lo);
    const step = getNiceHistogramStep(span / 4);
    const axisMax = lo + Math.max(step, Math.ceil(span / step) * step);
    const ticks = [];
    for (let value = lo; value <= axisMax; value += step) ticks.push(value);
    return ticks;
}

function buildDailyProgressXTicks(totalDays) {
    const days = Math.max(1, Number(totalDays) || 1);
    const lastTick = days - 1;
    if (lastTick <= 0) return [0];
    const targetCount = 5;
    const candidateSteps = [1, 2, 5, 10, 25, 50, 100, 250, 500, 1000];
    let step = candidateSteps[candidateSteps.length - 1];
    for (const s of candidateSteps) {
        if (Math.floor(lastTick / s) + 1 <= targetCount) {
            step = s;
            break;
        }
    }
    const minGap = Math.max(1, Math.floor(step * 0.6));
    const ticks = new Set([0]);
    for (let v = step; v <= lastTick - minGap; v += step) ticks.add(v);
    ticks.add(lastTick);
    return Array.from(ticks).sort((a, b) => a - b);
}

function renderDailyProgressPanel(chart) {
    const points = Array.isArray(chart?.points) ? chart.points : [];
    if (!points.length) return '';
    const totalDays = Math.max(1, Number(chart?.totalDays) || points.length);
    const yMax = Math.max(1, Number(chart?.yMax) || 0);
    const yTicks = buildDailyProgressYTicks(yMax);
    const axisMax = yTicks[yTicks.length - 1] || yMax;
    const rtMaxRaw = Number(chart?.rtMax) || 0;
    const rtMinRaw = Number(chart?.rtMin);
    const hasRtData = rtMaxRaw > 0 && Number.isFinite(rtMinRaw);
    const rtTicks = hasRtData ? buildResponseTimeYTicks(rtMinRaw, rtMaxRaw) : [];
    const rtAxisMin = rtTicks.length ? rtTicks[0] : 0;
    const rtAxisMax = rtTicks.length ? rtTicks[rtTicks.length - 1] : 0;
    const rtAxisRange = rtAxisMax - rtAxisMin;
    const xTicks = buildDailyProgressXTicks(totalDays);
    const positionForDay = (dayIndex) => totalDays <= 1 ? 50 : ((dayIndex - 1) / (totalDays - 1)) * 100;
    const positionForValue = (value) => axisMax <= 0 ? 0 : (Number(value) / axisMax) * 100;
    const positionForRt = (value) => rtAxisRange <= 0 ? 0 : ((Number(value) - rtAxisMin) / rtAxisRange) * 100;
    const buildLinePath = (key) => points.map((point, idx) => {
        const x = positionForDay(point.dayIndex).toFixed(2);
        const y = (100 - positionForValue(point[key])).toFixed(2);
        return `${idx === 0 ? 'M' : 'L'}${x},${y}`;
    }).join(' ');
    const buildResponseTimePath = () => {
        const segments = [];
        let pendingMove = true;
        for (const point of points) {
            const value = Number(point.avgCorrectRtSec);
            if (!Number.isFinite(value)) {
                pendingMove = true;
                continue;
            }
            const x = positionForDay(point.dayIndex).toFixed(2);
            const y = (100 - positionForRt(value)).toFixed(2);
            segments.push(`${pendingMove ? 'M' : 'L'}${x},${y}`);
            pendingMove = false;
        }
        return segments.join(' ');
    };
    const practicedPath = buildLinePath('practiced');
    const learnedPath = buildLinePath('learned');
    const responseTimePath = hasRtData ? buildResponseTimePath() : '';
    const lastPoint = points[points.length - 1] || { practiced: 0, learned: 0, avgCorrectRtSec: null };
    const lastRtValue = Number(lastPoint?.avgCorrectRtSec);
    const lastRtLabel = Number.isFinite(lastRtValue) ? `${lastRtValue.toFixed(2)}s` : '—';
    const formatRtTick = (tick) => {
        const num = Number(tick);
        if (!Number.isFinite(num)) return '';
        return Number.isInteger(num) ? `${num}s` : `${num.toFixed(1)}s`;
    };
    return `
        <div class="cards-distribution-card daily-progress-card${hasRtData ? ' has-response-time' : ''}">
            <div class="cards-distribution-card-head">
                <div class="cards-distribution-card-title">${escapeHtml(String(chart?.title || 'Daily Progress'))}</div>
                <div class="daily-progress-legend">
                    <span class="daily-progress-legend-item practiced"><span class="daily-progress-legend-swatch"></span>Practiced (${escapeHtml(String(lastPoint.practiced))})</span>
                    <span class="daily-progress-legend-item learned"><span class="daily-progress-legend-swatch"></span>Learned (${escapeHtml(String(lastPoint.learned))})</span>
                    ${hasRtData ? `<span class="daily-progress-legend-item response-time"><span class="daily-progress-legend-swatch"></span>Avg correct response (${escapeHtml(lastRtLabel)})</span>` : ''}
                </div>
            </div>
            <div class="daily-progress-chart">
                <div class="daily-progress-y-label">Cards</div>
                <div class="daily-progress-y-axis">
                    ${yTicks.map((tick) => `
                        <div class="daily-progress-y-tick" style="bottom:${positionForValue(tick).toFixed(2)}%">${escapeHtml(String(tick))}</div>
                    `).join('')}
                </div>
                ${hasRtData ? `
                    <div class="daily-progress-y-label daily-progress-y-label-right">Response</div>
                    <div class="daily-progress-y-axis daily-progress-y-axis-right">
                        ${rtTicks.map((tick) => `
                            <div class="daily-progress-y-tick" style="bottom:${positionForRt(tick).toFixed(2)}%">${escapeHtml(formatRtTick(tick))}</div>
                        `).join('')}
                    </div>
                ` : ''}
                <div class="daily-progress-plot">
                    <div class="daily-progress-grid">
                        ${yTicks.map((tick) => `
                            <div class="daily-progress-grid-line" style="bottom:${positionForValue(tick).toFixed(2)}%"></div>
                        `).join('')}
                        ${xTicks.map((tick) => `
                            <div class="daily-progress-grid-line-vertical" style="left:${positionForDay(tick + 1).toFixed(2)}%"></div>
                        `).join('')}
                    </div>
                    <svg class="daily-progress-svg" viewBox="0 0 100 100" preserveAspectRatio="none">
                        <path class="daily-progress-line practiced" d="${practicedPath}" />
                        <path class="daily-progress-line learned" d="${learnedPath}" />
                        ${responseTimePath ? `<path class="daily-progress-line response-time" d="${responseTimePath}" />` : ''}
                    </svg>
                    <div class="daily-progress-x-axis">
                        ${xTicks.map((tick) => {
                            const isLast = tick === totalDays - 1;
                            return `
                            <div class="daily-progress-x-tick${isLast ? ' is-today' : ''}" style="left:${positionForDay(tick + 1).toFixed(2)}%">${escapeHtml(String(tick))}d${isLast ? '<div class="daily-progress-x-tick-today">(today)</div>' : ''}</div>
                        `;
                        }).join('')}
                    </div>
                </div>
            </div>
            <div class="daily-progress-definition">
                <strong>Learned</strong> = cumulative count of distinct cards with at least 5 attempts and ≥80% correct rate.
            </div>
        </div>
    `;
}

