/*
 * parent-settings-core.js — bootstrap + shared DOM for parent settings page
 *
 * Layout:
 *   1. DOM refs + module state
 *   2. Shared helpers (modal body lock, escape, closest target)
 *   3. Change-password dialog + family logout
 *   4. Timezone picker (load, save, pill selection, formatting)
 *   5. Password change submit
 *   6. Family role + super-family account list + delete
 *   7. Toast / status message helpers (global, password, timezone, badges)
 */

// =====================================================================
// === 1. DOM refs + module state
// =====================================================================

const API_BASE = `${window.location.origin}/api`;

const passwordForm = document.getElementById('passwordForm');
const currentPasswordInput = document.getElementById('currentPassword');
const newPasswordInput = document.getElementById('newPassword');
const confirmPasswordInput = document.getElementById('confirmPassword');
const changePasswordBtn = document.getElementById('changePasswordBtn');
const openChangePasswordBtn = document.getElementById('openChangePasswordBtn');
const familySettingsLogoutBtn = document.getElementById('familySettingsLogoutBtn');
const changePasswordModal = document.getElementById('changePasswordModal');
const closeChangePasswordBtn = document.getElementById('closeChangePasswordBtn');
const timezoneMenuBtn = document.getElementById('timezoneMenuBtn');
const timezoneMenuBtnLabel = document.getElementById('timezoneMenuBtnLabel');
const timezoneMenuPopover = document.getElementById('timezoneMenuPopover');
const timezoneCurrentNote = document.getElementById('timezoneCurrentNote');
const TIMEZONE_OPTIONS = [
    { value: 'America/New_York',    label: 'Eastern', sub: 'New York' },
    { value: 'America/Chicago',     label: 'Central', sub: 'Chicago' },
    { value: 'America/Los_Angeles', label: 'Pacific', sub: 'California' },
    { value: 'Asia/Shanghai',       label: 'China',   sub: 'Shanghai' },
];
let currentFamilyTimezone = '';
const timezoneError = document.getElementById('timezoneError');
const timezoneSuccess = document.getElementById('timezoneSuccess');
const badgeTrackingStatusText = document.getElementById('badgeTrackingStatusText');
const startBadgeTrackingBtn = document.getElementById('startBadgeTrackingBtn');
const resetBadgeTrackingBtn = document.getElementById('resetBadgeTrackingBtn');
const badgeTrackingError = document.getElementById('badgeTrackingError');
const badgeTrackingSuccess = document.getElementById('badgeTrackingSuccess');
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
let isSuperFamily = false;

// =====================================================================
// === 2. Shared helpers (modal body lock, escape, closest target)
// =====================================================================

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

document.addEventListener('DOMContentLoaded', async () => {
    await loadFamilyRole();
    initializeTimezoneOptions();
    await loadTimezoneSettings();
    await loadBadgeTrackingStatus();
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
    changePasswordModal.querySelectorAll('.password-toggle').forEach((btn) => {
        const input = document.getElementById(btn.dataset.target);
        if (!input) return;
        btn.addEventListener('click', () => {
            const show = input.type === 'password';
            input.type = show ? 'text' : 'password';
            btn.innerHTML = window.icon(show ? 'eye-off' : 'eye', { strokeWidth: 2 });
            btn.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
        });
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

if (timezoneMenuBtn && timezoneMenuPopover) {
    timezoneMenuBtn.addEventListener('click', (event) => {
        event.stopPropagation();
        setTimezoneMenuOpen(!isTimezoneMenuOpen());
    });
    timezoneMenuPopover.addEventListener('click', async (event) => {
        const item = event.target.closest('.tz-dropdown-item');
        if (!item || item.disabled) {
            return;
        }
        const tz = String(item.dataset.tz || '').trim();
        setTimezoneMenuOpen(false);
        timezoneMenuBtn.focus();
        if (!tz || tz === currentFamilyTimezone) {
            return;
        }
        await saveTimezoneSettings(tz);
    });
    document.addEventListener('click', (event) => {
        if (!isTimezoneMenuOpen()) {
            return;
        }
        const target = event.target;
        if (timezoneMenuPopover.contains(target) || timezoneMenuBtn.contains(target)) {
            return;
        }
        setTimezoneMenuOpen(false);
    });
    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape' && isTimezoneMenuOpen()) {
            setTimezoneMenuOpen(false);
            timezoneMenuBtn.focus();
        }
    });
}

if (startBadgeTrackingBtn) {
    startBadgeTrackingBtn.addEventListener('click', async () => {
        await startBadgeTracking();
    });
}

if (resetBadgeTrackingBtn) {
    resetBadgeTrackingBtn.addEventListener('click', async () => {
        await resetBadgeTracking();
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
        const closeBtn = getClosestEventTarget(event, '[data-badge-art-action="close"]');
        if (closeBtn) {
            closeBadgeArtStudio({ discardDraft: true });
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

// =====================================================================
// === 3. Change-password dialog + family logout
// =====================================================================

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

// =====================================================================
// === 4. Timezone picker (load, save, pill selection, formatting)
// =====================================================================

function getTimezoneMenuItems() {
    if (!timezoneMenuPopover) {
        return [];
    }
    return Array.from(timezoneMenuPopover.querySelectorAll('.tz-dropdown-item'));
}

function buildTimezoneMenuItems() {
    if (!timezoneMenuPopover) {
        return;
    }
    timezoneMenuPopover.innerHTML = '';
    TIMEZONE_OPTIONS.forEach((option) => {
        const item = document.createElement('button');
        item.type = 'button';
        item.className = 'tz-dropdown-item';
        item.setAttribute('role', 'menuitemradio');
        item.setAttribute('aria-checked', 'false');
        item.dataset.tz = option.value;
        item.innerHTML = `
            ${window.icon('check', { className: 'tz-dropdown-item-check', strokeWidth: 2.6 })}
            <span class="tz-dropdown-item-label"></span>
            <span class="tz-dropdown-item-sub"></span>
        `;
        item.querySelector('.tz-dropdown-item-label').textContent = option.label;
        item.querySelector('.tz-dropdown-item-sub').textContent = option.sub;
        timezoneMenuPopover.appendChild(item);
    });
}

function setSelectedTimezonePill(tz) {
    currentFamilyTimezone = tz || '';
    const items = getTimezoneMenuItems();
    let matched = null;
    items.forEach((item) => {
        const isSelected = item.dataset.tz === tz;
        if (isSelected) matched = item;
        item.classList.toggle('selected', isSelected);
        item.setAttribute('aria-checked', isSelected ? 'true' : 'false');
    });
    if (timezoneMenuBtnLabel) {
        if (matched) {
            const option = TIMEZONE_OPTIONS.find((opt) => opt.value === tz);
            timezoneMenuBtnLabel.textContent = option ? `${option.label} (${option.sub})` : tz;
        } else {
            timezoneMenuBtnLabel.textContent = tz ? tz : 'Select…';
        }
    }
    if (timezoneCurrentNote) {
        if (!matched && tz) {
            timezoneCurrentNote.textContent = `Currently set to ${tz}. Pick one of the options to change.`;
            timezoneCurrentNote.classList.remove('hidden');
        } else {
            timezoneCurrentNote.textContent = '';
            timezoneCurrentNote.classList.add('hidden');
        }
    }
}

function setTimezonePickerDisabled(disabled) {
    if (timezoneMenuBtn) {
        timezoneMenuBtn.disabled = disabled;
    }
    getTimezoneMenuItems().forEach((item) => {
        item.disabled = disabled;
    });
}

function setTimezoneMenuOpen(open) {
    if (!timezoneMenuBtn || !timezoneMenuPopover) {
        return;
    }
    timezoneMenuPopover.classList.toggle('hidden', !open);
    timezoneMenuPopover.setAttribute('aria-hidden', open ? 'false' : 'true');
    timezoneMenuBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
}

function isTimezoneMenuOpen() {
    return !!(timezoneMenuPopover && !timezoneMenuPopover.classList.contains('hidden'));
}

function initializeTimezoneOptions() {
    buildTimezoneMenuItems();
    setSelectedTimezonePill('');
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
        console.error('Error formatting badge timestamp:', error);
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
        setSelectedTimezonePill(value);
    } catch (error) {
        console.error('Error loading timezone settings:', error);
        showTimezoneError('Failed to load family timezone.');
    }
}

async function saveTimezoneSettings(timezoneName) {
    const tz = String(timezoneName || '').trim();
    if (!tz) {
        showTimezoneError('Please select a timezone.');
        return;
    }
    try {
        showTimezoneError('');
        showTimezoneSuccess('');
        setTimezonePickerDisabled(true);
        const response = await fetch(`${API_BASE}/parent-settings/timezone`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ familyTimezone: tz })
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok) {
            showTimezoneError(result.error || 'Failed to save family timezone.');
            return;
        }

        const saved = String(result.familyTimezone || tz);
        setSelectedTimezonePill(saved);
        badgeTrackingFamilyTimezone = saved || DEFAULT_FAMILY_TIMEZONE;
        await loadBadgeTrackingStatus();
        showTimezoneSuccess('Family timezone saved.');
    } catch (error) {
        console.error('Error saving timezone settings:', error);
        showTimezoneError('Failed to save family timezone.');
    } finally {
        setTimezonePickerDisabled(false);
    }
}

// =====================================================================
// === 5. Password change submit
// =====================================================================

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
        const changePwLabel = changePasswordBtn.querySelector('.btn-label');
        if (changePwLabel) changePwLabel.textContent = 'Updating...';

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
        const changePwLabelReset = changePasswordBtn.querySelector('.btn-label');
        if (changePwLabelReset) changePwLabelReset.textContent = 'Update Password';
    }
}

// =====================================================================
// === 6. Family role + super-family account list + delete
// =====================================================================

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
            ? `<button type="button" class="semantic-outline-btn semantic-outline-btn--red" data-action="delete-family" data-family-id="${escapeHtml(familyId)}" data-family-username="${escapeHtml(username)}">${icon('trash', { size: 18 })} Delete</button>`
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

// =====================================================================
// === 7. Toast / status message helpers (global, password, timezone, badges)
// =====================================================================

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

function showBadgeTrackingError(message) {
    if (!badgeTrackingError) {
        return;
    }
    if (message) {
        const text = String(message);
        if (badgeTrackingError) {
            badgeTrackingError.textContent = '';
            badgeTrackingError.classList.add('hidden');
        }
        if (showBadgeTrackingError._lastMessage !== text) {
            window.alert(text);
            showBadgeTrackingError._lastMessage = text;
        }
    } else {
        showBadgeTrackingError._lastMessage = '';
        badgeTrackingError.classList.add('hidden');
    }
}

function showBadgeTrackingSuccess(message) {
    if (!badgeTrackingSuccess) {
        return;
    }
    if (message) {
        badgeTrackingSuccess.textContent = String(message);
        badgeTrackingSuccess.classList.remove('hidden');
    } else {
        badgeTrackingSuccess.classList.add('hidden');
    }
}
