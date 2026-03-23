const API_BASE = `${window.location.origin}/api`;

const deckMeta = document.getElementById('deckMeta');
const deckIdText = document.getElementById('deckIdText');
const deckNameText = document.getElementById('deckNameText');
const deckTagsText = document.getElementById('deckTagsText');
const deckBehaviorText = document.getElementById('deckBehaviorText');
const deckCreatedAtText = document.getElementById('deckCreatedAtText');
const cardCountText = document.getElementById('cardCountText');
const editorSectionTitle = document.getElementById('editorSectionTitle');
const staticDeckEditor = document.getElementById('staticDeckEditor');
const type4DeckEditor = document.getElementById('type4DeckEditor');
const type4RepresentativeLabelText = document.getElementById('type4RepresentativeLabelText');
const type4IsMultichoiceOnlyInput = document.getElementById('type4IsMultichoiceOnlyInput');
const type4GeneratorCodeText = document.getElementById('type4GeneratorCodeText');
const saveType4GeneratorBtn = document.getElementById('saveType4GeneratorBtn');
const regenType4ExamplesBtn = document.getElementById('regenType4ExamplesBtn');
const type4PreviewExamples = document.getElementById('type4PreviewExamples');
const type4ValidateTestContainer = document.getElementById('type4ValidateTestContainer');
const openType4CellDesignBtn = document.getElementById('openType4CellDesignBtn');
const clearType4CellDesignBtn = document.getElementById('clearType4CellDesignBtn');
const type4CellDesignStatusText = document.getElementById('type4CellDesignStatusText');
const type4CellDesignPreview = document.getElementById('type4CellDesignPreview');
const type4CardsMultiChoiceHeader = document.getElementById('type4CardsMultiChoiceHeader');
const cardsSection = document.getElementById('cardsSection');
const tableWrap = document.getElementById('tableWrap');
const emptyState = document.getElementById('emptyState');
const cardsTableBody = document.getElementById('cardsTableBody');
const cardsInput = document.getElementById('cardsInput');
const previewCsvBtn = document.getElementById('previewCsvBtn');
const resetCsvBtn = document.getElementById('resetCsvBtn');
const applyCsvBtn = document.getElementById('applyCsvBtn');
const successMessage = document.getElementById('successMessage');
const errorMessage = document.getElementById('errorMessage');
const renameDeckTagsBtn = document.getElementById('renameDeckTagsBtn');
const cloneDeckBtn = document.getElementById('cloneDeckBtn');
const deleteDeckBtn = document.getElementById('deleteDeckBtn');
const renameTagsModal = document.getElementById('renameTagsModal');
const closeRenameTagsModalBtn = document.getElementById('closeRenameTagsModalBtn');
const cancelRenameTagsBtn = document.getElementById('cancelRenameTagsBtn');
const saveRenameTagsBtn = document.getElementById('saveRenameTagsBtn');
const renameFixedFirstTag = document.getElementById('renameFixedFirstTag');
const renameNewTagInput = document.getElementById('renameNewTagInput');
const renameAddTagBtn = document.getElementById('renameAddTagBtn');
const renameTagsContainer = document.getElementById('renameTagsContainer');
const renameDeckNamePreview = document.getElementById('renameDeckNamePreview');
const renameNameStatus = document.getElementById('renameNameStatus');
const renameTagsError = document.getElementById('renameTagsError');
const deckEditHelp = document.getElementById('deckEditHelp');
const deckCategoryCommon = window.DeckCategoryCommon;
const chineseCardBackCommon = window.ChineseCardBackCommon || null;

if (!deckCategoryCommon) {
    throw new Error('deck-category-common.js is required for deck-view');
}

let deckId = 0;
let isSuperFamily = false;
let isMutating = false;
let currentDeck = null;
let currentCards = [];
let isPreviewingCsvDiff = false;
let isRenamingTags = false;
let renameExtraTags = [];
let renameNameAvailable = null;
let renameLastNameChecked = '';
let renameNameCheckToken = 0;
let renameNameCheckTimer = null;
let currentType4SavedGeneratorCode = '';
let currentType4SavedIsMultichoiceOnly = false;
let currentType4PreviewSeedBase = Date.now();
let isLoadingType4PreviewSamples = false;
let isSavingType4Generator = false;
let type4AceEditor = null;
let lastType4PreviewAnswer = '';
let currentType4CellDesign = null;
let currentType4CellDesignSample = null;
const type4GeneratorCodeEditor = document.getElementById('type4GeneratorCodeEditor');

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

function isChineseType1Deck() {
    const behaviorType = String(currentDeck && currentDeck.behavior_type || '').trim().toLowerCase();
    return behaviorType === 'type_i' && Boolean(currentDeck && currentDeck.has_chinese_specific_logic);
}

function formatDeckCardBackHtml(rawBack) {
    if (!isChineseType1Deck()) {
        return escapeHtml(rawBack || '-');
    }
    if (chineseCardBackCommon && typeof chineseCardBackCommon.buildStackHtml === 'function') {
        return chineseCardBackCommon.buildStackHtml(rawBack, escapeHtml);
    }
    return escapeHtml(rawBack || '-');
}

document.addEventListener('DOMContentLoaded', async () => {
    const allowed = await ensureFamily();
    if (!allowed) {
        return;
    }
    const params = new URLSearchParams(window.location.search);
    deckId = Number(params.get('deckId') || 0);
    if (!Number.isInteger(deckId) || deckId <= 0) {
        showError('Invalid or missing deckId in URL.');
        return;
    }
    if (!isSuperFamily) {
        document.title = 'View Deck - Kids Daily Chores';
        const pageHeading = document.querySelector('.page-header-row h1');
        if (pageHeading) {
            pageHeading.textContent = '📖 View Deck';
        }
        if (deleteDeckBtn) { deleteDeckBtn.classList.add('hidden'); }
        if (cloneDeckBtn) { cloneDeckBtn.classList.add('hidden'); }
        if (renameDeckTagsBtn) { renameDeckTagsBtn.classList.add('hidden'); }
        if (staticDeckEditor) { staticDeckEditor.classList.add('hidden'); }
        if (type4DeckEditor) { type4DeckEditor.classList.add('hidden'); }
        if (applyCsvBtn) { applyCsvBtn.classList.add('hidden'); }
        await loadDeck();
        return;
    }
    if (previewCsvBtn) {
        previewCsvBtn.addEventListener('click', () => {
            previewCsvChanges();
        });
    }
    if (resetCsvBtn) {
        resetCsvBtn.addEventListener('click', () => {
            if (cardsInput) {
                cardsInput.value = cardsToCsv(currentCards);
                cardsInput.focus();
            }
            isPreviewingCsvDiff = false;
            renderCardsTable(currentCards, false);
            syncPreviewCsvBtnState();
            syncApplyCsvBtn();
        });
    }
    if (applyCsvBtn) {
        applyCsvBtn.addEventListener('click', () => {
            void applyCsvChanges();
        });
    }
    if (cardsInput) {
        cardsInput.addEventListener('keydown', (event) => {
            if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
                event.preventDefault();
                previewCsvChanges();
            }
        });
        cardsInput.addEventListener('input', () => {
            syncPreviewCsvBtnState();
        });
    }
    if (renameDeckTagsBtn) {
        renameDeckTagsBtn.addEventListener('click', () => {
            openRenameTagsModal();
        });
    }
    if (deleteDeckBtn) {
        deleteDeckBtn.addEventListener('click', () => {
            void deleteDeck();
        });
    }
    if (closeRenameTagsModalBtn) {
        closeRenameTagsModalBtn.addEventListener('click', closeRenameTagsModal);
    }
    if (cancelRenameTagsBtn) {
        cancelRenameTagsBtn.addEventListener('click', closeRenameTagsModal);
    }
    if (saveRenameTagsBtn) {
        saveRenameTagsBtn.addEventListener('click', async () => {
            await saveRenamedTags();
        });
    }
    if (renameAddTagBtn) {
        renameAddTagBtn.addEventListener('click', () => {
            addRenameExtraTagFromInput();
        });
    }
    if (renameNewTagInput) {
        renameNewTagInput.addEventListener('keydown', (event) => {
            if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
                event.preventDefault();
                void saveRenamedTags();
                return;
            }
            if (event.key === 'Enter') {
                event.preventDefault();
                addRenameExtraTagFromInput();
                return;
            }
            if (event.key === 'Escape') {
                event.preventDefault();
                closeRenameTagsModal();
            }
        });
    }
    if (renameTagsContainer) {
        renameTagsContainer.addEventListener('click', (event) => {
            const target = event.target.closest('button[data-remove-rename-tag]');
            if (!target) {
                return;
            }
            removeRenameExtraTag(target.getAttribute('data-remove-rename-tag'));
        });
    }
    if (renameTagsModal) {
        renameTagsModal.addEventListener('click', (event) => {
            if (event.target === renameTagsModal) {
                closeRenameTagsModal();
            }
        });
    }
    if (regenType4ExamplesBtn) {
        regenType4ExamplesBtn.addEventListener('click', async () => {
            await regenerateType4PreviewSamples();
        });
    }
    if (saveType4GeneratorBtn) {
        saveType4GeneratorBtn.addEventListener('click', async () => {
            await saveType4GeneratorCode();
        });
    }
    if (type4GeneratorCodeText) {
        type4GeneratorCodeText.addEventListener('input', () => {
            updateType4GeneratorSaveState();
        });
        type4GeneratorCodeText.addEventListener('keydown', (event) => {
            if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
                event.preventDefault();
                void saveType4GeneratorCode();
            }
        });
    }
    if (type4IsMultichoiceOnlyInput) {
        type4IsMultichoiceOnlyInput.addEventListener('change', () => {
            updateType4GeneratorSaveState();
        });
    }
    if (openType4CellDesignBtn) {
        openType4CellDesignBtn.addEventListener('click', () => {
            void openType4CellDesigner();
        });
    }
    if (clearType4CellDesignBtn) {
        clearType4CellDesignBtn.addEventListener('click', () => {
            void clearType4CellDesign();
        });
    }
    document.getElementById('cellDesignSaveBtn')?.addEventListener('click', saveType4CellDesign);
    document.getElementById('cellDesignCancelBtn')?.addEventListener('click', closeType4CellDesignModal);
    document.getElementById('cellDesignStage')?.addEventListener('click', (event) => {
        const resizeBtn = event.target.closest('[data-cell-resize]');
        if (!resizeBtn) return;
        const action = String(resizeBtn.getAttribute('data-cell-resize') || '').trim().toLowerCase();
        if (action) resizeType4CellDesignCanvas(action);
    });
    document.getElementById('cellDesignModal')?.addEventListener('click', (event) => {
        if (event.target === event.currentTarget) {
            closeType4CellDesignModal();
        }
    });
    document.addEventListener('keydown', (event) => {
        if (event.key !== 'Escape') return;
        if (!renameTagsModal?.classList.contains('hidden')) return;
        const cellDesignModal = document.getElementById('cellDesignModal');
        if (cellDesignModal && !cellDesignModal.classList.contains('hidden')) {
            closeType4CellDesignModal();
        }
    });
    initializeType4CodeEditor();
    await loadDeck();
});

function initializeType4CodeEditor() {
    if (!type4GeneratorCodeText || !type4GeneratorCodeEditor) return;
    const ace = window.ace;
    if (!ace || typeof ace.edit !== 'function') return;
    type4AceEditor = ace.edit(type4GeneratorCodeEditor);
    type4AceEditor.setTheme('ace/theme/github_light_default');
    type4AceEditor.session.setMode('ace/mode/python');
    type4AceEditor.session.setUseSoftTabs(true);
    type4AceEditor.session.setTabSize(4);
    type4AceEditor.session.setUseWrapMode(true);
    type4AceEditor.setShowPrintMargin(false);
    type4AceEditor.setHighlightActiveLine(true);
    type4AceEditor.setOption('fontFamily', 'ui-monospace, SFMono-Regular, Menlo, monospace');
    type4AceEditor.setOption('fontSize', '16px');
    type4AceEditor.setOption('wrap', true);
    type4AceEditor.setOption('showLineNumbers', true);
    type4AceEditor.setOption('useWorker', false);
    type4AceEditor.renderer.setScrollMargin(10, 10);
    type4AceEditor.setValue(String(type4GeneratorCodeText.value || ''), -1);
    type4AceEditor.clearSelection();
    type4AceEditor.session.on('change', () => {
        type4GeneratorCodeText.value = type4AceEditor.getValue();
        updateType4GeneratorSaveState();
    });
    type4GeneratorCodeText.classList.add('hidden');
    type4GeneratorCodeText.setAttribute('aria-hidden', 'true');
    type4GeneratorCodeEditor.classList.remove('hidden');
    type4GeneratorCodeEditor.setAttribute('aria-hidden', 'false');
}

async function deleteDeck() {
    if (isMutating || !currentDeck) return;
    const deckName = currentDeck.name || `Deck #${deckId}`;
    const pmc = window.PracticeManageCommon;
    if (!pmc || typeof pmc.requestWithPasswordDialog !== 'function') {
        showError('Password dialog is unavailable.');
        return;
    }
    const result = await pmc.requestWithPasswordDialog(
        `delete deck "${deckName}"`,
        (password) => fetch(`${API_BASE}/shared-decks/${deckId}`, {
            method: 'DELETE',
            headers: pmc.buildPasswordHeaders(password),
        }),
        { warningMessage: `This will permanently delete "${deckName}" and all its cards.` },
    );
    if (result.cancelled) return;
    if (!result.ok) {
        showError(result.error || 'Failed to delete deck.');
        return;
    }
    window.location.href = '/deck-manage.html';
}

async function ensureFamily() {
    try {
        const response = await fetch(`${API_BASE}/family-auth/status`);
        if (!response.ok) {
            window.location.href = '/family-login.html';
            return false;
        }
        const auth = await response.json().catch(() => ({}));
        if (!auth.authenticated) {
            window.location.href = '/family-login.html';
            return false;
        }
        isSuperFamily = Boolean(auth.isSuperFamily);
        return true;
    } catch (error) {
        window.location.href = '/family-login.html';
        return false;
    }
}

async function loadDeck() {
    showError('');
    try {
        const response = await fetch(`${API_BASE}/shared-decks/${deckId}`);
        const result = await response.json().catch(() => ({}));
        if (!response.ok) {
            throw new Error(result.error || `Failed to load deck (HTTP ${response.status})`);
        }
        renderDeck(result);
    } catch (error) {
        console.error('Error loading deck details:', error);
        showError(error.message || 'Failed to load deck details.');
    }
}

function renderDeck(payload) {
    const deck = payload && typeof payload === 'object' ? payload.deck : null;
    const cards = Array.isArray(payload && payload.cards) ? payload.cards : [];
    const cardCount = Number(payload && payload.card_count ? payload.card_count : 0);
    const generatorDefinition = payload && typeof payload === 'object' ? payload.generator_definition : null;
    currentCards = cards;
    isPreviewingCsvDiff = false;

    if (!deck) {
        showError('Deck details are unavailable.');
        return;
    }
    currentDeck = deck;
    const behaviorType = String(deck.behavior_type || '').trim().toLowerCase();
    const isTypeIV = behaviorType === 'type_iv';

    deckMeta.classList.remove('hidden');
    deckIdText.textContent = String(deck.deck_id || deckId);
    deckNameText.textContent = String(deck.name || '');
    deckTagsText.innerHTML = renderTags(
        Array.isArray(deck.tags) ? deck.tags.slice(1) : [],
        Array.isArray(deck.tag_labels) ? deck.tag_labels.slice(1) : [],
    );
    if (deckBehaviorText) {
        deckBehaviorText.textContent = formatBehaviorType(behaviorType);
    }
    deckCreatedAtText.textContent = formatIsoTimestamp(deck.created_at);
    cardCountText.textContent = String(cardCount);
    updateCloneDeckButton(deck, isTypeIV);
    if (editorSectionTitle) {
        editorSectionTitle.textContent = isTypeIV ? 'Type IV Definition' : 'Edit Cards';
    }
    if (staticDeckEditor) {
        staticDeckEditor.classList.toggle('hidden', isTypeIV);
    }
    if (!isTypeIV && cardsInput) {
        if (isChineseType1Deck()) {
            if (deckEditHelp) {
                deckEditHelp.innerHTML = 'Enter characters separated by spaces. Multi-character input like 你好 is auto-split. Backs are auto-generated.';
            }
            cardsInput.placeholder = '眼 睛 上 下';
        }
        cardsInput.value = cardsToCsv(cards);
        syncPreviewCsvBtnState();
        syncApplyCsvBtn();
    }
    if (type4DeckEditor) {
        type4DeckEditor.classList.toggle('hidden', !isTypeIV);
    }
    if (cardsSection) {
        cardsSection.classList.toggle('hidden', isTypeIV);
    }
    if (isTypeIV) {
        const representativeLabel = cards.length > 0 ? String(cards[0].front || '').trim() : '';
        currentType4SavedGeneratorCode = normalizeType4GeneratorCodeText(
            String(generatorDefinition && generatorDefinition.code ? generatorDefinition.code : '')
        );
        currentType4CellDesign = generatorDefinition && generatorDefinition.cell_design
            ? normalizeSavedType4CellDesign(generatorDefinition.cell_design)
            : null;
        if (type4RepresentativeLabelText) {
            type4RepresentativeLabelText.textContent = representativeLabel || '-';
        }
        if (type4GeneratorCodeText) {
            type4GeneratorCodeText.value = currentType4SavedGeneratorCode;
        }
        if (type4AceEditor) {
            type4AceEditor.setValue(currentType4SavedGeneratorCode, -1);
            type4AceEditor.clearSelection();
        }
        currentType4SavedIsMultichoiceOnly = Boolean(generatorDefinition && generatorDefinition.is_multichoice_only);
        if (type4IsMultichoiceOnlyInput) {
            type4IsMultichoiceOnlyInput.checked = currentType4SavedIsMultichoiceOnly;
        }
        renderType4PreviewExamples([]);
        setType4PreviewButtonState(false, 'Generate Example');
        updateType4GeneratorSaveState();
        renderType4CellDesignPanel();
    } else {
        currentType4SavedGeneratorCode = '';
        currentType4SavedIsMultichoiceOnly = false;
        currentType4CellDesign = null;
        if (type4GeneratorCodeText) {
            type4GeneratorCodeText.value = '';
        }
        if (type4IsMultichoiceOnlyInput) {
            type4IsMultichoiceOnlyInput.checked = false;
        }
        renderType4PreviewExamples([]);
        setType4PreviewButtonState(false, 'Generate Example');
        updateType4GeneratorSaveState();
        renderType4CellDesignPanel();
    }
    if (type4CardsMultiChoiceHeader) {
        type4CardsMultiChoiceHeader.classList.toggle('hidden', !isTypeIV);
    }

    renderCardsTable(cards, isTypeIV);
}

function updateCloneDeckButton(deck, isTypeIV) {
    if (!cloneDeckBtn) {
        return;
    }
    if (!isTypeIV) {
        cloneDeckBtn.classList.add('hidden');
        cloneDeckBtn.setAttribute('aria-hidden', 'true');
        return;
    }
    const firstTag = Array.isArray(deck && deck.tags)
        ? String(deck.tags[0] || '').trim().toLowerCase()
        : '';
    const params = new URLSearchParams();
    if (firstTag) {
        params.set('categoryKey', firstTag);
    }
    params.set('cloneDeckId', String(Number(deck && deck.deck_id ? deck.deck_id : deckId) || deckId));
    cloneDeckBtn.href = `/deck-create.html?${params.toString()}`;
    cloneDeckBtn.classList.remove('hidden');
    cloneDeckBtn.removeAttribute('aria-hidden');
}

function parseCardsCsvInput(rawText) {
    const lines = String(rawText || '').split(/\r\n|\r|\n/);
    const cards = [];
    const chineseMode = isChineseType1Deck();
    lines.forEach((line, index) => {
        const text = String(line || '').trim();
        if (!text) {
            return;
        }
        if (chineseMode) {
            const tokens = text.split(/\s+/);
            tokens.forEach((tok) => {
                const chars = Array.from(tok);
                chars.forEach((ch) => {
                    if (ch) cards.push({ front: ch, back: '' });
                });
            });
            return;
        }
        const commaIndex = text.indexOf(',');
        if (commaIndex <= 0 || commaIndex >= text.length - 1) {
            throw new Error(`Line ${index + 1}: expected "front,back".`);
        }
        const front = text.slice(0, commaIndex).trim();
        const back = text.slice(commaIndex + 1).trim();
        if (!front || !back) {
            throw new Error(`Line ${index + 1}: front and back must both be non-empty.`);
        }
        cards.push({ front, back });
    });
    if (cards.length === 0) {
        throw new Error(chineseMode
            ? 'No characters found. Enter characters separated by spaces.'
            : 'No cards parsed. Paste at least one "front,back" line.');
    }
    return cards;
}

function cardsToCsv(cards) {
    if (isChineseType1Deck()) {
        return cards.map((c) => String(c.front || '').trim()).join(' ');
    }
    return cards.map((c) => `${String(c.front || '').trim()},${String(c.back || '').trim()}`).join('\n');
}

function syncPreviewCsvBtnState() {
    if (!previewCsvBtn) return;
    const current = cardsToCsv(currentCards);
    const edited = String(cardsInput ? cardsInput.value : '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').trimEnd();
    previewCsvBtn.disabled = isMutating || (edited === current);
}

function syncApplyCsvBtn() {
    if (!applyCsvBtn) return;
    if (!isPreviewingCsvDiff) {
        applyCsvBtn.disabled = true;
        applyCsvBtn.textContent = 'Apply Changes';
    } else {
        applyCsvBtn.disabled = false;
        applyCsvBtn.textContent = 'Apply Changes';
    }
}

function renderCardsTable(cards, isTypeIV) {
    if (cards.length === 0) {
        cardsTableBody.innerHTML = '';
        tableWrap.classList.add('hidden');
        emptyState.classList.remove('hidden');
        return;
    }

    emptyState.classList.add('hidden');
    tableWrap.classList.remove('hidden');
    cardsTableBody.innerHTML = cards.map((card, index) => {
        const rowClass = card._diffStatus === 'added' ? ' class="diff-row-added"'
            : card._diffStatus === 'updated' ? ' class="diff-row-updated"'
            : card._diffStatus === 'removed' ? ' class="diff-row-removed"'
            : '';
        const statusLabel = card._diffStatus === 'added' ? 'New'
            : card._diffStatus === 'updated' ? 'Updated'
            : card._diffStatus === 'removed' ? 'Removed'
            : '';
        const actionHtml = isTypeIV
            ? '<span class="muted">Immutable</span>'
            : (statusLabel || `<span class="muted">&mdash;</span>`);
        const multiChoiceCellHtml = isTypeIV
            ? `<td>${currentType4SavedIsMultichoiceOnly ? 'Yes' : 'No'}</td>`
            : '';
        return `
            <tr${rowClass}>
                <td>${actionHtml}</td>
                <td>${index + 1}</td>
                <td>${renderMathHtml(card.front || '')}</td>
                ${multiChoiceCellHtml}
                <td>${formatDeckCardBackHtml(card.back || '-')}</td>
            </tr>
        `;
    }).join('');
    setMutating(isMutating);
}

function previewCsvChanges() {
    showError('');
    showSuccess('');

    let newCards;
    const rawText = String(cardsInput ? cardsInput.value : '').trim();
    if (!rawText) {
        newCards = [];
    } else {
        try {
            newCards = parseCardsCsvInput(rawText);
        } catch (error) {
            showError(error.message || 'Failed to parse cards input.');
            return;
        }
    }

    const isTypeII = String(currentDeck && currentDeck.behavior_type || '').trim().toLowerCase() === 'type_ii';
    const chineseMode = isChineseType1Deck();
    const keyField = isTypeII ? 'back' : 'front';
    const valueField = isTypeII ? 'front' : 'back';

    // Build lookup: primary key -> { front, back } for old cards
    const oldByKey = new Map();
    for (const card of currentCards) {
        const k = String(card[keyField] || '').trim();
        if (k) oldByKey.set(k, { front: String(card.front || '').trim(), back: String(card.back || '').trim() });
    }

    const diffRows = [];
    const seenKeys = new Set();

    for (const card of newCards) {
        const k = String(card[keyField] || '').trim();
        seenKeys.add(k);
        const old = oldByKey.get(k);
        if (!old) {
            diffRows.push({ front: card.front, back: card.back, _diffStatus: 'added' });
        } else if (!chineseMode && String(old[valueField] || '') !== String(card[valueField] || '')) {
            diffRows.push({ front: card.front, back: card.back, _diffStatus: 'updated' });
        } else {
            diffRows.push({ front: card.front, back: card.back, _diffStatus: '' });
        }
    }

    // Cards in old whose key is not in new => removed
    for (const card of currentCards) {
        const k = String(card[keyField] || '').trim();
        if (!seenKeys.has(k)) {
            diffRows.push({ front: card.front, back: card.back, _diffStatus: 'removed' });
        }
    }

    const addedCount = diffRows.filter((r) => r._diffStatus === 'added').length;
    const updatedCount = diffRows.filter((r) => r._diffStatus === 'updated').length;
    const removedCount = diffRows.filter((r) => r._diffStatus === 'removed').length;

    if (addedCount === 0 && updatedCount === 0 && removedCount === 0) {
        isPreviewingCsvDiff = false;
        renderCardsTable(currentCards, false);
        syncApplyCsvBtn();
        return;
    }

    isPreviewingCsvDiff = true;
    const parts = [];
    if (addedCount) parts.push(`${addedCount} to add`);
    if (updatedCount) parts.push(`${updatedCount} to update`);
    if (removedCount) parts.push(`${removedCount} to remove`);
    renderCardsTable(diffRows, false);
    if (applyCsvBtn) {
        applyCsvBtn.disabled = false;
        applyCsvBtn.textContent = `Apply: ${parts.join(', ')}`;
    }
}

async function applyCsvChanges() {
    if (isMutating || !isPreviewingCsvDiff) return;

    let newCards;
    const rawText = String(cardsInput ? cardsInput.value : '').trim();
    if (!rawText) {
        newCards = [];
    } else {
        try {
            newCards = parseCardsCsvInput(rawText);
        } catch (error) {
            showError(error.message || 'Failed to parse cards input.');
            return;
        }
    }

    showError('');
    showSuccess('');
    setMutating(true);
    try {
        const response = await fetch(`${API_BASE}/shared-decks/${deckId}/cards/replace`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ cards: newCards }),
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok) {
            throw new Error(result.error || `Failed to apply changes (HTTP ${response.status})`);
        }
        isPreviewingCsvDiff = false;
        const resultParts = [];
        if (result.added) resultParts.push(`${result.added} added`);
        if (result.updated) resultParts.push(`${result.updated} updated`);
        if (result.removed) resultParts.push(`${result.removed} removed`);
        const resultText = resultParts.length ? resultParts.join(', ') : 'Done';
        await loadDeck();
        if (applyCsvBtn) {
            applyCsvBtn.disabled = true;
            applyCsvBtn.textContent = resultText;
        }
    } catch (error) {
        showError(error.message || 'Failed to apply card changes.');
    } finally {
        setMutating(false);
    }
}

function setMutating(isBusy) {
    isMutating = Boolean(isBusy);
    syncPreviewCsvBtnState();
    if (resetCsvBtn) {
        resetCsvBtn.disabled = isMutating;
    }
    if (applyCsvBtn && isMutating) {
        applyCsvBtn.disabled = true;
    }
    if (cardsInput) {
        cardsInput.disabled = isMutating;
    }
    if (renameDeckTagsBtn) {
        renameDeckTagsBtn.disabled = isMutating || isRenamingTags;
    }
    if (saveType4GeneratorBtn) {
        saveType4GeneratorBtn.disabled = isMutating || isSavingType4Generator || !isType4GeneratorDirty();
    }
    if (regenType4ExamplesBtn) {
        regenType4ExamplesBtn.disabled = isMutating || isLoadingType4PreviewSamples || !getCurrentType4GeneratorCode();
    }
}

function setRenameBusy(isBusy) {
    isRenamingTags = Boolean(isBusy);
    if (saveRenameTagsBtn) {
        saveRenameTagsBtn.disabled = isRenamingTags;
        saveRenameTagsBtn.textContent = isRenamingTags ? 'Saving...' : 'Save Tags';
    }
    if (cancelRenameTagsBtn) {
        cancelRenameTagsBtn.disabled = isRenamingTags;
    }
    if (closeRenameTagsModalBtn) {
        closeRenameTagsModalBtn.disabled = isRenamingTags;
    }
    if (renameNewTagInput) {
        renameNewTagInput.disabled = isRenamingTags;
    }
    if (renameAddTagBtn) {
        renameAddTagBtn.disabled = isRenamingTags;
    }
    if (renameDeckTagsBtn) {
        renameDeckTagsBtn.disabled = isRenamingTags || isMutating;
    }
    if (renameTagsContainer) {
        renameTagsContainer.querySelectorAll('button[data-remove-rename-tag]').forEach((btn) => {
            btn.disabled = isRenamingTags;
        });
    }
}

function renderTags(tags, tagLabels = []) {
    if (!Array.isArray(tags) || tags.length === 0) {
        return '-';
    }
    return `<span class="deck-tags">${tags.map((tag, index) => {
        const normalizedTag = String(tag || '').trim();
        const parsed = deckCategoryCommon.parseDeckTagInput(tagLabels[index]);
        const text = parsed.tag === normalizedTag && parsed.label
            ? parsed.label
            : normalizedTag;
        return `<span class="deck-tag">${escapeHtml(text)}</span>`;
    }).join('')}</span>`;
}

function getCurrentDeckFirstTag() {
    const tags = Array.isArray(currentDeck && currentDeck.tags) ? currentDeck.tags : [];
    return String(tags[0] || '').trim().toLowerCase();
}

function getCurrentDeckTagLabelAt(index) {
    const tags = Array.isArray(currentDeck && currentDeck.tags) ? currentDeck.tags : [];
    const tagLabels = Array.isArray(currentDeck && currentDeck.tag_labels) ? currentDeck.tag_labels : [];
    const rawTag = String(tags[index] || '').trim().toLowerCase();
    const rawLabel = String(tagLabels[index] || '').trim();
    const parsed = deckCategoryCommon.parseDeckTagInput(rawLabel);
    if (rawTag && parsed.tag === rawTag && parsed.label) {
        return parsed.label;
    }
    return rawTag;
}

function getCurrentDeckSecondaryTagConfigs() {
    const tags = Array.isArray(currentDeck && currentDeck.tags) ? currentDeck.tags : [];
    const seen = new Set();
    return tags.slice(1).map((tag, index) => {
        const normalizedTag = String(tag || '').trim().toLowerCase();
        const parsed = deckCategoryCommon.parseDeckTagInput(getCurrentDeckTagLabelAt(index + 1));
        const resolvedTag = normalizedTag || parsed.tag;
        if (!resolvedTag || seen.has(resolvedTag)) {
            return null;
        }
        seen.add(resolvedTag);
        return {
            tag: resolvedTag,
            comment: parsed.tag === resolvedTag ? parsed.comment : '',
        };
    }).filter(Boolean);
}

function getCurrentDeckSecondaryTagLabels() {
    return getCurrentDeckSecondaryTagConfigs().map((item) => (
        deckCategoryCommon.formatDeckTagLabel(item.tag, item.comment)
    ));
}

function buildRenameTagPayload() {
    const firstTag = getCurrentDeckFirstTag();
    if (!firstTag) {
        throw new Error('Deck is missing its first tag.');
    }
    const seen = new Set([firstTag]);
    const tags = [firstTag];
    const extraTagLabels = [];

    renameExtraTags.forEach((item) => {
        const parsed = deckCategoryCommon.parseDeckTagInput(
            deckCategoryCommon.formatDeckTagLabel(item && item.tag, item && item.comment)
        );
        if (!parsed.tag || seen.has(parsed.tag)) {
            return;
        }
        seen.add(parsed.tag);
        tags.push(parsed.tag);
        extraTagLabels.push(parsed.label || parsed.tag);
    });

    if (tags.length < 2) {
        throw new Error('Add at least one extra tag to build a deck path.');
    }
    return {
        tags,
        extraTagLabels,
        generatedName: tags.join('_'),
    };
}

function hasEnoughRenameTags() {
    return renameExtraTags.length > 0;
}

function addRenameExtraTag(rawTag) {
    const firstTag = getCurrentDeckFirstTag();
    const parsed = deckCategoryCommon.parseDeckTagInput(rawTag);
    if (!parsed.tag) {
        throw new Error('Enter a valid tag.');
    }
    if (parsed.tag === firstTag) {
        throw new Error('The category tag is already locked.');
    }
    if (renameExtraTags.some((item) => item.tag === parsed.tag)) {
        throw new Error('That tag is already added.');
    }
    renameExtraTags.push({
        tag: parsed.tag,
        comment: parsed.comment,
    });
}

function addRenameExtraTagFromInput() {
    if (!renameNewTagInput) {
        return;
    }
    try {
        addRenameExtraTag(renameNewTagInput.value);
        renameNewTagInput.value = '';
        renderRenameExtraTags();
        updateRenameTagsPreview();
        showRenameTagsError('');
    } catch (error) {
        showRenameTagsError(error.message || 'Invalid tag.');
    }
    renameNewTagInput.focus();
}

function removeRenameExtraTag(tag) {
    renameExtraTags = renameExtraTags.filter((item) => item.tag !== String(tag || '').trim().toLowerCase());
    renderRenameExtraTags();
    updateRenameTagsPreview();
}

function renderRenameExtraTags() {
    if (!renameTagsContainer) {
        return;
    }
    if (renameExtraTags.length === 0) {
        renameTagsContainer.innerHTML = '';
        return;
    }
    renameTagsContainer.innerHTML = renameExtraTags.map((item) => {
        const label = deckCategoryCommon.formatDeckTagLabel(item.tag, item.comment);
        const tag = String(item.tag || '').trim();
        return `
            <span class="deck-tag">
                ${escapeHtml(label)}
                <button
                    type="button"
                    class="rename-tag-remove-btn"
                    data-remove-rename-tag="${escapeHtml(tag)}"
                    aria-label="Remove ${escapeHtml(label)}"
                >✕</button>
            </span>
        `;
    }).join('');
}

function isRenameConfigUnchanged(payload) {
    const currentLabels = getCurrentDeckSecondaryTagLabels();
    const nextLabels = Array.isArray(payload && payload.extraTagLabels) ? payload.extraTagLabels : [];
    if (currentLabels.length !== nextLabels.length) {
        return false;
    }
    return currentLabels.every((value, index) => value === nextLabels[index]);
}

function openRenameTagsModal() {
    if (!currentDeck || !renameTagsModal) {
        return;
    }
    renameExtraTags = getCurrentDeckSecondaryTagConfigs();
    if (renameFixedFirstTag) {
        renameFixedFirstTag.textContent = getCurrentDeckFirstTag() || '-';
    }
    if (renameNewTagInput) {
        renameNewTagInput.value = '';
    }
    renderRenameExtraTags();
    showRenameTagsError('');
    updateRenameTagsPreview();
    renameTagsModal.classList.remove('hidden');
    renameTagsModal.setAttribute('aria-hidden', 'false');
    document.body.classList.add('modal-open');
    window.setTimeout(() => {
        renameNewTagInput?.focus();
    }, 0);
}

function closeRenameTagsModal(force = false) {
    if (!renameTagsModal || (isRenamingTags && !force)) {
        return;
    }
    renameTagsModal.classList.add('hidden');
    renameTagsModal.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('modal-open');
    showRenameTagsError('');
    if (renameNameCheckTimer) {
        window.clearTimeout(renameNameCheckTimer);
        renameNameCheckTimer = null;
    }
}

function updateRenameTagsPreview() {
    if (!renameDeckNamePreview || !renameNameStatus) {
        return;
    }
    try {
        const parsed = buildRenameTagPayload();
        renameDeckNamePreview.textContent = parsed.generatedName || '(auto)';
        const unchanged = isRenameConfigUnchanged(parsed);
        if (unchanged) {
            renameNameAvailable = true;
            renameLastNameChecked = parsed.generatedName;
            setRenameNameStatus('', 'note');
        } else {
            scheduleRenameNameAvailabilityCheck();
        }
        showRenameTagsError('');
    } catch (error) {
        renameDeckNamePreview.textContent = '(invalid)';
        renameNameAvailable = false;
        renameLastNameChecked = '';
        setRenameNameStatus('Add tag.', 'note');
        showRenameTagsError('');
    }
}

function showRenameTagsError(message) {
    if (!renameTagsError) {
        return;
    }
    const text = String(message || '').trim();
    if (!text) {
        renameTagsError.textContent = '';
        renameTagsError.classList.add('hidden');
        return;
    }
    renameTagsError.textContent = text;
    renameTagsError.classList.remove('hidden');
}

function setRenameNameStatus(text, state) {
    if (!renameNameStatus) {
        return;
    }
    renameNameStatus.textContent = String(text || '').trim();
    renameNameStatus.classList.remove('ok', 'error', 'note');
    renameNameStatus.classList.add(state);
    if (saveRenameTagsBtn && !isRenamingTags) {
        saveRenameTagsBtn.disabled = state !== 'ok';
    }
}

function buildRenameNameAvailabilityQueryParams(payload) {
    const params = new URLSearchParams();
    if (payload && Array.isArray(payload.tags) && payload.tags.length > 0) {
        params.set('firstTag', payload.tags[0]);
    }
    if (payload && Array.isArray(payload.extraTagLabels)) {
        payload.extraTagLabels.forEach((label) => {
            params.append('extraTag', String(label || '').trim());
        });
    }
    if (payload && payload.generatedName) {
        params.set('name', String(payload.generatedName));
    }
    if (deckId > 0) {
        params.set('excludeDeckId', String(deckId));
    }
    return params;
}

function scheduleRenameNameAvailabilityCheck() {
    renameNameAvailable = null;
    renameLastNameChecked = '';
    if (renameNameCheckTimer) {
        window.clearTimeout(renameNameCheckTimer);
    }
    if (!hasEnoughRenameTags()) {
        setRenameNameStatus('Add tag.', 'note');
        return;
    }
    setRenameNameStatus('Checking...', 'note');
    renameNameCheckTimer = window.setTimeout(() => {
        renameNameCheckTimer = null;
        void checkRenameNameAvailability();
    }, 180);
}

async function ensureRenameNameAvailable() {
    if (!hasEnoughRenameTags()) {
        renameNameAvailable = false;
        renameLastNameChecked = '';
        setRenameNameStatus('Add tag.', 'note');
        return false;
    }
    const currentName = buildRenameTagPayload().generatedName;
    if (renameNameAvailable !== null && renameLastNameChecked === currentName) {
        return renameNameAvailable;
    }
    await checkRenameNameAvailability();
    return renameNameAvailable === true;
}

async function checkRenameNameAvailability() {
    let payload;
    try {
        payload = buildRenameTagPayload();
    } catch (error) {
        renameNameAvailable = false;
        renameLastNameChecked = '';
        setRenameNameStatus('Add tag.', 'note');
        return;
    }

    const token = ++renameNameCheckToken;
    try {
        const params = buildRenameNameAvailabilityQueryParams(payload);
        const response = await fetch(`${API_BASE}/shared-decks/name-availability?${params.toString()}`);
        const result = await response.json().catch(() => ({}));
        if (token !== renameNameCheckToken) {
            return;
        }
        if (!response.ok) {
            throw new Error(result.error || `Failed to check name (HTTP ${response.status})`);
        }
        renameNameAvailable = Boolean(result.available);
        renameLastNameChecked = payload.generatedName;
        if (renameNameAvailable) {
            setRenameNameStatus('Available', 'ok');
        } else if (result && result.conflict_type === 'tag_prefix_conflict') {
            setRenameNameStatus('Conflicts', 'error');
        } else {
            setRenameNameStatus('Taken', 'error');
        }
    } catch (error) {
        if (token !== renameNameCheckToken) {
            return;
        }
        console.error('Error checking rename name availability:', error);
        renameNameAvailable = null;
        renameLastNameChecked = '';
        setRenameNameStatus('Check failed', 'error');
    }
}

async function saveRenamedTags() {
    if (!currentDeck || isRenamingTags) {
        return;
    }
    showError('');
    showSuccess('');

    let parsed;
    try {
        parsed = buildRenameTagPayload();
    } catch (error) {
        showRenameTagsError(error.message || 'Invalid tag path.');
        return;
    }
    const available = await ensureRenameNameAvailable();
    if (!available) {
        showRenameTagsError('Deck tags are not available. Fix the tag path and try again.');
        return;
    }

    setRenameBusy(true);
    try {
        const response = await fetch(`${API_BASE}/shared-decks/${deckId}/tags`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ extraTags: parsed.extraTagLabels }),
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok) {
            throw new Error(result.error || `Failed to rename tags (HTTP ${response.status})`);
        }
        closeRenameTagsModal(true);
        showSuccess(
            `Tags updated. Synced ${Number(result.updated_deck_count || 0)} materialized deck(s) across ${Number(result.updated_kid_count || 0)} kid DB(s).`
        );
        await loadDeck();
    } catch (error) {
        console.error('Error renaming deck tags:', error);
        showRenameTagsError(error.message || 'Failed to rename deck tags.');
    } finally {
        setRenameBusy(false);
    }
}

function formatIsoTimestamp(value) {
    const text = String(value || '').trim();
    if (!text) {
        return '-';
    }
    const date = new Date(text);
    if (Number.isNaN(date.getTime())) {
        return text;
    }
    return date.toLocaleString();
}

function formatBehaviorType(value) {
    const normalized = String(value || '').trim().toLowerCase();
    if (normalized === 'type_i') {
        return 'Type I';
    }
    if (normalized === 'type_ii') {
        return 'Type II';
    }
    if (normalized === 'type_iii') {
        return 'Type III';
    }
        if (normalized === 'type_iv') {
            return 'Generator';
        }
    return normalized || '-';
}

function showError(message) {
    const text = String(message || '').trim();
    if (!text) {
        errorMessage.textContent = '';
        errorMessage.classList.add('hidden');
        return;
    }
    errorMessage.textContent = text;
    errorMessage.classList.remove('hidden');
}

function showSuccess(message) {
    const text = String(message || '').trim();
    if (!text) {
        successMessage.textContent = '';
        successMessage.classList.add('hidden');
        return;
    }
    successMessage.textContent = text;
    successMessage.classList.remove('hidden');
}

function normalizeType4GeneratorCodeText(value) {
    return String(value || '')
        .replace(/\r\n/g, '\n')
        .replace(/\r/g, '\n')
        .trim();
}

function getCurrentType4GeneratorCode() {
    return normalizeType4GeneratorCodeText(type4GeneratorCodeText ? type4GeneratorCodeText.value : '');
}

function getCurrentType4IsMultichoiceOnly() {
    return Boolean(type4IsMultichoiceOnlyInput && type4IsMultichoiceOnlyInput.checked);
}

function isType4GeneratorDirty() {
    return getCurrentType4GeneratorCode() !== currentType4SavedGeneratorCode
        || getCurrentType4IsMultichoiceOnly() !== currentType4SavedIsMultichoiceOnly;
}

function updateType4GeneratorSaveState() {
    if (saveType4GeneratorBtn) {
        saveType4GeneratorBtn.disabled = isMutating || isSavingType4Generator || !isType4GeneratorDirty();
        saveType4GeneratorBtn.textContent = isSavingType4Generator ? 'Saving...' : 'Save Generator';
    }
    if (regenType4ExamplesBtn) {
        regenType4ExamplesBtn.disabled = isMutating || isLoadingType4PreviewSamples || !getCurrentType4GeneratorCode();
    }
}

function nextType4PreviewSeedBase() {
    currentType4PreviewSeedBase += 997;
    return currentType4PreviewSeedBase;
}

function setType4PreviewButtonState(isBusy, idleLabel = 'Regen Example') {
    if (!regenType4ExamplesBtn) {
        return;
    }
    regenType4ExamplesBtn.disabled = Boolean(isBusy || isMutating || !getCurrentType4GeneratorCode());
    regenType4ExamplesBtn.textContent = isBusy ? 'Generating...' : idleLabel;
}

function renderType4PreviewExamples(samples) {
    if (!type4PreviewExamples) {
        return;
    }
    const list = Array.isArray(samples) ? samples : [];
    if (list.length === 0) {
        type4PreviewExamples.innerHTML = '<p class="muted-help-text">Click Generate Example to preview this deck.</p>';
        return;
    }
    type4PreviewExamples.innerHTML = list.map((sample, index) => {
        const prompt = String(sample && sample.prompt ? sample.prompt : '').trim();
        const answer = String(sample && sample.answer ? sample.answer : '').trim();
        const distractors = Array.isArray(sample && sample.distractors) ? sample.distractors : [];
        const distractorText = distractors.length > 0
            ? distractors.map((item) => `<code>${escapeHtml(item)}</code>`).join(', ')
            : '<span class="muted-help-text">None</span>';
        return `
            <div class="type4-preview-item">
                <div><strong>Example ${index + 1}:</strong> <code>${escapeHtml(prompt)}</code></div>
                <div><strong>Answer:</strong> <code>${escapeHtml(answer)}</code></div>
                <div><strong>Distractors:</strong> ${distractorText}</div>
            </div>
        `;
    }).join('');
}

async function fetchType4PreviewSamples(generatorCode) {
    const response = await fetch(`${API_BASE}/shared-decks/type4/preview`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            generatorCode,
            seedBase: nextType4PreviewSeedBase(),
        }),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
        throw new Error(result.error || `Failed to preview generator (HTTP ${response.status})`);
    }
    return {
        samples: Array.isArray(result && result.samples) ? result.samples : [],
        has_validate: Boolean(result && result.has_validate),
    };
}

async function regenerateType4PreviewSamples() {
    const generatorCode = getCurrentType4GeneratorCode();
    if (isLoadingType4PreviewSamples || !generatorCode) {
        return;
    }
    showError('');
    try {
        isLoadingType4PreviewSamples = true;
        setType4PreviewButtonState(true);
        const previewResult = await fetchType4PreviewSamples(generatorCode);
        renderType4PreviewExamples(previewResult.samples);
        lastType4PreviewAnswer = previewResult.samples.length > 0
            ? String(previewResult.samples[0].answer || '').trim()
            : '';
        showOrHideType4ValidateTestBox(previewResult.has_validate);
        setType4PreviewButtonState(false, 'Regen Example');
    } catch (error) {
        console.error('Error previewing type IV generator:', error);
        showError(error.message || 'Failed to generate preview examples.');
    } finally {
        isLoadingType4PreviewSamples = false;
        setType4PreviewButtonState(false, 'Regen Example');
    }
}

function showOrHideType4ValidateTestBox(hasValidate) {
    const pmc = window.PracticeManageCommon;
    if (!pmc || !type4ValidateTestContainer) return;
    pmc.showOrHideValidateTestBox(type4ValidateTestContainer, hasValidate);
    if (hasValidate) {
        pmc.renderValidateTestBox(type4ValidateTestContainer, {
            getGeneratorCode: () => getCurrentType4GeneratorCode(),
            getExpectedAnswer: () => lastType4PreviewAnswer,
        });
    }
}

async function saveType4GeneratorCode() {
    if (isSavingType4Generator || !isType4GeneratorDirty()) {
        return;
    }
    const generatorCode = getCurrentType4GeneratorCode();
    const isMultichoiceOnly = getCurrentType4IsMultichoiceOnly();
    if (!generatorCode) {
        showError('Python generator snippet is required.');
        return;
    }
    showError('');
    showSuccess('');
    try {
        isSavingType4Generator = true;
        updateType4GeneratorSaveState();
        const response = await fetch(`${API_BASE}/shared-decks/${deckId}/generator-definition`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ generatorCode, isMultichoiceOnly }),
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok) {
            throw new Error(result.error || `Failed to save generator code (HTTP ${response.status})`);
        }
        const gd = (result && result.generator_definition) || {};
        currentType4SavedGeneratorCode = normalizeType4GeneratorCodeText(gd.code || generatorCode);
        currentType4SavedIsMultichoiceOnly = Boolean(gd.is_multichoice_only);
        if (type4GeneratorCodeText) {
            type4GeneratorCodeText.value = currentType4SavedGeneratorCode;
        }
        if (type4AceEditor) {
            type4AceEditor.setValue(currentType4SavedGeneratorCode, -1);
            type4AceEditor.clearSelection();
        }
        if (type4IsMultichoiceOnlyInput) {
            type4IsMultichoiceOnlyInput.checked = currentType4SavedIsMultichoiceOnly;
        }
        updateType4GeneratorSaveState();
        showSuccess('Generator saved.');
    } catch (error) {
        console.error('Error saving type IV generator code:', error);
        showError(error.message || 'Failed to save generator settings.');
    } finally {
        isSavingType4Generator = false;
        updateType4GeneratorSaveState();
    }
}

function normalizeSavedType4CellDesign(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const cellWidth = Number.parseInt(raw.cell_width, 10);
    const cellHeight = Number.parseInt(raw.cell_height, 10);
    if (!Number.isFinite(cellWidth) || !Number.isFinite(cellHeight) || cellWidth <= 0 || cellHeight <= 0) {
        return null;
    }
    const sampleProblem = raw.sample_problem && typeof raw.sample_problem === 'object'
        ? {
            prompt: String(raw.sample_problem.prompt || ''),
            answer: String(raw.sample_problem.answer || ''),
        }
        : null;
    return {
        cellWidth,
        cellHeight,
        contentOffsetX: Number.parseInt(raw.content_offset_x, 10) || 0,
        contentOffsetY: Number.parseInt(raw.content_offset_y, 10) || 0,
        canvasVersion: Number.parseInt(raw.canvas_version, 10) || CELL_DESIGN_CANVAS_VERSION,
        sampleProblem,
    };
}

const TYPE4_CELL_OPERATOR_PATTERN = /^(.+?)\s*([+\-−–×x*÷\/])\s*(.+?)(?:\s*=\s*[?？_\s]*)?\s*$/;

function parseType4CellArithmetic(prompt) {
    const match = String(prompt || '').match(TYPE4_CELL_OPERATOR_PATTERN);
    if (!match) return null;
    const a = match[1].trim();
    const rawOp = match[2];
    const b = match[3].trim();
    if (!a || !b) return null;
    let sign = rawOp;
    if (rawOp === '-' || rawOp === '−' || rawOp === '–') sign = '−';
    if (rawOp === '*' || rawOp === 'x') sign = '×';
    if (rawOp === '/' || rawOp === '÷') sign = '÷';
    return { a, sign, b };
}

function buildType4CellVerticalRows(a, b, sign) {
    const topDigits = String(a || '');
    const bottomDigits = String(b || '');
    let gapCh = 1;
    if (sign === '×') {
        gapCh = Math.max(1, topDigits.length);
    } else if (sign === '+' || sign === '-' || sign === '−' || sign === '–') {
        gapCh = Math.max(1, topDigits.length - bottomDigits.length + 1);
    }
    return {
        topDigits,
        bottomDigits,
        sign,
        gapCh,
        rowWidthCh: 1 + gapCh + bottomDigits.length,
    };
}

function renderType4CellPrompt(problem) {
    if (!problem) return '<div class="math-cell-v-fallback"></div>';
    const parsed = parseType4CellArithmetic(problem.prompt);
    if (!parsed) {
        return `<div class="math-cell-v-fallback"><div>${renderMathHtml(problem.prompt || '')}</div></div>`;
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
    const rows = buildType4CellVerticalRows(a, b, sign);
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

function measureType4RenderedCell(html) {
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

function getType4CellDesignOffsets(cellDesign) {
    if (!cellDesign || Number(cellDesign.canvasVersion || 0) < CELL_DESIGN_CANVAS_VERSION) {
        return { x: DEFAULT_CELL_CONTENT_X, y: DEFAULT_CELL_CONTENT_Y };
    }
    return {
        x: Math.max(0, Number(cellDesign.contentOffsetX) || 0),
        y: Math.max(0, Number(cellDesign.contentOffsetY) || 0),
    };
}

function renderType4CellDesignPanel() {
    const isTypeIV = String(currentDeck && currentDeck.behavior_type || '').trim().toLowerCase() === 'type_iv';
    if (openType4CellDesignBtn) {
        openType4CellDesignBtn.classList.toggle('hidden', !isTypeIV);
        openType4CellDesignBtn.textContent = currentType4CellDesign ? 'Redesign Cell' : 'Design Cell';
    }
    if (clearType4CellDesignBtn) {
        clearType4CellDesignBtn.classList.toggle('hidden', !isTypeIV || !currentType4CellDesign);
    }
    if (!type4CellDesignStatusText || !type4CellDesignPreview) return;
    if (!isTypeIV) {
        type4CellDesignStatusText.textContent = '';
        type4CellDesignPreview.classList.add('hidden');
        type4CellDesignPreview.innerHTML = '';
        return;
    }
    if (!currentType4CellDesign) {
        type4CellDesignStatusText.textContent = 'No printable cell design saved yet.';
        type4CellDesignPreview.classList.add('hidden');
        type4CellDesignPreview.innerHTML = '';
        return;
    }
    const offsets = getType4CellDesignOffsets(currentType4CellDesign);
    const sampleProblem = currentType4CellDesign.sampleProblem || { prompt: '58 + 21 = ?', answer: '79' };
    type4CellDesignStatusText.textContent = `Saved canvas: ${currentType4CellDesign.cellWidth} x ${currentType4CellDesign.cellHeight}px`;
    type4CellDesignPreview.innerHTML = `<div class="type4-cell-design-preview-card" style="width:${currentType4CellDesign.cellWidth}px;height:${currentType4CellDesign.cellHeight}px;">
        <div class="type4-cell-design-preview-offset" style="left:${offsets.x}px;top:${offsets.y}px;">
            ${renderType4CellPrompt(sampleProblem)}
        </div>
    </div>`;
    type4CellDesignPreview.classList.remove('hidden');
}

function updateType4CellDesignDimensions() {
    const box = document.getElementById('cellDesignBox');
    const display = document.getElementById('cellDesignDimensions');
    if (!box || !display) return;
    display.textContent = `${Math.round(box.offsetWidth)} × ${Math.round(box.offsetHeight)} px`;
    updateType4CellDesignResizeButtons();
}

function getType4CellDesignMinSize() {
    const contentEl = document.getElementById('cellDesignContent');
    if (!contentEl) return { width: MIN_CELL_DESIGN_W, height: MIN_CELL_DESIGN_H };
    const offsetX = Math.max(CELL_DESIGN_MIN_LEFT_PAD, parseFloat(contentEl.style.left || '0'));
    const offsetY = Math.max(CELL_DESIGN_MIN_TOP_PAD, parseFloat(contentEl.style.top || '0'));
    return {
        width: Math.ceil(contentEl.offsetWidth + offsetX + CELL_DESIGN_MIN_RIGHT_PAD),
        height: Math.ceil(contentEl.offsetHeight + offsetY + CELL_DESIGN_MIN_BOTTOM_PAD),
    };
}

function updateType4CellDesignResizeButtons() {
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

function clampType4CellDesignBoxToWorkArea() {
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

function centerType4CellDesignBox() {
    const workAreaEl = document.getElementById('cellDesignWorkArea');
    const boxEl = document.getElementById('cellDesignBox');
    if (!workAreaEl || !boxEl) return;
    const nextLeft = Math.max(0, Math.round((workAreaEl.clientWidth - boxEl.offsetWidth) / 2));
    const nextTop = Math.max(0, Math.round((workAreaEl.clientHeight - boxEl.offsetHeight) / 2));
    boxEl.style.left = `${nextLeft}px`;
    boxEl.style.top = `${nextTop}px`;
}

function resizeType4CellDesignCanvas(action) {
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
    clampType4CellDesignBoxToWorkArea();
    updateType4CellDesignDimensions();
}

async function openType4CellDesigner() {
    if (!currentDeck || String(currentDeck.behavior_type || '').trim().toLowerCase() !== 'type_iv') {
        return;
    }
    const modal = document.getElementById('cellDesignModal');
    const boxEl = document.getElementById('cellDesignBox');
    const contentEl = document.getElementById('cellDesignContent');
    if (!modal || !boxEl || !contentEl) return;

    try {
        const response = await fetch(`${API_BASE}/shared-decks/${deckId}/print-problems`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ count: 1 }),
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
        currentType4CellDesignSample = (data.problems || [])[0] || null;
    } catch (error) {
        console.error('Failed to fetch type IV cell-design sample:', error);
        currentType4CellDesignSample = currentType4CellDesign?.sampleProblem || { prompt: '123 + 45 = ?', answer: '168' };
    }

    const savedOffsets = getType4CellDesignOffsets(currentType4CellDesign);
    const hasSavedCanvas = Boolean(currentType4CellDesign && Number(currentType4CellDesign.canvasVersion || 0) >= CELL_DESIGN_CANVAS_VERSION);
    const nextOffsetX = hasSavedCanvas
        ? Math.max(savedOffsets.x, CELL_DESIGN_MIN_LEFT_PAD)
        : Math.max(DEFAULT_CELL_CONTENT_X, CELL_DESIGN_MIN_LEFT_PAD);
    const nextOffsetY = hasSavedCanvas
        ? Math.max(savedOffsets.y, CELL_DESIGN_MIN_TOP_PAD)
        : Math.max(DEFAULT_CELL_CONTENT_Y, CELL_DESIGN_MIN_TOP_PAD);
    const naturalSize = measureType4RenderedCell(renderType4CellPrompt(currentType4CellDesignSample));
    const minRequiredWidth = naturalSize.width + Math.max(0, nextOffsetX) + CELL_DESIGN_MIN_RIGHT_PAD;
    const minRequiredHeight = naturalSize.height + Math.max(0, nextOffsetY) + CELL_DESIGN_MIN_BOTTOM_PAD;
    const nextWidth = hasSavedCanvas ? Math.max(currentType4CellDesign.cellWidth, minRequiredWidth) : minRequiredWidth;
    const nextHeight = hasSavedCanvas ? Math.max(currentType4CellDesign.cellHeight, minRequiredHeight) : minRequiredHeight;

    contentEl.innerHTML = renderType4CellPrompt(currentType4CellDesignSample);
    contentEl.style.left = `${nextOffsetX}px`;
    contentEl.style.top = `${nextOffsetY}px`;
    boxEl.style.width = `${nextWidth}px`;
    boxEl.style.height = `${nextHeight}px`;

    modal.classList.remove('hidden');
    modal.setAttribute('aria-hidden', 'false');
    document.body.classList.add('modal-open');
    centerType4CellDesignBox();
    updateType4CellDesignDimensions();
}

function closeType4CellDesignModal() {
    const modal = document.getElementById('cellDesignModal');
    if (!modal) return;
    modal.classList.add('hidden');
    modal.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('modal-open');
}

async function saveType4CellDesign() {
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
        sampleProblem: currentType4CellDesignSample ? {
            prompt: String(currentType4CellDesignSample.prompt || ''),
            answer: String(currentType4CellDesignSample.answer || ''),
        } : null,
    };

    saveBtn.disabled = true;
    const oldText = saveBtn.textContent;
    saveBtn.textContent = 'Saving...';
    showError('');
    showSuccess('');
    try {
        const response = await fetch(`${API_BASE}/shared-decks/${deckId}/print-cell-design`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ cellDesign: payload }),
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok) {
            throw new Error(result.error || `Failed to save cell design (HTTP ${response.status})`);
        }
        currentType4CellDesign = normalizeSavedType4CellDesign(result && result.cell_design) || {
            cellWidth: payload.cellWidth,
            cellHeight: payload.cellHeight,
            contentOffsetX: payload.contentOffsetX,
            contentOffsetY: payload.contentOffsetY,
            canvasVersion: payload.canvasVersion,
            sampleProblem: payload.sampleProblem,
        };
        closeType4CellDesignModal();
        renderType4CellDesignPanel();
        showSuccess('Printable cell design saved.');
    } catch (error) {
        console.error('Error saving type IV cell design:', error);
        showError(error.message || 'Failed to save printable cell design.');
    } finally {
        saveBtn.disabled = false;
        saveBtn.textContent = oldText;
    }
}

async function clearType4CellDesign() {
    if (!confirm('Clear the saved printable cell design?')) return;
    if (!clearType4CellDesignBtn) return;
    clearType4CellDesignBtn.disabled = true;
    showError('');
    showSuccess('');
    try {
        const response = await fetch(`${API_BASE}/shared-decks/${deckId}/print-cell-design`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ cellDesign: null }),
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok) {
            throw new Error(result.error || `Failed to clear cell design (HTTP ${response.status})`);
        }
        currentType4CellDesign = null;
        renderType4CellDesignPanel();
        showSuccess('Printable cell design cleared.');
    } catch (error) {
        console.error('Error clearing type IV cell design:', error);
        showError(error.message || 'Failed to clear printable cell design.');
    } finally {
        clearType4CellDesignBtn.disabled = false;
    }
}
