const API_BASE = `${window.location.origin}/api`;

const params = new URLSearchParams(window.location.search);
const kidId = params.get('id');
const SESSION_CARD_COUNT_BY_CATEGORY_FIELD = 'sessionCardCountByCategory';
const INCLUDE_ORPHAN_BY_CATEGORY_FIELD = 'includeOrphanByCategory';
const HARD_CARD_PERCENT_BY_CATEGORY_FIELD = 'hardCardPercentageByCategory';
const BEHAVIOR_TYPE_TYPE_I = 'type_i';
const BEHAVIOR_TYPE_TYPE_II = 'type_ii';
const BEHAVIOR_TYPE_TYPE_III = 'type_iii';
const SHARED_SCOPE_CARDS = 'cards';
const SHARED_SCOPE_TYPE2 = 'type2';
const SHARED_SCOPE_LESSON_READING = 'lesson-reading';

const {
    normalizeCategoryKey,
    parseDeckTagInput,
    getCategoryRawValueMap,
    getDeckCategoryMetaMap,
} = window.DeckCategoryCommon;
const categoryKey = normalizeCategoryKey(params.get('categoryKey'));

const kidNameEl = document.getElementById('kidName');
const errorMessage = document.getElementById('errorMessage');
const successMessage = document.getElementById('successMessage');

const sessionSettingsForm = document.getElementById('sessionSettingsForm');
const sessionCardCountInput = document.getElementById('sessionCardCount');
const sessionCardCountLabel = document.getElementById('sessionCardCountLabel');
const optInDecksHeading = document.getElementById('optInDecksHeading');
const optInDecksNote = document.getElementById('optInDecksNote');
const cardsSectionTitleText = document.getElementById('cardsSectionTitleText');
const hardnessComputationHint = document.getElementById('hardnessComputationHint');

const availableDecksEl = document.getElementById('availableDecks');
const availableEmptyEl = document.getElementById('availableEmpty');
const availablePersonalDeckEl = document.getElementById('availablePersonalDeck');
const availableTagFilterInput = document.getElementById('availableTagFilter');
const availableDecksTitle = document.getElementById('availableDecksTitle');
const optInAllAvailableBtn = document.getElementById('optInAllAvailableBtn');
const selectedDecksEl = document.getElementById('selectedDecks');
const selectedEmptyEl = document.getElementById('selectedEmpty');
const selectedPersonalDeckEl = document.getElementById('selectedPersonalDeck');
const selectedTagFilterInput = document.getElementById('selectedTagFilter');
const selectedDecksTitle = document.getElementById('selectedDecksTitle');
const optOutAllSelectedBtn = document.getElementById('optOutAllSelectedBtn');
const applyDeckChangesBtn = document.getElementById('applyDeckChangesBtn');
const deckPendingInfo = document.getElementById('deckPendingInfo');
const deckChangeMessage = document.getElementById('deckChangeMessage');
const orphanEditorSection = document.getElementById('orphanEditorSection');
const orphanEditorTitle = document.getElementById('orphanEditorTitle');
const addCardForm = document.getElementById('addCardForm');
const chineseCharInput = document.getElementById('chineseChar');
const addReadingBtn = document.getElementById('addReadingBtn');
const addCardStatusMessage = document.getElementById('addCardStatusMessage');
const type2ChineseSheetSection = document.getElementById('type2ChineseSheetSection');
const type2ChineseSheetSectionTitleText = document.getElementById('type2ChineseSheetSectionTitleText');
const sheetCardCountInput = document.getElementById('sheetCardCount');
const sheetRowsPerCharInput = document.getElementById('sheetRowsPerChar');
const createSheetBtn = document.getElementById('createSheetBtn');
const viewSheetsBtn = document.getElementById('viewSheetsBtn');
const sheetErrorMessage = document.getElementById('sheetErrorMessage');
const practicingDeckCount = document.getElementById('practicingDeckCount');
const practicingDeckGrid = document.getElementById('practicingDeckGrid');
const practicingDeckEmpty = document.getElementById('practicingDeckEmpty');
const pendingSheetCardsGrid = document.getElementById('pendingSheetCardsGrid');
const pendingSheetCardsEmpty = document.getElementById('pendingSheetCardsEmpty');

const viewOrderSelect = document.getElementById('viewOrderSelect');
const cardSearchInput = document.getElementById('cardSearchInput');
const mathCardCount = document.getElementById('mathCardCount');
const cardsGrid = document.getElementById('cardsGrid');
const cardStatusFilterButtons = [...document.querySelectorAll('button[data-card-status-filter]')];
const hardnessPercentSlider = document.getElementById('hardnessPercentSlider');
const hardnessPercentValue = document.getElementById('hardnessPercentValue');
const hardnessPercentStatus = document.getElementById('hardnessPercentStatus');
const hardCardPresetButtons = [...document.querySelectorAll('button[data-hard-card-preset]')];

let allDecks = [];
let orphanDeck = null;
let currentCards = [];
let state2Cards = [];
let state3Cards = [];
let sortedCards = [];
let visibleCardCount = 10;
let isDeckMoveInFlight = false;
let baselineOptedDeckIdSet = new Set();
let stagedOptedDeckIdSet = new Set();
let availableTagFilterController = null;
let optInAllAvailableController = null;
let selectedTagFilterController = null;
let optOutAllSelectedController = null;
let baselineIncludeOrphanInQueue = false;
let stagedIncludeOrphanInQueue = false;
let hardnessController = null;
let sharedDeckCardsResponseTracker = null;
let currentCategoryDisplayName = 'Practice';
let currentKidName = '';
let isChineseSpecificLogic = false;
let currentSharedScope = SHARED_SCOPE_CARDS;
let currentBehaviorType = BEHAVIOR_TYPE_TYPE_I;
let isReadingBulkAdding = false;
let initialHardCardPercent = null;
let currentSkippedCardCount = 0;
let currentCardStatusFilter = 'all';
let sessionCardCountByCategory = {};
let includeOrphanByCategory = {};
let hardCardPercentByCategory = {};
const CARD_PAGE_SIZE = 10;
const WRITING_SHEET_MAX_ROWS = 10;
const HARD_CARD_PRESET_STEP = 20;
const ORPHAN_BUBBLE_ID = '__orphan__';
const MAX_DECK_BUBBLE_COUNT = 10;
const CHINESE_FRONT_MAX_FONT_SIZE_REM = 4;
const CHINESE_FRONT_MIN_FONT_SIZE_REM = 0.55;
const CHINESE_FRONT_FIT_ITERATIONS = 8;
const SHOW_DECK_COUNT_MISMATCH_WARNING = false;

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
    if (!deckChangeMessage) {
        return;
    }
    const text = String(message || '').trim();
    if (!text) {
        deckChangeMessage.textContent = '';
        deckChangeMessage.classList.add('hidden');
        deckChangeMessage.classList.remove('error');
        deckChangeMessage.classList.add('success');
        return;
    }
    deckChangeMessage.textContent = text;
    deckChangeMessage.classList.remove('hidden');
    deckChangeMessage.classList.toggle('error', isError);
    deckChangeMessage.classList.toggle('success', !isError);
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

function showSheetError(message) {
    if (!sheetErrorMessage) {
        return;
    }
    const text = String(message || '').trim();
    if (!text) {
        sheetErrorMessage.textContent = '';
        sheetErrorMessage.classList.add('hidden');
        return;
    }
    sheetErrorMessage.textContent = text;
    sheetErrorMessage.classList.remove('hidden');
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

function isType2Behavior() {
    return currentBehaviorType === BEHAVIOR_TYPE_TYPE_II;
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
    const showOrphanEditor = isChineseSpecificLogic
        && (currentBehaviorType === BEHAVIOR_TYPE_TYPE_I || currentBehaviorType === BEHAVIOR_TYPE_TYPE_II);
    const showType2ChineseSheet = isType2Behavior() && isChineseSpecificLogic;
    if (sessionCardCountLabel) {
        sessionCardCountLabel.textContent = `${displayName} Cards Per Session (Total Across Opted-in Decks)`;
    }
    if (optInDecksHeading) {
        optInDecksHeading.textContent = `Opt-in Shared ${displayName} Decks`;
    }
    if (optInDecksNote) {
        optInDecksNote.textContent = 'Choose which shared decks to use, then click Apply Deck Changes. If you opt out of a shared deck, cards with practice history are kept in Personal Deck so progress is not lost.';
    }
    if (cardsSectionTitleText) {
        cardsSectionTitleText.textContent = `${displayName} Cards`;
    }
    if (hardnessComputationHint) {
        if (isType2Behavior()) {
            hardnessComputationHint.textContent = 'Choose what % of the next session uses harder cards; the rest uses least-played cards. Here, harder cards are based on overall correctness rate.';
        } else {
            hardnessComputationHint.textContent = 'Choose what % of the next session uses harder cards; the rest uses least-played cards. Here, harder cards are based on each card\'s most recent response time.';
        }
    }
    if (orphanEditorSection) {
        orphanEditorSection.classList.toggle('hidden', !showOrphanEditor);
    }
    if (orphanEditorTitle) {
        orphanEditorTitle.textContent = isType2Behavior()
            ? 'Bulk Add Chinese Words/Phrases'
            : 'Bulk Add Chinese Characters';
    }
    if (chineseCharInput) {
        chineseCharInput.placeholder = isType2Behavior()
            ? '比如:\nDAY1:好像 香 菜 为难 关心 事情 很重 虽然 但是 改变 昨天 放心 更好\nDAY2:答应 病了 知道 从来 勇敢 感动 高山 一起 可是 找人 怎么 远 路'
            : '比如:\nDAY1:坐着 甘罗 甘茂 叹了口气 皇帝 做官 爷爷 留在 孙子 总是 实在 \nDAY2:说明 有说有笑 心事 喜欢 当作 胡说 清楚 北方 摸着 肩膀';
    }
    if (type2ChineseSheetSection) {
        type2ChineseSheetSection.classList.toggle('hidden', !showType2ChineseSheet);
    }
    if (type2ChineseSheetSectionTitleText) {
        type2ChineseSheetSectionTitleText.textContent = `Suggested ${displayName} Candidate Cards`;
    }
    document.body.classList.toggle('type1-chinese-mode', isChineseSpecificLogic);
    updateAddReadingButtonCount();
    updatePageTitle();
}

function getDeckById(deckId) {
    return allDecks.find((deck) => Number(deck.deck_id) === Number(deckId)) || null;
}

function getOptedDecks() {
    return allDecks.filter((deck) => stagedOptedDeckIdSet.has(Number(deck.deck_id)));
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
    const toOptIn = [];
    const toOptOut = [];
    stagedOptedDeckIdSet.forEach((deckId) => {
        if (!baselineOptedDeckIdSet.has(deckId)) {
            toOptIn.push(deckId);
        }
    });
    baselineOptedDeckIdSet.forEach((deckId) => {
        if (!stagedOptedDeckIdSet.has(deckId)) {
            toOptOut.push(deckId);
        }
    });

    const orphanPending = stagedIncludeOrphanInQueue !== baselineIncludeOrphanInQueue;
    if (toOptIn.length === 0 && toOptOut.length === 0 && !orphanPending) {
        deckPendingInfo.textContent = 'No pending deck changes.';
        applyDeckChangesBtn.disabled = true;
        applyDeckChangesBtn.textContent = 'Apply Deck Changes';
        if (optInAllAvailableController) {
            optInAllAvailableController.render();
        }
        if (optOutAllSelectedController) {
            optOutAllSelectedController.render();
        }
        return;
    }

    const orphanText = orphanPending
        ? `, Personal Deck ${stagedIncludeOrphanInQueue ? 'opt-in' : 'opt-out'}`
        : '';
    deckPendingInfo.textContent = `Pending: ${toOptIn.length} opt-in, ${toOptOut.length} opt-out${orphanText}.`;
    applyDeckChangesBtn.disabled = isDeckMoveInFlight;
    applyDeckChangesBtn.textContent = isDeckMoveInFlight ? 'Applying...' : 'Apply Deck Changes';
    if (optInAllAvailableController) {
        optInAllAvailableController.render();
    }
    if (optOutAllSelectedController) {
        optOutAllSelectedController.render();
    }
}

function buildOrphanDeckBubbleHtml(direction) {
    const normalizedDirection = String(direction || '').trim().toLowerCase();
    if (!orphanDeck || (normalizedDirection !== 'in' && normalizedDirection !== 'out')) {
        return '';
    }
    const pendingClass = stagedIncludeOrphanInQueue !== baselineIncludeOrphanInQueue ? ' pending-change' : '';
    const orphanName = getPersonalDeckDisplayName();
    const orphanCount = Number(orphanDeck && orphanDeck.card_count ? orphanDeck.card_count : 0);
    const action = normalizedDirection === 'in' ? 'opt-in' : 'opt-out';
    return `
        <button
            type="button"
            class="deck-bubble${pendingClass}"
            data-deck-id="${ORPHAN_BUBBLE_ID}"
            data-orphan-toggle="${normalizedDirection}"
            title="Click to stage Personal Deck ${action}"
        >${escapeHtml(orphanName)}${escapeHtml(` · ${orphanCount} cards`)}</button>
    `;
}

function hasPendingDeckMembershipChange(deckId) {
    const numericDeckId = Number(deckId);
    if (!(numericDeckId > 0)) {
        return false;
    }
    return baselineOptedDeckIdSet.has(numericDeckId) !== stagedOptedDeckIdSet.has(numericDeckId);
}

function getPendingDeckBubbleClass(deck) {
    const deckId = Number(deck && deck.deck_id ? deck.deck_id : 0);
    return hasPendingDeckMembershipChange(deckId) ? 'pending-change' : '';
}

function sortDecksPendingFirst(decks) {
    const list = Array.isArray(decks) ? decks : [];
    return list
        .map((deck, index) => ({
            deck,
            index,
            pending: hasPendingDeckMembershipChange(deck && deck.deck_id) ? 1 : 0,
        }))
        .sort((a, b) => {
            if (b.pending !== a.pending) {
                return b.pending - a.pending;
            }
            return a.index - b.index;
        })
        .map((entry) => entry.deck);
}

function renderDeckBubbleColumn(config = {}) {
    const titleEl = config.titleEl || null;
    const titleText = String(config.titleText || 'Decks').trim() || 'Decks';
    const titleSuffix = String(config.titleSuffix || '');
    const totalCount = Number.parseInt(String(config.totalCount), 10);
    if (titleEl) {
        const resolvedTotal = Number.isInteger(totalCount) && totalCount >= 0 ? totalCount : 0;
        titleEl.textContent = `${titleText} (${resolvedTotal}${titleSuffix})`;
    }

    const bulkController = config.bulkController || null;
    const filteredDecks = Array.isArray(config.filteredDecks) ? config.filteredDecks : [];
    const getBubbleClassName = typeof config.getBubbleClassName === 'function'
        ? config.getBubbleClassName
        : null;
    const orderedDecks = getBubbleClassName
        ? filteredDecks
            .map((deck, index) => {
                const className = String(getBubbleClassName(deck) || '').trim();
                const isPending = className.split(/\s+/).includes('pending-change');
                return { deck, index, isPending };
            })
            .sort((a, b) => {
                if (a.isPending !== b.isPending) {
                    return a.isPending ? -1 : 1;
                }
                return a.index - b.index;
            })
            .map((item) => item.deck)
        : filteredDecks;

    if (bulkController && typeof bulkController.render === 'function') {
        bulkController.render(orderedDecks.length);
    }

    window.PracticeManageCommon.renderLimitedAvailableDecks({
        containerEl: config.containerEl,
        emptyEl: config.emptyEl,
        allAvailableDecks: Array.isArray(config.allDecks) ? config.allDecks : [],
        filteredDecks: orderedDecks,
        emptyText: String(config.emptyText || ''),
        filterLabel: String(config.filterLabel || ''),
        noMatchTextPrefix: String(config.noMatchTextPrefix || ''),
        getLabel: typeof config.getLabel === 'function' ? config.getLabel : getType1DeckBubbleLabel,
        getBubbleClassName,
        bubbleTitle: String(config.bubbleTitle || ''),
        maxVisibleCount: MAX_DECK_BUBBLE_COUNT,
    });
}

function renderPersonalDeckControl(containerEl, direction) {
    if (!containerEl) {
        return;
    }
    const buttonHtml = buildOrphanDeckBubbleHtml(direction);
    containerEl.innerHTML = buttonHtml;
}

function renderAvailableDecks() {
    const tagFilter = ensureAvailableTagFilterController();
    tagFilter.sync();
    const allAvailableDecks = getAvailableDeckCandidatesForTagFilter();
    const deckList = sortDecksPendingFirst(allAvailableDecks.filter(matchesAvailableTagFilter));
    const shouldShowOrphan = Boolean(orphanDeck) && !stagedIncludeOrphanInQueue;
    const availableDeckCount = deckList.length + (shouldShowOrphan ? 1 : 0);

    renderDeckBubbleColumn({
        titleEl: availableDecksTitle,
        titleText: 'Available Shared Decks',
        totalCount: availableDeckCount,
        bulkController: optInAllAvailableController,
        containerEl: availableDecksEl,
        emptyEl: availableEmptyEl,
        allDecks: allAvailableDecks,
        filteredDecks: deckList,
        emptyText: `No shared ${getCurrentCategoryDisplayName()} decks available yet.`,
        filterLabel: tagFilter.getDisplayLabel(),
        getLabel: getType1DeckBubbleLabel,
        getBubbleClassName: getPendingDeckBubbleClass,
        bubbleTitle: 'Click to stage opt-in',
    });
    renderPersonalDeckControl(availablePersonalDeckEl, shouldShowOrphan ? 'in' : '');
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
    const tags = getDeckTags(deck);
    if (tags.length > 1 && tags[0] === categoryKey) {
        return tags.slice(1).join('_');
    }
    const stripped = stripCategoryFirstTagFromName(deck && deck.name);
    return stripped || String(deck && deck.name ? deck.name : '');
}

function getPersonalDeckDisplayName() {
    return 'Personal Deck';
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

function getAvailableDeckCandidatesForTagFilter() {
    return (Array.isArray(allDecks) ? allDecks : []).filter(
        (deck) => !stagedOptedDeckIdSet.has(Number(deck.deck_id))
    );
}

function getSelectedDeckCandidatesForTagFilter() {
    return getOptedDecks();
}

function ensureAvailableTagFilterController() {
    if (availableTagFilterController) {
        return availableTagFilterController;
    }
    availableTagFilterController = window.PracticeManageCommon.createHierarchicalTagFilterController({
        selectEl: availableTagFilterInput,
        getDecks: getAvailableDeckCandidatesForTagFilter,
        getDeckTags,
        getDeckTagLabels,
        onFilterChanged: () => {
            renderAvailableDecks();
        },
    });
    return availableTagFilterController;
}

function matchesAvailableTagFilter(deck) {
    return ensureAvailableTagFilterController().matchesDeck(deck);
}

function ensureSelectedTagFilterController() {
    if (selectedTagFilterController) {
        return selectedTagFilterController;
    }
    selectedTagFilterController = window.PracticeManageCommon.createHierarchicalTagFilterController({
        selectEl: selectedTagFilterInput,
        getDecks: getSelectedDeckCandidatesForTagFilter,
        getDeckTags,
        getDeckTagLabels,
        onFilterChanged: () => {
            renderSelectedDecks();
        },
    });
    return selectedTagFilterController;
}

function matchesSelectedTagFilter(deck) {
    return ensureSelectedTagFilterController().matchesDeck(deck);
}

function clearDeckSelectionMessages() {
    showError('');
    showSuccess('');
    showDeckChangeMessage('');
}

async function refreshDeckSelectionViews() {
    renderAvailableDecks();
    renderSelectedDecks();
    renderDeckPendingInfo();
    await loadSharedDeckCards();
}

function renderSelectedDecks() {
    const tagFilter = ensureSelectedTagFilterController();
    tagFilter.sync();
    const optedDecks = getSelectedDeckCandidatesForTagFilter();
    const deckList = sortDecksPendingFirst(optedDecks.filter(matchesSelectedTagFilter));
    const showOrphanInSelected = Boolean(orphanDeck) && stagedIncludeOrphanInQueue;
    const warningCount = deckList.filter((deck) => hasDeckCountMismatchWarning(deck)).length;
    const warningSuffix = warningCount > 0 ? ` · ⚠ ${warningCount}` : '';
    const selectedDeckCount = deckList.length + (showOrphanInSelected ? 1 : 0);

    renderDeckBubbleColumn({
        titleEl: selectedDecksTitle,
        titleText: 'Opted-in Decks',
        titleSuffix: warningSuffix,
        totalCount: selectedDeckCount,
        bulkController: optOutAllSelectedController,
        containerEl: selectedDecksEl,
        emptyEl: selectedEmptyEl,
        allDecks: optedDecks,
        filteredDecks: deckList,
        emptyText: 'No deck opted in.',
        filterLabel: tagFilter.getDisplayLabel(),
        noMatchTextPrefix: 'No opted-in deck matches tag',
        getLabel: getType1DeckBubbleLabel,
        getBubbleClassName: getPendingDeckBubbleClass,
        bubbleTitle: 'Click to stage opt-out',
    });
    renderPersonalDeckControl(selectedPersonalDeckEl, showOrphanInSelected ? 'out' : '');
}

function filterCardsByQuery(cards, rawQuery) {
    const query = String(rawQuery || '').trim();
    if (!query) {
        return cards;
    }
    return cards.filter((card) => {
        const front = String(card.front || '');
        const back = String(card.back || '');
        const source = String(card.source_deck_label || card.source_deck_name || '');
        return front.includes(query) || back.includes(query) || source.includes(query);
    });
}

function filterCardsByStatus(cards, statusFilter) {
    const mode = String(statusFilter || 'all').trim().toLowerCase();
    if (mode === 'active') {
        return cards.filter((card) => !card.skip_practice);
    }
    if (mode === 'skipped') {
        return cards.filter((card) => !!card.skip_practice);
    }
    return cards;
}

function renderCardStatusFilterButtons() {
    if (!cardStatusFilterButtons.length) {
        return;
    }
    cardStatusFilterButtons.forEach((button) => {
        const mode = String(button.getAttribute('data-card-status-filter') || '').trim().toLowerCase();
        button.classList.toggle('active', mode === currentCardStatusFilter);
    });
}

function setCardStatusFilter(nextFilter) {
    const mode = String(nextFilter || '').trim().toLowerCase();
    const resolved = (mode === 'active' || mode === 'skipped') ? mode : 'all';
    if (resolved === currentCardStatusFilter) {
        return;
    }
    currentCardStatusFilter = resolved;
    renderCardStatusFilterButtons();
    resetAndDisplayCards(currentCards);
}

function roundToHardCardPresetStep(value) {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isInteger(parsed)) {
        return 0;
    }
    const clamped = Math.max(0, Math.min(100, parsed));
    const rounded = Math.round(clamped / HARD_CARD_PRESET_STEP) * HARD_CARD_PRESET_STEP;
    return Math.max(0, Math.min(100, rounded));
}

function renderHardCardPresetButtons() {
    if (!hardCardPresetButtons.length) {
        return;
    }
    const current = roundToHardCardPresetStep(hardnessPercentSlider ? hardnessPercentSlider.value : 0);
    hardCardPresetButtons.forEach((button) => {
        const value = roundToHardCardPresetStep(button.getAttribute('data-hard-card-preset'));
        const isActive = value === current;
        button.classList.toggle('active', isActive);
        button.setAttribute('aria-pressed', isActive ? 'true' : 'false');
    });
}

function applyHardCardPreset(rawValue) {
    if (!hardnessPercentSlider) {
        return;
    }
    const next = roundToHardCardPresetStep(rawValue);
    hardnessPercentSlider.value = String(next);
    hardnessPercentSlider.dispatchEvent(new Event('input', { bubbles: true }));
    hardnessPercentSlider.dispatchEvent(new Event('change', { bubbles: true }));
    renderHardCardPresetButtons();
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

function buildChineseCardMarkup(card) {
    return buildCardMarkup(card, {
        cardClassNames: ['type1-chinese-card'],
        primaryText: card.front,
        secondaryText: card.back,
        showSecondary: String(card.back || '').trim().length > 0,
        includeAddedDate: true,
    });
}

function buildGenericType1CardMarkup(card) {
    return buildCardMarkup(card, {
        primaryText: card.front,
        secondaryText: card.back,
        showSecondary: true,
        includeAddedDate: false,
    });
}

function buildType2CardMarkup(card) {
    const hasSavedAudio = !!card.audio_url;
    const primaryText = isChineseSpecificLogic
        ? String(card.back || card.front || '')
        : String(card.front || '');
    const secondaryText = isChineseSpecificLogic
        ? String(card.front || '')
        : String(card.back || '');
    const showSecondary = isChineseSpecificLogic
        ? secondaryText.length > 0 && secondaryText !== primaryText
        : secondaryText.length > 0;
    const audioActionsHtml = `
        <div class="selected-audio-bar">
            <div class="selected-audio-title">Audio</div>
            <div class="selected-audio-actions">
                <button
                    type="button"
                    class="selected-audio-btn save"
                    data-action="edit-front"
                    data-card-id="${escapeHtml(card.id)}"
                >Edit Prompt</button>
                <button
                    type="button"
                    class="selected-audio-btn save"
                    data-action="load-play-audio"
                    data-card-id="${escapeHtml(card.id)}"
                >Load/Play</button>
            </div>
        </div>
        ${hasSavedAudio ? '' : '<div style="margin-top: 4px; color: #9a5a00; font-size: 0.8rem;">Will auto-generate on first play</div>'}
    `;
    return buildCardMarkup(card, {
        cardClassNames: isChineseSpecificLogic ? ['type1-chinese-card'] : [],
        primaryText,
        secondaryText,
        showSecondary,
        includeAddedDate: true,
        extraSectionHtml: audioActionsHtml,
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

function formatMillisecondsAsSeconds(value) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric <= 0) {
        return '-';
    }
    const seconds = numeric / 1000;
    if (seconds >= 1) {
        const rounded = Math.round(seconds * 10) / 10;
        return Number.isInteger(rounded) ? `${rounded}s` : `${rounded.toFixed(1)}s`;
    }
    const short = seconds.toFixed(2).replace(/0+$/g, '').replace(/\.$/, '');
    return `${short}s`;
}

function getCardMetricDescription(card) {
    if (isType2Behavior()) {
        return `Overall wrong rate: ${formatMetricPercent(card && card.hardness_score)}`;
    }
    return `Last response: ${formatMillisecondsAsSeconds(card && card.hardness_score)}`;
}

function buildCardMarkup(card, options = {}) {
    const classes = ['card-item', ...(Array.isArray(options.cardClassNames) ? options.cardClassNames : [])];
    if (card.skip_practice) {
        classes.push('skipped');
    }
    const primaryText = String(options.primaryText || '');
    const secondaryText = String(options.secondaryText || '');
    const showSecondary = options.showSecondary !== false && secondaryText.trim().length > 0;
    const includeAddedDate = Boolean(options.includeAddedDate);
    const extraSectionHtml = String(options.extraSectionHtml || '');
    const sourceText = String(card.source_deck_label || card.source_deck_name || '-');

    return `
        <div class="${classes.filter(Boolean).join(' ')}">
            <button
                type="button"
                class="skip-toggle-btn ${card.skip_practice ? 'on' : 'off'}"
                data-action="toggle-skip"
                data-card-id="${card.id}"
                data-skipped="${card.skip_practice ? 'true' : 'false'}"
                title="${card.skip_practice ? 'Turn skip off for this card' : 'Mark this card as skipped'}"
                aria-label="${card.skip_practice ? 'Skip is on' : 'Skip is off'}"
            >Skip ${card.skip_practice ? 'ON' : 'OFF'}</button>
            <div class="card-front">${escapeHtml(primaryText)}</div>
            ${showSecondary ? `<div class="card-back">${escapeHtml(secondaryText)}</div>` : ''}
            <div style="margin-top: 4px; color: #666; font-size: 0.82rem;">Source: ${escapeHtml(sourceText)}</div>
            ${extraSectionHtml}
            ${card.skip_practice ? '<div class="skipped-note">Skipped from practice</div>' : ''}
            <div style="margin-top: 10px; color: #666; font-size: 0.85rem;">${escapeHtml(getCardMetricDescription(card))}</div>
            ${includeAddedDate ? `<div style="margin-top: 4px; color: #888; font-size: 0.8rem;">Added: ${window.PracticeManageCommon.formatAddedDate(card.created_at)}</div>` : ''}
            <div style="margin-top: 4px; color: #666; font-size: 0.82rem;">Lifetime attempts: ${card.lifetime_attempts || 0}</div>
            <div style="margin-top: 4px; color: #666; font-size: 0.82rem;">Last seen: ${window.PracticeManageCommon.formatLastSeenDays(card.last_seen_at)}</div>
            <a class="card-report-link" href="${buildCardReportHref(card)}">Report</a>
        </div>
    `;
}

function getTextLength(text) {
    return [...String(text || '').trim()].length;
}

function getChineseFrontBaseFontSizeByMaxLength(maxLength) {
    if (maxLength <= 1) return 4;
    if (maxLength <= 2) return 3.7;
    if (maxLength <= 4) return 3.1;
    if (maxLength <= 6) return 2.6;
    if (maxLength <= 8) return 2.2;
    if (maxLength <= 12) return 1.75;
    if (maxLength <= 16) return 1.4;
    if (maxLength <= 24) return 1.1;
    return 0.9;
}

function areChineseFrontNodesSingleLine(frontNodes) {
    return frontNodes.every((frontEl) => (
        frontEl.clientWidth > 0
        && frontEl.scrollWidth <= (frontEl.clientWidth + 1)
    ));
}

function applyChineseCardFrontUniformSize(visibleCards = null) {
    if (!isChineseSpecificLogic || !cardsGrid) {
        return;
    }
    const frontNodes = [...cardsGrid.querySelectorAll('.type1-chinese-card .card-front')];
    if (frontNodes.length === 0) {
        cardsGrid.style.removeProperty('--type1-chinese-front-size-rem');
        return;
    }

    const safeVisibleCards = Array.isArray(visibleCards)
        ? visibleCards
        : sortedCards.slice(0, visibleCardCount);
    const maxLength = safeVisibleCards.reduce((maxLen, card) => {
        const sizeText = isType2Behavior() && isChineseSpecificLogic
            ? (card && (card.back || card.front))
            : (card && card.front);
        const length = getTextLength(sizeText);
        return length > maxLen ? length : maxLen;
    }, 1);

    let low = CHINESE_FRONT_MIN_FONT_SIZE_REM;
    let high = Math.min(
        CHINESE_FRONT_MAX_FONT_SIZE_REM,
        Math.max(CHINESE_FRONT_MIN_FONT_SIZE_REM, getChineseFrontBaseFontSizeByMaxLength(maxLength))
    );
    let best = low;

    const setSharedSize = (sizeRem) => {
        cardsGrid.style.setProperty('--type1-chinese-front-size-rem', `${sizeRem.toFixed(3)}rem`);
        frontNodes.forEach((frontEl) => {
            frontEl.style.transform = 'none';
            frontEl.style.transformOrigin = '';
        });
    };

    const fitsAtSize = (sizeRem) => {
        setSharedSize(sizeRem);
        return areChineseFrontNodesSingleLine(frontNodes);
    };

    if (fitsAtSize(high)) {
        return;
    }
    if (!fitsAtSize(low)) {
        return;
    }
    best = low;
    for (let i = 0; i < CHINESE_FRONT_FIT_ITERATIONS; i += 1) {
        const mid = (low + high) / 2;
        if (fitsAtSize(mid)) {
            best = mid;
            low = mid;
        } else {
            high = mid;
        }
    }
    setSharedSize(best);
}

function displayCards(cards) {
    const statusFilteredCards = filterCardsByStatus(cards, currentCardStatusFilter);
    const filteredCards = filterCardsByQuery(statusFilteredCards, cardSearchInput ? cardSearchInput.value : '');
    sortedCards = window.PracticeManageCommon.sortCardsForView(filteredCards, viewOrderSelect.value);

    if (mathCardCount) {
        mathCardCount.textContent = `(${sortedCards.length})`;
    }

    if (sortedCards.length === 0) {
        cardsGrid.innerHTML = `<div class="empty-state" style="grid-column: 1 / -1;"><h3>No cards in merged bank</h3></div>`;
        cardsGrid.style.removeProperty('--type1-chinese-front-size-rem');
        return;
    }

    const visibleCards = sortedCards.slice(0, visibleCardCount);
    cardsGrid.innerHTML = visibleCards
        .map((card) => {
            if (isType2Behavior()) {
                return buildType2CardMarkup(card);
            }
            return isChineseSpecificLogic ? buildChineseCardMarkup(card) : buildGenericType1CardMarkup(card);
        })
        .join('');
    applyChineseCardFrontUniformSize(visibleCards);
}

function resetAndDisplayCards(cards) {
    visibleCardCount = CARD_PAGE_SIZE;
    displayCards(cards);
}

function maybeLoadMoreCards() {
    if (sortedCards.length <= visibleCardCount) {
        return;
    }

    const nearBottom = window.innerHeight + window.scrollY >= document.body.offsetHeight - 200;
    if (!nearBottom) {
        return;
    }

    visibleCardCount += CARD_PAGE_SIZE;
    displayCards(currentCards);
}

function updateAddReadingButtonCount() {
    if (!addReadingBtn || !chineseCharInput) {
        return;
    }
    if (isReadingBulkAdding) {
        addReadingBtn.textContent = 'Adding...';
        return;
    }
    const isType2 = isType2Behavior();
    const totalTokens = isType2
        ? countType2ChineseTokensBeforeDbDedup(chineseCharInput.value)
        : countChineseCharsBeforeDbDedup(chineseCharInput.value);
    if (totalTokens > 0) {
        addReadingBtn.textContent = isType2
            ? `Bulk Add Chinese Words/Phrases (${totalTokens})`
            : `Bulk Add Chinese Characters (${totalTokens})`;
        return;
    }
    addReadingBtn.textContent = isType2
        ? 'Bulk Add Chinese Words/Phrases'
        : 'Bulk Add Chinese Characters';
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

function extractChineseCharacters(text) {
    const matches = String(text || '').match(/\p{Script=Han}/gu);
    if (!matches) {
        return [];
    }
    return [...new Set(matches)];
}

function countChineseCharsBeforeDbDedup(text) {
    const matches = String(text || '').match(/\p{Script=Han}/gu);
    return matches ? matches.length : 0;
}

function countType2ChineseTokensBeforeDbDedup(text) {
    const matches = String(text || '').match(/[\u3400-\u9FFF\uF900-\uFAFF]+/g);
    return matches ? matches.length : 0;
}

function applySuggestedType2SheetInputs() {
    if (!isType2Behavior() || !isChineseSpecificLogic || !sheetCardCountInput || !sheetRowsPerCharInput) {
        return;
    }
    const candidateCount = Number(state2Cards.length || 0);
    if (candidateCount <= 0) {
        sheetCardCountInput.value = '1';
        sheetRowsPerCharInput.value = '1';
        return;
    }
    const suggestedCards = Math.max(1, Math.min(WRITING_SHEET_MAX_ROWS, candidateCount));
    const suggestedRows = Math.max(1, Math.floor(WRITING_SHEET_MAX_ROWS / suggestedCards));
    sheetCardCountInput.value = String(suggestedCards);
    sheetRowsPerCharInput.value = String(suggestedRows);
}

function renderPracticingDeck() {
    if (!practicingDeckGrid || !practicingDeckEmpty || !practicingDeckCount) {
        return;
    }
    if (!isType2Behavior() || !isChineseSpecificLogic) {
        practicingDeckCount.textContent = '(0)';
        practicingDeckGrid.innerHTML = '';
        practicingDeckEmpty.classList.remove('hidden');
        return;
    }

    const cards = [...state2Cards];
    practicingDeckCount.textContent = `(${cards.length})`;
    if (cards.length === 0) {
        practicingDeckGrid.innerHTML = '';
        practicingDeckEmpty.textContent = 'No suggested candidate cards.';
        practicingDeckEmpty.classList.remove('hidden');
        return;
    }

    practicingDeckEmpty.classList.add('hidden');
    const neverSeenLabels = [];
    const lastFailedLabels = [];
    const otherLabels = [];

    cards.forEach((card) => {
        const label = String(card.back || card.front || '').trim();
        if (!label) {
            return;
        }
        const reason = String(card.practicing_reason || '').trim();
        if (reason === 'never_seen') {
            neverSeenLabels.push(label);
            return;
        }
        if (reason === 'last_failed') {
            lastFailedLabels.push(label);
            return;
        }
        otherLabels.push(label);
    });

    const renderBucketRow = (title, labels) => {
        if (labels.length === 0) {
            return `
                <div class="pending-sheet-bar">
                    <span class="pending-sheet-bar-label">${escapeHtml(title)}:</span>
                    <span class="pending-sheet-empty">No cards.</span>
                </div>
            `;
        }
        return `
            <div class="pending-sheet-bar">
                <span class="pending-sheet-bar-label">${escapeHtml(title)}:</span>
                <span class="pending-sheet-text">${escapeHtml(labels.join(' · '))}</span>
            </div>
        `;
    };

    const rows = [
        renderBucketRow('Newly added', neverSeenLabels),
        renderBucketRow('Last failed', lastFailedLabels),
    ];
    if (otherLabels.length > 0) {
        rows.push(renderBucketRow('Other', otherLabels));
    }
    practicingDeckGrid.innerHTML = rows.join('');
}

function renderPendingSheetCards() {
    if (!pendingSheetCardsGrid || !pendingSheetCardsEmpty) {
        return;
    }
    if (!isType2Behavior() || !isChineseSpecificLogic) {
        pendingSheetCardsGrid.textContent = '';
        pendingSheetCardsEmpty.classList.remove('hidden');
        return;
    }

    const cards = [...state3Cards];
    if (cards.length === 0) {
        pendingSheetCardsGrid.textContent = '';
        pendingSheetCardsEmpty.classList.remove('hidden');
        return;
    }

    pendingSheetCardsEmpty.classList.add('hidden');
    const labels = cards
        .map((card) => String(card.back || card.front || '').trim())
        .filter((label) => label.length > 0);
    pendingSheetCardsGrid.textContent = labels.join(' · ');
}

async function createAndPrintType2ChineseSheet() {
    if (!isType2Behavior() || !isChineseSpecificLogic) {
        return;
    }
    let previewWindow = null;
    try {
        previewWindow = window.open('about:blank', '_blank');
        if (!previewWindow) {
            showSheetError('Popup blocked. Please allow popups for this site to preview the sheet.');
            return;
        }
        try {
            previewWindow.document.write('<!doctype html><title>Loading...</title><p style="font-family: sans-serif; padding: 1rem;">Preparing sheet preview...</p>');
        } catch (error) {
            // Continue.
        }

        const count = Number.parseInt(sheetCardCountInput ? sheetCardCountInput.value : '', 10);
        const rowsPerCharacter = Number.parseInt(sheetRowsPerCharInput ? sheetRowsPerCharInput.value : '', 10);
        showSheetError('');
        if (!Number.isInteger(count) || count < 1 || count > 200) {
            showSheetError('Cards per sheet must be between 1 and 200');
            previewWindow.close();
            return;
        }
        if (!Number.isInteger(rowsPerCharacter) || rowsPerCharacter < 1 || rowsPerCharacter > 10) {
            showSheetError('Rows per card must be between 1 and 10');
            previewWindow.close();
            return;
        }
        if (count * rowsPerCharacter > WRITING_SHEET_MAX_ROWS) {
            const maxCards = Math.max(1, Math.floor(WRITING_SHEET_MAX_ROWS / rowsPerCharacter));
            showSheetError(`One page max is ${WRITING_SHEET_MAX_ROWS} rows. With ${rowsPerCharacter} row(s) per card, max cards is ${maxCards}.`);
            previewWindow.close();
            return;
        }

        const response = await fetch(buildType2ApiUrl('sheets/preview'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                count,
                rows_per_character: rowsPerCharacter,
                categoryKey,
            }),
        });
        if (!response.ok) {
            const payload = await response.json().catch(() => ({}));
            throw new Error(payload.error || `HTTP ${response.status}`);
        }
        const result = await response.json();
        if (!result.preview || !Array.isArray(result.cards) || result.cards.length === 0) {
            showSheetError(result.message || 'No eligible cards to print right now');
            return;
        }

        const previewKey = `writing_sheet_preview_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
        const previewPayload = {
            kidId: String(kidId),
            categoryKey: String(categoryKey || ''),
            rows_per_character: rowsPerCharacter,
            cards: result.cards,
            created_at: new Date().toISOString(),
        };
        localStorage.setItem(previewKey, JSON.stringify(previewPayload));

        const params = new URLSearchParams();
        params.set('id', String(kidId || ''));
        params.set('previewKey', previewKey);
        if (categoryKey) {
            params.set('categoryKey', categoryKey);
        }
        previewWindow.location.href = `/writing-sheet-print.html?${params.toString()}`;
    } catch (error) {
        if (previewWindow && !previewWindow.closed) {
            previewWindow.close();
        }
        showSheetError(error.message || 'Failed to generate practice sheet preview');
    }
}

function viewType2ChineseSheets() {
    const qs = new URLSearchParams();
    qs.set('id', String(kidId || ''));
    if (categoryKey) {
        qs.set('categoryKey', categoryKey);
    }
    window.location.href = `/kid-writing-sheets.html?${qs.toString()}`;
}

async function loadSharedDeckCards(previewHardCardPercentage = null) {
    const requestId = sharedDeckCardsResponseTracker
        ? sharedDeckCardsResponseTracker.begin()
        : 0;
    try {
        const url = new URL(buildSharedDeckApiUrl('shared-decks/cards'));
        const previewHardPct = hardnessController
            ? hardnessController.parsePreviewValue(previewHardCardPercentage)
            : null;
        if (previewHardPct !== null) {
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

        currentCards = Array.isArray(data.cards) ? data.cards : [];
        state2Cards = (isType2Behavior() && isChineseSpecificLogic && Array.isArray(data.practicing_cards))
            ? data.practicing_cards
            : [];
        state3Cards = (isType2Behavior() && isChineseSpecificLogic && Array.isArray(data.practicing_sheet_cards))
            ? data.practicing_sheet_cards
            : [];
        if (hardnessController) {
            hardnessController.setCurrentValue(data.hard_card_percentage);
        }
        renderHardCardPresetButtons();

        const skippedCount = Number.isInteger(Number.parseInt(data.skipped_card_count, 10))
            ? Number.parseInt(data.skipped_card_count, 10)
            : currentCards.filter((card) => !!card.skip_practice).length;
        currentSkippedCardCount = skippedCount;
        applySuggestedType2SheetInputs();
        renderPracticingDeck();
        renderPendingSheetCards();
        resetAndDisplayCards(currentCards);
    } catch (error) {
        console.error('Error loading shared category cards:', error);
        showError(error.message || `Failed to load shared ${getCurrentCategoryDisplayName()} cards.`);
    }
}

async function updateSharedType1CardSkip(cardId, skipped) {
    const response = await fetch(buildSharedDeckApiUrl(`shared-decks/cards/${cardId}/skip`), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ skipped })
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
        throw new Error(result.error || `Failed to update skip (HTTP ${response.status})`);
    }
    await loadSharedDeckCards();
    showError('');
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
            const tokenCount = countType2ChineseTokensBeforeDbDedup(input);
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
            const skippedExistingCount = Math.max(0, Number(result.skipped_existing_count) || 0);
            addCardForm.reset();
            updateAddReadingButtonCount();
            showStatusMessage(`Added ${inserted} new card(s). Skipped ${skippedExistingCount} existing card(s).`, false);
            await loadSharedType1Decks();
            return;
        }

        const chineseChars = extractChineseCharacters(input);
        if (chineseChars.length === 0) {
            showError('Please enter at least one Chinese character');
            return;
        }

        const addUrl = withCategoryKey(new URL(`${API_BASE}/kids/${kidId}/cards/bulk`));
        const response = await fetch(addUrl.toString(), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                categoryKey,
                cards: chineseChars.map((ch) => ({ front: ch, back: '' }))
            }),
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok) {
            throw new Error(result.error || `Failed to add cards (HTTP ${response.status})`);
        }

        const inserted = Math.max(0, Number(result.created) || 0);
        const skippedExistingCount = Math.max(0, Number(result.skipped_existing_count) || 0);
        addCardForm.reset();
        updateAddReadingButtonCount();
        showStatusMessage(`Added ${inserted} new card(s). Skipped ${skippedExistingCount} existing card(s).`, false);
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

async function handleCardsGridClick(event) {
    const actionBtn = event.target.closest('[data-action]');
    if (!actionBtn) {
        return;
    }
    const action = actionBtn.dataset.action;

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

    if (action !== 'toggle-skip') {
        return;
    }

    const cardId = actionBtn.dataset.cardId;
    if (!cardId) {
        return;
    }

    const currentlySkipped = actionBtn.dataset.skipped === 'true';
    const targetSkipped = !currentlySkipped;
    try {
        actionBtn.disabled = true;
        await updateSharedType1CardSkip(cardId, targetSkipped);
    } catch (error) {
        console.error('Error updating shared category card skip:', error);
        showError(error.message || 'Failed to update skip status.');
    } finally {
        actionBtn.disabled = false;
    }
}

async function loadKidInfo() {
    const response = await fetch(`${API_BASE}/kids/${kidId}`);
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
    ) {
        throw new Error(`Unsupported manage behavior type: ${behaviorType || 'unknown'}`);
    }
    currentBehaviorType = behaviorType;
    currentSharedScope = (
        behaviorType === BEHAVIOR_TYPE_TYPE_III
            ? SHARED_SCOPE_LESSON_READING
            : (behaviorType === BEHAVIOR_TYPE_TYPE_II ? SHARED_SCOPE_TYPE2 : SHARED_SCOPE_CARDS)
    );

    isChineseSpecificLogic = Boolean(categoryMeta && categoryMeta.has_chinese_specific_logic);
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

    kidNameEl.textContent = `${kid.name || 'Kid'} - ${displayName} Management`;
    includeOrphanByCategory = toCategoryMap(kid[INCLUDE_ORPHAN_BY_CATEGORY_FIELD]);
    const total = getSessionCountFromKid(kid);
    sessionCardCountInput.value = String(Number.isInteger(total) ? total : 0);
    if (sheetCardCountInput) {
        sheetCardCountInput.value = String(Math.max(1, Number.isInteger(total) ? total : 1));
    }
    if (sheetRowsPerCharInput && !String(sheetRowsPerCharInput.value || '').trim()) {
        sheetRowsPerCharInput.value = '1';
    }
    initialHardCardPercent = getInitialHardCardPercentFromKid(kid);
}

async function loadSharedType1Decks() {
    const response = await fetch(buildSharedDeckApiUrl('shared-decks'));
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
        throw new Error(result.error || `Failed to load shared decks (HTTP ${response.status})`);
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
    ensureAvailableTagFilterController().sync();

    const responseTotal = Number.parseInt(result.session_card_count, 10);
    if (Number.isInteger(responseTotal)) {
        sessionCardCountInput.value = String(responseTotal);
    }
    baselineIncludeOrphanInQueue = Boolean(result && result.include_orphan_in_queue);
    stagedIncludeOrphanInQueue = baselineIncludeOrphanInQueue;

    renderAvailableDecks();
    renderSelectedDecks();
    renderDeckPendingInfo();
    await loadSharedDeckCards();
}

async function saveSessionSettings() {
    showError('');
    showSuccess('');

    const total = Number.parseInt(sessionCardCountInput.value, 10);
    if (!Number.isInteger(total) || total < 0 || total > 200) {
        showError(`${getCurrentCategoryDisplayName()} cards per session must be between 0 and 200.`);
        return;
    }
    const response = await fetch(`${API_BASE}/kids/${kidId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildSessionCountPayload(total)),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
        throw new Error(result.error || `Failed to save settings (HTTP ${response.status})`);
    }
    applySessionCountFromPayload(result);

    showSuccess('Practice settings saved.');
    await loadSharedType1Decks();
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

async function onAvailableDeckClick(event) {
    const bubble = event.target.closest('button[data-deck-id]');
    if (!bubble) {
        return;
    }
    const orphanToggle = String(bubble.getAttribute('data-orphan-toggle') || '').trim().toLowerCase();
    if (orphanToggle === 'in') {
        await stageOrphanInclusion(true);
        return;
    }
    const deckId = Number(bubble.getAttribute('data-deck-id') || 0);
    if (!(deckId > 0)) {
        return;
    }
    await stageDeckMembershipChange(deckId, 'in');
}

async function onSelectedDeckClick(event) {
    const bubble = event.target.closest('button[data-deck-id]');
    if (!bubble) {
        return;
    }
    const orphanToggle = String(bubble.getAttribute('data-orphan-toggle') || '').trim().toLowerCase();
    if (orphanToggle === 'out') {
        await stageOrphanInclusion(false);
        return;
    }
    const deckId = Number(bubble.getAttribute('data-deck-id') || 0);
    if (!(deckId > 0)) {
        return;
    }
    await stageDeckMembershipChange(deckId, 'out');
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
        const orphanSummary = orphanChanged ? `, Personal Deck ${stagedIncludeOrphanInQueue ? 'opt-in' : 'opt-out'}` : '';
        const summary = `Applied deck changes: ${toOptIn.length} opt-in, ${toOptOut.length} opt-out${orphanSummary}.`;
        showDeckChangeMessage(summary);
        await loadSharedType1Decks();
    } catch (error) {
        console.error('Error applying deck membership changes:', error);
        showDeckChangeMessage(error.message || 'Failed to apply deck changes.', true);
    } finally {
        isDeckMoveInFlight = false;
        renderDeckPendingInfo();
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
    applyCategoryUiText();

    window.PracticeManageCommon.applyKidManageTabVisibility({
        kidId,
        defaultCategoryByRoute: {
            '/kid-card-manage.html': categoryKey,
        },
    });

    optInAllAvailableController = window.PracticeManageCommon.createSetBackedOptInAllAvailableController({
        buttonEl: optInAllAvailableBtn,
        isBusy: () => isDeckMoveInFlight,
        getFilteredDecks: () => getAvailableDeckCandidatesForTagFilter().filter(matchesAvailableTagFilter),
        getDeckIdSet: () => stagedOptedDeckIdSet,
        clearMessages: clearDeckSelectionMessages,
        onChanged: refreshDeckSelectionViews,
    });
    optOutAllSelectedController = window.PracticeManageCommon.createOptInAllAvailableController({
        buttonEl: optOutAllSelectedBtn,
        buttonText: 'Opt-out All',
        isBusy: () => isDeckMoveInFlight,
        getFilteredDecks: () => getSelectedDeckCandidatesForTagFilter().filter(matchesSelectedTagFilter),
        hasDeckId: (deckId) => !stagedOptedDeckIdSet.has(Number(deckId)),
        addDeckId: (deckId) => {
            stagedOptedDeckIdSet.delete(Number(deckId));
        },
        clearMessages: clearDeckSelectionMessages,
        onChanged: refreshDeckSelectionViews,
    });

    availableDecksEl.addEventListener('click', async (event) => {
        await onAvailableDeckClick(event);
    });
    if (availablePersonalDeckEl) {
        availablePersonalDeckEl.addEventListener('click', async (event) => {
            await onAvailableDeckClick(event);
        });
    }
    if (optInAllAvailableBtn && optInAllAvailableController) {
        optInAllAvailableBtn.addEventListener('click', async () => {
            await optInAllAvailableController.optInAll();
        });
    }
    if (optOutAllSelectedBtn && optOutAllSelectedController) {
        optOutAllSelectedBtn.addEventListener('click', async () => {
            await optOutAllSelectedController.optInAll();
        });
    }
    ensureAvailableTagFilterController();
    ensureSelectedTagFilterController();
    selectedDecksEl.addEventListener('click', async (event) => {
        await onSelectedDeckClick(event);
    });
    if (selectedPersonalDeckEl) {
        selectedPersonalDeckEl.addEventListener('click', async (event) => {
            await onSelectedDeckClick(event);
        });
    }
    applyDeckChangesBtn.addEventListener('click', async () => {
        await applyDeckMembershipChanges();
    });
    cardsGrid.addEventListener('click', handleCardsGridClick);
    window.addEventListener('scroll', () => {
        maybeLoadMoreCards();
    });
    window.addEventListener('resize', () => {
        applyChineseCardFrontUniformSize();
    });
    if (document.fonts && typeof document.fonts.addEventListener === 'function') {
        document.fonts.addEventListener('loadingdone', () => {
            applyChineseCardFrontUniformSize();
        });
    }

    sessionSettingsForm.addEventListener('submit', async (event) => {
        event.preventDefault();
        try {
            await saveSessionSettings();
        } catch (error) {
            console.error('Error saving shared category settings:', error);
            showError(error.message || 'Failed to save practice settings.');
        }
    });
    viewOrderSelect.addEventListener('change', () => {
        resetAndDisplayCards(currentCards);
    });
    renderCardStatusFilterButtons();
    if (cardStatusFilterButtons.length) {
        cardStatusFilterButtons.forEach((button) => {
            button.addEventListener('click', () => {
                const nextFilter = button.getAttribute('data-card-status-filter');
                setCardStatusFilter(nextFilter);
            });
        });
    }
    if (cardSearchInput) {
        cardSearchInput.addEventListener('input', () => {
            resetAndDisplayCards(currentCards);
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
    if (createSheetBtn) {
        createSheetBtn.addEventListener('click', async () => {
            await createAndPrintType2ChineseSheet();
        });
    }
    if (viewSheetsBtn) {
        viewSheetsBtn.addEventListener('click', () => {
            viewType2ChineseSheets();
        });
    }
    if (hardnessPercentSlider) {
        hardnessPercentSlider.addEventListener('input', () => {
            renderHardCardPresetButtons();
        });
        hardnessPercentSlider.addEventListener('change', () => {
            renderHardCardPresetButtons();
        });
    }
    if (hardCardPresetButtons.length) {
        hardCardPresetButtons.forEach((button) => {
            button.addEventListener('click', () => {
                applyHardCardPreset(button.getAttribute('data-hard-card-preset'));
            });
        });
    }

    sharedDeckCardsResponseTracker = window.PracticeManageCommon.createLatestResponseTracker();

    try {
        showError('');
        showSuccess('');
        showSheetError('');
        await loadKidInfo();
        hardnessController = window.PracticeManageCommon.createKidHardnessController({
            sliderEl: hardnessPercentSlider,
            valueEl: hardnessPercentValue,
            statusEl: hardnessPercentStatus,
            apiBase: API_BASE,
            kidId,
            kidFieldName: HARD_CARD_PERCENT_BY_CATEGORY_FIELD,
            savedMessage: 'Queue setting saved.',
            buildPayload: (hardPct) => buildHardCardPercentPayload(hardPct),
            getPersistedValue: (payload) => getPersistedHardCardPercentFromPayload(payload),
            clearTopError: () => {
                showError('');
            },
            reloadCards: async (value) => {
                await loadSharedDeckCards(value);
            },
        });
        hardnessController.attach();
        hardnessController.setCurrentValue(initialHardCardPercent);
        renderHardCardPresetButtons();
        await loadSharedType1Decks();
        updateAddReadingButtonCount();
    } catch (error) {
        console.error('Error initializing category manage:', error);
        showError(error.message || 'Failed to load page.');
        kidNameEl.textContent = `${getCurrentCategoryDisplayName()} Management`;
        updatePageTitle();
    }
});
