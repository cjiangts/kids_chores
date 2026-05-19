// Type-IV practice runtime (generator-produced math problems).
//
// Layout:
//   1. Session start: ready-state + start
//   2. Multiple-choice options (compute + render + answer)
//   3. Per-item rendering + typed-answer flow
//   4. Session end

// =====================================================================
// === 1. Session start: ready-state + start
// =====================================================================

async function loadType4ReadyState() {
    showError('');
    const response = await fetch(buildType4ApiUrl('decks'));
    if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
    }

    const data = await response.json();
    resetReadyRetryState();
    applyReadyRetryState(data);
    state.configuredSessionCount = Number.parseInt(data.total_session_count, 10) || 0;
    const deckList = Array.isArray(data.decks) ? data.decks : [];
    const hasOptedInDeck = deckList.some((deck) => Boolean(deck && deck.opted_in));
    const targetCount = state.readyIsContinueSession
        ? state.readyContinueCardCount
        : (state.readyIsRetrySession ? state.readyRetryCardCount : state.configuredSessionCount);

    if (!state.readyIsContinueSession && !state.readyIsRetrySession && !hasOptedInDeck) {
        practiceSection.classList.add('hidden');
        showError(`No ${getCurrentCategoryDisplayName()} decks yet. Ask your parent to opt one in first.`);
        return;
    }

    if (!state.readyIsContinueSession && !state.readyIsRetrySession && state.configuredSessionCount <= 0) {
        practiceSection.classList.add('hidden');
        showError(`${getCurrentCategoryDisplayName()} practice is off. Ask your parent to set deck counts in Manage ${getCurrentCategoryDisplayName()}.`);
        return;
    }

    if (targetCount <= 0) {
        practiceSection.classList.add('hidden');
        if (state.readyIsContinueSession) {
            showError('Continue session has no available questions right now. Ask your parent to check deck counts.');
            return;
        }
        if (state.readyIsRetrySession) {
            showError('Retry session has no available questions right now. Ask your parent to check deck counts.');
            return;
        }
        showError(`No ${getCurrentCategoryDisplayName()} questions available for current deck counts.`);
        return;
    }

    practiceSection.classList.remove('hidden');
    resetToStartScreen(targetCount);
}
async function startType4Session() {
    try {
        showError('');
        const practiceMode = window.PracticeJudgeMode?.isMultiMode(state.judgeMode)
            ? 'multi'
            : 'input';
        const started = await window.PracticeSessionFlow.startShuffledSession(
            buildType4ApiUrl('practice/start'),
            {
                categoryKey: state.categoryKey,
                practiceMode,
            }
        );
        applyServerPracticeMode(started?.data?.practice_mode);
        state.activePendingSessionId = started.pendingSessionId;
        state.activeIsRetrySession = Boolean(started?.data?.is_retry_session);
        state.sessionCards = started.cards;

        if (!window.PracticeSession.hasActiveSession(state.activePendingSessionId) || state.sessionCards.length === 0) {
            state.activeIsRetrySession = false;
            showError(`No ${getCurrentCategoryDisplayName()} questions available`);
            return;
        }

        state.currentIndex = 0;
        state.rightCount = 0;
        state.wrongCount = 0;
        state.sessionAnswers = [];
        state.type4MultipleChoiceOptions = [];

        startScreen.classList.add('hidden');
        resultScreen.classList.add('hidden');
        sessionScreen.classList.remove('hidden');
        setHeaderBackToPracticeVisible(false);

        showCurrentType4Item();
        updateFinishEarlyButtonState();
    } catch (error) {
        console.error('Error starting generator practice session:', error);
        showError(`Failed to start ${getCurrentCategoryDisplayName()} session`);
    }
}
// =====================================================================
// === 2. Multiple-choice options (compute + render + answer)
// =====================================================================

function answerType4IDontKnow() {
    if (!isType(BEHAVIOR_TYPE_IV) || !window.PracticeSession.hasActiveSession(state.activePendingSessionId)) {
        return;
    }
    answerType4Item('');
}
function getType4ChoiceOptions(card = null) {
    const sourceCard = card || state.sessionCards[state.currentIndex] || {};
    const rawChoices = Array.isArray(sourceCard.choices) ? sourceCard.choices : [];
    return rawChoices
        .map((choice) => String(choice ?? '').trim())
        .filter(Boolean);
}

function shouldUseType4MultipleChoiceUi(card = null) {
    const sourceCard = card || state.sessionCards[state.currentIndex] || {};
    return Boolean(
        window.PracticeJudgeMode?.isMultiMode(state.judgeMode)
        || sourceCard.isMultichoiceOnly
    );
}

function renderType4MultipleChoiceOptions() {
    if (!multiChoiceGrid || !isType(BEHAVIOR_TYPE_IV)) {
        return;
    }
    const options = Array.isArray(state.type4MultipleChoiceOptions)
        ? state.type4MultipleChoiceOptions
        : [];
    if (options.length === 0) {
        multiChoiceGrid.innerHTML = '';
        return;
    }
    const optionsHtml = options.map((text, index) => {
        return `<button type="button" class="control-btn multi-choice-btn" data-choice-index="${index}">${escapeHtml(text)}</button>`;
    }).join('');
    const idkHtml = `<button type="button" class="control-btn multi-choice-btn multi-choice-idk-btn" data-multi-choice-idk="1">I don't know</button>`;
    multiChoiceGrid.innerHTML = optionsHtml + idkHtml;
}

// =====================================================================
// === 3. Per-item rendering + typed-answer flow
// =====================================================================

function showCurrentType4Item() {
    if (state.sessionCards.length === 0 || !isType(BEHAVIOR_TYPE_IV)) {
        return;
    }

    showTypeSpecificCardSections();

    const card = state.sessionCards[state.currentIndex];
    renderPracticeProgress(
        progress,
        progressFill,
        state.currentIndex + 1,
        state.sessionCards.length,
        'Question'
    );
    const questionText = String(card?.front || '');
    const prevAnswers = !shouldUseType4MultipleChoiceUi(card) && Array.isArray(card.previousAnswers)
        ? card.previousAnswers : [];
    const prevGrades = Array.isArray(card.previousGrades) ? card.previousGrades : [];
    if (prevAnswers.length > 0) {
        const hasWrong = prevGrades.some((g) => g === -1);
        const hasHalf = prevGrades.some((g) => g === 2);
        const hasRight = prevGrades.some((g) => g === 1 || g <= -2);
        const legendParts = [];
        if (hasRight) legendParts.push('<span class="prev-answer-right">●</span> right');
        if (hasHalf) legendParts.push('<span class="prev-answer-half">●</span> half');
        if (hasWrong) legendParts.push('<span class="prev-answer-wrong">●</span> wrong');
        const legendHtml = legendParts.length > 0
            ? `<div class="prev-answers-legend">${legendParts.join(' ')}</div>`
            : '';
        const pills = prevAnswers.map((a, i) => {
            const grade = Number(prevGrades[i]);
            let cls = 'prev-answer-wrong';
            if (grade === 1 || grade <= -2) cls = 'prev-answer-right';
            else if (grade === 2) cls = 'prev-answer-half';
            return `<span class="${cls}">${escapeHtml(a)}</span>`;
        }).join(' ');
        cardQuestion.innerHTML = `${renderMathHtml(questionText)}<div class="prev-answers-label">Your previous answers:</div><div class="prev-answers-row">${pills}</div>${legendHtml}`;
    } else {
        if (hasMathNotation(questionText)) {
            cardQuestion.innerHTML = renderMathHtml(questionText);
        } else {
            cardQuestion.textContent = questionText;
        }
    }
    cardAnswer.textContent = '';
    state.answerRevealed = false;
    state.cardShownAtMs = Date.now();
    state.pausedDurationMs = 0;
    state.pauseStartedAtMs = 0;
    state.isPaused = false;
    state.type4MultipleChoiceOptions = getType4ChoiceOptions(card);
    if (type4AnswerInput) {
        type4AnswerInput.value = '';
    }
    syncType4DoneBtnState();
    applyJudgeModeUi();
    if (!shouldUseType4MultipleChoiceUi(card) && type4AnswerInput) {
        window.setTimeout(() => {
            type4AnswerInput.focus();
            type4AnswerInput.select();
        }, 0);
    }
}
function answerType4Item(submittedAnswer) {
    if (!isType(BEHAVIOR_TYPE_IV) || !window.PracticeSession.hasActiveSession(state.activePendingSessionId)) {
        return;
    }

    const card = state.sessionCards[state.currentIndex];
    const responseTimeMs = Math.max(0, Date.now() - state.cardShownAtMs);
    state.sessionAnswers.push({
        cardId: card.id,
        submittedAnswer: String(submittedAnswer ?? ''),
        responseTimeMs,
    });
    updateFinishEarlyButtonState();

    if (state.currentIndex >= state.sessionCards.length - 1) {
        void endSession();
        return;
    }

    state.currentIndex += 1;
    showCurrentType4Item();
}

function answerType4MultipleChoice(choiceIndex) {
    if (!isType(BEHAVIOR_TYPE_IV)) {
        return;
    }
    const index = Number.parseInt(choiceIndex, 10);
    if (!Number.isInteger(index) || index < 0) {
        return;
    }
    const options = Array.isArray(state.type4MultipleChoiceOptions)
        ? state.type4MultipleChoiceOptions
        : [];
    const selected = options[index];
    if (typeof selected !== 'string') {
        return;
    }
    answerType4Item(selected);
}

function syncType4DoneBtnState() {
    if (type4AnswerDoneBtn && type4AnswerInput) {
        const empty = !type4AnswerInput.value.trim();
        type4AnswerDoneBtn.disabled = empty;
        type4AnswerDoneBtn.style.opacity = empty ? '0.45' : '';
    }
}

function submitType4TypedAnswer() {
    if (!isType(BEHAVIOR_TYPE_IV) || !type4AnswerInput) {
        return;
    }
    if (!type4AnswerInput.value.trim()) {
        return;
    }
    answerType4Item(type4AnswerInput.value);
}
// =====================================================================
// === 4. Session end
// =====================================================================

async function endType4Session(endedEarly = false) {
    sessionScreen.classList.add('hidden');
    resultScreen.classList.remove('hidden');
    setHeaderBackToPracticeVisible(false);
    state.pendingResultEndedEarly = Boolean(endedEarly);
    setResultActionMode('saving');
    resultSummary.textContent = endedEarly
        ? 'Ended early... saving results'
        : 'Saving results...';

    try {
        showError('');
        const response = await window.PracticeSessionFlow.postCompleteSession(
            buildType4ApiUrl('practice/complete'),
            state.activePendingSessionId,
            state.sessionAnswers,
            { categoryKey: state.categoryKey }
        );
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
            throw new Error(payload.error || `HTTP ${response.status}`);
        }
        const wrongCount = Number.parseInt(payload?.wrong_count, 10) || 0;
        const partialCount = Number.parseInt(payload?.partial_count, 10) || 0;
        const answeredCount = Number.parseInt(payload?.answer_count, 10) || state.sessionAnswers.length;
        const targetCount = Number.parseInt(payload?.target_answer_count, 10) || answeredCount;
        const isRetry = Boolean(payload?.is_retry_session);
        const displayTotal = isRetry ? answeredCount : targetCount;
        const partialSuffix = partialCount > 0 ? ` · Half: ${partialCount}` : '';
        resultSummary.textContent = endedEarly
            ? `Ended early · Wrong: ${wrongCount} of ${answeredCount} answered${partialSuffix}`
            : `Wrong: ${wrongCount} of ${displayTotal}${partialSuffix}`;
        window.PracticeSession.clearSessionStart(state.activePendingSessionId);
        updateFinishEarlyButtonState();
        setResultActionMode('back');
    } catch (error) {
        console.error('Error completing generator session:', error);
        resultSummary.textContent = 'Could not save this session yet.';
        setResultActionMode('retry-save');
        showError('Failed to save session results');
        return;
    }

}
