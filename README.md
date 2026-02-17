# Kids Daily Chores

Kids Daily Chores is a family learning tool designed for ages 4+, with daily Chinese reading, Chinese writing, and math practice, printable worksheets, and progress tracking.

## Tech Stack

- Backend: Python + Flask + DuckDB
- Frontend: Vanilla JavaScript + HTML/CSS (no build step)
- Auth: Family login (hashed password) + parent-admin gate using the same family password
- Deployment: Railway (Docker + persistent volume)

## Current Architecture

- Multi-family, multi-kid data model
- Family-scoped storage and APIs
- One DuckDB file per kid (columnar DB, handles 10+ years of data easily)
- Family session auth for all API access
- Parent-admin gate for admin/management pages
- Shared metadata file with file-lock + atomic write protection
- Transactional session completion (all-or-nothing writes)
- Schema cached in memory, applied once per DB per process lifetime

Data layout:

```text
backend/data/
  kids.json
  families/
    family_{id}/
      kid_{id}.db
      writing_audio/
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
- Parent access:
  - Parent login is required for admin views (manage cards/settings/backup)
  - Parent login validates against the current family account password
  - Family registration is capped at 10 total families
- CORS:
  - Restricted to origins in `CORS_ORIGINS` env var (defaults to `http://localhost:5001`)

## Core Features

- Family home and kid selection
- Chinese Character Reading practice:
  - Session-based flashcards
  - Right/Wrong flow
  - Response-time logging
  - Queue + hard-card selection
- Math practice:
  - Fixed decks (Addition/Subtraction Within 10/20)
  - Parent sets per-deck question count
  - Prompt/reveal/grade flow for kid sessions
- Chinese Character Writing practice:
  - Parent voice recording + text answer
  - Kid replay prompt, self-mark right/wrong
  - Chinese writing sheets generation/print workflow
  - Sheet status lifecycle (pending/done)
- Practice settings:
  - Per-practice session size/count
  - Global hard-card percentage (in Parent Settings)
  - Practice visibility in kid view is inferred from configured per-session counts
- Bulk card addition:
  - Chinese reading cards: paste/type many characters at once, added in a single API call

## Hardness Logic

- All card decks track `hardness_score`.
- Chinese Reading/Math hard selection: based on response-time driven hardness updates.
- Chinese Writing hard selection: based on lifetime correctness behavior.
- Parent sort options include hardness score descending.

## Database Notes

- Metadata file (`kids.json`) stores:
  - Family accounts
  - Kid profiles
  - Family-to-kid scoping
- Metadata writes are protected with lock + atomic replace to avoid concurrent lost updates
- Kid ID assignment is atomic (inside metadata lock, no race conditions)
- Startup runs metadata cleanup to remove deprecated/unknown config keys
- Per-kid DuckDB stores:
  - Cards/decks
  - Session history
  - Practice state/queue cursor
  - Chinese writing sheets and Chinese writing-related state

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
- Shared JS utilities live in `practice-manage-common.js` (escapeHtml, date utils, card sorting).
- Keep frontend simple (static files served by Flask).
- See `review.md` for the latest codebase review and 10-year scale analysis.
