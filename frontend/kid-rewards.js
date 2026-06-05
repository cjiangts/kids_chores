const API_BASE = `${window.location.origin}/api`;

const kidRewardTabs = document.getElementById('kidRewardTabs');
const kidRewardsError = document.getElementById('kidRewardsError');
const kidRewardHistory = document.getElementById('kidRewardHistory');
const kidRewardRules = document.getElementById('kidRewardRules');
const rewardBucketTabs = Array.from(document.querySelectorAll('[data-reward-bucket]'));

const params = new URLSearchParams(window.location.search);
const requestedKidId = String(params.get('id') || params.get('kidId') || '').trim();

let kids = [];
let selectedKidId = '';
let pointData = { totalPoints: 0, events: [] };
let pointTotalsByKidId = new Map();
let rules = [];
let activeRewardBucket = 'rewards';
let selectedHistoryDayKey = '';

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

function formatBalance(value) {
    const total = Number.parseInt(value, 10) || 0;
    return `${total} pts`;
}

function selectedBalance() {
    return Number.parseInt(pointTotalsByKidId.get(selectedKidId), 10) || 0;
}

function ruleBucket(rule) {
    const kind = String(rule?.ruleKind || '');
    if (kind === 'deduction_event') return 'corrections';
    if (kind === 'redeemed_reward') return 'rewards';
    if (kind === 'in_app_chore' || kind === 'off_app_chore' || kind === 'bonus_event') return 'earn';
    return '';
}

function rulePointValue(rule) {
    if (rule?.ruleKind === 'off_app_chore') {
        return Number.parseInt(rule.rating3Points, 10) || 0;
    }
    return Number.parseInt(rule?.pointsDelta, 10) || 0;
}

function ruleIconHtml(rule) {
    const triggerKey = String(rule?.triggerKey || '').trim();
    if (rule?.ruleKind === 'in_app_chore' && triggerKey && typeof window.subjectIcon === 'function') {
        return window.subjectIcon(triggerKey, { size: 32 });
    }
    if (rule?.emoji) {
        return `<span class="point-rule-emoji">${escapeHtml(rule.emoji)}</span>`;
    }
    if (rule?.ruleKind === 'redeemed_reward') {
        return `<span class="point-rule-emoji">${icon('gift', { size: 18 })}</span>`;
    }
    return `<span class="point-rule-emoji">${escapeHtml(rule?.ruleKind === 'deduction_event' ? '-' : '+')}</span>`;
}

function rulePointsLabel(rule) {
    const value = rulePointValue(rule);
    if (rule?.ruleKind === 'redeemed_reward') {
        return `${Math.abs(value)} pts`;
    }
    if (rule?.ruleKind === 'off_app_chore') {
        return `up to +${value}`;
    }
    return `${value > 0 ? '+' : ''}${value} pts`;
}

function ruleStatusHtml(rule) {
    if (rule?.ruleKind !== 'redeemed_reward') {
        return '<span class="kid-reward-rule-status muted">Rule</span>';
    }
    const cost = Math.abs(rulePointValue(rule));
    const remaining = cost - selectedBalance();
    if (remaining <= 0) {
        return '<span class="kid-reward-rule-status available">Available</span>';
    }
    return `<span class="kid-reward-rule-status muted">${escapeHtml(`${remaining} pts to go`)}</span>`;
}

function renderKids() {
    if (!kidRewardTabs) return;
    if (!kids.length) {
        kidRewardTabs.innerHTML = '';
        kidRewardTabs.classList.add('hidden');
        return;
    }
    kidRewardTabs.innerHTML = kids.map((kid) => {
        const id = String(kid.id || '');
        const isActive = id === selectedKidId;
        const total = Number.parseInt(pointTotalsByKidId.get(id), 10) || 0;
        const totalClass = total < 0 ? ' negative' : (total > 0 ? ' positive' : '');
        return `
            <button type="button" class="kid-nav-card${isActive ? ' active' : ''}" role="tab" aria-selected="${isActive ? 'true' : 'false'}" data-kid-id="${escapeHtml(id)}">
                ${icon('user', { className: 'kid-nav-card-icon', strokeWidth: 2 })}
                <span>${escapeHtml(kidName(kid))}</span>
                <span class="kid-nav-card-meta point-kid-total${totalClass}">${escapeHtml(formatBalance(total))}</span>
            </button>
        `;
    }).join('');
    kidRewardTabs.classList.remove('hidden');
}

function renderHistory() {
    selectedHistoryDayKey = window.PointHistoryCommon.render(kidRewardHistory, {
        selectedKidId,
        events: Array.isArray(pointData.events) ? pointData.events : [],
        selectedDayKey: selectedHistoryDayKey,
        familyTimezone: selectedFamilyTimezone(),
        showDelete: false,
    });
}

function renderRuleTabs() {
    rewardBucketTabs.forEach((tab) => {
        tab.classList.toggle('active', tab.dataset.rewardBucket === activeRewardBucket);
    });
}

function renderRules() {
    if (!kidRewardRules) return;
    const visibleRules = rules
        .filter((rule) => rule?.isActive !== false)
        .filter((rule) => ruleBucket(rule) === activeRewardBucket);
    if (!visibleRules.length) {
        kidRewardRules.innerHTML = '<div class="point-rule-empty">No rules in this bucket yet.</div>';
        return;
    }
    kidRewardRules.innerHTML = `
        <div class="point-rule-table kid-reward-rule-table">
            ${visibleRules.map((rule) => {
        const value = rulePointValue(rule);
        const signClass = rule?.ruleKind === 'redeemed_reward'
            ? 'redeemed'
            : (value >= 0 ? 'positive' : 'negative');
        return `
            <div class="point-rule-table-row kid-reward-rule-row" data-rule-id="${escapeHtml(rule.ruleId)}">
                <div class="point-rule-cell kid-reward-rule-icon">${ruleIconHtml(rule)}</div>
                <div class="point-rule-cell kid-reward-rule-name">${escapeHtml(rule.name || 'Reward')}</div>
                <div class="point-rule-cell"><span class="point-rule-delta ${signClass}">${escapeHtml(rulePointsLabel(rule))}</span></div>
                <div class="point-rule-cell kid-reward-rule-status-cell">${ruleStatusHtml(rule)}</div>
            </div>
        `;
    }).join('')}
        </div>
    `;
    hydrateIcons(kidRewardRules);
}

function render() {
    if (window.KidAppNavigation) {
        window.KidAppNavigation.setKidId(selectedKidId);
    }
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
    const data = await fetchJson(`${API_BASE}/kids/${encodeURIComponent(selectedKidId)}/points?limit=80`);
    pointData = data || { totalPoints: 0, events: [] };
    pointTotalsByKidId.set(selectedKidId, Number.parseInt(pointData.totalPoints, 10) || 0);
}

async function loadPointTotalsForKids() {
    const entries = await Promise.all(kids.map(async (kid) => {
        const id = String(kid.id || '');
        if (!id) return null;
        const data = await fetchJson(`${API_BASE}/kids/${encodeURIComponent(id)}/points?limit=1`);
        return [id, Number.parseInt(data.totalPoints, 10) || 0];
    }));
    pointTotalsByKidId = new Map(entries.filter(Boolean));
}

async function loadInitialData() {
    showError('');
    const [kidsData, rulesData] = await Promise.all([
        fetchJson(`${API_BASE}/kids?view=admin`),
        fetchJson(`${API_BASE}/points/rules?includeInactive=0`),
    ]);
    kids = Array.isArray(kidsData) ? kidsData : [];
    rules = Array.isArray(rulesData.rules) ? rulesData.rules : [];
    selectedKidId = requestedKidId && kids.some((kid) => String(kid?.id || '') === requestedKidId)
        ? requestedKidId
        : String(kids[0]?.id || '');
    selectedHistoryDayKey = todayHistoryDayKey();
    await Promise.all([loadPointTotalsForKids(), loadPointsForSelectedKid()]);
    render();
}

kidRewardTabs?.addEventListener('click', async (event) => {
    const button = event.target.closest('[data-kid-id]');
    if (!button) return;
    const nextKidId = String(button.dataset.kidId || '');
    if (!nextKidId || nextKidId === selectedKidId) return;
    selectedKidId = nextKidId;
    selectedHistoryDayKey = todayHistoryDayKey();
    showError('');
    try {
        await loadPointsForSelectedKid();
        render();
    } catch (error) {
        showError(error.message || 'Failed to load rewards.');
    }
});

kidRewardHistory?.addEventListener('click', (event) => {
    const dayButton = event.target.closest('[data-history-day]');
    if (!dayButton) return;
    const nextDayKey = String(dayButton.dataset.historyDay || '');
    if (nextDayKey && nextDayKey !== selectedHistoryDayKey) {
        selectedHistoryDayKey = nextDayKey;
        renderHistory();
    }
});

rewardBucketTabs.forEach((tab) => {
    tab.addEventListener('click', () => {
        const nextBucket = tab.dataset.rewardBucket || 'rewards';
        if (nextBucket === activeRewardBucket) return;
        activeRewardBucket = nextBucket;
        renderRuleTabs();
        renderRules();
    });
});

loadInitialData().catch((error) => {
    showError(error.message || 'Failed to load rewards.');
});
