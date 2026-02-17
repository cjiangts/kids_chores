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
let isUploadingRecording = false;
let recordingStartedAtMs = 0;
let recordingChunks = [];
let recordingMimeType = '';
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
        recordingChunks = [];
        recordingMimeType = '';
        isRecording = false;
        isUploadingRecording = false;
        recordingStartedAtMs = 0;

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

    recordBtn.disabled = false;
    setRecordingVisual(false);
}


async function toggleRecord() {
    if (!window.PracticeSession.hasActiveSession(activePendingSessionId) || sessionCards.length === 0) {
        return;
    }
    if (isUploadingRecording) {
        return;
    }

    if (isRecording) {
        await stopRecordingAndAdvance();
        return;
    }

    try {
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
            showError('Recording is not supported in this browser');
            return;
        }

        mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        const preferredMimeType = getPreferredRecordingMimeType();
        mediaRecorder = preferredMimeType
            ? new MediaRecorder(mediaStream, { mimeType: preferredMimeType })
            : new MediaRecorder(mediaStream);
        recordingChunks = [];
        recordingMimeType = mediaRecorder.mimeType || preferredMimeType || '';
        mediaRecorder.ondataavailable = (event) => {
            if (event.data && event.data.size > 0) {
                recordingChunks.push(event.data);
            }
        };

        mediaRecorder.start(200);
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


async function stopRecordingAndAdvance() {
    const card = sessionCards[currentIndex];
    const now = Date.now();
    const responseTimeMs = Math.max(0, now - cardShownAtMs);
    const recordingDurationMs = Math.max(0, now - recordingStartedAtMs);
    const previousBtnText = recordBtn.textContent;
    isUploadingRecording = true;
    recordBtn.disabled = true;
    recordBtn.textContent = 'Saving...';

    let blob = null;
    let mimeType = 'audio/webm';
    try {
        const recorded = await stopAndCaptureRecording();
        if (recorded) {
            blob = recorded.blob;
            mimeType = recorded.mimeType || mimeType;
        }
    } catch (error) {
        console.error('Error finishing recording:', error);
        showError('Failed to finish recording');
        resetRecordingState();
        isUploadingRecording = false;
        recordBtn.disabled = false;
        recordBtn.textContent = previousBtnText;
        return;
    }

    if (!blob || blob.size === 0) {
        showError('Recording is empty. Please record again.');
        resetRecordingState();
        isUploadingRecording = false;
        recordBtn.disabled = false;
        setRecordingVisual(false);
        return;
    }

    try {
        await uploadLessonReadingAudio(card.id, blob, mimeType);
    } catch (error) {
        console.error('Error uploading lesson-reading recording:', error);
        showError(error.message || 'Failed to save recording');
        resetRecordingState();
        isUploadingRecording = false;
        recordBtn.disabled = false;
        setRecordingVisual(false);
        return;
    }

    sessionAnswers.push({
        cardId: card.id,
        known: true,
        responseTimeMs: Math.max(responseTimeMs, recordingDurationMs),
    });
    completedCount += 1;

    resetRecordingState();
    isUploadingRecording = false;
    recordBtn.disabled = false;
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


function getPreferredRecordingMimeType() {
    if (typeof MediaRecorder === 'undefined' || typeof MediaRecorder.isTypeSupported !== 'function') {
        return '';
    }
    const candidates = [
        'audio/webm;codecs=opus',
        'audio/webm',
        'audio/mp4',
        'audio/ogg;codecs=opus',
        'audio/ogg',
        'audio/aac'
    ];
    for (const candidate of candidates) {
        if (MediaRecorder.isTypeSupported(candidate)) {
            return candidate;
        }
    }
    return '';
}


function guessAudioExtension(mimeType) {
    const type = String(mimeType || '').toLowerCase();
    if (type.includes('webm')) return 'webm';
    if (type.includes('ogg')) return 'ogg';
    if (type.includes('mp4') || type.includes('m4a') || type.includes('aac')) return 'm4a';
    if (type.includes('mpeg') || type.includes('mp3')) return 'mp3';
    return 'webm';
}


async function stopAndCaptureRecording() {
    return new Promise((resolve, reject) => {
        if (!mediaRecorder || mediaRecorder.state !== 'recording') {
            resolve(null);
            return;
        }

        let resolved = false;
        mediaRecorder.onstop = () => {
            if (resolved) return;
            resolved = true;
            const finalMimeType = mediaRecorder.mimeType || recordingMimeType || 'audio/webm';
            const blob = recordingChunks.length > 0 ? new Blob(recordingChunks, { type: finalMimeType }) : null;
            if (mediaStream) {
                mediaStream.getTracks().forEach((track) => track.stop());
            }
            mediaStream = null;
            mediaRecorder = null;
            resolve({
                blob,
                mimeType: finalMimeType,
            });
        };
        mediaRecorder.onerror = () => {
            if (resolved) return;
            resolved = true;
            if (mediaStream) {
                mediaStream.getTracks().forEach((track) => track.stop());
            }
            mediaStream = null;
            mediaRecorder = null;
            reject(new Error('recording failed'));
        };

        try {
            mediaRecorder.stop();
        } catch (error) {
            reject(error);
        }
    });
}


async function uploadLessonReadingAudio(cardId, blob, mimeType) {
    const extension = guessAudioExtension(mimeType);
    const formData = new FormData();
    formData.append('pendingSessionId', String(activePendingSessionId || ''));
    formData.append('cardId', String(cardId));
    formData.append('audio', blob, `lesson-reading.${extension}`);

    const response = await fetch(`${API_BASE}/kids/${kidId}/lesson-reading/practice/upload-audio`, {
        method: 'POST',
        body: formData
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
        throw new Error(result.error || `HTTP ${response.status}`);
    }
}


function resetRecordingState() {
    isRecording = false;
    recordingStartedAtMs = 0;
    recordingChunks = [];
    recordingMimeType = '';
    if (mediaStream) {
        mediaStream.getTracks().forEach((track) => track.stop());
    }
    mediaStream = null;
    mediaRecorder = null;
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
