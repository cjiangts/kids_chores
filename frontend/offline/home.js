// Package preparation view. All displayed chore data comes from IndexedDB.
(async () => {
    const query = new URLSearchParams(location.search);
    const errorEl = document.getElementById('offlineHomeError');
    const downloadBtn = document.getElementById('startOfflineDownload');
    const cancelBtn = document.getElementById('cancelOfflinePreparation');
    const progressEl = document.getElementById('offlineDownloadProgress');
    const statusEl = document.getElementById('offlineDownloadStatus');
    const progressBar = document.getElementById('offlineDownloadBar');
    let controller = null, downloadPromise = null, cancelling = false;
    function showError(message, status) {
        errorEl.textContent = message;
        errorEl.classList.toggle('hidden', !message);
        const login = document.getElementById('offlineSignIn');
        login.classList.toggle('hidden', status !== 401);
        login.href = `/family-login.html?${new URLSearchParams({ next: location.pathname + location.search })}`;
    }
    try {
        await window.OfflineParentClient.ready;
        if (window.OfflineParentClient.blocked) return;
        let setup = await window.OfflineSetupStore.getBoundSetup();
        if (!setup?.manifest) {
            document.getElementById('offlineNoPackageBack').classList.remove('hidden');
            throw new Error('This device has no offline package. Return to Choose user to prepare one.');
        }
        if (setup.id !== query.get('packageId') || String(setup.kidId) !== query.get('id')) {
            location.replace(`/offline/home.html?${new URLSearchParams({ id: setup.kidId, packageId: setup.id })}`);
            return;
        }
        const manifest = setup.manifest;
        window.KidAppNavigation.setSuppressed(setup.status !== 'active');
        if (setup.status === 'active') {
            window.KidAppNavigation.renderKidAvatarSwitcher(document.getElementById('offlineKidAvatar'), [{
                id: setup.kidId, name: manifest.kidName, avatarUrl: manifest.practiceConfig?.avatarUrl,
            }], { selectedKidId: String(setup.kidId), hideWhenLessThan: 1, showPoints: false, readOnly: true });
        }
        const resourceKey = (path) => new URL(path, location.origin).href;
        function taskResources(tasks) {
            const files = new Set();
            for (const task of tasks) {
                for (const card of task.cards || []) {
                    if (card.audioUrl) files.add(resourceKey(card.audioUrl));
                }
                if (task.delivery !== 'sheet') continue;
                files.add(resourceKey(`/api/kids/${setup.kidId}/sheet-tasks/${task.sheetTaskId}`));
                for (const item of task.items || []) {
                    const kind = item.sheet_kind === 'type2' ? 'type2/chinese-print-sheets' : 'type4/math-sheets';
                    files.add(resourceKey(`/api/kids/${setup.kidId}/${kind}/${item.sheet_id}?${new URLSearchParams({ categoryKey: task.categoryKey })}`));
                }
            }
            return files;
        }
        const uploadBtn = document.getElementById('uploadOfflinePackage');
        const deleteBtn = document.getElementById('deleteOfflinePackage');
        let packageBusy = false;
        const today = () => {
            const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: manifest.timezone,
                year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date()).map((part) => [part.type, part.value]));
            return `${parts.year}-${parts.month}-${parts.day}`;
        };
        let records = await window.OfflineSetupStore.readValue(`practice:${setup.id}`) || {};
        const megabytes = (bytes) => `${(bytes / 1000000).toFixed(1)} MB`;
        const jsonBytes = (value) => new Blob([JSON.stringify(value)]).size;
        // Refresh the worker policy as well as page scripts; old packages may
        // have been installed before management scripts received live updates.
        if ('serviceWorker' in navigator) {
            navigator.serviceWorker.getRegistration().then((registration) => registration?.update()).catch(() => {});
        }
        async function measureStorage() {
            const db = await window.OfflineSetupStore.inspectStorage();
            let cachedBytes = 0, fileCount = 0;
            const sizes = new Map();
            for (const name of await caches.keys()) {
                const cache = await caches.open(name);
                for (const request of await cache.keys()) {
                    const response = await cache.match(request);
                    if (!response) continue;
                    const bytes = (await response.blob()).size;
                    cachedBytes += bytes;
                    fileCount++;
                    if (name === `offline-package-${setup.id}`) sizes.set(resourceKey(request.url), bytes);
                }
            }
            return { db, cachedBytes, fileCount, sizes };
        }
        function showStorageTotal(bytes) {
            const button = document.getElementById('offlineBrowserStorage');
            button.textContent = `Storage ${megabytes(bytes)}`;
            button.title = 'Readable offline database contents plus all cached website files. Click for details; excludes browser storage overhead.';
        }
        async function refreshStorageTotal() {
            try {
                const { db, cachedBytes } = await measureStorage();
                showStorageTotal(db.bytes + cachedBytes);
            } catch (_) {
                document.getElementById('offlineBrowserStorage').textContent = 'Storage';
            }
        }
        document.getElementById('offlineBrowserStorage').addEventListener('click', async () => {
            const dialog = document.getElementById('offlineStorageDialog');
            const details = document.getElementById('offlineStorageDetails');
            details.textContent = 'Measuring…';
            if (!dialog.open) dialog.showModal();
            try {
                const { db, cachedBytes, fileCount, sizes } = await measureStorage();
                showStorageTotal(db.bytes + cachedBytes);
                const savedRecords = await window.OfflineSetupStore.readValue(`practice:${setup.id}`) || {};
                const estimate = await navigator.storage?.estimate?.().catch(() => null);
                details.replaceChildren();
                let explanationId = 0;
                function explain(label, value, explanation) {
                    const section = document.createElement('section');
                    section.className = 'offline-storage-item';
                    const row = document.createElement('div');
                    row.className = 'offline-storage-label';
                    const heading = document.createElement('strong');
                    heading.textContent = value ? `${label}: ${value}` : label;
                    const description = document.createElement('div');
                    description.id = `offline-storage-explanation-${++explanationId}`;
                    description.className = 'offline-storage-note';
                    description.setAttribute('popover', 'auto');
                    description.textContent = explanation;
                    const help = document.createElement('button');
                    help.type = 'button';
                    help.className = 'paradigm-icon-btn offline-storage-help';
                    help.textContent = '!';
                    help.setAttribute('aria-label', `Explain ${label}`);
                    help.setAttribute('aria-expanded', 'false');
                    help.setAttribute('aria-controls', description.id);
                    help.addEventListener('click', () => {
                        description.togglePopover();
                        if (!description.matches(':popover-open')) return;
                        const anchor = help.getBoundingClientRect();
                        const popup = description.getBoundingClientRect();
                        const left = Math.max(12, Math.min(anchor.right - popup.width, window.innerWidth - popup.width - 12));
                        const top = anchor.bottom + popup.height + 8 <= window.innerHeight - 12
                            ? anchor.bottom + 8 : Math.max(12, anchor.top - popup.height - 8);
                        description.style.left = `${left}px`;
                        description.style.top = `${top}px`;
                    });
                    description.addEventListener('toggle', () => {
                        help.setAttribute('aria-expanded', String(description.matches(':popover-open')));
                    });
                    row.append(heading, help);
                    section.append(row, description);
                    details.appendChild(section);
                    return section;
                }
                explain('Saved data', megabytes(db.bytes + cachedBytes),
                    'The total readable contents of this app’s offline database and all website file caches. This excludes browser database and filesystem overhead; it is not an exact disk-usage measurement.');
                explain('Offline database (IndexedDB)', megabytes(db.bytes),
                    'The offline database contents: task plans, questions and answers, progress, grades, notes, saved recordings and device settings. JSON data and recording bytes are counted.');
                explain('Cached resources', `${megabytes(cachedBytes)} · ${fileCount} resources`,
                    'The saved response bodies of pages, JavaScript, CSS, fonts, images, question audio and sheet data. Each cached URL entry counts as one resource, not one question or chore. Copies in different caches count separately.');
                try {
                    explain('Ready to upload', megabytes(await window.OfflineUpload.size(setup, savedRecords)),
                        'The current upload payload: task plan, results, parent grades and notes, recordings, and multipart form formatting. HTTP headers are excluded. This amount changes as the child practices and the parent reviews.');
                } catch (error) {
                    explain('Ready to upload', 'Unavailable', error.message);
                }
                explain('Browser estimate', Number.isFinite(estimate?.usage) ? megabytes(estimate.usage) : 'Unavailable',
                    'The browser’s own estimate for this website. It can include internal accounting and reserved write space, so it may keep rising after data is deleted. It is neither the offline package size nor RAM usage.');
                const daily = explain('Daily task data', '',
                    'Question JSON plus cached task audio and sheet data for each date. Shared app files are excluded. A file used on multiple days is counted for each day, so these values should not be added to Saved data.');
                for (let day = 0; day < setup.days; day++) {
                    const value = new Date(`${manifest.startDate}T00:00:00Z`);
                    value.setUTCDate(value.getUTCDate() + day);
                    const date = value.toISOString().slice(0, 10);
                    const tasks = manifest.tasks.filter((task) => task.date === date);
                    const bytes = jsonBytes(tasks) + [...taskResources(tasks)].reduce((total, path) => total + (sizes.get(path) || 0), 0);
                    const row = document.createElement('p');
                    row.textContent = `${date}: ${megabytes(bytes)}${setup.status !== 'active' ? ' saved so far' : ''}`;
                    daily.appendChild(row);
                }
                explain('Units', 'MB', 'MB means 1,000,000 bytes. Values are rounded to one decimal place.');
            } catch (error) { details.textContent = error.message; }
        });
        function choresForDay(date) {
            const tasks = manifest.tasks.filter((task) => task.date === date);
            if (date !== manifest.startDate) return tasks;
            const categories = Object.values(manifest.practiceConfig?.categoryMetaByKey || {});
            return [...tasks, ...(manifest.completedToday || []).map((name) => ({
                name, date, completedBeforeDownload: true,
                categoryKey: manifest.tasks.find((task) => task.name === name)?.categoryKey
                    || Object.entries(manifest.practiceConfig?.categoryMetaByKey || {}).find(([, category]) => category.display_name === name)?.[0],
                emoji: manifest.tasks.find((task) => task.name === name)?.emoji,
                delivery: manifest.tasks.find((task) => task.name === name)?.delivery
                    || (categories.some((category) => category.display_name === name) ? 'online' : 'offapp'),
            }))];
        }
        const stateFor = (task) => task.completedBeforeDownload ? 'done' : records[task.id]?.status || 'not_started';
        const stateLabel = (task) => ({ not_started: 'Not started', in_progress: 'In progress', pending_review: 'Needs review',
            corrections: 'Corrections', done: 'Done', closed: 'Ended' }[stateFor(task)] || 'Not started');
        async function refreshRecords() {
            try {
                records = await window.OfflineSetupStore.readValue(`practice:${setup.id}`) || {};
                renderTasks();
            } catch (error) { showError(error.message); }
        }
        document.getElementById('offlineKidName').textContent = 'Offline';
        document.title = `${manifest.kidName} - Offline practice`;
        function renderState() {
            const active = setup.status === 'active';
            uploadBtn.classList.toggle('hidden', !active);
            deleteBtn.classList.toggle('hidden', !active);
            if (active) progressEl.classList.add('hidden');
            downloadBtn.classList.toggle('hidden', active);
            cancelBtn.classList.toggle('hidden', active);
        }
        renderState();
        async function openReview(date, task) {
            if (packageBusy) return;
            if (!await window.OfflineParentAuth.token(setup) && !await window.OfflineParentAuth.enter(setup)) return;
            sessionStorage.setItem(`offline-review-day:${setup.id}`, date);
            const session = task && task.delivery !== 'offapp'
                ? manifest.tasks.indexOf(task) + 1 : null;
            location.href = session
                ? `/kid-session-report.html?${new URLSearchParams({ id: setup.kidId, sessionId: session })}`
                : `/admin.html?${new URLSearchParams({ offlineDay: date })}`;
        }
        for (const [button, deleting] of [[uploadBtn, false], [deleteBtn, true]]) {
            button.addEventListener('click', async () => {
                packageBusy = true;
                uploadBtn.disabled = deleteBtn.disabled = true;
                renderTasks();
                showError('');
                try {
                    const result = await window.PracticeManageCommon.requestWithPasswordDialog(
                        deleting ? 'delete this offline package and discard its unsynced results' : 'upload offline results and return to online mode',
                        async (password) => {
                            if (!deleting) {
                                try {
                                    const receipt = await window.OfflineUpload.upload(setup, password);
                                    return new Response(JSON.stringify(receipt));
                                } catch (error) {
                                    throw new Error([error.message, ...(error.blockers || []).map((item) => `• ${item.name}: ${item.reason}`)].join('\n'));
                                }
                            }
                            return fetch(`/api/offline/packages/${encodeURIComponent(setup.id)}/delete?${new URLSearchParams({ kidId: setup.kidId })}`, {
                                method: 'POST', headers: { ...window.PracticeManageCommon.buildPasswordHeaders(password, true), 'X-Offline-Device': setup.deviceId },
                                body: JSON.stringify({}),
                            });
                        }, deleting ? { warningMessage: `This permanently discards ${manifest.kidName}’s local results and recordings without uploading them, and returns ${manifest.kidName} to online mode. An internet connection is required.` } : {});
                    if (result.cancelled) return;
                    if (!result.ok) throw new Error(result.error);
                    if (deleting) {
                        await window.OfflineSetupStore.deletePackageData(setup.id);
                        await caches.delete(`offline-package-${setup.id}`);
                    }
                    location.replace('/family-home.html');
                } catch (error) { showError(error.message); }
                finally { packageBusy = false; uploadBtn.disabled = deleteBtn.disabled = false; renderTasks(); }
            });
        }
        function renderTasks() {
            const days = document.getElementById('offlineDays');
            const allChores = [...manifest.tasks, ...choresForDay(manifest.startDate).filter((task) => task.completedBeforeDownload)];
            const pending = allChores.filter((task) => stateFor(task) === 'pending_review').length;
            uploadBtn.disabled = packageBusy || pending > 0;
            uploadBtn.title = pending > 0 ? `Review ${pending} remaining ${pending === 1 ? 'chore' : 'chores'} before uploading` : '';
            days.replaceChildren();
            for (let day = 0; day < setup.days; day++) {
                const value = new Date(`${manifest.startDate}T00:00:00Z`);
                value.setUTCDate(value.getUTCDate() + day);
                const date = value.toISOString().slice(0, 10);
                const tasks = choresForDay(date);
                const details = document.createElement('div');
                details.className = 'offline-day';
                details.dataset.date = date;
                const heading = document.createElement('div');
                heading.className = 'offline-day-row';
                const label = document.createElement('span');
                label.textContent = `Day ${day + 1} · ${date}`;
                const progress = document.createElement('span');
                progress.className = 'offline-day-progress';
                const blocks = document.createElement('span');
                blocks.className = 'offline-chore-blocks';
                for (const task of [...tasks].sort((a, b) => (a.delivery === 'offapp') - (b.delivery === 'offapp'))) {
                    const block = document.createElement('button');
                    block.type = 'button';
                    const state = stateFor(task);
                    const colorClass = task.completedBeforeDownload ? 'is-excluded'
                        : ['done', 'closed'].includes(state) ? 'is-finished'
                        : ['in_progress', 'pending_review', 'corrections'].includes(state) ? 'is-pending' : '';
                    block.className = `offline-chore-block ${colorClass}`;
                    block.title = `${task.name}: ${task.completedBeforeDownload ? 'Completed before download · Not in package' : stateLabel(task)}`;
                    block.disabled = packageBusy || setup.status !== 'active' || date > today()
                        || !['is-finished', 'is-pending'].includes(colorClass);
                    block.addEventListener('click', () => openReview(date, task).catch((error) => showError(error.message)));
                    block.setAttribute('aria-label', block.title);
                    const glyph = document.createElement('span');
                    glyph.className = 'offline-chore-glyph';
                    glyph.setAttribute('aria-hidden', 'true');
                    const subject = window.SUBJECT_ICONS?.[task.categoryKey];
                    if (task.emoji) glyph.textContent = task.emoji;
                    else if (subject?.label) glyph.textContent = subject.label;
                    else glyph.innerHTML = window.icon(subject?.svg || (task.delivery === 'offapp' ? 'clipboard-check' : 'layers'), { size: '100%' });
                    block.appendChild(glyph);
                    blocks.appendChild(block);
                }
                progress.appendChild(blocks);
                heading.append(label);
                heading.appendChild(progress);
                details.appendChild(heading);
                days.appendChild(details);
            }
        }
        renderTasks();

        void refreshStorageTotal();
        window.addEventListener('pageshow', (event) => {
            if (event.persisted) { void refreshRecords(); void refreshStorageTotal(); }
        });
        document.getElementById('offlinePlan').classList.remove('hidden');
        downloadBtn.addEventListener('click', async () => {
            if (downloadPromise || cancelling) return;
            controller = new AbortController();
            showError('');
            downloadBtn.disabled = true;
            progressEl.classList.remove('hidden');
            downloadPromise = window.OfflineDownload.start(setup, {
                signal: controller.signal,
                onProgress({ stage, completed, total }) {
                    const messages = { checking: 'Checking package…', installing: 'Setting up browser offline support…',
                        clearing_storage: 'Resetting offline IndexedDB…', storage_blocked: 'Close other app tabs to finish resetting offline storage…',
                        opening_storage: 'Opening offline file storage…', verifying: 'Checking saved files…',
                        activating: 'Activating offline mode…', complete: 'Package downloaded and activated.' };
                    statusEl.textContent = messages[stage] || `Downloading ${completed} / ${total} files`;
                    progressBar.max = Math.max(1, total);
                    progressBar.value = completed;
                    cancelBtn.disabled = cancelling || ['clearing_storage', 'storage_blocked', 'activating', 'complete'].includes(stage);
                },
            });
            try {
                setup = await downloadPromise;
                location.replace('/family-home.html');
            } catch (error) {
                if (!cancelling) {
                    showError(error.message || 'Download interrupted. Please retry.', error.status);
                    downloadBtn.textContent = 'Retry download';
                    statusEl.textContent = 'Download paused. Saved files will be reused when you retry.';
                }
            } finally {
                downloadPromise = null;
                controller = null;
                downloadBtn.disabled = cancelling;
                cancelBtn.disabled = cancelling;
            }
        });
        cancelBtn.addEventListener('click', async () => {
            if (cancelling || cancelBtn.disabled) return;
            cancelling = true;
            cancelBtn.disabled = true;
            downloadBtn.disabled = true;
            cancelBtn.textContent = 'Cancelling…';
            controller?.abort();
            try {
                await downloadPromise?.catch(() => {});
                await window.OfflineDownload.cancel(setup);
                location.replace('/family-home.html');
            } catch (error) {
                showError(error.message || 'Connect to the internet to cancel preparation.', error.status);
                cancelling = false;
                cancelBtn.disabled = false;
                cancelBtn.textContent = 'Cancel';
                downloadBtn.disabled = false;
            }
        });
    } catch (error) {
        showError(error.message);
    }
})();
