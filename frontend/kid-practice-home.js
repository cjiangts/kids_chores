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
const chinesePracticeOption = document.getElementById('chinesePracticeOption');
const writingPracticeOption = document.getElementById('writingPracticeOption');
const mathPracticeOption = document.getElementById('mathPracticeOption');
const lessonReadingPracticeOption = document.getElementById('lessonReadingPracticeOption');
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
const errorState = { lastMessage: '' };
const VALID_BEHAVIOR_TYPES = new Set(['type_i', 'type_ii', 'type_iii']);

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

function runDynamicPracticeByBehavior(categoryKey, behaviorType, hasChineseSpecificLogic) {
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
    await loadKidInfo();
    renderPracticeOptions();
    window.setTimeout(() => {
        void warmWritingCards();
    }, 0);
});

async function loadKidInfo() {
    try {
        const response = await fetch(`${API_BASE}/kids/${kidId}?view=practice_home`);
        if (!response.ok) {
            throw new Error('Kid not found');
        }
        currentKid = await response.json();
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
        kidNameEl.textContent = `${currentKid.name}'s Practice`;
        updatePageTitle();
    } catch (error) {
        console.error('Error loading kid:', error);
        showError('Failed to load kid information');
        setTimeout(() => {
            window.location.href = '/';
        }, 2000);
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

function buildCategoryProgressModel({
    categoryKey,
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
    const masteredPercent = targetCount > 0
        ? Math.max(0, Math.min(100, (masteredCount / targetCount) * 100))
        : 0;
    const redoPercent = targetCount > 0
        ? Math.max(0, Math.min(100, (redoCount / targetCount) * 100))
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

    let statusClass = 'not-started';
    let statusText = 'Not started';
    if (starsModel.isDoneToday) {
        statusClass = 'done';
        statusText = 'Done';
    } else if (fillPercent > 0) {
        statusClass = 'in-progress';
        statusText = 'In progress';
    }

    const subText = targetCount > 0
        ? `${masteredCount} mastered · ${redoCount} redo · ${seenCount}/${targetCount} seen`
        : 'Not started';
    const unseenCount = targetCount > 0
        ? Math.max(0, targetCount - seenCount)
        : 0;
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
        masteredCount,
        redoCount,
        unseenCount,
        masteredPercent,
        redoPercent,
        unseenPercent,
        isDoneToday: starsModel.isDoneToday,
    };
}

function buildCategoryCardInnerHtml({
    emoji,
    displayName,
    progressModel,
}) {
    let rightBadgeHtml = `<span class="practice-row-status-pill ${progressModel.statusClass}">${progressModel.statusText}</span>`;
    if (progressModel.isDoneToday && progressModel.starCount > 0) {
        rightBadgeHtml = renderStarTokenSetHtml(progressModel.starCount, {
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
                ${escapeHtmlLocal(String(progressModel.redoCount))} redo
            </span>
            <span class="practice-row-legend-item">
                <span class="practice-row-legend-dot unseen" aria-hidden="true"></span>
                ${escapeHtmlLocal(String(progressModel.unseenCount))} out of ${escapeHtmlLocal(String(progressModel.targetCount))} unseen
            </span>
        </div>`
        : `<div class="practice-row-sub">${escapeHtmlLocal(progressModel.subText)}</div>`;

    return `
        <div class="practice-row-head">
            <h3>${escapeHtmlLocal(emoji)} ${escapeHtmlLocal(displayName)}</h3>
            <div class="practice-row-right">${rightBadgeHtml}</div>
        </div>
        ${subTextHtml}
        <div class="practice-row-progress">
            <span class="practice-row-seg mastered" style="width:${progressModel.masteredPercent}%"></span>
            <span class="practice-row-seg redo" style="width:${progressModel.redoPercent}%"></span>
            <span class="practice-row-seg unseen" style="width:${progressModel.unseenPercent}%"></span>
        </div>
    `;
}

function renderPracticeOptionCard({
    button,
    categoryKey,
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
    let inProgressCount = 0;
    let starsTodayCount = 0;

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
        starsTodayCount += model.starCount;
        if (model.isDoneToday) {
            doneCount += 1;
        } else if (model.fillPercent > 0) {
            inProgressCount += 1;
        }
    });

    if (assignedCount <= 0) {
        practiceSummaryStrip.classList.add('hidden');
        practiceSummaryStrip.innerHTML = '';
        return;
    }

    practiceSummaryStrip.innerHTML = `
        <div class="redesign-summary-box">
            <p class="redesign-summary-label">Stars today</p>
            <p class="redesign-summary-value">${starsTodayCount}</p>
        </div>
        <div class="redesign-summary-box">
            <p class="redesign-summary-label">Done</p>
            <p class="redesign-summary-value">${doneCount}/${assignedCount}</p>
        </div>
        <div class="redesign-summary-box">
            <p class="redesign-summary-label">In progress</p>
            <p class="redesign-summary-value">${inProgressCount}</p>
        </div>
    `;
    practiceSummaryStrip.classList.remove('hidden');
}

function getStaticPracticeOptionKeySet() {
    const keys = new Set();
    const nodes = practiceChooser.querySelectorAll('.practice-option[data-category-key]');
    nodes.forEach((node) => {
        const key = normalizeCategoryKey(node.getAttribute('data-category-key'));
        if (key) {
            keys.add(key);
        }
    });
    return keys;
}

function clearDynamicPracticeOptions() {
    const dynamicOptions = practiceChooser.querySelectorAll('.dynamic-practice-option');
    dynamicOptions.forEach((node) => {
        node.remove();
    });
}

function renderDynamicPracticeOptions({
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
    clearDynamicPracticeOptions();
    let renderedCount = 0;
    const staticOptionKeys = getStaticPracticeOptionKeySet();
    optedInCategoryKeys.forEach((categoryKey) => {
        const key = normalizeCategoryKey(categoryKey);
        if (!key || staticOptionKeys.has(key)) {
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
        button.className = 'practice-option redesign-practice-option dynamic-practice-option';
        button.addEventListener('click', () => {
            runDynamicPracticeByBehavior(key, behaviorType, Boolean(meta.has_chinese_specific_logic));
        });

        renderPracticeOptionCard({
            button,
            categoryKey: key,
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

    const optedInSet = getOptedInDeckCategorySet(currentKid);
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
    const typeIChineseSessionCount = Number.parseInt(
        typeIChineseKey ? practiceTargetByCategory?.[typeIChineseKey] : 0,
        10,
    );
    const typeINonChineseKey = resolveTypeINonChinesePracticeCategoryKey(
        currentKid,
        activeTypeINonChineseCategoryKey,
    );
    activeTypeINonChineseCategoryKey = typeINonChineseKey;
    const typeINonChineseSessionCount = Number.parseInt(
        typeINonChineseKey ? practiceTargetByCategory?.[typeINonChineseKey] : 0,
        10,
    );
    const typeIIKey = resolveTypeIIPracticeCategoryKey(currentKid, activeTypeIICategoryKey);
    activeTypeIICategoryKey = typeIIKey;
    const typeIISessionCount = Number.parseInt(
        typeIIKey
            ? practiceTargetByCategory?.[typeIIKey]
            : 0,
        10,
    );
    const typeIIIKey = resolveTypeIIIPracticeCategoryKey(currentKid, activeTypeIIICategoryKey);
    activeTypeIIICategoryKey = typeIIIKey;
    const typeIIISessionCount = Number.parseInt(typeIIIKey ? practiceTargetByCategory?.[typeIIIKey] : 0, 10);

    const chineseEnabled = (
        Boolean(typeIChineseKey)
        && optedInSet.has(typeIChineseKey)
        && Number.isInteger(typeIChineseSessionCount)
        && typeIChineseSessionCount > 0
    );
    const writingEnabled = Boolean(typeIIKey)
        && optedInSet.has(typeIIKey)
        && Number.isInteger(typeIISessionCount)
        && typeIISessionCount > 0;
    const typeINonChineseEnabled = Boolean(typeINonChineseKey)
        && optedInSet.has(typeINonChineseKey)
        && Number.isInteger(typeINonChineseSessionCount)
        && typeINonChineseSessionCount > 0;
    const typeIIIEnabled = Boolean(typeIIIKey)
        && optedInSet.has(typeIIIKey)
        && Number.isInteger(typeIIISessionCount)
        && typeIIISessionCount > 0;
    const typeIIIDisplayName = typeIIIKey ? getCategoryDisplayName(typeIIIKey, categoryMetaMap) : '';
    const typeIIIEmoji = typeIIIKey ? getCategoryEmoji(typeIIIKey, categoryMetaMap) : '';
    const typeIIDisplayName = typeIIKey ? getCategoryDisplayName(typeIIKey, categoryMetaMap) : '';
    const typeIIEmoji = typeIIKey ? getCategoryEmoji(typeIIKey, categoryMetaMap) : '';
    const typeIChineseDisplayName = typeIChineseKey
        ? getCategoryDisplayName(typeIChineseKey, categoryMetaMap)
        : '';
    const typeIChineseEmoji = typeIChineseKey ? getCategoryEmoji(typeIChineseKey, categoryMetaMap) : '';
    const typeINonChineseDisplayName = typeINonChineseKey
        ? getCategoryDisplayName(typeINonChineseKey, categoryMetaMap)
        : '';
    const typeINonChineseEmoji = typeINonChineseKey ? getCategoryEmoji(typeINonChineseKey, categoryMetaMap) : '';
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
    if (chinesePracticeOption) {
        if (typeIChineseKey) {
            chinesePracticeOption.setAttribute('data-category-key', typeIChineseKey);
            renderPracticeOptionCard({
                button: chinesePracticeOption,
                categoryKey: typeIChineseKey,
                displayName: typeIChineseDisplayName,
                emoji: typeIChineseEmoji,
                dailyStarTiersByCategory,
                dailyCompletedByCategory,
                dailyPercentByCategory,
                dailyTargetByCategory,
                dailyTriedByCategory,
                dailyRightByCategory,
                practiceTargetByCategory,
            });
        } else {
            chinesePracticeOption.removeAttribute('data-category-key');
        }
    }
    if (mathPracticeOption) {
        if (typeINonChineseKey) {
            mathPracticeOption.setAttribute('data-category-key', typeINonChineseKey);
            renderPracticeOptionCard({
                button: mathPracticeOption,
                categoryKey: typeINonChineseKey,
                displayName: typeINonChineseDisplayName,
                emoji: typeINonChineseEmoji,
                dailyStarTiersByCategory,
                dailyCompletedByCategory,
                dailyPercentByCategory,
                dailyTargetByCategory,
                dailyTriedByCategory,
                dailyRightByCategory,
                practiceTargetByCategory,
            });
        } else {
            mathPracticeOption.removeAttribute('data-category-key');
        }
    }
    if (lessonReadingPracticeOption) {
        if (typeIIIKey) {
            lessonReadingPracticeOption.setAttribute('data-category-key', typeIIIKey);
            renderPracticeOptionCard({
                button: lessonReadingPracticeOption,
                categoryKey: typeIIIKey,
                displayName: typeIIIDisplayName,
                emoji: typeIIIEmoji,
                dailyStarTiersByCategory,
                dailyCompletedByCategory,
                dailyPercentByCategory,
                dailyTargetByCategory,
                dailyTriedByCategory,
                dailyRightByCategory,
                practiceTargetByCategory,
            });
        } else {
            lessonReadingPracticeOption.removeAttribute('data-category-key');
        }
    }
    if (writingPracticeOption) {
        if (typeIIKey) {
            writingPracticeOption.setAttribute('data-category-key', typeIIKey);
            renderPracticeOptionCard({
                button: writingPracticeOption,
                categoryKey: typeIIKey,
                displayName: typeIIDisplayName,
                emoji: typeIIEmoji,
                dailyStarTiersByCategory,
                dailyCompletedByCategory,
                dailyPercentByCategory,
                dailyTargetByCategory,
                dailyTriedByCategory,
                dailyRightByCategory,
                practiceTargetByCategory,
            });
        } else {
            writingPracticeOption.removeAttribute('data-category-key');
        }
    }

    chinesePracticeOption.classList.toggle('hidden', !chineseEnabled);
    writingPracticeOption.classList.toggle('hidden', !writingEnabled);
    mathPracticeOption.classList.toggle('hidden', !typeINonChineseEnabled);
    lessonReadingPracticeOption.classList.toggle('hidden', !typeIIIEnabled);

    const dynamicOptionCount = renderDynamicPracticeOptions({
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
    if (!chineseEnabled && !writingEnabled && !typeINonChineseEnabled && !typeIIIEnabled && dynamicOptionCount <= 0) {
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

function showError(message) {
    window.PracticeUiCommon.showAlertError(errorState, errorMessage, message);
}
