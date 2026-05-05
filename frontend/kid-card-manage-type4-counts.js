// Type-IV daily-count modal: per-deck input rows, totals, save action, and supporting deck-target controls.
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
