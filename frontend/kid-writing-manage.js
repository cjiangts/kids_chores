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
let isWritingBulkAdding = false;
const previewPlayer = window.WritingAudioSequence.createPlayer({
    preload: 'auto',
    onError: (error) => {
        console.error('Error playing writing preview audio:', error);
        const detail = String(error?.message || '').trim();
        showError(detail ? `Failed to play voice prompt: ${detail}` : 'Failed to play voice prompt');
    }
});

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

    if (bulkWritingText) {
        bulkWritingText.addEventListener('input', () => {
            updateBulkAddButtonCount();
        });
    }

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
    if (isWritingBulkAdding) {
        return;
    }
    try {
        setWritingBulkAddBusy(true);
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
    } finally {
        setWritingBulkAddBusy(false);
    }
}

function updateBulkAddButtonCount() {
    if (isWritingBulkAdding) {
        bulkAddBtn.textContent = 'Adding...';
        return;
    }
    const totalTokens = countWritingTokensBeforeDbDedup(bulkWritingText.value);
    if (totalTokens > 0) {
        bulkAddBtn.textContent = `Bulk Add Chinese Writing Prompt (${totalTokens})`;
        return;
    }
    bulkAddBtn.textContent = 'Bulk Add Chinese Writing Prompt';
}

function setWritingBulkAddBusy(isBusy) {
    isWritingBulkAdding = !!isBusy;
    if (bulkAddBtn) {
        bulkAddBtn.disabled = isWritingBulkAdding;
    }
    if (bulkWritingText) {
        bulkWritingText.disabled = isWritingBulkAdding;
    }
    updateBulkAddButtonCount();
}

function countWritingTokensBeforeDbDedup(text) {
    const matches = String(text || '').match(/[\u3400-\u9FFF\uF900-\uFAFF]+/g);
    return matches ? matches.length : 0;
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
            previewWindow.document.write('<!doctype html><title>Loading...</title><p style="font-family: sans-serif; padding: 1rem;">Preparing sheet preview...</p>');
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
    try {
        const result = await window.PracticeManageCommon.requestWithPasswordDialog(
            'deleting this Chinese writing card',
            (password) => fetch(`${API_BASE}/kids/${kidId}/writing/cards/${cardId}`, {
                method: 'DELETE',
                headers: window.PracticeManageCommon.buildPasswordHeaders(password, false),
            })
        );
        if (result.cancelled) {
            return;
        }
        if (!result.ok) {
            throw new Error(result.error || 'Failed to delete Chinese writing card.');
        }

        await loadWritingCards();
    } catch (error) {
        console.error('Error deleting writing card:', error);
        showError(error.message || 'Failed to delete Chinese writing card');
    }
}

async function editWritingCardPrompt(cardId) {
    try {
        const targetCard = currentCards.find((card) => String(card.id) === String(cardId));
        if (!targetCard) {
            showError('Writing card not found.');
            return;
        }

        const currentFront = String(targetCard.front || '').trim();
        const nextFrontRaw = window.prompt('Edit voice prompt (front):', currentFront);
        if (nextFrontRaw === null) {
            return;
        }
        const nextFront = String(nextFrontRaw || '').trim();
        if (!nextFront) {
            showError('Prompt text cannot be empty.');
            return;
        }
        if (nextFront === currentFront) {
            return;
        }

        const response = await fetch(`${API_BASE}/kids/${kidId}/writing/cards/${encodeURIComponent(cardId)}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ front: nextFront })
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
            throw new Error(payload.error || `HTTP ${response.status}`);
        }

        await loadWritingCards();
    } catch (error) {
        console.error('Error updating writing card front:', error);
        showError(error.message || 'Failed to update voice prompt');
    }
}

function displayCards(cards) {
    const filteredCards = filterCardsByQuery(cards, cardSearchInput.value);
    const sortMode = viewOrderSelect.value;
    sortedCards = window.PracticeManageCommon.sortCardsForView(filteredCards, sortMode);
    cardCount.textContent = `(${sortedCards.length})`;
    updatePracticingSummary(cards);

    if (sortedCards.length === 0) {
        cardsGrid.innerHTML = '<div class="empty-state" style="grid-column: 1 / -1;"><h3>No Chinese writing cards yet</h3><p>Bulk add cards above first.</p></div>';
        return;
    }

    const visibleCards = sortedCards.slice(0, visibleCardCount);

    cardsGrid.innerHTML = visibleCards.map((card) => {
        const hasSavedAudio = !!card.audio_url;

        return `
            <div class="card-item">
                <button
                    type="button"
                    class="delete-card-btn"
                    data-action="delete-card"
                    data-card-id="${escapeAttr(card.id)}"
                    title="Delete this Chinese writing card"
                    aria-label="Delete this card"
                >x</button>
                <div class="card-front">${card.back || card.front || ''}</div>
                <div style="margin-top: 6px; color: #555; font-size: 0.84rem;">
                    Prompt: ${card.front || ''}
                </div>
                <div class="selected-audio-bar">
                    <div class="selected-audio-title">Audio</div>
                    <div class="selected-audio-actions">
                        <button
                            type="button"
                            class="selected-audio-btn edit"
                            data-action="edit-front"
                            data-card-id="${escapeAttr(card.id)}"
                        >Edit Prompt</button>
                        <button
                            type="button"
                            class="selected-audio-btn save"
                            data-action="load-play-audio"
                            data-card-id="${escapeAttr(card.id)}"
                        >Load/Play</button>
                    </div>
                </div>
                ${hasSavedAudio ? '' : '<div style="margin-top: 4px; color: #9a5a00; font-size: 0.8rem;">Will auto-generate on first play</div>'}
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

function showSheetError(message) {
    if (!sheetErrorMessage) {
        return;
    }
    if (message) {
        const text = String(message);
        sheetErrorMessage.textContent = '';
        sheetErrorMessage.classList.add('hidden');
        if (showSheetError._lastMessage !== text) {
            window.alert(text);
            showSheetError._lastMessage = text;
        }
    } else {
        showSheetError._lastMessage = '';
        sheetErrorMessage.classList.add('hidden');
    }
}

function showBulkImportError(message, isError = true) {
    if (!bulkImportErrorMessage) {
        return;
    }
    if (message) {
        const text = String(message);
        if (isError) {
            bulkImportErrorMessage.textContent = '';
            bulkImportErrorMessage.classList.add('hidden');
            if (showBulkImportError._lastMessage !== text) {
                window.alert(text);
                showBulkImportError._lastMessage = text;
            }
        } else {
            bulkImportErrorMessage.textContent = text;
            bulkImportErrorMessage.classList.remove('hidden');
            bulkImportErrorMessage.style.background = '#d4edda';
            bulkImportErrorMessage.style.color = '#155724';
            bulkImportErrorMessage.style.border = '1px solid #c3e6cb';
        }
    } else {
        showBulkImportError._lastMessage = '';
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

    if (action === 'edit-front') {
        if (cardId) {
            await editWritingCardPrompt(cardId);
        }
        return;
    }

    if (action === 'load-play-audio') {
        const targetCard = currentCards.find((card) => String(card.id) === String(cardId));
        if (!targetCard) {
            showError('Writing card not found.');
            return;
        }
        const promptUrls = previewPlayer.buildPromptUrls(targetCard);
        if (promptUrls.length === 0) {
            showError('No audio found for this Chinese writing card.');
            return;
        }
        showError('');
        previewPlayer.playUrls(promptUrls);
    }
}
