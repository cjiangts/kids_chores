window.PracticeSessionFlow = {
    async startShuffledSession(url, body = {}) {
        const clientSessionStartMs = Date.now();
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }

        const data = await response.json();
        const pendingSessionId = data.pending_session_id || null;
        window.PracticeSession.markSessionStarted(pendingSessionId, clientSessionStartMs);
        const cards = window.PracticeUiCommon.shuffleCards(data.cards || []);
        return { pendingSessionId, cards, data };
    },

    async postCompleteSession(url, pendingSessionId, answers, extraPayload = null) {
        const payload = window.PracticeSession.buildCompletePayload(pendingSessionId, answers);
        if (extraPayload && typeof extraPayload === 'object') {
            Object.assign(payload, extraPayload);
        }
        return fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });
    },
};
