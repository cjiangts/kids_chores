(function initPracticeStarBadgeCommon(global) {
    function clampPercent(value, fallback = 100) {
        const raw = Number.parseFloat(value);
        if (!Number.isFinite(raw)) return fallback;
        return Math.max(0, Math.min(100, Math.round(raw)));
    }

    function normalizeTierList(rawTiers) {
        return Array.isArray(rawTiers)
            ? rawTiers
                .map((tier) => String(tier || '').trim().toLowerCase())
                .filter((tier) => tier === 'gold' || tier === 'silver' || tier === 'half_silver')
            : [];
    }

    function getCategoryStarTiers({
        categoryKey,
        dailyStarTiersByCategory,
        dailyCompletedByCategory,
        normalizeCategoryKey,
    }) {
        const normalizeKeyFn = typeof normalizeCategoryKey === 'function'
            ? normalizeCategoryKey
            : ((value) => String(value || '').trim().toLowerCase());
        const key = normalizeKeyFn(categoryKey);
        const tiersFromPayload = normalizeTierList(dailyStarTiersByCategory?.[key]);
        if (tiersFromPayload.length > 0) {
            return tiersFromPayload;
        }
        const completedCount = Number.parseInt(dailyCompletedByCategory?.[key], 10);
        const safeCount = Number.isInteger(completedCount) ? Math.max(0, completedCount) : 0;
        return Array.from({ length: safeCount }, () => 'gold');
    }

    function renderProgressBadgeByTier(tier, fillPercent, isLatestTier) {
        const normalizedTier = String(tier || '').trim().toLowerCase();
        const effectiveFill = clampPercent(isLatestTier ? fillPercent : 100, 100);
        if (isLatestTier && effectiveFill < 100) {
            return `<span class="progress-badge-icon partial" aria-hidden="true" style="--badge-fill-pct:${effectiveFill}%"></span>`;
        }
        if (normalizedTier === 'silver' || normalizedTier === 'half_silver') {
            return '<span class="progress-badge-icon silver" aria-hidden="true" style="--badge-fill-pct:100%"></span>';
        }
        return `<span class="progress-badge-icon gold" aria-hidden="true" style="--badge-fill-pct:${effectiveFill}%"></span>`;
    }

    function buildCategoryStarsModel({
        categoryKey,
        dailyStarTiersByCategory,
        dailyCompletedByCategory,
        dailyPercentByCategory,
        normalizeCategoryKey,
        doneMarkClass = 'practice-done-mark',
        doneMarkText = '✅ Done',
    }) {
        const normalizeKeyFn = typeof normalizeCategoryKey === 'function'
            ? normalizeCategoryKey
            : ((value) => String(value || '').trim().toLowerCase());
        const key = normalizeKeyFn(categoryKey);
        const tiers = getCategoryStarTiers({
            categoryKey: key,
            dailyStarTiersByCategory,
            dailyCompletedByCategory,
            normalizeCategoryKey: normalizeKeyFn,
        });
        const rawPercent = Number.parseFloat(dailyPercentByCategory?.[key]);
        const hasLatestPercent = Number.isFinite(rawPercent);
        const latestPercentValue = hasLatestPercent ? Math.max(0, Math.min(100, Math.round(rawPercent))) : 0;
        const lastTierIndex = Math.max(0, tiers.length - 1);
        const latestTier = String(tiers[lastTierIndex] || '').trim().toLowerCase();
        const previousSessionCount = Math.max(0, tiers.length - 1);
        const fallbackLatestPercent = latestTier === 'gold' ? 100 : 0;
        const percentValue = (previousSessionCount * 100) + latestPercentValue;
        const cumulativePercent = (previousSessionCount * 100) + (
            hasLatestPercent ? latestPercentValue : fallbackLatestPercent
        );
        const isDoneToday = tiers.length > 0 && latestTier !== 'half_silver';
        const isStackedBadgeLayout = tiers.length > 1;
        const badgeStripClass = isStackedBadgeLayout
            ? 'progress-badge-strip progress-badge-strip-stacked'
            : 'progress-badge-strip';
        const starsHtml = tiers.length > 0
            ? `<span class="${badgeStripClass}">${tiers.map((tier, index) => (
                renderProgressBadgeByTier(tier, latestPercentValue, index === lastTierIndex)
            )).join('')}</span>`
            : '-';
        const doneMarkHtml = isDoneToday
            ? `<span class="${doneMarkClass}" aria-label="Done today" title="Done today">${doneMarkText}</span>`
            : '';
        return {
            key,
            tiers,
            latestTier,
            latestPercentValue,
            percentValue,
            cumulativePercent,
            isDoneToday,
            isStackedBadgeLayout,
            starsHtml,
            doneMarkHtml,
        };
    }

    global.PracticeStarBadgeCommon = {
        clampPercent,
        normalizeTierList,
        getCategoryStarTiers,
        renderProgressBadgeByTier,
        buildCategoryStarsModel,
    };
})(window);
