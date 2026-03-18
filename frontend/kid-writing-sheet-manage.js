const API_BASE = `${window.location.origin}/api`;

const params = new URLSearchParams(window.location.search);
const kidId = String(params.get('id') || '').trim();
const requestedCategoryKey = String(params.get('categoryKey') || '').trim().toLowerCase();

const WRITING_SHEET_MAX_ROWS = 12;

const pageTitleEl = document.getElementById('pageTitle');
const backBtn = document.getElementById('backBtn');
const errorMessage = document.getElementById('errorMessage');

const chineseSuggestedSection = document.getElementById('chineseSuggestedSection');
const chineseGenerateSection = document.getElementById('chineseGenerateSection');
const mathGenerateSection = document.getElementById('mathGenerateSection');
const mathDeckRowsEl = document.getElementById('mathDeckRows');
const mathSheetErrorMessage = document.getElementById('mathSheetErrorMessage');

const practicingDeckCount = document.getElementById('practicingDeckCount');
const practicingDeckGrid = document.getElementById('practicingDeckGrid');
const practicingDeckEmpty = document.getElementById('practicingDeckEmpty');
const sheetList = document.getElementById('sheetList');

const sheetCardCountInput = document.getElementById('sheetCardCount');
const sheetRowsPerCharInput = document.getElementById('sheetRowsPerChar');
const createSheetBtn = document.getElementById('createSheetBtn');
const sheetErrorMessage = document.getElementById('sheetErrorMessage');

const MAX_SHEET_CARD_COUNT = 200;
let activeCategoryKey = requestedCategoryKey;
let activeCategoryDisplayName = '';
let activeKidName = '';
let state2Cards = [];
let isCreateSheetInFlight = false;

/* 'chinese' or 'math' */
let pageMode = 'chinese';
let mathPrintConfigDecks = [];

/* ── Shared utilities ── */

function escapeHtml(text) {
    return String(text || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function parseIntegerInputValue(input) {
    if (!input) return null;
    const value = Number.parseInt(String(input.value || '').trim(), 10);
    return Number.isInteger(value) ? value : null;
}

function showError(message) {
    const text = String(message || '').trim();
    if (!errorMessage) return;
    if (!text) { errorMessage.textContent = ''; errorMessage.classList.add('hidden'); return; }
    errorMessage.textContent = text;
    errorMessage.classList.remove('hidden');
}

function showSheetError(message) {
    const text = String(message || '').trim();
    if (!sheetErrorMessage) return;
    if (!text) { sheetErrorMessage.textContent = ''; sheetErrorMessage.classList.add('hidden'); return; }
    sheetErrorMessage.textContent = text;
    sheetErrorMessage.classList.remove('hidden');
}

function showMathSheetError(message) {
    const text = String(message || '').trim();
    if (!mathSheetErrorMessage) return;
    if (!text) { mathSheetErrorMessage.textContent = ''; mathSheetErrorMessage.classList.add('hidden'); return; }
    mathSheetErrorMessage.textContent = text;
    mathSheetErrorMessage.classList.remove('hidden');
}

function formatDate(value) {
    if (!value) return '-';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '-';
    return date.toLocaleString();
}

function formatDuration(start, end) {
    if (!start || !end) return '-';
    const startMs = new Date(start).getTime();
    const endMs = new Date(end).getTime();
    if (Number.isNaN(startMs) || Number.isNaN(endMs) || endMs < startMs) return '-';
    const totalMinutes = Math.round((endMs - startMs) / 60000);
    const days = Math.floor(totalMinutes / (60 * 24));
    const hours = Math.floor((totalMinutes % (60 * 24)) / 60);
    const minutes = totalMinutes % 60;
    if (days > 0) return `${days}d ${hours}h ${minutes}m`;
    if (hours > 0) return `${hours}h ${minutes}m`;
    return `${minutes}m`;
}

function buildType2ApiUrl(path) {
    return window.DeckCategoryCommon.buildType2ApiUrl({
        kidId, path, categoryKey: activeCategoryKey, apiBase: API_BASE,
    });
}

function buildType4ApiUrl(path) {
    const qs = new URLSearchParams();
    qs.set('categoryKey', activeCategoryKey);
    return `${API_BASE}/kids/${encodeURIComponent(kidId)}/type4${path}?${qs.toString()}`;
}

/* ── Page mode detection ── */

function getMatchingCategoryKey(kid, behaviorType, extraCheck) {
    const normalizeCategoryKey = window.DeckCategoryCommon.normalizeCategoryKey;
    const optedInKeys = window.DeckCategoryCommon.getOptedInDeckCategoryKeys(kid);
    const categoryMetaMap = window.DeckCategoryCommon.getDeckCategoryMetaMap(kid);
    const matchingKeys = optedInKeys.filter((key) => {
        const meta = categoryMetaMap?.[key] || {};
        if (String(meta.behavior_type || '').trim().toLowerCase() !== behaviorType) return false;
        return extraCheck ? extraCheck(meta) : true;
    });
    if (matchingKeys.length <= 0) return '';
    const preferred = normalizeCategoryKey(requestedCategoryKey);
    if (preferred && matchingKeys.includes(preferred)) return preferred;
    return matchingKeys[0];
}

function updatePageText() {
    const modeLabel = pageMode === 'math' ? 'Math Practice' : 'Chinese Writing';
    const displayName = String(activeCategoryDisplayName || modeLabel).trim() || modeLabel;
    const kidName = String(activeKidName || '').trim();
    document.title = kidName
        ? `${kidName} - Printable work sheets (${displayName}) - Kids Daily Chores`
        : `Printable work sheets (${displayName}) - Kids Daily Chores`;
    if (pageTitleEl) {
        pageTitleEl.textContent = `Printable work sheets (${displayName})`;
    }
}

async function loadKidInfo() {
    const response = await fetch(`${API_BASE}/kids/${encodeURIComponent(kidId)}`);
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `Failed to load kid (HTTP ${response.status})`);
    const kid = payload;
    activeKidName = String(kid?.name || '').trim();
    const categoryMetaMap = window.DeckCategoryCommon.getDeckCategoryMetaMap(kid);

    /* Try math (type_iv) first if the requested category is type_iv */
    const requestedMeta = categoryMetaMap?.[requestedCategoryKey] || {};
    const requestedBehavior = String(requestedMeta.behavior_type || '').trim().toLowerCase();

    if (requestedBehavior === 'type_iv') {
        const resolved = getMatchingCategoryKey(kid, 'type_iv');
        if (!resolved) throw new Error('Math category is not opted in for this kid.');
        activeCategoryKey = resolved;
        pageMode = 'math';
    } else {
        const resolved = getMatchingCategoryKey(kid, 'type_ii', (m) => Boolean(m.has_chinese_specific_logic));
        if (!resolved) throw new Error('Chinese Writing is not opted in for this kid.');
        activeCategoryKey = resolved;
        pageMode = 'chinese';
    }

    activeCategoryDisplayName = window.DeckCategoryCommon.getCategoryDisplayName(activeCategoryKey, categoryMetaMap) || '';
    updatePageText();
    if (backBtn) backBtn.href = '/admin.html';
}

function applyPageMode() {
    if (pageMode === 'math') {
        if (chineseSuggestedSection) chineseSuggestedSection.classList.add('hidden');
        if (chineseGenerateSection) chineseGenerateSection.classList.add('hidden');
        if (mathGenerateSection) mathGenerateSection.classList.remove('hidden');
    } else {
        if (chineseSuggestedSection) chineseSuggestedSection.classList.remove('hidden');
        if (chineseGenerateSection) chineseGenerateSection.classList.remove('hidden');
        if (mathGenerateSection) mathGenerateSection.classList.add('hidden');
    }
}

/* ── Chinese writing mode (existing) ── */

function buildSheetConfigState() {
    const count = parseIntegerInputValue(sheetCardCountInput);
    const rowsPerCharacter = parseIntegerInputValue(sheetRowsPerCharInput);
    const candidateCount = Array.isArray(state2Cards) ? state2Cards.length : 0;
    const hasZeroInput = count === 0 || rowsPerCharacter === 0;
    const countInRange = Number.isInteger(count) && count >= 1 && count <= MAX_SHEET_CARD_COUNT;
    const rowsInRange = Number.isInteger(rowsPerCharacter) && rowsPerCharacter >= 1 && rowsPerCharacter <= WRITING_SHEET_MAX_ROWS;
    const usedRows = countInRange && rowsInRange ? count * rowsPerCharacter : null;
    const overflowsPage = Number.isInteger(usedRows) && usedRows > WRITING_SHEET_MAX_ROWS;
    const emptyRows = Number.isInteger(usedRows)
        ? Math.max(0, WRITING_SHEET_MAX_ROWS - Math.min(WRITING_SHEET_MAX_ROWS, usedRows))
        : null;
    const maxCardsForRows = rowsInRange ? Math.max(1, Math.floor(WRITING_SHEET_MAX_ROWS / rowsPerCharacter)) : 1;
    let blockReason = '';
    if (hasZeroInput) blockReason = 'zero';
    else if (!countInRange && !rowsInRange) blockReason = 'count_and_rows';
    else if (!countInRange) blockReason = 'count';
    else if (!rowsInRange) blockReason = 'rows';
    else if (overflowsPage) blockReason = 'overflow';
    else if (candidateCount <= 0) blockReason = 'empty_candidates';
    return { count, rowsPerCharacter, countInRange, rowsInRange, candidateCount, usedRows, emptyRows, overflowsPage, maxCardsForRows, blockReason, canSubmit: !isCreateSheetInFlight && !blockReason };
}

function getSheetConfigErrorMessage(config) {
    if (!config || !config.blockReason) return '';
    if (config.blockReason === 'zero') return 'No cards.';
    if (config.blockReason === 'count_and_rows') return `Cards per sheet must be 1-${MAX_SHEET_CARD_COUNT}, and rows per card must be 1-${WRITING_SHEET_MAX_ROWS}.`;
    if (config.blockReason === 'count') return `Cards per sheet must be between 1 and ${MAX_SHEET_CARD_COUNT}.`;
    if (config.blockReason === 'rows') return `Rows per card must be between 1 and ${WRITING_SHEET_MAX_ROWS}.`;
    if (config.blockReason === 'overflow') return `This setup does not fit in one page (${WRITING_SHEET_MAX_ROWS} rows max). With ${config.rowsPerCharacter} row(s) per card, max cards is ${config.maxCardsForRows}.`;
    if (config.blockReason === 'empty_candidates') return 'No eligible cards to print right now.';
    return 'Invalid sheet configuration.';
}

function getGenerateButtonText(config) {
    if (isCreateSheetInFlight) return 'Generating...';
    if (!config) return 'Generate';
    if (config.blockReason === 'zero') return 'Generate (no cards)';
    if (config.blockReason === 'count_and_rows') return `Generate (cards 1-${MAX_SHEET_CARD_COUNT}, rows 1-${WRITING_SHEET_MAX_ROWS})`;
    if (config.blockReason === 'count') return `Generate (cards 1-${MAX_SHEET_CARD_COUNT})`;
    if (config.blockReason === 'rows') return `Generate (rows 1-${WRITING_SHEET_MAX_ROWS})`;
    if (config.blockReason === 'overflow') {
        if (Number.isInteger(config.usedRows)) return `Generate (${config.usedRows}/${WRITING_SHEET_MAX_ROWS} rows can't fit in 1 page)`;
        return 'Generate (does not fit in 1 page)';
    }
    if (config.blockReason === 'empty_candidates') return 'Generate (no cards)';
    if (!Number.isInteger(config.emptyRows)) return 'Generate';
    return `Generate (${config.emptyRows}/${WRITING_SHEET_MAX_ROWS} rows are empty)`;
}

function updateGenerateSheetButtonState() {
    if (!createSheetBtn) return;
    const config = buildSheetConfigState();
    createSheetBtn.textContent = getGenerateButtonText(config);
    createSheetBtn.disabled = !config.canSubmit;
    const title = getSheetConfigErrorMessage(config);
    if (title) { createSheetBtn.title = title; return; }
    createSheetBtn.removeAttribute('title');
}

function applySuggestedType2SheetInputs() {
    if (!sheetCardCountInput || !sheetRowsPerCharInput) return;
    const candidateCount = Number(state2Cards.length || 0);
    if (candidateCount <= 0) {
        sheetCardCountInput.value = '1';
        sheetRowsPerCharInput.value = '1';
        updateGenerateSheetButtonState();
        return;
    }
    const suggestedCards = Math.max(1, Math.min(WRITING_SHEET_MAX_ROWS, candidateCount));
    const suggestedRows = Math.max(1, Math.floor(WRITING_SHEET_MAX_ROWS / suggestedCards));
    sheetCardCountInput.value = String(suggestedCards);
    sheetRowsPerCharInput.value = String(suggestedRows);
    updateGenerateSheetButtonState();
}

function renderSuggestedCards() {
    if (!practicingDeckGrid || !practicingDeckEmpty) return;
    const cards = [...state2Cards];
    if (practicingDeckCount) practicingDeckCount.textContent = `(${cards.length})`;
    if (cards.length === 0) {
        practicingDeckGrid.innerHTML = '';
        practicingDeckEmpty.textContent = 'No suggested candidate cards.';
        practicingDeckEmpty.classList.remove('hidden');
        return;
    }
    practicingDeckEmpty.classList.add('hidden');
    const neverSeenLabels = [], lastFailedLabels = [], otherLabels = [];
    cards.forEach((card) => {
        const label = String(card.back || card.front || '').trim();
        if (!label) return;
        const reason = String(card.practicing_reason || '').trim();
        if (reason === 'never_seen') { neverSeenLabels.push(label); return; }
        if (reason === 'last_failed') { lastFailedLabels.push(label); return; }
        otherLabels.push(label);
    });
    const renderBucketRow = (title, labels) => {
        const safeLabels = (labels || []).map((item) => String(item || '').trim()).filter(Boolean);
        const pillsHtml = safeLabels.length > 0
            ? safeLabels.map((l) => `<span class="suggested-card-pill">${escapeHtml(l)}</span>`).join('')
            : '<span class="suggested-card-empty">No cards.</span>';
        return `<div class="suggested-card-row"><span class="suggested-card-row-label">${escapeHtml(title)}:</span><div class="suggested-card-pill-list">${pillsHtml}</div></div>`;
    };
    const rows = [
        renderBucketRow(`Newly added (${neverSeenLabels.length})`, neverSeenLabels),
        renderBucketRow(`Last failed (${lastFailedLabels.length})`, lastFailedLabels),
    ];
    if (otherLabels.length > 0) rows.push(renderBucketRow(`Other (${otherLabels.length})`, otherLabels));
    practicingDeckGrid.innerHTML = rows.join('');
}

async function loadSuggestedCards() {
    showError('');
    const response = await fetch(buildType2ApiUrl('/cards'));
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `Failed to load Chinese Writing cards (HTTP ${response.status})`);
    if (!Boolean(data.has_chinese_specific_logic)) throw new Error('This category does not support printable Chinese writing sheets.');
    state2Cards = Array.isArray(data.practicing_cards) ? data.practicing_cards : [];
    renderSuggestedCards();
    applySuggestedType2SheetInputs();
    updateGenerateSheetButtonState();
}

async function createType2ChineseSheet() {
    try {
        showSheetError('');
        const config = buildSheetConfigState();
        if (!config.canSubmit) { showSheetError(getSheetConfigErrorMessage(config)); return; }
        isCreateSheetInFlight = true;
        updateGenerateSheetButtonState();
        const response = await fetch(buildType2ApiUrl('/sheets'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ count: config.count, rows_per_character: config.rowsPerCharacter, categoryKey: activeCategoryKey }),
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(result.error || `HTTP ${response.status}`);
        if (!result.created || !Array.isArray(result.cards) || result.cards.length === 0) {
            showSheetError(result.message || 'No eligible cards to print right now.');
            return;
        }
        await Promise.all([loadChineseSheets(), loadSuggestedCards()]);
    } catch (error) {
        console.error('Error generating Chinese writing sheet:', error);
        showSheetError(error.message || 'Failed to generate practice sheet.');
    } finally {
        isCreateSheetInFlight = false;
        updateGenerateSheetButtonState();
    }
}

/* ── Chinese sheets list ── */

async function loadChineseSheets() {
    if (!sheetList) return;
    const response = await fetch(buildType2ApiUrl('/sheets'));
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `Failed to load sheets (HTTP ${response.status})`);
    renderChineseSheets(Array.isArray(data.sheets) ? data.sheets : []);
}

function renderChineseSheets(sheets) {
    if (!sheetList) return;
    if (!Array.isArray(sheets) || sheets.length === 0) {
        sheetList.innerHTML = '<article class="sheet-item"><p>No sheets yet.</p></article>';
        return;
    }
    sheetList.innerHTML = sheets.map((sheet) => {
        const sheetId = Number.parseInt(sheet && sheet.id, 10);
        const safeSheetId = Number.isInteger(sheetId) && sheetId > 0 ? sheetId : 0;
        const cards = Array.isArray(sheet && sheet.cards) ? sheet.cards : [];
        const answerLabels = cards.map((card) => String(card && (card.back || card.front) || '').trim()).filter(Boolean);
        const answersHtml = answerLabels.length > 0
            ? answerLabels.map((label) => `<span class="sheet-card-pill">${escapeHtml(label)}</span>`).join('')
            : '<span class="sheet-card-empty">(no cards)</span>';
        const isDone = String(sheet && sheet.status || '').trim().toLowerCase() === 'done';
        const isPending = !isDone;
        const statusClass = isDone ? 'done' : 'pending';
        const statusLabel = isDone ? 'done' : 'practicing';
        const printedDay = formatDate(sheet && sheet.created_at);
        const finishedDay = isDone ? formatDate(sheet && sheet.completed_at) : '-';
        const finishedIn = isDone ? formatDuration(sheet && sheet.created_at, sheet && sheet.completed_at) : '-';
        const deleteBtnHtml = isPending ? `<button type="button" class="delete-btn" data-sheet-action="delete" data-sheet-id="${safeSheetId}">Delete</button>` : '';
        return `
            <article class="sheet-item">
                <div class="sheet-head"><div>Sheet #${safeSheetId}</div><div class="sheet-head-right"><span class="status ${statusClass}">${statusLabel}</span></div></div>
                <div class="sheet-meta">Printed: ${escapeHtml(printedDay)}<br>Finished: ${escapeHtml(finishedDay)}<br>Time to finish: ${escapeHtml(finishedIn)}</div>
                <div class="sheet-cards">${answersHtml}</div>
                <div class="sheet-actions ${isPending ? 'pending' : 'done'}">
                    <button type="button" class="print-btn" data-sheet-action="print" data-sheet-id="${safeSheetId}">Print</button>
                    ${isPending ? `<button type="button" class="done-btn" data-sheet-action="done" data-sheet-id="${safeSheetId}">Mark Done</button>` : ''}
                    ${deleteBtnHtml}
                </div>
            </article>`;
    }).join('');
}

/* ── Math mode ── */

async function loadMathPrintConfig() {
    const response = await fetch(buildType4ApiUrl('/print-config'));
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `Failed to load print config (HTTP ${response.status})`);
    mathPrintConfigDecks = Array.isArray(data.decks) ? data.decks.filter((d) => d.opted_in) : [];
    renderMathDeckRows();
}

function renderMathDeckRows() {
    if (!mathDeckRowsEl) return;
    if (mathPrintConfigDecks.length === 0) {
        mathDeckRowsEl.innerHTML = '<p style="color:#47628f;font-size:0.94rem;">No opted-in decks with generator definitions found.</p>';
        return;
    }
    mathDeckRowsEl.innerHTML = mathPrintConfigDecks.map((deck, idx) => {
        const deckId = deck.shared_deck_id;
        const name = escapeHtml(deck.display_name || deck.name);
        const hCap = deck.horizontal_capacity || 0;
        const vCap = deck.vertical_capacity || 0;
        const vertDisabled = !vCap;
        const horizDisabled = !hCap;
        return `
            <div class="math-deck-row" data-deck-id="${deckId}">
                <span class="math-deck-row-name">${name}</span>
                <div class="math-deck-row-buttons">
                    <input type="number" id="mathCountV_${idx}" data-deck-idx="${idx}" min="1" max="${vCap || 200}" step="1" value="${vCap || ''}" ${vertDisabled ? 'disabled' : ''}>
                    <button type="button" class="settings-save-btn" data-math-generate="vertical" data-deck-idx="${idx}" ${vertDisabled ? 'disabled title="Preview vertical in deck view first"' : ''}>Vertical</button>
                    <input type="number" id="mathCountH_${idx}" data-deck-idx="${idx}" min="1" max="${hCap || 200}" step="1" value="${hCap || ''}" ${horizDisabled ? 'disabled' : ''}>
                    <button type="button" class="settings-save-btn" data-math-generate="horizontal" data-deck-idx="${idx}" ${horizDisabled ? 'disabled title="Preview horizontal in deck view first"' : ''}>Horizontal</button>
                </div>
            </div>`;
    }).join('');
}

async function createMathSheet(deckIdx, layout) {
    const deck = mathPrintConfigDecks[deckIdx];
    if (!deck) return;
    const suffix = layout === 'vertical' ? 'V' : 'H';
    const inputEl = document.getElementById(`mathCount${suffix}_${deckIdx}`);
    const count = parseIntegerInputValue(inputEl) || 0;
    if (count < 1 || count > 200) {
        showMathSheetError('Questions must be between 1 and 200.');
        return;
    }
    try {
        showMathSheetError('');
        const response = await fetch(buildType4ApiUrl('/math-sheets'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                shared_deck_id: deck.shared_deck_id,
                layout,
                problem_count: count,
                categoryKey: activeCategoryKey,
            }),
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(result.error || `HTTP ${response.status}`);
        if (!result.created) {
            showMathSheetError('Failed to create sheet.');
            return;
        }
        await loadMathSheets();
    } catch (error) {
        console.error('Error creating math sheet:', error);
        showMathSheetError(error.message || 'Failed to generate math practice sheet.');
    }
}

async function loadMathSheets() {
    if (!sheetList) return;
    const response = await fetch(buildType4ApiUrl('/math-sheets'));
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `Failed to load math sheets (HTTP ${response.status})`);
    renderMathSheets(Array.isArray(data.sheets) ? data.sheets : []);
}

function renderMathSheets(sheets) {
    if (!sheetList) return;
    if (!Array.isArray(sheets) || sheets.length === 0) {
        sheetList.innerHTML = '<article class="sheet-item"><p>No sheets yet.</p></article>';
        return;
    }
    sheetList.innerHTML = sheets.map((sheet) => {
        const sheetId = sheet.id;
        const status = String(sheet.status || '').trim().toLowerCase();
        const isPreview = status === 'preview';
        const isPending = status === 'pending';
        const isDone = status === 'done';
        const statusClass = isDone ? 'done' : (isPreview ? 'preview' : 'pending');
        const statusLabel = isDone ? 'done' : (isPreview ? 'preview' : 'practicing');
        const printedDay = formatDate(sheet.created_at);
        const finishedDay = isDone ? formatDate(sheet.completed_at) : '-';
        const finishedIn = isDone ? formatDuration(sheet.created_at, sheet.completed_at) : '-';
        const layoutLabel = sheet.layout === 'vertical' ? 'Vertical' : 'Horizontal';
        const countLabel = sheet.problem_count ? ` (${sheet.problem_count})` : '';
        const printBtnHtml = `<button type="button" class="print-btn" data-sheet-action="print" data-sheet-id="${sheetId}" data-deck-id="${sheet.shared_deck_id}" data-layout="${escapeHtml(sheet.layout)}" data-seed="${sheet.seed_base}" data-count="${sheet.problem_count}" data-answer-rows="${sheet.vertical_answer_rows || ''}" data-status="${escapeHtml(status)}">Preview${countLabel}</button>`;
        let actionBtns = '';
        if (isPreview) {
            actionBtns = `
                ${printBtnHtml}
                <button type="button" class="delete-btn" data-sheet-action="delete" data-sheet-id="${sheetId}">Delete</button>`;
        } else if (isPending) {
            actionBtns = `
                <button type="button" class="print-btn" data-sheet-action="print" data-sheet-id="${sheetId}" data-deck-id="${sheet.shared_deck_id}" data-layout="${escapeHtml(sheet.layout)}" data-seed="${sheet.seed_base}" data-count="${sheet.problem_count}" data-answer-rows="${sheet.vertical_answer_rows || ''}" data-status="${escapeHtml(status)}">Print${countLabel}</button>
                <button type="button" class="done-btn" data-sheet-action="done" data-sheet-id="${sheetId}">Mark Done</button>
                <button type="button" class="delete-btn" data-sheet-action="delete" data-sheet-id="${sheetId}">Delete</button>`;
        }
        return `
            <article class="sheet-item">
                <div class="sheet-head"><div>Sheet #${sheetId}</div><div class="sheet-head-right"><span class="status ${statusClass}">${statusLabel}</span></div></div>
                <div class="sheet-meta">
                    ${escapeHtml(sheet.display_name || sheet.deck_name || '')} · ${escapeHtml(layoutLabel)} · ${sheet.problem_count ? sheet.problem_count + ' problems' : 'Auto'}<br>
                    Printed: ${escapeHtml(printedDay)}<br>
                    Finished: ${escapeHtml(finishedDay)}<br>
                    Time to finish: ${escapeHtml(finishedIn)}${isDone && sheet.incorrect_count != null && sheet.problem_count ? `<br>Incorrect: ${sheet.incorrect_count} / ${sheet.problem_count} · Correct rate: ${Math.round((sheet.problem_count - sheet.incorrect_count) / sheet.problem_count * 100)}%` : ''}
                </div>
                <div class="sheet-actions ${statusClass}">
                    ${actionBtns}
                </div>
            </article>`;
    }).join('');
}

/* ── Sheet actions (shared) ── */

function goToChineseSheetPrint(sheetId) {
    const qs = new URLSearchParams();
    qs.set('id', String(kidId || ''));
    qs.set('sheet', String(sheetId || ''));
    qs.set('from', 'worksheets');
    if (activeCategoryKey) qs.set('categoryKey', activeCategoryKey);
    window.location.href = `/writing-sheet-print.html?${qs.toString()}`;
}

function goToMathSheetPrint(button) {
    const qs = new URLSearchParams();
    qs.set('deckId', button.getAttribute('data-deck-id') || '');
    qs.set('mode', button.getAttribute('data-layout') || 'horizontal');
    qs.set('seedBase', button.getAttribute('data-seed') || '');
    const count = button.getAttribute('data-count') || '0';
    if (count !== '0') qs.set('count', count);
    qs.set('from', 'worksheets');
    const answerRows = button.getAttribute('data-answer-rows');
    if (answerRows) qs.set('answerRows', answerRows);
    const sheetId = button.getAttribute('data-sheet-id') || '';
    if (sheetId) qs.set('sheetId', sheetId);
    const sheetStatus = button.getAttribute('data-status') || '';
    if (sheetStatus) qs.set('status', sheetStatus);
    if (kidId) qs.set('kidId', kidId);
    if (activeKidName) qs.set('kidName', activeKidName);
    if (activeCategoryKey) qs.set('categoryKey', activeCategoryKey);
    window.location.href = `/math-sheet-print.html?${qs.toString()}`;
}

async function markSheetDone(sheetId, extraBody) {
    const url = pageMode === 'math'
        ? buildType4ApiUrl(`/math-sheets/${sheetId}/complete`)
        : buildType2ApiUrl(`/sheets/${sheetId}/complete`);
    const body = Object.assign({}, extraBody || {});
    const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `Failed to mark sheet done (HTTP ${response.status})`);
}

async function deleteSheet(sheetId) {
    const url = pageMode === 'math'
        ? buildType4ApiUrl(`/math-sheets/${sheetId}/withdraw`)
        : buildType2ApiUrl(`/sheets/${sheetId}/withdraw`);
    const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `Failed to delete sheet (HTTP ${response.status})`);
}

async function regenerateMathSheet(sheetId) {
    const response = await fetch(buildType4ApiUrl(`/math-sheets/${sheetId}/regenerate`), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `Failed to regenerate sheet (HTTP ${response.status})`);
}

async function finalizeMathSheet(sheetId) {
    const response = await fetch(buildType4ApiUrl(`/math-sheets/${sheetId}/finalize`), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `Failed to finalize sheet (HTTP ${response.status})`);
}

async function reloadSheets() {
    if (pageMode === 'math') {
        await loadMathSheets();
    } else {
        await Promise.all([loadChineseSheets(), loadSuggestedCards()]);
    }
}

/* ── Refresh sheets when returning via back button (bfcache) ── */

window.addEventListener('pageshow', (event) => {
    if (event.persisted) reloadSheets().catch(() => {});
});

/* ── Init ── */

document.addEventListener('DOMContentLoaded', async () => {
    if (!kidId) { window.location.href = '/admin.html'; return; }

    /* Chinese mode listeners */
    if (createSheetBtn) createSheetBtn.addEventListener('click', () => createType2ChineseSheet());
    if (sheetCardCountInput) sheetCardCountInput.addEventListener('input', () => { showSheetError(''); updateGenerateSheetButtonState(); });
    if (sheetRowsPerCharInput) sheetRowsPerCharInput.addEventListener('input', () => { showSheetError(''); updateGenerateSheetButtonState(); });

    /* Math mode generate button delegation */
    if (mathDeckRowsEl) {
        mathDeckRowsEl.addEventListener('click', async (event) => {
            const btn = event.target.closest('button[data-math-generate]');
            if (!btn || btn.disabled) return;
            const layout = btn.getAttribute('data-math-generate');
            const idx = Number.parseInt(btn.getAttribute('data-deck-idx'), 10);
            if (!Number.isInteger(idx)) return;
            btn.disabled = true;
            btn.textContent = 'Generating...';
            try {
                await createMathSheet(idx, layout);
            } finally {
                btn.disabled = layout === 'vertical' ? !mathPrintConfigDecks[idx]?.vertical_capacity : !mathPrintConfigDecks[idx]?.horizontal_capacity;
                btn.textContent = layout === 'vertical' ? 'Vertical' : 'Horizontal';
            }
        });
    }

    /* Sheet list action delegation (shared) */
    if (sheetList) {
        sheetList.addEventListener('click', async (event) => {
            const button = event.target.closest('button[data-sheet-action]');
            if (!button) return;
            const action = String(button.getAttribute('data-sheet-action') || '').trim().toLowerCase();
            const sheetId = Number.parseInt(button.getAttribute('data-sheet-id') || '', 10);
            if (!Number.isInteger(sheetId) || sheetId <= 0) return;
            try {
                showError('');
                if (action === 'print') {
                    if (pageMode === 'math') goToMathSheetPrint(button);
                    else goToChineseSheetPrint(sheetId);
                    return;
                }
                if (action === 'done') {
                    let extraBody = {};
                    if (pageMode === 'math') {
                        const article = button.closest('.sheet-item');
                        const printBtn = article && article.querySelector('[data-count]');
                        const problemCount = printBtn ? parseInt(printBtn.getAttribute('data-count'), 10) || 0 : 0;
                        let msg = `Number of incorrect answers (0–${problemCount}, leave empty to skip):`;
                        while (true) {
                            const input = prompt(msg);
                            if (input === null) return; /* cancelled */
                            const trimmed = input.trim();
                            if (trimmed === '') break;
                            const val = parseInt(trimmed, 10);
                            if (Number.isInteger(val) && val >= 0 && val <= problemCount) {
                                extraBody.incorrect_count = val;
                                break;
                            }
                            msg = `Invalid! Please enter a number between 0 and ${problemCount}:`;
                        }
                    }
                    await markSheetDone(sheetId, extraBody);
                } else if (action === 'delete') await deleteSheet(sheetId);
                else if (action === 'regenerate') await regenerateMathSheet(sheetId);
                else if (action === 'finalize') await finalizeMathSheet(sheetId);
                else return;
                await reloadSheets();
            } catch (error) {
                console.error('Error updating sheet:', error);
                showError(error.message || 'Failed to update sheet.');
            }
        });
    }

    try {
        await loadKidInfo();
        applyPageMode();
        if (pageMode === 'math') {
            await Promise.all([loadMathPrintConfig(), loadMathSheets()]);
        } else {
            await Promise.all([loadSuggestedCards(), loadChineseSheets()]);
            updateGenerateSheetButtonState();
        }
    } catch (error) {
        console.error('Error loading worksheet manage page:', error);
        showError(error.message || 'Failed to load printable worksheets page.');
        if (pageMode === 'chinese') updateGenerateSheetButtonState();
    }
});
