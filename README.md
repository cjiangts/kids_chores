# Kids Learning Web App

Local-first educational web app for families, with multi-family accounts, multi-kid profiles, Chinese reading/writing practice, math practice, session tracking, and printable writing sheets.

## Tech Stack

- Backend: Python + Flask + DuckDB
- Frontend: Vanilla JavaScript + HTML/CSS (no build step)
- Auth: Family login (hashed password) + Parent PIN for admin pages
- Deployment: Railway (Docker)

## Current Architecture

- Multi-family, multi-kid data model
- Family-scoped storage and APIs
- One DuckDB file per kid
- Family session auth for all API access
- Parent PIN gate for admin/management pages

Data layout:

```text
backend/data/
  kids.json
  families/
    family_{id}/
      kid_{id}.db
      writing_audio/
```

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

- `http://localhost:5000`

Or use helper scripts from project root:

- `./start-local.sh`
- `./stop-local.sh`

## Authentication Model

- Family account:
  - Register/login with username + password
  - Password stored as Werkzeug hash (not plaintext)
  - Session cookie used for authenticated requests
- Parent access:
  - Separate parent PIN required for admin views (manage cards/settings/backup)

## Core Features

- Family home and kid selection
- Chinese Character Reading practice:
  - Session-based flashcards
  - Right/Wrong flow
  - Response-time logging
  - Queue + hard-card selection
- Math practice:
  - Prompt/reveal/grade flow
  - Session stats and card management
- Chinese Character Writing practice:
  - Parent voice recording + text answer
  - Kid replay prompt, self-mark right/wrong
  - Writing sheets generation/print workflow
  - Sheet status lifecycle (pending/done)
- Practice settings:
  - Session size
  - Hard-card percentage
  - Per-practice daily enable/disable

## Hardness Logic

- All card decks track `hardness_score`.
- Reading/Math hard selection: based on response-time driven hardness updates.
- Writing hard selection: based on lifetime correctness behavior.
- Parent sort options include hardness score descending.

## Database Notes

- Metadata file (`kids.json`) stores:
  - Family accounts
  - Kid profiles
  - Family-to-kid scoping
- Per-kid DuckDB stores:
  - Cards/decks
  - Session history
  - Practice state/queue cursor
  - Writing sheets and writing-related state

## Deployment (Railway)

- Primary path: push to `main` and let Railway build via `Dockerfile`
- Helper:

```bash
./deploy.sh
```

Related config/docs:

- `Dockerfile`
- `railway.json`
- `RAILWAY-DEPLOY.md`

## Project Structure

```text
.
├── backend/
│   ├── requirements.txt
│   ├── run.sh
│   ├── data/
│   │   ├── kids.json
│   │   ├── debug.ipynb
│   │   └── families/
│   │       ├── family_1/
│   │       │   ├── kid_1.db
│   │       │   └── kid_2.db
│   │       └── family_2/
│   │           └── kid_3.db
│   └── src/
│       ├── app.py
│       ├── db/
│       │   ├── kid_db.py
│       │   ├── metadata.py
│       │   └── schema.sql
│       └── routes/
│           ├── backup.py
│           └── kids.py
├── frontend/
│   ├── index.html
│   ├── app.js
│   ├── styles.css
│   ├── family-home.html
│   ├── family-login.js
│   ├── family-register.html
│   ├── family-register.js
│   ├── parent-login.html
│   ├── parent-login.js
│   ├── admin.html
│   ├── admin.js
│   ├── kid.html
│   ├── kid.js
│   ├── kid-manage.html
│   ├── kid-manage.js
│   ├── kid-math.html
│   ├── kid-math.js
│   ├── kid-math-manage.html
│   ├── kid-math-manage.js
│   ├── kid-writing.html
│   ├── kid-writing.js
│   ├── kid-writing-manage.html
│   ├── kid-writing-manage.js
│   ├── kid-writing-sheets.html
│   ├── kid-writing-sheets.js
│   ├── writing-sheet-print.html
│   ├── writing-sheet-print.js
│   └── practice-manage-common.js
├── Dockerfile
├── railway.json
├── RAILWAY-DEPLOY.md
├── deploy.sh
├── start-local.sh
└── stop-local.sh
```

## Development Notes

- `PYTHONPATH=.` is required when running Flask from `backend/`.
- Keep family scoping strict for every data/backup API.
- Prefer shared practice logic/utilities where behavior overlaps.
- Keep frontend simple (static files served by Flask).
