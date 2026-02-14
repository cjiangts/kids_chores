const API_BASE = `${window.location.origin}/api`;

const params = new URLSearchParams(window.location.search);
const kidId = params.get('id');

const kidNameEl = document.getElementById('kidName');
const backToPractice = document.getElementById('backToPractice');
const errorMessage = document.getElementById('errorMessage');
const practiceSection = document.getElementById('practiceSection');
const emptyState = document.getElementById('emptyState');
const startScreen = document.getElementById('startScreen');
const sessionScreen = document.getElementById('sessionScreen');
const resultScreen = document.getElementById('resultScreen');
const sessionInfo = document.getElementById('sessionInfo');
const progress = document.getElementById('progress');
const flashcard = document.getElementById('flashcard');
const cardQuestion = document.getElementById('cardQuestion');
const cardAnswer = document.getElementById('cardAnswer');
const pauseMask = document.getElementById('pauseMask');
const knewBtn = document.getElementById('knewBtn');
const judgeRow = document.getElementById('judgeRow');
const wrongBtn = document.getElementById('wrongBtn');
const rightBtn = document.getElementById('rightBtn');
const resultSummary = document.getElementById('resultSummary');

let currentKid = null;
let sessionCards = [];
let activeSessionId = null;
let currentIndex = 0;
let rightCount = 0;
let wrongCount = 0;
let answerRevealed = false;
let cardShownAtMs = 0;
let pausedDurationMs = 0;
let pauseStartedAtMs = 0;
let isPaused = false;
let isSubmittingAnswer = false;


document.addEventListener('DOMContentLoaded', async () => {
    if (!kidId) {
        window.location.href = '/';
        return;
    }

    backToPractice.href = `/kid.html?id=${kidId}`;
    await loadKidInfo();
    await ensureMathSeedAndReady();
});


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


async function ensureMathSeedAndReady() {
    try {
        showError('');
        const seedResponse = await fetch(`${API_BASE}/kids/${kidId}/math/seed`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({})
        });

        if (!seedResponse.ok) {
            throw new Error(`HTTP ${seedResponse.status}`);
        }

        const cardsResponse = await fetch(`${API_BASE}/kids/${kidId}/math/cards`);
        if (!cardsResponse.ok) {
            throw new Error(`HTTP ${cardsResponse.status}`);
        }

        const data = await cardsResponse.json();
        const totalCards = (data.cards || []).length;

        if (totalCards === 0) {
            emptyState.classList.remove('hidden');
            practiceSection.classList.add('hidden');
            return;
        }

        emptyState.classList.add('hidden');
        practiceSection.classList.remove('hidden');
        resetToStartScreen(totalCards);
    } catch (error) {
        console.error('Error preparing math practice:', error);
        showError('Failed to load math practice data');
    }
}


function resetToStartScreen(totalCards) {
    const target = Math.min(currentKid?.sessionCardCount || 10, totalCards);
    sessionInfo.textContent = `Session: ${target} questions`;

    sessionCards = [];
    activeSessionId = null;
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
        const response = await fetch(`${API_BASE}/kids/${kidId}/math/practice/start`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({})
        });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }

        const data = await response.json();
        activeSessionId = data.session_id;
        sessionCards = data.cards || [];

        if (!activeSessionId || sessionCards.length === 0) {
            showError('No math questions available');
            return;
        }

        currentIndex = 0;
        rightCount = 0;
        wrongCount = 0;

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
    progress.textContent = `Question ${currentIndex + 1} of ${sessionCards.length}`;
    cardQuestion.textContent = card.front;
    cardAnswer.textContent = `= ${card.back}`;

    answerRevealed = false;
    cardAnswer.classList.add('hidden');
    judgeRow.classList.add('hidden');
    knewBtn.classList.remove('hidden');
    flashcard.classList.remove('revealed');

    cardShownAtMs = Date.now();
    pausedDurationMs = 0;
    pauseStartedAtMs = 0;
    isPaused = false;
    setPausedVisual(false);
}


function revealAnswer() {
    if (answerRevealed || isPaused || isSubmittingAnswer || sessionCards.length === 0) {
        return;
    }

    answerRevealed = true;
    cardAnswer.classList.remove('hidden');
    flashcard.classList.add('revealed');
    knewBtn.classList.add('hidden');
    judgeRow.classList.remove('hidden');

    rightBtn.disabled = false;
    wrongBtn.disabled = false;
}


function togglePauseFromCard() {
    if (!activeSessionId || sessionCards.length === 0 || isSubmittingAnswer) {
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


async function answerCurrentCard(correct) {
    if (!answerRevealed || isPaused || isSubmittingAnswer || !activeSessionId) {
        return;
    }

    const card = sessionCards[currentIndex];
    const responseTimeMs = Math.max(0, Date.now() - cardShownAtMs - pausedDurationMs);

    try {
        isSubmittingAnswer = true;
        rightBtn.disabled = true;
        wrongBtn.disabled = true;
        knewBtn.disabled = true;

        const response = await fetch(`${API_BASE}/kids/${kidId}/math/practice/answer`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                sessionId: activeSessionId,
                cardId: card.id,
                known: correct,
                responseTimeMs,
            })
        });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }

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
    } catch (error) {
        console.error('Error submitting math answer:', error);
        showError('Failed to save answer');
    } finally {
        isSubmittingAnswer = false;
    }
}


async function endSession() {
    sessionScreen.classList.add('hidden');
    resultScreen.classList.remove('hidden');
    resultSummary.textContent = `Right: ${rightCount} · Wrong: ${wrongCount}`;

    await loadKidInfo();
}


function showError(message) {
    if (message) {
        errorMessage.textContent = message;
        errorMessage.classList.remove('hidden');
    } else {
        errorMessage.classList.add('hidden');
    }
}
