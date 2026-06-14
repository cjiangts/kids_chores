/*
 * kid-card-manage-cards.js — card row markup, list rendering, mutation
 * actions, and kid/deck loaders for the kid-card-manage page.
 *
 * Card markup builders compose row HTML for type-I, type-II, type-IV,
 * Chinese, and expanded preview variants. Display flow goes:
 *
 *     loadSharedDeckCards / loadSharedType1Decks
 *         → displayCards(cards) → renderCardsInChunks
 *         → buildCardMarkup / type-specific markup builder per row
 *
 * Click events on the cards grid hit handleCardsGridClick which
 * dispatches to skip toggles, edit, delete, deck pickers, expand, etc.
 *
 * Layout (search for `// === N. ` banners to jump between sections):
 *
 *     1. Card markup builders + format helpers
 *     2. Card list render loop + scroll/focus
 *     3. Bulk-input parsers + preview helpers
 *     4. Shared-deck card mutations (skip, recording download)
 *     5. Personal card CRUD (preview, add, edit, delete)
 *     6. Cards grid click handler
 *     7. Kid info + decks loaders + queue settings save
 */

// =====================================================================
// === 1. Card markup builders + format helpers
// =====================================================================
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
        collapseCardId: options.collapseCardId,
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
        collapseCardId: options.collapseCardId,
    });
}

function buildType2CardMarkup(card, options = {}) {
    const hasSavedAudio = !!card.audio_url;
    const secondaryText = String(card.back || card.front || '');
    const thumbDownCount = Number.parseInt(card && card.thumb_down_count, 10);
    const hasThumbDown = Number.isInteger(thumbDownCount) && thumbDownCount > 0;
    const thumbDownBadgeHtml = hasThumbDown
        ? `<span class="type2-prompt-thumb-down-badge" title="Kid disliked this prompt ${thumbDownCount} time${thumbDownCount === 1 ? '' : 's'}">${icon('thumbs-down', { size: 12, strokeWidth: 2.2 })}<span>${thumbDownCount}</span></span>`
        : '';
    const promptHtml = `
        <div class="type2-prompt-row">
            <button
                type="button"
                class="type2-prompt-play"
                data-action="load-play-audio"
                data-card-id="${escapeHtml(card.id)}"
                aria-label="Play prompt"
                title="Play prompt"
            ><svg width="11" height="11" viewBox="0 0 20 20" fill="currentColor"><polygon points="4,2 18,10 4,18"/></svg></button>
            <span class="type2-prompt-text">${escapeHtml(secondaryText)}</span>
            ${thumbDownBadgeHtml}
            <button
                type="button"
                class="type2-prompt-edit"
                data-action="edit-back"
                data-card-id="${escapeHtml(card.id)}"
                aria-label="Edit prompt"
                title="Edit prompt"
            >${icon('pencil', { size: 12, stroke: 2.2 })}</button>
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
        collapseCardId: options.collapseCardId,
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
    if (isCardInPendingWorksheet(card)) {
        classes.push('in-worksheet');
    }
    const queueHighlight = String(options.queueHighlight || '').trim().toLowerCase();
    if (queueHighlight) {
        classes.push(`queue-${queueHighlight}`);
    }
    if (looksChineseText(text)) {
        classes.push('chinese');
    }
    const innerHtml = `
        <span class="expanded-card-preview-text">${renderMathHtml(text)}</span>
        <span class="expanded-card-preview-badge">${escapeHtml(String(totalPracticed))}</span>
    `;
    const collapseCardId = String(options.collapseCardId || '').trim();
    if (collapseCardId) {
        classes.push('is-collapse-trigger');
        return `
            <button
                type="button"
                class="${classes.join(' ')}"
                data-action="collapse-compact"
                data-card-id="${escapeHtml(collapseCardId)}"
                title="Minimize card"
                aria-label="Minimize card"
            >${innerHtml}</button>
        `;
    }
    return `
        <div class="${classes.join(' ')}" aria-hidden="true">${innerHtml}</div>
    `;
}

function buildCardMarkup(card, options = {}) {
    const classes = ['card-item', 'expanded-detail-card', ...(Array.isArray(options.cardClassNames) ? options.cardClassNames : [])];
    if (card.skip_practice) {
        classes.push('skipped');
    }
    if (focusedCardId && String(card && card.id ? card.id : '') === String(focusedCardId)) {
        classes.push('is-focused-card');
    }
    const supportsSkipControl = !isType4Behavior();
    const primaryText = String(options.primaryText || '');
    const secondaryText = String(options.secondaryText || '');
    const secondaryHtml = String(options.secondaryHtml || '');
    const showPrimary = options.showPrimary !== false && primaryText.trim().length > 0;
    const showSecondary = options.showSecondary !== false
        && (secondaryHtml.trim().length > 0 || secondaryText.trim().length > 0);
    const secondaryPlainText = (secondaryText && secondaryText.trim())
        || (secondaryHtml ? secondaryHtml.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim() : '');
    const secondaryLength = secondaryPlainText.length;
    const cardBackSizeClass = secondaryLength > 60 ? ' size-xs'
        : secondaryLength > 40 ? ' size-sm'
        : secondaryLength > 22 ? ' size-md'
        : '';
    const extraSectionHtml = `${String(options.extraSectionHtml || '')}${buildPracticePriorityScoreSection(card)}`;
    const prependControlsHtml = String(options.prependControlsHtml || '');
    const trailingActionHtml = String(options.trailingActionHtml || '');
    const collapseCardId = String(options.collapseCardId || '').trim();
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

    const inNextSession = String(options.queueHighlight || '').trim().length > 0;
    const heroAsideHtml = buildPracticePriorityHeroAside(card, { inNextSession });
    const deckRowExtraHtml = String(options.deckRowExtraHtml || '');
    const showPreviewPill = options.showPreviewPill !== false;
    return `
        <div class="${classes.filter(Boolean).join(' ')}">
            ${prependControlsHtml}
            <div class="expanded-card-hero${heroAsideHtml ? ' has-aside' : ''}">
                ${showPreviewPill ? buildExpandedCardPreviewMarkup(card, { queueHighlight: options.queueHighlight, collapseCardId }) : ''}
                <div class="expanded-card-main">
                    ${showPrimary ? `<div class="card-front">${renderMathHtml(primaryText)}</div>` : ''}
                    ${showSecondary ? `<div class="card-back${showPrimary ? '' : ' standalone'}${cardBackSizeClass}">${secondaryHtml || escapeHtml(secondaryText)}</div>` : ''}
                    <div class="card-deck-row">
                        <span class="card-deck-pill" title="${sourceTitle}">${sourceDisplay}</span>
                        ${deckRowExtraHtml}
                    </div>
                </div>
                ${heroAsideHtml}
            </div>
            ${extraSectionHtml}
            ${supportsSkipControl && card.skip_practice ? '<div class="skipped-note">Skipped from practice</div>' : ''}
            <div class="expanded-card-meta-row">
                ${metaHtml}
            </div>
            <div class="card-actions">
                <a class="paradigm-btn" href="${buildCardReportHref(card)}">${icon('history', { size: 16 })}<span>History</span></a>
                ${supportsSkipControl ? `<a
                    class="paradigm-btn"
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
    const cardIdAttr = escapeHtml(String(card && card.id ? card.id : ''));
    const isMultichoiceOnly = Boolean(card && card.type4_is_multichoice_only);
    const multichoiceChipHtml = isMultichoiceOnly
        ? '<span class="type4-multichoice-chip" title="This card is generated as multiple choice only">Multi-choice only</span>'
        : '';
    const generatorBtnHtml = `
        <button
            type="button"
            class="card-report-link type4-generator-trigger"
            data-action="open-type4-generator"
            data-card-id="${cardIdAttr}"
        >${icon('sparkles', { size: 16 })}<span>Generator</span></button>
    `;
    return buildCardMarkup(card, {
        cardClassNames: ['type4-card'],
        primaryText: String(card && card.front ? card.front : ''),
        showPrimary: true,
        showSecondary: false,
        showPreviewPill: false,
        deckRowExtraHtml: multichoiceChipHtml,
        extraSectionHtml: buildType4PriorityDetailSection(card),
        trailingActionHtml: generatorBtnHtml,
    });
}

function getCompactCardText(card) {
    return String(card && (card.front || card.back || '')).trim();
}

function buildCompactCardMarkup(card, options = {}) {
    const text = getCompactCardText(card) || '(empty)';
    const classes = ['card-compact-pill'];
    if (card && card.skip_practice) {
        classes.push('skipped');
    }
    if (isCardInPendingWorksheet(card)) {
        classes.push('in-worksheet');
    }
    if (isChineseSpecificLogic) {
        classes.push('chinese');
    }
    const queueHighlight = String(options.queueHighlight || '').trim().toLowerCase();
    if (queueHighlight) {
        classes.push(`queue-${queueHighlight}`);
    }
    const scoreValue = usesPracticePriorityDisplay() ? getPracticePriorityScoreValue(card) : null;
    const totalPracticed = Math.max(0, Number.parseInt(card && card.lifetime_attempts, 10) || 0);
    const cardId = getCardIdText(card);
    const isSelected = isCardsSelectModeOn && cardId && selectedCardIds.has(cardId);
    if (isSelected) {
        classes.push('selected');
    }
    const highlightHint = queueHighlight === 'last-failed'
        ? ' • Next session: last failed'
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
            ));
    const worksheetHint = isCardInPendingWorksheet(card)
        ? ' • In worksheet practice'
        : '';
    const scoreHint = Number.isFinite(scoreValue)
        ? ` • Priority score: ${formatPracticePriorityScore(scoreValue)}`
        : '';
    const action = isCardsSelectModeOn ? 'toggle-select' : 'expand-compact';
    const titleAttr = isCardsSelectModeOn
        ? escapeHtml(`${isSelected ? 'Deselect' : 'Select'} • Front: ${text}`)
        : escapeHtml(`Open details • Front: ${text}${worksheetHint}${highlightHint}${scoreHint}`);
    const ariaLabel = isCardsSelectModeOn
        ? escapeHtml(`${isSelected ? 'Deselect' : 'Select'} card: ${text}`)
        : escapeHtml(`Open card details: ${text}${worksheetHint}${highlightHint}${scoreHint}`);
    const selectAttrs = isCardsSelectModeOn
        ? ` aria-pressed="${isSelected ? 'true' : 'false'}" data-select-card-id="${escapeHtml(cardId)}"`
        : '';
    return `
        <button
            type="button"
            class="${classes.join(' ')}"
            data-action="${action}"
            data-card-id="${escapeHtml(cardId)}"
            title="${titleAttr}"
            aria-label="${ariaLabel}"${selectAttrs}
        >
            <span class="card-compact-pill-check" aria-hidden="true">${icon('check', { size: 12, strokeWidth: 3 })}</span>
            <span class="card-compact-pill-text">${escapeHtml(text)}</span>
            <span class="card-compact-count-badge" aria-hidden="true">${totalPracticed}</span>
        </button>
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
            class="paradigm-btn is-danger"
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

// =====================================================================
// === 2. Card list render loop + scroll/focus
// =====================================================================
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

    if (sortedCards.length === 0) {
        if (activeCardChunkObserver) {
            activeCardChunkObserver.disconnect();
            activeCardChunkObserver = null;
        }
        const hasPersonalEditor = supportsPersonalDeckEditor();
        const optInChip = '<strong class="empty-state-action"><span data-icon="layers" data-icon-size="16" data-icon-stroke="2.2"></span> Manage Deck Opt-in</strong>';
        const personalChip = '<strong class="empty-state-action"><span data-icon="pencil" data-icon-size="16" data-icon-stroke="2.2"></span> Personal Deck Editor</strong>';
        const emptyStateHint = hasPersonalEditor
            ? `Click ${optInChip} above to enable shared decks, or ${personalChip} to add your own cards.`
            : `Click ${optInChip} above to enable shared decks for this subject.`;
        cardsGrid.innerHTML = `<div class="empty-state" style="grid-column: 1 / -1;"><h3>No cards in bank</h3><p>${emptyStateHint}</p></div>`;
        if (window.hydrateIcons) window.hydrateIcons(cardsGrid);
        cardsGrid.classList.remove('short-view');
        cardsGrid.style.removeProperty('--type1-chinese-front-size-rem');
        renderCardsSelectionBar();
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
        renderCardsSelectionBar();
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
                    collapseCardId: cardId,
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
    renderCardsSelectionBar();
}

function resetAndDisplayCards(cards) {
    refreshSourceDeckFilterMenu();
    if (focusedCardId && !getFocusedCardLabel(cards)) {
        focusedCardId = '';
        const url = new URL(window.location.href);
        url.searchParams.delete('cardId');
        window.history.replaceState({}, '', url.toString());
    }
    syncCardFocusBanner();
    displayCards(cards);
    scrollFocusedCardIntoView();
}

function scrollFocusedCardIntoView() {
    if (!focusedCardId) return;
    requestAnimationFrame(() => {
        const el = cardsGrid && cardsGrid.querySelector('.card-item.is-focused-card');
        if (!el) return;
        try {
            el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        } catch (_err) {
            el.scrollIntoView();
        }
    });
}

// =====================================================================
// === 3. Bulk-input parsers + preview helpers
// =====================================================================
function updateAddReadingButtonCount() {
    if (!addReadingBtn || !chineseCharInput) {
        return;
    }
    const renderIcon = (name) => (typeof icon === 'function' ? icon(name, { size: 18 }) : '');
    if (isReadingBulkAdding) {
        addReadingBtn.textContent = 'Adding...';
        addReadingBtn.disabled = true;
        return;
    }
    if (typeof personalDeckMode !== 'undefined' && personalDeckMode === 'preview') {
        addReadingBtn.disabled = false;
        addReadingBtn.innerHTML = renderIcon('check') + ' Apply';
        return;
    }
    const csvMode = isType1ChineseEnglishBackMode();
    const type2Mode = isType2Behavior();
    let dedupStats;
    if (csvMode) {
        dedupStats = getType1EnglishBackBulkInputStats(chineseCharInput.value);
    } else if (type2Mode) {
        dedupStats = isChineseSpecificLogic
            ? getType2ChineseBulkInputStats(chineseCharInput.value)
            : getType2GenericBulkInputStats(chineseCharInput.value);
    } else {
        dedupStats = getType1ChineseBulkInputStats(chineseCharInput.value);
    }
    const hasInput = String(chineseCharInput.value || '').trim().length > 0;
    if (addCardStatusMessage && addCardStatusMessage.textContent === TYPE2_MIXED_FORMAT_ERROR) {
        showStatusMessage('');
    }
    const usePreviewFlow = supportsPersonalDeckEditor();
    const primaryLabel = usePreviewFlow ? 'Preview' : 'Bulk Add';
    const primaryIcon = usePreviewFlow ? renderIcon('eye') : renderIcon('plus');
    if (dedupStats.mixedFormat) {
        addReadingBtn.disabled = !hasInput;
        addReadingBtn.innerHTML = `${primaryIcon} ${primaryLabel}`;
        return;
    }
    addReadingBtn.disabled = csvMode ? !hasInput : dedupStats.uniqueCount <= 0;
    if (dedupStats.uniqueCount > 0) {
        const countText = dedupStats.dedupedCount > 0
            ? `${dedupStats.uniqueCount}, dedup ${dedupStats.dedupedCount}`
            : `${dedupStats.uniqueCount}`;
        addReadingBtn.innerHTML = `${primaryIcon} ${primaryLabel} (${countText})`;
        return;
    }
    addReadingBtn.innerHTML = `${primaryIcon} ${primaryLabel}`;
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
    const normalized = String(text || '').replace(/\uff0c/g, ',');
    const lines = normalized
        .split(/\r?\n/)
        .map((raw) => String(raw || '').trim())
        .filter((line) => line.length > 0);
    if (lines.length === 0) {
        return { totalCount: 0, uniqueCount: 0, dedupedCount: 0, uniqueValues: [], mixedFormat: false };
    }
    const hasCsv = lines.some((line) => line.includes(','));
    const hasBlob = lines.some((line) => !line.includes(','));
    if (hasCsv && hasBlob) {
        return { totalCount: 0, uniqueCount: 0, dedupedCount: 0, uniqueValues: [], mixedFormat: true };
    }
    if (hasCsv) {
        const fronts = [];
        lines.forEach((line) => {
            const idx = line.indexOf(',');
            const front = line.slice(0, idx).trim();
            let back = line.slice(idx + 1).trim();
            if (!back) back = front;
            if (!front || !back) return;
            fronts.push(front);
        });
        const uniqueValues = [...new Set(fronts)];
        return {
            totalCount: fronts.length,
            uniqueCount: uniqueValues.length,
            dedupedCount: Math.max(0, fronts.length - uniqueValues.length),
            uniqueValues,
            mixedFormat: false,
        };
    }
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
        mixedFormat: false,
    };
}

const TYPE2_MIXED_FORMAT_ERROR = 'Mixed formats — use either "word, prompt" on every line or a word blob with no commas, not both.';

function getType2BulkPreviewRows(text, isChinese) {
    const normalized = isChinese ? String(text || '').replace(/\uff0c/g, ',') : String(text || '');
    const lines = normalized
        .split(/\r?\n/)
        .map((raw) => String(raw || '').trim())
        .filter((line) => line.length > 0);
    if (lines.length === 0) {
        return { rows: [], mixedFormat: false, format: null };
    }
    const hasCsv = lines.some((line) => line.includes(','));
    const hasBlob = lines.some((line) => !line.includes(','));
    if (hasCsv && hasBlob) {
        return { rows: [], mixedFormat: true, format: null };
    }
    const rows = [];
    const seen = new Set();
    if (hasCsv) {
        lines.forEach((line) => {
            const idx = line.indexOf(',');
            const front = line.slice(0, idx).trim();
            let back = line.slice(idx + 1).trim();
            if (!back) back = front;
            if (!front) return;
            if (seen.has(front)) return;
            seen.add(front);
            rows.push({ front, back });
        });
        return { rows, mixedFormat: false, format: 'csv' };
    }
    if (isChinese) {
        const matches = String(text || '').match(/[\u3400-\u9FFF\uF900-\uFAFF]+/g) || [];
        matches.forEach((token) => {
            const t = String(token || '').trim();
            if (!t || seen.has(t)) return;
            seen.add(t);
            rows.push({ front: t, back: t });
        });
    } else {
        lines.forEach((line) => {
            line.split(/\s+/).forEach((tok) => {
                const t = String(tok || '').trim();
                if (!t || seen.has(t)) return;
                seen.add(t);
                rows.push({ front: t, back: t });
            });
        });
    }
    return { rows, mixedFormat: false, format: 'blob' };
}

function getType2GenericBulkInputStats(text) {
    const lines = String(text || '')
        .split(/\r?\n/)
        .map((raw) => String(raw || '').trim())
        .filter((line) => line.length > 0);
    if (lines.length === 0) {
        return { totalCount: 0, uniqueCount: 0, dedupedCount: 0, uniqueValues: [], mixedFormat: false };
    }
    const hasCsv = lines.some((line) => line.includes(','));
    const hasBlob = lines.some((line) => !line.includes(','));
    if (hasCsv && hasBlob) {
        return { totalCount: 0, uniqueCount: 0, dedupedCount: 0, uniqueValues: [], mixedFormat: true };
    }
    const fronts = [];
    lines.forEach((line) => {
        if (hasCsv) {
            const idx = line.indexOf(',');
            const front = line.slice(0, idx).trim();
            if (front) fronts.push(front);
        } else {
            line.split(/\s+/).forEach((tok) => {
                const trimmed = String(tok || '').trim();
                if (trimmed) fronts.push(trimmed);
            });
        }
    });
    const uniqueValues = [...new Set(fronts)];
    return {
        totalCount: fronts.length,
        uniqueCount: uniqueValues.length,
        dedupedCount: Math.max(0, fronts.length - uniqueValues.length),
        uniqueValues,
        mixedFormat: false,
    };
}

function getType1EnglishBackBulkInputStats(text) {
    const lines = String(text || '').replace(/\uff0c/g, ',').split(/\r?\n/);
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

// =====================================================================
// === 4. Shared-deck card mutations (skip, recording download)
// =====================================================================
async function loadSharedDeckCards() {
    const requestId = sharedDeckCardsResponseTracker
        ? sharedDeckCardsResponseTracker.begin()
        : 0;
    try {
        const url = new URL(buildSharedDeckApiUrl('shared-decks/cards'));
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
        currentPracticePrioritySubjectBaseline = data.practice_priority_subject_baseline
            || { p50_correct_time: null, p95_correct_time: null, correct_sample_count: 0 };
        updateSessionCardCountCapFromCardsPayload(data);
        const normalizedSessionCount = normalizeSessionCountInputValue();
        if (!hadQueueSettingChanges) {
            setQueueSettingsBaseline(normalizedSessionCount);
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
        currentCards = [];
        resetAndDisplayCards(currentCards);
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

async function applySelectedCardsSkip(targetSkipped) {
    if (isBulkSkipActionInFlight) {
        return;
    }
    const selectedCards = getSelectedCardObjects();
    const cardsToUpdate = selectedCards.filter((card) => Boolean(card.skip_practice) !== Boolean(targetSkipped));
    if (cardsToUpdate.length <= 0) {
        renderCardsSelectionBar();
        return;
    }
    isBulkSkipActionInFlight = true;
    renderCardsSelectionBar();
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
                `${targetSkipped ? 'Skipped' : 'Unskipped'} ${successCount} card(s); failed ${failedCount}.`,
                true
            );
        } else if (failedCount > 0) {
            showCardsBulkActionMessage(`Failed to update ${failedCount} card(s).`, true);
        } else if (successCount > 0) {
            showCardsBulkActionMessage(`${targetSkipped ? 'Skipped' : 'Unskipped'} ${successCount} card(s).`, false);
        }
    } catch (error) {
        console.error('Error applying bulk skip to selected cards:', error);
        showCardsBulkActionMessage(error.message || 'Failed to update selected cards.', true);
    } finally {
        isBulkSkipActionInFlight = false;
        renderCardsSelectionBar();
    }
}

async function downloadSelectedType3Recordings() {
    if (!isType3Behavior() || isBulkDownloadInFlight) {
        return;
    }
    const selectedCards = getSelectedCardObjects();
    const cardIds = selectedCards
        .map((card) => Number.parseInt(card && card.id, 10))
        .filter((id) => Number.isInteger(id) && id > 0);
    if (cardIds.length === 0) {
        showCardsBulkActionMessage('Select at least one card to download.', true);
        return;
    }
    isBulkDownloadInFlight = true;
    renderCardsSelectionBar();
    try {
        showError('');
        showSuccess('');
        showCardsBulkActionMessage('');
        const url = `${API_BASE}/kids/${encodeURIComponent(String(kidId))}/lesson-reading/recordings/download-zip`;
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ card_ids: cardIds }),
        });
        if (!response.ok) {
            let message = `Failed to download recordings (HTTP ${response.status}).`;
            try {
                const errorBody = await response.json();
                if (errorBody && errorBody.error) {
                    message = errorBody.error;
                }
            } catch (_e) {}
            throw new Error(message);
        }
        const blob = await response.blob();
        const disposition = response.headers.get('Content-Disposition') || '';
        let filename = 'recordings.zip';
        const match = disposition.match(/filename\*?=(?:UTF-8'')?"?([^";]+)"?/i);
        if (match && match[1]) {
            try {
                filename = decodeURIComponent(match[1]);
            } catch (_e) {
                filename = match[1];
            }
        }
        const objectUrl = URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = objectUrl;
        anchor.download = filename;
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
        setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
        showCardsBulkActionMessage(`Downloaded ${cardIds.length} card(s).`, false);
    } catch (error) {
        console.error('Error downloading selected recordings:', error);
        showCardsBulkActionMessage(error.message || 'Failed to download recordings.', true);
    } finally {
        isBulkDownloadInFlight = false;
        renderCardsSelectionBar();
    }
}

// =====================================================================
// === 5. Personal card CRUD (preview, add, edit, delete)
// =====================================================================
async function previewPersonalDeck() {
    if (!supportsPersonalDeckEditor()) {
        return;
    }
    const text = chineseCharInput ? chineseCharInput.value : '';

    if (isType2Behavior()) {
        const result = getType2BulkPreviewRows(text, isChineseSpecificLogic);
        if (result.mixedFormat) {
            showStatusMessage(TYPE2_MIXED_FORMAT_ERROR, true);
            return;
        }
        if (!result.rows.length) {
            showError(isChineseSpecificLogic
                ? 'Please enter at least one Chinese word/phrase'
                : 'Please enter at least one word');
            return;
        }
        showStatusMessage('');
        showError('');
        showSuccess('');
        renderPersonalDeckPreviewTable(result.rows, { frontLabel: 'Word', backLabel: 'Prompt' });
        setPersonalDeckMode('preview');
        return;
    }

    if (isType1ChineseEnglishBackMode()) {
        const stats = getType1EnglishBackBulkInputStats(text);
        if (stats.errors.length > 0) {
            const badLines = stats.errors.slice(0, 3).map((e) => `line ${e.lineNumber}`).join(', ');
            const more = stats.errors.length > 3 ? ` (+${stats.errors.length - 3} more)` : '';
            showStatusMessage(`Invalid format on ${badLines}${more}. ${TYPE1_ENGLISH_BACK_FORMAT_HINT}`, true);
            return;
        }
        if (stats.entries.length === 0) {
            showError('Please enter at least one Chinese word/phrase with its English meaning.');
            return;
        }
        showStatusMessage('');
        showError('');
        showSuccess('');
        renderPersonalDeckPreviewTable(stats.entries, { frontLabel: 'Chinese', backLabel: 'English' });
        setPersonalDeckMode('preview');
        return;
    }

    const chineseChars = getType1ChineseBulkInputStats(text).uniqueValues;
    if (chineseChars.length === 0) {
        showError('Please enter at least one Chinese character.');
        return;
    }
    showStatusMessage('');
    showError('');
    showSuccess('');
    try {
        setReadingBulkAddBusy(true);
        const backMap = await window.DeckCreateCommon.fetchChineseCharacterBackMap(
            API_BASE,
            chineseChars,
            'pinyin',
        );
        const rows = chineseChars.map((ch) => ({
            front: ch,
            back: String(backMap[ch] || '').trim(),
        }));
        renderPersonalDeckPreviewTable(rows, { frontLabel: 'Character', backLabel: 'Pinyin (auto)' });
        setPersonalDeckMode('preview');
    } catch (error) {
        console.error('Preview failed:', error);
        showError(error.message || 'Failed to generate pinyin preview.');
    } finally {
        setReadingBulkAddBusy(false);
    }
}

async function addOrphanCards() {
    if (isReadingBulkAdding) {
        return;
    }
    if (!supportsPersonalDeckEditor()) {
        return;
    }
    try {
        setReadingBulkAddBusy(true);
        showStatusMessage('');
        showError('');
        showSuccess('');

        const input = String(chineseCharInput ? chineseCharInput.value : '').trim();
        if (isType2Behavior()) {
            const tokenCount = isChineseSpecificLogic
                ? getType2ChineseBulkInputStats(input).uniqueCount
                : getType2GenericBulkInputStats(input).uniqueCount;
            if (tokenCount === 0) {
                showError(isChineseSpecificLogic
                    ? 'Please enter at least one Chinese word/phrase'
                    : 'Please enter at least one word');
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
            addCardForm.reset();
            setPersonalDeckMode('edit');
            updateAddReadingButtonCount();
            await loadSharedType1Decks();
            setManageModalOpen(personalDeckModal, false);
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

        addCardForm.reset();
        setPersonalDeckMode('edit');
        updateAddReadingButtonCount();
        await loadSharedType1Decks();
        setManageModalOpen(personalDeckModal, false);
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

        const currentBack = String(targetCard.back || '').trim();
        const nextBackRaw = window.prompt('Edit voice prompt:', currentBack);
        if (nextBackRaw === null) {
            return;
        }
        const nextBack = String(nextBackRaw || '').trim();
        if (!nextBack) {
            showError('Prompt text cannot be empty.');
            return;
        }
        if (nextBack === currentBack) {
            return;
        }

        const response = await fetch(buildType2ApiUrl(`cards/${encodeURIComponent(cardId)}`), {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                back: nextBack,
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

async function deleteSelectedPersonalCards() {
    if (isBulkDeleteActionInFlight) {
        return;
    }
    const selectedCards = getSelectedCardObjects();
    const deletable = selectedCards.filter(
        (card) => canDeleteExpandedCard(card) && !hasPracticedCardAttempts(card)
    );
    if (deletable.length === 0 || deletable.length !== selectedCards.length) {
        return;
    }
    const confirmed = window.confirm(
        `Delete ${deletable.length} card${deletable.length === 1 ? '' : 's'}? This cannot be undone.`
    );
    if (!confirmed) {
        return;
    }
    isBulkDeleteActionInFlight = true;
    renderCardsSelectionBar();
    let successCount = 0;
    let failedCount = 0;
    try {
        showError('');
        showSuccess('');
        showCardsBulkActionMessage('');
        for (const card of deletable) {
            const cardId = String(card && card.id ? card.id : '').trim();
            if (!cardId) {
                failedCount += 1;
                continue;
            }
            const requestUrl = isType2Behavior()
                ? buildType2ApiUrl(`cards/${encodeURIComponent(cardId)}`)
                : buildType1PersonalCardApiUrl(cardId);
            try {
                const response = await fetch(requestUrl, { method: 'DELETE' });
                if (response.ok) {
                    successCount += 1;
                    expandedCompactCardIds.delete(cardId);
                    selectedCardIds.delete(cardId);
                } else {
                    failedCount += 1;
                }
            } catch (_e) {
                failedCount += 1;
            }
        }
        await loadSharedType1Decks();
        if (failedCount > 0 && successCount > 0) {
            showCardsBulkActionMessage(
                `Deleted ${successCount} card(s); failed ${failedCount}.`,
                true
            );
        } else if (failedCount > 0) {
            showCardsBulkActionMessage(`Failed to delete ${failedCount} card(s).`, true);
        } else if (successCount > 0) {
            showCardsBulkActionMessage(`Deleted ${successCount} card(s).`, false);
        }
    } finally {
        isBulkDeleteActionInFlight = false;
        renderCardsSelectionBar();
    }
}

// =====================================================================
// === 6. Cards grid click handler
// =====================================================================
async function handleCardsGridClick(event) {
    const actionBtn = event.target.closest('[data-action]');
    if (!actionBtn) {
        return;
    }
    const action = actionBtn.dataset.action;

    if (action === 'toggle-select') {
        event.preventDefault();
        toggleCardSelection(actionBtn.dataset.cardId);
        return;
    }

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

    if (action === 'edit-back') {
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

// =====================================================================
// === 7. Kid info + decks loaders + queue settings save
// =====================================================================
function applyKidInfo(kid) {
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

    kidNameEl.textContent = 'Manage Cards';
    includeOrphanByCategory = toCategoryMap(kid[INCLUDE_ORPHAN_BY_CATEGORY_FIELD]);
    baselineIncludeOrphanInQueue = Boolean(includeOrphanByCategory[categoryKey]);
    stagedIncludeOrphanInQueue = baselineIncludeOrphanInQueue;
    const total = getSessionCountFromKid(kid);
    const safeTotal = Number.isInteger(total) ? clampSessionCardCount(total) : 0;
    if (sessionCardCountInput) {
        sessionCardCountInput.value = String(safeTotal);
    }
    syncType4CardOrderOptions();
    setQueueSettingsBaseline(safeTotal);
    applyDrillSpeedSettingsFromKid(kid);
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

    renderDeckPendingInfo();
    updateQueueMixLegend();
    if (!options.skipCards) {
        await loadSharedDeckCards();
    }
}

let sharedDecksLoadPromise = null;
let sharedDeckCardsLoadPromise = null;
let sharedDeckCardsHaveLoaded = false;

function ensureSharedDecksLoaded() {
    if (!sharedDecksLoadPromise) {
        sharedDecksLoadPromise = loadSharedType1Decks({ skipCards: true })
            .catch((error) => {
                sharedDecksLoadPromise = null;
                throw error;
            });
    }
    return sharedDecksLoadPromise;
}

function ensureSharedDeckCardsLoaded() {
    if (!sharedDeckCardsLoadPromise) {
        sharedDeckCardsLoadPromise = (async () => {
            await ensureSharedDecksLoaded();
            await loadSharedDeckCards();
            sharedDeckCardsHaveLoaded = true;
        })().catch((error) => {
            sharedDeckCardsLoadPromise = null;
            throw error;
        });
    }
    return sharedDeckCardsLoadPromise;
}

async function saveQueueSettings() {
    if (isType4Behavior()) {
        return;
    }
    showError('');

    const total = normalizeSessionCountInputValue();
    const maxSessionCount = getSessionCardCountCap();
    if (total < 0) {
        showError(`${getCurrentCategoryDisplayName()} cards/day must be 0 or more.`);
        return;
    }
    if (maxSessionCount !== null && total > maxSessionCount) {
        showError(`${getCurrentCategoryDisplayName()} cards/day must be between 0 and ${maxSessionCount}.`);
        return;
    }
    if (!hasQueueSettingsChanges()) {
        updateQueueSettingsSaveButtonState();
        return;
    }
    const sessionCountChanged = total !== baselineSessionCardCount;
    const drillSpeedChanged = hasDrillSpeedSettingsChanges();
    const desiredDrillSpeedMs = drillSpeedChanged ? getDrillSpeedTargetInputMs() : null;
    const payload = {};
    if (sessionCountChanged) {
        Object.assign(payload, buildSessionCountPayload(total));
    }
    if (drillSpeedChanged) {
        Object.assign(payload, buildDrillSpeedCutoffMsPayload(desiredDrillSpeedMs));
    }
    cancelQueuePreviewReload();
    isQueueSettingsSaving = true;
    updateQueueSettingsSaveButtonState();
    const response = await fetch(`${API_BASE}/kids/${kidId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
    });
    try {
        const result = await response.json().catch(() => ({}));
        if (!response.ok) {
            throw new Error(result.error || `Failed to save settings (HTTP ${response.status})`);
        }
        if (sessionCountChanged) {
            applySessionCountFromPayload(result);
            const persistedTotal = getCategoryIntValue(sessionCardCountByCategory);
            sessionCardCountInput.value = String(clampSessionCardCount(persistedTotal));
            setQueueSettingsBaseline(sessionCardCountInput.value);
        }
        if (drillSpeedChanged) {
            applyDrillSpeedCutoffMsFromPayload(result);
            baselineDrillSpeedCutoffMs = clampDrillSpeedCutoffMs(
                getCategoryIntValue(drillSpeedCutoffMsByCategory) || DEFAULT_DRILL_SPEED_CUTOFF_MS
            );
            setDrillSpeedTargetInputMs(baselineDrillSpeedCutoffMs);
        }
        updateQueueMixLegend();
        if (sessionCountChanged) {
            await loadSharedDeckCards();
        }
    } finally {
        isQueueSettingsSaving = false;
        updateQueueSettingsSaveButtonState();
    }
}
