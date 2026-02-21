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
const kidBirthdayInput = document.getElementById('kidBirthday');
const kidNameInput = document.getElementById('kidName');
const manageDecksLink = document.getElementById('manageDecksLink');
let isCreatingKid = false;

// Load kids on page load
document.addEventListener('DOMContentLoaded', async () => {
    await applySuperFamilyUi();
    loadKids();
    bindBirthdayAutoFormat();
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

async function applySuperFamilyUi() {
    if (!manageDecksLink) {
        return;
    }
    try {
        const response = await fetch(`${API_BASE}/family-auth/status`);
        if (!response.ok) {
            manageDecksLink.classList.add('hidden');
            return;
        }
        const auth = await response.json().catch(() => ({}));
        manageDecksLink.classList.toggle('hidden', !Boolean(auth.isSuperFamily));
    } catch (error) {
        manageDecksLink.classList.add('hidden');
    }
}

// API Functions
async function loadKids() {
    try {
        showError('');
        kidsList.innerHTML = '<div class="empty-state"><p>Loading...</p></div>';
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
    if (isCreatingKid) {
        return;
    }
    const submitBtn = kidForm.querySelector('button[type="submit"]');
    try {
        isCreatingKid = true;
        const name = document.getElementById('kidName').value;
        const birthday = document.getElementById('kidBirthday').value;

        // Validate birthday format (YYYY-MM-DD)
        const validationResult = validateBirthday(birthday);
        if (!validationResult) {
            showError('');
            window.alert('Invalid birthday format! Please use YYYY-MM-DD (e.g., 2015-06-15)');
            if (kidBirthdayInput) {
                kidBirthdayInput.focus();
            }
            return;
        }

        submitBtn.disabled = true;
        submitBtn.textContent = 'Creating...';
        if (kidNameInput) {
            kidNameInput.disabled = true;
        }
        if (kidBirthdayInput) {
            kidBirthdayInput.disabled = true;
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
    } finally {
        isCreatingKid = false;
        submitBtn.disabled = false;
        submitBtn.textContent = 'Save';
        if (kidNameInput) {
            kidNameInput.disabled = false;
        }
        if (kidBirthdayInput) {
            kidBirthdayInput.disabled = false;
        }
    }
}

async function deleteKid(kidId, kidName) {
    try {
        const result = await window.PracticeManageCommon.requestWithPasswordDialog(
            `deleting ${kidName}`,
            (password) => fetch(`${API_BASE}/kids/${kidId}`, {
                method: 'DELETE',
                headers: window.PracticeManageCommon.buildPasswordHeaders(password, false),
            }),
            { warningMessage: 'This will permanently delete this kid and all practice data.' }
        );
        if (result.cancelled) {
            return;
        }
        if (!result.ok) {
            throw new Error(result.error || 'Failed to delete kid.');
        }

        await loadKids();
    } catch (error) {
        console.error('Error deleting kid:', error);
        showError(error.message || 'Failed to delete kid. Please try again.');
    }
}

async function goToLatestLessonReadingSession(kidId) {
    try {
        showError('');
        const response = await fetch(`${API_BASE}/kids/${kidId}/report/lesson-reading/next-to-grade`);
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }
        const data = await response.json().catch(() => ({}));
        const targetSessionId = Number(data.session_id);
        if (!Number.isFinite(targetSessionId) || targetSessionId <= 0) {
            const latestSessionId = Number(data.latest_session_id);
            if (Number.isFinite(latestSessionId) && latestSessionId > 0) {
                showError('No Chinese Reading cards need grading right now.');
            } else {
                showError('No Chinese Reading session found yet for this kid.');
            }
            return;
        }
        window.location.href = `/kid-session-report.html?id=${encodeURIComponent(kidId)}&sessionId=${encodeURIComponent(targetSessionId)}`;
    } catch (error) {
        console.error('Error opening latest Chinese Reading session:', error);
        showError('Failed to open latest Chinese Reading session.');
    }
}

function getMathSessionCount(kid) {
    const sharedMathSessionCount = Number.parseInt(kid?.sharedMathSessionCardCount, 10);
    if (Number.isInteger(sharedMathSessionCount)) {
        return Math.max(0, sharedMathSessionCount);
    }

    const mathWithin10Count = Number.parseInt(kid?.mathDeckWithin10Count, 10);
    const mathWithin20Count = Number.parseInt(kid?.mathDeckWithin20Count, 10);
    const mathSubWithin10Count = Number.parseInt(kid?.mathDeckSubWithin10Count, 10);
    const mathSubWithin20Count = Number.parseInt(kid?.mathDeckSubWithin20Count, 10);
    return (Number.isInteger(mathWithin10Count) ? Math.max(0, mathWithin10Count) : 0)
        + (Number.isInteger(mathWithin20Count) ? Math.max(0, mathWithin20Count) : 0)
        + (Number.isInteger(mathSubWithin10Count) ? Math.max(0, mathSubWithin10Count) : 0)
        + (Number.isInteger(mathSubWithin20Count) ? Math.max(0, mathSubWithin20Count) : 0);
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
        const lessonMa3Unit1Count = Number.parseInt(kid.lessonReadingDeckMa3Unit1Count, 10);
        const lessonMa3Unit2Count = Number.parseInt(kid.lessonReadingDeckMa3Unit2Count, 10);
        const lessonMa3Unit3Count = Number.parseInt(kid.lessonReadingDeckMa3Unit3Count, 10);
        const safeReadingCount = Number.isInteger(readingCount) ? Math.max(0, readingCount) : 0;
        const safeWritingCount = Number.isInteger(writingCount) ? Math.max(0, writingCount) : 0;
        const safeMathCount = getMathSessionCount(kid);
        const safeLessonReadingCount = (Number.isInteger(lessonMa3Unit1Count) ? Math.max(0, lessonMa3Unit1Count) : 0)
            + (Number.isInteger(lessonMa3Unit2Count) ? Math.max(0, lessonMa3Unit2Count) : 0)
            + (Number.isInteger(lessonMa3Unit3Count) ? Math.max(0, lessonMa3Unit3Count) : 0);

        const readingLabel = `📖 Chinese Characters (${safeReadingCount}/day)`;
        const writingLabel = `✍️ Chinese Writing (${safeWritingCount}/day)`;
        const mathLabel = `➗ Math (${safeMathCount}/day)`;
        const lessonReadingLabel = `📚 Chinese Reading (${safeLessonReadingCount}/day)`;
        const showChineseReadingReviewBtn = Boolean(kid.hasChineseReadingToReview);
        const reviewChineseReadingRow = showChineseReadingReviewBtn
            ? `<div class="practice-config-row">
                        <button class="tab-link review-reading-btn" onclick="goToLatestLessonReadingSession('${kid.id}')">🎧 Review Chinese Reading</button>
                    </div>`
            : '';
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
                        <a class="tab-link secondary practice-manage-btn" href="/kid-math-manage-v2.html?id=${kid.id}">${mathLabel}</a>
                    </div>
                    <div class="practice-config-row">
                        <a class="tab-link secondary practice-manage-btn" href="/kid-lesson-reading-manage.html?id=${kid.id}">${lessonReadingLabel}</a>
                    </div>
                    <div class="practice-config-row">
                        <a class="tab-link report-btn" href="/kid-report.html?id=${kid.id}">📊 Report</a>
                    </div>
                    ${reviewChineseReadingRow}
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

function bindBirthdayAutoFormat() {
    if (!kidBirthdayInput) {
        return;
    }
    kidBirthdayInput.addEventListener('input', () => {
        const digits = String(kidBirthdayInput.value || '').replace(/\D/g, '').slice(0, 8);
        let formatted = digits;
        if (digits.length > 4) {
            formatted = `${digits.slice(0, 4)}-${digits.slice(4)}`;
        }
        if (digits.length > 6) {
            formatted = `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6)}`;
        }
        kidBirthdayInput.value = formatted;
    });
}
