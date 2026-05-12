async function downloadBackup() {
    if (!isSuperFamily) {
        showError('Only super family can download backups.');
        return;
    }
    try {
        showError('');
        showSuccess('');
        downloadBackupBtn.disabled = true;
        const downloadLabel = downloadBackupBtn.querySelector('.btn-label');
        if (downloadLabel) downloadLabel.textContent = 'Creating backup...';

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
        const downloadLabelReset = downloadBackupBtn.querySelector('.btn-label');
        if (downloadLabelReset) downloadLabelReset.textContent = 'Download Backup';
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
        const restoreLabel = restoreBackupBtn.querySelector('.btn-label');
        if (restoreLabel) restoreLabel.textContent = 'Restoring...';
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
        const restoreLabelReset = restoreBackupBtn.querySelector('.btn-label');
        if (restoreLabelReset) restoreLabelReset.textContent = 'Restore Backup';
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
