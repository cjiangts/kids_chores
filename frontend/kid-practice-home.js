/*
 * kid-practice-home.js — practice landing page for one kid.
 *
 * Shows a per-category "what's left today" summary strip, a chooser
 * grid of practice options (one card per opted-in category), and an
 * inline kid toggle (segmented pill) under the header.
 *
 * Each option card dispatches to a type-specific go* navigation
 * function that builds the kid-practice.html URL with the right
 * category + behavior-type query params.
 *
 * Layout (search for `// === N. ` banners to jump between sections):
 *
 *     1. DOM refs + navigation helpers (persistLast, title, badge)
 *     2. Kid toggle
 *     3. Bootstrap (DOMContentLoaded → loadKidInfo → render)
 *     4. Badge shelf summary + writing warm-up
 *     5. Category progress model + chooser rendering
 *     6. Per-type practice launch (goType1/Writing/Type3/Type4)
 *     7. Misc helpers
 */

const API_BASE = `${window.location.origin}/api`;

const urlParams = new URLSearchParams(window.location.search);
const kidId = String(urlParams.get('id') || '').trim();
const requestedCategoryKey = window.DeckCategoryCommon.normalizeCategoryKey(
    urlParams.get('categoryKey'),
);

const kidNameEl = document.getElementById('kidName');
const kidToggleGroup = document.getElementById('kidToggleGroup');
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
    normalizeCategoryKey,
    resolveChinesePracticeCategoryKey,
    resolveTypeINonChinesePracticeCategoryKey,
    resolveTypeIIPracticeCategoryKey,
    resolveTypeIIIPracticeCategoryKey,
} = window.DeckCategoryCommon;
const PRACTICE_NAV_CACHE_KEY = 'kid_practice_nav_cache_v1';
const PRACTICE_NAV_CACHE_TTL_MS = 2 * 60 * 1000;
const LAST_VIEWED_KID_STORAGE_KEY = 'parent_admin_last_kid_id_v1';

// =====================================================================
// === 1. DOM refs + navigation helpers
// =====================================================================
function persistLastViewedKidId(id) {
    try {
        if (!window.sessionStorage) return;
        const normalized = String(id || '').trim();
        if (!normalized) {
            window.sessionStorage.removeItem(LAST_VIEWED_KID_STORAGE_KEY);
            return;
        }
        window.sessionStorage.setItem(LAST_VIEWED_KID_STORAGE_KEY, normalized);
    } catch (error) {
        // best-effort
    }
}

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

let kidToggleLoading = false;

// =====================================================================
// === 2. Kid toggle
// =====================================================================
function kidHasPracticeTarget(kid) {
    const optedInKeys = getOptedInDeckCategoryKeys(kid);
    if (!Array.isArray(optedInKeys) || optedInKeys.length === 0) return false;
    const targets = getCategoryValueMap(kid?.practiceTargetByDeckCategory);
    for (const key of optedInKeys) {
        const target = Number.parseInt(targets?.[key], 10);
        if (Number.isInteger(target) && target > 0) return true;
    }
    return false;
}

function computeKidToggleProgress(kid) {
    const optedInKeys = getOptedInDeckCategoryKeys(kid);
    const metaMap = getDeckCategoryMetaMap(kid);
    const targets = getCategoryValueMap(kid?.practiceTargetByDeckCategory);
    const tiers = getCategoryRawValueMap(kid?.dailyStarTiersByDeckCategory);
    let assigned = 0;
    let done = 0;
    optedInKeys.forEach((key) => {
        const normalized = normalizeCategoryKey(key);
        if (!normalized) return;
        const target = Number.parseInt(targets?.[normalized], 10);
        if (!(Number.isInteger(target) && target > 0)) return;
        const behaviorType = String(metaMap?.[normalized]?.behavior_type || '').trim().toLowerCase();
        if (!VALID_BEHAVIOR_TYPES.has(behaviorType)) return;
        assigned += 1;
        const tierList = Array.isArray(tiers?.[normalized]) ? tiers[normalized] : [];
        if (tierList.some((tier) => String(tier || '').toLowerCase() === 'gold')) {
            done += 1;
        }
    });
    return { assigned, done };
}

async function loadKidsForToggle() {
    if (kidToggleLoading) return;
    kidToggleLoading = true;
    try {
        const response = await fetch(`${API_BASE}/kids?view=admin`);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const kids = await response.json();
        const all = Array.isArray(kids) ? kids : [];
        const list = all.filter((kid) => kidHasPracticeTarget(kid) || String(kid?.id || '') === kidId);
        renderKidToggle(list);
    } catch (error) {
        console.error('Error loading kids for toggle:', error);
        if (kidToggleGroup) {
            kidToggleGroup.classList.add('hidden');
            kidToggleGroup.innerHTML = '';
        }
    } finally {
        kidToggleLoading = false;
    }
}

function renderKidToggle(kids) {
    if (!kidToggleGroup) return;
    const list = Array.isArray(kids) ? kids : [];
    if (list.length < 2) {
        kidToggleGroup.classList.add('hidden');
        kidToggleGroup.innerHTML = '';
        return;
    }
    const userIconSvg = (typeof window.icon === 'function')
        ? window.icon('user', { className: 'kid-nav-card-icon', strokeWidth: 2 })
        : '';
    kidToggleGroup.innerHTML = list.map((kid) => {
        const id = String(kid?.id || '');
        const name = String(kid?.name || '').trim() || 'Kid';
        const isActive = id === String(kidId);
        const { assigned, done } = computeKidToggleProgress(kid);
        const isDone = assigned > 0 && done >= assigned;
        const metaHtml = assigned > 0
            ? `<span class="kid-nav-card-meta${isDone ? ' is-done' : ''}">${done}/${assigned} done</span>`
            : '';
        const nameHtml = `<span>${escapeHtmlLocal(name)}</span>`;
        if (isActive) {
            return `<span class="kid-nav-card active" role="tab" aria-selected="true">${userIconSvg}${nameHtml}${metaHtml}</span>`;
        }
        const href = `/kid-practice-home.html?id=${encodeURIComponent(id)}`;
        return `<a class="kid-nav-card" role="tab" aria-selected="false" href="${escapeHtmlLocal(href)}">${userIconSvg}${nameHtml}${metaHtml}</a>`;
    }).join('');
    kidToggleGroup.classList.remove('hidden');
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

// =====================================================================
// === 3. Bootstrap (DOMContentLoaded → loadKidInfo → render)
// =====================================================================
document.addEventListener('DOMContentLoaded', async () => {
    if (!kidId) {
        window.location.href = '/';
        return;
    }

    persistLastViewedKidId(kidId);
    void loadKidsForToggle();
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
    kidNameEl.textContent = window.PracticeUiCommon.formatKidPracticeTitle(currentKid.name);
    window.PracticeUiCommon.applyKidInitialAvatar(document.getElementById('kidTitleIcon'), currentKid);
    updatePageTitle();
}

function renderStarTokenSetHtml(starCount, { starClass, overflowClass }) {
    const safeCount = Math.max(0, Number.parseInt(starCount, 10) || 0);
    if (safeCount <= 0) {
        return '';
    }
    const starIconHtml = icon('star', { size: 16, fill: 'currentColor' });
    if (safeCount <= 5) {
        return Array.from({ length: safeCount }, () => (
            `<span class="${starClass}" aria-hidden="true">${starIconHtml}</span>`
        )).join('');
    }
    return `
        <span class="${starClass}" aria-hidden="true">${starIconHtml}</span>
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

// =====================================================================
// === 4. Badge shelf summary + writing warm-up
// =====================================================================
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

// =====================================================================
// === 5. Category progress model + chooser rendering
// =====================================================================
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
        doneMarkText: `${icon('check', { size: 16 })} Done`,
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

    let actionLabel = 'Start';
    if (isReview) {
        actionLabel = 'Review';
    } else if (hasStarted && !isFullyComplete) {
        actionLabel = 'Resume';
    }

    const subText = targetCount > 0
        ? `${displayMasteredCount} mastered · ${displayRedoCount} redo · ${seenCount}/${targetCount} seen`
        : 'Not started';
    const unseenPercent = Math.max(0, 100 - seenPercent);

    return {
        actionLabel,
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
    categoryKey,
    displayName,
    progressModel,
}) {
    let rightBadgeHtml = '';
    if (progressModel.isFullyComplete) {
        rightBadgeHtml = renderStarTokenSetHtml(Math.max(1, progressModel.starCount), {
            starClass: 'practice-row-token-star',
            overflowClass: 'practice-row-token-overflow',
        });
    }

    const subTextHtml = progressModel.targetCount > 0
        ? `<div class="practice-row-sub practice-row-legend">
            <span class="practice-row-legend-item">
                <span class="practice-row-legend-dot mastered" aria-hidden="true"></span>
                ${escapeHtmlLocal(String(progressModel.masteredCount))} mastered
            </span>
            <span class="practice-row-legend-item">
                <span class="practice-row-legend-dot redo" aria-hidden="true"></span>
                ${escapeHtmlLocal(String(progressModel.redoCount))} to fix
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

    const tileHtml = window.DeckCategoryCommon.renderCategorySubjectIcon(categoryKey);
    const iconByLabel = { Start: 'play', Review: 'refresh-cw', Resume: 'circle-arrow-right' };
    const actionIconName = iconByLabel[progressModel.actionLabel] || 'play';
    const actionIconHtml = (typeof window.icon === 'function') ? window.icon(actionIconName, { size: 17, strokeWidth: 2.4 }) : '';
    const percentLineHtml = percentHtml
        ? `<div class="practice-row-percent-line">${percentHtml}</div>`
        : '';
    return `
        <span class="practice-row-tile" aria-hidden="true">${tileHtml}</span>
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
            </div>
            ${percentLineHtml}
        </div>
        <span class="practice-row-action-col">
            <span class="practice-row-chevron" aria-hidden="true">
                ${actionIconHtml}
                <span class="practice-row-action-label">${escapeHtmlLocal(progressModel.actionLabel)}</span>
            </span>
        </span>
    `;
}

function renderPracticeOptionCard({
    button,
    categoryKey,
    behaviorType,
    displayName,
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
        categoryKey,
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
        if (model.isFullyComplete) {
            doneCount += 1;
        }
    });

    const summaryBoxes = [];
    if (assignedCount > 0) {
        summaryBoxes.push(buildStatCard({
            iconName: 'calendar',
            iconClass: 'admin-action-card-icon--violet',
            label: "Today's Sessions",
            value: doneCount,
            action: 'open-progress-report',
            ariaLabel: "View today's practice report",
        }));
    }
    if (badgeShelfSummary.loaded && badgeShelfSummary.trackingEnabled) {
        const earnedCount = Math.max(0, Number.parseInt(badgeShelfSummary.earnedCount, 10) || 0);
        summaryBoxes.push(buildStatCard({
            iconName: 'award',
            iconClass: 'admin-action-card-icon--coral',
            label: 'Earned Badges',
            value: earnedCount,
            action: 'open-badge-shelf',
        }));
    } else if (!badgeShelfSummary.loaded) {
        summaryBoxes.push(buildStatCard({
            iconName: 'award',
            iconClass: 'admin-action-card-icon--coral',
            label: 'Rewards',
            value: '…',
        }));
    }

    practiceSummaryStrip.innerHTML = summaryBoxes.join('');
    practiceSummaryStrip.classList.remove('hidden');
}

function buildStatCard({ iconName, iconFill, iconClass, label, value, action, ariaLabel }) {
    const iconOpts = { size: 22 };
    if (iconFill) iconOpts.fill = iconFill;
    const iconHtml = `<span class="admin-action-card-icon ${iconClass}" aria-hidden="true">${icon(iconName, iconOpts)}</span>`;
    const textHtml = `
        <span class="admin-action-card-text">
            <span class="admin-action-card-label">${escapeHtmlLocal(label)}</span>
            <span class="admin-action-card-value">${escapeHtmlLocal(String(value))}</span>
        </span>
    `;
    if (action) {
        const aria = ariaLabel ? ` aria-label="${escapeHtmlLocal(ariaLabel)}"` : '';
        const chevron = '<span class="admin-action-card-chevron" aria-hidden="true">›</span>';
        return `<button type="button" class="admin-action-card" data-practice-action="${action}"${aria}>${iconHtml}${textHtml}${chevron}</button>`;
    }
    return `<div class="admin-action-card is-static">${iconHtml}${textHtml}</div>`;
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

// =====================================================================
// === 6. Per-type practice launch
// =====================================================================
async function chooseChinesePractice(category) {
    const categoryKey = normalizeCategoryKey(category);
    if (!categoryKey) {
        showError('Chinese practice subject is missing.');
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
        showError(`${label} is not a Chinese flashcard practice subject.`);
        return;
    }
    goType1Practice(categoryKey);
}

function goType1Practice(category) {
    const categoryKey = normalizeCategoryKey(category);
    if (!categoryKey) {
        showError('Type-I subject is missing.');
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
        showError('Type-II subject is missing.');
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
        showError('Type-III subject is missing.');
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
        showError('Type-IV subject is missing.');
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

// =====================================================================
// === 7. Misc helpers
// =====================================================================
function showError(message) {
    window.PracticeUiCommon.showAlertError(errorState, errorMessage, message);
}
