/**
 * Offline-mode orchestration utilities used by Home + Practice pages.
 *
 * Public API:
 *   OfflineCommon.parseDeviceLabel()            -> 'Mac Safari'
 *   OfflineCommon.formatHourMinute(iso, tz)     -> '7:14 PM'
 *   OfflineCommon.acquirePack(kidId, opts)      -> { ok, pack, error, conflict, inflight }
 *   OfflineCommon.syncPack(kidId)               -> { ok, response, error }
 *   OfflineCommon.releasePack(kidId)            -> { ok, error }
 *   OfflineCommon.findActivePack(kidId)         -> pack envelope or null (also drops expired)
 *   OfflineCommon.installFetchInterceptor(kidId)
 *
 * Persistence:
 *   - Pack envelope + downloaded sessions live in IndexedDB via OfflineStorage.
 *   - Recorded type-III audio blobs and pending session results also live there.
 *   - Pre-fetched audio URLs (type-II prompts) go through the Service Worker's
 *     runtime cache as a best-effort step.
 *
 * The fetch interceptor only fires on the kid-practice runtime once a pack
 * is loaded; before pack-load it stays out of the way.
 */
(function () {
    const API_BASE = `${window.location.origin}/api`;
    const RUNTIME_CACHE = 'offline-runtime';

    // Per-scope ready-state probe — kid-practice runtime calls this on entry
    // to know configured session count / continue+retry state. Mirror the URL
    // shape the runtime uses (buildTypeNApiUrl in kid-practice-core.js).
    const _READY_STATE_PATH_BY_SCOPE = {
        'cards': 'decks',
        'type2': 'cards',
        'lesson-reading': 'decks',
        'type4': 'decks',
    };

    // ------------------------------------------------------------------
    // 1. Device label parsing
    // ------------------------------------------------------------------

    function parseDeviceLabel() {
        try {
            const ua = String(navigator.userAgent || '');
            let os = 'Device';
            if (/iPad/i.test(ua)) os = 'iPad';
            else if (/iPhone/i.test(ua)) os = 'iPhone';
            else if (/Android/i.test(ua)) os = 'Android';
            else if (/Mac OS X|Macintosh/i.test(ua)) os = 'Mac';
            else if (/Windows/i.test(ua)) os = 'Windows';
            else if (/Linux/i.test(ua)) os = 'Linux';

            let browser = 'Browser';
            if (/Edg\//i.test(ua)) browser = 'Edge';
            else if (/OPR\//i.test(ua)) browser = 'Opera';
            else if (/Chrome\//i.test(ua) && !/Edg\//i.test(ua)) browser = 'Chrome';
            else if (/Firefox\//i.test(ua)) browser = 'Firefox';
            else if (/Safari\//i.test(ua) && !/Chrome\//i.test(ua)) browser = 'Safari';

            return `${os} ${browser}`.slice(0, 64);
        } catch (_) {
            return 'Unknown device';
        }
    }

    // ------------------------------------------------------------------
    // 2. Time helpers
    // ------------------------------------------------------------------

    function _parseIsoUtc(iso) {
        if (!iso) return null;
        const text = String(iso);
        const ms = Date.parse(text.endsWith('Z') || /[+-]\d{2}:\d{2}$/.test(text) ? text : text + 'Z');
        return Number.isFinite(ms) ? new Date(ms) : null;
    }

    function formatHourMinute(iso, timezone) {
        const d = _parseIsoUtc(iso);
        if (!d) return '';
        const tz = String(timezone || '').trim();
        if (!tz) return '';
        try {
            return new Intl.DateTimeFormat(undefined, {
                hour: 'numeric',
                minute: '2-digit',
                hour12: true,
                timeZone: tz,
            }).format(d);
        } catch (_) {
            return d.toUTCString();
        }
    }

    // ------------------------------------------------------------------
    // 3. Pack lifecycle: find + expire
    // ------------------------------------------------------------------

    async function findActivePack(kidId) {
        if (!window.OfflineStorage) return null;
        const pack = await window.OfflineStorage.loadPack(kidId);
        if (!pack || !pack.packEnvelope) return null;
        const exp = _parseIsoUtc(pack.packEnvelope.expires_at_utc);
        if (exp && exp.getTime() <= Date.now()) {
            return { ...pack, expired: true };
        }
        return pack;
    }

    // ------------------------------------------------------------------
    // 4. Acquire flow
    // ------------------------------------------------------------------

    async function _prefetchAudioUrls(urls, onTick) {
        if (!Array.isArray(urls) || urls.length === 0) return;
        let cache = null;
        try {
            cache = await caches.open(RUNTIME_CACHE);
        } catch (_) {
            return;
        }
        const total = urls.length;
        let completed = 0;
        const tick = () => {
            completed += 1;
            if (typeof onTick === 'function') {
                try { onTick(completed, total); } catch (_) { /* ignore */ }
            }
        };
        await Promise.all(urls.map(async (u) => {
            if (!u || typeof u !== 'string') { tick(); return; }
            try {
                const req = new Request(u, { credentials: 'same-origin' });
                const existing = await cache.match(req);
                if (existing) { tick(); return; }
                const res = await fetch(req);
                if (res && res.ok) {
                    await cache.put(req, res.clone());
                }
            } catch (_) { /* best-effort */ }
            tick();
        }));
    }

    function _collectAudioUrlsFromSession(sessionData) {
        const urls = [];
        const cards = (sessionData && (sessionData.cards || sessionData.data?.cards)) || [];
        if (!Array.isArray(cards)) return urls;
        for (const card of cards) {
            if (!card || typeof card !== 'object') continue;
            for (const key of ['audio_url', 'prompt_audio_url', 'front_audio_url', 'back_audio_url']) {
                const v = card[key];
                if (typeof v === 'string' && v) urls.push(v);
            }
        }
        return urls;
    }

    function _collectAudioUrlsFromSessions(sessions) {
        const urls = [];
        for (const session of (sessions || [])) {
            urls.push(..._collectAudioUrlsFromSession(session && session.payload ? session.payload : session));
        }
        return urls;
    }

    async function _cleanupRuntimeCacheForSessions(sessions) {
        if (typeof caches === 'undefined' || !window.OfflineStorage) return;
        const dropSet = new Set(_collectAudioUrlsFromSessions(sessions));
        if (dropSet.size === 0) return;
        try {
            const remainingPacks = await window.OfflineStorage.listAllPacks();
            for (const pack of (remainingPacks || [])) {
                for (const url of _collectAudioUrlsFromSessions(pack.sessions)) {
                    dropSet.delete(url);
                }
            }
        } catch (_) {
            return;
        }
        if (dropSet.size === 0) return;
        try {
            const cache = await caches.open(RUNTIME_CACHE);
            await Promise.all(Array.from(dropSet).map(async (url) => {
                try {
                    await cache.delete(new Request(url, { credentials: 'same-origin' }));
                } catch (_) {
                    try { await cache.delete(url); } catch (_) { /* ignore */ }
                }
            }));
        } catch (_) { /* ignore */ }
    }

    async function _bestEffortReleaseServerPack(kidId, packId) {
        try {
            const res = await fetch(`${API_BASE}/kids/${kidId}/offline/release`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ packId }),
            });
            return res.ok || res.status === 409;
        } catch (_) {
            return false;
        }
    }

    function _stripTypeIvModeFromStartPayload(startPayload) {
        if (!startPayload || typeof startPayload !== 'object') return startPayload;
        const out = { ...startPayload };
        out.practice_mode = 'na';
        return out;
    }

    function _stripTypeIvModeFromReadyPayload(readyPayload) {
        if (!readyPayload || typeof readyPayload !== 'object') return readyPayload;
        const out = { ...readyPayload };
        out.latest_practice_mode = 'na';
        out.source_practice_mode = 'na';
        return out;
    }

    async function acquirePack(kidId, opts) {
        const options = opts || {};
        const deviceLabel = options.deviceLabel || parseDeviceLabel();
        const force = Boolean(options.forceDiscardInflight);
        const onProgress = typeof options.onProgress === 'function' ? options.onProgress : null;
        const emit = (info) => { if (onProgress) { try { onProgress(info); } catch (_) { /* ignore */ } } };

        const acquireRes = await fetch(`${API_BASE}/kids/${kidId}/offline/acquire`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Device-Label': deviceLabel },
            body: JSON.stringify({ deviceLabel, forceDiscardInflight: force }),
        });
        const acquirePayload = await acquireRes.json().catch(() => ({}));
        if (!acquireRes.ok) {
            if (acquireRes.status === 409 && acquirePayload.error === 'inflight_sessions') {
                return { ok: false, inflight: acquirePayload.inflight || [], error: acquirePayload.message };
            }
            if (acquireRes.status === 423) {
                return { ok: false, conflict: acquirePayload.lock || null, error: acquirePayload.message };
            }
            return { ok: false, error: acquirePayload.error || `HTTP ${acquireRes.status}` };
        }

        const packEnvelope = acquirePayload;
        const packId = String(packEnvelope.pack_id || '');
        const kidName = String(packEnvelope.kid_name || '').trim();
        const categories = Array.isArray(packEnvelope.categories) ? packEnvelope.categories : [];
        emit({ phase: 'subjects_known', kidId: String(kidId), kidName, subjectCount: categories.length });

        const sessions = [];
        const audioUrlsToPrefetch = [];
        for (let i = 0; i < categories.length; i++) {
            const cat = categories[i];
            const scope = String(cat.practice_path || '').trim();
            const categoryKey = String(cat.category_key || '').trim();
            const displayName = cat.display_name || categoryKey;
            if (!scope || !categoryKey) {
                emit({ phase: 'subject_done', kidId: String(kidId), kidName, subjectIndex: i, subjectCount: categories.length, subjectName: displayName, ok: false });
                continue;
            }
            emit({ phase: 'subject_start', kidId: String(kidId), kidName, subjectIndex: i, subjectCount: categories.length, subjectName: displayName });
            const startUrl = new URL(`${API_BASE}/kids/${kidId}/${scope}/practice/start`);
            startUrl.searchParams.set('categoryKey', categoryKey);
            try {
                // The X-Offline-Pack-Id header signals offline acquire — the
                // server ships a sanitized pending payload (no Python
                // callables, no baked practice_mode) and forces choices for
                // type-IV so the kid can switch input/multi at runtime.
                const startRes = await fetch(startUrl.toString(), {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'X-Offline-Pack-Id': packId,
                    },
                    body: JSON.stringify({ categoryKey }),
                });
                const startPayload = await startRes.json().catch(() => ({}));
                if (!startRes.ok) {
                    console.warn(`[OfflineCommon] practice/start failed for ${categoryKey}:`, startPayload);
                    emit({ phase: 'subject_done', kidId: String(kidId), subjectIndex: i, subjectCount: categories.length, subjectName: displayName, ok: false });
                    continue;
                }
                const cardCount = Array.isArray(startPayload.cards) ? startPayload.cards.length : 0;
                const hasReviewWork = Boolean(startPayload.is_continue_session || startPayload.is_retry_session);
                // Once gold tier is reached, only ship the subject if there's
                // actual continue/retry work — over-practice should stay greyed.
                const skipForGold = Boolean(cat.gold_reached) && !hasReviewWork;
                if (cardCount === 0 || skipForGold) {
                    emit({ phase: 'subject_done', kidId: String(kidId), kidName, subjectIndex: i, subjectCount: categories.length, subjectName: displayName, ok: true });
                    continue;
                }
                // Cache the ready-state response (kid-practice runtime calls
                // /{scope}/decks or /type2/cards on entry — without this it
                // dies with "Load failed" when the server is unreachable).
                let readyPayload = null;
                try {
                    const readyPath = _READY_STATE_PATH_BY_SCOPE[scope];
                    if (readyPath) {
                        const readyUrl = new URL(`${API_BASE}/kids/${kidId}/${scope}/${readyPath}`);
                        readyUrl.searchParams.set('categoryKey', categoryKey);
                        const readyRes = await fetch(readyUrl.toString(), { headers: { 'X-Offline-Pack-Id': packId } });
                        if (readyRes.ok) readyPayload = await readyRes.json();
                    }
                } catch (_) { /* best-effort */ }

                // For type-IV, the kid's local judge-mode picker is the source
                // of truth offline (cards are baked with `choices` so they can
                // render in either input or multi at runtime). Strip the
                // server-reported mode fields so `applyServerPracticeMode`
                // becomes a no-op and the kid's local toggle wins.
                const sanitizedStart = (scope === 'type4')
                    ? _stripTypeIvModeFromStartPayload(startPayload)
                    : startPayload;
                const sanitizedReady = (scope === 'type4')
                    ? _stripTypeIvModeFromReadyPayload(readyPayload)
                    : readyPayload;
                sessions.push({
                    categoryKey,
                    behaviorType: cat.behavior_type,
                    scope,
                    displayName,
                    pendingSessionId: String(sanitizedStart.pending_session_id || ''),
                    startedAtUtc: packEnvelope.acquired_at_utc,
                    payload: sanitizedStart,
                    readyPayload: sanitizedReady,
                });
                audioUrlsToPrefetch.push(..._collectAudioUrlsFromSession(startPayload));
                emit({ phase: 'subject_done', kidId: String(kidId), kidName, subjectIndex: i, subjectCount: categories.length, subjectName: displayName, ok: true });
            } catch (e) {
                console.warn(`[OfflineCommon] practice/start error for ${categoryKey}:`, e);
                emit({ phase: 'subject_done', kidId: String(kidId), kidName, subjectIndex: i, subjectCount: categories.length, subjectName: displayName, ok: false });
            }
        }

        try {
            // Use practice_home view: it includes daily progress fields
            // (dailyCompletedByDeckCategory, dailyStarTiersByDeckCategory,
            // dailyPercentByDeckCategory, etc.) that the kid practice home
            // needs to render per-subject progress bars in offline mode.
            const kidInfoRes = await fetch(`${API_BASE}/kids/${kidId}?view=practice_home`);
            if (kidInfoRes.ok) {
                packEnvelope.kidInfo = await kidInfoRes.json();
            }
        } catch (_) { /* best-effort */ }

        try {
            await window.OfflineStorage.savePack(kidId, packEnvelope, sessions);
        } catch (e) {
            console.error('[OfflineCommon] savePack failed after acquire:', e);
            const released = await _bestEffortReleaseServerPack(kidId, packId);
            return {
                ok: false,
                error: released
                    ? 'Failed to save the offline pack on this device. The server lock was released; please try again.'
                    : 'Failed to save the offline pack on this device. The server may still think this kid is offline, so you may need to retry or force-release from the family home.',
            };
        }
        emit({ phase: 'audio_start', kidId: String(kidId), kidName, audioCount: audioUrlsToPrefetch.length });
        await _prefetchAudioUrls(audioUrlsToPrefetch, (completed, total) => {
            emit({ phase: 'audio_progress', kidId: String(kidId), kidName, completed, total });
        });
        emit({ phase: 'audio_done', kidId: String(kidId), kidName, audioCount: audioUrlsToPrefetch.length });

        try {
            const stats = await window.OfflineStorage.getPackStats(kidId);
            if (stats && stats.hasPack) {
                await fetch(`${API_BASE}/kids/${kidId}/offline/report-pack-stats`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        packId,
                        totalBytes: stats.totalBytes,
                        totalFileCount: stats.totalFileCount,
                        audioFileCount: stats.audioFileCount,
                    }),
                });
            }
        } catch (_) { /* best-effort */ }

        return { ok: true, pack: { kidId: String(kidId), packEnvelope, sessions } };
    }

    // ------------------------------------------------------------------
    // 5. Sync flow
    // ------------------------------------------------------------------

    function _arrayBufferToBase64(buf) {
        const bytes = new Uint8Array(buf);
        let binary = '';
        const chunk = 0x8000;
        for (let i = 0; i < bytes.length; i += chunk) {
            binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
        }
        return btoa(binary);
    }

    async function syncPack(kidId) {
        const pack = await window.OfflineStorage.loadPack(kidId);
        if (!pack || !pack.packEnvelope) {
            return { ok: false, error: 'no_local_pack' };
        }
        const packId = String(pack.packEnvelope.pack_id || '');
        const pendingResults = await window.OfflineStorage.listPendingResults(kidId);
        // Sort by createdAtTs ASC so each source pid is replayed before any
        // of its retry rounds (the backend's stable sort keeps retries in
        // the order we send them).
        pendingResults.sort(
            (a, b) => (Number(a?.createdAtTs) || 0) - (Number(b?.createdAtTs) || 0),
        );

        const sessions = [];
        for (const row of pendingResults) {
            const createdAtTs = Number(row.createdAtTs) || 0;
            const entry = {
                pendingSessionId: row.pendingSessionId,
                sessionType: row.sessionType,
                pendingPayload: row.pendingPayload,
                answers: row.answers,
                startedAt: row.startedAt,
                createdAtTs: row.createdAtTs,
                completedAt: row.completedAt || (createdAtTs > 0 ? new Date(createdAtTs * 1000).toISOString() : null),
            };
            const audioRows = await window.OfflineStorage.listAudioForSession(kidId, row.sessionId);
            if (audioRows.length > 0) {
                entry.audioByCard = Object.fromEntries(audioRows.map((a) => [
                    String(a.cardId),
                    {
                        dataBase64: _arrayBufferToBase64(a.audioBuffer),
                        mimeType: a.mimeType,
                        filename: a.filename,
                    },
                ]));
            }
            sessions.push(entry);
        }

        const thumbDownEvents = Array.isArray(pack.packEnvelope.thumbDownEvents)
            ? pack.packEnvelope.thumbDownEvents
            : [];
        let res;
        try {
            res = await fetch(`${API_BASE}/kids/${kidId}/offline/sync`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ packId, sessions, thumbDownEvents }),
            });
        } catch (e) {
            // Network failure — keep the local pack so the user can retry Sync.
            return { ok: false, error: String(e && e.message || e) || 'network_error' };
        }
        const payload = await res.json().catch(() => ({}));
        if (!res.ok) {
            return { ok: false, error: payload.error || `HTTP ${res.status}`, response: payload };
        }

        await window.OfflineStorage.deletePack(kidId);
        await _cleanupRuntimeCacheForSessions(pack.sessions);
        return { ok: true, response: payload };
    }

    // ------------------------------------------------------------------
    // 6. Release (no-data exit)
    // ------------------------------------------------------------------

    async function releasePack(kidId) {
        const pack = await window.OfflineStorage.loadPack(kidId);
        if (!pack || !pack.packEnvelope) return { ok: false, error: 'no_local_pack' };
        const packId = String(pack.packEnvelope.pack_id || '');
        let res;
        try {
            res = await fetch(`${API_BASE}/kids/${kidId}/offline/release`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ packId }),
            });
        } catch (e) {
            // Network failure — keep the local pack so the user can retry Sync.
            return { ok: false, error: String(e && e.message || e) };
        }
        const payload = await res.json().catch(() => ({}));
        if (!(res.ok || res.status === 409)) {
            return {
                ok: false,
                error: payload.error || `HTTP ${res.status}`,
                response: payload,
            };
        }
        // A server-side 409 here means the lock is already gone or belongs to
        // another device, so this local pack is no longer recoverable/useful.
        await window.OfflineStorage.deletePack(kidId);
        await _cleanupRuntimeCacheForSessions(pack.sessions);
        return { ok: true, response: payload };
    }

    // ------------------------------------------------------------------
    // 7. Fetch interceptor for the practice runtime
    // ------------------------------------------------------------------

    let _interceptorInstalled = false;

    function _matchPracticeStart(url) {
        const m = url.pathname.match(/^\/api\/kids\/([^/]+)\/([^/]+)\/practice\/start$/);
        if (!m) return null;
        return { kidId: m[1], scope: m[2] };
    }

    function _matchPracticeComplete(url) {
        const m = url.pathname.match(/^\/api\/kids\/([^/]+)\/([^/]+)\/practice\/complete$/);
        if (!m) return null;
        return { kidId: m[1], scope: m[2] };
    }

    function _matchUploadAudio(url) {
        const m = url.pathname.match(/^\/api\/kids\/([^/]+)\/lesson-reading\/practice\/upload-audio$/);
        if (!m) return null;
        return { kidId: m[1] };
    }

    function _matchThumbDown(url) {
        const m = url.pathname.match(/^\/api\/kids\/([^/]+)\/cards\/([^/]+)\/thumb-down$/);
        if (!m) return null;
        return { kidId: m[1], cardId: m[2] };
    }

    function _matchKidInfo(url) {
        const m = url.pathname.match(/^\/api\/kids\/([^/]+)$/);
        if (!m) return null;
        return { kidId: m[1] };
    }

    function _matchReadyState(url) {
        const m = url.pathname.match(/^\/api\/kids\/([^/]+)\/([^/]+)\/([^/]+)$/);
        if (!m) return null;
        const scope = m[2];
        const tail = m[3];
        if (_READY_STATE_PATH_BY_SCOPE[scope] !== tail) return null;
        return { kidId: m[1], scope };
    }

    function _jsonResponse(body, status) {
        return new Response(JSON.stringify(body), {
            status: status || 200,
            headers: { 'Content-Type': 'application/json' },
        });
    }

    function installFetchInterceptor(targetKidId) {
        if (_interceptorInstalled) return;
        _interceptorInstalled = true;
        const targetId = String(targetKidId);
        const realFetch = window.fetch.bind(window);

        window.fetch = async function offlineAwareFetch(input, init) {
            let url;
            try {
                const raw = (typeof input === 'string' || input instanceof URL) ? String(input) : input.url;
                url = new URL(raw, window.location.origin);
            } catch (_) {
                return realFetch(input, init);
            }
            const method = ((init && init.method) || (input && input.method) || 'GET').toUpperCase();

            const pack = await findActivePack(targetId);
            if (!pack || pack.expired) {
                // Without an active pack we should not intercept; let the request
                // hit the server normally (it will 423 if a lock is still active).
                if (method === 'POST') {
                    const startMatch = _matchPracticeStart(url);
                    if (startMatch && startMatch.kidId === targetId) {
                        // Pack expired — refuse to start a new session locally.
                        return _jsonResponse({ error: 'offline_pack_expired' }, 423);
                    }
                }
                return realFetch(input, init);
            }

            // --- practice/start: serve from cached session payload. Pick
            // the next action from the LATEST IndexedDB row in this category
            // (source pid or its `__retry_N` siblings): mid-round resume,
            // spawn the next retry round, or signal "done".
            if (method === 'POST') {
                const startMatch = _matchPracticeStart(url);
                if (startMatch && startMatch.kidId === targetId) {
                    const categoryKey = url.searchParams.get('categoryKey') || _extractCategoryKey(init);
                    const session = (pack.sessions || []).find(
                        (s) => String(s.categoryKey) === String(categoryKey) && String(s.scope) === String(startMatch.scope),
                    );
                    if (!session) {
                        return _jsonResponse({ error: 'offline_session_not_found' }, 404);
                    }
                    const allRows = await window.OfflineStorage.listPendingResults(targetId);
                    const categoryRows = _categoryRowsFor(allRows, session.pendingSessionId);
                    const resolved = _resolveStartPayloadFromRows(
                        session.payload, session.pendingSessionId, categoryRows,
                    );
                    // Resume after finish-early: restore the mode the kid was
                    // practicing in (saved on offline complete). Type-IV defers
                    // to the kid's local toggle so leave its 'na' alone.
                    const latestRow = categoryRows.length > 0
                        ? categoryRows[categoryRows.length - 1]
                        : null;
                    const priorStartMode = String(latestRow?.pendingPayload?.practice_mode || '').trim().toLowerCase();
                    if (startMatch.scope !== 'type4' && priorStartMode && priorStartMode !== 'na'
                        && resolved && typeof resolved === 'object') {
                        resolved.practice_mode = priorStartMode;
                    }
                    return _jsonResponse(resolved, 200);
                }

                const completeMatch = _matchPracticeComplete(url);
                if (completeMatch && completeMatch.kidId === targetId) {
                    const body = await _readJsonBody(init);
                    const pendingSessionId = String(body.pendingSessionId || '');
                    const parsedRetry = _parseRetryPid(pendingSessionId);
                    const isRetry = parsedRetry !== null;
                    const sourcePendingId = isRetry ? parsedRetry.sourcePid : pendingSessionId;
                    const sourceSession = (pack.sessions || []).find(
                        (s) => String(s.pendingSessionId) === sourcePendingId,
                    );
                    if (!sourceSession) {
                        return _jsonResponse({ error: 'offline_unknown_pending_session' }, 404);
                    }
                    const allRows = await window.OfflineStorage.listPendingResults(targetId);
                    const existingRow = allRows.find(
                        (r) => String(r.pendingSessionId) === pendingSessionId,
                    ) || null;
                    // Merge answers across finish-early resumes within the
                    // same round. Drill mode legitimately repeats a cardId —
                    // keep every attempt so sync preserves the full history.
                    const newAnswers = Array.isArray(body.answers) ? body.answers : [];
                    const priorAnswers = (existingRow && Array.isArray(existingRow.answers))
                        ? existingRow.answers
                        : [];
                    const mergedAnswers = [...priorAnswers, ...newAnswers];
                    // Pick the pending_payload to persist:
                    //  - resume → reuse what was saved earlier (same round)
                    //  - first save of source → source session's payload
                    //  - first save of retry round N → rebuild from the
                    //    most recent prior row's wrong cards (round N-1)
                    let basePending;
                    if (existingRow && existingRow.pendingPayload) {
                        basePending = existingRow.pendingPayload;
                    } else if (isRetry) {
                        const categoryRows = _categoryRowsFor(allRows, sourcePendingId);
                        const priorRow = categoryRows.length > 0
                            ? categoryRows[categoryRows.length - 1]
                            : null;
                        const wrongIds = priorRow ? _wrongCardIdsFromRow(priorRow) : new Set();
                        const sourceCards = Array.isArray(sourceSession.payload?.cards)
                            ? sourceSession.payload.cards
                            : [];
                        const retryCards = sourceCards.filter((c) => c && wrongIds.has(String(c.id)));
                        basePending = _buildRetryStartPayload(
                            sourceSession.payload, retryCards, sourcePendingId, parsedRetry.roundNumber,
                        ).pending_payload;
                    } else {
                        basePending = sourceSession.payload.pending_payload || sourceSession.payload;
                    }
                    // The server strips practice_mode from offline pending
                    // payloads — inject the runtime's actual choice here so
                    // sync records the correct mode. (Body field optional;
                    // type-IV runtime sends it, other types skip.)
                    const pendingPayload = body.practiceMode
                        ? { ...basePending, practice_mode: String(body.practiceMode) }
                        : basePending;
                    const completedAtTs = Date.now() / 1000;
                    const startedAt = existingRow?.startedAt || body.startedAt || sourceSession.startedAtUtc;
                    await window.OfflineStorage.savePendingResult(targetId, pendingSessionId, {
                        pendingSessionId,
                        sessionType: sourceSession.categoryKey,
                        pendingPayload,
                        answers: mergedAnswers,
                        startedAt,
                        completedAt: new Date(completedAtTs * 1000).toISOString(),
                        createdAtTs: (existingRow && Number.isFinite(Number(existingRow.createdAtTs)))
                            ? Number(existingRow.createdAtTs)
                            : completedAtTs,
                    });
                    // Type-IV completion screen reads wrong_count/answer_count
                    // from the response. Server isn't reachable offline, so
                    // grade locally by string equality against the cached
                    // expected answers — same approach the home page uses
                    // for "to fix" tally.
                    const counts = _gradeOfflineCounts(pendingPayload, mergedAnswers);
                    return _jsonResponse({
                        ok: true,
                        offline: true,
                        message: 'Saved locally; will sync when you tap Sync.',
                        ...counts,
                    }, 200);
                }

                const audioMatch = _matchUploadAudio(url);
                if (audioMatch && audioMatch.kidId === targetId) {
                    const form = _extractFormData(init);
                    if (!form) return _jsonResponse({ error: 'offline_audio_no_form' }, 400);
                    const pendingSessionId = String(form.get('pendingSessionId') || '');
                    const cardId = Number.parseInt(String(form.get('cardId') || ''), 10);
                    const audioFile = form.get('audio');
                    if (!pendingSessionId || !Number.isFinite(cardId) || !audioFile) {
                        return _jsonResponse({ error: 'offline_audio_invalid' }, 400);
                    }
                    const session = (pack.sessions || []).find(
                        (s) => String(s.pendingSessionId) === pendingSessionId,
                    );
                    if (!session) {
                        return _jsonResponse({ error: 'offline_unknown_pending_session' }, 404);
                    }
                    await window.OfflineStorage.saveAudioBlob(targetId, session.pendingSessionId, cardId, audioFile, {
                        mimeType: audioFile.type,
                        filename: audioFile.name,
                    });
                    return _jsonResponse({ ok: true, offline: true }, 200);
                }

                // --- Thumb-down: queue the cardId on the pack envelope and
                // replay during sync. The server holds the canonical count;
                // we only need to record how many times to increment.
                const thumbMatch = _matchThumbDown(url);
                if (thumbMatch && thumbMatch.kidId === targetId) {
                    const cardId = Number.parseInt(String(thumbMatch.cardId), 10);
                    if (!Number.isFinite(cardId)) {
                        return _jsonResponse({ error: 'offline_thumb_invalid_card' }, 400);
                    }
                    const envelope = pack.packEnvelope || {};
                    const events = Array.isArray(envelope.thumbDownEvents) ? envelope.thumbDownEvents.slice() : [];
                    events.push({ cardId, ts: Date.now() });
                    envelope.thumbDownEvents = events;
                    try {
                        await window.OfflineStorage.savePack(targetId, envelope, pack.sessions);
                    } catch (_) { /* in-memory copy still updated */ }
                    return _jsonResponse({ card_id: cardId, offline: true, queued: events.length }, 200);
                }
            }

            // --- GET kid info: serve from envelope if cached ---
            if (method === 'GET') {
                const kidInfoMatch = _matchKidInfo(url);
                if (kidInfoMatch && kidInfoMatch.kidId === targetId
                    && url.searchParams.get('view') === 'practice_session'
                    && pack.packEnvelope.kidInfo) {
                    return _jsonResponse(pack.packEnvelope.kidInfo, 200);
                }

                // --- Ready-state probe (/{scope}/decks or /type2/cards):
                // serve the response cached at acquire time, but project
                // the LATEST round row onto continue/retry counts so the
                // start screen reflects what's actually left after offline
                // practice (including multi-round retries).
                const readyMatch = _matchReadyState(url);
                if (readyMatch && readyMatch.kidId === targetId) {
                    const categoryKey = url.searchParams.get('categoryKey') || '';
                    const session = (pack.sessions || []).find(
                        (s) => String(s.scope) === String(readyMatch.scope)
                            && String(s.categoryKey) === String(categoryKey),
                    );
                    if (session && session.readyPayload) {
                        const allRows = await window.OfflineStorage.listPendingResults(targetId);
                        const categoryRows = _categoryRowsFor(allRows, session.pendingSessionId);
                        const latestRow = categoryRows.length > 0
                            ? categoryRows[categoryRows.length - 1]
                            : null;
                        // Prefer the mode the kid actually used in their prior
                        // offline chunk (saved at finish-early) over the
                        // acquire-time 'na' baked into session.payload.
                        // Type-IV defers to the kid's local toggle.
                        const priorMode = String(latestRow?.pendingPayload?.practice_mode || '').trim().toLowerCase();
                        const fallbackMode = String(session.payload?.practice_mode || '').trim().toLowerCase();
                        const lastMode = (readyMatch.scope !== 'type4' && priorMode && priorMode !== 'na')
                            ? priorMode
                            : fallbackMode;
                        return _jsonResponse(
                            _resolveReadyPayloadFromRows(
                                session.readyPayload, session.pendingSessionId, categoryRows, session.payload, lastMode,
                            ),
                            200,
                        );
                    }
                    return _jsonResponse({ error: 'offline_ready_state_unavailable' }, 503);
                }
            }

            return realFetch(input, init);
        };
    }

    // Offline grading: type-I/II/III answers carry a kid-self-graded `known`
    // flag; type-IV doesn't, so we string-equality-compare submittedAnswer
    // against the expected answer baked into the pending payload cards
    // (which have `.answer`). Custom validate fns can't run on-device —
    // sync will reconcile partial credit.
    function _buildExpectedAnswerMap(cards) {
        const map = new Map();
        for (const card of (Array.isArray(cards) ? cards : [])) {
            if (!card || card.id == null) continue;
            map.set(String(card.id), String(card.answer || '').trim());
        }
        return map;
    }

    function _isAnswerLocallyWrong(answer, expectedById) {
        if (!answer) return false;
        if (typeof answer.known === 'boolean') return answer.known === false;
        const expected = expectedById.get(String(answer.cardId));
        // Defensive: missing expected (shouldn't happen if pending_payload is
        // intact) counts as wrong so the kid still gets a retry path.
        if (expected === undefined) return true;
        return String(answer.submittedAnswer ?? '').trim() !== expected;
    }

    // Offline retry rounds: each completed round (source + every retry pass)
    // is its own IndexedDB row. Retry pids encode the source pid so sync can
    // pair them back to the source's real session_id, and so the
    // /practice/complete interceptor can find the source session in the pack.
    const _RETRY_PID_PATTERN = /^(.+)__retry_(\d+)$/;

    function _retryPidFor(sourcePid, roundNumber) {
        return `${sourcePid}__retry_${roundNumber}`;
    }

    function _parseRetryPid(pid) {
        const m = String(pid || '').match(_RETRY_PID_PATTERN);
        if (!m) return null;
        return { sourcePid: m[1], roundNumber: parseInt(m[2], 10) };
    }

    function _isRetryPid(pid) {
        return _RETRY_PID_PATTERN.test(String(pid || ''));
    }

    function _categoryRowsFor(allRows, sourcePid) {
        const out = [];
        for (const row of (allRows || [])) {
            const pid = String(row?.pendingSessionId || '');
            if (pid === sourcePid) { out.push(row); continue; }
            const parsed = _parseRetryPid(pid);
            if (parsed && parsed.sourcePid === sourcePid) out.push(row);
        }
        out.sort((a, b) => (Number(a?.createdAtTs) || 0) - (Number(b?.createdAtTs) || 0));
        return out;
    }

    // Mirror the server's type-I multiple-choice distractor pool. The runtime
    // builds choices from `state.type1MultipleChoicePoolCards` when non-empty,
    // else falls back to `sessionCards`. Whenever the active session reduces
    // below the source's full card set (retry round, mid-round resume) the
    // fallback yields too few options — inject the full source cards as the
    // pool so multi-choice always has enough distractors.
    function _type1PoolCardsFromSource(sourcePayload) {
        const cards = Array.isArray(sourcePayload?.cards) ? sourcePayload.cards : [];
        const out = [];
        for (const c of cards) {
            if (!c || c.id == null) continue;
            out.push({ id: c.id, front: c.front, back: c.back });
        }
        return out;
    }

    // Build the retry start-response (and inner pending_payload) for round N.
    // Top-level uses snake_case `pending_session_id` because the practice
    // runtime reads it from the start response. For type-I/II/III the start
    // response itself acts as the pending payload (no separate inner object).
    // Type-IV uses a separate inner pending_payload whose cards carry the
    // per-item `answer` + validate metadata that the outer response_cards
    // strip — filter the inner cards from baseInner.cards by retry ids so
    // the saved row keeps the expected answer for downstream rounds (else
    // the next retry's local grading sees `answer === undefined` and treats
    // every card as wrong, snapping retries back to the round-1 set).
    function _buildRetryStartPayload(sourcePayload, retryCards, sourcePid, roundNumber) {
        const retryPid = _retryPidFor(sourcePid, roundNumber);
        const retryIdSet = new Set();
        const plannedById = {};
        for (const card of retryCards) {
            if (card && card.id != null) {
                retryIdSet.add(String(card.id));
                plannedById[String(card.id)] = 1;
            }
        }
        const sourceInner = sourcePayload?.pending_payload;
        const baseInner = (sourceInner && typeof sourceInner === 'object')
            ? sourceInner
            : sourcePayload;
        const innerSourceCards = Array.isArray(baseInner?.cards) ? baseInner.cards : [];
        const innerRetryCards = innerSourceCards.length > 0
            ? innerSourceCards.filter((c) => c && retryIdSet.has(String(c.id)))
            : retryCards;
        const retryPending = {
            ...baseInner,
            pending_session_id: retryPid,
            cards: innerRetryCards,
            planned_count: retryCards.length,
            planned_count_by_id: plannedById,
            is_retry_session: true,
            retry_card_count: retryCards.length,
            is_continue_session: false,
            continue_source_session_id: null,
            retry_source_offline_pending_id: sourcePid,
        };
        return {
            ...sourcePayload,
            pending_session_id: retryPid,
            cards: retryCards,
            planned_count: retryCards.length,
            is_retry_session: true,
            retry_card_count: retryCards.length,
            is_continue_session: false,
            continue_source_session_id: null,
            multiple_choice_pool_cards: _type1PoolCardsFromSource(sourcePayload),
            pending_payload: retryPending,
        };
    }

    function _wrongCardIdsFromRow(row) {
        const cards = Array.isArray(row?.pendingPayload?.cards) ? row.pendingPayload.cards : [];
        const answers = Array.isArray(row?.answers) ? row.answers : [];
        const expectedById = _buildExpectedAnswerMap(cards);
        const wrongIds = new Set();
        for (const a of answers) {
            if (a && a.cardId != null && _isAnswerLocallyWrong(a, expectedById)) {
                wrongIds.add(String(a.cardId));
            }
        }
        return wrongIds;
    }

    function _resolveStartPayloadFromRows(sourcePayload, sourcePid, rows) {
        if (!sourcePayload) return sourcePayload;
        if (!Array.isArray(rows) || rows.length === 0) return sourcePayload;
        const latest = rows[rows.length - 1];
        const rowCards = Array.isArray(latest?.pendingPayload?.cards)
            ? latest.pendingPayload.cards
            : (Array.isArray(sourcePayload.cards) ? sourcePayload.cards : []);
        const answers = Array.isArray(latest?.answers) ? latest.answers : [];
        const answeredIds = new Set(
            answers.map((a) => (a && a.cardId != null) ? String(a.cardId) : '').filter(Boolean)
        );
        const remaining = rowCards.filter((c) => c && !answeredIds.has(String(c.id)));

        if (remaining.length > 0) {
            // Mid-round resume — finish-early then restart.
            const poolCards = _type1PoolCardsFromSource(sourcePayload);
            const isSource = String(latest.pendingSessionId) === sourcePid;
            if (isSource) {
                return {
                    ...sourcePayload,
                    cards: remaining,
                    planned_count: remaining.length,
                    multiple_choice_pool_cards: poolCards,
                };
            }
            return {
                ...sourcePayload,
                pending_session_id: String(latest.pendingSessionId),
                cards: remaining,
                planned_count: rowCards.length,
                is_retry_session: true,
                retry_card_count: rowCards.length,
                is_continue_session: false,
                continue_source_session_id: null,
                multiple_choice_pool_cards: poolCards,
                pending_payload: latest.pendingPayload,
            };
        }

        // Latest round complete — spawn next retry round from its wrongs.
        const wrongIds = _wrongCardIdsFromRow(latest);
        if (wrongIds.size === 0) {
            return {
                ...sourcePayload,
                cards: [],
                planned_count: 0,
                is_retry_session: false,
                is_continue_session: false,
            };
        }
        const retryRoundsSoFar = rows.filter((r) => _isRetryPid(r.pendingSessionId)).length;
        const nextRound = retryRoundsSoFar + 1;
        const sourceCards = Array.isArray(sourcePayload.cards) ? sourcePayload.cards : [];
        const retryCards = sourceCards.filter((c) => c && wrongIds.has(String(c.id)));
        return _buildRetryStartPayload(sourcePayload, retryCards, sourcePid, nextRound);
    }

    function _resolveReadyPayloadFromRows(readyPayload, sourcePid, rows, sessionPayload, lastPracticeMode) {
        if (!readyPayload || typeof readyPayload !== 'object') return readyPayload;
        if (!Array.isArray(rows) || rows.length === 0) return readyPayload;
        const out = { ...readyPayload };
        const modeForSession = String(lastPracticeMode || '').trim().toLowerCase();
        const applyMode = () => {
            if (modeForSession && modeForSession !== 'na') {
                out.source_practice_mode = modeForSession;
                out.latest_practice_mode = modeForSession;
            }
        };
        const latest = rows[rows.length - 1];
        const rowCards = Array.isArray(latest?.pendingPayload?.cards)
            ? latest.pendingPayload.cards
            : (Array.isArray(sessionPayload?.cards) ? sessionPayload.cards : []);
        const answers = Array.isArray(latest?.answers) ? latest.answers : [];
        const answeredIds = new Set(
            answers.map((a) => (a && a.cardId != null) ? String(a.cardId) : '').filter(Boolean)
        );
        const remaining = Math.max(0, rowCards.length - answeredIds.size);
        const isSource = String(latest?.pendingSessionId) === sourcePid;

        if (remaining > 0) {
            if (isSource) {
                out.is_continue_session = true;
                out.continue_card_count = remaining;
                out.is_retry_session = false;
                out.retry_card_count = 0;
                out.total_session_count = remaining;
            } else {
                out.is_continue_session = false;
                out.continue_card_count = 0;
                out.is_retry_session = true;
                out.retry_card_count = remaining;
                out.total_session_count = remaining;
            }
            applyMode();
            return out;
        }
        const wrongCount = _wrongCardIdsFromRow(latest).size;
        out.is_continue_session = false;
        out.continue_card_count = 0;
        out.is_retry_session = wrongCount > 0;
        out.retry_card_count = wrongCount;
        out.total_session_count = wrongCount;
        applyMode();
        return out;
    }

    // Returns {wrong_count, right_count, partial_count, answer_count,
    // target_answer_count} for the type-IV Session Complete summary.
    // partial_count is always 0 — custom validate fns can't run offline.
    function _gradeOfflineCounts(pendingPayload, answers) {
        const ans = Array.isArray(answers) ? answers : [];
        const expectedById = _buildExpectedAnswerMap(pendingPayload?.cards);
        let wrong = 0;
        for (const a of ans) {
            if (_isAnswerLocallyWrong(a, expectedById)) wrong += 1;
        }
        const right = ans.length - wrong;
        const plannedRaw = Number.parseInt(pendingPayload?.planned_count, 10);
        const planned = Number.isFinite(plannedRaw) ? plannedRaw : ans.length;
        return {
            wrong_count: wrong,
            right_count: right,
            partial_count: 0,
            answer_count: ans.length,
            target_answer_count: Math.max(planned, ans.length),
        };
    }

    function _extractCategoryKey(init) {
        if (!init || !init.body) return '';
        if (typeof init.body === 'string') {
            try {
                const parsed = JSON.parse(init.body);
                return String(parsed.categoryKey || '');
            } catch (_) { return ''; }
        }
        return '';
    }

    async function _readJsonBody(init) {
        if (!init || !init.body) return {};
        if (typeof init.body === 'string') {
            try { return JSON.parse(init.body); } catch (_) { return {}; }
        }
        if (init.body instanceof Blob) {
            try { return JSON.parse(await init.body.text()); } catch (_) { return {}; }
        }
        return {};
    }

    function _extractFormData(init) {
        if (!init) return null;
        const body = init.body;
        if (body instanceof FormData) return body;
        return null;
    }

    // ------------------------------------------------------------------
    // 8. Expose
    // ------------------------------------------------------------------

    window.OfflineCommon = {
        parseDeviceLabel,
        parseIsoUtc: _parseIsoUtc,
        formatHourMinute,
        findActivePack,
        acquirePack,
        syncPack,
        releasePack,
        installFetchInterceptor,
    };
})();
