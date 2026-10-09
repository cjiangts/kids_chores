(function initReportGradingCommon(global) {
    'use strict';

    function render({ resultId, sessionId, gradeStatus, readOnly = false } = {}) {
        const resolvedResultId = Number(resultId);
        const resolvedSessionId = Number(sessionId);
        if (!Number.isFinite(resolvedResultId) || !Number.isFinite(resolvedSessionId)) return '';
        const grade = String(gradeStatus || '').toLowerCase();
        return `
            <div class="grade-row grade-segmented${readOnly ? ' is-readonly' : ''}">
                <button class="grade-btn${grade === 'pass' ? ' is-selected' : ''}" data-result-id="${resolvedResultId}" data-session-id="${resolvedSessionId}" data-grade="pass" aria-pressed="${grade === 'pass'}" ${readOnly ? 'disabled aria-disabled="true"' : ''}>Pass</button>
                <button class="grade-btn${grade === 'fail' ? ' is-selected' : ''}" data-result-id="${resolvedResultId}" data-session-id="${resolvedSessionId}" data-grade="fail" aria-pressed="${grade === 'fail'}" ${readOnly ? 'disabled aria-disabled="true"' : ''}>Fail</button>
            </div>
        `;
    }

    function attach(root, { apiBase, kidId, isReadOnly, onBeforeSave, onSaved, onError } = {}) {
        if (!root || !apiBase || !kidId) return;
        root.addEventListener('click', async (event) => {
            const btn = event.target?.closest?.('.grade-btn');
            if (!btn || !root.contains(btn)) return;
            if (typeof isReadOnly === 'function' ? isReadOnly() : Boolean(isReadOnly)) return;

            const resultId = Number(btn.dataset.resultId);
            const sessionId = Number(btn.dataset.sessionId);
            let reviewGrade = String(btn.dataset.grade || '').toLowerCase();
            if (!Number.isFinite(resultId) || !Number.isFinite(sessionId) || !['pass', 'fail'].includes(reviewGrade)) return;
            if (btn.classList.contains('is-selected')) reviewGrade = 'clear';

            const buttons = root.querySelectorAll(`.grade-btn[data-result-id="${resultId}"]`);
            buttons.forEach((node) => { node.disabled = true; });
            onBeforeSave?.();
            try {
                const response = await fetch(`${apiBase}/kids/${kidId}/report/sessions/${sessionId}/results/${resultId}/grade`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ reviewGrade }),
                });
                const saved = await response.json().catch(() => ({}));
                if (!response.ok) throw new Error(saved.error || `HTTP ${response.status}`);
                await onSaved?.({ btn, resultId, sessionId, saved });
            } catch (error) {
                console.error('Error saving grade:', error);
                onError?.(error);
            } finally {
                root.querySelectorAll(`.grade-btn[data-result-id="${resultId}"]`).forEach((node) => { node.disabled = false; });
            }
        });
    }

    global.ReportGradingCommon = { render, attach };
})(window);
