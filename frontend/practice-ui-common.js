window.PracticeUiCommon = {
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
        emptyAnswerMessage,
        showError,
        onConfirmFinish,
    }) {
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
                button.disabled = !hasActiveSession || recordedCount <= 0;
            },

            requestFinish() {
                if (!(getHasActiveSession && getHasActiveSession())) {
                    return;
                }
                const totalCount = Math.max(0, Number.parseInt(getTotalCount && getTotalCount(), 10) || 0);
                if (totalCount <= 0) {
                    return;
                }
                const recordedCount = Math.max(0, Number.parseInt(getRecordedCount && getRecordedCount(), 10) || 0);
                if (recordedCount <= 0) {
                    if (showError && emptyAnswerMessage) {
                        showError(emptyAnswerMessage);
                    }
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
