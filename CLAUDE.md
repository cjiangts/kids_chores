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

`from src.routes.kids import kids_bp` exposes 84 routes. The kids blueprint is a **package**, not a single file. To add or edit a route, find the matching prefix module:

| URL prefix | File | Routes |
|---|---|---|
| `/shared-decks/...` | [routes/kids/shared_decks.py](backend/src/routes/kids/shared_decks.py) | 23 |
| `/kids` (CRUD) + `/kids/<id>/report/*` + `/kids/<id>/deck-categories` | [routes/kids/kids_core.py](backend/src/routes/kids/kids_core.py) | 13 |
| `/kids/<id>/cards*` + `/kids/<id>/<scope>/shared-decks/*` + `/kids/<id>/<scope>/decks` + `/kids/<id>/type4/shared-decks/*` | [routes/kids/kid_decks.py](backend/src/routes/kids/kid_decks.py) | 13 |
| `/kids/<id>/type2/cards*` + `/type2/audio/*` + `/cards/audio/*` + `/type2/chinese-print-sheets*` | [routes/kids/type2.py](backend/src/routes/kids/type2.py) | 12 |
| `/kids/<id>/type4/print-config` + `/type4/math-sheets*` | [routes/kids/type4.py](backend/src/routes/kids/type4.py) | 8 |
| `/kids/<id>/<scope>/practice/start` + `/<scope>/practice/complete` + `/lesson-reading/practice/upload-audio` | [routes/kids/practice.py](backend/src/routes/kids/practice.py) | 9 |
| `/kids/<id>/lesson-reading/audio/*` | [routes/kids/lesson_reading.py](backend/src/routes/kids/lesson_reading.py) | 2 |
| `/chinese-bank*` | [routes/kids/chinese_bank.py](backend/src/routes/kids/chinese_bank.py) | 4 |

Other blueprints:
- `badges_bp` → [routes/badges.py](backend/src/routes/badges.py)
- `backup_bp` → [routes/backup.py](backend/src/routes/backup.py)
- Auth/family routes → [app.py](backend/src/app.py) directly

### Where helpers live

- **Constants** for the kids domain → [routes/kids_constants.py](backend/src/routes/kids_constants.py). All route modules import via `from src.routes.kids import *` which re-exports constants.
- **Pure helpers** by concern (extracted from kids):
  - [services/writing_audio.py](backend/src/services/writing_audio.py) — TTS audio file paths, prompt synthesis
  - [services/shared_deck_normalize.py](backend/src/services/shared_deck_normalize.py) — tag/card/category normalizers
  - [services/type4_print_layout.py](backend/src/services/type4_print_layout.py) — type-IV print sheet layout math
  - [services/shared_deck_materialize.py](backend/src/services/shared_deck_materialize.py) — materialized shared-deck sync
  - [services/kid_category_config.py](backend/src/services/kid_category_config.py) — kid/category config hydration
  - [services/deck_source_merge.py](backend/src/services/deck_source_merge.py) — source-deck merging, card-count summaries
- **Tangled helpers + module state** still in [routes/kids/__init__.py](backend/src/routes/kids/__init__.py) (8.3k lines) — auth helpers, pending-session locks, `_PENDING_SESSIONS`, `_SHARED_DECK_MUTATION_LOCK`, kid-DB readers reused across routes. Add new helpers to a service module if pure; only put in `__init__.py` if it touches module state.
- **Badges** → [badges/](backend/src/badges/): `definitions.py` (catalog), `service.py` (compute), `session_sync.py` (post-session hook), `admin.py` (super-family ops).
- **DB layer** → [db/](backend/src/db/): `kid_db.py` (per-kid SQLite), `shared_deck_db.py` (shared decks DB), `metadata.py` (family/kid CRUD), schema in `*.sql`.

### Adding a new route — recipe

1. Pick the right module by URL prefix (table above). If none fits, create a new module under `routes/kids/` and add it to the import list at the END of [routes/kids/__init__.py](backend/src/routes/kids/__init__.py).
2. In the module, add `@kids_bp.route('/your-path', methods=['...'])` — `kids_bp` is already imported via `from src.routes.kids import *`.
3. Use existing helpers (`current_family_id()`, `get_kid_for_family()`, `require_critical_password()`, etc.) — they're imported via `*`.
4. For state access (`_PENDING_SESSIONS`, locks), they're underscore-prefixed but `__all__` is built from `globals()` so `import *` re-exports them.
5. New pure helper → `services/<topic>.py`. New stateful helper → `routes/kids/__init__.py`.

## Frontend — where the page code lives

No build step, no ES modules. Each `.html` page loads its `.js` siblings via `<script>` tags in `<head>` order. Functions/consts are global script-scope. Common modules (`practice-manage-common.js`, `kid-report-common.js`, `audio-common.js`, etc.) are loaded before page-specific code.

### Page → file map

| Page | HTML | JS | CSS (per-page) |
|---|---|---|---|
| Family home (admin) | [admin.html](frontend/admin.html) | [admin.js](frontend/admin.js) | — (uses styles.css) |
| Login / register | index.html, family-register.html | family-login.js, family-register.js | — |
| Parent settings (timezone, password, badges, rewards) | [parent-settings.html](frontend/parent-settings.html) | [parent-settings.js](frontend/parent-settings.js) (2.2k — split pending) | kid-badges.css, kid-badge-shelf-modal.css |
| **Kid card management** (deck setup, card list, type-IV gen) | [kid-card-manage.html](frontend/kid-card-manage.html) | **8 files** — see below | [kid-card-manage.css](frontend/kid-card-manage.css) |
| Kid practice runtime | [kid-practice.html](frontend/kid-practice.html) | [kid-practice.js](frontend/kid-practice.js) (3.3k — split pending) | — |
| Kid practice home | kid-practice-home.html | kid-practice-home.js | — |
| Kid reports | kid-report.html, kid-card-report.html, kid-session-report.html | kid-report.js, kid-card-report.js, kid-session-report.js | — |
| Kid badges | kid-badges.html | kid-badges.js, kid-badge-celebration.js | kid-badges.css, kid-badge-celebration.css |
| Deck create / view / manage / category | deck-create*.html, deck-view.html, deck-manage.html, deck-category-create.html | deck-create*.js, deck-view.js, deck-manage.js, deck-category-create.js | — |
| Writing sheets | kid-writing-sheets.html, kid-writing-sheet-manage.html, writing-sheet-print.html | kid-writing-sheets.js, kid-writing-sheet-manage.js (2.7k), writing-sheet-print.js | kid-writing-sheet-manage.css |
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

### Common frontend modules

- [practice-manage-common.js](frontend/practice-manage-common.js) — escapeHtml, math rendering, card markup helpers (1.5k — split pending)
- [kid-report-common.js](frontend/kid-report-common.js) — report rendering shared by report pages
- [deck-category-common.js](frontend/deck-category-common.js) — category labels/icons
- [practice-judge-mode.js](frontend/practice-judge-mode.js), [practice-star-badge-common.js](frontend/practice-star-badge-common.js), [practice-ui-common.js](frontend/practice-ui-common.js) — practice runtime helpers
- [audio-common.js](frontend/audio-common.js), [simple-audio-player.js](frontend/simple-audio-player.js), [recording-visualizer.js](frontend/recording-visualizer.js), [writing-audio-sequence.js](frontend/writing-audio-sequence.js) — audio playback/recording
- [icons.js](frontend/icons.js), [subject-icons.js](frontend/subject-icons.js) — SVG icon registry
- [styles.css](frontend/styles.css) — global stylesheet (2.4k, includes per-page rules that should eventually move out)
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
# Expected: OK 109
```

For frontend changes, run [start-local.sh](start-local.sh) and check the affected page in a browser. There's no automated test suite — verify manually.

## Refactor history

- [refactor.md](refactor.md) — original audit + plan (2026-05-05)
- [refactor_r1.md](refactor_r1.md) — round-1 progress (HTML style extraction, kids.py 3-phase split, kid-card-manage.js split)

Files still pending split per refactor plan: `routes/kids/__init__.py` (8.3k), `kid-practice.js` (3.3k), `kid-writing-sheet-manage.js` (2.7k), `parent-settings.js` (2.2k), `styles.css` (2.4k), `deck-view.js` (1.8k), `practice-manage-common.js` (1.5k).
