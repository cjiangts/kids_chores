const API_BASE = `${window.location.origin}/api`;

const urlParams = new URLSearchParams(window.location.search);
const kidId = String(urlParams.get('id') || '').trim();
const requestedCategoryKey = String(urlParams.get('categoryKey') || '').trim().toLowerCase();

const kidNameEl = document.getElementById('kidName');
const kidBackBtn = document.getElementById('kidBackBtn');
const errorMessage = document.getElementById('errorMessage');
const practiceSection = document.getElementById('practiceSection');
const practiceChooser = document.getElementById('practiceChooser');
const chinesePracticeOption = document.getElementById('chinesePracticeOption');
const writingPracticeOption = document.getElementById('writingPracticeOption');
const mathPracticeOption = document.getElementById('mathPracticeOption');
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
    getDeckCategoryMetaMap,
    getCategoryDisplayName,
    getCategoryEmoji,
    resolveChinesePracticeCategoryKey,
    resolveTypeIIIPracticeCategoryKey,
} = window.DeckCategoryCommon;

let currentKid = null;
let writingCards = [];
let activeChineseCategoryKey = requestedCategoryKey || 'chinese_characters';
let activeTypeIIICategoryKey = requestedCategoryKey;
const errorState = { lastMessage: '' };

document.addEventListener('DOMContentLoaded', async () => {
    if (!kidId) {
        window.location.href = '/';
        return;
    }

    kidBackBtn.href = '/';
    await loadKidInfo();
    await loadWritingCards();
    renderPracticeOptions();
});

async function loadKidInfo() {
    try {
        const response = await fetch(`${API_BASE}/kids/${kidId}`);
        if (!response.ok) {
            throw new Error('Kid not found');
        }
        currentKid = await response.json();
        activeChineseCategoryKey = resolveChinesePracticeCategoryKey(currentKid, activeChineseCategoryKey);
        activeTypeIIICategoryKey = resolveTypeIIIPracticeCategoryKey(currentKid, activeTypeIIICategoryKey);
        kidNameEl.textContent = `${currentKid.name}'s Practice`;
    } catch (error) {
        console.error('Error loading kid:', error);
        showError('Failed to load kid information');
        setTimeout(() => {
            window.location.href = '/';
        }, 2000);
    }
}

async function loadWritingCards() {
    try {
        const response = await fetch(`${API_BASE}/kids/${kidId}/writing/cards`);
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }
        const data = await response.json();
        writingCards = (data.cards || []).filter((card) => card.available_for_practice !== false);
    } catch (error) {
        console.error('Error loading writing cards:', error);
        writingCards = [];
    }
}

function getCategoryStarsText(categoryKey, dailyCompletedByCategory) {
    const key = String(categoryKey || '').trim().toLowerCase();
    const completedCount = Number.parseInt(dailyCompletedByCategory?.[key], 10);
    const safeCount = Number.isInteger(completedCount) ? Math.max(0, completedCount) : 0;
    return safeCount > 0 ? `Today: ${'⭐'.repeat(safeCount)}` : 'Today: no stars yet';
}

function getStaticPracticeOptionKeySet() {
    const keys = new Set();
    const nodes = practiceChooser.querySelectorAll('.practice-option[data-category-key]');
    nodes.forEach((node) => {
        const key = String(node.getAttribute('data-category-key') || '').trim().toLowerCase();
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
    practiceTargetByCategory,
}) {
    clearDynamicPracticeOptions();
    let renderedCount = 0;
    const staticOptionKeys = getStaticPracticeOptionKeySet();
    optedInCategoryKeys.forEach((categoryKey) => {
        const key = String(categoryKey || '').trim().toLowerCase();
        if (!key || staticOptionKeys.has(key)) {
            return;
        }
        const meta = categoryMetaMap[key] || {};
        const behaviorType = String(meta.behavior_type || '').trim().toLowerCase();
        if (behaviorType !== 'type_i' && behaviorType !== 'type_iii') {
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
            if (behaviorType === 'type_iii') {
                goType3Practice(key);
                return;
            }
            if (meta.has_chinese_specific_logic) {
                void chooseChinesePractice(key);
                return;
            }
            goType1Practice(key);
        });

        const title = document.createElement('h3');
        title.textContent = `${getCategoryEmoji(key, categoryMetaMap)} ${getCategoryDisplayName(key, categoryMetaMap)}`;
        button.appendChild(title);

        const stars = document.createElement('p');
        stars.className = 'practice-star-badge';
        stars.textContent = getCategoryStarsText(key, dailyCompletedByCategory);
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

    const writingSessionCount = Number.parseInt(currentKid?.writingSessionCardCount, 10);
    const optedInSet = getOptedInDeckCategorySet(currentKid);
    const optedInKeys = getOptedInDeckCategoryKeys(currentKid);
    const categoryMetaMap = getDeckCategoryMetaMap(currentKid);
    const dailyCompletedByCategory = getCategoryValueMap(currentKid?.dailyCompletedByDeckCategory);
    const practiceTargetByCategory = getCategoryValueMap(currentKid?.practiceTargetByDeckCategory);
    const chineseCharactersSessionCount = Number.parseInt(
        practiceTargetByCategory?.chinese_characters ?? currentKid?.sessionCardCount,
        10,
    );
    const mathSessionCount = Number.parseInt(practiceTargetByCategory?.math, 10);
    const typeIIIKey = resolveTypeIIIPracticeCategoryKey(currentKid, activeTypeIIICategoryKey);
    activeTypeIIICategoryKey = typeIIIKey;
    const typeIIISessionCount = Number.parseInt(typeIIIKey ? practiceTargetByCategory?.[typeIIIKey] : 0, 10);

    const chineseEnabled = (
        optedInSet.has('chinese_characters')
        && Number.isInteger(chineseCharactersSessionCount)
        && chineseCharactersSessionCount > 0
    );
    const writingEnabled = optedInSet.has('chinese_writing') && Number.isInteger(writingSessionCount) && writingSessionCount > 0;
    const mathEnabled = optedInSet.has('math') && Number.isInteger(mathSessionCount) && mathSessionCount > 0;
    const typeIIIEnabled = Boolean(typeIIIKey)
        && optedInSet.has(typeIIIKey)
        && Number.isInteger(typeIIISessionCount)
        && typeIIISessionCount > 0;
    const typeIIIDisplayName = typeIIIKey ? getCategoryDisplayName(typeIIIKey, categoryMetaMap) : 'Type-III Practice';
    const typeIIIEmoji = typeIIIKey ? getCategoryEmoji(typeIIIKey, categoryMetaMap) : '📚';

    chineseStarBadge.textContent = getCategoryStarsText('chinese_characters', dailyCompletedByCategory);
    writingStarBadge.textContent = getCategoryStarsText('chinese_writing', dailyCompletedByCategory);
    mathStarBadge.textContent = getCategoryStarsText('math', dailyCompletedByCategory);
    lessonReadingStarBadge.textContent = getCategoryStarsText(typeIIIKey, dailyCompletedByCategory);
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

    chinesePracticeOption.classList.toggle('hidden', !chineseEnabled);
    writingPracticeOption.classList.toggle('hidden', !writingEnabled);
    mathPracticeOption.classList.toggle('hidden', !mathEnabled);
    lessonReadingPracticeOption.classList.toggle('hidden', !typeIIIEnabled);

    const dynamicOptionCount = renderDynamicPracticeOptions({
        optedInCategoryKeys: optedInKeys,
        categoryMetaMap,
        dailyCompletedByCategory,
        practiceTargetByCategory,
    });
    practiceSection.classList.remove('hidden');
    if (!chineseEnabled && !writingEnabled && !mathEnabled && !typeIIIEnabled && dynamicOptionCount <= 0) {
        showError('No daily practice is assigned. Ask your parent to set per-session counts above 0.');
    } else {
        showError('');
    }
}

async function chooseChinesePractice(category = 'chinese_characters') {
    const categoryKey = String(category || '').trim().toLowerCase();
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
    const categoryKey = String(category || '').trim().toLowerCase();
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
    window.location.href = `/kid-type1.html?${params.toString()}`;
}

function goWritingPractice(category = 'chinese_writing') {
    const categoryKey = String(category || '').trim().toLowerCase();
    if (!categoryKey) {
        showError('Writing category is missing.');
        return;
    }
    const optedInSet = getOptedInDeckCategorySet(currentKid);
    if (!optedInSet.has(categoryKey)) {
        const categoryMetaMap = getDeckCategoryMetaMap(currentKid);
        const label = getCategoryDisplayName(categoryKey, categoryMetaMap);
        showError(`${label} practice is not opted in for this kid.`);
        return;
    }
    if (writingCards.length === 0) {
        showError('No Chinese writing cards yet. Ask your parent to add some first.');
        return;
    }
    const params = new URLSearchParams();
    params.set('id', kidId);
    params.set('categoryKey', categoryKey);
    window.location.href = `/kid-writing.html?${params.toString()}`;
}

function goType3Practice(category = '') {
    const fallbackKey = resolveTypeIIIPracticeCategoryKey(currentKid, activeTypeIIICategoryKey);
    const categoryKey = String(category || fallbackKey || '').trim().toLowerCase();
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
    window.location.href = `/kid-type3.html?${params.toString()}`;
}

function showError(message) {
    window.PracticeUiCommon.showAlertError(errorState, errorMessage, message);
}
