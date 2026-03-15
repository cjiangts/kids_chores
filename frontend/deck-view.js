const API_BASE = `${window.location.origin}/api`;

const deckMeta = document.getElementById('deckMeta');
const deckIdText = document.getElementById('deckIdText');
const deckNameText = document.getElementById('deckNameText');
const deckTagsText = document.getElementById('deckTagsText');
const deckBehaviorText = document.getElementById('deckBehaviorText');
const deckCreatedAtText = document.getElementById('deckCreatedAtText');
const cardCountText = document.getElementById('cardCountText');
const editorSectionTitle = document.getElementById('editorSectionTitle');
const staticDeckEditor = document.getElementById('staticDeckEditor');
const type4DeckEditor = document.getElementById('type4DeckEditor');
const type4RepresentativeLabelText = document.getElementById('type4RepresentativeLabelText');
const type4GeneratorCodeText = document.getElementById('type4GeneratorCodeText');
const tableWrap = document.getElementById('tableWrap');
const emptyState = document.getElementById('emptyState');
const cardsTableBody = document.getElementById('cardsTableBody');
const cardsInput = document.getElementById('cardsInput');
const addCardsBtn = document.getElementById('addCardsBtn');
const clearCardsInputBtn = document.getElementById('clearCardsInputBtn');
const successMessage = document.getElementById('successMessage');
const errorMessage = document.getElementById('errorMessage');
const renameDeckTagsBtn = document.getElementById('renameDeckTagsBtn');
const renameTagsModal = document.getElementById('renameTagsModal');
const closeRenameTagsModalBtn = document.getElementById('closeRenameTagsModalBtn');
const cancelRenameTagsBtn = document.getElementById('cancelRenameTagsBtn');
const saveRenameTagsBtn = document.getElementById('saveRenameTagsBtn');
const renameFixedFirstTag = document.getElementById('renameFixedFirstTag');
const renameNewTagInput = document.getElementById('renameNewTagInput');
const renameAddTagBtn = document.getElementById('renameAddTagBtn');
const renameTagsContainer = document.getElementById('renameTagsContainer');
const renameDeckNamePreview = document.getElementById('renameDeckNamePreview');
const renameNameStatus = document.getElementById('renameNameStatus');
const renameTagsMessage = document.getElementById('renameTagsMessage');
const renameTagsError = document.getElementById('renameTagsError');
const deckCategoryCommon = window.DeckCategoryCommon;

if (!deckCategoryCommon) {
    throw new Error('deck-category-common.js is required for deck-view');
}

let deckId = 0;
let isMutating = false;
let currentDeck = null;
let isRenamingTags = false;
let renameExtraTags = [];
let renameNameAvailable = null;
let renameLastNameChecked = '';
let renameNameCheckToken = 0;
let renameNameCheckTimer = null;

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
    if (renameDeckTagsBtn) {
        renameDeckTagsBtn.addEventListener('click', () => {
            openRenameTagsModal();
        });
    }
    if (closeRenameTagsModalBtn) {
        closeRenameTagsModalBtn.addEventListener('click', closeRenameTagsModal);
    }
    if (cancelRenameTagsBtn) {
        cancelRenameTagsBtn.addEventListener('click', closeRenameTagsModal);
    }
    if (saveRenameTagsBtn) {
        saveRenameTagsBtn.addEventListener('click', async () => {
            await saveRenamedTags();
        });
    }
    if (renameAddTagBtn) {
        renameAddTagBtn.addEventListener('click', () => {
            addRenameExtraTagFromInput();
        });
    }
    if (renameNewTagInput) {
        renameNewTagInput.addEventListener('keydown', (event) => {
            if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
                event.preventDefault();
                void saveRenamedTags();
                return;
            }
            if (event.key === 'Enter') {
                event.preventDefault();
                addRenameExtraTagFromInput();
                return;
            }
            if (event.key === 'Escape') {
                event.preventDefault();
                closeRenameTagsModal();
            }
        });
    }
    if (renameTagsContainer) {
        renameTagsContainer.addEventListener('click', (event) => {
            const target = event.target.closest('button[data-remove-rename-tag]');
            if (!target) {
                return;
            }
            removeRenameExtraTag(target.getAttribute('data-remove-rename-tag'));
        });
    }
    if (renameTagsModal) {
        renameTagsModal.addEventListener('click', (event) => {
            if (event.target === renameTagsModal) {
                closeRenameTagsModal();
            }
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
    const generatorDefinition = payload && typeof payload === 'object' ? payload.generator_definition : null;

    if (!deck) {
        showError('Deck details are unavailable.');
        return;
    }
    currentDeck = deck;
    const behaviorType = String(deck.behavior_type || '').trim().toLowerCase();
    const isTypeIV = behaviorType === 'type_iv';

    deckMeta.classList.remove('hidden');
    deckIdText.textContent = String(deck.deck_id || deckId);
    deckNameText.textContent = String(deck.name || '');
    deckTagsText.innerHTML = renderTags(
        Array.isArray(deck.tags) ? deck.tags : [],
        Array.isArray(deck.tag_labels) ? deck.tag_labels : [],
    );
    if (deckBehaviorText) {
        deckBehaviorText.textContent = formatBehaviorType(behaviorType);
    }
    deckCreatedAtText.textContent = formatIsoTimestamp(deck.created_at);
    cardCountText.textContent = String(cardCount);
    if (editorSectionTitle) {
        editorSectionTitle.textContent = isTypeIV ? 'Generator Definition' : 'Edit Cards';
    }
    if (staticDeckEditor) {
        staticDeckEditor.classList.toggle('hidden', isTypeIV);
    }
    if (type4DeckEditor) {
        type4DeckEditor.classList.toggle('hidden', !isTypeIV);
    }
    if (isTypeIV) {
        const representativeLabel = cards.length > 0 ? String(cards[0].front || '').trim() : '';
        if (type4RepresentativeLabelText) {
            type4RepresentativeLabelText.textContent = representativeLabel || '-';
        }
        if (type4GeneratorCodeText) {
            type4GeneratorCodeText.textContent = String(generatorDefinition && generatorDefinition.code ? generatorDefinition.code : '');
        }
    }

    if (cards.length === 0) {
        cardsTableBody.innerHTML = '';
        tableWrap.classList.add('hidden');
        emptyState.classList.remove('hidden');
        return;
    }

    emptyState.classList.add('hidden');
    tableWrap.classList.remove('hidden');
    cardsTableBody.innerHTML = cards.map((card, index) => {
        const actionHtml = isTypeIV
            ? '<span class="muted">Immutable</span>'
            : `
                    <button
                        type="button"
                        class="btn-secondary"
                        data-action="delete-card"
                        data-card-id="${Number(card.id || 0)}"
                    >Delete</button>
                `;
        return `
            <tr>
                <td>
                    ${actionHtml}
                </td>
                <td>${index + 1}</td>
                <td>${escapeHtml(card.front || '')}</td>
                <td>${escapeHtml(card.back || '-')}</td>
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
    if (renameDeckTagsBtn) {
        renameDeckTagsBtn.disabled = isMutating || isRenamingTags;
    }
    if (cardsTableBody) {
        cardsTableBody.querySelectorAll('button[data-action="delete-card"]').forEach((btn) => {
            btn.disabled = isMutating;
        });
    }
}

function setRenameBusy(isBusy) {
    isRenamingTags = Boolean(isBusy);
    if (saveRenameTagsBtn) {
        saveRenameTagsBtn.disabled = isRenamingTags;
        saveRenameTagsBtn.textContent = isRenamingTags ? 'Saving...' : 'Save Tags';
    }
    if (cancelRenameTagsBtn) {
        cancelRenameTagsBtn.disabled = isRenamingTags;
    }
    if (closeRenameTagsModalBtn) {
        closeRenameTagsModalBtn.disabled = isRenamingTags;
    }
    if (renameNewTagInput) {
        renameNewTagInput.disabled = isRenamingTags;
    }
    if (renameAddTagBtn) {
        renameAddTagBtn.disabled = isRenamingTags;
    }
    if (renameDeckTagsBtn) {
        renameDeckTagsBtn.disabled = isRenamingTags || isMutating;
    }
    if (renameTagsContainer) {
        renameTagsContainer.querySelectorAll('button[data-remove-rename-tag]').forEach((btn) => {
            btn.disabled = isRenamingTags;
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

function renderTags(tags, tagLabels = []) {
    if (!Array.isArray(tags) || tags.length === 0) {
        return '-';
    }
    return `<span class="deck-tags">${tags.map((tag, index) => {
        const normalizedTag = String(tag || '').trim();
        const parsed = deckCategoryCommon.parseDeckTagInput(tagLabels[index]);
        const text = parsed.tag === normalizedTag && parsed.label
            ? parsed.label
            : normalizedTag;
        return `<span class="deck-tag">${escapeHtml(text)}</span>`;
    }).join('')}</span>`;
}

function getCurrentDeckFirstTag() {
    const tags = Array.isArray(currentDeck && currentDeck.tags) ? currentDeck.tags : [];
    return String(tags[0] || '').trim().toLowerCase();
}

function getCurrentDeckTagLabelAt(index) {
    const tags = Array.isArray(currentDeck && currentDeck.tags) ? currentDeck.tags : [];
    const tagLabels = Array.isArray(currentDeck && currentDeck.tag_labels) ? currentDeck.tag_labels : [];
    const rawTag = String(tags[index] || '').trim().toLowerCase();
    const rawLabel = String(tagLabels[index] || '').trim();
    const parsed = deckCategoryCommon.parseDeckTagInput(rawLabel);
    if (rawTag && parsed.tag === rawTag && parsed.label) {
        return parsed.label;
    }
    return rawTag;
}

function getCurrentDeckSecondaryTagConfigs() {
    const tags = Array.isArray(currentDeck && currentDeck.tags) ? currentDeck.tags : [];
    const seen = new Set();
    return tags.slice(1).map((tag, index) => {
        const normalizedTag = String(tag || '').trim().toLowerCase();
        const parsed = deckCategoryCommon.parseDeckTagInput(getCurrentDeckTagLabelAt(index + 1));
        const resolvedTag = normalizedTag || parsed.tag;
        if (!resolvedTag || seen.has(resolvedTag)) {
            return null;
        }
        seen.add(resolvedTag);
        return {
            tag: resolvedTag,
            comment: parsed.tag === resolvedTag ? parsed.comment : '',
        };
    }).filter(Boolean);
}

function getCurrentDeckSecondaryTagLabels() {
    return getCurrentDeckSecondaryTagConfigs().map((item) => (
        deckCategoryCommon.formatDeckTagLabel(item.tag, item.comment)
    ));
}

function buildRenameTagPayload() {
    const firstTag = getCurrentDeckFirstTag();
    if (!firstTag) {
        throw new Error('Deck is missing its first tag.');
    }
    const seen = new Set([firstTag]);
    const tags = [firstTag];
    const extraTagLabels = [];

    renameExtraTags.forEach((item) => {
        const parsed = deckCategoryCommon.parseDeckTagInput(
            deckCategoryCommon.formatDeckTagLabel(item && item.tag, item && item.comment)
        );
        if (!parsed.tag || seen.has(parsed.tag)) {
            return;
        }
        seen.add(parsed.tag);
        tags.push(parsed.tag);
        extraTagLabels.push(parsed.label || parsed.tag);
    });

    if (tags.length < 2) {
        throw new Error('Add at least one extra tag to build a deck path.');
    }
    return {
        tags,
        extraTagLabels,
        generatedName: tags.join('_'),
    };
}

function hasEnoughRenameTags() {
    return renameExtraTags.length > 0;
}

function addRenameExtraTag(rawTag) {
    const firstTag = getCurrentDeckFirstTag();
    const parsed = deckCategoryCommon.parseDeckTagInput(rawTag);
    if (!parsed.tag) {
        throw new Error('Enter a valid tag.');
    }
    if (parsed.tag === firstTag) {
        throw new Error('The category tag is already locked.');
    }
    if (renameExtraTags.some((item) => item.tag === parsed.tag)) {
        throw new Error('That tag is already added.');
    }
    renameExtraTags.push({
        tag: parsed.tag,
        comment: parsed.comment,
    });
}

function addRenameExtraTagFromInput() {
    if (!renameNewTagInput) {
        return;
    }
    try {
        addRenameExtraTag(renameNewTagInput.value);
        renameNewTagInput.value = '';
        renderRenameExtraTags();
        updateRenameTagsPreview();
        showRenameTagsError('');
    } catch (error) {
        showRenameTagsError(error.message || 'Invalid tag.');
    }
    renameNewTagInput.focus();
}

function removeRenameExtraTag(tag) {
    renameExtraTags = renameExtraTags.filter((item) => item.tag !== String(tag || '').trim().toLowerCase());
    renderRenameExtraTags();
    updateRenameTagsPreview();
}

function renderRenameExtraTags() {
    if (!renameTagsContainer) {
        return;
    }
    if (renameExtraTags.length === 0) {
        renameTagsContainer.innerHTML = '<span class="rename-tags-empty">No additional tags yet.</span>';
        return;
    }
    renameTagsContainer.innerHTML = renameExtraTags.map((item) => {
        const label = deckCategoryCommon.formatDeckTagLabel(item.tag, item.comment);
        const tag = String(item.tag || '').trim();
        return `
            <span class="deck-tag">
                ${escapeHtml(label)}
                <button
                    type="button"
                    class="rename-tag-remove-btn"
                    data-remove-rename-tag="${escapeHtml(tag)}"
                    aria-label="Remove ${escapeHtml(label)}"
                >✕</button>
            </span>
        `;
    }).join('');
}

function isRenameConfigUnchanged(payload) {
    const currentLabels = getCurrentDeckSecondaryTagLabels();
    const nextLabels = Array.isArray(payload && payload.extraTagLabels) ? payload.extraTagLabels : [];
    if (currentLabels.length !== nextLabels.length) {
        return false;
    }
    return currentLabels.every((value, index) => value === nextLabels[index]);
}

function openRenameTagsModal() {
    if (!currentDeck || !renameTagsModal) {
        return;
    }
    renameExtraTags = getCurrentDeckSecondaryTagConfigs();
    if (renameFixedFirstTag) {
        renameFixedFirstTag.textContent = getCurrentDeckFirstTag() || '-';
    }
    if (renameNewTagInput) {
        renameNewTagInput.value = '';
    }
    renderRenameExtraTags();
    showRenameTagsError('');
    updateRenameTagsPreview();
    renameTagsModal.classList.remove('hidden');
    renameTagsModal.setAttribute('aria-hidden', 'false');
    document.body.classList.add('modal-open');
    window.setTimeout(() => {
        renameNewTagInput?.focus();
    }, 0);
}

function closeRenameTagsModal(force = false) {
    if (!renameTagsModal || (isRenamingTags && !force)) {
        return;
    }
    renameTagsModal.classList.add('hidden');
    renameTagsModal.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('modal-open');
    showRenameTagsError('');
    if (renameNameCheckTimer) {
        window.clearTimeout(renameNameCheckTimer);
        renameNameCheckTimer = null;
    }
}

function updateRenameTagsPreview() {
    if (!renameDeckNamePreview || !renameTagsMessage || !renameNameStatus) {
        return;
    }
    try {
        const parsed = buildRenameTagPayload();
        renameDeckNamePreview.textContent = parsed.generatedName || '(auto)';
        if (isRenameConfigUnchanged(parsed)) {
            renameTagsMessage.textContent = 'No tag change yet.';
        } else {
            renameTagsMessage.textContent = 'Save to update this shared deck and every materialized copy.';
        }
        showRenameTagsError('');
        scheduleRenameNameAvailabilityCheck();
    } catch (error) {
        renameDeckNamePreview.textContent = '(invalid)';
        renameTagsMessage.textContent = '';
        renameNameAvailable = false;
        renameLastNameChecked = '';
        setRenameNameStatus('Add at least one extra tag to build a deck path.', 'note');
        showRenameTagsError('');
    }
}

function showRenameTagsError(message) {
    if (!renameTagsError) {
        return;
    }
    const text = String(message || '').trim();
    if (!text) {
        renameTagsError.textContent = '';
        renameTagsError.classList.add('hidden');
        return;
    }
    renameTagsError.textContent = text;
    renameTagsError.classList.remove('hidden');
}

function setRenameNameStatus(text, state) {
    if (!renameNameStatus) {
        return;
    }
    renameNameStatus.textContent = String(text || '').trim();
    renameNameStatus.classList.remove('ok', 'error', 'note');
    renameNameStatus.classList.add(state);
}

function buildRenameNameAvailabilityQueryParams(payload) {
    const params = new URLSearchParams();
    if (payload && Array.isArray(payload.tags) && payload.tags.length > 0) {
        params.set('firstTag', payload.tags[0]);
    }
    if (payload && Array.isArray(payload.extraTagLabels)) {
        payload.extraTagLabels.forEach((label) => {
            params.append('extraTag', String(label || '').trim());
        });
    }
    if (payload && payload.generatedName) {
        params.set('name', String(payload.generatedName));
    }
    if (deckId > 0) {
        params.set('excludeDeckId', String(deckId));
    }
    return params;
}

function scheduleRenameNameAvailabilityCheck() {
    renameNameAvailable = null;
    renameLastNameChecked = '';
    if (renameNameCheckTimer) {
        window.clearTimeout(renameNameCheckTimer);
    }
    if (!hasEnoughRenameTags()) {
        setRenameNameStatus('Add at least one extra tag to build a deck path.', 'note');
        return;
    }
    setRenameNameStatus('Checking name availability...', 'note');
    renameNameCheckTimer = window.setTimeout(() => {
        renameNameCheckTimer = null;
        void checkRenameNameAvailability();
    }, 180);
}

async function ensureRenameNameAvailable() {
    if (!hasEnoughRenameTags()) {
        renameNameAvailable = false;
        renameLastNameChecked = '';
        setRenameNameStatus('Add at least one extra tag to build a deck path.', 'note');
        return false;
    }
    const currentName = buildRenameTagPayload().generatedName;
    if (renameNameAvailable !== null && renameLastNameChecked === currentName) {
        return renameNameAvailable;
    }
    await checkRenameNameAvailability();
    return renameNameAvailable === true;
}

async function checkRenameNameAvailability() {
    let payload;
    try {
        payload = buildRenameTagPayload();
    } catch (error) {
        renameNameAvailable = false;
        renameLastNameChecked = '';
        setRenameNameStatus('Add at least one extra tag to build a deck path.', 'note');
        return;
    }

    const token = ++renameNameCheckToken;
    try {
        const params = buildRenameNameAvailabilityQueryParams(payload);
        const response = await fetch(`${API_BASE}/shared-decks/name-availability?${params.toString()}`);
        const result = await response.json().catch(() => ({}));
        if (token !== renameNameCheckToken) {
            return;
        }
        if (!response.ok) {
            throw new Error(result.error || `Failed to check name (HTTP ${response.status})`);
        }
        renameNameAvailable = Boolean(result.available);
        renameLastNameChecked = payload.generatedName;
        if (renameNameAvailable) {
            setRenameNameStatus('Name available.', 'ok');
        } else if (result && result.conflict_type === 'tag_prefix_conflict') {
            setRenameNameStatus(
                `Tag path conflicts with existing path ${result.conflict_tags ? `[${result.conflict_tags.join(', ')}]` : ''}.`,
                'error',
            );
        } else {
            setRenameNameStatus('Name already exists. Please change tags.', 'error');
        }
    } catch (error) {
        if (token !== renameNameCheckToken) {
            return;
        }
        console.error('Error checking rename name availability:', error);
        renameNameAvailable = null;
        renameLastNameChecked = '';
        setRenameNameStatus('Could not verify name right now.', 'error');
    }
}

async function saveRenamedTags() {
    if (!currentDeck || isRenamingTags) {
        return;
    }
    showError('');
    showSuccess('');

    let parsed;
    try {
        parsed = buildRenameTagPayload();
    } catch (error) {
        showRenameTagsError(error.message || 'Invalid tag path.');
        return;
    }
    const available = await ensureRenameNameAvailable();
    if (!available) {
        showRenameTagsError('Deck tags are not available. Fix the tag path and try again.');
        return;
    }

    setRenameBusy(true);
    try {
        const response = await fetch(`${API_BASE}/shared-decks/${deckId}/tags`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ extraTags: parsed.extraTagLabels }),
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok) {
            throw new Error(result.error || `Failed to rename tags (HTTP ${response.status})`);
        }
        closeRenameTagsModal(true);
        showSuccess(
            `Tags updated. Synced ${Number(result.updated_deck_count || 0)} materialized deck(s) across ${Number(result.updated_kid_count || 0)} kid DB(s).`
        );
        await loadDeck();
    } catch (error) {
        console.error('Error renaming deck tags:', error);
        showRenameTagsError(error.message || 'Failed to rename deck tags.');
    } finally {
        setRenameBusy(false);
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

function formatBehaviorType(value) {
    const normalized = String(value || '').trim().toLowerCase();
    if (normalized === 'type_i') {
        return 'Type I';
    }
    if (normalized === 'type_ii') {
        return 'Type II';
    }
    if (normalized === 'type_iii') {
        return 'Type III';
    }
        if (normalized === 'type_iv') {
            return 'Generator';
        }
    return normalized || '-';
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
