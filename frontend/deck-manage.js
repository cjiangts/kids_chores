const API_BASE = `${window.location.origin}/api`;

const emptyState = document.getElementById('emptyState');
const createDeckNavBtn = document.getElementById('createDeckNavBtn');
const createDeckBulkNavBtn = document.getElementById('createDeckBulkNavBtn');
const errorMessage = document.getElementById('errorMessage');
const deckCategoryFilterWrap = document.getElementById('deckCategoryFilterWrap');
const deckTreeToolbar = document.getElementById('deckTreeToolbar');
const deckTreeSearchInput = document.getElementById('deckTreeSearchInput');
const deckTreeToolbarActions = document.getElementById('deckTreeToolbarActions');
const deckTreeExpandAllBtn = document.getElementById('deckTreeExpandAllBtn');
const deckTreeCollapseAllBtn = document.getElementById('deckTreeCollapseAllBtn');
const deckTreeContainer = document.getElementById('deckTreeContainer');

const deckCategoryCommon = window.DeckCategoryCommon;
if (!deckCategoryCommon) {
    throw new Error('deck-category-common.js is required for deck-manage');
}

let allDecks = [];
let deckCategoryMetaByKey = {};
let deckCategoryOrder = [];
let selectedCategoryFilterKey = localStorage.getItem('deckManage_selectedCategory') || '';
let treeExpandedPaths = null;
let currentTreeBranchPathKeys = [];

document.addEventListener('DOMContentLoaded', async () => {
    const allowed = await ensureSuperFamily();
    if (!allowed) {
        return;
    }

    if (createDeckNavBtn) {
        createDeckNavBtn.addEventListener('click', () => {
            window.location.href = buildCreateDeckUrl('/deck-create.html');
        });
    }

    if (createDeckBulkNavBtn) {
        createDeckBulkNavBtn.addEventListener('click', () => {
            window.location.href = buildCreateDeckUrl('/deck-create-bulk.html');
        });
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
            treeExpandedPaths = null;
            renderDecks();
        });
    }

    if (deckTreeContainer) {
        deckTreeContainer.addEventListener('click', handleTreeContainerClick);
    }

    if (deckTreeSearchInput) {
        deckTreeSearchInput.addEventListener('input', () => {
            applyDeckTreeSearch(deckTreeSearchInput.value);
        });
    }

    if (deckTreeExpandAllBtn) {
        deckTreeExpandAllBtn.addEventListener('click', expandAllBranches);
    }

    if (deckTreeCollapseAllBtn) {
        deckTreeCollapseAllBtn.addEventListener('click', collapseAllBranches);
    }

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
        console.error('Error loading deck categories for manage tree:', error);
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
        ? 'Bulk create is not available for Type IV decks.'
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
        localStorage.removeItem('deckManage_selectedCategory');
        deckCategoryFilterWrap.innerHTML = manageCategoryButtonHtml;
        updateCreateActionButtons();
        return;
    }

    const validKeys = new Set(categoryItems.map((item) => item.key));
    if (!selectedCategoryFilterKey || !validKeys.has(selectedCategoryFilterKey)) {
        selectedCategoryFilterKey = categoryItems[0].key;
        localStorage.setItem('deckManage_selectedCategory', selectedCategoryFilterKey);
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
    if (!selectedCategoryFilterKey) {
        return allDecks.filter((deck) => !getDeckPrimaryCategoryKey(deck));
    }
    return allDecks.filter((deck) => getDeckPrimaryCategoryKey(deck) === selectedCategoryFilterKey);
}

function buildDeckEmptyStateMessage() {
    const categoryLabel = getCategoryLabel(selectedCategoryFilterKey);
    if (selectedCategoryFilterKey) {
        return `No decks in "${categoryLabel}" yet.`;
    }
    return 'No decks yet. Create your first one.';
}

function getDeckCardCount(deck) {
    return Number.isFinite(Number(deck && deck.card_count)) ? Number(deck.card_count) : 0;
}

function formatCount(value, singular, plural) {
    const count = Number.isFinite(Number(value)) ? Number(value) : 0;
    return `${count} ${count === 1 ? singular : plural}`;
}

function normalizeCompareText(value) {
    return String(value || '').trim().toLowerCase().replace(/[\s_]+/g, ' ');
}

function stripCategoryPrefixFromDeckName(name) {
    const text = String(name || '').trim();
    if (!text) {
        return '';
    }
    const categoryKey = normalizeCategoryKey(selectedCategoryFilterKey);
    if (!categoryKey) {
        return text;
    }
    if (normalizeCategoryKey(text) === categoryKey) {
        return '';
    }
    const lowerText = text.toLowerCase();
    const prefix = `${categoryKey}_`;
    if (lowerText.startsWith(prefix)) {
        return text.slice(prefix.length);
    }
    return text;
}

function getDeckLeafLabel(deck) {
    const singleCardFront = String(deck && deck.single_card_front ? deck.single_card_front : '').trim();
    const strippedName = stripCategoryPrefixFromDeckName(deck && deck.name);
    const secondaryLabels = getDeckSecondaryTagLabels(deck);
    const fullPathLabel = secondaryLabels.join(' / ');

    if (secondaryLabels.length > 0) {
        const lastLabel = secondaryLabels[secondaryLabels.length - 1];
        if (strippedName && normalizeCompareText(strippedName) !== normalizeCompareText(fullPathLabel)) {
            return strippedName;
        }
        return lastLabel;
    }

    if (strippedName) {
        return strippedName;
    }

    if (singleCardFront) {
        return singleCardFront;
    }

    const deckId = Number(deck && deck.deck_id);
    return deckId > 0 ? `Deck ${deckId}` : 'Deck';
}

function buildDeckTree(decks) {
    const root = {
        tag: null,
        label: null,
        pathKey: '',
        children: new Map(),
        decks: [],
    };

    decks.forEach((deck) => {
        const pathTags = getDeckSecondaryTags(deck);
        const pathLabels = getDeckSecondaryTagLabels(deck);

        if (pathTags.length === 0) {
            root.decks.push(deck);
            return;
        }

        let node = root;
        const pathParts = [];
        pathTags.forEach((tag, index) => {
            const tagKey = String(tag || '').trim().toLowerCase();
            if (!tagKey) {
                return;
            }

            pathParts.push(tagKey);
            if (!node.children.has(tagKey)) {
                node.children.set(tagKey, {
                    tag: tagKey,
                    label: String(pathLabels[index] || tagKey).trim(),
                    pathKey: pathParts.join('__'),
                    children: new Map(),
                    decks: [],
                });
            }

            node = node.children.get(tagKey);
        });

        node.decks.push(deck);
    });

    return root;
}

function sortTreeChildren(node) {
    return Array.from(node.children.values()).sort((a, b) => {
        const labelA = String(a.label || a.tag || '');
        const labelB = String(b.label || b.tag || '');
        return labelA.localeCompare(labelB, undefined, { numeric: true, sensitivity: 'base' });
    });
}

function sortTreeDecks(decks) {
    return [...decks].sort((a, b) => {
        const labelA = getDeckLeafLabel(a);
        const labelB = getDeckLeafLabel(b);
        const labelCompare = labelA.localeCompare(labelB, undefined, { numeric: true, sensitivity: 'base' });
        if (labelCompare !== 0) {
            return labelCompare;
        }
        return Number(a && a.deck_id ? a.deck_id : 0) - Number(b && b.deck_id ? b.deck_id : 0);
    });
}

function getTreeNodeStats(node) {
    let deckCount = node.decks.length;
    let cardCount = node.decks.reduce((sum, deck) => sum + getDeckCardCount(deck), 0);

    node.children.forEach((child) => {
        const childStats = getTreeNodeStats(child);
        deckCount += childStats.deckCount;
        cardCount += childStats.cardCount;
    });

    return { deckCount, cardCount };
}

function getAllBranchPathKeys(node) {
    const keys = [];
    sortTreeChildren(node).forEach((child) => {
        if (child.pathKey) {
            keys.push(child.pathKey);
        }
        keys.push(...getAllBranchPathKeys(child));
    });
    return keys;
}

function renderDeckLeafRow(deck, labelOverride = '') {
    const deckId = Number(deck && deck.deck_id ? deck.deck_id : 0);
    if (!(deckId > 0)) {
        return '';
    }

    const mainLabel = String(labelOverride || getDeckLeafLabel(deck) || `Deck ${deckId}`).trim();
    const metaParts = [];
    if (Boolean(deck && deck.has_print_cell_design)) {
        metaParts.push('<span class="deck-tree-printable-emoji" role="img" aria-label="Printable deck" title="Printable deck">🖨️</span>');
    }
    metaParts.push(escapeHtml(formatCount(getDeckCardCount(deck), 'card', 'cards')));

    return `
        <div class="deck-tree-node deck-tree-leaf" data-tree-deck-id="${deckId}">
            <div class="deck-tree-row">
                <span class="deck-tree-toggle leaf-spacer" aria-hidden="true"></span>
                <div class="deck-tree-row-body deck-tree-branch-body">
                    <span class="deck-tree-copy">
                        <span class="deck-tree-label">${escapeHtml(mainLabel)}</span>
                    </span>
                    <span class="deck-tree-row-meta">
                        ${metaParts.join(' ')}
                        <span class="deck-tree-leaf-actions">
                            ${isSelectedCategoryTypeIV() ? '' : `<button type="button" class="deck-tree-leaf-btn" data-leaf-action="preview" data-deck-id="${deckId}">Preview</button>`}
                            <button type="button" class="deck-tree-leaf-btn" data-leaf-action="edit" data-deck-id="${deckId}">Edit</button>
                        </span>
                    </span>
                </div>
            </div>
        </div>
    `;
}

function renderDeckTreeNode(node, depth) {
    const hasChildren = node.children.size > 0;
    const hasDecks = node.decks.length > 0;
    if (!hasChildren && !hasDecks) {
        return '';
    }

    if (node.tag !== null && !hasChildren && node.decks.length === 1) {
        return renderDeckLeafRow(node.decks[0], node.label || node.tag);
    }

    const childHtml = sortTreeChildren(node).map((child) => renderDeckTreeNode(child, depth + 1)).join('');
    const deckHtml = sortTreeDecks(node.decks).map((deck) => renderDeckLeafRow(deck)).join('');

    if (node.tag === null) {
        return `${childHtml}${deckHtml}`;
    }

    const stats = getTreeNodeStats(node);
    const deckCountText = formatCount(stats.deckCount, 'deck', 'decks');
    const cardCountText = formatCount(stats.cardCount, 'card', 'cards');
    const isExpanded = isTreeNodeExpanded(node.pathKey, depth);

    return `
        <div class="deck-tree-node" data-tree-path="${escapeHtml(node.pathKey)}">
            <div class="deck-tree-row">
                <button
                    type="button"
                    class="deck-tree-toggle${isExpanded ? ' expanded' : ''}"
                    aria-label="${isExpanded ? 'Collapse' : 'Expand'}"
                >
                    &#9654;
                </button>
                <div
                    class="deck-tree-row-body deck-tree-branch-body"
                    data-tree-action="branch"
                    data-tree-path="${escapeHtml(node.pathKey)}"
                    aria-expanded="${isExpanded ? 'true' : 'false'}"
                >
                    <span class="deck-tree-copy">
                        <span class="deck-tree-label deck-tree-label-tag">${escapeHtml(node.label || node.tag)}</span>
                    </span>
                    <span class="deck-tree-row-meta">${escapeHtml(`${deckCountText} · ${cardCountText}`)}</span>
                </div>
            </div>
            <div class="deck-tree-children${isExpanded ? '' : ' collapsed'}">
                ${childHtml}${deckHtml}
            </div>
        </div>
    `;
}

function captureTreeExpandState() {
    if (!deckTreeContainer) {
        return;
    }

    const expanded = new Set();
    const branchNodes = deckTreeContainer.querySelectorAll('.deck-tree-node[data-tree-path]');
    if (branchNodes.length === 0) {
        return;
    }

    branchNodes.forEach((nodeEl) => {
        const pathKey = nodeEl.getAttribute('data-tree-path');
        const childrenEl = nodeEl.querySelector(':scope > .deck-tree-children');
        if (pathKey && childrenEl && !childrenEl.classList.contains('collapsed')) {
            expanded.add(pathKey);
        }
    });
    treeExpandedPaths = expanded;
    updateDeckTreeExpandButtons();
}

function isTreeNodeExpanded(pathKey, depth) {
    if (treeExpandedPaths === null) {
        return false;
    }
    return treeExpandedPaths.has(pathKey);
}

function areAllBranchesExpanded() {
    if (!Array.isArray(currentTreeBranchPathKeys) || currentTreeBranchPathKeys.length === 0) {
        return false;
    }
    if (!(treeExpandedPaths instanceof Set)) {
        return false;
    }
    return currentTreeBranchPathKeys.every((pathKey) => treeExpandedPaths.has(pathKey));
}

function hasAnyExpandedBranches() {
    return treeExpandedPaths instanceof Set && treeExpandedPaths.size > 0;
}

function updateDeckTreeExpandButtons() {
    if (!deckTreeToolbarActions && !deckTreeExpandAllBtn && !deckTreeCollapseAllBtn) {
        return;
    }

    const hasBranches = Array.isArray(currentTreeBranchPathKeys) && currentTreeBranchPathKeys.length > 0;
    if (deckTreeToolbarActions) {
        deckTreeToolbarActions.classList.toggle('hidden', !hasBranches);
    }
    if (deckTreeExpandAllBtn) {
        deckTreeExpandAllBtn.disabled = !hasBranches || areAllBranchesExpanded();
    }
    if (deckTreeCollapseAllBtn) {
        deckTreeCollapseAllBtn.disabled = !hasBranches || !hasAnyExpandedBranches();
    }
}

function renderDeckTree(decks) {
    if (!deckTreeContainer) {
        return;
    }

    const tree = buildDeckTree(decks);
    currentTreeBranchPathKeys = getAllBranchPathKeys(tree);
    deckTreeContainer.innerHTML = renderDeckTreeNode(tree, 0);
    updateDeckTreeExpandButtons();

    if (deckTreeSearchInput && deckTreeSearchInput.value.trim()) {
        applyDeckTreeSearch(deckTreeSearchInput.value);
    }
}

function renderDecks() {
    renderCategoryFilters();

    if (!Array.isArray(allDecks) || allDecks.length === 0) {
        if (deckTreeToolbar) {
            deckTreeToolbar.classList.add('hidden');
        }
        if (deckTreeContainer) {
            deckTreeContainer.classList.add('hidden');
            deckTreeContainer.innerHTML = '';
        }
        currentTreeBranchPathKeys = [];
        updateDeckTreeExpandButtons();
        emptyState.textContent = 'No decks yet. Create your first one.';
        emptyState.classList.remove('hidden');
        return;
    }

    const decksByCategory = getDecksByCategoryFilter();
    if (decksByCategory.length === 0) {
        if (deckTreeToolbar) {
            deckTreeToolbar.classList.add('hidden');
        }
        if (deckTreeContainer) {
            deckTreeContainer.classList.add('hidden');
            deckTreeContainer.innerHTML = '';
        }
        currentTreeBranchPathKeys = [];
        updateDeckTreeExpandButtons();
        emptyState.textContent = buildDeckEmptyStateMessage();
        emptyState.classList.remove('hidden');
        return;
    }

    emptyState.classList.add('hidden');
    if (deckTreeToolbar) {
        deckTreeToolbar.classList.remove('hidden');
    }
    if (deckTreeContainer) {
        deckTreeContainer.classList.remove('hidden');
    }
    renderDeckTree(decksByCategory);
}

function expandAllBranches() {
    if (!Array.isArray(currentTreeBranchPathKeys) || currentTreeBranchPathKeys.length === 0) {
        return;
    }
    treeExpandedPaths = new Set(currentTreeBranchPathKeys);
    renderDeckTree(getDecksByCategoryFilter());
}

function collapseAllBranches() {
    if (!Array.isArray(currentTreeBranchPathKeys) || currentTreeBranchPathKeys.length === 0) {
        return;
    }
    treeExpandedPaths = new Set();
    renderDeckTree(getDecksByCategoryFilter());
}

function toggleTreeNodeExpanded(nodeEl, forceExpanded = null) {
    if (!nodeEl) {
        return;
    }

    const childrenEl = nodeEl.querySelector(':scope > .deck-tree-children');
    if (!childrenEl) {
        return;
    }

    const currentExpanded = !childrenEl.classList.contains('collapsed');
    const nextExpanded = forceExpanded === null ? !currentExpanded : Boolean(forceExpanded);
    const toggleBtn = nodeEl.querySelector(':scope > .deck-tree-row > .deck-tree-toggle');
    const branchBtn = nodeEl.querySelector(':scope > .deck-tree-row > [data-tree-action="branch"]');

    childrenEl.classList.toggle('collapsed', !nextExpanded);
    if (toggleBtn) {
        toggleBtn.classList.toggle('expanded', nextExpanded);
        toggleBtn.setAttribute('aria-label', nextExpanded ? 'Collapse' : 'Expand');
    }
    if (branchBtn) {
        branchBtn.setAttribute('aria-expanded', nextExpanded ? 'true' : 'false');
    }

    captureTreeExpandState();
}

function handleTreeContainerClick(event) {
    const toggleBtn = event.target.closest('.deck-tree-toggle:not(.leaf-spacer)');
    if (toggleBtn) {
        const nodeEl = toggleBtn.closest('.deck-tree-node[data-tree-path]');
        toggleTreeNodeExpanded(nodeEl);
        return;
    }

    const leafBtn = event.target.closest('[data-leaf-action]');
    if (leafBtn) {
        const action = leafBtn.getAttribute('data-leaf-action');
        const deckId = Number(leafBtn.getAttribute('data-deck-id') || 0);
        if (!(deckId > 0)) return;
        if (action === 'edit') {
            window.location.href = `/deck-view.html?deckId=${encodeURIComponent(String(deckId))}`;
        } else if (action === 'preview') {
            void toggleLeafPreview(deckId, leafBtn);
        }
        return;
    }
}

const leafPreviewCache = {};

async function toggleLeafPreview(deckId, btn) {
    const leafNode = btn.closest('.deck-tree-leaf');
    if (!leafNode) return;

    const existing = leafNode.querySelector('.deck-tree-preview-pills, .deck-tree-preview-loading');
    if (existing) {
        existing.remove();
        return;
    }

    if (leafPreviewCache[deckId]) {
        renderLeafPreviewPills(leafNode, leafPreviewCache[deckId]);
        return;
    }

    const loadingEl = document.createElement('div');
    loadingEl.className = 'deck-tree-preview-loading';
    loadingEl.textContent = 'Loading...';
    leafNode.appendChild(loadingEl);

    try {
        const response = await fetch(`${API_BASE}/shared-decks/${deckId}`);
        const result = await response.json().catch(() => ({}));
        if (!response.ok) {
            throw new Error(result.error || 'Failed to load');
        }
        const cards = Array.isArray(result.cards) ? result.cards : [];
        const fronts = cards.map((c) => String(c.front || '').trim()).filter(Boolean);
        leafPreviewCache[deckId] = fronts;

        const stillLoading = leafNode.querySelector('.deck-tree-preview-loading');
        if (stillLoading) stillLoading.remove();

        renderLeafPreviewPills(leafNode, fronts);
    } catch (error) {
        console.error('Error loading deck preview:', error);
        const stillLoading = leafNode.querySelector('.deck-tree-preview-loading');
        if (stillLoading) {
            stillLoading.textContent = 'Failed to load preview.';
            setTimeout(() => stillLoading.remove(), 2000);
        }
    }
}

function renderLeafPreviewPills(leafNode, fronts) {
    if (!fronts || fronts.length === 0) {
        const emptyEl = document.createElement('div');
        emptyEl.className = 'deck-tree-preview-loading';
        emptyEl.textContent = 'No cards in this deck.';
        leafNode.appendChild(emptyEl);
        return;
    }
    const container = document.createElement('div');
    container.className = 'deck-tree-preview-pills';
    fronts.forEach((front) => {
        const pill = document.createElement('span');
        pill.className = 'deck-tree-preview-pill';
        pill.textContent = front;
        pill.title = front;
        container.appendChild(pill);
    });
    leafNode.appendChild(container);
}

function applyDeckTreeSearch(query) {
    if (!deckTreeContainer) {
        return;
    }

    const q = String(query || '').trim().toLowerCase();
    const allNodes = deckTreeContainer.querySelectorAll('.deck-tree-node');

    if (!q) {
        allNodes.forEach((node) => node.classList.remove('search-hidden'));
        return;
    }

    allNodes.forEach((node) => node.classList.add('search-hidden'));

    function expandChildList(childListEl) {
        if (!childListEl || !childListEl.classList.contains('collapsed')) {
            return;
        }
        childListEl.classList.remove('collapsed');
        const branchNode = childListEl.parentElement;
        if (!branchNode) {
            return;
        }
        const toggleBtn = branchNode.querySelector(':scope > .deck-tree-row > .deck-tree-toggle');
        const branchBtn = branchNode.querySelector(':scope > .deck-tree-row > [data-tree-action="branch"]');
        if (toggleBtn) {
            toggleBtn.classList.add('expanded');
            toggleBtn.setAttribute('aria-label', 'Collapse');
        }
        if (branchBtn) {
            branchBtn.setAttribute('aria-expanded', 'true');
        }
    }

    function showNodeAndAncestors(node) {
        node.classList.remove('search-hidden');
        let parent = node.parentElement;
        while (parent && parent !== deckTreeContainer) {
            if (parent.classList.contains('deck-tree-node')) {
                parent.classList.remove('search-hidden');
            }
            if (parent.classList.contains('deck-tree-children')) {
                expandChildList(parent);
            }
            parent = parent.parentElement;
        }
    }

    function showAllDescendants(node) {
        node.querySelectorAll('.deck-tree-node').forEach((child) => {
            child.classList.remove('search-hidden');
        });
        node.querySelectorAll('.deck-tree-children').forEach((childList) => {
            expandChildList(childList);
        });
    }

    deckTreeContainer.querySelectorAll('.deck-tree-leaf').forEach((leaf) => {
        const text = leaf.textContent.toLowerCase();
        if (text.includes(q)) {
            showNodeAndAncestors(leaf);
        }
    });

    deckTreeContainer.querySelectorAll('.deck-tree-node[data-tree-path]').forEach((branch) => {
        const branchBody = branch.querySelector(':scope > .deck-tree-row > .deck-tree-row-body');
        const text = branchBody ? branchBody.textContent.toLowerCase() : '';
        if (text.includes(q)) {
            showNodeAndAncestors(branch);
            showAllDescendants(branch);
        }
    });

    captureTreeExpandState();
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
