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
const sheetHistorySection = document.getElementById('sheetHistorySection');
const sheetHistoryTitle = document.getElementById('sheetHistoryTitle');
const sheetHistoryNote = document.getElementById('sheetHistoryNote');
const mathDeckRowsEl = document.getElementById('mathDeckRows');
const mathBuildInfoEl = document.getElementById('mathBuildInfo');
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
let canDesignMathCells = false;

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
        if (sheetHistorySection) sheetHistorySection.classList.remove('hidden');
        if (sheetHistoryTitle) sheetHistoryTitle.textContent = 'Sheets';
        if (sheetHistoryNote) sheetHistoryNote.textContent = 'Preview, print, mark done, or delete saved math sheets here.';
    } else {
        if (chineseSuggestedSection) chineseSuggestedSection.classList.remove('hidden');
        if (chineseGenerateSection) chineseGenerateSection.classList.remove('hidden');
        if (mathGenerateSection) mathGenerateSection.classList.add('hidden');
        if (sheetHistorySection) sheetHistorySection.classList.remove('hidden');
        if (sheetHistoryTitle) sheetHistoryTitle.textContent = 'Practice Sheets';
        if (sheetHistoryNote) sheetHistoryNote.textContent = 'Print, mark done, or delete pending sheets here.';
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
    canDesignMathCells = Boolean(data.can_design_cell);
    mathPrintConfigDecks = Array.isArray(data.decks) ? data.decks.filter((d) => d.opted_in) : [];
    cellDesigns.clear();
    mathPrintConfigDecks.forEach((deck) => {
        const raw = deck && deck.cell_design;
        if (!raw || typeof raw !== 'object') return;
        const cellWidth = Number.parseInt(raw.cell_width, 10);
        const cellHeight = Number.parseInt(raw.cell_height, 10);
        if (!Number.isFinite(cellWidth) || !Number.isFinite(cellHeight) || cellWidth <= 0 || cellHeight <= 0) return;
        const sampleProblem = raw.sample_problem && typeof raw.sample_problem === 'object'
            ? {
                prompt: String(raw.sample_problem.prompt || ''),
                answer: String(raw.sample_problem.answer || ''),
            }
            : null;
        cellDesigns.set(deck.shared_deck_id, {
            deckId: deck.shared_deck_id,
            deckName: deck.display_name || deck.name,
            cellWidth,
            cellHeight,
            contentOffsetX: Number.parseInt(raw.content_offset_x, 10) || 0,
            contentOffsetY: Number.parseInt(raw.content_offset_y, 10) || 0,
            canvasVersion: Number.parseInt(raw.canvas_version, 10) || CELL_DESIGN_CANVAS_VERSION,
            sampleProblem,
        });
    });
    renderMathBuildInfo();
    updateBuildSheetButton();
}

function renderMathBuildInfo() {
    if (!mathBuildInfoEl) return;
    const totalDecks = mathPrintConfigDecks.length;
    const designedDecks = getDesignedMathDecks().length;
    if (totalDecks <= 0) {
        mathBuildInfoEl.textContent = 'No opted-in generator decks found for this category.';
        return;
    }
    if (designedDecks <= 0) {
        mathBuildInfoEl.textContent = 'No deck has a saved cell design yet. Open the deck in the View Deck page first and use Design Cell there.';
        return;
    }
    mathBuildInfoEl.textContent = `${designedDecks} of ${totalDecks} opted-in deck${totalDecks === 1 ? '' : 's'} already have saved cell designs.`;
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
        const sheetId = Number.parseInt(sheet && sheet.id, 10);
        const safeSheetId = Number.isInteger(sheetId) && sheetId > 0 ? sheetId : 0;
        const status = String(sheet && sheet.status || '').trim().toLowerCase();
        const isPreview = status === 'preview';
        const isPending = status === 'pending';
        const isDone = status === 'done';
        const statusClass = isDone ? 'done' : (isPreview ? 'preview' : 'pending');
        const statusLabel = isDone ? 'done' : (isPreview ? 'preview' : 'practicing');
        const layoutRows = Array.isArray(sheet && sheet.layout_rows) ? sheet.layout_rows : [];
        const cardTotals = new Map();
        layoutRows.forEach((row) => {
            const name = String(row && row.deck_name || 'Deck');
            const count = Number.parseInt(row && row.col_count, 10) || 0;
            cardTotals.set(name, (cardTotals.get(name) || 0) + count);
        });
        const rowPillsHtml = cardTotals.size > 0
            ? Array.from(cardTotals.entries()).map(([name, total]) =>
                `<span class="sheet-card-pill">${escapeHtml(name)}${total > 0 ? ` · ${total}` : ''}</span>`
            ).join('')
            : '<span class="sheet-card-empty">(no rows)</span>';
        const problemCount = Number.parseInt(sheet && sheet.problem_count, 10) || 0;
        const incorrectCount = Number.isInteger(sheet && sheet.incorrect_count)
            ? Number(sheet.incorrect_count)
            : null;
        const printedDay = formatDate(sheet && sheet.created_at);
        const finishedDay = isDone ? formatDate(sheet && sheet.completed_at) : '-';
        const finishedIn = isDone ? formatDuration(sheet && sheet.created_at, sheet && sheet.completed_at) : '-';
        let actionBtns = '';
        if (isPreview) {
            actionBtns = `
                <button type="button" class="print-btn" data-sheet-action="print" data-sheet-id="${safeSheetId}">Preview</button>
                <button type="button" class="delete-btn" data-sheet-action="delete" data-sheet-id="${safeSheetId}">Delete</button>`;
        } else if (isPending) {
            actionBtns = `
                <button type="button" class="print-btn" data-sheet-action="print" data-sheet-id="${safeSheetId}">Print</button>
                <button type="button" class="done-btn" data-sheet-action="done" data-sheet-id="${safeSheetId}">Mark Done</button>
                <button type="button" class="delete-btn" data-sheet-action="delete" data-sheet-id="${safeSheetId}">Delete</button>`;
        }
        const accuracyLine = (
            isDone
            && incorrectCount != null
            && problemCount > 0
        )
            ? `<br>Incorrect: ${incorrectCount} / ${problemCount} · Correct rate: ${Math.round(((problemCount - incorrectCount) / problemCount) * 100)}%`
            : '';
        return `
            <article class="sheet-item">
                <div class="sheet-head"><div>Sheet #${safeSheetId}</div><div class="sheet-head-right"><span class="status ${statusClass}">${statusLabel}</span></div></div>
                <div class="sheet-meta">Rows: ${layoutRows.length} · Problems: ${problemCount}<br>Printed: ${escapeHtml(printedDay)}<br>Finished: ${escapeHtml(finishedDay)}<br>Time to finish: ${escapeHtml(finishedIn)}${accuracyLine}</div>
                <div class="sheet-cards">${rowPillsHtml}</div>
                ${actionBtns ? `<div class="sheet-actions ${statusClass}">${actionBtns}</div>` : ''}
            </article>`;
    }).join('');
}

/* ── Sheet actions (shared) ── */

function goToMathSheetPreview(sheetId) {
    const qs = new URLSearchParams();
    qs.set('id', String(kidId || ''));
    qs.set('sheet', String(sheetId || ''));
    qs.set('from', 'worksheets');
    if (activeCategoryKey) qs.set('categoryKey', activeCategoryKey);
    window.location.href = `/math-sheet-print.html?${qs.toString()}`;
}

function goToChineseSheetPrint(sheetId) {
    const qs = new URLSearchParams();
    qs.set('id', String(kidId || ''));
    qs.set('sheet', String(sheetId || ''));
    qs.set('from', 'worksheets');
    if (activeCategoryKey) qs.set('categoryKey', activeCategoryKey);
    window.location.href = `/writing-sheet-print.html?${qs.toString()}`;
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

async function reloadSheets() {
    if (pageMode === 'math') {
        await Promise.all([loadMathPrintConfig(), loadMathSheets()]);
    } else {
        await Promise.all([loadChineseSheets(), loadSuggestedCards()]);
    }
}

/* ── Refresh sheets when returning via back button (bfcache) ── */

window.addEventListener('pageshow', (event) => {
    if (event.persisted) reloadSheets().catch(() => {});
});

/* ── Cell design + Sheet builder state ── */

const cellDesigns = new Map(); /* Map<deckId, CellDefinition> */
let sheetRows = [];
let currentSheetScale = 0.5;
let sheetBuilderPickerRowIndex = null;
let _cellDesignDeckId = 0;
let _cellDesignDeckName = '';
let _cellDesignSample = null;

const A4_W = 794;
const A4_H = 1123;
const A4_MARGIN = 19;
const A4_GRID_W = A4_W - 2 * A4_MARGIN;
const A4_GRID_H = A4_H - 2 * A4_MARGIN;
const A4_EXTRA_SAFE_MARGIN = 34;
const A4_SAFE_BOX_W = A4_GRID_W - (2 * A4_EXTRA_SAFE_MARGIN);
const A4_SAFE_BOX_H = A4_GRID_H - (2 * A4_EXTRA_SAFE_MARGIN);
const A4_HEADER_H = 24;
const BUILDER_GRID_H = A4_SAFE_BOX_H - A4_HEADER_H;
const PRINT_FIT_SAFETY_PX = 12;
const BUILDER_SAFE_GRID_H = BUILDER_GRID_H - PRINT_FIT_SAFETY_PX;
const MIN_CELL_DESIGN_W = 90;
const MIN_CELL_DESIGN_H = 72;
const DEFAULT_CELL_CONTENT_X = 0;
const DEFAULT_CELL_CONTENT_Y = 0;
const CELL_DESIGN_SIZE_STEP = 8;
const CELL_DESIGN_CANVAS_VERSION = 2;
const CELL_DESIGN_MIN_LEFT_PAD = 3;
const CELL_DESIGN_MIN_TOP_PAD = 3;
const CELL_DESIGN_MIN_RIGHT_PAD = 6;
const CELL_DESIGN_MIN_BOTTOM_PAD = 6;
const MIN_ROW_SCALE = 0.5;
const MAX_ROW_SCALE = 1.7;
const ROW_SCALE_STEP = 0.1;

const buildSheetBtn = document.getElementById('buildSheetBtn');

/* ── Vertical cell rendering ── */

const OPERATOR_PATTERN = /^(.+?)\s*([+\-×x*÷\/])\s*(.+?)(?:\s*=\s*[?？_\s]*)?\s*$/;

function parseArithmetic(prompt) {
    const m = prompt.match(OPERATOR_PATTERN);
    if (!m) return null;
    const a = m[1].trim();
    const rawOp = m[2];
    const b = m[3].trim();
    if (!a || !b) return null;
    let sign = rawOp;
    if (rawOp === '*' || rawOp === 'x') sign = '×';
    if (rawOp === '/' || rawOp === '÷') sign = '÷';
    return { a, sign, b };
}

function buildVerticalRows(a, b, sign) {
    const topDigits = String(a || '');
    const bottomDigits = String(b || '');
    let gapCh = 1;
    if (sign === '×') {
        gapCh = Math.max(1, topDigits.length);
    } else if (sign === '+' || sign === '-') {
        gapCh = Math.max(1, topDigits.length - bottomDigits.length + 1);
    }
    const rowWidthCh = 1 + gapCh + bottomDigits.length;
    return {
        topDigits,
        bottomDigits,
        sign,
        gapCh,
        rowWidthCh,
    };
}

function renderVerticalPromptCell(p) {
    if (!p) return '<div class="math-cell-v-fallback"></div>';
    const parsed = parseArithmetic(p.prompt);
    if (!parsed) {
        return `<div class="math-cell-v-fallback">
            <div>${escapeHtml(p.prompt)}</div>
            <div class="cell-answer">${escapeHtml(p.answer)}</div>
        </div>`;
    }
    const { a, sign, b } = parsed;
    if (sign === '÷') {
        return `<div class="math-cell-div">
            <div class="div-main-row">
                <span class="div-divisor">${escapeHtml(b)}</span>
                <span class="div-dividend"><svg class="div-bracket-svg" viewBox="0 0 10 28" aria-hidden="true"><path d="M 1 27 Q 7 26, 7 21 L 7 0" stroke="currentColor" stroke-width="1.5" fill="none"/></svg>${escapeHtml(a)}</span>
            </div>
        </div>`;
    }
    const rows = buildVerticalRows(a, b, sign);
    return `<div class="math-cell-v" style="--v-row-width-ch:${rows.rowWidthCh};--v-gap-ch:${rows.gapCh};">
        <div class="v-row v-row-top">${escapeHtml(rows.topDigits)}</div>
        <div class="v-row v-row-op">
            <span class="v-op">${escapeHtml(rows.sign)}</span>
            <span class="v-gap" aria-hidden="true"></span>
            <span class="v-row-bottom-num">${escapeHtml(rows.bottomDigits)}</span>
        </div>
        <div class="v-line" aria-hidden="true"></div>
    </div>`;
}

function measureRenderedCell(html) {
    const probe = document.createElement('div');
    probe.style.cssText = 'position:absolute;left:-9999px;top:-9999px;visibility:hidden;pointer-events:none;';
    probe.innerHTML = html;
    document.body.appendChild(probe);
    const cell = probe.firstElementChild;
    const width = cell ? Math.ceil(cell.offsetWidth) : MIN_CELL_DESIGN_W;
    const height = cell ? Math.ceil(cell.offsetHeight) : MIN_CELL_DESIGN_H;
    document.body.removeChild(probe);
    return { width, height };
}

function getCellDesignOffsets(cellDef) {
    if (!cellDef || Number(cellDef.canvasVersion || 0) < CELL_DESIGN_CANVAS_VERSION) {
        return { x: DEFAULT_CELL_CONTENT_X, y: DEFAULT_CELL_CONTENT_Y };
    }
    return {
        x: Math.max(0, Number(cellDef.contentOffsetX) || 0),
        y: Math.max(0, Number(cellDef.contentOffsetY) || 0),
    };
}

/* ── Cell Designer ── */

function updateBuildSheetButton() {
    if (!buildSheetBtn) return;
    buildSheetBtn.disabled = cellDesigns.size === 0;
}

function updateCellDesignDimensions() {
    const box = document.getElementById('cellDesignBox');
    const display = document.getElementById('cellDesignDimensions');
    if (!box || !display) return;
    display.textContent = `${Math.round(box.offsetWidth)} × ${Math.round(box.offsetHeight)} px`;
    updateCellDesignResizeButtons();
}

function rerenderCellDesignContent() {
    const contentEl = document.getElementById('cellDesignContent');
    if (!contentEl || !_cellDesignSample) return;
    contentEl.innerHTML = renderVerticalPromptCell(_cellDesignSample);
}

function getCellDesignMinSize() {
    const contentEl = document.getElementById('cellDesignContent');
    if (!contentEl) return { width: MIN_CELL_DESIGN_W, height: MIN_CELL_DESIGN_H };
    const offsetX = Math.max(CELL_DESIGN_MIN_LEFT_PAD, parseFloat(contentEl.style.left || '0'));
    const offsetY = Math.max(CELL_DESIGN_MIN_TOP_PAD, parseFloat(contentEl.style.top || '0'));
    return {
        width: Math.ceil(contentEl.offsetWidth + offsetX + CELL_DESIGN_MIN_RIGHT_PAD),
        height: Math.ceil(contentEl.offsetHeight + offsetY + CELL_DESIGN_MIN_BOTTOM_PAD),
    };
}

function updateCellDesignResizeButtons() {
    const workAreaEl = document.getElementById('cellDesignWorkArea');
    const boxEl = document.getElementById('cellDesignBox');
    const contentEl = document.getElementById('cellDesignContent');
    if (!workAreaEl || !boxEl || !contentEl) return;
    const boxLeft = parseFloat(boxEl.style.left || '0');
    const boxTop = parseFloat(boxEl.style.top || '0');
    const canGrowN = boxTop > 0;
    const canGrowS = (boxTop + boxEl.offsetHeight) < workAreaEl.clientHeight;
    const canGrowW = boxLeft > 0;
    const canGrowE = (boxLeft + boxEl.offsetWidth) < workAreaEl.clientWidth;
    const contentLeft = Math.max(0, parseFloat(contentEl.style.left || '0'));
    const contentTop = Math.max(0, parseFloat(contentEl.style.top || '0'));
    const contentWidth = Math.ceil(contentEl.offsetWidth);
    const contentHeight = Math.ceil(contentEl.offsetHeight);
    const extraRight = Math.max(0, boxEl.offsetWidth - (contentWidth + contentLeft));
    const extraBottom = Math.max(0, boxEl.offsetHeight - (contentHeight + contentTop));
    const setDisabled = (action, disabled) => {
        const btn = document.querySelector(`[data-cell-resize="${action}"]`);
        if (btn) btn.disabled = Boolean(disabled);
    };
    setDisabled('grow-n', !canGrowN);
    setDisabled('grow-s', !canGrowS);
    setDisabled('grow-w', !canGrowW);
    setDisabled('grow-e', !canGrowE);
    setDisabled('shrink-n', contentTop <= CELL_DESIGN_MIN_TOP_PAD);
    setDisabled('shrink-s', extraBottom <= CELL_DESIGN_MIN_BOTTOM_PAD);
    setDisabled('shrink-w', contentLeft <= CELL_DESIGN_MIN_LEFT_PAD);
    setDisabled('shrink-e', extraRight <= CELL_DESIGN_MIN_RIGHT_PAD);
}

function clampCellDesignBoxToWorkArea() {
    const workAreaEl = document.getElementById('cellDesignWorkArea');
    const boxEl = document.getElementById('cellDesignBox');
    if (!workAreaEl || !boxEl) return;
    const maxLeft = Math.max(0, workAreaEl.clientWidth - boxEl.offsetWidth);
    const maxTop = Math.max(0, workAreaEl.clientHeight - boxEl.offsetHeight);
    const nextLeft = Math.min(maxLeft, Math.max(0, parseFloat(boxEl.style.left || '0')));
    const nextTop = Math.min(maxTop, Math.max(0, parseFloat(boxEl.style.top || '0')));
    boxEl.style.left = `${nextLeft}px`;
    boxEl.style.top = `${nextTop}px`;
}

function centerCellDesignBox() {
    const workAreaEl = document.getElementById('cellDesignWorkArea');
    const boxEl = document.getElementById('cellDesignBox');
    if (!workAreaEl || !boxEl) return;
    const nextLeft = Math.max(0, Math.round((workAreaEl.clientWidth - boxEl.offsetWidth) / 2));
    const nextTop = Math.max(0, Math.round((workAreaEl.clientHeight - boxEl.offsetHeight) / 2));
    boxEl.style.left = `${nextLeft}px`;
    boxEl.style.top = `${nextTop}px`;
}

function resizeCellDesignCanvas(action) {
    const workAreaEl = document.getElementById('cellDesignWorkArea');
    const boxEl = document.getElementById('cellDesignBox');
    const contentEl = document.getElementById('cellDesignContent');
    if (!workAreaEl || !boxEl || !contentEl) return;
    const [mode, side] = String(action || '').split('-');
    if (!mode || !side) return;
    const grow = mode === 'grow';
    let nextWidth = boxEl.offsetWidth;
    let nextHeight = boxEl.offsetHeight;
    let nextBoxLeft = parseFloat(boxEl.style.left || '0');
    let nextBoxTop = parseFloat(boxEl.style.top || '0');
    let nextContentLeft = Math.max(0, parseFloat(contentEl.style.left || '0'));
    let nextContentTop = Math.max(0, parseFloat(contentEl.style.top || '0'));
    const contentWidth = Math.ceil(contentEl.offsetWidth);
    const contentHeight = Math.ceil(contentEl.offsetHeight);

    if (side === 'w' || side === 'e') {
        const currentWidth = boxEl.offsetWidth;
        if (side === 'w') {
            if (grow) {
                const appliedDelta = Math.min(CELL_DESIGN_SIZE_STEP, nextBoxLeft);
                nextWidth = currentWidth + appliedDelta;
                nextBoxLeft -= appliedDelta;
                nextContentLeft += appliedDelta;
            } else {
                const appliedDelta = Math.min(
                    CELL_DESIGN_SIZE_STEP,
                    Math.max(0, nextContentLeft - CELL_DESIGN_MIN_LEFT_PAD),
                );
                nextWidth = currentWidth - appliedDelta;
                nextBoxLeft += appliedDelta;
                nextContentLeft -= appliedDelta;
            }
        } else if (grow) {
            const maxGrow = Math.max(0, workAreaEl.clientWidth - (nextBoxLeft + currentWidth));
            const appliedDelta = Math.min(CELL_DESIGN_SIZE_STEP, maxGrow);
            nextWidth = currentWidth + appliedDelta;
        } else {
            const minWidth = contentWidth + nextContentLeft + CELL_DESIGN_MIN_RIGHT_PAD;
            const appliedDelta = Math.min(CELL_DESIGN_SIZE_STEP, Math.max(0, currentWidth - minWidth));
            nextWidth = currentWidth - appliedDelta;
        }
    } else if (side === 'n' || side === 's') {
        const currentHeight = boxEl.offsetHeight;
        if (side === 'n') {
            if (grow) {
                const appliedDelta = Math.min(CELL_DESIGN_SIZE_STEP, nextBoxTop);
                nextHeight = currentHeight + appliedDelta;
                nextBoxTop -= appliedDelta;
                nextContentTop += appliedDelta;
            } else {
                const appliedDelta = Math.min(
                    CELL_DESIGN_SIZE_STEP,
                    Math.max(0, nextContentTop - CELL_DESIGN_MIN_TOP_PAD),
                );
                nextHeight = currentHeight - appliedDelta;
                nextBoxTop += appliedDelta;
                nextContentTop -= appliedDelta;
            }
        } else if (grow) {
            const maxGrow = Math.max(0, workAreaEl.clientHeight - (nextBoxTop + currentHeight));
            const appliedDelta = Math.min(CELL_DESIGN_SIZE_STEP, maxGrow);
            nextHeight = currentHeight + appliedDelta;
        } else {
            const minHeight = contentHeight + nextContentTop + CELL_DESIGN_MIN_BOTTOM_PAD;
            const appliedDelta = Math.min(CELL_DESIGN_SIZE_STEP, Math.max(0, currentHeight - minHeight));
            nextHeight = currentHeight - appliedDelta;
        }
    }

    boxEl.style.width = `${nextWidth}px`;
    boxEl.style.height = `${nextHeight}px`;
    boxEl.style.left = `${nextBoxLeft}px`;
    boxEl.style.top = `${nextBoxTop}px`;
    contentEl.style.left = `${nextContentLeft}px`;
    contentEl.style.top = `${nextContentTop}px`;
    clampCellDesignBoxToWorkArea();
    updateCellDesignDimensions();
}

async function openCellDesigner(deckId) {
    if (!canDesignMathCells) {
        showMathSheetError('Only super family can design cells.');
        return;
    }
    const deck = mathPrintConfigDecks.find((d) => d.shared_deck_id === deckId);
    if (!deck) return;
    _cellDesignDeckId = deckId;
    _cellDesignDeckName = deck.display_name || deck.name;

    const modal = document.getElementById('cellDesignModal');
    const titleEl = document.getElementById('cellDesignModalTitle');
    const boxEl = document.getElementById('cellDesignBox');
    const contentEl = document.getElementById('cellDesignContent');

    titleEl.textContent = `Design Cell — ${_cellDesignDeckName}`;

    /* Load previous design or defaults */
    const prev = cellDesigns.get(deckId);

    /* Fetch sample problem */
    try {
        const response = await fetch(`${API_BASE}/shared-decks/${deckId}/print-problems`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ count: 1 }),
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
        _cellDesignSample = (data.problems || [])[0] || null;
    } catch (err) {
        console.error('Failed to fetch sample problem:', err);
        _cellDesignSample = { prompt: '123 + 45 = ?', answer: '168' };
    }

    const savedOffsets = getCellDesignOffsets(prev);
    const hasSavedCanvas = Boolean(prev && Number(prev.canvasVersion || 0) >= CELL_DESIGN_CANVAS_VERSION);
    const nextOffsetX = hasSavedCanvas
        ? Math.max(savedOffsets.x, CELL_DESIGN_MIN_LEFT_PAD)
        : Math.max(DEFAULT_CELL_CONTENT_X, CELL_DESIGN_MIN_LEFT_PAD);
    const nextOffsetY = hasSavedCanvas
        ? Math.max(savedOffsets.y, CELL_DESIGN_MIN_TOP_PAD)
        : Math.max(DEFAULT_CELL_CONTENT_Y, CELL_DESIGN_MIN_TOP_PAD);
    const naturalSize = measureRenderedCell(renderVerticalPromptCell(_cellDesignSample));
    const minRequiredWidth = naturalSize.width + Math.max(0, nextOffsetX) + CELL_DESIGN_MIN_RIGHT_PAD;
    const minRequiredHeight = naturalSize.height + Math.max(0, nextOffsetY) + CELL_DESIGN_MIN_BOTTOM_PAD;
    const nextWidth = hasSavedCanvas ? Math.max(prev.cellWidth, minRequiredWidth) : minRequiredWidth;
    const nextHeight = hasSavedCanvas ? Math.max(prev.cellHeight, minRequiredHeight) : minRequiredHeight;

    contentEl.innerHTML = renderVerticalPromptCell(_cellDesignSample);
    contentEl.style.left = `${nextOffsetX}px`;
    contentEl.style.top = `${nextOffsetY}px`;

    boxEl.style.width = `${nextWidth}px`;
    boxEl.style.height = `${nextHeight}px`;

    modal.classList.remove('hidden');
    modal.setAttribute('aria-hidden', 'false');
    document.body.classList.add('modal-open');
    centerCellDesignBox();
    updateCellDesignDimensions();
}

function closeCellDesignModal() {
    const modal = document.getElementById('cellDesignModal');
    modal.classList.add('hidden');
    modal.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('modal-open');
}

async function saveCellDesign() {
    const boxEl = document.getElementById('cellDesignBox');
    const contentEl = document.getElementById('cellDesignContent');
    const saveBtn = document.getElementById('cellDesignSaveBtn');
    if (!boxEl || !contentEl || !saveBtn) return;

    const payload = {
        cellWidth: Math.round(boxEl.offsetWidth),
        cellHeight: Math.round(boxEl.offsetHeight),
        contentOffsetX: Math.round(parseFloat(contentEl.style.left || '0') || 0),
        contentOffsetY: Math.round(parseFloat(contentEl.style.top || '0') || 0),
        canvasVersion: CELL_DESIGN_CANVAS_VERSION,
        sampleProblem: _cellDesignSample ? {
            prompt: String(_cellDesignSample.prompt || ''),
            answer: String(_cellDesignSample.answer || ''),
        } : null,
    };

    saveBtn.disabled = true;
    const oldText = saveBtn.textContent;
    saveBtn.textContent = 'Saving...';
    try {
        showMathSheetError('');
        const response = await fetch(`${API_BASE}/shared-decks/${_cellDesignDeckId}/print-cell-design`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ cellDesign: payload }),
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);

        const raw = data && data.cell_design;
        const savedCellDef = raw && typeof raw === 'object' ? {
            deckId: _cellDesignDeckId,
            deckName: _cellDesignDeckName,
            cellWidth: Number.parseInt(raw.cell_width, 10),
            cellHeight: Number.parseInt(raw.cell_height, 10),
            contentOffsetX: Number.parseInt(raw.content_offset_x, 10) || 0,
            contentOffsetY: Number.parseInt(raw.content_offset_y, 10) || 0,
            canvasVersion: Number.parseInt(raw.canvas_version, 10) || CELL_DESIGN_CANVAS_VERSION,
            sampleProblem: raw.sample_problem && typeof raw.sample_problem === 'object'
                ? {
                    prompt: String(raw.sample_problem.prompt || ''),
                    answer: String(raw.sample_problem.answer || ''),
                }
                : null,
        } : {
            deckId: _cellDesignDeckId,
            deckName: _cellDesignDeckName,
            cellWidth: payload.cellWidth,
            cellHeight: payload.cellHeight,
            contentOffsetX: payload.contentOffsetX,
            contentOffsetY: payload.contentOffsetY,
            canvasVersion: payload.canvasVersion,
            sampleProblem: payload.sampleProblem,
        };
        cellDesigns.set(_cellDesignDeckId, savedCellDef);
        const deck = mathPrintConfigDecks.find((item) => item.shared_deck_id === _cellDesignDeckId);
        if (deck) {
            deck.cell_design = raw || {
                cell_width: savedCellDef.cellWidth,
                cell_height: savedCellDef.cellHeight,
                content_offset_x: savedCellDef.contentOffsetX,
                content_offset_y: savedCellDef.contentOffsetY,
                canvas_version: savedCellDef.canvasVersion,
                sample_problem: savedCellDef.sampleProblem,
            };
        }
        closeCellDesignModal();
        renderMathBuildInfo();
        updateBuildSheetButton();
    } catch (error) {
        console.error('Error saving cell design:', error);
        showMathSheetError(error.message || 'Failed to save cell design.');
    } finally {
        saveBtn.disabled = false;
        saveBtn.textContent = oldText;
    }
}

/* ── Sheet Builder ── */

function computeA4Scale() {
    const maxW = Math.min(window.innerWidth - 120, 780);
    const maxH = window.innerHeight - 200;
    return Math.min(maxW / A4_W, maxH / A4_H, 0.6);
}

function roundRowScale(scale) {
    return Math.round(scale * 10) / 10;
}

function clampRowScale(scale) {
    return Math.min(MAX_ROW_SCALE, Math.max(MIN_ROW_SCALE, roundRowScale(scale)));
}

function getDesignedMathDecks() {
    return mathPrintConfigDecks.filter((deck) => cellDesigns.has(deck.shared_deck_id));
}

function buildSheetRow(deckId, scale = 1) {
    const cellDef = cellDesigns.get(deckId);
    if (!cellDef) return null;
    const deck = mathPrintConfigDecks.find((item) => item.shared_deck_id === deckId);
    return {
        deckId,
        deckName: deck ? (deck.display_name || deck.name) : `Deck ${deckId}`,
        cellDef,
        scale: clampRowScale(scale),
    };
}

function getSheetRowMetrics(row) {
    if (!row || !row.cellDef) {
        return { scale: 1, cellWidth: 0, cellHeight: 0, colCount: 1, rowWidth: 0 };
    }
    const scale = clampRowScale(row.scale || 1);
    const cellWidth = Math.ceil(row.cellDef.cellWidth * scale);
    const cellHeight = Math.ceil(row.cellDef.cellHeight * scale);
    const colCount = Math.max(1, Math.floor(A4_SAFE_BOX_W / cellWidth));
    return {
        scale,
        cellWidth,
        cellHeight,
        colCount,
        rowWidth: colCount * cellWidth,
    };
}

function getSheetRowsHeight(rows = sheetRows) {
    return rows.reduce((sum, row) => sum + getSheetRowMetrics(row).cellHeight, 0);
}

function canFitSheetRows(rows) {
    return getSheetRowsHeight(rows) <= BUILDER_SAFE_GRID_H;
}

function canUseRowScale(rowIndex, nextScale) {
    if (!Number.isInteger(rowIndex) || rowIndex < 0 || rowIndex >= sheetRows.length) return false;
    if (nextScale < MIN_ROW_SCALE || nextScale > MAX_ROW_SCALE) return false;
    const nextRows = sheetRows.map((row, idx) => (
        idx === rowIndex ? Object.assign({}, row, { scale: clampRowScale(nextScale) }) : row
    ));
    return canFitSheetRows(nextRows);
}

function canAddAnySheetRow() {
    return getDesignedMathDecks().some((deck) => {
        const nextRow = buildSheetRow(deck.shared_deck_id, 1);
        if (!nextRow) return false;
        return canFitSheetRows([...sheetRows, nextRow]);
    });
}

function renderSheetBuilderCell(problem, cellDef, totalScale) {
    const width = Math.max(1, Math.round(cellDef.cellWidth * totalScale));
    const height = Math.max(1, Math.round(cellDef.cellHeight * totalScale));
    const offsets = getCellDesignOffsets(cellDef);
    const promptHtml = renderVerticalPromptCell(problem || cellDef.sampleProblem || { prompt: '', answer: '' });
    return `<div class="sb-row-cell" style="width:${width}px;height:${height}px;">
        <div class="sb-row-content">
            <div class="sb-row-transform" style="width:${cellDef.cellWidth}px;height:${cellDef.cellHeight}px;transform:scale(${totalScale});">
                <div class="sb-row-offset" style="left:${offsets.x}px;top:${offsets.y}px;">
                    ${promptHtml}
                </div>
            </div>
        </div>
    </div>`;
}

function getRowScaleLabel(scale) {
    return `${Math.round(scale * 100)}%`;
}
function renderA4Content(scale) {
    const a4El = document.getElementById('sheetBuilderA4');
    if (!a4El) return;
    const marginPx = Math.round(A4_MARGIN * scale);
    const safeMarginPx = Math.round(A4_EXTRA_SAFE_MARGIN * scale);
    const gridWidthPx = Math.round(A4_SAFE_BOX_W * scale);
    const headerHeightPx = Math.round(A4_HEADER_H * scale);
    const contentLeftPx = marginPx + safeMarginPx;
    const contentTopPx = marginPx + safeMarginPx;
    const gridTopPx = contentTopPx + headerHeightPx;
    const gridHeightPx = Math.round(BUILDER_GRID_H * scale);

    let html = '';
    html += `<div class="sb-margin" style="top:0;left:0;right:0;height:${marginPx}px;"></div>`;
    html += `<div class="sb-margin" style="bottom:0;left:0;right:0;height:${marginPx}px;"></div>`;
    html += `<div class="sb-margin" style="top:${marginPx}px;left:0;width:${marginPx}px;bottom:${marginPx}px;"></div>`;
    html += `<div class="sb-margin" style="top:${marginPx}px;right:0;width:${marginPx}px;bottom:${marginPx}px;"></div>`;
    html += `<div class="sb-safe-margin" style="top:${marginPx}px;left:${marginPx}px;right:${marginPx}px;height:${safeMarginPx}px;"></div>`;
    html += `<div class="sb-safe-margin" style="bottom:${marginPx}px;left:${marginPx}px;right:${marginPx}px;height:${safeMarginPx}px;"></div>`;
    html += `<div class="sb-safe-margin" style="top:${marginPx + safeMarginPx}px;left:${marginPx}px;width:${safeMarginPx}px;bottom:${marginPx + safeMarginPx}px;"></div>`;
    html += `<div class="sb-safe-margin" style="top:${marginPx + safeMarginPx}px;right:${marginPx}px;width:${safeMarginPx}px;bottom:${marginPx + safeMarginPx}px;"></div>`;
    html += `<div class="sb-header-row" style="position:absolute;top:${contentTopPx}px;left:${contentLeftPx}px;width:${gridWidthPx}px;height:${headerHeightPx}px;font-size:${Math.max(8, Math.round(10 * scale))}px;line-height:${headerHeightPx}px;">`;
    html += '<span>Name: ________</span><span>Sheet #___</span>';
    html += '</div>';
    html += `<div id="sheetBuilderGridArea" class="sb-grid-area" style="top:${gridTopPx}px;left:${contentLeftPx}px;width:${gridWidthPx}px;height:${gridHeightPx}px;">`;

    let usedHeight = 0;
    sheetRows.forEach((row, idx) => {
        const metrics = getSheetRowMetrics(row);
        const previewScale = metrics.scale * scale;
        const previewHeight = Math.max(1, Math.round(metrics.cellHeight * scale));
        const canScaleDown = canUseRowScale(idx, roundRowScale(metrics.scale - ROW_SCALE_STEP));
        const canScaleUp = canUseRowScale(idx, roundRowScale(metrics.scale + ROW_SCALE_STEP));
        const canDuplicate = canFitSheetRows([
            ...sheetRows.slice(0, idx + 1),
            Object.assign({}, row),
            ...sheetRows.slice(idx + 1),
        ]);
        html += `<div class="sb-row-wrap" data-sb-row-idx="${idx}" style="height:${previewHeight}px;z-index:${sheetRows.length - idx};">`;
        html += `<div class="sb-row-tools">
            <button type="button" class="sb-row-tool-btn" data-sb-row-scale="-1" data-row-idx="${idx}" title="Make row smaller (${escapeHtml(getRowScaleLabel(metrics.scale))})" aria-label="Make row smaller" ${canScaleDown ? '' : 'disabled'}>-</button>
            <button type="button" class="sb-row-tool-btn" data-sb-row-scale="1" data-row-idx="${idx}" title="Make row larger (${escapeHtml(getRowScaleLabel(metrics.scale))})" aria-label="Make row larger" ${canScaleUp ? '' : 'disabled'}>+</button>
            <button type="button" class="sb-row-tool-btn duplicate" data-sb-row-duplicate="${idx}" title="Duplicate this row below" aria-label="Duplicate this row below" ${canDuplicate ? '' : 'disabled'}>⧉</button>
            <button type="button" class="sb-row-tool-btn delete" data-sb-row-delete="${idx}" title="Delete this row" aria-label="Delete this row">x</button>
        </div>`;
        html += `<div class="sb-row" style="height:${previewHeight}px;">`;
        for (let cellIndex = 0; cellIndex < metrics.colCount; cellIndex += 1) {
            html += renderSheetBuilderCell(row.cellDef.sampleProblem, row.cellDef, previewScale);
        }
        html += '</div></div>';
        usedHeight += metrics.cellHeight;
    });

    const remainingHeight = BUILDER_SAFE_GRID_H - usedHeight;
    const addRowPreviewHeight = Math.round(remainingHeight * scale);
    if (remainingHeight >= 48 && canAddAnySheetRow()) {
        html += `<button type="button" class="sb-add-row-box" data-sb-add-row="1" style="height:${Math.max(24, Math.min(addRowPreviewHeight, 70))}px;">Click to choose a card for a new row</button>`;
    }

    html += '</div>';
    a4El.innerHTML = html;
}

function renderSheetBuilderPickerOptions() {
    const optionsEl = document.getElementById('sheetBuilderPickerOptions');
    if (!optionsEl) return;
    const decks = getDesignedMathDecks();
    if (decks.length === 0) {
        optionsEl.innerHTML = '<div class="sb-add-row-box sb-empty-box">Design a card first.</div>';
        return;
    }
    optionsEl.innerHTML = decks.map((deck) => {
        const deckId = deck.shared_deck_id;
        const def = cellDesigns.get(deckId);
        return `<button type="button" class="sb-picker-option" data-sb-picker-deck-id="${deckId}">
            <span class="sb-picker-option-name">${escapeHtml(deck.display_name || deck.name)}</span>
            <span class="sb-picker-option-meta">${def.cellWidth} x ${def.cellHeight}px cell</span>
        </button>`;
    }).join('');
}

function openSheetBuilderPicker(rowIndex) {
    const pickerEl = document.getElementById('sheetBuilderPicker');
    const titleEl = document.getElementById('sheetBuilderPickerTitle');
    if (!pickerEl || !titleEl) return;
    const designedDecks = getDesignedMathDecks();
    if (designedDecks.length === 0) {
        showMathSheetError('Design at least one card before building a sheet.');
        return;
    }
    sheetBuilderPickerRowIndex = Number.isInteger(rowIndex) ? rowIndex : null;
    titleEl.textContent = Number.isInteger(sheetBuilderPickerRowIndex) ? 'Reselect Card' : 'Choose Card';
    renderSheetBuilderPickerOptions();
    pickerEl.classList.remove('hidden');
    pickerEl.setAttribute('aria-hidden', 'false');
}

function closeSheetBuilderPicker() {
    const pickerEl = document.getElementById('sheetBuilderPicker');
    if (!pickerEl) return;
    pickerEl.classList.add('hidden');
    pickerEl.setAttribute('aria-hidden', 'true');
    sheetBuilderPickerRowIndex = null;
}

function addSheetRow(deckId) {
    const nextRow = buildSheetRow(deckId, 1);
    if (!nextRow) return false;
    const nextRows = [...sheetRows, nextRow];
    if (!canFitSheetRows(nextRows)) {
        showMathSheetError('That row does not fit in the remaining printable area.');
        return false;
    }
    showMathSheetError('');
    sheetRows = nextRows;
    renderA4Content(currentSheetScale);
    return true;
}

function replaceSheetRowDeck(rowIndex, deckId) {
    if (!Number.isInteger(rowIndex) || rowIndex < 0 || rowIndex >= sheetRows.length) return false;
    const currentRow = sheetRows[rowIndex];
    const attemptScales = [currentRow.scale, 1];
    for (const scale of attemptScales) {
        const nextRow = buildSheetRow(deckId, scale);
        if (!nextRow) continue;
        const nextRows = sheetRows.map((row, idx) => (idx === rowIndex ? nextRow : row));
        if (canFitSheetRows(nextRows)) {
            showMathSheetError('');
            sheetRows = nextRows;
            renderA4Content(currentSheetScale);
            return true;
        }
    }
    showMathSheetError('That card design does not fit in this row. Try a smaller scale or another design.');
    return false;
}

function updateSheetRowScale(rowIndex, direction) {
    if (!Number.isInteger(rowIndex) || rowIndex < 0 || rowIndex >= sheetRows.length) return;
    const row = sheetRows[rowIndex];
    const nextScale = clampRowScale((row.scale || 1) + (direction * ROW_SCALE_STEP));
    if (nextScale === row.scale) return;
    if (!canUseRowScale(rowIndex, nextScale)) {
        showMathSheetError('That scale does not fit in the printable area.');
        return;
    }
    showMathSheetError('');
    sheetRows[rowIndex] = Object.assign({}, row, { scale: nextScale });
    renderA4Content(currentSheetScale);
}

function duplicateSheetRow(rowIndex) {
    if (!Number.isInteger(rowIndex) || rowIndex < 0 || rowIndex >= sheetRows.length) return;
    const clonedRow = Object.assign({}, sheetRows[rowIndex]);
    const nextRows = [
        ...sheetRows.slice(0, rowIndex + 1),
        clonedRow,
        ...sheetRows.slice(rowIndex + 1),
    ];
    if (!canFitSheetRows(nextRows)) {
        showMathSheetError('There is not enough space to duplicate this row.');
        return;
    }
    showMathSheetError('');
    sheetRows = nextRows;
    renderA4Content(currentSheetScale);
}

function removeSheetRow(rowIndex) {
    if (!Number.isInteger(rowIndex) || rowIndex < 0 || rowIndex >= sheetRows.length) return;
    showMathSheetError('');
    sheetRows.splice(rowIndex, 1);
    renderA4Content(currentSheetScale);
}

function handleSheetBuilderDeckChoice(deckId) {
    const ok = Number.isInteger(sheetBuilderPickerRowIndex)
        ? replaceSheetRowDeck(sheetBuilderPickerRowIndex, deckId)
        : addSheetRow(deckId);
    if (ok) closeSheetBuilderPicker();
}

function openSheetBuilder() {
    if (cellDesigns.size === 0) {
        showMathSheetError('Design at least one printable cell in deck view before building a sheet.');
        return;
    }
    currentSheetScale = computeA4Scale();
    sheetRows = [];
    showMathSheetError('');
    const a4El = document.getElementById('sheetBuilderA4');
    a4El.style.width = Math.round(A4_W * currentSheetScale) + 'px';
    a4El.style.height = Math.round(A4_H * currentSheetScale) + 'px';
    renderA4Content(currentSheetScale);
    closeSheetBuilderPicker();
    document.getElementById('sheetBuilderModal').classList.remove('hidden');
    document.body.classList.add('modal-open');
}

function closeSheetBuilder() {
    closeSheetBuilderPicker();
    document.getElementById('sheetBuilderModal').classList.add('hidden');
    document.body.classList.remove('modal-open');
}

/* ── Save from Sheet Builder ── */

function buildVerticalCellCSS() {
    const mathMonoFont = "'Courier New', Courier, 'Nimbus Mono PS', 'Liberation Mono', monospace";
    return `
        .math-cell-v { --v-row-width-ch:6; --v-gap-ch:3; border:none; display:flex; flex-direction:column; align-items:flex-end; justify-content:flex-start; width:calc(var(--v-row-width-ch) * 1ch); color:#222; font-family:${mathMonoFont}; font-size:1.56rem; line-height:1.18; letter-spacing:0; font-variant-numeric:tabular-nums lining-nums; font-feature-settings:'tnum' 1, 'lnum' 1; font-variant-ligatures:none; font-kerning:none; }
        .v-row { display:block; white-space:pre; min-height:1.18em; width:100%; }
        .v-row-top { text-align:right; }
        .v-row-op { display:flex; align-items:baseline; justify-content:flex-end; white-space:normal; }
        .v-op { flex:0 0 1ch; width:1ch; text-align:center; }
        .v-gap { flex:0 0 calc(var(--v-gap-ch) * 1ch); width:calc(var(--v-gap-ch) * 1ch); min-width:calc(var(--v-gap-ch) * 1ch); }
        .v-row-bottom-num { flex:0 0 auto; text-align:right; white-space:pre; }
        .v-line { width:100%; border-top:2px solid currentColor; margin-top:0.08em; }
        .math-cell-div { border:none; display:inline-flex; flex-direction:column; align-items:flex-start; width:max-content; color:#222; font-family:${mathMonoFont}; font-size:1.56rem; line-height:1.18; letter-spacing:0; font-variant-numeric:tabular-nums lining-nums; font-feature-settings:'tnum' 1, 'lnum' 1; font-variant-ligatures:none; font-kerning:none; }
        .div-answer-row { height:1.3em; margin-bottom:0.12em; }
        .div-quotient { visibility:hidden; }
        .div-main-row { display:flex; align-items:baseline; white-space:pre; }
        .div-divisor { padding-right:0.08em; }
        .div-dividend { position:relative; padding:0.18em 0.18em 0 0.15em; margin-left:0.55em; border-top:2px solid currentColor; }
        .div-bracket-svg { position:absolute; right:calc(100% - 1px); top:-2px; width:0.55em; height:1.35em; overflow:visible; }
        .math-cell-v-fallback { border:none; text-align:left; font-family:${mathMonoFont}; font-size:1.34rem; line-height:1.24; font-variant-numeric:tabular-nums lining-nums; font-feature-settings:'tnum' 1, 'lnum' 1; }
    `;
}

async function saveSheetFromBuilder() {
    if (sheetRows.length === 0) {
        showMathSheetError('Add at least one row before saving this sheet.');
        return;
    }
    const doneBtn = document.getElementById('sheetBuilderDoneBtn');
    if (doneBtn) { doneBtn.disabled = true; doneBtn.textContent = 'Saving...'; }

    try {
        showMathSheetError('');
        const response = await fetch(buildType4ApiUrl('/math-sheets'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                rows: sheetRows.map((row) => ({
                    sharedDeckId: row.deckId,
                    scale: clampRowScale(row.scale || 1),
                })),
                categoryKey: activeCategoryKey,
            }),
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || `Failed to save sheet (HTTP ${response.status})`);
        closeSheetBuilder();
        await loadMathSheets();
    } catch (error) {
        console.error('Error saving built sheet:', error);
        showMathSheetError(error.message || 'Failed to save built sheet.');
    } finally {
        if (doneBtn) { doneBtn.disabled = false; doneBtn.textContent = 'Done'; }
    }
}

/* ── Init ── */

document.addEventListener('DOMContentLoaded', async () => {
    if (!kidId) { window.location.href = '/admin.html'; return; }

    /* Chinese mode listeners */
    if (createSheetBtn) createSheetBtn.addEventListener('click', () => createType2ChineseSheet());
    if (sheetCardCountInput) sheetCardCountInput.addEventListener('input', () => { showSheetError(''); updateGenerateSheetButtonState(); });
    if (sheetRowsPerCharInput) sheetRowsPerCharInput.addEventListener('input', () => { showSheetError(''); updateGenerateSheetButtonState(); });

    /* Math mode design-cell button delegation */
    if (mathDeckRowsEl) {
        mathDeckRowsEl.addEventListener('click', async (event) => {
            const designBtn = event.target.closest('button[data-design-cell]');
            if (!designBtn) return;
            const deckId = parseInt(designBtn.getAttribute('data-design-cell'), 10);
            if (deckId) await openCellDesigner(deckId);
        });
    }

    /* Cell Designer modal buttons */
    document.getElementById('cellDesignSaveBtn')?.addEventListener('click', saveCellDesign);
    document.getElementById('cellDesignCancelBtn')?.addEventListener('click', closeCellDesignModal);
    document.getElementById('cellDesignStage')?.addEventListener('click', (event) => {
        const resizeBtn = event.target.closest('[data-cell-resize]');
        if (!resizeBtn) return;
        const action = String(resizeBtn.getAttribute('data-cell-resize') || '').trim().toLowerCase();
        if (action) resizeCellDesignCanvas(action);
    });

    /* Sheet Builder */
    if (buildSheetBtn) buildSheetBtn.addEventListener('click', openSheetBuilder);
    document.getElementById('sheetBuilderCloseBtn')?.addEventListener('click', closeSheetBuilder);
    document.getElementById('sheetBuilderDoneBtn')?.addEventListener('click', saveSheetFromBuilder);
    document.getElementById('sheetBuilderA4')?.addEventListener('click', (e) => {
        const addBtn = e.target.closest('[data-sb-add-row]');
        if (addBtn) {
            openSheetBuilderPicker(null);
            return;
        }
        const scaleBtn = e.target.closest('[data-sb-row-scale]');
        if (scaleBtn) {
            const idx = Number.parseInt(scaleBtn.getAttribute('data-row-idx'), 10);
            const direction = Number.parseInt(scaleBtn.getAttribute('data-sb-row-scale'), 10);
            if (Number.isInteger(idx) && Number.isInteger(direction)) updateSheetRowScale(idx, direction);
            return;
        }
        const duplicateBtn = e.target.closest('[data-sb-row-duplicate]');
        if (duplicateBtn) {
            const idx = Number.parseInt(duplicateBtn.getAttribute('data-sb-row-duplicate'), 10);
            if (Number.isInteger(idx)) duplicateSheetRow(idx);
            return;
        }
        const deleteBtn = e.target.closest('[data-sb-row-delete]');
        if (deleteBtn) {
            const rowWrap = deleteBtn.closest('[data-sb-row-idx]');
            const idx = Number.parseInt(
                (rowWrap && rowWrap.getAttribute('data-sb-row-idx'))
                || deleteBtn.getAttribute('data-sb-row-delete'),
                10,
            );
            if (Number.isInteger(idx)) removeSheetRow(idx);
            return;
        }
    });
    document.getElementById('sheetBuilderPickerOptions')?.addEventListener('click', (event) => {
        const optionBtn = event.target.closest('[data-sb-picker-deck-id]');
        if (!optionBtn) return;
        const deckId = Number.parseInt(optionBtn.getAttribute('data-sb-picker-deck-id'), 10);
        if (Number.isInteger(deckId)) handleSheetBuilderDeckChoice(deckId);
    });
    document.getElementById('sheetBuilderPickerCancelBtn')?.addEventListener('click', closeSheetBuilderPicker);
    document.getElementById('sheetBuilderPicker')?.addEventListener('click', (event) => {
        if (event.target === event.currentTarget) closeSheetBuilderPicker();
    });
    window.addEventListener('resize', () => {
        const modal = document.getElementById('sheetBuilderModal');
        if (!modal || modal.classList.contains('hidden')) return;
        currentSheetScale = computeA4Scale();
        const a4El = document.getElementById('sheetBuilderA4');
        if (!a4El) return;
        a4El.style.width = Math.round(A4_W * currentSheetScale) + 'px';
        a4El.style.height = Math.round(A4_H * currentSheetScale) + 'px';
        renderA4Content(currentSheetScale);
    });
    document.addEventListener('keydown', (event) => {
        if (event.key !== 'Escape') return;
        const picker = document.getElementById('sheetBuilderPicker');
        const cellModal = document.getElementById('cellDesignModal');
        const builderModal = document.getElementById('sheetBuilderModal');
        if (picker && !picker.classList.contains('hidden')) {
            closeSheetBuilderPicker();
            return;
        }
        if (cellModal && !cellModal.classList.contains('hidden')) {
            closeCellDesignModal();
            return;
        }
        if (builderModal && !builderModal.classList.contains('hidden')) {
            closeSheetBuilder();
            return;
        }
    });
    document.getElementById('cellDesignModal')?.addEventListener('click', (event) => {
        if (event.target === event.currentTarget) closeCellDesignModal();
    });
    document.getElementById('sheetBuilderModal')?.addEventListener('click', (event) => {
        const picker = document.getElementById('sheetBuilderPicker');
        if (picker && !picker.classList.contains('hidden')) return;
        if (event.target === event.currentTarget) closeSheetBuilder();
    });

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
                    if (pageMode === 'math') goToMathSheetPreview(sheetId);
                    else goToChineseSheetPrint(sheetId);
                    return;
                }
                if (action === 'done') await markSheetDone(sheetId);
                else if (action === 'delete') await deleteSheet(sheetId);
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
