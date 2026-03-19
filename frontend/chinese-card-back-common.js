window.ChineseCardBackCommon = (() => {
    const ENGLISH_MEANING_MARKER = '\nEN: ';

    function normalizeText(value) {
        return String(value ?? '');
    }

    function splitBack(value) {
        const raw = normalizeText(value);
        const markerIndex = raw.indexOf(ENGLISH_MEANING_MARKER);
        if (markerIndex < 0) {
            const pinyinOnly = raw.trim();
            return {
                raw,
                pinyin: pinyinOnly,
                meaning: '',
                hasMeaning: false,
            };
        }
        const pinyin = raw.slice(0, markerIndex).trim();
        const meaning = raw.slice(markerIndex + ENGLISH_MEANING_MARKER.length).trim();
        return {
            raw,
            pinyin,
            meaning,
            hasMeaning: meaning.length > 0,
        };
    }

    function getPinyin(value) {
        const parts = splitBack(value);
        return parts.pinyin || parts.meaning || '';
    }

    function getMeaning(value) {
        return splitBack(value).meaning;
    }

    function getSearchText(value) {
        const parts = splitBack(value);
        return [parts.pinyin, parts.meaning, parts.raw]
            .map((item) => String(item || '').trim())
            .filter(Boolean)
            .join(' ');
    }

    function getCompactText(value, mode = 'full') {
        const parts = splitBack(value);
        if (mode === 'pinyin') {
            return parts.pinyin || parts.meaning || '';
        }
        if (mode === 'meaning') {
            return parts.meaning || parts.pinyin || '';
        }
        if (!parts.hasMeaning) {
            return parts.pinyin || '';
        }
        return `${parts.pinyin} · ${parts.meaning}`.trim();
    }

    function buildStackHtml(value, escapeHtml) {
        const esc = typeof escapeHtml === 'function'
            ? escapeHtml
            : (raw) => normalizeText(raw);
        const parts = splitBack(value);
        if (!parts.hasMeaning) {
            return esc(parts.pinyin || '');
        }
        return `
            <span class="chinese-back-stack">
                <span class="chinese-back-pinyin">${esc(parts.pinyin)}</span>
                <span class="chinese-back-meaning">${esc(parts.meaning)}</span>
            </span>
        `.trim();
    }

    function composeBack(pinyin, meaning) {
        const pinyinText = normalizeText(pinyin).trim();
        const meaningText = normalizeText(meaning).trim();
        if (!meaningText) {
            return pinyinText;
        }
        if (!pinyinText) {
            return `${ENGLISH_MEANING_MARKER.trimStart()}${meaningText}`;
        }
        return `${pinyinText}${ENGLISH_MEANING_MARKER}${meaningText}`;
    }

    return {
        ENGLISH_MEANING_MARKER,
        splitBack,
        getPinyin,
        getMeaning,
        getSearchText,
        getCompactText,
        buildStackHtml,
        composeBack,
    };
})();
