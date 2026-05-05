// Shared histogram-distribution helpers.
// Used by kid-card-manage-stats.js (per-card distributions) and
// kid-session-report.js (per-answer response-time distribution).
// Loaded as a plain script — exposes globals so consumers don't need ES modules.

const HISTOGRAM_BUCKET_COUNT = 7;

function buildHistogramDistribution(options = {}) {
    const cards = Array.isArray(options?.cards) ? options.cards : [];
    const getValue = typeof options?.getValue === 'function' ? options.getValue : () => null;
    const formatValue = typeof options?.formatValue === 'function' ? options.formatValue : (v) => String(v);
    const bucketing = options?.bucketing || {};
    const values = [];
    const rated = [];
    for (const card of cards) {
        const value = Number(getValue(card));
        if (Number.isFinite(value)) {
            values.push(value);
            rated.push({ card, value });
        }
    }
    const bucketDefinitions = buildDynamicBuckets(values, bucketing);
    if (!values.length || !bucketDefinitions.length) {
        return {
            title: String(options?.title || ''),
            tone: String(options?.tone || ''),
            emptyMessage: 'No practiced-card data yet.',
        };
    }
    const bars = buildHistogramBars(values, bucketDefinitions);
    const maxValue = Math.max(...values);
    const percentiles = buildHistogramPercentiles(values, bars, maxValue, options?.formatValue, options?.percentileMarkers);
    const yAxis = buildHistogramCountAxis(Math.max(...bars.map((bar) => Number(bar?.count) || 0), 0));
    const getCardCapsuleLabel = typeof options?.getCardCapsuleLabel === 'function'
        ? options.getCardCapsuleLabel
        : (card) => String(card?.front || '').trim();
    const rawSelectedIndex = Number(options?.selectedBucketIndex);
    const hasSelection = Number.isInteger(rawSelectedIndex)
        && rawSelectedIndex >= 0
        && rawSelectedIndex < bucketDefinitions.length;
    const selectedBucket = hasSelection ? bucketDefinitions[rawSelectedIndex] : null;
    const filteredRated = hasSelection
        ? rated.filter(({ value }) => findHistogramBucket(value, bucketDefinitions) === selectedBucket)
        : rated;
    const topLists = buildTopCardLists(filteredRated, options?.topLists, formatValue, getCardCapsuleLabel);
    return {
        panelKey: String(options?.panelKey || ''),
        title: String(options?.title || ''),
        tone: String(options?.tone || ''),
        yAxisLabel: 'Cards',
        bars,
        percentiles,
        yMax: yAxis.max,
        tickValues: yAxis.ticks,
        topLists,
        selectedBucketIndex: hasSelection ? rawSelectedIndex : null,
        selectedBucketLabel: hasSelection ? String(selectedBucket?.label || '') : '',
        filteredCount: filteredRated.length,
    };
}

function buildDynamicBuckets(values, bucketing = {}) {
    if (!Array.isArray(values) || !values.length) return [];
    const formatRange = typeof bucketing?.formatRange === 'function'
        ? bucketing.formatRange
        : (min, max) => `${min}–${max}`;
    const snapUnit = Math.max(1e-9, Number(bucketing?.snapUnit) || 1);
    const isInteger = !!bucketing?.isInteger;
    const minClamp = Number.isFinite(bucketing?.minClamp) ? Number(bucketing.minClamp) : -Infinity;
    const maxClamp = Number.isFinite(bucketing?.maxClamp) ? Number(bucketing.maxClamp) : Infinity;
    const bucketCount = Math.max(1, Number.parseInt(bucketing?.bucketCount, 10) || HISTOGRAM_BUCKET_COUNT);
    const dataMin = Math.min(...values);
    const dataMax = Math.max(...values);
    if (dataMin === dataMax) {
        return [{ min: dataMin, max: dataMax, label: formatRange(dataMin, dataMax) }];
    }
    const range = dataMax - dataMin;
    const step = Math.max(snapUnit, Math.ceil(range / bucketCount / snapUnit) * snapUnit);
    const totalWidth = step * bucketCount;
    const overflow = totalWidth - range;
    const anchorLo = String(bucketing?.anchorLo || '').toLowerCase();
    let lo = anchorLo === 'datamin'
        ? Math.floor(dataMin / snapUnit) * snapUnit
        : Math.floor((dataMin - overflow / 2) / snapUnit) * snapUnit;
    if (lo < minClamp) {
        lo = Math.ceil(minClamp / snapUnit) * snapUnit;
    }
    if (lo + totalWidth > maxClamp) {
        const cappedLo = Math.floor((maxClamp - totalWidth) / snapUnit) * snapUnit;
        lo = Math.max(Math.ceil(minClamp / snapUnit) * snapUnit, cappedLo);
    }
    const buckets = [];
    for (let i = 0; i < bucketCount; i++) {
        const bMin = lo + (i * step);
        const bMaxExclusive = bMin + step;
        const bucketMax = isInteger ? bMaxExclusive - 1 : bMaxExclusive;
        buckets.push({ min: bMin, max: bucketMax, label: formatRange(bMin, bucketMax) });
    }
    return buckets;
}

function buildHistogramBars(values, bucketDefinitions) {
    const bars = bucketDefinitions.map((definition) => ({
        label: String(definition?.label || ''),
        min: Number(definition?.min) || 0,
        max: Number.isFinite(definition?.max) ? Number(definition.max) : null,
        count: 0,
    }));
    for (const value of values) {
        const bar = findHistogramBucket(value, bars);
        if (bar) bar.count += 1;
    }
    return bars;
}

function buildHistogramPercentiles(values, bucketDefinitions, observedMax, formatValue, percentileMarkers) {
    const sortedValues = values.slice().sort((a, b) => a - b);
    const formatter = typeof formatValue === 'function' ? formatValue : (value) => String(value);
    const requested = Array.isArray(percentileMarkers) && percentileMarkers.length ? percentileMarkers : [50, 90];
    const markers = requested.map((percentile) => ({
        percentile,
        label: `P${percentile}`,
        className: `p${percentile}`,
    }));
    const groups = [];
    for (const marker of markers) {
        const value = getPercentileValue(sortedValues, marker.percentile);
        const valueLabel = formatter(value);
        const last = groups[groups.length - 1];
        if (last && last.valueLabel === valueLabel) {
            last.labels.push(marker.label);
            last.classNames.push(marker.className);
            continue;
        }
        groups.push({
            value,
            valueLabel,
            positionPct: getHistogramMarkerPositionPct(value, bucketDefinitions, observedMax),
            labels: [marker.label],
            classNames: [marker.className],
        });
    }
    return groups.map((group) => ({
        label: group.labels.join(' · '),
        className: group.classNames.join(' '),
        valueLabel: group.valueLabel,
        positionPct: group.positionPct,
    }));
}

function buildHistogramCountAxis(maxCount) {
    const safeMax = Math.max(1, Number(maxCount) || 0);
    const step = getNiceHistogramStep(safeMax / 4);
    const axisMax = Math.max(step, Math.ceil(safeMax / step) * step);
    const ticks = [];
    for (let value = 0; value <= axisMax; value += step) ticks.push(value);
    return { max: axisMax, ticks };
}

function getNiceHistogramStep(rawStep) {
    const value = Math.max(1, Number(rawStep) || 1);
    const magnitude = 10 ** Math.floor(Math.log10(value));
    const normalized = value / magnitude;
    if (normalized <= 1) return magnitude;
    if (normalized <= 2) return 2 * magnitude;
    if (normalized <= 5) return 5 * magnitude;
    return 10 * magnitude;
}

function getHistogramVerticalPositionPct(value, maxValue) {
    if (!Number.isFinite(value) || !Number.isFinite(maxValue) || maxValue <= 0) return 0;
    return (value / maxValue) * 100;
}

function findHistogramBucket(value, bucketDefinitions) {
    const list = Array.isArray(bucketDefinitions) ? bucketDefinitions : [];
    for (const bucket of list) {
        const min = Number(bucket?.min) || 0;
        const max = Number.isFinite(bucket?.max) ? Number(bucket.max) : null;
        if (value < min) continue;
        if (max === null || value <= max) return bucket;
    }
    return list[list.length - 1] || null;
}

function getHistogramMarkerPositionPct(value, bucketDefinitions, observedMax) {
    const buckets = Array.isArray(bucketDefinitions) ? bucketDefinitions : [];
    if (!buckets.length || !Number.isFinite(value)) return 50;
    const bucketIndex = Math.max(0, buckets.findIndex((bucket) => findHistogramBucket(value, buckets) === bucket));
    const bucket = buckets[bucketIndex] || buckets[0];
    const min = Number(bucket?.min) || 0;
    const rawMax = Number.isFinite(bucket?.max) ? Number(bucket.max) : Math.max(observedMax, min);
    const max = rawMax > min ? rawMax : min;
    const range = max - min;
    const fraction = range > 0 ? (value - min) / range : 0.5;
    const slotInset = 0.12;
    const slotWidth = 1 / buckets.length;
    const normalized = (bucketIndex + slotInset + (Math.max(0, Math.min(1, fraction)) * (1 - (slotInset * 2)))) * slotWidth;
    return normalized * 100;
}

function getPercentileValue(sortedValues, percentile) {
    const list = Array.isArray(sortedValues) ? sortedValues : [];
    if (!list.length) return 0;
    if (list.length === 1) return list[0];
    const clamped = Math.max(0, Math.min(100, Number(percentile) || 0));
    const index = (clamped / 100) * (list.length - 1);
    const lowerIndex = Math.floor(index);
    const upperIndex = Math.ceil(index);
    const lowerValue = list[lowerIndex];
    const upperValue = list[upperIndex];
    if (lowerIndex === upperIndex) return lowerValue;
    const weight = index - lowerIndex;
    return lowerValue + ((upperValue - lowerValue) * weight);
}

function buildTopCardLists(rated, configs, formatValue, getCardCapsuleLabel) {
    const lists = Array.isArray(configs) ? configs : [];
    if (!lists.length || !Array.isArray(rated) || !rated.length) return [];
    const labelOf = typeof getCardCapsuleLabel === 'function'
        ? getCardCapsuleLabel
        : (card) => String(card?.front || '').trim();
    const ascending = rated.slice().sort((a, b) => a.value - b.value);
    return lists.map((cfg) => {
        const count = Math.max(1, Number(cfg?.count) || 5);
        const slice = cfg?.mode === 'highest'
            ? ascending.slice(-count).reverse()
            : ascending.slice(0, count);
        return {
            title: String(cfg?.title || ''),
            entries: slice.map((entry) => ({
                cardId: Number(entry.card?.id) || 0,
                front: String(labelOf(entry.card) || '').trim() || '—',
                valueLabel: formatValue(entry.value),
            })),
        };
    });
}

function formatIntegerCaptureRange(min, max) {
    const lo = Math.ceil(min);
    const hi = Math.floor(max);
    if (lo > hi) return `${Math.round(min)}–${Math.round(max)}`;
    return lo === hi ? String(lo) : `${lo}–${hi}`;
}

function formatCompactCountLabel(value) {
    const num = Number(value);
    if (!Number.isFinite(num)) return '';
    if (Math.abs(num) >= 1000) {
        const compact = Math.round((num / 1000) * 10) / 10;
        return `${trimTrailingZeros(compact.toFixed(1))}k`;
    }
    return String(Math.round(num));
}

function formatPercentLabel(value) {
    if (!Number.isFinite(value)) return '';
    const rounded = Math.round(value * 10) / 10;
    return `${Number.isInteger(rounded) ? rounded.toFixed(0) : rounded.toFixed(1)}%`;
}

function formatCountLabel(value) {
    if (!Number.isFinite(value)) return '';
    return String(Math.round(value));
}

function formatSpeedLabel(value) {
    if (!Number.isFinite(value) || value <= 0) return '';
    const seconds = value / 1000;
    if (seconds >= 10) return `${Math.round(seconds)}s`;
    if (seconds >= 1) return `${trimTrailingZeros(seconds.toFixed(1))}s`;
    return `${trimTrailingZeros(seconds.toFixed(2))}s`;
}

function formatDaysLabel(value) {
    const days = Number(value);
    if (!Number.isFinite(days)) return '–';
    return `${Math.max(0, Math.round(days))}d`;
}

function trimTrailingZeros(text) {
    return String(text || '').replace(/\.0+$/, '').replace(/(\.\d*?)0+$/, '$1');
}

function formatBoundaryNumber(value) {
    if (!Number.isFinite(value)) return '';
    if (Number.isInteger(value)) return String(value);
    return trimTrailingZeros(value.toFixed(1));
}

function formatBoundarySeconds(ms) {
    if (!Number.isFinite(ms)) return '';
    const seconds = ms / 1000;
    if (Number.isInteger(seconds)) return String(seconds);
    return trimTrailingZeros(seconds.toFixed(1));
}

function renderDistributionPanel(panel) {
    const bars = Array.isArray(panel?.bars) ? panel.bars : [];
    const percentiles = Array.isArray(panel?.percentiles) ? panel.percentiles : [];
    const toneClass = String(panel?.tone || '').trim();
    const tickValues = Array.isArray(panel?.tickValues) ? panel.tickValues : [];
    const yMax = Number(panel?.yMax) || 0;
    const panelKey = String(panel?.panelKey || '').trim();
    if (!bars.length || panel?.emptyMessage) {
        return `
            <div class="cards-distribution-card">
                <div class="cards-distribution-card-head">
                    <div class="cards-distribution-card-title">${escapeHtml(String(panel?.title || ''))}</div>
                </div>
                <div class="cards-view-placeholder">${escapeHtml(String(panel?.emptyMessage || 'No data yet.'))}</div>
            </div>
        `;
    }
    const topLists = Array.isArray(panel?.topLists) ? panel.topLists : [];
    const selectedBucketIndex = Number.isInteger(panel?.selectedBucketIndex) ? panel.selectedBucketIndex : null;
    const selectedBucketLabel = String(panel?.selectedBucketLabel || '').trim();
    const filterChip = selectedBucketIndex !== null
        ? `<button type="button" class="cards-distribution-filter-chip" data-clear-bucket="${escapeHtml(panelKey)}" title="Clear bucket filter">
                <span class="cards-distribution-filter-chip-label">Filter: ${escapeHtml(selectedBucketLabel)}</span>
                <span class="cards-distribution-filter-chip-x" aria-hidden="true">×</span>
            </button>`
        : '';
    return `
        <div class="cards-distribution-card" data-panel-key="${escapeHtml(panelKey)}">
            <div class="cards-distribution-card-head">
                <div class="cards-distribution-card-title">${escapeHtml(String(panel?.title || ''))}</div>
                ${filterChip}
            </div>
            <div class="cards-distribution-body">
                <div class="cards-distribution-chart">
                    <div class="cards-distribution-y-label">${escapeHtml(String(panel?.yAxisLabel || 'Cards'))}</div>
                    <div class="cards-distribution-y-axis">
                        ${tickValues.map((tickValue) => `
                            <div class="cards-distribution-y-tick" style="bottom:${getHistogramVerticalPositionPct(tickValue, yMax).toFixed(2)}%">
                                ${escapeHtml(formatCompactCountLabel(tickValue))}
                            </div>
                        `).join('')}
                    </div>
                    <div class="cards-distribution-grid-layer">
                        ${tickValues.map((tickValue) => `
                            <div class="cards-distribution-grid-line" style="bottom:${getHistogramVerticalPositionPct(tickValue, yMax).toFixed(2)}%"></div>
                        `).join('')}
                    </div>
                    <div class="cards-distribution-marker-layer">
                        ${percentiles.map((marker) => `
                            <div class="cards-distribution-marker ${escapeHtml(String(marker?.className || ''))}" style="left:${Math.max(0, Math.min(100, Number(marker?.positionPct) || 0)).toFixed(2)}%">
                                <div class="cards-distribution-marker-badge">
                                    <div class="cards-distribution-marker-name">${escapeHtml(String(marker?.label || ''))}</div>
                                    <div class="cards-distribution-marker-value">${escapeHtml(String(marker?.valueLabel || ''))}</div>
                                </div>
                                <div class="cards-distribution-marker-line"></div>
                            </div>
                        `).join('')}
                    </div>
                    <div class="cards-distribution-bars" style="grid-template-columns: repeat(${bars.length}, minmax(0, 1fr));">
                        ${bars.map((bar, index) => {
                            const count = Math.max(0, Number(bar?.count) || 0);
                            const heightPct = yMax > 0 ? (count / yMax) * 100 : 0;
                            const isSelected = selectedBucketIndex === index;
                            const isDimmed = selectedBucketIndex !== null && !isSelected;
                            return `
                                <div class="cards-distribution-bar-slot${isSelected ? ' is-selected' : ''}${isDimmed ? ' is-dimmed' : ''}" role="button" tabindex="0" data-panel-key="${escapeHtml(panelKey)}" data-bucket-index="${index}" aria-pressed="${isSelected ? 'true' : 'false'}" title="Filter by ${escapeHtml(String(bar?.label || ''))}">
                                    <div class="cards-distribution-bar-stack">
                                        <div class="cards-distribution-bar-count">${escapeHtml(formatCompactCountLabel(count))}</div>
                                        <div class="cards-distribution-bar ${escapeHtml(toneClass)}" style="height:${Math.max(0, Math.min(100, heightPct)).toFixed(2)}%"></div>
                                    </div>
                                    <div class="cards-distribution-bar-label">${escapeHtml(String(bar?.label || ''))}</div>
                                </div>
                            `;
                        }).join('')}
                    </div>
                    <div class="cards-distribution-baseline"></div>
                </div>
                ${topLists.length ? `
                    <div class="cards-distribution-sidebar">
                        ${topLists.map((list) => {
                            const entries = Array.isArray(list?.entries) ? list.entries : [];
                            return `
                            <div class="cards-distribution-toplist">
                                <div class="cards-distribution-toplist-title">${escapeHtml(String(list?.title || ''))}${selectedBucketIndex !== null ? ' <span class="cards-distribution-toplist-scope">(in bucket)</span>' : ''}</div>
                                ${entries.length ? `
                                    <ol class="cards-distribution-toplist-items">
                                        ${entries.map((entry) => `
                                            <li class="cards-distribution-toplist-row">
                                                <span class="cards-distribution-toplist-item">
                                                    <span class="cards-distribution-toplist-front">${escapeHtml(String(entry?.front || ''))}</span>
                                                    <span class="cards-distribution-toplist-value">${escapeHtml(String(entry?.valueLabel || ''))}</span>
                                                </span>
                                            </li>
                                        `).join('')}
                                    </ol>
                                ` : '<div class="cards-distribution-toplist-empty">No cards in this bucket.</div>'}
                            </div>
                        `;
                        }).join('')}
                    </div>
                ` : ''}
            </div>
        </div>
    `;
}
