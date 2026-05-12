/*
 * kid-practice-type3.js — Type-III lesson reading runtime
 *
 * Layout:
 *   1. Ready check + session start
 *   2. Card display + pause-UI sync
 *   3. Recording start/stop + capture + visualizer
 *   4. Recording preview + re-record + confirm-next
 *   5. Pause / resume session
 *   6. Source-tag formatting + session end
 */

// =====================================================================
// === 1. Ready check + session start
// =====================================================================

async function loadType3ReadyState() {
    showError('');
    const response = await fetch(buildType3ApiUrl('decks'));
    if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
    }

    const data = await response.json();
    resetReadyRetryState();
    applyReadyRetryState(data);
    const total = Number.parseInt(data.total_session_count, 10) || 0;
    const deckList = Array.isArray(data.decks) ? data.decks : [];
    const availableWithConfig = deckList.some((deck) => {
        return Number(deck.total_cards || 0) > 0 && Number(deck.session_count || 0) > 0;
    });

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
}
async function startType3Session() {
    try {
        showError('');
        const started = await window.PracticeSessionFlow.startShuffledSession(
            buildType3ApiUrl('practice/start'),
            {}
        );
        state.activePendingSessionId = started.pendingSessionId;
        state.activeIsRetrySession = Boolean(started?.data?.is_retry_session);
        state.sessionCards = started.cards;

        if (!window.PracticeSession.hasActiveSession(state.activePendingSessionId) || state.sessionCards.length === 0) {
            state.activeIsRetrySession = false;
            showError(`No ${getCurrentCategoryDisplayName()} cards available`);
            return;
        }

        state.currentIndex = 0;
        state.completedCount = 0;
        state.sessionAnswers = [];
        state.sessionRecordings = {};
        state.recordingChunks = [];
        state.recordingMimeType = '';
        clearPendingRecordingPreview();
        state.isRecording = false;
        state.isRecordingPaused = false;
        state.isUploadingRecording = false;
        state.recordingStartedAtMs = 0;
        state.recordingPauseStartedAtMs = 0;
        state.isSessionPaused = false;

        startScreen.classList.add('hidden');
        resultScreen.classList.add('hidden');
        sessionScreen.classList.remove('hidden');
        setHeaderBackToPracticeVisible(true);

        showCurrentType3Card();
        updateFinishEarlyButtonState();
    } catch (error) {
        console.error('Error starting type-III session:', error);
        showError(`Failed to start ${getCurrentCategoryDisplayName()} session`);
    }
}
// =====================================================================
// === 2. Card display + pause-UI sync
// =====================================================================

function showCurrentType3Card() {
    if (state.sessionCards.length === 0 || !isType(BEHAVIOR_TYPE_III)) {
        return;
    }

    showTypeSpecificCardSections();

    const card = state.sessionCards[state.currentIndex];
    renderPracticeProgress(progress, progressFill, state.currentIndex + 1, state.sessionCards.length, 'Card');
    if (hasMathNotation(card.front)) {
        cardTitle.innerHTML = renderMathHtml(card.front);
    } else {
        cardTitle.textContent = card.front || '';
    }
    cardPage.textContent = card.back || '';
    cardSourceTags.textContent = formatType3SourceTags(card);

    clearPendingRecordingPreview();

    recordRow.classList.remove('hidden');
    reviewControls.classList.add('hidden');
    recordBtn.disabled = false;
    setRecordingVisual(false);
    syncSessionPauseLockUi();
    updateFinishEarlyButtonState();
}
function updatePauseSessionButtonState() {
    if (!pauseSessionBtn || !isType(BEHAVIOR_TYPE_III)) {
        return;
    }
    const shouldShow = hasActiveSessionScreen() && (state.isRecording || state.isRecordingPaused || state.isSessionPaused);
    pauseSessionBtn.classList.toggle('hidden', !shouldShow);
    const pauseIcon = window.icon('pause', { size: 20 });
    const playIcon = window.icon('play', { size: 20 });
    if (!shouldShow) {
        pauseSessionBtn.innerHTML = pauseIcon;
        pauseSessionBtn.setAttribute('aria-label', 'Pause');
        pauseSessionBtn.setAttribute('title', 'Pause');
        pauseSessionBtn.disabled = true;
        return;
    }
    pauseSessionBtn.innerHTML = state.isSessionPaused ? playIcon : pauseIcon;
    pauseSessionBtn.setAttribute('aria-label', state.isSessionPaused ? 'Resume' : 'Pause');
    pauseSessionBtn.setAttribute('title', state.isSessionPaused ? 'Resume' : 'Pause');
    pauseSessionBtn.disabled = state.isUploadingRecording;
}

function syncSessionPauseLockUi() {
    if (!isType(BEHAVIOR_TYPE_III)) {
        return;
    }

    const shouldLock = state.isSessionPaused;
    recordBtn.disabled = shouldLock || state.isUploadingRecording;
    if (state.isRecordingPaused) {
        recordBtn.classList.add('recording');
        recordBtnLabel.textContent = 'Recording Paused';
    }
    continueBtn.disabled = shouldLock || state.isUploadingRecording;
    rerecordBtn.disabled = shouldLock || state.isUploadingRecording;
}
// =====================================================================
// === 3. Recording start/stop + capture + visualizer
// =====================================================================

async function toggleRecord() {
    if (!isType(BEHAVIOR_TYPE_III)) {
        return;
    }
    if (!window.PracticeSession.hasActiveSession(state.activePendingSessionId) || state.sessionCards.length === 0) {
        return;
    }
    if (state.isSessionPaused || state.isUploadingRecording) {
        return;
    }

    if (state.isRecording) {
        await stopRecordingForReview();
        return;
    }
    if (state.pendingRecordedBlob) {
        showError('Replay or continue this recording, or redo.');
        return;
    }

    try {
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
            showError('Recording is not supported in this browser');
            return;
        }

        state.mediaStream = await window.AudioCommon.getMicStream();
        state.mediaRecorder = new MediaRecorder(state.mediaStream, window.AudioCommon.getRecorderOptions());
        state.recordingChunks = [];
        state.recordingMimeType = state.mediaRecorder.mimeType || '';
        state.mediaRecorder.ondataavailable = (event) => {
            if (event.data && event.data.size > 0) {
                state.recordingChunks.push(event.data);
            }
        };

        state.mediaRecorder.start(window.AudioCommon.TIMESLICE_MS);
        if (window.AudioCommon && typeof window.AudioCommon.logRecorderDiagnostics === 'function') {
            window.AudioCommon.logRecorderDiagnostics(state.mediaRecorder, state.mediaStream);
        }
        state.recordingStartedAtMs = Date.now();
        state.isRecording = true;
        startRecordingVisualizer(state.mediaStream);
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
    const previousBtnText = recordBtnLabel.textContent;
    recordBtn.disabled = true;
    recordBtnLabel.textContent = 'Stopping...';

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
        recordBtnLabel.textContent = previousBtnText;
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

    state.pendingRecordedBlob = blob;
    state.pendingRecordedMimeType = mimeType;
    if (state.pendingRecordedUrl) {
        URL.revokeObjectURL(state.pendingRecordedUrl);
    }
    state.pendingRecordedUrl = URL.createObjectURL(blob);
    reviewAudio.src = state.pendingRecordedUrl;
    reviewAudioRow.classList.remove('hidden');
    reviewControls.classList.remove('hidden');
    recordRow.classList.add('hidden');
    recordBtn.disabled = false;
    showError('');
    updateFinishEarlyButtonState();
}
function setRecordingVisual(recording) {
    if (!isType(BEHAVIOR_TYPE_III)) {
        return;
    }

    recordBtn.classList.toggle('recording', recording);
    if (state.isRecordingPaused) {
        recordBtnLabel.textContent = 'Recording Paused';
    } else {
        recordBtnLabel.textContent = recording ? 'Stop Recording' : 'Start Recording';
    }
    syncSessionPauseLockUi();
    updateFinishEarlyButtonState();
}
function startRecordingVisualizer(stream) {
    if (!recordingVisualizer || !stream || !recordingWave || !recordingViz) {
        return;
    }
    recordingVisualizer.start(stream, {
        startedAtMs: state.recordingStartedAtMs,
        isActive: () => state.isRecording && !state.isRecordingPaused,
    });
}

function stopRecordingVisualizer() {
    if (recordingVisualizer) {
        recordingVisualizer.stop();
    }
}

function fitRecordingCanvas() {
    if (recordingVisualizer) {
        recordingVisualizer.handleResize();
    }
}
async function stopAndCaptureRecording() {
    return new Promise((resolve, reject) => {
        if (!state.mediaRecorder || state.mediaRecorder.state !== 'recording') {
            resolve(null);
            return;
        }

        const recorder = state.mediaRecorder;
        let resolved = false;
        recorder.onstop = () => {
            if (resolved) {
                return;
            }
            resolved = true;
            const finalMimeType = recorder.mimeType || state.recordingMimeType || 'audio/webm';
            const blob = state.recordingChunks.length > 0
                ? new Blob(state.recordingChunks, { type: finalMimeType })
                : null;
            if (state.mediaStream) {
                state.mediaStream.getTracks().forEach((track) => track.stop());
            }
            state.mediaStream = null;
            state.mediaRecorder = null;
            resolve({ blob, mimeType: finalMimeType });
        };
        recorder.onerror = () => {
            if (resolved) {
                return;
            }
            resolved = true;
            if (state.mediaStream) {
                state.mediaStream.getTracks().forEach((track) => track.stop());
            }
            state.mediaStream = null;
            state.mediaRecorder = null;
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
    state.isRecording = false;
    state.isRecordingPaused = false;
    state.recordingStartedAtMs = 0;
    state.recordingPauseStartedAtMs = 0;
    state.recordingChunks = [];
    state.recordingMimeType = '';
    stopRecordingVisualizer();

    if (isType(BEHAVIOR_TYPE_III)) {
        setRecordingVisual(false);
    }

    if (state.mediaStream) {
        state.mediaStream.getTracks().forEach((track) => track.stop());
    }
    state.mediaStream = null;
    state.mediaRecorder = null;
    updateFinishEarlyButtonState();
}
// =====================================================================
// === 4. Recording preview + re-record + confirm-next
// =====================================================================

function clearPendingRecordingPreview() {
    state.pendingRecordedBlob = null;
    state.pendingRecordedMimeType = '';

    try {
        reviewAudio.pause();
    } catch (error) {
        // no-op
    }
    reviewAudio.removeAttribute('src');
    reviewAudio.load();
    reviewAudioRow.classList.add('hidden');

    reviewControls.classList.add('hidden');
    if (isType(BEHAVIOR_TYPE_III)) {
        recordRow.classList.remove('hidden');
        setRecordingVisual(false);
    }

    if (state.pendingRecordedUrl) {
        URL.revokeObjectURL(state.pendingRecordedUrl);
        state.pendingRecordedUrl = '';
    }
    updateFinishEarlyButtonState();
}
function reRecordCurrentCard() {
    if (!isType(BEHAVIOR_TYPE_III)) {
        return;
    }
    if (state.isSessionPaused || state.isUploadingRecording || state.isRecording) {
        return;
    }
    clearPendingRecordingPreview();
    showError('');
}
async function confirmAndNext() {
    if (!isType(BEHAVIOR_TYPE_III)) {
        return;
    }
    if (state.isSessionPaused || state.isRecording || state.isUploadingRecording || !state.pendingRecordedBlob) {
        return;
    }

    const card = state.sessionCards[state.currentIndex];
    state.isUploadingRecording = true;
    updateFinishEarlyButtonState();
    continueBtn.disabled = true;
    rerecordBtn.disabled = true;

    try {
        state.sessionRecordings[String(card.id)] = {
            blob: state.pendingRecordedBlob,
            mimeType: state.pendingRecordedMimeType || 'audio/webm',
        };

        state.sessionAnswers.push({
            cardId: card.id,
            known: true,
        });
        state.completedCount += 1;
        updateFinishEarlyButtonState();

        clearPendingRecordingPreview();

        if (state.currentIndex >= state.sessionCards.length - 1) {
            await endSession();
            return;
        }

        state.currentIndex += 1;
        showCurrentType3Card();
    } catch (error) {
        console.error('Error saving type-III recording:', error);
        showError(error.message || 'Failed to save recording');
    } finally {
        state.isUploadingRecording = false;
        updateFinishEarlyButtonState();
        continueBtn.disabled = false;
        rerecordBtn.disabled = false;
    }
}
// =====================================================================
// === 5. Pause / resume session
// =====================================================================

function mediaRecorderSupportsPauseResume() {
    return Boolean(
        state.mediaRecorder
        && typeof state.mediaRecorder.pause === 'function'
        && typeof state.mediaRecorder.resume === 'function'
    );
}
async function pauseSession() {
    if (!isType(BEHAVIOR_TYPE_III)) {
        return;
    }
    if (!hasActiveSessionScreen() || state.isSessionPaused || state.isUploadingRecording || !state.isRecording) {
        return;
    }

    if (!mediaRecorderSupportsPauseResume() || state.mediaRecorder.state !== 'recording') {
        showError('Pause during recording is not supported in this browser. Stop recording first.');
        return;
    }

    try {
        state.mediaRecorder.pause();
        state.isRecordingPaused = true;
        state.recordingPauseStartedAtMs = Date.now();
        stopRecordingVisualizer();
        recordingViz.classList.remove('hidden');
        recordingStatusText.textContent = 'Recording paused';
    } catch (error) {
        console.error('Error pausing recording:', error);
        showError('Failed to pause recording.');
        return;
    }

    state.isSessionPaused = true;
    updateFinishEarlyButtonState();
}

function resumeSession() {
    if (!isType(BEHAVIOR_TYPE_III) || !state.isSessionPaused) {
        return;
    }

    if (state.isRecordingPaused) {
        if (!mediaRecorderSupportsPauseResume() || state.mediaRecorder.state !== 'paused') {
            showError('Could not resume recording. Please redo this card.');
            resetRecordingState();
            clearPendingRecordingPreview();
            state.isSessionPaused = false;
            updateFinishEarlyButtonState();
            return;
        }

        try {
            state.mediaRecorder.resume();
            const pausedMs = state.recordingPauseStartedAtMs > 0
                ? Date.now() - state.recordingPauseStartedAtMs
                : 0;
            state.recordingStartedAtMs += Math.max(0, pausedMs);
            state.recordingPauseStartedAtMs = 0;
            state.isRecordingPaused = false;
            startRecordingVisualizer(state.mediaStream);
            setRecordingVisual(true);
        } catch (error) {
            console.error('Error resuming recording:', error);
            showError('Failed to resume recording. Please redo this card.');
            resetRecordingState();
            clearPendingRecordingPreview();
            state.isSessionPaused = false;
            updateFinishEarlyButtonState();
            return;
        }
    }

    state.isSessionPaused = false;
    updateFinishEarlyButtonState();
}

function toggleSessionPause() {
    if (!isType(BEHAVIOR_TYPE_III)) {
        return;
    }
    if (state.isSessionPaused) {
        resumeSession();
        return;
    }
    if (!state.isRecording) {
        return;
    }
    void pauseSession();
}
// =====================================================================
// === 6. Source-tag formatting + session end
// =====================================================================

function formatType3SourceTags(card) {
    if (!card || typeof card !== 'object') {
        return 'Source:';
    }
    const rawTags = Array.isArray(card.source_tags) ? card.source_tags : [];
    let tags = rawTags
        .map((tag) => String(tag || '').trim())
        .filter(Boolean);
    if (tags[0] === state.categoryKey) {
        tags = tags.slice(1);
    }
    if (tags.length === 0 && card.source_is_orphan) {
        tags = ['personal'];
    }
    if (tags.length === 0 && card.deck_name) {
        tags = [String(card.deck_name)];
    }
    return `Source: ${tags.join(' · ')}`;
}
async function endType3Session(endedEarly = false) {
    sessionScreen.classList.add('hidden');
    resultScreen.classList.remove('hidden');
    setHeaderBackToPracticeVisible(false);
    state.isSessionPaused = false;
    state.isRecordingPaused = false;
    state.recordingPauseStartedAtMs = 0;
    state.pendingResultEndedEarly = Boolean(endedEarly);
    setResultActionMode('saving');
    resultSummary.textContent = endedEarly
        ? `Ended early · Saving ${state.completedCount} recordings...`
        : `Saving ${state.completedCount} recordings...`;

    try {
        showError('');
        const payload = window.PracticeSession.buildCompletePayload(
            state.activePendingSessionId,
            state.sessionAnswers,
        );
        const pendingSessionId = String(payload.pendingSessionId || '');

        for (const [cardIdRaw, audio] of Object.entries(state.sessionRecordings)) {
            if (!audio || !audio.blob) {
                continue;
            }
            const cardId = Number.parseInt(cardIdRaw, 10);
            if (!Number.isFinite(cardId)) {
                continue;
            }
            const mimeType = String(audio.mimeType || 'audio/webm');
            const ext = window.AudioCommon.guessExtension(mimeType);
            const formData = new FormData();
            formData.append('pendingSessionId', pendingSessionId);
            formData.append('cardId', String(cardId));
            formData.append('categoryKey', state.categoryKey);
            formData.append('audio', audio.blob, `type3-${state.categoryKey}-${cardId}.${ext}`);

            const uploadRes = await fetch(`${API_BASE}/kids/${kidId}/lesson-reading/practice/upload-audio`, {
                method: 'POST',
                body: formData,
            });
            const uploadPayload = await uploadRes.json().catch(() => ({}));
            if (!uploadRes.ok) {
                throw new Error(uploadPayload.error || `Audio upload failed (HTTP ${uploadRes.status})`);
            }
        }

        payload.categoryKey = state.categoryKey;
        const response = await fetch(buildType3ApiUrl('practice/complete'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok) {
            throw new Error(result.error || `HTTP ${response.status}`);
        }
        resultSummary.textContent = endedEarly
            ? `Ended early · Completed: ${state.completedCount} cards`
            : `Completed: ${state.completedCount} cards`;
        window.PracticeSession.clearSessionStart(state.activePendingSessionId);
        updateFinishEarlyButtonState();
        setResultActionMode('back');
        state.sessionRecordings = {};
    } catch (error) {
        console.error('Error completing type-III session:', error);
        resultSummary.textContent = 'Could not save this session yet.';
        setResultActionMode('retry-save');
        showError(error.message || 'Failed to save session results');
        return;
    }
}
