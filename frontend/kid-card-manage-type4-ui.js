// Type-IV card order and representative-card UI.

function syncType4CardOrderOptions() {
    if (!viewOrderSelect) {
        return;
    }
    const hideAllExceptAdded = isType4Behavior();
    const showType2Only = isType2Behavior();
    const options = viewOrderSelect.querySelectorAll('option');
    options.forEach((option) => {
        const value = String(option.value || '').trim().toLowerCase();
        const isType2Only = option.dataset && option.dataset.type2Only === '1';
        const shouldHide = (hideAllExceptAdded && value !== CARD_SORT_MODE_ADDED_TIME)
            || (isType2Only && !showType2Only);
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
    } else if (currentValue === CARD_SORT_MODE_THUMB_DOWNS && !showType2Only) {
        viewOrderSelect.value = CARD_SORT_MODE_PRACTICE_QUEUE;
        setCurrentCardSortDirection(getDefaultCardSortDirection(CARD_SORT_MODE_PRACTICE_QUEUE));
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
        cardsToolbar.classList.remove('hidden');
    }
    sourceDeckFilterBtn?.setAttribute('aria-label', useType4 ? 'Filter by folder' : 'Filter by source deck');
    if (!useType4) {
        return;
    }
    currentCardViewMode = 'short';
    expandedCompactCardIds.clear();
    if (cardSearchInput) {
        cardSearchInput.value = '';
    }
    if (viewOrderSelect) {
        viewOrderSelect.value = 'added_time';
        syncSortMenuFromSelect();
    }
    updateCardsQueueLegendVisibility(0);
}

