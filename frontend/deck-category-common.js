(function initDeckCategoryCommon() {
    function escapeHtmlLocal(text) {
        return String(text || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function normalizeCategoryKey(rawValue) {
        return String(rawValue || '').trim().toLowerCase();
    }

    function parseDeckTagInput(rawValue) {
        // Keep this parser in sync with backend parse_shared_deck_tag_with_comment in routes/kids.py.
        const text = String(rawValue || '').trim();
        if (!text) {
            return { tag: '', comment: '', label: '' };
        }
        const match = text.match(/^(.*?)(?:\(([^()]*)\))?$/);
        const baseText = String((match && match[1]) || '').trim();
        const rawComment = String((match && match[2]) || '').trim();
        const tag = String(baseText || '')
            .trim()
            .toLowerCase()
            .replace(/\s+/g, '_')
            .replace(/_+/g, '_')
            .replace(/^_+|_+$/g, '');
        if (!tag) {
            return { tag: '', comment: '', label: '' };
        }
        const comment = rawComment.replace(/\s+/g, ' ').trim();
        const label = comment ? `${tag}(${comment})` : tag;
        return { tag, comment, label };
    }

    function formatDeckTagLabel(tag, comment) {
        const parsed = parseDeckTagInput(`${String(tag || '').trim()}${comment ? `(${String(comment || '').trim()})` : ''}`);
        return parsed.label;
    }

    function getCategoryRawValueMap(source) {
        const output = {};
        if (!source || typeof source !== 'object') {
            return output;
        }
        Object.entries(source).forEach(([rawKey, rawValue]) => {
            const key = normalizeCategoryKey(rawKey);
            if (!key) {
                return;
            }
            output[key] = rawValue;
        });
        return output;
    }

    function getOptedInDeckCategoryKeys(kid) {
        const rawKeys = Array.isArray(kid?.optedInDeckCategoryKeys)
            ? kid.optedInDeckCategoryKeys
            : [];
        const seen = new Set();
        const ordered = [];
        rawKeys.forEach((value) => {
            const key = normalizeCategoryKey(value);
            if (!key || seen.has(key)) {
                return;
            }
            seen.add(key);
            ordered.push(key);
        });
        return ordered;
    }

    function getOptedInDeckCategorySet(kid) {
        return new Set(getOptedInDeckCategoryKeys(kid));
    }

    function getCategoryValueMap(source) {
        const output = {};
        const normalizedSource = getCategoryRawValueMap(source);
        Object.entries(normalizedSource).forEach(([key, rawValue]) => {
            const value = Number.parseInt(rawValue, 10);
            output[key] = Number.isInteger(value) ? Math.max(0, value) : 0;
        });
        return output;
    }

    function getDeckCategoryMetaMap(kid) {
        const source = kid?.deckCategoryMetaByKey;
        if (!source || typeof source !== 'object') {
            return {};
        }
        const output = {};
        Object.entries(source).forEach(([rawKey, rawValue]) => {
            const key = normalizeCategoryKey(rawKey);
            if (!key) {
                return;
            }
            const item = rawValue && typeof rawValue === 'object' ? rawValue : {};
            output[key] = {
                behavior_type: normalizeCategoryKey(item.behavior_type),
                has_chinese_specific_logic: Boolean(item.has_chinese_specific_logic),
                display_name: String(item.display_name || '').trim(),
                emoji: String(item.emoji || '').trim(),
            };
        });
        return output;
    }

    function getCategoryDisplayName(categoryKey, categoryMetaMap = {}) {
        const key = normalizeCategoryKey(categoryKey);
        const fromMeta = String(categoryMetaMap?.[key]?.display_name || '').trim();
        return fromMeta;
    }

    function getCategoryEmoji(categoryKey, categoryMetaMap = {}) {
        const key = normalizeCategoryKey(categoryKey);
        const fromMeta = String(categoryMetaMap?.[key]?.emoji || '').trim();
        if (fromMeta) {
            return fromMeta;
        }
        return '🧩';
    }

    function getCategoryKeysByPredicate(kid, predicate) {
        const optedInKeys = getOptedInDeckCategoryKeys(kid);
        const categoryMetaMap = getDeckCategoryMetaMap(kid);
        const matcher = typeof predicate === 'function' ? predicate : () => false;
        return optedInKeys.filter((key) => {
            const categoryMeta = categoryMetaMap[key] || {};
            return Boolean(matcher(categoryMeta));
        });
    }

    function resolvePreferredCategoryKey(keys, preferredKey = '') {
        if (!Array.isArray(keys) || keys.length === 0) {
            return '';
        }
        const preferred = normalizeCategoryKey(preferredKey);
        if (preferred && keys.includes(preferred)) {
            return preferred;
        }
        return keys[0];
    }

    const getTypeIChineseSpecificCategoryKeys = (kid) => getCategoryKeysByPredicate(
        kid,
        (meta) => meta.behavior_type === 'type_i' && Boolean(meta.has_chinese_specific_logic),
    );

    const getTypeINonChineseCategoryKeys = (kid) => getCategoryKeysByPredicate(
        kid,
        (meta) => meta.behavior_type === 'type_i' && !Boolean(meta.has_chinese_specific_logic),
    );

    const getTypeIICategoryKeys = (kid) => getCategoryKeysByPredicate(
        kid,
        (meta) => meta.behavior_type === 'type_ii',
    );

    const getTypeIIICategoryKeys = (kid) => getCategoryKeysByPredicate(
        kid,
        (meta) => meta.behavior_type === 'type_iii',
    );

    const getTypeIVCategoryKeys = (kid) => getCategoryKeysByPredicate(
        kid,
        (meta) => meta.behavior_type === 'type_iv',
    );

    const resolveChinesePracticeCategoryKey = (kid, preferredKey = '') => resolvePreferredCategoryKey(
        getTypeIChineseSpecificCategoryKeys(kid),
        preferredKey,
    );

    const resolveTypeINonChinesePracticeCategoryKey = (kid, preferredKey = '') => resolvePreferredCategoryKey(
        getTypeINonChineseCategoryKeys(kid),
        preferredKey,
    );

    const resolveTypeIIPracticeCategoryKey = (kid, preferredKey = '') => resolvePreferredCategoryKey(
        getTypeIICategoryKeys(kid),
        preferredKey,
    );

    const resolveTypeIIIPracticeCategoryKey = (kid, preferredKey = '') => resolvePreferredCategoryKey(
        getTypeIIICategoryKeys(kid),
        preferredKey,
    );

    const resolveTypeIVPracticeCategoryKey = (kid, preferredKey = '') => resolvePreferredCategoryKey(
        getTypeIVCategoryKeys(kid),
        preferredKey,
    );

    function normalizeBehaviorType(type) {
        const text = String(type || '').trim().toLowerCase();
        if (text === 'type_i' || text === 'type_ii' || text === 'type_iii' || text === 'type_iv') {
            return text;
        }
        return '';
    }

    function getBehaviorTypeLabel(behaviorType) {
        const normalized = normalizeBehaviorType(behaviorType);
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
            return 'Type IV';
        }
        return '';
    }

    function getCategoryDescriptor(categoryMeta = {}) {
        const behaviorLabel = getBehaviorTypeLabel(categoryMeta.behavior_type);
        if (!behaviorLabel) {
            return '';
        }
        if (normalizeBehaviorType(categoryMeta.behavior_type) === 'type_iv') {
            return `${behaviorLabel} Dynamic`;
        }
        const logicLabel = categoryMeta.has_chinese_specific_logic ? 'Chinese' : 'Generic';
        return `${behaviorLabel} ${logicLabel}`;
    }

    function getCategoryVisibilityLabel(categoryMeta = {}) {
        if (!categoryMeta || typeof categoryMeta !== 'object') {
            return '';
        }
        if (!Object.prototype.hasOwnProperty.call(categoryMeta, 'is_shared_with_non_super_family')) {
            return '';
        }
        return categoryMeta.is_shared_with_non_super_family ? 'Public' : 'Private';
    }

    function getCategoryCardTitle(categoryKey, categoryMeta = {}) {
        const key = normalizeCategoryKey(categoryKey);
        const displayName = String(categoryMeta.display_name || '').trim() || key;
        const emoji = String(categoryMeta.emoji || '').trim();
        return emoji ? `${emoji} ${displayName}` : displayName;
    }

    function getCategoryCardDescription(categoryMeta = {}, deckCount = 0, options = {}) {
        const parts = [];
        const descriptor = getCategoryDescriptor(categoryMeta);
        if (descriptor) {
            parts.push(descriptor);
        }
        const includeVisibility = options && Object.prototype.hasOwnProperty.call(options, 'includeVisibility')
            ? Boolean(options.includeVisibility)
            : true;
        if (includeVisibility) {
            const visibilityLabel = getCategoryVisibilityLabel(categoryMeta);
            if (visibilityLabel) {
                parts.push(visibilityLabel);
            }
        }
        const count = Number.isFinite(deckCount) ? Math.max(0, Math.trunc(deckCount)) : 0;
        parts.push(`${count} deck${count === 1 ? '' : 's'}`);
        return parts.join(' · ');
    }

    async function loadDeckCategoriesForFirstTagPicker(config = {}) {
        const base = String(config.apiBase || `${window.location.origin}/api`).replace(/\/+$/, '');
        const response = await fetch(`${base}/shared-decks/categories`);
        const result = await response.json().catch(() => ({}));
        if (!response.ok) {
            throw new Error(result.error || `Failed to load deck categories (HTTP ${response.status})`);
        }

        const rawCategories = Array.isArray(result.categories) ? result.categories : [];
        const categories = [];
        const seen = new Set();
        rawCategories.forEach((item) => {
            const key = normalizeCategoryKey(item && item.category_key);
            const behaviorType = normalizeBehaviorType(item && item.behavior_type);
            if (!key || !behaviorType || seen.has(key)) {
                return;
            }
            seen.add(key);
            categories.push({
                category_key: key,
                behavior_type: behaviorType,
                has_chinese_specific_logic: Boolean(item && item.has_chinese_specific_logic),
                display_name: String(item && item.display_name ? item.display_name : '').trim(),
                emoji: String(item && item.emoji ? item.emoji : '').trim(),
                is_shared_with_non_super_family: Boolean(item && item.is_shared_with_non_super_family),
            });
        });

        if (categories.length === 0) {
            throw new Error('No deck categories configured. Create a category first.');
        }

        const categoryKeySet = new Set(categories.map((item) => item.category_key));
        const preferred = normalizeCategoryKey(config.selectedCategoryKey);
        const selectedCategoryKey = categoryKeySet.has(preferred)
            ? preferred
            : categories[0].category_key;

        return {
            categories,
            categoryKeySet,
            selectedCategoryKey,
        };
    }

    function renderFirstTagCategoryPicker(config = {}) {
        const containerEl = config.containerEl || null;
        if (!containerEl) {
            return;
        }
        const categories = Array.isArray(config.categories) ? config.categories : [];
        if (categories.length === 0) {
            containerEl.innerHTML = '<span class="settings-note">No categories available.</span>';
            return;
        }
        const selectedKey = normalizeCategoryKey(config.selectedCategoryKey);
        const getDeckCount = typeof config.getDeckCount === 'function'
            ? config.getDeckCount
            : () => 0;

        containerEl.innerHTML = categories.map((item) => {
            const key = normalizeCategoryKey(item && item.category_key);
            const isActive = key === selectedKey;
            const count = getDeckCount(key);
            const title = getCategoryCardTitle(key, item);
            const description = getCategoryCardDescription(item, count);
            return `
                <button type="button" class="first-tag-option${isActive ? ' active' : ''}" data-first-tag="${escapeHtmlLocal(key)}" aria-pressed="${isActive ? 'true' : 'false'}">
                    <span class="first-tag-option-title">${escapeHtmlLocal(title)}</span>
                    <span class="first-tag-option-desc">${escapeHtmlLocal(description)}</span>
                </button>
            `;
        }).join('');
    }

    function buildKidScopedApiUrl({
        kidId,
        scope = '',
        path = '',
        categoryKey = '',
        apiBase = `${window.location.origin}/api`,
    }) {
        const safeKidId = String(kidId || '').trim();
        const normalizedScope = String(scope || '').trim().replace(/^\/+|\/+$/g, '');
        if (!normalizedScope) {
            throw new Error('scope is required');
        }
        const normalizedPath = String(path || '').trim().replace(/^\/+/, '');
        const url = new URL(`${String(apiBase || '').replace(/\/+$/, '')}/kids/${encodeURIComponent(safeKidId)}/${normalizedScope}/${normalizedPath}`);
        const normalizedCategoryKey = normalizeCategoryKey(categoryKey);
        if (normalizedCategoryKey) {
            url.searchParams.set('categoryKey', normalizedCategoryKey);
        }
        return url.toString();
    }

    function buildType2ApiUrl({ kidId, path = '', categoryKey = '', apiBase = `${window.location.origin}/api` }) {
        return buildKidScopedApiUrl({
            kidId,
            scope: 'type2',
            path,
            categoryKey,
            apiBase,
        });
    }

    window.DeckCategoryCommon = {
        normalizeCategoryKey,
        parseDeckTagInput,
        formatDeckTagLabel,
        getOptedInDeckCategoryKeys,
        getOptedInDeckCategorySet,
        getCategoryRawValueMap,
        getCategoryValueMap,
        getDeckCategoryMetaMap,
        getCategoryDisplayName,
        getCategoryEmoji,
        getTypeIChineseSpecificCategoryKeys,
        getTypeINonChineseCategoryKeys,
        resolveChinesePracticeCategoryKey,
        resolveTypeINonChinesePracticeCategoryKey,
        getTypeIICategoryKeys,
        resolveTypeIIPracticeCategoryKey,
        getTypeIIICategoryKeys,
        resolveTypeIIIPracticeCategoryKey,
        getTypeIVCategoryKeys,
        resolveTypeIVPracticeCategoryKey,
        normalizeBehaviorType,
        getBehaviorTypeLabel,
        getCategoryDescriptor,
        getCategoryVisibilityLabel,
        getCategoryCardTitle,
        getCategoryCardDescription,
        loadDeckCategoriesForFirstTagPicker,
        renderFirstTagCategoryPicker,
        buildKidScopedApiUrl,
        buildType2ApiUrl,
    };
}());
