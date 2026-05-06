(function () {
    'use strict';

    function sanitizeFilenamePart(value, fallback) {
        const cleaned = String(value || '')
            .replace(/[\\/:*?"<>|]+/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
        return cleaned || fallback;
    }

    function resolveAudioFileName(item) {
        const explicit = String(item?.audio_file_name || '').trim();
        if (explicit) {
            return explicit;
        }
        const audioUrl = String(item?.audio_url || '').trim();
        if (!audioUrl) {
            return '';
        }
        try {
            const parsed = new URL(audioUrl, window.location.origin);
            const parts = parsed.pathname.split('/');
            return decodeURIComponent(parts[parts.length - 1] || '').trim();
        } catch (error) {
            return '';
        }
    }

    function buildDownloadFilename(kidName, label) {
        const kidPart = sanitizeFilenamePart(kidName, 'Kid');
        const labelPart = sanitizeFilenamePart(label, 'Card');
        const base = `${kidPart}-${labelPart}`.slice(0, 120);
        return `${base}.mp3`;
    }

    function buildDownloadUrl(kidId, item, downloadFilename) {
        const fileName = resolveAudioFileName(item);
        if (!fileName) {
            return String(item?.audio_url || '').trim();
        }
        const path = `/api/kids/${encodeURIComponent(String(kidId || ''))}/lesson-reading/audio/${encodeURIComponent(fileName)}/download-mp3`;
        const query = new URLSearchParams();
        query.set('downloadName', String(downloadFilename || '').replace(/\.mp3$/i, ''));
        return `${path}?${query.toString()}`;
    }

    function renderRow({ item, kidId, kidName, label, audioExtraAttrs }) {
        if (!item || !item.audio_url) {
            return '';
        }
        const filename = buildDownloadFilename(kidName, label);
        const url = buildDownloadUrl(kidId, item, filename);
        const downloadIcon = window.icon ? window.icon('download', { size: 16, strokeWidth: 2.2 }) : '';
        const audioEl = `<audio class="attempt-audio js-simple-audio" preload="metadata" src="${escapeHtml(item.audio_url)}"${audioExtraAttrs || ''}></audio>`;
        const downloadBtn = `<a class="audio-download-btn" href="${escapeHtml(url)}" download="${escapeHtml(filename)}" aria-label="Download audio" title="Download">${downloadIcon}</a>`;
        return `<div class="audio-history-row">${audioEl}${downloadBtn}</div>`;
    }

    window.AudioHistoryCommon = {
        sanitizeFilenamePart,
        resolveAudioFileName,
        buildDownloadFilename,
        buildDownloadUrl,
        renderRow,
    };
})();
