const API_BASE = `${window.location.origin}/api`;

const params = new URLSearchParams(window.location.search);
const kidId = params.get('id');
const sheetId = params.get('sheet');

const printBtn = document.getElementById('printBtn');
const sheetMeta = document.getElementById('sheetMeta');
const sheetContent = document.getElementById('sheetContent');

document.addEventListener('DOMContentLoaded', async () => {
    printBtn.addEventListener('click', () => window.print());
    await loadSheet();
});

async function loadSheet() {
    if (!kidId || !sheetId) {
        sheetContent.innerHTML = '<p class="error">Missing kid or sheet id.</p>';
        return;
    }

    try {
        const response = await fetch(`${API_BASE}/kids/${kidId}/writing/sheets/${sheetId}`);
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }
        const sheet = await response.json();
        renderSheet(sheet);
        // Auto-open print dialog for one-click flow.
        setTimeout(() => window.print(), 250);
    } catch (error) {
        console.error('Error loading sheet:', error);
        sheetContent.innerHTML = '<p class="error">Failed to load sheet.</p>';
    }
}

function renderSheet(sheet) {
    const created = sheet.created_at ? new Date(sheet.created_at).toLocaleString() : '';
    sheetMeta.textContent = `Sheet #${sheet.id} · ${created} · Cards: ${sheet.cards.length}`;

    if (!sheet.cards || sheet.cards.length === 0) {
        sheetContent.innerHTML = '<p>No cards in this sheet.</p>';
        return;
    }

    sheetContent.innerHTML = sheet.cards.map((card) => {
        const answer = getWritingCardDisplayFront(card);
        const chars = splitToPrintableChars(answer);
        const rows = (chars.length > 0 ? chars : ['']).map((ch) => {
            const demoCell = `<div class="cell model">${escapeHtml(ch)}</div>`;
            const practiceCells = Array.from({ length: 9 }, () => '<div class="cell"></div>').join('');
            return `<div class="grid-row">${demoCell}${practiceCells}</div>`;
        }).join('');
        return `
            <section class="sheet-item">
                ${rows}
            </section>
        `;
    }).join('');
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
