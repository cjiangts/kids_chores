const API_BASE = `${window.location.origin}/api`;

const params = new URLSearchParams(window.location.search);
const kidId = params.get('id');

const kidNameEl = document.getElementById('kidName');
const errorMessage = document.getElementById('errorMessage');
const seedBtn = document.getElementById('seedBtn');
const seedStatus = document.getElementById('seedStatus');
const sessionSettingsForm = document.getElementById('sessionSettingsForm');
const sessionCardCountInput = document.getElementById('sessionCardCount');
const viewOrderSelect = document.getElementById('viewOrderSelect');
const cardCount = document.getElementById('cardCount');
const cardsGrid = document.getElementById('cardsGrid');
const charactersTab = document.getElementById('charactersTab');
const mathTab = document.getElementById('mathTab');

let currentKid = null;
let currentCards = [];


document.addEventListener('DOMContentLoaded', async () => {
    if (!kidId) {
        window.location.href = '/admin.html';
        return;
    }

    charactersTab.href = `/kid-manage.html?id=${kidId}`;
    mathTab.href = `/kid-math-manage.html?id=${kidId}`;

    sessionSettingsForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        await saveSessionSettings();
    });

    viewOrderSelect.addEventListener('change', () => displayCards(currentCards));
    seedBtn.addEventListener('click', async () => seedStarterSet());

    await loadKidInfo();
    await loadMathCards();
});


async function loadKidInfo() {
    try {
        const response = await fetch(`${API_BASE}/kids/${kidId}`);
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }

        currentKid = await response.json();
        kidNameEl.textContent = `${currentKid.name}'s Math`;
        sessionCardCountInput.value = currentKid.sessionCardCount || 10;
    } catch (error) {
        console.error('Error loading kid:', error);
        showError('Failed to load kid information');
    }
}


async function saveSessionSettings() {
    try {
        const value = Number.parseInt(sessionCardCountInput.value, 10);
        if (!Number.isInteger(value) || value < 1 || value > 200) {
            showError('Session size must be between 1 and 200');
            return;
        }

        const response = await fetch(`${API_BASE}/kids/${kidId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sessionCardCount: value })
        });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }

        currentKid = await response.json();
        sessionCardCountInput.value = currentKid.sessionCardCount || value;
        showError('');
    } catch (error) {
        console.error('Error saving session settings:', error);
        showError('Failed to save practice settings');
    }
}


async function loadMathCards() {
    try {
        showError('');
        const response = await fetch(`${API_BASE}/kids/${kidId}/math/cards`);
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }

        const data = await response.json();
        currentCards = data.cards || [];
        displayCards(currentCards);
    } catch (error) {
        console.error('Error loading math cards:', error);
        showError('Failed to load math cards');
    }
}


async function seedStarterSet() {
    try {
        showError('');
        seedStatus.textContent = 'Inserting starter set...';

        const response = await fetch(`${API_BASE}/kids/${kidId}/math/seed`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({})
        });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }

        const result = await response.json();
        seedStatus.textContent = `Inserted ${result.inserted} new items. Total: ${result.total}.`;
        await loadMathCards();
    } catch (error) {
        console.error('Error seeding starter math set:', error);
        showError('Failed to insert starter set');
        seedStatus.textContent = '';
    }
}


async function deleteMathCard(cardId) {
    if (!confirm('Are you sure you want to delete this math card?')) {
        return;
    }

    try {
        const response = await fetch(`${API_BASE}/kids/${kidId}/math/cards/${cardId}`, {
            method: 'DELETE'
        });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }

        await loadMathCards();
    } catch (error) {
        console.error('Error deleting math card:', error);
        showError('Failed to delete math card');
    }
}


function displayCards(cards) {
    const sortedCards = window.PracticeManageCommon.sortCardsForView(cards, viewOrderSelect.value);
    cardCount.textContent = `(${sortedCards.length})`;

    if (sortedCards.length === 0) {
        cardsGrid.innerHTML = `<div class="empty-state" style="grid-column: 1 / -1;"><h3>No math questions yet</h3><p>Click \"Insert Starter 20\" above.</p></div>`;
        return;
    }

    cardsGrid.innerHTML = sortedCards.map((card) => `
        <div class="card-item">
            <button class="delete-card-btn" onclick="deleteMathCard('${card.id}')">×</button>
            <div class="card-front">${card.front}</div>
            <div class="card-back">= ${card.back}</div>
            <div style="margin-top: 10px; color: #666; font-size: 0.85rem;">Avg green: ${window.PracticeManageCommon.formatAvgGreen(card.avg_green_ms)}</div>
            <div style="margin-top: 4px; color: #888; font-size: 0.8rem;">Added: ${window.PracticeManageCommon.formatAddedDate(card.parent_added_at || card.created_at)}</div>
            <div style="margin-top: 4px; color: #666; font-size: 0.82rem;">Lifetime attempts: ${card.lifetime_attempts || 0}</div>
            <div style="margin-top: 4px; color: #666; font-size: 0.82rem;">Last seen: ${window.PracticeManageCommon.formatLastSeenDays(card.last_seen_at)}</div>
        </div>
    `).join('');
}


function showError(message) {
    if (message) {
        errorMessage.textContent = message;
        errorMessage.classList.remove('hidden');
    } else {
        errorMessage.classList.add('hidden');
    }
}
