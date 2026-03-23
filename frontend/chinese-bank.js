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
const refreshUsedBtn = document.getElementById('refreshUsedBtn');
const forceSyncBtn = document.getElementById('forceSyncBtn');
const sortUpdatedTh = document.getElementById('sortUpdatedTh');
const csvToggleBtn = document.getElementById('csvToggleBtn');
const csvPreviewBtn = document.getElementById('csvPreviewBtn');
const csvEditor = document.getElementById('csvEditor');
const csvClearBtn = document.getElementById('csvClearBtn');

let currentPage = 1;
const perPage = 50;
let totalCount = 0;
const pendingEdits = new Map(); // character -> { pinyin, en, verified }
let debounceTimer = null;
let sortUpdated = ''; // '', 'asc', 'desc'
let currentPageChars = []; // store current page data for CSV export
let csvVisible = false;
let isSuper = false;

function applySuperVisibility() {
    const superOnly = [refreshUsedBtn, forceSyncBtn, csvToggleBtn, saveBar];
    for (const el of superOnly) {
        if (el) el.style.display = isSuper ? '' : 'none';
    }
    if (!isSuper) {
        const h1 = document.querySelector('h1');
        if (h1) h1.textContent = '📕 View Dictionary';
        document.title = 'View Dictionary - Kids Daily Chores';
    }
}

function showError(msg) {
    errorMessage.textContent = msg || '';
}

function escapeHtml(text) {
    const el = document.createElement('span');
    el.textContent = String(text || '');
    return el.innerHTML;
}

function formatDate(dateStr) {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    if (isNaN(d)) return escapeHtml(dateStr);
    return d.toLocaleString(undefined, {
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', hour12: false,
    });
}

async function loadPage() {
    showError('');
    const params = new URLSearchParams({
        page: currentPage,
        perPage,
    });
    const search = searchInput.value.trim();
    if (search) params.set('search', search);
    if (filterVerifiedValue !== 'all') params.set('verified', filterVerifiedValue);
    if (sortUpdated) params.set('sort', `updated_${sortUpdated}`);

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
        currentPageChars = data.characters;
        if (data.isSuper !== undefined) {
            isSuper = data.isSuper;
            applySuperVisibility();
        }
        renderStats(data.stats);
        renderTable(data.characters);
        renderPagination();
        if (csvVisible) populateCsv();
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
        const pinyinEdited = edited && edited.pinyin !== c.pinyin ? ' edited' : '';
        const enEdited = edited && edited.en !== c.en ? ' edited' : '';
        if (!isSuper) {
            return `<tr>
                <td class="char-cell ${isVerified ? 'verified' : 'unverified'}" style="cursor:default;">${escapeHtml(c.character)}</td>
                <td class="pinyin-cell">${escapeHtml(pinyinVal)}</td>
                <td class="en-cell">${escapeHtml(enVal)}</td>
                <td style="text-align:center;">${c.used ? '✓' : ''}</td>
                <td class="updated-cell">${formatDate(c.lastUpdated)}</td>
            </tr>`;
        }
        return `<tr data-char="${escapeHtml(c.character)}" data-original-verified="${c.verified}">
            <td class="char-cell ${isVerified ? 'verified' : 'unverified'}" data-field="verified">${escapeHtml(c.character)}</td>
            <td class="pinyin-cell${pinyinEdited}">
                <input type="text" value="${escapeHtml(pinyinVal)}" data-field="pinyin" data-original="${escapeHtml(c.pinyin)}" />
            </td>
            <td class="en-cell${enEdited}">
                <input type="text" value="${escapeHtml(enVal)}" data-field="en" data-original="${escapeHtml(c.en)}" />
            </td>
            <td style="text-align:center;">${c.used ? '✓' : ''}</td>
            <td class="updated-cell">${formatDate(c.lastUpdated)}</td>
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

    const pinyinInput = tr.querySelector('input[data-field="pinyin"]');
    const enInput = tr.querySelector('input[data-field="en"]');
    const pinyinOriginal = pinyinInput.dataset.original;
    const enOriginal = enInput.dataset.original;
    const verifiedOriginal = tr.dataset.originalVerified === 'true';

    if (field === 'verified') {
        existing.verified = value;
        if (!existing.pinyin) existing.pinyin = pinyinInput.value;
        if (!existing.en) existing.en = enInput.value;
    } else {
        const input = tr.querySelector(`input[data-field="${field}"]`);
        existing[field] = value;
        if (!existing.pinyin) existing.pinyin = pinyinInput.value;
        if (!existing.en) existing.en = enInput.value;
        if (existing.verified === undefined) {
            existing.verified = tr.querySelector('td.char-cell').classList.contains('verified');
        }
        // Visual feedback
        const cell = input.closest('td');
        if (value !== input.dataset.original) {
            cell.classList.add('edited');
        } else {
            cell.classList.remove('edited');
        }
    }

    if (existing.pinyin === pinyinOriginal && existing.en === enOriginal && existing.verified === verifiedOriginal) {
        pendingEdits.delete(char);
    } else {
        pendingEdits.set(char, existing);
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

bankTableBody.addEventListener('click', (e) => {
    if (!isSuper) return;
    const cell = e.target.closest('td.char-cell');
    if (!cell) return;
    const tr = cell.closest('tr');
    if (!tr) return;
    const isNowVerified = cell.classList.contains('unverified');
    cell.classList.toggle('verified', isNowVerified);
    cell.classList.toggle('unverified', !isNowVerified);
    handleFieldChange(tr, 'verified', isNowVerified);
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

function renderSortUpdatedTh() {
    const arrow = sortUpdated === 'asc' ? '▲' : sortUpdated === 'desc' ? '▼' : '▲▼';
    sortUpdatedTh.innerHTML = `Updated<span class="sort-arrow">${arrow}</span>`;
    sortUpdatedTh.classList.toggle('sort-active', sortUpdated !== '');
}

sortUpdatedTh.addEventListener('click', () => {
    if (sortUpdated === '') sortUpdated = 'desc';
    else if (sortUpdated === 'desc') sortUpdated = 'asc';
    else sortUpdated = '';
    renderSortUpdatedTh();
    currentPage = 1;
    loadPage();
});

renderSortUpdatedTh();

refreshUsedBtn.addEventListener('click', async () => {
    showError('');
    refreshUsedBtn.disabled = true;
    refreshUsedBtn.textContent = 'Scanning...';
    try {
        const res = await fetch(`${API_BASE}/chinese-bank/refresh-used`, { method: 'POST' });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
            showError(data.error || 'Failed to refresh');
            return;
        }
        const lines = [];
        const diff = data.usedCount - data.prevUsedCount;
        lines.push(`Used: ${data.prevUsedCount} → ${data.usedCount} (${diff >= 0 ? '+' : ''}${diff})`);
        if (data.insertedChars && data.insertedChars.length > 0) {
            lines.push(`\nNew to bank (inserted): ${data.insertedChars.join(' ')}`);
        }
        if (data.newlyUsed && data.newlyUsed.length > 0) {
            lines.push(`\nNewly used: ${data.newlyUsed.join(' ')}`);
        }
        if (data.newlyUnused && data.newlyUnused.length > 0) {
            lines.push(`\nNo longer used: ${data.newlyUnused.join(' ')}`);
        }
        if (!data.insertedChars?.length && !data.newlyUsed?.length && !data.newlyUnused?.length) {
            lines.push('\nNo changes.');
        }
        alert(lines.join(''));
        await loadPage();
    } catch (err) {
        showError(err.message || 'Failed to refresh');
    } finally {
        refreshUsedBtn.disabled = false;
        refreshUsedBtn.textContent = 'Refresh Used';
    }
});

// CSV editor
function populateCsv() {
    const lines = currentPageChars.map((c) => {
        const edited = pendingEdits.get(c.character);
        const pinyin = edited ? edited.pinyin : c.pinyin;
        const en = edited ? edited.en : c.en;
        return `${c.character},${pinyin},${en}`;
    });
    csvEditor.value = lines.join('\n');
}

function applyCsvPreview() {
    const lines = csvEditor.value.split('\n').filter((l) => l.trim());
    const originalByChar = {};
    for (const c of currentPageChars) {
        originalByChar[c.character] = c;
    }

    for (const line of lines) {
        const parts = line.split(',');
        if (parts.length < 3) continue;
        const char = parts[0].trim();
        const pinyin = parts[1].trim();
        const en = parts[2].trim();
        const orig = originalByChar[char];
        if (!orig) continue;

        const existing = pendingEdits.get(char) || {};
        existing.pinyin = pinyin;
        existing.en = en;
        existing.verified = true;
        if (pinyin === orig.pinyin && en === orig.en && orig.verified === true) {
            pendingEdits.delete(char);
        } else {
            pendingEdits.set(char, existing);
        }
    }

    renderTable(currentPageChars);
    updateSaveBar();
}

csvToggleBtn.addEventListener('click', () => {
    csvVisible = !csvVisible;
    csvEditor.style.display = csvVisible ? '' : 'none';
    csvPreviewBtn.style.display = csvVisible ? '' : 'none';
    csvClearBtn.style.display = csvVisible ? '' : 'none';
    csvToggleBtn.textContent = csvVisible ? 'Hide CSV' : 'Show CSV';
    if (csvVisible) populateCsv();
});

csvPreviewBtn.addEventListener('click', () => {
    applyCsvPreview();
});

csvClearBtn.addEventListener('click', () => {
    pendingEdits.clear();
    populateCsv();
    renderTable(currentPageChars);
    updateSaveBar();
});

forceSyncBtn.addEventListener('click', async () => {
    if (!confirm('Re-generate back text for all cards matching verified bank characters?\nThis will update shared decks and all kid DBs.')) {
        return;
    }
    showError('');
    forceSyncBtn.disabled = true;
    forceSyncBtn.textContent = 'Syncing...';
    try {
        const res = await fetch(`${API_BASE}/chinese-bank/force-sync-backs`, { method: 'POST' });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
            showError(data.error || 'Failed to sync');
            return;
        }
        const changes = data.changed || [];
        if (changes.length === 0) {
            alert(`All ${data.verified_count} verified chars already in sync. Nothing to update.`);
        } else {
            const lines = changes.map((c) =>
                `${c.character}: ${c.shared} shared card${c.shared !== 1 ? 's' : ''}, ${c.kid_dbs} kid DB${c.kid_dbs !== 1 ? 's' : ''}`
            );
            alert(`Updated ${changes.length} of ${data.verified_count} verified chars:\n\n${lines.join('\n')}`);
        }
    } catch (err) {
        showError(err.message || 'Failed to sync');
    } finally {
        forceSyncBtn.disabled = false;
        forceSyncBtn.textContent = 'Force Sync Backs';
    }
});

// Initial load
loadPage();
