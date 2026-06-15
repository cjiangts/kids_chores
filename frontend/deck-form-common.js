function extractSecondaryTagConfigs(tags, tagLabels) {
    const tagList = Array.isArray(tags) ? tags : [];
    const labelList = Array.isArray(tagLabels) ? tagLabels : [];
    const seen = new Set();
    return tagList
        .slice(1)
        .map((rawTag, index) => {
            const normalizedTag = deckCategoryCommon.parseDeckTagInput(rawTag).tag;
            if (!normalizedTag || seen.has(normalizedTag)) {
                return null;
            }
            const parsed = deckCategoryCommon.parseDeckTagInput(labelList[index + 1] || rawTag);
            seen.add(normalizedTag);
            return {
                tag: normalizedTag,
                comment: parsed.tag === normalizedTag ? parsed.comment : '',
            };
        })
        .filter(Boolean);
}

function renderDeckTagsHtml(tags, tagLabels) {
    const tagList = Array.isArray(tags) ? tags : [];
    if (tagList.length === 0) {
        return '-';
    }
    const labelList = Array.isArray(tagLabels) ? tagLabels : [];
    return tagList.map((tag, index) => {
        const normalizedTag = String(tag || '').trim();
        const parsed = deckCategoryCommon.parseDeckTagInput(labelList[index]);
        const text = parsed.tag === normalizedTag && parsed.label
            ? parsed.label
            : normalizedTag;
        return `<span class="shared-tag-filter-chip">${escapeHtml(text)}</span>`;
    }).join('');
}

function initializeType4GeneratorEditor(containerId, initialValue, onChange) {
    const container = typeof containerId === 'string'
        ? document.getElementById(containerId)
        : containerId;
    if (!container) {
        return null;
    }
    const ace = window.ace;
    if (!ace || typeof ace.edit !== 'function') {
        return null;
    }
    const editor = ace.edit(container);
    editor.setTheme('ace/theme/github_light_default');
    editor.session.setMode('ace/mode/python');
    editor.session.setUseSoftTabs(true);
    editor.session.setTabSize(4);
    editor.session.setUseWrapMode(true);
    editor.setShowPrintMargin(false);
    editor.setHighlightActiveLine(true);
    editor.setOption('fontFamily', 'ui-monospace, SFMono-Regular, Menlo, monospace');
    editor.setOption('fontSize', '16px');
    editor.setOption('wrap', true);
    editor.setOption('showLineNumbers', true);
    editor.setOption('useWorker', false);
    editor.renderer.setScrollMargin(10, 10);
    editor.setValue(String(initialValue == null ? '' : initialValue), -1);
    editor.clearSelection();
    if (typeof onChange === 'function') {
        editor.session.on('change', () => {
            onChange(editor.getValue());
        });
    }
    return editor;
}
