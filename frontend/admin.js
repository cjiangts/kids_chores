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
        const readingCount = Number.parseInt(kid.sessionCardCount, 10);
        const writingCount = Number.parseInt(kid.writingSessionCardCount, 10);
        const mathWithin10Count = Number.parseInt(kid.mathDeckWithin10Count, 10);
        const mathWithin20Count = Number.parseInt(kid.mathDeckWithin20Count, 10);
        const mathSubWithin10Count = Number.parseInt(kid.mathDeckSubWithin10Count, 10);
        const mathSubWithin20Count = Number.parseInt(kid.mathDeckSubWithin20Count, 10);
        const safeReadingCount = Number.isInteger(readingCount) ? Math.max(0, readingCount) : 0;
        const safeWritingCount = Number.isInteger(writingCount) ? Math.max(0, writingCount) : 0;
        const safeMathCount = (Number.isInteger(mathWithin10Count) ? Math.max(0, mathWithin10Count) : 0)
            + (Number.isInteger(mathWithin20Count) ? Math.max(0, mathWithin20Count) : 0)
            + (Number.isInteger(mathSubWithin10Count) ? Math.max(0, mathSubWithin10Count) : 0)
            + (Number.isInteger(mathSubWithin20Count) ? Math.max(0, mathSubWithin20Count) : 0);

        const readingLabel = `📖 Chinese Characters (${safeReadingCount}/day)`;
        const writingLabel = `✍️ Chinese Writing (${safeWritingCount}/day)`;
        const mathLabel = `➗ Math (${safeMathCount}/day)`;
        return `
            <div class="kid-card">
                <h3>${escapeHtml(kid.name)}</h3>
                <p class="age">Age: ${age} years old</p>
                <p class="age">Birthday: ${formatDate(kid.birthday)}</p>
                <div class="practice-config-list" onclick="event.stopPropagation()">
                    <div class="practice-config-row">
                        <a class="tab-link secondary practice-manage-btn" href="/kid-reading-manage.html?id=${kid.id}">${readingLabel}</a>
                    </div>

                    <div class="practice-config-row">
                        <a class="tab-link secondary practice-manage-btn" href="/kid-writing-manage.html?id=${kid.id}">${writingLabel}</a>
                    </div>

                    <div class="practice-config-row">
                        <a class="tab-link secondary practice-manage-btn" href="/kid-math-manage.html?id=${kid.id}">${mathLabel}</a>
                    </div>
                    <div class="practice-config-row">
                        <a class="tab-link report-btn" href="/kid-report.html?id=${kid.id}">📊 Report</a>
                    </div>
                </div>
                <button class="delete-btn" onclick="deleteKid('${kid.id}', '${escapeHtml(kid.name)}')">
                    🗑️ Delete
                </button>
            </div>
        `;
    }).join('');
}

function showError(message) {
    if (message) {
        errorMessage.textContent = message;
        errorMessage.classList.remove('hidden');
    } else {
        errorMessage.classList.add('hidden');
    }
}
