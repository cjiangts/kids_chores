// Shapes and identities come from the same JSON dictionary used by backend TTS.
window.ChineseStrokes = (() => {
    const entries = window.ChineseStrokeData.strokes;
    const byCharacter = new Map();
    for (const entry of entries) {
        for (const character of [entry.character, ...entry.aliases]) byCharacter.set(character, entry);
    }
    const escape = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    })[char]);

    function renderGlyph(entry) {
        return `<svg class="chinese-stroke-glyph" viewBox="0 0 100 100" role="img" aria-label="${escape(entry.name)}" data-stroke-id="${escape(entry.id)}" xmlns="http://www.w3.org/2000/svg"><path d="${escape(entry.path)}" fill="none" stroke="currentColor" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
    }

    function renderText(text) {
        return Array.from(String(text ?? '')).map((char) => {
            const entry = byCharacter.get(char);
            return entry ? renderGlyph(entry) : escape(char);
        }).join('');
    }

    return { renderText };
})();
