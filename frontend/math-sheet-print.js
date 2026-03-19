const API_BASE = `${window.location.origin}/api`;

const sheetTitle = document.getElementById('sheetTitle');
const printHeader = document.getElementById('printHeader');
const sheetMeta = document.getElementById('sheetMeta');
const sheetContent = document.getElementById('sheetContent');
const sheetPrintableArea = document.getElementById('sheetPrintableArea');
const regenerateBtn = document.getElementById('regenerateBtn');
const finalizeBtn = document.getElementById('finalizeBtn');
const printBtn = document.getElementById('printBtn');
const showAnswersBtn = document.getElementById('showAnswersBtn');
const backBtn = document.getElementById('backBtn');

const params = new URLSearchParams(window.location.search);
const kidId = String(params.get('id') || '').trim();
const sheetId = parseInt(params.get('sheet') || '0', 10);
const fromContext = (params.get('from') || '').toLowerCase();
const categoryKey = String(params.get('categoryKey') || '').trim().toLowerCase();
const isFromManage = fromContext === 'worksheets';

let currentSheetStatus = '';
let currentRenderedCanvas = null;
let currentSheetData = null;
let showAnswers = false;
const PAGE_BOX_WIDTH = 688;
const PAGE_BOX_HEIGHT = 1017;
const HEADER_FONT_SIZE = 10;
const CARD_INFO_FONT_SIZE = 8;
const CONTENT_TOP = 34;
const MATH_FONT_FAMILY = "'Courier New', Courier, 'Nimbus Mono PS', 'Liberation Mono', monospace";
const HEADER_FONT_FAMILY = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
const BASE_MATH_FONT_SIZE = 25;
const BASE_LINE_HEIGHT = BASE_MATH_FONT_SIZE * 1.18;

function escapeHtml(text) {
    const el = document.createElement('span');
    el.textContent = text;
    return el.innerHTML;
}

function buildType4ApiUrl(path) {
    const qs = new URLSearchParams();
    if (categoryKey) qs.set('categoryKey', categoryKey);
    const suffix = qs.toString();
    return `${API_BASE}/kids/${encodeURIComponent(kidId)}${path}${suffix ? `?${suffix}` : ''}`;
}

function goBack() {
    if (window.history.length > 1) {
        window.history.back();
        return;
    }
    const qs = new URLSearchParams();
    if (kidId) qs.set('id', kidId);
    if (categoryKey) qs.set('categoryKey', categoryKey);
    window.location.href = `/kid-writing-sheet-manage.html?${qs.toString()}`;
}

async function fetchJson(url, options) {
    const response = await fetch(url, options);
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
        throw new Error(payload.error || `HTTP ${response.status}`);
    }
    return payload;
}

const OPERATOR_PATTERN = /^(.+?)\s*([+\-×x*÷\/])\s*(.+?)(?:\s*=\s*[?？_\s]*)?\s*$/;

function parseArithmetic(prompt) {
    const match = String(prompt || '').match(OPERATOR_PATTERN);
    if (!match) return null;
    const a = match[1].trim();
    const rawOp = match[2];
    const b = match[3].trim();
    if (!a || !b) return null;
    let sign = rawOp;
    if (rawOp === '*' || rawOp === 'x') sign = '×';
    if (rawOp === '/' || rawOp === '÷') sign = '÷';
    return { a, sign, b };
}

function buildVerticalRows(a, b, sign) {
    const topDigits = String(a || '');
    const bottomDigits = String(b || '');
    let gapCh = 1;
    if (sign === '×') {
        gapCh = Math.max(1, topDigits.length);
    } else if (sign === '+' || sign === '-') {
        gapCh = Math.max(1, topDigits.length - bottomDigits.length + 1);
    }
    return {
        topDigits,
        bottomDigits,
        sign,
        gapCh,
        rowWidthCh: 1 + gapCh + bottomDigits.length,
    };
}

function renderVerticalPromptCell(problem) {
    if (!problem) return '<div class="math-cell-v-fallback"></div>';
    const parsed = parseArithmetic(problem.prompt);
    if (!parsed) {
        return `<div class="math-cell-v-fallback"><div>${escapeHtml(problem.prompt || '')}</div></div>`;
    }
    const { a, sign, b } = parsed;
    if (sign === '÷') {
        return `<div class="math-cell-div">
            <div class="div-main-row">
                <span class="div-divisor">${escapeHtml(b)}</span>
                <span class="div-dividend"><svg class="div-bracket-svg" viewBox="0 0 10 28" aria-hidden="true"><path d="M 1 27 Q 7 26, 7 21 L 7 0" stroke="currentColor" stroke-width="1.5" fill="none"/></svg>${escapeHtml(a)}</span>
            </div>
        </div>`;
    }
    const rows = buildVerticalRows(a, b, sign);
    return `<div class="math-cell-v" style="--v-row-width-ch:${rows.rowWidthCh};--v-gap-ch:${rows.gapCh};">
        <div class="v-row v-row-top">${escapeHtml(rows.topDigits)}</div>
        <div class="v-row v-row-op">
            <span class="v-op">${escapeHtml(rows.sign)}</span>
            <span class="v-gap" aria-hidden="true"></span>
            <span class="v-row-bottom-num">${escapeHtml(rows.bottomDigits)}</span>
        </div>
        <div class="v-line" aria-hidden="true"></div>
    </div>`;
}

function getCellDesignOffsets(cellDesign) {
    return {
        x: Math.max(0, Number.parseInt(cellDesign && cellDesign.content_offset_x, 10) || 0),
        y: Math.max(0, Number.parseInt(cellDesign && cellDesign.content_offset_y, 10) || 0),
    };
}

function updateToolbarButtons(status) {
    const isPreview = status === 'preview';
    if (regenerateBtn) regenerateBtn.style.display = (isFromManage && isPreview) ? '' : 'none';
    if (finalizeBtn) finalizeBtn.style.display = (isFromManage && isPreview) ? '' : 'none';
}

function createSheetCanvas(sheet, withAnswers) {
    const dpr = Math.max(2, Math.ceil(window.devicePixelRatio || 1));
    const canvas = document.createElement('canvas');
    canvas.className = 'sheet-render-canvas';
    canvas.width = PAGE_BOX_WIDTH * dpr;
    canvas.height = PAGE_BOX_HEIGHT * dpr;
    canvas.style.width = `${PAGE_BOX_WIDTH}px`;
    canvas.style.height = `${PAGE_BOX_HEIGHT}px`;

    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, PAGE_BOX_WIDTH, PAGE_BOX_HEIGHT);

    drawSheetHeader(ctx, sheet);
    drawSheetRows(ctx, sheet, withAnswers);
    return canvas;
}

function handlePrint() {
    window.print();
}

function buildCardInfoText(layoutRows) {
    if (!Array.isArray(layoutRows) || layoutRows.length === 0) return '';
    const segments = [];
    let runStart = 0;
    let runName = String((layoutRows[0] && layoutRows[0].deck_name) || '');
    for (let i = 1; i <= layoutRows.length; i++) {
        const name = i < layoutRows.length ? String((layoutRows[i] && layoutRows[i].deck_name) || '') : '';
        if (name !== runName || i === layoutRows.length) {
            const from = runStart + 1;
            const to = i;
            const label = from === to ? `Row ${from}` : `Row ${from}-${to}`;
            segments.push(`${label}: ${runName || '(unnamed)'}`);
            runStart = i;
            runName = name;
        }
    }
    return segments.join(', ');
}

function drawSheetHeader(ctx, sheet) {
    ctx.save();
    ctx.fillStyle = '#333';
    ctx.font = `${HEADER_FONT_SIZE}px ${HEADER_FONT_FAMILY}`;
    ctx.textBaseline = 'alphabetic';
    const kidName = String((sheet && sheet.kid_name) || '').trim();
    ctx.textAlign = 'left';
    ctx.fillText(`Name: ${kidName || '________'}`, 2, HEADER_FONT_SIZE);
    ctx.textAlign = 'right';
    ctx.fillText(`Sheet #${sheet.id}`, PAGE_BOX_WIDTH - 2, HEADER_FONT_SIZE);

    const cardInfo = buildCardInfoText(sheet && sheet.layout_rows);
    if (cardInfo) {
        ctx.textAlign = 'left';
        ctx.fillStyle = '#666';
        ctx.font = `${CARD_INFO_FONT_SIZE}px ${HEADER_FONT_FAMILY}`;
        ctx.fillText(cardInfo, 2, HEADER_FONT_SIZE + CARD_INFO_FONT_SIZE + 4);
    }
    ctx.restore();
}

function getCanvasRowLayout(sheet) {
    const layoutRows = Array.isArray(sheet && sheet.layout_rows) ? sheet.layout_rows : [];
    const baseRows = layoutRows.map((row) => {
        const rowScale = Math.max(0.1, Number(row && row.scale) || 1);
        const cellDesign = row && row.cell_design ? row.cell_design : {};
        const baseCellWidth = Math.max(1, Number(cellDesign.cell_width) || 1);
        const baseCellHeight = Math.max(1, Number(cellDesign.cell_height) || 1);
        const colCount = Math.max(1, Number.parseInt(row && row.col_count, 10) || 1);
        return {
            row,
            rowScale,
            baseCellWidth,
            baseCellHeight,
            colCount,
            baseRowWidth: baseCellWidth * rowScale * colCount,
            baseRowHeight: baseCellHeight * rowScale,
        };
    });
    const totalBaseHeight = baseRows.reduce((sum, item) => sum + item.baseRowHeight, 0);
    const availableHeight = Math.max(1, PAGE_BOX_HEIGHT - CONTENT_TOP);
    const heightScale = totalBaseHeight > 0 ? Math.min(1, availableHeight / totalBaseHeight) : 1;
    const widthScale = baseRows.reduce((minScale, item) => {
        if (item.baseRowWidth <= 0) return minScale;
        return Math.min(minScale, PAGE_BOX_WIDTH / item.baseRowWidth);
    }, 1);
    const pageScale = Math.max(0.1, Math.min(1, heightScale, widthScale));
    return { baseRows, pageScale };
}

function drawSheetRows(ctx, sheet, withAnswers) {
    const { baseRows, pageScale } = getCanvasRowLayout(sheet);
    let currentY = CONTENT_TOP;
    baseRows.forEach((item) => {
        const finalScale = item.rowScale * pageScale;
        const cellWidth = item.baseCellWidth * finalScale;
        const cellHeight = item.baseCellHeight * finalScale;
        const gap = item.colCount > 1
            ? Math.max(0, (PAGE_BOX_WIDTH - (cellWidth * item.colCount)) / (item.colCount - 1))
            : 0;
        const problems = Array.isArray(item.row && item.row.problems) ? item.row.problems : [];
        for (let cellIndex = 0; cellIndex < item.colCount; cellIndex += 1) {
            const problem = problems[cellIndex] || { prompt: '', answer: '' };
            const cellX = cellIndex * (cellWidth + gap);
            drawSheetCell(ctx, problem, item.row, cellX, currentY, cellWidth, cellHeight, finalScale, withAnswers);
        }
        currentY += cellHeight;
    });
}

function drawSheetCell(ctx, problem, row, cellX, cellY, cellWidth, cellHeight, scale, withAnswers) {
    const cellDesign = row && row.cell_design ? row.cell_design : {};
    const offsets = getCellDesignOffsets(cellDesign);
    const contentX = cellX + (offsets.x * scale);
    const contentY = cellY + (offsets.y * scale);

    ctx.save();
    ctx.beginPath();
    ctx.rect(cellX, cellY, cellWidth, cellHeight);
    ctx.clip();
    drawPrompt(ctx, problem, contentX, contentY, scale);
    if (withAnswers) {
        drawAnswer(ctx, problem, cellX, cellY, cellWidth, cellHeight, scale);
    }
    ctx.restore();
}

function drawPrompt(ctx, problem, x, y, scale) {
    const parsed = parseArithmetic(problem && problem.prompt ? problem.prompt : '');
    if (!parsed) {
        drawFallbackPrompt(ctx, problem && problem.prompt ? problem.prompt : '', x, y, scale);
        return;
    }
    if (parsed.sign === '÷') {
        drawDivisionPrompt(ctx, parsed, x, y, scale);
        return;
    }
    drawVerticalArithmeticPrompt(ctx, parsed, x, y, scale);
}

function setMathFont(ctx, scale, sizeMultiplier = 1) {
    const fontSize = BASE_MATH_FONT_SIZE * scale * sizeMultiplier;
    ctx.font = `${fontSize}px ${MATH_FONT_FAMILY}`;
    ctx.fillStyle = '#222';
    ctx.strokeStyle = '#222';
    ctx.lineWidth = Math.max(1, 2 * scale);
    ctx.textBaseline = 'alphabetic';
    return fontSize;
}

function drawFallbackPrompt(ctx, prompt, x, y, scale) {
    const fontSize = setMathFont(ctx, scale, 0.86);
    ctx.textAlign = 'left';
    ctx.fillText(String(prompt || ''), x, y + fontSize);
}

function drawVerticalArithmeticPrompt(ctx, parsed, x, y, scale) {
    const fontSize = setMathFont(ctx, scale);
    const lineHeight = BASE_LINE_HEIGHT * scale;
    const rows = buildVerticalRows(parsed.a, parsed.b, parsed.sign);
    const charWidth = ctx.measureText('0').width;
    const rowWidth = rows.rowWidthCh * charWidth;
    const topBaseline = y + fontSize;
    const bottomBaseline = topBaseline + lineHeight;

    ctx.textAlign = 'right';
    ctx.fillText(rows.topDigits, x + rowWidth, topBaseline);

    ctx.textAlign = 'center';
    ctx.fillText(rows.sign, x + (charWidth / 2), bottomBaseline);

    ctx.textAlign = 'left';
    ctx.fillText(rows.bottomDigits, x + charWidth + (rows.gapCh * charWidth), bottomBaseline);

    const lineY = bottomBaseline + Math.max(2, 4 * scale);
    ctx.beginPath();
    ctx.moveTo(x, lineY);
    ctx.lineTo(x + rowWidth, lineY);
    ctx.stroke();
}

function drawDivisionPrompt(ctx, parsed, x, y, scale) {
    const fontSize = setMathFont(ctx, scale);
    const baseline = y + fontSize;
    const divisorText = String(parsed.b || '');
    const dividendText = String(parsed.a || '');
    const divisorWidth = ctx.measureText(divisorText).width;
    const dividendWidth = ctx.measureText(dividendText).width;

    const gap = 3 * scale;
    const bracketX = x + divisorWidth + gap;
    const dividendX = bracketX + 5 * scale;
    const vinculumY = y + Math.max(1, 2 * scale);
    const bracketBottomY = baseline + 5 * scale;

    ctx.textAlign = 'left';
    ctx.fillText(divisorText, x, baseline);
    ctx.fillText(dividendText, dividendX, baseline);

    ctx.beginPath();
    ctx.moveTo(bracketX - 3 * scale, bracketBottomY);
    ctx.quadraticCurveTo(bracketX, bracketBottomY - scale, bracketX, bracketBottomY - 7 * scale);
    ctx.lineTo(bracketX, vinculumY);
    ctx.lineTo(dividendX + dividendWidth + 2 * scale, vinculumY);
    ctx.stroke();
}

function drawAnswer(ctx, problem, cellX, cellY, cellWidth, cellHeight, scale) {
    const answer = String((problem && problem.answer) || '').trim();
    if (!answer) return;
    const fontSize = BASE_MATH_FONT_SIZE * scale * 0.72;
    ctx.save();
    ctx.font = `bold ${fontSize}px ${MATH_FONT_FAMILY}`;
    ctx.fillStyle = '#2b8a3e';
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'center';
    ctx.fillText(answer, cellX + cellWidth / 2, cellY + cellHeight * 0.7);
    ctx.restore();
}

function rerenderCanvas() {
    if (!currentSheetData || !sheetContent) return;
    sheetContent.innerHTML = '';
    currentRenderedCanvas = createSheetCanvas(currentSheetData, showAnswers);
    sheetContent.appendChild(currentRenderedCanvas);
}

async function loadAndRender() {
    if (!kidId || !sheetId) {
        sheetContent.innerHTML = '<p class="error">Missing kid or sheet id.</p>';
        return;
    }
    if (printBtn) printBtn.disabled = true;
    sheetContent.innerHTML = '<p>Loading...</p>';
    try {
        const payload = await fetchJson(buildType4ApiUrl(`/type4/math-sheets/${sheetId}`));
        const sheet = payload && payload.sheet ? payload.sheet : null;
        if (!sheet) {
            throw new Error('Sheet not found');
        }
        currentSheetStatus = String(sheet.status || '').trim().toLowerCase();
        if (currentSheetStatus === 'pending' && !showAnswers) {
            showAnswers = true;
            if (showAnswersBtn) showAnswersBtn.textContent = 'Hide Answers';
        }
        updateToolbarButtons(currentSheetStatus);

        if (sheetTitle) {
            sheetTitle.textContent = currentSheetStatus === 'preview'
                ? `Sheet #${sheet.id} Preview`
                : `Sheet #${sheet.id}`;
        }
        if (sheetMeta) {
            const label = currentSheetStatus === 'preview' ? 'Preview' : (currentSheetStatus === 'done' ? 'Done' : 'Ready to print');
            sheetMeta.textContent = `${label} · ${sheet.problem_count || 0} problems · ${sheet.row_count || 0} rows`;
        }
        currentSheetData = sheet;
        if (sheetContent) {
            sheetContent.innerHTML = '';
            currentRenderedCanvas = createSheetCanvas(sheet, showAnswers);
            sheetContent.appendChild(currentRenderedCanvas);
        }
    } catch (error) {
        console.error('Error loading math sheet:', error);
        currentRenderedCanvas = null;
        sheetContent.innerHTML = `<p class="error">${escapeHtml(error.message || 'Failed to load sheet.')}</p>`;
    } finally {
        if (printBtn) printBtn.disabled = false;
    }
}

async function handleRegenerate() {
    if (!kidId || !sheetId) return;
    if (regenerateBtn) {
        regenerateBtn.disabled = true;
        regenerateBtn.textContent = 'Regenerating...';
    }
    try {
        await fetchJson(buildType4ApiUrl(`/type4/math-sheets/${sheetId}/regenerate`), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({}),
        });
        await loadAndRender();
    } catch (error) {
        console.error('Error regenerating sheet:', error);
        alert(error.message || 'Failed to regenerate sheet.');
    } finally {
        if (regenerateBtn) {
            regenerateBtn.disabled = false;
            regenerateBtn.textContent = 'Regenerate';
        }
    }
}

async function handleFinalize() {
    if (!kidId || !sheetId) return;
    if (finalizeBtn) {
        finalizeBtn.disabled = true;
        finalizeBtn.textContent = 'Finalizing...';
    }
    try {
        await fetchJson(buildType4ApiUrl(`/type4/math-sheets/${sheetId}/finalize`), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({}),
        });
        await loadAndRender();
    } catch (error) {
        console.error('Error finalizing sheet:', error);
        alert(error.message || 'Failed to finalize sheet.');
    } finally {
        if (finalizeBtn) {
            finalizeBtn.disabled = false;
            finalizeBtn.textContent = 'Finalize';
        }
    }
}

document.addEventListener('DOMContentLoaded', () => {
    if (backBtn) {
        backBtn.href = '#';
        backBtn.addEventListener('click', (event) => {
            event.preventDefault();
            goBack();
        });
    }
    if (printBtn) {
        printBtn.addEventListener('click', () => {
            handlePrint();
        });
    }
    if (showAnswersBtn) {
        showAnswersBtn.addEventListener('click', () => {
            showAnswers = !showAnswers;
            showAnswersBtn.textContent = showAnswers ? 'Hide Answers' : 'Show Answers';
            rerenderCanvas();
        });
    }
    if (regenerateBtn) {
        regenerateBtn.addEventListener('click', handleRegenerate);
    }
    if (finalizeBtn) {
        finalizeBtn.addEventListener('click', handleFinalize);
    }
    loadAndRender();
});
