(function () {
    'use strict';

    const { normalizeCategoryKey } = window.DeckCategoryCommon;

    const CATEGORY_COLOR_PALETTE = [
        { bar: '#3b82f6', pillBg: '#e8f1ff', pillText: '#1e4f9f' },
        { bar: '#f59e0b', pillBg: '#fff4de', pillText: '#9a5b00' },
        { bar: '#10b981', pillBg: '#e6faf3', pillText: '#0d6b57' },
        { bar: '#8b5cf6', pillBg: '#efe8ff', pillText: '#5a3aa6' },
        { bar: '#ef4444', pillBg: '#fdecec', pillText: '#a33131' },
        { bar: '#06b6d4', pillBg: '#e7fafd', pillText: '#0a6c83' },
        { bar: '#84cc16', pillBg: '#f1fadf', pillText: '#4e7d08' },
        { bar: '#ec4899', pillBg: '#fdeaf3', pillText: '#9c2d63' },
        { bar: '#6366f1', pillBg: '#ececff', pillText: '#4043a3' },
        { bar: '#f97316', pillBg: '#fff0e5', pillText: '#a34a0d' },
        { bar: '#14b8a6', pillBg: '#e5fbf8', pillText: '#0b6b62' },
        { bar: '#a855f7', pillBg: '#f4eaff', pillText: '#6f33aa' },
    ];
    const DEFAULT_CATEGORY_COLOR_THEME = CATEGORY_COLOR_PALETTE[0];
    const DAILY_CHART_PAGE_SIZE = 7;
    const MINUTES_FILTER_COLOR = '#3b82f6';
    const RIGHT_CARDS_FILTER_COLOR = '#16a34a';
    const WRONG_CARDS_FILTER_COLOR = '#dc2626';

    function createReport(config) {
        const elements = (config && config.elements) || {};
        const buildSessionUrl = typeof config?.buildSessionUrl === 'function'
            ? config.buildSessionUrl
            : () => '#';
        const fixedCategoryKey = String(config?.fixedCategoryKey || '').trim();
        const isPinnedToCategory = Boolean(fixedCategoryKey);
        const clickBarToSession = Boolean(config?.clickBarToSession);

        let timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
        let allSessions = [];
        let filteredSessions = [];
        let dailyChartRows = [];
        let dailyChartCategories = [];
        let dailyChartPageIndex = 0;
        let selectedDayKey = '';
        const collapsedDayKeys = new Set();
        let categoryThemeByKey = new Map();

        function getFilteredSessions() {
            if (!isPinnedToCategory) return allSessions.slice();
            return allSessions.filter((session) => normalizeCategoryKey(session?.type) === fixedCategoryKey);
        }

        function setData({ sessions, familyTimezone } = {}) {
            allSessions = Array.isArray(sessions) ? sessions : [];
            const tz = String(familyTimezone || '').trim();
            if (tz) timezone = tz;
            categoryThemeByKey = buildCategoryThemeByKey(getFilteredSessions());
            dailyChartPageIndex = 0;
            collapsedDayKeys.clear();
            selectedDayKey = '';
            renderAll();
        }

        function renderInitialLoading(message) {
            const text = message || 'Loading kid records...';
            if (elements.dailyChartPageLabel) elements.dailyChartPageLabel.textContent = text;
            if (elements.dailyChartLegend) {
                elements.dailyChartLegend.innerHTML = '';
                elements.dailyChartLegend.style.display = 'none';
            }
            if (elements.dailyChartBody) {
                elements.dailyChartBody.innerHTML = `<div class="daily-chart-status">${escapeHtml(text)}</div>`;
            }
            if (elements.sessionsList) {
                elements.sessionsList.innerHTML = `<div class="sessions-empty">${escapeHtml(text)}</div>`;
            }
            if (elements.dailyChartNewerBtn) elements.dailyChartNewerBtn.disabled = true;
            if (elements.dailyChartOlderBtn) elements.dailyChartOlderBtn.disabled = true;
        }

        function renderAll() {
            filteredSessions = getFilteredSessions();
            renderSummary(filteredSessions);
            renderDailyMinutesChart(filteredSessions);
            if (elements.sessionsList) renderSessionsList();
        }

        function renderSummary(sessions) {
            if (!elements.summaryGrid) return;
            const totals = summarizeSessions(sessions);
            const calendarSvg = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>`;
            const clockSvg = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`;
            elements.summaryGrid.innerHTML = `
                <div class="summary-stat-card">
                    <div class="summary-stat-icon summary-stat-icon-purple" aria-hidden="true">${calendarSvg}</div>
                    <div class="summary-stat-body">
                        <div class="summary-stat-label">Total Sessions</div>
                        <div class="summary-stat-value">${escapeHtml(String(totals.count))}</div>
                    </div>
                </div>
                <div class="summary-stat-card">
                    <div class="summary-stat-icon summary-stat-icon-green" aria-hidden="true">${clockSvg}</div>
                    <div class="summary-stat-body">
                        <div class="summary-stat-label">Active Minutes</div>
                        <div class="summary-stat-value">${escapeHtml(totals.activeMinutes.toFixed(1))}</div>
                    </div>
                </div>
            `;
        }

        function renderDailyMinutesChart(sessions) {
            const dailyMap = new Map();
            const categoryTotals = new Map();
            const categoryLabelByKey = new Map();

            sessions.forEach((session) => {
                const minutes = getSessionCombinedActiveMinutes(session);
                const rightCards = safeNum(session?.right_count);
                const wrongCards = safeNum(session?.wrong_count);
                const cards = rightCards + wrongCards;
                const dayKey = formatDateKey(session.started_at || session.completed_at);
                if (!dayKey) return;
                const sessionType = normalizeCategoryKey(session.type);
                if (!sessionType) return;
                const categoryKey = sessionType;
                const categoryLabel = String(session?.category_display_name || '').trim();
                if (!categoryLabelByKey.has(categoryKey)) {
                    categoryLabelByKey.set(categoryKey, categoryLabel);
                }
                if (!dailyMap.has(dayKey)) {
                    dailyMap.set(dayKey, { byCategory: {}, total: 0, cards: 0, rightCards: 0, wrongCards: 0, sessions: [] });
                }
                const row = dailyMap.get(dayKey);
                row.byCategory[categoryKey] = (Number(row.byCategory[categoryKey]) || 0) + minutes;
                row.total += minutes;
                row.cards += cards;
                row.rightCards += rightCards;
                row.wrongCards += wrongCards;
                row.sessions.push(session);
                categoryTotals.set(categoryKey, (Number(categoryTotals.get(categoryKey)) || 0) + minutes);
            });

            const orderedCategoryKeys = Array.from(categoryTotals.entries())
                .sort((a, b) => b[1] - a[1])
                .map(([categoryKey]) => categoryKey);
            dailyChartCategories = orderedCategoryKeys.map((categoryKey) => ({
                key: categoryKey,
                label: String(categoryLabelByKey.get(categoryKey) || ''),
                color: getCategoryColorTheme(categoryKey).bar,
            }));

            dailyChartRows = Array.from(dailyMap.entries())
                .map(([date, v]) => ({ date, ...v }))
                .sort((a, b) => b.date.localeCompare(a.date));

            dailyChartPageIndex = 0;
            renderDailyMinutesChartPage();
        }

        function renderDailyMinutesChartPage() {
            if (!elements.dailyChartBody) return;
            const rows = Array.isArray(dailyChartRows) ? dailyChartRows : [];
            const categories = Array.isArray(dailyChartCategories) ? dailyChartCategories : [];
            const view = buildDatePageView(rows, (row) => String(row?.date || ''), dailyChartPageIndex, DAILY_CHART_PAGE_SIZE);
            dailyChartPageIndex = view.pageIndex;
            const allowDayDrill = !isPinnedToCategory;
            if (allowDayDrill && !view.pageDateKeys.includes(selectedDayKey)) {
                const sortedDesc = view.pageDateKeys.slice().sort((a, b) => b.localeCompare(a));
                selectedDayKey = sortedDesc[0] || '';
            }
            syncDatePagerControls({
                newerBtn: elements.dailyChartNewerBtn,
                olderBtn: elements.dailyChartOlderBtn,
                labelEl: elements.dailyChartPageLabel,
                view,
                emptyLabel: 'No data',
            });

            if (rows.length === 0 || view.pageItems.length === 0) {
                elements.dailyChartBody.innerHTML = `<div style="color:#666;font-size:0.9rem;">No active response time yet.</div>`;
                if (elements.dailyChartLegend) {
                    elements.dailyChartLegend.innerHTML = '';
                    elements.dailyChartLegend.style.display = 'none';
                }
                return;
            }

            const pageRows = view.pageItems.slice().sort((a, b) => String(a.date).localeCompare(String(b.date)));
            const maxTotal = Math.max(...pageRows.map((r) => r.total), 1);
            const showCards = isPinnedToCategory;
            const maxCards = showCards ? Math.max(...pageRows.map((r) => Number(r?.cards) || 0), 1) : 1;

            renderDailyChartLegend({ pageRows, showCards, categories });

            if (clickBarToSession && showCards) {
                renderDualAxisChartHtml({ pageRows, maxTotal, maxCards });
                return;
            }

            const columns = pageRows.map((row) => {
                const total = Number(row?.total) || 0;
                const cards = Number(row?.cards) || 0;
                const rightCards = Number(row?.rightCards) || 0;
                const wrongCards = Number(row?.wrongCards) || 0;
                const heightPct = (total / maxTotal) * 100;
                let segments = '';
                if (total > 0) {
                    if (showCards) {
                        segments = `<div class="daily-vbar-seg" style="height:100%;background:${MINUTES_FILTER_COLOR}" title="${total.toFixed(1)} min"></div>`;
                    } else {
                        segments = categories.map((category) => {
                            const minutes = Number(row?.byCategory?.[category.key]) || 0;
                            if (minutes <= 0) return '';
                            const segPct = (minutes / total) * 100;
                            return `<div class="daily-vbar-seg" style="height:${segPct.toFixed(2)}%;background:${escapeHtml(category.color)}" title="${escapeHtml(category.label)} ${minutes.toFixed(1)} min"></div>`;
                        }).join('');
                    }
                }
                const dateLabel = formatDailyVBarDate(row.date);
                const safeHeightPct = Math.max(2, heightPct);
                const minutesBarWrapClass = `daily-vbar-bar-wrap${showCards ? '' : ' daily-vbar-bar-wrap-single'}`;
                const minutesBar = total > 0
                    ? `<div class="daily-vbar-total" style="bottom:${safeHeightPct.toFixed(2)}%">${total.toFixed(1)}</div>
                       <div class="daily-vbar-bar" style="height:${safeHeightPct.toFixed(2)}%">${segments}</div>`
                    : '';
                let cardsBarWrap = '';
                if (showCards) {
                    const cardsHeightPct = (cards / maxCards) * 100;
                    const safeCardsHeightPct = Math.max(2, cardsHeightPct);
                    const cardsSegments = [
                        rightCards > 0
                            ? `<div class="daily-vbar-seg" style="height:${((rightCards / cards) * 100).toFixed(2)}%;background:${RIGHT_CARDS_FILTER_COLOR}" title="${rightCards} ${rightCards === 1 ? 'right card' : 'right cards'}"></div>`
                            : '',
                        wrongCards > 0
                            ? `<div class="daily-vbar-seg" style="height:${((wrongCards / cards) * 100).toFixed(2)}%;background:${WRONG_CARDS_FILTER_COLOR}" title="${wrongCards} ${wrongCards === 1 ? 'wrong card' : 'wrong cards'}"></div>`
                            : '',
                    ].join('');
                    const cardsBar = cards > 0
                        ? `<div class="daily-vbar-total" style="bottom:${safeCardsHeightPct.toFixed(2)}%">${cards}</div>
                           <div class="daily-vbar-bar" style="height:${safeCardsHeightPct.toFixed(2)}%">${cardsSegments}</div>`
                        : '';
                    cardsBarWrap = `<div class="daily-vbar-bar-wrap">${cardsBar}</div>`;
                }
                const daySessions = Array.isArray(row?.sessions) ? row.sessions.slice() : [];
                daySessions.sort((a, b) => String(b?.started_at || '').localeCompare(String(a?.started_at || '')));
                const linkSession = clickBarToSession ? daySessions[0] : null;
                const linkUrl = linkSession ? buildSessionUrl(linkSession) : '';
                const isLinkable = clickBarToSession && Boolean(linkSession);
                const isClickable = isLinkable || allowDayDrill;
                const colClass = `daily-vbar-col${isClickable ? ' daily-vbar-col-clickable' : ''}${allowDayDrill && row.date === selectedDayKey ? ' daily-vbar-col-selected' : ''}`;
                const modeAnnotation = clickBarToSession ? renderDayModeAnnotation(daySessions) : '';
                const tag = isLinkable ? 'a' : 'div';
                const linkAttrs = isLinkable ? ` href="${escapeHtml(linkUrl)}"` : '';
                return `
                    <${tag} class="${colClass}" data-day-key="${escapeHtml(row.date)}"${linkAttrs}>
                        <div class="daily-vbar-plot">
                            <div class="${minutesBarWrapClass}">${minutesBar}</div>
                            ${cardsBarWrap}
                        </div>
                        <div class="daily-vbar-date">
                            <div class="daily-vbar-date-weekday">${escapeHtml(dateLabel.weekday)}</div>
                            <div class="daily-vbar-date-md">${escapeHtml(dateLabel.monthDay)}</div>
                        </div>
                        ${modeAnnotation}
                    </${tag}>
                `;
            }).join('');

            elements.dailyChartBody.innerHTML = `<div class="daily-vbar-chart">${columns}</div>`;
        }

        function renderDailyChartLegend({ pageRows, showCards, categories }) {
            if (!elements.dailyChartLegend) return;
            let legendItems;
            let legendPrefix = '';
            if (showCards && clickBarToSession) {
                legendItems = [
                    { color: MINUTES_FILTER_COLOR, label: 'Practice time (min)', shape: 'line-dot' },
                    { color: RIGHT_CARDS_FILTER_COLOR, label: 'Correct cards' },
                    { color: WRONG_CARDS_FILTER_COLOR, label: 'Wrong cards' },
                ];
            } else if (showCards) {
                legendItems = [
                    { color: MINUTES_FILTER_COLOR, label: 'Active minutes' },
                    { color: RIGHT_CARDS_FILTER_COLOR, label: 'Right cards' },
                    { color: WRONG_CARDS_FILTER_COLOR, label: 'Wrong cards' },
                ];
            } else {
                const visibleCategoryKeys = new Set();
                pageRows.forEach((row) => {
                    Object.entries(row?.byCategory || {}).forEach(([key, minutes]) => {
                        if ((Number(minutes) || 0) > 0) visibleCategoryKeys.add(key);
                    });
                });
                legendItems = (categories || [])
                    .filter((category) => visibleCategoryKeys.has(category.key))
                    .map((category) => ({
                        color: category.color,
                        label: String(category.label || '').trim() || category.key,
                    }));
                if (legendItems.length > 0) {
                    legendPrefix = '<span class="daily-chart-legend-prefix">Active minutes:</span>';
                }
            }
            elements.dailyChartLegend.innerHTML = legendPrefix + legendItems.map((item) => {
                const swatch = item.shape === 'line-dot'
                    ? `<span class="daily-chart-legend-line-dot" style="--legend-color:${escapeHtml(item.color || '#cccccc')}"></span>`
                    : `<span class="daily-chart-legend-swatch" style="background:${escapeHtml(item.color || '#cccccc')}"></span>`;
                return `<span class="daily-chart-legend-item">${swatch}${escapeHtml(item.label)}</span>`;
            }).join('');
            elements.dailyChartLegend.style.display = legendItems.length > 0 ? '' : 'none';
        }

        function renderSessionsList() {
            if (!elements.sessionsList) return;
            const sessions = Array.isArray(filteredSessions) ? filteredSessions : [];
            const view = buildDatePageView(sessions, getSessionDateKey, dailyChartPageIndex, DAILY_CHART_PAGE_SIZE);

            if (sessions.length === 0 || view.pageItems.length === 0) {
                elements.sessionsList.innerHTML = `<div class="sessions-empty">No practice sessions yet.</div>`;
                return;
            }

            const byDay = new Map();
            for (const session of view.pageItems) {
                const dayKey = getSessionDateKey(session);
                if (!dayKey) continue;
                if (!byDay.has(dayKey)) byDay.set(dayKey, []);
                byDay.get(dayKey).push(session);
            }
            const allowDayDrill = !isPinnedToCategory;
            const orderedDays = allowDayDrill
                ? (byDay.has(selectedDayKey) ? [selectedDayKey] : [])
                : Array.from(byDay.keys()).sort((a, b) => b.localeCompare(a));

            if (orderedDays.length === 0) {
                elements.sessionsList.innerHTML = `<div class="sessions-empty">No practice sessions on this day.</div>`;
                return;
            }

            elements.sessionsList.innerHTML = orderedDays.map((dayKey) => {
                const items = byDay.get(dayKey) || [];
                items.sort((a, b) => String(b.started_at || '').localeCompare(String(a.started_at || '')));
                const dayTotals = summarizeSessions(items);
                const cards = items.map((session) => renderSessionCard(session)).join('');
                const isCollapsed = !allowDayDrill && collapsedDayKeys.has(dayKey);
                const toggleBtn = allowDayDrill
                    ? ''
                    : '<button type="button" class="day-group-toggle" aria-label="Toggle">⌃</button>';
                return `
                    <div class="day-group${isCollapsed ? ' collapsed' : ''}" data-day-key="${escapeHtml(dayKey)}">
                        <div class="day-group-header">
                            <div class="day-group-title">${escapeHtml(formatDayHeading(dayKey))}</div>
                            <div class="day-group-summary">${dayTotals.count} ${dayTotals.count === 1 ? 'session' : 'sessions'} · ${dayTotals.activeMinutes.toFixed(1)} min</div>
                            ${toggleBtn}
                        </div>
                        <div class="day-group-body">${cards}</div>
                    </div>
                `;
            }).join('');
        }

        function renderSessionCard(session) {
            const displayName = String(session?.category_display_name || '').trim() || String(session?.type || '');
            const glyph = String(session?.category_emoji || '').trim() || '🧩';
            const categoryKey = normalizeCategoryKey(session?.type);
            const sessionUrl = buildSessionUrl(session);
            const time = formatSessionTime(session.started_at);
            const mode = formatPracticeMode(session.practice_mode);
            const subParts = [time, mode].filter((part) => part && part !== '-');
            const totalMins = (getSessionResponseMinutes(session) + getSessionRetryResponseMinutes(session)).toFixed(1);
            const result = getSessionResultMeta(session);
            const retries = safeNum(session.retry_count);
            const iconHtml = window.DeckCategoryCommon.renderCategorySubjectIcon(categoryKey, {
                fallbackEmoji: glyph,
            });
            return `
                <a href="${escapeHtml(sessionUrl)}" class="session-card">
                    <div class="session-icon">${iconHtml}</div>
                    <div class="session-info">
                        <div class="session-title">${escapeHtml(displayName)}</div>
                        <div class="session-sub">${escapeHtml(subParts.join(' · '))}</div>
                    </div>
                    <div class="session-stats">
                        <div class="session-mins">${totalMins}<span class="session-mins-unit">min</span></div>
                        ${result ? `<div class="session-result" style="color:${escapeHtml(result.color)}">${escapeHtml(result.text)}</div>` : ''}
                        <div class="session-retries">Retries ${retries}</div>
                    </div>
                    <div class="session-chevron">›</div>
                </a>
            `;
        }

        function renderDualAxisChartHtml({ pageRows, maxTotal, maxCards }) {
            const N = pageRows.length;
            const minutesAxis = computeNiceAxis(maxTotal, 5);
            const cardsAxis = computeNiceAxis(maxCards, 5);
            const tickStops = minutesAxis.ticks.map((_, i) => (i / (minutesAxis.ticks.length - 1)) * 100);

            const validPoints = [];
            const cols = pageRows.map((row, i) => {
                const total = Number(row?.total) || 0;
                const cards = Number(row?.cards) || 0;
                const rightCards = Number(row?.rightCards) || 0;
                const wrongCards = Number(row?.wrongCards) || 0;
                if (total > 0) {
                    validPoints.push({ index: i, total });
                }

                const barHeightPct = cards > 0 ? Math.max(2, (cards / cardsAxis.max) * 100) : 0;
                let segments = '';
                if (cards > 0) {
                    if (rightCards > 0) {
                        const segPct = (rightCards / cards) * 100;
                        segments += `<div class="daily-line-chart-seg" style="height:${segPct.toFixed(2)}%;background:${RIGHT_CARDS_FILTER_COLOR}" title="${rightCards} ${rightCards === 1 ? 'correct card' : 'correct cards'}"></div>`;
                    }
                    if (wrongCards > 0) {
                        const segPct = (wrongCards / cards) * 100;
                        segments += `<div class="daily-line-chart-seg" style="height:${segPct.toFixed(2)}%;background:${WRONG_CARDS_FILTER_COLOR}" title="${wrongCards} ${wrongCards === 1 ? 'wrong card' : 'wrong cards'}"></div>`;
                    }
                }
                const dateLabel = formatDailyVBarDate(row.date);
                const totalLabel = cards > 0
                    ? `<div class="daily-line-chart-total" style="bottom:${barHeightPct.toFixed(2)}%">${cards}</div>`
                    : '';
                const bar = cards > 0
                    ? `<div class="daily-line-chart-bar" style="height:${barHeightPct.toFixed(2)}%">${segments}</div>`
                    : '';

                const daySessions = Array.isArray(row?.sessions) ? row.sessions.slice() : [];
                daySessions.sort((a, b) => String(b?.started_at || '').localeCompare(String(a?.started_at || '')));
                const linkSession = daySessions[0] || null;
                const linkUrl = linkSession ? buildSessionUrl(linkSession) : '';
                const isLinkable = Boolean(linkSession);
                const colClass = `daily-line-chart-col${isLinkable ? ' daily-line-chart-col-clickable' : ''}`;
                const modeAnnotation = renderDayModeAnnotation(daySessions);
                const tag = isLinkable ? 'a' : 'div';
                const linkAttrs = isLinkable ? ` href="${escapeHtml(linkUrl)}"` : '';
                return `
                    <${tag} class="${colClass}" data-day-key="${escapeHtml(row.date)}"${linkAttrs}>
                        <div class="daily-line-chart-bar-cell">
                            ${totalLabel}
                            ${bar}
                        </div>
                        <div class="daily-line-chart-foot">
                            <div class="daily-line-chart-date">
                                <div class="daily-line-chart-date-weekday">${escapeHtml(dateLabel.weekday)}</div>
                                <div class="daily-line-chart-date-md">${escapeHtml(dateLabel.monthDay)}</div>
                            </div>
                            ${modeAnnotation}
                        </div>
                    </${tag}>
                `;
            }).join('');

            const linePoints = validPoints.map((p) => {
                const x = p.index + 0.5;
                const y = 100 - (p.total / minutesAxis.max) * 100;
                return `${x.toFixed(3)},${y.toFixed(2)}`;
            }).join(' ');
            const lineSvg = validPoints.length > 0
                ? `<svg class="daily-line-chart-line" viewBox="0 0 ${N} 100" preserveAspectRatio="none" width="100%" height="100%" aria-hidden="true">
                    <polyline points="${linePoints}" />
                   </svg>`
                : '';

            const dots = validPoints.map((p) => {
                const xPct = ((p.index + 0.5) / N) * 100;
                const yPct = (p.total / minutesAxis.max) * 100;
                return `
                    <span class="daily-line-chart-dot" style="left:${xPct.toFixed(3)}%;bottom:${yPct.toFixed(2)}%">
                        <span class="daily-line-chart-dot-label">${p.total.toFixed(1)}m</span>
                    </span>
                `;
            }).join('');

            const leftTicks = minutesAxis.ticks.map((value, i) => `
                <span class="daily-line-chart-tick" style="bottom:${tickStops[i].toFixed(2)}%">${escapeHtml(formatNiceTick(value, false))}</span>
            `).join('');
            const rightTicks = cardsAxis.ticks.map((value, i) => `
                <span class="daily-line-chart-tick" style="bottom:${tickStops[i].toFixed(2)}%">${escapeHtml(formatNiceTick(value, true))}</span>
            `).join('');
            const gridLines = tickStops.map((pct, i) => `
                <div class="daily-line-chart-grid-line${i === 0 ? ' daily-line-chart-grid-line-base' : ''}" style="bottom:${pct.toFixed(2)}%"></div>
            `).join('');

            elements.dailyChartBody.innerHTML = `
                <div class="daily-line-chart">
                    <div class="daily-line-chart-axis daily-line-chart-axis-left">
                        <div class="daily-line-chart-axis-title">Minutes</div>
                        <div class="daily-line-chart-axis-ticks">${leftTicks}</div>
                    </div>
                    <div class="daily-line-chart-plot-wrap">
                        <div class="daily-line-chart-grid">${gridLines}</div>
                        <div class="daily-line-chart-cols">${cols}</div>
                        ${lineSvg}
                        <div class="daily-line-chart-dots">${dots}</div>
                    </div>
                    <div class="daily-line-chart-axis daily-line-chart-axis-right">
                        <div class="daily-line-chart-axis-title">Cards</div>
                        <div class="daily-line-chart-axis-ticks">${rightTicks}</div>
                    </div>
                </div>
            `;
        }

        function renderDayModeAnnotation(sessions) {
            const list = Array.isArray(sessions) ? sessions : [];
            if (!list.length) return '';
            const seen = new Set();
            const items = [];
            for (const session of list) {
                const raw = String(session?.practice_mode || '').trim().toLowerCase();
                if (!raw) continue;
                let baseKey = raw;
                let drill = false;
                if (baseKey.endsWith('+drill')) {
                    drill = true;
                    baseKey = baseKey.slice(0, -'+drill'.length);
                }
                const baseLabel = practiceModeBaseLabel(baseKey);
                if (!baseLabel && !drill) continue;
                const dedupKey = `${baseLabel}|${drill ? '1' : '0'}`;
                if (seen.has(dedupKey)) continue;
                seen.add(dedupKey);
                items.push({ baseLabel, drill });
            }
            if (!items.length) return '';
            const chips = items.map(({ baseLabel, drill }) => {
                const parts = [];
                if (baseLabel) {
                    parts.push(`<span class="daily-vbar-mode-base">${escapeHtml(baseLabel)}</span>`);
                }
                if (drill) {
                    parts.push(`<span class="daily-vbar-mode-drill">Drill</span>`);
                }
                return `<span class="daily-vbar-mode-chip">${parts.join('')}</span>`;
            }).join('');
            return `<div class="daily-vbar-mode">${chips}</div>`;
        }

        function getCategoryColorTheme(categoryKey) {
            const key = String(categoryKey || '').trim().toLowerCase();
            if (!key) return DEFAULT_CATEGORY_COLOR_THEME;
            const existing = categoryThemeByKey.get(key);
            if (existing) return existing;
            const nextTheme = CATEGORY_COLOR_PALETTE[
                categoryThemeByKey.size % CATEGORY_COLOR_PALETTE.length
            ] || DEFAULT_CATEGORY_COLOR_THEME;
            categoryThemeByKey.set(key, nextTheme);
            return nextTheme;
        }

        function buildCategoryThemeByKey(sessions) {
            const totalsByKey = new Map();
            const countByKey = new Map();
            for (const session of (Array.isArray(sessions) ? sessions : [])) {
                const categoryKey = normalizeCategoryKey(session?.type);
                if (!categoryKey) continue;
                if (!totalsByKey.has(categoryKey)) {
                    totalsByKey.set(categoryKey, 0);
                    countByKey.set(categoryKey, 0);
                }
                totalsByKey.set(
                    categoryKey,
                    (Number(totalsByKey.get(categoryKey)) || 0) + getSessionCombinedActiveMinutes(session),
                );
                countByKey.set(categoryKey, (Number(countByKey.get(categoryKey)) || 0) + 1);
            }
            const orderedKeys = Array.from(totalsByKey.keys()).sort((a, b) => {
                const minuteDiff = (Number(totalsByKey.get(b)) || 0) - (Number(totalsByKey.get(a)) || 0);
                if (Math.abs(minuteDiff) > 0.00001) return minuteDiff;
                const sessionDiff = (Number(countByKey.get(b)) || 0) - (Number(countByKey.get(a)) || 0);
                if (sessionDiff !== 0) return sessionDiff;
                return String(a).localeCompare(String(b));
            });
            const themeByKey = new Map();
            for (let i = 0; i < orderedKeys.length; i += 1) {
                const key = orderedKeys[i];
                const theme = CATEGORY_COLOR_PALETTE[i % CATEGORY_COLOR_PALETTE.length] || DEFAULT_CATEGORY_COLOR_THEME;
                themeByKey.set(key, theme);
            }
            return themeByKey;
        }

        function getSessionDateKey(session) {
            return formatDateKey(session?.started_at || session?.completed_at);
        }

        function buildDatePageView(items, getDateKey, requestedPageIndex, pageSize) {
            const source = Array.isArray(items) ? items : [];
            const size = Math.max(1, Number.parseInt(pageSize, 10) || 7);
            const seen = new Set();
            const dateKeys = [];
            for (const item of source) {
                const key = String(getDateKey(item) || '').trim();
                if (!key || seen.has(key)) continue;
                seen.add(key);
                dateKeys.push(key);
            }
            const pageCount = dateKeys.length > 0 ? Math.ceil(dateKeys.length / size) : 0;
            const safePageIndex = pageCount > 0
                ? Math.max(0, Math.min(Number.parseInt(requestedPageIndex, 10) || 0, pageCount - 1))
                : 0;
            const start = safePageIndex * size;
            const pageDateKeys = dateKeys.slice(start, start + size);
            const pageDateSet = new Set(pageDateKeys);
            const pageItems = source.filter((item) => pageDateSet.has(String(getDateKey(item) || '').trim()));
            return { pageIndex: safePageIndex, pageCount, pageDateKeys, pageItems };
        }

        function syncDatePagerControls({ newerBtn, olderBtn, labelEl, view, emptyLabel }) {
            const pageCount = Number.isFinite(Number(view?.pageCount)) ? Number(view.pageCount) : 0;
            const pageIndex = Number.isFinite(Number(view?.pageIndex)) ? Number(view.pageIndex) : 0;
            const pageDateKeys = Array.isArray(view?.pageDateKeys) ? view.pageDateKeys : [];
            if (labelEl) {
                if (pageCount <= 0 || pageDateKeys.length === 0) {
                    labelEl.textContent = emptyLabel || 'No data';
                } else {
                    labelEl.textContent = formatDailyChartRangeLabel(pageDateKeys);
                }
            }
            if (newerBtn) newerBtn.disabled = pageCount <= 0 || pageIndex <= 0;
            if (olderBtn) olderBtn.disabled = pageCount <= 0 || pageIndex >= (pageCount - 1);
        }

        function formatDailyChartRangeLabel(pageDateKeys) {
            const sorted = pageDateKeys.slice().sort();
            const first = parseDateKeyToUtcNoon(sorted[0]);
            const last = parseDateKeyToUtcNoon(sorted[sorted.length - 1]);
            if (!first || !last) return '';
            const fmtMD = new Intl.DateTimeFormat(undefined, { timeZone: timezone, month: 'short', day: 'numeric' });
            const fmtMDY = new Intl.DateTimeFormat(undefined, { timeZone: timezone, month: 'short', day: 'numeric', year: 'numeric' });
            const firstYear = first.getUTCFullYear();
            const lastYear = last.getUTCFullYear();
            if (firstYear !== lastYear) return `${fmtMDY.format(first)} – ${fmtMDY.format(last)}`;
            if (sorted.length === 1) return fmtMDY.format(first);
            return `${fmtMD.format(first)} – ${fmtMD.format(last)}, ${lastYear}`;
        }

        function formatDailyVBarDate(dateKey) {
            const text = String(dateKey || '').trim();
            const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
            if (!match) return { weekday: text, monthDay: '' };
            const dt = new Date(`${text}T12:00:00Z`);
            if (Number.isNaN(dt.getTime())) return { weekday: text, monthDay: '' };
            const weekday = new Intl.DateTimeFormat(undefined, { timeZone: timezone, weekday: 'short' }).format(dt);
            const monthDay = new Intl.DateTimeFormat(undefined, { timeZone: timezone, month: 'short', day: 'numeric' }).format(dt);
            return { weekday, monthDay };
        }

        function formatSessionTime(iso) {
            const dt = parseUtcTimestamp(iso);
            if (Number.isNaN(dt.getTime())) return '';
            return dt.toLocaleTimeString(undefined, {
                timeZone: timezone,
                hour: 'numeric',
                minute: '2-digit',
                hour12: true,
            });
        }

        function formatDayHeading(dayKey) {
            const dt = parseDateKeyToUtcNoon(dayKey);
            if (!dt) return dayKey;
            return new Intl.DateTimeFormat(undefined, {
                timeZone: timezone,
                weekday: 'short',
                month: 'short',
                day: 'numeric',
                year: 'numeric',
            }).format(dt);
        }

        function formatDateKey(iso) {
            const dt = parseUtcTimestamp(iso);
            if (Number.isNaN(dt.getTime())) return '';
            const parts = new Intl.DateTimeFormat('en-CA', {
                timeZone: timezone,
                year: 'numeric',
                month: '2-digit',
                day: '2-digit',
            }).formatToParts(dt);
            const y = parts.find((p) => p.type === 'year')?.value || '';
            const m = parts.find((p) => p.type === 'month')?.value || '';
            const d = parts.find((p) => p.type === 'day')?.value || '';
            return y && m && d ? `${y}-${m}-${d}` : '';
        }

        function attachListeners() {
            if (elements.dailyChartBody) {
                elements.dailyChartBody.addEventListener('click', (event) => {
                    if (isPinnedToCategory) return;
                    const col = event.target.closest('.daily-vbar-col[data-day-key]');
                    if (!col) return;
                    const dayKey = col.getAttribute('data-day-key') || '';
                    if (!dayKey || dayKey === selectedDayKey) return;
                    selectedDayKey = dayKey;
                    renderSessionsList();
                    renderDailyMinutesChartPage();
                });
            }
            if (elements.dailyChartNewerBtn) {
                elements.dailyChartNewerBtn.addEventListener('click', () => {
                    if (dailyChartPageIndex <= 0) return;
                    dailyChartPageIndex -= 1;
                    renderDailyMinutesChartPage();
                    renderSessionsList();
                });
            }
            if (elements.dailyChartOlderBtn) {
                elements.dailyChartOlderBtn.addEventListener('click', () => {
                    const pageCount = buildDatePageView(dailyChartRows, (row) => String(row?.date || ''), 0, DAILY_CHART_PAGE_SIZE).pageCount;
                    if (dailyChartPageIndex >= (pageCount - 1)) return;
                    dailyChartPageIndex += 1;
                    renderDailyMinutesChartPage();
                    renderSessionsList();
                });
            }
        }

        attachListeners();

        return {
            setData,
            renderInitialLoading,
        };
    }

    function safeNum(value) {
        const num = Number(value);
        return Number.isFinite(num) ? num : 0;
    }

    function summarizeSessions(sessions) {
        const list = Array.isArray(sessions) ? sessions : [];
        return {
            count: list.length,
            activeMinutes: list.reduce((sum, session) => sum + getSessionCombinedActiveMinutes(session), 0),
        };
    }

    function getSessionResponseMinutes(session) {
        if (!session || typeof session !== 'object') return 0;
        const totalResponseMs = Number(session.total_response_ms);
        if (!Number.isFinite(totalResponseMs)) return 0;
        return Math.max(0, totalResponseMs / 60000);
    }

    function getSessionRetryResponseMinutes(session) {
        if (!session || typeof session !== 'object') return 0;
        const retryResponseMs = Number(session.retry_total_response_ms);
        if (!Number.isFinite(retryResponseMs)) return 0;
        return Math.max(0, retryResponseMs / 60000);
    }

    function getSessionCombinedActiveMinutes(session) {
        return getSessionResponseMinutes(session) + getSessionRetryResponseMinutes(session);
    }

    function getSessionResultMeta(session) {
        const SESSION_RESULT_SUCCESS_COLOR = '#15803d';
        const SESSION_RESULT_ERROR_COLOR = '#dc2626';
        const right = safeNum(session?.right_count);
        const wrong = safeNum(session?.wrong_count);
        const total = right + wrong;
        if (total <= 0) return null;
        if (wrong > 0) {
            return {
                text: `Correct ${right} / ${total}`,
                color: SESSION_RESULT_ERROR_COLOR,
            };
        }
        return {
            text: `Completed ${right} ${right === 1 ? 'item' : 'items'}`,
            color: SESSION_RESULT_SUCCESS_COLOR,
        };
    }

    function computeNiceAxis(maxValue, tickCount) {
        const count = Math.max(2, Number.parseInt(tickCount, 10) || 5);
        const value = Number(maxValue);
        if (!Number.isFinite(value) || value <= 0) {
            const ticks = [];
            for (let i = 0; i <= count; i += 1) ticks.push(i);
            return { max: count, ticks };
        }
        const exp = Math.floor(Math.log10(value));
        const factor = Math.pow(10, exp);
        const normalized = value / factor;
        let niceNorm;
        if (normalized <= 1) niceNorm = 1;
        else if (normalized <= 2) niceNorm = 2;
        else if (normalized <= 5) niceNorm = 5;
        else niceNorm = 10;
        const niceMax = niceNorm * factor;
        const step = niceMax / count;
        const ticks = [];
        for (let i = 0; i <= count; i += 1) ticks.push(i * step);
        return { max: niceMax, ticks };
    }

    function formatNiceTick(value, isInteger) {
        const num = Number(value);
        if (!Number.isFinite(num)) return '0';
        if (isInteger) return String(Math.round(num));
        if (Math.abs(num - Math.round(num)) < 1e-9) return String(Math.round(num));
        return num.toFixed(1).replace(/\.0$/, '');
    }

    function practiceModeBaseLabel(text) {
        const key = String(text || '').trim().toLowerCase();
        if (key === 'self') return 'Self';
        if (key === 'parent') return 'Parent Assist';
        if (key === 'multi') return 'Multi';
        if (key === 'input') return 'Input';
        return '';
    }

    function formatPracticeMode(mode) {
        let text = String(mode || '').trim().toLowerCase();
        let drill = false;
        if (text.endsWith('+drill')) {
            drill = true;
            text = text.slice(0, -'+drill'.length);
        }
        const baseLabel = practiceModeBaseLabel(text);
        const parts = [];
        if (baseLabel) parts.push(baseLabel);
        if (drill) parts.push('Drill');
        return parts.length > 0 ? parts.join(' · ') : '-';
    }

    function parseUtcTimestamp(raw) {
        if (!raw) return new Date(NaN);
        const text = String(raw).trim();
        if (!text) return new Date(NaN);
        const hasZone = /(?:Z|[+\-]\d{2}:\d{2})$/.test(text);
        return new Date(hasZone ? text : `${text}Z`);
    }

    function parseDateKeyToUtcNoon(dateKey) {
        const text = String(dateKey || '').trim();
        if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
        const dt = new Date(`${text}T12:00:00Z`);
        return Number.isNaN(dt.getTime()) ? null : dt;
    }

    window.KidReportCommon = { createReport };
})();
