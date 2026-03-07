window.LessonReadingDurationBackfill = (() => {
    const inFlight = new Set();
    const done = new Set();

    function getFiniteDurationMs(audioEl) {
        if (!audioEl) return 0;
        const durationSec = Number(audioEl.duration);
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
            const resultId = Number(audioEl.dataset.resultId);
            const rawResponseMs = Number(audioEl.dataset.responseTimeMs || 0);
            if (!Number.isFinite(resultId) || resultId <= 0) {
                return;
            }
            if (Math.max(0, rawResponseMs) > 0) {
                return;
            }

            const tryBackfill = async () => {
                const durationMs = getFiniteDurationMs(audioEl);
                if (durationMs <= 0) {
                    return;
                }
                try {
                    const saved = await sendBackfill(kidId, resultId, durationMs);
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
                }
            };

            audioEl.addEventListener('loadedmetadata', () => { void tryBackfill(); });
            audioEl.addEventListener('durationchange', () => { void tryBackfill(); });
            audioEl.addEventListener('play', () => { void tryBackfill(); });
        });
    }

    return { attach };
})();
