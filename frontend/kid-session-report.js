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
const wrongList = document.getElementById('wrongList');
const rightList = document.getElementById('rightList');
const speedDistributionSection = document.getElementById('speedDistributionSection');
const speedDistributionBody = document.getElementById('speedDistributionBody');
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
let reportTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
let currentSessionType = '';
let currentSessionBehaviorType = '';
let currentSessionCategoryDisplayName = '';
let currentSessionHasChineseSpecificLogic = false;
let currentSessionRetryCount = 0;
let liveDurationBackfillBound = false;
let currentAnswers = [];

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

async function loadSessionDetail() {
    try {
        showError('');
        const response = await fetch(`${API_BASE}/kids/${kidId}/report/sessions/${sessionId}`);
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }

        const data = await response.json();
        const kidName = data.kid?.name || 'Kid';
        const session = data.session || {};
        currentSessionType = normalizeCategoryKey(session.type);
        currentSessionBehaviorType = normalizeBehaviorType(session.behavior_type);
        currentSessionCategoryDisplayName = String(session.category_display_name || '').trim();
        currentSessionHasChineseSpecificLogic = Boolean(session.has_chinese_specific_logic);
        currentSessionRetryCount = Math.max(0, Number.parseInt(session.retry_count, 10) || 0);
        pageTitle.textContent = `${kidName} · Session #${session.id || sessionId}`;
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
    const counts = countAnswersByOutcome(answers);
    const modeLabel = formatPracticeMode(session?.practice_mode) || currentSessionCategoryDisplayName || '—';
    const iconStarted = '<svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect width="18" height="18" x="3" y="4" rx="2" ry="2"/><line x1="16" x2="16" y1="2" y2="6"/><line x1="8" x2="8" y1="2" y2="6"/><line x1="3" x2="21" y1="10" y2="10"/></svg>';
    const iconAnswered = '<svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m3 17 2 2 4-4"/><path d="m3 7 2 2 4-4"/><path d="M13 6h8"/><path d="M13 12h8"/><path d="M13 18h8"/></svg>';
    const iconMode = '<svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/></svg>';
    const iconActiveTime = '<svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="10" x2="14" y1="2" y2="2"/><line x1="12" x2="15" y1="14" y2="11"/><circle cx="12" cy="14" r="8"/></svg>';
    summaryCard.innerHTML = `
        <div class="session-summary-stats">
            <div class="session-summary-stat">
                <div class="stat-icon">${iconStarted}</div>
                <div class="session-summary-stat-body">
                    <div class="label">Started</div>
                    <div class="value">${escapeHtml(startedDate)}${relativeDay ? `<span class="value-meta">${escapeHtml(relativeDay)}</span>` : ''}</div>
                </div>
            </div>
            <div class="session-summary-stat">
                <div class="stat-icon">${iconAnswered}</div>
                <div class="session-summary-stat-body">
                    <div class="label">Answered</div>
                    <div class="value">${safeNum(session?.answer_count)}</div>
                </div>
            </div>
            <div class="session-summary-stat">
                <div class="stat-icon">${iconMode}</div>
                <div class="session-summary-stat-body">
                    <div class="label">Mode</div>
                    <div class="value">${escapeHtml(modeLabel)}</div>
                </div>
            </div>
            <div class="session-summary-stat">
                <div class="stat-icon">${iconActiveTime}</div>
                <div class="session-summary-stat-body">
                    <div class="label">Active Time</div>
                    <div class="value" id="summaryActiveTimeValue">${escapeHtml(formatActiveMinutes(totalActiveMs))}</div>
                </div>
            </div>
        </div>
        <div class="session-summary-counters">
            <span class="session-summary-counter right"><svg viewBox="0 0 24 24" fill="none" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/></svg> Right <strong>${counts.right}</strong></span>
            <span class="session-summary-counter fixed"><svg viewBox="0 0 24 24" fill="none" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"/><path d="m15 5 4 4"/></svg> Fixed <strong>${counts.fixed}</strong></span>
            <span class="session-summary-counter wrong"><svg viewBox="0 0 24 24" fill="none" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="m15 9-6 6"/><path d="m9 9 6 6"/></svg> Wrong <strong>${counts.wrong}</strong></span>
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
    rightSectionTitle.textContent = 'Cards Practiced';
    const compact = !isTypeIIIReviewSession();
    renderAnswerList(rightList, answers, { compact, keepSingleGroupOrder: false });
}

function renderSpeedDistribution(answers) {
    if (!speedDistributionSection || !speedDistributionBody) return;
    const list = Array.isArray(answers) ? answers : [];
    const rated = list.filter((item) => Number(item?.response_time_ms) > 0);
    if (rated.length === 0) {
        speedDistributionSection.style.display = 'none';
        speedDistributionBody.innerHTML = '';
        return;
    }
    speedDistributionSection.style.display = '';
    const panel = buildHistogramDistribution({
        panelKey: speedDistributionPanelKey,
        selectedBucketIndex: selectedSpeedBucketIndex,
        title: 'Speed Distribution',
        tone: 'speed',
        formatValue: formatSpeedLabel,
        getValue: (item) => Number(item?.response_time_ms) || null,
        getCardCapsuleLabel: (item) => getAnswerPrimaryLabel(item) || '—',
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
        cards: rated,
    });
    speedDistributionBody.innerHTML = renderDistributionPanel(panel);
}

function handleSpeedBucketActivate(target) {
    if (!target || !target.closest) return;
    const clearBtn = target.closest('[data-clear-bucket]');
    if (clearBtn && clearBtn.getAttribute('data-clear-bucket') === speedDistributionPanelKey) {
        selectedSpeedBucketIndex = null;
        renderSpeedDistribution(currentAnswers);
        return;
    }
    const slot = target.closest('[data-bucket-index]');
    if (!slot) return;
    if ((slot.getAttribute('data-panel-key') || '') !== speedDistributionPanelKey) return;
    const idx = Number.parseInt(slot.getAttribute('data-bucket-index'), 10);
    if (!Number.isInteger(idx)) return;
    selectedSpeedBucketIndex = (selectedSpeedBucketIndex === idx) ? null : idx;
    renderSpeedDistribution(currentAnswers);
}

document.addEventListener('click', (event) => {
    if (!speedDistributionSection || !speedDistributionSection.contains(event.target)) return;
    handleSpeedBucketActivate(event.target);
});

document.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    if (!speedDistributionSection || !speedDistributionSection.contains(event.target)) return;
    const slot = event.target.closest && event.target.closest('[data-bucket-index]');
    if (!slot) return;
    event.preventDefault();
    handleSpeedBucketActivate(slot);
});

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
    if (diffDays === 1) return 'Yesterday';
    if (diffDays > 0) return `${diffDays}d`;
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
        const usedPromptAudio = didUseType1PromptAudio(item);
        const displayLabel = getAnswerPrimaryLabel(item) || '(blank)';
        const secondaryLabel = getAnswerSecondaryLabel(item);
        const reportHref = Number.isFinite(Number(item?.card_id)) && reportFrom
            ? buildCardReportHref(item.card_id, reportFrom, resultId)
            : '';
        const useCompactLink = compact && !!reportHref;
        const tagName = useCompactLink ? 'a' : 'div';
        const linkTitleBase = secondaryLabel
            ? `Open records for ${displayLabel} • ${secondaryLabel} • Seen ${seenCount} time${seenCount === 1 ? '' : 's'}`
            : `Open records for ${displayLabel} • Seen ${seenCount} time${seenCount === 1 ? '' : 's'}`;
        const linkTitle = usedPromptAudio
            ? `${linkTitleBase} • Read-aloud used`
            : linkTitleBase;
        const promptAudioBadgeHtml = usedPromptAudio ? renderPromptAudioAssistBadge() : '';
        const headerActionsHtml = compact
            ? `
                <span class="answer-compact-seen-badge" aria-hidden="true">
                    <span class="answer-seen-count-badge">${seenCount}</span>
                </span>
                ${promptAudioBadgeHtml ? `<span class="answer-compact-audio-badge" aria-hidden="true">${promptAudioBadgeHtml}</span>` : ''}
            `
            : `
                <div class="answer-head-actions">
                    ${promptAudioBadgeHtml}
                    ${typeIII ? renderGradingControls(item) : ''}
                    ${!reportHref ? '' : `<a class="tab-link secondary mini-link-btn answer-report-link" href="${reportHref}">Records</a>`}
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
                ${item?.audio_url ? `<audio class="attempt-audio js-simple-audio" preload="metadata" src="${escapeHtml(item.audio_url)}"${typeIII ? ` data-result-id="${Number.isFinite(resultId) ? resultId : ''}" data-response-time-ms="${rawMs}"` : ''}></audio>` : ''}
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
    if (window.SimpleAudioPlayer) {
        window.SimpleAudioPlayer.attach(container, {
            selector: 'audio.js-simple-audio',
            playLabel: '<svg width="16" height="16" viewBox="0 0 20 20" fill="currentColor"><polygon points="4,2 18,10 4,18"/></svg>',
            pauseLabel: '<svg width="16" height="16" viewBox="0 0 20 20" fill="currentColor"><rect x="4" y="3" width="4.5" height="14" rx="1"/><rect x="11.5" y="3" width="4.5" height="14" rx="1"/></svg>',
        });
    }
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
        const submittedAnswers = getLoggedSubmittedAnswers(itemOrScore);
        if (submittedAnswers.length > 0) {
            return submittedAnswers.length;
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

function renderGradeStatusHtml(grade) {
    const normalized = String(grade || '').toLowerCase();
    if (normalized !== 'pass' && normalized !== 'fail') {
        return '';
    }
    return `<div class="grade-status ${normalized}">Status: ${normalized === 'pass' ? 'Pass' : 'Fail'}</div>`;
}

function renderGradingControls(item) {
    if (!isTypeIIIReviewSession()) {
        return '';
    }
    const resultId = Number(item?.result_id);
    if (!Number.isFinite(resultId)) {
        return '';
    }
    return renderGradeStatusHtml(item?.grade_status) || `
        <div class="grade-row">
            <button class="grade-btn" data-result-id="${resultId}" data-grade="pass">Pass</button>
            <button class="grade-btn" data-result-id="${resultId}" data-grade="fail">Fail</button>
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
    if (!Number.isFinite(resultId) || (reviewGrade !== 'pass' && reviewGrade !== 'fail')) {
        return;
    }

    const buttons = document.querySelectorAll(`.grade-btn[data-result-id="${resultId}"]`);
    buttons.forEach((node) => { node.disabled = true; });
    showError('');
    try {
        const saved = await saveGrade(resultId, reviewGrade);
        buttons.forEach((node) => {
            const nodeGrade = String(node.getAttribute('data-grade') || '').toLowerCase();
            node.classList.toggle('active-pass', nodeGrade === 'pass' && saved.grade_status === 'pass');
            node.classList.toggle('active-fail', nodeGrade === 'fail' && saved.grade_status === 'fail');
        });

        const item = btn.closest('.answer-item');
        if (item) {
            const gradeRow = item.querySelector('.grade-row');
            const replacement = renderGradeStatusHtml(saved.grade_status);
            if (gradeRow && replacement) {
                gradeRow.outerHTML = replacement;
            } else if (replacement) {
                item.insertAdjacentHTML('beforeend', replacement);
            }
            const bar = item.querySelector('.answer-bar-fill');
            const score = Number.isFinite(Number(saved?.correct_score))
                ? Number(saved.correct_score)
                : (saved?.grade_status === 'pass' ? 1 : (saved?.grade_status === 'fail' ? -1 : 0));
            if (bar) {
                const nextClass = getAnswerBarClassByScore(score);
                bar.classList.remove('right', 'wrong', 'fixed', 'half', 'pending');
                bar.classList.add(nextClass);
            }

            const answerEntry = currentAnswers.find((a) => a.result_id === resultId);
            if (answerEntry) {
                answerEntry.correct_score = score;
                answerEntry.grade_status = saved.grade_status;
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
        buttons.forEach((node) => { node.disabled = false; });
    }
});

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
    const primary = normalizeBehaviorType(currentSessionBehaviorType) === BEHAVIOR_TYPE_II
        ? item?.back
        : item?.front;
    return String(primary || item?.front || item?.back || '').trim();
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
    return grade === 3 || grade === -3;
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
    const sourceDeck = String(item?.source_deck_label || item?.source_deck_name || '').trim();
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
