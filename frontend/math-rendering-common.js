const CELL_DESIGN_CANVAS_VERSION = 2;
const DEFAULT_CELL_CONTENT_X = 0;
const DEFAULT_CELL_CONTENT_Y = 0;

const MATH_OPERATOR_PATTERN = /^(.+?)\s*([+\-−–×x*÷\/])\s*(.+?)(?:\s*=\s*[?？_\s]*)?\s*$/;

function parseArithmetic(prompt) {
    const match = String(prompt || '').match(MATH_OPERATOR_PATTERN);
    if (!match) return null;
    const a = match[1].trim();
    const rawOp = match[2];
    const b = match[3].trim();
    if (!a || !b) return null;
    let sign = rawOp;
    if (rawOp === '-' || rawOp === '−' || rawOp === '–') sign = '−';
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
    } else if (sign === '+' || sign === '-' || sign === '−' || sign === '–') {
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
        return `<div class="math-cell-v-fallback">
            <div>${renderMathNotation(problem.prompt || '')}</div>
            <div class="cell-answer">${escapeHtml(problem.answer || '')}</div>
        </div>`;
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

function getCellDesignOffsets(cellDef) {
    if (!cellDef) {
        return { x: DEFAULT_CELL_CONTENT_X, y: DEFAULT_CELL_CONTENT_Y };
    }
    const version = Number(cellDef.canvasVersion != null ? cellDef.canvasVersion : cellDef.canvas_version) || 0;
    const rawX = cellDef.contentOffsetX != null ? cellDef.contentOffsetX : cellDef.content_offset_x;
    const rawY = cellDef.contentOffsetY != null ? cellDef.contentOffsetY : cellDef.content_offset_y;
    const hasCamel = cellDef.canvasVersion != null || cellDef.contentOffsetX != null || cellDef.contentOffsetY != null;
    if (hasCamel && version < CELL_DESIGN_CANVAS_VERSION) {
        return { x: DEFAULT_CELL_CONTENT_X, y: DEFAULT_CELL_CONTENT_Y };
    }
    return {
        x: Math.max(0, Number(rawX) || 0),
        y: Math.max(0, Number(rawY) || 0),
    };
}
