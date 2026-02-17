const API_BASE = `${window.location.origin}/api`;

const params = new URLSearchParams(window.location.search);
const kidId = params.get('id');
const sessionId = params.get('sessionId');

const pageTitle = document.getElementById('pageTitle');
const backBtn = document.getElementById('backBtn');
const errorMessage = document.getElementById('errorMessage');
const summaryGrid = document.getElementById('summaryGrid');
const rightList = document.getElementById('rightList');
const wrongList = document.getElementById('wrongList');
const rightTitle = document.getElementById('rightTitle');
const wrongTitle = document.getElementById('wrongTitle');

document.addEventListener('DOMContentLoaded', async () => {
    if (!kidId || !sessionId) {
        window.location.href = '/admin.html';
        return;
    }
    backBtn.href = `/kid-report.html?id=${encodeURIComponent(kidId)}`;
    await loadSessionDetail();
});

async function loadSessionDetail() {
    try {
        showError('');
        const response = await fetch(`${API_BASE}/kids/${kidId}/report/sessions/${sessionId}`);
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }

        const data = await response.json();
        const kidName = data.kid?.name || 'Kid';
        const session = data.session || {};
        pageTitle.textContent = `${kidName} · Session #${session.id || sessionId}`;
        rightTitle.textContent = `Right Cards (${(data.right_cards || []).length})`;
        wrongTitle.textContent = `Wrong Cards (${(data.wrong_cards || []).length})`;

        renderSummary(session);
        renderAnswerList(rightList, data.right_cards || [], true);
        renderAnswerList(wrongList, data.wrong_cards || [], false);
    } catch (error) {
        console.error('Error loading session detail:', error);
        showError('Failed to load session detail.');
    }
}

function renderSummary(session) {
    summaryGrid.innerHTML = `
        <div class="summary-card"><div class="label">Type</div><div class="value">${formatType(session.type)}</div></div>
        <div class="summary-card"><div class="label">Started</div><div class="value">${formatDateTime(session.started_at)}</div></div>
        <div class="summary-card"><div class="label">Answered</div><div class="value">${safeNum(session.answer_count)}</div></div>
    `;
}

function renderAnswerList(container, cards, isRight) {
    if (!Array.isArray(cards) || cards.length === 0) {
        container.innerHTML = `<div style="color:#666;font-size:0.86rem;">No ${isRight ? 'right' : 'wrong'} cards.</div>`;
        return;
    }

    const sorted = [...cards].sort((a, b) => {
        const aMs = Math.max(0, Number(a?.response_time_ms) || 0);
        const bMs = Math.max(0, Number(b?.response_time_ms) || 0);
        return bMs - aMs;
    });
    const maxMs = Math.max(...sorted.map((item) => Math.max(0, Number(item?.response_time_ms) || 0)), 1);

    container.innerHTML = sorted.map((item) => {
        const front = String(item.front || '').trim();
        const back = String(item.back || '').trim();
        const label = back || front || '(blank)';
        const rawMs = Math.max(0, Number(item.response_time_ms) || 0);
        const seconds = (rawMs / 1000).toFixed(2);
        const pct = Math.max(0, Math.min(100, (rawMs / maxMs) * 100));
        return `
            <div class="answer-item">
                <div>${escapeHtml(label)}</div>
                <div class="answer-bar-track">
                    <div class="answer-bar-fill ${isRight ? 'right' : 'wrong'}" style="width:${pct.toFixed(2)}%"></div>
                </div>
                <div class="meta">Card #${safeNum(item.card_id)} · ${seconds}s</div>
            </div>
        `;
    }).join('');
}

function formatType(type) {
    if (type === 'flashcard') return 'Chinese Characters';
    if (type === 'math') return 'Math';
    if (type === 'writing') return 'Chinese Writing';
    if (type === 'lesson_reading') return 'Lesson Reading';
    return String(type || '-');
}

function formatDateTime(iso) {
    if (!iso) return '-';
    const dt = new Date(String(iso).endsWith('Z') ? iso : `${iso}Z`);
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
