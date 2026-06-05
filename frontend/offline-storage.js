/**
 * Offline-mode IndexedDB wrapper.
 *
 * Three object stores, all keyed by kid_id (string):
 *   - packs:           { kidId, packEnvelope, sessions }
 *                      sessions is an array of pending session payloads as
 *                      returned by practice/start, in download order.
 *   - audioBlobs:      { storageKey: 'kid_<id>::session_<sid>::card_<cid>',
 *                        kidId, sessionId, cardId, mimeType, filename, audioBuffer }
 *   - pendingResults:  { storageKey: 'kid_<id>::session_<sid>',
 *                        kidId, sessionId, sessionType, pendingSessionId,
 *                        pendingPayload, answers, startedAt, createdAtTs }
 *
 * Public API exposed on window.OfflineStorage.
 */
(function () {
    const DB_NAME = 'kids_offline_v1';
    const DB_VERSION = 1;
    const STORE_PACKS = 'packs';
    const STORE_AUDIO = 'audioBlobs';
    const STORE_RESULTS = 'pendingResults';
    const OWNED_KIDS_LS_KEY = 'offline_owned_kid_ids_v1';

    let _dbPromise = null;

    function _syncOwnedKidsLocalStorage() {
        listAllPacks().then((packs) => {
            try {
                const ids = packs.map((p) => String(p.kidId));
                if (ids.length === 0) {
                    localStorage.removeItem(OWNED_KIDS_LS_KEY);
                } else {
                    localStorage.setItem(OWNED_KIDS_LS_KEY, JSON.stringify(ids));
                }
            } catch (_) { /* ignore */ }
        }).catch(() => {});
    }

    function openDb() {
        if (_dbPromise) return _dbPromise;
        _dbPromise = new Promise((resolve, reject) => {
            const req = indexedDB.open(DB_NAME, DB_VERSION);
            req.onupgradeneeded = (event) => {
                const db = req.result;
                if (!db.objectStoreNames.contains(STORE_PACKS)) {
                    db.createObjectStore(STORE_PACKS, { keyPath: 'kidId' });
                }
                if (!db.objectStoreNames.contains(STORE_AUDIO)) {
                    const audioStore = db.createObjectStore(STORE_AUDIO, { keyPath: 'storageKey' });
                    audioStore.createIndex('byKid', 'kidId', { unique: false });
                    audioStore.createIndex('byKidSession', ['kidId', 'sessionId'], { unique: false });
                }
                if (!db.objectStoreNames.contains(STORE_RESULTS)) {
                    const resStore = db.createObjectStore(STORE_RESULTS, { keyPath: 'storageKey' });
                    resStore.createIndex('byKid', 'kidId', { unique: false });
                }
            };
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });
        return _dbPromise;
    }

    function tx(storeNames, mode) {
        return openDb().then((db) => db.transaction(storeNames, mode));
    }

    function asPromise(req) {
        return new Promise((resolve, reject) => {
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });
    }

    function kidKey(kidId) {
        return String(kidId);
    }

    function _readOwnedKidsLocalStorage() {
        try {
            const raw = localStorage.getItem(OWNED_KIDS_LS_KEY);
            const ids = JSON.parse(raw || '[]');
            return Array.isArray(ids) ? ids.map(String).filter(Boolean) : [];
        } catch (_) {
            return [];
        }
    }

    function _writeOwnedKidsLocalStorage(ids) {
        try {
            const uniqueIds = Array.from(new Set((ids || []).map(String).filter(Boolean)));
            if (uniqueIds.length === 0) {
                localStorage.removeItem(OWNED_KIDS_LS_KEY);
            } else {
                localStorage.setItem(OWNED_KIDS_LS_KEY, JSON.stringify(uniqueIds));
            }
        } catch (_) { /* ignore */ }
    }

    function _addOwnedKidLocalStorage(kidId) {
        const id = kidKey(kidId);
        if (!id) return;
        _writeOwnedKidsLocalStorage([..._readOwnedKidsLocalStorage(), id]);
    }

    function _removeOwnedKidLocalStorage(kidId) {
        const id = kidKey(kidId);
        if (!id) return;
        _writeOwnedKidsLocalStorage(_readOwnedKidsLocalStorage().filter((item) => item !== id));
    }

    function audioKey(kidId, sessionId, cardId) {
        return `kid_${kidId}::session_${sessionId}::card_${cardId}`;
    }

    function resultKey(kidId, sessionId) {
        return `kid_${kidId}::session_${sessionId}`;
    }

    // ----- Packs -----

    async function savePack(kidId, packEnvelope, sessions) {
        const t = await tx(STORE_PACKS, 'readwrite');
        const store = t.objectStore(STORE_PACKS);
        const entry = {
            kidId: kidKey(kidId),
            packEnvelope,
            sessions: Array.isArray(sessions) ? sessions : [],
        };
        await asPromise(store.put(entry));
        _addOwnedKidLocalStorage(kidId);
        _syncOwnedKidsLocalStorage();
    }

    async function loadPack(kidId) {
        const t = await tx(STORE_PACKS, 'readonly');
        const store = t.objectStore(STORE_PACKS);
        const row = await asPromise(store.get(kidKey(kidId)));
        return row || null;
    }

    async function listAllPacks() {
        const t = await tx(STORE_PACKS, 'readonly');
        const store = t.objectStore(STORE_PACKS);
        const rows = await asPromise(store.getAll());
        return rows || [];
    }

    function _deleteAllByIndex(store, indexName, key) {
        const req = store.index(indexName).openCursor(IDBKeyRange.only(key));
        return new Promise((resolve, reject) => {
            req.onsuccess = (e) => {
                const cursor = e.target.result;
                if (cursor) { cursor.delete(); cursor.continue(); }
                else resolve();
            };
            req.onerror = () => reject(req.error);
        });
    }

    async function deletePack(kidId) {
        const t = await tx([STORE_PACKS, STORE_AUDIO, STORE_RESULTS], 'readwrite');
        const id = kidKey(kidId);
        await asPromise(t.objectStore(STORE_PACKS).delete(id));
        await _deleteAllByIndex(t.objectStore(STORE_AUDIO), 'byKid', id);
        await _deleteAllByIndex(t.objectStore(STORE_RESULTS), 'byKid', id);
        _removeOwnedKidLocalStorage(kidId);
        _syncOwnedKidsLocalStorage();
    }

    // ----- Audio blobs -----

    async function saveAudioBlob(kidId, sessionId, cardId, blob, meta) {
        // Store as ArrayBuffer — Safari can lose the backing file for IDB
        // Blobs across page reloads (webkit bug 219860). ArrayBuffers are immune.
        const audioBuffer = await blob.arrayBuffer();
        const t = await tx(STORE_AUDIO, 'readwrite');
        const store = t.objectStore(STORE_AUDIO);
        const entry = {
            storageKey: audioKey(kidId, sessionId, cardId),
            kidId: kidKey(kidId),
            sessionId: String(sessionId),
            cardId: Number(cardId),
            mimeType: (meta && meta.mimeType) || blob.type || 'audio/webm',
            filename: (meta && meta.filename) || `card_${cardId}.webm`,
            audioBuffer,
        };
        await asPromise(store.put(entry));
    }

    async function listAudioForSession(kidId, sessionId) {
        const t = await tx(STORE_AUDIO, 'readonly');
        const store = t.objectStore(STORE_AUDIO);
        const idx = store.index('byKidSession');
        const rows = await asPromise(idx.getAll([kidKey(kidId), String(sessionId)]));
        return rows || [];
    }

    // ----- Pending results -----

    async function savePendingResult(kidId, sessionId, resultData) {
        const t = await tx(STORE_RESULTS, 'readwrite');
        const store = t.objectStore(STORE_RESULTS);
        const entry = {
            storageKey: resultKey(kidId, sessionId),
            kidId: kidKey(kidId),
            sessionId: String(sessionId),
            sessionType: String(resultData.sessionType || ''),
            pendingSessionId: String(resultData.pendingSessionId || sessionId),
            pendingPayload: resultData.pendingPayload || null,
            answers: Array.isArray(resultData.answers) ? resultData.answers : [],
            startedAt: resultData.startedAt || null,
            createdAtTs: Number(resultData.createdAtTs || 0),
        };
        await asPromise(store.put(entry));
    }

    async function listPendingResults(kidId) {
        const t = await tx(STORE_RESULTS, 'readonly');
        const store = t.objectStore(STORE_RESULTS);
        const idx = store.index('byKid');
        const rows = await asPromise(idx.getAll(kidKey(kidId)));
        return rows || [];
    }

    // ----- Convenience -----

    async function listOwnedKidIds() {
        const packs = await listAllPacks();
        return packs.map((p) => String(p.kidId));
    }

    async function _measureCache(cacheName, urlFilter) {
        let bytes = 0;
        let count = 0;
        if (typeof caches === 'undefined') return { bytes, count };
        try {
            const cache = await caches.open(cacheName);
            const requests = await cache.keys();
            for (const req of requests) {
                if (typeof urlFilter === 'function' && !urlFilter(req.url)) continue;
                try {
                    const res = await cache.match(req);
                    if (!res) continue;
                    count += 1;
                    try {
                        const blob = await res.clone().blob();
                        if (blob && Number.isFinite(blob.size)) bytes += blob.size;
                    } catch (_) { /* ignore */ }
                } catch (_) { /* ignore */ }
            }
        } catch (_) { /* ignore */ }
        return { bytes, count };
    }

    async function getPackStats(kidId) {
        const id = kidKey(kidId);
        const pack = await loadPack(id);
        if (!pack || !pack.packEnvelope) {
            return { hasPack: false, totalBytes: 0, totalFileCount: 0, audioFileCount: 0 };
        }
        let payloadBytes = 0;
        try { payloadBytes += JSON.stringify(pack.packEnvelope).length; } catch (_) { /* ignore */ }
        try { payloadBytes += JSON.stringify(pack.sessions || []).length; } catch (_) { /* ignore */ }

        const audioUrlSet = new Set();
        for (const session of (pack.sessions || [])) {
            const cards = (session && session.payload && session.payload.cards) || [];
            if (!Array.isArray(cards)) continue;
            for (const card of cards) {
                if (!card || typeof card !== 'object') continue;
                for (const key of ['audio_url', 'prompt_audio_url', 'front_audio_url', 'back_audio_url']) {
                    const v = card[key];
                    if (typeof v === 'string' && v) {
                        try { audioUrlSet.add(new URL(v, self.location.origin).href); }
                        catch (_) { audioUrlSet.add(v); }
                    }
                }
            }
        }

        const shellStats = await _measureCache('offline-shell');
        const audioStats = await _measureCache('offline-runtime', (url) => audioUrlSet.has(url));
        return {
            hasPack: true,
            totalBytes: payloadBytes + shellStats.bytes + audioStats.bytes,
            totalFileCount: shellStats.count + audioStats.count + 1,
            audioFileCount: audioStats.count,
        };
    }

    window.OfflineStorage = {
        savePack,
        loadPack,
        listAllPacks,
        deletePack,
        saveAudioBlob,
        listAudioForSession,
        savePendingResult,
        listPendingResults,
        listOwnedKidIds,
        getPackStats,
        syncOwnedKidsLocalStorage: _syncOwnedKidsLocalStorage,
        OWNED_KIDS_LS_KEY,
    };

    // Best-effort: reconcile localStorage at module load in case the IDB and
    // the LS flag drifted (e.g., DB was cleared via DevTools, app reinstall).
    _syncOwnedKidsLocalStorage();
})();
