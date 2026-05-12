/*
 * kid-card-manage-core.js — bootstrap + shared state for kid-card-manage
 *
 * Layout:
 *   1. Module constants + DOM lookups + page state
 *   2. Card view-mode + Chinese back + sort-mode helpers
 *   3. Toast / status / message helpers
 *   4. Modal helpers (open/close/lock body scroll)
 *   5. URL builders + behavior-type checks
 *   6. Personal deck editor preview + mode toggle
 *   7. Per-category accessors + payload builders (session count, drill, orphan)
 *   8. Kid nav + page title + category UI text
 */

// =====================================================================
// === 1. Module constants + DOM lookups + page state
// =====================================================================

const API_BASE = `${window.location.origin}/api`;

const params = new URLSearchParams(window.location.search);
const kidId = params.get('id');
const SESSION_CARD_COUNT_BY_CATEGORY_FIELD = 'sessionCardCountByCategory';
const INCLUDE_ORPHAN_BY_CATEGORY_FIELD = 'includeOrphanByCategory';
const DRILL_SPEED_CUTOFF_MS_BY_CATEGORY_FIELD = 'drillSpeedCutoffMsByCategory';
const DEFAULT_DRILL_SPEED_CUTOFF_MS = 3000;
const MIN_DRILL_SPEED_CUTOFF_MS = 500;
const MAX_DRILL_SPEED_CUTOFF_MS = 30000;
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
const queueSettingsSubgroup = document.getElementById('queueSettingsSubgroup');
const type4DailyTargetBlock = document.getElementById('type4DailyTargetBlock');
const type4DailyTargetTotalText = document.getElementById('type4DailyTargetTotalText');
const openType4DeckCountsModalBtn = document.getElementById('openType4DeckCountsModalBtn');

const personalDeckModalNote = document.getElementById('personalDeckModalNote');
const addCardForm = document.getElementById('addCardForm');
const chineseCharInput = document.getElementById('chineseChar');
const addReadingBtn = document.getElementById('addReadingBtn');
const addCardStatusMessage = document.getElementById('addCardStatusMessage');
const personalDeckEditWrap = document.getElementById('personalDeckEditWrap');
const personalDeckPreviewWrap = document.getElementById('personalDeckPreviewWrap');
const personalDeckPreviewTableBody = document.getElementById('personalDeckPreviewTableBody');
const personalDeckPreviewSummary = document.getElementById('personalDeckPreviewSummary');
const personalDeckBackBtn = document.getElementById('personalDeckBackBtn');
const clearPersonalDeckBtn = document.getElementById('clearPersonalDeckBtn');
let personalDeckMode = 'edit';

const viewOrderSelect = document.getElementById('viewOrderSelect');
const sortMenuBtn = document.getElementById('sortMenuBtn');
const sortMenuBtnLabel = document.getElementById('sortMenuBtnLabel');
const sortMenuPopover = document.getElementById('sortMenuPopover');
const sortDirectionToggleGroup = document.getElementById('sortDirectionToggleGroup');
const sortDirectionToggleBtns = sortDirectionToggleGroup
    ? Array.from(sortDirectionToggleGroup.querySelectorAll('.sort-direction-toggle-btn'))
    : [];
const cardSearchInput = document.getElementById('cardSearchInput');
const cardFocusBanner = document.getElementById('cardFocusBanner');
const cardFocusBannerText = document.getElementById('cardFocusBannerText');
const cardFocusBannerClear = document.getElementById('cardFocusBannerClear');
const sourceDeckFilterBtn = document.getElementById('sourceDeckFilterBtn');
const sourceDeckFilterBtnLabel = document.getElementById('sourceDeckFilterBtnLabel');
const sourceDeckFilterPopover = document.getElementById('sourceDeckFilterPopover');
const cardsSelectModeBtn = document.getElementById('cardsSelectModeBtn');
const cardsSelectionBar = document.getElementById('cardsSelectionBar');
const cardsSelectionCount = document.getElementById('cardsSelectionCount');
const cardsSelectAllVisibleBtn = document.getElementById('cardsSelectAllVisibleBtn');
const cardsSelectionClearBtn = document.getElementById('cardsSelectionClearBtn');
const cardsSelectionCloseBtn = document.getElementById('cardsSelectionCloseBtn');
const cardsSelectionSkipBtn = document.getElementById('cardsSelectionSkipBtn');
const cardsSelectionUnskipBtn = document.getElementById('cardsSelectionUnskipBtn');
const cardsSelectionDownloadBtn = document.getElementById('cardsSelectionDownloadBtn');
const cardsSelectionDeleteBtn = document.getElementById('cardsSelectionDeleteBtn');
const cardsBulkActionMessage = document.getElementById('cardsBulkActionMessage');
const cardsQueueLegend = document.getElementById('cardsQueueLegend');
const cardsGrid = document.getElementById('cardsGrid');
const cardsToolbar = document.querySelector('.cards-toolbar');
const cardsViewControl = document.querySelector('.cards-view-control');
const cardViewModeCompactBtn = document.getElementById('cardViewModeCompactBtn');
const cardViewModeExpandBtn = document.getElementById('cardViewModeExpandBtn');
const queueSettingsSaveBtn = document.getElementById('queueSettingsSaveBtn');
const drillSpeedSettingsGroup = document.getElementById('drillSpeedSettingsGroup');
const drillSpeedTargetInput = document.getElementById('drillSpeedTargetInput');

let allDecks = [];
let orphanDeck = null;
let currentCards = [];
let currentDailyProgressRows = [];
let currentFamilyTimezone = '';
let currentPracticePrioritySubjectBaseline = {
    p50_correct_time: null,
    p90_correct_time: null,
    correct_sample_count: 0,
};
const CARDS_VIEW_MODE_STORAGE_KEY = 'kidCardManage_cardsViewMode';
const CARDS_VIEW_MODES = new Set(['queue', 'stats', 'report']);
// =====================================================================
// === 2. Card view-mode + Chinese back + sort-mode helpers
// =====================================================================

function normalizeCardsViewMode(value) {
    return CARDS_VIEW_MODES.has(value) ? value : 'queue';
}
let currentCardsViewMode = (() => {
    if (String(params.get('cardId') || '').trim()) return 'queue';
    const urlView = String(params.get('view') || '').trim();
    if (urlView && CARDS_VIEW_MODES.has(urlView)) return urlView;
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
let currentSkippedCardCount = 0;
let currentCardViewMode = String(params.get('cardId') || '').trim() ? 'long' : 'short';
let expandedCompactCardIds = new Set();
let isBulkSkipActionInFlight = false;
let isBulkDownloadInFlight = false;
let isBulkDeleteActionInFlight = false;
let isCardsSelectModeOn = false;
let selectedCardIds = new Set();
let viewModeBeforeSelectMode = null;
let sessionCardCountByCategory = {};
let includeOrphanByCategory = {};
let drillSpeedCutoffMsByCategory = {};
let baselineSessionCardCount = 0;
let baselineDrillSpeedCutoffMs = DEFAULT_DRILL_SPEED_CUTOFF_MS;
let isQueueSettingsSaving = false;
let queueSettingsSaveSuccessText = '';
let previewQueueTimer = null;
let hasLoadedSharedCardsOnce = false;
let isType4DeckCountsSaving = false;
let activeType4GeneratorCardId = null;
let isType4GeneratorPreviewLoading = false;
let type4GeneratorAceViewer = null;
let currentCardSortDirection = CARD_SORT_DIRECTION_DESC;
let currentSourceDeckFilter = '';
let focusedCardId = (() => {
    const raw = String(params.get('cardId') || '').trim();
    return raw || '';
})();
const ORPHAN_BUBBLE_ID = '__orphan__';
const MAX_DECK_BUBBLE_COUNT = 0;
const CHINESE_FIXED_FRONT_SIZE_REM = 1.4;
const SHOW_DECK_COUNT_MISMATCH_WARNING = false;
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

// =====================================================================
// === 3. Toast / status / message helpers
// =====================================================================

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
    const textEl = document.getElementById('addCardStatusText');
    const text = String(message || '').trim();
    if (!text) {
        if (textEl) textEl.textContent = '';
        addCardStatusMessage.classList.add('hidden');
        return;
    }
    if (textEl) {
        textEl.textContent = text;
    }
    addCardStatusMessage.classList.remove('hidden');
    addCardStatusMessage.classList.toggle('is-success', !isError);
    setManageModalOpen(personalDeckModal, true);
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

// =====================================================================
// === 4. Modal helpers (open/close/lock body scroll)
// =====================================================================

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

function handleModalBackdropClick() {
}

// =====================================================================
// === 5. URL builders + behavior-type checks
// =====================================================================

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
    if (currentBehaviorType === BEHAVIOR_TYPE_TYPE_II) {
        return true;
    }
    return isChineseSpecificLogic && currentBehaviorType === BEHAVIOR_TYPE_TYPE_I;
}

// =====================================================================
// === 6. Personal deck editor preview + mode toggle
// =====================================================================

function renderPersonalDeckPreviewTable(rows, options = {}) {
    if (!personalDeckPreviewTableBody) return;
    const frontLabel = String(options.frontLabel || 'Prompt');
    const backLabel = String(options.backLabel || 'Word');
    const tableEl = personalDeckPreviewTableBody.closest('table');
    if (tableEl) {
        const headers = tableEl.querySelectorAll('thead th');
        if (headers.length >= 3) {
            headers[1].textContent = frontLabel;
            headers[2].textContent = backLabel;
        }
    }
    const html = rows.map((row, idx) => {
        const backRaw = row.back == null ? '' : String(row.back);
        const backHtml = backRaw.length > 0
            ? escapeHtml(backRaw)
            : '<span class="col-back-empty">—</span>';
        return (
            `<tr>`
            + `<td class="col-num">${idx + 1}</td>`
            + `<td class="col-front">${escapeHtml(row.front)}</td>`
            + `<td class="col-back">${backHtml}</td>`
            + `</tr>`
        );
    }).join('');
    personalDeckPreviewTableBody.innerHTML = html;
    if (personalDeckPreviewSummary) {
        const n = rows.length;
        personalDeckPreviewSummary.textContent = `${n} card${n === 1 ? '' : 's'} ready — review then Apply.`;
    }
}

function setPersonalDeckMode(mode) {
    personalDeckMode = mode === 'preview' ? 'preview' : 'edit';
    const isPreview = personalDeckMode === 'preview';
    if (personalDeckEditWrap) personalDeckEditWrap.classList.toggle('hidden', isPreview);
    if (personalDeckPreviewWrap) personalDeckPreviewWrap.classList.toggle('hidden', !isPreview);
    if (personalDeckBackBtn) personalDeckBackBtn.classList.toggle('hidden', !isPreview);
    if (clearPersonalDeckBtn) clearPersonalDeckBtn.classList.toggle('hidden', isPreview);
    if (chineseCharInput) chineseCharInput.required = !isPreview;
    if (addReadingBtn) {
        if (isPreview) {
            addReadingBtn.disabled = false;
            addReadingBtn.innerHTML = (typeof icon === 'function' ? icon('check', { size: 18 }) : '') + ' Apply';
        } else {
            updateAddReadingButtonCount();
        }
    }
    if (!isPreview) {
        showStatusMessage('');
    }
}

// =====================================================================
// === 7. Per-category accessors + payload builders (session count, drill, orphan)
// =====================================================================

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

function clampDrillSpeedCutoffMs(rawValue) {
    const parsed = Number.parseInt(rawValue, 10);
    if (!Number.isInteger(parsed)) {
        return DEFAULT_DRILL_SPEED_CUTOFF_MS;
    }
    return Math.max(MIN_DRILL_SPEED_CUTOFF_MS, Math.min(MAX_DRILL_SPEED_CUTOFF_MS, parsed));
}

function getDrillSpeedCutoffMsFromKid(kid) {
    drillSpeedCutoffMsByCategory = toCategoryMap(kid[DRILL_SPEED_CUTOFF_MS_BY_CATEGORY_FIELD]);
    const raw = getCategoryIntValue(drillSpeedCutoffMsByCategory);
    if (!Number.isInteger(raw) || raw <= 0) {
        return DEFAULT_DRILL_SPEED_CUTOFF_MS;
    }
    return clampDrillSpeedCutoffMs(raw);
}

function buildDrillSpeedCutoffMsPayload(ms) {
    return {
        [DRILL_SPEED_CUTOFF_MS_BY_CATEGORY_FIELD]: withCategoryValue(
            drillSpeedCutoffMsByCategory,
            clampDrillSpeedCutoffMs(ms),
        ),
    };
}

function applyDrillSpeedCutoffMsFromPayload(payload) {
    drillSpeedCutoffMsByCategory = toCategoryMap(
        payload && payload[DRILL_SPEED_CUTOFF_MS_BY_CATEGORY_FIELD]
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

function getCurrentCategoryDisplayName() {
    return String(currentCategoryDisplayName || '').trim();
}

// =====================================================================
// === 8. Kid nav + page title + category UI text
// =====================================================================

async function loadKidsAndApplyKidInfo() {
    const response = await fetch(`${API_BASE}/kids`);
    const kids = await response.json().catch(() => []);
    if (!response.ok) {
        const errorMessage = kids && kids.error ? kids.error : `Failed to load kids (HTTP ${response.status})`;
        throw new Error(errorMessage);
    }
    cachedKidsForNav = Array.isArray(kids) ? kids : [];
    const currentKid = cachedKidsForNav.find((kid) => String(kid && kid.id) === String(kidId));
    if (!currentKid) {
        throw new Error('Kid not found');
    }
    applyKidInfo(currentKid);
    renderKidNav();
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
    const userIconSvg = window.icon('user', { className: 'kid-nav-card-icon', strokeWidth: 2 });
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
    if (sessionCardCountLabel) {
        sessionCardCountLabel.textContent = 'Cards / day';
    }
    if (queueSettingsSubgroup) {
        queueSettingsSubgroup.classList.toggle('hidden', showType4DeckTargetBlock);
    }
    if (openType4DeckCountsModalBtn) {
        openType4DeckCountsModalBtn.classList.toggle('hidden', !showType4DeckTargetBlock);
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
        personalDeckModalNote.textContent = '';
        personalDeckModalNote.classList.add('hidden');
    }
    if (chineseCharInput) {
        if (isType1ChineseEnglishBackMode()) {
            chineseCharInput.placeholder = '添加生词 — 中文 + 英文释义。\n\n格式：「<中文>，<english>」一行一张卡\n（中英文逗号都可以；缺英文释义会留空，可在卡片中补充）\n\n比如:\n中国，china\n你好，hello\n学校，school';
        } else if (isType2Behavior() && !isChineseSpecificLogic) {
            chineseCharInput.placeholder = 'Add words to practice writing. Pick ONE format — don\'t mix.\n\n• Format A — blob (prompt = word, each word is one card)\napple banana orange grape\ncat dog rabbit elephant\n\n• Format B — "prompt, word" (one card per line)\nA red round fruit, apple\nMan\'s best friend, dog\nGoes "moo", cow';
        } else if (isType2Behavior()) {
            chineseCharInput.placeholder = '添加生词练习。两种格式 — 只能选一种。\n\n• 格式 A — 词块（听到的词 = 要写的词）\n好像 香菜 为难 关心 事情\n答应 知道 从来 勇敢\n\n• 格式 B —「提示，答案」一行一张卡\n看起来很像，好像\n有香味的蔬菜，香菜\n感到困难，为难';
        } else {
            chineseCharInput.placeholder = '添加生字 — 一字一卡，拼音自动生成。\n\n直接粘贴文章或生字表都可以；只识别汉字，其他符号会被忽略。\n点 Preview 可查看自动生成的拼音再确认。\n\n比如:\n坐 甘 罗 茂 叹 皇 帝 做 官 爷 留 孙\n说 笑 心 喜 当 楚 北 摸 肩 膀';
        }
    }
    document.body.classList.toggle('type1-chinese-mode', isChineseSpecificLogic);
    syncType4CardOrderOptions();
    syncType4RepresentativeCardsUi();
    updateAddReadingButtonCount();
    renderDeckSetupSummary();
    updatePageTitle();
}

