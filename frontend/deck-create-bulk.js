const API_BASE = `${window.location.origin}/api`;

const firstTagToggle = document.getElementById('firstTagToggle');
const categoryPreselectNote = document.getElementById('categoryPreselectNote');
const bulkDeckInput = document.getElementById('bulkDeckInput');
const bulkInputSectionTitle = document.getElementById('bulkInputSectionTitle');
const bulkInputHelpText = document.getElementById('bulkInputHelpText');
const previewBtn = document.getElementById('previewBtn');
const clearInputBtn = document.getElementById('clearInputBtn');
const reviewSection = document.getElementById('reviewSection');
const reviewMeta = document.getElementById('reviewMeta');
const reviewTableBody = document.getElementById('reviewTableBody');
const createDecksBtn = document.getElementById('createDecksBtn');
const successMessage = document.getElementById('successMessage');
const errorMessage = document.getElementById('errorMessage');
const deckCategoryCommon = window.DeckCategoryCommon;
const deckCreateCommon = window.DeckCreateCommon;
if (!deckCategoryCommon) {
    throw new Error('deck-category-common.js is required for deck-create-bulk');
}
if (!deckCreateCommon) {
    throw new Error('deck-create-common.js is required for deck-create-bulk');
}

const normalizeTag = deckCreateCommon.normalizeTag;
const parseTagInput = deckCreateCommon.parseTagInput;
const formatTagPayload = deckCreateCommon.formatTagPayload;
const showError = (message) => deckCreateCommon.showMessage(errorMessage, message);
const showSuccess = (message) => deckCreateCommon.showMessage(successMessage, message);

let currentFirstTag = '';
let previewDecks = [];
let isCreatingDecks = false;
let deckCategories = [];
let deckCategoryKeySet = new Set();
let deckCountByCategoryKey = {};
const createUrlParams = new URLSearchParams(window.location.search);
let lockedFirstTagFromQuery = normalizeTag(createUrlParams.get('categoryKey'));

document.addEventListener('DOMContentLoaded', async () => {
    const allowed = await deckCreateCommon.ensureSuperFamily(API_BASE);
    if (!allowed) {
        return;
    }
    const categoriesLoaded = await loadDeckCategories();
    if (!categoriesLoaded) {
        return;
    }
    await loadDeckTagCountsByCategory();
    renderFirstTagToggle();
    updateInputModeUi();
});

if (firstTagToggle) {
    firstTagToggle.addEventListener('click', (event) => {
        if (lockedFirstTagFromQuery) {
            return;
        }
        const target = event.target.closest('[data-first-tag]');
        if (!target) {
            return;
        }
        event.preventDefault();
        setCurrentFirstTag(target.getAttribute('data-first-tag'));
    });
}

if (previewBtn) {
    previewBtn.addEventListener('click', async () => {
        await previewBulkCreate();
    });
}

if (clearInputBtn) {
    clearInputBtn.addEventListener('click', () => {
        bulkDeckInput.value = '';
        resetPreviewState();
        bulkDeckInput.focus();
    });
}

if (createDecksBtn) {
    createDecksBtn.addEventListener('click', async () => {
        await createDecks();
    });
}

function setControlsDisabled(disabled) {
    deckCreateCommon.setControlsDisabled(disabled, {
        bulkDeckInput: { element: bulkDeckInput },
        previewBtn: { element: previewBtn },
        clearInputBtn: { element: clearInputBtn },
        createDecksBtn: { element: createDecksBtn, busyGuard: () => isCreatingDecks },
    });
}

function getCurrentDeckCategory() {
    return deckCreateCommon.getCurrentDeckCategory(currentFirstTag, deckCategories);
}

async function loadDeckCategories() {
    showError('');
    try {
        const loaded = await deckCreateCommon.loadDeckCategories({
            apiBase: API_BASE,
            selectedCategoryKey: lockedFirstTagFromQuery || currentFirstTag,
        });
        deckCategories = loaded.categories;
        deckCategoryKeySet = loaded.categoryKeySet;
        currentFirstTag = loaded.selectedCategoryKey;
        if (lockedFirstTagFromQuery && currentFirstTag !== lockedFirstTagFromQuery) {
            lockedFirstTagFromQuery = '';
        }
        setControlsDisabled(false);
        return true;
    } catch (error) {
        console.error('Error loading deck categories:', error);
        deckCategories = [];
        deckCategoryKeySet = new Set();
        currentFirstTag = '';
        if (firstTagToggle) {
            firstTagToggle.innerHTML = '<span class="settings-note">No categories available.</span>';
        }
        setControlsDisabled(true);
        showError(error.message || 'Failed to load deck categories.');
        return false;
    }
}

async function loadDeckTagCountsByCategory() {
    try {
        const response = await fetch(`${API_BASE}/shared-decks/tags`);
        const result = await response.json().catch(() => ({}));
        if (!response.ok) {
            throw new Error(result.error || `Failed to load tags (HTTP ${response.status})`);
        }
        const tagPaths = Array.isArray(result.tag_paths)
            ? result.tag_paths
                .map((path) => Array.isArray(path) ? path.map((tag) => normalizeTag(tag)).filter(Boolean) : [])
                .filter((path) => path.length > 0)
            : [];
        const nextCountByCategory = {};
        tagPaths.forEach((path) => {
            const first = normalizeTag(path[0]);
            if (!first) {
                return;
            }
            nextCountByCategory[first] = Number(nextCountByCategory[first] || 0) + 1;
        });
        deckCountByCategoryKey = nextCountByCategory;
    } catch (error) {
        console.error('Error loading deck counts by category:', error);
        deckCountByCategoryKey = {};
    }
}

function normalizeTagList(tags) {
    const out = [];
    const seen = new Set();
    (Array.isArray(tags) ? tags : []).forEach((raw) => {
        const tag = normalizeTag(raw);
        if (!tag || seen.has(tag)) {
            return;
        }
        seen.add(tag);
        out.push(tag);
    });
    return out;
}

function buildDeckTags(firstTag, extraTags) {
    const first = normalizeTag(firstTag);
    const tags = [first];
    const seen = new Set(tags);
    normalizeTagList(extraTags).forEach((tag) => {
        if (seen.has(tag)) {
            return;
        }
        seen.add(tag);
        tags.push(tag);
    });
    return tags;
}

function renderFirstTagToggle() {
    if (!firstTagToggle) {
        return;
    }
    deckCreateCommon.renderFirstTagToggle({
        containerEl: firstTagToggle,
        categories: deckCategories,
        selectedCategoryKey: currentFirstTag,
        getDeckCount: (categoryKey) => deckCreateCommon.getDeckCountForCategory(categoryKey, deckCountByCategoryKey),
    });
    applyFirstTagLockMode();
}

function applyFirstTagLockMode() {
    if (!firstTagToggle) {
        return;
    }
    const isLocked = Boolean(lockedFirstTagFromQuery && currentFirstTag === lockedFirstTagFromQuery);
    firstTagToggle.classList.toggle('category-locked', isLocked);
    const options = firstTagToggle.querySelectorAll('.first-tag-option');
    options.forEach((button) => {
        const optionKey = normalizeTag(button.getAttribute('data-first-tag'));
        const isActive = optionKey === currentFirstTag;
        button.classList.toggle('lock-hidden', isLocked && !isActive);
        button.disabled = Boolean(isLocked && isActive);
        button.setAttribute('aria-disabled', button.disabled ? 'true' : 'false');
    });
    if (categoryPreselectNote) {
        if (isLocked) {
            categoryPreselectNote.textContent = 'Category preselected from Manage Decks.';
            categoryPreselectNote.classList.remove('hidden');
        } else {
            categoryPreselectNote.textContent = '';
            categoryPreselectNote.classList.add('hidden');
        }
    }
}

function setCurrentFirstTag(tag) {
    if (lockedFirstTagFromQuery) {
        return;
    }
    const next = deckCreateCommon.normalizeNextFirstTag(tag, currentFirstTag, deckCategoryKeySet);
    if (!next) {
        return;
    }
    currentFirstTag = next;
    renderFirstTagToggle();
    updateInputModeUi();
    resetPreviewState();
}

if (bulkDeckInput) {
    bulkDeckInput.addEventListener('input', () => {
        resetPreviewState();
    });
}

function parseCardLine(rawLine, lineNo) {
    const line = String(rawLine || '').trim();
    const commaIndex = line.indexOf(',');
    if (commaIndex <= 0 || commaIndex >= line.length - 1) {
        throw new Error(`Line ${lineNo}: card row must be "front,back".`);
    }
    const front = line.slice(0, commaIndex).trim();
    const back = line.slice(commaIndex + 1).trim();
    if (!front || !back) {
        throw new Error(`Line ${lineNo}: front/back must both be non-empty.`);
    }
    return { front, back, line: lineNo };
}

function isChineseCharactersDeckMode() {
    return deckCreateCommon.isChineseCharactersDeckMode(getCurrentDeckCategory());
}

function isChineseWritingDeckMode() {
    return deckCreateCommon.isChineseWritingDeckMode(getCurrentDeckCategory());
}

function isTypeIIDeckMode() {
    return deckCreateCommon.isTypeIIDeckMode(getCurrentDeckCategory());
}

function updateInputModeUi() {
    if (!bulkDeckInput) {
        return;
    }
    if (isChineseCharactersDeckMode()) {
        if (bulkInputSectionTitle) {
            bulkInputSectionTitle.textContent = '2) Paste Deck Blocks (Chinese Text)';
        }
        if (bulkInputHelpText) {
            bulkInputHelpText.innerHTML = 'Format per block: first line is <code>remaining_tag</code> (underscore-separated parts become multiple tags). Each part may be <code>tag</code> or <code>tag(comment)</code> (for example <code>ma3(马立平3年级)_week1</code>). Comments do not affect deck-name generation. Then paste Chinese text lines only. The system auto-extracts Chinese characters as <code>front</code> and auto-generates pinyin as <code>back</code>. Separate blocks with a blank line.';
        }
        bulkDeckInput.placeholder = 'ma3(马立平3年级)_book1_week1\n春眠不觉晓，处处闻啼鸟。\n夜来风雨声，花落知多少。\n\nma3(马立平3年级)_book1_week2\n床前明月光，疑是地上霜。';
        return;
    }
    if (bulkInputSectionTitle) {
        bulkInputSectionTitle.textContent = '2) Paste Deck Blocks';
    }
    if (bulkInputHelpText) {
        bulkInputHelpText.innerHTML = 'Format per block: first line is <code>remaining_tag</code> (underscore-separated parts become multiple tags). Each part may be <code>tag</code> or <code>tag(comment)</code> (for example <code>ma3(马立平3年级)_week1</code>). Comments do not affect deck-name generation. Then card rows as <code>front,back</code> (spaces around <code>front</code>/<code>back</code> are automatically trimmed). Separate blocks with a blank line.';
    }
    bulkDeckInput.placeholder = 'ma3(马立平3年级)_unit1\n1+1,2\n2+3,5\n\nma3(马立平3年级)_unit2\n3+4,7\n5+1,6';
}

function parseChineseCharactersFromLine(rawLine, lineNo) {
    const line = String(rawLine || '');
    const chars = line.match(/\p{Script=Han}/gu);
    if (!chars) {
        return [];
    }
    return chars.map((char) => ({ front: String(char), back: '', line: lineNo }));
}

function isLikelyRemainingTagLine(rawLine) {
    const raw = String(rawLine || '').trim();
    if (!raw || raw.includes(',') || /\p{Script=Han}/u.test(raw)) {
        return false;
    }
    return parseRemainingTagParts(raw, { strict: false }).length > 0;
}

function dedupeCards(cards) {
    const dedupeKey = isTypeIIDeckMode() ? 'back' : 'front';
    const firstByKey = new Map();
    cards.forEach((card) => {
        const key = String(card[dedupeKey] || '');
        if (!firstByKey.has(key)) {
            firstByKey.set(key, card);
        }
    });
    return Array.from(firstByKey.values()).map((card) => ({ front: card.front, back: card.back }));
}

function splitRawTagPath(rawLine) {
    const text = String(rawLine || '').trim();
    if (!text) {
        return [];
    }
    const out = [];
    let current = '';
    let depth = 0;
    for (const ch of text) {
        if (ch === '(') {
            depth += 1;
            current += ch;
            continue;
        }
        if (ch === ')') {
            if (depth > 0) {
                depth -= 1;
            }
            current += ch;
            continue;
        }
        if (ch === '_' && depth === 0) {
            out.push(current);
            current = '';
            continue;
        }
        current += ch;
    }
    out.push(current);
    return out.map((part) => String(part || '').trim()).filter(Boolean);
}

function parseRemainingTagParts(rawLine, { strict = true } = {}) {
    const parts = splitRawTagPath(rawLine);
    if (parts.length === 0) {
        return [];
    }
    const parsed = parts.map((part) => parseTagInput(part));
    const allValid = parsed.every((item) => Boolean(item.tag));
    if (!allValid) {
        if (!strict) {
            return [];
        }
        throw new Error('invalid remaining tag');
    }
    return parsed;
}

function parseDeckBlocks(rawText) {
    const lines = String(rawText || '').split(/\r\n|\r|\n/);
    const blocks = [];
    let i = 0;

    while (i < lines.length) {
        while (i < lines.length && String(lines[i] || '').trim().length === 0) {
            i += 1;
        }
        if (i >= lines.length) {
            break;
        }

        const tagLineNo = i + 1;
        const headerRaw = String(lines[i] || '').trim();
        i += 1;
        if (!headerRaw) {
            continue;
        }
        if (headerRaw.includes(',')) {
            throw new Error(`Line ${tagLineNo}: expected remaining tag only (no comma).`);
        }

        let remainingTagPartsParsed = [];
        try {
            remainingTagPartsParsed = parseRemainingTagParts(headerRaw, { strict: true });
        } catch (_) {
            throw new Error(`Line ${tagLineNo}: invalid remaining tag.`);
        }
        const remainingTagParts = remainingTagPartsParsed.map((item) => item.tag);
        if (remainingTagParts.length === 0) {
            throw new Error(`Line ${tagLineNo}: invalid remaining tag.`);
        }
        const remainingTag = remainingTagParts.join('_');

        const rows = [];
        while (i < lines.length) {
            const rowRaw = String(lines[i] || '');
            const rowText = rowRaw.trim();
            if (!rowText) {
                i += 1;
                if (rows.length > 0) {
                    break;
                }
                continue;
            }

            if (isChineseCharactersDeckMode()) {
                const parsedCards = parseChineseCharactersFromLine(rowRaw, i + 1);
                if (parsedCards.length > 0) {
                    rows.push(...parsedCards);
                    i += 1;
                    continue;
                }
                if (rows.length > 0 && isLikelyRemainingTagLine(rowText)) {
                    break;
                }
                i += 1;
                continue;
            }

            if (!rowText.includes(',')) {
                if (rows.length === 0) {
                    throw new Error(`Line ${i + 1}: expected card row as "front,back" after deck tag "${remainingTag}".`);
                }
                break;
            }

            rows.push(parseCardLine(rowText, i + 1));
            i += 1;
        }

        if (rows.length === 0) {
            throw new Error(`Deck "${remainingTag}" has no card rows.`);
        }

        blocks.push({
            blockIndex: blocks.length + 1,
            remainingTag,
            remainingTagParts,
            remainingTagPartsPayload: remainingTagPartsParsed.map((item) => formatTagPayload(item)),
            tagLine: tagLineNo,
            parsedRowCount: rows.length,
            cards: dedupeCards(rows),
            statusCode: 'pending',
            statusText: '',
        });
    }

    if (blocks.length === 0) {
        throw new Error('No deck blocks parsed.');
    }
    return blocks;
}

async function enrichChineseCharactersBacks(blocks) {
    if (!isChineseCharactersDeckMode()) {
        return;
    }
    const uniqueFronts = [];
    const seen = new Set();
    blocks.forEach((block) => {
        const cards = Array.isArray(block.cards) ? block.cards : [];
        cards.forEach((card) => {
            const front = String(card && card.front ? card.front : '').trim();
            if (!front || seen.has(front)) {
                return;
            }
            seen.add(front);
            uniqueFronts.push(front);
        });
    });
    if (uniqueFronts.length === 0) {
        return;
    }
    const pinyinByText = await deckCreateCommon.fetchChineseCharacterPinyinMap(API_BASE, uniqueFronts);
    blocks.forEach((block) => {
        block.cards = (Array.isArray(block.cards) ? block.cards : []).map((card) => {
            const front = String(card && card.front ? card.front : '').trim();
            const pinyin = String(pinyinByText[front] || '').trim();
            return {
                front,
                back: pinyin || front,
            };
        });
    });
}

async function fetchTagPathAvailability(firstTag, extraTags) {
    const params = new URLSearchParams();
    params.set('firstTag', String(firstTag || '').trim());
    const tags = Array.isArray(extraTags) ? extraTags : [];
    tags.forEach((tag) => {
        params.append('extraTag', String(tag || '').trim());
    });
    const name = buildDeckTags(firstTag, tags).join('_');
    if (name) {
        params.set('name', name);
    }
    const response = await fetch(`${API_BASE}/shared-decks/name-availability?${params.toString()}`);
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
        throw new Error(result.error || `Failed to validate tag path "${name}" (HTTP ${response.status})`);
    }
    return {
        available: Boolean(result.available),
        conflictType: String(result.conflict_type || '').trim(),
        conflictTags: Array.isArray(result.conflict_tags) ? result.conflict_tags : [],
    };
}

function buildOverlapSummary(overlapInfo) {
    const overlaps = Array.isArray(overlapInfo && overlapInfo.overlaps) ? overlapInfo.overlaps : [];
    let exactCount = 0;
    let mismatchCount = 0;
    const exactDecks = [];
    const mismatchDecks = [];
    overlaps.forEach((item) => {
        const exact = Array.isArray(item && item.exact_match_decks) ? item.exact_match_decks : [];
        const mismatch = Array.isArray(item && item.mismatch_decks) ? item.mismatch_decks : [];
        if (exact.length > 0) {
            exactCount += 1;
            exactDecks.push(...exact);
        }
        if (mismatch.length > 0) {
            mismatchCount += 1;
            mismatchDecks.push(...mismatch);
        }
    });
    const dedupeKey = String(overlapInfo && overlapInfo.dedupeKey ? overlapInfo.dedupeKey : 'front');
    const otherKey = String(overlapInfo && overlapInfo.otherKey ? overlapInfo.otherKey : (dedupeKey === 'back' ? 'front' : 'back'));
    const exactDeckText = deckCreateCommon.formatDeckNameList(exactDecks);
    const mismatchDeckText = deckCreateCommon.formatDeckNameList(mismatchDecks);
    return {
        exactText: exactCount > 0
            ? `Exact card match for ${exactCount} card(s) in: ${exactDeckText}.`
            : '',
        warningText: mismatchCount > 0
            ? `Warning: ${mismatchCount} card(s) share same ${dedupeKey} with different ${otherKey} in: ${mismatchDeckText}.`
            : '',
    };
}

function isStrictPrefixPath(pathA, pathB) {
    const a = Array.isArray(pathA) ? pathA : [];
    const b = Array.isArray(pathB) ? pathB : [];
    if (a.length === 0 || b.length === 0 || a.length >= b.length) {
        return false;
    }
    for (let i = 0; i < a.length; i += 1) {
        if (String(a[i] || '') !== String(b[i] || '')) {
            return false;
        }
    }
    return true;
}

async function previewBulkCreate() {
    showError('');
    showSuccess('');
    if (!currentFirstTag || !deckCategoryKeySet.has(currentFirstTag)) {
        showError('Select a valid first tag before preview.');
        return;
    }

    let blocks;
    try {
        blocks = parseDeckBlocks(bulkDeckInput.value);
    } catch (error) {
        showError(error.message || 'Failed to parse input.');
        return;
    }
    try {
        await enrichChineseCharactersBacks(blocks);
    } catch (error) {
        showError(error.message || 'Failed to generate pinyin for Chinese characters.');
        return;
    }

    blocks.forEach((block) => {
        const tags = buildDeckTags(currentFirstTag, block.remainingTagParts);
        block.extraTags = tags.slice(1);
        block.extraTagsPayload = Array.isArray(block.remainingTagPartsPayload)
            ? block.remainingTagPartsPayload
            : block.extraTags;
        block.fullTags = tags;
        block.deckName = tags.join('_');
    });

    try {
        const overlapResults = await Promise.all(
            blocks.map(async (block) => deckCreateCommon.fetchCategoryCardOverlap(API_BASE, currentFirstTag, block.cards))
        );
        overlapResults.forEach((info, index) => {
            const summary = buildOverlapSummary(info);
            blocks[index].exactText = summary.exactText;
            blocks[index].warningText = summary.warningText;
        });
    } catch (error) {
        showError(error.message || 'Failed to compare with existing cards.');
        return;
    }

    const countByName = new Map();
    blocks.forEach((block) => {
        const count = Number(countByName.get(block.deckName) || 0);
        countByName.set(block.deckName, count + 1);
    });

    const inInputPrefixConflictsByBlockIndex = new Map();
    for (let i = 0; i < blocks.length; i += 1) {
        for (let j = i + 1; j < blocks.length; j += 1) {
            const left = blocks[i];
            const right = blocks[j];
            const leftPath = Array.isArray(left.fullTags) ? left.fullTags : [];
            const rightPath = Array.isArray(right.fullTags) ? right.fullTags : [];
            if (isStrictPrefixPath(leftPath, rightPath) || isStrictPrefixPath(rightPath, leftPath)) {
                const leftMsg = `Conflicts with block ${right.blockIndex} path ${deckCreateCommon.formatTagPath(rightPath)}.`;
                const rightMsg = `Conflicts with block ${left.blockIndex} path ${deckCreateCommon.formatTagPath(leftPath)}.`;
                const leftMessages = inInputPrefixConflictsByBlockIndex.get(left.blockIndex) || [];
                const rightMessages = inInputPrefixConflictsByBlockIndex.get(right.blockIndex) || [];
                leftMessages.push(leftMsg);
                rightMessages.push(rightMsg);
                inInputPrefixConflictsByBlockIndex.set(left.blockIndex, leftMessages);
                inInputPrefixConflictsByBlockIndex.set(right.blockIndex, rightMessages);
            }
        }
    }

    const pathKeyToCheck = new Map();
    blocks.forEach((block) => {
        if (Number(countByName.get(block.deckName) || 0) > 1) {
            return;
        }
        const extra = Array.isArray(block.extraTags) ? block.extraTags : [];
        if (extra.length === 0) {
            return;
        }
        const tags = [currentFirstTag, ...(Array.isArray(block.extraTags) ? block.extraTags : [])];
        const key = tags.join('\u0001');
        if (!pathKeyToCheck.has(key)) {
            pathKeyToCheck.set(key, {
                firstTag: currentFirstTag,
                extraTags: extra,
                deckName: block.deckName,
            });
        }
    });

    let availabilityByPathKey = {};
    try {
        const checks = await Promise.all(Array.from(pathKeyToCheck.entries()).map(async ([key, payload]) => {
            const availability = await fetchTagPathAvailability(payload.firstTag, payload.extraTags);
            return [key, availability];
        }));
        availabilityByPathKey = Object.fromEntries(checks);
    } catch (error) {
        showError(error.message || 'Failed to verify deck names.');
        return;
    }

    blocks.forEach((block) => {
        if (!Array.isArray(block.extraTags) || block.extraTags.length === 0) {
            block.statusCode = 'invalid';
            block.statusText = 'Invalid: remaining tag collapses to first tag only.';
            return;
        }
        const inInputConflicts = inInputPrefixConflictsByBlockIndex.get(block.blockIndex) || [];
        if (inInputConflicts.length > 0) {
            block.statusCode = 'invalid';
            block.statusText = `Invalid: tag path prefix conflict in input. ${inInputConflicts[0]}`;
            block.exactText = '';
            block.warningText = '';
            return;
        }
        if (Number(countByName.get(block.deckName) || 0) > 1) {
            block.statusCode = 'invalid';
            block.statusText = 'Invalid: duplicate deck name in input.';
            block.exactText = '';
            block.warningText = '';
            return;
        }
        const pathKey = [currentFirstTag, ...(Array.isArray(block.extraTags) ? block.extraTags : [])].join('\u0001');
        const availability = availabilityByPathKey[pathKey] || null;
        if (!availability || !availability.available) {
            block.statusCode = 'invalid';
            if (availability && availability.conflictType === 'tag_prefix_conflict') {
                block.statusText = `Invalid: tag path conflicts with existing path ${deckCreateCommon.formatTagPath(availability.conflictTags)}.`;
            } else {
                block.statusText = 'Invalid: deck name already exists.';
            }
            block.exactText = '';
            block.warningText = '';
            return;
        }
        block.statusCode = 'ready';
        block.statusText = 'Kept';
    });

    previewDecks = blocks;
    renderReview();
    reviewSection.classList.remove('hidden');
}

function renderReview() {
    const total = previewDecks.length;
    const ready = previewDecks.filter((item) => item.statusCode === 'ready').length;
    const invalid = previewDecks.filter((item) => item.statusCode === 'invalid').length;

    reviewMeta.innerHTML = `
        <div><strong>First tag:</strong> <code>${escapeHtml(currentFirstTag)}</code></div>
        <div><strong>Blocks parsed:</strong> ${total}</div>
        <div><strong>Ready to create:</strong> ${ready}</div>
        <div><strong>Invalid (tag-path/name conflicts):</strong> <span class="${invalid > 0 ? 'deck-row-status-conflict' : ''}">${invalid}</span></div>
    `;

    reviewTableBody.innerHTML = previewDecks.map((item) => `
        <tr>
            <td>${item.blockIndex}</td>
            <td><code>${escapeHtml(item.deckName)}</code></td>
            <td>${item.parsedRowCount}</td>
            <td>${item.cards.length}</td>
            <td>${deckCreateCommon.renderStatusCellHtml(item, { warnClass: 'deck-row-status-conflict' })}</td>
        </tr>
    `).join('');
}

async function createDecks() {
    if (isCreatingDecks) {
        return;
    }
    if (!Array.isArray(previewDecks) || previewDecks.length === 0) {
        showError('Preview first before creating decks.');
        return;
    }

    const targets = previewDecks.filter((item) => item.statusCode === 'ready');
    if (targets.length === 0) {
        showError('No valid decks to create.');
        return;
    }

    isCreatingDecks = true;
    createDecksBtn.disabled = true;
    createDecksBtn.textContent = 'Creating...';
    showError('');
    showSuccess('');

    let createdCount = 0;
    let failedCount = 0;

    try {
        for (const item of targets) {
            const payload = {
                firstTag: currentFirstTag,
                extraTags: item.extraTagsPayload,
                cards: item.cards,
            };

            try {
                const response = await fetch(`${API_BASE}/shared-decks`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload),
                });
                const result = await response.json().catch(() => ({}));
                if (!response.ok) {
                    throw new Error(result.error || `Create failed (HTTP ${response.status})`);
                }

                createdCount += 1;
                item.statusCode = 'created';
                item.statusText = 'Created';
            } catch (error) {
                failedCount += 1;
                item.statusCode = 'failed';
                item.statusText = `Failed: ${String(error.message || 'Create failed')}`;
            }
        }
        if (failedCount === 0 && createdCount > 0) {
            window.location.href = '/deck-manage.html';
            return;
        }
        renderReview();
        if (failedCount > 0) {
            showError(`${failedCount} deck(s) failed to create.`);
        }
    } finally {
        isCreatingDecks = false;
        createDecksBtn.disabled = false;
        createDecksBtn.textContent = 'Confirm & Create Decks';
    }
}

function resetPreviewState() {
    previewDecks = [];
    if (reviewTableBody) {
        reviewTableBody.innerHTML = '';
    }
    if (reviewMeta) {
        reviewMeta.innerHTML = '';
    }
    if (reviewSection) {
        reviewSection.classList.add('hidden');
    }
    showError('');
    showSuccess('');
}
