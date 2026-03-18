const API_BASE = `${window.location.origin}/api`;

const sheetTitle = document.getElementById('sheetTitle');
const printHeader = document.getElementById('printHeader');
const sheetMeta = document.getElementById('sheetMeta');
const sheetContent = document.getElementById('sheetContent');
const showAnswersBtn = document.getElementById('showAnswersBtn');
const regenerateBtn = document.getElementById('regenerateBtn');
const finalizeBtn = document.getElementById('finalizeBtn');
const printBtn = document.getElementById('printBtn');
const backBtn = document.getElementById('backBtn');

const params = new URLSearchParams(window.location.search);
const deckId = parseInt(params.get('deckId') || '0', 10);
const mode = (params.get('mode') || 'horizontal').toLowerCase();
const verticalAnswerRows = Math.max(0.1, Math.min(10, parseFloat(params.get('answerRows') || '2') || 2));
const paramSeedBase = params.get('seedBase') ? parseInt(params.get('seedBase'), 10) : null;
const paramCount = params.get('count') ? parseInt(params.get('count'), 10) : null;
const fromContext = (params.get('from') || '').toLowerCase();
const isFromManage = fromContext === 'worksheets';
const paramSheetId = params.get('sheetId') ? parseInt(params.get('sheetId'), 10) : null;
const paramKidId = params.get('kidId') || '';
const paramKidName = params.get('kidName') || '';
const paramCategoryKey = params.get('categoryKey') || '';
let sheetStatus = (params.get('status') || '').toLowerCase();

let isShowingAnswers = false;

/*
 * A4 at 96 DPI: 794 × 1123 px.  5mm margins ≈ 19px each side → 756 × 1085.
 * Apply 0.90 safety factor so content never spills to a second page.
 */
const A4_CONTENT_W_PX = Math.floor((794 - 38) * 0.90);
const A4_CONTENT_H_PX = Math.floor((1123 - 38) * 0.85);

function escapeHtml(text) {
    const el = document.createElement('span');
    el.textContent = text;
    return el.innerHTML;
}

function goBack() {
    if (window.history.length > 1) {
        window.history.back();
    } else {
        window.location.href = deckId ? `/deck-view.html?deckId=${deckId}` : '/deck-manage.html';
    }
}

async function fetchJson(url, opts) {
    const response = await fetch(url, opts);
    if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.error || `HTTP ${response.status}`);
    }
    return response.json();
}

/* ── Prompt parsing for vertical mode ── */

const OPERATOR_PATTERN = /^(.+?)\s*([+\-×x*÷\/])\s*(.+?)(?:\s*=\s*[?？_\s]*)?\s*$/;

function parseArithmetic(prompt) {
    const m = prompt.match(OPERATOR_PATTERN);
    if (!m) return null;
    const a = m[1].trim();
    const rawOp = m[2];
    const b = m[3].trim();
    if (!a || !b) return null;
    let sign = rawOp;
    if (rawOp === '*' || rawOp === 'x') sign = '×';
    if (rawOp === '/' || rawOp === '÷') sign = '÷';
    return { a, sign, b };
}

/* ── Measure actual rendered cell size ── */

function measureCellSize(sampleHtml) {
    const wrapper = document.createElement('div');
    wrapper.style.cssText = 'position:absolute;left:-9999px;top:-9999px;visibility:hidden;';
    wrapper.innerHTML = sampleHtml;
    document.body.appendChild(wrapper);
    const cell = wrapper.firstElementChild;
    const w = cell.offsetWidth;
    const h = cell.offsetHeight;
    document.body.removeChild(wrapper);
    return { w, h };
}

function findWorstCaseHorizontalCell(problems) {
    let longest = problems[0];
    let maxLen = 0;
    for (const p of problems) {
        const display = p.prompt.replace(/\s*=\s*[?？_\s]*$/, '').trim() + ' =';
        if (display.length > maxLen) {
            maxLen = display.length;
            longest = p;
        }
    }
    return longest;
}

function findWorstCaseVerticalCell(problems) {
    let widest = problems[0];
    let maxW = 0;
    for (const p of problems) {
        const parsed = parseArithmetic(p.prompt);
        let w = p.answer.length;
        if (parsed) {
            if (parsed.sign === '÷') {
                /* Long division: divisor + bracket + dividend */
                w = Math.max(w, parsed.b.length + 1 + parsed.a.length);
            } else {
                w = Math.max(w, parsed.a.length, parsed.b.length + 2);
            }
        }
        if (w > maxW) {
            maxW = w;
            widest = p;
        }
    }
    return widest;
}

function computeLayout(sampleProblems, renderCell, findWorstCase) {
    const worstCase = findWorstCase(sampleProblems);
    const html = renderCell(worstCase);
    const { w, h } = measureCellSize(html);
    const COLUMN_GAP_PX = 24;
    const cellW = w;
    const cellH = h + 2;
    const cols = Math.max(1, Math.floor((A4_CONTENT_W_PX + COLUMN_GAP_PX) / (cellW + COLUMN_GAP_PX)));
    const rows = Math.max(1, Math.floor(A4_CONTENT_H_PX / cellH));
    return { cols, rows };
}

/* ── Render: horizontal mode ── */

function renderHorizontalCell(p) {
    const display = p.prompt.replace(/\s*=\s*[?？_\s]*$/, '').trim() + ' =';
    return `<div class="math-cell-h">
        <span class="cell-prompt">${escapeHtml(display)}</span>
        <span class="cell-answer">${escapeHtml(p.answer)}</span>
    </div>`;
}

/* ── Render: vertical mode ── */

function renderVerticalCell(p) {
    const parsed = parseArithmetic(p.prompt);
    if (!parsed) {
        return `<div class="math-cell-v-fallback">
            <div>${escapeHtml(p.prompt)}</div>
            <div class="cell-answer">${escapeHtml(p.answer)}</div>
        </div>`;
    }
    const { a, sign, b } = parsed;

    /* Division: classic long division bracket layout */
    if (sign === '÷') {
        const dividend = a;
        const divisor = b;
        const blankSpace = `<div class="div-blank-space" style="min-height:${verticalAnswerRows * 2}em;"></div>`;
        return `<div class="math-cell-div">
            <div class="div-answer-row"><span class="div-quotient">${escapeHtml(p.answer)}</span></div>
            <div class="div-main-row">
                <span class="div-divisor">${escapeHtml(divisor)}</span>
                <span class="div-bracket">)</span>
                <span class="div-dividend">${escapeHtml(dividend)}</span>
            </div>
            ${blankSpace}
        </div>`;
    }

    /* +, -, × : standard stacked layout */
    const numWidth = Math.max(a.length, b.length);
    const paddedA = a.padStart(numWidth);
    const paddedB = b.padStart(numWidth);
    const blankSpace = `<div class="v-blank-space" style="min-height:${verticalAnswerRows * 2}em;"></div>`;
    return `<div class="math-cell-v">
        <div class="v-row"><span class="v-sign-spacer">&nbsp;</span><span class="v-num">${escapeHtml(paddedA)}</span></div>
        <div class="v-row"><span class="v-sign">${escapeHtml(sign)}</span><span class="v-num">${escapeHtml(paddedB)}</span></div>
        <hr class="v-line">
        ${blankSpace}
        <div class="v-answer">${escapeHtml(p.answer)}</div>
    </div>`;
}

/* ── Sheet actions (preview mode from manage) ── */

function buildType4ApiUrl(path) {
    const qs = new URLSearchParams();
    if (paramCategoryKey) qs.set('categoryKey', paramCategoryKey);
    return `${API_BASE}/kids/${encodeURIComponent(paramKidId)}/type4${path}?${qs.toString()}`;
}

function updatePreviewButtons() {
    const isPreview = sheetStatus === 'preview';
    if (regenerateBtn) regenerateBtn.style.display = isPreview ? '' : 'none';
    if (finalizeBtn) finalizeBtn.style.display = isPreview ? '' : 'none';
    if (showAnswersBtn) showAnswersBtn.style.display = (isFromManage && !isPreview) ? '' : 'none';
}

async function handleRegenerate() {
    if (!paramSheetId || !paramKidId) return;
    if (regenerateBtn) { regenerateBtn.disabled = true; regenerateBtn.textContent = 'Regenerating...'; }
    try {
        const result = await fetchJson(buildType4ApiUrl(`/math-sheets/${paramSheetId}/regenerate`), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({}),
        });
        /* Re-render with new seed */
        await loadAndRender(result.seed_base);
    } catch (error) {
        console.error('Error regenerating sheet:', error);
        alert(error.message || 'Failed to regenerate.');
    } finally {
        if (regenerateBtn) { regenerateBtn.disabled = false; regenerateBtn.textContent = 'Regenerate'; }
    }
}

async function handleFinalize() {
    if (!paramSheetId || !paramKidId) return;
    if (finalizeBtn) { finalizeBtn.disabled = true; finalizeBtn.textContent = 'Finalizing...'; }
    try {
        await fetchJson(buildType4ApiUrl(`/math-sheets/${paramSheetId}/finalize`), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({}),
        });
        sheetStatus = 'pending';
        updatePreviewButtons();
    } catch (error) {
        console.error('Error finalizing sheet:', error);
        alert(error.message || 'Failed to finalize.');
    } finally {
        if (finalizeBtn) { finalizeBtn.disabled = false; finalizeBtn.textContent = 'Finalize'; }
    }
}

/* ── Main ── */

function renderGrid(problems, cols, renderCell) {
    sheetContent.classList.remove('show-answers');
    isShowingAnswers = false;
    if (showAnswersBtn) showAnswersBtn.textContent = 'Show Answers';

    const html = problems.map(renderCell).join('');
    sheetContent.innerHTML = `<div class="math-grid" style="grid-template-columns: repeat(${cols}, auto);">${html}</div>`;
}

async function loadAndRender(seedBase) {
    if (!deckId) {
        sheetContent.innerHTML = '<p class="error">No deck ID provided.</p>';
        return;
    }

    sheetContent.innerHTML = '<p>Loading...</p>';
    if (regenerateBtn) regenerateBtn.disabled = true;

    try {
        const deckData = await fetchJson(`${API_BASE}/shared-decks/${deckId}`);
        const deck = deckData.deck || {};
        const deckName = deck.name || `Deck ${deckId}`;
        const modeLabel = mode === 'vertical' ? 'Vertical' : 'Horizontal';
        sheetTitle.textContent = deckName;
        document.title = `${deckName} - ${modeLabel} Sheet`;

        const sampleBody = { count: 20 };
        if (seedBase != null) sampleBody.seedBase = seedBase;
        const sampleResult = await fetchJson(`${API_BASE}/shared-decks/${deckId}/print-problems`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(sampleBody),
        });
        const sampleProblems = Array.isArray(sampleResult.problems) ? sampleResult.problems : [];
        if (sampleProblems.length === 0) {
            sheetContent.innerHTML = '<p class="error">Generator produced no problems.</p>';
            return;
        }
        const usedSeed = sampleResult.seed_base;

        const renderCell = mode === 'vertical' ? renderVerticalCell : renderHorizontalCell;
        const findWorstCase = mode === 'vertical' ? findWorstCaseVerticalCell : findWorstCaseHorizontalCell;
        const layout = computeLayout(sampleProblems, renderCell, findWorstCase);

        const layoutMax = layout.cols * layout.rows;

        /* Save computed capacity to DB so manage page knows the default count */
        fetch(`${API_BASE}/shared-decks/${deckId}/print-capacity`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ mode, capacity: layoutMax }),
        }).catch(() => {});

        const totalNeeded = (paramCount && paramCount > 0) ? Math.min(paramCount, layoutMax) : layoutMax;

        let problems;
        if (totalNeeded <= sampleProblems.length) {
            problems = sampleProblems.slice(0, totalNeeded);
        } else {
            const fullResult = await fetchJson(`${API_BASE}/shared-decks/${deckId}/print-problems`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ count: totalNeeded, seedBase: usedSeed }),
            });
            problems = (fullResult.problems || []).slice(0, totalNeeded);
        }

        sheetMeta.textContent = `${modeLabel} · ${problems.length} problems`;

        if (printHeader) {
            const nameText = isFromManage && paramKidName
                ? escapeHtml(paramKidName)
                : 'Name: ________';
            const sheetText = isFromManage && paramSheetId
                ? `Sheet #${paramSheetId}`
                : 'Sheet #___';
            printHeader.innerHTML = `<span>${nameText}</span><span>${sheetText}</span>`;
        }

        renderGrid(problems, layout.cols, renderCell);
    } catch (error) {
        console.error('Error loading math sheet:', error);
        sheetContent.innerHTML = `<p class="error">${escapeHtml(error.message || 'Failed to load.')}</p>`;
    } finally {
        if (regenerateBtn) regenerateBtn.disabled = false;
    }
}

document.addEventListener('DOMContentLoaded', () => {
    if (backBtn) {
        backBtn.href = '#';
        backBtn.addEventListener('click', (e) => { e.preventDefault(); goBack(); });
    }

    if (printBtn) printBtn.addEventListener('click', () => window.print());

    if (!isFromManage) {
        /* Preview mode (from deck-view): show only Print and Back */
        if (showAnswersBtn) showAnswersBtn.style.display = 'none';
        if (regenerateBtn) regenerateBtn.style.display = 'none';
        if (finalizeBtn) finalizeBtn.style.display = 'none';
    } else {
        /* From manage page — show buttons based on sheet status */
        if (showAnswersBtn) {
            showAnswersBtn.addEventListener('click', () => {
                isShowingAnswers = !isShowingAnswers;
                sheetContent.classList.toggle('show-answers', isShowingAnswers);
                showAnswersBtn.textContent = isShowingAnswers ? 'Hide Answers' : 'Show Answers';
            });
        }
        if (regenerateBtn) regenerateBtn.addEventListener('click', handleRegenerate);
        if (finalizeBtn) finalizeBtn.addEventListener('click', handleFinalize);
        updatePreviewButtons();
    }

    loadAndRender(paramSeedBase);
});
