/*
 * parent-settings-core.js — bootstrap + shared DOM for parent settings page
 *
 * Layout:
 *   1. DOM refs + module state
 *   2. Shared helpers (modal body lock, escape, closest target)
 *   3. Header user switcher + change-password dialog
 *   4. Timezone picker (load, save, pill selection, formatting)
 *   5. Password change submit
 *   6. Trusted browser list
 *   7. Family role + super-family account list + delete
 *   8. Toast / status message helpers (global, password, timezone)
 */

// =====================================================================
// === 1. DOM refs + module state
// =====================================================================

const API_BASE = `${window.location.origin}/api`;
const TRUSTED_PARENT_BROWSER_STORAGE_KEY = 'trusted_parent_browser_v1';

const passwordForm = document.getElementById('passwordForm');
const currentPasswordInput = document.getElementById('currentPassword');
const newPasswordInput = document.getElementById('newPassword');
const confirmPasswordInput = document.getElementById('confirmPassword');
const changePasswordBtn = document.getElementById('changePasswordBtn');
const openChangePasswordBtn = document.getElementById('openChangePasswordBtn');
const manageSubjectBtn = document.getElementById('manageSubjectBtn');
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
const rebuildDbBtn = document.getElementById('rebuildDbBtn');
const rebuildDbResult = document.getElementById('rebuildDbResult');
const trustedBrowsersList = document.getElementById('trustedBrowsersList');
const trustedBrowsersEmpty = document.getElementById('trustedBrowsersEmpty');
const trustedBrowsersError = document.getElementById('trustedBrowsersError');
const trustedBrowsersSuccess = document.getElementById('trustedBrowsersSuccess');
const successMessage = document.getElementById('successMessage');
const errorMessage = document.getElementById('errorMessage');
const passwordError = document.getElementById('passwordError');
const passwordSuccess = document.getElementById('passwordSuccess');
const kidsManageList = document.getElementById('kidsManageList');
const kidAvatarPreviews = new Map();
const addKidForm = document.getElementById('addKidForm');
const addKidNameInput = document.getElementById('addKidNameInput');
const addKidBtn = document.getElementById('addKidBtn');
const kidsManageError = document.getElementById('kidsManageError');
const kidsManageSuccess = document.getElementById('kidsManageSuccess');
let pendingRestorePassword = null;
let isSuperFamily = false;

// =====================================================================
// === 2. Shared helpers (modal body lock, escape, closest target)
// =====================================================================

function syncModalBodyLock() {
    const shouldLock = [
        changePasswordModal,
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
    await loadTrustedBrowsers();
    await loadKidsManage();
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

document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && changePasswordModal && !changePasswordModal.classList.contains('hidden')) {
        closeChangePasswordDialog();
    }
});

// =====================================================================
// === 3. Change-password dialog
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

if (rebuildDbBtn) {
    rebuildDbBtn.addEventListener('click', handleRebuildDatabases);
}

if (trustedBrowsersList) {
    trustedBrowsersList.addEventListener('click', async (event) => {
        const target = getClosestEventTarget(event, 'button[data-action="delete-trusted-browser"][data-browser-id]');
        if (!target) {
            return;
        }
        const browserId = String(target.getAttribute('data-browser-id') || '').trim();
        if (!browserId) {
            return;
        }
        await deleteTrustedBrowser(browserId);
    });
}

if (addKidForm) {
    addKidForm.addEventListener('submit', async (event) => {
        event.preventDefault();
        await addKid(addKidNameInput ? addKidNameInput.value : '');
    });
}

if (kidsManageList) {
    kidsManageList.addEventListener('click', (event) => {
        const avatarBtn = getClosestEventTarget(event, 'button[data-action="set-avatar"]');
        if (avatarBtn) {
            openAvatarEditorForRow(avatarBtn.closest('.kids-manage-row'));
            return;
        }
        const askBtn = getClosestEventTarget(event, 'button[data-action="ask-delete-kid"]');
        if (askBtn) {
            openKidDeleteConfirm(askBtn.closest('.kids-manage-row'));
            return;
        }
        const cancelBtn = getClosestEventTarget(event, 'button[data-action="cancel-delete-kid"]');
        if (cancelBtn) {
            closeKidDeleteConfirm(cancelBtn.closest('.kids-manage-row'));
            showKidsManageError('');
        }
    });
    kidsManageList.addEventListener('submit', async (event) => {
        const form = getClosestEventTarget(event, 'form[data-action="confirm-delete-form"]');
        if (!form) {
            return;
        }
        event.preventDefault();
        await confirmDeleteKid(form.closest('.kids-manage-row'));
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

async function loadTimezoneSettings() {
    try {
        showTimezoneError('');
        showTimezoneSuccess('');
        const response = await fetch(`${API_BASE}/parent-settings/timezone`);
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }
        const data = await response.json();
        const value = String(data.familyTimezone || '').trim();
        if (!value) {
            throw new Error('familyTimezone missing from response');
        }
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

        const saved = String(result.familyTimezone || '').trim();
        if (!saved) {
            showTimezoneError('Timezone save response was missing familyTimezone.');
            return;
        }
        setSelectedTimezonePill(saved);
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
// === 6. Trusted browser list
// =====================================================================

function readLocalTrustedBrowser() {
    try {
        if (!window.localStorage) return null;
        const raw = window.localStorage.getItem(TRUSTED_PARENT_BROWSER_STORAGE_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        const id = String(parsed?.id || '').trim();
        return id ? { id } : null;
    } catch (error) {
        return null;
    }
}

function clearLocalTrustedBrowser() {
    try {
        if (window.localStorage) {
            window.localStorage.removeItem(TRUSTED_PARENT_BROWSER_STORAGE_KEY);
        }
    } catch (error) {
        // ignore
    }
}

function formatTrustedBrowserTime(value) {
    const raw = String(value || '').trim();
    if (!raw) return 'Unknown time';
    const date = new Date(raw);
    if (Number.isNaN(date.getTime())) return 'Unknown time';
    return `${date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })} ${date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}`;
}

async function loadTrustedBrowsers() {
    if (!trustedBrowsersList || !trustedBrowsersEmpty) return;
    showTrustedBrowsersError('');
    showTrustedBrowsersSuccess('');
    try {
        const response = await fetch(`${API_BASE}/family-auth/trusted-browsers`);
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
            throw new Error(payload.error || `HTTP ${response.status}`);
        }
        renderTrustedBrowsers(payload.trustedBrowsers);
    } catch (error) {
        renderTrustedBrowsers([]);
        showTrustedBrowsersError(error.message || 'Failed to load trusted browsers.');
    }
}

function renderTrustedBrowsers(items) {
    if (!trustedBrowsersList || !trustedBrowsersEmpty) return;
    const browsers = Array.isArray(items) ? items : [];
    if (browsers.length === 0) {
        trustedBrowsersList.innerHTML = '';
        trustedBrowsersEmpty.classList.remove('hidden');
        return;
    }
    trustedBrowsersEmpty.classList.add('hidden');
    const localTrusted = readLocalTrustedBrowser();
    trustedBrowsersList.innerHTML = browsers.map((browser) => {
        const browserId = String(browser?.id || '').trim();
        const label = String(browser?.label || 'Trusted browser').trim() || 'Trusted browser';
        const isCurrent = Boolean(localTrusted && localTrusted.id === browserId);
        const currentDot = isCurrent
            ? '<span class="trusted-browser-current-dot" title="This browser" aria-label="This browser"></span>'
            : '';
        const createdAt = formatTrustedBrowserTime(browser?.createdAt);
        const lastUsedAt = formatTrustedBrowserTime(browser?.lastUsedAt);
        return `
            <div class="trusted-browser-card">
                <div class="trusted-browser-title">
                    <span class="icon" data-icon="monitor" data-icon-size="16" data-icon-stroke="2.2"></span>
                    <span class="trusted-browser-name">${escapeHtml(label)}</span>
                    ${currentDot}
                </div>
                <div class="trusted-browser-times">
                    <span class="trusted-browser-meta">Trusted ${escapeHtml(createdAt)}</span>
                    <span class="trusted-browser-meta">Last used ${escapeHtml(lastUsedAt)}</span>
                </div>
                <button type="button" class="paradigm-icon-btn is-danger paradigm-icon-action-btn" data-action="delete-trusted-browser" data-browser-id="${escapeHtml(browserId)}" aria-label="${escapeHtml(`Remove ${label}`)}">
                    ${window.icon('trash', { size: 16 })}
                </button>
            </div>
        `;
    }).join('');
    if (typeof window.hydrateIcons === 'function') {
        window.hydrateIcons(trustedBrowsersList);
    }
}

async function deleteTrustedBrowser(browserId) {
    if (!browserId) return;
    showTrustedBrowsersError('');
    showTrustedBrowsersSuccess('');
    try {
        const response = await fetch(`${API_BASE}/family-auth/trusted-browsers/${encodeURIComponent(browserId)}`, {
            method: 'DELETE',
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
            throw new Error(payload.error || `HTTP ${response.status}`);
        }
        const localTrusted = readLocalTrustedBrowser();
        if (localTrusted && localTrusted.id === browserId) {
            clearLocalTrustedBrowser();
        }
        await loadTrustedBrowsers();
        showTrustedBrowsersSuccess('Trusted browser removed.');
    } catch (error) {
        showTrustedBrowsersError(error.message || 'Failed to remove trusted browser.');
    }
}

function showTrustedBrowsersError(message) {
    if (!trustedBrowsersError) return;
    const text = String(message || '').trim();
    trustedBrowsersError.textContent = text;
    trustedBrowsersError.classList.toggle('hidden', !text);
}

function showTrustedBrowsersSuccess(message) {
    if (!trustedBrowsersSuccess) return;
    const text = String(message || '').trim();
    trustedBrowsersSuccess.textContent = text;
    trustedBrowsersSuccess.classList.toggle('hidden', !text);
}

// =====================================================================
// === 7. Family role + super-family account list + delete
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
    if (manageSubjectBtn) {
        manageSubjectBtn.classList.toggle('hidden', !isSuperFamily);
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

async function handleRebuildDatabases() {
    if (!rebuildDbBtn) return;
    if (!window.confirm('Rebuild all kid databases? This compacts the files to reclaim space. Practice data is preserved.')) {
        return;
    }
    const label = rebuildDbBtn.querySelector('.btn-label');
    const originalText = label ? label.textContent : '';
    rebuildDbBtn.disabled = true;
    if (label) label.textContent = 'Rebuilding…';
    if (rebuildDbResult) rebuildDbResult.classList.add('hidden');
    showError('');
    try {
        const response = await fetch(`${API_BASE}/parent-settings/rebuild-databases`, { method: 'POST' });
        const result = await response.json().catch(() => ({}));
        if (!response.ok) {
            showError(result.error || `Rebuild failed (HTTP ${response.status})`);
            return;
        }
        const kids = Array.isArray(result.kids) ? result.kids : [];
        const kidFailures = kids.filter((k) => k && k.error).length;
        const sharedFailed = Boolean(result.sharedDecks && result.sharedDecks.error);
        const dbCount = kids.length + 1; // kid DBs + the shared decks DB
        const okCount = (kids.length - kidFailures) + (sharedFailed ? 0 : 1);
        const failed = kidFailures + (sharedFailed ? 1 : 0);
        if (rebuildDbResult) {
            rebuildDbResult.textContent = `Rebuilt ${okCount}/${dbCount} databases · reclaimed ${formatBytes(result.totalReclaimedBytes)} `
                + `(${formatBytes(result.totalOldBytes)} → ${formatBytes(result.totalNewBytes)})`
                + (failed ? ` · ${failed} failed` : '');
            rebuildDbResult.classList.remove('hidden');
        }
        loadFamilyAccounts();
    } catch (error) {
        showError(error.message || 'Rebuild failed.');
    } finally {
        rebuildDbBtn.disabled = false;
        if (label) label.textContent = originalText || 'Rebuild Databases';
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
            ? `<button type="button" class="paradigm-icon-btn is-danger paradigm-icon-action-btn" data-action="delete-family" data-family-id="${escapeHtml(familyId)}" data-family-username="${escapeHtml(username)}" aria-label="${escapeHtml(`Delete ${username || familyId}`)}">${icon('trash', { size: 16 })}</button>`
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
// === 7b. Children — inline add / remove (remove needs password)
// =====================================================================

async function loadKidsManage() {
    if (!kidsManageList) {
        return;
    }
    try {
        const response = await fetch(`${API_BASE}/kids?view=practice_nav`);
        const payload = await response.json().catch(() => ([]));
        if (!response.ok) {
            showKidsManageError((payload && payload.error) || `Failed to load children (HTTP ${response.status})`);
            return;
        }
        renderKidsManage(Array.isArray(payload) ? payload : []);
    } catch (error) {
        console.error('Error loading children:', error);
        showKidsManageError('Failed to load children.');
    }
}

function renderKidsManage(kids) {
    if (!kidsManageList) {
        return;
    }
    if (!Array.isArray(kids) || kids.length === 0) {
        kidsManageList.innerHTML = '';
        return;
    }
    kidsManageList.innerHTML = kids.map((kid) => {
        const kidId = String(kid.id || '');
        const name = String(kid.name || '');
        const tone = avatarToneIndex(kidId || name);
        const preview = kidAvatarPreviews.get(kidId) || String(kid.avatarUrl || '').trim();
        const avatarInner = preview
            ? `<img src="${escapeHtml(preview)}" alt="" class="kids-manage-avatar-img">`
            : escapeHtml(avatarInitial(name));
        const avatarVariant = preview ? 'kids-manage-avatar--photo' : `kid-initial-avatar--tone-${tone}`;
        return `
            <div class="kids-manage-row" data-kid-id="${escapeHtml(kidId)}">
                <span class="kids-manage-avatar kid-initial-avatar ${avatarVariant}" data-kid-avatar>${avatarInner}</span>
                <span class="kids-manage-name">${escapeHtml(name)}</span>
                <div class="kids-manage-row-action">
                    <button type="button" class="paradigm-icon-btn paradigm-icon-action-btn" data-action="set-avatar" aria-label="${escapeHtml(`Set photo for ${name}`)}">${icon('image', { size: 16 })}</button>
                    <button type="button" class="paradigm-icon-btn is-danger paradigm-icon-action-btn" data-action="ask-delete-kid" aria-label="${escapeHtml(`Remove ${name}`)}">${icon('trash', { size: 16 })}</button>
                </div>
                <form class="kids-manage-confirm" data-action="confirm-delete-form">
                    <input type="password" class="paradigm-input kids-manage-input kids-manage-pw" placeholder="Password" autocomplete="current-password">
                    <button type="button" class="paradigm-decision-btn paradigm-decision-btn--cancel" data-action="cancel-delete-kid" aria-label="Cancel delete" title="Cancel">${icon('x', { size: 18, strokeWidth: 2.7 })}</button>
                    <button type="submit" class="paradigm-decision-btn paradigm-decision-btn--confirm" data-action="confirm-delete-kid" aria-label="${escapeHtml(`Confirm deleting ${name}`)}" title="Confirm">${icon('check', { size: 18, strokeWidth: 2.7 })}</button>
                </form>
            </div>
        `;
    }).join('');
}

function avatarInitial(name) {
    const trimmed = String(name || '').trim();
    return trimmed ? trimmed[0].toUpperCase() : '?';
}

function avatarToneIndex(value, toneCount = 6) {
    const s = String(value || '');
    let hash = 0;
    for (let i = 0; i < s.length; i += 1) {
        hash = ((hash << 5) - hash) + s.charCodeAt(i);
        hash |= 0;
    }
    return Math.abs(hash) % toneCount;
}

function applyAvatarPreview(row, dataUrl) {
    const holder = row && row.querySelector('[data-kid-avatar]');
    if (!holder) {
        return;
    }
    Array.from(holder.classList).forEach((cls) => {
        if (cls.indexOf('kid-initial-avatar--tone-') === 0) {
            holder.classList.remove(cls);
        }
    });
    holder.classList.add('kids-manage-avatar--photo');
    holder.innerHTML = `<img src="${escapeHtml(dataUrl)}" alt="" class="kids-manage-avatar-img">`;
}

function openAvatarEditorForRow(row) {
    if (!row || !window.AvatarEditor) {
        return;
    }
    const kidId = String(row.getAttribute('data-kid-id') || '').trim();
    const name = String(row.querySelector('.kids-manage-name')?.textContent || '').trim();
    window.AvatarEditor.open({
        title: name ? `${name}'s photo` : 'Set photo',
        outputSize: 256,
        onSave: async ({ dataUrl }) => {
            const response = await fetch(`${API_BASE}/kids/${encodeURIComponent(kidId)}/avatar`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ imageBase64: dataUrl }),
            });
            const data = await response.json().catch(() => ({}));
            if (!response.ok) {
                throw new Error(data.error || `Failed to save photo (HTTP ${response.status})`);
            }
            const url = data.avatarUrl || dataUrl;
            kidAvatarPreviews.set(kidId, url);
            applyAvatarPreview(row, url);
        },
    });
}

function openKidDeleteConfirm(row) {
    if (!row || !kidsManageList) {
        return;
    }
    kidsManageList.querySelectorAll('.kids-manage-row.is-confirming').forEach((other) => {
        if (other !== row) {
            closeKidDeleteConfirm(other);
        }
    });
    row.classList.add('is-confirming');
    const pw = row.querySelector('.kids-manage-pw');
    if (pw) {
        pw.value = '';
        pw.focus();
    }
}

function closeKidDeleteConfirm(row) {
    if (!row) {
        return;
    }
    row.classList.remove('is-confirming');
    const pw = row.querySelector('.kids-manage-pw');
    if (pw) {
        pw.value = '';
    }
}

async function addKid(name) {
    const trimmed = String(name || '').trim();
    if (!trimmed) {
        showKidsManageError('Please enter a name.');
        return;
    }
    showKidsManageError('');
    showKidsManageSuccess('');
    if (addKidBtn) {
        addKidBtn.disabled = true;
    }
    try {
        const response = await fetch(`${API_BASE}/kids`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: trimmed }),
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
            showKidsManageError(payload.error || `Failed to add child (HTTP ${response.status})`);
            return;
        }
        if (addKidNameInput) {
            addKidNameInput.value = '';
        }
        showKidsManageSuccess(`Added ${trimmed}.`);
        await loadKidsManage();
    } catch (error) {
        console.error('Error adding kid:', error);
        showKidsManageError('Failed to add child.');
    } finally {
        if (addKidBtn) {
            addKidBtn.disabled = false;
        }
    }
}

async function confirmDeleteKid(row) {
    if (!row) {
        return;
    }
    const kidId = String(row.getAttribute('data-kid-id') || '').trim();
    const pwInput = row.querySelector('.kids-manage-pw');
    const password = String((pwInput && pwInput.value) || '').trim();
    if (!kidId) {
        return;
    }
    if (!password) {
        showKidsManageError('Password is required to remove a child.');
        if (pwInput) {
            pwInput.focus();
        }
        return;
    }
    if (!window.PracticeManageCommon || typeof window.PracticeManageCommon.buildPasswordHeaders !== 'function') {
        showKidsManageError('Password support is unavailable.');
        return;
    }
    showKidsManageError('');
    showKidsManageSuccess('');
    const confirmBtn = row.querySelector('[data-action="confirm-delete-kid"]');
    if (confirmBtn) {
        confirmBtn.disabled = true;
    }
    try {
        const response = await fetch(`${API_BASE}/kids/${encodeURIComponent(kidId)}`, {
            method: 'DELETE',
            headers: window.PracticeManageCommon.buildPasswordHeaders(password, false),
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
            // 400/403 are wrong/missing password — keep the row open so they can retry.
            showKidsManageError(payload.error || `Failed to remove child (HTTP ${response.status})`);
            if (confirmBtn) {
                confirmBtn.disabled = false;
            }
            if (pwInput) {
                pwInput.focus();
                pwInput.select();
            }
            return;
        }
        showKidsManageSuccess('Child removed.');
        await loadKidsManage();
    } catch (error) {
        console.error('Error deleting kid:', error);
        showKidsManageError('Failed to remove child.');
        if (confirmBtn) {
            confirmBtn.disabled = false;
        }
    }
}

function showKidsManageError(message) {
    if (!kidsManageError) {
        return;
    }
    const text = String(message || '').trim();
    kidsManageError.textContent = text;
    kidsManageError.classList.toggle('hidden', !text);
}

function showKidsManageSuccess(message) {
    if (!kidsManageSuccess) {
        return;
    }
    const text = String(message || '').trim();
    kidsManageSuccess.textContent = text;
    kidsManageSuccess.classList.toggle('hidden', !text);
}

// =====================================================================
// === 8. Toast / status message helpers (global, password, timezone)
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
