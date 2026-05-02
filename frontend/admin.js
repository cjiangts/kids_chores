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
const deckCategoryHeading = document.getElementById('deckCategoryHeading');
const deckCategoryList = document.getElementById('deckCategoryList');
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
const PARENT_NAV_CACHE_KEY_PREFIX = 'parent_admin_nav_cache_v1';
const CURRENT_FAMILY_ID_STORAGE_KEY = 'current_family_id_v1';
const PARENT_NAV_CACHE_TTL_MS = 2 * 60 * 1000;
let isCreatingKid = false;
let isSavingDeckCategories = false;
let currentKids = [];
let currentFamilyId = '';
let deckCategoryModalState = {
    kidId: '',
    allKeys: [],
    optedInKeys: new Set(),
    baselineKeys: new Set(),
};

// Load kids on page load
document.addEventListener('DOMContentLoaded', () => {
    applySuperFamilyUi();
    loadKids({ preferNavigationCache: true });
});

// Event Listeners
const kidFormSaveBtn = document.getElementById('kidFormSaveBtn');

function syncKidFormSaveBtn() {
    if (kidFormSaveBtn) {
        kidFormSaveBtn.disabled = !kidNameInput || !kidNameInput.value.trim();
    }
}

newKidBtn.addEventListener('click', () => {
    kidModal.classList.remove('hidden');
    syncKidFormSaveBtn();
});

cancelBtn.addEventListener('click', () => {
    kidModal.classList.add('hidden');
    kidForm.reset();
    syncKidFormSaveBtn();
});

if (kidNameInput) {
    kidNameInput.addEventListener('input', syncKidFormSaveBtn);
}

kidForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    await createKid();
});

if (deckCategoryCancelBtn) {
    deckCategoryCancelBtn.addEventListener('click', closeDeckCategoryModal);
}
if (deckCategoryList) {
    deckCategoryList.addEventListener('click', (event) => {
        const button = event.target.closest('button[data-category-key]');
        if (!button) {
            return;
        }
        toggleDeckCategoryByKey(button.getAttribute('data-category-key'));
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
        if (deckCategoryHeading) {
            deckCategoryHeading.textContent = `${kidName}'s Deck Categories`;
        }
        deckCategoryModalState = {
            kidId: kidIdText,
            allKeys: [],
            optedInKeys: new Set(),
            baselineKeys: new Set(),
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

        const allKeysSet = new Set([...optedInKeys, ...availableKeys]);
        deckCategoryModalState.allKeys = Array.from(allKeysSet).sort((a, b) => a.localeCompare(b));
        deckCategoryModalState.optedInKeys = new Set(optedInKeys);
        deckCategoryModalState.baselineKeys = new Set(optedInKeys);
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
    if (!deckCategoryList) {
        return;
    }
    const kid = currentKids.find((item) => String(item?.id || '') === String(deckCategoryModalState.kidId || ''));
    const categoryMetaMap = getDeckCategoryMetaMap(kid);
    const { allKeys, optedInKeys, baselineKeys } = deckCategoryModalState;
    deckCategoryList.innerHTML = allKeys
        .map((key) => {
            const isSelected = optedInKeys.has(key);
            const wasSelected = baselineKeys.has(key);
            const emoji = getCategoryEmoji(key, categoryMetaMap);
            const label = getCategoryDisplayName(key, categoryMetaMap) || key;
            const checkHtml = isSelected ? '<span class="deck-cat-check">&#10003;</span>' : '<span class="deck-cat-check"></span>';
            let badgeHtml = '';
            if (isSelected !== wasSelected) {
                badgeHtml = isSelected
                    ? '<span class="deck-cat-badge opt-in">+ opt-in</span>'
                    : '<span class="deck-cat-badge opt-out">- opt-out</span>';
            }
            const rowClass = isSelected !== wasSelected
                ? (isSelected ? 'deck-cat-row newly-opted-in' : 'deck-cat-row newly-opted-out')
                : (isSelected ? 'deck-cat-row selected' : 'deck-cat-row');
            return `<button type="button" class="${rowClass}" data-category-key="${escapeHtml(key)}">
                <span class="deck-cat-label">${escapeHtml(`${emoji} ${label}`)}</span>
                ${badgeHtml}
                ${checkHtml}
            </button>`;
        })
        .join('');
    setDeckCategoryConfirmButtonState();
}

function toggleDeckCategoryByKey(rawKey) {
    const key = String(rawKey || '').trim();
    if (!key) {
        return;
    }
    if (deckCategoryModalState.optedInKeys.has(key)) {
        deckCategoryModalState.optedInKeys.delete(key);
    } else {
        deckCategoryModalState.optedInKeys.add(key);
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

function getDeckCategoryChangeCounts() {
    const { allKeys, optedInKeys, baselineKeys } = deckCategoryModalState;
    let optIn = 0;
    let optOut = 0;
    allKeys.forEach((key) => {
        const now = optedInKeys.has(key);
        const was = baselineKeys.has(key);
        if (now && !was) optIn++;
        if (!now && was) optOut++;
    });
    return { optIn, optOut };
}

function setDeckCategoryConfirmButtonState() {
    if (!deckCategoryConfirmBtn) {
        return;
    }
    if (isSavingDeckCategories) {
        deckCategoryConfirmBtn.disabled = true;
        deckCategoryConfirmBtn.textContent = 'Saving...';
        return;
    }
    const { optIn, optOut } = getDeckCategoryChangeCounts();
    const hasChanges = optIn > 0 || optOut > 0;
    deckCategoryConfirmBtn.disabled = !hasChanges;
    if (!hasChanges) {
        deckCategoryConfirmBtn.textContent = 'Confirm';
    } else {
        const parts = [];
        if (optIn > 0) parts.push(`+${optIn}`);
        if (optOut > 0) parts.push(`-${optOut}`);
        deckCategoryConfirmBtn.textContent = `Confirm (${parts.join(', ')})`;
    }
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
        const manageRows = optedInCategoryKeys.map((categoryKey) => {
            const displayName = getCategoryDisplayName(categoryKey, categoryMetaMap);
            const emoji = getCategoryEmoji(categoryKey, categoryMetaMap);
            const dailyTarget = Number.parseInt(practiceTargetByCategory[categoryKey], 10);
            const safeDailyTarget = Number.isInteger(dailyTarget) ? Math.max(0, dailyTarget) : 0;
            const note = `${safeDailyTarget}/day target`;
            const href = getManageHrefByCategory(categoryKey, kid.id, categoryMetaMap);
            const tileHtml = `<span class="admin-subject-tile" aria-hidden="true">${escapeHtml(emoji)}</span>`;
            const bodyHtml = `
                <div class="admin-subject-body">
                    <div class="redesign-subject-title"><span class="redesign-subject-name">${escapeHtml(displayName)}</span></div>
                    <div class="redesign-subject-note">${escapeHtml(note)}</div>
                </div>
            `;
            const trailingHtml = href
                ? `<span class="admin-row-chevron" aria-hidden="true">›</span>`
                : `<span class="admin-row-pill admin-row-pill-muted">Soon</span>`;
            const rowInnerHtml = `${tileHtml}${bodyHtml}${trailingHtml}`;
            return href
                ? `<a class="redesign-subject-row admin-config-row admin-config-row-link" href="${href}">${rowInnerHtml}</a>`
                : `<div class="redesign-subject-row admin-config-row admin-config-row-disabled" title="Manage page not implemented yet">${rowInnerHtml}</div>`;
        });
        const subjectRowsHtml = manageRows.join('');
        const initial = getKidInitial(kid.name);
        const avatarToneIndex = hashStringToIndex(String(kid.id || kid.name || ''), KID_AVATAR_TONE_COUNT);
        const reviewCount = Number.parseInt(kid.typeIIIToReviewCount, 10);
        const safeReviewCount = Number.isInteger(reviewCount) && reviewCount > 0 ? reviewCount : 0;
        const reviewAudioHtml = safeReviewCount > 0
            ? `<button type="button" class="admin-review-audio-btn" onclick="goToLatestTypeIIIReviewSession('${kid.id}')" title="Review audio" aria-label="Review audio (${safeReviewCount})">
                    <span class="admin-review-audio-icon" aria-hidden="true">🎧</span>
                    <span class="admin-review-audio-badge">${safeReviewCount}</span>
                </button>`
            : '';
        return `
            <div class="redesign-kid-card admin-kid-card">
                <div class="redesign-kid-top">
                    <div class="admin-kid-identity">
                        <span class="admin-kid-avatar admin-kid-avatar--tone-${avatarToneIndex}" aria-hidden="true">${escapeHtml(initial)}</span>
                        <div class="admin-kid-identity-text">
                            <h3 class="redesign-kid-name">${escapeHtml(kid.name)}</h3>
                            <div class="redesign-kid-sub">${escapeHtml(summaryText)}</div>
                        </div>
                    </div>
                    <div class="admin-kid-actions">
                        <a class="admin-optin-pill" href="#" onclick="openDeckCategoryOptInModal('${kid.id}'); return false;" title="Opt-in/out Deck Category" aria-label="Opt-in/out Deck Category">
                            <span class="admin-optin-pill-icon" aria-hidden="true">+</span>
                            <span class="admin-optin-pill-label">Opt-in</span>
                        </a>
                        ${reviewAudioHtml}
                        <a class="admin-records-pill" href="/kid-report.html?id=${kid.id}">
                            <span class="admin-records-pill-icon" aria-hidden="true">📊</span>
                            <span class="admin-records-pill-label">Records</span>
                            <span class="admin-records-pill-chevron" aria-hidden="true">›</span>
                        </a>
                    </div>
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
