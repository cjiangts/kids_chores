const API_BASE = `${window.location.origin}/api`;
const POINT_RULE_KIND_STORAGE_KEY = 'point_rules_last_kind_v1';

const tabs = Array.from(document.querySelectorAll('.point-rule-tab'));
const ruleError = document.getElementById('ruleError');
const ruleList = document.getElementById('ruleList');

const RULE_KINDS = new Set([
    'in_app_chore',
    'off_app_chore',
    'bonus_event',
    'deduction_event',
    'redeemed_reward',
]);
function normalizeRuleKind(kind) {
    const normalized = String(kind || '').trim();
    return RULE_KINDS.has(normalized) ? normalized : '';
}

function normalizeRequestedRuleKind(value) {
    const raw = String(value || '').trim().toLowerCase().replace(/-/g, '_');
    if (raw === 'bonus' || raw === 'bonus_event' || raw === 'bonus_events') return 'bonus_event';
    if (raw === 'deduction' || raw === 'deduction_event' || raw === 'deduction_events') return 'deduction_event';
    return normalizeRuleKind(raw);
}

function requestedRuleKind() {
    const params = new URLSearchParams(window.location.search);
    return normalizeRequestedRuleKind(params.get('kind') || params.get('ruleKind') || params.get('mode') || params.get('tab'));
}

function readStoredRuleKind() {
    try {
        if (!window.sessionStorage) return '';
        return normalizeRuleKind(window.sessionStorage.getItem(POINT_RULE_KIND_STORAGE_KEY));
    } catch (error) {
        return '';
    }
}

function rememberRuleKind(kind) {
    const normalized = normalizeRuleKind(kind);
    if (!normalized) return;
    try {
        if (!window.sessionStorage) return;
        window.sessionStorage.setItem(POINT_RULE_KIND_STORAGE_KEY, normalized);
    } catch (error) {
        // best-effort UI memory
    }
}

let activeRuleKind = requestedRuleKind() || readStoredRuleKind() || 'in_app_chore';
let rules = [];
let categories = [];

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
    showMessage(ruleError, text || '');
}

function getRuleKindRules(kind = activeRuleKind) {
    return rules.filter((rule) => rule.ruleKind === kind);
}

function rewardType(rule) {
    const value = String(rule?.rewardType || '').trim().toLowerCase();
    return value;
}

function rewardTypeLabel(value) {
    const normalized = rewardType({ rewardType: value });
    return normalized
        .replace(/[_-]+/g, ' ')
        .replace(/\b\w/g, (ch) => ch.toUpperCase())
        .trim() || 'Reward';
}

function rewardTypeSuggestions() {
    const types = new Set();
    rules
        .filter((rule) => String(rule?.ruleKind || '') === 'redeemed_reward')
        .forEach((rule) => types.add(rewardType(rule)));
    return Array.from(types).filter(Boolean).sort((a, b) => {
        return rewardTypeLabel(a).localeCompare(rewardTypeLabel(b));
    });
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

async function loadAll() {
    showError('');
    const [rulesData, categoryData] = await Promise.all([
        fetchJson(`${API_BASE}/points/rules?includeInactive=1`),
        fetchJson(`${API_BASE}/shared-decks/categories`),
    ]);
    rules = Array.isArray(rulesData.rules) ? rulesData.rules : [];
    categories = Array.isArray(categoryData.categories) ? categoryData.categories : [];
    render();
}

async function setActiveRuleKind(kind) {
    activeRuleKind = normalizeRuleKind(kind) || 'in_app_chore';
    rememberRuleKind(activeRuleKind);
    showError('');
    render();
}

function renderRuleTabs() {
    tabs.forEach((tab) => {
        tab.classList.toggle('active', tab.dataset.ruleKind === activeRuleKind);
    });
}

function inputCell(label, field, value, extraClass = '', type = 'text') {
    return `
        <div class="point-rule-cell">
            <input
                class="paradigm-input point-rule-input ${escapeHtml(extraClass)}"
                type="${escapeHtml(type)}"
                data-field="${escapeHtml(field)}"
                value="${escapeHtml(value ?? '')}"
                ${type === 'number' ? 'step="1"' : ''}
                autocomplete="off"
            >
        </div>
    `;
}

function rewardTypeCell(rule) {
    const type = rule ? rewardType(rule) : '';
    const value = type ? rewardTypeLabel(type) : '';
    return `
        <div class="point-rule-cell">
            <input
                class="paradigm-input point-rule-input reward-type"
                type="text"
                data-field="rewardType"
                value="${escapeHtml(value)}"
                list="rewardTypeSuggestions"
                autocomplete="off"
            >
        </div>
    `;
}

function rewardTypeDatalist() {
    return `
        <datalist id="rewardTypeSuggestions">
            ${rewardTypeSuggestions().map((type) => `
                <option value="${escapeHtml(rewardTypeLabel(type))}"></option>
            `).join('')}
        </datalist>
    `;
}

function activeCell(rule) {
    const checked = !rule || rule.isActive ? 'checked' : '';
    return `
        <div class="point-rule-cell">
            <label class="point-rule-active">
                <input type="checkbox" data-field="isActive" ${checked}>
                <span>Active</span>
            </label>
        </div>
    `;
}

function subjectCell(category) {
    const categoryKey = String(category?.category_key || '').trim();
    const subjectIconHtml = typeof window.subjectIcon === 'function'
        ? window.subjectIcon(categoryKey, { size: 32 })
        : '';
    return `
        <div class="point-rule-cell">
            <div class="point-rule-subject">
                ${subjectIconHtml}
                <span>${escapeHtml(categoryLabel(category))}</span>
            </div>
        </div>
    `;
}

function actionCell(rule) {
    const isNew = !rule;
    return `
        <div class="point-rule-actions">
            <button type="button" class="paradigm-btn" data-rule-action="save" disabled>
                ${icon(isNew ? 'plus' : 'save', { size: 17 })}
                ${isNew ? 'Add' : 'Save'}
            </button>
        </div>
    `;
}

function renderRuleRow(rule) {
    const isOffApp = activeRuleKind === 'off_app_chore';
    const isRewardCatalog = activeRuleKind === 'redeemed_reward';
    const isNew = !rule;
    const rowClasses = [
        'point-rule-table-row',
        isOffApp ? 'off-app' : '',
        isRewardCatalog ? 'reward' : '',
        isNew ? 'new-row' : '',
        rule && !rule.isActive ? 'inactive' : '',
    ].filter(Boolean).join(' ');
    const cells = [
        inputCell('Emoji', 'emoji', rule?.emoji || '', 'emoji'),
        inputCell('Name', 'name', rule?.name || '', 'name'),
    ];
    if (isRewardCatalog) {
        cells.push(rewardTypeCell(rule));
    }
    cells.push(inputCell('Default points', 'maxPoint', rule?.maxPoint ?? '', 'points', 'number'));
    cells.push(activeCell(rule));
    cells.push(actionCell(rule));
    return `
        <div class="${rowClasses}" data-rule-id="${escapeHtml(rule?.ruleId || '')}">
            ${cells.join('')}
        </div>
    `;
}

function renderAppDailyRow(category) {
    const categoryKey = String(category.category_key || '').trim();
    const rule = getTriggeredRuleForCategory(categoryKey);
    const rowClasses = [
        'point-rule-table-row',
        'in-app',
        rule ? '' : 'new-row',
        rule && !rule.isActive ? 'inactive' : '',
    ].filter(Boolean).join(' ');
    const defaultName = categoryLabel(category);
    const cells = [
        subjectCell(category),
        inputCell('Default points', 'maxPoint', rule?.maxPoint ?? '', 'points', 'number'),
        activeCell(rule),
        actionCell(rule),
    ];
    return `
        <div
            class="${rowClasses}"
            data-category-key="${escapeHtml(categoryKey)}"
            data-subject-name="${escapeHtml(defaultName)}"
            data-rule-id="${escapeHtml(rule?.ruleId || '')}"
        >
            ${cells.join('')}
        </div>
    `;
}

function renderRuleHeader() {
    const headerCell = (label, shortLabel = label) => `
        <div>
            <span class="point-rule-header-full">${escapeHtml(label)}</span>
            <span class="point-rule-header-short">${escapeHtml(shortLabel)}</span>
        </div>
    `;
    if (activeRuleKind === 'in_app_chore') {
        return `
            <div class="point-rule-table-row header in-app">
                ${[
                    headerCell('Subject'),
                    headerCell('Default points', 'Pts'),
                    headerCell('Active', 'On'),
                    headerCell('Actions', ''),
                ].join('')}
            </div>
        `;
    }
    const isOffApp = activeRuleKind === 'off_app_chore';
    const isRewardCatalog = activeRuleKind === 'redeemed_reward';
    const headers = isOffApp
        ? [
            ['Emoji', 'Emoji'],
            ['Name', 'Name'],
            ['Default points', 'Pts'],
            ['Active', 'On'],
            ['Actions', ''],
        ]
        : isRewardCatalog
            ? [
                ['Emoji', 'Emoji'],
                ['Name', 'Name'],
                ['Reward type', 'Type'],
                ['Default points', 'Pts'],
                ['Active', 'On'],
                ['Actions', ''],
            ]
        : [
            ['Emoji', 'Emoji'],
            ['Name', 'Name'],
            ['Default points', 'Pts'],
            ['Active', 'On'],
            ['Actions', ''],
        ];
    return `
        <div class="point-rule-table-row header ${isOffApp ? 'off-app' : ''} ${isRewardCatalog ? 'reward' : ''}">
            ${headers.map(([label, shortLabel]) => headerCell(label, shortLabel)).join('')}
        </div>
    `;
}

function payloadSnapshot(row) {
    return JSON.stringify(collectPayloadFromRow(row));
}

function updateRowSaveState(row) {
    if (!row || row.classList.contains('header')) return;
    const button = row.querySelector('[data-rule-action="save"]');
    if (!button) return;
    const isDirty = payloadSnapshot(row) !== (row.dataset.originalPayload || '');
    button.disabled = !isDirty;
    row.classList.toggle('is-dirty', isDirty);
}

function initializeRowSaveStates(root = ruleList) {
    root.querySelectorAll('.point-rule-table-row:not(.header)').forEach((row) => {
        row.dataset.originalPayload = payloadSnapshot(row);
        updateRowSaveState(row);
    });
}

function renderRules() {
    if (activeRuleKind === 'in_app_chore') {
        if (!categories.length) {
            ruleList.innerHTML = '<div class="point-rule-empty">No app categories available.</div>';
            return;
        }
        ruleList.innerHTML = `
            <div class="point-rule-table">
                ${renderRuleHeader()}
                ${categories.map(renderAppDailyRow).join('')}
            </div>
        `;
        hydrateIcons(ruleList);
        initializeRowSaveStates();
        return;
    }

    const visibleRules = getRuleKindRules();
    ruleList.innerHTML = `
        <div class="point-rule-table">
            ${renderRuleHeader()}
            ${renderRuleRow(null)}
            ${visibleRules.map(renderRuleRow).join('')}
        </div>
        ${activeRuleKind === 'redeemed_reward' ? rewardTypeDatalist() : ''}
    `;
    hydrateIcons(ruleList);
    initializeRowSaveStates();
}

function collectPayloadFromRow(row) {
    const getValue = (field) => {
        const input = row.querySelector(`[data-field="${field}"]`);
        return input ? input.value.trim() : '';
    };
    const getNumber = (field) => Number.parseInt(getValue(field), 10);
    const activeInput = row.querySelector('[data-field="isActive"]');
    const isInApp = activeRuleKind === 'in_app_chore';
    const payload = {
        name: isInApp ? String(row.dataset.subjectName || '').trim() : getValue('name'),
        emoji: isInApp ? '' : getValue('emoji'),
        ruleKind: activeRuleKind,
        isActive: activeInput ? activeInput.checked : true,
    };
    if (isInApp) {
        payload.triggerKey = String(row.dataset.categoryKey || '').trim();
    }
    if (activeRuleKind === 'redeemed_reward') {
        payload.rewardType = getValue('rewardType');
    }
    payload.maxPoint = getValue('maxPoint') ? getNumber('maxPoint') : null;
    return payload;
}

async function saveAppDailyRow(row) {
    let ruleId = Number.parseInt(row.dataset.ruleId || '', 10);
    const payload = collectPayloadFromRow(row);
    const pointsText = String(row.querySelector('[data-field="maxPoint"]')?.value || '').trim();

    try {
        if (!(ruleId > 0) && !payload.isActive && !pointsText) {
            await loadAll();
            return;
        }

        if (ruleId > 0) {
            await fetchJson(`${API_BASE}/points/rules/${ruleId}`, {
                method: 'PUT',
                body: JSON.stringify(payload),
            });
        } else {
            const data = await fetchJson(`${API_BASE}/points/rules`, {
                method: 'POST',
                body: JSON.stringify(payload),
            });
            ruleId = Number.parseInt(data.rule?.ruleId, 10);
        }

        await loadAll();
    } catch (error) {
        showError(error.message || 'Failed to save subject points.');
    }
}

async function saveRuleRow(row) {
    const button = row?.querySelector('[data-rule-action="save"]');
    if (!row || button?.disabled) {
        return;
    }
    if (activeRuleKind === 'in_app_chore') {
        await saveAppDailyRow(row);
        return;
    }
    const ruleId = Number.parseInt(row.dataset.ruleId || '', 10);
    const payload = collectPayloadFromRow(row);
    try {
        if (ruleId > 0) {
            await fetchJson(`${API_BASE}/points/rules/${ruleId}`, {
                method: 'PUT',
                body: JSON.stringify(payload),
            });
            await loadAll();
        } else {
            await fetchJson(`${API_BASE}/points/rules`, {
                method: 'POST',
                body: JSON.stringify(payload),
            });
            await loadAll();
        }
    } catch (error) {
        showError(error.message || 'Failed to save rule.');
    }
}

function getTriggeredRuleForCategory(categoryKey) {
    const key = String(categoryKey || '').trim();
    return rules.find((rule) => rule.ruleKind === 'in_app_chore' && rule.triggerKey === key) || null;
}

function categoryLabel(category) {
    return category.display_name || category.category_key || '';
}

function render() {
    renderRuleTabs();
    renderRules();
}

tabs.forEach((tab) => {
    tab.addEventListener('click', () => {
        setActiveRuleKind(tab.dataset.ruleKind);
    });
});

ruleList.addEventListener('click', (event) => {
    const button = event.target.closest('[data-rule-action]');
    if (!button) return;
    const row = button.closest('.point-rule-table-row');
    if (!row) return;
    const action = button.dataset.ruleAction;
    if (action === 'save') {
        saveRuleRow(row);
    }
});

function handleRuleFieldEdit(event) {
    const target = event.target;
    if (!(target instanceof HTMLInputElement) && !(target instanceof HTMLSelectElement)) return;
    if (!target.matches('[data-field]')) return;
    const row = target.closest('.point-rule-table-row');
    updateRowSaveState(row);
}

ruleList.addEventListener('input', handleRuleFieldEdit);
ruleList.addEventListener('change', handleRuleFieldEdit);

ruleList.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter') return;
    const target = event.target;
    if (!(target instanceof HTMLInputElement)) return;
    event.preventDefault();
    const row = target.closest('.point-rule-table-row');
    const button = row?.querySelector('[data-rule-action="save"]');
    if (row && !button?.disabled) {
        saveRuleRow(row);
    }
});

document.addEventListener('DOMContentLoaded', async () => {
    hydrateIcons(document);
    renderRuleTabs();
    try {
        await loadAll();
    } catch (error) {
        showError(error.message || 'Failed to load point rules.');
    }
});
