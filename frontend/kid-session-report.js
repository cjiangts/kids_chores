/*
 * kid-session-report.js — single-session detail report.
 *
 * Loads one session by id, renders a summary hero, the outcome counts
 * (wrong / right / drill totals), a card list grouped by outcome, plus
 * specialty visualizations: speed distribution buckets (type-I) and
 * drill progress table (type-I drill mode).
 *
 * Type-III sessions add inline grading controls (review-and-resolve).
 *
 * Layout (search for `// === N. ` banners to jump between sections):
 *
 *     1. DOM refs + bootstrap
 *     2. Session load + summary render
 *     3. Drill-mode answer cards + progress table
 *     4. Speed distribution panel (type-I)
 *     5. Date/time formatting + practice-mode label
 *     6. Answer list render (card rows, response-time bars, grading)
 *     7. Live duration backfill + active-minutes sync
 *     8. Grading controls (type-III review-and-resolve)
 *     9. Card report link + answer-label helpers
 *    10. Misc helpers (timestamps, error display)
 */

const API_BASE = `${window.location.origin}/api`;

const params = new URLSearchParams(window.location.search);
const kidId = params.get('id');
const sessionId = params.get('sessionId');
const from = String(params.get('from') || '').trim().toLowerCase();

const pageTitle = document.getElementById('pageTitle');
const backBtn = document.getElementById('backBtn');
const errorMessage = document.getElementById('errorMessage');
const summaryCard = document.getElementById('summaryCard');
const wrongSection = document.getElementById('wrongSection');
const rightSection = document.getElementById('rightSection');
const rightSectionTitle = document.getElementById('rightSectionTitle');
const rightSectionIconHost = document.getElementById('rightSectionIconHost');
const wrongList = document.getElementById('wrongList');
const rightList = document.getElementById('rightList');
const speedDistributionSection = document.getElementById('speedDistributionSection');
const speedDistributionBody = document.getElementById('speedDistributionBody');
const rightSectionHint = document.getElementById('rightSectionHint');
const drillProgressSection = document.getElementById('drillProgressSection');
const drillProgressBody = document.getElementById('drillProgressBody');
const speedDistributionPanelKey = 'session-speed';
let selectedSpeedBucketIndex = null;
let currentSession = null;
const {
    normalizeCategoryKey,
    normalizeBehaviorType,
} = window.DeckCategoryCommon;
const BEHAVIOR_TYPE_I = 'type_i';
const BEHAVIOR_TYPE_II = 'type_ii';
const BEHAVIOR_TYPE_III = 'type_iii';
const BEHAVIOR_TYPE_IV = 'type_iv';
const DRILL_FAST_CORRECT_NEEDED = 2;
const SUMMARY_FIXED_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>';
let reportTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
let currentSessionType = '';
let currentSessionBehaviorType = '';
let currentSessionCategoryDisplayName = '';
let currentSessionHasChineseSpecificLogic = false;
let currentSessionRetryCount = 0;
let currentSessionPracticeMode = '';
let currentSessionIsDrill = false;
let currentSessionDrillSpeedTargetMs = 0;
let liveDurationBackfillBound = false;
let currentAnswers = [];
let currentKidName = '';

// =====================================================================
// === 1. DOM refs + bootstrap
// =====================================================================
document.addEventListener('DOMContentLoaded', async () => {
    if (!kidId || !sessionId) {
        window.location.href = '/admin.html';
        return;
    }
    bindBackButton();
    bindLiveDurationBackfillUpdates();
    await loadReportTimezone();
    await loadSessionDetail();
});

function bindBackButton() {
    window.ReportBackButtonCommon?.bindBackButton(backBtn, resolveBackHref());
}

function resolveBackHref() {
    if (!kidId) {
        return '/admin.html';
    }
    if (from === 'kid-card-manage') {
        const qs = new URLSearchParams();
        qs.set('id', String(kidId));
        const categoryKey = String(params.get('categoryKey') || '').trim();
        if (categoryKey) qs.set('categoryKey', categoryKey);
        return `/kid-card-manage.html?${qs.toString()}`;
    }
    const qs = new URLSearchParams();
    qs.set('id', String(kidId));
    if (from === 'kid-home') {
        qs.set('from', 'kid-home');
    }
    return `/kid-report.html?${qs.toString()}`;
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

// =====================================================================
// === 2. Session load + summary render
// =====================================================================
async function loadSessionDetail() {
    try {
        showError('');
        const response = await fetch(`${API_BASE}/kids/${kidId}/report/sessions/${sessionId}`);
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }

        const data = await response.json();
        const kidName = data.kid?.name || 'Kid';
        currentKidName = kidName;
        const session = data.session || {};
        currentSessionType = normalizeCategoryKey(session.type);
        currentSessionBehaviorType = normalizeBehaviorType(session.behavior_type);
        currentSessionCategoryDisplayName = String(session.category_display_name || '').trim();
        currentSessionHasChineseSpecificLogic = Boolean(session.has_chinese_specific_logic);
        currentSessionRetryCount = Math.max(0, Number.parseInt(session.retry_count, 10) || 0);
        currentSessionPracticeMode = String(session.practice_mode || '').trim().toLowerCase();
        currentSessionIsDrill = currentSessionPracticeMode.endsWith('+drill');
        currentSessionDrillSpeedTargetMs = Math.max(
            0,
            Number.parseInt(session.drill_speed_target_ms, 10) || 0
        );
        pageTitle.textContent = `${kidName} · Session`;
        document.title = `${kidName} - Session #${session.id || sessionId} - Kids Daily Chores`;

        const answers = Array.isArray(data.answers) ? data.answers : [];
        currentAnswers = answers;
        currentSession = session;
        renderSummary(session, answers);
        renderAnswerSections(answers);
        renderSpeedDistribution(answers);
    } catch (error) {
        console.error('Error loading session detail:', error);
        showError('Failed to load session detail.');
        document.title = 'Session Detail - Kids Daily Chores';
    }
}

function renderSummary(session, answers) {
    if (!summaryCard) return;
    const totalActiveMs = calculateSessionActiveMs(answers);
    const startedRaw = session?.started_at;
    const startedDate = formatStartedDate(startedRaw);
    const relativeDay = formatRelativeDay(startedRaw);
    const counts = currentSessionIsDrill ? null : countAnswersByOutcome(answers);
    const drillCardCounts = currentSessionIsDrill ? countDrillCardOutcomes(answers) : null;
    const modeLabel = formatPracticeMode(session?.practice_mode) || currentSessionCategoryDisplayName || '';
    const showModeMeta = currentSessionBehaviorType !== BEHAVIOR_TYPE_II && currentSessionBehaviorType !== BEHAVIOR_TYPE_III;
    const summaryFooterHtml = drillCardCounts
        ? renderDrillSummaryOutcomes(drillCardCounts, totalActiveMs)
        : renderStandardSummaryOutcomes(counts, totalActiveMs);
    const metaItems = [];
    if (startedDate) metaItems.push({ icon: 'calendar', value: `Started ${startedDate}` });
    if (relativeDay) metaItems.push({ icon: 'history', value: relativeDay });
    if (showModeMeta && modeLabel) metaItems.push({ icon: 'target', value: `${modeLabel} mode` });
    const metaHtml = metaItems.map((item) => {
        const iconHtml = window.icon ? window.icon(item.icon, { size: 12, strokeWidth: 2.4 }) : '';
        return `<span class="report-hero-meta-item"><span class="report-hero-meta-icon">${iconHtml}</span><span class="report-hero-meta-value">${escapeHtml(item.value)}</span></span>`;
    }).join('');
    summaryCard.innerHTML = `
        ${renderSummaryHero(metaHtml)}
        ${summaryFooterHtml}
    `;
}

function renderSummaryHero(metaHtml) {
    const key = String(currentSessionType || '').trim();
    const hasIcon = key && window.SUBJECT_ICONS && window.SUBJECT_ICONS[key];
    const title = currentSessionCategoryDisplayName
        || (key ? key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()) : '');
    if (!title) return '';
    const iconHtml = hasIcon ? window.subjectIcon(key, { size: 44 }) : '';
    const subjectIconHtml = window.icon ? window.icon('book-open', { size: 12, strokeWidth: 2.4 }) : '';
    const subjectMetaHtml = `<span class="report-hero-meta-item"><span class="report-hero-meta-icon">${subjectIconHtml}</span><span class="report-hero-meta-value">${escapeHtml(title)}</span></span>`;
    const actionHtml = window.ReportHeroAction.renderActionLinkHtml({
        id: 'subjectActionBtn',
        href: buildSessionHistoryHref(),
        label: 'Session History',
        leadingIcon: 'history',
        trailingIcon: 'arrow-right',
    });
    return `
        <div class="session-summary-hero">
            ${iconHtml ? `<div class="session-summary-hero-icon">${iconHtml}</div>` : ''}
            <div class="session-summary-hero-text">
                <div class="report-hero-meta">${subjectMetaHtml}${metaHtml}</div>
            </div>
            ${actionHtml}
        </div>
    `;
}

function buildSessionHistoryHref() {
    const qs = new URLSearchParams();
    qs.set('id', String(kidId || ''));
    if (currentSessionType) qs.set('categoryKey', String(currentSessionType));
    qs.set('view', 'report');
    if (sessionId) qs.set('highlightSessionId', String(sessionId));
    return `/kid-card-manage.html?${qs.toString()}`;
}

const SUMMARY_ACTIVE_TIME_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="10" x2="14" y1="2" y2="2"/><line x1="12" x2="15" y1="14" y2="11"/><circle cx="12" cy="14" r="8"/></svg>';

function buildActiveTimeItem(totalActiveMs) {
    return {
        tone: 'time',
        label: 'Active Time',
        valueHtml: `<span id="summaryActiveTimeValue">${escapeHtml(formatActiveMinutes(totalActiveMs))}</span>`,
        icon: SUMMARY_ACTIVE_TIME_ICON,
    };
}

function renderDrillSummaryOutcomes(totals, totalActiveMs) {
    if (!totals) return '';
    const items = [
        buildActiveTimeItem(totalActiveMs),
        {
            tone: 'passed',
            label: 'Passed',
            value: totals.passed,
            icon: window.icon('check', { strokeWidth: 2.4, className: '' }),
        },
        {
            tone: 'fixed',
            label: 'Fixed',
            value: totals.fixed,
            icon: SUMMARY_FIXED_ICON,
        },
        {
            tone: 'slow',
            label: 'Still slow',
            value: totals.slow,
            icon: window.icon('clock', { strokeWidth: 2.2, className: '' }),
        },
        {
            tone: 'wrong',
            label: 'Wrong',
            value: totals.wrong,
            icon: window.icon('x', { strokeWidth: 2.4, className: '' }),
        },
    ];
    return renderSummaryOutcomes(items, items.length);
}

function renderStandardSummaryOutcomes(totals, totalActiveMs) {
    if (!totals) return '';
    const isType3 = currentSessionBehaviorType === BEHAVIOR_TYPE_III;
    const middleItem = isType3
        ? {
            tone: 'pending',
            label: 'Ungraded',
            value: totals.pending,
            icon: window.icon('help', { strokeWidth: 2.4, className: '' }),
        }
        : {
            tone: 'fixed',
            label: 'Fixed',
            value: totals.fixed,
            icon: SUMMARY_FIXED_ICON,
        };
    const totalAttempts = (totals.right || 0) + (totals.fixed || 0) + (totals.wrong || 0) + (totals.half || 0) + (totals.pending || 0);
    const items = [
        buildActiveTimeItem(totalActiveMs),
        {
            tone: 'attempts',
            label: 'Attempts',
            value: totalAttempts,
            icon: window.icon('layers', { strokeWidth: 2.4, className: '' }),
        },
        {
            tone: 'right',
            label: 'Right',
            value: totals.right,
            icon: window.icon('check', { strokeWidth: 2.4, className: '' }),
        },
        middleItem,
        {
            tone: 'wrong',
            label: 'Wrong',
            value: totals.wrong,
            icon: window.icon('x', { strokeWidth: 2.4, className: '' }),
        },
    ];
    return renderSummaryOutcomes(items, items.length);
}

function renderSummaryOutcomes(items, columns) {
    if (!Array.isArray(items) || items.length === 0) return '';
    const safeColumns = Math.max(1, Math.min(5, Number(columns) || items.length || 1));
    return `
        <div class="session-summary-drill-outcomes columns-${safeColumns}">
            ${items.map((item) => `
                <div class="session-summary-drill-outcome ${item.tone}">
                    <div class="session-summary-drill-outcome-icon">${item.icon}</div>
                    <div class="session-summary-drill-outcome-value">${item.valueHtml || safeNum(item.value)}</div>
                    <div class="session-summary-drill-outcome-label">${item.label}</div>
                </div>
            `).join('')}
        </div>
    `;
}

function countAnswersByOutcome(answers) {
    const totals = { right: 0, fixed: 0, wrong: 0, half: 0, pending: 0 };
    if (!Array.isArray(answers)) return totals;
    for (const item of answers) {
        const cls = getAnswerBarClassByScore(item?.correct_score);
        if (cls === 'right') totals.right += 1;
        else if (cls === 'fixed') totals.fixed += 1;
        else if (cls === 'wrong') totals.wrong += 1;
        else if (cls === 'half') totals.half += 1;
        else totals.pending += 1;
    }
    return totals;
}

function renderAnswerSections(answers) {
    wrongSection.style.display = 'none';
    rightSection.style.display = '';
    if (currentSessionIsDrill) {
        rightSectionTitle.textContent = 'Drilled Cards';
        if (rightSectionIconHost) rightSectionIconHost.innerHTML = window.icon('layers', { size: 22 });
        if (rightSectionHint) {
            rightSectionHint.textContent = 'Tap a card to view details. The small number on top shows how many times it was drilled.';
            rightSectionHint.style.display = '';
        }
        renderDrillCards(rightList, answers);
        renderDrillProgressTable(answers);
        return;
    }
    rightSectionTitle.textContent = 'Cards Practiced';
    if (rightSectionIconHost) rightSectionIconHost.innerHTML = window.icon('layers', { size: 22 });
    if (rightSectionHint) {
        if (isTypeIIIReviewSession()) {
            rightSectionHint.textContent = '';
            rightSectionHint.style.display = 'none';
        } else {
            rightSectionHint.textContent = 'Tap a card to view details. The small number on top shows how many times it was retried.';
            rightSectionHint.style.display = '';
        }
    }
    if (drillProgressSection) drillProgressSection.style.display = 'none';
    const compact = !isTypeIIIReviewSession();
    renderAnswerList(rightList, answers, { compact, keepSingleGroupOrder: false });
}

function groupAnswersByCard(answers) {
    const order = [];
    const groups = new Map();
    if (!Array.isArray(answers)) return [];
    for (const item of answers) {
        const key = Number.isFinite(Number(item?.card_id)) ? Number(item.card_id) : `__r${item?.result_id || ''}`;
        if (!groups.has(key)) {
            groups.set(key, []);
            order.push(key);
        }
        groups.get(key).push(item);
    }
    return order.map((key) => ({ key, attempts: groups.get(key) }));
}

// =====================================================================
// === 3. Drill-mode answer cards + progress table
// =====================================================================
function getDrillAttemptResultClass(attempt) {
    return getAnswerBarClassByScore(attempt?.correct_score);
}

function isDrillAttemptWrongState(attempt) {
    const cls = getDrillAttemptResultClass(attempt);
    return cls === 'wrong' || cls === 'half' || cls === 'pending';
}

function classifyDrillAttempt(attempt) {
    const score = Number(attempt?.correct_score);
    const isCorrect = score === 1 || score <= -2;
    if (!isCorrect) return 'wrong';
    const ms = Math.max(0, Number(attempt?.response_time_ms) || 0);
    const target = currentSessionDrillSpeedTargetMs > 0 ? currentSessionDrillSpeedTargetMs : 3000;
    return ms > 0 && ms <= target ? 'fast' : 'slow';
}

function pickDrillLinkAttempt(attempts, outcome) {
    if (!Array.isArray(attempts) || attempts.length === 0) return null;
    if (outcome === 'wrong') {
        const match = attempts.find((attempt) => isDrillAttemptWrongState(attempt));
        if (match) return match;
    }
    if (outcome === 'fixed') {
        const match = attempts.find((attempt) => getDrillAttemptResultClass(attempt) === 'fixed');
        if (match) return match;
    }
    if (outcome === 'slow') {
        const match = attempts.find((attempt) => classifyDrillAttempt(attempt) === 'slow');
        if (match) return match;
    }
    return attempts[attempts.length - 1];
}

function classifyDrillCardOutcome(attempts) {
    if (!Array.isArray(attempts) || attempts.length === 0) return 'wrong';
    let fastCount = 0;
    let hasWrong = false;
    let hasFixed = false;
    for (const attempt of attempts) {
        if (isDrillAttemptWrongState(attempt)) {
            hasWrong = true;
        } else if (getDrillAttemptResultClass(attempt) === 'fixed') {
            hasFixed = true;
        }
        if (classifyDrillAttempt(attempt) === 'fast') fastCount += 1;
    }
    if (hasWrong) return 'wrong';
    if (hasFixed) return 'fixed';
    if (fastCount >= DRILL_FAST_CORRECT_NEEDED) return 'passed';
    return 'slow';
}

function countDrillCardOutcomes(answers) {
    const totals = { drilled: 0, passed: 0, fixed: 0, slow: 0, wrong: 0 };
    const groups = groupAnswersByCard(answers);
    for (const { attempts } of groups) {
        totals.drilled += 1;
        const outcome = classifyDrillCardOutcome(attempts);
        if (outcome === 'passed') totals.passed += 1;
        else if (outcome === 'fixed') totals.fixed += 1;
        else if (outcome === 'slow') totals.slow += 1;
        else if (outcome === 'wrong') totals.wrong += 1;
    }
    return totals;
}

function renderDrillCards(container, answers) {
    const groups = groupAnswersByCard(answers);
    if (groups.length === 0) {
        container.innerHTML = `<div style="color:#666;font-size:0.86rem;">No cards.</div>`;
        return;
    }
    const reportFrom = getCardReportFromSession();
    const itemHtml = groups.map(({ attempts }) => {
        const first = attempts[0] || {};
        const cardId = Number(first?.card_id);
        const outcome = classifyDrillCardOutcome(attempts);
        const linkAttempt = pickDrillLinkAttempt(attempts, outcome);
        const linkResultId = Number(linkAttempt?.result_id);
        const label = getAnswerPrimaryLabel(first) || '(blank)';
        const reportHref = Number.isFinite(cardId) && reportFrom
            ? buildCardReportHref(cardId, reportFrom, Number.isFinite(linkResultId) ? linkResultId : null)
            : '';
        const tag = reportHref ? 'a' : 'span';
        const hrefAttr = reportHref ? ` href="${reportHref}"` : '';
        const titleAttr = reportHref ? ` title="${escapeHtml(`Open records for ${label}`)}"` : '';
        return `
            <${tag} class="drill-card-pill outcome-${outcome}"${hrefAttr}${titleAttr}>
                ${renderMathHtml(label)}
                <span class="drill-card-attempt-badge" aria-label="${attempts.length} attempt${attempts.length === 1 ? '' : 's'}">${attempts.length}</span>
            </${tag}>
        `;
    }).join('');
    container.innerHTML = `<div class="answer-grid compact">${itemHtml}</div>`;
}

function formatDrillCellLabel(attempt) {
    const cls = getDrillAttemptDisplayClass(attempt);
    if (cls === 'wrong') return 'Wrong';
    if (cls === 'fixed') return 'Fixed';
    const ms = Math.max(0, Number(attempt?.response_time_ms) || 0);
    return `${(ms / 1000).toFixed(1)}s`;
}

function getDrillAttemptDisplayClass(attempt) {
    if (isDrillAttemptWrongState(attempt)) return 'wrong';
    if (getDrillAttemptResultClass(attempt) === 'fixed') return 'fixed';
    return classifyDrillAttempt(attempt);
}

function renderDrillProgressTable(answers) {
    if (!drillProgressSection || !drillProgressBody) return;
    const groups = groupAnswersByCard(answers);
    if (groups.length === 0) {
        drillProgressSection.style.display = 'none';
        drillProgressBody.innerHTML = '';
        return;
    }
    drillProgressSection.style.display = '';
    const rows = groups.map(({ attempts }) => {
        const first = attempts[0] || {};
        const label = getAnswerPrimaryLabel(first) || '(blank)';
        const outcome = classifyDrillCardOutcome(attempts);
        const pills = attempts.map((attempt) => {
            const cls = getDrillAttemptDisplayClass(attempt);
            return `<span class="drill-progress-cell cell-${cls}">${escapeHtml(formatDrillCellLabel(attempt))}</span>`;
        }).join('');
        return `
            <div class="drill-progress-row outcome-${outcome}">
                <div class="drill-progress-row-label">${renderMathHtml(label)}</div>
                <div class="drill-progress-row-attempts">${pills}</div>
            </div>
        `;
    }).join('');
    const cutoffMs = currentSessionDrillSpeedTargetMs > 0 ? currentSessionDrillSpeedTargetMs : 3000;
    const cutoffLabel = `Fast cut-off: ${(cutoffMs / 1000).toFixed(1)}s · Passed = 2 fast correct tries with no wrong or fixed tries`;
    drillProgressBody.innerHTML = `<div class="drill-progress-cutoff">${escapeHtml(cutoffLabel)}</div><div class="drill-progress-list">${rows}</div>`;
}

// =====================================================================
// === 4. Speed distribution panel
// =====================================================================
function getResponseTimeCapMs() {
    if (currentSessionBehaviorType === BEHAVIOR_TYPE_I) return 20 * 1000;
    if (currentSessionBehaviorType === BEHAVIOR_TYPE_II) return 2 * 60 * 1000;
    if (currentSessionBehaviorType === BEHAVIOR_TYPE_IV) return 2 * 60 * 1000;
    return Infinity;
}

function renderSpeedDistribution(answers) {
    if (!speedDistributionSection || !speedDistributionBody) return;
    if (currentSessionIsDrill) {
        speedDistributionSection.style.display = 'none';
        speedDistributionBody.innerHTML = '';
        return;
    }
    const list = Array.isArray(answers) ? answers : [];
    const rated = list.filter((item) => Number(item?.response_time_ms) > 0);
    if (rated.length === 0) {
        speedDistributionSection.style.display = 'none';
        speedDistributionBody.innerHTML = '';
        return;
    }
    speedDistributionSection.style.display = '';
    const reportFromValue = getCardReportFromSession();
    const panel = buildHistogramDistribution({
        panelKey: speedDistributionPanelKey,
        selectedBucketIndex: selectedSpeedBucketIndex,
        title: 'Speed Distribution',
        tone: 'speed',
        formatValue: formatSpeedLabel,
        getValue: (item) => Number(item?.response_time_ms) || null,
        getCardCapsuleLabel: (item) => getAnswerPrimaryLabel(item) || '—',
        getCardId: (item) => Number(item?.card_id) || 0,
        getCardHref: (cardId) => buildCardReportHref(cardId, reportFromValue),
        bucketing: {
            snapUnit: 1000,
            minClamp: 0,
            maxClamp: getResponseTimeCapMs(),
            anchorLo: 'dataMin',
            formatRange: (min, max) => `${formatBoundarySeconds(min)}–${formatBoundarySeconds(max)}s`,
        },
        topLists: [
            { title: 'Slowest 5', mode: 'highest', count: 5 },
            { title: 'Fastest 5', mode: 'lowest', count: 5 },
        ],
        cards: rated,
    });
    speedDistributionBody.innerHTML = renderDistributionPanel(panel);
    const chip = speedDistributionBody.querySelector('[data-clear-bucket]');
    if (chip) {
        chip.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            selectedSpeedBucketIndex = null;
            renderSpeedDistribution(currentAnswers);
        });
    }
    speedDistributionBody.querySelectorAll('[data-bucket-index]').forEach((slot) => {
        slot.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            const idx = Number.parseInt(slot.getAttribute('data-bucket-index'), 10);
            if (!Number.isInteger(idx)) return;
            selectedSpeedBucketIndex = (selectedSpeedBucketIndex === idx) ? null : idx;
            renderSpeedDistribution(currentAnswers);
        });
    });
}


// =====================================================================
// === 5. Date/time formatting + practice-mode label
// =====================================================================
function formatStartedDate(raw) {
    const dt = parseUtcTimestamp(raw);
    if (Number.isNaN(dt.getTime())) return '—';
    return dt.toLocaleString(undefined, {
        timeZone: reportTimezone,
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
    });
}

function formatRelativeDay(raw) {
    const dt = parseUtcTimestamp(raw);
    if (Number.isNaN(dt.getTime())) return '';
    const startedKey = formatDateKeyInTimezone(dt, reportTimezone);
    const todayKey = formatDateKeyInTimezone(new Date(), reportTimezone);
    if (!startedKey || !todayKey) return '';
    const diffDays = daysBetweenDateKeys(startedKey, todayKey);
    if (diffDays === 0) return 'Today';
    if (diffDays > 0) return `${diffDays}d ago`;
    return '';
}

function formatDateKeyInTimezone(date, timezone) {
    try {
        const formatter = new Intl.DateTimeFormat('en-CA', {
            timeZone: String(timezone || '') || undefined,
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
        });
        const parts = formatter.formatToParts(date);
        const y = parts.find((p) => p.type === 'year')?.value;
        const m = parts.find((p) => p.type === 'month')?.value;
        const d = parts.find((p) => p.type === 'day')?.value;
        return y && m && d ? `${y}-${m}-${d}` : '';
    } catch (_) {
        return '';
    }
}

function daysBetweenDateKeys(fromKey, toKey) {
    const parse = (key) => {
        const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(key || ''));
        if (!match) return NaN;
        return Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
    };
    const fromMs = parse(fromKey);
    const toMs = parse(toKey);
    if (!Number.isFinite(fromMs) || !Number.isFinite(toMs)) return 0;
    return Math.round((toMs - fromMs) / (24 * 60 * 60 * 1000));
}

function formatPracticeMode(raw) {
    let text = String(raw || '').trim().toLowerCase();
    if (!text || text === 'na') return '';
    let drill = false;
    if (text.endsWith('+drill')) {
        drill = true;
        text = text.slice(0, -'+drill'.length);
    }
    let baseLabel = '';
    if (text === 'self') baseLabel = 'Self';
    else if (text === 'parent') baseLabel = 'Parent';
    else if (text === 'multi') baseLabel = 'Multi';
    else if (text === 'input') baseLabel = 'Input';
    const parts = [];
    if (baseLabel) parts.push(baseLabel);
    if (drill) parts.push('Drill');
    return parts.join(' · ');
}

// =====================================================================
// === 6. Answer list render
// =====================================================================
function getAnswerSortRank(item) {
    const score = Number(item?.correct_score);
    if (score <= -2) {
        return 1;
    }
    if (score === -1) {
        return 0;
    }
    if (score < 0) {
        return 1;
    }
    if (score > 0) {
        return 2;
    }
    return 3;
}

function renderAnswerList(container, cards, options = {}) {
    if (!Array.isArray(cards) || cards.length === 0) {
        container.innerHTML = `<div style="color:#666;font-size:0.86rem;">No cards.</div>`;
        return;
    }

    const typeIII = isTypeIIIReviewSession();
    const compact = !!options.compact;
    const keepSingleGroupOrder = options.keepSingleGroupOrder !== false;
    const reportFrom = getCardReportFromSession();
    const sorted = [...cards].sort((a, b) => {
        if (!keepSingleGroupOrder) {
            const rankDiff = getAnswerSortRank(a) - getAnswerSortRank(b);
            if (rankDiff !== 0) {
                return rankDiff;
            }
        }
        return (Number(b?.response_time_ms) || 0) - (Number(a?.response_time_ms) || 0);
    });
    const maxMs = Math.max(...sorted.map((item) => Math.max(0, Number(item?.response_time_ms) || 0)), 1);
    const itemHtml = sorted.map((item) => {
        const rawMs = Math.max(0, Number(item?.response_time_ms) || 0);
        const resultId = Number(item?.result_id);
        const answerClass = getAnswerBarClassByScore(item?.correct_score);
        const seenCount = getAnswerSeenCount(item);
        const retryCount = Math.max(0, seenCount - 1);
        const usedPromptAudio = didUseType1PromptAudio(item);
        const displayLabel = getAnswerPrimaryLabel(item) || '(blank)';
        const secondaryLabel = getAnswerSecondaryLabel(item);
        const reportHref = Number.isFinite(Number(item?.card_id)) && reportFrom
            ? buildCardReportHref(item.card_id, reportFrom, resultId)
            : '';
        const useCompactLink = compact && !!reportHref;
        const tagName = useCompactLink ? 'a' : 'div';
        const retryLabel = `${retryCount} ${retryCount === 1 ? 'retry' : 'retries'}`;
        const linkTitleBase = secondaryLabel
            ? `Open records for ${displayLabel} • ${secondaryLabel} • ${retryLabel}`
            : `Open records for ${displayLabel} • ${retryLabel}`;
        const linkTitle = usedPromptAudio
            ? `${linkTitleBase} • Read-aloud used`
            : linkTitleBase;
        const promptAudioBadgeHtml = usedPromptAudio ? renderPromptAudioAssistBadge() : '';
        const headerActionsHtml = compact
            ? `
                ${retryCount > 0 ? `
                <span class="answer-compact-seen-badge" aria-hidden="true">
                    <span class="answer-seen-count-badge">${retryCount}</span>
                </span>` : ''}
                ${promptAudioBadgeHtml ? `<span class="answer-compact-audio-badge" aria-hidden="true">${promptAudioBadgeHtml}</span>` : ''}
            `
            : `
                <div class="answer-head-actions">
                    ${promptAudioBadgeHtml}
                    ${typeIII ? renderGradingControls(item) : ''}
                    ${!reportHref ? '' : `<a class="answer-report-btn" href="${reportHref}"><span>Go to History</span>${window.icon ? window.icon('arrow-right', { size: 14, strokeWidth: 2.4 }) : ''}</a>`}
                </div>
            `;
        const typeIIIDetailsHtml = (!compact && typeIII) ? renderTypeIIIAnswerDetails(item) : '';
        const detailBodyHtml = compact
            ? ''
            : `
                ${typeIII ? '' : `
                <div class="answer-bar-track">
                    <div class="answer-bar-fill ${answerClass}" style="width:${Math.max(0, Math.min(100, (rawMs / maxMs) * 100)).toFixed(2)}%"></div>
                </div>`}
                ${typeIII ? '' : `<div class="meta">Card #${safeNum(item?.card_id)} · ${formatResponseTime(rawMs)}</div>`}
            `;
        let audioBlockHtml = '';
        if (item?.audio_url) {
            const audioAttrs = typeIII
                ? ` data-result-id="${Number.isFinite(resultId) ? resultId : ''}" data-response-time-ms="${rawMs}"`
                : '';
            audioBlockHtml = window.AudioHistoryCommon.renderRow({
                item,
                audioExtraAttrs: audioAttrs,
            });
        }
        return `
            <${tagName}
                class="answer-item ${answerClass}${usedPromptAudio ? ' has-audio-assist' : ''}"
                ${useCompactLink ? `href="${reportHref}"` : ''}
                ${useCompactLink ? `title="${escapeHtml(linkTitle)}"` : ''}
                ${Number.isFinite(resultId) ? ` data-result-id="${resultId}"` : ''}
                data-card-id="${safeNum(item?.card_id)}"
                data-response-time-ms="${rawMs}"
            >
                <div class="answer-head-row">
                    <div class="answer-label${currentSessionHasChineseSpecificLogic ? ' chinese-specific' : ''}">${renderMathHtml(displayLabel)}</div>
                    ${headerActionsHtml}
                </div>
                ${compact && !isTypeIVSession() && secondaryLabel ? `<div class="answer-secondary">${escapeHtml(secondaryLabel)}</div>` : ''}
                ${typeIIIDetailsHtml}
                ${detailBodyHtml}
                ${audioBlockHtml}
                ${typeIII ? '' : renderGradingControls(item)}
            </${tagName}>
        `;
    }).join('');
    if (compact) {
        container.innerHTML = `<div class="answer-grid compact">${itemHtml}</div>`;
    } else {
        container.innerHTML = itemHtml;
    }

    if (typeIII && window.LessonReadingDurationBackfill) {
        window.LessonReadingDurationBackfill.attach(container, { kidId });
    }
    window.AudioHistoryCommon.attachPlayers(container);
    syncRenderedResponseTimeBars();
}

function getAnswerBarClassByScore(correctScore) {
    const score = Number(correctScore);
    if (score === 1) {
        return 'right';
    }
    if (score === 2) {
        return 'half';
    }
    if (score <= -2) {
        return 'fixed';
    }
    if (score < 0) {
        return 'wrong';
    }
    return 'pending';
}

function getAnswerSeenCount(itemOrScore) {
    if (itemOrScore && typeof itemOrScore === 'object') {
        const grades = getLoggedSubmittedGrades(itemOrScore);
        if (grades.length > 0) {
            return grades.length;
        }
    }
    const score = Number(
        itemOrScore && typeof itemOrScore === 'object'
            ? itemOrScore.correct_score
            : itemOrScore
    );
    if (!Number.isFinite(score)) {
        return 0;
    }
    const normalized = Math.trunc(score);
    if (normalized <= -2) {
        return Math.abs(normalized);
    }
    if (normalized < 0) {
        return 1 + currentSessionRetryCount;
    }
    return Math.max(1, Math.abs(normalized));
}

// =====================================================================
// === 7. Live duration backfill + active-minutes sync
// =====================================================================
function bindLiveDurationBackfillUpdates() {
    if (liveDurationBackfillBound) {
        return;
    }
    liveDurationBackfillBound = true;
    window.addEventListener('lesson-reading-duration-updated', (event) => {
        const detail = event && event.detail ? event.detail : {};
        const resultId = Number(detail.resultId);
        const responseMs = Math.max(0, Number(detail.responseTimeMs) || 0);
        if (!Number.isFinite(resultId) || resultId <= 0 || responseMs <= 0) {
            return;
        }
        const item = document.querySelector(`.answer-item[data-result-id="${resultId}"]`);
        if (!item) {
            return;
        }
        item.dataset.responseTimeMs = String(responseMs);
        const cardId = safeNum(item.dataset.cardId);
        const meta = item.querySelector('.meta');
        if (meta) {
            meta.textContent = `Card #${cardId} · ${formatResponseTime(responseMs)}`;
        }
        syncRenderedResponseTimeBars();
    });
}

function syncRenderedResponseTimeBars() {
    const items = Array.from(document.querySelectorAll('.answer-item[data-response-time-ms]'));
    if (items.length === 0) {
        updateSummaryActiveTimeFromRenderedAnswers();
        return;
    }
    const maxMs = Math.max(
        ...items.map((node) => Math.max(0, Number(node.dataset.responseTimeMs || 0))),
        1
    );
    items.forEach((node) => {
        const bar = node.querySelector('.answer-bar-fill');
        if (!bar) {
            return;
        }
        const value = Math.max(0, Number(node.dataset.responseTimeMs || 0));
        const pct = Math.max(0, Math.min(100, (value / maxMs) * 100));
        bar.style.width = `${pct.toFixed(2)}%`;
    });
    updateSummaryActiveTimeFromRenderedAnswers();
}

function updateSummaryActiveTimeFromRenderedAnswers() {
    const valueEl = document.getElementById('summaryActiveTimeValue');
    if (!valueEl) {
        return;
    }
    const items = Array.from(document.querySelectorAll('.answer-item[data-response-time-ms]'));
    const totalActiveMs = items.reduce((sum, node) => {
        const value = Math.max(0, Number(node.dataset.responseTimeMs || 0));
        return sum + value;
    }, 0);
    valueEl.textContent = formatActiveMinutes(totalActiveMs);
}

function calculateSessionActiveMs(answers) {
    if (!Array.isArray(answers) || answers.length === 0) {
        return 0;
    }
    return answers.reduce((sum, item) => {
        const value = Math.max(0, Number(item?.response_time_ms) || 0);
        return sum + value;
    }, 0);
}

function formatActiveMinutes(totalMs) {
    const minutes = Math.max(0, Number(totalMs) || 0) / 60000;
    return `${minutes.toFixed(1)} min`;
}

function formatResponseTime(ms) {
    const rawMs = Math.max(0, Number(ms) || 0);
    if (isTypeIIIReviewSession()) {
        const totalSeconds = Math.floor(rawMs / 1000);
        const minutes = Math.floor(totalSeconds / 60);
        const seconds = totalSeconds % 60;
        return `${minutes}:${String(seconds).padStart(2, '0')}`;
    }
    return `${(rawMs / 1000).toFixed(2)}s`;
}

// =====================================================================
// === 8. Grading controls (type-III review-and-resolve)
// =====================================================================
function renderGradingControls(item) {
    if (!isTypeIIIReviewSession()) {
        return '';
    }
    const resultId = Number(item?.result_id);
    if (!Number.isFinite(resultId)) {
        return '';
    }
    const graded = String(item?.grade_status || '').toLowerCase();
    if (graded === 'pass' || graded === 'fail') {
        const clearIcon = window.icon ? window.icon('undo-2', { size: 14, strokeWidth: 2.4 }) : '';
        return `
            <div class="grade-row">
                <button class="grade-btn" data-result-id="${resultId}" data-grade="clear">${clearIcon}<span>Clear grade</span></button>
            </div>
        `;
    }
    const passIcon = window.icon ? window.icon('check', { size: 14, strokeWidth: 2.4 }) : '';
    const failIcon = window.icon ? window.icon('x', { size: 14, strokeWidth: 2.4 }) : '';
    return `
        <div class="grade-row">
            <button class="grade-btn" data-result-id="${resultId}" data-grade="pass">${passIcon}<span>Pass</span></button>
            <button class="grade-btn" data-result-id="${resultId}" data-grade="fail">${failIcon}<span>Fail</span></button>
        </div>
    `;
}

async function saveGrade(resultId, reviewGrade) {
    const response = await fetch(`${API_BASE}/kids/${kidId}/report/sessions/${sessionId}/results/${resultId}/grade`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reviewGrade }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
        throw new Error(payload.error || `HTTP ${response.status}`);
    }
    return payload;
}

document.addEventListener('click', async (event) => {
    const btn = event.target && event.target.closest ? event.target.closest('.grade-btn') : null;
    if (!btn) {
        return;
    }
    const resultId = Number(btn.getAttribute('data-result-id'));
    const reviewGrade = String(btn.getAttribute('data-grade') || '').toLowerCase();
    if (!Number.isFinite(resultId) || (reviewGrade !== 'pass' && reviewGrade !== 'fail' && reviewGrade !== 'clear')) {
        return;
    }

    const buttons = document.querySelectorAll(`.grade-btn[data-result-id="${resultId}"]`);
    buttons.forEach((node) => { node.disabled = true; });
    showError('');
    try {
        const saved = await saveGrade(resultId, reviewGrade);
        const item = btn.closest('.answer-item');
        if (item) {
            const score = Number.isFinite(Number(saved?.correct_score))
                ? Number(saved.correct_score)
                : (saved?.grade_status === 'pass' ? 1 : (saved?.grade_status === 'fail' ? -1 : 0));
            const nextClass = getAnswerBarClassByScore(score);
            const bar = item.querySelector('.answer-bar-fill');
            if (bar) {
                bar.classList.remove('right', 'wrong', 'fixed', 'half', 'pending');
                bar.classList.add(nextClass);
            }
            item.classList.remove('right', 'wrong', 'fixed', 'half', 'pending');
            item.classList.add(nextClass);

            const answerEntry = currentAnswers.find((a) => a.result_id === resultId);
            if (answerEntry) {
                answerEntry.correct_score = score;
                answerEntry.grade_status = saved.grade_status;
            }

            const gradeRow = item.querySelector('.grade-row');
            const replacementHtml = renderGradingControls(answerEntry || { result_id: resultId, grade_status: saved.grade_status });
            if (gradeRow) {
                if (replacementHtml) {
                    gradeRow.outerHTML = replacementHtml;
                } else {
                    gradeRow.remove();
                }
            }

            if (currentSession) {
                renderSummary(currentSession, currentAnswers);
            }
            renderSpeedDistribution(currentAnswers);
        }
    } catch (error) {
        console.error('Error saving grade:', error);
        showError(error.message || 'Failed to save grade.');
    } finally {
        document.querySelectorAll(`.grade-btn[data-result-id="${resultId}"]`).forEach((node) => { node.disabled = false; });
    }
});

// =====================================================================
// === 9. Card report link + answer-label helpers
// =====================================================================
function getCardReportFromSession() {
    if (isTypeIIIReviewSession()) {
        return 'lesson-reading';
    }
    return normalizeBehaviorType(currentSessionBehaviorType) === BEHAVIOR_TYPE_II ? 'type2' : 'cards';
}

function buildCardReportHref(cardId, fromValue, resultId = null) {
    const reportLinkParams = new URLSearchParams();
    reportLinkParams.set('id', String(kidId || ''));
    reportLinkParams.set('cardId', String(cardId || ''));
    reportLinkParams.set('from', String(fromValue || ''));
    if (currentSessionType) {
        reportLinkParams.set('categoryKey', String(currentSessionType));
    }
    if (Number.isFinite(Number(resultId))) {
        reportLinkParams.set('resultId', String(resultId));
    }
    const hash = Number.isFinite(Number(resultId)) ? `#result-${Number(resultId)}` : '';
    return `/kid-card-report.html?${reportLinkParams.toString()}${hash}`;
}

function getAnswerPrimaryLabel(item) {
    if (isTypeIVSession()) {
        return String(item?.materialized_prompt || item?.front || item?.back || '').trim();
    }
    return String(item?.front || item?.back || '').trim();
}

function getAnswerSecondaryLabel(item) {
    if (!isTypeIVSession()) {
        return '';
    }
    const expectedAnswer = getType4ExpectedAnswer(item);
    const submittedAnswers = getType4SubmittedAnswers(item);
    if (submittedAnswers.length === 0) {
        return expectedAnswer ? `Right: ${expectedAnswer}` : '';
    }
    const triedText = submittedAnswers.join(' | ');
    if (!expectedAnswer) {
        return `Tried: ${triedText}`;
    }
    return `Right: ${expectedAnswer} | Tried: ${triedText}`;
}

function getType4ExpectedAnswer(item) {
    return String(item?.materialized_answer || item?.back || '').trim();
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
    return grade === 3 || grade === -3 || grade === -7;
}

function didUseType1PromptAudio(item) {
    return !isTypeIVSession() && getLoggedSubmittedGrades(item).some(isType1PromptAudioGrade);
}

function renderPromptAudioAssistBadge() {
    return `
        <span class="answer-audio-assist-badge" title="Read-aloud used" aria-label="Read-aloud used">
            <svg width="11" height="11" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                <path d="M3.5 7.75h3.7l3.8-3.05a.75.75 0 0 1 1.22.58v9.44a.75.75 0 0 1-1.22.58L7.2 12.25H3.5A1.5 1.5 0 0 1 2 10.75v-1.5a1.5 1.5 0 0 1 1.5-1.5Z"></path>
                <path d="M14.15 7.45a.75.75 0 0 1 1.06.07A3.8 3.8 0 0 1 16.1 10a3.8 3.8 0 0 1-.89 2.48.75.75 0 0 1-1.13-.99A2.3 2.3 0 0 0 14.6 10c0-.56-.19-1.08-.52-1.49a.75.75 0 0 1 .07-1.06Z"></path>
            </svg>
        </span>
    `;
}

function getType4SubmittedAnswers(item) {
    return getLoggedSubmittedAnswers(item);
}

function renderTypeIIIAnswerDetails(item) {
    if (!isTypeIIIReviewSession()) {
        return '';
    }
    const back = String(item?.back || '').trim();
    let sourceDeck = String(item?.source_deck_label || item?.source_deck_name || '').trim();
    if (currentSessionType && sourceDeck.toLowerCase().startsWith(`${currentSessionType.toLowerCase()}_`)) {
        sourceDeck = sourceDeck.slice(currentSessionType.length + 1);
    }
    const detailBits = [];
    if (back) {
        detailBits.push(`<span class="answer-type3-back">${escapeHtml(back)}</span>`);
    }
    if (sourceDeck) {
        detailBits.push(`<span class="answer-type3-source">Source: ${escapeHtml(sourceDeck)}</span>`);
    }
    return detailBits.length
        ? `<div class="answer-type3-details">${detailBits.join('<span class="answer-type3-sep" aria-hidden="true">·</span>')}</div>`
        : '';
}

function isTypeIIIReviewSession() {
    return normalizeBehaviorType(currentSessionBehaviorType) === BEHAVIOR_TYPE_III;
}

function isTypeIVSession() {
    return normalizeBehaviorType(currentSessionBehaviorType) === BEHAVIOR_TYPE_IV;
}

// =====================================================================
// === 10. Misc helpers (timestamps, error display)
// =====================================================================
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
