window.PracticeUiCommon = {
    formatKidPracticeTitle(kidName) {
        return `${String(kidName || '').trim()}'s Practice`;
    },

    getKidInitial(name) {
        const trimmed = String(name || '').trim();
        if (!trimmed) {
            return '?';
        }
        return String.fromCodePoint(trimmed.codePointAt(0)).toUpperCase();
    },

    hashStringToToneIndex(value, toneCount = 6) {
        const s = String(value || '');
        let hash = 0;
        for (let i = 0; i < s.length; i += 1) {
            hash = ((hash << 5) - hash) + s.charCodeAt(i);
            hash |= 0;
        }
        const m = Math.max(1, toneCount);
        return ((hash % m) + m) % m;
    },

    applyKidInitialAvatar(el, kid) {
        if (!el) {
            return;
        }
        const name = String(kid?.name || '');
        const initial = window.PracticeUiCommon.getKidInitial(name);
        const tone = window.PracticeUiCommon.hashStringToToneIndex(kid?.id || name);
        el.className = `page-title-icon kid-initial-avatar kid-initial-avatar--tone-${tone}`;
        el.textContent = initial;
    },

    shuffleCards(cardsList) {
        const shuffled = [...(Array.isArray(cardsList) ? cardsList : [])];
        for (let i = shuffled.length - 1; i > 0; i -= 1) {
            const j = Math.floor(Math.random() * (i + 1));
            [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
        }
        return shuffled;
    },

    formatElapsed(ms) {
        const totalSeconds = Math.max(0, Math.floor((Number(ms) || 0) / 1000));
        const minutes = Math.floor(totalSeconds / 60);
        const seconds = totalSeconds % 60;
        return `${String(minutes)}:${String(seconds).padStart(2, '0')}`;
    },

    showAlertError(errorState, errorElement, message) {
        if (message) {
            const text = String(message);
            if (errorElement) {
                errorElement.textContent = '';
                errorElement.classList.add('hidden');
            }
            if (!errorState || errorState.lastMessage !== text) {
                window.alert(text);
                if (errorState) {
                    errorState.lastMessage = text;
                }
            }
            return;
        }

        if (errorState) {
            errorState.lastMessage = '';
        }
        if (errorElement) {
            errorElement.classList.add('hidden');
        }
    },

    confirmEarlyFinish({ completedCount, totalCount, resultLabel = 'results' }) {
        const completed = Math.max(0, Number.parseInt(completedCount, 10) || 0);
        const total = Math.max(0, Number.parseInt(totalCount, 10) || 0);
        const missing = Math.max(0, total - completed);
        const message = [
            'Finish session early?',
            '',
            'This will end the current session now.',
            `Recorded ${resultLabel}: ${completed}`,
            `Missing ${resultLabel}: ${missing}`,
        ].join('\n');
        return window.confirm(message);
    },

    createEarlyFinishController({
        button,
        getHasActiveSession,
        getTotalCount,
        getRecordedCount,
        showError,
        onConfirmFinish,
        onCancelBeforeFirstAnswer,
    }) {
        const FINISH_HTML = '<span class="icon" data-icon="flag" data-icon-size="18"></span> Finish Early';
        const CANCEL_HTML = '<span class="icon" data-icon="arrow-left" data-icon-size="18"></span> Cancel';
        let currentMode = 'finish';
        const renderMode = (mode) => {
            if (!button || mode === currentMode) return;
            currentMode = mode;
            button.innerHTML = mode === 'cancel' ? CANCEL_HTML : FINISH_HTML;
            if (window.hydrateIcons) {
                window.hydrateIcons(button);
            }
        };
        return {
            updateButtonState() {
                if (!button) {
                    return;
                }
                const hasActiveSession = Boolean(getHasActiveSession && getHasActiveSession());
                const sessionScreen = document.getElementById('sessionScreen');
                const shouldShow = sessionScreen
                    ? !sessionScreen.classList.contains('hidden')
                    : hasActiveSession;
                button.classList.toggle('hidden', !shouldShow);
                const recordedCount = Math.max(0, Number.parseInt(getRecordedCount && getRecordedCount(), 10) || 0);
                const cancelMode = hasActiveSession && recordedCount <= 0 && typeof onCancelBeforeFirstAnswer === 'function';
                renderMode(cancelMode ? 'cancel' : 'finish');
                button.disabled = !hasActiveSession || (recordedCount <= 0 && !cancelMode);
            },

            requestFinish() {
                if (!(getHasActiveSession && getHasActiveSession())) {
                    return;
                }
                const recordedCount = Math.max(0, Number.parseInt(getRecordedCount && getRecordedCount(), 10) || 0);
                if (recordedCount <= 0) {
                    if (typeof onCancelBeforeFirstAnswer === 'function') {
                        onCancelBeforeFirstAnswer();
                    }
                    return;
                }
                const totalCount = Math.max(0, Number.parseInt(getTotalCount && getTotalCount(), 10) || 0);
                if (totalCount <= 0) {
                    return;
                }
                const confirmed = window.PracticeUiCommon.confirmEarlyFinish({
                    completedCount: recordedCount,
                    totalCount,
                    resultLabel: 'results',
                });
                if (!confirmed) {
                    return;
                }
                if (onConfirmFinish) {
                    onConfirmFinish();
                }
            },
        };
    },
};
