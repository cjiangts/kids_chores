/*
 * kid-card-manage-deck-setup.js — opt-in summary, deck-tag helpers, tree modal
 *
 * Layout:
 *   1. Deck lookup + opt-in summary + action buttons
 *   2. Deck tag helpers + display labels (bubble, prefix strip)
 *   3. Source-name resolution + count-mismatch warnings
 *   4. Opt-in / opt-out APIs + shared-deck card search index
 *   5. Deck-tree view instance + render + modal open/close
 *   6. Stage + apply deck membership changes
 */

// =====================================================================
// === 1. Deck lookup + opt-in summary + action buttons
// =====================================================================

function getDeckById(deckId) {
    return allDecks.find((deck) => Number(deck.deck_id) === Number(deckId)) || null;
}

function getOptedDecks() {
    return allDecks.filter((deck) => stagedOptedDeckIdSet.has(Number(deck.deck_id)));
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
        openDeckOptInModalBtn.title = optInMeta;
        openDeckOptInModalBtn.innerHTML = `
            <span class="cards-select-mode-btn-icon" aria-hidden="true">${icon('pencil', { size: 16, strokeWidth: 2.4 })}</span>
            <span class="cards-select-mode-btn-label">Decks</span>
        `;
    }
    if (openDeckOptInActionBtn) {
        const optInMeta = `${optedCount} / ${totalDecks + (orphanDeck ? 1 : 0)} decks opted in`;
        openDeckOptInActionBtn.title = optInMeta;
        openDeckOptInActionBtn.setAttribute('aria-label', 'Manage Deck Opt-in');
        openDeckOptInActionBtn.innerHTML = `
            <span class="manage-popup-btn-text">
                <span class="manage-popup-btn-emoji" aria-hidden="true">${icon('layers', { size: 24 })}</span>
                <span class="manage-popup-btn-title">Decks</span>
                <span class="manage-popup-btn-meta">${escapeHtml(optInMeta)}</span>
            </span>
            <span class="manage-popup-btn-chevron" aria-hidden="true">›</span>
        `;
    }
    if (openPersonalDeckModalBtn) {
        openPersonalDeckModalBtn.title = 'Add Cards';
        openPersonalDeckModalBtn.setAttribute('aria-label', 'Add Cards');
        openPersonalDeckModalBtn.innerHTML = `
            <span class="cards-select-mode-btn-icon" aria-hidden="true">${icon('pencil', { size: 16, strokeWidth: 2.4 })}</span>
            <span class="cards-select-mode-btn-label">Cards</span>
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


// =====================================================================
// === 2. Deck tag helpers + display labels (bubble, prefix strip)
// =====================================================================

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

// =====================================================================
// === 3. Source-name resolution + count-mismatch warnings
// =====================================================================

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

// =====================================================================
// === 4. Opt-in / opt-out APIs + shared-deck card search index
// =====================================================================

async function refreshDeckSelectionViews() {
    renderDeckPendingInfo();
    await loadSharedDeckCards();
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

/* ── Tree-view deck opt-in (delegates to shared DeckTreeView class) ── */

let deckTreeViewInstance = null;

// Card-text search index across ALL shared decks in the current scope (incl. non-opted-in).
// Loaded lazily ONLY when the deck-tree modal opens, then cached for the page lifetime per scope.
let sharedDeckCardSearchIndex = null;
let sharedDeckCardSearchIndexScope = null;
let sharedDeckCardSearchIndexPromise = null;

async function ensureSharedDeckCardSearchIndex() {
    if (sharedDeckCardSearchIndex && sharedDeckCardSearchIndexScope === currentSharedScope) {
        return sharedDeckCardSearchIndex;
    }
    if (sharedDeckCardSearchIndexPromise && sharedDeckCardSearchIndexScope === currentSharedScope) {
        return sharedDeckCardSearchIndexPromise;
    }
    sharedDeckCardSearchIndexScope = currentSharedScope;
    sharedDeckCardSearchIndexPromise = (async () => {
        try {
            const response = await fetch(buildSharedDeckApiUrl('shared-decks/card-search-index'));
            if (!response.ok) return [];
            const payload = await response.json();
            return Array.isArray(payload && payload.cards) ? payload.cards : [];
        } catch (error) {
            console.error('Error loading shared-deck card search index:', error);
            return [];
        }
    })();
    const cards = await sharedDeckCardSearchIndexPromise;
    if (sharedDeckCardSearchIndexScope === currentSharedScope) {
        sharedDeckCardSearchIndex = cards;
    }
    sharedDeckCardSearchIndexPromise = null;
    return cards;
}

// =====================================================================
// === 5. Deck-tree view instance + render + modal open/close
// =====================================================================

function ensureDeckTreeViewInstance() {
    if (deckTreeViewInstance) {
        return deckTreeViewInstance;
    }
    deckTreeViewInstance = new window.DeckTreeView({
        container: deckTreeContainer,
        searchInput: deckTreeSearchInput,
        counter: deckTreeCounter,
        applyButton: applyDeckTreeChangesBtn,
        mode: 'opt-in',
        categoryKey,
        getDeckLabel: (deck) => getType1DeckBubbleLabel(deck),
        getDeckSuffix: (deck) => getDeckBubbleSuffix(deck),
        getPersonalDeckName: () => getPersonalDeckDisplayName(),
    });
    return deckTreeViewInstance;
}

function getDeckTreeViewInstance() {
    return deckTreeViewInstance;
}

function renderDeckTree() {
    ensureDeckTreeViewInstance().render();
}

function applyTreeSearch(query) {
    if (!deckTreeViewInstance) return;
    if (deckTreeSearchInput) {
        deckTreeSearchInput.value = query == null ? '' : String(query);
    }
    deckTreeViewInstance._applySearch(query);
}

function resetTreeToBaseline() {
    if (!deckTreeViewInstance) return;
    deckTreeViewInstance.setBaseline(baselineOptedDeckIdSet, baselineIncludeOrphanInQueue);
    deckTreeViewInstance.resetToBaseline();
}

async function openDeckTreeModal() {
    try {
        await ensureSharedDecksLoaded();
    } catch (error) {
        console.error('Error loading decks for tree modal:', error);
        showError(error.message || 'Failed to load decks.');
        return;
    }
    const tv = ensureDeckTreeViewInstance();
    tv.setCategoryKey(categoryKey);
    tv.setApplyDisabled(isDeckMoveInFlight);
    tv.setDecks(allDecks, { orphanDeck });
    tv.setBaseline(baselineOptedDeckIdSet, baselineIncludeOrphanInQueue);
    tv.setSelection(stagedOptedDeckIdSet, stagedIncludeOrphanInQueue);
    tv.resetExpansion();
    tv.clearSearchInput();
    if (sharedDeckCardSearchIndex) {
        tv.setCardIndex(sharedDeckCardSearchIndex);
    } else {
        tv.setCardIndex(null);
    }
    tv.render();
    setManageModalOpen(deckTreeModal, true);

    // Lazy-load card-text search index in background; class re-applies search/expanded leaves when fed.
    ensureSharedDeckCardSearchIndex().then((cards) => {
        tv.setCardIndex(cards);
    });
}

function closeDeckTreeModal() {
    setManageModalOpen(deckTreeModal, false);
}

async function applyDeckTreeChanges() {
    if (isDeckMoveInFlight) {
        return;
    }
    const tv = ensureDeckTreeViewInstance();
    stagedOptedDeckIdSet = new Set(tv.getSelectedDeckIds());
    stagedIncludeOrphanInQueue = tv.isOrphanIncluded();
    closeDeckTreeModal();
    clearDeckSelectionMessages();
    await applyDeckMembershipChanges();
    await refreshDeckSelectionViews();
}

function expandAllDeckTree() {
    if (deckTreeViewInstance) deckTreeViewInstance.expandAll();
}

function collapseAllDeckTree() {
    if (deckTreeViewInstance) deckTreeViewInstance.collapseAll();
}

function toggleDeckTreeExpansion() {
    if (deckTreeViewInstance) deckTreeViewInstance.toggleAllExpansion();
}


// =====================================================================
// === 6. Stage + apply deck membership changes
// =====================================================================

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
    renderCardsLoadingSpinner();
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
        renderDeckPendingInfo();
    }
}
