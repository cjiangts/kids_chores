// Device-owned offline package storage. No plaintext passwords or login tokens.
globalThis.OfflineSetupStore = (() => {
    let database;
    function notifyBindingChanged() {
        if (!('BroadcastChannel' in globalThis)) return;
        try {
            const channel = new BroadcastChannel('mommy-offline-binding');
            channel.postMessage('changed');
            channel.close();
        } catch (_) { /* Cross-tab notification is optional. */ }
    }
    function open() {
        if (database) return database;
        database = new Promise((resolve, reject) => {
            const request = indexedDB.open('mommy-offline', 1);
            request.onupgradeneeded = () => {
                request.result.createObjectStore('metadata');
                request.result.createObjectStore('setups', { keyPath: 'id' });
            };
            request.onsuccess = () => {
                const db = request.result;
                db.onversionchange = () => { db.close(); database = null; };
                resolve(db);
            };
            request.onerror = () => { database = null; reject(request.error); };
            request.onblocked = () => { database = null; reject(new Error('Close other app tabs and try again.')); };
        });
        return database;
    }
    async function deviceId() {
        const db = await open();
        return new Promise((resolve, reject) => {
            const tx = db.transaction('metadata', 'readwrite');
            const store = tx.objectStore('metadata');
            const request = store.get('deviceId');
            let id;
            request.onsuccess = () => {
                id = request.result || crypto.randomUUID();
                if (!request.result) store.put(id, 'deviceId');
            };
            tx.oncomplete = () => resolve(id);
            tx.onabort = () => reject(tx.error || new Error('Could not save device information.'));
        });
    }
    async function saveSetup(setup) {
        const db = await open();
        return new Promise((resolve, reject) => {
            const tx = db.transaction('setups', 'readwrite');
            tx.objectStore('setups').put(setup);
            tx.oncomplete = () => { notifyBindingChanged(); resolve(); };
            tx.onabort = () => reject(tx.error || new Error('Could not save offline setup on this device.'));
        });
    }
    async function getSetup(id, kidId) {
        const db = await open();
        return new Promise((resolve, reject) => {
            const tx = db.transaction('setups', 'readonly');
            const request = id ? tx.objectStore('setups').get(id) : tx.objectStore('setups').getAll();
            let setup;
            request.onsuccess = () => {
                setup = id ? request.result : request.result
                    .filter((item) => String(item.kidId) === String(kidId))
                    .sort((a, b) => String(b.savedAt).localeCompare(String(a.savedAt)))[0];
            };
            tx.oncomplete = () => resolve(setup);
            tx.onabort = () => reject(tx.error || new Error('Could not read the offline package.'));
        });
    }
    async function getBoundSetup() {
        const db = await open();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(['metadata', 'setups'], 'readonly');
            const device = tx.objectStore('metadata').get('deviceId');
            const setups = tx.objectStore('setups').getAll();
            tx.oncomplete = () => resolve(setups.result
                .filter((setup) => device.result && setup.deviceId === device.result
                    && (setup.status === 'preparing' || setup.status === 'active'))
                .sort((a, b) => String(b.savedAt).localeCompare(String(a.savedAt)))[0]);
            tx.onabort = () => reject(tx.error || new Error('Could not read this device’s offline binding.'));
        });
    }
    async function readValue(key) {
        const db = await open();
        return new Promise((resolve, reject) => {
            const tx = db.transaction('metadata', 'readonly');
            const request = tx.objectStore('metadata').get(key);
            tx.oncomplete = () => resolve(request.result);
            tx.onabort = () => reject(tx.error || new Error('Could not read local practice data.'));
        });
    }
    async function changeValue(key, change) {
        const db = await open();
        return new Promise((resolve, reject) => {
            const tx = db.transaction('metadata', 'readwrite');
            const store = tx.objectStore('metadata');
            const request = store.get(key);
            let value, failure;
            request.onsuccess = () => {
                try {
                    value = change(request.result, store);
                    store.put(value, key);
                } catch (error) { failure = error; tx.abort(); }
            };
            tx.oncomplete = () => resolve(value);
            tx.onabort = () => reject(failure || tx.error || new Error('Could not save local practice data.'));
        });
    }
    async function deletePackageData(id) {
        const db = await open();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(['metadata', 'setups'], 'readwrite');
            tx.objectStore('setups').delete(id);
            const cursor = tx.objectStore('metadata').openCursor();
            cursor.onsuccess = () => {
                const item = cursor.result;
                if (!item) return;
                if (item.key === `practice:${id}` || item.key === `parent-auth:${id}`
                    || String(item.key).startsWith(`audio:${id}:`)) item.delete();
                item.continue();
            };
            tx.oncomplete = () => { notifyBindingChanged(); resolve(); };
            tx.onabort = () => reject(tx.error || new Error('Could not delete local offline data.'));
        });
    }
    async function inspectStorage() {
        const db = await open();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(['metadata', 'setups'], 'readonly');
            const result = { bytes: 0, entries: 0, packages: [] };
            for (const name of ['metadata', 'setups']) {
                const request = tx.objectStore(name).openCursor();
                request.onsuccess = () => {
                    const item = request.result;
                    if (!item) return;
                    result.entries++;
                    result.bytes += new Blob([JSON.stringify(item.value)]).size;
                    if (item.value?.blob instanceof Blob) result.bytes += item.value.blob.size;
                    if (name === 'setups') result.packages.push({ id: item.value.id, status: item.value.status });
                    item.continue();
                };
            }
            tx.oncomplete = () => resolve(result);
            tx.onabort = () => reject(tx.error || new Error('Could not inspect offline storage.'));
        });
    }
    async function resetForDownload(setup, onBlocked = () => {}) {
        if (setup.status !== 'preparing') throw new Error('Only a preparing package can reset local storage.');
        const db = await open();
        const hasLivePackage = await new Promise((resolve, reject) => {
            const tx = db.transaction('setups', 'readonly');
            const request = tx.objectStore('setups').getAll();
            tx.oncomplete = () => resolve(request.result.some((item) => item.status === 'active'
                || (item.status === 'preparing' && item.id !== setup?.id)));
            tx.onabort = () => reject(tx.error || new Error('Could not check existing offline packages.'));
        });
        if (hasLivePackage) throw new Error('Finish or delete the existing offline package on this device first.');
        // Preserve device identity, but recreate the offline database so old
        // manifests and recording storage are actually released.
        const id = await deviceId();
        const auth = setup ? await readValue(`parent-auth:${setup.id}`) : null;
        db.close();
        database = null;
        await new Promise((resolve, reject) => {
            const request = indexedDB.deleteDatabase('mommy-offline');
            request.onsuccess = resolve;
            request.onerror = () => reject(request.error || new Error('Could not reset offline storage.'));
            // Keep waiting so closing the blocking tab completes this same reset
            // and restores the saved preparation, rather than leaving a pending deletion.
            request.onblocked = onBlocked;
        });
        const fresh = await open();
        await new Promise((resolve, reject) => {
            const tx = fresh.transaction(['metadata', 'setups'], 'readwrite');
            tx.objectStore('metadata').put(id, 'deviceId');
            if (setup) tx.objectStore('setups').put(setup);
            if (auth) tx.objectStore('metadata').put(auth, `parent-auth:${setup.id}`);
            tx.oncomplete = () => { notifyBindingChanged(); resolve(); };
            tx.onabort = () => reject(tx.error || new Error('Could not restore package preparation after storage reset.'));
        });
        if ('caches' in globalThis) {
            const names = await caches.keys();
            await Promise.all(names.filter((name) => name.startsWith('offline-package-') || name.startsWith('kids-chores-offline-'))
                .map((name) => caches.delete(name)));
        }
    }
    return { deviceId, saveSetup, getSetup, getBoundSetup, deletePackageData, resetForDownload, inspectStorage, readValue, changeValue };
})();
