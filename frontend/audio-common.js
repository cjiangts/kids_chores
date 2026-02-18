/**
 * Shared audio recording utilities.
 * Loaded before page-specific scripts that record or play audio.
 */
window.AudioCommon = {
    /**
     * Preferred audio constraints for voice recording.
     * Mono, noise suppression + auto gain for clean voice in home environments.
     * Echo cancellation off — not a call, can introduce artifacts.
     */
    getAudioConstraints() {
        return {
            audio: {
                channelCount: { ideal: 1 },
                sampleRate: { ideal: 48000 },
                echoCancellation: false,
                noiseSuppression: true,
                autoGainControl: true,
            }
        };
    },

    /**
     * Request microphone access with preferred constraints, falling back to bare {audio: true}.
     * @returns {Promise<MediaStream>}
     */
    async getMicStream() {
        try {
            return await navigator.mediaDevices.getUserMedia(this.getAudioConstraints());
        } catch (_constraintError) {
            return await navigator.mediaDevices.getUserMedia({ audio: true });
        }
    },

    /**
     * Pick the best supported recording MIME type.
     * Prefers Opus in WebM (smallest, best quality for voice).
     */
    getPreferredMimeType() {
        if (typeof MediaRecorder === 'undefined' || typeof MediaRecorder.isTypeSupported !== 'function') {
            return '';
        }
        const candidates = [
            'audio/webm;codecs=opus',
            'audio/webm',
            'audio/mp4',
            'audio/ogg;codecs=opus',
            'audio/ogg',
            'audio/aac',
        ];
        for (const candidate of candidates) {
            if (MediaRecorder.isTypeSupported(candidate)) {
                return candidate;
            }
        }
        return '';
    },

    /**
     * Build MediaRecorder options with preferred MIME type and voice-appropriate bitrate.
     */
    getRecorderOptions() {
        const mimeType = this.getPreferredMimeType();
        const opts = { audioBitsPerSecond: 96000 };
        if (mimeType) {
            opts.mimeType = mimeType;
        }
        return opts;
    },

    /**
     * Guess file extension from a MIME type string.
     */
    guessExtension(mimeType) {
        const type = String(mimeType || '').toLowerCase();
        if (type.includes('webm')) return 'webm';
        if (type.includes('ogg')) return 'ogg';
        if (type.includes('mp4') || type.includes('m4a') || type.includes('aac')) return 'm4a';
        if (type.includes('mpeg') || type.includes('mp3')) return 'mp3';
        return 'webm';
    },

    /** Recommended timeslice (ms) for MediaRecorder.start(). */
    TIMESLICE_MS: 1000,

    /** Small stop delay to reduce tail clipping when user stops right after speaking. */
    STOP_GRACE_MS: 280,

    /**
     * Shared graceful stop for MediaRecorder.
     * Waits a short grace period, requests final chunk, then stops recorder.
     */
    gracefulStopRecorder(recorder, graceMs = 280) {
        return new Promise((resolve, reject) => {
            if (!recorder || recorder.state !== 'recording') {
                resolve();
                return;
            }

            let settled = false;
            const finishResolve = () => {
                if (settled) return;
                settled = true;
                resolve();
            };
            const finishReject = (error) => {
                if (settled) return;
                settled = true;
                reject(error instanceof Error ? error : new Error('Recorder stop failed'));
            };

            recorder.addEventListener('stop', finishResolve, { once: true });
            recorder.addEventListener('error', (event) => {
                const maybeError = event && event.error ? event.error : new Error('Recorder error');
                finishReject(maybeError);
            }, { once: true });

            const waitMs = Math.max(0, Number(graceMs) || 280);
            window.setTimeout(() => {
                if (recorder.state !== 'recording') {
                    finishResolve();
                    return;
                }
                try {
                    recorder.requestData();
                } catch (error) {
                    // best effort
                }
                try {
                    recorder.stop();
                } catch (error) {
                    finishReject(error);
                }
            }, waitMs);
        });
    },
};
