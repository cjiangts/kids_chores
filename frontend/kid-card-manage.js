const API_BASE = `${window.location.origin}/api`;

const params = new URLSearchParams(window.location.search);
const kidId = params.get('id');
const SESSION_CARD_COUNT_BY_CATEGORY_FIELD = 'sessionCardCountByCategory';
const INCLUDE_ORPHAN_BY_CATEGORY_FIELD = 'includeOrphanByCategory';
const HARD_CARD_PERCENT_BY_CATEGORY_FIELD = 'hardCardPercentageByCategory';
const BEHAVIOR_TYPE_TYPE_I = 'type_i';
const BEHAVIOR_TYPE_TYPE_II = 'type_ii';
const BEHAVIOR_TYPE_TYPE_III = 'type_iii';
const BEHAVIOR_TYPE_TYPE_IV = 'type_iv';
const PRACTICE_PRIORITY_REASON_MISSED = 'missed';
const PRACTICE_PRIORITY_REASON_SLOW = 'slow';
const PRACTICE_PRIORITY_REASON_LEARNING = 'learning';
const PRACTICE_PRIORITY_REASON_DUE = 'due';
const PRACTICE_PRIORITY_REASON_NEW = 'new';
const PRACTICE_PRIORITY_MIN_CORRECT_RECORDS_FOR_SPEED_BASELINE = 100;
const PRACTICE_PRIORITY_LEARNING_TARGET_ATTEMPTS = 5;
const PRACTICE_PRIORITY_VERY_DUE_DAYS = 30;
const CARD_SORT_MODE_PRACTICE_QUEUE = 'new_queue';
const CARD_SORT_MODE_INCORRECT_RATE = 'incorrect_rate';
const CARD_SORT_MODE_AVG_RESPONSE_TIME = 'avg_response_time';
const CARD_SORT_MODE_LIFETIME_ATTEMPTS = 'lifetime_attempts';
const CARD_SORT_MODE_LAST_SEEN = 'last_seen';
const CARD_SORT_MODE_ADDED_TIME = 'added_time';
const CARD_SORT_DIRECTION_ASC = 'asc';
const CARD_SORT_DIRECTION_DESC = 'desc';
const VALID_CARD_SORT_MODES = new Set([
    CARD_SORT_MODE_PRACTICE_QUEUE,
    CARD_SORT_MODE_INCORRECT_RATE,
    CARD_SORT_MODE_AVG_RESPONSE_TIME,
    CARD_SORT_MODE_LIFETIME_ATTEMPTS,
    CARD_SORT_MODE_LAST_SEEN,
    CARD_SORT_MODE_ADDED_TIME,
]);
const SHARED_SCOPE_CARDS = 'cards';
const SHARED_SCOPE_TYPE2 = 'type2';
const SHARED_SCOPE_LESSON_READING = 'lesson-reading';
const SHARED_SCOPE_TYPE4 = 'type4';

const {
    normalizeCategoryKey,
    parseDeckTagInput,
    getCategoryRawValueMap,
    getDeckCategoryMetaMap,
} = window.DeckCategoryCommon;
const categoryKey = normalizeCategoryKey(params.get('categoryKey'));

const kidNameEl = document.getElementById('kidName');
const kidNavGroup = document.getElementById('kidNavGroup');
let cachedKidsForNav = [];
const errorMessage = document.getElementById('errorMessage');
const successMessage = document.getElementById('successMessage');

const sessionSettingsForm = document.getElementById('sessionSettingsForm');
const sessionCardCountInput = document.getElementById('sessionCardCount');
const sessionCardCountLabel = document.getElementById('sessionCardCountLabel');
const openDeckOptInModalBtn = document.getElementById('openDeckOptInModalBtn');
const deckTreeModal = document.getElementById('deckTreeModal');
const deckTreeContainer = document.getElementById('deckTreeContainer');
const deckTreeSearchInput = document.getElementById('deckTreeSearchInput');
const deckTreeCounter = document.getElementById('deckTreeCounter');
const deckTreeClearBtn = document.getElementById('deckTreeClearBtn');
const deckTreeInfoBtn = document.getElementById('deckTreeInfoBtn');
const applyDeckTreeChangesBtn = document.getElementById('applyDeckTreeChangesBtn');
const cancelDeckTreeModalBtn = document.getElementById('cancelDeckTreeModalBtn');
const deckTreeChangeMessage = document.getElementById('deckTreeChangeMessage');
const openPersonalDeckModalBtn = document.getElementById('openPersonalDeckModalBtn');
const openPrintableSheetsBtn = document.getElementById('openPrintableSheetsBtn');
const personalDeckModal = document.getElementById('personalDeckModal');
const cancelPersonalDeckModalBtn = document.getElementById('cancelPersonalDeckModalBtn');
const type4DeckCountsModal = document.getElementById('type4DeckCountsModal');
const cancelType4DeckCountsModalBtn = document.getElementById('cancelType4DeckCountsModalBtn');
const saveType4DeckCountsBtn = document.getElementById('saveType4DeckCountsBtn');
const type4DeckCountsList = document.getElementById('type4DeckCountsList');
const type4DeckCountsModalTotal = document.getElementById('type4DeckCountsModalTotal');
const type4DeckCountsMessage = document.getElementById('type4DeckCountsMessage');
const type4DeckCountsApplyAllInput = document.getElementById('type4DeckCountsApplyAllInput');
const applyType4DeckCountsToAllBtn = document.getElementById('applyType4DeckCountsToAllBtn');
const type4GeneratorModal = document.getElementById('type4GeneratorModal');
const type4GeneratorHeading = document.getElementById('type4GeneratorHeading');
const closeType4GeneratorModalBtn = document.getElementById('closeType4GeneratorModalBtn');
const runType4GeneratorPreviewBtn = document.getElementById('runType4GeneratorPreviewBtn');
const type4GeneratorDeckText = document.getElementById('type4GeneratorDeckText');
const type4GeneratorCodeText = document.getElementById('type4GeneratorCodeText');
const type4GeneratorCodeEditor = document.getElementById('type4GeneratorCodeEditor');
const type4GeneratorSamples = document.getElementById('type4GeneratorSamples');
const type4GeneratorValidateTestContainer = document.getElementById('type4GeneratorValidateTestContainer');
const type4GeneratorMessage = document.getElementById('type4GeneratorMessage');
const cardsSectionTitleText = document.getElementById('cardsSectionTitleText');
const hardnessComputationHint = document.getElementById('hardnessComputationHint');
const sessionMixSubgroup = document.getElementById('sessionMixSubgroup');
const sessionMixDetails = document.getElementById('sessionMixDetails');
const type4DailyTargetBlock = document.getElementById('type4DailyTargetBlock');
const type4DailyTargetTotalText = document.getElementById('type4DailyTargetTotalText');
const openType4DeckCountsModalBtn = document.getElementById('openType4DeckCountsModalBtn');

const personalDeckModalNote = document.getElementById('personalDeckModalNote');
const addCardForm = document.getElementById('addCardForm');
const chineseCharInput = document.getElementById('chineseChar');
const addReadingBtn = document.getElementById('addReadingBtn');
const addCardStatusMessage = document.getElementById('addCardStatusMessage');

const viewOrderSelect = document.getElementById('viewOrderSelect');
const sortMenuBtn = document.getElementById('sortMenuBtn');
const sortMenuBtnLabel = document.getElementById('sortMenuBtnLabel');
const sortMenuPopover = document.getElementById('sortMenuPopover');
const sortDirectionToggleGroup = document.getElementById('sortDirectionToggleGroup');
const sortDirectionToggleBtns = sortDirectionToggleGroup
    ? Array.from(sortDirectionToggleGroup.querySelectorAll('.sort-direction-toggle-btn'))
    : [];
const cardSearchInput = document.getElementById('cardSearchInput');
const skipVisibleCardsBtn = document.getElementById('skipVisibleCardsBtn');
const unskipVisibleCardsBtn = document.getElementById('unskipVisibleCardsBtn');
const cardsBulkActionMenuBtn = document.getElementById('cardsBulkActionMenuBtn');
const cardsBulkActionMenu = document.getElementById('cardsBulkActionMenu');
const cardsBulkActionMessage = document.getElementById('cardsBulkActionMessage');
const cardsQueueLegend = document.getElementById('cardsQueueLegend');
const mathCardCount = document.getElementById('mathCardCount');
const cardsGrid = document.getElementById('cardsGrid');
const cardsToolbar = document.querySelector('.cards-toolbar');
const cardsViewControl = document.querySelector('.cards-view-control');
const cardViewModeCompactBtn = document.getElementById('cardViewModeCompactBtn');
const cardViewModeExpandBtn = document.getElementById('cardViewModeExpandBtn');
const hardnessPercentSlider = document.getElementById('hardnessPercentSlider');
const leastRecentMixSummary = document.getElementById('leastRecentMixSummary');
const hardCardsMixSummary = document.getElementById('hardCardsMixSummary');
const queueSettingsSaveBtn = document.getElementById('queueSettingsSaveBtn');

let allDecks = [];
let orphanDeck = null;
let currentCards = [];
let currentDailyProgressRows = [];
let currentFamilyTimezone = '';
let currentCardsViewMode = 'queue';
let sortedCards = [];
let isDeckMoveInFlight = false;
let baselineOptedDeckIdSet = new Set();
let stagedOptedDeckIdSet = new Set();
let baselineIncludeOrphanInQueue = false;
let stagedIncludeOrphanInQueue = false;
let sharedDeckCardsResponseTracker = null;
let currentCategoryDisplayName = 'Practice';
let currentKidName = '';
let isChineseSpecificLogic = false;
let currentChineseBackContent = '';
let currentSharedScope = SHARED_SCOPE_CARDS;
let currentBehaviorType = BEHAVIOR_TYPE_TYPE_I;
let isReadingBulkAdding = false;
let initialHardCardPercent = null;
let currentSkippedCardCount = 0;
let currentCardViewMode = 'short';
let expandedCompactCardIds = new Set();
let isBulkSkipActionInFlight = false;
let sessionCardCountByCategory = {};
let includeOrphanByCategory = {};
let hardCardPercentByCategory = {};
let baselineSessionCardCount = 0;
let baselineHardCardPercent = 0;
let isQueueSettingsSaving = false;
let queueSettingsSaveSuccessText = '';
let previewQueueTimer = null;
let hasLoadedSharedCardsOnce = false;
let isType4DeckCountsSaving = false;
let activeType4GeneratorCardId = null;
let isType4GeneratorPreviewLoading = false;
let type4GeneratorAceViewer = null;
let currentCardSortDirection = CARD_SORT_DIRECTION_ASC;
const ORPHAN_BUBBLE_ID = '__orphan__';
const MAX_DECK_BUBBLE_COUNT = 0;
const CHINESE_FIXED_FRONT_SIZE_REM = 1.4;
const SHOW_DECK_COUNT_MISMATCH_WARNING = false;
const NEXT_SESSION_HARD_COLOR = '#f59e0b';
const NEXT_SESSION_LEAST_COLOR = '#22a45a';
let currentSessionCardCountCap = null;

function getChineseCardBackText(rawBack) {
    return String(rawBack || '').trim();
}

function getChineseCardBackHtml(rawBack) {
    return escapeHtml(getChineseCardBackText(rawBack));
}

const promptPreviewPlayer = (
    window.WritingAudioSequence && typeof window.WritingAudioSequence.createPlayer === 'function'
)
    ? window.WritingAudioSequence.createPlayer({
        preload: 'auto',
        onError: (error) => {
            const detail = String(error?.message || '').trim();
            showError(detail ? `Failed to play voice prompt: ${detail}` : 'Failed to play voice prompt');
        },
    })
    : null;

function toCategoryMap(rawMap) {
    return getCategoryRawValueMap(rawMap);
}

function getCategoryIntValue(rawMap) {
    const map = toCategoryMap(rawMap);
    const parsed = Number.parseInt(map[categoryKey], 10);
    return Number.isInteger(parsed) ? parsed : 0;
}

function getCategoryNullableIntValue(rawMap) {
    const map = toCategoryMap(rawMap);
    const parsed = Number.parseInt(map[categoryKey], 10);
    return Number.isInteger(parsed) ? parsed : null;
}

function supportsPracticePriorityPreview() {
    return currentBehaviorType === BEHAVIOR_TYPE_TYPE_I
        || currentBehaviorType === BEHAVIOR_TYPE_TYPE_II
        || currentBehaviorType === BEHAVIOR_TYPE_TYPE_III;
}

function normalizeCardSortMode(rawMode) {
    const mode = String(rawMode || '').trim().toLowerCase();
    return VALID_CARD_SORT_MODES.has(mode) ? mode : CARD_SORT_MODE_PRACTICE_QUEUE;
}

function normalizeCardSortDirection(rawDirection) {
    const direction = String(rawDirection || '').trim().toLowerCase();
    return direction === CARD_SORT_DIRECTION_DESC ? CARD_SORT_DIRECTION_DESC : CARD_SORT_DIRECTION_ASC;
}

function getDefaultCardSortDirection(mode) {
    const normalized = normalizeCardSortMode(mode);
    if (normalized === CARD_SORT_MODE_PRACTICE_QUEUE) {
        return CARD_SORT_DIRECTION_ASC;
    }
    return CARD_SORT_DIRECTION_DESC;
}

function getSelectedCardSortMode() {
    return normalizeCardSortMode(viewOrderSelect ? viewOrderSelect.value : CARD_SORT_MODE_PRACTICE_QUEUE);
}

function getCurrentCardSortDirection() {
    return normalizeCardSortDirection(currentCardSortDirection);
}

function setCurrentCardSortDirection(direction) {
    currentCardSortDirection = normalizeCardSortDirection(direction);
}

function syncCardSortDirectionButton() {
    if (!sortDirectionToggleBtns.length) {
        return;
    }
    const direction = getCurrentCardSortDirection();
    const activeKey = direction === CARD_SORT_DIRECTION_ASC ? 'asc' : 'desc';
    sortDirectionToggleBtns.forEach((btn) => {
        const isActive = btn.dataset.sortDirection === activeKey;
        btn.classList.toggle('active', isActive);
        btn.setAttribute('aria-pressed', isActive ? 'true' : 'false');
    });
}

function withCategoryValue(rawMap, value) {
    const map = toCategoryMap(rawMap);
    map[categoryKey] = value;
    return map;
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

function showDeckChangeMessage(message, isError = false) {
    if (!deckTreeChangeMessage) {
        return;
    }
    const text = String(message || '').trim();
    if (!text) {
        deckTreeChangeMessage.textContent = '';
        deckTreeChangeMessage.classList.add('hidden');
        deckTreeChangeMessage.classList.remove('error');
        deckTreeChangeMessage.classList.add('success');
        return;
    }
    deckTreeChangeMessage.textContent = text;
    deckTreeChangeMessage.classList.remove('hidden');
    deckTreeChangeMessage.classList.toggle('error', isError);
    deckTreeChangeMessage.classList.toggle('success', !isError);
}

function showStatusMessage(message, isError = true) {
    if (!addCardStatusMessage) {
        return;
    }
    const text = String(message || '').trim();
    if (!text) {
        addCardStatusMessage.textContent = '';
        addCardStatusMessage.classList.add('hidden');
        return;
    }
    addCardStatusMessage.textContent = text;
    addCardStatusMessage.classList.remove('hidden');
    if (text) {
        setManageModalOpen(personalDeckModal, true);
    }
    if (isError) {
        addCardStatusMessage.style.background = '#f8d7da';
        addCardStatusMessage.style.color = '#721c24';
        addCardStatusMessage.style.border = '1px solid #f5c6cb';
    } else {
        addCardStatusMessage.style.background = '#d4edda';
        addCardStatusMessage.style.color = '#155724';
        addCardStatusMessage.style.border = '1px solid #c3e6cb';
    }
}

function summarizeSkippedCardLabels(rawLabels) {
    const counts = new Map();
    for (const rawLabel of Array.isArray(rawLabels) ? rawLabels : []) {
        const label = String(rawLabel || '').trim();
        if (!label) {
            continue;
        }
        counts.set(label, (counts.get(label) || 0) + 1);
    }
    return [...counts.entries()].map(([label, count]) => (
        count > 1 ? `${label} (x${count})` : label
    ));
}

function buildBulkAddStatusMessage(insertedCount, result) {
    const inserted = Math.max(0, Number(insertedCount) || 0);
    const skippedExistingCount = Math.max(0, Number(result?.skipped_existing_count) || 0);
    if (skippedExistingCount <= 0) {
        return `Added ${inserted} new card(s).`;
    }
    const skippedLabels = summarizeSkippedCardLabels(result?.skipped_existing_cards);
    if (skippedLabels.length === 0) {
        return `Added ${inserted} new card(s). Skipped ${skippedExistingCount} existing card(s).`;
    }
    return `Added ${inserted} new card(s). Skipped ${skippedExistingCount} existing card(s): ${skippedLabels.join(', ')}.`;
}

function showCardsBulkActionMessage(message, isError = false) {
    if (!cardsBulkActionMessage) {
        return;
    }
    const text = String(message || '').trim();
    if (!text) {
        cardsBulkActionMessage.textContent = '';
        cardsBulkActionMessage.classList.add('hidden');
        cardsBulkActionMessage.classList.remove('error');
        cardsBulkActionMessage.classList.add('success');
        return;
    }
    cardsBulkActionMessage.textContent = text;
    cardsBulkActionMessage.classList.remove('hidden');
    cardsBulkActionMessage.classList.toggle('error', !!isError);
    cardsBulkActionMessage.classList.toggle('success', !isError);
}

function isModalOpen(modalEl) {
    return Boolean(modalEl) && !modalEl.classList.contains('hidden');
}

function syncModalBodyLock() {
    const hasOpenModal = (
        isModalOpen(deckTreeModal)
        || isModalOpen(type4DeckCountsModal)
        || isModalOpen(type4GeneratorModal)
        || isModalOpen(personalDeckModal)
    );
    document.body.classList.toggle('modal-open', hasOpenModal);
}

function setManageModalOpen(modalEl, shouldOpen) {
    if (!modalEl) {
        return;
    }
    if (!shouldOpen && modalEl.contains(document.activeElement)) {
        document.activeElement.blur();
    }
    modalEl.classList.toggle('hidden', !shouldOpen);
    modalEl.setAttribute('aria-hidden', shouldOpen ? 'false' : 'true');
    syncModalBodyLock();
}

function handleModalBackdropClick(event) {
    if (!(event.target instanceof HTMLElement)) {
        return;
    }
    if (event.target === deckTreeModal) {
        return;
    }
    if (event.target === type4DeckCountsModal) {
        setManageModalOpen(type4DeckCountsModal, false);
        return;
    }
    if (event.target === type4GeneratorModal) {
        setManageModalOpen(type4GeneratorModal, false);
        return;
    }
    if (event.target === personalDeckModal) {
        setManageModalOpen(personalDeckModal, false);
    }
}

function withCategoryKey(url) {
    if (categoryKey) {
        url.searchParams.set('categoryKey', categoryKey);
    }
    return url;
}

function buildSharedDeckApiUrl(pathSuffix) {
    const cleanSuffix = String(pathSuffix || '').replace(/^\/+/, '');
    return window.DeckCategoryCommon.buildKidScopedApiUrl({
        kidId,
        scope: currentSharedScope,
        path: `/${cleanSuffix}`,
        categoryKey,
        apiBase: API_BASE,
    });
}

function buildType2ApiUrl(pathSuffix) {
    const cleanSuffix = String(pathSuffix || '').replace(/^\/+/, '');
    return window.DeckCategoryCommon.buildKidScopedApiUrl({
        kidId,
        scope: SHARED_SCOPE_TYPE2,
        path: `/${cleanSuffix}`,
        categoryKey,
        apiBase: API_BASE,
    });
}

function buildType1PersonalCardApiUrl(cardId) {
    return withCategoryKey(new URL(`${API_BASE}/kids/${kidId}/cards/${encodeURIComponent(cardId)}`)).toString();
}

function isType1Behavior() {
    return currentBehaviorType === BEHAVIOR_TYPE_TYPE_I;
}

function isType2Behavior() {
    return currentBehaviorType === BEHAVIOR_TYPE_TYPE_II;
}

function isType3Behavior() {
    return currentBehaviorType === BEHAVIOR_TYPE_TYPE_III;
}

function isType4Behavior() {
    return currentBehaviorType === BEHAVIOR_TYPE_TYPE_IV;
}

function isType1ChineseEnglishBackMode() {
    return isType1Behavior()
        && isChineseSpecificLogic
        && currentChineseBackContent === 'english';
}

const TYPE1_ENGLISH_BACK_FORMAT_HINT = 'Expected one entry per line as: <chinese>, <english> — e.g. 中国, china';

function supportsPersonalDeckEditor() {
    return isChineseSpecificLogic
        && (currentBehaviorType === BEHAVIOR_TYPE_TYPE_I || currentBehaviorType === BEHAVIOR_TYPE_TYPE_II);
}

function getSessionCountFromKid(kid) {
    sessionCardCountByCategory = toCategoryMap(kid[SESSION_CARD_COUNT_BY_CATEGORY_FIELD]);
    return getCategoryIntValue(sessionCardCountByCategory);
}

function buildSessionCountPayload(total) {
    return {
        [SESSION_CARD_COUNT_BY_CATEGORY_FIELD]: withCategoryValue(
            sessionCardCountByCategory,
            total,
        ),
    };
}

function applySessionCountFromPayload(payload) {
    sessionCardCountByCategory = toCategoryMap(
        payload && payload[SESSION_CARD_COUNT_BY_CATEGORY_FIELD]
    );
}

function buildIncludeOrphanPayload(includeOrphan) {
    return {
        [INCLUDE_ORPHAN_BY_CATEGORY_FIELD]: withCategoryValue(
            includeOrphanByCategory,
            includeOrphan,
        ),
    };
}

function applyIncludeOrphanFromPayload(payload) {
    includeOrphanByCategory = toCategoryMap(
        payload && payload[INCLUDE_ORPHAN_BY_CATEGORY_FIELD]
    );
}

function getInitialHardCardPercentFromKid(kid) {
    hardCardPercentByCategory = toCategoryMap(kid[HARD_CARD_PERCENT_BY_CATEGORY_FIELD]);
    return getCategoryNullableIntValue(hardCardPercentByCategory);
}

function buildHardCardPercentPayload(hardPct) {
    return {
        [HARD_CARD_PERCENT_BY_CATEGORY_FIELD]: withCategoryValue(
            hardCardPercentByCategory,
            hardPct,
        ),
    };
}

function getPersistedHardCardPercentFromPayload(payload) {
    const previousMap = hardCardPercentByCategory;
    const map = toCategoryMap(payload && payload[HARD_CARD_PERCENT_BY_CATEGORY_FIELD]);
    hardCardPercentByCategory = map;
    const persistedValue = getCategoryNullableIntValue(map);
    if (persistedValue === null) {
        return getCategoryNullableIntValue(previousMap);
    }
    return persistedValue;
}

function getCurrentCategoryDisplayName() {
    return String(currentCategoryDisplayName || '').trim();
}

function getPersistedOptedInType4Decks() {
    return (Array.isArray(allDecks) ? allDecks : []).filter((deck) => Boolean(deck && deck.opted_in));
}

function getType4DeckDailyTargetCount(deck) {
    const parsed = Number.parseInt(deck && deck.daily_target_count, 10);
    return Number.isInteger(parsed) ? Math.max(0, parsed) : 0;
}

function getPersistedType4DeckCountEntries() {
    const entries = getPersistedOptedInType4Decks().map((deck) => ({
        kind: 'shared',
        deck,
    }));
    if (orphanDeck && stagedIncludeOrphanInQueue) {
        entries.push({
            kind: 'orphan',
            deck: orphanDeck,
        });
    }
    return entries;
}

function getType4TotalCardsPerDay() {
    return getPersistedType4DeckCountEntries().reduce(
        (sum, entry) => sum + getType4DeckDailyTargetCount(entry && entry.deck),
        0
    );
}

function showType4DeckCountsMessage(message, isError = false) {
    if (!type4DeckCountsMessage) {
        return;
    }
    const text = String(message || '').trim();
    if (!text) {
        type4DeckCountsMessage.textContent = '';
        type4DeckCountsMessage.classList.add('hidden');
        type4DeckCountsMessage.classList.remove('error');
        type4DeckCountsMessage.classList.add('success');
        return;
    }
    type4DeckCountsMessage.textContent = text;
    type4DeckCountsMessage.classList.remove('hidden');
    type4DeckCountsMessage.classList.toggle('error', !!isError);
    type4DeckCountsMessage.classList.toggle('success', !isError);
}

function showType4GeneratorMessage(message, isError = false) {
    if (!type4GeneratorMessage) {
        return;
    }
    const text = String(message || '').trim();
    if (!text) {
        type4GeneratorMessage.textContent = '';
        type4GeneratorMessage.classList.add('hidden');
        type4GeneratorMessage.classList.remove('error');
        type4GeneratorMessage.classList.add('success');
        return;
    }
    type4GeneratorMessage.textContent = text;
    type4GeneratorMessage.classList.remove('hidden');
    type4GeneratorMessage.classList.toggle('error', !!isError);
    type4GeneratorMessage.classList.toggle('success', !isError);
}

function getCurrentType4GeneratorCard() {
    if (!activeType4GeneratorCardId) {
        return null;
    }
    return (Array.isArray(currentCards) ? currentCards : []).find(
        (card) => String(card && card.id ? card.id : '') === String(activeType4GeneratorCardId)
    ) || null;
}

function initializeType4GeneratorCodeViewer() {
    if (!type4GeneratorCodeText || !type4GeneratorCodeEditor) {
        return;
    }
    const ace = window.ace;
    if (!ace || typeof ace.edit !== 'function') {
        return;
    }
    type4GeneratorAceViewer = ace.edit(type4GeneratorCodeEditor);
    type4GeneratorAceViewer.setTheme('ace/theme/github_light_default');
    type4GeneratorAceViewer.session.setMode('ace/mode/python');
    type4GeneratorAceViewer.session.setUseSoftTabs(true);
    type4GeneratorAceViewer.session.setTabSize(4);
    type4GeneratorAceViewer.session.setUseWrapMode(true);
    type4GeneratorAceViewer.setReadOnly(true);
    type4GeneratorAceViewer.setHighlightActiveLine(false);
    type4GeneratorAceViewer.setShowPrintMargin(false);
    type4GeneratorAceViewer.setOption('fontFamily', 'ui-monospace, SFMono-Regular, Menlo, monospace');
    type4GeneratorAceViewer.setOption('fontSize', '14px');
    type4GeneratorAceViewer.setOption('wrap', true);
    type4GeneratorAceViewer.setOption('showLineNumbers', true);
    type4GeneratorAceViewer.setOption('highlightGutterLine', false);
    type4GeneratorAceViewer.setOption('showFoldWidgets', false);
    type4GeneratorAceViewer.setOption('displayIndentGuides', false);
    type4GeneratorAceViewer.setOption('useWorker', false);
    type4GeneratorAceViewer.renderer.setScrollMargin(8, 8);
    type4GeneratorAceViewer.renderer.$cursorLayer.element.style.display = 'none';
    type4GeneratorCodeText.classList.add('hidden');
    type4GeneratorCodeText.setAttribute('aria-hidden', 'true');
    type4GeneratorCodeEditor.classList.remove('hidden');
    type4GeneratorCodeEditor.setAttribute('aria-hidden', 'false');
}

function setType4GeneratorCodeContent(codeText) {
    const nextCode = String(codeText || '').trim() || 'Generator code unavailable.';
    if (type4GeneratorCodeText) {
        type4GeneratorCodeText.textContent = nextCode;
    }
    if (type4GeneratorAceViewer && typeof type4GeneratorAceViewer.setValue === 'function') {
        type4GeneratorAceViewer.setValue(nextCode, -1);
        type4GeneratorAceViewer.clearSelection();
        type4GeneratorAceViewer.scrollToLine(0, true, false, () => {});
        type4GeneratorAceViewer.gotoLine(1, 0, false);
    }
}

function renderType4GeneratorSamples(samples = [], message = '') {
    if (!type4GeneratorSamples) {
        return;
    }
    const items = Array.isArray(samples) ? samples : [];
    if (!items.length) {
        type4GeneratorSamples.innerHTML = `<p class="type4-generator-empty">${escapeHtml(message || 'No example yet.')}</p>`;
        return;
    }
    const sample = items[0] || {};
    const prompt = String(sample && sample.prompt ? sample.prompt : '').trim();
    const answer = String(sample && sample.answer ? sample.answer : '').trim();
    const distractors = Array.isArray(sample && sample.distractors) ? sample.distractors : [];
    const distractorMarkup = distractors.length > 0
        ? distractors.map((item) => `<code>${escapeHtml(String(item || '').trim())}</code>`).join(', ')
        : '<span class="type4-generator-empty">No distractors provided.</span>';
    type4GeneratorSamples.innerHTML = `
        <div class="type4-generator-sample-card">
            <div class="type4-generator-sample-label">Prompt</div>
            <div class="type4-generator-sample-prompt">${escapeHtml(prompt || '(empty prompt)')}</div>
            <div class="type4-generator-sample-answer">Answer: <code>${escapeHtml(answer || '-')}</code></div>
            <div class="type4-generator-sample-answer">Distractors: ${distractorMarkup}</div>
        </div>
    `;
}

function renderType4GeneratorModal(card) {
    if (!type4GeneratorHeading || !type4GeneratorDeckText || !type4GeneratorCodeText) {
        return;
    }
    const sourceName = resolveCardSourceDeckName(card);
    type4GeneratorHeading.textContent = String(card && card.front ? card.front : 'Generator');
    type4GeneratorDeckText.textContent = String(sourceName || '-');
    const cachedCode = String(card && card.type4_generator_code ? card.type4_generator_code : '').trim();
    const cachedSamples = Array.isArray(card && card.type4_generator_samples) ? card.type4_generator_samples : [];
    setType4GeneratorCodeContent(cachedCode || 'Loading generator...');
    renderType4GeneratorSamples(cachedSamples, cachedCode ? 'No example yet.' : 'Loading example...');
    showType4GeneratorMessage('');
    if (type4GeneratorValidateTestContainer) {
        type4GeneratorValidateTestContainer.classList.add('hidden');
        type4GeneratorValidateTestContainer.innerHTML = '';
    }
    if (runType4GeneratorPreviewBtn) {
        runType4GeneratorPreviewBtn.disabled = !card;
        runType4GeneratorPreviewBtn.textContent = 'Run Example';
    }
}

async function requestType4GeneratorPreview(card) {
    const response = await fetch(buildSharedDeckApiUrl(`shared-decks/cards/${card.id}/generator-preview`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ categoryKey }),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
        throw new Error(result.error || `Failed to run generator (HTTP ${response.status})`);
    }
    return result;
}

function openType4GeneratorModal(card) {
    if (!card) {
        return;
    }
    activeType4GeneratorCardId = String(card.id || '');
    renderType4GeneratorModal(card);
    setManageModalOpen(type4GeneratorModal, true);
    if (type4GeneratorAceViewer && typeof type4GeneratorAceViewer.resize === 'function') {
        window.setTimeout(() => {
            type4GeneratorAceViewer.resize();
        }, 0);
    }
    if (!String(card.type4_generator_code || '').trim()) {
        void runType4GeneratorPreview().catch((error) => {
            console.error('Error loading generator details:', error);
            showType4GeneratorMessage(error.message || 'Failed to load generator.', true);
        });
    }
}

async function runType4GeneratorPreview() {
    const card = getCurrentType4GeneratorCard();
    if (!card) {
        showType4GeneratorMessage('Representative card not found.', true);
        return;
    }
    if (isType4GeneratorPreviewLoading) {
        return;
    }
    isType4GeneratorPreviewLoading = true;
    if (runType4GeneratorPreviewBtn) {
        runType4GeneratorPreviewBtn.disabled = true;
        runType4GeneratorPreviewBtn.textContent = 'Running...';
    }
    showType4GeneratorMessage('');
    try {
        const result = await requestType4GeneratorPreview(card);
        if (card) {
            card.type4_generator_code = String(result && result.code ? result.code : '');
            card.type4_generator_samples = Array.isArray(result && result.samples) ? result.samples : [];
        }
        setType4GeneratorCodeContent(card && card.type4_generator_code ? card.type4_generator_code : '');
        renderType4GeneratorSamples(result.samples || [], 'No example returned.');
        const pmc = window.PracticeManageCommon;
        if (pmc && type4GeneratorValidateTestContainer) {
            const hasValidate = Boolean(result && result.has_validate);
            pmc.showOrHideValidateTestBox(type4GeneratorValidateTestContainer, hasValidate);
            if (hasValidate) {
                const previewSamples = Array.isArray(result && result.samples) ? result.samples : [];
                const previewAnswer = previewSamples.length > 0
                    ? String(previewSamples[0].answer || '').trim()
                    : '';
                pmc.renderValidateTestBox(type4GeneratorValidateTestContainer, {
                    getGeneratorCode: () => String(card && card.type4_generator_code ? card.type4_generator_code : ''),
                    getExpectedAnswer: () => previewAnswer,
                });
            }
        }
    } finally {
        isType4GeneratorPreviewLoading = false;
        if (runType4GeneratorPreviewBtn) {
            runType4GeneratorPreviewBtn.disabled = false;
            runType4GeneratorPreviewBtn.textContent = 'Run Example';
        }
    }
}

function getOptInDecksHelpText() {
    if (currentBehaviorType === BEHAVIOR_TYPE_TYPE_IV) {
        return 'Tap a deck to toggle it on or off, then tap Apply Deck Changes.\n\nYou can freely add or remove decks at any time — all practice records are always kept.';
    }
    return 'Tap a deck to toggle it on or off, then tap Apply Deck Changes.\n\nYou can freely add or remove decks at any time — all practice records are always kept. Cards you\'ve already practiced will stay visible under Personal Deck so nothing is lost.';
}

async function loadKidNav() {
    if (!kidNavGroup) {
        return;
    }
    try {
        const response = await fetch(`${API_BASE}/kids`);
        if (!response.ok) {
            return;
        }
        const kids = await response.json();
        cachedKidsForNav = Array.isArray(kids) ? kids : [];
        renderKidNav();
    } catch (error) {
        console.error('Error loading kids for nav:', error);
    }
}

function renderKidNav() {
    if (!kidNavGroup) {
        return;
    }
    const kids = Array.isArray(cachedKidsForNav) ? cachedKidsForNav : [];
    if (kids.length < 2) {
        kidNavGroup.classList.add('hidden');
        kidNavGroup.innerHTML = '';
        return;
    }
    const userIconSvg = '<svg class="kid-nav-card-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>';
    kidNavGroup.innerHTML = kids.map((kid) => {
        const id = String(kid?.id || '').trim();
        const name = String(kid?.name || '').trim() || 'Kid';
        const isActive = id === String(kidId);
        if (isActive) {
            return `<span class="kid-nav-card active" role="tab" aria-selected="true">${userIconSvg}<span>${escapeHtml(name)}</span></span>`;
        }
        const href = buildKidCardManageHref(id, kid);
        return `<a class="kid-nav-card" role="tab" aria-selected="false" href="${escapeHtml(href)}">${userIconSvg}<span>${escapeHtml(name)}</span></a>`;
    }).join('');
    kidNavGroup.classList.remove('hidden');
}

function buildKidCardManageHref(targetKidId, targetKid) {
    const qs = new URLSearchParams();
    qs.set('id', String(targetKidId));
    const optedInKeys = Array.isArray(targetKid?.optedInDeckCategoryKeys)
        ? targetKid.optedInDeckCategoryKeys.map(normalizeCategoryKey).filter(Boolean)
        : [];
    let resolvedCategoryKey = '';
    if (categoryKey && (optedInKeys.length === 0 || optedInKeys.includes(categoryKey))) {
        resolvedCategoryKey = categoryKey;
    } else if (optedInKeys.length > 0) {
        resolvedCategoryKey = optedInKeys[0];
    } else if (categoryKey) {
        resolvedCategoryKey = categoryKey;
    }
    if (resolvedCategoryKey) {
        qs.set('categoryKey', resolvedCategoryKey);
    }
    return `/kid-card-manage.html?${qs.toString()}`;
}

function updatePageTitle() {
    const displayName = getCurrentCategoryDisplayName() || 'Card';
    const kidName = String(currentKidName || '').trim();
    if (kidName) {
        document.title = `${kidName} - ${displayName} Management - Kids Daily Chores`;
        return;
    }
    document.title = `${displayName} Management - Kids Daily Chores`;
}

function applyCategoryUiText() {
    const displayName = getCurrentCategoryDisplayName();
    const showOrphanEditor = supportsPersonalDeckEditor();
    const showType4DeckTargetBlock = isType4Behavior();
    const usePracticeFocus = supportsPracticePriorityPreview();
    if (sessionCardCountLabel) {
        sessionCardCountLabel.textContent = 'Cards / day';
    }
    if (cardsSectionTitleText) {
        cardsSectionTitleText.textContent = currentBehaviorType === BEHAVIOR_TYPE_TYPE_IV
            ? 'Representative Cards'
            : 'Cards';
    }
    if (sessionMixSubgroup) {
        sessionMixSubgroup.classList.toggle('hidden', showType4DeckTargetBlock);
    }
    if (sessionMixDetails) {
        sessionMixDetails.classList.toggle('hidden', showType4DeckTargetBlock || usePracticeFocus);
    }
    if (openType4DeckCountsModalBtn) {
        openType4DeckCountsModalBtn.classList.toggle('hidden', !showType4DeckTargetBlock);
    }
    if (hardnessComputationHint) {
        if (currentBehaviorType === BEHAVIOR_TYPE_TYPE_IV) {
            hardnessComputationHint.textContent = 'Each card here represents one Type IV deck, so its stats are aggregated at the deck-pattern level.';
        } else if (isType2Behavior()) {
            hardnessComputationHint.textContent = 'Hard cards use overall correctness rate. Never-practiced cards count as hard.';
        } else if (usePracticeFocus) {
            hardnessComputationHint.textContent = '';
        } else {
            hardnessComputationHint.textContent = 'Hard cards are the ones that took longest on the most recent try.';
        }
    }
    if (openPersonalDeckModalBtn) {
        openPersonalDeckModalBtn.classList.toggle('hidden', !showOrphanEditor);
    }
    if (openPrintableSheetsBtn) {
        const supportsPrintableSheets = isType4Behavior() || (isType2Behavior() && isChineseSpecificLogic);
        openPrintableSheetsBtn.classList.toggle('hidden', !supportsPrintableSheets);
        if (supportsPrintableSheets) {
            const printParams = new URLSearchParams();
            printParams.set('id', String(kidId || ''));
            printParams.set('categoryKey', String(categoryKey || ''));
            openPrintableSheetsBtn.href = `/kid-writing-sheet-manage.html?${printParams.toString()}`;
        } else {
            openPrintableSheetsBtn.removeAttribute('href');
        }
    }
    if (!showOrphanEditor) {
        setManageModalOpen(personalDeckModal, false);
    }
    if (personalDeckModalNote) {
        if (isType1ChineseEnglishBackMode()) {
            personalDeckModalNote.textContent = `Bulk add Chinese words/phrases with English meanings. ${TYPE1_ENGLISH_BACK_FORMAT_HINT}`;
        } else {
            personalDeckModalNote.textContent = isType2Behavior()
                ? 'Bulk add Chinese words and phrases to the Personal Deck.'
                : 'Bulk add Chinese characters to the Personal Deck.';
        }
    }
    if (chineseCharInput) {
        if (isType1ChineseEnglishBackMode()) {
            chineseCharInput.placeholder = '比如:\n中国, china\n你好, hello\n学校, school';
        } else {
            chineseCharInput.placeholder = isType2Behavior()
                ? '比如:\nDAY1:好像 香 菜 为难 关心 事情 很重 虽然 但是 改变 昨天 放心 更好\nDAY2:答应 病了 知道 从来 勇敢 感动 高山 一起 可是 找人 怎么 远 路'
                : '比如:\nDAY1:坐着 甘罗 甘茂 叹了口气 皇帝 做官 爷爷 留在 孙子 总是 实在 \nDAY2:说明 有说有笑 心事 喜欢 当作 胡说 清楚 北方 摸着 肩膀';
        }
    }
    document.body.classList.toggle('type1-chinese-mode', isChineseSpecificLogic);
    syncType4CardOrderOptions();
    syncType4RepresentativeCardsUi();
    updateAddReadingButtonCount();
    renderDeckSetupSummary();
    updatePageTitle();
}

function getDeckById(deckId) {
    return allDecks.find((deck) => Number(deck.deck_id) === Number(deckId)) || null;
}

function getOptedDecks() {
    return allDecks.filter((deck) => stagedOptedDeckIdSet.has(Number(deck.deck_id)));
}

function syncType4CardOrderOptions() {
    if (!viewOrderSelect) {
        return;
    }
    const hideAllExceptAdded = isType4Behavior();
    const options = viewOrderSelect.querySelectorAll('option');
    options.forEach((option) => {
        const value = String(option.value || '').trim().toLowerCase();
        const shouldHide = hideAllExceptAdded && value !== CARD_SORT_MODE_ADDED_TIME;
        option.hidden = shouldHide;
        option.disabled = shouldHide;
    });
    if (sortDirectionToggleGroup) {
        sortDirectionToggleGroup.classList.toggle('hidden', hideAllExceptAdded);
    }
    const currentValue = String(viewOrderSelect.value || '').trim().toLowerCase();
    if (hideAllExceptAdded && currentValue !== CARD_SORT_MODE_ADDED_TIME) {
        viewOrderSelect.value = CARD_SORT_MODE_ADDED_TIME;
        setCurrentCardSortDirection(getDefaultCardSortDirection(CARD_SORT_MODE_ADDED_TIME));
        syncCardSortDirectionButton();
    } else if (!VALID_CARD_SORT_MODES.has(currentValue)) {
        viewOrderSelect.value = CARD_SORT_MODE_PRACTICE_QUEUE;
        setCurrentCardSortDirection(getDefaultCardSortDirection(CARD_SORT_MODE_PRACTICE_QUEUE));
        syncCardSortDirectionButton();
    }
    syncSortMenuFromSelect();
}

function syncType4RepresentativeCardsUi() {
    const useType4 = isType4Behavior();
    if (cardsViewControl) {
        cardsViewControl.classList.toggle('hidden', useType4);
    }
    if (cardsToolbar) {
        cardsToolbar.classList.toggle('hidden', useType4);
    }
    if (!useType4) {
        return;
    }
    currentCardViewMode = 'long';
    expandedCompactCardIds.clear();
    if (cardSearchInput) {
        cardSearchInput.value = '';
    }
    if (viewOrderSelect) {
        viewOrderSelect.value = 'added_time';
        syncSortMenuFromSelect();
    }
    renderCardViewModeButtons();
    updateCardsQueueLegendVisibility(0);
}

function renderType4DeckTargetControls() {
    if (!type4DailyTargetTotalText && !openType4DeckCountsModalBtn) {
        return;
    }
    const totalCardsPerDay = getType4TotalCardsPerDay();
    const sourceCount = getPersistedType4DeckCountEntries().length;
    const hasPendingChanges = hasPendingDeckChanges();
    if (type4DailyTargetTotalText) {
        type4DailyTargetTotalText.textContent = String(totalCardsPerDay);
    }
    if (openType4DeckCountsModalBtn) {
        openType4DeckCountsModalBtn.disabled = hasPendingChanges || sourceCount <= 0 || isType4DeckCountsSaving;
        const titleText = isType4DeckCountsSaving ? 'Saving...' : 'Deck Counts';
        const metaText = 'Set cards per day per deck';
        openType4DeckCountsModalBtn.innerHTML = `
            <span class="manage-popup-btn-text">
                <span class="manage-popup-btn-emoji" aria-hidden="true">${icon('target', { size: 24 })}</span>
                <span class="manage-popup-btn-title">${escapeHtml(titleText)}</span>
                <span class="manage-popup-btn-meta">${escapeHtml(metaText)}</span>
            </span>
            <span class="manage-popup-btn-chevron" aria-hidden="true">›</span>
        `;
    }
}

function getType4DeckCountDraftValue(rawValue) {
    const parsed = Number.parseInt(rawValue, 10);
    if (!Number.isInteger(parsed) || parsed < 0) {
        return 0;
    }
    return Math.min(1000, parsed);
}

let type4DeckCountsBaseline = {};

function snapshotType4DeckCountsBaseline() {
    type4DeckCountsBaseline = {};
    if (!type4DeckCountsList) return;
    const inputs = [...type4DeckCountsList.querySelectorAll('.type4-deck-count-input')];
    inputs.forEach((input) => {
        const key = input.dataset.type4SharedDeckId || ('orphan_' + (input.dataset.type4OrphanDeckId || '0'));
        type4DeckCountsBaseline[key] = getType4DeckCountDraftValue(input.value);
    });
}

function updateType4DeckCountsSaveBtn() {
    if (!saveType4DeckCountsBtn || isType4DeckCountsSaving) return;
    if (!type4DeckCountsList) return;
    const inputs = [...type4DeckCountsList.querySelectorAll('.type4-deck-count-input')];
    let changed = false;
    for (const input of inputs) {
        const key = input.dataset.type4SharedDeckId || ('orphan_' + (input.dataset.type4OrphanDeckId || '0'));
        if (getType4DeckCountDraftValue(input.value) !== (type4DeckCountsBaseline[key] ?? 0)) {
            changed = true;
            break;
        }
    }
    saveType4DeckCountsBtn.disabled = !changed;
}

function updateType4DeckCountsModalTotal() {
    if (!type4DeckCountsModalTotal || !type4DeckCountsList) {
        return;
    }
    const inputs = [...type4DeckCountsList.querySelectorAll('.type4-deck-count-input')];
    const total = inputs.reduce(
        (sum, input) => sum + getType4DeckCountDraftValue(input.value),
        0
    );
    type4DeckCountsModalTotal.textContent = String(total);
    updateType4DeckCountsSaveBtn();
}

function applyType4DeckCountToAllRows(rawValue) {
    if (!type4DeckCountsList) {
        return;
    }
    const normalized = getType4DeckCountDraftValue(rawValue);
    const inputs = [...type4DeckCountsList.querySelectorAll('.type4-deck-count-input')];
    inputs.forEach((input) => {
        input.value = String(normalized);
    });
    if (type4DeckCountsApplyAllInput) {
        type4DeckCountsApplyAllInput.value = String(normalized);
    }
    updateType4DeckCountsModalTotal();
    updateType4DeckCountsSaveBtn();
}

function renderType4DeckCountsModal() {
    if (!type4DeckCountsList) {
        return;
    }
    const entries = getPersistedType4DeckCountEntries();
    if (entries.length <= 0) {
        type4DeckCountsList.innerHTML = '<div class="empty-state"><h3>No opted-in decks yet</h3></div>';
        if (type4DeckCountsApplyAllInput) {
            type4DeckCountsApplyAllInput.value = '0';
        }
        updateType4DeckCountsModalTotal();
        return;
    }
    type4DeckCountsList.innerHTML = entries.map((entry) => {
        const deck = entry && entry.deck ? entry.deck : null;
        const isOrphanEntry = entry && entry.kind === 'orphan';
        const sharedDeckId = Number.parseInt(deck && deck.deck_id, 10);
        const orphanDeckId = Number.parseInt(deck && deck.deck_id, 10);
        const label = isOrphanEntry
            ? `⭐ ${getPersonalDeckDisplayName()}`
            : String(deck && deck.representative_front ? deck.representative_front : '').trim();
        const dailyTargetCount = getType4DeckDailyTargetCount(deck);
        const inputAttrs = isOrphanEntry
            ? `data-type4-orphan-deck-id="${escapeHtml(String(orphanDeckId || 0))}"`
            : `data-type4-shared-deck-id="${escapeHtml(String(sharedDeckId))}"`;
        const titleText = isOrphanEntry
            ? label
            : `${label || 'Generator Deck'} (${String(deck && deck.name ? deck.name : '').trim() || 'Deck'})`;
        return `
            <label class="type4-deck-count-row" title="${escapeHtml(titleText)}">
                <div class="type4-deck-count-copy">
                    <div class="type4-deck-count-name">${escapeHtml(label || 'Generator Deck')}</div>
                </div>
                <input
                    type="number"
                    class="type4-deck-count-input"
                    ${inputAttrs}
                    min="0"
                    max="1000"
                    step="1"
                    value="${escapeHtml(String(dailyTargetCount))}"
                >
            </label>
        `;
    }).join('');
    if (type4DeckCountsApplyAllInput) {
        const firstInput = type4DeckCountsList.querySelector('.type4-deck-count-input');
        type4DeckCountsApplyAllInput.value = String(getType4DeckCountDraftValue(firstInput ? firstInput.value : 0));
    }
    updateType4DeckCountsModalTotal();
    snapshotType4DeckCountsBaseline();
}

function collectType4DeckCountsPayload() {
    if (!type4DeckCountsList) {
        return {
            dailyCountsByDeckId: {},
            orphanDailyTargetCount: null,
        };
    }
    const inputs = [...type4DeckCountsList.querySelectorAll('.type4-deck-count-input')];
    const dailyCountsByDeckId = {};
    let orphanDailyTargetCount = null;
    inputs.forEach((input) => {
        const sharedDeckId = Number.parseInt(input.getAttribute('data-type4-shared-deck-id') || '', 10);
        const orphanDeckId = Number.parseInt(input.getAttribute('data-type4-orphan-deck-id') || '', 10);
        const normalized = getType4DeckCountDraftValue(input.value);
        input.value = String(normalized);
        if (Number.isInteger(orphanDeckId) && orphanDeckId > 0) {
            orphanDailyTargetCount = normalized;
            return;
        }
        if (!Number.isInteger(sharedDeckId) || sharedDeckId <= 0) {
            return;
        }
        dailyCountsByDeckId[String(sharedDeckId)] = normalized;
    });
    return {
        dailyCountsByDeckId,
        orphanDailyTargetCount,
    };
}

function renderDeckSetupSummary() {
    renderDeckSetupActionButtons();
    renderType4DeckTargetControls();
}

function renderDeckSetupActionButtons() {
    const totalDecks = (Array.isArray(allDecks) ? allDecks : []).length;
    const optedCount = stagedOptedDeckIdSet.size + (Boolean(orphanDeck) && stagedIncludeOrphanInQueue ? 1 : 0);
    if (openDeckOptInModalBtn) {
        const optInMeta = `${optedCount} / ${totalDecks + (orphanDeck ? 1 : 0)} decks opted in`;
        openDeckOptInModalBtn.innerHTML = `
            <span class="manage-popup-btn-text">
                <span class="manage-popup-btn-emoji" aria-hidden="true">${icon('layers', { size: 24 })}</span>
                <span class="manage-popup-btn-title">Manage Deck Opt-in</span>
                <span class="manage-popup-btn-meta">${escapeHtml(optInMeta)}</span>
            </span>
            <span class="manage-popup-btn-chevron" aria-hidden="true">›</span>
        `;
    }
    if (openPersonalDeckModalBtn) {
        openPersonalDeckModalBtn.innerHTML = `
            <span class="manage-popup-btn-text">
                <span class="manage-popup-btn-emoji" aria-hidden="true">${icon('pencil', { size: 24 })}</span>
                <span class="manage-popup-btn-title">Personal Deck Editor</span>
                <span class="manage-popup-btn-meta">Add your own cards</span>
            </span>
            <span class="manage-popup-btn-chevron" aria-hidden="true">›</span>
        `;
    }
}

function hasPendingDeckChanges() {
    if (stagedIncludeOrphanInQueue !== baselineIncludeOrphanInQueue) {
        return true;
    }
    if (stagedOptedDeckIdSet.size !== baselineOptedDeckIdSet.size) {
        return true;
    }
    for (const deckId of stagedOptedDeckIdSet) {
        if (!baselineOptedDeckIdSet.has(deckId)) {
            return true;
        }
    }
    return false;
}

function renderDeckPendingInfo() {
    renderDeckSetupSummary();
}


function getDeckTags(deck) {
    return Array.isArray(deck.tags)
        ? deck.tags
            .map((tag) => parseDeckTagInput(tag).tag)
            .filter(Boolean)
        : [];
}

function getDeckTagLabels(deck) {
    const keys = getDeckTags(deck);
    const rawLabels = Array.isArray(deck && deck.tag_labels) ? deck.tag_labels : [];
    return keys.map((tagKey, index) => {
        const parsedLabel = parseDeckTagInput(rawLabels[index]);
        if (parsedLabel.tag === tagKey && parsedLabel.label) {
            return parsedLabel.label;
        }
        return tagKey;
    });
}

function stripCategoryFirstTagFromName(name) {
    const text = String(name || '').trim();
    if (!text) {
        return '';
    }
    if (text === categoryKey) {
        return '';
    }
    const prefix = `${categoryKey}_`;
    if (text.startsWith(prefix)) {
        return text.slice(prefix.length);
    }
    return text;
}

function getType1DeckBubbleLabel(deck) {
    if (currentBehaviorType === BEHAVIOR_TYPE_TYPE_IV) {
        const tags = getDeckTags(deck);
        const tagTail = tags.length > 1 && tags[0] === categoryKey
            ? tags.slice(1).join('_')
            : '';
        const representativeFront = String(deck && deck.representative_front ? deck.representative_front : '').trim();
        if (tagTail && representativeFront) {
            return `${tagTail} · ${representativeFront}`;
        }
        if (tagTail) {
            return tagTail;
        }
        if (representativeFront) {
            return representativeFront;
        }
    }
    const tags = getDeckTags(deck);
    if (tags.length > 1 && tags[0] === categoryKey) {
        return tags.slice(1).join('_');
    }
    const stripped = stripCategoryFirstTagFromName(deck && deck.name);
    return stripped || String(deck && deck.name ? deck.name : '');
}

function getDeckBubbleSuffix(deck) {
    if (currentBehaviorType === BEHAVIOR_TYPE_TYPE_IV) {
        return '';
    }
    return ` · ${Number(deck && deck.card_count ? deck.card_count : 0)} cards`;
}

function getPersonalDeckDisplayName() {
    return 'Personal Deck';
}

function resolveCardSourceDeckName(card) {
    const raw = String(card?.source_deck_label || card?.source_deck_name || '').trim();
    const normalized = raw.toLowerCase().replace(/[\s_]+/g, '');
    if (
        Boolean(card?.source_is_orphan)
        || normalized === 'orphan'
        || normalized === 'orphandeck'
        || normalized === 'personaldeck'
        || normalized === 'personaldecks'
    ) {
        return getPersonalDeckDisplayName();
    }
    return raw || '-';
}

function hasDeckCountMismatchWarning(deck) {
    if (!SHOW_DECK_COUNT_MISMATCH_WARNING) {
        return false;
    }
    if (!deck || !deck.opted_in) {
        return false;
    }
    return Boolean(deck.has_update_warning);
}

function getDeckCountMismatchWarningText(deck) {
    const reason = String(deck && deck.update_warning_reason ? deck.update_warning_reason : '').trim().toLowerCase();
    if (reason === 'source_deleted' || Boolean(deck && deck.source_deleted)) {
        return 'Shared source deck was deleted; local copy may be outdated.';
    }
    const sharedCount = Number.parseInt(deck && deck.shared_card_count, 10);
    const materializedCount = Number.parseInt(deck && deck.materialized_card_count, 10);
    if (!Number.isInteger(sharedCount) || !Number.isInteger(materializedCount)) {
        return 'Shared deck changed since last opt-in (count mismatch).';
    }
    return `Shared deck changed (${sharedCount} shared vs ${materializedCount} local).`;
}

function clearDeckSelectionMessages() {
    showError('');
    showSuccess('');
    showDeckChangeMessage('');
}

async function refreshDeckSelectionViews() {
    renderDeckPendingInfo();
    await loadSharedDeckCards();
}

function filterCardsByQuery(cards, rawQuery) {
    const query = String(rawQuery || '').trim();
    if (!query) {
        return cards;
    }
    return cards.filter((card) => {
        const front = String(card.front || '');
        const back = String(card.back || '');
        const source = String(resolveCardSourceDeckName(card) || '');
        return front.includes(query) || back.includes(query) || source.includes(query);
    });
}

function getSortedCardsForDisplay(cards) {
    if (isType4Behavior()) {
        return window.PracticeManageCommon.sortCardsForView(
            Array.isArray(cards) ? cards : [],
            CARD_SORT_MODE_ADDED_TIME
        );
    }
    const filteredCards = filterCardsByQuery(cards, cardSearchInput ? cardSearchInput.value : '');
    return sortCardsForDisplay(filteredCards, getSelectedCardSortMode(), getCurrentCardSortDirection());
}

function isPracticePriorityQueueOrderSelected() {
    return getSelectedCardSortMode() === CARD_SORT_MODE_PRACTICE_QUEUE;
}

function usesPracticePriorityDisplay() {
    return supportsPracticePriorityPreview() && !isType4Behavior();
}

function compareCardIdentity(a, b) {
    const aId = Number.parseInt(a && a.id, 10);
    const bId = Number.parseInt(b && b.id, 10);
    if (Number.isInteger(aId) && Number.isInteger(bId) && aId !== bId) {
        return aId - bId;
    }
    return String(a && a.front || '').localeCompare(String(b && b.front || ''));
}

function compareNullableSortValues(aValue, bValue, direction, missingBehavior = 'last') {
    const aMissing = !Number.isFinite(aValue);
    const bMissing = !Number.isFinite(bValue);
    if (aMissing || bMissing) {
        if (aMissing && bMissing) {
            return 0;
        }
        if (missingBehavior === 'directional') {
            return direction === CARD_SORT_DIRECTION_DESC
                ? (aMissing ? -1 : 1)
                : (aMissing ? 1 : -1);
        }
        return aMissing ? 1 : -1;
    }
    return direction === CARD_SORT_DIRECTION_DESC
        ? bValue - aValue
        : aValue - bValue;
}

function getCardIncorrectRateSortValue(card) {
    const value = getCardOverallWrongRateValue(card);
    return Number.isFinite(value) ? value : null;
}

function getCardAverageResponseTimeSortValue(card) {
    const priorityAvg = Number(card && card.practice_priority_avg_correct_response_time);
    if (Number.isFinite(priorityAvg) && priorityAvg > 0) {
        return priorityAvg;
    }
    const fallback = getCardLastResponseTimeValue(card);
    return Number.isFinite(fallback) && fallback > 0 ? fallback : null;
}

function getCardLifetimeAttemptsSortValue(card) {
    const attempts = Number.parseInt(card && card.lifetime_attempts, 10);
    return Number.isInteger(attempts) ? Math.max(0, attempts) : 0;
}

function getCardLastSeenAgeSortValue(card) {
    const seenAt = window.PracticeManageCommon.parseTime(card && card.last_seen_at);
    if (!Number.isFinite(seenAt) || seenAt <= 0) {
        return null;
    }
    return Date.now() - seenAt;
}

function getCardAddedTimeSortValue(card) {
    const createdAt = window.PracticeManageCommon.parseTime(card && card.created_at);
    return Number.isFinite(createdAt) && createdAt > 0 ? createdAt : null;
}

function comparePracticeQueueCards(a, b, direction) {
    const aSkipped = Boolean(a && a.skip_practice);
    const bSkipped = Boolean(b && b.skip_practice);
    if (aSkipped !== bSkipped) {
        return aSkipped ? 1 : -1;
    }
    const aOrder = Number.isFinite(Number(a && a.practice_priority_order))
        ? Number(a.practice_priority_order)
        : Number.MAX_SAFE_INTEGER;
    const bOrder = Number.isFinite(Number(b && b.practice_priority_order))
        ? Number(b.practice_priority_order)
        : Number.MAX_SAFE_INTEGER;
    if (aOrder !== bOrder) {
        return direction === CARD_SORT_DIRECTION_DESC
            ? bOrder - aOrder
            : aOrder - bOrder;
    }
    return compareCardIdentity(a, b);
}

function compareMetricCards(a, b, mode, direction) {
    let comparison = 0;
    if (mode === CARD_SORT_MODE_INCORRECT_RATE) {
        comparison = compareNullableSortValues(
            getCardIncorrectRateSortValue(a),
            getCardIncorrectRateSortValue(b),
            direction,
            'last'
        );
    } else if (mode === CARD_SORT_MODE_AVG_RESPONSE_TIME) {
        comparison = compareNullableSortValues(
            getCardAverageResponseTimeSortValue(a),
            getCardAverageResponseTimeSortValue(b),
            direction,
            'last'
        );
    } else if (mode === CARD_SORT_MODE_LIFETIME_ATTEMPTS) {
        comparison = compareNullableSortValues(
            getCardLifetimeAttemptsSortValue(a),
            getCardLifetimeAttemptsSortValue(b),
            direction,
            'last'
        );
    } else if (mode === CARD_SORT_MODE_LAST_SEEN) {
        comparison = compareNullableSortValues(
            getCardLastSeenAgeSortValue(a),
            getCardLastSeenAgeSortValue(b),
            direction,
            'directional'
        );
    } else if (mode === CARD_SORT_MODE_ADDED_TIME) {
        comparison = compareNullableSortValues(
            getCardAddedTimeSortValue(a),
            getCardAddedTimeSortValue(b),
            direction,
            'last'
        );
    }
    if (comparison !== 0) {
        return comparison;
    }
    return compareCardIdentity(a, b);
}

function sortCardsForDisplay(cards, mode, direction) {
    const normalizedMode = normalizeCardSortMode(mode);
    const normalizedDirection = normalizeCardSortDirection(direction);
    const copy = [...(Array.isArray(cards) ? cards : [])];
    const innerCompare = normalizedMode === CARD_SORT_MODE_PRACTICE_QUEUE
        ? (a, b) => comparePracticeQueueCards(a, b, normalizedDirection)
        : (a, b) => compareMetricCards(a, b, normalizedMode, normalizedDirection);
    return copy.sort((a, b) => {
        const aSkipped = !!(a && a.skip_practice);
        const bSkipped = !!(b && b.skip_practice);
        if (aSkipped !== bSkipped) {
            return aSkipped ? 1 : -1;
        }
        return innerCompare(a, b);
    });
}

function getPracticePriorityAttemptCount(card) {
    const previewAttempts = Number.parseInt(card && card.practice_priority_attempt_count, 10);
    if (Number.isInteger(previewAttempts)) {
        return Math.max(0, previewAttempts);
    }
    const lifetimeAttempts = Number.parseInt(card && card.lifetime_attempts, 10);
    return Number.isInteger(lifetimeAttempts) ? Math.max(0, lifetimeAttempts) : 0;
}

function isNeverPracticedPriorityCard(card) {
    return getPracticePriorityAttemptCount(card) <= 0;
}

function getPracticePriorityPoints(card, reason) {
    if (reason === PRACTICE_PRIORITY_REASON_MISSED) {
        const value = Number(card && (
            card.practice_priority_missed_points
            ?? card.practice_priority_error_points
        ));
        return Number.isFinite(value) ? Math.max(0, value) : 0;
    }
    if (reason === PRACTICE_PRIORITY_REASON_SLOW) {
        const value = Number(card && (
            card.practice_priority_slow_points
            ?? card.practice_priority_fluency_points
        ));
        return Number.isFinite(value) ? Math.max(0, value) : 0;
    }
    if (reason === PRACTICE_PRIORITY_REASON_DUE) {
        const value = Number(card && (
            card.practice_priority_due_points
            ?? card.practice_priority_forgetting_points
        ));
        return Number.isFinite(value) ? Math.max(0, value) : 0;
    }
    const value = Number(card && card.practice_priority_learning_points);
    return Number.isFinite(value) ? Math.max(0, value) : 0;
}

function getPracticePriorityCompactReason(card) {
    const explicit = String(card && card.practice_priority_primary_reason || '').trim().toLowerCase();
    if (
        explicit === PRACTICE_PRIORITY_REASON_MISSED
        || explicit === PRACTICE_PRIORITY_REASON_SLOW
        || explicit === PRACTICE_PRIORITY_REASON_LEARNING
        || explicit === PRACTICE_PRIORITY_REASON_DUE
    ) {
        return explicit;
    }
    const scores = [
        [PRACTICE_PRIORITY_REASON_MISSED, getPracticePriorityPoints(card, PRACTICE_PRIORITY_REASON_MISSED)],
        [PRACTICE_PRIORITY_REASON_SLOW, getPracticePriorityPoints(card, PRACTICE_PRIORITY_REASON_SLOW)],
        [PRACTICE_PRIORITY_REASON_LEARNING, getPracticePriorityPoints(card, PRACTICE_PRIORITY_REASON_LEARNING)],
        [PRACTICE_PRIORITY_REASON_DUE, getPracticePriorityPoints(card, PRACTICE_PRIORITY_REASON_DUE)],
    ];
    scores.sort((a, b) => {
        const aValue = Number.isFinite(a[1]) ? a[1] : -1;
        const bValue = Number.isFinite(b[1]) ? b[1] : -1;
        return bValue - aValue;
    });
    return scores[0] ? scores[0][0] : PRACTICE_PRIORITY_REASON_LEARNING;
}

function getPracticePriorityDisplayReason(card) {
    if (isNeverPracticedPriorityCard(card)) {
        return PRACTICE_PRIORITY_REASON_NEW;
    }
    return getPracticePriorityCompactReason(card);
}

function getPracticePriorityScoreValue(card) {
    const value = Number(card && card.practice_priority_score);
    return Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : null;
}

function getPracticePriorityReferenceMaxScore() {
    if (!Array.isArray(sortedCards) || !sortedCards.length) {
        return null;
    }
    let maxScore = null;
    for (const card of sortedCards) {
        if (!card || card.skip_practice) {
            continue;
        }
        const score = getPracticePriorityScoreValue(card);
        if (!Number.isFinite(score) || score <= 0) {
            continue;
        }
        if (!Number.isFinite(maxScore) || score > maxScore) {
            maxScore = score;
        }
    }
    return Number.isFinite(maxScore) ? maxScore : null;
}

function formatPracticePriorityScore(score) {
    const numeric = Number(score);
    if (!Number.isFinite(numeric)) {
        return '-';
    }
    const rounded = Math.round(numeric * 10) / 10;
    return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

function getPracticePrioritySegments(card) {
    return [
        {
            key: PRACTICE_PRIORITY_REASON_MISSED,
            label: 'Missed',
            points: getPracticePriorityPoints(card, PRACTICE_PRIORITY_REASON_MISSED),
        },
        {
            key: PRACTICE_PRIORITY_REASON_SLOW,
            label: 'Slow',
            points: getPracticePriorityPoints(card, PRACTICE_PRIORITY_REASON_SLOW),
        },
        {
            key: PRACTICE_PRIORITY_REASON_LEARNING,
            label: 'Learning',
            points: getPracticePriorityPoints(card, PRACTICE_PRIORITY_REASON_LEARNING),
        },
        {
            key: PRACTICE_PRIORITY_REASON_DUE,
            label: 'Due',
            points: getPracticePriorityPoints(card, PRACTICE_PRIORITY_REASON_DUE),
        },
    ];
}

function getPracticePriorityPrimaryReasonLabel(card) {
    const reason = getPracticePriorityDisplayReason(card);
    if (reason === PRACTICE_PRIORITY_REASON_NEW) {
        return 'New';
    }
    if (reason === PRACTICE_PRIORITY_REASON_MISSED) {
        return 'Missed';
    }
    if (reason === PRACTICE_PRIORITY_REASON_SLOW) {
        return 'Slow';
    }
    if (reason === PRACTICE_PRIORITY_REASON_DUE) {
        return 'Due';
    }
    return 'Learning';
}

function getPracticePrioritySegmentDisplayLabel(card, segment) {
    if (segment && segment.key === PRACTICE_PRIORITY_REASON_LEARNING && isNeverPracticedPriorityCard(card)) {
        return 'New';
    }
    return String(segment && segment.label ? segment.label : '').trim() || 'Learning';
}

function getPracticePriorityPrimaryReasonKey(card) {
    const reason = getPracticePriorityDisplayReason(card);
    if (reason === PRACTICE_PRIORITY_REASON_NEW) {
        return PRACTICE_PRIORITY_REASON_LEARNING;
    }
    return reason;
}

function getPracticePriorityDaysSinceLastSeenValue(card) {
    if (isNeverPracticedPriorityCard(card)) {
        return null;
    }
    const days = Number.parseInt(card && card.practice_priority_days_since_last_seen, 10);
    return Number.isInteger(days) ? Math.max(0, days) : null;
}

function getPracticePriorityLastResultTone(card) {
    const value = String(card && card.last_result || '').trim().toLowerCase();
    if (value === 'right') {
        return 'right';
    }
    if (value === 'wrong') {
        return 'wrong';
    }
    return 'neutral';
}

function clampPercent(value) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) {
        return 0;
    }
    return Math.max(0, Math.min(100, numeric));
}

function buildPracticePriorityDonutHtml(options = {}) {
    const safePercent = clampPercent(options.correctPercent);
    const toneClass = String(options.toneClass || '').trim();
    const centerText = String(options.centerText || formatMetricPercent(safePercent));
    const centerClass = String(options.centerClass || '').trim();
    return `
        <div class="practice-priority-donut ${escapeHtml(toneClass)}" style="--chart-percent:${safePercent.toFixed(2)}%">
            <div class="practice-priority-donut-inner ${escapeHtml(centerClass)}">${escapeHtml(centerText)}</div>
        </div>
    `;
}

function buildPracticePriorityAxisHtml(options = {}) {
    const rawPositionPct = Number(options.positionPct);
    const positionPct = Number.isFinite(rawPositionPct) ? clampPercent(rawPositionPct) : null;
    const valueText = String(options.valueText || '-');
    const leftText = String(options.leftText || '-');
    const rightText = String(options.rightText || '-');
    const leftNote = String(options.leftNote || '');
    const rightNote = String(options.rightNote || '');
    const markerClass = String(options.markerClass || '').trim();
    const leftNoteClass = String(options.leftNoteClass || '').trim();
    const rightNoteClass = String(options.rightNoteClass || '').trim();
    const tickCount = Math.max(2, Number.parseInt(options.tickCount, 10) || 6);
    const ticksHtml = Array.from({ length: tickCount }, (_, index) => {
        const pct = tickCount <= 1 ? 0 : (index / (tickCount - 1)) * 100;
        return `<span class="practice-priority-axis-tick" style="left:${pct.toFixed(2)}%"></span>`;
    }).join('');
    const markerAnchorClass = positionPct === null
        ? ''
        : (positionPct <= 0 ? ' anchor-start' : (positionPct >= 100 ? ' anchor-end' : ' anchor-middle'));
    const markerOverflowClass = positionPct === null || !Number.isFinite(rawPositionPct)
        ? ''
        : (rawPositionPct < 0 ? ' overflow-start' : (rawPositionPct > 100 ? ' overflow-end' : ''));
    const markerHtml = positionPct === null
        ? ''
        : `
            <span class="practice-priority-axis-marker ${escapeHtml(markerClass)}${escapeHtml(markerAnchorClass)}${escapeHtml(markerOverflowClass)}" style="left:${positionPct.toFixed(2)}%">
                <span class="practice-priority-axis-marker-label">${escapeHtml(valueText)}</span>
            </span>
        `;
    return `
        <div class="practice-priority-axis">
            <div class="practice-priority-axis-track">
                <span class="practice-priority-axis-line"></span>
                ${ticksHtml}
                ${markerHtml}
            </div>
            <div class="practice-priority-axis-labels">
                <span class="practice-priority-axis-end">
                    <span class="practice-priority-axis-end-value">${escapeHtml(leftText)}</span>
                    ${leftNote ? `<span class="practice-priority-axis-end-note ${escapeHtml(leftNoteClass)}">${escapeHtml(leftNote)}</span>` : ''}
                </span>
                <span class="practice-priority-axis-end align-right">
                    <span class="practice-priority-axis-end-value">${escapeHtml(rightText)}</span>
                    ${rightNote ? `<span class="practice-priority-axis-end-note ${escapeHtml(rightNoteClass)}">${escapeHtml(rightNote)}</span>` : ''}
                </span>
            </div>
        </div>
    `;
}

function buildPracticePriorityLearningDotsHtml(attemptCount, targetAttempts) {
    const safeTarget = Math.max(1, Number.parseInt(targetAttempts, 10) || 5);
    const safeAttempts = Math.max(0, Number.parseInt(attemptCount, 10) || 0);
    const filledCount = Math.max(0, Math.min(safeTarget, safeAttempts));
    const dotsHtml = Array.from({ length: safeTarget }, (_, index) => (
        `<span class="practice-priority-learning-dot${index < filledCount ? ' filled' : ''}"></span>`
    )).join('');
    return `
        <div class="practice-priority-learning-visual">
            <div class="practice-priority-learning-dots" aria-hidden="true">${dotsHtml}</div>
            <div class="practice-priority-learning-caption">
                <span class="practice-priority-learning-caption-value">${escapeHtml(String(safeAttempts))} attempts</span>
                <span class="practice-priority-learning-caption-note">(target ${safeTarget})</span>
            </div>
        </div>
    `;
}

function buildPracticePriorityDetailCards(card) {
    const segments = getPracticePrioritySegments(card);
    const isNewCard = isNeverPracticedPriorityCard(card);
    const correctCount = Math.max(0, Number.parseInt(card && card.practice_priority_correct_count, 10) || 0);
    const wrongCount = Math.max(0, Number.parseInt(card && card.practice_priority_wrong_count, 10) || 0);
    const lifetimeAttempts = Math.max(0, Number.parseInt(card && card.practice_priority_attempt_count, 10) || 0);
    const correctRate = Number(card && card.practice_priority_correct_rate);
    const incorrectRate = Number.isFinite(correctRate) ? Math.max(0, 100 - correctRate) : null;
    const incorrectRateText = formatMetricPercent(incorrectRate);
    const avgCorrectResponseTimeText = formatMillisecondsAsSecondsOrMinutes(
        Number(card && card.practice_priority_avg_correct_response_time)
    );
    const subjectP50Text = formatMillisecondsAsSecondsOrMinutes(
        Number(card && card.practice_priority_subject_p50_correct_time)
    );
    const subjectP90Text = formatMillisecondsAsSecondsOrMinutes(
        Number(card && card.practice_priority_subject_p90_correct_time)
    );
    const lastResponseTimeText = formatMillisecondsAsSecondsOrMinutes(getCardLastResponseTimeValue(card));
    const lastResultText = formatCardLastResult(card);
    const lastResultTone = getPracticePriorityLastResultTone(card);
    const subjectCorrectSampleCount = Math.max(
        0,
        Number.parseInt(card && card.practice_priority_subject_correct_sample_count, 10) || 0
    );
    const p50Value = Number(card && card.practice_priority_subject_p50_correct_time);
    const p90Value = Number(card && card.practice_priority_subject_p90_correct_time);
    const avgCorrectValue = Number(card && card.practice_priority_avg_correct_response_time);
    const slowRange = Number.isFinite(p50Value) && Number.isFinite(p90Value) && p90Value > p50Value
        ? p90Value - p50Value
        : null;
    const slowBaselineReady = subjectCorrectSampleCount >= PRACTICE_PRIORITY_MIN_CORRECT_RECORDS_FOR_SPEED_BASELINE
        && Number.isFinite(p50Value)
        && Number.isFinite(p90Value)
        && p90Value > p50Value;
    const slowMarkerPct = slowRange
        ? ((avgCorrectValue - p50Value) / slowRange) * 100
        : null;
    const daysSinceLastSeen = getPracticePriorityDaysSinceLastSeenValue(card);
    const dueMarkerPct = Number.isFinite(daysSinceLastSeen)
        ? (daysSinceLastSeen / PRACTICE_PRIORITY_VERY_DUE_DAYS) * 100
        : null;

    return `
        <div class="practice-priority-detail-card missed${isType3Behavior() ? ' no-side' : ''}">
            ${isType3Behavior() ? '' : `<div class="practice-priority-detail-side">
                <div class="practice-priority-detail-title">${icon('circle-x', { size: 14 })}<span>${escapeHtml(getPracticePrioritySegmentDisplayLabel(card, segments[0]))}</span></div>
                <div class="practice-priority-detail-points">+${escapeHtml(formatPracticePriorityScore(segments[0].points))}</div>
            </div>`}
            <div class="practice-priority-detail-body">
                <div class="practice-priority-detail-text">
                    <div class="practice-priority-detail-main">Incorrect rate: <span class="practice-priority-inline-value missed">${escapeHtml(isNewCard ? '-' : incorrectRateText)}</span></div>
                    <div class="practice-priority-detail-sub">Correct ${escapeHtml(String(correctCount))} · Wrong ${escapeHtml(String(wrongCount))}</div>
                    <div class="practice-priority-detail-sub">Last result: <span class="practice-priority-last-result ${escapeHtml(lastResultTone)}">${escapeHtml(lastResultText)}</span></div>
                </div>
                <div class="practice-priority-detail-visual">
                    ${isNewCard
                        ? ''
                        : buildPracticePriorityDonutHtml({
                            correctPercent: correctRate,
                            toneClass: 'missed',
                            centerText: formatMetricPercent(correctRate),
                            centerClass: 'positive',
                        })
                    }
                </div>
            </div>
        </div>
        <div class="practice-priority-detail-card slow${(isType2Behavior() || isType3Behavior()) ? ' no-side' : ''}">
            ${(isType2Behavior() || isType3Behavior()) ? '' : `<div class="practice-priority-detail-side">
                <div class="practice-priority-detail-title">${icon('clock', { size: 14 })}<span>${escapeHtml(segments[1].label)}</span></div>
                <div class="practice-priority-detail-points">+${escapeHtml(formatPracticePriorityScore(segments[1].points))}</div>
            </div>`}
            <div class="practice-priority-detail-body">
                <div class="practice-priority-detail-text">
                    <div class="practice-priority-detail-main">Avg time: <span class="practice-priority-inline-value slow">${escapeHtml(avgCorrectResponseTimeText)}</span></div>
                    <div class="practice-priority-detail-sub">Last response: ${escapeHtml(lastResponseTimeText)}</div>
                </div>
                <div class="practice-priority-detail-visual">
                    ${slowBaselineReady
                        ? buildPracticePriorityAxisHtml({
                            positionPct: slowMarkerPct,
                            valueText: avgCorrectResponseTimeText,
                            leftText: subjectP50Text,
                            rightText: subjectP90Text,
                            leftNote: '(p50)',
                            rightNote: '(p90)',
                            leftNoteClass: 'positive',
                            rightNoteClass: 'negative',
                            markerClass: 'slow',
                            tickCount: 6,
                        })
                        : `<div class="practice-priority-axis-placeholder">Baseline after ${PRACTICE_PRIORITY_MIN_CORRECT_RECORDS_FOR_SPEED_BASELINE} subject-correct answers</div>`
                    }
                </div>
            </div>
        </div>
        <div class="practice-priority-detail-card learning">
            <div class="practice-priority-detail-side">
                <div class="practice-priority-detail-title">${icon('sparkles', { size: 14 })}<span>${escapeHtml(getPracticePrioritySegmentDisplayLabel(card, segments[2]))}</span></div>
                <div class="practice-priority-detail-points">+${escapeHtml(formatPracticePriorityScore(segments[2].points))}</div>
            </div>
            <div class="practice-priority-detail-body">
                <div class="practice-priority-detail-text">
                    <div class="practice-priority-detail-main">Lifetime attempts: <span class="practice-priority-inline-value learning">${escapeHtml(String(lifetimeAttempts))}</span></div>
                    <div class="practice-priority-detail-sub">More practice lowers learning need</div>
                </div>
                <div class="practice-priority-detail-visual">
                    ${buildPracticePriorityLearningDotsHtml(lifetimeAttempts, PRACTICE_PRIORITY_LEARNING_TARGET_ATTEMPTS)}
                </div>
            </div>
        </div>
        <div class="practice-priority-detail-card due">
            <div class="practice-priority-detail-side">
                <div class="practice-priority-detail-title">${icon('calendar-clock', { size: 14 })}<span>${escapeHtml(segments[3].label)}</span></div>
                <div class="practice-priority-detail-points">+${escapeHtml(formatPracticePriorityScore(segments[3].points))}</div>
            </div>
            <div class="practice-priority-detail-body">
                <div class="practice-priority-detail-text">
                    <div class="practice-priority-detail-main">${
                        Number.isFinite(daysSinceLastSeen)
                            ? `Last seen <span class="practice-priority-inline-value due">${escapeHtml(String(daysSinceLastSeen))} day${daysSinceLastSeen === 1 ? '' : 's'}</span> ago`
                            : 'Not practiced yet'
                    }</div>
                    <div class="practice-priority-detail-sub">Longer unseen gaps raise due need</div>
                </div>
                <div class="practice-priority-detail-visual">
                    ${isNewCard
                        ? ''
                        : buildPracticePriorityAxisHtml({
                            positionPct: dueMarkerPct,
                            valueText: Number.isFinite(daysSinceLastSeen) ? `${daysSinceLastSeen}d` : 'Never',
                            leftText: '0d',
                            rightText: `${PRACTICE_PRIORITY_VERY_DUE_DAYS}+d`,
                            leftNote: '(today)',
                            rightNote: '(very due)',
                            leftNoteClass: 'positive',
                            rightNoteClass: 'negative',
                            markerClass: 'due',
                            tickCount: 7,
                        })
                    }
                </div>
            </div>
        </div>
    `;
}

function buildPracticePriorityScoreSection(card) {
    if (!usesPracticePriorityDisplay()) {
        return '';
    }
    const score = getPracticePriorityScoreValue(card);
    if (!Number.isFinite(score) || score <= 0) {
        return '';
    }
    const segments = getPracticePrioritySegments(card);
    const referenceMaxScore = getPracticePriorityReferenceMaxScore();
    const scaleBase = Number.isFinite(referenceMaxScore) && referenceMaxScore > 0
        ? referenceMaxScore
        : score;
    const barHtml = segments
        .filter((segment) => segment.points > 0)
        .map((segment) => (
            `<span class="practice-priority-score-segment ${segment.key}" style="width:${Math.max(0, Math.min(100, (segment.points / scaleBase) * 100)).toFixed(2)}%" title="${escapeHtml(`${segment.label}: +${formatPracticePriorityScore(segment.points)}`)}"></span>`
        ))
        .join('');
    const order = Number(card && card.practice_priority_order);
    const activeCount = Array.isArray(sortedCards)
        ? sortedCards.filter((queueCard) => !queueCard.skip_practice).length
        : 0;
    const rankText = Number.isFinite(order) && order > 0
        ? `Rank #${order}${activeCount > 0 ? ` of ${activeCount}` : ''}`
        : '';
    const detailCardsHtml = buildPracticePriorityDetailCards(card);
    const primaryReasonLabel = getPracticePriorityPrimaryReasonLabel(card);
    const primaryReasonKey = getPracticePriorityPrimaryReasonKey(card);
    return `
        <div class="practice-priority-score-block">
            <div class="practice-priority-score-head">
                <span class="practice-priority-score-label">
                    <span class="practice-priority-score-reason ${escapeHtml(primaryReasonKey)}">${escapeHtml(primaryReasonLabel)}</span>
                    ${rankText ? `<span class="practice-priority-score-rank">· ${escapeHtml(rankText)}</span>` : ''}
                </span>
                <span class="practice-priority-score-head-right">
                    <span class="practice-priority-score-caption">Score</span>
                    <span class="practice-priority-score-value">${escapeHtml(formatPracticePriorityScore(score))}</span>
                </span>
            </div>
            <div class="practice-priority-score-bar" aria-hidden="true">
                ${barHtml}
            </div>
            ${detailCardsHtml ? `<div class="practice-priority-detail-grid">${detailCardsHtml}</div>` : ''}
        </div>
    `;
}

function getCardIdText(card) {
    const raw = String(card && card.id ? card.id : '').trim();
    return raw;
}

function getQueueHighlightMap(cards) {
    if (isType4Behavior()) {
        return new Map();
    }

    const targetCount = getSessionCardCountForMixLegend();
    if (targetCount <= 0) {
        return new Map();
    }

    if (usesPracticePriorityDisplay()) {
        const orderedQueueCards = window.PracticeManageCommon.sortCardsForView(
            (Array.isArray(cards) ? cards : []).filter((card) => {
                if (!card || card.skip_practice) {
                    return false;
                }
                const rawOrder = card.practice_priority_order;
                if (rawOrder === null || rawOrder === undefined || rawOrder === '') {
                    return false;
                }
                return Number.isFinite(Number(rawOrder));
            }),
            'new_queue'
        );
        const nextSessionCards = orderedQueueCards.slice(0, targetCount);
        if (!nextSessionCards.length) {
            return new Map();
        }
        const highlights = new Map();
        nextSessionCards.forEach((card) => {
            const cardId = getCardIdText(card);
            if (!cardId) {
                return;
            }
            highlights.set(cardId, getPracticePriorityCompactReason(card));
        });
        return highlights;
    }

    const isClassicQueue = isNextSessionQueueOrderSelected();
    if (!isClassicQueue) {
        return new Map();
    }

    const orderedQueueCards = window.PracticeManageCommon.sortCardsForView(
        (Array.isArray(cards) ? cards : []).filter((card) => {
            if (!card || card.skip_practice) {
                return false;
            }
            const rawOrder = card.next_session_order;
            if (rawOrder === null || rawOrder === undefined || rawOrder === '') {
                return false;
            }
            return Number.isFinite(Number(rawOrder));
        }),
        'queue'
    );
    const nextSessionCards = orderedQueueCards.slice(0, targetCount);
    if (!nextSessionCards.length) {
        return new Map();
    }

    let redPrefixCount = 0;
    while (
        redPrefixCount < nextSessionCards.length
        && String(nextSessionCards[redPrefixCount] && nextSessionCards[redPrefixCount].last_result || '').toLowerCase() === 'wrong'
    ) {
        redPrefixCount += 1;
    }

    const remainingSlots = Math.max(0, nextSessionCards.length - redPrefixCount);
    const hardPct = getHardCardPercentForMixLegend();
    const hardTarget = hardPct <= 0
        ? 0
        : Math.min(remainingSlots, Math.ceil((remainingSlots * hardPct) / 100));

    const highlights = new Map();
    nextSessionCards.forEach((card, index) => {
        const cardId = getCardIdText(card);
        if (!cardId) {
            return;
        }
        if (index < redPrefixCount) {
            highlights.set(cardId, 'last-failed');
            return;
        }
        if (index < redPrefixCount + hardTarget) {
            highlights.set(cardId, 'hard');
            return;
        }
        highlights.set(cardId, 'least');
    });
    return highlights;
}

function getVisibleCardsForDisplay(cards) {
    return getSortedCardsForDisplay(cards);
}

function updateCardsQueueLegendVisibility(cardCount = sortedCards.length) {
    if (!cardsQueueLegend) {
        return;
    }
    const shouldShow = usesPracticePriorityDisplay()
        && Number.parseInt(cardCount, 10) > 0;
    if (shouldShow) {
        const missedLegendHtml = isType3Behavior()
            ? ''
            : '<span class="cards-queue-legend-item missed"><span class="cards-queue-legend-dot" aria-hidden="true"></span>Missed</span>';
        const slowLegendHtml = (isType2Behavior() || isType3Behavior())
            ? ''
            : '<span class="cards-queue-legend-item slow"><span class="cards-queue-legend-dot" aria-hidden="true"></span>Slow</span>';
        cardsQueueLegend.innerHTML = `
            ${missedLegendHtml}
            ${slowLegendHtml}
            <span class="cards-queue-legend-item learning"><span class="cards-queue-legend-dot" aria-hidden="true"></span>Learning</span>
            <span class="cards-queue-legend-item due"><span class="cards-queue-legend-dot" aria-hidden="true"></span>Due</span>
            <span class="cards-queue-legend-item not-included"><span class="cards-queue-legend-dot" aria-hidden="true"></span>Not in next session</span>
        `;
    }
    cardsQueueLegend.classList.toggle('hidden', !shouldShow);
    cardsQueueLegend.setAttribute('aria-hidden', shouldShow ? 'false' : 'true');
}

function renderVisibleSkipActionButtons() {
    if (!skipVisibleCardsBtn || !unskipVisibleCardsBtn) {
        return;
    }
    const visibleCards = getVisibleCardsForDisplay(currentCards);
    const skipableCount = visibleCards.filter((card) => !card.skip_practice).length;
    const unskipableCount = visibleCards.filter((card) => !!card.skip_practice).length;
    const skipLabel = skipVisibleCardsBtn.querySelector('.cards-bulk-action-menu-item-text');
    const unskipLabel = unskipVisibleCardsBtn.querySelector('.cards-bulk-action-menu-item-text');
    if (skipLabel) {
        skipLabel.textContent = `Skip visible cards (${skipableCount})`;
    } else {
        skipVisibleCardsBtn.textContent = `Skip visible cards (${skipableCount})`;
    }
    if (unskipLabel) {
        unskipLabel.textContent = `Unskip visible cards (${unskipableCount})`;
    } else {
        unskipVisibleCardsBtn.textContent = `Unskip visible cards (${unskipableCount})`;
    }
    skipVisibleCardsBtn.disabled = isBulkSkipActionInFlight || skipableCount <= 0;
    unskipVisibleCardsBtn.disabled = isBulkSkipActionInFlight || unskipableCount <= 0;
}

function setCardsBulkActionMenuOpen(open) {
    if (!cardsBulkActionMenuBtn || !cardsBulkActionMenu) {
        return;
    }
    cardsBulkActionMenu.classList.toggle('hidden', !open);
    cardsBulkActionMenu.setAttribute('aria-hidden', open ? 'false' : 'true');
    cardsBulkActionMenuBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
}

function getSortOptionLabel(option) {
    if (!option) {
        return '';
    }
    const dataLabel = option.dataset && option.dataset.label;
    if (dataLabel) {
        return dataLabel;
    }
    return String(option.textContent || '').replace(/^\s*Sort by:\s*/i, '').trim();
}

function buildSortMenuItems() {
    if (!sortMenuPopover || !viewOrderSelect) {
        return;
    }
    sortMenuPopover.innerHTML = '';
    const options = Array.from(viewOrderSelect.querySelectorAll('option'));
    options.forEach((option) => {
        const item = document.createElement('button');
        item.type = 'button';
        item.className = 'sort-menu-item';
        item.setAttribute('role', 'menuitemradio');
        item.dataset.value = option.value;
        const label = getSortOptionLabel(option);
        item.innerHTML = `
            <svg class="sort-menu-item-check" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"></polyline></svg>
            <span class="sort-menu-item-label"></span>
        `;
        item.querySelector('.sort-menu-item-label').textContent = label;
        item.addEventListener('click', () => {
            if (item.disabled) {
                return;
            }
            if (viewOrderSelect.value !== option.value) {
                viewOrderSelect.value = option.value;
                viewOrderSelect.dispatchEvent(new Event('change', { bubbles: true }));
            }
            setSortMenuOpen(false);
            if (sortMenuBtn) {
                sortMenuBtn.focus();
            }
        });
        sortMenuPopover.appendChild(item);
    });
}

function syncSortMenuFromSelect() {
    if (!viewOrderSelect) {
        return;
    }
    const options = Array.from(viewOrderSelect.querySelectorAll('option'));
    const currentValue = viewOrderSelect.value;
    const selectedOption = options.find((opt) => opt.value === currentValue) || options[0];
    if (sortMenuBtnLabel && selectedOption) {
        sortMenuBtnLabel.textContent = `Sort by: ${getSortOptionLabel(selectedOption)}`;
    }
    if (!sortMenuPopover) {
        return;
    }
    const items = Array.from(sortMenuPopover.querySelectorAll('.sort-menu-item'));
    items.forEach((item) => {
        const value = item.dataset.value;
        const matchOption = options.find((opt) => opt.value === value);
        const isHidden = !!(matchOption && matchOption.hidden);
        const isDisabled = !!(matchOption && matchOption.disabled);
        item.style.display = isHidden ? 'none' : '';
        item.disabled = isDisabled;
        const isSelected = value === currentValue;
        item.classList.toggle('selected', isSelected);
        item.setAttribute('aria-checked', isSelected ? 'true' : 'false');
    });
}

function setSortMenuOpen(open) {
    if (!sortMenuBtn || !sortMenuPopover) {
        return;
    }
    sortMenuPopover.classList.toggle('hidden', !open);
    sortMenuPopover.setAttribute('aria-hidden', open ? 'false' : 'true');
    sortMenuBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
}

function isSortMenuOpen() {
    return !!(sortMenuPopover && !sortMenuPopover.classList.contains('hidden'));
}

function isCardsBulkActionMenuOpen() {
    return !!(cardsBulkActionMenu && !cardsBulkActionMenu.classList.contains('hidden'));
}

function renderCardViewModeButtons() {
    const isCompact = currentCardViewMode === 'short';
    if (cardViewModeCompactBtn) {
        cardViewModeCompactBtn.innerHTML = icon('layout-grid', { size: 16 });
        cardViewModeCompactBtn.classList.toggle('active', isCompact);
        cardViewModeCompactBtn.setAttribute('aria-pressed', isCompact ? 'true' : 'false');
    }
    if (cardViewModeExpandBtn) {
        cardViewModeExpandBtn.innerHTML = icon('rows-3', { size: 16 });
        cardViewModeExpandBtn.classList.toggle('active', !isCompact);
        cardViewModeExpandBtn.setAttribute('aria-pressed', isCompact ? 'false' : 'true');
    }
}

function setCardViewMode(nextMode) {
    const mode = String(nextMode || '').trim().toLowerCase();
    const resolved = isType4Behavior()
        ? 'long'
        : (mode === 'short' ? 'short' : 'long');
    if (resolved === currentCardViewMode) {
        return;
    }
    currentCardViewMode = resolved;
    if (resolved !== 'long') {
        expandedCompactCardIds.clear();
    }
    renderCardViewModeButtons();
    resetAndDisplayCards(currentCards);
}

function getSessionCardCountCap() {
    if (isType4Behavior()) {
        return null;
    }
    const parsed = Number.parseInt(currentSessionCardCountCap, 10);
    if (!Number.isInteger(parsed)) {
        return null;
    }
    return Math.max(0, parsed);
}

function applySessionCardCountInputCap() {
    if (!sessionCardCountInput) {
        return;
    }
    const cap = getSessionCardCountCap();
    if (cap === null) {
        sessionCardCountInput.removeAttribute('max');
        return;
    }
    sessionCardCountInput.max = String(cap);
}

function updateSessionCardCountCapFromCardsPayload(payload) {
    if (isType4Behavior()) {
        currentSessionCardCountCap = null;
        applySessionCardCountInputCap();
        return;
    }
    const practiceActiveCount = Number.parseInt(payload && payload.practice_active_card_count, 10);
    const activeCount = Number.parseInt(payload && payload.active_card_count, 10);
    const fallbackFromCards = Array.isArray(payload && payload.cards)
        ? payload.cards.filter((card) => !card.skip_practice).length
        : null;
    const resolved = Number.isInteger(practiceActiveCount)
        ? practiceActiveCount
        : (Number.isInteger(activeCount) ? activeCount : fallbackFromCards);
    if (!Number.isInteger(resolved)) {
        return;
    }
    currentSessionCardCountCap = Math.max(0, resolved);
    applySessionCardCountInputCap();
}

function clampSessionCardCount(rawValue) {
    const parsed = Number.parseInt(rawValue, 10);
    if (!Number.isInteger(parsed)) {
        return 0;
    }
    const cap = getSessionCardCountCap();
    if (cap === null) {
        return Math.max(0, parsed);
    }
    return Math.max(0, Math.min(cap, parsed));
}

function getSessionCardCountForMixLegend() {
    if (isType4Behavior()) {
        return getType4TotalCardsPerDay();
    }
    return clampSessionCardCount(sessionCardCountInput ? sessionCardCountInput.value : '');
}

function getHardCardPercentForMixLegend() {
    if (isType4Behavior()) {
        return 0;
    }
    if (!hardnessPercentSlider) {
        return 0;
    }
    const parsed = Number.parseInt(hardnessPercentSlider.value, 10);
    if (!Number.isInteger(parsed)) {
        return 0;
    }
    return Math.max(0, Math.min(100, parsed));
}

function formatCardCountLabel(count) {
    const safe = Math.max(0, Number.parseInt(count, 10) || 0);
    return `${safe} ${safe === 1 ? 'card' : 'cards'}`;
}

function updateHardnessSliderTrack(hardPct) {
    if (!hardnessPercentSlider) {
        return;
    }
    const hard = Math.max(0, Math.min(100, Number.parseInt(hardPct, 10) || 0));
    hardnessPercentSlider.style.background = `linear-gradient(90deg, ${NEXT_SESSION_HARD_COLOR} 0%, ${NEXT_SESSION_HARD_COLOR} ${hard}%, ${NEXT_SESSION_LEAST_COLOR} ${hard}%, ${NEXT_SESSION_LEAST_COLOR} 100%)`;
}

function updateQueueMixLegend() {
    if (isType4Behavior() || supportsPracticePriorityPreview()) {
        if (leastRecentMixSummary) {
            leastRecentMixSummary.textContent = '';
        }
        if (hardCardsMixSummary) {
            hardCardsMixSummary.textContent = '';
        }
        updateQueueSettingsSaveButtonState();
        renderDeckSetupSummary();
        return;
    }
    const totalCards = getSessionCardCountForMixLegend() || 0;
    const hardPct = getHardCardPercentForMixLegend();
    const leastPct = Math.max(0, 100 - hardPct);
    const hardCount = hardPct <= 0 ? 0 : Math.min(totalCards, Math.ceil((totalCards * hardPct) / 100));
    const leastCount = Math.max(0, totalCards - hardCount);
    if (leastRecentMixSummary) {
        leastRecentMixSummary.textContent = `${leastPct}% · ${formatCardCountLabel(leastCount)}`;
    }
    if (hardCardsMixSummary) {
        hardCardsMixSummary.textContent = `${hardPct}% · ${formatCardCountLabel(hardCount)}`;
    }
    updateHardnessSliderTrack(hardPct);
    updateQueueSettingsSaveButtonState();
    renderDeckSetupSummary();
}

function normalizeSessionCountInputValue() {
    const next = getSessionCardCountForMixLegend();
    if (sessionCardCountInput) {
        sessionCardCountInput.value = String(next);
        applySessionCardCountInputCap();
    }
    return next;
}

function normalizeHardSliderValue() {
    const next = getHardCardPercentForMixLegend();
    if (hardnessPercentSlider) {
        hardnessPercentSlider.value = String(next);
    }
    return next;
}

function setQueueSettingsBaseline(sessionCount, hardPct) {
    baselineSessionCardCount = clampSessionCardCount(sessionCount);
    baselineHardCardPercent = Math.max(0, Math.min(100, Number.parseInt(hardPct, 10) || 0));
    queueSettingsSaveSuccessText = supportsPracticePriorityPreview()
        ? `Saved ${baselineSessionCardCount} cards/day`
        : `Saved ${baselineHardCardPercent}% · ${baselineSessionCardCount}`;
    updateQueueSettingsSaveButtonState();
}

function hasQueueSettingsChanges() {
    if (isType4Behavior()) {
        return false;
    }
    const currentSessionCount = getSessionCardCountForMixLegend();
    const currentHardPct = getHardCardPercentForMixLegend();
    if (supportsPracticePriorityPreview()) {
        return currentSessionCount !== baselineSessionCardCount;
    }
    return currentSessionCount !== baselineSessionCardCount
        || currentHardPct !== baselineHardCardPercent;
}

function setQueueSettingsSaveButton(state, labelText) {
    if (!queueSettingsSaveBtn) {
        return;
    }
    queueSettingsSaveBtn.dataset.state = state;
    queueSettingsSaveBtn.disabled = state !== 'dirty';
    const labelEl = queueSettingsSaveBtn.querySelector('.queue-save-pill-label');
    if (labelEl) {
        labelEl.textContent = labelText;
    } else {
        queueSettingsSaveBtn.textContent = labelText;
    }
}

function updateQueueSettingsSaveButtonState() {
    if (!queueSettingsSaveBtn) {
        return;
    }
    if (isType4Behavior()) {
        setQueueSettingsSaveButton('saved', 'Saved');
        return;
    }
    if (isQueueSettingsSaving) {
        setQueueSettingsSaveButton('saving', 'Saving…');
        return;
    }
    const hasChanges = hasQueueSettingsChanges();
    if (hasChanges) {
        setQueueSettingsSaveButton('dirty', 'Save');
    } else {
        setQueueSettingsSaveButton('saved', 'Saved');
    }
}

function scheduleQueuePreviewReload() {
    if (isType4Behavior()) {
        return;
    }
    if (isQueueSettingsSaving) {
        return;
    }
    if (previewQueueTimer) {
        window.clearTimeout(previewQueueTimer);
        previewQueueTimer = null;
    }
    previewQueueTimer = window.setTimeout(() => {
        previewQueueTimer = null;
        void loadSharedDeckCards();
    }, 180);
}

function cancelQueuePreviewReload() {
    if (previewQueueTimer) {
        window.clearTimeout(previewQueueTimer);
        previewQueueTimer = null;
    }
}

function rerenderCompactCardsForQueuePreview() {
    if (currentCardViewMode !== 'short' || !Array.isArray(currentCards) || currentCards.length <= 0) {
        return;
    }
    displayCards(currentCards);
}

async function maybeAutoSetSessionCountForNewCards(previousCardCount, nextCardCount) {
    if (isType4Behavior()) {
        hasLoadedSharedCardsOnce = true;
        return;
    }
    if (!hasLoadedSharedCardsOnce) {
        hasLoadedSharedCardsOnce = true;
        return;
    }
    if (previousCardCount > 0 || nextCardCount <= 0) {
        return;
    }
    const currentSessionCount = getSessionCardCountForMixLegend();
    if (currentSessionCount > 0) {
        return;
    }

    const cap = getSessionCardCountCap();
    const defaultSessionCount = cap === null ? 10 : Math.min(10, cap);
    const hardPct = supportsPracticePriorityPreview() ? 0 : normalizeHardSliderValue();
    if (sessionCardCountInput) {
        sessionCardCountInput.value = String(defaultSessionCount);
    }
    updateQueueMixLegend();

    const response = await fetch(`${API_BASE}/kids/${kidId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            ...buildSessionCountPayload(defaultSessionCount),
            ...(!supportsPracticePriorityPreview() ? buildHardCardPercentPayload(hardPct) : {}),
        }),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
        throw new Error(result.error || `Failed to auto-set cards/day (HTTP ${response.status})`);
    }

    applySessionCountFromPayload(result);
    const persistedTotal = getCategoryIntValue(sessionCardCountByCategory);
    const persistedHard = supportsPracticePriorityPreview()
        ? 0
        : getPersistedHardCardPercentFromPayload(result);
    const safeTotal = clampSessionCardCount(persistedTotal);
    const safeHard = Math.max(0, Math.min(100, Number.parseInt(persistedHard, 10) || 0));
    if (sessionCardCountInput) {
        sessionCardCountInput.value = String(safeTotal);
    }
    if (hardnessPercentSlider && !supportsPracticePriorityPreview()) {
        hardnessPercentSlider.value = String(safeHard);
    }
    setQueueSettingsBaseline(safeTotal, safeHard);
    updateQueueMixLegend();
}

function buildCardReportHref(card) {
    const qs = new URLSearchParams();
    qs.set('id', String(kidId || ''));
    qs.set('cardId', String(card.id || ''));
    const reportFrom = currentSharedScope === SHARED_SCOPE_LESSON_READING
        ? 'lesson-reading'
        : (currentSharedScope === SHARED_SCOPE_TYPE2 ? 'type2' : 'cards');
    qs.set('from', reportFrom);
    if (categoryKey) {
        qs.set('categoryKey', categoryKey);
    }
    return `/kid-card-report.html?${qs.toString()}`;
}

function buildChineseCardMarkup(card, options = {}) {
    const backText = getChineseCardBackText(card.back);
    return buildCardMarkup(card, {
        cardClassNames: ['type1-chinese-card', ...(Array.isArray(options.cardClassNames) ? options.cardClassNames : [])],
        primaryText: card.front,
        showPrimary: false,
        secondaryHtml: getChineseCardBackHtml(card.back),
        showSecondary: backText.length > 0,
        prependControlsHtml: options.prependControlsHtml,
        trailingActionHtml: options.trailingActionHtml,
        extraSectionHtml: options.extraSectionHtml,
        queueHighlight: options.queueHighlight,
    });
}

function buildGenericType1CardMarkup(card, options = {}) {
    const secondaryText = String(card && card.back ? card.back : '');
    return buildCardMarkup(card, {
        cardClassNames: [...(Array.isArray(options.cardClassNames) ? options.cardClassNames : [])],
        primaryText: card.front,
        showPrimary: secondaryText.trim().length === 0,
        secondaryText,
        showSecondary: secondaryText.trim().length > 0,
        prependControlsHtml: options.prependControlsHtml,
        trailingActionHtml: options.trailingActionHtml,
        extraSectionHtml: options.extraSectionHtml,
        queueHighlight: options.queueHighlight,
    });
}

function buildType2CardMarkup(card, options = {}) {
    const hasSavedAudio = !!card.audio_url;
    const secondaryText = String(card.front || '');
    const promptHtml = `
        <div class="type2-prompt-row">
            <span class="type2-prompt-text">${escapeHtml(secondaryText)}</span>
            <span class="type2-prompt-actions">
                <button
                    type="button"
                    class="type2-prompt-btn edit"
                    data-action="edit-front"
                    data-card-id="${escapeHtml(card.id)}"
                >Edit</button>
                <button
                    type="button"
                    class="type2-prompt-btn play"
                    data-action="load-play-audio"
                    data-card-id="${escapeHtml(card.id)}"
                    aria-label="Play"
                    title="Play"
                ><svg width="14" height="14" viewBox="0 0 20 20" fill="currentColor"><polygon points="4,2 18,10 4,18"/></svg></button>
            </span>
        </div>
        ${hasSavedAudio ? '' : '<div class="type2-prompt-autogen-hint">Will auto-generate on first play</div>'}
    `;
    return buildCardMarkup(card, {
        cardClassNames: ['type2-card', ...(Array.isArray(options.cardClassNames) ? options.cardClassNames : [])],
        showPrimary: false,
        secondaryHtml: promptHtml,
        showSecondary: true,
        extraSectionHtml: options.extraSectionHtml,
        prependControlsHtml: options.prependControlsHtml,
        trailingActionHtml: options.trailingActionHtml,
        queueHighlight: options.queueHighlight,
    });
}

function formatMetricPercent(value) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) {
        return '-';
    }
    const normalized = Math.max(0, Math.min(100, numeric));
    const rounded = Math.round(normalized * 10) / 10;
    return Number.isInteger(rounded) ? `${rounded}%` : `${rounded.toFixed(1)}%`;
}

function formatMillisecondsAsSecondsOrMinutes(value) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric <= 0) {
        return '-';
    }
    const seconds = numeric / 1000;
    if (seconds >= 60) {
        const minutes = seconds / 60;
        const roundedMinutes = Math.round(minutes * 10) / 10;
        return Number.isInteger(roundedMinutes) ? `${roundedMinutes} min` : `${roundedMinutes.toFixed(1)} min`;
    }
    const roundedSeconds = Math.round(seconds * 10) / 10;
    return Number.isInteger(roundedSeconds) ? `${roundedSeconds}s` : `${roundedSeconds.toFixed(1)}s`;
}

function getCardOverallWrongRateValue(card) {
    const attempts = Number.parseInt(card && card.lifetime_attempts, 10);
    if (Number.isInteger(attempts) && attempts <= 0) {
        return null;
    }

    const explicit = Number(card && card.overall_wrong_rate);
    if (Number.isFinite(explicit)) {
        return explicit;
    }
    if (!Number.isInteger(attempts) || attempts <= 0) {
        return null;
    }
    if (isType2Behavior()) {
        const fallback = Number(card && card.hardness_score);
        return Number.isFinite(fallback) ? fallback : null;
    }
    return null;
}

function getCardOverallCorrectRateValue(card) {
    const wrongRate = getCardOverallWrongRateValue(card);
    if (!Number.isFinite(wrongRate)) {
        return null;
    }
    return 100 - wrongRate;
}

function getCardLastResponseTimeValue(card) {
    const explicit = Number(card && card.last_response_time_ms);
    if (Number.isFinite(explicit) && explicit > 0) {
        return explicit;
    }
    const attempts = Number.parseInt(card && card.lifetime_attempts, 10);
    if (!Number.isInteger(attempts) || attempts <= 0) {
        return null;
    }
    if (!isType2Behavior()) {
        const fallback = Number(card && card.hardness_score);
        return Number.isFinite(fallback) && fallback > 0 ? fallback : null;
    }
    return null;
}

function formatDeckPillName(rawName) {
    const text = String(rawName || '').trim();
    if (!text) {
        return '-';
    }
    return text
        .replace(/\s*\/\s*/g, '_')
        .replace(/\s+/g, '_')
        .replace(/_+/g, '_')
        .replace(/^_+|_+$/g, '');
}

function formatCardLastResult(card) {
    const value = String(card && card.last_result || '').toLowerCase();
    if (value === 'right') {
        return 'Right';
    }
    if (value === 'wrong') {
        return 'Wrong';
    }
    if (value === 'ungraded') {
        return 'Ungraded';
    }
    return '-';
}

function looksChineseText(rawText) {
    return /[\u3400-\u9fff]/u.test(String(rawText || ''));
}

function buildExpandedCardPreviewMarkup(card, options = {}) {
    const text = getCompactCardText(card) || '(empty)';
    const totalPracticed = Math.max(0, Number.parseInt(card && card.lifetime_attempts, 10) || 0);
    const classes = ['expanded-card-preview'];
    if (card && card.skip_practice) {
        classes.push('skipped');
    }
    const queueHighlight = String(options.queueHighlight || '').trim().toLowerCase();
    if (queueHighlight) {
        classes.push(`queue-${queueHighlight}`);
    }
    if (looksChineseText(text)) {
        classes.push('chinese');
    }
    return `
        <div class="${classes.join(' ')}" aria-hidden="true">
            <span class="expanded-card-preview-text">${renderMathHtml(text)}</span>
            <span class="expanded-card-preview-badge">${escapeHtml(String(totalPracticed))}</span>
        </div>
    `;
}

function buildCardMarkup(card, options = {}) {
    const classes = ['card-item', 'expanded-detail-card', ...(Array.isArray(options.cardClassNames) ? options.cardClassNames : [])];
    if (card.skip_practice) {
        classes.push('skipped');
    }
    const supportsSkipControl = !isType4Behavior();
    const primaryText = String(options.primaryText || '');
    const secondaryText = String(options.secondaryText || '');
    const secondaryHtml = String(options.secondaryHtml || '');
    const showPrimary = options.showPrimary !== false && primaryText.trim().length > 0;
    const showSecondary = options.showSecondary !== false
        && (secondaryHtml.trim().length > 0 || secondaryText.trim().length > 0);
    const extraSectionHtml = `${String(options.extraSectionHtml || '')}${buildPracticePriorityScoreSection(card)}`;
    const prependControlsHtml = String(options.prependControlsHtml || '');
    const trailingActionHtml = String(options.trailingActionHtml || '');
    const sourceRaw = resolveCardSourceDeckName(card);
    const sourceTitle = escapeHtml(sourceRaw);
    const sourceDisplay = escapeHtml(
        sourceRaw === getPersonalDeckDisplayName()
            ? sourceRaw
            : formatDeckPillName(sourceRaw)
    );
    const addedDateText = window.PracticeManageCommon.formatAddedDate(card && card.created_at);
    const firstPracticedDateText = card && card.first_practiced_at
        ? window.PracticeManageCommon.formatAddedDate(card.first_practiced_at)
        : 'Never';
    const metaItems = [
        { label: 'Added', value: String(addedDateText || '-') },
        { label: 'First Practice', value: String(firstPracticedDateText || '-') },
    ];
    const metaHtml = metaItems
        .map((item) => `
            <div class="expanded-card-meta-item">
                <span class="expanded-card-meta-label">${escapeHtml(item.label)}</span>
                <span class="expanded-card-meta-value">${escapeHtml(item.value)}</span>
            </div>
        `)
        .join('');

    return `
        <div class="${classes.filter(Boolean).join(' ')}">
            ${prependControlsHtml}
            <div class="expanded-card-hero">
                ${buildExpandedCardPreviewMarkup(card, { queueHighlight: options.queueHighlight })}
                <div class="expanded-card-main">
                    ${showPrimary ? `<div class="card-front">${renderMathHtml(primaryText)}</div>` : ''}
                    ${showSecondary ? `<div class="card-back${showPrimary ? '' : ' standalone'}">${secondaryHtml || escapeHtml(secondaryText)}</div>` : ''}
                    <div class="card-deck-row">
                        <span class="card-deck-pill" title="${sourceTitle}">${sourceDisplay}</span>
                    </div>
                </div>
            </div>
            ${extraSectionHtml}
            ${supportsSkipControl && card.skip_practice ? '<div class="skipped-note">Skipped from practice</div>' : ''}
            <div class="expanded-card-meta-row">
                ${metaHtml}
            </div>
            <div class="card-actions">
                <a class="card-report-link" href="${buildCardReportHref(card)}">${icon('history', { size: 16 })}<span>History</span></a>
                ${supportsSkipControl ? `<a
                    class="card-report-link"
                    href="#"
                    data-action="toggle-skip"
                    data-card-id="${card.id}"
                    data-skipped="${card.skip_practice ? 'true' : 'false'}"
                >${card.skip_practice ? `${icon('undo-2', { size: 16 })}<span>Unskip</span>` : `${icon('ban', { size: 16 })}<span>Skip</span>`}</a>` : ''}
                ${trailingActionHtml}
            </div>
        </div>
    `;
}

function buildType4RepresentativeCardMarkup(card) {
    const sourceRaw = resolveCardSourceDeckName(card);
    const sourceTitle = escapeHtml(sourceRaw);
    const sourceDisplay = escapeHtml(
        sourceRaw === getPersonalDeckDisplayName()
            ? sourceRaw
            : formatDeckPillName(sourceRaw)
    );
    const overallCorrectRateText = formatMetricPercent(getCardOverallCorrectRateValue(card));
    const addedDateText = window.PracticeManageCommon.formatAddedDate(card && card.created_at);
    const lastSeenText = window.PracticeManageCommon.formatLastSeenDays(card && card.last_seen_at);
    const lifetimeAttempts = Math.max(0, Number.parseInt(card && card.lifetime_attempts, 10) || 0);
    const isMultichoiceOnly = Boolean(card && card.type4_is_multichoice_only);

    return `
        <div class="card-item type4-summary-card">
            <div class="card-front">${renderMathHtml(String(card && card.front ? card.front : ''))}</div>
            <div class="card-deck-row">
                <span class="card-deck-pill" title="${sourceTitle}">${sourceDisplay}</span>
            </div>
            <div class="type4-summary-metrics">
                <div>Overall correct rate: ${escapeHtml(overallCorrectRateText)}</div>
                <div>Multi-choice only: ${isMultichoiceOnly ? 'Yes' : 'No'}</div>
                <div>Added: ${escapeHtml(String(addedDateText || '-'))}</div>
                <div>Lifetime attempts: ${escapeHtml(String(lifetimeAttempts))}</div>
                <div>Last seen: ${escapeHtml(String(lastSeenText || 'Never'))}</div>
            </div>
            <div class="card-actions type4-summary-actions">
                <button
                    type="button"
                    class="card-report-link type4-generator-trigger"
                    data-action="open-type4-generator"
                    data-card-id="${escapeHtml(String(card && card.id ? card.id : ''))}"
                >Generator</button>
                <button
                    type="button"
                    class="card-report-link"
                    data-action="open-card-records"
                    data-card-id="${escapeHtml(String(card && card.id ? card.id : ''))}"
                >${icon('history', { size: 16 })}<span>History</span></button>
            </div>
        </div>
    `;
}

function getCompactCardText(card) {
    if (isType2Behavior()) {
        return String(card && (card.back || card.front || '')).trim();
    }
    return String(card && (card.front || card.back || '')).trim();
}

function buildCompactCardMarkup(card, options = {}) {
    const text = getCompactCardText(card) || '(empty)';
    const classes = ['card-compact-pill'];
    if (card && card.skip_practice) {
        classes.push('skipped');
    }
    if (isChineseSpecificLogic) {
        classes.push('chinese');
    }
    const queueHighlight = String(options.queueHighlight || '').trim().toLowerCase();
    if (queueHighlight) {
        classes.push(`queue-${queueHighlight}`);
    }
    const scoreValue = usesPracticePriorityDisplay() ? getPracticePriorityScoreValue(card) : null;
    const titlePrefix = isType2Behavior() ? 'Back' : 'Front';
    const totalPracticed = Math.max(0, Number.parseInt(card && card.lifetime_attempts, 10) || 0);
    const cardId = getCardIdText(card);
    const highlightHint = queueHighlight === 'last-failed'
        ? ' • Next session: last failed'
        : (queueHighlight === 'hard'
            ? ' • Next session: hard'
            : (queueHighlight === 'least'
                ? ' • Next session: least practiced'
                : (
                    queueHighlight === PRACTICE_PRIORITY_REASON_MISSED
                        ? ' • Practice queue: missed recently'
                        : (
                            queueHighlight === PRACTICE_PRIORITY_REASON_SLOW
                                ? ' • Practice queue: slow / hesitant'
                                : (
                                    queueHighlight === PRACTICE_PRIORITY_REASON_LEARNING
                                        ? (
                                            isNeverPracticedPriorityCard(card)
                                                ? ' • Practice queue: new card'
                                                : ' • Practice queue: still learning'
                                        )
                                        : (
                                            queueHighlight === PRACTICE_PRIORITY_REASON_DUE
                                                ? ' • Practice queue: due for review'
                                                : ''
                                        )
                                )
                        )
                )));
    const scoreHint = Number.isFinite(scoreValue)
        ? ` • Priority score: ${formatPracticePriorityScore(scoreValue)}`
        : '';
    return `
        <button
            type="button"
            class="${classes.join(' ')}"
            data-action="expand-compact"
            data-card-id="${escapeHtml(cardId)}"
            title="${escapeHtml(`Open details • ${titlePrefix}: ${text}${highlightHint}${scoreHint}`)}"
            aria-label="${escapeHtml(`Open card details: ${text}${highlightHint}${scoreHint}`)}"
        >
            <span class="card-compact-pill-text">${escapeHtml(text)}</span>
            <span class="card-compact-count-badge" aria-hidden="true">${totalPracticed}</span>
        </button>
    `;
}

function buildCompactFoldButtonMarkup(cardId) {
    const safeId = String(cardId || '').trim();
    return `
        <button
            type="button"
            class="compact-fold-btn"
            data-action="collapse-compact"
            data-card-id="${escapeHtml(safeId)}"
            title="Minimize card"
            aria-label="Minimize card"
        >${icon('fold-vertical', { size: 20 })}</button>
    `;
}

function canDeleteExpandedCard(card) {
    return supportsPersonalDeckEditor()
        && Boolean(card && card.source_is_orphan)
        && Number.isInteger(Number.parseInt(card && card.id, 10));
}

function hasPracticedCardAttempts(card) {
    return Number.parseInt(card && card.lifetime_attempts, 10) > 0;
}

function buildExpandedCardDeleteButtonMarkup(card) {
    if (!canDeleteExpandedCard(card)) {
        return '';
    }
    const cardId = String(card && card.id ? card.id : '').trim();
    if (!cardId) {
        return '';
    }
    const isDisabled = hasPracticedCardAttempts(card);
    const title = isDisabled
        ? 'Cannot delete a card that already has practice history'
        : 'Delete this Personal Deck card';
    return `
        <button
            type="button"
            class="expanded-card-delete-btn"
            data-action="delete-personal-card"
            data-card-id="${escapeHtml(cardId)}"
            title="${escapeHtml(title)}"
            aria-label="${escapeHtml(title)}"
            ${isDisabled ? 'disabled aria-disabled="true"' : ''}
        >Delete</button>
    `;
}

function buildLongCardMarkup(card, options = {}) {
    if (isType4Behavior()) {
        return buildType4RepresentativeCardMarkup(card);
    }
    if (isType2Behavior()) {
        return buildType2CardMarkup(card, options);
    }
    return isChineseSpecificLogic
        ? buildChineseCardMarkup(card, options)
        : buildGenericType1CardMarkup(card, options);
}

function applyChineseCardFrontUniformSize() {
    if (!isChineseSpecificLogic || !cardsGrid) {
        return;
    }
    const hasChineseFront = !!cardsGrid.querySelector('.type1-chinese-card .card-front');
    if (!hasChineseFront) {
        cardsGrid.style.removeProperty('--type1-chinese-front-size-rem');
        return;
    }
    cardsGrid.style.setProperty('--type1-chinese-front-size-rem', `${CHINESE_FIXED_FRONT_SIZE_REM}rem`);
}

const CARD_RENDER_CHUNK_SIZE = 20;
let activeCardChunkObserver = null;

function renderCardsInChunks(totalCount, buildItemHtml, postBatchHook, options = {}) {
    if (activeCardChunkObserver) {
        activeCardChunkObserver.disconnect();
        activeCardChunkObserver = null;
    }
    cardsGrid.innerHTML = '';
    if (totalCount <= 0) {
        return;
    }

    const renderAll = !!options.renderAll;

    if (renderAll) {
        const parts = [];
        for (let i = 0; i < totalCount; i += 1) {
            parts.push(buildItemHtml(i));
        }
        cardsGrid.insertAdjacentHTML('beforeend', parts.join(''));
        if (typeof postBatchHook === 'function') {
            postBatchHook();
        }
        return;
    }

    const sentinel = document.createElement('div');
    sentinel.className = 'cards-chunk-sentinel';
    sentinel.style.gridColumn = '1 / -1';
    sentinel.style.height = '1px';
    sentinel.setAttribute('aria-hidden', 'true');
    cardsGrid.appendChild(sentinel);

    let renderedCount = 0;
    const renderNextChunk = () => {
        if (renderedCount >= totalCount) {
            return;
        }
        const end = Math.min(renderedCount + CARD_RENDER_CHUNK_SIZE, totalCount);
        const parts = [];
        for (let i = renderedCount; i < end; i += 1) {
            parts.push(buildItemHtml(i));
        }
        sentinel.insertAdjacentHTML('beforebegin', parts.join(''));
        renderedCount = end;
        if (typeof postBatchHook === 'function') {
            postBatchHook();
        }
        if (renderedCount >= totalCount) {
            if (activeCardChunkObserver) {
                activeCardChunkObserver.disconnect();
                activeCardChunkObserver = null;
            }
            sentinel.remove();
        }
    };

    renderNextChunk();

    while (renderedCount < totalCount) {
        const rect = sentinel.getBoundingClientRect();
        if (rect.top > window.innerHeight + 600) {
            break;
        }
        renderNextChunk();
    }

    if (renderedCount < totalCount) {
        if (typeof IntersectionObserver === 'function') {
            activeCardChunkObserver = new IntersectionObserver((entries) => {
                for (const entry of entries) {
                    if (entry.isIntersecting) {
                        renderNextChunk();
                    }
                }
            }, { rootMargin: '600px 0px 600px 0px' });
            activeCardChunkObserver.observe(sentinel);
        } else {
            while (renderedCount < totalCount) {
                renderNextChunk();
            }
        }
    }
}

function displayCards(cards) {
    sortedCards = getSortedCardsForDisplay(cards);
    const queueHighlightMap = getQueueHighlightMap(cards);
    updateCardsQueueLegendVisibility(sortedCards.length);

    if (mathCardCount) {
        mathCardCount.textContent = `(${sortedCards.length})`;
    }

    if (sortedCards.length === 0) {
        if (activeCardChunkObserver) {
            activeCardChunkObserver.disconnect();
            activeCardChunkObserver = null;
        }
        cardsGrid.innerHTML = `<div class="empty-state" style="grid-column: 1 / -1;"><h3>No cards in merged bank</h3></div>`;
        cardsGrid.classList.remove('short-view');
        cardsGrid.style.removeProperty('--type1-chinese-front-size-rem');
        renderVisibleSkipActionButtons();
        return;
    }

    const visibleCards = sortedCards;
    if (currentCardViewMode === 'long') {
        cardsGrid.classList.remove('short-view');
        renderCardsInChunks(
            visibleCards.length,
            (index) => {
                const card = visibleCards[index];
                const cardId = String(card && card.id ? card.id : '');
                return buildLongCardMarkup(card, {
                    trailingActionHtml: buildExpandedCardDeleteButtonMarkup(card),
                    queueHighlight: queueHighlightMap.get(cardId) || '',
                });
            },
            applyChineseCardFrontUniformSize,
        );
        renderVisibleSkipActionButtons();
        return;
    }

    const visibleIds = new Set(
        visibleCards
            .map((card) => String(card && card.id ? card.id : ''))
            .filter((value) => value.length > 0)
    );
    for (const expandedId of [...expandedCompactCardIds]) {
        if (!visibleIds.has(expandedId)) {
            expandedCompactCardIds.delete(expandedId);
        }
    }

    const hasExpandedCards = visibleCards.some((card) => expandedCompactCardIds.has(String(card && card.id ? card.id : '')));
    cardsGrid.classList.add('short-view');
    if (!hasExpandedCards) {
        cardsGrid.style.removeProperty('--type1-chinese-front-size-rem');
    }
    renderCardsInChunks(
        visibleCards.length,
        (index) => {
            const card = visibleCards[index];
            const cardId = String(card && card.id ? card.id : '');
            if (expandedCompactCardIds.has(cardId)) {
                return `<div class="short-expanded-slot">${buildLongCardMarkup(card, {
                    prependControlsHtml: buildCompactFoldButtonMarkup(cardId),
                    trailingActionHtml: buildExpandedCardDeleteButtonMarkup(card),
                    queueHighlight: queueHighlightMap.get(cardId) || '',
                })}</div>`;
            }
            return buildCompactCardMarkup(card, {
                queueHighlight: queueHighlightMap.get(cardId) || '',
            });
        },
        hasExpandedCards ? applyChineseCardFrontUniformSize : null,
        { renderAll: true },
    );
    renderVisibleSkipActionButtons();
}

function resetAndDisplayCards(cards) {
    displayCards(cards);
}

function updateAddReadingButtonCount() {
    if (!addReadingBtn || !chineseCharInput) {
        return;
    }
    if (isReadingBulkAdding) {
        addReadingBtn.textContent = 'Adding...';
        addReadingBtn.disabled = true;
        return;
    }
    const csvMode = isType1ChineseEnglishBackMode();
    let dedupStats;
    if (csvMode) {
        dedupStats = getType1EnglishBackBulkInputStats(chineseCharInput.value);
    } else if (isType2Behavior()) {
        dedupStats = getType2ChineseBulkInputStats(chineseCharInput.value);
    } else {
        dedupStats = getType1ChineseBulkInputStats(chineseCharInput.value);
    }
    const hasInput = String(chineseCharInput.value || '').trim().length > 0;
    addReadingBtn.disabled = csvMode ? !hasInput : dedupStats.uniqueCount <= 0;
    if (dedupStats.uniqueCount > 0) {
        const countText = dedupStats.dedupedCount > 0
            ? `${dedupStats.uniqueCount}, dedup ${dedupStats.dedupedCount}`
            : `${dedupStats.uniqueCount}`;
        addReadingBtn.textContent = `Bulk Add (${countText})`;
        return;
    }
    addReadingBtn.textContent = 'Bulk Add';
}

function setReadingBulkAddBusy(isBusy) {
    if (!addReadingBtn || !chineseCharInput) {
        return;
    }
    isReadingBulkAdding = !!isBusy;
    addReadingBtn.disabled = isReadingBulkAdding;
    chineseCharInput.disabled = isReadingBulkAdding;
    updateAddReadingButtonCount();
}

function getType1ChineseBulkInputStats(text) {
    const matches = String(text || '').match(/\p{Script=Han}/gu);
    const values = Array.isArray(matches) ? matches : [];
    const uniqueValues = [...new Set(values)];
    return {
        totalCount: values.length,
        uniqueCount: uniqueValues.length,
        dedupedCount: Math.max(0, values.length - uniqueValues.length),
        uniqueValues,
    };
}

function getType2ChineseBulkInputStats(text) {
    const matches = String(text || '').match(/[\u3400-\u9FFF\uF900-\uFAFF]+/g);
    const rawValues = Array.isArray(matches) ? matches : [];
    const values = rawValues
        .map((token) => String(token || '').trim())
        .filter((token) => token.length > 0);
    const uniqueValues = [...new Set(values)];
    return {
        totalCount: values.length,
        uniqueCount: uniqueValues.length,
        dedupedCount: Math.max(0, values.length - uniqueValues.length),
        uniqueValues,
    };
}

function getType1EnglishBackBulkInputStats(text) {
    const lines = String(text || '').split(/\r?\n/);
    const entries = [];
    const errors = [];
    const seenFronts = new Set();
    let dedupedCount = 0;
    lines.forEach((rawLine, idx) => {
        const line = String(rawLine || '').trim();
        if (!line) {
            return;
        }
        const lineNumber = idx + 1;
        const commaIdx = line.indexOf(',');
        if (commaIdx < 0) {
            errors.push({ lineNumber, line });
            return;
        }
        const front = line.slice(0, commaIdx).trim();
        const back = line.slice(commaIdx + 1).trim();
        if (!front || !back || !/^[\u3400-\u9FFF\uF900-\uFAFF]+$/.test(front)) {
            errors.push({ lineNumber, line });
            return;
        }
        if (seenFronts.has(front)) {
            dedupedCount += 1;
            return;
        }
        seenFronts.add(front);
        entries.push({ front, back });
    });
    return {
        entries,
        errors,
        totalCount: entries.length + dedupedCount,
        uniqueCount: entries.length,
        dedupedCount,
    };
}

async function loadSharedDeckCards() {
    const requestId = sharedDeckCardsResponseTracker
        ? sharedDeckCardsResponseTracker.begin()
        : 0;
    try {
        const url = new URL(buildSharedDeckApiUrl('shared-decks/cards'));
        const previewRaw = Number.parseInt(getHardCardPercentForMixLegend(), 10);
        const previewHardPct = Number.isInteger(previewRaw)
            ? Math.max(0, Math.min(100, previewRaw))
            : null;
        if (!supportsPracticePriorityPreview() && previewHardPct !== null) {
            url.searchParams.set('hard_card_percentage', String(previewHardPct));
        }
        const response = await fetch(url.toString());
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
            throw new Error(data.error || `Failed to load merged cards (HTTP ${response.status})`);
        }
        if (sharedDeckCardsResponseTracker && !sharedDeckCardsResponseTracker.shouldApply(requestId)) {
            return;
        }

        const hadQueueSettingChanges = hasQueueSettingsChanges();
        const previousCardCount = Array.isArray(currentCards) ? currentCards.length : 0;
        currentCards = Array.isArray(data.cards) ? data.cards : [];
        currentDailyProgressRows = Array.isArray(data.daily_progress_rows) ? data.daily_progress_rows : [];
        currentFamilyTimezone = String(data.family_timezone || '').trim();
        updateSessionCardCountCapFromCardsPayload(data);
        const normalizedSessionCount = normalizeSessionCountInputValue();
        if (!hadQueueSettingChanges) {
            setQueueSettingsBaseline(
                normalizedSessionCount,
                supportsPracticePriorityPreview() ? 0 : getHardCardPercentForMixLegend(),
            );
        }
        await maybeAutoSetSessionCountForNewCards(previousCardCount, currentCards.length);
        updateQueueMixLegend();

        const skippedCount = Number.isInteger(Number.parseInt(data.skipped_card_count, 10))
            ? Number.parseInt(data.skipped_card_count, 10)
            : currentCards.filter((card) => !!card.skip_practice).length;
        currentSkippedCardCount = skippedCount;
        resetAndDisplayCards(currentCards);
        if (currentCardsViewMode === 'stats') {
            renderStatsView();
        }
    } catch (error) {
        console.error('Error loading shared category cards:', error);
        showError(error.message || `Failed to load shared ${getCurrentCategoryDisplayName()} cards.`);
    }
}

async function updateSharedType1CardSkip(cardId, skipped, options = {}) {
    const reloadCards = options.reloadCards !== false;
    const response = await fetch(buildSharedDeckApiUrl(`shared-decks/cards/${cardId}/skip`), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ skipped })
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
        throw new Error(result.error || `Failed to update skip (HTTP ${response.status})`);
    }
    if (reloadCards) {
        await loadSharedDeckCards();
    }
    showError('');
}

async function updateSharedType1CardsSkipBulk(cardIds, skipped) {
    const normalizedIds = [...new Set(
        (Array.isArray(cardIds) ? cardIds : [])
            .map((value) => Number.parseInt(value, 10))
            .filter((value) => Number.isInteger(value))
    )];
    if (normalizedIds.length <= 0) {
        return { updated_count: 0, skip_practice: Boolean(skipped) };
    }
    const response = await fetch(buildSharedDeckApiUrl('shared-decks/cards/skip-bulk'), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            card_ids: normalizedIds,
            skipped: Boolean(skipped),
        }),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
        throw new Error(result.error || `Failed to update skip (HTTP ${response.status})`);
    }
    showError('');
    return result;
}

async function applyVisibleCardsSkip(targetSkipped) {
    if (isBulkSkipActionInFlight) {
        return;
    }
    const visibleCards = getVisibleCardsForDisplay(currentCards);
    const cardsToUpdate = visibleCards.filter((card) => Boolean(card.skip_practice) !== Boolean(targetSkipped));
    if (cardsToUpdate.length <= 0) {
        renderVisibleSkipActionButtons();
        return;
    }
    isBulkSkipActionInFlight = true;
    renderVisibleSkipActionButtons();
    try {
        showError('');
        showSuccess('');
        showCardsBulkActionMessage('');
        const cardIds = cardsToUpdate.map((card) => Number.parseInt(card && card.id, 10)).filter((id) => Number.isInteger(id));
        const result = await updateSharedType1CardsSkipBulk(cardIds, targetSkipped);
        const successCount = Math.max(0, Number.parseInt(result && result.updated_count, 10) || 0);
        const failedCount = Math.max(0, cardIds.length - successCount);
        await loadSharedDeckCards();
        if (failedCount > 0 && successCount > 0) {
            showCardsBulkActionMessage(
                `${targetSkipped ? 'Skipped' : 'Unskipped'} ${successCount} shown card(s); failed ${failedCount}.`,
                true
            );
        } else if (failedCount > 0) {
            showCardsBulkActionMessage(`Failed to update ${failedCount} shown card(s).`, true);
        } else if (successCount > 0) {
            showCardsBulkActionMessage(`${targetSkipped ? 'Skipped' : 'Unskipped'} ${successCount} shown card(s).`, false);
        }
    } catch (error) {
        console.error('Error applying bulk skip to shown cards:', error);
        showCardsBulkActionMessage(error.message || 'Failed to update shown cards.', true);
    } finally {
        isBulkSkipActionInFlight = false;
        renderVisibleSkipActionButtons();
    }
}

async function addOrphanCards() {
    if (!isChineseSpecificLogic || isReadingBulkAdding) {
        return;
    }
    try {
        setReadingBulkAddBusy(true);
        showStatusMessage('');
        showError('');
        showSuccess('');

        const input = String(chineseCharInput ? chineseCharInput.value : '').trim();
        if (isType2Behavior()) {
            const tokenCount = getType2ChineseBulkInputStats(input).uniqueCount;
            if (tokenCount === 0) {
                showError('Please enter at least one Chinese word/phrase');
                return;
            }

            const response = await fetch(buildType2ApiUrl('cards/bulk'), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    categoryKey,
                    text: input,
                }),
            });
            const result = await response.json().catch(() => ({}));
            if (!response.ok) {
                throw new Error(result.error || `Failed to add cards (HTTP ${response.status})`);
            }
            const inserted = Math.max(0, Number(result.inserted_count) || 0);
            addCardForm.reset();
            updateAddReadingButtonCount();
            showStatusMessage(buildBulkAddStatusMessage(inserted, result), false);
            await loadSharedType1Decks();
            return;
        }

        let cardsPayload;
        if (isType1ChineseEnglishBackMode()) {
            const stats = getType1EnglishBackBulkInputStats(input);
            if (stats.errors.length > 0) {
                const badLines = stats.errors.slice(0, 3).map((e) => `line ${e.lineNumber}`).join(', ');
                const more = stats.errors.length > 3 ? ` (+${stats.errors.length - 3} more)` : '';
                showStatusMessage(`Invalid format on ${badLines}${more}. ${TYPE1_ENGLISH_BACK_FORMAT_HINT}`, true);
                return;
            }
            if (stats.entries.length === 0) {
                showStatusMessage(`No entries to add. ${TYPE1_ENGLISH_BACK_FORMAT_HINT}`, true);
                return;
            }
            cardsPayload = stats.entries;
        } else {
            const chineseChars = getType1ChineseBulkInputStats(input).uniqueValues;
            if (chineseChars.length === 0) {
                showError('Please enter at least one Chinese character');
                return;
            }
            cardsPayload = chineseChars.map((ch) => ({ front: ch, back: '' }));
        }

        const addUrl = withCategoryKey(new URL(`${API_BASE}/kids/${kidId}/cards/bulk`));
        const response = await fetch(addUrl.toString(), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                categoryKey,
                cards: cardsPayload,
            }),
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok) {
            throw new Error(result.error || `Failed to add cards (HTTP ${response.status})`);
        }

        const inserted = Math.max(0, Number(result.created) || 0);
        addCardForm.reset();
        updateAddReadingButtonCount();
        showStatusMessage(buildBulkAddStatusMessage(inserted, result), false);
        await loadSharedType1Decks();
    } catch (error) {
        console.error('Error adding orphan cards:', error);
        showStatusMessage('');
        showError(error.message || 'Failed to add cards.');
    } finally {
        setReadingBulkAddBusy(false);
    }
}

async function editType2CardPrompt(cardId) {
    if (!isType2Behavior()) {
        return;
    }
    try {
        const targetCard = (Array.isArray(currentCards) ? currentCards : []).find((card) => String(card.id) === String(cardId));
        if (!targetCard) {
            showError('Card not found.');
            return;
        }

        const currentFront = String(targetCard.front || '').trim();
        const nextFrontRaw = window.prompt('Edit voice prompt (front):', currentFront);
        if (nextFrontRaw === null) {
            return;
        }
        const nextFront = String(nextFrontRaw || '').trim();
        if (!nextFront) {
            showError('Prompt text cannot be empty.');
            return;
        }
        if (nextFront === currentFront) {
            return;
        }

        const response = await fetch(buildType2ApiUrl(`cards/${encodeURIComponent(cardId)}`), {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                front: nextFront,
                categoryKey,
            }),
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
            throw new Error(payload.error || `HTTP ${response.status}`);
        }
        showError('');
        showSuccess('Prompt updated.');
        await loadSharedType1Decks();
    } catch (error) {
        showError(error.message || 'Failed to update voice prompt');
    }
}

async function deleteExpandedPersonalCard(cardId) {
    const targetCard = (Array.isArray(currentCards) ? currentCards : []).find((card) => String(card && card.id) === String(cardId));
    if (!targetCard) {
        showError('Card not found.');
        return;
    }
    if (!canDeleteExpandedCard(targetCard)) {
        showError('Only Personal Deck cards can be deleted here.');
        return;
    }
    if (hasPracticedCardAttempts(targetCard)) {
        showError('Cards with practice history cannot be deleted.');
        return;
    }

    const requestUrl = isType2Behavior()
        ? buildType2ApiUrl(`cards/${encodeURIComponent(cardId)}`)
        : buildType1PersonalCardApiUrl(cardId);
    const response = await fetch(requestUrl, {
        method: 'DELETE',
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
        showError(result.error || 'Failed to delete card.');
        return;
    }

    expandedCompactCardIds.delete(String(cardId));
    showError('');
    showSuccess('Card deleted.');
    await loadSharedType1Decks();
}

async function handleCardsGridClick(event) {
    const actionBtn = event.target.closest('[data-action]');
    if (!actionBtn) {
        return;
    }
    const action = actionBtn.dataset.action;

    if (action === 'open-type4-generator') {
        const cardId = String(actionBtn.dataset.cardId || '').trim();
        if (!cardId) {
            return;
        }
        const card = (Array.isArray(currentCards) ? currentCards : []).find(
            (item) => String(item && item.id ? item.id : '') === cardId
        );
        if (!card) {
            showError('Representative card not found.');
            return;
        }
        openType4GeneratorModal(card);
        return;
    }

    if (action === 'open-card-records') {
        const cardId = String(actionBtn.dataset.cardId || '').trim();
        if (!cardId) {
            return;
        }
        const card = (Array.isArray(currentCards) ? currentCards : []).find(
            (item) => String(item && item.id ? item.id : '') === cardId
        );
        if (!card) {
            showError('Card not found.');
            return;
        }
        window.location.href = buildCardReportHref(card);
        return;
    }

    if (action === 'expand-compact') {
        const cardId = String(actionBtn.dataset.cardId || '').trim();
        if (!cardId) {
            return;
        }
        expandedCompactCardIds.add(cardId);
        displayCards(currentCards);
        return;
    }

    if (action === 'collapse-compact') {
        const cardId = String(actionBtn.dataset.cardId || '').trim();
        if (!cardId || !expandedCompactCardIds.has(cardId)) {
            return;
        }
        expandedCompactCardIds.delete(cardId);
        if (currentCardViewMode === 'long') {
            currentCardViewMode = 'short';
            renderCardViewModeButtons();
        }
        displayCards(currentCards);
        return;
    }

    if (action === 'load-play-audio') {
        const cardId = actionBtn.dataset.cardId;
        if (!cardId) {
            return;
        }
        const targetCard = (Array.isArray(currentCards) ? currentCards : []).find((card) => String(card.id) === String(cardId));
        if (!targetCard) {
            showError('Card not found.');
            return;
        }
        if (!promptPreviewPlayer) {
            showError('Audio player unavailable on this page.');
            return;
        }
        const promptUrls = promptPreviewPlayer.buildPromptUrls(targetCard);
        if (promptUrls.length === 0) {
            showError('No audio found for this card.');
            return;
        }
        showError('');
        promptPreviewPlayer.playUrls(promptUrls);
        return;
    }

    if (action === 'edit-front') {
        const cardId = actionBtn.dataset.cardId;
        if (!cardId) {
            return;
        }
        await editType2CardPrompt(cardId);
        return;
    }

    if (action === 'delete-personal-card') {
        const cardId = actionBtn.dataset.cardId;
        if (!cardId) {
            return;
        }
        try {
            actionBtn.disabled = true;
            await deleteExpandedPersonalCard(cardId);
        } finally {
            actionBtn.disabled = false;
        }
        return;
    }

    if (action !== 'toggle-skip') {
        return;
    }
    event.preventDefault();

    const cardId = actionBtn.dataset.cardId;
    if (!cardId) {
        return;
    }

    const currentlySkipped = actionBtn.dataset.skipped === 'true';
    const targetSkipped = !currentlySkipped;
    try {
        actionBtn.disabled = true;
        if (isBulkSkipActionInFlight) {
            return;
        }
        await updateSharedType1CardSkip(cardId, targetSkipped);
    } catch (error) {
        console.error('Error updating shared category card skip:', error);
        showError(error.message || 'Failed to update skip status.');
    } finally {
        actionBtn.disabled = false;
    }
}

async function loadKidInfo() {
    const response = await fetch(`${API_BASE}/kids/${kidId}?view=manage`);
    const kid = await response.json().catch(() => ({}));
    if (!response.ok) {
        throw new Error(kid.error || `Failed to load kid (HTTP ${response.status})`);
    }

    const categoryMetaMap = getDeckCategoryMetaMap(kid);
    const categoryMeta = categoryMetaMap[categoryKey] || {};
    const displayName = String(categoryMeta && categoryMeta.display_name ? categoryMeta.display_name : '').trim();
    const behaviorType = String(categoryMeta && categoryMeta.behavior_type ? categoryMeta.behavior_type : '')
        .trim()
        .toLowerCase();
    if (
        behaviorType !== BEHAVIOR_TYPE_TYPE_I
        && behaviorType !== BEHAVIOR_TYPE_TYPE_II
        && behaviorType !== BEHAVIOR_TYPE_TYPE_III
        && behaviorType !== BEHAVIOR_TYPE_TYPE_IV
    ) {
        throw new Error(`Unsupported manage behavior type: ${behaviorType || 'unknown'}`);
    }
    currentBehaviorType = behaviorType;
    document.body.classList.toggle('type4-manage', behaviorType === BEHAVIOR_TYPE_TYPE_IV);
    currentSharedScope = (
        behaviorType === BEHAVIOR_TYPE_TYPE_IV
            ? SHARED_SCOPE_TYPE4
            : (
                behaviorType === BEHAVIOR_TYPE_TYPE_III
            ? SHARED_SCOPE_LESSON_READING
                    : (behaviorType === BEHAVIOR_TYPE_TYPE_II ? SHARED_SCOPE_TYPE2 : SHARED_SCOPE_CARDS)
            )
    );

    isChineseSpecificLogic = Boolean(categoryMeta && categoryMeta.has_chinese_specific_logic);
    currentChineseBackContent = String(categoryMeta && categoryMeta.chinese_back_content ? categoryMeta.chinese_back_content : '').trim().toLowerCase();
    currentCategoryDisplayName = displayName;
    currentKidName = String(kid.name || '').trim();
    applyCategoryUiText();

    window.PracticeManageCommon.applyKidManageTabVisibility({
        kidId,
        optedInCategoryKeys: kid.optedInDeckCategoryKeys,
        deckCategoryMetaByKey: kid.deckCategoryMetaByKey,
        defaultCategoryByRoute: {
            '/kid-card-manage.html': categoryKey,
        },
    });

    kidNameEl.textContent = 'Card Management';
    includeOrphanByCategory = toCategoryMap(kid[INCLUDE_ORPHAN_BY_CATEGORY_FIELD]);
    const total = getSessionCountFromKid(kid);
    const safeTotal = Number.isInteger(total) ? clampSessionCardCount(total) : 0;
    if (sessionCardCountInput) {
        sessionCardCountInput.value = String(safeTotal);
    }
    initialHardCardPercent = supportsPracticePriorityPreview()
        ? 0
        : getInitialHardCardPercentFromKid(kid);
    const safeHard = Number.isInteger(initialHardCardPercent)
        ? Math.max(0, Math.min(100, initialHardCardPercent))
        : 0;
    if (hardnessPercentSlider) {
        hardnessPercentSlider.value = String(safeHard);
    }
    syncType4CardOrderOptions();
    setQueueSettingsBaseline(safeTotal, safeHard);
    updateQueueMixLegend();
}

async function loadSharedType1Decks(options = {}) {
    const response = await fetch(buildSharedDeckApiUrl('shared-decks'));
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
        throw new Error(result.error || `Failed to load predefined decks (HTTP ${response.status})`);
    }
    allDecks = Array.isArray(result.decks) ? result.decks : [];
    baselineOptedDeckIdSet = new Set(
        allDecks
            .filter((deck) => Boolean(deck.opted_in))
            .map((deck) => Number(deck.deck_id))
            .filter((deckId) => deckId > 0)
    );
    stagedOptedDeckIdSet = new Set(baselineOptedDeckIdSet);
    orphanDeck = result && typeof result.orphan_deck === 'object' && result.orphan_deck
        ? result.orphan_deck
        : null;

    const responseTotal = Number.parseInt(result.session_card_count, 10);
    if (Number.isInteger(responseTotal)) {
        const safeTotal = clampSessionCardCount(responseTotal);
        if (sessionCardCountInput) {
            sessionCardCountInput.value = String(safeTotal);
        }
        setQueueSettingsBaseline(
            safeTotal,
            supportsPracticePriorityPreview() ? 0 : baselineHardCardPercent,
        );
    }
    baselineIncludeOrphanInQueue = Boolean(result && result.include_orphan_in_queue);
    stagedIncludeOrphanInQueue = baselineIncludeOrphanInQueue;

    renderDeckPendingInfo();
    updateQueueMixLegend();
    if (!options.skipCards) {
        await loadSharedDeckCards();
    }
}

async function saveQueueSettings() {
    if (isType4Behavior()) {
        return;
    }
    showError('');

    const total = normalizeSessionCountInputValue();
    const hardPct = supportsPracticePriorityPreview() ? 0 : normalizeHardSliderValue();
    const maxSessionCount = getSessionCardCountCap();
    if (total < 0) {
        showError(`${getCurrentCategoryDisplayName()} cards/day must be 0 or more.`);
        return;
    }
    if (maxSessionCount !== null && total > maxSessionCount) {
        showError(`${getCurrentCategoryDisplayName()} cards/day must be between 0 and ${maxSessionCount}.`);
        return;
    }
    if (!supportsPracticePriorityPreview() && (hardPct < 0 || hardPct > 100)) {
        showError('Hard cards % must be between 0 and 100.');
        return;
    }
    if (!hasQueueSettingsChanges()) {
        updateQueueSettingsSaveButtonState();
        return;
    }
    cancelQueuePreviewReload();
    isQueueSettingsSaving = true;
    updateQueueSettingsSaveButtonState();
    const response = await fetch(`${API_BASE}/kids/${kidId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            ...buildSessionCountPayload(total),
            ...(!supportsPracticePriorityPreview() ? buildHardCardPercentPayload(hardPct) : {}),
        }),
    });
    try {
        const result = await response.json().catch(() => ({}));
        if (!response.ok) {
            throw new Error(result.error || `Failed to save settings (HTTP ${response.status})`);
        }
        applySessionCountFromPayload(result);
        const persistedTotal = getCategoryIntValue(sessionCardCountByCategory);
        const persistedHard = supportsPracticePriorityPreview()
            ? 0
            : getPersistedHardCardPercentFromPayload(result);
        sessionCardCountInput.value = String(clampSessionCardCount(persistedTotal));
        if (hardnessPercentSlider && !supportsPracticePriorityPreview()) {
            hardnessPercentSlider.value = String(Math.max(0, Math.min(100, persistedHard)));
        }
        setQueueSettingsBaseline(
            sessionCardCountInput.value,
            supportsPracticePriorityPreview()
                ? 0
                : (hardnessPercentSlider ? hardnessPercentSlider.value : persistedHard),
        );
        updateQueueMixLegend();
        await loadSharedDeckCards();
    } finally {
        isQueueSettingsSaving = false;
        updateQueueSettingsSaveButtonState();
    }
}

async function saveType4DeckCounts() {
    if (!isType4Behavior()) {
        return;
    }
    if (isType4DeckCountsSaving) {
        return;
    }
    const countEntries = getPersistedType4DeckCountEntries();
    if (countEntries.length <= 0) {
        showType4DeckCountsMessage('Opt in at least one deck or Personal Deck first.', true);
        return;
    }
    isType4DeckCountsSaving = true;
    renderType4DeckTargetControls();
    if (saveType4DeckCountsBtn) {
        saveType4DeckCountsBtn.disabled = true;
        saveType4DeckCountsBtn.textContent = 'Saving...';
    }
    showType4DeckCountsMessage('');
    try {
        const payload = collectType4DeckCountsPayload();
        await requestSaveType4DeckDailyTargets(payload);
        await loadSharedType1Decks();
        renderType4DeckCountsModal();
        showType4DeckCountsMessage('Deck counts saved.');
    } finally {
        isType4DeckCountsSaving = false;
        renderType4DeckTargetControls();
        if (saveType4DeckCountsBtn) {
            saveType4DeckCountsBtn.textContent = 'Save';
        }
        updateType4DeckCountsSaveBtn();
    }
}

async function requestOptInDeckIds(deckIds) {
    const body = { deck_ids: deckIds, categoryKey };
    const response = await fetch(buildSharedDeckApiUrl('shared-decks/opt-in'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
        throw new Error(result.error || `Failed to opt in decks (HTTP ${response.status})`);
    }
    return result;
}

async function requestOptOutDeckIds(deckIds) {
    const body = { deck_ids: deckIds, categoryKey };
    const response = await fetch(buildSharedDeckApiUrl('shared-decks/opt-out'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
        throw new Error(result.error || `Failed to opt out decks (HTTP ${response.status})`);
    }
    return result;
}

async function requestSaveType4DeckDailyTargets(dailyCountsByDeckId) {
    const response = await fetch(buildSharedDeckApiUrl('shared-decks/daily-targets'), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            categoryKey,
            dailyCountsByDeckId: dailyCountsByDeckId && dailyCountsByDeckId.dailyCountsByDeckId
                ? dailyCountsByDeckId.dailyCountsByDeckId
                : {},
            orphanDailyTargetCount: dailyCountsByDeckId && Object.prototype.hasOwnProperty.call(dailyCountsByDeckId, 'orphanDailyTargetCount')
                ? dailyCountsByDeckId.orphanDailyTargetCount
                : null,
        }),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
        throw new Error(result.error || `Failed to save deck counts (HTTP ${response.status})`);
    }
    return result;
}

/* ── Tree-view deck opt-in (tap-to-select, no checkboxes) ── */

let treeOptedDeckIdSet = new Set();
let treeIncludeOrphan = false;
let treeExpandedTags = null; // null = use default; Set = persisted state

function buildDeckTree() {
    const root = { tag: null, label: null, children: new Map(), decks: [] };
    const decks = Array.isArray(allDecks) ? allDecks : [];

    decks.forEach((deck) => {
        const tags = getDeckTags(deck);
        const labels = getDeckTagLabels(deck);
        if (tags.length === 0) {
            root.decks.push(deck);
            return;
        }
        const pathTags = tags[0] === categoryKey ? tags.slice(1) : tags;
        const pathLabels = tags[0] === categoryKey ? labels.slice(1) : labels;
        if (pathTags.length === 0) {
            root.decks.push(deck);
            return;
        }
        let node = root;
        pathTags.forEach((tag, index) => {
            if (!node.children.has(tag)) {
                node.children.set(tag, {
                    tag,
                    label: pathLabels[index] || tag,
                    children: new Map(),
                    decks: [],
                });
            }
            node = node.children.get(tag);
        });
        node.decks.push(deck);
    });
    return root;
}

function getAllDeckIdsUnder(node) {
    const ids = [];
    node.decks.forEach((deck) => {
        const deckId = Number(deck.deck_id);
        if (deckId > 0) {
            ids.push(deckId);
        }
    });
    for (const child of node.children.values()) {
        ids.push(...getAllDeckIdsUnder(child));
    }
    return ids;
}

function getTreeNodeSelectionState(node) {
    const allIds = getAllDeckIdsUnder(node);
    if (allIds.length === 0) {
        return 'none';
    }
    const selectedCount = allIds.filter((id) => treeOptedDeckIdSet.has(id)).length;
    if (selectedCount === 0) {
        return 'none';
    }
    if (selectedCount === allIds.length) {
        return 'all';
    }
    return 'some';
}

function getDeckPendingBadgeHtml(deckId) {
    const id = Number(deckId);
    const wasOptedIn = baselineOptedDeckIdSet.has(id);
    const isNowOptedIn = treeOptedDeckIdSet.has(id);
    if (wasOptedIn === isNowOptedIn) {
        return '';
    }
    if (isNowOptedIn) {
        return '<span class="deck-tree-badge opt-in">+ opt-in</span>';
    }
    return '<span class="deck-tree-badge opt-out">- opt-out</span>';
}

function getBranchPendingBadgesHtml(allIds) {
    let optInCount = 0;
    let optOutCount = 0;
    allIds.forEach((id) => {
        const wasIn = baselineOptedDeckIdSet.has(id);
        const nowIn = treeOptedDeckIdSet.has(id);
        if (wasIn !== nowIn) {
            if (nowIn) {
                optInCount += 1;
            } else {
                optOutCount += 1;
            }
        }
    });
    let html = '';
    if (optInCount > 0) {
        html += `<span class="deck-tree-badge opt-in">+${optInCount}</span>`;
    }
    if (optOutCount > 0) {
        html += `<span class="deck-tree-badge opt-out">-${optOutCount}</span>`;
    }
    return html;
}

function renderDeckTreeNode(node, depth) {
    const hasChildren = node.children.size > 0;
    const hasDecks = node.decks.length > 0;
    if (!hasChildren && !hasDecks) {
        return '';
    }
    let html = '';

    // Merged leaf: a branch with exactly 1 deck and no sub-branches → render as single leaf row
    if (node.tag !== null && !hasChildren && node.decks.length === 1) {
        const deck = node.decks[0];
        const deckId = Number(deck.deck_id);
        const isSelected = treeOptedDeckIdSet.has(deckId);
        const suffix = getDeckBubbleSuffix(deck);

        const rowClasses = ['deck-tree-row'];
        if (isSelected) {
            rowClasses.push('selected');
        }

        html += `<div class="deck-tree-node deck-tree-leaf" data-tree-deck-id="${deckId}">`;
        html += `<div class="${rowClasses.join(' ')}">`;
        html += `<span class="deck-tree-toggle leaf-spacer"></span>`;
        html += `<div class="deck-tree-row-body" data-tree-action="leaf" data-tree-deck-id="${deckId}">`;
        html += `<span class="deck-tree-label">${escapeHtml(node.label || node.tag)}${escapeHtml(suffix)}</span>`;
        html += getDeckPendingBadgeHtml(deckId);
        if (isSelected) {
            html += `<span class="deck-tree-check">&#10003;</span>`;
        }
        html += `</div>`;
        html += `</div>`;
        html += `</div>`;
        return html;
    }

    if (node.tag !== null) {
        const allIds = getAllDeckIdsUnder(node);
        const selState = getTreeNodeSelectionState(node);
        const totalCount = allIds.length;
        const selectedCount = allIds.filter((id) => treeOptedDeckIdSet.has(id)).length;
        const isExpanded = isTreeNodeExpanded(node.tag, depth);

        const rowClasses = ['deck-tree-row'];
        if (selState === 'all') {
            rowClasses.push('selected');
        } else if (selState === 'some') {
            rowClasses.push('partial');
        }

        html += `<div class="deck-tree-node" data-tree-tag="${escapeHtml(node.tag)}">`;
        html += `<div class="${rowClasses.join(' ')}">`;
        html += `<button type="button" class="deck-tree-toggle${isExpanded ? ' expanded' : ''}" aria-label="Toggle">&#9654;</button>`;
        const pct = totalCount > 0 ? Math.round((selectedCount / totalCount) * 100) : 0;
        html += `<div class="deck-tree-row-body" data-tree-action="branch" data-tree-tag="${escapeHtml(node.tag)}" style="background:linear-gradient(to right, rgba(76,175,80,0.13) ${pct}%, transparent ${pct}%);">`;
        html += `<span class="deck-tree-label deck-tree-label-tag">${escapeHtml(node.label || node.tag)}</span>`;
        html += `<span class="deck-tree-meta">${selectedCount}/${totalCount}</span>`;
        html += getBranchPendingBadgesHtml(allIds);
        if (selState === 'all') {
            html += `<span class="deck-tree-check">&#10003;</span>`;
        }
        html += `</div>`;
        html += `</div>`;
        html += `<div class="deck-tree-children${isExpanded ? '' : ' collapsed'}">`;
    }

    for (const child of node.children.values()) {
        html += renderDeckTreeNode(child, depth + 1);
    }

    node.decks.forEach((deck) => {
        const deckId = Number(deck.deck_id);
        const isSelected = treeOptedDeckIdSet.has(deckId);
        const label = getType1DeckBubbleLabel(deck);
        const suffix = getDeckBubbleSuffix(deck);

        const rowClasses = ['deck-tree-row'];
        if (isSelected) {
            rowClasses.push('selected');
        }

        html += `<div class="deck-tree-node deck-tree-leaf" data-tree-deck-id="${deckId}">`;
        html += `<div class="${rowClasses.join(' ')}">`;
        html += `<span class="deck-tree-toggle leaf-spacer"></span>`;
        html += `<div class="deck-tree-row-body" data-tree-action="leaf" data-tree-deck-id="${deckId}">`;
        html += `<span class="deck-tree-label">${escapeHtml(label)}${escapeHtml(suffix)}</span>`;
        html += getDeckPendingBadgeHtml(deckId);
        if (isSelected) {
            html += `<span class="deck-tree-check">&#10003;</span>`;
        }
        html += `</div>`;
        html += `</div>`;
        html += `</div>`;
    });

    if (node.tag !== null) {
        html += `</div></div>`;
    }

    return html;
}

function getTreeTotalDeckCount() {
    const decks = Array.isArray(allDecks) ? allDecks : [];
    let count = decks.filter((d) => Number(d.deck_id) > 0).length;
    if (orphanDeck) {
        count += 1;
    }
    return count;
}

function getTreeSelectedCount() {
    let count = treeOptedDeckIdSet.size;
    if (orphanDeck && treeIncludeOrphan) {
        count += 1;
    }
    return count;
}

function captureTreeExpandState() {
    if (!deckTreeContainer) {
        return;
    }
    const expanded = new Set();
    deckTreeContainer.querySelectorAll('.deck-tree-node[data-tree-tag]').forEach((nodeEl) => {
        const tag = nodeEl.getAttribute('data-tree-tag');
        const childrenEl = nodeEl.querySelector(':scope > .deck-tree-children');
        if (childrenEl && !childrenEl.classList.contains('collapsed')) {
            expanded.add(tag);
        }
    });
    treeExpandedTags = expanded;
}

function isTreeNodeExpanded(tag, depth) {
    if (treeExpandedTags === null) {
        return depth < 2;
    }
    return treeExpandedTags.has(tag);
}

function renderDeckTree() {
    if (!deckTreeContainer) {
        return;
    }
    captureTreeExpandState();
    const tree = buildDeckTree();
    let html = '';

    // Personal deck at the top
    if (orphanDeck) {
        const isSelected = treeIncludeOrphan;
        const isPending = treeIncludeOrphan !== baselineIncludeOrphanInQueue;
        const orphanCount = Number(orphanDeck.card_count || 0);

        const rowClasses = ['deck-tree-row'];
        if (isSelected) {
            rowClasses.push('selected');
        }

        let orphanBadge = '';
        if (isPending) {
            orphanBadge = isSelected
                ? '<span class="deck-tree-badge opt-in">+ opt-in</span>'
                : '<span class="deck-tree-badge opt-out">- opt-out</span>';
        }

        html += `<div class="deck-tree-node deck-tree-leaf" data-tree-deck-id="${ORPHAN_BUBBLE_ID}">`;
        html += `<div class="${rowClasses.join(' ')}">`;
        html += `<span class="deck-tree-toggle leaf-spacer"></span>`;
        html += `<div class="deck-tree-row-body" data-tree-action="orphan">`;
        html += `<span class="deck-tree-label deck-tree-label-tag">&#11088; ${escapeHtml(getPersonalDeckDisplayName())} &middot; ${orphanCount} cards</span>`;
        html += orphanBadge;
        if (isSelected) {
            html += `<span class="deck-tree-check">&#10003;</span>`;
        }
        html += `</div>`;
        html += `</div></div>`;
    }

    html += renderDeckTreeNode(tree, 0);
    deckTreeContainer.innerHTML = html;

    updateTreeCounter();
    updateTreeApplyButton();
}

function updateTreeCounter() {
    if (!deckTreeCounter) {
        return;
    }
    deckTreeCounter.textContent = `${getTreeSelectedCount()} / ${getTreeTotalDeckCount()}`;
}

function updateTreeApplyButton() {
    if (!applyDeckTreeChangesBtn) {
        return;
    }
    const toOptIn = [...treeOptedDeckIdSet].filter((id) => !baselineOptedDeckIdSet.has(id));
    const toOptOut = [...baselineOptedDeckIdSet].filter((id) => !treeOptedDeckIdSet.has(id));
    const orphanChanged = treeIncludeOrphan !== baselineIncludeOrphanInQueue;
    const parts = [];
    if (toOptIn.length > 0) {
        parts.push(`+${toOptIn.length}`);
    }
    if (toOptOut.length > 0) {
        parts.push(`-${toOptOut.length}`);
    }
    if (orphanChanged) {
        parts.push('~1');
    }
    const hasPending = parts.length > 0;
    applyDeckTreeChangesBtn.disabled = isDeckMoveInFlight || !hasPending;
    applyDeckTreeChangesBtn.textContent = hasPending
        ? `Apply (${parts.join(' · ')})`
        : 'Apply';
}

function toggleBranchSelection(bodyEl) {
    const nodeEl = bodyEl.closest('.deck-tree-node[data-tree-tag]');
    if (!nodeEl) {
        return;
    }
    // Collect all leaf deck IDs under this specific branch node
    const leafBodies = nodeEl.querySelectorAll('[data-tree-action="leaf"][data-tree-deck-id]');
    const ids = [];
    leafBodies.forEach((body) => {
        const id = Number(body.getAttribute('data-tree-deck-id'));
        if (id > 0) {
            ids.push(id);
        }
    });
    if (ids.length === 0) {
        return;
    }
    // If all are selected, deselect all; otherwise select all
    const allSelected = ids.every((id) => treeOptedDeckIdSet.has(id));
    ids.forEach((id) => {
        if (allSelected) {
            treeOptedDeckIdSet.delete(id);
        } else {
            treeOptedDeckIdSet.add(id);
        }
    });
    renderDeckTree();
}

function toggleLeafSelection(deckId) {
    const id = Number(deckId);
    if (!(id > 0)) {
        return;
    }
    if (treeOptedDeckIdSet.has(id)) {
        treeOptedDeckIdSet.delete(id);
    } else {
        treeOptedDeckIdSet.add(id);
    }
    renderDeckTree();
}

function toggleOrphanSelection() {
    treeIncludeOrphan = !treeIncludeOrphan;
    renderDeckTree();
}

function handleTreeContainerClick(event) {
    // Handle chevron toggle
    const toggle = event.target.closest('.deck-tree-toggle:not(.leaf-spacer)');
    if (toggle) {
        const treeNode = toggle.closest('.deck-tree-node');
        if (treeNode) {
            const childrenEl = treeNode.querySelector(':scope > .deck-tree-children');
            if (childrenEl) {
                const isExpanded = !childrenEl.classList.contains('collapsed');
                childrenEl.classList.toggle('collapsed', isExpanded);
                toggle.classList.toggle('expanded', !isExpanded);
            }
        }
        return;
    }

    // Handle row body tap
    const body = event.target.closest('.deck-tree-row-body');
    if (!body) {
        return;
    }
    const action = body.getAttribute('data-tree-action');
    if (action === 'orphan') {
        toggleOrphanSelection();
    } else if (action === 'leaf') {
        toggleLeafSelection(body.getAttribute('data-tree-deck-id'));
    } else if (action === 'branch') {
        toggleBranchSelection(body);
    }
}

function applyTreeSearch(query) {
    if (!deckTreeContainer) {
        return;
    }
    const q = String(query || '').trim().toLowerCase();
    const allNodes = deckTreeContainer.querySelectorAll('.deck-tree-node');

    if (!q) {
        allNodes.forEach((node) => node.classList.remove('search-hidden'));
        return;
    }

    allNodes.forEach((node) => node.classList.add('search-hidden'));

    function showNodeAndAncestors(node) {
        node.classList.remove('search-hidden');
        let parent = node.parentElement;
        while (parent && parent !== deckTreeContainer) {
            if (parent.classList.contains('deck-tree-node')) {
                parent.classList.remove('search-hidden');
            }
            if (parent.classList.contains('deck-tree-children') && parent.classList.contains('collapsed')) {
                parent.classList.remove('collapsed');
                const toggle = parent.previousElementSibling?.querySelector('.deck-tree-toggle');
                if (toggle) {
                    toggle.classList.add('expanded');
                }
            }
            parent = parent.parentElement;
        }
    }

    function showAllDescendants(node) {
        node.querySelectorAll('.deck-tree-node').forEach((child) => {
            child.classList.remove('search-hidden');
        });
    }

    // Match leaf nodes by their label text
    const leafNodes = deckTreeContainer.querySelectorAll('.deck-tree-leaf');
    leafNodes.forEach((leaf) => {
        const labelEl = leaf.querySelector('.deck-tree-label');
        const text = (labelEl ? labelEl.textContent : '').toLowerCase();
        if (text.includes(q)) {
            showNodeAndAncestors(leaf);
        }
    });

    // Match branch nodes by their tag label
    const branchNodes = deckTreeContainer.querySelectorAll('.deck-tree-node[data-tree-tag]');
    branchNodes.forEach((branch) => {
        const labelEl = branch.querySelector(':scope > .deck-tree-row > .deck-tree-row-body > .deck-tree-label');
        if (!labelEl) {
            return;
        }
        const text = labelEl.textContent.toLowerCase();
        if (text.includes(q)) {
            showNodeAndAncestors(branch);
            showAllDescendants(branch);
        }
    });
}

function resetTreeToBaseline() {
    treeOptedDeckIdSet = new Set(baselineOptedDeckIdSet);
    treeIncludeOrphan = baselineIncludeOrphanInQueue;
    renderDeckTree();
}

function openDeckTreeModal() {
    treeOptedDeckIdSet = new Set(stagedOptedDeckIdSet);
    treeIncludeOrphan = stagedIncludeOrphanInQueue;
    treeExpandedTags = null;
    if (deckTreeSearchInput) {
        deckTreeSearchInput.value = '';
    }
    renderDeckTree();
    setManageModalOpen(deckTreeModal, true);
}

function closeDeckTreeModal() {
    setManageModalOpen(deckTreeModal, false);
}

async function applyDeckTreeChanges() {
    if (isDeckMoveInFlight) {
        return;
    }
    stagedOptedDeckIdSet = new Set(treeOptedDeckIdSet);
    stagedIncludeOrphanInQueue = treeIncludeOrphan;
    closeDeckTreeModal();
    clearDeckSelectionMessages();
    await applyDeckMembershipChanges();
    await refreshDeckSelectionViews();
}

async function stageDeckMembershipChange(deckId, direction) {
    if (isDeckMoveInFlight) {
        return;
    }
    const deck = getDeckById(deckId);
    if (!deck) {
        return;
    }

    const shouldOptIn = direction === 'in';
    const numericDeckId = Number(deck.deck_id);
    const currentlyOptedIn = stagedOptedDeckIdSet.has(numericDeckId);
    if (shouldOptIn && currentlyOptedIn) {
        return;
    }
    if (!shouldOptIn && !currentlyOptedIn) {
        return;
    }

    if (shouldOptIn) {
        stagedOptedDeckIdSet.add(numericDeckId);
    } else {
        stagedOptedDeckIdSet.delete(numericDeckId);
    }

    clearDeckSelectionMessages();
    await refreshDeckSelectionViews();
}

async function stageOrphanInclusion(includeOrphan) {
    if (isDeckMoveInFlight) {
        return;
    }
    const nextValue = Boolean(includeOrphan);
    if (stagedIncludeOrphanInQueue === nextValue) {
        return;
    }
    stagedIncludeOrphanInQueue = nextValue;
    clearDeckSelectionMessages();
    await refreshDeckSelectionViews();
}

async function applyDeckMembershipChanges() {
    if (isDeckMoveInFlight || !hasPendingDeckChanges()) {
        return;
    }

    const toOptIn = [...stagedOptedDeckIdSet].filter((deckId) => !baselineOptedDeckIdSet.has(deckId));
    const toOptOut = [...baselineOptedDeckIdSet].filter((deckId) => !stagedOptedDeckIdSet.has(deckId));
    const orphanChanged = stagedIncludeOrphanInQueue !== baselineIncludeOrphanInQueue;

    isDeckMoveInFlight = true;
    renderDeckPendingInfo();
    showError('');
    showSuccess('');
    showDeckChangeMessage('');
    setCardsLoadingIndicatorVisible(true);
    try {
        if (toOptIn.length > 0) {
            await requestOptInDeckIds(toOptIn);
        }
        if (toOptOut.length > 0) {
            await requestOptOutDeckIds(toOptOut);
        }
        if (orphanChanged) {
            const response = await fetch(`${API_BASE}/kids/${kidId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(buildIncludeOrphanPayload(stagedIncludeOrphanInQueue)),
            });
            const result = await response.json().catch(() => ({}));
            if (!response.ok) {
                throw new Error(result.error || `Failed to update Personal Deck setting (HTTP ${response.status})`);
            }
            applyIncludeOrphanFromPayload(result);
        }
        showDeckChangeMessage('');
        await loadSharedType1Decks();
    } catch (error) {
        console.error('Error applying deck membership changes:', error);
        showDeckChangeMessage(error.message || 'Failed to apply deck changes.', true);
    } finally {
        isDeckMoveInFlight = false;
        setCardsLoadingIndicatorVisible(false);
        renderDeckPendingInfo();
    }
}

function setCardsLoadingIndicatorVisible(visible) {
    const indicator = document.getElementById('cardsLoadingIndicator');
    if (!indicator) return;
    indicator.classList.toggle('hidden', !visible);
    const grid = document.getElementById('cardsGrid');
    if (grid) {
        grid.classList.toggle('hidden', !!visible);
    }
}

document.addEventListener('DOMContentLoaded', async () => {
    if (!kidId) {
        window.location.href = '/admin.html';
        return;
    }
    if (!categoryKey) {
        showError('Missing deck category. Open this page from Admin.');
        return;
    }
    initializeType4GeneratorCodeViewer();
    if (openDeckOptInModalBtn) {
        openDeckOptInModalBtn.addEventListener('click', openDeckTreeModal);
    }
    if (cancelDeckTreeModalBtn) {
        cancelDeckTreeModalBtn.addEventListener('click', closeDeckTreeModal);
    }
    if (applyDeckTreeChangesBtn) {
        applyDeckTreeChangesBtn.addEventListener('click', async () => {
            await applyDeckTreeChanges();
        });
    }
    if (deckTreeClearBtn) {
        deckTreeClearBtn.addEventListener('click', resetTreeToBaseline);
    }
    if (deckTreeInfoBtn) {
        deckTreeInfoBtn.addEventListener('click', () => {
            const existing = document.querySelector('.deck-tree-info-popover');
            if (existing) {
                existing.remove();
                return;
            }
            const popover = document.createElement('div');
            popover.className = 'deck-tree-info-popover';
            popover.textContent = getOptInDecksHelpText();
            deckTreeInfoBtn.parentElement.appendChild(popover);
            const dismiss = (e) => {
                if (!popover.contains(e.target) && e.target !== deckTreeInfoBtn) {
                    popover.remove();
                    document.removeEventListener('click', dismiss);
                }
            };
            setTimeout(() => document.addEventListener('click', dismiss), 0);
        });
    }
    if (deckTreeContainer) {
        deckTreeContainer.addEventListener('click', handleTreeContainerClick);
    }
    if (deckTreeSearchInput) {
        deckTreeSearchInput.addEventListener('input', () => {
            applyTreeSearch(deckTreeSearchInput.value);
        });
    }
    const deckTreeExpandAllBtn = document.getElementById('deckTreeExpandAllBtn');
    const deckTreeCollapseAllBtn = document.getElementById('deckTreeCollapseAllBtn');
    if (deckTreeExpandAllBtn) {
        deckTreeExpandAllBtn.addEventListener('click', () => {
            if (!deckTreeContainer) return;
            deckTreeContainer.querySelectorAll('.deck-tree-children.collapsed').forEach((el) => el.classList.remove('collapsed'));
            deckTreeContainer.querySelectorAll('.deck-tree-toggle').forEach((el) => el.classList.add('expanded'));
        });
    }
    if (deckTreeCollapseAllBtn) {
        deckTreeCollapseAllBtn.addEventListener('click', () => {
            if (!deckTreeContainer) return;
            deckTreeContainer.querySelectorAll('.deck-tree-children').forEach((el) => el.classList.add('collapsed'));
            deckTreeContainer.querySelectorAll('.deck-tree-toggle').forEach((el) => el.classList.remove('expanded'));
        });
    }
    if (openType4DeckCountsModalBtn) {
        openType4DeckCountsModalBtn.addEventListener('click', () => {
            if (!isType4Behavior() || hasPendingDeckChanges()) {
                return;
            }
            renderType4DeckCountsModal();
            showType4DeckCountsMessage('');
            setManageModalOpen(type4DeckCountsModal, true);
        });
    }
    if (cancelType4DeckCountsModalBtn) {
        cancelType4DeckCountsModalBtn.addEventListener('click', () => {
            setManageModalOpen(type4DeckCountsModal, false);
        });
    }
    if (applyType4DeckCountsToAllBtn) {
        applyType4DeckCountsToAllBtn.addEventListener('click', () => {
            applyType4DeckCountToAllRows(type4DeckCountsApplyAllInput ? type4DeckCountsApplyAllInput.value : 0);
        });
    }
    if (type4DeckCountsApplyAllInput) {
        type4DeckCountsApplyAllInput.addEventListener('input', () => {
            type4DeckCountsApplyAllInput.value = String(getType4DeckCountDraftValue(type4DeckCountsApplyAllInput.value));
        });
        type4DeckCountsApplyAllInput.addEventListener('change', () => {
            type4DeckCountsApplyAllInput.value = String(getType4DeckCountDraftValue(type4DeckCountsApplyAllInput.value));
        });
        type4DeckCountsApplyAllInput.addEventListener('keydown', (event) => {
            if (event.key !== 'Enter') {
                return;
            }
            event.preventDefault();
            applyType4DeckCountToAllRows(type4DeckCountsApplyAllInput.value);
        });
    }
    if (closeType4GeneratorModalBtn) {
        closeType4GeneratorModalBtn.addEventListener('click', () => {
            setManageModalOpen(type4GeneratorModal, false);
        });
    }
    if (saveType4DeckCountsBtn) {
        saveType4DeckCountsBtn.addEventListener('click', async () => {
            try {
                await saveType4DeckCounts();
            } catch (error) {
                console.error('Error saving generator deck counts:', error);
                showType4DeckCountsMessage(error.message || 'Failed to save deck counts.', true);
            }
        });
    }
    if (runType4GeneratorPreviewBtn) {
        runType4GeneratorPreviewBtn.addEventListener('click', async () => {
            try {
                await runType4GeneratorPreview();
            } catch (error) {
                console.error('Error running generator preview:', error);
                showType4GeneratorMessage(error.message || 'Failed to run generator.', true);
            }
        });
    }
    if (openPersonalDeckModalBtn) {
        openPersonalDeckModalBtn.addEventListener('click', () => {
            setManageModalOpen(personalDeckModal, true);
        });
    }
    if (cancelPersonalDeckModalBtn) {
        cancelPersonalDeckModalBtn.addEventListener('click', () => {
            setManageModalOpen(personalDeckModal, false);
        });
    }
    if (deckTreeModal) {
        deckTreeModal.addEventListener('click', handleModalBackdropClick);
    }
    if (type4DeckCountsModal) {
        type4DeckCountsModal.addEventListener('click', handleModalBackdropClick);
    }
    if (type4GeneratorModal) {
        type4GeneratorModal.addEventListener('click', handleModalBackdropClick);
    }
    if (personalDeckModal) {
        personalDeckModal.addEventListener('click', handleModalBackdropClick);
    }
    document.addEventListener('keydown', (event) => {
        if (event.key !== 'Escape') {
            return;
        }
        if (isModalOpen(type4GeneratorModal)) {
            setManageModalOpen(type4GeneratorModal, false);
            return;
        }
        if (isModalOpen(type4DeckCountsModal)) {
            setManageModalOpen(type4DeckCountsModal, false);
            return;
        }
        if (isModalOpen(personalDeckModal)) {
            setManageModalOpen(personalDeckModal, false);
            return;
        }
        if (isModalOpen(deckTreeModal)) {
            closeDeckTreeModal();
        }
    });
    if (deckTreeModal) {
        deckTreeModal.classList.add('hidden');
        deckTreeModal.setAttribute('aria-hidden', 'true');
    }
    if (type4DeckCountsModal) {
        type4DeckCountsModal.classList.add('hidden');
        type4DeckCountsModal.setAttribute('aria-hidden', 'true');
    }
    if (type4GeneratorModal) {
        type4GeneratorModal.classList.add('hidden');
        type4GeneratorModal.setAttribute('aria-hidden', 'true');
    }
    if (personalDeckModal) {
        personalDeckModal.classList.add('hidden');
        personalDeckModal.setAttribute('aria-hidden', 'true');
    }
    syncModalBodyLock();
    applyCategoryUiText();

    window.PracticeManageCommon.applyKidManageTabVisibility({
        kidId,
        defaultCategoryByRoute: {
            '/kid-card-manage.html': categoryKey,
        },
    });

    cardsGrid.addEventListener('click', handleCardsGridClick);
    window.addEventListener('resize', () => {
        applyChineseCardFrontUniformSize();
    });
    if (document.fonts && typeof document.fonts.addEventListener === 'function') {
        document.fonts.addEventListener('loadingdone', () => {
            applyChineseCardFrontUniformSize();
        });
    }

    if (sessionSettingsForm) {
        sessionSettingsForm.addEventListener('submit', async (event) => {
            event.preventDefault();
            try {
                await saveQueueSettings();
            } catch (error) {
                console.error('Error saving shared category settings:', error);
                showError(error.message || 'Failed to save practice settings.');
            }
        });
    }
    viewOrderSelect.addEventListener('change', () => {
        const nextMode = getSelectedCardSortMode();
        setCurrentCardSortDirection(getDefaultCardSortDirection(nextMode));
        syncCardSortDirectionButton();
        syncSortMenuFromSelect();
        resetAndDisplayCards(currentCards);
    });
    buildSortMenuItems();
    syncSortMenuFromSelect();
    if (sortMenuBtn) {
        sortMenuBtn.addEventListener('click', (event) => {
            event.stopPropagation();
            setSortMenuOpen(!isSortMenuOpen());
        });
        document.addEventListener('click', (event) => {
            if (!isSortMenuOpen()) {
                return;
            }
            const target = event.target;
            if (sortMenuPopover.contains(target) || sortMenuBtn.contains(target)) {
                return;
            }
            setSortMenuOpen(false);
        });
        document.addEventListener('keydown', (event) => {
            if (event.key === 'Escape' && isSortMenuOpen()) {
                setSortMenuOpen(false);
                sortMenuBtn.focus();
            }
        });
    }
    sortDirectionToggleBtns.forEach((btn) => {
        btn.addEventListener('click', () => {
            const next = btn.dataset.sortDirection === 'asc'
                ? CARD_SORT_DIRECTION_ASC
                : CARD_SORT_DIRECTION_DESC;
            if (next === getCurrentCardSortDirection()) {
                return;
            }
            setCurrentCardSortDirection(next);
            syncCardSortDirectionButton();
            resetAndDisplayCards(currentCards);
        });
    });
    renderCardViewModeButtons();
    if (cardViewModeCompactBtn) {
        cardViewModeCompactBtn.addEventListener('click', () => setCardViewMode('short'));
    }
    if (cardViewModeExpandBtn) {
        cardViewModeExpandBtn.addEventListener('click', () => setCardViewMode('long'));
    }
    if (cardSearchInput) {
        cardSearchInput.addEventListener('input', () => {
            resetAndDisplayCards(currentCards);
        });
    }
    if (skipVisibleCardsBtn) {
        skipVisibleCardsBtn.addEventListener('click', async () => {
            setCardsBulkActionMenuOpen(false);
            await applyVisibleCardsSkip(true);
        });
    }
    if (unskipVisibleCardsBtn) {
        unskipVisibleCardsBtn.addEventListener('click', async () => {
            setCardsBulkActionMenuOpen(false);
            await applyVisibleCardsSkip(false);
        });
    }
    if (cardsBulkActionMenuBtn) {
        cardsBulkActionMenuBtn.addEventListener('click', (event) => {
            event.stopPropagation();
            setCardsBulkActionMenuOpen(!isCardsBulkActionMenuOpen());
        });
        document.addEventListener('click', (event) => {
            if (!isCardsBulkActionMenuOpen()) {
                return;
            }
            const target = event.target;
            if (cardsBulkActionMenu.contains(target) || cardsBulkActionMenuBtn.contains(target)) {
                return;
            }
            setCardsBulkActionMenuOpen(false);
        });
        document.addEventListener('keydown', (event) => {
            if (event.key === 'Escape' && isCardsBulkActionMenuOpen()) {
                setCardsBulkActionMenuOpen(false);
                cardsBulkActionMenuBtn.focus();
            }
        });
    }
    if (addCardForm) {
        addCardForm.addEventListener('submit', async (event) => {
            event.preventDefault();
            await addOrphanCards();
        });
    }
    if (chineseCharInput) {
        chineseCharInput.addEventListener('input', () => {
            updateAddReadingButtonCount();
        });
    }
    if (hardnessPercentSlider) {
        hardnessPercentSlider.addEventListener('input', () => {
            updateQueueMixLegend();
            rerenderCompactCardsForQueuePreview();
            scheduleQueuePreviewReload();
        });
        hardnessPercentSlider.addEventListener('change', () => {
            normalizeHardSliderValue();
            updateQueueMixLegend();
            rerenderCompactCardsForQueuePreview();
            scheduleQueuePreviewReload();
        });
    }
    if (sessionCardCountInput) {
        sessionCardCountInput.addEventListener('input', () => {
            normalizeSessionCountInputValue();
            updateQueueMixLegend();
            rerenderCompactCardsForQueuePreview();
        });
        sessionCardCountInput.addEventListener('change', () => {
            normalizeSessionCountInputValue();
            updateQueueMixLegend();
            rerenderCompactCardsForQueuePreview();
        });
        applySessionCardCountInputCap();
    }
    document.querySelectorAll('[data-session-count-step]').forEach((btn) => {
        btn.addEventListener('click', () => {
            if (!sessionCardCountInput) {
                return;
            }
            const step = Number.parseInt(btn.dataset.sessionCountStep, 10) || 0;
            const current = Number.parseInt(sessionCardCountInput.value, 10) || 0;
            const min = Number.parseInt(sessionCardCountInput.min, 10);
            const max = Number.parseInt(sessionCardCountInput.max, 10);
            let next = current + step;
            if (Number.isFinite(min) && next < min) next = min;
            if (Number.isFinite(max) && next > max) next = max;
            if (next === current) {
                return;
            }
            sessionCardCountInput.value = String(next);
            sessionCardCountInput.dispatchEvent(new Event('input', { bubbles: true }));
            sessionCardCountInput.dispatchEvent(new Event('change', { bubbles: true }));
        });
    });
    if (type4DeckCountsList) {
        type4DeckCountsList.addEventListener('input', (event) => {
            const target = event.target;
            if (!(target instanceof HTMLInputElement) || !target.classList.contains('type4-deck-count-input')) {
                return;
            }
            target.value = String(getType4DeckCountDraftValue(target.value));
            updateType4DeckCountsModalTotal();
        });
        type4DeckCountsList.addEventListener('change', (event) => {
            const target = event.target;
            if (!(target instanceof HTMLInputElement) || !target.classList.contains('type4-deck-count-input')) {
                return;
            }
            target.value = String(getType4DeckCountDraftValue(target.value));
            updateType4DeckCountsModalTotal();
        });
    }

    setupCardsViewModeToggle();

    loadKidNav();

    sharedDeckCardsResponseTracker = window.PracticeManageCommon.createLatestResponseTracker();

    try {
        showError('');
        showSuccess('');
        await loadKidInfo();
        updateQueueMixLegend();
        updateQueueSettingsSaveButtonState();
        // Fire decks and cards fetches in parallel (both URLs depend only on kid info)
        await Promise.all([
            loadSharedType1Decks({ skipCards: true }),
            loadSharedDeckCards(),
        ]);
        updateAddReadingButtonCount();
    } catch (error) {
        console.error('Error initializing category manage:', error);
        showError(error.message || 'Failed to load page.');
        kidNameEl.textContent = 'Card Management';
        updatePageTitle();
    }
});

function setupCardsViewModeToggle() {
    const buttons = document.querySelectorAll('[data-cards-view-toggle]');
    buttons.forEach((btn) => {
        btn.addEventListener('click', () => {
            const mode = btn.getAttribute('data-cards-view-toggle');
            setCardsViewMode(mode === 'stats' ? 'stats' : 'queue');
        });
    });
    setCardsViewMode('queue');
}

function setCardsViewMode(mode) {
    const next = mode === 'stats' ? 'stats' : 'queue';
    currentCardsViewMode = next;
    document.body.classList.toggle('cards-view-mode-stats', next === 'stats');
    document.body.classList.toggle('cards-view-mode-queue', next === 'queue');
    document.querySelectorAll('[data-cards-view-toggle]').forEach((btn) => {
        const isActive = btn.getAttribute('data-cards-view-toggle') === next;
        btn.classList.toggle('active', isActive);
        btn.setAttribute('aria-pressed', isActive ? 'true' : 'false');
    });
    if (next === 'stats') {
        renderStatsView();
    }
}

function renderStatsView() {
    const container = document.getElementById('cardsStatsView');
    if (!container) return;
    const cards = Array.isArray(currentCards) ? currentCards : [];
    const practiced = cards.filter((card) => getCardPracticeCount(card) > 0);
    const uniqueCount = practiced.length;
    const attemptTotal = practiced.reduce((sum, card) => sum + getCardPracticeCount(card), 0);
    if (!practiced.length) {
        container.innerHTML = `
            ${renderStatsSummary(uniqueCount, attemptTotal)}
            <div class="cards-view-placeholder">Practice a few cards to unlock card distributions.</div>
        `;
        return;
    }
    const getCardCapsuleLabel = makeCardCapsuleLabelGetter(currentBehaviorType);
    const panels = [
        buildAccuracyDistribution(practiced, getCardCapsuleLabel),
        buildPracticeCountDistribution(practiced, getCardCapsuleLabel),
        buildSpeedDistribution(practiced, getCardCapsuleLabel),
        buildLastSeenDistribution(practiced, getCardCapsuleLabel),
    ];
    const dailyProgress = buildDailyProgressChart(currentDailyProgressRows, currentFamilyTimezone);
    container.innerHTML = `
        ${renderStatsSummary(uniqueCount, attemptTotal)}
        ${dailyProgress ? renderDailyProgressPanel(dailyProgress) : ''}
        <div class="cards-distribution-grid">
            ${panels.map((panel) => renderDistributionPanel(panel)).join('')}
        </div>
    `;
}

function renderStatsSummary(uniqueCount, attemptTotal) {
    return `
        <div class="cards-stats-summary">
            <span>Practiced Cards <strong>${escapeHtml(String(uniqueCount))}</strong></span>
            <span>Practiced Counts <strong>${escapeHtml(String(attemptTotal))}</strong></span>
        </div>
    `;
}

function getCardPracticeCount(card) {
    const attempts = Number.parseInt(card?.lifetime_attempts, 10);
    return Number.isInteger(attempts) ? Math.max(0, attempts) : 0;
}

function getCardCorrectRatePct(card) {
    if (getCardPracticeCount(card) <= 0) return null;
    const wrongRate = Number(card?.overall_wrong_rate);
    if (!Number.isFinite(wrongRate)) return null;
    return Math.max(0, Math.min(100, 100 - wrongRate));
}

function getCardAverageSpeedMs(card) {
    const avgMs = Number(card?.avg_response_time_ms);
    if (Number.isFinite(avgMs) && avgMs > 0) return avgMs;
    const fallback = Number(card?.practice_priority_avg_correct_response_time);
    if (Number.isFinite(fallback) && fallback > 0) return fallback;
    return null;
}

function getCardDaysSinceLastSeen(card) {
    if (getCardPracticeCount(card) <= 0) return null;
    const seenAt = card?.last_seen_at;
    if (!seenAt) return null;
    const seenMs = new Date(seenAt).getTime();
    if (!Number.isFinite(seenMs)) return null;
    const dayDiff = Math.floor((Date.now() - seenMs) / (24 * 60 * 60 * 1000));
    return Math.max(0, dayDiff);
}

function makeCardCapsuleLabelGetter(behaviorType) {
    return (card) => {
        const front = String(card?.front || '').trim();
        const back = String(card?.back || '').trim();
        if (behaviorType === BEHAVIOR_TYPE_TYPE_II) return back || front;
        return front || back;
    };
}

function buildAccuracyDistribution(cards, getCardCapsuleLabel) {
    return buildHistogramDistribution({
        title: 'Correct Rate',
        tone: 'accuracy',
        formatValue: formatPercentLabel,
        getValue: getCardCorrectRatePct,
        getCardCapsuleLabel,
        percentileMarkers: [10, 90],
        bucketing: {
            snapUnit: 1,
            minClamp: 0,
            maxClamp: 100,
            formatRange: (min, max) => `${formatBoundaryNumber(min)}–${formatBoundaryNumber(max)}%`,
        },
        topLists: [{ title: 'Lowest 5', mode: 'lowest', count: 5 }],
        cards,
    });
}

function buildPracticeCountDistribution(cards, getCardCapsuleLabel) {
    return buildHistogramDistribution({
        title: 'Practice Count',
        tone: 'counts',
        formatValue: formatCountLabel,
        getValue: getCardPracticeCount,
        getCardCapsuleLabel,
        bucketing: {
            snapUnit: 1,
            minClamp: 1,
            isInteger: true,
            formatRange: formatIntegerCaptureRange,
        },
        topLists: [
            { title: 'Top 5', mode: 'highest', count: 5 },
            { title: 'Bottom 5', mode: 'lowest', count: 5 },
        ],
        cards,
    });
}

function buildSpeedDistribution(cards, getCardCapsuleLabel) {
    return buildHistogramDistribution({
        title: 'Average Speed',
        tone: 'speed',
        formatValue: formatSpeedLabel,
        getValue: getCardAverageSpeedMs,
        getCardCapsuleLabel,
        bucketing: {
            snapUnit: 1000,
            minClamp: 0,
            anchorLo: 'dataMin',
            formatRange: (min, max) => `${formatBoundarySeconds(min)}–${formatBoundarySeconds(max)}s`,
        },
        topLists: [
            { title: 'Slowest 5', mode: 'highest', count: 5 },
            { title: 'Fastest 5', mode: 'lowest', count: 5 },
        ],
        cards,
    });
}

function buildLastSeenDistribution(cards, getCardCapsuleLabel) {
    return buildHistogramDistribution({
        title: 'Days Since Last Seen',
        tone: 'recency',
        formatValue: formatDaysLabel,
        getValue: getCardDaysSinceLastSeen,
        getCardCapsuleLabel,
        bucketing: {
            snapUnit: 1,
            minClamp: 0,
            isInteger: true,
            anchorLo: 'dataMin',
            formatRange: formatIntegerCaptureRange,
        },
        topLists: [
            { title: 'Stalest 5', mode: 'highest', count: 5 },
            { title: 'Freshest 5', mode: 'lowest', count: 5 },
        ],
        cards,
    });
}

function buildHistogramDistribution(options = {}) {
    const cards = Array.isArray(options?.cards) ? options.cards : [];
    const getValue = typeof options?.getValue === 'function' ? options.getValue : () => null;
    const formatValue = typeof options?.formatValue === 'function' ? options.formatValue : (v) => String(v);
    const bucketing = options?.bucketing || {};
    const values = [];
    const rated = [];
    for (const card of cards) {
        const value = Number(getValue(card));
        if (Number.isFinite(value)) {
            values.push(value);
            rated.push({ card, value });
        }
    }
    const bucketDefinitions = buildDynamicBuckets(values, bucketing);
    if (!values.length || !bucketDefinitions.length) {
        return {
            title: String(options?.title || ''),
            tone: String(options?.tone || ''),
            emptyMessage: 'No practiced-card data yet.',
        };
    }
    const bars = buildHistogramBars(values, bucketDefinitions);
    const maxValue = Math.max(...values);
    const percentiles = buildHistogramPercentiles(values, bars, maxValue, options?.formatValue, options?.percentileMarkers);
    const yAxis = buildHistogramCountAxis(Math.max(...bars.map((bar) => Number(bar?.count) || 0), 0));
    const getCardCapsuleLabel = typeof options?.getCardCapsuleLabel === 'function'
        ? options.getCardCapsuleLabel
        : (card) => String(card?.front || '').trim();
    const topLists = buildTopCardLists(rated, options?.topLists, formatValue, getCardCapsuleLabel);
    return {
        title: String(options?.title || ''),
        tone: String(options?.tone || ''),
        yAxisLabel: 'Cards',
        bars,
        percentiles,
        yMax: yAxis.max,
        tickValues: yAxis.ticks,
        topLists,
    };
}

const HISTOGRAM_BUCKET_COUNT = 7;

function buildDynamicBuckets(values, bucketing = {}) {
    if (!Array.isArray(values) || !values.length) return [];
    const formatRange = typeof bucketing?.formatRange === 'function'
        ? bucketing.formatRange
        : (min, max) => `${min}–${max}`;
    const snapUnit = Math.max(1e-9, Number(bucketing?.snapUnit) || 1);
    const isInteger = !!bucketing?.isInteger;
    const minClamp = Number.isFinite(bucketing?.minClamp) ? Number(bucketing.minClamp) : -Infinity;
    const maxClamp = Number.isFinite(bucketing?.maxClamp) ? Number(bucketing.maxClamp) : Infinity;
    const dataMin = Math.min(...values);
    const dataMax = Math.max(...values);
    if (dataMin === dataMax) {
        return [{ min: dataMin, max: dataMax, label: formatRange(dataMin, dataMax) }];
    }
    const range = dataMax - dataMin;
    const step = Math.max(snapUnit, Math.ceil(range / HISTOGRAM_BUCKET_COUNT / snapUnit) * snapUnit);
    const totalWidth = step * HISTOGRAM_BUCKET_COUNT;
    const overflow = totalWidth - range;
    const anchorLo = String(bucketing?.anchorLo || '').toLowerCase();
    let lo = anchorLo === 'datamin'
        ? Math.floor(dataMin / snapUnit) * snapUnit
        : Math.floor((dataMin - overflow / 2) / snapUnit) * snapUnit;
    if (lo < minClamp) {
        lo = Math.ceil(minClamp / snapUnit) * snapUnit;
    }
    if (lo + totalWidth > maxClamp) {
        const cappedLo = Math.floor((maxClamp - totalWidth) / snapUnit) * snapUnit;
        lo = Math.max(Math.ceil(minClamp / snapUnit) * snapUnit, cappedLo);
    }
    const buckets = [];
    for (let i = 0; i < HISTOGRAM_BUCKET_COUNT; i++) {
        const bMin = lo + (i * step);
        const bMaxExclusive = bMin + step;
        const bucketMax = isInteger ? bMaxExclusive - 1 : bMaxExclusive;
        buckets.push({ min: bMin, max: bucketMax, label: formatRange(bMin, bucketMax) });
    }
    return buckets;
}

function buildHistogramBars(values, bucketDefinitions) {
    const bars = bucketDefinitions.map((definition) => ({
        label: String(definition?.label || ''),
        min: Number(definition?.min) || 0,
        max: Number.isFinite(definition?.max) ? Number(definition.max) : null,
        count: 0,
    }));
    for (const value of values) {
        const bar = findHistogramBucket(value, bars);
        if (bar) bar.count += 1;
    }
    return bars;
}

function buildHistogramPercentiles(values, bucketDefinitions, observedMax, formatValue, percentileMarkers) {
    const sortedValues = values.slice().sort((a, b) => a - b);
    const formatter = typeof formatValue === 'function' ? formatValue : (value) => String(value);
    const requested = Array.isArray(percentileMarkers) && percentileMarkers.length ? percentileMarkers : [50, 90];
    const markers = requested.map((percentile) => ({
        percentile,
        label: `P${percentile}`,
        className: `p${percentile}`,
    }));
    const groups = [];
    for (const marker of markers) {
        const value = getPercentileValue(sortedValues, marker.percentile);
        const valueLabel = formatter(value);
        const last = groups[groups.length - 1];
        if (last && last.valueLabel === valueLabel) {
            last.labels.push(marker.label);
            last.classNames.push(marker.className);
            continue;
        }
        groups.push({
            value,
            valueLabel,
            positionPct: getHistogramMarkerPositionPct(value, bucketDefinitions, observedMax),
            labels: [marker.label],
            classNames: [marker.className],
        });
    }
    return groups.map((group) => ({
        label: group.labels.join(' · '),
        className: group.classNames.join(' '),
        valueLabel: group.valueLabel,
        positionPct: group.positionPct,
    }));
}

function buildHistogramCountAxis(maxCount) {
    const safeMax = Math.max(1, Number(maxCount) || 0);
    const step = getNiceHistogramStep(safeMax / 4);
    const axisMax = Math.max(step, Math.ceil(safeMax / step) * step);
    const ticks = [];
    for (let value = 0; value <= axisMax; value += step) ticks.push(value);
    return { max: axisMax, ticks };
}

function getNiceHistogramStep(rawStep) {
    const value = Math.max(1, Number(rawStep) || 1);
    const magnitude = 10 ** Math.floor(Math.log10(value));
    const normalized = value / magnitude;
    if (normalized <= 1) return magnitude;
    if (normalized <= 2) return 2 * magnitude;
    if (normalized <= 5) return 5 * magnitude;
    return 10 * magnitude;
}

function getHistogramVerticalPositionPct(value, maxValue) {
    if (!Number.isFinite(value) || !Number.isFinite(maxValue) || maxValue <= 0) return 0;
    return (value / maxValue) * 100;
}

function findHistogramBucket(value, bucketDefinitions) {
    const list = Array.isArray(bucketDefinitions) ? bucketDefinitions : [];
    for (const bucket of list) {
        const min = Number(bucket?.min) || 0;
        const max = Number.isFinite(bucket?.max) ? Number(bucket.max) : null;
        if (value < min) continue;
        if (max === null || value <= max) return bucket;
    }
    return list[list.length - 1] || null;
}

function getHistogramMarkerPositionPct(value, bucketDefinitions, observedMax) {
    const buckets = Array.isArray(bucketDefinitions) ? bucketDefinitions : [];
    if (!buckets.length || !Number.isFinite(value)) return 50;
    const bucketIndex = Math.max(0, buckets.findIndex((bucket) => findHistogramBucket(value, buckets) === bucket));
    const bucket = buckets[bucketIndex] || buckets[0];
    const min = Number(bucket?.min) || 0;
    const rawMax = Number.isFinite(bucket?.max) ? Number(bucket.max) : Math.max(observedMax, min);
    const max = rawMax > min ? rawMax : min;
    const range = max - min;
    const fraction = range > 0 ? (value - min) / range : 0.5;
    const slotInset = 0.12;
    const slotWidth = 1 / buckets.length;
    const normalized = (bucketIndex + slotInset + (Math.max(0, Math.min(1, fraction)) * (1 - (slotInset * 2)))) * slotWidth;
    return normalized * 100;
}

function getPercentileValue(sortedValues, percentile) {
    const list = Array.isArray(sortedValues) ? sortedValues : [];
    if (!list.length) return 0;
    if (list.length === 1) return list[0];
    const clamped = Math.max(0, Math.min(100, Number(percentile) || 0));
    const index = (clamped / 100) * (list.length - 1);
    const lowerIndex = Math.floor(index);
    const upperIndex = Math.ceil(index);
    const lowerValue = list[lowerIndex];
    const upperValue = list[upperIndex];
    if (lowerIndex === upperIndex) return lowerValue;
    const weight = index - lowerIndex;
    return lowerValue + ((upperValue - lowerValue) * weight);
}

function buildTopCardLists(rated, configs, formatValue, getCardCapsuleLabel) {
    const lists = Array.isArray(configs) ? configs : [];
    if (!lists.length || !Array.isArray(rated) || !rated.length) return [];
    const labelOf = typeof getCardCapsuleLabel === 'function'
        ? getCardCapsuleLabel
        : (card) => String(card?.front || '').trim();
    const ascending = rated.slice().sort((a, b) => a.value - b.value);
    return lists.map((cfg) => {
        const count = Math.max(1, Number(cfg?.count) || 5);
        const slice = cfg?.mode === 'highest'
            ? ascending.slice(-count).reverse()
            : ascending.slice(0, count);
        return {
            title: String(cfg?.title || ''),
            entries: slice.map((entry) => ({
                cardId: Number(entry.card?.id) || 0,
                front: String(labelOf(entry.card) || '').trim() || '—',
                valueLabel: formatValue(entry.value),
            })),
        };
    });
}

function formatIntegerCaptureRange(min, max) {
    const lo = Math.ceil(min);
    const hi = Math.floor(max);
    if (lo > hi) return `${Math.round(min)}–${Math.round(max)}`;
    return lo === hi ? String(lo) : `${lo}–${hi}`;
}

function formatCompactCountLabel(value) {
    const num = Number(value);
    if (!Number.isFinite(num)) return '';
    if (Math.abs(num) >= 1000) {
        const compact = Math.round((num / 1000) * 10) / 10;
        return `${trimTrailingZeros(compact.toFixed(1))}k`;
    }
    return String(Math.round(num));
}

function formatPercentLabel(value) {
    if (!Number.isFinite(value)) return '';
    const rounded = Math.round(value * 10) / 10;
    return `${Number.isInteger(rounded) ? rounded.toFixed(0) : rounded.toFixed(1)}%`;
}

function formatCountLabel(value) {
    if (!Number.isFinite(value)) return '';
    return String(Math.round(value));
}

function formatSpeedLabel(value) {
    if (!Number.isFinite(value) || value <= 0) return '';
    const seconds = value / 1000;
    if (seconds >= 10) return `${Math.round(seconds)}s`;
    if (seconds >= 1) return `${trimTrailingZeros(seconds.toFixed(1))}s`;
    return `${trimTrailingZeros(seconds.toFixed(2))}s`;
}

function formatDaysLabel(value) {
    const days = Number(value);
    if (!Number.isFinite(days)) return '–';
    return `${Math.max(0, Math.round(days))}d`;
}

function trimTrailingZeros(text) {
    return String(text || '').replace(/\.0+$/, '').replace(/(\.\d*?)0+$/, '$1');
}

function formatBoundaryNumber(value) {
    if (!Number.isFinite(value)) return '';
    if (Number.isInteger(value)) return String(value);
    return trimTrailingZeros(value.toFixed(1));
}

function formatBoundarySeconds(ms) {
    if (!Number.isFinite(ms)) return '';
    const seconds = ms / 1000;
    if (Number.isInteger(seconds)) return String(seconds);
    return trimTrailingZeros(seconds.toFixed(1));
}

function buildDailyProgressChart(dailyProgressRows, familyTimezone) {
    const rows = Array.isArray(dailyProgressRows) ? dailyProgressRows : [];
    const validRows = [];
    for (const row of rows) {
        const cardId = Number(row?.card_id);
        const date = String(row?.date || '').trim();
        const attempts = Math.max(0, Number.parseInt(row?.attempts, 10) || 0);
        const correct = Math.max(0, Number.parseInt(row?.correct, 10) || 0);
        const rtSum = Math.max(0, Number.parseInt(row?.correct_response_time_ms_sum, 10) || 0);
        const rtCount = Math.max(0, Number.parseInt(row?.correct_response_time_count, 10) || 0);
        if (!Number.isFinite(cardId) || cardId <= 0 || !date || attempts <= 0) continue;
        validRows.push({ cardId, date, attempts, correct, rtSum, rtCount });
    }
    if (!validRows.length) return null;
    const rowsByDate = new Map();
    for (const row of validRows) {
        if (!rowsByDate.has(row.date)) rowsByDate.set(row.date, []);
        rowsByDate.get(row.date).push(row);
    }
    const sortedDates = Array.from(rowsByDate.keys()).sort();
    const firstDate = sortedDates[0];
    const lastDate = sortedDates[sortedDates.length - 1];
    const startEpoch = parseDateKeyToEpochUtc(firstDate);
    const lastDataEpoch = parseDateKeyToEpochUtc(lastDate);
    if (!Number.isFinite(startEpoch) || !Number.isFinite(lastDataEpoch) || lastDataEpoch < startEpoch) return null;
    const todayDateKey = getTodayDateKeyInTimezone(familyTimezone);
    const todayEpoch = parseDateKeyToEpochUtc(todayDateKey);
    const endEpoch = Number.isFinite(todayEpoch) && todayEpoch > lastDataEpoch ? todayEpoch : lastDataEpoch;
    const dayMs = 24 * 60 * 60 * 1000;
    const cardCum = new Map();
    const practicedSet = new Set();
    const learnedSet = new Set();
    const points = [];
    let dayIndex = 0;
    let cumRtSumMs = 0;
    let cumRtCount = 0;
    for (let epoch = startEpoch; epoch <= endEpoch; epoch += dayMs) {
        dayIndex += 1;
        const dateStr = formatEpochUtcToDateKey(epoch);
        const dayRows = rowsByDate.get(dateStr) || [];
        for (const row of dayRows) {
            let cum = cardCum.get(row.cardId);
            if (!cum) {
                cum = { attempts: 0, correct: 0 };
                cardCum.set(row.cardId, cum);
            }
            cum.attempts += row.attempts;
            cum.correct += row.correct;
            practicedSet.add(row.cardId);
            if (cum.attempts >= 5 && (cum.correct / cum.attempts) >= 0.8) {
                learnedSet.add(row.cardId);
            }
            cumRtSumMs += row.rtSum;
            cumRtCount += row.rtCount;
        }
        const avgCorrectRtSec = cumRtCount > 0 ? (cumRtSumMs / cumRtCount) / 1000 : null;
        points.push({
            dayIndex,
            date: dateStr,
            practiced: practicedSet.size,
            learned: learnedSet.size,
            avgCorrectRtSec,
        });
    }
    const yMax = Math.max(1, points.reduce((max, p) => Math.max(max, p.practiced, p.learned), 0));
    let rtMin = Infinity;
    let rtMax = 0;
    for (const p of points) {
        const v = Number(p.avgCorrectRtSec);
        if (!Number.isFinite(v)) continue;
        if (v < rtMin) rtMin = v;
        if (v > rtMax) rtMax = v;
    }
    const hasRtData = Number.isFinite(rtMin) && rtMax > 0;
    return {
        title: 'Daily Progress',
        firstDate,
        lastDate,
        totalDays: points.length,
        points,
        yMax,
        rtMin: hasRtData ? rtMin : null,
        rtMax: hasRtData ? rtMax : 0,
    };
}

function getTodayDateKeyInTimezone(timezone) {
    const tz = String(timezone || '').trim();
    try {
        const formatter = new Intl.DateTimeFormat('en-CA', {
            timeZone: tz || undefined,
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
        });
        const parts = formatter.formatToParts(new Date());
        const year = parts.find((p) => p.type === 'year')?.value;
        const month = parts.find((p) => p.type === 'month')?.value;
        const day = parts.find((p) => p.type === 'day')?.value;
        if (year && month && day) return `${year}-${month}-${day}`;
    } catch (_) {
        // fall through to UTC fallback
    }
    return formatEpochUtcToDateKey(Date.now());
}

function parseDateKeyToEpochUtc(dateStr) {
    const text = String(dateStr || '').trim();
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
    if (!match) return NaN;
    return Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

function formatEpochUtcToDateKey(epochMs) {
    const dt = new Date(epochMs);
    if (Number.isNaN(dt.getTime())) return '';
    const y = dt.getUTCFullYear();
    const m = String(dt.getUTCMonth() + 1).padStart(2, '0');
    const d = String(dt.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

function buildDailyProgressYTicks(yMax) {
    const safeMax = Math.max(1, Number(yMax) || 0);
    const step = getNiceHistogramStep(safeMax / 4);
    const axisMax = Math.max(step, Math.ceil(safeMax / step) * step);
    const ticks = [];
    for (let value = 0; value <= axisMax; value += step) ticks.push(value);
    return ticks;
}

function buildResponseTimeYTicks(rtMin, rtMax) {
    const lo = Math.max(0, Math.floor(Number(rtMin) || 0));
    const hi = Math.max(lo + 1, Number(rtMax) || lo + 1);
    const span = Math.max(1, hi - lo);
    const step = getNiceHistogramStep(span / 4);
    const axisMax = lo + Math.max(step, Math.ceil(span / step) * step);
    const ticks = [];
    for (let value = lo; value <= axisMax; value += step) ticks.push(value);
    return ticks;
}

function buildDailyProgressXTicks(totalDays) {
    const days = Math.max(1, Number(totalDays) || 1);
    if (days === 1) return [1];
    const desiredCount = Math.min(6, days);
    const ticks = new Set();
    for (let i = 0; i < desiredCount; i += 1) {
        const fraction = i / (desiredCount - 1);
        const day = Math.round(1 + fraction * (days - 1));
        ticks.add(day);
    }
    return Array.from(ticks).sort((a, b) => a - b);
}

function renderDailyProgressPanel(chart) {
    const points = Array.isArray(chart?.points) ? chart.points : [];
    if (!points.length) return '';
    const totalDays = Math.max(1, Number(chart?.totalDays) || points.length);
    const yMax = Math.max(1, Number(chart?.yMax) || 0);
    const yTicks = buildDailyProgressYTicks(yMax);
    const axisMax = yTicks[yTicks.length - 1] || yMax;
    const rtMaxRaw = Number(chart?.rtMax) || 0;
    const rtMinRaw = Number(chart?.rtMin);
    const hasRtData = rtMaxRaw > 0 && Number.isFinite(rtMinRaw);
    const rtTicks = hasRtData ? buildResponseTimeYTicks(rtMinRaw, rtMaxRaw) : [];
    const rtAxisMin = rtTicks.length ? rtTicks[0] : 0;
    const rtAxisMax = rtTicks.length ? rtTicks[rtTicks.length - 1] : 0;
    const rtAxisRange = rtAxisMax - rtAxisMin;
    const xTicks = buildDailyProgressXTicks(totalDays);
    const positionForDay = (dayIndex) => totalDays <= 1 ? 50 : ((dayIndex - 1) / (totalDays - 1)) * 100;
    const positionForValue = (value) => axisMax <= 0 ? 0 : (Number(value) / axisMax) * 100;
    const positionForRt = (value) => rtAxisRange <= 0 ? 0 : ((Number(value) - rtAxisMin) / rtAxisRange) * 100;
    const buildLinePath = (key) => points.map((point, idx) => {
        const x = positionForDay(point.dayIndex).toFixed(2);
        const y = (100 - positionForValue(point[key])).toFixed(2);
        return `${idx === 0 ? 'M' : 'L'}${x},${y}`;
    }).join(' ');
    const buildResponseTimePath = () => {
        const segments = [];
        let pendingMove = true;
        for (const point of points) {
            const value = Number(point.avgCorrectRtSec);
            if (!Number.isFinite(value)) {
                pendingMove = true;
                continue;
            }
            const x = positionForDay(point.dayIndex).toFixed(2);
            const y = (100 - positionForRt(value)).toFixed(2);
            segments.push(`${pendingMove ? 'M' : 'L'}${x},${y}`);
            pendingMove = false;
        }
        return segments.join(' ');
    };
    const practicedPath = buildLinePath('practiced');
    const learnedPath = buildLinePath('learned');
    const responseTimePath = hasRtData ? buildResponseTimePath() : '';
    const lastPoint = points[points.length - 1] || { practiced: 0, learned: 0, avgCorrectRtSec: null };
    const lastRtValue = Number(lastPoint?.avgCorrectRtSec);
    const lastRtLabel = Number.isFinite(lastRtValue) ? `${lastRtValue.toFixed(2)}s` : '—';
    const formatRtTick = (tick) => {
        const num = Number(tick);
        if (!Number.isFinite(num)) return '';
        return Number.isInteger(num) ? `${num}s` : `${num.toFixed(1)}s`;
    };
    return `
        <div class="cards-distribution-card daily-progress-card${hasRtData ? ' has-response-time' : ''}">
            <div class="cards-distribution-card-head">
                <div class="cards-distribution-card-title">${escapeHtml(String(chart?.title || 'Daily Progress'))}</div>
                <div class="daily-progress-legend">
                    <span class="daily-progress-legend-item practiced"><span class="daily-progress-legend-swatch"></span>Practiced (${escapeHtml(String(lastPoint.practiced))})</span>
                    <span class="daily-progress-legend-item learned"><span class="daily-progress-legend-swatch"></span>Learned (${escapeHtml(String(lastPoint.learned))})</span>
                    ${hasRtData ? `<span class="daily-progress-legend-item response-time"><span class="daily-progress-legend-swatch"></span>Avg correct response (${escapeHtml(lastRtLabel)})</span>` : ''}
                </div>
            </div>
            <div class="daily-progress-chart">
                <div class="daily-progress-y-label">Cards</div>
                <div class="daily-progress-y-axis">
                    ${yTicks.map((tick) => `
                        <div class="daily-progress-y-tick" style="bottom:${positionForValue(tick).toFixed(2)}%">${escapeHtml(String(tick))}</div>
                    `).join('')}
                </div>
                ${hasRtData ? `
                    <div class="daily-progress-y-label daily-progress-y-label-right">Response</div>
                    <div class="daily-progress-y-axis daily-progress-y-axis-right">
                        ${rtTicks.map((tick) => `
                            <div class="daily-progress-y-tick" style="bottom:${positionForRt(tick).toFixed(2)}%">${escapeHtml(formatRtTick(tick))}</div>
                        `).join('')}
                    </div>
                ` : ''}
                <div class="daily-progress-plot">
                    <div class="daily-progress-grid">
                        ${yTicks.map((tick) => `
                            <div class="daily-progress-grid-line" style="bottom:${positionForValue(tick).toFixed(2)}%"></div>
                        `).join('')}
                    </div>
                    <svg class="daily-progress-svg" viewBox="0 0 100 100" preserveAspectRatio="none">
                        <path class="daily-progress-line practiced" d="${practicedPath}" />
                        <path class="daily-progress-line learned" d="${learnedPath}" />
                        ${responseTimePath ? `<path class="daily-progress-line response-time" d="${responseTimePath}" />` : ''}
                    </svg>
                    <div class="daily-progress-x-axis">
                        ${xTicks.map((tick) => {
                            const isLast = tick === totalDays;
                            return `
                            <div class="daily-progress-x-tick${isLast ? ' is-today' : ''}" style="left:${positionForDay(tick).toFixed(2)}%">Day ${escapeHtml(String(tick))}${isLast ? '<div class="daily-progress-x-tick-today">(today)</div>' : ''}</div>
                        `;
                        }).join('')}
                    </div>
                </div>
            </div>
        </div>
    `;
}

function renderDistributionPanel(panel) {
    const bars = Array.isArray(panel?.bars) ? panel.bars : [];
    const percentiles = Array.isArray(panel?.percentiles) ? panel.percentiles : [];
    const toneClass = String(panel?.tone || '').trim();
    const tickValues = Array.isArray(panel?.tickValues) ? panel.tickValues : [];
    const yMax = Number(panel?.yMax) || 0;
    if (!bars.length || panel?.emptyMessage) {
        return `
            <div class="cards-distribution-card">
                <div class="cards-distribution-card-head">
                    <div class="cards-distribution-card-title">${escapeHtml(String(panel?.title || ''))}</div>
                </div>
                <div class="cards-view-placeholder">${escapeHtml(String(panel?.emptyMessage || 'No data yet.'))}</div>
            </div>
        `;
    }
    const topLists = Array.isArray(panel?.topLists) ? panel.topLists : [];
    return `
        <div class="cards-distribution-card">
            <div class="cards-distribution-card-head">
                <div class="cards-distribution-card-title">${escapeHtml(String(panel?.title || ''))}</div>
            </div>
            <div class="cards-distribution-body">
                <div class="cards-distribution-chart">
                    <div class="cards-distribution-y-label">${escapeHtml(String(panel?.yAxisLabel || 'Cards'))}</div>
                    <div class="cards-distribution-y-axis">
                        ${tickValues.map((tickValue) => `
                            <div class="cards-distribution-y-tick" style="bottom:${getHistogramVerticalPositionPct(tickValue, yMax).toFixed(2)}%">
                                ${escapeHtml(formatCompactCountLabel(tickValue))}
                            </div>
                        `).join('')}
                    </div>
                    <div class="cards-distribution-grid-layer">
                        ${tickValues.map((tickValue) => `
                            <div class="cards-distribution-grid-line" style="bottom:${getHistogramVerticalPositionPct(tickValue, yMax).toFixed(2)}%"></div>
                        `).join('')}
                    </div>
                    <div class="cards-distribution-marker-layer">
                        ${percentiles.map((marker) => `
                            <div class="cards-distribution-marker ${escapeHtml(String(marker?.className || ''))}" style="left:${Math.max(0, Math.min(100, Number(marker?.positionPct) || 0)).toFixed(2)}%">
                                <div class="cards-distribution-marker-badge">
                                    <div class="cards-distribution-marker-name">${escapeHtml(String(marker?.label || ''))}</div>
                                    <div class="cards-distribution-marker-value">${escapeHtml(String(marker?.valueLabel || ''))}</div>
                                </div>
                                <div class="cards-distribution-marker-line"></div>
                            </div>
                        `).join('')}
                    </div>
                    <div class="cards-distribution-bars" style="grid-template-columns: repeat(${bars.length}, minmax(0, 1fr));">
                        ${bars.map((bar) => {
                            const count = Math.max(0, Number(bar?.count) || 0);
                            const heightPct = yMax > 0 ? (count / yMax) * 100 : 0;
                            return `
                                <div class="cards-distribution-bar-slot">
                                    <div class="cards-distribution-bar-stack">
                                        <div class="cards-distribution-bar-count">${escapeHtml(formatCompactCountLabel(count))}</div>
                                        <div class="cards-distribution-bar ${escapeHtml(toneClass)}" style="height:${Math.max(0, Math.min(100, heightPct)).toFixed(2)}%"></div>
                                    </div>
                                    <div class="cards-distribution-bar-label">${escapeHtml(String(bar?.label || ''))}</div>
                                </div>
                            `;
                        }).join('')}
                    </div>
                    <div class="cards-distribution-baseline"></div>
                </div>
                ${topLists.length ? `
                    <div class="cards-distribution-sidebar">
                        ${topLists.map((list) => `
                            <div class="cards-distribution-toplist">
                                <div class="cards-distribution-toplist-title">${escapeHtml(String(list?.title || ''))}</div>
                                <ol class="cards-distribution-toplist-items">
                                    ${(Array.isArray(list?.entries) ? list.entries : []).map((entry) => `
                                        <li class="cards-distribution-toplist-row">
                                            <span class="cards-distribution-toplist-item">
                                                <span class="cards-distribution-toplist-front">${escapeHtml(String(entry?.front || ''))}</span>
                                                <span class="cards-distribution-toplist-value">${escapeHtml(String(entry?.valueLabel || ''))}</span>
                                            </span>
                                        </li>
                                    `).join('')}
                                </ol>
                            </div>
                        `).join('')}
                    </div>
                ` : ''}
            </div>
        </div>
    `;
}
