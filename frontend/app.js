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
} = window.DeckCategoryCommon;

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

function clampPercent(value, fallback = 100) {
    const raw = Number.parseFloat(value);
    if (!Number.isFinite(raw)) return fallback;
    return Math.max(0, Math.min(100, Math.round(raw)));
}

function renderProgressBadgeByTier(tier, fillPercent, isLatestTier) {
    const normalizedTier = String(tier || '').trim().toLowerCase();
    const effectiveFill = clampPercent(isLatestTier ? fillPercent : 100, 100);
    if (normalizedTier === 'silver') {
        return '<span class="progress-badge-icon silver" aria-hidden="true" style="--badge-fill-pct:100%"></span>';
    }
    if (normalizedTier === 'half_silver' || effectiveFill < 100) {
        return `<span class="progress-badge-icon silver" aria-hidden="true" style="--badge-fill-pct:${effectiveFill}%"></span>`;
    }
    return `<span class="progress-badge-icon gold" aria-hidden="true" style="--badge-fill-pct:${effectiveFill}%"></span>`;
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
            const tiersFromPayload = Array.isArray(dailyStarTiersByCategory[categoryKey])
                ? dailyStarTiersByCategory[categoryKey]
                    .map((tier) => String(tier || '').trim().toLowerCase())
                    .filter((tier) => tier === 'gold' || tier === 'silver' || tier === 'half_silver')
                : [];
            const fallbackTiers = Array.from({ length: completedCount > 0 ? completedCount : 0 }, () => 'gold');
            const tiers = tiersFromPayload.length > 0 ? tiersFromPayload : fallbackTiers;
            const rawPercent = Number.parseFloat(dailyPercentByCategory[categoryKey]);
            const percentValue = Number.isFinite(rawPercent) ? Math.max(0, Math.min(100, Math.round(rawPercent))) : 0;
            const lastTierIndex = Math.max(0, tiers.length - 1);
            const starsHtml = tiers.length > 0
                ? `<span class="progress-badge-strip">${tiers.map((tier, index) => (
                    renderProgressBadgeByTier(tier, percentValue, index === lastTierIndex)
                )).join('')}</span>`
                : '-';
            enabledRows.push({
                label: formatDeckCategoryLabel(categoryKey),
                starsHtml,
            });
        });

        const dailyPracticeBadge = enabledRows.length > 0
            ? `<div class="daily-stars">${
                enabledRows.map((row) => (
                    `<div class="daily-stars-row">
                        <span class="daily-stars-label practice-star-badge">${escapeHtml(row.label)}:</span>
                        <span class="daily-stars-strip">${row.starsHtml}</span>
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
