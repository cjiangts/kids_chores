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
const cardAnswer = document.getElementById('cardAnswer');
const doneRow = document.getElementById('doneRow');
const doneBtn = document.getElementById('doneBtn');
const judgeRow = document.getElementById('judgeRow');
const wrongBtn = document.getElementById('wrongBtn');
const rightBtn = document.getElementById('rightBtn');
const resultSummary = document.getElementById('resultSummary');

let currentKid = null;
let availableCards = [];
let sessionCards = [];
let activePendingSessionId = null;
let currentIndex = 0;
let rightCount = 0;
let wrongCount = 0;
let answerRevealed = false;
let cardShownAtMs = 0;
let sessionAnswers = [];
let audioPrimed = false;
const errorState = { lastMessage: '' };
const promptPlayer = window.WritingAudioSequence.createPlayer({
    preload: 'auto',
    onError: (error) => {
        console.error('Error playing prompt audio:', error);
        const detail = String(error?.message || '').trim();
        showError(detail ? `Failed to play voice prompt: ${detail}` : 'Failed to play voice prompt. Tap the card to retry.');
    }
});

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
                return;
            }
            stopAudioPlayback();
        }
    });
    await loadKidInfo();
    await loadWritingCards();
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
        kidNameEl.textContent = `${currentKid.name}'s Chinese Writing`;
    } catch (error) {
        console.error('Error loading kid info:', error);
        showError('Failed to load kid information');
    }
}

async function loadWritingCards() {
    try {
        showError('');
        const response = await fetch(`${API_BASE}/kids/${kidId}/writing/cards`);
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }

        const data = await response.json();
        availableCards = (data.cards || []).filter((card) => card.available_for_practice !== false);
        if (availableCards.length === 0) {
            practiceSection.classList.add('hidden');
            showError('No Chinese writing cards yet. Ask your parent to add some first.');
            return;
        }

        practiceSection.classList.remove('hidden');
        resetToStartScreen();
    } catch (error) {
        console.error('Error loading writing cards:', error);
        showError('Failed to load Chinese writing cards');
    }
}

function resetToStartScreen() {
    const writingSessionCount = Number.parseInt(currentKid?.writingSessionCardCount, 10);
    const target = Math.min(Number.isInteger(writingSessionCount) ? writingSessionCount : 0, availableCards.length);
    sessionInfo.textContent = `Session: ${target} cards`;

    sessionCards = [];
    window.PracticeSession.clearSessionStart(activePendingSessionId);
    activePendingSessionId = null;
    currentIndex = 0;
    rightCount = 0;
    wrongCount = 0;

    startScreen.classList.remove('hidden');
    sessionScreen.classList.add('hidden');
    resultScreen.classList.add('hidden');
    stopAudioPlayback();
    clearAudioBlobCache();
}

async function startSession() {
    try {
        showError('');
        primeAudioForAutoplay();
        const started = await window.PracticeSessionFlow.startShuffledSession(
            `${API_BASE}/kids/${kidId}/writing/practice/start`,
            {}
        );
        activePendingSessionId = started.pendingSessionId;
        sessionCards = started.cards;

        if (!window.PracticeSession.hasActiveSession(activePendingSessionId) || sessionCards.length === 0) {
            showError('No Chinese writing cards available');
            return;
        }

        currentIndex = 0;
        rightCount = 0;
        wrongCount = 0;
        sessionAnswers = [];

        startScreen.classList.add('hidden');
        resultScreen.classList.add('hidden');
        sessionScreen.classList.remove('hidden');

        showCurrentPrompt();
    } catch (error) {
        console.error('Error starting writing session:', error);
        showError('Failed to start Chinese writing session');
    }
}

function showCurrentPrompt() {
    if (sessionCards.length === 0) {
        return;
    }

    const card = sessionCards[currentIndex];
    renderPracticeProgress(progress, progressFill, currentIndex + 1, sessionCards.length, 'Card');
    cardAnswer.textContent = card.back || '';
    cardAnswer.classList.add('hidden');
    flashcard.classList.remove('revealed');

    answerRevealed = false;
    doneRow.classList.remove('hidden');
    judgeRow.classList.add('hidden');
    wrongBtn.disabled = false;
    rightBtn.disabled = false;
    doneBtn.disabled = false;

    cardShownAtMs = Date.now();
    playPromptForCard(card);
    prefetchNextPrompt();
}

function revealAnswer() {
    if (answerRevealed || !window.PracticeSession.hasActiveSession(activePendingSessionId) || sessionCards.length === 0) {
        return;
    }

    answerRevealed = true;
    cardAnswer.classList.remove('hidden');
    flashcard.classList.add('revealed');
    doneRow.classList.add('hidden');
    judgeRow.classList.remove('hidden');
}

function replayCurrentPrompt() {
    if (!window.PracticeSession.hasActiveSession(activePendingSessionId) || sessionCards.length === 0) {
        return;
    }
    const card = sessionCards[currentIndex];
    playPromptForCard(card);
}

function playPromptForCard(card) {
    const urls = promptPlayer.buildPromptUrls(card);
    if (urls.length === 0) {
        stopAudioPlayback();
        return;
    }
    showError('');
    promptPlayer.playUrls(urls);
}

function primeAudioForAutoplay() {
    if (audioPrimed) {
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
                audioPrimed = true;
            })
            .catch(() => {
                // Ignore; browser may still allow normal prompt playback.
            });
    } catch (error) {
        // Best-effort unlock only.
    }
}

function prefetchNextPrompt() {
    if (!window.PracticeSession.hasActiveSession(activePendingSessionId) || sessionCards.length === 0) {
        return;
    }
    const nextIndex = currentIndex + 1;
    if (nextIndex >= sessionCards.length) {
        return;
    }
    const nextCard = sessionCards[nextIndex];
    promptPlayer.prefetchCard(nextCard);
}

function answerCurrentCard(correct) {
    if (!answerRevealed || !window.PracticeSession.hasActiveSession(activePendingSessionId)) {
        return;
    }

    const card = sessionCards[currentIndex];
    const responseTimeMs = Math.max(0, Date.now() - cardShownAtMs);

    sessionAnswers.push({
        cardId: card.id,
        known: correct,
        responseTimeMs
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
    showCurrentPrompt();
}

async function endSession() {
    stopAudioPlayback();
    sessionScreen.classList.add('hidden');
    resultScreen.classList.remove('hidden');
    resultSummary.textContent = `Right: ${rightCount} · Wrong: ${wrongCount}`;

    try {
        await window.PracticeSessionFlow.postCompleteSession(
            `${API_BASE}/kids/${kidId}/writing/practice/complete`,
            activePendingSessionId,
            sessionAnswers
        );
    } catch (error) {
        console.error('Error completing writing session:', error);
        showError('Failed to save session results');
    }
    window.PracticeSession.clearSessionStart(activePendingSessionId);

    await loadKidInfo();
    clearAudioBlobCache();
}

function stopAudioPlayback() {
    promptPlayer.stop();
}

function clearAudioBlobCache() {
    promptPlayer.clearCache();
}

function showError(message) {
    window.PracticeUiCommon.showAlertError(errorState, errorMessage, message);
}
