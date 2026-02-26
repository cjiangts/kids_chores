const API_BASE = `${window.location.origin}/api`;

const params = new URLSearchParams(window.location.search);
const kidId = params.get('id');

const kidNameEl = document.getElementById('kidName');
const backToPractice = document.getElementById('backToPractice');
const resultBackToPractice = document.getElementById('resultBackToPractice');
const errorMessage = document.getElementById('errorMessage');
const practiceSection = document.getElementById('practiceSection');
const startScreen = document.getElementById('startScreen');
const sessionScreen = document.getElementById('sessionScreen');
const resultScreen = document.getElementById('resultScreen');
const sessionInfo = document.getElementById('sessionInfo');
const progress = document.getElementById('progress');
const progressFill = document.getElementById('progressFill');
const flashcard = document.getElementById('flashcard');
const cardQuestion = document.getElementById('cardQuestion');
const cardAnswer = document.getElementById('cardAnswer');
const pauseMask = document.getElementById('pauseMask');
const knewBtn = document.getElementById('knewBtn');
const knewRow = document.getElementById('knewRow');
const judgeRow = document.getElementById('judgeRow');
const wrongBtn = document.getElementById('wrongBtn');
const rightBtn = document.getElementById('rightBtn');
const finishEarlyBtn = document.getElementById('finishEarlyBtn');
const resultSummary = document.getElementById('resultSummary');
const judgeModeToggleStart = document.getElementById('judgeModeToggleStart');

let currentKid = null;
let sessionCards = [];
let activePendingSessionId = null;
let currentIndex = 0;
let rightCount = 0;
let wrongCount = 0;
let answerRevealed = false;
let cardShownAtMs = 0;
let pausedDurationMs = 0;
let pauseStartedAtMs = 0;
let isPaused = false;
let sessionAnswers = [];
let configuredSessionCount = 0;
let judgeMode = 'self';
const JUDGE_MODE_STORAGE_KEY = 'practice_judge_mode_math';
const errorState = { lastMessage: '' };
const earlyFinishController = window.PracticeUiCommon.createEarlyFinishController({
    button: finishEarlyBtn,
    getHasActiveSession: () => (
        window.PracticeSession.hasActiveSession(activePendingSessionId)
        && sessionCards.length > 0
    ),
    getTotalCount: () => sessionCards.length,
    getRecordedCount: () => sessionAnswers.length,
    emptyAnswerMessage: 'Answer at least one question before finishing early.',
    showError: (message) => showError(message),
    onConfirmFinish: () => {
        void endSession(true);
    },
});


document.addEventListener('DOMContentLoaded', async () => {
    if (!kidId) {
        window.location.href = '/';
        return;
    }

    backToPractice.href = `/kid-practice-home.html?id=${kidId}`;
    resultBackToPractice.href = `/kid-practice-home.html?id=${kidId}`;
    backToPractice.addEventListener('click', (event) => {
        if (isSessionInProgress()) {
            const confirmed = window.confirm('Go back now? Your current session progress will be lost.');
            if (!confirmed) {
                event.preventDefault();
            }
        }
    });
    await loadKidInfo();
    initJudgeMode();
    await loadMathPracticeReadyState();
});

function isSessionInProgress() {
    return !sessionScreen.classList.contains('hidden')
        && window.PracticeSession.hasActiveSession(activePendingSessionId)
        && sessionCards.length > 0;
}


async function loadKidInfo() {
    try {
        const response = await fetch(`${API_BASE}/kids/${kidId}`);
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }
        currentKid = await response.json();
        kidNameEl.textContent = `${currentKid.name}'s Math`;
    } catch (error) {
        console.error('Error loading kid info:', error);
        showError('Failed to load kid information');
    }
}


async function loadMathPracticeReadyState() {
    try {
        showError('');
        const decksResponse = await fetch(`${API_BASE}/kids/${kidId}/math/decks`);
        if (!decksResponse.ok) {
            throw new Error(`HTTP ${decksResponse.status}`);
        }

        const decksData = await decksResponse.json();
        configuredSessionCount = Number.parseInt(decksData.total_session_count, 10) || 0;
        const deckList = Array.isArray(decksData.decks) ? decksData.decks : [];
        const availableWithConfig = deckList.some((deck) => (Number(deck.total_cards || 0) > 0) && (Number(deck.session_count || 0) > 0));

        if (configuredSessionCount <= 0) {
            practiceSection.classList.add('hidden');
            showError('Math practice is off. Ask your parent to set a session count in Manage Math.');
            return;
        }

        if (!availableWithConfig) {
            practiceSection.classList.add('hidden');
            showError('No math questions available for current deck settings.');
            return;
        }

        practiceSection.classList.remove('hidden');
        resetToStartScreen(configuredSessionCount);
    } catch (error) {
        console.error('Error preparing math practice:', error);
        showError('Failed to load math practice data');
    }
}


function resetToStartScreen(totalCards) {
    const target = Math.max(0, Number.parseInt(totalCards, 10) || 0);
    sessionInfo.textContent = `Session: ${target} questions`;

    sessionCards = [];
    window.PracticeSession.clearSessionStart(activePendingSessionId);
    activePendingSessionId = null;
    currentIndex = 0;
    rightCount = 0;
    wrongCount = 0;
    answerRevealed = false;

    startScreen.classList.remove('hidden');
    sessionScreen.classList.add('hidden');
    resultScreen.classList.add('hidden');
    updateFinishEarlyButtonState();
}

function initJudgeMode() {
    if (!window.PracticeJudgeMode) {
        return;
    }
    judgeMode = window.PracticeJudgeMode.loadMode(JUDGE_MODE_STORAGE_KEY, window.PracticeJudgeMode.SELF);
    const setMode = (nextMode) => {
        judgeMode = window.PracticeJudgeMode.saveMode(JUDGE_MODE_STORAGE_KEY, nextMode);
        syncJudgeModeToggles();
        applyJudgeModeUi();
    };
    const getMode = () => judgeMode;
    window.PracticeJudgeMode.bindToggleGroup(judgeModeToggleStart, { getMode, setMode });
    syncJudgeModeToggles();
}

function syncJudgeModeToggles() {
    if (!window.PracticeJudgeMode) {
        return;
    }
    window.PracticeJudgeMode.renderToggleGroup(judgeModeToggleStart, judgeMode);
}

function getJudgeModeUiState() {
    if (!window.PracticeJudgeMode) {
        return {
            isSelfMode: true,
            showRevealAction: true,
            showJudgeActions: false,
            showBackAnswer: false,
        };
    }
    return window.PracticeJudgeMode.getRevealJudgeUiState(judgeMode, answerRevealed);
}


async function startSession() {
    try {
        showError('');
        const started = await window.PracticeSessionFlow.startShuffledSession(
            `${API_BASE}/kids/${kidId}/math/practice/start`,
            {}
        );
        activePendingSessionId = started.pendingSessionId;
        sessionCards = started.cards;

        if (!window.PracticeSession.hasActiveSession(activePendingSessionId) || sessionCards.length === 0) {
            showError('No math questions available');
            return;
        }

        currentIndex = 0;
        rightCount = 0;
        wrongCount = 0;
        sessionAnswers = [];

        startScreen.classList.add('hidden');
        resultScreen.classList.add('hidden');
        sessionScreen.classList.remove('hidden');

        showCurrentQuestion();
        updateFinishEarlyButtonState();
    } catch (error) {
        console.error('Error starting math session:', error);
        showError('Failed to start math session');
    }
}


function showCurrentQuestion() {
    if (sessionCards.length === 0) {
        return;
    }

    const card = sessionCards[currentIndex];
    renderPracticeProgress(progress, progressFill, currentIndex + 1, sessionCards.length, 'Question');
    cardQuestion.textContent = card.front;
    cardAnswer.textContent = `= ${card.back}`;

    answerRevealed = false;

    cardShownAtMs = Date.now();
    pausedDurationMs = 0;
    pauseStartedAtMs = 0;
    isPaused = false;
    setPausedVisual(false);
}

function revealAnswer() {
    if (answerRevealed || isPaused || sessionCards.length === 0) {
        return;
    }
    const state = getJudgeModeUiState();
    if (!state.isSelfMode) {
        return;
    }

    answerRevealed = true;
    applyJudgeModeUi();
}


function togglePauseFromCard() {
    if (!window.PracticeSession.hasActiveSession(activePendingSessionId) || sessionCards.length === 0) {
        return;
    }

    if (!isPaused) {
        isPaused = true;
        pauseStartedAtMs = Date.now();
        setPausedVisual(true);
        return;
    }

    isPaused = false;
    if (pauseStartedAtMs > 0) {
        pausedDurationMs += Math.max(0, Date.now() - pauseStartedAtMs);
    }
    pauseStartedAtMs = 0;
    setPausedVisual(false);
}


function setPausedVisual(paused) {
    const state = getJudgeModeUiState();
    cardQuestion.classList.toggle('hidden', paused);
    cardAnswer.classList.toggle('hidden', paused || !state.showBackAnswer);
    pauseMask.classList.toggle('hidden', !paused);
    applyJudgeModeUi();
}


function answerCurrentCard(correct) {
    const state = getJudgeModeUiState();
    if ((state.isSelfMode && !answerRevealed) || isPaused || !window.PracticeSession.hasActiveSession(activePendingSessionId)) {
        return;
    }

    const card = sessionCards[currentIndex];
    const responseTimeMs = Math.max(0, Date.now() - cardShownAtMs - pausedDurationMs);

    sessionAnswers.push({
        cardId: card.id,
        known: correct,
        responseTimeMs,
    });
    updateFinishEarlyButtonState();

    if (correct) {
        rightCount += 1;
    } else {
        wrongCount += 1;
    }

    if (currentIndex >= sessionCards.length - 1) {
        endSession();
        return;
    }

    currentIndex += 1;
    showCurrentQuestion();
}

function updateFinishEarlyButtonState() {
    earlyFinishController.updateButtonState();
}

function requestEarlyFinish() {
    earlyFinishController.requestFinish();
}

function applyJudgeModeUi() {
    const state = getJudgeModeUiState();
    knewRow.classList.toggle('hidden', !state.showRevealAction);
    judgeRow.classList.toggle('hidden', !state.showJudgeActions);
    if (!isPaused) {
        cardAnswer.classList.toggle('hidden', !state.showBackAnswer);
    }
    flashcard.classList.toggle('revealed', state.showBackAnswer);
    knewBtn.disabled = isPaused || !state.showRevealAction;
    rightBtn.disabled = isPaused || !state.showJudgeActions;
    wrongBtn.disabled = isPaused || !state.showJudgeActions;
    updateFinishEarlyButtonState();
}


async function endSession(endedEarly = false) {
    sessionScreen.classList.add('hidden');
    resultScreen.classList.remove('hidden');
    resultSummary.textContent = endedEarly
        ? `Ended early · Right: ${rightCount} · Wrong: ${wrongCount}`
        : `Right: ${rightCount} · Wrong: ${wrongCount}`;

    try {
        await window.PracticeSessionFlow.postCompleteSession(
            `${API_BASE}/kids/${kidId}/math/practice/complete`,
            activePendingSessionId,
            sessionAnswers
        );
    } catch (error) {
        console.error('Error completing math session:', error);
        showError('Failed to save session results');
    }
    window.PracticeSession.clearSessionStart(activePendingSessionId);
    updateFinishEarlyButtonState();

    await loadKidInfo();
}


function showError(message) {
    window.PracticeUiCommon.showAlertError(errorState, errorMessage, message);
}
