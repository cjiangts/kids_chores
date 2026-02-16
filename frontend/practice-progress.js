function renderPracticeProgress(textEl, fillEl, current, total, label) {
    if (!textEl || !fillEl) {
        return;
    }

    const safeTotal = Math.max(0, Number(total) || 0);
    const safeCurrentRaw = Number(current) || 0;
    const safeCurrent = safeTotal > 0 ? Math.min(Math.max(1, safeCurrentRaw), safeTotal) : 0;
    const safeLabel = label || 'Card';

    if (safeTotal <= 0) {
        textEl.textContent = `${safeLabel} 0 of 0`;
        fillEl.style.width = '0%';
        return;
    }

    textEl.textContent = `${safeLabel} ${safeCurrent} of ${safeTotal}`;
    fillEl.style.width = `${(safeCurrent / safeTotal) * 100}%`;
}

window.renderPracticeProgress = renderPracticeProgress;
