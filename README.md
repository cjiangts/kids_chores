# Kids Daily Practice

A family learning tool for ages 4+: daily Chinese character reading, Chinese writing, lesson-passage reading, and math practice, with printable worksheets, parent grading, and progress tracking.

## Tech Stack

- **Backend:** Python + Flask + DuckDB
- **Frontend:** Vanilla JavaScript + HTML/CSS (no build step, no bundler)
- **Auth:** Family login (hashed password), password confirmation for destructive operations
- **Deployment:** Railway (Docker + persistent volume)

---

## Architecture Overview

### Data layout

```
backend/data/
  kids.json                        ← shared metadata (families, kids, lightweight settings)
  shared_decks.duckdb              ← shared deck library (all families)
  shared/
    writing_audio/                 ← shared TTS audio for type-II writing cards
  families/
    family_{id}/
      kid_{id}.db                  ← per-kid DuckDB (all learning data)
      lesson_reading_audio/        ← per-kid audio recordings (type-III)
```

**Three storage layers:**
- `kids.json` — metadata only (family accounts, kid profiles, settings). Writes use `fcntl` file-lock + atomic rename.
- `shared_decks.duckdb` — admin-created shared decks and category definitions. One writer at a time (DuckDB embedded).
- `kid_{id}.db` — per-kid DuckDB: cards, sessions, results, writing sheets, audio metadata. Isolated per family.

### Practice behavior types

Every deck category has a `behavior_type` that controls which practice flow is used:

| `behavior_type` | Practice flow | Example categories |
|-----------------|--------------|-------------------|
| `type_i` | Flashcard: show front → reveal back → right/wrong | Chinese characters (四五快读, 马立平), math |
| `type_ii` | Audio prompt → self-mark + writing sheets | Writing characters (马立平 学前班–马三) |
| `type_iii` | Read passage aloud → record audio → parent grades | Lesson reading (马立平 马三 Units 1–3) |

Categories and behavior types are defined in `shared_decks.duckdb` (`deck_category` table) by super-family admins. Each kid opts into the categories they want to practice, stored in `deck_category_opt_in` per kid DB.

### Frontend page map

| Page | File | Purpose |
|------|------|---------|
| Family home / kid selection | `family-home.html` | Entry point after login |
| Kid practice home | `kid-practice-home.html/js` | All opted-in category buttons |
| Unified practice session | `kid-practice.html/js` | Handles type-I, II, III in one file |
| Card & deck management | `kid-card-manage.html/js` | Shared manage UI for all behavior types |
| Writing sheets | `kid-writing-sheets.html/js` | Print/track writing practice sheets |
| Kid report | `kid-report.html/js` | Daily practice chart per category |
| Session report | `kid-session-report.html/js` | Per-session card-level detail |
| Card report | `kid-card-report.html/js` | Per-card attempt history + trend |
| Deck management (admin) | `deck-manage.html/js` | Browse/edit shared decks |
| Deck creation | `deck-create.html/js` | Create single shared deck |
| Bulk deck creation | `deck-create-bulk.html/js` | Bulk import decks from text |
| Category management | `deck-category-create.html/js` | Create/share deck categories |
| Parent settings | `parent-settings.html/js` | Timezone, password change |
| Admin dashboard | `admin.html/js` | Family storage, grading queue |

### Backend route structure

All routes live in `backend/src/routes/kids.py`.

| Route prefix | Responsibility |
|-------------|----------------|
| `/api/family-auth/` | Login, logout, register (`app.py`) |
| `/api/shared-decks/` | Shared deck CRUD, category management |
| `/api/kids/` | Kid CRUD, reports |
| `/api/kids/<id>/<scope>/shared-decks` | Unified deck opt-in/out per scope |
| `/api/kids/<id>/cards/practice/` | Type-I practice start/complete |
| `/api/kids/<id>/type2/` | Type-II: cards, sheets, audio, practice |
| `/api/kids/<id>/lesson-reading/` | Type-III: audio, practice |
| `/api/backup/` | Backup and restore (`backup.py`) |

### Shared deck scope dispatch

All six shared-deck operations use a single parameterized dispatch chain:

```
GET /kids/<kid_id>/<scope>/shared-decks
         ↓
dispatch_shared_deck_scope_operation(scope, operation, kid_id)
         ↓
SHARED_DECK_OPERATION_HANDLERS[operation](kid_id, category_config)
```

`scope` maps to a category config dict. No per-type route duplication.

### Shared frontend utilities

- `practice-manage-common.js` — loaded by all pages. Provides `escapeHtml`, date utilities, password dialog, card sorting, hardness slider.
- `deck-category-common.js` — category key normalization, type-II URL builder, behavior-type constants.
- `audio-common.js` — microphone constraints, MediaRecorder options, graceful stop helper.
- `practice-session-flow.js`, `practice-session.js`, `practice-ui-common.js`, `practice-judge-mode.js`, `practice-progress.js` — practice lifecycle modules shared by `kid-practice.js`.

---

## Quick Start (Local)

```bash
cd backend
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
PYTHONPATH=. python src/app.py
```

Open `http://localhost:5001`. Or use helper scripts from project root:

```bash
./start-local.sh
./stop-local.sh
```

---

## Authentication

- **Family account:** username + password, stored as Werkzeug `pbkdf2:sha256` hash.
- **Session cookie:** `HttpOnly`, `SameSite=Lax`; `Secure` when `FLASK_ENV=production`.
- **Destructive operations** (delete kid/card, restore backup, deck opt-out): require `X-Confirm-Password` header verified server-side. Acts as both auth confirmation and implicit CSRF protection.
- **Super-family:** can manage all families via admin dashboard.
- **Family registration cap:** 10 families.
- **CORS:** restricted to `CORS_ORIGINS` env var (default: `http://localhost:5001`).

> **Known gap:** No rate limiting on login or password verification. Brute-force protection is not implemented. See `review.md`.

---

## Practice Flows

### Type-I (flashcard)
Front shown → kid thinks → tap to reveal back → parent marks right/wrong → response time logged. Hard-card selection biased toward high hardness score. Bonus matching game for Chinese character categories on wrong cards.

### Type-II (writing)
Shared TTS audio prompt plays → kid writes character → self-marks right/wrong. Separate writing-sheet workflow: select cards → generate printable sheet → print → mark done. Bulk import splits pasted Chinese text into individual cards.

### Type-III (lesson reading)
Kid reads passage aloud while recording (live waveform visualizer). Review phase: replay, re-record, or accept. All audio batch-uploaded on session complete. Parent grades each recording (pass / fail / ungraded). Admin dashboard shows pending grading queue.

---

## Hardness Logic

- All decks track `hardness_score` (float) per card in the kid DB.
- **Type-I/III:** hardness updated from response-time distribution after each session.
- **Type-II:** hardness updated from correctness history.
- Hard-card percentage per category configured per kid; controls fraction of session cards from high-hardness pool.

---

## Database Notes

**`kids.json`:** Families, kids, settings. Writes use `fcntl.LOCK_EX` + `os.replace` (atomic). Kid ID assignment is inside the lock.

**`shared_decks.duckdb`:** Tables: `deck`, `deck_category`, `cards`. Schema applied once per process via `_initialized_dbs` set. Connection opened fresh per request (DuckDB embedded, no pool needed).

**`kid_{id}.db`:** Tables: `decks`, `cards`, `sessions`, `session_results`, `lesson_reading_audio`, `writing_sheets`, `writing_sheet_cards`, `deck_category_opt_in`. `deck_category_opt_in` stores per-category session count, hard-card percentage, include-orphan flag. No FK constraint on `cards.deck_id` — integrity enforced in application code.

---

## Deployment (Railway)

```bash
./deploy.sh
```

Checks for uncommitted changes, prompts to commit, pushes to `origin/main`. Railway builds via `Dockerfile`.

**Railway Volume required** — container filesystem is ephemeral.

Environment variables:

| Variable | Default | Notes |
|----------|---------|-------|
| `FLASK_SECRET_KEY` | auto-generated | Set explicitly in production for session persistence across restarts |
| `CORS_ORIGINS` | `http://localhost:5001` | Comma-separated allowed origins |
| `FLASK_ENV` | unset | Set to `production` to enable Secure cookies |
| `PORT` | `5001` | Railway sets this automatically |

---

## Development Notes

- `PYTHONPATH=.` required when running Flask from `backend/`.
- Every route touching kid data must call `get_kid_for_family(kid_id)` — validates kid belongs to authenticated family.
- No FK constraints on kid DB cards — integrity enforced in app code (DuckDB FK edge cases).
- Legacy audio paths permanently removed. Do not add fallback logic for old layouts.
- One-time migrations live in `backend/scripts/` — not in startup code.
- `escapeHtml` is defined once in `practice-manage-common.js` and loaded globally — do not add per-file copies.
- See `review.md` for current code review and open issues.
