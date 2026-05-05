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
const VALID_BEHAVIOR_TYPES = new Set(['type_i', 'type_ii', 'type_iii', 'type_iv']);
const PARENT_NAV_CACHE_KEY_PREFIX = 'parent_admin_nav_cache_v1';
const CURRENT_FAMILY_ID_STORAGE_KEY = 'current_family_id_v1';
const PARENT_NAV_CACHE_TTL_MS = 2 * 60 * 1000;
const KID_AVATAR_TONE_COUNT = 6;

function getKidInitial(name) {
    const trimmed = String(name || '').trim();
    if (!trimmed) {
        return '?';
    }
    const codePoint = trimmed.codePointAt(0);
    return String.fromCodePoint(codePoint).toUpperCase();
}

function hashStringToIndex(value, modulo) {
    const s = String(value || '');
    let hash = 0;
    for (let i = 0; i < s.length; i++) {
        hash = ((hash << 5) - hash) + s.charCodeAt(i);
        hash |= 0;
    }
    const m = Math.max(1, modulo);
    return ((hash % m) + m) % m;
}

if (!buildCategoryStarsModel) {
    throw new Error('practice-star-badge-common.js is required for app');
}

// Load kids on page load
document.addEventListener('DOMContentLoaded', () => {
    loadKids({ preferNavigationCache: true });
});

if (familyLogoutLink) {
    familyLogoutLink.addEventListener('click', async (event) => {
        event.preventDefault();
        clearCurrentFamilyNavigationPointer();
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
async function loadKids(options = {}) {
    const preferNavigationCache = Boolean(options?.preferNavigationCache);
    let usedNavigationCache = false;
    try {
        showError('');
        if (preferNavigationCache) {
            const cachedKids = readKidsFromParentNavigationCache();
            if (cachedKids) {
                displayKids(cachedKids);
                usedNavigationCache = true;
            }
        }
        const response = await fetch(`${API_BASE}/kids`);

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const kids = await response.json();
        cacheKidsForParentNavigation(kids);
        displayKids(kids);
    } catch (error) {
        console.error('Error loading kids:', error);
        if (!usedNavigationCache) {
            kidsList.innerHTML = '';
            showError('Failed to load kids. Make sure the backend server is running on port 5001.');
        }
    }
}

function readKidsFromParentNavigationCache() {
    try {
        if (!window.sessionStorage) {
            return null;
        }
        const familyId = String(readCurrentFamilyNavigationPointer() || '').trim();
        if (!familyId) {
            return null;
        }
        const raw = window.sessionStorage.getItem(buildParentNavCacheKey(familyId));
        if (!raw) {
            return null;
        }
        const parsed = JSON.parse(raw);
        if (String(parsed?.familyId || '').trim() !== familyId) {
            return null;
        }
        const cachedAtMs = Number(parsed?.cachedAtMs || 0);
        if (!Number.isFinite(cachedAtMs) || cachedAtMs <= 0) {
            return null;
        }
        if ((Date.now() - cachedAtMs) > PARENT_NAV_CACHE_TTL_MS) {
            return null;
        }
        return Array.isArray(parsed?.kids) ? parsed.kids : null;
    } catch (error) {
        return null;
    }
}

function readCurrentFamilyNavigationPointer() {
    try {
        if (!window.sessionStorage) {
            return '';
        }
        return String(window.sessionStorage.getItem(CURRENT_FAMILY_ID_STORAGE_KEY) || '').trim();
    } catch (error) {
        return '';
    }
}

function cacheKidsForParentNavigation(kids) {
    try {
        if (!window.sessionStorage) {
            return;
        }
        const list = Array.isArray(kids) ? kids : [];
        const familyId = inferFamilyIdFromKids(list);
        if (!familyId) {
            return;
        }
        window.sessionStorage.setItem(buildParentNavCacheKey(familyId), JSON.stringify({
            familyId,
            cachedAtMs: Date.now(),
            kids: list,
        }));
        window.sessionStorage.setItem(CURRENT_FAMILY_ID_STORAGE_KEY, familyId);
    } catch (error) {
        // Best-effort cache only.
    }
}

function inferFamilyIdFromKids(kids) {
    const list = Array.isArray(kids) ? kids : [];
    for (const kid of list) {
        const familyId = String(kid?.familyId || '').trim();
        if (familyId) {
            return familyId;
        }
    }
    return '';
}

function buildParentNavCacheKey(familyId) {
    return `${PARENT_NAV_CACHE_KEY_PREFIX}::${String(familyId || '').trim()}`;
}

function clearCurrentFamilyNavigationPointer() {
    try {
        if (!window.sessionStorage) {
            return;
        }
        window.sessionStorage.removeItem(CURRENT_FAMILY_ID_STORAGE_KEY);
    } catch (error) {
        // ignore
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

function buildFamilyProgressModel({
    starsModel,
    behaviorType,
    configuredTargetCount,
    latestTargetCount,
    latestTriedCount,
    latestRightCount,
}) {
    const safeConfiguredTarget = toSafeNonNegativeInt(configuredTargetCount);
    const safeLatestTarget = toSafeNonNegativeInt(latestTargetCount);
    const safeTarget = safeLatestTarget > 0 ? safeLatestTarget : safeConfiguredTarget;
    const normalizedBehaviorType = String(behaviorType || '').trim().toLowerCase();
    const isTypeIII = normalizedBehaviorType === 'type_iii';
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
    const isTypeIIIRecordedComplete = isTypeIII && safeTarget > 0 && seenCount > 0 && unseenCount <= 0;
    const displayMasteredCount = isTypeIIIRecordedComplete ? seenCount : masteredCount;
    const displayRedoCount = isTypeIIIRecordedComplete ? 0 : redoCount;
    const isReview = !isTypeIIIRecordedComplete && safeTarget > 0 && seenCount > 0 && unseenCount <= 0 && redoCount > 0;
    const isFullyComplete = safeTarget > 0
        ? (isTypeIIIRecordedComplete || (seenCount > 0 && unseenCount <= 0 && redoCount <= 0))
        : Boolean(isDoneToday && latestPercent >= 100);
    const hasStarted = isFullyComplete || isReview || latestPercent > 0 || seenCount > 0;

    let statusClass = 'not-started';
    let statusText = 'Not started';
    if (isReview) {
        statusClass = 'review';
        statusText = 'Review';
    } else if (!isFullyComplete && hasStarted) {
        statusClass = 'in-progress';
        statusText = 'In progress';
    }

    const seenPercent = safeTarget > 0
        ? Math.max(0, Math.min(100, (seenCount / safeTarget) * 100))
        : (isDoneToday ? 100 : latestPercent);
    const masteredPercent = safeTarget > 0
        ? Math.max(0, Math.min(100, (displayMasteredCount / safeTarget) * 100))
        : (isDoneToday ? 100 : seenPercent);
    const redoPercent = safeTarget > 0
        ? Math.max(0, Math.min(100, (displayRedoCount / safeTarget) * 100))
        : 0;
    const unseenPercent = Math.max(0, 100 - seenPercent);

    let summaryText = 'Not started';
    if (hasStarted && safeTarget > 0) {
        summaryText = `${displayMasteredCount} mastered · ${displayRedoCount} redo · ${seenCount}/${safeTarget} seen`;
    } else if (isDoneToday) {
        summaryText = 'Done';
    } else if (hasStarted) {
        summaryText = `${latestPercent}% done`;
    }

    return {
        statusClass,
        statusText,
        summaryText,
        isFullyComplete,
        isReview,
        isDoneToday,
        starCount,
        isWorkingOnNextStar,
        targetCount: safeTarget,
        masteredCount: displayMasteredCount,
        redoCount: displayRedoCount,
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
                <p>Tap ${icon('user-cog', { size: 16 })} Parent Mode, then tap ${icon('user-round-plus', { size: 16 })} Add Kid to add your first learner.</p>
            </div>
        `;
        return;
    }

    kidsList.innerHTML = kids.map(kid => {
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
        let masteredTotal = 0;
        let redoTotal = 0;
        let unseenTotal = 0;
        let targetTotal = 0;
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
                doneMarkText: `${icon('check', { size: 16 })} Done`,
            });
            const displayName = getCategoryDisplayName(categoryKey, categoryMetaMap) || formatDeckCategoryLabel(categoryKey);
            const emoji = getCategoryEmoji(categoryKey, categoryMetaMap) || '🧩';
            const progressModel = buildFamilyProgressModel({
                starsModel,
                behaviorType: categoryMetaMap?.[categoryKey]?.behavior_type,
                configuredTargetCount: targetCount,
                latestTargetCount: dailyTargetByCategory[categoryKey],
                latestTriedCount: dailyTriedByCategory[categoryKey],
                latestRightCount: dailyRightByCategory[categoryKey],
            });
            starsTotal += progressModel.starCount;
            masteredTotal += progressModel.masteredCount;
            redoTotal += progressModel.redoCount;
            unseenTotal += progressModel.unseenCount;
            targetTotal += progressModel.targetCount;
            enabledRows.push({
                categoryKey,
                label: displayName,
                emoji,
                progressModel,
            });
        });

        const startedCount = enabledRows.filter((row) => row.progressModel.statusClass !== 'not-started' || row.progressModel.isFullyComplete).length;
        const masteredPct = targetTotal > 0 ? Math.max(0, Math.min(100, (masteredTotal / targetTotal) * 100)) : 0;
        const redoPct = targetTotal > 0 ? Math.max(0, Math.min(100, (redoTotal / targetTotal) * 100)) : 0;
        const unseenPct = Math.max(0, 100 - masteredPct - redoPct);

        const isClickable = enabledRows.length > 0;
        const initial = getKidInitial(kid.name);
        const avatarToneIndex = hashStringToIndex(String(kid.id || kid.name || ''), KID_AVATAR_TONE_COUNT);

        const subText = enabledRows.length > 0
            ? `Today: ${startedCount} of ${enabledRows.length} decks started`
            : 'No daily practices assigned';

        const summaryLineHtml = enabledRows.length > 0
            ? `<div class="redesign-kid-summary">
                <span class="redesign-kid-summary-item"><span class="redesign-kid-summary-num">${escapeHtml(String(masteredTotal))}</span> mastered</span>
                <span class="redesign-kid-summary-sep">·</span>
                <span class="redesign-kid-summary-item"><span class="redesign-kid-summary-num">${escapeHtml(String(redoTotal))}</span> to redo</span>
                <span class="redesign-kid-summary-sep">·</span>
                <span class="redesign-kid-summary-item"><span class="redesign-kid-summary-num">${escapeHtml(String(unseenTotal))}</span> unseen</span>
            </div>`
            : '';

        const progressBarHtml = enabledRows.length > 0
            ? `<div class="redesign-kid-progress-track">
                <span class="redesign-progress-seg mastered" style="width:${masteredPct}%"></span>
                <span class="redesign-progress-seg redo" style="width:${redoPct}%"></span>
                <span class="redesign-progress-seg unseen" style="width:${unseenPct}%"></span>
            </div>`
            : '';

        const iconStripHtml = enabledRows.length > 0
            ? `<div class="redesign-kid-icon-strip">
                ${enabledRows.map((row) => {
                    const isDone = row.progressModel.isFullyComplete;
                    const isInProgress = !isDone && row.progressModel.statusClass !== 'not-started';
                    const tileState = isDone ? 'done' : (isInProgress ? 'in-progress' : 'not-started');
                    const indicatorHtml = isDone
                        ? `<span class="redesign-kid-icon-indicator done" aria-hidden="true">✓</span>`
                        : (isInProgress
                            ? `<span class="redesign-kid-icon-indicator in-progress" aria-hidden="true"></span>`
                            : `<span class="redesign-kid-icon-indicator not-started" aria-hidden="true"></span>`);
                    const targetCount = row.progressModel.targetCount;
                    const targetLineHtml = targetCount > 0
                        ? `<div class="redesign-kid-icon-target">${escapeHtml(String(targetCount))} today</div>`
                        : '';
                    const subjectIconHtml = window.DeckCategoryCommon.renderCategorySubjectIcon(row.categoryKey, {
                        fallbackEmoji: row.emoji,
                    });
                    return `<div class="redesign-kid-icon-tile ${tileState}">
                        <div class="redesign-kid-icon-figure">
                            ${subjectIconHtml}
                        </div>
                        <div class="redesign-kid-icon-text">
                            <div class="redesign-kid-icon-label">${escapeHtml(row.label)}</div>
                            ${targetLineHtml}
                        </div>
                        ${indicatorHtml}
                    </div>`;
                }).join('')}
            </div>`
            : '';

        const ctaHtml = isClickable
            ? `<div class="redesign-kid-cta">Continue practice <span aria-hidden="true">→</span></div>`
            : '';

        const cardClassName = `redesign-kid-card${isClickable ? '' : ' redesign-kid-card-disabled'}`;
        const cardOpenAttr = isClickable ? ` onclick="selectKid('${kid.id}')"` : '';

        return `
            <div class="${cardClassName}"${cardOpenAttr}>
                <div class="redesign-kid-top">
                    <div class="redesign-kid-identity">
                        <span class="admin-kid-avatar admin-kid-avatar--tone-${avatarToneIndex}" aria-hidden="true">${escapeHtml(initial)}</span>
                        <div class="redesign-kid-identity-text">
                            <h3 class="redesign-kid-name">${escapeHtml(kid.name)}</h3>
                            <div class="redesign-kid-sub">${escapeHtml(subText)}</div>
                        </div>
                    </div>
                    <div class="redesign-star-total">
                        <span>⭐</span>
                        <span>${starsTotal}</span>
                    </div>
                </div>
                ${progressBarHtml}
                ${summaryLineHtml}
                ${iconStripHtml}
                ${ctaHtml}
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
