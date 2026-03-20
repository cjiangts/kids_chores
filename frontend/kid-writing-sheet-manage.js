const API_BASE = `${window.location.origin}/api`;

const params = new URLSearchParams(window.location.search);
const kidId = String(params.get('id') || '').trim();
const requestedCategoryKey = String(params.get('categoryKey') || '').trim().toLowerCase();

const pageTitleEl = document.getElementById('pageTitle');
const backBtn = document.getElementById('backBtn');
const errorMessage = document.getElementById('errorMessage');

const chineseGenerateSection = document.getElementById('chineseGenerateSection');
const mathGenerateSection = document.getElementById('mathGenerateSection');
const sheetHistorySection = document.getElementById('sheetHistorySection');
const sheetHistoryTitle = document.getElementById('sheetHistoryTitle');
const sheetHistoryNote = document.getElementById('sheetHistoryNote');
const mathDeckRowsEl = document.getElementById('mathDeckRows');
const mathBuildInfoEl = document.getElementById('mathBuildInfo');
const mathSheetErrorMessage = document.getElementById('mathSheetErrorMessage');

const sheetList = document.getElementById('sheetList');

const sheetErrorMessage = document.getElementById('sheetErrorMessage');

let activeCategoryKey = requestedCategoryKey;
let activeCategoryDisplayName = '';
let activeKidName = '';
let state2Cards = [];

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

function parseTimestamp(value) {
    const parsed = new Date(value || '').getTime();
    return Number.isNaN(parsed) ? 0 : parsed;
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
        if (chineseGenerateSection) chineseGenerateSection.classList.add('hidden');
        if (mathGenerateSection) mathGenerateSection.classList.remove('hidden');
        if (sheetHistorySection) sheetHistorySection.classList.remove('hidden');
        if (sheetHistoryTitle) sheetHistoryTitle.textContent = 'Sheets';
        if (sheetHistoryNote) sheetHistoryNote.textContent = 'Newest first. Preview, print, mark done, or delete saved math sheets here.';
    } else {
        if (chineseGenerateSection) chineseGenerateSection.classList.remove('hidden');
        if (mathGenerateSection) mathGenerateSection.classList.add('hidden');
        if (sheetHistorySection) sheetHistorySection.classList.remove('hidden');
        if (sheetHistoryTitle) sheetHistoryTitle.textContent = 'Practice Sheets';
        if (sheetHistoryNote) sheetHistoryNote.textContent = 'Print, mark done, or delete pending sheets here.';
    }
}

/* ── Chinese writing mode (existing) ── */

async function loadSuggestedCards() {
    showError('');
    const response = await fetch(buildType2ApiUrl('/cards'));
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `Failed to load Chinese Writing cards (HTTP ${response.status})`);
    if (!Boolean(data.has_chinese_specific_logic)) throw new Error('This category does not support printable Chinese writing sheets.');
    state2Cards = Array.isArray(data.practicing_cards) ? data.practicing_cards : [];
    updateBuildChineseSheetButton();
}

/* ── Chinese sheets list ── */

async function loadChineseSheets() {
    if (!sheetList) return;
    const response = await fetch(buildType2ApiUrl('/chinese-print-sheets'));
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
    const orderedSheets = [...sheets].sort((a, b) => {
        const createdDiff = parseTimestamp(b && b.created_at) - parseTimestamp(a && a.created_at);
        if (createdDiff !== 0) return createdDiff;
        return (Number.parseInt(b && b.id, 10) || 0) - (Number.parseInt(a && a.id, 10) || 0);
    });
    sheetList.innerHTML = orderedSheets.map((sheet) => {
        const sheetId = Number.parseInt(sheet && sheet.id, 10);
        const safeSheetId = Number.isInteger(sheetId) && sheetId > 0 ? sheetId : 0;
        const cardLabels = Array.isArray(sheet && sheet.card_labels) ? sheet.card_labels : [];
        const answersHtml = cardLabels.length > 0
            ? cardLabels.map((label) => `<span class="sheet-card-pill">${escapeHtml(label)}</span>`).join('')
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
    updateBuildSheetButton();
}

function renderMathBuildInfo() {
    const totalDecks = mathPrintConfigDecks.length;
    const designedDecks = getDesignedMathDecks().length;
    const printableSummary = `${designedDecks} of ${totalDecks} opted-in deck${totalDecks === 1 ? '' : 's'} printable.`;
    const inlineSummary = `${totalDecks} opted-in deck${totalDecks === 1 ? '' : 's'} available to print inline.`;
    if (mathBuildInfoEl) {
        mathBuildInfoEl.textContent = '';
        mathBuildInfoEl.classList.add('hidden');
    }
    if (buildSheetBtn) {
        buildSheetBtn.innerHTML = `
            <span class="sheet-build-btn-title">Build Vertical Sheet</span>
            <span class="sheet-build-btn-meta">${escapeHtml(printableSummary)}</span>
        `;
    }
    if (buildInlineSheetBtn) {
        buildInlineSheetBtn.innerHTML = `
            <span class="sheet-build-btn-title">Build Inline Sheet</span>
            <span class="sheet-build-btn-meta">${escapeHtml(inlineSummary)}</span>
        `;
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
    const orderedSheets = [...sheets].sort((a, b) => {
        const createdDiff = parseTimestamp(b && b.created_at) - parseTimestamp(a && a.created_at);
        if (createdDiff !== 0) return createdDiff;
        return (Number.parseInt(b && b.id, 10) || 0) - (Number.parseInt(a && a.id, 10) || 0);
    });
    sheetList.innerHTML = orderedSheets.map((sheet) => {
        const sheetId = Number.parseInt(sheet && sheet.id, 10);
        const safeSheetId = Number.isInteger(sheetId) && sheetId > 0 ? sheetId : 0;
        const status = String(sheet && sheet.status || '').trim().toLowerCase();
        const isPreview = status === 'preview';
        const isPending = status === 'pending';
        const isDone = status === 'done';
        const statusClass = isDone ? 'done' : (isPreview ? 'preview' : 'pending');
        const statusLabel = isDone ? 'done' : (isPreview ? 'preview' : 'practicing');
        const layoutKey = String(sheet && sheet.layout_format || '').trim().toLowerCase() === 'inline' ? 'inline' : 'vertical';
        const layoutLabel = layoutKey === 'inline' ? 'Inline' : 'Vertical';
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
        const repeatCount = Math.max(
            1,
            Number.parseInt(sheet && (sheet.repeat_count ?? sheet.page_count), 10) || 1,
        );
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
                <div class="sheet-head"><div class="sheet-head-left"><div>Sheet #${safeSheetId}</div><span class="sheet-layout-tag">${layoutLabel}</span><span class="sheet-problem-tag">${problemCount} problem${problemCount === 1 ? '' : 's'}</span><span class="sheet-repeat-tag">x${repeatCount}</span></div><div class="sheet-head-right"><span class="status ${statusClass}">${statusLabel}</span></div></div>
                <div class="sheet-meta">Printed: ${escapeHtml(printedDay)}<br>Finished: ${escapeHtml(finishedDay)}<br>Time to finish: ${escapeHtml(finishedIn)}${accuracyLine}</div>
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
        : buildType2ApiUrl(`/chinese-print-sheets/${sheetId}/complete`);
    const body = Object.assign({}, extraBody || {});
    const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `Failed to mark sheet done (HTTP ${response.status})`);
}

async function deleteSheet(sheetId) {
    const url = pageMode === 'math'
        ? buildType4ApiUrl(`/math-sheets/${sheetId}/withdraw`)
        : buildType2ApiUrl(`/chinese-print-sheets/${sheetId}/withdraw`);
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
const DEFAULT_MATH_PAPER_SIZE = 'letter';
const PRINTABLE_AREA_DEBUG_BORDER_INSET = 2;
const PAPER_MARGIN = 19;
const PAPER_EXTRA_SAFE_MARGIN_X = 34;
const PAPER_EXTRA_SAFE_MARGIN_TOP = 42;
const PAPER_EXTRA_SAFE_MARGIN_BOTTOM = 42;
const PAPER_HEADER_HEIGHT = 24;
const PRINT_FIT_SAFETY_PX = 12;
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
const PAPER_SPECS = Object.freeze({
    letter: buildMathPaperSpec('letter', 816, 1056, '8.5 x 11 (US Letter)'),
    a4: buildMathPaperSpec('a4', 794, 1123, '8.27 x 11.69 (A4)'),
});

let currentMathPaperSize = DEFAULT_MATH_PAPER_SIZE;

const buildSheetBtn = document.getElementById('buildSheetBtn');
const sheetBuilderPaperSizeSelect = document.getElementById('sheetBuilderPaperSize');
const inlineSheetPaperSizeSelect = document.getElementById('inlineSheetPaperSize');

function buildMathPaperSpec(key, pageWidth, pageHeight, label) {
    const gridWidth = pageWidth - (2 * PAPER_MARGIN);
    const gridHeight = pageHeight - (2 * PAPER_MARGIN);
    const boxWidth = gridWidth - (2 * PAPER_EXTRA_SAFE_MARGIN_X);
    const boxHeight = gridHeight - PAPER_EXTRA_SAFE_MARGIN_TOP - PAPER_EXTRA_SAFE_MARGIN_BOTTOM;
    const builderGridHeight = boxHeight - PAPER_HEADER_HEIGHT;
    return Object.freeze({
        key,
        label,
        pageWidth,
        pageHeight,
        margin: PAPER_MARGIN,
        extraSafeMarginX: PAPER_EXTRA_SAFE_MARGIN_X,
        extraSafeMarginTop: PAPER_EXTRA_SAFE_MARGIN_TOP,
        extraSafeMarginBottom: PAPER_EXTRA_SAFE_MARGIN_BOTTOM,
        headerHeight: PAPER_HEADER_HEIGHT,
        safeBoxWidth: boxWidth,
        safeBoxHeight: boxHeight,
        builderGridHeight,
        builderSafeGridHeight: builderGridHeight - PRINT_FIT_SAFETY_PX,
    });
}

function normalizeMathPaperSize(value, fallback = DEFAULT_MATH_PAPER_SIZE) {
    const raw = String(value || '').trim().toLowerCase();
    if (raw === 'letter' || raw === 'us-letter' || raw === 'us_letter' || raw === 'us letter') {
        return 'letter';
    }
    if (raw === 'a4') {
        return 'a4';
    }
    return String(fallback || DEFAULT_MATH_PAPER_SIZE);
}

function getMathPaperSpec(paperSize = currentMathPaperSize, fallback = DEFAULT_MATH_PAPER_SIZE) {
    const key = normalizeMathPaperSize(paperSize, fallback);
    return PAPER_SPECS[key] || PAPER_SPECS[DEFAULT_MATH_PAPER_SIZE];
}

function syncMathPaperSizeSelects() {
    if (sheetBuilderPaperSizeSelect) sheetBuilderPaperSizeSelect.value = currentMathPaperSize;
    if (inlineSheetPaperSizeSelect) inlineSheetPaperSizeSelect.value = currentMathPaperSize;
    if (chineseSheetPaperSizeSelect) chineseSheetPaperSizeSelect.value = currentMathPaperSize;
}

function applyBuilderPageFrame(pageEl, scale, paperSize = currentMathPaperSize) {
    if (!pageEl) return;
    const paperSpec = getMathPaperSpec(paperSize);
    pageEl.style.width = Math.round(paperSpec.pageWidth * scale) + 'px';
    pageEl.style.height = Math.round(paperSpec.pageHeight * scale) + 'px';
}

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
    if (buildSheetBtn) buildSheetBtn.disabled = cellDesigns.size === 0;
    renderMathBuildInfo();
    updateBuildInlineSheetButton();
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
    const boxEl = document.getElementById('cellDesignBox');
    const contentEl = document.getElementById('cellDesignContent');

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

function computeSheetPreviewScale(paperSize = currentMathPaperSize) {
    const paperSpec = getMathPaperSpec(paperSize);
    const maxW = Math.min(window.innerWidth - 120, 780);
    const maxH = window.innerHeight - 200;
    return Math.min(maxW / paperSpec.pageWidth, maxH / paperSpec.pageHeight, 0.6);
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

function getUsedVerticalSheetDeckIds(excludedRowIndex = null) {
    const usedDeckIds = new Set();
    sheetRows.forEach((row, index) => {
        if (!row || !Number.isInteger(row.deckId)) return;
        if (Number.isInteger(excludedRowIndex) && index === excludedRowIndex) return;
        usedDeckIds.add(row.deckId);
    });
    return usedDeckIds;
}

function getAvailableVerticalSheetDecks(excludedRowIndex = null) {
    const usedDeckIds = getUsedVerticalSheetDeckIds(excludedRowIndex);
    return getDesignedMathDecks().filter((deck) => !usedDeckIds.has(deck.shared_deck_id));
}

function getUsedInlineSheetDeckIds() {
    const usedDeckIds = new Set();
    inlineSheetRows.forEach((row) => {
        if (row && Number.isInteger(row.deckId)) usedDeckIds.add(row.deckId);
    });
    return usedDeckIds;
}

function getAvailableInlineSheetDecks() {
    const usedDeckIds = getUsedInlineSheetDeckIds();
    return mathPrintConfigDecks.filter((deck) => !usedDeckIds.has(deck.shared_deck_id));
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
    const paperSpec = getMathPaperSpec();
    const scale = clampRowScale(row.scale || 1);
    const cellWidth = Math.ceil(row.cellDef.cellWidth * scale);
    const cellHeight = Math.ceil(row.cellDef.cellHeight * scale);
    const colCount = Math.max(1, Math.floor(paperSpec.safeBoxWidth / cellWidth));
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
    return getSheetRowsHeight(rows) <= getMathPaperSpec().builderSafeGridHeight;
}

function canUseRowScale(rowIndex, nextScale) {
    if (!Number.isInteger(rowIndex) || rowIndex < 0 || rowIndex >= sheetRows.length) return false;
    if (nextScale < MIN_ROW_SCALE || nextScale > MAX_ROW_SCALE) return false;
    const targetDeckId = sheetRows[rowIndex].deckId;
    const nextRows = sheetRows.map((row) => (
        row.deckId === targetDeckId ? Object.assign({}, row, { scale: clampRowScale(nextScale) }) : row
    ));
    return canFitSheetRows(nextRows);
}

function canAddAnySheetRow() {
    return getAvailableVerticalSheetDecks().some((deck) => {
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

function buildBuilderDeckSummaryText(rows) {
    if (!Array.isArray(rows) || rows.length === 0) return '';
    const names = [];
    const seen = new Set();
    rows.forEach((row) => {
        const name = String(row && row.deckName || '').trim();
        if (!name || seen.has(name)) return;
        seen.add(name);
        names.push(name);
    });
    return names.join(' · ');
}

function renderSheetBuilderContent(scale) {
    const a4El = document.getElementById('sheetBuilderA4');
    if (!a4El) return;
    const paperSpec = getMathPaperSpec();
    const marginPx = Math.round(paperSpec.margin * scale);
    const safeMarginXPx = Math.round(paperSpec.extraSafeMarginX * scale);
    const safeMarginTopPx = Math.round(paperSpec.extraSafeMarginTop * scale);
    const safeMarginBottomPx = Math.round(paperSpec.extraSafeMarginBottom * scale);
    const gridWidthPx = Math.round(paperSpec.safeBoxWidth * scale);
    const headerHeightPx = Math.round(paperSpec.headerHeight * scale);
    const contentLeftPx = marginPx + safeMarginXPx;
    const contentTopPx = marginPx + safeMarginTopPx;
    const gridTopPx = contentTopPx + headerHeightPx;
    const gridHeightPx = Math.round(paperSpec.builderGridHeight * scale);
    const printableHeightPx = Math.round(paperSpec.safeBoxHeight * scale);
    const borderInsetPx = Math.round(PRINTABLE_AREA_DEBUG_BORDER_INSET * scale);
    const headerFontPx = Math.max(10, Math.round(12 * scale));
    const headerDeckFontPx = Math.max(9, Math.round(11 * scale));
    const deckSummaryText = buildBuilderDeckSummaryText(sheetRows);

    let html = '';
    html += `<div class="sb-margin" style="top:0;left:0;right:0;height:${marginPx}px;"></div>`;
    html += `<div class="sb-margin" style="bottom:0;left:0;right:0;height:${marginPx}px;"></div>`;
    html += `<div class="sb-margin" style="top:${marginPx}px;left:0;width:${marginPx}px;bottom:${marginPx}px;"></div>`;
    html += `<div class="sb-margin" style="top:${marginPx}px;right:0;width:${marginPx}px;bottom:${marginPx}px;"></div>`;
    html += `<div class="sb-safe-margin" style="top:${marginPx}px;left:${marginPx}px;right:${marginPx}px;height:${safeMarginTopPx}px;"></div>`;
    html += `<div class="sb-safe-margin" style="bottom:${marginPx}px;left:${marginPx}px;right:${marginPx}px;height:${safeMarginBottomPx}px;"></div>`;
    html += `<div class="sb-safe-margin" style="top:${marginPx + safeMarginTopPx}px;left:${marginPx}px;width:${safeMarginXPx}px;bottom:${marginPx + safeMarginBottomPx}px;"></div>`;
    html += `<div class="sb-safe-margin" style="top:${marginPx + safeMarginTopPx}px;right:${marginPx}px;width:${safeMarginXPx}px;bottom:${marginPx + safeMarginBottomPx}px;"></div>`;
    html += `<div class="sb-printable-border" style="top:${contentTopPx + borderInsetPx}px;left:${contentLeftPx + borderInsetPx}px;width:${Math.max(1, gridWidthPx - (2 * borderInsetPx))}px;height:${Math.max(1, printableHeightPx - (2 * borderInsetPx))}px;"></div>`;
    html += `<div class="sb-header-row" style="position:absolute;top:${contentTopPx}px;left:${contentLeftPx}px;width:${gridWidthPx}px;height:${headerHeightPx}px;">`;
    html += `<span class="sb-header-name" style="font-size:${headerFontPx}px;">Name: ________</span>`;
    html += `<span class="sb-header-decks" style="font-size:${headerDeckFontPx}px;" title="${escapeHtml(deckSummaryText)}">${escapeHtml(deckSummaryText)}</span>`;
    html += `<span class="sb-header-sheetno" style="font-size:${headerFontPx}px;">Sheet #___</span>`;
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

    const remainingHeight = paperSpec.builderSafeGridHeight - usedHeight;
    const addRowPreviewHeight = Math.round(remainingHeight * scale);
    if (remainingHeight >= 48 && canAddAnySheetRow()) {
        html += `<button type="button" class="sb-add-row-box" data-sb-add-row="1" style="height:${Math.max(24, Math.min(addRowPreviewHeight, 70))}px;">Click to choose a card for a new row</button>`;
    }

    html += '</div>';
    a4El.innerHTML = html;

    const totalQuestions = sheetRows.reduce((sum, row) => sum + getSheetRowMetrics(row).colCount, 0);
    const countEl = document.getElementById('sheetBuilderQuestionCount');
    if (countEl) {
        countEl.textContent = totalQuestions > 0 ? `${totalQuestions} questions` : '';
    }
}

function renderSheetBuilderPickerOptions() {
    const optionsEl = document.getElementById('sheetBuilderPickerOptions');
    if (!optionsEl) return;
    const decks = getAvailableVerticalSheetDecks(sheetBuilderPickerRowIndex);
    if (decks.length === 0) {
        optionsEl.innerHTML = `<div class="sb-add-row-box sb-empty-box">${
            Number.isInteger(sheetBuilderPickerRowIndex)
                ? 'All other designed cards are already on this sheet.'
                : 'All designed cards are already on this sheet.'
        }</div>`;
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
    const availableDecks = getAvailableVerticalSheetDecks(sheetBuilderPickerRowIndex);
    if (availableDecks.length === 0) {
        showMathSheetError(
            Number.isInteger(sheetBuilderPickerRowIndex)
                ? 'All other designed cards are already used on this sheet.'
                : 'All designed cards are already used on this sheet.'
        );
        return;
    }
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
    renderSheetBuilderContent(currentSheetScale);
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
            renderSheetBuilderContent(currentSheetScale);
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
    const targetDeckId = row.deckId;
    for (let i = 0; i < sheetRows.length; i++) {
        if (sheetRows[i].deckId === targetDeckId) {
            sheetRows[i] = Object.assign({}, sheetRows[i], { scale: nextScale });
        }
    }
    renderSheetBuilderContent(currentSheetScale);
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
    renderSheetBuilderContent(currentSheetScale);
}

function removeSheetRow(rowIndex) {
    if (!Number.isInteger(rowIndex) || rowIndex < 0 || rowIndex >= sheetRows.length) return;
    showMathSheetError('');
    sheetRows.splice(rowIndex, 1);
    renderSheetBuilderContent(currentSheetScale);
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
    syncMathPaperSizeSelects();
    currentSheetScale = computeSheetPreviewScale();
    sheetRows = [];
    showMathSheetError('');
    const a4El = document.getElementById('sheetBuilderA4');
    applyBuilderPageFrame(a4El, currentSheetScale);
    renderSheetBuilderContent(currentSheetScale);
    closeSheetBuilderPicker();
    document.getElementById('sheetBuilderModal').classList.remove('hidden');
    document.body.classList.add('modal-open');
}

function closeSheetBuilder() {
    closeSheetBuilderPicker();
    document.getElementById('sheetBuilderModal').classList.add('hidden');
    document.body.classList.remove('modal-open');
}

function handleMathPaperSizeChange(nextPaperSize) {
    currentMathPaperSize = normalizeMathPaperSize(nextPaperSize);
    syncMathPaperSizeSelects();
    let nextError = '';

    const verticalModal = document.getElementById('sheetBuilderModal');
    if (verticalModal && !verticalModal.classList.contains('hidden')) {
        currentSheetScale = computeSheetPreviewScale();
        applyBuilderPageFrame(document.getElementById('sheetBuilderA4'), currentSheetScale);
        renderSheetBuilderContent(currentSheetScale);
        if (sheetRows.length > 0 && !canFitSheetRows(sheetRows)) {
            nextError = 'Current vertical layout no longer fits on the selected paper size.';
        }
    }

    const inlineModal = document.getElementById('inlineSheetBuilderModal');
    if (inlineModal && !inlineModal.classList.contains('hidden')) {
        currentInlineSheetScale = computeSheetPreviewScale();
        applyBuilderPageFrame(document.getElementById('inlineSheetA4'), currentInlineSheetScale);
        renderInlineSheetBuilderContent(currentInlineSheetScale);
    }

    showMathSheetError(nextError);
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
                paperSize: currentMathPaperSize,
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

/* ── Inline (Horizontal) Sheet Builder ── */

const buildInlineSheetBtn = document.getElementById('buildInlineSheetBtn');
let inlineSheetRows = [];
let currentInlineSheetScale = 0.5;
let inlineSheetPickerRowIndex = null;

const INLINE_FONT_SIZE = 14;
const INLINE_MIN_FONT_SCALE = 0.8;
const INLINE_MAX_FONT_SCALE = 3.0;
const INLINE_FONT_SCALE_STEP = 0.1;
const INLINE_LINE_HEIGHT = 1.4;
const INLINE_CELL_H = Math.ceil(INLINE_FONT_SIZE * INLINE_LINE_HEIGHT) + 4;
const INLINE_CHAR_W = INLINE_FONT_SIZE * 0.6;
const INLINE_CELL_PAD = 6;

function roundInlineFontScale(scale) {
    return Math.round(scale * 10) / 10;
}

function clampInlineFontScale(scale) {
    return Math.min(INLINE_MAX_FONT_SCALE, Math.max(INLINE_MIN_FONT_SCALE, roundInlineFontScale(scale)));
}

function getInlineFontScaleLabel(scale) {
    return `${Math.round(clampInlineFontScale(scale) * 100)}%`;
}

function getInlineCellWidth(problem, fontScale = 1) {
    const prompt = String((problem && problem.prompt) || '').replace(/\s*=\s*[?？_\s]*$/, '').trim();
    const answer = String((problem && problem.answer) || '').trim();
    const effectiveScale = clampInlineFontScale(fontScale);
    const charWidth = INLINE_CHAR_W * effectiveScale;
    const cellPad = Math.max(4, Math.round(INLINE_CELL_PAD * effectiveScale));
    // Tighter spacing: strip original spaces, add ~0.5 char gap per operator gap
    const compactLen = prompt.replace(/\s+/g, '').length + 2; // operators + digits + " ="
    const answerSpace = Math.max(5, answer.length + 3); // more room for writing
    return Math.ceil((compactLen + answerSpace) * charWidth + cellPad * 2);
}

function getInlineRowMetrics(row) {
    if (!row || !row.sampleProblem) {
        return {
            fontScale: 1,
            fontSize: INLINE_FONT_SIZE,
            cellWidth: 120,
            cellHeight: INLINE_CELL_H,
            colCount: 1,
            repeatCount: 1,
            totalHeight: INLINE_CELL_H,
            cellPad: INLINE_CELL_PAD,
        };
    }
    const paperSpec = getMathPaperSpec();
    const fontScale = clampInlineFontScale(row.fontScale || 1);
    const fontSize = Math.max(8, Math.round(INLINE_FONT_SIZE * fontScale));
    const cellHeight = Math.ceil(fontSize * INLINE_LINE_HEIGHT) + 4;
    const cellPad = Math.max(4, Math.round(INLINE_CELL_PAD * fontScale));
    const cellWidth = getInlineCellWidth(row.sampleProblem, fontScale);
    const colCount = Math.max(1, Math.floor(paperSpec.safeBoxWidth / cellWidth));
    const repeatCount = Math.max(1, Number.parseInt(row.repeatCount, 10) || 1);
    return {
        fontScale,
        fontSize,
        cellWidth,
        cellHeight,
        colCount,
        repeatCount,
        totalHeight: cellHeight * repeatCount,
        cellPad,
    };
}

function canFitInlineSheetRows(rows) {
    const h = rows.reduce((sum, row) => sum + getInlineRowMetrics(row).totalHeight, 0);
    return h <= getMathPaperSpec().builderSafeGridHeight;
}

function getInlineSheetPageCount(rows) {
    const safeHeight = getMathPaperSpec().builderSafeGridHeight;
    if (!Array.isArray(rows) || rows.length === 0 || safeHeight <= 0) {
        return 1;
    }
    let pageCount = 1;
    let usedHeight = 0;
    rows.forEach((row) => {
        const rowHeight = getInlineRowMetrics(row).totalHeight;
        if (usedHeight > 0 && (usedHeight + rowHeight) > safeHeight) {
            pageCount += 1;
            usedHeight = 0;
        }
        usedHeight += rowHeight;
    });
    return Math.max(1, pageCount);
}

function getInlineSheetPageLayoutInfo(rows) {
    const paperSpec = getMathPaperSpec();
    const safeHeight = paperSpec.builderSafeGridHeight;
    const visibleHeight = paperSpec.builderGridHeight;
    if (!Array.isArray(rows) || rows.length === 0 || safeHeight <= 0 || visibleHeight <= 0) {
        return {
            pageCount: 1,
            usedHeightOnLastPage: 0,
            remainingSafeHeightOnLastPage: safeHeight,
            remainingVisibleHeightOnLastPage: visibleHeight,
        };
    }
    let pageCount = 1;
    let usedHeight = 0;
    rows.forEach((row) => {
        const rowHeight = getInlineRowMetrics(row).totalHeight;
        if (usedHeight > 0 && (usedHeight + rowHeight) > safeHeight) {
            pageCount += 1;
            usedHeight = 0;
        }
        usedHeight += rowHeight;
    });
    return {
        pageCount: Math.max(1, pageCount),
        usedHeightOnLastPage: usedHeight,
        remainingSafeHeightOnLastPage: Math.max(0, safeHeight - usedHeight),
        remainingVisibleHeightOnLastPage: Math.max(0, visibleHeight - usedHeight),
    };
}

function renderInlineSheetBuilderContent(scale) {
    const a4El = document.getElementById('inlineSheetA4');
    if (!a4El) return;
    const paperSpec = getMathPaperSpec();
    const marginPx = Math.round(paperSpec.margin * scale);
    const safeMarginXPx = Math.round(paperSpec.extraSafeMarginX * scale);
    const safeMarginTopPx = Math.round(paperSpec.extraSafeMarginTop * scale);
    const safeMarginBottomPx = Math.round(paperSpec.extraSafeMarginBottom * scale);
    const gridWidthPx = Math.round(paperSpec.safeBoxWidth * scale);
    const headerHeightPx = Math.round(paperSpec.headerHeight * scale);
    const contentLeftPx = marginPx + safeMarginXPx;
    const contentTopPx = marginPx + safeMarginTopPx;
    const gridTopPx = contentTopPx + headerHeightPx;
    const gridHeightPx = Math.round(paperSpec.builderGridHeight * scale);
    const printableHeightPx = Math.round(paperSpec.safeBoxHeight * scale);
    const borderInsetPx = Math.round(PRINTABLE_AREA_DEBUG_BORDER_INSET * scale);
    const headerFontPx = Math.max(10, Math.round(12 * scale));
    const headerDeckFontPx = Math.max(9, Math.round(11 * scale));
    const deckSummaryText = buildBuilderDeckSummaryText(inlineSheetRows);

    let html = '';
    html += `<div class="sb-margin" style="top:0;left:0;right:0;height:${marginPx}px;"></div>`;
    html += `<div class="sb-margin" style="bottom:0;left:0;right:0;height:${marginPx}px;"></div>`;
    html += `<div class="sb-margin" style="top:${marginPx}px;left:0;width:${marginPx}px;bottom:${marginPx}px;"></div>`;
    html += `<div class="sb-margin" style="top:${marginPx}px;right:0;width:${marginPx}px;bottom:${marginPx}px;"></div>`;
    html += `<div class="sb-safe-margin" style="top:${marginPx}px;left:${marginPx}px;right:${marginPx}px;height:${safeMarginTopPx}px;"></div>`;
    html += `<div class="sb-safe-margin" style="bottom:${marginPx}px;left:${marginPx}px;right:${marginPx}px;height:${safeMarginBottomPx}px;"></div>`;
    html += `<div class="sb-safe-margin" style="top:${marginPx + safeMarginTopPx}px;left:${marginPx}px;width:${safeMarginXPx}px;bottom:${marginPx + safeMarginBottomPx}px;"></div>`;
    html += `<div class="sb-safe-margin" style="top:${marginPx + safeMarginTopPx}px;right:${marginPx}px;width:${safeMarginXPx}px;bottom:${marginPx + safeMarginBottomPx}px;"></div>`;
    html += `<div class="sb-printable-border" style="top:${contentTopPx + borderInsetPx}px;left:${contentLeftPx + borderInsetPx}px;width:${Math.max(1, gridWidthPx - (2 * borderInsetPx))}px;height:${Math.max(1, printableHeightPx - (2 * borderInsetPx))}px;"></div>`;
    html += `<div class="sb-header-row" style="position:absolute;top:${contentTopPx}px;left:${contentLeftPx}px;width:${gridWidthPx}px;height:${headerHeightPx}px;">`;
    html += `<span class="sb-header-name" style="font-size:${headerFontPx}px;">Name: ________</span>`;
    html += `<span class="sb-header-decks" style="font-size:${headerDeckFontPx}px;" title="${escapeHtml(deckSummaryText)}">${escapeHtml(deckSummaryText)}</span>`;
    html += `<span class="sb-header-sheetno" style="font-size:${headerFontPx}px;">Sheet #___</span>`;
    html += '</div>';
    html += `<div class="sb-grid-area sb-grid-area-inline" style="top:${gridTopPx}px;left:${contentLeftPx}px;width:${gridWidthPx}px;height:${gridHeightPx}px;">`;

    let usedHeight = 0;
    inlineSheetRows.forEach((row, idx) => {
        const metrics = getInlineRowMetrics(row);
        const previewLineH = Math.max(1, Math.round(metrics.cellHeight * scale));
        const previewTotalH = Math.max(1, Math.round(metrics.totalHeight * scale));
        const previewCellWidth = Math.round(metrics.cellWidth * scale);
        const canFontShrink = metrics.fontScale > INLINE_MIN_FONT_SCALE;
        const testGrow = Object.assign({}, row, { fontScale: clampInlineFontScale(metrics.fontScale + INLINE_FONT_SCALE_STEP) });
        const canFontGrow = testGrow.fontScale > metrics.fontScale;
        const canRepeatGrow = true;
        html += `<div class="sb-row-wrap" data-sb-row-idx="${idx}" style="height:${previewTotalH}px;z-index:${inlineSheetRows.length - idx};">`;
        html += `<div class="sb-row-tools">
            <button type="button" class="sb-row-tool-btn" data-isb-row-font="-1" data-row-idx="${idx}" title="Smaller text (${escapeHtml(getInlineFontScaleLabel(metrics.fontScale))})" aria-label="Smaller text" ${canFontShrink ? '' : 'disabled'}>A-</button>
            <button type="button" class="sb-row-tool-btn" data-isb-row-font="1" data-row-idx="${idx}" title="Larger text (${escapeHtml(getInlineFontScaleLabel(metrics.fontScale))})" aria-label="Larger text" ${canFontGrow ? '' : 'disabled'}>A+</button>
            <button type="button" class="sb-row-tool-btn duplicate" data-isb-row-repeat="1" data-row-idx="${idx}" title="Add one more printed line in this row (${metrics.repeatCount})" aria-label="Add one more printed line in this row" ${canRepeatGrow ? '' : 'disabled'}>⊞</button>
            <button type="button" class="sb-row-tool-btn delete" data-isb-row-repeat="-1" data-row-idx="${idx}" title="${metrics.repeatCount > 1 ? `Remove one printed line from this row (${metrics.repeatCount})` : 'Remove this row'}" aria-label="${metrics.repeatCount > 1 ? 'Remove one printed line from this row' : 'Remove this row'}">⊟</button>
        </div>`;
        const rawPrompt = String(row.sampleProblem.prompt || '').replace(/\s*=\s*[?？_\s]*$/, '');
        const compactPrompt = rawPrompt.replace(/\s*([+\-×x*÷\/])\s*/g, ' $1 ').replace(/\s{2,}/g, ' ').trim();
        for (let repeatIndex = 0; repeatIndex < metrics.repeatCount; repeatIndex += 1) {
            html += `<div class="sb-row" style="height:${previewLineH}px;">`;
            for (let c = 0; c < metrics.colCount; c++) {
                html += `<div class="sb-row-cell" style="width:${previewCellWidth}px;height:${previewLineH}px;">
                    <div class="sb-row-content" style="display:flex;align-items:center;padding:0 ${Math.round(metrics.cellPad * scale)}px;">
                        <span style="font-family:'Courier New',Courier,monospace;font-size:${Math.max(6, Math.round(metrics.fontSize * scale))}px;white-space:nowrap;letter-spacing:-0.5px;">${escapeHtml(compactPrompt)} =</span>
                    </div>
                </div>`;
            }
            html += '</div>';
        }
        html += '</div>';
        usedHeight += metrics.totalHeight;
    });

    const pageLayout = getInlineSheetPageLayoutInfo(inlineSheetRows);
    const addRowPreviewHeight = Math.max(28, Math.round(48 * scale));
    if (getAvailableInlineSheetDecks().length > 0) {
        if (inlineSheetRows.length > 0 && pageLayout.remainingSafeHeightOnLastPage < INLINE_CELL_H) {
            html += `<div aria-hidden="true" style="height:${Math.max(0, Math.round(pageLayout.remainingVisibleHeightOnLastPage * scale))}px;"></div>`;
        }
        html += `<button type="button" class="sb-add-row-box" data-isb-add-row="1" style="height:${addRowPreviewHeight}px;">Click to choose a deck for a new row</button>`;
    }

    html += '</div>';
    a4El.innerHTML = html;

    const totalQuestions = inlineSheetRows.reduce((sum, row) => {
        const m = getInlineRowMetrics(row);
        return sum + (m.colCount * m.repeatCount);
    }, 0);
    const countEl = document.getElementById('inlineSheetQuestionCount');
    if (countEl) {
        if (totalQuestions <= 0) {
            countEl.textContent = '';
        } else {
            const pageCount = pageLayout.pageCount;
            countEl.textContent = pageCount > 1
                ? `${totalQuestions} questions · ${pageCount} pages`
                : `${totalQuestions} questions`;
        }
    }
}

function openInlineSheetBuilder() {
    if (mathPrintConfigDecks.length === 0) {
        showMathSheetError('No opted-in decks found.');
        return;
    }
    syncMathPaperSizeSelects();
    currentInlineSheetScale = computeSheetPreviewScale();
    inlineSheetRows = [];
    showMathSheetError('');
    const a4El = document.getElementById('inlineSheetA4');
    applyBuilderPageFrame(a4El, currentInlineSheetScale);
    renderInlineSheetBuilderContent(currentInlineSheetScale);
    closeInlineSheetPicker();
    document.getElementById('inlineSheetBuilderModal').classList.remove('hidden');
    document.body.classList.add('modal-open');
}

function closeInlineSheetBuilder() {
    closeInlineSheetPicker();
    document.getElementById('inlineSheetBuilderModal').classList.add('hidden');
    document.body.classList.remove('modal-open');
}

function openInlineSheetPicker() {
    const el = document.getElementById('inlineSheetPicker');
    const optionsEl = document.getElementById('inlineSheetPickerOptions');
    if (!el || !optionsEl) return;
    const availableDecks = getAvailableInlineSheetDecks();
    if (availableDecks.length === 0) {
        showMathSheetError('All opted-in decks are already used on this sheet.');
        optionsEl.innerHTML = '<div class="sb-add-row-box sb-empty-box">All opted-in decks are already on this sheet.</div>';
        return;
    }
    optionsEl.innerHTML = availableDecks.map((deck) => {
        const deckId = deck.shared_deck_id;
        return `<button type="button" class="sb-picker-option" data-isb-picker-deck-id="${deckId}">
            <span class="sb-picker-option-name">${escapeHtml(deck.display_name || deck.name)}</span>
        </button>`;
    }).join('');
    el.classList.remove('hidden');
}

function closeInlineSheetPicker() {
    const el = document.getElementById('inlineSheetPicker');
    if (el) el.classList.add('hidden');
}

async function handleInlineSheetDeckChoice(deckId) {
    closeInlineSheetPicker();
    try {
        const response = await fetch(`${API_BASE}/shared-decks/${deckId}/print-problems`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ count: 1 }),
        });
        const data = await response.json().catch(() => ({}));
        const sample = Array.isArray(data.problems) && data.problems[0]
            ? data.problems[0]
            : { prompt: '? + ? = ?', answer: '?' };
        const deck = mathPrintConfigDecks.find((d) => d.shared_deck_id === deckId);
        if (!deck) { showMathSheetError('Deck not found.'); return; }
        const row = {
            deckId,
            deckName: deck.display_name || deck.name,
            sampleProblem: sample,
            repeatCount: 1,
            fontScale: 1,
        };
        const nextRows = [...inlineSheetRows, row];
        showMathSheetError('');
        inlineSheetRows = nextRows;
        renderInlineSheetBuilderContent(currentInlineSheetScale);
    } catch (error) {
        showMathSheetError(error.message || 'Failed to load sample problem.');
    }
}

function updateInlineRowFontScale(idx, direction) {
    if (idx < 0 || idx >= inlineSheetRows.length) return;
    const row = inlineSheetRows[idx];
    const current = clampInlineFontScale(row.fontScale || 1);
    const next = clampInlineFontScale(current + (direction * INLINE_FONT_SCALE_STEP));
    if (next === current) return;
    const testRow = Object.assign({}, row, { fontScale: next });
    const testRows = [
        ...inlineSheetRows.slice(0, idx),
        testRow,
        ...inlineSheetRows.slice(idx + 1),
    ];
    showMathSheetError('');
    inlineSheetRows = testRows;
    renderInlineSheetBuilderContent(currentInlineSheetScale);
}

function updateInlineRowRepeat(idx, direction) {
    if (idx < 0 || idx >= inlineSheetRows.length) return;
    const row = inlineSheetRows[idx];
    const current = Math.max(1, Number.parseInt(row.repeatCount, 10) || 1);
    const next = current + direction;
    if (next < 1) {
        inlineSheetRows.splice(idx, 1);
        showMathSheetError('');
        renderInlineSheetBuilderContent(currentInlineSheetScale);
        return;
    }
    const nextRows = [
        ...inlineSheetRows.slice(0, idx),
        Object.assign({}, row, { repeatCount: next }),
        ...inlineSheetRows.slice(idx + 1),
    ];
    showMathSheetError('');
    inlineSheetRows = nextRows;
    renderInlineSheetBuilderContent(currentInlineSheetScale);
}

async function saveInlineSheetFromBuilder() {
    if (inlineSheetRows.length === 0) {
        showMathSheetError('Add at least one row before saving.');
        return;
    }
    const doneBtn = document.getElementById('inlineSheetDoneBtn');
    if (doneBtn) { doneBtn.disabled = true; doneBtn.textContent = 'Saving...'; }
    try {
        showMathSheetError('');
        const response = await fetch(buildType4ApiUrl('/math-sheets'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                layoutFormat: 'inline',
                paperSize: currentMathPaperSize,
                rows: inlineSheetRows.flatMap((row) => {
                    const metrics = getInlineRowMetrics(row);
                    const single = {
                        sharedDeckId: row.deckId,
                        scale: 1,
                        inlineCellWidth: metrics.cellWidth,
                        inlineCellHeight: metrics.cellHeight,
                        colCount: metrics.colCount,
                        inlineFontScale: metrics.fontScale,
                    };
                    return Array.from({ length: metrics.repeatCount }, () => Object.assign({}, single));
                }),
                categoryKey: activeCategoryKey,
            }),
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || `Failed to save sheet (HTTP ${response.status})`);
        closeInlineSheetBuilder();
        await loadMathSheets();
    } catch (error) {
        console.error('Error saving inline sheet:', error);
        showMathSheetError(error.message || 'Failed to save inline sheet.');
    } finally {
        if (doneBtn) { doneBtn.disabled = false; doneBtn.textContent = 'Done'; }
    }
}

function updateBuildInlineSheetButton() {
    if (!buildInlineSheetBtn) return;
    buildInlineSheetBtn.disabled = mathPrintConfigDecks.length === 0;
}

/* ── Chinese Writing Sheet Builder ── */

const buildChineseSheetBtn = document.getElementById('buildChineseSheetBtn');
const buildChineseSheetBtnMeta = document.getElementById('buildChineseSheetBtnMeta');
const chineseSheetPaperSizeSelect = document.getElementById('chineseSheetPaperSize');
let chineseSheetRows = [];       /* { cardId, character, emptyCount, scale } */
let currentChineseSheetScale = 0.5;
let chineseSheetPickerRowIndex = null;
let cwGlobalEmptyCount = 1;     /* shared default for new rows */

const CW_CELL_SIZE = 52;       /* px at scale=1 — single 田字格 square */
const CW_FONT_RATIO = 0.72;    /* character font-size as fraction of cell size */
const CW_CHINESE_FONT = "var(--font-kaiti)";
const CW_DEFAULT_EMPTY_COUNT = 1;
const CW_MIN_EMPTY_COUNT = 1;
const CW_MAX_EMPTY_COUNT = 9;
const CW_ROW_GAP = 4;          /* px gap between rows at scale=1 */
const CW_DEFAULT_SCALE = 1.3;
const CW_MIN_SCALE = 0.5;
const CW_MAX_SCALE = 2.0;
const CW_SCALE_STEP = 0.1;

function cwClampScale(s) { return Math.min(CW_MAX_SCALE, Math.max(CW_MIN_SCALE, Math.round(s * 10) / 10)); }
function cwCurrentGlobalScale() {
    return chineseSheetRows.length > 0 ? cwClampScale(chineseSheetRows[0].scale || CW_DEFAULT_SCALE) : CW_DEFAULT_SCALE;
}
function cwScaleLabel(s) { return `${Math.round(cwClampScale(s) * 100)}%`; }

function getCwScaledCellSize(row) {
    return Math.ceil(CW_CELL_SIZE * cwClampScale(row.scale || 1));
}

function getChineseSheetColCount(row) {
    const paperSpec = getMathPaperSpec();
    const cellSize = getCwScaledCellSize(row);
    return Math.max(1, Math.floor(paperSpec.safeBoxWidth / cellSize));
}

/* Each card row is exactly 1 grid line + gap */
function getChineseSheetRowHeight(row) {
    return getCwScaledCellSize(row) + CW_ROW_GAP;
}

/* Build the cell pattern for a row: repeating [demo, empty x N] filling all columns.
   If a demo char would land on the last column, show empty instead. */
function buildChineseRowCells(row) {
    const chars = [...(row.character || '')];
    if (chars.length === 0) return [];
    const empty = Math.max(CW_MIN_EMPTY_COUNT, Math.min(CW_MAX_EMPTY_COUNT, row.emptyCount ?? CW_DEFAULT_EMPTY_COUNT));
    const colCount = getChineseSheetColCount(row);
    const groupSize = 1 + empty; /* one demo + N empties */
    const cells = [];
    let charIdx = 0;
    for (let c = 0; c < colCount; c++) {
        const posInGroup = c % groupSize;
        if (posInGroup === 0) {
            /* Demo slot — but if this is the last column, show empty instead */
            if (c === colCount - 1) {
                cells.push({ type: 'empty' });
            } else {
                cells.push({ type: 'demo', char: chars[charIdx % chars.length] });
                charIdx++;
            }
        } else {
            cells.push({ type: 'empty' });
        }
    }
    return cells;
}

function getChineseSheetRowsTotalHeight(rows) {
    return rows.reduce((sum, row) => sum + getChineseSheetRowHeight(row), 0);
}

function canFitChineseSheetRows(rows) {
    return getChineseSheetRowsTotalHeight(rows) <= getMathPaperSpec().builderSafeGridHeight;
}

function getAvailableChineseCharacters(excludedRowIndex) {
    const usedCardIds = new Set();
    chineseSheetRows.forEach((row, idx) => {
        if (Number.isInteger(excludedRowIndex) && idx === excludedRowIndex) return;
        if (row.cardId) usedCardIds.add(row.cardId);
    });
    return state2Cards.filter((card) => !usedCardIds.has(card.id));
}

function updateBuildChineseSheetButton() {
    if (!buildChineseSheetBtn) return;
    const candidateCount = Array.isArray(state2Cards) ? state2Cards.length : 0;
    buildChineseSheetBtn.disabled = candidateCount === 0;
    if (buildChineseSheetBtnMeta) {
        buildChineseSheetBtnMeta.textContent = candidateCount > 0
            ? `${candidateCount} candidate character${candidateCount === 1 ? '' : 's'} available`
            : 'No candidate characters available';
    }
}

function renderChineseSheetBuilderContent(scale) {
    const a4El = document.getElementById('chineseSheetA4');
    if (!a4El) return;
    const paperSpec = getMathPaperSpec();
    const marginPx = Math.round(paperSpec.margin * scale);
    const safeMarginXPx = Math.round(paperSpec.extraSafeMarginX * scale);
    const safeMarginTopPx = Math.round(paperSpec.extraSafeMarginTop * scale);
    const safeMarginBottomPx = Math.round(paperSpec.extraSafeMarginBottom * scale);
    const gridWidthPx = Math.round(paperSpec.safeBoxWidth * scale);
    const headerHeightPx = Math.round(paperSpec.headerHeight * scale);
    const contentLeftPx = marginPx + safeMarginXPx;
    const contentTopPx = marginPx + safeMarginTopPx;
    const gridTopPx = contentTopPx + headerHeightPx;
    const gridHeightPx = Math.round(paperSpec.builderGridHeight * scale);
    const printableHeightPx = Math.round(paperSpec.safeBoxHeight * scale);
    const borderInsetPx = Math.round(PRINTABLE_AREA_DEBUG_BORDER_INSET * scale);
    const headerFontPx = Math.max(10, Math.round(12 * scale));
    let html = '';
    /* margins & border — reuse same visual frame as math builder */
    html += `<div class="sb-margin" style="top:0;left:0;right:0;height:${marginPx}px;"></div>`;
    html += `<div class="sb-margin" style="bottom:0;left:0;right:0;height:${marginPx}px;"></div>`;
    html += `<div class="sb-margin" style="top:${marginPx}px;left:0;width:${marginPx}px;bottom:${marginPx}px;"></div>`;
    html += `<div class="sb-margin" style="top:${marginPx}px;right:0;width:${marginPx}px;bottom:${marginPx}px;"></div>`;
    html += `<div class="sb-safe-margin" style="top:${marginPx}px;left:${marginPx}px;right:${marginPx}px;height:${safeMarginTopPx}px;"></div>`;
    html += `<div class="sb-safe-margin" style="bottom:${marginPx}px;left:${marginPx}px;right:${marginPx}px;height:${safeMarginBottomPx}px;"></div>`;
    html += `<div class="sb-safe-margin" style="top:${marginPx + safeMarginTopPx}px;left:${marginPx}px;width:${safeMarginXPx}px;bottom:${marginPx + safeMarginBottomPx}px;"></div>`;
    html += `<div class="sb-safe-margin" style="top:${marginPx + safeMarginTopPx}px;right:${marginPx}px;width:${safeMarginXPx}px;bottom:${marginPx + safeMarginBottomPx}px;"></div>`;
    html += `<div class="sb-printable-border" style="top:${contentTopPx + borderInsetPx}px;left:${contentLeftPx + borderInsetPx}px;width:${Math.max(1, gridWidthPx - (2 * borderInsetPx))}px;height:${Math.max(1, printableHeightPx - (2 * borderInsetPx))}px;"></div>`;
    /* header */
    html += `<div class="sb-header-row" style="position:absolute;top:${contentTopPx}px;left:${contentLeftPx}px;width:${gridWidthPx}px;height:${headerHeightPx}px;">`;
    html += `<span class="sb-header-name" style="font-size:${headerFontPx}px;">Name: ________</span>`;
    html += `<span class="sb-header-decks"></span>`;
    html += `<span class="sb-header-sheetno" style="font-size:${headerFontPx}px;">Sheet #___</span>`;
    html += '</div>';

    /* grid area */
    html += `<div class="sb-grid-area sb-grid-area-inline" style="top:${gridTopPx}px;left:${contentLeftPx}px;width:${gridWidthPx}px;height:${gridHeightPx}px;">`;

    /* Compute cell size from the global scale (all rows share same scale) */
    const globalRowScale = chineseSheetRows.length > 0 ? cwClampScale(chineseSheetRows[0].scale || 1) : CW_DEFAULT_SCALE;
    const cellSize = Math.ceil(CW_CELL_SIZE * globalRowScale);
    const cellSizePx = Math.round(cellSize * scale);
    const fontSizePx = Math.max(6, Math.round(cellSize * CW_FONT_RATIO * scale));
    const gapPx = Math.round(CW_ROW_GAP * scale);

    chineseSheetRows.forEach((row, idx) => {
        const rowHeightPx = cellSizePx + gapPx;
        const canDuplicate = canFitChineseSheetRows([
            ...chineseSheetRows.slice(0, idx + 1),
            Object.assign({}, row),
            ...chineseSheetRows.slice(idx + 1),
        ]);

        html += `<div class="sb-row-wrap" data-cwb-row-idx="${idx}" style="height:${rowHeightPx}px;z-index:${chineseSheetRows.length - idx};">`;
        html += `<div class="sb-row-tools">
            <button type="button" class="sb-row-tool-btn duplicate" data-cwb-row-duplicate="${idx}" title="Duplicate this row" aria-label="Duplicate" ${canDuplicate ? '' : 'disabled'}>⧉</button>
            <button type="button" class="sb-row-tool-btn delete" data-cwb-row-delete="1" data-row-idx="${idx}" title="Remove this card" aria-label="Remove row">x</button>
        </div>`;

        const cells = buildChineseRowCells(row);
        html += `<div class="sb-row" style="height:${cellSizePx}px;">`;
        cells.forEach((cell) => {
            html += `<div class="cw-grid-cell" style="width:${cellSizePx}px;height:${cellSizePx}px;">`;
            if (cell.type === 'demo') {
                html += `<span class="cw-grid-char cw-grid-char-first" style="font-size:${fontSizePx}px;font-family:${CW_CHINESE_FONT};">${escapeHtml(cell.char)}</span>`;
            }
            html += '</div>';
        });
        html += '</div>';
        html += '</div>';
    });

    /* add-row button */
    const remainingHeight = paperSpec.builderSafeGridHeight - getChineseSheetRowsTotalHeight(chineseSheetRows);
    const addRowPreviewHeight = Math.max(28, Math.min(Math.round(remainingHeight * scale), 70));
    if (getAvailableChineseCharacters(null).length > 0 && remainingHeight >= CW_CELL_SIZE) {
        html += `<button type="button" class="sb-add-row-box" data-cwb-add-row="1" style="height:${addRowPreviewHeight}px;">Click to choose a character for a new row</button>`;
    }

    html += '</div>';
    a4El.innerHTML = html;

    /* update character count */
    const totalChars = chineseSheetRows.length;
    const countEl = document.getElementById('chineseSheetCharCount');
    if (countEl) {
        countEl.textContent = totalChars > 0 ? `${totalChars} character${totalChars === 1 ? '' : 's'}` : '';
    }
    updateCwScaleButtons();
    updateCwEmptyCountButtons();
}

function openChineseSheetBuilder() {
    if (!Array.isArray(state2Cards) || state2Cards.length === 0) {
        showSheetError('No candidate characters available to build a sheet.');
        return;
    }
    if (chineseSheetPaperSizeSelect) chineseSheetPaperSizeSelect.value = currentMathPaperSize;
    currentChineseSheetScale = computeSheetPreviewScale();
    chineseSheetRows = [];
    showSheetError('');
    const a4El = document.getElementById('chineseSheetA4');
    applyBuilderPageFrame(a4El, currentChineseSheetScale);
    renderChineseSheetBuilderContent(currentChineseSheetScale);
    closeChineseSheetPicker();
    document.getElementById('chineseSheetBuilderModal').classList.remove('hidden');
    document.body.classList.add('modal-open');
}

function closeChineseSheetBuilder() {
    closeChineseSheetPicker();
    document.getElementById('chineseSheetBuilderModal').classList.add('hidden');
    document.body.classList.remove('modal-open');
}

function countFillPageCards() {
    const available = getAvailableChineseCharacters(null);
    let testRows = [...chineseSheetRows];
    let count = 0;
    for (const card of available) {
        const label = String(card.back || card.front || '').trim();
        if (!label) continue;
        const candidate = { cardId: card.id, character: label, emptyCount: cwGlobalEmptyCount, scale: cwCurrentGlobalScale() };
        const nextRows = [...testRows, candidate];
        if (!canFitChineseSheetRows(nextRows)) break;
        testRows = nextRows;
        count++;
    }
    return count;
}

function fillPageWithCards() {
    const available = getAvailableChineseCharacters(null);
    let added = 0;
    for (const card of available) {
        const label = String(card.back || card.front || '').trim();
        if (!label) continue;
        const candidate = { cardId: card.id, character: label, emptyCount: cwGlobalEmptyCount, scale: cwCurrentGlobalScale() };
        const nextRows = [...chineseSheetRows, candidate];
        if (!canFitChineseSheetRows(nextRows)) break;
        chineseSheetRows = nextRows;
        added++;
    }
    if (added === 0) {
        showSheetError('No more characters fit on this page.');
        return;
    }
    showSheetError('');
    closeChineseSheetPicker();
    renderChineseSheetBuilderContent(currentChineseSheetScale);
}

function renderChineseSheetPickerOptions() {
    const optionsEl = document.getElementById('chineseSheetPickerOptions');
    if (!optionsEl) return;
    const available = getAvailableChineseCharacters(chineseSheetPickerRowIndex);
    if (available.length === 0) {
        optionsEl.innerHTML = '<div class="sb-add-row-box sb-empty-box">All candidate characters are already on this sheet.</div>';
        return;
    }
    let fillBtnHtml = '';
    if (!Number.isInteger(chineseSheetPickerRowIndex)) {
        const fillCount = countFillPageCards();
        if (fillCount > 1) {
            fillBtnHtml = `<button type="button" class="sb-picker-option" data-cwb-fill-page="1" style="background:#e8f5e9;border-color:#a5d6a7;color:#2e7d32;">
                <span class="sb-picker-option-name">Fill page (top ${fillCount})</span>
                <span class="sb-picker-option-meta">Add the first ${fillCount} characters to fill the page</span>
            </button>`;
        }
    }
    optionsEl.innerHTML = fillBtnHtml + available.map((card) => {
        const label = String(card.back || card.front || '').trim();
        const reason = String(card.practicing_reason || '').trim();
        const reasonLabel = reason === 'never_seen' ? 'Newly added' : (reason === 'last_failed' ? 'Last failed' : '');
        return `<button type="button" class="sb-picker-option" data-cwb-picker-card-id="${card.id}">
            <span class="sb-picker-option-name">${escapeHtml(label)}</span>
            ${reasonLabel ? `<span class="sb-picker-option-meta">${escapeHtml(reasonLabel)}</span>` : ''}
        </button>`;
    }).join('');
}

function openChineseSheetPicker(rowIndex) {
    const pickerEl = document.getElementById('chineseSheetPicker');
    const titleEl = document.getElementById('chineseSheetPickerTitle');
    if (!pickerEl || !titleEl) return;
    chineseSheetPickerRowIndex = Number.isInteger(rowIndex) ? rowIndex : null;
    titleEl.textContent = Number.isInteger(chineseSheetPickerRowIndex) ? 'Replace Character' : 'Choose Character';
    renderChineseSheetPickerOptions();
    pickerEl.classList.remove('hidden');
    pickerEl.setAttribute('aria-hidden', 'false');
}

function closeChineseSheetPicker() {
    const pickerEl = document.getElementById('chineseSheetPicker');
    if (!pickerEl) return;
    pickerEl.classList.add('hidden');
    pickerEl.setAttribute('aria-hidden', 'true');
    chineseSheetPickerRowIndex = null;
}

function addChineseSheetRow(card) {
    const label = String(card.back || card.front || '').trim();
    if (!label) return false;
    const nextRow = { cardId: card.id, character: label, emptyCount: cwGlobalEmptyCount, scale: cwCurrentGlobalScale() };
    const nextRows = [...chineseSheetRows, nextRow];
    if (!canFitChineseSheetRows(nextRows)) {
        showSheetError('That character does not fit in the remaining printable area.');
        return false;
    }
    showSheetError('');
    chineseSheetRows = nextRows;
    renderChineseSheetBuilderContent(currentChineseSheetScale);
    return true;
}

function replaceChineseSheetRow(rowIndex, card) {
    if (!Number.isInteger(rowIndex) || rowIndex < 0 || rowIndex >= chineseSheetRows.length) return false;
    const label = String(card.back || card.front || '').trim();
    if (!label) return false;
    showSheetError('');
    chineseSheetRows[rowIndex] = Object.assign({}, chineseSheetRows[rowIndex], { cardId: card.id, character: label });
    renderChineseSheetBuilderContent(currentChineseSheetScale);
    return true;
}

function removeChineseSheetRow(rowIndex) {
    if (!Number.isInteger(rowIndex) || rowIndex < 0 || rowIndex >= chineseSheetRows.length) return;
    showSheetError('');
    chineseSheetRows.splice(rowIndex, 1);
    renderChineseSheetBuilderContent(currentChineseSheetScale);
}

function updateChineseSheetGlobalScale(direction) {
    if (chineseSheetRows.length === 0) return;
    const current = cwClampScale(chineseSheetRows[0].scale || 1);
    const next = cwClampScale(current + direction * CW_SCALE_STEP);
    if (next === current) return;
    const nextRows = chineseSheetRows.map((r) => Object.assign({}, r, { scale: next }));
    if (!canFitChineseSheetRows(nextRows)) {
        showSheetError('That size does not fit in the printable area.');
        return;
    }
    showSheetError('');
    chineseSheetRows = nextRows;
    renderChineseSheetBuilderContent(currentChineseSheetScale);
    updateCwScaleButtons();
}

function updateCwScaleButtons() {
    const minusBtn = document.getElementById('cwGlobalScaleDown');
    const plusBtn = document.getElementById('cwGlobalScaleUp');
    const labelEl = document.getElementById('cwGlobalScaleLabel');
    if (!minusBtn && !plusBtn) return;
    const current = chineseSheetRows.length > 0 ? cwClampScale(chineseSheetRows[0].scale || 1) : CW_DEFAULT_SCALE;
    const canDown = current > CW_MIN_SCALE && (chineseSheetRows.length === 0 || canFitChineseSheetRows(
        chineseSheetRows.map((r) => Object.assign({}, r, { scale: cwClampScale(current - CW_SCALE_STEP) }))
    ));
    const canUp = current < CW_MAX_SCALE && (chineseSheetRows.length === 0 || canFitChineseSheetRows(
        chineseSheetRows.map((r) => Object.assign({}, r, { scale: cwClampScale(current + CW_SCALE_STEP) }))
    ));
    if (minusBtn) minusBtn.disabled = !canDown;
    if (plusBtn) plusBtn.disabled = !canUp;
    if (labelEl) labelEl.textContent = cwScaleLabel(current);
}

function updateCwGlobalEmptyCount(direction) {
    const next = Math.max(CW_MIN_EMPTY_COUNT, Math.min(CW_MAX_EMPTY_COUNT, cwGlobalEmptyCount + direction));
    if (next === cwGlobalEmptyCount) return;
    cwGlobalEmptyCount = next;
    chineseSheetRows = chineseSheetRows.map((r) => Object.assign({}, r, { emptyCount: next }));
    renderChineseSheetBuilderContent(currentChineseSheetScale);
    updateCwEmptyCountButtons();
}

function updateCwEmptyCountButtons() {
    const minusBtn = document.getElementById('cwEmptyCountDown');
    const plusBtn = document.getElementById('cwEmptyCountUp');
    const labelEl = document.getElementById('cwEmptyCountLabel');
    if (minusBtn) minusBtn.disabled = cwGlobalEmptyCount <= CW_MIN_EMPTY_COUNT;
    if (plusBtn) plusBtn.disabled = cwGlobalEmptyCount >= CW_MAX_EMPTY_COUNT;
    if (labelEl) labelEl.textContent = String(cwGlobalEmptyCount);
}

function duplicateChineseSheetRow(rowIndex) {
    if (!Number.isInteger(rowIndex) || rowIndex < 0 || rowIndex >= chineseSheetRows.length) return;
    const clonedRow = Object.assign({}, chineseSheetRows[rowIndex]);
    const nextRows = [
        ...chineseSheetRows.slice(0, rowIndex + 1),
        clonedRow,
        ...chineseSheetRows.slice(rowIndex + 1),
    ];
    if (!canFitChineseSheetRows(nextRows)) {
        showSheetError('There is not enough space to duplicate this row.');
        return;
    }
    showSheetError('');
    chineseSheetRows = nextRows;
    renderChineseSheetBuilderContent(currentChineseSheetScale);
}

function handleChineseSheetPickerChoice(cardId) {
    const card = state2Cards.find((c) => c.id === cardId);
    if (!card) return;
    const ok = Number.isInteger(chineseSheetPickerRowIndex)
        ? replaceChineseSheetRow(chineseSheetPickerRowIndex, card)
        : addChineseSheetRow(card);
    if (ok) closeChineseSheetPicker();
}

function handleChineseSheetPaperSizeChange(nextPaperSize) {
    currentMathPaperSize = normalizeMathPaperSize(nextPaperSize);
    if (chineseSheetPaperSizeSelect) chineseSheetPaperSizeSelect.value = currentMathPaperSize;
    syncMathPaperSizeSelects();
    const modal = document.getElementById('chineseSheetBuilderModal');
    if (modal && !modal.classList.contains('hidden')) {
        currentChineseSheetScale = computeSheetPreviewScale();
        applyBuilderPageFrame(document.getElementById('chineseSheetA4'), currentChineseSheetScale);
        renderChineseSheetBuilderContent(currentChineseSheetScale);
        if (chineseSheetRows.length > 0 && !canFitChineseSheetRows(chineseSheetRows)) {
            showSheetError('Current layout no longer fits on the selected paper size.');
        }
    }
}

async function saveChineseSheetFromBuilder() {
    if (chineseSheetRows.length === 0) {
        showSheetError('Add at least one character before saving this sheet.');
        return;
    }
    const doneBtn = document.getElementById('chineseSheetDoneBtn');
    if (doneBtn) { doneBtn.disabled = true; doneBtn.textContent = 'Saving...'; }

    try {
        showSheetError('');
        const response = await fetch(buildType2ApiUrl('/chinese-print-sheets'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                rows: chineseSheetRows.map((row) => ({
                    cardId: row.cardId,
                    emptyCount: row.emptyCount ?? CW_DEFAULT_EMPTY_COUNT,
                    scale: cwClampScale(row.scale || 1),
                })),
                paperSize: currentMathPaperSize,
                categoryKey: activeCategoryKey,
            }),
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(result.error || `Failed to save sheet (HTTP ${response.status})`);
        closeChineseSheetBuilder();
        await Promise.all([loadChineseSheets(), loadSuggestedCards()]);
    } catch (error) {
        console.error('Error saving Chinese writing sheet from builder:', error);
        showSheetError(error.message || 'Failed to save writing sheet.');
    } finally {
        if (doneBtn) { doneBtn.disabled = false; doneBtn.textContent = 'Done'; }
    }
}

/* ── Init ── */

document.addEventListener('DOMContentLoaded', async () => {
    if (!kidId) { window.location.href = '/admin.html'; return; }
    syncMathPaperSizeSelects();

    /* Chinese Sheet Builder */
    if (buildChineseSheetBtn) buildChineseSheetBtn.addEventListener('click', openChineseSheetBuilder);
    document.getElementById('chineseSheetCloseBtn')?.addEventListener('click', closeChineseSheetBuilder);
    document.getElementById('cwGlobalScaleDown')?.addEventListener('click', () => updateChineseSheetGlobalScale(-1));
    document.getElementById('cwGlobalScaleUp')?.addEventListener('click', () => updateChineseSheetGlobalScale(1));
    document.getElementById('chineseSheetDoneBtn')?.addEventListener('click', saveChineseSheetFromBuilder);
    document.getElementById('chineseSheetA4')?.addEventListener('click', (e) => {
        const addBtn = e.target.closest('[data-cwb-add-row]');
        if (addBtn) { openChineseSheetPicker(null); return; }
        const duplicateBtn = e.target.closest('[data-cwb-row-duplicate]');
        if (duplicateBtn) {
            const idx = Number.parseInt(duplicateBtn.getAttribute('data-cwb-row-duplicate'), 10);
            if (Number.isInteger(idx)) duplicateChineseSheetRow(idx);
            return;
        }
        const deleteBtn = e.target.closest('[data-cwb-row-delete]');
        if (deleteBtn) {
            const idx = Number.parseInt(deleteBtn.getAttribute('data-row-idx'), 10);
            if (Number.isInteger(idx)) removeChineseSheetRow(idx);
            return;
        }
    });
    document.getElementById('chineseSheetPickerOptions')?.addEventListener('click', (event) => {
        const fillBtn = event.target.closest('[data-cwb-fill-page]');
        if (fillBtn) { fillPageWithCards(); return; }
        const optionBtn = event.target.closest('[data-cwb-picker-card-id]');
        if (!optionBtn) return;
        const cardId = Number.parseInt(optionBtn.getAttribute('data-cwb-picker-card-id'), 10);
        if (Number.isInteger(cardId)) handleChineseSheetPickerChoice(cardId);
    });
    document.getElementById('chineseSheetPickerCancelBtn')?.addEventListener('click', closeChineseSheetPicker);
    document.getElementById('chineseSheetPicker')?.addEventListener('click', (event) => {
        if (event.target === event.currentTarget) closeChineseSheetPicker();
    });
    chineseSheetPaperSizeSelect?.addEventListener('change', (event) => {
        handleChineseSheetPaperSizeChange(event.target.value);
    });
    document.getElementById('cwEmptyCountDown')?.addEventListener('click', () => updateCwGlobalEmptyCount(-1));
    document.getElementById('cwEmptyCountUp')?.addEventListener('click', () => updateCwGlobalEmptyCount(1));
    document.getElementById('chineseSheetBuilderModal')?.addEventListener('click', (event) => {
        const picker = document.getElementById('chineseSheetPicker');
        if (picker && !picker.classList.contains('hidden')) return;
        if (event.target === event.currentTarget) closeChineseSheetBuilder();
    });

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
    sheetBuilderPaperSizeSelect?.addEventListener('change', (event) => {
        handleMathPaperSizeChange(event.target.value);
    });
    inlineSheetPaperSizeSelect?.addEventListener('change', (event) => {
        handleMathPaperSizeChange(event.target.value);
    });
    window.addEventListener('resize', () => {
        const chineseModal = document.getElementById('chineseSheetBuilderModal');
        if (chineseModal && !chineseModal.classList.contains('hidden')) {
            currentChineseSheetScale = computeSheetPreviewScale();
            const a4El = document.getElementById('chineseSheetA4');
            if (a4El) {
                applyBuilderPageFrame(a4El, currentChineseSheetScale);
                renderChineseSheetBuilderContent(currentChineseSheetScale);
            }
        }
        const modal = document.getElementById('sheetBuilderModal');
        if (modal && !modal.classList.contains('hidden')) {
            currentSheetScale = computeSheetPreviewScale();
            const a4El = document.getElementById('sheetBuilderA4');
            if (a4El) {
                applyBuilderPageFrame(a4El, currentSheetScale);
                renderSheetBuilderContent(currentSheetScale);
            }
        }
        const inlineModal = document.getElementById('inlineSheetBuilderModal');
        if (inlineModal && !inlineModal.classList.contains('hidden')) {
            currentInlineSheetScale = computeSheetPreviewScale();
            const a4El = document.getElementById('inlineSheetA4');
            if (a4El) {
                applyBuilderPageFrame(a4El, currentInlineSheetScale);
                renderInlineSheetBuilderContent(currentInlineSheetScale);
            }
        }
    });
    document.addEventListener('keydown', (event) => {
        if (event.key !== 'Escape') return;
        const chinesePicker = document.getElementById('chineseSheetPicker');
        const picker = document.getElementById('sheetBuilderPicker');
        const inlinePicker = document.getElementById('inlineSheetPicker');
        const cellModal = document.getElementById('cellDesignModal');
        const chineseBuilderModal = document.getElementById('chineseSheetBuilderModal');
        const builderModal = document.getElementById('sheetBuilderModal');
        const inlineModal = document.getElementById('inlineSheetBuilderModal');
        if (chinesePicker && !chinesePicker.classList.contains('hidden')) { closeChineseSheetPicker(); return; }
        if (picker && !picker.classList.contains('hidden')) { closeSheetBuilderPicker(); return; }
        if (inlinePicker && !inlinePicker.classList.contains('hidden')) { closeInlineSheetPicker(); return; }
        if (cellModal && !cellModal.classList.contains('hidden')) { closeCellDesignModal(); return; }
        if (chineseBuilderModal && !chineseBuilderModal.classList.contains('hidden')) { closeChineseSheetBuilder(); return; }
        if (builderModal && !builderModal.classList.contains('hidden')) { closeSheetBuilder(); return; }
        if (inlineModal && !inlineModal.classList.contains('hidden')) { closeInlineSheetBuilder(); return; }
    });
    document.getElementById('cellDesignModal')?.addEventListener('click', (event) => {
        if (event.target === event.currentTarget) closeCellDesignModal();
    });
    document.getElementById('sheetBuilderModal')?.addEventListener('click', (event) => {
        const picker = document.getElementById('sheetBuilderPicker');
        if (picker && !picker.classList.contains('hidden')) return;
        if (event.target === event.currentTarget) closeSheetBuilder();
    });

    /* Inline Sheet Builder */
    if (buildInlineSheetBtn) buildInlineSheetBtn.addEventListener('click', openInlineSheetBuilder);
    document.getElementById('inlineSheetCloseBtn')?.addEventListener('click', closeInlineSheetBuilder);
    document.getElementById('inlineSheetDoneBtn')?.addEventListener('click', saveInlineSheetFromBuilder);
    document.getElementById('inlineSheetA4')?.addEventListener('click', (e) => {
        const addBtn = e.target.closest('[data-isb-add-row]');
        if (addBtn) { openInlineSheetPicker(); return; }
        const fontBtn = e.target.closest('[data-isb-row-font]');
        if (fontBtn) {
            const idx = Number.parseInt(fontBtn.getAttribute('data-row-idx'), 10);
            const dir = Number.parseInt(fontBtn.getAttribute('data-isb-row-font'), 10);
            if (Number.isInteger(idx) && Number.isInteger(dir)) updateInlineRowFontScale(idx, dir);
            return;
        }
        const repeatBtn = e.target.closest('[data-isb-row-repeat]');
        if (repeatBtn) {
            const idx = Number.parseInt(repeatBtn.getAttribute('data-row-idx'), 10);
            const dir = Number.parseInt(repeatBtn.getAttribute('data-isb-row-repeat'), 10);
            if (Number.isInteger(idx) && Number.isInteger(dir)) updateInlineRowRepeat(idx, dir);
            return;
        }
    });
    document.getElementById('inlineSheetPickerOptions')?.addEventListener('click', (event) => {
        const optionBtn = event.target.closest('[data-isb-picker-deck-id]');
        if (!optionBtn) return;
        const deckId = Number.parseInt(optionBtn.getAttribute('data-isb-picker-deck-id'), 10);
        if (Number.isInteger(deckId)) handleInlineSheetDeckChoice(deckId);
    });
    document.getElementById('inlineSheetPickerCancelBtn')?.addEventListener('click', closeInlineSheetPicker);
    document.getElementById('inlineSheetPicker')?.addEventListener('click', (event) => {
        if (event.target === event.currentTarget) closeInlineSheetPicker();
    });
    document.getElementById('inlineSheetBuilderModal')?.addEventListener('click', (event) => {
        const picker = document.getElementById('inlineSheetPicker');
        if (picker && !picker.classList.contains('hidden')) return;
        if (event.target === event.currentTarget) closeInlineSheetBuilder();
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
            updateBuildChineseSheetButton();
        }
    } catch (error) {
        console.error('Error loading worksheet manage page:', error);
        showError(error.message || 'Failed to load printable worksheets page.');
    }
});
