const API_BASE = `${window.location.origin}/api`;

const params = new URLSearchParams(window.location.search);
const kidId = params.get('id');
const categoryKey = String(params.get('categoryKey') || '').trim().toLowerCase();
const TYPE_I_SESSION_CARD_COUNT_BY_CATEGORY_FIELD = 'type1SessionCardCountByCategory';
const TYPE_I_INCLUDE_ORPHAN_BY_CATEGORY_FIELD = 'type1IncludeOrphanByCategory';
const TYPE_I_HARD_CARD_PERCENT_BY_CATEGORY_FIELD = 'type1HardCardPercentageByCategory';
const BEHAVIOR_TYPE_TYPE_I = 'type_i';
const BEHAVIOR_TYPE_TYPE_III = 'type_iii';
const SHARED_SCOPE_CARDS = 'cards';
const SHARED_SCOPE_LESSON_READING = 'lesson-reading';

const {
    buildCategoryDisplayName,
    getDeckCategoryMetaMap,
} = window.DeckCategoryCommon;

const kidNameEl = document.getElementById('kidName');
const errorMessage = document.getElementById('errorMessage');
const successMessage = document.getElementById('successMessage');

const sessionSettingsForm = document.getElementById('sessionSettingsForm');
const sharedMathSessionCardCountInput = document.getElementById('sharedMathSessionCardCount');
const sessionCardCountLabel = document.getElementById('sessionCardCountLabel');
const optInDecksHeading = document.getElementById('optInDecksHeading');
const optInDecksNote = document.getElementById('optInDecksNote');
const cardsSectionTitleText = document.getElementById('cardsSectionTitleText');
const cardsHardnessHelpText = document.getElementById('cardsHardnessHelpText');

const availableDecksEl = document.getElementById('availableDecks');
const availableEmptyEl = document.getElementById('availableEmpty');
const availableTagFilterInput = document.getElementById('availableTagFilter');
const availableDecksTitle = document.getElementById('availableDecksTitle');
const optInAllAvailableBtn = document.getElementById('optInAllAvailableBtn');
const selectedDecksEl = document.getElementById('selectedDecks');
const selectedEmptyEl = document.getElementById('selectedEmpty');
const selectedDecksTitle = document.getElementById('selectedDecksTitle');
const applyDeckChangesBtn = document.getElementById('applyDeckChangesBtn');
const deckPendingInfo = document.getElementById('deckPendingInfo');
const deckChangeMessage = document.getElementById('deckChangeMessage');
const orphanEditorSection = document.getElementById('orphanEditorSection');
const addCardForm = document.getElementById('addCardForm');
const chineseCharInput = document.getElementById('chineseChar');
const addReadingBtn = document.getElementById('addReadingBtn');
const addCardStatusMessage = document.getElementById('addCardStatusMessage');

const viewOrderSelect = document.getElementById('viewOrderSelect');
const cardSearchInput = document.getElementById('cardSearchInput');
const deckTotalInfo = document.getElementById('deckTotalInfo');
const mathCardCount = document.getElementById('mathCardCount');
const cardsGrid = document.getElementById('cardsGrid');
const hardnessPercentSlider = document.getElementById('hardnessPercentSlider');
const hardnessPercentValue = document.getElementById('hardnessPercentValue');
const hardnessPercentStatus = document.getElementById('hardnessPercentStatus');

let allDecks = [];
let orphanDeck = null;
let currentCards = [];
let orphanCardFronts = new Set();
let sortedCards = [];
let visibleCardCount = 10;
let isDeckMoveInFlight = false;
let baselineOptedDeckIdSet = new Set();
let stagedOptedDeckIdSet = new Set();
let availableTagFilterController = null;
let optInAllAvailableController = null;
let baselineIncludeOrphanInQueue = false;
let stagedIncludeOrphanInQueue = false;
let hardnessController = null;
let sharedDeckCardsResponseTracker = null;
let currentCategoryDisplayName = 'Practice';
let isChineseSpecificLogic = false;
let currentSharedScope = SHARED_SCOPE_CARDS;
let isReadingBulkAdding = false;
let initialHardCardPercent = null;
let type1SessionCardCountByCategory = {};
let type1IncludeOrphanByCategory = {};
let type1HardCardPercentByCategory = {};
const CARD_PAGE_SIZE = 10;
const ORPHAN_BUBBLE_ID = '__orphan__';
const CHINESE_FRONT_MAX_FONT_SIZE_REM = 4;
const CHINESE_FRONT_MIN_FONT_SIZE_REM = 0.55;
const CHINESE_FRONT_FIT_ITERATIONS = 8;

function toCategoryMap(rawMap) {
    const input = (rawMap && typeof rawMap === 'object') ? rawMap : {};
    const out = {};
    Object.entries(input).forEach(([rawKey, value]) => {
        const key = String(rawKey || '').trim().toLowerCase();
        if (!key) {
            return;
        }
        out[key] = value;
    });
    return out;
}

function getCategoryIntValue(rawMap, fallback = 0) {
    const map = toCategoryMap(rawMap);
    const parsed = Number.parseInt(map[categoryKey], 10);
    return Number.isInteger(parsed) ? parsed : fallback;
}

function getCategoryBoolValue(rawMap, fallback = false) {
    const map = toCategoryMap(rawMap);
    if (!Object.prototype.hasOwnProperty.call(map, categoryKey)) {
        return Boolean(fallback);
    }
    return Boolean(map[categoryKey]);
}

function withCategoryValue(rawMap, value) {
    const map = toCategoryMap(rawMap);
    map[categoryKey] = value;
    return map;
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = String(text ?? '');
    return div.innerHTML;
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

function withCategoryKey(url) {
    if (categoryKey) {
        url.searchParams.set('categoryKey', categoryKey);
    }
    return url;
}

function buildSharedDeckApiUrl(pathSuffix) {
    const cleanSuffix = String(pathSuffix || '').replace(/^\/+/, '');
    const url = new URL(`${API_BASE}/kids/${kidId}/${currentSharedScope}/${cleanSuffix}`);
    return withCategoryKey(url).toString();
}

function getSessionCountFromKid(kid) {
    type1SessionCardCountByCategory = toCategoryMap(kid[TYPE_I_SESSION_CARD_COUNT_BY_CATEGORY_FIELD]);
    return getCategoryIntValue(type1SessionCardCountByCategory, 0);
}

function buildSessionCountPayload(total) {
    return {
        [TYPE_I_SESSION_CARD_COUNT_BY_CATEGORY_FIELD]: withCategoryValue(
            type1SessionCardCountByCategory,
            total,
        ),
    };
}

function applySessionCountFromPayload(payload) {
    type1SessionCardCountByCategory = toCategoryMap(
        payload && payload[TYPE_I_SESSION_CARD_COUNT_BY_CATEGORY_FIELD]
    );
}

function buildIncludeOrphanPayload(includeOrphan) {
    return {
        [TYPE_I_INCLUDE_ORPHAN_BY_CATEGORY_FIELD]: withCategoryValue(
            type1IncludeOrphanByCategory,
            includeOrphan,
        ),
    };
}

function applyIncludeOrphanFromPayload(payload) {
    type1IncludeOrphanByCategory = toCategoryMap(
        payload && payload[TYPE_I_INCLUDE_ORPHAN_BY_CATEGORY_FIELD]
    );
}

function getInitialHardCardPercentFromKid(kid) {
    type1HardCardPercentByCategory = toCategoryMap(kid[TYPE_I_HARD_CARD_PERCENT_BY_CATEGORY_FIELD]);
    return getCategoryIntValue(type1HardCardPercentByCategory, null);
}

function buildHardCardPercentPayload(hardPct) {
    return {
        [TYPE_I_HARD_CARD_PERCENT_BY_CATEGORY_FIELD]: withCategoryValue(
            type1HardCardPercentByCategory,
            hardPct,
        ),
    };
}

function getPersistedHardCardPercentFromPayload(payload) {
    const map = toCategoryMap(payload && payload[TYPE_I_HARD_CARD_PERCENT_BY_CATEGORY_FIELD]);
    type1HardCardPercentByCategory = map;
    return getCategoryIntValue(map, null);
}

function getCurrentCategoryDisplayName() {
    return String(currentCategoryDisplayName || '').trim() || buildCategoryDisplayName(categoryKey);
}

function applyCategoryUiText() {
    const displayName = getCurrentCategoryDisplayName();
    if (sessionCardCountLabel) {
        sessionCardCountLabel.textContent = `${displayName} Cards Per Session (Total Across Opted-in Decks)`;
    }
    if (optInDecksHeading) {
        optInDecksHeading.textContent = `Opt-in Shared ${displayName} Decks`;
    }
    if (optInDecksNote) {
        optInDecksNote.textContent = 'Click a deck to stage move between lists. Nothing is saved until you click Apply Deck Changes. Orphan opt-out only hides orphan cards from merged bank and queue; cards stay in DB.';
    }
    if (cardsSectionTitleText) {
        cardsSectionTitleText.textContent = `${displayName} Questions`;
    }
    if (cardsHardnessHelpText) {
        cardsHardnessHelpText.textContent = `Hardness score for ${displayName} is based on the card's most recent response time. Slower response means higher hardness.`;
    }
    if (orphanEditorSection) {
        orphanEditorSection.classList.toggle('hidden', !isChineseSpecificLogic);
    }
    if (cardSearchInput) {
        cardSearchInput.classList.toggle('hidden', !isChineseSpecificLogic);
    }
    document.body.classList.toggle('type1-chinese-mode', isChineseSpecificLogic);
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
        return;
    }

    const orphanText = orphanPending
        ? `, orphan ${stagedIncludeOrphanInQueue ? 'opt-in' : 'opt-out'}`
        : '';
    deckPendingInfo.textContent = `Pending: ${toOptIn.length} opt-in, ${toOptOut.length} opt-out${orphanText}.`;
    applyDeckChangesBtn.disabled = isDeckMoveInFlight;
    applyDeckChangesBtn.textContent = isDeckMoveInFlight ? 'Applying...' : 'Apply Deck Changes';
    if (optInAllAvailableController) {
        optInAllAvailableController.render();
    }
}

function renderAvailableDecks() {
    ensureAvailableTagFilterController().sync();
    const allAvailableDecks = getAvailableDeckCandidatesForTagFilter();
    const deckList = allAvailableDecks.filter(matchesAvailableTagFilter);
    const shouldShowOrphan = Boolean(orphanDeck) && !stagedIncludeOrphanInQueue;
    const availableDeckCount = deckList.length + (shouldShowOrphan ? 1 : 0);
    if (availableDecksTitle) {
        availableDecksTitle.textContent = `Available Shared Decks (${availableDeckCount})`;
    }
    if (optInAllAvailableController) {
        optInAllAvailableController.render(deckList.length);
    }
    window.PracticeManageCommon.renderLimitedAvailableDecks({
        containerEl: availableDecksEl,
        emptyEl: availableEmptyEl,
        allAvailableDecks,
        filteredDecks: deckList,
        emptyText: `No shared ${getCurrentCategoryDisplayName()} decks available yet.`,
        filterLabel: ensureAvailableTagFilterController().getDisplayLabel(),
        getLabel: getType1DeckBubbleLabel,
        bubbleTitle: 'Click to stage opt-in',
        maxVisibleCount: 10,
    });
    if (shouldShowOrphan && availableDecksEl) {
        const orphanNameRaw = String(orphanDeck && orphanDeck.name ? orphanDeck.name : `${categoryKey}_orphan`);
        const orphanName = stripCategoryFirstTagFromName(orphanNameRaw) || orphanNameRaw;
        const orphanCount = Number(orphanDeck && orphanDeck.card_count ? orphanDeck.card_count : 0);
        const orphanBubble = `
            <button
                type="button"
                class="deck-bubble"
                data-deck-id="${ORPHAN_BUBBLE_ID}"
                data-orphan-toggle="in"
                title="Click to stage orphan opt-in"
            >${escapeHtml(orphanName)}${escapeHtml(` · ${orphanCount} cards`)}</button>
        `;
        availableDecksEl.insertAdjacentHTML('afterbegin', orphanBubble);
        availableEmptyEl.classList.add('hidden');
    }
}

function getDeckTags(deck) {
    return Array.isArray(deck.tags)
        ? deck.tags.map((tag) => String(tag || '').trim().toLowerCase()).filter(Boolean)
        : [];
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

function getAvailableDeckCandidatesForTagFilter() {
    return (Array.isArray(allDecks) ? allDecks : []).filter(
        (deck) => !stagedOptedDeckIdSet.has(Number(deck.deck_id))
    );
}

function ensureAvailableTagFilterController() {
    if (availableTagFilterController) {
        return availableTagFilterController;
    }
    availableTagFilterController = window.PracticeManageCommon.createHierarchicalTagFilterController({
        selectEl: availableTagFilterInput,
        getDecks: getAvailableDeckCandidatesForTagFilter,
        getDeckTags,
        onFilterChanged: () => {
            renderAvailableDecks();
        },
    });
    return availableTagFilterController;
}

function matchesAvailableTagFilter(deck) {
    return ensureAvailableTagFilterController().matchesDeck(deck);
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
    const optedDecks = getOptedDecks();
    const showOrphanInSelected = Boolean(orphanDeck) && stagedIncludeOrphanInQueue;
    if (selectedDecksTitle) {
        selectedDecksTitle.textContent = `Opted-in Decks (${optedDecks.length + (showOrphanInSelected ? 1 : 0)})`;
    }
    const orphanNameRaw = String(orphanDeck && orphanDeck.name ? orphanDeck.name : `${categoryKey}_orphan`);
    const orphanName = stripCategoryFirstTagFromName(orphanNameRaw) || orphanNameRaw;
    const orphanCount = Number(orphanDeck && orphanDeck.card_count ? orphanDeck.card_count : 0);

    const optedDeckButtons = optedDecks.map((deck) => {
        const deckId = Number(deck.deck_id || 0);
        const suffix = ` · ${Number(deck.card_count || 0)} cards`;
        const label = getType1DeckBubbleLabel(deck);
        return `
            <button
                type="button"
                class="deck-bubble selected"
                data-deck-id="${deckId}"
                title="Click to stage opt-out"
            >${escapeHtml(label)}${escapeHtml(suffix)}</button>
        `;
    });

    const orphanButton = showOrphanInSelected
        ? `
        <button
            type="button"
            class="deck-bubble selected"
            data-deck-id="${ORPHAN_BUBBLE_ID}"
            data-orphan-toggle="out"
            title="Click to stage orphan opt-out"
        >${escapeHtml(orphanName)}${escapeHtml(` · ${orphanCount} cards`)}</button>
    `
        : '';

    selectedDecksEl.innerHTML = [orphanButton, ...optedDeckButtons].join('');
    if (selectedDecksEl.innerHTML.trim()) {
        selectedEmptyEl.classList.add('hidden');
    } else {
        selectedEmptyEl.classList.remove('hidden');
    }
}

function filterCardsByQuery(cards, rawQuery) {
    const query = String(rawQuery || '').trim();
    if (!query) {
        return cards;
    }
    return cards.filter((card) => {
        const front = String(card.front || '');
        const back = String(card.back || '');
        return front.includes(query) || back.includes(query);
    });
}

function buildCardReportHref(card) {
    const qs = new URLSearchParams();
    qs.set('id', String(kidId || ''));
    qs.set('cardId', String(card.id || ''));
    qs.set('from', currentSharedScope === SHARED_SCOPE_LESSON_READING ? 'lesson-reading' : 'cards');
    if (categoryKey) {
        qs.set('categoryKey', categoryKey);
    }
    return `/kid-card-report.html?${qs.toString()}`;
}

function buildChineseCardMarkup(card) {
    return `
        <div class="card-item type1-chinese-card">
            ${card.source_is_orphan ? `
                <button
                    type="button"
                    class="delete-card-btn"
                    data-action="delete-card"
                    data-card-id="${escapeHtml(card.id)}"
                    title="Delete this orphan card"
                    aria-label="Delete this card"
                >×</button>
            ` : ''}
            <div class="card-front">${escapeHtml(card.front)}</div>
            ${String(card.back || '').trim() ? `
            <div class="card-back">${escapeHtml(card.back)}</div>
            ` : ''}
            <div style="margin-top: 4px; color: #666; font-size: 0.82rem;">Source: ${escapeHtml(card.source_deck_label || card.source_deck_name || '-')}</div>
            <div style="margin-top: 10px; color: #666; font-size: 0.85rem;">Hardness score: ${window.PracticeManageCommon.formatHardnessScore(card.hardness_score)}</div>
            <div style="margin-top: 4px; color: #888; font-size: 0.8rem;">Added: ${window.PracticeManageCommon.formatAddedDate(card.created_at)}</div>
            <div style="margin-top: 4px; color: #666; font-size: 0.82rem;">Lifetime attempts: ${card.lifetime_attempts || 0}</div>
            <div style="margin-top: 4px; color: #666; font-size: 0.82rem;">Last seen: ${window.PracticeManageCommon.formatLastSeenDays(card.last_seen_at)}</div>
            <a class="card-report-link" href="${buildCardReportHref(card)}">Report</a>
        </div>
    `;
}

function buildGenericType1CardMarkup(card) {
    return `
        <div class="card-item ${card.skip_practice ? 'skipped' : ''}">
            <button
                type="button"
                class="skip-toggle-btn ${card.skip_practice ? 'on' : 'off'}"
                data-action="toggle-skip"
                data-card-id="${card.id}"
                data-skipped="${card.skip_practice ? 'true' : 'false'}"
                title="${card.skip_practice ? 'Turn skip off for this card' : 'Mark this card as skipped'}"
                aria-label="${card.skip_practice ? 'Skip is on' : 'Skip is off'}"
            >Skip ${card.skip_practice ? 'ON' : 'OFF'}</button>
            <div class="card-front">${escapeHtml(card.front)}</div>
            <div class="card-back">${escapeHtml(card.back)}</div>
            <div style="margin-top: 4px; color: #666; font-size: 0.82rem;">Source: ${escapeHtml(card.source_deck_label || card.source_deck_name || '-')}</div>
            ${card.skip_practice ? '<div class="skipped-note">Skipped from practice</div>' : ''}
            <div style="margin-top: 10px; color: #666; font-size: 0.85rem;">Hardness score: ${window.PracticeManageCommon.formatHardnessScore(card.hardness_score)}</div>
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
        const length = getTextLength(card && card.front);
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
    const filteredCards = isChineseSpecificLogic
        ? filterCardsByQuery(cards, cardSearchInput ? cardSearchInput.value : '')
        : cards;
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
        .map((card) => (isChineseSpecificLogic ? buildChineseCardMarkup(card) : buildGenericType1CardMarkup(card)))
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
    const totalChineseChars = countChineseCharsBeforeDbDedup(chineseCharInput.value);
    if (totalChineseChars > 0) {
        addReadingBtn.textContent = `Bulk Add Chinese Characters (${totalChineseChars})`;
        return;
    }
    addReadingBtn.textContent = 'Bulk Add Chinese Characters';
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

function updateOrphanDerivedState(cards) {
    const safeCards = Array.isArray(cards) ? cards : [];
    const orphanCards = safeCards.filter((card) => !!card.source_is_orphan);
    orphanCardFronts = new Set(
        orphanCards
            .map((card) => String(card.front || ''))
            .filter(Boolean)
    );
    if (!orphanDeck) {
        return;
    }
    orphanDeck.card_count = orphanCards.length;
    orphanDeck.active_card_count = orphanCards.filter((card) => !card.skip_practice).length;
    orphanDeck.skipped_card_count = orphanCards.filter((card) => !!card.skip_practice).length;
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
        if (hardnessController) {
            hardnessController.setCurrentValue(data.hard_card_percentage);
        }

        updateOrphanDerivedState(currentCards);

        const activeCount = Number.isInteger(Number.parseInt(data.active_card_count, 10))
            ? Number.parseInt(data.active_card_count, 10)
            : currentCards.filter((card) => !card.skip_practice).length;
        const skippedCount = Number.isInteger(Number.parseInt(data.skipped_card_count, 10))
            ? Number.parseInt(data.skipped_card_count, 10)
            : currentCards.filter((card) => !!card.skip_practice).length;

        if (deckTotalInfo) {
            const practiceActiveCount = Number.isInteger(Number.parseInt(data.practice_active_card_count, 10))
                ? Number.parseInt(data.practice_active_card_count, 10)
                : activeCount;
            deckTotalInfo.textContent = `Active cards in merged bank: ${activeCount} (Skipped: ${skippedCount}) · In practice queue pool: ${practiceActiveCount}`;
        }
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
        const chineseChars = extractChineseCharacters(input);
        if (chineseChars.length === 0) {
            showError('Please enter at least one Chinese character');
            return;
        }

        const newChars = chineseChars.filter((ch) => !orphanCardFronts.has(ch));
        const skippedExistingCount = Math.max(0, chineseChars.length - newChars.length);
        if (newChars.length === 0) {
            showError('All characters already exist in orphan deck');
            return;
        }

        const addUrl = withCategoryKey(new URL(`${API_BASE}/kids/${kidId}/cards/bulk`));
        const response = await fetch(addUrl.toString(), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                categoryKey,
                cards: newChars.map((ch) => ({ front: ch, back: '' }))
            }),
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok) {
            throw new Error(result.error || `Failed to add cards (HTTP ${response.status})`);
        }

        const inserted = Math.max(0, Number(result.created) || 0);
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

async function deleteOrphanCard(cardId) {
    try {
        const result = await window.PracticeManageCommon.requestWithPasswordDialog(
            'deleting this orphan card',
            (password) => fetch(`${API_BASE}/kids/${kidId}/cards/${cardId}`, {
                method: 'DELETE',
                headers: window.PracticeManageCommon.buildPasswordHeaders(password, false),
            })
        );
        if (result.cancelled) {
            return;
        }
        if (!result.ok) {
            throw new Error(result.error || 'Failed to delete card.');
        }

        showError('');
        showSuccess('Card deleted.');
        await loadSharedType1Decks();
    } catch (error) {
        console.error('Error deleting orphan card:', error);
        showError(error.message || 'Failed to delete card.');
    }
}

async function handleCardsGridClick(event) {
    const actionBtn = event.target.closest('[data-action]');
    if (!actionBtn) {
        return;
    }
    const action = actionBtn.dataset.action;

    if (action === 'delete-card') {
        const cardId = actionBtn.dataset.cardId;
        if (!cardId) {
            return;
        }
        const cardRow = (Array.isArray(currentCards) ? currentCards : []).find((card) => String(card.id) === String(cardId));
        if (!cardRow || !cardRow.source_is_orphan) {
            showError('Only orphan cards can be deleted.');
            return;
        }
        actionBtn.disabled = true;
        try {
            await deleteOrphanCard(cardId);
        } finally {
            actionBtn.disabled = false;
        }
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
    const displayName = String(categoryMeta && categoryMeta.display_name ? categoryMeta.display_name : '').trim()
        || buildCategoryDisplayName(categoryKey);
    const behaviorType = String(categoryMeta && categoryMeta.behavior_type ? categoryMeta.behavior_type : '')
        .trim()
        .toLowerCase();
    if (behaviorType !== BEHAVIOR_TYPE_TYPE_I && behaviorType !== BEHAVIOR_TYPE_TYPE_III) {
        throw new Error(`Unsupported manage behavior type: ${behaviorType || 'unknown'}`);
    }
    currentSharedScope = (
        behaviorType === BEHAVIOR_TYPE_TYPE_III
            ? SHARED_SCOPE_LESSON_READING
            : SHARED_SCOPE_CARDS
    );

    isChineseSpecificLogic = Boolean(categoryMeta && categoryMeta.has_chinese_specific_logic);
    currentCategoryDisplayName = displayName;
    applyCategoryUiText();

    window.PracticeManageCommon.applyKidManageTabVisibility({
        kidId,
        optedInCategoryKeys: kid.optedInDeckCategoryKeys,
        deckCategoryMetaByKey: kid.deckCategoryMetaByKey,
        defaultCategoryByRoute: {
            '/kid-card-manage.html': categoryKey,
            '/kid-lesson-reading-manage.html': categoryKey,
        },
    });

    kidNameEl.textContent = `${kid.name || 'Kid'} - ${displayName} Management`;
    type1IncludeOrphanByCategory = toCategoryMap(kid[TYPE_I_INCLUDE_ORPHAN_BY_CATEGORY_FIELD]);
    const total = getSessionCountFromKid(kid);
    sharedMathSessionCardCountInput.value = String(Number.isInteger(total) ? total : 0);
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
        sharedMathSessionCardCountInput.value = String(responseTotal);
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

    const total = Number.parseInt(sharedMathSessionCardCountInput.value, 10);
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
                throw new Error(result.error || `Failed to update orphan deck setting (HTTP ${response.status})`);
            }
            applyIncludeOrphanFromPayload(result);
        }
        const orphanSummary = orphanChanged ? `, orphan ${stagedIncludeOrphanInQueue ? 'opt-in' : 'opt-out'}` : '';
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
            '/kid-lesson-reading-manage.html': categoryKey,
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

    availableDecksEl.addEventListener('click', async (event) => {
        await onAvailableDeckClick(event);
    });
    if (optInAllAvailableBtn && optInAllAvailableController) {
        optInAllAvailableBtn.addEventListener('click', async () => {
            await optInAllAvailableController.optInAll();
        });
    }
    ensureAvailableTagFilterController();
    selectedDecksEl.addEventListener('click', async (event) => {
        await onSelectedDeckClick(event);
    });
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

    sharedDeckCardsResponseTracker = window.PracticeManageCommon.createLatestResponseTracker();

    try {
        showError('');
        showSuccess('');
        await loadKidInfo();
        hardnessController = window.PracticeManageCommon.createKidHardnessController({
            sliderEl: hardnessPercentSlider,
            valueEl: hardnessPercentValue,
            statusEl: hardnessPercentStatus,
            apiBase: API_BASE,
            kidId,
            kidFieldName: TYPE_I_HARD_CARD_PERCENT_BY_CATEGORY_FIELD,
            savedMessage: 'Hard cards % saved.',
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
        await loadSharedType1Decks();
        updateAddReadingButtonCount();
    } catch (error) {
        console.error('Error initializing category manage:', error);
        showError(error.message || 'Failed to load page.');
        kidNameEl.textContent = `${getCurrentCategoryDisplayName()} Management`;
    }
});
