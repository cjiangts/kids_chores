/*
 * kid-card-manage.js — residual page init for kid-card-manage.html
 *
 * The 5,957-line page controller was split across kid-card-manage-{core, type4-generator,
 * type4-counts, deck-setup, cards-priority, cards, stats}.js; what remains here is the
 * single DOMContentLoaded handler that wires their exported handlers to DOM events
 * and kicks off the initial async load.
 *
 * Layout (all inside the DOMContentLoaded callback):
 *   1. Page guards + type-IV generator viewer init
 *   2. Deck-tree opt-in modal wiring (open/cancel/apply/clear/info/search/expand)
 *   3. Type-IV deck-counts + generator preview modal wiring
 *   4. Personal-deck modal + add-card status dismiss
 *   5. Modal backdrop + Escape key + initial-hidden state
 *   6. Kid-manage tab visibility + cards-grid + font-reflow listeners
 *   7. Session settings form (queue mix + drill-speed stepper)
 *   8. View-order / sort-menu / source-deck-filter / sort-direction / view-mode buttons
 *   9. Card search + focus-banner clear + cards-selection toolbar
 *  10. Add-card form + Chinese-char input + session-card-count stepper
 *  11. Type-IV deck-counts modal input listeners
 *  12. Latest-response tracker + initial async load
 */
document.addEventListener('DOMContentLoaded', async () => {
    // === 1. Page guards + type-IV generator viewer init ===
    if (!kidId) {
        window.location.href = '/admin.html';
        return;
    }
    if (!categoryKey) {
        showError('Missing subject. Open this page from Admin.');
        return;
    }
    initializeType4GeneratorCodeViewer();

    // === 2. Deck-tree opt-in modal wiring ===
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
    if (deckTreeSearchInput) {
        window.SearchBar.enhance(deckTreeSearchInput);
    }
    const deckTreeExpandAllBtn = document.getElementById('deckTreeExpandAllBtn');
    const deckTreeCollapseAllBtn = document.getElementById('deckTreeCollapseAllBtn');
    if (deckTreeExpandAllBtn) {
        deckTreeExpandAllBtn.addEventListener('click', expandAllDeckTree);
    }
    if (deckTreeCollapseAllBtn) {
        deckTreeCollapseAllBtn.addEventListener('click', collapseAllDeckTree);
    }
    // === 3. Type-IV deck-counts + generator preview modal wiring ===
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
    // === 4. Personal-deck modal + add-card status dismiss ===
    if (openPersonalDeckModalBtn) {
        openPersonalDeckModalBtn.addEventListener('click', () => {
            setPersonalDeckMode('edit');
            setManageModalOpen(personalDeckModal, true);
        });
    }
    if (cancelPersonalDeckModalBtn) {
        cancelPersonalDeckModalBtn.addEventListener('click', () => {
            setManageModalOpen(personalDeckModal, false);
        });
    }
    if (personalDeckBackBtn) {
        personalDeckBackBtn.addEventListener('click', () => {
            setPersonalDeckMode('edit');
        });
    }
    if (clearPersonalDeckBtn) {
        clearPersonalDeckBtn.addEventListener('click', () => {
            if (!chineseCharInput) {
                return;
            }
            chineseCharInput.value = '';
            chineseCharInput.dispatchEvent(new Event('input', { bubbles: true }));
            showStatusMessage('');
            chineseCharInput.focus();
        });
    }
    const addCardStatusDismissBtn = document.getElementById('addCardStatusDismissBtn');
    if (addCardStatusDismissBtn) {
        addCardStatusDismissBtn.addEventListener('click', () => {
            showStatusMessage('');
        });
    }
    // === 5. Modal backdrop + Escape key + initial-hidden state ===
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

    // === 6. Kid-manage tab visibility + cards-grid + font-reflow listeners ===
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

    // === 7. Session settings form (queue mix + drill-speed stepper) ===
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
    if (drillSpeedTargetInput) {
        const handleDrillSpeedInputChange = () => {
            updateQueueSettingsSaveButtonState();
        };
        drillSpeedTargetInput.addEventListener('input', handleDrillSpeedInputChange);
        drillSpeedTargetInput.addEventListener('change', handleDrillSpeedInputChange);
    }
    document.querySelectorAll('[data-drill-speed-step]').forEach((btn) => {
        btn.addEventListener('click', () => {
            if (!drillSpeedTargetInput) {
                return;
            }
            const direction = Math.sign(Number.parseInt(btn.dataset.drillSpeedStep, 10) || 0);
            if (direction === 0) return;
            const stepMs = 500;
            const currentMs = getDrillSpeedTargetInputMs();
            const nextMs = clampDrillSpeedCutoffMs(currentMs + direction * stepMs);
            if (nextMs === currentMs) return;
            setDrillSpeedTargetInputMs(nextMs);
            updateQueueSettingsSaveButtonState();
        });
    });
    // === 8. View-order / sort-menu / source-deck-filter / sort-direction / view-mode buttons ===
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
    refreshSourceDeckFilterMenu();
    if (sourceDeckFilterBtn) {
        sourceDeckFilterBtn.addEventListener('click', (event) => {
            event.stopPropagation();
            setSourceDeckFilterMenuOpen(!isSourceDeckFilterMenuOpen());
        });
        document.addEventListener('click', (event) => {
            if (!isSourceDeckFilterMenuOpen()) {
                return;
            }
            const target = event.target;
            if (sourceDeckFilterPopover.contains(target) || sourceDeckFilterBtn.contains(target)) {
                return;
            }
            setSourceDeckFilterMenuOpen(false);
        });
        document.addEventListener('keydown', (event) => {
            if (event.key === 'Escape' && isSourceDeckFilterMenuOpen()) {
                setSourceDeckFilterMenuOpen(false);
                sourceDeckFilterBtn.focus();
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
    // === 9. Card search + focus-banner clear + cards-selection toolbar ===
    if (cardSearchInput) {
        window.SearchBar.enhance(cardSearchInput);
        cardSearchInput.addEventListener('input', () => {
            resetAndDisplayCards(currentCards);
        });
    }
    if (cardFocusBannerClear) {
        cardFocusBannerClear.addEventListener('click', clearFocusedCard);
    }
    if (cardsSelectModeBtn) {
        cardsSelectModeBtn.addEventListener('click', () => {
            setCardsSelectMode(!isCardsSelectModeOn);
        });
    }
    if (cardsSelectionCloseBtn) {
        cardsSelectionCloseBtn.addEventListener('click', () => {
            setCardsSelectMode(false);
        });
    }
    if (cardsSelectAllVisibleBtn) {
        cardsSelectAllVisibleBtn.addEventListener('click', () => {
            selectAllVisibleCards();
        });
    }
    if (cardsSelectionClearBtn) {
        cardsSelectionClearBtn.addEventListener('click', () => {
            clearCardSelection();
        });
    }
    if (cardsSelectionSkipBtn) {
        cardsSelectionSkipBtn.addEventListener('click', async () => {
            await applySelectedCardsSkip(true);
        });
    }
    if (cardsSelectionUnskipBtn) {
        cardsSelectionUnskipBtn.addEventListener('click', async () => {
            await applySelectedCardsSkip(false);
        });
    }
    if (cardsSelectionDownloadBtn) {
        cardsSelectionDownloadBtn.addEventListener('click', async () => {
            await downloadSelectedType3Recordings();
        });
    }
    if (cardsSelectionDeleteBtn) {
        cardsSelectionDeleteBtn.addEventListener('click', async () => {
            await deleteSelectedPersonalCards();
        });
    }
    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape' && isCardsSelectModeOn) {
            setCardsSelectMode(false);
        }
    });
    // === 10. Add-card form + Chinese-char input + session-card-count stepper ===
    if (addCardForm) {
        addCardForm.addEventListener('submit', async (event) => {
            event.preventDefault();
            if (supportsPersonalDeckEditor() && personalDeckMode === 'edit') {
                await previewPersonalDeck();
                return;
            }
            await addOrphanCards();
        });
    }
    if (chineseCharInput) {
        chineseCharInput.addEventListener('input', () => {
            updateAddReadingButtonCount();
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
            const direction = Math.sign(Number.parseInt(btn.dataset.sessionCountStep, 10) || 0);
            const stepSize = isType3Behavior() ? 1 : 5;
            const step = direction * stepSize;
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
    // === 11. Type-IV deck-counts modal input listeners ===
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

    // === 12. Latest-response tracker + initial async load ===
    sharedDeckCardsResponseTracker = window.PracticeManageCommon.createLatestResponseTracker();

    try {
        showError('');
        showSuccess('');
        await loadKidsAndApplyKidInfo();
        updateQueueMixLegend();
        updateQueueSettingsSaveButtonState();
        if (isType4Behavior()) {
            ensureSharedDecksLoaded().catch((error) => {
                console.error('Error preloading shared decks for type-IV:', error);
            });
        }
        setupCardsViewModeToggle();
        updateAddReadingButtonCount();
    } catch (error) {
        console.error('Error initializing category manage:', error);
        showError(error.message || 'Failed to load page.');
        kidNameEl.textContent = 'Manage Cards';
        updatePageTitle();
    }
});
