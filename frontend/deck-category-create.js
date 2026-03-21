const API_BASE = `${window.location.origin}/api`;

const createCategoryForm = document.getElementById('createCategoryForm');
const categoryKeyInput = document.getElementById('categoryKeyInput');
const displayNameInput = document.getElementById('displayNameInput');
const emojiInput = document.getElementById('emojiInput');
const createCategoryBtn = document.getElementById('createCategoryBtn');
const tableWrap = document.getElementById('tableWrap');
const emptyState = document.getElementById('emptyState');
const categoryTableBody = document.getElementById('categoryTableBody');
const successMessage = document.getElementById('successMessage');
const errorMessage = document.getElementById('errorMessage');
const chineseLogicNote = document.getElementById('chineseLogicNote');
const editEmojiModal = document.getElementById('editEmojiModal');
const closeEditEmojiModalBtn = document.getElementById('closeEditEmojiModalBtn');
const cancelEditEmojiModalBtn = document.getElementById('cancelEditEmojiModalBtn');
const saveEditEmojiBtn = document.getElementById('saveEditEmojiBtn');
const editEmojiCategoryKeyText = document.getElementById('editEmojiCategoryKeyText');
const editEmojiCurrentText = document.getElementById('editEmojiCurrentText');
const editEmojiInput = document.getElementById('editEmojiInput');
const editEmojiError = document.getElementById('editEmojiError');

let isCreating = false;
const sharingCategoryKeys = new Set();
let isSavingEmoji = false;
let editingEmojiCategoryKey = '';
let categoriesByKey = {};

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
        if (button.getAttribute('data-action') === 'edit-emoji') {
            openEditEmojiModal(categoryKey);
            return;
        }
        void shareCategory(categoryKey);
    });
}

if (createCategoryForm) {
    createCategoryForm.addEventListener('submit', async (event) => {
        event.preventDefault();
        await createCategory();
    });
}

if (closeEditEmojiModalBtn) {
    closeEditEmojiModalBtn.addEventListener('click', () => {
        closeEditEmojiModal();
    });
}

if (cancelEditEmojiModalBtn) {
    cancelEditEmojiModalBtn.addEventListener('click', () => {
        closeEditEmojiModal();
    });
}

if (saveEditEmojiBtn) {
    saveEditEmojiBtn.addEventListener('click', async () => {
        await saveEditedEmoji();
    });
}

if (editEmojiInput) {
    editEmojiInput.addEventListener('keydown', (event) => {
        if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
            event.preventDefault();
            void saveEditedEmoji();
            return;
        }
        if (event.key === 'Enter') {
            event.preventDefault();
            void saveEditedEmoji();
            return;
        }
        if (event.key === 'Escape') {
            event.preventDefault();
            closeEditEmojiModal();
        }
    });
}

if (editEmojiModal) {
    editEmojiModal.addEventListener('click', (event) => {
        if (event.target === editEmojiModal) {
            closeEditEmojiModal();
        }
    });
}

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
}

function bindBehaviorTypeUi() {
    const options = Array.from(document.querySelectorAll('input[name="behaviorType"]'));
    options.forEach((option) => {
        option.addEventListener('change', () => {
            syncBehaviorDependentInputs();
        });
    });
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
            chineseLogicNote.textContent = 'Type IV categories always use generic logic in this first version.';
            chineseLogicNote.classList.remove('hidden');
        } else {
            chineseLogicNote.textContent = '';
            chineseLogicNote.classList.add('hidden');
        }
    }
}

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
        showError(error.message || 'Failed to load categories.');
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
            const emoji = String(item.emoji || '').trim();
            const behavior = String(item.behavior_type || '').trim();
            const chineseSpecific = item.has_chinese_specific_logic ? 'Yes' : 'No';
            const sharedWithNonSuper = Boolean(item.is_shared_with_non_super_family);
            const isSharing = sharingCategoryKeys.has(key);
            const isEditingEmoji = isSavingEmoji && editingEmojiCategoryKey === key;
            const shareButton = sharedWithNonSuper
                ? `<button type="button" class="btn-secondary" disabled>Shared</button>`
                : `<button type="button" class="btn-primary" data-action="share-category" data-category-key="${escapeHtml(key)}" ${isSharing ? 'disabled' : ''}>${isSharing ? 'Sharing...' : 'Share to Non-super'}</button>`;
            return `
                <tr>
                    <td>${escapeHtml(key)}</td>
                    <td>${escapeHtml(displayName)}</td>
                    <td>
                        <div class="category-emoji-cell">
                            <span class="category-emoji-text">${escapeHtml(emoji || '—')}</span>
                            <button
                                type="button"
                                class="btn-secondary category-emoji-btn"
                                data-action="edit-emoji"
                                data-category-key="${escapeHtml(key)}"
                                ${isEditingEmoji ? 'disabled' : ''}
                            >${isEditingEmoji ? 'Saving...' : 'Change'}</button>
                        </div>
                    </td>
                    <td>${escapeHtml(behavior)}</td>
                    <td>${escapeHtml(chineseSpecific)}</td>
                    <td>${sharedWithNonSuper ? 'Yes' : 'No'}</td>
                    <td>${shareButton}</td>
                </tr>
            `;
        }).join('');
    }
}

async function createCategory() {
    if (isCreating) {
        return;
    }

    const categoryKey = normalizeCategoryKey(categoryKeyInput ? categoryKeyInput.value : '');
    const displayName = String(displayNameInput ? displayNameInput.value : '').trim();
    const emoji = String(emojiInput ? emojiInput.value : '').trim();
    const behaviorType = getSelectedBehaviorType();
    const hasChineseSpecificLogic = getSelectedChineseSpecificLogic();

    if (!categoryKey) {
        showError('Category key is required.');
        return;
    }
    if (!behaviorType) {
        showError('Behavior type is required.');
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
                emoji,
                behaviorType,
                hasChineseSpecificLogic,
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
        if (emojiInput) {
            emojiInput.value = '';
        }
        resetChineseSpecificLogicSelection(false);
        resetBehaviorTypeSelection('type_i');
        await loadCategories();
    } catch (error) {
        showError(error.message || 'Failed to create category.');
    } finally {
        isCreating = false;
        if (createCategoryBtn) {
            createCategoryBtn.disabled = false;
            createCategoryBtn.textContent = 'Create Category';
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
        showSuccess(`Category shared with non-super families: ${key}`);
    } catch (error) {
        showError(error.message || 'Failed to share category.');
    } finally {
        sharingCategoryKeys.delete(key);
        await loadCategories();
    }
}

function showEditEmojiError(message) {
    if (!editEmojiError) {
        return;
    }
    const text = String(message || '').trim();
    if (!text) {
        editEmojiError.textContent = '';
        editEmojiError.classList.add('hidden');
        return;
    }
    editEmojiError.textContent = text;
    editEmojiError.classList.remove('hidden');
}

function setEditEmojiBusy(isBusy) {
    isSavingEmoji = Boolean(isBusy);
    if (saveEditEmojiBtn) {
        saveEditEmojiBtn.disabled = isSavingEmoji;
        saveEditEmojiBtn.textContent = isSavingEmoji ? 'Saving...' : 'Save Emoji';
    }
    if (cancelEditEmojiModalBtn) {
        cancelEditEmojiModalBtn.disabled = isSavingEmoji;
    }
    if (closeEditEmojiModalBtn) {
        closeEditEmojiModalBtn.disabled = isSavingEmoji;
    }
    if (editEmojiInput) {
        editEmojiInput.disabled = isSavingEmoji;
    }
}

function openEditEmojiModal(categoryKey) {
    const key = normalizeCategoryKey(categoryKey);
    const category = categoriesByKey[key];
    if (!category || !editEmojiModal) {
        return;
    }
    editingEmojiCategoryKey = key;
    if (editEmojiCategoryKeyText) {
        editEmojiCategoryKeyText.textContent = key;
    }
    const currentEmoji = String(category.emoji || '').trim();
    if (editEmojiCurrentText) {
        editEmojiCurrentText.textContent = currentEmoji || '—';
    }
    if (editEmojiInput) {
        editEmojiInput.value = currentEmoji;
    }
    showEditEmojiError('');
    setEditEmojiBusy(false);
    editEmojiModal.classList.remove('hidden');
    editEmojiModal.setAttribute('aria-hidden', 'false');
    document.body.classList.add('modal-open');
    window.setTimeout(() => {
        editEmojiInput?.focus();
        editEmojiInput?.select();
    }, 0);
}

function closeEditEmojiModal(force = false) {
    if (!editEmojiModal || (isSavingEmoji && !force)) {
        return;
    }
    editEmojiModal.classList.add('hidden');
    editEmojiModal.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('modal-open');
    editingEmojiCategoryKey = '';
    showEditEmojiError('');
    setEditEmojiBusy(false);
}

async function saveEditedEmoji() {
    const categoryKey = normalizeCategoryKey(editingEmojiCategoryKey);
    if (!categoryKey || isSavingEmoji) {
        return;
    }
    setEditEmojiBusy(true);
    showEditEmojiError('');
    showError('');
    showSuccess('');
    try {
        const response = await fetch(`${API_BASE}/shared-decks/categories/${encodeURIComponent(categoryKey)}/emoji`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                emoji: String(editEmojiInput ? editEmojiInput.value : '').trim(),
            }),
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok) {
            throw new Error(result.error || `Failed to update emoji (HTTP ${response.status})`);
        }
        closeEditEmojiModal(true);
        showSuccess(`Updated emoji for category: ${categoryKey}`);
        await loadCategories();
    } catch (error) {
        showEditEmojiError(error.message || 'Failed to update emoji.');
        setEditEmojiBusy(false);
        await loadCategories();
    }
}

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
