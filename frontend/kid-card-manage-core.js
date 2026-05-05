// Bootstrap, constants, DOM lookups, page-level state, generic helpers, modal helpers, kid nav, page title, category UI text.
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
const CARDS_VIEW_MODE_STORAGE_KEY = 'kidCardManage_cardsViewMode';
const CARDS_VIEW_MODES = new Set(['queue', 'stats', 'report']);
function normalizeCardsViewMode(value) {
    return CARDS_VIEW_MODES.has(value) ? value : 'queue';
}
let currentCardsViewMode = (() => {
    try {
        return normalizeCardsViewMode(localStorage.getItem(CARDS_VIEW_MODE_STORAGE_KEY));
    } catch (_err) {
        return 'queue';
    }
})();
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
let currentCardSortDirection = CARD_SORT_DIRECTION_DESC;
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

function getDefaultCardSortDirection() {
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

function setCardsLoadingIndicatorVisible(visible) {
    const indicator = document.getElementById('cardsLoadingIndicator');
    if (!indicator) return;
    indicator.classList.toggle('hidden', !visible);
    const grid = document.getElementById('cardsGrid');
    if (grid) {
        grid.classList.toggle('hidden', !!visible);
    }
}
