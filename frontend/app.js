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

function getOptedInDeckCategoryKeys(kid) {
    const keys = Array.isArray(kid?.optedInDeckCategoryKeys) ? kid.optedInDeckCategoryKeys : [];
    const normalized = keys
        .map((value) => String(value || '').trim().toLowerCase())
        .filter(Boolean);
    return [...new Set(normalized)];
}

function getCategoryValueMap(rawValue) {
    if (!rawValue || typeof rawValue !== 'object') {
        return {};
    }
    const normalized = {};
    Object.entries(rawValue).forEach(([rawKey, rawCount]) => {
        const key = String(rawKey || '').trim().toLowerCase();
        if (!key) {
            return;
        }
        const count = Number.parseInt(rawCount, 10);
        normalized[key] = Number.isInteger(count) ? Math.max(0, count) : 0;
    });
    return normalized;
}

function formatDeckCategoryLabel(categoryKey) {
    const key = String(categoryKey || '').trim();
    if (!key) {
        return 'Unknown';
    }
    return key
        .split('_')
        .filter(Boolean)
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join(' ');
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
        const optedInKeys = getOptedInDeckCategoryKeys(kid);
        const dailyCompletedByCategory = getCategoryValueMap(kid?.dailyCompletedByDeckCategory);
        const practiceTargetByCategory = getCategoryValueMap(kid?.practiceTargetByDeckCategory);

        const enabledLines = [];
        optedInKeys.forEach((categoryKey) => {
            const targetCount = Number(practiceTargetByCategory[categoryKey] || 0);
            const completedCount = Number(dailyCompletedByCategory[categoryKey] || 0);
            const isAssigned = targetCount > 0 || completedCount > 0;
            if (!isAssigned) {
                return;
            }
            enabledLines.push(
                `${formatDeckCategoryLabel(categoryKey)}: ${completedCount > 0 ? '⭐'.repeat(completedCount) : '-'}`
            );
        });

        const dailyPracticeBadge = enabledLines.length > 0
            ? `<p class="daily-stars">${enabledLines.join('<br>')}</p>`
            : `<p class="daily-stars disabled">No daily practices assigned</p>`;
        return `
            <div class="kid-card" onclick="selectKid('${kid.id}')">
                <h3>${escapeHtml(kid.name)}</h3>
                <p class="age">${age} years old</p>
                ${dailyPracticeBadge}
            </div>
        `;
    }).join('');
}

function selectKid(kidId) {
    // Navigate to kid's profile page
    window.location.href = `/kid-practice-home.html?id=${kidId}`;
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
