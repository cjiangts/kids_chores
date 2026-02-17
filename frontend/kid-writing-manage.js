const API_BASE = `${window.location.origin}/api`;

const params = new URLSearchParams(window.location.search);
const kidId = params.get('id');

const kidNameEl = document.getElementById('kidName');
const errorMessage = document.getElementById('errorMessage');
const bulkImportForm = document.getElementById('bulkImportForm');
const bulkWritingText = document.getElementById('bulkWritingText');
const bulkAddBtn = document.getElementById('bulkAddBtn');
const addMaLiPingWritingBtn = document.getElementById('addMaLiPingWritingBtn');
const bulkImportErrorMessage = document.getElementById('bulkImportErrorMessage');
const sheetErrorMessage = document.getElementById('sheetErrorMessage');
const sessionSettingsForm = document.getElementById('sessionSettingsForm');
const sessionCardCountInput = document.getElementById('sessionCardCount');
const sheetCardCountInput = document.getElementById('sheetCardCount');
const sheetRowsPerCharInput = document.getElementById('sheetRowsPerChar');
const createSheetBtn = document.getElementById('createSheetBtn');
const viewSheetsBtn = document.getElementById('viewSheetsBtn');
const practicingSummary = document.getElementById('practicingSummary');
const viewOrderSelect = document.getElementById('viewOrderSelect');
const cardSearchInput = document.getElementById('cardSearchInput');
const cardCount = document.getElementById('cardCount');
const cardsGrid = document.getElementById('cardsGrid');
const charactersTab = document.getElementById('charactersTab');
const writingTab = document.getElementById('writingTab');
const mathTab = document.getElementById('mathTab');
const lessonReadingTab = document.getElementById('lessonReadingTab');

let currentCards = [];
let sortedCards = [];
let visibleCardCount = 10;
const CARD_PAGE_SIZE = 10;

let mediaRecorder = null;
let mediaStream = null;
let isRecordTransitioning = false;
let recordingCardId = null;
let recordedForCardId = null;
let recordedBlob = null;
let recordedUploadFileName = 'prompt.webm';
let recordedPreviewUrl = null;
let autoPlayRecordedCardId = null;

function escapeAttr(value) {
    return String(value || '')
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

document.addEventListener('DOMContentLoaded', async () => {
    if (!kidId) {
        window.location.href = '/admin.html';
        return;
    }

    charactersTab.href = `/kid-reading-manage.html?id=${kidId}`;
    writingTab.href = `/kid-writing-manage.html?id=${kidId}`;
    mathTab.href = `/kid-math-manage.html?id=${kidId}`;
    lessonReadingTab.href = `/kid-lesson-reading-manage.html?id=${kidId}`;

    sessionSettingsForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        await saveSessionSettings();
    });

    bulkImportForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        await bulkImportWritingCards();
    });
    if (addMaLiPingWritingBtn) {
        addMaLiPingWritingBtn.addEventListener('click', () => {
            window.open('/writing-preset-maliping.html', '_blank', 'noopener,noreferrer,width=980,height=860');
        });
    }
    bulkWritingText.addEventListener('input', () => {
        updateBulkAddButtonCount();
    });

    viewOrderSelect.addEventListener('change', () => resetAndDisplayCards(currentCards));
    cardSearchInput.addEventListener('input', () => resetAndDisplayCards(currentCards));
    cardsGrid.addEventListener('click', handleCardsGridClick);
    window.addEventListener('scroll', () => maybeLoadMoreCards());

    createSheetBtn.addEventListener('click', async () => createAndPrintSheet());
    viewSheetsBtn.addEventListener('click', () => viewSheets());

    await loadKidInfo();
    await loadWritingCards();
    updateBulkAddButtonCount();
});

async function loadKidInfo() {
    try {
        const response = await fetch(`${API_BASE}/kids/${kidId}`);
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }

        const kid = await response.json();
        kidNameEl.textContent = `${kid.name}'s Chinese Character Writing`;
        const writingCount = Number.isInteger(Number.parseInt(kid.writingSessionCardCount, 10))
            ? Number.parseInt(kid.writingSessionCardCount, 10)
            : 0;
        sessionCardCountInput.value = writingCount;
        sheetCardCountInput.value = writingCount;
    } catch (error) {
        console.error('Error loading kid:', error);
        showError('Failed to load kid information');
    }
}

async function saveSessionSettings() {
    try {
        const value = Number.parseInt(sessionCardCountInput.value, 10);
        if (!Number.isInteger(value) || value < 0 || value > 200) {
            showError('Session size must be between 0 and 200');
            return;
        }

        const response = await fetch(`${API_BASE}/kids/${kidId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ writingSessionCardCount: value })
        });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }

        const updatedKid = await response.json();
        const updatedWritingCount = Number.isInteger(Number.parseInt(updatedKid.writingSessionCardCount, 10))
            ? Number.parseInt(updatedKid.writingSessionCardCount, 10)
            : value;
        sessionCardCountInput.value = updatedWritingCount;
        sheetCardCountInput.value = updatedWritingCount;
        showError('');
    } catch (error) {
        console.error('Error saving session settings:', error);
        showError('Failed to save practice settings');
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
        currentCards = data.cards || [];
        resetAndDisplayCards(currentCards);
    } catch (error) {
        console.error('Error loading writing cards:', error);
        showError('Failed to load Chinese writing cards');
    }
}

async function bulkImportWritingCards() {
    try {
        showBulkImportError('');
        const rawText = String(bulkWritingText.value || '').trim();
        if (!rawText) {
            showBulkImportError('Please paste Chinese words/phrases first');
            return;
        }

        const response = await fetch(`${API_BASE}/kids/${kidId}/writing/cards/bulk`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text: rawText })
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
            throw new Error(payload.error || `HTTP ${response.status}`);
        }

        const inserted = Number(payload.inserted_count || 0);
        const skipped = Number(payload.skipped_existing_count || 0);
        bulkWritingText.value = '';
        updateBulkAddButtonCount();
        await loadWritingCards();
        showBulkImportError(`Added ${inserted} new card(s). Skipped ${skipped} existing card(s).`, false);
    } catch (error) {
        console.error('Error bulk importing writing cards:', error);
        showBulkImportError(error.message || 'Failed to bulk import writing cards');
    }
}

function updateBulkAddButtonCount() {
    const totalTokens = countWritingTokensBeforeDbDedup(bulkWritingText.value);
    if (totalTokens > 0) {
        bulkAddBtn.textContent = `Bulk Add Chinese Writing Prompt (${totalTokens})`;
        return;
    }
    bulkAddBtn.textContent = 'Bulk Add Chinese Writing Prompt';
}

function countWritingTokensBeforeDbDedup(text) {
    const matches = String(text || '').match(/[\u3400-\u9FFF\uF900-\uFAFF]+/g);
    return matches ? matches.length : 0;
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
    const value = String(mimeType || '').toLowerCase();
    if (value.includes('mp4') || value.includes('m4a')) return 'm4a';
    if (value.includes('ogg')) return 'ogg';
    if (value.includes('aac')) return 'aac';
    return 'webm';
}

async function startRecordingForCard(cardId) {
    try {
        if (isRecordTransitioning) {
            return;
        }
        if (mediaRecorder && mediaRecorder.state === 'recording') {
            return;
        }
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
            showError('Recording is not supported in this browser');
            return;
        }

        isRecordTransitioning = true;
        recordingCardId = String(cardId);

        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        const preferredMimeType = getPreferredRecordingMimeType();
        const recorder = preferredMimeType
            ? new MediaRecorder(stream, { mimeType: preferredMimeType })
            : new MediaRecorder(stream);
        const chunks = [];
        const startedAt = Date.now();

        mediaStream = stream;
        mediaRecorder = recorder;
        recordedBlob = null;
        if (recordedPreviewUrl) {
            URL.revokeObjectURL(recordedPreviewUrl);
            recordedPreviewUrl = null;
        }

        recorder.ondataavailable = (event) => {
            if (event.data && event.data.size > 0) {
                chunks.push(event.data);
            }
        };

        recorder.onstart = () => {
            displayCards(currentCards);
        };

        recorder.onstop = () => {
            const finalMimeType = recorder.mimeType || preferredMimeType || 'audio/webm';
            const blob = new Blob(chunks, { type: finalMimeType });
            const failed = !blob || blob.size === 0;
            const elapsedMs = Date.now() - startedAt;
            const tooShort = elapsedMs < 300;
            const invalid = failed || tooShort;

            if (!invalid) {
                recordedBlob = blob;
                recordedUploadFileName = `prompt.${guessAudioExtension(finalMimeType)}`;
                recordedForCardId = String(cardId);
                recordedPreviewUrl = URL.createObjectURL(blob);
                autoPlayRecordedCardId = String(cardId);
            } else {
                recordedBlob = null;
                recordedForCardId = null;
                if (recordedPreviewUrl) {
                    URL.revokeObjectURL(recordedPreviewUrl);
                    recordedPreviewUrl = null;
                }
                showError('Recording failed (too short or empty), please try again');
            }

            isRecordTransitioning = false;
            mediaRecorder = null;
            recordingCardId = null;
            if (mediaStream === stream) {
                mediaStream.getTracks().forEach((track) => track.stop());
                mediaStream = null;
            }
            displayCards(currentCards);
        };

        recorder.onerror = () => {
            isRecordTransitioning = false;
            mediaRecorder = null;
            recordingCardId = null;
            if (mediaStream === stream) {
                mediaStream.getTracks().forEach((track) => track.stop());
                mediaStream = null;
            }
            showError('Recording failed, please try again');
            displayCards(currentCards);
        };

        recorder.start(200);
        isRecordTransitioning = false;
        displayCards(currentCards);
    } catch (error) {
        console.error('Error starting recording:', error);
        isRecordTransitioning = false;
        recordingCardId = null;
        mediaRecorder = null;
        if (mediaStream) {
            mediaStream.getTracks().forEach((track) => track.stop());
            mediaStream = null;
        }
        showError('Failed to start recording. Please allow microphone access.');
        displayCards(currentCards);
    }
}

function stopRecording() {
    if (!mediaRecorder || mediaRecorder.state !== 'recording') {
        return;
    }
    isRecordTransitioning = true;
    try {
        mediaRecorder.requestData();
    } catch (error) {
        // best effort
    }
    mediaRecorder.stop();
}

async function saveRecordingToCard(cardId) {
    try {
        showError('');
        const targetId = String(cardId || '');
        if (!targetId) {
            showError('Invalid card');
            return;
        }
        if (!recordedBlob || recordedBlob.size === 0 || String(recordedForCardId || '') !== targetId) {
            showError('Please record audio for this card first');
            return;
        }
        if (mediaRecorder && mediaRecorder.state === 'recording') {
            showError('Please stop recording first');
            return;
        }

        const formData = new FormData();
        formData.append('audio', recordedBlob, recordedUploadFileName || 'prompt.webm');
        const response = await fetch(`${API_BASE}/kids/${kidId}/writing/cards/${encodeURIComponent(targetId)}/audio`, {
            method: 'POST',
            body: formData
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
            throw new Error(payload.error || `HTTP ${response.status}`);
        }

        recordedBlob = null;
        recordedForCardId = null;
        if (recordedPreviewUrl) {
            URL.revokeObjectURL(recordedPreviewUrl);
            recordedPreviewUrl = null;
        }
        await loadWritingCards();
    } catch (error) {
        console.error('Error saving recording:', error);
        showError(error.message || 'Failed to save recording');
    }
}

async function clearSavedAudioForCard(cardId) {
    try {
        showError('');
        const targetId = String(cardId || '');
        if (!targetId) {
            return;
        }
        const response = await fetch(`${API_BASE}/kids/${kidId}/writing/cards/${encodeURIComponent(targetId)}/audio`, {
            method: 'DELETE'
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
            throw new Error(payload.error || `HTTP ${response.status}`);
        }
        await loadWritingCards();
    } catch (error) {
        console.error('Error clearing writing audio:', error);
        showError(error.message || 'Failed to clear audio');
    }
}

function clearRecordedForCard(cardId) {
    const targetId = String(cardId || '');
    if (String(recordedForCardId || '') !== targetId) {
        return;
    }
    recordedBlob = null;
    recordedForCardId = null;
    if (recordedPreviewUrl) {
        URL.revokeObjectURL(recordedPreviewUrl);
        recordedPreviewUrl = null;
    }
    displayCards(currentCards);
}

async function createAndPrintSheet() {
    let previewWindow = null;
    try {
        previewWindow = window.open('about:blank', '_blank');
        if (!previewWindow) {
            showSheetError('Popup blocked. Please allow popups for this site to preview the sheet.');
            return;
        }
        try {
            previewWindow.document.write('<!doctype html><title>Loading…</title><p style="font-family: sans-serif; padding: 1rem;">Preparing sheet preview…</p>');
        } catch (error) {
            // continue
        }

        const count = Number.parseInt(sheetCardCountInput.value, 10);
        const rowsPerCharacter = Number.parseInt(sheetRowsPerCharInput.value, 10);
        showSheetError('');
        if (!Number.isInteger(count) || count < 1 || count > 200) {
            showSheetError('Cards per sheet must be between 1 and 200');
            previewWindow.close();
            return;
        }
        if (!Number.isInteger(rowsPerCharacter) || rowsPerCharacter < 1 || rowsPerCharacter > 10) {
            showSheetError('Rows per card must be between 1 and 10');
            previewWindow.close();
            return;
        }
        if (count * rowsPerCharacter > 10) {
            const maxCards = Math.max(1, Math.floor(10 / rowsPerCharacter));
            showSheetError(`One page max is 10 rows. With ${rowsPerCharacter} row(s) per card, max cards is ${maxCards}.`);
            previewWindow.close();
            return;
        }

        const response = await fetch(`${API_BASE}/kids/${kidId}/writing/sheets/preview`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ count, rows_per_character: rowsPerCharacter })
        });
        if (!response.ok) {
            const payload = await response.json().catch(() => ({}));
            throw new Error(payload.error || `HTTP ${response.status}`);
        }

        const result = await response.json();
        if (!result.preview || !Array.isArray(result.cards) || result.cards.length === 0) {
            const msg = result.message || 'No eligible cards to print right now';
            showSheetError(msg);
            return;
        }

        const previewKey = `writing_sheet_preview_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
        const previewPayload = {
            kidId: String(kidId),
            rows_per_character: rowsPerCharacter,
            cards: result.cards,
            created_at: new Date().toISOString()
        };
        localStorage.setItem(previewKey, JSON.stringify(previewPayload));

        const printUrl = `/writing-sheet-print.html?id=${kidId}&previewKey=${encodeURIComponent(previewKey)}`;
        previewWindow.location.href = printUrl;
    } catch (error) {
        console.error('Error creating writing sheet:', error);
        if (previewWindow && !previewWindow.closed) {
            previewWindow.close();
        }
        showSheetError(error.message || 'Failed to generate practice sheet preview');
    }
}

function viewSheets() {
    window.location.href = `/kid-writing-sheets.html?id=${kidId}`;
}

async function deleteWritingCard(cardId) {
    if (!confirm('Are you sure you want to delete this Chinese writing card?')) {
        return;
    }

    try {
        const response = await fetch(`${API_BASE}/kids/${kidId}/writing/cards/${cardId}`, {
            method: 'DELETE'
        });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }

        if (String(recordedForCardId || '') === String(cardId)) {
            clearRecordedForCard(cardId);
        }
        await loadWritingCards();
    } catch (error) {
        console.error('Error deleting writing card:', error);
        showError('Failed to delete Chinese writing card');
    }
}

function displayCards(cards) {
    const filteredCards = filterCardsByQuery(cards, cardSearchInput.value);
    const sortMode = viewOrderSelect.value;
    const baseSorted = window.PracticeManageCommon.sortCardsForView(filteredCards, sortMode);
    sortedCards = sortMode === 'queue' ? baseSorted : prioritizeMissingAudioFirst(baseSorted);
    cardCount.textContent = `(${sortedCards.length})`;
    updatePracticingSummary(cards);

    if (sortedCards.length === 0) {
        cardsGrid.innerHTML = '<div class="empty-state" style="grid-column: 1 / -1;"><h3>No Chinese writing cards yet</h3><p>Bulk add cards above first.</p></div>';
        return;
    }

    const visibleCards = sortedCards.slice(0, visibleCardCount);
    const isRecording = !!recordingCardId || !!(mediaRecorder && mediaRecorder.state === 'recording');

    cardsGrid.innerHTML = visibleCards.map((card) => {
        const cardId = String(card.id);
        const isCardRecording = String(recordingCardId || '') === cardId;
        const hasPendingForCard = String(recordedForCardId || '') === cardId && !!recordedBlob;
        const previewAudio = hasPendingForCard && recordedPreviewUrl ? recordedPreviewUrl : '';
        const savedAudioUrl = card.audio_url || '';
        const hasSavedAudio = !!savedAudioUrl;
        const selectedClass = (isCardRecording || hasPendingForCard) ? 'selected-audio-target' : '';

        return `
            <div class="card-item ${selectedClass}">
                <button
                    type="button"
                    class="delete-card-btn"
                    data-action="delete-card"
                    data-card-id="${escapeAttr(card.id)}"
                    title="Delete this Chinese writing card"
                    aria-label="Delete this card"
                >×</button>
                <div class="card-front">${card.back || card.front || ''}</div>
                <div class="selected-audio-bar">
                    <div class="selected-audio-title">Audio</div>
                    <div class="card-audio-slot" data-audio-slot data-audio-url="${escapeAttr(savedAudioUrl)}">
                        ${previewAudio ? `
                            <audio
                                class="card-audio-player"
                                controls
                                preload="metadata"
                                src="${escapeAttr(previewAudio)}"
                            ></audio>
                        ` : ''}
                    </div>
                    <div class="selected-audio-actions">
                        ${hasSavedAudio ? `
                            <button
                                type="button"
                                class="selected-audio-btn record"
                                data-action="load-play-audio"
                                data-card-id="${escapeAttr(card.id)}"
                            >Load/Play</button>
                            <button
                                type="button"
                                class="selected-audio-btn clear"
                                data-action="clear-saved-audio"
                                data-card-id="${escapeAttr(card.id)}"
                            >Clear</button>
                        ` : `
                            <button
                                type="button"
                                class="selected-audio-btn ${isCardRecording ? 'stop' : 'record'}"
                                data-action="toggle-recording"
                                data-card-id="${escapeAttr(card.id)}"
                                ${isRecordTransitioning ? 'disabled' : ''}
                            >${isCardRecording ? 'Stop' : 'Record'}</button>
                            <button
                                type="button"
                                class="selected-audio-btn save"
                                data-action="save-recording"
                                data-card-id="${escapeAttr(card.id)}"
                                ${(hasPendingForCard && !isCardRecording && !isRecordTransitioning) ? '' : 'disabled'}
                            >Save</button>
                        `}
                    </div>
                </div>
                ${card.audio_url ? '' : '<div style="margin-top: 4px; color: #9a5a00; font-size: 0.8rem;">No audio yet</div>'}
                <div style="margin-top: 10px; color: #666; font-size: 0.85rem;">Hardness score: ${window.PracticeManageCommon.formatHardnessScore(card.hardness_score)}</div>
                <div style="margin-top: 4px; color: #888; font-size: 0.8rem;">Added: ${window.PracticeManageCommon.formatAddedDate(card.created_at)}</div>
                <div style="margin-top: 4px; color: #666; font-size: 0.82rem;">Lifetime attempts: ${card.lifetime_attempts || 0}</div>
                <div style="margin-top: 4px; color: #666; font-size: 0.82rem;">Last seen: ${window.PracticeManageCommon.formatLastSeenDays(card.last_seen_at)}</div>
                <div class="card-actions">
                    <a
                        class="card-report-link"
                        href="/kid-card-report.html?id=${encodeURIComponent(kidId)}&cardId=${encodeURIComponent(card.id)}&from=writing"
                    >Report</a>
                </div>
            </div>
        `;
    }).join('');

    if (autoPlayRecordedCardId) {
        const targetId = String(autoPlayRecordedCardId);
        autoPlayRecordedCardId = null;
        const cardEl = cardsGrid.querySelector(`.delete-card-btn[data-card-id="${targetId}"]`)?.closest('.card-item');
        let audioEl = cardEl ? cardEl.querySelector('.card-audio-player') : null;
        if (!audioEl && cardEl) {
            const slot = cardEl.querySelector('[data-audio-slot]');
            if (slot && recordedPreviewUrl) {
                slot.innerHTML = `<audio class="card-audio-player" controls preload="metadata" src="${escapeAttr(recordedPreviewUrl)}"></audio>`;
                audioEl = slot.querySelector('.card-audio-player');
            }
        }
        if (audioEl) {
            audioEl.play().catch(() => {});
        }
    }
}

function prioritizeMissingAudioFirst(cards) {
    const missingAudio = [];
    const withAudio = [];
    cards.forEach((card) => {
        const hasAudio = !!(card.audio_url || card.audio_file_name);
        if (hasAudio) {
            withAudio.push(card);
        } else {
            missingAudio.push(card);
        }
    });
    return [...missingAudio, ...withAudio];
}

function filterCardsByQuery(cards, rawQuery) {
    const query = String(rawQuery || '').trim();
    if (!query) {
        return cards;
    }

    return cards.filter((card) => {
        const front = String(card.front || '');
        const back = String(card.back || '');
        return front.includes(query) || back.includes(query);
    });
}

function updatePracticingSummary(cards) {
    if (!practicingSummary) {
        return;
    }
    const practicingCards = cards.filter((card) => !!card.pending_sheet);
    const practicingLabels = practicingCards.map((card) => String(card.back || card.front || '').trim()).filter((v) => v.length > 0);
    practicingSummary.textContent = practicingLabels.length > 0
        ? `Currently practicing (${practicingLabels.length}): ${practicingLabels.join(' · ')}`
        : 'Currently practicing: none';
}

function resetAndDisplayCards(cards) {
    visibleCardCount = CARD_PAGE_SIZE;
    displayCards(cards);
}

function maybeLoadMoreCards() {
    if (sortedCards.length <= visibleCardCount) {
        return;
    }

    const nearBottom = window.innerHeight + window.scrollY >= document.body.offsetHeight - 200;
    if (!nearBottom) {
        return;
    }

    visibleCardCount += CARD_PAGE_SIZE;
    displayCards(currentCards);
}

function showError(message) {
    if (message) {
        errorMessage.textContent = message;
        errorMessage.classList.remove('hidden');
    } else {
        errorMessage.classList.add('hidden');
    }
}

function showSheetError(message) {
    if (!sheetErrorMessage) {
        return;
    }
    if (message) {
        sheetErrorMessage.textContent = message;
        sheetErrorMessage.classList.remove('hidden');
    } else {
        sheetErrorMessage.classList.add('hidden');
    }
}

function showBulkImportError(message, isError = true) {
    if (!bulkImportErrorMessage) {
        return;
    }
    if (message) {
        bulkImportErrorMessage.textContent = message;
        bulkImportErrorMessage.classList.remove('hidden');
        bulkImportErrorMessage.style.background = isError ? '#f8d7da' : '#d4edda';
        bulkImportErrorMessage.style.color = isError ? '#721c24' : '#155724';
        bulkImportErrorMessage.style.border = isError ? '1px solid #f5c6cb' : '1px solid #c3e6cb';
    } else {
        bulkImportErrorMessage.classList.add('hidden');
    }
}

async function handleCardsGridClick(event) {
    const actionEl = event.target.closest('[data-action]');
    if (!actionEl) {
        return;
    }

    const action = actionEl.dataset.action;
    const cardId = actionEl.dataset.cardId || '';

    if (action === 'delete-card') {
        if (cardId) {
            await deleteWritingCard(cardId);
        }
        return;
    }

    if (action === 'toggle-recording') {
        if (mediaRecorder && mediaRecorder.state === 'recording' && String(recordingCardId || '') === String(cardId)) {
            stopRecording();
            return;
        }
        if (mediaRecorder && mediaRecorder.state === 'recording') {
            showError('Please stop current recording first');
            return;
        }
        await startRecordingForCard(cardId);
        return;
    }

    if (action === 'load-play-audio') {
        const barEl = actionEl.closest('.selected-audio-bar');
        if (!barEl) {
            return;
        }
        const slotEl = barEl.querySelector('[data-audio-slot]');
        if (!slotEl) {
            return;
        }
        let audioEl = slotEl.querySelector('.card-audio-player');
        if (!audioEl) {
            const savedUrl = slotEl.dataset.audioUrl || '';
            if (!savedUrl) {
                showError('No audio found for this Chinese writing card.');
                return;
            }
            slotEl.innerHTML = `<audio class="card-audio-player" controls preload="metadata" src="${escapeAttr(savedUrl)}"></audio>`;
            audioEl = slotEl.querySelector('.card-audio-player');
        }
        if (audioEl) {
            audioEl.play().catch(() => {});
        }
        return;
    }

    if (action === 'save-recording') {
        await saveRecordingToCard(cardId);
        return;
    }

    if (action === 'clear-recording') {
        clearRecordedForCard(cardId);
        return;
    }

    if (action === 'clear-saved-audio') {
        await clearSavedAudioForCard(cardId);
    }
}
