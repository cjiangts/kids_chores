// Deck setup: opt-in summary, deck-tag helpers, source-name resolution, opt-in/opt-out APIs, and tree-view modal.
function getDeckById(deckId) {
    return allDecks.find((deck) => Number(deck.deck_id) === Number(deckId)) || null;
}

function getOptedDecks() {
    return allDecks.filter((deck) => stagedOptedDeckIdSet.has(Number(deck.deck_id)));
}

function renderDeckSetupSummary() {
    renderDeckSetupActionButtons();
    renderType4DeckTargetControls();
}

function renderDeckSetupActionButtons() {
    const totalDecks = (Array.isArray(allDecks) ? allDecks : []).length;
    const optedCount = stagedOptedDeckIdSet.size + (Boolean(orphanDeck) && stagedIncludeOrphanInQueue ? 1 : 0);
    if (openDeckOptInModalBtn) {
        const optInMeta = `${optedCount} / ${totalDecks + (orphanDeck ? 1 : 0)} decks opted in`;
        openDeckOptInModalBtn.innerHTML = `
            <span class="manage-popup-btn-text">
                <span class="manage-popup-btn-emoji" aria-hidden="true">${icon('layers', { size: 24 })}</span>
                <span class="manage-popup-btn-title">Manage Deck Opt-in</span>
                <span class="manage-popup-btn-meta">${escapeHtml(optInMeta)}</span>
            </span>
            <span class="manage-popup-btn-chevron" aria-hidden="true">›</span>
        `;
    }
    if (openPersonalDeckModalBtn) {
        openPersonalDeckModalBtn.innerHTML = `
            <span class="manage-popup-btn-text">
                <span class="manage-popup-btn-emoji" aria-hidden="true">${icon('pencil', { size: 24 })}</span>
                <span class="manage-popup-btn-title">Personal Deck Editor</span>
                <span class="manage-popup-btn-meta">Add your own cards</span>
            </span>
            <span class="manage-popup-btn-chevron" aria-hidden="true">›</span>
        `;
    }
}

function hasPendingDeckChanges() {
    if (stagedIncludeOrphanInQueue !== baselineIncludeOrphanInQueue) {
        return true;
    }
    if (stagedOptedDeckIdSet.size !== baselineOptedDeckIdSet.size) {
        return true;
    }
    for (const deckId of stagedOptedDeckIdSet) {
        if (!baselineOptedDeckIdSet.has(deckId)) {
            return true;
        }
    }
    return false;
}

function renderDeckPendingInfo() {
    renderDeckSetupSummary();
}


function getDeckTags(deck) {
    return Array.isArray(deck.tags)
        ? deck.tags
            .map((tag) => parseDeckTagInput(tag).tag)
            .filter(Boolean)
        : [];
}

function getDeckTagLabels(deck) {
    const keys = getDeckTags(deck);
    const rawLabels = Array.isArray(deck && deck.tag_labels) ? deck.tag_labels : [];
    return keys.map((tagKey, index) => {
        const parsedLabel = parseDeckTagInput(rawLabels[index]);
        if (parsedLabel.tag === tagKey && parsedLabel.label) {
            return parsedLabel.label;
        }
        return tagKey;
    });
}

function stripCategoryFirstTagFromName(name) {
    const text = String(name || '').trim();
    if (!text) {
        return '';
    }
    if (text === categoryKey) {
        return '';
    }
    const prefix = `${categoryKey}_`;
    if (text.startsWith(prefix)) {
        return text.slice(prefix.length);
    }
    return text;
}

function getType1DeckBubbleLabel(deck) {
    if (currentBehaviorType === BEHAVIOR_TYPE_TYPE_IV) {
        const tags = getDeckTags(deck);
        const tagTail = tags.length > 1 && tags[0] === categoryKey
            ? tags.slice(1).join('_')
            : '';
        const representativeFront = String(deck && deck.representative_front ? deck.representative_front : '').trim();
        if (tagTail && representativeFront) {
            return `${tagTail} · ${representativeFront}`;
        }
        if (tagTail) {
            return tagTail;
        }
        if (representativeFront) {
            return representativeFront;
        }
    }
    const tags = getDeckTags(deck);
    if (tags.length > 1 && tags[0] === categoryKey) {
        return tags.slice(1).join('_');
    }
    const stripped = stripCategoryFirstTagFromName(deck && deck.name);
    return stripped || String(deck && deck.name ? deck.name : '');
}

function getDeckBubbleSuffix(deck) {
    if (currentBehaviorType === BEHAVIOR_TYPE_TYPE_IV) {
        return '';
    }
    return ` · ${Number(deck && deck.card_count ? deck.card_count : 0)} cards`;
}

function getPersonalDeckDisplayName() {
    return 'Personal Deck';
}

function resolveCardSourceDeckName(card) {
    const raw = String(card?.source_deck_label || card?.source_deck_name || '').trim();
    const normalized = raw.toLowerCase().replace(/[\s_]+/g, '');
    if (
        Boolean(card?.source_is_orphan)
        || normalized === 'orphan'
        || normalized === 'orphandeck'
        || normalized === 'personaldeck'
        || normalized === 'personaldecks'
    ) {
        return getPersonalDeckDisplayName();
    }
    return raw || '-';
}

function hasDeckCountMismatchWarning(deck) {
    if (!SHOW_DECK_COUNT_MISMATCH_WARNING) {
        return false;
    }
    if (!deck || !deck.opted_in) {
        return false;
    }
    return Boolean(deck.has_update_warning);
}

function getDeckCountMismatchWarningText(deck) {
    const reason = String(deck && deck.update_warning_reason ? deck.update_warning_reason : '').trim().toLowerCase();
    if (reason === 'source_deleted' || Boolean(deck && deck.source_deleted)) {
        return 'Shared source deck was deleted; local copy may be outdated.';
    }
    const sharedCount = Number.parseInt(deck && deck.shared_card_count, 10);
    const materializedCount = Number.parseInt(deck && deck.materialized_card_count, 10);
    if (!Number.isInteger(sharedCount) || !Number.isInteger(materializedCount)) {
        return 'Shared deck changed since last opt-in (count mismatch).';
    }
    return `Shared deck changed (${sharedCount} shared vs ${materializedCount} local).`;
}

function clearDeckSelectionMessages() {
    showError('');
    showSuccess('');
    showDeckChangeMessage('');
}

async function refreshDeckSelectionViews() {
    renderDeckPendingInfo();
    await loadSharedDeckCards();
}

async function requestOptInDeckIds(deckIds) {
    const body = { deck_ids: deckIds, categoryKey };
    const response = await fetch(buildSharedDeckApiUrl('shared-decks/opt-in'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
        throw new Error(result.error || `Failed to opt in decks (HTTP ${response.status})`);
    }
    return result;
}

async function requestOptOutDeckIds(deckIds) {
    const body = { deck_ids: deckIds, categoryKey };
    const response = await fetch(buildSharedDeckApiUrl('shared-decks/opt-out'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
        throw new Error(result.error || `Failed to opt out decks (HTTP ${response.status})`);
    }
    return result;
}

/* ── Tree-view deck opt-in (tap-to-select, no checkboxes) ── */

let treeOptedDeckIdSet = new Set();
let treeIncludeOrphan = false;
let treeExpandedTags = null; // null = use default; Set = persisted state

function buildDeckTree() {
    const root = { tag: null, label: null, children: new Map(), decks: [] };
    const decks = Array.isArray(allDecks) ? allDecks : [];

    decks.forEach((deck) => {
        const tags = getDeckTags(deck);
        const labels = getDeckTagLabels(deck);
        if (tags.length === 0) {
            root.decks.push(deck);
            return;
        }
        const pathTags = tags[0] === categoryKey ? tags.slice(1) : tags;
        const pathLabels = tags[0] === categoryKey ? labels.slice(1) : labels;
        if (pathTags.length === 0) {
            root.decks.push(deck);
            return;
        }
        let node = root;
        pathTags.forEach((tag, index) => {
            if (!node.children.has(tag)) {
                node.children.set(tag, {
                    tag,
                    label: pathLabels[index] || tag,
                    children: new Map(),
                    decks: [],
                });
            }
            node = node.children.get(tag);
        });
        node.decks.push(deck);
    });
    return root;
}

function getAllDeckIdsUnder(node) {
    const ids = [];
    node.decks.forEach((deck) => {
        const deckId = Number(deck.deck_id);
        if (deckId > 0) {
            ids.push(deckId);
        }
    });
    for (const child of node.children.values()) {
        ids.push(...getAllDeckIdsUnder(child));
    }
    return ids;
}

function getTreeNodeSelectionState(node) {
    const allIds = getAllDeckIdsUnder(node);
    if (allIds.length === 0) {
        return 'none';
    }
    const selectedCount = allIds.filter((id) => treeOptedDeckIdSet.has(id)).length;
    if (selectedCount === 0) {
        return 'none';
    }
    if (selectedCount === allIds.length) {
        return 'all';
    }
    return 'some';
}

function getDeckPendingBadgeHtml(deckId) {
    const id = Number(deckId);
    const wasOptedIn = baselineOptedDeckIdSet.has(id);
    const isNowOptedIn = treeOptedDeckIdSet.has(id);
    if (wasOptedIn === isNowOptedIn) {
        return '';
    }
    if (isNowOptedIn) {
        return '<span class="deck-tree-badge opt-in">+ opt-in</span>';
    }
    return '<span class="deck-tree-badge opt-out">- opt-out</span>';
}

function getBranchPendingBadgesHtml(allIds) {
    let optInCount = 0;
    let optOutCount = 0;
    allIds.forEach((id) => {
        const wasIn = baselineOptedDeckIdSet.has(id);
        const nowIn = treeOptedDeckIdSet.has(id);
        if (wasIn !== nowIn) {
            if (nowIn) {
                optInCount += 1;
            } else {
                optOutCount += 1;
            }
        }
    });
    let html = '';
    if (optInCount > 0) {
        html += `<span class="deck-tree-badge opt-in">+${optInCount}</span>`;
    }
    if (optOutCount > 0) {
        html += `<span class="deck-tree-badge opt-out">-${optOutCount}</span>`;
    }
    return html;
}

function renderDeckTreeNode(node, depth) {
    const hasChildren = node.children.size > 0;
    const hasDecks = node.decks.length > 0;
    if (!hasChildren && !hasDecks) {
        return '';
    }
    let html = '';

    // Merged leaf: a branch with exactly 1 deck and no sub-branches → render as single leaf row
    if (node.tag !== null && !hasChildren && node.decks.length === 1) {
        const deck = node.decks[0];
        const deckId = Number(deck.deck_id);
        const isSelected = treeOptedDeckIdSet.has(deckId);
        const suffix = getDeckBubbleSuffix(deck);

        const rowClasses = ['deck-tree-row'];
        if (isSelected) {
            rowClasses.push('selected');
        }

        html += `<div class="deck-tree-node deck-tree-leaf" data-tree-deck-id="${deckId}">`;
        html += `<div class="${rowClasses.join(' ')}">`;
        html += `<span class="deck-tree-toggle leaf-spacer"></span>`;
        html += `<div class="deck-tree-row-body" data-tree-action="leaf" data-tree-deck-id="${deckId}">`;
        html += `<span class="deck-tree-label">${escapeHtml(node.label || node.tag)}${escapeHtml(suffix)}</span>`;
        html += getDeckPendingBadgeHtml(deckId);
        if (isSelected) {
            html += `<span class="deck-tree-check">&#10003;</span>`;
        }
        html += `</div>`;
        html += `</div>`;
        html += `</div>`;
        return html;
    }

    if (node.tag !== null) {
        const allIds = getAllDeckIdsUnder(node);
        const selState = getTreeNodeSelectionState(node);
        const totalCount = allIds.length;
        const selectedCount = allIds.filter((id) => treeOptedDeckIdSet.has(id)).length;
        const isExpanded = isTreeNodeExpanded(node.tag, depth);

        const rowClasses = ['deck-tree-row'];
        if (selState === 'all') {
            rowClasses.push('selected');
        } else if (selState === 'some') {
            rowClasses.push('partial');
        }

        html += `<div class="deck-tree-node" data-tree-tag="${escapeHtml(node.tag)}">`;
        html += `<div class="${rowClasses.join(' ')}">`;
        html += `<button type="button" class="deck-tree-toggle${isExpanded ? ' expanded' : ''}" aria-label="Toggle">&#9654;</button>`;
        const pct = totalCount > 0 ? Math.round((selectedCount / totalCount) * 100) : 0;
        html += `<div class="deck-tree-row-body" data-tree-action="branch" data-tree-tag="${escapeHtml(node.tag)}" style="background:linear-gradient(to right, rgba(76,175,80,0.13) ${pct}%, transparent ${pct}%);">`;
        html += `<span class="deck-tree-label deck-tree-label-tag">${escapeHtml(node.label || node.tag)}</span>`;
        html += `<span class="deck-tree-meta">${selectedCount}/${totalCount}</span>`;
        html += getBranchPendingBadgesHtml(allIds);
        if (selState === 'all') {
            html += `<span class="deck-tree-check">&#10003;</span>`;
        }
        html += `</div>`;
        html += `</div>`;
        html += `<div class="deck-tree-children${isExpanded ? '' : ' collapsed'}">`;
    }

    for (const child of node.children.values()) {
        html += renderDeckTreeNode(child, depth + 1);
    }

    node.decks.forEach((deck) => {
        const deckId = Number(deck.deck_id);
        const isSelected = treeOptedDeckIdSet.has(deckId);
        const label = getType1DeckBubbleLabel(deck);
        const suffix = getDeckBubbleSuffix(deck);

        const rowClasses = ['deck-tree-row'];
        if (isSelected) {
            rowClasses.push('selected');
        }

        html += `<div class="deck-tree-node deck-tree-leaf" data-tree-deck-id="${deckId}">`;
        html += `<div class="${rowClasses.join(' ')}">`;
        html += `<span class="deck-tree-toggle leaf-spacer"></span>`;
        html += `<div class="deck-tree-row-body" data-tree-action="leaf" data-tree-deck-id="${deckId}">`;
        html += `<span class="deck-tree-label">${escapeHtml(label)}${escapeHtml(suffix)}</span>`;
        html += getDeckPendingBadgeHtml(deckId);
        if (isSelected) {
            html += `<span class="deck-tree-check">&#10003;</span>`;
        }
        html += `</div>`;
        html += `</div>`;
        html += `</div>`;
    });

    if (node.tag !== null) {
        html += `</div></div>`;
    }

    return html;
}

function getTreeTotalDeckCount() {
    const decks = Array.isArray(allDecks) ? allDecks : [];
    let count = decks.filter((d) => Number(d.deck_id) > 0).length;
    if (orphanDeck) {
        count += 1;
    }
    return count;
}

function getTreeSelectedCount() {
    let count = treeOptedDeckIdSet.size;
    if (orphanDeck && treeIncludeOrphan) {
        count += 1;
    }
    return count;
}

function captureTreeExpandState() {
    if (!deckTreeContainer) {
        return;
    }
    const expanded = new Set();
    deckTreeContainer.querySelectorAll('.deck-tree-node[data-tree-tag]').forEach((nodeEl) => {
        const tag = nodeEl.getAttribute('data-tree-tag');
        const childrenEl = nodeEl.querySelector(':scope > .deck-tree-children');
        if (childrenEl && !childrenEl.classList.contains('collapsed')) {
            expanded.add(tag);
        }
    });
    treeExpandedTags = expanded;
}

function isTreeNodeExpanded(tag, depth) {
    if (treeExpandedTags === null) {
        return depth < 2;
    }
    return treeExpandedTags.has(tag);
}

function renderDeckTree() {
    if (!deckTreeContainer) {
        return;
    }
    captureTreeExpandState();
    const tree = buildDeckTree();
    let html = '';

    // Personal deck at the top
    if (orphanDeck) {
        const isSelected = treeIncludeOrphan;
        const isPending = treeIncludeOrphan !== baselineIncludeOrphanInQueue;
        const orphanCount = Number(orphanDeck.card_count || 0);

        const rowClasses = ['deck-tree-row'];
        if (isSelected) {
            rowClasses.push('selected');
        }

        let orphanBadge = '';
        if (isPending) {
            orphanBadge = isSelected
                ? '<span class="deck-tree-badge opt-in">+ opt-in</span>'
                : '<span class="deck-tree-badge opt-out">- opt-out</span>';
        }

        html += `<div class="deck-tree-node deck-tree-leaf" data-tree-deck-id="${ORPHAN_BUBBLE_ID}">`;
        html += `<div class="${rowClasses.join(' ')}">`;
        html += `<span class="deck-tree-toggle leaf-spacer"></span>`;
        html += `<div class="deck-tree-row-body" data-tree-action="orphan">`;
        html += `<span class="deck-tree-label deck-tree-label-tag">&#11088; ${escapeHtml(getPersonalDeckDisplayName())} &middot; ${orphanCount} cards</span>`;
        html += orphanBadge;
        if (isSelected) {
            html += `<span class="deck-tree-check">&#10003;</span>`;
        }
        html += `</div>`;
        html += `</div></div>`;
    }

    html += renderDeckTreeNode(tree, 0);
    deckTreeContainer.innerHTML = html;

    updateTreeCounter();
    updateTreeApplyButton();
}

function updateTreeCounter() {
    if (!deckTreeCounter) {
        return;
    }
    deckTreeCounter.textContent = `${getTreeSelectedCount()} / ${getTreeTotalDeckCount()}`;
}

function updateTreeApplyButton() {
    if (!applyDeckTreeChangesBtn) {
        return;
    }
    const toOptIn = [...treeOptedDeckIdSet].filter((id) => !baselineOptedDeckIdSet.has(id));
    const toOptOut = [...baselineOptedDeckIdSet].filter((id) => !treeOptedDeckIdSet.has(id));
    const orphanChanged = treeIncludeOrphan !== baselineIncludeOrphanInQueue;
    const parts = [];
    if (toOptIn.length > 0) {
        parts.push(`+${toOptIn.length}`);
    }
    if (toOptOut.length > 0) {
        parts.push(`-${toOptOut.length}`);
    }
    if (orphanChanged) {
        parts.push('~1');
    }
    const hasPending = parts.length > 0;
    applyDeckTreeChangesBtn.disabled = isDeckMoveInFlight || !hasPending;
    applyDeckTreeChangesBtn.textContent = hasPending
        ? `Apply (${parts.join(' · ')})`
        : 'Apply';
}

function toggleBranchSelection(bodyEl) {
    const nodeEl = bodyEl.closest('.deck-tree-node[data-tree-tag]');
    if (!nodeEl) {
        return;
    }
    // Collect all leaf deck IDs under this specific branch node
    const leafBodies = nodeEl.querySelectorAll('[data-tree-action="leaf"][data-tree-deck-id]');
    const ids = [];
    leafBodies.forEach((body) => {
        const id = Number(body.getAttribute('data-tree-deck-id'));
        if (id > 0) {
            ids.push(id);
        }
    });
    if (ids.length === 0) {
        return;
    }
    // If all are selected, deselect all; otherwise select all
    const allSelected = ids.every((id) => treeOptedDeckIdSet.has(id));
    ids.forEach((id) => {
        if (allSelected) {
            treeOptedDeckIdSet.delete(id);
        } else {
            treeOptedDeckIdSet.add(id);
        }
    });
    renderDeckTree();
}

function toggleLeafSelection(deckId) {
    const id = Number(deckId);
    if (!(id > 0)) {
        return;
    }
    if (treeOptedDeckIdSet.has(id)) {
        treeOptedDeckIdSet.delete(id);
    } else {
        treeOptedDeckIdSet.add(id);
    }
    renderDeckTree();
}

function toggleOrphanSelection() {
    treeIncludeOrphan = !treeIncludeOrphan;
    renderDeckTree();
}

function handleTreeContainerClick(event) {
    // Handle chevron toggle
    const toggle = event.target.closest('.deck-tree-toggle:not(.leaf-spacer)');
    if (toggle) {
        const treeNode = toggle.closest('.deck-tree-node');
        if (treeNode) {
            const childrenEl = treeNode.querySelector(':scope > .deck-tree-children');
            if (childrenEl) {
                const isExpanded = !childrenEl.classList.contains('collapsed');
                childrenEl.classList.toggle('collapsed', isExpanded);
                toggle.classList.toggle('expanded', !isExpanded);
            }
        }
        return;
    }

    // Handle row body tap
    const body = event.target.closest('.deck-tree-row-body');
    if (!body) {
        return;
    }
    const action = body.getAttribute('data-tree-action');
    if (action === 'orphan') {
        toggleOrphanSelection();
    } else if (action === 'leaf') {
        toggleLeafSelection(body.getAttribute('data-tree-deck-id'));
    } else if (action === 'branch') {
        toggleBranchSelection(body);
    }
}

function applyTreeSearch(query) {
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

    function showNodeAndAncestors(node) {
        node.classList.remove('search-hidden');
        let parent = node.parentElement;
        while (parent && parent !== deckTreeContainer) {
            if (parent.classList.contains('deck-tree-node')) {
                parent.classList.remove('search-hidden');
            }
            if (parent.classList.contains('deck-tree-children') && parent.classList.contains('collapsed')) {
                parent.classList.remove('collapsed');
                const toggle = parent.previousElementSibling?.querySelector('.deck-tree-toggle');
                if (toggle) {
                    toggle.classList.add('expanded');
                }
            }
            parent = parent.parentElement;
        }
    }

    function showAllDescendants(node) {
        node.querySelectorAll('.deck-tree-node').forEach((child) => {
            child.classList.remove('search-hidden');
        });
    }

    // Match leaf nodes by their label text
    const leafNodes = deckTreeContainer.querySelectorAll('.deck-tree-leaf');
    leafNodes.forEach((leaf) => {
        const labelEl = leaf.querySelector('.deck-tree-label');
        const text = (labelEl ? labelEl.textContent : '').toLowerCase();
        if (text.includes(q)) {
            showNodeAndAncestors(leaf);
        }
    });

    // Match branch nodes by their tag label
    const branchNodes = deckTreeContainer.querySelectorAll('.deck-tree-node[data-tree-tag]');
    branchNodes.forEach((branch) => {
        const labelEl = branch.querySelector(':scope > .deck-tree-row > .deck-tree-row-body > .deck-tree-label');
        if (!labelEl) {
            return;
        }
        const text = labelEl.textContent.toLowerCase();
        if (text.includes(q)) {
            showNodeAndAncestors(branch);
            showAllDescendants(branch);
        }
    });
}

function resetTreeToBaseline() {
    treeOptedDeckIdSet = new Set(baselineOptedDeckIdSet);
    treeIncludeOrphan = baselineIncludeOrphanInQueue;
    renderDeckTree();
}

function openDeckTreeModal() {
    treeOptedDeckIdSet = new Set(stagedOptedDeckIdSet);
    treeIncludeOrphan = stagedIncludeOrphanInQueue;
    treeExpandedTags = null;
    if (deckTreeSearchInput) {
        deckTreeSearchInput.value = '';
    }
    renderDeckTree();
    setManageModalOpen(deckTreeModal, true);
}

function closeDeckTreeModal() {
    setManageModalOpen(deckTreeModal, false);
}

async function applyDeckTreeChanges() {
    if (isDeckMoveInFlight) {
        return;
    }
    stagedOptedDeckIdSet = new Set(treeOptedDeckIdSet);
    stagedIncludeOrphanInQueue = treeIncludeOrphan;
    closeDeckTreeModal();
    clearDeckSelectionMessages();
    await applyDeckMembershipChanges();
    await refreshDeckSelectionViews();
}

async function stageDeckMembershipChange(deckId, direction) {
    if (isDeckMoveInFlight) {
        return;
    }
    const deck = getDeckById(deckId);
    if (!deck) {
        return;
    }

    const shouldOptIn = direction === 'in';
    const numericDeckId = Number(deck.deck_id);
    const currentlyOptedIn = stagedOptedDeckIdSet.has(numericDeckId);
    if (shouldOptIn && currentlyOptedIn) {
        return;
    }
    if (!shouldOptIn && !currentlyOptedIn) {
        return;
    }

    if (shouldOptIn) {
        stagedOptedDeckIdSet.add(numericDeckId);
    } else {
        stagedOptedDeckIdSet.delete(numericDeckId);
    }

    clearDeckSelectionMessages();
    await refreshDeckSelectionViews();
}

async function stageOrphanInclusion(includeOrphan) {
    if (isDeckMoveInFlight) {
        return;
    }
    const nextValue = Boolean(includeOrphan);
    if (stagedIncludeOrphanInQueue === nextValue) {
        return;
    }
    stagedIncludeOrphanInQueue = nextValue;
    clearDeckSelectionMessages();
    await refreshDeckSelectionViews();
}

async function applyDeckMembershipChanges() {
    if (isDeckMoveInFlight || !hasPendingDeckChanges()) {
        return;
    }

    const toOptIn = [...stagedOptedDeckIdSet].filter((deckId) => !baselineOptedDeckIdSet.has(deckId));
    const toOptOut = [...baselineOptedDeckIdSet].filter((deckId) => !stagedOptedDeckIdSet.has(deckId));
    const orphanChanged = stagedIncludeOrphanInQueue !== baselineIncludeOrphanInQueue;

    isDeckMoveInFlight = true;
    renderDeckPendingInfo();
    showError('');
    showSuccess('');
    showDeckChangeMessage('');
    setCardsLoadingIndicatorVisible(true);
    try {
        if (toOptIn.length > 0) {
            await requestOptInDeckIds(toOptIn);
        }
        if (toOptOut.length > 0) {
            await requestOptOutDeckIds(toOptOut);
        }
        if (orphanChanged) {
            const response = await fetch(`${API_BASE}/kids/${kidId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(buildIncludeOrphanPayload(stagedIncludeOrphanInQueue)),
            });
            const result = await response.json().catch(() => ({}));
            if (!response.ok) {
                throw new Error(result.error || `Failed to update Personal Deck setting (HTTP ${response.status})`);
            }
            applyIncludeOrphanFromPayload(result);
        }
        showDeckChangeMessage('');
        await loadSharedType1Decks();
    } catch (error) {
        console.error('Error applying deck membership changes:', error);
        showDeckChangeMessage(error.message || 'Failed to apply deck changes.', true);
    } finally {
        isDeckMoveInFlight = false;
        setCardsLoadingIndicatorVisible(false);
        renderDeckPendingInfo();
    }
}
