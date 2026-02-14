// API Configuration
const API_BASE = `${window.location.origin}/api`;

// Get kid ID from URL
const urlParams = new URLSearchParams(window.location.search);
const kidId = urlParams.get('id');

// DOM Elements
const kidNameEl = document.getElementById('kidName');
const addCardForm = document.getElementById('addCardForm');
const sessionSettingsForm = document.getElementById('sessionSettingsForm');
const sessionCardCountInput = document.getElementById('sessionCardCount');
const dailyPracticeChineseEnabledInput = document.getElementById('dailyPracticeChineseEnabled');
const cardsGrid = document.getElementById('cardsGrid');
const cardCount = document.getElementById('cardCount');
const errorMessage = document.getElementById('errorMessage');
const viewOrderSelect = document.getElementById('viewOrderSelect');
const charactersTab = document.getElementById('charactersTab');
const mathTab = document.getElementById('mathTab');

let currentKid = null;
let defaultDeckId = null;
let existingCardFronts = new Set();
let currentCards = [];

// Initialize
document.addEventListener('DOMContentLoaded', async () => {
    if (!kidId) {
        window.location.href = '/';
        return;
    }

    charactersTab.href = `/kid-manage.html?id=${kidId}`;
    mathTab.href = `/kid-math-manage.html?id=${kidId}`;

    await loadKidInfo();
    await loadCards();
});

// Form submission
addCardForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    await addCard();
});

sessionSettingsForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    await saveSessionSettings();
});

viewOrderSelect.addEventListener('change', () => {
    displayCards(currentCards);
});

// API Functions
async function loadKidInfo() {
    try {
        const response = await fetch(`${API_BASE}/kids/${kidId}`);
        if (!response.ok) {
            throw new Error('Kid not found');
        }
        currentKid = await response.json();
        kidNameEl.textContent = `${currentKid.name}'s Characters`;
        sessionCardCountInput.value = currentKid.sessionCardCount || 10;
        dailyPracticeChineseEnabledInput.checked = !!currentKid.dailyPracticeChineseEnabled;
    } catch (error) {
        console.error('Error loading kid:', error);
        showError('Failed to load kid information');
        setTimeout(() => window.location.href = '/', 2000);
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
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                sessionCardCount: value,
                dailyPracticeChineseEnabled: dailyPracticeChineseEnabledInput.checked
            }),
        });

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const updatedKid = await response.json();
        currentKid = updatedKid;
        sessionCardCountInput.value = updatedKid.sessionCardCount || value;
        dailyPracticeChineseEnabledInput.checked = !!updatedKid.dailyPracticeChineseEnabled;
        showError('');
    } catch (error) {
        console.error('Error saving session settings:', error);
        showError('Failed to save practice settings');
    }
}

async function loadCards() {
    try {
        showError('');
        const response = await fetch(`${API_BASE}/kids/${kidId}/cards`);

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const data = await response.json();
        const cards = data.cards || [];
        currentCards = cards;
        existingCardFronts = new Set(cards.map(card => card.front));
        displayCards(cards);

        // Store default deck ID if exists
        if (data.deck_id) {
            defaultDeckId = data.deck_id;
        }
    } catch (error) {
        console.error('Error loading cards:', error);
        showError('Failed to load cards');
    }
}

async function addCard() {
    try {
        const input = document.getElementById('chineseChar').value.trim();
        const chineseChars = extractChineseCharacters(input);
        const newChars = chineseChars.filter(char => !existingCardFronts.has(char));

        if (chineseChars.length === 0) {
            showError('Please enter at least one Chinese character');
            return;
        }

        if (newChars.length === 0) {
            showError('All characters already exist');
            return;
        }

        for (const chinese of newChars) {
            const response = await fetch(`${API_BASE}/kids/${kidId}/cards`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    front: chinese,
                    back: '',
                    front_lang: 'zh',
                    back_lang: 'en'
                }),
            });

            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
        }

        // Clear form
        addCardForm.reset();

        // Reload cards
        await loadCards();

        showError('');
    } catch (error) {
        console.error('Error adding card:', error);
        showError('Failed to add card. Please try again.');
    }
}

function extractChineseCharacters(text) {
    const matches = text.match(/\p{Script=Han}/gu);
    if (!matches) {
        return [];
    }

    return [...new Set(matches)];
}

async function deleteCard(cardId) {
    if (!confirm('Are you sure you want to delete this card?')) {
        return;
    }

    try {
        const response = await fetch(`${API_BASE}/kids/${kidId}/cards/${cardId}`, {
            method: 'DELETE',
        });

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        await loadCards();
    } catch (error) {
        console.error('Error deleting card:', error);
        showError('Failed to delete card. Please try again.');
    }
}

// UI Functions
function displayCards(cards) {
    const sortedCards = window.PracticeManageCommon.sortCardsForView(cards, viewOrderSelect.value);
    cardCount.textContent = `(${sortedCards.length})`;

    if (sortedCards.length === 0) {
        cardsGrid.innerHTML = `
            <div class="empty-state" style="grid-column: 1 / -1;">
                <h3>No characters yet</h3>
                <p>Add your first Chinese character above!</p>
            </div>
        `;
        return;
    }

    cardsGrid.innerHTML = sortedCards.map(card => `
        <div class="card-item">
            <div class="card-front">${card.front}</div>
            <div style="margin-top: 10px; color: #666; font-size: 0.85rem;">
                Avg green: ${window.PracticeManageCommon.formatAvgGreen(card.avg_green_ms)}
            </div>
            <div style="margin-top: 4px; color: #888; font-size: 0.8rem;">
                Added: ${window.PracticeManageCommon.formatAddedDate(card.parent_added_at || card.created_at)}
            </div>
            <div style="margin-top: 4px; color: #666; font-size: 0.82rem;">
                Lifetime attempts: ${card.lifetime_attempts || 0}
            </div>
            <div style="margin-top: 4px; color: #666; font-size: 0.82rem;">
                Last seen: ${window.PracticeManageCommon.formatLastSeenDays(card.last_seen_at)}
            </div>
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
