const API_BASE = `${window.location.origin}/api`;

const sheetTitle = document.getElementById('sheetTitle');
const sheetMeta = document.getElementById('sheetMeta');
const sheetPreviewWrap = document.getElementById('sheetPreviewWrap');
const printBtn = document.getElementById('printBtn');
const backBtn = document.getElementById('backBtn');

const params = new URLSearchParams(window.location.search);
const kidId = String(params.get('id') || '').trim();
const sheetId = parseInt(params.get('sheet') || '0', 10);
const categoryKey = String(params.get('categoryKey') || '').trim().toLowerCase();

let currentSheetData = null;

/* ── Constants matching the builder ── */
const CW_CELL_SIZE = 52;
const CW_FONT_RATIO = 0.72;
const CW_CHINESE_FONT = 'var(--font-kaiti)';
const CW_DEFAULT_EMPTY_COUNT = 1;
const CW_DEFAULT_SCALE = 1.3;
const CW_ROW_GAP = 4;
const DEFAULT_PAPER_SIZE = 'letter';
const PRINTABLE_AREA_DEBUG_BORDER_INSET = 2;
const PAPER_MARGIN = 19;
const PAPER_EXTRA_SAFE_MARGIN_X = 34;
const PAPER_EXTRA_SAFE_MARGIN_TOP = 42;
const PAPER_EXTRA_SAFE_MARGIN_BOTTOM = 42;
const PAPER_HEADER_HEIGHT = 24;
const PAPER_MARGIN_MM = 5;
const PAPER_EXTRA_SAFE_MARGIN_X_MM = (PAPER_EXTRA_SAFE_MARGIN_X * 25.4) / 96;
const PAPER_EXTRA_SAFE_MARGIN_TOP_MM = (PAPER_EXTRA_SAFE_MARGIN_TOP * 25.4) / 96;
const PAPER_EXTRA_SAFE_MARGIN_BOTTOM_MM = (PAPER_EXTRA_SAFE_MARGIN_BOTTOM * 25.4) / 96;

const PAPER_SPECS = Object.freeze({
    letter: buildPrintPaperSpec('letter', 816, 1056, 215.9, 279.4, '8.5in 11in'),
    a4: buildPrintPaperSpec('a4', 794, 1123, 210, 297, '210mm 297mm'),
});

let currentPaperSpec = PAPER_SPECS[DEFAULT_PAPER_SIZE];

function buildPrintPaperSpec(key, pageWidth, pageHeight, pageWidthMm, pageHeightMm, cssPageSize) {
    const gridWidth = pageWidth - (2 * PAPER_MARGIN);
    const gridHeight = pageHeight - (2 * PAPER_MARGIN);
    const safeBoxWidth = gridWidth - (2 * PAPER_EXTRA_SAFE_MARGIN_X);
    const safeBoxHeight = gridHeight - PAPER_EXTRA_SAFE_MARGIN_TOP - PAPER_EXTRA_SAFE_MARGIN_BOTTOM;
    return Object.freeze({
        key,
        pageWidth,
        pageHeight,
        pageWidthMm,
        pageHeightMm,
        cssPageSize,
        margin: PAPER_MARGIN,
        extraSafeMarginX: PAPER_EXTRA_SAFE_MARGIN_X,
        extraSafeMarginTop: PAPER_EXTRA_SAFE_MARGIN_TOP,
        extraSafeMarginBottom: PAPER_EXTRA_SAFE_MARGIN_BOTTOM,
        headerHeight: PAPER_HEADER_HEIGHT,
        safeBoxWidth,
        safeBoxHeight,
        builderGridHeight: safeBoxHeight - PAPER_HEADER_HEIGHT,
        safeWidthMm: pageWidthMm - (2 * PAPER_MARGIN_MM),
        safeHeightMm: pageHeightMm - (2 * PAPER_MARGIN_MM),
        safeBoxWidthMm: pageWidthMm - (2 * PAPER_MARGIN_MM) - (2 * PAPER_EXTRA_SAFE_MARGIN_X_MM),
        safeBoxHeightMm: pageHeightMm - (2 * PAPER_MARGIN_MM) - PAPER_EXTRA_SAFE_MARGIN_TOP_MM - PAPER_EXTRA_SAFE_MARGIN_BOTTOM_MM,
    });
}

function normalizePaperSize(value, fallback = DEFAULT_PAPER_SIZE) {
    const raw = String(value || '').trim().toLowerCase();
    if (raw === 'letter' || raw === 'us-letter' || raw === 'us_letter' || raw === 'us letter') return 'letter';
    if (raw === 'a4') return 'a4';
    return String(fallback || DEFAULT_PAPER_SIZE);
}

function getPaperSpec(value, fallback = DEFAULT_PAPER_SIZE) {
    return PAPER_SPECS[normalizePaperSize(value, fallback)] || PAPER_SPECS[DEFAULT_PAPER_SIZE];
}

function applyPaperSpec(paperSize) {
    currentPaperSpec = getPaperSpec(paperSize);
}

function escapeHtml(text) {
    const el = document.createElement('span');
    el.textContent = String(text || '');
    return el.innerHTML;
}

function clampScale(value) {
    const num = Number(value);
    if (!Number.isFinite(num)) return CW_DEFAULT_SCALE;
    return Math.min(2.0, Math.max(0.5, Math.round(num * 10) / 10));
}

function computeSheetPreviewScale(paperSize = currentPaperSpec.key) {
    const paperSpec = getPaperSpec(paperSize);
    const maxW = Math.min(window.innerWidth - 120, 780);
    const maxH = window.innerHeight - 200;
    const widthScale = maxW / paperSpec.pageWidth;
    const heightScale = maxH / paperSpec.pageHeight;
    const resolved = Math.min(widthScale, heightScale, 0.6);
    return Number.isFinite(resolved) ? Math.max(0.2, resolved) : 0.6;
}

function buildType2ApiUrl(path) {
    return window.DeckCategoryCommon.buildType2ApiUrl({
        kidId, path, categoryKey, apiBase: API_BASE,
    });
}

async function fetchJson(url, options) {
    const response = await fetch(url, options);
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
    return payload;
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

function buildRowCells(character, emptyCount, colCount) {
    const chars = [...(character || '')];
    if (chars.length === 0) return [];
    const empty = Math.max(1, Math.min(9, emptyCount || CW_DEFAULT_EMPTY_COUNT));
    const groupSize = 1 + empty;
    const cells = [];
    let charIdx = 0;
    for (let col = 0; col < colCount; col += 1) {
        const posInGroup = col % groupSize;
        if (posInGroup === 0) {
            if (col === colCount - 1) {
                cells.push({ type: 'empty' });
            } else {
                cells.push({ type: 'demo', char: chars[charIdx % chars.length] });
                charIdx += 1;
            }
        } else {
            cells.push({ type: 'empty' });
        }
    }
    return cells;
}

function buildSheetPageMarkup(sheet, scale, { showDebugBorder }) {
    const paperSpec = currentPaperSpec;
    const layoutRows = Array.isArray(sheet?.layout?.rows) ? sheet.layout.rows : [];
    const marginPx = Math.round(paperSpec.margin * scale);
    const safeMarginXPx = Math.round(paperSpec.extraSafeMarginX * scale);
    const safeMarginTopPx = Math.round(paperSpec.extraSafeMarginTop * scale);
    const safeMarginBottomPx = Math.round(paperSpec.extraSafeMarginBottom * scale);
    const gridWidthPx = Math.round(paperSpec.safeBoxWidth * scale);
    const headerHeightPx = Math.round(paperSpec.headerHeight * scale);
    const contentLeftPx = marginPx + safeMarginXPx;
    const contentTopPx = marginPx + safeMarginTopPx;
    const gridTopPx = contentTopPx + headerHeightPx;
    const gridHeightPx = Math.round(paperSpec.builderGridHeight * scale);
    const printableHeightPx = Math.round(paperSpec.safeBoxHeight * scale);
    const borderInsetPx = Math.round(PRINTABLE_AREA_DEBUG_BORDER_INSET * scale);
    const headerFontPx = Math.max(10, Math.round(12 * scale));
    const pageWidthPx = Math.round(paperSpec.pageWidth * scale);
    const pageHeightPx = Math.round(paperSpec.pageHeight * scale);

    const globalRowScale = layoutRows.length > 0
        ? clampScale(layoutRows[0]?.scale || CW_DEFAULT_SCALE)
        : CW_DEFAULT_SCALE;
    const cellSize = Math.ceil(CW_CELL_SIZE * globalRowScale);
    const cellSizePx = Math.round(cellSize * scale);
    const fontSizePx = Math.max(6, Math.round(cellSize * CW_FONT_RATIO * scale));
    const gapPx = Math.round(CW_ROW_GAP * scale);
    const colCount = Math.max(1, Math.floor(paperSpec.safeBoxWidth / cellSize));

    let html = `<div class="sheet-page" style="width:${pageWidthPx}px;height:${pageHeightPx}px;">`;
    html += '<div class="sheet-content">';
    html += `<div class="sb-margin" style="top:0;left:0;right:0;height:${marginPx}px;"></div>`;
    html += `<div class="sb-margin" style="bottom:0;left:0;right:0;height:${marginPx}px;"></div>`;
    html += `<div class="sb-margin" style="top:${marginPx}px;left:0;width:${marginPx}px;bottom:${marginPx}px;"></div>`;
    html += `<div class="sb-margin" style="top:${marginPx}px;right:0;width:${marginPx}px;bottom:${marginPx}px;"></div>`;
    html += `<div class="sb-safe-margin" style="top:${marginPx}px;left:${marginPx}px;right:${marginPx}px;height:${safeMarginTopPx}px;"></div>`;
    html += `<div class="sb-safe-margin" style="bottom:${marginPx}px;left:${marginPx}px;right:${marginPx}px;height:${safeMarginBottomPx}px;"></div>`;
    html += `<div class="sb-safe-margin" style="top:${marginPx + safeMarginTopPx}px;left:${marginPx}px;width:${safeMarginXPx}px;bottom:${marginPx + safeMarginBottomPx}px;"></div>`;
    html += `<div class="sb-safe-margin" style="top:${marginPx + safeMarginTopPx}px;right:${marginPx}px;width:${safeMarginXPx}px;bottom:${marginPx + safeMarginBottomPx}px;"></div>`;
    if (showDebugBorder) {
        html += `<div class="sb-printable-border" style="top:${contentTopPx + borderInsetPx}px;left:${contentLeftPx + borderInsetPx}px;width:${Math.max(1, gridWidthPx - (2 * borderInsetPx))}px;height:${Math.max(1, printableHeightPx - (2 * borderInsetPx))}px;"></div>`;
    }
    html += `<div class="sb-header-row" style="top:${contentTopPx}px;left:${contentLeftPx}px;width:${gridWidthPx}px;height:${headerHeightPx}px;">`;
    const kidName = String(sheet?.kid_name || '').trim();
    const displaySheetNumber = String(sheet?.id || '').trim();
    html += `<span class="sb-header-name" style="font-size:${headerFontPx}px;">Name: ${escapeHtml(kidName || '________')}</span>`;
    html += '<span class="sb-header-decks"></span>';
    html += `<span class="sb-header-sheetno" style="font-size:${headerFontPx}px;">Sheet #${escapeHtml(displaySheetNumber || '___')}</span>`;
    html += '</div>';
    html += `<div class="sb-grid-area" style="top:${gridTopPx}px;left:${contentLeftPx}px;width:${gridWidthPx}px;height:${gridHeightPx}px;">`;

    layoutRows.forEach((row) => {
        const character = String(row?.back || row?.front || '').trim();
        const emptyCount = Number.parseInt(
            row?.empty_count != null ? row.empty_count : row?.emptyCount,
            10,
        ) || CW_DEFAULT_EMPTY_COUNT;
        const cells = buildRowCells(character, emptyCount, colCount);
        const rowHeightPx = cellSizePx + gapPx;

        html += `<div class="sb-row-wrap" style="height:${rowHeightPx}px;">`;
        html += `<div class="sb-row" style="height:${cellSizePx}px;">`;
        cells.forEach((cell) => {
            html += `<div class="cw-grid-cell" style="width:${cellSizePx}px;height:${cellSizePx}px;">`;
            if (cell.type === 'demo') {
                html += `<span class="cw-grid-char cw-grid-char-first" style="font-size:${fontSizePx}px;font-family:${CW_CHINESE_FONT};">${escapeHtml(cell.char)}</span>`;
            }
            html += '</div>';
        });
        html += '</div>';
        html += '</div>';
    });

    html += '</div>';
    html += '</div>';
    html += '</div>';
    return html;
}

function renderSheetPreview(sheet) {
    if (!sheetPreviewWrap) return;
    const paperSize = normalizePaperSize(sheet?.layout?.paper_size || DEFAULT_PAPER_SIZE);
    const previewScale = computeSheetPreviewScale(paperSize);
    sheetPreviewWrap.innerHTML = buildSheetPageMarkup(sheet, previewScale, { showDebugBorder: true });
}

async function handlePrint() {
    if (!currentSheetData) {
        return;
    }
    if (typeof window.html2canvas === 'undefined' || typeof window.jspdf === 'undefined') {
        alert('PDF libraries are still loading. Please try again.');
        return;
    }
    if (printBtn) {
        printBtn.disabled = true;
        printBtn.textContent = 'Generating PDF...';
    }
    try {
        const pageMarkup = buildSheetPageMarkup(currentSheetData, 1, { showDebugBorder: false });
        const offscreen = document.createElement('div');
        offscreen.style.cssText = 'position:fixed;left:-9999px;top:0;z-index:-1;';
        offscreen.innerHTML = pageMarkup;
        document.body.appendChild(offscreen);
        const sheetEl = offscreen.querySelector('.sheet-page');
        if (!sheetEl) {
            document.body.removeChild(offscreen);
            alert('Failed to render sheet for PDF.');
            return;
        }
        try {
            if (document.fonts && document.fonts.ready) {
                await document.fonts.ready;
            }
        } catch (e) {}
        const dpr = Math.max(2, Math.ceil(window.devicePixelRatio || 1));
        const canvas = await window.html2canvas(sheetEl, {
            scale: dpr,
            useCORS: true,
            backgroundColor: '#ffffff',
            logging: false,
        });
        document.body.removeChild(offscreen);
        const { jsPDF } = window.jspdf;
        const pageWidthMm = currentPaperSpec.pageWidthMm;
        const pageHeightMm = currentPaperSpec.pageHeightMm;
        const orientation = pageWidthMm > pageHeightMm ? 'landscape' : 'portrait';
        const doc = new jsPDF({
            orientation,
            unit: 'mm',
            format: [pageWidthMm, pageHeightMm],
            compress: true,
        });
        const imgData = canvas.toDataURL('image/jpeg', 0.92);
        doc.addImage(imgData, 'JPEG', 0, 0, pageWidthMm, pageHeightMm);
        const blob = doc.output('blob');
        const url = URL.createObjectURL(blob);
        window.location.href = url;
    } catch (error) {
        console.error('Error generating PDF:', error);
        alert('Failed to generate PDF: ' + (error.message || 'Unknown error'));
    } finally {
        if (printBtn) {
            printBtn.disabled = false;
            printBtn.textContent = 'Print';
        }
    }
}

async function loadAndRender() {
    if (!kidId || !sheetId) {
        if (sheetPreviewWrap) sheetPreviewWrap.innerHTML = '<p class="error">Missing kid or sheet id.</p>';
        return;
    }
    if (printBtn) printBtn.disabled = true;
    if (sheetPreviewWrap) sheetPreviewWrap.innerHTML = '<p>Loading...</p>';

    try {
        const payload = await fetchJson(buildType2ApiUrl(`/chinese-print-sheets/${sheetId}`));
        const sheet = payload?.sheet || null;
        if (!sheet) throw new Error('Sheet not found');

        const layout = sheet.layout || {};
        applyPaperSpec(layout.paper_size || DEFAULT_PAPER_SIZE);

        const status = String(sheet.status || '').trim().toLowerCase();
        const rowCount = Array.isArray(layout.rows) ? layout.rows.length : 0;
        if (sheetTitle) sheetTitle.textContent = `Sheet #${sheet.id}`;
        if (sheetMeta) {
            const statusLabel = status === 'done' ? 'Done' : 'Ready to print';
            sheetMeta.textContent = `${statusLabel} · ${rowCount} row${rowCount === 1 ? '' : 's'}`;
        }

        currentSheetData = sheet;
        renderSheetPreview(sheet);
    } catch (error) {
        console.error('Error loading Chinese sheet:', error);
        currentSheetData = null;
        if (sheetPreviewWrap) {
            sheetPreviewWrap.innerHTML = `<p class="error">${escapeHtml(error.message || 'Failed to load sheet.')}</p>`;
        }
    } finally {
        if (printBtn) printBtn.disabled = false;
    }
}

document.addEventListener('DOMContentLoaded', () => {
    applyPaperSpec(DEFAULT_PAPER_SIZE);

    document.addEventListener('keydown', (event) => {
        const isPrintShortcut = (event.metaKey || event.ctrlKey) && String(event.key || '').toLowerCase() === 'p';
        if (!isPrintShortcut) return;
        event.preventDefault();
        handlePrint();
    });

    if (backBtn) {
        backBtn.href = '#';
        backBtn.addEventListener('click', (event) => {
            event.preventDefault();
            goBack();
        });
    }

    if (printBtn) {
        printBtn.addEventListener('click', () => handlePrint());
    }

    window.addEventListener('resize', () => {
        if (currentSheetData) renderSheetPreview(currentSheetData);
    });

    loadAndRender();
});
