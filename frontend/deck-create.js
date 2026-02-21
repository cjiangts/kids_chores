const API_BASE = `${window.location.origin}/api`;

const firstTagToggle = document.getElementById('firstTagToggle');
const newTagInput = document.getElementById('newTagInput');
const addTagBtn = document.getElementById('addTagBtn');
const tagsContainer = document.getElementById('tagsContainer');
const existingTagOptions = document.getElementById('existingTagOptions');
const generatedNameEl = document.getElementById('generatedName');
const nameStatus = document.getElementById('nameStatus');
const cardsCsvInput = document.getElementById('cardsCsv');
const previewBtn = document.getElementById('previewBtn');
const clearCsvBtn = document.getElementById('clearCsvBtn');
const reviewSection = document.getElementById('reviewSection');
const reviewMeta = document.getElementById('reviewMeta');
const dedupeSummary = document.getElementById('dedupeSummary');
const reviewTableBody = document.getElementById('reviewTableBody');
const createDeckBtn = document.getElementById('createDeckBtn');
const successMessage = document.getElementById('successMessage');
const errorMessage = document.getElementById('errorMessage');

let extraTags = [];
let previewCards = [];
let previewRows = [];
let isCreatingDeck = false;
let nameAvailable = null;
let lastNameChecked = '';
let nameCheckToken = 0;
let nameCheckTimer = null;
let previewDiagnostics = { totalRows: 0, dedupWithinDeck: [], dedupAcrossDecks: [] };
let currentFirstTag = 'math';

document.addEventListener('DOMContentLoaded', async () => {
    const allowed = await ensureSuperFamily();
    if (!allowed) {
        return;
    }
    renderTags();
    renderFirstTagToggle();
    updateGeneratedName();
    void loadAutocompleteTags();
});

if (firstTagToggle) {
    firstTagToggle.addEventListener('click', (event) => {
        const target = event.target.closest('[data-first-tag]');
        if (!target) {
            return;
        }
        event.preventDefault();
        setCurrentFirstTag(target.getAttribute('data-first-tag'));
    });
}

addTagBtn.addEventListener('click', () => {
    addExtraTagFromInput();
});

newTagInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
        event.preventDefault();
        addExtraTagFromInput();
    }
});

previewBtn.addEventListener('click', async () => {
    await previewDeckFromCsv();
});

clearCsvBtn.addEventListener('click', () => {
    cardsCsvInput.value = '';
    cardsCsvInput.focus();
});

createDeckBtn.addEventListener('click', async () => {
    await createDeck();
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

function normalizeTag(text) {
    return String(text || '')
        .trim()
        .toLowerCase()
        .replace(/\s+/g, '_')
        .replace(/_+/g, '_')
        .replace(/^_+|_+$/g, '');
}

function renderFirstTagToggle() {
    if (!firstTagToggle) {
        return;
    }
    firstTagToggle.querySelectorAll('[data-first-tag]').forEach((el) => {
        const tag = String(el.getAttribute('data-first-tag') || '');
        const isActive = tag === currentFirstTag;
        el.classList.toggle('active', isActive);
        el.setAttribute('aria-pressed', isActive ? 'true' : 'false');
    });
}

function setCurrentFirstTag(tag) {
    const next = normalizeTag(tag);
    if (next !== 'math' && next !== 'chinese_reading') {
        return;
    }
    if (next === currentFirstTag) {
        return;
    }
    currentFirstTag = next;
    extraTags = extraTags.filter((item) => item !== currentFirstTag);
    renderTags();
    renderFirstTagToggle();
    updateGeneratedName();
}

function getAllTags() {
    return [currentFirstTag, ...extraTags];
}

function getGeneratedName() {
    return getAllTags().join('_');
}

function updateGeneratedName() {
    const name = getGeneratedName();
    generatedNameEl.textContent = name;
    scheduleNameAvailabilityCheck();
}

function addExtraTag(rawTag) {
    const nextTag = normalizeTag(rawTag);
    if (!nextTag) {
        return false;
    }
    if (nextTag === currentFirstTag || extraTags.includes(nextTag)) {
        return false;
    }
    extraTags.push(nextTag);
    return true;
}

function addExtraTagFromInput() {
    addExtraTag(newTagInput.value);
    newTagInput.value = '';
    renderTags();
    updateGeneratedName();
}

function removeExtraTag(tag) {
    extraTags = extraTags.filter((item) => item !== tag);
    renderTags();
    updateGeneratedName();
}

function renderTags() {
    if (extraTags.length === 0) {
        tagsContainer.innerHTML = '<span class="settings-note">No additional tags yet.</span>';
        return;
    }
    tagsContainer.innerHTML = extraTags.map((tag) => {
        return `<span class="deck-tag">${escapeHtml(tag)} <button type="button" data-tag="${escapeHtml(tag)}" aria-label="Remove ${escapeHtml(tag)}">✕</button></span>`;
    }).join('');
    tagsContainer.querySelectorAll('button[data-tag]').forEach((btn) => {
        btn.addEventListener('click', () => {
            removeExtraTag(btn.getAttribute('data-tag'));
        });
    });
}

function parseCsvRowsWithLineInfo(text) {
    const rows = [];
    let fields = [];
    let field = '';
    let inQuotes = false;
    let currentLine = 1;
    let rowStartLine = 1;
    let index = 0;

    while (index < text.length) {
        let ch = text[index];

        if (ch === '\r') {
            if (text[index + 1] === '\n') {
                index += 1;
            }
            ch = '\n';
        }

        if (inQuotes) {
            if (ch === '"') {
                if (text[index + 1] === '"') {
                    field += '"';
                    index += 1;
                } else {
                    inQuotes = false;
                }
            } else {
                field += ch;
                if (ch === '\n') {
                    currentLine += 1;
                }
            }
        } else if (ch === '"') {
            inQuotes = true;
        } else if (ch === ',') {
            fields.push(field);
            field = '';
        } else if (ch === '\n') {
            fields.push(field);
            rows.push({ line: rowStartLine, fields });
            fields = [];
            field = '';
            currentLine += 1;
            rowStartLine = currentLine;
        } else {
            field += ch;
        }

        index += 1;
    }

    if (inQuotes) {
        throw new Error('CSV parse error: unmatched quote.');
    }

    if (field.length > 0 || fields.length > 0) {
        fields.push(field);
        rows.push({ line: rowStartLine, fields });
    }

    return rows;
}

function parseCardsCsv(csvText) {
    const rows = parseCsvRowsWithLineInfo(String(csvText || ''));
    const cards = [];

    rows.forEach((row) => {
        const values = row.fields.map((value) => String(value || '').trim());
        const hasAnyValue = values.some((value) => value.length > 0);
        if (!hasAnyValue) {
            return;
        }
        if (values.length !== 2) {
            throw new Error(`Line ${row.line}: expected 2 columns (front,back), got ${values.length}.`);
        }
        const front = values[0];
        const back = values[1];
        if (!front || !back) {
            throw new Error(`Line ${row.line}: front and back must both be non-empty.`);
        }
        cards.push({ front, back, line: row.line });
    });

    if (cards.length === 0) {
        throw new Error('No cards parsed. Paste at least one "front,back" line.');
    }

    return cards;
}

function dedupeCardsByFront(cards) {
    const deduped = [];
    const seen = new Set();
    cards.forEach((card) => {
        if (seen.has(card.front)) {
            return;
        }
        seen.add(card.front);
        deduped.push(card);
    });
    return deduped;
}

async function previewDeckFromCsv() {
    showError('');
    showSuccess('');
    const available = await ensureNameAvailable();
    if (!available) {
        showError('Deck name already exists. Change tags before continuing.');
        return;
    }

    let cards;
    try {
        cards = parseCardsCsv(cardsCsvInput.value);
    } catch (error) {
        showError(error.message || 'Failed to parse CSV.');
        return;
    }

    const withinDeckDedup = [];
    const firstByFront = new Map();
    cards.forEach((card) => {
        const kept = firstByFront.get(card.front);
        if (kept) {
            withinDeckDedup.push({
                front: card.front,
                line: card.line,
                kept_line: kept.line,
            });
            return;
        }
        firstByFront.set(card.front, card);
    });

    const uniqueCards = Array.from(firstByFront.values());
    const frontConflicts = await fetchFrontConflicts(uniqueCards.map((card) => card.front));
    const acrossDeckDedup = [];
    previewCards = [];
    uniqueCards.forEach((card) => {
        const conflicts = Array.isArray(frontConflicts[card.front]) ? frontConflicts[card.front] : [];
        if (conflicts.length > 0) {
            acrossDeckDedup.push({
                front: card.front,
                line: card.line,
                deck_names: conflicts.map((item) => item.name),
            });
            return;
        }
        previewCards.push({ front: card.front, back: card.back });
    });

    previewDiagnostics = {
        totalRows: cards.length,
        dedupWithinDeck: withinDeckDedup,
        dedupAcrossDecks: acrossDeckDedup,
    };
    previewRows = cards.map((card) => {
        const first = firstByFront.get(card.front);
        const isFirst = Boolean(first && first.line === card.line);
        const conflicts = Array.isArray(frontConflicts[card.front]) ? frontConflicts[card.front] : [];
        if (!isFirst) {
            const conflictDeckNames = conflicts.map((item) => item.name).join(', ');
            const conflictPart = conflictDeckNames ? `; front also exists in: ${conflictDeckNames}` : '';
            return {
                line: card.line,
                front: card.front,
                back: card.back,
                kept: false,
                statusText: `Removed: duplicate of line ${first.line}${conflictPart}`,
            };
        }
        if (conflicts.length > 0) {
            const conflictDeckNames = conflicts.map((item) => item.name).join(', ');
            return {
                line: card.line,
                front: card.front,
                back: card.back,
                kept: false,
                statusText: `Removed: front already used in ${conflictDeckNames}`,
            };
        }
        return {
            line: card.line,
            front: card.front,
            back: card.back,
            kept: true,
            statusText: 'Kept',
        };
    });
    renderReview(previewCards, previewRows);
    reviewSection.classList.remove('hidden');
}

function renderReview(cardsToCreate, allRows) {
    const deckName = getGeneratedName();
    const tags = getAllTags();
    const totalRows = Number(previewDiagnostics.totalRows || 0);
    const withinDeckDedupCount = Array.isArray(previewDiagnostics.dedupWithinDeck)
        ? previewDiagnostics.dedupWithinDeck.length
        : 0;
    const acrossDeckDedupCount = Array.isArray(previewDiagnostics.dedupAcrossDecks)
        ? previewDiagnostics.dedupAcrossDecks.length
        : 0;
    const shownRows = allRows;

    reviewMeta.innerHTML = `
        <div><strong>Deck name:</strong> <code>${escapeHtml(deckName)}</code></div>
        <div><strong>Tags:</strong> ${tags.map((tag) => `<code>${escapeHtml(tag)}</code>`).join(', ')}</div>
        <div><strong>Rows parsed:</strong> ${totalRows}</div>
        <div><strong>Removed (within this deck):</strong> ${withinDeckDedupCount}</div>
        <div><strong>Removed (already used by other decks):</strong> ${acrossDeckDedupCount}</div>
        <div><strong>Cards to create:</strong> ${cardsToCreate.length}</div>
    `;
    renderDedupeSummary();

    reviewTableBody.innerHTML = shownRows.map((row) => `
        <tr>
            <td>${row.line}</td>
            <td>${escapeHtml(row.front)}</td>
            <td>${escapeHtml(row.back)}</td>
            <td class="${row.kept ? 'deck-row-status-ok' : 'deck-row-status-warn'}">${escapeHtml(row.statusText)}</td>
        </tr>
    `).join('');
}

function renderDedupeSummary() {
    const within = Array.isArray(previewDiagnostics.dedupWithinDeck) ? previewDiagnostics.dedupWithinDeck : [];
    const across = Array.isArray(previewDiagnostics.dedupAcrossDecks) ? previewDiagnostics.dedupAcrossDecks : [];
    if (within.length === 0 && across.length === 0) {
        dedupeSummary.innerHTML = '';
        dedupeSummary.classList.add('hidden');
        return;
    }

    const lines = [];
    lines.push('<h3>Deduplication Details</h3>');
    if (within.length > 0) {
        lines.push('<p><strong>Within current deck CSV:</strong></p>');
        within.slice(0, 30).forEach((item) => {
            lines.push(`<p>Line ${item.line} (${escapeHtml(item.front)}) removed, kept line ${item.kept_line}.</p>`);
        });
        if (within.length > 30) {
            lines.push(`<p>...and ${within.length - 30} more within-deck duplicates.</p>`);
        }
    }

    if (across.length > 0) {
        lines.push('<p><strong>Already exists in other deck(s):</strong></p>');
        across.slice(0, 30).forEach((item) => {
            const deckNames = item.deck_names.map((name) => escapeHtml(name)).join(', ');
            lines.push(`<p>Line ${item.line} (${escapeHtml(item.front)}) removed; already used in: ${deckNames}.</p>`);
        });
        if (across.length > 30) {
            lines.push(`<p>...and ${across.length - 30} more cross-deck duplicates.</p>`);
        }
    }

    dedupeSummary.innerHTML = lines.join('');
    dedupeSummary.classList.remove('hidden');
}

async function createDeck() {
    if (isCreatingDeck) {
        return;
    }
    if (!Array.isArray(previewCards) || previewCards.length === 0) {
        showError('Preview first before creating the deck.');
        return;
    }
    const available = await ensureNameAvailable();
    if (!available) {
        showError('Deck name already exists. Change tags before creating.');
        return;
    }

    const payload = {
        firstTag: currentFirstTag,
        extraTags: extraTags,
        cards: previewCards,
    };

    isCreatingDeck = true;
    createDeckBtn.disabled = true;
    createDeckBtn.textContent = 'Creating...';
    showError('');
    showSuccess('');

    try {
        const response = await fetch(`${API_BASE}/shared-decks`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok) {
            throw new Error(result.error || `Create failed (HTTP ${response.status})`);
        }

        showSuccess(`Deck created: #${result.deck.deck_id} (${result.deck.name}), added ${result.cards_added} cards. Redirecting...`);
        window.setTimeout(() => {
            window.location.href = '/deck-manage.html';
        }, 500);
    } catch (error) {
        console.error('Error creating shared deck:', error);
        showError(error.message || 'Failed to create deck.');
    } finally {
        isCreatingDeck = false;
        createDeckBtn.disabled = false;
        createDeckBtn.textContent = 'Confirm & Create Deck';
    }
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

function setNameStatus(text, state) {
    nameStatus.textContent = text;
    nameStatus.classList.remove('ok', 'error', 'note');
    nameStatus.classList.add(state);
}

function scheduleNameAvailabilityCheck() {
    nameAvailable = null;
    if (nameCheckTimer) {
        window.clearTimeout(nameCheckTimer);
    }
    setNameStatus('Checking name availability...', 'note');
    nameCheckTimer = window.setTimeout(() => {
        nameCheckTimer = null;
        void checkNameAvailability();
    }, 180);
}

async function ensureNameAvailable() {
    const currentName = getGeneratedName();
    if (nameAvailable !== null && lastNameChecked === currentName) {
        return nameAvailable;
    }
    await checkNameAvailability();
    return nameAvailable === true;
}

async function checkNameAvailability() {
    const currentName = getGeneratedName();
    const token = ++nameCheckToken;
    try {
        const response = await fetch(`${API_BASE}/shared-decks/name-availability?name=${encodeURIComponent(currentName)}`);
        const result = await response.json().catch(() => ({}));
        if (token !== nameCheckToken) {
            return;
        }
        if (!response.ok) {
            throw new Error(result.error || `Failed to check name (HTTP ${response.status})`);
        }
        nameAvailable = Boolean(result.available);
        lastNameChecked = currentName;
        if (nameAvailable) {
            setNameStatus('Name available.', 'ok');
        } else {
            setNameStatus('Name already exists. Please change tags.', 'error');
        }
    } catch (error) {
        if (token !== nameCheckToken) {
            return;
        }
        console.error('Error checking deck name availability:', error);
        nameAvailable = null;
        lastNameChecked = '';
        setNameStatus('Could not verify name right now.', 'error');
    }
}

async function loadAutocompleteTags() {
    try {
        const response = await fetch(`${API_BASE}/shared-decks/tags`);
        const result = await response.json().catch(() => ({}));
        if (!response.ok) {
            throw new Error(result.error || `Failed to load tags (HTTP ${response.status})`);
        }
        const tags = Array.isArray(result.tags) ? result.tags : [];
        existingTagOptions.innerHTML = tags.map((tag) => `<option value="${escapeHtml(tag)}"></option>`).join('');
    } catch (error) {
        console.error('Error loading autocomplete tags:', error);
        existingTagOptions.innerHTML = '';
    }
}

async function fetchFrontConflicts(fronts) {
    if (!Array.isArray(fronts) || fronts.length === 0) {
        return {};
    }
    const response = await fetch(`${API_BASE}/shared-decks/front-conflicts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fronts }),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
        throw new Error(result.error || `Failed to check front conflicts (HTTP ${response.status})`);
    }
    if (!result || typeof result !== 'object' || !result.conflicts || typeof result.conflicts !== 'object') {
        return {};
    }
    return result.conflicts;
}
