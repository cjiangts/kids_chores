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

    function currentWeekDayKeys(timezone) {
        const todayKey = dateKeyInTimezone(new Date(), timezone);
        const today = dateFromDayKey(todayKey);
        if (!today) return [];
        const mondayOffset = (today.getUTCDay() + 6) % 7;
        const mondayKey = addDaysToDayKey(todayKey, -mondayOffset);
        return Array.from({ length: 7 }, (_, index) => addDaysToDayKey(mondayKey, index));
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

    function historyIconHtml(rule, delta) {
        const triggerKey = String(rule?.triggerKey || '').trim();
        if (rule?.ruleKind === 'in_app_chore' && triggerKey && typeof window.subjectIcon === 'function') {
            return window.subjectIcon(triggerKey, { size: 30 });
        }
        return `<span class="point-rule-emoji">${escapeHtml(rule?.emoji || (delta < 0 ? '-' : '+'))}</span>`;
    }

    function renderWeekStrip(events, selectedDayKey, timezone) {
        const totalsByDay = new Map();
        events.forEach((event) => {
            const dayKey = dateKeyInTimezone(parseHistoryDate(event.createdAt), timezone);
            if (!dayKey) return;
            const delta = Number.parseInt(event.pointsDelta, 10) || 0;
            totalsByDay.set(dayKey, (totalsByDay.get(dayKey) || 0) + delta);
        });
        return `
            <div class="point-week-strip" role="tablist" aria-label="This week's point history">
                <div class="point-week-label">This week</div>
                ${currentWeekDayKeys(timezone).map((dayKey) => {
            const day = dateFromDayKey(dayKey);
            const hasEvents = totalsByDay.has(dayKey);
            const total = totalsByDay.get(dayKey) || 0;
            const isActive = dayKey === selectedDayKey;
            const valueClass = total < 0 ? 'negative' : (total > 0 ? 'positive' : 'empty');
            const value = total === 0 ? '-' : formatDelta(total);
            return `
                <button
                    type="button"
                    class="point-week-day${isActive ? ' active' : ''}"
                    role="tab"
                    aria-selected="${isActive ? 'true' : 'false'}"
                    data-history-day="${escapeHtml(dayKey)}"
                    ${hasEvents ? '' : 'disabled'}
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

    function render(container, options) {
        if (!container) return '';
        const opts = options || {};
        const selectedKidId = String(opts.selectedKidId || '').trim();
        const events = Array.isArray(opts.events) ? opts.events : [];
        const timezone = String(opts.familyTimezone || '').trim();
        if (!timezone) {
            container.innerHTML = `<div class="point-empty">${escapeHtml(opts.emptyTimezone || 'Family timezone is not configured.')}</div>`;
            return '';
        }
        const selectedDayKey = String(opts.selectedDayKey || dateKeyInTimezone(new Date(), timezone));
        const showDelete = opts.showDelete !== false;
        if (!selectedKidId) {
            container.innerHTML = `<div class="point-empty">${escapeHtml(opts.emptyNoKid || 'Select a kid to see point history.')}</div>`;
            return selectedDayKey;
        }
        const selectedEvents = events.filter((event) => dateKeyInTimezone(parseHistoryDate(event.createdAt), timezone) === selectedDayKey);
        const selectedListHtml = selectedEvents.length
            ? `
            <section class="point-history-group">
                <h3>${escapeHtml(historyDayHeading(selectedDayKey, timezone))}</h3>
                <div class="point-history-group-list">
                    ${selectedEvents.map((event) => {
                const rule = event.rule || {};
                const delta = Number.parseInt(event.pointsDelta, 10) || 0;
                const deltaClass = rule?.ruleKind === 'redeemed_reward'
                    ? 'redeemed'
                    : (delta >= 0 ? 'positive' : 'negative');
                const note = String(event.note || '').trim();
                const timeLabel = formatHistoryTime(event.createdAt, timezone);
                return `
                <div class="point-history-row${showDelete ? '' : ' no-delete'}" data-event-id="${escapeHtml(event.eventId)}">
                    <span class="point-history-time">${escapeHtml(timeLabel)}</span>
                    <span class="point-history-node" aria-hidden="true"></span>
                    <div class="point-history-icon">${historyIconHtml(rule, delta)}</div>
                    <div class="point-history-main">
                        <div class="point-history-title">${escapeHtml(rule.name || 'Point event')}</div>
                        ${note ? `
                        <div class="point-history-note">
                            ${escapeHtml(note)}
                        </div>
                        ` : ''}
                    </div>
                    <div class="point-rule-delta ${deltaClass}">${escapeHtml(formatDelta(delta))} pts</div>
                    ${showDelete ? `
                    <button type="button" class="semantic-outline-btn semantic-outline-btn--red point-history-delete" data-history-action="delete" aria-label="Delete point event">
                        ${icon('trash', { size: 16 })}
                    </button>
                    ` : ''}
                </div>
            `;
            }).join('')}
                </div>
            </section>
        `
            : `
            <section class="point-history-group">
                <h3>${escapeHtml(historyDayHeading(selectedDayKey, timezone))}</h3>
                <div class="point-empty">${escapeHtml(opts.emptyDay || 'No point events for this day.')}</div>
            </section>
        `;
        container.innerHTML = `${renderWeekStrip(events, selectedDayKey, timezone)}${selectedListHtml}`;
        if (typeof window.hydrateIcons === 'function') {
            window.hydrateIcons(container);
        }
        return selectedDayKey;
    }

    window.PointHistoryCommon = {
        dateKeyInTimezone,
        localDayKey,
        render,
    };
})();
