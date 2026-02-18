const _sessionStartByPendingId = new Map();

window.PracticeSession = {
    hasActiveSession(pendingSessionId) {
        return !!pendingSessionId;
    },

    markSessionStarted(pendingSessionId, startedAtMs) {
        if (!pendingSessionId) {
            return;
        }
        const parsed = Number(startedAtMs);
        const safeMs = Number.isFinite(parsed) && parsed > 0 ? parsed : Date.now();
        _sessionStartByPendingId.set(String(pendingSessionId), safeMs);
    },

    clearSessionStart(pendingSessionId) {
        if (!pendingSessionId) {
            return;
        }
        _sessionStartByPendingId.delete(String(pendingSessionId));
    },

    buildCompletePayload(pendingSessionId, answers) {
        const key = String(pendingSessionId || '');
        const startedAtMs = _sessionStartByPendingId.get(key);
        return {
            pendingSessionId,
            answers: Array.isArray(answers) ? answers : [],
            startedAt: startedAtMs ? new Date(startedAtMs).toISOString() : null,
        };
    },
};
