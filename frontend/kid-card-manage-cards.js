// Card markup builders, chunked render, displayCards, bulk add/edit/delete, grid click handler, kid + decks loaders, queue settings save.
function buildCardReportHref(card) {
    const qs = new URLSearchParams();
    qs.set('id', String(kidId || ''));
    qs.set('cardId', String(card.id || ''));
    const reportFrom = currentSharedScope === SHARED_SCOPE_LESSON_READING
        ? 'lesson-reading'
        : (currentSharedScope === SHARED_SCOPE_TYPE2 ? 'type2' : 'cards');
    qs.set('from', reportFrom);
    if (categoryKey) {
        qs.set('categoryKey', categoryKey);
    }
    return `/kid-card-report.html?${qs.toString()}`;
}

function buildChineseCardMarkup(card, options = {}) {
    const backText = getChineseCardBackText(card.back);
    return buildCardMarkup(card, {
        cardClassNames: ['type1-chinese-card', ...(Array.isArray(options.cardClassNames) ? options.cardClassNames : [])],
        primaryText: card.front,
        showPrimary: false,
        secondaryHtml: getChineseCardBackHtml(card.back),
        showSecondary: backText.length > 0,
        prependControlsHtml: options.prependControlsHtml,
        trailingActionHtml: options.trailingActionHtml,
        extraSectionHtml: options.extraSectionHtml,
        queueHighlight: options.queueHighlight,
    });
}

function buildGenericType1CardMarkup(card, options = {}) {
    const secondaryText = String(card && card.back ? card.back : '');
    return buildCardMarkup(card, {
        cardClassNames: [...(Array.isArray(options.cardClassNames) ? options.cardClassNames : [])],
        primaryText: card.front,
        showPrimary: secondaryText.trim().length === 0,
        secondaryText,
        showSecondary: secondaryText.trim().length > 0,
        prependControlsHtml: options.prependControlsHtml,
        trailingActionHtml: options.trailingActionHtml,
        extraSectionHtml: options.extraSectionHtml,
        queueHighlight: options.queueHighlight,
    });
}

function buildType2CardMarkup(card, options = {}) {
    const hasSavedAudio = !!card.audio_url;
    const secondaryText = String(card.front || '');
    const promptHtml = `
        <div class="type2-prompt-row">
            <span class="type2-prompt-text">${escapeHtml(secondaryText)}</span>
            <span class="type2-prompt-actions">
                <button
                    type="button"
                    class="type2-prompt-btn edit"
                    data-action="edit-front"
                    data-card-id="${escapeHtml(card.id)}"
                >Edit</button>
                <button
                    type="button"
                    class="type2-prompt-btn play"
                    data-action="load-play-audio"
                    data-card-id="${escapeHtml(card.id)}"
                    aria-label="Play"
                    title="Play"
                ><svg width="14" height="14" viewBox="0 0 20 20" fill="currentColor"><polygon points="4,2 18,10 4,18"/></svg></button>
            </span>
        </div>
        ${hasSavedAudio ? '' : '<div class="type2-prompt-autogen-hint">Will auto-generate on first play</div>'}
    `;
    return buildCardMarkup(card, {
        cardClassNames: ['type2-card', ...(Array.isArray(options.cardClassNames) ? options.cardClassNames : [])],
        showPrimary: false,
        secondaryHtml: promptHtml,
        showSecondary: true,
        extraSectionHtml: options.extraSectionHtml,
        prependControlsHtml: options.prependControlsHtml,
        trailingActionHtml: options.trailingActionHtml,
        queueHighlight: options.queueHighlight,
    });
}

function formatMetricPercent(value) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) {
        return '-';
    }
    const normalized = Math.max(0, Math.min(100, numeric));
    const rounded = Math.round(normalized * 10) / 10;
    return Number.isInteger(rounded) ? `${rounded}%` : `${rounded.toFixed(1)}%`;
}

function formatMillisecondsAsSecondsOrMinutes(value) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric <= 0) {
        return '-';
    }
    const seconds = numeric / 1000;
    if (seconds >= 60) {
        const minutes = seconds / 60;
        const roundedMinutes = Math.round(minutes * 10) / 10;
        return Number.isInteger(roundedMinutes) ? `${roundedMinutes} min` : `${roundedMinutes.toFixed(1)} min`;
    }
    const roundedSeconds = Math.round(seconds * 10) / 10;
    return Number.isInteger(roundedSeconds) ? `${roundedSeconds}s` : `${roundedSeconds.toFixed(1)}s`;
}

function getCardOverallWrongRateValue(card) {
    const attempts = Number.parseInt(card && card.lifetime_attempts, 10);
    if (Number.isInteger(attempts) && attempts <= 0) {
        return null;
    }

    const explicit = Number(card && card.overall_wrong_rate);
    if (Number.isFinite(explicit)) {
        return explicit;
    }
    if (!Number.isInteger(attempts) || attempts <= 0) {
        return null;
    }
    if (isType2Behavior()) {
        const fallback = Number(card && card.hardness_score);
        return Number.isFinite(fallback) ? fallback : null;
    }
    return null;
}

function getCardOverallCorrectRateValue(card) {
    const wrongRate = getCardOverallWrongRateValue(card);
    if (!Number.isFinite(wrongRate)) {
        return null;
    }
    return 100 - wrongRate;
}

function getCardLastResponseTimeValue(card) {
    const explicit = Number(card && card.last_response_time_ms);
    if (Number.isFinite(explicit) && explicit > 0) {
        return explicit;
    }
    const attempts = Number.parseInt(card && card.lifetime_attempts, 10);
    if (!Number.isInteger(attempts) || attempts <= 0) {
        return null;
    }
    if (!isType2Behavior()) {
        const fallback = Number(card && card.hardness_score);
        return Number.isFinite(fallback) && fallback > 0 ? fallback : null;
    }
    return null;
}

function formatDeckPillName(rawName) {
    const text = String(rawName || '').trim();
    if (!text) {
        return '-';
    }
    return text
        .replace(/\s*\/\s*/g, '_')
        .replace(/\s+/g, '_')
        .replace(/_+/g, '_')
        .replace(/^_+|_+$/g, '');
}

function formatCardLastResult(card) {
    const value = String(card && card.last_result || '').toLowerCase();
    if (value === 'right') {
        return 'Right';
    }
    if (value === 'wrong') {
        return 'Wrong';
    }
    if (value === 'ungraded') {
        return 'Ungraded';
    }
    return '-';
}

function looksChineseText(rawText) {
    return /[\u3400-\u9fff]/u.test(String(rawText || ''));
}

function buildExpandedCardPreviewMarkup(card, options = {}) {
    const text = getCompactCardText(card) || '(empty)';
    const totalPracticed = Math.max(0, Number.parseInt(card && card.lifetime_attempts, 10) || 0);
    const classes = ['expanded-card-preview'];
    if (card && card.skip_practice) {
        classes.push('skipped');
    }
    const queueHighlight = String(options.queueHighlight || '').trim().toLowerCase();
    if (queueHighlight) {
        classes.push(`queue-${queueHighlight}`);
    }
    if (looksChineseText(text)) {
        classes.push('chinese');
    }
    return `
        <div class="${classes.join(' ')}" aria-hidden="true">
            <span class="expanded-card-preview-text">${renderMathHtml(text)}</span>
            <span class="expanded-card-preview-badge">${escapeHtml(String(totalPracticed))}</span>
        </div>
    `;
}

function buildCardMarkup(card, options = {}) {
    const classes = ['card-item', 'expanded-detail-card', ...(Array.isArray(options.cardClassNames) ? options.cardClassNames : [])];
    if (card.skip_practice) {
        classes.push('skipped');
    }
    const supportsSkipControl = !isType4Behavior();
    const primaryText = String(options.primaryText || '');
    const secondaryText = String(options.secondaryText || '');
    const secondaryHtml = String(options.secondaryHtml || '');
    const showPrimary = options.showPrimary !== false && primaryText.trim().length > 0;
    const showSecondary = options.showSecondary !== false
        && (secondaryHtml.trim().length > 0 || secondaryText.trim().length > 0);
    const extraSectionHtml = `${String(options.extraSectionHtml || '')}${buildPracticePriorityScoreSection(card)}`;
    const prependControlsHtml = String(options.prependControlsHtml || '');
    const trailingActionHtml = String(options.trailingActionHtml || '');
    const sourceRaw = resolveCardSourceDeckName(card);
    const sourceTitle = escapeHtml(sourceRaw);
    const sourceDisplay = escapeHtml(
        sourceRaw === getPersonalDeckDisplayName()
            ? sourceRaw
            : formatDeckPillName(sourceRaw)
    );
    const addedDateText = window.PracticeManageCommon.formatAddedDate(card && card.created_at);
    const firstPracticedDateText = card && card.first_practiced_at
        ? window.PracticeManageCommon.formatAddedDate(card.first_practiced_at)
        : 'Never';
    const metaItems = [
        { label: 'Added', value: String(addedDateText || '-') },
        { label: 'First Practice', value: String(firstPracticedDateText || '-') },
    ];
    const metaHtml = metaItems
        .map((item) => `
            <div class="expanded-card-meta-item">
                <span class="expanded-card-meta-label">${escapeHtml(item.label)}</span>
                <span class="expanded-card-meta-value">${escapeHtml(item.value)}</span>
            </div>
        `)
        .join('');

    return `
        <div class="${classes.filter(Boolean).join(' ')}">
            ${prependControlsHtml}
            <div class="expanded-card-hero">
                ${buildExpandedCardPreviewMarkup(card, { queueHighlight: options.queueHighlight })}
                <div class="expanded-card-main">
                    ${showPrimary ? `<div class="card-front">${renderMathHtml(primaryText)}</div>` : ''}
                    ${showSecondary ? `<div class="card-back${showPrimary ? '' : ' standalone'}">${secondaryHtml || escapeHtml(secondaryText)}</div>` : ''}
                    <div class="card-deck-row">
                        <span class="card-deck-pill" title="${sourceTitle}">${sourceDisplay}</span>
                    </div>
                </div>
            </div>
            ${extraSectionHtml}
            ${supportsSkipControl && card.skip_practice ? '<div class="skipped-note">Skipped from practice</div>' : ''}
            <div class="expanded-card-meta-row">
                ${metaHtml}
            </div>
            <div class="card-actions">
                <a class="card-report-link" href="${buildCardReportHref(card)}">${icon('history', { size: 16 })}<span>History</span></a>
                ${supportsSkipControl ? `<a
                    class="card-report-link"
                    href="#"
                    data-action="toggle-skip"
                    data-card-id="${card.id}"
                    data-skipped="${card.skip_practice ? 'true' : 'false'}"
                >${card.skip_practice ? `${icon('undo-2', { size: 16 })}<span>Unskip</span>` : `${icon('ban', { size: 16 })}<span>Skip</span>`}</a>` : ''}
                ${trailingActionHtml}
            </div>
        </div>
    `;
}

function buildType4RepresentativeCardMarkup(card) {
    const sourceRaw = resolveCardSourceDeckName(card);
    const sourceTitle = escapeHtml(sourceRaw);
    const sourceDisplay = escapeHtml(
        sourceRaw === getPersonalDeckDisplayName()
            ? sourceRaw
            : formatDeckPillName(sourceRaw)
    );
    const overallCorrectRateText = formatMetricPercent(getCardOverallCorrectRateValue(card));
    const addedDateText = window.PracticeManageCommon.formatAddedDate(card && card.created_at);
    const lastSeenText = window.PracticeManageCommon.formatLastSeenDays(card && card.last_seen_at);
    const lifetimeAttempts = Math.max(0, Number.parseInt(card && card.lifetime_attempts, 10) || 0);
    const isMultichoiceOnly = Boolean(card && card.type4_is_multichoice_only);

    return `
        <div class="card-item type4-summary-card">
            <div class="card-front">${renderMathHtml(String(card && card.front ? card.front : ''))}</div>
            <div class="card-deck-row">
                <span class="card-deck-pill" title="${sourceTitle}">${sourceDisplay}</span>
            </div>
            <div class="type4-summary-metrics">
                <div>Overall correct rate: ${escapeHtml(overallCorrectRateText)}</div>
                <div>Multi-choice only: ${isMultichoiceOnly ? 'Yes' : 'No'}</div>
                <div>Added: ${escapeHtml(String(addedDateText || '-'))}</div>
                <div>Lifetime attempts: ${escapeHtml(String(lifetimeAttempts))}</div>
                <div>Last seen: ${escapeHtml(String(lastSeenText || 'Never'))}</div>
            </div>
            <div class="card-actions type4-summary-actions">
                <button
                    type="button"
                    class="card-report-link type4-generator-trigger"
                    data-action="open-type4-generator"
                    data-card-id="${escapeHtml(String(card && card.id ? card.id : ''))}"
                >Generator</button>
                <button
                    type="button"
                    class="card-report-link"
                    data-action="open-card-records"
                    data-card-id="${escapeHtml(String(card && card.id ? card.id : ''))}"
                >${icon('history', { size: 16 })}<span>History</span></button>
            </div>
        </div>
    `;
}

function getCompactCardText(card) {
    if (isType2Behavior()) {
        return String(card && (card.back || card.front || '')).trim();
    }
    return String(card && (card.front || card.back || '')).trim();
}

function buildCompactCardMarkup(card, options = {}) {
    const text = getCompactCardText(card) || '(empty)';
    const classes = ['card-compact-pill'];
    if (card && card.skip_practice) {
        classes.push('skipped');
    }
    if (isChineseSpecificLogic) {
        classes.push('chinese');
    }
    const queueHighlight = String(options.queueHighlight || '').trim().toLowerCase();
    if (queueHighlight) {
        classes.push(`queue-${queueHighlight}`);
    }
    const scoreValue = usesPracticePriorityDisplay() ? getPracticePriorityScoreValue(card) : null;
    const titlePrefix = isType2Behavior() ? 'Back' : 'Front';
    const totalPracticed = Math.max(0, Number.parseInt(card && card.lifetime_attempts, 10) || 0);
    const cardId = getCardIdText(card);
    const highlightHint = queueHighlight === 'last-failed'
        ? ' • Next session: last failed'
        : (queueHighlight === 'hard'
            ? ' • Next session: hard'
            : (queueHighlight === 'least'
                ? ' • Next session: least practiced'
                : (
                    queueHighlight === PRACTICE_PRIORITY_REASON_MISSED
                        ? ' • Practice queue: missed recently'
                        : (
                            queueHighlight === PRACTICE_PRIORITY_REASON_SLOW
                                ? ' • Practice queue: slow / hesitant'
                                : (
                                    queueHighlight === PRACTICE_PRIORITY_REASON_LEARNING
                                        ? (
                                            isNeverPracticedPriorityCard(card)
                                                ? ' • Practice queue: new card'
                                                : ' • Practice queue: still learning'
                                        )
                                        : (
                                            queueHighlight === PRACTICE_PRIORITY_REASON_DUE
                                                ? ' • Practice queue: due for review'
                                                : ''
                                        )
                                )
                        )
                )));
    const scoreHint = Number.isFinite(scoreValue)
        ? ` • Priority score: ${formatPracticePriorityScore(scoreValue)}`
        : '';
    return `
        <button
            type="button"
            class="${classes.join(' ')}"
            data-action="expand-compact"
            data-card-id="${escapeHtml(cardId)}"
            title="${escapeHtml(`Open details • ${titlePrefix}: ${text}${highlightHint}${scoreHint}`)}"
            aria-label="${escapeHtml(`Open card details: ${text}${highlightHint}${scoreHint}`)}"
        >
            <span class="card-compact-pill-text">${escapeHtml(text)}</span>
            <span class="card-compact-count-badge" aria-hidden="true">${totalPracticed}</span>
        </button>
    `;
}

function buildCompactFoldButtonMarkup(cardId) {
    const safeId = String(cardId || '').trim();
    return `
        <button
            type="button"
            class="compact-fold-btn"
            data-action="collapse-compact"
            data-card-id="${escapeHtml(safeId)}"
            title="Minimize card"
            aria-label="Minimize card"
        >${icon('fold-vertical', { size: 20 })}</button>
    `;
}

function canDeleteExpandedCard(card) {
    return supportsPersonalDeckEditor()
        && Boolean(card && card.source_is_orphan)
        && Number.isInteger(Number.parseInt(card && card.id, 10));
}

function hasPracticedCardAttempts(card) {
    return Number.parseInt(card && card.lifetime_attempts, 10) > 0;
}

function buildExpandedCardDeleteButtonMarkup(card) {
    if (!canDeleteExpandedCard(card)) {
        return '';
    }
    const cardId = String(card && card.id ? card.id : '').trim();
    if (!cardId) {
        return '';
    }
    const isDisabled = hasPracticedCardAttempts(card);
    const title = isDisabled
        ? 'Cannot delete a card that already has practice history'
        : 'Delete this Personal Deck card';
    return `
        <button
            type="button"
            class="expanded-card-delete-btn"
            data-action="delete-personal-card"
            data-card-id="${escapeHtml(cardId)}"
            title="${escapeHtml(title)}"
            aria-label="${escapeHtml(title)}"
            ${isDisabled ? 'disabled aria-disabled="true"' : ''}
        >Delete</button>
    `;
}

function buildLongCardMarkup(card, options = {}) {
    if (isType4Behavior()) {
        return buildType4RepresentativeCardMarkup(card);
    }
    if (isType2Behavior()) {
        return buildType2CardMarkup(card, options);
    }
    return isChineseSpecificLogic
        ? buildChineseCardMarkup(card, options)
        : buildGenericType1CardMarkup(card, options);
}

function applyChineseCardFrontUniformSize() {
    if (!isChineseSpecificLogic || !cardsGrid) {
        return;
    }
    const hasChineseFront = !!cardsGrid.querySelector('.type1-chinese-card .card-front');
    if (!hasChineseFront) {
        cardsGrid.style.removeProperty('--type1-chinese-front-size-rem');
        return;
    }
    cardsGrid.style.setProperty('--type1-chinese-front-size-rem', `${CHINESE_FIXED_FRONT_SIZE_REM}rem`);
}

const CARD_RENDER_CHUNK_SIZE = 20;
let activeCardChunkObserver = null;

function renderCardsInChunks(totalCount, buildItemHtml, postBatchHook, options = {}) {
    if (activeCardChunkObserver) {
        activeCardChunkObserver.disconnect();
        activeCardChunkObserver = null;
    }
    cardsGrid.innerHTML = '';
    if (totalCount <= 0) {
        return;
    }

    const renderAll = !!options.renderAll;

    if (renderAll) {
        const parts = [];
        for (let i = 0; i < totalCount; i += 1) {
            parts.push(buildItemHtml(i));
        }
        cardsGrid.insertAdjacentHTML('beforeend', parts.join(''));
        if (typeof postBatchHook === 'function') {
            postBatchHook();
        }
        return;
    }

    const sentinel = document.createElement('div');
    sentinel.className = 'cards-chunk-sentinel';
    sentinel.style.gridColumn = '1 / -1';
    sentinel.style.height = '1px';
    sentinel.setAttribute('aria-hidden', 'true');
    cardsGrid.appendChild(sentinel);

    let renderedCount = 0;
    const renderNextChunk = () => {
        if (renderedCount >= totalCount) {
            return;
        }
        const end = Math.min(renderedCount + CARD_RENDER_CHUNK_SIZE, totalCount);
        const parts = [];
        for (let i = renderedCount; i < end; i += 1) {
            parts.push(buildItemHtml(i));
        }
        sentinel.insertAdjacentHTML('beforebegin', parts.join(''));
        renderedCount = end;
        if (typeof postBatchHook === 'function') {
            postBatchHook();
        }
        if (renderedCount >= totalCount) {
            if (activeCardChunkObserver) {
                activeCardChunkObserver.disconnect();
                activeCardChunkObserver = null;
            }
            sentinel.remove();
        }
    };

    renderNextChunk();

    while (renderedCount < totalCount) {
        const rect = sentinel.getBoundingClientRect();
        if (rect.top > window.innerHeight + 600) {
            break;
        }
        renderNextChunk();
    }

    if (renderedCount < totalCount) {
        if (typeof IntersectionObserver === 'function') {
            activeCardChunkObserver = new IntersectionObserver((entries) => {
                for (const entry of entries) {
                    if (entry.isIntersecting) {
                        renderNextChunk();
                    }
                }
            }, { rootMargin: '600px 0px 600px 0px' });
            activeCardChunkObserver.observe(sentinel);
        } else {
            while (renderedCount < totalCount) {
                renderNextChunk();
            }
        }
    }
}

function displayCards(cards) {
    sortedCards = getSortedCardsForDisplay(cards);
    const queueHighlightMap = getQueueHighlightMap(cards);
    updateCardsQueueLegendVisibility(sortedCards.length);

    if (mathCardCount) {
        mathCardCount.textContent = `(${sortedCards.length})`;
    }

    if (sortedCards.length === 0) {
        if (activeCardChunkObserver) {
            activeCardChunkObserver.disconnect();
            activeCardChunkObserver = null;
        }
        cardsGrid.innerHTML = `<div class="empty-state" style="grid-column: 1 / -1;"><h3>No cards in merged bank</h3></div>`;
        cardsGrid.classList.remove('short-view');
        cardsGrid.style.removeProperty('--type1-chinese-front-size-rem');
        renderVisibleSkipActionButtons();
        return;
    }

    const visibleCards = sortedCards;
    if (currentCardViewMode === 'long') {
        cardsGrid.classList.remove('short-view');
        renderCardsInChunks(
            visibleCards.length,
            (index) => {
                const card = visibleCards[index];
                const cardId = String(card && card.id ? card.id : '');
                return buildLongCardMarkup(card, {
                    trailingActionHtml: buildExpandedCardDeleteButtonMarkup(card),
                    queueHighlight: queueHighlightMap.get(cardId) || '',
                });
            },
            applyChineseCardFrontUniformSize,
        );
        renderVisibleSkipActionButtons();
        return;
    }

    const visibleIds = new Set(
        visibleCards
            .map((card) => String(card && card.id ? card.id : ''))
            .filter((value) => value.length > 0)
    );
    for (const expandedId of [...expandedCompactCardIds]) {
        if (!visibleIds.has(expandedId)) {
            expandedCompactCardIds.delete(expandedId);
        }
    }

    const hasExpandedCards = visibleCards.some((card) => expandedCompactCardIds.has(String(card && card.id ? card.id : '')));
    cardsGrid.classList.add('short-view');
    if (!hasExpandedCards) {
        cardsGrid.style.removeProperty('--type1-chinese-front-size-rem');
    }
    renderCardsInChunks(
        visibleCards.length,
        (index) => {
            const card = visibleCards[index];
            const cardId = String(card && card.id ? card.id : '');
            if (expandedCompactCardIds.has(cardId)) {
                return `<div class="short-expanded-slot">${buildLongCardMarkup(card, {
                    prependControlsHtml: buildCompactFoldButtonMarkup(cardId),
                    trailingActionHtml: buildExpandedCardDeleteButtonMarkup(card),
                    queueHighlight: queueHighlightMap.get(cardId) || '',
                })}</div>`;
            }
            return buildCompactCardMarkup(card, {
                queueHighlight: queueHighlightMap.get(cardId) || '',
            });
        },
        hasExpandedCards ? applyChineseCardFrontUniformSize : null,
        { renderAll: true },
    );
    renderVisibleSkipActionButtons();
}

function resetAndDisplayCards(cards) {
    displayCards(cards);
}

function updateAddReadingButtonCount() {
    if (!addReadingBtn || !chineseCharInput) {
        return;
    }
    if (isReadingBulkAdding) {
        addReadingBtn.textContent = 'Adding...';
        addReadingBtn.disabled = true;
        return;
    }
    const csvMode = isType1ChineseEnglishBackMode();
    let dedupStats;
    if (csvMode) {
        dedupStats = getType1EnglishBackBulkInputStats(chineseCharInput.value);
    } else if (isType2Behavior()) {
        dedupStats = getType2ChineseBulkInputStats(chineseCharInput.value);
    } else {
        dedupStats = getType1ChineseBulkInputStats(chineseCharInput.value);
    }
    const hasInput = String(chineseCharInput.value || '').trim().length > 0;
    addReadingBtn.disabled = csvMode ? !hasInput : dedupStats.uniqueCount <= 0;
    if (dedupStats.uniqueCount > 0) {
        const countText = dedupStats.dedupedCount > 0
            ? `${dedupStats.uniqueCount}, dedup ${dedupStats.dedupedCount}`
            : `${dedupStats.uniqueCount}`;
        addReadingBtn.textContent = `Bulk Add (${countText})`;
        return;
    }
    addReadingBtn.textContent = 'Bulk Add';
}

function setReadingBulkAddBusy(isBusy) {
    if (!addReadingBtn || !chineseCharInput) {
        return;
    }
    isReadingBulkAdding = !!isBusy;
    addReadingBtn.disabled = isReadingBulkAdding;
    chineseCharInput.disabled = isReadingBulkAdding;
    updateAddReadingButtonCount();
}

function getType1ChineseBulkInputStats(text) {
    const matches = String(text || '').match(/\p{Script=Han}/gu);
    const values = Array.isArray(matches) ? matches : [];
    const uniqueValues = [...new Set(values)];
    return {
        totalCount: values.length,
        uniqueCount: uniqueValues.length,
        dedupedCount: Math.max(0, values.length - uniqueValues.length),
        uniqueValues,
    };
}

function getType2ChineseBulkInputStats(text) {
    const matches = String(text || '').match(/[\u3400-\u9FFF\uF900-\uFAFF]+/g);
    const rawValues = Array.isArray(matches) ? matches : [];
    const values = rawValues
        .map((token) => String(token || '').trim())
        .filter((token) => token.length > 0);
    const uniqueValues = [...new Set(values)];
    return {
        totalCount: values.length,
        uniqueCount: uniqueValues.length,
        dedupedCount: Math.max(0, values.length - uniqueValues.length),
        uniqueValues,
    };
}

function getType1EnglishBackBulkInputStats(text) {
    const lines = String(text || '').split(/\r?\n/);
    const entries = [];
    const errors = [];
    const seenFronts = new Set();
    let dedupedCount = 0;
    lines.forEach((rawLine, idx) => {
        const line = String(rawLine || '').trim();
        if (!line) {
            return;
        }
        const lineNumber = idx + 1;
        const commaIdx = line.indexOf(',');
        if (commaIdx < 0) {
            errors.push({ lineNumber, line });
            return;
        }
        const front = line.slice(0, commaIdx).trim();
        const back = line.slice(commaIdx + 1).trim();
        if (!front || !back || !/^[\u3400-\u9FFF\uF900-\uFAFF]+$/.test(front)) {
            errors.push({ lineNumber, line });
            return;
        }
        if (seenFronts.has(front)) {
            dedupedCount += 1;
            return;
        }
        seenFronts.add(front);
        entries.push({ front, back });
    });
    return {
        entries,
        errors,
        totalCount: entries.length + dedupedCount,
        uniqueCount: entries.length,
        dedupedCount,
    };
}

async function loadSharedDeckCards() {
    const requestId = sharedDeckCardsResponseTracker
        ? sharedDeckCardsResponseTracker.begin()
        : 0;
    try {
        const url = new URL(buildSharedDeckApiUrl('shared-decks/cards'));
        const previewRaw = Number.parseInt(getHardCardPercentForMixLegend(), 10);
        const previewHardPct = Number.isInteger(previewRaw)
            ? Math.max(0, Math.min(100, previewRaw))
            : null;
        if (!supportsPracticePriorityPreview() && previewHardPct !== null) {
            url.searchParams.set('hard_card_percentage', String(previewHardPct));
        }
        const response = await fetch(url.toString());
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
            throw new Error(data.error || `Failed to load merged cards (HTTP ${response.status})`);
        }
        if (sharedDeckCardsResponseTracker && !sharedDeckCardsResponseTracker.shouldApply(requestId)) {
            return;
        }

        const hadQueueSettingChanges = hasQueueSettingsChanges();
        const previousCardCount = Array.isArray(currentCards) ? currentCards.length : 0;
        currentCards = Array.isArray(data.cards) ? data.cards : [];
        currentDailyProgressRows = Array.isArray(data.daily_progress_rows) ? data.daily_progress_rows : [];
        currentFamilyTimezone = String(data.family_timezone || '').trim();
        updateSessionCardCountCapFromCardsPayload(data);
        const normalizedSessionCount = normalizeSessionCountInputValue();
        if (!hadQueueSettingChanges) {
            setQueueSettingsBaseline(
                normalizedSessionCount,
                supportsPracticePriorityPreview() ? 0 : getHardCardPercentForMixLegend(),
            );
        }
        await maybeAutoSetSessionCountForNewCards(previousCardCount, currentCards.length);
        updateQueueMixLegend();

        const skippedCount = Number.isInteger(Number.parseInt(data.skipped_card_count, 10))
            ? Number.parseInt(data.skipped_card_count, 10)
            : currentCards.filter((card) => !!card.skip_practice).length;
        currentSkippedCardCount = skippedCount;
        resetAndDisplayCards(currentCards);
        if (currentCardsViewMode === 'stats') {
            renderStatsView();
        }
    } catch (error) {
        console.error('Error loading shared category cards:', error);
        showError(error.message || `Failed to load shared ${getCurrentCategoryDisplayName()} cards.`);
    }
}

async function updateSharedType1CardSkip(cardId, skipped, options = {}) {
    const reloadCards = options.reloadCards !== false;
    const response = await fetch(buildSharedDeckApiUrl(`shared-decks/cards/${cardId}/skip`), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ skipped })
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
        throw new Error(result.error || `Failed to update skip (HTTP ${response.status})`);
    }
    if (reloadCards) {
        await loadSharedDeckCards();
    }
    showError('');
}

async function updateSharedType1CardsSkipBulk(cardIds, skipped) {
    const normalizedIds = [...new Set(
        (Array.isArray(cardIds) ? cardIds : [])
            .map((value) => Number.parseInt(value, 10))
            .filter((value) => Number.isInteger(value))
    )];
    if (normalizedIds.length <= 0) {
        return { updated_count: 0, skip_practice: Boolean(skipped) };
    }
    const response = await fetch(buildSharedDeckApiUrl('shared-decks/cards/skip-bulk'), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            card_ids: normalizedIds,
            skipped: Boolean(skipped),
        }),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
        throw new Error(result.error || `Failed to update skip (HTTP ${response.status})`);
    }
    showError('');
    return result;
}

async function applyVisibleCardsSkip(targetSkipped) {
    if (isBulkSkipActionInFlight) {
        return;
    }
    const visibleCards = getVisibleCardsForDisplay(currentCards);
    const cardsToUpdate = visibleCards.filter((card) => Boolean(card.skip_practice) !== Boolean(targetSkipped));
    if (cardsToUpdate.length <= 0) {
        renderVisibleSkipActionButtons();
        return;
    }
    isBulkSkipActionInFlight = true;
    renderVisibleSkipActionButtons();
    try {
        showError('');
        showSuccess('');
        showCardsBulkActionMessage('');
        const cardIds = cardsToUpdate.map((card) => Number.parseInt(card && card.id, 10)).filter((id) => Number.isInteger(id));
        const result = await updateSharedType1CardsSkipBulk(cardIds, targetSkipped);
        const successCount = Math.max(0, Number.parseInt(result && result.updated_count, 10) || 0);
        const failedCount = Math.max(0, cardIds.length - successCount);
        await loadSharedDeckCards();
        if (failedCount > 0 && successCount > 0) {
            showCardsBulkActionMessage(
                `${targetSkipped ? 'Skipped' : 'Unskipped'} ${successCount} shown card(s); failed ${failedCount}.`,
                true
            );
        } else if (failedCount > 0) {
            showCardsBulkActionMessage(`Failed to update ${failedCount} shown card(s).`, true);
        } else if (successCount > 0) {
            showCardsBulkActionMessage(`${targetSkipped ? 'Skipped' : 'Unskipped'} ${successCount} shown card(s).`, false);
        }
    } catch (error) {
        console.error('Error applying bulk skip to shown cards:', error);
        showCardsBulkActionMessage(error.message || 'Failed to update shown cards.', true);
    } finally {
        isBulkSkipActionInFlight = false;
        renderVisibleSkipActionButtons();
    }
}

async function addOrphanCards() {
    if (!isChineseSpecificLogic || isReadingBulkAdding) {
        return;
    }
    try {
        setReadingBulkAddBusy(true);
        showStatusMessage('');
        showError('');
        showSuccess('');

        const input = String(chineseCharInput ? chineseCharInput.value : '').trim();
        if (isType2Behavior()) {
            const tokenCount = getType2ChineseBulkInputStats(input).uniqueCount;
            if (tokenCount === 0) {
                showError('Please enter at least one Chinese word/phrase');
                return;
            }

            const response = await fetch(buildType2ApiUrl('cards/bulk'), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    categoryKey,
                    text: input,
                }),
            });
            const result = await response.json().catch(() => ({}));
            if (!response.ok) {
                throw new Error(result.error || `Failed to add cards (HTTP ${response.status})`);
            }
            const inserted = Math.max(0, Number(result.inserted_count) || 0);
            addCardForm.reset();
            updateAddReadingButtonCount();
            showStatusMessage(buildBulkAddStatusMessage(inserted, result), false);
            await loadSharedType1Decks();
            return;
        }

        let cardsPayload;
        if (isType1ChineseEnglishBackMode()) {
            const stats = getType1EnglishBackBulkInputStats(input);
            if (stats.errors.length > 0) {
                const badLines = stats.errors.slice(0, 3).map((e) => `line ${e.lineNumber}`).join(', ');
                const more = stats.errors.length > 3 ? ` (+${stats.errors.length - 3} more)` : '';
                showStatusMessage(`Invalid format on ${badLines}${more}. ${TYPE1_ENGLISH_BACK_FORMAT_HINT}`, true);
                return;
            }
            if (stats.entries.length === 0) {
                showStatusMessage(`No entries to add. ${TYPE1_ENGLISH_BACK_FORMAT_HINT}`, true);
                return;
            }
            cardsPayload = stats.entries;
        } else {
            const chineseChars = getType1ChineseBulkInputStats(input).uniqueValues;
            if (chineseChars.length === 0) {
                showError('Please enter at least one Chinese character');
                return;
            }
            cardsPayload = chineseChars.map((ch) => ({ front: ch, back: '' }));
        }

        const addUrl = withCategoryKey(new URL(`${API_BASE}/kids/${kidId}/cards/bulk`));
        const response = await fetch(addUrl.toString(), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                categoryKey,
                cards: cardsPayload,
            }),
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok) {
            throw new Error(result.error || `Failed to add cards (HTTP ${response.status})`);
        }

        const inserted = Math.max(0, Number(result.created) || 0);
        addCardForm.reset();
        updateAddReadingButtonCount();
        showStatusMessage(buildBulkAddStatusMessage(inserted, result), false);
        await loadSharedType1Decks();
    } catch (error) {
        console.error('Error adding orphan cards:', error);
        showStatusMessage('');
        showError(error.message || 'Failed to add cards.');
    } finally {
        setReadingBulkAddBusy(false);
    }
}

async function editType2CardPrompt(cardId) {
    if (!isType2Behavior()) {
        return;
    }
    try {
        const targetCard = (Array.isArray(currentCards) ? currentCards : []).find((card) => String(card.id) === String(cardId));
        if (!targetCard) {
            showError('Card not found.');
            return;
        }

        const currentFront = String(targetCard.front || '').trim();
        const nextFrontRaw = window.prompt('Edit voice prompt (front):', currentFront);
        if (nextFrontRaw === null) {
            return;
        }
        const nextFront = String(nextFrontRaw || '').trim();
        if (!nextFront) {
            showError('Prompt text cannot be empty.');
            return;
        }
        if (nextFront === currentFront) {
            return;
        }

        const response = await fetch(buildType2ApiUrl(`cards/${encodeURIComponent(cardId)}`), {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                front: nextFront,
                categoryKey,
            }),
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
            throw new Error(payload.error || `HTTP ${response.status}`);
        }
        showError('');
        showSuccess('Prompt updated.');
        await loadSharedType1Decks();
    } catch (error) {
        showError(error.message || 'Failed to update voice prompt');
    }
}

async function deleteExpandedPersonalCard(cardId) {
    const targetCard = (Array.isArray(currentCards) ? currentCards : []).find((card) => String(card && card.id) === String(cardId));
    if (!targetCard) {
        showError('Card not found.');
        return;
    }
    if (!canDeleteExpandedCard(targetCard)) {
        showError('Only Personal Deck cards can be deleted here.');
        return;
    }
    if (hasPracticedCardAttempts(targetCard)) {
        showError('Cards with practice history cannot be deleted.');
        return;
    }

    const requestUrl = isType2Behavior()
        ? buildType2ApiUrl(`cards/${encodeURIComponent(cardId)}`)
        : buildType1PersonalCardApiUrl(cardId);
    const response = await fetch(requestUrl, {
        method: 'DELETE',
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
        showError(result.error || 'Failed to delete card.');
        return;
    }

    expandedCompactCardIds.delete(String(cardId));
    showError('');
    showSuccess('Card deleted.');
    await loadSharedType1Decks();
}

async function handleCardsGridClick(event) {
    const actionBtn = event.target.closest('[data-action]');
    if (!actionBtn) {
        return;
    }
    const action = actionBtn.dataset.action;

    if (action === 'open-type4-generator') {
        const cardId = String(actionBtn.dataset.cardId || '').trim();
        if (!cardId) {
            return;
        }
        const card = (Array.isArray(currentCards) ? currentCards : []).find(
            (item) => String(item && item.id ? item.id : '') === cardId
        );
        if (!card) {
            showError('Representative card not found.');
            return;
        }
        openType4GeneratorModal(card);
        return;
    }

    if (action === 'open-card-records') {
        const cardId = String(actionBtn.dataset.cardId || '').trim();
        if (!cardId) {
            return;
        }
        const card = (Array.isArray(currentCards) ? currentCards : []).find(
            (item) => String(item && item.id ? item.id : '') === cardId
        );
        if (!card) {
            showError('Card not found.');
            return;
        }
        window.location.href = buildCardReportHref(card);
        return;
    }

    if (action === 'expand-compact') {
        const cardId = String(actionBtn.dataset.cardId || '').trim();
        if (!cardId) {
            return;
        }
        expandedCompactCardIds.add(cardId);
        displayCards(currentCards);
        return;
    }

    if (action === 'collapse-compact') {
        const cardId = String(actionBtn.dataset.cardId || '').trim();
        if (!cardId || !expandedCompactCardIds.has(cardId)) {
            return;
        }
        expandedCompactCardIds.delete(cardId);
        if (currentCardViewMode === 'long') {
            currentCardViewMode = 'short';
            renderCardViewModeButtons();
        }
        displayCards(currentCards);
        return;
    }

    if (action === 'load-play-audio') {
        const cardId = actionBtn.dataset.cardId;
        if (!cardId) {
            return;
        }
        const targetCard = (Array.isArray(currentCards) ? currentCards : []).find((card) => String(card.id) === String(cardId));
        if (!targetCard) {
            showError('Card not found.');
            return;
        }
        if (!promptPreviewPlayer) {
            showError('Audio player unavailable on this page.');
            return;
        }
        const promptUrls = promptPreviewPlayer.buildPromptUrls(targetCard);
        if (promptUrls.length === 0) {
            showError('No audio found for this card.');
            return;
        }
        showError('');
        promptPreviewPlayer.playUrls(promptUrls);
        return;
    }

    if (action === 'edit-front') {
        const cardId = actionBtn.dataset.cardId;
        if (!cardId) {
            return;
        }
        await editType2CardPrompt(cardId);
        return;
    }

    if (action === 'delete-personal-card') {
        const cardId = actionBtn.dataset.cardId;
        if (!cardId) {
            return;
        }
        try {
            actionBtn.disabled = true;
            await deleteExpandedPersonalCard(cardId);
        } finally {
            actionBtn.disabled = false;
        }
        return;
    }

    if (action !== 'toggle-skip') {
        return;
    }
    event.preventDefault();

    const cardId = actionBtn.dataset.cardId;
    if (!cardId) {
        return;
    }

    const currentlySkipped = actionBtn.dataset.skipped === 'true';
    const targetSkipped = !currentlySkipped;
    try {
        actionBtn.disabled = true;
        if (isBulkSkipActionInFlight) {
            return;
        }
        await updateSharedType1CardSkip(cardId, targetSkipped);
    } catch (error) {
        console.error('Error updating shared category card skip:', error);
        showError(error.message || 'Failed to update skip status.');
    } finally {
        actionBtn.disabled = false;
    }
}

async function loadKidInfo() {
    const response = await fetch(`${API_BASE}/kids/${kidId}?view=manage`);
    const kid = await response.json().catch(() => ({}));
    if (!response.ok) {
        throw new Error(kid.error || `Failed to load kid (HTTP ${response.status})`);
    }

    const categoryMetaMap = getDeckCategoryMetaMap(kid);
    const categoryMeta = categoryMetaMap[categoryKey] || {};
    const displayName = String(categoryMeta && categoryMeta.display_name ? categoryMeta.display_name : '').trim();
    const behaviorType = String(categoryMeta && categoryMeta.behavior_type ? categoryMeta.behavior_type : '')
        .trim()
        .toLowerCase();
    if (
        behaviorType !== BEHAVIOR_TYPE_TYPE_I
        && behaviorType !== BEHAVIOR_TYPE_TYPE_II
        && behaviorType !== BEHAVIOR_TYPE_TYPE_III
        && behaviorType !== BEHAVIOR_TYPE_TYPE_IV
    ) {
        throw new Error(`Unsupported manage behavior type: ${behaviorType || 'unknown'}`);
    }
    currentBehaviorType = behaviorType;
    document.body.classList.toggle('type4-manage', behaviorType === BEHAVIOR_TYPE_TYPE_IV);
    currentSharedScope = (
        behaviorType === BEHAVIOR_TYPE_TYPE_IV
            ? SHARED_SCOPE_TYPE4
            : (
                behaviorType === BEHAVIOR_TYPE_TYPE_III
            ? SHARED_SCOPE_LESSON_READING
                    : (behaviorType === BEHAVIOR_TYPE_TYPE_II ? SHARED_SCOPE_TYPE2 : SHARED_SCOPE_CARDS)
            )
    );

    isChineseSpecificLogic = Boolean(categoryMeta && categoryMeta.has_chinese_specific_logic);
    currentChineseBackContent = String(categoryMeta && categoryMeta.chinese_back_content ? categoryMeta.chinese_back_content : '').trim().toLowerCase();
    currentCategoryDisplayName = displayName;
    currentKidName = String(kid.name || '').trim();
    applyCategoryUiText();

    window.PracticeManageCommon.applyKidManageTabVisibility({
        kidId,
        optedInCategoryKeys: kid.optedInDeckCategoryKeys,
        deckCategoryMetaByKey: kid.deckCategoryMetaByKey,
        defaultCategoryByRoute: {
            '/kid-card-manage.html': categoryKey,
        },
    });

    kidNameEl.textContent = 'Card Management';
    includeOrphanByCategory = toCategoryMap(kid[INCLUDE_ORPHAN_BY_CATEGORY_FIELD]);
    const total = getSessionCountFromKid(kid);
    const safeTotal = Number.isInteger(total) ? clampSessionCardCount(total) : 0;
    if (sessionCardCountInput) {
        sessionCardCountInput.value = String(safeTotal);
    }
    initialHardCardPercent = supportsPracticePriorityPreview()
        ? 0
        : getInitialHardCardPercentFromKid(kid);
    const safeHard = Number.isInteger(initialHardCardPercent)
        ? Math.max(0, Math.min(100, initialHardCardPercent))
        : 0;
    if (hardnessPercentSlider) {
        hardnessPercentSlider.value = String(safeHard);
    }
    syncType4CardOrderOptions();
    setQueueSettingsBaseline(safeTotal, safeHard);
    updateQueueMixLegend();
}

async function loadSharedType1Decks(options = {}) {
    const response = await fetch(buildSharedDeckApiUrl('shared-decks'));
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
        throw new Error(result.error || `Failed to load predefined decks (HTTP ${response.status})`);
    }
    allDecks = Array.isArray(result.decks) ? result.decks : [];
    baselineOptedDeckIdSet = new Set(
        allDecks
            .filter((deck) => Boolean(deck.opted_in))
            .map((deck) => Number(deck.deck_id))
            .filter((deckId) => deckId > 0)
    );
    stagedOptedDeckIdSet = new Set(baselineOptedDeckIdSet);
    orphanDeck = result && typeof result.orphan_deck === 'object' && result.orphan_deck
        ? result.orphan_deck
        : null;

    const responseTotal = Number.parseInt(result.session_card_count, 10);
    if (Number.isInteger(responseTotal)) {
        const safeTotal = clampSessionCardCount(responseTotal);
        if (sessionCardCountInput) {
            sessionCardCountInput.value = String(safeTotal);
        }
        setQueueSettingsBaseline(
            safeTotal,
            supportsPracticePriorityPreview() ? 0 : baselineHardCardPercent,
        );
    }
    baselineIncludeOrphanInQueue = Boolean(result && result.include_orphan_in_queue);
    stagedIncludeOrphanInQueue = baselineIncludeOrphanInQueue;

    renderDeckPendingInfo();
    updateQueueMixLegend();
    if (!options.skipCards) {
        await loadSharedDeckCards();
    }
}

async function saveQueueSettings() {
    if (isType4Behavior()) {
        return;
    }
    showError('');

    const total = normalizeSessionCountInputValue();
    const hardPct = supportsPracticePriorityPreview() ? 0 : normalizeHardSliderValue();
    const maxSessionCount = getSessionCardCountCap();
    if (total < 0) {
        showError(`${getCurrentCategoryDisplayName()} cards/day must be 0 or more.`);
        return;
    }
    if (maxSessionCount !== null && total > maxSessionCount) {
        showError(`${getCurrentCategoryDisplayName()} cards/day must be between 0 and ${maxSessionCount}.`);
        return;
    }
    if (!supportsPracticePriorityPreview() && (hardPct < 0 || hardPct > 100)) {
        showError('Hard cards % must be between 0 and 100.');
        return;
    }
    if (!hasQueueSettingsChanges()) {
        updateQueueSettingsSaveButtonState();
        return;
    }
    cancelQueuePreviewReload();
    isQueueSettingsSaving = true;
    updateQueueSettingsSaveButtonState();
    const response = await fetch(`${API_BASE}/kids/${kidId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            ...buildSessionCountPayload(total),
            ...(!supportsPracticePriorityPreview() ? buildHardCardPercentPayload(hardPct) : {}),
        }),
    });
    try {
        const result = await response.json().catch(() => ({}));
        if (!response.ok) {
            throw new Error(result.error || `Failed to save settings (HTTP ${response.status})`);
        }
        applySessionCountFromPayload(result);
        const persistedTotal = getCategoryIntValue(sessionCardCountByCategory);
        const persistedHard = supportsPracticePriorityPreview()
            ? 0
            : getPersistedHardCardPercentFromPayload(result);
        sessionCardCountInput.value = String(clampSessionCardCount(persistedTotal));
        if (hardnessPercentSlider && !supportsPracticePriorityPreview()) {
            hardnessPercentSlider.value = String(Math.max(0, Math.min(100, persistedHard)));
        }
        setQueueSettingsBaseline(
            sessionCardCountInput.value,
            supportsPracticePriorityPreview()
                ? 0
                : (hardnessPercentSlider ? hardnessPercentSlider.value : persistedHard),
        );
        updateQueueMixLegend();
        await loadSharedDeckCards();
    } finally {
        isQueueSettingsSaving = false;
        updateQueueSettingsSaveButtonState();
    }
}
