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
const practiceChooser = document.getElementById('practiceChooser');
const chinesePracticeOption = document.getElementById('chinesePracticeOption');
const writingPracticeOption = document.getElementById('writingPracticeOption');
const writingPracticeTitle = writingPracticeOption
    ? writingPracticeOption.querySelector('h3')
    : null;
const mathPracticeOption = document.getElementById('mathPracticeOption');
const mathPracticeTitle = mathPracticeOption
    ? mathPracticeOption.querySelector('h3')
    : null;
const lessonReadingPracticeOption = document.getElementById('lessonReadingPracticeOption');
const lessonReadingPracticeTitle = lessonReadingPracticeOption
    ? lessonReadingPracticeOption.querySelector('h3')
    : null;
const chineseStarBadge = document.getElementById('chineseStarBadge');
const writingStarBadge = document.getElementById('writingStarBadge');
const mathStarBadge = document.getElementById('mathStarBadge');
const lessonReadingStarBadge = document.getElementById('lessonReadingStarBadge');
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

function getCategoryStarTiers(categoryKey, dailyStarTiersByCategory, dailyCompletedByCategory) {
    const key = normalizeCategoryKey(categoryKey);
    const tiersFromPayload = Array.isArray(dailyStarTiersByCategory?.[key])
        ? dailyStarTiersByCategory[key]
            .map((tier) => String(tier || '').trim().toLowerCase())
            .filter((tier) => tier === 'gold' || tier === 'silver' || tier === 'half_silver')
        : [];
    if (tiersFromPayload.length > 0) {
        return tiersFromPayload;
    }
    const completedCount = Number.parseInt(dailyCompletedByCategory?.[key], 10);
    const safeCount = Number.isInteger(completedCount) ? Math.max(0, completedCount) : 0;
    return Array.from({ length: safeCount }, () => 'gold');
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

function getCategoryStarsHtml(categoryKey, dailyStarTiersByCategory, dailyCompletedByCategory, dailyPercentByCategory) {
    const tiers = getCategoryStarTiers(categoryKey, dailyStarTiersByCategory, dailyCompletedByCategory);
    if (tiers.length === 0) {
        return 'Today: no stars yet<br><span class="practice-star-note practice-star-note-encourage practice-star-note-encourage-zero">0% · Let\'s start and earn a star!</span>';
    }
    const rawPercent = Number.parseFloat(dailyPercentByCategory?.[normalizeCategoryKey(categoryKey)]);
    const latestPercentValue = Number.isFinite(rawPercent) ? Math.max(0, Math.round(rawPercent)) : 0;
    const previousSessionCount = Math.max(0, tiers.length - 1);
    const percentValue = (previousSessionCount * 100) + latestPercentValue;
    const lastTierIndex = Math.max(0, tiers.length - 1);
    const latestTier = String(tiers[lastTierIndex] || '').trim().toLowerCase();
    const starsHtml = `<span class="progress-badge-strip">${tiers.map((tier, index) => (
        renderProgressBadgeByTier(tier, latestPercentValue, index === lastTierIndex)
    )).join('')}</span>`;
    if (latestTier === 'half_silver') {
        return `Today: ${starsHtml}<br><span class="practice-star-note practice-star-note-encourage">${percentValue}% · Finish session first.</span>`;
    }
    if (percentValue < 100) {
        return `Today: ${starsHtml}<br><span class="practice-star-note practice-star-note-encourage">${percentValue}% · Keep trying, you can do it!</span>`;
    }
    if (percentValue < 200) {
        return `Today: ${starsHtml}<br><span class="practice-star-note practice-star-note-good">${percentValue}% · Good job!</span>`;
    }
    return `Today: ${starsHtml}<br><span class="practice-star-note practice-star-note-good">${percentValue}% · Wow! Amazing work!</span>`;
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
        button.className = 'practice-option dynamic-practice-option';
        button.addEventListener('click', () => {
            runDynamicPracticeByBehavior(key, behaviorType, Boolean(meta.has_chinese_specific_logic));
        });

        const title = document.createElement('h3');
        title.textContent = `${getCategoryEmoji(key, categoryMetaMap)} ${getCategoryDisplayName(key, categoryMetaMap)}`;
        button.appendChild(title);

        const stars = document.createElement('p');
        stars.className = 'practice-star-badge';
        stars.innerHTML = getCategoryStarsHtml(
            key,
            dailyStarTiersByCategory,
            dailyCompletedByCategory,
            dailyPercentByCategory,
        );
        button.appendChild(stars);

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

    chineseStarBadge.innerHTML = getCategoryStarsHtml(typeIChineseKey, dailyStarTiersByCategory, dailyCompletedByCategory, dailyPercentByCategory);
    writingStarBadge.innerHTML = getCategoryStarsHtml(typeIIKey, dailyStarTiersByCategory, dailyCompletedByCategory, dailyPercentByCategory);
    mathStarBadge.innerHTML = getCategoryStarsHtml(typeINonChineseKey, dailyStarTiersByCategory, dailyCompletedByCategory, dailyPercentByCategory);
    lessonReadingStarBadge.innerHTML = getCategoryStarsHtml(typeIIIKey, dailyStarTiersByCategory, dailyCompletedByCategory, dailyPercentByCategory);
    if (chinesePracticeOption) {
        if (typeIChineseKey) {
            chinesePracticeOption.setAttribute('data-category-key', typeIChineseKey);
        } else {
            chinesePracticeOption.removeAttribute('data-category-key');
        }
    }
    if (mathPracticeOption) {
        if (typeINonChineseKey) {
            mathPracticeOption.setAttribute('data-category-key', typeINonChineseKey);
        } else {
            mathPracticeOption.removeAttribute('data-category-key');
        }
    }
    if (chinesePracticeOption) {
        const chineseTitle = chinesePracticeOption.querySelector('h3');
        if (chineseTitle) {
            chineseTitle.textContent = `${typeIChineseEmoji} ${typeIChineseDisplayName}`;
        }
    }
    if (mathPracticeTitle) {
        mathPracticeTitle.textContent = `${typeINonChineseEmoji} ${typeINonChineseDisplayName}`;
    }
    if (lessonReadingPracticeTitle) {
        lessonReadingPracticeTitle.textContent = `${typeIIIEmoji} ${typeIIIDisplayName}`;
    }
    if (lessonReadingPracticeOption) {
        if (typeIIIKey) {
            lessonReadingPracticeOption.setAttribute('data-category-key', typeIIIKey);
        } else {
            lessonReadingPracticeOption.removeAttribute('data-category-key');
        }
    }
    if (writingPracticeTitle) {
        writingPracticeTitle.textContent = `${typeIIEmoji} ${typeIIDisplayName}`;
    }
    if (writingPracticeOption) {
        if (typeIIKey) {
            writingPracticeOption.setAttribute('data-category-key', typeIIKey);
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
    window.location.href = `/kid-practice.html?${params.toString()}`;
}

function showError(message) {
    window.PracticeUiCommon.showAlertError(errorState, errorMessage, message);
}
