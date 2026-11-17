// Install the local data source before the unchanged practice pages start loading.
window.OfflinePracticeClient = { active: false };
window.OfflinePracticeClient.ready = (async () => {
    let setup = await window.OfflineSetupStore.getBoundSetup();
    if (setup?.status !== 'active') return false;
    window.OfflinePracticeClient.active = true;
    window.KidAppNavigation?.render();
    try { await window.OfflineDownload.installWorker(); }
    catch (error) { if (!navigator.serviceWorker?.controller) throw error; }
    if (!setup.manifest.practiceConfig) {
        // Upgrade previously downloaded plans without changing any selected questions.
        setup = await window.OfflineDownload.start(setup);
    }
    try { sessionStorage.removeItem('kid_practice_nav_cache_v1'); } catch (_) { /* Optional navigation cache. */ }
    if (window.PracticeSessionFlow) window.PracticeSessionFlow.progressDiscarder = async (state) => {
        const response = await fetch(`/api/kids/${encodeURIComponent(setup.kidId)}/offline-practice/discard`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ pendingSessionId: state.activePendingSessionId }),
        });
        if (!response.ok) throw new Error((await response.json()).error || 'Could not discard this attempt.');
    };
    if (window.PracticeSessionFlow) window.PracticeSessionFlow.progressWriter = async (state) => {
        state.savingProgress = true;
        const clientProgress = state.drillActive ? Object.fromEntries([
            'drillActive', 'drillTargetAttempts', 'drillAttemptsDone', 'drillSpeedTargetMs',
            'drillActiveIds', 'drillQueueIds', 'drillRecentIds', 'drillCurrentRoundIds',
            'drillCardStats', 'drillCardIndexById',
        ].map((key) => [key, state[key]])) : null;
        const form = new FormData();
        form.append('payload', JSON.stringify({ pendingSessionId: state.activePendingSessionId,
            answers: state.sessionAnswers, clientProgress }));
        for (const [cardId, clip] of Object.entries(state.sessionRecordings || {})) {
            if (clip?.blob) form.append(`audio:${cardId}`, clip.blob, `recording-${cardId}`);
        }
        try {
            const response = await fetch(`/api/kids/${encodeURIComponent(setup.kidId)}/offline-practice/progress`, { method: 'POST', body: form });
            const payload = await response.json();
            if (!response.ok) throw new Error(payload.error || 'Could not save local progress.');
            state.savingProgress = false;
        } catch (error) {
            window.showError?.(`${error.message} Free space if needed, then reload to resume the last saved question.`);
            throw error;
        }
    };
    return true;
})();
