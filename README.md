# Kids Learning Web App

A local-first educational web app for family use with flashcards, math practice, and Chinese writing sheets. Each kid gets their own profile with data stored in separate DuckDB files.

## Tech Stack

- **Backend**: Python + Flask + DuckDB
- **Frontend**: React + TypeScript + Vite (coming soon)
- **Database**: DuckDB (one file per kid)

## Project Structure

```
.
├── backend/           # Python Flask API
│   ├── src/
│   │   ├── app.py              # Main Flask app
│   │   ├── routes/
│   │   │   └── kids.py         # Kid management endpoints
│   │   └── db/
│   │       ├── metadata.py     # kids.json handler
│   │       ├── kid_db.py       # DuckDB connection manager
│   │       └── schema.sql      # Database schema
│   ├── data/                   # DuckDB files (git-ignored)
│   ├── requirements.txt
│   └── run.sh                  # Startup script
├── frontend/          # React app (coming soon)
└── claude.me          # Learning notes
```

## Quick Start

### Backend Setup

1. **Install dependencies** (first time only):
   ```bash
   cd backend
   python3 -m venv venv
   source venv/bin/activate
   pip install -r requirements.txt
   ```

2. **Run the server**:
   ```bash
   cd backend
   source venv/bin/activate
   PYTHONPATH=. python src/app.py
   ```

   Server will start at: http://localhost:5000

3. **Test the API**:
   ```bash
   # Health check
   curl http://localhost:5000/health

   # Get all kids
   curl http://localhost:5000/api/kids

   # Create a kid
   curl -X POST http://localhost:5000/api/kids \
     -H "Content-Type: application/json" \
     -d '{"name": "Alice", "birthday": "2015-06-15"}'
   ```

### Frontend Setup

*(Coming soon - React app with kid selection and flashcards)*

## API Endpoints

### Kids Management

- `GET /api/kids` - List all kids
- `POST /api/kids` - Create new kid (requires: name, birthday)
- `GET /api/kids/:id` - Get kid details
- `DELETE /api/kids/:id` - Delete kid and their database

### Flashcards (Coming Soon)

- `GET /api/kids/:kid_id/decks` - List kid's flashcard decks
- `POST /api/kids/:kid_id/decks` - Create new deck
- `GET /api/kids/:kid_id/decks/:deck_id/cards` - List cards in deck
- `POST /api/kids/:kid_id/decks/:deck_id/cards` - Add card to deck

## Git Aliases

Useful shortcuts configured:
- `git st` → `git status -s`

Add more with:
```bash
git config --global alias.co checkout
git config --global alias.br branch
git config --global alias.ci commit
```

## Data Storage

- **kids.json**: Metadata for all kids (name, birthday, DB file path)
- **kid_{uuid}.db**: Individual DuckDB file for each kid containing:
  - Flashcard decks and cards
  - Quiz sessions and results
  - Math practice configs
  - Writing practice sheets

## Development

### Current Status

✅ Python backend with Flask + DuckDB
✅ Kid profile API
✅ Database schema
✅ Git configuration
⏳ React frontend
⏳ Flashcard feature
⏳ Math practice
⏳ Writing sheets

### Next Steps

1. Build React frontend with kid selection page
2. Implement flashcard deck management
3. Create quiz mode
4. Add Chinese writing sheet generator

## Notes

- All data is stored locally (no cloud/accounts)
- Each kid's data is isolated in their own DuckDB file
- Easy to backup: just copy the `backend/data/` folder
