const API_BASE = `${window.location.origin}/api`;

const kidTabs = document.getElementById('kidTabs');
const logError = document.getElementById('logError');
const pointLogForm = document.getElementById('pointLogForm');
const pointNote = document.getElementById('pointNote');
const noteGroup = document.getElementById('noteGroup');
const submitPointLogBtn = document.getElementById('submitPointLogBtn');
const templateList = document.getElementById('templateList');
const selectionPanel = document.getElementById('selectionPanel');
const pointHistory = document.getElementById('pointHistory');
const pullTodaySessionsBtn = document.getElementById('pullTodaySessionsBtn');
const modeTabs = Array.from(document.querySelectorAll('[data-mode]'));
const initialParams = new URLSearchParams(window.location.search);
const requestedKidId = String(initialParams.get('kidId') || initialParams.get('id') || '').trim();
const requestedMode = normalizePointLogMode(initialParams.get('mode') || initialParams.get('tab'));

const MODE_META = {
    bonus: {
        title: 'Bonus Event Rules',
        empty: 'No active bonus event rules yet. Add Bonus Events from Rules.',
    },
    deduction: {
        title: 'Deduction Event Rules',
        empty: 'No active deduction event rules yet. Add Deduction Events from Rules.',
    },
    review: {
        title: 'Review Off-App Chores',
        empty: 'No off-app chores are waiting for review.',
    },
    redeemed: {
        title: 'Redeemed Reward Rules',
        empty: 'No active redeemed reward rules yet. Add rewards from Reward Catalog.',
    },
};

function normalizePointLogMode(value) {
    const raw = String(value || '').trim().toLowerCase().replace(/_/g, '-');
    if (raw === 'review' || raw === 'off-app' || raw === 'offapp' || raw === 'off-app-chores') return 'review';
    if (raw === 'deduction' || raw === 'deduction-events') return 'deduction';
    if (raw === 'redeemed' || raw === 'reward' || raw === 'reward-catalog') return 'redeemed';
    if (raw === 'bonus' || raw === 'bonus-events') return 'bonus';
    return '';
}

let kids = [];
let rules = [];
let selectedKidId = '';
let activeMode = 'bonus';
let selectedRuleId = 0;
let selectedPendingKey = '';
let selectedRating = 3;
let pointData = { totalPoints: 0, events: [] };
let pointTotalsByKidId = new Map();
let pendingItems = [];
let pullTodayStatusTimer = 0;
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
    showMessage(logError, text || '');
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

function currentRulesForMode() {
    return rules.filter((rule) => {
        if (!rule.isActive) return false;
        if (activeMode === 'bonus') return rule.ruleKind === 'bonus_event';
        if (activeMode === 'deduction') return rule.ruleKind === 'deduction_event';
        if (activeMode === 'redeemed') return rule.ruleKind === 'redeemed_reward';
        return false;
    });
}

function formatDelta(value) {
    const delta = Number.parseInt(value, 10) || 0;
    return `${delta > 0 ? '+' : ''}${delta}`;
}

function deltaClassForRule(rule) {
    const delta = Number.parseInt(rule?.pointsDelta, 10) || 0;
    if (rule?.ruleKind === 'redeemed_reward') return 'redeemed';
    return delta >= 0 ? 'positive' : 'negative';
}

function selectedBalance() {
    const fromTotals = pointTotalsByKidId.get(selectedKidId);
    if (fromTotals !== undefined) return Number.parseInt(fromTotals, 10) || 0;
    return Number.parseInt(pointData.totalPoints, 10) || 0;
}

function cannotAffordSelectedReward() {
    const rule = selectedRule();
    if (!rule || rule.ruleKind !== 'redeemed_reward') return false;
    const delta = Number.parseInt(rule.pointsDelta, 10) || 0;
    return selectedBalance() + delta < 0;
}

function formatPointsTotal(value) {
    return `${formatDelta(value)} pts`;
}

function setPullTodayButton(label = 'Pull Today', { busy = false } = {}) {
    if (!pullTodaySessionsBtn) return;
    pullTodaySessionsBtn.disabled = busy || !selectedKidId;
    const iconName = busy ? 'refresh-cw' : 'download';
    pullTodaySessionsBtn.innerHTML = `${icon(iconName, { size: 16 })}<span>${escapeHtml(label)}</span>`;
}

function selectedRule() {
    return rules.find((rule) => Number(rule.ruleId) === Number(selectedRuleId)) || null;
}

function selectedPending() {
    return pendingItems.find((item) => String(item.pendingId || '') === selectedPendingKey) || null;
}

function selectedReviewPoints(item = selectedPending()) {
    const rule = item?.rule || {};
    return Number.parseInt(rule[`rating${selectedRating}Points`], 10) || 0;
}

function reviewRatingMeta(rating) {
    if (rating === 1) return { label: 'Needs Work', emoji: '🙁' };
    if (rating === 2) return { label: 'OK', emoji: '🙂' };
    return { label: 'Great', emoji: '🤩' };
}

function clearSelection() {
    selectedRuleId = 0;
    selectedPendingKey = '';
    selectedRating = 3;
    pointNote.value = '';
}

function renderKids() {
    if (kids.length < 2) {
        kidTabs.classList.add('hidden');
        kidTabs.innerHTML = '';
        return;
    }
    kidTabs.innerHTML = kids.map((kid) => {
        const id = String(kid.id || '');
        const isActive = id === selectedKidId;
        const total = Number.parseInt(pointTotalsByKidId.get(id), 10) || 0;
        const totalClass = total < 0 ? ' negative' : (total > 0 ? ' positive' : '');
        const totalHtml = `<span class="kid-nav-card-meta point-kid-total${totalClass}">${escapeHtml(formatPointsTotal(total))}</span>`;
        return `<button type="button" class="kid-nav-card${isActive ? ' active' : ''}" role="tab" aria-selected="${isActive ? 'true' : 'false'}" data-kid-id="${escapeHtml(id)}">${icon('user', { className: 'kid-nav-card-icon', strokeWidth: 2 })}<span>${escapeHtml(kidName(kid))}</span>${totalHtml}</button>`;
    }).join('');
    kidTabs.classList.remove('hidden');
}

function renderModeTabs() {
    modeTabs.forEach((tab) => {
        tab.classList.toggle('active', tab.dataset.mode === activeMode);
    });
}

function templateRow(rule) {
    const delta = Number.parseInt(rule.pointsDelta, 10) || 0;
    const signClass = deltaClassForRule(rule);
    const isActive = Number(rule.ruleId) === Number(selectedRuleId);
    const active = isActive ? ' active' : '';
    return `
        <button type="button" class="point-template-row${active}" data-rule-id="${escapeHtml(rule.ruleId)}">
            <span class="point-rule-emoji">${escapeHtml(rule.emoji || (delta < 0 ? '-' : '+'))}</span>
            <span class="point-template-name">${escapeHtml(rule.name)}</span>
            <span class="point-rule-delta ${signClass}">${escapeHtml(formatDelta(delta))}</span>
            ${isActive ? '<span class="point-template-check" aria-hidden="true">✓</span>' : ''}
        </button>
    `;
}

function reviewTemplateRow(item) {
    const pendingId = String(item.pendingId || '');
    const isActive = pendingId === selectedPendingKey;
    const active = isActive ? ' active' : '';
    const rule = item.rule || {};
    return `
        <button type="button" class="point-template-row point-template-row--pending${active}" data-pending-key="${escapeHtml(pendingId)}">
            <span class="point-rule-emoji">${escapeHtml(rule.emoji || '✓')}</span>
            <span class="point-template-name">${escapeHtml(rule.name || 'Chore')}</span>
            ${isActive ? '<span class="point-template-check" aria-hidden="true">✓</span>' : ''}
        </button>
    `;
}

function renderTemplates() {
    if (activeMode === 'review') {
        if (!pendingItems.length) {
            templateList.innerHTML = `<div class="point-empty">${escapeHtml(MODE_META.review.empty)}</div>`;
            return;
        }
        templateList.innerHTML = `<div class="point-template-frame">${pendingItems.map(reviewTemplateRow).join('')}</div>`;
        return;
    }

    const modeRules = currentRulesForMode();
    if (!modeRules.length) {
        templateList.innerHTML = `<div class="point-empty">${escapeHtml(MODE_META[activeMode]?.empty || '')}</div>`;
        return;
    }
    templateList.innerHTML = `<div class="point-template-frame">${modeRules.map(templateRow).join('')}</div>`;
}

function renderSelectionPanel() {
    selectionPanel.classList.toggle('point-selection-panel--review', activeMode === 'review');
    if (activeMode === 'review') {
        const item = selectedPending();
        if (!item) {
            selectionPanel.classList.add('hidden');
            selectionPanel.innerHTML = '';
            return;
        }
        const rule = item.rule || {};
        const ratingButtons = [1, 2, 3].map((rating) => {
            const points = Number.parseInt(rule[`rating${rating}Points`], 10) || 0;
            const ratingMeta = reviewRatingMeta(rating);
            const active = rating === selectedRating ? ' active' : '';
            return `
                <button type="button" class="point-rating-btn${active}" data-rating="${rating}" aria-label="${escapeHtml(`${ratingMeta.label} ${formatDelta(points)}`)}">
                    <span class="point-rating-emoji" aria-hidden="true">${escapeHtml(ratingMeta.emoji)}</span>
                    <span class="point-rating-label">${escapeHtml(ratingMeta.label)}</span>
                </button>
            `;
        }).join('');
        const points = selectedReviewPoints(item);
        selectionPanel.innerHTML = `
            <div class="point-rating-control" aria-label="Chore rating">${ratingButtons}</div>
            <div class="point-rule-delta positive">${escapeHtml(formatDelta(points))} pts</div>
        `;
        selectionPanel.classList.remove('hidden');
        return;
    }

    selectionPanel.classList.add('hidden');
    selectionPanel.innerHTML = '';
}

function renderHistory() {
    const events = Array.isArray(pointData.events) ? pointData.events : [];
    selectedHistoryDayKey = window.PointHistoryCommon.render(pointHistory, {
        selectedKidId,
        events,
        selectedDayKey: selectedHistoryDayKey,
        familyTimezone: selectedFamilyTimezone(),
        showDelete: true,
    });
}

function updateSubmitState() {
    const hasSelection = activeMode === 'review' ? Boolean(selectedPending()) : Boolean(selectedRule());
    const cannotAfford = activeMode !== 'review' && cannotAffordSelectedReward();
    submitPointLogBtn.disabled = !(selectedKidId && hasSelection) || cannotAfford;
    if (activeMode === 'review') {
        submitPointLogBtn.textContent = hasSelection ? `Apply ${formatDelta(selectedReviewPoints())}` : 'Apply';
    } else {
        const rule = selectedRule();
        submitPointLogBtn.textContent = cannotAfford
            ? 'Not enough points'
            : (rule ? `Apply ${formatDelta(rule.pointsDelta)}` : 'Apply');
    }
}

function render() {
    renderKids();
    renderModeTabs();
    renderTemplates();
    renderSelectionPanel();
    renderHistory();
    updateSubmitState();
    setPullTodayButton();
    hydrateIcons(document);
}

async function loadPointsForSelectedKid() {
    if (!selectedKidId) {
        pointData = { totalPoints: 0, events: [] };
        render();
        return;
    }
    const data = await fetchJson(`${API_BASE}/kids/${encodeURIComponent(selectedKidId)}/points?limit=80`);
    pointData = data || { totalPoints: 0, events: [] };
    render();
}

async function loadPointTotalsForKids() {
    const entries = await Promise.all(kids.map(async (kid) => {
        const id = String(kid.id || '');
        if (!id) return null;
        const data = await fetchJson(`${API_BASE}/kids/${encodeURIComponent(id)}/points?limit=1`);
        return [id, Number.parseInt(data.totalPoints, 10) || 0];
    }));
    pointTotalsByKidId = new Map(entries.filter(Boolean));
    const selectedTotal = pointTotalsByKidId.get(selectedKidId);
    if (selectedTotal !== undefined) {
        pointData = { ...pointData, totalPoints: selectedTotal };
    }
}

async function loadPendingReviews() {
    if (!selectedKidId) {
        pendingItems = [];
        return;
    }
    const data = await fetchJson(`${API_BASE}/kids/${encodeURIComponent(selectedKidId)}/off-app-chores`);
    pendingItems = (Array.isArray(data.pending) ? data.pending : []).map((pending) => ({
        pendingId: pending.pendingId,
        submittedAt: pending.submittedAt,
        rule: pending.rule || {},
    }));
    if (activeMode === 'review') {
        const stillSelected = pendingItems.some((pending) => String(pending.pendingId || '') === selectedPendingKey);
        if (!stillSelected) {
            selectedPendingKey = String(pendingItems[0]?.pendingId || '');
        }
        selectedRuleId = 0;
    }
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
    activeMode = requestedMode || activeMode;
    selectedHistoryDayKey = todayHistoryDayKey();
    selectedRuleId = activeMode === 'review' ? 0 : Number(currentRulesForMode()[0]?.ruleId || 0);
    await Promise.all([loadPendingReviews(), loadPointsForSelectedKid(), loadPointTotalsForKids()]);
    render();
}

async function refreshAfterMutation() {
    await Promise.all([loadPendingReviews(), loadPointsForSelectedKid(), loadPointTotalsForKids()]);
    render();
}

kidTabs.addEventListener('click', async (event) => {
    const button = event.target.closest('[data-kid-id]');
    if (!button) return;
    const nextKidId = String(button.dataset.kidId || '');
    if (!nextKidId || nextKidId === selectedKidId) return;
    selectedKidId = nextKidId;
    selectedHistoryDayKey = todayHistoryDayKey();
    clearSelection();
    selectedRuleId = Number(currentRulesForMode()[0]?.ruleId || 0);
    showError('');
    try {
        await Promise.all([loadPendingReviews(), loadPointsForSelectedKid(), loadPointTotalsForKids()]);
        render();
    } catch (error) {
        showError(error.message || 'Failed to load points.');
    }
});

modeTabs.forEach((tab) => {
    tab.addEventListener('click', () => {
        const nextMode = tab.dataset.mode || 'bonus';
        if (nextMode === activeMode) return;
        activeMode = nextMode;
        clearSelection();
        if (activeMode === 'review') {
            selectedPendingKey = String(pendingItems[0]?.pendingId || '');
            selectedRuleId = 0;
        } else {
            selectedRuleId = Number(currentRulesForMode()[0]?.ruleId || 0);
        }
        render();
    });
});

templateList.addEventListener('click', async (event) => {
    const ruleButton = event.target.closest('[data-rule-id]');
    if (ruleButton) {
        selectedRuleId = Number.parseInt(ruleButton.dataset.ruleId || '', 10) || 0;
        selectedPendingKey = '';
        render();
        return;
    }
    const pendingButton = event.target.closest('[data-pending-key]');
    if (pendingButton) {
        const item = pendingItems.find((pending) => String(pending.pendingId || '') === pendingButton.dataset.pendingKey);
        selectedPendingKey = pendingButton.dataset.pendingKey || '';
        selectedRuleId = 0;
        render();
    }
});

selectionPanel.addEventListener('click', (event) => {
    const ratingButton = event.target.closest('[data-rating]');
    if (!ratingButton) return;
    selectedRating = Number.parseInt(ratingButton.dataset.rating || '', 10) || 3;
    render();
});

pointNote.addEventListener('input', updateSubmitState);

pointLogForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    submitPointLogBtn.disabled = true;
    showError('');
    try {
        if (activeMode === 'review') {
            const pending = selectedPending();
            if (!pending) return;
            await fetchJson(`${API_BASE}/kids/${encodeURIComponent(selectedKidId)}/off-app-chores/pending/${pending.pendingId}/review`, {
                method: 'POST',
                body: JSON.stringify({
                    rating: selectedRating,
                    note: pointNote.value.trim(),
                }),
            });
        } else {
            const rule = selectedRule();
            if (!selectedKidId || !rule) return;
            if (cannotAffordSelectedReward()) {
                showError('Not enough points for this reward.');
                updateSubmitState();
                return;
            }
            await fetchJson(`${API_BASE}/kids/${encodeURIComponent(selectedKidId)}/points/events`, {
                method: 'POST',
                body: JSON.stringify({
                    ruleId: rule.ruleId,
                    note: pointNote.value.trim(),
                }),
            });
        }
        clearSelection();
        selectedRuleId = Number(currentRulesForMode()[0]?.ruleId || 0);
        await refreshAfterMutation();
    } catch (error) {
        showError(error.message || 'Failed to log points.');
        updateSubmitState();
    }
});

pointHistory.addEventListener('click', async (event) => {
    const dayButton = event.target.closest('[data-history-day]');
    if (dayButton) {
        const nextDayKey = String(dayButton.dataset.historyDay || '');
        if (nextDayKey && nextDayKey !== selectedHistoryDayKey) {
            selectedHistoryDayKey = nextDayKey;
            renderHistory();
        }
        return;
    }

    const button = event.target.closest('[data-history-action="delete"]');
    if (!button || !selectedKidId) return;
    const row = button.closest('[data-event-id]');
    const eventId = Number.parseInt(row?.dataset.eventId || '', 10);
    if (!(eventId > 0)) return;
    button.disabled = true;
    showError('');
    try {
        await fetchJson(`${API_BASE}/kids/${encodeURIComponent(selectedKidId)}/points/events/${eventId}`, {
            method: 'DELETE',
        });
        await loadPointsForSelectedKid();
    } catch (error) {
        showError(error.message || 'Failed to delete point event.');
        button.disabled = false;
    }
});

pullTodaySessionsBtn?.addEventListener('click', async () => {
    if (!selectedKidId) return;
    if (pullTodayStatusTimer) {
        clearTimeout(pullTodayStatusTimer);
        pullTodayStatusTimer = 0;
    }
    setPullTodayButton('Pulling', { busy: true });
    showError('');
    try {
        const result = await fetchJson(`${API_BASE}/kids/${encodeURIComponent(selectedKidId)}/points/pull-today-sessions`, {
            method: 'POST',
        });
        await refreshAfterMutation();
        const count = Number.parseInt(result.awardedCount, 10) || 0;
        setPullTodayButton(count > 0 ? `Added ${count}` : 'Up to date');
        pullTodayStatusTimer = setTimeout(() => {
            setPullTodayButton();
            pullTodayStatusTimer = 0;
        }, 1400);
    } catch (error) {
        showError(error.message || 'Failed to pull today sessions.');
        setPullTodayButton();
    }
});

document.addEventListener('DOMContentLoaded', async () => {
    hydrateIcons(document);
    try {
        await loadInitialData();
    } catch (error) {
        showError(error.message || 'Failed to load point logging.');
        render();
    }
});
