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
const flashcard = document.getElementById('flashcard');
const cardBackContent = document.getElementById('cardBackContent');
const revealRow = document.getElementById('revealRow');
const judgeRow = document.getElementById('judgeRow');
const revealBtn = document.getElementById('revealBtn');
const rightBtn = document.getElementById('rightBtn');
const wrongBtn = document.getElementById('wrongBtn');
const judgeModeToggleStart = document.getElementById('judgeModeToggleStart');

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
let answerRevealed = false;
let judgeMode = 'self';
const JUDGE_MODE_STORAGE_KEY = 'practice_judge_mode_flashcard';

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
    initJudgeMode();
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
    return Number.isInteger(sharedMathSessionCount) ? Math.max(0, sharedMathSessionCount) : 0;
}

function getLessonReadingSessionCount(kid) {
    const sharedLessonReadingSessionCount = Number.parseInt(kid?.sharedLessonReadingSessionCardCount, 10);
    return Number.isInteger(sharedLessonReadingSessionCount) ? Math.max(0, sharedLessonReadingSessionCount) : 0;
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
    const chineseEnabled = Number.isInteger(readingSessionCount) && readingSessionCount > 0;
    const writingEnabled = Number.isInteger(writingSessionCount) && writingSessionCount > 0;
    const mathEnabled = getMathSessionCount(currentKid) > 0;
    const lessonReadingEnabled = getLessonReadingSessionCount(currentKid) > 0;

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
            showRevealAction: false,
            showJudgeActions: true,
            showBackAnswer: false,
        };
    }
    return window.PracticeJudgeMode.getRevealJudgeUiState(judgeMode, answerRevealed);
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
    cardBackContent.textContent = String(card.back || '').trim();
    renderPracticeProgress(progress, progressFill, currentSessionIndex + 1, sessionCards.length, 'Card');
    answerRevealed = false;
    cardShownAtMs = Date.now();
    isPaused = false;
    pauseStartedAtMs = 0;
    pausedDurationMs = 0;
    setPausedVisual(false);
}

function revealAnswer() {
    if (sessionCards.length === 0 || isPaused) {
        return;
    }
    const state = getJudgeModeUiState();
    if (!state.isSelfMode || answerRevealed) {
        return;
    }
    answerRevealed = true;
    applyJudgeModeUi();
}

function answerCurrentCard(known) {
    if (sessionCards.length === 0 || !window.PracticeSession.hasActiveSession(activePendingSessionId) || isPaused) {
        return;
    }
    const state = getJudgeModeUiState();
    if (state.isSelfMode && !answerRevealed) {
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
    const state = getJudgeModeUiState();
    if (revealBtn) {
        revealBtn.disabled = paused || !state.showRevealAction;
    }
    if (rightBtn) {
        rightBtn.disabled = paused || !state.showJudgeActions;
    }
    if (wrongBtn) {
        wrongBtn.disabled = paused || !state.showJudgeActions;
    }
    cardContent.classList.toggle('hidden', paused);
    cardBackContent.classList.toggle('hidden', paused || !state.showBackAnswer || !String(cardBackContent.textContent || '').trim());
    pauseMask.classList.toggle('hidden', !paused);
    if (flashcard) {
        flashcard.classList.toggle('revealed', state.showBackAnswer);
    }
    applyJudgeModeUi();
}

function applyJudgeModeUi() {
    const state = getJudgeModeUiState();
    if (revealRow) {
        revealRow.classList.toggle('hidden', !state.showRevealAction);
    }
    if (judgeRow) {
        judgeRow.classList.toggle('hidden', !state.showJudgeActions);
    }
    if (!isPaused && cardBackContent) {
        cardBackContent.classList.toggle('hidden', !state.showBackAnswer || !String(cardBackContent.textContent || '').trim());
    }
    if (flashcard) {
        flashcard.classList.toggle('revealed', state.showBackAnswer);
    }
    if (revealBtn) {
        revealBtn.disabled = isPaused || !state.showRevealAction;
    }
    if (rightBtn) {
        rightBtn.disabled = isPaused || !state.showJudgeActions;
    }
    if (wrongBtn) {
        wrongBtn.disabled = isPaused || !state.showJudgeActions;
    }
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
