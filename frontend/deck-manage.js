const API_BASE = `${window.location.origin}/api`;

const tableWrap = document.getElementById('tableWrap');
const emptyState = document.getElementById('emptyState');
const deckTableBody = document.getElementById('deckTableBody');
const createDeckNavBtn = document.getElementById('createDeckNavBtn');
const createDeckBulkNavBtn = document.getElementById('createDeckBulkNavBtn');
const errorMessage = document.getElementById('errorMessage');
const deckTagFilterInput = document.getElementById('deckTagFilter');
const selectAllVisibleCheckbox = document.getElementById('selectAllVisibleCheckbox');
const deleteSelectedBtn = document.getElementById('deleteSelectedBtn');

let allDecks = [];
let deckTagFilterController = null;
let currentFilteredDeckIds = [];
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

    ensureDeckTagFilterController().sync();
    updateBulkSelectionUi();
    syncSelectAllVisibleCheckbox();
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
        currentFilteredDeckIds = [];
        deckTableBody.innerHTML = '';
        tableWrap.classList.add('hidden');
        emptyState.textContent = 'No decks yet. Create your first one.';
        emptyState.classList.remove('hidden');
        updateBulkSelectionUi();
        syncSelectAllVisibleCheckbox();
        return;
    }

    const filteredDecks = allDecks.filter(matchesDeckTagFilter);
    currentFilteredDeckIds = filteredDecks
        .map((deck) => Number(deck.deck_id || 0))
        .filter((deckId) => deckId > 0);
    if (filteredDecks.length === 0) {
        const filterLabel = ensureDeckTagFilterController().getDisplayLabel();
        deckTableBody.innerHTML = '';
        tableWrap.classList.add('hidden');
        emptyState.textContent = filterLabel
            ? `No decks match tag "${filterLabel}".`
            : 'No decks match the selected tag filter.';
        emptyState.classList.remove('hidden');
        updateBulkSelectionUi();
        syncSelectAllVisibleCheckbox();
        return;
    }

    emptyState.classList.add('hidden');
    tableWrap.classList.remove('hidden');

    deckTableBody.innerHTML = filteredDecks.map((deck) => {
        const tags = Array.isArray(deck.tags) ? deck.tags : [];
        const tagHtml = tags.length > 0
            ? `<div class="deck-tags">${tags.map((tag) => `<span class="deck-tag">${escapeHtml(tag)}</span>`).join('')}</div>`
            : '-';
        return `
            <tr>
                <td>${Number(deck.deck_id || 0)}</td>
                <td>${tagHtml}</td>
                <td>${Number(deck.card_count || 0)}</td>
                <td class="shared-report-table-action-cell">
                    <a class="tab-link secondary shared-report-table-action-link" href="/deck-view.html?deckId=${encodeURIComponent(String(Number(deck.deck_id || 0)))}">View</a>
                </td>
            </tr>
        `;
    }).join('');

    updateBulkSelectionUi();
    syncSelectAllVisibleCheckbox();
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
