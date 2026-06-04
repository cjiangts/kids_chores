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

let isOfflineMode = false;
let offlinePackCategorySet = null;
let offlinePackExpired = false;

function appendOfflineFlagIfNeeded(params) {
    if (isOfflineMode) params.set('offline', '1');
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
        if (isOfflineMode) {
            await loadKidsForToggleFromLocalPacks();
            return;
        }
        const [kidsResponse, locksByKidId, ownedKidIdSet] = await Promise.all([
            fetch(`${API_BASE}/kids?view=admin`),
            fetchOfflineLockMap(),
            loadOwnedKidIdSet(),
        ]);
        if (!kidsResponse.ok) throw new Error(`HTTP ${kidsResponse.status}`);
        const kids = await kidsResponse.json();
        const all = Array.isArray(kids) ? kids : [];
        const list = all.filter((kid) => {
            const id = String(kid?.id || '');
            if (id === kidId) return true;
            if (!kidHasPracticeTarget(kid)) return false;
            const lock = locksByKidId[id];
            if (lock && !ownedKidIdSet.has(id)) return false;
            return true;
        });
        renderKidToggle(list, { locksByKidId, ownedKidIdSet });
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

async function loadKidsForToggleFromLocalPacks() {
    if (!window.OfflineStorage) {
        if (kidToggleGroup) { kidToggleGroup.classList.add('hidden'); kidToggleGroup.innerHTML = ''; }
        return;
    }
    const packs = await window.OfflineStorage.listAllPacks();
    const ownedKidIdSet = new Set((packs || []).map((p) => String(p.kidId)));
    const locksByKidId = {};
    const list = (packs || []).map((p) => {
        const env = p.packEnvelope || {};
        const info = env.kidInfo || {};
        const id = String(p.kidId);
        locksByKidId[id] = {
            pack_id: String(env.pack_id || ''),
            device_label: String(env.device_label || ''),
            acquired_at_utc: env.acquired_at_utc || null,
            expires_at_utc: env.expires_at_utc || null,
        };
        return {
            ...info,
            id,
            name: String(info.name || env.kid_name || '').trim() || 'Kid',
        };
    }).filter((kid) => kidHasPracticeTarget(kid) || String(kid.id) === String(kidId));
    renderKidToggle(list, { locksByKidId, ownedKidIdSet });
}

async function fetchOfflineLockMap() {
    try {
        const res = await fetch(`${API_BASE}/offline/status`);
        if (!res.ok) return {};
        const payload = await res.json();
        const locks = Array.isArray(payload?.locks) ? payload.locks : [];
        const map = {};
        for (const lock of locks) {
            const kid = String(lock?.kid_id || '');
            if (kid) map[kid] = lock;
        }
        return map;
    } catch (_) {
        return {};
    }
}

async function loadOwnedKidIdSet() {
    if (!window.OfflineStorage) return new Set();
    try {
        const ids = await window.OfflineStorage.listOwnedKidIds();
        return new Set((ids || []).map((v) => String(v)));
    } catch (_) {
        return new Set();
    }
}

function renderKidToggle(kids, opts) {
    if (!kidToggleGroup) return;
    const list = Array.isArray(kids) ? kids : [];
    if (list.length < 2) {
        kidToggleGroup.classList.add('hidden');
        kidToggleGroup.innerHTML = '';
        return;
    }
    const locksByKidId = (opts && opts.locksByKidId) || {};
    const ownedKidIdSet = (opts && opts.ownedKidIdSet) || new Set();
    const userIconSvg = (typeof window.icon === 'function')
        ? window.icon('user', { className: 'kid-nav-card-icon', strokeWidth: 2 })
        : '';
    kidToggleGroup.innerHTML = list.map((kid) => {
        const id = String(kid?.id || '');
        const name = String(kid?.name || '').trim() || 'Kid';
        const isActive = id === String(kidId);
        const lock = locksByKidId[id];
        const isOwned = ownedKidIdSet.has(id);
        const isLockedHere = Boolean(lock) && isOwned;
        const isLockedElsewhere = Boolean(lock) && !isOwned;
        const nameHtml = `<span>${escapeHtmlLocal(name)}</span>`;
        const { assigned, done } = computeKidToggleProgress(kid);
        const progressMeta = assigned > 0
            ? `<span class="kid-nav-card-meta${done >= assigned ? ' is-done' : ''}">${done}/${assigned} done</span>`
            : '';

        if (isActive) {
            return `<span class="kid-nav-card active" role="tab" aria-selected="true">${userIconSvg}${nameHtml}${progressMeta}</span>`;
        }
        if (isLockedElsewhere) {
            const deviceLabel = String(lock.device_label || '').trim() || 'another device';
            const offlineMeta = `<span class="kid-nav-card-meta is-offline-elsewhere" title="Offline on ${escapeHtmlLocal(deviceLabel)}">Offline</span>`;
            return `<span class="kid-nav-card is-offline-elsewhere" role="tab" aria-selected="false" aria-disabled="true" title="Offline on ${escapeHtmlLocal(deviceLabel)}">${userIconSvg}${nameHtml}${offlineMeta}</span>`;
        }
        if (isLockedHere) {
            // Kid has an offline pack on this device. When we're also in offline
            // mode, both kids "match" the current mode — show normal progress
            // numbers and let the click switch into her offline home. The
            // "Offline" badge is only useful in online mode (signals that this
            // kid has been checked out into a local pack).
            const href = `/kid-practice-home.html?id=${encodeURIComponent(id)}`;
            if (isOfflineMode) {
                return `<a class="kid-nav-card" role="tab" aria-selected="false" href="${escapeHtmlLocal(href)}">${userIconSvg}${nameHtml}${progressMeta}</a>`;
            }
            const offlineMeta = '<span class="kid-nav-card-meta is-offline-here" title="Offline on this device">Offline</span>';
            return `<a class="kid-nav-card is-offline-here" role="tab" aria-selected="false" href="${escapeHtmlLocal(href)}">${userIconSvg}${nameHtml}${offlineMeta}</a>`;
        }
        if (isOfflineMode) {
            return `<span class="kid-nav-card is-offline-elsewhere" role="tab" aria-selected="false" aria-disabled="true" title="Sync before switching kids">${userIconSvg}${nameHtml}${progressMeta}</span>`;
        }
        const href = `/kid-practice-home.html?id=${encodeURIComponent(id)}`;
        return `<a class="kid-nav-card" role="tab" aria-selected="false" href="${escapeHtmlLocal(href)}">${userIconSvg}${nameHtml}${progressMeta}</a>`;
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
        // If this device owns an offline pack, recover by routing to that kid's
        // offline practice home instead of bouncing to '/', which (when the SW
        // shell falls back to this very page) would loop forever.
        let ownedIds = [];
        if (window.OfflineStorage) {
            try { ownedIds = await window.OfflineStorage.listOwnedKidIds(); } catch (_) { /* ignore */ }
        }
        if (ownedIds.length > 0) {
            window.location.replace(`/kid-practice-home.html?id=${encodeURIComponent(ownedIds[0])}`);
        } else {
            window.location.replace('/index.html');
        }
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
    const actionIconName = { Start: 'play', Review: 'refresh-cw', Resume: 'circle-arrow-right' }[progressModel.actionLabel] || 'play';
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
        <span class="practice-row-chevron" aria-hidden="true">
            ${actionIconHtml}
            <span class="practice-row-action-label">${escapeHtmlLocal(progressModel.actionLabel)}</span>
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
            label: 'Badges',
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
// === 7. Misc helpers
// =====================================================================
function showError(message) {
    window.PracticeUiCommon.showAlertError(errorState, errorMessage, message);
}

// =====================================================================
// === 8. Offline practice home (replaces sections 4–6 when offline)
// =====================================================================

async function bootstrapOfflinePracticeHome(pack) {
    const env = pack.packEnvelope || {};
    const baseKidInfo = env.kidInfo || { id: kidId, name: env.kid_name || '' };

    // Engage offline mode so navigation appends &offline=1 and gates subjects
    // not present in the downloaded pack.
    isOfflineMode = true;
    offlinePackExpired = isPackExpired(env);

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

    // Replace Home button with Sync (only visible offline-mode chrome).
    const headerActions = document.getElementById('practiceHomeHeaderActions');
    if (headerActions) {
        headerActions.innerHTML = `
            <button type="button" id="offlineSyncBtn" class="back-btn btn-secondary page-header-back-btn offline-sync-btn" aria-label="Sync practice results" title="Sync practice results"></button>
        `;
        await renderSyncButtonContents();
        const syncBtn = document.getElementById('offlineSyncBtn');
        if (syncBtn) syncBtn.addEventListener('click', () => handleOfflineSyncClick());
    }

    // Kid toggle is rebuilt from local IndexedDB packs (no network).
    void loadKidsForToggle();
    renderPracticeOptions();

    // Suppress the Today's Sessions / Earned Badges strip in offline mode.
    if (practiceSummaryStrip) {
        practiceSummaryStrip.classList.add('hidden');
        practiceSummaryStrip.innerHTML = '';
    }

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

async function countPendingAnswersAcrossOwnedKids() {
    if (!window.OfflineStorage) return 0;
    try {
        const ownedIds = await window.OfflineStorage.listOwnedKidIds();
        let total = 0;
        for (const id of ownedIds) {
            const rows = await window.OfflineStorage.listPendingResults(id);
            for (const row of rows) {
                total += Array.isArray(row?.answers) ? row.answers.length : 0;
            }
        }
        return total;
    } catch (_) {
        return 0;
    }
}

async function renderSyncButtonContents() {
    const btn = document.getElementById('offlineSyncBtn');
    if (!btn) return;
    const pendingCount = await countPendingAnswersAcrossOwnedKids();
    const iconHtml = (typeof window.icon === 'function') ? window.icon('refresh-ccw', { size: 18 }) : '';
    const countHtml = pendingCount > 0
        ? `<span class="offline-sync-count" aria-label="${pendingCount} answers pending">${pendingCount}</span>`
        : '';
    btn.innerHTML = `${iconHtml}<span>Sync</span>${countHtml}`;
}

async function handleOfflineSyncClick() {
    const btn = document.getElementById('offlineSyncBtn');
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<span>Syncing…</span>';
    }
    const restoreBtn = async () => {
        if (!btn) return;
        btn.disabled = false;
        await renderSyncButtonContents();
    };
    try {
        let ownedIds = [];
        if (window.OfflineStorage) {
            try {
                ownedIds = await window.OfflineStorage.listOwnedKidIds();
            } catch (_) { /* ignore */ }
        }
        const targetIds = Array.from(new Set([String(kidId), ...ownedIds.map((v) => String(v))])).filter(Boolean);

        const failures = [];
        const discards = [];
        for (const targetId of targetIds) {
            const localPack = window.OfflineStorage
                ? await window.OfflineStorage.loadPack(targetId)
                : null;
            const rows = window.OfflineStorage
                ? await window.OfflineStorage.listPendingResults(targetId)
                : [];
            const pendingCount = rows.length;
            const queuedThumbDownCount = Array.isArray(localPack?.packEnvelope?.thumbDownEvents)
                ? localPack.packEnvelope.thumbDownEvents.length
                : 0;
            const result = (pendingCount === 0 && queuedThumbDownCount === 0)
                ? await window.OfflineCommon.releasePack(targetId)
                : await window.OfflineCommon.syncPack(targetId);
            if (!result || !result.ok) {
                const errText = (result && (result.error || (result.response && result.response.error))) || 'Sync failed';
                failures.push({ kidId: targetId, error: errText });
                continue;
            }
            const resp = result.response || {};
            if (resp.conflict_warning) {
                discards.push({
                    kidId: targetId,
                    reason: String(resp.conflict_warning || ''),
                    sessions: Number(resp.discarded_session_count) || 0,
                    answers: Number(resp.discarded_answer_count) || 0,
                });
            }
        }

        if (failures.length > 0) {
            const msg = failures.map((f) => `kid ${f.kidId}: ${f.error}`).join('\n');
            window.alert(
                `Could not sync ${failures.length} pack(s):\n${msg}\n\n`
                + 'Your practice results are still saved on this device — reconnect and tap Sync again.',
            );
            await restoreBtn();
            return;
        }
        if (discards.length > 0) {
            const totalAnswers = discards.reduce((sum, d) => sum + d.answers, 0);
            const anyForceReleased = discards.some((d) => d.reason === 'lock_expired_or_released');
            const headline = anyForceReleased
                ? 'The server has dropped this offline pack — most likely because someone clicked the trash button on the family home, or the pack expired at midnight.'
                : 'Another device has taken over this offline pack since this device went offline.';
            window.alert(
                `${headline}\n\n`
                + `${totalAnswers} practice answer${totalAnswers === 1 ? '' : 's'} from this device `
                + `had to be discarded. Nothing on the server changed.`,
            );
        }
        window.location.href = '/admin.html';
    } catch (e) {
        const msg = (e && e.message) ? String(e.message) : String(e);
        window.alert(
            `Sync error: ${msg}\n\n`
            + 'Your practice results are still saved on this device — reconnect and tap Sync again.',
        );
        await restoreBtn();
    }
}
