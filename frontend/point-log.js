const API_BASE = `${window.location.origin}/api`;
const POINT_LOG_MODE_STORAGE_KEY = 'point_log_last_mode_v1';
const POINT_HISTORY_LIMIT = 200;

const kidTabs = document.getElementById('kidTabs');
const logError = document.getElementById('logError');
const pointLogForm = document.getElementById('pointLogForm');
const pointEmoji = document.getElementById('pointEmoji');
const pointRuleName = document.getElementById('pointRuleName');
const pointPoints = document.getElementById('pointPoints');
const pointNote = document.getElementById('pointNote');
const submitPointLogBtn = document.getElementById('submitPointLogBtn');
const templateList = document.getElementById('templateList');
const selectionPanel = document.getElementById('selectionPanel');
const pointHistory = document.getElementById('pointHistory');
const pullTodaySessionsBtn = document.getElementById('pullTodaySessionsBtn');
const pointRulesLink = document.querySelector('.point-rules-link');
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
};

function normalizePointLogMode(value) {
    const raw = String(value || '').trim().toLowerCase().replace(/_/g, '-');
    if (raw === 'deduction' || raw === 'deduction-events') return 'deduction';
    if (raw === 'bonus' || raw === 'bonus-events') return 'bonus';
    return '';
}

function readStoredPointLogMode() {
    try {
        if (!window.sessionStorage) return '';
        return normalizePointLogMode(window.sessionStorage.getItem(POINT_LOG_MODE_STORAGE_KEY));
    } catch (error) {
        return '';
    }
}

function rememberPointLogMode(mode) {
    const normalized = normalizePointLogMode(mode);
    if (!normalized) return;
    try {
        if (!window.sessionStorage) return;
        window.sessionStorage.setItem(POINT_LOG_MODE_STORAGE_KEY, normalized);
    } catch (error) {
        // best-effort UI memory
    }
}

let kids = [];
let rules = [];
let selectedKidId = '';
let activeMode = requestedMode || readStoredPointLogMode() || 'bonus';
let selectedRuleId = 0;
let pointDraft = { emoji: '', name: '', points: '', note: '' };
let pointData = { totalPoints: 0, events: [] };
let pointTotalsByKidId = new Map();
let rewardBucketTotalsByKidId = new Map();
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
        return false;
    });
}

function filteredRulesForMode() {
    const query = String(pointDraft.name || '').trim().toLowerCase();
    const modeRules = currentRulesForMode();
    const filtered = query
        ? modeRules.filter((rule) => String(rule?.name || '').toLowerCase().includes(query))
        : modeRules;
    const selected = selectedRule();
    if (!selected || filtered.some((rule) => Number(rule.ruleId) === Number(selected.ruleId))) {
        return filtered;
    }
    return [selected, ...filtered];
}

function formatDelta(value) {
    return window.PointRuleTemplateCommon.formatDelta(value);
}

function deltaClassForRule(rule) {
    return window.PointRuleTemplateCommon.deltaClassForRule(rule);
}

function selectedBalance() {
    const fromTotals = pointTotalsByKidId.get(selectedKidId);
    if (fromTotals !== undefined) return Number.parseInt(fromTotals, 10) || 0;
    return Number.parseInt(pointData.totalPoints, 10) || 0;
}

function normalizeRewardBucketTotals(value) {
    const source = value && typeof value === 'object' ? value : {};
    const totalFor = (bucket) => Number.parseInt(source[bucket]?.totalPoints ?? source[bucket] ?? 0, 10) || 0;
    return {
        small: totalFor('small'),
        big: totalFor('big'),
    };
}

function rewardBucketForRule(rule) {
    if (!window.PointRuleTemplateCommon.isRewardRule(rule)) return '';
    return window.PointRuleTemplateCommon.rewardType(rule);
}

function signedPointValueForRule(rule, points) {
    const amount = Math.abs(Number.parseInt(points, 10) || 0);
    const ruleKind = String(rule?.ruleKind || '').trim();
    return (ruleKind === 'deduction_event' || ruleKind === 'redeemed_reward') ? -amount : amount;
}

function ruleMaxPoint(rule) {
    const maxPoint = Number.parseInt(rule?.maxPoint, 10);
    return Number.isInteger(maxPoint) && maxPoint > 0 ? maxPoint : 0;
}

function rewardBucketLabel(bucket) {
    return window.PointRuleTemplateCommon.rewardTypeLabel(bucket);
}

function selectedRewardBucketBalance(rule = selectedRule()) {
    const bucket = rewardBucketForRule(rule);
    if (!bucket) return selectedBalance();
    const totals = rewardBucketTotalsByKidId.get(selectedKidId) || normalizeRewardBucketTotals(pointData.rewardBucketTotals);
    return Number.parseInt(totals?.[bucket], 10) || 0;
}

function rememberedKidId() {
    return String(window.KidAppNavigation?.getKidId?.() || '').trim();
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

function cannotAffordSelectedReward() {
    return false;
}

function formatPointsTotal(value) {
    return `${formatDelta(value)} pts`;
}

function setPullTodayButton(label = 'Pull Today', { busy = false } = {}) {
    if (!pullTodaySessionsBtn) return;
    pullTodaySessionsBtn.disabled = busy || !selectedKidId;
    pullTodaySessionsBtn.setAttribute('aria-label', label);
    pullTodaySessionsBtn.title = label;
    pullTodaySessionsBtn.innerHTML = icon('refresh-cw', { size: 16 });
}

function selectedRule() {
    return rules.find((rule) => Number(rule.ruleId) === Number(selectedRuleId)) || null;
}

function checkIconHtml(size = 17, strokeWidth = 2.7) {
    if (typeof window.icon === 'function') {
        return window.icon('check', { className: 'point-apply-icon icon', size, strokeWidth });
    }
    return '';
}

function setSubmitButtonLabel(label) {
    if (!submitPointLogBtn) return;
    submitPointLogBtn.innerHTML = `${checkIconHtml()}<span class="point-apply-label">${escapeHtml(label)}</span>`;
}

function hasActiveSelection() {
    return Boolean(selectedRule());
}

function exactDraftRule() {
    const name = String(pointDraft.name || '').trim().toLowerCase();
    if (!name) return null;
    return currentRulesForMode().find((rule) => String(rule?.name || '').trim().toLowerCase() === name) || null;
}

function draftRuleForSubmit() {
    return selectedRule() || exactDraftRule();
}

function clearSelection() {
    selectedRuleId = 0;
}

function clearDraft() {
    selectedRuleId = 0;
    pointDraft = { emoji: '', name: '', points: '', note: '' };
    if (pointEmoji) pointEmoji.value = '';
    if (pointRuleName) pointRuleName.value = '';
    if (pointPoints) pointPoints.value = '';
    if (pointNote) pointNote.value = '';
}

function syncDraftFromInputs({ preserveSelection = false } = {}) {
    pointDraft = {
        emoji: String(pointEmoji?.value || '').trim(),
        name: String(pointRuleName?.value || '').trim(),
        points: String(pointPoints?.value || '').trim(),
        note: String(pointNote?.value || '').trim(),
    };
}

function populateDraftFromRule(rule) {
    if (!rule) return;
    selectedRuleId = Number.parseInt(rule.ruleId, 10) || 0;
    pointDraft = {
        ...pointDraft,
        emoji: String(rule.emoji || '').trim(),
        name: String(rule.name || '').trim(),
        points: rule.maxPoint == null ? '' : String(rule.maxPoint),
    };
    if (pointEmoji) pointEmoji.value = pointDraft.emoji;
    if (pointRuleName) pointRuleName.value = pointDraft.name;
    if (pointPoints) pointPoints.value = pointDraft.points;
}

function stepPoints(delta) {
    if (!pointPoints) return;
    const current = Number.parseInt(pointPoints.value, 10);
    const base = Number.isInteger(current) && current > 0 ? current : 1;
    const next = Math.max(1, base + delta);
    pointPoints.value = String(next);
    syncDraftFromInputs();
    renderTemplates();
    updateSubmitState();
    if (typeof window.hydrateIcons === 'function') {
        window.hydrateIcons(templateList);
    }
}

function renderKids() {
    if (!window.KidAppNavigation?.renderKidSelector) return;
    window.KidAppNavigation.renderKidSelector(kidTabs, kids, {
        selectedKidId,
        onSelect: async (kidId) => {
            if (!kidId || kidId === selectedKidId) return;
            selectedKidId = kidId;
            syncSelectedKidNavigation();
            selectedHistoryDayKey = todayHistoryDayKey();
            clearDraft();
            showError('');
            try {
                await Promise.all([loadPointsForSelectedKid(), loadPointTotalsForKids()]);
                render();
            } catch (error) {
                showError(error.message || 'Failed to load points.');
            }
        },
    });
}

function renderModeTabs() {
    modeTabs.forEach((tab) => {
        tab.classList.toggle('active', tab.dataset.mode === activeMode);
    });
    if (pointRulesLink) {
        const ruleKind = activeMode === 'deduction' ? 'deduction_event' : 'bonus_event';
        pointRulesLink.href = `/point-rules.html?kind=${encodeURIComponent(ruleKind)}`;
    }
}

function templateRow(rule) {
    const isActive = Number(rule.ruleId) === Number(selectedRuleId);
    const displayRule = isActive
        ? {
            ...rule,
            emoji: String(pointDraft.emoji || rule.emoji || '').trim(),
            name: String(pointDraft.name || rule.name || '').trim(),
            maxPoint: Math.max(ruleMaxPoint(rule), Number.parseInt(pointDraft.points, 10) || 0) || rule.maxPoint,
        }
        : rule;
    return window.PointRuleTemplateCommon.renderRuleRow(displayRule, { active: isActive });
}

function renderTemplates() {
    templateList.classList.toggle('has-selection', hasActiveSelection());
    const modeRules = filteredRulesForMode();
    if (!modeRules.length) {
        const hasQuery = Boolean(String(pointDraft.name || '').trim());
        templateList.innerHTML = `<div class="point-empty">${escapeHtml(hasQuery ? 'No matching rules yet.' : (MODE_META[activeMode]?.empty || ''))}</div>`;
        return;
    }
    templateList.innerHTML = `<div class="point-template-frame">${modeRules.map(templateRow).join('')}</div>`;
}

function renderSelectionPanel() {
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
    const name = String(pointDraft.name || '').trim();
    const emoji = String(pointDraft.emoji || '').trim();
    const points = Number.parseInt(pointDraft.points, 10);
    const hasPositivePoints = Number.isInteger(points) && points > 0;
    const rule = draftRuleForSubmit();
    const canCreate = Boolean(name && emoji && hasPositivePoints);
    const canSubmit = Boolean(selectedKidId && hasPositivePoints && (rule || canCreate));
    const cannotAfford = cannotAffordSelectedReward();
    submitPointLogBtn.disabled = !canSubmit || cannotAfford;
    if (!name) {
        setSubmitButtonLabel('Confirm');
        return;
    }
    setSubmitButtonLabel(rule
        ? `Confirm ${formatDelta(signedPointValueForRule(rule, hasPositivePoints ? points : 1))}`
        : `Create ${activeMode === 'deduction' ? '-' : '+'}${hasPositivePoints ? points : 1}`);
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
        return;
    }
    const data = await fetchJson(`${API_BASE}/kids/${encodeURIComponent(selectedKidId)}/points?limit=${POINT_HISTORY_LIMIT}`);
    pointData = data || { totalPoints: 0, events: [] };
    rewardBucketTotalsByKidId.set(selectedKidId, normalizeRewardBucketTotals(pointData.rewardBucketTotals));
}

async function loadPointTotalsForKids() {
    const data = await fetchJson(`${API_BASE}/points/kid-totals`);
    const entries = (Array.isArray(data.totals) ? data.totals : [])
        .map((item) => [String(item.kidId || ''), Number.parseInt(item.totalPoints, 10) || 0])
        .filter(([kidId]) => kidId);
    pointTotalsByKidId = new Map(entries);
    rewardBucketTotalsByKidId = new Map((Array.isArray(data.totals) ? data.totals : [])
        .map((item) => [String(item.kidId || ''), normalizeRewardBucketTotals(item.rewardBucketTotals)])
        .filter(([kidId]) => kidId));
    const selectedTotal = pointTotalsByKidId.get(selectedKidId);
    if (selectedTotal !== undefined) {
        pointData = { ...pointData, totalPoints: selectedTotal };
    }
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
    rememberPointLogMode(activeMode);
    selectedHistoryDayKey = todayHistoryDayKey();
    clearDraft();
    await Promise.all([loadPointsForSelectedKid(), loadPointTotalsForKids()]);
    render();
}

async function refreshAfterMutation() {
    await Promise.all([loadPointsForSelectedKid(), loadPointTotalsForKids()]);
    render();
}

async function createAdhocRuleFromDraft() {
    const name = String(pointDraft.name || '').trim();
    const emoji = String(pointDraft.emoji || '').trim();
    const points = Number.parseInt(pointDraft.points, 10);
    if (!name || !emoji) {
        throw new Error('Enter a name and emoji before creating a new rule.');
    }
    if (!Number.isInteger(points) || points <= 0) {
        throw new Error('Enter positive points before creating a new rule.');
    }
    const data = await fetchJson(`${API_BASE}/points/rules`, {
        method: 'POST',
        body: JSON.stringify({
            name,
            emoji,
            ruleKind: activeMode === 'deduction' ? 'deduction_event' : 'bonus_event',
            maxPoint: points,
            isActive: true,
        }),
    });
    const rule = data.rule || null;
    if (!rule?.ruleId) {
        throw new Error('Failed to create rule.');
    }
    rules = [...rules, rule];
    selectedRuleId = Number.parseInt(rule.ruleId, 10) || 0;
    return rule;
}

async function saveSelectedRuleFromDraft(rule) {
    if (!rule || Number(rule.ruleId) !== Number(selectedRuleId)) return rule;
    const name = String(pointDraft.name || '').trim();
    const emoji = String(pointDraft.emoji || '').trim();
    const points = Number.parseInt(pointDraft.points, 10);
    if (!name || !emoji || !Number.isInteger(points) || points <= 0) return rule;
    const nextMaxPoint = Math.max(ruleMaxPoint(rule), points);
    const didChange = name !== String(rule.name || '').trim()
        || emoji !== String(rule.emoji || '').trim()
        || nextMaxPoint !== ruleMaxPoint(rule);
    if (!didChange) return rule;
    const data = await fetchJson(`${API_BASE}/points/rules/${encodeURIComponent(rule.ruleId)}`, {
        method: 'PUT',
        body: JSON.stringify({
            name,
            emoji,
            maxPoint: nextMaxPoint,
        }),
    });
    const updatedRule = data.rule || rule;
    rules = rules.map((item) => (Number(item.ruleId) === Number(updatedRule.ruleId) ? updatedRule : item));
    selectedRuleId = Number.parseInt(updatedRule.ruleId, 10) || selectedRuleId;
    return updatedRule;
}

modeTabs.forEach((tab) => {
    tab.addEventListener('click', () => {
        const nextMode = tab.dataset.mode || 'bonus';
        if (nextMode === activeMode) return;
        activeMode = nextMode;
        rememberPointLogMode(activeMode);
        clearDraft();
        showError('');
        render();
    });
});

templateList.addEventListener('click', async (event) => {
    const ruleButton = event.target.closest('[data-rule-id]');
    if (ruleButton) {
        const ruleId = Number.parseInt(ruleButton.dataset.ruleId || '', 10) || 0;
        if (ruleId && Number(ruleId) === Number(selectedRuleId)) {
            clearDraft();
            render();
            return;
        }
        const rule = rules.find((item) => Number(item.ruleId) === ruleId);
        populateDraftFromRule(rule);
        syncDraftFromInputs({ preserveSelection: true });
        render();
    }
});

[pointEmoji, pointRuleName, pointPoints, pointNote].forEach((input) => {
    input?.addEventListener('input', () => {
        syncDraftFromInputs();
        renderTemplates();
        updateSubmitState();
        if (typeof window.hydrateIcons === 'function') {
            window.hydrateIcons(templateList);
        }
    });
});

pointLogForm.addEventListener('click', (event) => {
    const stepButton = event.target.closest('[data-point-step]');
    if (!stepButton) return;
    const delta = Number.parseInt(stepButton.dataset.pointStep || '', 10);
    if (!Number.isInteger(delta) || delta === 0) return;
    stepPoints(delta);
});

pointLogForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    submitPointLogBtn.disabled = true;
    showError('');
    try {
        syncDraftFromInputs({ preserveSelection: true });
        let rule = draftRuleForSubmit();
        if (!selectedKidId) return;
        if (!rule) {
            rule = await createAdhocRuleFromDraft();
        } else if (Number(rule.ruleId) === Number(selectedRuleId)) {
            rule = await saveSelectedRuleFromDraft(rule);
        }
        await fetchJson(`${API_BASE}/kids/${encodeURIComponent(selectedKidId)}/points/events`, {
            method: 'POST',
            body: JSON.stringify({
                ruleId: rule.ruleId,
                pointsDelta: Number.parseInt(pointDraft.points, 10),
                note: pointDraft.note,
            }),
        });
        clearDraft();
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
        await refreshAfterMutation();
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
    renderModeTabs();
    try {
        await loadInitialData();
    } catch (error) {
        showError(error.message || 'Failed to load point logging.');
        render();
    }
});
