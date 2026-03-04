# Code Review — Round 2 (2026-03-04)

Progress since last review: orphan deck helpers merged, card-skip collapsed to one internal, bonus game gated by category, writing/reading manage JS deleted, kid-type1/type3/writing practice merged into `kid-practice.js`. Good structural work.

## Current sizes

| File | Lines |
|------|-------|
| `backend/src/routes/kids.py` | 7309 |
| `frontend/kid-practice.js` | 1866 |
| `frontend/kid-card-manage.js` | 1766 |
| `frontend/practice-manage-common.js` | 1257 |

---

## 1. Three category-resolution functions that are 95% identical (Priority 1, ~80 LOC)

`kids.py` has three separate functions:
```
resolve_kid_type_iii_category_with_mode  L1806
resolve_kid_type_ii_category_with_mode   L1850
resolve_kid_type_i_category_with_mode    L1891 (inferred)
```

Each one:
1. Normalizes `raw_category_key`
2. Looks up `category_meta_by_key`
3. Checks `behavior_type != DECK_CATEGORY_BEHAVIOR_TYPE_*`
4. Falls back to scanning opted-in keys when no key given

The **only** difference is the `expected_behavior_type` string being compared against. Collapse to one:

```python
def resolve_kid_category_with_mode(kid, raw_category_key, expected_behavior_type, *, allow_default=True):
    ...
```

Then the three callers become one-liners.

---

## 2. Two merged-source-deck functions that are 95% identical (Priority 1, ~80 LOC)

```
get_shared_type_i_merged_source_decks_for_kid   L872
get_shared_type_ii_merged_source_decks_for_kid  L950
```

Both functions execute the same SQL block twice (for normal decks and for orphan decks), build identical `sources.append({...})` dicts, and differ only in which materialization helper they call at the top:
- Type-I calls `get_kid_materialized_shared_decks_by_first_tag()`
- Type-II calls `get_kid_materialized_shared_type_ii_decks()`

Collapse to one with a `get_materialized_func` parameter:

```python
def get_shared_merged_source_decks_for_kid(conn, kid, get_materialized_func):
    ...
```

---

## 3. `escapeHtml` duplicated in ~8 files (Priority 2, ~40 LOC)

Every JS file re-implements one of two variants:

```javascript
// DOM-based variant (kid-card-manage.js, practice-manage-common.js, ...)
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = String(text ?? '');
    return div.innerHTML;
}

// Regex variant (kid-report.js) — subtly different output for some chars
function escapeHtml(raw) {
    return String(raw || '')
        .replace(/&/g, '&amp;').replace(/</g, '&lt;')...
}
```

The two variants are not equivalent (regex version escapes `"` and `'`; DOM version does not). Pick one, put it in a shared module loaded first, delete the rest.

---

## 4. Three card markup builders that are 70% identical (Priority 2, ~100 LOC)

`kid-card-manage.js`:
```
buildChineseCardMarkup()        L624
buildGenericType1CardMarkup()   L651
buildType2CardMarkup()          L675
```

All three render: skip toggle, source label, hardness score, creation date, attempt count. Only the front/back field names and a few conditional extras differ. Refactor to one `buildCardMarkup(card, opts)` where `opts` carries field names and feature flags.

---

## 5. Dead ALTER TABLE columns in `shared_deck_schema.sql`

```sql
CREATE TABLE IF NOT EXISTS deck_category (
  ...
  has_chinese_specific_logic BOOLEAN NOT NULL DEFAULT FALSE,
  display_name VARCHAR,
  emoji VARCHAR
);

-- These are immediately dead — columns already exist above
ALTER TABLE deck_category ADD COLUMN IF NOT EXISTS has_chinese_specific_logic BOOLEAN DEFAULT FALSE;
ALTER TABLE deck_category ADD COLUMN IF NOT EXISTS display_name VARCHAR;
ALTER TABLE deck_category ADD COLUMN IF NOT EXISTS emoji VARCHAR;
```

The `ALTER TABLE` statements are for fresh-DB idempotence but the `CREATE TABLE` already defines those columns. The ALTER statements only matter for databases that existed before these columns were added — i.e. they're a one-time migration. Move them to `backend/scripts/` and remove from the schema file.

---

## 6. `normalizeSessionType('flashcard')` — dead legacy mapping

`deck-category-common.js`:
```javascript
function normalizeSessionType(type) {
    if (text === 'flashcard') return SESSION_TYPE_CHINESE_CHARACTERS; // never reached
    if (text === 'writing') return SESSION_TYPE_CHINESE_WRITING;
    return text;
}
```

No current code passes `'flashcard'`. Remove this branch. If it was needed for old DB rows, that's a migration concern not a runtime concern.

---

## 7. Category key normalization duplicated everywhere (Priority 3)

The pattern `String(rawKey || '').trim().toLowerCase()` appears inline in:
- `deck-category-common.js` line 5 (as `normalizeCategoryKey`)
- `kid-card-manage.js` line 120 (inside `toCategoryMap`)
- `app.js` line 63 (inside `getCategoryValueMap`)
- elsewhere

`normalizeCategoryKey` already exists in `deck-category-common.js`. The other files should call it instead of duplicating.

Also, `toCategoryMap` in `kid-card-manage.js` and `getCategoryValueMap` in `app.js` do nearly the same thing (normalize keys of an object). Consolidate in `deck-category-common.js`.

---

## 8. Type-II uses a different API URL builder — inconsistency

`kid-card-manage.js` has two URL builders:
```javascript
function buildSharedDeckApiUrl(pathSuffix) { ... }  // for type-I / type-III
function buildType2ApiUrl(pathSuffix) { ... }        // delegates to DeckCategoryCommon.buildType2ApiUrl
```

This means type-II routes are on a different URL path structure from type-I/III. If the backend path is already parameterized, make the frontend builder parameterized too so there's one function. If backend routes are different, that's the real inconsistency to fix.

---

## 9. No validation before navigating to type-III practice

`kid-practice-home.js`:
```javascript
if (behaviorType === 'type_iii') {
    goType3Practice(categoryKey); // no opt-in check
    return;
}
```

But for Chinese characters there's an explicit opted-in check before redirecting. A direct URL with an arbitrary `categoryKey` will silently land on a broken page. Either validate opt-in status before redirect or handle the broken state gracefully in `kid-practice.js` on load.

---

## 10. Hardness percentage default mismatch

Backend `normalize_hard_card_percentage()` returns `DEFAULT_HARD_CARD_PERCENTAGE` when no value is set.
Frontend `getInitialHardCardPercentFromKid()` returns `null` when not set.

If the frontend sends a save with `null`, the backend might interpret it differently than no-save. Verify the round-trip is consistent, or make one side match the other.

---

## 11. `showError` / `showSuccess` pattern still in every file

Each JS file has 15–25 lines of identical show/hide error message logic. This was flagged in the last review and hasn't changed. Since `practice-manage-common.js` is already a shared module, add:

```javascript
export function createMessageDisplay(errorEl, successEl) {
    return {
        showError(msg) { ... },
        showSuccess(msg) { ... },
        clear() { ... }
    };
}
```

---

## 12. Date formatting scattered across files

- `kid-report.js`: `formatDateKey()`, `formatDateTime()`, `parseUtcTimestamp()`
- `kid-card-report.js`: own formatters
- `practice-manage-common.js`: own formatters

No shared date utility. When a format changes it must be updated in 3+ places.

---

## Action plan

| # | Task | Impact |
|---|------|--------|
| 1 | Merge 3 `resolve_kid_type_*_category_with_mode` → 1 parameterized fn | ~80 LOC |
| 2 | Merge 2 `get_shared_type_*_merged_source_decks_for_kid` → 1 | ~80 LOC |
| 3 | Merge 3 `buildChineseCardMarkup` / `buildGenericType1CardMarkup` / `buildType2CardMarkup` → 1 | ~100 LOC |
| 4 | Consolidate `escapeHtml` to one shared module; pick DOM or regex variant consistently | ~40 LOC |
| 5 | Move `toCategoryMap` / `getCategoryValueMap` to `deck-category-common.js`, remove duplicates | ~40 LOC |
| 6 | Remove `ALTER TABLE` dead columns from `shared_deck_schema.sql`; put in `backend/scripts/` if still needed | schema hygiene |
| 7 | Delete `flashcard` branch from `normalizeSessionType` | trivial |
| 8 | Unify type-II API URL builder with type-I/III, or document intentional divergence | consistency |
| 9 | Add opt-in validation before `goType3Practice()` redirect | correctness |
| 10 | Align hardness percentage null vs default between backend and frontend | correctness |
| 11 | Add `createMessageDisplay` factory to `practice-manage-common.js` | ~200 LOC across files |
| 12 | Create shared date utility module | ~60 LOC |
