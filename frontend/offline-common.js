/**
 * Offline-mode orchestration utilities used by Home + Practice pages.
 *
 * Public API:
 *   OfflineCommon.parseDeviceLabel()            -> 'Mac Safari'
 *   OfflineCommon.formatBannerTime(iso, tz)     -> 'May 26, 7:14 PM'
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

    function formatBannerTime(iso, timezone) {
        const d = _parseIsoUtc(iso);
        if (!d) return '';
        const tz = String(timezone || '').trim() || 'UTC';
        try {
            return new Intl.DateTimeFormat(undefined, {
                month: 'short',
                day: 'numeric',
                hour: 'numeric',
                minute: '2-digit',
                hour12: true,
                timeZone: tz,
            }).format(d);
        } catch (_) {
            return d.toUTCString();
        }
    }

    function formatHourMinute(iso, timezone) {
        const d = _parseIsoUtc(iso);
        if (!d) return '';
        const tz = String(timezone || '').trim() || 'UTC';
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

                sessions.push({
                    categoryKey,
                    behaviorType: cat.behavior_type,
                    scope,
                    displayName,
                    pendingSessionId: String(startPayload.pending_session_id || ''),
                    startedAtUtc: packEnvelope.acquired_at_utc,
                    payload: startPayload,
                    readyPayload,
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

        await window.OfflineStorage.savePack(kidId, packEnvelope, sessions);
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

        const sessions = [];
        for (const row of pendingResults) {
            const entry = {
                pendingSessionId: row.pendingSessionId,
                sessionType: row.sessionType,
                pendingPayload: row.pendingPayload,
                answers: row.answers,
                startedAt: row.startedAt,
                createdAtTs: row.createdAtTs,
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
        try {
            const cache = await caches.open(RUNTIME_CACHE);
            const keys = await cache.keys();
            await Promise.all(keys.map((k) => cache.delete(k)));
        } catch (_) { /* ignore */ }
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
        // Server responded — even on conflict (409) we drop the local pack
        // because the server owner has moved on; nothing useful remains.
        await window.OfflineStorage.deletePack(kidId);
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

            // --- practice/start: serve from cached session payload, with
            // already-answered cards filtered out so Finish Early resumes
            // pick up where the kid left off instead of forcing a full redo.
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
                    const requestedMode = _extractPracticeMode(init);
                    if (requestedMode && String(session.payload?.practice_mode || '') !== requestedMode) {
                        session.payload = { ...session.payload, practice_mode: requestedMode };
                        try {
                            await window.OfflineStorage.savePack(targetId, pack.packEnvelope, pack.sessions);
                        } catch (_) { /* best-effort; in-memory copy still updated */ }
                    }
                    const priorAnswers = await _loadPriorOfflineAnswers(targetId, session.pendingSessionId);
                    return _jsonResponse(_filterStartPayloadByPriorAnswers(session.payload, priorAnswers), 200);
                }

                const completeMatch = _matchPracticeComplete(url);
                if (completeMatch && completeMatch.kidId === targetId) {
                    const body = await _readJsonBody(init);
                    const pendingSessionId = String(body.pendingSessionId || '');
                    const session = (pack.sessions || []).find(
                        (s) => String(s.pendingSessionId) === pendingSessionId,
                    );
                    if (!session) {
                        return _jsonResponse({ error: 'offline_unknown_pending_session' }, 404);
                    }
                    // Merge with any prior Finish-Early save for this session:
                    // dedupe by cardId, latest answer wins so the user keeps
                    // earlier work when they resume and add more cards.
                    const newAnswers = Array.isArray(body.answers) ? body.answers : [];
                    const priorAnswers = await _loadPriorOfflineAnswers(targetId, session.pendingSessionId);
                    const mergedAnswers = _mergeAnswersByCardId(priorAnswers, newAnswers);
                    await window.OfflineStorage.savePendingResult(targetId, session.pendingSessionId, {
                        pendingSessionId: session.pendingSessionId,
                        sessionType: session.categoryKey,
                        pendingPayload: session.payload.pending_payload || session.payload,
                        answers: mergedAnswers,
                        startedAt: session.startedAtUtc,
                        createdAtTs: Date.now() / 1000,
                    });
                    return _jsonResponse({
                        ok: true,
                        offline: true,
                        message: 'Saved locally; will sync when you tap Sync.',
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
                // serve the response cached at acquire time so the practice
                // page can bootstrap without hitting the server. Subtract
                // already-answered cards so the start screen reflects what's
                // actually left after offline practice.
                const readyMatch = _matchReadyState(url);
                if (readyMatch && readyMatch.kidId === targetId) {
                    const categoryKey = url.searchParams.get('categoryKey') || '';
                    const session = (pack.sessions || []).find(
                        (s) => String(s.scope) === String(readyMatch.scope)
                            && String(s.categoryKey) === String(categoryKey),
                    );
                    if (session && session.readyPayload) {
                        const priorAnswers = await _loadPriorOfflineAnswers(targetId, session.pendingSessionId);
                        const cachedCards = Array.isArray(session.payload?.cards) ? session.payload.cards : [];
                        const lastMode = String(session.payload?.practice_mode || '').trim().toLowerCase();
                        return _jsonResponse(
                            _filterReadyPayloadByPriorAnswers(session.readyPayload, priorAnswers, cachedCards.length, lastMode),
                            200,
                        );
                    }
                    return _jsonResponse({ error: 'offline_ready_state_unavailable' }, 503);
                }
            }

            return realFetch(input, init);
        };
    }

    async function _loadPriorOfflineAnswers(kidId, pendingSessionId) {
        try {
            const rows = await window.OfflineStorage.listPendingResults(kidId);
            const match = rows.find((r) => String(r.pendingSessionId) === String(pendingSessionId));
            return (match && Array.isArray(match.answers)) ? match.answers : [];
        } catch (_) {
            return [];
        }
    }

    function _filterStartPayloadByPriorAnswers(payload, priorAnswers) {
        if (!payload || !Array.isArray(priorAnswers) || priorAnswers.length === 0) {
            return payload;
        }
        const cards = Array.isArray(payload.cards) ? payload.cards : null;
        if (!cards) return payload;
        const answeredIds = new Set(
            priorAnswers
                .map((a) => (a && a.cardId != null) ? String(a.cardId) : '')
                .filter(Boolean)
        );
        if (answeredIds.size === 0) return payload;
        const remaining = cards.filter((c) => !answeredIds.has(String(c && c.id)));
        if (remaining.length > 0) {
            // Mid-session resume: serve only the cards the kid hasn't touched
            // yet (Finish-Early flow).
            if (remaining.length === cards.length) return payload;
            return {
                ...payload,
                cards: remaining,
                planned_count: remaining.length,
            };
        }
        // Every cached card has been answered → present a retry session of
        // just the wrong ones. Online mode generates this from server-side
        // grades; here we synthesize it from local IDB answer rows.
        const wrongIds = new Set(
            priorAnswers
                .filter((a) => a && a.known === false && a.cardId != null)
                .map((a) => String(a.cardId))
        );
        const retryCards = cards.filter((c) => wrongIds.has(String(c && c.id)));
        return {
            ...payload,
            cards: retryCards,
            planned_count: retryCards.length,
            is_retry_session: retryCards.length > 0,
        };
    }

    function _filterReadyPayloadByPriorAnswers(readyPayload, priorAnswers, totalCachedCards, lastPracticeMode) {
        if (!readyPayload || typeof readyPayload !== 'object') return readyPayload;
        const answers = Array.isArray(priorAnswers) ? priorAnswers : [];
        if (answers.length === 0) return readyPayload;
        const out = { ...readyPayload };
        const total = Math.max(0, Number(totalCachedCards) || 0);
        const remainingFresh = Math.max(0, total - answers.length);
        // Preserve the mode the kid last practiced in so Review/Continue
        // pre-selects the same Parent-Assist / Multiple-Choice toggle
        // instead of falling back to the default.
        const modeForSession = String(lastPracticeMode || '').trim().toLowerCase();
        if (remainingFresh > 0) {
            // Some cards still untouched → continue from where they left off.
            out.is_continue_session = true;
            out.continue_card_count = remainingFresh;
            out.is_retry_session = false;
            out.retry_card_count = 0;
            out.total_session_count = remainingFresh;
            if (modeForSession && modeForSession !== 'na') {
                out.source_practice_mode = modeForSession;
                out.latest_practice_mode = modeForSession;
            }
            return out;
        }
        // All fresh cards done → if any wrong, surface a retry session;
        // otherwise nothing left to practice (greyed on home).
        const wrongCount = answers.filter((a) => a && a.known === false).length;
        out.is_continue_session = false;
        out.continue_card_count = 0;
        out.is_retry_session = wrongCount > 0;
        out.retry_card_count = wrongCount;
        out.total_session_count = wrongCount;
        if (modeForSession && modeForSession !== 'na') {
            out.source_practice_mode = modeForSession;
            out.latest_practice_mode = modeForSession;
        }
        return out;
    }

    function _mergeAnswersByCardId(priorAnswers, newAnswers) {
        const byId = new Map();
        const order = [];
        const push = (a) => {
            if (!a || typeof a !== 'object') return;
            const key = String(a.cardId);
            if (!byId.has(key)) order.push(key);
            byId.set(key, a);
        };
        for (const a of (priorAnswers || [])) push(a);
        for (const a of (newAnswers || [])) push(a);
        return order.map((k) => byId.get(k));
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

    function _extractPracticeMode(init) {
        if (!init || !init.body) return '';
        if (typeof init.body === 'string') {
            try {
                const parsed = JSON.parse(init.body);
                return String(parsed.practiceMode || '').trim().toLowerCase();
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
        formatBannerTime,
        formatHourMinute,
        findActivePack,
        acquirePack,
        syncPack,
        releasePack,
        installFetchInterceptor,
    };
})();
