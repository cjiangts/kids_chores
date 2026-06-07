/*
 * admin.js — family home page (admin.html).
 *
 * Renders the deck-category opt-in matrix with a per-kid daily-progress
 * ring, the "start practice" jump button, edit-mode delete overlay, and
 * the deck-browse modal.
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
 *     4. Review helpers
 *     5. Opt-in matrix render
 *     6. Matrix edit mode + per-kid debounced save
 *     7. Per-subject menu
 *     8. Deck browse modal
 */

// API Configuration
const API_BASE = `${window.location.origin}/api`;

// DOM Elements
const adminOptinPanel = document.getElementById('adminOptinPanel');
const adminMatrix = document.getElementById('adminMatrix');
const adminKidTabs = document.getElementById('adminKidTabs');
const adminOffAppPanel = document.getElementById('adminOffAppPanel');
const adminOffAppList = document.getElementById('adminOffAppList');
const pullTodaySessionsAdminBtn = document.getElementById('pullTodaySessionsAdminBtn');
const adminEmptyState = document.getElementById('adminEmptyState');
const getEditToggleBtn = () => document.getElementById('editToggleBtn');
const errorMessage = document.getElementById('errorMessage');

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

let currentKids = [];
let kidsLoaded = false;
let selectedAdminKidId = '';
let adminCategoryMetaByKey = {};
let currentFamilyId = '';
let editMode = false;
let editState = null;
let isExitingEditMode = false;
const pendingSaveTimers = new Map();
const inFlightSaves = new Map();
const savingKids = new Set();
const KID_AUTOSAVE_DELAY_MS = 450;
let openSubjectMenuKey = '';
let isSuperFamily = false;
let offAppReviewPendingByKidId = new Map();
let typeIIIReviewPendingByKidId = new Map();
const adminOffAppByKidId = new Map();
const adminOffAppLoadingKidIds = new Set();
const adminOffAppDraftByKey = new Map();
const adminOffAppSavingKeys = new Set();
const adminOffAppEditingKeys = new Set();
let pullTodaySessionsAdminTimer = 0;

// =====================================================================
// === 1. DOM refs + auth + DOMContentLoaded
// =====================================================================
document.addEventListener('DOMContentLoaded', () => {
    if (typeof window.hydrateIcons === 'function') {
        window.hydrateIcons(document);
    }
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
    if (pullTodaySessionsAdminBtn) {
        pullTodaySessionsAdminBtn.addEventListener('click', () => {
            void pullTodaySessionsForSelectedAdminKid();
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
    });
    if (adminOffAppPanel) {
        adminOffAppPanel.addEventListener('click', handleAdminOffAppClick);
        adminOffAppPanel.addEventListener('input', handleAdminOffAppInput);
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
        adminCategoryMetaByKey = (parsed?.categoryMetaByKey && typeof parsed.categoryMetaByKey === 'object')
            ? parsed.categoryMetaByKey
            : {};
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
            categoryMetaByKey: adminCategoryMetaByKey,
            kids: list,
        }));
    } catch (error) {
        // ignore
    }
}

function buildCategoryMetaByKey(categories) {
    const output = {};
    (Array.isArray(categories) ? categories : []).forEach((category) => {
        const key = normalizeCategoryKey(category?.category_key);
        if (!key) return;
        output[key] = {
            behavior_type: normalizeBehaviorType(category?.behavior_type),
            has_chinese_specific_logic: Boolean(category?.has_chinese_specific_logic),
            is_shared_with_non_super_family: Boolean(category?.is_shared_with_non_super_family),
            display_name: String(category?.display_name || '').trim(),
            chinese_back_content: String(category?.chinese_back_content || '').trim().toLowerCase(),
        };
    });
    return output;
}

function getAdminDeckCategoryMetaMap(kid) {
    const fromKid = getDeckCategoryMetaMap(kid);
    return Object.keys(fromKid).length > 0 ? fromKid : adminCategoryMetaByKey;
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
        const [kidsResponse, categoriesResponse] = await Promise.all([
            fetch(`${API_BASE}/kids?view=admin_compact`),
            fetch(`${API_BASE}/shared-decks/categories`),
        ]);
        if (!kidsResponse.ok) {
            throw new Error(`HTTP error! status: ${kidsResponse.status}`);
        }
        if (!categoriesResponse.ok) {
            throw new Error(`HTTP error! status: ${categoriesResponse.status}`);
        }
        const kids = await kidsResponse.json();
        const categoryData = await categoriesResponse.json().catch(() => ({}));
        adminCategoryMetaByKey = buildCategoryMetaByKey(categoryData.categories);
        currentKids = Array.isArray(kids) ? kids : [];
        kidsLoaded = true;
        cacheKidsForParentNavigation(currentKids);
        offAppReviewPendingByKidId = new Map();
        typeIIIReviewPendingByKidId = new Map();
        renderAll();
        Promise.allSettled([
            loadOffAppReviewPending(),
            loadTypeIIIReviewPending(),
        ]).then(() => {
            renderReviewBanner();
        });
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

function setAdminPullTodayButton(label = 'Pull latest in-app scores', { busy = false } = {}) {
    if (!pullTodaySessionsAdminBtn) return;
    const hasSelectedKid = Boolean(
        selectedAdminKidId
        && (Array.isArray(currentKids) ? currentKids : []).some((kid) => String(kid?.id || '') === selectedAdminKidId),
    );
    pullTodaySessionsAdminBtn.disabled = busy || !hasSelectedKid;
    pullTodaySessionsAdminBtn.setAttribute('aria-label', label);
    pullTodaySessionsAdminBtn.title = label;
    pullTodaySessionsAdminBtn.innerHTML = (typeof window.icon === 'function')
        ? window.icon('refresh-cw', { size: 17 })
        : '<span class="icon" data-icon="refresh-cw" data-icon-size="17"></span>';
}

async function pullTodaySessionsForSelectedAdminKid() {
    const kidId = String(selectedAdminKidId || '').trim();
    if (!kidId) return;
    if (pullTodaySessionsAdminTimer) {
        clearTimeout(pullTodaySessionsAdminTimer);
        pullTodaySessionsAdminTimer = 0;
    }
    setAdminPullTodayButton('Pulling latest in-app scores', { busy: true });
    showError('');
    try {
        const response = await fetch(`${API_BASE}/kids/${encodeURIComponent(kidId)}/points/pull-today-sessions`, {
            method: 'POST',
        });
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        const result = await response.json().catch(() => ({}));
        await loadKids();
        const count = Number.parseInt(result.awardedCount, 10) || 0;
        setAdminPullTodayButton(count > 0 ? `Added ${count}` : 'Up to date');
        pullTodaySessionsAdminTimer = setTimeout(() => {
            setAdminPullTodayButton();
            pullTodaySessionsAdminTimer = 0;
        }, 1400);
    } catch (error) {
        showError(error.message || 'Failed to pull latest in-app scores.');
        setAdminPullTodayButton();
    }
}

async function loadOffAppReviewPending() {
    const list = Array.isArray(currentKids) ? currentKids : [];
    if (!list.length) {
        offAppReviewPendingByKidId = new Map();
        return;
    }
    try {
        const response = await fetch(`${API_BASE}/kids/off-app-chores/pending-summary`);
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }
        const payload = await response.json().catch(() => ({}));
        const rows = Array.isArray(payload?.kids) ? payload.kids : [];
        offAppReviewPendingByKidId = new Map(rows
            .map((row) => {
                const kidId = String(row?.kidId || '').trim();
                const pendingCount = Number.parseInt(row?.pendingCount, 10);
                if (!kidId) return null;
                return [kidId, Number.isInteger(pendingCount) && pendingCount > 0 ? pendingCount : 0];
            })
            .filter(Boolean));
    } catch (error) {
        offAppReviewPendingByKidId = new Map();
    }
}

async function loadTypeIIIReviewPending() {
    const list = Array.isArray(currentKids) ? currentKids : [];
    if (!list.length) {
        typeIIIReviewPendingByKidId = new Map();
        return;
    }
    try {
        const response = await fetch(`${API_BASE}/kids/type-iii/pending-summary`);
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }
        const payload = await response.json().catch(() => ({}));
        const rows = Array.isArray(payload?.kids) ? payload.kids : [];
        typeIIIReviewPendingByKidId = new Map(rows
            .map((row) => {
                const kidId = String(row?.kidId || '').trim();
                const pendingCount = Number.parseInt(row?.pendingCount, 10);
                if (!kidId) return null;
                return [kidId, Number.isInteger(pendingCount) && pendingCount > 0 ? pendingCount : 0];
            })
            .filter(Boolean));
    } catch (error) {
        typeIIIReviewPendingByKidId = new Map();
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
        const meta = getAdminDeckCategoryMetaMap(kid);
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
        const meta = getAdminDeckCategoryMetaMap(kid);
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
    if (window.KidAppNavigation) {
        if (selectedAdminKidId && typeof window.KidAppNavigation.setKidId === 'function') {
            window.KidAppNavigation.setKidId(selectedAdminKidId);
        } else {
            window.KidAppNavigation.setKids(currentKids);
        }
    }
}

// =====================================================================
// === 4. Review helpers
// =====================================================================
function renderReviewBanner() {
    // Review shortcuts are intentionally hidden on the redesigned admin home.
}

function pickKidWithReviewAudio(kids) {
    const list = Array.isArray(kids) ? kids : [];
    const hasPending = (kidId) => {
        const pendingCount = Number.parseInt(typeIIIReviewPendingByKidId.get(String(kidId || '')), 10);
        return Number.isInteger(pendingCount) && pendingCount > 0;
    };
    const lastId = readLastViewedKidId();
    if (lastId && hasPending(lastId)) {
        return list.find((kid) => String(kid?.id || '') === lastId) || null;
    }
    for (let i = list.length - 1; i >= 0; i--) {
        const kid = list[i];
        if (hasPending(kid?.id)) {
            return kid;
        }
    }
    return null;
}

function pickKidWithOffAppReview(kids) {
    const list = Array.isArray(kids) ? kids : [];
    const hasPending = (kidId) => {
        const pendingCount = Number.parseInt(offAppReviewPendingByKidId.get(String(kidId || '')), 10);
        return Number.isInteger(pendingCount) && pendingCount > 0;
    };
    const lastId = readLastViewedKidId();
    if (lastId && hasPending(lastId)) {
        return list.find((kid) => String(kid?.id || '') === lastId) || null;
    }
    for (let i = list.length - 1; i >= 0; i--) {
        const kid = list[i];
        if (hasPending(kid?.id)) {
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
        renderAdminKidTabs(list);
        renderAdminOffAppSection(list);
        setAdminPullTodayButton();
        if (kidsLoaded) adminEmptyState.classList.remove('hidden');
        else adminEmptyState.classList.add('hidden');
        return;
    }
    adminEmptyState.classList.add('hidden');
    adminOptinPanel.classList.remove('hidden');
    ensureSelectedAdminKidId(list);
    setAdminPullTodayButton();
    renderAdminKidTabs(list);

    const rows = getCategoryRowsForFamily(list);
    if (rows.length === 0) {
        adminMatrix.innerHTML = `<tbody><tr><td class="admin-empty-state">No subjects available.</td></tr></tbody>`;
        renderAdminOffAppSection(list);
        const eb = getEditToggleBtn();
        if (eb) eb.disabled = true;
        return;
    }
    adminOptinPanel.classList.toggle('is-editing', editMode);
    adminMatrix.classList.toggle('is-editable', editMode);

    const matrixKids = getSelectedAdminKids(list);
    const showTodayStatusColumn = matrixKids.length === 1;
    const headerHtml = `
        <thead>
            <tr>
                <th class="admin-matrix-subject-head"><span class="admin-chore-group-title"><span class="admin-chore-group-title-icon" aria-hidden="true">${(typeof window.icon === 'function') ? window.icon('smartphone', { size: 16, strokeWidth: 2 }) : ''}</span>In-App Chores</span></th>
                ${matrixKids.map((kid) => buildKidColumnHeader(kid)).join('')}
                ${showTodayStatusColumn ? buildTodayColumnHeader(matrixKids[0]) : ''}
            </tr>
        </thead>
    `;
    const bodyHtml = `
        <tbody>
            ${rows.map((row) => buildMatrixRow(row, matrixKids, { showTodayStatusColumn })).join('')}
        </tbody>
    `;
    adminMatrix.innerHTML = headerHtml + bodyHtml;
    if (typeof window.hydrateIcons === 'function') {
        window.hydrateIcons(adminMatrix);
    }
    renderAdminOffAppSection(list);

    bindMatrixInteractions(rows, matrixKids);
    if (openSubjectMenuKey) {
        renderSubjectMenu(openSubjectMenuKey);
    }
}

function renderAdminKidTabs(kids) {
    if (!adminKidTabs) return;
    if (window.KidAppNavigation && typeof window.KidAppNavigation.renderKidSelector === 'function') {
        window.KidAppNavigation.renderKidSelector(adminKidTabs, kids, {
            selectedKidId: selectedAdminKidId,
            onSelect: (kidId) => {
                selectedAdminKidId = kidId;
                persistLastViewedKidId(kidId);
                renderMatrix();
            },
        });
        return;
    }
    adminKidTabs.innerHTML = '';
    adminKidTabs.classList.add('hidden');
}

function ensureSelectedAdminKidId(kids) {
    const list = Array.isArray(kids) ? kids : [];
    if (selectedAdminKidId && list.some((kid) => String(kid?.id || '') === selectedAdminKidId)) {
        return;
    }
    const lastId = readLastViewedKidId();
    const fallback = list.find((kid) => String(kid?.id || '') === lastId) || list[0];
    selectedAdminKidId = String(fallback?.id || '');
}

function getSelectedAdminKids(kids) {
    const list = Array.isArray(kids) ? kids : [];
    const selected = list.find((kid) => String(kid?.id || '') === selectedAdminKidId);
    return selected ? [selected] : list.slice(0, 1);
}

function normalizeAdminOffAppChorePayload(payload) {
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

async function loadAdminOffAppChores(kidId) {
    const normalizedKidId = String(kidId || '').trim();
    if (!normalizedKidId || adminOffAppLoadingKidIds.has(normalizedKidId)) return;
    adminOffAppLoadingKidIds.add(normalizedKidId);
    try {
        const response = await fetch(`${API_BASE}/kids/${encodeURIComponent(normalizedKidId)}/off-app-chores`);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const normalized = normalizeAdminOffAppChorePayload(await response.json());
        adminOffAppByKidId.set(normalizedKidId, {
            chores: normalized.chores,
            pendingByRuleId: normalized.pendingByRuleId,
            error: '',
        });
    } catch (error) {
        adminOffAppByKidId.set(normalizedKidId, {
            chores: [],
            pendingByRuleId: new Map(),
            error: 'Failed to load off-app chores.',
        });
    } finally {
        adminOffAppLoadingKidIds.delete(normalizedKidId);
        renderMatrix();
    }
}

function renderAdminOffAppIcon(chore) {
    const emoji = String(chore?.emoji || '').trim();
    if (emoji) {
        return `<span class="admin-off-app-emoji" aria-hidden="true">${escapeHtml(emoji)}</span>`;
    }
    return (typeof window.icon === 'function') ? window.icon('clipboard-check', { size: 21 }) : '';
}

function adminOffAppMaxPoint(chore, reviewItem) {
    const rule = (reviewItem?.rule && typeof reviewItem.rule === 'object') ? reviewItem.rule : chore;
    const maxPoint = Number.parseInt(rule?.maxPoint, 10);
    return Number.isInteger(maxPoint) && maxPoint > 0 ? maxPoint : 1;
}

function clampAdminOffAppPoints(value, maxPoint) {
    const parsed = Number.parseInt(value, 10);
    const safeMax = Math.max(1, Number.parseInt(maxPoint, 10) || 1);
    const safeValue = Number.isInteger(parsed) ? parsed : 1;
    return Math.min(safeMax, Math.max(1, safeValue));
}

function adminOffAppReviewKey(reviewKind, id) {
    const normalizedKind = reviewKind === 'event'
        ? 'event'
        : (reviewKind === 'direct' ? 'direct' : 'pending');
    const normalizedId = Number.parseInt(id, 10);
    return Number.isInteger(normalizedId) && normalizedId > 0 ? `${normalizedKind}:${normalizedId}` : '';
}

function getAdminOffAppDraft(reviewKind, reviewItem, chore) {
    const key = adminOffAppReviewKey(
        reviewKind,
        reviewKind === 'event'
            ? reviewItem?.eventId
            : (reviewKind === 'direct' ? chore?.ruleId : reviewItem?.pendingId),
    );
    if (key && adminOffAppDraftByKey.has(key)) {
        return adminOffAppDraftByKey.get(key);
    }
    const maxPoint = adminOffAppMaxPoint(chore, reviewItem);
    const eventPoints = Number.parseInt(reviewItem?.pointsDelta, 10);
    const initialPoints = clampAdminOffAppPoints(
        Number.isInteger(eventPoints) ? eventPoints : maxPoint,
        maxPoint,
    );
    const initialNote = String(reviewItem?.note || '');
    const draft = {
        pointsDelta: initialPoints,
        note: initialNote,
        initialPointsDelta: initialPoints,
        initialNote,
        maxPoint,
        isNewReview: reviewKind !== 'event',
    };
    if (key) adminOffAppDraftByKey.set(key, draft);
    return draft;
}

function setAdminOffAppDraftValue(reviewKey, patch) {
    const key = String(reviewKey || '');
    if (!key) return null;
    const previous = adminOffAppDraftByKey.get(key) || { pointsDelta: 0, note: '' };
    const next = { ...previous, ...(patch || {}) };
    if (Object.prototype.hasOwnProperty.call(patch || {}, 'pointsDelta')) {
        next.pointsDelta = clampAdminOffAppPoints(next.pointsDelta, next.maxPoint);
    }
    adminOffAppDraftByKey.set(key, next);
    return next;
}

function isAdminOffAppDraftDirty(draft) {
    if (!draft) return false;
    if (draft.isNewReview) return true;
    const currentPoints = Number.parseInt(draft.pointsDelta, 10);
    const initialPoints = Number.parseInt(draft.initialPointsDelta, 10);
    return currentPoints !== initialPoints || String(draft.note || '') !== String(draft.initialNote || '');
}

function buildAdminOffAppSaveButtonContent() {
    const iconHtml = (typeof window.icon === 'function') ? window.icon('check', { size: 15, strokeWidth: 2.7 }) : '';
    return `${iconHtml}<span>Save</span>`;
}

function buildAdminOffAppCancelButtonContent() {
    const iconHtml = (typeof window.icon === 'function') ? window.icon('x', { size: 15, strokeWidth: 2.7 }) : '';
    return `${iconHtml}<span>Cancel</span>`;
}

function updateAdminOffAppSaveButtonState(reviewKey) {
    const key = String(reviewKey || '');
    if (!key || !adminOffAppPanel) return;
    const draft = adminOffAppDraftByKey.get(key);
    const button = adminOffAppPanel.querySelector(`[data-off-app-grade-submit][data-review-key="${key}"]`);
    if (!button) return;
    const isSaving = adminOffAppSavingKeys.has(key);
    const isDirty = isAdminOffAppDraftDirty(draft);
    button.disabled = isSaving || !isDirty;
    button.setAttribute('aria-label', 'Save off-app chore grade');
    button.innerHTML = buildAdminOffAppSaveButtonContent();
}

function buildAdminOffAppGradeFormHtml(chore, reviewKind, reviewItem) {
    const id = reviewKind === 'event'
        ? Number.parseInt(reviewItem?.eventId, 10)
        : (reviewKind === 'direct'
            ? Number.parseInt(chore?.ruleId, 10)
            : Number.parseInt(reviewItem?.pendingId, 10));
    const reviewKey = adminOffAppReviewKey(reviewKind, id);
    if (!reviewKey) {
        return '<span class="admin-off-app-status admin-off-app-status--pending">Reviewing</span>';
    }
    const draft = getAdminOffAppDraft(reviewKind, reviewItem, chore);
    const note = String(draft?.note || '');
    const isSaving = adminOffAppSavingKeys.has(reviewKey);
    const isDirty = isAdminOffAppDraftDirty(draft);
    return `
        <div class="admin-off-app-grade" data-off-app-review-key="${escapeHtml(reviewKey)}" data-off-app-review-kind="${escapeHtml(reviewKind)}">
            <input class="admin-off-app-note-input" type="text" value="${escapeHtml(note)}" placeholder="Note" data-off-app-note-input data-review-key="${escapeHtml(reviewKey)}" aria-label="Note for ${escapeHtml(String(chore?.name || 'task'))}"${isSaving ? ' disabled' : ''}>
            <span class="admin-off-app-grade-actions">
                <button type="button" class="admin-off-app-grade-btn" data-off-app-grade-submit data-review-key="${escapeHtml(reviewKey)}" data-review-kind="${escapeHtml(reviewKind)}" aria-label="Save off-app chore grade"${(isSaving || !isDirty) ? ' disabled' : ''}>
                    ${buildAdminOffAppSaveButtonContent()}
                </button>
                <button type="button" class="admin-off-app-grade-btn admin-off-app-grade-btn--cancel" data-off-app-grade-cancel data-review-key="${escapeHtml(reviewKey)}" aria-label="Cancel editing off-app chore grade"${isSaving ? ' disabled' : ''}>
                    ${buildAdminOffAppCancelButtonContent()}
                </button>
            </span>
        </div>
    `;
}

function buildAdminOffAppPointStepperHtml(chore, reviewKind, reviewItem) {
    const id = reviewKind === 'event'
        ? Number.parseInt(reviewItem?.eventId, 10)
        : (reviewKind === 'direct'
            ? Number.parseInt(chore?.ruleId, 10)
            : Number.parseInt(reviewItem?.pendingId, 10));
    const reviewKey = adminOffAppReviewKey(reviewKind, id);
    if (!reviewKey) return '';
    const draft = getAdminOffAppDraft(reviewKind, reviewItem, chore);
    const points = Number.parseInt(draft?.pointsDelta, 10);
    const maxPoint = Number.parseInt(draft?.maxPoint, 10) || adminOffAppMaxPoint(chore, reviewItem);
    const isSaving = adminOffAppSavingKeys.has(reviewKey);
    const safePoints = clampAdminOffAppPoints(points, maxPoint);
    return `
        <div class="admin-off-app-point-stepper" aria-label="Points" data-off-app-review-key="${escapeHtml(reviewKey)}">
            <button type="button" class="admin-off-app-step-btn" data-off-app-point-step="-1" data-review-key="${escapeHtml(reviewKey)}" data-max-point="${maxPoint}" aria-label="Decrease points"${(isSaving || safePoints <= 1) ? ' disabled' : ''}>-</button>
            <input class="admin-off-app-points-input" type="number" inputmode="numeric" min="1" max="${maxPoint}" value="${safePoints}" data-off-app-points-input data-review-key="${escapeHtml(reviewKey)}" data-max-point="${maxPoint}" aria-label="Points for ${escapeHtml(String(chore?.name || 'task'))}"${isSaving ? ' disabled' : ''}>
            <button type="button" class="admin-off-app-step-btn" data-off-app-point-step="1" data-review-key="${escapeHtml(reviewKey)}" data-max-point="${maxPoint}" aria-label="Increase points"${(isSaving || safePoints >= maxPoint) ? ' disabled' : ''}>+</button>
        </div>
    `;
}

function formatAdminOffAppPillPoints(points) {
    const value = Number.parseInt(points, 10);
    return Number.isInteger(value) ? String(value) : '0';
}

function buildAdminOffAppResultPillHtml(chore, reviewKind, reviewItem) {
    const id = reviewKind === 'event'
        ? Number.parseInt(reviewItem?.eventId, 10)
        : Number.parseInt(reviewItem?.pendingId, 10);
    const reviewKey = adminOffAppReviewKey(reviewKind, id);
    if (!reviewKey) {
        return '<span class="admin-off-app-status admin-off-app-status--pending">Reviewing</span>';
    }
    const draft = getAdminOffAppDraft(reviewKind, reviewItem, chore);
    const points = formatAdminOffAppPillPoints(draft?.pointsDelta);
    const isSaving = adminOffAppSavingKeys.has(reviewKey);
    const checkHtml = (typeof window.icon === 'function') ? window.icon('check', { size: 15, strokeWidth: 2.8 }) : '';
    const reviewHtml = (typeof window.icon === 'function') ? window.icon('clipboard-check', { size: 15, strokeWidth: 2.5 }) : '';
    const editHtml = (typeof window.icon === 'function') ? window.icon('pencil', { size: 13, strokeWidth: 2.5 }) : '';
    const taskName = String(chore?.name || 'task');
    const isPendingReview = reviewKind === 'pending';
    const mainContent = isPendingReview
        ? `${reviewHtml}<span>Review</span>`
        : `${checkHtml}<span>${escapeHtml(points)}</span>`;
    return `
        <button type="button" class="admin-off-app-result-pill${isPendingReview ? ' is-review' : ' is-credited'}${isSaving ? ' is-saving' : ''}" data-off-app-edit data-review-key="${escapeHtml(reviewKey)}" aria-label="${isPendingReview ? `Review ${escapeHtml(taskName)}` : `Edit ${escapeHtml(points)} points for ${escapeHtml(taskName)}`}"${isSaving ? ' disabled' : ''}>
            <span class="admin-off-app-result-pill-main">${mainContent}</span>
            <span class="admin-off-app-result-pill-edit" aria-hidden="true">
                ${editHtml}
            </span>
        </button>
    `;
}

function buildAdminOffAppNotePreviewHtml(reviewKind, reviewItem, chore) {
    const draft = getAdminOffAppDraft(reviewKind, reviewItem, chore);
    const note = String(draft?.note || '').trim();
    if (!note) return '';
    return `<span class="admin-off-app-note-preview">${escapeHtml(note)}</span>`;
}

function buildAdminOffAppStatusHtml(chore, pending, kidId, directReviewKey = '') {
    const creditedEvent = chore?.creditedEvent && typeof chore.creditedEvent === 'object'
        ? chore.creditedEvent
        : null;
    if (chore?.creditedToday || creditedEvent) {
        return buildAdminOffAppGradeFormHtml(chore, 'event', creditedEvent || chore?.creditedEvent);
    }
    if (pending) {
        return buildAdminOffAppGradeFormHtml(chore, 'pending', pending);
    }
    const readyHtml = (typeof window.icon === 'function') ? window.icon('play', { size: 15, strokeWidth: 2.8 }) : '';
    const editHtml = (typeof window.icon === 'function') ? window.icon('pencil', { size: 13, strokeWidth: 2.5 }) : '';
    return `
        <button type="button" class="admin-off-app-status admin-off-app-status--ready" data-off-app-edit data-review-key="${escapeHtml(directReviewKey)}" aria-label="Log result for ${escapeHtml(String(chore?.name || 'task'))}">
            <span class="admin-off-app-status-main">${readyHtml}<span>Not Started</span></span>
            <span class="admin-off-app-status-edit" aria-hidden="true">${editHtml}</span>
        </button>
    `;
}

function buildAdminOffAppRow(chore, state, kidId) {
    const ruleId = Number.parseInt(chore?.ruleId, 10);
    if (!Number.isInteger(ruleId) || ruleId <= 0) return '';
    const name = String(chore?.name || '').trim() || 'Task';
    const pending = state.pendingByRuleId.get(ruleId) || null;
    const creditedEvent = chore?.creditedEvent && typeof chore.creditedEvent === 'object' ? chore.creditedEvent : null;
    const reviewKind = pending ? 'pending' : (chore?.creditedToday || creditedEvent ? 'event' : 'direct');
    const reviewItem = pending || creditedEvent || chore;
    const isReviewable = Boolean(reviewKind && reviewItem);
    const reviewId = reviewKind === 'event'
        ? Number.parseInt(reviewItem?.eventId, 10)
        : (reviewKind === 'direct'
            ? ruleId
            : Number.parseInt(reviewItem?.pendingId, 10));
    const reviewKey = isReviewable ? adminOffAppReviewKey(reviewKind, reviewId) : '';
    const isEditing = Boolean(reviewKey && adminOffAppEditingKeys.has(reviewKey));
    return `
        <div class="admin-off-app-row${isReviewable ? ' is-reviewable' : ''}${isEditing ? ' is-editing' : ''}" data-off-app-rule-id="${ruleId}">
            <span class="admin-off-app-tile" aria-hidden="true">${renderAdminOffAppIcon(chore)}</span>
            <span class="admin-off-app-title-wrap">
                <span class="admin-off-app-name">${escapeHtml(name)}</span>
                ${isReviewable && reviewKind !== 'direct' && !isEditing ? buildAdminOffAppNotePreviewHtml(reviewKind, reviewItem, chore) : ''}
            </span>
            ${isReviewable && isEditing ? buildAdminOffAppPointStepperHtml(chore, reviewKind, reviewItem) : ''}
            ${isReviewable && isEditing
                ? buildAdminOffAppGradeFormHtml(chore, reviewKind, reviewItem)
                : (reviewKind === 'direct'
                    ? buildAdminOffAppStatusHtml(chore, pending, kidId, reviewKey)
                    : buildAdminOffAppResultPillHtml(chore, reviewKind, reviewItem))}
        </div>
    `;
}

function handleAdminOffAppInput(event) {
    const target = event.target;
    if (!target || !target.matches) return;
    const reviewKey = target.getAttribute('data-review-key') || '';
    if (target.matches('[data-off-app-points-input]')) {
        const maxPoint = Number.parseInt(target.getAttribute('data-max-point'), 10) || 1;
        const points = clampAdminOffAppPoints(target.value, maxPoint);
        target.value = String(points);
        setAdminOffAppDraftValue(reviewKey, { pointsDelta: points });
        updateAdminOffAppSaveButtonState(reviewKey);
        return;
    }
    if (target.matches('[data-off-app-note-input]')) {
        setAdminOffAppDraftValue(reviewKey, { note: target.value || '' });
        updateAdminOffAppSaveButtonState(reviewKey);
    }
}

function handleAdminOffAppClick(event) {
    const target = event.target && event.target.closest
        ? event.target.closest('[data-off-app-edit], [data-off-app-point-step], [data-off-app-grade-submit], [data-off-app-grade-cancel]')
        : null;
    if (!target) return;
    const reviewKey = target.getAttribute('data-review-key') || '';
    if (target.hasAttribute('data-off-app-edit')) {
        adminOffAppEditingKeys.add(reviewKey);
        renderAdminOffAppSection(currentKids);
        return;
    }
    if (target.hasAttribute('data-off-app-point-step')) {
        const step = Number.parseInt(target.getAttribute('data-off-app-point-step'), 10);
        const maxPoint = Number.parseInt(target.getAttribute('data-max-point'), 10) || 1;
        const row = target.closest('.admin-off-app-row');
        const input = row?.querySelector('[data-off-app-points-input]');
        const current = Number.parseInt(input?.value, 10);
        const nextPoints = clampAdminOffAppPoints(
            (Number.isInteger(current) ? current : maxPoint) + (Number.isInteger(step) ? step : 0),
            maxPoint,
        );
        if (input) input.value = String(nextPoints);
        setAdminOffAppDraftValue(reviewKey, { pointsDelta: nextPoints });
        updateAdminOffAppSaveButtonState(reviewKey);
        renderAdminOffAppSection(currentKids);
        return;
    }
    if (target.hasAttribute('data-off-app-grade-cancel')) {
        adminOffAppDraftByKey.delete(reviewKey);
        adminOffAppEditingKeys.delete(reviewKey);
        renderAdminOffAppSection(currentKids);
        return;
    }
    if (target.hasAttribute('data-off-app-grade-submit')) {
        void submitAdminOffAppGrade(reviewKey);
    }
}

async function submitAdminOffAppGrade(reviewKey) {
    const normalizedReviewKey = String(reviewKey || '');
    const [reviewKind, rawId] = normalizedReviewKey.split(':');
    const reviewId = String(Number.parseInt(rawId, 10) || '');
    const selectedKid = getSelectedAdminKids(currentKids)[0] || null;
    const kidId = String(selectedKid?.id || '').trim();
    if (!kidId || !reviewId || adminOffAppSavingKeys.has(normalizedReviewKey)) {
        return;
    }
    const draft = adminOffAppDraftByKey.get(normalizedReviewKey) || { pointsDelta: 0, note: '' };
    const maxPoint = Number.parseInt(draft.maxPoint, 10) || 1;
    const pointsDelta = clampAdminOffAppPoints(draft.pointsDelta, maxPoint);
    if (!Number.isInteger(pointsDelta) || pointsDelta <= 0) {
        showError('Enter a positive point value before grading.');
        return;
    }
    adminOffAppSavingKeys.add(normalizedReviewKey);
    renderAdminOffAppSection(currentKids);
    try {
        const isEventUpdate = reviewKind === 'event';
        const isDirectCreate = reviewKind === 'direct';
        const url = isEventUpdate
            ? `${API_BASE}/kids/${encodeURIComponent(kidId)}/points/events/${encodeURIComponent(reviewId)}`
            : (isDirectCreate
                ? `${API_BASE}/kids/${encodeURIComponent(kidId)}/points/events`
                : `${API_BASE}/kids/${encodeURIComponent(kidId)}/off-app-chores/pending/${encodeURIComponent(reviewId)}/review`);
        const response = await fetch(url, {
            method: isEventUpdate ? 'PATCH' : 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                ...(isDirectCreate ? { ruleId: reviewId } : {}),
                pointsDelta,
                note: String(draft.note || '').trim(),
            }),
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
            throw new Error(payload.error || `HTTP ${response.status}`);
        }
        adminOffAppDraftByKey.delete(normalizedReviewKey);
        adminOffAppEditingKeys.delete(normalizedReviewKey);
        adminOffAppByKidId.delete(kidId);
        await loadAdminOffAppChores(kidId);
        showError('');
    } catch (error) {
        showError(error.message || 'Failed to save off-app chore grade.');
    } finally {
        adminOffAppSavingKeys.delete(normalizedReviewKey);
        renderAdminOffAppSection(currentKids);
    }
}

function renderAdminOffAppSection(kids) {
    if (!adminOffAppPanel || !adminOffAppList) return;
    const selectedKid = getSelectedAdminKids(kids)[0] || null;
    const kidId = String(selectedKid?.id || '').trim();
    if (!kidId) {
        adminOffAppPanel.classList.add('hidden');
        adminOffAppList.innerHTML = '';
        return;
    }
    adminOffAppPanel.classList.remove('hidden');
    const state = adminOffAppByKidId.get(kidId);
    if (!state) {
        adminOffAppList.innerHTML = '<div class="admin-off-app-empty">Loading off-app chores...</div>';
        void loadAdminOffAppChores(kidId);
        return;
    }
    if (state.error) {
        adminOffAppList.innerHTML = `<div class="admin-off-app-empty">${escapeHtml(state.error)}</div>`;
        return;
    }
    const chores = Array.isArray(state.chores)
        ? state.chores.filter((chore) => chore && chore.isActive !== false)
        : [];
    if (chores.length <= 0) {
        adminOffAppList.innerHTML = '<div class="admin-off-app-empty">No off-app chores enabled.</div>';
        return;
    }
    adminOffAppList.innerHTML = chores.map((chore) => buildAdminOffAppRow(chore, state, kidId)).join('');
}

function buildKidColumnHeader(kid) {
    const kidId = String(kid?.id || '');
    const name = String(kid?.name || '');
    if (!editMode) {
        return `
            <th class="admin-matrix-kid-head admin-matrix-cards-head" data-kid-id="${escapeHtml(kidId)}">
                <span class="admin-matrix-column-head-label">Cards/day</span>
            </th>
        `;
    }
    const initial = getKidInitial(name);
    const tone = hashStringToIndex(kidId || name, KID_AVATAR_TONE_COUNT);
    const savingClass = savingKids.has(kidId) ? ' is-saving' : '';
    const progress = computeKidDailyProgress(kid);
    const ringSegmentsHtml = buildKidRingSegmentsHtml(progress);
    const reportHref = `/kid-report.html?id=${encodeURIComponent(kidId)}`;
    let avatarContentHtml;
    let avatarModeClass = '';
    if (editMode) {
        avatarContentHtml = icon('trash', { size: 16, strokeWidth: 2 });
        avatarModeClass = ' admin-matrix-kid-avatar--mode-delete';
    } else {
        avatarContentHtml = escapeHtml(initial);
    }
    const avatarHtml = `
        <span class="admin-matrix-kid-ring-wrap">
            <svg class="admin-matrix-kid-ring-svg" viewBox="0 0 100 100" aria-hidden="true">
                <circle class="admin-matrix-kid-ring-track" cx="50" cy="50" r="46" />
                ${ringSegmentsHtml}
            </svg>
            <span class="admin-matrix-kid-avatar admin-matrix-kid-avatar--tone-${tone}${avatarModeClass}" aria-hidden="true">${avatarContentHtml}</span>
        </span>
        <span class="admin-matrix-kid-name">${escapeHtml(name)}</span>
    `;
    let interactiveHtml;
    if (editMode) {
        interactiveHtml = `
            <button type="button" class="admin-matrix-kid-head-btn" data-kid-delete data-kid-id="${escapeHtml(kidId)}" aria-label="Delete ${escapeHtml(name)}">
                ${avatarHtml}
            </button>
        `;
    } else {
        interactiveHtml = `
            <a href="${escapeHtml(reportHref)}" class="admin-matrix-kid-head-btn" data-kid-report data-kid-id="${escapeHtml(kidId)}" aria-label="${escapeHtml(name)} — today's report">
                ${avatarHtml}
            </a>
        `;
    }
    return `
        <th class="admin-matrix-kid-head${savingClass}" data-kid-id="${escapeHtml(kidId)}">
            ${interactiveHtml}
        </th>
    `;
}

function computeKidDailyProgress(kid) {
    const optedInKeys = Array.from(getOptedInDeckCategorySet(kid));
    const meta = getAdminDeckCategoryMetaMap(kid);
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

function buildTodayColumnHeader(kid) {
    const kidId = String(kid?.id || '');
    const name = String(kid?.name || '').trim() || 'this child';
    const href = `/kid-report.html?id=${encodeURIComponent(kidId)}`;
    const iconHtml = (typeof window.icon === 'function') ? window.icon('external-link', { size: 11, strokeWidth: 2.5 }) : '';
    return `
        <th class="admin-matrix-status-head">
            <a href="${escapeHtml(href)}" class="admin-matrix-column-head-link admin-matrix-today-head-link" data-kid-report data-kid-id="${escapeHtml(kidId)}" aria-label="${escapeHtml(name)} today's report">
                <span class="admin-matrix-column-head-icon" aria-hidden="true">${iconHtml}</span>
                <span class="admin-matrix-column-head-label">Today</span>
            </a>
        </th>
    `;
}

function buildMatrixRow(row, kids, options = {}) {
    const subjectIconHtml = renderCategorySubjectIcon(row.categoryKey);
    const cellsHtml = kids.map((kid) => buildMatrixCell(row, kid)).join('');
    const showTodayStatusColumn = Boolean(options?.showTodayStatusColumn);
    const todayStatusCellHtml = showTodayStatusColumn ? buildTodayStatusCell(row, kids[0]) : '';
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
            ${todayStatusCellHtml}
        </tr>
    `;
}

function buildTodayStatusCell(row, kid) {
    const kidId = String(kid?.id || '');
    if (!getEffectiveKidCategoryOptedIn(kid, row.categoryKey)) {
        return '<td class="admin-matrix-status-cell"></td>';
    }
    const statusMap = (kid && typeof kid.todaySessionStatusByDeckCategory === 'object')
        ? kid.todaySessionStatusByDeckCategory || {}
        : {};
    const statusInfo = statusMap[row.categoryKey] || {};
    const rawStatus = String(statusInfo.status || 'not_started').trim().toLowerCase();
    const status = rawStatus === 'done' || rawStatus === 'in_progress' ? rawStatus : 'not_started';
    const labelByStatus = {
        not_started: 'Not Started',
        in_progress: 'In Progress',
        done: 'Done',
    };
    const wrongCount = Math.max(0, Number.parseInt(statusInfo.wrongCount ?? statusInfo.wrong_count, 10) || 0);
    const earnedPoints = Number.parseInt(statusInfo.earnedPoints ?? statusInfo.earned_points, 10) || 0;
    const label = status === 'done'
        ? String(earnedPoints)
        : (labelByStatus[status] || labelByStatus.not_started);
    const sessionId = Number.parseInt(statusInfo.sessionId ?? statusInfo.session_id, 10);
    const leadingIconNameByStatus = {
        not_started: 'play',
        in_progress: 'clock',
        done: 'check',
    };
    const leadingIconName = leadingIconNameByStatus[status] || '';
    const leadingIconHtml = leadingIconName && typeof window.icon === 'function'
        ? window.icon(leadingIconName, { size: 15, strokeWidth: 2.8 })
        : '';
    const mainHtml = `${leadingIconHtml}<span>${escapeHtml(label)}</span>`;
    const viewIconHtml = (typeof window.icon === 'function') ? window.icon('eye', { size: 14, strokeWidth: 2.4 }) : '';
    if (Number.isInteger(sessionId) && sessionId > 0) {
        const href = `/kid-session-report.html?id=${encodeURIComponent(kidId)}&sessionId=${encodeURIComponent(sessionId)}`;
        const ariaLabel = status === 'done'
            ? `Done, ${earnedPoints} points, ${wrongCount} wrong. View latest session.`
            : `${label}. View session.`;
        const resultClass = status === 'done' ? 'is-credited' : 'is-review';
        return `
            <td class="admin-matrix-status-cell">
                <a href="${escapeHtml(href)}" class="admin-off-app-result-pill ${resultClass} admin-today-pill admin-today-pill--${escapeHtml(status)}" data-session-link data-kid-id="${escapeHtml(kidId)}" aria-label="${escapeHtml(ariaLabel)}">
                    <span class="admin-off-app-result-pill-main">${mainHtml}</span>
                    <span class="admin-off-app-result-pill-edit" aria-hidden="true">${viewIconHtml}</span>
                </a>
            </td>
        `;
    }
    if (status === 'not_started') {
        return `
            <td class="admin-matrix-status-cell">
                <span class="admin-off-app-status admin-off-app-status--ready admin-today-pill admin-today-pill--not_started">
                    <span class="admin-off-app-status-main">${mainHtml}</span>
                    <span class="admin-off-app-status-edit" aria-hidden="true"></span>
                </span>
            </td>
        `;
    }
    const resultClass = status === 'done' ? 'is-credited' : 'is-review';
    return `
        <td class="admin-matrix-status-cell">
            <span class="admin-off-app-result-pill ${resultClass} admin-today-pill admin-today-pill--${escapeHtml(status)}">
                <span class="admin-off-app-result-pill-main">${mainHtml}</span>
                <span class="admin-off-app-result-pill-edit" aria-hidden="true"></span>
            </span>
        </td>
    `;
}

function buildRowOptInCheckbox(row, kid) {
    const kidId = String(kid?.id || '');
    const optedIn = getEffectiveKidCategoryOptedIn(kid, row.categoryKey);
    const label = optedIn ? 'Opt out' : 'Opt in';
    return `
        <button type="button" role="checkbox" class="admin-matrix-row-check${optedIn ? ' is-checked' : ''}" data-row-opt-toggle data-kid-id="${escapeHtml(kidId)}" data-category-key="${escapeHtml(row.categoryKey)}" aria-checked="${optedIn ? 'true' : 'false'}" aria-label="${label} ${escapeHtml(row.displayName)}">
            <span class="admin-matrix-row-check-box" aria-hidden="true">${optedIn && typeof window.icon === 'function' ? window.icon('check', { size: 13, strokeWidth: 3 }) : ''}</span>
        </button>
    `;
}

function getEffectiveKidCategoryOptedIn(kid, categoryKey) {
    const kidId = String(kid?.id || '');
    const key = String(categoryKey || '');
    if (editState && editState[kidId] && Object.prototype.hasOwnProperty.call(editState[kidId], key)) {
        return !!editState[kidId][key];
    }
    return getOptedInDeckCategorySet(kid).has(key);
}

function buildMatrixCell(row, kid) {
    const kidId = String(kid?.id || '');
    const baselineOptedIn = getEffectiveKidCategoryOptedIn(kid, row.categoryKey);
    const optedIn = baselineOptedIn;
    const rowCheckboxHtml = buildRowOptInCheckbox(row, kid);

    if (!editMode) {
        if (!baselineOptedIn) {
            return `<td class="admin-matrix-cell"><div class="admin-matrix-value-wrap">${rowCheckboxHtml}<span class="admin-matrix-value is-off">Off</span></div></td>`;
        }
        const targets = getCategoryValueMap(kid?.practiceTargetByDeckCategory);
        const cardsPerDay = Number.isInteger(targets[row.categoryKey]) ? targets[row.categoryKey] : 0;
        const params = new URLSearchParams({ id: kidId, categoryKey: row.categoryKey });
        const href = `/kid-card-manage.html?${params.toString()}`;
        const editIconHtml = (typeof window.icon === 'function') ? window.icon('pencil', { size: 12, strokeWidth: 2.5 }) : '';
        return `<td class="admin-matrix-cell"><div class="admin-matrix-value-wrap">${rowCheckboxHtml}<a class="admin-matrix-value admin-matrix-value--link" href="${escapeHtml(href)}" data-cell-link data-kid-id="${escapeHtml(kidId)}"><span class="admin-matrix-value-num">${cardsPerDay}</span><span class="admin-matrix-value-chev" aria-hidden="true">${editIconHtml}</span></a></div></td>`;
    }

    const valueClass = optedIn ? 'admin-matrix-value' : 'admin-matrix-value is-off';
    const label = optedIn ? 'On' : 'Off';
    return `
        <td class="admin-matrix-cell">
            <div class="admin-matrix-value-wrap">
                ${rowCheckboxHtml}
                <button type="button" class="${valueClass}" data-cell-toggle data-kid-id="${escapeHtml(kidId)}" data-category-key="${escapeHtml(row.categoryKey)}" aria-pressed="${optedIn ? 'true' : 'false'}">${label}</button>
            </div>
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
    adminMatrix.querySelectorAll('[data-row-opt-toggle]').forEach((btn) => {
        btn.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            const target = event.currentTarget;
            const kidId = target.getAttribute('data-kid-id') || '';
            const categoryKey = target.getAttribute('data-category-key') || '';
            toggleKidCategoryOptedIn(kidId, categoryKey);
        });
    });
    adminMatrix.querySelectorAll('[data-cell-link]').forEach((link) => {
        link.addEventListener('click', (event) => {
            persistLastViewedKidId(event.currentTarget.getAttribute('data-kid-id') || '');
        });
    });
    adminMatrix.querySelectorAll('[data-session-link]').forEach((link) => {
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
}

function toggleCellOptedIn(kidId, categoryKey) {
    if (!editMode || !editState || isExitingEditMode) return;
    toggleKidCategoryOptedIn(kidId, categoryKey);
}

function toggleKidCategoryOptedIn(kidId, categoryKey) {
    if (!kidId || !categoryKey || isExitingEditMode) return;
    if (!editState) {
        editState = buildEditStateFromKids(currentKids);
    }
    if (!editState[kidId]) editState[kidId] = {};
    editState[kidId][categoryKey] = !editState[kidId][categoryKey];
    scheduleKidSave(kidId);
    renderMatrix();
    renderReviewBanner();
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
        if (!editMode) {
            applyEditStateToCurrentKids();
        }
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
                .flatMap((kid) => Object.entries(getAdminDeckCategoryMetaMap(kid) || {}))
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
