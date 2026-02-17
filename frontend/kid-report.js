const API_BASE = `${window.location.origin}/api`;

const params = new URLSearchParams(window.location.search);
const kidId = params.get('id');

const reportTitle = document.getElementById('reportTitle');
const errorMessage = document.getElementById('errorMessage');
const summaryGrid = document.getElementById('summaryGrid');
const reportBody = document.getElementById('reportBody');

document.addEventListener('DOMContentLoaded', async () => {
    if (!kidId) {
        window.location.href = '/admin.html';
        return;
    }
    await loadReport();
});

async function loadReport() {
    try {
        showError('');
        const response = await fetch(`${API_BASE}/kids/${kidId}/report`);
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }
        const data = await response.json();
        const kidName = (data.kid && data.kid.name) ? data.kid.name : 'Kid';
        const sessions = Array.isArray(data.sessions) ? data.sessions : [];
        reportTitle.textContent = `${kidName}'s Practice Report`;
        renderSummary(sessions);
        renderTable(sessions);
    } catch (error) {
        console.error('Error loading report:', error);
        showError('Failed to load practice report.');
    }
}

function renderSummary(sessions) {
    const total = sessions.length;
    const reading = sessions.filter((s) => s.type === 'flashcard').length;
    const math = sessions.filter((s) => s.type === 'math').length;
    const writing = sessions.filter((s) => s.type === 'writing').length;

    summaryGrid.innerHTML = `
        <div class="summary-card"><div class="label">Total Sessions</div><div class="value">${total}</div></div>
        <div class="summary-card"><div class="label">Chinese Reading</div><div class="value">${reading}</div></div>
        <div class="summary-card"><div class="label">Math</div><div class="value">${math}</div></div>
        <div class="summary-card"><div class="label">Chinese Writing</div><div class="value">${writing}</div></div>
    `;
}

function renderTable(sessions) {
    if (sessions.length === 0) {
        reportBody.innerHTML = `<tr><td colspan="9" style="color:#666;">No practice sessions yet.</td></tr>`;
        return;
    }

    reportBody.innerHTML = sessions.map((session) => `
        <tr>
            <td>#${safeNum(session.id)}</td>
            <td>${renderType(session.type)}</td>
            <td>${formatDateTime(session.started_at)}</td>
            <td>${formatDateTime(session.completed_at)}</td>
            <td>${safeNum(session.planned_count)}</td>
            <td>${safeNum(session.answer_count)}</td>
            <td>${safeNum(session.right_count)}</td>
            <td>${safeNum(session.wrong_count)}</td>
            <td>${Math.round(Number(session.avg_response_ms) || 0)}</td>
        </tr>
    `).join('');
}

function renderType(type) {
    if (type === 'flashcard') {
        return '<span class="type-pill type-reading">Chinese Reading</span>';
    }
    if (type === 'math') {
        return '<span class="type-pill type-math">Math</span>';
    }
    if (type === 'writing') {
        return '<span class="type-pill type-writing">Chinese Writing</span>';
    }
    return '<span class="type-pill">Unknown</span>';
}

function formatDateTime(iso) {
    if (!iso) return '-';
    const dt = new Date(iso);
    if (Number.isNaN(dt.getTime())) return '-';
    return dt.toLocaleString();
}

function safeNum(value) {
    const num = Number(value);
    return Number.isFinite(num) ? num : 0;
}

function showError(message) {
    if (message) {
        errorMessage.textContent = message;
        errorMessage.classList.remove('hidden');
    } else {
        errorMessage.classList.add('hidden');
    }
}
