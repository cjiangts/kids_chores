// API Configuration
// Use the same host that served the page (works on phone and computer)
const API_BASE = `${window.location.origin}/api`;

// DOM Elements
const kidsList = document.getElementById('kidsList');
const newKidBtn = document.getElementById('newKidBtn');
const kidModal = document.getElementById('kidModal');
const kidForm = document.getElementById('kidForm');
const cancelBtn = document.getElementById('cancelBtn');
const deckCategoryModal = document.getElementById('deckCategoryModal');
const deckCategoryKidLabel = document.getElementById('deckCategoryKidLabel');
const deckCategoryAvailableTitle = document.getElementById('deckCategoryAvailableTitle');
const deckCategoryOptedTitle = document.getElementById('deckCategoryOptedTitle');
const deckCategoryAvailableBubbles = document.getElementById('deckCategoryAvailableBubbles');
const deckCategoryOptedBubbles = document.getElementById('deckCategoryOptedBubbles');
const deckCategoryAvailableEmpty = document.getElementById('deckCategoryAvailableEmpty');
const deckCategoryOptedEmpty = document.getElementById('deckCategoryOptedEmpty');
const deckCategoryConfirmBtn = document.getElementById('deckCategoryConfirmBtn');
const deckCategoryCancelBtn = document.getElementById('deckCategoryCancelBtn');
const errorMessage = document.getElementById('errorMessage');
const kidNameInput = document.getElementById('kidName');
const manageDecksLink = document.getElementById('manageDecksLink');
const parentLogoutLink = document.getElementById('parentLogoutLink');
const {
    getOptedInDeckCategoryKeys,
    getOptedInDeckCategorySet,
    getCategoryValueMap,
    getDeckCategoryMetaMap,
    getCategoryDisplayName,
    getCategoryEmoji,
} = window.DeckCategoryCommon;
const VALID_BEHAVIOR_TYPES = new Set(['type_i', 'type_ii', 'type_iii', 'type_iv']);
const PARENT_NAV_CACHE_KEY_PREFIX = 'parent_admin_nav_cache_v1';
const CURRENT_FAMILY_ID_STORAGE_KEY = 'current_family_id_v1';
const PARENT_NAV_CACHE_TTL_MS = 2 * 60 * 1000;
let isCreatingKid = false;
let isSavingDeckCategories = false;
let currentKids = [];
let currentFamilyId = '';
let deckCategoryModalState = {
    kidId: '',
    availableKeys: [],
    optedInKeys: [],
};

// Load kids on page load
document.addEventListener('DOMContentLoaded', () => {
    applySuperFamilyUi();
    loadKids({ preferNavigationCache: true });
});

// Event Listeners
newKidBtn.addEventListener('click', () => {
    kidModal.classList.remove('hidden');
});

cancelBtn.addEventListener('click', () => {
    kidModal.classList.add('hidden');
    kidForm.reset();
});

kidForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    await createKid();
});

if (deckCategoryCancelBtn) {
    deckCategoryCancelBtn.addEventListener('click', closeDeckCategoryModal);
}
if (deckCategoryAvailableBubbles) {
    deckCategoryAvailableBubbles.addEventListener('click', (event) => {
        const button = event.target.closest('button[data-category-key]');
        if (!button) {
            return;
        }
        moveDeckCategoryByKey(button.getAttribute('data-category-key'), 'toOpted');
    });
}
if (deckCategoryOptedBubbles) {
    deckCategoryOptedBubbles.addEventListener('click', (event) => {
        const button = event.target.closest('button[data-category-key]');
        if (!button) {
            return;
        }
        moveDeckCategoryByKey(button.getAttribute('data-category-key'), 'toAvailable');
    });
}
if (deckCategoryConfirmBtn) {
    deckCategoryConfirmBtn.addEventListener('click', saveDeckCategoryOptIns);
}
if (parentLogoutLink) {
    parentLogoutLink.addEventListener('click', async (event) => {
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

async function applySuperFamilyUi() {
    if (!manageDecksLink) {
        return;
    }
    try {
        const response = await fetch(`${API_BASE}/family-auth/status`);
        if (!response.ok) {
            manageDecksLink.classList.add('hidden');
            return;
        }
        const auth = await response.json().catch(() => ({}));
        currentFamilyId = String(auth?.familyId || '').trim();
        persistCurrentFamilyNavigationPointer(currentFamilyId);
        manageDecksLink.classList.toggle('hidden', !Boolean(auth.isSuperFamily));
    } catch (error) {
        manageDecksLink.classList.add('hidden');
    }
}

// API Functions
function readKidsFromParentNavigationCache() {
    try {
        if (!window.sessionStorage) {
            return null;
        }
        const familyId = String(currentFamilyId || readCurrentFamilyNavigationPointer() || '').trim();
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
        const kids = Array.isArray(parsed?.kids) ? parsed.kids : null;
        return kids;
    } catch (error) {
        return null;
    }
}

function cacheKidsForParentNavigation(kids) {
    try {
        if (!window.sessionStorage) {
            return;
        }
        const list = Array.isArray(kids) ? kids : [];
        const familyId = inferFamilyIdFromKids(list) || String(currentFamilyId || '').trim();
        if (!familyId) {
            return;
        }
        currentFamilyId = familyId;
        persistCurrentFamilyNavigationPointer(familyId);
        window.sessionStorage.setItem(buildParentNavCacheKey(familyId), JSON.stringify({
            familyId,
            cachedAtMs: Date.now(),
            kids: list,
        }));
    } catch (error) {
        // Best-effort cache only.
    }
}

async function loadKids(options = {}) {
    const preferNavigationCache = Boolean(options?.preferNavigationCache);
    let usedNavigationCache = false;
    try {
        showError('');
        if (preferNavigationCache) {
            const cachedKids = readKidsFromParentNavigationCache();
            if (cachedKids) {
                currentKids = Array.isArray(cachedKids) ? cachedKids : [];
                displayKids(currentKids);
                usedNavigationCache = true;
            }
        }
        if (!usedNavigationCache) {
            kidsList.innerHTML = '<div class="empty-state"><p>Loading...</p></div>';
        }
        const response = await fetch(`${API_BASE}/kids?view=admin`);

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const kids = await response.json();
        currentKids = Array.isArray(kids) ? kids : [];
        cacheKidsForParentNavigation(currentKids);
        displayKids(kids);
    } catch (error) {
        console.error('Error loading kids:', error);
        if (!usedNavigationCache) {
            currentKids = [];
            showError('Failed to load kids. Make sure the backend server is running on port 5001.');
        }
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

function persistCurrentFamilyNavigationPointer(familyId) {
    try {
        if (!window.sessionStorage) {
            return;
        }
        const normalized = String(familyId || '').trim();
        if (!normalized) {
            window.sessionStorage.removeItem(CURRENT_FAMILY_ID_STORAGE_KEY);
            return;
        }
        window.sessionStorage.setItem(CURRENT_FAMILY_ID_STORAGE_KEY, normalized);
    } catch (error) {
        // ignore
    }
}

function clearCurrentFamilyNavigationPointer() {
    persistCurrentFamilyNavigationPointer('');
}

async function createKid() {
    if (isCreatingKid) {
        return;
    }
    const submitBtn = kidForm.querySelector('button[type="submit"]');
    try {
        isCreatingKid = true;
        const name = document.getElementById('kidName').value;

        submitBtn.disabled = true;
        submitBtn.textContent = 'Creating...';
        if (kidNameInput) {
            kidNameInput.disabled = true;
        }

        const response = await fetch(`${API_BASE}/kids`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ name }),
        });

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const newKid = await response.json();
        console.log('Kid created:', newKid);

        // Close modal and reload
        kidModal.classList.add('hidden');
        kidForm.reset();
        await loadKids();
    } catch (error) {
        console.error('Error creating kid:', error);
        showError('Failed to create kid. Please try again.');
    } finally {
        isCreatingKid = false;
        submitBtn.disabled = false;
        submitBtn.textContent = 'Save';
        if (kidNameInput) {
            kidNameInput.disabled = false;
        }
    }
}

async function deleteKid(kidId, kidName) {
    try {
        const result = await window.PracticeManageCommon.requestWithPasswordDialog(
            `deleting ${kidName}`,
            (password) => fetch(`${API_BASE}/kids/${kidId}`, {
                method: 'DELETE',
                headers: window.PracticeManageCommon.buildPasswordHeaders(password, false),
            }),
            { warningMessage: 'This will permanently delete this kid and all practice data.' }
        );
        if (result.cancelled) {
            return;
        }
        if (!result.ok) {
            throw new Error(result.error || 'Failed to delete kid.');
        }

        await loadKids();
    } catch (error) {
        console.error('Error deleting kid:', error);
        showError(error.message || 'Failed to delete kid. Please try again.');
    }
}

async function goToLatestTypeIIIReviewSession(kidId) {
    try {
        showError('');
        const response = await fetch(`${API_BASE}/kids/${kidId}/report/type-iii/next-to-grade`);
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }
        const data = await response.json().catch(() => ({}));
        const targetSessionId = Number(data.session_id);
        if (!Number.isFinite(targetSessionId) || targetSessionId <= 0) {
            const latestSessionId = Number(data.latest_session_id);
            if (Number.isFinite(latestSessionId) && latestSessionId > 0) {
                showError('No Type-III cards need grading right now.');
            } else {
                showError('No Type-III session found yet for this kid.');
            }
            return;
        }
        window.location.href = `/kid-session-report.html?id=${encodeURIComponent(kidId)}&sessionId=${encodeURIComponent(targetSessionId)}`;
    } catch (error) {
        console.error('Error opening latest Type-III session:', error);
        showError('Failed to open latest Type-III session.');
    }
}

async function openDeckCategoryOptInModal(kidId) {
    try {
        const kidIdText = String(kidId || '').trim();
        if (!kidIdText) {
            return;
        }
        const kid = currentKids.find((item) => String(item?.id || '') === kidIdText);
        const kidName = kid?.name ? String(kid.name) : 'Kid';
        if (deckCategoryKidLabel) {
            deckCategoryKidLabel.textContent = `Kid: ${kidName}`;
        }
        deckCategoryModalState = {
            kidId: kidIdText,
            availableKeys: [],
            optedInKeys: [],
        };
        renderDeckCategoryModalLists();
        if (deckCategoryModal) {
            deckCategoryModal.classList.remove('hidden');
        }

        const response = await fetch(`${API_BASE}/kids/${encodeURIComponent(kidIdText)}/deck-categories`);
        if (!response.ok) {
            const payload = await response.json().catch(() => ({}));
            throw new Error(payload.error || `HTTP ${response.status}`);
        }
        const data = await response.json().catch(() => ({}));
        const availableKeys = Array.isArray(data.available_category_keys)
            ? data.available_category_keys.map((value) => String(value || '').trim()).filter(Boolean)
            : [];
        const optedInKeys = Array.isArray(data.opted_in_category_keys)
            ? data.opted_in_category_keys.map((value) => String(value || '').trim()).filter(Boolean)
            : [];

        deckCategoryModalState.availableKeys = availableKeys;
        deckCategoryModalState.optedInKeys = optedInKeys;
        renderDeckCategoryModalLists();
    } catch (error) {
        console.error('Error loading deck categories:', error);
        closeDeckCategoryModal();
        showError('Failed to load deck categories.');
    }
}

function closeDeckCategoryModal() {
    if (deckCategoryModal) {
        deckCategoryModal.classList.add('hidden');
    }
    isSavingDeckCategories = false;
    setDeckCategoryConfirmButtonState();
}

function renderDeckCategoryModalLists() {
    renderDeckCategoryBubbleList(deckCategoryAvailableBubbles, deckCategoryModalState.availableKeys, false);
    renderDeckCategoryBubbleList(deckCategoryOptedBubbles, deckCategoryModalState.optedInKeys, true);
    if (deckCategoryAvailableTitle) {
        deckCategoryAvailableTitle.textContent = `Available Deck Categories (${deckCategoryModalState.availableKeys.length})`;
    }
    if (deckCategoryOptedTitle) {
        deckCategoryOptedTitle.textContent = `Opted-in Deck Categories (${deckCategoryModalState.optedInKeys.length})`;
    }
    if (deckCategoryAvailableEmpty) {
        deckCategoryAvailableEmpty.classList.toggle('hidden', deckCategoryModalState.availableKeys.length > 0);
    }
    if (deckCategoryOptedEmpty) {
        deckCategoryOptedEmpty.classList.toggle('hidden', deckCategoryModalState.optedInKeys.length > 0);
    }
}

function renderDeckCategoryBubbleList(containerEl, keys, selected) {
    if (!containerEl) {
        return;
    }
    const sortedKeys = [...keys].sort((a, b) => a.localeCompare(b));
    const bubbleClass = selected ? 'deck-category-bubble selected' : 'deck-category-bubble';
    const bubbleTitle = selected ? 'Click to move back to Available' : 'Click to opt in';
    containerEl.innerHTML = sortedKeys
        .map((key) => `
            <button type="button" class="${bubbleClass}" data-category-key="${escapeHtml(key)}" title="${bubbleTitle}">
                ${escapeHtml(key)}
            </button>
        `)
        .join('');
}

function moveDeckCategoryByKey(rawKey, direction) {
    const key = String(rawKey || '').trim();
    if (!key) {
        return;
    }
    if (direction === 'toOpted') {
        const removeSet = new Set([key]);
        deckCategoryModalState.availableKeys = deckCategoryModalState.availableKeys.filter((key) => !removeSet.has(key));
        const next = new Set(deckCategoryModalState.optedInKeys);
        next.add(key);
        deckCategoryModalState.optedInKeys = Array.from(next);
    } else {
        const removeSet = new Set([key]);
        deckCategoryModalState.optedInKeys = deckCategoryModalState.optedInKeys.filter((key) => !removeSet.has(key));
        const next = new Set(deckCategoryModalState.availableKeys);
        next.add(key);
        deckCategoryModalState.availableKeys = Array.from(next);
    }
    renderDeckCategoryModalLists();
}

async function saveDeckCategoryOptIns() {
    if (isSavingDeckCategories) {
        return;
    }
    const kidId = String(deckCategoryModalState.kidId || '').trim();
    if (!kidId) {
        return;
    }
    try {
        isSavingDeckCategories = true;
        setDeckCategoryConfirmButtonState();
        const optedInKeys = [...deckCategoryModalState.optedInKeys].sort((a, b) => a.localeCompare(b));
        const response = await fetch(`${API_BASE}/kids/${encodeURIComponent(kidId)}/deck-categories`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ categoryKeys: optedInKeys }),
        });
        if (!response.ok) {
            const payload = await response.json().catch(() => ({}));
            throw new Error(payload.error || `HTTP ${response.status}`);
        }
        closeDeckCategoryModal();
        await loadKids();
    } catch (error) {
        console.error('Error saving deck categories:', error);
        showError(error.message || 'Failed to save deck categories.');
    } finally {
        isSavingDeckCategories = false;
        setDeckCategoryConfirmButtonState();
    }
}

function setDeckCategoryConfirmButtonState() {
    if (!deckCategoryConfirmBtn) {
        return;
    }
    deckCategoryConfirmBtn.disabled = isSavingDeckCategories;
    deckCategoryConfirmBtn.textContent = isSavingDeckCategories ? 'Saving...' : 'Confirm';
}

function getManagePathByCategory(categoryKey, categoryMetaMap = {}) {
    const key = String(categoryKey || '').trim().toLowerCase();
    const meta = categoryMetaMap?.[key] || {};
    const behaviorType = String(meta.behavior_type || '').trim().toLowerCase();
    return ['type_i', 'type_ii', 'type_iii', 'type_iv'].includes(behaviorType)
        ? '/kid-card-manage.html'
        : '';
}

function getManageHrefByCategory(categoryKey, kidId, categoryMetaMap = {}) {
    const key = String(categoryKey || '').trim().toLowerCase();
    const path = getManagePathByCategory(key, categoryMetaMap);
    if (!path) {
        return '';
    }
    const params = new URLSearchParams();
    params.set('id', String(kidId || ''));
    params.set('categoryKey', key);
    return `${path}?${params.toString()}`;
}

function getPrintableWorksheetHrefForCategory(kid, categoryKey, categoryMetaMap = {}) {
    const key = String(categoryKey || '').trim().toLowerCase();
    if (!key) {
        return '';
    }
    const meta = categoryMetaMap?.[key] || {};
    if (String(meta.behavior_type || '').trim().toLowerCase() !== 'type_ii' || !Boolean(meta.has_chinese_specific_logic)) {
        return '';
    }
    const params = new URLSearchParams();
    params.set('id', String(kid?.id || ''));
    params.set('categoryKey', key);
    return `/kid-writing-sheet-manage.html?${params.toString()}`;
}

// UI Functions
function displayKids(kids) {
    if (kids.length === 0) {
        kidsList.innerHTML = `
            <div class="redesign-empty-state">
                <h3>No kids yet</h3>
                <p>Tap ➕️ Add Kid to add your first learner.</p>
            </div>
        `;
        return;
    }

    kidsList.innerHTML = kids.map(kid => {
        const optedInCategories = getOptedInDeckCategorySet(kid);
        const practiceTargetByCategory = getCategoryValueMap(kid?.practiceTargetByDeckCategory);
        const categoryMetaMap = getDeckCategoryMetaMap(kid);
        const optedInCategoryKeys = Array.from(optedInCategories).sort((a, b) => a.localeCompare(b));
        const availableOptInCount = Object.entries(categoryMetaMap).filter(([categoryKey, meta]) => {
            const normalizedKey = String(categoryKey || '').trim().toLowerCase();
            const behaviorType = String(meta?.behavior_type || '').trim().toLowerCase();
            return normalizedKey
                && VALID_BEHAVIOR_TYPES.has(behaviorType)
                && !optedInCategories.has(normalizedKey);
        }).length;

        const configuredDeckCount = optedInCategoryKeys.length;
        const summaryText = configuredDeckCount > 0
            ? `${configuredDeckCount} deck${configuredDeckCount === 1 ? '' : 's'} active`
            : 'No deck categories yet';
        const deckHeroNote = availableOptInCount > 0
            ? `${availableOptInCount} to opt in`
            : (configuredDeckCount > 0 ? 'All opted in' : 'Tap + to choose what this kid practices');
        let worksheetToolAttached = false;
        let reviewToolAttached = false;

        const manageRows = optedInCategoryKeys.map((categoryKey) => {
            const displayName = getCategoryDisplayName(categoryKey, categoryMetaMap);
            const emoji = getCategoryEmoji(categoryKey, categoryMetaMap);
            const meta = categoryMetaMap?.[categoryKey] || {};
            const behaviorType = String(meta.behavior_type || '').trim().toLowerCase();
            const dailyTarget = Number.parseInt(practiceTargetByCategory[categoryKey], 10);
            const safeDailyTarget = Number.isInteger(dailyTarget) ? Math.max(0, dailyTarget) : 0;
            const note = `${safeDailyTarget}/day target`;
            const href = getManageHrefByCategory(categoryKey, kid.id, categoryMetaMap);
            const printableWorksheetHref = getPrintableWorksheetHrefForCategory(kid, categoryKey, categoryMetaMap);
            const inlineToolHtml = printableWorksheetHref && !worksheetToolAttached
                ? `<a class="admin-row-pill admin-row-pill-secondary admin-row-pill-print semantic-outline-btn semantic-outline-btn--blue" href="${printableWorksheetHref}">🖨️ Printable sheets</a>`
                : (Boolean(kid.hasTypeIIIToReview) && behaviorType === 'type_iii' && !reviewToolAttached
                    ? `<button type="button" class="admin-row-pill admin-row-pill-secondary admin-row-pill-audio semantic-outline-btn semantic-outline-btn--green" onclick="goToLatestTypeIIIReviewSession('${kid.id}')">🎧 Review audio</button>`
                    : '');
            if (printableWorksheetHref && !worksheetToolAttached) {
                worksheetToolAttached = true;
            } else if (Boolean(kid.hasTypeIIIToReview) && behaviorType === 'type_iii' && !reviewToolAttached && inlineToolHtml) {
                reviewToolAttached = true;
            }
            const rowRightHtml = href
                ? ''
                : `<span class="admin-row-pill admin-row-pill-muted">Soon</span>`;
            const rowInnerHtml = `
                <div class="redesign-subject-main">
                    <div class="redesign-subject-title">
                        <span class="redesign-subject-emoji">${escapeHtml(emoji)}</span>
                        <span class="redesign-subject-name">${escapeHtml(displayName)}</span>
                    </div>
                    <div class="redesign-subject-note">${escapeHtml(note)}</div>
                </div>
                ${rowRightHtml ? `<div class="redesign-subject-right">${rowRightHtml}</div>` : ''}
            `;
            const rowHtml = href
                ? `<a class="redesign-subject-row admin-config-row admin-config-row-link" href="${href}">${rowInnerHtml}</a>`
                : `<div class="redesign-subject-row admin-config-row admin-config-row-disabled" title="Manage page not implemented yet">${rowInnerHtml}</div>`;
            return `
                <div class="admin-config-item${inlineToolHtml ? ' admin-config-item-with-tool' : ''}">
                    ${inlineToolHtml ? `<div class="admin-config-utility">${inlineToolHtml}</div>` : ''}
                    ${rowHtml}
                </div>
            `;
        });
        const subjectRowsHtml = manageRows.join('');
        return `
            <div class="redesign-kid-card admin-kid-card">
                <div class="redesign-kid-top">
                    <div>
                        <h3 class="redesign-kid-name">${escapeHtml(kid.name)}</h3>
                        <div class="redesign-kid-sub">${escapeHtml(summaryText)}</div>
                    </div>
                    <a class="admin-records-pill" href="/kid-report.html?id=${kid.id}">
                        <span class="admin-records-pill-icon" aria-hidden="true">📊</span>
                        <span class="admin-records-pill-label">Records</span>
                    </a>
                </div>
                <div class="admin-deck-hero-stack">
                    <a class="admin-deck-hero admin-deck-hero-link" href="#" onclick="openDeckCategoryOptInModal('${kid.id}'); return false;">
                        <span class="admin-deck-hero-icon" aria-hidden="true">+</span>
                        <span class="admin-deck-hero-copy">
                            <span class="admin-deck-hero-title">Opt-in/out Deck Category</span>
                            <span class="admin-deck-hero-note">${escapeHtml(deckHeroNote)}</span>
                        </span>
                    </a>
                </div>
                ${subjectRowsHtml ? `<div class="redesign-subject-list admin-config-list">${subjectRowsHtml}</div>` : ''}
                <div class="admin-card-footer">
                    <button type="button" class="admin-delete-btn semantic-outline-btn semantic-outline-btn--red" onclick="deleteKid('${kid.id}', '${escapeHtml(kid.name)}')">
                        🗑️ Delete
                    </button>
                </div>
            </div>
        `;
    }).join('');
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
