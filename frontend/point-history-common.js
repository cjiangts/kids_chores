(function () {
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

    function isRedeemedRewardKind(kind) {
        return String(kind || '') === 'redeemed_reward';
    }

    function dateKeyInTimezone(date, timezone) {
        if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '';
        const tz = String(timezone || '').trim();
        if (!tz) return '';
        try {
            const formatter = new Intl.DateTimeFormat('en-CA', {
                timeZone: tz,
                year: 'numeric',
                month: '2-digit',
                day: '2-digit',
            });
            const parts = formatter.formatToParts(date);
            const year = parts.find((part) => part.type === 'year')?.value;
            const month = parts.find((part) => part.type === 'month')?.value;
            const day = parts.find((part) => part.type === 'day')?.value;
            return year && month && day ? `${year}-${month}-${day}` : '';
        } catch (error) {
            console.error('Invalid family timezone for point history:', error);
            return '';
        }
    }

    function localDayKey(date, timezone) {
        return dateKeyInTimezone(date, timezone);
    }

    function dateFromDayKey(dayKey) {
        const parts = String(dayKey || '').split('-').map((part) => Number.parseInt(part, 10));
        if (parts.length !== 3 || parts.some((part) => !Number.isInteger(part))) return null;
        return new Date(Date.UTC(parts[0], parts[1] - 1, parts[2], 12, 0, 0));
    }

    function addDaysToDayKey(dayKey, days) {
        const date = dateFromDayKey(dayKey);
        if (!date) return '';
        date.setUTCDate(date.getUTCDate() + days);
        const year = date.getUTCFullYear();
        const month = String(date.getUTCMonth() + 1).padStart(2, '0');
        const day = String(date.getUTCDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    }

    function parseHistoryDate(value) {
        if (value instanceof Date) return value;
        const text = String(value || '').trim();
        if (!text) return new Date(Number.NaN);
        const hasTimezone = /(?:z|[+-]\d{2}:?\d{2})$/i.test(text);
        return new Date(hasTimezone ? text : `${text}Z`);
    }

    function weekStartKey(dayKey) {
        const day = dateFromDayKey(dayKey);
        if (!day) return '';
        const mondayOffset = (day.getUTCDay() + 6) % 7;
        return addDaysToDayKey(dayKey, -mondayOffset);
    }

    function weekDayKeysForSelectedDay(selectedDayKey) {
        const mondayKey = weekStartKey(selectedDayKey);
        if (!mondayKey) return [];
        return Array.from({ length: 7 }, (_, index) => addDaysToDayKey(mondayKey, index));
    }

    function weekLabel(selectedDayKey, timezone) {
        const selectedStart = weekStartKey(selectedDayKey);
        const currentStart = weekStartKey(dateKeyInTimezone(new Date(), timezone));
        const diffWeeks = Math.round(daysBetweenDayKeys(selectedStart, currentStart) / 7);
        if (diffWeeks === 0) return 'This week';
        if (diffWeeks === 1) return 'Last week';
        if (diffWeeks > 1) return `-${diffWeeks} weeks`;
        return `+${Math.abs(diffWeeks)} weeks`;
    }

    function historyDayHeading(dayKey, timezone) {
        const date = dateFromDayKey(dayKey);
        if (!date) return 'Selected day';
        const todayKey = dateKeyInTimezone(new Date(), timezone);
        const diffDays = daysBetweenDayKeys(dayKey, todayKey);
        if (diffDays === 0) return 'Today';
        if (diffDays === 1) return 'Yesterday (1 day ago)';
        return `${date.toLocaleDateString([], { timeZone: 'UTC', weekday: 'long', month: 'short', day: 'numeric' })} (${diffDays} days ago)`;
    }

    function compactDayLabel(dayKey, timezone) {
        const date = dateFromDayKey(dayKey);
        if (!date) return '';
        const todayKey = dateKeyInTimezone(new Date(), timezone);
        const diffDays = daysBetweenDayKeys(dayKey, todayKey);
        if (diffDays === 0) return 'Today';
        if (diffDays === 1) return 'Yesterday';
        return date.toLocaleDateString([], {
            timeZone: 'UTC',
            weekday: 'short',
            month: 'short',
            day: 'numeric',
        });
    }

    function daysBetweenDayKeys(fromKey, toKey) {
        const from = dateFromDayKey(fromKey);
        const to = dateFromDayKey(toKey);
        if (!from || !to) return 0;
        return Math.round((to.getTime() - from.getTime()) / 86400000);
    }

    function formatHistoryTime(value, timezone) {
        const date = parseHistoryDate(value);
        if (Number.isNaN(date.getTime())) return '';
        return date.toLocaleTimeString([], {
            timeZone: String(timezone || '').trim(),
            hour: 'numeric',
            minute: '2-digit',
        });
    }

    function shiftIsoHours(value, hours) {
        const date = parseHistoryDate(value);
        if (Number.isNaN(date.getTime())) return '';
        date.setTime(date.getTime() + (Number.parseInt(hours, 10) || 0) * 3600000);
        return date.toISOString();
    }

    function updateDayLabel(container, label) {
        const host = container?.closest?.('.point-history-section')?.querySelector?.('[data-point-history-day-label]');
        if (!host) return;
        if (!host.dataset.pointHistoryClearBound) {
            host.dataset.pointHistoryClearBound = '1';
            host.addEventListener('click', (event) => {
                const button = event.target.closest('[data-history-clear-filter]');
                if (!button) return;
                event.preventDefault();
                container.dispatchEvent(new CustomEvent('point-history-clear-filter', { bubbles: true }));
            });
        }
        host.innerHTML = label
            ? `<button type="button" class="point-history-filter-chip" data-history-clear-filter aria-label="Clear date filter">${escapeHtml(label)}<span class="point-history-filter-chip-x" aria-hidden="true">×</span></button>`
            : '';
        host.classList.toggle('hidden', !label);
    }

    function bindWeekNavigation(container) {
        if (!container || container.dataset.pointHistoryWeekNavBound) return;
        container.dataset.pointHistoryWeekNavBound = '1';
        container.addEventListener('click', (event) => {
            const button = event.target.closest('[data-history-week-anchor]');
            if (!button) return;
            const anchorDayKey = String(button.dataset.historyWeekAnchor || '').trim();
            if (!anchorDayKey) return;
            event.preventDefault();
            event.stopPropagation();
            container.dataset.pointHistoryWeekAnchorDayKey = anchorDayKey;
            render(container, {
                ...(container.__pointHistoryLastOptions || {}),
                weekAnchorDayKey: anchorDayKey,
            });
        });
    }

    function historyIconHtml(rule, delta) {
        const triggerKey = String(rule?.triggerKey || '').trim();
        if (rule?.ruleKind === 'in_app_chore' && triggerKey && typeof window.subjectIcon === 'function') {
            return window.subjectIcon(triggerKey, { size: 30 });
        }
        if (isRedeemedRewardKind(rule?.ruleKind) && !rule?.emoji) {
            return `<span class="point-rule-emoji">${icon('gift', { size: 18 })}</span>`;
        }
        return `<span class="point-rule-emoji">${escapeHtml(rule?.emoji || (delta < 0 ? '-' : '+'))}</span>`;
    }

    function shouldIncludeEvent(event, mode) {
        if (mode === 'all') return true;
        const isRedeemed = isRedeemedRewardKind(event?.rule?.ruleKind);
        if (mode === 'redeemed') return isRedeemed;
        return !isRedeemed;
    }

    function renderWeekStrip(events, anchorDayKey, activeDayKey, timezone, mode) {
        const totalsByDay = new Map();
        events.forEach((event) => {
            const dayKey = dateKeyInTimezone(parseHistoryDate(event.createdAt), timezone);
            if (!dayKey) return;
            if (!shouldIncludeEvent(event, mode)) return;
            const delta = Number.parseInt(event.pointsDelta, 10) || 0;
            totalsByDay.set(dayKey, (totalsByDay.get(dayKey) || 0) + delta);
        });
        const selectedWeekStart = weekStartKey(anchorDayKey);
        const currentWeekStart = weekStartKey(dateKeyInTimezone(new Date(), timezone));
        const canGoNext = selectedWeekStart && currentWeekStart
            ? daysBetweenDayKeys(selectedWeekStart, currentWeekStart) > 0
            : false;
        const previousWeekDayKey = addDaysToDayKey(anchorDayKey, -7);
        const nextWeekDayKey = addDaysToDayKey(anchorDayKey, 7);
        const labelText = weekLabel(anchorDayKey, timezone);
        return `
            <div class="point-week-strip" role="tablist" aria-label="${escapeHtml(labelText)} point history">
                <div class="point-week-label">
                    <span class="point-week-label-text">${escapeHtml(labelText)}</span>
                    <span class="point-week-nav" aria-label="Week navigation">
                        <button type="button" class="paradigm-pager-btn" data-history-week-anchor="${escapeHtml(previousWeekDayKey)}" aria-label="Previous week" title="Previous week">${icon('chevron-left', { size: 14, strokeWidth: 2.9 })}</button>
                        <button type="button" class="paradigm-pager-btn" data-history-week-anchor="${escapeHtml(nextWeekDayKey)}" aria-label="Next week" title="Next week" ${canGoNext ? '' : 'disabled'}>${icon('chevron-right', { size: 14, strokeWidth: 2.9 })}</button>
                    </span>
                </div>
                ${weekDayKeysForSelectedDay(anchorDayKey).map((dayKey) => {
            const day = dateFromDayKey(dayKey);
            const hasEvents = totalsByDay.has(dayKey);
            const total = totalsByDay.get(dayKey) || 0;
            const isActive = Boolean(activeDayKey) && dayKey === activeDayKey;
            const valueClass = mode === 'redeemed' && hasEvents ? 'redeemed' : (total < 0 ? 'negative' : (total > 0 ? 'positive' : (hasEvents ? 'neutral' : 'empty')));
            const value = !hasEvents ? '-' : (total === 0 ? '0' : formatDelta(total));
            return `
                <button
                    type="button"
                    class="point-week-day${isActive ? ' active' : ''}"
                    role="tab"
                    aria-selected="${isActive ? 'true' : 'false'}"
                    data-history-day="${escapeHtml(dayKey)}"
                    ${hasEvents || isActive ? '' : 'disabled'}
                >
                    <span class="point-week-day-name">${escapeHtml(day ? day.toLocaleDateString([], { timeZone: 'UTC', weekday: 'short' }) : '')}</span>
                    <span class="point-week-day-total ${valueClass}">${escapeHtml(value)}</span>
                    <span class="point-week-day-mark ${valueClass}" aria-hidden="true"></span>
                </button>
            `;
        }).join('')}
            </div>
        `;
    }

    function sortEventsNewestFirst(events) {
        return [...events].sort((a, b) => {
            const bTime = parseHistoryDate(b?.createdAt).getTime();
            const aTime = parseHistoryDate(a?.createdAt).getTime();
            const safeB = Number.isFinite(bTime) ? bTime : 0;
            const safeA = Number.isFinite(aTime) ? aTime : 0;
            if (safeB !== safeA) return safeB - safeA;
            return (Number.parseInt(b?.eventId, 10) || 0) - (Number.parseInt(a?.eventId, 10) || 0);
        });
    }

    function eventRowHtml(event, opts, timezone, showDelete, extraClass = '') {
        const rule = event.rule || {};
        const delta = Number.parseInt(event.pointsDelta, 10) || 0;
        const balanceAfter = Number.parseInt(event.balanceAfter, 10);
        const showBalance = opts.showBalance && Number.isFinite(balanceAfter);
        const deltaClass = isRedeemedRewardKind(rule?.ruleKind)
            ? 'redeemed'
            : (delta >= 0 ? 'positive' : 'negative');
        const note = String(event.note || '').trim();
        const timeLabel = formatHistoryTime(event.createdAt, timezone);
        const isEditingTime = showDelete && Number.parseInt(opts.timeEditEventId, 10) === Number.parseInt(event.eventId, 10);
        const className = `point-history-row activity-timeline-row${showDelete ? '' : ' no-delete'}${showBalance ? ' has-balance' : ''}${isEditingTime ? ' paradigm-editing-row' : ''}${extraClass ? ` ${extraClass}` : ''}`;
        return `
                <div class="${escapeHtml(className)}" data-event-id="${escapeHtml(event.eventId)}" data-points-delta="${escapeHtml(delta)}" data-created-at="${escapeHtml(event.createdAt)}" data-note="${escapeHtml(note)}">
                    ${showDelete
                ? `<button type="button" class="point-history-time activity-timeline-time point-history-time-btn" data-history-action="edit-time" aria-label="${escapeHtml(`Adjust event time from ${timeLabel}`)}">${escapeHtml(timeLabel)}</button>`
                : `<span class="point-history-time activity-timeline-time">${escapeHtml(timeLabel)}</span>`}
                    <span class="point-history-node activity-timeline-node" aria-hidden="true"></span>
                    <div class="point-history-icon activity-timeline-icon">${historyIconHtml(rule, delta)}</div>
                    <div class="point-history-main activity-timeline-main">
                        <div class="point-history-title activity-timeline-title">${escapeHtml(rule.name || 'Point event')}</div>
                        ${note ? `
                        <div class="point-history-note activity-timeline-note">
                            ${escapeHtml(note)}
                        </div>
                        ` : ''}
                    </div>
                    <div class="point-rule-delta paradigm-pill ${deltaClass}">${escapeHtml(formatDelta(delta))} pts</div>
                    ${showBalance ? `<div class="point-rule-delta paradigm-pill balance" aria-label="${escapeHtml(`Balance after event: ${balanceAfter} points`)}">${escapeHtml(`${balanceAfter} pts`)}</div>` : ''}
                    ${showDelete && !isEditingTime ? `
                    <button type="button" class="paradigm-icon-btn paradigm-icon-action-btn point-history-edit" data-history-action="edit-note" aria-label="${escapeHtml(opts.editAriaLabel || 'Edit note')}">
                        ${icon('pencil', { size: 15 })}
                    </button>
                    <button type="button" class="paradigm-icon-btn is-danger paradigm-icon-action-btn point-history-delete" data-history-action="delete" aria-label="${escapeHtml(opts.deleteAriaLabel || 'Delete point event')}">
                        ${icon('trash', { size: 16 })}
                    </button>
                    ` : ''}
                    ${isEditingTime ? `
                    <div class="point-history-time-editor">
                        <button type="button" class="paradigm-decision-btn" data-history-time-step="-1" aria-label="Move event one hour earlier">${icon('minus')}</button>
                        <span class="activity-timeline-time">${escapeHtml(timeLabel)}</span>
                        <button type="button" class="paradigm-decision-btn" data-history-time-step="1" aria-label="Move event one hour later">${icon('plus')}</button>
                        <button type="button" class="paradigm-decision-btn paradigm-decision-btn--confirm" data-history-time-save aria-label="Save time">${icon('check', { size: 16, strokeWidth: 2.7 })}</button>
                        <button type="button" class="paradigm-decision-btn paradigm-decision-btn--cancel" data-history-time-cancel aria-label="Cancel time edit">${icon('x', { size: 16, strokeWidth: 2.6 })}</button>
                    </div>
                    ` : ''}
                </div>
            `;
    }

    function keepDraftRowInView(container, beforeTop, focusSelector = '') {
        const eventId = Number.parseInt(container?.__pointHistoryTimeDraft?.eventId, 10);
        if (!(eventId > 0) || !Number.isFinite(beforeTop)) return;
        const row = container.querySelector(`[data-event-id="${eventId}"]`);
        if (!row) return;
        const delta = row.getBoundingClientRect().top - beforeTop;
        if (Math.abs(delta) > 1) {
            window.scrollBy(0, delta);
        }
        if (focusSelector) {
            row.querySelector(focusSelector)?.focus?.({ preventScroll: true });
        }
    }

    function openNoteEditor(row) {
        if (!row || row.dataset.noteEditing === '1') return;
        const main = row.querySelector('.point-history-main');
        if (!main) return;
        row.dataset.noteEditing = '1';
        row.classList.add('is-editing-note', 'paradigm-editing-row');
        const noteEl = main.querySelector('.point-history-note');
        const currentNote = noteEl ? noteEl.textContent.trim() : '';
        const editor = document.createElement('div');
        editor.className = 'point-history-note-editor';
        editor.dataset.pointHistoryNoteEditor = '1';
        editor.innerHTML = `
            <input type="text" class="paradigm-input point-history-note-input" maxlength="200" placeholder="Add a note (optional)" autocomplete="off">
            <button type="button" class="paradigm-decision-btn paradigm-decision-btn--confirm point-history-note-save" data-history-note-save aria-label="Save note">${icon('check', { size: 16, strokeWidth: 2.7 })}</button>
            <button type="button" class="paradigm-decision-btn paradigm-decision-btn--cancel point-history-note-cancel" data-history-note-cancel aria-label="Cancel">${icon('x', { size: 16, strokeWidth: 2.6 })}</button>
        `;
        row.appendChild(editor);
        const input = editor.querySelector('.point-history-note-input');
        if (input) {
            input.value = currentNote;
            input.focus();
            input.setSelectionRange(currentNote.length, currentNote.length);
        }
    }

    function closeNoteEditor(row) {
        if (!row) return;
        row.dataset.noteEditing = '';
        row.classList.remove('is-editing-note', 'paradigm-editing-row');
        row.querySelector('[data-point-history-note-editor]')?.remove();
    }

    function commitNoteEditor(container, row) {
        if (!container || !row) return;
        const eventId = Number.parseInt(row.dataset.eventId || '', 10);
        const pointsDelta = Number.parseInt(row.dataset.pointsDelta || '', 10);
        const input = row.querySelector('.point-history-note-input');
        if (!(eventId > 0) || !input) return;
        container.dispatchEvent(new CustomEvent('point-history-edit-note', {
            bubbles: true,
            detail: { eventId, pointsDelta, note: input.value.trim() },
        }));
    }

    function bindEditing(container) {
        if (!container || container.dataset.pointHistoryEditBound) return;
        container.dataset.pointHistoryEditBound = '1';
        container.addEventListener('click', (event) => {
            const target = event.target;
            const editBtn = target.closest('[data-history-action="edit-note"]');
            if (editBtn) {
                event.preventDefault();
                container.__pointHistoryTimeDraft = null;
                openNoteEditor(editBtn.closest('[data-event-id]'));
                return;
            }
            const noteSaveBtn = target.closest('[data-history-note-save]');
            if (noteSaveBtn) {
                event.preventDefault();
                commitNoteEditor(container, noteSaveBtn.closest('[data-event-id]'));
                return;
            }
            const noteCancelBtn = target.closest('[data-history-note-cancel]');
            if (noteCancelBtn) {
                event.preventDefault();
                closeNoteEditor(noteCancelBtn.closest('[data-event-id]'));
                return;
            }
            const timeBtn = target.closest('[data-history-action="edit-time"]');
            if (timeBtn) {
                event.preventDefault();
                const row = timeBtn.closest('[data-event-id]');
                closeNoteEditor(row);
                container.__pointHistoryTimeDraft = {
                    eventId: Number.parseInt(row?.dataset.eventId || '', 10),
                    createdAt: row?.dataset.createdAt || '',
                };
                render(container, container.__pointHistoryLastOptions || {});
                return;
            }
            const stepBtn = event.target.closest('[data-history-time-step]');
            if (stepBtn) {
                event.preventDefault();
                const draft = container.__pointHistoryTimeDraft;
                if (!draft?.eventId) return;
                const beforeTop = stepBtn.closest('[data-event-id]')?.getBoundingClientRect().top;
                const step = stepBtn.dataset.historyTimeStep;
                draft.createdAt = shiftIsoHours(draft.createdAt, step);
                render(container, container.__pointHistoryLastOptions || {});
                keepDraftRowInView(container, beforeTop, `[data-history-time-step="${step}"]`);
                return;
            }
            const timeSaveBtn = target.closest('[data-history-time-save]');
            if (timeSaveBtn) {
                event.preventDefault();
                const row = timeSaveBtn.closest('[data-event-id]');
                const draft = container.__pointHistoryTimeDraft;
                if (!draft?.eventId) return;
                container.dispatchEvent(new CustomEvent('point-history-edit-note', {
                    bubbles: true,
                    detail: {
                        eventId: draft.eventId,
                        createdAt: draft.createdAt,
                        pointsDelta: Number.parseInt(row?.dataset.pointsDelta || '', 10),
                        note: row?.dataset.note || '',
                    },
                }));
                return;
            }
            const timeCancelBtn = target.closest('[data-history-time-cancel]');
            if (timeCancelBtn) {
                event.preventDefault();
                container.__pointHistoryTimeDraft = null;
                render(container, container.__pointHistoryLastOptions || {});
            }
        });
        container.addEventListener('keydown', (event) => {
            const input = event.target.closest?.('.point-history-note-input');
            if (!input) return;
            if (event.key === 'Enter') {
                event.preventDefault();
                commitNoteEditor(container, input.closest('[data-event-id]'));
            } else if (event.key === 'Escape') {
                event.preventDefault();
                closeNoteEditor(input.closest('[data-event-id]'));
            }
        });
    }

    function renderEventList(events, opts, timezone, showDelete, showDayBoundaries) {
        let previousDayKey = '';
        return events.map((event, index) => {
            const dayKey = dateKeyInTimezone(parseHistoryDate(event.createdAt), timezone);
            const nextDayKey = dateKeyInTimezone(parseHistoryDate(events[index + 1]?.createdAt), timezone);
            const extraClass = showDayBoundaries && dayKey && dayKey !== nextDayKey ? 'is-day-last' : '';
            const boundary = showDayBoundaries && dayKey && dayKey !== previousDayKey
                ? `<div class="point-history-day-boundary activity-timeline-day-boundary"><span class="point-history-day-boundary-label activity-timeline-day-boundary-label">${escapeHtml(compactDayLabel(dayKey, timezone))}</span></div>`
                : '';
            if (dayKey) previousDayKey = dayKey;
            return `${boundary}${eventRowHtml(event, opts, timezone, showDelete, extraClass)}`;
        }).join('');
    }

    function isEventInWeek(event, weekAnchorDayKey, timezone) {
        const eventDayKey = dateKeyInTimezone(parseHistoryDate(event?.createdAt), timezone);
        const weekStart = weekStartKey(weekAnchorDayKey);
        if (!eventDayKey || !weekStart) return false;
        const diff = daysBetweenDayKeys(weekStart, eventDayKey);
        return diff >= 0 && diff < 7;
    }

    function render(container, options) {
        if (!container) return '';
        const opts = options || {};
        bindWeekNavigation(container);
        bindEditing(container);
        container.__pointHistoryLastOptions = opts;
        const selectedKidId = String(opts.selectedKidId || '').trim();
        const timeDraft = container.__pointHistoryTimeDraft || null;
        const sourceEvents = Array.isArray(opts.events) ? opts.events : [];
        const events = timeDraft?.eventId
            ? sourceEvents.map((event) => (Number.parseInt(event?.eventId, 10) === timeDraft.eventId
                ? { ...event, createdAt: timeDraft.createdAt }
                : event))
            : sourceEvents;
        const timezone = String(opts.familyTimezone || '').trim();
        if (!timezone) {
            updateDayLabel(container, '');
            container.innerHTML = `<div class="point-empty">${escapeHtml(opts.emptyTimezone || 'Family timezone is not configured.')}</div>`;
            return '';
        }
        const activeDayKey = String(opts.selectedDayKey || '').trim();
        const requestedAnchorDayKey = String(opts.weekAnchorDayKey || container.dataset.pointHistoryWeekAnchorDayKey || '').trim();
        const anchorDayKey = requestedAnchorDayKey || activeDayKey || dateKeyInTimezone(new Date(), timezone);
        if (anchorDayKey) {
            container.dataset.pointHistoryWeekAnchorDayKey = anchorDayKey;
        }
        updateDayLabel(container, activeDayKey ? compactDayLabel(activeDayKey, timezone) : '');
        const showDelete = opts.showDelete !== false;
        const mode = opts.mode === 'redeemed' ? 'redeemed' : (opts.mode === 'all' ? 'all' : 'points');
        if (!selectedKidId) {
            container.innerHTML = `<div class="point-empty">${escapeHtml(opts.emptyNoKid || 'Select a kid to see point history.')}</div>`;
            return activeDayKey;
        }
        const scopedEvents = sortEventsNewestFirst(events.filter((event) => shouldIncludeEvent(event, mode)));
        const selectedEvents = activeDayKey
            ? scopedEvents.filter((event) => dateKeyInTimezone(parseHistoryDate(event.createdAt), timezone) === activeDayKey)
            : scopedEvents.filter((event) => isEventInWeek(event, anchorDayKey, timezone));
        const rowOpts = timeDraft?.eventId ? { ...opts, timeEditEventId: timeDraft.eventId } : opts;
        const selectedListHtml = selectedEvents.length
            ? `
            <section class="point-history-group activity-timeline-group">
                <div class="point-history-group-list activity-timeline-list">
                    ${renderEventList(selectedEvents, rowOpts, timezone, showDelete, true)}
                </div>
            </section>
        `
            : `
            <section class="point-history-group activity-timeline-group">
                <div class="point-empty">${escapeHtml(activeDayKey ? (opts.emptyDay || 'No point events for this day.') : (opts.emptyWeek || opts.emptyRecent || 'No point activity for this week.'))}</div>
            </section>
        `;
        container.innerHTML = `${renderWeekStrip(scopedEvents, anchorDayKey, activeDayKey, timezone, mode)}${selectedListHtml}`;
        if (typeof window.hydrateIcons === 'function') {
            window.hydrateIcons(container);
        }
        return activeDayKey;
    }

    window.PointHistoryCommon = {
        dateKeyInTimezone,
        localDayKey,
        render,
    };
})();
