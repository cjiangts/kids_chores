/*
 * admin.js — family home page (admin.html).
 *
 * Renders the audio-review banner, the deck-category opt-in matrix
 * with a per-kid daily-progress ring, the "start practice" jump
 * button, edit-mode delete overlay, and the deck-browse modal.
 *
 * Edit mode is the matrix's "rearrange" view: it lets the parent
 * toggle category opt-ins per kid (with debounced saves per row) and
 * delete a kid via the trash overlay on the avatar.
 *
 * Layout (search for `// === N. ` banners to jump between sections):
 *
 *     1. DOM refs + auth + DOMContentLoaded
 *     2. Display helpers (escape, initial, hashing, last-viewed-kid)
 *     3. Kid CRUD + cache + load
 *     4. Audio-review banner
 *     5. Opt-in matrix render
 *     6. Matrix edit mode + per-kid debounced save
 *     7. Per-subject menu
 *     8. Deck browse modal
 */

// API Configuration
const API_BASE = `${window.location.origin}/api`;

// DOM Elements
const adminReviewBanner = document.getElementById('adminReviewBanner');
const adminOptinPanel = document.getElementById('adminOptinPanel');
const adminMatrix = document.getElementById('adminMatrix');
const adminEmptyState = document.getElementById('adminEmptyState');
const getEditToggleBtn = () => document.getElementById('editToggleBtn');
const kidModal = document.getElementById('kidModal');
const kidForm = document.getElementById('kidForm');
const cancelBtn = document.getElementById('cancelBtn');
const errorMessage = document.getElementById('errorMessage');
const kidNameInput = document.getElementById('kidName');
const kidFormSaveBtn = document.getElementById('kidFormSaveBtn');

const {
    normalizeCategoryKey,
    getOptedInDeckCategorySet,
    getCategoryValueMap,
    getDeckCategoryMetaMap,
    getCategoryDisplayName,
    renderCategorySubjectIcon,
    normalizeBehaviorType,
} = window.DeckCategoryCommon;

const VALID_BEHAVIOR_TYPES = new Set(['type_i', 'type_ii', 'type_iii', 'type_iv']);
const KID_AVATAR_TONE_COUNT = 6;
const PARENT_NAV_CACHE_KEY_PREFIX = 'parent_admin_nav_cache_v1';
const CURRENT_FAMILY_ID_STORAGE_KEY = 'current_family_id_v1';
const LAST_VIEWED_KID_STORAGE_KEY = 'parent_admin_last_kid_id_v1';
const PARENT_NAV_CACHE_TTL_MS = 2 * 60 * 1000;

let isCreatingKid = false;
let currentKids = [];
let kidsLoaded = false;
let currentFamilyId = '';
let editMode = false;
let editState = null;
let isExitingEditMode = false;
const pendingSaveTimers = new Map();
const inFlightSaves = new Map();
const savingKids = new Set();
const KID_AUTOSAVE_DELAY_MS = 450;
let openSubjectMenuKey = '';
let isPanelMenuOpen = false;
let isSuperFamily = false;
let offlineSelectionMode = false;
const offlineSelectedKidIds = new Set();
const offlineDownloadingKidIds = new Set();
let offlineOwnedKidIds = new Set();

// =====================================================================
// === 1. DOM refs + auth + DOMContentLoaded
// =====================================================================
document.addEventListener('DOMContentLoaded', () => {
    loadKids({ preferNavigationCache: true });
    loadAuthStatus();
    bindEvents();
});

async function loadAuthStatus() {
    try {
        const response = await fetch(`${API_BASE}/family-auth/status`);
        if (!response.ok) return;
        const auth = await response.json().catch(() => ({}));
        const next = Boolean(auth && auth.isSuperFamily);
        if (next === isSuperFamily) return;
        isSuperFamily = next;
        renderMatrix();
    } catch (error) {
        // ignore — non-super family is the safe default
    }
}

function bindEvents() {
    document.addEventListener('click', (event) => {
        const trigger = event.target && event.target.closest
            ? event.target.closest('[data-action="add-kid"]')
            : null;
        if (!trigger) return;
        kidModal.classList.remove('hidden');
        syncKidFormSaveBtn();
    });
    if (cancelBtn) {
        cancelBtn.addEventListener('click', () => {
            kidModal.classList.add('hidden');
            kidForm.reset();
            syncKidFormSaveBtn();
        });
    }
    if (kidNameInput) {
        kidNameInput.addEventListener('input', syncKidFormSaveBtn);
    }
    if (kidForm) {
        kidForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            await createKid();
        });
    }
    if (adminOptinPanel) {
        adminOptinPanel.addEventListener('click', (e) => {
            const btn = e.target && e.target.closest ? e.target.closest('#editToggleBtn') : null;
            if (!btn) return;
            if (editMode) {
                exitEditMode();
            } else {
                enterEditMode();
            }
        });
    }
    document.addEventListener('click', (event) => {
        if (openSubjectMenuKey) {
            const subjectMenu = document.querySelector('.admin-subject-menu');
            const subjectTrigger = event.target.closest('[data-subject-menu-trigger]');
            const inside = (subjectMenu && subjectMenu.contains(event.target)) || subjectTrigger;
            if (!inside) closeSubjectMenu();
        }
        if (isPanelMenuOpen) {
            const panelMenu = document.querySelector('.admin-panel-menu');
            const panelTrigger = event.target.closest('[data-panel-menu-trigger]');
            const inside = (panelMenu && panelMenu.contains(event.target)) || panelTrigger;
            if (!inside) closePanelMenu();
        }
    });
    bindOfflineModeEvents();
}

function syncKidFormSaveBtn() {
    if (kidFormSaveBtn) {
        kidFormSaveBtn.disabled = !kidNameInput || !kidNameInput.value.trim();
    }
}

// =====================================================================
// === 2. Display helpers (escape, initial, hashing, last-viewed-kid)
// =====================================================================
function escapeHtml(text) {
    return String(text || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function formatBytesShort(bytes) {
    const v = Number(bytes);
    if (!Number.isFinite(v) || v <= 0) return '0 B';
    if (v < 1024) return `${Math.round(v)} B`;
    if (v < 1024 * 1024) return `${(v / 1024).toFixed(1)} KB`;
    if (v < 1024 * 1024 * 1024) return `${(v / (1024 * 1024)).toFixed(1)} MB`;
    return `${(v / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

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

function readLastViewedKidId() {
    try {
        if (!window.sessionStorage) return '';
        return String(window.sessionStorage.getItem(LAST_VIEWED_KID_STORAGE_KEY) || '').trim();
    } catch (error) {
        return '';
    }
}

function persistLastViewedKidId(kidId) {
    try {
        if (!window.sessionStorage) return;
        const normalized = String(kidId || '').trim();
        if (!normalized) {
            window.sessionStorage.removeItem(LAST_VIEWED_KID_STORAGE_KEY);
            return;
        }
        window.sessionStorage.setItem(LAST_VIEWED_KID_STORAGE_KEY, normalized);
    } catch (error) {
        // ignore
    }
}

function getMostRecentKidId(kids) {
    const list = Array.isArray(kids) ? kids : [];
    if (list.length === 0) return '';
    const lastId = readLastViewedKidId();
    if (lastId && list.some((kid) => String(kid?.id || '') === lastId)) {
        return lastId;
    }
    const lastKid = list[list.length - 1];
    return String(lastKid?.id || '');
}

function readKidsFromParentNavigationCache() {
    try {
        if (!window.sessionStorage) return null;
        const familyId = String(currentFamilyId || readCurrentFamilyNavigationPointer() || '').trim();
        if (!familyId) return null;
        const raw = window.sessionStorage.getItem(buildParentNavCacheKey(familyId));
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        if (String(parsed?.familyId || '').trim() !== familyId) return null;
        const cachedAtMs = Number(parsed?.cachedAtMs || 0);
        if (!Number.isFinite(cachedAtMs) || cachedAtMs <= 0) return null;
        if ((Date.now() - cachedAtMs) > PARENT_NAV_CACHE_TTL_MS) return null;
        return Array.isArray(parsed?.kids) ? parsed.kids : null;
    } catch (error) {
        return null;
    }
}

function cacheKidsForParentNavigation(kids) {
    try {
        if (!window.sessionStorage) return;
        const list = Array.isArray(kids) ? kids : [];
        const familyId = inferFamilyIdFromKids(list) || String(currentFamilyId || '').trim();
        if (!familyId) return;
        currentFamilyId = familyId;
        persistCurrentFamilyNavigationPointer(familyId);
        window.sessionStorage.setItem(buildParentNavCacheKey(familyId), JSON.stringify({
            familyId,
            cachedAtMs: Date.now(),
            kids: list,
        }));
    } catch (error) {
        // ignore
    }
}

function inferFamilyIdFromKids(kids) {
    const list = Array.isArray(kids) ? kids : [];
    for (const kid of list) {
        const familyId = String(kid?.familyId || '').trim();
        if (familyId) return familyId;
    }
    return '';
}

function buildParentNavCacheKey(familyId) {
    return `${PARENT_NAV_CACHE_KEY_PREFIX}::${String(familyId || '').trim()}`;
}

function readCurrentFamilyNavigationPointer() {
    try {
        if (!window.sessionStorage) return '';
        return String(window.sessionStorage.getItem(CURRENT_FAMILY_ID_STORAGE_KEY) || '').trim();
    } catch (error) {
        return '';
    }
}

function persistCurrentFamilyNavigationPointer(familyId) {
    try {
        if (!window.sessionStorage) return;
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

// =====================================================================
// === 3. Kid CRUD + cache + load
// =====================================================================
async function loadKids(options = {}) {
    const preferNavigationCache = Boolean(options?.preferNavigationCache);
    let usedNavigationCache = false;
    try {
        showError('');
        if (preferNavigationCache) {
            const cachedKids = readKidsFromParentNavigationCache();
            if (cachedKids) {
                currentKids = cachedKids;
                kidsLoaded = true;
                renderAll();
                usedNavigationCache = true;
            }
        }
        if (!usedNavigationCache && adminOptinPanel) {
            adminOptinPanel.classList.add('hidden');
        }
        const response = await fetch(`${API_BASE}/kids?view=admin`);
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        const kids = await response.json();
        currentKids = Array.isArray(kids) ? kids : [];
        kidsLoaded = true;
        cacheKidsForParentNavigation(currentKids);
        renderAll();
    } catch (error) {
        console.error('Error loading kids:', error);
        if (!usedNavigationCache) {
            currentKids = [];
            kidsLoaded = true;
            showError('Failed to load kids. Make sure the backend server is running on port 5001.');
            renderAll();
        }
    }
}

async function createKid() {
    if (isCreatingKid) return;
    const submitBtn = kidForm.querySelector('button[type="submit"]');
    try {
        isCreatingKid = true;
        showError(null);
        const name = document.getElementById('kidName').value;
        submitBtn.disabled = true;
        const submitLabel = submitBtn.querySelector('.btn-label');
        if (submitLabel) submitLabel.textContent = 'Creating...';
        if (kidNameInput) kidNameInput.disabled = true;
        const response = await fetch(`${API_BASE}/kids`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name }),
        });
        if (!response.ok) {
            const payload = await response.json().catch(() => ({}));
            const message = payload?.error || `HTTP error! status: ${response.status}`;
            throw new Error(message);
        }
        kidModal.classList.add('hidden');
        kidForm.reset();
        await loadKids();
    } catch (error) {
        console.error('Error creating kid:', error);
        showError(error?.message || 'Failed to create kid. Please try again.');
    } finally {
        isCreatingKid = false;
        submitBtn.disabled = false;
        const submitLabel = submitBtn.querySelector('.btn-label');
        if (submitLabel) submitLabel.textContent = 'Save';
        if (kidNameInput) kidNameInput.disabled = false;
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
        if (result.cancelled) return;
        if (!result.ok) throw new Error(result.error || 'Failed to delete kid.');
        await loadKids();
    } catch (error) {
        console.error('Error deleting kid:', error);
        showError(error.message || 'Failed to delete kid. Please try again.');
    }
}

async function forceReleaseOfflineLock(kidId, kidName) {
    const kid = currentKids.find((item) => String(item?.id || '') === String(kidId));
    const lock = kid && kid.offlineLock;
    if (!lock || !lock.pack_id) {
        showError('No active offline lock found for this child.');
        return;
    }
    const deviceLabel = String(lock.device_label || 'the other device');
    const warning =
        `This drops ${kidName}'s offline lock so the child can practice online again.\n\n`
        + `Any unsynced practice results still on "${deviceLabel}" will be discarded `
        + `next time that device tries to sync. Use this only if that device is lost or unreachable.`;
    try {
        const result = await window.PracticeManageCommon.requestWithPasswordDialog(
            `dropping ${kidName}'s offline pack`,
            (password) => fetch(`${API_BASE}/kids/${kidId}/offline/force-release`, {
                method: 'POST',
                headers: window.PracticeManageCommon.buildPasswordHeaders(password, false),
            }),
            { warningMessage: warning }
        );
        if (result.cancelled) return;
        if (!result.ok) throw new Error(result.error || 'Failed to drop offline lock.');
        exitOfflineSelectionMode();
        await loadKids();
    } catch (error) {
        console.error('Error force-releasing offline lock:', error);
        showError(error.message || 'Failed to drop offline lock. Please try again.');
    }
}

async function goToLatestTypeIIIReviewSession(kidId) {
    try {
        showError('');
        const response = await fetch(`${API_BASE}/kids/${kidId}/report/type-iii/next-to-grade`);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
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
        persistLastViewedKidId(kidId);
        window.location.href = `/kid-session-report.html?id=${encodeURIComponent(kidId)}&sessionId=${encodeURIComponent(targetSessionId)}`;
    } catch (error) {
        console.error('Error opening latest Type-III session:', error);
        showError('Failed to open latest Type-III session.');
    }
}

function getCategoryRowsForFamily(kids) {
    // All kids in the same family share the same category meta map.
    const list = Array.isArray(kids) ? kids : [];
    const aggregated = {};
    list.forEach((kid) => {
        const meta = getDeckCategoryMetaMap(kid);
        Object.entries(meta || {}).forEach(([rawKey, value]) => {
            const key = normalizeCategoryKey(rawKey);
            if (!key) return;
            const behaviorType = String(value?.behavior_type || '').trim().toLowerCase();
            if (!VALID_BEHAVIOR_TYPES.has(behaviorType)) return;
            if (!aggregated[key]) {
                aggregated[key] = value;
            }
        });
    });
    const rows = Object.entries(aggregated)
        .map(([categoryKey, meta]) => ({
            categoryKey,
            displayName: getCategoryDisplayName(categoryKey, aggregated) || categoryKey,
            behaviorType: normalizeBehaviorType(meta?.behavior_type),
            chineseBackContent: String(meta?.chinese_back_content || '').trim().toLowerCase(),
        }))
        .sort((a, b) => a.displayName.localeCompare(b.displayName));
    return rows;
}

function buildEditStateFromKids(kids) {
    const state = {};
    (Array.isArray(kids) ? kids : []).forEach((kid) => {
        const kidId = String(kid?.id || '');
        if (!kidId) return;
        const optedInSet = getOptedInDeckCategorySet(kid);
        const meta = getDeckCategoryMetaMap(kid);
        state[kidId] = {};
        const allKeys = new Set();
        Object.keys(meta || {}).forEach((rawKey) => {
            const key = normalizeCategoryKey(rawKey);
            if (key) allKeys.add(key);
        });
        optedInSet.forEach((key) => allKeys.add(key));
        allKeys.forEach((key) => {
            state[kidId][key] = optedInSet.has(key);
        });
    });
    return state;
}

function renderAll() {
    renderReviewBanner();
    renderMatrix();
    updateStartPracticeHref();
    refreshOfflineOwnedAndStats();
    renderOfflineActionFooter();
}

function updateStartPracticeHref() {
    const btn = document.getElementById('startPracticeBtn');
    if (!btn) return;
    const list = Array.isArray(currentKids) ? currentKids : [];
    if (offlineSelectionMode) {
        // The offline action footer takes over this slot — fully hide the
        // Start Practice button so it doesn't peek above the footer.
        btn.classList.add('hidden');
        btn.setAttribute('aria-hidden', 'true');
        btn.removeAttribute('href');
        return;
    }
    btn.classList.remove('hidden');
    btn.removeAttribute('aria-hidden');
    const eligible = list.filter((kid) => !kid?.offlineLock).filter(kidHasPracticeTarget);
    if (eligible.length === 0 && list.length > 0 && list.every((k) => k?.offlineLock)) {
        btn.classList.add('is-disabled');
        btn.setAttribute('aria-disabled', 'true');
        btn.removeAttribute('href');
        btn.title = 'All kids are currently in offline mode.';
        return;
    }
    const targetKidId = pickKidWithPracticeTarget(list.filter((k) => !k?.offlineLock));
    if (!targetKidId) {
        btn.classList.add('is-disabled');
        btn.setAttribute('aria-disabled', 'true');
        btn.removeAttribute('href');
        btn.title = list.length === 0
            ? 'Add a kid first.'
            : 'Opt in a subject and set cards-per-day above 0 to start practice.';
        return;
    }
    btn.classList.remove('is-disabled');
    btn.removeAttribute('aria-disabled');
    btn.removeAttribute('title');
    btn.href = `/kid-practice-home.html?id=${encodeURIComponent(targetKidId)}`;
}

function pickKidWithPracticeTarget(kids) {
    const list = Array.isArray(kids) ? kids : [];
    if (list.length === 0) return '';
    const eligible = list.filter(kidHasPracticeTarget);
    if (eligible.length === 0) return '';
    const lastId = readLastViewedKidId();
    if (lastId && eligible.some((kid) => String(kid?.id || '') === lastId)) {
        return lastId;
    }
    return String(eligible[eligible.length - 1]?.id || '');
}

function kidHasPracticeTarget(kid) {
    const effectiveKeys = getEffectiveOptedInKeys(kid);
    if (effectiveKeys.length === 0) return false;
    const targets = getCategoryValueMap(kid?.practiceTargetByDeckCategory);
    for (const key of effectiveKeys) {
        const target = Number.parseInt(targets?.[key], 10);
        if (Number.isInteger(target) && target > 0) return true;
    }
    return false;
}

function getEffectiveOptedInKeys(kid) {
    const kidId = String(kid?.id || '');
    const stateForKid = editMode && editState ? editState[kidId] : null;
    if (stateForKid) {
        return Object.keys(stateForKid).filter((key) => !!stateForKid[key]);
    }
    return Array.from(getOptedInDeckCategorySet(kid));
}

// =====================================================================
// === 4. Audio-review banner
// =====================================================================
function renderReviewBanner() {
    if (!adminReviewBanner) return;
    const list = Array.isArray(currentKids) ? currentKids : [];
    const totalReviewCount = list.reduce((sum, kid) => {
        const count = Number.parseInt(kid?.typeIIIToReviewCount, 10);
        return sum + (Number.isInteger(count) && count > 0 ? count : 0);
    }, 0);
    if (totalReviewCount <= 0) {
        adminReviewBanner.classList.add('hidden');
        adminReviewBanner.innerHTML = '';
        return;
    }
    adminReviewBanner.classList.remove('hidden');
    adminReviewBanner.className = 'admin-review-banner';
    const noun = totalReviewCount === 1 ? 'audio recording' : 'audio recordings';
    const iconHtml = icon('headphones', { size: 20 });
    const chevronHtml = icon('chevron-right', { size: 16, strokeWidth: 2.4 });
    adminReviewBanner.innerHTML = `
        <span class="admin-review-banner-icon" aria-hidden="true">${iconHtml}</span>
        <span class="admin-review-banner-text">${totalReviewCount} ${escapeHtml(noun)} waiting for review</span>
        <span class="admin-review-banner-cta">Review ${chevronHtml}</span>
    `;
    adminReviewBanner.onclick = () => {
        const reviewKid = pickKidWithReviewAudio(list);
        if (!reviewKid) {
            showError('No audio to review right now.');
            return;
        }
        goToLatestTypeIIIReviewSession(reviewKid.id);
    };
}

function pickKidWithReviewAudio(kids) {
    const list = Array.isArray(kids) ? kids : [];
    const lastId = readLastViewedKidId();
    if (lastId) {
        const lastKid = list.find((kid) => String(kid?.id || '') === lastId);
        if (lastKid && Number.parseInt(lastKid.typeIIIToReviewCount, 10) > 0) {
            return lastKid;
        }
    }
    for (let i = list.length - 1; i >= 0; i--) {
        const kid = list[i];
        if (Number.parseInt(kid?.typeIIIToReviewCount, 10) > 0) {
            return kid;
        }
    }
    return null;
}

// =====================================================================
// === 5. Opt-in matrix render
// =====================================================================
function renderMatrix() {
    if (!adminMatrix || !adminOptinPanel || !adminEmptyState) return;
    const list = Array.isArray(currentKids) ? currentKids : [];
    if (list.length === 0) {
        adminOptinPanel.classList.add('hidden');
        if (kidsLoaded) adminEmptyState.classList.remove('hidden');
        else adminEmptyState.classList.add('hidden');
        return;
    }
    adminEmptyState.classList.add('hidden');
    adminOptinPanel.classList.remove('hidden');

    const rows = getCategoryRowsForFamily(list);
    if (rows.length === 0) {
        adminMatrix.innerHTML = `<tbody><tr><td class="admin-empty-state">No subjects available.</td></tr></tbody>`;
        const eb = getEditToggleBtn();
        if (eb) eb.disabled = true;
        return;
    }
    adminOptinPanel.classList.toggle('is-editing', editMode);
    adminOptinPanel.classList.toggle('is-offline-selecting', offlineSelectionMode);
    adminMatrix.classList.toggle('is-editable', editMode);
    adminMatrix.classList.toggle('is-offline-selecting', offlineSelectionMode);

    const editIconName = editMode ? 'check' : 'pencil';
    const editIconSvg = (typeof window.icon === 'function') ? window.icon(editIconName, { size: 14 }) : '';
    const editLabel = editMode ? 'Done' : 'Edit';
    const editBtnExtraClass = editMode ? ' admin-optin-edit-btn--done' : '';
    const addKidIconSvg = (typeof window.icon === 'function') ? window.icon('user-round-plus', { size: 14 }) : '';
    const moreIconSvg = (typeof window.icon === 'function') ? window.icon('more-vertical', { size: 18 }) : '';
    const addKidBtnHtml = (editMode && !offlineSelectionMode)
        ? `<button type="button" data-action="add-kid" class="btn-secondary admin-optin-edit-btn admin-optin-edit-btn--add-kid">${addKidIconSvg}<span>Add Kid</span></button>`
        : '';
    const panelMenuBtnHtml = (isSuperFamily && !offlineSelectionMode)
        ? `<button type="button" data-panel-menu-trigger class="admin-panel-menu-btn${editMode ? ' is-hidden' : ''}" ${editMode ? 'tabindex="-1" aria-hidden="true"' : ''} aria-label="More options">${moreIconSvg}</button>`
        : '';
    let subText;
    if (offlineSelectionMode) {
        subText = 'Pick kids for offline practice · packs expire at midnight';
    } else if (editMode) {
        subText = 'Tap to toggle · auto-saved';
    } else {
        subText = 'Numbers = cards/day · tap a number to manage';
    }
    let subClass = 'admin-matrix-title-sub';
    if (offlineSelectionMode) subClass += ' admin-matrix-title-sub--offline';
    else if (editMode) subClass += ' admin-matrix-title-sub--edit';
    const editToggleHtml = offlineSelectionMode
        ? ''
        : `<button id="editToggleBtn" type="button" class="btn-secondary admin-optin-edit-btn${editBtnExtraClass}">
                ${editIconSvg}<span id="editToggleLabel">${editLabel}</span>
            </button>`;
    const sectionHeaderHtml = `
        <div class="admin-matrix-section-header-text">
            <span class="admin-matrix-title-main">Subject Settings</span>
            <span class="${subClass}">${subText}</span>
        </div>
        <div class="admin-matrix-title-actions">
            ${addKidBtnHtml}
            ${editToggleHtml}
        </div>
    `;
    document.getElementById('adminMatrixHeader').innerHTML = sectionHeaderHtml;
    const headerHtml = `
        <thead>
            <tr>
                <th class="admin-matrix-subject-head"><span class="admin-matrix-subject-head-label"><span class="admin-matrix-subject-head-icon" aria-hidden="true">${(typeof window.icon === 'function') ? window.icon('book-open', { size: 16, strokeWidth: 2 }) : ''}</span>Subjects</span>${panelMenuBtnHtml}</th>
                ${list.map((kid) => buildKidColumnHeader(kid)).join('')}
            </tr>
        </thead>
    `;
    const bodyHtml = `
        <tbody>
            ${rows.map((row) => buildMatrixRow(row, list)).join('')}
        </tbody>
    `;
    adminMatrix.innerHTML = headerHtml + bodyHtml;

    bindMatrixInteractions(rows, list);
    if (openSubjectMenuKey) {
        renderSubjectMenu(openSubjectMenuKey);
    }
    if (isPanelMenuOpen) {
        renderPanelMenu();
    }
}

function buildKidColumnHeader(kid) {
    const kidId = String(kid?.id || '');
    const name = String(kid?.name || '');
    const initial = getKidInitial(name);
    const tone = hashStringToIndex(kidId || name, KID_AVATAR_TONE_COUNT);
    const savingClass = savingKids.has(kidId) ? ' is-saving' : '';
    const offlineLocked = Boolean(kid?.offlineLock);
    const offlineSelected = offlineSelectionMode && offlineSelectedKidIds.has(kidId);
    const offlineLockClass = offlineLocked ? ' is-offline-locked' : '';
    const offlineSelectClass = offlineSelected ? ' is-offline-selected' : '';
    const progress = computeKidDailyProgress(kid);
    const ringSegmentsHtml = buildKidRingSegmentsHtml(progress);
    const reportHref = `/kid-report.html?id=${encodeURIComponent(kidId)}`;
    let trashBtnHtml = '';
    if (editMode && !offlineSelectionMode) {
        trashBtnHtml = `<button type="button" class="admin-matrix-kid-delete-btn" data-kid-delete data-kid-id="${escapeHtml(kidId)}" aria-label="Delete ${escapeHtml(name)}">${icon('trash', { size: 26, strokeWidth: 2 })}</button>`;
    }
    const checkBadgeHtml = offlineSelectionMode && !offlineLocked
        ? `<span class="admin-matrix-kid-check-badge${offlineSelected ? ' is-checked' : ''}" aria-hidden="true">${offlineSelected ? '✓' : ''}</span>`
        : '';
    const lockBadgeHtml = offlineLocked
        ? `<span class="admin-matrix-kid-lock-badge" aria-label="${escapeHtml(name)} is offline on another device">${icon('cloud-off', { size: 18, strokeWidth: 2.5 })}</span>`
        : '';
    const avatarLockedClass = offlineLocked ? ' admin-matrix-kid-avatar--locked' : '';
    const offlineInfoHtml = (offlineSelectionMode && offlineLocked) ? buildOfflineLockInfoChipHtml(kid) : '';
    const avatarHtml = `
        <span class="admin-matrix-kid-ring-wrap">
            <svg class="admin-matrix-kid-ring-svg" viewBox="0 0 100 100" aria-hidden="true">
                <circle class="admin-matrix-kid-ring-track" cx="50" cy="50" r="46" />
                ${ringSegmentsHtml}
            </svg>
            <span class="admin-matrix-kid-avatar admin-matrix-kid-avatar--tone-${tone}${avatarLockedClass}" aria-hidden="true">${escapeHtml(initial)}</span>
            ${lockBadgeHtml}
            ${checkBadgeHtml}
            ${trashBtnHtml}
        </span>
        <span class="admin-matrix-kid-name">${escapeHtml(name)}</span>
    `;
    let interactiveHtml;
    if (offlineSelectionMode) {
        if (offlineLocked) {
            interactiveHtml = `
                <span class="admin-matrix-kid-head-btn">
                    ${avatarHtml}
                </span>
            `;
        } else {
            interactiveHtml = `
                <button type="button" class="admin-matrix-kid-head-btn" data-offline-kid-toggle data-kid-id="${escapeHtml(kidId)}" aria-pressed="${offlineSelected ? 'true' : 'false'}" aria-label="${offlineSelected ? 'Unselect' : 'Select'} ${escapeHtml(name)} for offline">
                    ${avatarHtml}
                </button>
            `;
        }
    } else if (editMode) {
        interactiveHtml = `
            <span class="admin-matrix-kid-head-btn">
                ${avatarHtml}
            </span>
        `;
    } else {
        interactiveHtml = `
            <a href="${escapeHtml(reportHref)}" class="admin-matrix-kid-head-btn" data-kid-report data-kid-id="${escapeHtml(kidId)}" aria-label="${escapeHtml(name)} — today's report">
                ${avatarHtml}
            </a>
        `;
    }
    return `
        <th class="admin-matrix-kid-head${savingClass}${offlineLockClass}${offlineSelectClass}" data-kid-id="${escapeHtml(kidId)}">
            ${interactiveHtml}
            ${offlineInfoHtml}
        </th>
    `;
}

function buildOfflineLockInfoChipHtml(kid) {
    const kidId = String(kid?.id || '');
    const lock = kid?.offlineLock || {};
    const device = String(lock.device_label || 'Another device');
    const familyTz = kid?.familyTimezone || kid?.timezone || '';
    const timeText = (window.OfflineCommon && typeof window.OfflineCommon.formatHourMinute === 'function')
        ? window.OfflineCommon.formatHourMinute(lock.acquired_at_utc, familyTz)
        : '';
    const totalBytes = Number(lock.pack_total_bytes);
    const totalFiles = Number(lock.pack_total_file_count);
    const audioCount = Number(lock.pack_audio_file_count);
    const lines = [];
    lines.push(`<div class="admin-matrix-kid-offline-info-device">${escapeHtml(device)}</div>`);
    if (timeText) lines.push(`<div class="admin-matrix-kid-offline-info-meta">${escapeHtml(timeText)}</div>`);
    if (Number.isFinite(totalBytes) && totalBytes > 0) {
        lines.push(`<div class="admin-matrix-kid-offline-info-meta">${escapeHtml(formatBytesShort(totalBytes))}</div>`);
    }
    if (Number.isFinite(totalFiles) && totalFiles > 0) {
        lines.push(`<div class="admin-matrix-kid-offline-info-meta">${totalFiles} file${totalFiles === 1 ? '' : 's'}</div>`);
    }
    if (Number.isFinite(audioCount) && audioCount > 0) {
        lines.push(`<div class="admin-matrix-kid-offline-info-meta">${audioCount} audio</div>`);
    }
    const ownedHere = offlineOwnedKidIds.has(kidId);
    if (ownedHere) {
        lines.push(`<a class="admin-matrix-kid-offline-info-resume" href="/kid-practice-home.html?id=${encodeURIComponent(kidId)}" data-offline-resume>${(typeof window.icon === 'function') ? window.icon('cloud-off', { size: 11 }) : ''}<span>Resume</span></a>`);
    }
    const safeName = String(kid?.name || '').trim() || 'this child';
    lines.push(`<button type="button" class="admin-matrix-kid-offline-info-release" data-offline-force-release data-kid-id="${escapeHtml(kidId)}" aria-label="Force-release offline lock for ${escapeHtml(safeName)}">${(typeof window.icon === 'function') ? window.icon('trash', { size: 14, strokeWidth: 2 }) : ''}</button>`);
    return `<div class="admin-matrix-kid-offline-info">${lines.join('')}</div>`;
}

function computeKidDailyProgress(kid) {
    const optedInKeys = Array.from(getOptedInDeckCategorySet(kid));
    const meta = getDeckCategoryMetaMap(kid);
    const practiceTargets = getCategoryValueMap(kid?.practiceTargetByDeckCategory);
    const dailyStarTiers = (kid && typeof kid.dailyStarTiersByDeckCategory === 'object')
        ? kid.dailyStarTiersByDeckCategory || {}
        : {};
    const assigned = optedInKeys.filter((key) => {
        const target = Number.parseInt(practiceTargets[key], 10);
        if (!(Number.isInteger(target) && target > 0)) return false;
        const behaviorType = normalizeBehaviorType(meta?.[key]?.behavior_type);
        return VALID_BEHAVIOR_TYPES.has(behaviorType);
    });
    let complete = 0;
    let inProgress = 0;
    assigned.forEach((key) => {
        const tiers = Array.isArray(dailyStarTiers[key]) ? dailyStarTiers[key] : [];
        if (tiers.some((tier) => String(tier || '').toLowerCase() === 'gold')) {
            complete += 1;
        } else if (tiers.length > 0) {
            inProgress += 1;
        }
    });
    return { total: assigned.length, complete, inProgress };
}

function buildKidRingSegmentsHtml({ total, complete, inProgress }) {
    if (!Number.isInteger(total) || total <= 0) return '';
    const radius = 46;
    const circumference = 2 * Math.PI * radius;
    const completeLen = circumference * (complete / total);
    const inProgressLen = circumference * (inProgress / total);
    const segments = [];
    if (completeLen > 0) {
        segments.push(`<circle class="admin-matrix-kid-ring-seg complete" cx="50" cy="50" r="${radius}" stroke-dasharray="${completeLen} ${circumference - completeLen}" stroke-dashoffset="0" />`);
    }
    if (inProgressLen > 0) {
        segments.push(`<circle class="admin-matrix-kid-ring-seg in-progress" cx="50" cy="50" r="${radius}" stroke-dasharray="${inProgressLen} ${circumference - inProgressLen}" stroke-dashoffset="${-completeLen}" />`);
    }
    return segments.join('');
}

function buildMatrixRow(row, kids) {
    const subjectIconHtml = renderCategorySubjectIcon(row.categoryKey, { size: 36 });
    const cellsHtml = kids.map((kid) => buildMatrixCell(row, kid)).join('');
    const showSubjectMenu = isSuperFamily;
    const moreIconHtml = (showSubjectMenu && typeof window.icon === 'function') ? window.icon('more-vertical', { size: 16 }) : '';
    const subjectMenuBtnHtml = showSubjectMenu
        ? `<button type="button" class="admin-matrix-subject-menu-btn" data-subject-menu-trigger data-category-key="${escapeHtml(row.categoryKey)}" data-chinese-back-content="${escapeHtml(row.chineseBackContent || '')}" data-behavior-type="${escapeHtml(row.behaviorType || '')}" aria-label="Subject options for ${escapeHtml(row.displayName)}">${moreIconHtml}</button>`
        : '';
    return `
        <tr data-category-key="${escapeHtml(row.categoryKey)}">
            <th scope="row">
                <div class="admin-matrix-subject-cell">
                    <span class="admin-matrix-subject-tile" aria-hidden="true">${subjectIconHtml}</span>
                    <span class="admin-matrix-subject-name">${escapeHtml(row.displayName)}</span>
                    ${subjectMenuBtnHtml}
                </div>
            </th>
            ${cellsHtml}
        </tr>
    `;
}

function buildMatrixCell(row, kid) {
    const kidId = String(kid?.id || '');
    const optedInSet = getOptedInDeckCategorySet(kid);
    const baselineOptedIn = optedInSet.has(row.categoryKey);
    const stateOptedIn = editState && editState[kidId] ? !!editState[kidId][row.categoryKey] : baselineOptedIn;
    const optedIn = editMode ? stateOptedIn : baselineOptedIn;
    const offlineLocked = Boolean(kid?.offlineLock);
    const offlineSelected = offlineSelectionMode && offlineSelectedKidIds.has(kidId);

    if (offlineSelectionMode) {
        const classes = ['admin-matrix-cell'];
        if (offlineLocked) classes.push('is-offline-locked');
        else if (offlineSelected) classes.push('is-offline-selected');
        const valClasses = ['admin-matrix-value', 'is-offline-onoff'];
        if (!optedIn) valClasses.push('is-off');
        const label = optedIn ? 'On' : 'Off';
        return `<td class="${classes.join(' ')}"><span class="${valClasses.join(' ')}">${label}</span></td>`;
    }

    if (!editMode) {
        if (!baselineOptedIn) {
            return `<td class="admin-matrix-cell"><span class="admin-matrix-value is-off">Off</span></td>`;
        }
        const targets = getCategoryValueMap(kid?.practiceTargetByDeckCategory);
        const cardsPerDay = Number.isInteger(targets[row.categoryKey]) ? targets[row.categoryKey] : 0;
        const params = new URLSearchParams({ id: kidId, categoryKey: row.categoryKey });
        const href = `/kid-card-manage.html?${params.toString()}`;
        const chevronHtml = (typeof window.icon === 'function') ? window.icon('chevron-right', { size: 12, strokeWidth: 2.5 }) : '';
        return `<td class="admin-matrix-cell"><a class="admin-matrix-value admin-matrix-value--link" href="${escapeHtml(href)}" data-cell-link data-kid-id="${escapeHtml(kidId)}"><span class="admin-matrix-value-num">${cardsPerDay}</span><span class="admin-matrix-value-chev" aria-hidden="true">${chevronHtml}</span></a></td>`;
    }

    const valueClass = optedIn ? 'admin-matrix-value' : 'admin-matrix-value is-off';
    const label = optedIn ? 'On' : 'Off';
    return `
        <td class="admin-matrix-cell">
            <button type="button" class="${valueClass}" data-cell-toggle data-kid-id="${escapeHtml(kidId)}" data-category-key="${escapeHtml(row.categoryKey)}" aria-pressed="${optedIn ? 'true' : 'false'}">${label}</button>
        </td>
    `;
}

function bindMatrixInteractions(rows, kids) {
    if (!adminMatrix) return;
    adminMatrix.querySelectorAll('[data-cell-toggle]').forEach((btn) => {
        btn.addEventListener('click', (event) => {
            const target = event.currentTarget;
            const kidId = target.getAttribute('data-kid-id') || '';
            const categoryKey = target.getAttribute('data-category-key') || '';
            toggleCellOptedIn(kidId, categoryKey);
        });
    });
    adminMatrix.querySelectorAll('[data-cell-link]').forEach((link) => {
        link.addEventListener('click', (event) => {
            persistLastViewedKidId(event.currentTarget.getAttribute('data-kid-id') || '');
        });
    });
    adminMatrix.querySelectorAll('[data-subject-menu-trigger]').forEach((btn) => {
        btn.addEventListener('click', (event) => {
            event.stopPropagation();
            const target = event.currentTarget;
            const categoryKey = target.getAttribute('data-category-key') || '';
            if (openSubjectMenuKey === categoryKey) {
                closeSubjectMenu();
            } else {
                openSubjectMenu(categoryKey, target);
            }
        });
    });
    adminMatrix.querySelectorAll('[data-kid-report]').forEach((link) => {
        link.addEventListener('click', (event) => {
            persistLastViewedKidId(event.currentTarget.getAttribute('data-kid-id') || '');
        });
    });
    adminMatrix.querySelectorAll('[data-kid-delete]').forEach((btn) => {
        btn.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            const target = event.currentTarget;
            const kidId = target.getAttribute('data-kid-id') || '';
            const kid = currentKids.find((item) => String(item?.id || '') === kidId);
            const name = String(kid?.name || '').trim();
            deleteKid(kidId, name);
        });
    });
    adminMatrix.querySelectorAll('[data-offline-force-release]').forEach((btn) => {
        btn.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            const target = event.currentTarget;
            const kidId = target.getAttribute('data-kid-id') || '';
            const kid = currentKids.find((item) => String(item?.id || '') === kidId);
            const name = String(kid?.name || '').trim() || 'this child';
            forceReleaseOfflineLock(kidId, name);
        });
    });
    adminMatrix.querySelectorAll('[data-offline-resume]').forEach((link) => {
        link.addEventListener('click', (event) => {
            event.stopPropagation();
        });
    });
    const panelTrigger = adminMatrix.querySelector('[data-panel-menu-trigger]');
    if (panelTrigger) {
        panelTrigger.addEventListener('click', (event) => {
            event.stopPropagation();
            if (isPanelMenuOpen) {
                closePanelMenu();
            } else {
                openPanelMenu(event.currentTarget);
            }
        });
    }
}

function toggleCellOptedIn(kidId, categoryKey) {
    if (!editMode || !editState || isExitingEditMode) return;
    if (!editState[kidId]) editState[kidId] = {};
    editState[kidId][categoryKey] = !editState[kidId][categoryKey];
    scheduleKidSave(kidId);
    renderMatrix();
    renderReviewBanner();
    updateStartPracticeHref();
}

// =====================================================================
// === 6. Matrix edit mode + per-kid debounced save
// =====================================================================
function enterEditMode() {
    editMode = true;
    editState = buildEditStateFromKids(currentKids);
    renderMatrix();
}

async function exitEditMode() {
    if (isExitingEditMode) return;
    isExitingEditMode = true;
    try {
        const pendingKidIds = Array.from(pendingSaveTimers.keys());
        pendingKidIds.forEach((kidId) => {
            const handle = pendingSaveTimers.get(kidId);
            if (handle) clearTimeout(handle);
            pendingSaveTimers.delete(kidId);
        });
        await Promise.allSettled(pendingKidIds.map((kidId) => flushKidSave(kidId)));
        if (inFlightSaves.size > 0) {
            await Promise.allSettled(Array.from(inFlightSaves.values()));
        }
        applyEditStateToCurrentKids();
        editMode = false;
        editState = null;
        renderMatrix();
        renderReviewBanner();
        updateStartPracticeHref();
    } finally {
        isExitingEditMode = false;
    }
}

function applyEditStateToCurrentKids() {
    if (!editState) return;
    currentKids = (Array.isArray(currentKids) ? currentKids : []).map((kid) => {
        const kidId = String(kid?.id || '');
        if (!kidId || !editState[kidId]) return kid;
        const stateForKid = editState[kidId];
        const optedInKeys = Object.keys(stateForKid)
            .filter((key) => !!stateForKid[key])
            .sort((a, b) => a.localeCompare(b));
        return { ...kid, optedInDeckCategoryKeys: optedInKeys };
    });
    cacheKidsForParentNavigation(currentKids);
}

function scheduleKidSave(kidId) {
    if (!kidId) return;
    if (pendingSaveTimers.has(kidId)) {
        clearTimeout(pendingSaveTimers.get(kidId));
    }
    const handle = setTimeout(() => {
        pendingSaveTimers.delete(kidId);
        flushKidSave(kidId);
    }, KID_AUTOSAVE_DELAY_MS);
    pendingSaveTimers.set(kidId, handle);
}

async function flushKidSave(kidId) {
    if (inFlightSaves.has(kidId)) {
        try { await inFlightSaves.get(kidId); } catch (_) { /* prior error already surfaced */ }
    }
    if (!editState || !editState[kidId]) return;
    const stateForKid = editState[kidId];
    const optedInKeys = Object.keys(stateForKid)
        .filter((key) => !!stateForKid[key])
        .sort((a, b) => a.localeCompare(b));
    const promise = doKidCategoriesSave(kidId, optedInKeys);
    inFlightSaves.set(kidId, promise);
    savingKids.add(kidId);
    setKidHeaderSavingClass(kidId, true);
    try {
        await promise;
        showError('');
    } catch (error) {
        console.error('Error saving categories for kid', kidId, error);
        showError(error.message || 'Failed to save changes.');
    } finally {
        inFlightSaves.delete(kidId);
        savingKids.delete(kidId);
        setKidHeaderSavingClass(kidId, false);
    }
}

async function doKidCategoriesSave(kidId, optedInKeys) {
    const response = await fetch(`${API_BASE}/kids/${encodeURIComponent(kidId)}/deck-categories`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ categoryKeys: optedInKeys }),
    });
    if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.error || `HTTP ${response.status}`);
    }
}

function setKidHeaderSavingClass(kidId, isSaving) {
    if (!adminMatrix) return;
    const heads = adminMatrix.querySelectorAll('.admin-matrix-kid-head');
    heads.forEach((th) => {
        if (th.getAttribute('data-kid-id') === kidId) {
            th.classList.toggle('is-saving', isSaving);
        }
    });
}


// =====================================================================
// === 7. Per-subject menu
// =====================================================================
function openPanelMenu(anchorEl) {
    isPanelMenuOpen = true;
    closePanelMenuDom();
    if (!anchorEl) return;
    renderPanelMenu(anchorEl);
}

function closePanelMenu() {
    isPanelMenuOpen = false;
    closePanelMenuDom();
}

function closePanelMenuDom() {
    document.querySelectorAll('.admin-panel-menu').forEach((el) => el.remove());
}

function renderPanelMenu(anchorEl) {
    closePanelMenuDom();
    const trigger = anchorEl || document.querySelector('[data-panel-menu-trigger]');
    if (!trigger) return;
    const subjectIconSvg = (typeof window.icon === 'function') ? window.icon('layout-grid', { size: 16 }) : '';
    const menu = document.createElement('div');
    menu.className = 'admin-panel-menu admin-subject-menu';
    menu.innerHTML = `
        <a class="admin-subject-menu-item" href="/deck-category-create.html">
            <span class="admin-subject-menu-item-icon" aria-hidden="true">${subjectIconSvg}</span>
            <span>Manage Subject</span>
        </a>
    `;
    document.body.appendChild(menu);
    const rect = trigger.getBoundingClientRect();
    const menuWidth = 200;
    let left = rect.right + window.scrollX - menuWidth;
    const maxLeft = window.scrollX + document.documentElement.clientWidth - menuWidth - 8;
    if (left > maxLeft) left = maxLeft;
    if (left < 8) left = 8;
    menu.style.left = `${left}px`;
    menu.style.top = `${rect.bottom + window.scrollY + 4}px`;
}

function openSubjectMenu(categoryKey, anchorEl) {
    openSubjectMenuKey = String(categoryKey || '');
    closeSubjectMenuDom();
    if (!openSubjectMenuKey || !anchorEl) return;
    renderSubjectMenu(openSubjectMenuKey, anchorEl);
}

function closeSubjectMenu() {
    openSubjectMenuKey = '';
    closeSubjectMenuDom();
}

function closeSubjectMenuDom() {
    document.querySelectorAll('.admin-subject-menu').forEach((el) => el.remove());
}

function renderSubjectMenu(categoryKey, anchorEl) {
    closeSubjectMenuDom();
    const params = new URLSearchParams();
    if (categoryKey) params.set('categoryKey', categoryKey);
    const query = params.toString();
    const bulkHref = `/deck-create-bulk.html${query ? `?${query}` : ''}`;
    const trigger = anchorEl || document.querySelector(`[data-subject-menu-trigger][data-category-key="${cssEscape(categoryKey)}"]`);
    const chineseBackContent = String(trigger?.dataset?.chineseBackContent || '').trim().toLowerCase();
    const behaviorType = String(trigger?.dataset?.behaviorType || '').trim().toLowerCase();
    const dictionaryMode = chineseBackContent === 'pinyin' || chineseBackContent === 'english' ? chineseBackContent : '';
    const dictionaryItemHtml = dictionaryMode
        ? `<a class="admin-subject-menu-item" href="/chinese-bank.html?mode=${dictionaryMode}">
            <span class="admin-subject-menu-item-icon" aria-hidden="true">${icon('book', { size: 16 })}</span>
            <span>Manage Dictionary</span>
        </a>`
        : '';
    const bulkItemHtml = behaviorType === 'type_iv'
        ? ''
        : `<a class="admin-subject-menu-item" href="${escapeHtml(bulkHref)}">
            <span class="admin-subject-menu-item-icon" aria-hidden="true">${icon('layers', { size: 16 })}</span>
            <span>Bulk add new decks</span>
        </a>`;
    const menu = document.createElement('div');
    menu.className = 'admin-subject-menu';
    menu.innerHTML = `
        ${bulkItemHtml}
        <button type="button" class="admin-subject-menu-item" data-subject-browse data-category-key="${escapeHtml(categoryKey)}">
            <span class="admin-subject-menu-item-icon" aria-hidden="true">${icon('eye', { size: 16 })}</span>
            <span>Browse existing decks</span>
        </button>
        ${dictionaryItemHtml}
    `;
    document.body.appendChild(menu);
    const browseBtn = menu.querySelector('[data-subject-browse]');
    if (browseBtn) {
        browseBtn.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            const key = browseBtn.getAttribute('data-category-key') || '';
            closeSubjectMenu();
            openDeckBrowseModal(key);
        });
    }
    if (trigger) {
        const rect = trigger.getBoundingClientRect();
        const menuWidth = 200;
        let left = rect.left + window.scrollX;
        const maxLeft = window.scrollX + document.documentElement.clientWidth - menuWidth - 8;
        if (left > maxLeft) left = maxLeft;
        if (left < 8) left = 8;
        menu.style.left = `${left}px`;
        menu.style.top = `${rect.bottom + window.scrollY + 4}px`;
    }
}

function cssEscape(value) {
    if (window.CSS && typeof window.CSS.escape === 'function') {
        return window.CSS.escape(String(value || ''));
    }
    return String(value || '').replace(/[^a-zA-Z0-9_-]/g, (ch) => `\\${ch}`);
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
        if (errorMessage) errorMessage.classList.add('hidden');
    }
}

/* ── Browse decks modal (read-only tree view, hooked from subject kebab) ── */

let deckBrowseTreeView = null;
let deckBrowseAllSharedDecks = null;

// =====================================================================
// === 8. Deck browse modal
// =====================================================================
function ensureDeckBrowseTreeView() {
    if (deckBrowseTreeView) return deckBrowseTreeView;
    const container = document.getElementById('deckBrowseContainer');
    const searchInput = document.getElementById('deckBrowseSearchInput');
    const counter = document.getElementById('deckBrowseCounter');
    if (!container) return null;
    deckBrowseTreeView = new window.DeckTreeView({
        container,
        searchInput,
        counter,
        mode: 'browse',
        getDeckSuffix: (deck) => ` · ${Number((deck && deck.card_count) || 0)} cards`,
        onLeafClick: (deck) => {
            const id = Number(deck && deck.deck_id);
            if (!(id > 0)) return;
            window.location.href = `/deck-view.html?deckId=${id}`;
        },
        onBranchEdit: ({ tag, label, depth }) => {
            renameBrowseFolder({ tag, label, depth });
        },
        onBranchNewDeck: ({ path }) => {
            navigateToCreateDeckUnderFolder(path);
        },
    });
    return deckBrowseTreeView;
}

function navigateToCreateDeckUnderFolder(branchPath) {
    if (!currentBrowseCategoryKey) return;
    const params = new URLSearchParams();
    params.set('categoryKey', currentBrowseCategoryKey);
    (Array.isArray(branchPath) ? branchPath : []).forEach((tag) => {
        const trimmed = String(tag || '').trim();
        if (trimmed) params.append('prefixTag', trimmed);
    });
    window.location.href = `/deck-create.html?${params.toString()}`;
}

let currentBrowseCategoryKey = '';

async function renameBrowseFolder({ tag, label, depth }) {
    const tagIndex = Number(depth);
    if (!(tagIndex >= 1)) {
        window.alert('Cannot rename the top-level subject folder here.');
        return;
    }
    const promptLabel = label || tag;
    const newRaw = window.prompt(`Rename folder "${promptLabel}" to:`, promptLabel);
    if (newRaw === null) return;
    const newTag = String(newRaw).trim();
    if (!newTag || newTag === tag) return;
    try {
        const response = await fetch(`${API_BASE}/shared-decks/rename-tag`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ oldTag: tag, newTag, tagIndex }),
        });
        if (!response.ok) {
            const err = await response.json().catch(() => ({}));
            throw new Error(err.error || `Rename failed (HTTP ${response.status})`);
        }
        deckBrowseAllSharedDecks = null;
        if (currentBrowseCategoryKey) {
            await openDeckBrowseModal(currentBrowseCategoryKey);
        }
    } catch (e) {
        window.alert(e.message || 'Rename failed.');
    }
}

async function fetchAllSharedDecks() {
    if (deckBrowseAllSharedDecks) return deckBrowseAllSharedDecks;
    const response = await fetch(`${API_BASE}/shared-decks/mine`);
    if (!response.ok) {
        const result = await response.json().catch(() => ({}));
        throw new Error(result.error || `Failed to load decks (HTTP ${response.status})`);
    }
    const payload = await response.json();
    deckBrowseAllSharedDecks = Array.isArray(payload && payload.decks) ? payload.decks : [];
    return deckBrowseAllSharedDecks;
}

function buildBrowseCardIndex(decksForCategory) {
    const cards = [];
    decksForCategory.forEach((deck) => {
        const deckId = Number(deck.deck_id);
        if (!(deckId > 0)) return;
        const texts = Array.isArray(deck.card_texts) ? deck.card_texts : [];
        texts.forEach((text) => {
            cards.push({
                shared_deck_id: deckId,
                front: String(text || ''),
                back: '',
                is_orphan: false,
            });
        });
    });
    return cards;
}

async function openDeckBrowseModal(categoryKey) {
    const modal = document.getElementById('deckBrowseModal');
    const titleEl = document.getElementById('deckBrowseTitle');
    if (!modal) return;
    if (titleEl) {
        const niceLabel = (function () {
            const row = (currentKids || [])
                .flatMap((kid) => Object.entries(getDeckCategoryMetaMap(kid) || {}))
                .find(([key]) => normalizeCategoryKey(key) === normalizeCategoryKey(categoryKey));
            return row ? (getCategoryDisplayName(row[0], { [row[0]]: row[1] }) || categoryKey) : categoryKey;
        })();
        titleEl.textContent = `Browse — ${niceLabel}`;
    }

    const tv = ensureDeckBrowseTreeView();
    if (!tv) return;
    currentBrowseCategoryKey = categoryKey;
    tv.setCategoryKey(categoryKey);
    tv.setDecks([], { orphanDeck: null });
    tv.setBaseline([], false);
    tv.setSelection([], false);
    tv.resetExpansion();
    tv.clearSearchInput();
    tv.setCardIndex(null);
    tv.render();

    modal.classList.remove('hidden');
    modal.setAttribute('aria-hidden', 'false');

    try {
        const allDecks = await fetchAllSharedDecks();
        const normalizedKey = String(categoryKey || '').trim().toLowerCase();
        const decksForCategory = allDecks.filter((deck) => {
            const tags = Array.isArray(deck && deck.tags) ? deck.tags : [];
            const first = String(tags[0] || '').trim().toLowerCase();
            return first === normalizedKey;
        });
        tv.setDecks(decksForCategory, { orphanDeck: null });
        tv.setCardIndex(buildBrowseCardIndex(decksForCategory));
    } catch (error) {
        console.error('Error loading decks for browse modal:', error);
        showError(error.message || 'Failed to load decks.');
    }
}

function closeDeckBrowseModal() {
    const modal = document.getElementById('deckBrowseModal');
    if (!modal) return;
    if (modal.contains(document.activeElement) && typeof document.activeElement.blur === 'function') {
        document.activeElement.blur();
    }
    modal.classList.add('hidden');
    modal.setAttribute('aria-hidden', 'true');
}

document.addEventListener('DOMContentLoaded', () => {
    const closeBtn = document.getElementById('closeDeckBrowseModalBtn');
    if (closeBtn) closeBtn.addEventListener('click', closeDeckBrowseModal);
    const expandBtn = document.getElementById('deckBrowseExpandAllBtn');
    if (expandBtn) {
        expandBtn.addEventListener('click', () => {
            if (deckBrowseTreeView) deckBrowseTreeView.expandAll();
        });
    }
    const collapseBtn = document.getElementById('deckBrowseCollapseAllBtn');
    if (collapseBtn) {
        collapseBtn.addEventListener('click', () => {
            if (deckBrowseTreeView) deckBrowseTreeView.collapseAll();
        });
    }
    const newDeckBtn = document.getElementById('deckBrowseNewDeckBtn');
    if (newDeckBtn) {
        newDeckBtn.addEventListener('click', () => {
            navigateToCreateDeckUnderFolder([]);
        });
    }
    document.addEventListener('keydown', (event) => {
        if (event.key !== 'Escape') return;
        const m = document.getElementById('deckBrowseModal');
        if (m && !m.classList.contains('hidden')) {
            closeDeckBrowseModal();
        }
    });
});

// =====================================================================
// === 9. Offline mode (selection toolbar, status banner, download flow)
// =====================================================================

function bindOfflineModeEvents() {
    const offlineBtn = document.getElementById('offlineModeBtn');
    if (offlineBtn) {
        offlineBtn.addEventListener('click', () => {
            if (offlineSelectionMode) {
                exitOfflineSelectionMode();
            } else {
                enterOfflineSelectionMode();
            }
        });
    }
    if (adminMatrix) {
        adminMatrix.addEventListener('click', (event) => {
            const toggleBtn = event.target.closest('[data-offline-kid-toggle]');
            if (!toggleBtn) return;
            event.preventDefault();
            event.stopPropagation();
            const kidId = toggleBtn.getAttribute('data-kid-id') || '';
            toggleOfflineKidSelection(kidId);
        });
    }
}

function enterOfflineSelectionMode() {
    if (editMode) exitEditMode();
    offlineSelectionMode = true;
    offlineSelectedKidIds.clear();
    const btn = document.getElementById('offlineModeBtn');
    if (btn) btn.classList.add('is-active');
    renderAll();
}

function exitOfflineSelectionMode() {
    offlineSelectionMode = false;
    offlineSelectedKidIds.clear();
    const btn = document.getElementById('offlineModeBtn');
    if (btn) btn.classList.remove('is-active');
    renderAll();
}

function toggleOfflineKidSelection(kidId) {
    if (!offlineSelectionMode) return;
    const id = String(kidId || '').trim();
    if (!id) return;
    const kid = currentKids.find((k) => String(k?.id || '') === id);
    if (!kid || kid.offlineLock) return;
    if (offlineSelectedKidIds.has(id)) {
        offlineSelectedKidIds.delete(id);
    } else {
        offlineSelectedKidIds.add(id);
    }
    renderMatrix();
    renderOfflineActionFooter();
}

function renderOfflineActionFooter() {
    const footer = document.getElementById('offlineActionFooter');
    if (!footer) return;
    if (!offlineSelectionMode) {
        footer.classList.add('hidden');
        footer.innerHTML = '';
        return;
    }
    const count = offlineSelectedKidIds.size;
    const downloadDisabled = count === 0;
    const downloadLabel = count === 0 ? 'Download' : `Download ${count} kid${count === 1 ? '' : 's'}`;
    footer.classList.remove('hidden');
    footer.innerHTML = `
        <button type="button" class="offline-action-footer-btn offline-action-footer-btn--cancel" data-offline-cancel>Cancel</button>
        <button type="button" class="offline-action-footer-btn offline-action-footer-btn--download" data-offline-download ${downloadDisabled ? 'disabled' : ''}>
            ${(typeof window.icon === 'function') ? window.icon('download', { size: 18 }) : ''}
            <span data-offline-download-label>${downloadLabel}</span>
        </button>
    `;
    const cancelBtnEl = footer.querySelector('[data-offline-cancel]');
    if (cancelBtnEl) cancelBtnEl.addEventListener('click', exitOfflineSelectionMode);
    const downloadBtnEl = footer.querySelector('[data-offline-download]');
    if (downloadBtnEl) downloadBtnEl.addEventListener('click', downloadSelectedOffline);
}

async function downloadSelectedOffline() {
    if (!offlineSelectionMode || offlineSelectedKidIds.size === 0) return;
    const ids = Array.from(offlineSelectedKidIds);
    const footer = document.getElementById('offlineActionFooter');
    const downloadBtn = footer ? footer.querySelector('[data-offline-download]') : null;
    const cancelBtn = footer ? footer.querySelector('[data-offline-cancel]') : null;

    // Per-kid progress counters; reset on each kid's `subjects_known` event.
    let currentKidName = '';
    let totalSubjects = 0;
    let completedSubjects = 0;
    let totalAudio = 0;
    let completedAudio = 0;
    let inAudioPhase = false;
    const setLabel = (text) => {
        if (!downloadBtn) return;
        const labelEl = downloadBtn.querySelector('[data-offline-download-label]');
        if (labelEl) labelEl.textContent = text;
    };
    const refreshLabel = () => {
        const prefix = currentKidName ? `${currentKidName} · ` : '';
        if (inAudioPhase && totalAudio > 0 && completedAudio < totalAudio) {
            setLabel(`${prefix}Audio ${completedAudio}/${totalAudio}…`);
            return;
        }
        if (totalSubjects === 0) {
            setLabel(`${prefix}Preparing…`);
        } else if (completedSubjects < totalSubjects) {
            setLabel(`${prefix}Subject ${completedSubjects + 1}/${totalSubjects}…`);
        } else if (inAudioPhase && totalAudio === 0) {
            setLabel(`${prefix}Finishing…`);
        } else {
            setLabel(`${prefix}Done ${completedSubjects}/${totalSubjects}`);
        }
    };

    if (downloadBtn) {
        downloadBtn.disabled = true;
        downloadBtn.classList.add('is-busy');
    }
    if (cancelBtn) cancelBtn.disabled = true;
    setLabel('Preparing…');

    const onProgress = (info) => {
        if (!info) return;
        if (info.kidName) currentKidName = String(info.kidName);
        if (info.phase === 'subjects_known') {
            totalSubjects = Number(info.subjectCount || 0);
            completedSubjects = 0;
            totalAudio = 0;
            completedAudio = 0;
            inAudioPhase = false;
        } else if (info.phase === 'subject_done') {
            completedSubjects += 1;
        } else if (info.phase === 'audio_start') {
            inAudioPhase = true;
            totalAudio = Number(info.audioCount || 0);
            completedAudio = 0;
        } else if (info.phase === 'audio_progress') {
            completedAudio = Number(info.completed || 0);
            totalAudio = Number(info.total || totalAudio);
        } else if (info.phase === 'audio_done') {
            completedAudio = totalAudio;
            inAudioPhase = false;
        }
        refreshLabel();
    };

    const results = [];
    for (const kidId of ids) {
        try {
            const res = await window.OfflineCommon.acquirePack(kidId, {
                deviceLabel: window.OfflineCommon.parseDeviceLabel(),
                onProgress,
            });
            results.push({ kidId, res });
            if (!res.ok && res.inflight) {
                const proceed = window.confirm('This child has unfinished practice in progress. Discard and continue offline?');
                if (proceed) {
                    const retry = await window.OfflineCommon.acquirePack(kidId, {
                        deviceLabel: window.OfflineCommon.parseDeviceLabel(),
                        forceDiscardInflight: true,
                        onProgress,
                    });
                    results[results.length - 1] = { kidId, res: retry };
                }
            }
        } catch (e) {
            results.push({ kidId, res: { ok: false, error: String(e) } });
        }
    }

    const firstSuccess = results.find((r) => r.res && r.res.ok);
    const failures = results.filter((r) => !(r.res && r.res.ok));
    if (failures.length > 0) {
        const msgs = failures.map((f) => {
            if (f.res && f.res.conflict) return `Kid ${f.kidId}: already offline on another device.`;
            if (f.res && f.res.inflight) return `Kid ${f.kidId}: unfinished session in progress.`;
            return `Kid ${f.kidId}: ${(f.res && f.res.error) || 'unknown error'}`;
        }).join('\n');
        alert(`Some kids could not be taken offline:\n${msgs}`);
    }

    if (firstSuccess) {
        const kidId = firstSuccess.kidId;
        setLabel('Done');
        window.location.href = `/kid-practice-home.html?id=${encodeURIComponent(kidId)}`;
        return;
    }
    if (downloadBtn) {
        downloadBtn.disabled = false;
        downloadBtn.classList.remove('is-busy');
    }
    if (cancelBtn) cancelBtn.disabled = false;
    exitOfflineSelectionMode();
    loadKids({ preferNavigationCache: false });
}

async function refreshOfflineOwnedAndStats() {
    const lockedKids = (currentKids || []).filter((k) => k && k.offlineLock);
    if (lockedKids.length === 0) {
        if (offlineOwnedKidIds.size > 0) {
            offlineOwnedKidIds = new Set();
            renderMatrix();
        }
        return;
    }
    const ownedKidIds = window.OfflineStorage
        ? await window.OfflineStorage.listOwnedKidIds()
        : [];
    offlineOwnedKidIds = new Set(ownedKidIds.map(String));
    // Back-fill: any locked kid whose pack lives here but whose lock JSON
    // doesn't yet carry the size/count fields (older acquires) gets reported
    // now. Idempotent — server overwrites with the same values on repeats.
    let mutated = false;
    if (window.OfflineStorage && typeof window.OfflineStorage.getPackStats === 'function') {
        const needsReport = lockedKids.filter((kid) => {
            if (!offlineOwnedKidIds.has(String(kid.id))) return false;
            const lk = kid.offlineLock || {};
            return !(Number(lk.pack_total_bytes) > 0) || !(Number(lk.pack_total_file_count) > 0);
        });
        if (needsReport.length > 0) {
            await Promise.all(needsReport.map(async (kid) => {
                try {
                    const stats = await window.OfflineStorage.getPackStats(String(kid.id));
                    if (!stats || !stats.hasPack) return;
                    const lk = kid.offlineLock || {};
                    const res = await fetch(`/api/kids/${encodeURIComponent(String(kid.id))}/offline/report-pack-stats`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            packId: lk.pack_id,
                            totalBytes: stats.totalBytes,
                            totalFileCount: stats.totalFileCount,
                            audioFileCount: stats.audioFileCount,
                        }),
                    });
                    if (res.ok) {
                        const payload = await res.json().catch(() => ({}));
                        if (payload && payload.lock) {
                            kid.offlineLock = { ...lk, ...payload.lock };
                            mutated = true;
                        }
                    }
                } catch (_) { /* best-effort */ }
            }));
        }
    }
    renderMatrix();
    if (mutated) renderMatrix();
}

