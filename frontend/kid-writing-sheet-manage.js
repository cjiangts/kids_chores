const API_BASE = `${window.location.origin}/api`;

const params = new URLSearchParams(window.location.search);
const kidId = String(params.get('id') || '').trim();
const requestedCategoryKey = String(params.get('categoryKey') || '').trim().toLowerCase();

const WRITING_SHEET_MAX_ROWS = 10;

const pageTitleEl = document.getElementById('pageTitle');
const pageSubtitleEl = document.getElementById('pageSubtitle');
const categoryLabelEl = document.getElementById('categoryLabel');
const backBtn = document.getElementById('backBtn');
const errorMessage = document.getElementById('errorMessage');

const practicingDeckCount = document.getElementById('practicingDeckCount');
const practicingDeckGrid = document.getElementById('practicingDeckGrid');
const practicingDeckEmpty = document.getElementById('practicingDeckEmpty');
const sheetList = document.getElementById('sheetList');

const sheetCardCountInput = document.getElementById('sheetCardCount');
const sheetRowsPerCharInput = document.getElementById('sheetRowsPerChar');
const createSheetBtn = document.getElementById('createSheetBtn');
const sheetErrorMessage = document.getElementById('sheetErrorMessage');

let activeCategoryKey = requestedCategoryKey;
let activeCategoryDisplayName = 'Chinese Writing';
let activeKidName = '';
let state2Cards = [];

function escapeHtml(text) {
    return String(text || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function buildType2ApiUrl(path) {
    return window.DeckCategoryCommon.buildType2ApiUrl({
        kidId,
        path,
        categoryKey: activeCategoryKey,
        apiBase: API_BASE,
    });
}

function showError(message) {
    const text = String(message || '').trim();
    if (!errorMessage) {
        return;
    }
    if (!text) {
        errorMessage.textContent = '';
        errorMessage.classList.add('hidden');
        return;
    }
    errorMessage.textContent = text;
    errorMessage.classList.remove('hidden');
}

function showSheetError(message) {
    const text = String(message || '').trim();
    if (!sheetErrorMessage) {
        return;
    }
    if (!text) {
        sheetErrorMessage.textContent = '';
        sheetErrorMessage.classList.add('hidden');
        return;
    }
    sheetErrorMessage.textContent = text;
    sheetErrorMessage.classList.remove('hidden');
}

function updatePageText() {
    const displayName = String(activeCategoryDisplayName || 'Chinese Writing').trim() || 'Chinese Writing';
    const kidName = String(activeKidName || '').trim();
    if (kidName) {
        if (pageSubtitleEl) {
            pageSubtitleEl.textContent = `${kidName} · ${displayName}`;
        }
        document.title = `${kidName} - Printable work sheets (${displayName}) - Kids Daily Chores`;
    } else {
        if (pageSubtitleEl) {
            pageSubtitleEl.textContent = displayName;
        }
        document.title = `Printable work sheets (${displayName}) - Kids Daily Chores`;
    }
    if (pageTitleEl) {
        pageTitleEl.textContent = 'Printable work sheets (Chinese Writing)';
    }
    if (categoryLabelEl) {
        categoryLabelEl.textContent = `Category: ${displayName}`;
    }
}

function getType2ChineseCategoryKey(kid) {
    const normalizeCategoryKey = window.DeckCategoryCommon.normalizeCategoryKey;
    const optedInKeys = window.DeckCategoryCommon.getOptedInDeckCategoryKeys(kid);
    const categoryMetaMap = window.DeckCategoryCommon.getDeckCategoryMetaMap(kid);
    const matchingKeys = optedInKeys.filter((categoryKey) => {
        const meta = categoryMetaMap?.[categoryKey] || {};
        return String(meta.behavior_type || '').trim().toLowerCase() === 'type_ii'
            && Boolean(meta.has_chinese_specific_logic);
    });
    if (matchingKeys.length <= 0) {
        return '';
    }
    const preferred = normalizeCategoryKey(requestedCategoryKey);
    if (preferred && matchingKeys.includes(preferred)) {
        return preferred;
    }
    return matchingKeys[0];
}

async function loadKidInfo() {
    const response = await fetch(`${API_BASE}/kids/${encodeURIComponent(kidId)}`);
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
        throw new Error(payload.error || `Failed to load kid (HTTP ${response.status})`);
    }
    const kid = payload;
    const resolvedCategoryKey = getType2ChineseCategoryKey(kid);
    if (!resolvedCategoryKey) {
        throw new Error('Chinese Writing is not opted in for this kid.');
    }
    activeCategoryKey = resolvedCategoryKey;
    activeKidName = String(kid?.name || '').trim();

    const categoryMetaMap = window.DeckCategoryCommon.getDeckCategoryMetaMap(kid);
    activeCategoryDisplayName = window.DeckCategoryCommon.getCategoryDisplayName(activeCategoryKey, categoryMetaMap)
        || 'Chinese Writing';

    updatePageText();
    if (backBtn) {
        backBtn.href = '/admin.html';
    }
}

function applySuggestedType2SheetInputs() {
    if (!sheetCardCountInput || !sheetRowsPerCharInput) {
        return;
    }
    const candidateCount = Number(state2Cards.length || 0);
    if (candidateCount <= 0) {
        sheetCardCountInput.value = '1';
        sheetRowsPerCharInput.value = '1';
        return;
    }
    const suggestedCards = Math.max(1, Math.min(WRITING_SHEET_MAX_ROWS, candidateCount));
    const suggestedRows = Math.max(1, Math.floor(WRITING_SHEET_MAX_ROWS / suggestedCards));
    sheetCardCountInput.value = String(suggestedCards);
    sheetRowsPerCharInput.value = String(suggestedRows);
}

function renderSuggestedCards() {
    if (!practicingDeckGrid || !practicingDeckEmpty) {
        return;
    }

    const cards = [...state2Cards];
    if (practicingDeckCount) {
        practicingDeckCount.textContent = `(${cards.length})`;
    }
    if (cards.length === 0) {
        practicingDeckGrid.innerHTML = '';
        practicingDeckEmpty.textContent = 'No suggested candidate cards.';
        practicingDeckEmpty.classList.remove('hidden');
        return;
    }

    practicingDeckEmpty.classList.add('hidden');
    const neverSeenLabels = [];
    const lastFailedLabels = [];
    const otherLabels = [];

    cards.forEach((card) => {
        const label = String(card.back || card.front || '').trim();
        if (!label) {
            return;
        }
        const reason = String(card.practicing_reason || '').trim();
        if (reason === 'never_seen') {
            neverSeenLabels.push(label);
            return;
        }
        if (reason === 'last_failed') {
            lastFailedLabels.push(label);
            return;
        }
        otherLabels.push(label);
    });

    const renderBucketRow = (title, labels) => {
        const safeLabels = Array.isArray(labels)
            ? labels.map((item) => String(item || '').trim()).filter(Boolean)
            : [];
        const pillsHtml = safeLabels.length > 0
            ? safeLabels.map((label) => `<span class="suggested-card-pill">${escapeHtml(label)}</span>`).join('')
            : '<span class="suggested-card-empty">No cards.</span>';
        return `
            <div class="suggested-card-row">
                <span class="suggested-card-row-label">${escapeHtml(title)}:</span>
                <div class="suggested-card-pill-list">${pillsHtml}</div>
            </div>
        `;
    };

    const rows = [
        renderBucketRow(`Newly added (${neverSeenLabels.length})`, neverSeenLabels),
        renderBucketRow(`Last failed (${lastFailedLabels.length})`, lastFailedLabels),
    ];
    if (otherLabels.length > 0) {
        rows.push(renderBucketRow(`Other (${otherLabels.length})`, otherLabels));
    }
    practicingDeckGrid.innerHTML = rows.join('');
}

async function loadSuggestedCards() {
    showError('');
    const response = await fetch(buildType2ApiUrl('/cards'));
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
        throw new Error(data.error || `Failed to load Chinese Writing cards (HTTP ${response.status})`);
    }
    if (!Boolean(data.has_chinese_specific_logic)) {
        throw new Error('This category does not support printable Chinese writing sheets.');
    }

    state2Cards = Array.isArray(data.practicing_cards) ? data.practicing_cards : [];
    renderSuggestedCards();
    applySuggestedType2SheetInputs();
}

async function loadSheets() {
    if (!sheetList) {
        return;
    }
    const response = await fetch(buildType2ApiUrl('/sheets'));
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
        throw new Error(data.error || `Failed to load sheets (HTTP ${response.status})`);
    }
    renderSheets(Array.isArray(data.sheets) ? data.sheets : []);
}

function renderSheets(sheets) {
    if (!sheetList) {
        return;
    }
    if (!Array.isArray(sheets) || sheets.length === 0) {
        sheetList.innerHTML = '<article class="sheet-item"><p>No sheets yet.</p></article>';
        return;
    }

    sheetList.innerHTML = sheets.map((sheet) => {
        const sheetId = Number.parseInt(sheet && sheet.id, 10);
        const safeSheetId = Number.isInteger(sheetId) && sheetId > 0 ? sheetId : 0;
        const cards = Array.isArray(sheet && sheet.cards) ? sheet.cards : [];
        const answers = cards.map((card) => String(card && (card.back || card.front) || '').trim()).filter(Boolean).join(' · ');
        const isDone = String(sheet && sheet.status || '').trim().toLowerCase() === 'done';
        const isPending = !isDone;
        const statusClass = isDone ? 'done' : 'pending';
        const statusLabel = isDone ? 'done' : 'practicing';
        const printedDay = formatDate(sheet && sheet.created_at);
        const finishedDay = isDone ? formatDate(sheet && sheet.completed_at) : '-';
        const finishedIn = isDone ? formatDuration(sheet && sheet.created_at, sheet && sheet.completed_at) : '-';

        return `
            <article class="sheet-item">
                <div class="sheet-head">
                    <div>Sheet #${safeSheetId}</div>
                    <span class="status ${statusClass}">${statusLabel}</span>
                </div>
                <div class="sheet-meta">
                    Printed: ${escapeHtml(printedDay)}<br>
                    Finished: ${escapeHtml(finishedDay)}<br>
                    Time to finish: ${escapeHtml(finishedIn)}
                </div>
                <div class="sheet-cards">${escapeHtml(answers || '(no cards)')}</div>
                <div class="sheet-actions">
                    <button type="button" class="print-btn" data-sheet-action="print" data-sheet-id="${safeSheetId}">Print</button>
                    ${isPending ? `<button type="button" class="done-btn" data-sheet-action="done" data-sheet-id="${safeSheetId}">Mark Done</button>` : ''}
                    ${isPending ? `<button type="button" class="delete-btn" data-sheet-action="delete" data-sheet-id="${safeSheetId}">Delete</button>` : ''}
                </div>
            </article>
        `;
    }).join('');
}

function formatDate(value) {
    if (!value) {
        return '-';
    }
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
        return '-';
    }
    return date.toLocaleString();
}

function formatDuration(start, end) {
    if (!start || !end) {
        return '-';
    }
    const startMs = new Date(start).getTime();
    const endMs = new Date(end).getTime();
    if (Number.isNaN(startMs) || Number.isNaN(endMs) || endMs < startMs) {
        return '-';
    }
    const totalMinutes = Math.round((endMs - startMs) / 60000);
    const days = Math.floor(totalMinutes / (60 * 24));
    const hours = Math.floor((totalMinutes % (60 * 24)) / 60);
    const minutes = totalMinutes % 60;
    if (days > 0) {
        return `${days}d ${hours}h ${minutes}m`;
    }
    if (hours > 0) {
        return `${hours}h ${minutes}m`;
    }
    return `${minutes}m`;
}

function goToSheetPrint(sheetId) {
    const qs = new URLSearchParams();
    qs.set('id', String(kidId || ''));
    qs.set('sheet', String(sheetId || ''));
    qs.set('from', 'worksheets');
    if (activeCategoryKey) {
        qs.set('categoryKey', activeCategoryKey);
    }
    window.location.href = `/writing-sheet-print.html?${qs.toString()}`;
}

async function markSheetDone(sheetId) {
    const response = await fetch(buildType2ApiUrl(`/sheets/${sheetId}/complete`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
        throw new Error(payload.error || `Failed to mark sheet done (HTTP ${response.status})`);
    }
}

async function deleteSheet(sheetId) {
    const response = await fetch(buildType2ApiUrl(`/sheets/${sheetId}/withdraw`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
        throw new Error(payload.error || `Failed to delete sheet (HTTP ${response.status})`);
    }
}

async function createType2ChineseSheet() {
    try {
        showSheetError('');
        const count = Number.parseInt(sheetCardCountInput ? sheetCardCountInput.value : '', 10);
        const rowsPerCharacter = Number.parseInt(sheetRowsPerCharInput ? sheetRowsPerCharInput.value : '', 10);

        if (!Number.isInteger(count) || count < 1 || count > 200) {
            showSheetError('Cards per sheet must be between 1 and 200.');
            return;
        }
        if (!Number.isInteger(rowsPerCharacter) || rowsPerCharacter < 1 || rowsPerCharacter > 10) {
            showSheetError('Rows per card must be between 1 and 10.');
            return;
        }
        if (count * rowsPerCharacter > WRITING_SHEET_MAX_ROWS) {
            const maxCards = Math.max(1, Math.floor(WRITING_SHEET_MAX_ROWS / rowsPerCharacter));
            showSheetError(`One page max is ${WRITING_SHEET_MAX_ROWS} rows. With ${rowsPerCharacter} row(s) per card, max cards is ${maxCards}.`);
            return;
        }

        const response = await fetch(buildType2ApiUrl('/sheets'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                count,
                rows_per_character: rowsPerCharacter,
                categoryKey: activeCategoryKey,
            }),
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok) {
            throw new Error(result.error || `HTTP ${response.status}`);
        }
        if (!result.created || !Array.isArray(result.cards) || result.cards.length === 0) {
            showSheetError(result.message || 'No eligible cards to print right now.');
            return;
        }
        await Promise.all([loadSheets(), loadSuggestedCards()]);
    } catch (error) {
        console.error('Error generating Chinese writing sheet:', error);
        showSheetError(error.message || 'Failed to generate practice sheet.');
    }
}

document.addEventListener('DOMContentLoaded', async () => {
    if (!kidId) {
        window.location.href = '/admin.html';
        return;
    }

    if (createSheetBtn) {
        createSheetBtn.addEventListener('click', async () => {
            await createType2ChineseSheet();
        });
    }
    if (sheetList) {
        sheetList.addEventListener('click', async (event) => {
            const button = event.target.closest('button[data-sheet-action]');
            if (!button) {
                return;
            }
            const action = String(button.getAttribute('data-sheet-action') || '').trim().toLowerCase();
            const sheetId = Number.parseInt(button.getAttribute('data-sheet-id') || '', 10);
            if (!Number.isInteger(sheetId) || sheetId <= 0) {
                return;
            }
            try {
                showError('');
                if (action === 'print') {
                    goToSheetPrint(sheetId);
                    return;
                }
                if (action === 'done') {
                    await markSheetDone(sheetId);
                } else if (action === 'delete') {
                    await deleteSheet(sheetId);
                } else {
                    return;
                }
                await Promise.all([loadSheets(), loadSuggestedCards()]);
            } catch (error) {
                console.error('Error updating sheet:', error);
                showError(error.message || 'Failed to update sheet.');
            }
        });
    }

    try {
        await loadKidInfo();
        await Promise.all([loadSuggestedCards(), loadSheets()]);
    } catch (error) {
        console.error('Error loading worksheet manage page:', error);
        showError(error.message || 'Failed to load printable worksheets page.');
    }
});
