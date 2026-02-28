const API_BASE = `${window.location.origin}/api`;

const params = new URLSearchParams(window.location.search);
const kidId = params.get('id');

const kidNameEl = document.getElementById('kidName');
const errorMessage = document.getElementById('errorMessage');
const successMessage = document.getElementById('successMessage');
const bulkImportForm = document.getElementById('bulkImportForm');
const bulkWritingText = document.getElementById('bulkWritingText');
const bulkAddBtn = document.getElementById('bulkAddBtn');
const bulkImportErrorMessage = document.getElementById('bulkImportErrorMessage');
const sheetErrorMessage = document.getElementById('sheetErrorMessage');
const sessionSettingsForm = document.getElementById('sessionSettingsForm');
const sessionCardCountInput = document.getElementById('sessionCardCount');
const sharedWritingIncludeOrphanInput = document.getElementById('sharedWritingIncludeOrphan');
const sheetCardCountInput = document.getElementById('sheetCardCount');
const sheetRowsPerCharInput = document.getElementById('sheetRowsPerChar');
const createSheetBtn = document.getElementById('createSheetBtn');
const viewSheetsBtn = document.getElementById('viewSheetsBtn');
const practicingDeckCount = document.getElementById('practicingDeckCount');
const practicingDeckGrid = document.getElementById('practicingDeckGrid');
const practicingDeckEmpty = document.getElementById('practicingDeckEmpty');
const pendingSheetCardsGrid = document.getElementById('pendingSheetCardsGrid');
const pendingSheetCardsEmpty = document.getElementById('pendingSheetCardsEmpty');
const viewOrderSelect = document.getElementById('viewOrderSelect');
const cardSearchInput = document.getElementById('cardSearchInput');
const cardCount = document.getElementById('cardCount');
const cardsGrid = document.getElementById('cardsGrid');
const deckTotalInfo = document.getElementById('deckTotalInfo');
const charactersTab = document.getElementById('charactersTab');
const writingTab = document.getElementById('writingTab');
const mathTab = document.getElementById('mathTab');
const lessonReadingTab = document.getElementById('lessonReadingTab');

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

let currentCards = [];
let state2Cards = [];
let state3Cards = [];
let sortedCards = [];
let visibleCardCount = 10;
const CARD_PAGE_SIZE = 10;
const WRITING_SHEET_MAX_ROWS = 10;

let allDecks = [];
let orphanDeck = null;
let baselineOptedDeckIdSet = new Set();
let stagedOptedDeckIdSet = new Set();
let includeOrphanInQueue = false;
let isDeckMoveInFlight = false;
let availableTagFilterController = null;
let optInAllAvailableController = null;

let isWritingBulkAdding = false;
const previewPlayer = window.WritingAudioSequence.createPlayer({
    preload: 'auto',
    onError: (error) => {
        console.error('Error playing writing preview audio:', error);
        const detail = String(error?.message || '').trim();
        showError(detail ? `Failed to play voice prompt: ${detail}` : 'Failed to play voice prompt');
    }
});

function escapeHtml(value) {
    const div = document.createElement('div');
    div.textContent = String(value ?? '');
    return div.innerHTML;
}

function escapeAttr(value) {
    return String(value || '')
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
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

function showPageSuccess(message) {
    if (!successMessage) {
        return;
    }
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

function renderDeckPendingInfo() {
    if (!deckPendingInfo || !applyDeckChangesBtn) {
        return;
    }

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
        if (optInAllAvailableController) {
            optInAllAvailableController.render();
        }
        return;
    }

    deckPendingInfo.textContent = `Pending: ${toOptIn.length} opt-in, ${toOptOut.length} opt-out.`;
    applyDeckChangesBtn.disabled = isDeckMoveInFlight;
    applyDeckChangesBtn.textContent = isDeckMoveInFlight ? 'Applying...' : 'Apply Deck Changes';
    if (optInAllAvailableController) {
        optInAllAvailableController.render();
    }
}

function getDeckTags(deck) {
    return Array.isArray(deck.tags)
        ? deck.tags.map((tag) => String(tag || '').trim().toLowerCase()).filter(Boolean)
        : [];
}

function stripWritingFirstTagFromName(name) {
    const text = String(name || '').trim();
    if (!text) {
        return '';
    }
    if (text === 'chinese_writing') {
        return '';
    }
    if (text.startsWith('chinese_writing_')) {
        return text.slice('chinese_writing_'.length);
    }
    return text;
}

function getWritingDeckBubbleLabel(deck) {
    const tags = getDeckTags(deck);
    if (tags.length > 1 && tags[0] === 'chinese_writing') {
        return tags.slice(1).join('_');
    }
    const stripped = stripWritingFirstTagFromName(deck && deck.name);
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
    if (!window.PracticeManageCommon || typeof window.PracticeManageCommon.createHierarchicalTagFilterController !== 'function') {
        availableTagFilterController = {
            sync: () => {},
            matchesDeck: () => true,
            getDisplayLabel: () => '',
        };
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
    showPageSuccess('');
    showDeckChangeMessage('');
}

async function refreshDeckSelectionViews() {
    renderAvailableDecks();
    renderSelectedDecks();
    renderDeckPendingInfo();
}

function renderAvailableDecks() {
    if (!availableDecksEl || !availableEmptyEl) {
        return;
    }

    ensureAvailableTagFilterController().sync();
    const allAvailableDecks = getAvailableDeckCandidatesForTagFilter();
    const deckList = allAvailableDecks.filter(matchesAvailableTagFilter);
    if (availableDecksTitle) {
        availableDecksTitle.textContent = `Available Shared Decks (${deckList.length})`;
    }
    if (optInAllAvailableController) {
        optInAllAvailableController.render(deckList.length);
    }
    window.PracticeManageCommon.renderLimitedAvailableDecks({
        containerEl: availableDecksEl,
        emptyEl: availableEmptyEl,
        allAvailableDecks,
        filteredDecks: deckList,
        emptyText: 'No shared Chinese Writing decks available yet.',
        filterLabel: ensureAvailableTagFilterController().getDisplayLabel(),
        getLabel: getWritingDeckBubbleLabel,
        bubbleTitle: 'Click to stage opt-in',
        maxVisibleCount: 10,
    });
}

function renderSelectedDecks() {
    if (!selectedDecksEl || !selectedEmptyEl) {
        return;
    }

    const optedDecks = getOptedDecks();
    if (selectedDecksTitle) {
        selectedDecksTitle.textContent = `Opted-in Decks (${optedDecks.length})`;
    }
    const orphanNameRaw = String(orphanDeck && orphanDeck.name ? orphanDeck.name : 'chinese_writing_orphan');
    const orphanName = stripWritingFirstTagFromName(orphanNameRaw) || orphanNameRaw;
    const orphanCount = Number(orphanDeck && orphanDeck.card_count ? orphanDeck.card_count : 0);

    const optedDeckButtons = optedDecks.map((deck) => {
        const deckId = Number(deck.deck_id || 0);
        const suffix = ` · ${Number(deck.card_count || 0)} cards`;
        const label = getWritingDeckBubbleLabel(deck);
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

async function requestOptInDeckIds(deckIds) {
    const response = await fetch(`${API_BASE}/kids/${kidId}/writing/shared-decks/opt-in`, {
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
    const response = await fetch(`${API_BASE}/kids/${kidId}/writing/shared-decks/opt-out`, {
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

    clearDeckSelectionMessages();
    await refreshDeckSelectionViews();
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
    showPageSuccess('');
    showDeckChangeMessage('');
    try {
        if (toOptIn.length > 0) {
            await requestOptInDeckIds(toOptIn);
        }
        if (toOptOut.length > 0) {
            await requestOptOutDeckIds(toOptOut);
        }
        const summary = `Applied deck changes: ${toOptIn.length} opt-in, ${toOptOut.length} opt-out.`;
        showDeckChangeMessage(summary);
        await loadSharedWritingDecks();
    } catch (error) {
        console.error('Error applying deck membership changes:', error);
        showDeckChangeMessage(error.message || 'Failed to apply deck changes.', true);
    } finally {
        isDeckMoveInFlight = false;
        renderDeckPendingInfo();
    }
}

async function loadKidInfo() {
    try {
        const response = await fetch(`${API_BASE}/kids/${kidId}`);
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }

        const kid = await response.json();
        kidNameEl.textContent = `${kid.name}'s Chinese Character Writing`;
        const writingCount = Number.isInteger(Number.parseInt(kid.writingSessionCardCount, 10))
            ? Number.parseInt(kid.writingSessionCardCount, 10)
            : 0;
        sessionCardCountInput.value = writingCount;
        sheetCardCountInput.value = writingCount;
        if (sharedWritingIncludeOrphanInput) {
            sharedWritingIncludeOrphanInput.checked = Boolean(kid.sharedWritingIncludeOrphan);
        }
    } catch (error) {
        console.error('Error loading kid:', error);
        showError('Failed to load kid information');
    }
}

async function loadSharedWritingDecks() {
    const response = await fetch(`${API_BASE}/kids/${kidId}/writing/shared-decks`);
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
    includeOrphanInQueue = Boolean(result && result.include_orphan_in_queue);
    if (sharedWritingIncludeOrphanInput) {
        sharedWritingIncludeOrphanInput.checked = includeOrphanInQueue;
    }

    renderAvailableDecks();
    renderSelectedDecks();
    renderDeckPendingInfo();
    await loadWritingCards();
}

async function saveSessionSettings() {
    try {
        const value = Number.parseInt(sessionCardCountInput.value, 10);
        if (!Number.isInteger(value) || value < 0 || value > 200) {
            showError('Session size must be between 0 and 200');
            return;
        }
        const includeOrphan = Boolean(sharedWritingIncludeOrphanInput && sharedWritingIncludeOrphanInput.checked);

        const response = await fetch(`${API_BASE}/kids/${kidId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                writingSessionCardCount: value,
                sharedWritingIncludeOrphan: includeOrphan,
            }),
        });

        if (!response.ok) {
            const payload = await response.json().catch(() => ({}));
            throw new Error(payload.error || `HTTP ${response.status}`);
        }

        const updatedKid = await response.json();
        const updatedWritingCount = Number.isInteger(Number.parseInt(updatedKid.writingSessionCardCount, 10))
            ? Number.parseInt(updatedKid.writingSessionCardCount, 10)
            : value;
        sessionCardCountInput.value = updatedWritingCount;
        sheetCardCountInput.value = updatedWritingCount;
        includeOrphanInQueue = includeOrphan;
        showError('');
        showPageSuccess('Practice settings saved.');
        await loadSharedWritingDecks();
    } catch (error) {
        console.error('Error saving session settings:', error);
        showError(error.message || 'Failed to save practice settings');
    }
}

async function loadWritingCards() {
    try {
        showError('');
        const response = await fetch(`${API_BASE}/kids/${kidId}/writing/shared-decks/cards`);
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
            throw new Error(data.error || `Failed to load merged cards (HTTP ${response.status})`);
        }

        currentCards = Array.isArray(data.cards) ? data.cards : [];
        state2Cards = Array.isArray(data.practicing_cards) ? data.practicing_cards : [];
        state3Cards = Array.isArray(data.practicing_sheet_cards) ? data.practicing_sheet_cards : [];
        const activeCount = Number.isInteger(Number.parseInt(data.active_card_count, 10))
            ? Number.parseInt(data.active_card_count, 10)
            : currentCards.filter((card) => !card.skip_practice).length;
        const skippedCount = Number.isInteger(Number.parseInt(data.skipped_card_count, 10))
            ? Number.parseInt(data.skipped_card_count, 10)
            : currentCards.filter((card) => !!card.skip_practice).length;
        const practiceActiveCount = Number.isInteger(Number.parseInt(data.practice_active_card_count, 10))
            ? Number.parseInt(data.practice_active_card_count, 10)
            : activeCount;

        if (cardCount) {
            cardCount.textContent = `(${currentCards.length})`;
        }
        if (deckTotalInfo) {
            deckTotalInfo.textContent = `Active cards in merged bank: ${activeCount} (Skipped: ${skippedCount}) · In daily practice pool: ${practiceActiveCount}`;
        }

        applySuggestedSheetInputs();
        renderPracticingDeck();
        renderPendingSheetCards();
        resetAndDisplayCards(currentCards);
    } catch (error) {
        console.error('Error loading writing cards:', error);
        showError(error.message || 'Failed to load Chinese writing cards');
    }
}

function applySuggestedSheetInputs() {
    if (!sheetCardCountInput || !sheetRowsPerCharInput) {
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

async function bulkImportWritingCards() {
    if (isWritingBulkAdding) {
        return;
    }
    try {
        setWritingBulkAddBusy(true);
        showBulkImportError('');
        const rawText = String(bulkWritingText.value || '').trim();
        if (!rawText) {
            showBulkImportError('Please paste Chinese words/phrases first');
            return;
        }

        const response = await fetch(`${API_BASE}/kids/${kidId}/writing/cards/bulk`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text: rawText })
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
            throw new Error(payload.error || `HTTP ${response.status}`);
        }

        const inserted = Number(payload.inserted_count || 0);
        const skipped = Number(payload.skipped_existing_count || 0);
        bulkWritingText.value = '';
        updateBulkAddButtonCount();
        await loadSharedWritingDecks();
        showBulkImportError(`Added ${inserted} new card(s). Skipped ${skipped} existing card(s).`, false);
    } catch (error) {
        console.error('Error bulk importing writing cards:', error);
        showBulkImportError(error.message || 'Failed to bulk import writing cards');
    } finally {
        setWritingBulkAddBusy(false);
    }
}

function updateBulkAddButtonCount() {
    if (isWritingBulkAdding) {
        bulkAddBtn.textContent = 'Adding...';
        return;
    }
    const totalTokens = countWritingTokensBeforeDbDedup(bulkWritingText.value);
    if (totalTokens > 0) {
        bulkAddBtn.textContent = `Bulk Add Chinese Writing Prompt (${totalTokens})`;
        return;
    }
    bulkAddBtn.textContent = 'Bulk Add Chinese Writing Prompt';
}

function setWritingBulkAddBusy(isBusy) {
    isWritingBulkAdding = !!isBusy;
    if (bulkAddBtn) {
        bulkAddBtn.disabled = isWritingBulkAdding;
    }
    if (bulkWritingText) {
        bulkWritingText.disabled = isWritingBulkAdding;
    }
    updateBulkAddButtonCount();
}

function countWritingTokensBeforeDbDedup(text) {
    const matches = String(text || '').match(/[\u3400-\u9FFF\uF900-\uFAFF]+/g);
    return matches ? matches.length : 0;
}

async function createAndPrintSheet() {
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
            // continue
        }

        const count = Number.parseInt(sheetCardCountInput.value, 10);
        const rowsPerCharacter = Number.parseInt(sheetRowsPerCharInput.value, 10);
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

        const response = await fetch(`${API_BASE}/kids/${kidId}/writing/sheets/preview`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ count, rows_per_character: rowsPerCharacter })
        });
        if (!response.ok) {
            const payload = await response.json().catch(() => ({}));
            throw new Error(payload.error || `HTTP ${response.status}`);
        }

        const result = await response.json();
        if (!result.preview || !Array.isArray(result.cards) || result.cards.length === 0) {
            const msg = result.message || 'No eligible cards to print right now';
            showSheetError(msg);
            return;
        }

        const previewKey = `writing_sheet_preview_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
        const previewPayload = {
            kidId: String(kidId),
            rows_per_character: rowsPerCharacter,
            cards: result.cards,
            created_at: new Date().toISOString()
        };
        localStorage.setItem(previewKey, JSON.stringify(previewPayload));

        const printUrl = `/writing-sheet-print.html?id=${kidId}&previewKey=${encodeURIComponent(previewKey)}`;
        previewWindow.location.href = printUrl;
    } catch (error) {
        console.error('Error creating writing sheet:', error);
        if (previewWindow && !previewWindow.closed) {
            previewWindow.close();
        }
        showSheetError(error.message || 'Failed to generate practice sheet preview');
    }
}

function viewSheets() {
    window.location.href = `/kid-writing-sheets.html?id=${kidId}`;
}

async function deleteWritingCard(cardId) {
    try {
        const result = await window.PracticeManageCommon.requestWithPasswordDialog(
            'deleting this Chinese writing card',
            (password) => fetch(`${API_BASE}/kids/${kidId}/writing/cards/${cardId}`, {
                method: 'DELETE',
                headers: window.PracticeManageCommon.buildPasswordHeaders(password, false),
            })
        );
        if (result.cancelled) {
            return;
        }
        if (!result.ok) {
            throw new Error(result.error || 'Failed to delete Chinese writing card.');
        }

        await loadSharedWritingDecks();
    } catch (error) {
        console.error('Error deleting writing card:', error);
        showError(error.message || 'Failed to delete Chinese writing card');
    }
}

async function editWritingCardPrompt(cardId) {
    try {
        const targetCard = currentCards.find((card) => String(card.id) === String(cardId));
        if (!targetCard) {
            showError('Writing card not found.');
            return;
        }
        if (!targetCard.source_is_orphan) {
            showError('Only orphan writing cards can be edited here.');
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

        const response = await fetch(`${API_BASE}/kids/${kidId}/writing/cards/${encodeURIComponent(cardId)}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ front: nextFront })
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
            throw new Error(payload.error || `HTTP ${response.status}`);
        }

        await loadSharedWritingDecks();
    } catch (error) {
        console.error('Error updating writing card front:', error);
        showError(error.message || 'Failed to update voice prompt');
    }
}

async function updateSharedWritingCardSkip(cardId, skipped) {
    const response = await fetch(`${API_BASE}/kids/${kidId}/writing/shared-decks/cards/${cardId}/skip`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ skipped })
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
        throw new Error(result.error || `Failed to update skip (HTTP ${response.status})`);
    }
    await loadWritingCards();
    showError('');
}

function renderPracticingDeck() {
    if (!practicingDeckGrid || !practicingDeckEmpty || !practicingDeckCount) {
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

function displayCards(cards) {
    const filteredCards = filterCardsByQuery(cards, cardSearchInput.value);
    const sortMode = viewOrderSelect.value;
    sortedCards = window.PracticeManageCommon.sortCardsForView(filteredCards, sortMode);
    cardCount.textContent = `(${sortedCards.length})`;

    if (sortedCards.length === 0) {
        cardsGrid.innerHTML = '<div class="empty-state" style="grid-column: 1 / -1;"><h3>No Chinese writing cards yet</h3><p>Opt in shared decks or bulk add orphan cards above first.</p></div>';
        return;
    }

    const visibleCards = sortedCards.slice(0, visibleCardCount);

    cardsGrid.innerHTML = visibleCards.map((card) => {
        const hasSavedAudio = !!card.audio_url;
        const isOrphan = Boolean(card.source_is_orphan);
        const skipEnabled = !card.skip_practice;
        const cardLabel = card.back || card.front || '';
        const promptLabel = card.front || card.back || '';
        const sourceLabel = card.source_deck_label || card.source_deck_name || '-';

        return `
            <div class="card-item ${card.skip_practice ? 'skipped' : ''}">
                ${isOrphan ? `
                    <button
                        type="button"
                        class="delete-card-btn"
                        data-action="delete-card"
                        data-card-id="${escapeAttr(card.id)}"
                        title="Delete this Chinese writing card"
                        aria-label="Delete this card"
                    >x</button>
                ` : ''}
                <button
                    type="button"
                    class="skip-toggle-btn ${card.skip_practice ? 'on' : 'off'}"
                    data-action="toggle-skip"
                    data-card-id="${escapeAttr(card.id)}"
                    data-skipped="${card.skip_practice ? 'true' : 'false'}"
                    title="${card.skip_practice ? 'Turn skip off for this card' : 'Mark this card as skipped'}"
                    aria-label="${card.skip_practice ? 'Skip is on' : 'Skip is off'}"
                >Skip ${skipEnabled ? 'OFF' : 'ON'}</button>
                <div class="card-front">${escapeHtml(cardLabel)}</div>
                <div style="margin-top: 6px; color: #555; font-size: 0.84rem;">
                    Prompt: ${escapeHtml(promptLabel)}
                </div>
                <div style="margin-top: 4px; color: #666; font-size: 0.82rem;">Source: ${escapeHtml(sourceLabel)}</div>
                <div class="selected-audio-bar">
                    <div class="selected-audio-title">Audio</div>
                    <div class="selected-audio-actions">
                        <button
                            type="button"
                            class="selected-audio-btn edit"
                            data-action="edit-front"
                            data-card-id="${escapeAttr(card.id)}"
                            ${isOrphan ? '' : 'disabled title="Shared cards are read-only here"'}
                        >Edit Prompt</button>
                        <button
                            type="button"
                            class="selected-audio-btn save"
                            data-action="load-play-audio"
                            data-card-id="${escapeAttr(card.id)}"
                        >Load/Play</button>
                    </div>
                </div>
                ${hasSavedAudio ? '' : '<div style="margin-top: 4px; color: #9a5a00; font-size: 0.8rem;">Will auto-generate on first play</div>'}
                ${card.skip_practice ? '<div class="skipped-note">Skipped from practice</div>' : ''}
                ${isOrphan ? '' : '<div style="margin-top: 4px; color: #666; font-size: 0.8rem;">Shared source card (edit/delete in source deck)</div>'}
                <div style="margin-top: 10px; color: #666; font-size: 0.85rem;">Hardness score: ${window.PracticeManageCommon.formatHardnessScore(card.hardness_score)}</div>
                <div style="margin-top: 4px; color: #888; font-size: 0.8rem;">Added: ${window.PracticeManageCommon.formatAddedDate(card.created_at)}</div>
                <div style="margin-top: 4px; color: #666; font-size: 0.82rem;">Lifetime attempts: ${card.lifetime_attempts || 0}</div>
                <div style="margin-top: 4px; color: #666; font-size: 0.82rem;">Last seen: ${window.PracticeManageCommon.formatLastSeenDays(card.last_seen_at)}</div>
                <div class="card-actions">
                    <a
                        class="card-report-link"
                        href="/kid-card-report.html?id=${encodeURIComponent(kidId)}&cardId=${encodeURIComponent(card.id)}&from=writing"
                    >Report</a>
                </div>
            </div>
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
        const source = String(card.source_deck_label || card.source_deck_name || '');
        return front.includes(query) || back.includes(query) || source.includes(query);
    });
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

function showError(message) {
    if (message) {
        const text = String(message);
        if (errorMessage) {
            errorMessage.textContent = '';
            errorMessage.classList.add('hidden');
        }
        if (showError._lastMessage !== text) {
            window.alert(text);
            showError._lastMessage = text;
        }
    } else {
        showError._lastMessage = '';
        if (errorMessage) {
            errorMessage.classList.add('hidden');
        }
    }
}

function showSheetError(message) {
    if (!sheetErrorMessage) {
        return;
    }
    if (message) {
        const text = String(message);
        sheetErrorMessage.textContent = '';
        sheetErrorMessage.classList.add('hidden');
        if (showSheetError._lastMessage !== text) {
            window.alert(text);
            showSheetError._lastMessage = text;
        }
    } else {
        showSheetError._lastMessage = '';
        sheetErrorMessage.classList.add('hidden');
    }
}

function showBulkImportError(message, isError = true) {
    if (!bulkImportErrorMessage) {
        return;
    }
    if (message) {
        const text = String(message);
        if (isError) {
            bulkImportErrorMessage.textContent = '';
            bulkImportErrorMessage.classList.add('hidden');
            if (showBulkImportError._lastMessage !== text) {
                window.alert(text);
                showBulkImportError._lastMessage = text;
            }
        } else {
            bulkImportErrorMessage.textContent = text;
            bulkImportErrorMessage.classList.remove('hidden');
            bulkImportErrorMessage.style.background = '#d4edda';
            bulkImportErrorMessage.style.color = '#155724';
            bulkImportErrorMessage.style.border = '1px solid #c3e6cb';
        }
    } else {
        showBulkImportError._lastMessage = '';
        bulkImportErrorMessage.classList.add('hidden');
    }
}

async function handleCardsGridClick(event) {
    const actionEl = event.target.closest('[data-action]');
    if (!actionEl) {
        return;
    }

    const action = actionEl.dataset.action;
    const cardId = actionEl.dataset.cardId || '';

    if (action === 'toggle-skip') {
        if (!cardId) {
            return;
        }
        const currentlySkipped = actionEl.dataset.skipped === 'true';
        const targetSkipped = !currentlySkipped;
        try {
            actionEl.disabled = true;
            await updateSharedWritingCardSkip(cardId, targetSkipped);
        } catch (error) {
            console.error('Error updating shared writing card skip:', error);
            showError(error.message || 'Failed to update skip status.');
        } finally {
            actionEl.disabled = false;
        }
        return;
    }

    if (action === 'delete-card') {
        if (cardId) {
            await deleteWritingCard(cardId);
        }
        return;
    }

    if (action === 'edit-front') {
        if (cardId) {
            await editWritingCardPrompt(cardId);
        }
        return;
    }

    if (action === 'load-play-audio') {
        const targetCard = currentCards.find((card) => String(card.id) === String(cardId));
        if (!targetCard) {
            showError('Writing card not found.');
            return;
        }
        const promptUrls = previewPlayer.buildPromptUrls(targetCard);
        if (promptUrls.length === 0) {
            showError('No audio found for this Chinese writing card.');
            return;
        }
        showError('');
        previewPlayer.playUrls(promptUrls);
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

    optInAllAvailableController = window.PracticeManageCommon.createSetBackedOptInAllAvailableController({
        buttonEl: optInAllAvailableBtn,
        isBusy: () => isDeckMoveInFlight,
        getFilteredDecks: () => getAvailableDeckCandidatesForTagFilter().filter(matchesAvailableTagFilter),
        getDeckIdSet: () => stagedOptedDeckIdSet,
        clearMessages: clearDeckSelectionMessages,
        onChanged: refreshDeckSelectionViews,
    });

    sessionSettingsForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        await saveSessionSettings();
    });

    bulkImportForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        await bulkImportWritingCards();
    });

    if (bulkWritingText) {
        bulkWritingText.addEventListener('input', () => {
            updateBulkAddButtonCount();
        });
    }

    if (availableDecksEl) {
        availableDecksEl.addEventListener('click', async (event) => {
            await onAvailableDeckClick(event);
        });
    }
    if (optInAllAvailableBtn && optInAllAvailableController) {
        optInAllAvailableBtn.addEventListener('click', async () => {
            await optInAllAvailableController.optInAll();
        });
    }
    ensureAvailableTagFilterController();
    if (selectedDecksEl) {
        selectedDecksEl.addEventListener('click', async (event) => {
            await onSelectedDeckClick(event);
        });
    }
    if (applyDeckChangesBtn) {
        applyDeckChangesBtn.addEventListener('click', async () => {
            await applyDeckMembershipChanges();
        });
    }

    viewOrderSelect.addEventListener('change', () => resetAndDisplayCards(currentCards));
    cardSearchInput.addEventListener('input', () => resetAndDisplayCards(currentCards));
    cardsGrid.addEventListener('click', handleCardsGridClick);
    if (practicingDeckGrid) {
        practicingDeckGrid.addEventListener('click', handleCardsGridClick);
    }
    window.addEventListener('scroll', () => maybeLoadMoreCards());

    createSheetBtn.addEventListener('click', async () => createAndPrintSheet());
    viewSheetsBtn.addEventListener('click', () => viewSheets());

    try {
        await loadKidInfo();
        await loadSharedWritingDecks();
        updateBulkAddButtonCount();
    } catch (error) {
        console.error('Error initializing writing manage:', error);
        showError(error.message || 'Failed to load page.');
    }
});
