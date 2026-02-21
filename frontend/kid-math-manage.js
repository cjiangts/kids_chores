const API_BASE = `${window.location.origin}/api`;

const params = new URLSearchParams(window.location.search);
const kidId = params.get('id');

const kidNameEl = document.getElementById('kidName');
const errorMessage = document.getElementById('errorMessage');
const sessionSettingsForm = document.getElementById('sessionSettingsForm');
const mathSessionTotalInline = document.getElementById('mathSessionTotalInline');
const mathCardCount = document.getElementById('mathCardCount');
const viewOrderSelect = document.getElementById('viewOrderSelect');
const deckTotalInfo = document.getElementById('deckTotalInfo');
const cardsGrid = document.getElementById('cardsGrid');
const deckTabWithin10 = document.getElementById('deckTabWithin10');
const deckTabWithin20 = document.getElementById('deckTabWithin20');
const deckTabSubWithin10 = document.getElementById('deckTabSubWithin10');
const deckTabSubWithin20 = document.getElementById('deckTabSubWithin20');
const charactersTab = document.getElementById('charactersTab');
const writingTab = document.getElementById('writingTab');
const mathTab = document.getElementById('mathTab');
const lessonReadingTab = document.getElementById('lessonReadingTab');

const DECK_META = {
    within10: { label: 'Add ≤10', field: 'mathDeckWithin10Count', defaultCount: 5, tabEl: deckTabWithin10, inputEl: document.getElementById('deckCountWithin10') },
    within20: { label: 'Add 11–20', field: 'mathDeckWithin20Count', defaultCount: 5, tabEl: deckTabWithin20, inputEl: document.getElementById('deckCountWithin20') },
    subWithin10: { label: 'Sub ≤10', field: 'mathDeckSubWithin10Count', defaultCount: 0, tabEl: deckTabSubWithin10, inputEl: document.getElementById('deckCountSubWithin10') },
    subWithin20: { label: 'Sub 11–20', field: 'mathDeckSubWithin20Count', defaultCount: 0, tabEl: deckTabSubWithin20, inputEl: document.getElementById('deckCountSubWithin20') },
};

let currentKid = null;
let currentCards = [];
let sortedCards = [];
let visibleCardCount = 10;
let activeDeckKey = 'within10';
let activeDeckLabel = 'Add ≤10';
let activeDeckTotalCards = 0;
let deckCounts = {
    within10: 5,
    within20: 5,
    subWithin10: 0,
    subWithin20: 0,
};
const CARD_PAGE_SIZE = 10;


document.addEventListener('DOMContentLoaded', async () => {
    if (!kidId) {
        window.location.href = '/admin.html';
        return;
    }

    charactersTab.href = `/kid-reading-manage.html?id=${kidId}`;
    writingTab.href = `/kid-writing-manage.html?id=${kidId}`;
    mathTab.href = `/kid-math-manage-v2.html?id=${kidId}`;
    lessonReadingTab.href = `/kid-lesson-reading-manage.html?id=${kidId}`;

    sessionSettingsForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        await saveSessionSettings();
    });

    viewOrderSelect.addEventListener('change', () => resetAndDisplayCards(currentCards));
    cardsGrid.addEventListener('click', handleCardsGridClick);
    Object.keys(DECK_META).forEach((deckKey) => {
        const meta = DECK_META[deckKey];
        meta.tabEl.addEventListener('click', async () => {
            if (activeDeckKey === deckKey) return;
            activeDeckKey = deckKey;
            renderDeckTabs();
            await loadMathCards();
        });
        meta.inputEl.addEventListener('input', () => {
            const value = Number.parseInt(meta.inputEl.value, 10);
            deckCounts[deckKey] = Number.isInteger(value) ? Math.max(0, value) : 0;
            updateTotalSessionCount();
        });
    });

    window.addEventListener('scroll', () => {
        maybeLoadMoreCards();
    });

    renderDeckTabs();
    await loadKidInfo();
    await loadMathCards();
});


function renderDeckTabs() {
    Object.keys(DECK_META).forEach((deckKey) => {
        const meta = DECK_META[deckKey];
        meta.tabEl.classList.toggle('active', activeDeckKey === deckKey);
    });
}


function updateTotalSessionCount() {
    const total = Object.keys(DECK_META).reduce((sum, deckKey) => {
        const count = Number.parseInt(deckCounts[deckKey], 10);
        return sum + (Number.isInteger(count) ? Math.max(0, count) : 0);
    }, 0);
    mathSessionTotalInline.textContent = `Total per session: ${total}`;
}


async function loadKidInfo() {
    try {
        const response = await fetch(`${API_BASE}/kids/${kidId}`);
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }

        currentKid = await response.json();
        kidNameEl.textContent = `${currentKid.name}'s Math`;

        Object.keys(DECK_META).forEach((deckKey) => {
            const meta = DECK_META[deckKey];
            const value = Number.parseInt(currentKid[meta.field], 10);
            deckCounts[deckKey] = Number.isInteger(value) ? value : meta.defaultCount;
            meta.inputEl.value = String(deckCounts[deckKey]);
        });
        updateTotalSessionCount();
        renderDeckTabs();
    } catch (error) {
        console.error('Error loading kid:', error);
        showError('Failed to load kid information');
    }
}


async function saveSessionSettings() {
    try {
        for (const deckKey of Object.keys(DECK_META)) {
            const meta = DECK_META[deckKey];
            const value = Number.parseInt(meta.inputEl.value, 10);
            if (!Number.isInteger(value) || value < 0 || value > 200) {
                showError(`${meta.label} count must be between 0 and 200`);
                return;
            }
            deckCounts[deckKey] = value;
        }

        const response = await fetch(`${API_BASE}/kids/${kidId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(
                Object.keys(DECK_META).reduce((payload, deckKey) => {
                    const meta = DECK_META[deckKey];
                    payload[meta.field] = deckCounts[deckKey] || 0;
                    return payload;
                }, {})
            )
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
        activeDeckLabel = data.deck_label || DECK_META[activeDeckKey].label;
        currentCards = data.cards || [];
        const activeCount = Number.isInteger(Number.parseInt(data.active_card_count, 10))
            ? Number.parseInt(data.active_card_count, 10)
            : currentCards.filter((card) => !card.skip_practice).length;
        const skippedCount = Number.isInteger(Number.parseInt(data.skipped_card_count, 10))
            ? Number.parseInt(data.skipped_card_count, 10)
            : currentCards.filter((card) => !!card.skip_practice).length;
        activeDeckTotalCards = activeCount;
        if (mathCardCount) {
            mathCardCount.textContent = `(${currentCards.length})`;
        }
        deckTotalInfo.textContent = `Active cards in this deck: ${activeCount} (Skipped: ${skippedCount})`;
        resetAndDisplayCards(currentCards);
    } catch (error) {
        console.error('Error loading math cards:', error);
        showError('Failed to load math cards');
    }
}


function displayCards(cards) {
    sortedCards = window.PracticeManageCommon.sortCardsForView(cards, viewOrderSelect.value);

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
            <div class="card-front">${escapeHtml(card.front)}</div>
            <div class="card-back">= ${escapeHtml(card.back)}</div>
            ${card.skip_practice ? '<div class="skipped-note">Skipped from practice</div>' : ''}
            <div style="margin-top: 10px; color: #666; font-size: 0.85rem;">Hardness score: ${window.PracticeManageCommon.formatHardnessScore(card.hardness_score)}</div>
            <div style="margin-top: 4px; color: #666; font-size: 0.82rem;">Lifetime attempts: ${card.lifetime_attempts || 0}</div>
            <div style="margin-top: 4px; color: #666; font-size: 0.82rem;">Last seen: ${window.PracticeManageCommon.formatLastSeenDays(card.last_seen_at)}</div>
            <a
                class="card-report-link"
                href="/kid-card-report.html?id=${encodeURIComponent(kidId)}&cardId=${encodeURIComponent(card.id)}&from=math"
            >Report</a>
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
