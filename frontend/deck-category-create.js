const API_BASE = `${window.location.origin}/api`;

const createCategoryForm = document.getElementById('createCategoryForm');
const categoryKeyInput = document.getElementById('categoryKeyInput');
const displayNameInput = document.getElementById('displayNameInput');
const emojiInput = document.getElementById('emojiInput');
const behaviorTypeSelect = document.getElementById('behaviorTypeSelect');
const hasChineseSpecificLogicCheckbox = document.getElementById('hasChineseSpecificLogicCheckbox');
const createCategoryBtn = document.getElementById('createCategoryBtn');
const tableWrap = document.getElementById('tableWrap');
const emptyState = document.getElementById('emptyState');
const categoryTableBody = document.getElementById('categoryTableBody');
const successMessage = document.getElementById('successMessage');
const errorMessage = document.getElementById('errorMessage');

let isCreating = false;

document.addEventListener('DOMContentLoaded', async () => {
    const allowed = await ensureSuperFamily();
    if (!allowed) {
        return;
    }
    await loadCategories();
});

if (createCategoryForm) {
    createCategoryForm.addEventListener('submit', async (event) => {
        event.preventDefault();
        await createCategory();
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
            return `
                <tr>
                    <td>${escapeHtml(key)}</td>
                    <td>${escapeHtml(displayName)}</td>
                    <td>${escapeHtml(emoji)}</td>
                    <td>${escapeHtml(behavior)}</td>
                    <td>${escapeHtml(chineseSpecific)}</td>
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
    const behaviorType = String(behaviorTypeSelect ? behaviorTypeSelect.value : '').trim();
    const hasChineseSpecificLogic = Boolean(hasChineseSpecificLogicCheckbox && hasChineseSpecificLogicCheckbox.checked);

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
        if (hasChineseSpecificLogicCheckbox) {
            hasChineseSpecificLogicCheckbox.checked = false;
        }
        if (behaviorTypeSelect) {
            behaviorTypeSelect.value = 'type_i';
        }
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
