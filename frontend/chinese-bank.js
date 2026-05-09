const API_BASE = `${window.location.origin}/api`;

const MODE = (() => {
    const raw = (new URLSearchParams(window.location.search).get('mode') || '').trim().toLowerCase();
    return raw === 'english' ? 'english' : 'pinyin';
})();

const MODE_CONFIG = {
    pinyin: {
        title: 'Manage Characters',
        viewTitle: 'View Characters',
        keyHeader: 'Char',
        valueHeader: 'Pinyin',
        searchPlaceholder: 'Search character or pinyin...',
        csvPlaceholder: 'Char,Pinyin',
        unitSingular: 'char',
        unitPlural: 'chars',
    },
    english: {
        title: 'Manage Vocabulary',
        viewTitle: 'View Vocabulary',
        keyHeader: 'Word',
        valueHeader: 'English',
        searchPlaceholder: 'Search word or meaning...',
        csvPlaceholder: 'Word,English',
        unitSingular: 'word',
        unitPlural: 'words',
    },
};
const cfg = MODE_CONFIG[MODE];

const searchInput = document.getElementById('searchInput');
const filterVerifiedGroup = document.getElementById('filterVerifiedGroup');
let filterVerifiedValue = 'verified';
const bankTableBody = document.getElementById('bankTableBody');
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
const csvCopyClearBtn = document.getElementById('csvCopyClearBtn');
const keyColumnHeader = document.getElementById('keyColumnHeader');
const valueColumnHeader = document.getElementById('valueColumnHeader');

let currentPage = 1;
const perPage = 50;
let totalCount = 0;
const pendingEdits = new Map(); // key -> { value, verified }
let debounceTimer = null;
let sortUpdated = ''; // '', 'asc', 'desc'
let currentPageRows = [];
let csvVisible = false;
let isSuper = false;

function applyModeChrome() {
    document.body.classList.add(`bank-mode-${MODE}`);
    keyColumnHeader.textContent = cfg.keyHeader;
    valueColumnHeader.textContent = cfg.valueHeader;
    searchInput.placeholder = cfg.searchPlaceholder;
    csvEditor.placeholder = cfg.csvPlaceholder;
    document.title = `${cfg.title} - Kids Daily Chores`;
    const h1 = document.querySelector('h1');
    if (h1) {
        h1.innerHTML = `<span class="icon page-title-icon" data-icon="book" data-icon-size="28"></span> ${escapeHtml(cfg.title)}`;
        if (typeof hydrateIcons === 'function') hydrateIcons(h1);
    }
}

function applySuperVisibility() {
    const adminActions = document.getElementById('bankAdminActions');
    const superOnly = [refreshUsedBtn, forceSyncBtn, csvToggleBtn, saveBar, adminActions];
    for (const el of superOnly) {
        if (el) el.style.display = isSuper ? '' : 'none';
    }
    if (!isSuper) {
        const h1 = document.querySelector('h1');
        if (h1) {
            h1.innerHTML = `<span class="icon page-title-icon" data-icon="book" data-icon-size="28"></span> ${escapeHtml(cfg.viewTitle)}`;
            if (typeof hydrateIcons === 'function') hydrateIcons(h1);
        }
        document.title = `${cfg.viewTitle} - Kids Daily Chores`;
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
    const startOfDay = (date) => {
        const c = new Date(date);
        c.setHours(0, 0, 0, 0);
        return c.getTime();
    };
    const days = Math.max(0, Math.round((startOfDay(new Date()) - startOfDay(d)) / 86400000));
    if (days === 0) return 'today';
    return `${days}d ago`;
}

async function loadPage() {
    showError('');
    const params = new URLSearchParams({
        mode: MODE,
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
        currentPageRows = data.rows;
        if (data.isSuper !== undefined) {
            isSuper = data.isSuper;
            applySuperVisibility();
        }
        renderStats(data.stats);
        renderTable(currentPageRows);
        renderPagination();
        if (csvVisible) populateCsv();
    } catch (err) {
        showError(err.message || 'Failed to load');
    }
}

function renderStats(stats) {
    const unverifiedCount = Math.max(0, (stats.used || 0) - (stats.verified || 0));
    const btnTexts = {
        'unverified': `Used & Unverified (${unverifiedCount.toLocaleString()})`,
        'used': `Used (${(stats.used || 0).toLocaleString()})`,
        'all': `All (${(stats.total || 0).toLocaleString()})`,
        'verified': `Verified (${(stats.verified || 0).toLocaleString()})`,
    };
    for (const [value, text] of Object.entries(btnTexts)) {
        const btn = filterVerifiedGroup.querySelector(`[data-value="${value}"]`);
        if (btn) btn.textContent = text;
    }
}

function renderTable(rows) {
    bankTableBody.innerHTML = rows.map((r) => {
        const edited = pendingEdits.get(r.key);
        const valueVal = edited ? edited.value : r.value;
        const isVerified = edited ? edited.verified : r.verified;
        const valueEdited = edited && edited.value !== r.value ? ' edited' : '';
        if (!isSuper) {
            return `<tr>
                <td class="char-cell ${isVerified ? 'verified' : 'unverified'}" style="cursor:default;">${escapeHtml(r.key)}</td>
                <td class="value-cell">${escapeHtml(valueVal)}</td>
                <td style="text-align:center;">${r.used ? icon('check', { size: 16 }) : ''}</td>
                <td class="updated-cell">${formatDate(r.lastUpdated)}</td>
            </tr>`;
        }
        return `<tr data-key="${escapeHtml(r.key)}" data-original-verified="${r.verified}">
            <td class="char-cell ${isVerified ? 'verified' : 'unverified'}" data-field="verified">${escapeHtml(r.key)}</td>
            <td class="value-cell${valueEdited}">
                <input type="text" value="${escapeHtml(valueVal)}" data-field="value" data-original="${escapeHtml(r.value)}" />
            </td>
            <td style="text-align:center;">${r.used ? icon('check', { size: 16 }) : ''}</td>
            <td class="updated-cell">${formatDate(r.lastUpdated)}</td>
        </tr>`;
    }).join('');
}

function renderPagination() {
    const totalPages = Math.max(1, Math.ceil(totalCount / perPage));
    const unit = totalCount === 1 ? cfg.unitSingular : cfg.unitPlural;
    pageInfo.textContent = `Page ${currentPage} of ${totalPages} (${totalCount.toLocaleString()} ${unit})`;
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
    const key = tr.dataset.key;
    const existing = pendingEdits.get(key) || {};

    const valueInput = tr.querySelector('input[data-field="value"]');
    const valueOriginal = valueInput.dataset.original;
    const verifiedOriginal = tr.dataset.originalVerified === 'true';

    if (field === 'verified') {
        existing.verified = value;
        if (existing.value === undefined) existing.value = valueInput.value;
    } else {
        existing.value = value;
        if (existing.verified === undefined) {
            existing.verified = tr.querySelector('td.char-cell').classList.contains('verified');
        }
        const cell = valueInput.closest('td');
        if (value !== valueInput.dataset.original) {
            cell.classList.add('edited');
        } else {
            cell.classList.remove('edited');
        }
    }

    if (existing.value === valueOriginal && existing.verified === verifiedOriginal) {
        pendingEdits.delete(key);
    } else {
        pendingEdits.set(key, existing);
    }
    updateSaveBar();
}

async function saveChanges() {
    if (pendingEdits.size === 0) return;
    showError('');
    saveChangesBtn.disabled = true;
    saveChangesBtn.textContent = 'Saving...';

    const updates = [];
    for (const [key, edit] of pendingEdits) {
        updates.push({
            key,
            value: edit.value,
            verified: edit.verified,
        });
    }

    try {
        const res = await fetch(`${API_BASE}/chinese-bank`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ mode: MODE, updates }),
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

bankTableBody.addEventListener('input', (e) => {
    const input = e.target;
    if (input.dataset.field !== 'value') return;
    const tr = input.closest('tr');
    if (tr) handleFieldChange(tr, 'value', input.value);
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

if (window.SearchBar) {
    window.SearchBar.enhance(searchInput);
}
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

refreshUsedBtn.addEventListener('click', async () => {
    showError('');
    refreshUsedBtn.disabled = true;
    refreshUsedBtn.querySelector('.btn-label').textContent = 'Scanning...';
    try {
        const params = new URLSearchParams({ mode: MODE });
        const res = await fetch(`${API_BASE}/chinese-bank/refresh-used?${params}`, { method: 'POST' });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
            showError(data.error || 'Failed to refresh');
            return;
        }
        const lines = [];
        const diff = data.usedCount - data.prevUsedCount;
        lines.push(`Used: ${data.prevUsedCount} → ${data.usedCount} (${diff >= 0 ? '+' : ''}${diff})`);
        if (data.insertedKeys && data.insertedKeys.length > 0) {
            lines.push(`\nNew to bank (inserted): ${data.insertedKeys.join(' ')}`);
        }
        if (data.newlyUsed && data.newlyUsed.length > 0) {
            lines.push(`\nNewly used: ${data.newlyUsed.join(' ')}`);
        }
        if (data.newlyUnused && data.newlyUnused.length > 0) {
            lines.push(`\nNo longer used: ${data.newlyUnused.join(' ')}`);
        }
        if (!data.insertedKeys?.length && !data.newlyUsed?.length && !data.newlyUnused?.length) {
            lines.push('\nNo changes.');
        }
        alert(lines.join(''));
        await loadPage();
    } catch (err) {
        showError(err.message || 'Failed to refresh');
    } finally {
        refreshUsedBtn.disabled = false;
        refreshUsedBtn.querySelector('.btn-label').textContent = 'Refresh Used';
    }
});

function populateCsv() {
    const lines = currentPageRows.map((r) => {
        const edited = pendingEdits.get(r.key);
        const value = edited ? edited.value : r.value;
        return `${r.key},${value}`;
    });
    csvEditor.value = lines.join('\n');
}

function applyCsvPreview() {
    const lines = csvEditor.value.split('\n').filter((l) => l.trim());
    const originalByKey = {};
    for (const r of currentPageRows) {
        originalByKey[r.key] = r;
    }

    for (const line of lines) {
        const parts = line.split(',');
        if (parts.length < 2) continue;
        const key = parts[0].trim();
        const value = parts.slice(1).join(',').trim();
        const orig = originalByKey[key];
        if (!orig) continue;

        const existing = pendingEdits.get(key) || {};
        existing.value = value;
        existing.verified = true;
        if (value === orig.value && orig.verified === true) {
            pendingEdits.delete(key);
        } else {
            pendingEdits.set(key, existing);
        }
    }

    renderTable(currentPageRows);
    updateSaveBar();
}

const csvEditorSection = document.getElementById('csvEditorSection');

csvToggleBtn.addEventListener('click', () => {
    csvVisible = !csvVisible;
    csvEditorSection.classList.toggle('is-visible', csvVisible);
    csvToggleBtn.querySelector('.btn-label').textContent = csvVisible ? 'Hide CSV' : 'Show CSV';
    if (csvVisible) populateCsv();
});

csvCopyClearBtn.addEventListener('click', async () => {
    const text = csvEditor.value;
    if (!text) return;
    const labelEl = csvCopyClearBtn.querySelector('.btn-label');
    const originalLabel = labelEl.textContent;
    try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
            await navigator.clipboard.writeText(text);
        } else {
            csvEditor.select();
            document.execCommand('copy');
            csvEditor.setSelectionRange(0, 0);
        }
        csvEditor.value = '';
        labelEl.textContent = 'Copied';
    } catch (err) {
        showError(err.message || 'Failed to copy');
        return;
    }
    setTimeout(() => { labelEl.textContent = originalLabel; }, 1200);
});

csvPreviewBtn.addEventListener('click', () => {
    applyCsvPreview();
});

csvClearBtn.addEventListener('click', () => {
    pendingEdits.clear();
    populateCsv();
    renderTable(currentPageRows);
    updateSaveBar();
});

forceSyncBtn.addEventListener('click', async () => {
    if (!confirm('Re-generate back text for all cards matching verified bank entries?\nThis will update shared decks and all kid DBs.')) {
        return;
    }
    showError('');
    forceSyncBtn.disabled = true;
    forceSyncBtn.querySelector('.btn-label').textContent = 'Syncing...';
    try {
        const params = new URLSearchParams({ mode: MODE });
        const res = await fetch(`${API_BASE}/chinese-bank/force-sync-backs?${params}`, { method: 'POST' });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
            showError(data.error || 'Failed to sync');
            return;
        }
        const changes = data.changed || [];
        if (changes.length === 0) {
            alert(`All ${data.verified_count} verified ${cfg.unitPlural} already in sync. Nothing to update.`);
        } else {
            const lines = changes.map((c) =>
                `${c.key}: ${c.shared} shared card${c.shared !== 1 ? 's' : ''}, ${c.kid_dbs} kid DB${c.kid_dbs !== 1 ? 's' : ''}`
            );
            alert(`Updated ${changes.length} of ${data.verified_count} verified ${cfg.unitPlural}:\n\n${lines.join('\n')}`);
        }
    } catch (err) {
        showError(err.message || 'Failed to sync');
    } finally {
        forceSyncBtn.disabled = false;
        forceSyncBtn.querySelector('.btn-label').textContent = 'Force Sync Backs';
    }
});

applyModeChrome();
renderSortUpdatedTh();
loadPage();
