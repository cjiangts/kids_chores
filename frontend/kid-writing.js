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
const promptAudio = new Audio();
promptAudio.preload = 'auto';
promptAudio.playsInline = true;
let currentAudioUrl = '';
let audioPrimed = false;
const audioBlobCache = new Map();

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
        const clientSessionStartMs = Date.now();
        const response = await fetch(`${API_BASE}/kids/${kidId}/writing/practice/start`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({})
        });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }

        const data = await response.json();
        activePendingSessionId = data.pending_session_id || null;
        window.PracticeSession.markSessionStarted(activePendingSessionId, clientSessionStartMs);
        sessionCards = shuffleSessionCards(data.cards || []);

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

function shuffleSessionCards(cardsList) {
    const shuffled = [...cardsList];
    for (let i = shuffled.length - 1; i > 0; i -= 1) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
}

function showCurrentPrompt() {
    if (sessionCards.length === 0) {
        return;
    }

    const card = sessionCards[currentIndex];
    renderPracticeProgress(progress, progressFill, currentIndex + 1, sessionCards.length, 'Card');
    cardAnswer.textContent = card.back || card.front || '';
    cardAnswer.classList.add('hidden');
    flashcard.classList.remove('revealed');

    answerRevealed = false;
    doneRow.classList.remove('hidden');
    judgeRow.classList.add('hidden');
    wrongBtn.disabled = false;
    rightBtn.disabled = false;
    doneBtn.disabled = false;

    cardShownAtMs = Date.now();
    playPrompt(card.audio_url);
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
    playPrompt(card.audio_url);
}

function playPrompt(url) {
    if (!url) {
        stopAudioPlayback();
        return;
    }

    stopAudioPlayback();
    playPromptWithRetry(url);
}

function playPromptWithRetry(url) {
    const baseUrl = String(url || '');
    if (!baseUrl) {
        return;
    }
    showError('');
    playAudioSource(baseUrl).catch((error) => {
        console.error('Error playing prompt audio:', error);
        ensureCachedAudioSource(baseUrl)
            .then((cachedSource) => playAudioSource(cachedSource))
            .catch((fallbackError) => {
                console.error('Fallback cached audio play failed:', fallbackError);
                showError('Failed to play voice prompt. Tap the card to retry.');
            });
    });
}

function playAudioSource(src) {
    if (!src) {
        return Promise.reject(new Error('Missing audio source'));
    }
    if (currentAudioUrl !== src) {
        promptAudio.src = src;
        currentAudioUrl = src;
        promptAudio.load();
    }
    promptAudio.currentTime = 0;
    return promptAudio.play();
}

async function ensureCachedAudioSource(url) {
    if (audioBlobCache.has(url)) {
        return audioBlobCache.get(url);
    }

    const response = await fetch(url, { method: 'GET', credentials: 'same-origin' });
    if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
    }
    const blob = await response.blob();
    const blobUrl = URL.createObjectURL(blob);
    audioBlobCache.set(url, blobUrl);
    return blobUrl;
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
    if (!nextCard || !nextCard.audio_url) {
        return;
    }
    ensureCachedAudioSource(nextCard.audio_url).catch(() => {
        // Best-effort warmup only.
    });
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
        const payload = window.PracticeSession.buildCompletePayload(activePendingSessionId, sessionAnswers);
        await fetch(`${API_BASE}/kids/${kidId}/writing/practice/complete`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
    } catch (error) {
        console.error('Error completing writing session:', error);
        showError('Failed to save session results');
    }
    window.PracticeSession.clearSessionStart(activePendingSessionId);

    await loadKidInfo();
    clearAudioBlobCache();
}

function stopAudioPlayback() {
    if (!promptAudio) {
        return;
    }
    promptAudio.pause();
    promptAudio.currentTime = 0;
}

function clearAudioBlobCache() {
    audioBlobCache.forEach((blobUrl) => {
        try {
            URL.revokeObjectURL(blobUrl);
        } catch (error) {
            // ignore cleanup errors
        }
    });
    audioBlobCache.clear();
}

function showError(message) {
    if (message) {
        errorMessage.textContent = message;
        errorMessage.classList.remove('hidden');
    } else {
        errorMessage.classList.add('hidden');
    }
}
