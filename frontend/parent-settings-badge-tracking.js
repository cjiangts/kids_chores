let badgeTrackingStarted = false;
let badgeTrackingStartedAt = '';
let badgeTrackingFamilyTimezone = '';
let badgeTrackingStatusState = 'loading';

function syncBadgeTrackingButtonsState(activeAction = '') {
    const isStarting = activeAction === 'start';
    const isResetting = activeAction === 'reset';
    const isStatusReady = badgeTrackingStatusState === 'ready';
    if (startBadgeTrackingBtn) {
        startBadgeTrackingBtn.disabled = !isStatusReady || badgeTrackingStarted || isStarting || isResetting;
        const startLabel = startBadgeTrackingBtn.querySelector('.btn-label');
        if (startLabel) {
            startLabel.textContent = isStarting
                ? 'Starting...'
                : (badgeTrackingStarted ? 'Started' : 'Start');
        }
    }
    if (resetBadgeTrackingBtn) {
        resetBadgeTrackingBtn.disabled = !isStatusReady || !badgeTrackingStarted || isStarting || isResetting;
        const resetLabel = resetBadgeTrackingBtn.querySelector('.btn-label');
        if (resetLabel) {
            resetLabel.textContent = isResetting ? 'Resetting...' : 'Reset';
        }
    }
}

function renderBadgeTrackingStatus() {
    if (badgeTrackingStatusText) {
        if (badgeTrackingStatusState === 'loading') {
            badgeTrackingStatusText.innerHTML = '<span class="app-spinner app-spinner--small" role="status" aria-label="Loading badges"></span>';
        } else if (badgeTrackingStatusState === 'error') {
            badgeTrackingStatusText.textContent = 'Badge tracking unavailable.';
        } else if (badgeTrackingStarted) {
            const startedAtText = formatStartedAt(badgeTrackingStartedAt, badgeTrackingFamilyTimezone);
            badgeTrackingStatusText.textContent = startedAtText
                ? `Badge tracking started ${startedAtText}.`
                : 'Badge tracking started.';
        } else {
            badgeTrackingStatusText.textContent = 'Badge tracking not started.';
        }
    }
}

async function loadBadgeTrackingStatus() {
    try {
        badgeTrackingStatusState = 'loading';
        renderBadgeTrackingStatus();
        syncBadgeTrackingButtonsState('');
        showBadgeTrackingError('');
        showBadgeTrackingSuccess('');
        const response = await fetch(`${API_BASE}/parent-settings/badges/status`);
        const result = await response.json().catch(() => ({}));
        if (!response.ok) {
            throw new Error(result.error || `HTTP ${response.status}`);
        }
        badgeTrackingStatusState = 'ready';
        badgeTrackingStarted = Boolean(result.started);
        badgeTrackingStartedAt = String(result.startedAt || '');
        badgeTrackingFamilyTimezone = String(result.familyTimezone || '').trim();
        if (!badgeTrackingFamilyTimezone) {
            throw new Error('familyTimezone missing from badge tracking status');
        }
        renderBadgeTrackingStatus();
        syncBadgeTrackingButtonsState('');
    } catch (error) {
        console.error('Error loading badge tracking status:', error);
        badgeTrackingStatusState = 'error';
        badgeTrackingStarted = false;
        badgeTrackingStartedAt = '';
        renderBadgeTrackingStatus();
        syncBadgeTrackingButtonsState('');
        showBadgeTrackingError('Failed to load badge tracking status.');
    }
}

async function startBadgeTracking() {
    if (badgeTrackingStarted) {
        return;
    }
    showBadgeTrackingError('');
    showBadgeTrackingSuccess('');
    const warningMessage = 'Badge tracking will begin immediately. Only sessions completed after you start will count.';
    const password = await promptPasswordOnce('starting badges', warningMessage);
    if (!password) {
        return;
    }

    try {
        syncBadgeTrackingButtonsState('start');
        const response = await fetch(`${API_BASE}/parent-settings/badges/start`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ confirmPassword: password }),
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok) {
            showBadgeTrackingError(result.error || 'Failed to start badge tracking.');
            return;
        }
        badgeTrackingStarted = Boolean(result.started);
        badgeTrackingStartedAt = String(result.startedAt || '');
        badgeTrackingFamilyTimezone = String(result.familyTimezone || '').trim();
        if (!badgeTrackingFamilyTimezone) {
            showBadgeTrackingError('Family timezone is missing.');
            return;
        }
        renderBadgeTrackingStatus();
        syncBadgeTrackingButtonsState('');
        const startedText = formatStartedAt(badgeTrackingStartedAt, badgeTrackingFamilyTimezone);
        showBadgeTrackingSuccess(startedText ? `Badge tracking started at ${startedText}.` : 'Badge tracking started.');
    } catch (error) {
        console.error('Error starting badge tracking:', error);
        showBadgeTrackingError('Failed to start badge tracking.');
        syncBadgeTrackingButtonsState('');
    }
}

async function resetBadgeTracking() {
    showBadgeTrackingError('');
    showBadgeTrackingSuccess('');
    const password = await promptPasswordOnce(
        'resetting badges',
        'This will delete all badge awards for every kid in this family and clear the badge start timestamp.'
    );
    if (!password) {
        return;
    }

    try {
        syncBadgeTrackingButtonsState('reset');
        const response = await fetch(`${API_BASE}/parent-settings/badges/reset`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ confirmPassword: password }),
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok) {
            showBadgeTrackingError(result.error || 'Failed to reset badges.');
            return;
        }
        badgeTrackingStarted = Boolean(result.started);
        badgeTrackingStartedAt = String(result.startedAt || '');
        badgeTrackingFamilyTimezone = String(result.familyTimezone || '').trim();
        if (!badgeTrackingFamilyTimezone) {
            showBadgeTrackingError('Family timezone is missing.');
            return;
        }
        renderBadgeTrackingStatus();
        syncBadgeTrackingButtonsState('');
        const deletedAwardCount = Number.isFinite(Number(result.deletedAwardCount))
            ? Number(result.deletedAwardCount)
            : 0;
        showBadgeTrackingSuccess(`Badges reset. Deleted ${deletedAwardCount} award(s).`);
    } catch (error) {
        console.error('Error resetting badges:', error);
        showBadgeTrackingError('Failed to reset badges.');
        syncBadgeTrackingButtonsState('');
    }
}

renderBadgeTrackingStatus();
syncBadgeTrackingButtonsState('');
