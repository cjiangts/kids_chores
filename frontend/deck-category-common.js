(function initDeckCategoryCommon() {
    function normalizeCategoryKey(rawValue) {
        return String(rawValue || '').trim().toLowerCase();
    }

    function buildCategoryDisplayName(rawKey) {
        const key = normalizeCategoryKey(rawKey);
        if (!key) {
            return 'Practice';
        }
        return key
            .split('_')
            .filter(Boolean)
            .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
            .join(' ');
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
        if (!source || typeof source !== 'object') {
            return output;
        }
        Object.entries(source).forEach(([rawKey, rawValue]) => {
            const key = normalizeCategoryKey(rawKey);
            if (!key) {
                return;
            }
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
        if (fromMeta) {
            return fromMeta;
        }
        return buildCategoryDisplayName(key);
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
        if (chineseKeys.includes('chinese_characters')) {
            return 'chinese_characters';
        }
        return chineseKeys[0];
    }

    window.DeckCategoryCommon = {
        normalizeCategoryKey,
        buildCategoryDisplayName,
        getOptedInDeckCategoryKeys,
        getOptedInDeckCategorySet,
        getCategoryValueMap,
        getDeckCategoryMetaMap,
        getCategoryDisplayName,
        getCategoryEmoji,
        getTypeIChineseSpecificCategoryKeys,
        resolveChinesePracticeCategoryKey,
    };
}());
