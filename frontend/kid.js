// API Configuration
const API_BASE = `${window.location.origin}/api`;

// Get kid ID from URL
const urlParams = new URLSearchParams(window.location.search);
const kidId = urlParams.get('id');

// DOM Elements
const kidNameEl = document.getElementById('kidName');
const practiceSection = document.getElementById('practiceSection');
const emptyState = document.getElementById('emptyState');
const cardContent = document.getElementById('cardContent');
const progress = document.getElementById('progress');
const errorMessage = document.getElementById('errorMessage');
const practiceChooser = document.getElementById('practiceChooser');
const chinesePracticeOption = document.getElementById('chinesePracticeOption');
const mathPracticeOption = document.getElementById('mathPracticeOption');
const chineseStarBadge = document.getElementById('chineseStarBadge');
const mathStarBadge = document.getElementById('mathStarBadge');
const startScreen = document.getElementById('startScreen');
const sessionScreen = document.getElementById('sessionScreen');
const resultScreen = document.getElementById('resultScreen');
const sessionInfo = document.getElementById('sessionInfo');
const resultSummary = document.getElementById('resultSummary');
const pauseMask = document.getElementById('pauseMask');
const knowBtn = document.querySelector('.know-btn');
const dontKnowBtn = document.querySelector('.dont-know-btn');

let currentKid = null;
let cards = [];
let sessionCards = [];
let currentSessionIndex = 0;
let knownCount = 0;
let unknownCount = 0;
let activeSessionId = null;
let cardShownAtMs = 0;
let isSubmittingAnswer = false;
let isPaused = false;
let pauseStartedAtMs = 0;
let pausedDurationMs = 0;

// Initialize
document.addEventListener('DOMContentLoaded', async () => {
    if (!kidId) {
        window.location.href = '/';
        return;
    }

    await loadKidInfo();
    await loadCards();
});

// API Functions
async function loadKidInfo() {
    try {
        const response = await fetch(`${API_BASE}/kids/${kidId}`);
        if (!response.ok) {
            throw new Error('Kid not found');
        }
        currentKid = await response.json();
        kidNameEl.textContent = `${currentKid.name}'s Practice`;
        renderPracticeStars();
    } catch (error) {
        console.error('Error loading kid:', error);
        showError('Failed to load kid information');
        setTimeout(() => window.location.href = '/', 2000);
    }
}

async function loadCards() {
    try {
        showError('');
        const response = await fetch(`${API_BASE}/kids/${kidId}/cards`);

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const data = await response.json();
        cards = data.cards || [];
        practiceSection.classList.remove('hidden');
        resetToStartScreen();
    } catch (error) {
        console.error('Error loading cards:', error);
        showError('Failed to load cards');
    }
}

// Session Functions
function resetToStartScreen() {
    const count = Math.min(currentKid?.sessionCardCount || 10, cards.length);
    sessionInfo.textContent = `Session: ${count} characters`;

    activeSessionId = null;
    sessionCards = [];
    currentSessionIndex = 0;
    knownCount = 0;
    unknownCount = 0;

    const chineseEnabled = !!currentKid?.dailyPracticeChineseEnabled;
    const mathEnabled = !!currentKid?.dailyPracticeMathEnabled;

    chinesePracticeOption.classList.toggle('hidden', !chineseEnabled);
    mathPracticeOption.classList.toggle('hidden', !mathEnabled);

    emptyState.classList.add('hidden');
    practiceChooser.classList.remove('hidden');
    startScreen.classList.add('hidden');
    sessionScreen.classList.add('hidden');
    resultScreen.classList.add('hidden');

    if (!chineseEnabled && !mathEnabled) {
        emptyState.classList.remove('hidden');
        showError('No daily practice is assigned. Ask your parent to enable Chinese or Math.');
    } else {
        showError('');
    }
}

function renderPracticeStars() {
    const chineseCount = Number.isInteger(currentKid?.dailyCompletedChineseCountToday)
        ? currentKid.dailyCompletedChineseCountToday
        : 0;
    const mathCount = Number.isInteger(currentKid?.dailyCompletedMathCountToday)
        ? currentKid.dailyCompletedMathCountToday
        : 0;

    chineseStarBadge.textContent = chineseCount > 0 ? `Today: ${'⭐'.repeat(chineseCount)}` : 'Today: no stars yet';
    mathStarBadge.textContent = mathCount > 0 ? `Today: ${'⭐'.repeat(mathCount)}` : 'Today: no stars yet';
}

function chooseChinesePractice() {
    if (cards.length === 0) {
        emptyState.classList.remove('hidden');
        showError('No Chinese characters yet. Ask your parent to add some first.');
        return;
    }

    showError('');
    emptyState.classList.add('hidden');
    practiceChooser.classList.add('hidden');
    startScreen.classList.remove('hidden');
}

function goMathPractice() {
    window.location.href = `/kid-math.html?id=${kidId}`;
}

async function startSession() {
    if (cards.length === 0) {
        return;
    }

    try {
        showError('');

        const response = await fetch(`${API_BASE}/kids/${kidId}/practice/start`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({}),
        });

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const data = await response.json();
        activeSessionId = data.session_id;
        sessionCards = data.cards || [];

        if (!activeSessionId || sessionCards.length === 0) {
            await loadCards();
            return;
        }

        currentSessionIndex = 0;
        knownCount = 0;
        unknownCount = 0;

        startScreen.classList.add('hidden');
        practiceChooser.classList.add('hidden');
        resultScreen.classList.add('hidden');
        sessionScreen.classList.remove('hidden');

        displayCurrentCard();
    } catch (error) {
        console.error('Error starting session:', error);
        showError('Failed to start session');
    }
}

function displayCurrentCard() {
    if (sessionCards.length === 0) {
        return;
    }

    const card = sessionCards[currentSessionIndex];
    cardContent.textContent = card.front;
    progress.textContent = `Card ${currentSessionIndex + 1} of ${sessionCards.length}`;
    cardShownAtMs = Date.now();
    isPaused = false;
    pauseStartedAtMs = 0;
    pausedDurationMs = 0;
    setPausedVisual(false);
}

async function answerCurrentCard(known) {
    if (sessionCards.length === 0 || !activeSessionId || isSubmittingAnswer || isPaused) {
        return;
    }

    const currentCard = sessionCards[currentSessionIndex];
    const responseTimeMs = Math.max(0, Date.now() - cardShownAtMs - pausedDurationMs);

    try {
        isSubmittingAnswer = true;
        knowBtn.disabled = true;
        dontKnowBtn.disabled = true;

        const response = await fetch(`${API_BASE}/kids/${kidId}/practice/answer`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                sessionId: activeSessionId,
                cardId: currentCard.id,
                known,
                responseTimeMs,
            }),
        });

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        if (known) {
            knownCount += 1;
        } else {
            unknownCount += 1;
        }

        const isLastCard = currentSessionIndex >= sessionCards.length - 1;
        if (isLastCard) {
            endSession();
            return;
        }

        currentSessionIndex += 1;
        displayCurrentCard();
    } catch (error) {
        console.error('Error submitting answer:', error);
        showError('Failed to save answer, please try again');
    } finally {
        isSubmittingAnswer = false;
        if (!isPaused) {
            knowBtn.disabled = false;
            dontKnowBtn.disabled = false;
        }
    }
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
    knowBtn.disabled = paused;
    dontKnowBtn.disabled = paused;
    cardContent.classList.toggle('hidden', paused);
    pauseMask.classList.toggle('hidden', !paused);
}

async function endSession() {
    sessionScreen.classList.add('hidden');
    practiceChooser.classList.add('hidden');
    startScreen.classList.add('hidden');
    resultScreen.classList.remove('hidden');
    resultSummary.textContent = `Known: ${knownCount} · Need practice: ${unknownCount}`;

    // Refresh kid progress counters without resetting the current result view.
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
