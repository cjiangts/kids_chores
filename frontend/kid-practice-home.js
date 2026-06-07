/*
 * kid-practice-home.js — practice landing page for one kid.
 *
 * Shows a per-category "what's left today" summary strip, a chooser
 * grid of practice options (one card per opted-in category), and a
 * current-kid switch button that returns to the family home.
 *
 * Each option card dispatches to a type-specific go* navigation
 * function that builds the kid-practice.html URL with the right
 * category + behavior-type query params.
 *
 * Layout (search for `// === N. ` banners to jump between sections):
 *
 *     1. DOM refs + navigation helpers (persistLast, title)
 *     2. Bootstrap (DOMContentLoaded → loadKidInfo → render)
 *     3. Category progress model + chooser rendering
 *     4. Per-type practice launch (goType1/Writing/Type3/Type4)
 *     5. Misc helpers
 */

const API_BASE = `${window.location.origin}/api`;

const urlParams = new URLSearchParams(window.location.search);
const kidId = String(urlParams.get('id') || '').trim();
const requestedCategoryKey = window.DeckCategoryCommon.normalizeCategoryKey(
    urlParams.get('categoryKey'),
);

const kidNameEl = document.getElementById('kidName');
const errorMessage = document.getElementById('errorMessage');
const practiceSection = document.getElementById('practiceSection');
const inAppPracticeSection = document.getElementById('inAppPracticeSection');
const practiceChooser = document.getElementById('practiceChooser');
const offAppPracticeSection = document.getElementById('offAppPracticeSection');
const offAppChooser = document.getElementById('offAppChooser');
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
let activeChineseCategoryKey = requestedCategoryKey;
let activeTypeINonChineseCategoryKey = requestedCategoryKey;
let activeTypeIICategoryKey = requestedCategoryKey;
let activeTypeIIICategoryKey = requestedCategoryKey;
let offAppChoreState = {
    loaded: false,
    loading: false,
    chores: [],
    pendingByRuleId: new Map(),
    savingRuleId: null,
};
const errorState = { lastMessage: '' };
const VALID_BEHAVIOR_TYPES = new Set(['type_i', 'type_ii', 'type_iii', 'type_iv']);

let isOfflineMode = false;
let offlinePackCategorySet = null;
let offlinePackExpired = false;

function appendOfflineFlagIfNeeded(params) {
    if (isOfflineMode) params.set('offline', '1');
}

function markOfflineHomeUrl() {
    try {
        const url = new URL(window.location.href);
        if (url.searchParams.get('offline') === '1') {
            return;
        }
        url.searchParams.set('offline', '1');
        window.history.replaceState(window.history.state, '', url.toString());
    } catch (_) {
        // best-effort URL marker only
    }
}

function offlineGuardOrError(categoryKey) {
    if (!isOfflineMode) return true;
    if (offlinePackExpired) {
        showError('Offline pack expired — tap Sync to return online.');
        return false;
    }
    if (offlinePackCategorySet && !offlinePackCategorySet.has(categoryKey)) {
        showError('This subject was not downloaded for offline practice. Tap Sync to return online.');
        return false;
    }
    return true;
}

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
        ? `${kidName} - Practice Home - The mommy app`
        : 'Practice Home - The mommy app';
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

// =====================================================================
// === 3. Bootstrap (DOMContentLoaded → loadKidInfo → render)
// =====================================================================
document.addEventListener('DOMContentLoaded', async () => {
    if (!kidId) {
        // If this device owns an offline pack, recover by routing to the offline
        // hub (family-home) instead of bouncing to '/', which (when the SW shell
        // falls back to this very page) would loop forever.
        let ownedIds = [];
        if (window.OfflineStorage) {
            try { ownedIds = await window.OfflineStorage.listOwnedKidIds(); } catch (_) { /* ignore */ }
        }
        window.location.replace(ownedIds.length > 0 ? '/family-home.html' : '/index.html');
        return;
    }

    persistLastViewedKidId(kidId);

    if (window.OfflineCommon) {
        const pack = await window.OfflineCommon.findActivePack(kidId);
        if (pack && pack.packEnvelope) {
            await bootstrapOfflinePracticeHome(pack);
            return;
        }
    }

    const cachedKid = readKidFromPracticeNavigationCache();
    if (cachedKid) {
        applyKidPayload(cachedKid);
        renderPracticeOptions();
        void loadOffAppChores();
        // Revalidate in background — update UI silently when fresh data arrives
        loadKidInfo().then(() => { renderPracticeOptions(); }).catch(() => {});
    } else {
        const offAppPromise = loadOffAppChores();
        await loadKidInfo();
        renderPracticeOptions();
        void offAppPromise;
    }
});

if (offAppChooser) {
    offAppChooser.addEventListener('click', (event) => {
        const taskButton = event.target.closest('[data-off-app-rule-id]');
        if (!taskButton) {
            return;
        }
        void handleOffAppTaskToggle(taskButton.getAttribute('data-off-app-rule-id'));
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
    activeTypeIIICategoryKey = resolveTypeIIIPracticeCategoryKey(currentKid, activeTypeIIICategoryKey);
    kidNameEl.textContent = window.PracticeUiCommon.formatKidPracticeTitle(currentKid.name);
    const titleIcon = document.getElementById('kidTitleIcon');
    if (titleIcon) {
        titleIcon.className = 'page-title-icon';
        titleIcon.textContent = '🎓';
    }
    updatePageTitle();
    if (window.FamilyUserSwitcher && typeof window.FamilyUserSwitcher.renderAuto === 'function') {
        window.FamilyUserSwitcher.renderAuto(document.getElementById('practiceHomeHeaderActions'));
    }
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

// =====================================================================
// === 4. Category progress model + chooser rendering
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
    todaySessionStatusByCategory,
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
    const sessionStatus = todaySessionStatusByCategory?.[categoryKey] || {};
    const earnedPoints = Number.parseInt(sessionStatus?.earnedPoints ?? sessionStatus?.earned_points, 10) || 0;
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
        earnedPoints,
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
    const statusPillItems = [];
    const statusPillLabels = [];
    if (progressModel.redoCount > 0) {
        statusPillItems.push(`<span class="practice-row-status-pill redo">${escapeHtmlLocal(String(progressModel.redoCount))} to fix</span>`);
        statusPillLabels.push(`${progressModel.redoCount} to fix`);
    }
    if (progressModel.unseenCount > 0) {
        statusPillItems.push(`<span class="practice-row-status-pill unseen">${escapeHtmlLocal(String(progressModel.unseenCount))} to do</span>`);
        statusPillLabels.push(`${progressModel.unseenCount} to do`);
    }
    const statusPillsHtml = progressModel.targetCount > 0
        && statusPillItems.length > 0
        ? `<div class="practice-row-status-pills" aria-label="${escapeHtmlLocal(statusPillLabels.join(', '))}">
            ${statusPillItems.join('')}
        </div>`
        : '';
    const subTextHtml = progressModel.targetCount > 0
        ? ''
        : `<div class="practice-row-sub">${escapeHtmlLocal(progressModel.subText)}</div>`;

    const tileHtml = window.DeckCategoryCommon.renderCategorySubjectIcon(categoryKey);
    const actionLabel = progressModel.isFullyComplete
        ? formatDonePointsStatus(progressModel.earnedPoints)
        : progressModel.actionLabel;
    const actionIconName = progressModel.isFullyComplete
        ? 'check'
        : ({ Start: 'play', Review: 'refresh-cw', Resume: 'circle-arrow-right' }[progressModel.actionLabel] || 'play');
    const actionIconHtml = (typeof window.icon === 'function') ? window.icon(actionIconName, { size: 18, strokeWidth: 2.4 }) : '';
    return `
        <span class="practice-row-tile" aria-hidden="true">${tileHtml}</span>
        <div class="practice-row-content">
            <div class="practice-row-head">
                <h3>${escapeHtmlLocal(displayName)}</h3>
                ${statusPillsHtml}
            </div>
            ${subTextHtml}
            <div class="practice-row-progress-line">
                <div class="practice-row-progress" aria-hidden="true">
                    <span class="practice-row-seg mastered" style="width:${progressModel.masteredPercent}%"></span>
                    <span class="practice-row-seg redo" style="width:${progressModel.redoPercent}%"></span>
                    <span class="practice-row-seg unseen" style="width:${progressModel.unseenPercent}%"></span>
                </div>
            </div>
        </div>
        <span class="practice-row-chevron${progressModel.isFullyComplete ? ' is-done' : ''}" aria-hidden="true">
            ${actionIconHtml}
            <span class="practice-row-action-label">${escapeHtmlLocal(actionLabel)}</span>
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
    todaySessionStatusByCategory,
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
        todaySessionStatusByCategory,
        practiceTargetByCategory,
    });
    button.innerHTML = buildCategoryCardInnerHtml({
        categoryKey,
        displayName,
        progressModel: model,
    });
    return model;
}

function clearPracticeOptionButtons() {
    if (!practiceChooser) {
        return;
    }
    practiceChooser.innerHTML = '';
}

function normalizeOffAppChorePayload(payload) {
    const chores = Array.isArray(payload?.chores) ? payload.chores : [];
    const pendingItems = Array.isArray(payload?.pending) ? payload.pending : [];
    const pendingByRuleId = new Map();
    pendingItems.forEach((pending) => {
        const ruleId = Number.parseInt(pending?.ruleId, 10);
        if (Number.isInteger(ruleId) && ruleId > 0) {
            pendingByRuleId.set(ruleId, pending);
        }
    });
    chores.forEach((chore) => {
        const ruleId = Number.parseInt(chore?.ruleId, 10);
        if (!Number.isInteger(ruleId) || ruleId <= 0 || pendingByRuleId.has(ruleId)) {
            return;
        }
        if (chore?.pending && typeof chore.pending === 'object') {
            pendingByRuleId.set(ruleId, chore.pending);
        }
    });
    return { chores, pendingByRuleId };
}

async function loadOffAppChores() {
    if (!kidId || isOfflineMode || offAppChoreState.loading) {
        return;
    }
    offAppChoreState = {
        ...offAppChoreState,
        loading: true,
    };
    renderPracticeOptions();
    try {
        const response = await fetch(`${API_BASE}/kids/${encodeURIComponent(kidId)}/off-app-chores`);
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }
        const normalized = normalizeOffAppChorePayload(await response.json());
        offAppChoreState = {
            loaded: true,
            loading: false,
            chores: normalized.chores,
            pendingByRuleId: normalized.pendingByRuleId,
            savingRuleId: null,
        };
    } catch (error) {
        console.error('Error loading off-app chores:', error);
        offAppChoreState = {
            ...offAppChoreState,
            loaded: true,
            loading: false,
            chores: [],
            pendingByRuleId: new Map(),
            savingRuleId: null,
        };
    }
    renderPracticeOptions();
}

function renderOffAppTaskIcon(chore) {
    const emoji = String(chore?.emoji || '').trim();
    if (emoji) {
        return `<span class="off-app-task-emoji" aria-hidden="true">${escapeHtmlLocal(emoji)}</span>`;
    }
    return `<span class="off-app-task-fallback-icon" aria-hidden="true">${icon('clipboard-check', { size: 22 })}</span>`;
}

function formatDonePointsStatus(pointsValue) {
    const points = Number.parseInt(pointsValue, 10);
    if (!Number.isInteger(points) || points === 0) return 'Done';
    return `Done ${points > 0 ? '+' : ''}${points}`;
}

function formatCreditedOffAppStatus(event) {
    const points = Number.parseInt(event?.pointsDelta, 10);
    if (!Number.isInteger(points) || points === 0) {
        return 'Done Today';
    }
    return `Done ${points > 0 ? '+' : ''}${points}`;
}

function renderOffAppTaskRow(chore) {
    const ruleId = Number.parseInt(chore?.ruleId, 10);
    if (!Number.isInteger(ruleId) || ruleId <= 0) {
        return '';
    }
    const creditedEvent = chore?.creditedEvent && typeof chore.creditedEvent === 'object'
        ? chore.creditedEvent
        : null;
    const pending = offAppChoreState.pendingByRuleId.get(ruleId) || null;
    const isPending = Boolean(pending);
    const isCreditedToday = Boolean(chore?.creditedToday || creditedEvent);
    const isChecked = isPending || isCreditedToday;
    const isSaving = Number.parseInt(offAppChoreState.savingRuleId, 10) === ruleId;
    const name = String(chore?.name || '').trim() || 'Task';
    const statusText = isCreditedToday
        ? formatCreditedOffAppStatus(creditedEvent)
        : (isPending ? 'Reviewing' : "I'm done");
    const actionIcon = isCreditedToday
        ? 'check'
        : (isPending ? 'clock' : 'check');
    const classes = [
        'off-app-task-row',
        isChecked ? 'is-checked' : '',
        isCreditedToday ? 'is-credited' : '',
        isSaving ? 'is-saving' : '',
    ].filter(Boolean).join(' ');
    const disabled = (isSaving || isPending || isCreditedToday) ? ' disabled' : '';
    const ariaPressed = isChecked ? 'true' : 'false';
    return `
        <button type="button" class="${classes}" data-off-app-rule-id="${ruleId}" aria-pressed="${ariaPressed}"${disabled}>
            <span class="off-app-task-tile">${renderOffAppTaskIcon(chore)}</span>
            <span class="off-app-task-name">${escapeHtmlLocal(name)}</span>
            <span class="off-app-task-action">
                ${icon(actionIcon, { size: 18 })}
                <span>${isSaving ? 'Saving...' : escapeHtmlLocal(statusText)}</span>
            </span>
        </button>
    `;
}

function renderOffAppTasks() {
    if (!offAppPracticeSection || !offAppChooser) {
        return 0;
    }
    if (isOfflineMode) {
        offAppPracticeSection.classList.add('hidden');
        offAppChooser.innerHTML = '';
        return 0;
    }
    if (offAppChoreState.loading && !offAppChoreState.loaded) {
        offAppPracticeSection.classList.remove('hidden');
        offAppChooser.innerHTML = '<div class="off-app-task-empty">Loading tasks...</div>';
        return 0;
    }
    const chores = Array.isArray(offAppChoreState.chores)
        ? offAppChoreState.chores.filter((chore) => chore && chore.isActive !== false)
        : [];
    if (chores.length <= 0) {
        offAppPracticeSection.classList.add('hidden');
        offAppChooser.innerHTML = '';
        return 0;
    }
    offAppPracticeSection.classList.remove('hidden');
    offAppChooser.innerHTML = chores.map((chore) => renderOffAppTaskRow(chore)).join('');
    return chores.length;
}

async function handleOffAppTaskToggle(ruleIdValue) {
    const ruleId = Number.parseInt(ruleIdValue, 10);
    if (!Number.isInteger(ruleId) || ruleId <= 0 || offAppChoreState.savingRuleId) {
        return;
    }
    const chore = (offAppChoreState.chores || []).find((item) => Number.parseInt(item?.ruleId, 10) === ruleId);
    if (!chore) {
        return;
    }
    if (chore.creditedToday || chore.creditedEvent) {
        showError('This task has already been checked by your parent today.');
        return;
    }
    const pending = offAppChoreState.pendingByRuleId.get(ruleId) || null;
    if (pending) {
        showError('This task is waiting for parent review.');
        return;
    }

    offAppChoreState = { ...offAppChoreState, savingRuleId: ruleId };
    renderPracticeOptions();
    try {
        const response = await fetch(`${API_BASE}/kids/${encodeURIComponent(kidId)}/off-app-chores/${ruleId}/submit`, {
            method: 'POST',
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
            throw new Error(payload.error || `HTTP ${response.status}`);
        }
        offAppChoreState = { ...offAppChoreState, savingRuleId: null };
        await loadOffAppChores();
    } catch (error) {
        showError(error.message || 'Could not check off this task.');
        void loadOffAppChores();
    } finally {
        offAppChoreState = { ...offAppChoreState, savingRuleId: null };
        renderPracticeOptions();
    }
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
    todaySessionStatusByCategory,
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

        const model = renderPracticeOptionCard({
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
            todaySessionStatusByCategory,
            practiceTargetByCategory,
        });
        button.disabled = Boolean(model?.isFullyComplete);
        if (model?.isFullyComplete) {
            button.setAttribute('aria-disabled', 'true');
        } else {
            button.addEventListener('click', () => {
                runDynamicPracticeByBehavior(key, behaviorType, Boolean(meta.has_chinese_specific_logic));
            });
        }

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
    const dailyStartedByCategory = getCategoryValueMap(currentKid?.dailyStartedByDeckCategory);
    const dailyStarTiersByCategory = getCategoryRawValueMap(currentKid?.dailyStarTiersByDeckCategory);
    const dailyPercentByCategory = getCategoryValueMap(currentKid?.dailyPercentByDeckCategory);
    const dailyTargetByCategory = getCategoryValueMap(currentKid?.dailyTargetByDeckCategory);
    const dailyTriedByCategory = getCategoryValueMap(currentKid?.dailyTriedByDeckCategory);
    const dailyRightByCategory = getCategoryValueMap(currentKid?.dailyRightByDeckCategory);
    const todaySessionStatusByCategory = getCategoryRawValueMap(currentKid?.todaySessionStatusByDeckCategory);
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
        todaySessionStatusByCategory,
    });
    if (inAppPracticeSection) {
        inAppPracticeSection.classList.toggle('hidden', renderedOptionCount <= 0);
    }
    const renderedOffAppCount = renderOffAppTasks();
    const hasOffAppSection = renderedOffAppCount > 0 || (offAppChoreState.loading && !offAppChoreState.loaded);
    practiceSection.classList.remove('hidden');
    practiceSection.classList.toggle('has-in-app', renderedOptionCount > 0);
    practiceSection.classList.toggle('has-off-app', hasOffAppSection);
    if (renderedOptionCount <= 0 && renderedOffAppCount <= 0 && offAppChoreState.loaded && !offAppChoreState.loading) {
        showError('No daily practice is assigned. Ask your parent to set per-session counts above 0.');
    } else {
        showError('');
    }
}

// =====================================================================
// === 5. Per-type practice launch
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
    if (!offlineGuardOrError(categoryKey)) return;
    const params = new URLSearchParams();
    params.set('id', kidId);
    params.set('categoryKey', categoryKey);
    appendOfflineFlagIfNeeded(params);
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
    if (!offlineGuardOrError(categoryKey)) return;
    const params = new URLSearchParams();
    params.set('id', kidId);
    params.set('categoryKey', categoryKey);
    appendOfflineFlagIfNeeded(params);
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
    if (!offlineGuardOrError(categoryKey)) return;
    const params = new URLSearchParams();
    params.set('id', kidId);
    params.set('categoryKey', categoryKey);
    appendOfflineFlagIfNeeded(params);
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
    if (!offlineGuardOrError(categoryKey)) return;
    const params = new URLSearchParams();
    params.set('id', kidId);
    params.set('categoryKey', categoryKey);
    appendOfflineFlagIfNeeded(params);
    cacheKidForPracticeNavigation();
    window.location.href = `/kid-practice.html?${params.toString()}`;
}

// =====================================================================
// === 6. Misc helpers
// =====================================================================
function showError(message) {
    window.PracticeUiCommon.showAlertError(errorState, errorMessage, message);
}

// =====================================================================
// === 7. Offline practice home (replaces sections 4–5 when offline)
// =====================================================================

async function bootstrapOfflinePracticeHome(pack) {
    const env = pack.packEnvelope || {};
    const baseKidInfo = env.kidInfo || { id: kidId, name: env.kid_name || '' };

    // Engage offline mode so navigation appends &offline=1 and gates subjects
    // not present in the downloaded pack.
    isOfflineMode = true;
    offlinePackExpired = isPackExpired(env);
    markOfflineHomeUrl();
    if (window.KidAppNavigation && typeof window.KidAppNavigation.setSuppressed === 'function') {
        window.KidAppNavigation.setSuppressed(true);
    }

    // Fold locally-saved practice answers into the (acquire-time-frozen)
    // daily counts so progress bars actually move as the kid practices.
    let pendingResults = [];
    if (window.OfflineStorage) {
        try {
            pendingResults = await window.OfflineStorage.listPendingResults(kidId);
        } catch (_) { /* best-effort */ }
    }
    const kidInfo = mergeOfflineLocalProgress(baseKidInfo, pendingResults);

    // Build the available-category set. A subject stays clickable while any
    // cached card has no latest answer (unattempted) OR its latest answer is
    // still wrong (retry available). Latest = most recent across the source
    // row + every `__retry_N` round, so a card the kid retried to success
    // correctly drops out of the "to fix" set and the subject can grey out.
    const rowsBySourcePid = _groupOfflineRowsBySourcePid(pendingResults);
    offlinePackCategorySet = new Set(
        (Array.isArray(pack.sessions) ? pack.sessions : [])
            .filter((s) => {
                const sourcePid = String(s?.pendingSessionId || '');
                const cards = Array.isArray(s?.payload?.cards) ? s.payload.cards : [];
                if (cards.length === 0) return false;
                const latestByCardId = _latestAnswersByCardId(rowsBySourcePid.get(sourcePid) || []);
                const expectedCards = Array.isArray(s?.payload?.pending_payload?.cards)
                    ? s.payload.pending_payload.cards : cards;
                for (const card of cards) {
                    if (!card || card.id == null) continue;
                    const latest = latestByCardId.get(String(card.id));
                    if (!latest) return true;
                    if (isOfflineAnswerWrong(latest, expectedCards)) return true;
                }
                return false;
            })
            .map((s) => normalizeCategoryKey(s.categoryKey))
            .filter(Boolean)
    );

    applyKidPayload(kidInfo);

    renderPracticeOptions();

    // Dim subjects whose pack wasn't downloaded (offlineGuardOrError handles
    // the click rejection).
    if (practiceChooser) {
        practiceChooser.querySelectorAll('.practice-option[data-category-key]').forEach((btn) => {
            const key = normalizeCategoryKey(btn.getAttribute('data-category-key'));
            if (offlinePackExpired || !offlinePackCategorySet.has(key)) {
                btn.classList.add('is-offline-unavailable');
            }
        });
    }

    if (practiceSection) practiceSection.classList.remove('hidden');
}

// Type-I/II/III answers carry `known` (kid self-grades). Type-IV has no
// `known` field — the server grades by string equality (or a custom
// validate fn). Offline we mirror the simple equality path against the
// cached pending payload's expected answers; custom validators can't run
// client-side, so partial credit waits for sync.
function _buildExpectedAnswerMap(cards) {
    const map = new Map();
    for (const card of (cards || [])) {
        if (!card || card.id == null) continue;
        map.set(String(card.id), String(card.answer || '').trim());
    }
    return map;
}

function isOfflineAnswerWrong(answer, expectedCards) {
    if (!answer) return false;
    if (typeof answer.known === 'boolean') return answer.known === false;
    const expectedById = _buildExpectedAnswerMap(expectedCards);
    const expected = expectedById.get(String(answer.cardId));
    // Defensive: missing expected counts as wrong so the subject stays
    // reviewable (sync will reconcile).
    if (expected === undefined) return true;
    return String(answer.submittedAnswer ?? '').trim() !== expected;
}

function countLocallyRightAnswers(row, answers) {
    const expectedById = _buildExpectedAnswerMap(row?.pendingPayload?.cards);
    let right = 0;
    for (const a of answers) {
        if (!a) continue;
        if (typeof a.known === 'boolean') {
            if (a.known === true) right += 1;
            continue;
        }
        const expected = expectedById.get(String(a.cardId));
        if (expected === undefined) continue;
        const submitted = String(a.submittedAnswer ?? '').trim();
        if (submitted === expected) right += 1;
    }
    return right;
}

// Group rows by their source pid so each retry round folds back into the
// session it belongs to (online retries UPDATE the source session row instead
// of inserting new ones — offline mirrors that aggregation here).
function _retryPidSourceOf(pid) {
    const m = String(pid || '').match(/^(.+)__retry_(\d+)$/);
    return m ? m[1] : String(pid || '');
}

function _groupOfflineRowsBySourcePid(rows) {
    const out = new Map();
    for (const row of (rows || [])) {
        const pid = String(row?.pendingSessionId || '');
        if (!pid) continue;
        const src = _retryPidSourceOf(pid);
        if (!out.has(src)) out.set(src, []);
        out.get(src).push(row);
    }
    for (const list of out.values()) {
        list.sort((a, b) => (Number(a?.createdAtTs) || 0) - (Number(b?.createdAtTs) || 0));
    }
    return out;
}

function _latestAnswersByCardId(rows) {
    const map = new Map();
    for (const row of (rows || [])) {
        for (const a of (Array.isArray(row.answers) ? row.answers : [])) {
            if (!a || a.cardId == null) continue;
            map.set(String(a.cardId), a);
        }
    }
    return map;
}

function mergeOfflineLocalProgress(baseKidInfo, pendingResults) {
    const completedDelta = {};
    const triedDelta = {};
    const rightDelta = {};
    const tierDelta = {};
    const latestPercentByCategory = {};
    const groups = [..._groupOfflineRowsBySourcePid(pendingResults).values()]
        .filter((rows) => rows.length > 0)
        .sort((a, b) => (Number(a[0]?.createdAtTs) || 0) - (Number(b[0]?.createdAtTs) || 0));
    for (const rows of groups) {
        const cat = String(rows[0]?.sessionType || '').trim();
        if (!cat) continue;
        const latest = [..._latestAnswersByCardId(rows).values()];
        const sourceCards = Array.isArray(rows[0]?.pendingPayload?.cards)
            ? rows[0].pendingPayload.cards : [];
        const tried = latest.length;
        const right = countLocallyRightAnswers(rows[0], latest);
        const target = Math.max(sourceCards.length, tried);
        const isIncomplete = sourceCards.length > 0 && tried < sourceCards.length;
        // Match server semantics: 1 session row per source pid; base_tier is
        // half_silver while the source isn't finished and gold once it is.
        completedDelta[cat] = (completedDelta[cat] || 0) + 1;
        triedDelta[cat] = (triedDelta[cat] || 0) + tried;
        rightDelta[cat] = (rightDelta[cat] || 0) + right;
        tierDelta[cat] = tierDelta[cat] || [];
        tierDelta[cat].push(isIncomplete ? 'half_silver' : 'gold');
        const percentNumer = isIncomplete ? tried : right;
        latestPercentByCategory[cat] = target > 0
            ? Math.max(0, Math.min(100, Math.round((percentNumer / target) * 100)))
            : 0;
    }
    const bumpNumber = (base, delta) => {
        const out = { ...(base || {}) };
        for (const k of Object.keys(delta)) {
            out[k] = (Number.parseInt(out[k], 10) || 0) + delta[k];
        }
        return out;
    };
    const bumpArray = (base, delta) => {
        const out = { ...(base || {}) };
        for (const k of Object.keys(delta)) {
            const existing = Array.isArray(out[k]) ? out[k] : [];
            out[k] = [...existing, ...delta[k]];
        }
        return out;
    };
    const overwrite = (base, delta) => {
        const out = { ...(base || {}) };
        for (const k of Object.keys(delta)) out[k] = delta[k];
        return out;
    };
    return {
        ...baseKidInfo,
        dailyCompletedByDeckCategory: bumpNumber(baseKidInfo.dailyCompletedByDeckCategory, completedDelta),
        dailyTriedByDeckCategory: bumpNumber(baseKidInfo.dailyTriedByDeckCategory, triedDelta),
        dailyRightByDeckCategory: bumpNumber(baseKidInfo.dailyRightByDeckCategory, rightDelta),
        dailyStarTiersByDeckCategory: bumpArray(baseKidInfo.dailyStarTiersByDeckCategory, tierDelta),
        dailyPercentByDeckCategory: overwrite(baseKidInfo.dailyPercentByDeckCategory, latestPercentByCategory),
    };
}

function isPackExpired(envelope) {
    if (!envelope || !envelope.expires_at_utc) return false;
    const d = window.OfflineCommon && window.OfflineCommon.parseIsoUtc(envelope.expires_at_utc);
    return !!(d && d.getTime() <= Date.now());
}

