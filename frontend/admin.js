// API Configuration
const API_BASE = `${window.location.origin}/api`;

// DOM Elements
const adminActionGrid = document.getElementById('adminActionGrid');
const adminOptinPanel = document.getElementById('adminOptinPanel');
const adminMatrix = document.getElementById('adminMatrix');
const adminEmptyState = document.getElementById('adminEmptyState');
const getEditToggleBtn = () => document.getElementById('editToggleBtn');
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
let openKidMenuKidId = '';
let openSubjectMenuKey = '';
let isSuperFamily = false;

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
                kidsLoaded = true;
                renderAll();
                usedNavigationCache = true;
            }
        }
        if (!usedNavigationCache && adminActionGrid) {
            adminActionGrid.innerHTML = '<div class="empty-state app-spinner-block" role="status" aria-label="Loading" style="grid-column: 1 / -1; background: transparent;"><span class="app-spinner app-spinner--light" aria-hidden="true"></span></div>';
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
    adminMatrix.classList.toggle('is-editable', editMode);

    const editIconName = editMode ? 'check' : 'pencil';
    const editIconSvg = (typeof window.icon === 'function') ? window.icon(editIconName, { size: 14 }) : '';
    const editLabel = editMode ? 'Done' : 'Edit';
    const editBtnExtraClass = editMode ? ' admin-optin-edit-btn--done' : '';
    const folderIconSvg = (typeof window.icon === 'function') ? window.icon('folder', { size: 14 }) : '';
    const manageBtnHiddenClass = editMode ? ' admin-optin-edit-btn--space-keeper' : '';
    const manageCategoriesBtnHtml = isSuperFamily
        ? `<a href="/deck-category-create.html" class="btn-secondary admin-optin-edit-btn admin-optin-manage-btn${manageBtnHiddenClass}" ${editMode ? 'tabindex="-1" aria-hidden="true"' : ''}>${folderIconSvg}<span>Subjects</span></a>`
        : '';
    const subText = editMode ? 'Tap to toggle · auto-saved' : 'Numbers = cards/day';
    const subClass = editMode ? 'admin-matrix-title-sub admin-matrix-title-sub--edit' : 'admin-matrix-title-sub';
    const headerHtml = `
        <thead>
            <tr>
                <th class="admin-matrix-subject-head">
                    <div class="admin-matrix-title-block">
                        <div class="admin-matrix-title-text">
                            <span class="admin-matrix-title-main">Subject Settings</span>
                            <span class="${subClass}">${subText}</span>
                        </div>
                        <div class="admin-matrix-title-actions">
                            <button id="editToggleBtn" type="button" class="btn-secondary admin-optin-edit-btn${editBtnExtraClass}">
                                ${editIconSvg}<span id="editToggleLabel">${editLabel}</span>
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
    const savingClass = savingKids.has(kidId) ? ' is-saving' : '';
    return `
        <th class="admin-matrix-kid-head${savingClass}" data-kid-id="${escapeHtml(kidId)}">
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
    if (!editMode || !editState || isExitingEditMode) return;
    if (!editState[kidId]) editState[kidId] = {};
    editState[kidId][categoryKey] = !editState[kidId][categoryKey];
    scheduleKidSave(kidId);
    renderMatrix();
}

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
    tv.setMatchBack(false);
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
