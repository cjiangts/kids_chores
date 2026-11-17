// Package installation owns downloading, verification and the activation handshake.
// Tasks stay in the existing IndexedDB store; files live in a package-specific cache.
window.OfflineDownload = (() => {
    const cacheName = (setup) => `offline-package-${setup.id}`;
    const homeAssets = ['/offline/home.html', '/offline/home.css', '/offline/home.js',
        '/offline/store.js', '/offline/download.js', '/subject-icons.js', '/family-user-switcher.js'];

    async function within(promise, message) {
        let timer;
        try {
            return await Promise.race([promise, new Promise((_, reject) => {
                timer = setTimeout(() => reject(new Error(message)), 20000);
            })]);
        } finally { clearTimeout(timer); }
    }

    async function api(setup, action = '', body, signal) {
        const query = new URLSearchParams({ kidId: setup.kidId });
        const response = await fetch(`/api/offline/packages/${encodeURIComponent(setup.id)}${action}?${query}`, {
            method: body === undefined ? 'GET' : 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Offline-Device': setup.deviceId },
            body: body === undefined ? undefined : JSON.stringify(body),
            cache: 'no-store', signal,
        });
        const payload = await response.json();
        if (!response.ok) {
            const error = new Error(payload.error || 'Could not update the offline package.');
            error.status = response.status;
            throw error;
        }
        return payload;
    }

    function waitForWorker(worker) {
        if (worker?.state === 'activated') return Promise.resolve();
        if (!worker) return Promise.reject(new Error('The offline worker is unavailable. Please reload and retry.'));
        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => finish(new Error('Offline installation timed out. Please retry.')), 20000);
            function finish(error) {
                clearTimeout(timeout);
                worker.removeEventListener('statechange', changed);
                error ? reject(error) : resolve();
            }
            function changed() {
                if (worker.state === 'activated') finish();
                if (worker.state === 'redundant') finish(new Error('Offline installation was interrupted. Please retry.'));
            }
            worker.addEventListener('statechange', changed);
            changed();
        });
    }

    async function installWorker() {
        if (!('serviceWorker' in navigator) || !('caches' in window)) {
            throw new Error('Offline downloads need a secure browser connection with offline storage enabled.');
        }
        const registration = await within(navigator.serviceWorker.register('/service-worker.js', {
            scope: '/', updateViaCache: 'none',
        }), 'Offline support registration timed out. Fully quit and reopen the browser, then retry using this same URL. Your saved package is kept.');
        await waitForWorker(registration.installing || registration.waiting || registration.active);
        await within(navigator.serviceWorker.ready, 'The browser did not finish activating offline support. Close other app tabs, then reload and retry.');
    }

    function resourceUrl(path) {
        const url = new URL(path, location.origin);
        if (url.origin !== location.origin) throw new Error('An offline resource is hosted outside this app.');
        return url.href;
    }

    async function start(setup, { signal, onProgress = () => {} } = {}) {
        onProgress({ stage: 'checking', completed: 0, total: 0 });
        const server = await within(api(setup, '', undefined, signal), 'Checking the package timed out. Check your connection and retry.');
        if (!['preparing', 'active'].includes(server.status)) {
            throw new Error('This package has already ended.');
        }
        if (!setup.manifest.practiceConfig && server.practiceConfig) {
            setup = { ...setup, manifest: { ...setup.manifest, practiceConfig: server.practiceConfig } };
        }
        if (server.status === 'preparing' && setup.status === 'preparing') {
            onProgress({ stage: 'clearing_storage', completed: 0, total: 0 });
            await window.OfflineSetupStore.resetForDownload(setup, () => {
                onProgress({ stage: 'storage_blocked', completed: 0, total: 0 });
            });
        }
        onProgress({ stage: 'installing', completed: 0, total: 0 });
        await installWorker();
        // Persistence is best effort; a denial must not prevent downloading.
        try { navigator.storage?.persist?.().catch(() => {}); } catch (_) { /* Browser policy. */ }
        onProgress({ stage: 'opening_storage', completed: 0, total: 0 });
        const cache = await within(caches.open(cacheName(setup)), 'The browser could not open offline file storage. Close other app tabs, then reload and retry.');
        const avatar = setup.manifest.practiceConfig?.avatarUrl;
        const urls = [...new Set([...homeAssets, ...(server.assets || []), ...(setup.manifest.assets || []), ...(avatar ? [avatar] : [])].map(resourceUrl))];
        const snapshots = Object.entries(setup.manifest.snapshots || {});
        const total = urls.length + snapshots.length;
        let completed = 0;
        const progress = (stage = 'downloading') => onProgress({ stage, completed, total });
        progress();
        for (const [path, data] of snapshots) {
            signal?.throwIfAborted();
            await cache.put(resourceUrl(path), new Response(JSON.stringify(data), {
                headers: { 'Content-Type': 'application/json' },
            }));
            completed += 1;
            progress();
        }
        for (const url of urls) {
            signal?.throwIfAborted();
            const refreshParentUi = setup.status === 'active' && !setup.parentReady && /\.(html|css|js)$/.test(new URL(url).pathname);
            if (refreshParentUi || !(await cache.match(url))) {
                const response = await fetch(url, {
                    cache: 'no-store', signal, redirect: 'error',
                    headers: { 'X-Offline-Download': '1', 'X-Offline-Package': setup.id, 'X-Offline-Device': setup.deviceId },
                });
                if (!response.ok) {
                    const error = new Error(`Could not download ${new URL(url).pathname} (${response.status}). Please retry.`);
                    error.status = response.status;
                    throw error;
                }
                const type = response.headers.get('Content-Type') || '';
                if (!new URL(url).pathname.endsWith('.html') && type.includes('text/html')) {
                    throw new Error(`The server did not return the expected file: ${new URL(url).pathname}`);
                }
                // Cache.put completes after consuming the entire response body.
                await cache.put(url, response);
            }
            completed += 1;
            progress();
        }
        progress('verifying');
        for (const url of [...urls, ...snapshots.map(([path]) => resourceUrl(path))]) {
            signal?.throwIfAborted();
            if (!(await cache.match(url))) throw new Error('A downloaded file is missing. Please retry.');
        }
        // Commit the local readiness marker before the server may become active.
        const downloaded = { ...setup, downloadedAt: new Date().toISOString(), resourceCount: total,
            parentReady: true };
        await window.OfflineSetupStore.saveSetup(downloaded);
        signal?.throwIfAborted();
        progress('activating');
        await api(setup, '/activate', { handoff: setup.manifest.handoff }, signal);
        const active = { ...downloaded, status: 'active' };
        await window.OfflineSetupStore.saveSetup(active);
        progress('complete');
        return active;
    }

    async function cancel(setup) {
        // Server acknowledgement comes first: losing the local copy must never orphan its lock.
        await api(setup, '/cancel', {});
        if ('caches' in window) {
            try { await caches.delete(cacheName(setup)); } catch (error) { console.warn('Could not remove cancelled package cache:', error); }
        }
        await window.OfflineSetupStore.deletePackageData(setup.id);
    }

    return { start, cancel, installWorker };
})();
