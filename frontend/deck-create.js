const API_BASE = `${window.location.origin}/api`;

const firstTagToggle = document.getElementById('firstTagToggle');
const newTagInput = document.getElementById('newTagInput');
const addTagBtn = document.getElementById('addTagBtn');
const tagsContainer = document.getElementById('tagsContainer');
const existingTagOptions = document.getElementById('existingTagOptions');
const categoryPreselectNote = document.getElementById('categoryPreselectNote');
const generatedNameEl = document.getElementById('generatedName');
const nameStatus = document.getElementById('nameStatus');
const staticCardsEditor = document.getElementById('staticCardsEditor');
const cardsCsvInput = document.getElementById('cardsCsv');
const cardsInputSectionTitle = document.getElementById('cardsInputSectionTitle');
const cardsInputHelpText = document.getElementById('cardsInputHelpText');
const type4Editor = document.getElementById('type4Editor');
const type4DisplayLabelInput = document.getElementById('type4DisplayLabelInput');
const type4IsMultichoiceOnlyInput = document.getElementById('type4IsMultichoiceOnlyInput');
const type4GeneratorCodeInput = document.getElementById('type4GeneratorCodeInput');
const type4GeneratorCodeEditor = document.getElementById('type4GeneratorCodeEditor');
const previewBtn = document.getElementById('previewBtn');
const clearCsvBtn = document.getElementById('clearCsvBtn');
const reviewSection = document.getElementById('reviewSection');
const reviewMeta = document.getElementById('reviewMeta');
const dedupeSummary = document.getElementById('dedupeSummary');
const reviewTableWrap = document.getElementById('reviewTableWrap');
const reviewTableBody = document.getElementById('reviewTableBody');
const type4ReviewBox = document.getElementById('type4ReviewBox');
const type4ReviewLabel = document.getElementById('type4ReviewLabel');
const type4ReviewIsMultichoiceOnly = document.getElementById('type4ReviewIsMultichoiceOnly');
const type4ReviewCode = document.getElementById('type4ReviewCode');
const type4ReviewExamples = document.getElementById('type4ReviewExamples');
const regenType4ExamplesBtn = document.getElementById('regenType4ExamplesBtn');
const createDeckBtn = document.getElementById('createDeckBtn');
const successMessage = document.getElementById('successMessage');
const errorMessage = document.getElementById('errorMessage');
const deckCategoryCommon = window.DeckCategoryCommon;
const deckCreateCommon = window.DeckCreateCommon;
if (!deckCategoryCommon) {
    throw new Error('deck-category-common.js is required for deck-create');
}
if (!deckCreateCommon) {
    throw new Error('deck-create-common.js is required for deck-create');
}

const normalizeTag = deckCreateCommon.normalizeTag;
const parseTagInput = deckCreateCommon.parseTagInput;
const formatTagPayload = deckCreateCommon.formatTagPayload;
const showError = (message) => deckCreateCommon.showMessage(errorMessage, message);
const showSuccess = (message) => deckCreateCommon.showMessage(successMessage, message);
const DEFAULT_TYPE4_GENERATOR_CODE = `def generate(rng):
    a = rng.randint(10, 99)
    b = rng.randint(10, 99)
    answer = str(a + b)
    return {
        "prompt": f"{a} + {b}",
        "answer": answer,
        "distractors": [str(a + b - 1), str(a + b + 1)],
    }`;

let extraTags = [];
let previewCards = [];
let previewRows = [];
let previewType4Definition = null;
let isCreatingDeck = false;
let nameAvailable = null;
let lastNameChecked = '';
let nameCheckToken = 0;
let nameCheckTimer = null;
let previewDiagnostics = { totalRows: 0, dedupWithinDeck: [], dedupeKey: 'front' };
let currentFirstTag = '';
let autocompleteTagPaths = [];
let deckCountByCategoryKey = {};
let deckCategories = [];
let deckCategoryKeySet = new Set();
let reservedFirstTags = new Set();
let type4AceEditor = null;
let type4PreviewSeedBase = Date.now();
let isRegeneratingType4Examples = false;
const createUrlParams = new URLSearchParams(window.location.search);
let lockedFirstTagFromQuery = normalizeTag(createUrlParams.get('categoryKey'));
const cloneDeckIdFromQuery = Number(createUrlParams.get('cloneDeckId') || 0);

document.addEventListener('DOMContentLoaded', async () => {
    initializeType4CodeEditor();
    const allowed = await deckCreateCommon.ensureSuperFamily(API_BASE);
    if (!allowed) {
        return;
    }
    const categoriesLoaded = await loadDeckCategories();
    if (!categoriesLoaded) {
        return;
    }
    renderTags();
    renderFirstTagToggle();
    updateCardsInputModeUi();
    updateGeneratedName();
    void loadAutocompleteTags();
    updateAutocompleteSuggestions();
    await maybeLoadCloneDeck();
    bindType4PreviewInvalidation();
});

if (firstTagToggle) {
    firstTagToggle.addEventListener('click', (event) => {
        if (lockedFirstTagFromQuery) {
            return;
        }
        const target = event.target.closest('[data-first-tag]');
        if (!target) {
            return;
        }
        event.preventDefault();
        setCurrentFirstTag(target.getAttribute('data-first-tag'));
    });
}

addTagBtn.addEventListener('click', () => {
    addExtraTagFromInput();
});

newTagInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
        event.preventDefault();
        addExtraTagFromInput();
    }
});

previewBtn.addEventListener('click', async () => {
    await previewDeckFromCsv();
});

clearCsvBtn.addEventListener('click', () => {
    if (isTypeIVDeckMode()) {
        invalidateType4Preview();
        setType4GeneratorCodeValue(DEFAULT_TYPE4_GENERATOR_CODE);
        if (type4DisplayLabelInput) {
            type4DisplayLabelInput.value = '';
            type4DisplayLabelInput.focus();
        }
        if (type4IsMultichoiceOnlyInput) {
            type4IsMultichoiceOnlyInput.checked = false;
        }
        return;
    }
    cardsCsvInput.value = '';
    cardsCsvInput.focus();
});

createDeckBtn.addEventListener('click', async () => {
    await createDeck();
});

if (regenType4ExamplesBtn) {
    regenType4ExamplesBtn.addEventListener('click', async () => {
        await regenerateType4Examples();
    });
}

function getCurrentDeckCategory() {
    return deckCreateCommon.getCurrentDeckCategory(currentFirstTag, deckCategories);
}

function isChineseCharactersDeckMode() {
    return deckCreateCommon.isChineseCharactersDeckMode(getCurrentDeckCategory());
}

function isChineseWritingDeckMode() {
    return deckCreateCommon.isChineseWritingDeckMode(getCurrentDeckCategory());
}

function isTypeIIDeckMode() {
    return deckCreateCommon.isTypeIIDeckMode(getCurrentDeckCategory());
}

function isTypeIVDeckMode() {
    return deckCreateCommon.isTypeIVDeckMode(getCurrentDeckCategory());
}

function getType4GeneratorCodeValue() {
    if (type4AceEditor && typeof type4AceEditor.getValue === 'function') {
        const nextValue = String(type4AceEditor.getValue() || '');
        if (type4GeneratorCodeInput) {
            type4GeneratorCodeInput.value = nextValue;
        }
        return nextValue;
    }
    return String(type4GeneratorCodeInput ? type4GeneratorCodeInput.value : '');
}

function setType4GeneratorCodeValue(value) {
    const nextValue = String(value || '');
    if (type4GeneratorCodeInput) {
        type4GeneratorCodeInput.value = nextValue;
    }
    if (type4AceEditor && typeof type4AceEditor.setValue === 'function' && type4AceEditor.getValue() !== nextValue) {
        type4AceEditor.setValue(nextValue, -1);
        type4AceEditor.clearSelection();
    }
}

function nextType4PreviewSeedBase() {
    type4PreviewSeedBase += 997;
    return type4PreviewSeedBase;
}

function bindType4PreviewInvalidation() {
    if (type4DisplayLabelInput) {
        type4DisplayLabelInput.addEventListener('input', () => {
            invalidateType4Preview();
        });
    }
    if (type4IsMultichoiceOnlyInput) {
        type4IsMultichoiceOnlyInput.addEventListener('change', () => {
            invalidateType4Preview();
        });
    }
    if (type4GeneratorCodeInput) {
        type4GeneratorCodeInput.addEventListener('input', () => {
            invalidateType4Preview();
        });
    }
}

function invalidateType4Preview() {
    if (!previewType4Definition) {
        return;
    }
    previewType4Definition = null;
    reviewSection.classList.add('hidden');
}

function initializeType4CodeEditor() {
    if (!type4GeneratorCodeInput || !type4GeneratorCodeEditor) {
        return;
    }
    const ace = window.ace;
    if (!ace || typeof ace.edit !== 'function') {
        return;
    }
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
    type4AceEditor.setValue(String(type4GeneratorCodeInput.value || ''), -1);
    type4AceEditor.clearSelection();
    type4AceEditor.session.on('change', () => {
        type4GeneratorCodeInput.value = type4AceEditor.getValue();
        invalidateType4Preview();
    });
    type4GeneratorCodeInput.classList.add('hidden');
    type4GeneratorCodeInput.setAttribute('aria-hidden', 'true');
    type4GeneratorCodeEditor.classList.remove('hidden');
    type4GeneratorCodeEditor.setAttribute('aria-hidden', 'false');
}

function setRegenType4ExamplesButtonState(isBusy) {
    if (!regenType4ExamplesBtn) {
        return;
    }
    regenType4ExamplesBtn.disabled = Boolean(isBusy);
    regenType4ExamplesBtn.textContent = isBusy ? 'Regenerating...' : 'Regen 3 Examples';
}

function setControlsDisabled(disabled) {
    deckCreateCommon.setControlsDisabled(disabled, {
        newTagInput: { element: newTagInput },
        addTagBtn: { element: addTagBtn },
        cardsCsvInput: { element: cardsCsvInput },
        type4DisplayLabelInput: { element: type4DisplayLabelInput },
        type4IsMultichoiceOnlyInput: { element: type4IsMultichoiceOnlyInput },
        type4GeneratorCodeInput: { element: type4GeneratorCodeInput },
        previewBtn: { element: previewBtn },
        clearCsvBtn: { element: clearCsvBtn },
        regenType4ExamplesBtn: { element: regenType4ExamplesBtn, busyGuard: () => isRegeneratingType4Examples },
        createDeckBtn: { element: createDeckBtn, busyGuard: () => isCreatingDeck },
    });
    if (type4AceEditor && typeof type4AceEditor.setReadOnly === 'function') {
        type4AceEditor.setReadOnly(Boolean(disabled));
    }
}

async function loadDeckCategories() {
    showError('');
    try {
        const loaded = await deckCreateCommon.loadDeckCategories({
            apiBase: API_BASE,
            selectedCategoryKey: lockedFirstTagFromQuery || currentFirstTag,
            includeReservedFirstTags: true,
        });
        deckCategories = loaded.categories;
        deckCategoryKeySet = loaded.categoryKeySet;
        reservedFirstTags = loaded.reservedFirstTags;
        currentFirstTag = loaded.selectedCategoryKey;
        if (lockedFirstTagFromQuery && currentFirstTag !== lockedFirstTagFromQuery) {
            lockedFirstTagFromQuery = '';
        }
        setControlsDisabled(false);
        return true;
    } catch (error) {
        console.error('Error loading deck categories:', error);
        deckCategories = [];
        deckCategoryKeySet = new Set();
        reservedFirstTags = new Set();
        currentFirstTag = '';
        if (firstTagToggle) {
            firstTagToggle.innerHTML = '<span class="settings-note">No categories available.</span>';
        }
        setNameStatus('Deck categories unavailable.', 'error');
        setControlsDisabled(true);
        showError(error.message || 'Failed to load deck categories.');
        return false;
    }
}

function renderFirstTagToggle() {
    if (!firstTagToggle) {
        return;
    }
    deckCreateCommon.renderFirstTagToggle({
        containerEl: firstTagToggle,
        categories: deckCategories,
        selectedCategoryKey: currentFirstTag,
        getDeckCount: (categoryKey) => deckCreateCommon.getDeckCountForCategory(categoryKey, deckCountByCategoryKey),
    });
    applyFirstTagLockMode();
}

function applyFirstTagLockMode() {
    if (!firstTagToggle) {
        return;
    }
    const isLocked = Boolean(lockedFirstTagFromQuery && currentFirstTag === lockedFirstTagFromQuery);
    firstTagToggle.classList.toggle('category-locked', isLocked);
    const options = firstTagToggle.querySelectorAll('.first-tag-option');
    options.forEach((button) => {
        const optionKey = normalizeTag(button.getAttribute('data-first-tag'));
        const isActive = optionKey === currentFirstTag;
        button.classList.toggle('lock-hidden', isLocked && !isActive);
        button.disabled = Boolean(isLocked && isActive);
        button.setAttribute('aria-disabled', button.disabled ? 'true' : 'false');
    });
    if (categoryPreselectNote) {
        if (isLocked) {
            categoryPreselectNote.textContent = 'Category preselected from Manage Decks.';
            categoryPreselectNote.classList.remove('hidden');
        } else {
            categoryPreselectNote.textContent = '';
            categoryPreselectNote.classList.add('hidden');
        }
    }
}

function setCurrentFirstTag(tag) {
    if (lockedFirstTagFromQuery) {
        return;
    }
    const next = deckCreateCommon.normalizeNextFirstTag(tag, currentFirstTag, deckCategoryKeySet);
    if (!next) {
        return;
    }
    currentFirstTag = next;
    extraTags = extraTags.filter((item) => item.tag !== currentFirstTag);
    previewCards = [];
    previewRows = [];
    previewType4Definition = null;
    reviewSection.classList.add('hidden');
    renderTags();
    renderFirstTagToggle();
    updateCardsInputModeUi();
    updateGeneratedName();
    updateAutocompleteSuggestions();
}

async function maybeLoadCloneDeck() {
    if (!Number.isInteger(cloneDeckIdFromQuery) || cloneDeckIdFromQuery <= 0) {
        return;
    }
    try {
        const response = await fetch(`${API_BASE}/shared-decks/${cloneDeckIdFromQuery}`);
        const result = await response.json().catch(() => ({}));
        if (!response.ok) {
            throw new Error(result.error || `Failed to load source deck (HTTP ${response.status})`);
        }
        applyClonedDeck(result);
    } catch (error) {
        console.error('Error loading clone source deck:', error);
        showError(error.message || 'Failed to load clone source deck.');
    }
}

function applyClonedDeck(payload) {
    const deck = payload && typeof payload === 'object' ? payload.deck : null;
    const cards = Array.isArray(payload && payload.cards) ? payload.cards : [];
    const generatorDefinition = payload && typeof payload === 'object' ? payload.generator_definition : null;
    if (!deck) {
        throw new Error('Clone source deck is unavailable.');
    }

    const behaviorType = String(deck.behavior_type || '').trim().toLowerCase();
    if (behaviorType !== 'type_iv') {
        throw new Error('Only type IV decks can be cloned from this screen.');
    }

    const tags = Array.isArray(deck.tags) ? deck.tags : [];
    const tagLabels = Array.isArray(deck.tag_labels) ? deck.tag_labels : [];
    const firstTag = normalizeTag(tags[0]);
    if (!firstTag) {
        throw new Error('Clone source deck is missing its category tag.');
    }
    currentFirstTag = firstTag;
    if (!lockedFirstTagFromQuery) {
        lockedFirstTagFromQuery = firstTag;
    }
    extraTags = extractCloneExtraTags(tags, tagLabels);
    previewCards = [];
    previewRows = [];
    previewDiagnostics = { totalRows: 0, dedupWithinDeck: [], dedupeKey: 'front' };
    previewType4Definition = null;
    reviewSection.classList.add('hidden');

    renderFirstTagToggle();
    renderTags();
    updateCardsInputModeUi();
    updateGeneratedName();
    updateAutocompleteSuggestions();

    if (type4DisplayLabelInput) {
        type4DisplayLabelInput.value = String(cards[0] && cards[0].front ? cards[0].front : '').trim();
    }
    if (type4IsMultichoiceOnlyInput) {
        type4IsMultichoiceOnlyInput.checked = Boolean(
            generatorDefinition && generatorDefinition.is_multichoice_only
        );
    }
    setType4GeneratorCodeValue(
        String(generatorDefinition && generatorDefinition.code ? generatorDefinition.code : '')
    );
}

function extractCloneExtraTags(tags, tagLabels) {
    const seen = new Set();
    return (Array.isArray(tags) ? tags : [])
        .slice(1)
        .map((rawTag, index) => {
            const normalizedTag = normalizeTag(rawTag);
            if (!normalizedTag || seen.has(normalizedTag)) {
                return null;
            }
            const parsed = parseTagInput(tagLabels[index + 1] || rawTag);
            seen.add(normalizedTag);
            return {
                tag: normalizedTag,
                comment: parsed.tag === normalizedTag ? parsed.comment : '',
            };
        })
        .filter(Boolean);
}

function getAllTags() {
    return [currentFirstTag, ...extraTags.map((item) => item.tag)].filter(Boolean);
}

function getGeneratedName() {
    return getAllTags().join('_');
}

function hasEnoughTagsForDeck() {
    return getAllTags().length >= 2;
}

function buildNameAvailabilityQueryParams() {
    const tags = getAllTags();
    const params = new URLSearchParams();
    if (tags.length >= 2) {
        params.set('firstTag', tags[0]);
        tags.slice(1).forEach((tag) => {
            params.append('extraTag', tag);
        });
    }
    const name = tags.join('_');
    if (name) {
        params.set('name', name);
    }
    return params;
}

function updateGeneratedName() {
    const name = getGeneratedName();
    generatedNameEl.textContent = name || '(auto)';
    scheduleNameAvailabilityCheck();
}

function updateCardsInputModeUi() {
    if (!cardsCsvInput || !staticCardsEditor || !type4Editor) {
        return;
    }
    const useTypeIV = isTypeIVDeckMode();
    staticCardsEditor.classList.toggle('hidden', useTypeIV);
    type4Editor.classList.toggle('hidden', !useTypeIV);
    if (previewBtn) {
        previewBtn.textContent = useTypeIV ? 'Review Deck' : 'Preview Deck';
    }
    if (clearCsvBtn) {
        clearCsvBtn.textContent = useTypeIV ? 'Clear Fields' : 'Clear';
    }
    if (useTypeIV) {
        if (cardsInputSectionTitle) {
            cardsInputSectionTitle.textContent = '2) Define Generator Deck';
        }
        return;
    }
    if (isChineseCharactersDeckMode()) {
        if (cardsInputSectionTitle) {
            cardsInputSectionTitle.textContent = '2) Paste Chinese Text';
        }
        if (cardsInputHelpText) {
            cardsInputHelpText.innerHTML = 'Paste Chinese text. The system will tokenize into individual Chinese characters as <code>front</code> and auto-generate pinyin as <code>back</code>.';
        }
        cardsCsvInput.placeholder = '比如：春眠不觉晓，处处闻啼鸟。';
        return;
    }
    if (isChineseWritingDeckMode()) {
        if (cardsInputSectionTitle) {
            cardsInputSectionTitle.textContent = '2) Paste Cards CSV';
        }
        if (cardsInputHelpText) {
            cardsInputHelpText.innerHTML = 'Format: one card per line as <code>front,back</code>. Spaces around <code>front</code>/<code>back</code> are automatically trimmed. For type_ii categories, dedup is keyed by <code>back</code>.';
        }
        cardsCsvInput.placeholder = '听写提示,汉字答案';
        return;
    }
    if (isTypeIIDeckMode()) {
        if (cardsInputSectionTitle) {
            cardsInputSectionTitle.textContent = '2) Paste Cards CSV';
        }
        if (cardsInputHelpText) {
            cardsInputHelpText.innerHTML = 'Format: one card per line as <code>front,back</code>. Spaces around <code>front</code>/<code>back</code> are automatically trimmed. For type_ii categories, dedup is keyed by <code>back</code>.';
        }
        cardsCsvInput.placeholder = 'Prompt text,Answer text';
        return;
    }
    if (cardsInputSectionTitle) {
        cardsInputSectionTitle.textContent = '2) Paste Cards CSV';
    }
    if (cardsInputHelpText) {
        cardsInputHelpText.innerHTML = 'Format: one card per line as <code>front,back</code>. Spaces around <code>front</code>/<code>back</code> are automatically trimmed.';
    }
    cardsCsvInput.placeholder = '1+1,2\n2+3,5';
}

function addExtraTag(rawTag) {
    const parsed = parseTagInput(rawTag);
    const nextTag = parsed.tag;
    if (!nextTag) {
        return false;
    }
    if (nextTag === currentFirstTag || extraTags.some((item) => item.tag === nextTag)) {
        return false;
    }
    extraTags.push({
        tag: nextTag,
        comment: parsed.comment,
    });
    return true;
}

function addExtraTagFromInput() {
    addExtraTag(newTagInput.value);
    newTagInput.value = '';
    renderTags();
    updateGeneratedName();
    updateAutocompleteSuggestions();
}

function removeExtraTag(tag) {
    extraTags = extraTags.filter((item) => item.tag !== tag);
    renderTags();
    updateGeneratedName();
    updateAutocompleteSuggestions();
}

function renderTags() {
    if (extraTags.length === 0) {
        tagsContainer.innerHTML = '<span class="settings-note">No additional tags yet.</span>';
        return;
    }
    tagsContainer.innerHTML = extraTags.map((item) => {
        const tag = String(item && item.tag ? item.tag : '').trim();
        return `<span class="deck-tag">${escapeHtml(tag)} <button type="button" data-tag="${escapeHtml(tag)}" aria-label="Remove ${escapeHtml(tag)}">✕</button></span>`;
    }).join('');
    tagsContainer.querySelectorAll('button[data-tag]').forEach((btn) => {
        btn.addEventListener('click', () => {
            removeExtraTag(btn.getAttribute('data-tag'));
        });
    });
}

function parseCsvRowsWithLineInfo(text) {
    const rows = [];
    let fields = [];
    let field = '';
    let inQuotes = false;
    let currentLine = 1;
    let rowStartLine = 1;
    let index = 0;

    while (index < text.length) {
        let ch = text[index];

        if (ch === '\r') {
            if (text[index + 1] === '\n') {
                index += 1;
            }
            ch = '\n';
        }

        if (inQuotes) {
            if (ch === '"') {
                if (text[index + 1] === '"') {
                    field += '"';
                    index += 1;
                } else {
                    inQuotes = false;
                }
            } else {
                field += ch;
                if (ch === '\n') {
                    currentLine += 1;
                }
            }
        } else if (ch === '"') {
            inQuotes = true;
        } else if (ch === ',') {
            fields.push(field);
            field = '';
        } else if (ch === '\n') {
            fields.push(field);
            rows.push({ line: rowStartLine, fields });
            fields = [];
            field = '';
            currentLine += 1;
            rowStartLine = currentLine;
        } else {
            field += ch;
        }

        index += 1;
    }

    if (inQuotes) {
        throw new Error('CSV parse error: unmatched quote.');
    }

    if (field.length > 0 || fields.length > 0) {
        fields.push(field);
        rows.push({ line: rowStartLine, fields });
    }

    return rows;
}

function parseCardsCsv(csvText) {
    const rows = parseCsvRowsWithLineInfo(String(csvText || ''));
    const cards = [];

    rows.forEach((row) => {
        const values = row.fields.map((value) => String(value || '').trim());
        const hasAnyValue = values.some((value) => value.length > 0);
        if (!hasAnyValue) {
            return;
        }
        if (values.length !== 2) {
            throw new Error(`Line ${row.line}: expected 2 columns (front,back), got ${values.length}.`);
        }
        const front = values[0];
        const back = values[1];
        if (!front || !back) {
            throw new Error(`Line ${row.line}: front and back must both be non-empty.`);
        }
        cards.push({ front, back, line: row.line });
    });

    if (cards.length === 0) {
        throw new Error('No cards parsed. Paste at least one "front,back" line.');
    }

    return cards;
}

function parseChineseCharacterText(rawText) {
    const text = String(rawText || '');
    const lines = text.split(/\r\n|\r|\n/);
    const cards = [];

    lines.forEach((lineText, index) => {
        const line = index + 1;
        const chars = String(lineText || '').match(/\p{Script=Han}/gu);
        if (!chars) {
            return;
        }
        chars.forEach((char) => {
            cards.push({ front: String(char), back: '', line });
        });
    });

    if (cards.length === 0) {
        throw new Error('No Chinese characters found. Paste text that contains Chinese characters.');
    }
    return cards;
}

async function parseCardsForCurrentMode() {
    if (!isChineseCharactersDeckMode()) {
        return parseCardsCsv(cardsCsvInput.value);
    }

    const cards = parseChineseCharacterText(cardsCsvInput.value);
    const uniqueTexts = [];
    const seen = new Set();
    cards.forEach((card) => {
        if (seen.has(card.front)) {
            return;
        }
        seen.add(card.front);
        uniqueTexts.push(card.front);
    });

    const pinyinByText = await deckCreateCommon.fetchChineseCharacterPinyinMap(API_BASE, uniqueTexts);
    return cards.map((card) => ({
        ...card,
        back: String(pinyinByText[card.front] || '').trim() || card.front,
    }));
}

function parseType4Definition() {
    const displayLabel = String(type4DisplayLabelInput ? type4DisplayLabelInput.value : '').trim();
    const isMultichoiceOnly = Boolean(type4IsMultichoiceOnlyInput && type4IsMultichoiceOnlyInput.checked);
    const generatorCode = getType4GeneratorCodeValue()
        .replace(/\r\n/g, '\n')
        .replace(/\r/g, '\n')
        .trim();
    if (!displayLabel) {
        throw new Error('Representative label is required for generator decks.');
    }
    if (!generatorCode) {
        throw new Error('Python generator snippet is required for generator decks.');
    }
    return {
        displayLabel,
        isMultichoiceOnly,
        generatorCode,
    };
}

async function fetchType4PreviewSamples(generatorCode) {
    const seedBase = nextType4PreviewSeedBase();
    const response = await fetch(`${API_BASE}/shared-decks/type4/preview`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ generatorCode, seedBase }),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
        throw new Error(result.error || `Failed to preview generator (HTTP ${response.status})`);
    }
    return Array.isArray(result && result.samples) ? result.samples : [];
}

async function ensureType4RepresentativeLabelAvailable(displayLabel) {
    const response = await fetch(`${API_BASE}/shared-decks/type4/representative-label-availability`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            categoryKey: currentFirstTag,
            displayLabel,
        }),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
        throw new Error(result.error || `Failed to check representative label (HTTP ${response.status})`);
    }
    if (result && result.available) {
        return;
    }
    const existingDeckName = String(result && result.existing_deck_name ? result.existing_deck_name : '').trim();
    throw new Error(
        existingDeckName
            ? `Representative label already exists in this category: ${existingDeckName}.`
            : 'Representative label already exists in this category.',
    );
}

async function regenerateType4Examples() {
    if (!isTypeIVDeckMode() || !previewType4Definition || isRegeneratingType4Examples) {
        return;
    }
    showError('');
    try {
        isRegeneratingType4Examples = true;
        setRegenType4ExamplesButtonState(true);
        const definition = parseType4Definition();
        const samples = await fetchType4PreviewSamples(definition.generatorCode);
        previewType4Definition = {
            ...definition,
            samples,
        };
        renderReview([], []);
    } catch (error) {
        showError(error.message || 'Failed to regenerate preview samples.');
    } finally {
        isRegeneratingType4Examples = false;
        setRegenType4ExamplesButtonState(false);
    }
}

async function previewDeckFromCsv() {
    showError('');
    showSuccess('');
    const available = await ensureNameAvailable();
    if (!available) {
        showError('Deck tags are not available. Fix the tag path and try again.');
        return;
    }

    if (isTypeIVDeckMode()) {
        try {
            const definition = parseType4Definition();
            await ensureType4RepresentativeLabelAvailable(definition.displayLabel);
            const samples = await fetchType4PreviewSamples(definition.generatorCode);
            previewType4Definition = {
                ...definition,
                samples,
            };
            previewCards = [];
            previewRows = [];
            previewDiagnostics = { totalRows: 0, dedupWithinDeck: [], dedupeKey: 'front' };
            renderReview([], []);
            reviewSection.classList.remove('hidden');
        } catch (error) {
            previewType4Definition = null;
            showError(error.message || 'Failed to parse generator definition.');
        }
        return;
    }

    let cards;
    try {
        cards = await parseCardsForCurrentMode();
    } catch (error) {
        showError(error.message || 'Failed to parse input.');
        return;
    }

    previewType4Definition = null;
    const dedupeKey = isTypeIIDeckMode() ? 'back' : 'front';
    const withinDeckDedup = [];
    const firstByKey = new Map();
    cards.forEach((card) => {
        const keyValue = String(card[dedupeKey] || '');
        const kept = firstByKey.get(keyValue);
        if (kept) {
            withinDeckDedup.push({
                dedupe_key: dedupeKey,
                dedupe_value: keyValue,
                line: card.line,
                kept_line: kept.line,
            });
            return;
        }
        firstByKey.set(keyValue, card);
    });

    const uniqueCards = Array.from(firstByKey.values());
    let overlapByValue = {};
    let overlapOtherKey = dedupeKey === 'back' ? 'front' : 'back';
    try {
        const overlapInfo = await deckCreateCommon.fetchCategoryCardOverlap(
            API_BASE,
            currentFirstTag,
            uniqueCards,
        );
        overlapByValue = deckCreateCommon.toOverlapByValue(overlapInfo);
        overlapOtherKey = overlapInfo.otherKey || overlapOtherKey;
    } catch (error) {
        showError(error.message || 'Failed to compare with existing cards.');
        return;
    }
    previewCards = uniqueCards.map((card) => ({ front: card.front, back: card.back }));

    previewDiagnostics = {
        totalRows: cards.length,
        dedupWithinDeck: withinDeckDedup,
        dedupeKey,
    };
    previewRows = cards.map((card) => {
        const keyValue = String(card[dedupeKey] || '');
        const first = firstByKey.get(keyValue);
        const isFirst = Boolean(first && first.line === card.line);
        if (!isFirst) {
            return {
                line: card.line,
                front: card.front,
                back: card.back,
                kept: false,
                statusText: `Removed: duplicate ${dedupeKey} of line ${first.line}`,
            };
        }
        const overlap = overlapByValue[keyValue] || null;
        const exactDecks = overlap && Array.isArray(overlap.exactDecks) ? overlap.exactDecks : [];
        const mismatchDecks = overlap && Array.isArray(overlap.mismatchDecks) ? overlap.mismatchDecks : [];
        const exactDeckText = deckCreateCommon.formatDeckNameList(exactDecks);
        const mismatchDeckText = deckCreateCommon.formatDeckNameList(mismatchDecks);
        return {
            line: card.line,
            front: card.front,
            back: card.back,
            kept: true,
            statusText: 'Kept',
            exactText: exactDeckText
                ? `Exact card already exists in: ${exactDeckText}.`
                : '',
            warningText: mismatchDeckText
                ? `Warning: same ${dedupeKey} exists with different ${overlapOtherKey} in: ${mismatchDeckText}.`
                : '',
        };
    });
    renderReview(previewCards, previewRows);
    reviewSection.classList.remove('hidden');
}

function renderReview(cardsToCreate, allRows) {
    const deckName = getGeneratedName();
    const tags = getAllTags();
    const isTypeIV = isTypeIVDeckMode();
    if (reviewTableWrap) {
        reviewTableWrap.classList.toggle('hidden', isTypeIV);
    }
    if (type4ReviewBox) {
        type4ReviewBox.classList.toggle('hidden', !isTypeIV);
    }
    if (isTypeIV) {
        const type4Definition = previewType4Definition || {
            displayLabel: '',
            isMultichoiceOnly: false,
            generatorCode: '',
            samples: [],
        };
        reviewMeta.innerHTML = `
            <div><strong>Deck name:</strong> <code>${escapeHtml(deckName)}</code></div>
            <div><strong>Tags:</strong> ${tags.map((tag) => `<code>${escapeHtml(tag)}</code>`).join(', ')}</div>
            <div><strong>Behavior:</strong> Generator deck</div>
            <div><strong>Representative cards:</strong> 1</div>
        `;
        dedupeSummary.innerHTML = '';
        dedupeSummary.classList.add('hidden');
        if (type4ReviewLabel) {
            type4ReviewLabel.textContent = type4Definition.displayLabel;
        }
        if (type4ReviewIsMultichoiceOnly) {
            type4ReviewIsMultichoiceOnly.textContent = type4Definition.isMultichoiceOnly ? 'Yes' : 'No';
        }
        if (type4ReviewCode) {
            type4ReviewCode.textContent = type4Definition.generatorCode;
        }
        if (type4ReviewExamples) {
            const samples = Array.isArray(type4Definition.samples) ? type4Definition.samples : [];
            if (samples.length === 0) {
                type4ReviewExamples.innerHTML = '<p class="muted-help-text">No preview samples returned.</p>';
            } else {
                type4ReviewExamples.innerHTML = samples.map((sample, index) => {
                    const distractors = Array.isArray(sample && sample.distractors) ? sample.distractors : [];
                    const distractorText = distractors.length > 0
                        ? distractors.map((item) => `<code>${escapeHtml(item)}</code>`).join(', ')
                        : '<span class="muted-help-text">None</span>';
                    return `
                        <div class="mt-07">
                            <div><strong>Example ${index + 1}:</strong> <code>${escapeHtml(sample && sample.prompt ? sample.prompt : '')}</code></div>
                            <div><strong>Answer:</strong> <code>${escapeHtml(sample && sample.answer ? sample.answer : '')}</code></div>
                            <div><strong>Distractors:</strong> ${distractorText}</div>
                        </div>
                    `;
                }).join('');
            }
        }
        if (reviewTableBody) {
            reviewTableBody.innerHTML = '';
        }
        setRegenType4ExamplesButtonState(false);
        return;
    }
    const totalRows = Number(previewDiagnostics.totalRows || 0);
    const withinDeckDedupCount = Array.isArray(previewDiagnostics.dedupWithinDeck)
        ? previewDiagnostics.dedupWithinDeck.length
        : 0;
    const shownRows = allRows;

    reviewMeta.innerHTML = `
        <div><strong>Deck name:</strong> <code>${escapeHtml(deckName)}</code></div>
        <div><strong>Tags:</strong> ${tags.map((tag) => `<code>${escapeHtml(tag)}</code>`).join(', ')}</div>
        <div><strong>Rows parsed:</strong> ${totalRows}</div>
        <div><strong>Removed (within this deck):</strong> ${withinDeckDedupCount}</div>
        <div><strong>Cards to create:</strong> ${cardsToCreate.length}</div>
    `;
    renderDedupeSummary();

    reviewTableBody.innerHTML = shownRows.map((row) => `
        <tr>
            <td>${row.line}</td>
            <td>${escapeHtml(row.front)}</td>
            <td>${escapeHtml(row.back)}</td>
            <td>${deckCreateCommon.renderStatusCellHtml(row, { warnClass: 'deck-row-status-warn' })}</td>
        </tr>
    `).join('');
}

function renderDedupeSummary() {
    const within = Array.isArray(previewDiagnostics.dedupWithinDeck) ? previewDiagnostics.dedupWithinDeck : [];
    const dedupeKey = previewDiagnostics.dedupeKey === 'back' ? 'back' : 'front';
    if (within.length === 0) {
        dedupeSummary.innerHTML = '';
        dedupeSummary.classList.add('hidden');
        return;
    }

    const lines = [];
    lines.push('<h3>Deduplication Details</h3>');
    if (within.length > 0) {
        lines.push(`<p><strong>Within current deck CSV (keyed by ${dedupeKey}):</strong></p>`);
        within.slice(0, 30).forEach((item) => {
            lines.push(`<p>Line ${item.line} (${escapeHtml(item.dedupe_value || '')}) removed, kept line ${item.kept_line}.</p>`);
        });
        if (within.length > 30) {
            lines.push(`<p>...and ${within.length - 30} more within-deck duplicates.</p>`);
        }
    }

    dedupeSummary.innerHTML = lines.join('');
    dedupeSummary.classList.remove('hidden');
}

async function createDeck() {
    if (isCreatingDeck) {
        return;
    }
    const available = await ensureNameAvailable();
    if (!available) {
        showError('Deck tags are not available. Fix the tag path before creating.');
        return;
    }

    const payload = {
        firstTag: currentFirstTag,
        extraTags: extraTags.map((item) => formatTagPayload(item)),
    };
    if (isTypeIVDeckMode()) {
        if (!previewType4Definition) {
            showError('Review the generator deck before creating it.');
            return;
        }
        payload.displayLabel = previewType4Definition.displayLabel;
        payload.isMultichoiceOnly = Boolean(previewType4Definition.isMultichoiceOnly);
        payload.generatorCode = previewType4Definition.generatorCode;
    } else {
        if (!Array.isArray(previewCards) || previewCards.length === 0) {
            showError('Preview first before creating the deck.');
            return;
        }
        payload.cards = previewCards;
    }

    isCreatingDeck = true;
    createDeckBtn.disabled = true;
    createDeckBtn.textContent = 'Creating...';
    showError('');
    showSuccess('');

    try {
        const response = await fetch(`${API_BASE}/shared-decks`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok) {
            throw new Error(result.error || `Create failed (HTTP ${response.status})`);
        }

        const isCreatedTypeIV = String(result && result.deck && result.deck.behavior_type ? result.deck.behavior_type : '').trim().toLowerCase() === 'type_iv';
        showSuccess(
            isCreatedTypeIV
                ? `Generator deck created: #${result.deck.deck_id} (${result.deck.name}). Redirecting...`
                : `Deck created: #${result.deck.deck_id} (${result.deck.name}), added ${result.cards_added} cards. Redirecting...`
        );
        window.setTimeout(() => {
            window.location.href = '/deck-manage.html';
        }, 500);
    } catch (error) {
        console.error('Error creating shared deck:', error);
        showError(error.message || 'Failed to create deck.');
    } finally {
        isCreatingDeck = false;
        createDeckBtn.disabled = false;
        createDeckBtn.textContent = 'Confirm & Create Deck';
    }
}

function setNameStatus(text, state) {
    nameStatus.textContent = text;
    nameStatus.classList.remove('status-ok', 'status-error', 'status-note');
    nameStatus.classList.add(`status-${state}`);
}

function scheduleNameAvailabilityCheck() {
    nameAvailable = null;
    lastNameChecked = '';
    if (nameCheckTimer) {
        window.clearTimeout(nameCheckTimer);
    }
    if (!hasEnoughTagsForDeck()) {
        setNameStatus('Add at least one extra tag to build a deck path.', 'note');
        return;
    }
    setNameStatus('Checking name availability...', 'note');
    nameCheckTimer = window.setTimeout(() => {
        nameCheckTimer = null;
        void checkNameAvailability();
    }, 180);
}

async function ensureNameAvailable() {
    if (!hasEnoughTagsForDeck()) {
        nameAvailable = false;
        lastNameChecked = '';
        setNameStatus('Add at least one extra tag to build a deck path.', 'note');
        return false;
    }
    const currentName = getGeneratedName();
    if (nameAvailable !== null && lastNameChecked === currentName) {
        return nameAvailable;
    }
    await checkNameAvailability();
    return nameAvailable === true;
}

async function checkNameAvailability() {
    if (!hasEnoughTagsForDeck()) {
        nameAvailable = false;
        lastNameChecked = '';
        setNameStatus('Add at least one extra tag to build a deck path.', 'note');
        return;
    }
    const currentName = getGeneratedName();
    const token = ++nameCheckToken;
    try {
        const params = buildNameAvailabilityQueryParams();
        const response = await fetch(`${API_BASE}/shared-decks/name-availability?${params.toString()}`);
        const result = await response.json().catch(() => ({}));
        if (token !== nameCheckToken) {
            return;
        }
        if (!response.ok) {
            throw new Error(result.error || `Failed to check name (HTTP ${response.status})`);
        }
        nameAvailable = Boolean(result.available);
        lastNameChecked = currentName;
        if (nameAvailable) {
            setNameStatus('Name available.', 'ok');
        } else if (result && result.conflict_type === 'tag_prefix_conflict') {
            setNameStatus(
                `Tag path conflicts with existing path ${deckCreateCommon.formatTagPath(result.conflict_tags)}.`,
                'error',
            );
        } else {
            setNameStatus('Name already exists. Please change tags.', 'error');
        }
    } catch (error) {
        if (token !== nameCheckToken) {
            return;
        }
        console.error('Error checking deck name availability:', error);
        nameAvailable = null;
        lastNameChecked = '';
        setNameStatus('Could not verify name right now.', 'error');
    }
}

async function loadAutocompleteTags() {
    try {
        const response = await fetch(`${API_BASE}/shared-decks/tags`);
        const result = await response.json().catch(() => ({}));
        if (!response.ok) {
            throw new Error(result.error || `Failed to load tags (HTTP ${response.status})`);
        }
        autocompleteTagPaths = Array.isArray(result.tag_paths)
            ? result.tag_paths
                .map((path) => Array.isArray(path) ? path.map((tag) => normalizeTag(tag)).filter(Boolean) : [])
                .filter((path) => path.length > 0)
            : [];
        const nextCountByCategory = {};
        autocompleteTagPaths.forEach((path) => {
            const first = normalizeTag(path[0]);
            if (!first) {
                return;
            }
            nextCountByCategory[first] = Number(nextCountByCategory[first] || 0) + 1;
        });
        deckCountByCategoryKey = nextCountByCategory;
        renderFirstTagToggle();
        updateAutocompleteSuggestions();
    } catch (error) {
        console.error('Error loading autocomplete tags:', error);
        autocompleteTagPaths = [];
        deckCountByCategoryKey = {};
        existingTagOptions.innerHTML = '';
        renderFirstTagToggle();
    }
}

function getContextualAutocompleteTags() {
    const currentPath = getAllTags().map((tag) => normalizeTag(tag)).filter(Boolean);
    if (currentPath.length === 0) {
        return [];
    }

    const suggestions = new Set();
    autocompleteTagPaths.forEach((path) => {
        if (!Array.isArray(path) || path.length <= currentPath.length) {
            return;
        }
        if (path[0] !== currentPath[0]) {
            return;
        }
        for (let i = 0; i < currentPath.length; i += 1) {
            if (path[i] !== currentPath[i]) {
                return;
            }
        }
        const nextTag = normalizeTag(path[currentPath.length]);
        if (!nextTag || reservedFirstTags.has(nextTag)) {
            return;
        }
        if (currentPath.includes(nextTag)) {
            return;
        }
        suggestions.add(nextTag);
    });

    return Array.from(suggestions).sort();
}

function updateAutocompleteSuggestions() {
    if (!existingTagOptions) {
        return;
    }
    const suggestions = getContextualAutocompleteTags();
    existingTagOptions.innerHTML = suggestions
        .map((tag) => `<option value="${escapeHtml(tag)}"></option>`)
        .join('');
}
