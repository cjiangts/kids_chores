// API Configuration
// Use the same host that served the page (works on phone and computer)
const API_BASE = `${window.location.origin}/api`;

// DOM Elements
const kidsList = document.getElementById('kidsList');
const newKidBtn = document.getElementById('newKidBtn');
const kidModal = document.getElementById('kidModal');
const kidForm = document.getElementById('kidForm');
const cancelBtn = document.getElementById('cancelBtn');
const errorMessage = document.getElementById('errorMessage');
const downloadBackupBtn = document.getElementById('downloadBackupBtn');
const restoreBackupBtn = document.getElementById('restoreBackupBtn');
const backupFileInput = document.getElementById('backupFileInput');
const backupInfo = document.getElementById('backupInfo');
const logoutBtn = document.getElementById('logoutBtn');

// Load kids on page load
document.addEventListener('DOMContentLoaded', () => {
    loadKids();
});

// Event Listeners
newKidBtn.addEventListener('click', () => {
    kidModal.classList.remove('hidden');
});

cancelBtn.addEventListener('click', () => {
    kidModal.classList.add('hidden');
    kidForm.reset();
});

kidForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    await createKid();
});

logoutBtn.addEventListener('click', async () => {
    await logoutParent();
});

// API Functions
async function loadKids() {
    try {
        showError('');
        const response = await fetch(`${API_BASE}/kids`);

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const kids = await response.json();
        displayKids(kids);
    } catch (error) {
        console.error('Error loading kids:', error);
        showError('Failed to load kids. Make sure the backend server is running on port 5001.');
    }
}

async function createKid() {
    try {
        const name = document.getElementById('kidName').value;
        const birthday = document.getElementById('kidBirthday').value;

        // Validate birthday format (YYYY-MM-DD)
        const validationResult = validateBirthday(birthday);
        console.log('Validation result for', birthday, ':', validationResult);
        if (!validationResult) {
            showError('Invalid birthday format! Please use YYYY-MM-DD (e.g., 2015-06-15)');
            return;
        }

        const response = await fetch(`${API_BASE}/kids`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ name, birthday }),
        });

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const newKid = await response.json();
        console.log('Kid created:', newKid);

        // Close modal and reload
        kidModal.classList.add('hidden');
        kidForm.reset();
        await loadKids();
    } catch (error) {
        console.error('Error creating kid:', error);
        showError('Failed to create kid. Please try again.');
    }
}

async function deleteKid(kidId, kidName) {
    if (!confirm(`Are you sure you want to delete ${kidName}? This will delete all their data.`)) {
        return;
    }

    try {
        const response = await fetch(`${API_BASE}/kids/${kidId}`, {
            method: 'DELETE',
        });

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        await loadKids();
    } catch (error) {
        console.error('Error deleting kid:', error);
        showError('Failed to delete kid. Please try again.');
    }
}

async function logoutParent() {
    try {
        await fetch(`${API_BASE}/parent-auth/logout`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({})
        });
    } catch (error) {
        // ignore and continue redirect
    } finally {
        window.location.href = '/';
    }
}

// UI Functions
function displayKids(kids) {
    if (kids.length === 0) {
        kidsList.innerHTML = `
            <div class="empty-state">
                <h3>No kids yet</h3>
                <p>Click "Add New Kid" to add your first learner!</p>
            </div>
        `;
        return;
    }

    kidsList.innerHTML = kids.map(kid => {
        const age = calculateAge(kid.birthday);
        return `
            <div class="kid-card">
                <h3>${kid.name}</h3>
                <p class="age">Age: ${age} years old</p>
                <p class="age">Birthday: ${formatDate(kid.birthday)}</p>
                <div class="practice-config-list" onclick="event.stopPropagation()">
                    <div class="practice-config-row">
                        <input
                            class="daily-toggle-checkbox"
                            type="checkbox"
                            ${kid.dailyPracticeChineseEnabled ? 'checked' : ''}
                            onchange="toggleDailyPractice('${kid.id}', 'dailyPracticeChineseEnabled', this.checked)"
                            onclick="event.stopPropagation()"
                        >
                        <a class="tab-link secondary practice-manage-btn" href="/kid-manage.html?id=${kid.id}">📝 Manage Reading</a>
                    </div>

                    <div class="practice-config-row">
                        <input
                            class="daily-toggle-checkbox"
                            type="checkbox"
                            ${kid.dailyPracticeWritingEnabled ? 'checked' : ''}
                            onchange="toggleDailyPractice('${kid.id}', 'dailyPracticeWritingEnabled', this.checked)"
                            onclick="event.stopPropagation()"
                        >
                        <a class="tab-link secondary practice-manage-btn" href="/kid-writing-manage.html?id=${kid.id}">✍️ Manage Writing</a>
                    </div>

                    <div class="practice-config-row">
                        <input
                            class="daily-toggle-checkbox"
                            type="checkbox"
                            ${kid.dailyPracticeMathEnabled ? 'checked' : ''}
                            onchange="toggleDailyPractice('${kid.id}', 'dailyPracticeMathEnabled', this.checked)"
                            onclick="event.stopPropagation()"
                        >
                        <a class="tab-link secondary practice-manage-btn" href="/kid-math-manage.html?id=${kid.id}">➗ Manage Math</a>
                    </div>
                </div>
                <button class="delete-btn" onclick="deleteKid('${kid.id}', '${kid.name}')">
                    🗑️ Delete
                </button>
            </div>
        `;
    }).join('');
}

async function toggleDailyPractice(kidId, field, enabled) {
    try {
        const response = await fetch(`${API_BASE}/kids/${kidId}`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                [field]: enabled
            }),
        });

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
    } catch (error) {
        console.error('Error updating daily practice setting:', error);
        showError('Failed to update daily practice setting. Please try again.');
        await loadKids();
    }
}

function calculateAge(birthday) {
    const today = new Date();
    const birthDate = parseDateOnly(birthday);
    if (!birthDate) {
        return 0;
    }
    let age = today.getFullYear() - birthDate.getFullYear();
    const monthDiff = today.getMonth() - birthDate.getMonth();

    if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
        age--;
    }

    return age;
}

function formatDate(dateString) {
    const date = parseDateOnly(dateString);
    if (!date) {
        return dateString || '-';
    }
    return date.toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric'
    });
}

function parseDateOnly(dateString) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateString || ''));
    if (!match) {
        return null;
    }
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const date = new Date(year, month - 1, day);
    if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
        return null;
    }
    return date;
}

function validateBirthday(birthday) {
    console.log('Validating birthday:', birthday);

    // Check format YYYY-MM-DD
    const datePattern = /^\d{4}-\d{2}-\d{2}$/;
    if (!datePattern.test(birthday)) {
        console.log('Failed: Invalid format');
        return false;
    }

    // Parse the date components
    const [year, month, day] = birthday.split('-').map(Number);
    console.log('Parsed:', { year, month, day });

    // Check if month and day are in valid ranges
    if (month < 1 || month > 12 || day < 1 || day > 31) {
        console.log('Failed: Month or day out of range');
        return false;
    }

    // Create date in local timezone to avoid UTC issues
    const date = new Date(year, month - 1, day);
    console.log('Created date:', date);
    console.log('Date components:', date.getFullYear(), date.getMonth() + 1, date.getDate());

    // Verify the date is valid (catches Feb 30, etc.)
    if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
        console.log('Failed: Date mismatch', {
            expected: { year, month, day },
            actual: { year: date.getFullYear(), month: date.getMonth() + 1, day: date.getDate() }
        });
        return false;
    }

    // Check if birthday is not in the future
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    console.log('Today:', today, 'Birthday:', date);
    if (date > today) {
        console.log('Failed: Future date');
        return false;
    }

    // Check if birthday is reasonable (not more than 150 years ago)
    const minDate = new Date();
    minDate.setFullYear(minDate.getFullYear() - 150);
    if (date < minDate) {
        console.log('Failed: Too old');
        return false;
    }

    console.log('Validation passed!');
    return true;
}

function showError(message) {
    if (message) {
        errorMessage.textContent = message;
        errorMessage.classList.remove('hidden');
    } else {
        errorMessage.classList.add('hidden');
    }
}

// Backup and Restore Functions
downloadBackupBtn.addEventListener('click', async () => {
    try {
        showError('');
        downloadBackupBtn.disabled = true;
        downloadBackupBtn.textContent = '⏳ Creating backup...';

        const response = await fetch(`${API_BASE}/backup/download`);

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        // Get filename from response headers or use default
        const contentDisposition = response.headers.get('Content-Disposition');
        let filename = 'kids_learning_backup.zip';
        if (contentDisposition) {
            const matches = /filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/.exec(contentDisposition);
            if (matches && matches[1]) {
                filename = matches[1].replace(/['"]/g, '');
            }
        }

        // Download the file
        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
        document.body.removeChild(a);

        backupInfo.textContent = '✅ Backup downloaded successfully!';
        setTimeout(() => { backupInfo.textContent = ''; }, 5000);

    } catch (error) {
        console.error('Error downloading backup:', error);
        showError('Failed to download backup. Please try again.');
    } finally {
        downloadBackupBtn.disabled = false;
        downloadBackupBtn.textContent = '⬇️ Download Backup';
    }
});

restoreBackupBtn.addEventListener('click', () => {
    if (confirm('⚠️ Warning: Restoring a backup will replace ALL current data. Are you sure you want to continue?')) {
        backupFileInput.click();
    }
});

backupFileInput.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    try {
        showError('');
        restoreBackupBtn.disabled = true;
        restoreBackupBtn.textContent = '⏳ Restoring...';

        const formData = new FormData();
        formData.append('backup', file);

        const response = await fetch(`${API_BASE}/backup/restore`, {
            method: 'POST',
            body: formData
        });

        const result = await response.json();

        if (!response.ok) {
            throw new Error(result.error || `HTTP error! status: ${response.status}`);
        }

        backupInfo.textContent = '✅ Backup restored successfully!';
        backupFileInput.value = ''; // Clear file input

        // Reload the page after successful restore
        setTimeout(() => {
            window.location.reload();
        }, 2000);

    } catch (error) {
        console.error('Error restoring backup:', error);
        showError(`Failed to restore backup: ${error.message}`);
        backupFileInput.value = ''; // Clear file input
    } finally {
        restoreBackupBtn.disabled = false;
        restoreBackupBtn.textContent = '⬆️ Restore Backup';
    }
});

// Load backup info on page load
async function loadBackupInfo() {
    try {
        const response = await fetch(`${API_BASE}/backup/info`);
        if (response.ok) {
            const info = await response.json();
            if (info.total_files > 0) {
                backupInfo.textContent = `📊 ${info.total_files} files, ${info.total_size_mb} MB`;
            }
        }
    } catch (error) {
        console.error('Error loading backup info:', error);
    }
}

// Load backup info after kids are loaded
const originalLoadKids = loadKids;
loadKids = async function() {
    await originalLoadKids();
    await loadBackupInfo();
};
