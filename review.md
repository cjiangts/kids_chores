# Code Review — Round 5 (2026-03-04, simplification focus)

## What changed since last review
- Tag-label support added (canonical key + optional display comment) — new `parseDeckTagInput`, `formatDeckTagLabel` in `deck-category-common.js`, mirrored by `parse_shared_deck_tag_with_comment` / `format_shared_deck_tag_display_label` in `kids.py`
- Type-III page-back migration added in backup cleanup script
- `deck-create.js` and `deck-create-bulk.js` both updated with the new tag helpers

The new tag feature was integrated cleanly in `deck-category-common.js` and the backend — but it added more functions to the already-duplicated surface between the two deck-create files.

---

## 1. 19 functions duplicated between `deck-create.js` and `deck-create-bulk.js` (Priority 1, ~180 LOC)

Confirmed by `uniq -d` on function signatures. Every function listed below exists in **both files** with identical or near-identical bodies:

| Function | deck-create.js | deck-create-bulk.js | Notes |
|----------|---------------|---------------------|-------|
| `ensureSuperFamily` | L95 | L72 | Byte-for-byte identical (18 lines) |
| `normalizeTag` | L118 | L95 | 1-liner wrapper around `deckCategoryCommon.parseDeckTagInput` |
| `parseTagInput` | L122 | L99 | 1-liner wrapper |
| `formatTagPayload` | L126 | L103 | 3-liner wrapper |
| `getDeckCountForCategory` | L131 | L108 | Identical |
| `getCurrentDeckCategory` | L141 | L134 | Identical |
| `isChineseCharactersDeckMode` | L149 | L269 | Identical |
| `isChineseWritingDeckMode` | L158 | L278 | Identical |
| `isTypeIIDeckMode` | L167 | L287 | Identical |
| `setControlsDisabled` | L172 | L118 | Same pattern, different element list |
| `loadDeckCategories` | L194 | L142 | Near-identical; bulk skips `reservedFirstTags` |
| `renderFirstTagToggle` | L223 | L223 | Identical |
| `setCurrentFirstTag` | L235 | L235 | Identical |
| `formatTagPath` | L280 | L561 | Byte-for-byte identical (8 lines) |
| `fetchChineseCharacterPinyinMap` | L498 | L487 | Byte-for-byte identical (17 lines) |
| `fetchCategoryCardOverlap` | L539 | L592 | Near-identical |
| `formatDeckNameList` | L577 | L569 | Byte-for-byte identical (22 lines) |
| `renderStatusCellHtml` | L717 | L654 | Identical except one CSS class name |
| `showError` / `showSuccess` | L811/L822 | L938/L949 | Identical |

**Fix:** Create `frontend/deck-create-common.js`, move all shared functions there, load it in both HTML files before the page-specific script. Each page script drops ~90 lines and the shared module is ~90 lines — net saving ~90 LOC, and every future bug fix happens in one place.

`renderStatusCellHtml` takes one config param for the warn class (`'deck-row-status-warn'` vs `'deck-row-status-conflict'`). `setControlsDisabled` takes the element list as a parameter. `loadDeckCategories` takes a flag for whether to set `reservedFirstTags`.

---

## 2. Four category-key getters + four resolvers follow the exact same pattern (Priority 1, ~50 LOC)

`deck-category-common.js` L125–210: eight functions, two shapes repeated four times.

**Shape A — getter:**
```javascript
function getTypeIChineseSpecificCategoryKeys(kid) {
    const optedInKeys = getOptedInDeckCategoryKeys(kid);
    const categoryMetaMap = getDeckCategoryMetaMap(kid);
    return optedInKeys.filter((key) => {
        const categoryMeta = categoryMetaMap[key] || {};
        return categoryMeta.behavior_type === 'type_i'
            && Boolean(categoryMeta.has_chinese_specific_logic);  // ← only this line varies
    });
}
// repeated for: getTypeINonChineseCategoryKeys, getTypeIIICategoryKeys, getTypeIICategoryKeys
```

**Shape B — resolver:**
```javascript
function resolveChinesePracticeCategoryKey(kid, preferredKey = '') {
    const keys = getTypeIChineseSpecificCategoryKeys(kid);  // ← only this call varies
    if (keys.length === 0) return '';
    const preferred = normalizeCategoryKey(preferredKey);
    if (preferred && keys.includes(preferred)) return preferred;
    return keys[0];
}
// repeated for: resolveTypeINonChinese, resolveTypeII, resolveTypeIII
```

**Fix:**
```javascript
function getCategoryKeysByPredicate(kid, predicate) {
    const optedInKeys = getOptedInDeckCategoryKeys(kid);
    const categoryMetaMap = getDeckCategoryMetaMap(kid);
    return optedInKeys.filter((key) => predicate(categoryMetaMap[key] || {}));
}

function resolvePreferredCategoryKey(keys, preferredKey) {
    if (!keys.length) return '';
    const preferred = normalizeCategoryKey(preferredKey);
    return (preferred && keys.includes(preferred)) ? preferred : keys[0];
}

// Each named getter becomes one line:
const getTypeIChineseSpecificCategoryKeys = (kid) =>
    getCategoryKeysByPredicate(kid, (m) => m.behavior_type === 'type_i' && m.has_chinese_specific_logic);
const getTypeINonChineseCategoryKeys = (kid) =>
    getCategoryKeysByPredicate(kid, (m) => m.behavior_type === 'type_i' && !m.has_chinese_specific_logic);
const getTypeIIICategoryKeys = (kid) =>
    getCategoryKeysByPredicate(kid, (m) => m.behavior_type === 'type_iii');
const getTypeIICategoryKeys = (kid) =>
    getCategoryKeysByPredicate(kid, (m) => m.behavior_type === 'type_ii');

// Each resolver becomes two lines:
const resolveChinesePracticeCategoryKey = (kid, pref = '') =>
    resolvePreferredCategoryKey(getTypeIChineseSpecificCategoryKeys(kid), pref);
```

Saves ~50 LOC, and a future behavior type (`type_iv`) needs zero new functions.

---

## 3. `opt_in_type_i_shared_decks` and `opt_in_shared_decks_internal` open with identical fetch block (Priority 2, ~25 LOC)

`opt_in_type_i_shared_decks` (L4395, 234 lines) and `opt_in_shared_decks_internal` (L5308, 245 lines) both start with the same 25-line block:

```python
shared_conn = get_shared_decks_connection()
placeholders = ','.join(['?'] * len(deck_ids))
deck_rows = shared_conn.execute(
    "SELECT deck_id, name, tags FROM deck WHERE deck_id IN ({placeholders})",
    deck_ids
).fetchall()
shared_by_id = {
    int(row[0]): {
        'deck_id': int(row[0]),
        'name': str(row[1]),
        'tags': extract_shared_deck_tags_and_labels(row[2])[0],
    }
    for row in deck_rows
}
missing_ids = [deck_id for deck_id in deck_ids if deck_id not in shared_by_id]
if missing_ids:
    raise ValueError(...)
```

**Fix:** Extract `_fetch_shared_decks_by_ids(shared_conn, deck_ids) -> (shared_by_id, missing_ids)`. Both functions call it. ~25 LOC saved, and the fetch logic is named and testable.

---

## 4. `complete_session_internal` (L3711, 191 lines) — still monolithic

Structure:
1. L3712–3730: Validate pending session, filter answers, parse timestamps (20 lines)
2. L3731–3760: Open connection, begin transaction, insert session row (30 lines)
3. L3761–3850: Loop over answers inserting results — type-III audio path inline (90 lines)
4. L3851–3870: Update hardness scores by behavior type (20 lines)
5. L3871–3902: Commit/rollback with audio cleanup, orphan audio cleanup (30 lines)

Items 4 and 5 are self-contained tasks mixed into the main function. Extract:
- `_update_hardness_after_session(conn, session_behavior_type, ...)` — 20 lines
- `_cleanup_uncommitted_type3_audio(written_paths, pending)` — used in the except block

Reduces main function to ~130 lines with clearer top-level structure.

---

## 5. Tag normalization mirrored in backend and frontend (Low, worth noting)

Frontend (`deck-category-common.js` L15–35): `parseDeckTagInput` normalizes a raw tag string to `{tag, comment, label}` using a regex + lowercase/underscore transform.

Backend (`kids.py` L334–395): `parse_shared_deck_tag_with_comment` + `normalize_shared_deck_tag` + `format_shared_deck_tag_display_label` do the exact same thing in Python.

This is **intentional** (you need both sides) but means any change to the format (e.g., allowed characters, comment delimiter) must be updated in two places. Document this explicitly — add a comment in both files pointing to the other: `# Mirror of parseDeckTagInput in deck-category-common.js — keep in sync`.

---

## 6. `kids.py` at 7658 lines — unchanged

All review rounds have flagged this. The five natural split points remain:

| File | Contents | Est. lines |
|------|----------|-----------|
| `routes/shared_decks.py` | Shared deck CRUD + opt-in/out internals | ~2200 |
| `routes/writing.py` | Type-II cards, sheets, audio, practice | ~1100 |
| `routes/practice.py` | Session start/complete, card selection | ~900 |
| `routes/reports.py` | Report endpoints, card detail | ~700 |
| `routes/kids_core.py` | Kid CRUD, deck-category config | ~700 |
| `routes/helpers.py` | Normalization, payload builders, utilities | ~2000 |

No behavior changes. This is pure file organization.

---

## Action plan

| # | Task | Where | LOC saved |
|---|------|--------|-----------|
| 1 | Create `deck-create-common.js`, move 19 shared functions | deck-create.js, deck-create-bulk.js | ~180 |
| 2 | Replace 8 category key functions with 2 factories | deck-category-common.js | ~50 |
| 3 | Extract `_fetch_shared_decks_by_ids` helper | kids.py | ~25 |
| 4 | Extract `_update_hardness_after_session` + audio cleanup from `complete_session_internal` | kids.py | ~40 |
| 5 | Add sync comments on tag normalization (frontend ↔ backend) | both | 0 LOC, maintenance value |
| 6 | Split `kids.py` into 5–6 route files | kids.py | structural |
