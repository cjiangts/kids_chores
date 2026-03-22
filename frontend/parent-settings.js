const API_BASE = `${window.location.origin}/api`;

function badgeArtIdentityKeyFromPath(imagePath) {
    const normalized = String(imagePath || '').trim().toLowerCase();
    if (!normalized) {
        return '';
    }
    const slashIndex = normalized.lastIndexOf('/');
    return slashIndex >= 0 ? normalized.slice(slashIndex + 1) : normalized;
}

const passwordForm = document.getElementById('passwordForm');
const currentPasswordInput = document.getElementById('currentPassword');
const newPasswordInput = document.getElementById('newPassword');
const confirmPasswordInput = document.getElementById('confirmPassword');
const changePasswordBtn = document.getElementById('changePasswordBtn');
const familyManageDeckLink = document.getElementById('familyManageDeckLink');
const openChangePasswordBtn = document.getElementById('openChangePasswordBtn');
const familySettingsLogoutBtn = document.getElementById('familySettingsLogoutBtn');
const changePasswordModal = document.getElementById('changePasswordModal');
const closeChangePasswordBtn = document.getElementById('closeChangePasswordBtn');
const familyTimezoneSelect = document.getElementById('familyTimezone');
const saveTimezoneBtn = document.getElementById('saveTimezoneBtn');
const timezoneError = document.getElementById('timezoneError');
const timezoneSuccess = document.getElementById('timezoneSuccess');
const rewardsStatusText = document.getElementById('rewardsStatusText');
const startRewardsBtn = document.getElementById('startRewardsBtn');
const resetRewardsBtn = document.getElementById('resetRewardsBtn');
const rewardsError = document.getElementById('rewardsError');
const rewardsSuccess = document.getElementById('rewardsSuccess');
const openBadgeArtStudioBtn = document.getElementById('openBadgeArtStudioBtn');
const badgeArtStudioModal = document.getElementById('badgeArtStudioModal');
const badgeArtStudioDialog = badgeArtStudioModal
    ? badgeArtStudioModal.querySelector('.badge-art-studio-modal')
    : null;
const badgeArtStudioTitle = document.getElementById('badgeArtStudioTitle');
const badgeArtStudioSubtitle = document.getElementById('badgeArtStudioSubtitle');
const badgeArtStudioSaveBtn = document.getElementById('badgeArtStudioSaveBtn');
const badgeArtStudioNoticeModal = document.getElementById('badgeArtStudioNoticeModal');
const badgeArtStudioNoticeTitle = document.getElementById('badgeArtStudioNoticeTitle');
const badgeArtStudioNoticeText = document.getElementById('badgeArtStudioNoticeText');
const badgeArtStudioNoticeOkBtn = document.getElementById('badgeArtStudioNoticeOkBtn');
const badgeAchievementCount = document.getElementById('badgeAchievementCount');
const badgeArtAchievementSectionTitle = document.getElementById('badgeArtAchievementSectionTitle');
const badgeArtAchievementList = document.getElementById('badgeArtAchievementList');
const badgeArtSelectionSectionTitle = document.getElementById('badgeArtSelectionSectionTitle');
const badgeArtSelectionEmpty = document.getElementById('badgeArtSelectionEmpty');
const badgeArtSelectionPanel = document.getElementById('badgeArtSelectionPanel');
const badgeArtSelectedPreview = document.getElementById('badgeArtSelectedPreview');
const badgeArtSelectedTitle = document.getElementById('badgeArtSelectedTitle');
const badgeArtSelectedMeta = document.getElementById('badgeArtSelectedMeta');
const badgeArtSelectedCurrent = document.getElementById('badgeArtSelectedCurrent');
const badgeArtBankCount = document.getElementById('badgeArtBankCount');
const badgeArtBankGrid = document.getElementById('badgeArtBankGrid');
const downloadBackupBtn = document.getElementById('downloadBackupBtn');
const restoreBackupBtn = document.getElementById('restoreBackupBtn');
const backupFileInput = document.getElementById('backupFileInput');
const backupInfo = document.getElementById('backupInfo');
const backupSettingsCard = document.getElementById('backupSettingsCard');
const familyAdminCard = document.getElementById('familyAdminCard');
const familyAccountsList = document.getElementById('familyAccountsList');
const familyStorageSummary = document.getElementById('familyStorageSummary');
const familyAccountsEmpty = document.getElementById('familyAccountsEmpty');
const familyAdminError = document.getElementById('familyAdminError');
const familyAdminSuccess = document.getElementById('familyAdminSuccess');
const successMessage = document.getElementById('successMessage');
const errorMessage = document.getElementById('errorMessage');
const passwordError = document.getElementById('passwordError');
const passwordSuccess = document.getElementById('passwordSuccess');
let pendingRestorePassword = null;
const DEFAULT_FAMILY_TIMEZONE = 'America/New_York';
const COMMON_TIMEZONES = [
    'America/New_York',
    'America/Chicago',
    'America/Denver',
    'America/Los_Angeles',
    'America/Phoenix',
    'America/Anchorage',
    'Pacific/Honolulu',
    'UTC',
    'Europe/London',
    'Europe/Paris',
    'Asia/Shanghai',
    'Asia/Tokyo',
    'Australia/Sydney'
];
let isSuperFamily = false;
let rewardsTrackingStarted = false;
let rewardsTrackingStartedAt = '';
let rewardsFamilyTimezone = DEFAULT_FAMILY_TIMEZONE;
let rewardsStatusState = 'loading';
let badgeArtStudioCanEdit = false;
let badgeArtStudioHasLoaded = false;
let badgeArtStudioPersistedData = {
    achievements: [],
    artCatalog: [],
};
let badgeArtStudioData = {
    achievements: [],
    artCatalog: [],
};
let badgeArtSelectedKey = '';
let badgeArtStudioLoading = false;
let badgeArtStudioSaving = false;
let badgeArtStudioNoticeResolver = null;
const badgeArtStudioObjectUrlByIdentityKey = new Map();
let badgeArtStudioAssetPreloadPromise = null;

renderRewardsStatus();
syncRewardsButtonsState('');

function syncModalBodyLock() {
    const shouldLock = [
        changePasswordModal,
        badgeArtStudioModal,
        badgeArtStudioNoticeModal,
    ].some((modal) => modal && !modal.classList.contains('hidden'));
    document.body.style.overflow = shouldLock ? 'hidden' : '';
}

function escapeHtml(value) {
    return String(value || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function getClosestEventTarget(event, selector) {
    const rawTarget = event && event.target;
    if (!rawTarget) {
        return null;
    }
    const element = rawTarget instanceof Element
        ? rawTarget
        : rawTarget.parentElement;
    if (!element) {
        return null;
    }
    return element.closest(selector);
}

function cloneBadgeArtStudioPayload(payload) {
    const source = payload && typeof payload === 'object' ? payload : {};
    return {
        achievements: Array.isArray(source.achievements) ? source.achievements.map((item) => ({ ...item })) : [],
        artCatalog: Array.isArray(source.artCatalog) ? source.artCatalog.map((item) => ({ ...item })) : [],
    };
}

function setBadgeArtStudioPayload(payload) {
    badgeArtStudioPersistedData = cloneBadgeArtStudioPayload(payload);
    badgeArtStudioData = cloneBadgeArtStudioPayload(payload);
}

function resetBadgeArtStudioDraft() {
    badgeArtStudioData = cloneBadgeArtStudioPayload(badgeArtStudioPersistedData);
}

function badgeArtStudioIsEditable() {
    return Boolean(badgeArtStudioCanEdit || isSuperFamily);
}

function resetBadgeArtStudioState() {
    badgeArtStudioCanEdit = false;
    badgeArtStudioHasLoaded = false;
    badgeArtStudioPersistedData = { achievements: [], artCatalog: [] };
    badgeArtStudioData = { achievements: [], artCatalog: [] };
    badgeArtSelectedKey = '';
    badgeArtStudioLoading = false;
    badgeArtStudioSaving = false;
}

function syncBadgeArtStudioModeCopy() {
    const canEdit = badgeArtStudioIsEditable();
    if (badgeArtStudioDialog) {
        badgeArtStudioDialog.classList.toggle('badge-art-studio-modal--readonly', !canEdit);
    }
    if (badgeArtStudioTitle) {
        badgeArtStudioTitle.textContent = canEdit ? 'Badge Studio' : 'Badges';
    }
    if (badgeArtStudioSubtitle) {
        badgeArtStudioSubtitle.textContent = canEdit
            ? 'Set badge art.'
            : 'Browse badges.';
    }
    if (badgeArtAchievementSectionTitle) {
        badgeArtAchievementSectionTitle.textContent = canEdit ? 'All' : 'Live';
    }
    if (badgeArtSelectionSectionTitle) {
        badgeArtSelectionSectionTitle.textContent = canEdit ? 'Emoji' : 'Preview';
    }
    if (badgeArtSelectionEmpty) {
        badgeArtSelectionEmpty.textContent = 'Pick a badge.';
    }
}

document.addEventListener('DOMContentLoaded', async () => {
    await loadFamilyRole();
    initializeTimezoneOptions();
    await loadTimezoneSettings();
    await loadRewardsStatus();
    renderBadgeArtStudioStatus();
    if (isSuperFamily) {
        loadBackupInfo();
        loadFamilyAccounts();
    }
});

passwordForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    await changePassword();
});

if (openChangePasswordBtn) {
    openChangePasswordBtn.addEventListener('click', () => {
        openChangePasswordDialog();
    });
}

if (closeChangePasswordBtn) {
    closeChangePasswordBtn.addEventListener('click', () => {
        closeChangePasswordDialog();
    });
}

if (changePasswordModal) {
    changePasswordModal.addEventListener('click', (event) => {
        if (event.target === changePasswordModal) {
            closeChangePasswordDialog();
        }
    });
}

if (familySettingsLogoutBtn) {
    familySettingsLogoutBtn.addEventListener('click', async () => {
        await logoutFamily();
    });
}

downloadBackupBtn.addEventListener('click', async () => {
    await downloadBackup();
});

restoreBackupBtn.addEventListener('click', async () => {
    if (!isSuperFamily) {
        showError('Only super family can restore backups.');
        return;
    }
    const password = await promptPasswordOnce(
        'restoring backup',
        'Warning: Restoring a backup will replace ALL app data for all families.'
    );
    if (!password) {
        return;
    }
    pendingRestorePassword = password;
    backupFileInput.click();
});

saveTimezoneBtn.addEventListener('click', async () => {
    await saveTimezoneSettings();
});

if (startRewardsBtn) {
    startRewardsBtn.addEventListener('click', async () => {
        await startRewardsTracking();
    });
}

if (resetRewardsBtn) {
    resetRewardsBtn.addEventListener('click', async () => {
        await resetRewardsTracking();
    });
}

if (badgeArtAchievementList) {
    badgeArtAchievementList.addEventListener('click', (event) => {
        const button = getClosestEventTarget(event, 'button[data-achievement-key][data-category-key]');
        if (!button) {
            return;
        }
        const achievementKey = String(button.getAttribute('data-achievement-key') || '').trim();
        const categoryKey = String(button.getAttribute('data-category-key') || '').trim();
        selectBadgeAchievement(achievementKey, categoryKey);
    });
}

if (badgeArtBankGrid) {
    badgeArtBankGrid.addEventListener('click', (event) => {
        const button = getClosestEventTarget(event, 'button[data-badge-art-id]');
        if (!button) {
            return;
        }
        const badgeArtId = Number.parseInt(button.getAttribute('data-badge-art-id') || '', 10);
        if (!Number.isInteger(badgeArtId) || badgeArtId < 0) {
            return;
        }
        assignBadgeArtToSelectedAchievement(badgeArtId);
    });
}

if (openBadgeArtStudioBtn) {
    openBadgeArtStudioBtn.addEventListener('click', async () => {
        await openBadgeArtStudio();
    });
}

if (badgeArtStudioSaveBtn) {
    badgeArtStudioSaveBtn.addEventListener('click', async () => {
        await saveBadgeArtStudioAssignments();
    });
}

if (badgeArtStudioNoticeOkBtn) {
    badgeArtStudioNoticeOkBtn.addEventListener('click', () => {
        closeBadgeArtStudioNoticeDialog();
    });
}

if (badgeArtStudioModal) {
    badgeArtStudioModal.addEventListener('click', (event) => {
        if (event.target === badgeArtStudioModal) {
            closeBadgeArtStudio({ discardDraft: true });
            return;
        }
        const closeBtn = getClosestEventTarget(event, '[data-badge-art-action="close"]');
        if (closeBtn) {
            closeBadgeArtStudio({ discardDraft: true });
        }
    });
}

if (badgeArtStudioNoticeModal) {
    badgeArtStudioNoticeModal.addEventListener('click', (event) => {
        if (event.target === badgeArtStudioNoticeModal) {
            closeBadgeArtStudioNoticeDialog();
        }
    });
}

document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && changePasswordModal && !changePasswordModal.classList.contains('hidden')) {
        closeChangePasswordDialog();
        return;
    }
    if (event.key === 'Escape' && badgeArtStudioNoticeModal && !badgeArtStudioNoticeModal.classList.contains('hidden')) {
        closeBadgeArtStudioNoticeDialog();
        return;
    }
    if (handleBadgeArtStudioArrowKey(event)) {
        return;
    }
    if (event.key === 'Escape' && badgeArtStudioModal && !badgeArtStudioModal.classList.contains('hidden')) {
        closeBadgeArtStudio({ discardDraft: true });
    }
});

function resetPasswordDialogState() {
    if (passwordForm) {
        passwordForm.reset();
    }
    showPasswordError('');
    showPasswordSuccess('');
}

function openChangePasswordDialog() {
    if (!changePasswordModal) {
        return;
    }
    resetPasswordDialogState();
    changePasswordModal.classList.remove('hidden');
    syncModalBodyLock();
    window.requestAnimationFrame(() => {
        if (currentPasswordInput) {
            currentPasswordInput.focus();
        }
    });
}

function closeChangePasswordDialog() {
    if (!changePasswordModal) {
        return;
    }
    changePasswordModal.classList.add('hidden');
    resetPasswordDialogState();
    syncModalBodyLock();
}

async function logoutFamily() {
    try {
        await fetch(`${API_BASE}/family-auth/logout`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({})
        });
    } catch (error) {
        // ignore
    }
    window.location.href = '/index.html';
}

backupFileInput.addEventListener('change', async (event) => {
    const file = event.target.files[0];
    if (!file) {
        pendingRestorePassword = null;
        return;
    }
    const password = pendingRestorePassword;
    pendingRestorePassword = null;
    if (!password) {
        showError('Password confirmation required.');
        backupFileInput.value = '';
        return;
    }
    await restoreBackup(file, password);
});

if (familyAccountsList) {
    familyAccountsList.addEventListener('click', async (event) => {
        const target = getClosestEventTarget(event, 'button[data-action="delete-family"][data-family-id]');
        if (!target) {
            return;
        }
        const familyId = String(target.getAttribute('data-family-id') || '').trim();
        const familyUsername = String(target.getAttribute('data-family-username') || '').trim();
        if (!familyId) {
            return;
        }
        await deleteFamilyAccount(familyId, familyUsername);
    });
}

function initializeTimezoneOptions() {
    if (!familyTimezoneSelect) {
        return;
    }

    const supported = typeof Intl.supportedValuesOf === 'function'
        ? Intl.supportedValuesOf('timeZone')
        : [];
    const options = supported.length > 0
        ? supported
        : COMMON_TIMEZONES;
    const unique = Array.from(new Set([DEFAULT_FAMILY_TIMEZONE, ...COMMON_TIMEZONES, ...options]));
    const list = unique.sort((a, b) => a.localeCompare(b));

    familyTimezoneSelect.innerHTML = list.map((tz) => `<option value="${tz}">${tz}</option>`).join('');
}

function parseApiTimestamp(value) {
    const text = String(value || '').trim();
    if (!text) {
        return null;
    }
    const normalized = /[zZ]$|[+-]\d{2}:\d{2}$/.test(text) ? text : `${text}Z`;
    const parsed = new Date(normalized);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function formatStartedAt(value, timeZone = DEFAULT_FAMILY_TIMEZONE) {
    const parsed = parseApiTimestamp(value);
    if (!parsed) {
        return String(value || '').trim();
    }
    try {
        return parsed.toLocaleString([], {
            timeZone: String(timeZone || DEFAULT_FAMILY_TIMEZONE),
            month: 'short',
            day: 'numeric',
            year: 'numeric',
            hour: 'numeric',
            minute: '2-digit',
            timeZoneName: 'short',
        });
    } catch (error) {
        console.error('Error formatting reward timestamp:', error);
    }
    const fallback = parseApiTimestamp(value);
    if (!fallback) {
        return String(value || '').trim();
    }
    return fallback.toLocaleString([], {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
    });
}

function syncRewardsButtonsState(activeAction = '') {
    const isStarting = activeAction === 'start';
    const isResetting = activeAction === 'reset';
    const isStatusReady = rewardsStatusState === 'ready';
    if (startRewardsBtn) {
        startRewardsBtn.disabled = !isStatusReady || rewardsTrackingStarted || isStarting || isResetting;
        startRewardsBtn.textContent = isStarting
            ? 'Starting...'
            : (rewardsTrackingStarted ? 'Started' : 'Start');
    }
    if (resetRewardsBtn) {
        resetRewardsBtn.disabled = !isStatusReady || !rewardsTrackingStarted || isStarting || isResetting;
        resetRewardsBtn.textContent = isResetting ? 'Resetting...' : 'Reset';
    }
}

function renderRewardsStatus() {
    if (rewardsStatusText) {
        if (rewardsStatusState === 'loading') {
            rewardsStatusText.textContent = 'Loading rewards...';
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

function badgeAssignmentKey(achievementKey, categoryKey = '') {
    return `${String(achievementKey || '').trim()}::${String(categoryKey || '').trim().toLowerCase()}`;
}

function getPersistedBadgeAchievement(achievementKey, categoryKey = '') {
    const achievements = Array.isArray(badgeArtStudioPersistedData.achievements)
        ? badgeArtStudioPersistedData.achievements
        : [];
    const targetKey = badgeAssignmentKey(achievementKey, categoryKey);
    return achievements.find((item) => badgeAssignmentKey(item.achievementKey, item.categoryKey) === targetKey) || null;
}

function getBadgeArtStudioDirtyAssignmentCount() {
    if (!badgeArtStudioIsEditable()) {
        return 0;
    }
    const draftAchievements = Array.isArray(badgeArtStudioData.achievements) ? badgeArtStudioData.achievements : [];
    return draftAchievements.reduce((count, item) => {
        const persistedItem = getPersistedBadgeAchievement(item.achievementKey, item.categoryKey);
        const draftBadgeArtId = Number(item && item.currentBadgeArtId || 0);
        const persistedBadgeArtId = Number(persistedItem && persistedItem.currentBadgeArtId || 0);
        return draftBadgeArtId !== persistedBadgeArtId ? count + 1 : count;
    }, 0);
}

function hasBadgeArtStudioUnsavedChanges() {
    return getBadgeArtStudioDirtyAssignmentCount() > 0;
}

function findBadgeArtCatalogItemById(badgeArtId) {
    const normalizedBadgeArtId = Number(badgeArtId || 0);
    const artCatalog = Array.isArray(badgeArtStudioData.artCatalog) ? badgeArtStudioData.artCatalog : [];
    return artCatalog.find((item) => Number(item && item.badgeArtId || 0) === normalizedBadgeArtId) || null;
}

function findBadgeArtCatalogItemByIdentityKey(identityKey) {
    const normalizedIdentityKey = String(identityKey || '').trim().toLowerCase();
    if (!normalizedIdentityKey) {
        return null;
    }
    const artCatalog = Array.isArray(badgeArtStudioData.artCatalog) ? badgeArtStudioData.artCatalog : [];
    return artCatalog.find((item) => getBadgeArtIdentityKey(item) === normalizedIdentityKey) || null;
}

function getBadgeArtIdentityKey(item) {
    if (!item || typeof item !== 'object') {
        return '';
    }
    const imagePath = String(item.imagePath || item.currentImagePath || '').trim();
    return badgeArtIdentityKeyFromPath(imagePath);
}

function getBadgeArtStudioPreloadCandidates() {
    const artCatalog = Array.isArray(badgeArtStudioData.artCatalog) ? badgeArtStudioData.artCatalog : [];
    return artCatalog.filter((item) => {
        const identityKey = getBadgeArtIdentityKey(item);
        const imageUrl = resolveBadgeArtImageUrl(item, { preferObjectUrl: false });
        return Boolean(identityKey && imageUrl && !badgeArtStudioObjectUrlByIdentityKey.has(identityKey));
    });
}

async function preloadBadgeArtStudioAssets() {
    if (badgeArtStudioAssetPreloadPromise) {
        return badgeArtStudioAssetPreloadPromise;
    }
    const candidates = getBadgeArtStudioPreloadCandidates();
    if (candidates.length <= 0) {
        return;
    }
    badgeArtStudioAssetPreloadPromise = Promise.all(candidates.map(async (item) => {
        const identityKey = getBadgeArtIdentityKey(item);
        const imageUrl = resolveBadgeArtImageUrl(item, { preferObjectUrl: false });
        if (!identityKey || !imageUrl || badgeArtStudioObjectUrlByIdentityKey.has(identityKey)) {
            return;
        }
        try {
            const response = await fetch(imageUrl);
            if (!response.ok) {
                return;
            }
            const blob = await response.blob();
            badgeArtStudioObjectUrlByIdentityKey.set(identityKey, URL.createObjectURL(blob));
        } catch (error) {
            console.warn('Failed to preload badge art asset:', imageUrl, error);
        }
    })).finally(() => {
        badgeArtStudioAssetPreloadPromise = null;
    });
    return badgeArtStudioAssetPreloadPromise;
}

function resolveActiveNotoBadgeArtId(item) {
    if (!item || typeof item !== 'object') {
        return 0;
    }
    const currentBadgeArtId = Number(item.currentBadgeArtId || 0);
    if (currentBadgeArtId > 0) {
        const directMatch = findBadgeArtCatalogItemById(currentBadgeArtId);
        if (directMatch) {
            return currentBadgeArtId;
        }
    }
    const identityKey = getBadgeArtIdentityKey(item);
    if (!identityKey) {
        return 0;
    }
    const matchedItem = findBadgeArtCatalogItemByIdentityKey(identityKey);
    return Number(matchedItem && matchedItem.badgeArtId || 0);
}

function setDraftBadgeArtAssignment(item, badgeArtId) {
    if (!item) {
        return;
    }
    const normalizedBadgeArtId = Number(badgeArtId || 0);
    if (!Number.isInteger(normalizedBadgeArtId) || normalizedBadgeArtId <= 0) {
        item.currentBadgeArtId = 0;
        item.currentImagePath = '';
        item.currentImageUrl = '';
        item.currentImageLabel = '';
        item.currentBadgeSourceUrl = '';
        item.currentBadgeLicense = '';
        item.currentBadgeIsActive = false;
        return;
    }
    const artItem = findBadgeArtCatalogItemById(normalizedBadgeArtId);
    if (!artItem) {
        return;
    }
    item.currentBadgeArtId = normalizedBadgeArtId;
    item.currentImagePath = String(artItem.imagePath || '');
    item.currentImageUrl = String(artItem.imageUrl || '');
    item.currentImageLabel = String(artItem.label || '');
    item.currentBadgeSourceUrl = String(artItem.sourceUrl || '');
    item.currentBadgeLicense = String(artItem.license || '');
    item.currentBadgeIsActive = true;
}

function normalizeSearchText(value) {
    return String(value || '').trim().toLowerCase();
}

function getBadgePaletteKey(item) {
    return String(item && item.paletteKey ? item.paletteKey : '').trim().toLowerCase() || 'global';
}

function resolveBadgeArtImageUrl(item, options = {}) {
    const preferObjectUrl = options.preferObjectUrl !== false;
    if (preferObjectUrl) {
        const identityKey = getBadgeArtIdentityKey(item);
        const cachedObjectUrl = identityKey ? badgeArtStudioObjectUrlByIdentityKey.get(identityKey) : '';
        if (cachedObjectUrl) {
            return cachedObjectUrl;
        }
    }
    const imageUrl = String(item && item.imageUrl ? item.imageUrl : item && item.currentImageUrl ? item.currentImageUrl : '').trim();
    if (imageUrl) {
        return imageUrl;
    }
    const imagePath = String(item && item.imagePath ? item.imagePath : item && item.currentImagePath ? item.currentImagePath : '').trim();
    if (!imagePath) {
        return '';
    }
    return `/${imagePath.replace(/^\/+/, '')}`;
}

function renderBadgeArtPreview(item, altText) {
    const imageUrl = resolveBadgeArtImageUrl(item);
    if (!imageUrl) {
        return '';
    }
    return `<img src="${escapeHtml(imageUrl)}" alt="${escapeHtml(altText || 'Badge art')}" loading="lazy" decoding="async">`;
}

function buildBadgeAchievementCardTitle(item) {
    const earnedKidCount = Number(item && item.earnedKidCount || 0);
    return [
        item.title || 'Badge',
        item.goalText || '',
        earnedKidCount > 0
            ? `Already earned by ${earnedKidCount} kid${earnedKidCount === 1 ? '' : 's'}`
            : '',
        item.currentImageLabel ? `Current art: ${item.currentImageLabel}` : 'Current art: Unassigned',
    ].filter(Boolean).join('\n');
}

function buildBadgeAchievementCardInnerMarkup(item) {
    const paletteKey = getBadgePaletteKey(item);
    return `
        <div class="badge-art-preview badge-art-grid-preview badge-art-palette-${escapeHtml(paletteKey)}">
            ${renderBadgeArtPreview(item, `${item.title} current art`)}
        </div>
    `;
}

function renderBadgeArtStudioStatus() {
    syncBadgeArtStudioModeCopy();
    syncBadgeArtStudioControls();
}

function getFilteredBadgeAchievements() {
    const achievements = Array.isArray(badgeArtStudioData.achievements) ? badgeArtStudioData.achievements : [];
    return achievements;
}

function getSelectedBadgeAchievement() {
    const achievements = Array.isArray(badgeArtStudioData.achievements) ? badgeArtStudioData.achievements : [];
    if (!badgeArtSelectedKey) {
        return null;
    }
    return achievements.find((item) => badgeAssignmentKey(item.achievementKey, item.categoryKey) === badgeArtSelectedKey) || null;
}

function renderBadgeArtStudioCounts() {
    const achievements = Array.isArray(badgeArtStudioData.achievements) ? badgeArtStudioData.achievements : [];
    const activeCount = achievements.filter((item) => (
        Number(item && item.currentBadgeArtId || 0) > 0
        && Boolean(item && item.currentBadgeIsActive)
    )).length;
    const inactiveCount = Math.max(0, achievements.length - activeCount);
    if (badgeAchievementCount) {
        badgeAchievementCount.textContent = `${activeCount} active badge${activeCount === 1 ? '' : 's'}`;
    }
    if (badgeArtBankCount) {
        badgeArtBankCount.textContent = `${inactiveCount} inactive badge${inactiveCount === 1 ? '' : 's'}`;
    }
}

function getUsedBadgeArtIds(excludedMappingKey = '') {
    const achievements = Array.isArray(badgeArtStudioData.achievements) ? badgeArtStudioData.achievements : [];
    const used = new Set();
    achievements.forEach((item) => {
        const mappingKey = badgeAssignmentKey(item.achievementKey, item.categoryKey);
        const badgeArtId = Number(item.currentBadgeArtId || 0);
        if (mappingKey === excludedMappingKey || !Number.isInteger(badgeArtId) || badgeArtId <= 0) {
            return;
        }
        used.add(badgeArtId);
    });
    return used;
}

function getUsedBadgeArtIdentityKeys(excludedMappingKey = '') {
    const achievements = Array.isArray(badgeArtStudioData.achievements) ? badgeArtStudioData.achievements : [];
    const used = new Set();
    achievements.forEach((item) => {
        const mappingKey = badgeAssignmentKey(item.achievementKey, item.categoryKey);
        if (mappingKey === excludedMappingKey) {
            return;
        }
        const identityKey = getBadgeArtIdentityKey(item);
        if (identityKey) {
            used.add(identityKey);
        }
    });
    return used;
}

function getFilteredBadgeArtCatalog() {
    if (!badgeArtStudioIsEditable()) {
        return [];
    }
    const selected = getSelectedBadgeAchievement();
    if (!selected) {
        return [];
    }
    const artCatalog = Array.isArray(badgeArtStudioData.artCatalog) ? badgeArtStudioData.artCatalog : [];
    const mappingKey = badgeAssignmentKey(selected.achievementKey, selected.categoryKey);
    const usedByOthers = getUsedBadgeArtIds(mappingKey);
    const usedIdentityKeysByOthers = getUsedBadgeArtIdentityKeys(mappingKey);
    const currentBadgeArtId = Number(selected.currentBadgeArtId || 0);
    const currentIdentityKey = getBadgeArtIdentityKey(selected);
    return artCatalog
        .filter((item) => {
            const badgeArtId = Number(item.badgeArtId || 0);
            const identityKey = getBadgeArtIdentityKey(item);
            const isEquivalentToCurrent = Boolean(identityKey) && identityKey === currentIdentityKey;
            if (badgeArtId > 0 && usedByOthers.has(badgeArtId) && badgeArtId !== currentBadgeArtId) {
                return false;
            }
            if (identityKey && usedIdentityKeysByOthers.has(identityKey) && !isEquivalentToCurrent) {
                return false;
            }
            return true;
        })
        .sort((a, b) => String(a.label || '').localeCompare(String(b.label || '')));
}

function syncBadgeArtStudioControls() {
    const canEdit = badgeArtStudioIsEditable();
    const isSaving = badgeArtStudioSaving;
    const dirtyCount = getBadgeArtStudioDirtyAssignmentCount();
    if (openBadgeArtStudioBtn) {
        openBadgeArtStudioBtn.disabled = isSaving || badgeArtStudioLoading;
        openBadgeArtStudioBtn.textContent = badgeArtStudioLoading
            ? 'Loading...'
            : (canEdit ? '🏅 Badge Studio' : '🏅 View Badges');
    }
    if (badgeArtStudioSaveBtn) {
        badgeArtStudioSaveBtn.classList.toggle('hidden', !canEdit);
        badgeArtStudioSaveBtn.disabled = badgeArtStudioLoading || isSaving || dirtyCount <= 0;
        badgeArtStudioSaveBtn.textContent = isSaving
            ? 'Saving...'
            : (dirtyCount > 0
                ? `Save ${dirtyCount} Change${dirtyCount === 1 ? '' : 's'}`
                : 'Save');
    }
}

function findBadgeAchievementCardElement(mappingKey) {
    if (!badgeArtAchievementList || !mappingKey) {
        return null;
    }
    return Array.from(badgeArtAchievementList.querySelectorAll('button[data-assignment-key]'))
        .find((button) => String(button.getAttribute('data-assignment-key') || '') === mappingKey) || null;
}

function updateBadgeAchievementCardElement(item) {
    if (!item) {
        return;
    }
    const mappingKey = badgeAssignmentKey(item.achievementKey, item.categoryKey);
    const button = findBadgeAchievementCardElement(mappingKey);
    if (!button) {
        return;
    }
    const paletteKey = getBadgePaletteKey(item);
    const isSelected = mappingKey === badgeArtSelectedKey;
    const isEarned = Number(item.earnedKidCount || 0) > 0;
    button.className = `badge-art-achievement-card badge-art-palette-${paletteKey}${isEarned ? ' badge-art-earned' : ''}${isSelected ? ' selected' : ''}`;
    button.setAttribute('aria-pressed', isSelected ? 'true' : 'false');
    button.setAttribute('aria-label', String(item.title || 'Badge'));
    button.setAttribute('title', buildBadgeAchievementCardTitle(item));
    button.innerHTML = buildBadgeAchievementCardInnerMarkup(item);
}

function updateBadgeAchievementSelectionState(previousKey, nextKey) {
    if (previousKey === nextKey) {
        return;
    }
    const previousButton = findBadgeAchievementCardElement(previousKey);
    if (previousButton) {
        previousButton.classList.remove('selected');
        previousButton.setAttribute('aria-pressed', 'false');
    }
    const nextButton = findBadgeAchievementCardElement(nextKey);
    if (nextButton) {
        nextButton.classList.add('selected');
        nextButton.setAttribute('aria-pressed', 'true');
    }
}

function findBadgeArtTileElement(badgeArtId) {
    if (!badgeArtBankGrid || !Number.isInteger(Number(badgeArtId)) || Number(badgeArtId) < 0) {
        return null;
    }
    return badgeArtBankGrid.querySelector(`button[data-badge-art-id="${Number(badgeArtId)}"]`);
}

function updateBadgeArtBankSelectionState(previousBadgeArtId, nextBadgeArtId) {
    const previousTile = findBadgeArtTileElement(previousBadgeArtId);
    if (previousTile) {
        previousTile.classList.remove('selected');
        previousTile.setAttribute('aria-pressed', 'false');
    }
    const nextTile = findBadgeArtTileElement(nextBadgeArtId);
    if (nextTile) {
        nextTile.classList.add('selected');
        nextTile.setAttribute('aria-pressed', 'true');
    }
}

function getBadgeAchievementButtons() {
    if (!badgeArtAchievementList) {
        return [];
    }
    return Array.from(badgeArtAchievementList.querySelectorAll('button[data-achievement-key][data-category-key]'));
}

function getBadgeArtBankButtons() {
    if (!badgeArtBankGrid) {
        return [];
    }
    return Array.from(badgeArtBankGrid.querySelectorAll('button[data-badge-art-id]'));
}

function moveBadgeAchievementSelectionBy(delta) {
    const buttons = getBadgeAchievementButtons();
    if (buttons.length <= 0) {
        return false;
    }
    const activeButton = document.activeElement instanceof HTMLElement
        ? document.activeElement.closest('#badgeArtAchievementList button[data-achievement-key][data-category-key]')
        : null;
    let currentIndex = buttons.findIndex((button) => button === activeButton);
    if (currentIndex < 0) {
        currentIndex = buttons.findIndex((button) => button.classList.contains('selected'));
    }
    if (currentIndex < 0) {
        currentIndex = 0;
    }
    const nextIndex = Math.max(0, Math.min(buttons.length - 1, currentIndex + delta));
    if (nextIndex === currentIndex) {
        buttons[nextIndex].focus();
        return true;
    }
    const targetButton = buttons[nextIndex];
    selectBadgeAchievement(
        String(targetButton.getAttribute('data-achievement-key') || '').trim(),
        String(targetButton.getAttribute('data-category-key') || '').trim()
    );
    targetButton.focus();
    return true;
}

function moveBadgeArtBankSelectionBy(delta) {
    const buttons = getBadgeArtBankButtons();
    if (buttons.length <= 0) {
        return false;
    }
    const activeButton = document.activeElement instanceof HTMLElement
        ? document.activeElement.closest('#badgeArtBankGrid button[data-badge-art-id]')
        : null;
    let currentIndex = buttons.findIndex((button) => button === activeButton);
    if (currentIndex < 0) {
        currentIndex = buttons.findIndex((button) => button.classList.contains('selected'));
    }
    if (currentIndex < 0) {
        currentIndex = 0;
    }
    const nextIndex = Math.max(0, Math.min(buttons.length - 1, currentIndex + delta));
    const targetButton = buttons[nextIndex];
    if (nextIndex === currentIndex) {
        targetButton.focus();
        return true;
    }
    const badgeArtId = Number.parseInt(targetButton.getAttribute('data-badge-art-id') || '', 10);
    if (!Number.isInteger(badgeArtId) || badgeArtId < 0) {
        return false;
    }
    assignBadgeArtToSelectedAchievement(badgeArtId);
    targetButton.focus();
    return true;
}

function handleBadgeArtStudioArrowKey(event) {
    if (!badgeArtStudioModal || badgeArtStudioModal.classList.contains('hidden')) {
        return false;
    }
    if (badgeArtStudioNoticeModal && !badgeArtStudioNoticeModal.classList.contains('hidden')) {
        return false;
    }
    if (badgeArtStudioSaving || badgeArtStudioLoading) {
        return false;
    }
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) {
        return false;
    }
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') {
        return false;
    }
    if (window.innerWidth <= 640) {
        return false;
    }
    const activeElement = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const activeInsideModal = Boolean(activeElement && badgeArtStudioModal.contains(activeElement));
    const activeInsideBank = Boolean(activeElement && activeElement.closest('#badgeArtBankGrid'));
    const activeInsideTopGrid = Boolean(activeElement && activeElement.closest('#badgeArtAchievementList'));
    if (activeElement && activeInsideModal) {
        const tagName = activeElement.tagName;
        if ((tagName === 'INPUT' || tagName === 'TEXTAREA' || tagName === 'SELECT') && !activeInsideBank && !activeInsideTopGrid) {
            return false;
        }
    }
    const delta = event.key === 'ArrowRight' ? 1 : -1;
    let handled = false;
    if (activeInsideBank) {
        handled = moveBadgeArtBankSelectionBy(delta);
    } else if (activeInsideTopGrid || !activeInsideModal || activeElement === document.body || activeElement === null) {
        handled = moveBadgeAchievementSelectionBy(delta);
    }
    if (handled) {
        event.preventDefault();
        event.stopPropagation();
    }
    return handled;
}

function renderBadgeAchievementList() {
    if (!badgeArtAchievementList) {
        return;
    }
    const achievements = getFilteredBadgeAchievements();
    if (achievements.length <= 0) {
        badgeArtAchievementList.innerHTML = '<div class="settings-note">No achievements available.</div>';
        return;
    }
    badgeArtAchievementList.innerHTML = achievements.map((item) => {
        const key = badgeAssignmentKey(item.achievementKey, item.categoryKey);
        const isSelected = key === badgeArtSelectedKey;
        const paletteKey = getBadgePaletteKey(item);
        const isEarned = Number(item.earnedKidCount || 0) > 0;
        return `
            <button
                type="button"
                class="badge-art-achievement-card badge-art-palette-${escapeHtml(paletteKey)}${isEarned ? ' badge-art-earned' : ''}${isSelected ? ' selected' : ''}"
                data-assignment-key="${escapeHtml(key)}"
                data-achievement-key="${escapeHtml(item.achievementKey)}"
                data-category-key="${escapeHtml(item.categoryKey)}"
                aria-pressed="${isSelected ? 'true' : 'false'}"
                aria-label="${escapeHtml(item.title || 'Badge')}"
                title="${escapeHtml(buildBadgeAchievementCardTitle(item))}"
            >
                ${buildBadgeAchievementCardInnerMarkup(item)}
            </button>
        `;
    }).join('');
}

function renderSelectedBadgeAchievement() {
    const selected = getSelectedBadgeAchievement();
    if (!badgeArtSelectionEmpty || !badgeArtSelectionPanel) {
        return;
    }
    if (!selected) {
        badgeArtSelectionEmpty.classList.remove('hidden');
        badgeArtSelectionPanel.classList.add('hidden');
        badgeArtSelectedPreview.className = 'badge-art-preview';
        badgeArtSelectedPreview.innerHTML = '';
        badgeArtSelectedTitle.textContent = '';
        if (badgeArtSelectedMeta) {
            badgeArtSelectedMeta.textContent = '';
        }
        if (badgeArtSelectedCurrent) {
            badgeArtSelectedCurrent.textContent = '';
        }
        return;
    }
    badgeArtSelectionEmpty.classList.add('hidden');
    badgeArtSelectionPanel.classList.remove('hidden');
    const paletteKey = getBadgePaletteKey(selected);
    badgeArtSelectedPreview.className = `badge-art-preview badge-art-palette-${paletteKey}`;
    badgeArtSelectedPreview.innerHTML = renderBadgeArtPreview(selected, `${selected.title} current art`);
    badgeArtSelectedTitle.textContent = String(selected.title || 'Badge');
    if (badgeArtSelectedMeta) {
        badgeArtSelectedMeta.textContent = String(selected.goalText || selected.reasonText || '').trim();
    }
    if (badgeArtSelectedCurrent) {
        badgeArtSelectedCurrent.textContent = '';
    }
}

function renderBadgeArtBank(options = {}) {
    if (!badgeArtBankGrid) {
        return;
    }
    const canEdit = badgeArtStudioIsEditable();
    const preserveScroll = Boolean(options.preserveScroll);
    const previousScrollTop = preserveScroll ? badgeArtBankGrid.scrollTop : 0;
    const selected = getSelectedBadgeAchievement();
    badgeArtBankGrid.classList.remove('hidden');
    if (!selected) {
        badgeArtBankGrid.innerHTML = '';
        return;
    }
    if (!canEdit) {
        badgeArtBankGrid.innerHTML = '';
        badgeArtBankGrid.classList.add('hidden');
        return;
    }
    const artCatalog = Array.isArray(badgeArtStudioData.artCatalog) ? badgeArtStudioData.artCatalog : [];
    const mappingKey = badgeAssignmentKey(selected.achievementKey, selected.categoryKey);
    const usedByOthers = getUsedBadgeArtIds(mappingKey);
    const usedIdentityKeysByOthers = getUsedBadgeArtIdentityKeys(mappingKey);
    const currentBadgeArtId = Number(selected.currentBadgeArtId || 0);
    const highlightedBadgeArtId = resolveActiveNotoBadgeArtId(selected);
    const currentIdentityKey = getBadgeArtIdentityKey(selected);
    const items = getFilteredBadgeArtCatalog();
    if (items.length <= 0) {
        const isDeactivated = highlightedBadgeArtId <= 0;
        badgeArtBankGrid.innerHTML = `
            <button
                type="button"
                class="badge-art-tile badge-art-empty-tile ${isDeactivated ? 'selected' : ''}"
                data-badge-art-id="0"
                aria-label="Deactivate badge art"
                aria-pressed="${isDeactivated ? 'true' : 'false'}"
                title="Deactivate badge art"
                ${badgeArtStudioSaving ? 'disabled' : ''}
            >
                <span class="badge-art-preview badge-art-grid-preview badge-art-empty-preview">
                    <span class="badge-art-empty-icon" aria-hidden="true"></span>
                </span>
            </button>
        `;
        return;
    }
    const isDeactivated = highlightedBadgeArtId <= 0;
    const deactivateTileMarkup = `
        <button
            type="button"
            class="badge-art-tile badge-art-empty-tile ${isDeactivated ? 'selected' : ''}"
            data-badge-art-id="0"
            aria-label="Deactivate badge art"
            aria-pressed="${isDeactivated ? 'true' : 'false'}"
            title="Deactivate badge art"
            ${badgeArtStudioSaving ? 'disabled' : ''}
        >
            <span class="badge-art-preview badge-art-grid-preview badge-art-empty-preview">
                <span class="badge-art-empty-icon" aria-hidden="true"></span>
            </span>
        </button>
    `;
    badgeArtBankGrid.innerHTML = deactivateTileMarkup + items.map((item) => {
        const badgeArtId = Number(item.badgeArtId || 0);
        const isCurrent = badgeArtId > 0 && badgeArtId === highlightedBadgeArtId;
        return `
            <button
                type="button"
                class="badge-art-tile ${isCurrent ? 'selected' : ''}"
                data-badge-art-id="${badgeArtId}"
                aria-label="${escapeHtml(item.label || 'Noto badge art')}"
                aria-pressed="${isCurrent ? 'true' : 'false'}"
                title="${escapeHtml(item.label || '')}"
                ${badgeArtStudioSaving ? 'disabled' : ''}
            >
                <span class="badge-art-preview badge-art-grid-preview">
                    ${renderBadgeArtPreview(item, item.label || 'Noto badge art')}
                </span>
            </button>
        `;
    }).join('');
    if (preserveScroll) {
        const maxScrollTop = Math.max(0, badgeArtBankGrid.scrollHeight - badgeArtBankGrid.clientHeight);
        badgeArtBankGrid.scrollTop = Math.min(previousScrollTop, maxScrollTop);
    }
}

function renderBadgeArtStudio() {
    renderBadgeArtStudioStatus();
    renderBadgeArtStudioCounts();
    renderBadgeAchievementList();
    renderSelectedBadgeAchievement();
    renderBadgeArtBank();
}

function selectBadgeAchievement(achievementKey, categoryKey) {
    const nextKey = badgeAssignmentKey(achievementKey, categoryKey);
    if (!nextKey || badgeArtSelectedKey === nextKey) {
        return;
    }
    const previousKey = badgeArtSelectedKey;
    badgeArtSelectedKey = nextKey;
    showBadgeArtStudioSuccess('');
    updateBadgeAchievementSelectionState(previousKey, nextKey);
    renderSelectedBadgeAchievement();
    renderBadgeArtBank();
}

async function loadBadgeArtStudio() {
    if (!badgeArtStudioModal) {
        return;
    }
    try {
        badgeArtStudioLoading = true;
        renderBadgeArtStudioStatus();
        showBadgeArtStudioError('');
        showBadgeArtStudioSuccess('');
        syncBadgeArtStudioControls();
        const response = await fetch(`${API_BASE}/parent-settings/rewards/badge-art`);
        const result = await response.json().catch(() => ({}));
        if (!response.ok) {
            throw new Error(result.error || `HTTP ${response.status}`);
        }
        badgeArtStudioCanEdit = Boolean(result.canEdit);
        badgeArtStudioHasLoaded = true;
        setBadgeArtStudioPayload({
            achievements: Array.isArray(result.achievements) ? result.achievements : [],
            artCatalog: Array.isArray(result.artCatalog) ? result.artCatalog : [],
        });
        void preloadBadgeArtStudioAssets();
        const selectedStillExists = badgeArtStudioData.achievements.some(
            (item) => badgeAssignmentKey(item.achievementKey, item.categoryKey) === badgeArtSelectedKey
        );
        if (!selectedStillExists) {
            const firstAchievement = badgeArtStudioData.achievements[0];
            badgeArtSelectedKey = firstAchievement
                ? badgeAssignmentKey(firstAchievement.achievementKey, firstAchievement.categoryKey)
                : '';
        }
        renderBadgeArtStudio();
    } catch (error) {
        console.error('Error loading badge art studio:', error);
        badgeArtStudioHasLoaded = false;
        if (badgeArtStudioModal && !badgeArtStudioModal.classList.contains('hidden')) {
            showBadgeArtStudioError(
                badgeArtStudioIsEditable()
                    ? 'Failed to load the Noto badge bank.'
                    : 'Failed to load active reward achievements.'
            );
        }
    } finally {
        badgeArtStudioLoading = false;
        renderBadgeArtStudioStatus();
    }
}

function assignBadgeArtToSelectedAchievement(badgeArtId) {
    const selected = getSelectedBadgeAchievement();
    if (!badgeArtStudioIsEditable() || badgeArtStudioLoading || badgeArtStudioSaving || !selected || !Number.isInteger(Number(badgeArtId)) || Number(badgeArtId) < 0) {
        return;
    }
    if (Number(badgeArtId) > 0) {
        const artItem = findBadgeArtCatalogItemById(badgeArtId);
        if (!artItem) {
            showBadgeArtStudioError('Selected art is no longer available.');
            return;
        }
    }
    showBadgeArtStudioError('');
    showBadgeArtStudioSuccess('');
    const mappingKey = badgeAssignmentKey(selected.achievementKey, selected.categoryKey);
    const draftItem = badgeArtStudioData.achievements.find(
        (item) => badgeAssignmentKey(item.achievementKey, item.categoryKey) === mappingKey
    );
    if (!draftItem) {
        return;
    }
    const previousBadgeArtId = resolveActiveNotoBadgeArtId(draftItem);
    setDraftBadgeArtAssignment(draftItem, badgeArtId);
    const nextBadgeArtId = resolveActiveNotoBadgeArtId(draftItem);
    renderBadgeArtStudioStatus();
    renderBadgeArtStudioCounts();
    updateBadgeAchievementCardElement(draftItem);
    renderSelectedBadgeAchievement();
    updateBadgeArtBankSelectionState(previousBadgeArtId, nextBadgeArtId);
}

function buildBadgeArtStudioSaveAssignments() {
    const achievements = Array.isArray(badgeArtStudioData.achievements) ? badgeArtStudioData.achievements : [];
    const assignments = [];
    const unresolved = [];
    achievements.forEach((item) => {
        const currentBadgeArtId = Number(item && item.currentBadgeArtId || 0);
        if (currentBadgeArtId <= 0) {
            return;
        }
        const resolvedBadgeArtId = resolveActiveNotoBadgeArtId(item);
        if (resolvedBadgeArtId <= 0) {
            unresolved.push(String(item.title || item.achievementKey || 'Badge').trim() || 'Badge');
            return;
        }
        assignments.push({
            achievementKey: String(item.achievementKey || '').trim(),
            categoryKey: String(item.categoryKey || '').trim(),
            badgeArtId: resolvedBadgeArtId,
        });
    });
    return { assignments, unresolved };
}

async function requestBadgeArtStudioJson(url, options = {}) {
    const response = await fetch(url, options);
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
        throw new Error(result.error || `HTTP ${response.status}`);
    }
    return result;
}

async function saveBadgeArtStudioAssignmentsBulk(savePayload) {
    return requestBadgeArtStudioJson(`${API_BASE}/parent-settings/rewards/badge-art/bulk`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            assignments: savePayload.assignments,
        }),
    });
}

async function saveBadgeArtStudioAssignments() {
    if (!badgeArtStudioIsEditable() || badgeArtStudioLoading || badgeArtStudioSaving) {
        return;
    }
    const dirtyCount = getBadgeArtStudioDirtyAssignmentCount();
    if (dirtyCount <= 0) {
        return;
    }
    const savePayload = buildBadgeArtStudioSaveAssignments();
    if (savePayload.unresolved.length > 0) {
        showBadgeArtStudioError(
            `Some selected art cannot be saved yet: ${savePayload.unresolved.slice(0, 3).join(', ')}${savePayload.unresolved.length > 3 ? ', ...' : ''}.`
        );
        return;
    }
    badgeArtStudioSaving = true;
    showBadgeArtStudioError('');
    showBadgeArtStudioSuccess('');
    syncBadgeArtStudioControls();
    renderBadgeArtBank();
    try {
        const result = await saveBadgeArtStudioAssignmentsBulk(savePayload);
        setBadgeArtStudioPayload({
            achievements: Array.isArray(result.achievements) ? result.achievements : [],
            artCatalog: Array.isArray(result.artCatalog) ? result.artCatalog : [],
        });
        await preloadBadgeArtStudioAssets();
        const selectedStillExists = badgeArtStudioData.achievements.some(
            (item) => badgeAssignmentKey(item.achievementKey, item.categoryKey) === badgeArtSelectedKey
        );
        if (!selectedStillExists) {
            badgeArtSelectedKey = '';
        }
        const savedCount = Number.isFinite(Number(result.savedAssignmentCount))
            ? Number(result.savedAssignmentCount)
            : savePayload.assignments.length;
        showBadgeArtStudioSuccess(`Saved ${dirtyCount} change${dirtyCount === 1 ? '' : 's'}. ${savedCount} badge${savedCount === 1 ? '' : 's'} assigned.`);
        renderBadgeArtStudio();
    } catch (error) {
        console.error('Error saving badge art assignments:', error);
        showBadgeArtStudioError(error.message || 'Failed to save badge art.');
        renderBadgeArtStudio();
    } finally {
        badgeArtStudioSaving = false;
        syncBadgeArtStudioControls();
        renderBadgeArtBank();
    }
}

async function openBadgeArtStudio() {
    if (!badgeArtStudioModal) {
        return;
    }
    badgeArtStudioModal.classList.remove('hidden');
    syncModalBodyLock();
    syncBadgeArtStudioModeCopy();
    if (!badgeArtStudioHasLoaded) {
        await loadBadgeArtStudio();
    }
    await preloadBadgeArtStudioAssets();
    renderBadgeArtStudio();
    showBadgeArtStudioError('');
}

function closeBadgeArtStudio(options = {}) {
    if (!badgeArtStudioModal) {
        return false;
    }
    const shouldDiscardDraft = Boolean(options.discardDraft);
    if (hasBadgeArtStudioUnsavedChanges() && shouldDiscardDraft) {
        const confirmed = options.force === true || window.confirm(
            'Discard unsaved badge art changes? Your draft selections will be lost.'
        );
        if (!confirmed) {
            return false;
        }
        resetBadgeArtStudioDraft();
        showBadgeArtStudioError('');
        showBadgeArtStudioSuccess('');
        renderBadgeArtStudio();
    }
    badgeArtStudioModal.classList.add('hidden');
    syncModalBodyLock();
    return true;
}

function closeBadgeArtStudioNoticeDialog() {
    if (!badgeArtStudioNoticeModal || badgeArtStudioNoticeModal.classList.contains('hidden')) {
        return;
    }
    badgeArtStudioNoticeModal.classList.add('hidden');
    syncModalBodyLock();
    const resolve = badgeArtStudioNoticeResolver;
    badgeArtStudioNoticeResolver = null;
    if (typeof resolve === 'function') {
        resolve();
    }
}

function showBadgeArtStudioNoticeDialog(message, title = 'Badge Art Studio') {
    const text = String(message || '').trim();
    if (!text) {
        return Promise.resolve();
    }
    if (!badgeArtStudioNoticeModal || !badgeArtStudioNoticeTitle || !badgeArtStudioNoticeText || !badgeArtStudioNoticeOkBtn) {
        window.alert(text);
        return Promise.resolve();
    }
    if (!badgeArtStudioNoticeModal.classList.contains('hidden')) {
        closeBadgeArtStudioNoticeDialog();
    }
    badgeArtStudioNoticeTitle.textContent = String(title || 'Badge Art Studio').trim() || 'Badge Art Studio';
    badgeArtStudioNoticeText.textContent = text;
    badgeArtStudioNoticeModal.classList.remove('hidden');
    syncModalBodyLock();
    badgeArtStudioNoticeOkBtn.focus();
    return new Promise((resolve) => {
        badgeArtStudioNoticeResolver = resolve;
    });
}

function showBadgeArtStudioError(message) {
    const text = String(message || '').trim();
    if (!text) {
        return Promise.resolve();
    }
    return showBadgeArtStudioNoticeDialog(text, 'Badge Art Studio');
}

function showBadgeArtStudioSuccess(message) {
    const text = String(message || '').trim();
    if (!text) {
        return Promise.resolve();
    }
    return showBadgeArtStudioNoticeDialog(text, 'Badge Art Studio');
}

async function loadTimezoneSettings() {
    try {
        showTimezoneError('');
        showTimezoneSuccess('');
        const response = await fetch(`${API_BASE}/parent-settings/timezone`);
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }
        const data = await response.json();
        const value = String(data.familyTimezone || DEFAULT_FAMILY_TIMEZONE);
        if (![...familyTimezoneSelect.options].some((opt) => opt.value === value)) {
            familyTimezoneSelect.insertAdjacentHTML('beforeend', `<option value="${value}">${value}</option>`);
        }
        familyTimezoneSelect.value = value;
    } catch (error) {
        console.error('Error loading timezone settings:', error);
        showTimezoneError('Failed to load family timezone.');
    }
}

async function saveTimezoneSettings() {
    try {
        showTimezoneError('');
        showTimezoneSuccess('');
        const timezoneName = String(familyTimezoneSelect.value || '').trim();
        if (!timezoneName) {
            showTimezoneError('Please select a timezone.');
            return;
        }

        saveTimezoneBtn.disabled = true;
        saveTimezoneBtn.textContent = 'Saving...';
        const response = await fetch(`${API_BASE}/parent-settings/timezone`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ familyTimezone: timezoneName })
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok) {
            showTimezoneError(result.error || 'Failed to save family timezone.');
            return;
        }

        familyTimezoneSelect.value = String(result.familyTimezone || timezoneName);
        rewardsFamilyTimezone = familyTimezoneSelect.value || DEFAULT_FAMILY_TIMEZONE;
        await loadRewardsStatus();
        showTimezoneSuccess('Family timezone saved.');
    } catch (error) {
        console.error('Error saving timezone settings:', error);
        showTimezoneError('Failed to save family timezone.');
    } finally {
        saveTimezoneBtn.disabled = false;
        saveTimezoneBtn.textContent = 'Save';
    }
}

async function changePassword() {
    const currentPassword = currentPasswordInput.value || '';
    const newPassword = newPasswordInput.value || '';
    const confirmPassword = confirmPasswordInput.value || '';

    showError('');
    showPasswordError('');
    showPasswordSuccess('');
    showSuccess('');

    if (!currentPassword || !newPassword || !confirmPassword) {
        showPasswordError('Please fill all password fields.');
        return;
    }
    if (newPassword !== confirmPassword) {
        showPasswordError('New passwords do not match.');
        return;
    }

    try {
        changePasswordBtn.disabled = true;
        changePasswordBtn.textContent = 'Updating...';

        const response = await fetch(`${API_BASE}/parent-auth/change-password`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                currentPassword,
                newPassword,
            }),
        });

        const result = await response.json().catch(() => ({}));

        if (!response.ok) {
            showPasswordError(result.error || 'Failed to change password.');
            return;
        }

        passwordForm.reset();
        showPasswordSuccess('Password updated successfully.');
    } catch (error) {
        console.error('Error changing password:', error);
        showPasswordError('Failed to change password. Please try again.');
    } finally {
        changePasswordBtn.disabled = false;
        changePasswordBtn.textContent = 'Update Password';
    }
}

async function downloadBackup() {
    if (!isSuperFamily) {
        showError('Only super family can download backups.');
        return;
    }
    try {
        showError('');
        showSuccess('');
        downloadBackupBtn.disabled = true;
        downloadBackupBtn.textContent = 'Creating backup...';

        const response = await fetch(`${API_BASE}/backup/download`);
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const contentDisposition = response.headers.get('Content-Disposition');
        let filename = 'kids_learning_backup.zip';
        if (contentDisposition) {
            const matches = /filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/.exec(contentDisposition);
            if (matches && matches[1]) {
                filename = matches[1].replace(/['"]/g, '');
            }
        }

        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
        document.body.removeChild(a);

        showSuccess('Backup downloaded successfully.');
    } catch (error) {
        console.error('Error downloading backup:', error);
        showError('Failed to download backup. Please try again.');
    } finally {
        downloadBackupBtn.disabled = false;
        downloadBackupBtn.textContent = '⬇️ Download Backup';
    }
}

async function restoreBackup(file, password) {
    if (!isSuperFamily) {
        showError('Only super family can restore backups.');
        return;
    }
    try {
        showError('');
        showSuccess('');
        restoreBackupBtn.disabled = true;
        restoreBackupBtn.textContent = 'Restoring...';
        const formData = new FormData();
        formData.append('backup', file);
        formData.append('confirmPassword', password);
        const response = await fetch(`${API_BASE}/backup/restore`, {
            method: 'POST',
            body: formData,
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok) {
            if (response.status === 400 || response.status === 403) {
                if (window.PracticeManageCommon && typeof window.PracticeManageCommon._showPasswordMessageDialog === 'function') {
                    await window.PracticeManageCommon._showPasswordMessageDialog('restoring backup', result.error || 'Invalid password');
                } else {
                    showError(result.error || 'Invalid password');
                }
            } else {
                showError(result.error || 'Failed to restore backup.');
            }
            backupFileInput.value = '';
            return;
        }

        showSuccess('Backup restored successfully. Reloading...');
        backupFileInput.value = '';
        setTimeout(() => {
            window.location.reload();
        }, 1200);
    } catch (error) {
        console.error('Error restoring backup:', error);
        showError('Failed to restore backup. Please try again.');
        backupFileInput.value = '';
    } finally {
        restoreBackupBtn.disabled = false;
        restoreBackupBtn.textContent = '⬆️ Restore Backup';
    }
}

async function promptPasswordOnce(actionLabel, warningMessage = '') {
    if (!window.PracticeManageCommon || typeof window.PracticeManageCommon._showPasswordInputDialog !== 'function') {
        showError('Password dialog is unavailable');
        return null;
    }
    const inputResult = await window.PracticeManageCommon._showPasswordInputDialog(actionLabel, { warningMessage });
    if (!inputResult || inputResult.cancelled) {
        return null;
    }
    const password = String(inputResult.password || '').trim();
    if (!password) {
        if (typeof window.PracticeManageCommon._showPasswordMessageDialog === 'function') {
            await window.PracticeManageCommon._showPasswordMessageDialog(actionLabel, 'Password is required.');
        } else {
            showError('Password is required.');
        }
        return null;
    }
    return password;
}

async function loadBackupInfo() {
    if (!isSuperFamily) {
        backupInfo.textContent = '';
        return;
    }
    try {
        const response = await fetch(`${API_BASE}/backup/info`);
        if (!response.ok) {
            return;
        }
        const info = await response.json();
        if (info.total_files > 0) {
            backupInfo.textContent = `${info.total_files} files, ${info.total_size_mb} MB`;
        } else {
            backupInfo.textContent = 'No backup files yet.';
        }
    } catch (error) {
        console.error('Error loading backup info:', error);
    }
}

async function loadFamilyRole() {
    try {
        const response = await fetch(`${API_BASE}/family-auth/status`);
        if (response.ok) {
            const auth = await response.json().catch(() => ({}));
            isSuperFamily = Boolean(auth.isSuperFamily);
        } else {
            isSuperFamily = false;
        }
    } catch (error) {
        isSuperFamily = false;
    }

    if (backupSettingsCard) {
        backupSettingsCard.classList.toggle('hidden', !isSuperFamily);
    }
    if (familyAdminCard) {
        familyAdminCard.classList.toggle('hidden', !isSuperFamily);
    }
    if (familyManageDeckLink) {
        familyManageDeckLink.classList.remove('hidden');
        familyManageDeckLink.textContent = isSuperFamily ? '🗂️ Manage Decks' : '🗂️ View Decks';
    }
    const chineseBankLink = document.getElementById('familyManageChineseBankLink');
    if (chineseBankLink) {
        chineseBankLink.classList.remove('hidden');
        chineseBankLink.textContent = isSuperFamily ? '📕 Manage Chinese Dictionary' : '📕 View Chinese Dictionary';
    }
    resetBadgeArtStudioState();
    badgeArtStudioCanEdit = isSuperFamily;
    syncBadgeArtStudioModeCopy();
    renderBadgeArtStudioStatus();
    if (!isSuperFamily) {
        closeBadgeArtStudio({ force: true, discardDraft: true });
        if (familyAccountsList) {
            familyAccountsList.innerHTML = '';
        }
        if (familyStorageSummary) {
            familyStorageSummary.textContent = '';
            familyStorageSummary.classList.add('hidden');
        }
        if (familyAccountsEmpty) {
            familyAccountsEmpty.classList.add('hidden');
        }
        if (badgeArtAchievementList) {
            badgeArtAchievementList.innerHTML = '';
        }
        if (badgeArtBankGrid) {
            badgeArtBankGrid.innerHTML = '';
        }
        if (badgeAchievementCount) {
            badgeAchievementCount.textContent = '';
        }
        if (badgeArtBankCount) {
            badgeArtBankCount.textContent = '';
        }
        showFamilyAdminError('');
        showFamilyAdminSuccess('');
        showBadgeArtStudioError('');
        showBadgeArtStudioSuccess('');
    }
    syncBadgeArtStudioControls();
}

async function loadFamilyAccounts() {
    if (!isSuperFamily) {
        return;
    }
    showFamilyAdminError('');
    showFamilyAdminSuccess('');
    try {
        const response = await fetch(`${API_BASE}/parent-settings/families`);
        const result = await response.json().catch(() => ({}));
        if (!response.ok) {
            showFamilyAdminError(result.error || `Failed to load families (HTTP ${response.status})`);
            return;
        }
        renderFamilyAccounts(
            Array.isArray(result.families) ? result.families : [],
            result.sharedStorage && typeof result.sharedStorage === 'object' ? result.sharedStorage : null
        );
    } catch (error) {
        console.error('Error loading family accounts:', error);
        showFamilyAdminError('Failed to load family accounts.');
    }
}

function formatBytes(bytes) {
    const value = Number(bytes);
    if (!Number.isFinite(value) || value <= 0) {
        return '0 B';
    }
    if (value < 1024) {
        return `${Math.round(value)} B`;
    }
    if (value < 1024 * 1024) {
        return `${(value / 1024).toFixed(1)} KB`;
    }
    if (value < 1024 * 1024 * 1024) {
        return `${(value / (1024 * 1024)).toFixed(2)} MB`;
    }
    return `${(value / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function renderFamilyAccounts(families, sharedStorage) {
    if (!familyAccountsList || !familyAccountsEmpty) {
        return;
    }
    if (familyStorageSummary) {
        if (!sharedStorage) {
            familyStorageSummary.textContent = '';
            familyStorageSummary.classList.add('hidden');
        } else {
            const sharedDbBytes = Number.isFinite(Number(sharedStorage.sharedDeckDbBytes))
                ? Number(sharedStorage.sharedDeckDbBytes)
                : 0;
            const sharedAudioCount = Number.isInteger(Number(sharedStorage.sharedWritingAudioFileCount))
                ? Number(sharedStorage.sharedWritingAudioFileCount)
                : 0;
            const sharedAudioBytes = Number.isFinite(Number(sharedStorage.sharedWritingAudioTotalBytes))
                ? Number(sharedStorage.sharedWritingAudioTotalBytes)
                : 0;
            familyStorageSummary.textContent = `Shared files: shared_decks.duckdb ${formatBytes(sharedDbBytes)}; shared writing audio ${sharedAudioCount} file(s), ${formatBytes(sharedAudioBytes)}.`;
            familyStorageSummary.classList.remove('hidden');
        }
    }
    if (!Array.isArray(families) || families.length === 0) {
        familyAccountsList.innerHTML = '';
        familyAccountsEmpty.classList.remove('hidden');
        return;
    }
    familyAccountsEmpty.classList.add('hidden');
    familyAccountsList.innerHTML = families.map((family) => {
        const familyId = String(family.id || '');
        const username = String(family.username || '');
        const badgeParts = [];
        if (family.superFamily) {
            badgeParts.push('super');
        }
        if (family.isCurrent) {
            badgeParts.push('current');
        }
        const badgeText = badgeParts.length > 0 ? ` (${badgeParts.join(', ')})` : '';
        const kidDbFileCount = Number.isInteger(Number(family.kidDbFileCount)) ? Number(family.kidDbFileCount) : 0;
        const kidDbTotalBytes = Number.isFinite(Number(family.kidDbTotalBytes)) ? Number(family.kidDbTotalBytes) : 0;
        const audioFileCount = Number.isInteger(Number(family.audioFileCount)) ? Number(family.audioFileCount) : 0;
        const audioTotalBytes = Number.isFinite(Number(family.audioTotalBytes)) ? Number(family.audioTotalBytes) : 0;
        const familyStorageTotalBytes = Number.isFinite(Number(family.familyStorageTotalBytes))
            ? Number(family.familyStorageTotalBytes)
            : (kidDbTotalBytes + audioTotalBytes);
        const kidDbLine = `Kid DB: ${kidDbFileCount} file(s), ${formatBytes(kidDbTotalBytes)}`;
        const audioLine = `Audio: ${audioFileCount} file(s), ${formatBytes(audioTotalBytes)}`;
        const lastActiveRaw = String(family.lastActive || '').trim();
        const lastActiveLine = lastActiveRaw
            ? `Last active: ${new Date(lastActiveRaw).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })} ${new Date(lastActiveRaw).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}`
            : 'Last active: unknown';
        const canDelete = Boolean(family.canDelete);
        const deleteButton = canDelete
            ? `<button type="button" class="btn-secondary" data-action="delete-family" data-family-id="${escapeHtml(familyId)}" data-family-username="${escapeHtml(username)}">Delete</button>`
            : '<span class="family-account-protected">Protected</span>';
        const flagsHtml = badgeText
            ? `<span class="family-account-card-flags">${escapeHtml(badgeText)}</span>`
            : '';
        return `
            <div class="family-account-card">
                <div class="family-account-card-top">
                    <div>
                        <div class="family-account-card-title">
                            <strong>${escapeHtml(username)}</strong> <code>#${escapeHtml(familyId)}</code>${flagsHtml ? ` ${flagsHtml}` : ''}
                        </div>
                        <div class="family-account-card-lines">
                            <div class="settings-note">Family total storage: ${formatBytes(familyStorageTotalBytes)}</div>
                            <div class="settings-note">${kidDbLine}</div>
                            <div class="settings-note">${audioLine}</div>
                            <div class="settings-note">${lastActiveLine}</div>
                        </div>
                    </div>
                    <div class="family-account-card-action">${deleteButton}</div>
                </div>
            </div>
        `;
    }).join('');
}

async function deleteFamilyAccount(familyId, familyUsername) {
    if (!isSuperFamily) {
        showFamilyAdminError('Only super family can delete family accounts.');
        return;
    }
    if (!window.PracticeManageCommon || typeof window.PracticeManageCommon.requestWithPasswordDialog !== 'function') {
        showFamilyAdminError('Password dialog is unavailable.');
        return;
    }

    showFamilyAdminError('');
    showFamilyAdminSuccess('');
    const actionLabel = `deleting family "${familyUsername || familyId}"`;
    const result = await window.PracticeManageCommon.requestWithPasswordDialog(
        actionLabel,
        (password) => fetch(`${API_BASE}/parent-settings/families/${encodeURIComponent(String(familyId))}`, {
            method: 'DELETE',
            headers: window.PracticeManageCommon.buildPasswordHeaders(password, false),
        }),
        { warningMessage: 'This will permanently delete this family account and all of its kid data.' }
    );
    if (result.cancelled) {
        return;
    }
    if (!result.ok) {
        showFamilyAdminError(result.error || 'Failed to delete family account.');
        return;
    }
    showFamilyAdminSuccess(`Deleted family "${familyUsername || familyId}".`);
    await loadFamilyAccounts();
}

function showFamilyAdminError(message) {
    if (!familyAdminError) {
        return;
    }
    const text = String(message || '').trim();
    if (!text) {
        familyAdminError.textContent = '';
        familyAdminError.classList.add('hidden');
        return;
    }
    familyAdminError.textContent = text;
    familyAdminError.classList.remove('hidden');
}

function showFamilyAdminSuccess(message) {
    if (!familyAdminSuccess) {
        return;
    }
    const text = String(message || '').trim();
    if (!text) {
        familyAdminSuccess.textContent = '';
        familyAdminSuccess.classList.add('hidden');
        return;
    }
    familyAdminSuccess.textContent = text;
    familyAdminSuccess.classList.remove('hidden');
}

function showError(message) {
    if (message) {
        const text = String(message);
        if (errorMessage) {
            errorMessage.textContent = '';
            errorMessage.classList.add('hidden');
        }
        if (showError._lastMessage !== text) {
            window.alert(text);
            showError._lastMessage = text;
        }
    } else {
        showError._lastMessage = '';
        if (errorMessage) {
            errorMessage.classList.add('hidden');
        }
    }
}

function showSuccess(message) {
    if (message) {
        successMessage.textContent = message;
        successMessage.classList.remove('hidden');
    } else {
        successMessage.classList.add('hidden');
    }
}

function showPasswordError(message) {
    if (!passwordError) {
        return;
    }
    const text = String(message || '').trim();
    if (!text) {
        passwordError.textContent = '';
        passwordError.classList.add('hidden');
        return;
    }
    passwordError.textContent = text;
    passwordError.classList.remove('hidden');
}

function showPasswordSuccess(message) {
    if (message) {
        passwordSuccess.textContent = message;
        passwordSuccess.classList.remove('hidden');
    } else {
        passwordSuccess.classList.add('hidden');
    }
}

function showTimezoneError(message) {
    if (message) {
        const text = String(message);
        if (timezoneError) {
            timezoneError.textContent = '';
            timezoneError.classList.add('hidden');
        }
        if (showTimezoneError._lastMessage !== text) {
            window.alert(text);
            showTimezoneError._lastMessage = text;
        }
    } else {
        showTimezoneError._lastMessage = '';
        if (timezoneError) {
            timezoneError.classList.add('hidden');
        }
    }
}

function showTimezoneSuccess(message) {
    if (message) {
        timezoneSuccess.textContent = message;
        timezoneSuccess.classList.remove('hidden');
    } else {
        timezoneSuccess.classList.add('hidden');
    }
}

function showRewardsError(message) {
    if (!rewardsError) {
        return;
    }
    if (message) {
        const text = String(message);
        if (rewardsError) {
            rewardsError.textContent = '';
            rewardsError.classList.add('hidden');
        }
        if (showRewardsError._lastMessage !== text) {
            window.alert(text);
            showRewardsError._lastMessage = text;
        }
    } else {
        showRewardsError._lastMessage = '';
        rewardsError.classList.add('hidden');
    }
}

function showRewardsSuccess(message) {
    if (!rewardsSuccess) {
        return;
    }
    if (message) {
        rewardsSuccess.textContent = String(message);
        rewardsSuccess.classList.remove('hidden');
    } else {
        rewardsSuccess.classList.add('hidden');
    }
}
