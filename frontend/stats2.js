const API_BASE = `${window.location.origin}/api`;
const POINT_HISTORY_LIMIT = 5000;

const stats2Error = document.getElementById('stats2Error');
const stats2RaceTitle = document.getElementById('stats2RaceTitle');
const stats2WeekMeta = document.getElementById('stats2WeekMeta');
const stats2DaysLeft = document.getElementById('stats2DaysLeft');
const stats2PreviousWeek = document.getElementById('stats2PreviousWeek');
const stats2NextWeek = document.getElementById('stats2NextWeek');
const stats2BalanceRace = document.getElementById('stats2BalanceRace');
const stats2RaceCards = document.getElementById('stats2RaceCards');
const stats2HighlightTabs = document.getElementById('stats2HighlightTabs');
const stats2Highlights = document.getElementById('stats2Highlights');
const stats2HighlightsTitle = document.getElementById('stats2HighlightsTitle');

let kids = [];
let pointsByKid = new Map();
let selectedHighlightKidId = '';
let expandedHighlightKind = '';
let showAllHighlightKind = '';
let selectedStatsWeekStart = '';

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
    stats2Error.textContent = text || '';
    stats2Error.classList.toggle('hidden', !text);
}

async function fetchJson(url) {
    const response = await fetch(url, { headers: { 'Content-Type': 'application/json' } });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`);
    return data;
}

function parseDate(value) {
    const text = String(value || '').trim();
    return text ? new Date(/(?:z|[+-]\d{2}:?\d{2})$/i.test(text) ? text : `${text}Z`) : new Date(Number.NaN);
}

function dayKey(date, timezone) {
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '';
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone: timezone || undefined, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
    const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    return `${map.year}-${map.month}-${map.day}`;
}

function localTimeParts(date, timezone) {
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) return null;
    const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: timezone || undefined,
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hourCycle: 'h23',
    }).formatToParts(date);
    const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    return {
        hour: Number.parseInt(map.hour, 10) || 0,
        minute: Number.parseInt(map.minute, 10) || 0,
        second: Number.parseInt(map.second, 10) || 0,
    };
}

function dateFromKey(key) {
    const [year, month, day] = String(key || '').split('-').map(Number);
    return year && month && day ? new Date(Date.UTC(year, month - 1, day)) : null;
}

function addDays(key, days) {
    const date = dateFromKey(key);
    if (!date) return '';
    date.setUTCDate(date.getUTCDate() + days);
    return dayKey(date, 'UTC');
}

function weekStart(key) {
    const date = dateFromKey(key);
    if (!date) return '';
    date.setUTCDate(date.getUTCDate() + (date.getUTCDay() === 0 ? -6 : 1 - date.getUTCDay()));
    return dayKey(date, 'UTC');
}

function weekLabel(startKey) {
    const start = dateFromKey(startKey);
    const end = dateFromKey(addDays(startKey, 6));
    if (!start || !end) return '';
    const startText = start.toLocaleDateString([], { timeZone: 'UTC', month: 'short', day: 'numeric' });
    const endText = end.toLocaleDateString([], { timeZone: 'UTC', month: start.getUTCMonth() === end.getUTCMonth() ? undefined : 'short', day: 'numeric' });
    return `${startText} - ${endText}`;
}

function formatPoints(value) {
    return `${(Number.parseInt(value, 10) || 0).toLocaleString()} pts`;
}

function formatSignedPoints(value) {
    const number = Number.parseInt(value, 10) || 0;
    return `${number > 0 ? '+' : ''}${number.toLocaleString()} pts`;
}

function formatPercent(value) {
    const number = Math.abs(Math.round(Number(value) || 0));
    return `${number}%`;
}

function pointPillClassForKind(kind, value) {
    const number = Number.parseInt(value, 10) || 0;
    if (kind === 'spend') return number < 0 ? 'redeemed' : 'balance';
    if (kind === 'loss') return number < 0 ? 'negative' : 'balance';
    if (number > 0) return 'positive';
    if (number < 0) return 'negative';
    return 'balance';
}

function racePillClass(theme) {
    if (theme === 'lost' || theme === 'closest') return 'negative';
    if (theme === 'earned' || theme === 'improved') return 'positive';
    return 'balance';
}

function sameStatValue(a, b) {
    return Math.abs((Number(a) || 0) - (Number(b) || 0)) < 0.0001;
}

function balanceAtWeekEnd(points, endKey, timezone) {
    const rewardTotals = points?.rewardBucketTotals && typeof points.rewardBucketTotals === 'object'
        ? points.rewardBucketTotals
        : {};
    const [bucket, bucketEntry] = Object.entries(rewardTotals)[0] || [];
    const normalizedBucket = String(bucket || '').trim().toLowerCase();
    const currentTotal = Number.parseInt(bucketEntry?.totalPoints, 10);
    if (!normalizedBucket || !Number.isFinite(currentTotal)) {
        return Number.parseInt(points?.totalPoints, 10) || 0;
    }
    const laterDelta = (points?.events || []).reduce((sum, event) => {
        const eventKey = dayKey(parseDate(event?.createdAt), timezone);
        if (!eventKey || eventKey < endKey) return sum;
        const rewardType = String(event?.rule?.rewardType || '').trim().toLowerCase();
        if (rewardType && rewardType !== normalizedBucket) return sum;
        return sum + (Number.parseInt(event?.pointsDelta, 10) || 0);
    }, 0);
    return currentTotal - laterDelta;
}

function percentRatio(current, previous) {
    const now = Number.parseInt(current, 10) || 0;
    const before = Number.parseInt(previous, 10) || 0;
    if (before <= 0) return now > 0 ? 100 : 0;
    return (now / before) * 100;
}

function periodSummary(events, startKey, endKey, timezone) {
    return (events || []).reduce((summary, event) => {
        const key = dayKey(parseDate(event.createdAt), timezone);
        if (!key || key < startKey || key >= endKey) return summary;
        const delta = Number.parseInt(event.pointsDelta, 10) || 0;
        const redeemed = String(event?.rule?.ruleKind || '') === 'redeemed_reward';
        if (delta > 0) summary.earned += delta;
        if (delta < 0 && !redeemed) summary.lost += Math.abs(delta);
        return summary;
    }, { earned: 0, lost: 0 });
}

function eventsForWeek(points, startKey, endKey, timezone) {
    return (points?.events || []).filter((event) => {
        const key = dayKey(parseDate(event.createdAt), timezone);
        return key && key >= startKey && key < endKey;
    });
}

function ruleIconHtml(rule, kind) {
    const triggerKey = String(rule?.triggerKey || '').trim();
    if (rule?.ruleKind === 'in_app_chore' && triggerKey && typeof window.subjectIcon === 'function') {
        return window.subjectIcon(triggerKey);
    }
    return escapeHtml(rule?.emoji || (kind === 'earn' ? '⭐' : kind === 'loss' ? '📉' : '🎁'));
}

function ruleSummaryItems(events, kind) {
    const byRule = new Map();
    events.forEach((event) => {
        const delta = Number.parseInt(event.pointsDelta, 10) || 0;
        const rule = event.rule || {};
        const ruleKind = String(rule.ruleKind || '');
        const isEarn = kind === 'earn' && delta > 0;
        const isLoss = kind === 'loss' && delta < 0 && ruleKind !== 'redeemed_reward';
        const isSpend = kind === 'spend' && delta < 0 && ruleKind === 'redeemed_reward';
        if (!isEarn && !isLoss && !isSpend) return;
        const key = String(rule.ruleId || event.ruleId || rule.name || event.note || 'event');
        const item = byRule.get(key) || {
            ruleId: String(rule.ruleId || event.ruleId || ''),
            kind,
            name: String(rule.name || event.note || 'Point event'),
            iconHtml: ruleIconHtml(rule, kind),
            points: 0,
            count: 0,
        };
        item.points += delta;
        item.count += 1;
        byRule.set(key, item);
    });
    return [...byRule.values()].sort((a, b) => Math.abs(b.points) - Math.abs(a.points));
}

function pointActivityReportHref(item) {
    const ruleId = String(item?.ruleId || '').trim();
    return `/point-activity-report.html?ruleId=${encodeURIComponent(ruleId)}`;
}

function avatar(kid, crowned = false) {
    const name = String(kid?.name || 'Kid').trim();
    const url = String(kid?.avatarUrl || '').trim();
    const avatarHtml = url
        ? `<img class="stats2-avatar" src="${escapeHtml(url)}" alt="${escapeHtml(name)}">`
        : `<span class="stats2-avatar stats2-avatar-fallback">${escapeHtml(name.charAt(0).toUpperCase())}</span>`;
    return `<span class="stats2-avatar-wrap">${avatarHtml}${crowned ? '<span class="stats2-crown-badge" aria-hidden="true">👑</span>' : ''}</span>`;
}

function colorForKid(kid) {
    return '#6b5cf6';
}

function weekTimeLeftLabel(now, timezone) {
    const currentKey = dayKey(now, timezone);
    const dayIndex = dateFromKey(currentKey)?.getUTCDay() ?? 1;
    const daysLeft = Math.max(0, 6 - ((dayIndex + 6) % 7));
    if (daysLeft > 0) return `${daysLeft} ${daysLeft === 1 ? 'day' : 'days'} left`;
    const local = localTimeParts(now, timezone);
    if (!local) return '0 hours left';
    const elapsedSeconds = (local.hour * 3600) + (local.minute * 60) + local.second;
    const hoursLeft = Math.max(0, Math.ceil((86400 - elapsedSeconds) / 3600));
    return `${hoursLeft} ${hoursLeft === 1 ? 'hour' : 'hours'} left`;
}

function currentWeekStart(timezone) {
    return weekStart(dayKey(new Date(), timezone));
}

function selectedWeekStart(timezone) {
    const currentStart = currentWeekStart(timezone);
    if (!selectedStatsWeekStart || selectedStatsWeekStart > currentStart) {
        selectedStatsWeekStart = currentStart;
    }
    return selectedStatsWeekStart;
}

function updateWeekControls(start, timezone) {
    const currentStart = currentWeekStart(timezone);
    const isCurrentWeek = start === currentStart;
    if (stats2RaceTitle) stats2RaceTitle.textContent = isCurrentWeek ? "This Week's Race" : "Week's Race";
    if (stats2HighlightsTitle) stats2HighlightsTitle.textContent = isCurrentWeek ? "This Week's Highlights" : "Week's Highlights";
    stats2WeekMeta.textContent = weekLabel(start);
    stats2DaysLeft.innerHTML = isCurrentWeek
        ? `<span class="icon" data-icon="calendar" data-icon-size="13" data-icon-stroke="2.2" aria-hidden="true"></span><span>${escapeHtml(weekTimeLeftLabel(new Date(), timezone))}</span>`
        : `<span class="icon" data-icon="circle-check" data-icon-size="13" data-icon-stroke="2.2" aria-hidden="true"></span><span>Completed</span>`;
    if (stats2NextWeek) stats2NextWeek.disabled = isCurrentWeek;
}

function rowsForSelectedWeek() {
    const timezone = String(kids.find((kid) => kid.familyTimezone)?.familyTimezone || '').trim();
    const start = selectedWeekStart(timezone);
    const next = addDays(start, 7);
    const previous = addDays(start, -7);
    updateWeekControls(start, timezone);
    return kids.map((kid) => {
        const points = pointsByKid.get(String(kid.id)) || {};
        const current = periodSummary(points.events, start, next, timezone);
        const last = periodSummary(points.events, previous, start, timezone);
        return {
            kid,
            total: balanceAtWeekEnd(points, next, timezone),
            earned: current.earned,
            lost: current.lost,
            earnedRatio: percentRatio(current.earned, last.earned),
            lostRatio: percentRatio(current.lost, last.lost),
        };
    });
}

function renderBalanceRace(rows, isCompletedWeek) {
    const sorted = [...rows].sort((a, b) => b.total - a.total);
    const max = Math.max(1, ...sorted.map((row) => Math.max(0, row.total)));
    const leader = sorted[0];
    const lead = leader && sorted[1] ? leader.total - sorted[1].total : 0;
    const hasLeader = Boolean(leader) && lead > 0;
    stats2BalanceRace.innerHTML = `
        <div class="stats2-racer-list">
            ${sorted.map((row, index) => `
                <div class="stats2-racer-row" style="--kid-color: ${escapeHtml(colorForKid(row.kid))}">
                    ${avatar(row.kid, hasLeader && index === 0)}
                    <div class="stats2-racer-meta">
                        <div class="stats2-name">${escapeHtml(row.kid.name)}</div>
                        <div class="stats2-score point-rule-delta paradigm-pill balance">${escapeHtml(formatPoints(row.total))}</div>
                    </div>
                    <div class="stats2-progress" aria-hidden="true"><span style="--race-width: ${Math.max(8, Math.round((Math.max(0, row.total) / max) * 100))}%"></span></div>
                </div>
            `).join('')}
        </div>
        <div class="stats2-lead">
            <div>
                <strong>${hasLeader ? `${escapeHtml(leader.kid.name)} ${isCompletedWeek ? 'wins' : 'leads'}` : 'All tied'}</strong>
                ${isCompletedWeek ? '' : `<span>${hasLeader ? `by ${escapeHtml(formatPoints(lead))}` : 'tied for now'}</span>`}
            </div>
        </div>
    `;
}

function raceCardIconHtml(iconName) {
    return typeof window.icon === 'function'
        ? window.icon(iconName, { className: 'stats2-card-title-icon icon', size: 16, strokeWidth: 2.5 })
        : `<span class="stats2-card-title-icon icon" data-icon="${escapeHtml(iconName)}" data-icon-size="16" data-icon-stroke="2.5"></span>`;
}

function renderRaceCard(theme, iconName, title, rows, getter, formatter, higherWins = true) {
    const winner = [...rows].sort((a, b) => higherWins ? getter(b) - getter(a) : getter(a) - getter(b))[0];
    const winningValue = winner ? getter(winner) : null;
    const hasWinner = winner && rows.filter((row) => sameStatValue(getter(row), winningValue)).length === 1;
    return `
        <article class="stats2-race-card stats2-race-card--${escapeHtml(theme)}">
            <div class="stats2-card-title"><span class="stats2-card-title-icon-wrap" aria-hidden="true">${raceCardIconHtml(iconName)}</span>${escapeHtml(title)}</div>
            <div class="stats2-card-racers">
                ${rows.map((row) => `
                    <div class="stats2-mini-racer${hasWinner && winner.kid.id === row.kid.id ? ' is-leader' : ''}" style="--kid-color: ${escapeHtml(colorForKid(row.kid))}">
                        ${avatar(row.kid, hasWinner && winner.kid.id === row.kid.id)}
                        <div class="stats2-mini-racer-meta"><div class="stats2-name">${escapeHtml(row.kid.name)}</div><div class="stats2-score point-rule-delta paradigm-pill ${racePillClass(theme, getter(row))}">${escapeHtml(formatter(getter(row)))}</div></div>
                    </div>
                `).join('')}
            </div>
        </article>
    `;
}

function renderHighlightTabs() {
    stats2HighlightTabs.innerHTML = kids.map((kid) => `
        <button type="button" class="stats2-highlight-tab${String(kid.id) === selectedHighlightKidId ? ' active' : ''}" data-highlight-kid="${escapeHtml(kid.id)}">
            ${avatar(kid)}
            <span>${escapeHtml(kid.name)}</span>
        </button>
    `).join('');
}

function renderSummaryPanel(kind, title, items) {
    const first = items[0];
    const topValue = first ? formatSignedPoints(first.points) : '0 pts';
    const canExpand = Boolean(first);
    const isExpanded = canExpand && expandedHighlightKind === kind;
    const iconHtml = first ? first.iconHtml : '';
    const expandHtml = canExpand
        ? `<span class="icon" data-icon="${isExpanded ? 'chevron-up' : 'chevron-right'}" data-icon-size="17" data-icon-stroke="2.5" aria-hidden="true"></span>`
        : '';
    return `
        <article class="stats2-highlight-card stats2-highlight-card--${escapeHtml(kind)}${isExpanded ? ' is-expanded' : ''}${canExpand ? '' : ' is-empty'}" data-highlight-kind="${escapeHtml(kind)}" data-highlight-expandable="${canExpand ? '1' : '0'}">
            <div class="stats2-highlight-summary">
                <div class="stats2-highlight-icon" aria-hidden="true">${iconHtml}</div>
                <div class="stats2-highlight-main">
                    <div class="stats2-highlight-kicker">${escapeHtml(title)}</div>
                    <div class="stats2-highlight-title">${escapeHtml(first?.name || 'No activity yet')}</div>
                    <div class="stats2-highlight-sub">${escapeHtml(first ? `${first.count} ${first.count === 1 ? 'time' : 'times'}` : '0 times')}</div>
                </div>
                <div class="stats2-highlight-value"><span class="point-rule-delta paradigm-pill ${pointPillClassForKind(kind, first?.points)}">${escapeHtml(topValue)}</span>${expandHtml}</div>
            </div>
            ${isExpanded && items.length ? renderHighlightList(kind, items) : ''}
        </article>
    `;
}

function renderHighlightList(kind, items) {
    const max = Math.max(1, ...items.map((item) => Math.abs(item.points)));
    const visibleItems = showAllHighlightKind === kind ? items : items.slice(0, 4);
    const label = kind === 'earn' ? 'earning' : kind === 'loss' ? 'loss' : 'spending';
    let rank = 0;
    let previousPoints = null;
    return `
        <div class="stats2-earning-list">
            ${visibleItems.map((item, index) => {
                if (!sameStatValue(item.points, previousPoints)) rank = index + 1;
                previousPoints = item.points;
                return `
                <a class="stats2-earning-row stats2-earning-link" href="${escapeHtml(pointActivityReportHref(item))}" aria-label="${escapeHtml(`${item.name} activity history`)}">
                    <span class="stats2-rank">${rank}</span>
                    <span class="stats2-earning-emoji" aria-hidden="true">${item.iconHtml}</span>
                    <span>
                        <span class="stats2-earning-name">${escapeHtml(item.name)}</span>
                        <span class="stats2-highlight-sub">${escapeHtml(`${item.count} ${item.count === 1 ? 'time' : 'times'}`)}</span>
                    </span>
                    <span class="stats2-earning-bar" aria-hidden="true"><span class="${item.count > 1 ? 'is-segmented' : ''}" style="--bar-width: ${Math.round((Math.abs(item.points) / max) * 100)}%; --bar-segments: ${Math.min(24, Math.max(1, Number.parseInt(item.count, 10) || 1))}"></span></span>
                    <span class="stats2-earning-points point-rule-delta paradigm-pill ${pointPillClassForKind(kind, item.points)}">${escapeHtml(formatSignedPoints(item.points))}</span>
                    <span class="stats2-earning-chevron icon" data-icon="chevron-right" data-icon-size="16" data-icon-stroke="2.6" aria-hidden="true"></span>
                </a>
            `; }).join('')}
            ${items.length > visibleItems.length ? `
                <button type="button" class="stats2-show-all-items" data-highlight-show-all="${escapeHtml(kind)}">
                    <span>${escapeHtml(`Show all ${items.length} ${label} items`)}</span>
                    <span class="icon" data-icon="chevron-right" data-icon-stroke="2.6" aria-hidden="true"></span>
                </button>
            ` : ''}
        </div>
    `;
}

function renderHighlights() {
    const timezone = String(kids.find((kid) => kid.familyTimezone)?.familyTimezone || '').trim();
    const start = selectedWeekStart(timezone);
    const kid = kids.find((item) => String(item.id) === selectedHighlightKidId) || kids[0];
    const points = pointsByKid.get(String(kid?.id)) || {};
    const events = eventsForWeek(points, start, addDays(start, 7), timezone);
    const earnItems = ruleSummaryItems(events, 'earn');
    const lossItems = ruleSummaryItems(events, 'loss');
    const spendItems = ruleSummaryItems(events, 'spend');
    renderHighlightTabs();
    stats2Highlights.innerHTML = [
        renderSummaryPanel('earn', 'Biggest Earner', earnItems),
        renderSummaryPanel('loss', 'Biggest Loss', lossItems),
        renderSummaryPanel('spend', 'Biggest Spend', spendItems),
    ].join('');
    window.hydrateIcons?.(stats2Highlights);
}

function render() {
    const timezone = String(kids.find((kid) => kid.familyTimezone)?.familyTimezone || '').trim();
    const start = selectedWeekStart(timezone);
    const rows = rowsForSelectedWeek();
    renderBalanceRace(rows, start !== currentWeekStart(timezone));
    stats2RaceCards.innerHTML = [
        renderRaceCard('earned', 'thumbs-up', 'Most earned this week', rows, (row) => row.earned, formatSignedPoints),
        renderRaceCard('lost', 'thumbs-down', 'Fewest points lost', rows, (row) => row.lost, (value) => `-${Number.parseInt(value, 10) || 0} pts`, false),
        renderRaceCard('improved', 'trending-up', 'Earned vs last week', rows, (row) => row.earnedRatio, formatPercent),
        renderRaceCard('closest', 'trending-down', 'Lost vs last week', rows, (row) => row.lostRatio, formatPercent, false),
    ].join('');
    renderHighlights();
    window.hydrateIcons?.(document);
}

function changeStatsWeek(offset) {
    const timezone = String(kids.find((kid) => kid.familyTimezone)?.familyTimezone || '').trim();
    const currentStart = currentWeekStart(timezone);
    const nextStart = addDays(selectedWeekStart(timezone), offset * 7);
    if (!nextStart || nextStart > currentStart) return;
    selectedStatsWeekStart = nextStart;
    expandedHighlightKind = '';
    showAllHighlightKind = '';
    render();
}

stats2PreviousWeek?.addEventListener('click', () => changeStatsWeek(-1));
stats2NextWeek?.addEventListener('click', () => changeStatsWeek(1));

stats2HighlightTabs?.addEventListener('click', (event) => {
    const button = event.target.closest('[data-highlight-kid]');
    if (!button) return;
    selectedHighlightKidId = String(button.dataset.highlightKid || '');
    expandedHighlightKind = '';
    showAllHighlightKind = '';
    renderHighlights();
});

stats2Highlights?.addEventListener('click', (event) => {
    const showAllButton = event.target.closest('[data-highlight-show-all]');
    if (showAllButton && stats2Highlights.contains(showAllButton)) {
        showAllHighlightKind = String(showAllButton.dataset.highlightShowAll || '');
        renderHighlights();
        return;
    }
    const summary = event.target.closest('.stats2-highlight-summary');
    if (!summary || !stats2Highlights.contains(summary)) return;
    const card = summary.closest('[data-highlight-kind]');
    if (!card) return;
    if (String(card.dataset.highlightExpandable || '') !== '1') return;
    const kind = String(card.dataset.highlightKind || '');
    expandedHighlightKind = expandedHighlightKind === kind ? '' : kind;
    showAllHighlightKind = '';
    renderHighlights();
});

document.addEventListener('DOMContentLoaded', async () => {
    window.hydrateIcons?.(document);
    try {
        kids = await fetchJson(`${API_BASE}/kids?view=reward_nav`);
        selectedHighlightKidId = String(kids[0]?.id || '');
        const entries = await Promise.all(kids.map(async (kid) => [
            String(kid.id),
            await fetchJson(`${API_BASE}/kids/${encodeURIComponent(kid.id)}/points?limit=${POINT_HISTORY_LIMIT}`),
        ]));
        pointsByKid = new Map(entries);
        render();
    } catch (error) {
        showError(error.message || 'Failed to load stats.');
    }
});
