# Project map

A Flask + vanilla-JS web app for kids' flash-card / writing / math practice. Family → Kid → Deck → Card hierarchy. Decks have four "behavior types" (I/II/III/IV) that drive different practice flows.

## Layout

```
backend/      Flask API (Python). venv at backend/venv
frontend/     Static HTML/JS/CSS, no build step, no ES modules
shared/       Shared assets/data
Scan/         (not source)
```

## Backend — where the routes live

`from src.routes.kids import kids_bp` exposes 86 routes. The kids blueprint is a **package**, not a single file. To add or edit a route, find the matching prefix module — **every route file opens with a docstring TOC and `# === N. ` section banners**, so once you're in the right file you can jump straight to the cluster:

| URL prefix | File | Routes |
|---|---|---|
| `/shared-decks/...` | [routes/kids/shared_decks.py](backend/src/routes/kids/shared_decks.py) | 23 |
| `/kids` (CRUD) + `/kids/<id>/report/*` + `/kids/<id>/deck-categories` | [routes/kids/kids_core.py](backend/src/routes/kids/kids_core.py) | 13 |
| `/kids/<id>/cards*` + `/kids/<id>/<scope>/shared-decks/*` + `/kids/<id>/<scope>/decks` + `/kids/<id>/type4/shared-decks/*` | [routes/kids/kid_decks.py](backend/src/routes/kids/kid_decks.py) | 14 |
| `/kids/<id>/type2/cards*` + `/type2/audio/*` + `/cards/audio/*` + `/type2/chinese-print-sheets*` | [routes/kids/type2.py](backend/src/routes/kids/type2.py) | 12 |
| `/kids/<id>/type4/print-config` + `/type4/math-sheets*` | [routes/kids/type4.py](backend/src/routes/kids/type4.py) | 8 |
| `/kids/<id>/<scope>/practice/start` + `/<scope>/practice/complete` + `/lesson-reading/practice/upload-audio` | [routes/kids/practice.py](backend/src/routes/kids/practice.py) | 9 |
| `/kids/<id>/lesson-reading/audio/*` + `/kids/<id>/lesson-reading/recordings/download-zip` | [routes/kids/lesson_reading.py](backend/src/routes/kids/lesson_reading.py) | 3 |
| `/chinese-bank*` | [routes/kids/chinese_bank.py](backend/src/routes/kids/chinese_bank.py) | 4 |

Other blueprints:
- `badges_bp` → [routes/badges.py](backend/src/routes/badges.py)
- `backup_bp` → [routes/backup.py](backend/src/routes/backup.py)
- Auth/family routes → [app.py](backend/src/app.py) directly

### Where helpers live

- **Constants** for the kids domain → [routes/kids_constants.py](backend/src/routes/kids_constants.py). Sibling route modules import names explicitly from `src.routes.kids_constants` and `src.routes.kids`.
- **Pure helpers** by concern (extracted from kids; all live in [backend/src/services/](backend/src/services/)):
  - [writing_audio.py](backend/src/services/writing_audio.py) — TTS audio file paths, prompt synthesis
  - [audio_io.py](backend/src/services/audio_io.py) — download filename sanitizer + ffmpeg path resolver
  - [shared_deck_normalize.py](backend/src/services/shared_deck_normalize.py) — tag/card/category normalizers
  - [shared_deck_materialize.py](backend/src/services/shared_deck_materialize.py) — materialized shared-deck sync
  - [shared_deck_queries.py](backend/src/services/shared_deck_queries.py) — shared-deck and materialized-deck row readers
  - [shared_deck_optin.py](backend/src/services/shared_deck_optin.py) — type-I/II/III/IV opt-in & opt-out workflows
  - [shared_deck_payloads.py](backend/src/services/shared_deck_payloads.py) — opt-in & merged-bank cards payload builders
  - [shared_card_skip.py](backend/src/services/shared_card_skip.py) — toggle skip_practice on shared/orphan cards (single + bulk)
  - [type4_print_layout.py](backend/src/services/type4_print_layout.py) — type-IV print sheet layout math
  - [type4_print_sheet.py](backend/src/services/type4_print_sheet.py) — type-IV print sheet rendering
  - [type4_generator_definitions.py](backend/src/services/type4_generator_definitions.py) — type-IV generator code lookups
  - [kid_category_config.py](backend/src/services/kid_category_config.py) — kid/category config hydration + orphan-deck lookups
  - [kid_category_resolve.py](backend/src/services/kid_category_resolve.py) — resolve raw category-key arg → (key, mode)
  - [kid_card_queries.py](backend/src/services/kid_card_queries.py) — kid-DB card readers reused across routes
  - [kid_daily_progress.py](backend/src/services/kid_daily_progress.py) — daily-progress section + category stats
  - [deck_source_merge.py](backend/src/services/deck_source_merge.py) — source-deck merging, card-count summaries
  - [practice_priority.py](backend/src/services/practice_priority.py) — practice-priority preview scoring (pure; caller supplies session behavior type)
  - [family_auth.py](backend/src/services/family_auth.py) — get_kid_for_family, get_kid_connection_for, critical-password gate
  - [writing_bulk_split.py](backend/src/services/writing_bulk_split.py) — split bulk writing / type-II input into deduped tokens or (front, back) rows
  - [normalize_inputs.py](backend/src/services/normalize_inputs.py) — `normalize_positive_int_list` + `normalize_lowercase_string_list` (shared dedupe/coerce for caller-supplied id/tag lists)
  - [practice_session.py](backend/src/services/practice_session.py) / [practice_priority.py](backend/src/services/practice_priority.py) / [practice_mode.py](backend/src/services/practice_mode.py) — fresh/continue/retry selection, preview-only priority scoring, session-mode normalization
  - [session_grading.py](backend/src/services/session_grading.py) — type-I/IV answer normalize + grade encoding, result-row inserts/appends
  - [pending_sessions.py](backend/src/services/pending_sessions.py) — in-memory pending session dict + lock; create/get/pop helpers
  - [type4_session.py](backend/src/services/type4_session.py) — type-IV choice options, pending-item builder, count distribution, retry rows
  - [writing_candidates.py](backend/src/services/writing_candidates.py) — type-II writing candidate selection + chinese-print-sheet cleanup
  - [card_stats.py](backend/src/services/card_stats.py) — cards-with-stats readers + practiced-card-ids by category
  - [chinese_text.py](backend/src/services/chinese_text.py) — pinyin generation, auto back-text fill, category lookups
  - [kid_today_sessions.py](backend/src/services/kid_today_sessions.py) — today-bounds + per-kid latest/unfinished/retry session lookups
  - [shared_deck_category.py](backend/src/services/shared_deck_category.py) — category-meta cache + session-behavior + type-III session-type guard
  - [shared_deck_tag_paths.py](backend/src/services/shared_deck_tag_paths.py) — shared-deck tag path tree + prefix-conflict detection
- **Type-specific session helpers** (extracted from kids):
  - `start_type_i_practice_session_internal`, `complete_session_internal` → [routes/kids/practice.py](backend/src/routes/kids/practice.py)
  - `complete_type_iv_session_internal` → [routes/kids/type4.py](backend/src/routes/kids/type4.py)
- **Tangled helpers + module state** still in [routes/kids/__init__.py](backend/src/routes/kids/__init__.py) (~1.26k lines, was 8.4k — see file docstring for section map) — auth helpers, `_PENDING_SESSIONS`, `_SHARED_DECK_MUTATION_LOCK`, shared-deck scope dispatch (CATEGORY_CONFIG + SHARED_DECK_OPERATION_HANDLERS + per-scope route handlers), Flask request-parsing helpers. Add new helpers to a service module if pure; only put in `__init__.py` if it touches Flask request/response or module state. Sibling modules `from src.routes.kids import ...` is wired through re-exports; pyflakes flags those as "imported but unused" in `__init__.py` — that's expected and benign.
- **Badges** → [badges/](backend/src/badges/): `definitions.py` (catalog), `service.py` (compute), `session_sync.py` (post-session hook), `admin.py` (super-family ops).
- **DB layer** → [db/](backend/src/db/): `kid_db.py` (per-kid SQLite), `shared_deck_db.py` (shared decks DB), `metadata.py` (family/kid CRUD), schema in `*.sql`.

### Adding a new route — recipe

1. Pick the right module by URL prefix (table above). If none fits, create a new module under `routes/kids/` and add it to the import list at the END of [routes/kids/__init__.py](backend/src/routes/kids/__init__.py).
2. In the module, add `@kids_bp.route('/your-path', methods=['...'])` — `kids_bp` is imported explicitly from `src.routes.kids`.
3. Use existing helpers (`current_family_id()`, `get_kid_for_family()`, `require_critical_password()`, etc.) — add them to the module's explicit `from src.routes.kids import (...)` block.
4. For state access (`_PENDING_SESSIONS`, locks): they're underscore-prefixed but `__all__` is built from `globals()` so they're still importable explicitly.
5. New pure helper → `services/<topic>.py`. New stateful helper → `routes/kids/__init__.py`.

## Frontend — where the page code lives

No build step, no ES modules. Each `.html` page loads its `.js` siblings via `<script>` tags in `<head>` order. Functions/consts are global script-scope. Common modules (`practice-manage-common.js`, `kid-report-common.js`, `audio-common.js`, etc.) are loaded before page-specific code.

### Page → file map

| Page | HTML | JS | CSS (per-page) |
|---|---|---|---|
| Family home (admin) | [admin.html](frontend/admin.html) | [admin.js](frontend/admin.js) | — (uses styles.css) |
| Login / register | index.html, family-register.html | family-login.js, family-register.js | — |
| Parent settings (timezone, password, badges, rewards) | [parent-settings.html](frontend/parent-settings.html) | **4 files** — core/rewards/badges/backup | kid-badge-shelf-modal.css |
| **Kid card management** (deck setup, card list, type-IV gen) | [kid-card-manage.html](frontend/kid-card-manage.html) | **8 files** — see below | [kid-card-manage.css](frontend/kid-card-manage.css) |
| Kid practice runtime | [kid-practice.html](frontend/kid-practice.html) | **5 files** — core + type1/2/3/4 | — |
| Kid practice home | kid-practice-home.html | kid-practice-home.js | — |
| Kid reports | kid-report.html, kid-card-report.html, kid-session-report.html | kid-report.js, kid-card-report.js, kid-session-report.js | — |
| Deck create / view / category | deck-create*.html, deck-view.html, deck-category-create.html | deck-create*.js, deck-view.js, deck-category-create.js | — |
| Writing sheets | kid-writing-sheets.html, kid-writing-sheet-manage.html, writing-sheet-print.html | kid-writing-sheets.js, **3 files** — core/lists/builder, writing-sheet-print.js | kid-writing-sheet-manage.css |
| Math sheet print | math-sheet-print.html | math-sheet-print.js | — |
| Chinese bank admin | chinese-bank.html | chinese-bank.js | — |

### kid-card-manage.js — split package

The 5,957-line page controller was split. To edit kid-card-manage features, find the right file:

| File | Owns |
|---|---|
| [kid-card-manage-core.js](frontend/kid-card-manage-core.js) | Bootstrap, modal helpers, URL builders, behavior-type checks, kid nav, page title |
| [kid-card-manage-type4-generator.js](frontend/kid-card-manage-type4-generator.js) | Ace code editor + generator preview/samples modal |
| [kid-card-manage-type4-counts.js](frontend/kid-card-manage-type4-counts.js) | Type-IV daily-count modal |
| [kid-card-manage-deck-setup.js](frontend/kid-card-manage-deck-setup.js) | Opt-in/out, deck-tag helpers, deck-tree modal |
| [kid-card-manage-cards-priority.js](frontend/kid-card-manage-cards-priority.js) | Card filter/sort, practice-priority scoring, queue mix legend |
| [kid-card-manage-cards.js](frontend/kid-card-manage-cards.js) | Card markup, displayCards, bulk add/edit/delete, kid + decks loaders |
| [kid-card-manage-stats.js](frontend/kid-card-manage-stats.js) | View-mode toggle, distribution histograms, daily progress chart |
| [kid-card-manage.js](frontend/kid-card-manage.js) (residual) | DOMContentLoaded handler — page init |

Load order in [kid-card-manage.html](frontend/kid-card-manage.html): core → type4-generator → type4-counts → deck-setup → cards-priority → cards → stats → kid-card-manage.js (init).

### kid-practice.js — split package

| File | Owns |
|---|---|
| [kid-practice-core.js](frontend/kid-practice-core.js) | Bootstrap, state, singletons, URL builders, session-start/end dispatchers, judge-mode init, base reset, error display, event binding, DOMContentLoaded |
| [kid-practice-type1.js](frontend/kid-practice-type1.js) | Type-I flash cards, multiple-choice, drill engine, bonus game |
| [kid-practice-type2.js](frontend/kid-practice-type2.js) | Type-II writing/audio prompts |
| [kid-practice-type3.js](frontend/kid-practice-type3.js) | Type-III lesson recording + pause/resume |
| [kid-practice-type4.js](frontend/kid-practice-type4.js) | Type-IV generator input/multi-choice |

Load order in [kid-practice.html](frontend/kid-practice.html): core → type1 → type2 → type3 → type4.

### parent-settings.js — split package

| File | Owns |
|---|---|
| [parent-settings-core.js](frontend/parent-settings-core.js) | Bootstrap, shared DOM consts/helpers, timezone, password, family admin, error/success toasts |
| [parent-settings-rewards.js](frontend/parent-settings-rewards.js) | Rewards tracking |
| [parent-settings-badges.js](frontend/parent-settings-badges.js) | Badge Art Studio |
| [parent-settings-backup.js](frontend/parent-settings-backup.js) | Backup download/restore |

Load order in [parent-settings.html](frontend/parent-settings.html): core → rewards → badges → backup.

### kid-writing-sheet-manage.js — split package

| File | Owns |
|---|---|
| [kid-writing-sheet-manage-core.js](frontend/kid-writing-sheet-manage-core.js) | Bootstrap, shared state, helpers, page-mode toggle, DOMContentLoaded wiring |
| [kid-writing-sheet-manage-lists.js](frontend/kid-writing-sheet-manage-lists.js) | Chinese/math sheet list loaders, rendering, mark-done/delete |
| [kid-writing-sheet-manage-builder.js](frontend/kid-writing-sheet-manage-builder.js) | Cell-design modal, paper layout, sheet preview, build actions, PAPER_SPECS |

Load order in [kid-writing-sheet-manage.html](frontend/kid-writing-sheet-manage.html): core → lists → builder.

### Common frontend modules

- [practice-manage-common.js](frontend/practice-manage-common.js) — escapeHtml, math rendering, card markup helpers, password dialogs, slider/status controllers, deck opt-in helpers, hierarchical tag filter, kid-manage tab visibility, Type-IV validate-test box, auto-injected Home button (1.6k single file; jump via `// === N.` section markers — 15 HTML callers made splitting too high-coordination)
- [kid-report-common.js](frontend/kid-report-common.js) — report rendering shared by report pages
- [deck-category-common.js](frontend/deck-category-common.js) — category labels/icons
- [deck-form-common.js](frontend/deck-form-common.js) — secondary-tag extraction + Type-IV Ace editor setup (shared by deck-view + deck-create)
- [math-rendering-common.js](frontend/math-rendering-common.js) — vertical arithmetic parsing + cell rendering (shared by kid-writing-sheet-manage + math-sheet-print)
- [practice-judge-mode.js](frontend/practice-judge-mode.js), [practice-star-badge-common.js](frontend/practice-star-badge-common.js), [practice-ui-common.js](frontend/practice-ui-common.js) — practice runtime helpers
- [audio-common.js](frontend/audio-common.js), [simple-audio-player.js](frontend/simple-audio-player.js), [recording-visualizer.js](frontend/recording-visualizer.js), [writing-audio-sequence.js](frontend/writing-audio-sequence.js) — audio playback/recording
- [icons.js](frontend/icons.js), [subject-icons.js](frontend/subject-icons.js) — SVG icon registry
- [styles.css](frontend/styles.css) — global stylesheet (2.5k; jump via `/* === N. ` section markers — 13 numbered sections from reset → atomic widgets → design tokens → page layout → practice/manage/report-page rules. Includes per-page rules that should eventually move out)
- [home-redesign-v4.css](frontend/home-redesign-v4.css) — family home layout

## Domain concepts

- **Deck behavior types**: `type_i` (flash cards), `type_ii` (writing/audio), `type_iii` (lesson reading + grading), `type_iv` (generated math problems). Constants in [routes/kids_constants.py](backend/src/routes/kids_constants.py).
- **Shared decks** vs **personal decks**: shared decks live in `shared_decks.db` and are opt-in per kid; personal cards live in each kid's per-kid SQLite (`backend/data/families/family_<id>/kid_<kid_id>.db`).
- **Materialized shared decks**: each kid has a "view" row per shared deck they've opted into, with name prefix `shared_deck_`. Sync logic is in [services/shared_deck_materialize.py](backend/src/services/shared_deck_materialize.py).
- **Critical password**: super-family / parent admin actions require re-entering password; rate-limited via [security_rate_limit.py](backend/src/security_rate_limit.py).
- **Sessions**: practice runs are pending-sessions held in memory (`_PENDING_SESSIONS` dict in `routes/kids/__init__.py`) until explicitly completed via `practice/complete` route.

## Conventions

- **No backwards-compat shims**: when changing a function/route/schema, update all call-sites in the same change. Don't keep the old name as an alias. (For DB schema, use the "modify zip trick" — see `feedback_no_legacy_db_compat.md` in user memory.)
- **No ES modules in frontend**: keep using `<script>` tags + global functions. Order matters in HTML.
- **Per-kid DB**: each kid has their own SQLite. Helpers in [db/kid_db.py](backend/src/db/kid_db.py). Schema in [db/schema.sql](backend/src/db/schema.sql).
- **No new doc/comment unless needed**: well-named identifiers > comments. Don't write docstrings for trivial helpers.

## Smoke test

After backend changes, verify the app boots and all routes register:

```bash
cd backend && source venv/bin/activate \
  && python -c "import sys; sys.path.insert(0, '.'); from src.app import create_app; app = create_app(); print('OK', len(list(app.url_map.iter_rules())))"
# Expected: OK 111
```

Optionally run `python -m pyflakes src/services/ src/routes/` to catch undefined names (the package re-exports in `routes/kids/__init__.py` will produce many "imported but unused" warnings — those are expected; the things to fix are `undefined name` errors and bare unused-local warnings in sibling modules).

For frontend changes, run [start-local.sh](start-local.sh) and check the affected page in a browser. There's no automated test suite — verify manually.

## Refactor history

- [refactor.md](refactor.md) — original audit + plan (2026-05-05)

Files that were on the split list but landed at single-file + section-comments instead (splitting required touching 15+ HTML pages — coordination cost outweighed the gain): `styles.css` (2.5k, 13 sections), `practice-manage-common.js` (1.6k, 8 sub-sections inside the singleton). `routes/kids/__init__.py` is down to ~1.4k (from 8.4k) and now holds only Flask plumbing + the scope dispatcher — also section-commented.
