const API_BASE = `${window.location.origin}/api`;

const passwordForm = document.getElementById('passwordForm');
const currentPasswordInput = document.getElementById('currentPassword');
const newPasswordInput = document.getElementById('newPassword');
const confirmPasswordInput = document.getElementById('confirmPassword');
const changePasswordBtn = document.getElementById('changePasswordBtn');
const downloadBackupBtn = document.getElementById('downloadBackupBtn');
const restoreBackupBtn = document.getElementById('restoreBackupBtn');
const backupFileInput = document.getElementById('backupFileInput');
const backupInfo = document.getElementById('backupInfo');
const successMessage = document.getElementById('successMessage');
const errorMessage = document.getElementById('errorMessage');
const passwordError = document.getElementById('passwordError');
const passwordSuccess = document.getElementById('passwordSuccess');

document.addEventListener('DOMContentLoaded', () => {
    loadBackupInfo();
});

passwordForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    await changePassword();
});

downloadBackupBtn.addEventListener('click', async () => {
    await downloadBackup();
});

restoreBackupBtn.addEventListener('click', () => {
    if (confirm('Warning: Restoring a backup will replace ALL current family data. Continue?')) {
        backupFileInput.click();
    }
});

backupFileInput.addEventListener('change', async (event) => {
    const file = event.target.files[0];
    if (!file) {
        return;
    }
    await restoreBackup(file);
});

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

async function restoreBackup(file) {
    try {
        showError('');
        showSuccess('');
        restoreBackupBtn.disabled = true;
        restoreBackupBtn.textContent = 'Restoring...';

        const formData = new FormData();
        formData.append('backup', file);

        const response = await fetch(`${API_BASE}/backup/restore`, {
            method: 'POST',
            body: formData,
        });

        const result = await response.json().catch(() => ({}));
        if (!response.ok) {
            showError(result.error || 'Failed to restore backup.');
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

async function loadBackupInfo() {
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

function showError(message) {
    if (message) {
        errorMessage.textContent = message;
        errorMessage.classList.remove('hidden');
    } else {
        errorMessage.classList.add('hidden');
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
        passwordError.textContent = message;
        passwordError.classList.remove('hidden');
    } else {
        passwordError.classList.add('hidden');
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
