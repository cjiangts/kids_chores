(function initDeckCategoryCommon() {
    function normalizeCategoryKey(rawValue) {
        return String(rawValue || '').trim().toLowerCase();
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

    function getTypeIChineseSpecificCategoryKeys(kid) {
        const optedInKeys = getOptedInDeckCategoryKeys(kid);
        const categoryMetaMap = getDeckCategoryMetaMap(kid);
        return optedInKeys.filter((key) => {
            const categoryMeta = categoryMetaMap[key] || {};
            return categoryMeta.behavior_type === 'type_i'
                && Boolean(categoryMeta.has_chinese_specific_logic);
        });
    }

    function resolveChinesePracticeCategoryKey(kid, preferredKey = '') {
        const chineseKeys = getTypeIChineseSpecificCategoryKeys(kid);
        if (chineseKeys.length === 0) {
            return '';
        }
        const preferred = normalizeCategoryKey(preferredKey);
        if (preferred && chineseKeys.includes(preferred)) {
            return preferred;
        }
        return chineseKeys[0];
    }

    function getTypeINonChineseCategoryKeys(kid) {
        const optedInKeys = getOptedInDeckCategoryKeys(kid);
        const categoryMetaMap = getDeckCategoryMetaMap(kid);
        return optedInKeys.filter((key) => {
            const categoryMeta = categoryMetaMap[key] || {};
            return categoryMeta.behavior_type === 'type_i'
                && !Boolean(categoryMeta.has_chinese_specific_logic);
        });
    }

    function resolveTypeINonChinesePracticeCategoryKey(kid, preferredKey = '') {
        const keys = getTypeINonChineseCategoryKeys(kid);
        if (keys.length === 0) {
            return '';
        }
        const preferred = normalizeCategoryKey(preferredKey);
        if (preferred && keys.includes(preferred)) {
            return preferred;
        }
        return keys[0];
    }

    function getTypeIIICategoryKeys(kid) {
        const optedInKeys = getOptedInDeckCategoryKeys(kid);
        const categoryMetaMap = getDeckCategoryMetaMap(kid);
        return optedInKeys.filter((key) => {
            const categoryMeta = categoryMetaMap[key] || {};
            return categoryMeta.behavior_type === 'type_iii';
        });
    }

    function getTypeIICategoryKeys(kid) {
        const optedInKeys = getOptedInDeckCategoryKeys(kid);
        const categoryMetaMap = getDeckCategoryMetaMap(kid);
        return optedInKeys.filter((key) => {
            const categoryMeta = categoryMetaMap[key] || {};
            return categoryMeta.behavior_type === 'type_ii';
        });
    }

    function resolveTypeIIPracticeCategoryKey(kid, preferredKey = '') {
        const keys = getTypeIICategoryKeys(kid);
        if (keys.length === 0) {
            return '';
        }
        const preferred = normalizeCategoryKey(preferredKey);
        if (preferred && keys.includes(preferred)) {
            return preferred;
        }
        return keys[0];
    }

    function resolveTypeIIIPracticeCategoryKey(kid, preferredKey = '') {
        const keys = getTypeIIICategoryKeys(kid);
        if (keys.length === 0) {
            return '';
        }
        const preferred = normalizeCategoryKey(preferredKey);
        if (preferred && keys.includes(preferred)) {
            return preferred;
        }
        return keys[0];
    }

    function normalizeBehaviorType(type) {
        const text = String(type || '').trim().toLowerCase();
        if (text === 'type_i' || text === 'type_ii' || text === 'type_iii') {
            return text;
        }
        return '';
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
        normalizeBehaviorType,
        buildKidScopedApiUrl,
        buildType2ApiUrl,
    };
}());
