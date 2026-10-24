(function () {
    'use strict';

    const PLAY_SVG = '<svg width="18" height="18" viewBox="0 0 20 20" fill="currentColor"><polygon points="5,3 17,10 5,17"/></svg>';
    const PAUSE_SVG = '<svg width="18" height="18" viewBox="0 0 20 20" fill="currentColor"><rect x="4" y="3" width="4.5" height="14" rx="1"/><rect x="11.5" y="3" width="4.5" height="14" rx="1"/></svg>';

    function renderRow({ item, audioExtraAttrs }) {
        if (!item || !item.audio_url) {
            return '';
        }
        const durationMs = Math.max(0, Number(item.response_time_ms) || 0);
        const audioEl = `<audio class="attempt-audio js-simple-audio" preload="none" data-audio-src="${escapeHtml(item.audio_url)}" data-duration-ms="${durationMs}"${audioExtraAttrs || ''}></audio>`;
        return `<div class="audio-history-row">${audioEl}</div>`;
    }

    function attachPlayers(container, options = {}) {
        if (!window.SimpleAudioPlayer || !container) return;
        window.SimpleAudioPlayer.attach(container, {
            selector: 'audio.js-simple-audio',
            waveform: true,
            playLabel: PLAY_SVG,
            pauseLabel: PAUSE_SVG,
            rewindSeconds: options.rewindSeconds,
        });
    }

    window.AudioHistoryCommon = {
        renderRow,
        attachPlayers,
    };
})();
