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
    html += `<span class="sb-header-name" style="font-size:${headerFontPx}px;">Name: ________</span>`;
    html += '<span class="sb-header-decks"></span>';
    html += `<span class="sb-header-sheetno" style="font-size:${headerFontPx}px;">Sheet #___</span>`;
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

function buildDedicatedPrintDocumentHtml(title, pageMarkup) {
    const escapedTitle = escapeHtml(title || 'Writing Sheet Print');
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${escapedTitle}</title>
    <link rel="stylesheet" href="${window.location.origin}/fonts-local.css">
    <style>
        :root {
            --font-kaiti: 'KidsKaiti', '华文楷体', 'STKaiti', 'Kaiti SC', 'KaiTi', 'BiauKai', 'DFKai-SB', serif;
        }

        @page {
            size: ${currentPaperSpec.cssPageSize};
            margin: 0;
        }

        * {
            box-sizing: border-box;
        }

        html, body {
            margin: 0;
            padding: 0;
            background: #fff;
        }

        body {
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        }

        .screen-toolbar {
            display: flex;
            justify-content: flex-end;
            gap: 8px;
            padding: 12px;
            background: #f5f7fb;
            border-bottom: 1px solid #d8dfef;
            position: sticky;
            top: 0;
        }

        .screen-toolbar button {
            border: none;
            border-radius: 8px;
            padding: 9px 13px;
            cursor: pointer;
            background: #2d7ef7;
            color: #fff;
            font-size: 0.95rem;
        }

        .print-wrap {
            padding: 16px 0;
            background: #f5f7fb;
        }

        .print-page {
            width: ${currentPaperSpec.pageWidthMm}mm;
            height: ${currentPaperSpec.pageHeightMm}mm;
            margin: 0 auto 12px;
            background: #fff;
            overflow: hidden;
            break-after: page;
            page-break-after: always;
        }

        .print-page:last-child {
            break-after: auto;
            page-break-after: auto;
            margin-bottom: 0;
        }

        .sheet-page {
            position: relative;
            background: #fff;
            overflow: hidden;
            width: ${currentPaperSpec.pageWidth}px !important;
            height: ${currentPaperSpec.pageHeight}px !important;
        }

        .sheet-content {
            position: relative;
            width: 100%;
            height: 100%;
            overflow: hidden;
        }

        .sb-margin,
        .sb-safe-margin {
            position: absolute;
            background: transparent;
            pointer-events: none;
        }

        .sb-printable-border {
            position: absolute;
            border: 2px dashed rgba(209, 31, 31, 0.65);
            pointer-events: none;
            box-sizing: border-box;
            z-index: 0;
        }

        .sb-header-row {
            display: grid;
            grid-template-columns: auto 1fr auto;
            align-items: center;
            gap: 8px;
            color: #333;
            padding: 0 2px;
            position: absolute;
        }

        .sb-header-name,
        .sb-header-sheetno {
            font-weight: 700;
            white-space: nowrap;
        }

        .sb-header-sheetno {
            text-align: right;
        }

        .sb-header-decks {
            min-width: 0;
            text-align: center;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
            color: #58647b;
            font-weight: 600;
        }

        .sb-grid-area {
            position: absolute;
            overflow: hidden;
        }

        .sb-row-wrap {
            position: relative;
            z-index: 1;
        }

        .sb-row {
            display: flex;
            flex-wrap: nowrap;
            position: relative;
            width: 100%;
            justify-content: space-between;
        }

        .cw-grid-cell {
            position: relative;
            border: 1.5px solid #4caf50;
            box-sizing: border-box;
            display: flex;
            align-items: center;
            justify-content: center;
            overflow: hidden;
            flex-shrink: 0;
        }

        .cw-grid-cell::before,
        .cw-grid-cell::after {
            content: '';
            position: absolute;
            pointer-events: none;
        }

        .cw-grid-cell::before {
            top: 50%;
            left: 0;
            right: 0;
            border-top: 1px dashed #a5d6a7;
        }

        .cw-grid-cell::after {
            left: 50%;
            top: 0;
            bottom: 0;
            border-left: 1px dashed #a5d6a7;
        }

        .cw-grid-char {
            position: relative;
            z-index: 1;
            color: #bbb;
            font-weight: 400;
            text-align: center;
            line-height: 1;
        }

        .cw-grid-char-first {
            color: #333;
            font-weight: 600;
        }

        @media print {
            .screen-toolbar {
                display: none;
            }

            .print-wrap {
                padding: 0;
                background: #fff;
            }

            .print-page {
                margin: 0;
            }
        }
    </style>
</head>
<body>
    <div class="screen-toolbar">
        <button type="button" id="popupPrintBtn">Print</button>
        <button type="button" id="popupCloseBtn">Close</button>
    </div>
    <div class="print-wrap">
        <div class="print-page">${pageMarkup}</div>
    </div>
    <script>
        (function () {
            const printNow = () => {
                window.focus();
                setTimeout(() => window.print(), 250);
            };
            const waitForReady = async () => {
                try {
                    if (document.fonts && document.fonts.ready) {
                        await document.fonts.ready;
                    }
                } catch (error) {}
                setTimeout(printNow, 80);
            };
            window.addEventListener('load', () => { waitForReady(); }, { once: true });
            window.addEventListener('afterprint', () => {
                setTimeout(() => window.close(), 250);
            });
            const popupPrintBtn = document.getElementById('popupPrintBtn');
            if (popupPrintBtn) {
                popupPrintBtn.addEventListener('click', printNow);
            }
            const popupCloseBtn = document.getElementById('popupCloseBtn');
            if (popupCloseBtn) {
                popupCloseBtn.addEventListener('click', () => window.close());
            }
        }());
    </script>
</body>
</html>`;
}

function handlePrint() {
    if (!currentSheetData) {
        window.print();
        return;
    }
    const printWindow = window.open('', '_blank');
    if (!printWindow) {
        alert('Please allow pop-ups for printing.');
        return;
    }
    const title = sheetTitle && sheetTitle.textContent
        ? sheetTitle.textContent.trim()
        : `Sheet #${sheetId}`;
    const pageMarkup = buildSheetPageMarkup(currentSheetData, 1, { showDebugBorder: false });
    printWindow.document.open();
    printWindow.document.write(buildDedicatedPrintDocumentHtml(title, pageMarkup));
    printWindow.document.close();
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
