/*
 * kid-card-manage-cards-priority.js — filtering, sorting, practice-
 * priority preview, selection, queue legend, and save-state for the
 * kid-card-manage page's "Cards" view.
 *
 * Practice-priority is the heart of this file: it scores each card with
 * a published reason ("Never seen", "Wrong recently", ...) and renders a
 * compact score bar with an explanatory legend. Queue mix legend tells the
 * user how many cards of each priority bucket a session will sample given
 * the current session count.
 *
 * Layout (search for `// === N. ` banners to jump between sections):
 *
 *     1. Filter + search (query, source-deck)
 *     2. Sort: comparators + display ordering
 *     3. Practice priority scoring + segment helpers + compact summary
 *     4. Visible cards + queue highlight + queue mix legend
 *     5. Selection (bar, select mode, multi-select)
 *     6. UI controls (sort menu, view-mode buttons)
 *     7. Queue settings + drill-speed save state
 *     8. Queue preview reload + auto-set session count on new cards
 */

// =====================================================================
// === 1. Filter + search
// =====================================================================
function filterCardsByQuery(cards, rawQuery) {
    const query = String(rawQuery || '').trim();
    if (!query) {
        return cards;
    }
    return cards.filter((card) => {
        const front = String(card.front || '');
        const back = String(card.back || '');
        const source = String(resolveCardSourceDeckName(card) || '');
        return front.includes(query) || back.includes(query) || source.includes(query);
    });
}

function getCardSourceDeckFilterKey(card) {
    const raw = String(card?.source_deck_label || card?.source_deck_name || '').trim();
    const normalized = raw.toLowerCase().replace(/[\s_]+/g, '');
    if (
        Boolean(card?.source_is_orphan)
        || normalized === 'orphan'
        || normalized === 'orphandeck'
        || normalized === 'personaldeck'
        || normalized === 'personaldecks'
    ) {
        return '__personal__';
    }
    return raw;
}

function getSourceDeckFilterOptions(cards) {
    const map = new Map();
    (Array.isArray(cards) ? cards : []).forEach((card) => {
        const key = getCardSourceDeckFilterKey(card);
        if (!key) {
            return;
        }
        if (!map.has(key)) {
            map.set(key, { label: resolveCardSourceDeckName(card), count: 0 });
        }
        map.get(key).count += 1;
    });
    return Array.from(map.entries())
        .map(([key, value]) => ({ key, label: value.label, count: value.count }))
        .sort((a, b) => String(a.label).localeCompare(String(b.label)));
}

function filterCardsBySourceDeck(cards, filterKey) {
    const key = String(filterKey || '').trim();
    if (!key) {
        return Array.isArray(cards) ? cards : [];
    }
    return (Array.isArray(cards) ? cards : []).filter((card) => getCardSourceDeckFilterKey(card) === key);
}

// =====================================================================
// === 2. Sort: comparators + display ordering
// =====================================================================
function getSortedCardsForDisplay(cards) {
    const sourceFiltered = filterCardsBySourceDeck(cards, currentSourceDeckFilter);
    if (isType4Behavior()) {
        return window.PracticeManageCommon.sortCardsForView(sourceFiltered, CARD_SORT_MODE_ADDED_TIME);
    }
    const filteredCards = filterCardsByQuery(sourceFiltered, cardSearchInput ? cardSearchInput.value : '');
    return sortCardsForDisplay(filteredCards, getSelectedCardSortMode(), getCurrentCardSortDirection());
}

function buildSourceDeckFilterMenuItems() {
    if (!sourceDeckFilterPopover) {
        return;
    }
    sourceDeckFilterPopover.innerHTML = '';
    const totalCount = (Array.isArray(currentCards) ? currentCards : []).length;
    const options = [
        { key: '', label: 'All decks', count: totalCount },
        ...getSourceDeckFilterOptions(currentCards),
    ];
    options.forEach((option) => {
        const item = document.createElement('button');
        item.type = 'button';
        item.className = 'sort-menu-item';
        item.setAttribute('role', 'menuitemradio');
        item.dataset.value = option.key;
        item.dataset.label = option.label;
        item.dataset.count = String(option.count || 0);
        item.innerHTML = `
            ${window.icon('check', { className: 'sort-menu-item-check', strokeWidth: 2.6 })}
            <span class="sort-menu-item-label"></span>
            <span class="sort-menu-item-count"></span>
        `;
        item.querySelector('.sort-menu-item-label').textContent = option.label;
        item.querySelector('.sort-menu-item-count').textContent = String(option.count || 0);
        item.addEventListener('click', () => {
            if (currentSourceDeckFilter !== option.key) {
                currentSourceDeckFilter = option.key;
                syncSourceDeckFilterMenu();
                resetAndDisplayCards(currentCards);
            }
            setSourceDeckFilterMenuOpen(false);
            if (sourceDeckFilterBtn) {
                sourceDeckFilterBtn.focus();
            }
        });
        sourceDeckFilterPopover.appendChild(item);
    });
}

function syncSourceDeckFilterMenu() {
    if (!sourceDeckFilterPopover) {
        return;
    }
    const items = Array.from(sourceDeckFilterPopover.querySelectorAll('.sort-menu-item'));
    const validKeys = new Set(items.map((item) => item.dataset.value));
    if (!validKeys.has(currentSourceDeckFilter)) {
        currentSourceDeckFilter = '';
    }
    items.forEach((item) => {
        const isSelected = item.dataset.value === currentSourceDeckFilter;
        item.classList.toggle('selected', isSelected);
        item.setAttribute('aria-checked', isSelected ? 'true' : 'false');
    });
    if (sourceDeckFilterBtnLabel) {
        const selectedItem = items.find((item) => item.dataset.value === currentSourceDeckFilter);
        const labelText = selectedItem ? selectedItem.dataset.label || 'All decks' : 'All decks';
        const countText = selectedItem ? selectedItem.dataset.count || '0' : '0';
        sourceDeckFilterBtnLabel.textContent = `${labelText} (${countText})`;
    }
}

function refreshSourceDeckFilterMenu() {
    buildSourceDeckFilterMenuItems();
    syncSourceDeckFilterMenu();
}

function setSourceDeckFilterMenuOpen(open) {
    if (!sourceDeckFilterBtn || !sourceDeckFilterPopover) {
        return;
    }
    sourceDeckFilterPopover.classList.toggle('hidden', !open);
    sourceDeckFilterPopover.setAttribute('aria-hidden', open ? 'false' : 'true');
    sourceDeckFilterBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
}

function isSourceDeckFilterMenuOpen() {
    return !!(sourceDeckFilterPopover && !sourceDeckFilterPopover.classList.contains('hidden'));
}

function isPracticePriorityQueueOrderSelected() {
    return getSelectedCardSortMode() === CARD_SORT_MODE_PRACTICE_QUEUE;
}

function usesPracticePriorityDisplay() {
    return supportsPracticePriorityPreview() && !isType4Behavior();
}

function isCardInPendingWorksheet(card) {
    if (!card) {
        return false;
    }
    if (Boolean(card.pending_sheet)) {
        return true;
    }
    const writingState = Number.parseInt(card.writing_state, 10);
    return Number.isInteger(writingState) && writingState === 3;
}

function compareCardIdentity(a, b) {
    const aId = Number.parseInt(a && a.id, 10);
    const bId = Number.parseInt(b && b.id, 10);
    if (Number.isInteger(aId) && Number.isInteger(bId) && aId !== bId) {
        return aId - bId;
    }
    return String(a && a.front || '').localeCompare(String(b && b.front || ''));
}

function compareNullableSortValues(aValue, bValue, direction, missingBehavior = 'last') {
    const aMissing = !Number.isFinite(aValue);
    const bMissing = !Number.isFinite(bValue);
    if (aMissing || bMissing) {
        if (aMissing && bMissing) {
            return 0;
        }
        if (missingBehavior === 'directional') {
            return direction === CARD_SORT_DIRECTION_DESC
                ? (aMissing ? -1 : 1)
                : (aMissing ? 1 : -1);
        }
        return aMissing ? 1 : -1;
    }
    return direction === CARD_SORT_DIRECTION_DESC
        ? bValue - aValue
        : aValue - bValue;
}

function getCardIncorrectRateSortValue(card) {
    const value = getCardOverallWrongRateValue(card);
    return Number.isFinite(value) ? value : null;
}

function getCardAvgResponseTimeSortValue(card) {
    const avg = Number(card && card.practice_priority_avg_correct_response_time);
    if (Number.isFinite(avg) && avg > 0) {
        return avg;
    }
    const fallback = getCardLastResponseTimeValue(card);
    return Number.isFinite(fallback) && fallback > 0 ? fallback : null;
}

function getCardLifetimeAttemptsSortValue(card) {
    const attempts = Number.parseInt(card && card.lifetime_attempts, 10);
    return Number.isInteger(attempts) ? Math.max(0, attempts) : 0;
}

function getCardLastSeenAgeSortValue(card) {
    const seenAt = window.PracticeManageCommon.parseTime(card && card.last_seen_at);
    if (!Number.isFinite(seenAt) || seenAt <= 0) {
        return null;
    }
    return Date.now() - seenAt;
}

function getCardAddedTimeSortValue(card) {
    const createdAt = window.PracticeManageCommon.parseTime(card && card.created_at);
    return Number.isFinite(createdAt) && createdAt > 0 ? createdAt : null;
}

function getCardThumbDownsSortValue(card) {
    const count = Number.parseInt(card && card.thumb_down_count, 10);
    return Number.isInteger(count) ? Math.max(0, count) : 0;
}

function comparePracticeQueueCards(a, b, direction) {
    const aSkipped = Boolean(a && a.skip_practice);
    const bSkipped = Boolean(b && b.skip_practice);
    if (aSkipped !== bSkipped) {
        return aSkipped ? 1 : -1;
    }
    const aInWorksheet = isCardInPendingWorksheet(a);
    const bInWorksheet = isCardInPendingWorksheet(b);
    if (aInWorksheet !== bInWorksheet) {
        return aInWorksheet ? 1 : -1;
    }
    const aRaw = Number(a && a.practice_priority_order);
    const bRaw = Number(b && b.practice_priority_order);
    const aOrder = Number.isFinite(aRaw) ? aRaw : Number.MAX_SAFE_INTEGER;
    const bOrder = Number.isFinite(bRaw) ? bRaw : Number.MAX_SAFE_INTEGER;
    if (aOrder !== bOrder) {
        return direction === CARD_SORT_DIRECTION_DESC
            ? aOrder - bOrder
            : bOrder - aOrder;
    }
    return compareCardIdentity(a, b);
}

function compareMetricCards(a, b, mode, direction) {
    let comparison = 0;
    if (mode === CARD_SORT_MODE_INCORRECT_RATE) {
        comparison = compareNullableSortValues(
            getCardIncorrectRateSortValue(a),
            getCardIncorrectRateSortValue(b),
            direction,
            'last'
        );
    } else if (mode === CARD_SORT_MODE_AVG_RESPONSE_TIME) {
        comparison = compareNullableSortValues(
            getCardAvgResponseTimeSortValue(a),
            getCardAvgResponseTimeSortValue(b),
            direction,
            'last'
        );
    } else if (mode === CARD_SORT_MODE_LIFETIME_ATTEMPTS) {
        comparison = compareNullableSortValues(
            getCardLifetimeAttemptsSortValue(a),
            getCardLifetimeAttemptsSortValue(b),
            direction,
            'last'
        );
    } else if (mode === CARD_SORT_MODE_LAST_SEEN) {
        comparison = compareNullableSortValues(
            getCardLastSeenAgeSortValue(a),
            getCardLastSeenAgeSortValue(b),
            direction,
            'directional'
        );
    } else if (mode === CARD_SORT_MODE_ADDED_TIME) {
        comparison = compareNullableSortValues(
            getCardAddedTimeSortValue(a),
            getCardAddedTimeSortValue(b),
            direction,
            'last'
        );
    } else if (mode === CARD_SORT_MODE_THUMB_DOWNS) {
        comparison = compareNullableSortValues(
            getCardThumbDownsSortValue(a),
            getCardThumbDownsSortValue(b),
            direction,
            'last'
        );
    }
    if (comparison !== 0) {
        return comparison;
    }
    return compareCardIdentity(a, b);
}

function sortCardsForDisplay(cards, mode, direction) {
    const normalizedMode = normalizeCardSortMode(mode);
    const normalizedDirection = normalizeCardSortDirection(direction);
    const copy = [...(Array.isArray(cards) ? cards : [])];
    const innerCompare = normalizedMode === CARD_SORT_MODE_PRACTICE_QUEUE
        ? (a, b) => comparePracticeQueueCards(a, b, normalizedDirection)
        : (a, b) => compareMetricCards(a, b, normalizedMode, normalizedDirection);
    return copy.sort((a, b) => {
        const aSkipped = !!(a && a.skip_practice);
        const bSkipped = !!(b && b.skip_practice);
        if (aSkipped !== bSkipped) {
            return aSkipped ? 1 : -1;
        }
        return innerCompare(a, b);
    });
}

// =====================================================================
// === 3. Practice priority scoring + detail markup
// =====================================================================
function getPracticePriorityAttemptCount(card) {
    const previewAttempts = Number.parseInt(card && card.practice_priority_attempt_count, 10);
    if (Number.isInteger(previewAttempts)) {
        return Math.max(0, previewAttempts);
    }
    const lifetimeAttempts = Number.parseInt(card && card.lifetime_attempts, 10);
    return Number.isInteger(lifetimeAttempts) ? Math.max(0, lifetimeAttempts) : 0;
}

function isNeverPracticedPriorityCard(card) {
    return getPracticePriorityAttemptCount(card) <= 0;
}

function getPracticePriorityPoints(card, reason) {
    if (reason === PRACTICE_PRIORITY_REASON_MISSED) {
        const value = Number(card && card.practice_priority_missed_points);
        return Number.isFinite(value) ? Math.max(0, value) : 0;
    }
    if (reason === PRACTICE_PRIORITY_REASON_SLOW) {
        const value = Number(card && card.practice_priority_slow_points);
        return Number.isFinite(value) ? Math.max(0, value) : 0;
    }
    if (reason === PRACTICE_PRIORITY_REASON_DUE) {
        const value = Number(card && card.practice_priority_due_points);
        return Number.isFinite(value) ? Math.max(0, value) : 0;
    }
    const value = Number(card && card.practice_priority_learning_points);
    return Number.isFinite(value) ? Math.max(0, value) : 0;
}

function getPracticePriorityCompactReason(card) {
    const explicit = String(card && card.practice_priority_primary_reason || '').trim().toLowerCase();
    if (
        explicit === PRACTICE_PRIORITY_REASON_MISSED
        || explicit === PRACTICE_PRIORITY_REASON_SLOW
        || explicit === PRACTICE_PRIORITY_REASON_LEARNING
        || explicit === PRACTICE_PRIORITY_REASON_DUE
    ) {
        return explicit;
    }
    const scores = [
        [PRACTICE_PRIORITY_REASON_MISSED, getPracticePriorityPoints(card, PRACTICE_PRIORITY_REASON_MISSED)],
        [PRACTICE_PRIORITY_REASON_SLOW, getPracticePriorityPoints(card, PRACTICE_PRIORITY_REASON_SLOW)],
        [PRACTICE_PRIORITY_REASON_LEARNING, getPracticePriorityPoints(card, PRACTICE_PRIORITY_REASON_LEARNING)],
        [PRACTICE_PRIORITY_REASON_DUE, getPracticePriorityPoints(card, PRACTICE_PRIORITY_REASON_DUE)],
    ];
    scores.sort((a, b) => {
        const aValue = Number.isFinite(a[1]) ? a[1] : -1;
        const bValue = Number.isFinite(b[1]) ? b[1] : -1;
        return bValue - aValue;
    });
    return scores[0] ? scores[0][0] : PRACTICE_PRIORITY_REASON_LEARNING;
}

function getPracticePriorityDisplayReason(card) {
    if (isNeverPracticedPriorityCard(card)) {
        return PRACTICE_PRIORITY_REASON_NEW;
    }
    return getPracticePriorityCompactReason(card);
}

function getPracticePriorityScoreValue(card) {
    const value = Number(card && card.practice_priority_score);
    return Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : null;
}

function getPracticePriorityReferenceMaxScore() {
    if (!Array.isArray(sortedCards) || !sortedCards.length) {
        return null;
    }
    let maxScore = null;
    for (const card of sortedCards) {
        if (!card || card.skip_practice) {
            continue;
        }
        const score = getPracticePriorityScoreValue(card);
        if (!Number.isFinite(score) || score <= 0) {
            continue;
        }
        if (!Number.isFinite(maxScore) || score > maxScore) {
            maxScore = score;
        }
    }
    return Number.isFinite(maxScore) ? maxScore : null;
}

function formatPracticePriorityScore(score) {
    const numeric = Number(score);
    if (!Number.isFinite(numeric)) {
        return '-';
    }
    const rounded = Math.round(numeric * 10) / 10;
    return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

function getPracticePrioritySegments(card) {
    return [
        {
            key: PRACTICE_PRIORITY_REASON_MISSED,
            label: 'Missed',
            points: getPracticePriorityPoints(card, PRACTICE_PRIORITY_REASON_MISSED),
        },
        {
            key: PRACTICE_PRIORITY_REASON_SLOW,
            label: 'Slow',
            points: getPracticePriorityPoints(card, PRACTICE_PRIORITY_REASON_SLOW),
        },
        {
            key: PRACTICE_PRIORITY_REASON_LEARNING,
            label: 'Learning',
            points: getPracticePriorityPoints(card, PRACTICE_PRIORITY_REASON_LEARNING),
        },
        {
            key: PRACTICE_PRIORITY_REASON_DUE,
            label: 'Due',
            points: getPracticePriorityPoints(card, PRACTICE_PRIORITY_REASON_DUE),
        },
    ];
}

function getPracticePrioritySegmentDisplayLabel(card, segment) {
    if (segment && segment.key === PRACTICE_PRIORITY_REASON_LEARNING && isNeverPracticedPriorityCard(card)) {
        return 'New';
    }
    return String(segment && segment.label ? segment.label : '').trim() || 'Learning';
}

function getPracticePriorityDaysSinceLastSeenValue(card) {
    if (isNeverPracticedPriorityCard(card)) {
        return null;
    }
    const explicit = Number.parseInt(card && card.practice_priority_days_since_last_seen, 10);
    if (Number.isInteger(explicit)) {
        return Math.max(0, explicit);
    }
    const lastSeenIso = card && card.last_seen_at;
    if (!lastSeenIso) {
        return null;
    }
    const lastSeenMs = Date.parse(lastSeenIso);
    if (!Number.isFinite(lastSeenMs)) {
        return null;
    }
    return Math.max(0, Math.floor((Date.now() - lastSeenMs) / 86400000));
}

function getPracticePriorityCorrectStats(card) {
    const attempts = getPracticePriorityAttemptCount(card);
    const explicitRate = Number.parseFloat(card && card.practice_priority_correct_rate);
    let correctRate;
    if (Number.isFinite(explicitRate)) {
        correctRate = explicitRate;
    } else {
        const wrongRate = Number.parseFloat(card && card.overall_wrong_rate);
        correctRate = Number.isFinite(wrongRate) ? Math.max(0, 100 - wrongRate) : null;
    }
    const explicitCorrect = Number.parseInt(card && card.practice_priority_correct_count, 10);
    const explicitWrong = Number.parseInt(card && card.practice_priority_wrong_count, 10);
    let correctCount;
    let wrongCount;
    if (Number.isInteger(explicitCorrect) && Number.isInteger(explicitWrong)) {
        correctCount = Math.max(0, explicitCorrect);
        wrongCount = Math.max(0, explicitWrong);
    } else if (Number.isFinite(correctRate) && attempts > 0) {
        correctCount = Math.max(0, Math.min(attempts, Math.round(attempts * correctRate / 100)));
        wrongCount = Math.max(0, attempts - correctCount);
    } else {
        correctCount = 0;
        wrongCount = 0;
    }
    return { correctCount, wrongCount, correctRate };
}

function getPracticePriorityLastResultTone(card) {
    const value = String(card && card.last_result || '').trim().toLowerCase();
    if (value === 'right') {
        return 'right';
    }
    if (value === 'wrong') {
        return 'wrong';
    }
    return 'neutral';
}

function getPracticePriorityRankText(card) {
    const order = Number(card && card.practice_priority_order);
    if (!Number.isFinite(order) || order <= 0) {
        return '';
    }
    const activeCount = Array.isArray(sortedCards)
        ? sortedCards.filter((queueCard) => !queueCard.skip_practice && !isCardInPendingWorksheet(queueCard)).length
        : 0;
    return `Rank #${order}${activeCount > 0 ? ` of ${activeCount}` : ''}`;
}

function buildPracticePriorityRankMeta(card) {
    const rankText = getPracticePriorityRankText(card);
    if (!rankText) {
        return '';
    }
    const compactRankText = rankText
        .replace(/^Rank\s+#?/i, '')
        .replace(/\s+of\s+/i, ' / ');
    return `<span class="card-priority-rank">${icon('list-ordered', { size: 13, strokeWidth: 2.3 })}<span>${escapeHtml(compactRankText)}</span></span>`;
}

function buildPracticePriorityHeroAside(card, options = {}) {
    if (!usesPracticePriorityDisplay()) {
        return '';
    }
    const actionControlsHtml = String(options.actionControlsHtml || '');
    return `
        <div class="practice-priority-hero-aside">
            ${actionControlsHtml}
        </div>
    `;
}

function getPracticePriorityLegendDetail(card, segment) {
    const key = String(segment && segment.key ? segment.key : '');
    if (key === PRACTICE_PRIORITY_REASON_MISSED) {
        const correctRate = getPracticePriorityCorrectStats(card).correctRate;
        const wrongRate = Number.isFinite(correctRate) ? Math.max(0, 100 - correctRate) : 0;
        const lastWrong = getPracticePriorityLastResultTone(card) === 'wrong';
        return `${formatMetricPercent(wrongRate)} wrong${lastWrong ? ' · last wrong' : ''}`;
    }
    if (key === PRACTICE_PRIORITY_REASON_SLOW) {
        const avg = Number(card && card.practice_priority_avg_correct_response_time);
        const baseline = currentPracticePrioritySubjectBaseline || {};
        const p50 = Number(baseline.p50_correct_time);
        const p95 = Number(baseline.p95_correct_time);
        if (!Number.isFinite(avg) || avg <= 0 || !Number.isFinite(p50) || !Number.isFinite(p95) || p95 <= p50) {
            return 'p-';
        }
        const percentile = Math.round(Math.max(1, Math.min(99, 50 + ((avg - p50) / (p95 - p50)) * 45)));
        return `p${percentile}`;
    }
    if (key === PRACTICE_PRIORITY_REASON_LEARNING) {
        const remaining = Math.max(0, PRACTICE_PRIORITY_LEARNING_TARGET_ATTEMPTS - getPracticePriorityAttemptCount(card));
        return `${remaining} more`;
    }
    if (key === PRACTICE_PRIORITY_REASON_DUE) {
        const daysSinceLastSeen = getPracticePriorityDaysSinceLastSeenValue(card);
        return Number.isFinite(daysSinceLastSeen) ? `${daysSinceLastSeen}d` : 'Never';
    }
    return '';
}

function buildPracticePriorityScoreSection(card) {
    if (!usesPracticePriorityDisplay()) {
        return '';
    }
    const score = getPracticePriorityScoreValue(card);
    if (!Number.isFinite(score) || score <= 0) {
        return '';
    }
    const segments = getPracticePrioritySegments(card);
    const referenceMaxScore = getPracticePriorityReferenceMaxScore();
    const scaleBase = Number.isFinite(referenceMaxScore) && referenceMaxScore > 0
        ? referenceMaxScore
        : score;
    const positiveSegments = segments.filter((segment) => segment.points > 0);
    const barHtml = positiveSegments
        .map((segment) => (
            `<span class="practice-priority-score-segment ${segment.key}" style="width:${Math.max(0, Math.min(100, (segment.points / scaleBase) * 100)).toFixed(2)}%" title="${escapeHtml(`${segment.label}: +${formatPracticePriorityScore(segment.points)}`)}"></span>`
        ))
        .join('');
    const legendHtml = positiveSegments.length > 0
        ? positiveSegments.map((segment) => {
            const detail = getPracticePriorityLegendDetail(card, segment);
            const isMissed = segment.key === PRACTICE_PRIORITY_REASON_MISSED;
            const isSlow = segment.key === PRACTICE_PRIORITY_REASON_SLOW;
            const isDue = segment.key === PRACTICE_PRIORITY_REASON_DUE;
            const isLearning = segment.key === PRACTICE_PRIORITY_REASON_LEARNING;
            return `
                <span class="practice-priority-score-legend-item ${segment.key}">
                    ${isMissed
                        ? `<span class="practice-priority-score-legend-icon" aria-hidden="true">${icon('circle-x', { size: 13 })}</span>`
                        : (isSlow
                            ? `<span class="practice-priority-score-legend-icon" aria-hidden="true">${icon('clock', { size: 13 })}</span>`
                            : (isDue
                                ? `<span class="practice-priority-score-legend-icon" aria-hidden="true">${icon('calendar-clock', { size: 13 })}</span>`
                                : (isLearning
                                    ? `<span class="practice-priority-score-legend-icon" aria-hidden="true">${icon('repeat', { size: 13 })}</span>`
                                    : '<span class="practice-priority-score-legend-dot" aria-hidden="true"></span>')))}
                    ${isMissed || isSlow || isDue || isLearning ? '' : `<span class="practice-priority-score-legend-label">${escapeHtml(segment.label)}</span>`}
                    ${detail ? `<span class="practice-priority-score-legend-detail">${escapeHtml(detail)}</span>` : ''}
                </span>
            `;
        }).join('')
        : '';
    return `
        <div class="practice-priority-score-block">
            <div class="practice-priority-score-bar" aria-hidden="true">
                ${barHtml}
            </div>
            ${legendHtml ? `<div class="practice-priority-score-legend">${legendHtml}</div>` : ''}
        </div>
    `;
}

// =====================================================================
// === 4. Visible cards + queue highlight + queue mix legend
// =====================================================================
function getCardIdText(card) {
    const raw = String(card && card.id ? card.id : '').trim();
    return raw;
}

function getQueueHighlightMap(cards) {
    if (isType4Behavior()) {
        return new Map();
    }

    if (getSelectedCardSortMode() === CARD_SORT_MODE_THUMB_DOWNS) {
        const highlights = new Map();
        (Array.isArray(cards) ? cards : []).forEach((card) => {
            const count = Number.parseInt(card && card.thumb_down_count, 10);
            if (!Number.isInteger(count) || count <= 0) {
                return;
            }
            const cardId = getCardIdText(card);
            if (cardId) {
                highlights.set(cardId, 'missed');
            }
        });
        return highlights;
    }

    const targetCount = getSessionCardCountForMixLegend();
    if (targetCount <= 0) {
        return new Map();
    }

    if (usesPracticePriorityDisplay()) {
        const orderedQueueCards = window.PracticeManageCommon.sortCardsForView(
            (Array.isArray(cards) ? cards : []).filter((card) => {
                if (!card || card.skip_practice || isCardInPendingWorksheet(card)) {
                    return false;
                }
                const rawOrder = Number(card.practice_priority_order);
                return Number.isFinite(rawOrder);
            }),
            'new_queue'
        );
        const nextSessionCards = orderedQueueCards.slice(0, targetCount);
        if (!nextSessionCards.length) {
            return new Map();
        }
        const highlights = new Map();
        nextSessionCards.forEach((card) => {
            const cardId = getCardIdText(card);
            if (!cardId) {
                return;
            }
            highlights.set(cardId, getPracticePriorityCompactReason(card));
        });
        return highlights;
    }

    const isClassicQueue = isNextSessionQueueOrderSelected();
    if (!isClassicQueue) {
        return new Map();
    }

    const orderedQueueCards = window.PracticeManageCommon.sortCardsForView(
        (Array.isArray(cards) ? cards : []).filter((card) => {
            if (!card || card.skip_practice || isCardInPendingWorksheet(card)) {
                return false;
            }
            const rawOrder = Number(card.next_session_order);
            return Number.isFinite(rawOrder);
        }),
        'queue'
    );
    const nextSessionCards = orderedQueueCards.slice(0, targetCount);
    if (!nextSessionCards.length) {
        return new Map();
    }

    let redPrefixCount = 0;
    while (
        redPrefixCount < nextSessionCards.length
        && String(nextSessionCards[redPrefixCount] && nextSessionCards[redPrefixCount].last_result || '').toLowerCase() === 'wrong'
    ) {
        redPrefixCount += 1;
    }

    const highlights = new Map();
    nextSessionCards.forEach((card, index) => {
        const cardId = getCardIdText(card);
        if (!cardId) {
            return;
        }
        if (index < redPrefixCount) {
            highlights.set(cardId, 'last-failed');
            return;
        }
        highlights.set(cardId, 'least');
    });
    return highlights;
}

function getVisibleCardsForDisplay(cards) {
    return getSortedCardsForDisplay(cards);
}

function updateCardsQueueLegendVisibility(cardCount = sortedCards.length) {
    if (!cardsQueueLegend) {
        return;
    }
    const sortingByThumbDowns = getSelectedCardSortMode() === CARD_SORT_MODE_THUMB_DOWNS;
    const shouldShow = (usesPracticePriorityDisplay() || sortingByThumbDowns)
        && Number.parseInt(cardCount, 10) > 0;
    if (shouldShow) {
        if (sortingByThumbDowns) {
            cardsQueueLegend.innerHTML = '<span class="cards-queue-legend-item missed"><span class="cards-queue-legend-dot" aria-hidden="true"></span>Thumbed-down</span>';
        } else {
            const missedLegendHtml = isType3Behavior()
                ? ''
                : '<span class="cards-queue-legend-item missed"><span class="cards-queue-legend-dot" aria-hidden="true"></span>Missed</span>';
            const slowLegendHtml = (isType2Behavior() || isType3Behavior())
                ? ''
                : '<span class="cards-queue-legend-item slow"><span class="cards-queue-legend-dot" aria-hidden="true"></span>Slow</span>';
            const worksheetLegendHtml = isType2Behavior()
                ? '<span class="cards-queue-legend-item worksheet"><span class="cards-queue-legend-dot" aria-hidden="true"></span>In worksheet</span>'
                : '';
            cardsQueueLegend.innerHTML = `
                ${missedLegendHtml}
                ${slowLegendHtml}
                <span class="cards-queue-legend-item learning"><span class="cards-queue-legend-dot" aria-hidden="true"></span>Learning</span>
                <span class="cards-queue-legend-item due"><span class="cards-queue-legend-dot" aria-hidden="true"></span>Due</span>
                ${worksheetLegendHtml}
                <span class="cards-queue-legend-item not-included"><span class="cards-queue-legend-dot" aria-hidden="true"></span>Not in next session</span>
            `;
        }
    }
    cardsQueueLegend.classList.toggle('hidden', !shouldShow);
    cardsQueueLegend.setAttribute('aria-hidden', shouldShow ? 'false' : 'true');
}

// =====================================================================
// === 5. Selection (bar, select mode, multi-select)
// =====================================================================
function pruneSelectedCardIdsToCurrent() {
    if (selectedCardIds.size === 0) {
        return;
    }
    const cardIds = new Set(
        (Array.isArray(currentCards) ? currentCards : [])
            .map((card) => String(card && card.id ? card.id : ''))
            .filter((value) => value.length > 0)
    );
    for (const id of [...selectedCardIds]) {
        if (!cardIds.has(id)) {
            selectedCardIds.delete(id);
        }
    }
}

function getSelectedCardObjects() {
    if (selectedCardIds.size === 0) {
        return [];
    }
    return (Array.isArray(currentCards) ? currentCards : [])
        .filter((card) => selectedCardIds.has(String(card && card.id ? card.id : '')));
}

function renderCardsSelectionBar() {
    if (!cardsSelectionBar || !cardsSelectModeBtn) {
        return;
    }
    pruneSelectedCardIdsToCurrent();

    cardsSelectModeBtn.classList.toggle('active', isCardsSelectModeOn);
    cardsSelectModeBtn.setAttribute('aria-pressed', isCardsSelectModeOn ? 'true' : 'false');

    if (!isCardsSelectModeOn && cardsSelectionBar.contains(document.activeElement)) {
        if (cardsSelectModeBtn) {
            cardsSelectModeBtn.focus();
        } else if (typeof document.activeElement.blur === 'function') {
            document.activeElement.blur();
        }
    }
    cardsSelectionBar.classList.toggle('hidden', !isCardsSelectModeOn);
    cardsSelectionBar.setAttribute('aria-hidden', isCardsSelectModeOn ? 'false' : 'true');
    document.body.classList.toggle('cards-select-mode', isCardsSelectModeOn);
    if (cardsGrid) {
        cardsGrid.classList.toggle('select-mode', isCardsSelectModeOn);
    }

    const selectedCards = getSelectedCardObjects();
    const selectedCount = selectedCards.length;
    if (cardsSelectionCount) {
        cardsSelectionCount.textContent = `${selectedCount} selected`;
    }

    if (cardsSelectionClearBtn) {
        cardsSelectionClearBtn.disabled = selectedCount <= 0;
    }
    if (cardsSelectAllVisibleBtn) {
        const visibleCards = getVisibleCardsForDisplay(currentCards);
        const visibleIds = new Set(
            visibleCards
                .map((card) => String(card && card.id ? card.id : ''))
                .filter((value) => value.length > 0)
        );
        let unselectedVisible = 0;
        for (const id of visibleIds) {
            if (!selectedCardIds.has(id)) {
                unselectedVisible += 1;
            }
        }
        cardsSelectAllVisibleBtn.disabled = unselectedVisible <= 0;
    }

    const skipableCount = selectedCards.filter((card) => !card.skip_practice).length;
    const unskipableCount = selectedCards.filter((card) => !!card.skip_practice).length;
    if (cardsSelectionSkipBtn) {
        const label = cardsSelectionSkipBtn.querySelector('.cards-selection-action-label');
        const text = skipableCount > 0 ? `Skip (${skipableCount})` : 'Skip';
        if (label) {
            label.textContent = text;
        }
        cardsSelectionSkipBtn.disabled = isBulkSkipActionInFlight || skipableCount <= 0;
    }
    if (cardsSelectionUnskipBtn) {
        const label = cardsSelectionUnskipBtn.querySelector('.cards-selection-action-label');
        const text = unskipableCount > 0 ? `Unskip (${unskipableCount})` : 'Unskip';
        if (label) {
            label.textContent = text;
        }
        cardsSelectionUnskipBtn.disabled = isBulkSkipActionInFlight || unskipableCount <= 0;
    }
    if (cardsSelectionDownloadBtn) {
        const showDownload = isType3Behavior();
        cardsSelectionDownloadBtn.classList.toggle('hidden', !showDownload);
        if (showDownload) {
            const label = cardsSelectionDownloadBtn.querySelector('.cards-selection-action-label');
            const text = selectedCount > 0 ? `Download (${selectedCount})` : 'Download';
            if (label) {
                label.textContent = isBulkDownloadInFlight ? 'Downloading...' : text;
            }
            cardsSelectionDownloadBtn.disabled = isBulkDownloadInFlight || selectedCount <= 0;
        }
    }
    if (cardsSelectionDeleteBtn) {
        const allDeletable = selectedCount > 0
            && selectedCards.every((card) => canDeleteExpandedCard(card) && !hasPracticedCardAttempts(card));
        cardsSelectionDeleteBtn.classList.toggle('hidden', !allDeletable);
        if (allDeletable) {
            const label = cardsSelectionDeleteBtn.querySelector('.cards-selection-action-label');
            if (label) {
                label.textContent = isBulkDeleteActionInFlight
                    ? 'Deleting...'
                    : `Delete (${selectedCount})`;
            }
            cardsSelectionDeleteBtn.disabled = isBulkDeleteActionInFlight;
        } else {
            cardsSelectionDeleteBtn.disabled = true;
        }
    }
}

function setCardsSelectMode(on) {
    const next = !!on;
    if (next === isCardsSelectModeOn) {
        renderCardsSelectionBar();
        return;
    }
    if (next) {
        viewModeBeforeSelectMode = currentCardViewMode;
        isCardsSelectModeOn = true;
        if (currentCardViewMode !== 'short') {
            currentCardViewMode = 'short';
            expandedCompactCardIds.clear();
        }
        showCardsBulkActionMessage('');
        resetAndDisplayCards(currentCards);
    } else {
        isCardsSelectModeOn = false;
        selectedCardIds.clear();
        const restoreMode = viewModeBeforeSelectMode === 'long' ? 'long' : 'short';
        viewModeBeforeSelectMode = null;
        if (currentCardViewMode !== restoreMode) {
            currentCardViewMode = restoreMode;
        }
        resetAndDisplayCards(currentCards);
    }
    renderCardsSelectionBar();
}

function toggleCardSelection(cardId) {
    const id = String(cardId || '').trim();
    if (!id) {
        return;
    }
    if (selectedCardIds.has(id)) {
        selectedCardIds.delete(id);
    } else {
        selectedCardIds.add(id);
    }
    const tile = cardsGrid ? cardsGrid.querySelector(`[data-select-card-id="${CSS.escape(id)}"]`) : null;
    if (tile) {
        tile.classList.toggle('selected', selectedCardIds.has(id));
        tile.setAttribute('aria-pressed', selectedCardIds.has(id) ? 'true' : 'false');
    }
    renderCardsSelectionBar();
}

function selectAllVisibleCards() {
    const visibleCards = getVisibleCardsForDisplay(currentCards);
    visibleCards.forEach((card) => {
        const id = String(card && card.id ? card.id : '').trim();
        if (id) {
            selectedCardIds.add(id);
        }
    });
    resetAndDisplayCards(currentCards);
    renderCardsSelectionBar();
}

function clearCardSelection() {
    if (selectedCardIds.size === 0) {
        renderCardsSelectionBar();
        return;
    }
    selectedCardIds.clear();
    resetAndDisplayCards(currentCards);
    renderCardsSelectionBar();
}

// =====================================================================
// === 6. UI controls (sort menu, view-mode buttons)
// =====================================================================
function getSortOptionLabel(option) {
    if (!option) {
        return '';
    }
    const dataLabel = option.dataset && option.dataset.label;
    if (dataLabel) {
        return dataLabel;
    }
    return String(option.textContent || '').replace(/^\s*Sort by:\s*/i, '').trim();
}

function buildSortMenuItems() {
    if (!sortMenuPopover || !viewOrderSelect) {
        return;
    }
    sortMenuPopover.innerHTML = '';
    const options = Array.from(viewOrderSelect.querySelectorAll('option'));
    options.forEach((option) => {
        const item = document.createElement('button');
        item.type = 'button';
        item.className = 'sort-menu-item';
        item.setAttribute('role', 'menuitemradio');
        item.dataset.value = option.value;
        const label = getSortOptionLabel(option);
        item.innerHTML = `
            ${window.icon('check', { className: 'sort-menu-item-check', strokeWidth: 2.6 })}
            <span class="sort-menu-item-label"></span>
        `;
        item.querySelector('.sort-menu-item-label').textContent = label;
        item.addEventListener('click', () => {
            if (item.disabled) {
                return;
            }
            if (viewOrderSelect.value !== option.value) {
                viewOrderSelect.value = option.value;
                viewOrderSelect.dispatchEvent(new Event('change', { bubbles: true }));
            }
            setSortMenuOpen(false);
            if (sortMenuBtn) {
                sortMenuBtn.focus();
            }
        });
        sortMenuPopover.appendChild(item);
    });
}

function syncSortMenuFromSelect() {
    if (!viewOrderSelect) {
        return;
    }
    const options = Array.from(viewOrderSelect.querySelectorAll('option'));
    const currentValue = viewOrderSelect.value;
    const selectedOption = options.find((opt) => opt.value === currentValue) || options[0];
    if (sortMenuBtnLabel && selectedOption) {
        sortMenuBtnLabel.textContent = `Sort by: ${getSortOptionLabel(selectedOption)}`;
    }
    if (!sortMenuPopover) {
        return;
    }
    const items = Array.from(sortMenuPopover.querySelectorAll('.sort-menu-item'));
    items.forEach((item) => {
        const value = item.dataset.value;
        const matchOption = options.find((opt) => opt.value === value);
        const isHidden = !!(matchOption && matchOption.hidden);
        const isDisabled = !!(matchOption && matchOption.disabled);
        item.style.display = isHidden ? 'none' : '';
        item.disabled = isDisabled;
        const isSelected = value === currentValue;
        item.classList.toggle('selected', isSelected);
        item.setAttribute('aria-checked', isSelected ? 'true' : 'false');
    });
}

function setSortMenuOpen(open) {
    if (!sortMenuBtn || !sortMenuPopover) {
        return;
    }
    sortMenuPopover.classList.toggle('hidden', !open);
    sortMenuPopover.setAttribute('aria-hidden', open ? 'false' : 'true');
    sortMenuBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
}

function isSortMenuOpen() {
    return !!(sortMenuPopover && !sortMenuPopover.classList.contains('hidden'));
}

// =====================================================================
// === 7. Queue settings + drill-speed save state
// =====================================================================
function getSessionCardCountCap() {
    if (isType4Behavior()) {
        return null;
    }
    const parsed = Number.parseInt(currentSessionCardCountCap, 10);
    if (!Number.isInteger(parsed)) {
        return null;
    }
    return Math.max(0, parsed);
}

function applySessionCardCountInputCap() {
    if (!sessionCardCountInput) {
        return;
    }
    const cap = getSessionCardCountCap();
    if (cap === null) {
        sessionCardCountInput.removeAttribute('max');
        return;
    }
    sessionCardCountInput.max = String(cap);
}

function updateSessionCardCountCapFromCardsPayload(payload) {
    if (isType4Behavior()) {
        currentSessionCardCountCap = null;
        applySessionCardCountInputCap();
        return;
    }
    const practiceActiveCount = Number.parseInt(payload && payload.practice_active_card_count, 10);
    const activeCount = Number.parseInt(payload && payload.active_card_count, 10);
    const fallbackFromCards = Array.isArray(payload && payload.cards)
        ? payload.cards.filter((card) => !card.skip_practice).length
        : null;
    const resolved = Number.isInteger(practiceActiveCount)
        ? practiceActiveCount
        : (Number.isInteger(activeCount) ? activeCount : fallbackFromCards);
    if (!Number.isInteger(resolved)) {
        return;
    }
    currentSessionCardCountCap = Math.max(0, resolved);
    applySessionCardCountInputCap();
}

function clampSessionCardCount(rawValue) {
    const parsed = Number.parseInt(rawValue, 10);
    if (!Number.isInteger(parsed)) {
        return 0;
    }
    const cap = getSessionCardCountCap();
    if (cap === null) {
        return Math.max(0, parsed);
    }
    return Math.max(0, Math.min(cap, parsed));
}

function getSessionCardCountForMixLegend() {
    if (isType4Behavior()) {
        return getType4TotalCardsPerDay();
    }
    return clampSessionCardCount(sessionCardCountInput ? sessionCardCountInput.value : '');
}

function updateQueueMixLegend() {
    updateQueueSettingsSaveButtonState();
    renderDeckSetupSummary();
}

function normalizeSessionCountInputValue() {
    const next = getSessionCardCountForMixLegend();
    if (sessionCardCountInput) {
        sessionCardCountInput.value = String(next);
        applySessionCardCountInputCap();
    }
    return next;
}

function setQueueSettingsBaseline(sessionCount) {
    baselineSessionCardCount = clampSessionCardCount(sessionCount);
    queueSettingsSaveSuccessText = `Saved ${baselineSessionCardCount} cards/day`;
    updateQueueSettingsSaveButtonState();
}

function hasQueueSettingsChanges() {
    if (isType4Behavior()) {
        return false;
    }
    if (getSessionCardCountForMixLegend() !== baselineSessionCardCount) {
        return true;
    }
    return hasDrillSpeedSettingsChanges();
}

function setQueueSettingsSaveButton(state, labelText) {
    if (!queueSettingsSaveBtn) {
        return;
    }
    // Each fieldset (Cards/day, Speed target) has its own ✓ save button; they
    // all submit the same form, so reflect one shared saved/dirty/saving state.
    document.querySelectorAll('.queue-save-pill').forEach((btn) => {
        btn.dataset.state = state;
        btn.disabled = state !== 'dirty';
        btn.title = labelText;
        const labelEl = btn.querySelector('.queue-save-pill-label');
        if (labelEl) {
            labelEl.textContent = labelText;
        }
    });
}

function updateQueueSettingsSaveButtonState() {
    if (!queueSettingsSaveBtn) {
        return;
    }
    if (isType4Behavior()) {
        setQueueSettingsSaveButton('saved', 'Saved');
        return;
    }
    if (isQueueSettingsSaving) {
        setQueueSettingsSaveButton('saving', 'Saving…');
        return;
    }
    const hasChanges = hasQueueSettingsChanges();
    if (hasChanges) {
        setQueueSettingsSaveButton('dirty', 'Save');
    } else {
        setQueueSettingsSaveButton('saved', 'Saved');
    }
}

function isDrillSpeedSettingApplicable() {
    return isType1Behavior() && !isChineseSpecificLogic;
}

function getDrillSpeedTargetInputMs() {
    if (!drillSpeedTargetInput) {
        return baselineDrillSpeedCutoffMs;
    }
    const seconds = Number.parseFloat(drillSpeedTargetInput.value);
    if (!Number.isFinite(seconds) || seconds <= 0) {
        return baselineDrillSpeedCutoffMs;
    }
    return clampDrillSpeedCutoffMs(Math.round(seconds * 1000));
}

function setDrillSpeedTargetInputMs(ms) {
    if (!drillSpeedTargetInput) {
        return;
    }
    const safeMs = clampDrillSpeedCutoffMs(ms);
    drillSpeedTargetInput.value = (safeMs / 1000).toFixed(1);
}

function hasDrillSpeedSettingsChanges() {
    if (!isDrillSpeedSettingApplicable()) {
        return false;
    }
    return getDrillSpeedTargetInputMs() !== baselineDrillSpeedCutoffMs;
}

function applyDrillSpeedSettingsFromKid(kid) {
    const applicable = isDrillSpeedSettingApplicable();
    if (drillSpeedSettingsGroup) {
        drillSpeedSettingsGroup.classList.toggle('hidden', !applicable);
    }
    if (drillSpeedTargetInput) {
        drillSpeedTargetInput.required = applicable;
    }
    if (!applicable) {
        baselineDrillSpeedCutoffMs = DEFAULT_DRILL_SPEED_CUTOFF_MS;
        return;
    }
    baselineDrillSpeedCutoffMs = getDrillSpeedCutoffMsFromKid(kid);
    setDrillSpeedTargetInputMs(baselineDrillSpeedCutoffMs);
    updateQueueSettingsSaveButtonState();
}

// =====================================================================
// === 8. Queue preview reload + auto-set session count on new cards
// =====================================================================
function scheduleQueuePreviewReload() {
    if (isType4Behavior()) {
        return;
    }
    if (isQueueSettingsSaving) {
        return;
    }
    if (previewQueueTimer) {
        window.clearTimeout(previewQueueTimer);
        previewQueueTimer = null;
    }
    previewQueueTimer = window.setTimeout(() => {
        previewQueueTimer = null;
        void loadSharedDeckCards();
    }, 180);
}

function cancelQueuePreviewReload() {
    if (previewQueueTimer) {
        window.clearTimeout(previewQueueTimer);
        previewQueueTimer = null;
    }
}

function rerenderCompactCardsForQueuePreview() {
    if (currentCardViewMode !== 'short' || !Array.isArray(currentCards) || currentCards.length <= 0) {
        return;
    }
    displayCards(currentCards);
}

async function maybeAutoSetSessionCountForNewCards(previousCardCount, nextCardCount) {
    if (isType4Behavior()) {
        hasLoadedSharedCardsOnce = true;
        return;
    }
    if (!hasLoadedSharedCardsOnce) {
        hasLoadedSharedCardsOnce = true;
        return;
    }
    if (previousCardCount > 0 || nextCardCount <= 0) {
        return;
    }
    const currentSessionCount = getSessionCardCountForMixLegend();
    if (currentSessionCount > 0) {
        return;
    }

    const cap = getSessionCardCountCap();
    const defaultSessionCount = cap === null ? 10 : Math.min(10, cap);
    if (sessionCardCountInput) {
        sessionCardCountInput.value = String(defaultSessionCount);
    }
    updateQueueMixLegend();

    const response = await fetch(`${API_BASE}/kids/${kidId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildSessionCountPayload(defaultSessionCount)),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
        throw new Error(result.error || `Failed to auto-set cards/day (HTTP ${response.status})`);
    }

    applySessionCountFromPayload(result);
    const persistedTotal = getCategoryIntValue(sessionCardCountByCategory);
    const safeTotal = clampSessionCardCount(persistedTotal);
    if (sessionCardCountInput) {
        sessionCardCountInput.value = String(safeTotal);
    }
    setQueueSettingsBaseline(safeTotal);
    updateQueueMixLegend();
}
