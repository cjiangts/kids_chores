# Code Review — Math/Chinese Consolidation (2026-03-02)

**Goal:** Cut LOC, eliminate duplication, keep code simple.
Migration scripts for DB compatibility go in `backend/scripts/` — not as runtime branches in `kids.py`.

## Current sizes (files in scope)

| File | Lines |
|------|-------|
| `backend/src/routes/kids.py` | 7509 |
| `frontend/kid-type1-manage.js` | 1160 |
| `frontend/kid-writing-manage.js` | 1303 |
| `frontend/kid-lesson-reading-manage.js` | 777 |
| `frontend/practice-manage-common.js` | 1257 |
| `frontend/kid-type1.js` | 638 |

Estimated reducible LOC: **~2000–2500** across backend and frontend.

---

## 1. Backend — Triplicated shared-deck route handlers (Priority 1, ~900 LOC)

Every shared-deck operation is implemented three separate times for `type1`, `lesson_reading`, and `writing`. The operations are structurally identical; only table names, field names, and prefix strings differ.

### The six operations, each written 3×

| Operation | type1 | lesson_reading | writing |
|-----------|-------|----------------|---------|
| GET shared decks | L4662 | L4885 | L5590 |
| POST opt-in | L4682 | L5017 | L5722 |
| POST opt-out | L4712 | L5235 | L5957 |
| GET cards | L4743 | L5406 | L6104 |
| PUT card skip | L4769 | L5494 | L6267 |
| GET decks (readiness) | L4835 | L5551 | L6324 |

That is 18 route handlers where 6 would suffice with a category config dict.

### Suggested pattern

```python
CATEGORY_CONFIG = {
    'type1':          { 'deck_prefix': 'type1_',          'orphan_name': ..., ... },
    'lesson_reading': { 'deck_prefix': 'lesson_reading_', 'orphan_name': ..., ... },
    'writing':        { 'deck_prefix': 'writing_',        'orphan_name': ..., ... },
}

@kids_bp.route('/kids/<kid_id>/<category>/shared-decks', methods=['GET'])
def get_kid_shared_decks(kid_id, category):
    cfg = CATEGORY_CONFIG[category]
    return _get_shared_decks(kid_id, cfg)
```

Each `_*` internal handles shared logic; config dict carries only what differs.

### Opt-in size disparity is a signal

`opt_in_kid_type1_shared_decks` L4682–4708 ≈ 27 lines.
`opt_in_kid_lesson_reading_shared_decks` L5017–5232 ≈ 216 lines.

If the two operations are semantically equivalent, lesson-reading is carrying logic that belongs elsewhere or is itself duplicated from somewhere else. Audit before collapsing so you don't lose the divergence silently.

---

## 2. Backend — Session start/complete handlers (Priority 2, ~200 LOC)

```
start_type1_practice_session            L7189
start_lesson_reading_practice_session   L7214
complete_type1_practice_session         L7381
complete_lesson_reading_practice_session L7407
complete_writing_practice_session       L7468
complete_practice_session               L7487  ← possibly dead
```

`start_type_i_practice_session_internal` already exists at L4596.
Check whether `start_lesson_reading_practice_session` calls it or duplicates its logic.

`complete_session_internal` already exists at L3416.
Check whether all three `complete_*` wrappers are thin (< 10 lines each) or have accumulated duplicate logic.

`complete_practice_session` L7487 — if no route is registered to it, delete it.

---

## 3. Backend — Card skip toggle, implemented 3× (~100 LOC)

```
update_shared_type1_card_skip         L4769
update_shared_lesson_reading_card_skip L5494
update_shared_writing_card_skip       L6267
```

A skip toggle is: validate ownership → `UPDATE cards SET skipped = ? WHERE id = ?`.
One `_update_card_skip(kid_id, card_id, cfg)` covers all three.

---

## 4. Backend — Orphan deck helpers, duplicated

```python
get_or_create_writing_orphan_deck(conn)        # L2989
get_or_create_lesson_reading_orphan_deck(conn) # L3013
```

No equivalent for type1. Either type1 has no orphan decks (mark it in `CATEGORY_CONFIG` as `has_orphan=False`) or it is missing. Either way, collapse both helpers to:

```python
def get_or_create_orphan_deck(conn, orphan_deck_name: str): ...
```

---

## 5. Backend — Unused / redundant session-type constants

`kids.py` L27–29:
```python
SESSION_TYPE_CHINESE_CHARACTERS = 'chinese_characters'
SESSION_TYPE_CHINESE_WRITING     = 'chinese_writing'
SESSION_TYPE_CHINESE_READING     = 'chinese_reading'
```

If session `type` is set as a bare string literal in route handlers rather than using these constants, they are dead. Either use them consistently everywhere or delete them.

---

## 6. Frontend — Three manage JS files share ~80% logic (Priority 1, ~600 LOC)

`kid-type1-manage.js` (1160), `kid-writing-manage.js` (1303), `kid-lesson-reading-manage.js` (777) all implement the same structure:

- Deck bubble rendering with orphan toggle
- Tag filter via `createHierarchicalTagFilterController`
- Session settings form save (validate → fetch → show error/success)
- Card grid rendering with skip-toggle buttons
- `showError` / `showSuccess` helpers
- Identical fetch error-handling boilerplate

`practice-manage-common.js` (1257) exists but doesn't cover these higher-level patterns.

### What to move into `practice-manage-common.js`

**a) Session settings saver factory**
```javascript
export function createSessionSettingsSaver({ endpoint, inputId, label }) {
    return async function saveSessionSettings() {
        // shared validation + fetch + error display
    };
}
```

**b) Card grid renderer**

Each file builds identical `<div class="card-bubble">` HTML with skip/unskip buttons. Extractable with a `formatLabel(card)` callback for category-specific display.

**c) Deck bubble renderer with orphan support**

`renderAvailableDecks` / `renderSelectedDecks` is identical across all three files except for the orphan deck name string. Pass it as config.

**d) `showError` / `showSuccess` helpers**

Every file has these referencing local DOM IDs. Wire once via a shared factory that takes element references.

### What stays per-file

- `categoryKey`, endpoint URL fragments, page title
- Writing-specific: audio recording logic (genuinely unique to writing)
- Lesson-reading-specific: any reading-specific card display fields

---

## 7. Frontend — Bonus game logic in `kid-type1.js` (~150 LOC)

`kid-type1.js` L479–634 is the bonus board matching game. This only applies to `chinese_characters`, not `math`. It currently lives unconditionally in the shared file.

Options (simplest first):
1. Guard with `if (categoryConfig.hasBonus)` — skip init for math
2. Extract to `kid-type1-bonus.js` and conditionally include via `<script>`

Since `kid-type1.html` is shared between math and Chinese characters, option 1 (guard) is the minimum change. Option 2 is cleaner if HTML pages are ever split.

Also verify that `wrongCardsInSession` (L391–397) is guarded consistently — math sessions should not accumulate this dead state.

---

## 8. Frontend — `kid-reading-manage.html` redirect shim

This file is now a redirect to `kid-type1-manage.html?categoryKey=chinese_characters`. Once all internal links point directly to the new URL, **delete this file**. Don't keep redirect shims permanently.

---

## 9. Metadata field naming inconsistency

Backend uses different field names per category:
- Writing: `sharedWritingHardCardPercentage`
- Lesson reading: `sharedLessonReadingHardCardPercentage`
- Type1: inside `TYPE_I_HARD_CARD_PERCENT_BY_CATEGORY_FIELD` (a dict by category key)

Frontend must know which field name to use per category. This mapping is currently scattered. A `CATEGORY_CONFIG` dict on the backend (see item 1) gives one authoritative place — if needed by the frontend, expose it via one endpoint or embed it on page load.

---

## Action plan (ordered by impact)

| # | Task | Where | LOC saved |
|---|------|--------|-----------|
| 1 | Build `CATEGORY_CONFIG` dict; collapse 18 shared-deck routes → 6 | `kids.py` | ~800 |
| 2 | Audit opt-in size disparity (type1 27 ln vs lesson-reading 216 ln) | `kids.py` | varies |
| 3 | Collapse card-skip to one `_update_card_skip` internal | `kids.py` | ~80 |
| 4 | Merge orphan-deck helpers into one function | `kids.py` | ~25 |
| 5 | Verify/delete `complete_practice_session` L7487 | `kids.py` | ~20 |
| 6 | Verify/use or delete `SESSION_TYPE_*` constants | `kids.py` | ~3 |
| 7 | Extract session-settings saver + card renderer + deck-bubble renderer into `practice-manage-common.js` | frontend | ~400 |
| 8 | Shrink the three manage JS files to thin wrappers | frontend | ~400 |
| 9 | Guard / extract bonus-game logic in `kid-type1.js` | frontend | ~150 |
| 10 | Delete `kid-reading-manage.html` after updating all links | frontend | ~30 |

Each step is independently deployable. DB schema changes go in `backend/scripts/` one-time migration scripts.
