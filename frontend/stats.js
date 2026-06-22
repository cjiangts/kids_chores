const API_BASE = `${window.location.origin}/api`;
const STATS_TAB_STORAGE_KEY = 'stats_last_tab_v1';

const statsKidAvatarSwitcher = document.getElementById('statsKidAvatarSwitcher');
const statsError = document.getElementById('statsError');
const statsTabs = document.getElementById('statsTabs');
const statsBalanceControl = document.getElementById('statsBalanceControl');
const statsBalanceToggle = document.getElementById('statsBalanceToggle');
const statsPeriodControls = document.getElementById('statsPeriodControls');
const statsTrendSubtitle = document.getElementById('statsTrendSubtitle');
const statsTrendMeta = document.getElementById('statsTrendMeta');
const statsTrendChart = document.getElementById('statsTrendChart');
const statsTopItemsHeading = document.getElementById('statsTopItemsHeading');
const statsTopItemSearchInput = document.getElementById('statsTopItemSearchInput');
const statsTopItems = document.getElementById('statsTopItems');
const params = new URLSearchParams(window.location.search);
const requestedKidId = String(params.get('id') || params.get('kidId') || '').trim();

let kids = [];
let selectedKidId = '';
let statsData = { tabs: [] };
let activeTabKey = readStoredTab() || 'earn';
let showBalance = true;
let selectedGranularity = 'daily';
let expandedRuleId = '';
let topItemSearch = '';
let itemSearch = '';
let showAllLatestRows = false;
let statsLoadRequestId = 0;
let statsResizeTimer = 0;

const DEFAULT_STATS_GRANULARITY = 'daily';
const LATEST_ROWS_DEFAULT_LIMIT = 5;

function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function highlightQueryHtml(text, query) {
    const rawText = String(text || '');
    const rawQuery = String(query || '').trim();
    if (!rawQuery) return escapeHtml(rawText);
    const lowerText = rawText.toLowerCase();
    const lowerQuery = rawQuery.toLowerCase();
    let html = '';
    let cursor = 0;
    while (cursor < rawText.length) {
        const index = lowerText.indexOf(lowerQuery, cursor);
        if (index === -1) {
            html += escapeHtml(rawText.slice(cursor));
            break;
        }
        if (index > cursor) html += escapeHtml(rawText.slice(cursor, index));
        html += `<mark class="paradigm-search-hit">${escapeHtml(rawText.slice(index, index + rawQuery.length))}</mark>`;
        cursor = index + rawQuery.length;
    }
    return html;
}

function showMessage(node, text) {
    if (!node) return;
    node.textContent = text || '';
    node.classList.toggle('hidden', !text);
}

function showError(text) {
    showMessage(statsError, text || '');
}

async function fetchJson(url, options = {}) {
    const response = await fetch(url, {
        headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
        ...options,
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
        throw new Error(data.error || `Request failed (${response.status})`);
    }
    return data;
}

function readStoredTab() {
    try {
        if (!window.sessionStorage) return '';
        return String(window.sessionStorage.getItem(STATS_TAB_STORAGE_KEY) || '').trim();
    } catch (error) {
        return '';
    }
}

function rememberTab(key) {
    try {
        if (!window.sessionStorage || !key) return;
        window.sessionStorage.setItem(STATS_TAB_STORAGE_KEY, key);
    } catch (error) {
        // best-effort UI memory
    }
}

function rememberedKidId() {
    return String(window.KidAppNavigation?.getKidId?.() || '').trim();
}

function initialKidId() {
    const candidates = [requestedKidId, rememberedKidId()];
    const match = candidates.find((kidId) => kidId && kids.some((kid) => String(kid?.id || '') === kidId));
    return match || String(kids[0]?.id || '');
}

function syncSelectedKidNavigation() {
    if (window.KidAppNavigation && selectedKidId) {
        window.KidAppNavigation.setKidId(selectedKidId);
    }
}

function activeTab() {
    const tabs = Array.isArray(statsData.tabs) ? statsData.tabs : [];
    return tabs.find((tab) => tab.key === activeTabKey) || tabs[0] || null;
}

function selectedFamilyTimezone() {
    const kid = kids.find((item) => String(item?.id || '') === selectedKidId);
    return String(kid?.familyTimezone || statsData.timezone || '').trim();
}

function formatPoints(value) {
    const number = Number.parseInt(value, 10) || 0;
    return `${number.toLocaleString()} pts`;
}

function formatRecordCount(value) {
    const number = Number.parseInt(value, 10) || 0;
    return `${number.toLocaleString()} ${number === 1 ? 'record' : 'records'}`;
}

function formatDelta(value) {
    const number = Number.parseInt(value, 10) || 0;
    return `${number > 0 ? '+' : ''}${number}`;
}

function deltaClass(value) {
    const number = Number.parseInt(value, 10) || 0;
    if (number > 0) return 'positive';
    if (number < 0) return 'negative';
    return 'neutral';
}

function tabIconName(tabKey) {
    if (tabKey === 'earn') return 'thumbs-up';
    if (tabKey === 'loss') return 'thumbs-down';
    return 'gift';
}

function isSubjectRuleItem(item) {
    const triggerKey = String(item?.triggerKey || '').trim();
    return String(item?.ruleKind || '').trim() === 'in_app_chore'
        && Boolean(triggerKey)
        && Boolean(window.SUBJECT_ICONS?.[triggerKey])
        && typeof window.subjectIcon === 'function';
}

function ruleIconHtml(item) {
    if (isSubjectRuleItem(item)) {
        return window.subjectIcon(String(item.triggerKey || '').trim(), { size: 30 });
    }
    const emoji = String(item?.emoji || '').trim();
    const kind = String(item?.ruleKind || '').trim();
    if (kind === 'redeemed_reward' && !emoji && typeof window.icon === 'function') {
        return `<span class="point-rule-emoji">${window.icon('gift', { size: 18 })}</span>`;
    }
    const fallback = kind === 'deduction_event' ? '-' : '+';
    return `<span class="point-rule-emoji">${escapeHtml(emoji || fallback)}</span>`;
}

function parseDate(value) {
    const text = String(value || '').trim();
    if (!text) return new Date(Number.NaN);
    const hasTimezone = /(?:z|[+-]\d{2}:?\d{2})$/i.test(text);
    return new Date(hasTimezone ? text : `${text}Z`);
}

function formatEventDate(value) {
    const date = parseDate(value);
    if (Number.isNaN(date.getTime())) return '';
    const timezone = selectedFamilyTimezone();
    return date.toLocaleDateString([], {
        timeZone: timezone || undefined,
        month: 'short',
        day: 'numeric',
    });
}

function trendValues(trend, useBalance = false) {
    return (Array.isArray(trend) ? trend : []).map((point) => ({
        ...point,
        displayValue: Number.parseInt(useBalance ? point.balance : point.value, 10) || 0,
    }));
}

function compactPeriodLabel(label) {
    const text = String(label || '').trim();
    if (!text) return '';
    if (selectedGranularity !== 'monthly') return text;
    const parts = text.split(/\s+/);
    return parts[0] || text;
}

function normalizeGranularity(value) {
    const normalized = String(value || '').trim().toLowerCase();
    if (normalized === 'day' || normalized === 'daily') return 'daily';
    if (normalized === 'week' || normalized === 'weekly') return 'weekly';
    if (normalized === 'month' || normalized === 'monthly') return 'monthly';
    return DEFAULT_STATS_GRANULARITY;
}

function granularityLabel(value) {
    const normalized = normalizeGranularity(value);
    if (normalized === 'daily') return 'Daily';
    if (normalized === 'weekly') return 'Weekly';
    return 'Monthly';
}

function syncGranularityControl() {
    statsPeriodControls?.querySelectorAll('[data-stats-granularity]').forEach((button) => {
        const isActive = normalizeGranularity(button.dataset.statsGranularity) === selectedGranularity;
        button.classList.toggle('active', isActive);
        button.setAttribute('aria-pressed', isActive ? 'true' : 'false');
    });
}

function measuredChartWidth(node, fallback = 640) {
    const width = Math.floor(Number(node?.getBoundingClientRect?.().width) || 0);
    return width > 0 ? width : fallback;
}

function expandedItemChartWidth() {
    const width = measuredChartWidth(statsTopItems, 640);
    return Math.max(260, width - 28);
}

function formatCompactNumber(value, digits = 1) {
    const number = Number(value) || 0;
    if (Math.abs(number) >= 100) return Math.round(number).toLocaleString();
    if (Number.isInteger(number)) return number.toLocaleString();
    return number.toFixed(digits);
}

function formatSignedCompactNumber(value, digits = 1) {
    const number = Number(value) || 0;
    const text = formatCompactNumber(number, digits);
    return number > 0 ? `+${text}` : text;
}

function trendSummaryHtml(tab) {
    const trend = Array.isArray(tab?.trend) ? tab.trend : [];
    if (!trend.length) return '';
    const total = trend.reduce((sum, point) => sum + (Number.parseInt(point?.value, 10) || 0), 0);
    const count = trend.length;
    const avg = total / count;
    let unit = count === 1 ? 'day' : 'days';
    let avgUnit = 'day';
    if (selectedGranularity === 'weekly') {
        unit = count === 1 ? 'week' : 'weeks';
        avgUnit = 'week';
    } else if (selectedGranularity === 'monthly') {
        unit = count === 1 ? 'month' : 'months';
        avgUnit = 'month';
    }
    const parts = [
        `<span class="stats-trend-meta-number">${escapeHtml(count.toLocaleString())}</span> ${escapeHtml(unit)}`,
        `avg <span class="stats-trend-meta-number">${escapeHtml(formatSignedCompactNumber(avg))}</span> per ${escapeHtml(avgUnit)}`,
        `total <span class="stats-trend-meta-number">${escapeHtml(formatSignedCompactNumber(total))}</span> pts`,
    ];
    return parts.map((part) => `<span class="stats-trend-meta-part">${part}</span>`).join('');
}

function chartSvg(points, options = {}) {
    const values = trendValues(points, options.useBalance === true);
    const compact = options.compact === true;
    const requestedWidth = Math.floor(Number(options.width) || 0);
    const width = compact ? 152 : (requestedWidth > 0 ? requestedWidth : measuredChartWidth(options.container, 640));
    const narrow = !compact && width <= 520;
    const baseHeight = narrow ? 126 : 154;
    const heightScale = Math.max(0.3, Math.min(1.5, Number(options.heightScale) || 1));
    const height = compact ? 42 : Math.round(baseHeight * heightScale);
    const margin = compact
        ? { top: 8, right: 6, bottom: 8, left: 6 }
        : (narrow ? { top: 14, right: 20, bottom: 26, left: 18 } : { top: 16, right: 20, bottom: 28, left: 18 });
    const plotWidth = width - margin.left - margin.right;
    const plotHeight = height - margin.top - margin.bottom;
    if (!values.length) {
        return `<div class="stats-empty">${escapeHtml(options.empty || 'No point events yet.')}</div>`;
    }

    const rawNumbers = values.map((point) => Number.parseInt(point.displayValue, 10) || 0);
    const minValue = Math.min(0, ...rawNumbers);
    const maxValue = Math.max(0, ...rawNumbers);
    const hasNegativeValue = rawNumbers.some((value) => value < 0);
    const hasNonNegativeValue = rawNumbers.some((value) => value >= 0);
    const baseMax = maxValue === minValue ? maxValue + 1 : maxValue;
    const baseMin = maxValue === minValue ? minValue - 1 : minValue;
    const baseRange = Math.max(1, baseMax - baseMin);
    const topLabelDomainPadding = compact ? 0 : baseRange * 0.12;
    const bottomLabelDomainPadding = compact ? 0 : baseRange * 0.32;
    const paddedMax = baseMax + (hasNonNegativeValue ? topLabelDomainPadding : 0);
    const paddedMin = baseMin - (hasNegativeValue ? bottomLabelDomainPadding : 0);
    const range = Math.max(1, paddedMax - paddedMin);
    const xFor = (index) => {
        if (values.length <= 1) return margin.left + plotWidth;
        return margin.left + (plotWidth * index / (values.length - 1));
    };
    const yFor = (value) => margin.top + ((paddedMax - value) / range * plotHeight);
    const zeroY = yFor(0);
    const linePath = values.map((point, index) => {
        const command = index === 0 ? 'M' : 'L';
        return `${command}${xFor(index).toFixed(2)} ${yFor(point.displayValue).toFixed(2)}`;
    }).join(' ');
    const areaPath = values.length > 1
        ? `${linePath} L${xFor(values.length - 1).toFixed(2)} ${zeroY.toFixed(2)} L${xFor(0).toFixed(2)} ${zeroY.toFixed(2)} Z`
        : '';
    const labelStep = Math.max(1, Math.ceil(values.length / 6));
    const labelIndexes = values
        .map((point, index) => index)
        .filter((index) => index === values.length - 1 || index % labelStep === 0);

    return `
        <svg class="${compact ? 'stats-sparkline-svg' : 'stats-chart-svg'}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeHtml(options.label || 'Point trend')}">
            ${areaPath ? `<path class="stats-area" d="${areaPath}"></path>` : ''}
            <path class="stats-line" d="${linePath}"></path>
            ${values.map((point, index) => `
                <circle class="stats-dot" cx="${xFor(index).toFixed(2)}" cy="${yFor(point.displayValue).toFixed(2)}" r="${compact ? 2 : 4}"></circle>
            `).join('')}
            ${compact ? '' : values.map((point, index) => {
        const value = Number.parseInt(point.displayValue, 10) || 0;
        const text = value.toLocaleString();
        const labelWidth = Math.max(18, text.length * 6.2 + 8);
        const labelHeight = 14;
        const x = Math.min(width - (labelWidth / 2) - 1, Math.max((labelWidth / 2) + 1, xFor(index)));
        const negativeOffset = 16;
        const y = value < 0
            ? yFor(value) + negativeOffset
            : Math.max(13, yFor(value) - 10);
        return `
                <g>
                    <rect class="paradigm-chart-value-label-bg" x="${(x - (labelWidth / 2)).toFixed(2)}" y="${(y - 10.5).toFixed(2)}" width="${labelWidth.toFixed(2)}" height="${labelHeight}" rx="${(labelHeight / 2).toFixed(2)}"></rect>
                    <text class="paradigm-chart-value-label" x="${x.toFixed(2)}" y="${y.toFixed(2)}" text-anchor="middle">${escapeHtml(text)}</text>
                </g>
            `;
    }).join('')}
            ${compact ? '' : labelIndexes.map((index) => {
        const point = values[index];
        return `<text class="paradigm-chart-axis-label" x="${xFor(index).toFixed(2)}" y="${height - 8}" text-anchor="middle">${escapeHtml(compactPeriodLabel(point.label))}</text>`;
    }).join('')}
        </svg>
    `;
}

function renderKids() {
    if (!window.KidAppNavigation?.renderKidAvatarSwitcher) return;
    if (window.KidAppNavigation.getMode?.() === 'kid') {
        if (statsKidAvatarSwitcher) {
            statsKidAvatarSwitcher.innerHTML = '';
            statsKidAvatarSwitcher.classList.add('hidden');
        }
        return;
    }
    window.KidAppNavigation.renderKidAvatarSwitcher(statsKidAvatarSwitcher, kids, {
        selectedKidId,
        onSelect: async (kidId) => {
            if (!kidId || kidId === selectedKidId) return;
            selectedKidId = kidId;
            syncSelectedKidNavigation();
            expandedRuleId = '';
            topItemSearch = '';
            if (statsTopItemSearchInput) statsTopItemSearchInput.value = '';
            itemSearch = '';
            showAllLatestRows = false;
            showError('');
            try {
                await loadStatsForSelectedKid();
                render();
            } catch (error) {
                showError(error.message || 'Failed to load stats.');
            }
        },
    });
}

function renderTabs() {
    const tabs = Array.isArray(statsData.tabs) ? statsData.tabs : [];
    if (!tabs.some((tab) => tab.key === activeTabKey)) {
        activeTabKey = tabs[0]?.key || 'earn';
        rememberTab(activeTabKey);
    }
    statsTabs.innerHTML = tabs.map((tab) => {
        const isActive = tab.key === activeTabKey;
        return `
            <button type="button" class="cards-view-toggle-btn ${isActive ? 'active' : ''}" role="tab" aria-selected="${isActive ? 'true' : 'false'}" data-stats-tab="${escapeHtml(tab.key)}">
                <span class="cards-view-toggle-btn-icon" data-icon="${escapeHtml(tabIconName(tab.key))}" data-icon-size="16" data-icon-stroke="2.4"></span>
                <span class="point-rule-tab-long">${escapeHtml(tab.label)}</span>
                <span class="point-rule-tab-short">${escapeHtml(tab.label.replace(/\s+rewards$/i, ''))}</span>
            </button>
        `;
    }).join('');
    hydrateIcons(statsTabs);
}

function renderTrend() {
    const tab = activeTab();
    const isRewardTab = Boolean(tab?.rewardBucket);
    const useBalance = isRewardTab && showBalance;
    statsBalanceControl?.classList.toggle('hidden', !isRewardTab);
    if (statsBalanceToggle) {
        statsBalanceToggle.checked = useBalance;
    }
    const periodLabel = granularityLabel(selectedGranularity);
    let label = `${useBalance ? 'Cumulative balance' : `${periodLabel} points`}`;
    if (isRewardTab) {
        label = `${tab.label} ${useBalance ? 'balance' : `${periodLabel.toLowerCase()} net points`}`;
    } else if (tab?.key === 'earn' || tab?.key === 'loss') {
        label = `${periodLabel} ${tab.label.toLowerCase()}`;
    }
    statsTrendSubtitle.textContent = useBalance
        ? `${tab.label} wallet balance`
        : label;
    if (statsTrendMeta) {
        statsTrendMeta.innerHTML = trendSummaryHtml(tab);
    }
    statsTrendChart.innerHTML = chartSvg(tab?.trend || [], {
        label,
        empty: 'No point events yet.',
        container: statsTrendChart,
        useBalance,
    });
}

function latestRowsHtml(item) {
    const query = itemSearch.trim().toLowerCase();
    const latest = Array.isArray(item.latest) ? item.latest : [];
    const filtered = query
        ? latest.filter((event) => {
            const note = String(event?.note || '').toLowerCase();
            const name = String(event?.rule?.name || item.name || '').toLowerCase();
            return note.includes(query) || name.includes(query);
        })
        : latest;
    if (!filtered.length) {
        return `<div class="stats-empty">${escapeHtml(query ? 'No matching events.' : 'No recent events.')}</div>`;
    }
    const visible = showAllLatestRows ? filtered : filtered.slice(0, LATEST_ROWS_DEFAULT_LIMIT);
    const showMoreHtml = filtered.length > visible.length
        ? `<button type="button" class="stats-show-more" data-stats-show-more>Show more</button>`
        : '';
    return `
        <div class="stats-latest-list" aria-label="Latest events">
            ${visible.map((event) => {
        const delta = Number.parseInt(event.pointsDelta, 10) || 0;
        const note = String(event.note || '').trim() || String(event?.rule?.name || item.name || 'Point event');
        return `
                <div class="stats-latest-row">
                    <span class="stats-latest-date">${escapeHtml(formatEventDate(event.createdAt))}</span>
                    <span class="stats-delta stats-delta--${deltaClass(delta)}">${escapeHtml(formatDelta(delta))}</span>
                    <span class="stats-latest-note">${highlightQueryHtml(note, query)}</span>
                </div>
            `;
    }).join('')}
        </div>
        ${showMoreHtml}
    `;
}

function itemSummaryHtml(item, isExpanded) {
    const total = Number.parseInt(item.totalPoints, 10) || 0;
    const recordCount = Number.parseInt(item.eventCount, 10) || 0;
    return `
        <button type="button" class="stats-item-summary" data-stats-rule-id="${escapeHtml(item.ruleId)}" aria-expanded="${isExpanded ? 'true' : 'false'}">
            <span class="activity-timeline-icon" aria-hidden="true">${ruleIconHtml(item)}</span>
            <span class="activity-timeline-main">
                <span class="activity-timeline-title">${escapeHtml(item.name || 'Point event')}</span>
                <span class="activity-timeline-note">${escapeHtml(formatPoints(total))} · ${escapeHtml(formatRecordCount(recordCount))}</span>
            </span>
            <span class="stats-sparkline" aria-hidden="true">${chartSvg(item.trend || [], { compact: true })}</span>
            <span class="stats-chevron icon" data-icon="${isExpanded ? 'chevron-up' : 'chevron-down'}" data-icon-size="17" data-icon-stroke="2.6" aria-hidden="true"></span>
        </button>
    `;
}

function renderTopItems() {
    const tab = activeTab();
    const shouldShowTopItems = Boolean(tab);
    statsTopItemsHeading?.classList.toggle('hidden', !shouldShowTopItems);
    statsTopItems?.classList.toggle('hidden', !shouldShowTopItems);
    if (!shouldShowTopItems) {
        expandedRuleId = '';
        topItemSearch = '';
        if (statsTopItemSearchInput) statsTopItemSearchInput.value = '';
        itemSearch = '';
        showAllLatestRows = false;
        if (statsTopItems) statsTopItems.innerHTML = '';
        return;
    }
    const items = Array.isArray(tab?.topItems) ? tab.topItems : [];
    const query = topItemSearch.trim().toLowerCase();
    const filteredItems = query
        ? items.filter((item) => String(item?.name || '').toLowerCase().includes(query))
        : items;
    if (!filteredItems.length) {
        statsTopItems.innerHTML = `<div class="stats-empty">${escapeHtml(query ? 'No matching events.' : 'No point events yet.')}</div>`;
        return;
    }
    if (expandedRuleId && !filteredItems.some((item) => String(item.ruleId) === expandedRuleId)) {
        expandedRuleId = '';
    }
    statsTopItems.innerHTML = filteredItems.map((item) => {
        const isExpanded = String(item.ruleId) === expandedRuleId;
        return `
            <article class="stats-item${isExpanded ? ' is-expanded' : ''}">
                ${itemSummaryHtml(item, isExpanded)}
                ${isExpanded ? `
                    <div class="stats-item-detail">
                        <div class="stats-item-chart">${chartSvg(item.trend || [], {
            label: `${item.name || 'Point event'} trend`,
            width: expandedItemChartWidth(),
        })}</div>
                        <div class="search-bar stats-search">
                            <span class="search-bar-icon icon" data-icon="search" data-icon-size="15" data-icon-stroke="2.4" aria-hidden="true"></span>
                            <input class="paradigm-search-input" type="search" autocomplete="off" value="${escapeHtml(itemSearch)}" placeholder="Search notes..." data-stats-item-search>
                        </div>
                        ${latestRowsHtml(item)}
                    </div>
                ` : ''}
            </article>
        `;
    }).join('');
    window.SearchBar?.enhanceAll?.(statsTopItems);
    hydrateIcons(statsTopItems);
}

function render() {
    renderKids();
    renderTabs();
    renderTrend();
    renderTopItems();
    hydrateIcons(document);
}

async function fetchStatsForGranularity(granularity) {
    const requestedGranularity = normalizeGranularity(granularity);
    const query = new URLSearchParams({ granularity: requestedGranularity });
    const data = await fetchJson(`${API_BASE}/kids/${encodeURIComponent(selectedKidId)}/stats?${query.toString()}`);
    return {
        data,
        granularity: normalizeGranularity(data.granularity || requestedGranularity),
    };
}

async function loadStatsForSelectedKid(granularity = DEFAULT_STATS_GRANULARITY) {
    if (!selectedKidId) {
        statsData = { tabs: [] };
        return;
    }
    const requestId = ++statsLoadRequestId;
    const result = await fetchStatsForGranularity(granularity);
    if (requestId !== statsLoadRequestId) {
        return false;
    }
    statsData = result?.data || { tabs: [] };
    selectedGranularity = normalizeGranularity(result?.granularity || granularity);
    syncGranularityControl();
    return true;
}

async function loadInitialData() {
    showError('');
    kids = await fetchJson(`${API_BASE}/kids?view=reward_nav`);
    kids = Array.isArray(kids) ? kids : [];
    selectedKidId = initialKidId();
    syncSelectedKidNavigation();
    await loadStatsForSelectedKid();
    render();
}

statsTabs?.addEventListener('click', (event) => {
    const button = event.target.closest('[data-stats-tab]');
    if (!button) return;
    const nextTab = String(button.dataset.statsTab || '').trim();
    if (!nextTab || nextTab === activeTabKey) return;
    activeTabKey = nextTab;
    rememberTab(activeTabKey);
    expandedRuleId = '';
    topItemSearch = '';
    if (statsTopItemSearchInput) statsTopItemSearchInput.value = '';
    itemSearch = '';
    showAllLatestRows = false;
    render();
});

statsBalanceToggle?.addEventListener('change', () => {
    showBalance = Boolean(statsBalanceToggle.checked);
    renderTrend();
});

statsTopItemSearchInput?.addEventListener('input', () => {
    topItemSearch = String(statsTopItemSearchInput.value || '');
    expandedRuleId = '';
    itemSearch = '';
    showAllLatestRows = false;
    renderTopItems();
});

statsPeriodControls?.addEventListener('click', async (event) => {
    const button = event.target.closest('[data-stats-granularity]');
    if (!button) return;
    const nextGranularity = normalizeGranularity(button.dataset.statsGranularity);
    if (nextGranularity === selectedGranularity) return;
    expandedRuleId = '';
    topItemSearch = '';
    if (statsTopItemSearchInput) statsTopItemSearchInput.value = '';
    itemSearch = '';
    showAllLatestRows = false;
    showError('');
    try {
        const applied = await loadStatsForSelectedKid(nextGranularity);
        if (!applied) return;
        render();
    } catch (error) {
        syncGranularityControl();
        showError(error.message || 'Failed to load stats.');
    }
});

statsTopItems?.addEventListener('click', (event) => {
    const showMoreButton = event.target.closest('[data-stats-show-more]');
    if (showMoreButton) {
        showAllLatestRows = true;
        renderTopItems();
        return;
    }
    const button = event.target.closest('[data-stats-rule-id]');
    if (!button) return;
    const nextRuleId = String(button.dataset.statsRuleId || '').trim();
    expandedRuleId = nextRuleId === expandedRuleId ? '' : nextRuleId;
    itemSearch = '';
    showAllLatestRows = false;
    renderTopItems();
});

statsTopItems?.addEventListener('input', (event) => {
    const input = event.target.closest('[data-stats-item-search]');
    if (!input) return;
    itemSearch = String(input.value || '');
    showAllLatestRows = false;
    renderTopItems();
    const nextInput = statsTopItems.querySelector('[data-stats-item-search]');
    if (nextInput) {
        nextInput.focus();
        nextInput.setSelectionRange(itemSearch.length, itemSearch.length);
    }
});

window.addEventListener('resize', () => {
    if (statsResizeTimer) {
        window.clearTimeout(statsResizeTimer);
    }
    statsResizeTimer = window.setTimeout(() => {
        statsResizeTimer = 0;
        renderTrend();
        renderTopItems();
    }, 120);
});

document.addEventListener('DOMContentLoaded', async () => {
    hydrateIcons(document);
    try {
        await loadInitialData();
    } catch (error) {
        showError(error.message || 'Failed to load stats.');
        render();
    }
});
