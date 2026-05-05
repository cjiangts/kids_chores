// Page controller: DOMContentLoaded handler wires up event handlers and kicks off initial load.
document.addEventListener('DOMContentLoaded', async () => {
    if (!kidId) {
        window.location.href = '/admin.html';
        return;
    }
    if (!categoryKey) {
        showError('Missing deck category. Open this page from Admin.');
        return;
    }
    initializeType4GeneratorCodeViewer();
    if (openDeckOptInModalBtn) {
        openDeckOptInModalBtn.addEventListener('click', openDeckTreeModal);
    }
    if (cancelDeckTreeModalBtn) {
        cancelDeckTreeModalBtn.addEventListener('click', closeDeckTreeModal);
    }
    if (applyDeckTreeChangesBtn) {
        applyDeckTreeChangesBtn.addEventListener('click', async () => {
            await applyDeckTreeChanges();
        });
    }
    if (deckTreeClearBtn) {
        deckTreeClearBtn.addEventListener('click', resetTreeToBaseline);
    }
    if (deckTreeInfoBtn) {
        deckTreeInfoBtn.addEventListener('click', () => {
            const existing = document.querySelector('.deck-tree-info-popover');
            if (existing) {
                existing.remove();
                return;
            }
            const popover = document.createElement('div');
            popover.className = 'deck-tree-info-popover';
            popover.textContent = getOptInDecksHelpText();
            deckTreeInfoBtn.parentElement.appendChild(popover);
            const dismiss = (e) => {
                if (!popover.contains(e.target) && e.target !== deckTreeInfoBtn) {
                    popover.remove();
                    document.removeEventListener('click', dismiss);
                }
            };
            setTimeout(() => document.addEventListener('click', dismiss), 0);
        });
    }
    if (deckTreeContainer) {
        deckTreeContainer.addEventListener('click', handleTreeContainerClick);
    }
    if (deckTreeSearchInput) {
        deckTreeSearchInput.addEventListener('input', () => {
            applyTreeSearch(deckTreeSearchInput.value);
        });
    }
    const deckTreeExpandAllBtn = document.getElementById('deckTreeExpandAllBtn');
    const deckTreeCollapseAllBtn = document.getElementById('deckTreeCollapseAllBtn');
    if (deckTreeExpandAllBtn) {
        deckTreeExpandAllBtn.addEventListener('click', () => {
            if (!deckTreeContainer) return;
            deckTreeContainer.querySelectorAll('.deck-tree-children.collapsed').forEach((el) => el.classList.remove('collapsed'));
            deckTreeContainer.querySelectorAll('.deck-tree-toggle').forEach((el) => el.classList.add('expanded'));
        });
    }
    if (deckTreeCollapseAllBtn) {
        deckTreeCollapseAllBtn.addEventListener('click', () => {
            if (!deckTreeContainer) return;
            deckTreeContainer.querySelectorAll('.deck-tree-children').forEach((el) => el.classList.add('collapsed'));
            deckTreeContainer.querySelectorAll('.deck-tree-toggle').forEach((el) => el.classList.remove('expanded'));
        });
    }
    if (openType4DeckCountsModalBtn) {
        openType4DeckCountsModalBtn.addEventListener('click', () => {
            if (!isType4Behavior() || hasPendingDeckChanges()) {
                return;
            }
            renderType4DeckCountsModal();
            showType4DeckCountsMessage('');
            setManageModalOpen(type4DeckCountsModal, true);
        });
    }
    if (cancelType4DeckCountsModalBtn) {
        cancelType4DeckCountsModalBtn.addEventListener('click', () => {
            setManageModalOpen(type4DeckCountsModal, false);
        });
    }
    if (applyType4DeckCountsToAllBtn) {
        applyType4DeckCountsToAllBtn.addEventListener('click', () => {
            applyType4DeckCountToAllRows(type4DeckCountsApplyAllInput ? type4DeckCountsApplyAllInput.value : 0);
        });
    }
    if (type4DeckCountsApplyAllInput) {
        type4DeckCountsApplyAllInput.addEventListener('input', () => {
            type4DeckCountsApplyAllInput.value = String(getType4DeckCountDraftValue(type4DeckCountsApplyAllInput.value));
        });
        type4DeckCountsApplyAllInput.addEventListener('change', () => {
            type4DeckCountsApplyAllInput.value = String(getType4DeckCountDraftValue(type4DeckCountsApplyAllInput.value));
        });
        type4DeckCountsApplyAllInput.addEventListener('keydown', (event) => {
            if (event.key !== 'Enter') {
                return;
            }
            event.preventDefault();
            applyType4DeckCountToAllRows(type4DeckCountsApplyAllInput.value);
        });
    }
    if (closeType4GeneratorModalBtn) {
        closeType4GeneratorModalBtn.addEventListener('click', () => {
            setManageModalOpen(type4GeneratorModal, false);
        });
    }
    if (saveType4DeckCountsBtn) {
        saveType4DeckCountsBtn.addEventListener('click', async () => {
            try {
                await saveType4DeckCounts();
            } catch (error) {
                console.error('Error saving generator deck counts:', error);
                showType4DeckCountsMessage(error.message || 'Failed to save deck counts.', true);
            }
        });
    }
    if (runType4GeneratorPreviewBtn) {
        runType4GeneratorPreviewBtn.addEventListener('click', async () => {
            try {
                await runType4GeneratorPreview();
            } catch (error) {
                console.error('Error running generator preview:', error);
                showType4GeneratorMessage(error.message || 'Failed to run generator.', true);
            }
        });
    }
    if (openPersonalDeckModalBtn) {
        openPersonalDeckModalBtn.addEventListener('click', () => {
            setManageModalOpen(personalDeckModal, true);
        });
    }
    if (cancelPersonalDeckModalBtn) {
        cancelPersonalDeckModalBtn.addEventListener('click', () => {
            setManageModalOpen(personalDeckModal, false);
        });
    }
    if (deckTreeModal) {
        deckTreeModal.addEventListener('click', handleModalBackdropClick);
    }
    if (type4DeckCountsModal) {
        type4DeckCountsModal.addEventListener('click', handleModalBackdropClick);
    }
    if (type4GeneratorModal) {
        type4GeneratorModal.addEventListener('click', handleModalBackdropClick);
    }
    if (personalDeckModal) {
        personalDeckModal.addEventListener('click', handleModalBackdropClick);
    }
    document.addEventListener('keydown', (event) => {
        if (event.key !== 'Escape') {
            return;
        }
        if (isModalOpen(type4GeneratorModal)) {
            setManageModalOpen(type4GeneratorModal, false);
            return;
        }
        if (isModalOpen(type4DeckCountsModal)) {
            setManageModalOpen(type4DeckCountsModal, false);
            return;
        }
        if (isModalOpen(personalDeckModal)) {
            setManageModalOpen(personalDeckModal, false);
            return;
        }
        if (isModalOpen(deckTreeModal)) {
            closeDeckTreeModal();
        }
    });
    if (deckTreeModal) {
        deckTreeModal.classList.add('hidden');
        deckTreeModal.setAttribute('aria-hidden', 'true');
    }
    if (type4DeckCountsModal) {
        type4DeckCountsModal.classList.add('hidden');
        type4DeckCountsModal.setAttribute('aria-hidden', 'true');
    }
    if (type4GeneratorModal) {
        type4GeneratorModal.classList.add('hidden');
        type4GeneratorModal.setAttribute('aria-hidden', 'true');
    }
    if (personalDeckModal) {
        personalDeckModal.classList.add('hidden');
        personalDeckModal.setAttribute('aria-hidden', 'true');
    }
    syncModalBodyLock();
    applyCategoryUiText();

    window.PracticeManageCommon.applyKidManageTabVisibility({
        kidId,
        defaultCategoryByRoute: {
            '/kid-card-manage.html': categoryKey,
        },
    });

    cardsGrid.addEventListener('click', handleCardsGridClick);
    window.addEventListener('resize', () => {
        applyChineseCardFrontUniformSize();
    });
    if (document.fonts && typeof document.fonts.addEventListener === 'function') {
        document.fonts.addEventListener('loadingdone', () => {
            applyChineseCardFrontUniformSize();
        });
    }

    if (sessionSettingsForm) {
        sessionSettingsForm.addEventListener('submit', async (event) => {
            event.preventDefault();
            try {
                await saveQueueSettings();
            } catch (error) {
                console.error('Error saving shared category settings:', error);
                showError(error.message || 'Failed to save practice settings.');
            }
        });
    }
    viewOrderSelect.addEventListener('change', () => {
        const nextMode = getSelectedCardSortMode();
        setCurrentCardSortDirection(getDefaultCardSortDirection(nextMode));
        syncCardSortDirectionButton();
        syncSortMenuFromSelect();
        resetAndDisplayCards(currentCards);
    });
    buildSortMenuItems();
    syncSortMenuFromSelect();
    syncCardSortDirectionButton();
    if (sortMenuBtn) {
        sortMenuBtn.addEventListener('click', (event) => {
            event.stopPropagation();
            setSortMenuOpen(!isSortMenuOpen());
        });
        document.addEventListener('click', (event) => {
            if (!isSortMenuOpen()) {
                return;
            }
            const target = event.target;
            if (sortMenuPopover.contains(target) || sortMenuBtn.contains(target)) {
                return;
            }
            setSortMenuOpen(false);
        });
        document.addEventListener('keydown', (event) => {
            if (event.key === 'Escape' && isSortMenuOpen()) {
                setSortMenuOpen(false);
                sortMenuBtn.focus();
            }
        });
    }
    sortDirectionToggleBtns.forEach((btn) => {
        btn.addEventListener('click', () => {
            const next = btn.dataset.sortDirection === 'asc'
                ? CARD_SORT_DIRECTION_ASC
                : CARD_SORT_DIRECTION_DESC;
            if (next === getCurrentCardSortDirection()) {
                return;
            }
            setCurrentCardSortDirection(next);
            syncCardSortDirectionButton();
            resetAndDisplayCards(currentCards);
        });
    });
    renderCardViewModeButtons();
    if (cardViewModeCompactBtn) {
        cardViewModeCompactBtn.addEventListener('click', () => setCardViewMode('short'));
    }
    if (cardViewModeExpandBtn) {
        cardViewModeExpandBtn.addEventListener('click', () => setCardViewMode('long'));
    }
    if (cardSearchInput) {
        cardSearchInput.addEventListener('input', () => {
            resetAndDisplayCards(currentCards);
        });
    }
    if (skipVisibleCardsBtn) {
        skipVisibleCardsBtn.addEventListener('click', async () => {
            setCardsBulkActionMenuOpen(false);
            await applyVisibleCardsSkip(true);
        });
    }
    if (unskipVisibleCardsBtn) {
        unskipVisibleCardsBtn.addEventListener('click', async () => {
            setCardsBulkActionMenuOpen(false);
            await applyVisibleCardsSkip(false);
        });
    }
    if (cardsBulkActionMenuBtn) {
        cardsBulkActionMenuBtn.addEventListener('click', (event) => {
            event.stopPropagation();
            setCardsBulkActionMenuOpen(!isCardsBulkActionMenuOpen());
        });
        document.addEventListener('click', (event) => {
            if (!isCardsBulkActionMenuOpen()) {
                return;
            }
            const target = event.target;
            if (cardsBulkActionMenu.contains(target) || cardsBulkActionMenuBtn.contains(target)) {
                return;
            }
            setCardsBulkActionMenuOpen(false);
        });
        document.addEventListener('keydown', (event) => {
            if (event.key === 'Escape' && isCardsBulkActionMenuOpen()) {
                setCardsBulkActionMenuOpen(false);
                cardsBulkActionMenuBtn.focus();
            }
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
    if (hardnessPercentSlider) {
        hardnessPercentSlider.addEventListener('input', () => {
            updateQueueMixLegend();
            rerenderCompactCardsForQueuePreview();
            scheduleQueuePreviewReload();
        });
        hardnessPercentSlider.addEventListener('change', () => {
            normalizeHardSliderValue();
            updateQueueMixLegend();
            rerenderCompactCardsForQueuePreview();
            scheduleQueuePreviewReload();
        });
    }
    if (sessionCardCountInput) {
        sessionCardCountInput.addEventListener('input', () => {
            normalizeSessionCountInputValue();
            updateQueueMixLegend();
            rerenderCompactCardsForQueuePreview();
        });
        sessionCardCountInput.addEventListener('change', () => {
            normalizeSessionCountInputValue();
            updateQueueMixLegend();
            rerenderCompactCardsForQueuePreview();
        });
        applySessionCardCountInputCap();
    }
    document.querySelectorAll('[data-session-count-step]').forEach((btn) => {
        btn.addEventListener('click', () => {
            if (!sessionCardCountInput) {
                return;
            }
            const step = Number.parseInt(btn.dataset.sessionCountStep, 10) || 0;
            const current = Number.parseInt(sessionCardCountInput.value, 10) || 0;
            const min = Number.parseInt(sessionCardCountInput.min, 10);
            const max = Number.parseInt(sessionCardCountInput.max, 10);
            let next = current + step;
            if (Number.isFinite(min) && next < min) next = min;
            if (Number.isFinite(max) && next > max) next = max;
            if (next === current) {
                return;
            }
            sessionCardCountInput.value = String(next);
            sessionCardCountInput.dispatchEvent(new Event('input', { bubbles: true }));
            sessionCardCountInput.dispatchEvent(new Event('change', { bubbles: true }));
        });
    });
    if (type4DeckCountsList) {
        type4DeckCountsList.addEventListener('input', (event) => {
            const target = event.target;
            if (!(target instanceof HTMLInputElement) || !target.classList.contains('type4-deck-count-input')) {
                return;
            }
            target.value = String(getType4DeckCountDraftValue(target.value));
            updateType4DeckCountsModalTotal();
        });
        type4DeckCountsList.addEventListener('change', (event) => {
            const target = event.target;
            if (!(target instanceof HTMLInputElement) || !target.classList.contains('type4-deck-count-input')) {
                return;
            }
            target.value = String(getType4DeckCountDraftValue(target.value));
            updateType4DeckCountsModalTotal();
        });
    }

    setupCardsViewModeToggle();

    loadKidNav();

    sharedDeckCardsResponseTracker = window.PracticeManageCommon.createLatestResponseTracker();

    try {
        showError('');
        showSuccess('');
        await loadKidInfo();
        updateQueueMixLegend();
        updateQueueSettingsSaveButtonState();
        // Fire decks and cards fetches in parallel (both URLs depend only on kid info)
        await Promise.all([
            loadSharedType1Decks({ skipCards: true }),
            loadSharedDeckCards(),
        ]);
        updateAddReadingButtonCount();
    } catch (error) {
        console.error('Error initializing category manage:', error);
        showError(error.message || 'Failed to load page.');
        kidNameEl.textContent = 'Card Management';
        updatePageTitle();
    }
});
