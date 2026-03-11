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
    getDeckCategoryMetaMap,
    getCategoryDisplayName,
    getCategoryEmoji,
    normalizeCategoryKey,
} = window.DeckCategoryCommon;
const {
    buildCategoryStarsModel,
} = window.PracticeStarBadgeCommon || {};
const VALID_BEHAVIOR_TYPES = new Set(['type_i', 'type_ii', 'type_iii']);

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

function toSafeNonNegativeInt(value) {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed) || parsed < 0) {
        return 0;
    }
    return parsed;
}

function hasPositiveDailyTarget(categoryKey, categoryMetaMap, practiceTargetByCategory) {
    const key = normalizeCategoryKey(categoryKey);
    if (!key) {
        return false;
    }
    const meta = categoryMetaMap?.[key] || {};
    const behaviorType = String(meta.behavior_type || '').trim().toLowerCase();
    if (!VALID_BEHAVIOR_TYPES.has(behaviorType)) {
        return false;
    }
    return toSafeNonNegativeInt(practiceTargetByCategory?.[key]) > 0;
}

function renderStarTokenSetHtml(starCount, { starClass, overflowClass }) {
    const safeCount = Math.max(0, Number.parseInt(starCount, 10) || 0);
    if (safeCount <= 0) {
        return '';
    }
    if (safeCount <= 5) {
        return Array.from({ length: safeCount }, () => (
            `<span class="${starClass}" aria-hidden="true">★</span>`
        )).join('');
    }
    return `
        <span class="${starClass}" aria-hidden="true">★</span>
        <span class="${overflowClass}" aria-label="${safeCount} stars">x${safeCount}</span>
    `;
}

function buildFamilyProgressModel({
    starsModel,
    configuredTargetCount,
    latestTargetCount,
    latestTriedCount,
    latestRightCount,
}) {
    const safeConfiguredTarget = toSafeNonNegativeInt(configuredTargetCount);
    const safeLatestTarget = toSafeNonNegativeInt(latestTargetCount);
    const safeTarget = safeLatestTarget > 0 ? safeLatestTarget : safeConfiguredTarget;
    const latestPercent = Number.isFinite(starsModel?.latestPercentValue)
        ? Math.max(0, Math.min(100, Math.round(starsModel.latestPercentValue)))
        : 0;
    const tiers = Array.isArray(starsModel?.tiers)
        ? starsModel.tiers.map((tier) => String(tier || '').trim().toLowerCase())
        : [];
    let starCount = tiers.filter((tier) => tier !== 'half_silver').length;
    if (tiers.length > 0) {
        const latestTier = tiers[tiers.length - 1];
        const latestPercent = Number.isFinite(starsModel?.latestPercentValue)
            ? Math.max(0, Math.min(100, Math.round(starsModel.latestPercentValue)))
            : 0;
        if (latestTier !== 'half_silver' && latestPercent < 100) {
            starCount = Math.max(0, starCount - 1);
        }
    }
    const isWorkingOnNextStar = starCount > 0 && latestPercent < 100;
    const isDoneToday = Boolean(starsModel?.isDoneToday);
    const hasStarted = isDoneToday || latestPercent > 0;

    let statusClass = 'not-started';
    let statusText = 'Not started';
    if (isDoneToday) {
        statusClass = 'done';
        statusText = 'Done';
    } else if (latestPercent > 0) {
        statusClass = 'in-progress';
        statusText = 'In progress';
    }

    const safeTriedFromApi = toSafeNonNegativeInt(latestTriedCount);
    const safeRightFromApi = toSafeNonNegativeInt(latestRightCount);
    let seenCount = safeTriedFromApi;
    let masteredCount = safeRightFromApi;
    if (safeTarget > 0) {
        seenCount = Math.min(safeTarget, Math.max(safeTriedFromApi, safeRightFromApi));
        masteredCount = Math.min(safeTarget, safeRightFromApi);
    } else {
        seenCount = 0;
        masteredCount = 0;
    }
    const redoCount = Math.max(0, seenCount - masteredCount);
    const unseenCount = safeTarget > 0
        ? Math.max(0, safeTarget - seenCount)
        : 0;

    const seenPercent = safeTarget > 0
        ? Math.max(0, Math.min(100, (seenCount / safeTarget) * 100))
        : (isDoneToday ? 100 : latestPercent);
    const masteredPercent = safeTarget > 0
        ? Math.max(0, Math.min(100, (masteredCount / safeTarget) * 100))
        : (isDoneToday ? 100 : seenPercent);
    const redoPercent = safeTarget > 0
        ? Math.max(0, Math.min(100, (redoCount / safeTarget) * 100))
        : 0;
    const unseenPercent = Math.max(0, 100 - seenPercent);

    let summaryText = 'Not started';
    if (hasStarted && safeTarget > 0) {
        summaryText = `${masteredCount} mastered · ${redoCount} redo · ${seenCount}/${safeTarget} seen`;
    } else if (isDoneToday) {
        summaryText = 'Done';
    } else if (hasStarted) {
        summaryText = `${latestPercent}% done`;
    }

    return {
        statusClass,
        statusText,
        summaryText,
        isDoneToday,
        starCount,
        isWorkingOnNextStar,
        targetCount: safeTarget,
        masteredCount,
        redoCount,
        unseenCount,
        segments: {
            mastered: Math.max(0, Math.min(100, masteredPercent)),
            redo: Math.max(0, Math.min(100, redoPercent)),
            unseen: Math.max(0, Math.min(100, unseenPercent)),
        },
    };
}

// UI Functions
function displayKids(kids) {
    if (kids.length === 0) {
        kidsList.innerHTML = `
            <div class="redesign-empty-state">
                <h3>No kids yet</h3>
                <p>Click "New Kid" to add your first learner!</p>
            </div>
        `;
        return;
    }

    kidsList.innerHTML = kids.map(kid => {
        const kidIdText = String(kid?.id ?? '').trim();
        const optedInKeys = getOptedInDeckCategoryKeys(kid);
        const categoryMetaMap = getDeckCategoryMetaMap(kid);
        const dailyCompletedByCategory = getCategoryValueMap(kid?.dailyCompletedByDeckCategory);
        const dailyStarTiersByCategory = getCategoryRawValueMap(kid?.dailyStarTiersByDeckCategory);
        const dailyPercentByCategory = getCategoryValueMap(kid?.dailyPercentByDeckCategory);
        const dailyTargetByCategory = getCategoryValueMap(kid?.dailyTargetByDeckCategory);
        const dailyTriedByCategory = getCategoryValueMap(kid?.dailyTriedByDeckCategory);
        const dailyRightByCategory = getCategoryValueMap(kid?.dailyRightByDeckCategory);
        const practiceTargetByCategory = getCategoryValueMap(kid?.practiceTargetByDeckCategory);

        const enabledRows = [];
        let starsTotal = 0;
        optedInKeys.forEach((categoryKey) => {
            if (!hasPositiveDailyTarget(categoryKey, categoryMetaMap, practiceTargetByCategory)) {
                return;
            }
            const targetCount = toSafeNonNegativeInt(practiceTargetByCategory[categoryKey]);
            const starsModel = buildCategoryStarsModel({
                categoryKey,
                dailyStarTiersByCategory,
                dailyCompletedByCategory,
                dailyPercentByCategory,
                normalizeCategoryKey,
                doneMarkClass: 'practice-done-mark',
                doneMarkText: '✅ Done',
            });
            const displayName = getCategoryDisplayName(categoryKey, categoryMetaMap) || formatDeckCategoryLabel(categoryKey);
            const emoji = getCategoryEmoji(categoryKey, categoryMetaMap) || '🧩';
            const progressModel = buildFamilyProgressModel({
                starsModel,
                configuredTargetCount: targetCount,
                latestTargetCount: dailyTargetByCategory[categoryKey],
                latestTriedCount: dailyTriedByCategory[categoryKey],
                latestRightCount: dailyRightByCategory[categoryKey],
            });
            starsTotal += progressModel.starCount;
            enabledRows.push({
                label: displayName,
                emoji,
                progressModel,
            });
        });
        const doneCount = enabledRows.filter((row) => row.progressModel.isDoneToday).length;
        const subjectRowsHtml = enabledRows.length > 0
            ? enabledRows.map((row) => {
                const statusClass = row.progressModel.statusClass;
                const rightStatusHtml = row.progressModel.isDoneToday
                    ? renderStarTokenSetHtml(row.progressModel.starCount, {
                        starClass: 'redesign-status-token star',
                        overflowClass: 'redesign-status-token overflow',
                    })
                    : `<span class="redesign-status-pill ${statusClass}">${row.progressModel.statusText}</span>`;
                const noteHtml = row.progressModel.targetCount > 0
                    ? `<div class="redesign-subject-note redesign-subject-legend">
                        <span class="redesign-subject-legend-item">
                            <span class="redesign-subject-legend-dot mastered" aria-hidden="true"></span>
                            ${escapeHtml(String(row.progressModel.masteredCount))} mastered
                        </span>
                        <span class="redesign-subject-legend-item">
                            <span class="redesign-subject-legend-dot redo" aria-hidden="true"></span>
                            ${escapeHtml(String(row.progressModel.redoCount))} redo
                        </span>
                        <span class="redesign-subject-legend-item">
                            <span class="redesign-subject-legend-dot unseen" aria-hidden="true"></span>
                            ${escapeHtml(String(row.progressModel.unseenCount))} out of ${escapeHtml(String(row.progressModel.targetCount))} unseen
                        </span>
                    </div>`
                    : `<div class="redesign-subject-note">${escapeHtml(row.progressModel.summaryText)}</div>`;
                return `<div class="redesign-subject-row ${statusClass}">
                    <div class="redesign-subject-main">
                        <div class="redesign-subject-title">
                            <span class="redesign-subject-emoji">${escapeHtml(row.emoji)}</span>
                            <span class="redesign-subject-name">${escapeHtml(row.label)}</span>
                        </div>
                    </div>
                    <div class="redesign-subject-right">
                        ${rightStatusHtml}
                    </div>
                    ${noteHtml}
                    <div class="redesign-progress-wrap">
                        <div class="redesign-progress-track">
                            <span class="redesign-progress-seg mastered" style="width:${row.progressModel.segments.mastered}%"></span>
                            <span class="redesign-progress-seg redo" style="width:${row.progressModel.segments.redo}%"></span>
                            <span class="redesign-progress-seg unseen" style="width:${row.progressModel.segments.unseen}%"></span>
                        </div>
                    </div>
                </div>`;
            }).join('')
            : '<div class="redesign-subject-row"><div class="redesign-subject-main"><div class="redesign-subject-title"><span class="redesign-subject-name">No daily practices assigned</span></div></div></div>';

        const summaryText = enabledRows.length > 0
            ? `${doneCount}/${enabledRows.length} done`
            : 'No daily practices';

        return `
            <div class="redesign-kid-card" onclick="selectKid('${kid.id}')">
                <div class="redesign-kid-top">
                    <div>
                        <h3 class="redesign-kid-name">${escapeHtml(kid.name)}</h3>
                        <div class="redesign-kid-sub">${escapeHtml(summaryText)}</div>
                    </div>
                    <div class="redesign-star-total">
                        <span>⭐</span>
                        <span>${starsTotal}</span>
                    </div>
                </div>
                <div class="redesign-subject-list">
                    ${subjectRowsHtml}
                </div>
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
