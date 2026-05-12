// Chinese + math writing-sheet list loaders, renderers, and per-sheet actions.
//
// Layout:
//   1. Chinese writing mode: suggested-cards loader + chinese-sheets list + render
//   2. Math mode: print-config + build-info + math-sheets list + render
//   3. Sheet actions (shared): navigate to preview/print, mark-done, delete, reload

// =====================================================================
// === 1. Chinese writing mode: suggested cards + Chinese sheets list
// =====================================================================

async function loadSuggestedCards() {
    showError('');
    const response = await fetch(buildType2ApiUrl('/cards'));
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `Failed to load Chinese Writing cards (HTTP ${response.status})`);
    if (!Boolean(data.has_chinese_specific_logic)) throw new Error('This subject does not support printable Chinese writing sheets.');
    state2Cards = Array.isArray(data.practicing_cards) ? data.practicing_cards : [];
    updateBuildChineseSheetButton();
}

async function loadChineseSheets() {
    if (!sheetList) return;
    const response = await fetch(buildType2ApiUrl('/chinese-print-sheets'));
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `Failed to load sheets (HTTP ${response.status})`);
    renderChineseSheets(Array.isArray(data.sheets) ? data.sheets : []);
}

function renderChineseSheets(sheets) {
    if (!sheetList) return;
    if (!Array.isArray(sheets) || sheets.length === 0) {
        sheetList.innerHTML = '<article class="sheet-item"><p>No sheets yet.</p></article>';
        return;
    }
    const orderedSheets = [...sheets].sort((a, b) => {
        const createdDiff = parseTimestamp(b && b.created_at) - parseTimestamp(a && a.created_at);
        if (createdDiff !== 0) return createdDiff;
        return (Number.parseInt(b && b.id, 10) || 0) - (Number.parseInt(a && a.id, 10) || 0);
    });
    sheetList.innerHTML = orderedSheets.map((sheet) => {
        const sheetId = Number.parseInt(sheet && sheet.id, 10);
        const safeSheetId = Number.isInteger(sheetId) && sheetId > 0 ? sheetId : 0;
        const cardLabels = Array.isArray(sheet && sheet.card_labels) ? sheet.card_labels : [];
        const answersHtml = cardLabels.length > 0
            ? cardLabels.map((label) => `<span class="sheet-card-pill">${escapeHtml(label)}</span>`).join('')
            : '<span class="sheet-card-empty">(no cards)</span>';
        const isDone = String(sheet && sheet.status || '').trim().toLowerCase() === 'done';
        const isPending = !isDone;
        const statusClass = isDone ? 'done' : 'pending';
        const statusLabel = isDone ? 'done' : 'practicing';
        const printedDay = formatDate(sheet && sheet.created_at);
        const deleteBtnHtml = isPending ? `<button type="button" class="delete-btn" data-sheet-action="delete" data-sheet-id="${safeSheetId}">Delete</button>` : '';
        return `
            <article class="sheet-item">
                <div class="sheet-head"><div>Sheet #${safeSheetId}</div><div class="sheet-head-right"><span class="status ${statusClass}">${statusLabel}</span></div></div>
                <div class="sheet-meta">Printed: ${escapeHtml(printedDay)}</div>
                <div class="sheet-cards">${answersHtml}</div>
                <div class="sheet-actions ${isPending ? 'pending' : 'done'}">
                    <button type="button" class="print-btn" data-sheet-action="print" data-sheet-id="${safeSheetId}">Print</button>
                    ${isPending ? `<button type="button" class="done-btn" data-sheet-action="done" data-sheet-id="${safeSheetId}">Done</button>` : ''}
                    ${deleteBtnHtml}
                </div>
            </article>`;
    }).join('');
}

// =====================================================================
// === 2. Math mode: print-config + build-info + math-sheets list + render
// =====================================================================

async function loadMathPrintConfig() {
    const response = await fetch(buildType4ApiUrl('/print-config'));
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `Failed to load print config (HTTP ${response.status})`);
    canDesignMathCells = Boolean(data.can_design_cell);
    mathPrintConfigDecks = Array.isArray(data.decks) ? data.decks.filter((d) => d.opted_in) : [];
    cellDesigns.clear();
    mathPrintConfigDecks.forEach((deck) => {
        const raw = deck && deck.cell_design;
        if (!raw || typeof raw !== 'object') return;
        const cellWidth = Number.parseInt(raw.cell_width, 10);
        const cellHeight = Number.parseInt(raw.cell_height, 10);
        if (!Number.isFinite(cellWidth) || !Number.isFinite(cellHeight) || cellWidth <= 0 || cellHeight <= 0) return;
        const sampleProblem = raw.sample_problem && typeof raw.sample_problem === 'object'
            ? {
                prompt: String(raw.sample_problem.prompt || ''),
                answer: String(raw.sample_problem.answer || ''),
            }
            : null;
        cellDesigns.set(deck.shared_deck_id, {
            deckId: deck.shared_deck_id,
            deckName: deck.display_name || deck.name,
            cellWidth,
            cellHeight,
            contentOffsetX: Number.parseInt(raw.content_offset_x, 10) || 0,
            contentOffsetY: Number.parseInt(raw.content_offset_y, 10) || 0,
            canvasVersion: Number.parseInt(raw.canvas_version, 10) || CELL_DESIGN_CANVAS_VERSION,
            sampleProblem,
        });
    });
    updateBuildSheetButton();
}

function renderMathBuildInfo() {
    const totalDecks = mathPrintConfigDecks.length;
    const designedDecks = getDesignedMathDecks().length;
    const printableSummary = `${designedDecks} of ${totalDecks} opted-in deck${totalDecks === 1 ? '' : 's'} printable.`;
    const inlineSummary = `${totalDecks} opted-in deck${totalDecks === 1 ? '' : 's'} available to print inline.`;
    if (mathBuildInfoEl) {
        mathBuildInfoEl.textContent = '';
        mathBuildInfoEl.classList.add('hidden');
    }
    if (buildSheetBtn) {
        buildSheetBtn.innerHTML = `
            <span class="sheet-build-btn-title">Build Vertical Sheet</span>
            <span class="sheet-build-btn-meta">${escapeHtml(printableSummary)}</span>
        `;
    }
    if (buildInlineSheetBtn) {
        buildInlineSheetBtn.innerHTML = `
            <span class="sheet-build-btn-title">Build Inline Sheet</span>
            <span class="sheet-build-btn-meta">${escapeHtml(inlineSummary)}</span>
        `;
    }
}

async function loadMathSheets() {
    if (!sheetList) return;
    const response = await fetch(buildType4ApiUrl('/math-sheets'));
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `Failed to load math sheets (HTTP ${response.status})`);
    renderMathSheets(Array.isArray(data.sheets) ? data.sheets : []);
}

function renderMathSheets(sheets) {
    if (!sheetList) return;
    mathSheetsById = new Map();
    if (!Array.isArray(sheets) || sheets.length === 0) {
        sheetList.innerHTML = '<article class="sheet-item"><p>No sheets yet.</p></article>';
        return;
    }
    const orderedSheets = [...sheets].sort((a, b) => {
        const createdDiff = parseTimestamp(b && b.created_at) - parseTimestamp(a && a.created_at);
        if (createdDiff !== 0) return createdDiff;
        return (Number.parseInt(b && b.id, 10) || 0) - (Number.parseInt(a && a.id, 10) || 0);
    });
    orderedSheets.forEach((sheet) => {
        const sheetId = Number.parseInt(sheet && sheet.id, 10);
        if (Number.isInteger(sheetId) && sheetId > 0) {
            mathSheetsById.set(sheetId, sheet);
        }
    });
    sheetList.innerHTML = orderedSheets.map((sheet) => {
        const sheetId = Number.parseInt(sheet && sheet.id, 10);
        const safeSheetId = Number.isInteger(sheetId) && sheetId > 0 ? sheetId : 0;
        const status = String(sheet && sheet.status || '').trim().toLowerCase();
        const isPreview = status === 'preview';
        const isPending = status === 'pending';
        const isDone = status === 'done';
        const statusClass = isDone ? 'done' : (isPreview ? 'preview' : 'pending');
        const layoutKey = String(sheet && sheet.layout_format || '').trim().toLowerCase() === 'inline' ? 'inline' : 'vertical';
        const layoutLabel = layoutKey === 'inline' ? 'Inline' : 'Vertical';
        const layoutRows = Array.isArray(sheet && sheet.layout_rows) ? sheet.layout_rows : [];
        const cardTotals = new Map();
        layoutRows.forEach((row) => {
            const name = String(row && row.deck_name || 'Deck');
            const count = Number.parseInt(row && row.col_count, 10) || 0;
            cardTotals.set(name, (cardTotals.get(name) || 0) + count);
        });
        const rowPillsHtml = cardTotals.size > 0
            ? Array.from(cardTotals.entries()).map(([name, total]) =>
                `<span class="sheet-card-pill">${escapeHtml(name)}${total > 0 ? ` · ${total}` : ''}</span>`
            ).join('')
            : '<span class="sheet-card-empty">(no rows)</span>';
        const problemCount = Number.parseInt(sheet && sheet.problem_count, 10) || 0;
        const repeatCount = Math.max(
            1,
            Number.parseInt(sheet && (sheet.repeat_count ?? sheet.page_count), 10) || 1,
        );
        const cloneBtnHtml = `<button type="button" class="clone-btn" data-sheet-action="clone" data-sheet-id="${safeSheetId}">Clone</button>`;
        const incorrectCount = Number.isInteger(sheet && sheet.incorrect_count)
            ? Number(sheet.incorrect_count)
            : null;
        let actionBtns = '';
        if (isPreview) {
            actionBtns = `
                <button type="button" class="print-btn" data-sheet-action="print" data-sheet-id="${safeSheetId}">Preview</button>
                <button type="button" class="delete-btn" data-sheet-action="delete" data-sheet-id="${safeSheetId}">Delete</button>
                ${cloneBtnHtml}`;
        } else if (isPending) {
            actionBtns = `
                <button type="button" class="print-btn" data-sheet-action="print" data-sheet-id="${safeSheetId}">View</button>
                <button type="button" class="done-btn" data-sheet-action="done" data-sheet-id="${safeSheetId}">Done</button>
                <button type="button" class="delete-btn" data-sheet-action="delete" data-sheet-id="${safeSheetId}">Delete</button>
                ${cloneBtnHtml}`;
        } else if (isDone) {
            actionBtns = cloneBtnHtml;
        }
        const accuracyLine = (
            isDone
            && incorrectCount != null
            && problemCount > 0
        )
            ? `Incorrect: ${incorrectCount} / ${problemCount} · Correct rate: ${Math.round(((problemCount - incorrectCount) / problemCount) * 100)}%`
            : '';
        const printedDay = formatDate(sheet && sheet.created_at);
        const sheetMetaHtml = accuracyLine
            ? `Printed: ${escapeHtml(printedDay)}<br>${escapeHtml(accuracyLine)}`
            : `Printed: ${escapeHtml(printedDay)}`;
        return `
            <article class="sheet-item">
                <div class="sheet-head"><div class="sheet-head-left"><div>Sheet #${safeSheetId}</div><span class="sheet-layout-tag">${layoutLabel}</span><span class="sheet-problem-tag">${problemCount} problem${problemCount === 1 ? '' : 's'}</span><span class="sheet-repeat-tag">x${repeatCount}</span></div></div>
                <div class="sheet-meta">${sheetMetaHtml}</div>
                <div class="sheet-cards">${rowPillsHtml}</div>
                ${actionBtns ? `<div class="sheet-actions ${statusClass}">${actionBtns}</div>` : ''}
            </article>`;
    }).join('');
}

// =====================================================================
// === 3. Sheet actions (shared): navigate to preview/print, mark-done, delete, reload
// =====================================================================

function goToMathSheetPreview(sheetId) {
    const qs = new URLSearchParams();
    qs.set('id', String(kidId || ''));
    qs.set('sheet', String(sheetId || ''));
    qs.set('from', 'worksheets');
    if (activeCategoryKey) qs.set('categoryKey', activeCategoryKey);
    window.location.href = `/math-sheet-print.html?${qs.toString()}`;
}

function goToChineseSheetPrint(sheetId) {
    const qs = new URLSearchParams();
    qs.set('id', String(kidId || ''));
    qs.set('sheet', String(sheetId || ''));
    qs.set('from', 'worksheets');
    if (activeCategoryKey) qs.set('categoryKey', activeCategoryKey);
    window.location.href = `/writing-sheet-print.html?${qs.toString()}`;
}

async function markSheetDone(sheetId, extraBody) {
    const url = pageMode === 'math'
        ? buildType4ApiUrl(`/math-sheets/${sheetId}/complete`)
        : buildType2ApiUrl(`/chinese-print-sheets/${sheetId}/complete`);
    const body = Object.assign({}, extraBody || {});
    const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `Failed to mark sheet done (HTTP ${response.status})`);
}

async function deleteSheet(sheetId) {
    const url = pageMode === 'math'
        ? buildType4ApiUrl(`/math-sheets/${sheetId}/withdraw`)
        : buildType2ApiUrl(`/chinese-print-sheets/${sheetId}/withdraw`);
    const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `Failed to delete sheet (HTTP ${response.status})`);
}

async function reloadSheets() {
    if (pageMode === 'math') {
        await Promise.all([loadMathPrintConfig(), loadMathSheets()]);
    } else {
        await Promise.all([loadChineseSheets(), loadSuggestedCards()]);
    }
}
