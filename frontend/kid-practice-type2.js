// Type-II practice runtime (writing prompts with audio playback).
//
// Layout:
//   1. Session start: ready-state load + start
//   2. Per-card UI: show prompt / reveal answer / answer + advance
//   3. Audio: replay current / play for card / autoplay priming / prefetch next
//   4. Session end

// =====================================================================
// === 1. Session start: ready-state load + start
// =====================================================================

async function loadType2ReadyState() {
    showError('');
    const response = await fetch(buildType2ApiUrl('/cards'));
    if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
    }

    const data = await response.json();
    resetReadyRetryState();
    applyReadyRetryState(data);
    state.availableCards = (data.cards || []).filter((card) => card.available_for_practice !== false);
    if (state.readyIsContinueSession && state.readyContinueCardCount <= 0) {
        practiceSection.classList.add('hidden');
        showError('Continue session has no available cards right now. Ask your parent to check deck settings.');
        return;
    }
    if (state.readyIsRetrySession && state.readyRetryCardCount <= 0) {
        practiceSection.classList.add('hidden');
        showError('Retry session has no available cards right now. Ask your parent to check deck settings.');
        return;
    }

    if (!state.readyIsContinueSession && !state.readyIsRetrySession && state.availableCards.length === 0) {
        practiceSection.classList.add('hidden');
        showError(`No ${getCurrentCategoryDisplayName()} cards yet. Ask your parent to add some first.`);
        return;
    }

    practiceSection.classList.remove('hidden');
    resetToStartScreen();
}
async function startType2Session() {
    try {
        showError('');
        primeAudioForAutoplay();
        const started = await window.PracticeSessionFlow.startShuffledSession(
            buildType2ApiUrl('/practice/start'),
            { categoryKey: state.categoryKey, practiceMode: state.judgeMode || 'self' }
        );
        applyServerPracticeMode(started?.data?.practice_mode);
        state.activePendingSessionId = started.pendingSessionId;
        state.activeIsRetrySession = Boolean(started?.data?.is_retry_session);
        state.sessionCards = started.cards;

        if (!window.PracticeSession.hasActiveSession(state.activePendingSessionId) || state.sessionCards.length === 0) {
            state.activeIsRetrySession = false;
            showError(`No ${getCurrentCategoryDisplayName()} cards available`);
            return;
        }

        state.currentIndex = 0;
        state.rightCount = 0;
        state.wrongCount = 0;
        state.sessionAnswers = [];

        startScreen.classList.add('hidden');
        resultScreen.classList.add('hidden');
        sessionScreen.classList.remove('hidden');
        setHeaderBackToPracticeVisible(false);

        showCurrentPrompt();
        updateFinishEarlyButtonState();
    } catch (error) {
        console.error('Error starting type-II session:', error);
        showError('Failed to start type-II practice session');
    }
}
// =====================================================================
// === 2. Per-card UI: show prompt / reveal answer / answer + advance
// =====================================================================

function showCurrentPrompt() {
    if (state.sessionCards.length === 0 || !isType(BEHAVIOR_TYPE_II)) {
        return;
    }

    showTypeSpecificCardSections();

    const card = state.sessionCards[state.currentIndex];
    renderPracticeProgress(progress, progressFill, state.currentIndex + 1, state.sessionCards.length, 'Card');
    cardAnswer.textContent = card.front || '';
    cardAnswer.classList.add('hidden');
    flashcard.classList.remove('revealed');

    state.answerRevealed = false;
    doneRow.classList.remove('hidden');
    knewRow.classList.add('hidden');
    judgeRow.classList.add('hidden');
    wrongBtn.disabled = false;
    rightBtn.disabled = false;
    doneBtn.disabled = false;

    state.cardShownAtMs = Date.now();
    playPromptForCard(card);
    prefetchNextPrompt();
}
function revealType2Answer() {
    if (!isType(BEHAVIOR_TYPE_II)) {
        return;
    }
    if (state.answerRevealed || !window.PracticeSession.hasActiveSession(state.activePendingSessionId) || state.sessionCards.length === 0) {
        return;
    }

    state.answerRevealed = true;
    cardAnswer.classList.remove('hidden');
    flashcard.classList.add('revealed');
    doneRow.classList.add('hidden');
    judgeRow.classList.remove('hidden');
}
function answerType2Card(correct) {
    if (!state.answerRevealed || !window.PracticeSession.hasActiveSession(state.activePendingSessionId)) {
        return;
    }

    const card = state.sessionCards[state.currentIndex];
    const responseTimeMs = Math.max(0, Date.now() - state.cardShownAtMs);

    state.sessionAnswers.push({
        cardId: card.id,
        known: correct,
        responseTimeMs,
    });
    updateFinishEarlyButtonState();

    if (correct) {
        state.rightCount += 1;
    } else {
        state.wrongCount += 1;
    }

    if (state.currentIndex >= state.sessionCards.length - 1) {
        void endSession();
        return;
    }

    state.currentIndex += 1;
    showCurrentPrompt();
}
// =====================================================================
// === 3. Audio: replay current / play for card / autoplay priming / prefetch next
// =====================================================================

async function replayCurrentPrompt() {
    const supportsType1Prompt = canUseType1PromptAudio();
    if (!isType(BEHAVIOR_TYPE_II) && !supportsType1Prompt) {
        return;
    }
    if (!window.PracticeSession.hasActiveSession(state.activePendingSessionId) || state.sessionCards.length === 0) {
        return;
    }
    const card = state.sessionCards[state.currentIndex];
    const played = await playPromptForCard(card);
    if (played && supportsType1Prompt) {
        state.type1PromptAudioUsed = true;
        updatePromptReplayButtonState();
    }
}

async function playPromptForCard(card) {
    if (!isType(BEHAVIOR_TYPE_II) && !canUseType1PromptAudio(card)) {
        return false;
    }
    const urls = promptPlayer.buildPromptUrls(card);
    if (urls.length === 0) {
        stopAudioPlayback();
        return false;
    }
    showError('');
    return promptPlayer.playUrls(urls);
}
function primeAudioForAutoplay() {
    if (!isType(BEHAVIOR_TYPE_II)) {
        return;
    }
    if (state.audioPrimed) {
        return;
    }
    try {
        const unlockAudio = new Audio(
            'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAESsAACJWAAACABAAZGF0YQAAAAA='
        );
        unlockAudio.play()
            .then(() => {
                unlockAudio.pause();
                unlockAudio.currentTime = 0;
                state.audioPrimed = true;
            })
            .catch(() => {
                // Best-effort only.
            });
    } catch (error) {
        // Best-effort only.
    }
}

function prefetchNextPrompt() {
    if (!isType(BEHAVIOR_TYPE_II)) {
        return;
    }
    if (!window.PracticeSession.hasActiveSession(state.activePendingSessionId) || state.sessionCards.length === 0) {
        return;
    }
    const nextIndex = state.currentIndex + 1;
    if (nextIndex >= state.sessionCards.length) {
        return;
    }
    const nextCard = state.sessionCards[nextIndex];
    promptPlayer.prefetchCard(nextCard);
}
// =====================================================================
// === 4. Session end
// =====================================================================

async function endType2Session(endedEarly = false) {
    stopAudioPlayback();

    sessionScreen.classList.add('hidden');
    resultScreen.classList.remove('hidden');
    setHeaderBackToPracticeVisible(false);
    state.pendingResultEndedEarly = Boolean(endedEarly);
    setResultActionMode('saving');
    resultSummary.textContent = endedEarly ? 'Ended early · Saving results...' : 'Saving results...';
    try {
        showError('');
        const response = await window.PracticeSessionFlow.postCompleteSession(
            buildType2ApiUrl('/practice/complete'),
            state.activePendingSessionId,
            state.sessionAnswers,
            { categoryKey: state.categoryKey }
        );
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
            throw new Error(payload.error || `HTTP ${response.status}`);
        }
        resultSummary.textContent = endedEarly
            ? `Ended early · Right: ${state.rightCount} · Wrong: ${state.wrongCount}`
            : `Right: ${state.rightCount} · Wrong: ${state.wrongCount}`;
        window.PracticeSession.clearSessionStart(state.activePendingSessionId);
        updateFinishEarlyButtonState();
        setResultActionMode('back');
    } catch (error) {
        console.error('Error completing type-II session:', error);
        resultSummary.textContent = 'Could not save this session yet.';
        setResultActionMode('retry-save');
        showError('Failed to save session results');
        return;
    }

    clearAudioBlobCache();
}
