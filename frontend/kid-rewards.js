const API_BASE = `${window.location.origin}/api`;
const DEFAULT_POINT_HISTORY_LIMIT = 500;
const RACE_POINT_HISTORY_LIMIT = 5000;

const kidRewardAvatarSwitcher = document.getElementById('kidRewardAvatarSwitcher');
const kidRewardsError = document.getElementById('kidRewardsError');
const kidRewardsRaceTitle = document.getElementById('kidRewardsRaceTitle');
const kidRewardsWeekMeta = document.getElementById('kidRewardsWeekMeta');
const kidRewardsDaysLeft = document.getElementById('kidRewardsDaysLeft');
const kidRewardsBalanceRace = document.getElementById('kidRewardsBalanceRace');
const kidRewardsRaceCards = document.getElementById('kidRewardsRaceCards');
const kidPointHistory = document.getElementById('kidPointHistory');
const params = new URLSearchParams(window.location.search);
const requestedKidId = String(params.get('id') || params.get('kidId') || '').trim();
const requestedHistoryDayKey = /^\d{4}-\d{2}-\d{2}$/.test(String(params.get('day') || '')) ? String(params.get('day')) : '';
const requestedHistoryEventId = Number.parseInt(params.get('eventId') || '', 10);
// A calendar link can point to an event older than the normal recent-history window.
const POINT_HISTORY_LIMIT = requestedHistoryEventId > 0 ? 5000 : DEFAULT_POINT_HISTORY_LIMIT;

let kids = [];
let selectedKidId = '';
let pointData = { totalPoints: 0, events: [] };
let pointDataByKid = new Map();
let selectedHistoryDayKey = '';
let selectedRaceWeekStart = '';
let raceLoading = true;

function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
}

function showMessage(node, text) {
    if (!node) return;
    node.textContent = text || '';
    node.classList.toggle('hidden', !text);
}

function showError(text) {
    showMessage(kidRewardsError, text || '');
}

async function fetchJson(url, options = {}) {
    const response = await fetch(url, {
        headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
        ...options,
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
        throw new Error(data.error || `Request failed (${response.status})`);
    }
    return data;
}

function selectedFamilyTimezone() {
    const kid = kids.find((item) => String(item?.id || '') === selectedKidId);
    return String(kid?.familyTimezone || '').trim();
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
    const endText = end.toLocaleDateString([], {
        timeZone: 'UTC',
        month: start.getUTCMonth() === end.getUTCMonth() ? undefined : 'short',
        day: 'numeric',
    });
    return `${startText} - ${endText}`;
}

function relativeWeekLabel(startKey, currentStartKey) {
    const start = dateFromKey(startKey);
    const currentStart = dateFromKey(currentStartKey);
    if (!start || !currentStart) return 'This week';
    const diffWeeks = Math.round((currentStart.getTime() - start.getTime()) / (7 * 24 * 60 * 60 * 1000));
    if (diffWeeks === 0) return 'This week';
    if (diffWeeks === 1) return 'Last week';
    return diffWeeks > 1 ? `-${diffWeeks} weeks` : `+${Math.abs(diffWeeks)} weeks`;
}

function formatPoints(value) { return `${(Number.parseInt(value, 10) || 0).toLocaleString()} pts`; }
function formatSignedPoints(value) { const number = Number.parseInt(value, 10) || 0; return `${number >= 0 ? '+' : ''}${number.toLocaleString()} pts`; }
function formatCompactSignedPoints(value) {
    const number = Number.parseInt(value, 10) || 0;
    if (Math.abs(number) < 1000) return formatSignedPoints(number);
    return `${number >= 0 ? '+' : '-'}${(Math.abs(number) / 1000).toFixed(1).replace(/\.0$/, '')}k`;
}
function formatCompactLostPoints(value) {
    const number = Math.abs(Number.parseInt(value, 10) || 0);
    if (number < 1000) return `-${number.toLocaleString()} pts`;
    return `-${(number / 1000).toFixed(1).replace(/\.0$/, '')}k`;
}
function formatPercent(value) { return `${Math.abs(Math.round(Number(value) || 0))}%`; }
function sameStatValue(a, b) { return Math.abs((Number(a) || 0) - (Number(b) || 0)) < 0.0001; }
function racePillClass(theme) { return theme === 'lost' || theme === 'closest' ? 'negative' : 'positive'; }

function balanceAtWeekEnd(points, endKey, timezone) {
    const [bucket, bucketEntry] = Object.entries(points?.rewardBucketTotals || {})[0] || [];
    const normalizedBucket = String(bucket || '').trim().toLowerCase();
    const currentTotal = Number.parseInt(bucketEntry?.totalPoints, 10);
    if (!normalizedBucket || !Number.isFinite(currentTotal)) return Number.parseInt(points?.totalPoints, 10) || 0;
    const laterDelta = (points?.events || []).reduce((sum, event) => {
        const eventKey = dayKey(parseDate(event?.createdAt), timezone);
        if (!eventKey || eventKey < endKey) return sum;
        const rewardType = String(event?.rule?.rewardType || '').trim().toLowerCase();
        return rewardType && rewardType !== normalizedBucket ? sum : sum + (Number.parseInt(event?.pointsDelta, 10) || 0);
    }, 0);
    return currentTotal - laterDelta;
}

function periodSummary(events, startKey, endKey, timezone) {
    return (events || []).reduce((summary, event) => {
        const key = dayKey(parseDate(event?.createdAt), timezone);
        if (!key || key < startKey || key >= endKey) return summary;
        const delta = Number.parseInt(event?.pointsDelta, 10) || 0;
        if (delta > 0) summary.earned += delta;
        if (delta < 0 && String(event?.rule?.ruleKind || '') !== 'redeemed_reward') summary.lost += Math.abs(delta);
        return summary;
    }, { earned: 0, lost: 0 });
}

function avatar(kid, crowned = false) {
    const name = String(kid?.name || 'Kid').trim();
    const url = String(kid?.avatarUrl || '').trim();
    const content = url ? `<img src="${escapeHtml(url)}" alt="${escapeHtml(name)}">` : `<span>${escapeHtml(name.charAt(0).toUpperCase())}</span>`;
    return `<span class="kid-rewards-race-avatar">${content}${crowned ? '<b aria-hidden="true">👑</b>' : ''}</span>`;
}

function currentRaceWeekStart(timezone) { return weekStart(dayKey(new Date(), timezone)); }

function weekTimeLeftLabel(now, timezone) {
    const currentKey = dayKey(now, timezone);
    const dayIndex = dateFromKey(currentKey)?.getUTCDay() ?? 1;
    const daysLeft = Math.max(0, 6 - ((dayIndex + 6) % 7));
    if (daysLeft > 0) return `${daysLeft} ${daysLeft === 1 ? 'day' : 'days'} left`;
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: timezone || undefined, hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(now);
    const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    const elapsedSeconds = ((Number.parseInt(values.hour, 10) || 0) * 3600) + ((Number.parseInt(values.minute, 10) || 0) * 60) + (Number.parseInt(values.second, 10) || 0);
    const hoursLeft = Math.max(0, Math.ceil((86400 - elapsedSeconds) / 3600));
    return `${hoursLeft} ${hoursLeft === 1 ? 'hour' : 'hours'} left`;
}

function rowsForRace(startKey, timezone) {
    const next = addDays(startKey, 7);
    const previous = addDays(startKey, -7);
    return kids.map((kid) => {
        const points = pointDataByKid.get(String(kid.id)) || {};
        const current = periodSummary(points.events, startKey, next, timezone);
        const last = periodSummary(points.events, previous, startKey, timezone);
        const ratio = (now, before) => before <= 0 ? (now > 0 ? 100 : 0) : (now / before) * 100;
        return { kid, total: balanceAtWeekEnd(points, next, timezone), earned: current.earned, lost: current.lost, earnedRatio: ratio(current.earned, last.earned), lostRatio: ratio(current.lost, last.lost) };
    });
}

function renderRaceCard(theme, icon, title, rows, getter, formatter, higherWins = true) {
    const winner = [...rows].sort((a, b) => higherWins ? getter(b) - getter(a) : getter(a) - getter(b))[0];
    const hasWinner = winner && rows.filter((row) => sameStatValue(getter(row), getter(winner))).length === 1;
    return `<article class="kid-rewards-race-card kid-rewards-race-card--${escapeHtml(theme)}"><h3><span class="icon" data-icon="${icon}" data-icon-size="16" aria-hidden="true"></span>${escapeHtml(title)}</h3><div>${rows.map((row) => `<div class="kid-rewards-mini-racer${hasWinner && winner.kid.id === row.kid.id ? ' is-leader' : ''}">${avatar(row.kid, hasWinner && winner.kid.id === row.kid.id)}<span><b>${escapeHtml(row.kid.name)}</b><em class="point-rule-delta paradigm-pill ${racePillClass(theme)}">${escapeHtml(formatter(getter(row)))}</em></span></div>`).join('')}</div></article>`;
}

function renderRace(weekStartOverride = '') {
    if (!kids.length) return;
    if (raceLoading) {
        kidRewardsBalanceRace.innerHTML = '<div class="kid-rewards-race-loading"><span class="app-spinner" aria-hidden="true"></span><span>Loading race…</span></div>';
        kidRewardsRaceCards.innerHTML = '';
        return;
    }
    const timezone = selectedFamilyTimezone();
    const currentWeekStart = currentRaceWeekStart(timezone);
    const raceWeekStart = weekStartOverride || selectedRaceWeekStart || currentWeekStart;
    const rows = rowsForRace(raceWeekStart, timezone);
    const isCurrentWeek = raceWeekStart === currentWeekStart;
    kidRewardsRaceTitle.textContent = relativeWeekLabel(raceWeekStart, currentWeekStart);
    kidRewardsWeekMeta.textContent = weekLabel(raceWeekStart);
    kidRewardsDaysLeft.innerHTML = isCurrentWeek
        ? `<span class="icon" data-icon="calendar" data-icon-size="13" data-icon-stroke="2.2" aria-hidden="true"></span><span>${escapeHtml(weekTimeLeftLabel(new Date(), timezone))}</span>`
        : `<span class="icon" data-icon="circle-check" data-icon-size="13" data-icon-stroke="2.2" aria-hidden="true"></span><span>Completed</span>`;
    const sorted = [...rows].sort((a, b) => b.total - a.total);
    const max = Math.max(1, ...sorted.map((row) => Math.max(0, row.total)));
    const lead = sorted[0] && sorted[1] ? sorted[0].total - sorted[1].total : 0;
    kidRewardsBalanceRace.innerHTML = `<div class="kid-rewards-racer-list">${sorted.map((row, index) => `<div class="kid-rewards-racer-row">${avatar(row.kid, lead > 0 && index === 0)}<div class="kid-rewards-racer-meta"><b>${escapeHtml(row.kid.name)}</b><em class="point-rule-delta paradigm-pill balance">${escapeHtml(formatPoints(row.total))}</em></div><i><span style="width:${Math.max(8, Math.round((Math.max(0, row.total) / max) * 100))}%"></span></i></div>`).join('')}</div><div class="kid-rewards-race-lead"><strong>${lead > 0 ? `${escapeHtml(sorted[0].kid.name)} ${isCurrentWeek ? 'leads' : 'wins'}` : 'All tied'}</strong>${lead > 0 && isCurrentWeek ? `<span>by ${escapeHtml(formatPoints(lead))}</span>` : ''}</div>`;
    kidRewardsRaceCards.innerHTML = [renderRaceCard('earned', 'thumbs-up', 'Most earned this week', rows, (row) => row.earned, formatCompactSignedPoints), renderRaceCard('lost', 'thumbs-down', 'Fewest points lost', rows, (row) => row.lost, formatCompactLostPoints, false), renderRaceCard('improved', 'trending-up', 'Earned vs last week', rows, (row) => row.earnedRatio, formatPercent), renderRaceCard('closest', 'trending-down', 'Lost vs last week', rows, (row) => row.lostRatio, formatPercent, false)].join('');
    hydrateIcons(kidRewardsRaceCards);
    hydrateIcons(kidRewardsDaysLeft);
}

function rememberedKidId() {
    return String(window.KidAppNavigation?.getKidId?.() || '').trim();
}

function isKidUserMode() {
    return window.KidAppNavigation?.getMode?.() === 'kid';
}

function initialKidId() {
    const candidates = [requestedKidId, rememberedKidId()];
    const match = candidates.find((kidId) => kidId && kids.some((kid) => String(kid?.id || '') === kidId));
    return match || String(kids[0]?.id || '');
}

function syncSelectedKidNavigation() {
    if (window.KidAppNavigation && selectedKidId) {
        window.KidAppNavigation.setKidId(selectedKidId);
    }
}

function renderKids() {
    if (!kidRewardAvatarSwitcher) return;
    if (isKidUserMode() || !window.KidAppNavigation?.renderKidAvatarSwitcher) {
        kidRewardAvatarSwitcher.innerHTML = '';
        kidRewardAvatarSwitcher.classList.add('hidden');
        return;
    }
    window.KidAppNavigation.renderKidAvatarSwitcher(kidRewardAvatarSwitcher, kids, {
        selectedKidId,
        onSelect: async (kidId) => {
            if (!kidId || kidId === selectedKidId) return;
            selectedKidId = kidId;
            syncSelectedKidNavigation();
            selectedHistoryDayKey = '';
            showError('');
            try {
                await loadPointsForSelectedKid();
                render();
            } catch (error) {
                showError(error.message || 'Failed to load rewards.');
            }
        },
    });
}

function renderHistory() {
    selectedHistoryDayKey = window.PointHistoryCommon.render(kidPointHistory, {
        selectedKidId,
        events: kidActivityEventsWithBalance(),
        selectedDayKey: selectedHistoryDayKey,
        familyTimezone: selectedFamilyTimezone(),
        showDelete: false,
        showBalance: true,
        highlightEventId: requestedHistoryEventId,
        mode: 'all',
        emptyDay: 'No point activity for this day.',
        onWeekChange: (anchorDayKey, nextWeekStart) => {
            nextWeekStart = nextWeekStart || weekStart(anchorDayKey);
            selectedRaceWeekStart = nextWeekStart;
            renderRace(nextWeekStart);
            window.requestAnimationFrame(() => renderRace(nextWeekStart));
        },
        onWeekRendered: (anchorDayKey, renderedWeekStart) => {
            selectedRaceWeekStart = renderedWeekStart || weekStart(anchorDayKey);
        },
    });
}

function currentRewardBucketEntry() {
    const [bucket, entry] = Object.entries(pointData.rewardBucketTotals || {})
        .find(([key]) => String(key || '').trim()) || [];
    return {
        bucket: String(bucket || '').trim().toLowerCase(),
        balance: bucket ? Number.parseInt(entry?.totalPoints ?? entry ?? 0, 10) || 0 : Number.parseInt(pointData.totalPoints, 10) || 0,
    };
}

function kidActivityEventsWithBalance() {
    const events = Array.isArray(pointData.events) ? pointData.events : [];
    const rewardBucket = currentRewardBucketEntry();
    let balance = rewardBucket.balance;
    return [...events]
        .filter((event) => {
            const rule = event?.rule || {};
            return String(rule?.ruleKind || '') !== 'redeemed_reward'
                || String(rule?.rewardType || '').trim().toLowerCase() === rewardBucket.bucket;
        })
        .sort((a, b) => {
            const timeDiff = new Date(b?.createdAt || 0).getTime() - new Date(a?.createdAt || 0).getTime();
            return timeDiff || ((Number.parseInt(b?.eventId, 10) || 0) - (Number.parseInt(a?.eventId, 10) || 0));
        })
        .map((event) => {
            const delta = Number.parseInt(event?.pointsDelta, 10) || 0;
            const result = { ...event, balanceAfter: balance };
            balance -= delta;
            return result;
        });
}

function handleHistoryDayClick(event) {
    const dayButton = event.target.closest('[data-history-day]');
    if (!dayButton) return;
    const nextDayKey = String(dayButton.dataset.historyDay || '');
    if (!nextDayKey) return;
    selectedHistoryDayKey = nextDayKey;
    kidPointHistory.dataset.pointHistoryWeekAnchorDayKey = nextDayKey;
    renderHistory();
}

function render() {
    renderKids();
    renderHistory();
    renderRace();
    hydrateIcons(document);
}


async function loadPointsForSelectedKid() {
    if (!selectedKidId) {
        pointData = { totalPoints: 0, events: [] };
        return;
    }
    const cached = pointDataByKid.get(selectedKidId);
    const data = cached || await fetchJson(`${API_BASE}/kids/${encodeURIComponent(selectedKidId)}/points?limit=${POINT_HISTORY_LIMIT}`);
    pointData = data || { totalPoints: 0, events: [] };
}

async function loadRacePoints() {
    const entries = await Promise.all(kids.map(async (kid) => {
        try {
            const data = await fetchJson(`${API_BASE}/kids/${encodeURIComponent(kid.id)}/points?limit=${RACE_POINT_HISTORY_LIMIT}`);
            return [String(kid.id), data];
        } catch (error) {
            return null;
        }
    }));
    entries.filter(Boolean).forEach(([kidId, data]) => pointDataByKid.set(kidId, data || { totalPoints: 0, events: [] }));
    raceLoading = false;
    renderRace();
}

async function loadInitialData() {
    showError('');
    const kidsData = await fetchJson(`${API_BASE}/kids?view=reward_nav`);
    kids = Array.isArray(kidsData) ? kidsData : [];
    selectedKidId = initialKidId();
    syncSelectedKidNavigation();
    selectedHistoryDayKey = requestedHistoryDayKey;
    await loadPointsForSelectedKid();
    pointDataByKid.set(selectedKidId, pointData);
    render();
    loadRacePoints();
    if (requestedHistoryEventId > 0) {
        window.requestAnimationFrame(() => {
            kidPointHistory.querySelector(`[data-event-id="${requestedHistoryEventId}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        });
    }
}

kidPointHistory?.addEventListener('click', (event) => {
    if (event.target.closest('.point-week-nav-btn[data-history-week-anchor]')) return;
    handleHistoryDayClick(event);
});

loadInitialData().catch((error) => {
    showError(error.message || 'Failed to load rewards.');
});
