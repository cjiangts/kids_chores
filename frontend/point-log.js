const API_BASE = `${window.location.origin}/api`;
const DEFAULT_POINT_HISTORY_LIMIT = 500;

const kidAvatarSwitcher = document.getElementById('kidAvatarSwitcher');
const logError = document.getElementById('logError');
const pointLogSuccess = document.getElementById('pointLogSuccess');
const pointLogForm = document.getElementById('pointLogForm');
const pointEmoji = document.getElementById('pointEmoji');
const pointRuleName = document.getElementById('pointRuleName');
const pointPoints = document.getElementById('pointPoints');
const pointNote = document.getElementById('pointNote');
const submitPointLogBtn = document.getElementById('submitPointLogBtn');
const pointLogKidPicker = document.getElementById('pointLogKidPicker');
const templateList = document.getElementById('templateList');
const pointHistory = document.getElementById('pointHistory');
const pointLogComposerModal = document.getElementById('pointLogComposerModal');
const pointLogComposerClose = document.querySelector('[data-point-log-composer-close]');
const pointLogComposerTitle = document.getElementById('pointLogComposerTitle');
const modeTabs = Array.from(document.querySelectorAll('[data-mode]'));
const initialParams = new URLSearchParams(window.location.search);
const requestedKidId = String(initialParams.get('kidId') || initialParams.get('id') || '').trim();
const requestedHistoryDayKey = /^\d{4}-\d{2}-\d{2}$/.test(String(initialParams.get('day') || '')) ? String(initialParams.get('day')) : '';
const requestedHistoryEventId = Number.parseInt(initialParams.get('eventId') || '', 10);
// A calendar link can point to an event older than the normal recent-history window.
const POINT_HISTORY_LIMIT = requestedHistoryEventId > 0 ? 5000 : DEFAULT_POINT_HISTORY_LIMIT;

const MODE_META = {
    bonus: {
        title: 'Bonus Event Rules',
        empty: 'No active earn rules yet. Add Earn from Rules.',
    },
    deduction: {
        title: 'Deduction Event Rules',
        empty: 'No active loss rules yet. Add Loss from Rules.',
    },
    rewards: {
        title: 'Reward Rules',
        empty: 'No active reward rules yet. Add rewards from Rules.',
    },
};

let kids = [];
let rules = [];
let selectedKidId = '';
let selectedLogKidIds = new Set();
let activeMode = '';
let selectedRuleId = 0;
let activeRewardType = '';
let inactiveRulesExpanded = false;
let pointDraft = { emoji: '', name: '', points: '0', note: '' };
let pointData = { totalPoints: 0, events: [] };
const pointDataByKid = new Map();
let selectedHistoryDayKey = '';
let highlightedHistoryEventId = requestedHistoryEventId;
let pointLogSuccessTimer = null;

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

function showSuccess(text) {
    if (!pointLogSuccess) return;
    if (pointLogSuccessTimer) window.clearTimeout(pointLogSuccessTimer);
    const message = String(text || '').trim();
    if (!message) {
        pointLogSuccess.innerHTML = '';
        pointLogSuccess.classList.add('hidden');
        return;
    }
    const checkIcon = typeof window.icon === 'function'
        ? window.icon('check', { size: 18, strokeWidth: 3 })
        : '<span class="icon" data-icon="check" data-icon-size="18"></span>';
    pointLogSuccess.innerHTML = `<span aria-hidden="true">${checkIcon}</span><span>${escapeHtml(message)}</span>`;
    pointLogSuccess.classList.remove('hidden');
    window.hydrateIcons?.(pointLogSuccess);
    pointLogSuccessTimer = window.setTimeout(() => showSuccess(''), 3600);
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

function selectedKidName() {
    const kid = kids.find((item) => String(item?.id || '') === selectedKidId);
    return kidName(kid) || 'this kid';
}

function kidNameById(kidId) {
    const kid = kids.find((item) => String(item?.id || '') === String(kidId || ''));
    return kidName(kid) || 'This kid';
}

function pointErrorForKid(kidId, error) {
    const message = String(error?.message || '').trim();
    if (!message) return 'Failed to log points.';
    const name = kidNameById(kidId);
    return message.replace(/^This kid\b/, name);
}

function historyEventName(row, fallback = 'this point event') {
    return String(row?.querySelector('.point-history-title')?.textContent || '').trim() || fallback;
}

function selectedFamilyTimezone() {
    const kid = kids.find((item) => String(item?.id || '') === selectedKidId);
    return String(kid?.familyTimezone || '').trim();
}

function todayHistoryDayKey() {
    return window.PointHistoryCommon.dateKeyInTimezone(new Date(), selectedFamilyTimezone());
}

function dateTimePartsInTimezone(date, timezone) {
    try {
        const parts = new Intl.DateTimeFormat('en-US', {
            timeZone: timezone || undefined,
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hourCycle: 'h23',
        }).formatToParts(date);
        const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
        return {
            year: Number.parseInt(values.year, 10),
            month: Number.parseInt(values.month, 10),
            day: Number.parseInt(values.day, 10),
            hour: Number.parseInt(values.hour, 10),
            minute: Number.parseInt(values.minute, 10),
            second: Number.parseInt(values.second, 10),
        };
    } catch (_error) {
        return null;
    }
}

function createdAtForSelectedHistoryDay() {
    const selectedDay = String(selectedHistoryDayKey || '').trim();
    const match = selectedDay.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) return '';

    const now = new Date();
    const timezone = selectedFamilyTimezone();
    const current = dateTimePartsInTimezone(now, timezone);
    const [year, month, day] = match.slice(1).map(Number);
    if (!current || !year || !month || !day) {
        return new Date(year, month - 1, day, now.getHours(), now.getMinutes(), now.getSeconds(), now.getMilliseconds()).toISOString();
    }

    // Interpret the selected calendar date with the current wall-clock time in
    // the family's timezone, then submit the equivalent UTC instant.
    const targetWallTime = Date.UTC(year, month - 1, day, current.hour, current.minute, current.second, now.getMilliseconds());
    const timezoneOffsetAt = (date) => {
        const local = dateTimePartsInTimezone(date, timezone);
        if (!local) return 0;
        return Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute, local.second) - date.getTime();
    };
    let result = new Date(targetWallTime - timezoneOffsetAt(new Date(targetWallTime)));
    // Recalculate once for a possible daylight-saving offset on the selected day.
    result = new Date(targetWallTime - timezoneOffsetAt(result));
    return Number.isNaN(result.getTime()) ? '' : result.toISOString();
}

function selectedHistoryDayLabel() {
    const dayKey = String(selectedHistoryDayKey || '').trim();
    if (!dayKey || dayKey === todayHistoryDayKey()) return 'Today';
    const match = dayKey.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) return 'Today';
    const [year, month, day] = match.slice(1).map(Number);
    return new Intl.DateTimeFormat(undefined, {
        timeZone: 'UTC',
        month: 'short',
        day: 'numeric',
        year: 'numeric',
    }).format(new Date(Date.UTC(year, month - 1, day)));
}

function updateComposerTitle() {
    if (pointLogComposerTitle) pointLogComposerTitle.textContent = `Add event · ${selectedHistoryDayLabel()}`;
}

function currentRulesForMode() {
    return rules.filter((rule) => {
        if (activeMode === 'bonus') return rule.ruleKind === 'bonus_event';
        if (activeMode === 'deduction') return rule.ruleKind === 'deduction_event';
        if (activeMode === 'rewards') return rule.ruleKind === 'redeemed_reward' && (!activeRewardType || rewardType(rule) === activeRewardType);
        return false;
    });
}

function filteredRulesForMode() {
    const query = selectedRuleId ? '' : String(pointDraft.name || '').trim().toLowerCase();
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
    return Number.parseInt(pointData.totalPoints, 10) || 0;
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

function selectedRewardBucketBalance(bucket = activeRewardType) {
    const normalized = String(bucket || '').trim().toLowerCase();
    if (!normalized) return selectedBalance();
    const totals = normalizeRewardBucketTotals(pointData.rewardBucketTotals);
    return Number.parseInt(totals?.[normalized], 10) || 0;
}

function isRedeemedRewardRule(rule) {
    return String(rule?.ruleKind || '') === 'redeemed_reward';
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

function selectedRule() {
    return rules.find((rule) => Number(rule.ruleId) === Number(selectedRuleId)) || null;
}

function setSubmitButtonLabel(label) {
    if (!submitPointLogBtn) return;
    submitPointLogBtn.setAttribute('aria-label', label);
    submitPointLogBtn.title = label;
    submitPointLogBtn.textContent = label;
}

function hasActiveSelection() {
    return Boolean(selectedRule());
}

function exactDraftRule() {
    const name = String(pointDraft.name || '').trim().toLowerCase();
    if (!name) return null;
    return currentRulesForMode().find((rule) => (
        rule.isActive && String(rule?.name || '').trim().toLowerCase() === name
    )) || null;
}

function draftRuleForSubmit() {
    return selectedRule() || exactDraftRule();
}

function clearSelection() {
    selectedRuleId = 0;
}

function clearDraft() {
    selectedRuleId = 0;
    pointDraft = { emoji: '', name: '', points: '0', note: '' };
    if (pointEmoji) pointEmoji.value = '';
    if (pointRuleName) pointRuleName.value = '';
    if (pointPoints) pointPoints.value = '0';
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
    const base = Number.isInteger(current) && current >= 0 ? current : 0;
    const next = Math.max(0, base + delta);
    pointPoints.value = String(next);
    syncDraftFromInputs();
    renderTemplates();
    updateSubmitState();
    if (typeof window.hydrateIcons === 'function') {
        window.hydrateIcons(templateList);
    }
}

function rewardType(rule) {
    return window.PointRuleTemplateCommon.rewardType(rule);
}

function defaultRewardTypeFromRules() {
    const firstRule = rules.find((rule) => (
        String(rule?.ruleKind || '') === 'redeemed_reward'
        && String(rule?.rewardType || '').trim()
    ));
    return rewardType(firstRule);
}

function rewardTabLabel() {
    return 'Redeem';
}

function renderKids() {
    if (!window.KidAppNavigation?.renderKidAvatarSwitcher) return;
    window.KidAppNavigation.renderKidAvatarSwitcher(kidAvatarSwitcher, kids, {
        selectedKidId,
        onSelect: async (kidId) => {
            if (!kidId || kidId === selectedKidId) return;
            selectedKidId = kidId;
            syncSelectedKidNavigation();
            selectedHistoryDayKey = '';
            clearDraft();
            showError('');
            try {
                await loadPointsForSelectedKid();
                render();
            } catch (error) {
                showError(error.message || 'Failed to load points.');
            }
        },
    });
}

function logKidAvatarHtml(kid) {
    const avatarUrl = String(kid?.avatarUrl || '').trim();
    if (avatarUrl) {
        return `<span class="kid-initial-avatar kid-initial-avatar--photo" style="background-image:url('${avatarUrl.replace(/'/g, '%27')}')" aria-hidden="true"></span>`;
    }
    const name = kidName(kid);
    const seed = String(kid?.id || name);
    const tone = [...seed].reduce((total, char) => total + char.charCodeAt(0), 0) % 6;
    return `<span class="kid-initial-avatar kid-initial-avatar--tone-${tone}" aria-hidden="true">${escapeHtml([...name][0] || '?')}</span>`;
}

function selectedLogKids() {
    return kids.filter((kid) => selectedLogKidIds.has(String(kid?.id || '')));
}

function renderLogKidPicker() {
    if (!pointLogKidPicker) return;
    pointLogKidPicker.innerHTML = kids.map((kid) => {
        const id = String(kid?.id || '').trim();
        const isSelected = selectedLogKidIds.has(id);
        return `
            <button type="button" class="point-log-kid-option paradigm-compact-control${isSelected ? ' selected' : ''}" data-log-kid-id="${escapeHtml(id)}" aria-pressed="${isSelected ? 'true' : 'false'}">
                ${logKidAvatarHtml(kid)}
                <span>${escapeHtml(kidName(kid))}</span>
            </button>
        `;
    }).join('');
}

function renderModeTabs() {
    modeTabs.forEach((tab) => {
        const mode = String(tab.dataset.mode || '');
        tab.classList.toggle('active', mode === activeMode);
        const label = mode === 'bonus'
            ? 'Earn'
            : (mode === 'deduction' ? 'Loss' : rewardTabLabel());
        tab.querySelectorAll('.point-rule-tab-long, .point-rule-tab-short').forEach((node) => {
            node.textContent = label;
        });
    });
    pointLogForm.classList.toggle('is-bonus', activeMode === 'bonus');
    pointLogForm.classList.toggle('is-deduction', activeMode === 'deduction');
    pointLogForm.classList.toggle('is-rewards', activeMode === 'rewards');
}

function templateRow(rule) {
    const isActive = Number(rule.ruleId) === Number(selectedRuleId);
    const draftPoints = Number.parseInt(pointDraft.points, 10);
    const displayRule = isActive
        ? {
            ...rule,
            emoji: String(pointDraft.emoji || rule.emoji || '').trim(),
            name: String(pointDraft.name || rule.name || '').trim(),
            maxPoint: Number.isInteger(draftPoints) && draftPoints > 0 ? draftPoints : rule.maxPoint,
        }
        : rule;
    return window.PointRuleTemplateCommon.renderRuleRow(displayRule, {
        active: isActive,
        iconHref: `/point-activity-report.html?ruleId=${encodeURIComponent(rule.ruleId)}`,
        selectable: Boolean(rule.isActive),
        showCheck: false,
    });
}

function inactiveRulesToggle(count) {
    const safeCount = Math.max(0, Number.parseInt(count, 10) || 0);
    if (!safeCount) return '';
    const iconName = inactiveRulesExpanded ? 'chevron-up' : 'chevron-down';
    const iconHtml = typeof window.icon === 'function'
        ? window.icon(iconName, { size: 18, strokeWidth: 2.6 })
        : '';
    const label = inactiveRulesExpanded
        ? 'Hide inactive rules'
        : `${safeCount} more inactive rule${safeCount === 1 ? '' : 's'}`;
    return `
        <button type="button" class="point-inactive-rules-toggle" data-inactive-rule-toggle aria-expanded="${inactiveRulesExpanded ? 'true' : 'false'}">
            <span class="point-inactive-rules-toggle-icon" aria-hidden="true">${iconHtml}</span>
            <span>${escapeHtml(label)}</span>
        </button>
    `;
}

function renderTemplates() {
    if (!activeMode) {
        templateList.classList.remove('has-selection');
        templateList.innerHTML = '';
        return;
    }
    templateList.classList.toggle('has-selection', hasActiveSelection());
    const modeRules = filteredRulesForMode();
    const activeRules = modeRules.filter((rule) => rule.isActive);
    const inactiveRules = modeRules.filter((rule) => !rule.isActive);
    const visibleRules = inactiveRulesExpanded ? modeRules : activeRules;
    if (!visibleRules.length && !inactiveRules.length) {
        const hasQuery = Boolean(String(pointDraft.name || '').trim());
        templateList.innerHTML = `<div class="point-empty">${escapeHtml(hasQuery ? 'No matching rules yet.' : (MODE_META[activeMode]?.empty || ''))}</div>`;
        return;
    }
    const emptyHtml = !visibleRules.length
        ? '<div class="point-empty">No active rules yet.</div>'
        : '';
    templateList.innerHTML = `${emptyHtml}<div class="point-template-frame">${visibleRules.map(templateRow).join('')}</div>${inactiveRulesToggle(inactiveRules.length)}`;
}

function refreshTemplateSelection(ruleIds) {
    templateList.classList.toggle('has-selection', hasActiveSelection());
    [...new Set(ruleIds.filter((ruleId) => Number.isInteger(ruleId) && ruleId > 0))].forEach((ruleId) => {
        const row = templateList.querySelector(`[data-rule-id="${ruleId}"]`);
        const rule = rules.find((item) => Number(item?.ruleId) === ruleId);
        if (!row || !rule) return;
        row.outerHTML = templateRow(rule);
    });
    window.hydrateIcons?.(templateList);
}

function renderHistory() {
    selectedHistoryDayKey = window.PointHistoryCommon.render(pointHistory, {
        selectedKidId,
        events: activityEventsWithBalance(),
        selectedDayKey: selectedHistoryDayKey,
        familyTimezone: selectedFamilyTimezone(),
        showDelete: true,
        showRowActions: false,
        clickToEdit: true,
        showBalance: true,
        highlightEventId: highlightedHistoryEventId,
        mode: 'all',
        sortOrder: 'asc',
        emptyDay: 'No point activity for this day.',
    });
    pointHistory.insertAdjacentHTML('beforeend', `
        <div class="point-history-add-event-row" role="group" aria-label="Add point event">
            <span class="point-history-add-event-label">Add event</span>
            <button type="button" class="point-history-add-event-btn earn" data-point-composer-mode="bonus"><span class="icon" data-icon="plus" data-icon-size="14" data-icon-stroke="3"></span>Earn</button>
            <button type="button" class="point-history-add-event-btn loss" data-point-composer-mode="deduction"><span class="icon" data-icon="plus" data-icon-size="14" data-icon-stroke="3"></span>Loss</button>
            <button type="button" class="point-history-add-event-btn redeem" data-point-composer-mode="rewards"><span class="icon" data-icon="plus" data-icon-size="14" data-icon-stroke="3"></span>Redeem</button>
        </div>
    `);
    window.hydrateIcons?.(pointHistory);
}

function activityEventsWithBalance() {
    const events = Array.isArray(pointData.events) ? pointData.events : [];
    const rewardBucket = activeRewardType || defaultRewardTypeFromRules();
    let balance = selectedRewardBucketBalance(rewardBucket);
    const newestFirst = [...events]
        .filter((event) => {
            const rule = event?.rule || {};
            return !isRedeemedRewardRule(rule) || rewardType(rule) === rewardBucket;
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
    return newestFirst.reverse();
}

function openPointLogComposer(mode) {
    const nextMode = ['bonus', 'deduction', 'rewards'].includes(mode) ? mode : 'bonus';
    activeMode = nextMode;
    inactiveRulesExpanded = false;
    clearDraft();
    showError('');
    updateComposerTitle();
    renderWorkbench();
    pointLogComposerModal?.classList.remove('hidden');
    pointLogComposerModal?.setAttribute('aria-hidden', 'false');
    document.body.classList.add('modal-open');
}

function closePointLogComposer() {
    pointLogComposerModal?.classList.add('hidden');
    pointLogComposerModal?.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('modal-open');
    activeMode = '';
    clearDraft();
    renderWorkbench();
}

function updateSubmitState() {
    const name = String(pointDraft.name || '').trim();
    const emoji = String(pointDraft.emoji || '').trim();
    const points = Number.parseInt(pointDraft.points, 10);
    const hasPositivePoints = Number.isInteger(points) && points > 0;
    const rule = draftRuleForSubmit();
    const canCreate = Boolean(name && emoji && hasPositivePoints);
    const selectedKids = selectedLogKids();
    const canSubmit = Boolean(selectedKids.length && hasPositivePoints && (rule || canCreate));
    const cannotAfford = cannotAffordSelectedReward();
    submitPointLogBtn.disabled = !canSubmit || cannotAfford;
    const missing = [];
    if (!selectedKids.length) missing.push('Kids');
    if (!rule && !name) missing.push('Activity');
    if (!rule && name && !emoji) missing.push('Emoji');
    if (!hasPositivePoints) missing.push('Points');
    if (missing.length) {
        setSubmitButtonLabel(`Select ${missing.join(' · ')}`);
        return;
    }
    const signedPoints = rule
        ? signedPointValueForRule(rule, hasPositivePoints ? points : 1)
        : (activeMode === 'deduction' || activeMode === 'rewards' ? -1 : 1) * (hasPositivePoints ? points : 1);
    const verb = signedPoints < 0 ? (activeMode === 'rewards' ? 'Redeem' : 'Remove') : 'Add';
    const recipients = selectedKids.map(kidName).join(', ');
    setSubmitButtonLabel(recipients
        ? `${verb} ${formatDelta(signedPoints)} to ${recipients}`
        : 'Choose kids');
}

function render() {
    if (activeMode && !activeRewardType) {
        activeRewardType = defaultRewardTypeFromRules();
    }
    renderKids();
    renderLogKidPicker();
    renderModeTabs();
    renderTemplates();
    renderHistory();
    updateSubmitState();
    hydrateIcons(document);
}

function renderWorkbench() {
    renderModeTabs();
    renderLogKidPicker();
    renderTemplates();
    updateSubmitState();
    window.hydrateIcons?.(pointLogComposerModal);
}

async function loadPointsForSelectedKid({ force = false } = {}) {
    if (!selectedKidId) {
        pointData = { totalPoints: 0, events: [] };
        return;
    }
    const cached = pointDataByKid.get(selectedKidId);
    const data = (!force && cached)
        ? cached
        : await fetchJson(`${API_BASE}/kids/${encodeURIComponent(selectedKidId)}/points?limit=${POINT_HISTORY_LIMIT}`);
    pointData = data || { totalPoints: 0, events: [] };
    pointDataByKid.set(selectedKidId, pointData);
    window.KidAppNavigation?.cacheKidAvatarPointData?.(selectedKidId, pointData);
}

async function loadInitialData() {
    showError('');
    const [kidsData, rulesData] = await Promise.all([
        fetchJson(`${API_BASE}/kids?view=reward_nav`),
        fetchJson(`${API_BASE}/points/rules?includeInactive=1`),
    ]);
    kids = Array.isArray(kidsData) ? kidsData : [];
    rules = Array.isArray(rulesData.rules) ? rulesData.rules : [];
    selectedKidId = initialKidId();
    selectedLogKidIds = new Set();
    activeRewardType = defaultRewardTypeFromRules();
    syncSelectedKidNavigation();
    selectedHistoryDayKey = requestedHistoryDayKey;
    clearDraft();
    await loadPointsForSelectedKid();
    render();
    if (highlightedHistoryEventId > 0) {
        window.requestAnimationFrame(() => {
            pointHistory.querySelector(`[data-event-id="${highlightedHistoryEventId}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        });
    }
}

async function refreshAfterMutation() {
    await loadPointsForSelectedKid({ force: true });
    render();
    if (highlightedHistoryEventId > 0) {
        window.requestAnimationFrame(() => {
            pointHistory.querySelector(`[data-event-id="${highlightedHistoryEventId}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        });
    }
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
    const ruleKind = activeMode === 'deduction'
        ? 'deduction_event'
        : (activeMode === 'rewards' ? 'redeemed_reward' : 'bonus_event');
    const payload = {
        name,
        emoji,
        ruleKind,
        maxPoint: points,
        isActive: true,
    };
    if (ruleKind === 'redeemed_reward') {
        payload.rewardType = activeRewardType || defaultRewardTypeFromRules() || 'reward';
    }
    const data = await fetchJson(`${API_BASE}/points/rules`, {
        method: 'POST',
        body: JSON.stringify(payload),
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
    const didChange = name !== String(rule.name || '').trim()
        || emoji !== String(rule.emoji || '').trim();
    if (!didChange) return rule;
    const data = await fetchJson(`${API_BASE}/points/rules/${encodeURIComponent(rule.ruleId)}`, {
        method: 'PUT',
        body: JSON.stringify({
            name,
            emoji,
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
        activeMode = nextMode === activeMode ? '' : nextMode;
        clearDraft();
        showError('');
        renderWorkbench();
    });
});

pointHistory.addEventListener('click', (event) => {
    const button = event.target.closest('[data-point-composer-mode]');
    if (!button) return;
    openPointLogComposer(button.dataset.pointComposerMode);
});

pointLogComposerClose?.addEventListener('click', closePointLogComposer);
pointLogComposerModal?.addEventListener('click', (event) => {
    if (event.target === pointLogComposerModal) closePointLogComposer();
});
document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !pointLogComposerModal?.classList.contains('hidden')) {
        closePointLogComposer();
    }
});

templateList.addEventListener('click', (event) => {
    if (event.target.closest('[data-inactive-rule-toggle]')) {
        inactiveRulesExpanded = !inactiveRulesExpanded;
        renderTemplates();
        window.hydrateIcons?.(templateList);
        return;
    }
    if (event.target.closest('[data-rule-report-link]')) {
        return;
    }
    const ruleButton = event.target.closest('[data-rule-id]');
    if (ruleButton) {
        const ruleId = Number.parseInt(ruleButton.dataset.ruleId || '', 10) || 0;
        const previousRuleId = Number(selectedRuleId) || 0;
        if (ruleId && Number(ruleId) === Number(selectedRuleId)) {
            clearDraft();
            refreshTemplateSelection([previousRuleId]);
            updateSubmitState();
            return;
        }
        const rule = rules.find((item) => Number(item.ruleId) === ruleId);
        if (!rule?.isActive) return;
        populateDraftFromRule(rule);
        syncDraftFromInputs({ preserveSelection: true });
        refreshTemplateSelection([previousRuleId, Number(selectedRuleId) || 0]);
        updateSubmitState();
    }
});

templateList.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    if (event.target.closest('[data-rule-report-link]')) return;
    const ruleRow = event.target.closest('[data-rule-id][role="button"]');
    if (!ruleRow || !templateList.contains(ruleRow)) return;
    event.preventDefault();
    ruleRow.click();
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

async function resolveSubmitRule() {
    syncDraftFromInputs({ preserveSelection: true });
    let rule = draftRuleForSubmit();
    if (!rule) {
        rule = await createAdhocRuleFromDraft();
    } else if (Number(rule.ruleId) === Number(selectedRuleId)) {
        rule = await saveSelectedRuleFromDraft(rule);
    }
    return rule;
}

async function awardDraftToKid(kidId, rule, createdAt) {
    try {
        return await fetchJson(`${API_BASE}/kids/${encodeURIComponent(kidId)}/points/events`, {
            method: 'POST',
            body: JSON.stringify({
                ruleId: rule.ruleId,
                pointsDelta: Number.parseInt(pointDraft.points, 10),
                note: pointDraft.note,
                ...(createdAt ? { createdAt } : {}),
            }),
        });
    } catch (error) {
        throw new Error(pointErrorForKid(kidId, error));
    }
}

pointLogForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    submitPointLogBtn.disabled = true;
    showError('');
    showSuccess('');
    try {
        const targetKidIds = [...selectedLogKidIds];
        if (!targetKidIds.length) return;
        const targetKids = selectedLogKids();
        const rule = await resolveSubmitRule();
        const createdAt = createdAtForSelectedHistoryDay();
        let selectedKidEventId = 0;
        let soleKidEventId = 0;
        for (const kidId of targetKidIds) {
            const result = await awardDraftToKid(kidId, rule, createdAt);
            const eventId = Number.parseInt(result?.event?.eventId, 10) || 0;
            if (targetKidIds.length === 1) soleKidEventId = eventId;
            if (String(kidId) === selectedKidId) {
                selectedKidEventId = eventId;
            }
        }
        if (targetKidIds.length === 1 && soleKidEventId > 0) {
            selectedKidId = String(targetKidIds[0]);
            syncSelectedKidNavigation();
            highlightedHistoryEventId = soleKidEventId;
        } else if (selectedKidEventId > 0) {
            highlightedHistoryEventId = selectedKidEventId;
        }
        const signedPoints = signedPointValueForRule(rule, Number.parseInt(pointDraft.points, 10));
        const names = targetKids.map(kidName).join(', ');
        const ruleName = String(rule?.name || '').trim();
        const verb = signedPoints < 0 ? (activeMode === 'rewards' ? 'Redeemed' : 'Removed') : 'Added';
        const preposition = activeMode === 'rewards' ? 'for' : (signedPoints < 0 ? 'from' : 'to');
        clearDraft();
        selectedLogKidIds.clear();
        activeMode = '';
        closePointLogComposer();
        await refreshAfterMutation();
        showSuccess(`${verb} ${formatDelta(signedPoints)}${ruleName ? ` · ${ruleName}` : ''} ${preposition} ${names}.`);
    } catch (error) {
        showError(error.message || 'Failed to log points.');
        updateSubmitState();
    }
});

pointLogKidPicker?.addEventListener('click', (event) => {
    const option = event.target.closest('[data-log-kid-id]');
    if (!option) return;
    const kidId = String(option.dataset.logKidId || '').trim();
    if (!kidId) return;
    if (selectedLogKidIds.has(kidId)) selectedLogKidIds.delete(kidId);
    else selectedLogKidIds.add(kidId);
    renderLogKidPicker();
    updateSubmitState();
});

pointHistory.addEventListener('click', async (event) => {
    const dayButton = event.target.closest('[data-history-day]');
    if (dayButton) {
        const nextDayKey = String(dayButton.dataset.historyDay || '');
        if (!nextDayKey) return;
        selectedHistoryDayKey = nextDayKey;
        pointHistory.dataset.pointHistoryWeekAnchorDayKey = nextDayKey;
        renderHistory();
        return;
    }

    const button = event.target.closest('[data-history-action="delete"]');
    if (!button || !selectedKidId) return;
    const row = button.closest('[data-event-id]');
    const eventId = Number.parseInt(row?.dataset.eventId || '', 10);
    if (!(eventId > 0)) return;
    if (!window.confirm(`Delete "${historyEventName(row)}" for ${selectedKidName()}?`)) return;
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

pointHistory.addEventListener('point-history-active-day-change', (event) => {
    const dayKey = String(event.detail?.dayKey || '').trim();
    if (dayKey) selectedHistoryDayKey = dayKey;
});

pointHistory.addEventListener('point-history-edit-note', async (event) => {
    const detail = event.detail || {};
    const eventId = Number.parseInt(detail.eventId, 10);
    if (!(eventId > 0) || !selectedKidId) return;
    showError('');
    try {
        await fetchJson(`${API_BASE}/kids/${encodeURIComponent(selectedKidId)}/points/events/${eventId}`, {
            method: 'PATCH',
            body: JSON.stringify({ pointsDelta: detail.pointsDelta, note: detail.note, createdAt: detail.createdAt }),
        });
        pointHistory.__pointHistoryTimeDraft = null;
        await refreshAfterMutation();
    } catch (error) {
        showError(error.message || (detail.createdAt ? 'Failed to update time.' : 'Failed to update note.'));
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
