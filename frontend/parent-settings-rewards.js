let rewardsTrackingStarted = false;
let rewardsTrackingStartedAt = '';
let rewardsFamilyTimezone = DEFAULT_FAMILY_TIMEZONE;
let rewardsStatusState = 'loading';

function syncRewardsButtonsState(activeAction = '') {
    const isStarting = activeAction === 'start';
    const isResetting = activeAction === 'reset';
    const isStatusReady = rewardsStatusState === 'ready';
    if (startRewardsBtn) {
        startRewardsBtn.disabled = !isStatusReady || rewardsTrackingStarted || isStarting || isResetting;
        const startLabel = startRewardsBtn.querySelector('.btn-label');
        if (startLabel) {
            startLabel.textContent = isStarting
                ? 'Starting...'
                : (rewardsTrackingStarted ? 'Started' : 'Start');
        }
    }
    if (resetRewardsBtn) {
        resetRewardsBtn.disabled = !isStatusReady || !rewardsTrackingStarted || isStarting || isResetting;
        const resetLabel = resetRewardsBtn.querySelector('.btn-label');
        if (resetLabel) {
            resetLabel.textContent = isResetting ? 'Resetting...' : 'Reset';
        }
    }
}

function renderRewardsStatus() {
    if (rewardsStatusText) {
        if (rewardsStatusState === 'loading') {
            rewardsStatusText.innerHTML = '<span class="app-spinner app-spinner--small" role="status" aria-label="Loading rewards"></span>';
        } else if (rewardsStatusState === 'error') {
            rewardsStatusText.textContent = 'Reward tracking unavailable.';
        } else if (rewardsTrackingStarted) {
            const startedAtText = formatStartedAt(rewardsTrackingStartedAt, rewardsFamilyTimezone);
            rewardsStatusText.textContent = startedAtText
                ? `Reward tracking started ${startedAtText}.`
                : 'Reward tracking started.';
        } else {
            rewardsStatusText.textContent = 'Reward tracking not started.';
        }
    }
}

async function loadRewardsStatus() {
    try {
        rewardsStatusState = 'loading';
        renderRewardsStatus();
        syncRewardsButtonsState('');
        showRewardsError('');
        showRewardsSuccess('');
        const response = await fetch(`${API_BASE}/parent-settings/rewards/status`);
        const result = await response.json().catch(() => ({}));
        if (!response.ok) {
            throw new Error(result.error || `HTTP ${response.status}`);
        }
        rewardsStatusState = 'ready';
        rewardsTrackingStarted = Boolean(result.started);
        rewardsTrackingStartedAt = String(result.startedAt || '');
        rewardsFamilyTimezone = String(result.familyTimezone || rewardsFamilyTimezone || DEFAULT_FAMILY_TIMEZONE);
        renderRewardsStatus();
        syncRewardsButtonsState('');
    } catch (error) {
        console.error('Error loading rewards status:', error);
        rewardsStatusState = 'error';
        rewardsTrackingStarted = false;
        rewardsTrackingStartedAt = '';
        renderRewardsStatus();
        syncRewardsButtonsState('');
        showRewardsError('Failed to load reward tracking status.');
    }
}

async function startRewardsTracking() {
    if (rewardsTrackingStarted) {
        return;
    }
    showRewardsError('');
    showRewardsSuccess('');
    const warningMessage = 'Reward tracking will begin immediately. Only sessions completed after you start will count.';
    const password = await promptPasswordOnce('starting rewards', warningMessage);
    if (!password) {
        return;
    }

    try {
        syncRewardsButtonsState('start');
        const response = await fetch(`${API_BASE}/parent-settings/rewards/start`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ confirmPassword: password }),
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok) {
            showRewardsError(result.error || 'Failed to start reward tracking.');
            return;
        }
        rewardsTrackingStarted = Boolean(result.started);
        rewardsTrackingStartedAt = String(result.startedAt || '');
        rewardsFamilyTimezone = String(result.familyTimezone || rewardsFamilyTimezone || DEFAULT_FAMILY_TIMEZONE);
        renderRewardsStatus();
        syncRewardsButtonsState('');
        const startedText = formatStartedAt(rewardsTrackingStartedAt, rewardsFamilyTimezone);
        showRewardsSuccess(startedText ? `Reward tracking started at ${startedText}.` : 'Reward tracking started.');
    } catch (error) {
        console.error('Error starting rewards tracking:', error);
        showRewardsError('Failed to start reward tracking.');
        syncRewardsButtonsState('');
    }
}

async function resetRewardsTracking() {
    showRewardsError('');
    showRewardsSuccess('');
    const password = await promptPasswordOnce(
        'resetting rewards',
        'This will delete all reward awards for every kid in this family and clear the reward start timestamp.'
    );
    if (!password) {
        return;
    }

    try {
        syncRewardsButtonsState('reset');
        const response = await fetch(`${API_BASE}/parent-settings/rewards/reset`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ confirmPassword: password }),
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok) {
            showRewardsError(result.error || 'Failed to reset rewards.');
            return;
        }
        rewardsTrackingStarted = Boolean(result.started);
        rewardsTrackingStartedAt = String(result.startedAt || '');
        rewardsFamilyTimezone = String(result.familyTimezone || rewardsFamilyTimezone || DEFAULT_FAMILY_TIMEZONE);
        renderRewardsStatus();
        syncRewardsButtonsState('');
        const deletedAwardCount = Number.isFinite(Number(result.deletedAwardCount))
            ? Number(result.deletedAwardCount)
            : 0;
        showRewardsSuccess(`Rewards reset. Deleted ${deletedAwardCount} award(s).`);
    } catch (error) {
        console.error('Error resetting rewards:', error);
        showRewardsError('Failed to reset rewards.');
        syncRewardsButtonsState('');
    }
}

renderRewardsStatus();
syncRewardsButtonsState('');
