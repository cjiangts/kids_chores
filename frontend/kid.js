// API Configuration
const API_BASE = `${window.location.origin}/api`;

// Get kid ID from URL
const urlParams = new URLSearchParams(window.location.search);
const kidId = urlParams.get('id');

// DOM Elements
const kidNameEl = document.getElementById('kidName');
const kidBackBtn = document.getElementById('kidBackBtn');
const resultBackBtn = document.getElementById('resultBackBtn');
const practiceSection = document.getElementById('practiceSection');
const cardContent = document.getElementById('cardContent');
const progress = document.getElementById('progress');
const progressFill = document.getElementById('progressFill');
const errorMessage = document.getElementById('errorMessage');
const practiceChooser = document.getElementById('practiceChooser');
const chinesePracticeOption = document.getElementById('chinesePracticeOption');
const writingPracticeOption = document.getElementById('writingPracticeOption');
const mathPracticeOption = document.getElementById('mathPracticeOption');
const chineseStarBadge = document.getElementById('chineseStarBadge');
const writingStarBadge = document.getElementById('writingStarBadge');
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
let writingCards = [];
let sessionCards = [];
let currentSessionIndex = 0;
let knownCount = 0;
let unknownCount = 0;
let activeSessionId = null;
let cardShownAtMs = 0;
let isPaused = false;
let sessionAnswers = [];
let pauseStartedAtMs = 0;
let pausedDurationMs = 0;

// Initialize
document.addEventListener('DOMContentLoaded', async () => {
    if (!kidId) {
        window.location.href = '/';
        return;
    }

    kidBackBtn.href = `/`;
    kidBackBtn.addEventListener('click', (event) => {
        const inReadingFlow = !startScreen.classList.contains('hidden')
            || !sessionScreen.classList.contains('hidden')
            || !resultScreen.classList.contains('hidden');

        if (inReadingFlow) {
            event.preventDefault();
            resetToStartScreen();
            return;
        }
    });
    resultBackBtn.href = `/kid.html?id=${kidId}`;

    await loadKidInfo();
    await loadCards();
    await loadWritingCards();
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

async function loadWritingCards() {
    try {
        const response = await fetch(`${API_BASE}/kids/${kidId}/writing/cards`);
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        const data = await response.json();
        writingCards = (data.cards || []).filter((card) => card.available_for_practice !== false);
        resetToStartScreen();
    } catch (error) {
        console.error('Error loading writing cards:', error);
        writingCards = [];
    }
}

// Session Functions
function resetToStartScreen() {
    const count = Math.min(currentKid?.sessionCardCount || 10, cards.length);
    sessionInfo.textContent = `Session: ${count} reading cards`;

    activeSessionId = null;
    sessionCards = [];
    currentSessionIndex = 0;
    knownCount = 0;
    unknownCount = 0;

    const chineseEnabled = !!currentKid?.dailyPracticeChineseEnabled;
    const writingEnabled = !!currentKid?.dailyPracticeWritingEnabled;
    const mathEnabled = !!currentKid?.dailyPracticeMathEnabled;

    chinesePracticeOption.classList.toggle('hidden', !chineseEnabled);
    writingPracticeOption.classList.toggle('hidden', !writingEnabled);
    mathPracticeOption.classList.toggle('hidden', !mathEnabled);

    practiceChooser.classList.remove('hidden');
    startScreen.classList.add('hidden');
    sessionScreen.classList.add('hidden');
    resultScreen.classList.add('hidden');

    if (!chineseEnabled && !writingEnabled && !mathEnabled) {
        showError('No daily practice is assigned. Ask your parent to enable Reading, Writing, or Math.');
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
    const writingCount = Number.isInteger(currentKid?.dailyCompletedWritingCountToday)
        ? currentKid.dailyCompletedWritingCountToday
        : 0;

    chineseStarBadge.textContent = chineseCount > 0 ? `Today: ${'⭐'.repeat(chineseCount)}` : 'Today: no stars yet';
    writingStarBadge.textContent = writingCount > 0 ? `Today: ${'⭐'.repeat(writingCount)}` : 'Today: no stars yet';
    mathStarBadge.textContent = mathCount > 0 ? `Today: ${'⭐'.repeat(mathCount)}` : 'Today: no stars yet';
}

function chooseChinesePractice() {
    if (cards.length === 0) {
        showError('No Chinese reading cards yet. Ask your parent to add some first.');
        return;
    }

    showError('');
    practiceChooser.classList.add('hidden');
    startScreen.classList.remove('hidden');
}

function goMathPractice() {
    window.location.href = `/kid-math.html?id=${kidId}`;
}

function goWritingPractice() {
    if (writingCards.length === 0) {
        showError('No Chinese writing cards yet. Ask your parent to add some first.');
        return;
    }
    window.location.href = `/kid-writing.html?id=${kidId}`;
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
        sessionCards = shuffleSessionCards(data.cards || []);

        if (!activeSessionId || sessionCards.length === 0) {
            await loadCards();
            return;
        }

        currentSessionIndex = 0;
        knownCount = 0;
        unknownCount = 0;
        sessionAnswers = [];

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

function shuffleSessionCards(cardsList) {
    const shuffled = [...cardsList];
    for (let i = shuffled.length - 1; i > 0; i -= 1) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
}

function displayCurrentCard() {
    if (sessionCards.length === 0) {
        return;
    }

    const card = sessionCards[currentSessionIndex];
    cardContent.textContent = card.front;
    renderPracticeProgress(progress, progressFill, currentSessionIndex + 1, sessionCards.length, 'Card');
    cardShownAtMs = Date.now();
    isPaused = false;
    pauseStartedAtMs = 0;
    pausedDurationMs = 0;
    setPausedVisual(false);
}

function answerCurrentCard(known) {
    if (sessionCards.length === 0 || !activeSessionId || isPaused) {
        return;
    }

    const currentCard = sessionCards[currentSessionIndex];
    const responseTimeMs = Math.max(0, Date.now() - cardShownAtMs - pausedDurationMs);

    sessionAnswers.push({
        cardId: currentCard.id,
        known,
        responseTimeMs,
    });

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
}

function togglePauseFromCard() {
    if (!activeSessionId || sessionCards.length === 0) {
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

    try {
        await fetch(`${API_BASE}/kids/${kidId}/practice/complete`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                sessionId: activeSessionId,
                answers: sessionAnswers,
            }),
        });
    } catch (error) {
        console.error('Error completing session:', error);
        showError('Failed to save session results');
    }

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
