# Refactor — Round 1 Progress

Plan source: [refactor.md](refactor.md). Date: 2026-05-05.

## What was done

### 1. HTML inline-style extraction
Extracted huge inline `<style>` blocks into sibling `.css` files.

| File | Before | After | Notes |
|---|---|---|---|
| [frontend/kid-card-manage.html](frontend/kid-card-manage.html) | 6,131 | 400 | new [kid-card-manage.css](frontend/kid-card-manage.css) (5,737 lines) |
| [frontend/kid-writing-sheet-manage.html](frontend/kid-writing-sheet-manage.html) | 1,255 | 233 | new [kid-writing-sheet-manage.css](frontend/kid-writing-sheet-manage.css) (1,021 lines) |

### 2. `kids.py` Phase 1 — constants
Module-level constants moved to a new file. App-side state (`_PENDING_SESSIONS`, locks, `_PYPINYIN_DICTS_LOADED`) deliberately left behind.
- New: [backend/src/routes/kids_constants.py](backend/src/routes/kids_constants.py) (140 lines)

### 3. `kids.py` Phase 2 — helpers → services
Pure helpers extracted into 6 service modules under `backend/src/services/`. Done by subagent.

| Module | Lines | Functions |
|---|---|---|
| [services/writing_audio.py](backend/src/services/writing_audio.py) | 291 | 16 audio path/meta/synthesis helpers |
| [services/shared_deck_normalize.py](backend/src/services/shared_deck_normalize.py) | 370 | 22 normalizer/deduper functions |
| [services/type4_print_layout.py](backend/src/services/type4_print_layout.py) | 504 | 14 type-IV print sheet builders |
| [services/shared_deck_materialize.py](backend/src/services/shared_deck_materialize.py) | 128 | 6 materialized-deck sync helpers |
| [services/kid_category_config.py](backend/src/services/kid_category_config.py) | 236 | 9 category-config hydration helpers |
| [services/deck_source_merge.py](backend/src/services/deck_source_merge.py) | 269 | 9 source-deck merge helpers |

Skipped (still in `kids/__init__.py`): mutable state (`_PENDING_SESSIONS`, `_SHARED_DECK_MUTATION_LOCK`, `_PYPINYIN_DICTS_LOADED`); the TTL-cached `get_shared_deck_category_meta_by_key`; orphan-deck readers and a few kid-DB readers reused across many routes.

### 4. `kids.py` Phase 3 — routes split into a package
`backend/src/routes/kids.py` (single 14,424-line file) replaced by `backend/src/routes/kids/` package. External contract `from src.routes.kids import kids_bp` preserved. Done by subagent.

| File | Lines | Routes | Sample URL |
|---|---|---|---|
| [routes/kids/__init__.py](backend/src/routes/kids/__init__.py) | 8,351 | 0 | helpers + state + `__all__` + route imports |
| [routes/kids/shared_decks.py](backend/src/routes/kids/shared_decks.py) | 1,680 | 23 | `/shared-decks/categories` |
| [routes/kids/kids_core.py](backend/src/routes/kids/kids_core.py) | 1,311 | 13 | `/kids` |
| [routes/kids/type2.py](backend/src/routes/kids/type2.py) | 839 | 12 | `/kids/<id>/type2/cards` |
| [routes/kids/practice.py](backend/src/routes/kids/practice.py) | 722 | 9 | `/kids/<id>/type2/practice/start` |
| [routes/kids/type4.py](backend/src/routes/kids/type4.py) | 555 | 8 | `/kids/<id>/type4/print-config` |
| [routes/kids/kid_decks.py](backend/src/routes/kids/kid_decks.py) | 476 | 13 | `/kids/<id>/cards` |
| [routes/kids/chinese_bank.py](backend/src/routes/kids/chinese_bank.py) | 389 | 4 | `/chinese-bank` |
| [routes/kids/lesson_reading.py](backend/src/routes/kids/lesson_reading.py) | 142 | 2 | `/kids/<id>/lesson-reading/audio/<path>` |

Total kids routes: **84** (matches pre-refactor count).

Cross-module visibility: each route module does `from src.routes.kids import *`. `__init__.py` builds an explicit `__all__` from `globals()` immediately before importing the route modules at the end, so underscore-prefixed names (locks, pending-session dicts, internal helpers) are still visible.

### 5. `kid-card-manage.js` split
Done by subagent. Original 5,957-line file split into 8 files; HTML updated with 7 new `<script>` tags ahead of the residual one.

| File | Lines | Owns |
|---|---|---|
| [kid-card-manage-core.js](frontend/kid-card-manage-core.js) | 715 | bootstrap, modals, URL builders, behavior-type checks, kid nav |
| [kid-card-manage-type4-generator.js](frontend/kid-card-manage-type4-generator.js) | 256 | Ace editor + generator preview/samples modal |
| [kid-card-manage-type4-counts.js](frontend/kid-card-manage-type4-counts.js) | 280 | type-IV daily-count modal |
| [kid-card-manage-deck-setup.js](frontend/kid-card-manage-deck-setup.js) | 792 | opt-in/out, deck-tag helpers, deck-tree modal |
| [kid-card-manage-cards-priority.js](frontend/kid-card-manage-cards-priority.js) | 1,196 | card filter/sort, priority scoring, queue mix legend |
| [kid-card-manage-cards.js](frontend/kid-card-manage-cards.js) | 1,344 | card markup, displayCards, bulk add/edit/delete, kid loader |
| [kid-card-manage-stats.js](frontend/kid-card-manage-stats.js) | 965 | view-mode toggle, distribution histograms, daily progress chart |
| [kid-card-manage.js](frontend/kid-card-manage.js) (residual) | 410 | DOMContentLoaded handler |

## Verification

Backend boots cleanly after every phase:
```
cd backend && source venv/bin/activate \
  && python -c "import sys; sys.path.insert(0, '.'); from src.app import create_app; app = create_app(); print('OK', len(list(app.url_map.iter_rules())))"
# OK 109
```
- `109 = 84 kids routes + 25 others` — matches pre-refactor counts.
- All 84 routes register on `kids_bp`.

Frontend: each split JS file passes `node --check`. Concatenation parses cleanly. HTML script tags ordered core → features → page-init.

## Top-15 file sizes (after round 1)

| File | Lines |
|---|---|
| backend/src/routes/kids/__init__.py | 8,351 |
| frontend/kid-card-manage.css | 5,737 |
| frontend/kid-practice.js | 3,273 |
| frontend/kid-writing-sheet-manage.js | 2,685 |
| frontend/styles.css | 2,386 |
| frontend/parent-settings.js | 2,168 |
| frontend/deck-view.js | 1,805 |
| frontend/home-redesign-v4.css | 1,755 |
| backend/src/routes/kids/shared_decks.py | 1,680 |
| frontend/practice-manage-common.js | 1,533 |
| frontend/kid-card-manage-cards.js | 1,344 |
| frontend/deck-create.js | 1,334 |
| backend/src/routes/kids/kids_core.py | 1,311 |
| frontend/kid-card-manage-cards-priority.js | 1,196 |
| frontend/kid-writing-sheet-manage.css | 1,021 |

For comparison, the original top-3 were 16,136 / 6,131 / 5,957. Worst-case-on-disk dropped from 16k → 8.4k.

## Not yet done (next rounds)

Refactor.md sections covered: §1 audit, §2 (Phases 1–3), §3 (JS split), §11 steps 1–4. Steps 5–8 still pending:

1. **`routes/kids/__init__.py` deeper extraction** (8,351 lines is still painful). Phase 2 agent left ~1,400 lines of tangled helpers; another ~7,000 lines of route-adjacent helpers were never in scope for Phase 2. A focused round could likely halve this.
2. **`kid-practice.js`** (3,273 lines) — split by behavior type per refactor.md §4.
3. **`kid-writing-sheet-manage.js`** (2,685) and **`math-sheet-print.js`** (901) — extract shared `print-cell-design-common.js` per §5.
4. **`parent-settings.js`** (2,168) — split into core/rewards/badges per §6.
5. **`styles.css`** (2,386) — audit per-page rules and move to per-page CSS per §7.
6. **`deck-view.js`** (1,805) and **`deck-create.js`** (1,334) — extract `deck-form-common.js` per §8.
7. **`practice-manage-common.js`** (1,533) — split by concern per §9.

## Constraints honored

- No backwards-compat shims (per `feedback_no_legacy_db_compat.md` ethos applied to Python/JS): every move was a clean cut, all call-sites updated in the same change.
- External contract `from src.routes.kids import kids_bp` still works, so [backend/src/app.py](backend/src/app.py) needs no changes.
- Code style preserved: same indentation, no new ESLint rules, no new doc-blocks beyond one-line module headers.
