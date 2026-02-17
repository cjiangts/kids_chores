window.PracticeSession = {
    hasActiveSession(pendingSessionId) {
        return !!pendingSessionId;
    },

    buildCompletePayload(pendingSessionId, answers) {
        return {
            pendingSessionId,
            answers: Array.isArray(answers) ? answers : []
        };
    }
};
