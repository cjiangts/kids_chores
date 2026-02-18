const API_BASE = `${window.location.origin}/api`;

const params = new URLSearchParams(window.location.search);
const kidId = params.get('id');

const kidNameEl = document.getElementById('kidName');
const errorMessage = document.getElementById('errorMessage');
const sessionSettingsForm = document.getElementById('sessionSettingsForm');
const sessionTotalInline = document.getElementById('sessionTotalInline');
const viewOrderSelect = document.getElementById('viewOrderSelect');
const deckTotalInfo = document.getElementById('deckTotalInfo');
const cardsGrid = document.getElementById('cardsGrid');
const deckTabMa3Unit1 = document.getElementById('deckTabMa3Unit1');
const deckTabMa3Unit2 = document.getElementById('deckTabMa3Unit2');
const deckTabMa3Unit3 = document.getElementById('deckTabMa3Unit3');
const charactersTab = document.getElementById('charactersTab');
const writingTab = document.getElementById('writingTab');
const mathTab = document.getElementById('mathTab');
const lessonReadingTab = document.getElementById('lessonReadingTab');

const DECK_META = {
    ma3Unit1: { label: '马三 一单元', field: 'lessonReadingDeckMa3Unit1Count', defaultCount: 0, tabEl: deckTabMa3Unit1, inputEl: document.getElementById('deckCountMa3Unit1') },
    ma3Unit2: { label: '马三 二单元', field: 'lessonReadingDeckMa3Unit2Count', defaultCount: 0, tabEl: deckTabMa3Unit2, inputEl: document.getElementById('deckCountMa3Unit2') },
    ma3Unit3: { label: '马三 三单元', field: 'lessonReadingDeckMa3Unit3Count', defaultCount: 0, tabEl: deckTabMa3Unit3, inputEl: document.getElementById('deckCountMa3Unit3') },
};

let currentKid = null;
let currentCards = [];
let sortedCards = [];
let visibleCardCount = 10;
let activeDeckKey = 'ma3Unit1';
let activeDeckLabel = DECK_META.ma3Unit1.label;
let deckCounts = {
    ma3Unit1: 0,
    ma3Unit2: 0,
    ma3Unit3: 0,
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
            await loadCards();
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
    await loadCards();
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
    sessionTotalInline.textContent = `Total per session: ${total}`;
}


async function loadKidInfo() {
    try {
        const response = await fetch(`${API_BASE}/kids/${kidId}`);
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }

        currentKid = await response.json();
        kidNameEl.textContent = `${currentKid.name}'s Chinese Reading`;

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
        await loadCards();
    } catch (error) {
        console.error('Error saving chinese reading settings:', error);
        showError('Failed to save practice settings');
    }
}


async function loadCards() {
    try {
        showError('');
        const response = await fetch(`${API_BASE}/kids/${kidId}/lesson-reading/cards?deck=${encodeURIComponent(activeDeckKey)}`);
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
        deckTotalInfo.textContent = `Active cards in this deck: ${activeCount} (Skipped: ${skippedCount})`;
        resetAndDisplayCards(currentCards);
    } catch (error) {
        console.error('Error loading chinese reading cards:', error);
        showError('Failed to load chinese reading cards');
    }
}


function displayCards(cards) {
    sortedCards = window.PracticeManageCommon.sortCardsForView(cards, viewOrderSelect.value);

    if (sortedCards.length === 0) {
        cardsGrid.innerHTML = `<div class="empty-state" style="grid-column: 1 / -1;"><h3>No cards in ${activeDeckLabel}</h3></div>`;
        return;
    }

    const visibleCards = sortedCards.slice(0, visibleCardCount);
    cardsGrid.innerHTML = visibleCards.map((card) => {
        const frontParts = splitLessonFront(card.front);
        return `
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
            ${frontParts.week ? `<div style="margin-bottom: 4px; color: #888; font-size: 0.8rem;">${escapeHtml(frontParts.week)}</div>` : ''}
            <div class="card-front">${escapeHtml(frontParts.title)}</div>
            <div class="card-back">Page ${escapeHtml(card.back)}</div>
            ${card.skip_practice ? '<div class="skipped-note">Skipped from practice</div>' : ''}
            <div style="margin-top: 4px; color: #666; font-size: 0.82rem;">Lifetime attempts: ${card.lifetime_attempts || 0}</div>
            <div style="margin-top: 4px; color: #666; font-size: 0.82rem;">Last seen: ${window.PracticeManageCommon.formatLastSeenDays(card.last_seen_at)}</div>
            <a
                class="card-report-link"
                href="/kid-card-report.html?id=${encodeURIComponent(kidId)}&cardId=${encodeURIComponent(card.id)}&from=lesson-reading"
            >Report</a>
        </div>
    `;
    }).join('');
}

function splitLessonFront(rawFront) {
    const text = String(rawFront || '').trim();
    if (!text) {
        return { week: '', title: '' };
    }
    const tokens = text.split(/\s+/).map((v) => v.trim()).filter(Boolean);
    if (tokens.length >= 2) {
        const week = tokens[0].replace(/[：:、，,]+$/g, '');
        if (/^第[一二三四五六七八九十百千0-9]+周$/.test(week)) {
            return { week, title: tokens.slice(1).join(' ') };
        }
    }
    return { week: '', title: text };
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
        await updateCardSkip(cardId, targetSkipped);
    } catch (error) {
        console.error('Error updating chinese reading card skip:', error);
        showError('Failed to update skip status');
    } finally {
        actionBtn.disabled = false;
    }
}


async function updateCardSkip(cardId, skipped) {
    const response = await fetch(`${API_BASE}/kids/${kidId}/lesson-reading/cards/${cardId}/skip`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ skipped })
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
        throw new Error(result.error || `HTTP ${response.status}`);
    }

    await loadCards();
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

function escapeHtml(raw) {
    return String(raw || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}
