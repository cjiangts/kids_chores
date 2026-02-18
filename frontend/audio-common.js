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
     * Stop all tracks on a stream.
     */
    stopStream(stream) {
        if (!stream) return;
        stream.getTracks().forEach((t) => t.stop());
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
        if (type.includes('wav')) return 'wav';
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
     * Post-process a recorded audio blob: decode, amplify, re-encode as WAV.
     * This is the reliable way to boost volume — works on all browsers including iOS Safari
     * where the GainNode-before-MediaRecorder approach is silently ignored.
     *
     * @param {Blob} blob - recorded audio blob (any format the browser can decode)
     * @param {number} gain - multiplier (e.g. 2.0 = double volume)
     * @returns {Promise<{blob: Blob, mimeType: string}>} amplified WAV blob
     */
    async amplifyBlob(blob, gain) {
        if (!blob || blob.size === 0 || !gain || gain <= 0) {
            return { blob, mimeType: blob?.type || 'audio/webm' };
        }
        const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        try {
            const arrayBuffer = await blob.arrayBuffer();
            const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);

            // Amplify PCM samples with clipping protection
            for (let ch = 0; ch < audioBuffer.numberOfChannels; ch++) {
                const samples = audioBuffer.getChannelData(ch);
                for (let i = 0; i < samples.length; i++) {
                    samples[i] = Math.max(-1, Math.min(1, samples[i] * gain));
                }
            }

            // Encode to WAV
            const wavBlob = this._encodeWav(audioBuffer);
            return { blob: wavBlob, mimeType: 'audio/wav' };
        } finally {
            try { audioCtx.close(); } catch (_e) { /* already closed */ }
        }
    },

    /**
     * Encode an AudioBuffer to a WAV Blob (PCM 16-bit).
     */
    _encodeWav(audioBuffer) {
        const numChannels = audioBuffer.numberOfChannels;
        const sampleRate = audioBuffer.sampleRate;
        const format = 1; // PCM
        const bitDepth = 16;

        // Interleave channels
        const length = audioBuffer.length;
        const interleaved = new Float32Array(length * numChannels);
        for (let ch = 0; ch < numChannels; ch++) {
            const channelData = audioBuffer.getChannelData(ch);
            for (let i = 0; i < length; i++) {
                interleaved[i * numChannels + ch] = channelData[i];
            }
        }

        // Convert to 16-bit PCM
        const dataLength = interleaved.length * (bitDepth / 8);
        const headerLength = 44;
        const buffer = new ArrayBuffer(headerLength + dataLength);
        const view = new DataView(buffer);

        // WAV header
        const writeString = (offset, str) => {
            for (let i = 0; i < str.length; i++) {
                view.setUint8(offset + i, str.charCodeAt(i));
            }
        };
        writeString(0, 'RIFF');
        view.setUint32(4, 36 + dataLength, true);
        writeString(8, 'WAVE');
        writeString(12, 'fmt ');
        view.setUint32(16, 16, true); // fmt chunk size
        view.setUint16(20, format, true);
        view.setUint16(22, numChannels, true);
        view.setUint32(24, sampleRate, true);
        view.setUint32(28, sampleRate * numChannels * (bitDepth / 8), true);
        view.setUint16(32, numChannels * (bitDepth / 8), true);
        view.setUint16(34, bitDepth, true);
        writeString(36, 'data');
        view.setUint32(40, dataLength, true);

        // Write PCM samples
        let offset = 44;
        for (let i = 0; i < interleaved.length; i++) {
            const sample = Math.max(-1, Math.min(1, interleaved[i]));
            view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7FFF, true);
            offset += 2;
        }

        return new Blob([buffer], { type: 'audio/wav' });
    },

    /** Default amplification gain for post-processing. */
    POST_GAIN: 2.5,

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
