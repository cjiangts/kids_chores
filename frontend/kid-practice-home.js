const API_BASE = `${window.location.origin}/api`;

const urlParams = new URLSearchParams(window.location.search);
const kidId = String(urlParams.get('id') || '').trim();
const requestedCategoryKey = window.DeckCategoryCommon.normalizeCategoryKey(
    urlParams.get('categoryKey'),
);

const kidNameEl = document.getElementById('kidName');
const kidBackBtn = document.getElementById('kidBackBtn');
const errorMessage = document.getElementById('errorMessage');
const practiceSection = document.getElementById('practiceSection');
const practiceSummaryStrip = document.getElementById('practiceSummaryStrip');
const practiceChooser = document.getElementById('practiceChooser');
const {
    buildCategoryStarsModel,
} = window.PracticeStarBadgeCommon || {};
const {
    getOptedInDeckCategorySet,
    getOptedInDeckCategoryKeys,
    getCategoryValueMap,
    getCategoryRawValueMap,
    getDeckCategoryMetaMap,
    getCategoryDisplayName,
    getCategoryEmoji,
    normalizeCategoryKey,
    resolveChinesePracticeCategoryKey,
    resolveTypeINonChinesePracticeCategoryKey,
    resolveTypeIIPracticeCategoryKey,
    resolveTypeIIIPracticeCategoryKey,
} = window.DeckCategoryCommon;
const PRACTICE_NAV_CACHE_KEY = 'kid_practice_nav_cache_v1';
const PRACTICE_NAV_CACHE_TTL_MS = 2 * 60 * 1000;

if (!buildCategoryStarsModel) {
    throw new Error('practice-star-badge-common.js is required for kid-practice-home');
}

let currentKid = null;
let writingCards = null;
let writingCardsLoadedCategoryKey = '';
let writingCardsLoading = false;
let activeChineseCategoryKey = requestedCategoryKey;
let activeTypeINonChineseCategoryKey = requestedCategoryKey;
let activeTypeIICategoryKey = requestedCategoryKey;
let activeTypeIIICategoryKey = requestedCategoryKey;
let badgeShelfSummary = {
    loaded: false,
    loading: false,
    earnedCount: 0,
    trackingEnabled: false,
};
const errorState = { lastMessage: '' };
const VALID_BEHAVIOR_TYPES = new Set(['type_i', 'type_ii', 'type_iii', 'type_iv']);

function escapeHtmlLocal(text) {
    return String(text || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function updatePageTitle() {
    const kidName = String(currentKid?.name || '').trim();
    document.title = kidName
        ? `${kidName} - Practice Home - Kids Daily Chores`
        : 'Practice Home - Kids Daily Chores';
}

function maybeShowBadgeCelebration() {
    if (!kidId || !window.KidBadgeCelebration || typeof window.KidBadgeCelebration.maybeShowForKid !== 'function') {
        return;
    }
    void window.KidBadgeCelebration.maybeShowForKid({
        kidId,
        apiBase: API_BASE,
    });
}

async function openBadgeShelf() {
    if (!kidId || !currentKid || !window.KidBadgeShelfModal || typeof window.KidBadgeShelfModal.open !== 'function') {
        return;
    }
    const payload = await window.KidBadgeShelfModal.open({
        kidId,
        kidName: currentKid.name,
        apiBase: API_BASE,
        forceRefresh: true,
    });
    if (payload && typeof payload === 'object') {
        const summary = payload.summary || {};
        badgeShelfSummary = {
            loaded: true,
            loading: false,
            earnedCount: Number(summary.earnedCount || 0),
            trackingEnabled: Boolean(payload.trackingEnabled),
        };
        renderPracticeOptions();
    }
}

function openProgressReport() {
    if (!kidId) {
        return;
    }
    window.location.href = `/kid-report.html?id=${encodeURIComponent(kidId)}&from=kid-home`;
}

function runDynamicPracticeByBehavior(categoryKey, behaviorType, hasChineseSpecificLogic) {
    if (behaviorType === 'type_iv') {
        goType4Practice(categoryKey);
        return;
    }
    if (behaviorType === 'type_iii') {
        goType3Practice(categoryKey);
        return;
    }
    if (behaviorType === 'type_ii') {
        goWritingPractice(categoryKey);
        return;
    }
    if (hasChineseSpecificLogic) {
        void chooseChinesePractice(categoryKey);
        return;
    }
    goType1Practice(categoryKey);
}

function cacheKidForPracticeNavigation() {
    try {
        if (!currentKid || !kidId) {
            return;
        }
        const payload = {
            kidId: String(kidId),
            cachedAtMs: Date.now(),
            kid: currentKid,
        };
        window.sessionStorage.setItem(PRACTICE_NAV_CACHE_KEY, JSON.stringify(payload));
    } catch (error) {
        // Best-effort cache only.
    }
}

document.addEventListener('DOMContentLoaded', async () => {
    if (!kidId) {
        window.location.href = '/';
        return;
    }

    kidBackBtn.href = '/';
    const cachedKid = readKidFromPracticeNavigationCache();
    if (cachedKid) {
        applyKidPayload(cachedKid);
        renderPracticeOptions();
        void loadBadgeShelfSummary();
        maybeShowBadgeCelebration();
        window.setTimeout(() => { void warmWritingCards(); }, 0);
        // Revalidate in background — update UI silently when fresh data arrives
        loadKidInfo().then(() => { renderPracticeOptions(); }).catch(() => {});
    } else {
        await loadKidInfo();
        renderPracticeOptions();
        void loadBadgeShelfSummary();
        maybeShowBadgeCelebration();
        window.setTimeout(() => { void warmWritingCards(); }, 0);
    }
});

if (practiceSummaryStrip) {
    practiceSummaryStrip.addEventListener('click', (event) => {
        const shelfBtn = event.target.closest('[data-practice-action="open-badge-shelf"]');
        if (shelfBtn) {
            void openBadgeShelf();
            return;
        }
        const progressBtn = event.target.closest('[data-practice-action="open-progress-report"]');
        if (progressBtn) {
            openProgressReport();
        }
    });
}

function applyKidPayload(kid) {
    currentKid = kid;
    activeChineseCategoryKey = resolveChinesePracticeCategoryKey(currentKid, activeChineseCategoryKey);
    activeTypeINonChineseCategoryKey = resolveTypeINonChinesePracticeCategoryKey(
        currentKid,
        activeTypeINonChineseCategoryKey,
    );
    activeTypeIICategoryKey = resolveTypeIIPracticeCategoryKey(currentKid, activeTypeIICategoryKey);
    if (writingCardsLoadedCategoryKey && writingCardsLoadedCategoryKey !== activeTypeIICategoryKey) {
        writingCards = null;
        writingCardsLoadedCategoryKey = '';
    }
    activeTypeIIICategoryKey = resolveTypeIIIPracticeCategoryKey(currentKid, activeTypeIIICategoryKey);
    kidNameEl.innerHTML = `<span class="practice-mascot" aria-hidden="true">🧸</span><span class="practice-kid-name-text">${escapeHtmlLocal(currentKid.name)}'s Practice</span>`;
    updatePageTitle();
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

function readKidFromPracticeNavigationCache() {
    try {
        const raw = window.sessionStorage.getItem(PRACTICE_NAV_CACHE_KEY);
        if (!raw) {
            return null;
        }
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object') {
            return null;
        }
        if (String(parsed.kidId || '').trim() !== kidId) {
            return null;
        }
        const cachedAtMs = Number(parsed.cachedAtMs || 0);
        if (!Number.isFinite(cachedAtMs) || cachedAtMs <= 0) {
            return null;
        }
        if ((Date.now() - cachedAtMs) > PRACTICE_NAV_CACHE_TTL_MS) {
            return null;
        }
        const kid = parsed.kid;
        if (!kid || typeof kid !== 'object') {
            return null;
        }
        return kid;
    } catch (error) {
        return null;
    }
}

async function loadKidInfo() {
    let usedCache = false;
    try {
        const cachedKid = readKidFromPracticeNavigationCache();
        if (cachedKid) {
            applyKidPayload(cachedKid);
            usedCache = true;
        }
        const response = await fetch(`${API_BASE}/kids/${kidId}?view=practice_home`);
        if (!response.ok) {
            throw new Error('Kid not found');
        }
        applyKidPayload(await response.json());
    } catch (error) {
        console.error('Error loading kid:', error);
        if (!usedCache) {
            showError('Failed to load kid information');
            setTimeout(() => {
                window.location.href = '/';
            }, 2000);
        }
    }
}

async function warmWritingCards() {
    try {
        if (writingCardsLoading) {
            return;
        }
        if (!activeTypeIICategoryKey) {
            writingCards = [];
            writingCardsLoadedCategoryKey = '';
            return;
        }
        writingCardsLoading = true;
        const url = new URL(`${API_BASE}/kids/${kidId}/type2/cards`);
        url.searchParams.set('categoryKey', activeTypeIICategoryKey);
        const response = await fetch(url.toString());
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }
        const data = await response.json();
        writingCards = (data.cards || []).filter((card) => card.available_for_practice !== false);
        writingCardsLoadedCategoryKey = activeTypeIICategoryKey;
    } catch (error) {
        console.error('Error loading writing cards:', error);
        writingCards = [];
        writingCardsLoadedCategoryKey = activeTypeIICategoryKey || '';
    } finally {
        writingCardsLoading = false;
    }
}

async function loadBadgeShelfSummary({ forceRefresh = false } = {}) {
    if (!kidId || !window.KidBadgeShelfModal || typeof window.KidBadgeShelfModal.getSummary !== 'function') {
        return;
    }
    if (badgeShelfSummary.loading) {
        return;
    }
    badgeShelfSummary.loading = true;
    try {
        const summary = await window.KidBadgeShelfModal.getSummary({
            kidId,
            apiBase: API_BASE,
            forceRefresh,
        });
        badgeShelfSummary = {
            loaded: Boolean(summary && summary.ok),
            loading: false,
            earnedCount: Number(summary && summary.earnedCount || 0),
            trackingEnabled: Boolean(summary && summary.trackingEnabled),
        };
    } catch (error) {
        badgeShelfSummary = {
            loaded: false,
            loading: false,
            earnedCount: 0,
            trackingEnabled: false,
        };
    }
    renderPracticeOptions();
}

function buildCategoryProgressModel({
    categoryKey,
    behaviorType,
    dailyStarTiersByCategory,
    dailyCompletedByCategory,
    dailyPercentByCategory,
    dailyTargetByCategory,
    dailyTriedByCategory,
    dailyRightByCategory,
    practiceTargetByCategory,
}) {
    const starsModel = buildCategoryStarsModel({
        categoryKey,
        dailyStarTiersByCategory,
        dailyCompletedByCategory,
        dailyPercentByCategory,
        normalizeCategoryKey,
        doneMarkClass: 'practice-done-mark',
        doneMarkText: '✅ Done',
    });
    const percentValueRaw = Number.isFinite(starsModel.percentValue)
        ? Math.max(0, Math.round(starsModel.percentValue))
        : 0;
    const latestPercentValue = Number.isFinite(starsModel.latestPercentValue)
        ? Math.max(0, Math.min(100, Math.round(starsModel.latestPercentValue)))
        : 0;
    const latestTargetRaw = Number.parseInt(dailyTargetByCategory?.[categoryKey], 10);
    const configuredTargetRaw = Number.parseInt(practiceTargetByCategory?.[categoryKey], 10);
    const targetCount = Number.isInteger(latestTargetRaw) && latestTargetRaw > 0
        ? latestTargetRaw
        : (Number.isInteger(configuredTargetRaw) && configuredTargetRaw > 0 ? configuredTargetRaw : 0);
    const normalizedBehaviorType = String(behaviorType || '').trim().toLowerCase();
    const isTypeIII = normalizedBehaviorType === 'type_iii';
    const triedRaw = Number.parseInt(dailyTriedByCategory?.[categoryKey], 10);
    const rightRaw = Number.parseInt(dailyRightByCategory?.[categoryKey], 10);
    const triedCount = Number.isInteger(triedRaw) ? Math.max(0, triedRaw) : 0;
    const rightCount = Number.isInteger(rightRaw) ? Math.max(0, rightRaw) : 0;
    let seenCount = triedCount;
    let masteredCount = rightCount;
    if (targetCount > 0) {
        seenCount = Math.min(targetCount, Math.max(triedCount, rightCount));
        masteredCount = Math.min(targetCount, rightCount);
    } else {
        seenCount = 0;
        masteredCount = 0;
    }
    const redoCount = Math.max(0, seenCount - masteredCount);
    const seenPercent = targetCount > 0
        ? Math.max(0, Math.min(100, (seenCount / targetCount) * 100))
        : 0;
    const fillPercent = seenPercent;
    const bonusPercent = Math.max(0, percentValueRaw - 100);
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
    const isWorkingOnNextStar = starCount > 0 && latestPercentValue < 100;
    const unseenCount = targetCount > 0
        ? Math.max(0, targetCount - seenCount)
        : 0;
    const isTypeIIIRecordedComplete = isTypeIII && targetCount > 0 && seenCount > 0 && unseenCount <= 0;
    const displayMasteredCount = isTypeIIIRecordedComplete ? seenCount : masteredCount;
    const displayRedoCount = isTypeIIIRecordedComplete ? 0 : redoCount;
    const masteredPercent = targetCount > 0
        ? Math.max(0, Math.min(100, (displayMasteredCount / targetCount) * 100))
        : 0;
    const redoPercent = targetCount > 0
        ? Math.max(0, Math.min(100, (displayRedoCount / targetCount) * 100))
        : 0;
    const isReview = !isTypeIIIRecordedComplete && targetCount > 0 && seenCount > 0 && unseenCount <= 0 && redoCount > 0;
    const isFullyComplete = targetCount > 0
        ? (isTypeIIIRecordedComplete || (seenCount > 0 && unseenCount <= 0 && redoCount <= 0))
        : Boolean(starsModel.isDoneToday && latestPercentValue >= 100);
    const hasStarted = isFullyComplete || isReview || fillPercent > 0 || seenCount > 0;

    let statusClass = 'not-started';
    let statusText = 'Not started';
    if (isReview) {
        statusClass = 'review';
        statusText = 'Review';
    } else if (!isFullyComplete && hasStarted) {
        statusClass = 'in-progress';
        statusText = 'In progress';
    }

    const subText = targetCount > 0
        ? `${displayMasteredCount} mastered · ${displayRedoCount} redo · ${seenCount}/${targetCount} seen`
        : 'Not started';
    const unseenPercent = Math.max(0, 100 - seenPercent);

    return {
        statusClass,
        statusText,
        subText,
        percentValue: percentValueRaw,
        fillPercent,
        bonusPercent,
        latestPercentValue,
        starCount,
        isWorkingOnNextStar,
        targetCount,
        seenCount,
        masteredCount: displayMasteredCount,
        redoCount: displayRedoCount,
        unseenCount,
        masteredPercent,
        redoPercent,
        unseenPercent,
        isFullyComplete,
        isReview,
        isDoneToday: starsModel.isDoneToday,
    };
}

function buildCategoryCardInnerHtml({
    emoji,
    displayName,
    progressModel,
}) {
    let rightBadgeHtml;
    if (progressModel.isFullyComplete) {
        rightBadgeHtml = renderStarTokenSetHtml(Math.max(1, progressModel.starCount), {
            starClass: 'practice-row-token-star',
            overflowClass: 'practice-row-token-overflow',
        });
    } else {
        rightBadgeHtml = `<span class="practice-row-status-pill ${progressModel.statusClass}">${escapeHtmlLocal(progressModel.statusText)}</span>`;
    }

    const subTextHtml = progressModel.targetCount > 0
        ? `<div class="practice-row-sub practice-row-legend">
            <span class="practice-row-legend-item">
                <span class="practice-row-legend-dot mastered" aria-hidden="true"></span>
                ${escapeHtmlLocal(String(progressModel.masteredCount))} mastered
            </span>
            <span class="practice-row-legend-item">
                <span class="practice-row-legend-dot redo" aria-hidden="true"></span>
                ${escapeHtmlLocal(String(progressModel.redoCount))} to redo
            </span>
            <span class="practice-row-legend-item">
                <span class="practice-row-legend-dot unseen" aria-hidden="true"></span>
                ${escapeHtmlLocal(String(progressModel.unseenCount))} unseen
            </span>
        </div>`
        : `<div class="practice-row-sub">${escapeHtmlLocal(progressModel.subText)}</div>`;

    const percentValue = progressModel.targetCount > 0
        ? Math.max(0, Math.min(100, Math.round(progressModel.fillPercent)))
        : 0;
    const percentHtml = progressModel.targetCount > 0
        ? `<span class="practice-row-percent">${percentValue}%</span>`
        : '';

    return `
        <span class="practice-row-tile" aria-hidden="true">
            <span class="practice-row-tile-emoji">${escapeHtmlLocal(emoji)}</span>
        </span>
        <div class="practice-row-content">
            <div class="practice-row-head">
                <h3>${escapeHtmlLocal(displayName)}</h3>
                <div class="practice-row-right">${rightBadgeHtml}</div>
            </div>
            ${subTextHtml}
            <div class="practice-row-progress-line">
                <div class="practice-row-progress">
                    <span class="practice-row-seg mastered" style="width:${progressModel.masteredPercent}%"></span>
                    <span class="practice-row-seg redo" style="width:${progressModel.redoPercent}%"></span>
                    <span class="practice-row-seg unseen" style="width:${progressModel.unseenPercent}%"></span>
                </div>
                ${percentHtml}
            </div>
        </div>
        <span class="practice-row-chevron" aria-hidden="true">›</span>
    `;
}

function renderPracticeOptionCard({
    button,
    categoryKey,
    behaviorType,
    displayName,
    emoji,
    dailyStarTiersByCategory,
    dailyCompletedByCategory,
    dailyPercentByCategory,
    dailyTargetByCategory,
    dailyTriedByCategory,
    dailyRightByCategory,
    practiceTargetByCategory,
}) {
    if (!button) {
        return null;
    }
    const model = buildCategoryProgressModel({
        categoryKey,
        behaviorType,
        dailyStarTiersByCategory,
        dailyCompletedByCategory,
        dailyPercentByCategory,
        dailyTargetByCategory,
        dailyTriedByCategory,
        dailyRightByCategory,
        practiceTargetByCategory,
    });
    button.innerHTML = buildCategoryCardInnerHtml({
        emoji,
        displayName,
        progressModel: model,
    });
    return model;
}

function renderPracticeSummaryStrip({
    optedInCategoryKeys,
    categoryMetaMap,
    dailyCompletedByCategory,
    dailyStarTiersByCategory,
    dailyPercentByCategory,
    practiceTargetByCategory,
    dailyTargetByCategory,
    dailyTriedByCategory,
    dailyRightByCategory,
}) {
    if (!practiceSummaryStrip) {
        return;
    }

    let assignedCount = 0;
    let doneCount = 0;
    let starsTodayCount = 0;
    let progressCountToday = 0;

    optedInCategoryKeys.forEach((categoryKey) => {
        const key = normalizeCategoryKey(categoryKey);
        if (!key) {
            return;
        }
        const meta = categoryMetaMap[key] || {};
        const behaviorType = String(meta.behavior_type || '').trim().toLowerCase();
        if (!VALID_BEHAVIOR_TYPES.has(behaviorType)) {
            return;
        }
        const targetCount = Number.parseInt(practiceTargetByCategory?.[key], 10);
        const completedCount = Number.parseInt(dailyCompletedByCategory?.[key], 10);
        const safeTargetCount = Number.isInteger(targetCount) ? Math.max(0, targetCount) : 0;
        const safeCompletedCount = Number.isInteger(completedCount) ? Math.max(0, completedCount) : 0;
        if (safeTargetCount <= 0 && safeCompletedCount <= 0) {
            return;
        }

        assignedCount += 1;
        progressCountToday += safeCompletedCount;
        const model = buildCategoryProgressModel({
            categoryKey: key,
            dailyStarTiersByCategory,
            dailyCompletedByCategory,
            dailyPercentByCategory,
            dailyTargetByCategory,
            dailyTriedByCategory,
            dailyRightByCategory,
            practiceTargetByCategory,
        });
        starsTodayCount += model.starCount;
        if (model.isFullyComplete) {
            doneCount += 1;
        }
    });

    const summaryBoxes = [];
    if (assignedCount > 0) {
        summaryBoxes.push(`
            <div class="redesign-summary-box redesign-summary-box-with-icon">
                <span class="redesign-summary-icon stars" aria-hidden="true">★</span>
                <div class="redesign-summary-main">
                    <p class="redesign-summary-label">Stars today</p>
                    <p class="redesign-summary-value">${starsTodayCount}</p>
                </div>
            </div>
        `);
        summaryBoxes.push(`
            <div class="redesign-summary-box redesign-summary-box-with-icon">
                <span class="redesign-summary-icon done" aria-hidden="true">✓</span>
                <div class="redesign-summary-main">
                    <p class="redesign-summary-label">Done</p>
                    <p class="redesign-summary-value">${doneCount}/${assignedCount}</p>
                </div>
            </div>
        `);
    }
    if (badgeShelfSummary.loaded && badgeShelfSummary.trackingEnabled) {
        summaryBoxes.push(`
            <button type="button" class="badge-summary-box" data-practice-action="open-badge-shelf">
                <span class="badge-summary-medal" aria-hidden="true">🏅</span>
                <div class="badge-summary-main">
                    <p class="redesign-summary-label">Badge Shelf</p>
                    <p class="redesign-summary-value badge-summary-value">
                        <span class="badge-summary-count">${
                            `${Math.max(0, Number.parseInt(badgeShelfSummary.earnedCount, 10) || 0)} earned`
                        }</span>
                    </p>
                </div>
                <span class="badge-summary-chevron" aria-hidden="true">›</span>
            </button>
        `);
    } else if (badgeShelfSummary.loaded) {
        summaryBoxes.push(`
            <button type="button" class="redesign-summary-box progress-summary-box" data-practice-action="open-progress-report">
                <div class="progress-summary-main">
                    <p class="redesign-summary-label">Progress</p>
                    <p class="redesign-summary-value">${Math.max(0, progressCountToday)} today</p>
                </div>
                <span class="progress-summary-chart" aria-hidden="true">📊</span>
            </button>
        `);
    } else {
        summaryBoxes.push(`
            <div class="redesign-summary-box">
                <p class="redesign-summary-label">Rewards</p>
                <p class="redesign-summary-value">...</p>
            </div>
        `);
    }

    practiceSummaryStrip.innerHTML = summaryBoxes.join('');
    practiceSummaryStrip.classList.remove('hidden');
}

function clearPracticeOptionButtons() {
    if (!practiceChooser) {
        return;
    }
    practiceChooser.innerHTML = '';
}

function renderPracticeOptionButtons({
    optedInCategoryKeys,
    categoryMetaMap,
    dailyCompletedByCategory,
    dailyStarTiersByCategory,
    dailyPercentByCategory,
    practiceTargetByCategory,
    dailyTargetByCategory,
    dailyTriedByCategory,
    dailyRightByCategory,
}) {
    clearPracticeOptionButtons();
    let renderedCount = 0;
    optedInCategoryKeys.forEach((categoryKey) => {
        const key = normalizeCategoryKey(categoryKey);
        if (!key) {
            return;
        }
        const meta = categoryMetaMap[key] || {};
        const behaviorType = String(meta.behavior_type || '').trim().toLowerCase();
        if (!VALID_BEHAVIOR_TYPES.has(behaviorType)) {
            return;
        }
        const targetCount = Number.parseInt(practiceTargetByCategory?.[key], 10);
        const completedCount = Number.parseInt(dailyCompletedByCategory?.[key], 10);
        const safeTargetCount = Number.isInteger(targetCount) ? Math.max(0, targetCount) : 0;
        const safeCompletedCount = Number.isInteger(completedCount) ? Math.max(0, completedCount) : 0;
        if (safeTargetCount <= 0 && safeCompletedCount <= 0) {
            return;
        }

        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'practice-option redesign-practice-option';
        button.setAttribute('data-category-key', key);
        button.addEventListener('click', () => {
            runDynamicPracticeByBehavior(key, behaviorType, Boolean(meta.has_chinese_specific_logic));
        });

        renderPracticeOptionCard({
            button,
            categoryKey: key,
            behaviorType,
            displayName: getCategoryDisplayName(key, categoryMetaMap),
            emoji: getCategoryEmoji(key, categoryMetaMap),
            dailyStarTiersByCategory,
            dailyCompletedByCategory,
            dailyPercentByCategory,
            dailyTargetByCategory,
            dailyTriedByCategory,
            dailyRightByCategory,
            practiceTargetByCategory,
        });

        practiceChooser.appendChild(button);
        renderedCount += 1;
    });
    return renderedCount;
}

function renderPracticeOptions() {
    if (!currentKid) {
        return;
    }

    const optedInKeys = getOptedInDeckCategoryKeys(currentKid);
    const categoryMetaMap = getDeckCategoryMetaMap(currentKid);
    const dailyCompletedByCategory = getCategoryValueMap(currentKid?.dailyCompletedByDeckCategory);
    const dailyStarTiersByCategory = getCategoryRawValueMap(currentKid?.dailyStarTiersByDeckCategory);
    const dailyPercentByCategory = getCategoryValueMap(currentKid?.dailyPercentByDeckCategory);
    const dailyTargetByCategory = getCategoryValueMap(currentKid?.dailyTargetByDeckCategory);
    const dailyTriedByCategory = getCategoryValueMap(currentKid?.dailyTriedByDeckCategory);
    const dailyRightByCategory = getCategoryValueMap(currentKid?.dailyRightByDeckCategory);
    const practiceTargetByCategory = getCategoryValueMap(currentKid?.practiceTargetByDeckCategory);
    const typeIChineseKey = resolveChinesePracticeCategoryKey(currentKid, activeChineseCategoryKey);
    activeChineseCategoryKey = typeIChineseKey;
    const typeINonChineseKey = resolveTypeINonChinesePracticeCategoryKey(
        currentKid,
        activeTypeINonChineseCategoryKey,
    );
    activeTypeINonChineseCategoryKey = typeINonChineseKey;
    const typeIIKey = resolveTypeIIPracticeCategoryKey(currentKid, activeTypeIICategoryKey);
    activeTypeIICategoryKey = typeIIKey;
    const typeIIIKey = resolveTypeIIIPracticeCategoryKey(currentKid, activeTypeIIICategoryKey);
    activeTypeIIICategoryKey = typeIIIKey;
    renderPracticeSummaryStrip({
        optedInCategoryKeys: optedInKeys,
        categoryMetaMap,
        dailyCompletedByCategory,
        dailyStarTiersByCategory,
        dailyPercentByCategory,
        practiceTargetByCategory,
        dailyTargetByCategory,
        dailyTriedByCategory,
        dailyRightByCategory,
    });
    const renderedOptionCount = renderPracticeOptionButtons({
        optedInCategoryKeys: optedInKeys,
        categoryMetaMap,
        dailyCompletedByCategory,
        dailyStarTiersByCategory,
        dailyPercentByCategory,
        practiceTargetByCategory,
        dailyTargetByCategory,
        dailyTriedByCategory,
        dailyRightByCategory,
    });
    practiceSection.classList.remove('hidden');
    if (renderedOptionCount <= 0) {
        showError('No daily practice is assigned. Ask your parent to set per-session counts above 0.');
    } else {
        showError('');
    }
}

async function chooseChinesePractice(category) {
    const categoryKey = normalizeCategoryKey(category);
    if (!categoryKey) {
        showError('Chinese practice category is missing.');
        return;
    }
    const optedInSet = getOptedInDeckCategorySet(currentKid);
    if (!optedInSet.has(categoryKey)) {
        const categoryMetaMap = getDeckCategoryMetaMap(currentKid);
        const label = getCategoryDisplayName(categoryKey, categoryMetaMap);
        showError(`${label} practice is not opted in for this kid.`);
        return;
    }
    const categoryMetaMap = getDeckCategoryMetaMap(currentKid);
    const meta = categoryMetaMap[categoryKey] || {};
    if (meta.behavior_type !== 'type_i' || !meta.has_chinese_specific_logic) {
        const label = getCategoryDisplayName(categoryKey, categoryMetaMap);
        showError(`${label} is not a Chinese flashcard practice category.`);
        return;
    }
    goType1Practice(categoryKey);
}

function goType1Practice(category) {
    const categoryKey = normalizeCategoryKey(category);
    if (!categoryKey) {
        showError('Type-I category is missing.');
        return;
    }
    const optedInSet = getOptedInDeckCategorySet(currentKid);
    if (!optedInSet.has(categoryKey)) {
        const categoryMetaMap = getDeckCategoryMetaMap(currentKid);
        const label = getCategoryDisplayName(categoryKey, categoryMetaMap);
        showError(`${label} practice is not opted in for this kid.`);
        return;
    }
    const params = new URLSearchParams();
    params.set('id', kidId);
    params.set('categoryKey', categoryKey);
    cacheKidForPracticeNavigation();
    window.location.href = `/kid-practice.html?${params.toString()}`;
}

function goWritingPractice(category) {
    const categoryKey = normalizeCategoryKey(category);
    if (!categoryKey) {
        showError('Type-II category is missing.');
        return;
    }
    const optedInSet = getOptedInDeckCategorySet(currentKid);
    if (!optedInSet.has(categoryKey)) {
        const categoryMetaMap = getDeckCategoryMetaMap(currentKid);
        const label = getCategoryDisplayName(categoryKey, categoryMetaMap);
        showError(`${label} practice is not opted in for this kid.`);
        return;
    }
    if (
        categoryKey === writingCardsLoadedCategoryKey
        && Array.isArray(writingCards)
        && writingCards.length === 0
    ) {
        const categoryMetaMap = getDeckCategoryMetaMap(currentKid);
        const label = getCategoryDisplayName(categoryKey, categoryMetaMap);
        showError(`No ${label} cards yet. Ask your parent to add some first.`);
        return;
    }
    const params = new URLSearchParams();
    params.set('id', kidId);
    params.set('categoryKey', categoryKey);
    cacheKidForPracticeNavigation();
    window.location.href = `/kid-practice.html?${params.toString()}`;
}

function goType3Practice(category) {
    const categoryKey = normalizeCategoryKey(category);
    if (!categoryKey) {
        showError('Type-III category is missing.');
        return;
    }
    const optedInSet = getOptedInDeckCategorySet(currentKid);
    if (!optedInSet.has(categoryKey)) {
        const categoryMetaMap = getDeckCategoryMetaMap(currentKid);
        const label = getCategoryDisplayName(categoryKey, categoryMetaMap);
        showError(`${label} practice is not opted in for this kid.`);
        return;
    }
    const params = new URLSearchParams();
    params.set('id', kidId);
    params.set('categoryKey', categoryKey);
    cacheKidForPracticeNavigation();
    window.location.href = `/kid-practice.html?${params.toString()}`;
}

function goType4Practice(category) {
    const categoryKey = normalizeCategoryKey(category);
    if (!categoryKey) {
        showError('Type-IV category is missing.');
        return;
    }
    const optedInSet = getOptedInDeckCategorySet(currentKid);
    if (!optedInSet.has(categoryKey)) {
        const categoryMetaMap = getDeckCategoryMetaMap(currentKid);
        const label = getCategoryDisplayName(categoryKey, categoryMetaMap);
        showError(`${label} practice is not opted in for this kid.`);
        return;
    }
    const params = new URLSearchParams();
    params.set('id', kidId);
    params.set('categoryKey', categoryKey);
    cacheKidForPracticeNavigation();
    window.location.href = `/kid-practice.html?${params.toString()}`;
}

function showError(message) {
    window.PracticeUiCommon.showAlertError(errorState, errorMessage, message);
}
