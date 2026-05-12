function getChineseType1BackText(rawBack) {
    return String(rawBack || '').trim();
}

function getChineseType1BackHtml(rawBack) {
    return escapeHtml(getChineseType1BackText(rawBack));
}
function canUseType1PromptAudio(card = null) {
    if (
        !isType(BEHAVIOR_TYPE_I)
        || !state.hasChineseSpecificLogic
        || state.chineseBackContent !== 'english'
    ) {
        return false;
    }
    const judgeState = getJudgeModeUiState();
    if (!judgeState.showMultiChoiceActions) {
        return false;
    }
    const sourceCard = card || state.sessionCards[state.currentIndex] || {};
    return promptPlayer.buildPromptUrls(sourceCard).length > 0;
}

function updatePromptReplayButtonState() {
    if (!promptReplayBtn) {
        return;
    }
    const shouldShow = canUseType1PromptAudio();
    promptReplayBtn.classList.toggle('hidden', !shouldShow);
    promptReplayBtn.disabled = (
        !shouldShow
        || state.isPaused
        || state.type1WrongAnswerReview
        || !window.PracticeSession.hasActiveSession(state.activePendingSessionId)
    );
}
async function loadType1ReadyState() {
    showError('');
    const decksResponse = await fetch(buildType1ApiUrl('decks'));
    if (!decksResponse.ok) {
        throw new Error(`HTTP ${decksResponse.status}`);
    }

    const decksData = await decksResponse.json();
    resetReadyRetryState();
    applyReadyRetryState(decksData);
    if (typeof decksData?.has_chinese_specific_logic === 'boolean') {
        state.hasChineseSpecificLogic = Boolean(decksData.has_chinese_specific_logic);
        if (typeof decksData?.chinese_back_content === 'string') {
            state.chineseBackContent = String(decksData.chinese_back_content || '').trim().toLowerCase();
        }
        applyPageTypeClasses();
        applyType1DisplayMode();
        configureJudgeModePickerForType();
    }
    state.configuredSessionCount = Number.parseInt(decksData.total_session_count, 10) || 0;
    const readyDrillTargetMs = Number.parseInt(decksData.drill_speed_target_ms, 10);
    state.readyDrillSpeedTargetMs = (
        Number.isFinite(readyDrillTargetMs) && readyDrillTargetMs > 0
            ? readyDrillTargetMs
            : null
    );
    const deckList = Array.isArray(decksData.decks) ? decksData.decks : [];
    const availableWithConfig = deckList.some((deck) => {
        return Number(deck.total_cards || 0) > 0 && Number(deck.session_count || 0) > 0;
    });
    const itemNoun = state.hasChineseSpecificLogic ? 'cards' : 'questions';
    const targetCount = state.readyIsContinueSession
        ? state.readyContinueCardCount
        : (state.readyIsRetrySession ? state.readyRetryCardCount : state.configuredSessionCount);

    if (!state.readyIsContinueSession && !state.readyIsRetrySession && state.configuredSessionCount <= 0) {
        practiceSection.classList.add('hidden');
        showError(`${getCurrentCategoryDisplayName()} practice is off. Ask your parent to set a session count in Manage ${getCurrentCategoryDisplayName()}.`);
        return;
    }

    if (targetCount <= 0) {
        practiceSection.classList.add('hidden');
        if (state.readyIsContinueSession) {
            showError(`Continue session has no available ${itemNoun} right now. Ask your parent to check deck settings.`);
            return;
        }
        if (state.readyIsRetrySession) {
            showError(`Retry session has no available ${itemNoun} right now. Ask your parent to check deck settings.`);
            return;
        }
        showError(`No ${getCurrentCategoryDisplayName()} ${itemNoun} available for current deck settings.`);
        return;
    }

    if (!state.readyIsContinueSession && !state.readyIsRetrySession && !availableWithConfig) {
        practiceSection.classList.add('hidden');
        showError(`No ${getCurrentCategoryDisplayName()} ${itemNoun} available for current deck settings.`);
        return;
    }

    practiceSection.classList.remove('hidden');
    resetToStartScreen(targetCount);
}
async function startType1Session() {
    try {
        showError('');
        const wantDrill = state.drillRequested && shouldOfferDrillMode();
        const baseJudgeMode = state.judgeMode || 'parent';
        const requestedPracticeMode = wantDrill
            ? `${baseJudgeMode}${PRACTICE_MODE_DRILL_SUFFIX}`
            : baseJudgeMode;
        const started = await window.PracticeSessionFlow.startShuffledSession(
            buildType1ApiUrl('practice/start'),
            { practiceMode: requestedPracticeMode }
        );
        const serverPracticeMode = String(started?.data?.practice_mode || '').trim().toLowerCase();
        applyServerPracticeMode(serverPracticeMode);
        state.activePendingSessionId = started.pendingSessionId;
        state.activeIsRetrySession = Boolean(started?.data?.is_retry_session);
        const isDrillConfirmed = wantDrill && parseServerPracticeMode(serverPracticeMode).drill;
        // In drill mode, keep priority order from the backend (top-N first)
        // instead of using the shuffled list returned by startShuffledSession.
        state.sessionCards = isDrillConfirmed
            ? (Array.isArray(started?.data?.cards) ? started.data.cards : [])
            : started.cards;
        state.type1MultipleChoicePoolCards = Array.isArray(started?.data?.multiple_choice_pool_cards)
            ? started.data.multiple_choice_pool_cards
            : [];

        if (!window.PracticeSession.hasActiveSession(state.activePendingSessionId) || state.sessionCards.length === 0) {
            state.activeIsRetrySession = false;
            showError(`No ${getCurrentCategoryDisplayName()} ${state.hasChineseSpecificLogic ? 'cards' : 'questions'} available`);
            return;
        }

        state.currentIndex = 0;
        state.rightCount = 0;
        state.wrongCount = 0;
        state.sessionAnswers = [];
        state.wrongCardsInSession = [];

        if (isDrillConfirmed) {
            initDrillSession(started?.data?.drill_speed_target_ms);
        } else {
            resetDrillSessionState();
        }

        startScreen.classList.add('hidden');
        resultScreen.classList.add('hidden');
        sessionScreen.classList.remove('hidden');
        setHeaderBackToPracticeVisible(true);

        showCurrentQuestion();
        updateFinishEarlyButtonState();
    } catch (error) {
        console.error('Error starting type-I session:', error);
        showError(`Failed to start ${getCurrentCategoryDisplayName()} session`);
    }
}
function resetDrillSessionState() {
    state.drillActive = false;
    state.drillTargetAttempts = 0;
    state.drillAttemptsDone = 0;
    state.drillSpeedTargetMs = DRILL_FALLBACK_SPEED_TARGET_MS;
    state.drillActiveIds = [];
    state.drillQueueIds = [];
    state.drillRecentIds = [];
    state.drillCurrentRoundIds = [];
    state.drillCardStats = {};
    state.drillCardIndexById = {};
}

function initDrillSession(speedTargetMs) {
    resetDrillSessionState();
    state.drillActive = true;
    state.drillTargetAttempts = Math.max(1, Number.parseInt(state.configuredSessionCount, 10) || 0);
    const parsedTarget = Number.parseInt(speedTargetMs, 10);
    state.drillSpeedTargetMs = (
        Number.isFinite(parsedTarget) && parsedTarget > 0
            ? parsedTarget
            : DRILL_FALLBACK_SPEED_TARGET_MS
    );

    const indexById = {};
    const orderedIds = [];
    state.sessionCards.forEach((card, index) => {
        const id = Number.parseInt(card?.id, 10);
        if (!Number.isInteger(id) || id <= 0) {
            return;
        }
        if (Object.prototype.hasOwnProperty.call(indexById, id)) {
            return;
        }
        indexById[id] = index;
        orderedIds.push(id);
    });
    state.drillCardIndexById = indexById;

    const batchSize = Math.min(DRILL_ACTIVE_BATCH_SIZE, orderedIds.length);
    state.drillActiveIds = orderedIds.slice(0, batchSize);
    state.drillQueueIds = orderedIds.slice(batchSize);
    state.drillActiveIds.forEach((id) => {
        state.drillCardStats[id] = { fastCorrectCount: 0, sessionAttemptCount: 0 };
    });

    const firstIdx = pickNextDrillCardIndex();
    state.currentIndex = firstIdx >= 0 ? firstIdx : 0;
}

function fixDrillRoundStart(roundIds, recentIds) {
    if (!Array.isArray(roundIds) || roundIds.length === 0) {
        return roundIds;
    }
    const recentSet = new Set(recentIds);
    for (let i = 0; i < roundIds.length; i += 1) {
        if (!recentSet.has(roundIds[0])) {
            return roundIds;
        }
        roundIds.push(roundIds.shift());
    }
    return roundIds;
}

function pickNextDrillCardIndex() {
    if (!state.drillActive) {
        return -1;
    }
    if (state.drillCurrentRoundIds.length === 0) {
        if (state.drillActiveIds.length === 0) {
            return -1;
        }
        const round = shuffleCopy(state.drillActiveIds.slice());
        state.drillCurrentRoundIds = fixDrillRoundStart(round, state.drillRecentIds);
    }
    while (state.drillCurrentRoundIds.length > 0) {
        const cardId = state.drillCurrentRoundIds.shift();
        if (!state.drillActiveIds.includes(cardId)) {
            continue;
        }
        const idx = state.drillCardIndexById[cardId];
        if (Number.isInteger(idx) && idx >= 0 && idx < state.sessionCards.length) {
            return idx;
        }
    }
    return pickNextDrillCardIndex();
}

function buildDrillEndSummary(endedEarly) {
    const totalDone = Math.max(0, Number.parseInt(state.drillAttemptsDone, 10) || 0);
    const target = Math.max(totalDone, Number.parseInt(state.drillTargetAttempts, 10) || 0);
    let speedReached = 0;
    let needsMore = 0;
    Object.values(state.drillCardStats || {}).forEach((stats) => {
        if (!stats) {
            return;
        }
        const fast = Math.max(0, Number.parseInt(stats.fastCorrectCount, 10) || 0);
        const attempts = Math.max(0, Number.parseInt(stats.sessionAttemptCount, 10) || 0);
        if (attempts <= 0) {
            return;
        }
        if (fast >= DRILL_FAST_CORRECT_NEEDED) {
            speedReached += 1;
        } else {
            needsMore += 1;
        }
    });
    const title = endedEarly ? 'Ended early' : 'Speed Drill Complete';
    const speedTargetMs = Math.max(
        1,
        Number.parseInt(state.drillSpeedTargetMs, 10) || DRILL_FALLBACK_SPEED_TARGET_MS
    );
    const speedTargetLabel = `${(speedTargetMs / 1000).toFixed(1)}s`;
    return [
        `<strong>${escapeHtml(title)}</strong>`,
        `${totalDone}/${target} questions · Fast ≤ ${speedTargetLabel}`,
        `Speed goal reached: ${speedReached} · Needs more practice: ${needsMore}`,
    ].join('<br>');
}
function recordDrillAttempt(cardId, correct, responseTimeMs) {
    if (!state.drillActive) {
        return;
    }
    const id = Number.parseInt(cardId, 10);
    if (!Number.isInteger(id) || id <= 0) {
        return;
    }
    const stats = state.drillCardStats[id] || { fastCorrectCount: 0, sessionAttemptCount: 0 };
    stats.sessionAttemptCount += 1;
    const ms = Math.max(0, Number.parseInt(responseTimeMs, 10) || 0);
    const speedTargetMs = Math.max(
        1,
        Number.parseInt(state.drillSpeedTargetMs, 10) || DRILL_FALLBACK_SPEED_TARGET_MS
    );
    if (correct && ms <= speedTargetMs) {
        stats.fastCorrectCount += 1;
    }
    state.drillCardStats[id] = stats;
    state.drillAttemptsDone += 1;
    state.drillRecentIds.push(id);
    if (state.drillRecentIds.length > DRILL_RECENT_GAP) {
        state.drillRecentIds.shift();
    }

    if (stats.fastCorrectCount >= DRILL_FAST_CORRECT_NEEDED) {
        state.drillActiveIds = state.drillActiveIds.filter((activeId) => activeId !== id);
        if (state.drillQueueIds.length > 0) {
            const nextId = state.drillQueueIds.shift();
            state.drillActiveIds.push(nextId);
            if (!state.drillCardStats[nextId]) {
                state.drillCardStats[nextId] = { fastCorrectCount: 0, sessionAttemptCount: 0 };
            }
        }
    }
}
function showCurrentQuestion() {
    if (state.sessionCards.length === 0 || !isType(BEHAVIOR_TYPE_I)) {
        return;
    }

    stopAudioPlayback();
    showTypeSpecificCardSections();

    const card = state.sessionCards[state.currentIndex];
    if (state.drillActive) {
        renderPracticeProgress(
            progress,
            progressFill,
            state.drillAttemptsDone + 1,
            state.drillTargetAttempts,
            'Question'
        );
    } else {
        renderPracticeProgress(
            progress,
            progressFill,
            state.currentIndex + 1,
            state.sessionCards.length,
            'Card'
        );
    }
    if (hasMathNotation(card.front)) {
        cardQuestion.innerHTML = renderMathHtml(card.front);
    } else {
        cardQuestion.textContent = card.front;
    }
    if (state.hasChineseSpecificLogic) {
        cardAnswer.innerHTML = getChineseType1BackHtml(card.back);
    } else {
        cardAnswer.textContent = String(card.back || '');
    }

    state.answerRevealed = false;
    state.type1WrongAnswerReview = false;
    state.type1PromptAudioUsed = false;
    state.cardShownAtMs = Date.now();
    state.pausedDurationMs = 0;
    state.pauseStartedAtMs = 0;
    state.isPaused = false;
    prepareType1MultipleChoiceOptions(card);

    setPausedVisual(false);
    applyJudgeModeUi();
}
function normalizeType1ChoiceText(value) {
    return String(value ?? '').trim();
}

function shuffleCopy(list) {
    const items = Array.isArray(list) ? list.slice() : [];
    if (typeof window.PracticeUiCommon?.shuffleCards === 'function') {
        return window.PracticeUiCommon.shuffleCards(items);
    }
    for (let i = items.length - 1; i > 0; i -= 1) {
        const j = Math.floor(Math.random() * (i + 1));
        [items[i], items[j]] = [items[j], items[i]];
    }
    return items;
}

function buildType1MultipleChoiceOptions(card) {
    const extractChoice = (rawBack) => {
        if (!state.hasChineseSpecificLogic) {
            return rawBack;
        }
        return getChineseType1BackText(rawBack);
    };

    const correctText = normalizeType1ChoiceText(extractChoice(card?.back));
    if (!correctText) {
        return [];
    }

    const sourceCards = Array.isArray(state.type1MultipleChoicePoolCards)
        && state.type1MultipleChoicePoolCards.length > 0
        ? state.type1MultipleChoicePoolCards
        : state.sessionCards;
    const currentCardId = Number.parseInt(card?.id, 10);
    const distractorPool = [];
    sourceCards.forEach((item) => {
        const itemId = Number.parseInt(item?.id, 10);
        if (
            Number.isInteger(currentCardId)
            && currentCardId > 0
            && Number.isInteger(itemId)
            && itemId === currentCardId
        ) {
            return;
        }
        const normalized = normalizeType1ChoiceText(extractChoice(item?.back));
        if (!normalized || normalized === correctText) {
            return;
        }
        distractorPool.push(normalized);
    });

    const distractors = [];
    const seenUnique = new Set();
    const addUniqueDistractor = (text) => {
        const normalized = normalizeType1ChoiceText(text);
        if (!normalized || normalized === correctText || seenUnique.has(normalized)) {
            return;
        }
        seenUnique.add(normalized);
        distractors.push(normalized);
    };
    shuffleCopy(distractorPool).forEach(addUniqueDistractor);
    while (
        distractors.length < (TYPE1_MULTIPLE_CHOICE_OPTION_COUNT - 1)
        && distractorPool.length > 0
    ) {
        const randomIndex = Math.floor(Math.random() * distractorPool.length);
        distractors.push(distractorPool[randomIndex]);
    }
    const options = [
        { text: correctText, isCorrect: true },
        ...distractors
            .slice(0, TYPE1_MULTIPLE_CHOICE_OPTION_COUNT - 1)
            .map((text) => ({ text, isCorrect: false })),
    ];
    return shuffleCopy(options);
}

function buildType1LoggedChoicePayload(options, choice) {
    const submittedAnswer = normalizeType1ChoiceText(choice?.text);
    if (!submittedAnswer) {
        return null;
    }
    const distractorAnswers = [];
    const seen = new Set();
    (Array.isArray(options) ? options : []).forEach((option) => {
        if (!option || option.isCorrect) {
            return;
        }
        const text = normalizeType1ChoiceText(option.text);
        if (!text || seen.has(text)) {
            return;
        }
        seen.add(text);
        distractorAnswers.push(text);
    });
    return {
        submittedAnswer,
        distractorAnswers,
    };
}

function prepareType1MultipleChoiceOptions(card) {
    state.type1MultipleChoiceOptions = buildType1MultipleChoiceOptions(card);
}
function renderType1MultipleChoiceOptions() {
    if (!multiChoiceGrid || !isType(BEHAVIOR_TYPE_I)) {
        return;
    }
    const options = Array.isArray(state.type1MultipleChoiceOptions)
        ? state.type1MultipleChoiceOptions
        : [];
    if (options.length === 0) {
        multiChoiceGrid.innerHTML = '';
        return;
    }
    const optionsHtml = options.map((option, index) => {
        return `<button type="button" class="control-btn multi-choice-btn" data-choice-index="${index}"${state.isPaused ? ' disabled' : ''}>${escapeHtml(option.text)}</button>`;
    }).join('');
    const idkHtml = `<button type="button" class="control-btn multi-choice-btn multi-choice-idk-btn" data-multi-choice-idk="1"${state.isPaused ? ' disabled' : ''}>I don't know</button>`;
    multiChoiceGrid.innerHTML = optionsHtml + idkHtml;
}

function answerType1IDontKnow() {
    if (!isType(BEHAVIOR_TYPE_I) || !window.PracticeSession.hasActiveSession(state.activePendingSessionId)) {
        return;
    }
    if (state.type1WrongAnswerReview || state.isPaused) {
        return;
    }
    if (state.hasChineseSpecificLogic) {
        recordType1Answer(false, null, { idk: true });
        showType1WrongAnswerReview('');
        return;
    }
    answerType1Card(false, null, { idk: true });
}
function answerType1MultipleChoice(choiceIndex) {
    if (!isType(BEHAVIOR_TYPE_I) || !window.PracticeSession.hasActiveSession(state.activePendingSessionId)) {
        return;
    }
    if (state.type1WrongAnswerReview) {
        return;
    }
    const index = Number.parseInt(choiceIndex, 10);
    if (!Number.isInteger(index) || index < 0) {
        return;
    }
    const options = Array.isArray(state.type1MultipleChoiceOptions)
        ? state.type1MultipleChoiceOptions
        : [];
    const choice = options[index];
    if (!choice) {
        return;
    }
    const correct = Boolean(choice.isCorrect);
    const loggedChoice = buildType1LoggedChoicePayload(options, choice);
    if (!correct && state.hasChineseSpecificLogic) {
        if (state.isPaused || !window.PracticeSession.hasActiveSession(state.activePendingSessionId)) {
            return;
        }
        recordType1Answer(false, loggedChoice);
        showType1WrongAnswerReview(choice.text);
        return;
    }
    answerType1Card(correct, loggedChoice);
}

function showType1WrongAnswerReview(wrongChoiceText) {
    state.type1WrongAnswerReview = true;
    const card = state.sessionCards[state.currentIndex];
    const correctHtml = getChineseType1BackHtml(card?.back);
    const wrongText = String(wrongChoiceText || '').trim();
    const wrongHtml = wrongText
        ? `<div class="wrong-answer-review"><span class="wrong-answer-review-label">You picked:</span> <span class="wrong-answer-review-text">${escapeHtml(wrongText)}</span> <span class="wrong-answer-review-x">${icon('x', { size: 18 })}</span></div>`
        : '';
    cardAnswer.innerHTML = `${wrongHtml}<div class="correct-answer-review">${correctHtml}</div>`;
    cardAnswer.classList.remove('hidden');
    flashcard.classList.add('revealed');
    if (multiChoiceGrid) {
        multiChoiceGrid.innerHTML = '<button type="button" class="control-btn multi-choice-btn multi-choice-next-btn" data-multi-choice-next="1">Next</button>';
    }
    updatePromptReplayButtonState();
}

function dismissType1WrongAnswerReview() {
    state.type1WrongAnswerReview = false;
    cardAnswer.classList.add('hidden');
    flashcard.classList.remove('revealed');
    advanceType1Card();
}
function revealType1Answer() {
    if (!isType(BEHAVIOR_TYPE_I)) {
        return;
    }
    if (state.answerRevealed || state.isPaused || state.sessionCards.length === 0) {
        return;
    }

    const judgeState = getJudgeModeUiState();
    if (!judgeState.isSelfMode) {
        return;
    }

    state.answerRevealed = true;
    applyJudgeModeUi();
}

function togglePauseFromCard() {
    if (!isType(BEHAVIOR_TYPE_I)) {
        return;
    }
    if (!window.PracticeSession.hasActiveSession(state.activePendingSessionId) || state.sessionCards.length === 0) {
        return;
    }

    if (!state.isPaused) {
        state.isPaused = true;
        state.pauseStartedAtMs = Date.now();
        setPausedVisual(true);
        return;
    }

    state.isPaused = false;
    if (state.pauseStartedAtMs > 0) {
        state.pausedDurationMs += Math.max(0, Date.now() - state.pauseStartedAtMs);
    }
    state.pauseStartedAtMs = 0;
    setPausedVisual(false);
}

function setPausedVisual(paused) {
    const judgeState = getJudgeModeUiState();
    cardQuestion.classList.toggle('hidden', paused);
    if (!state.type1WrongAnswerReview) {
        cardAnswer.classList.toggle('hidden', paused || !judgeState.showBackAnswer);
    }
    pauseMask.classList.toggle('hidden', !paused);
    applyJudgeModeUi();
}
function answerType1Card(correct, loggedChoice = null, options = {}) {
    const judgeState = getJudgeModeUiState();
    if (judgeState.isSelfMode && !state.answerRevealed) {
        return;
    }
    if (state.isPaused || !window.PracticeSession.hasActiveSession(state.activePendingSessionId)) {
        return;
    }
    recordType1Answer(correct, loggedChoice, options);
    advanceType1Card();
}

function recordType1Answer(correct, loggedChoice = null, options = {}) {
    const card = state.sessionCards[state.currentIndex];
    const responseTimeMs = Math.max(0, Date.now() - state.cardShownAtMs - state.pausedDurationMs);
    stopAudioPlayback();

    const answerPayload = {
        cardId: card.id,
        known: correct,
        responseTimeMs,
    };
    if (options && options.idk === true) {
        answerPayload.idk = true;
    }
    const submittedAnswer = String(loggedChoice?.submittedAnswer || '').trim();
    if (submittedAnswer) {
        answerPayload.submittedAnswer = submittedAnswer;
        const distractorAnswers = Array.isArray(loggedChoice?.distractorAnswers)
            ? loggedChoice.distractorAnswers
                .map((value) => String(value || '').trim())
                .filter(Boolean)
            : [];
        if (distractorAnswers.length > 0) {
            answerPayload.distractorAnswers = distractorAnswers;
        }
    }
    if (state.type1PromptAudioUsed) {
        answerPayload.usedPromptAudio = true;
    }
    state.sessionAnswers.push(answerPayload);
    if (state.drillActive) {
        recordDrillAttempt(card.id, correct, responseTimeMs);
    }
    updateFinishEarlyButtonState();

    if (correct) {
        state.rightCount += 1;
    } else {
        state.wrongCount += 1;
        if (hasBonusGameForCategory()) {
            state.wrongCardsInSession.push({
                id: card.id,
                front: String(card.front || '').trim(),
                back: String(card.back || '').trim(),
            });
        }
    }
}

function advanceType1Card() {
    if (state.drillActive) {
        if (state.drillAttemptsDone >= state.drillTargetAttempts) {
            void endSession();
            return;
        }
        const nextIdx = pickNextDrillCardIndex();
        if (nextIdx < 0) {
            void endSession();
            return;
        }
        state.currentIndex = nextIdx;
        showCurrentQuestion();
        return;
    }
    if (state.currentIndex >= state.sessionCards.length - 1) {
        void endSession();
        return;
    }
    state.currentIndex += 1;
    showCurrentQuestion();
}
async function endType1Session(endedEarly = false) {
    sessionScreen.classList.add('hidden');
    resultScreen.classList.remove('hidden');
    setHeaderBackToPracticeVisible(false);
    state.pendingResultEndedEarly = Boolean(endedEarly);
    setResultActionMode('saving');
    resetBonusGame();
    resultSummary.textContent = endedEarly ? 'Ended early · Saving results...' : 'Saving results...';

    try {
        showError('');
        const response = await window.PracticeSessionFlow.postCompleteSession(
            buildType1ApiUrl('practice/complete'),
            state.activePendingSessionId,
            state.sessionAnswers,
            { categoryKey: state.categoryKey }
        );
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
            throw new Error(payload.error || `HTTP ${response.status}`);
        }
        if (state.drillActive) {
            resultSummary.innerHTML = buildDrillEndSummary(endedEarly);
        } else {
            resultSummary.textContent = state.hasChineseSpecificLogic
                ? (
                    endedEarly
                        ? `Ended early · Known: ${state.rightCount} · Need practice: ${state.wrongCount}`
                        : `Known: ${state.rightCount} · Need practice: ${state.wrongCount}`
                )
                : (
                    endedEarly
                        ? `Ended early · Right: ${state.rightCount} · Wrong: ${state.wrongCount}`
                        : `Right: ${state.rightCount} · Wrong: ${state.wrongCount}`
                );
        }
        window.PracticeSession.clearSessionStart(state.activePendingSessionId);
        updateFinishEarlyButtonState();
        setResultActionMode('back');
        if (hasBonusGameForCategory()) {
            showBonusGameForWrongCards();
        } else {
            resetBonusGame();
        }
    } catch (error) {
        console.error('Error completing type-I session:', error);
        resultSummary.textContent = 'Could not save this session yet.';
        setResultActionMode('retry-save');
        showError('Failed to save session results');
        return;
    }

}
function resetBonusGame() {
    state.bonusSourceCards = [];
    state.bonusTiles = [];
    state.bonusSelectedTileIndexes = [];
    state.bonusMatchedPairCount = 0;
    bonusGameSection.classList.add('hidden');
    bonusGameHint.textContent = '';
    bonusGameStatus.textContent = '';
    bonusGameBoard.innerHTML = '';
    setResultActionMode(state.resultActionMode);
}

function showBonusGameForWrongCards() {
    if (!hasBonusGameForCategory()) {
        resetBonusGame();
        return;
    }
    let wrongCards = getUniqueWrongCards(state.wrongCardsInSession);
    if (wrongCards.length === 0) {
        resetBonusGame();
        return;
    }
    // Cap at 10 pairs so the board isn't overwhelming; pick a random subset
    const MAX_BONUS_PAIRS = 10;
    if (wrongCards.length > MAX_BONUS_PAIRS) {
        wrongCards = window.PracticeUiCommon.shuffleCards([...wrongCards]).slice(0, MAX_BONUS_PAIRS);
    }
    setResultBackToPracticeVisible(false);
    state.bonusSourceCards = wrongCards;
    bonusGameSection.classList.remove('hidden');
    bonusGameHint.textContent = `Tap two boxes to match each missed card with its correct answer (${wrongCards.length} pair${wrongCards.length === 1 ? '' : 's'}).`;
    startBonusGame(wrongCards);
}

function startBonusGame(sourceCards) {
    const cardsList = Array.isArray(sourceCards) ? sourceCards : [];
    const tiles = [];
    cardsList.forEach((card) => {
        const key = String(card.pairKey || '');
        tiles.push({ pairKey: key, side: 'front', text: String(card.front || '?'), matched: false });
        let backText;
        if (state.hasChineseSpecificLogic) {
            backText = getChineseType1BackText(card.back) || '(answer)';
        } else {
            backText = String(card.back || '(answer)');
        }
        tiles.push({
            pairKey: key,
            side: 'back',
            text: backText,
            matched: false,
        });
    });
    state.bonusTiles = window.PracticeUiCommon.shuffleCards(tiles);
    state.bonusSelectedTileIndexes = [];
    state.bonusMatchedPairCount = 0;
    renderBonusGameBoard();
    renderBonusGameStatus();
}

function renderBonusGameBoard() {
    bonusGameBoard.innerHTML = state.bonusTiles.map((tile, index) => {
        const isSelected = state.bonusSelectedTileIndexes.includes(index);
        const classes = [
            'bonus-tile',
            isSelected ? 'selected' : '',
            tile.matched ? 'matched' : '',
            state.hasChineseSpecificLogic ? 'chinese-text' : '',
        ].filter(Boolean).join(' ');
        return `<button type="button" class="${classes}" data-bonus-index="${index}"${tile.matched ? ' disabled' : ''}>${escapeHtml(tile.text)}</button>`;
    }).join('');
}

function renderBonusGameStatus() {
    const pairTotal = state.bonusSourceCards.length;
    if (pairTotal <= 0) {
        bonusGameStatus.textContent = '';
        setResultBackToPracticeVisible(true);
        return;
    }
    if (state.bonusMatchedPairCount >= pairTotal) {
        bonusGameStatus.textContent = `Great job! Matched all ${pairTotal} pair${pairTotal === 1 ? '' : 's'}.`;
        setResultBackToPracticeVisible(true);
        return;
    }
    bonusGameStatus.textContent = `Matched ${state.bonusMatchedPairCount} / ${pairTotal}`;
    setResultBackToPracticeVisible(false);
}

function onBonusGameBoardClick(event) {
    if (!hasBonusGameForCategory()) {
        return;
    }
    const tileBtn = event.target.closest('[data-bonus-index]');
    if (!tileBtn) {
        return;
    }
    const tileIndex = Number.parseInt(tileBtn.getAttribute('data-bonus-index'), 10);
    if (!Number.isInteger(tileIndex)) {
        return;
    }
    const tile = state.bonusTiles[tileIndex];
    if (!tile || tile.matched) {
        return;
    }
    if (state.bonusSelectedTileIndexes.includes(tileIndex)) {
        return;
    }
    if (state.bonusSelectedTileIndexes.length >= 2) {
        return;
    }

    state.bonusSelectedTileIndexes.push(tileIndex);
    renderBonusGameBoard();

    if (state.bonusSelectedTileIndexes.length < 2) {
        return;
    }

    const [firstIndex, secondIndex] = state.bonusSelectedTileIndexes;
    const firstTile = state.bonusTiles[firstIndex];
    const secondTile = state.bonusTiles[secondIndex];
    const isMatch = firstTile && secondTile
        && firstTile.pairKey === secondTile.pairKey
        && firstTile.side !== secondTile.side;

    if (isMatch) {
        firstTile.matched = true;
        secondTile.matched = true;
        state.bonusMatchedPairCount += 1;
        state.bonusSelectedTileIndexes = [];
        renderBonusGameBoard();
        renderBonusGameStatus();
        return;
    }

    setTimeout(() => {
        state.bonusSelectedTileIndexes = [];
        renderBonusGameBoard();
    }, 450);
}
