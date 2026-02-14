# Project Learning Documentation

## Overview
This file documents key learnings, patterns, and insights discovered while working on this project.

---

## Project Information
- **Started**: 2026-02-13
- **Location**: `/Users/chen/Library/Mobile Documents/com~apple~CloudDocs/Project`
- **Git**: ✅ Initialized with proper .gitignore
- **Tech Stack**: Python (Flask + DuckDB) backend, React frontend (planned)

---

## Key Learnings

### Architecture & Patterns
- **Multi-kid architecture**: Each kid gets their own DuckDB file for data isolation
- **Metadata layer**: kids.json stores kid profiles, points to individual .db files
- **Flask Blueprint pattern**: Organized routes into separate modules (kids.py, etc.)
- **Local-first design**: All data stored locally, no cloud dependency

### Technical Discoveries
- **Node.js vs Python**: Chose Python backend since more familiar, performance difference negligible for local app
- **DuckDB setup**: Uses native DuckDB library (not WASM), creates separate .db files per kid
- **Git ignore retroactive**: Files already staged need `git rm -r --cached` to respect new .gitignore rules

### Best Practices
- **Virtual environment**: Always use venv for Python projects to isolate dependencies
- **PYTHONPATH**: Set `PYTHONPATH=.` when running Flask app to resolve module imports
- **Git aliases**: Created `git st` → `git status -s` for faster workflow
- **Structured logging**: Flask debug mode for development, structured API responses

### Common Issues & Solutions
- **Xcode license**: Need to accept license before using Python tools on macOS (`sudo xcodebuild -license`)
- **Git ignoring venv**: Must unstage already-committed files with `git rm -r --cached backend/venv`
- **Flask imports**: Use `from src.db import metadata` format when PYTHONPATH includes project root

### Tools & Technologies
- **Backend**: Python 3.9.6, Flask 3.0.0, DuckDB 0.10.0, Flask-CORS
- **Database**: DuckDB (embedded SQL database, one file per kid)
- **Git**: Configured with custom aliases and comprehensive .gitignore
- **IDE**: VS Code in macOS environment

---

## Session Notes

### 2026-02-13 - Project Setup
**Goal**: Set up backend infrastructure for kids learning app

**Accomplished**:
- ✅ Created project structure (backend/ folder with src/, routes/, db/)
- ✅ Set up Python virtual environment (venv)
- ✅ Installed dependencies: Flask, DuckDB, Flask-CORS
- ✅ Built metadata manager (kids.json handler) - [backend/src/db/metadata.py](backend/src/db/metadata.py)
- ✅ Built DuckDB connection manager - [backend/src/db/kid_db.py](backend/src/db/kid_db.py)
- ✅ Created database schema (decks, cards, sessions) - [backend/src/db/schema.sql](backend/src/db/schema.sql)
- ✅ Implemented Kid API endpoints (GET/POST/DELETE) - [backend/src/routes/kids.py](backend/src/routes/kids.py)
- ✅ Created Flask app with CORS - [backend/src/app.py](backend/src/app.py)
- ✅ Configured git with .gitignore
- ✅ Created git alias: `git st` → `git status -s`
- ✅ Documented everything in README.md

**Key Decisions**:
- Chose Python backend over Node.js (more familiar, adequate performance)
- DuckDB over SQLite (better array support for tags)
- Separate .db file per kid (data isolation, easy backup)

**Next Session**:
- Build React frontend (kid selection page)
- Implement flashcard deck management
- Create quiz mode

---

## Resources & References
<!-- Links to documentation, tutorials, or resources that were helpful -->

---

## TODO / Open Questions
<!-- Track outstanding questions or things to investigate -->
