const API_BASE = `${window.location.origin}/api`;

const passwordForm = document.getElementById('passwordForm');
const currentPasswordInput = document.getElementById('currentPassword');
const newPasswordInput = document.getElementById('newPassword');
const confirmPasswordInput = document.getElementById('confirmPassword');
const changePasswordBtn = document.getElementById('changePasswordBtn');
const familyTimezoneSelect = document.getElementById('familyTimezone');
const saveTimezoneBtn = document.getElementById('saveTimezoneBtn');
const timezoneError = document.getElementById('timezoneError');
const timezoneSuccess = document.getElementById('timezoneSuccess');
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

document.addEventListener('DOMContentLoaded', async () => {
    await loadFamilyRole();
    initializeTimezoneOptions();
    loadTimezoneSettings();
    if (isSuperFamily) {
        loadBackupInfo();
        loadFamilyAccounts();
    }
});

passwordForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    await changePassword();
});

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
        const target = event.target.closest('button[data-action="delete-family"][data-family-id]');
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
    if (!isSuperFamily) {
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
        showFamilyAdminError('');
        showFamilyAdminSuccess('');
    }
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
        const kidCount = Number.isInteger(Number(family.kidCount)) ? Number(family.kidCount) : 0;
        const kidDbFileCount = Number.isInteger(Number(family.kidDbFileCount)) ? Number(family.kidDbFileCount) : 0;
        const kidDbTotalBytes = Number.isFinite(Number(family.kidDbTotalBytes)) ? Number(family.kidDbTotalBytes) : 0;
        const audioFileCount = Number.isInteger(Number(family.audioFileCount)) ? Number(family.audioFileCount) : 0;
        const audioTotalBytes = Number.isFinite(Number(family.audioTotalBytes)) ? Number(family.audioTotalBytes) : 0;
        const lessonAudioCount = Number.isInteger(Number(family.lessonReadingAudioFileCount))
            ? Number(family.lessonReadingAudioFileCount)
            : 0;
        const lessonAudioBytes = Number.isFinite(Number(family.lessonReadingAudioTotalBytes))
            ? Number(family.lessonReadingAudioTotalBytes)
            : 0;
        const otherAudioCount = Math.max(0, audioFileCount - lessonAudioCount);
        const otherAudioBytes = Math.max(0, audioTotalBytes - lessonAudioBytes);
        const familyStorageTotalBytes = Number.isFinite(Number(family.familyStorageTotalBytes))
            ? Number(family.familyStorageTotalBytes)
            : (kidDbTotalBytes + audioTotalBytes);
        const kidDbLine = (kidDbFileCount > 0 && kidDbFileCount !== kidCount)
            ? `Kid DB files: ${kidDbFileCount}, total ${formatBytes(kidDbTotalBytes)}`
            : `Kid DB total: ${formatBytes(kidDbTotalBytes)}`;
        const canDelete = Boolean(family.canDelete);
        const deleteButton = canDelete
            ? `<button type="button" class="btn-secondary" data-action="delete-family" data-family-id="${escapeHtml(familyId)}" data-family-username="${escapeHtml(username)}">Delete</button>`
            : '<span class="settings-note">Protected</span>';
        return `
            <div class="settings-row" style="justify-content: space-between; border-top: 1px solid #eef1f8; padding: 0.55rem 0;">
                <div>
                    <strong>${escapeHtml(username)}</strong> <code>#${escapeHtml(familyId)}</code>${escapeHtml(badgeText)}
                    <div class="settings-note">Family total storage: ${formatBytes(familyStorageTotalBytes)}</div>
                    <div class="settings-note">${kidCount} kid(s)</div>
                    <div class="settings-note">${kidDbLine}</div>
                    <div class="settings-note">Lesson reading audio: ${lessonAudioCount}, ${formatBytes(lessonAudioBytes)}</div>
                    ${otherAudioCount > 0 ? `<div class="settings-note">Other family audio: ${otherAudioCount}, ${formatBytes(otherAudioBytes)}</div>` : ''}
                </div>
                <div>${deleteButton}</div>
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
    if (message) {
        const text = String(message);
        if (passwordError) {
            passwordError.textContent = '';
            passwordError.classList.add('hidden');
        }
        if (showPasswordError._lastMessage !== text) {
            window.alert(text);
            showPasswordError._lastMessage = text;
        }
    } else {
        showPasswordError._lastMessage = '';
        if (passwordError) {
            passwordError.classList.add('hidden');
        }
    }
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
