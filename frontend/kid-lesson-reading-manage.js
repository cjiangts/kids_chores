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
const sharedLessonReadingSessionCardCountInput = document.getElementById('sharedLessonReadingSessionCardCount');
const sharedLessonReadingIncludeOrphanInput = document.getElementById('sharedLessonReadingIncludeOrphan');

const availableDecksEl = document.getElementById('availableDecks');
const availableEmptyEl = document.getElementById('availableEmpty');
const availableTagFilterInput = document.getElementById('availableTagFilter');
const clearTagFilterBtn = document.getElementById('clearTagFilterBtn');
const selectedDecksEl = document.getElementById('selectedDecks');
const selectedEmptyEl = document.getElementById('selectedEmpty');
const applyDeckChangesBtn = document.getElementById('applyDeckChangesBtn');
const deckPendingInfo = document.getElementById('deckPendingInfo');
const viewOrderSelect = document.getElementById('viewOrderSelect');
const deckTotalInfo = document.getElementById('deckTotalInfo');
const lessonReadingCardCount = document.getElementById('lessonReadingCardCount');
const cardsGrid = document.getElementById('cardsGrid');

let allDecks = [];
let orphanDeck = null;
let currentCards = [];
let sortedCards = [];
let visibleCardCount = 10;
let isDeckMoveInFlight = false;
let baselineOptedDeckIdSet = new Set();
let stagedOptedDeckIdSet = new Set();
let availableTagFilterController = null;
let includeOrphanInQueue = false;
const CARD_PAGE_SIZE = 10;

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

function renderAvailableDecks() {
    ensureAvailableTagFilterController().sync();
    const allAvailableDecks = (Array.isArray(allDecks) ? allDecks : []).filter(
        (deck) => !stagedOptedDeckIdSet.has(Number(deck.deck_id))
    );
    const deckList = allAvailableDecks.filter(matchesAvailableTagFilter);
    if (allAvailableDecks.length === 0) {
        availableDecksEl.innerHTML = '';
        availableEmptyEl.textContent = 'No shared Chinese Reading decks available yet.';
        availableEmptyEl.classList.remove('hidden');
        return;
    }
    if (deckList.length === 0) {
        availableDecksEl.innerHTML = '';
        const filterLabel = ensureAvailableTagFilterController().getDisplayLabel();
        availableEmptyEl.textContent = filterLabel
            ? `No available deck matches tag "${filterLabel}".`
            : 'No shared Chinese Reading decks available yet.';
        availableEmptyEl.classList.remove('hidden');
        return;
    }
    availableEmptyEl.classList.add('hidden');

    availableDecksEl.innerHTML = deckList
        .map((deck) => {
            const deckId = Number(deck.deck_id || 0);
            const classes = ['deck-bubble'];
            const suffix = ` · ${Number(deck.card_count || 0)} cards`;
            const label = getLessonReadingDeckBubbleLabel(deck);
            return `
                <button
                    type="button"
                    class="${classes.join(' ')}"
                    data-deck-id="${deckId}"
                    title="Click to stage opt-in"
                >${escapeHtml(label)}${escapeHtml(suffix)}</button>
            `;
        })
        .join('');
}

function getDeckTags(deck) {
    return Array.isArray(deck.tags)
        ? deck.tags.map((tag) => String(tag || '').trim().toLowerCase()).filter(Boolean)
        : [];
}

function stripLessonReadingFirstTagFromName(name) {
    const text = String(name || '').trim();
    if (!text) {
        return '';
    }
    if (text === 'chinese_reading') {
        return '';
    }
    if (text.startsWith('chinese_reading_')) {
        return text.slice('chinese_reading_'.length);
    }
    return text;
}

function getLessonReadingDeckBubbleLabel(deck) {
    const tags = getDeckTags(deck);
    if (tags.length > 1 && tags[0] === 'chinese_reading') {
        return tags.slice(1).join('_');
    }
    const stripped = stripLessonReadingFirstTagFromName(deck && deck.name);
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

function renderSelectedDecks() {
    const optedDecks = getOptedDecks();
    const orphanNameRaw = String(orphanDeck && orphanDeck.name ? orphanDeck.name : 'chinese_reading_orphan');
    const orphanName = stripLessonReadingFirstTagFromName(orphanNameRaw) || orphanNameRaw;
    const orphanCount = Number(orphanDeck && orphanDeck.card_count ? orphanDeck.card_count : 0);

    const optedDeckButtons = optedDecks.map((deck) => {
            const deckId = Number(deck.deck_id || 0);
            const suffix = ` · ${Number(deck.card_count || 0)} cards`;
            const label = getLessonReadingDeckBubbleLabel(deck);
            return `
                <button
                    type="button"
                    class="deck-bubble selected"
                    data-deck-id="${deckId}"
                    title="Click to stage opt-out"
                >${escapeHtml(label)}${escapeHtml(suffix)}</button>
            `;
        });

    const orphanButton = `
        <button
            type="button"
            class="deck-bubble selected"
            disabled
            title="Orphan deck is always shown here and cannot be opted out. Use Practice Settings to include/exclude it from the practice queue."
        >${escapeHtml(orphanName)}${escapeHtml(` · ${orphanCount} cards`)}</button>
    `;

    selectedDecksEl.innerHTML = [orphanButton, ...optedDeckButtons].join('');
    selectedEmptyEl.classList.add('hidden');
}

function splitLessonFront(rawFront) {
    const text = String(rawFront || '').trim();
    if (!text) {
        return { week: '', title: '' };
    }
    const tokens = text.split(/\s+/).map((v) => v.trim()).filter(Boolean);
    if (tokens.length >= 2) {
        const week = tokens[0].replace(/[：:、，,]+$/g, '');
        if (/^第[一二三四五六七八九十百千0-9]+周$/.test(week)) {
            return { week, title: tokens.slice(1).join(' ') };
        }
    }
    return { week: '', title: text };
}

function displayCards(cards) {
    sortedCards = window.PracticeManageCommon.sortCardsForView(cards, viewOrderSelect.value);

    if (sortedCards.length === 0) {
        cardsGrid.innerHTML = `<div class="empty-state" style="grid-column: 1 / -1;"><h3>No cards in merged bank</h3></div>`;
        return;
    }

    const visibleCards = sortedCards.slice(0, visibleCardCount);
    cardsGrid.innerHTML = visibleCards.map((card) => {
        const frontParts = splitLessonFront(card.front);
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
            ${frontParts.week ? `<div style="margin-bottom: 4px; color: #888; font-size: 0.8rem;">${escapeHtml(frontParts.week)}</div>` : ''}
            <div class="card-front">${escapeHtml(frontParts.title)}</div>
            <div class="card-back">Page ${escapeHtml(card.back)}</div>
            <div style="margin-top: 4px; color: #666; font-size: 0.82rem;">Source: ${escapeHtml(card.source_deck_label || card.source_deck_name || '-')}</div>
            ${card.skip_practice ? '<div class="skipped-note">Skipped from practice</div>' : ''}
            <div style="margin-top: 4px; color: #666; font-size: 0.82rem;">Lifetime attempts: ${card.lifetime_attempts || 0}</div>
            <div style="margin-top: 4px; color: #666; font-size: 0.82rem;">Last seen: ${window.PracticeManageCommon.formatLastSeenDays(card.last_seen_at)}</div>
            <a
                class="card-report-link"
                href="/kid-card-report.html?id=${encodeURIComponent(kidId)}&cardId=${encodeURIComponent(card.id)}&from=lesson-reading"
            >Report</a>
        </div>
    `;
    }).join('');
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
        const response = await fetch(`${API_BASE}/kids/${kidId}/lesson-reading/shared-decks/cards`);
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
            throw new Error(data.error || `Failed to load merged cards (HTTP ${response.status})`);
        }

        currentCards = Array.isArray(data.cards) ? data.cards : [];
        const activeCount = Number.isInteger(Number.parseInt(data.active_card_count, 10))
            ? Number.parseInt(data.active_card_count, 10)
            : currentCards.filter((card) => !card.skip_practice).length;
        const skippedCount = Number.isInteger(Number.parseInt(data.skipped_card_count, 10))
            ? Number.parseInt(data.skipped_card_count, 10)
            : currentCards.filter((card) => !!card.skip_practice).length;

        if (lessonReadingCardCount) {
            lessonReadingCardCount.textContent = `(${currentCards.length})`;
        }
        if (deckTotalInfo) {
            const practiceActiveCount = Number.isInteger(Number.parseInt(data.practice_active_card_count, 10))
                ? Number.parseInt(data.practice_active_card_count, 10)
                : activeCount;
            deckTotalInfo.textContent = `Active cards in merged bank: ${activeCount} (Skipped: ${skippedCount}) · In practice queue pool: ${practiceActiveCount}`;
        }
        resetAndDisplayCards(currentCards);
    } catch (error) {
        console.error('Error loading shared Chinese Reading cards:', error);
        showError(error.message || 'Failed to load shared Chinese Reading cards.');
    }
}


async function updateSharedLessonReadingCardSkip(cardId, skipped) {
    const response = await fetch(`${API_BASE}/kids/${kidId}/lesson-reading/shared-decks/cards/${cardId}/skip`, {
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
        await updateSharedLessonReadingCardSkip(cardId, targetSkipped);
    } catch (error) {
        console.error('Error updating shared Chinese Reading card skip:', error);
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
    kidNameEl.textContent = `${kid.name || 'Kid'} - Chinese Reading Management`;
    const total = Number.parseInt(kid.sharedLessonReadingSessionCardCount, 10);
    sharedLessonReadingSessionCardCountInput.value = String(Number.isInteger(total) ? total : 0);
    if (sharedLessonReadingIncludeOrphanInput) {
        sharedLessonReadingIncludeOrphanInput.checked = Boolean(kid.sharedLessonReadingIncludeOrphan);
    }
}

async function loadSharedLessonReadingDecks() {
    const response = await fetch(`${API_BASE}/kids/${kidId}/lesson-reading/shared-decks`);
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
        sharedLessonReadingSessionCardCountInput.value = String(responseTotal);
    }
    includeOrphanInQueue = Boolean(result && result.include_orphan_in_queue);
    if (sharedLessonReadingIncludeOrphanInput) {
        sharedLessonReadingIncludeOrphanInput.checked = includeOrphanInQueue;
    }

    renderAvailableDecks();
    renderSelectedDecks();
    renderDeckPendingInfo();
    await loadSharedDeckCards();
}

async function saveSessionSettings() {
    showError('');
    showSuccess('');

    const total = Number.parseInt(sharedLessonReadingSessionCardCountInput.value, 10);
    if (!Number.isInteger(total) || total < 0 || total > 200) {
        showError('Chinese Reading cards per session must be between 0 and 200.');
        return;
    }
    const includeOrphan = Boolean(sharedLessonReadingIncludeOrphanInput && sharedLessonReadingIncludeOrphanInput.checked);

    const response = await fetch(`${API_BASE}/kids/${kidId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            sharedLessonReadingSessionCardCount: total,
            sharedLessonReadingIncludeOrphan: includeOrphan,
        }),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
        throw new Error(result.error || `Failed to save settings (HTTP ${response.status})`);
    }

    showSuccess('Practice settings saved.');
    includeOrphanInQueue = includeOrphan;
    await loadSharedLessonReadingDecks();
}

async function requestOptInDeckIds(deckIds) {
    const response = await fetch(`${API_BASE}/kids/${kidId}/lesson-reading/shared-decks/opt-in`, {
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
    const response = await fetch(`${API_BASE}/kids/${kidId}/lesson-reading/shared-decks/opt-out`, {
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
    renderAvailableDecks();
    renderSelectedDecks();
    renderDeckPendingInfo();
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
        await loadSharedLessonReadingDecks();
    } catch (error) {
        console.error('Error applying deck membership changes:', error);
        showError(error.message || 'Failed to apply deck changes.');
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
    applyDeckChangesBtn.addEventListener('click', async () => {
        await applyDeckMembershipChanges();
    });
    cardsGrid.addEventListener('click', handleCardsGridClick);
    window.addEventListener('scroll', () => {
        maybeLoadMoreCards();
    });

    sessionSettingsForm.addEventListener('submit', async (event) => {
        event.preventDefault();
        try {
            await saveSessionSettings();
        } catch (error) {
            console.error('Error saving shared Chinese Reading settings:', error);
            showError(error.message || 'Failed to save practice settings.');
        }
    });
    viewOrderSelect.addEventListener('change', () => {
        resetAndDisplayCards(currentCards);
    });

    try {
        showError('');
        showSuccess('');
        await loadKidInfo();
        await loadSharedLessonReadingDecks();
    } catch (error) {
        console.error('Error initializing Chinese Reading manage:', error);
        showError(error.message || 'Failed to load page.');
        kidNameEl.textContent = 'Chinese Reading Management';
    }
});
