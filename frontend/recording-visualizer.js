(function initRecordingVisualizer() {
    class RecordingVisualizer {
        constructor(options = {}) {
            this.options = { ...options };
            this.audioContext = null;
            this.sourceNode = null;
            this.analyserNode = null;
            this.waveBuffer = null;
            this.frameId = null;
            this.lastDrawMs = 0;
            this.key = null;
            this.startedAtMs = 0;
            this.isActiveFn = null;
        }

        start(stream, runtime = {}) {
            this.stop();
            const AudioCtx = window.AudioContext || window.webkitAudioContext;
            if (!AudioCtx || !stream) {
                return;
            }

            try {
                this.audioContext = new AudioCtx();
                this.sourceNode = this.audioContext.createMediaStreamSource(stream);
                this.analyserNode = this.audioContext.createAnalyser();
                this.analyserNode.fftSize = Number(this.options.fftSize) || 512;
                this.analyserNode.smoothingTimeConstant = Number(this.options.smoothingTimeConstant) || 0.88;
                this.waveBuffer = new Uint8Array(this.analyserNode.fftSize);
                this.sourceNode.connect(this.analyserNode);
                this.key = runtime.key ?? null;
                this.startedAtMs = Number(runtime.startedAtMs) || Date.now();
                this.isActiveFn = typeof runtime.isActive === 'function' ? runtime.isActive : null;
                this.lastDrawMs = 0;
                if (typeof this.options.onStart === 'function') {
                    this.options.onStart();
                }
                this._draw();
            } catch (error) {
                this.stop();
            }
        }

        stop() {
            if (this.frameId) {
                cancelAnimationFrame(this.frameId);
                this.frameId = null;
            }
            if (this.sourceNode) {
                try {
                    this.sourceNode.disconnect();
                } catch (error) {
                    // no-op
                }
                this.sourceNode = null;
            }
            if (this.analyserNode) {
                try {
                    this.analyserNode.disconnect();
                } catch (error) {
                    // no-op
                }
                this.analyserNode = null;
            }
            if (this.audioContext) {
                this.audioContext.close().catch(() => {});
                this.audioContext = null;
            }
            this.waveBuffer = null;
            this.lastDrawMs = 0;
            this.startedAtMs = 0;
            this.key = null;
            this.isActiveFn = null;
            if (typeof this.options.onStop === 'function') {
                this.options.onStop();
            }
        }

        handleResize() {
            const canvas = this._getCanvas();
            if (!canvas) {
                return;
            }
            this._fitCanvas(canvas);
        }

        _draw() {
            if (!this.analyserNode || !this.waveBuffer) {
                return;
            }

            const canvas = this._getCanvas();
            if (!canvas) {
                if (this._isActive()) {
                    this.frameId = requestAnimationFrame(() => this._draw());
                }
                return;
            }

            const nowMs = Date.now();
            const minFrameIntervalMs = Number(this.options.minFrameIntervalMs) || 66;
            if (this.lastDrawMs > 0 && (nowMs - this.lastDrawMs) < minFrameIntervalMs) {
                if (this._isActive()) {
                    this.frameId = requestAnimationFrame(() => this._draw());
                }
                return;
            }
            this.lastDrawMs = nowMs;

            this._fitCanvas(canvas);
            this.analyserNode.getByteTimeDomainData(this.waveBuffer);

            const ctx = canvas.getContext('2d');
            const width = canvas.width;
            const height = canvas.height;
            const centerY = height / 2;

            const backgroundColor = this.options.backgroundColor || '#fff';
            const baselineColor = this.options.baselineColor || '#f2b9b9';
            const waveColor = this.options.waveColor || '#d63636';
            const baselineWidthRatio = Number(this.options.baselineWidthRatio) || 0.02;
            const waveWidthRatio = Number(this.options.waveWidthRatio) || 0.04;
            const amplitudeRatio = Number(this.options.amplitudeRatio) || 0.36;

            ctx.clearRect(0, 0, width, height);
            ctx.fillStyle = backgroundColor;
            ctx.fillRect(0, 0, width, height);

            ctx.strokeStyle = baselineColor;
            ctx.lineWidth = Math.max(1, Math.round(height * baselineWidthRatio));
            ctx.beginPath();
            ctx.moveTo(0, centerY);
            ctx.lineTo(width, centerY);
            ctx.stroke();

            ctx.strokeStyle = waveColor;
            ctx.lineWidth = Math.max(1.5, Math.round(height * waveWidthRatio));
            ctx.lineJoin = 'round';
            ctx.lineCap = 'round';
            ctx.beginPath();

            const sliceWidth = width / Math.max(1, this.waveBuffer.length - 1);
            for (let i = 0; i < this.waveBuffer.length; i += 1) {
                const normalized = (this.waveBuffer[i] - 128) / 128;
                const x = i * sliceWidth;
                const y = centerY + normalized * (height * amplitudeRatio);
                if (i === 0) {
                    ctx.moveTo(x, y);
                } else {
                    ctx.lineTo(x, y);
                }
            }
            ctx.stroke();

            const statusEl = this._getStatusElement();
            if (statusEl && typeof this.options.formatStatus === 'function' && this.startedAtMs > 0) {
                statusEl.textContent = this.options.formatStatus(Math.max(0, nowMs - this.startedAtMs));
            }

            if (this._isActive()) {
                this.frameId = requestAnimationFrame(() => this._draw());
            }
        }

        _fitCanvas(canvas) {
            if (!canvas || typeof canvas.getBoundingClientRect !== 'function') {
                return;
            }
            const rect = canvas.getBoundingClientRect();
            const dpr = Math.max(1, window.devicePixelRatio || 1);
            const targetWidth = Math.max(1, Math.round(rect.width * dpr));
            const targetHeight = Math.max(1, Math.round(rect.height * dpr));
            if (canvas.width !== targetWidth || canvas.height !== targetHeight) {
                canvas.width = targetWidth;
                canvas.height = targetHeight;
            }
        }

        _getCanvas() {
            if (typeof this.options.getCanvas === 'function') {
                return this.options.getCanvas(this.key);
            }
            return null;
        }

        _getStatusElement() {
            if (typeof this.options.getStatusElement === 'function') {
                return this.options.getStatusElement(this.key);
            }
            return null;
        }

        _isActive() {
            if (typeof this.isActiveFn === 'function') {
                return !!this.isActiveFn();
            }
            return true;
        }
    }

    window.RecordingVisualizer = RecordingVisualizer;
})();
