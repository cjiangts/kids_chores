const API_BASE = `${window.location.origin}/api`;

const params = new URLSearchParams(window.location.search);
const kidId = params.get('id');

const kidNameEl = document.getElementById('kidName');
const errorMessage = document.getElementById('errorMessage');
const sessionSettingsForm = document.getElementById('sessionSettingsForm');
const deckCountLabel = document.getElementById('deckCountLabel');
const activeDeckCountInput = document.getElementById('activeDeckCount');
const mathSessionTotalInline = document.getElementById('mathSessionTotalInline');
const viewOrderSelect = document.getElementById('viewOrderSelect');
const cardCount = document.getElementById('cardCount');
const deckTotalInfo = document.getElementById('deckTotalInfo');
const cardsGrid = document.getElementById('cardsGrid');
const deckTabWithin10 = document.getElementById('deckTabWithin10');
const deckTabWithin20 = document.getElementById('deckTabWithin20');
const charactersTab = document.getElementById('charactersTab');
const writingTab = document.getElementById('writingTab');
const mathTab = document.getElementById('mathTab');

let currentKid = null;
let currentCards = [];
let sortedCards = [];
let visibleCardCount = 10;
let activeDeckKey = 'within10';
let activeDeckLabel = 'Addition Within 10';
let activeDeckTotalCards = 0;
let deckCounts = {
    within10: 5,
    within20: 5,
};
const CARD_PAGE_SIZE = 10;


document.addEventListener('DOMContentLoaded', async () => {
    if (!kidId) {
        window.location.href = '/admin.html';
        return;
    }

    charactersTab.href = `/kid-reading-manage.html?id=${kidId}`;
    writingTab.href = `/kid-writing-manage.html?id=${kidId}`;
    mathTab.href = `/kid-math-manage.html?id=${kidId}`;

    sessionSettingsForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        await saveSessionSettings();
    });

    viewOrderSelect.addEventListener('change', () => resetAndDisplayCards(currentCards));
    cardsGrid.addEventListener('click', handleCardsGridClick);
    deckTabWithin10.addEventListener('click', async () => {
        if (activeDeckKey === 'within10') return;
        activeDeckKey = 'within10';
        renderDeckTabs();
        await loadMathCards();
    });
    deckTabWithin20.addEventListener('click', async () => {
        if (activeDeckKey === 'within20') return;
        activeDeckKey = 'within20';
        renderDeckTabs();
        await loadMathCards();
    });

    activeDeckCountInput.addEventListener('input', () => {
        const value = Number.parseInt(activeDeckCountInput.value, 10);
        deckCounts[activeDeckKey] = Number.isInteger(value) ? Math.max(0, value) : 0;
        updateTotalSessionCount();
        renderDeckTabs();
    });

    window.addEventListener('scroll', () => {
        maybeLoadMoreCards();
    });

    renderDeckTabs();
    await loadKidInfo();
    await loadMathCards();
});


function renderDeckTabs() {
    deckTabWithin10.classList.toggle('active', activeDeckKey === 'within10');
    deckTabWithin20.classList.toggle('active', activeDeckKey === 'within20');
    deckTabWithin10.textContent = `Deck 1: Addition Within 10 (${deckCounts.within10 || 0})`;
    deckTabWithin20.textContent = `Deck 2: Addition Within 20 (${deckCounts.within20 || 0})`;
    deckCountLabel.textContent = activeDeckKey === 'within20'
        ? 'Deck 2 Selected Per Session'
        : 'Deck 1 Selected Per Session';
    activeDeckCountInput.value = String(deckCounts[activeDeckKey] || 0);
}


function updateTotalSessionCount() {
    const safeWithin10 = Number.isInteger(deckCounts.within10) ? Math.max(0, deckCounts.within10) : 0;
    const safeWithin20 = Number.isInteger(deckCounts.within20) ? Math.max(0, deckCounts.within20) : 0;
    const total = safeWithin10 + safeWithin20;
    mathSessionTotalInline.textContent = `(${total})`;
}


async function loadKidInfo() {
    try {
        const response = await fetch(`${API_BASE}/kids/${kidId}`);
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }

        currentKid = await response.json();
        kidNameEl.textContent = `${currentKid.name}'s Math`;

        const within10Value = Number.parseInt(currentKid.mathDeckWithin10Count, 10);
        const within20Value = Number.parseInt(currentKid.mathDeckWithin20Count, 10);
        deckCounts.within10 = Number.isInteger(within10Value) ? within10Value : 5;
        deckCounts.within20 = Number.isInteger(within20Value) ? within20Value : 5;
        updateTotalSessionCount();
        renderDeckTabs();
    } catch (error) {
        console.error('Error loading kid:', error);
        showError('Failed to load kid information');
    }
}


async function saveSessionSettings() {
    try {
        const activeCount = Number.parseInt(activeDeckCountInput.value, 10);

        if (!Number.isInteger(activeCount) || activeCount < 0 || activeCount > 200) {
            showError('Selected deck count must be between 0 and 200');
            return;
        }
        deckCounts[activeDeckKey] = activeCount;

        const response = await fetch(`${API_BASE}/kids/${kidId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                mathDeckWithin10Count: deckCounts.within10 || 0,
                mathDeckWithin20Count: deckCounts.within20 || 0
            })
        });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }

        currentKid = await response.json();
        showError('');
        updateTotalSessionCount();
        renderDeckTabs();
        await loadMathCards();
    } catch (error) {
        console.error('Error saving session settings:', error);
        showError('Failed to save practice settings');
    }
}


async function loadMathCards() {
    try {
        showError('');
        const response = await fetch(`${API_BASE}/kids/${kidId}/math/cards?deck=${encodeURIComponent(activeDeckKey)}`);
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }

        const data = await response.json();
        activeDeckLabel = data.deck_label || (activeDeckKey === 'within20' ? 'Addition Within 20' : 'Addition Within 10');
        currentCards = data.cards || [];
        const activeCount = Number.isInteger(Number.parseInt(data.active_card_count, 10))
            ? Number.parseInt(data.active_card_count, 10)
            : currentCards.filter((card) => !card.skip_practice).length;
        const skippedCount = Number.isInteger(Number.parseInt(data.skipped_card_count, 10))
            ? Number.parseInt(data.skipped_card_count, 10)
            : currentCards.filter((card) => !!card.skip_practice).length;
        activeDeckTotalCards = activeCount;
        deckTotalInfo.textContent = `Active cards in this deck: ${activeCount} (Skipped: ${skippedCount})`;
        resetAndDisplayCards(currentCards);
    } catch (error) {
        console.error('Error loading math cards:', error);
        showError('Failed to load math cards');
    }
}


function displayCards(cards) {
    sortedCards = window.PracticeManageCommon.sortCardsForView(cards, viewOrderSelect.value);
    cardCount.textContent = `${sortedCards.length} shown`;

    if (sortedCards.length === 0) {
        cardsGrid.innerHTML = `<div class="empty-state" style="grid-column: 1 / -1;"><h3>No cards in ${activeDeckLabel}</h3></div>`;
        return;
    }

    const visibleCards = sortedCards.slice(0, visibleCardCount);
    cardsGrid.innerHTML = visibleCards.map((card) => `
        <div class="card-item ${card.skip_practice ? 'skipped' : ''}">
            <button
                type="button"
                class="skip-toggle-btn ${card.skip_practice ? 'on' : 'off'}"
                data-action="toggle-skip"
                data-card-id="${card.id}"
                data-skipped="${card.skip_practice ? 'true' : 'false'}"
                title="${card.skip_practice ? 'Turn skip off for this card' : 'Mark this card as skipped'}"
                aria-label="${card.skip_practice ? 'Skip is on' : 'Skip is off'}"
            >Skip ${card.skip_practice ? 'ON' : 'OFF'}</button>
            <div class="card-front">${card.front}</div>
            <div class="card-back">= ${card.back}</div>
            ${card.skip_practice ? '<div class="skipped-note">Skipped from practice</div>' : ''}
            <div style="margin-top: 10px; color: #666; font-size: 0.85rem;">Hardness score: ${window.PracticeManageCommon.formatHardnessScore(card.hardness_score)}</div>
            <div style="margin-top: 4px; color: #888; font-size: 0.8rem;">Added: ${window.PracticeManageCommon.formatAddedDate(card.parent_added_at || card.created_at)}</div>
            <div style="margin-top: 4px; color: #666; font-size: 0.82rem;">Lifetime attempts: ${card.lifetime_attempts || 0}</div>
            <div style="margin-top: 4px; color: #666; font-size: 0.82rem;">Last seen: ${window.PracticeManageCommon.formatLastSeenDays(card.last_seen_at)}</div>
        </div>
    `).join('');
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


async function handleCardsGridClick(event) {
    const actionBtn = event.target.closest('[data-action]');
    if (!actionBtn) {
        return;
    }

    const action = actionBtn.dataset.action;
    if (action !== 'toggle-skip') {
        return;
    }

    const cardId = actionBtn.dataset.cardId;
    if (!cardId) {
        return;
    }

    const currentlySkipped = actionBtn.dataset.skipped === 'true';
    const targetSkipped = !currentlySkipped;

    try {
        actionBtn.disabled = true;
        await updateMathCardSkip(cardId, targetSkipped);
    } catch (error) {
        console.error('Error updating math card skip:', error);
        showError('Failed to update skip status');
    } finally {
        actionBtn.disabled = false;
    }
}


async function updateMathCardSkip(cardId, skipped) {
    const response = await fetch(`${API_BASE}/kids/${kidId}/math/cards/${cardId}/skip`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ skipped })
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
        throw new Error(result.error || `HTTP ${response.status}`);
    }

    await loadMathCards();
    showError('');
}


function showError(message) {
    if (message) {
        errorMessage.textContent = message;
        errorMessage.classList.remove('hidden');
    } else {
        errorMessage.classList.add('hidden');
    }
}
