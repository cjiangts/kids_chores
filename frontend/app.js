// API Configuration
// Use the same host that served the page (works on phone and computer)
const API_BASE = `${window.location.origin}/api`;

// DOM Elements
const kidsList = document.getElementById('kidsList');
const errorMessage = document.getElementById('errorMessage');
const familyLogoutLink = document.getElementById('familyLogoutLink');
const {
    getOptedInDeckCategoryKeys,
    getCategoryValueMap,
    getCategoryRawValueMap,
    normalizeCategoryKey,
} = window.DeckCategoryCommon;
const {
    buildCategoryStarsModel,
} = window.PracticeStarBadgeCommon || {};

if (!buildCategoryStarsModel) {
    throw new Error('practice-star-badge-common.js is required for app');
}

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
        const optedInKeys = getOptedInDeckCategoryKeys(kid);
        const dailyCompletedByCategory = getCategoryValueMap(kid?.dailyCompletedByDeckCategory);
        const dailyStarTiersByCategory = getCategoryRawValueMap(kid?.dailyStarTiersByDeckCategory);
        const dailyPercentByCategory = getCategoryValueMap(kid?.dailyPercentByDeckCategory);
        const practiceTargetByCategory = getCategoryValueMap(kid?.practiceTargetByDeckCategory);

        const enabledRows = [];
        optedInKeys.forEach((categoryKey) => {
            const targetCount = Number(practiceTargetByCategory[categoryKey] || 0);
            const completedCount = Number(dailyCompletedByCategory[categoryKey] || 0);
            const isAssigned = targetCount > 0 || completedCount > 0;
            if (!isAssigned) {
                return;
            }
            const starsModel = buildCategoryStarsModel({
                categoryKey,
                dailyStarTiersByCategory,
                dailyCompletedByCategory,
                dailyPercentByCategory,
                normalizeCategoryKey,
                doneMarkClass: 'daily-stars-done-mark',
                doneMarkText: '✅ Done',
            });
            enabledRows.push({
                label: formatDeckCategoryLabel(categoryKey),
                starsHtml: starsModel.starsHtml,
                isStackedBadgeLayout: starsModel.isStackedBadgeLayout,
                doneMarkHtml: starsModel.doneMarkHtml,
            });
        });

        const dailyPracticeBadge = enabledRows.length > 0
            ? `<div class="daily-stars">${
                enabledRows.map((row) => (
                    `<div class="daily-stars-row ${row.isStackedBadgeLayout ? 'daily-stars-row-stacked' : 'daily-stars-row-inline'}">
                        <span class="daily-stars-label practice-star-badge">${escapeHtml(row.label)}:</span>
                        <span class="daily-stars-strip">${row.starsHtml}${row.doneMarkHtml}</span>
                    </div>`
                )).join('')
            }</div>`
            : `<div class="daily-stars disabled">No daily practices assigned</div>`;
        return `
            <div class="kid-card" onclick="selectKid('${kid.id}')">
                <h3>${escapeHtml(kid.name)}</h3>
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
