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
const lessonReadingPracticeOption = document.getElementById('lessonReadingPracticeOption');
const chineseStarBadge = document.getElementById('chineseStarBadge');
const writingStarBadge = document.getElementById('writingStarBadge');
const mathStarBadge = document.getElementById('mathStarBadge');
const lessonReadingStarBadge = document.getElementById('lessonReadingStarBadge');
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
let activePendingSessionId = null;
let cardShownAtMs = 0;
let isPaused = false;
let sessionAnswers = [];
const errorState = { lastMessage: '' };
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
        if (isSessionInProgress()) {
            const confirmed = window.confirm('Go back now? Your current session progress will be lost.');
            if (!confirmed) {
                event.preventDefault();
            }
        }
    });
    resultBackBtn.href = `/kid.html?id=${kidId}`;

    await loadKidInfo();
    await loadCards();
    await loadWritingCards();
});

function isSessionInProgress() {
    return !sessionScreen.classList.contains('hidden')
        && window.PracticeSession.hasActiveSession(activePendingSessionId)
        && sessionCards.length > 0;
}

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

function getMathSessionCount(kid) {
    const sharedMathSessionCount = Number.parseInt(kid?.sharedMathSessionCardCount, 10);
    if (Number.isInteger(sharedMathSessionCount)) {
        return Math.max(0, sharedMathSessionCount);
    }

    const mathWithin10Count = Number.parseInt(kid?.mathDeckWithin10Count, 10);
    const mathWithin20Count = Number.parseInt(kid?.mathDeckWithin20Count, 10);
    const mathSubWithin10Count = Number.parseInt(kid?.mathDeckSubWithin10Count, 10);
    const mathSubWithin20Count = Number.parseInt(kid?.mathDeckSubWithin20Count, 10);
    return (Number.isInteger(mathWithin10Count) ? Math.max(0, mathWithin10Count) : 0)
        + (Number.isInteger(mathWithin20Count) ? Math.max(0, mathWithin20Count) : 0)
        + (Number.isInteger(mathSubWithin10Count) ? Math.max(0, mathSubWithin10Count) : 0)
        + (Number.isInteger(mathSubWithin20Count) ? Math.max(0, mathSubWithin20Count) : 0);
}

// Session Functions
function resetToStartScreen() {
    const readingSessionCount = Number.parseInt(currentKid?.sessionCardCount, 10);
    const count = Math.min(Number.isInteger(readingSessionCount) ? readingSessionCount : 10, cards.length);
    sessionInfo.textContent = `Session: ${count} Chinese character cards`;

    window.PracticeSession.clearSessionStart(activePendingSessionId);
    activePendingSessionId = null;
    sessionCards = [];
    currentSessionIndex = 0;
    knownCount = 0;
    unknownCount = 0;

    const writingSessionCount = Number.parseInt(currentKid?.writingSessionCardCount, 10);
    const lessonMa3Unit1Count = Number.parseInt(currentKid?.lessonReadingDeckMa3Unit1Count, 10);
    const lessonMa3Unit2Count = Number.parseInt(currentKid?.lessonReadingDeckMa3Unit2Count, 10);
    const lessonMa3Unit3Count = Number.parseInt(currentKid?.lessonReadingDeckMa3Unit3Count, 10);

    const chineseEnabled = Number.isInteger(readingSessionCount) && readingSessionCount > 0;
    const writingEnabled = Number.isInteger(writingSessionCount) && writingSessionCount > 0;
    const mathEnabled = getMathSessionCount(currentKid) > 0;
    const lessonReadingEnabled = (Number.isInteger(lessonMa3Unit1Count) ? lessonMa3Unit1Count : 0)
        + (Number.isInteger(lessonMa3Unit2Count) ? lessonMa3Unit2Count : 0)
        + (Number.isInteger(lessonMa3Unit3Count) ? lessonMa3Unit3Count : 0) > 0;

    chinesePracticeOption.classList.toggle('hidden', !chineseEnabled);
    writingPracticeOption.classList.toggle('hidden', !writingEnabled);
    mathPracticeOption.classList.toggle('hidden', !mathEnabled);
    lessonReadingPracticeOption.classList.toggle('hidden', !lessonReadingEnabled);

    practiceChooser.classList.remove('hidden');
    startScreen.classList.add('hidden');
    sessionScreen.classList.add('hidden');
    resultScreen.classList.add('hidden');

    if (!chineseEnabled && !writingEnabled && !mathEnabled && !lessonReadingEnabled) {
        showError('No daily practice is assigned. Ask your parent to set per-session counts above 0.');
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
    const lessonReadingCount = Number.isInteger(currentKid?.dailyCompletedLessonReadingCountToday)
        ? currentKid.dailyCompletedLessonReadingCountToday
        : 0;

    chineseStarBadge.textContent = chineseCount > 0 ? `Today: ${'⭐'.repeat(chineseCount)}` : 'Today: no stars yet';
    writingStarBadge.textContent = writingCount > 0 ? `Today: ${'⭐'.repeat(writingCount)}` : 'Today: no stars yet';
    mathStarBadge.textContent = mathCount > 0 ? `Today: ${'⭐'.repeat(mathCount)}` : 'Today: no stars yet';
    lessonReadingStarBadge.textContent = lessonReadingCount > 0 ? `Today: ${'⭐'.repeat(lessonReadingCount)}` : 'Today: no stars yet';
}

function chooseChinesePractice() {
    if (cards.length === 0) {
        showError('No Chinese character cards yet. Ask your parent to add some first.');
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

function goLessonReadingPractice() {
    window.location.href = `/kid-lesson-reading.html?id=${kidId}`;
}

async function startSession() {
    if (cards.length === 0) {
        return;
    }

    try {
        showError('');
        const started = await window.PracticeSessionFlow.startShuffledSession(
            `${API_BASE}/kids/${kidId}/practice/start`,
            {}
        );
        activePendingSessionId = started.pendingSessionId;
        sessionCards = started.cards;

        if (!window.PracticeSession.hasActiveSession(activePendingSessionId) || sessionCards.length === 0) {
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
    if (sessionCards.length === 0 || !window.PracticeSession.hasActiveSession(activePendingSessionId) || isPaused) {
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
        await window.PracticeSessionFlow.postCompleteSession(
            `${API_BASE}/kids/${kidId}/practice/complete`,
            activePendingSessionId,
            sessionAnswers
        );
    } catch (error) {
        console.error('Error completing session:', error);
        showError('Failed to save session results');
    }
    window.PracticeSession.clearSessionStart(activePendingSessionId);

    await loadKidInfo();
}

function showError(message) {
    window.PracticeUiCommon.showAlertError(errorState, errorMessage, message);
}
