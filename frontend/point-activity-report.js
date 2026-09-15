const API_BASE = `${window.location.origin}/api`;
const POINT_ACTIVITY_HISTORY_LIMIT = 5000;

const params = new URLSearchParams(window.location.search);
const requestedRuleId = String(params.get('ruleId') || '').trim();
const requestedName = String(params.get('name') || '').trim();
const requestedKind = String(params.get('kind') || '').trim();
const pointActivityHero = document.getElementById('pointActivityHero');
const pointActivityCalendar = document.getElementById('pointActivityCalendar');
const pointActivityError = document.getElementById('pointActivityError');
const pageTitle = document.getElementById('pageTitle');

let kids = [];
let pointDataByKid = new Map();
let selectedKidId = '';
let currentRule = null;
let displayedMonthKey = '';
let selectedCalendarDayKey = '';

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

function activeDayCount(events) {
    const timezone = familyTimezone();
    if (!timezone) return 0;
    return new Set(events.map((event) => dayKey(parseDate(event?.createdAt), timezone)).filter(Boolean)).size;
}

function pointTotal(events) {
    return events.reduce((sum, event) => sum + (Number.parseInt(event?.pointsDelta, 10) || 0), 0);
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
    if (ruleKind === 'deduction_event' || requestedKind === 'loss') {
        return { label: 'Loss', icon: 'thumbs-down', tone: 'loss' };
    }
    if (ruleKind === 'redeemed_reward' || requestedKind === 'spend') {
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
    const title = String(rule.name || requestedName || 'Point activity').trim();
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
                        return `
                            <button type="button" class="point-activity-kid-card${selectedKidId === String(kid.id) ? ' active' : ''}" data-point-filter-kid="${escapeHtml(kid.id)}" style="--kid-color: ${escapeHtml(colorForKid(kid))}">
                                ${avatarHtml(kid)}
                                <span>
                                    <span class="point-activity-kid-name">${escapeHtml(kid.name || 'Kid')}</span>
                                    <span class="point-activity-kid-points">${escapeHtml(formatPoints(pointTotal(kidEvents)))}</span>
                                    <span class="point-activity-kid-count">${escapeHtml(`${kidEvents.length} ${kidEvents.length === 1 ? 'time' : 'times'}`)}</span>
                                </span>
                                <span class="icon" data-icon="chevron-right" data-icon-size="15" data-icon-stroke="2.7" aria-hidden="true"></span>
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

function calendarLevel(total, maxTotal) {
    const absTotal = Math.abs(total);
    if (absTotal <= 0) return 0;
    const max = Math.max(1, Math.abs(maxTotal) || 0);
    return Math.min(5, Math.max(1, Math.ceil((absTotal / max) * 5)));
}

function calendarCellHtml(dayNumber, totals, maxTotal) {
    const key = `${displayedMonthKey}-${String(dayNumber).padStart(2, '0')}`;
    const hasTotal = totals.has(key);
    const total = totals.get(key) || 0;
    const absTotal = Math.abs(total);
    const level = calendarLevel(total, maxTotal);
    const calendarTone = typeBadge(currentRule || {}).tone;
    const canSelect = absTotal > 0;
    const tagName = canSelect ? 'button' : 'div';
    const attrs = canSelect
        ? `type="button" data-calendar-day="${escapeHtml(key)}" aria-label="${escapeHtml(`${shortDateLabel(key)} ${absTotal.toLocaleString()} points`)}"`
        : '';
    return `
        <${tagName} class="point-activity-day${hasTotal ? ` has-total level-${level}` : ''}${selectedCalendarDayKey === key ? ' active' : ''} tone-${escapeHtml(calendarTone)}" ${attrs}>
            <span class="point-activity-day-number">${dayNumber}</span>
            <span class="point-activity-day-total">${hasTotal ? escapeHtml(absTotal.toLocaleString()) : '0'}</span>
        </${tagName}>
    `;
}

function eventsForSelectedDay() {
    if (!selectedCalendarDayKey) return [];
    return visibleEvents()
        .filter((event) => dayKey(parseDate(event?.createdAt), familyTimezone()) === selectedCalendarDayKey)
        .sort((a, b) => parseDate(a?.createdAt).getTime() - parseDate(b?.createdAt).getTime());
}

function renderDayDetails() {
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

function renderCalendar() {
    if (!pointActivityCalendar) return;
    ensureDisplayedMonth();
    const firstDay = monthDateFromKey(displayedMonthKey);
    const leadingBlanks = firstDay ? weekdayIndexMondayFirst(firstDay) : 0;
    const totalDays = daysInMonth(displayedMonthKey);
    const totals = calendarTotalsByDay(visibleEvents());
    const maxTotal = Math.max(1, ...[...totals.values()].map((value) => Math.abs(value)));
    const cells = [
        ...Array.from({ length: leadingBlanks }, () => '<div class="point-activity-day is-blank" aria-hidden="true"></div>'),
        ...Array.from({ length: totalDays }, (_, index) => calendarCellHtml(index + 1, totals, maxTotal)),
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

function render() {
    renderHero();
    renderCalendar();
    window.hydrateIcons?.(document);
}

function resolveCurrentRule() {
    currentRule = allActivityEvents().find((event) => isSameRule(event))?.rule || null;
    if (!currentRule && requestedName) {
        currentRule = { name: requestedName };
    }
}

async function loadInitialData() {
    if (!requestedRuleId) {
        showError('Missing point activity.');
        return;
    }
    showError('');
    kids = await fetchJson(`${API_BASE}/kids?view=reward_nav`);
    const entries = await Promise.all(kids.map(async (kid) => [
        String(kid.id),
        await fetchJson(`${API_BASE}/kids/${encodeURIComponent(kid.id)}/points?limit=${POINT_ACTIVITY_HISTORY_LIMIT}`),
    ]));
    pointDataByKid = new Map(entries);
    resolveCurrentRule();
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

loadInitialData().catch((error) => {
    showError(error.message || 'Failed to load point activity history.');
});
