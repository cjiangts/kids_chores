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
const sharedMathSessionCardCountInput = document.getElementById('sharedMathSessionCardCount');
const mixBarEl = document.getElementById('mixBar');
const mixRowsEl = document.getElementById('mixRows');
const mixEmptyEl = document.getElementById('mixEmpty');

const availableDecksEl = document.getElementById('availableDecks');
const availableEmptyEl = document.getElementById('availableEmpty');
const availableTagFilterInput = document.getElementById('availableTagFilter');
const availableTagOptions = document.getElementById('availableTagOptions');
const clearTagFilterBtn = document.getElementById('clearTagFilterBtn');
const selectedDecksEl = document.getElementById('selectedDecks');
const selectedEmptyEl = document.getElementById('selectedEmpty');
const applyDeckChangesBtn = document.getElementById('applyDeckChangesBtn');
const deckPendingInfo = document.getElementById('deckPendingInfo');
const sharedDeckTabs = document.getElementById('sharedDeckTabs');
const viewOrderSelect = document.getElementById('viewOrderSelect');
const deckTotalInfo = document.getElementById('deckTotalInfo');
const mathCardCount = document.getElementById('mathCardCount');
const cardsGrid = document.getElementById('cardsGrid');

let allDecks = [];
let orphanDeck = null;
let mixByDeckId = {};
let currentCards = [];
let sortedCards = [];
let visibleCardCount = 10;
let activeDeckId = null;
let activeDeckLabel = '';
let isDeckMoveInFlight = false;
let baselineOptedDeckIdSet = new Set();
let stagedOptedDeckIdSet = new Set();
let availableTagFilter = '';
const CARD_PAGE_SIZE = 10;

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

function getMathQuestionDecks() {
    const decks = getOptedDecks().map((deck) => ({
        local_deck_id: Number(deck.materialized_deck_id || 0),
        label: String(deck.name || ''),
    })).filter((deck) => deck.local_deck_id > 0);

    const orphanDeckId = Number(orphanDeck && orphanDeck.deck_id);
    const orphanCardCount = Number(orphanDeck && orphanDeck.card_count);
    if (orphanDeckId > 0 && orphanCardCount > 0) {
        decks.push({
            local_deck_id: orphanDeckId,
            label: String(orphanDeck.name || 'math_orphan'),
        });
    }

    return decks;
}

function normalizeMixForOptedDecks() {
    const optedDecks = getOptedDecks();
    if (optedDecks.length === 0) {
        mixByDeckId = {};
        return;
    }

    const deckIds = optedDecks.map((deck) => Number(deck.deck_id));
    const weights = deckIds.map((deckId) => {
        const raw = mixByDeckId[String(deckId)];
        const parsed = Number.parseInt(raw, 10);
        return Number.isInteger(parsed) && parsed > 0 ? parsed : 0;
    });
    const percents = distributeIntegerTotal(100, weights);

    const next = {};
    deckIds.forEach((deckId, index) => {
        next[String(deckId)] = percents[index];
    });
    mixByDeckId = next;
}

function getCountByDeckId(totalCards, optedDecks) {
    const deckIds = optedDecks.map((deck) => Number(deck.deck_id));
    const weights = deckIds.map((deckId) => Number.parseInt(mixByDeckId[String(deckId)] || 0, 10));
    const counts = distributeIntegerTotal(totalCards, weights);
    const map = {};
    deckIds.forEach((deckId, index) => {
        map[String(deckId)] = counts[index];
    });
    return map;
}

function setMixByDeckFromPercentArray(optedDecks, percents) {
    const next = {};
    optedDecks.forEach((deck, index) => {
        const deckId = String(Number(deck.deck_id));
        const value = Number.parseInt(percents[index], 10);
        next[deckId] = Number.isInteger(value) ? Math.max(0, Math.min(100, value)) : 0;
    });
    mixByDeckId = next;
}

function renderMixEditor() {
    const optedDecks = getOptedDecks();
    normalizeMixForOptedDecks();

    if (optedDecks.length === 0) {
        mixBarEl.innerHTML = '';
        mixRowsEl.innerHTML = '';
        mixEmptyEl.classList.remove('hidden');
        return;
    }

    mixEmptyEl.classList.add('hidden');
    const totalCards = Math.max(0, Number.parseInt(sharedMathSessionCardCountInput.value, 10) || 0);
    const countByDeckId = getCountByDeckId(totalCards, optedDecks);
    const percents = optedDecks.map((deck) => Number.parseInt(mixByDeckId[String(Number(deck.deck_id))] || 0, 10));

    let cumulative = 0;
    const segmentHtml = optedDecks
        .map((deck, index) => {
            const percent = percents[index];
            const color = MIX_COLORS[index % MIX_COLORS.length];
            return `<div class="mix-segment" style="width:${percent}%;background:${color};" title="${escapeHtml(deck.name || '')}: ${percent}%"></div>`;
        })
        .join('');
    const handleHtml = optedDecks
        .slice(0, -1)
        .map((_, index) => {
            cumulative += percents[index];
            return `<button type="button" class="mix-handle" data-handle-index="${index}" style="left:${cumulative}%;" aria-label="Adjust mix divider ${index + 1}"></button>`;
        })
        .join('');
    mixBarEl.innerHTML = `${segmentHtml}${handleHtml}`;

    mixRowsEl.innerHTML = optedDecks
        .map((deck, index) => {
            const percent = percents[index];
            const cards = Number.parseInt(countByDeckId[String(Number(deck.deck_id))] || 0, 10);
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
        })
        .join('');
}

function getPointerClientX(event) {
    if (Number.isFinite(event.clientX)) {
        return Number(event.clientX);
    }
    return null;
}

function onMixBarPointerDown(event) {
    const handle = event.target.closest('[data-handle-index]');
    if (!handle) {
        return;
    }
    const handleIndex = Number(handle.getAttribute('data-handle-index') || -1);
    if (!(handleIndex >= 0)) {
        return;
    }

    const optedDecks = getOptedDecks();
    if (optedDecks.length < 2 || handleIndex >= optedDecks.length - 1) {
        return;
    }
    normalizeMixForOptedDecks();

    const startX = getPointerClientX(event);
    const rect = mixBarEl.getBoundingClientRect();
    if (!Number.isFinite(startX) || rect.width <= 0) {
        return;
    }

    const startPercents = optedDecks.map((deck) => Number.parseInt(mixByDeckId[String(Number(deck.deck_id))] || 0, 10));
    const pairTotal = startPercents[handleIndex] + startPercents[handleIndex + 1];

    const onMove = (moveEvent) => {
        const moveX = getPointerClientX(moveEvent);
        if (!Number.isFinite(moveX)) {
            return;
        }
        const deltaPercent = ((moveX - startX) / rect.width) * 100;
        let nextLeft = startPercents[handleIndex] + deltaPercent;
        if (nextLeft < 0) {
            nextLeft = 0;
        }
        if (nextLeft > pairTotal) {
            nextLeft = pairTotal;
        }

        const next = [...startPercents];
        next[handleIndex] = Math.round(nextLeft);
        next[handleIndex + 1] = pairTotal - next[handleIndex];
        setMixByDeckFromPercentArray(optedDecks, next);
        renderMixEditor();
    };

    const onUp = () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        window.removeEventListener('pointercancel', onUp);
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    event.preventDefault();
}

function rebalanceAfterOptInChanges() {
    const optedDecks = getOptedDecks();
    if (optedDecks.length === 0) {
        mixByDeckId = {};
        return;
    }
    const weights = optedDecks.map((deck) => Number.parseInt(mixByDeckId[String(Number(deck.deck_id))] || 0, 10));
    const percents = distributeIntegerTotal(100, weights);
    const next = {};
    optedDecks.forEach((deck, index) => {
        next[String(Number(deck.deck_id))] = percents[index];
    });
    mixByDeckId = next;
}

function renderAvailableDecks() {
    const allAvailableDecks = (Array.isArray(allDecks) ? allDecks : []).filter(
        (deck) => !stagedOptedDeckIdSet.has(Number(deck.deck_id))
    );
    const deckList = allAvailableDecks.filter(matchesAvailableTagFilter);
    if (allAvailableDecks.length === 0) {
        availableDecksEl.innerHTML = '';
        availableEmptyEl.textContent = 'No shared math decks available yet.';
        availableEmptyEl.classList.remove('hidden');
        return;
    }
    if (deckList.length === 0) {
        availableDecksEl.innerHTML = '';
        availableEmptyEl.textContent = availableTagFilter
            ? `No available deck matches tag "${availableTagFilter}".`
            : 'No shared math decks available yet.';
        availableEmptyEl.classList.remove('hidden');
        return;
    }
    availableEmptyEl.classList.add('hidden');

    availableDecksEl.innerHTML = deckList
        .map((deck) => {
            const deckId = Number(deck.deck_id || 0);
            const classes = ['deck-bubble'];
            const suffix = ` · ${Number(deck.card_count || 0)} cards`;
            return `
                <button
                    type="button"
                    class="${classes.join(' ')}"
                    data-deck-id="${deckId}"
                    title="Click to stage opt-in"
                >${escapeHtml(deck.name || '')}${escapeHtml(suffix)}</button>
            `;
        })
        .join('');
}

function getDeckTags(deck) {
    return Array.isArray(deck.tags)
        ? deck.tags.map((tag) => String(tag || '').trim().toLowerCase()).filter(Boolean)
        : [];
}

function normalizeTagSearchToken(rawToken) {
    return String(rawToken || '')
        .trim()
        .toLowerCase()
        .replace(/\s+/g, '_');
}

function getAvailableTagTokens() {
    return String(availableTagFilter || '')
        .split(/[,\s]+/)
        .map(normalizeTagSearchToken)
        .filter(Boolean);
}

function matchesAvailableTagFilter(deck) {
    const tokens = getAvailableTagTokens();
    if (tokens.length === 0) {
        return true;
    }
    const tags = getDeckTags(deck);
    if (tags.length === 0) {
        return false;
    }
    return tokens.every((token) => tags.some((tag) => tag.includes(token)));
}

function renderAvailableTagSuggestions() {
    const tags = new Set();
    (Array.isArray(allDecks) ? allDecks : []).forEach((deck) => {
        getDeckTags(deck).forEach((tag) => {
            tags.add(tag);
        });
    });
    const ordered = Array.from(tags).sort((a, b) => a.localeCompare(b));
    availableTagOptions.innerHTML = ordered
        .map((tag) => `<option value="${escapeHtml(tag)}"></option>`)
        .join('');
}

function onAvailableTagFilterInput() {
    availableTagFilter = String(availableTagFilterInput.value || '')
        .trim()
        .toLowerCase();
    renderAvailableDecks();
}

function renderSelectedDecks() {
    const optedDecks = getOptedDecks();
    if (optedDecks.length === 0) {
        selectedDecksEl.innerHTML = '';
        selectedEmptyEl.classList.remove('hidden');
        return;
    }

    selectedEmptyEl.classList.add('hidden');
    selectedDecksEl.innerHTML = optedDecks
        .map((deck) => {
            const deckId = Number(deck.deck_id || 0);
            return `
                <button
                    type="button"
                    class="deck-bubble selected"
                    data-deck-id="${deckId}"
                    title="Click to stage opt-out"
                >${escapeHtml(deck.name || '')}</button>
            `;
        })
        .join('');
}


function renderSharedDeckTabs() {
    const questionDecks = getMathQuestionDecks();
    if (questionDecks.length === 0) {
        activeDeckId = null;
        activeDeckLabel = '';
        sharedDeckTabs.innerHTML = '';
        currentCards = [];
        resetAndDisplayCards(currentCards);
        if (mathCardCount) {
            mathCardCount.textContent = '(0)';
        }
        if (deckTotalInfo) {
            deckTotalInfo.textContent = 'Active cards in this deck: 0';
        }
        return;
    }

    const validIds = new Set(questionDecks.map((deck) => Number(deck.local_deck_id)));
    if (!Number.isInteger(activeDeckId) || !validIds.has(activeDeckId)) {
        activeDeckId = Number(questionDecks[0].local_deck_id);
    }

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


function displayCards(cards) {
    sortedCards = window.PracticeManageCommon.sortCardsForView(cards, viewOrderSelect.value);

    if (sortedCards.length === 0) {
        cardsGrid.innerHTML = `<div class="empty-state" style="grid-column: 1 / -1;"><h3>No cards in ${escapeHtml(activeDeckLabel || 'this deck')}</h3></div>`;
        return;
    }

    const visibleCards = sortedCards.slice(0, visibleCardCount);
    cardsGrid.innerHTML = visibleCards.map((card) => `
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
            <div class="card-back">= ${escapeHtml(card.back)}</div>
            ${card.skip_practice ? '<div class="skipped-note">Skipped from practice</div>' : ''}
            <div style="margin-top: 10px; color: #666; font-size: 0.85rem;">Hardness score: ${window.PracticeManageCommon.formatHardnessScore(card.hardness_score)}</div>
            <div style="margin-top: 4px; color: #666; font-size: 0.82rem;">Lifetime attempts: ${card.lifetime_attempts || 0}</div>
            <div style="margin-top: 4px; color: #666; font-size: 0.82rem;">Last seen: ${window.PracticeManageCommon.formatLastSeenDays(card.last_seen_at)}</div>
            <a
                class="card-report-link"
                href="/kid-card-report.html?id=${encodeURIComponent(kidId)}&cardId=${encodeURIComponent(card.id)}&from=math"
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


async function loadSharedDeckCards() {
    try {
        if (!Number.isInteger(activeDeckId) || activeDeckId <= 0) {
            currentCards = [];
            resetAndDisplayCards(currentCards);
            if (mathCardCount) {
                mathCardCount.textContent = '(0)';
            }
            if (deckTotalInfo) {
                deckTotalInfo.textContent = 'Active cards in this deck: 0';
            }
            return;
        }

        const response = await fetch(`${API_BASE}/kids/${kidId}/math/shared-decks/cards?deck_id=${encodeURIComponent(String(activeDeckId))}`);
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
            throw new Error(data.error || `Failed to load deck cards (HTTP ${response.status})`);
        }

        activeDeckLabel = String(data.deck_name || '');
        currentCards = Array.isArray(data.cards) ? data.cards : [];
        const activeCount = Number.isInteger(Number.parseInt(data.active_card_count, 10))
            ? Number.parseInt(data.active_card_count, 10)
            : currentCards.filter((card) => !card.skip_practice).length;
        const skippedCount = Number.isInteger(Number.parseInt(data.skipped_card_count, 10))
            ? Number.parseInt(data.skipped_card_count, 10)
            : currentCards.filter((card) => !!card.skip_practice).length;

        if (mathCardCount) {
            mathCardCount.textContent = `(${currentCards.length})`;
        }
        if (deckTotalInfo) {
            deckTotalInfo.textContent = `Active cards in this deck: ${activeCount} (Skipped: ${skippedCount})`;
        }
        resetAndDisplayCards(currentCards);
    } catch (error) {
        console.error('Error loading shared math cards:', error);
        showError(error.message || 'Failed to load shared math cards.');
    }
}


async function updateSharedMathCardSkip(cardId, skipped) {
    const response = await fetch(`${API_BASE}/kids/${kidId}/math/shared-decks/cards/${cardId}/skip`, {
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


async function handleCardsGridClick(event) {
    const actionBtn = event.target.closest('[data-action]');
    if (!actionBtn) {
        return;
    }
    const action = actionBtn.dataset.action;
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
        await updateSharedMathCardSkip(cardId, targetSkipped);
    } catch (error) {
        console.error('Error updating shared math card skip:', error);
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
    kidNameEl.textContent = `${kid.name || 'Kid'} - Math Management v2`;
    const total = Number.parseInt(kid.sharedMathSessionCardCount, 10);
    sharedMathSessionCardCountInput.value = String(Number.isInteger(total) ? total : 10);
}

async function loadSharedMathDecks() {
    const response = await fetch(`${API_BASE}/kids/${kidId}/math/shared-decks`);
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
    renderAvailableTagSuggestions();

    const responseTotal = Number.parseInt(result.session_card_count, 10);
    if (Number.isInteger(responseTotal)) {
        sharedMathSessionCardCountInput.value = String(responseTotal);
    }

    const responseMix = result && typeof result.shared_math_deck_mix === 'object' && result.shared_math_deck_mix
        ? result.shared_math_deck_mix
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

    const total = Number.parseInt(sharedMathSessionCardCountInput.value, 10);
    if (!Number.isInteger(total) || total < 0 || total > 200) {
        showError('Math cards per session must be between 0 and 200.');
        return;
    }

    normalizeMixForOptedDecks();
    const payloadMix = {};
    getOptedDecks().forEach((deck) => {
        const deckId = String(Number(deck.deck_id));
        payloadMix[deckId] = Number.parseInt(mixByDeckId[deckId] || 0, 10);
    });

    const response = await fetch(`${API_BASE}/kids/${kidId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            sharedMathSessionCardCount: total,
            sharedMathDeckMix: payloadMix,
        }),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
        throw new Error(result.error || `Failed to save settings (HTTP ${response.status})`);
    }

    showSuccess('Practice settings saved.');
    await loadSharedMathDecks();
}

async function requestOptInDeckIds(deckIds) {
    const response = await fetch(`${API_BASE}/kids/${kidId}/math/shared-decks/opt-in`, {
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
    const response = await fetch(`${API_BASE}/kids/${kidId}/math/shared-decks/opt-out`, {
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
        const summary = `Applied deck changes: ${toOptIn.length} opt-in, ${toOptOut.length} opt-out.`;
        showSuccess(summary);
        await loadSharedMathDecks();
    } catch (error) {
        console.error('Error applying deck membership changes:', error);
        showError(error.message || 'Failed to apply deck changes.');
    } finally {
        isDeckMoveInFlight = false;
        renderDeckPendingInfo();
    }
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
    mathTab.href = `/kid-math-manage-v2.html?id=${kidId}`;
    lessonReadingTab.href = `/kid-lesson-reading-manage.html?id=${kidId}`;

    availableDecksEl.addEventListener('click', async (event) => {
        await onAvailableDeckClick(event);
    });
    availableTagFilterInput.addEventListener('input', onAvailableTagFilterInput);
    clearTagFilterBtn.addEventListener('click', () => {
        availableTagFilter = '';
        availableTagFilterInput.value = '';
        renderAvailableDecks();
        availableTagFilterInput.focus();
    });
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
            console.error('Error saving shared math settings:', error);
            showError(error.message || 'Failed to save practice settings.');
        }
    });

    sharedMathSessionCardCountInput.addEventListener('input', () => {
        renderMixEditor();
    });
    viewOrderSelect.addEventListener('change', () => {
        resetAndDisplayCards(currentCards);
    });

    try {
        showError('');
        showSuccess('');
        await loadKidInfo();
        await loadSharedMathDecks();
    } catch (error) {
        console.error('Error initializing math manage v2:', error);
        showError(error.message || 'Failed to load page.');
        kidNameEl.textContent = 'Math Management v2';
    }
});
