/**
 * Subject (deck-category) admin page — super-family only.
 *
 * Lists shared deck_category rows from /api/shared-decks/categories, lets the
 * super-family create new subjects with behavior type + optional Chinese-specific
 * logic, share to non-super families (one-way), or delete unshared ones.
 *
 * Layout:
 *   1. DOM refs + module state
 *   2. Bootstrap + form / table event wiring
 *   3. Selectors + behavior-type + chinese-logic sync
 *   4. Super-family gate + categories load / render
 *   5. Create / share / delete category actions
 *   6. Success/error toast helpers
 */

// =====================================================================
// === 1. DOM refs + module state
// =====================================================================

const API_BASE = `${window.location.origin}/api`;

const createCategoryForm = document.getElementById('createCategoryForm');
const categoryKeyInput = document.getElementById('categoryKeyInput');
const displayNameInput = document.getElementById('displayNameInput');
const createCategoryBtn = document.getElementById('createCategoryBtn');
const tableWrap = document.getElementById('tableWrap');
const emptyState = document.getElementById('emptyState');
const categoryTableBody = document.getElementById('categoryTableBody');
const successMessage = document.getElementById('successMessage');
const errorMessage = document.getElementById('errorMessage');
const chineseLogicNote = document.getElementById('chineseLogicNote');
const chineseBackContentFieldset = document.getElementById('chineseBackContentFieldset');

let isCreating = false;
const sharingCategoryKeys = new Set();
const deletingCategoryKeys = new Set();
let categoriesByKey = {};

const renderCategorySubjectIcon = (window.DeckCategoryCommon && window.DeckCategoryCommon.renderCategorySubjectIcon)
    || ((key) => '');

// =====================================================================
// === 2. Bootstrap + form / table event wiring
// =====================================================================

document.addEventListener('DOMContentLoaded', async () => {
    const allowed = await ensureSuperFamily();
    if (!allowed) {
        return;
    }
    bindBehaviorTypeUi();
    syncBehaviorDependentInputs();
    await loadCategories();
});

if (categoryTableBody) {
    categoryTableBody.addEventListener('click', (event) => {
        const button = event.target.closest('button[data-action]');
        if (!button) {
            return;
        }
        const categoryKey = String(button.getAttribute('data-category-key') || '').trim();
        if (!categoryKey) {
            return;
        }
        const action = button.getAttribute('data-action');
        if (action === 'share-category') {
            void shareCategory(categoryKey);
        } else if (action === 'delete-category') {
            void deleteCategory(categoryKey);
        }
    });
}

if (createCategoryForm) {
    createCategoryForm.addEventListener('submit', async (event) => {
        event.preventDefault();
        await createCategory();
    });
}


// =====================================================================
// === 3. Selectors + behavior-type + chinese-logic sync
// =====================================================================

function normalizeCategoryKey(text) {
    return String(text || '')
        .trim()
        .toLowerCase()
        .replace(/\s+/g, '_')
        .replace(/_+/g, '_')
        .replace(/^_+|_+$/g, '');
}

function getSelectedBehaviorType() {
    const selected = document.querySelector('input[name="behaviorType"]:checked');
    return String(selected ? selected.value : '').trim();
}

function resetBehaviorTypeSelection(defaultValue = 'type_i') {
    const options = Array.from(document.querySelectorAll('input[name="behaviorType"]'));
    for (const option of options) {
        option.checked = String(option.value || '').trim() === defaultValue;
    }
    syncBehaviorDependentInputs();
}

function getSelectedChineseSpecificLogic() {
    const selected = document.querySelector('input[name="hasChineseSpecificLogic"]:checked');
    return String(selected ? selected.value : '').trim().toLowerCase() === 'true';
}

function resetChineseSpecificLogicSelection(defaultValue = false) {
    const defaultText = defaultValue ? 'true' : 'false';
    const options = Array.from(document.querySelectorAll('input[name="hasChineseSpecificLogic"]'));
    for (const option of options) {
        option.checked = String(option.value || '').trim().toLowerCase() === defaultText;
    }
    syncChineseBackContentVisibility();
}

function getSelectedChineseBackContent() {
    const selected = document.querySelector('input[name="chineseBackContent"]:checked');
    const value = String(selected ? selected.value : '').trim().toLowerCase();
    return value === 'pinyin' || value === 'english' ? value : '';
}

function resetChineseBackContentSelection() {
    const options = Array.from(document.querySelectorAll('input[name="chineseBackContent"]'));
    for (const option of options) {
        option.checked = false;
    }
}

function syncChineseBackContentVisibility() {
    if (!chineseBackContentFieldset) {
        return;
    }
    const chineseLogicOn = getSelectedChineseSpecificLogic();
    const isTypeI = getSelectedBehaviorType() === 'type_i';
    const show = chineseLogicOn && isTypeI;
    chineseBackContentFieldset.classList.toggle('hidden', !show);
    if (!show) {
        resetChineseBackContentSelection();
    }
}

function bindBehaviorTypeUi() {
    const options = Array.from(document.querySelectorAll('input[name="behaviorType"]'));
    options.forEach((option) => {
        option.addEventListener('change', () => {
            syncBehaviorDependentInputs();
            syncChineseBackContentVisibility();
        });
    });
    const logicOptions = Array.from(document.querySelectorAll('input[name="hasChineseSpecificLogic"]'));
    logicOptions.forEach((option) => {
        option.addEventListener('change', syncChineseBackContentVisibility);
    });
    syncChineseBackContentVisibility();
}

function syncBehaviorDependentInputs() {
    const isTypeIV = getSelectedBehaviorType() === 'type_iv';
    const logicOptions = Array.from(document.querySelectorAll('input[name="hasChineseSpecificLogic"]'));
    if (isTypeIV) {
        resetChineseSpecificLogicSelection(false);
    }
    logicOptions.forEach((option) => {
        option.disabled = isTypeIV;
    });
    if (chineseLogicNote) {
        if (isTypeIV) {
            chineseLogicNote.textContent = 'Type IV subjects always use generic logic in this first version.';
            chineseLogicNote.classList.remove('hidden');
        } else {
            chineseLogicNote.textContent = '';
            chineseLogicNote.classList.add('hidden');
        }
    }
}

// =====================================================================
// === 4. Super-family gate + categories load / render
// =====================================================================

async function ensureSuperFamily() {
    try {
        const response = await fetch(`${API_BASE}/family-auth/status`);
        if (!response.ok) {
            window.location.href = '/family-login.html';
            return false;
        }
        const auth = await response.json().catch(() => ({}));
        if (!auth.authenticated) {
            window.location.href = '/family-login.html';
            return false;
        }
        if (!auth.isSuperFamily) {
            window.location.href = '/admin.html';
            return false;
        }
        return true;
    } catch (error) {
        window.location.href = '/admin.html';
        return false;
    }
}

async function loadCategories() {
    showError('');
    try {
        const response = await fetch(`${API_BASE}/shared-decks/categories`);
        const result = await response.json().catch(() => ({}));
        if (!response.ok) {
            throw new Error(result.error || `Failed to load categories (HTTP ${response.status})`);
        }
        const categories = Array.isArray(result.categories) ? result.categories : [];
        renderCategories(categories);
    } catch (error) {
        renderCategories([]);
        showError(error.message || 'Failed to load subjects.');
    }
}

function renderCategories(categories) {
    const list = Array.isArray(categories) ? categories : [];
    categoriesByKey = {};
    list.forEach((item) => {
        const key = String(item && item.category_key ? item.category_key : '').trim();
        if (key) {
            categoriesByKey[key] = item;
        }
    });
    if (list.length === 0) {
        if (tableWrap) {
            tableWrap.classList.add('hidden');
        }
        if (emptyState) {
            emptyState.classList.remove('hidden');
        }
        if (categoryTableBody) {
            categoryTableBody.innerHTML = '';
        }
        return;
    }

    if (emptyState) {
        emptyState.classList.add('hidden');
    }
    if (tableWrap) {
        tableWrap.classList.remove('hidden');
    }
    if (categoryTableBody) {
        categoryTableBody.innerHTML = list.map((item) => {
            const key = String(item.category_key || '').trim();
            const displayName = String(item.display_name || '').trim();
            const behavior = String(item.behavior_type || '').trim();
            const chineseSpecific = item.has_chinese_specific_logic ? 'Yes' : 'No';
            const chineseBackContentRaw = String(item.chinese_back_content || '').trim().toLowerCase();
            const chineseBackContentLabel = chineseBackContentRaw === 'pinyin'
                ? 'Pinyin'
                : chineseBackContentRaw === 'english'
                    ? 'English'
                    : '—';
            const sharedWithNonSuper = Boolean(item.is_shared_with_non_super_family);
            const isSharing = sharingCategoryKeys.has(key);
            const isDeleting = deletingCategoryKeys.has(key);
            const shareButton = sharedWithNonSuper
                ? `<button type="button" class="paradigm-btn" disabled>Shared</button>`
                : `<button type="button" class="paradigm-btn" data-action="share-category" data-category-key="${escapeHtml(key)}" ${isSharing || isDeleting ? 'disabled' : ''}>${isSharing ? 'Sharing...' : 'Share to Non-super'}</button>`;
            const deleteButton = sharedWithNonSuper
                ? ''
                : `<button type="button" class="paradigm-btn is-danger category-delete-btn" data-action="delete-category" data-category-key="${escapeHtml(key)}" ${isDeleting || isSharing ? 'disabled' : ''}>${isDeleting ? 'Deleting...' : 'Delete'}</button>`;
            const iconHtml = renderCategorySubjectIcon(key, { size: 32 });
            return `
                <tr>
                    <td class="category-icon-cell">${iconHtml}</td>
                    <td>${escapeHtml(key)}</td>
                    <td>${escapeHtml(displayName)}</td>
                    <td>${escapeHtml(behavior)}</td>
                    <td>${escapeHtml(chineseSpecific)}</td>
                    <td>${escapeHtml(chineseBackContentLabel)}</td>
                    <td>${sharedWithNonSuper ? 'Yes' : 'No'}</td>
                    <td><div class="category-action-cell">${shareButton}${deleteButton}</div></td>
                </tr>
            `;
        }).join('');
    }
}

// =====================================================================
// === 5. Create / share / delete category actions
// =====================================================================

async function createCategory() {
    if (isCreating) {
        return;
    }

    const categoryKey = normalizeCategoryKey(categoryKeyInput ? categoryKeyInput.value : '');
    const displayName = String(displayNameInput ? displayNameInput.value : '').trim();
    const behaviorType = getSelectedBehaviorType();
    const hasChineseSpecificLogic = getSelectedChineseSpecificLogic();
    const isTypeI = behaviorType === 'type_i';
    const chineseBackContent = (hasChineseSpecificLogic && isTypeI)
        ? getSelectedChineseBackContent()
        : '';

    if (!categoryKey) {
        showError('Subject key is required.');
        return;
    }
    if (!behaviorType) {
        showError('Behavior type is required.');
        return;
    }
    if (hasChineseSpecificLogic && isTypeI && !chineseBackContent) {
        showError('Pick a Chinese back-of-card content type (Pinyin or English).');
        return;
    }

    isCreating = true;
    showError('');
    showSuccess('');
    if (createCategoryBtn) {
        createCategoryBtn.disabled = true;
        createCategoryBtn.textContent = 'Creating...';
    }

    try {
        const response = await fetch(`${API_BASE}/shared-decks/categories`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                categoryKey,
                displayName,
                behaviorType,
                hasChineseSpecificLogic,
                chineseBackContent,
            }),
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok) {
            throw new Error(result.error || `Failed to create category (HTTP ${response.status})`);
        }

        showSuccess(`Created category: ${categoryKey}`);
        if (categoryKeyInput) {
            categoryKeyInput.value = '';
            categoryKeyInput.focus();
        }
        if (displayNameInput) {
            displayNameInput.value = '';
        }
        resetChineseSpecificLogicSelection(false);
        resetChineseBackContentSelection();
        resetBehaviorTypeSelection('type_i');
        syncChineseBackContentVisibility();
        await loadCategories();
    } catch (error) {
        showError(error.message || 'Failed to create subject.');
    } finally {
        isCreating = false;
        if (createCategoryBtn) {
            createCategoryBtn.disabled = false;
            createCategoryBtn.textContent = 'Create Subject';
        }
    }
}

async function shareCategory(categoryKey) {
    const key = normalizeCategoryKey(categoryKey);
    if (!key || sharingCategoryKeys.has(key)) {
        return;
    }
    const confirmed = window.confirm(
        `Share category "${key}" with non-super families?\n\nThis action cannot be undone.`
    );
    if (!confirmed) {
        return;
    }
    sharingCategoryKeys.add(key);
    showError('');
    showSuccess('');
    await loadCategories();
    try {
        const response = await fetch(`${API_BASE}/shared-decks/categories/${encodeURIComponent(key)}/share`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({}),
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok) {
            throw new Error(result.error || `Failed to share category (HTTP ${response.status})`);
        }
        showSuccess(`Subject shared with non-super families: ${key}`);
    } catch (error) {
        showError(error.message || 'Failed to share subject.');
    } finally {
        sharingCategoryKeys.delete(key);
        await loadCategories();
    }
}

async function deleteCategory(categoryKey) {
    const key = normalizeCategoryKey(categoryKey);
    if (!key || deletingCategoryKeys.has(key) || sharingCategoryKeys.has(key)) {
        return;
    }
    const meta = categoriesByKey[key];
    if (meta && Boolean(meta.is_shared_with_non_super_family)) {
        showError(`Subject "${key}" is already shared with non-super families and cannot be deleted.`);
        return;
    }
    showError('');
    showSuccess('');
    deletingCategoryKeys.add(key);
    renderCategories(Object.values(categoriesByKey));
    try {
        const result = await window.PracticeManageCommon.requestWithPasswordDialog(
            `deleting subject "${key}"`,
            (password) => fetch(`${API_BASE}/shared-decks/categories/${encodeURIComponent(key)}`, {
                method: 'DELETE',
                headers: window.PracticeManageCommon.buildPasswordHeaders(password, false),
            }),
            {
                warningMessage: `This will permanently delete the "${key}" subject and ALL related decks, cards, sessions, and badges across every kid. This cannot be undone.`,
            },
        );
        if (result.cancelled) {
            return;
        }
        if (!result.ok) {
            throw new Error(result.error || 'Failed to delete subject.');
        }
        showSuccess(`Deleted subject "${key}".`);
    } catch (error) {
        showError(error.message || 'Failed to delete subject.');
    } finally {
        deletingCategoryKeys.delete(key);
        await loadCategories();
    }
}

// =====================================================================
// === 6. Success/error toast helpers
// =====================================================================

function showSuccess(message) {
    if (!successMessage) {
        return;
    }
    const text = String(message || '').trim();
    if (!text) {
        successMessage.textContent = '';
        successMessage.classList.add('hidden');
        return;
    }
    successMessage.textContent = text;
    successMessage.classList.remove('hidden');
}

function showError(message) {
    if (!errorMessage) {
        return;
    }
    const text = String(message || '').trim();
    if (!text) {
        errorMessage.textContent = '';
        errorMessage.classList.add('hidden');
        return;
    }
    errorMessage.textContent = text;
    errorMessage.classList.remove('hidden');
}
