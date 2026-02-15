const API_BASE = `${window.location.origin}/api`;

const params = new URLSearchParams(window.location.search);
const kidId = params.get('id');

const kidNameEl = document.getElementById('kidName');
const errorMessage = document.getElementById('errorMessage');
const addCardForm = document.getElementById('addCardForm');
const chineseCharsInput = document.getElementById('chineseChars');
const recordBtn = document.getElementById('recordBtn');
const replayRecordBtn = document.getElementById('replayRecordBtn');
const recordStatus = document.getElementById('recordStatus');
const audioPlayer = document.getElementById('audioPlayer');
const sessionSettingsForm = document.getElementById('sessionSettingsForm');
const sessionCardCountInput = document.getElementById('sessionCardCount');
const hardCardPercentageInput = document.getElementById('hardCardPercentage');
const sheetCardCountInput = document.getElementById('sheetCardCount');
const createSheetBtn = document.getElementById('createSheetBtn');
const viewSheetsBtn = document.getElementById('viewSheetsBtn');
const viewOrderSelect = document.getElementById('viewOrderSelect');
const cardCount = document.getElementById('cardCount');
const cardsGrid = document.getElementById('cardsGrid');
const charactersTab = document.getElementById('charactersTab');
const writingTab = document.getElementById('writingTab');
const mathTab = document.getElementById('mathTab');

let currentCards = [];
let sortedCards = [];
let visibleCardCount = 10;
const CARD_PAGE_SIZE = 10;
let mediaRecorder = null;
let mediaStream = null;
let recordChunks = [];
let recordedBlob = null;
let recordedAudioUrl = null;

document.addEventListener('DOMContentLoaded', async () => {
    if (!kidId) {
        window.location.href = '/admin.html';
        return;
    }

    charactersTab.href = `/kid-manage.html?id=${kidId}`;
    writingTab.href = `/kid-writing-manage.html?id=${kidId}`;
    mathTab.href = `/kid-math-manage.html?id=${kidId}`;

    sessionSettingsForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        await saveSessionSettings();
    });

    addCardForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        await addWritingCards();
    });

    viewOrderSelect.addEventListener('change', () => resetAndDisplayCards(currentCards));
    window.addEventListener('scroll', () => maybeLoadMoreCards());

    recordBtn.addEventListener('click', async () => toggleRecording());
    replayRecordBtn.addEventListener('click', () => replayRecordedAudio());
    createSheetBtn.addEventListener('click', async () => createAndPrintSheet());
    viewSheetsBtn.addEventListener('click', () => viewSheetsReadonly());

    await loadKidInfo();
    await loadWritingCards();
});

async function loadKidInfo() {
    try {
        const response = await fetch(`${API_BASE}/kids/${kidId}`);
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }

        const kid = await response.json();
        kidNameEl.textContent = `${kid.name}'s Chinese Character Writing`;
        sessionCardCountInput.value = kid.sessionCardCount || 10;
        const initialHardPct = Number.parseInt(kid.hardCardPercentage, 10);
        hardCardPercentageInput.value = Number.isInteger(initialHardPct) ? initialHardPct : 20;
        sheetCardCountInput.value = kid.sessionCardCount || 10;
    } catch (error) {
        console.error('Error loading kid:', error);
        showError('Failed to load kid information');
    }
}

async function saveSessionSettings() {
    try {
        const value = Number.parseInt(sessionCardCountInput.value, 10);
        const hardPct = Number.parseInt(hardCardPercentageInput.value, 10);
        if (!Number.isInteger(value) || value < 1 || value > 200) {
            showError('Session size must be between 1 and 200');
            return;
        }
        if (!Number.isInteger(hardPct) || hardPct < 0 || hardPct > 100) {
            showError('Hard cards % must be between 0 and 100');
            return;
        }

        const response = await fetch(`${API_BASE}/kids/${kidId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                sessionCardCount: value,
                hardCardPercentage: hardPct
            })
        });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }

        const updatedKid = await response.json();
        sessionCardCountInput.value = updatedKid.sessionCardCount || value;
        const savedHardPct = Number.parseInt(updatedKid.hardCardPercentage, 10);
        hardCardPercentageInput.value = Number.isInteger(savedHardPct) ? savedHardPct : hardPct;
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
        showError('Failed to load writing cards');
    }
}

async function toggleRecording() {
    if (mediaRecorder && mediaRecorder.state === 'recording') {
        stopRecording();
        return;
    }
    await startRecording();
}

async function startRecording() {
    try {
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
            showError('Recording is not supported in this browser');
            return;
        }

        showError('');
        mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        mediaRecorder = new MediaRecorder(mediaStream);
        recordChunks = [];
        recordedBlob = null;
        audioPlayer.pause();
        audioPlayer.removeAttribute('src');
        audioPlayer.load();
        if (recordedAudioUrl) {
            URL.revokeObjectURL(recordedAudioUrl);
            recordedAudioUrl = null;
        }

        mediaRecorder.ondataavailable = (event) => {
            if (event.data && event.data.size > 0) {
                recordChunks.push(event.data);
            }
        };

        mediaRecorder.onstop = () => {
            recordedBlob = new Blob(recordChunks, { type: mediaRecorder.mimeType || 'audio/webm' });
            recordedAudioUrl = URL.createObjectURL(recordedBlob);
            replayRecordBtn.disabled = !recordedBlob || recordedBlob.size === 0;
            setRecordStatus(
                replayRecordBtn.disabled ? 'Recording failed, please try again' : 'Recording ready',
                replayRecordBtn.disabled
            );
            if (!replayRecordBtn.disabled) {
                playAudio(recordedAudioUrl);
            }
            setRecordingUI(false);

            if (mediaStream) {
                mediaStream.getTracks().forEach((track) => track.stop());
                mediaStream = null;
            }
        };

        mediaRecorder.start();
        setRecordingUI(true);
        replayRecordBtn.disabled = true;
        setRecordStatus('Recording...');
    } catch (error) {
        console.error('Error starting recording:', error);
        setRecordingUI(false);
        showError('Failed to start recording. Please allow microphone access.');
    }
}

function stopRecording() {
    if (!mediaRecorder || mediaRecorder.state !== 'recording') {
        return;
    }

    mediaRecorder.stop();
    setRecordingUI(false);
}

function setRecordingUI(isRecording) {
    if (isRecording) {
        recordBtn.textContent = 'Stop Recording';
        recordBtn.classList.remove('record-btn');
        recordBtn.classList.add('stop-btn');
        replayRecordBtn.disabled = true;
        return;
    }

    recordBtn.textContent = 'Start Recording';
    recordBtn.classList.remove('stop-btn');
    recordBtn.classList.add('record-btn');
}

function setRecordStatus(message, isError = false) {
    recordStatus.textContent = message;
    recordStatus.style.color = isError ? '#dc3545' : '#666';
}

function replayRecordedAudio() {
    if (!recordedAudioUrl) {
        return;
    }
    playAudio(recordedAudioUrl);
}

async function addWritingCards() {
    try {
        const rawText = chineseCharsInput.value.trim();
        if (rawText.length === 0) {
            showError('Please enter answer text');
            return;
        }

        if (!recordedBlob || recordedBlob.size === 0) {
            showError('Please record a voice prompt first');
            setRecordStatus('Please record a voice prompt first', true);
            return;
        }

        const formData = new FormData();
        formData.append('characters', rawText);
        formData.append('audio', recordedBlob, 'prompt.webm');

        const response = await fetch(`${API_BASE}/kids/${kidId}/writing/cards`, {
            method: 'POST',
            body: formData
        });
        if (!response.ok) {
            const errorPayload = await response.json().catch(() => ({}));
            throw new Error(errorPayload.error || `HTTP ${response.status}`);
        }

        addCardForm.reset();
        recordedBlob = null;
        if (recordedAudioUrl) {
            URL.revokeObjectURL(recordedAudioUrl);
            recordedAudioUrl = null;
        }
        audioPlayer.pause();
        audioPlayer.removeAttribute('src');
        audioPlayer.load();
        replayRecordBtn.disabled = true;
        setRecordStatus('No recording yet');

        await loadWritingCards();
        showError('');
    } catch (error) {
        console.error('Error adding writing cards:', error);
        showError(error.message || 'Failed to add writing cards');
    }
}

async function createAndPrintSheet() {
    try {
        const count = Number.parseInt(sheetCardCountInput.value, 10);
        if (!Number.isInteger(count) || count < 1 || count > 200) {
            showError('Cards per sheet must be between 1 and 200');
            return;
        }

        showError('');
        const response = await fetch(`${API_BASE}/kids/${kidId}/writing/sheets`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ count })
        });
        if (!response.ok) {
            const payload = await response.json().catch(() => ({}));
            throw new Error(payload.error || `HTTP ${response.status}`);
        }

        const result = await response.json();
        if (!result.created || !result.sheet_id) {
            const msg = result.message || 'No eligible cards to print right now';
            showError(msg);
            alert(msg);
            return;
        }

        await loadWritingCards();
        const printUrl = `/writing-sheet-print.html?id=${kidId}&sheet=${result.sheet_id}`;
        window.open(printUrl, '_blank');
    } catch (error) {
        console.error('Error creating writing sheet:', error);
        showError(error.message || 'Failed to create practice sheet');
    }
}

function viewSheetsReadonly() {
    window.location.href = `/kid-writing-sheets.html?id=${kidId}&readonly=1`;
}

async function deleteWritingCard(cardId) {
    if (!confirm('Are you sure you want to delete this writing card?')) {
        return;
    }

    try {
        const response = await fetch(`${API_BASE}/kids/${kidId}/writing/cards/${cardId}`, {
            method: 'DELETE'
        });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }

        await loadWritingCards();
    } catch (error) {
        console.error('Error deleting writing card:', error);
        showError('Failed to delete writing card');
    }
}

function playPrompt(url) {
    if (!url) {
        return;
    }
    playAudio(url);
}

function playAudio(url) {
    audioPlayer.src = url;
    audioPlayer.currentTime = 0;
    audioPlayer.play().catch((err) => {
        console.error('Error playing audio:', err);
    });
}

function displayCards(cards) {
    sortedCards = window.PracticeManageCommon.sortCardsForView(cards, viewOrderSelect.value);
    cardCount.textContent = `(${sortedCards.length})`;

    if (sortedCards.length === 0) {
        cardsGrid.innerHTML = `<div class="empty-state" style="grid-column: 1 / -1;"><h3>No writing cards yet</h3><p>Record your first writing prompt above.</p></div>`;
        return;
    }

    const visibleCards = sortedCards.slice(0, visibleCardCount);
    const totalPracticing = sortedCards.filter((card) => !!card.pending_sheet).length;
    const totalNotPracticing = sortedCards.length - totalPracticing;
    const practicingCards = visibleCards.filter((card) => !!card.pending_sheet);
    const notPracticingCards = visibleCards.filter((card) => !card.pending_sheet);

    cardsGrid.innerHTML = `
        ${renderCardSection('Not Practicing', notPracticingCards, totalNotPracticing)}
        ${renderCardSection('Practicing', practicingCards, totalPracticing)}
    `;
}

function renderCardSection(title, cards, total) {
    const listHtml = cards.length === 0
        ? `<p class="empty-line">No cards in this section.</p>`
        : `<div class="cards-grid">${cards.map((card) => `
            <div class="card-item">
                <div class="card-front">${card.back || card.front || ''}</div>
                <div class="card-actions">
                    <button class="card-action-btn play-btn" onclick="playPrompt('${card.audio_url || ''}')">Replay</button>
                    <button class="card-action-btn delete-btn" onclick="deleteWritingCard('${card.id}')">Delete</button>
                </div>
                <div style="margin-top: 10px; color: #666; font-size: 0.85rem;">Hardness score: ${window.PracticeManageCommon.formatHardnessScore(card.hardness_score)}</div>
                <div style="margin-top: 4px; color: #888; font-size: 0.8rem;">Added: ${window.PracticeManageCommon.formatAddedDate(card.parent_added_at || card.created_at)}</div>
                <div style="margin-top: 4px; color: #666; font-size: 0.82rem;">Lifetime attempts: ${card.lifetime_attempts || 0}</div>
                <div style="margin-top: 4px; color: #666; font-size: 0.82rem;">Last seen: ${window.PracticeManageCommon.formatLastSeenDays(card.last_seen_at)}</div>
            </div>
        `).join('')}</div>`;

    return `
        <section class="cards-subsection">
            <h3>${title} (${total})</h3>
            ${listHtml}
        </section>
    `;
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

window.deleteWritingCard = deleteWritingCard;
window.playPrompt = playPrompt;
