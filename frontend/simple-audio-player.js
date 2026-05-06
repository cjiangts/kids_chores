(function initSimpleAudioPlayer(global) {
    const SPEED_OPTIONS = [1, 1.5, 2];
    const WAVEFORM_BAR_COUNT = 96;
    const allPlayers = [];

    function formatDuration(secondsRaw) {
        const secondsNum = Number(secondsRaw);
        const safe = Number.isFinite(secondsNum) && secondsNum >= 0 ? secondsNum : 0;
        const total = Math.floor(safe);
        const minutes = Math.floor(total / 60);
        const seconds = total % 60;
        return `${minutes}:${String(seconds).padStart(2, '0')}`;
    }

    function getBarClassByScore(correctScore) {
        const score = Number(correctScore);
        if (score > 0) return 'right';
        if (score < 0) return 'wrong';
        return 'pending';
    }

    function pauseAllExcept(audioEl) {
        allPlayers.forEach((entry) => {
            if (entry.audio !== audioEl && !entry.audio.paused) {
                entry.audio.pause();
            }
        });
    }

    function generateFlatPeaks(count) {
        const peaks = new Array(count);
        for (let i = 0; i < count; i++) peaks[i] = 0.12;
        return peaks;
    }

    let _sharedAudioCtx = null;
    function getAudioCtx() {
        if (_sharedAudioCtx) return _sharedAudioCtx;
        const Ctor = window.AudioContext || window.webkitAudioContext;
        if (!Ctor) return null;
        try {
            _sharedAudioCtx = new Ctor();
        } catch (e) {
            _sharedAudioCtx = null;
        }
        return _sharedAudioCtx;
    }

    const _peaksCache = new Map();

    function computePeaksFromBuffer(audioBuffer, count) {
        const channelCount = audioBuffer.numberOfChannels;
        const length = audioBuffer.length;
        const samplesPerBar = Math.max(1, Math.floor(length / count));
        const peaks = new Array(count);
        let globalMax = 0.0001;
        const channels = [];
        for (let c = 0; c < channelCount; c++) {
            channels.push(audioBuffer.getChannelData(c));
        }
        for (let i = 0; i < count; i++) {
            const start = i * samplesPerBar;
            const end = i === count - 1 ? length : Math.min(length, start + samplesPerBar);
            let sumSq = 0;
            let n = 0;
            for (let s = start; s < end; s++) {
                let v = 0;
                for (let c = 0; c < channelCount; c++) {
                    v += channels[c][s];
                }
                v /= channelCount;
                sumSq += v * v;
                n++;
            }
            const rms = n > 0 ? Math.sqrt(sumSq / n) : 0;
            peaks[i] = rms;
            if (rms > globalMax) globalMax = rms;
        }
        const norm = 1 / globalMax;
        for (let i = 0; i < count; i++) {
            peaks[i] = Math.max(0.06, Math.min(1, Math.pow(peaks[i] * norm, 0.85)));
        }
        return peaks;
    }

    async function loadRealPeaks(src, count) {
        if (!src) return null;
        const cacheKey = `${src}::${count}`;
        if (_peaksCache.has(cacheKey)) return _peaksCache.get(cacheKey);
        const ctx = getAudioCtx();
        if (!ctx) return null;
        try {
            const response = await fetch(src, { credentials: 'same-origin' });
            if (!response.ok) return null;
            const arrayBuffer = await response.arrayBuffer();
            const decoded = await new Promise((resolve, reject) => {
                try {
                    const ret = ctx.decodeAudioData(arrayBuffer, resolve, reject);
                    if (ret && typeof ret.then === 'function') ret.then(resolve, reject);
                } catch (e) {
                    reject(e);
                }
            });
            const peaks = computePeaksFromBuffer(decoded, count);
            _peaksCache.set(cacheKey, peaks);
            return peaks;
        } catch (error) {
            console.warn('Waveform decode failed:', error);
            return null;
        }
    }

    function drawWaveform(canvas, peaks, ratio, colors) {
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        const dpr = window.devicePixelRatio || 1;
        const rect = canvas.getBoundingClientRect();
        const width = Math.max(1, Math.floor(rect.width));
        const height = Math.max(1, Math.floor(rect.height));
        if (canvas.width !== width * dpr || canvas.height !== height * dpr) {
            canvas.width = width * dpr;
            canvas.height = height * dpr;
        }
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, width, height);

        const barCount = peaks.length;
        const slot = width / barCount;
        const barWidth = Math.max(1.5, slot * 0.55);
        const midY = height / 2;
        const playedX = Math.max(0, Math.min(width, width * ratio));
        const minBarHeight = 2;

        for (let i = 0; i < barCount; i++) {
            const cx = slot * (i + 0.5);
            const h = Math.max(minBarHeight, peaks[i] * (height - 2));
            ctx.fillStyle = cx < playedX ? colors.played : colors.unplayed;
            const x = cx - barWidth / 2;
            const y = midY - h / 2;
            const r = Math.min(barWidth / 2, 2);
            ctx.beginPath();
            ctx.moveTo(x + r, y);
            ctx.lineTo(x + barWidth - r, y);
            ctx.quadraticCurveTo(x + barWidth, y, x + barWidth, y + r);
            ctx.lineTo(x + barWidth, y + h - r);
            ctx.quadraticCurveTo(x + barWidth, y + h, x + barWidth - r, y + h);
            ctx.lineTo(x + r, y + h);
            ctx.quadraticCurveTo(x, y + h, x, y + h - r);
            ctx.lineTo(x, y + r);
            ctx.quadraticCurveTo(x, y, x + r, y);
            ctx.fill();
        }

        if (ratio > 0 && ratio < 1) {
            ctx.fillStyle = colors.playhead;
            ctx.fillRect(Math.round(playedX) - 1, 0, 2, height);
        }
    }

    function wrapAudio(audioEl, options = {}) {
        if (!audioEl || !(audioEl instanceof HTMLElement)) {
            return null;
        }
        if (audioEl.dataset.simpleAudioWrapped === '1') {
            return audioEl.closest('.simple-audio-player');
        }

        const useWaveform = Boolean(options.waveform);

        const wrapper = document.createElement('div');
        wrapper.className = 'simple-audio-player';
        if (useWaveform) {
            wrapper.classList.add('waveform-mode');
        }
        if (audioEl.classList.contains('hidden')) {
            wrapper.classList.add('hidden');
        }

        const playLabel = String(options.playLabel || '<svg width="16" height="16" viewBox="0 0 20 20" fill="currentColor"><polygon points="4,2 18,10 4,18"/></svg>');
        const pauseLabel = String(options.pauseLabel || '<svg width="16" height="16" viewBox="0 0 20 20" fill="currentColor"><rect x="4" y="3" width="4.5" height="14" rx="1"/><rect x="11.5" y="3" width="4.5" height="14" rx="1"/></svg>');
        const playAriaLabel = String(options.playAriaLabel || 'Play');
        const pauseAriaLabel = String(options.pauseAriaLabel || 'Pause');

        const playBtn = document.createElement('button');
        playBtn.type = 'button';
        playBtn.className = 'audio-play-btn';
        playBtn.innerHTML = playLabel;
        playBtn.setAttribute('data-audio-action', 'toggle');
        playBtn.setAttribute('aria-label', audioEl.paused ? playAriaLabel : pauseAriaLabel);
        playBtn.setAttribute('title', audioEl.paused ? playAriaLabel : pauseAriaLabel);

        const speedBtn = document.createElement('button');
        speedBtn.type = 'button';
        speedBtn.className = 'audio-speed-btn';
        speedBtn.setAttribute('aria-label', 'Playback speed 1x');

        const speedLabelEl = document.createElement('span');
        speedLabelEl.className = 'audio-speed-btn-label';
        speedLabelEl.textContent = '1x';
        speedBtn.appendChild(speedLabelEl);

        let progress = null;
        let timeLabel = null;
        let waveformWrap = null;
        let canvas = null;
        let timeStart = null;
        let timeEnd = null;
        let peaks = null;
        const colors = { played: '#6366f1', unplayed: '#cbd5e1', playhead: '#1e1b4b' };

        if (useWaveform) {
            waveformWrap = document.createElement('div');
            waveformWrap.className = 'audio-waveform-wrap';
            canvas = document.createElement('canvas');
            canvas.className = 'audio-waveform';
            canvas.setAttribute('role', 'slider');
            canvas.setAttribute('aria-label', 'Audio progress');
            canvas.setAttribute('tabindex', '0');
            const timesRow = document.createElement('div');
            timesRow.className = 'audio-waveform-times';
            timeStart = document.createElement('span');
            timeStart.className = 'audio-waveform-time-start';
            timeStart.textContent = '0:00';
            timeEnd = document.createElement('span');
            timeEnd.className = 'audio-waveform-time-end';
            timeEnd.textContent = '0:00';
            timesRow.appendChild(timeStart);
            timesRow.appendChild(timeEnd);
            waveformWrap.appendChild(canvas);
            waveformWrap.appendChild(timesRow);
            peaks = generateFlatPeaks(WAVEFORM_BAR_COUNT);
        } else {
            progress = document.createElement('input');
            progress.className = 'audio-progress';
            progress.type = 'range';
            progress.min = '0';
            progress.max = '1000';
            progress.value = '0';
            progress.step = '1';
            progress.setAttribute('aria-label', 'Audio progress');
            timeLabel = document.createElement('span');
            timeLabel.className = 'audio-time';
            timeLabel.textContent = '0:00 / 0:00';
        }

        audioEl.removeAttribute('controls');
        audioEl.preload = audioEl.preload || 'metadata';

        const parent = audioEl.parentNode;
        if (!parent) {
            return null;
        }
        parent.insertBefore(wrapper, audioEl);
        wrapper.appendChild(audioEl);
        wrapper.appendChild(playBtn);
        if (useWaveform) {
            wrapper.appendChild(waveformWrap);
            wrapper.appendChild(speedBtn);
        } else {
            wrapper.appendChild(speedBtn);
            wrapper.appendChild(progress);
            wrapper.appendChild(timeLabel);
        }

        let speedIndex = 0;
        let playing = false;
        const applySpeed = () => {
            const nextRate = SPEED_OPTIONS[speedIndex];
            audioEl.playbackRate = nextRate;
            const label = `${nextRate}x`;
            speedLabelEl.textContent = label;
            speedBtn.setAttribute('aria-label', `Playback speed ${label}`);
        };

        const getRatio = () => {
            const duration = Number.isFinite(audioEl.duration) && audioEl.duration > 0 ? audioEl.duration : 0;
            const current = Number.isFinite(audioEl.currentTime) && audioEl.currentTime >= 0 ? audioEl.currentTime : 0;
            return duration > 0 ? Math.max(0, Math.min(1, current / duration)) : 0;
        };

        const updateUi = () => {
            const duration = Number.isFinite(audioEl.duration) && audioEl.duration > 0 ? audioEl.duration : 0;
            const current = Number.isFinite(audioEl.currentTime) && audioEl.currentTime >= 0 ? audioEl.currentTime : 0;
            const ratio = getRatio();
            if (useWaveform) {
                drawWaveform(canvas, peaks, ratio, colors);
                timeStart.textContent = formatDuration(current);
                timeEnd.textContent = formatDuration(duration);
            } else {
                progress.value = String(Math.round(ratio * 1000));
                timeLabel.textContent = `${formatDuration(current)} / ${formatDuration(duration)}`;
            }
            const nextLabel = audioEl.paused ? playLabel : pauseLabel;
            const nextAriaLabel = audioEl.paused ? playAriaLabel : pauseAriaLabel;
            playBtn.innerHTML = nextLabel;
            playBtn.setAttribute('aria-label', nextAriaLabel);
            playBtn.setAttribute('title', nextAriaLabel);
        };

        playBtn.addEventListener('click', async () => {
            if (playing) return;
            playing = true;
            try {
                if (audioEl.paused) {
                    if (audioEl.ended) {
                        audioEl.currentTime = 0;
                    }
                    pauseAllExcept(audioEl);
                    await audioEl.play();
                    applySpeed();
                } else {
                    audioEl.pause();
                }
            } catch (error) {
                console.error('Failed to play audio:', error);
            } finally {
                playing = false;
                updateUi();
            }
        });

        speedBtn.addEventListener('click', async () => {
            speedIndex = (speedIndex + 1) % SPEED_OPTIONS.length;
            if (!audioEl.paused) {
                const pos = audioEl.currentTime;
                audioEl.pause();
                applySpeed();
                audioEl.currentTime = pos;
                try { await audioEl.play(); } catch (e) { console.error('Speed change replay failed:', e); }
            } else {
                applySpeed();
            }
            updateUi();
        });

        if (useWaveform) {
            const seekFromEvent = (event) => {
                const duration = Number.isFinite(audioEl.duration) && audioEl.duration > 0 ? audioEl.duration : 0;
                if (duration <= 0) return;
                const rect = canvas.getBoundingClientRect();
                const clientX = event.touches && event.touches[0] ? event.touches[0].clientX : event.clientX;
                const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
                audioEl.currentTime = ratio * duration;
                updateUi();
            };
            let dragging = false;
            canvas.addEventListener('pointerdown', (event) => {
                dragging = true;
                canvas.setPointerCapture && canvas.setPointerCapture(event.pointerId);
                seekFromEvent(event);
            });
            canvas.addEventListener('pointermove', (event) => {
                if (!dragging) return;
                seekFromEvent(event);
            });
            const stopDrag = (event) => {
                if (!dragging) return;
                dragging = false;
                if (canvas.releasePointerCapture && event.pointerId !== undefined) {
                    try { canvas.releasePointerCapture(event.pointerId); } catch (e) { /* ignore */ }
                }
            };
            canvas.addEventListener('pointerup', stopDrag);
            canvas.addEventListener('pointercancel', stopDrag);
            canvas.addEventListener('keydown', (event) => {
                const duration = Number.isFinite(audioEl.duration) && audioEl.duration > 0 ? audioEl.duration : 0;
                if (duration <= 0) return;
                if (event.key === 'ArrowLeft') {
                    audioEl.currentTime = Math.max(0, audioEl.currentTime - 1);
                    updateUi();
                    event.preventDefault();
                } else if (event.key === 'ArrowRight') {
                    audioEl.currentTime = Math.min(duration, audioEl.currentTime + 1);
                    updateUi();
                    event.preventDefault();
                }
            });
            const ro = new ResizeObserver(() => updateUi());
            ro.observe(canvas);
        } else {
            progress.addEventListener('input', () => {
                const duration = Number.isFinite(audioEl.duration) && audioEl.duration > 0 ? audioEl.duration : 0;
                if (duration <= 0) return;
                const pct = Number(progress.value) / 1000;
                audioEl.currentTime = Math.max(0, Math.min(duration, pct * duration));
                updateUi();
            });
        }

        audioEl.addEventListener('timeupdate', updateUi);
        audioEl.addEventListener('loadedmetadata', updateUi);
        audioEl.addEventListener('durationchange', updateUi);
        audioEl.addEventListener('play', () => {
            applySpeed();
            updateUi();
        });
        audioEl.addEventListener('pause', updateUi);
        audioEl.addEventListener('ended', () => {
            audioEl.currentTime = 0;
            updateUi();
        });

        const observer = new MutationObserver(() => {
            wrapper.classList.toggle('hidden', audioEl.classList.contains('hidden'));
        });
        observer.observe(audioEl, { attributes: true, attributeFilter: ['class'] });

        audioEl.dataset.simpleAudioWrapped = '1';
        allPlayers.push({ audio: audioEl });
        applySpeed();
        updateUi();

        if (useWaveform) {
            const src = audioEl.getAttribute('src') || audioEl.src || '';
            wrapper.classList.add('waveform-loading');
            loadRealPeaks(src, WAVEFORM_BAR_COUNT).then((real) => {
                if (real && real.length === WAVEFORM_BAR_COUNT) {
                    peaks = real;
                }
                wrapper.classList.remove('waveform-loading');
                updateUi();
            });
        }
        return wrapper;
    }

    function attach(root, options = {}) {
        const scope = root && typeof root.querySelectorAll === 'function' ? root : document;
        const selector = String(options.selector || 'audio.js-simple-audio').trim() || 'audio.js-simple-audio';
        const nodes = Array.from(scope.querySelectorAll(selector));
        nodes.forEach((audioEl) => {
            wrapAudio(audioEl, options);
        });
    }

    function setVisible(audioEl, visible) {
        if (!audioEl) return;
        const show = Boolean(visible);
        audioEl.classList.toggle('hidden', !show);
        const wrapper = audioEl.closest('.simple-audio-player');
        if (wrapper) {
            wrapper.classList.toggle('hidden', !show);
        }
    }

    global.SimpleAudioPlayer = {
        attach,
        wrapAudio,
        setVisible,
        getBarClassByScore,
    };
})(window);
