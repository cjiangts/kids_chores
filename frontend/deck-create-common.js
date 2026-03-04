(function initDeckCreateCommon() {
    const deckCategoryCommon = window.DeckCategoryCommon;
    if (!deckCategoryCommon) {
        throw new Error('deck-category-common.js is required for deck-create-common');
    }

    function ensureSuperFamily(apiBase = `${window.location.origin}/api`) {
        const base = String(apiBase || `${window.location.origin}/api`).replace(/\/+$/, '');
        return fetch(`${base}/family-auth/status`)
            .then((response) => {
                if (!response.ok) {
                    window.location.href = '/family-login.html';
                    return false;
                }
                return response.json().catch(() => ({})).then((auth) => {
                    if (!auth.authenticated) {
                        window.location.href = '/family-login.html';
                        return false;
                    }
                    if (!auth.isSuperFamily) {
                        window.location.href = '/admin.html';
                        return false;
                    }
                    return true;
                });
            })
            .catch(() => {
                window.location.href = '/admin.html';
                return false;
            });
    }

    function normalizeTag(text) {
        return deckCategoryCommon.parseDeckTagInput(text).tag;
    }

    function parseTagInput(text) {
        return deckCategoryCommon.parseDeckTagInput(text);
    }

    function formatTagPayload(tagInfo) {
        const item = tagInfo && typeof tagInfo === 'object' ? tagInfo : {};
        return deckCategoryCommon.formatDeckTagLabel(item.tag, item.comment);
    }

    function getDeckCountForCategory(categoryKey, deckCountByCategoryKey = {}) {
        const key = normalizeTag(categoryKey);
        if (!key) {
            return 0;
        }
        const raw = deckCountByCategoryKey[key];
        const count = Number.isFinite(raw) ? Math.max(0, Math.trunc(raw)) : 0;
        return count;
    }

    function getCurrentDeckCategory(currentFirstTag, deckCategories = []) {
        const key = normalizeTag(currentFirstTag);
        if (!key) {
            return null;
        }
        return (Array.isArray(deckCategories) ? deckCategories : []).find((item) => item.category_key === key) || null;
    }

    function isChineseCharactersDeckMode(category) {
        return Boolean(
            category
            && category.behavior_type === 'type_i'
            && category.has_chinese_specific_logic
        );
    }

    function isChineseWritingDeckMode(category) {
        return Boolean(
            category
            && category.behavior_type === 'type_ii'
            && category.has_chinese_specific_logic
        );
    }

    function isTypeIIDeckMode(category) {
        return Boolean(category && category.behavior_type === 'type_ii');
    }

    function setControlsDisabled(disabled, controls = {}) {
        const isDisabled = Boolean(disabled);
        Object.values(controls || {}).forEach((item) => {
            if (!item || typeof item !== 'object') {
                return;
            }
            if (!Object.prototype.hasOwnProperty.call(item, 'element')) {
                return;
            }
            const el = item.element;
            if (!el || !Object.prototype.hasOwnProperty.call(el, 'disabled')) {
                return;
            }
            if (item.busyGuard) {
                el.disabled = isDisabled || Boolean(item.busyGuard());
            } else {
                el.disabled = isDisabled;
            }
        });
    }

    async function loadDeckCategories({
        apiBase = `${window.location.origin}/api`,
        selectedCategoryKey = '',
        includeReservedFirstTags = false,
    } = {}) {
        const loaded = await deckCategoryCommon.loadDeckCategoriesForFirstTagPicker({
            apiBase,
            selectedCategoryKey,
        });
        return {
            categories: loaded.categories,
            categoryKeySet: loaded.categoryKeySet,
            selectedCategoryKey: loaded.selectedCategoryKey,
            reservedFirstTags: includeReservedFirstTags
                ? new Set(loaded.categories.map((item) => item.category_key))
                : new Set(),
        };
    }

    function renderFirstTagToggle({
        containerEl,
        categories,
        selectedCategoryKey,
        getDeckCount,
    }) {
        deckCategoryCommon.renderFirstTagCategoryPicker({
            containerEl,
            categories,
            selectedCategoryKey,
            getDeckCount,
        });
    }

    function normalizeNextFirstTag(nextTag, currentFirstTag, deckCategoryKeySet) {
        const next = normalizeTag(nextTag);
        if (!next || !(deckCategoryKeySet instanceof Set) || !deckCategoryKeySet.has(next)) {
            return '';
        }
        if (next === currentFirstTag) {
            return '';
        }
        return next;
    }

    function formatTagPath(tags) {
        const list = Array.isArray(tags) ? tags.map((tag) => String(tag || '').trim()).filter(Boolean) : [];
        if (list.length === 0) {
            return '[]';
        }
        return `[${list.join(', ')}]`;
    }

    async function fetchChineseCharacterPinyinMap(apiBase, texts) {
        if (!Array.isArray(texts) || texts.length === 0) {
            return {};
        }
        const response = await fetch(`${String(apiBase || `${window.location.origin}/api`).replace(/\/+$/, '')}/shared-decks/chinese-characters/pinyin`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ texts }),
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok) {
            throw new Error(result.error || `Failed to generate pinyin (HTTP ${response.status})`);
        }
        return result && typeof result.pinyin_by_text === 'object' && result.pinyin_by_text
            ? result.pinyin_by_text
            : {};
    }

    async function fetchCategoryCardOverlap(apiBase, categoryKey, cards) {
        if (!Array.isArray(cards) || cards.length === 0) {
            return { dedupeKey: 'front', otherKey: 'back', overlaps: [] };
        }
        const response = await fetch(`${String(apiBase || `${window.location.origin}/api`).replace(/\/+$/, '')}/shared-decks/category-card-overlap`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                categoryKey: normalizeTag(categoryKey),
                cards: cards.map((item) => ({
                    front: String(item && item.front ? item.front : ''),
                    back: String(item && item.back ? item.back : ''),
                })),
            }),
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok) {
            throw new Error(result.error || `Failed to compare with existing cards (HTTP ${response.status})`);
        }
        const dedupeKey = String(result && result.dedupe_key ? result.dedupe_key : 'front').trim().toLowerCase() === 'back'
            ? 'back'
            : 'front';
        const otherKeyRaw = String(result && result.other_key ? result.other_key : '').trim().toLowerCase();
        return {
            dedupeKey,
            otherKey: (otherKeyRaw === 'front' || otherKeyRaw === 'back')
                ? otherKeyRaw
                : (dedupeKey === 'back' ? 'front' : 'back'),
            overlaps: Array.isArray(result && result.overlaps) ? result.overlaps : [],
        };
    }

    function toOverlapByValue(overlapInfo) {
        const overlapByValue = {};
        const overlaps = Array.isArray(overlapInfo && overlapInfo.overlaps) ? overlapInfo.overlaps : [];
        overlaps.forEach((item) => {
            const dedupeValue = String(item && item.dedupe_value ? item.dedupe_value : '');
            if (!dedupeValue) {
                return;
            }
            overlapByValue[dedupeValue] = {
                exactDecks: Array.isArray(item && item.exact_match_decks) ? item.exact_match_decks : [],
                mismatchDecks: Array.isArray(item && item.mismatch_decks) ? item.mismatch_decks : [],
            };
        });
        return overlapByValue;
    }

    function formatDeckNameList(rawDecks, maxItems = 3) {
        const decks = Array.isArray(rawDecks) ? rawDecks : [];
        const names = [];
        const seen = new Set();
        decks.forEach((item) => {
            const name = String(item && item.deck_name ? item.deck_name : '').trim();
            const fallbackId = Number(item && item.deck_id ? item.deck_id : 0);
            const label = name || (fallbackId > 0 ? `#${fallbackId}` : '');
            if (!label || seen.has(label)) {
                return;
            }
            seen.add(label);
            names.push(label);
        });
        if (names.length === 0) {
            return '';
        }
        if (names.length <= maxItems) {
            return names.join(', ');
        }
        return `${names.slice(0, maxItems).join(', ')} (+${names.length - maxItems} more)`;
    }

    function renderStatusCellHtml(item, options = {}) {
        const warnClass = String(options.warnClass || 'deck-row-status-conflict').trim() || 'deck-row-status-conflict';
        const statusText = String(item && item.statusText ? item.statusText : '').trim();
        const isKept = statusText.toLowerCase() === 'kept';
        if (!isKept) {
            return `<span class="${warnClass}">${window.escapeHtml(statusText)}</span>`;
        }
        const exactText = String(item && item.exactText ? item.exactText : '').trim();
        const warningText = String(item && item.warningText ? item.warningText : '').trim();
        const parts = ['<span class="deck-row-status-ok">Kept</span>'];
        if (exactText) {
            parts.push(`<span class="deck-row-status-note">${window.escapeHtml(exactText)}</span>`);
        }
        if (warningText) {
            parts.push(`<span class="deck-row-status-note-warn">${window.escapeHtml(warningText)}</span>`);
        }
        return parts.join('');
    }

    function showMessage(element, message) {
        const text = String(message || '').trim();
        if (!element) {
            return;
        }
        if (!text) {
            element.textContent = '';
            element.classList.add('hidden');
            return;
        }
        element.textContent = text;
        element.classList.remove('hidden');
    }

    window.DeckCreateCommon = {
        ensureSuperFamily,
        normalizeTag,
        parseTagInput,
        formatTagPayload,
        getDeckCountForCategory,
        getCurrentDeckCategory,
        isChineseCharactersDeckMode,
        isChineseWritingDeckMode,
        isTypeIIDeckMode,
        setControlsDisabled,
        loadDeckCategories,
        renderFirstTagToggle,
        normalizeNextFirstTag,
        formatTagPath,
        fetchChineseCharacterPinyinMap,
        fetchCategoryCardOverlap,
        toOverlapByValue,
        formatDeckNameList,
        renderStatusCellHtml,
        showMessage,
    };
}());
