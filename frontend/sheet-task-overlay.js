window.SheetTaskOverlay = (() => {
    const query = new URLSearchParams(location.search);
    const sessionId = query.get('taskSession') === 'preview' ? 'preview' : Number(query.get('taskSession'));
    if (!sessionId) return { attach() {} };
    const review = query.get('taskRole') === 'review';
    const kid = query.get('id');
    document.documentElement.classList.add('sheet-task-embedded');
    const taskPath = sessionId === 'preview' ? `preview?${new URLSearchParams({ categoryKey: query.get('categoryKey') })}` : sessionId;
    const ready = fetch(`/api/kids/${encodeURIComponent(kid)}/sheet-tasks/${taskPath}`).then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Could not load sheet task');
        return data;
    });
    const notify = (type, extra = {}) => parent.postMessage({ type, sessionId, ...extra }, location.origin);
    const overlays = new Map();
    const preview = document.getElementById('sheetPreviewWrap');
    let paperRatio = 0;
    const resize = () => {
        if (paperRatio > 0) notify('sheet-task-height', { ratio: paperRatio });
    };
    window.addEventListener('message', (event) => {
        if (event.origin !== location.origin || event.source !== parent || event.data?.sessionId !== sessionId) return;
        if (event.data.type === 'sheet-task-grade-state') {
            for (const [id, button] of overlays) {
                const grade = event.data.grades[id];
                button.classList.toggle('is-correct', grade === true);
                button.classList.toggle('is-incorrect', grade === false);
                button.setAttribute('aria-label', `${button.dataset.questionLabel}: ${grade === true ? 'Correct' : grade === false ? 'Wrong' : 'To review'}`);
            }
        }
    });
    async function attach(container, page, rects, width, height, kind) {
        try {
            const task = await ready;
            if (!container.isConnected) return;
            paperRatio = height / width;
            const sheetId = Number(query.get('sheet'));
            const pageIndex = Number(page.page_index || 1);
            const assigned = task.items.filter((item) => item.sheet_kind === kind && item.sheet_id === sheetId && item.page_index === pageIndex);
            const pageEl = container.closest('.sheet-page') || container;
            if (!assigned.length) {
                pageEl.classList.add('hidden');
                resize();
                return;
            }
            container.style.position = 'relative';
            const layer = document.createElement('div');
            layer.className = 'sheet-task-overlay';
            const grouped = assigned.map((item) => {
                const rect = rects[item.item_index - 1];
                if (!rect) throw new Error('Printed question position is unavailable');
                return rect;
            });
            const rows = [];
            for (const rect of [...grouped].sort((a, b) => a.y - b.y || a.x - b.x)) {
                let row = rows.find((entry) => Math.abs(entry.top - rect.y) < 0.5);
                if (!row) {
                    row = { left: rect.x, right: rect.x + rect.width, top: rect.y, bottom: rect.y + rect.height };
                    rows.push(row);
                } else {
                    row.left = Math.min(row.left, rect.x);
                    row.right = Math.max(row.right, rect.x + rect.width);
                    row.bottom = Math.max(row.bottom, rect.y + rect.height);
                }
            }
            if (review) {
                const allRows = [];
                for (const rect of [...rects].sort((a, b) => a.y - b.y || a.x - b.x)) {
                    let row = allRows.find((entry) => Math.abs(entry.top - rect.y) < 0.5);
                    if (!row) {
                        row = { top: rect.y, bottom: rect.y + rect.height, cells: [] };
                        allRows.push(row);
                    }
                    row.bottom = Math.max(row.bottom, rect.y + rect.height);
                    row.cells.push(rect);
                }
                const assignedByIndex = new Map(assigned.map((item) => [item.item_index - 1, item]));
                rects.forEach((original, index) => {
                    const item = assignedByIndex.get(index);
                    const rowIndex = allRows.findIndex((row) => Math.abs(row.top - original.y) < 0.5);
                    const row = allRows[rowIndex];
                    const cells = row.cells;
                    const column = cells.indexOf(original);
                    const left = column ? (cells[column - 1].x + cells[column - 1].width + original.x) / 2 : original.x;
                    const right = column < cells.length - 1 ? (original.x + original.width + cells[column + 1].x) / 2 : original.x + original.width;
                    const top = rowIndex ? (allRows[rowIndex - 1].bottom + row.top) / 2 : row.top;
                    const bottom = rowIndex < allRows.length - 1 ? (row.bottom + allRows[rowIndex + 1].top) / 2 : row.bottom;
                    const rect = { x: left, y: top, width: right - left, height: bottom - top };
                    if (!item) {
                        const muted = document.createElement('div');
                        muted.className = 'sheet-task-question-muted';
                        muted.setAttribute('aria-hidden', 'true');
                        muted.style.cssText = `left:${100 * rect.x / width}%;top:${100 * rect.y / height}%;width:${100 * rect.width / width}%;height:${100 * rect.height / height}%;`;
                        layer.appendChild(muted);
                        return;
                    }
                    const button = document.createElement('button');
                    button.type = 'button';
                    button.className = 'sheet-task-question';
                    button.style.cssText = `left:${100 * rect.x / width}%;top:${100 * rect.y / height}%;width:${100 * rect.width / width}%;height:${100 * rect.height / height}%;`;
                    button.dataset.questionLabel = `Page ${pageIndex}, question ${item.item_index}`;
                    button.setAttribute('aria-label', `${button.dataset.questionLabel}: To review`);
                    const reportLink = task.status === 'reviewed' && item.card_id != null;
                    button.disabled = !reportLink && (task.status === 'reviewed' || task.grading_policy === 'completion');
                    button.classList.toggle('is-report-link', reportLink);
                    if (reportLink) button.title = 'View card report';
                    button.addEventListener('click', () => notify(reportLink ? 'sheet-task-card-report' : 'sheet-task-grade', { itemId: item.id }));
                    overlays.set(item.id, button);
                    layer.appendChild(button);
                });
            } else {
                // Join the assigned row spans into one stepped outline, including a partial last row.
                const rightEdge = [];
                const leftEdge = [];
                rows.forEach((row, index) => {
                    const top = index ? (rows[index - 1].bottom + row.top) / 2 : row.top;
                    const bottom = index < rows.length - 1 ? (row.bottom + rows[index + 1].top) / 2 : row.bottom;
                    rightEdge.push([row.right, top], [row.right, bottom]);
                    leftEdge.push([row.left, top], [row.left, bottom]);
                });
                const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
                svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
                svg.setAttribute('preserveAspectRatio', 'none');
                svg.setAttribute('role', 'button');
                svg.setAttribute('tabindex', task.status === 'reviewed' ? '-1' : '0');
                svg.setAttribute('aria-label', task.completed_at ? 'Undo completion' : 'Mark highlighted work complete');
                svg.setAttribute('aria-pressed', String(Boolean(task.completed_at)));
                svg.setAttribute('aria-disabled', String(task.status === 'reviewed'));
                svg.classList.add('sheet-task-region');
                svg.classList.toggle('is-completed', Boolean(task.completed_at));
                const polygon = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
                polygon.setAttribute('points', [...rightEdge, ...leftEdge.reverse()].map((point) => point.join(',')).join(' '));
                svg.appendChild(polygon);
                const toggleComplete = () => {
                    if (task.status !== 'reviewed') notify('sheet-task-complete');
                };
                svg.addEventListener('click', toggleComplete);
                svg.addEventListener('keydown', (event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        toggleComplete();
                    }
                });
                layer.appendChild(svg);
                if (task.completed_at) {
                    const mark = document.createElement('div');
                    mark.className = 'sheet-task-block-check';
                    mark.textContent = 'DONE';
                    const left = Math.min(...grouped.map((rect) => rect.x));
                    const top = Math.min(...grouped.map((rect) => rect.y));
                    const right = Math.max(...grouped.map((rect) => rect.x + rect.width));
                    const bottom = Math.max(...grouped.map((rect) => rect.y + rect.height));
                    mark.style.cssText = `left:${100 * left / width}%;top:${100 * top / height}%;width:${100 * (right - left) / width}%;height:${100 * (bottom - top) / height}%;`;
                    layer.appendChild(mark);
                }
            }
            container.appendChild(layer);
            notify('sheet-task-ready');
            resize();
        } catch (error) {
            notify('sheet-task-error', { error: error.message });
        }
    }
    new ResizeObserver(resize).observe(preview);
    return { attach };
})();
