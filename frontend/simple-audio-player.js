(function initSimpleAudioPlayer(global) {
    const SPEED_OPTIONS = [1, 2];

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

    function wrapAudio(audioEl, options = {}) {
        if (!audioEl || !(audioEl instanceof HTMLElement)) {
            return null;
        }
        if (audioEl.dataset.simpleAudioWrapped === '1') {
            return audioEl.closest('.simple-audio-player');
        }

        const wrapper = document.createElement('div');
        wrapper.className = 'simple-audio-player';
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
        speedBtn.textContent = '1x';
        speedBtn.setAttribute('aria-label', 'Playback speed 1x');

        const progress = document.createElement('input');
        progress.className = 'audio-progress';
        progress.type = 'range';
        progress.min = '0';
        progress.max = '1000';
        progress.value = '0';
        progress.step = '1';
        progress.setAttribute('aria-label', 'Audio progress');

        const timeLabel = document.createElement('span');
        timeLabel.className = 'audio-time';
        timeLabel.textContent = '0:00 / 0:00';

        audioEl.removeAttribute('controls');
        audioEl.preload = audioEl.preload || 'metadata';

        const parent = audioEl.parentNode;
        if (!parent) {
            return null;
        }
        parent.insertBefore(wrapper, audioEl);
        wrapper.appendChild(audioEl);
        wrapper.appendChild(playBtn);
        wrapper.appendChild(speedBtn);
        wrapper.appendChild(progress);
        wrapper.appendChild(timeLabel);

        let speedIndex = 0;
        const applySpeed = () => {
            const nextRate = SPEED_OPTIONS[speedIndex];
            audioEl.playbackRate = nextRate;
            const label = `${nextRate}x`;
            speedBtn.textContent = label;
            speedBtn.setAttribute('aria-label', `Playback speed ${label}`);
        };

        const updateUi = () => {
            const duration = Number.isFinite(audioEl.duration) && audioEl.duration > 0 ? audioEl.duration : 0;
            const current = Number.isFinite(audioEl.currentTime) && audioEl.currentTime >= 0 ? audioEl.currentTime : 0;
            const ratio = duration > 0 ? Math.max(0, Math.min(1, current / duration)) : 0;
            progress.value = String(Math.round(ratio * 1000));
            timeLabel.textContent = `${formatDuration(current)} / ${formatDuration(duration)}`;
            const nextLabel = audioEl.paused ? playLabel : pauseLabel;
            const nextAriaLabel = audioEl.paused ? playAriaLabel : pauseAriaLabel;
            playBtn.innerHTML = nextLabel;
            playBtn.setAttribute('aria-label', nextAriaLabel);
            playBtn.setAttribute('title', nextAriaLabel);
        };

        playBtn.addEventListener('click', async () => {
            try {
                if (audioEl.paused) {
                    await audioEl.play();
                } else {
                    audioEl.pause();
                }
            } catch (error) {
                console.error('Failed to play audio:', error);
            } finally {
                updateUi();
            }
        });

        speedBtn.addEventListener('click', () => {
            speedIndex = (speedIndex + 1) % SPEED_OPTIONS.length;
            applySpeed();
        });

        progress.addEventListener('input', () => {
            const duration = Number.isFinite(audioEl.duration) && audioEl.duration > 0 ? audioEl.duration : 0;
            if (duration <= 0) return;
            const pct = Number(progress.value) / 1000;
            audioEl.currentTime = Math.max(0, Math.min(duration, pct * duration));
            updateUi();
        });

        audioEl.addEventListener('timeupdate', updateUi);
        audioEl.addEventListener('loadedmetadata', updateUi);
        audioEl.addEventListener('durationchange', updateUi);
        audioEl.addEventListener('play', updateUi);
        audioEl.addEventListener('pause', updateUi);
        audioEl.addEventListener('ended', updateUi);

        const observer = new MutationObserver(() => {
            wrapper.classList.toggle('hidden', audioEl.classList.contains('hidden'));
        });
        observer.observe(audioEl, { attributes: true, attributeFilter: ['class'] });

        audioEl.dataset.simpleAudioWrapped = '1';
        applySpeed();
        updateUi();
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
