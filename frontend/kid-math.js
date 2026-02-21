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
const resultSummary = document.getElementById('resultSummary');

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
const errorState = { lastMessage: '' };


document.addEventListener('DOMContentLoaded', async () => {
    if (!kidId) {
        window.location.href = '/';
        return;
    }

    backToPractice.href = `/kid.html?id=${kidId}`;
    resultBackToPractice.href = `/kid.html?id=${kidId}`;
    backToPractice.addEventListener('click', (event) => {
        if (isSessionInProgress()) {
            const confirmed = window.confirm('Go back now? Your current session progress will be lost.');
            if (!confirmed) {
                event.preventDefault();
            }
        }
    });
    await loadKidInfo();
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
            showError('Math practice is off. Ask your parent to set total cards and deck mix in Manage Math.');
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

    startScreen.classList.remove('hidden');
    sessionScreen.classList.add('hidden');
    resultScreen.classList.add('hidden');
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
    cardAnswer.classList.add('hidden');
    judgeRow.classList.add('hidden');
    knewRow.classList.remove('hidden');
    flashcard.classList.remove('revealed');

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

    answerRevealed = true;
    cardAnswer.classList.remove('hidden');
    flashcard.classList.add('revealed');
    knewRow.classList.add('hidden');
    judgeRow.classList.remove('hidden');

    rightBtn.disabled = false;
    wrongBtn.disabled = false;
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
    cardQuestion.classList.toggle('hidden', paused);
    cardAnswer.classList.toggle('hidden', paused || !answerRevealed);
    pauseMask.classList.toggle('hidden', !paused);

    knewBtn.disabled = paused;
    if (answerRevealed) {
        rightBtn.disabled = paused;
        wrongBtn.disabled = paused;
    } else {
        rightBtn.disabled = true;
        wrongBtn.disabled = true;
    }
}


function answerCurrentCard(correct) {
    if (!answerRevealed || isPaused || !window.PracticeSession.hasActiveSession(activePendingSessionId)) {
        return;
    }

    const card = sessionCards[currentIndex];
    const responseTimeMs = Math.max(0, Date.now() - cardShownAtMs - pausedDurationMs);

    sessionAnswers.push({
        cardId: card.id,
        known: correct,
        responseTimeMs,
    });

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


async function endSession() {
    sessionScreen.classList.add('hidden');
    resultScreen.classList.remove('hidden');
    resultSummary.textContent = `Right: ${rightCount} · Wrong: ${wrongCount}`;

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

    await loadKidInfo();
}


function showError(message) {
    window.PracticeUiCommon.showAlertError(errorState, errorMessage, message);
}
