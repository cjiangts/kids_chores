// API Configuration
// Use the same host that served the page (works on phone and computer)
const API_BASE = `${window.location.origin}/api`;

// DOM Elements
const kidsList = document.getElementById('kidsList');
const errorMessage = document.getElementById('errorMessage');
const familyLogoutLink = document.getElementById('familyLogoutLink');

// Load kids on page load
document.addEventListener('DOMContentLoaded', () => {
    loadKids();
});

if (familyLogoutLink) {
    familyLogoutLink.addEventListener('click', async (event) => {
        event.preventDefault();
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
    });
}

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
                <p>Click "New Kid" to add your first learner!</p>
            </div>
        `;
        return;
    }

    kidsList.innerHTML = kids.map(kid => {
        const age = calculateAge(kid.birthday);
        const chineseStars = Number.isInteger(kid.dailyCompletedChineseCountToday) ? kid.dailyCompletedChineseCountToday : 0;
        const mathStars = Number.isInteger(kid.dailyCompletedMathCountToday) ? kid.dailyCompletedMathCountToday : 0;
        const writingStars = Number.isInteger(kid.dailyCompletedWritingCountToday) ? kid.dailyCompletedWritingCountToday : 0;
        const lessonReadingStars = Number.isInteger(kid.dailyCompletedLessonReadingCountToday) ? kid.dailyCompletedLessonReadingCountToday : 0;

        const readingSessionCount = Number.parseInt(kid.sessionCardCount, 10);
        const writingSessionCount = Number.parseInt(kid.writingSessionCardCount, 10);
        const mathSessionCount = getMathSessionCount(kid);
        const lessonMa3Unit1Count = Number.parseInt(kid.lessonReadingDeckMa3Unit1Count, 10);
        const lessonMa3Unit2Count = Number.parseInt(kid.lessonReadingDeckMa3Unit2Count, 10);
        const lessonMa3Unit3Count = Number.parseInt(kid.lessonReadingDeckMa3Unit3Count, 10);
        const lessonReadingSessionCount = (Number.isInteger(lessonMa3Unit1Count) ? lessonMa3Unit1Count : 0)
            + (Number.isInteger(lessonMa3Unit2Count) ? lessonMa3Unit2Count : 0)
            + (Number.isInteger(lessonMa3Unit3Count) ? lessonMa3Unit3Count : 0);

        const enabledLines = [];
        if (Number.isInteger(readingSessionCount) && readingSessionCount > 0) {
            enabledLines.push(`Chinese Characters: ${chineseStars > 0 ? '⭐'.repeat(chineseStars) : '-'}`);
        }
        if (Number.isInteger(writingSessionCount) && writingSessionCount > 0) {
            enabledLines.push(`Chinese Writing: ${writingStars > 0 ? '⭐'.repeat(writingStars) : '-'}`);
        }
        if (mathSessionCount > 0) {
            enabledLines.push(`Math: ${mathStars > 0 ? '⭐'.repeat(mathStars) : '-'}`);
        }
        if (lessonReadingSessionCount > 0) {
            enabledLines.push(`Chinese Reading: ${lessonReadingStars > 0 ? '⭐'.repeat(lessonReadingStars) : '-'}`);
        }

        const dailyPracticeBadge = enabledLines.length > 0
            ? `<p class="daily-stars">${enabledLines.join('<br>')}</p>`
            : `<p class="daily-stars disabled">No daily practices assigned</p>`;
        return `
            <div class="kid-card" onclick="selectKid('${kid.id}', '${escapeHtml(kid.name)}')">
                <h3>${escapeHtml(kid.name)}</h3>
                <p class="age">${age} years old</p>
                ${dailyPracticeBadge}
            </div>
        `;
    }).join('');
}

function selectKid(kidId, kidName) {
    // Navigate to kid's profile page
    window.location.href = `/kid.html?id=${kidId}`;
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
