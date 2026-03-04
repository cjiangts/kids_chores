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
const kidBirthdayInput = document.getElementById('kidBirthday');
const kidNameInput = document.getElementById('kidName');
const manageDecksLink = document.getElementById('manageDecksLink');
const {
    getOptedInDeckCategorySet,
    getCategoryValueMap,
    getDeckCategoryMetaMap,
    getCategoryDisplayName,
    getCategoryEmoji,
} = window.DeckCategoryCommon;
let isCreatingKid = false;
let isSavingDeckCategories = false;
let currentKids = [];
let deckCategoryModalState = {
    kidId: '',
    availableKeys: [],
    optedInKeys: [],
};

// Load kids on page load
document.addEventListener('DOMContentLoaded', async () => {
    await applySuperFamilyUi();
    loadKids();
    bindBirthdayAutoFormat();
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
        manageDecksLink.classList.toggle('hidden', !Boolean(auth.isSuperFamily));
    } catch (error) {
        manageDecksLink.classList.add('hidden');
    }
}

// API Functions
async function loadKids() {
    try {
        showError('');
        kidsList.innerHTML = '<div class="empty-state"><p>Loading...</p></div>';
        const response = await fetch(`${API_BASE}/kids`);

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const kids = await response.json();
        currentKids = Array.isArray(kids) ? kids : [];
        displayKids(kids);
    } catch (error) {
        console.error('Error loading kids:', error);
        currentKids = [];
        showError('Failed to load kids. Make sure the backend server is running on port 5001.');
    }
}

async function createKid() {
    if (isCreatingKid) {
        return;
    }
    const submitBtn = kidForm.querySelector('button[type="submit"]');
    try {
        isCreatingKid = true;
        const name = document.getElementById('kidName').value;
        const birthday = document.getElementById('kidBirthday').value;

        // Validate birthday format (YYYY-MM-DD)
        const validationResult = validateBirthday(birthday);
        if (!validationResult) {
            showError('');
            window.alert('Invalid birthday format! Please use YYYY-MM-DD (e.g., 2015-06-15)');
            if (kidBirthdayInput) {
                kidBirthdayInput.focus();
            }
            return;
        }

        submitBtn.disabled = true;
        submitBtn.textContent = 'Creating...';
        if (kidNameInput) {
            kidNameInput.disabled = true;
        }
        if (kidBirthdayInput) {
            kidBirthdayInput.disabled = true;
        }

        const response = await fetch(`${API_BASE}/kids`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ name, birthday }),
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
        if (kidBirthdayInput) {
            kidBirthdayInput.disabled = false;
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
    return ['type_i', 'type_ii', 'type_iii'].includes(behaviorType)
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
            <div class="empty-state">
                <h3>No kids yet</h3>
                <p>Click "Add New Kid" to add your first learner!</p>
            </div>
        `;
        return;
    }

    kidsList.innerHTML = kids.map(kid => {
        const age = calculateAge(kid.birthday);
        const optedInCategories = getOptedInDeckCategorySet(kid);
        const practiceTargetByCategory = getCategoryValueMap(kid?.practiceTargetByDeckCategory);
        const categoryMetaMap = getDeckCategoryMetaMap(kid);
        const optedInCategoryKeys = Array.from(optedInCategories).sort((a, b) => a.localeCompare(b));

        const manageRows = optedInCategoryKeys.map((categoryKey) => {
            const displayName = getCategoryDisplayName(categoryKey, categoryMetaMap);
            const emoji = getCategoryEmoji(categoryKey, categoryMetaMap);
            const dailyTarget = Number.parseInt(practiceTargetByCategory[categoryKey], 10);
            const safeDailyTarget = Number.isInteger(dailyTarget) ? Math.max(0, dailyTarget) : 0;
            const label = `${emoji} ${displayName} (${safeDailyTarget}/day)`;
            const href = getManageHrefByCategory(categoryKey, kid.id, categoryMetaMap);
            if (href) {
                return `
                    <div class="practice-config-row">
                        <a class="tab-link secondary practice-manage-btn" href="${href}">${label}</a>
                    </div>
                `;
            }
            return `
                <div class="practice-config-row">
                    <button type="button" class="tab-link secondary practice-manage-btn" disabled title="Manage page not implemented yet">${label}</button>
                </div>
            `;
        });
        const showTypeIIIReviewBtn = Boolean(kid.hasTypeIIIToReview);
        const reviewTypeIIIRow = showTypeIIIReviewBtn
            ? `<div class="practice-config-row">
                        <button class="tab-link review-reading-btn" onclick="goToLatestTypeIIIReviewSession('${kid.id}')">🎧 Review Kid's Recording</button>
                    </div>`
            : '';
        return `
            <div class="kid-card">
                <h3>${escapeHtml(kid.name)}</h3>
                <p class="age">Age: ${age} years old</p>
                <p class="age">Birthday: ${formatDate(kid.birthday)}</p>
                <div class="practice-config-list" onclick="event.stopPropagation()">
                    <div class="practice-config-row">
                        <a class="tab-link primary practice-manage-btn" href="#" onclick="openDeckCategoryOptInModal('${kid.id}'); return false;">🧩 Opt-in Deck Category</a>
                    </div>
                    ${manageRows.join('')}
                    <div class="practice-config-row">
                        <a class="tab-link report-btn" href="/kid-report.html?id=${kid.id}">📊 Report</a>
                    </div>
                    ${reviewTypeIIIRow}
                </div>
                <button class="delete-btn" onclick="deleteKid('${kid.id}', '${escapeHtml(kid.name)}')">
                    🗑️ Delete
                </button>
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

function bindBirthdayAutoFormat() {
    if (!kidBirthdayInput) {
        return;
    }
    kidBirthdayInput.addEventListener('input', () => {
        const digits = String(kidBirthdayInput.value || '').replace(/\D/g, '').slice(0, 8);
        let formatted = digits;
        if (digits.length > 4) {
            formatted = `${digits.slice(0, 4)}-${digits.slice(4)}`;
        }
        if (digits.length > 6) {
            formatted = `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6)}`;
        }
        kidBirthdayInput.value = formatted;
    });
}
