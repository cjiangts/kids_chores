(function initWritingAudioSequence(window) {
    function pickPromptUrl(card) {
        if (!card) {
            return '';
        }
        return String(card.prompt_audio_url || card.audio_url || card.prompt_audio_front_url || '').trim();
    }

    function buildPromptUrls(card) {
        const url = pickPromptUrl(card);
        return url ? [url] : [];
    }

    function createPlayer(options = {}) {
        const audio = options.audio || new Audio();
        audio.preload = options.preload || 'auto';
        audio.playsInline = true;

        const fetchOptions = options.fetchOptions || { method: 'GET', credentials: 'same-origin' };
        const onError = typeof options.onError === 'function'
            ? options.onError
            : () => {};

        let token = 0;
        let currentSrc = '';
        const blobCache = new Map();

        function clearCache() {
            blobCache.forEach((blobUrl) => {
                try {
                    URL.revokeObjectURL(blobUrl);
                } catch (error) {
                    // Ignore cleanup errors.
                }
            });
            blobCache.clear();
        }

        function stop() {
            token += 1;
            audio.pause();
            audio.currentTime = 0;
        }

        async function ensureCachedAudioSource(url) {
            if (!url) {
                throw new Error('Missing audio URL');
            }
            if (url.startsWith('blob:')) {
                return url;
            }
            if (blobCache.has(url)) {
                return blobCache.get(url);
            }

            const response = await fetch(url, fetchOptions);
            if (!response.ok) {
                let detail = '';
                try {
                    const payload = await response.clone().json();
                    detail = String(payload?.error || '').trim();
                } catch (error) {
                    try {
                        detail = String(await response.text() || '').trim();
                    } catch (error2) {
                        detail = '';
                    }
                }
                const suffix = detail ? `: ${detail}` : '';
                throw new Error(`HTTP ${response.status}${suffix}`);
            }
            const blob = await response.blob();
            const blobUrl = URL.createObjectURL(blob);
            blobCache.set(url, blobUrl);
            return blobUrl;
        }

        function warm(urls) {
            const url = Array.isArray(urls)
                ? String(urls[0] || '').trim()
                : String(urls || '').trim();
            if (!url) {
                return;
            }
            ensureCachedAudioSource(url).catch(() => {
                // Best-effort warmup only.
            });
        }

        async function playUrls(urls) {
            const url = Array.isArray(urls)
                ? String(urls[0] || '').trim()
                : String(urls || '').trim();
            if (!url) {
                stop();
                return false;
            }

            const playbackToken = ++token;
            audio.pause();
            audio.currentTime = 0;

            const playSource = async (source) => {
                if (playbackToken !== token) {
                    return false;
                }
                if (currentSrc !== source) {
                    audio.src = source;
                    currentSrc = source;
                    audio.load();
                }
                audio.currentTime = 0;
                await audio.play();
                return true;
            };

            try {
                // Prefer direct URL for maximum browser compatibility.
                await playSource(url);
                return true;
            } catch (directError) {
                try {
                    const cachedSource = await ensureCachedAudioSource(url);
                    await playSource(cachedSource);
                    return true;
                } catch (fallbackError) {
                    onError(fallbackError);
                    return false;
                }
            }
        }

        function getPromptUrls(card) {
            return buildPromptUrls(card);
        }

        async function playCard(card) {
            return playUrls(getPromptUrls(card));
        }

        function prefetchCard(card) {
            warm(getPromptUrls(card));
        }

        return {
            audio,
            buildPromptUrls: getPromptUrls,
            playCard,
            playUrls,
            prefetchCard,
            stop,
            clearCache,
            warm,
        };
    }

    window.WritingAudioSequence = {
        buildPromptUrls,
        createPlayer,
    };
}(window));
