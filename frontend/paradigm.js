(function () {
    function autoSizeMultilineInput(input) {
        if (!(input instanceof HTMLTextAreaElement)) return;
        input.style.height = 'auto';
        input.style.height = `${Math.max(28, input.scrollHeight)}px`;
    }

    function enableSheetSwipeToClose(modal, close) {
        if (!(modal instanceof HTMLElement) || typeof close !== 'function' || modal.dataset.sheetSwipeCloseBound) return;
        const handle = modal.querySelector('.paradigm-sheet-header');
        if (!(handle instanceof HTMLElement)) return;
        modal.dataset.sheetSwipeCloseBound = 'true';
        let start = null;
        handle.addEventListener('pointerdown', (event) => {
            if (event.pointerType === 'mouse' || event.button !== 0) return;
            start = { x: event.clientX, y: event.clientY, id: event.pointerId };
            handle.setPointerCapture?.(event.pointerId);
        });
        handle.addEventListener('pointerup', (event) => {
            if (!start || start.id !== event.pointerId) return;
            const dx = event.clientX - start.x;
            const dy = event.clientY - start.y;
            start = null;
            handle.releasePointerCapture?.(event.pointerId);
            if (dy >= 64 && dy > Math.abs(dx)) close();
        });
        handle.addEventListener('pointercancel', () => { start = null; });
    }

    window.Paradigm = window.Paradigm || {};
    window.Paradigm.autoSizeMultilineInput = autoSizeMultilineInput;
    window.Paradigm.enableSheetSwipeToClose = enableSheetSwipeToClose;
})();
