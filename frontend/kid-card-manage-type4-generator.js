// Type-IV generator: Ace code viewer setup, modal rendering, sample preview, run-example API call.
function getPersistedOptedInType4Decks() {
    return (Array.isArray(allDecks) ? allDecks : []).filter((deck) => Boolean(deck && deck.opted_in));
}

function getType4DeckDailyTargetCount(deck) {
    const parsed = Number.parseInt(deck && deck.daily_target_count, 10);
    return Number.isInteger(parsed) ? Math.max(0, parsed) : 0;
}

function getPersistedType4DeckCountEntries() {
    const entries = getPersistedOptedInType4Decks().map((deck) => ({
        kind: 'shared',
        deck,
    }));
    if (orphanDeck && stagedIncludeOrphanInQueue) {
        entries.push({
            kind: 'orphan',
            deck: orphanDeck,
        });
    }
    return entries;
}

function getType4TotalCardsPerDay() {
    return getPersistedType4DeckCountEntries().reduce(
        (sum, entry) => sum + getType4DeckDailyTargetCount(entry && entry.deck),
        0
    );
}

function showType4DeckCountsMessage(message, isError = false) {
    if (!type4DeckCountsMessage) {
        return;
    }
    const text = String(message || '').trim();
    if (!text) {
        type4DeckCountsMessage.textContent = '';
        type4DeckCountsMessage.classList.add('hidden');
        type4DeckCountsMessage.classList.remove('error');
        type4DeckCountsMessage.classList.add('success');
        return;
    }
    type4DeckCountsMessage.textContent = text;
    type4DeckCountsMessage.classList.remove('hidden');
    type4DeckCountsMessage.classList.toggle('error', !!isError);
    type4DeckCountsMessage.classList.toggle('success', !isError);
}

function showType4GeneratorMessage(message, isError = false) {
    if (!type4GeneratorMessage) {
        return;
    }
    const text = String(message || '').trim();
    if (!text) {
        type4GeneratorMessage.textContent = '';
        type4GeneratorMessage.classList.add('hidden');
        type4GeneratorMessage.classList.remove('error');
        type4GeneratorMessage.classList.add('success');
        return;
    }
    type4GeneratorMessage.textContent = text;
    type4GeneratorMessage.classList.remove('hidden');
    type4GeneratorMessage.classList.toggle('error', !!isError);
    type4GeneratorMessage.classList.toggle('success', !isError);
}

function getCurrentType4GeneratorCard() {
    if (!activeType4GeneratorCardId) {
        return null;
    }
    return (Array.isArray(currentCards) ? currentCards : []).find(
        (card) => String(card && card.id ? card.id : '') === String(activeType4GeneratorCardId)
    ) || null;
}

function initializeType4GeneratorCodeViewer() {
    if (!type4GeneratorCodeText || !type4GeneratorCodeEditor) {
        return;
    }
    const ace = window.ace;
    if (!ace || typeof ace.edit !== 'function') {
        return;
    }
    type4GeneratorAceViewer = ace.edit(type4GeneratorCodeEditor);
    type4GeneratorAceViewer.setTheme('ace/theme/github_light_default');
    type4GeneratorAceViewer.session.setMode('ace/mode/python');
    type4GeneratorAceViewer.session.setUseSoftTabs(true);
    type4GeneratorAceViewer.session.setTabSize(4);
    type4GeneratorAceViewer.session.setUseWrapMode(true);
    type4GeneratorAceViewer.setReadOnly(true);
    type4GeneratorAceViewer.setHighlightActiveLine(false);
    type4GeneratorAceViewer.setShowPrintMargin(false);
    type4GeneratorAceViewer.setOption('fontFamily', 'ui-monospace, SFMono-Regular, Menlo, monospace');
    type4GeneratorAceViewer.setOption('fontSize', '14px');
    type4GeneratorAceViewer.setOption('wrap', true);
    type4GeneratorAceViewer.setOption('showLineNumbers', true);
    type4GeneratorAceViewer.setOption('highlightGutterLine', false);
    type4GeneratorAceViewer.setOption('showFoldWidgets', false);
    type4GeneratorAceViewer.setOption('displayIndentGuides', false);
    type4GeneratorAceViewer.setOption('useWorker', false);
    type4GeneratorAceViewer.renderer.setScrollMargin(8, 8);
    type4GeneratorAceViewer.renderer.$cursorLayer.element.style.display = 'none';
    type4GeneratorCodeText.classList.add('hidden');
    type4GeneratorCodeText.setAttribute('aria-hidden', 'true');
    type4GeneratorCodeEditor.classList.remove('hidden');
    type4GeneratorCodeEditor.setAttribute('aria-hidden', 'false');
}

function setType4GeneratorCodeContent(codeText) {
    const nextCode = String(codeText || '').trim() || 'Generator code unavailable.';
    if (type4GeneratorCodeText) {
        type4GeneratorCodeText.textContent = nextCode;
    }
    if (type4GeneratorAceViewer && typeof type4GeneratorAceViewer.setValue === 'function') {
        type4GeneratorAceViewer.setValue(nextCode, -1);
        type4GeneratorAceViewer.clearSelection();
        type4GeneratorAceViewer.scrollToLine(0, true, false, () => {});
        type4GeneratorAceViewer.gotoLine(1, 0, false);
    }
}

function renderType4GeneratorSamples(samples = [], message = '') {
    if (!type4GeneratorSamples) {
        return;
    }
    const items = Array.isArray(samples) ? samples : [];
    if (!items.length) {
        type4GeneratorSamples.innerHTML = `<p class="type4-generator-empty">${escapeHtml(message || 'No example yet.')}</p>`;
        return;
    }
    const sample = items[0] || {};
    const prompt = String(sample && sample.prompt ? sample.prompt : '').trim();
    const answer = String(sample && sample.answer ? sample.answer : '').trim();
    const distractors = Array.isArray(sample && sample.distractors) ? sample.distractors : [];
    const distractorMarkup = distractors.length > 0
        ? distractors.map((item) => `<code>${escapeHtml(String(item || '').trim())}</code>`).join(', ')
        : '<span class="type4-generator-empty">No distractors provided.</span>';
    type4GeneratorSamples.innerHTML = `
        <div class="type4-generator-sample-card">
            <div class="type4-generator-sample-label">Prompt</div>
            <div class="type4-generator-sample-prompt">${escapeHtml(prompt || '(empty prompt)')}</div>
            <div class="type4-generator-sample-answer">Answer: <code>${escapeHtml(answer || '-')}</code></div>
            <div class="type4-generator-sample-answer">Distractors: ${distractorMarkup}</div>
        </div>
    `;
}

function renderType4GeneratorModal(card) {
    if (!type4GeneratorHeading || !type4GeneratorDeckText || !type4GeneratorCodeText) {
        return;
    }
    const sourceName = resolveCardSourceDeckName(card);
    type4GeneratorHeading.textContent = String(card && card.front ? card.front : 'Generator');
    type4GeneratorDeckText.textContent = String(sourceName || '-');
    const cachedCode = String(card && card.type4_generator_code ? card.type4_generator_code : '').trim();
    const cachedSamples = Array.isArray(card && card.type4_generator_samples) ? card.type4_generator_samples : [];
    setType4GeneratorCodeContent(cachedCode || 'Loading generator...');
    renderType4GeneratorSamples(cachedSamples, cachedCode ? 'No example yet.' : 'Loading example...');
    showType4GeneratorMessage('');
    if (type4GeneratorValidateTestContainer) {
        type4GeneratorValidateTestContainer.classList.add('hidden');
        type4GeneratorValidateTestContainer.innerHTML = '';
    }
    if (runType4GeneratorPreviewBtn) {
        runType4GeneratorPreviewBtn.disabled = !card;
        runType4GeneratorPreviewBtn.textContent = 'Run Example';
    }
}

async function requestType4GeneratorPreview(card) {
    const response = await fetch(buildSharedDeckApiUrl(`shared-decks/cards/${card.id}/generator-preview`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ categoryKey }),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
        throw new Error(result.error || `Failed to run generator (HTTP ${response.status})`);
    }
    return result;
}

function openType4GeneratorModal(card) {
    if (!card) {
        return;
    }
    activeType4GeneratorCardId = String(card.id || '');
    renderType4GeneratorModal(card);
    setManageModalOpen(type4GeneratorModal, true);
    if (type4GeneratorAceViewer && typeof type4GeneratorAceViewer.resize === 'function') {
        window.setTimeout(() => {
            type4GeneratorAceViewer.resize();
        }, 0);
    }
    if (!String(card.type4_generator_code || '').trim()) {
        void runType4GeneratorPreview().catch((error) => {
            console.error('Error loading generator details:', error);
            showType4GeneratorMessage(error.message || 'Failed to load generator.', true);
        });
    }
}

async function runType4GeneratorPreview() {
    const card = getCurrentType4GeneratorCard();
    if (!card) {
        showType4GeneratorMessage('Representative card not found.', true);
        return;
    }
    if (isType4GeneratorPreviewLoading) {
        return;
    }
    isType4GeneratorPreviewLoading = true;
    if (runType4GeneratorPreviewBtn) {
        runType4GeneratorPreviewBtn.disabled = true;
        runType4GeneratorPreviewBtn.textContent = 'Running...';
    }
    showType4GeneratorMessage('');
    try {
        const result = await requestType4GeneratorPreview(card);
        if (card) {
            card.type4_generator_code = String(result && result.code ? result.code : '');
            card.type4_generator_samples = Array.isArray(result && result.samples) ? result.samples : [];
        }
        setType4GeneratorCodeContent(card && card.type4_generator_code ? card.type4_generator_code : '');
        renderType4GeneratorSamples(result.samples || [], 'No example returned.');
        const pmc = window.PracticeManageCommon;
        if (pmc && type4GeneratorValidateTestContainer) {
            const hasValidate = Boolean(result && result.has_validate);
            pmc.showOrHideValidateTestBox(type4GeneratorValidateTestContainer, hasValidate);
            if (hasValidate) {
                const previewSamples = Array.isArray(result && result.samples) ? result.samples : [];
                const previewAnswer = previewSamples.length > 0
                    ? String(previewSamples[0].answer || '').trim()
                    : '';
                pmc.renderValidateTestBox(type4GeneratorValidateTestContainer, {
                    getGeneratorCode: () => String(card && card.type4_generator_code ? card.type4_generator_code : ''),
                    getExpectedAnswer: () => previewAnswer,
                });
            }
        }
    } finally {
        isType4GeneratorPreviewLoading = false;
        if (runType4GeneratorPreviewBtn) {
            runType4GeneratorPreviewBtn.disabled = false;
            runType4GeneratorPreviewBtn.textContent = 'Run Example';
        }
    }
}

function getOptInDecksHelpText() {
    if (currentBehaviorType === BEHAVIOR_TYPE_TYPE_IV) {
        return 'Tap a deck to toggle it on or off, then tap Apply Deck Changes.\n\nYou can freely add or remove decks at any time — all practice records are always kept.';
    }
    return 'Tap a deck to toggle it on or off, then tap Apply Deck Changes.\n\nYou can freely add or remove decks at any time — all practice records are always kept. Cards you\'ve already practiced will stay visible under Personal Deck so nothing is lost.';
}
