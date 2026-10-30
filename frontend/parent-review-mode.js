window.ParentReviewMode = (() => {
    async function loadToggle({ kidId, categoryKey, buttonId, supported, route, field, label }) {
        const button = document.getElementById(buttonId);
        if (!button) return;
        button.classList.toggle('hidden', !supported);
        if (!supported) return;
        const url = `/api/kids/${encodeURIComponent(kidId)}/${route}`;
        let data = await window.SheetTaskView.request(`${url}?${new URLSearchParams({ categoryKey })}`);
        const render = () => {
            button.classList.toggle('active', Boolean(data[field]));
            button.setAttribute('aria-pressed', String(Boolean(data[field])));
            button.textContent = `${label}: ${data[field] ? 'On' : 'Off'}`;
        };
        render();
        button.onclick = async () => {
            if (button.disabled) return;
            button.disabled = true;
            try {
                data = await window.SheetTaskView.request(url, {
                    method: 'PUT', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ categoryKey, [field]: !data[field] }),
                });
                render();
            } catch (error) { showError(error.message); }
            finally { button.disabled = false; }
        };
    }
    async function load(kidId, categoryKey, deliveryMode) {
        await loadToggle({
            kidId, categoryKey, buttonId: 'parentReviewToggle',
            supported: isType2Behavior() && deliveryMode !== 'sheet',
            route: 'type2/review-mode', field: 'parent_review_required', label: 'Parent review',
        });
        await loadToggle({
            kidId, categoryKey, buttonId: 'speedDrillToggle',
            supported: isDrillSpeedSettingApplicable() && deliveryMode !== 'sheet',
            route: 'cards/speed-drill-mode', field: 'speed_drill_enabled', label: 'Speed Drill',
        });
    }
    return { load };
})();
