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
const cardTitle = document.getElementById('cardTitle');
const cardPage = document.getElementById('cardPage');
const recordBtn = document.getElementById('recordBtn');
const resultSummary = document.getElementById('resultSummary');

let currentKid = null;
let sessionCards = [];
let activePendingSessionId = null;
let currentIndex = 0;
let sessionAnswers = [];
let completedCount = 0;

let mediaRecorder = null;
let mediaStream = null;
let isRecording = false;
let recordingStartedAtMs = 0;
let cardShownAtMs = 0;


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
    await loadReadyState();
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
        kidNameEl.textContent = `${currentKid.name}'s Lesson Reading`;
    } catch (error) {
        console.error('Error loading kid info:', error);
        showError('Failed to load kid information');
    }
}


async function loadReadyState() {
    try {
        showError('');
        const response = await fetch(`${API_BASE}/kids/${kidId}/lesson-reading/decks`);
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }

        const data = await response.json();
        const total = Number.parseInt(data.total_session_count, 10) || 0;
        const deckList = Array.isArray(data.decks) ? data.decks : [];
        const availableWithConfig = deckList.some((deck) => (Number(deck.total_cards || 0) > 0) && (Number(deck.session_count || 0) > 0));

        if (total <= 0) {
            practiceSection.classList.add('hidden');
            showError('Lesson Reading practice is off. Ask your parent to set per-deck counts in Manage Lesson Reading.');
            return;
        }

        if (!availableWithConfig) {
            practiceSection.classList.add('hidden');
            showError('No lesson-reading cards available for current deck settings.');
            return;
        }

        practiceSection.classList.remove('hidden');
        resetToStartScreen(total);
    } catch (error) {
        console.error('Error preparing lesson-reading practice:', error);
        showError('Failed to load lesson-reading practice data');
    }
}


function resetToStartScreen(totalCards) {
    const target = Math.max(0, Number.parseInt(totalCards, 10) || 0);
    sessionInfo.textContent = `Session: ${target} cards`;

    sessionCards = [];
    activePendingSessionId = null;
    currentIndex = 0;
    completedCount = 0;
    sessionAnswers = [];

    startScreen.classList.remove('hidden');
    sessionScreen.classList.add('hidden');
    resultScreen.classList.add('hidden');
}


async function startSession() {
    try {
        showError('');
        const response = await fetch(`${API_BASE}/kids/${kidId}/lesson-reading/practice/start`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({})
        });
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }

        const data = await response.json();
        activePendingSessionId = data.pending_session_id || null;
        sessionCards = shuffleSessionCards(data.cards || []);

        if (!window.PracticeSession.hasActiveSession(activePendingSessionId) || sessionCards.length === 0) {
            showError('No lesson-reading cards available');
            return;
        }

        currentIndex = 0;
        completedCount = 0;
        sessionAnswers = [];

        startScreen.classList.add('hidden');
        resultScreen.classList.add('hidden');
        sessionScreen.classList.remove('hidden');

        showCurrentCard();
    } catch (error) {
        console.error('Error starting lesson-reading session:', error);
        showError('Failed to start lesson-reading session');
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


function showCurrentCard() {
    if (sessionCards.length === 0) {
        return;
    }

    const card = sessionCards[currentIndex];
    renderPracticeProgress(progress, progressFill, currentIndex + 1, sessionCards.length, 'Card');
    cardTitle.textContent = card.front || '';
    cardPage.textContent = `Page ${card.back || ''}`;
    cardShownAtMs = Date.now();

    setRecordingVisual(false);
}


async function toggleRecord() {
    if (!window.PracticeSession.hasActiveSession(activePendingSessionId) || sessionCards.length === 0) {
        return;
    }

    if (isRecording) {
        stopRecordingAndAdvance();
        return;
    }

    try {
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
            showError('Recording is not supported in this browser');
            return;
        }

        mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        mediaRecorder = new MediaRecorder(mediaStream);
        mediaRecorder.ondataavailable = () => {
            // Recording is currently used for live practice flow; clips are not persisted yet.
        };
        mediaRecorder.onstop = () => {
            if (mediaStream) {
                mediaStream.getTracks().forEach((track) => track.stop());
                mediaStream = null;
            }
            mediaRecorder = null;
        };

        mediaRecorder.start();
        recordingStartedAtMs = Date.now();
        isRecording = true;
        setRecordingVisual(true);
        showError('');
    } catch (error) {
        console.error('Error starting recording:', error);
        showError('Failed to start recording. Please allow microphone access.');
        setRecordingVisual(false);
    }
}


function stopRecordingAndAdvance() {
    const card = sessionCards[currentIndex];
    const now = Date.now();
    const responseTimeMs = Math.max(0, now - cardShownAtMs);

    if (mediaRecorder && mediaRecorder.state === 'recording') {
        try {
            mediaRecorder.stop();
        } catch (error) {
            // best effort
        }
    }
    if (mediaStream) {
        mediaStream.getTracks().forEach((track) => track.stop());
        mediaStream = null;
    }

    const recordingDurationMs = Math.max(0, now - recordingStartedAtMs);
    sessionAnswers.push({
        cardId: card.id,
        known: true,
        responseTimeMs: Math.max(responseTimeMs, recordingDurationMs),
    });
    completedCount += 1;

    isRecording = false;
    recordingStartedAtMs = 0;
    setRecordingVisual(false);

    if (currentIndex >= sessionCards.length - 1) {
        endSession();
        return;
    }

    currentIndex += 1;
    showCurrentCard();
}


function setRecordingVisual(recording) {
    recordBtn.classList.toggle('recording', recording);
    recordBtn.textContent = recording ? 'Stop Recording & Next' : 'Start Recording';
}


async function endSession() {
    sessionScreen.classList.add('hidden');
    resultScreen.classList.remove('hidden');
    resultSummary.textContent = `Completed: ${completedCount} cards`;

    try {
        const payload = window.PracticeSession.buildCompletePayload(activePendingSessionId, sessionAnswers);
        await fetch(`${API_BASE}/kids/${kidId}/lesson-reading/practice/complete`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });
    } catch (error) {
        console.error('Error completing lesson-reading session:', error);
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
