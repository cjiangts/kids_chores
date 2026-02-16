const API_BASE = `${window.location.origin}/api`;

const params = new URLSearchParams(window.location.search);
const kidId = params.get('id');
const sheetId = params.get('sheet');
const previewKey = params.get('previewKey');

const printBtn = document.getElementById('printBtn');
const sheetMeta = document.getElementById('sheetMeta');
const sheetContent = document.getElementById('sheetContent');

let currentSheet = null;
let isPreviewMode = false;

document.addEventListener('DOMContentLoaded', async () => {
    printBtn.addEventListener('click', async () => {
        await handlePrintClick();
    });
    await loadSheet();
});

async function loadSheet() {
    if (!kidId) {
        sheetContent.innerHTML = '<p class="error">Missing kid id.</p>';
        return;
    }

    if (previewKey) {
        loadPreviewSheet();
        return;
    }

    if (!sheetId) {
        sheetContent.innerHTML = '<p class="error">Missing sheet id.</p>';
        return;
    }

    try {
        const response = await fetch(`${API_BASE}/kids/${kidId}/writing/sheets/${sheetId}`);
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }
        currentSheet = await response.json();
        isPreviewMode = false;
        renderSheet(currentSheet);
    } catch (error) {
        console.error('Error loading sheet:', error);
        sheetContent.innerHTML = '<p class="error">Failed to load sheet.</p>';
    }
}

function loadPreviewSheet() {
    try {
        const raw = localStorage.getItem(previewKey);
        if (!raw) {
            sheetContent.innerHTML = '<p class="error">Preview expired. Please generate again.</p>';
            return;
        }
        const payload = JSON.parse(raw);
        if (!payload || String(payload.kidId) !== String(kidId) || !Array.isArray(payload.cards)) {
            sheetContent.innerHTML = '<p class="error">Invalid preview payload.</p>';
            return;
        }

        currentSheet = {
            id: null,
            created_at: payload.created_at || null,
            practice_rows: payload.rows_per_character || 1,
            cards: payload.cards
        };
        isPreviewMode = true;
        renderSheet(currentSheet);
    } catch (error) {
        console.error('Error loading preview payload:', error);
        sheetContent.innerHTML = '<p class="error">Failed to load preview.</p>';
    }
}

async function handlePrintClick() {
    if (!currentSheet || !Array.isArray(currentSheet.cards) || currentSheet.cards.length === 0) {
        return;
    }

    if (isPreviewMode) {
        printBtn.disabled = true;
        const originalLabel = printBtn.textContent;
        printBtn.textContent = 'Saving...';
        try {
            const response = await fetch(`${API_BASE}/kids/${kidId}/writing/sheets/finalize`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    rows_per_character: Number.parseInt(currentSheet.practice_rows, 10) || 1,
                    card_ids: currentSheet.cards.map((card) => Number(card.id))
                })
            });
            const payload = await response.json().catch(() => ({}));
            if (!response.ok) {
                throw new Error(payload.error || `HTTP ${response.status}`);
            }

            currentSheet.id = payload.sheet_id;
            currentSheet.created_at = new Date().toISOString();
            isPreviewMode = false;
            if (previewKey) {
                localStorage.removeItem(previewKey);
            }
            renderSheet(currentSheet);
            window.print();
        } catch (error) {
            console.error('Error finalizing preview sheet:', error);
            sheetContent.innerHTML = `<p class="error">${escapeHtml(error.message || 'Failed to save sheet before printing.')}</p>`;
        } finally {
            printBtn.disabled = false;
            printBtn.textContent = originalLabel;
        }
        return;
    }

    window.print();
}

function renderSheet(sheet) {
    const created = sheet.created_at ? new Date(sheet.created_at).toLocaleString() : '';
    const rowsPerCharacter = Math.max(1, Number.parseInt(sheet.practice_rows, 10) || 1);

    if (isPreviewMode) {
        sheetMeta.textContent = `Preview only · Not saved yet · Cards: ${sheet.cards.length}`;
    } else {
        sheetMeta.textContent = `Sheet #${sheet.id} · ${created} · Cards: ${sheet.cards.length}`;
    }

    if (!sheet.cards || sheet.cards.length === 0) {
        sheetContent.innerHTML = '<p>No cards in this sheet.</p>';
        return;
    }

    sheetContent.innerHTML = sheet.cards.map((card) => {
        const answer = getWritingCardDisplayFront(card);
        const chars = splitToPrintableChars(answer).slice(0, 10);
        const rows = Array.from({ length: rowsPerCharacter }, (_, idx) => renderPhraseRow(chars, idx === 0)).join('');
        return `
            <section class="sheet-item">
                ${rows}
            </section>
        `;
    }).join('');
}

function renderPhraseRow(chars, showDemoChars) {
    const cells = [];
    for (let i = 0; i < 10; i += 1) {
        if (showDemoChars && i < chars.length) {
            cells.push(`<div class="cell model"><span class="model-char">${escapeHtml(chars[i])}</span></div>`);
        } else {
            cells.push('<div class="cell"></div>');
        }
    }
    return `<div class="grid-row">${cells.join('')}</div>`;
}

function getWritingCardDisplayFront(card) {
    return String((card && (card.back || card.front)) || '');
}

function splitToPrintableChars(text) {
    return Array.from(String(text || ''));
}

function escapeHtml(value) {
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}
