const API_BASE = `${window.location.origin}/api`;

const deckMeta = document.getElementById('deckMeta');
const deckIdText = document.getElementById('deckIdText');
const deckNameText = document.getElementById('deckNameText');
const deckTagsText = document.getElementById('deckTagsText');
const deckCreatedAtText = document.getElementById('deckCreatedAtText');
const cardCountText = document.getElementById('cardCountText');
const tableWrap = document.getElementById('tableWrap');
const emptyState = document.getElementById('emptyState');
const cardsTableBody = document.getElementById('cardsTableBody');
const cardsInput = document.getElementById('cardsInput');
const addCardsBtn = document.getElementById('addCardsBtn');
const clearCardsInputBtn = document.getElementById('clearCardsInputBtn');
const successMessage = document.getElementById('successMessage');
const errorMessage = document.getElementById('errorMessage');

let deckId = 0;
let isMutating = false;

document.addEventListener('DOMContentLoaded', async () => {
    const allowed = await ensureSuperFamily();
    if (!allowed) {
        return;
    }
    const params = new URLSearchParams(window.location.search);
    deckId = Number(params.get('deckId') || 0);
    if (!Number.isInteger(deckId) || deckId <= 0) {
        showError('Invalid or missing deckId in URL.');
        return;
    }
    if (addCardsBtn) {
        addCardsBtn.addEventListener('click', async () => {
            await addCardsFromInput();
        });
    }
    if (clearCardsInputBtn) {
        clearCardsInputBtn.addEventListener('click', () => {
            if (cardsInput) {
                cardsInput.value = '';
                cardsInput.focus();
            }
        });
    }
    if (cardsInput) {
        cardsInput.addEventListener('keydown', (event) => {
            if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
                event.preventDefault();
                void addCardsFromInput();
            }
        });
    }
    if (cardsTableBody) {
        cardsTableBody.addEventListener('click', (event) => {
            const target = event.target.closest('button[data-action="delete-card"]');
            if (!target) {
                return;
            }
            const cardId = Number(target.getAttribute('data-card-id') || 0);
            if (!Number.isInteger(cardId) || cardId <= 0) {
                return;
            }
            void deleteCard(cardId);
        });
    }
    await loadDeck();
});

async function ensureSuperFamily() {
    try {
        const response = await fetch(`${API_BASE}/family-auth/status`);
        if (!response.ok) {
            window.location.href = '/family-login.html';
            return false;
        }
        const auth = await response.json().catch(() => ({}));
        if (!auth.authenticated) {
            window.location.href = '/family-login.html';
            return false;
        }
        if (!auth.isSuperFamily) {
            window.location.href = '/admin.html';
            return false;
        }
        return true;
    } catch (error) {
        window.location.href = '/admin.html';
        return false;
    }
}

async function loadDeck() {
    showError('');
    try {
        const response = await fetch(`${API_BASE}/shared-decks/${deckId}`);
        const result = await response.json().catch(() => ({}));
        if (!response.ok) {
            throw new Error(result.error || `Failed to load deck (HTTP ${response.status})`);
        }
        renderDeck(result);
    } catch (error) {
        console.error('Error loading deck details:', error);
        showError(error.message || 'Failed to load deck details.');
    }
}

function renderDeck(payload) {
    const deck = payload && typeof payload === 'object' ? payload.deck : null;
    const cards = Array.isArray(payload && payload.cards) ? payload.cards : [];
    const cardCount = Number(payload && payload.card_count ? payload.card_count : 0);

    if (!deck) {
        showError('Deck details are unavailable.');
        return;
    }

    deckMeta.classList.remove('hidden');
    deckIdText.textContent = String(deck.deck_id || deckId);
    deckNameText.textContent = String(deck.name || '');
    deckTagsText.innerHTML = renderTags(Array.isArray(deck.tags) ? deck.tags : []);
    deckCreatedAtText.textContent = formatIsoTimestamp(deck.created_at);
    cardCountText.textContent = String(cardCount);

    if (cards.length === 0) {
        cardsTableBody.innerHTML = '';
        tableWrap.classList.add('hidden');
        emptyState.classList.remove('hidden');
        return;
    }

    emptyState.classList.add('hidden');
    tableWrap.classList.remove('hidden');
    cardsTableBody.innerHTML = cards.map((card, index) => {
        return `
            <tr>
                <td>${index + 1}</td>
                <td>${escapeHtml(card.front || '')}</td>
                <td>${escapeHtml(card.back || '')}</td>
                <td>
                    <button
                        type="button"
                        class="btn-secondary"
                        data-action="delete-card"
                        data-card-id="${Number(card.id || 0)}"
                    >Delete</button>
                </td>
            </tr>
        `;
    }).join('');
    setMutating(isMutating);
}

function parseCardsCsvInput(rawText) {
    const lines = String(rawText || '').split(/\r\n|\r|\n/);
    const cards = [];
    lines.forEach((line, index) => {
        const text = String(line || '').trim();
        if (!text) {
            return;
        }
        const commaIndex = text.indexOf(',');
        if (commaIndex <= 0 || commaIndex >= text.length - 1) {
            throw new Error(`Line ${index + 1}: expected "front,back".`);
        }
        const front = text.slice(0, commaIndex).trim();
        const back = text.slice(commaIndex + 1).trim();
        if (!front || !back) {
            throw new Error(`Line ${index + 1}: front and back must both be non-empty.`);
        }
        cards.push({ front, back });
    });
    if (cards.length === 0) {
        throw new Error('No cards parsed. Paste at least one "front,back" line.');
    }
    return cards;
}

function setMutating(isBusy) {
    isMutating = Boolean(isBusy);
    if (addCardsBtn) {
        addCardsBtn.disabled = isMutating;
        addCardsBtn.textContent = isMutating ? 'Saving...' : 'Add Cards';
    }
    if (clearCardsInputBtn) {
        clearCardsInputBtn.disabled = isMutating;
    }
    if (cardsInput) {
        cardsInput.disabled = isMutating;
    }
    if (cardsTableBody) {
        cardsTableBody.querySelectorAll('button[data-action="delete-card"]').forEach((btn) => {
            btn.disabled = isMutating;
        });
    }
}

async function addCardsFromInput() {
    if (isMutating) {
        return;
    }
    showError('');
    showSuccess('');

    let cards;
    try {
        cards = parseCardsCsvInput(cardsInput ? cardsInput.value : '');
    } catch (error) {
        showError(error.message || 'Failed to parse cards input.');
        return;
    }

    setMutating(true);
    try {
        const response = await fetch(`${API_BASE}/shared-decks/${deckId}/cards`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ cards }),
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok) {
            throw new Error(result.error || `Failed to add cards (HTTP ${response.status})`);
        }

        const inserted = Number.parseInt(result.inserted_count, 10) || 0;
        const skipped = Number.parseInt(result.skipped_existing_count, 10) || 0;
        showSuccess(`Added ${inserted} card(s). Skipped ${skipped} existing card(s).`);
        if (cardsInput) {
            cardsInput.value = '';
        }
        await loadDeck();
    } catch (error) {
        console.error('Error adding deck cards:', error);
        showError(error.message || 'Failed to add cards.');
    } finally {
        setMutating(false);
    }
}

async function deleteCard(cardId) {
    if (isMutating) {
        return;
    }
    const confirmed = window.confirm('Delete this card from the deck?');
    if (!confirmed) {
        return;
    }
    showError('');
    showSuccess('');
    setMutating(true);
    try {
        const response = await fetch(`${API_BASE}/shared-decks/${deckId}/cards/${cardId}`, {
            method: 'DELETE',
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok) {
            throw new Error(result.error || `Failed to delete card (HTTP ${response.status})`);
        }
        showSuccess('Card deleted.');
        await loadDeck();
    } catch (error) {
        console.error('Error deleting deck card:', error);
        showError(error.message || 'Failed to delete card.');
    } finally {
        setMutating(false);
    }
}

function renderTags(tags) {
    if (!Array.isArray(tags) || tags.length === 0) {
        return '-';
    }
    return `<span class="deck-tags">${tags.map((tag) => `<span class="deck-tag">${escapeHtml(tag)}</span>`).join('')}</span>`;
}

function formatIsoTimestamp(value) {
    const text = String(value || '').trim();
    if (!text) {
        return '-';
    }
    const date = new Date(text);
    if (Number.isNaN(date.getTime())) {
        return text;
    }
    return date.toLocaleString();
}

function showError(message) {
    const text = String(message || '').trim();
    if (!text) {
        errorMessage.textContent = '';
        errorMessage.classList.add('hidden');
        return;
    }
    errorMessage.textContent = text;
    errorMessage.classList.remove('hidden');
}

function showSuccess(message) {
    const text = String(message || '').trim();
    if (!text) {
        successMessage.textContent = '';
        successMessage.classList.add('hidden');
        return;
    }
    successMessage.textContent = text;
    successMessage.classList.remove('hidden');
}
