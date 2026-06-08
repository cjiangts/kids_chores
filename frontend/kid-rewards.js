const API_BASE = `${window.location.origin}/api`;
const POINT_HISTORY_LIMIT = 200;

const kidRewardTabs = document.getElementById('kidRewardTabs');
const kidRewardsError = document.getElementById('kidRewardsError');
const kidRedeemHistory = document.getElementById('kidRedeemHistory');
const kidPointHistory = document.getElementById('kidPointHistory');
const kidRewardRules = document.getElementById('kidRewardRules');
const kidRewardBucketTabs = document.getElementById('kidRewardBucketTabs');
const params = new URLSearchParams(window.location.search);
const requestedKidId = String(params.get('id') || params.get('kidId') || '').trim();

let kids = [];
let selectedKidId = '';
let pointData = { totalPoints: 0, events: [] };
let pointTotalsByKidId = new Map();
let rewardBucketTotalsByKidId = new Map();
let rules = [];
let activeRewardBucket = '';
let selectedRedeemHistoryDayKey = '';
let selectedPointHistoryDayKey = '';

function escapeHtml(value) {
    return String(value || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
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

function kidName(kid) {
    return String(kid?.name || kid?.id || '').trim();
}


function selectedFamilyTimezone() {
    const kid = kids.find((item) => String(item?.id || '') === selectedKidId);
    return String(kid?.familyTimezone || '').trim();
}

function todayHistoryDayKey() {
    return window.PointHistoryCommon.dateKeyInTimezone(new Date(), selectedFamilyTimezone());
}

function formatDelta(value) {
    const delta = Number.parseInt(value, 10) || 0;
    return `${delta > 0 ? '+' : ''}${delta}`;
}

function selectedBalance() {
    return Number.parseInt(pointTotalsByKidId.get(selectedKidId), 10) || 0;
}

function normalizeRewardBucketTotals(value) {
    const source = value && typeof value === 'object' ? value : {};
    const result = {};
    Object.entries(source).forEach(([bucket, entry]) => {
        const normalized = String(bucket || '').trim().toLowerCase();
        if (!normalized) return;
        result[normalized] = Number.parseInt(entry?.totalPoints ?? entry ?? 0, 10) || 0;
    });
    return result;
}

function rewardBucketTotalForKid(kidId, bucket) {
    const totals = rewardBucketTotalsByKidId.get(String(kidId || '')) || normalizeRewardBucketTotals(pointData.rewardBucketTotals);
    return Number.parseInt(totals?.[bucket], 10) || 0;
}

function selectedRewardBucketBalance(bucket) {
    return rewardBucketTotalForKid(selectedKidId, bucket);
}

function rewardBucketLabel(bucket) {
    const normalized = String(bucket || '').trim().toLowerCase();
    return normalized.replace(/[_-]+/g, ' ').replace(/\b\w/g, (ch) => ch.toUpperCase()).trim()
        || 'Reward';
}

function rewardBuckets() {
    const buckets = new Set();
    rules
        .filter((rule) => isRedeemedRewardRule(rule))
        .forEach((rule) => buckets.add(ruleBucket(rule)));
    return Array.from(buckets).filter(Boolean).sort((a, b) => {
        return rewardBucketLabel(a).localeCompare(rewardBucketLabel(b));
    });
}

function rewardTabParts(label, value) {
    const nbsp = '\u00a0';
    const labelText = String(label || '').trim();
    const totalText = String(Number.parseInt(value, 10) || 0);
    return {
        label: labelText.padEnd(5, nbsp),
        gap: nbsp.repeat(5),
        balance: `${totalText.padStart(3, nbsp)} pts`,
    };
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

function ruleBucket(rule) {
    const kind = String(rule?.ruleKind || '');
    if (kind === 'deduction_event') return 'corrections';
    if (kind === 'redeemed_reward') return String(rule?.rewardType || '').trim().toLowerCase();
    if (kind === 'in_app_chore' || kind === 'off_app_chore' || kind === 'bonus_event') return 'earn';
    return '';
}

function isRedeemedRewardRule(rule) {
    return String(rule?.ruleKind || '') === 'redeemed_reward';
}

function rulePointValue(rule) {
    const maxPoint = Number.parseInt(rule?.maxPoint, 10) || 0;
    if (isRedeemedRewardRule(rule) || rule?.ruleKind === 'deduction_event') {
        return -Math.abs(maxPoint);
    }
    return Math.abs(maxPoint);
}

function ruleCost(rule) {
    return Math.abs(rulePointValue(rule));
}

function compareRewardRulesByCost(a, b) {
    const costDiff = ruleCost(a) - ruleCost(b);
    if (costDiff !== 0) return costDiff;
    return String(a?.name || '').localeCompare(String(b?.name || ''));
}

function ruleRewardProgress(rule) {
    const cost = ruleCost(rule);
    const balance = selectedRewardBucketBalance(ruleBucket(rule));
    const remaining = Math.max(cost - balance, 0);
    const progress = cost > 0 ? Math.min(Math.max(balance / cost, 0), 1) : 1;
    return {
        cost,
        remaining,
        percent: Math.round(progress * 100),
    };
}

function canRedeemRule(rule) {
    if (!isRedeemedRewardRule(rule)) return false;
    return selectedRewardBucketBalance(ruleBucket(rule)) >= ruleCost(rule);
}

function ruleIconHtml(rule) {
    const triggerKey = String(rule?.triggerKey || '').trim();
    if (rule?.ruleKind === 'in_app_chore' && triggerKey && typeof window.subjectIcon === 'function') {
        return window.subjectIcon(triggerKey, { size: 32 });
    }
    if (rule?.emoji) {
        return escapeHtml(rule.emoji);
    }
    if (isRedeemedRewardRule(rule)) {
        return icon('gift', { size: 18 });
    }
    return escapeHtml(rule?.ruleKind === 'deduction_event' ? '-' : '+');
}

function rulePointsLabel(rule) {
    const value = rulePointValue(rule);
    if (isRedeemedRewardRule(rule)) {
        return `${ruleCost(rule)} pts`;
    }
    if (rule?.ruleKind === 'off_app_chore') {
        return `up to +${value}`;
    }
    return `${value > 0 ? '+' : ''}${value} pts`;
}

function ruleStatusHtml(rule) {
    if (!isRedeemedRewardRule(rule)) {
        return '<span class="kid-reward-rule-status muted">Rule</span>';
    }
    const { remaining } = ruleRewardProgress(rule);
    if (remaining <= 0) {
        return '<span class="kid-reward-rule-status available">Available</span>';
    }
    return `<span class="kid-reward-rule-status muted">${escapeHtml(`${remaining} pts to go`)}</span>`;
}

function renderKids() {
    if (!kidRewardTabs) return;
    if (isKidUserMode() || !window.KidAppNavigation?.renderKidSelector) {
        kidRewardTabs.innerHTML = '';
        kidRewardTabs.classList.add('hidden');
        return;
    }
    window.KidAppNavigation.renderKidSelector(kidRewardTabs, kids, {
        selectedKidId,
        onSelect: async (kidId) => {
            if (!kidId || kidId === selectedKidId) return;
            selectedKidId = kidId;
            syncSelectedKidNavigation();
            selectedRedeemHistoryDayKey = '';
            selectedPointHistoryDayKey = '';
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
    selectedRedeemHistoryDayKey = window.PointHistoryCommon.render(kidRedeemHistory, {
        selectedKidId,
        events: Array.isArray(pointData.events) ? pointData.events : [],
        selectedDayKey: selectedRedeemHistoryDayKey,
        familyTimezone: selectedFamilyTimezone(),
        showDelete: false,
        mode: 'redeemed',
        emptyDay: 'No rewards redeemed for this day.',
    });
    selectedPointHistoryDayKey = window.PointHistoryCommon.render(kidPointHistory, {
        selectedKidId,
        events: Array.isArray(pointData.events) ? pointData.events : [],
        selectedDayKey: selectedPointHistoryDayKey,
        familyTimezone: selectedFamilyTimezone(),
        showDelete: false,
        emptyDay: 'No point activity for this day.',
    });
}

function handleHistoryDayClick(event, historyKind) {
    const dayButton = event.target.closest('[data-history-day]');
    if (!dayButton) return;
    const nextDayKey = String(dayButton.dataset.historyDay || '');
    if (!nextDayKey) return;
    if (historyKind === 'redeemed') {
        selectedRedeemHistoryDayKey = nextDayKey === selectedRedeemHistoryDayKey ? '' : nextDayKey;
        renderHistory();
        return;
    }
    selectedPointHistoryDayKey = nextDayKey === selectedPointHistoryDayKey ? '' : nextDayKey;
    renderHistory();
}

function renderRuleTabs() {
    if (!kidRewardBucketTabs) return;
    const buckets = rewardBuckets();
    if (!buckets.includes(activeRewardBucket)) {
        activeRewardBucket = buckets[0] || '';
    }
    kidRewardBucketTabs.innerHTML = buckets.map((bucket) => {
        const tab = rewardTabParts(rewardBucketLabel(bucket), selectedRewardBucketBalance(bucket));
        const isActive = bucket === activeRewardBucket;
        return `
            <button type="button" class="cards-view-toggle-btn ${isActive ? 'active' : ''}" role="tab" aria-selected="${isActive ? 'true' : 'false'}" data-reward-bucket="${escapeHtml(bucket)}">
                <span class="cards-view-toggle-btn-icon" data-icon="gift" data-icon-size="16" data-icon-stroke="2.4"></span>
                <span class="point-rule-tab-long">${escapeHtml(tab.label)}${escapeHtml(tab.gap)}<span class="reward-tab-balance">${escapeHtml(tab.balance)}</span></span>
                <span class="point-rule-tab-short">${escapeHtml(tab.label)}${escapeHtml(tab.gap)}<span class="reward-tab-balance">${escapeHtml(tab.balance)}</span></span>
            </button>
        `;
    }).join('');
    hydrateIcons(kidRewardBucketTabs);
}

function renderRules() {
    if (!kidRewardRules) return;
    const visibleRules = rules
        .filter((rule) => rule?.isActive !== false)
        .filter((rule) => isRedeemedRewardRule(rule))
        .filter((rule) => ruleBucket(rule) === activeRewardBucket)
        .sort(compareRewardRulesByCost);
    if (!visibleRules.length) {
        kidRewardRules.innerHTML = '<div class="point-rule-empty">No rules in this bucket yet.</div>';
        return;
    }
    kidRewardRules.innerHTML = `
        <div class="point-template-frame parent-reward-template-frame">
            ${visibleRules.map((rule) => {
        const value = rulePointValue(rule);
        const isAffordable = canRedeemRule(rule);
        const signClass = isRedeemedRewardRule(rule)
            ? 'redeemed'
            : (value >= 0 ? 'positive' : 'negative');
        const progress = ruleRewardProgress(rule);
        const statusText = progress.remaining <= 0 ? 'Available' : `${progress.remaining} pts to go`;
        const ariaLabel = `${rule.name || 'Reward'}, ${progress.cost} pts, ${statusText}`;
        return `
            <div
                class="point-template-row parent-reward-template-row parent-reward-template-row--redeem reward-readonly-row ${isAffordable ? 'affordable' : 'locked'}"
                data-rule-id="${escapeHtml(rule.ruleId)}"
                aria-disabled="true"
                aria-label="${escapeHtml(ariaLabel)}"
                style="--reward-progress: ${escapeHtml(`${progress.percent}%`)};"
            >
                <span class="point-rule-emoji">${ruleIconHtml(rule)}</span>
                <span class="point-template-name">${escapeHtml(rule.name || 'Reward')}</span>
                <span class="point-rule-delta ${signClass}">${escapeHtml(rulePointsLabel(rule))}</span>
                <span class="kid-reward-rule-status-cell">${ruleStatusHtml(rule)}</span>
                ${isAffordable ? '' : '<span class="kid-reward-progress parent-reward-progress" aria-hidden="true"><span></span></span>'}
            </div>
        `;
    }).join('')}
        </div>
    `;
    hydrateIcons(kidRewardRules);
}

function render() {
    renderKids();
    renderHistory();
    renderRuleTabs();
    renderRules();
    hydrateIcons(document);
}

async function loadPointsForSelectedKid() {
    if (!selectedKidId) {
        pointData = { totalPoints: 0, events: [] };
        return;
    }
    const data = await fetchJson(`${API_BASE}/kids/${encodeURIComponent(selectedKidId)}/points?limit=${POINT_HISTORY_LIMIT}`);
    pointData = data || { totalPoints: 0, events: [] };
    pointTotalsByKidId.set(selectedKidId, Number.parseInt(pointData.totalPoints, 10) || 0);
    rewardBucketTotalsByKidId.set(selectedKidId, normalizeRewardBucketTotals(pointData.rewardBucketTotals));
}

async function loadInitialData() {
    showError('');
    const [kidsData, rulesData] = await Promise.all([
        fetchJson(`${API_BASE}/kids?view=reward_nav`),
        fetchJson(`${API_BASE}/points/rules?includeInactive=0`),
    ]);
    kids = Array.isArray(kidsData) ? kidsData : [];
    rules = Array.isArray(rulesData.rules) ? rulesData.rules : [];
    selectedKidId = initialKidId();
    syncSelectedKidNavigation();
    selectedRedeemHistoryDayKey = '';
    selectedPointHistoryDayKey = '';
    await loadPointsForSelectedKid();
    render();
}

kidRewardBucketTabs?.addEventListener('click', (event) => {
    const button = event.target.closest('[data-reward-bucket]');
    if (!button) return;
    const nextBucket = String(button.dataset.rewardBucket || '').trim();
    if (!rewardBuckets().includes(nextBucket) || nextBucket === activeRewardBucket) return;
    activeRewardBucket = nextBucket;
    renderRuleTabs();
    renderRules();
});

kidRedeemHistory?.addEventListener('click', (event) => {
    handleHistoryDayClick(event, 'redeemed');
});

kidPointHistory?.addEventListener('click', (event) => {
    handleHistoryDayClick(event, 'points');
});

kidRedeemHistory?.addEventListener('point-history-clear-filter', () => {
    selectedRedeemHistoryDayKey = '';
    renderHistory();
});

kidPointHistory?.addEventListener('point-history-clear-filter', () => {
    selectedPointHistoryDayKey = '';
    renderHistory();
});

loadInitialData().catch((error) => {
    showError(error.message || 'Failed to load rewards.');
});
