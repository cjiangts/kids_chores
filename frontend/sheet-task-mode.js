window.SheetTaskMode = (() => {
    async function load(kidId, categoryKey) {
        const root = document.getElementById('sheetTaskMode');
        if (!root) return;
        const url = `/api/kids/${encodeURIComponent(kidId)}/sheet-tasks?${new URLSearchParams({ categoryKey })}`;
        let data = await window.SheetTaskView.request(url);
        await window.ParentReviewMode?.load(kidId, categoryKey, data.mode);
        root.classList.toggle('hidden', !data.supported);
        if (!data.supported) return;
        root.replaceChildren();
        const toggle = document.createElement('div');
        toggle.className = 'paradigm-chip-toggle-group paradigm-segmented-toggle';
        toggle.setAttribute('role', 'group');
        toggle.setAttribute('aria-label', 'Task format');
        const buttons = [];
        function render() {
            root.dataset.mode = data.mode;
            const stock = Math.max(0, Number(data.remaining_count) || 0);
            const shortage = data.mode === 'sheet' && data.shortage;
            const stockLabel = document.getElementById('printedQuestionStock');
            if (stockLabel) stockLabel.textContent = String(stock);
            document.getElementById('printedQuestionShortage')?.classList.toggle('hidden', !shortage);
            const sheetsLink = document.getElementById('openPrintableSheetsBtn');
            if (sheetsLink) {
                const label = `Manage worksheets · ${stock} unassigned questions remaining${shortage ? ' · Printed question stock is below the daily target' : ''}`;
                sheetsLink.title = label;
                sheetsLink.setAttribute('aria-label', label);
            }
            if (typeof applySessionCardCountCapToInput === 'function') applySessionCardCountCapToInput();
            buttons.forEach((button) => {
                const active = button.dataset.mode === data.mode;
                button.classList.toggle('active', active);
                button.setAttribute('aria-pressed', String(active));
                button.disabled = button.dataset.mode === 'sheet' && data.mode !== 'sheet' && data.remaining_count === 0 && data.task?.status !== 'in_progress';
            });
        }
        for (const mode of ['online', 'sheet']) {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'paradigm-chip-toggle';
            button.dataset.mode = mode;
            button.textContent = mode === 'sheet' ? 'Sheet' : 'Online';
            button.addEventListener('click', async () => {
                buttons.forEach((item) => { item.disabled = true; });
                try {
                    data = await window.SheetTaskView.request(`/api/kids/${encodeURIComponent(kidId)}/sheet-tasks/mode`, {
                        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ categoryKey, mode }),
                    });
                    render();
                    await window.ParentReviewMode?.load(kidId, categoryKey, data.mode);
                } catch (error) { render(); showError(error.message); }
            });
            buttons.push(button);
            toggle.appendChild(button);
        }
        root.append(toggle);
        render();
    }
    window.addEventListener('focus', () => {
        const params = new URLSearchParams(location.search);
        if (params.get('id') && params.get('categoryKey')) load(params.get('id'), params.get('categoryKey')).catch(() => {});
    });
    return { load };
})();
