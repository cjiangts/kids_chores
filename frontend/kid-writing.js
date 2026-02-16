const API_BASE = `${window.location.origin}/api`;

const params = new URLSearchParams(window.location.search);
const kidId = params.get('id');

const kidNameEl = document.getElementById('kidName');
const backToPractice = document.getElementById('backToPractice');
const resultBackToPractice = document.getElementById('resultBackToPractice');
const sheetsLink = document.getElementById('sheetsLink');
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
let activeSessionId = null;
let currentIndex = 0;
let rightCount = 0;
let wrongCount = 0;
let answerRevealed = false;
let cardShownAtMs = 0;
let sessionAnswers = [];
let currentAudio = null;

document.addEventListener('DOMContentLoaded', async () => {
    if (!kidId) {
        window.location.href = '/';
        return;
    }

    backToPractice.href = `/kid.html?id=${kidId}`;
    resultBackToPractice.href = `/kid.html?id=${kidId}`;
    sheetsLink.href = `/kid-writing-sheets.html?id=${kidId}`;
    await loadKidInfo();
    await loadWritingCards();
});

async function loadKidInfo() {
    try {
        const response = await fetch(`${API_BASE}/kids/${kidId}`);
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }
        currentKid = await response.json();
        kidNameEl.textContent = `${currentKid.name}'s Writing`;
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
        showError('Failed to load writing cards');
    }
}

function resetToStartScreen() {
    const target = Math.min(currentKid?.sessionCardCount || 10, availableCards.length);
    sessionInfo.textContent = `Session: ${target} cards`;

    sessionCards = [];
    activeSessionId = null;
    currentIndex = 0;
    rightCount = 0;
    wrongCount = 0;

    startScreen.classList.remove('hidden');
    sessionScreen.classList.add('hidden');
    resultScreen.classList.add('hidden');
    stopAudioPlayback();
}

async function startSession() {
    try {
        showError('');
        const response = await fetch(`${API_BASE}/kids/${kidId}/writing/practice/start`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({})
        });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }

        const data = await response.json();
        activeSessionId = data.session_id;
        sessionCards = shuffleSessionCards(data.cards || []);

        if (!activeSessionId || sessionCards.length === 0) {
            showError('No writing cards available');
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
        showError('Failed to start writing session');
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
}

function revealAnswer() {
    if (answerRevealed || !activeSessionId || sessionCards.length === 0) {
        return;
    }

    answerRevealed = true;
    cardAnswer.classList.remove('hidden');
    flashcard.classList.add('revealed');
    doneRow.classList.add('hidden');
    judgeRow.classList.remove('hidden');
}

function replayCurrentPrompt() {
    if (!activeSessionId || sessionCards.length === 0) {
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
    currentAudio = new Audio(url);
    currentAudio.play().catch((error) => {
        console.error('Error playing prompt audio:', error);
    });
}

function answerCurrentCard(correct) {
    if (!answerRevealed || !activeSessionId) {
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
        await fetch(`${API_BASE}/kids/${kidId}/writing/practice/complete`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                sessionId: activeSessionId,
                answers: sessionAnswers
            })
        });
    } catch (error) {
        console.error('Error completing writing session:', error);
        showError('Failed to save session results');
    }

    await loadKidInfo();
}

function stopAudioPlayback() {
    if (!currentAudio) {
        return;
    }
    currentAudio.pause();
    currentAudio.currentTime = 0;
    currentAudio = null;
}

function showError(message) {
    if (message) {
        errorMessage.textContent = message;
        errorMessage.classList.remove('hidden');
    } else {
        errorMessage.classList.add('hidden');
    }
}
