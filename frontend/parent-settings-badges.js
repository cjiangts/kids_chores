/*
 * parent-settings-badges.js — Badge Art Studio (parent settings)
 *
 * Layout:
 *   1. Identity helpers + studio state singletons
 *   2. Payload clone / set / reset + edit-mode copy
 *   3. Assignment lookups + dirty-state + catalog finders
 *   4. Asset preload + draft assignment mutators
 *   5. Display helpers + filtering (search / palette / usage)
 *   6. Selection + keyboard nav across achievement list and art bank
 *   7. Render (achievement list, selected, art bank, full studio)
 *   8. Load + save (fetch, build payload, bulk write)
 *   9. Open / close + notice dialog + error / success toasts
 */

// =====================================================================
// === 1. Identity helpers + studio state singletons
// =====================================================================

function badgeArtIdentityKeyFromPath(imagePath) {
    const normalized = String(imagePath || '').trim().toLowerCase();
    if (!normalized) {
        return '';
    }
    const slashIndex = normalized.lastIndexOf('/');
    return slashIndex >= 0 ? normalized.slice(slashIndex + 1) : normalized;
}

let badgeArtStudioCanEdit = false;
let badgeArtStudioHasLoaded = false;
let badgeArtStudioPersistedData = {
    achievements: [],
    artCatalog: [],
};
let badgeArtStudioData = {
    achievements: [],
    artCatalog: [],
};
let badgeArtSelectedKey = '';
let badgeArtStudioLoading = false;
let badgeArtStudioSaving = false;
let badgeArtStudioNoticeResolver = null;
const badgeArtStudioObjectUrlByIdentityKey = new Map();
let badgeArtStudioAssetPreloadPromise = null;

// =====================================================================
// === 2. Payload clone / set / reset + edit-mode copy
// =====================================================================

function cloneBadgeArtStudioPayload(payload) {
    const source = payload && typeof payload === 'object' ? payload : {};
    return {
        achievements: Array.isArray(source.achievements) ? source.achievements.map((item) => ({ ...item })) : [],
        artCatalog: Array.isArray(source.artCatalog) ? source.artCatalog.map((item) => ({ ...item })) : [],
    };
}

function setBadgeArtStudioPayload(payload) {
    badgeArtStudioPersistedData = cloneBadgeArtStudioPayload(payload);
    badgeArtStudioData = cloneBadgeArtStudioPayload(payload);
}

function resetBadgeArtStudioDraft() {
    badgeArtStudioData = cloneBadgeArtStudioPayload(badgeArtStudioPersistedData);
}

function badgeArtStudioIsEditable() {
    return Boolean(badgeArtStudioCanEdit || isSuperFamily);
}

function resetBadgeArtStudioState() {
    badgeArtStudioCanEdit = false;
    badgeArtStudioHasLoaded = false;
    badgeArtStudioPersistedData = { achievements: [], artCatalog: [] };
    badgeArtStudioData = { achievements: [], artCatalog: [] };
    badgeArtSelectedKey = '';
    badgeArtStudioLoading = false;
    badgeArtStudioSaving = false;
}

function syncBadgeArtStudioModeCopy() {
    const canEdit = badgeArtStudioIsEditable();
    if (badgeArtStudioDialog) {
        badgeArtStudioDialog.classList.toggle('badge-art-studio-modal--readonly', !canEdit);
    }
    if (badgeArtStudioTitle) {
        badgeArtStudioTitle.textContent = canEdit ? 'Badge Studio' : 'Badges';
    }
    if (badgeArtStudioSubtitle) {
        badgeArtStudioSubtitle.textContent = canEdit
            ? 'Set badge art.'
            : 'Browse badges.';
    }
    if (badgeArtAchievementSectionTitle) {
        badgeArtAchievementSectionTitle.textContent = canEdit ? 'All' : 'Live';
    }
    if (badgeArtSelectionSectionTitle) {
        badgeArtSelectionSectionTitle.textContent = canEdit ? 'Emoji' : 'Preview';
    }
    if (badgeArtSelectionEmpty) {
        badgeArtSelectionEmpty.textContent = 'Pick a badge.';
    }
}

// =====================================================================
// === 3. Assignment lookups + dirty-state + catalog finders
// =====================================================================

function badgeAssignmentKey(achievementKey, categoryKey = '') {
    return `${String(achievementKey || '').trim()}::${String(categoryKey || '').trim().toLowerCase()}`;
}

function getPersistedBadgeAchievement(achievementKey, categoryKey = '') {
    const achievements = Array.isArray(badgeArtStudioPersistedData.achievements)
        ? badgeArtStudioPersistedData.achievements
        : [];
    const targetKey = badgeAssignmentKey(achievementKey, categoryKey);
    return achievements.find((item) => badgeAssignmentKey(item.achievementKey, item.categoryKey) === targetKey) || null;
}

function getBadgeArtStudioDirtyAssignmentCount() {
    if (!badgeArtStudioIsEditable()) {
        return 0;
    }
    const draftAchievements = Array.isArray(badgeArtStudioData.achievements) ? badgeArtStudioData.achievements : [];
    return draftAchievements.reduce((count, item) => {
        const persistedItem = getPersistedBadgeAchievement(item.achievementKey, item.categoryKey);
        const draftBadgeArtId = Number(item && item.currentBadgeArtId || 0);
        const persistedBadgeArtId = Number(persistedItem && persistedItem.currentBadgeArtId || 0);
        return draftBadgeArtId !== persistedBadgeArtId ? count + 1 : count;
    }, 0);
}

function hasBadgeArtStudioUnsavedChanges() {
    return getBadgeArtStudioDirtyAssignmentCount() > 0;
}

function findBadgeArtCatalogItemById(badgeArtId) {
    const normalizedBadgeArtId = Number(badgeArtId || 0);
    const artCatalog = Array.isArray(badgeArtStudioData.artCatalog) ? badgeArtStudioData.artCatalog : [];
    return artCatalog.find((item) => Number(item && item.badgeArtId || 0) === normalizedBadgeArtId) || null;
}

function findBadgeArtCatalogItemByIdentityKey(identityKey) {
    const normalizedIdentityKey = String(identityKey || '').trim().toLowerCase();
    if (!normalizedIdentityKey) {
        return null;
    }
    const artCatalog = Array.isArray(badgeArtStudioData.artCatalog) ? badgeArtStudioData.artCatalog : [];
    return artCatalog.find((item) => getBadgeArtIdentityKey(item) === normalizedIdentityKey) || null;
}

function getBadgeArtIdentityKey(item) {
    if (!item || typeof item !== 'object') {
        return '';
    }
    const imagePath = String(item.imagePath || item.currentImagePath || '').trim();
    return badgeArtIdentityKeyFromPath(imagePath);
}

// =====================================================================
// === 4. Asset preload + draft assignment mutators
// =====================================================================

function getBadgeArtStudioPreloadCandidates() {
    const artCatalog = Array.isArray(badgeArtStudioData.artCatalog) ? badgeArtStudioData.artCatalog : [];
    return artCatalog.filter((item) => {
        const identityKey = getBadgeArtIdentityKey(item);
        const imageUrl = resolveBadgeArtImageUrl(item, { preferObjectUrl: false });
        return Boolean(identityKey && imageUrl && !badgeArtStudioObjectUrlByIdentityKey.has(identityKey));
    });
}

async function preloadBadgeArtStudioAssets() {
    if (badgeArtStudioAssetPreloadPromise) {
        return badgeArtStudioAssetPreloadPromise;
    }
    const candidates = getBadgeArtStudioPreloadCandidates();
    if (candidates.length <= 0) {
        return;
    }
    badgeArtStudioAssetPreloadPromise = Promise.all(candidates.map(async (item) => {
        const identityKey = getBadgeArtIdentityKey(item);
        const imageUrl = resolveBadgeArtImageUrl(item, { preferObjectUrl: false });
        if (!identityKey || !imageUrl || badgeArtStudioObjectUrlByIdentityKey.has(identityKey)) {
            return;
        }
        try {
            const response = await fetch(imageUrl);
            if (!response.ok) {
                return;
            }
            const blob = await response.blob();
            badgeArtStudioObjectUrlByIdentityKey.set(identityKey, URL.createObjectURL(blob));
        } catch (error) {
            console.warn('Failed to preload badge art asset:', imageUrl, error);
        }
    })).finally(() => {
        badgeArtStudioAssetPreloadPromise = null;
    });
    return badgeArtStudioAssetPreloadPromise;
}

function resolveActiveNotoBadgeArtId(item) {
    if (!item || typeof item !== 'object') {
        return 0;
    }
    const currentBadgeArtId = Number(item.currentBadgeArtId || 0);
    if (currentBadgeArtId > 0) {
        const directMatch = findBadgeArtCatalogItemById(currentBadgeArtId);
        if (directMatch) {
            return currentBadgeArtId;
        }
    }
    const identityKey = getBadgeArtIdentityKey(item);
    if (!identityKey) {
        return 0;
    }
    const matchedItem = findBadgeArtCatalogItemByIdentityKey(identityKey);
    return Number(matchedItem && matchedItem.badgeArtId || 0);
}

function setDraftBadgeArtAssignment(item, badgeArtId) {
    if (!item) {
        return;
    }
    const normalizedBadgeArtId = Number(badgeArtId || 0);
    if (!Number.isInteger(normalizedBadgeArtId) || normalizedBadgeArtId <= 0) {
        item.currentBadgeArtId = 0;
        item.currentImagePath = '';
        item.currentImageUrl = '';
        item.currentImageLabel = '';
        item.currentBadgeSourceUrl = '';
        item.currentBadgeLicense = '';
        item.currentBadgeIsActive = false;
        return;
    }
    const artItem = findBadgeArtCatalogItemById(normalizedBadgeArtId);
    if (!artItem) {
        return;
    }
    item.currentBadgeArtId = normalizedBadgeArtId;
    item.currentImagePath = String(artItem.imagePath || '');
    item.currentImageUrl = String(artItem.imageUrl || '');
    item.currentImageLabel = String(artItem.label || '');
    item.currentBadgeSourceUrl = String(artItem.sourceUrl || '');
    item.currentBadgeLicense = String(artItem.license || '');
    item.currentBadgeIsActive = true;
}

// =====================================================================
// === 5. Display helpers + filtering (search / palette / usage)
// =====================================================================

function normalizeSearchText(value) {
    return String(value || '').trim().toLowerCase();
}

function getBadgePaletteKey(item) {
    return String(item && item.paletteKey ? item.paletteKey : '').trim().toLowerCase() || 'global';
}

function resolveBadgeArtImageUrl(item, options = {}) {
    const preferObjectUrl = options.preferObjectUrl !== false;
    if (preferObjectUrl) {
        const identityKey = getBadgeArtIdentityKey(item);
        const cachedObjectUrl = identityKey ? badgeArtStudioObjectUrlByIdentityKey.get(identityKey) : '';
        if (cachedObjectUrl) {
            return cachedObjectUrl;
        }
    }
    const imageUrl = String(item && item.imageUrl ? item.imageUrl : item && item.currentImageUrl ? item.currentImageUrl : '').trim();
    if (imageUrl) {
        return imageUrl;
    }
    const imagePath = String(item && item.imagePath ? item.imagePath : item && item.currentImagePath ? item.currentImagePath : '').trim();
    if (!imagePath) {
        return '';
    }
    return `/${imagePath.replace(/^\/+/, '')}`;
}

function renderBadgeArtPreview(item, altText) {
    const imageUrl = resolveBadgeArtImageUrl(item);
    if (!imageUrl) {
        return '';
    }
    return `<img src="${escapeHtml(imageUrl)}" alt="${escapeHtml(altText || 'Badge art')}" loading="lazy" decoding="async">`;
}

function buildBadgeAchievementCardTitle(item) {
    const earnedKidCount = Number(item && item.earnedKidCount || 0);
    return [
        item.title || 'Badge',
        item.goalText || '',
        earnedKidCount > 0
            ? `Already earned by ${earnedKidCount} kid${earnedKidCount === 1 ? '' : 's'}`
            : '',
        item.currentImageLabel ? `Current art: ${item.currentImageLabel}` : 'Current art: Unassigned',
    ].filter(Boolean).join('\n');
}

function buildBadgeAchievementCardInnerMarkup(item) {
    const paletteKey = getBadgePaletteKey(item);
    return `
        <div class="badge-art-preview badge-art-grid-preview badge-art-palette-${escapeHtml(paletteKey)}">
            ${renderBadgeArtPreview(item, `${item.title} current art`)}
        </div>
    `;
}

function renderBadgeArtStudioStatus() {
    syncBadgeArtStudioModeCopy();
    syncBadgeArtStudioControls();
}

function getFilteredBadgeAchievements() {
    const achievements = Array.isArray(badgeArtStudioData.achievements) ? badgeArtStudioData.achievements : [];
    return achievements;
}

function getSelectedBadgeAchievement() {
    const achievements = Array.isArray(badgeArtStudioData.achievements) ? badgeArtStudioData.achievements : [];
    if (!badgeArtSelectedKey) {
        return null;
    }
    return achievements.find((item) => badgeAssignmentKey(item.achievementKey, item.categoryKey) === badgeArtSelectedKey) || null;
}

function renderBadgeArtStudioCounts() {
    const achievements = Array.isArray(badgeArtStudioData.achievements) ? badgeArtStudioData.achievements : [];
    const activeCount = achievements.filter((item) => (
        Number(item && item.currentBadgeArtId || 0) > 0
        && Boolean(item && item.currentBadgeIsActive)
    )).length;
    const inactiveCount = Math.max(0, achievements.length - activeCount);
    if (badgeAchievementCount) {
        badgeAchievementCount.textContent = `${activeCount} active badge${activeCount === 1 ? '' : 's'}`;
    }
    if (badgeArtBankCount) {
        badgeArtBankCount.textContent = `${inactiveCount} inactive badge${inactiveCount === 1 ? '' : 's'}`;
    }
}

function getUsedBadgeArtIds(excludedMappingKey = '') {
    const achievements = Array.isArray(badgeArtStudioData.achievements) ? badgeArtStudioData.achievements : [];
    const used = new Set();
    achievements.forEach((item) => {
        const mappingKey = badgeAssignmentKey(item.achievementKey, item.categoryKey);
        const badgeArtId = Number(item.currentBadgeArtId || 0);
        if (mappingKey === excludedMappingKey || !Number.isInteger(badgeArtId) || badgeArtId <= 0) {
            return;
        }
        used.add(badgeArtId);
    });
    return used;
}

function getUsedBadgeArtIdentityKeys(excludedMappingKey = '') {
    const achievements = Array.isArray(badgeArtStudioData.achievements) ? badgeArtStudioData.achievements : [];
    const used = new Set();
    achievements.forEach((item) => {
        const mappingKey = badgeAssignmentKey(item.achievementKey, item.categoryKey);
        if (mappingKey === excludedMappingKey) {
            return;
        }
        const identityKey = getBadgeArtIdentityKey(item);
        if (identityKey) {
            used.add(identityKey);
        }
    });
    return used;
}

function getFilteredBadgeArtCatalog() {
    if (!badgeArtStudioIsEditable()) {
        return [];
    }
    const selected = getSelectedBadgeAchievement();
    if (!selected) {
        return [];
    }
    const artCatalog = Array.isArray(badgeArtStudioData.artCatalog) ? badgeArtStudioData.artCatalog : [];
    const mappingKey = badgeAssignmentKey(selected.achievementKey, selected.categoryKey);
    const usedByOthers = getUsedBadgeArtIds(mappingKey);
    const usedIdentityKeysByOthers = getUsedBadgeArtIdentityKeys(mappingKey);
    const currentBadgeArtId = Number(selected.currentBadgeArtId || 0);
    const currentIdentityKey = getBadgeArtIdentityKey(selected);
    return artCatalog
        .filter((item) => {
            const badgeArtId = Number(item.badgeArtId || 0);
            const identityKey = getBadgeArtIdentityKey(item);
            const isEquivalentToCurrent = Boolean(identityKey) && identityKey === currentIdentityKey;
            if (badgeArtId > 0 && usedByOthers.has(badgeArtId) && badgeArtId !== currentBadgeArtId) {
                return false;
            }
            if (identityKey && usedIdentityKeysByOthers.has(identityKey) && !isEquivalentToCurrent) {
                return false;
            }
            return true;
        })
        .sort((a, b) => String(a.label || '').localeCompare(String(b.label || '')));
}

// =====================================================================
// === 6. Selection + keyboard nav across achievement list and art bank
// =====================================================================

function syncBadgeArtStudioControls() {
    const canEdit = badgeArtStudioIsEditable();
    const isSaving = badgeArtStudioSaving;
    const dirtyCount = getBadgeArtStudioDirtyAssignmentCount();
    if (openBadgeArtStudioBtn) {
        openBadgeArtStudioBtn.disabled = isSaving || badgeArtStudioLoading;
        const badgeBtnLabel = openBadgeArtStudioBtn.querySelector('.btn-label');
        if (badgeBtnLabel) {
            if (badgeArtStudioLoading) {
                badgeBtnLabel.innerHTML = '<span class="app-spinner app-spinner--small" role="status" aria-label="Loading"></span>';
            } else {
                badgeBtnLabel.textContent = 'Badges';
            }
        }
    }
    if (badgeArtStudioSaveBtn) {
        badgeArtStudioSaveBtn.classList.toggle('hidden', !canEdit);
        badgeArtStudioSaveBtn.disabled = badgeArtStudioLoading || isSaving || dirtyCount <= 0;
        const saveLabel = badgeArtStudioSaveBtn.querySelector('.btn-label');
        if (saveLabel) {
            saveLabel.textContent = isSaving
                ? 'Saving...'
                : (dirtyCount > 0
                    ? `Save ${dirtyCount} Change${dirtyCount === 1 ? '' : 's'}`
                    : 'Save');
        }
    }
}

function findBadgeAchievementCardElement(mappingKey) {
    if (!badgeArtAchievementList || !mappingKey) {
        return null;
    }
    return Array.from(badgeArtAchievementList.querySelectorAll('button[data-assignment-key]'))
        .find((button) => String(button.getAttribute('data-assignment-key') || '') === mappingKey) || null;
}

function updateBadgeAchievementCardElement(item) {
    if (!item) {
        return;
    }
    const mappingKey = badgeAssignmentKey(item.achievementKey, item.categoryKey);
    const button = findBadgeAchievementCardElement(mappingKey);
    if (!button) {
        return;
    }
    const paletteKey = getBadgePaletteKey(item);
    const isSelected = mappingKey === badgeArtSelectedKey;
    const isEarned = Number(item.earnedKidCount || 0) > 0;
    button.className = `badge-art-achievement-card badge-art-palette-${paletteKey}${isEarned ? ' badge-art-earned' : ''}${isSelected ? ' selected' : ''}`;
    button.setAttribute('aria-pressed', isSelected ? 'true' : 'false');
    button.setAttribute('aria-label', String(item.title || 'Badge'));
    button.setAttribute('title', buildBadgeAchievementCardTitle(item));
    button.innerHTML = buildBadgeAchievementCardInnerMarkup(item);
}

function updateBadgeAchievementSelectionState(previousKey, nextKey) {
    if (previousKey === nextKey) {
        return;
    }
    const previousButton = findBadgeAchievementCardElement(previousKey);
    if (previousButton) {
        previousButton.classList.remove('selected');
        previousButton.setAttribute('aria-pressed', 'false');
    }
    const nextButton = findBadgeAchievementCardElement(nextKey);
    if (nextButton) {
        nextButton.classList.add('selected');
        nextButton.setAttribute('aria-pressed', 'true');
    }
}

function findBadgeArtTileElement(badgeArtId) {
    if (!badgeArtBankGrid || !Number.isInteger(Number(badgeArtId)) || Number(badgeArtId) < 0) {
        return null;
    }
    return badgeArtBankGrid.querySelector(`button[data-badge-art-id="${Number(badgeArtId)}"]`);
}

function updateBadgeArtBankSelectionState(previousBadgeArtId, nextBadgeArtId) {
    const previousTile = findBadgeArtTileElement(previousBadgeArtId);
    if (previousTile) {
        previousTile.classList.remove('selected');
        previousTile.setAttribute('aria-pressed', 'false');
    }
    const nextTile = findBadgeArtTileElement(nextBadgeArtId);
    if (nextTile) {
        nextTile.classList.add('selected');
        nextTile.setAttribute('aria-pressed', 'true');
    }
}

function getBadgeAchievementButtons() {
    if (!badgeArtAchievementList) {
        return [];
    }
    return Array.from(badgeArtAchievementList.querySelectorAll('button[data-achievement-key][data-category-key]'));
}

function getBadgeArtBankButtons() {
    if (!badgeArtBankGrid) {
        return [];
    }
    return Array.from(badgeArtBankGrid.querySelectorAll('button[data-badge-art-id]'));
}

function moveBadgeAchievementSelectionBy(delta) {
    const buttons = getBadgeAchievementButtons();
    if (buttons.length <= 0) {
        return false;
    }
    const activeButton = document.activeElement instanceof HTMLElement
        ? document.activeElement.closest('#badgeArtAchievementList button[data-achievement-key][data-category-key]')
        : null;
    let currentIndex = buttons.findIndex((button) => button === activeButton);
    if (currentIndex < 0) {
        currentIndex = buttons.findIndex((button) => button.classList.contains('selected'));
    }
    if (currentIndex < 0) {
        currentIndex = 0;
    }
    const nextIndex = Math.max(0, Math.min(buttons.length - 1, currentIndex + delta));
    if (nextIndex === currentIndex) {
        buttons[nextIndex].focus();
        return true;
    }
    const targetButton = buttons[nextIndex];
    selectBadgeAchievement(
        String(targetButton.getAttribute('data-achievement-key') || '').trim(),
        String(targetButton.getAttribute('data-category-key') || '').trim()
    );
    targetButton.focus();
    return true;
}

function moveBadgeArtBankSelectionBy(delta) {
    const buttons = getBadgeArtBankButtons();
    if (buttons.length <= 0) {
        return false;
    }
    const activeButton = document.activeElement instanceof HTMLElement
        ? document.activeElement.closest('#badgeArtBankGrid button[data-badge-art-id]')
        : null;
    let currentIndex = buttons.findIndex((button) => button === activeButton);
    if (currentIndex < 0) {
        currentIndex = buttons.findIndex((button) => button.classList.contains('selected'));
    }
    if (currentIndex < 0) {
        currentIndex = 0;
    }
    const nextIndex = Math.max(0, Math.min(buttons.length - 1, currentIndex + delta));
    const targetButton = buttons[nextIndex];
    if (nextIndex === currentIndex) {
        targetButton.focus();
        return true;
    }
    const badgeArtId = Number.parseInt(targetButton.getAttribute('data-badge-art-id') || '', 10);
    if (!Number.isInteger(badgeArtId) || badgeArtId < 0) {
        return false;
    }
    assignBadgeArtToSelectedAchievement(badgeArtId);
    targetButton.focus();
    return true;
}

function handleBadgeArtStudioArrowKey(event) {
    if (!badgeArtStudioModal || badgeArtStudioModal.classList.contains('hidden')) {
        return false;
    }
    if (badgeArtStudioNoticeModal && !badgeArtStudioNoticeModal.classList.contains('hidden')) {
        return false;
    }
    if (badgeArtStudioSaving || badgeArtStudioLoading) {
        return false;
    }
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) {
        return false;
    }
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') {
        return false;
    }
    if (window.innerWidth <= 640) {
        return false;
    }
    const activeElement = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const activeInsideModal = Boolean(activeElement && badgeArtStudioModal.contains(activeElement));
    const activeInsideBank = Boolean(activeElement && activeElement.closest('#badgeArtBankGrid'));
    const activeInsideTopGrid = Boolean(activeElement && activeElement.closest('#badgeArtAchievementList'));
    if (activeElement && activeInsideModal) {
        const tagName = activeElement.tagName;
        if ((tagName === 'INPUT' || tagName === 'TEXTAREA' || tagName === 'SELECT') && !activeInsideBank && !activeInsideTopGrid) {
            return false;
        }
    }
    const delta = event.key === 'ArrowRight' ? 1 : -1;
    let handled = false;
    if (activeInsideBank) {
        handled = moveBadgeArtBankSelectionBy(delta);
    } else if (activeInsideTopGrid || !activeInsideModal || activeElement === document.body || activeElement === null) {
        handled = moveBadgeAchievementSelectionBy(delta);
    }
    if (handled) {
        event.preventDefault();
        event.stopPropagation();
    }
    return handled;
}

// =====================================================================
// === 7. Render (achievement list, selected, art bank, full studio)
// =====================================================================

function renderBadgeAchievementList() {
    if (!badgeArtAchievementList) {
        return;
    }
    const achievements = getFilteredBadgeAchievements();
    if (achievements.length <= 0) {
        badgeArtAchievementList.innerHTML = '<div class="settings-note">No achievements available.</div>';
        return;
    }
    badgeArtAchievementList.innerHTML = achievements.map((item) => {
        const key = badgeAssignmentKey(item.achievementKey, item.categoryKey);
        const isSelected = key === badgeArtSelectedKey;
        const paletteKey = getBadgePaletteKey(item);
        const isEarned = Number(item.earnedKidCount || 0) > 0;
        return `
            <button
                type="button"
                class="badge-art-achievement-card badge-art-palette-${escapeHtml(paletteKey)}${isEarned ? ' badge-art-earned' : ''}${isSelected ? ' selected' : ''}"
                data-assignment-key="${escapeHtml(key)}"
                data-achievement-key="${escapeHtml(item.achievementKey)}"
                data-category-key="${escapeHtml(item.categoryKey)}"
                aria-pressed="${isSelected ? 'true' : 'false'}"
                aria-label="${escapeHtml(item.title || 'Badge')}"
                title="${escapeHtml(buildBadgeAchievementCardTitle(item))}"
            >
                ${buildBadgeAchievementCardInnerMarkup(item)}
            </button>
        `;
    }).join('');
}

function renderSelectedBadgeAchievement() {
    const selected = getSelectedBadgeAchievement();
    if (!badgeArtSelectionEmpty || !badgeArtSelectionPanel) {
        return;
    }
    if (!selected) {
        badgeArtSelectionEmpty.classList.remove('hidden');
        badgeArtSelectionPanel.classList.add('hidden');
        badgeArtSelectedPreview.className = 'badge-art-preview';
        badgeArtSelectedPreview.innerHTML = '';
        badgeArtSelectedTitle.textContent = '';
        if (badgeArtSelectedMeta) {
            badgeArtSelectedMeta.textContent = '';
        }
        if (badgeArtSelectedCurrent) {
            badgeArtSelectedCurrent.textContent = '';
        }
        return;
    }
    badgeArtSelectionEmpty.classList.add('hidden');
    badgeArtSelectionPanel.classList.remove('hidden');
    const paletteKey = getBadgePaletteKey(selected);
    badgeArtSelectedPreview.className = `badge-art-preview badge-art-palette-${paletteKey}`;
    badgeArtSelectedPreview.innerHTML = renderBadgeArtPreview(selected, `${selected.title} current art`);
    badgeArtSelectedTitle.textContent = String(selected.title || 'Badge');
    if (badgeArtSelectedMeta) {
        badgeArtSelectedMeta.textContent = String(selected.goalText || selected.reasonText || '').trim();
    }
    if (badgeArtSelectedCurrent) {
        badgeArtSelectedCurrent.textContent = '';
    }
}

function renderBadgeArtBank(options = {}) {
    if (!badgeArtBankGrid) {
        return;
    }
    const canEdit = badgeArtStudioIsEditable();
    const preserveScroll = Boolean(options.preserveScroll);
    const previousScrollTop = preserveScroll ? badgeArtBankGrid.scrollTop : 0;
    const selected = getSelectedBadgeAchievement();
    badgeArtBankGrid.classList.remove('hidden');
    if (!selected) {
        badgeArtBankGrid.innerHTML = '';
        return;
    }
    if (!canEdit) {
        badgeArtBankGrid.innerHTML = '';
        badgeArtBankGrid.classList.add('hidden');
        return;
    }
    const artCatalog = Array.isArray(badgeArtStudioData.artCatalog) ? badgeArtStudioData.artCatalog : [];
    const mappingKey = badgeAssignmentKey(selected.achievementKey, selected.categoryKey);
    const usedByOthers = getUsedBadgeArtIds(mappingKey);
    const usedIdentityKeysByOthers = getUsedBadgeArtIdentityKeys(mappingKey);
    const currentBadgeArtId = Number(selected.currentBadgeArtId || 0);
    const highlightedBadgeArtId = resolveActiveNotoBadgeArtId(selected);
    const currentIdentityKey = getBadgeArtIdentityKey(selected);
    const items = getFilteredBadgeArtCatalog();
    if (items.length <= 0) {
        const isDeactivated = highlightedBadgeArtId <= 0;
        badgeArtBankGrid.innerHTML = `
            <button
                type="button"
                class="badge-art-tile badge-art-empty-tile ${isDeactivated ? 'selected' : ''}"
                data-badge-art-id="0"
                aria-label="Deactivate badge art"
                aria-pressed="${isDeactivated ? 'true' : 'false'}"
                title="Deactivate badge art"
                ${badgeArtStudioSaving ? 'disabled' : ''}
            >
                <span class="badge-art-preview badge-art-grid-preview badge-art-empty-preview">
                    <span class="badge-art-empty-icon" aria-hidden="true"></span>
                </span>
            </button>
        `;
        return;
    }
    const isDeactivated = highlightedBadgeArtId <= 0;
    const deactivateTileMarkup = `
        <button
            type="button"
            class="badge-art-tile badge-art-empty-tile ${isDeactivated ? 'selected' : ''}"
            data-badge-art-id="0"
            aria-label="Deactivate badge art"
            aria-pressed="${isDeactivated ? 'true' : 'false'}"
            title="Deactivate badge art"
            ${badgeArtStudioSaving ? 'disabled' : ''}
        >
            <span class="badge-art-preview badge-art-grid-preview badge-art-empty-preview">
                <span class="badge-art-empty-icon" aria-hidden="true"></span>
            </span>
        </button>
    `;
    badgeArtBankGrid.innerHTML = deactivateTileMarkup + items.map((item) => {
        const badgeArtId = Number(item.badgeArtId || 0);
        const isCurrent = badgeArtId > 0 && badgeArtId === highlightedBadgeArtId;
        return `
            <button
                type="button"
                class="badge-art-tile ${isCurrent ? 'selected' : ''}"
                data-badge-art-id="${badgeArtId}"
                aria-label="${escapeHtml(item.label || 'Noto badge art')}"
                aria-pressed="${isCurrent ? 'true' : 'false'}"
                title="${escapeHtml(item.label || '')}"
                ${badgeArtStudioSaving ? 'disabled' : ''}
            >
                <span class="badge-art-preview badge-art-grid-preview">
                    ${renderBadgeArtPreview(item, item.label || 'Noto badge art')}
                </span>
            </button>
        `;
    }).join('');
    if (preserveScroll) {
        const maxScrollTop = Math.max(0, badgeArtBankGrid.scrollHeight - badgeArtBankGrid.clientHeight);
        badgeArtBankGrid.scrollTop = Math.min(previousScrollTop, maxScrollTop);
    }
}

function renderBadgeArtStudio() {
    renderBadgeArtStudioStatus();
    renderBadgeArtStudioCounts();
    renderBadgeAchievementList();
    renderSelectedBadgeAchievement();
    renderBadgeArtBank();
}

function selectBadgeAchievement(achievementKey, categoryKey) {
    const nextKey = badgeAssignmentKey(achievementKey, categoryKey);
    if (!nextKey || badgeArtSelectedKey === nextKey) {
        return;
    }
    const previousKey = badgeArtSelectedKey;
    badgeArtSelectedKey = nextKey;
    showBadgeArtStudioSuccess('');
    updateBadgeAchievementSelectionState(previousKey, nextKey);
    renderSelectedBadgeAchievement();
    renderBadgeArtBank();
}

// =====================================================================
// === 8. Load + save (fetch, build payload, bulk write)
// =====================================================================

async function loadBadgeArtStudio() {
    if (!badgeArtStudioModal) {
        return;
    }
    try {
        badgeArtStudioLoading = true;
        renderBadgeArtStudioStatus();
        showBadgeArtStudioError('');
        showBadgeArtStudioSuccess('');
        syncBadgeArtStudioControls();
        const response = await fetch(`${API_BASE}/parent-settings/badges/art`);
        const result = await response.json().catch(() => ({}));
        if (!response.ok) {
            throw new Error(result.error || `HTTP ${response.status}`);
        }
        badgeArtStudioCanEdit = Boolean(result.canEdit);
        badgeArtStudioHasLoaded = true;
        setBadgeArtStudioPayload({
            achievements: Array.isArray(result.achievements) ? result.achievements : [],
            artCatalog: Array.isArray(result.artCatalog) ? result.artCatalog : [],
        });
        void preloadBadgeArtStudioAssets();
        const selectedStillExists = badgeArtStudioData.achievements.some(
            (item) => badgeAssignmentKey(item.achievementKey, item.categoryKey) === badgeArtSelectedKey
        );
        if (!selectedStillExists) {
            const firstAchievement = badgeArtStudioData.achievements[0];
            badgeArtSelectedKey = firstAchievement
                ? badgeAssignmentKey(firstAchievement.achievementKey, firstAchievement.categoryKey)
                : '';
        }
        renderBadgeArtStudio();
    } catch (error) {
        console.error('Error loading badge art studio:', error);
        badgeArtStudioHasLoaded = false;
        if (badgeArtStudioModal && !badgeArtStudioModal.classList.contains('hidden')) {
            showBadgeArtStudioError(
                badgeArtStudioIsEditable()
                    ? 'Failed to load the Noto badge bank.'
                    : 'Failed to load active badge achievements.'
            );
        }
    } finally {
        badgeArtStudioLoading = false;
        renderBadgeArtStudioStatus();
    }
}

function assignBadgeArtToSelectedAchievement(badgeArtId) {
    const selected = getSelectedBadgeAchievement();
    if (!badgeArtStudioIsEditable() || badgeArtStudioLoading || badgeArtStudioSaving || !selected || !Number.isInteger(Number(badgeArtId)) || Number(badgeArtId) < 0) {
        return;
    }
    if (Number(badgeArtId) > 0) {
        const artItem = findBadgeArtCatalogItemById(badgeArtId);
        if (!artItem) {
            showBadgeArtStudioError('Selected art is no longer available.');
            return;
        }
    }
    showBadgeArtStudioError('');
    showBadgeArtStudioSuccess('');
    const mappingKey = badgeAssignmentKey(selected.achievementKey, selected.categoryKey);
    const draftItem = badgeArtStudioData.achievements.find(
        (item) => badgeAssignmentKey(item.achievementKey, item.categoryKey) === mappingKey
    );
    if (!draftItem) {
        return;
    }
    const previousBadgeArtId = resolveActiveNotoBadgeArtId(draftItem);
    setDraftBadgeArtAssignment(draftItem, badgeArtId);
    const nextBadgeArtId = resolveActiveNotoBadgeArtId(draftItem);
    renderBadgeArtStudioStatus();
    renderBadgeArtStudioCounts();
    updateBadgeAchievementCardElement(draftItem);
    renderSelectedBadgeAchievement();
    updateBadgeArtBankSelectionState(previousBadgeArtId, nextBadgeArtId);
}

function buildBadgeArtStudioSaveAssignments() {
    const achievements = Array.isArray(badgeArtStudioData.achievements) ? badgeArtStudioData.achievements : [];
    const assignments = [];
    const unresolved = [];
    achievements.forEach((item) => {
        const currentBadgeArtId = Number(item && item.currentBadgeArtId || 0);
        if (currentBadgeArtId <= 0) {
            return;
        }
        const resolvedBadgeArtId = resolveActiveNotoBadgeArtId(item);
        if (resolvedBadgeArtId <= 0) {
            unresolved.push(String(item.title || item.achievementKey || 'Badge').trim() || 'Badge');
            return;
        }
        assignments.push({
            achievementKey: String(item.achievementKey || '').trim(),
            categoryKey: String(item.categoryKey || '').trim(),
            badgeArtId: resolvedBadgeArtId,
        });
    });
    return { assignments, unresolved };
}

async function requestBadgeArtStudioJson(url, options = {}) {
    const response = await fetch(url, options);
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
        throw new Error(result.error || `HTTP ${response.status}`);
    }
    return result;
}

async function saveBadgeArtStudioAssignmentsBulk(savePayload) {
    return requestBadgeArtStudioJson(`${API_BASE}/parent-settings/badges/art/bulk`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            assignments: savePayload.assignments,
        }),
    });
}

async function saveBadgeArtStudioAssignments() {
    if (!badgeArtStudioIsEditable() || badgeArtStudioLoading || badgeArtStudioSaving) {
        return;
    }
    const dirtyCount = getBadgeArtStudioDirtyAssignmentCount();
    if (dirtyCount <= 0) {
        return;
    }
    const savePayload = buildBadgeArtStudioSaveAssignments();
    if (savePayload.unresolved.length > 0) {
        showBadgeArtStudioError(
            `Some selected art cannot be saved yet: ${savePayload.unresolved.slice(0, 3).join(', ')}${savePayload.unresolved.length > 3 ? ', ...' : ''}.`
        );
        return;
    }
    badgeArtStudioSaving = true;
    showBadgeArtStudioError('');
    showBadgeArtStudioSuccess('');
    syncBadgeArtStudioControls();
    renderBadgeArtBank();
    try {
        const result = await saveBadgeArtStudioAssignmentsBulk(savePayload);
        setBadgeArtStudioPayload({
            achievements: Array.isArray(result.achievements) ? result.achievements : [],
            artCatalog: Array.isArray(result.artCatalog) ? result.artCatalog : [],
        });
        await preloadBadgeArtStudioAssets();
        const selectedStillExists = badgeArtStudioData.achievements.some(
            (item) => badgeAssignmentKey(item.achievementKey, item.categoryKey) === badgeArtSelectedKey
        );
        if (!selectedStillExists) {
            badgeArtSelectedKey = '';
        }
        const savedCount = Number.isFinite(Number(result.savedAssignmentCount))
            ? Number(result.savedAssignmentCount)
            : savePayload.assignments.length;
        showBadgeArtStudioSuccess(`Saved ${dirtyCount} change${dirtyCount === 1 ? '' : 's'}. ${savedCount} badge${savedCount === 1 ? '' : 's'} assigned.`);
        renderBadgeArtStudio();
    } catch (error) {
        console.error('Error saving badge art assignments:', error);
        showBadgeArtStudioError(error.message || 'Failed to save badge art.');
        renderBadgeArtStudio();
    } finally {
        badgeArtStudioSaving = false;
        syncBadgeArtStudioControls();
        renderBadgeArtBank();
    }
}

// =====================================================================
// === 9. Open / close + notice dialog + error / success toasts
// =====================================================================

async function openBadgeArtStudio() {
    if (!badgeArtStudioModal) {
        return;
    }
    badgeArtStudioModal.classList.remove('hidden');
    syncModalBodyLock();
    syncBadgeArtStudioModeCopy();
    if (!badgeArtStudioHasLoaded) {
        await loadBadgeArtStudio();
    }
    await preloadBadgeArtStudioAssets();
    renderBadgeArtStudio();
    showBadgeArtStudioError('');
}

function closeBadgeArtStudio(options = {}) {
    if (!badgeArtStudioModal) {
        return false;
    }
    const shouldDiscardDraft = Boolean(options.discardDraft);
    if (hasBadgeArtStudioUnsavedChanges() && shouldDiscardDraft) {
        const confirmed = options.force === true || window.confirm(
            'Discard unsaved badge art changes? Your draft selections will be lost.'
        );
        if (!confirmed) {
            return false;
        }
        resetBadgeArtStudioDraft();
        showBadgeArtStudioError('');
        showBadgeArtStudioSuccess('');
        renderBadgeArtStudio();
    }
    badgeArtStudioModal.classList.add('hidden');
    syncModalBodyLock();
    return true;
}

function closeBadgeArtStudioNoticeDialog() {
    if (!badgeArtStudioNoticeModal || badgeArtStudioNoticeModal.classList.contains('hidden')) {
        return;
    }
    badgeArtStudioNoticeModal.classList.add('hidden');
    syncModalBodyLock();
    const resolve = badgeArtStudioNoticeResolver;
    badgeArtStudioNoticeResolver = null;
    if (typeof resolve === 'function') {
        resolve();
    }
}

function showBadgeArtStudioNoticeDialog(message, title = 'Badge Art Studio') {
    const text = String(message || '').trim();
    if (!text) {
        return Promise.resolve();
    }
    if (!badgeArtStudioNoticeModal || !badgeArtStudioNoticeTitle || !badgeArtStudioNoticeText || !badgeArtStudioNoticeOkBtn) {
        window.alert(text);
        return Promise.resolve();
    }
    if (!badgeArtStudioNoticeModal.classList.contains('hidden')) {
        closeBadgeArtStudioNoticeDialog();
    }
    badgeArtStudioNoticeTitle.textContent = String(title || 'Badge Art Studio').trim() || 'Badge Art Studio';
    badgeArtStudioNoticeText.textContent = text;
    badgeArtStudioNoticeModal.classList.remove('hidden');
    syncModalBodyLock();
    badgeArtStudioNoticeOkBtn.focus();
    return new Promise((resolve) => {
        badgeArtStudioNoticeResolver = resolve;
    });
}

function showBadgeArtStudioError(message) {
    const text = String(message || '').trim();
    if (!text) {
        return Promise.resolve();
    }
    return showBadgeArtStudioNoticeDialog(text, 'Badge Art Studio');
}

function showBadgeArtStudioSuccess(message) {
    const text = String(message || '').trim();
    if (!text) {
        return Promise.resolve();
    }
    return showBadgeArtStudioNoticeDialog(text, 'Badge Art Studio');
}
