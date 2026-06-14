/*
 * kid-writing-sheet-manage-core.js — bootstrap + shared helpers
 *
 * Layout:
 *   1. DOM refs + module state
 *   2. Display helpers (escape, math, toasts, date parse)
 *   3. URL builders + category-key resolver
 *   4. Page text + kid info load + page mode (math vs chinese)
 *   5. pageshow refresh handler + DOMContentLoaded init wiring
 */

// =====================================================================
// === 1. DOM refs + module state
// =====================================================================

const API_BASE = `${window.location.origin}/api`;

const params = new URLSearchParams(window.location.search);
const kidId = String(params.get('id') || '').trim();
const requestedCategoryKey = String(params.get('categoryKey') || '').trim().toLowerCase();

const pageTitleEl = document.getElementById('pageTitle');
const errorMessage = document.getElementById('errorMessage');

const sheetHistorySection = document.getElementById('sheetHistorySection');
const sheetHistoryTitle = document.getElementById('sheetHistoryTitle');
const sheetHistoryNote = document.getElementById('sheetHistoryNote');
const sheetBuildHint = document.getElementById('sheetBuildHint');
const mathDeckRowsEl = document.getElementById('mathDeckRows');
const mathSheetErrorMessage = document.getElementById('mathSheetErrorMessage');

const sheetList = document.getElementById('sheetList');

const sheetErrorMessage = document.getElementById('sheetErrorMessage');

let activeCategoryKey = requestedCategoryKey;
let activeCategoryDisplayName = '';
let activeKidName = '';
let state2Cards = [];

/* 'chinese' or 'math' */
let pageMode = 'chinese';
let activeKid = null;
let mathPrintConfigDecks = [];
let mathSheetsById = new Map();
let canDesignMathCells = false;
let sheetBuildHintTimer = 0;

/* ── Shared utilities ── */

// =====================================================================
// === 2. Display helpers (escape, math, toasts, date parse)
// =====================================================================

function escapeHtml(text) {
    return String(text || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function renderMathNotation(text) {
    const raw = String(text || '');
    if (!raw) return '';
    const escaped = escapeHtml(raw);
    return escaped.replace(/\^(\([^)]+\)|\d+|[a-zA-Z])/g, (_match, exp) => {
        const inner = exp.startsWith('(') && exp.endsWith(')') ? exp.slice(1, -1) : exp;
        return `<sup>${escapeHtml(inner)}</sup>`;
    });
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

function hideSheetBuildHint() {
    if (!sheetBuildHint) return;
    window.clearTimeout(sheetBuildHintTimer);
    sheetBuildHintTimer = 0;
    sheetBuildHint.textContent = '';
    sheetBuildHint.classList.add('hidden');
}

function showSheetBuildHint(message) {
    if (!sheetBuildHint) return;
    const text = String(message || '').trim();
    if (!text) { hideSheetBuildHint(); return; }
    sheetBuildHint.textContent = text;
    sheetBuildHint.classList.remove('hidden');
    window.clearTimeout(sheetBuildHintTimer);
    sheetBuildHintTimer = window.setTimeout(hideSheetBuildHint, 3600);
}

function formatDate(value) {
    if (!value) return '-';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '-';
    return date.toLocaleString();
}

function parseTimestamp(value) {
    const parsed = new Date(value || '').getTime();
    return Number.isNaN(parsed) ? 0 : parsed;
}

// =====================================================================
// === 3. URL builders + category-key resolver
// =====================================================================

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

// =====================================================================
// === 4. Page text + kid info load + page mode (math vs chinese)
// =====================================================================

function updatePageText() {
    const modeLabel = pageMode === 'math' ? 'Math Practice' : 'Chinese Writing';
    const displayName = String(activeCategoryDisplayName || modeLabel).trim() || modeLabel;
    const kidName = String(activeKidName || '').trim();
    document.title = kidName
        ? `${kidName} - ${displayName} Sheets - The Mommy App`
        : `${displayName} Sheets - The Mommy App`;
    window.PracticeUiCommon?.applyKidPageTitle({
        titleEl: pageTitleEl?.closest('h1'),
        iconEl: pageTitleEl?.closest('h1')?.querySelector('.page-title-icon'),
        labelEl: pageTitleEl,
        kid: activeKid,
        label: `${displayName} Sheets`,
    });
}

async function loadKidInfo() {
    const response = await fetch(`${API_BASE}/kids/${encodeURIComponent(kidId)}`);
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `Failed to load kid (HTTP ${response.status})`);
    const kid = payload;
    activeKid = kid;
    activeKidName = String(kid?.name || '').trim();
    const categoryMetaMap = window.DeckCategoryCommon.getDeckCategoryMetaMap(kid);

    /* Try math (type_iv) first if the requested category is type_iv */
    const requestedMeta = categoryMetaMap?.[requestedCategoryKey] || {};
    const requestedBehavior = String(requestedMeta.behavior_type || '').trim().toLowerCase();

    if (requestedBehavior === 'type_iv') {
        const resolved = getMatchingCategoryKey(kid, 'type_iv');
        if (!resolved) throw new Error('Math subject is not opted in for this kid.');
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
}

function applyPageMode() {
    const buildChineseBtn = document.getElementById('buildChineseSheetBtn');
    const buildVerticalBtn = document.getElementById('buildSheetBtn');
    const buildInlineBtn = document.getElementById('buildInlineSheetBtn');
    if (pageMode === 'math') {
        if (sheetHistorySection) sheetHistorySection.classList.remove('hidden');
        if (sheetHistoryTitle) sheetHistoryTitle.textContent = 'Sheets';
        if (sheetHistoryNote) sheetHistoryNote.classList.add('hidden');
        buildChineseBtn?.classList.add('hidden');
        buildVerticalBtn?.classList.remove('hidden');
        buildInlineBtn?.classList.remove('hidden');
    } else {
        if (sheetHistorySection) sheetHistorySection.classList.remove('hidden');
        if (sheetHistoryTitle) sheetHistoryTitle.textContent = 'Practice Sheets';
        if (sheetHistoryNote) sheetHistoryNote.classList.add('hidden');
        buildChineseBtn?.classList.remove('hidden');
        buildVerticalBtn?.classList.add('hidden');
        buildInlineBtn?.classList.add('hidden');
    }
}

// =====================================================================
// === 5. pageshow refresh handler + DOMContentLoaded init wiring
// =====================================================================

/* ── Refresh sheets when returning via back button (bfcache) ── */

window.addEventListener('pageshow', (event) => {
    if (event.persisted) reloadSheets().catch(() => {});
});

/* ── Init ── */

document.addEventListener('DOMContentLoaded', async () => {
    if (!kidId) { window.location.href = '/admin.html'; return; }
    syncMathPaperSizeSelects();

    /* Chinese Sheet Builder */
    if (buildChineseSheetBtn) {
        buildChineseSheetBtn.addEventListener('click', () => {
            if (!Array.isArray(state2Cards) || state2Cards.length === 0) {
                showSheetBuildHint('No candidate characters available yet. Practice Chinese Writing first, then printable characters will appear here.');
                return;
            }
            hideSheetBuildHint();
            openChineseSheetBuilder();
        });
    }
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
        const optionBtn = event.target.closest('[data-cwb-picker-card-id]');
        if (!optionBtn) return;
        const cardId = Number.parseInt(optionBtn.getAttribute('data-cwb-picker-card-id'), 10);
        if (Number.isInteger(cardId)) handleChineseSheetPickerChoice(cardId);
    });
    document.getElementById('chineseSheetPickerFillBtn')?.addEventListener('click', fillPageWithCards);
    document.getElementById('chineseSheetPickerCancelBtn')?.addEventListener('click', closeChineseSheetPicker);
    chineseSheetPaperSizeSelect?.addEventListener('change', (event) => {
        handleChineseSheetPaperSizeChange(event.target.value);
    });
    document.getElementById('cwEmptyCountDown')?.addEventListener('click', () => updateCwGlobalEmptyCount(-1));
    document.getElementById('cwEmptyCountUp')?.addEventListener('click', () => updateCwGlobalEmptyCount(1));

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
        const duplicateBtn = e.target.closest('[data-isb-row-duplicate]');
        if (duplicateBtn) {
            const idx = Number.parseInt(duplicateBtn.getAttribute('data-isb-row-duplicate'), 10);
            if (Number.isInteger(idx)) duplicateInlineSheetRow(idx);
            return;
        }
        const deleteBtn = e.target.closest('[data-isb-row-delete]');
        if (deleteBtn) {
            const idx = Number.parseInt(deleteBtn.getAttribute('data-isb-row-delete'), 10);
            if (Number.isInteger(idx)) removeInlineSheetRow(idx);
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
                if (action === 'clone') {
                    if (pageMode !== 'math') return;
                    await openClonedMathSheetBuilder(sheetId);
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
