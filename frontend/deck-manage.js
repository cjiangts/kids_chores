const API_BASE = `${window.location.origin}/api`;

const tableWrap = document.getElementById('tableWrap');
const emptyState = document.getElementById('emptyState');
const deckTableBody = document.getElementById('deckTableBody');
const deckCountInfo = document.getElementById('deckCountInfo');
const createDeckNavBtn = document.getElementById('createDeckNavBtn');
const createDeckBulkNavBtn = document.getElementById('createDeckBulkNavBtn');
const errorMessage = document.getElementById('errorMessage');
const deckTagFilterInput = document.getElementById('deckTagFilter');
const selectAllVisibleCheckbox = document.getElementById('selectAllVisibleCheckbox');
const deleteSelectedBtn = document.getElementById('deleteSelectedBtn');

const DECK_RENDER_CHUNK_SIZE = 20;

let allDecks = [];
let deckTagFilterController = null;
let currentFilteredDeckIds = [];
let currentFilteredDecks = [];
let renderedDeckCount = 0;
let isBulkDeleting = false;

document.addEventListener('DOMContentLoaded', async () => {
    const allowed = await ensureSuperFamily();
    if (!allowed) {
        return;
    }
    createDeckNavBtn.addEventListener('click', () => {
        window.location.href = '/deck-create.html';
    });
    if (createDeckBulkNavBtn) {
        createDeckBulkNavBtn.addEventListener('click', () => {
            window.location.href = '/deck-create-bulk.html';
        });
    }

    if (selectAllVisibleCheckbox) {
        selectAllVisibleCheckbox.addEventListener('change', () => {
            toggleSelectAllVisible(selectAllVisibleCheckbox.checked);
        });
    }
    if (deleteSelectedBtn) {
        deleteSelectedBtn.addEventListener('click', async () => {
            await deleteSelectedDecks();
        });
    }
    if (tableWrap) {
        tableWrap.addEventListener('scroll', handleTableScroll);
    }

    ensureDeckTagFilterController().sync();
    updateBulkSelectionUi();
    syncSelectAllVisibleCheckbox();
    updateDeckCountInfo(0, 0);
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
        allDecks = Array.isArray(result.decks) ? result.decks : [];
        ensureDeckTagFilterController().sync();
        renderDecks();
    } catch (error) {
        console.error('Error loading shared decks:', error);
        allDecks = [];
        ensureDeckTagFilterController().sync();
        renderDecks();
        showError(error.message || 'Failed to load decks.');
    }
}

function getDeckTags(deck) {
    return Array.isArray(deck && deck.tags)
        ? deck.tags.map((tag) => String(tag || '').trim().toLowerCase()).filter(Boolean)
        : [];
}

function ensureDeckTagFilterController() {
    if (deckTagFilterController) {
        return deckTagFilterController;
    }

    if (!window.PracticeManageCommon || typeof window.PracticeManageCommon.createHierarchicalTagFilterController !== 'function') {
        deckTagFilterController = {
            sync: () => {},
            matchesDeck: () => true,
            getDisplayLabel: () => '',
        };
        return deckTagFilterController;
    }

    deckTagFilterController = window.PracticeManageCommon.createHierarchicalTagFilterController({
        selectEl: deckTagFilterInput,
        getDecks: () => allDecks,
        getDeckTags,
        onFilterChanged: () => {
            renderDecks();
        },
    });
    return deckTagFilterController;
}

function matchesDeckTagFilter(deck) {
    return ensureDeckTagFilterController().matchesDeck(deck);
}

function renderDecks() {
    if (!Array.isArray(allDecks) || allDecks.length === 0) {
        currentFilteredDecks = [];
        renderedDeckCount = 0;
        currentFilteredDeckIds = [];
        deckTableBody.innerHTML = '';
        tableWrap.classList.add('hidden');
        emptyState.textContent = 'No decks yet. Create your first one.';
        emptyState.classList.remove('hidden');
        updateDeckCountInfo(0, 0);
        updateBulkSelectionUi();
        syncSelectAllVisibleCheckbox();
        return;
    }

    const filteredDecks = allDecks.filter(matchesDeckTagFilter);
    currentFilteredDecks = filteredDecks;
    currentFilteredDeckIds = filteredDecks
        .map((deck) => Number(deck.deck_id || 0))
        .filter((deckId) => deckId > 0);
    if (filteredDecks.length === 0) {
        renderedDeckCount = 0;
        const filterLabel = ensureDeckTagFilterController().getDisplayLabel();
        deckTableBody.innerHTML = '';
        tableWrap.classList.add('hidden');
        emptyState.textContent = filterLabel
            ? `No decks match tag "${filterLabel}".`
            : 'No decks match the selected tag filter.';
        emptyState.classList.remove('hidden');
        updateDeckCountInfo(0, 0);
        updateBulkSelectionUi();
        syncSelectAllVisibleCheckbox();
        return;
    }

    emptyState.classList.add('hidden');
    tableWrap.classList.remove('hidden');
    deckTableBody.innerHTML = '';
    renderedDeckCount = 0;
    if (tableWrap) {
        tableWrap.scrollTop = 0;
    }
    appendNextDeckChunk();
    fillTableViewport();

    updateBulkSelectionUi();
    syncSelectAllVisibleCheckbox();
}

function renderDeckRowHtml(deck) {
    const deckId = Number(deck.deck_id || 0);
    const tags = Array.isArray(deck.tags) ? deck.tags : [];
    const tagHtml = tags.length > 0
        ? `<div class="deck-tags">${tags.map((tag) => `<span class="deck-tag">${escapeHtml(tag)}</span>`).join('')}</div>`
        : '-';
    return `
        <tr>
            <td>${deckId}</td>
            <td>${tagHtml}</td>
            <td>${Number(deck.card_count || 0)}</td>
            <td class="shared-report-table-action-cell">
                <a class="tab-link secondary mini-link-btn table-action-btn" href="/deck-view.html?deckId=${encodeURIComponent(String(deckId))}">View</a>
            </td>
        </tr>
    `;
}

function appendNextDeckChunk() {
    const total = currentFilteredDecks.length;
    if (renderedDeckCount >= total) {
        updateDeckCountInfo(total, total);
        return false;
    }

    const nextDecks = currentFilteredDecks.slice(renderedDeckCount, renderedDeckCount + DECK_RENDER_CHUNK_SIZE);
    if (nextDecks.length === 0) {
        updateDeckCountInfo(total, renderedDeckCount);
        return false;
    }
    deckTableBody.insertAdjacentHTML('beforeend', nextDecks.map(renderDeckRowHtml).join(''));
    renderedDeckCount += nextDecks.length;
    updateDeckCountInfo(total, renderedDeckCount);
    return true;
}

function fillTableViewport() {
    if (!tableWrap) {
        return;
    }
    let guard = 0;
    while (
        renderedDeckCount < currentFilteredDecks.length
        && tableWrap.scrollHeight <= tableWrap.clientHeight + 16
        && guard < 20
    ) {
        if (!appendNextDeckChunk()) {
            break;
        }
        guard += 1;
    }
}

function handleTableScroll() {
    if (!tableWrap || tableWrap.classList.contains('hidden')) {
        return;
    }
    if (renderedDeckCount >= currentFilteredDecks.length) {
        return;
    }
    const thresholdPx = 140;
    const reachedBottom = tableWrap.scrollTop + tableWrap.clientHeight >= tableWrap.scrollHeight - thresholdPx;
    if (reachedBottom) {
        appendNextDeckChunk();
    }
}

function updateDeckCountInfo(total, shown) {
    if (!deckCountInfo) {
        return;
    }
    const safeTotal = Number.isFinite(total) ? Math.max(0, Math.trunc(total)) : 0;
    const safeShown = Number.isFinite(shown) ? Math.max(0, Math.min(Math.trunc(shown), safeTotal)) : 0;
    deckCountInfo.textContent = `Showing ${safeShown} of ${safeTotal} deck(s)`;
}

function toggleSelectAllVisible(checked) {
    if (isBulkDeleting) {
        return;
    }
    updateBulkSelectionUi();
    syncSelectAllVisibleCheckbox();
}

function syncSelectAllVisibleCheckbox() {
    if (!selectAllVisibleCheckbox) {
        return;
    }
    const visibleCount = currentFilteredDeckIds.length;
    selectAllVisibleCheckbox.disabled = visibleCount === 0 || isBulkDeleting;
    if (visibleCount === 0) {
        selectAllVisibleCheckbox.checked = false;
    }
    selectAllVisibleCheckbox.indeterminate = false;
}

function updateBulkSelectionUi() {
    const allVisibleSelected = Boolean(selectAllVisibleCheckbox && selectAllVisibleCheckbox.checked);
    const selectedCount = allVisibleSelected ? currentFilteredDeckIds.length : 0;

    if (deleteSelectedBtn) {
        deleteSelectedBtn.disabled = selectedCount === 0 || isBulkDeleting;
        deleteSelectedBtn.textContent = isBulkDeleting
            ? 'Deleting...'
            : `Delete Selected (${selectedCount})`;
    }
}

async function deleteSelectedDecks() {
    if (isBulkDeleting) {
        return;
    }
    const allVisibleSelected = Boolean(selectAllVisibleCheckbox && selectAllVisibleCheckbox.checked);
    const targets = allVisibleSelected ? currentFilteredDeckIds.slice() : [];
    if (targets.length === 0) {
        return;
    }

    const confirmed = window.confirm(`Delete ${targets.length} selected deck(s)? This cannot be undone.`);
    if (!confirmed) {
        return;
    }

    isBulkDeleting = true;
    updateBulkSelectionUi();
    syncSelectAllVisibleCheckbox();
    showError('');

    const failures = [];
    try {
        for (const deckId of targets) {
            try {
                const response = await fetch(`${API_BASE}/shared-decks/${deckId}`, {
                    method: 'DELETE',
                });
                const result = await response.json().catch(() => ({}));
                if (!response.ok) {
                    throw new Error(result.error || `Delete failed (HTTP ${response.status})`);
                }
            } catch (error) {
                failures.push({
                    deckId,
                    message: String(error.message || 'Delete failed'),
                });
            }
        }
    } finally {
        isBulkDeleting = false;
    }

    await loadMyDecks();

    if (failures.length > 0) {
        const summary = failures
            .slice(0, 2)
            .map((item) => `#${item.deckId}: ${item.message}`)
            .join(' | ');
        const extraCount = failures.length > 2 ? ` (+${failures.length - 2} more)` : '';
        showError(`${failures.length} deck(s) failed to delete. ${summary}${extraCount}`);
        renderDecks();
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

function escapeHtml(value) {
    const div = document.createElement('div');
    div.textContent = String(value ?? '');
    return div.innerHTML;
}
