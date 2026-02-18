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
};
