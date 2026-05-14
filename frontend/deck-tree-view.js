/*
 * deck-tree-view.js — shared deck-tree view (window.DeckTreeView)
 *
 * Renders shared decks (and optionally a personal/orphan deck) in a hierarchical
 * tree grouped by tags. Two modes:
 *   'opt-in' – tap to toggle selection, exposes pending counts for Apply button.
 *   'browse' – read-only; checkboxes/badges hidden via container class.
 *
 * Used by kid-card-manage (opt-in modal) and admin (browse modal).
 *
 * Layout (all inside IIFE; class DeckTreeView at line ~44):
 *   1. Module-level utilities (escapeHtml, deck-tag accessors)
 *   2. constructor + public setters (setDecks/Selection/Baseline/…)
 *   3. render + expandAll / collapseAll
 *   4. Tree build + expansion state + default labels
 *   5. Node + leaf rendering (HTML builders)
 *   6. Pending-badge HTML + selection / card-count getters
 *   7. Counter / apply-button updates + branch-path collection
 *   8. Click dispatch + branch / leaf / orphan selection toggles
 *   9. Search + match preview + highlight
 */
(function () {
    'use strict';

    // =====================================================================
    // === 1. Module-level utilities (escapeHtml, deck-tag accessors)
    // =====================================================================

    const ORPHAN_BUBBLE_ID = '__orphan__';

    function escapeHtml(text) {
        return String(text == null ? '' : text)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function getDeckTagsFromDeck(deck) {
        const parser = window.DeckCategoryCommon && window.DeckCategoryCommon.parseDeckTagInput;
        return Array.isArray(deck && deck.tags)
            ? deck.tags
                .map((tag) => (parser ? parser(tag).tag : String(tag || '').trim()))
                .filter(Boolean)
            : [];
    }

    function getDeckTagLabelsFromDeck(deck) {
        const parser = window.DeckCategoryCommon && window.DeckCategoryCommon.parseDeckTagInput;
        const keys = getDeckTagsFromDeck(deck);
        const rawLabels = Array.isArray(deck && deck.tag_labels) ? deck.tag_labels : [];
        return keys.map((tagKey, index) => {
            if (!parser) return tagKey;
            const parsed = parser(rawLabels[index]);
            if (parsed.tag === tagKey && parsed.label) {
                return parsed.label;
            }
            return tagKey;
        });
    }

    // =====================================================================
    // === 2. constructor + public setters
    // =====================================================================

    class DeckTreeView {
        constructor(options) {
            const opts = options || {};
            this.container = opts.container || null;
            this.searchInput = opts.searchInput || null;
            this.counter = opts.counter || null;
            this.applyButton = opts.applyButton || null;

            this.mode = opts.mode === 'opt-in' ? 'opt-in' : 'browse';
            this.categoryKey = opts.categoryKey || '';

            this.allDecks = [];
            this.orphanDeck = null;
            this.cardIndex = null;

            this.selectedDeckIds = new Set();
            this.includeOrphan = false;
            this.baselineSelectedDeckIds = new Set();
            this.baselineIncludeOrphan = false;

            this.expandedTags = null;
            this.expandedLeafDeckIds = new Set();

            this.getDeckLabel = typeof opts.getDeckLabel === 'function'
                ? opts.getDeckLabel
                : (deck) => this._defaultDeckLabel(deck);
            this.getDeckSuffix = typeof opts.getDeckSuffix === 'function'
                ? opts.getDeckSuffix
                : (deck) => ` · ${Number((deck && deck.card_count) || 0)} cards`;
            this.getPersonalDeckName = typeof opts.getPersonalDeckName === 'function'
                ? opts.getPersonalDeckName
                : () => 'Personal Deck';

            this.onSelectionChange = typeof opts.onSelectionChange === 'function'
                ? opts.onSelectionChange
                : () => {};
            this.onApplyButtonRender = typeof opts.onApplyButtonRender === 'function'
                ? opts.onApplyButtonRender
                : null;
            this.onLeafClick = typeof opts.onLeafClick === 'function'
                ? opts.onLeafClick
                : null;
            this.onBranchEdit = typeof opts.onBranchEdit === 'function'
                ? opts.onBranchEdit
                : null;
            this.onBranchNewDeck = typeof opts.onBranchNewDeck === 'function'
                ? opts.onBranchNewDeck
                : null;

            this.applyDisabled = false;

            if (this.container) {
                this.container.classList.add('deck-tree-view');
                this.container.classList.add(`deck-tree-view--${this.mode}`);
                if (this.onLeafClick) {
                    this.container.classList.add('deck-tree-view--clickable-leaves');
                }
                this.container.addEventListener('click', (event) => this._handleClick(event));
            }
            if (this.searchInput) {
                this.searchInput.addEventListener('input', () => {
                    this._applySearch(this.searchInput.value);
                });
            }
        }

        // ── Public API ────────────────────────────────────────────────────────

        setCategoryKey(key) {
            this.categoryKey = String(key || '');
        }

        setDecks(decks, options) {
            this.allDecks = Array.isArray(decks) ? decks : [];
            const opts = options || {};
            if (Object.prototype.hasOwnProperty.call(opts, 'orphanDeck')) {
                this.orphanDeck = opts.orphanDeck || null;
            }
            this.render();
        }

        setOrphanDeck(orphanDeck) {
            this.orphanDeck = orphanDeck || null;
            this.render();
        }

        setBaseline(selectedDeckIds, includeOrphan) {
            const ids = Array.isArray(selectedDeckIds)
                ? selectedDeckIds
                : (selectedDeckIds instanceof Set ? [...selectedDeckIds] : []);
            this.baselineSelectedDeckIds = new Set(ids.map((n) => Number(n)).filter((n) => n > 0));
            this.baselineIncludeOrphan = Boolean(includeOrphan);
            this.selectedDeckIds = new Set(this.baselineSelectedDeckIds);
            this.includeOrphan = this.baselineIncludeOrphan;
        }

        setSelection(selectedDeckIds, includeOrphan) {
            const ids = Array.isArray(selectedDeckIds)
                ? selectedDeckIds
                : (selectedDeckIds instanceof Set ? [...selectedDeckIds] : []);
            this.selectedDeckIds = new Set(ids.map((n) => Number(n)).filter((n) => n > 0));
            this.includeOrphan = Boolean(includeOrphan);
        }

        setCardIndex(cards) {
            if (cards === null || cards === undefined) {
                this.cardIndex = null;
            } else {
                this.cardIndex = Array.isArray(cards) ? cards : [];
            }
            // Re-populate any expanded leaf-card lists.
            if (this.container && this.expandedLeafDeckIds.size > 0) {
                this.container.querySelectorAll('.deck-tree-leaf-cards:not(.collapsed)').forEach((el) => {
                    const id = el.getAttribute('data-leaf-deck-id') || '';
                    el.innerHTML = this._buildLeafCardListHtml(id);
                    el.dataset.populated = '1';
                });
            }
            if (this.searchInput && this.searchInput.value && this.searchInput.value.trim()) {
                this._applySearch(this.searchInput.value);
            }
        }

        setApplyDisabled(disabled) {
            this.applyDisabled = Boolean(disabled);
            this._updateApplyButton();
        }

        resetExpansion() {
            this.expandedTags = null;
            this.expandedLeafDeckIds = new Set();
        }

        clearSearchInput() {
            if (this.searchInput) {
                this.searchInput.value = '';
            }
        }

        getSelectedDeckIds() {
            return new Set(this.selectedDeckIds);
        }

        isOrphanIncluded() {
            return this.includeOrphan;
        }

        hasPendingChanges() {
            if (this.includeOrphan !== this.baselineIncludeOrphan) return true;
            if (this.selectedDeckIds.size !== this.baselineSelectedDeckIds.size) return true;
            for (const id of this.selectedDeckIds) {
                if (!this.baselineSelectedDeckIds.has(id)) return true;
            }
            return false;
        }

        resetToBaseline() {
            this.selectedDeckIds = new Set(this.baselineSelectedDeckIds);
            this.includeOrphan = this.baselineIncludeOrphan;
            this.render();
        }

        // -----------------------------------------------------------------
        // === 3. render + expandAll / collapseAll
        // -----------------------------------------------------------------

        render() {
            if (!this.container) {
                return;
            }
            this._captureExpandState();
            const tree = this._buildTree();
            let html = '';

            if (this.mode === 'opt-in' && this.orphanDeck) {
                const isSelected = this.includeOrphan;
                const isPending = this.includeOrphan !== this.baselineIncludeOrphan;
                const orphanCount = Number((this.orphanDeck && this.orphanDeck.card_count) || 0);

                const rowClasses = ['deck-tree-row'];
                if (isSelected) rowClasses.push('selected');

                let orphanBadge = '';
                if (isPending) {
                    const cls = isSelected ? 'opt-in' : 'opt-out';
                    const sign = isSelected ? '+' : '-';
                    orphanBadge = `
                        <span class="deck-tree-badge ${cls}">
                            <span class="deck-tree-badge-chunk"><span data-icon="layout-grid" data-icon-size="11" data-icon-stroke="2.4"></span>${sign}${orphanCount.toLocaleString()}</span>
                        </span>
                    `;
                }

                const orphanLabelHtml = `&#11088; ${escapeHtml(this.getPersonalDeckName())} &middot; ${orphanCount} cards`;
                html += this._renderLeafHtml(ORPHAN_BUBBLE_ID, rowClasses, `<span class="deck-tree-label-tag">${orphanLabelHtml}</span>`, {
                    action: 'orphan',
                    pendingBadge: orphanBadge,
                });
            }

            html += this._renderNode(tree, 0);
            this.container.innerHTML = html;
            if (window.hydrateIcons) {
                window.hydrateIcons(this.container);
            }

            this._updateCounter();
            this._updateApplyButton();

            if (this.searchInput && this.searchInput.value && this.searchInput.value.trim()) {
                this._applySearch(this.searchInput.value);
            }
        }

        expandAll() {
            if (!this.container) return;
            this.container.querySelectorAll('.deck-tree-children.collapsed').forEach((el) => el.classList.remove('collapsed'));
            this.container.querySelectorAll('.deck-tree-toggle').forEach((el) => el.classList.add('expanded'));
        }

        collapseAll() {
            if (!this.container) return;
            this.container.querySelectorAll('.deck-tree-children').forEach((el) => el.classList.add('collapsed'));
            this.container.querySelectorAll('.deck-tree-toggle').forEach((el) => el.classList.remove('expanded'));
            this.container.querySelectorAll('.deck-tree-leaf-cards').forEach((el) => el.classList.add('collapsed'));
            this.container.querySelectorAll('.deck-tree-leaf-toggle').forEach((el) => el.classList.remove('expanded'));
            this.expandedLeafDeckIds.clear();
        }

        // ── Tree building ─────────────────────────────────────────────────────

        // -----------------------------------------------------------------
        // === 4. Tree build + expansion state + default labels
        // -----------------------------------------------------------------

        _buildTree() {
            const root = { tag: null, label: null, children: new Map(), decks: [] };
            const decks = Array.isArray(this.allDecks) ? this.allDecks : [];
            const categoryKey = this.categoryKey;

            decks.forEach((deck) => {
                const tags = getDeckTagsFromDeck(deck);
                const labels = getDeckTagLabelsFromDeck(deck);
                if (tags.length === 0) {
                    root.decks.push(deck);
                    return;
                }
                const pathTags = (categoryKey && tags[0] === categoryKey) ? tags.slice(1) : tags;
                const pathLabels = (categoryKey && tags[0] === categoryKey) ? labels.slice(1) : labels;
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

        _getAllDeckIdsUnder(node) {
            const ids = [];
            node.decks.forEach((deck) => {
                const id = Number(deck.deck_id);
                if (id > 0) ids.push(id);
            });
            for (const child of node.children.values()) {
                ids.push(...this._getAllDeckIdsUnder(child));
            }
            return ids;
        }

        _getNodeSelectionState(node) {
            const ids = this._getAllDeckIdsUnder(node);
            if (ids.length === 0) return 'none';
            const sel = ids.filter((id) => this.selectedDeckIds.has(id)).length;
            if (sel === 0) return 'none';
            if (sel === ids.length) return 'all';
            return 'some';
        }

        _isNodeExpanded(tag, depth) {
            if (this.expandedTags === null) return depth < 2;
            return this.expandedTags.has(tag);
        }

        _captureExpandState() {
            if (!this.container) return;
            const expanded = new Set();
            this.container.querySelectorAll('.deck-tree-node[data-tree-tag]').forEach((nodeEl) => {
                const tag = nodeEl.getAttribute('data-tree-tag');
                const childrenEl = nodeEl.querySelector(':scope > .deck-tree-children');
                if (childrenEl && !childrenEl.classList.contains('collapsed')) {
                    expanded.add(tag);
                }
            });
            this.expandedTags = expanded;
        }

        // ── Rendering ─────────────────────────────────────────────────────────

        _defaultDeckLabel(deck) {
            const tags = getDeckTagsFromDeck(deck);
            if (tags.length > 1 && this.categoryKey && tags[0] === this.categoryKey) {
                return tags.slice(1).join('_');
            }
            const name = String((deck && deck.name) || '').trim();
            if (this.categoryKey) {
                if (name === this.categoryKey) return '';
                const prefix = `${this.categoryKey}_`;
                if (name.startsWith(prefix)) return name.slice(prefix.length);
            }
            return name;
        }

        // -----------------------------------------------------------------
        // === 5. Node + leaf rendering (HTML builders)
        // -----------------------------------------------------------------

        _renderNode(node, depth) {
            const hasChildren = node.children.size > 0;
            const hasDecks = node.decks.length > 0;
            if (!hasChildren && !hasDecks) {
                return '';
            }
            let html = '';

            // Merged leaf: a branch with exactly 1 deck and no sub-branches → single leaf row.
            if (node.tag !== null && !hasChildren && node.decks.length === 1) {
                const deck = node.decks[0];
                const deckId = Number(deck.deck_id);
                const isSelected = this.selectedDeckIds.has(deckId);
                const suffix = this.getDeckSuffix(deck);

                const rowClasses = ['deck-tree-row'];
                if (isSelected) rowClasses.push('selected');

                html += this._renderLeafHtml(deckId, rowClasses, escapeHtml(node.label || node.tag) + escapeHtml(suffix));
                return html;
            }

            if (node.tag !== null) {
                const allIds = this._getAllDeckIdsUnder(node);
                const selState = this._getNodeSelectionState(node);
                const totalCount = allIds.length;
                const selectedCount = allIds.filter((id) => this.selectedDeckIds.has(id)).length;
                const isExpanded = this._isNodeExpanded(node.tag, depth);

                const rowClasses = ['deck-tree-row'];
                if (selState === 'all') rowClasses.push('selected');
                else if (selState === 'some') rowClasses.push('partial');

                html += `<div class="deck-tree-node" data-tree-tag="${escapeHtml(node.tag)}">`;
                html += `<div class="${rowClasses.join(' ')}">`;
                html += `<button type="button" class="deck-tree-toggle${isExpanded ? ' expanded' : ''}" aria-label="Toggle">&#9654;</button>`;
                const pct = totalCount > 0 ? Math.round((selectedCount / totalCount) * 100) : 0;
                html += `<div class="deck-tree-row-body" data-tree-action="branch" data-tree-tag="${escapeHtml(node.tag)}">`;
                html += `<span class="deck-tree-checkbox" aria-hidden="true"></span>`;
                html += `<span class="deck-tree-label deck-tree-label-tag">${escapeHtml(node.label || node.tag)}</span>`;
                if (this.mode === 'opt-in') {
                    html += `<span class="deck-tree-meta">${selectedCount} of ${totalCount} selected</span>`;
                    html += this._getBranchPendingBadgesHtml(allIds);
                } else {
                    const deckLabel = totalCount === 1 ? 'deck' : 'decks';
                    html += `<span class="deck-tree-meta">${totalCount} ${deckLabel}</span>`;
                }
                html += `<span class="deck-tree-progress" aria-hidden="true"><span class="deck-tree-progress-fill" style="width:${pct}%"></span></span>`;
                if (this.onBranchEdit) {
                    const labelAttr = escapeHtml(node.label || node.tag);
                    html += `<button type="button" class="deck-tree-branch-edit-btn" data-tree-branch-edit data-tree-tag="${escapeHtml(node.tag)}" data-tree-tag-label="${labelAttr}" data-tree-depth="${depth}" aria-label="Rename folder"><span data-icon="pencil" data-icon-size="13" data-icon-stroke="2.2"></span><span class="deck-tree-branch-edit-btn-label">Rename</span></button>`;
                }
                if (this.onBranchNewDeck) {
                    const labelAttr = escapeHtml(node.label || node.tag);
                    html += `<button type="button" class="deck-tree-branch-newdeck-btn" data-tree-branch-newdeck data-tree-tag="${escapeHtml(node.tag)}" data-tree-tag-label="${labelAttr}" data-tree-depth="${depth}" aria-label="Create new deck in folder"><span data-icon="plus" data-icon-size="13" data-icon-stroke="2.4"></span><span class="deck-tree-branch-newdeck-btn-label">New deck</span></button>`;
                }
                html += `</div></div>`;
                html += `<div class="deck-tree-children${isExpanded ? '' : ' collapsed'}">`;
            }

            for (const child of node.children.values()) {
                html += this._renderNode(child, depth + 1);
            }

            node.decks.forEach((deck) => {
                const deckId = Number(deck.deck_id);
                const isSelected = this.selectedDeckIds.has(deckId);
                const label = this.getDeckLabel(deck);
                const suffix = this.getDeckSuffix(deck);

                const rowClasses = ['deck-tree-row'];
                if (isSelected) rowClasses.push('selected');

                html += this._renderLeafHtml(deckId, rowClasses, escapeHtml(label) + escapeHtml(suffix));
            });

            if (node.tag !== null) {
                html += `</div></div>`;
            }
            return html;
        }

        _renderLeafHtml(deckIdRaw, rowClasses, labelHtml, options) {
            const opts = options || {};
            const deckIdStr = String(deckIdRaw);
            const isExpanded = this.expandedLeafDeckIds.has(deckIdStr);
            const action = opts.action || 'leaf';
            const pendingBadge = opts.pendingBadge !== undefined
                ? opts.pendingBadge
                : (this.mode === 'opt-in' && action === 'leaf' ? this._getDeckPendingBadgeHtml(Number(deckIdRaw)) : '');

            const showLeafActionBtn = this.onLeafClick && action === 'leaf';
            const leafActionBtn = showLeafActionBtn
                ? `<button type="button" class="deck-tree-leaf-action-btn" data-tree-leaf-action data-tree-deck-id="${escapeHtml(deckIdStr)}" aria-label="Edit deck"><span data-icon="pencil" data-icon-size="13" data-icon-stroke="2.2"></span><span class="deck-tree-leaf-action-btn-label">Edit</span></button>`
                : '';

            let html = '';
            html += `<div class="deck-tree-node deck-tree-leaf" data-tree-deck-id="${escapeHtml(deckIdStr)}">`;
            html += `<div class="${rowClasses.join(' ')}">`;
            html += `<button type="button" class="deck-tree-leaf-toggle${isExpanded ? ' expanded' : ''}" aria-label="Show cards in deck">&#9654;</button>`;
            html += `<div class="deck-tree-row-body" data-tree-action="${escapeHtml(action)}" data-tree-deck-id="${escapeHtml(deckIdStr)}">`;
            html += `<span class="deck-tree-checkbox" aria-hidden="true"></span>`;
            html += `<span class="deck-tree-label">${labelHtml}</span>`;
            html += pendingBadge;
            html += leafActionBtn;
            html += `</div></div>`;
            const cardsClass = `deck-tree-leaf-cards${isExpanded ? '' : ' collapsed'}`;
            const cardsBody = isExpanded ? this._buildLeafCardListHtml(deckIdStr) : '';
            html += `<div class="${cardsClass}" data-leaf-deck-id="${escapeHtml(deckIdStr)}">${cardsBody}</div>`;
            html += `</div>`;
            return html;
        }

        _buildLeafCardListHtml(deckIdStr) {
            let cards = [];
            if (deckIdStr === ORPHAN_BUBBLE_ID) {
                if (!Array.isArray(this.cardIndex)) {
                    return `<div class="deck-tree-leaf-cards-empty">Loading cards…</div>`;
                }
                cards = this.cardIndex.filter((c) => c && c.is_orphan);
            } else {
                const wantId = Number(deckIdStr);
                if (!wantId) return '';
                if (!Array.isArray(this.cardIndex)) {
                    return `<div class="deck-tree-leaf-cards-empty">Loading cards…</div>`;
                }
                cards = this.cardIndex.filter((c) => Number(c && c.shared_deck_id) === wantId);
            }
            if (!cards.length) {
                return `<div class="deck-tree-leaf-cards-empty">No cards.</div>`;
            }
            const items = cards.map((card) => {
                const primary = String(card.front || '');
                const secondary = String(card.back || '');
                const secondaryHtml = secondary
                    ? `<span class="deck-tree-leaf-card-secondary">${escapeHtml(secondary)}</span>`
                    : '';
                return `<li class="deck-tree-leaf-card-item"><span class="deck-tree-leaf-card-primary">${escapeHtml(primary)}</span>${secondaryHtml}</li>`;
            }).join('');
            return `<ul class="deck-tree-leaf-card-list">${items}</ul>`;
        }

        // ── Pending badges (opt-in mode) ──────────────────────────────────────

        // -----------------------------------------------------------------
        // === 6. Pending-badge HTML + selection / card-count getters
        // -----------------------------------------------------------------

        _getDeckPendingBadgeHtml(deckId) {
            if (this.mode !== 'opt-in') return '';
            const id = Number(deckId);
            const wasIn = this.baselineSelectedDeckIds.has(id);
            const nowIn = this.selectedDeckIds.has(id);
            if (wasIn === nowIn) return '';
            const deck = this.allDecks.find((d) => Number(d.deck_id) === id);
            const cardCount = deck ? (Number(deck.card_count) || 0) : 0;
            const cls = nowIn ? 'opt-in' : 'opt-out';
            const sign = nowIn ? '+' : '-';
            return `
                <span class="deck-tree-badge ${cls}">
                    <span class="deck-tree-badge-chunk"><span data-icon="layout-grid" data-icon-size="11" data-icon-stroke="2.4"></span>${sign}${cardCount.toLocaleString()}</span>
                </span>
            `;
        }

        _getBranchPendingBadgesHtml(allIds) {
            if (this.mode !== 'opt-in') return '';
            const cardCountByDeckId = new Map();
            this.allDecks.forEach((d) => {
                const id = Number(d.deck_id);
                if (id > 0) cardCountByDeckId.set(id, Number(d.card_count) || 0);
            });
            let optInDecks = 0;
            let optOutDecks = 0;
            let optInCards = 0;
            let optOutCards = 0;
            allIds.forEach((id) => {
                const wasIn = this.baselineSelectedDeckIds.has(id);
                const nowIn = this.selectedDeckIds.has(id);
                if (wasIn === nowIn) return;
                const cards = cardCountByDeckId.get(id) || 0;
                if (nowIn) {
                    optInDecks += 1;
                    optInCards += cards;
                } else {
                    optOutDecks += 1;
                    optOutCards += cards;
                }
            });
            const buildBadge = (cls, sign, decks, cards) => `
                <span class="deck-tree-badge ${cls}">
                    <span class="deck-tree-badge-chunk"><span data-icon="layers" data-icon-size="11" data-icon-stroke="2.4"></span>${sign}${decks}</span>
                    <span class="deck-tree-badge-chunk"><span data-icon="layout-grid" data-icon-size="11" data-icon-stroke="2.4"></span>${sign}${cards.toLocaleString()}</span>
                </span>
            `;
            let html = '';
            if (optInDecks > 0) html += buildBadge('opt-in', '+', optInDecks, optInCards);
            if (optOutDecks > 0) html += buildBadge('opt-out', '-', optOutDecks, optOutCards);
            return html;
        }

        // ── Counter / Apply button ────────────────────────────────────────────

        _getTotalDeckCount() {
            let count = this.allDecks.filter((d) => Number(d.deck_id) > 0).length;
            if (this.mode === 'opt-in' && this.orphanDeck) count += 1;
            return count;
        }

        _getSelectedDeckCount() {
            let count = this.selectedDeckIds.size;
            if (this.mode === 'opt-in' && this.orphanDeck && this.includeOrphan) count += 1;
            return count;
        }

        _getTotalCardCount() {
            let count = this.allDecks.reduce((sum, d) => sum + (Number(d.card_count) || 0), 0);
            if (this.mode === 'opt-in' && this.orphanDeck) {
                count += Number(this.orphanDeck.card_count) || 0;
            }
            return count;
        }

        _getSelectedCardCount() {
            let count = this.allDecks.reduce((sum, d) => {
                const id = Number(d.deck_id);
                if (id > 0 && this.selectedDeckIds.has(id)) {
                    return sum + (Number(d.card_count) || 0);
                }
                return sum;
            }, 0);
            if (this.mode === 'opt-in' && this.orphanDeck && this.includeOrphan) {
                count += Number(this.orphanDeck.card_count) || 0;
            }
            return count;
        }

        // -----------------------------------------------------------------
        // === 7. Counter / apply-button updates + branch-path collection
        // -----------------------------------------------------------------

        _updateCounter() {
            if (!this.counter) return;
            if (this.mode === 'opt-in') {
                const selDecks = this._getSelectedDeckCount();
                const totDecks = this._getTotalDeckCount();
                const selCards = this._getSelectedCardCount();
                const totCards = this._getTotalCardCount();
                this.counter.innerHTML = `
                    <span class="deck-tree-counter-line"><span class="deck-tree-counter-icon" data-icon="layers" data-icon-size="14" data-icon-stroke="2.2"></span><span><strong>${selDecks}</strong> of ${totDecks} decks selected</span></span>
                    <span class="deck-tree-counter-line deck-tree-counter-sub"><span class="deck-tree-counter-icon" data-icon="layout-grid" data-icon-size="14" data-icon-stroke="2.2"></span><span><strong>${selCards.toLocaleString()}</strong> of ${totCards.toLocaleString()} cards selected</span></span>
                `;
            } else {
                const totDecks = this._getTotalDeckCount();
                const totCards = this._getTotalCardCount();
                this.counter.innerHTML = `
                    <span class="deck-tree-counter-line"><span class="deck-tree-counter-icon" data-icon="layers" data-icon-size="14" data-icon-stroke="2.2"></span><span><strong>${totDecks}</strong> ${totDecks === 1 ? 'deck' : 'decks'}</span></span>
                    <span class="deck-tree-counter-line deck-tree-counter-sub"><span class="deck-tree-counter-icon" data-icon="layout-grid" data-icon-size="14" data-icon-stroke="2.2"></span><span><strong>${totCards.toLocaleString()}</strong> ${totCards === 1 ? 'card' : 'cards'}</span></span>
                `;
            }
            if (window.hydrateIcons) window.hydrateIcons(this.counter);
        }

        _updateApplyButton() {
            if (!this.applyButton || this.mode !== 'opt-in') return;
            const toOptIn = [...this.selectedDeckIds].filter((id) => !this.baselineSelectedDeckIds.has(id));
            const toOptOut = [...this.baselineSelectedDeckIds].filter((id) => !this.selectedDeckIds.has(id));
            const orphanChanged = this.includeOrphan !== this.baselineIncludeOrphan;
            const orphanAdded = orphanChanged && this.includeOrphan;
            const orphanRemoved = orphanChanged && !this.includeOrphan;

            const cardCountByDeckId = new Map();
            this.allDecks.forEach((d) => {
                const id = Number(d.deck_id);
                if (id > 0) cardCountByDeckId.set(id, Number(d.card_count) || 0);
            });
            const sumCards = (ids) => ids.reduce((s, id) => s + (cardCountByDeckId.get(id) || 0), 0);
            const orphanCards = this.orphanDeck ? (Number(this.orphanDeck.card_count) || 0) : 0;

            const deckIn = toOptIn.length + (orphanAdded ? 1 : 0);
            const deckOut = toOptOut.length + (orphanRemoved ? 1 : 0);
            const cardIn = sumCards(toOptIn) + (orphanAdded ? orphanCards : 0);
            const cardOut = sumCards(toOptOut) + (orphanRemoved ? orphanCards : 0);

            const hasPending = deckIn > 0 || deckOut > 0;
            this.applyButton.disabled = this.applyDisabled || !hasPending;

            if (this.onApplyButtonRender) {
                this.onApplyButtonRender({
                    button: this.applyButton,
                    hasPending,
                    deckIn,
                    deckOut,
                    cardIn,
                    cardOut,
                });
                return;
            }

            const labelEl = this.applyButton.querySelector('.apply-btn-label');
            if (!labelEl) return;
            if (!hasPending) {
                labelEl.textContent = 'Apply';
                return;
            }
            const fmtDelta = (inN, outN) => {
                const parts = [];
                if (inN > 0) parts.push(`+${inN.toLocaleString()}`);
                if (outN > 0) parts.push(`-${outN.toLocaleString()}`);
                return parts.join(' ');
            };
            const deckLabel = (deckIn + deckOut) === 1 ? 'deck' : 'decks';
            const cardLabel = (cardIn + cardOut) === 1 ? 'card' : 'cards';
            const deckChunk = `<span class="apply-btn-chunk"><span data-icon="layers" data-icon-size="14" data-icon-stroke="2.4"></span>${fmtDelta(deckIn, deckOut)} ${deckLabel}</span>`;
            const cardChunk = `<span class="apply-btn-chunk"><span data-icon="layout-grid" data-icon-size="14" data-icon-stroke="2.4"></span>${fmtDelta(cardIn, cardOut)} ${cardLabel}</span>`;
            labelEl.innerHTML = `Apply (${deckChunk} · ${cardChunk})`;
            if (window.hydrateIcons) window.hydrateIcons(labelEl);
        }

        _collectBranchPath(branchEl) {
            const path = [];
            let cur = branchEl;
            while (cur) {
                const tag = cur.getAttribute('data-tree-tag');
                if (tag) path.unshift(tag);
                cur = cur.parentElement && cur.parentElement.closest('.deck-tree-node[data-tree-tag]');
            }
            return path;
        }

        // ── Click handling ────────────────────────────────────────────────────

        // -----------------------------------------------------------------
        // === 8. Click dispatch + branch / leaf / orphan selection toggles
        // -----------------------------------------------------------------

        _handleClick(event) {
            const leafToggle = event.target.closest('.deck-tree-leaf-toggle');
            if (leafToggle) {
                const treeNode = leafToggle.closest('.deck-tree-leaf');
                if (treeNode) {
                    const deckIdStr = treeNode.getAttribute('data-tree-deck-id') || '';
                    const cardsEl = treeNode.querySelector(':scope > .deck-tree-leaf-cards');
                    if (cardsEl) {
                        const isExpanded = !cardsEl.classList.contains('collapsed');
                        if (!isExpanded) {
                            if (!cardsEl.dataset.populated) {
                                cardsEl.innerHTML = this._buildLeafCardListHtml(deckIdStr);
                                cardsEl.dataset.populated = '1';
                            }
                            this.expandedLeafDeckIds.add(deckIdStr);
                        } else {
                            this.expandedLeafDeckIds.delete(deckIdStr);
                        }
                        cardsEl.classList.toggle('collapsed', isExpanded);
                        leafToggle.classList.toggle('expanded', !isExpanded);
                    }
                }
                return;
            }

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

            const leafActionBtn = event.target.closest('[data-tree-leaf-action]');
            if (leafActionBtn) {
                event.preventDefault();
                event.stopPropagation();
                if (this.onLeafClick) {
                    const deckId = Number(leafActionBtn.getAttribute('data-tree-deck-id'));
                    const deck = this.allDecks.find((d) => Number(d.deck_id) === deckId);
                    if (deck) this.onLeafClick(deck);
                }
                return;
            }

            const branchEditBtn = event.target.closest('[data-tree-branch-edit]');
            if (branchEditBtn) {
                event.preventDefault();
                event.stopPropagation();
                if (this.onBranchEdit) {
                    const tag = branchEditBtn.getAttribute('data-tree-tag') || '';
                    const label = branchEditBtn.getAttribute('data-tree-tag-label') || tag;
                    const depth = Number(branchEditBtn.getAttribute('data-tree-depth') || 0);
                    this.onBranchEdit({ tag, label, depth });
                }
                return;
            }

            const branchNewDeckBtn = event.target.closest('[data-tree-branch-newdeck]');
            if (branchNewDeckBtn) {
                event.preventDefault();
                event.stopPropagation();
                if (this.onBranchNewDeck) {
                    const tag = branchNewDeckBtn.getAttribute('data-tree-tag') || '';
                    const label = branchNewDeckBtn.getAttribute('data-tree-tag-label') || tag;
                    const depth = Number(branchNewDeckBtn.getAttribute('data-tree-depth') || 0);
                    const branchEl = branchNewDeckBtn.closest('.deck-tree-node[data-tree-tag]');
                    const path = this._collectBranchPath(branchEl);
                    this.onBranchNewDeck({ tag, label, depth, path });
                }
                return;
            }

            if (this.mode !== 'opt-in') {
                return;
            }

            const body = event.target.closest('.deck-tree-row-body');
            if (!body) return;
            const action = body.getAttribute('data-tree-action');

            if (action === 'orphan') {
                this._toggleOrphanSelection();
            } else if (action === 'leaf') {
                this._toggleLeafSelection(body.getAttribute('data-tree-deck-id'));
            } else if (action === 'branch') {
                this._toggleBranchSelection(body);
            }
        }

        _toggleBranchSelection(bodyEl) {
            const nodeEl = bodyEl.closest('.deck-tree-node[data-tree-tag]');
            if (!nodeEl) return;
            const leafBodies = nodeEl.querySelectorAll('[data-tree-action="leaf"][data-tree-deck-id]');
            const ids = [];
            leafBodies.forEach((b) => {
                const id = Number(b.getAttribute('data-tree-deck-id'));
                if (id > 0) ids.push(id);
            });
            if (ids.length === 0) return;
            const allSelected = ids.every((id) => this.selectedDeckIds.has(id));
            ids.forEach((id) => {
                if (allSelected) this.selectedDeckIds.delete(id);
                else this.selectedDeckIds.add(id);
            });
            this.render();
            this.onSelectionChange();
        }

        _toggleLeafSelection(deckId) {
            const id = Number(deckId);
            if (!(id > 0)) return;
            if (this.selectedDeckIds.has(id)) {
                this.selectedDeckIds.delete(id);
            } else {
                this.selectedDeckIds.add(id);
            }
            this.render();
            this.onSelectionChange();
        }

        _toggleOrphanSelection() {
            this.includeOrphan = !this.includeOrphan;
            this.render();
            this.onSelectionChange();
        }

        // ── Search ────────────────────────────────────────────────────────────

        // -----------------------------------------------------------------
        // === 9. Search + match preview + highlight
        // -----------------------------------------------------------------

        _applySearch(query) {
            if (!this.container) return;
            const q = String(query || '').trim().toLowerCase();
            const allNodes = this.container.querySelectorAll('.deck-tree-node');

            this.container.querySelectorAll('.deck-tree-card-matches').forEach((el) => el.remove());

            if (!q) {
                allNodes.forEach((node) => node.classList.remove('search-hidden'));
                return;
            }
            allNodes.forEach((node) => node.classList.add('search-hidden'));

            const containerEl = this.container;
            function showNodeAndAncestors(node) {
                node.classList.remove('search-hidden');
                let parent = node.parentElement;
                while (parent && parent !== containerEl) {
                    if (parent.classList.contains('deck-tree-node')) {
                        parent.classList.remove('search-hidden');
                    }
                    if (parent.classList.contains('deck-tree-children') && parent.classList.contains('collapsed')) {
                        parent.classList.remove('collapsed');
                        const toggleEl = parent.previousElementSibling && parent.previousElementSibling.querySelector('.deck-tree-toggle');
                        if (toggleEl) toggleEl.classList.add('expanded');
                    }
                    parent = parent.parentElement;
                }
            }
            function showAllDescendants(node) {
                node.querySelectorAll('.deck-tree-node').forEach((child) => child.classList.remove('search-hidden'));
            }

            const cardMatchesByDeckId = this._getMatchingCardsByDeckId(q);

            const leafNodes = this.container.querySelectorAll('.deck-tree-leaf');
            leafNodes.forEach((leaf) => {
                const labelEl = leaf.querySelector('.deck-tree-label');
                const text = (labelEl ? labelEl.textContent : '').toLowerCase();
                const deckIdAttr = leaf.getAttribute('data-tree-deck-id') || '';
                const bucket = deckIdAttr ? cardMatchesByDeckId.get(deckIdAttr) : null;
                if (text.includes(q) || bucket) {
                    showNodeAndAncestors(leaf);
                    if (bucket) {
                        const previewHtml = this._buildLeafMatchPreviewHtml(bucket, q);
                        if (previewHtml) {
                            leaf.insertAdjacentHTML('beforeend', previewHtml);
                        }
                    }
                }
            });

            const branchNodes = this.container.querySelectorAll('.deck-tree-node[data-tree-tag]');
            branchNodes.forEach((branch) => {
                const labelEl = branch.querySelector(':scope > .deck-tree-row > .deck-tree-row-body > .deck-tree-label');
                if (!labelEl) return;
                const text = labelEl.textContent.toLowerCase();
                if (text.includes(q)) {
                    showNodeAndAncestors(branch);
                    showAllDescendants(branch);
                }
            });
        }

        _getMatchingCardsByDeckId(q) {
            const byDeck = new Map();
            if (!q) return byDeck;
            const limitPerDeck = 8;
            const cards = Array.isArray(this.cardIndex) ? this.cardIndex : [];
            for (const card of cards) {
                if (!card) continue;
                const primary = String(card.front || '');
                if (!primary.toLowerCase().includes(q)) continue;
                const bucketKey = card.is_orphan
                    ? ORPHAN_BUBBLE_ID
                    : String(card.shared_deck_id || '');
                if (!bucketKey) continue;
                let bucket = byDeck.get(bucketKey);
                if (!bucket) {
                    bucket = { shown: [], total: 0 };
                    byDeck.set(bucketKey, bucket);
                }
                bucket.total += 1;
                if (bucket.shown.length < limitPerDeck) bucket.shown.push(card);
            }
            return byDeck;
        }

        _buildLeafMatchPreviewHtml(bucket, query) {
            if (!bucket || !bucket.shown.length) return '';
            const items = bucket.shown.map((card) => {
                const primary = String(card.front || '');
                const secondary = String(card.back || '');
                const primaryHtml = this._highlightQueryHtml(primary, query);
                const secondaryHtml = secondary
                    ? `<span class="deck-tree-card-match-secondary">${escapeHtml(secondary)}</span>`
                    : '';
                return `<li class="deck-tree-card-match-item"><span class="deck-tree-card-match-primary">${primaryHtml}</span>${secondaryHtml}</li>`;
            }).join('');
            const moreHtml = bucket.total > bucket.shown.length
                ? `<li class="deck-tree-card-match-more">+${bucket.total - bucket.shown.length} more</li>`
                : '';
            return `<ul class="deck-tree-card-matches">${items}${moreHtml}</ul>`;
        }

        _highlightQueryHtml(text, query) {
            const safeText = escapeHtml(String(text || ''));
            if (!query) return safeText;
            const lower = String(text || '').toLowerCase();
            const q = String(query || '').toLowerCase();
            let out = '';
            let i = 0;
            while (i < text.length) {
                const idx = lower.indexOf(q, i);
                if (idx === -1) {
                    out += escapeHtml(text.slice(i));
                    break;
                }
                if (idx > i) out += escapeHtml(text.slice(i, idx));
                out += `<mark class="deck-tree-card-match-hit">${escapeHtml(text.slice(idx, idx + q.length))}</mark>`;
                i = idx + q.length;
            }
            return out;
        }
    }

    DeckTreeView.ORPHAN_BUBBLE_ID = ORPHAN_BUBBLE_ID;

    window.DeckTreeView = DeckTreeView;
})();
