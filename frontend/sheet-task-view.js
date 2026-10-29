window.SheetTaskView = (() => {
    async function request(url, options) {
        const response = await fetch(url, options);
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
        return data;
    }
    function taskUrl(kidId, sessionId, suffix = '') {
        return `/api/kids/${encodeURIComponent(kidId)}/sheet-tasks/${sessionId}${suffix}`;
    }
    function mount(root, kidId, initialTask, review = false) {
        let task = initialTask;
        const completionReview = task.grading_policy === 'completion';
        let busy = false;
        const grades = Object.fromEntries(initialTask.items.filter((item) => item.result_id != null).map((item) => [item.id, item.correct > 0]));
        const frames = [];
        root.classList.add('sheet-task-view');
        root.replaceChildren();
        const status = document.createElement('div');
        status.className = 'sheet-task-status hidden';
        status.setAttribute('role', 'status');
        root.appendChild(status);
        const pages = document.createElement('div');
        pages.className = 'sheet-task-pages';
        root.appendChild(pages);
        let activePage = 0;
        const pager = document.createElement('div');
        pager.className = 'sheet-task-pager hidden';
        const previousPage = document.createElement('button');
        previousPage.type = 'button';
        previousPage.className = 'paradigm-btn paradigm-compact-control';
        previousPage.textContent = '←';
        previousPage.setAttribute('aria-label', 'Previous sheet page');
        const pageLabel = document.createElement('span');
        const nextPage = document.createElement('button');
        nextPage.type = 'button';
        nextPage.className = 'paradigm-btn paradigm-compact-control';
        nextPage.textContent = '→';
        nextPage.setAttribute('aria-label', 'Next sheet page');
        pager.append(previousPage, pageLabel, nextPage);
        root.appendChild(pager);
        const actions = document.createElement('div');
        actions.className = 'sheet-task-actions';
        const save = document.createElement('button');
        save.type = 'button';
        save.className = 'paradigm-btn paradigm-submit-confirm paradigm-compact-control';
        save.setAttribute('aria-label', 'Save review');
        const saveLabel = document.createElement('span');
        saveLabel.textContent = 'Save review';
        save.appendChild(saveLabel);
        const reviewCounts = (completionReview ? [] : [
            { key: 'correct', icon: 'check', label: 'correct' },
            { key: 'wrong', icon: 'x', label: 'wrong' },
        ]).map((entry) => {
            const badge = document.createElement('span');
            badge.className = `sheet-review-count is-${entry.key}`;
            badge.innerHTML = window.icon ? window.icon(entry.icon, { size: 16 }) : '●';
            const value = document.createElement('span');
            badge.appendChild(value);
            save.appendChild(badge);
            return { ...entry, badge, value };
        });
        actions.appendChild(save);
        actions.classList.toggle('hidden', !review || task.status === 'reviewed');
        root.insertBefore(actions, pages);
        function showError(message) {
            status.textContent = message;
            status.classList.add('is-error');
            status.classList.toggle('hidden', !message);
        }
        function fitPage() {
            const frame = frames[activePage];
            if (!frame || !pages.clientWidth) return;
            const ratio = Number(frame.dataset.paperRatio) || 11 / 8.5;
            let width = pages.clientWidth;
            if (window.matchMedia('(min-width: 768px)').matches) {
                const navigation = document.querySelector('.kid-app-nav');
                const navHeight = navigation && window.matchMedia('(max-width: 899px)').matches
                    && getComputedStyle(navigation).position === 'fixed' ? navigation.getBoundingClientRect().height : 0;
                const availableHeight = window.innerHeight - Math.max(16, pages.getBoundingClientRect().top)
                    - pager.getBoundingClientRect().height - navHeight - 32;
                width = Math.min(width, Math.max(1, availableHeight) / ratio);
            }
            frame.style.width = `${width}px`;
            frame.style.height = `${Math.ceil(width * ratio)}px`;
            actions.style.width = `${width}px`;
        }
        function showPage(index) {
            activePage = Math.max(0, Math.min(frames.length - 1, index));
            frames.forEach((frame, position) => frame.classList.toggle('hidden', position !== activePage));
            pager.classList.toggle('hidden', frames.length <= 1);
            previousPage.disabled = activePage === 0;
            nextPage.disabled = activePage === frames.length - 1;
            pageLabel.textContent = `${activePage + 1} / ${frames.length}`;
            fitPage();
        }
        previousPage.addEventListener('click', () => showPage(activePage - 1));
        nextPage.addEventListener('click', () => showPage(activePage + 1));
        const layoutObserver = new ResizeObserver(fitPage);
        layoutObserver.observe(root);
        window.addEventListener('resize', fitPage);
        function refresh() {
            const count = task.items.filter((item) => typeof grades[item.id] === 'boolean').length;
            const correct = task.items.filter((item) => grades[item.id] === true).length;
            const counts = { pending: task.items.length - count, correct, wrong: count - correct };
            save.disabled = busy || (!completionReview && count !== task.items.length) || !review || task.status !== 'pending_review';
            saveLabel.textContent = busy ? 'Saving…' : completionReview ? 'Confirm completed' : save.disabled ? `${counts.pending} to review` : 'Save review';
            reviewCounts.forEach(({ key, label, badge, value }) => {
                value.textContent = String(counts[key]);
                badge.title = `${counts[key]} ${label}`;
                badge.setAttribute('aria-label', badge.title);
            });
            save.setAttribute('aria-label', completionReview ? saveLabel.textContent : `${saveLabel.textContent}: ${counts.correct} correct, ${counts.wrong} wrong`);
            for (const frame of frames) frame.contentWindow?.postMessage({ type: 'sheet-task-grade-state', sessionId: task.id, grades }, location.origin);
        }
        function renderFrames() {
            pages.replaceChildren();
            frames.length = 0;
            const refs = new Map(task.items.map((item) => [`${item.sheet_kind}:${item.sheet_id}:${item.page_index}`, item]));
            for (const item of refs.values()) {
                const frame = document.createElement('iframe');
                frame.className = 'sheet-task-frame';
                frame.title = `Printed sheet #${item.sheet_id}`;
                const params = new URLSearchParams({ id: kidId, sheet: item.sheet_id, categoryKey: task.category_key, taskSession: task.id, taskPage: item.page_index, taskRole: review ? 'review' : 'child' });
                frame.src = `/${item.sheet_kind === 'type4' ? 'math-sheet-print' : 'writing-sheet-print'}.html?${params}`;
                frame.addEventListener('load', refresh);
                frames.push(frame);
                pages.appendChild(frame);
            }
            showPage(activePage);
        }
        async function submit() {
            if (busy || task.status === 'reviewed' || review) return;
            busy = true;
            showError('');
            try {
                const undo = task.status === 'pending_review';
                const url = undo ? taskUrl(kidId, task.id, '/undo') : `/api/kids/${encodeURIComponent(kidId)}/sheet-tasks/submit`;
                task = await request(url, {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ categoryKey: task.category_key, items: task.items }),
                });
                if (!task) {
                    root.textContent = 'No printed questions left. Ask a parent to finalize more sheets.';
                    return;
                }
                renderFrames();
            } catch (error) { busy = false; showError(error.message); return; }
            finally { busy = false; }
            refresh();
        }
        const receive = (event) => {
            if (event.origin !== location.origin || event.data?.sessionId !== task.id || !frames.some((frame) => frame.contentWindow === event.source)) return;
            const message = event.data;
            if (message.type === 'sheet-task-height') {
                const frame = frames.find((item) => item.contentWindow === event.source);
                const ratio = Number(message.ratio);
                if (Number.isFinite(ratio) && ratio > 0) frame.dataset.paperRatio = String(ratio);
                fitPage();
            } else if (message.type === 'sheet-task-ready') refresh();
            else if (message.type === 'sheet-task-error') showError(message.error);
            else if (message.type === 'sheet-task-complete') submit();
            else if (message.type === 'sheet-task-card-report' && review && task.status === 'reviewed') {
                const item = task.items.find((entry) => entry.id === message.itemId);
                if (!item?.card_id || !item.result_id) return;
                const params = new URLSearchParams({
                    id: String(kidId), cardId: String(item.card_id),
                    categoryKey: task.category_key, from: item.sheet_kind === 'type2' ? 'type2' : 'cards',
                    resultId: String(item.result_id),
                });
                window.location.href = `/kid-card-report.html?${params}#result-${item.result_id}`;
            }
            else if (message.type === 'sheet-task-grade' && review && !busy && task.status === 'pending_review' && task.items.some((item) => item.id === message.itemId)) {
                if (!completionReview) {
                    const previous = grades[message.itemId];
                    grades[message.itemId] = previous === true ? false : previous === false ? null : true;
                    refresh();
                }
            }
        };
        window.addEventListener('message', receive);
        save.addEventListener('click', async () => {
            if (save.disabled) return;
            if (completionReview) task.items.forEach((item) => { grades[item.id] = true; });
            busy = true;
            showError('');
            refresh();
            try {
                task = await request(taskUrl(kidId, task.id, '/review'), {
                    method: 'PUT', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ grades: task.items.map((item) => ({ id: item.id, correct: grades[item.id] })) }),
                });
                actions.classList.add('hidden');
                renderFrames();
                root.dispatchEvent(new CustomEvent('sheet-task-reviewed', { bubbles: true }));
            } catch (error) { showError(error.message); }
            finally { busy = false; refresh(); }
        });
        renderFrames();
        refresh();
        return { destroy() { window.removeEventListener('message', receive); window.removeEventListener('resize', fitPage); layoutObserver.disconnect(); } };
    }
    async function loadPractice(root, kidId, categoryKey) {
        const url = `/api/kids/${encodeURIComponent(kidId)}/sheet-tasks?${new URLSearchParams({ categoryKey })}`;
        let summary = await request(url);
        if (!summary.supported || summary.mode !== 'sheet') return false;
        const task = await request(`/api/kids/${encodeURIComponent(kidId)}/sheet-tasks/preview?${new URLSearchParams({ categoryKey })}`);
        if (task) mount(root, kidId, task);
        else {
            root.className = 'sheet-task-view sheet-task-status';
            root.textContent = summary.target_count === 0 ? 'No daily target is set.' : 'No printed questions left. Ask a parent to finalize more sheets.';
        }
        return true;
    }
    return { mount, loadPractice, request };
})();
