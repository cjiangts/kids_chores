(function initPointRuleTemplateCommon(window) {
    function escapeHtml(value) {
        return String(value || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function formatDelta(value) {
        const delta = Number.parseInt(value, 10) || 0;
        return `${delta > 0 ? '+' : ''}${delta}`;
    }

    function isRewardRule(rule) {
        return String(rule?.ruleKind || '') === 'redeemed_reward';
    }

    function rewardType(rule) {
        const value = String(rule?.rewardType || '').trim().toLowerCase();
        return value;
    }

    function rewardTypeLabel(value) {
        const normalized = String(value || '').trim().toLowerCase();
        return normalized
            .replace(/[_-]+/g, ' ')
            .replace(/\b\w/g, (ch) => ch.toUpperCase())
            .trim() || 'Reward';
    }

    function rulePointValue(rule) {
        const maxPoint = Number.parseInt(rule?.maxPoint, 10);
        const amount = Number.isInteger(maxPoint) && maxPoint > 0 ? maxPoint : 0;
        if (String(rule?.ruleKind || '') === 'deduction_event' || isRewardRule(rule)) {
            return -Math.abs(amount);
        }
        return Math.abs(amount);
    }

    function deltaClassForRule(rule) {
        if (isRewardRule(rule)) return 'redeemed';
        return rulePointValue(rule) >= 0 ? 'positive' : 'negative';
    }

    function iconHtml(rule, delta) {
        const emoji = String(rule?.emoji || '').trim();
        if (emoji) return escapeHtml(emoji);
        if (isRewardRule(rule) && typeof window.icon === 'function') {
            return window.icon('gift', { size: 18 });
        }
        return escapeHtml(delta < 0 ? '-' : '+');
    }

    function renderRuleRow(rule, options = {}) {
        const delta = rulePointValue(rule);
        const isActive = Boolean(options.active);
        const tag = options.element === 'div' ? 'div' : 'button';
        const type = tag === 'button' ? ' type="button"' : '';
        const role = tag === 'div' && options.role ? ` role="${escapeHtml(options.role)}"` : '';
        const data = rule?.ruleId ? ` data-rule-id="${escapeHtml(rule.ruleId)}"` : '';
        const extraClass = String(options.className || '').trim();
        const classes = [
            'point-template-row',
            isActive ? 'active' : '',
            extraClass,
        ].filter(Boolean).join(' ');
        const rewardPrefix = isRewardRule(rule)
            ? `${rewardTypeLabel(rewardType(rule))} · `
            : '';
        const deltaText = delta === 0 && isRewardRule(rule)
            ? rewardTypeLabel(rewardType(rule))
            : `${rewardPrefix}${formatDelta(delta)}`;
        const checkHtml = typeof window.icon === 'function'
            ? window.icon('check', { size: 13, strokeWidth: 3 })
            : '';
        return `
            <${tag}${type}${role} class="${classes}"${data}>
                <span class="point-rule-emoji">${iconHtml(rule, delta)}</span>
                <span class="point-template-name activity-timeline-title">${escapeHtml(rule?.name || 'Rule')}</span>
                <span class="point-rule-delta paradigm-pill ${deltaClassForRule(rule)}">${escapeHtml(deltaText)}</span>
                ${isActive && options.showCheck !== false ? `<span class="point-template-check" aria-hidden="true">${checkHtml}</span>` : ''}
            </${tag}>
        `;
    }

    window.PointRuleTemplateCommon = {
        deltaClassForRule,
        escapeHtml,
        formatDelta,
        isRewardRule,
        renderRuleRow,
        rewardType,
        rewardTypeLabel,
        rulePointValue,
    };
})(window);
