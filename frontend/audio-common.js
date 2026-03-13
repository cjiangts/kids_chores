/**
 * Shared audio recording utilities.
 * Loaded before page-specific scripts that record or play audio.
 */
window.AudioCommon = {
    PREFERRED_AUDIO_BITRATE: 160000,
    RECORDING_PROFILE_LABEL: 'High Quality',

    /**
     * Preferred audio constraints for voice recording.
     * Keep browser voice DSP off so recordings stay closer to the raw mic capture.
     */
    getAudioConstraints() {
        return {
            audio: {
                channelCount: { ideal: 1 },
                sampleRate: { ideal: 48000 },
                sampleSize: { ideal: 24 },
                echoCancellation: false,
                noiseSuppression: false,
                autoGainControl: false,
            }
        };
    },

    /**
     * Request microphone access with preferred constraints, falling back to bare {audio: true}.
     * @returns {Promise<MediaStream>}
     */
    async getMicStream() {
        const requestedConstraints = this.getAudioConstraints();
        try {
            const stream = await navigator.mediaDevices.getUserMedia(requestedConstraints);
            this.logMicDiagnostics(stream, {
                requestedConstraints,
                usedFallback: false,
            });
            return stream;
        } catch (constraintError) {
            console.warn('[AudioCommon] Preferred audio constraints unavailable, falling back to default mic capture.', constraintError);
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            this.logMicDiagnostics(stream, {
                requestedConstraints,
                usedFallback: true,
            });
            return stream;
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
        const opts = { audioBitsPerSecond: this.PREFERRED_AUDIO_BITRATE };
        if (mimeType) {
            opts.mimeType = mimeType;
        }
        return opts;
    },

    logMicDiagnostics(stream, options = {}) {
        const audioTrack = stream && typeof stream.getAudioTracks === 'function'
            ? stream.getAudioTracks()[0]
            : null;
        const trackSettings = audioTrack && typeof audioTrack.getSettings === 'function'
            ? audioTrack.getSettings()
            : {};
        const trackConstraints = audioTrack && typeof audioTrack.getConstraints === 'function'
            ? audioTrack.getConstraints()
            : {};
        console.info('[AudioCommon] Microphone capture ready.', {
            profile: this.RECORDING_PROFILE_LABEL,
            usedFallback: Boolean(options.usedFallback),
            requestedConstraints: options.requestedConstraints || this.getAudioConstraints(),
            appliedConstraints: trackConstraints,
            trackSettings,
            trackLabel: audioTrack ? String(audioTrack.label || '') : '',
        });
    },

    logRecorderDiagnostics(recorder, stream) {
        const audioTrack = stream && typeof stream.getAudioTracks === 'function'
            ? stream.getAudioTracks()[0]
            : null;
        const trackSettings = audioTrack && typeof audioTrack.getSettings === 'function'
            ? audioTrack.getSettings()
            : {};
        console.info('[AudioCommon] MediaRecorder started.', {
            profile: this.RECORDING_PROFILE_LABEL,
            mimeType: String(recorder && recorder.mimeType ? recorder.mimeType : ''),
            requestedBitsPerSecond: this.PREFERRED_AUDIO_BITRATE,
            actualBitsPerSecond: Number(recorder && recorder.audioBitsPerSecond) || null,
            trackSettings,
        });
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
