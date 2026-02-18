# Kids Daily Chores

Kids Daily Chores is a family learning tool designed for ages 4+, with daily Chinese character reading, Chinese writing, Chinese reading (lesson passages), and math practice, printable worksheets, parent grading, and progress tracking.

## Tech Stack

- Backend: Python + Flask + DuckDB
- Frontend: Vanilla JavaScript + HTML/CSS (no build step)
- Auth: Family login (hashed password), password confirmation for destructive operations
- Deployment: Railway (Docker + persistent volume)

## Current Architecture

- Multi-family, multi-kid data model
- Family-scoped storage and APIs
- One DuckDB file per kid (columnar DB, handles 10+ years of data easily)
- Family session auth for all API access
- Password confirmation for destructive operations (delete kid/card, restore backup)
- Shared metadata file with file-lock + atomic write protection
- Transactional session completion (all-or-nothing writes, batch audio upload)
- Schema cached in memory, applied once per DB per process lifetime
- Startup auto-migrations for schema evolution across deploys

Data layout:

```text
backend/data/
  kids.json
  families/
    family_{id}/
      kid_{id}.db
      writing_audio/
      lesson_reading_audio/
```

Important:

- `backend/data/kids.json` is shared metadata only (families + kids + lightweight settings).
- Per-kid learning data is isolated in each kid DuckDB file under the owning family folder.
- Backup/restore endpoints are family-scoped (cannot restore another family backup).

## Quick Start (Local)

1. Create/activate virtual environment and install deps:

```bash
cd backend
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
```

2. Run backend:

```bash
cd backend
source venv/bin/activate
PYTHONPATH=. python src/app.py
```

3. Open app:

- `http://localhost:5001`

Or use helper scripts from project root:

- `./start-local.sh`
- `./stop-local.sh`

## Authentication Model

- Family account:
  - Register/login with username + password
  - Password stored as Werkzeug hash (not plaintext)
  - Session cookie used for authenticated requests
  - Secret key: set `FLASK_SECRET_KEY` env var (auto-generates random key if not set)
  - Family registration is capped at 10 total families
- Destructive operations:
  - Delete kid, delete card, and restore backup require family password confirmation
  - Password sent via `X-Confirm-Password` header, verified server-side
  - Frontend shows a modal password dialog (replaces browser `confirm()`)
- CORS:
  - Restricted to origins in `CORS_ORIGINS` env var (defaults to `http://localhost:5001`)

## Core Features

- Family home and kid selection
- Chinese Characters practice:
  - Session-based flashcards (character on front, pinyin on back)
  - Right/Wrong flow
  - Response-time logging
  - Queue + hard-card selection
- Math practice:
  - Fixed decks (Addition/Subtraction Within 10/20)
  - Parent sets per-deck question count in a unified settings grid
  - Prompt/reveal/grade flow for kid sessions
- Chinese Writing practice:
  - Parent voice recording with live waveform visualizer + text answer
  - Kid replays prompt, self-marks right/wrong
  - Chinese writing sheets generation/print workflow
  - Sheet status lifecycle (pending/done)
  - Bulk import: paste text, auto-splits Chinese chunks, deduplicates
- Chinese Reading practice (lesson passages):
  - Preset decks (e.g. Ma3 Units 1-3) with multi-page reading passages
  - Kid records audio reading aloud, with live waveform visualizer
  - Review phase after recording: replay, re-record, or continue
  - All recordings batch-uploaded on session complete (multipart)
  - Parent grading: tri-state scoring (pass/fail/ungraded)
  - Admin dashboard shows "Review Chinese Reading" when ungraded results exist
- Practice settings:
  - Per-practice session size/count
  - Global hard-card percentage (in Family Settings)
  - Practice visibility in kid view is inferred from configured per-session counts
  - Family timezone setting for report date formatting
- Progress tracking:
  - Per-kid report with daily practice chart
  - Session detail reports with per-card links
  - Card-level report with attempt history, trend chart, and best time
  - Session timing tracked from client-side start to completion

## Hardness Logic

- All card decks track `hardness_score`.
- Chinese Characters/Math hard selection: based on response-time driven hardness updates.
- Chinese Writing hard selection: based on lifetime correctness behavior.
- Parent sort options include hardness score descending.

## Presets

- Chinese Characters: 四五快读, 马立平
- Chinese Writing: 马立平 (学前班 through 马三)
- Chinese Reading: 马立平 马三 Units 1-3

## Database Notes

- Metadata file (`kids.json`) stores:
  - Family accounts
  - Kid profiles
  - Family-to-kid scoping
  - Family settings (timezone, hard-card percentage)
- Metadata writes are protected with lock + atomic replace to avoid concurrent lost updates
- Kid ID assignment is atomic (inside metadata lock, no race conditions)
- Startup runs metadata cleanup to remove deprecated/unknown config keys
- Per-kid DuckDB stores:
  - Cards/decks
  - Session history and results (with tri-state correct scoring)
  - Practice state/queue cursor
  - Chinese writing sheets and audio metadata
  - Lesson reading audio metadata
- Startup auto-migrations:
  - Backfill session `started_at` from response time totals
  - Convert `session_results.correct` from boolean to integer
  - Rebuild `lesson_reading_audio` table without FK constraint
  - Sync ID sequences to prevent PK collisions after restore
  - Cleanup incomplete sessions (delete orphaned results and audio)

## Deployment (Railway)

- Primary path: push to `main` and let Railway build via `Dockerfile`
- **Railway Volume required** for data persistence across deploys (container filesystem is ephemeral without it)
- Helper:

```bash
./deploy.sh
```

The deploy script checks for uncommitted changes, prompts to commit, and pushes to `origin/main`.

Related config:

- `Dockerfile`
- `railway.json`

Environment variables (optional):

- `FLASK_SECRET_KEY` — session signing key (auto-generated if not set)
- `CORS_ORIGINS` — comma-separated allowed origins (defaults to `http://localhost:5001`)

## Development Notes

- `PYTHONPATH=.` is required when running Flask from `backend/`.
- Keep family scoping strict for every data/backup API.
- Shared JS utilities live in `practice-manage-common.js` (escapeHtml, date utils, card sorting, password dialogs).
- Keep frontend simple (static files served by Flask).
- See `review.md` for the latest codebase review and 10-year scale analysis.
