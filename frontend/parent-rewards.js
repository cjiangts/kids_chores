const API_BASE = `${window.location.origin}/api`;
const POINT_HISTORY_LIMIT = 500;

const parentRewardsError = document.getElementById('parentRewardsError');
const parentRewardAvatarSwitcher = document.getElementById('parentRewardAvatarSwitcher');
const parentRewardTabs = document.getElementById('parentRewardTabs');
const parentRewardRules = document.getElementById('parentRewardRules');
const parentRewardHistory = document.getElementById('parentRewardHistory');
const parentRewardRulesLink = document.getElementById('parentRewardRulesLink');

let rewardRules = [];
let kids = [];
let selectedKidId = '';
let activeRewardType = '';
let selectedRewardRuleId = 0;
let selectedHistoryDayKey = '';
let pointData = { totalPoints: 0, events: [] };
let rewardBucketTotalsByKidId = new Map();

function escapeHtml(value) {
    return window.PointRuleTemplateCommon.escapeHtml(value);
}

function showMessage(node, text) {
    if (!node) return;
    node.textContent = text || '';
    node.classList.toggle('hidden', !text);
}

function showError(text) {
    showMessage(parentRewardsError, text || '');
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

function rewardType(rule) {
    return window.PointRuleTemplateCommon.rewardType(rule);
}

function rewardTypeLabel(type) {
    const normalized = String(type || '').trim().toLowerCase();
    return window.PointRuleTemplateCommon.rewardTypeLabel(normalized);
}

function rewardTypeOrder(type) {
    return rewardTypeLabel(type);
}

function rewardTypes() {
    const types = new Set();
    rewardRules.forEach((rule) => types.add(rewardType(rule)));
    return Array.from(types).filter(Boolean).sort((a, b) => {
        return rewardTypeOrder(a).localeCompare(rewardTypeOrder(b));
    });
}

function selectedFamilyTimezone() {
    const kid = kids.find((item) => String(item?.id || '') === selectedKidId);
    return String(kid?.familyTimezone || '').trim();
}

function todayHistoryDayKey() {
    return window.PointHistoryCommon.dateKeyInTimezone(new Date(), selectedFamilyTimezone());
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

function selectedRewardBucketBalance(type = activeRewardType) {
    const totals = rewardBucketTotalsByKidId.get(String(selectedKidId || '')) || normalizeRewardBucketTotals(pointData.rewardBucketTotals);
    return Number.parseInt(totals?.[type], 10) || 0;
}

function ruleCost(rule) {
    const maxPoint = Number.parseInt(rule?.maxPoint, 10) || 0;
    return Math.abs(maxPoint);
}

function compareRewardRulesByCost(a, b) {
    const costDiff = ruleCost(a) - ruleCost(b);
    if (costDiff !== 0) return costDiff;
    return String(a?.name || '').localeCompare(String(b?.name || ''));
}

function ruleRewardProgress(rule) {
    const cost = ruleCost(rule);
    const balance = selectedRewardBucketBalance(rewardType(rule));
    const remaining = Math.max(cost - balance, 0);
    const progress = cost > 0 ? Math.min(Math.max(balance / cost, 0), 1) : 1;
    return {
        cost,
        remaining,
        percent: Math.round(progress * 100),
    };
}

function selectedRewardRule() {
    return rewardRules.find((rule) => Number(rule.ruleId) === Number(selectedRewardRuleId)) || null;
}

function canRedeemRule(rule) {
    return Boolean(rule) && selectedRewardBucketBalance(rewardType(rule)) >= ruleCost(rule);
}

function ruleIconHtml(rule) {
    const emoji = String(rule?.emoji || '').trim();
    if (emoji) {
        return escapeHtml(emoji);
    }
    return typeof window.icon === 'function' ? window.icon('gift', { size: 18 }) : '';
}

function rememberedKidId() {
    return String(window.KidAppNavigation?.getKidId?.() || '').trim();
}

function initialKidId() {
    const requestedKidId = new URLSearchParams(window.location.search).get('id') || '';
    const candidates = [requestedKidId, rememberedKidId()];
    const match = candidates.find((kidId) => kidId && kids.some((kid) => String(kid?.id || '') === String(kidId)));
    return match || String(kids[0]?.id || '');
}

function renderKids() {
    if (!parentRewardAvatarSwitcher || !window.KidAppNavigation?.renderKidAvatarSwitcher) return;
    window.KidAppNavigation.renderKidAvatarSwitcher(parentRewardAvatarSwitcher, kids, {
        selectedKidId,
        onSelect: async (kidId) => {
            if (!kidId || kidId === selectedKidId) return;
            selectedKidId = kidId;
            selectedRewardRuleId = 0;
            selectedHistoryDayKey = '';
            if (window.KidAppNavigation?.setKidId) {
                window.KidAppNavigation.setKidId(kidId);
            }
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

function renderTabs() {
    if (!parentRewardTabs) return;
    const types = rewardTypes();
    if (!types.includes(activeRewardType)) {
        activeRewardType = types[0] || '';
    }
    parentRewardTabs.innerHTML = types.map((type) => {
        const isActive = type === activeRewardType;
        const label = rewardTypeLabel(type);
        const tab = rewardTabParts(label, selectedRewardBucketBalance(type));
        return `
            <button type="button" class="cards-view-toggle-btn ${isActive ? 'active' : ''}" role="tab" aria-selected="${isActive ? 'true' : 'false'}" data-reward-type="${escapeHtml(type)}">
                <span class="cards-view-toggle-btn-icon" data-icon="gift" data-icon-size="16" data-icon-stroke="2.4"></span>
                <span class="point-rule-tab-long">${escapeHtml(tab.label)}${escapeHtml(tab.gap)}<span class="reward-tab-balance">${escapeHtml(tab.balance)}</span></span>
                <span class="point-rule-tab-short">${escapeHtml(tab.label)}${escapeHtml(tab.gap)}<span class="reward-tab-balance">${escapeHtml(tab.balance)}</span></span>
            </button>
        `;
    }).join('');
    if (typeof window.hydrateIcons === 'function') {
        window.hydrateIcons(parentRewardTabs);
    }
    if (parentRewardRulesLink) {
        const params = new URLSearchParams({ kind: 'redeemed_reward' });
        if (activeRewardType) {
            params.set('rewardType', activeRewardType);
        }
        parentRewardRulesLink.href = `/point-rules.html?${params.toString()}`;
    }
}

function rewardStatusHtml(rule) {
    const { remaining } = ruleRewardProgress(rule);
    if (remaining <= 0) {
        return '<span class="kid-reward-rule-status available">Available</span>';
    }
    return `<span class="kid-reward-rule-status muted">${escapeHtml(`${remaining} pts to go`)}</span>`;
}

function rewardNoteEditorHtml() {
    const checkIcon = typeof window.icon === 'function'
        ? window.icon('check', { size: 18, strokeWidth: 2.6 })
        : '✓';
    return `
        <div class="reward-note-editor" data-reward-note-editor>
            <input type="text" class="reward-note-input" data-reward-note-input placeholder="Add a note (optional)" maxlength="200" autocomplete="off">
            <button type="button" class="reward-note-confirm-btn" data-reward-action="confirm" aria-label="Confirm redemption">${checkIcon}</button>
        </div>
    `;
}

function renderRules() {
    if (!parentRewardRules) return;
    const visible = rewardRules
        .filter((rule) => rewardType(rule) === activeRewardType)
        .sort(compareRewardRulesByCost);
    if (!visible.length) {
        parentRewardRules.innerHTML = `<div class="point-rule-empty">No ${escapeHtml(rewardTypeLabel(activeRewardType).toLowerCase())} rewards yet.</div>`;
        return;
    }
    parentRewardRules.innerHTML = `
        <div class="point-template-frame point-template-frame--stacked parent-reward-template-frame">
            ${visible.map((rule) => {
        const isAffordable = canRedeemRule(rule);
        const isSelected = isAffordable && Number(rule.ruleId) === Number(selectedRewardRuleId);
        const progress = ruleRewardProgress(rule);
        const statusText = progress.remaining <= 0 ? 'Available' : `${progress.remaining} pts to go`;
        const ariaLabel = `${rule?.name || 'Reward'}, ${progress.cost} pts, ${statusText}`;
        return `
            <div
                class="point-template-row point-template-row--redeem parent-reward-template-row parent-reward-template-row--redeem ${isSelected ? 'active' : ''} ${isAffordable ? 'affordable' : 'locked'}"
                ${isAffordable ? 'role="button" tabindex="0"' : 'aria-disabled="true"'}
                aria-selected="${isSelected ? 'true' : 'false'}"
                data-rule-id="${escapeHtml(rule.ruleId)}"
                aria-label="${escapeHtml(ariaLabel)}"
                style="--reward-progress: ${escapeHtml(`${progress.percent}%`)};"
            >
                <span class="point-rule-emoji">${ruleIconHtml(rule)}</span>
                <span class="point-template-name">${escapeHtml(rule?.name || 'Reward')}</span>
                <span class="point-rule-delta redeemed">${escapeHtml(`${ruleCost(rule)} pts`)}</span>
                <span class="kid-reward-rule-status-cell">${rewardStatusHtml(rule)}</span>
                ${isSelected ? rewardNoteEditorHtml() : ''}
                ${isAffordable ? '' : '<span class="kid-reward-progress parent-reward-progress" aria-hidden="true"><span></span></span>'}
            </div>
        `;
    }).join('')}
        </div>
    `;
    if (typeof window.hydrateIcons === 'function') {
        window.hydrateIcons(parentRewardRules);
    }
}

function renderHistory() {
    if (!parentRewardHistory) return;
    selectedHistoryDayKey = window.PointHistoryCommon.render(parentRewardHistory, {
        selectedKidId,
        events: Array.isArray(pointData.events) ? pointData.events : [],
        selectedDayKey: selectedHistoryDayKey,
        familyTimezone: selectedFamilyTimezone(),
        showDelete: true,
        mode: 'redeemed',
        emptyDay: 'No rewards redeemed for this day.',
        deleteAriaLabel: 'Undo reward redemption',
    });
}

function render() {
    renderKids();
    renderTabs();
    renderRules();
    renderHistory();
}

async function loadPointsForSelectedKid() {
    if (!selectedKidId) {
        pointData = { totalPoints: 0, events: [] };
        return;
    }
    const data = await fetchJson(`${API_BASE}/kids/${encodeURIComponent(selectedKidId)}/points?limit=${POINT_HISTORY_LIMIT}`);
    pointData = data || { totalPoints: 0, events: [] };
    rewardBucketTotalsByKidId.set(selectedKidId, normalizeRewardBucketTotals(pointData.rewardBucketTotals));
}

async function loadRewards() {
    showError('');
    const [kidsData, rulesData] = await Promise.all([
        fetchJson(`${API_BASE}/kids?view=reward_nav`),
        fetchJson(`${API_BASE}/points/rules?includeInactive=0`),
    ]);
    kids = Array.isArray(kidsData) ? kidsData : [];
    selectedKidId = initialKidId();
    if (window.KidAppNavigation?.setKidId && selectedKidId) {
        window.KidAppNavigation.setKidId(selectedKidId);
    }
    selectedHistoryDayKey = '';
    selectedRewardRuleId = 0;
    rewardRules = (Array.isArray(rulesData.rules) ? rulesData.rules : [])
        .filter((rule) => String(rule?.ruleKind || '') === 'redeemed_reward');
    const firstTypeWithRewards = rewardTypes().find((type) => rewardRules.some((rule) => rewardType(rule) === type));
    activeRewardType = firstTypeWithRewards || '';
    await loadPointsForSelectedKid();
    render();
}

function setActiveRewardType(type) {
    const nextType = String(type || '').trim().toLowerCase();
    if (!nextType || nextType === activeRewardType) return;
    activeRewardType = nextType;
    selectedRewardRuleId = 0;
    render();
}

async function refreshAfterMutation() {
    await loadPointsForSelectedKid();
    render();
}

async function redeemSelectedReward(note = '') {
    const rule = selectedRewardRule();
    if (!rule || !selectedKidId) return;
    if (!canRedeemRule(rule)) {
        showError('Not enough points for this reward bucket.');
        return;
    }
    showError('');
    const trimmedNote = String(note || '').trim();
    const body = {
        ruleId: rule.ruleId,
        pointsDelta: ruleCost(rule),
    };
    if (trimmedNote) {
        body.note = trimmedNote;
    }
    await fetchJson(`${API_BASE}/kids/${encodeURIComponent(selectedKidId)}/points/events`, {
        method: 'POST',
        body: JSON.stringify(body),
    });
    selectedRewardRuleId = 0;
    selectedHistoryDayKey = '';
    await refreshAfterMutation();
}

parentRewardTabs?.addEventListener('click', (event) => {
    const button = event.target.closest('[data-reward-type]');
    if (!button) return;
    setActiveRewardType(button.dataset.rewardType);
});

parentRewardRules?.addEventListener('click', async (event) => {
    const confirmButton = event.target.closest('[data-reward-action="confirm"]');
    if (confirmButton) {
        const noteInput = confirmButton.closest('[data-reward-note-editor]')?.querySelector('[data-reward-note-input]');
        const note = noteInput ? noteInput.value : '';
        confirmButton.disabled = true;
        try {
            await redeemSelectedReward(note);
        } catch (error) {
            showError(error.message || 'Failed to redeem reward.');
            confirmButton.disabled = false;
        }
        return;
    }
    // Clicks inside the note editor must not toggle the row selection away.
    if (event.target.closest('[data-reward-note-editor]')) return;
    const row = event.target.closest('[data-rule-id]');
    if (!row) return;
    if (row.classList.contains('locked')) return;
    const ruleId = Number.parseInt(row.dataset.ruleId || '', 10) || 0;
    selectedRewardRuleId = Number(selectedRewardRuleId) === ruleId ? 0 : ruleId;
    showError('');
    renderRules();
    if (selectedRewardRuleId) {
        parentRewardRules.querySelector(`[data-rule-id="${selectedRewardRuleId}"] [data-reward-note-input]`)?.focus();
    }
});

parentRewardRules?.addEventListener('keydown', (event) => {
    const noteInput = event.target.closest?.('[data-reward-note-input]');
    if (noteInput) {
        if (event.key === 'Enter') {
            event.preventDefault();
            noteInput.closest('[data-reward-note-editor]')?.querySelector('[data-reward-action="confirm"]')?.click();
        }
        return;
    }
    if (event.target.closest?.('[data-reward-action="confirm"]')) return;
    if (event.key !== 'Enter' && event.key !== ' ') return;
    const row = event.target.closest('[data-rule-id]');
    if (!row) return;
    event.preventDefault();
    row.click();
});

parentRewardHistory?.addEventListener('click', async (event) => {
    const dayButton = event.target.closest('[data-history-day]');
    if (dayButton) {
        const nextDayKey = String(dayButton.dataset.historyDay || '');
        if (!nextDayKey) return;
        selectedHistoryDayKey = nextDayKey === selectedHistoryDayKey ? '' : nextDayKey;
        renderHistory();
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
        await refreshAfterMutation();
    } catch (error) {
        showError(error.message || 'Failed to undo reward redemption.');
        button.disabled = false;
    }
});

parentRewardHistory?.addEventListener('point-history-clear-filter', () => {
    selectedHistoryDayKey = '';
    renderHistory();
});

parentRewardHistory?.addEventListener('point-history-edit-note', async (event) => {
    const detail = event.detail || {};
    const eventId = Number.parseInt(detail.eventId, 10);
    if (!(eventId > 0) || !selectedKidId) return;
    showError('');
    try {
        await fetchJson(`${API_BASE}/kids/${encodeURIComponent(selectedKidId)}/points/events/${eventId}`, {
            method: 'PATCH',
            body: JSON.stringify({ pointsDelta: detail.pointsDelta, note: detail.note }),
        });
        await refreshAfterMutation();
    } catch (error) {
        showError(error.message || 'Failed to update note.');
    }
});

document.addEventListener('DOMContentLoaded', () => {
    if (typeof window.hydrateIcons === 'function') {
        window.hydrateIcons(document);
    }
    loadRewards().catch((error) => {
        showError(error.message || 'Failed to load rewards.');
        render();
    });
});
