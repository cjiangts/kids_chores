const API_BASE = `${window.location.origin}/api`;

const tableWrap = document.getElementById('tableWrap');
const emptyState = document.getElementById('emptyState');
const deckTableBody = document.getElementById('deckTableBody');
const createDeckNavBtn = document.getElementById('createDeckNavBtn');
const errorMessage = document.getElementById('errorMessage');

document.addEventListener('DOMContentLoaded', async () => {
    const allowed = await ensureSuperFamily();
    if (!allowed) {
        return;
    }
    createDeckNavBtn.addEventListener('click', () => {
        window.location.href = '/deck-create.html';
    });
    deckTableBody.addEventListener('click', async (event) => {
        const btn = event.target.closest('button[data-action][data-deck-id]');
        if (!btn) {
            return;
        }
        const deckId = Number(btn.getAttribute('data-deck-id') || 0);
        if (!(deckId > 0)) {
            return;
        }
        const action = String(btn.getAttribute('data-action') || '');
        if (action === 'view') {
            window.location.href = `/deck-view.html?deckId=${encodeURIComponent(String(deckId))}`;
            return;
        }
        if (action === 'delete') {
            await deleteDeck(deckId);
        }
    });
    await loadMyDecks();
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

async function loadMyDecks() {
    showError('');
    try {
        const response = await fetch(`${API_BASE}/shared-decks/mine`);
        const result = await response.json().catch(() => ({}));
        if (!response.ok) {
            throw new Error(result.error || `Failed to load decks (HTTP ${response.status})`);
        }
        const decks = Array.isArray(result.decks) ? result.decks : [];
        renderDecks(decks);
    } catch (error) {
        console.error('Error loading shared decks:', error);
        renderDecks([]);
        showError(error.message || 'Failed to load decks.');
    }
}

function renderDecks(decks) {
    if (!Array.isArray(decks) || decks.length === 0) {
        deckTableBody.innerHTML = '';
        tableWrap.classList.add('hidden');
        emptyState.classList.remove('hidden');
        return;
    }

    emptyState.classList.add('hidden');
    tableWrap.classList.remove('hidden');

    deckTableBody.innerHTML = decks.map((deck) => {
        const tags = Array.isArray(deck.tags) ? deck.tags : [];
        const tagHtml = tags.length > 0
            ? `<div class="deck-tags">${tags.map((tag) => `<span class="deck-tag">${escapeHtml(tag)}</span>`).join('')}</div>`
            : '-';
        return `
            <tr>
                <td>${Number(deck.deck_id || 0)}</td>
                <td><code>${escapeHtml(deck.name || '')}</code></td>
                <td>${tagHtml}</td>
                <td>${Number(deck.card_count || 0)}</td>
                <td>${formatIsoTimestamp(deck.created_at)}</td>
                <td>
                    <button type="button" class="btn-secondary" data-action="view" data-deck-id="${Number(deck.deck_id || 0)}">View</button>
                    <button type="button" class="btn-secondary" data-action="delete" data-deck-id="${Number(deck.deck_id || 0)}">Delete</button>
                </td>
            </tr>
        `;
    }).join('');
}

async function deleteDeck(deckId) {
    const confirmed = window.confirm(`Delete deck #${deckId}? This cannot be undone.`);
    if (!confirmed) {
        return;
    }
    showError('');
    try {
        const response = await fetch(`${API_BASE}/shared-decks/${deckId}`, {
            method: 'DELETE',
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok) {
            throw new Error(result.error || `Failed to delete deck (HTTP ${response.status})`);
        }
        await loadMyDecks();
    } catch (error) {
        console.error('Error deleting shared deck:', error);
        showError(error.message || 'Failed to delete deck.');
    }
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
