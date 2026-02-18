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
const recordRow = document.getElementById('recordRow');
const reviewAudio = document.getElementById('reviewAudio');
const reviewControls = document.getElementById('reviewControls');
const replayBtn = document.getElementById('replayBtn');
const rerecordBtn = document.getElementById('rerecordBtn');
const continueBtn = document.getElementById('continueBtn');
const recordingViz = document.getElementById('recordingViz');
const recordingWave = document.getElementById('recordingWave');
const recordingStatusText = document.getElementById('recordingStatusText');
const resultSummary = document.getElementById('resultSummary');

let currentKid = null;
let sessionCards = [];
let activePendingSessionId = null;
let currentIndex = 0;
let sessionAnswers = [];
let completedCount = 0;
let sessionRecordings = {};

let mediaRecorder = null;
let mediaStream = null;
let isRecording = false;
let isUploadingRecording = false;
let recordingStartedAtMs = 0;
let recordingChunks = [];
let recordingMimeType = '';
let recordingAudioContext = null;
let recordingSourceNode = null;
let recordingAnalyserNode = null;
let recordingWaveBuffer = null;
let recordingFrameId = null;
let recordingLastWaveDrawMs = 0;
let pendingRecordedBlob = null;
let pendingRecordedMimeType = '';
let pendingRecordedResponseTimeMs = 0;
let pendingRecordedUrl = '';


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
    window.addEventListener('resize', fitRecordingCanvas);
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
        kidNameEl.textContent = `${currentKid.name}'s Chinese Reading`;
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
            showError('Chinese Reading practice is off. Ask your parent to set per-deck counts in Manage Chinese Reading.');
            return;
        }

        if (!availableWithConfig) {
            practiceSection.classList.add('hidden');
            showError('No Chinese reading cards available for current deck settings.');
            return;
        }

        practiceSection.classList.remove('hidden');
        resetToStartScreen(total);
    } catch (error) {
        console.error('Error preparing Chinese reading practice:', error);
        showError('Failed to load Chinese reading practice data');
    }
}


function resetToStartScreen(totalCards) {
    const target = Math.max(0, Number.parseInt(totalCards, 10) || 0);
    sessionInfo.textContent = `Session: ${target} cards`;

    sessionCards = [];
    window.PracticeSession.clearSessionStart(activePendingSessionId);
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
        const clientSessionStartMs = Date.now();
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
        window.PracticeSession.markSessionStarted(activePendingSessionId, clientSessionStartMs);
        sessionCards = shuffleSessionCards(data.cards || []);

        if (!window.PracticeSession.hasActiveSession(activePendingSessionId) || sessionCards.length === 0) {
            showError('No Chinese reading cards available');
            return;
        }

        currentIndex = 0;
        completedCount = 0;
        sessionAnswers = [];
        sessionRecordings = {};
        recordingChunks = [];
        recordingMimeType = '';
        clearPendingRecordingPreview();
        isRecording = false;
        isUploadingRecording = false;
        recordingStartedAtMs = 0;

        startScreen.classList.add('hidden');
        resultScreen.classList.add('hidden');
        sessionScreen.classList.remove('hidden');

        showCurrentCard();
    } catch (error) {
        console.error('Error starting Chinese reading session:', error);
        showError('Failed to start Chinese reading session');
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
    clearPendingRecordingPreview();

    if (recordRow) {
        recordRow.classList.remove('hidden');
    }
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
        await stopRecordingForReview();
        return;
    }
    if (pendingRecordedBlob) {
        showError('Replay or continue this recording, or re-record.');
        return;
    }

    try {
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
            showError('Recording is not supported in this browser');
            return;
        }

        mediaStream = await AudioCommon.getMicStream();
        mediaRecorder = new MediaRecorder(mediaStream, AudioCommon.getRecorderOptions());
        recordingChunks = [];
        recordingMimeType = mediaRecorder.mimeType || '';
        mediaRecorder.ondataavailable = (event) => {
            if (event.data && event.data.size > 0) {
                recordingChunks.push(event.data);
            }
        };

        mediaRecorder.start(AudioCommon.TIMESLICE_MS);
        recordingStartedAtMs = Date.now();
        isRecording = true;
        startRecordingVisualizer(mediaStream);
        setRecordingVisual(true);
        showError('');
    } catch (error) {
        console.error('Error starting recording:', error);
        showError('Failed to start recording. Please allow microphone access.');
        stopRecordingVisualizer();
        setRecordingVisual(false);
    }
}


async function stopRecordingForReview() {
    const now = Date.now();
    const recordingDurationMs = Math.max(0, now - recordingStartedAtMs);
    const previousBtnText = recordBtn.textContent;
    recordBtn.disabled = true;
    recordBtn.textContent = 'Stopping...';

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
        recordBtn.disabled = false;
        recordBtn.textContent = previousBtnText;
        return;
    }

    if (!blob || blob.size === 0) {
        showError('Recording is empty. Please record again.');
        resetRecordingState();
        recordBtn.disabled = false;
        setRecordingVisual(false);
        return;
    }

    resetRecordingState();
    pendingRecordedBlob = blob;
    pendingRecordedMimeType = mimeType;
    pendingRecordedResponseTimeMs = await estimateAudioDurationMs(blob, recordingDurationMs);
    if (pendingRecordedUrl) {
        URL.revokeObjectURL(pendingRecordedUrl);
    }
    pendingRecordedUrl = URL.createObjectURL(blob);
    if (reviewAudio) {
        reviewAudio.src = pendingRecordedUrl;
        reviewAudio.classList.remove('hidden');
    }
    if (reviewControls) {
        reviewControls.classList.remove('hidden');
    }
    if (recordRow) {
        recordRow.classList.add('hidden');
    }
    recordBtn.disabled = false;
    showError('');
}


async function estimateAudioDurationMs(blob, fallbackMs) {
    const fallback = Math.max(0, Number(fallbackMs) || 0);
    if (!blob || !(blob instanceof Blob)) {
        return fallback;
    }

    return new Promise((resolve) => {
        const audio = document.createElement('audio');
        const url = URL.createObjectURL(blob);
        let done = false;
        const finish = (value) => {
            if (done) return;
            done = true;
            try {
                URL.revokeObjectURL(url);
            } catch (error) {
                // no-op
            }
            const parsed = Math.max(0, Number(value) || 0);
            resolve(parsed > 0 ? parsed : fallback);
        };

        const timeoutId = window.setTimeout(() => finish(fallback), 1200);
        audio.preload = 'metadata';
        audio.onloadedmetadata = () => {
            window.clearTimeout(timeoutId);
            finish(Math.round(Math.max(0, Number(audio.duration) || 0) * 1000));
        };
        audio.onerror = () => {
            window.clearTimeout(timeoutId);
            finish(fallback);
        };
        audio.src = url;
    });
}


function setRecordingVisual(recording) {
    recordBtn.classList.toggle('recording', recording);
    recordBtn.textContent = recording ? 'Stop Recording' : 'Start Recording';
}


function startRecordingVisualizer(stream) {
    stopRecordingVisualizer();
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx || !stream || !recordingWave || !recordingViz) {
        return;
    }

    try {
        recordingAudioContext = new AudioCtx();
        recordingSourceNode = recordingAudioContext.createMediaStreamSource(stream);
        recordingAnalyserNode = recordingAudioContext.createAnalyser();
        recordingAnalyserNode.fftSize = 512;
        recordingAnalyserNode.smoothingTimeConstant = 0.88;
        recordingWaveBuffer = new Uint8Array(recordingAnalyserNode.fftSize);
        recordingSourceNode.connect(recordingAnalyserNode);
        recordingLastWaveDrawMs = 0;
        recordingViz.classList.remove('hidden');
        drawRecordingWave();
    } catch (error) {
        stopRecordingVisualizer();
    }
}


function stopRecordingVisualizer() {
    if (recordingFrameId) {
        cancelAnimationFrame(recordingFrameId);
        recordingFrameId = null;
    }
    if (recordingSourceNode) {
        try {
            recordingSourceNode.disconnect();
        } catch (error) {
            // no-op
        }
        recordingSourceNode = null;
    }
    if (recordingAnalyserNode) {
        try {
            recordingAnalyserNode.disconnect();
        } catch (error) {
            // no-op
        }
        recordingAnalyserNode = null;
    }
    if (recordingAudioContext) {
        recordingAudioContext.close().catch(() => {});
        recordingAudioContext = null;
    }
    recordingWaveBuffer = null;
    recordingLastWaveDrawMs = 0;
    if (recordingViz) {
        recordingViz.classList.add('hidden');
    }
    if (recordingStatusText) {
        recordingStatusText.textContent = 'Recording...';
    }
}


function fitRecordingCanvas() {
    if (!recordingWave) {
        return;
    }
    const rect = recordingWave.getBoundingClientRect();
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    const targetWidth = Math.max(1, Math.round(rect.width * dpr));
    const targetHeight = Math.max(1, Math.round(rect.height * dpr));
    if (recordingWave.width !== targetWidth || recordingWave.height !== targetHeight) {
        recordingWave.width = targetWidth;
        recordingWave.height = targetHeight;
    }
}


function drawRecordingWave() {
    if (!recordingWave || !recordingAnalyserNode || !recordingWaveBuffer) {
        return;
    }

    const nowMs = Date.now();
    if (recordingLastWaveDrawMs > 0 && (nowMs - recordingLastWaveDrawMs) < 66) {
        if (isRecording) {
            recordingFrameId = requestAnimationFrame(drawRecordingWave);
        }
        return;
    }
    recordingLastWaveDrawMs = nowMs;

    fitRecordingCanvas();
    recordingAnalyserNode.getByteTimeDomainData(recordingWaveBuffer);

    const ctx = recordingWave.getContext('2d');
    const width = recordingWave.width;
    const height = recordingWave.height;
    const centerY = height / 2;

    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, width, height);

    ctx.strokeStyle = '#f2b9b9';
    ctx.lineWidth = Math.max(1, Math.round(height * 0.02));
    ctx.beginPath();
    ctx.moveTo(0, centerY);
    ctx.lineTo(width, centerY);
    ctx.stroke();

    ctx.strokeStyle = '#d63636';
    ctx.lineWidth = Math.max(1.5, Math.round(height * 0.04));
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.beginPath();

    const sliceWidth = width / Math.max(1, recordingWaveBuffer.length - 1);
    for (let i = 0; i < recordingWaveBuffer.length; i += 1) {
        const normalized = (recordingWaveBuffer[i] - 128) / 128;
        const y = centerY + normalized * (height * 0.36);
        const x = i * sliceWidth;
        if (i === 0) {
            ctx.moveTo(x, y);
        } else {
            ctx.lineTo(x, y);
        }
    }
    ctx.stroke();

    if (recordingStatusText && recordingStartedAtMs > 0) {
        recordingStatusText.textContent = `Recording... ${formatElapsed(Date.now() - recordingStartedAtMs)}`;
    }

    if (isRecording) {
        recordingFrameId = requestAnimationFrame(drawRecordingWave);
    }
}


function formatElapsed(ms) {
    const totalSeconds = Math.max(0, Math.floor((Number(ms) || 0) / 1000));
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${String(minutes)}:${String(seconds).padStart(2, '0')}`;
}


// Audio utilities provided by audio-common.js (AudioCommon)


async function stopAndCaptureRecording() {
    return new Promise((resolve, reject) => {
        if (!mediaRecorder || mediaRecorder.state !== 'recording') {
            resolve(null);
            return;
        }

        const recorder = mediaRecorder;
        let resolved = false;
        recorder.onstop = () => {
            if (resolved) return;
            resolved = true;
            const finalMimeType = recorder.mimeType || recordingMimeType || 'audio/webm';
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
        recorder.onerror = () => {
            if (resolved) return;
            resolved = true;
            if (mediaStream) {
                mediaStream.getTracks().forEach((track) => track.stop());
            }
            mediaStream = null;
            mediaRecorder = null;
            reject(new Error('recording failed'));
        };

        const graceMs = Math.max(0, Number(window.AudioCommon?.STOP_GRACE_MS) || 280);
        window.AudioCommon.gracefulStopRecorder(recorder, graceMs).catch((error) => {
            if (!resolved) {
                resolved = true;
                reject(error);
            }
        });
    });
}


function resetRecordingState() {
    isRecording = false;
    recordingStartedAtMs = 0;
    recordingChunks = [];
    recordingMimeType = '';
    stopRecordingVisualizer();
    setRecordingVisual(false);
    if (mediaStream) {
        mediaStream.getTracks().forEach((track) => track.stop());
    }
    mediaStream = null;
    mediaRecorder = null;
}

function clearPendingRecordingPreview() {
    pendingRecordedBlob = null;
    pendingRecordedMimeType = '';
    pendingRecordedResponseTimeMs = 0;
    if (reviewAudio) {
        try {
            reviewAudio.pause();
        } catch (error) {
            // no-op
        }
        reviewAudio.removeAttribute('src');
        reviewAudio.load();
        reviewAudio.classList.add('hidden');
    }
    if (reviewControls) {
        reviewControls.classList.add('hidden');
    }
    if (recordRow) {
        recordRow.classList.remove('hidden');
    }
    if (recordBtn) {
        setRecordingVisual(false);
    }
    if (pendingRecordedUrl) {
        URL.revokeObjectURL(pendingRecordedUrl);
        pendingRecordedUrl = '';
    }
}

function replayRecording() {
    if (!pendingRecordedBlob || !reviewAudio) {
        return;
    }
    reviewAudio.currentTime = 0;
    reviewAudio.play().catch(() => {});
}

function reRecordCurrentCard() {
    if (isUploadingRecording || isRecording) {
        return;
    }
    clearPendingRecordingPreview();
    showError('');
}

async function confirmAndNext() {
    if (isRecording || isUploadingRecording || !pendingRecordedBlob) {
        return;
    }

    const card = sessionCards[currentIndex];
    isUploadingRecording = true;
    if (continueBtn) continueBtn.disabled = true;
    if (replayBtn) replayBtn.disabled = true;
    if (rerecordBtn) rerecordBtn.disabled = true;
    try {
        sessionRecordings[String(card.id)] = {
            blob: pendingRecordedBlob,
            mimeType: pendingRecordedMimeType || 'audio/webm',
        };

        sessionAnswers.push({
            cardId: card.id,
            known: true,
            responseTimeMs: Math.max(0, Number(pendingRecordedResponseTimeMs) || 0),
        });
        completedCount += 1;

        clearPendingRecordingPreview();

        if (currentIndex >= sessionCards.length - 1) {
            endSession();
            return;
        }
        currentIndex += 1;
        showCurrentCard();
    } catch (error) {
        console.error('Error uploading Chinese reading recording:', error);
        showError(error.message || 'Failed to save recording');
    } finally {
        isUploadingRecording = false;
        if (continueBtn) continueBtn.disabled = false;
        if (replayBtn) replayBtn.disabled = false;
        if (rerecordBtn) rerecordBtn.disabled = false;
    }
}


async function endSession() {
    sessionScreen.classList.add('hidden');
    resultScreen.classList.remove('hidden');
    resultSummary.textContent = `Completed: ${completedCount} cards`;

    try {
        const payload = window.PracticeSession.buildCompletePayload(activePendingSessionId, sessionAnswers);
        const pendingSessionId = String(payload.pendingSessionId || '');

        for (const [cardIdRaw, audio] of Object.entries(sessionRecordings)) {
            if (!audio || !audio.blob) {
                continue;
            }
            const cardId = Number.parseInt(cardIdRaw, 10);
            if (!Number.isFinite(cardId)) {
                continue;
            }
            const mimeType = String(audio.mimeType || 'audio/webm');
            const ext = AudioCommon.guessExtension(mimeType);
            const formData = new FormData();
            formData.append('pendingSessionId', pendingSessionId);
            formData.append('cardId', String(cardId));
            formData.append('audio', audio.blob, `lesson-reading-${cardId}.${ext}`);
            const uploadRes = await fetch(`${API_BASE}/kids/${kidId}/lesson-reading/practice/upload-audio`, {
                method: 'POST',
                body: formData,
            });
            const uploadPayload = await uploadRes.json().catch(() => ({}));
            if (!uploadRes.ok) {
                throw new Error(uploadPayload.error || `Audio upload failed (HTTP ${uploadRes.status})`);
            }
        }

        const response = await fetch(`${API_BASE}/kids/${kidId}/lesson-reading/practice/complete`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok) {
            throw new Error(result.error || `HTTP ${response.status}`);
        }
    } catch (error) {
        console.error('Error completing lesson-reading session:', error);
        showError(error.message || 'Failed to save session results');
    }
    window.PracticeSession.clearSessionStart(activePendingSessionId);

    sessionRecordings = {};
    await loadKidInfo();
}


function showError(message) {
    if (message) {
        const text = String(message);
        if (errorMessage) {
            errorMessage.textContent = '';
            errorMessage.classList.add('hidden');
        }
        if (showError._lastMessage !== text) {
            window.alert(text);
            showError._lastMessage = text;
        }
    } else {
        showError._lastMessage = '';
        if (errorMessage) {
            errorMessage.classList.add('hidden');
        }
    }
}

window.replayRecording = replayRecording;
window.reRecordCurrentCard = reRecordCurrentCard;
window.confirmAndNext = confirmAndNext;
