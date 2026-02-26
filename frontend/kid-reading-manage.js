const API_BASE = `${window.location.origin}/api`;

const params = new URLSearchParams(window.location.search);
const kidId = params.get('id');

const kidNameEl = document.getElementById('kidName');
const errorMessage = document.getElementById('errorMessage');
const successMessage = document.getElementById('successMessage');
const charactersTab = document.getElementById('charactersTab');
const writingTab = document.getElementById('writingTab');
const mathTab = document.getElementById('mathTab');
const lessonReadingTab = document.getElementById('lessonReadingTab');

const sessionSettingsForm = document.getElementById('sessionSettingsForm');
const sessionCardCountInput = document.getElementById('sessionCardCount');
const mixBarEl = document.getElementById('mixBar');
const mixRowsEl = document.getElementById('mixRows');
const mixEmptyEl = document.getElementById('mixEmpty');

const availableDecksEl = document.getElementById('availableDecks');
const availableEmptyEl = document.getElementById('availableEmpty');
const availableTagFilterInput = document.getElementById('availableTagFilter');
const clearTagFilterBtn = document.getElementById('clearTagFilterBtn');
const selectedDecksEl = document.getElementById('selectedDecks');
const selectedEmptyEl = document.getElementById('selectedEmpty');
const applyDeckChangesBtn = document.getElementById('applyDeckChangesBtn');
const deckPendingInfo = document.getElementById('deckPendingInfo');

const addCardForm = document.getElementById('addCardForm');
const chineseCharInput = document.getElementById('chineseChar');
const addReadingBtn = document.getElementById('addReadingBtn');
const addCardStatusMessage = document.getElementById('addCardStatusMessage');
const addSiWuKuaiDuBtn = document.getElementById('addSiWuKuaiDuBtn');
const addMaLiPingBtn = document.getElementById('addMaLiPingBtn');
const orphanSummaryEl = document.getElementById('orphanSummary');

const sharedDeckTabs = document.getElementById('sharedDeckTabs');
const viewOrderSelect = document.getElementById('viewOrderSelect');
const cardSearchInput = document.getElementById('cardSearchInput');
const deckTotalInfo = document.getElementById('deckTotalInfo');
const cardCountEl = document.getElementById('cardCount');
const cardsGrid = document.getElementById('cardsGrid');

let currentKid = null;
let allDecks = [];
let orphanDeck = null;
let orphanCardFronts = new Set();
let mixByDeckId = {};
let currentCards = [];
let sortedCards = [];
let visibleCardCount = 10;
let activeDeckId = null;
let activeDeckLabel = '';
let activeDeckIsOrphan = false;
let isDeckMoveInFlight = false;
let baselineOptedDeckIdSet = new Set();
let stagedOptedDeckIdSet = new Set();
let availableTagFilterController = null;
let isReadingBulkAdding = false;
const CARD_PAGE_SIZE = 10;
const ORPHAN_MIX_KEY = 'orphan';

const MIX_COLORS = [
    '#66d9e8',
    '#74c0fc',
    '#b197fc',
    '#ffd43b',
    '#ffa94d',
    '#8ce99a',
    '#ff8787',
    '#c0eb75',
];

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

function distributeIntegerTotal(total, weights) {
    const count = Array.isArray(weights) ? weights.length : 0;
    if (count === 0) {
        return [];
    }
    const safeTotal = Math.max(0, Number.parseInt(total, 10) || 0);
    if (safeTotal === 0) {
        return Array(count).fill(0);
    }

    const normalized = weights.map((weight) => {
        const value = Number(weight);
        return Number.isFinite(value) && value > 0 ? value : 0;
    });
    const weightSum = normalized.reduce((sum, value) => sum + value, 0);
    const finalWeights = weightSum > 0 ? normalized : Array(count).fill(1);
    const finalWeightSum = finalWeights.reduce((sum, value) => sum + value, 0);

    const exact = finalWeights.map((value) => (value * safeTotal) / finalWeightSum);
    const floors = exact.map((value) => Math.floor(value));
    let remainder = safeTotal - floors.reduce((sum, value) => sum + value, 0);

    const ranked = exact
        .map((value, index) => ({ index, remainder: value - floors[index] }))
        .sort((a, b) => {
            if (b.remainder !== a.remainder) {
                return b.remainder - a.remainder;
            }
            return a.index - b.index;
        });

    let cursor = 0;
    while (remainder > 0 && ranked.length > 0) {
        floors[ranked[cursor].index] += 1;
        cursor = (cursor + 1) % ranked.length;
        remainder -= 1;
    }

    return floors;
}

function getDeckById(deckId) {
    return allDecks.find((deck) => Number(deck.deck_id) === Number(deckId)) || null;
}

function getOptedDecks() {
    return allDecks.filter((deck) => stagedOptedDeckIdSet.has(Number(deck.deck_id)));
}

function getMixDeckKey(deck) {
    if (deck && typeof deck.mix_key === 'string' && deck.mix_key) {
        return deck.mix_key;
    }
    const deckId = Number(deck && deck.deck_id);
    return Number.isInteger(deckId) && deckId > 0 ? String(deckId) : '';
}

function getMixDecks() {
    const decks = getOptedDecks().map((deck) => ({ ...deck, mix_key: String(Number(deck.deck_id)) }));
    const orphanDeckId = Number(orphanDeck && orphanDeck.deck_id);
    if (orphanDeckId > 0) {
        decks.push({
            deck_id: orphanDeckId,
            name: String(orphanDeck && orphanDeck.name ? orphanDeck.name : 'chinese_characters_orphan'),
            mix_key: ORPHAN_MIX_KEY,
            is_orphan: true,
        });
    }
    return decks;
}

function hasPendingDeckChanges() {
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

    if (toOptIn.length === 0 && toOptOut.length === 0) {
        deckPendingInfo.textContent = 'No pending deck changes.';
        applyDeckChangesBtn.disabled = true;
        applyDeckChangesBtn.textContent = 'Apply Deck Changes';
        return;
    }

    deckPendingInfo.textContent = `Pending: ${toOptIn.length} opt-in, ${toOptOut.length} opt-out.`;
    applyDeckChangesBtn.disabled = isDeckMoveInFlight;
    applyDeckChangesBtn.textContent = isDeckMoveInFlight ? 'Applying...' : 'Apply Deck Changes';
}

function getChineseCharacterQuestionDecks() {
    const decks = getOptedDecks().map((deck) => ({
        local_deck_id: Number(deck.materialized_deck_id || 0),
        label: String(deck.name || ''),
        is_orphan: false,
    })).filter((deck) => deck.local_deck_id > 0);

    const orphanDeckId = Number(orphanDeck && orphanDeck.deck_id);
    if (orphanDeckId > 0) {
        decks.push({
            local_deck_id: orphanDeckId,
            label: String(orphanDeck && orphanDeck.name ? orphanDeck.name : 'chinese_characters_orphan'),
            is_orphan: true,
        });
    }

    return decks;
}

function normalizeMixForOptedDecks() {
    const mixDecks = getMixDecks();
    if (mixDecks.length === 0) {
        mixByDeckId = {};
        return;
    }

    const mixKeys = mixDecks.map((deck) => getMixDeckKey(deck));
    const weights = mixKeys.map((mixKey) => {
        const raw = mixByDeckId[mixKey];
        const parsed = Number.parseInt(raw, 10);
        return Number.isInteger(parsed) && parsed > 0 ? parsed : 0;
    });
    const percents = distributeIntegerTotal(100, weights);

    const next = {};
    mixKeys.forEach((mixKey, index) => {
        next[mixKey] = percents[index];
    });
    mixByDeckId = next;
}

function getCountByDeckId(totalCards, mixDecks) {
    const mixKeys = mixDecks.map((deck) => getMixDeckKey(deck)).filter(Boolean);
    const weights = mixKeys.map((mixKey) => Number.parseInt(mixByDeckId[mixKey] || 0, 10));
    const counts = distributeIntegerTotal(totalCards, weights);
    const map = {};
    mixKeys.forEach((mixKey, index) => {
        map[mixKey] = counts[index];
    });
    return map;
}

function setMixByDeckFromPercentArray(mixDecks, percents) {
    const next = {};
    mixDecks.forEach((deck, index) => {
        const deckId = getMixDeckKey(deck);
        const value = Number.parseInt(percents[index], 10);
        if (!deckId) {
            return;
        }
        next[deckId] = Number.isInteger(value) ? Math.max(0, Math.min(100, value)) : 0;
    });
    mixByDeckId = next;
}

function renderMixEditor() {
    const mixDecks = getMixDecks();
    normalizeMixForOptedDecks();

    if (mixDecks.length === 0) {
        mixBarEl.innerHTML = '';
        mixRowsEl.innerHTML = '';
        mixEmptyEl.classList.remove('hidden');
        return;
    }

    mixEmptyEl.classList.add('hidden');
    const totalCards = Math.max(0, Number.parseInt(sessionCardCountInput.value, 10) || 0);
    const countByDeckId = getCountByDeckId(totalCards, mixDecks);
    const percents = mixDecks.map((deck) => Number.parseInt(mixByDeckId[getMixDeckKey(deck)] || 0, 10));

    window.SharedDeckMix.renderMixBar({
        mixBarEl,
        optedDecks: mixDecks,
        percents,
        mixColors: MIX_COLORS,
        escapeHtml,
    });

    mixRowsEl.innerHTML = mixDecks.map((deck, index) => {
            const percent = percents[index];
            const cards = Number.parseInt(countByDeckId[getMixDeckKey(deck)] || 0, 10);
            const color = MIX_COLORS[index % MIX_COLORS.length];
            return `
                <div class="mix-row">
                    <div class="mix-row-label" title="${escapeHtml(deck.name || '')}">
                        <span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${color};margin-right:6px;vertical-align:middle;"></span>${escapeHtml(deck.name || '')}
                    </div>
                    <div class="mix-pct">${percent}%</div>
                    <div class="mix-cards">${cards} cards</div>
                </div>
            `;
        }).join('');
}

function onMixBarPointerDown(event) {
    window.SharedDeckMix.onMixBarPointerDown(event, {
        mixBarEl,
        getOptedDecks: getMixDecks,
        normalizeMix: normalizeMixForOptedDecks,
        getPercentForDeck: (deck) => Number.parseInt(mixByDeckId[getMixDeckKey(deck)] || 0, 10),
        setMixByDeckFromPercentArray,
        renderMixEditor,
    });
}

function rebalanceAfterOptInChanges() {
    const mixDecks = getMixDecks();
    if (mixDecks.length === 0) {
        mixByDeckId = {};
        return;
    }
    const mixKeys = mixDecks.map((deck) => getMixDeckKey(deck));
    const weights = mixKeys.map((mixKey) => Number.parseInt(mixByDeckId[mixKey] || 0, 10));
    const percents = distributeIntegerTotal(100, weights);
    const next = {};
    mixKeys.forEach((mixKey, index) => {
        next[mixKey] = percents[index];
    });
    mixByDeckId = next;
}

function getDeckTags(deck) {
    return Array.isArray(deck.tags)
        ? deck.tags.map((tag) => String(tag || '').trim().toLowerCase()).filter(Boolean)
        : [];
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
        clearBtn: clearTagFilterBtn,
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

function renderAvailableDecks() {
    ensureAvailableTagFilterController().sync();
    const allAvailableDecks = (Array.isArray(allDecks) ? allDecks : []).filter(
        (deck) => !stagedOptedDeckIdSet.has(Number(deck.deck_id))
    );
    const deckList = allAvailableDecks.filter(matchesAvailableTagFilter);
    if (allAvailableDecks.length === 0) {
        availableDecksEl.innerHTML = '';
        availableEmptyEl.textContent = 'No shared Chinese Character decks available yet.';
        availableEmptyEl.classList.remove('hidden');
        return;
    }
    if (deckList.length === 0) {
        availableDecksEl.innerHTML = '';
        const filterLabel = ensureAvailableTagFilterController().getDisplayLabel();
        availableEmptyEl.textContent = filterLabel
            ? `No available deck matches tag "${filterLabel}".`
            : 'No shared Chinese Character decks available yet.';
        availableEmptyEl.classList.remove('hidden');
        return;
    }
    availableEmptyEl.classList.add('hidden');

    availableDecksEl.innerHTML = deckList.map((deck) => {
        const deckId = Number(deck.deck_id || 0);
        return `
            <button type="button" class="deck-bubble" data-deck-id="${deckId}" title="Click to stage opt-in">
                ${escapeHtml(deck.name || '')}
            </button>
        `;
    }).join('');
}

function renderSelectedDecks() {
    const optedDecks = getOptedDecks();
    if (optedDecks.length === 0) {
        selectedDecksEl.innerHTML = '';
        selectedEmptyEl.classList.remove('hidden');
        return;
    }
    selectedEmptyEl.classList.add('hidden');
    selectedDecksEl.innerHTML = optedDecks.map((deck) => {
        const deckId = Number(deck.deck_id || 0);
        return `
            <button type="button" class="deck-bubble selected" data-deck-id="${deckId}" title="Click to stage opt-out">
                ${escapeHtml(deck.name || '')}
            </button>
        `;
    }).join('');
}

function renderOrphanSummary() {
    if (!orphanDeck) {
        orphanSummaryEl.textContent = 'Orphan deck not available yet.';
        return;
    }
    const total = Number.parseInt(orphanDeck.card_count, 10) || 0;
    const active = Number.parseInt(orphanDeck.active_card_count, 10);
    const skipped = Number.parseInt(orphanDeck.skipped_card_count, 10);
    if (Number.isInteger(active) && Number.isInteger(skipped)) {
        orphanSummaryEl.textContent = `${orphanDeck.name}: ${total} total (${active} active, ${skipped} skipped)`;
    } else {
        orphanSummaryEl.textContent = `${orphanDeck.name}: ${total} total`;
    }
}

function renderSharedDeckTabs() {
    const questionDecks = getChineseCharacterQuestionDecks();
    if (questionDecks.length === 0) {
        activeDeckId = null;
        activeDeckLabel = '';
        activeDeckIsOrphan = false;
        sharedDeckTabs.innerHTML = '';
        currentCards = [];
        resetAndDisplayCards(currentCards);
        if (cardCountEl) {
            cardCountEl.textContent = '(0)';
        }
        if (deckTotalInfo) {
            deckTotalInfo.textContent = 'Active cards in this deck: 0';
        }
        return;
    }

    const validIds = new Set(questionDecks.map((deck) => Number(deck.local_deck_id)));
    if (!Number.isInteger(activeDeckId) || !validIds.has(activeDeckId)) {
        const preferredOrphanId = Number(orphanDeck && orphanDeck.deck_id);
        activeDeckId = validIds.has(preferredOrphanId) ? preferredOrphanId : Number(questionDecks[0].local_deck_id);
    }

    activeDeckIsOrphan = Number(orphanDeck && orphanDeck.deck_id) === Number(activeDeckId);

    sharedDeckTabs.innerHTML = questionDecks.map((deck) => {
        const localDeckId = Number(deck.local_deck_id);
        const activeClass = activeDeckId === localDeckId ? ' active' : '';
        const label = String(deck.label || '');
        return `
            <button type="button" class="math-deck-tab${activeClass}" data-materialized-deck-id="${localDeckId}">
                ${escapeHtml(label)}
            </button>
        `;
    }).join('');
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

function displayCards(cards) {
    const filteredCards = filterCardsByQuery(cards, cardSearchInput.value);
    sortedCards = window.PracticeManageCommon.sortCardsForView(filteredCards, viewOrderSelect.value);

    if (cardCountEl) {
        cardCountEl.textContent = `(${sortedCards.length})`;
    }

    if (sortedCards.length === 0) {
        cardsGrid.innerHTML = `<div class="empty-state" style="grid-column: 1 / -1;"><h3>No cards in ${escapeHtml(activeDeckLabel || 'this deck')}</h3></div>`;
        return;
    }

    const visibleCards = sortedCards.slice(0, visibleCardCount);
    cardsGrid.innerHTML = visibleCards.map((card) => `
        <div class="card-item">
            ${activeDeckIsOrphan ? `
                <button
                    type="button"
                    class="delete-card-btn"
                    data-action="delete-card"
                    data-card-id="${escapeHtml(card.id)}"
                    title="Delete this orphan Chinese character card"
                    aria-label="Delete this card"
                >×</button>
            ` : ''}
            <div class="card-front">${escapeHtml(card.front)}</div>
            <div style="margin-top: 10px; color: #666; font-size: 0.85rem;">
                Hardness score: ${window.PracticeManageCommon.formatHardnessScore(card.hardness_score)}
            </div>
            <div style="margin-top: 4px; color: #888; font-size: 0.8rem;">
                Added: ${window.PracticeManageCommon.formatAddedDate(card.created_at)}
            </div>
            <div style="margin-top: 4px; color: #666; font-size: 0.82rem;">
                Lifetime attempts: ${card.lifetime_attempts || 0}
            </div>
            <div style="margin-top: 4px; color: #666; font-size: 0.82rem;">
                Last seen: ${window.PracticeManageCommon.formatLastSeenDays(card.last_seen_at)}
            </div>
            <a
                class="card-report-link"
                href="/kid-card-report.html?id=${encodeURIComponent(kidId)}&cardId=${encodeURIComponent(card.id)}&from=reading"
            >Report</a>
        </div>
    `).join('');
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

async function loadKidInfo() {
    const response = await fetch(`${API_BASE}/kids/${kidId}`);
    const kid = await response.json().catch(() => ({}));
    if (!response.ok) {
        throw new Error(kid.error || `Failed to load kid (HTTP ${response.status})`);
    }
    currentKid = kid;
    kidNameEl.textContent = `${kid.name || 'Kid'} - Chinese Characters Management`;
    const total = Number.parseInt(kid.sessionCardCount, 10);
    sessionCardCountInput.value = String(Number.isInteger(total) ? total : 10);
}

async function loadSharedChineseCharacterDecks() {
    const response = await fetch(`${API_BASE}/kids/${kidId}/characters/shared-decks`);
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
    orphanDeck = result && typeof result.orphan_deck === 'object' && result.orphan_deck ? result.orphan_deck : null;
    ensureAvailableTagFilterController().sync();
    renderOrphanSummary();

    const responseTotal = Number.parseInt(result.session_card_count, 10);
    if (Number.isInteger(responseTotal)) {
        sessionCardCountInput.value = String(responseTotal);
    }

    const responseMix = result && typeof result.shared_chinese_characters_deck_mix === 'object' && result.shared_chinese_characters_deck_mix
        ? result.shared_chinese_characters_deck_mix
        : {};
    const nextMix = {};
    getOptedDecks().forEach((deck) => {
        const deckId = String(Number(deck.deck_id));
        const fromDeck = Number.parseInt(deck.mix_percent, 10);
        const fromResponse = Number.parseInt(responseMix[deckId], 10);
        if (Number.isInteger(fromResponse)) {
            nextMix[deckId] = Math.max(0, Math.min(100, fromResponse));
        } else if (Number.isInteger(fromDeck)) {
            nextMix[deckId] = Math.max(0, Math.min(100, fromDeck));
        } else {
            nextMix[deckId] = 0;
        }
    });
    const orphanMixPercent = Number.parseInt(responseMix[ORPHAN_MIX_KEY], 10);
    if (orphanDeck && Number(orphanDeck.deck_id) > 0) {
        if (Number.isInteger(orphanMixPercent)) {
            nextMix[ORPHAN_MIX_KEY] = Math.max(0, Math.min(100, orphanMixPercent));
        } else {
            nextMix[ORPHAN_MIX_KEY] = 0;
        }
    }
    mixByDeckId = nextMix;
    rebalanceAfterOptInChanges();

    renderAvailableDecks();
    renderSelectedDecks();
    renderDeckPendingInfo();
    renderMixEditor();
    renderSharedDeckTabs();
    await loadSharedDeckCards();
}

async function saveSessionSettings() {
    showError('');
    showSuccess('');

    const total = Number.parseInt(sessionCardCountInput.value, 10);
    if (!Number.isInteger(total) || total < 0 || total > 200) {
        showError('Chinese Character cards per session must be between 0 and 200.');
        return;
    }

    normalizeMixForOptedDecks();
    const payloadMix = {};
    getOptedDecks().forEach((deck) => {
        const deckId = String(Number(deck.deck_id));
        payloadMix[deckId] = Number.parseInt(mixByDeckId[deckId] || 0, 10);
    });
    if (orphanDeck && Number(orphanDeck.deck_id) > 0) {
        payloadMix[ORPHAN_MIX_KEY] = Number.parseInt(mixByDeckId[ORPHAN_MIX_KEY] || 0, 10);
    }

    const response = await fetch(`${API_BASE}/kids/${kidId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            sessionCardCount: total,
            sharedChineseCharactersDeckMix: payloadMix,
        }),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
        throw new Error(result.error || `Failed to save settings (HTTP ${response.status})`);
    }

    currentKid = result;
    showSuccess('Practice settings saved.');
    await loadSharedChineseCharacterDecks();
}

async function requestOptInDeckIds(deckIds) {
    const response = await fetch(`${API_BASE}/kids/${kidId}/characters/shared-decks/opt-in`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deck_ids: deckIds }),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
        throw new Error(result.error || `Failed to opt in decks (HTTP ${response.status})`);
    }
    return result;
}

async function requestOptOutDeckIds(deckIds) {
    const response = await fetch(`${API_BASE}/kids/${kidId}/characters/shared-decks/opt-out`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deck_ids: deckIds }),
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
    if ((shouldOptIn && currentlyOptedIn) || (!shouldOptIn && !currentlyOptedIn)) {
        return;
    }

    if (shouldOptIn) {
        stagedOptedDeckIdSet.add(numericDeckId);
    } else {
        stagedOptedDeckIdSet.delete(numericDeckId);
    }

    showError('');
    showSuccess('');
    rebalanceAfterOptInChanges();
    renderAvailableDecks();
    renderSelectedDecks();
    renderDeckPendingInfo();
    renderMixEditor();
    renderSharedDeckTabs();
    await loadSharedDeckCards();
}

async function applyDeckMembershipChanges() {
    if (isDeckMoveInFlight || !hasPendingDeckChanges()) {
        return;
    }
    const toOptIn = [...stagedOptedDeckIdSet].filter((deckId) => !baselineOptedDeckIdSet.has(deckId));
    const toOptOut = [...baselineOptedDeckIdSet].filter((deckId) => !stagedOptedDeckIdSet.has(deckId));

    isDeckMoveInFlight = true;
    renderDeckPendingInfo();
    showError('');
    showSuccess('');
    try {
        if (toOptIn.length > 0) {
            await requestOptInDeckIds(toOptIn);
        }
        if (toOptOut.length > 0) {
            await requestOptOutDeckIds(toOptOut);
        }
        showSuccess(`Applied deck changes: ${toOptIn.length} opt-in, ${toOptOut.length} opt-out.`);
        await loadSharedChineseCharacterDecks();
    } catch (error) {
        console.error('Error applying deck membership changes:', error);
        showError(error.message || 'Failed to apply deck changes.');
    } finally {
        isDeckMoveInFlight = false;
        renderDeckPendingInfo();
    }
}

async function loadSharedDeckCards() {
    try {
        if (!Number.isInteger(activeDeckId) || activeDeckId <= 0) {
            currentCards = [];
            resetAndDisplayCards(currentCards);
            if (cardCountEl) {
                cardCountEl.textContent = '(0)';
            }
            if (deckTotalInfo) {
                deckTotalInfo.textContent = 'Active cards in this deck: 0';
            }
            return;
        }

        const response = await fetch(`${API_BASE}/kids/${kidId}/characters/shared-decks/cards?deck_id=${encodeURIComponent(String(activeDeckId))}`);
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
            throw new Error(data.error || `Failed to load deck cards (HTTP ${response.status})`);
        }

        activeDeckLabel = String(data.deck_name || '');
        activeDeckIsOrphan = Boolean(data.is_orphan_deck);
        currentCards = Array.isArray(data.cards) ? data.cards : [];

        if (activeDeckIsOrphan) {
            orphanCardFronts = new Set(currentCards.map((card) => String(card.front || '')).filter(Boolean));
            if (orphanDeck) {
                orphanDeck.card_count = currentCards.length;
                orphanDeck.active_card_count = Number.parseInt(data.active_card_count, 10) || currentCards.filter((card) => !card.skip_practice).length;
                orphanDeck.skipped_card_count = Number.parseInt(data.skipped_card_count, 10) || currentCards.filter((card) => !!card.skip_practice).length;
                renderOrphanSummary();
            }
        }

        const activeCount = Number.parseInt(data.active_card_count, 10);
        const skippedCount = Number.parseInt(data.skipped_card_count, 10);
        const requestedCount = Number.parseInt(data.session_count, 10);
        const safeActiveCount = Number.isInteger(activeCount) ? activeCount : currentCards.filter((card) => !card.skip_practice).length;
        const safeSkippedCount = Number.isInteger(skippedCount) ? skippedCount : currentCards.filter((card) => !!card.skip_practice).length;
        const safeRequestedCount = Number.isInteger(requestedCount) ? requestedCount : 0;

        if (deckTotalInfo) {
            if (activeDeckIsOrphan) {
                deckTotalInfo.textContent = `Active cards in this deck: ${safeActiveCount} (Skipped: ${safeSkippedCount}) · Session remainder target: ${safeRequestedCount}`;
            } else {
                deckTotalInfo.textContent = `Active cards in this deck: ${safeActiveCount} (Skipped: ${safeSkippedCount}) · Shared mix target: ${safeRequestedCount}`;
            }
        }
        resetAndDisplayCards(currentCards);
    } catch (error) {
        console.error('Error loading shared Chinese Character cards:', error);
        showError(error.message || 'Failed to load shared Chinese Character cards.');
    }
}

async function addOrphanCards() {
    if (isReadingBulkAdding) {
        return;
    }
    try {
        setReadingBulkAddBusy(true);
        showStatusMessage('');
        showError('');
        showSuccess('');

        const input = String(chineseCharInput.value || '').trim();
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

        const response = await fetch(`${API_BASE}/kids/${kidId}/cards/bulk`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
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

        await loadSharedChineseCharacterDecks();
        const orphanId = Number(orphanDeck && orphanDeck.deck_id);
        if (orphanId > 0) {
            activeDeckId = orphanId;
            renderSharedDeckTabs();
            await loadSharedDeckCards();
        }
    } catch (error) {
        console.error('Error adding orphan cards:', error);
        showStatusMessage('');
        showError(error.message || 'Failed to add Chinese character cards.');
    } finally {
        setReadingBulkAddBusy(false);
    }
}

async function deleteOrphanCard(cardId) {
    try {
        const result = await window.PracticeManageCommon.requestWithPasswordDialog(
            'deleting this orphan Chinese character card',
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
        await loadSharedChineseCharacterDecks();
        if (Number(orphanDeck && orphanDeck.deck_id) > 0) {
            activeDeckId = Number(orphanDeck.deck_id);
        }
        renderSharedDeckTabs();
        await loadSharedDeckCards();
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
    if (action !== 'delete-card') {
        return;
    }
    const cardId = actionBtn.dataset.cardId;
    if (!cardId) {
        return;
    }
    if (!activeDeckIsOrphan) {
        showError('Only orphan Chinese character cards can be deleted.');
        return;
    }
    actionBtn.disabled = true;
    try {
        await deleteOrphanCard(cardId);
    } finally {
        actionBtn.disabled = false;
    }
}

async function onAvailableDeckClick(event) {
    const bubble = event.target.closest('button[data-deck-id]');
    if (!bubble) {
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
    const deckId = Number(bubble.getAttribute('data-deck-id') || 0);
    if (!(deckId > 0)) {
        return;
    }
    await stageDeckMembershipChange(deckId, 'out');
}

async function onSharedDeckTabClick(event) {
    const tab = event.target.closest('button[data-materialized-deck-id]');
    if (!tab) {
        return;
    }
    const nextDeckId = Number(tab.getAttribute('data-materialized-deck-id') || 0);
    if (!(nextDeckId > 0) || activeDeckId === nextDeckId) {
        return;
    }
    activeDeckId = nextDeckId;
    renderSharedDeckTabs();
    await loadSharedDeckCards();
}

document.addEventListener('DOMContentLoaded', async () => {
    if (!kidId) {
        window.location.href = '/admin.html';
        return;
    }

    charactersTab.href = `/kid-reading-manage.html?id=${kidId}`;
    writingTab.href = `/kid-writing-manage.html?id=${kidId}`;
    mathTab.href = `/kid-math-manage.html?id=${kidId}`;
    lessonReadingTab.href = `/kid-lesson-reading-manage.html?id=${kidId}`;

    availableDecksEl.addEventListener('click', async (event) => {
        await onAvailableDeckClick(event);
    });
    ensureAvailableTagFilterController();
    selectedDecksEl.addEventListener('click', async (event) => {
        await onSelectedDeckClick(event);
    });
    sharedDeckTabs.addEventListener('click', async (event) => {
        await onSharedDeckTabClick(event);
    });
    applyDeckChangesBtn.addEventListener('click', async () => {
        await applyDeckMembershipChanges();
    });
    mixBarEl.addEventListener('pointerdown', onMixBarPointerDown);
    cardsGrid.addEventListener('click', handleCardsGridClick);
    window.addEventListener('scroll', () => {
        maybeLoadMoreCards();
    });

    sessionSettingsForm.addEventListener('submit', async (event) => {
        event.preventDefault();
        try {
            await saveSessionSettings();
        } catch (error) {
            console.error('Error saving Chinese Character settings:', error);
            showError(error.message || 'Failed to save practice settings.');
        }
    });

    sessionCardCountInput.addEventListener('input', () => {
        renderMixEditor();
    });
    viewOrderSelect.addEventListener('change', () => {
        resetAndDisplayCards(currentCards);
    });
    cardSearchInput.addEventListener('input', () => {
        resetAndDisplayCards(currentCards);
    });

    addCardForm.addEventListener('submit', async (event) => {
        event.preventDefault();
        await addOrphanCards();
    });
    chineseCharInput.addEventListener('input', () => {
        updateAddReadingButtonCount();
    });
    if (addSiWuKuaiDuBtn) {
        addSiWuKuaiDuBtn.addEventListener('click', () => {
            window.open('/reading-preset-siwu-kuaidu.html', '_blank', 'noopener,noreferrer,width=920,height=840');
        });
    }
    if (addMaLiPingBtn) {
        addMaLiPingBtn.addEventListener('click', () => {
            window.open('/reading-preset-maliping.html', '_blank', 'noopener,noreferrer,width=980,height=860');
        });
    }

    updateAddReadingButtonCount();

    try {
        showError('');
        showSuccess('');
        await loadKidInfo();
        await loadSharedChineseCharacterDecks();
    } catch (error) {
        console.error('Error initializing Chinese Characters manage:', error);
        showError(error.message || 'Failed to load page.');
        kidNameEl.textContent = 'Chinese Characters Management';
    }
});
