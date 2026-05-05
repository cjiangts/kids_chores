// Card filter/sort, practice-priority scoring + detail markup, queue mix legend, sort menu, view-mode buttons, queue settings save state.
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

function getSortedCardsForDisplay(cards) {
    if (isType4Behavior()) {
        return window.PracticeManageCommon.sortCardsForView(
            Array.isArray(cards) ? cards : [],
            CARD_SORT_MODE_ADDED_TIME
        );
    }
    const filteredCards = filterCardsByQuery(cards, cardSearchInput ? cardSearchInput.value : '');
    return sortCardsForDisplay(filteredCards, getSelectedCardSortMode(), getCurrentCardSortDirection());
}

function isPracticePriorityQueueOrderSelected() {
    return getSelectedCardSortMode() === CARD_SORT_MODE_PRACTICE_QUEUE;
}

function usesPracticePriorityDisplay() {
    return supportsPracticePriorityPreview() && !isType4Behavior();
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

function getCardAverageResponseTimeSortValue(card) {
    const priorityAvg = Number(card && card.practice_priority_avg_correct_response_time);
    if (Number.isFinite(priorityAvg) && priorityAvg > 0) {
        return priorityAvg;
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

function comparePracticeQueueCards(a, b, direction) {
    const aSkipped = Boolean(a && a.skip_practice);
    const bSkipped = Boolean(b && b.skip_practice);
    if (aSkipped !== bSkipped) {
        return aSkipped ? 1 : -1;
    }
    const aOrder = Number.isFinite(Number(a && a.practice_priority_order))
        ? Number(a.practice_priority_order)
        : Number.MAX_SAFE_INTEGER;
    const bOrder = Number.isFinite(Number(b && b.practice_priority_order))
        ? Number(b.practice_priority_order)
        : Number.MAX_SAFE_INTEGER;
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
            getCardAverageResponseTimeSortValue(a),
            getCardAverageResponseTimeSortValue(b),
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
        const value = Number(card && (
            card.practice_priority_missed_points
            ?? card.practice_priority_error_points
        ));
        return Number.isFinite(value) ? Math.max(0, value) : 0;
    }
    if (reason === PRACTICE_PRIORITY_REASON_SLOW) {
        const value = Number(card && (
            card.practice_priority_slow_points
            ?? card.practice_priority_fluency_points
        ));
        return Number.isFinite(value) ? Math.max(0, value) : 0;
    }
    if (reason === PRACTICE_PRIORITY_REASON_DUE) {
        const value = Number(card && (
            card.practice_priority_due_points
            ?? card.practice_priority_forgetting_points
        ));
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

function getPracticePriorityPrimaryReasonLabel(card) {
    const reason = getPracticePriorityDisplayReason(card);
    if (reason === PRACTICE_PRIORITY_REASON_NEW) {
        return 'New';
    }
    if (reason === PRACTICE_PRIORITY_REASON_MISSED) {
        return 'Missed';
    }
    if (reason === PRACTICE_PRIORITY_REASON_SLOW) {
        return 'Slow';
    }
    if (reason === PRACTICE_PRIORITY_REASON_DUE) {
        return 'Due';
    }
    return 'Learning';
}

function getPracticePrioritySegmentDisplayLabel(card, segment) {
    if (segment && segment.key === PRACTICE_PRIORITY_REASON_LEARNING && isNeverPracticedPriorityCard(card)) {
        return 'New';
    }
    return String(segment && segment.label ? segment.label : '').trim() || 'Learning';
}

function getPracticePriorityPrimaryReasonKey(card) {
    const reason = getPracticePriorityDisplayReason(card);
    if (reason === PRACTICE_PRIORITY_REASON_NEW) {
        return PRACTICE_PRIORITY_REASON_LEARNING;
    }
    return reason;
}

function getPracticePriorityDaysSinceLastSeenValue(card) {
    if (isNeverPracticedPriorityCard(card)) {
        return null;
    }
    const days = Number.parseInt(card && card.practice_priority_days_since_last_seen, 10);
    return Number.isInteger(days) ? Math.max(0, days) : null;
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

function clampPercent(value) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) {
        return 0;
    }
    return Math.max(0, Math.min(100, numeric));
}

function buildPracticePriorityDonutHtml(options = {}) {
    const safePercent = clampPercent(options.correctPercent);
    const toneClass = String(options.toneClass || '').trim();
    const centerText = String(options.centerText || formatMetricPercent(safePercent));
    const centerClass = String(options.centerClass || '').trim();
    return `
        <div class="practice-priority-donut ${escapeHtml(toneClass)}" style="--chart-percent:${safePercent.toFixed(2)}%">
            <div class="practice-priority-donut-inner ${escapeHtml(centerClass)}">${escapeHtml(centerText)}</div>
        </div>
    `;
}

function buildPracticePriorityAxisHtml(options = {}) {
    const rawPositionPct = Number(options.positionPct);
    const positionPct = Number.isFinite(rawPositionPct) ? clampPercent(rawPositionPct) : null;
    const valueText = String(options.valueText || '-');
    const leftText = String(options.leftText || '-');
    const rightText = String(options.rightText || '-');
    const leftNote = String(options.leftNote || '');
    const rightNote = String(options.rightNote || '');
    const markerClass = String(options.markerClass || '').trim();
    const leftNoteClass = String(options.leftNoteClass || '').trim();
    const rightNoteClass = String(options.rightNoteClass || '').trim();
    const tickCount = Math.max(2, Number.parseInt(options.tickCount, 10) || 6);
    const ticksHtml = Array.from({ length: tickCount }, (_, index) => {
        const pct = tickCount <= 1 ? 0 : (index / (tickCount - 1)) * 100;
        return `<span class="practice-priority-axis-tick" style="left:${pct.toFixed(2)}%"></span>`;
    }).join('');
    const markerAnchorClass = positionPct === null
        ? ''
        : (positionPct <= 0 ? ' anchor-start' : (positionPct >= 100 ? ' anchor-end' : ' anchor-middle'));
    const markerOverflowClass = positionPct === null || !Number.isFinite(rawPositionPct)
        ? ''
        : (rawPositionPct < 0 ? ' overflow-start' : (rawPositionPct > 100 ? ' overflow-end' : ''));
    const markerHtml = positionPct === null
        ? ''
        : `
            <span class="practice-priority-axis-marker ${escapeHtml(markerClass)}${escapeHtml(markerAnchorClass)}${escapeHtml(markerOverflowClass)}" style="left:${positionPct.toFixed(2)}%">
                <span class="practice-priority-axis-marker-label">${escapeHtml(valueText)}</span>
            </span>
        `;
    return `
        <div class="practice-priority-axis">
            <div class="practice-priority-axis-track">
                <span class="practice-priority-axis-line"></span>
                ${ticksHtml}
                ${markerHtml}
            </div>
            <div class="practice-priority-axis-labels">
                <span class="practice-priority-axis-end">
                    <span class="practice-priority-axis-end-value">${escapeHtml(leftText)}</span>
                    ${leftNote ? `<span class="practice-priority-axis-end-note ${escapeHtml(leftNoteClass)}">${escapeHtml(leftNote)}</span>` : ''}
                </span>
                <span class="practice-priority-axis-end align-right">
                    <span class="practice-priority-axis-end-value">${escapeHtml(rightText)}</span>
                    ${rightNote ? `<span class="practice-priority-axis-end-note ${escapeHtml(rightNoteClass)}">${escapeHtml(rightNote)}</span>` : ''}
                </span>
            </div>
        </div>
    `;
}

function buildPracticePriorityLearningDotsHtml(attemptCount, targetAttempts) {
    const safeTarget = Math.max(1, Number.parseInt(targetAttempts, 10) || 5);
    const safeAttempts = Math.max(0, Number.parseInt(attemptCount, 10) || 0);
    const filledCount = Math.max(0, Math.min(safeTarget, safeAttempts));
    const dotsHtml = Array.from({ length: safeTarget }, (_, index) => (
        `<span class="practice-priority-learning-dot${index < filledCount ? ' filled' : ''}"></span>`
    )).join('');
    return `
        <div class="practice-priority-learning-visual">
            <div class="practice-priority-learning-dots" aria-hidden="true">${dotsHtml}</div>
            <div class="practice-priority-learning-caption">
                <span class="practice-priority-learning-caption-value">${escapeHtml(String(safeAttempts))} attempts</span>
                <span class="practice-priority-learning-caption-note">(target ${safeTarget})</span>
            </div>
        </div>
    `;
}

function buildPracticePriorityDetailCards(card) {
    const segments = getPracticePrioritySegments(card);
    const isNewCard = isNeverPracticedPriorityCard(card);
    const correctCount = Math.max(0, Number.parseInt(card && card.practice_priority_correct_count, 10) || 0);
    const wrongCount = Math.max(0, Number.parseInt(card && card.practice_priority_wrong_count, 10) || 0);
    const lifetimeAttempts = Math.max(0, Number.parseInt(card && card.practice_priority_attempt_count, 10) || 0);
    const correctRate = Number(card && card.practice_priority_correct_rate);
    const incorrectRate = Number.isFinite(correctRate) ? Math.max(0, 100 - correctRate) : null;
    const incorrectRateText = formatMetricPercent(incorrectRate);
    const avgCorrectResponseTimeText = formatMillisecondsAsSecondsOrMinutes(
        Number(card && card.practice_priority_avg_correct_response_time)
    );
    const subjectP50Text = formatMillisecondsAsSecondsOrMinutes(
        Number(card && card.practice_priority_subject_p50_correct_time)
    );
    const subjectP90Text = formatMillisecondsAsSecondsOrMinutes(
        Number(card && card.practice_priority_subject_p90_correct_time)
    );
    const lastResponseTimeText = formatMillisecondsAsSecondsOrMinutes(getCardLastResponseTimeValue(card));
    const lastResultText = formatCardLastResult(card);
    const lastResultTone = getPracticePriorityLastResultTone(card);
    const subjectCorrectSampleCount = Math.max(
        0,
        Number.parseInt(card && card.practice_priority_subject_correct_sample_count, 10) || 0
    );
    const p50Value = Number(card && card.practice_priority_subject_p50_correct_time);
    const p90Value = Number(card && card.practice_priority_subject_p90_correct_time);
    const avgCorrectValue = Number(card && card.practice_priority_avg_correct_response_time);
    const slowRange = Number.isFinite(p50Value) && Number.isFinite(p90Value) && p90Value > p50Value
        ? p90Value - p50Value
        : null;
    const slowBaselineReady = subjectCorrectSampleCount >= PRACTICE_PRIORITY_MIN_CORRECT_RECORDS_FOR_SPEED_BASELINE
        && Number.isFinite(p50Value)
        && Number.isFinite(p90Value)
        && p90Value > p50Value;
    const slowMarkerPct = slowRange
        ? ((avgCorrectValue - p50Value) / slowRange) * 100
        : null;
    const daysSinceLastSeen = getPracticePriorityDaysSinceLastSeenValue(card);
    const dueMarkerPct = Number.isFinite(daysSinceLastSeen)
        ? (daysSinceLastSeen / PRACTICE_PRIORITY_VERY_DUE_DAYS) * 100
        : null;

    return `
        <div class="practice-priority-detail-card missed${isType3Behavior() ? ' no-side' : ''}">
            ${isType3Behavior() ? '' : `<div class="practice-priority-detail-side">
                <div class="practice-priority-detail-title">${icon('circle-x', { size: 14 })}<span>${escapeHtml(getPracticePrioritySegmentDisplayLabel(card, segments[0]))}</span></div>
                <div class="practice-priority-detail-points">+${escapeHtml(formatPracticePriorityScore(segments[0].points))}</div>
            </div>`}
            <div class="practice-priority-detail-body">
                <div class="practice-priority-detail-text">
                    <div class="practice-priority-detail-main">Incorrect rate: <span class="practice-priority-inline-value missed">${escapeHtml(isNewCard ? '-' : incorrectRateText)}</span></div>
                    <div class="practice-priority-detail-sub">Correct ${escapeHtml(String(correctCount))} · Wrong ${escapeHtml(String(wrongCount))}</div>
                    <div class="practice-priority-detail-sub">Last result: <span class="practice-priority-last-result ${escapeHtml(lastResultTone)}">${escapeHtml(lastResultText)}</span></div>
                </div>
                <div class="practice-priority-detail-visual">
                    ${isNewCard
                        ? ''
                        : buildPracticePriorityDonutHtml({
                            correctPercent: correctRate,
                            toneClass: 'missed',
                            centerText: formatMetricPercent(correctRate),
                            centerClass: 'positive',
                        })
                    }
                </div>
            </div>
        </div>
        <div class="practice-priority-detail-card slow${(isType2Behavior() || isType3Behavior()) ? ' no-side' : ''}">
            ${(isType2Behavior() || isType3Behavior()) ? '' : `<div class="practice-priority-detail-side">
                <div class="practice-priority-detail-title">${icon('clock', { size: 14 })}<span>${escapeHtml(segments[1].label)}</span></div>
                <div class="practice-priority-detail-points">+${escapeHtml(formatPracticePriorityScore(segments[1].points))}</div>
            </div>`}
            <div class="practice-priority-detail-body">
                <div class="practice-priority-detail-text">
                    <div class="practice-priority-detail-main">Avg time: <span class="practice-priority-inline-value slow">${escapeHtml(avgCorrectResponseTimeText)}</span></div>
                    <div class="practice-priority-detail-sub">Last response: ${escapeHtml(lastResponseTimeText)}</div>
                </div>
                <div class="practice-priority-detail-visual">
                    ${slowBaselineReady
                        ? buildPracticePriorityAxisHtml({
                            positionPct: slowMarkerPct,
                            valueText: avgCorrectResponseTimeText,
                            leftText: subjectP50Text,
                            rightText: subjectP90Text,
                            leftNote: '(p50)',
                            rightNote: '(p90)',
                            leftNoteClass: 'positive',
                            rightNoteClass: 'negative',
                            markerClass: 'slow',
                            tickCount: 6,
                        })
                        : `<div class="practice-priority-axis-placeholder">Baseline after ${PRACTICE_PRIORITY_MIN_CORRECT_RECORDS_FOR_SPEED_BASELINE} subject-correct answers</div>`
                    }
                </div>
            </div>
        </div>
        <div class="practice-priority-detail-card learning">
            <div class="practice-priority-detail-side">
                <div class="practice-priority-detail-title">${icon('sparkles', { size: 14 })}<span>${escapeHtml(getPracticePrioritySegmentDisplayLabel(card, segments[2]))}</span></div>
                <div class="practice-priority-detail-points">+${escapeHtml(formatPracticePriorityScore(segments[2].points))}</div>
            </div>
            <div class="practice-priority-detail-body">
                <div class="practice-priority-detail-text">
                    <div class="practice-priority-detail-main">Lifetime attempts: <span class="practice-priority-inline-value learning">${escapeHtml(String(lifetimeAttempts))}</span></div>
                    <div class="practice-priority-detail-sub">More practice lowers learning need</div>
                </div>
                <div class="practice-priority-detail-visual">
                    ${buildPracticePriorityLearningDotsHtml(lifetimeAttempts, PRACTICE_PRIORITY_LEARNING_TARGET_ATTEMPTS)}
                </div>
            </div>
        </div>
        <div class="practice-priority-detail-card due">
            <div class="practice-priority-detail-side">
                <div class="practice-priority-detail-title">${icon('calendar-clock', { size: 14 })}<span>${escapeHtml(segments[3].label)}</span></div>
                <div class="practice-priority-detail-points">+${escapeHtml(formatPracticePriorityScore(segments[3].points))}</div>
            </div>
            <div class="practice-priority-detail-body">
                <div class="practice-priority-detail-text">
                    <div class="practice-priority-detail-main">${
                        Number.isFinite(daysSinceLastSeen)
                            ? `Last seen <span class="practice-priority-inline-value due">${escapeHtml(String(daysSinceLastSeen))} day${daysSinceLastSeen === 1 ? '' : 's'}</span> ago`
                            : 'Not practiced yet'
                    }</div>
                    <div class="practice-priority-detail-sub">Longer unseen gaps raise due need</div>
                </div>
                <div class="practice-priority-detail-visual">
                    ${isNewCard
                        ? ''
                        : buildPracticePriorityAxisHtml({
                            positionPct: dueMarkerPct,
                            valueText: Number.isFinite(daysSinceLastSeen) ? `${daysSinceLastSeen}d` : 'Never',
                            leftText: '0d',
                            rightText: `${PRACTICE_PRIORITY_VERY_DUE_DAYS}+d`,
                            leftNote: '(today)',
                            rightNote: '(very due)',
                            leftNoteClass: 'positive',
                            rightNoteClass: 'negative',
                            markerClass: 'due',
                            tickCount: 7,
                        })
                    }
                </div>
            </div>
        </div>
    `;
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
    const barHtml = segments
        .filter((segment) => segment.points > 0)
        .map((segment) => (
            `<span class="practice-priority-score-segment ${segment.key}" style="width:${Math.max(0, Math.min(100, (segment.points / scaleBase) * 100)).toFixed(2)}%" title="${escapeHtml(`${segment.label}: +${formatPracticePriorityScore(segment.points)}`)}"></span>`
        ))
        .join('');
    const order = Number(card && card.practice_priority_order);
    const activeCount = Array.isArray(sortedCards)
        ? sortedCards.filter((queueCard) => !queueCard.skip_practice).length
        : 0;
    const rankText = Number.isFinite(order) && order > 0
        ? `Rank #${order}${activeCount > 0 ? ` of ${activeCount}` : ''}`
        : '';
    const detailCardsHtml = buildPracticePriorityDetailCards(card);
    const primaryReasonLabel = getPracticePriorityPrimaryReasonLabel(card);
    const primaryReasonKey = getPracticePriorityPrimaryReasonKey(card);
    return `
        <div class="practice-priority-score-block">
            <div class="practice-priority-score-head">
                <span class="practice-priority-score-label">
                    <span class="practice-priority-score-reason ${escapeHtml(primaryReasonKey)}">${escapeHtml(primaryReasonLabel)}</span>
                    ${rankText ? `<span class="practice-priority-score-rank">· ${escapeHtml(rankText)}</span>` : ''}
                </span>
                <span class="practice-priority-score-head-right">
                    <span class="practice-priority-score-caption">Score</span>
                    <span class="practice-priority-score-value">${escapeHtml(formatPracticePriorityScore(score))}</span>
                </span>
            </div>
            <div class="practice-priority-score-bar" aria-hidden="true">
                ${barHtml}
            </div>
            ${detailCardsHtml ? `<div class="practice-priority-detail-grid">${detailCardsHtml}</div>` : ''}
        </div>
    `;
}

function getCardIdText(card) {
    const raw = String(card && card.id ? card.id : '').trim();
    return raw;
}

function getQueueHighlightMap(cards) {
    if (isType4Behavior()) {
        return new Map();
    }

    const targetCount = getSessionCardCountForMixLegend();
    if (targetCount <= 0) {
        return new Map();
    }

    if (usesPracticePriorityDisplay()) {
        const orderedQueueCards = window.PracticeManageCommon.sortCardsForView(
            (Array.isArray(cards) ? cards : []).filter((card) => {
                if (!card || card.skip_practice) {
                    return false;
                }
                const rawOrder = card.practice_priority_order;
                if (rawOrder === null || rawOrder === undefined || rawOrder === '') {
                    return false;
                }
                return Number.isFinite(Number(rawOrder));
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
            if (!card || card.skip_practice) {
                return false;
            }
            const rawOrder = card.next_session_order;
            if (rawOrder === null || rawOrder === undefined || rawOrder === '') {
                return false;
            }
            return Number.isFinite(Number(rawOrder));
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

    const remainingSlots = Math.max(0, nextSessionCards.length - redPrefixCount);
    const hardPct = getHardCardPercentForMixLegend();
    const hardTarget = hardPct <= 0
        ? 0
        : Math.min(remainingSlots, Math.ceil((remainingSlots * hardPct) / 100));

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
        if (index < redPrefixCount + hardTarget) {
            highlights.set(cardId, 'hard');
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
    const shouldShow = usesPracticePriorityDisplay()
        && Number.parseInt(cardCount, 10) > 0;
    if (shouldShow) {
        const missedLegendHtml = isType3Behavior()
            ? ''
            : '<span class="cards-queue-legend-item missed"><span class="cards-queue-legend-dot" aria-hidden="true"></span>Missed</span>';
        const slowLegendHtml = (isType2Behavior() || isType3Behavior())
            ? ''
            : '<span class="cards-queue-legend-item slow"><span class="cards-queue-legend-dot" aria-hidden="true"></span>Slow</span>';
        cardsQueueLegend.innerHTML = `
            ${missedLegendHtml}
            ${slowLegendHtml}
            <span class="cards-queue-legend-item learning"><span class="cards-queue-legend-dot" aria-hidden="true"></span>Learning</span>
            <span class="cards-queue-legend-item due"><span class="cards-queue-legend-dot" aria-hidden="true"></span>Due</span>
            <span class="cards-queue-legend-item not-included"><span class="cards-queue-legend-dot" aria-hidden="true"></span>Not in next session</span>
        `;
    }
    cardsQueueLegend.classList.toggle('hidden', !shouldShow);
    cardsQueueLegend.setAttribute('aria-hidden', shouldShow ? 'false' : 'true');
}

function renderVisibleSkipActionButtons() {
    if (!skipVisibleCardsBtn || !unskipVisibleCardsBtn) {
        return;
    }
    const visibleCards = getVisibleCardsForDisplay(currentCards);
    const skipableCount = visibleCards.filter((card) => !card.skip_practice).length;
    const unskipableCount = visibleCards.filter((card) => !!card.skip_practice).length;
    const skipLabel = skipVisibleCardsBtn.querySelector('.cards-bulk-action-menu-item-text');
    const unskipLabel = unskipVisibleCardsBtn.querySelector('.cards-bulk-action-menu-item-text');
    if (skipLabel) {
        skipLabel.textContent = `Skip visible cards (${skipableCount})`;
    } else {
        skipVisibleCardsBtn.textContent = `Skip visible cards (${skipableCount})`;
    }
    if (unskipLabel) {
        unskipLabel.textContent = `Unskip visible cards (${unskipableCount})`;
    } else {
        unskipVisibleCardsBtn.textContent = `Unskip visible cards (${unskipableCount})`;
    }
    skipVisibleCardsBtn.disabled = isBulkSkipActionInFlight || skipableCount <= 0;
    unskipVisibleCardsBtn.disabled = isBulkSkipActionInFlight || unskipableCount <= 0;
}

function setCardsBulkActionMenuOpen(open) {
    if (!cardsBulkActionMenuBtn || !cardsBulkActionMenu) {
        return;
    }
    cardsBulkActionMenu.classList.toggle('hidden', !open);
    cardsBulkActionMenu.setAttribute('aria-hidden', open ? 'false' : 'true');
    cardsBulkActionMenuBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
}

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
            <svg class="sort-menu-item-check" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"></polyline></svg>
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

function isCardsBulkActionMenuOpen() {
    return !!(cardsBulkActionMenu && !cardsBulkActionMenu.classList.contains('hidden'));
}

function renderCardViewModeButtons() {
    const isCompact = currentCardViewMode === 'short';
    if (cardViewModeCompactBtn) {
        cardViewModeCompactBtn.innerHTML = icon('layout-grid', { size: 16 });
        cardViewModeCompactBtn.classList.toggle('active', isCompact);
        cardViewModeCompactBtn.setAttribute('aria-pressed', isCompact ? 'true' : 'false');
    }
    if (cardViewModeExpandBtn) {
        cardViewModeExpandBtn.innerHTML = icon('rows-3', { size: 16 });
        cardViewModeExpandBtn.classList.toggle('active', !isCompact);
        cardViewModeExpandBtn.setAttribute('aria-pressed', isCompact ? 'false' : 'true');
    }
}

function setCardViewMode(nextMode) {
    const mode = String(nextMode || '').trim().toLowerCase();
    const resolved = isType4Behavior()
        ? 'long'
        : (mode === 'short' ? 'short' : 'long');
    if (resolved === currentCardViewMode) {
        return;
    }
    currentCardViewMode = resolved;
    if (resolved !== 'long') {
        expandedCompactCardIds.clear();
    }
    renderCardViewModeButtons();
    resetAndDisplayCards(currentCards);
}

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

function getHardCardPercentForMixLegend() {
    if (isType4Behavior()) {
        return 0;
    }
    if (!hardnessPercentSlider) {
        return 0;
    }
    const parsed = Number.parseInt(hardnessPercentSlider.value, 10);
    if (!Number.isInteger(parsed)) {
        return 0;
    }
    return Math.max(0, Math.min(100, parsed));
}

function formatCardCountLabel(count) {
    const safe = Math.max(0, Number.parseInt(count, 10) || 0);
    return `${safe} ${safe === 1 ? 'card' : 'cards'}`;
}

function updateHardnessSliderTrack(hardPct) {
    if (!hardnessPercentSlider) {
        return;
    }
    const hard = Math.max(0, Math.min(100, Number.parseInt(hardPct, 10) || 0));
    hardnessPercentSlider.style.background = `linear-gradient(90deg, ${NEXT_SESSION_HARD_COLOR} 0%, ${NEXT_SESSION_HARD_COLOR} ${hard}%, ${NEXT_SESSION_LEAST_COLOR} ${hard}%, ${NEXT_SESSION_LEAST_COLOR} 100%)`;
}

function updateQueueMixLegend() {
    if (isType4Behavior() || supportsPracticePriorityPreview()) {
        if (leastRecentMixSummary) {
            leastRecentMixSummary.textContent = '';
        }
        if (hardCardsMixSummary) {
            hardCardsMixSummary.textContent = '';
        }
        updateQueueSettingsSaveButtonState();
        renderDeckSetupSummary();
        return;
    }
    const totalCards = getSessionCardCountForMixLegend() || 0;
    const hardPct = getHardCardPercentForMixLegend();
    const leastPct = Math.max(0, 100 - hardPct);
    const hardCount = hardPct <= 0 ? 0 : Math.min(totalCards, Math.ceil((totalCards * hardPct) / 100));
    const leastCount = Math.max(0, totalCards - hardCount);
    if (leastRecentMixSummary) {
        leastRecentMixSummary.textContent = `${leastPct}% · ${formatCardCountLabel(leastCount)}`;
    }
    if (hardCardsMixSummary) {
        hardCardsMixSummary.textContent = `${hardPct}% · ${formatCardCountLabel(hardCount)}`;
    }
    updateHardnessSliderTrack(hardPct);
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

function normalizeHardSliderValue() {
    const next = getHardCardPercentForMixLegend();
    if (hardnessPercentSlider) {
        hardnessPercentSlider.value = String(next);
    }
    return next;
}

function setQueueSettingsBaseline(sessionCount, hardPct) {
    baselineSessionCardCount = clampSessionCardCount(sessionCount);
    baselineHardCardPercent = Math.max(0, Math.min(100, Number.parseInt(hardPct, 10) || 0));
    queueSettingsSaveSuccessText = supportsPracticePriorityPreview()
        ? `Saved ${baselineSessionCardCount} cards/day`
        : `Saved ${baselineHardCardPercent}% · ${baselineSessionCardCount}`;
    updateQueueSettingsSaveButtonState();
}

function hasQueueSettingsChanges() {
    if (isType4Behavior()) {
        return false;
    }
    const currentSessionCount = getSessionCardCountForMixLegend();
    const currentHardPct = getHardCardPercentForMixLegend();
    if (supportsPracticePriorityPreview()) {
        return currentSessionCount !== baselineSessionCardCount;
    }
    return currentSessionCount !== baselineSessionCardCount
        || currentHardPct !== baselineHardCardPercent;
}

function setQueueSettingsSaveButton(state, labelText) {
    if (!queueSettingsSaveBtn) {
        return;
    }
    queueSettingsSaveBtn.dataset.state = state;
    queueSettingsSaveBtn.disabled = state !== 'dirty';
    const labelEl = queueSettingsSaveBtn.querySelector('.queue-save-pill-label');
    if (labelEl) {
        labelEl.textContent = labelText;
    } else {
        queueSettingsSaveBtn.textContent = labelText;
    }
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
    const hardPct = supportsPracticePriorityPreview() ? 0 : normalizeHardSliderValue();
    if (sessionCardCountInput) {
        sessionCardCountInput.value = String(defaultSessionCount);
    }
    updateQueueMixLegend();

    const response = await fetch(`${API_BASE}/kids/${kidId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            ...buildSessionCountPayload(defaultSessionCount),
            ...(!supportsPracticePriorityPreview() ? buildHardCardPercentPayload(hardPct) : {}),
        }),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
        throw new Error(result.error || `Failed to auto-set cards/day (HTTP ${response.status})`);
    }

    applySessionCountFromPayload(result);
    const persistedTotal = getCategoryIntValue(sessionCardCountByCategory);
    const persistedHard = supportsPracticePriorityPreview()
        ? 0
        : getPersistedHardCardPercentFromPayload(result);
    const safeTotal = clampSessionCardCount(persistedTotal);
    const safeHard = Math.max(0, Math.min(100, Number.parseInt(persistedHard, 10) || 0));
    if (sessionCardCountInput) {
        sessionCardCountInput.value = String(safeTotal);
    }
    if (hardnessPercentSlider && !supportsPracticePriorityPreview()) {
        hardnessPercentSlider.value = String(safeHard);
    }
    setQueueSettingsBaseline(safeTotal, safeHard);
    updateQueueMixLegend();
}
