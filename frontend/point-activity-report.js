const API_BASE = `${window.location.origin}/api`;
const POINT_ACTIVITY_HISTORY_LIMIT = 5000;

const params = new URLSearchParams(window.location.search);
const requestedRuleId = String(params.get('ruleId') || '').trim();
const requestedCategoryKey = normalizeCategoryKey(params.get('categoryKey'));
const requestedCategoryName = String(params.get('categoryName') || '').trim();
const requestedMonthKey = /^\d{4}-(0[1-9]|1[0-2])$/.test(String(params.get('month') || '')) ? String(params.get('month')) : '';
const EARNING_RULE_KINDS = ['in_app_chore', 'off_app_chore', 'bonus_event'];
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
let sessionDetailByKey = new Map();
let ruleActivityCounts = {};
let allInAppSubjectRules = [];
let selectedKidId = '';
let selectedAllInAppSubjectKey = '';
let selectedAllOffAppRuleKind = '';
let currentRule = null;
let isRuleEditing = false;
let displayedMonthKey = requestedMonthKey;
let selectedCalendarDayKey = '';
let activityLogQuery = '';
let currentCalendarMetric = (() => {
    try {
        const stored = localStorage.getItem('pointActivityReport.calendarMetric');
        return ['minutes', 'cards', 'points', 'count'].includes(stored) ? stored : 'minutes';
    } catch (_err) {
        return 'minutes';
    }
})();
let currentProgressMetric = (() => {
    try {
        return localStorage.getItem('pointActivityReport.progressMetric') === 'correctness' ? 'correctness' : 'speed';
    } catch (_err) {
        return 'speed';
    }
})();

function isAllInAppMode() {
    return requestedRuleId === '0';
}

function isAllOffAppMode() {
    return ['-2', '-3', '-4'].includes(requestedRuleId);
}

function aggregateActivityConfig() {
    if (requestedRuleId === '-3') {
        return { name: 'All losses', ruleKind: 'all_loss_activity', icon: 'thumbs-down', tone: 'loss', ruleKinds: ['deduction_event'] };
    }
    if (requestedRuleId === '-4') {
        return { name: 'All redeemed rewards', ruleKind: 'all_redeem_activity', icon: 'gift', tone: 'redeem', ruleKinds: ['redeemed_reward'] };
    }
    return { name: 'All earned', ruleKind: 'all_earn_activity', icon: 'thumbs-up', tone: 'earn', ruleKinds: EARNING_RULE_KINDS };
}

function isAllEarningMode() {
    return isAllOffAppMode() && aggregateActivityConfig().tone === 'earn';
}

function isAllLossMode() {
    return isAllOffAppMode() && aggregateActivityConfig().tone === 'loss';
}

function isAllRedeemMode() {
    return isAllOffAppMode() && aggregateActivityConfig().tone === 'redeem';
}

function isCategoryInAppMode() {
    return Boolean(requestedCategoryKey) && !isAllInAppMode() && !isAllOffAppMode();
}

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

function formatCardsPerPoint(value) {
    const number = Number.parseInt(value, 10) || 0;
    return `${number.toLocaleString()} cards per point`;
}

function formatSignedPoints(value) {
    const number = Number.parseInt(value, 10) || 0;
    return `${number >= 0 ? '+' : ''}${number.toLocaleString()} pts`;
}

function isKidUserMode() {
    if (window.KidAppNavigation?.getMode) {
        return window.KidAppNavigation.getMode() === 'kid';
    }
    return window.FamilyUserSwitcher?.currentUser?.().mode === 'kid';
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

function isSameRule(event) {
    if (!requestedRuleId || isAllInAppMode()) return false;
    if (isAllOffAppMode()) {
        const ruleKind = String(event?.rule?.ruleKind || '').trim();
        const config = aggregateActivityConfig();
        const selectedKind = isAllEarningMode() ? selectedAllOffAppRuleKind : '';
        return config.ruleKinds.includes(ruleKind) && (!selectedKind || ruleKind === selectedKind);
    }
    return String(event?.rule?.ruleId || event?.ruleId || '') === requestedRuleId;
}

function allActivityEvents() {
    return kids.flatMap((kid) => {
        const data = pointDataByKid.get(String(kid.id)) || {};
        const events = Array.isArray(data.events) ? data.events : [];
        return events.map((event) => ({ ...event, kid })).filter(isSameRule);
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

function shortDateLabel(dayKeyValue) {
    const date = dateFromDayKey(dayKeyValue);
    return date ? date.toLocaleDateString([], { timeZone: 'UTC', month: 'short', day: 'numeric' }) : '';
}

function dayDetailLabel(dayKeyValue) {
    const date = dateFromDayKey(dayKeyValue);
    return date ? date.toLocaleDateString([], {
        timeZone: 'UTC',
        weekday: 'short',
        month: 'long',
        day: 'numeric',
        year: 'numeric',
    }) : '';
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
    if (isAllInAppMode() && selectedAllInAppSubjectKey) return selectedAllInAppSubjectKey;
    if (isCategoryInAppMode()) return requestedCategoryKey;
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
    if (!Number.isFinite(minutes) || minutes <= 0) return '0';
    return Math.ceil(minutes).toLocaleString();
}

function formatSessionCount(value) {
    const count = Number.parseInt(value, 10) || 0;
    return `${count.toLocaleString()} ${count === 1 ? 'session' : 'sessions'}`;
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

async function loadProgressData() {
    const progressEntries = await Promise.all(kids.map(async (kid) => {
        try {
            return [String(kid.id), await fetchJson(progressDataUrl(kid.id))];
        } catch (error) {
            console.warn('Failed to load point activity progress data:', kid?.id, error);
            return [String(kid.id), { daily_progress_points: [], family_timezone: familyTimezone() }];
        }
    }));
    progressDataByKid = new Map(progressEntries);
}

function visibleProgressPoints() {
    const selectedIds = selectedKidId
        ? [selectedKidId]
        : kids.map((kid) => String(kid.id));
    const byDate = new Map();
    selectedIds.forEach((kidId) => {
        const data = progressDataByKid.get(String(kidId)) || {};
        const points = Array.isArray(data.daily_progress_points) ? data.daily_progress_points : [];
        points.forEach((point) => {
            const date = String(point?.date || '').trim();
            if (!date) return;
            const combined = byDate.get(date) || {
                date,
                practiced: 0,
                learned: 0,
                cumulative_correct_response_time_ms_sum: 0,
                cumulative_correct_response_time_count: 0,
                cumulative_attempts: 0,
                cumulative_correct: 0,
            };
            combined.practiced += Math.max(0, Number.parseInt(point?.practiced, 10) || 0);
            combined.learned += Math.max(0, Number.parseInt(point?.learned, 10) || 0);
            combined.cumulative_correct_response_time_ms_sum += Math.max(0, Number.parseInt(point?.cumulative_correct_response_time_ms_sum, 10) || 0);
            combined.cumulative_correct_response_time_count += Math.max(0, Number.parseInt(point?.cumulative_correct_response_time_count, 10) || 0);
            combined.cumulative_attempts += Math.max(0, Number.parseInt(point?.cumulative_attempts, 10) || 0);
            combined.cumulative_correct += Math.max(0, Number.parseInt(point?.cumulative_correct, 10) || 0);
            byDate.set(date, combined);
        });
    });
    return Array.from(byDate.values()).sort((left, right) => left.date.localeCompare(right.date));
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
        return window.subjectIcon(triggerKey, { size: 36 });
    }
    return escapeHtml(rule?.emoji || '+');
}

function allInAppIconHtml() {
    return '<span class="point-activity-all-in-app-icon" aria-hidden="true">ALL</span>';
}

function aggregateActivityIconHtml() {
    return '<span class="point-activity-all-in-app-icon" aria-hidden="true">ALL</span>';
}

function allInAppSubjectFilterHtml() {
    if (!isAllInAppMode()) return '';
    const filters = allInAppSubjectRules.map((rule) => {
            const key = normalizeCategoryKey(rule?.triggerKey);
            if (!key) return '';
            const label = String(rule?.name || key).trim();
            const icon = typeof window.subjectIcon === 'function'
                ? window.subjectIcon(key, { size: 32 })
                : escapeHtml(rule?.emoji || '+');
            return `<button type="button" class="point-activity-subject-filter${selectedAllInAppSubjectKey === key ? ' active' : ''}" data-all-in-app-subject="${escapeHtml(key)}" aria-label="${escapeHtml(label)}" title="${escapeHtml(label)}">${icon}</button>`;
        }).join('');
    return `<div class="point-activity-subject-filters" role="group" aria-label="Subject filter">${filters}</div>`;
}

function allOffAppTypeFilterHtml() {
    if (!isAllEarningMode()) return '';
    const types = [
        { key: 'in_app_chore', label: 'In-app', icon: 'smartphone' },
        { key: 'off_app_chore', label: 'Off-app chores', icon: 'clipboard-check' },
        { key: 'bonus_event', label: 'Bonus', icon: 'thumbs-up' },
    ];
    const filters = types.map((type) => {
            const icon = typeof window.icon === 'function'
                ? window.icon(type.icon, { size: 22, strokeWidth: 2.4 })
                : `<span class="icon" data-icon="${escapeHtml(type.icon)}" data-icon-size="22" data-icon-stroke="2.4"></span>`;
            return `<button type="button" class="point-activity-subject-filter point-activity-off-app-type-filter${selectedAllOffAppRuleKind === type.key ? ' active' : ''}" data-all-off-app-type="${escapeHtml(type.key)}" aria-label="${escapeHtml(type.label)}" title="${escapeHtml(type.label)}"><span class="point-activity-off-app-type-icon is-${escapeHtml(type.key)}">${icon}</span></button>`;
        }).join('');
    return `<div class="point-activity-subject-filters" role="group" aria-label="Earned activity filter">${filters}</div>`;
}

function buildInAppCardManageHref(rule) {
    const categoryKey = String(rule?.triggerKey || '').trim();
    if (!categoryKey) return '';
    const kidId = selectedKidId
        || String(window.KidAppNavigation?.getKidId?.() || '').trim()
        || String(kids[0]?.id || '').trim();
    const query = new URLSearchParams({ categoryKey });
    if (kidId) query.set('id', kidId);
    return `/kid-card-manage.html?${query.toString()}`;
}

function typeBadge(rule) {
    const ruleKind = String(rule?.ruleKind || '').trim();
    if (isAllInAppMode()) {
        return { label: 'All in-app', icon: 'thumbs-up', tone: 'earn' };
    }
    if (isAllOffAppMode() && Number(rule?.ruleId) < 0) {
        const config = aggregateActivityConfig();
        return { label: config.name, icon: config.icon, tone: config.tone };
    }
    if (ruleKind === 'deduction_event') {
        return { label: 'Loss', icon: 'thumbs-down', tone: 'loss' };
    }
    if (ruleKind === 'redeemed_reward') {
        return { label: 'Redeem', icon: 'gift', tone: 'redeem' };
    }
    if (ruleKind === 'in_app_chore') {
        return { label: 'In-app', icon: 'thumbs-up', tone: 'earn' };
    }
    if (ruleKind === 'off_app_chore') {
        return { label: 'Off-app', icon: 'thumbs-up', tone: 'earn' };
    }
    return { label: 'Bonus', icon: 'thumbs-up', tone: 'earn' };
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

function kidFilterControlsHtml(allEvents) {
    const kidsHtml = `
        <div class="point-activity-kids">
            ${kids.map((kid) => {
                    const kidEvents = allEvents.filter((event) => String(event?.kid?.id || '') === String(kid.id));
                    const sessionTotals = sessionTotalsForKid(kid.id);
                    const sessionCardTotal = sessionCardTotalForKid(kid.id);
                    return `
                        <button type="button" class="point-activity-kid-card${selectedKidId === String(kid.id) ? ' active' : ''}" data-point-filter-kid="${escapeHtml(kid.id)}" style="--kid-color: ${escapeHtml(colorForKid(kid))}">
                            ${avatarHtml(kid)}
                            <span>
                                <span class="point-activity-kid-name">${escapeHtml(kid.name || 'Kid')}</span>
                                <span class="point-activity-kid-points">${escapeHtml(isSessionsMetricView() ? formatActiveMinutes(sessionTotals.activeMinutes) : formatPoints(pointTotal(kidEvents)))}</span>
                                ${isSessionsMetricView()
                                    ? `<span class="point-activity-kid-count point-activity-kid-count--sessions"><span>${escapeHtml(formatSessionCount(sessionTotals.count))}</span><span>${escapeHtml(`${sessionCardTotal.toLocaleString()} ${sessionCardTotal === 1 ? 'card' : 'cards'}`)}</span></span>`
                                    : `<span class="point-activity-kid-count">${escapeHtml(`${kidEvents.length} ${kidEvents.length === 1 ? 'time' : 'times'}`)}</span>`}
                            </span>
                        </button>
                    `;
            }).join('')}
        </div>
    `;
    return { kidsHtml };
}

function renderHero() {
    const heroPanel = pointActivityHero?.closest('.paradigm-settings-panel');
    heroPanel?.classList.remove('hidden');
    const allEvents = allActivityEvents();
    const events = visibleEvents();
    const rule = currentRule || {};
    const title = String(rule.name || 'Point activity').trim();
    const hasEditableRule = Number.parseInt(rule.ruleId, 10) > 0;
    const isAggregateMode = isAllInAppMode() || isAllOffAppMode();
    const canEditRule = !isKidUserMode() && !isAggregateMode && hasEditableRule;
    const isEditingRule = isRuleEditing && canEditRule;
    const isInAppRule = String(rule.ruleKind || '') === 'in_app_chore';
    const ruleActivityCount = Number.parseInt(ruleActivityCounts[String(rule.ruleId || requestedRuleId)] ?? 0, 10) || 0;
    const canDeleteRule = ruleActivityCount === 0;
    const aggregateFiltersHtml = isAllInAppMode()
        ? allInAppSubjectFilterHtml()
        : (isAllEarningMode() ? allOffAppTypeFilterHtml() : '');
    const ruleTitleHtml = (isAllInAppMode() || isAllEarningMode() || isAllLossMode() || isAllRedeemMode())
        ? ''
        : isEditingRule && !isInAppRule
        ? `<input class="point-activity-title-edit" data-rule-edit-name value="${escapeHtml(title)}" aria-label="Rule name">`
        : `<h2 class="point-activity-title">${escapeHtml(title)}</h2>`;
    const heroIconHtml = isAllInAppMode()
        ? allInAppIconHtml()
        : isAllOffAppMode()
        ? aggregateActivityIconHtml()
        : isEditingRule && !isInAppRule
        ? `<input class="point-activity-emoji-edit" data-rule-edit-emoji value="${escapeHtml(rule.emoji || '')}" aria-label="Rule emoji" maxlength="8">`
        : iconHtml(rule);
    const inAppManageHref = isInAppRule && !isAllInAppMode() ? buildInAppCardManageHref(rule) : '';
    const aggregateIconToneClass = isAllOffAppMode() ? ` point-activity-icon--${aggregateActivityConfig().tone}` : '';
    const heroIconContainerHtml = isAggregateMode && aggregateFiltersHtml
        ? `<button type="button" class="point-activity-icon point-activity-icon--in-app point-activity-icon--all-in-app${aggregateIconToneClass}" data-aggregate-filter-reset aria-label="Show all activity" title="Show all">${heroIconHtml}</button>`
        : isAggregateMode
        ? ''
        : inAppManageHref
        ? `<a class="point-activity-icon point-activity-icon--in-app" href="${escapeHtml(inAppManageHref)}" aria-label="Manage cards for ${escapeHtml(title)}" title="Manage cards">${heroIconHtml}</a>`
        : `<div class="point-activity-icon${isEditingRule && !isInAppRule ? ' point-activity-icon--editing' : ''}"${isEditingRule && !isInAppRule ? '' : ' aria-hidden="true"'}>${heroIconHtml}</div>`;
    const ruleMetaHtml = isAggregateMode
        ? ''
        : isEditingRule
        ? `
            <span class="point-activity-rule-meta point-activity-rule-meta--editing">
                <input class="point-activity-points-edit" data-rule-edit-points type="number" min="1" step="1" value="${rule.maxPoint == null ? '' : escapeHtml(rule.maxPoint)}" aria-label="${isInAppRule ? 'Cards per point' : 'Default points'}">
                <span>${isInAppRule ? 'cards / pt' : 'pts'}</span>
                ${isInAppRule ? '' : `
                    <label class="point-activity-rule-status-editor">
                        <input data-rule-edit-active type="checkbox" ${rule.isActive ? 'checked' : ''}>
                        <span>Active</span>
                    </label>
                `}
            </span>
        `
        : `
            <span class="point-activity-rule-meta">
                <span>${escapeHtml(isInAppRule ? formatCardsPerPoint(rule.maxPoint) : formatPoints(rule.maxPoint))}</span>
                ${isInAppRule ? '' : `<span class="point-activity-rule-status">${rule.isActive ? 'Active' : 'Inactive'}</span>`}
            </span>
        `;
    const ruleEditActionsHtml = isEditingRule
        ? `
            <span class="point-activity-rule-edit-actions paradigm-edit-actions">
                ${canDeleteRule ? `<button type="button" class="paradigm-edit-action paradigm-edit-action--delete" data-rule-edit-action="delete" aria-label="Delete rule" title="Delete rule"><span class="icon" data-icon="trash" data-icon-size="15" data-icon-stroke="2.4" aria-hidden="true"></span></button>` : ''}
                <button type="button" class="paradigm-edit-action paradigm-edit-action--cancel" data-rule-edit-action="cancel">Cancel</button>
                <button type="button" class="paradigm-edit-action paradigm-edit-action--confirm" data-rule-edit-action="save">Confirm</button>
            </span>
        `
        : '';
    const ruleStartEditHtml = !canEditRule || isEditingRule
        ? ''
        : `<button type="button" class="point-activity-rules-link" data-rule-edit-action="start" aria-label="Edit point rule" title="Edit rule"><span class="icon" data-icon="pencil" data-icon-size="14" data-icon-stroke="2.5" aria-hidden="true"></span></button>`;
    const filters = kidFilterControlsHtml(allEvents);
    const heroPrimaryHtml = isAggregateMode
        ? aggregateFiltersHtml
        : `${ruleTitleHtml}${typeBadgeHtml(rule)}${ruleStartEditHtml}<span class="point-activity-rule-detail-row">${ruleMetaHtml}${ruleEditActionsHtml}</span>`;
    const heroTopClass = `point-activity-hero-top${heroIconContainerHtml ? '' : ' point-activity-hero-top--without-icon'}`;
    if (pageTitle) pageTitle.textContent = title;
    document.title = `${title} - Point Activity History - The Mommy App`;

    pointActivityHero.innerHTML = `
        <div class="point-activity-hero">
            <div class="${heroTopClass}">
                ${heroIconContainerHtml}
                <div class="point-activity-main">
                    ${heroPrimaryHtml ? `<div class="point-activity-title-row">${heroPrimaryHtml}</div>` : ''}
                </div>
                ${filters.kidsHtml}
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

function calendarEventCountsByDay(events) {
    const timezone = familyTimezone();
    const counts = new Map();
    events.forEach((event) => {
        const key = dayKey(parseDate(event?.createdAt), timezone);
        if (!key || key.slice(0, 7) !== displayedMonthKey) return;
        counts.set(key, (counts.get(key) || 0) + 1);
    });
    return counts;
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

function calendarCellHtml(dayNumber, totals, noteDays, maxTotal, eventCounts = new Map()) {
    const key = `${displayedMonthKey}-${String(dayNumber).padStart(2, '0')}`;
    const isToday = key === getTodayDateKeyInTimezone(familyTimezone());
    const hasTotal = totals.has(key);
    const hasNote = noteDays.has(key);
    const isSessionCalendar = isInAppChore();
    const total = totals.get(key) || (isSessionCalendar ? { minutes: 0, count: 0, cards: 0, wrong: 0 } : 0);
    const minutes = isSessionCalendar ? Number(total.minutes) || 0 : 0;
    const sessionCount = isSessionCalendar ? Number.parseInt(total.count, 10) || 0 : 0;
    const cardCount = isSessionCalendar ? Number.parseInt(total.cards, 10) || 0 : 0;
    const wrongCount = isSessionCalendar ? Number.parseInt(total.wrong, 10) || 0 : 0;
    const pointTotalValue = isSessionCalendar ? 0 : Number(total) || 0;
    const eventCount = isSessionCalendar ? 0 : Number(eventCounts.get(key)) || 0;
    const showingCards = isSessionCalendar && currentCalendarMetric === 'cards';
    const showingCount = !isSessionCalendar && currentCalendarMetric === 'count';
    const sessionMetric = showingCards ? cardCount : minutes;
    const metricTotal = isSessionCalendar ? sessionMetric : (showingCount ? eventCount : pointTotalValue);
    const level = calendarLevel(metricTotal, maxTotal);
    const calendarTone = isAllOffAppMode()
        ? (selectedAllOffAppRuleKind
            ? typeBadge({ ruleKind: selectedAllOffAppRuleKind }).tone
            : aggregateActivityConfig().tone)
        : typeBadge(currentRule || {}).tone;
    const canSelect = isSessionCalendar
        ? sessionCount > 0
        : (showingCount ? eventCount > 0 : (isAllOffAppMode() ? hasTotal : Math.abs(pointTotalValue) > 0));
    const tagName = canSelect ? 'button' : 'div';
    const ariaMetric = isSessionCalendar
        ? `${formatCalendarMinutes(minutes)} minutes, ${cardCount.toLocaleString()} cards`
        : (showingCount
            ? `${eventCount.toLocaleString()} activities`
            : `${isAllOffAppMode() ? formatSignedPoints(pointTotalValue) : `${Math.abs(pointTotalValue).toLocaleString()} points`}`);
    const attrs = canSelect
        ? `type="button" data-calendar-day="${escapeHtml(key)}" aria-label="${escapeHtml(`${shortDateLabel(key)} ${ariaMetric}`)}"`
        : '';
    return `
        <${tagName} class="point-activity-day${hasTotal ? ` has-total level-${level}` : ''}${hasNote ? ' has-note' : ''}${isToday ? ' is-today' : ''}${selectedCalendarDayKey === key ? ' active' : ''} tone-${escapeHtml(calendarTone)}" ${attrs}>
            <span class="point-activity-day-number">${dayNumber}</span>
            <span class="point-activity-day-metrics${isSessionCalendar ? ' point-activity-day-metrics--session' : ''}">
                <span class="point-activity-day-total">${hasTotal ? escapeHtml(isSessionCalendar ? (showingCards ? cardCount.toLocaleString() : formatCalendarMinutes(minutes)) : (showingCount ? eventCount.toLocaleString() : (isAllOffAppMode() ? `${pointTotalValue >= 0 ? '+' : ''}${pointTotalValue.toLocaleString()}` : Math.abs(pointTotalValue).toLocaleString()))) : '0'}</span>
                <span class="point-activity-day-unit">${isSessionCalendar ? (showingCards ? 'cards' : 'min') : (showingCount ? 'times' : 'pts')}</span>
            </span>
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

function pointHistoryDestinationHref(event) {
    const kidId = String(event?.kid?.id || '').trim();
    const eventId = Number.parseInt(event?.eventId, 10);
    const day = dayKey(parseDate(event?.createdAt), familyTimezone());
    if (!kidId || !(eventId > 0) || !day) return '';
    const query = new URLSearchParams({ day, eventId: String(eventId) });
    if (isKidUserMode()) {
        query.set('id', kidId);
        return `/kid-rewards.html?${query.toString()}`;
    }
    query.set('kidId', kidId);
    return `/point-log.html?${query.toString()}`;
}

function sessionsForSelectedDay() {
    if (!selectedCalendarDayKey) return [];
    return visibleSessions()
        .filter((session) => dayKey(parseDate(session?.started_at || session?.completed_at), familyTimezone()) === selectedCalendarDayKey)
        .sort((a, b) => parseDate(a?.started_at || a?.completed_at).getTime() - parseDate(b?.started_at || b?.completed_at).getTime());
}

function selectTodayWhenItHasActivity() {
    const todayKey = getTodayDateKeyInTimezone(familyTimezone());
    if (!todayKey) return false;
    const hasActivity = isInAppChore()
        ? visibleSessions().some((session) => dayKey(parseDate(session?.started_at || session?.completed_at), familyTimezone()) === todayKey)
        : visibleEvents().some((event) => dayKey(parseDate(event?.createdAt), familyTimezone()) === todayKey);
    if (!hasActivity) return false;
    selectedCalendarDayKey = todayKey;
    displayedMonthKey = todayKey.slice(0, 7);
    return true;
}

function sessionDetailKey(session) {
    const kidId = String(session?.kidId || session?.kid?.id || '').trim();
    const sessionId = String(session?.id || '').trim();
    return kidId && sessionId ? `${kidId}:${sessionId}` : '';
}

function nonGreenSessionCards(session) {
    const detail = sessionDetailByKey.get(sessionDetailKey(session));
    const answers = Array.isArray(detail?.answers) ? detail.answers : [];
    return answers
        .filter((answer) => Number(answer?.correct_score) !== 1)
        .map((answer) => String(answer?.materialized_prompt || answer?.front || answer?.back || '').trim())
        .filter(Boolean);
}

function sessionSubjectIconHtml(session) {
    const categoryKey = normalizeCategoryKey(session?.type);
    if (!categoryKey || typeof window.subjectIcon !== 'function') return '';
    return `<span class="point-activity-event-subject-icon" aria-hidden="true">${window.subjectIcon(categoryKey, { size: 18 })}</span>`;
}

function eventRuleIconHtml(event) {
    const rule = event?.rule || currentRule || {};
    const ruleKind = String(rule?.ruleKind || '').trim();
    const triggerKey = normalizeCategoryKey(rule?.triggerKey);
    if (ruleKind === 'in_app_chore' && triggerKey && typeof window.subjectIcon === 'function') {
        return `<span class="point-activity-event-subject-icon" aria-hidden="true">${window.subjectIcon(triggerKey, { size: 18 })}</span>`;
    }
    const iconName = ruleKind === 'deduction_event'
        ? 'thumbs-down'
        : (ruleKind === 'redeemed_reward' ? 'gift' : 'thumbs-up');
    const iconMarkup = String(rule?.emoji || '').trim()
        ? escapeHtml(rule.emoji)
        : (typeof window.icon === 'function'
            ? window.icon(iconName, { size: 16, strokeWidth: 2.5 })
            : `<span class="icon" data-icon="${escapeHtml(iconName)}" data-icon-size="16" data-icon-stroke="2.5"></span>`);
    return `<span class="point-activity-event-rule-icon tone-${escapeHtml(typeBadge(rule).tone)}" aria-hidden="true">${iconMarkup}</span>`;
}

function activityRowLeadHtml({ time, kid, subjectIconHtml }) {
    return `
        <span class="point-activity-event-time">${escapeHtml(time)}</span>
        ${avatarHtml(kid)}
        <span class="point-activity-event-subject-column">${subjectIconHtml}</span>
    `;
}

async function loadSelectedSessionDetails() {
    const missingSessions = sessionsForSelectedDay().filter((session) => {
        const key = sessionDetailKey(session);
        return key && !sessionDetailByKey.has(key);
    });
    if (!missingSessions.length) return;
    await Promise.all(missingSessions.map(async (session) => {
        const key = sessionDetailKey(session);
        try {
            const detail = await fetchJson(`${API_BASE}/kids/${encodeURIComponent(session.kidId)}/report/sessions/${encodeURIComponent(session.id)}`);
            sessionDetailByKey.set(key, detail);
        } catch (error) {
            console.warn('Failed to load session cards for point activity:', session?.kidId, session?.id, error);
            sessionDetailByKey.set(key, { answers: [] });
        }
    }));
}

function renderDayDetails() {
    if (isInAppChore()) return renderSessionDayDetails();
    const events = eventsForSelectedDay();
    if (!selectedCalendarDayKey || !events.length) return '';
    return `
        <div class="point-activity-day-detail">
            <div class="point-activity-day-detail-date">${escapeHtml(dayDetailLabel(selectedCalendarDayKey))}</div>
            <div class="point-activity-day-detail-list">
                ${events.map((event) => {
                    const kid = event?.kid || {};
                    const note = String(event?.note || '').trim();
                    const historyHref = pointHistoryDestinationHref(event);
                    const tagName = historyHref ? 'a' : 'div';
                    const hrefAttr = historyHref ? ` href="${escapeHtml(historyHref)}"` : '';
                    return `
                        <${tagName}${hrefAttr} class="point-activity-event-row point-activity-event-row--event point-activity-event-row--has-subject${historyHref ? ' point-activity-event-row-link' : ''}" style="--kid-color: ${escapeHtml(colorForKid(kid))}">
                            ${activityRowLeadHtml({ time: timeLabel(event?.createdAt), kid, subjectIconHtml: eventRuleIconHtml(event) })}
                            <span class="point-activity-event-note">${escapeHtml(note || '-')}</span>
                            <span class="point-activity-event-points point-rule-delta paradigm-pill ${escapeHtml(pointPillClass(isAllOffAppMode() ? event?.rule : (currentRule || event?.rule || {})))}">${escapeHtml(formatSignedPoints(event?.pointsDelta))}</span>
                        </${tagName}>
                    `;
                }).join('')}
            </div>
        </div>
    `;
}

function monthlyTopRules() {
    if (!isAllOffAppMode()) return [];
    const timezone = familyTimezone();
    const rankedRules = new Map();
    visibleEvents().forEach((event) => {
        if (dayKey(parseDate(event?.createdAt), timezone).slice(0, 7) !== displayedMonthKey) return;
        const rule = event?.rule || {};
        const ruleId = Number.parseInt(rule?.ruleId || event?.ruleId, 10);
        if (!(ruleId > 0)) return;
        const current = rankedRules.get(ruleId) || { rule, total: 0, count: 0 };
        current.total += Math.abs(Number.parseInt(event?.pointsDelta, 10) || 0);
        current.count += 1;
        rankedRules.set(ruleId, current);
    });
    return [...rankedRules.entries()]
        .map(([ruleId, entry]) => ({ ...entry, ruleId }))
        .sort((a, b) => b.total - a.total || b.count - a.count || String(a.rule?.name || '').localeCompare(String(b.rule?.name || '')))
        .slice(0, 3);
}

function monthlyTopRulesHtml() {
    const rankedRules = monthlyTopRules();
    const config = aggregateActivityConfig();
    const label = config.tone === 'loss' ? 'lost' : (config.tone === 'redeem' ? 'spent' : 'earned');
    return `
        <section class="point-activity-monthly-top" aria-label="Monthly top three">
            <div class="point-activity-monthly-top-head">
                <span class="point-activity-monthly-top-title"><span class="icon" data-icon="crown" data-icon-size="17" data-icon-stroke="2.5" aria-hidden="true"></span>Top 3</span>
            </div>
            <div class="point-activity-monthly-top-list">
                ${rankedRules.length ? rankedRules.map((entry, index) => {
                    const rule = entry.rule || {};
                    const name = String(rule.name || 'Point activity').trim() || 'Point activity';
                    const icon = eventRuleIconHtml({ rule });
                    const reportQuery = new URLSearchParams({ ruleId: String(entry.ruleId), month: displayedMonthKey });
                    return `
                        <a class="point-activity-monthly-top-item tone-${escapeHtml(typeBadge(rule).tone)}" href="/point-activity-report.html?${escapeHtml(reportQuery.toString())}" aria-label="Open ${escapeHtml(name)} activity report">
                            <span class="point-activity-monthly-top-rank">${index + 1}</span>
                            <span class="point-activity-monthly-top-icon">${icon}</span>
                            <span class="point-activity-monthly-top-name">${escapeHtml(name)}</span>
                            <span class="point-activity-monthly-top-points">${escapeHtml(`${entry.total.toLocaleString()} ${label}`)}</span>
                        </a>
                    `;
                }).join('') : '<div class="point-activity-monthly-top-empty">No activity this month.</div>'}
            </div>
        </section>
    `;
}

function monthlyHighlightsHtml(totals) {
    if (isAllOffAppMode()) return '';
    const highlights = monthlyCalendarHighlights(totals);
    const cards = [
        {
            icon: 'calendar',
            label: 'Monthly total',
            value: formatCalendarHighlightValue(highlights.total),
        },
        {
            icon: 'bar-chart-3',
            label: 'Daily avg',
            value: formatCalendarHighlightValue(highlights.dailyAverage),
            tone: 'best',
        },
        {
            icon: 'award',
            label: '',
            valueHtml: highlights.best && highlights.worst
                ? `<span>Best: ${escapeHtml(highlights.best.label)}</span><span>Worst: ${escapeHtml(highlights.worst.label)}</span>`
                : 'No activity',
            tone: 'worst',
        },
    ];
    return `
        <section class="point-activity-monthly-top point-activity-monthly-highlights" aria-label="Monthly highlights">
            <div class="point-activity-monthly-top-head">
                <span class="point-activity-monthly-top-title"><span class="icon" data-icon="sparkles" data-icon-size="17" data-icon-stroke="2.5" aria-hidden="true"></span>Highlights</span>
            </div>
            <div class="point-activity-monthly-top-list point-activity-monthly-highlight-list">
                ${cards.map((card) => `
                    <div class="point-activity-monthly-highlight-item${card.tone ? ` tone-${card.tone}` : ''}${card.label ? '' : ' is-titleless'}">
                        <span class="icon" data-icon="${card.icon}" data-icon-size="14" data-icon-stroke="2.4" aria-hidden="true"></span>
                        ${card.label ? `<span class="point-activity-monthly-highlight-label">${escapeHtml(card.label)}</span>` : ''}
                        <span class="point-activity-monthly-highlight-value">${card.valueHtml || escapeHtml(card.value)}</span>
                    </div>
                `).join('')}
            </div>
        </section>
    `;
}

function monthlyCalendarHighlights(totals) {
    const isSessionCalendar = isInAppChore();
    const metricKey = currentCalendarMetric === 'cards' ? 'cards' : 'minutes';
    const weekdayNames = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    const weekdayStats = weekdayNames.map((label) => ({ label, total: 0, dayCount: 0, hasActivity: false }));
    let total = 0;
    const days = daysInMonth(displayedMonthKey);
    const todayKey = getTodayDateKeyInTimezone(familyTimezone());
    for (let dayNumber = 1; dayNumber <= days; dayNumber += 1) {
        const key = `${displayedMonthKey}-${String(dayNumber).padStart(2, '0')}`;
        const date = dateFromDayKey(key);
        const weekday = date ? weekdayIndexMondayFirst(date) : 0;
        const entry = totals.get(key);
        const value = isSessionCalendar
            ? Number(entry?.[metricKey]) || 0
            : Number(entry) || 0;
        total += value;
        // Daily averages only use fully completed days. Today's result can still change,
        // and future dates must never dilute the average as zero-value denominators.
        if (todayKey && key >= todayKey) continue;
        const stat = weekdayStats[weekday];
        stat.dayCount += 1;
        stat.total += value;
        stat.hasActivity ||= value !== 0;
    }
    const hasAnyActivity = weekdayStats.some((item) => item.hasActivity);
    const ranked = hasAnyActivity
        ? weekdayStats.map((item) => ({ ...item, average: item.total / item.dayCount }))
        : [];
    const completedDayCount = weekdayStats.reduce((sum, item) => sum + item.dayCount, 0);
    const completedTotal = weekdayStats.reduce((sum, item) => sum + item.total, 0);
    return {
        total,
        dailyAverage: completedDayCount ? completedTotal / completedDayCount : 0,
        best: ranked.length ? [...ranked].sort((a, b) => b.average - a.average || a.label.localeCompare(b.label))[0] : null,
        worst: ranked.length ? [...ranked].sort((a, b) => a.average - b.average || a.label.localeCompare(b.label))[0] : null,
    };
}

function formatCalendarHighlightValue(value, isAverage = false) {
    const number = Number(value) || 0;
    const rounded = isAverage && !Number.isInteger(number) ? Math.round(number * 10) / 10 : Math.round(number);
    if (isInAppChore()) {
        return currentCalendarMetric === 'cards'
            ? `${rounded.toLocaleString()} cards${isAverage ? ' / day' : ''}`
            : `${rounded.toLocaleString()} min${isAverage ? ' / day' : ''}`;
    }
    if (currentCalendarMetric === 'count') {
        return `${rounded.toLocaleString()} times${isAverage ? ' / day' : ''}`;
    }
    return `${rounded > 0 ? '+' : ''}${rounded.toLocaleString()} pts${isAverage ? ' / day' : ''}`;
}

function renderSessionDayDetails() {
    const sessions = sessionsForSelectedDay();
    if (!selectedCalendarDayKey || !sessions.length) return '';
    return `
        <div class="point-activity-day-detail">
            <div class="point-activity-day-detail-date">${escapeHtml(dayDetailLabel(selectedCalendarDayKey))}</div>
            <div class="point-activity-day-detail-list">
                ${sessions.map((session) => {
                    const kid = session?.kid || {};
                    const nonGreenCards = nonGreenSessionCards(session);
                    return `
                        <a class="point-activity-event-row point-activity-event-row--session point-activity-event-row--has-subject point-activity-event-row-link" href="${escapeHtml(sessionReportHref(session))}" style="--kid-color: ${escapeHtml(colorForKid(kid))}">
                            ${activityRowLeadHtml({ time: timeLabel(session?.started_at || session?.completed_at), kid, subjectIconHtml: sessionSubjectIconHtml(session) })}
                            <span class="point-activity-event-card-count" aria-label="${escapeHtml(`${sessionCardCount(session)} cards`)}"><span class="icon" data-icon="layers" data-icon-size="12" data-icon-stroke="2.3" aria-hidden="true"></span><span>${escapeHtml(sessionCardCount(session).toLocaleString())}</span></span>
                            <span class="point-activity-event-card-count" aria-label="${escapeHtml(`${formatCalendarMinutes(sessionActiveMinutes(session))} minutes`)}"><span class="icon" data-icon="clock" data-icon-size="12" data-icon-stroke="2.3" aria-hidden="true"></span><span>${escapeHtml(`${formatCalendarMinutes(sessionActiveMinutes(session))}m`)}</span></span>
                            <span class="point-activity-event-wrong-pills"${nonGreenCards.length ? '' : ' aria-hidden="true"'}>${nonGreenCards.map((label) => `<span class="point-rule-delta paradigm-pill negative point-activity-event-wrong-pill">${escapeHtml(label)}</span>`).join('')}</span>
                            <span class="icon point-activity-event-chevron" data-icon="chevron-right" data-icon-size="16" data-icon-stroke="2.7" aria-hidden="true"></span>
                        </a>
                    `;
                }).join('')}
            </div>
        </div>
    `;
}

function buildProgressChart(dailyProgressPoints) {
    const rawPoints = Array.isArray(dailyProgressPoints) ? dailyProgressPoints : [];
    const validPoints = rawPoints.map((point) => {
        const date = String(point?.date || '').trim();
        if (!date) return null;
        const practiced = Math.max(0, Number.parseInt(point?.practiced, 10) || 0);
        const learned = Math.max(0, Number.parseInt(point?.learned, 10) || 0);
        const rtSum = Math.max(0, Number.parseInt(point?.cumulative_correct_response_time_ms_sum, 10) || 0);
        const rtCount = Math.max(0, Number.parseInt(point?.cumulative_correct_response_time_count, 10) || 0);
        const attempts = Math.max(0, Number.parseInt(point?.cumulative_attempts, 10) || 0);
        const correct = Math.max(0, Number.parseInt(point?.cumulative_correct, 10) || 0);
        return { date, practiced, learned, rtSum, rtCount, attempts, correct };
    }).filter(Boolean).sort((left, right) => left.date.localeCompare(right.date));
    if (!validPoints.length) return null;
    const sortedDates = validPoints.map((point) => point.date);
    const firstDate = sortedDates[0];
    const lastDate = sortedDates[sortedDates.length - 1];
    const points = validPoints.map((point, index) => ({
        dayIndex: index + 1,
        date: point.date,
        practiced: point.practiced,
        learned: point.learned,
        avgCorrectRtSec: point.rtCount > 0 ? (point.rtSum / point.rtCount) / 1000 : null,
        cumCorrectPct: point.attempts > 0 ? (point.correct / point.attempts) * 100 : null,
    }));
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

function renderProgressMetricBtns({ rtHasData, crHasData, activeMetric }) {
    if (!rtHasData || !crHasData) return '';
    return `
        <div class="daily-progress-metric-btns paradigm-chip-toggle-group paradigm-segmented-toggle">
            <button type="button" class="daily-progress-metric-btn paradigm-chip-toggle${activeMetric === 'speed' ? ' active' : ''}" data-progress-metric="speed">Speed</button>
            <button type="button" class="daily-progress-metric-btn paradigm-chip-toggle${activeMetric === 'correctness' ? ' active' : ''}" data-progress-metric="correctness">Correct</button>
        </div>
    `;
}

function renderProgressPanel() {
    if (!pointActivityProgressPanel || !pointActivityProgress) return;
    if (!isInAppChore() || isAllInAppMode()) {
        pointActivityProgressPanel.classList.add('hidden');
        pointActivityProgress.innerHTML = '';
        return;
    }
    const chart = buildProgressChart(visibleProgressPoints());
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
    pointActivityProgress.innerHTML = `
        <div class="daily-progress-card${hasRtData ? ' has-response-time' : ''}${hasCrData ? ' has-correctness-rate' : ''}">
            <div class="daily-progress-head paradigm-metric-header">
                <h2 class="paradigm-panel-title">
                    <span class="paradigm-panel-title-icon"><span class="icon" data-icon="award" data-icon-size="22" data-icon-stroke="2.4" aria-hidden="true"></span></span>
                    <span class="paradigm-panel-heading">Progress over time</span>
                </h2>
                ${metricButtonsHtml}
            </div>
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
    if (isInAppChore()) {
        currentCalendarMetric = currentCalendarMetric === 'cards' ? 'cards' : 'minutes';
    } else {
        currentCalendarMetric = currentCalendarMetric === 'count' ? 'count' : 'points';
    }
    ensureDisplayedMonth();
    const firstDay = monthDateFromKey(displayedMonthKey);
    const leadingBlanks = firstDay ? weekdayIndexMondayFirst(firstDay) : 0;
    const totalDays = daysInMonth(displayedMonthKey);
    const pointTotals = isInAppChore() ? null : calendarTotalsByDay(visibleEvents());
    const eventCounts = isInAppChore() ? new Map() : calendarEventCountsByDay(visibleEvents());
    const totals = isInAppChore() ? calendarSessionsByDay() : pointTotals;
    const displayTotals = isInAppChore()
        ? totals
        : (currentCalendarMetric === 'count' ? eventCounts : totals);
    const noteDays = isInAppChore() ? new Set() : calendarNoteDays(visibleEvents());
    const maxTotal = Math.max(1, ...[...displayTotals.values()].map((value) => (
        isInAppChore()
            ? Math.abs(Number(currentCalendarMetric === 'cards' ? value?.cards : value?.minutes) || 0)
            : Math.abs(value)
    )));
    const cells = [
        ...Array.from({ length: leadingBlanks }, () => '<div class="point-activity-day is-blank" aria-hidden="true"></div>'),
        ...Array.from({ length: totalDays }, (_, index) => calendarCellHtml(index + 1, totals, noteDays, maxTotal, eventCounts)),
    ];
    const sidebarHtml = isAllOffAppMode() ? monthlyTopRulesHtml() : monthlyHighlightsHtml(displayTotals);

    pointActivityCalendar.innerHTML = `
        <div class="point-activity-calendar-head">
            <h2 class="paradigm-panel-title">
                <span class="paradigm-panel-title-icon"><span class="icon" data-icon="calendar" data-icon-size="22" data-icon-stroke="2.4" aria-hidden="true"></span></span>
                <span class="paradigm-panel-heading">${escapeHtml(monthLabel(displayedMonthKey))}</span>
            </h2>
            <div class="point-activity-calendar-month-actions">
                <button type="button" class="paradigm-icon-btn paradigm-compact-stepper-button point-activity-calendar-month-btn" data-calendar-month="-1" aria-label="Previous month">
                    <span class="icon" data-icon="chevron-left" data-icon-size="13" data-icon-stroke="2.4" aria-hidden="true"></span>
                </button>
                <button type="button" class="paradigm-icon-btn paradigm-compact-stepper-button point-activity-calendar-month-btn" data-calendar-month="1" aria-label="Next month">
                    <span class="icon" data-icon="chevron-right" data-icon-size="13" data-icon-stroke="2.4" aria-hidden="true"></span>
                </button>
            </div>
            <div class="point-activity-calendar-metric-toggle daily-progress-metric-btns paradigm-chip-toggle-group paradigm-segmented-toggle" role="group" aria-label="Calendar metric">
                ${isInAppChore() ? `
                    <button type="button" class="daily-progress-metric-btn paradigm-chip-toggle${currentCalendarMetric === 'minutes' ? ' active' : ''}" data-calendar-metric="minutes">Time</button>
                    <button type="button" class="daily-progress-metric-btn paradigm-chip-toggle${currentCalendarMetric === 'cards' ? ' active' : ''}" data-calendar-metric="cards">Cards</button>
                ` : `
                    <button type="button" class="daily-progress-metric-btn paradigm-chip-toggle${currentCalendarMetric === 'points' ? ' active' : ''}" data-calendar-metric="points">Points</button>
                    <button type="button" class="daily-progress-metric-btn paradigm-chip-toggle${currentCalendarMetric === 'count' ? ' active' : ''}" data-calendar-metric="count">Count</button>
                `}
            </div>
        </div>
        <div class="point-activity-calendar-body${sidebarHtml ? ' point-activity-calendar-body--has-monthly-top' : ''}">
            <div class="point-activity-calendar-main">
                <div class="point-activity-weekdays" aria-hidden="true">
                    <span>Mon</span><span>Tue</span><span>Wed</span><span>Thu</span><span>Fri</span><span>Sat</span><span>Sun</span>
                </div>
                <div class="point-activity-calendar-grid">
                    ${cells.join('')}
                </div>
            </div>
            ${sidebarHtml}
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
    if (isInAppChore() || isAllOffAppMode()) {
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
                const historyHref = pointHistoryDestinationHref(event);
                const tagName = historyHref ? 'a' : 'article';
                const hrefAttr = historyHref ? ` href="${escapeHtml(historyHref)}"` : '';
                return `
                    <${tagName}${hrefAttr} class="point-activity-log-row${historyHref ? ' point-activity-log-row-link' : ''}" style="--kid-color: ${escapeHtml(colorForKid(kid))}">
                        <time class="point-activity-log-time" datetime="${escapeHtml(event?.createdAt || '')}">
                            <span class="point-activity-log-date">${escapeHtml(logDateLabel(event?.createdAt))}</span>
                            <span class="point-activity-log-clock">${escapeHtml(timeLabel(event?.createdAt))}</span>
                        </time>
                        ${avatarHtml(kid)}
                        <span class="point-activity-log-note">${escapeHtml(note || '-')}</span>
                        <span class="point-rule-delta paradigm-pill ${escapeHtml(pointPillClass(isAllOffAppMode() ? event?.rule : (currentRule || event?.rule || {})))}">${escapeHtml(formatSignedPoints(event?.pointsDelta))}</span>
                    </${tagName}>
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
    allInAppSubjectRules = (Array.isArray(rules) ? rules : [])
        .filter((rule) => String(rule?.ruleKind || '') === 'in_app_chore' && normalizeCategoryKey(rule?.triggerKey))
        .filter((rule, index, list) => list.findIndex((item) => normalizeCategoryKey(item?.triggerKey) === normalizeCategoryKey(rule?.triggerKey)) === index);
    if (isAllInAppMode()) {
        currentRule = {
            ruleId: 0,
            ruleKind: 'in_app_chore',
            name: 'All practice',
            triggerKey: '',
            maxPoint: null,
            isActive: true,
        };
        return;
    }
    if (isAllOffAppMode()) {
        const config = aggregateActivityConfig();
        currentRule = {
            ruleId: Number.parseInt(requestedRuleId, 10) || -2,
            name: config.name,
            ruleKind: config.ruleKind,
            triggerKey: '',
            maxPoint: null,
            isActive: true,
        };
        return;
    }
    const inAppRuleForCategory = isCategoryInAppMode()
        ? allInAppSubjectRules.find((rule) => normalizeCategoryKey(rule?.triggerKey) === requestedCategoryKey)
        : null;
    currentRule = inAppRuleForCategory
        || (Array.isArray(rules) ? rules : []).find((rule) => String(rule?.ruleId || '') === requestedRuleId)
        || allActivityEvents().find((event) => isSameRule(event))?.rule
        || (isCategoryInAppMode() ? {
            ruleId: null,
            ruleKind: 'in_app_chore',
            name: requestedCategoryName || requestedCategoryKey,
            triggerKey: requestedCategoryKey,
            maxPoint: null,
            isActive: false,
        } : null);
}

function networkProfileRequested() {
    return new URLSearchParams(window.location.search).get('profileNetwork') === '1';
}

function reportNetworkProfileIfRequested(timings = {}) {
    if (!networkProfileRequested() || !window.performance?.getEntriesByType) return;
    window.setTimeout(() => {
        const resources = window.performance.getEntriesByType('resource')
            .filter((entry) => {
                try {
                    return new URL(entry.name).origin === window.location.origin
                        && new URL(entry.name).pathname.startsWith('/api/');
                } catch (_err) {
                    return false;
                }
            })
            .map((entry) => {
                const url = new URL(entry.name);
                return {
                    path: `${url.pathname}${url.search}`,
                    durationMs: entry.duration,
                    ttfbMs: Math.max(0, entry.responseStart - entry.startTime),
                    transferBytes: entry.transferSize,
                    decodedBodyBytes: entry.decodedBodySize,
                };
            });
        fetch(`${API_BASE}/diagnostics/client-network`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ page: window.location.pathname, timings, resources }),
            keepalive: true,
        }).catch(() => {});
    }, 0);
}

async function loadInitialData() {
    if (!requestedRuleId && !requestedCategoryKey) {
        showError('Missing point activity.');
        return;
    }
    showError('');
    const loadStartedAt = window.performance?.now?.() || 0;
    const [loadedKids, ruleData, countData] = await Promise.all([
        fetchJson(`${API_BASE}/kids?view=reward_nav`),
        fetchJson(`${API_BASE}/points/rules?includeInactive=1`),
        fetchJson(`${API_BASE}/points/rules/activity-counts`),
    ]);
    kids = loadedKids;
    ruleActivityCounts = countData?.counts && typeof countData.counts === 'object' ? countData.counts : {};
    const pointEntriesPromise = Promise.all(kids.map(async (kid) => [
        String(kid.id),
        await fetchJson(`${API_BASE}/kids/${encodeURIComponent(kid.id)}/points?limit=${POINT_ACTIVITY_HISTORY_LIMIT}`),
    ]));
    resolveCurrentRule(ruleData?.rules);
    let reportEntriesPromise = Promise.resolve(null);
    let progressDataPromise = Promise.resolve();
    if (isInAppChore()) {
        reportEntriesPromise = Promise.all(kids.map(async (kid) => [
            String(kid.id),
            await fetchJson(`${API_BASE}/kids/${encodeURIComponent(kid.id)}/report`),
        ]));
        if (!isAllInAppMode()) progressDataPromise = loadProgressData();
    }
    const [pointEntries, reportEntries] = await Promise.all([
        pointEntriesPromise,
        reportEntriesPromise,
        progressDataPromise,
    ]);
    pointDataByKid = new Map(pointEntries);
    if (reportEntries) {
        reportDataByKid = new Map(reportEntries);
    }
    const selectedToday = selectTodayWhenItHasActivity();
    const beforeRenderAt = window.performance?.now?.() || 0;
    render();
    if (selectedToday && isInAppChore()) {
        window.setTimeout(async () => {
            await loadSelectedSessionDetails();
            renderCalendar();
        }, 0);
    }
    if (!networkProfileRequested()) return;
    await new Promise((resolve) => window.requestAnimationFrame(() => window.requestAnimationFrame(resolve)));
    const paintedAt = window.performance?.now?.() || 0;
    reportNetworkProfileIfRequested({
        fetch_and_process_ms: Math.max(0, beforeRenderAt - loadStartedAt),
        render_to_paint_ms: Math.max(0, paintedAt - beforeRenderAt),
        total_page_ready_ms: Math.max(0, paintedAt - loadStartedAt),
    });
}

pointActivityHero?.addEventListener('click', async (event) => {
    const ruleEditAction = event.target.closest('[data-rule-edit-action]');
    if (ruleEditAction && pointActivityHero.contains(ruleEditAction)) {
        if (isKidUserMode()) return;
        const action = String(ruleEditAction.dataset.ruleEditAction || '');
        if (action === 'start') {
            isRuleEditing = true;
            renderHero();
            pointActivityHero.querySelector('[data-rule-edit-points]')?.focus();
            return;
        }
        if (action === 'cancel') {
            isRuleEditing = false;
            renderHero();
            return;
        }
        if (action === 'delete') {
            const ruleId = Number.parseInt(currentRule?.ruleId || requestedRuleId, 10);
            const ruleName = String(currentRule?.name || 'this rule').trim() || 'this rule';
            if (!Number.isInteger(ruleId) || ruleId <= 0) {
                showError('Rule is unavailable for deletion.');
                return;
            }
            if (!window.confirm(`Delete "${ruleName}"? This cannot be undone.`)) return;
            ruleEditAction.disabled = true;
            try {
                const response = await fetch(`${API_BASE}/points/rules/${encodeURIComponent(ruleId)}`, {
                    method: 'DELETE',
                });
                const result = await response.json().catch(() => ({}));
                if (!response.ok) throw new Error(result.error || 'Failed to delete rule.');
                window.location.assign('/point-log.html');
            } catch (error) {
                ruleEditAction.disabled = false;
                showError(error.message || 'Failed to delete rule.');
            }
            return;
        }
        if (action === 'save') {
            const ruleId = Number.parseInt(currentRule?.ruleId, 10);
            const pointsInput = pointActivityHero.querySelector('[data-rule-edit-points]');
            const activeInput = pointActivityHero.querySelector('[data-rule-edit-active]');
            const nameInput = pointActivityHero.querySelector('[data-rule-edit-name]');
            const emojiInput = pointActivityHero.querySelector('[data-rule-edit-emoji]');
            const pointsText = String(pointsInput?.value || '').trim();
            const maxPoint = pointsText ? Number.parseInt(pointsText, 10) : null;
            if (!Number.isInteger(ruleId) || ruleId <= 0) {
                showError('Rule is unavailable for editing.');
                return;
            }
            if (pointsText && (!Number.isInteger(maxPoint) || maxPoint <= 0)) {
                showError(`${String(currentRule?.ruleKind || '') === 'in_app_chore' ? 'Cards per point' : 'Default points'} must be a positive whole number.`);
                pointsInput?.focus();
                return;
            }
            const payload = {
                maxPoint,
            };
            if (String(currentRule?.ruleKind || '') !== 'in_app_chore') {
                payload.isActive = Boolean(activeInput?.checked);
            }
            if (nameInput) {
                payload.name = String(nameInput.value || '').trim();
            }
            if (emojiInput) {
                payload.emoji = String(emojiInput.value || '').trim();
            }
            ruleEditAction.disabled = true;
            try {
                const response = await fetch(`${API_BASE}/points/rules/${encodeURIComponent(ruleId)}`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload),
                });
                const result = await response.json().catch(() => ({}));
                if (!response.ok) throw new Error(result.error || 'Failed to save rule.');
                currentRule = result.rule || currentRule;
                isRuleEditing = false;
                showError('');
                render();
            } catch (error) {
                ruleEditAction.disabled = false;
                showError(error.message || 'Failed to save rule.');
            }
            return;
        }
    }
    const kidButton = event.target.closest('[data-point-filter-kid]');
    if (kidButton && pointActivityHero.contains(kidButton)) {
        const nextKidId = String(kidButton.dataset.pointFilterKid || '');
        selectedKidId = selectedKidId === nextKidId ? '' : nextKidId;
        render();
        return;
    }
    const aggregateReset = event.target.closest('[data-aggregate-filter-reset]');
    if (aggregateReset && pointActivityHero.contains(aggregateReset)) {
        selectedAllInAppSubjectKey = '';
        selectedAllOffAppRuleKind = '';
        render();
        return;
    }
    const subjectFilter = event.target.closest('[data-all-in-app-subject]');
    if (subjectFilter && pointActivityHero.contains(subjectFilter)) {
        const nextSubjectKey = normalizeCategoryKey(subjectFilter.dataset.allInAppSubject);
        selectedAllInAppSubjectKey = selectedAllInAppSubjectKey === nextSubjectKey ? '' : nextSubjectKey;
        render();
        return;
    }
    const offAppTypeFilter = event.target.closest('[data-all-off-app-type]');
    if (offAppTypeFilter && pointActivityHero.contains(offAppTypeFilter)) {
        const nextRuleKind = String(offAppTypeFilter.dataset.allOffAppType || '').trim();
        selectedAllOffAppRuleKind = selectedAllOffAppRuleKind === nextRuleKind ? '' : nextRuleKind;
        render();
        return;
    }
});

pointActivityCalendar?.addEventListener('click', async (event) => {
    const metricButton = event.target.closest('[data-calendar-metric]');
    if (metricButton && pointActivityCalendar.contains(metricButton)) {
        const requestedMetric = String(metricButton.dataset.calendarMetric || '');
        currentCalendarMetric = isInAppChore()
            ? (requestedMetric === 'cards' ? 'cards' : 'minutes')
            : (requestedMetric === 'count' ? 'count' : 'points');
        try { localStorage.setItem('pointActivityReport.calendarMetric', currentCalendarMetric); } catch (_err) {}
        renderCalendar();
        return;
    }
    const dayButton = event.target.closest('[data-calendar-day]');
    if (dayButton && pointActivityCalendar.contains(dayButton)) {
        const nextDayKey = String(dayButton.dataset.calendarDay || '');
        if (selectedCalendarDayKey === nextDayKey) {
            selectedCalendarDayKey = '';
            renderCalendar();
            return;
        }
        selectedCalendarDayKey = nextDayKey;
        dayButton.classList.add('active');
        if (isInAppChore()) {
            await new Promise((resolve) => window.requestAnimationFrame(() => window.requestAnimationFrame(resolve)));
        }
        renderCalendar();
        await loadSelectedSessionDetails();
        renderCalendar();
        return;
    }
    const button = event.target.closest('[data-calendar-month]');
    if (!button || !pointActivityCalendar.contains(button)) return;
    displayedMonthKey = addMonths(displayedMonthKey, button.dataset.calendarMonth || 0);
    selectedCalendarDayKey = '';
    renderCalendar();
});

pointActivityProgress?.addEventListener('click', (event) => {
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
