const API_BASE = `${window.location.origin}/api`;

const params = new URLSearchParams(window.location.search);
const kidId = params.get('id');
const sessionId = params.get('sessionId');

const pageTitle = document.getElementById('pageTitle');
const backBtn = document.getElementById('backBtn');
const errorMessage = document.getElementById('errorMessage');
const summaryGrid = document.getElementById('summaryGrid');
const wrongSection = document.getElementById('wrongSection');
const rightSection = document.getElementById('rightSection');
const rightSectionTitle = document.getElementById('rightSectionTitle');
const wrongList = document.getElementById('wrongList');
const rightList = document.getElementById('rightList');
const {
    normalizeCategoryKey,
    normalizeBehaviorType,
} = window.DeckCategoryCommon;
let reportTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
let currentSessionType = '';
let currentSessionBehaviorType = '';
let currentSessionCategoryDisplayName = '';

document.addEventListener('DOMContentLoaded', async () => {
    if (!kidId || !sessionId) {
        window.location.href = '/admin.html';
        return;
    }
    backBtn.href = `/kid-report.html?id=${encodeURIComponent(kidId)}`;
    await loadReportTimezone();
    await loadSessionDetail();
});

async function loadReportTimezone() {
    try {
        const response = await fetch(`${API_BASE}/parent-settings/timezone`);
        if (!response.ok) {
            return;
        }
        const data = await response.json().catch(() => ({}));
        const tz = String(data.familyTimezone || '').trim();
        if (tz) {
            reportTimezone = tz;
        }
    } catch (error) {
        // Keep browser timezone.
    }
}

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
        currentSessionType = normalizeCategoryKey(session.type);
        currentSessionBehaviorType = normalizeBehaviorType(session.behavior_type);
        currentSessionCategoryDisplayName = String(session.category_display_name || '').trim();
        pageTitle.textContent = `${kidName} · Session #${session.id || sessionId}`;
        document.title = `${kidName} - Session #${session.id || sessionId} - Kids Daily Chores`;

        renderSummary(session);
        const answers = Array.isArray(data.answers) ? data.answers : [];
        if (isTypeIIIReviewSession()) {
            wrongSection.style.display = 'none';
            rightSection.style.display = '';
            rightSectionTitle.textContent = 'Cards';
            renderAnswerList(rightList, answers, false);
        } else {
            wrongSection.style.display = '';
            rightSection.style.display = '';
            rightSectionTitle.textContent = 'Right Cards';
            const wrongCards = answers.filter((item) => Number(item?.correct_score) < 0);
            const rightCards = answers.filter((item) => Number(item?.correct_score) > 0);
            renderAnswerList(wrongList, wrongCards, true);
            renderAnswerList(rightList, rightCards, true);
        }
    } catch (error) {
        console.error('Error loading session detail:', error);
        showError('Failed to load session detail.');
        document.title = 'Session Detail - Kids Daily Chores';
    }
}

function renderSummary(session) {
    summaryGrid.innerHTML = `
        <div class="summary-card"><div class="label">Type</div><div class="value">${formatType(session.type)}</div></div>
        <div class="summary-card"><div class="label">Started</div><div class="value">${formatDateTime(session.started_at)}</div></div>
        <div class="summary-card"><div class="label">Answered</div><div class="value">${safeNum(session.answer_count)}</div></div>
    `;
}

function renderAnswerList(container, cards, keepSingleGroupOrder) {
    if (!Array.isArray(cards) || cards.length === 0) {
        container.innerHTML = `<div style="color:#666;font-size:0.86rem;">No cards.</div>`;
        return;
    }

    const sorted = [...cards].sort((a, b) => {
        if (!keepSingleGroupOrder) {
            const aCorrect = Number(a?.correct_score) > 0 ? 1 : (Number(a?.correct_score) < 0 ? -1 : 0);
            const bCorrect = Number(b?.correct_score) > 0 ? 1 : (Number(b?.correct_score) < 0 ? -1 : 0);
            if (aCorrect !== bCorrect) {
                return aCorrect - bCorrect;
            }
        }
        const aMs = Math.max(0, Number(a?.response_time_ms) || 0);
        const bMs = Math.max(0, Number(b?.response_time_ms) || 0);
        return bMs - aMs;
    });
    const maxMs = Math.max(...sorted.map((item) => Math.max(0, Number(item?.response_time_ms) || 0)), 1);

    container.innerHTML = sorted.map((item) => {
        const isRight = Number(item?.correct_score) > 0;
        const front = String(item.front || '').trim();
        const back = String(item.back || '').trim();
        const label = getCardDisplayLabel(front, back, currentSessionType) || '(blank)';
        const rawMs = Math.max(0, Number(item.response_time_ms) || 0);
        const responseTimeLabel = formatResponseTime(rawMs);
        const pct = Math.max(0, Math.min(100, (rawMs / maxMs) * 100));
        const lessonReadingAudioAttrs = isTypeIIIReviewSession()
            ? ` data-result-id="${Number.isFinite(Number(item.result_id)) ? Number(item.result_id) : ''}" data-response-time-ms="${rawMs}"`
            : '';
        const audioHtml = item.audio_url
            ? `<audio class="attempt-audio" controls preload="none" src="${escapeHtml(item.audio_url)}"${lessonReadingAudioAttrs}></audio>`
            : '';
        const gradingHtml = renderGradingControls(item);
        const from = getCardReportFromSessionType(currentSessionType);
        const canLink = !!from && Number.isFinite(Number(item.card_id));
        const reportLinkParams = new URLSearchParams();
        reportLinkParams.set('id', String(kidId || ''));
        reportLinkParams.set('cardId', String(item.card_id || ''));
        reportLinkParams.set('from', String(from || ''));
        if (currentSessionType) {
            reportLinkParams.set('categoryKey', String(currentSessionType));
        }
        const reportLinkHtml = canLink
            ? `<a class="tab-link secondary mini-link-btn" href="/kid-card-report.html?${reportLinkParams.toString()}">Report</a>`
            : '';
        return `
            <div class="answer-item">
                <div>${escapeHtml(label)}</div>
                <div class="answer-bar-track">
                    <div class="answer-bar-fill ${isRight ? 'right' : 'wrong'}" style="width:${pct.toFixed(2)}%"></div>
                </div>
                <div class="meta">Card #${safeNum(item.card_id)} · ${responseTimeLabel}</div>
                ${reportLinkHtml}
                ${audioHtml}
                ${gradingHtml}
            </div>
        `;
    }).join('');

    if (isTypeIIIReviewSession() && window.LessonReadingDurationBackfill) {
        window.LessonReadingDurationBackfill.attach(container, { kidId });
    }
}

function formatResponseTime(ms) {
    const rawMs = Math.max(0, Number(ms) || 0);
    if (normalizeBehaviorType(currentSessionBehaviorType) === 'type_iii') {
        const totalSeconds = Math.floor(rawMs / 1000);
        const minutes = Math.floor(totalSeconds / 60);
        const seconds = totalSeconds % 60;
        return `${minutes}:${String(seconds).padStart(2, '0')}`;
    }
    return `${(rawMs / 1000).toFixed(2)}s`;
}

function renderGradingControls(item) {
    if (!isTypeIIIReviewSession()) {
        return '';
    }
    const resultId = Number(item?.result_id);
    if (!Number.isFinite(resultId)) {
        return '';
    }
    const grade = String(item?.grade_status || '').toLowerCase();
    if (grade === 'pass' || grade === 'fail') {
        const label = grade === 'pass' ? 'Status: Pass' : 'Status: Fail';
        return `<div class="grade-status ${grade}">${label}</div>`;
    }
    return `
        <div class="grade-row">
            <button class="grade-btn" data-result-id="${resultId}" data-grade="pass">Pass</button>
            <button class="grade-btn" data-result-id="${resultId}" data-grade="fail">Fail</button>
        </div>
    `;
}

function renderGradeStatusHtml(grade) {
    const normalized = String(grade || '').toLowerCase();
    if (normalized !== 'pass' && normalized !== 'fail') {
        return '';
    }
    const label = normalized === 'pass' ? 'Status: Pass' : 'Status: Fail';
    return `<div class="grade-status ${normalized}">${label}</div>`;
}

async function saveGrade(resultId, reviewGrade) {
    const response = await fetch(`${API_BASE}/kids/${kidId}/report/sessions/${sessionId}/results/${resultId}/grade`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reviewGrade }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
        throw new Error(payload.error || `HTTP ${response.status}`);
    }
    return payload;
}

document.addEventListener('click', async (event) => {
    const btn = event.target && event.target.closest ? event.target.closest('.grade-btn') : null;
    if (!btn) {
        return;
    }
    const resultId = Number(btn.getAttribute('data-result-id'));
    const reviewGrade = String(btn.getAttribute('data-grade') || '').toLowerCase();
    if (!Number.isFinite(resultId) || (reviewGrade !== 'pass' && reviewGrade !== 'fail')) {
        return;
    }

    const buttons = document.querySelectorAll(`.grade-btn[data-result-id="${resultId}"]`);
    buttons.forEach((node) => { node.disabled = true; });
    showError('');
    try {
        const saved = await saveGrade(resultId, reviewGrade);
        buttons.forEach((node) => {
            const nodeGrade = String(node.getAttribute('data-grade') || '').toLowerCase();
            node.classList.toggle('active-pass', nodeGrade === 'pass' && saved.grade_status === 'pass');
            node.classList.toggle('active-fail', nodeGrade === 'fail' && saved.grade_status === 'fail');
        });

        const item = btn.closest('.answer-item');
        if (item) {
            const gradeRow = item.querySelector('.grade-row');
            const replacement = renderGradeStatusHtml(saved.grade_status);
            if (gradeRow && replacement) {
                gradeRow.outerHTML = replacement;
            } else if (replacement) {
                item.insertAdjacentHTML('beforeend', replacement);
            }
        }
    } catch (error) {
        console.error('Error saving grade:', error);
        showError(error.message || 'Failed to save grade.');
    } finally {
        buttons.forEach((node) => { node.disabled = false; });
    }
});

function getCardReportFromSessionType(type) {
    const behavior = normalizeBehaviorType(currentSessionBehaviorType);
    if (behavior === 'type_ii') return 'type2';
    if (behavior === 'type_iii') return 'lesson-reading';
    if (behavior === 'type_i') return 'cards';
    return '';
}

function getCardDisplayLabel(front, back, sessionType) {
    const normalizedBehavior = normalizeBehaviorType(currentSessionBehaviorType);
    if (normalizedBehavior === 'type_iii') {
        return front || back;
    }
    if (normalizedBehavior === 'type_ii') {
        return back || front;
    }
    return front || back;
}

function formatType(type) {
    return currentSessionCategoryDisplayName;
}

function isTypeIIIReviewSession() {
    return normalizeBehaviorType(currentSessionBehaviorType) === 'type_iii';
}

function formatDateTime(iso) {
    const dt = parseUtcTimestamp(iso);
    if (Number.isNaN(dt.getTime())) return '-';
    return dt.toLocaleString(undefined, {
        timeZone: reportTimezone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
    });
}

function parseUtcTimestamp(raw) {
    if (!raw) return new Date(NaN);
    const text = String(raw).trim();
    if (!text) return new Date(NaN);
    const hasZone = /(?:Z|[+\-]\d{2}:\d{2})$/.test(text);
    return new Date(hasZone ? text : `${text}Z`);
}

function safeNum(value) {
    const num = Number(value);
    return Number.isFinite(num) ? num : 0;
}

function showError(message) {
    if (message) {
        const text = String(message);
        if (errorMessage) {
            errorMessage.textContent = '';
            errorMessage.classList.add('hidden');
        }
        if (showError._lastMessage !== text) {
            window.alert(text);
            showError._lastMessage = text;
        }
    } else {
        showError._lastMessage = '';
        if (errorMessage) {
            errorMessage.classList.add('hidden');
        }
    }
}
