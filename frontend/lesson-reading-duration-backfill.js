window.LessonReadingDurationBackfill = (() => {
    const inFlight = new Set();
    const done = new Set();
    const attached = new WeakSet();

    function getFiniteDurationMs(audioEl) {
        if (!audioEl) return 0;
        const durationSec = Number.isFinite(audioEl.duration) && audioEl.duration > 0
            ? audioEl.duration
            : Number(audioEl.dataset.decodedDurationMs || 0) / 1000;
        if (!Number.isFinite(durationSec) || durationSec <= 0) {
            return 0;
        }
        return Math.max(1, Math.round(durationSec * 1000));
    }

    async function sendBackfill(kidId, resultId, responseTimeMs) {
        const key = `${kidId}:${resultId}`;
        if (!kidId || !Number.isFinite(resultId) || resultId <= 0 || responseTimeMs <= 0) {
            return null;
        }
        if (done.has(key) || inFlight.has(key)) {
            return null;
        }
        inFlight.add(key);
        try {
            const response = await fetch(`/api/kids/${encodeURIComponent(kidId)}/report/results/${encodeURIComponent(resultId)}/response-time`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ responseTimeMs }),
            });
            const payload = await response.json().catch(() => ({}));
            if (!response.ok) {
                throw new Error(payload.error || `HTTP ${response.status}`);
            }
            done.add(key);
            return payload;
        } finally {
            inFlight.delete(key);
        }
    }

    function attach(container, { kidId } = {}) {
        const root = container || document;
        const audios = Array.from(root.querySelectorAll('audio.attempt-audio[data-result-id][data-response-time-ms]'));
        audios.forEach((audioEl) => {
            if (attached.has(audioEl)) return;
            attached.add(audioEl);
            const resultId = Number(audioEl.dataset.resultId);
            const rawResponseMs = Number(audioEl.dataset.responseTimeMs || 0);
            if (!Number.isFinite(resultId) || resultId <= 0) {
                return;
            }
            if (Math.max(0, rawResponseMs) > 0) {
                return;
            }

            let saving = false;
            const tryBackfill = async () => {
                if (audioEl.dataset.audioPlaybackRequested !== '1'
                    || saving || Number(audioEl.dataset.responseTimeMs) > 0) return;
                const durationMs = getFiniteDurationMs(audioEl);
                if (durationMs <= 0) {
                    return;
                }
                saving = true;
                try {
                    const saved = await sendBackfill(kidId, resultId, durationMs);
                    if (!saved) return;
                    let resolvedMs = durationMs;
                    if (saved && Number(saved.response_time_ms || 0) > 0) {
                        resolvedMs = Number(saved.response_time_ms);
                    }
                    audioEl.dataset.responseTimeMs = String(resolvedMs);
                    window.dispatchEvent(new CustomEvent('lesson-reading-duration-updated', {
                        detail: {
                            kidId: String(kidId || ''),
                            resultId,
                            responseTimeMs: resolvedMs,
                        },
                    }));
                } catch (error) {
                    // Best effort only: ignore failures.
                    console.warn('Lesson reading duration backfill failed:', error);
                } finally {
                    saving = false;
                }
            };

            audioEl.addEventListener('loadedmetadata', () => { void tryBackfill(); });
            audioEl.addEventListener('durationchange', () => { void tryBackfill(); });
            audioEl.addEventListener('play', () => { void tryBackfill(); });
            audioEl.addEventListener('audio-duration-ready', () => { void tryBackfill(); });
        });
    }

    return { attach };
})();
