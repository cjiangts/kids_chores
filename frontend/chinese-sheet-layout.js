/* Shared by the Chinese sheet builder and printable page. */
window.ChineseSheetLayout = (() => {
    function cards(row) {
        return row.cards?.length ? row.cards : [{
            card_id: row.cardId ?? row.card_id,
            front: row.character ?? row.front,
            back: row.back,
        }];
    }

    function capacity(columns, emptyCount) {
        return Math.max(1, Math.ceil((columns - 1) / (emptyCount + 1)));
    }

    function cells(row, columns, emptyCount) {
        const selected = cards(row);
        const groups = capacity(columns, emptyCount);
        const base = Math.floor(groups / selected.length);
        const remainder = groups % selected.length;
        const assignments = selected.flatMap((card, index) => (
            Array(base + (index < remainder ? 1 : 0)).fill(card)
        ));
        const occurrences = new Map();
        return Array.from({ length: columns }, (_, column) => {
            const group = Math.min(Math.floor(column / (emptyCount + 1)), groups - 1);
            const card = assignments[group];
            if (column % (emptyCount + 1) !== 0 || column === columns - 1) {
                return { type: 'empty', card };
            }
            const chars = [...String(card.front || card.back || '')];
            const offset = occurrences.get(card) || 0;
            occurrences.set(card, offset + 1);
            return { type: 'demo', char: chars[offset % chars.length] || '', card };
        });
    }
    return { cards, capacity, cells };
})();
