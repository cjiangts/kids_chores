// API Configuration
const API_BASE = `${window.location.origin}/api`;

// DOM Elements
const adminActionGrid = document.getElementById('adminActionGrid');
const adminOptinPanel = document.getElementById('adminOptinPanel');
const adminMatrix = document.getElementById('adminMatrix');
const adminEditActions = document.getElementById('adminEditActions');
const adminEmptyState = document.getElementById('adminEmptyState');
const getEditToggleBtn = () => document.getElementById('editToggleBtn');
const cancelEditBtn = document.getElementById('cancelEditBtn');
const saveEditBtn = document.getElementById('saveEditBtn');
const newKidBtn = document.getElementById('newKidBtn');
const kidModal = document.getElementById('kidModal');
const kidForm = document.getElementById('kidForm');
const cancelBtn = document.getElementById('cancelBtn');
const errorMessage = document.getElementById('errorMessage');
const kidNameInput = document.getElementById('kidName');
const kidFormSaveBtn = document.getElementById('kidFormSaveBtn');

const {
    normalizeCategoryKey,
    getOptedInDeckCategoryKeys,
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
let isSavingMatrix = false;
let currentKids = [];
let currentFamilyId = '';
let editMode = false;
let editState = null;
let editBaseline = null;
let openKidMenuKidId = '';
let openSubjectMenuKey = '';
let isSuperFamily = false;

document.addEventListener('DOMContentLoaded', () => {
    loadKids({ preferNavigationCache: true });
    loadAuthStatus();
    bindEvents();
    keepEditBarAboveKeyboard();
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

function keepEditBarAboveKeyboard() {
    const vv = window.visualViewport;
    if (!vv || !adminEditActions) return;
    const update = () => {
        const offset = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
        const accessoryBar = offset > 0 ? 56 : 0;
        adminEditActions.style.bottom = `calc(1rem + ${offset + accessoryBar}px)`;
    };
    vv.addEventListener('resize', update);
    vv.addEventListener('scroll', update);
    update();
}

function bindEvents() {
    if (newKidBtn) {
        newKidBtn.addEventListener('click', () => {
            kidModal.classList.remove('hidden');
            syncKidFormSaveBtn();
        });
    }
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
    if (cancelEditBtn) {
        cancelEditBtn.addEventListener('click', exitEditMode);
    }
    if (saveEditBtn) {
        saveEditBtn.addEventListener('click', saveMatrix);
    }
    document.addEventListener('click', (event) => {
        if (openKidMenuKidId) {
            const menu = document.querySelector('.admin-kid-menu');
            const trigger = event.target.closest('[data-kid-menu-trigger]');
            const inside = (menu && menu.contains(event.target)) || trigger;
            if (!inside) closeKidMenu();
        }
        if (openSubjectMenuKey) {
            const subjectMenu = document.querySelector('.admin-subject-menu');
            const subjectTrigger = event.target.closest('[data-subject-menu-trigger]');
            const inside = (subjectMenu && subjectMenu.contains(event.target)) || subjectTrigger;
            if (!inside) closeSubjectMenu();
        }
    });
}

function syncKidFormSaveBtn() {
    if (kidFormSaveBtn) {
        kidFormSaveBtn.disabled = !kidNameInput || !kidNameInput.value.trim();
    }
}

function escapeHtml(text) {
    return String(text || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
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

async function loadKids(options = {}) {
    const preferNavigationCache = Boolean(options?.preferNavigationCache);
    let usedNavigationCache = false;
    try {
        showError('');
        if (preferNavigationCache) {
            const cachedKids = readKidsFromParentNavigationCache();
            if (cachedKids) {
                currentKids = cachedKids;
                renderAll();
                usedNavigationCache = true;
            }
        }
        if (!usedNavigationCache && adminActionGrid) {
            adminActionGrid.innerHTML = '<div class="empty-state app-spinner-block" role="status" aria-label="Loading"><span class="app-spinner" aria-hidden="true"></span></div>';
        }
        const response = await fetch(`${API_BASE}/kids?view=admin`);
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        const kids = await response.json();
        currentKids = Array.isArray(kids) ? kids : [];
        cacheKidsForParentNavigation(currentKids);
        renderAll();
    } catch (error) {
        console.error('Error loading kids:', error);
        if (!usedNavigationCache) {
            currentKids = [];
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
        const name = document.getElementById('kidName').value;
        submitBtn.disabled = true;
        submitBtn.textContent = 'Creating...';
        if (kidNameInput) kidNameInput.disabled = true;
        const response = await fetch(`${API_BASE}/kids`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name }),
        });
        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
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
    renderActionGrid();
    renderMatrix();
}

function renderActionGrid() {
    if (!adminActionGrid) return;
    const list = Array.isArray(currentKids) ? currentKids : [];
    if (list.length === 0) {
        adminActionGrid.innerHTML = '';
        return;
    }
    const totalReviewCount = list.reduce((sum, kid) => {
        const count = Number.parseInt(kid?.typeIIIToReviewCount, 10);
        return sum + (Number.isInteger(count) && count > 0 ? count : 0);
    }, 0);
    const hasReviewAudio = totalReviewCount > 0;
    const hasAnyOptIn = list.some((kid) => getOptedInDeckCategoryKeys(kid).length > 0);
    adminActionGrid.classList.remove('admin-action-grid--two');
    const actionsHtml = [
        buildActionCardHtml({
            id: 'cardMgmtBtn',
            iconName: 'layers',
            iconClass: 'admin-action-card-icon--blue',
            label: 'Manage Cards',
            disabled: !hasAnyOptIn,
        }),
        buildActionCardHtml({
            id: 'practiceReportBtn',
            iconName: 'bar-chart-3',
            iconClass: 'admin-action-card-icon--violet',
            label: 'View Reports',
        }),
        buildActionCardHtml({
            id: 'reviewAudioBtn',
            iconName: 'headphones',
            iconClass: 'admin-action-card-icon--coral',
            label: 'Review Audio',
            badge: hasReviewAudio ? totalReviewCount : null,
            disabled: !hasReviewAudio,
        }),
    ].join('');
    adminActionGrid.innerHTML = actionsHtml;
    if (hasAnyOptIn) {
        bindActionCard('cardMgmtBtn', () => navigateForAction('card-mgmt'));
    }
    bindActionCard('practiceReportBtn', () => navigateForAction('practice-report'));
    if (hasReviewAudio) {
        bindActionCard('reviewAudioBtn', () => navigateForAction('review-audio'));
    }
}

function buildActionCardHtml({ id, iconName, iconClass, label, badge, disabled }) {
    const badgeHtml = (badge != null && badge > 0)
        ? `<span class="admin-action-card-badge">${badge}</span>`
        : '';
    const disabledAttr = disabled ? ' disabled aria-disabled="true"' : '';
    const disabledClass = disabled ? ' is-disabled' : '';
    return `
        <button type="button" id="${id}" class="admin-action-card${disabledClass}"${disabledAttr}>
            <span class="admin-action-card-icon ${iconClass}" aria-hidden="true">${icon(iconName, { size: 22 })}${badgeHtml}</span>
            <span class="admin-action-card-label">${escapeHtml(label)}</span>
        </button>
    `;
}

function bindActionCard(id, handler) {
    const el = document.getElementById(id);
    if (el) el.addEventListener('click', handler);
}

function navigateForAction(action) {
    const list = Array.isArray(currentKids) ? currentKids : [];
    if (list.length === 0) {
        showError('Add a kid first.');
        return;
    }
    if (action === 'review-audio') {
        const reviewKid = pickKidWithReviewAudio(list);
        if (!reviewKid) {
            showError('No audio to review right now.');
            return;
        }
        goToLatestTypeIIIReviewSession(reviewKid.id);
        return;
    }
    const targetKidId = getMostRecentKidId(list);
    if (!targetKidId) {
        showError('Add a kid first.');
        return;
    }
    persistLastViewedKidId(targetKidId);
    if (action === 'card-mgmt') {
        const targetKid = list.find((kid) => String(kid?.id || '') === targetKidId);
        const categoryKey = pickDefaultCategoryKeyForKid(targetKid);
        if (!categoryKey) {
            showError('No subjects opted in for this kid yet. Use the table below to opt in.');
            return;
        }
        const params = new URLSearchParams({ id: targetKidId, categoryKey });
        window.location.href = `/kid-card-manage.html?${params.toString()}`;
    } else if (action === 'practice-report') {
        window.location.href = `/kid-report.html?id=${encodeURIComponent(targetKidId)}`;
    }
}

function pickDefaultCategoryKeyForKid(kid) {
    if (!kid) return '';
    const optedInKeys = getOptedInDeckCategoryKeys(kid);
    if (optedInKeys.length > 0) return optedInKeys[0];
    const meta = getDeckCategoryMetaMap(kid);
    const firstAvailable = Object.keys(meta || {}).find((rawKey) => {
        const key = normalizeCategoryKey(rawKey);
        const behaviorType = normalizeBehaviorType(meta[rawKey]?.behavior_type);
        return key && VALID_BEHAVIOR_TYPES.has(behaviorType);
    });
    return firstAvailable ? normalizeCategoryKey(firstAvailable) : '';
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

function renderMatrix() {
    if (!adminMatrix || !adminOptinPanel || !adminEmptyState) return;
    const list = Array.isArray(currentKids) ? currentKids : [];
    if (list.length === 0) {
        adminOptinPanel.classList.add('hidden');
        adminEmptyState.classList.remove('hidden');
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
    {
        const eb = getEditToggleBtn();
        if (eb) eb.disabled = editMode;
    }

    if (editMode) {
        adminMatrix.classList.add('is-editable');
        adminEditActions.classList.remove('hidden');
        adminEditActions.removeAttribute('inert');
        document.body.classList.add('admin-edit-mode');
    } else {
        if (adminEditActions.contains(document.activeElement)) {
            document.activeElement.blur();
        }
        adminMatrix.classList.remove('is-editable');
        adminEditActions.classList.add('hidden');
        adminEditActions.setAttribute('inert', '');
        document.body.classList.remove('admin-edit-mode');
    }

    const editIconSvg = (typeof window.icon === 'function') ? window.icon('pencil', { size: 14 }) : '';
    const folderIconSvg = (typeof window.icon === 'function') ? window.icon('folder', { size: 14 }) : '';
    const manageCategoriesBtnHtml = isSuperFamily
        ? `<a href="/deck-category-create.html" class="btn-secondary admin-optin-edit-btn admin-optin-manage-btn">${folderIconSvg}<span>Subjects</span></a>`
        : '';
    const headerHtml = `
        <thead>
            <tr>
                <th class="admin-matrix-subject-head">
                    <div class="admin-matrix-title-block">
                        <div class="admin-matrix-title-text">
                            <span class="admin-matrix-title-main">Subject Settings</span>
                            <span class="admin-matrix-title-sub">Numbers = cards/day</span>
                        </div>
                        <div class="admin-matrix-title-actions">
                            <button id="editToggleBtn" type="button" class="btn-secondary admin-optin-edit-btn">
                                ${editIconSvg}<span id="editToggleLabel">Edit</span>
                            </button>
                            ${manageCategoriesBtnHtml}
                        </div>
                    </div>
                </th>
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
    if (editMode) setSaveButtonState();
    if (openKidMenuKidId) {
        // Re-render menu position if open.
        renderKidMenu(openKidMenuKidId);
    }
    if (openSubjectMenuKey) {
        renderSubjectMenu(openSubjectMenuKey);
    }
}

function buildKidColumnHeader(kid) {
    const kidId = String(kid?.id || '');
    const name = String(kid?.name || '');
    const initial = getKidInitial(name);
    const tone = hashStringToIndex(kidId || name, KID_AVATAR_TONE_COUNT);
    return `
        <th class="admin-matrix-kid-head">
            <button type="button" class="admin-matrix-kid-head-btn" data-kid-menu-trigger data-kid-id="${escapeHtml(kidId)}" aria-label="Options for ${escapeHtml(name)}">
                <span class="admin-matrix-kid-avatar admin-matrix-kid-avatar--tone-${tone}" aria-hidden="true">${escapeHtml(initial)}</span>
                <span class="admin-matrix-kid-name">${escapeHtml(name)}</span>
                <span class="admin-matrix-kid-caret" aria-hidden="true">${icon('chevron-down', { size: 12 })}</span>
            </button>
        </th>
    `;
}

function buildMatrixRow(row, kids) {
    const subjectIconHtml = renderCategorySubjectIcon(row.categoryKey, { size: 36 });
    const cellsHtml = kids.map((kid) => buildMatrixCell(row, kid)).join('');
    const showSubjectMenu = isSuperFamily;
    const moreIconHtml = (showSubjectMenu && typeof window.icon === 'function') ? window.icon('more-vertical', { size: 16 }) : '';
    const subjectMenuBtnHtml = showSubjectMenu
        ? `<button type="button" class="admin-matrix-subject-menu-btn" data-subject-menu-trigger data-category-key="${escapeHtml(row.categoryKey)}" aria-label="Subject options for ${escapeHtml(row.displayName)}">${moreIconHtml}</button>`
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
    adminMatrix.querySelectorAll('[data-kid-menu-trigger]').forEach((btn) => {
        btn.addEventListener('click', (event) => {
            event.stopPropagation();
            const target = event.currentTarget;
            const kidId = target.getAttribute('data-kid-id') || '';
            if (openKidMenuKidId === kidId) {
                closeKidMenu();
            } else {
                openKidMenu(kidId, target);
            }
        });
    });
}

function toggleCellOptedIn(kidId, categoryKey) {
    if (!editMode || !editState) return;
    if (!editState[kidId]) editState[kidId] = {};
    editState[kidId][categoryKey] = !editState[kidId][categoryKey];
    renderMatrix();
}

function enterEditMode() {
    editMode = true;
    editState = buildEditStateFromKids(currentKids);
    editBaseline = cloneEditState(editState);
    renderMatrix();
}

function exitEditMode() {
    editMode = false;
    editState = null;
    editBaseline = null;
    renderMatrix();
}

function cloneEditState(state) {
    const out = {};
    Object.keys(state || {}).forEach((kidId) => {
        out[kidId] = { ...(state[kidId] || {}) };
    });
    return out;
}

function isCellChanged(kidId, categoryKey) {
    if (!editState || !editBaseline) return false;
    const cur = !!(editState[kidId] && editState[kidId][categoryKey]);
    const base = !!(editBaseline[kidId] && editBaseline[kidId][categoryKey]);
    return cur !== base;
}

function hasAnyMatrixChanges() {
    if (!editState || !editBaseline) return false;
    return Object.keys(editState).some((kidId) => {
        const row = editState[kidId] || {};
        return Object.keys(row).some((key) => isCellChanged(kidId, key));
    });
}

async function saveMatrix() {
    if (!editMode || !editState || isSavingMatrix) return;
    const list = Array.isArray(currentKids) ? currentKids : [];
    const updatesByKid = {};
    list.forEach((kid) => {
        const kidId = String(kid?.id || '');
        if (!kidId) return;
        const baselineOpted = getOptedInDeckCategorySet(kid);
        const newState = editState[kidId] || {};
        const optedInKeys = [];
        let changed = false;
        Object.keys(newState).forEach((categoryKey) => {
            const isOpted = !!newState[categoryKey];
            const wasOpted = baselineOpted.has(categoryKey);
            if (isOpted) optedInKeys.push(categoryKey);
            if (isOpted !== wasOpted) changed = true;
        });
        if (!changed) return;
        updatesByKid[kidId] = optedInKeys.sort((a, b) => a.localeCompare(b));
    });

    const kidIdsToSave = Object.keys(updatesByKid);
    if (kidIdsToSave.length === 0) {
        exitEditMode();
        return;
    }

    isSavingMatrix = true;
    setSaveButtonState();
    try {
        for (const kidId of kidIdsToSave) {
            const response = await fetch(`${API_BASE}/kids/${encodeURIComponent(kidId)}/deck-categories`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ categoryKeys: updatesByKid[kidId] }),
            });
            if (!response.ok) {
                const payload = await response.json().catch(() => ({}));
                throw new Error(payload.error || `HTTP ${response.status}`);
            }
        }
        editMode = false;
        editState = null;
        editBaseline = null;
        await loadKids();
    } catch (error) {
        console.error('Error saving matrix:', error);
        showError(error.message || 'Failed to save changes.');
    } finally {
        isSavingMatrix = false;
        setSaveButtonState();
    }
}

function setSaveButtonState() {
    if (!saveEditBtn) return;
    const hasChanges = hasAnyMatrixChanges();
    saveEditBtn.disabled = isSavingMatrix || !hasChanges;
    saveEditBtn.textContent = isSavingMatrix ? 'Saving...' : 'Save';
    if (cancelEditBtn) cancelEditBtn.disabled = isSavingMatrix;
}

function openKidMenu(kidId, anchorEl) {
    openKidMenuKidId = String(kidId || '');
    closeKidMenuDom();
    if (!openKidMenuKidId || !anchorEl) return;
    renderKidMenu(openKidMenuKidId, anchorEl);
}

function closeKidMenu() {
    openKidMenuKidId = '';
    closeKidMenuDom();
}

function closeKidMenuDom() {
    document.querySelectorAll('.admin-kid-menu').forEach((el) => el.remove());
}

function renderKidMenu(kidId, anchorEl) {
    closeKidMenuDom();
    const kid = currentKids.find((item) => String(item?.id || '') === String(kidId || ''));
    if (!kid) return;
    const menu = document.createElement('div');
    menu.className = 'admin-kid-menu';
    menu.innerHTML = `
        <button type="button" class="admin-kid-menu-item danger" data-kid-menu-action="delete">
            <span class="admin-kid-menu-item-icon" aria-hidden="true">${icon('trash', { size: 16 })}</span>
            <span>Delete kid</span>
        </button>
    `;
    document.body.appendChild(menu);
    const trigger = anchorEl || document.querySelector(`[data-kid-menu-trigger][data-kid-id="${cssEscape(kidId)}"]`);
    if (trigger) {
        const rect = trigger.getBoundingClientRect();
        const menuWidth = 160;
        let left = rect.right + window.scrollX - menuWidth;
        if (left < 8) left = 8;
        menu.style.left = `${left}px`;
        menu.style.top = `${rect.bottom + window.scrollY + 4}px`;
    }
    menu.querySelector('[data-kid-menu-action="delete"]').addEventListener('click', () => {
        closeKidMenu();
        deleteKid(kidId, kid.name || '');
    });
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
    const newDeckHref = `/deck-create.html${query ? `?${query}` : ''}`;
    const bulkHref = `/deck-create-bulk.html${query ? `?${query}` : ''}`;
    const menu = document.createElement('div');
    menu.className = 'admin-subject-menu';
    menu.innerHTML = `
        <a class="admin-subject-menu-item" href="${escapeHtml(newDeckHref)}">
            <span class="admin-subject-menu-item-icon" aria-hidden="true">${icon('plus', { size: 16 })}</span>
            <span>New deck</span>
        </a>
        <a class="admin-subject-menu-item" href="${escapeHtml(bulkHref)}">
            <span class="admin-subject-menu-item-icon" aria-hidden="true">${icon('layers', { size: 16 })}</span>
            <span>Bulk add new decks</span>
        </a>
    `;
    document.body.appendChild(menu);
    const trigger = anchorEl || document.querySelector(`[data-subject-menu-trigger][data-category-key="${cssEscape(categoryKey)}"]`);
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
