const API_BASE = `${window.location.origin}/api`;

const params = new URLSearchParams(window.location.search);
const kidId = params.get('id');
const sessionId = params.get('sessionId');
const from = String(params.get('from') || '').trim().toLowerCase();

const pageTitle = document.getElementById('pageTitle');
const backBtn = document.getElementById('backBtn');
const errorMessage = document.getElementById('errorMessage');
const summaryGrid = document.getElementById('summaryGrid');
const wrongSection = document.getElementById('wrongSection');
const rightSection = document.getElementById('rightSection');
const rightSectionTitle = document.getElementById('rightSectionTitle');
const wrongList = document.getElementById('wrongList');
const rightList = document.getElementById('rightList');
const rtChartSection = document.getElementById('rtChartSection');
const rtChartBody = document.getElementById('rtChartBody');
const rtChartLegend = document.getElementById('rtChartLegend');
const {
    normalizeCategoryKey,
    normalizeBehaviorType,
} = window.DeckCategoryCommon;
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
        renderSummary(session, answers);
        renderAnswerSections(answers);
    } catch (error) {
        console.error('Error loading session detail:', error);
        showError('Failed to load session detail.');
        document.title = 'Session Detail - Kids Daily Chores';
    }
}

function renderSummary(session, answers) {
    const totalActiveMs = calculateSessionActiveMs(answers);
    summaryGrid.innerHTML = `
        <div class="summary-card"><div class="label">Type</div><div class="value">${currentSessionCategoryDisplayName}</div></div>
        <div class="summary-card"><div class="label">Started</div><div class="value">${formatDateTime(session.started_at)}</div></div>
        <div class="summary-card"><div class="label">Answered</div><div class="value">${safeNum(session.answer_count)}</div></div>
        <div class="summary-card"><div class="label">Active Time</div><div class="value" id="summaryActiveTimeValue">${formatActiveMinutes(totalActiveMs)}</div></div>
    `;
}

function renderAnswerSections(answers) {
    if (isTypeIIIReviewSession()) {
        wrongSection.style.display = 'none';
        rightSection.style.display = '';
        rightSectionTitle.textContent = 'Cards';
        renderAnswerList(rightList, answers, { compact: false, keepSingleGroupOrder: false });
        renderResponseTimeChart(answers);
        return;
    }
    wrongSection.style.display = 'none';
    rightSection.style.display = '';
    rightSectionTitle.textContent = 'Cards';
    renderAnswerList(rightList, answers, { compact: true, keepSingleGroupOrder: false });
    renderResponseTimeChart(answers);
}

function renderResponseTimeChart(answers) {
    if (!rtChartSection || !rtChartBody) return;
    if (!Array.isArray(answers) || answers.length === 0) {
        rtChartSection.style.display = 'none';
        return;
    }

    const sorted = [...answers]
        .filter((item) => (Number(item?.response_time_ms) || 0) > 0)
        .sort((a, b) => (Number(b?.response_time_ms) || 0) - (Number(a?.response_time_ms) || 0));

    if (sorted.length === 0) {
        rtChartSection.style.display = 'none';
        return;
    }

    rtChartSection.style.display = '';
    const maxMs = Math.max(Number(sorted[0]?.response_time_ms) || 1, 1);

    const legendClasses = new Set(sorted.map((item) => getAnswerBarClassByScore(item?.correct_score)));
    const legendParts = [];
    if (legendClasses.has('right')) legendParts.push('<span class="legend-dot right"></span> Right');
    if (legendClasses.has('half')) legendParts.push('<span class="legend-dot half"></span> Half');
    if (legendClasses.has('fixed')) legendParts.push('<span class="legend-dot fixed"></span> Fixed');
    if (legendClasses.has('wrong')) legendParts.push('<span class="legend-dot wrong"></span> Wrong');
    if (legendClasses.has('pending')) legendParts.push('<span class="legend-dot pending"></span> Ungraded');
    rtChartLegend.innerHTML = legendParts.join('<span class="legend-sep">·</span>');

    rtChartBody.innerHTML = sorted.map((item) => {
        const rawMs = Math.max(0, Number(item?.response_time_ms) || 0);
        const pct = Math.max(1, (rawMs / maxMs) * 100).toFixed(1);
        const answerClass = getAnswerBarClassByScore(item?.correct_score);
        const label = getAnswerPrimaryLabel(item) || '?';
        const chineseClass = currentSessionHasChineseSpecificLogic ? ' chinese-specific' : '';
        return `<div class="rt-chart-bar-row">
            <div class="rt-chart-label${chineseClass}" title="${escapeHtml(label)}">${escapeHtml(label)}</div>
            <div class="rt-chart-track"><div class="rt-chart-fill ${answerClass}" style="width:${pct}%"></div></div>
            <div class="rt-chart-time">${formatResponseTime(rawMs)}</div>
        </div>`;
    }).join('');
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
        const displayLabel = getAnswerPrimaryLabel(item) || '(blank)';
        const secondaryLabel = getAnswerSecondaryLabel(item);
        const reportHref = Number.isFinite(Number(item?.card_id)) && reportFrom
            ? buildCardReportHref(item.card_id, reportFrom, resultId)
            : '';
        const useCompactLink = compact && !!reportHref;
        const tagName = useCompactLink ? 'a' : 'div';
        const linkTitle = secondaryLabel
            ? `Open records for ${displayLabel} • ${secondaryLabel} • Seen ${seenCount} time${seenCount === 1 ? '' : 's'}`
            : `Open records for ${displayLabel} • Seen ${seenCount} time${seenCount === 1 ? '' : 's'}`;
        const headerActionsHtml = compact
            ? `${compact ? `<span class="answer-seen-count-badge" aria-hidden="true">${seenCount}</span>` : ''}`
            : `
                <div class="answer-head-actions">
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
                class="answer-item ${answerClass}"
                ${useCompactLink ? `href="${reportHref}"` : ''}
                ${useCompactLink ? `title="${escapeHtml(linkTitle)}"` : ''}
                ${Number.isFinite(resultId) ? ` data-result-id="${resultId}"` : ''}
                data-card-id="${safeNum(item?.card_id)}"
                data-response-time-ms="${rawMs}"
            >
                <div class="answer-head-row">
                    <div class="answer-label${currentSessionHasChineseSpecificLogic ? ' chinese-specific' : ''}">${escapeHtml(displayLabel)}</div>
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
        const legendParts = [];
        const classes = sorted.map((item) => getAnswerBarClassByScore(item?.correct_score));
        if (classes.includes('right')) legendParts.push('<span class="legend-dot right"></span> Right');
        if (classes.includes('half')) legendParts.push('<span class="legend-dot half"></span> Half');
        if (classes.includes('fixed')) legendParts.push('<span class="legend-dot fixed"></span> Fixed');
        if (classes.includes('wrong')) legendParts.push('<span class="legend-dot wrong"></span> Wrong');
        if (classes.includes('pending')) legendParts.push('<span class="legend-dot pending"></span> Ungraded');
        const legendHtml = legendParts.length > 0
            ? `<div class="card-color-legend">${legendParts.join('<span class="legend-sep">·</span>')}</div>`
            : '';
        container.innerHTML = `${legendHtml}<div class="answer-grid compact">${itemHtml}</div>`;
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
        const submittedAnswers = getType4SubmittedAnswers(itemOrScore);
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
            if (bar) {
                const score = Number.isFinite(Number(saved?.correct_score))
                    ? Number(saved.correct_score)
                    : (saved?.grade_status === 'pass' ? 1 : (saved?.grade_status === 'fail' ? -1 : 0));
                const nextClass = getAnswerBarClassByScore(score);
                bar.classList.remove('right', 'wrong', 'fixed', 'half', 'pending');
                bar.classList.add(nextClass);
            }
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

function getType4SubmittedAnswers(item) {
    return Array.isArray(item?.submitted_answers)
        ? item.submitted_answers
            .map((value) => String(value || '').trim())
            .filter(Boolean)
        : [];
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
