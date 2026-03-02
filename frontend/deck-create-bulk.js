const API_BASE = `${window.location.origin}/api`;

const firstTagToggle = document.getElementById('firstTagToggle');
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

let currentFirstTag = '';
let previewDecks = [];
let isCreatingDecks = false;
let deckCategories = [];
let deckCategoryKeySet = new Set();

document.addEventListener('DOMContentLoaded', async () => {
    const allowed = await ensureSuperFamily();
    if (!allowed) {
        return;
    }
    const categoriesLoaded = await loadDeckCategories();
    if (!categoriesLoaded) {
        return;
    }
    renderFirstTagToggle();
    updateInputModeUi();
});

if (firstTagToggle) {
    firstTagToggle.addEventListener('click', (event) => {
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

async function ensureSuperFamily() {
    try {
        const response = await fetch(`${API_BASE}/family-auth/status`);
        if (!response.ok) {
            window.location.href = '/family-login.html';
            return false;
        }
        const auth = await response.json().catch(() => ({}));
        if (!auth.authenticated) {
            window.location.href = '/family-login.html';
            return false;
        }
        if (!auth.isSuperFamily) {
            window.location.href = '/admin.html';
            return false;
        }
        return true;
    } catch (error) {
        window.location.href = '/admin.html';
        return false;
    }
}

function normalizeTag(text) {
    return String(text || '')
        .trim()
        .toLowerCase()
        .replace(/\s+/g, '_')
        .replace(/_+/g, '_')
        .replace(/^_+|_+$/g, '');
}

function normalizeBehaviorType(value) {
    const text = String(value || '').trim().toLowerCase();
    if (text === 'type_i' || text === 'type_ii' || text === 'type_iii') {
        return text;
    }
    return '';
}

function setControlsDisabled(disabled) {
    const isDisabled = Boolean(disabled);
    if (bulkDeckInput) {
        bulkDeckInput.disabled = isDisabled;
    }
    if (previewBtn) {
        previewBtn.disabled = isDisabled;
    }
    if (clearInputBtn) {
        clearInputBtn.disabled = isDisabled;
    }
    if (createDecksBtn) {
        createDecksBtn.disabled = isDisabled || isCreatingDecks;
    }
}

function getCurrentDeckCategory() {
    const key = normalizeTag(currentFirstTag);
    if (!key) {
        return null;
    }
    return deckCategories.find((item) => item.category_key === key) || null;
}

async function loadDeckCategories() {
    showError('');
    try {
        const response = await fetch(`${API_BASE}/shared-decks/categories`);
        const result = await response.json().catch(() => ({}));
        if (!response.ok) {
            throw new Error(result.error || `Failed to load deck categories (HTTP ${response.status})`);
        }

        const rawCategories = Array.isArray(result.categories) ? result.categories : [];
        const nextCategories = [];
        const seenKeys = new Set();
        rawCategories.forEach((item) => {
            const key = normalizeTag(item && item.category_key);
            const behaviorType = normalizeBehaviorType(item && item.behavior_type);
            if (!key || !behaviorType || seenKeys.has(key)) {
                return;
            }
            seenKeys.add(key);
            nextCategories.push({
                category_key: key,
                behavior_type: behaviorType,
                has_chinese_specific_logic: Boolean(item && item.has_chinese_specific_logic),
            });
        });

        if (nextCategories.length === 0) {
            throw new Error('No deck categories configured. Create a category first.');
        }

        deckCategories = nextCategories;
        deckCategoryKeySet = new Set(nextCategories.map((item) => item.category_key));
        if (!deckCategoryKeySet.has(currentFirstTag)) {
            currentFirstTag = nextCategories[0].category_key;
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
    if (!Array.isArray(deckCategories) || deckCategories.length === 0) {
        firstTagToggle.innerHTML = '<span class="settings-note">No categories available.</span>';
        return;
    }
    firstTagToggle.innerHTML = deckCategories.map((item) => {
        const isActive = item.category_key === currentFirstTag;
        return `<button type="button" class="audio-filter-btn${isActive ? ' active' : ''}" data-first-tag="${escapeHtml(item.category_key)}" aria-pressed="${isActive ? 'true' : 'false'}">${escapeHtml(item.category_key)}</button>`;
    }).join('');
    firstTagToggle.querySelectorAll('[data-first-tag]').forEach((el) => {
        const tag = String(el.getAttribute('data-first-tag') || '');
        const isActive = tag === currentFirstTag;
        el.classList.toggle('active', isActive);
        el.setAttribute('aria-pressed', isActive ? 'true' : 'false');
    });
}

function setCurrentFirstTag(tag) {
    const next = normalizeTag(tag);
    if (!deckCategoryKeySet.has(next)) {
        return;
    }
    if (next === currentFirstTag) {
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
    const category = getCurrentDeckCategory();
    return Boolean(
        category
        && category.behavior_type === 'type_i'
        && category.has_chinese_specific_logic
    );
}

function isChineseWritingDeckMode() {
    const category = getCurrentDeckCategory();
    return Boolean(
        category
        && category.behavior_type === 'type_ii'
        && category.has_chinese_specific_logic
    );
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
            bulkInputHelpText.innerHTML = 'Format per block: first line is <code>remaining_tag</code> (underscore-separated parts become multiple tags), then paste Chinese text lines only. The system auto-extracts Chinese characters as <code>front</code> and auto-generates pinyin as <code>back</code>. Separate blocks with a blank line.';
        }
        bulkDeckInput.placeholder = 'siwukuaidu_book1_week1\n春眠不觉晓，处处闻啼鸟。\n夜来风雨声，花落知多少。\n\nsiwukuaidu_book1_week2\n床前明月光，疑是地上霜。';
        return;
    }
    if (bulkInputSectionTitle) {
        bulkInputSectionTitle.textContent = '2) Paste Deck Blocks';
    }
    if (bulkInputHelpText) {
        bulkInputHelpText.innerHTML = 'Format per block: first line is <code>remaining_tag</code> (underscore-separated parts become multiple tags), then card rows as <code>front,back</code>. Separate blocks with a blank line.';
    }
    bulkDeckInput.placeholder = 'siwukuaidu_book1_week1\n1+1,2\n2+3,5\n\nsiwukuaidu_book1_week2\n3+4,7\n5+1,6';
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
    const raw = String(rawLine || '').trim().toLowerCase();
    if (!raw || raw.includes(',') || /\p{Script=Han}/u.test(raw)) {
        return false;
    }
    const normalized = normalizeTag(raw);
    return Boolean(normalized && normalized === raw);
}

function dedupeCards(cards) {
    const dedupeKey = isChineseWritingDeckMode() ? 'back' : 'front';
    const firstByKey = new Map();
    cards.forEach((card) => {
        const key = String(card[dedupeKey] || '');
        if (!firstByKey.has(key)) {
            firstByKey.set(key, card);
        }
    });
    return Array.from(firstByKey.values()).map((card) => ({ front: card.front, back: card.back }));
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

        const remainingTag = normalizeTag(headerRaw);
        if (!remainingTag) {
            throw new Error(`Line ${tagLineNo}: invalid remaining tag.`);
        }
        const remainingTagParts = remainingTag.split('_').map((part) => normalizeTag(part)).filter(Boolean);
        if (remainingTagParts.length === 0) {
            throw new Error(`Line ${tagLineNo}: invalid remaining tag.`);
        }

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

async function fetchChineseCharacterPinyinMap(texts) {
    if (!Array.isArray(texts) || texts.length === 0) {
        return {};
    }
    const response = await fetch(`${API_BASE}/shared-decks/chinese-characters/pinyin`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ texts }),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
        throw new Error(result.error || `Failed to generate pinyin (HTTP ${response.status})`);
    }
    return result && typeof result.pinyin_by_text === 'object' && result.pinyin_by_text
        ? result.pinyin_by_text
        : {};
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
    const pinyinByText = await fetchChineseCharacterPinyinMap(uniqueFronts);
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

async function fetchNameAvailability(name) {
    const response = await fetch(`${API_BASE}/shared-decks/name-availability?name=${encodeURIComponent(name)}`);
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
        throw new Error(result.error || `Failed to check name "${name}" (HTTP ${response.status})`);
    }
    return Boolean(result.available);
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
        block.deckName = tags.join('_');
    });

    const countByName = new Map();
    blocks.forEach((block) => {
        const count = Number(countByName.get(block.deckName) || 0);
        countByName.set(block.deckName, count + 1);
    });

    const namesToCheck = Array.from(new Set(
        blocks
            .filter((block) => Number(countByName.get(block.deckName) || 0) === 1)
            .map((block) => block.deckName)
    ));

    let availableByName = {};
    try {
        const checks = await Promise.all(namesToCheck.map(async (name) => {
            const available = await fetchNameAvailability(name);
            return [name, available];
        }));
        availableByName = Object.fromEntries(checks);
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
        if (Number(countByName.get(block.deckName) || 0) > 1) {
            block.statusCode = 'invalid';
            block.statusText = 'Invalid: duplicate deck name in input.';
            return;
        }
        if (!availableByName[block.deckName]) {
            block.statusCode = 'invalid';
            block.statusText = 'Invalid: deck name already exists.';
            return;
        }
        block.statusCode = 'ready';
        block.statusText = 'Ready to create';
    });

    previewDecks = blocks;
    renderReview();
    reviewSection.classList.remove('hidden');
}

function renderReview() {
    const total = previewDecks.length;
    const ready = previewDecks.filter((item) => item.statusCode === 'ready').length;
    const invalid = previewDecks.filter((item) => item.statusCode === 'invalid').length;
    const created = previewDecks.filter((item) => item.statusCode === 'created').length;
    const failed = previewDecks.filter((item) => item.statusCode === 'failed').length;

    reviewMeta.innerHTML = `
        <div><strong>First tag:</strong> <code>${escapeHtml(currentFirstTag)}</code></div>
        <div><strong>Blocks parsed:</strong> ${total}</div>
        <div><strong>Ready to create:</strong> ${ready}</div>
        <div><strong>Invalid (duplicate/existing names):</strong> ${invalid}</div>
        <div><strong>Created:</strong> ${created}</div>
        <div><strong>Failed:</strong> ${failed}</div>
    `;

    reviewTableBody.innerHTML = previewDecks.map((item) => `
        <tr>
            <td>${item.blockIndex}</td>
            <td><code>${escapeHtml(item.deckName)}</code></td>
            <td>${item.parsedRowCount}</td>
            <td>${item.cards.length}</td>
            <td class="${item.statusCode === 'ready' || item.statusCode === 'created' ? 'deck-row-status-ok' : 'deck-row-status-warn'}">${escapeHtml(item.statusText)}</td>
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
                extraTags: item.extraTags,
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

function showError(message) {
    const text = String(message || '').trim();
    if (!text) {
        errorMessage.textContent = '';
        errorMessage.classList.add('hidden');
        return;
    }
    errorMessage.textContent = text;
    errorMessage.classList.remove('hidden');
}

function showSuccess(message) {
    const text = String(message || '').trim();
    if (!text) {
        successMessage.textContent = '';
        successMessage.classList.add('hidden');
        return;
    }
    successMessage.textContent = text;
    successMessage.classList.remove('hidden');
}

function escapeHtml(value) {
    const div = document.createElement('div');
    div.textContent = String(value ?? '');
    return div.innerHTML;
}
