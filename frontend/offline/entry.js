// Family-home entry: the server reserves the child while the device saves its package.
window.OfflineEntry = (() => {
    async function getBoundKid() {
        let setup;
        try { setup = await window.OfflineSetupStore.getBoundSetup(); }
        catch (_) { return null; } // Keep the online picker usable without local storage.
        if (setup?.status !== 'active') return null;
        return { id: setup.kidId, name: setup.manifest.kidName,
            avatarUrl: setup.manifest.practiceConfig?.avatarUrl,
            offlineMode: { id: setup.id, status: setup.status } };
    }
    function init({ onReady }) {
        const dialog = document.getElementById('offlineSetupDialog');
        if (!dialog) return;
        const childEl = dialog.querySelector('[data-offline-child]');
        const daysEl = dialog.querySelector('[data-offline-days]');
        const errorDialog = document.getElementById('offlineSetupErrorDialog');
        const errorEl = errorDialog.querySelector('#offlineSetupErrorMessage');
        const blockersEl = errorDialog.querySelector('[data-offline-blockers]');
        const form = dialog.querySelector('form');
        const confirm = dialog.querySelector('[data-offline-confirm]');
        const down = dialog.querySelector('[data-offline-step="-1"]');
        const up = dialog.querySelector('[data-offline-step="1"]');
        const existing = dialog.querySelector('[data-offline-existing]');
        const forceDelete = dialog.querySelector('[data-offline-force-delete]');
        function displayPackage() {
            const offline = kid?.offlineMode;
            existing.classList.toggle('hidden', !offline);
            dialog.querySelector('.offline-days-row').classList.toggle('hidden', Boolean(offline));
            confirm.classList.toggle('hidden', Boolean(offline));
            forceDelete.classList.toggle('hidden', !offline);
            if (offline) {
                dialog.querySelector('[data-offline-device]').textContent = `Device ID: ${offline.deviceId}`;
                dialog.querySelector('[data-offline-activated]').textContent = offline.activatedAt
                    ? `Offline since: ${new Date(offline.activatedAt).toLocaleString()}` : 'Preparing · Not activated yet';
            }
        }
        let kid = null, days = 7, min = 1, max = 30, busy = false, loading = false;
        function error(message, blockers = []) {
            errorEl.textContent = message;
            blockersEl.replaceChildren();
            for (const blocker of blockers) {
                const item = document.createElement('li');
                const name = document.createElement('strong');
                name.textContent = blocker.name;
                const reason = document.createElement('span');
                reason.textContent = blocker.reason;
                item.append(name, reason);
                blockersEl.appendChild(item);
            }
            blockersEl.classList.toggle('hidden', !blockers.length);
            if (!errorDialog.open) errorDialog.showModal();
        }
        function update() {
            daysEl.textContent = String(days);
            down.disabled = busy || loading || days <= min;
            up.disabled = busy || loading || days >= max;
            confirm.disabled = busy || loading || !kid;
            forceDelete.disabled = busy || loading;
            confirm.textContent = busy ? 'Preparing…' : 'Continue';
            dialog.querySelectorAll('[data-offline-cancel]').forEach((button) => { button.disabled = busy; });
        }
        document.getElementById('kidsManageList').addEventListener('click', async (event) => {
            const trigger = event.target.closest('[data-action="prepare-offline"]');
            if (!trigger || trigger.disabled || busy || loading) return;
            const row = trigger.closest('[data-kid-id]');
            const kidId = row.dataset.kidId;
            childEl.replaceChildren();
            const avatar = row.querySelector('[data-kid-avatar]').cloneNode(true);
            avatar.removeAttribute('data-kid-avatar');
            const name = document.createElement('span');
            name.textContent = row.querySelector('.kids-manage-name').textContent;
            childEl.append(avatar, name);
            kid = null;
            displayPackage();
            loading = true;
            days = 7;
            update();
            dialog.showModal();
            try {
                const response = await fetch('/api/offline/setup');
                const data = await response.json();
                if (!response.ok) throw new Error(data.error || 'Could not prepare offline practice.');
                kid = data.kids.find((item) => String(item.id) === kidId);
                if (!kid) {
                    dialog.close();
                    return;
                }
                displayPackage();
                days = data.defaultDays; min = data.minDays; max = data.maxDays;
            } catch (failure) { error(failure.message); }
            finally { loading = false; update(); }
        });
        dialog.querySelectorAll('[data-offline-cancel]').forEach((button) => button.addEventListener('click', () => { if (!busy) dialog.close(); }));
        dialog.addEventListener('cancel', (event) => { if (busy) event.preventDefault(); });
        forceDelete.addEventListener('click', async () => {
            if (busy || !kid?.offlineMode) return;
            busy = true; update();
            // Native modal dialogs sit above the shared password overlay.
            dialog.close();
            try {
                const result = await window.PracticeManageCommon.requestWithPasswordDialog(
                    `delete ${kid.name}’s offline package on the other device`,
                    (password) => fetch(`/api/offline/packages/${encodeURIComponent(kid.offlineMode.id)}/force-delete?${new URLSearchParams({ kidId: kid.id })}`, {
                        method: 'POST', headers: window.PracticeManageCommon.buildPasswordHeaders(password, true), body: '{}',
                    }),
                    { warningMessage: `The other device will no longer be able to upload ${kid.name}’s offline results.` });
                if (result.cancelled) {
                    dialog.showModal();
                    return;
                }
                if (!result.ok) throw new Error(result.error);
                dialog.close();
                location.reload();
            } catch (failure) {
                dialog.showModal();
                error(failure.message);
            }
            finally { busy = false; update(); }
        });
        for (const button of [down, up]) button.addEventListener('click', () => {
            days = Math.max(min, Math.min(max, days + Number(button.dataset.offlineStep)));
            update();
        });
        form.addEventListener('submit', async (event) => {
            event.preventDefault();
            if (busy || loading || !kid || kid.offlineMode) return;
            busy = true; update();
            try {
                const deviceId = await window.OfflineSetupStore.deviceId();
                const response = await fetch('/api/offline/setup', {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ kidId: kid.id, days, deviceId }),
                });
                const payload = await response.json();
                if (!response.ok) {
                    const failure = new Error(payload.error || 'Could not prepare offline practice.');
                    failure.blockers = payload.blockers || [];
                    throw failure;
                }
                const setup = { ...payload, deviceId, kidName: kid.name, savedAt: new Date().toISOString() };
                await window.OfflineSetupStore.saveSetup(setup);
                await window.OfflineParentAuth.grant(setup);
                dialog.close();
                await onReady(kid, setup);
            } catch (failure) { error(failure.message, failure.blockers); }
            finally { busy = false; update(); }
        });
    }
    return { init, getBoundKid };
})();
