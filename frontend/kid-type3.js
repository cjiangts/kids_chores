const API_BASE = `${window.location.origin}/api`;

const params = new URLSearchParams(window.location.search);
const kidId = params.get('id');
const requestedCategoryKey = String(params.get('categoryKey') || '').trim().toLowerCase();
const {
    getDeckCategoryMetaMap,
    resolveTypeIIIPracticeCategoryKey,
} = window.DeckCategoryCommon || {};

const kidNameEl = document.getElementById('kidName');
const startTitle = document.getElementById('startTitle');
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
const cardSourceTags = document.getElementById('cardSourceTags');
const recordBtn = document.getElementById('recordBtn');
const recordRow = document.getElementById('recordRow');
const reviewAudio = document.getElementById('reviewAudio');
const reviewControls = document.getElementById('reviewControls');
const rerecordBtn = document.getElementById('rerecordBtn');
const continueBtn = document.getElementById('continueBtn');
const pauseSessionBtn = document.getElementById('pauseSessionBtn');
const finishEarlyBtn = document.getElementById('finishEarlyBtn');
const recordingViz = document.getElementById('recordingViz');
const recordingWave = document.getElementById('recordingWave');
const recordingStatusText = document.getElementById('recordingStatusText');
const resultSummary = document.getElementById('resultSummary');

let currentKid = null;
let activeCategoryKey = requestedCategoryKey;
let currentCategoryDisplayName = '';
let sessionCards = [];
let activePendingSessionId = null;
let currentIndex = 0;
let sessionAnswers = [];
let completedCount = 0;
let sessionRecordings = {};

let mediaRecorder = null;
let mediaStream = null;
let isRecording = false;
let isRecordingPaused = false;
let isUploadingRecording = false;
let recordingStartedAtMs = 0;
let recordingPauseStartedAtMs = 0;
let recordingChunks = [];
let recordingMimeType = '';
let pendingRecordedBlob = null;
let pendingRecordedMimeType = '';
let pendingRecordedUrl = '';
let isSessionPaused = false;
const errorState = { lastMessage: '' };
const earlyFinishController = window.PracticeUiCommon.createEarlyFinishController({
    button: finishEarlyBtn,
    getHasActiveSession: () => (
        window.PracticeSession.hasActiveSession(activePendingSessionId)
        && sessionCards.length > 0
        && !isSessionPaused
        && !isRecording
        && !isUploadingRecording
    ),
    getTotalCount: () => sessionCards.length,
    getRecordedCount: () => sessionAnswers.length,
    emptyAnswerMessage: 'Complete at least one card before finishing early.',
    showError: (message) => showError(message),
    onConfirmFinish: () => {
        void endSession(true);
    },
});
const recordingVisualizer = new window.RecordingVisualizer({
    fftSize: 512,
    smoothingTimeConstant: 0.88,
    minFrameIntervalMs: 66,
    baselineWidthRatio: 0.02,
    waveWidthRatio: 0.04,
    amplitudeRatio: 0.36,
    getCanvas: () => recordingWave,
    getStatusElement: () => recordingStatusText,
    formatStatus: (elapsedMs) => `Recording... ${window.PracticeUiCommon.formatElapsed(elapsedMs)}`,
    onStart: () => {
        if (recordingViz) {
            recordingViz.classList.remove('hidden');
        }
    },
    onStop: () => {
        if (recordingViz) {
            recordingViz.classList.add('hidden');
        }
        if (recordingStatusText) {
            recordingStatusText.textContent = 'Recording...';
        }
    },
});


document.addEventListener('DOMContentLoaded', async () => {
    if (!kidId) {
        window.location.href = '/';
        return;
    }

    backToPractice.href = `/kid-practice-home.html?id=${kidId}`;
    resultBackToPractice.href = `/kid-practice-home.html?id=${kidId}`;
    backToPractice.addEventListener('click', (event) => {
        if (isSessionInProgress()) {
            const confirmed = window.confirm('Go back now? Your current session progress will be lost.');
            if (!confirmed) {
                event.preventDefault();
            }
        }
    });

    await loadKidInfo();
    if (!currentKid || !activeCategoryKey) {
        practiceSection.classList.add('hidden');
        return;
    }
    await loadReadyState();
    window.addEventListener('resize', fitRecordingCanvas);
});


function isSessionInProgress() {
    return !sessionScreen.classList.contains('hidden')
        && window.PracticeSession.hasActiveSession(activePendingSessionId)
        && sessionCards.length > 0;
}

function hasActiveSessionScreen() {
    return Boolean(
        sessionScreen
        && !sessionScreen.classList.contains('hidden')
        && window.PracticeSession.hasActiveSession(activePendingSessionId)
        && sessionCards.length > 0
    );
}

function updatePauseSessionButtonState() {
    if (!pauseSessionBtn) {
        return;
    }
    const shouldShow = hasActiveSessionScreen() && (isRecording || isRecordingPaused || isSessionPaused);
    pauseSessionBtn.classList.toggle('hidden', !shouldShow);
    if (!shouldShow) {
        pauseSessionBtn.textContent = 'Pause Session';
        pauseSessionBtn.disabled = true;
        return;
    }
    pauseSessionBtn.textContent = isSessionPaused ? 'Resume Session' : 'Pause Session';
    pauseSessionBtn.disabled = isUploadingRecording;
}

function syncSessionPauseLockUi() {
    const shouldLock = isSessionPaused;
    if (recordBtn) {
        recordBtn.disabled = shouldLock || isUploadingRecording;
        if (isRecordingPaused) {
            recordBtn.classList.add('recording');
            recordBtn.textContent = 'Recording Paused';
        }
    }
    if (continueBtn) {
        continueBtn.disabled = shouldLock || isUploadingRecording;
    }
    if (rerecordBtn) {
        rerecordBtn.disabled = shouldLock || isUploadingRecording;
    }
}


async function loadKidInfo() {
    try {
        const response = await fetch(`${API_BASE}/kids/${kidId}`);
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }
        currentKid = await response.json();
        activeCategoryKey = resolveTypeIIIPracticeCategoryKey
            ? resolveTypeIIIPracticeCategoryKey(currentKid, activeCategoryKey)
            : activeCategoryKey;
        if (!activeCategoryKey) {
            throw new Error('No type-III category is opted in');
        }
        const categoryMetaMap = getDeckCategoryMetaMap ? getDeckCategoryMetaMap(currentKid) : {};
        const categoryMeta = categoryMetaMap[activeCategoryKey] || {};
        const displayName = String(categoryMeta && categoryMeta.display_name ? categoryMeta.display_name : '').trim();
        currentCategoryDisplayName = displayName;
        kidNameEl.textContent = `${currentKid.name}'s ${currentCategoryDisplayName}`;
        if (startTitle) {
            startTitle.textContent = `Ready for ${currentCategoryDisplayName}?`;
        }
    } catch (error) {
        console.error('Error loading kid info:', error);
        showError('Failed to load kid information');
    }
}

function getCurrentCategoryDisplayName() {
    return String(currentCategoryDisplayName || '').trim();
}


async function loadReadyState() {
    try {
        showError('');
        const url = new URL(`${API_BASE}/kids/${kidId}/lesson-reading/decks`);
        url.searchParams.set('categoryKey', activeCategoryKey);
        const response = await fetch(url.toString());
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }

        const data = await response.json();
        const total = Number.parseInt(data.total_session_count, 10) || 0;
        const deckList = Array.isArray(data.decks) ? data.decks : [];
        const availableWithConfig = deckList.some((deck) => (Number(deck.total_cards || 0) > 0) && (Number(deck.session_count || 0) > 0));

        if (total <= 0) {
            practiceSection.classList.add('hidden');
            const label = getCurrentCategoryDisplayName();
            showError(`${label} practice is off. Ask your parent to set a session count in Manage ${label}.`);
            return;
        }

        if (!availableWithConfig) {
            practiceSection.classList.add('hidden');
            showError(`No ${getCurrentCategoryDisplayName()} cards available for current deck settings.`);
            return;
        }

        practiceSection.classList.remove('hidden');
        resetToStartScreen(total);
    } catch (error) {
        console.error('Error preparing type-III practice:', error);
        showError(`Failed to load ${getCurrentCategoryDisplayName()} practice data`);
    }
}


function resetToStartScreen(totalCards) {
    const target = Math.max(0, Number.parseInt(totalCards, 10) || 0);
    sessionInfo.textContent = `Session: ${target} cards`;

    sessionCards = [];
    window.PracticeSession.clearSessionStart(activePendingSessionId);
    activePendingSessionId = null;
    isSessionPaused = false;
    currentIndex = 0;
    completedCount = 0;
    sessionAnswers = [];

    startScreen.classList.remove('hidden');
    sessionScreen.classList.add('hidden');
    resultScreen.classList.add('hidden');
    updateFinishEarlyButtonState();
}


async function startSession() {
    try {
        showError('');
        const startUrl = new URL(`${API_BASE}/kids/${kidId}/lesson-reading/practice/start`);
        startUrl.searchParams.set('categoryKey', activeCategoryKey);
        const started = await window.PracticeSessionFlow.startShuffledSession(
            startUrl.toString(),
            {}
        );
        activePendingSessionId = started.pendingSessionId;
        sessionCards = started.cards;

        if (!window.PracticeSession.hasActiveSession(activePendingSessionId) || sessionCards.length === 0) {
            showError(`No ${getCurrentCategoryDisplayName()} cards available`);
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
        isRecordingPaused = false;
        isUploadingRecording = false;
        recordingStartedAtMs = 0;
        recordingPauseStartedAtMs = 0;
        isSessionPaused = false;

        startScreen.classList.add('hidden');
        resultScreen.classList.add('hidden');
        sessionScreen.classList.remove('hidden');

        showCurrentCard();
        updateFinishEarlyButtonState();
    } catch (error) {
        console.error('Error starting type-III session:', error);
        showError(`Failed to start ${getCurrentCategoryDisplayName()} session`);
    }
}


function showCurrentCard() {
    if (sessionCards.length === 0) {
        return;
    }

    const card = sessionCards[currentIndex];
    renderPracticeProgress(progress, progressFill, currentIndex + 1, sessionCards.length, 'Card');
    cardTitle.textContent = card.front || '';
    cardPage.textContent = card.back || '';
    if (cardSourceTags) {
        cardSourceTags.textContent = formatLessonReadingSourceTags(card);
    }
    clearPendingRecordingPreview();

    if (recordRow) {
        recordRow.classList.remove('hidden');
    }
    recordBtn.disabled = false;
    setRecordingVisual(false);
    syncSessionPauseLockUi();
    updateFinishEarlyButtonState();
}


function formatLessonReadingSourceTags(card) {
    if (!card || typeof card !== 'object') {
        return 'Source:';
    }
    const rawTags = Array.isArray(card.source_tags) ? card.source_tags : [];
    let tags = rawTags
        .map((tag) => String(tag || '').trim())
        .filter(Boolean);
    if (tags[0] === activeCategoryKey) {
        tags = tags.slice(1);
    }
    if (tags.length === 0 && card.source_is_orphan) {
        tags = ['orphan'];
    }
    if (tags.length === 0 && card.deck_name) {
        tags = [String(card.deck_name)];
    }
    return `Source: ${tags.join(' · ')}`;
}


async function toggleRecord() {
    if (!window.PracticeSession.hasActiveSession(activePendingSessionId) || sessionCards.length === 0) {
        return;
    }
    if (isSessionPaused) {
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
        updateFinishEarlyButtonState();
    } catch (error) {
        console.error('Error starting recording:', error);
        showError('Failed to start recording. Please allow microphone access.');
        stopRecordingVisualizer();
        setRecordingVisual(false);
        updateFinishEarlyButtonState();
    }
}


async function stopRecordingForReview() {
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
        updateFinishEarlyButtonState();
        return;
    }

    if (!blob || blob.size === 0) {
        showError('Recording is empty. Please record again.');
        resetRecordingState();
        recordBtn.disabled = false;
        setRecordingVisual(false);
        updateFinishEarlyButtonState();
        return;
    }

    resetRecordingState();

    pendingRecordedBlob = blob;
    pendingRecordedMimeType = mimeType;
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
    updateFinishEarlyButtonState();
}


function setRecordingVisual(recording) {
    recordBtn.classList.toggle('recording', recording);
    if (isRecordingPaused) {
        recordBtn.textContent = 'Recording Paused';
    } else {
        recordBtn.textContent = recording ? 'Stop Recording' : 'Start Recording';
    }
    syncSessionPauseLockUi();
    updateFinishEarlyButtonState();
}


function startRecordingVisualizer(stream) {
    if (!stream || !recordingWave || !recordingViz) {
        return;
    }
    recordingVisualizer.start(stream, {
        startedAtMs: recordingStartedAtMs,
        isActive: () => isRecording && !isRecordingPaused,
    });
}


function stopRecordingVisualizer() {
    recordingVisualizer.stop();
}


function fitRecordingCanvas() {
    recordingVisualizer.handleResize();
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
    isRecordingPaused = false;
    recordingStartedAtMs = 0;
    recordingPauseStartedAtMs = 0;
    recordingChunks = [];
    recordingMimeType = '';
    stopRecordingVisualizer();
    setRecordingVisual(false);
    if (mediaStream) {
        mediaStream.getTracks().forEach((track) => track.stop());
    }
    mediaStream = null;
    mediaRecorder = null;
    updateFinishEarlyButtonState();
}

function clearPendingRecordingPreview() {
    pendingRecordedBlob = null;
    pendingRecordedMimeType = '';
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
    updateFinishEarlyButtonState();
}

function reRecordCurrentCard() {
    if (isSessionPaused) {
        return;
    }
    if (isUploadingRecording || isRecording) {
        return;
    }
    clearPendingRecordingPreview();
    showError('');
}

async function confirmAndNext() {
    if (isSessionPaused) {
        return;
    }
    if (isRecording || isUploadingRecording || !pendingRecordedBlob) {
        return;
    }

    const card = sessionCards[currentIndex];
    isUploadingRecording = true;
    updateFinishEarlyButtonState();
    if (continueBtn) continueBtn.disabled = true;
    if (rerecordBtn) rerecordBtn.disabled = true;
    try {
        sessionRecordings[String(card.id)] = {
            blob: pendingRecordedBlob,
            mimeType: pendingRecordedMimeType || 'audio/webm',
        };

        sessionAnswers.push({
            cardId: card.id,
            known: true,
        });
        completedCount += 1;
        updateFinishEarlyButtonState();

        clearPendingRecordingPreview();

        if (currentIndex >= sessionCards.length - 1) {
            endSession();
            return;
        }
        currentIndex += 1;
        showCurrentCard();
    } catch (error) {
        console.error('Error saving type-III recording:', error);
        showError(error.message || 'Failed to save recording');
    } finally {
        isUploadingRecording = false;
        updateFinishEarlyButtonState();
        if (continueBtn) continueBtn.disabled = false;
        if (rerecordBtn) rerecordBtn.disabled = false;
    }
}


function mediaRecorderSupportsPauseResume() {
    return Boolean(
        mediaRecorder
        && typeof mediaRecorder.pause === 'function'
        && typeof mediaRecorder.resume === 'function'
    );
}

async function pauseSession() {
    if (!hasActiveSessionScreen() || isSessionPaused || isUploadingRecording || !isRecording) {
        return;
    }

    if (!mediaRecorderSupportsPauseResume() || mediaRecorder.state !== 'recording') {
        showError('Pause during recording is not supported in this browser. Stop recording first.');
        return;
    }
    try {
        mediaRecorder.pause();
        isRecordingPaused = true;
        recordingPauseStartedAtMs = Date.now();
        stopRecordingVisualizer();
        if (recordingViz) {
            recordingViz.classList.remove('hidden');
        }
        if (recordingStatusText) {
            recordingStatusText.textContent = 'Recording paused';
        }
    } catch (error) {
        console.error('Error pausing recording:', error);
        showError('Failed to pause recording.');
        return;
    }

    isSessionPaused = true;
    updateFinishEarlyButtonState();
}

function resumeSession() {
    if (!isSessionPaused) {
        return;
    }

    if (isRecordingPaused) {
        if (!mediaRecorderSupportsPauseResume() || mediaRecorder.state !== 'paused') {
            showError('Could not resume recording. Please re-record this card.');
            resetRecordingState();
            clearPendingRecordingPreview();
            isSessionPaused = false;
            updateFinishEarlyButtonState();
            return;
        }

        try {
            mediaRecorder.resume();
            const pausedMs = recordingPauseStartedAtMs > 0 ? Date.now() - recordingPauseStartedAtMs : 0;
            recordingStartedAtMs += Math.max(0, pausedMs);
            recordingPauseStartedAtMs = 0;
            isRecordingPaused = false;
            startRecordingVisualizer(mediaStream);
            setRecordingVisual(true);
        } catch (error) {
            console.error('Error resuming recording:', error);
            showError('Failed to resume recording. Please re-record this card.');
            resetRecordingState();
            clearPendingRecordingPreview();
            isSessionPaused = false;
            updateFinishEarlyButtonState();
            return;
        }
    }

    isSessionPaused = false;
    updateFinishEarlyButtonState();
}

function toggleSessionPause() {
    if (isSessionPaused) {
        resumeSession();
        return;
    }
    if (!isRecording) {
        return;
    }
    void pauseSession();
}

function updateFinishEarlyButtonState() {
    earlyFinishController.updateButtonState();
    updatePauseSessionButtonState();
    syncSessionPauseLockUi();
}

function requestEarlyFinish() {
    if (isSessionPaused) {
        return;
    }
    earlyFinishController.requestFinish();
}

async function endSession(endedEarly = false) {
    sessionScreen.classList.add('hidden');
    resultScreen.classList.remove('hidden');
    isSessionPaused = false;
    isRecordingPaused = false;
    recordingPauseStartedAtMs = 0;
    resultSummary.textContent = endedEarly
        ? `Ended early · Completed: ${completedCount} cards`
        : `Completed: ${completedCount} cards`;

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
            formData.append('categoryKey', activeCategoryKey);
            formData.append('audio', audio.blob, `type3-${activeCategoryKey}-${cardId}.${ext}`);
            const uploadRes = await fetch(`${API_BASE}/kids/${kidId}/lesson-reading/practice/upload-audio`, {
                method: 'POST',
                body: formData,
            });
            const uploadPayload = await uploadRes.json().catch(() => ({}));
            if (!uploadRes.ok) {
                throw new Error(uploadPayload.error || `Audio upload failed (HTTP ${uploadRes.status})`);
            }
        }

        payload.categoryKey = activeCategoryKey;
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
        console.error('Error completing type-III session:', error);
        showError(error.message || 'Failed to save session results');
    }
    window.PracticeSession.clearSessionStart(activePendingSessionId);
    updateFinishEarlyButtonState();

    sessionRecordings = {};
    await loadKidInfo();
}


function showError(message) {
    window.PracticeUiCommon.showAlertError(errorState, errorMessage, message);
}

window.reRecordCurrentCard = reRecordCurrentCard;
window.confirmAndNext = confirmAndNext;
window.toggleSessionPause = toggleSessionPause;
