const API_BASE = `${window.location.origin}/api`;

const params = new URLSearchParams(window.location.search);
const kidId = params.get('id');

const kidNameEl = document.getElementById('kidName');
const backBtn = document.getElementById('backBtn');
const errorMessage = document.getElementById('errorMessage');
const sheetList = document.getElementById('sheetList');

document.addEventListener('DOMContentLoaded', async () => {
    if (!kidId) {
        window.location.href = '/';
        return;
    }
    backBtn.href = `/kid-writing-manage.html?id=${kidId}`;
    await loadKid();
    await loadSheets();
});

async function loadKid() {
    try {
        const response = await fetch(`${API_BASE}/kids/${kidId}`);
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }
        const kid = await response.json();
        kidNameEl.textContent = `${kid.name}'s Writing Sheets (Parent View)`;
    } catch (error) {
        console.error('Error loading kid:', error);
    }
}

async function loadSheets() {
    try {
        showError('');
        const response = await fetch(`${API_BASE}/kids/${kidId}/writing/sheets`);
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }
        const data = await response.json();
        renderSheets(data.sheets || []);
    } catch (error) {
        console.error('Error loading sheets:', error);
        showError('Failed to load sheets');
    }
}

function renderSheets(sheets) {
    if (sheets.length === 0) {
        sheetList.innerHTML = `<div class="sheet-item"><p>No sheets yet.</p></div>`;
        return;
    }

    sheetList.innerHTML = sheets.map((sheet) => {
        const answers = sheet.cards.map((card) => card.back || card.front || '').join(' · ');
        const isDone = sheet.status === 'done';
        const isPending = sheet.status === 'pending';
        const statusClass = isDone ? 'done' : 'pending';
        const statusLabel = isDone ? 'done' : 'practicing';
        const printedDay = formatDate(sheet.created_at);
        const finishedDay = isDone ? formatDate(sheet.completed_at) : '-';
        const finishedIn = isDone ? formatDuration(sheet.created_at, sheet.completed_at) : '-';
        const doneBtn = isPending
            ? `<button class="done-btn" onclick="markDone(${sheet.id})">Mark Done</button>`
            : '';
        const printBtn = `<button class="print-btn" onclick="printSheet(${sheet.id})">Print</button>`;
        const withdrawBtn = isPending
            ? `<button class="withdraw-btn" onclick="withdrawSheet(${sheet.id})">Withdraw</button>`
            : '';

        return `
            <article class="sheet-item">
                <div class="sheet-head">
                    <div>Sheet #${sheet.id}</div>
                    <span class="status ${statusClass}">${statusLabel}</span>
                </div>
                <div class="sheet-meta">
                    Printed: ${printedDay}<br>
                    Finished: ${finishedDay}<br>
                    Time to finish: ${finishedIn}
                </div>
                <div class="sheet-cards">${answers || '(no cards)'}</div>
                ${doneBtn}
                ${printBtn}
                ${withdrawBtn}
            </article>
        `;
    }).join('');
}

async function markDone(sheetId) {
    try {
        const response = await fetch(`${API_BASE}/kids/${kidId}/writing/sheets/${sheetId}/complete`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({})
        });
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }
        await loadSheets();
    } catch (error) {
        console.error('Error marking sheet done:', error);
        showError('Failed to update sheet');
    }
}

async function withdrawSheet(sheetId) {
    if (!confirm('Withdraw this practicing sheet? Its cards will return to testing.')) {
        return;
    }

    try {
        const response = await fetch(`${API_BASE}/kids/${kidId}/writing/sheets/${sheetId}/withdraw`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({})
        });
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }
        await loadSheets();
    } catch (error) {
        console.error('Error withdrawing sheet:', error);
        showError('Failed to withdraw sheet');
    }
}

function printSheet(sheetId) {
    const url = `/writing-sheet-print.html?id=${encodeURIComponent(kidId)}&sheet=${encodeURIComponent(sheetId)}`;
    window.open(url, '_blank');
}

function showError(message) {
    if (message) {
        errorMessage.textContent = message;
        errorMessage.classList.remove('hidden');
    } else {
        errorMessage.classList.add('hidden');
    }
}

window.markDone = markDone;
window.withdrawSheet = withdrawSheet;
window.printSheet = printSheet;

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
