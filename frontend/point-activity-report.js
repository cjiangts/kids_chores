const API_BASE = `${window.location.origin}/api`;
const POINT_ACTIVITY_HISTORY_LIMIT = 5000;

const params = new URLSearchParams(window.location.search);
const requestedRuleId = String(params.get('ruleId') || '').trim();
const pointActivityHero = document.getElementById('pointActivityHero');
const pointActivityCalendar = document.getElementById('pointActivityCalendar');
const pointActivityProgressPanel = document.getElementById('pointActivityProgressPanel');
const pointActivityProgress = document.getElementById('pointActivityProgress');
const pointActivityLogPanel = document.getElementById('pointActivityLogPanel');
const pointActivityLog = document.getElementById('pointActivityLog');
const pointActivityError = document.getElementById('pointActivityError');
const pageTitle = document.getElementById('pageTitle');

let kids = [];
let pointDataByKid = new Map();
let reportDataByKid = new Map();
let progressDataByKid = new Map();
let selectedKidId = '';
let currentRule = null;
let displayedMonthKey = '';
let selectedCalendarDayKey = '';
let activityLogQuery = '';
let currentProgressViewDays = 0;
let currentProgressMetric = (() => {
    try {
        return localStorage.getItem('pointActivityReport.progressMetric') === 'correctness' ? 'correctness' : 'speed';
    } catch (_err) {
        return 'speed';
    }
})();

function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (char) => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
    }[char]));
}

function showError(text) {
    if (!pointActivityError) return;
    pointActivityError.textContent = text || '';
    pointActivityError.classList.toggle('hidden', !text);
}

async function fetchJson(url) {
    const response = await fetch(url, { headers: { 'Content-Type': 'application/json' } });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`);
    return data;
}

function colorForKid(kid) {
    return '#6b5cf6';
}

function formatPoints(value) {
    const number = Number.parseInt(value, 10) || 0;
    return `${number.toLocaleString()} pts`;
}

function formatSignedPoints(value) {
    const number = Number.parseInt(value, 10) || 0;
    return `${number > 0 ? '+' : ''}${number.toLocaleString()} pts`;
}

function parseDate(value) {
    const text = String(value || '').trim();
    return text ? new Date(/(?:z|[+-]\d{2}:?\d{2})$/i.test(text) ? text : `${text}Z`) : new Date(Number.NaN);
}

function familyTimezone() {
    return String(kids.find((kid) => kid.familyTimezone)?.familyTimezone || '').trim();
}

function dayKey(date, timezone) {
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '';
    const timezoneName = String(timezone || '').trim();
    if (!timezoneName) return '';
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: timezoneName,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    }).formatToParts(date);
    const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    return map.year && map.month && map.day ? `${map.year}-${map.month}-${map.day}` : '';
}

function dateFromDayKey(key) {
    const [year, month, day] = String(key || '').split('-').map((part) => Number.parseInt(part, 10));
    return year && month && day ? new Date(Date.UTC(year, month - 1, day)) : null;
}

function monthKeyFromDate(date, timezone) {
    const key = dayKey(date, timezone);
    return key ? key.slice(0, 7) : '';
}

function monthDateFromKey(key) {
    const [year, month] = String(key || '').split('-').map((part) => Number.parseInt(part, 10));
    return year && month ? new Date(Date.UTC(year, month - 1, 1, 12, 0, 0)) : null;
}

function addMonths(key, offset) {
    const date = monthDateFromKey(key);
    if (!date) return '';
    date.setUTCMonth(date.getUTCMonth() + (Number.parseInt(offset, 10) || 0));
    return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

function monthLabel(key) {
    const date = monthDateFromKey(key);
    return date ? date.toLocaleDateString([], { timeZone: 'UTC', month: 'long', year: 'numeric' }) : '';
}

function daysInMonth(key) {
    const date = monthDateFromKey(key);
    if (!date) return 0;
    return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
}

function weekdayIndexMondayFirst(date) {
    return (date.getUTCDay() + 6) % 7;
}

function daysBetweenDayKeys(fromKey, toKey) {
    const from = dateFromDayKey(fromKey);
    const to = dateFromDayKey(toKey);
    if (!from || !to) return 0;
    return Math.max(0, Math.round((to.getTime() - from.getTime()) / 86400000));
}

function isSameRule(event) {
    if (!requestedRuleId) return false;
    return String(event?.rule?.ruleId || event?.ruleId || '') === requestedRuleId;
}

function allActivityEvents() {
    return kids.flatMap((kid) => {
        const data = pointDataByKid.get(String(kid.id)) || {};
        const events = Array.isArray(data.events) ? data.events : [];
        return events.filter(isSameRule).map((event) => ({ ...event, kid }));
    });
}

function visibleEvents() {
    const events = allActivityEvents();
    return selectedKidId
        ? events.filter((event) => String(event?.kid?.id || '') === selectedKidId)
        : events;
}

function newestEvent(events) {
    return [...events].sort((a, b) => parseDate(b?.createdAt).getTime() - parseDate(a?.createdAt).getTime())[0] || null;
}

function ensureDisplayedMonth() {
    if (displayedMonthKey) return;
    const timezone = familyTimezone();
    const latest = newestEvent(visibleEvents());
    const latestDate = parseDate(latest?.createdAt);
    displayedMonthKey = !Number.isNaN(latestDate.getTime())
        ? monthKeyFromDate(latestDate, timezone)
        : monthKeyFromDate(new Date(), timezone);
}

function latestLabel(events) {
    const latest = newestEvent(events);
    const timezone = familyTimezone();
    const date = parseDate(latest?.createdAt);
    if (!latest || Number.isNaN(date.getTime()) || !timezone) return 'None';
    const today = dayKey(new Date(), timezone);
    const latestDay = dayKey(date, timezone);
    if (today && latestDay === today) return 'Today';
    const daysAgo = daysBetweenDayKeys(latestDay, today);
    if (daysAgo === 1) return 'Yesterday';
    if (daysAgo > 1) return `${daysAgo} days ago`;
    return 'Recently';
}

function shortDateLabel(dayKeyValue) {
    const date = dateFromDayKey(dayKeyValue);
    return date ? date.toLocaleDateString([], { timeZone: 'UTC', month: 'short', day: 'numeric' }) : '';
}

function timeLabel(value) {
    const timezone = familyTimezone();
    const date = parseDate(value);
    if (Number.isNaN(date.getTime()) || !timezone) return '';
    return date.toLocaleTimeString([], {
        timeZone: timezone,
        hour: 'numeric',
        minute: '2-digit',
    });
}

function logDateLabel(value) {
    const timezone = familyTimezone();
    const date = parseDate(value);
    if (Number.isNaN(date.getTime()) || !timezone) return '';
    return date.toLocaleDateString([], {
        timeZone: timezone,
        month: 'short',
        day: 'numeric',
    });
}

function activeDayCount(events) {
    const timezone = familyTimezone();
    if (!timezone) return 0;
    return new Set(events.map((event) => dayKey(parseDate(event?.createdAt), timezone)).filter(Boolean)).size;
}

function pointTotal(events) {
    return events.reduce((sum, event) => sum + (Number.parseInt(event?.pointsDelta, 10) || 0), 0);
}

function normalizeCategoryKey(value) {
    if (window.DeckCategoryCommon?.normalizeCategoryKey) {
        return window.DeckCategoryCommon.normalizeCategoryKey(value);
    }
    return String(value || '').trim().toLowerCase();
}

function ruleTriggerKey() {
    return normalizeCategoryKey(currentRule?.triggerKey);
}

function isSessionsMetricView() {
    return isInAppChore();
}

function sessionsForKid(kidId) {
    const data = reportDataByKid.get(String(kidId)) || {};
    const triggerKey = ruleTriggerKey();
    const sessions = Array.isArray(data.sessions) ? data.sessions : [];
    if (!triggerKey) return sessions;
    return sessions.filter((session) => normalizeCategoryKey(session?.type) === triggerKey);
}

function sessionTotalsForKid(kidId) {
    const summarize = window.KidReportCommon?.summarizeSessions;
    const sessions = sessionsForKid(kidId);
    if (typeof summarize === 'function') return summarize(sessions);
    return {
        count: sessions.length,
        activeMinutes: sessions.reduce((sum, session) => {
            const responseMs = Number(session?.total_response_ms);
            const retryMs = Number(session?.retry_total_response_ms);
            return sum
                + (Number.isFinite(responseMs) ? Math.max(0, responseMs / 60000) : 0)
                + (Number.isFinite(retryMs) ? Math.max(0, retryMs / 60000) : 0);
        }, 0),
    };
}

function sessionCardTotalForKid(kidId) {
    return sessionsForKid(kidId).reduce((sum, session) => sum + sessionCardCount(session), 0);
}

function sessionActiveMinutes(session) {
    const responseMs = Number(session?.total_response_ms);
    const retryMs = Number(session?.retry_total_response_ms);
    return (Number.isFinite(responseMs) ? Math.max(0, responseMs / 60000) : 0)
        + (Number.isFinite(retryMs) ? Math.max(0, retryMs / 60000) : 0);
}

function visibleSessions() {
    const selectedIds = selectedKidId
        ? [selectedKidId]
        : kids.map((kid) => String(kid.id));
    return selectedIds.flatMap((kidId) => {
        const kid = kids.find((item) => String(item.id) === String(kidId)) || {};
        return sessionsForKid(kidId).map((session) => ({
            ...session,
            kid,
            kidId: String(kidId),
        }));
    });
}

function formatActiveMinutes(value) {
    const minutes = Number(value);
    if (!Number.isFinite(minutes)) return '0 min';
    return `${minutes.toFixed(1)} min`;
}

function formatCalendarMinutes(value) {
    const minutes = Number(value);
    if (!Number.isFinite(minutes) || minutes <= 0) return '0m';
    if (minutes >= 10 || Math.abs(minutes - Math.round(minutes)) < 0.05) {
        return `${Math.round(minutes).toLocaleString()}m`;
    }
    return `${minutes.toFixed(1)}m`;
}

function formatSessionCount(value) {
    const count = Number.parseInt(value, 10) || 0;
    return `${count.toLocaleString()} ${count === 1 ? 'session' : 'sessions'}`;
}

function formatSessionCardMeta(sessionCount, cardCount) {
    const sessionsText = formatSessionCount(sessionCount);
    const cards = Number.parseInt(cardCount, 10) || 0;
    return `${sessionsText}  ${cards.toLocaleString()} ${cards === 1 ? 'card' : 'cards'}`;
}

function sessionCardCount(session) {
    const answerCount = Number.parseInt(session?.answer_count, 10);
    if (Number.isFinite(answerCount) && answerCount > 0) return answerCount;
    const plannedCount = Number.parseInt(session?.planned_count, 10);
    if (Number.isFinite(plannedCount) && plannedCount > 0) return plannedCount;
    const practicedCardIds = Array.isArray(session?.practiced_card_ids) ? session.practiced_card_ids : [];
    return practicedCardIds.length;
}

function sessionWrongCount(session) {
    const wrongCount = Number.parseInt(session?.wrong_count, 10);
    return Number.isFinite(wrongCount) && wrongCount > 0 ? wrongCount : 0;
}

function sessionReportHref(session) {
    const qs = new URLSearchParams();
    qs.set('id', String(session?.kidId || ''));
    qs.set('sessionId', String(session?.id || ''));
    qs.set('from', 'point-activity-report');
    if (requestedRuleId) qs.set('ruleId', requestedRuleId);
    return `/kid-session-report.html?${qs.toString()}`;
}

function progressDataUrl(kidId) {
    const url = new URL(`${API_BASE}/kids/${encodeURIComponent(String(kidId || ''))}/daily-progress`);
    const categoryKey = ruleTriggerKey();
    if (categoryKey) url.searchParams.set('categoryKey', categoryKey);
    return url.toString();
}

function visibleProgressRows() {
    const selectedIds = selectedKidId
        ? [selectedKidId]
        : kids.map((kid) => String(kid.id));
    return selectedIds.flatMap((kidId) => {
        const data = progressDataByKid.get(String(kidId)) || {};
        const rows = Array.isArray(data.daily_progress_rows) ? data.daily_progress_rows : [];
        return rows.map((row) => ({
            ...row,
            card_id: `${kidId}:${row?.card_id}`,
        }));
    });
}

function progressFamilyTimezone() {
    const selectedIds = selectedKidId
        ? [selectedKidId]
        : kids.map((kid) => String(kid.id));
    for (const kidId of selectedIds) {
        const tz = String(progressDataByKid.get(String(kidId))?.family_timezone || '').trim();
        if (tz) return tz;
    }
    return familyTimezone();
}

function getNiceStep(rawStep) {
    const value = Math.max(1, Number(rawStep) || 1);
    const magnitude = 10 ** Math.floor(Math.log10(value));
    const normalized = value / magnitude;
    if (normalized <= 1) return magnitude;
    if (normalized <= 2) return 2 * magnitude;
    if (normalized <= 5) return 5 * magnitude;
    return 10 * magnitude;
}

function iconHtml(rule) {
    const triggerKey = String(rule?.triggerKey || '').trim();
    if (rule?.ruleKind === 'in_app_chore' && triggerKey && typeof window.subjectIcon === 'function') {
        return window.subjectIcon(triggerKey);
    }
    return escapeHtml(rule?.emoji || '+');
}

function typeBadge(rule) {
    const ruleKind = String(rule?.ruleKind || '').trim();
    if (ruleKind === 'deduction_event') {
        return { label: 'Loss', icon: 'thumbs-down', tone: 'loss' };
    }
    if (ruleKind === 'redeemed_reward') {
        return { label: 'Redeem', icon: 'gift', tone: 'redeem' };
    }
    if (ruleKind === 'in_app_chore') {
        return { label: 'In-app earn', icon: 'thumbs-up', tone: 'earn' };
    }
    if (ruleKind === 'off_app_chore') {
        return { label: 'Off-app earn', icon: 'thumbs-up', tone: 'earn' };
    }
    return { label: 'Bonus earn', icon: 'thumbs-up', tone: 'earn' };
}

function pointRulesHref(rule) {
    const ruleKind = String(rule?.ruleKind || '').trim();
    const kindByRuleKind = {
        in_app_chore: 'in_app_chore',
        off_app_chore: 'off_app_chore',
        bonus_event: 'bonus_event',
        deduction_event: 'deduction_event',
        redeemed_reward: 'redeemed_reward',
    };
    const kind = kindByRuleKind[ruleKind] || 'bonus_event';
    const params = new URLSearchParams({ kind });
    if (kind === 'redeemed_reward' && String(rule?.rewardType || '').trim()) {
        params.set('rewardType', String(rule.rewardType).trim());
    }
    return `/point-rules.html?${params.toString()}`;
}

function typeBadgeHtml(rule) {
    const badge = typeBadge(rule);
    const iconMarkup = typeof window.icon === 'function'
        ? window.icon(badge.icon, { size: 13, strokeWidth: 2.35, className: 'point-activity-type-icon icon' })
        : `<span class="point-activity-type-icon icon" data-icon="${escapeHtml(badge.icon)}" data-icon-size="13" data-icon-stroke="2.35" aria-hidden="true"></span>`;
    return `
        <span class="point-activity-type point-activity-type--${escapeHtml(badge.tone)}">
            ${iconMarkup}
            <span>${escapeHtml(badge.label)}</span>
        </span>
    `;
}

function pointPillClass(rule) {
    const tone = typeBadge(rule).tone;
    if (tone === 'loss') return 'negative';
    if (tone === 'redeem') return 'redeemed';
    return 'positive';
}

function avatarHtml(kid) {
    const name = String(kid?.name || 'Kid').trim();
    const url = String(kid?.avatarUrl || '').trim();
    if (url) return `<img class="point-activity-avatar" src="${escapeHtml(url)}" alt="${escapeHtml(name)}">`;
    return `<span class="point-activity-avatar point-activity-avatar-fallback">${escapeHtml(name.charAt(0).toUpperCase())}</span>`;
}

function renderHero() {
    const allEvents = allActivityEvents();
    const events = visibleEvents();
    const rule = currentRule || {};
    const title = String(rule.name || 'Point activity').trim();
    const rulesHref = pointRulesHref(rule);
    const filterLabel = selectedKidId
        ? `${kids.find((kid) => String(kid.id) === selectedKidId)?.name || 'Kid'} only`
        : 'Showing combined total';
    if (pageTitle) pageTitle.textContent = title;
    document.title = `${title} - Point Activity History - The Mommy App`;

    pointActivityHero.innerHTML = `
        <div class="point-activity-hero">
            <div class="point-activity-hero-top">
                <div class="point-activity-icon" aria-hidden="true">${iconHtml(rule)}</div>
                <div class="point-activity-main">
                    <div class="point-activity-title-row">
                        <h2 class="point-activity-title">${escapeHtml(title)}</h2>
                        ${typeBadgeHtml(rule)}
                        <a class="paradigm-icon-btn paradigm-panel-action--circle point-activity-rules-link" href="${escapeHtml(rulesHref)}" aria-label="Edit point rules" title="Edit rules"><span class="icon" data-icon="pencil" data-icon-size="14" data-icon-stroke="2.5" aria-hidden="true"></span></a>
                    </div>
                    <button type="button" class="report-hero-meta-item point-activity-filter" data-point-filter="combined" ${selectedKidId ? '' : 'disabled'}>
                        <span class="report-hero-meta-icon"><span class="icon" data-icon="users" data-icon-size="13" data-icon-stroke="2.4" aria-hidden="true"></span></span>
                        <span class="report-hero-meta-value">${escapeHtml(filterLabel)}</span>
                    </button>
                    <div class="report-hero-meta point-activity-meta">
                        <span class="report-hero-meta-item">
                            <span class="report-hero-meta-icon"><span class="icon" data-icon="calendar" data-icon-size="13" data-icon-stroke="2.4" aria-hidden="true"></span></span>
                            <span class="report-hero-meta-value">${escapeHtml(activeDayCount(events))} active days</span>
                        </span>
                        <span class="report-hero-meta-item">
                            <span class="report-hero-meta-icon"><span class="icon" data-icon="clock" data-icon-size="13" data-icon-stroke="2.4" aria-hidden="true"></span></span>
                            <span class="report-hero-meta-value">${escapeHtml(latestLabel(events))}</span>
                        </span>
                    </div>
                </div>
                <div class="point-activity-kids">
                    ${kids.map((kid) => {
                        const kidEvents = allEvents.filter((event) => String(event?.kid?.id || '') === String(kid.id));
                        const sessionTotals = sessionTotalsForKid(kid.id);
                        const sessionCardTotal = sessionCardTotalForKid(kid.id);
                        return `
                            <button type="button" class="point-activity-kid-card${selectedKidId === String(kid.id) ? ' active' : ''}${isSessionsMetricView() ? ' no-chevron' : ''}" data-point-filter-kid="${escapeHtml(kid.id)}" style="--kid-color: ${escapeHtml(colorForKid(kid))}">
                                ${avatarHtml(kid)}
                                <span>
                                    <span class="point-activity-kid-name">${escapeHtml(kid.name || 'Kid')}</span>
                                    <span class="point-activity-kid-points">${escapeHtml(isSessionsMetricView() ? formatActiveMinutes(sessionTotals.activeMinutes) : formatPoints(pointTotal(kidEvents)))}</span>
                                    <span class="point-activity-kid-count">${escapeHtml(isSessionsMetricView() ? formatSessionCardMeta(sessionTotals.count, sessionCardTotal) : `${kidEvents.length} ${kidEvents.length === 1 ? 'time' : 'times'}`)}</span>
                                </span>
                                ${isSessionsMetricView() ? '' : '<span class="icon" data-icon="chevron-right" data-icon-size="15" data-icon-stroke="2.7" aria-hidden="true"></span>'}
                            </button>
                        `;
                    }).join('')}
                </div>
            </div>
        </div>
    `;
    window.hydrateIcons?.(pointActivityHero);
}

function calendarTotalsByDay(events) {
    const timezone = familyTimezone();
    const totals = new Map();
    events.forEach((event) => {
        const key = dayKey(parseDate(event?.createdAt), timezone);
        if (!key || key.slice(0, 7) !== displayedMonthKey) return;
        totals.set(key, (totals.get(key) || 0) + (Number.parseInt(event?.pointsDelta, 10) || 0));
    });
    return totals;
}

function calendarSessionsByDay() {
    const timezone = familyTimezone();
    const totals = new Map();
    if (!timezone) return totals;
    visibleSessions().forEach((session) => {
        const key = dayKey(parseDate(session?.started_at || session?.completed_at), timezone);
        if (!key || key.slice(0, 7) !== displayedMonthKey) return;
        const current = totals.get(key) || { minutes: 0, count: 0, cards: 0, wrong: 0 };
        const answerCount = Number.parseInt(session?.answer_count, 10);
        const plannedCount = Number.parseInt(session?.planned_count, 10);
        const wrongCount = Number.parseInt(session?.wrong_count, 10);
        const practicedCardIds = Array.isArray(session?.practiced_card_ids) ? session.practiced_card_ids : [];
        current.minutes += sessionActiveMinutes(session);
        current.count += 1;
        current.cards += Number.isFinite(answerCount) && answerCount > 0
            ? answerCount
            : (Number.isFinite(plannedCount) && plannedCount > 0 ? plannedCount : practicedCardIds.length);
        current.wrong += Number.isFinite(wrongCount) && wrongCount > 0 ? wrongCount : 0;
        totals.set(key, current);
    });
    return totals;
}

function calendarNoteDays(events) {
    const timezone = familyTimezone();
    const days = new Set();
    events.forEach((event) => {
        const key = dayKey(parseDate(event?.createdAt), timezone);
        if (!key || key.slice(0, 7) !== displayedMonthKey || !String(event?.note || '').trim()) return;
        days.add(key);
    });
    return days;
}

function calendarLevel(total, maxTotal) {
    const absTotal = Math.abs(total);
    if (absTotal <= 0) return 0;
    const max = Math.max(1, Math.abs(maxTotal) || 0);
    return Math.min(5, Math.max(1, Math.ceil((absTotal / max) * 5)));
}

function calendarCellHtml(dayNumber, totals, noteDays, maxTotal) {
    const key = `${displayedMonthKey}-${String(dayNumber).padStart(2, '0')}`;
    const hasTotal = totals.has(key);
    const hasNote = noteDays.has(key);
    const isSessionCalendar = isInAppChore();
    const total = totals.get(key) || (isSessionCalendar ? { minutes: 0, count: 0, cards: 0, wrong: 0 } : 0);
    const minutes = isSessionCalendar ? Number(total.minutes) || 0 : 0;
    const sessionCount = isSessionCalendar ? Number.parseInt(total.count, 10) || 0 : 0;
    const cardCount = isSessionCalendar ? Number.parseInt(total.cards, 10) || 0 : 0;
    const wrongCount = isSessionCalendar ? Number.parseInt(total.wrong, 10) || 0 : 0;
    const pointTotalValue = isSessionCalendar ? 0 : Number(total) || 0;
    const metricTotal = isSessionCalendar ? minutes : pointTotalValue;
    const level = calendarLevel(metricTotal, maxTotal);
    const calendarTone = typeBadge(currentRule || {}).tone;
    const canSelect = isSessionCalendar ? sessionCount > 0 : Math.abs(pointTotalValue) > 0;
    const tagName = canSelect ? 'button' : 'div';
    const ariaMetric = isSessionCalendar
        ? `${formatCalendarMinutes(minutes)} ${cardCount.toLocaleString()} cards`
        : `${Math.abs(pointTotalValue).toLocaleString()} points`;
    const attrs = canSelect
        ? `type="button" data-calendar-day="${escapeHtml(key)}" aria-label="${escapeHtml(`${shortDateLabel(key)} ${ariaMetric}`)}"`
        : '';
    return `
        <${tagName} class="point-activity-day${hasTotal ? ` has-total level-${level}` : ''}${hasNote ? ' has-note' : ''}${selectedCalendarDayKey === key ? ' active' : ''} tone-${escapeHtml(calendarTone)}" ${attrs}>
            <span class="point-activity-day-number">${dayNumber}</span>
            <span class="point-activity-day-metrics${isSessionCalendar ? ' point-activity-day-metrics--session' : ''}">
                <span class="point-activity-day-total">${hasTotal ? escapeHtml(isSessionCalendar ? formatCalendarMinutes(minutes) : Math.abs(pointTotalValue).toLocaleString()) : (isSessionCalendar ? '0m' : '0')}</span>
            </span>
            ${isSessionCalendar ? `
                <span class="point-activity-day-card-count" aria-label="${escapeHtml(`${cardCount} cards practiced`)}">
                    <span class="icon" data-icon="credit-card" data-icon-size="11" data-icon-stroke="2.5" aria-hidden="true"></span>
                    <span>${escapeHtml(String(cardCount))}</span>
                </span>
            ` : ''}
            ${isSessionCalendar && wrongCount > 0 ? `
                <span class="point-activity-day-note-dot" aria-label="${escapeHtml(`${wrongCount} wrong cards`)}"></span>
            ` : ''}
            ${hasNote ? '<span class="point-activity-day-note-dot" aria-hidden="true"></span>' : ''}
        </${tagName}>
    `;
}

function eventsForSelectedDay() {
    if (!selectedCalendarDayKey) return [];
    return visibleEvents()
        .filter((event) => dayKey(parseDate(event?.createdAt), familyTimezone()) === selectedCalendarDayKey)
        .sort((a, b) => parseDate(a?.createdAt).getTime() - parseDate(b?.createdAt).getTime());
}

function sessionsForSelectedDay() {
    if (!selectedCalendarDayKey) return [];
    return visibleSessions()
        .filter((session) => dayKey(parseDate(session?.started_at || session?.completed_at), familyTimezone()) === selectedCalendarDayKey)
        .sort((a, b) => parseDate(a?.started_at || a?.completed_at).getTime() - parseDate(b?.started_at || b?.completed_at).getTime());
}

function renderDayDetails() {
    if (isInAppChore()) return renderSessionDayDetails();
    const events = eventsForSelectedDay();
    if (!selectedCalendarDayKey || !events.length) return '';
    return `
        <div class="point-activity-day-detail">
            <h3 class="point-activity-day-detail-date paradigm-panel-heading">${escapeHtml(shortDateLabel(selectedCalendarDayKey))}</h3>
            <div class="point-activity-day-detail-list">
                ${events.map((event) => {
                    const kid = event?.kid || {};
                    const note = String(event?.note || '').trim();
                    return `
                        <div class="point-activity-event-row" style="--kid-color: ${escapeHtml(colorForKid(kid))}">
                            <span class="point-activity-event-time">${escapeHtml(timeLabel(event?.createdAt))}</span>
                            ${avatarHtml(kid)}
                            <span class="point-activity-event-name">${escapeHtml(kid?.name || 'Kid')}</span>
                            <span class="point-activity-event-note">${escapeHtml(note || '-')}</span>
                            <span class="point-activity-event-points point-rule-delta paradigm-pill ${escapeHtml(pointPillClass(currentRule || event?.rule || {}))}">${escapeHtml(formatSignedPoints(event?.pointsDelta))}</span>
                        </div>
                    `;
                }).join('')}
            </div>
        </div>
    `;
}

function renderSessionDayDetails() {
    const sessions = sessionsForSelectedDay();
    if (!selectedCalendarDayKey || !sessions.length) return '';
    return `
        <div class="point-activity-day-detail">
            <h3 class="point-activity-day-detail-date paradigm-panel-heading">${escapeHtml(shortDateLabel(selectedCalendarDayKey))}</h3>
            <div class="point-activity-day-detail-list">
                ${sessions.map((session) => {
                    const kid = session?.kid || {};
                    const cards = sessionCardCount(session);
                    const wrong = sessionWrongCount(session);
                    const minutes = sessionActiveMinutes(session);
                    return `
                        <a class="point-activity-event-row point-activity-event-row-link" href="${escapeHtml(sessionReportHref(session))}" style="--kid-color: ${escapeHtml(colorForKid(kid))}">
                            <span class="point-activity-event-time">${escapeHtml(timeLabel(session?.started_at || session?.completed_at))}</span>
                            ${avatarHtml(kid)}
                            <span class="point-activity-event-name">${escapeHtml(kid?.name || 'Kid')}</span>
                            <span class="point-activity-event-note point-activity-event-note--metrics">
                                <span>${escapeHtml(`${cards.toLocaleString()} ${cards === 1 ? 'card' : 'cards'}`)}</span>
                                ${wrong > 0 ? `
                                    <span class="point-activity-event-wrong-metric">
                                        <span class="icon" data-icon="x" data-icon-size="12" data-icon-stroke="2.7" aria-hidden="true"></span>
                                        <span>${escapeHtml(String(wrong))}</span>
                                    </span>
                                ` : ''}
                                <span>${escapeHtml(formatCalendarMinutes(minutes))}</span>
                            </span>
                            <span class="icon point-activity-event-chevron" data-icon="chevron-right" data-icon-size="16" data-icon-stroke="2.7" aria-hidden="true"></span>
                        </a>
                    `;
                }).join('')}
            </div>
        </div>
    `;
}

function buildProgressChart(dailyProgressRows, timezone) {
    const rows = Array.isArray(dailyProgressRows) ? dailyProgressRows : [];
    const validRows = [];
    rows.forEach((row) => {
        const cardId = String(row?.card_id || '').trim();
        const date = String(row?.date || '').trim();
        const attempts = Math.max(0, Number.parseInt(row?.attempts, 10) || 0);
        const correct = Math.max(0, Number.parseInt(row?.correct, 10) || 0);
        const rtSum = Math.max(0, Number.parseInt(row?.correct_response_time_ms_sum, 10) || 0);
        const rtCount = Math.max(0, Number.parseInt(row?.correct_response_time_count, 10) || 0);
        if (!cardId || !date || attempts <= 0) return;
        validRows.push({ cardId, date, attempts, correct, rtSum, rtCount });
    });
    if (!validRows.length) return null;
    const rowsByDate = new Map();
    validRows.forEach((row) => {
        if (!rowsByDate.has(row.date)) rowsByDate.set(row.date, []);
        rowsByDate.get(row.date).push(row);
    });
    const sortedDates = Array.from(rowsByDate.keys()).sort();
    const firstDate = sortedDates[0];
    const lastDate = sortedDates[sortedDates.length - 1];
    const startEpoch = parseDateKeyToEpochUtc(firstDate);
    const lastDataEpoch = parseDateKeyToEpochUtc(lastDate);
    if (!Number.isFinite(startEpoch) || !Number.isFinite(lastDataEpoch) || lastDataEpoch < startEpoch) return null;
    const todayEpoch = parseDateKeyToEpochUtc(getTodayDateKeyInTimezone(timezone));
    const endEpoch = Number.isFinite(todayEpoch) && todayEpoch > lastDataEpoch ? todayEpoch : lastDataEpoch;
    const dayMs = 86400000;
    const cardCum = new Map();
    const practicedSet = new Set();
    const learnedSet = new Set();
    const points = [];
    let dayIndex = 0;
    let cumRtSumMs = 0;
    let cumRtCount = 0;
    let cumAttempts = 0;
    let cumCorrect = 0;
    for (let epoch = startEpoch; epoch <= endEpoch; epoch += dayMs) {
        dayIndex += 1;
        const dateStr = formatEpochUtcToDateKey(epoch);
        const dayRows = rowsByDate.get(dateStr) || [];
        dayRows.forEach((row) => {
            let cum = cardCum.get(row.cardId);
            if (!cum) {
                cum = { attempts: 0, correct: 0 };
                cardCum.set(row.cardId, cum);
            }
            cum.attempts += row.attempts;
            cum.correct += row.correct;
            practicedSet.add(row.cardId);
            if (cum.attempts >= 5 && (cum.correct / cum.attempts) >= 0.8) learnedSet.add(row.cardId);
            cumRtSumMs += row.rtSum;
            cumRtCount += row.rtCount;
            cumAttempts += row.attempts;
            cumCorrect += row.correct;
        });
        points.push({
            dayIndex,
            date: dateStr,
            practiced: practicedSet.size,
            learned: learnedSet.size,
            avgCorrectRtSec: cumRtCount > 0 ? (cumRtSumMs / cumRtCount) / 1000 : null,
            cumCorrectPct: cumAttempts > 0 ? (cumCorrect / cumAttempts) * 100 : null,
        });
    }
    const yMax = Math.max(1, points.reduce((max, p) => Math.max(max, p.practiced, p.learned), 0));
    const rtRange = computeFiniteRange(points, 'avgCorrectRtSec');
    const crRange = computeFiniteRange(points, 'cumCorrectPct');
    return {
        firstDate,
        lastDate,
        totalDays: points.length,
        points,
        yMax,
        rtMin: rtRange.hasData ? rtRange.min : null,
        rtMax: rtRange.hasData ? rtRange.max : 0,
        crMin: crRange.hasData ? crRange.min : null,
        crMax: crRange.hasData ? crRange.max : 0,
    };
}

function computeFiniteRange(points, key) {
    let min = Infinity;
    let max = -Infinity;
    points.forEach((point) => {
        const value = Number(point?.[key]);
        if (!Number.isFinite(value)) return;
        min = Math.min(min, value);
        max = Math.max(max, value);
    });
    const hasData = Number.isFinite(min) && Number.isFinite(max);
    return { hasData, min: hasData ? min : 0, max: hasData ? max : 0 };
}

function getTodayDateKeyInTimezone(timezone) {
    try {
        const formatter = new Intl.DateTimeFormat('en-CA', {
            timeZone: String(timezone || '').trim() || undefined,
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
        });
        const parts = formatter.formatToParts(new Date());
        const part = (type) => parts.find((item) => item.type === type)?.value;
        if (part('year') && part('month') && part('day')) return `${part('year')}-${part('month')}-${part('day')}`;
    } catch (_err) {}
    return formatEpochUtcToDateKey(Date.now());
}

function parseDateKeyToEpochUtc(dateStr) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateStr || '').trim());
    if (!match) return NaN;
    return Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

function formatEpochUtcToDateKey(epochMs) {
    const date = new Date(epochMs);
    if (Number.isNaN(date.getTime())) return '';
    return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
}

function buildProgressYTicks(yMax) {
    const safeMax = Math.max(1, Number(yMax) || 0);
    const step = getNiceStep(safeMax / 4);
    const axisMax = Math.max(step, Math.ceil(safeMax / step) * step);
    const ticks = [];
    for (let value = 0; value <= axisMax; value += step) ticks.push(value);
    return ticks;
}

function buildResponseTimeYTicks(rtMin, rtMax) {
    const lo = Math.max(0, Math.floor(Number(rtMin) || 0));
    const hi = Math.max(lo + 1, Number(rtMax) || lo + 1);
    const step = getNiceStep(Math.max(1, hi - lo) / 4);
    const axisMax = lo + Math.max(step, Math.ceil((hi - lo) / step) * step);
    const ticks = [];
    for (let value = lo; value <= axisMax; value += step) ticks.push(value);
    return ticks;
}

function buildCorrectnessRateYTicks(crMin, crMax) {
    const lo = Math.max(0, Math.floor(Number(crMin) || 0));
    const hi = Math.min(100, Math.max(lo + 1, Math.ceil(Number(crMax) || lo + 1)));
    const step = getNiceStep(Math.max(1, hi - lo) / 4);
    const axisMax = Math.min(100, lo + Math.max(step, Math.ceil((hi - lo) / step) * step));
    const ticks = [];
    for (let value = lo; value <= axisMax; value += step) ticks.push(value);
    if (ticks[ticks.length - 1] < hi) ticks.push(hi);
    return ticks;
}

function buildProgressXTicks(totalDays) {
    const days = Math.max(1, Number(totalDays) || 1);
    const lastTick = days - 1;
    if (lastTick <= 0) return [0];
    const targetCount = 5;
    const candidateSteps = [1, 2, 5, 10, 25, 50, 100, 250, 500, 1000];
    let step = candidateSteps[candidateSteps.length - 1];
    for (const candidate of candidateSteps) {
        if (Math.floor(lastTick / candidate) + 1 <= targetCount) {
            step = candidate;
            break;
        }
    }
    const minGap = Math.max(1, Math.floor(step * 0.6));
    const ticks = new Set([0]);
    for (let value = step; value <= lastTick - minGap; value += step) ticks.add(value);
    ticks.add(lastTick);
    return Array.from(ticks).sort((a, b) => a - b);
}

function clipProgressChart(chart, viewDays) {
    if (!chart || !Array.isArray(chart.points) || !chart.points.length) return chart;
    const fullSpanDays = Math.max(0, Number(chart.totalDays) - 1);
    const requested = Math.max(0, Number(viewDays) || 0);
    const visiblePoints = (requested > 0 && requested < fullSpanDays)
        ? chart.points.slice(-(requested + 1))
        : chart.points;
    if (visiblePoints === chart.points) return { ...chart, fullSpanDays, viewDays: 0 };
    const reindexed = visiblePoints.map((point, idx) => ({ ...point, dayIndex: idx + 1 }));
    const rtRange = computeFiniteRange(reindexed, 'avgCorrectRtSec');
    const crRange = computeFiniteRange(reindexed, 'cumCorrectPct');
    return {
        ...chart,
        points: reindexed,
        totalDays: reindexed.length,
        yMax: Math.max(1, reindexed.reduce((max, p) => Math.max(max, p.practiced, p.learned), 0)),
        rtMin: rtRange.hasData ? rtRange.min : null,
        rtMax: rtRange.hasData ? rtRange.max : 0,
        crMin: crRange.hasData ? crRange.min : null,
        crMax: crRange.hasData ? crRange.max : 0,
        fullSpanDays,
        viewDays: requested,
    };
}

function renderProgressMetricBtns({ rtHasData, crHasData, activeMetric }) {
    if (!rtHasData || !crHasData) return '';
    return `
        <div class="daily-progress-metric-btns paradigm-chip-toggle-group">
            <button type="button" class="daily-progress-metric-btn paradigm-chip-toggle${activeMetric === 'speed' ? ' active' : ''}" data-progress-metric="speed">Speed</button>
            <button type="button" class="daily-progress-metric-btn paradigm-chip-toggle${activeMetric === 'correctness' ? ' active' : ''}" data-progress-metric="correctness">Correct</button>
        </div>
    `;
}

function renderProgressPeriodBtns(fullSpanDays) {
    const span = Math.max(0, Number(fullSpanDays) || 0);
    const presets = [7, 14, 30, 90].filter((days) => span > days);
    if (!presets.length) {
        currentProgressViewDays = 0;
        return '';
    }
    if (currentProgressViewDays !== 0 && !presets.includes(currentProgressViewDays)) currentProgressViewDays = 0;
    const options = [...presets.map((days) => ({ days, label: `${days}d` })), { days: 0, label: 'All' }];
    return `
        <div class="daily-progress-period-btns paradigm-chip-toggle-group">
            ${options.map((option) => `
                <button type="button" class="daily-progress-period-btn paradigm-chip-toggle${option.days === currentProgressViewDays ? ' active' : ''}" data-progress-period-days="${option.days}">${escapeHtml(option.label)}</button>
            `).join('')}
        </div>
    `;
}

function renderProgressPanel() {
    if (!pointActivityProgressPanel || !pointActivityProgress) return;
    if (!isInAppChore()) {
        pointActivityProgressPanel.classList.add('hidden');
        pointActivityProgress.innerHTML = '';
        return;
    }
    const chart = clipProgressChart(buildProgressChart(visibleProgressRows(), progressFamilyTimezone()), currentProgressViewDays);
    if (!chart || !Array.isArray(chart.points) || !chart.points.length) {
        pointActivityProgressPanel.classList.add('hidden');
        pointActivityProgress.innerHTML = '';
        return;
    }
    pointActivityProgressPanel.classList.remove('hidden');
    const points = chart.points;
    const totalDays = Math.max(1, Number(chart.totalDays) || points.length);
    const yTicks = buildProgressYTicks(chart.yMax);
    const axisMax = yTicks[yTicks.length - 1] || Math.max(1, Number(chart.yMax) || 1);
    const rtMin = Number(chart.rtMin);
    const rtMax = Number(chart.rtMax) || 0;
    const crMin = Number(chart.crMin);
    const crMax = Number(chart.crMax) || 0;
    const rtHasData = rtMax > 0 && Number.isFinite(rtMin);
    const crHasData = crMax > 0 && Number.isFinite(crMin);
    const activeMetric = currentProgressMetric === 'correctness' && crHasData
        ? 'correctness'
        : (rtHasData ? 'speed' : (crHasData ? 'correctness' : 'none'));
    const hasRtData = activeMetric === 'speed' && rtHasData;
    const hasCrData = activeMetric === 'correctness' && crHasData;
    const rtTicks = hasRtData ? buildResponseTimeYTicks(rtMin, rtMax) : [];
    const rtAxisMin = rtTicks.length ? rtTicks[0] : 0;
    const rtAxisMax = rtTicks.length ? rtTicks[rtTicks.length - 1] : 0;
    const rtAxisRange = rtAxisMax - rtAxisMin;
    const crTicks = hasCrData ? buildCorrectnessRateYTicks(crMin, crMax) : [];
    const crAxisMin = crTicks.length ? crTicks[0] : 0;
    const crAxisMax = crTicks.length ? crTicks[crTicks.length - 1] : 0;
    const crAxisRange = crAxisMax - crAxisMin;
    const xTicks = buildProgressXTicks(totalDays);
    const positionForDay = (dayIndex) => totalDays <= 1 ? 50 : ((dayIndex - 1) / (totalDays - 1)) * 100;
    const positionForValue = (value) => axisMax <= 0 ? 0 : (Number(value) / axisMax) * 100;
    const positionForRt = (value) => rtAxisRange <= 0 ? 0 : ((Number(value) - rtAxisMin) / rtAxisRange) * 100;
    const positionForCr = (value) => crAxisRange <= 0 ? 0 : ((Number(value) - crAxisMin) / crAxisRange) * 100;
    const buildLinePath = (key) => points.map((point, idx) => {
        const x = positionForDay(point.dayIndex).toFixed(2);
        const y = (100 - positionForValue(point[key])).toFixed(2);
        return `${idx === 0 ? 'M' : 'L'}${x},${y}`;
    }).join(' ');
    const buildSparseLinePath = (key, positionFn) => {
        const segments = [];
        let pendingMove = true;
        points.forEach((point) => {
            const value = Number(point[key]);
            if (!Number.isFinite(value)) {
                pendingMove = true;
                return;
            }
            const x = positionForDay(point.dayIndex).toFixed(2);
            const y = (100 - positionFn(value)).toFixed(2);
            segments.push(`${pendingMove ? 'M' : 'L'}${x},${y}`);
            pendingMove = false;
        });
        return segments.join(' ');
    };
    const lastPoint = points[points.length - 1] || { practiced: 0, learned: 0 };
    const lastRt = Number(lastPoint.avgCorrectRtSec);
    const lastCr = Number(lastPoint.cumCorrectPct);
    const lastRtLabel = Number.isFinite(lastRt) ? `${lastRt.toFixed(2)}s` : '-';
    const lastCrLabel = Number.isFinite(lastCr) ? `${lastCr.toFixed(1)}%` : '-';
    const formatRtTick = (tick) => Number.isInteger(Number(tick)) ? `${tick}s` : `${Number(tick).toFixed(1)}s`;
    const formatCrTick = (tick) => Number.isInteger(Number(tick)) ? `${tick}%` : `${Number(tick).toFixed(1)}%`;
    const metricButtonsHtml = renderProgressMetricBtns({ rtHasData, crHasData, activeMetric });
    const periodButtonsHtml = renderProgressPeriodBtns(Number(chart.fullSpanDays) || 0);
    pointActivityProgress.innerHTML = `
        <div class="daily-progress-card${hasRtData ? ' has-response-time' : ''}${hasCrData ? ' has-correctness-rate' : ''}">
            <div class="daily-progress-head">
                <h2 class="paradigm-panel-title">
                    <span class="paradigm-panel-title-icon"><span class="icon" data-icon="award" data-icon-size="22" data-icon-stroke="2.4" aria-hidden="true"></span></span>
                    <span class="paradigm-panel-heading">Progress over time</span>
                </h2>
                ${metricButtonsHtml}
            </div>
            ${periodButtonsHtml ? `<div class="daily-progress-controls">${periodButtonsHtml}</div>` : ''}
            <div class="daily-progress-legend">
                <span class="daily-progress-legend-item practiced"><span class="daily-progress-legend-swatch"></span>Practiced <span style="color: #2f66e6;">${escapeHtml(String(lastPoint.practiced))}</span></span>
                <span class="daily-progress-legend-item learned"><span class="daily-progress-legend-swatch"></span>Learned <span style="color: #16a34a;">${escapeHtml(String(lastPoint.learned))}</span></span>
                ${hasCrData ? `<span class="daily-progress-legend-item correctness-rate"><span class="daily-progress-legend-swatch"></span>Cumulative correct <span style="color: #db2777;">${escapeHtml(lastCrLabel)}</span></span>` : ''}
                ${hasRtData ? `<span class="daily-progress-legend-item response-time"><span class="daily-progress-legend-swatch"></span>Avg correct time <span style="color: #d97706;">${escapeHtml(lastRtLabel)}</span></span>` : ''}
            </div>
            <div class="daily-progress-chart">
                <div class="daily-progress-y-label">Cards</div>
                <div class="daily-progress-y-axis">
                    ${yTicks.map((tick) => `<div class="daily-progress-y-tick paradigm-chart-axis-label" style="bottom:${positionForValue(tick).toFixed(2)}%">${escapeHtml(String(tick))}</div>`).join('')}
                </div>
                ${hasRtData ? `
                    <div class="daily-progress-y-label daily-progress-y-label-right">Response</div>
                    <div class="daily-progress-y-axis daily-progress-y-axis-right">
                        ${rtTicks.map((tick) => `<div class="daily-progress-y-tick paradigm-chart-axis-label" style="bottom:${positionForRt(tick).toFixed(2)}%">${escapeHtml(formatRtTick(tick))}</div>`).join('')}
                    </div>
                ` : ''}
                ${hasCrData ? `
                    <div class="daily-progress-y-label daily-progress-y-label-correctness">Correct</div>
                    <div class="daily-progress-y-axis daily-progress-y-axis-correctness">
                        ${crTicks.map((tick) => `<div class="daily-progress-y-tick paradigm-chart-axis-label" style="bottom:${positionForCr(tick).toFixed(2)}%">${escapeHtml(formatCrTick(tick))}</div>`).join('')}
                    </div>
                ` : ''}
                <div class="daily-progress-plot">
                    <div class="daily-progress-grid">
                        ${yTicks.map((tick) => `<div class="daily-progress-grid-line paradigm-chart-grid-line" style="bottom:${positionForValue(tick).toFixed(2)}%"></div>`).join('')}
                        ${xTicks.map((tick) => `<div class="daily-progress-grid-line-vertical paradigm-chart-grid-line" style="left:${positionForDay(tick + 1).toFixed(2)}%"></div>`).join('')}
                    </div>
                    <svg class="daily-progress-svg" viewBox="0 0 100 100" preserveAspectRatio="none">
                        <path class="daily-progress-line practiced" d="${buildLinePath('practiced')}" />
                        <path class="daily-progress-line learned" d="${buildLinePath('learned')}" />
                        ${hasCrData ? `<path class="daily-progress-line correctness-rate" d="${buildSparseLinePath('cumCorrectPct', positionForCr)}" />` : ''}
                        ${hasRtData ? `<path class="daily-progress-line response-time" d="${buildSparseLinePath('avgCorrectRtSec', positionForRt)}" />` : ''}
                    </svg>
                    <div class="daily-progress-x-axis">
                        ${xTicks.map((tick) => {
                            const isLast = tick === totalDays - 1;
                            return `<div class="daily-progress-x-tick paradigm-chart-axis-label${isLast ? ' is-today' : ''}" style="left:${positionForDay(tick + 1).toFixed(2)}%">${escapeHtml(String(tick))}d${isLast ? '<div class="daily-progress-x-tick-today">(today)</div>' : ''}</div>`;
                        }).join('')}
                    </div>
                </div>
            </div>
            <div class="daily-progress-definition"><strong>Learned</strong> = >= 5 practice and >= 80% correct.</div>
        </div>
    `;
    window.hydrateIcons?.(pointActivityProgress);
}

function renderCalendar() {
    if (!pointActivityCalendar) return;
    ensureDisplayedMonth();
    const firstDay = monthDateFromKey(displayedMonthKey);
    const leadingBlanks = firstDay ? weekdayIndexMondayFirst(firstDay) : 0;
    const totalDays = daysInMonth(displayedMonthKey);
    const totals = isInAppChore() ? calendarSessionsByDay() : calendarTotalsByDay(visibleEvents());
    const noteDays = isInAppChore() ? new Set() : calendarNoteDays(visibleEvents());
    const maxTotal = Math.max(1, ...[...totals.values()].map((value) => (
        isInAppChore() ? Math.abs(Number(value?.minutes) || 0) : Math.abs(value)
    )));
    const cells = [
        ...Array.from({ length: leadingBlanks }, () => '<div class="point-activity-day is-blank" aria-hidden="true"></div>'),
        ...Array.from({ length: totalDays }, (_, index) => calendarCellHtml(index + 1, totals, noteDays, maxTotal)),
    ];

    pointActivityCalendar.innerHTML = `
        <div class="point-activity-calendar-head">
            <h2 class="paradigm-panel-title">
                <span class="paradigm-panel-title-icon"><span class="icon" data-icon="calendar" data-icon-size="22" data-icon-stroke="2.4" aria-hidden="true"></span></span>
                <span class="paradigm-panel-heading">Monthly Activity Calendar</span>
            </h2>
            <div class="point-activity-month-nav">
                <button type="button" class="paradigm-icon-btn paradigm-panel-action--circle" data-calendar-month="-1" aria-label="Previous month">
                    <span class="icon" data-icon="chevron-left" data-icon-size="16" data-icon-stroke="2.8" aria-hidden="true"></span>
                </button>
                <span class="point-activity-month-label">${escapeHtml(monthLabel(displayedMonthKey))}</span>
                <button type="button" class="paradigm-icon-btn paradigm-panel-action--circle" data-calendar-month="1" aria-label="Next month">
                    <span class="icon" data-icon="chevron-right" data-icon-size="16" data-icon-stroke="2.8" aria-hidden="true"></span>
                </button>
            </div>
        </div>
        <div class="point-activity-weekdays" aria-hidden="true">
            <span>Mon</span><span>Tue</span><span>Wed</span><span>Thu</span><span>Fri</span><span>Sat</span><span>Sun</span>
        </div>
        <div class="point-activity-calendar-grid">
            ${cells.join('')}
        </div>
        ${renderDayDetails()}
    `;
    window.hydrateIcons?.(pointActivityCalendar);
}

function isInAppChore() {
    return String(currentRule?.ruleKind || '') === 'in_app_chore';
}

function renderActivityLog() {
    if (!pointActivityLogPanel || !pointActivityLog) return;
    if (isInAppChore()) {
        pointActivityLogPanel.classList.add('hidden');
        pointActivityLog.innerHTML = '';
        return;
    }

    pointActivityLogPanel.classList.remove('hidden');
    const query = activityLogQuery.trim().toLocaleLowerCase();
    const events = visibleEvents()
        .filter((event) => {
            const note = String(event?.note || '').trim();
            if (!note) return false;
            return !query || note.toLocaleLowerCase().includes(query);
        })
        .sort((a, b) => parseDate(b?.createdAt).getTime() - parseDate(a?.createdAt).getTime());
    const allCount = visibleEvents().length;

    pointActivityLog.innerHTML = `
        <div class="point-activity-log-head">
            <h2 class="paradigm-panel-title">
                <span class="paradigm-panel-title-icon"><span class="icon" data-icon="clipboard-list" data-icon-size="20" data-icon-stroke="2.4" aria-hidden="true"></span></span>
                <span class="paradigm-panel-heading">Note Log</span>
            </h2>
            <div class="point-activity-log-tools">
                <label class="point-activity-log-search">
                    <span class="icon" data-icon="search" data-icon-size="16" data-icon-stroke="2.4" aria-hidden="true"></span>
                    <input type="search" data-activity-log-search value="${escapeHtml(activityLogQuery)}" placeholder="Search notes" aria-label="Search parent notes">
                </label>
            </div>
        </div>
        <div class="point-activity-log-list">
            ${events.length ? events.map((event) => {
                const kid = event?.kid || {};
                const note = String(event?.note || '').trim();
                return `
                    <article class="point-activity-log-row" style="--kid-color: ${escapeHtml(colorForKid(kid))}">
                        <time class="point-activity-log-time" datetime="${escapeHtml(event?.createdAt || '')}">
                            <span class="point-activity-log-date">${escapeHtml(logDateLabel(event?.createdAt))}</span>
                            <span class="point-activity-log-clock">${escapeHtml(timeLabel(event?.createdAt))}</span>
                        </time>
                        <span class="point-activity-log-name">${escapeHtml(kid?.name || 'Kid')}</span>
                        <span class="point-activity-log-note">${escapeHtml(note || '-')}</span>
                        <span class="point-rule-delta paradigm-pill ${escapeHtml(pointPillClass(currentRule || event?.rule || {}))}">${escapeHtml(formatSignedPoints(event?.pointsDelta))}</span>
                    </article>
                `;
            }).join('') : `
                <div class="point-activity-log-empty">${escapeHtml(query ? 'No parent notes match your search.' : (allCount ? 'No parent notes yet.' : 'No activity logged yet.'))}</div>
            `}
        </div>
    `;
    window.hydrateIcons?.(pointActivityLog);
}

function render() {
    renderHero();
    renderCalendar();
    renderProgressPanel();
    renderActivityLog();
    window.hydrateIcons?.(document);
}

function resolveCurrentRule(rules) {
    currentRule = (Array.isArray(rules) ? rules : [])
        .find((rule) => String(rule?.ruleId || '') === requestedRuleId)
        || allActivityEvents().find((event) => isSameRule(event))?.rule
        || null;
}

async function loadInitialData() {
    if (!requestedRuleId) {
        showError('Missing point activity.');
        return;
    }
    showError('');
    const [loadedKids, ruleData] = await Promise.all([
        fetchJson(`${API_BASE}/kids?view=reward_nav`),
        fetchJson(`${API_BASE}/points/rules?includeInactive=1`),
    ]);
    kids = loadedKids;
    const entries = await Promise.all(kids.map(async (kid) => [
        String(kid.id),
        await fetchJson(`${API_BASE}/kids/${encodeURIComponent(kid.id)}/points?limit=${POINT_ACTIVITY_HISTORY_LIMIT}`),
    ]));
    pointDataByKid = new Map(entries);
    resolveCurrentRule(ruleData?.rules);
    if (isInAppChore()) {
        const reportEntries = await Promise.all(kids.map(async (kid) => [
            String(kid.id),
            await fetchJson(`${API_BASE}/kids/${encodeURIComponent(kid.id)}/report`),
        ]));
        reportDataByKid = new Map(reportEntries);
        const progressEntries = await Promise.all(kids.map(async (kid) => {
            try {
                return [String(kid.id), await fetchJson(progressDataUrl(kid.id))];
            } catch (error) {
                console.warn('Failed to load point activity progress data:', kid?.id, error);
                return [String(kid.id), { daily_progress_rows: [], family_timezone: familyTimezone() }];
            }
        }));
        progressDataByKid = new Map(progressEntries);
    }
    render();
}

pointActivityHero?.addEventListener('click', (event) => {
    const kidButton = event.target.closest('[data-point-filter-kid]');
    if (kidButton && pointActivityHero.contains(kidButton)) {
        const nextKidId = String(kidButton.dataset.pointFilterKid || '');
        selectedKidId = selectedKidId === nextKidId ? '' : nextKidId;
        selectedCalendarDayKey = '';
        render();
        return;
    }
    const combinedButton = event.target.closest('[data-point-filter="combined"]');
    if (combinedButton && pointActivityHero.contains(combinedButton)) {
        selectedKidId = '';
        selectedCalendarDayKey = '';
        render();
    }
});

pointActivityCalendar?.addEventListener('click', (event) => {
    const dayButton = event.target.closest('[data-calendar-day]');
    if (dayButton && pointActivityCalendar.contains(dayButton)) {
        selectedCalendarDayKey = String(dayButton.dataset.calendarDay || '');
        renderCalendar();
        return;
    }
    const button = event.target.closest('[data-calendar-month]');
    if (!button || !pointActivityCalendar.contains(button)) return;
    displayedMonthKey = addMonths(displayedMonthKey, button.dataset.calendarMonth || 0);
    selectedCalendarDayKey = '';
    render();
});

pointActivityProgress?.addEventListener('click', (event) => {
    const periodBtn = event.target.closest('[data-progress-period-days]');
    if (periodBtn && pointActivityProgress.contains(periodBtn)) {
        currentProgressViewDays = Number(periodBtn.dataset.progressPeriodDays) || 0;
        renderProgressPanel();
        return;
    }
    const metricBtn = event.target.closest('[data-progress-metric]');
    if (metricBtn && pointActivityProgress.contains(metricBtn)) {
        currentProgressMetric = String(metricBtn.dataset.progressMetric || '') === 'correctness' ? 'correctness' : 'speed';
        try { localStorage.setItem('pointActivityReport.progressMetric', currentProgressMetric); } catch (_err) {}
        renderProgressPanel();
    }
});

pointActivityLog?.addEventListener('input', (event) => {
    const input = event.target.closest('[data-activity-log-search]');
    if (!input || !pointActivityLog.contains(input)) return;
    activityLogQuery = String(input.value || '');
    renderActivityLog();
    pointActivityLog.querySelector('[data-activity-log-search]')?.focus();
});

loadInitialData().catch((error) => {
    showError(error.message || 'Failed to load point activity history.');
});
