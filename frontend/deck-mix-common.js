(function initDeckMixCommon(window) {
    function getPointerClientX(event) {
        if (Number.isFinite(event?.clientX)) {
            return Number(event.clientX);
        }
        return null;
    }

    function renderMixBar({
        mixBarEl,
        optedDecks,
        percents,
        mixColors,
        escapeHtml,
    }) {
        if (!mixBarEl) {
            return;
        }

        const safeDecks = Array.isArray(optedDecks) ? optedDecks : [];
        const safePercents = Array.isArray(percents) ? percents : [];
        const colors = Array.isArray(mixColors) ? mixColors : [];

        let cumulative = 0;
        const segmentHtml = safeDecks
            .map((deck, index) => {
                const percent = Number.parseInt(safePercents[index], 10) || 0;
                const color = colors.length > 0 ? colors[index % colors.length] : '#74c0fc';
                const name = typeof escapeHtml === 'function'
                    ? escapeHtml(deck?.name || '')
                    : String(deck?.name || '');
                return `<div class="mix-segment" style="width:${percent}%;background:${color};" title="${name}: ${percent}%"></div>`;
            })
            .join('');

        const handleHtml = safeDecks
            .slice(0, -1)
            .map((_, index) => {
                const leftPct = Number.parseInt(safePercents[index], 10) || 0;
                const rightPct = Number.parseInt(safePercents[index + 1], 10) || 0;
                const pairTotal = leftPct + rightPct;
                const draggable = pairTotal > 0;
                cumulative += leftPct;
                const className = draggable ? 'mix-handle' : 'mix-handle mix-handle-disabled';
                const pointerStyle = draggable ? '' : 'pointer-events:none;opacity:0.45;';
                return `<button type="button" class="${className}" data-handle-index="${index}" data-draggable="${draggable ? 'true' : 'false'}" style="left:${cumulative}%;${pointerStyle}" aria-label="Adjust mix divider ${index + 1}"></button>`;
            })
            .join('');

        mixBarEl.innerHTML = `${segmentHtml}${handleHtml}`;
    }

    function onMixBarPointerDown(event, {
        mixBarEl,
        getOptedDecks,
        normalizeMix,
        getPercentForDeck,
        setMixByDeckFromPercentArray,
        renderMixEditor,
    }) {
        const handle = event.target.closest('[data-handle-index]');
        if (!handle) {
            return;
        }
        if (String(handle.getAttribute('data-draggable') || 'true') !== 'true') {
            return;
        }

        const handleIndex = Number(handle.getAttribute('data-handle-index') || -1);
        if (!(handleIndex >= 0)) {
            return;
        }

        const optedDecks = typeof getOptedDecks === 'function' ? getOptedDecks() : [];
        if (!Array.isArray(optedDecks) || optedDecks.length < 2 || handleIndex >= optedDecks.length - 1) {
            return;
        }
        if (typeof normalizeMix === 'function') {
            normalizeMix();
        }

        const startX = getPointerClientX(event);
        const rect = mixBarEl?.getBoundingClientRect?.();
        if (!Number.isFinite(startX) || !rect || rect.width <= 0) {
            return;
        }

        const startPercents = optedDecks.map((deck) => {
            const value = typeof getPercentForDeck === 'function' ? getPercentForDeck(deck) : 0;
            return Number.parseInt(value, 10) || 0;
        });
        const pairTotal = startPercents[handleIndex] + startPercents[handleIndex + 1];

        const onMove = (moveEvent) => {
            const moveX = getPointerClientX(moveEvent);
            if (!Number.isFinite(moveX)) {
                return;
            }
            const deltaPercent = ((moveX - startX) / rect.width) * 100;
            let nextLeft = startPercents[handleIndex] + deltaPercent;
            if (nextLeft < 0) {
                nextLeft = 0;
            }
            if (nextLeft > pairTotal) {
                nextLeft = pairTotal;
            }

            const next = [...startPercents];
            next[handleIndex] = Math.round(nextLeft);
            next[handleIndex + 1] = pairTotal - next[handleIndex];
            if (typeof setMixByDeckFromPercentArray === 'function') {
                setMixByDeckFromPercentArray(optedDecks, next);
            }
            if (typeof renderMixEditor === 'function') {
                renderMixEditor();
            }
        };

        const onUp = () => {
            window.removeEventListener('pointermove', onMove);
            window.removeEventListener('pointerup', onUp);
            window.removeEventListener('pointercancel', onUp);
        };

        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', onUp);
        window.addEventListener('pointercancel', onUp);
        event.preventDefault();
    }

    window.SharedDeckMix = {
        renderMixBar,
        onMixBarPointerDown,
    };
}(window));
