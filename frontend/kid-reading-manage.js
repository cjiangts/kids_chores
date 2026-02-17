// API Configuration
const API_BASE = `${window.location.origin}/api`;

// Get kid ID from URL
const urlParams = new URLSearchParams(window.location.search);
const kidId = urlParams.get('id');

// DOM Elements
const kidNameEl = document.getElementById('kidName');
const addCardForm = document.getElementById('addCardForm');
const chineseCharInput = document.getElementById('chineseChar');
const addReadingBtn = document.getElementById('addReadingBtn');
const sessionSettingsForm = document.getElementById('sessionSettingsForm');
const sessionCardCountInput = document.getElementById('sessionCardCount');
const cardsGrid = document.getElementById('cardsGrid');
const cardCount = document.getElementById('cardCount');
const errorMessage = document.getElementById('errorMessage');
const viewOrderSelect = document.getElementById('viewOrderSelect');
const cardSearchInput = document.getElementById('cardSearchInput');
const addSiWuKuaiDuBtn = document.getElementById('addSiWuKuaiDuBtn');
const charactersTab = document.getElementById('charactersTab');
const writingTab = document.getElementById('writingTab');
const mathTab = document.getElementById('mathTab');

let currentKid = null;
let defaultDeckId = null;
let existingCardFronts = new Set();
let currentCards = [];
let sortedCards = [];
let visibleCardCount = 10;
const CARD_PAGE_SIZE = 10;

// Initialize
document.addEventListener('DOMContentLoaded', async () => {
    if (!kidId) {
        window.location.href = '/';
        return;
    }

    charactersTab.href = `/kid-reading-manage.html?id=${kidId}`;
    writingTab.href = `/kid-writing-manage.html?id=${kidId}`;
    mathTab.href = `/kid-math-manage.html?id=${kidId}`;

    await loadKidInfo();
    await loadCards();
});

window.addEventListener('scroll', () => {
    maybeLoadMoreCards();
});

// Form submission
addCardForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    await addCard();
});
chineseCharInput.addEventListener('input', () => {
    updateAddReadingButtonCount();
});

sessionSettingsForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    await saveSessionSettings();
});

viewOrderSelect.addEventListener('change', () => {
    resetAndDisplayCards(currentCards);
});
cardSearchInput.addEventListener('input', () => {
    resetAndDisplayCards(currentCards);
});

addSiWuKuaiDuBtn.addEventListener('click', () => {
    window.open('/reading-preset-siwu-kuaidu.html', '_blank', 'noopener,noreferrer,width=920,height=840');
});

function updateAddReadingButtonCount() {
    const totalChineseChars = countChineseCharsBeforeDbDedup(chineseCharInput.value);
    if (totalChineseChars > 0) {
        addReadingBtn.textContent = `Add Chinese Reading Character (${totalChineseChars})`;
        return;
    }
    addReadingBtn.textContent = 'Add Chinese Reading Character';
}

// API Functions
async function loadKidInfo() {
    try {
        const response = await fetch(`${API_BASE}/kids/${kidId}`);
        if (!response.ok) {
            throw new Error('Kid not found');
        }
        currentKid = await response.json();
        kidNameEl.textContent = `${currentKid.name}'s Chinese Character Reading`;
        const readingCount = Number.parseInt(currentKid.sessionCardCount, 10);
        sessionCardCountInput.value = Number.isInteger(readingCount) ? readingCount : 10;
    } catch (error) {
        console.error('Error loading kid:', error);
        showError('Failed to load kid information');
        setTimeout(() => window.location.href = '/', 2000);
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
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                sessionCardCount: value
            }),
        });

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const updatedKid = await response.json();
        currentKid = updatedKid;
        const savedReadingCount = Number.parseInt(updatedKid.sessionCardCount, 10);
        sessionCardCountInput.value = Number.isInteger(savedReadingCount) ? savedReadingCount : value;
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
        resetAndDisplayCards(cards);

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
        const input = chineseCharInput.value.trim();
        const chineseChars = extractChineseCharacters(input);
        const newChars = chineseChars.filter(char => !existingCardFronts.has(char));

        if (chineseChars.length === 0) {
            showError('Please enter at least one Chinese reading character');
            return;
        }

        if (newChars.length === 0) {
            showError('All characters already exist');
            return;
        }

        const response = await fetch(`${API_BASE}/kids/${kidId}/cards/bulk`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                cards: newChars.map(chinese => ({ front: chinese, back: '' }))
            }),
        });

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        // Clear form
        addCardForm.reset();
        updateAddReadingButtonCount();

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

function countChineseCharsBeforeDbDedup(text) {
    const matches = String(text || '').match(/\p{Script=Han}/gu);
    return matches ? matches.length : 0;
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
    const filteredCards = filterCardsByQuery(cards, cardSearchInput.value);
    sortedCards = window.PracticeManageCommon.sortCardsForView(filteredCards, viewOrderSelect.value);
    cardCount.textContent = `(${sortedCards.length})`;

    if (sortedCards.length === 0) {
        cardsGrid.innerHTML = `
            <div class="empty-state" style="grid-column: 1 / -1;">
                <h3>No Chinese reading cards yet</h3>
                <p>Add your first Chinese reading character above!</p>
            </div>
        `;
        return;
    }

    const visibleCards = sortedCards.slice(0, visibleCardCount);
    cardsGrid.innerHTML = visibleCards.map(card => `
        <div class="card-item">
            <button
                type="button"
                class="delete-card-btn"
                onclick="deleteCard('${card.id}')"
                title="Delete this Chinese reading card"
                aria-label="Delete this card"
            >×</button>
            <div class="card-front">${escapeHtml(card.front)}</div>
            <div style="margin-top: 10px; color: #666; font-size: 0.85rem;">
                Hardness score: ${window.PracticeManageCommon.formatHardnessScore(card.hardness_score)}
            </div>
            <div style="margin-top: 4px; color: #888; font-size: 0.8rem;">
                Added: ${window.PracticeManageCommon.formatAddedDate(card.created_at)}
            </div>
            <div style="margin-top: 4px; color: #666; font-size: 0.82rem;">
                Lifetime attempts: ${card.lifetime_attempts || 0}
            </div>
            <div style="margin-top: 4px; color: #666; font-size: 0.82rem;">
                Last seen: ${window.PracticeManageCommon.formatLastSeenDays(card.last_seen_at)}
            </div>
            <a
                class="card-report-link"
                href="/kid-card-report.html?id=${encodeURIComponent(kidId)}&cardId=${encodeURIComponent(card.id)}&from=reading"
            >Report</a>
        </div>
    `).join('');
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

updateAddReadingButtonCount();
