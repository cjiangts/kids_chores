const API_BASE = `${window.location.origin}/api`;

const searchInput = document.getElementById('searchInput');
const filterVerifiedGroup = document.getElementById('filterVerifiedGroup');
let filterVerifiedValue = 'unverified';
const bankTableBody = document.getElementById('bankTableBody');
const bankStats = document.getElementById('bankStats');
const prevPageBtn = document.getElementById('prevPageBtn');
const nextPageBtn = document.getElementById('nextPageBtn');
const pageInfo = document.getElementById('pageInfo');
const saveBar = document.getElementById('saveBar');
const pendingCount = document.getElementById('pendingCount');
const saveChangesBtn = document.getElementById('saveChangesBtn');
const errorMessage = document.getElementById('errorMessage');

let currentPage = 1;
const perPage = 50;
let totalCount = 0;
const pendingEdits = new Map(); // character -> { pinyin, en, verified }
let debounceTimer = null;

function showError(msg) {
    errorMessage.textContent = msg || '';
}

function escapeHtml(text) {
    const el = document.createElement('span');
    el.textContent = String(text || '');
    return el.innerHTML;
}

async function loadPage() {
    showError('');
    const params = new URLSearchParams({
        page: currentPage,
        perPage,
        used: 'used',
    });
    const search = searchInput.value.trim();
    if (search) params.set('search', search);
    if (filterVerifiedValue !== 'all') params.set('verified', filterVerifiedValue);

    try {
        const res = await fetch(`${API_BASE}/chinese-bank?${params}`);
        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            if (res.status === 401) {
                window.location.href = '/parent-settings.html';
                return;
            }
            showError(err.error || `Failed to load (HTTP ${res.status})`);
            return;
        }
        const data = await res.json();
        totalCount = data.total;
        renderStats(data.stats);
        renderTable(data.characters);
        renderPagination();
    } catch (err) {
        showError(err.message || 'Failed to load');
    }
}

function renderStats(stats) {
    bankStats.innerHTML = `
        <span>Total: ${stats.total.toLocaleString()}</span>
        <span>Used: ${stats.used.toLocaleString()}</span>
        <span>Verified: ${stats.verified.toLocaleString()}</span>
    `;
}

function renderTable(characters) {
    bankTableBody.innerHTML = characters.map((c) => {
        const edited = pendingEdits.get(c.character);
        const pinyinVal = edited ? edited.pinyin : c.pinyin;
        const enVal = edited ? edited.en : c.en;
        const isVerified = edited ? edited.verified : c.verified;
        const editedClass = edited ? ' edited' : '';
        return `<tr data-char="${escapeHtml(c.character)}">
            <td>${escapeHtml(c.character)}</td>
            <td class="pinyin-cell${editedClass}">
                <input type="text" value="${escapeHtml(pinyinVal)}" data-field="pinyin" data-original="${escapeHtml(c.pinyin)}" />
            </td>
            <td class="en-cell${editedClass}">
                <input type="text" value="${escapeHtml(enVal)}" data-field="en" data-original="${escapeHtml(c.en)}" />
            </td>
            <td style="text-align:center;">
                <input type="checkbox" data-field="verified" ${isVerified ? 'checked' : ''} data-original="${c.verified}" />
            </td>
        </tr>`;
    }).join('');
}

function renderPagination() {
    const totalPages = Math.max(1, Math.ceil(totalCount / perPage));
    pageInfo.textContent = `Page ${currentPage} of ${totalPages} (${totalCount.toLocaleString()} chars)`;
    prevPageBtn.disabled = currentPage <= 1;
    nextPageBtn.disabled = currentPage >= totalPages;
}

function updateSaveBar() {
    if (pendingEdits.size > 0) {
        saveBar.classList.remove('hidden');
        pendingCount.textContent = `${pendingEdits.size} pending change${pendingEdits.size > 1 ? 's' : ''}`;
    } else {
        saveBar.classList.add('hidden');
    }
}

function handleFieldChange(tr, field, value) {
    const char = tr.dataset.char;
    const existing = pendingEdits.get(char) || {};

    if (field === 'verified') {
        const originalVerified = tr.querySelector('input[data-field="verified"]').dataset.original === 'true';
        existing.verified = value;
        // Check if all fields match original
        const pinyinInput = tr.querySelector('input[data-field="pinyin"]');
        const enInput = tr.querySelector('input[data-field="en"]');
        const pinyinOriginal = pinyinInput.dataset.original;
        const enOriginal = enInput.dataset.original;
        const currentPinyin = existing.pinyin || pinyinInput.value;
        const currentEn = existing.en || enInput.value;
        if (currentPinyin === pinyinOriginal && currentEn === enOriginal && value === originalVerified) {
            pendingEdits.delete(char);
        } else {
            existing.pinyin = currentPinyin;
            existing.en = currentEn;
            pendingEdits.set(char, existing);
        }
    } else {
        const input = tr.querySelector(`input[data-field="${field}"]`);
        const original = input.dataset.original;
        existing[field] = value;
        // Populate other fields if not set
        if (!existing.pinyin) existing.pinyin = tr.querySelector('input[data-field="pinyin"]').value;
        if (!existing.en) existing.en = tr.querySelector('input[data-field="en"]').value;
        if (existing.verified === undefined) existing.verified = tr.querySelector('input[data-field="verified"]').checked;

        const pinyinOriginal = tr.querySelector('input[data-field="pinyin"]').dataset.original;
        const enOriginal = tr.querySelector('input[data-field="en"]').dataset.original;
        const verifiedOriginal = tr.querySelector('input[data-field="verified"]').dataset.original === 'true';
        if (existing.pinyin === pinyinOriginal && existing.en === enOriginal && existing.verified === verifiedOriginal) {
            pendingEdits.delete(char);
        } else {
            pendingEdits.set(char, existing);
        }

        // Visual feedback
        const cell = input.closest('td');
        if (value !== original) {
            cell.classList.add('edited');
        } else {
            cell.classList.remove('edited');
        }
    }
    updateSaveBar();
}

async function saveChanges() {
    if (pendingEdits.size === 0) return;
    showError('');
    saveChangesBtn.disabled = true;
    saveChangesBtn.textContent = 'Saving...';

    const updates = [];
    for (const [character, edit] of pendingEdits) {
        updates.push({
            character,
            pinyin: edit.pinyin,
            en: edit.en,
            verified: edit.verified,
        });
    }

    try {
        const res = await fetch(`${API_BASE}/chinese-bank`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ updates }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
            showError(data.error || 'Failed to save');
            return;
        }
        pendingEdits.clear();
        updateSaveBar();
        await loadPage();
    } catch (err) {
        showError(err.message || 'Failed to save');
    } finally {
        saveChangesBtn.disabled = false;
        saveChangesBtn.textContent = 'Save Changes';
    }
}

// Event listeners
bankTableBody.addEventListener('input', (e) => {
    const input = e.target;
    if (!input.dataset.field || input.dataset.field === 'verified') return;
    const tr = input.closest('tr');
    if (tr) handleFieldChange(tr, input.dataset.field, input.value);
});

bankTableBody.addEventListener('change', (e) => {
    const input = e.target;
    if (input.dataset.field === 'verified') {
        const tr = input.closest('tr');
        if (tr) handleFieldChange(tr, 'verified', input.checked);
    }
});

searchInput.addEventListener('input', () => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
        currentPage = 1;
        loadPage();
    }, 300);
});

filterVerifiedGroup.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-value]');
    if (!btn) return;
    filterVerifiedGroup.querySelectorAll('button').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    filterVerifiedValue = btn.dataset.value;
    currentPage = 1;
    loadPage();
});

prevPageBtn.addEventListener('click', () => {
    if (currentPage > 1) {
        currentPage -= 1;
        loadPage();
    }
});

nextPageBtn.addEventListener('click', () => {
    const totalPages = Math.ceil(totalCount / perPage);
    if (currentPage < totalPages) {
        currentPage += 1;
        loadPage();
    }
});

saveChangesBtn.addEventListener('click', saveChanges);

// Initial load
loadPage();
