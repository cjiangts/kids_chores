const API_BASE = `${window.location.origin}/api`;

const tableWrap = document.getElementById('tableWrap');
const emptyState = document.getElementById('emptyState');
const deckTableBody = document.getElementById('deckTableBody');
const createDeckNavBtn = document.getElementById('createDeckNavBtn');
const createDeckBulkNavBtn = document.getElementById('createDeckBulkNavBtn');
const errorMessage = document.getElementById('errorMessage');
const deckCategoryFilterWrap = document.getElementById('deckCategoryFilterWrap');
const deckTagFilterInput = document.getElementById('deckTagFilter');
const deleteSelectedBtn = document.getElementById('deleteSelectedBtn');

const DECK_RENDER_CHUNK_SIZE = 20;
const deckCategoryCommon = window.DeckCategoryCommon;
if (!deckCategoryCommon) {
    throw new Error('deck-category-common.js is required for deck-manage');
}

let allDecks = [];
let currentFilteredDeckIds = [];
let currentFilteredDecks = [];
let renderedDeckCount = 0;
let isBulkDeleting = false;
let deckCategoryMetaByKey = {};
let deckCategoryOrder = [];
let selectedCategoryFilterKey = localStorage.getItem('deckManage_selectedCategory') || '';
let secondaryTagFilterController = null;

document.addEventListener('DOMContentLoaded', async () => {
    const allowed = await ensureSuperFamily();
    if (!allowed) {
        return;
    }
    createDeckNavBtn.addEventListener('click', () => {
        window.location.href = buildCreateDeckUrl('/deck-create.html');
    });
    if (createDeckBulkNavBtn) {
        createDeckBulkNavBtn.addEventListener('click', () => {
            window.location.href = buildCreateDeckUrl('/deck-create-bulk.html');
        });
    }

    if (deleteSelectedBtn) {
        deleteSelectedBtn.addEventListener('click', async () => {
            await deleteShownDecks();
        });
    }
    if (tableWrap) {
        tableWrap.addEventListener('scroll', handleTableScroll);
    }
    if (deckCategoryFilterWrap) {
        deckCategoryFilterWrap.addEventListener('click', (event) => {
            const manageButton = event.target.closest('[data-category-action="manage-category"]');
            if (manageButton) {
                window.location.href = '/deck-category-create.html';
                return;
            }
            const button = event.target.closest('[data-category-filter-key]');
            if (!button) {
                return;
            }
            const nextKey = normalizeCategoryKey(button.getAttribute('data-category-filter-key'));
            if (nextKey === selectedCategoryFilterKey) {
                return;
            }
            selectedCategoryFilterKey = nextKey;
            localStorage.setItem('deckManage_selectedCategory', nextKey);
            renderDecks();
        });
    }
    updateBulkSelectionUi();
    await loadDeckCategoryMeta();
    await loadMyDecks();
    updateCreateActionButtons();
});

function buildCreateDeckUrl(path) {
    const url = new URL(String(path || '/deck-create.html'), window.location.origin);
    const categoryKey = normalizeCategoryKey(selectedCategoryFilterKey);
    if (categoryKey) {
        url.searchParams.set('categoryKey', categoryKey);
    }
    return `${url.pathname}${url.search}`;
}

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
        renderDecks();
    } catch (error) {
        console.error('Error loading shared decks:', error);
        allDecks = [];
        renderDecks();
        showError(error.message || 'Failed to load decks.');
    }
}

function normalizeCategoryKey(value) {
    return String(value || '').trim().toLowerCase();
}

async function loadDeckCategoryMeta() {
    try {
        const response = await fetch(`${API_BASE}/shared-decks/categories`);
        const result = await response.json().catch(() => ({}));
        if (!response.ok) {
            throw new Error(result.error || `Failed to load categories (HTTP ${response.status})`);
        }
        const categories = Array.isArray(result.categories) ? result.categories : [];
        const next = {};
        const nextOrder = [];
        categories.forEach((item) => {
            const key = normalizeCategoryKey(item && item.category_key);
            if (!key) {
                return;
            }
            nextOrder.push(key);
            next[key] = {
                display_name: String(item && item.display_name ? item.display_name : '').trim(),
                emoji: String(item && item.emoji ? item.emoji : '').trim(),
                behavior_type: deckCategoryCommon.normalizeBehaviorType(item && item.behavior_type),
                has_chinese_specific_logic: Boolean(item && item.has_chinese_specific_logic),
                is_shared_with_non_super_family: Boolean(item && item.is_shared_with_non_super_family),
            };
        });
        deckCategoryMetaByKey = next;
        deckCategoryOrder = nextOrder;
    } catch (error) {
        console.error('Error loading deck categories for manage table:', error);
        deckCategoryMetaByKey = {};
        deckCategoryOrder = [];
    }
}

function getDeckTags(deck) {
    return Array.isArray(deck && deck.tags)
        ? deck.tags.map((tag) => String(tag || '').trim().toLowerCase()).filter(Boolean)
        : [];
}

function getDeckPrimaryCategoryKey(deck) {
    const tags = getDeckTags(deck);
    return normalizeCategoryKey(tags[0]);
}

function getDeckSecondaryTags(deck) {
    const tags = getDeckTags(deck);
    return tags.slice(1);
}

function getDeckSecondaryTagLabels(deck) {
    const secondaryTagKeys = getDeckSecondaryTags(deck);
    const rawLabels = Array.isArray(deck && deck.tag_labels) ? deck.tag_labels.slice(1) : [];
    return secondaryTagKeys.map((tagKey, index) => {
        const parsed = deckCategoryCommon.parseDeckTagInput(rawLabels[index]);
        if (parsed.tag === tagKey && parsed.label) {
            return parsed.label;
        }
        return tagKey;
    });
}

function getCategoryLabel(categoryKey) {
    const key = normalizeCategoryKey(categoryKey);
    if (!key) {
        return '';
    }
    const meta = deckCategoryMetaByKey[key];
    const displayName = String(meta && meta.display_name ? meta.display_name : '').trim();
    return displayName || key;
}

function isSelectedCategoryTypeIV() {
    const meta = deckCategoryMetaByKey[normalizeCategoryKey(selectedCategoryFilterKey)] || null;
    return String(meta && meta.behavior_type ? meta.behavior_type : '').trim().toLowerCase() === 'type_iv';
}

function updateCreateActionButtons() {
    if (!createDeckBulkNavBtn) {
        return;
    }
    const disableBulk = isSelectedCategoryTypeIV();
    createDeckBulkNavBtn.disabled = disableBulk;
    createDeckBulkNavBtn.title = disableBulk
        ? 'Bulk create is not available for generator decks.'
        : '';
}

function getCategorySortWeight(categoryKey) {
    const key = normalizeCategoryKey(categoryKey);
    const orderIndex = deckCategoryOrder.indexOf(key);
    if (orderIndex >= 0) {
        return orderIndex;
    }
    return Number.MAX_SAFE_INTEGER;
}

function getCategoryFilterItems() {
    const countsByKey = {};
    allDecks.forEach((deck) => {
        const categoryKey = getDeckPrimaryCategoryKey(deck);
        if (!categoryKey) {
            return;
        }
        countsByKey[categoryKey] = (countsByKey[categoryKey] || 0) + 1;
    });

    const allKeysSet = new Set([
        ...Object.keys(deckCategoryMetaByKey),
        ...Object.keys(countsByKey),
    ]);
    const allKeys = Array.from(allKeysSet);
    allKeys.sort((a, b) => {
        const weightA = getCategorySortWeight(a);
        const weightB = getCategorySortWeight(b);
        if (weightA !== weightB) {
            return weightA - weightB;
        }
        return a.localeCompare(b);
    });

    return allKeys.map((categoryKey) => {
        const meta = deckCategoryMetaByKey[categoryKey] || null;
        const count = Number.isFinite(countsByKey[categoryKey]) ? countsByKey[categoryKey] : 0;
        const title = deckCategoryCommon.getCategoryCardTitle(categoryKey, meta || {});
        const description = deckCategoryCommon.getCategoryCardDescription(meta || {}, count);
        return {
            key: categoryKey,
            title,
            description,
            count,
        };
    });
}

function renderCategoryFilters() {
    if (!deckCategoryFilterWrap) {
        return;
    }

    const categoryItems = getCategoryFilterItems();
    const manageCategoryButtonHtml = `
        <button
            type="button"
            class="deck-category-filter-btn deck-category-manage-btn"
            data-category-action="manage-category"
            aria-label="Manage deck category"
        >
            <span class="deck-category-filter-title">
                <span class="deck-category-filter-plus" aria-hidden="true">+</span>
                Manage Deck Category
            </span>
            <span class="deck-category-filter-desc">Create and configure deck categories.</span>
        </button>
    `;
    if (categoryItems.length === 0) {
        selectedCategoryFilterKey = '';
        deckCategoryFilterWrap.innerHTML = manageCategoryButtonHtml;
        updateCreateActionButtons();
        return;
    }
    const validKeys = new Set(categoryItems.map((item) => item.key));
    if (!selectedCategoryFilterKey || !validKeys.has(selectedCategoryFilterKey)) {
        selectedCategoryFilterKey = categoryItems[0].key;
    }
    const categoryButtonsHtml = categoryItems.map((item) => `
        <button
            type="button"
            class="deck-category-filter-btn${item.key === selectedCategoryFilterKey ? ' active' : ''}"
            data-category-filter-key="${escapeHtml(item.key)}"
            aria-pressed="${item.key === selectedCategoryFilterKey ? 'true' : 'false'}"
        >
            <span class="deck-category-filter-title">${escapeHtml(item.title)}</span>
            <span class="deck-category-filter-desc">${escapeHtml(item.description)}</span>
        </button>
    `).join('');

    deckCategoryFilterWrap.innerHTML = `${categoryButtonsHtml}${manageCategoryButtonHtml}`;
    updateCreateActionButtons();
}

function getDecksByCategoryFilter() {
    return allDecks.filter((deck) => getDeckPrimaryCategoryKey(deck) === selectedCategoryFilterKey);
}

function ensureSecondaryTagFilterController() {
    if (secondaryTagFilterController) {
        return secondaryTagFilterController;
    }

    if (!window.PracticeManageCommon || typeof window.PracticeManageCommon.createHierarchicalTagFilterController !== 'function') {
        secondaryTagFilterController = {
            sync: () => {},
            matchesDeck: () => true,
            getDisplayLabel: () => '',
        };
        return secondaryTagFilterController;
    }

    secondaryTagFilterController = window.PracticeManageCommon.createHierarchicalTagFilterController({
        selectEl: deckTagFilterInput,
        getDecks: getDecksByCategoryFilter,
        getDeckTags: getDeckSecondaryTags,
        onFilterChanged: () => {
            renderDecks();
        },
    });
    return secondaryTagFilterController;
}

function matchesSecondaryTagFilter(deck) {
    return ensureSecondaryTagFilterController().matchesDeck(deck);
}

function buildDeckEmptyStateMessage() {
    const categoryLabel = getCategoryLabel(selectedCategoryFilterKey);
    const secondaryFilterLabel = ensureSecondaryTagFilterController().getDisplayLabel();
    if (selectedCategoryFilterKey && secondaryFilterLabel) {
        return `No decks in "${categoryLabel}" match secondary tag "${secondaryFilterLabel}".`;
    }
    if (selectedCategoryFilterKey) {
        return `No decks in "${categoryLabel}".`;
    }
    return 'No decks match the selected filters.';
}

function renderDecks() {
    renderCategoryFilters();
    ensureSecondaryTagFilterController().sync();

    if (!Array.isArray(allDecks) || allDecks.length === 0) {
        currentFilteredDecks = [];
        renderedDeckCount = 0;
        currentFilteredDeckIds = [];
        deckTableBody.innerHTML = '';
        tableWrap.classList.add('hidden');
        emptyState.textContent = 'No decks yet. Create your first one.';
        emptyState.classList.remove('hidden');
        updateBulkSelectionUi();
        return;
    }

    const decksByCategory = getDecksByCategoryFilter();
    const filteredDecks = decksByCategory.filter(matchesSecondaryTagFilter);
    currentFilteredDecks = filteredDecks;
    currentFilteredDeckIds = filteredDecks
        .map((deck) => Number(deck.deck_id || 0))
        .filter((deckId) => deckId > 0);
    if (filteredDecks.length === 0) {
        renderedDeckCount = 0;
        deckTableBody.innerHTML = '';
        tableWrap.classList.add('hidden');
        emptyState.textContent = buildDeckEmptyStateMessage();
        emptyState.classList.remove('hidden');
        updateBulkSelectionUi();
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
}

function renderDeckRowHtml(deck) {
    const deckId = Number(deck.deck_id || 0);
    const cardCount = Number(deck.card_count || 0);
    const singleCardFront = String(deck && deck.single_card_front ? deck.single_card_front : '').trim();
    const remainingTags = getDeckSecondaryTagLabels(deck);
    const tagHtml = remainingTags.length > 0
        ? `<div class="deck-tags">${remainingTags.map((tag) => `<span class="deck-tag">${escapeHtml(tag)}</span>`).join('')}</div>`
        : '-';
    const cardsCellHtml = cardCount === 1 && singleCardFront
        ? `<div class="deck-single-front">${escapeHtml(singleCardFront)}</div>`
        : String(cardCount);
    return `
        <tr>
            <td class="shared-report-table-action-cell">
                <a class="tab-link secondary mini-link-btn table-action-btn" href="/deck-view.html?deckId=${encodeURIComponent(String(deckId))}">View</a>
            </td>
            <td class="deck-id-col">${deckId}</td>
            <td class="deck-tags-col">${tagHtml}</td>
            <td class="deck-cards-col">${cardsCellHtml}</td>
        </tr>
    `;
}

function appendNextDeckChunk() {
    const total = currentFilteredDecks.length;
    if (renderedDeckCount >= total) {
        return false;
    }

    const nextDecks = currentFilteredDecks.slice(renderedDeckCount, renderedDeckCount + DECK_RENDER_CHUNK_SIZE);
    if (nextDecks.length === 0) {
        return false;
    }
    deckTableBody.insertAdjacentHTML('beforeend', nextDecks.map(renderDeckRowHtml).join(''));
    renderedDeckCount += nextDecks.length;
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

function updateBulkSelectionUi() {
    const shownCount = currentFilteredDeckIds.length;

    if (deleteSelectedBtn) {
        deleteSelectedBtn.disabled = shownCount === 0 || isBulkDeleting;
        deleteSelectedBtn.textContent = isBulkDeleting
            ? 'Deleting...'
            : `Delete Shown (${shownCount})`;
    }
}

async function deleteShownDecks() {
    if (isBulkDeleting) {
        return;
    }
    const targets = currentFilteredDeckIds.slice();
    if (targets.length === 0) {
        return;
    }

    const confirmed = window.confirm(`Delete ${targets.length} shown deck(s)? This cannot be undone.`);
    if (!confirmed) {
        return;
    }

    isBulkDeleting = true;
    updateBulkSelectionUi();
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
