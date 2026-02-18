# Codebase Review - 2026-02-16

## Bugs (Critical)

- [x] **B1 - Writing sheet ID race condition** — Used `RETURNING id` with sequence instead of `MAX(id)+1`.
- [x] **B2 - Kid ID race condition** — Moved ID assignment inside `_mutate_metadata` lock in `add_kid()`. Removed `next_kid_id()`.
- [x] **B3 - No transaction in session complete** — Wrapped `complete_session_internal` in `BEGIN/COMMIT/ROLLBACK`.

## Security

- [x] **S1 - Weak default secret key** — Changed to `secrets.token_hex(32)` fallback.
- [x] **S2 - XSS via innerHTML** — Added shared `escapeHtml()` in `practice-manage-common.js`, applied to user data in innerHTML, removed 3 duplicate local copies.
- [x] **S3 - Wildcard CORS** — Restricted to configurable `CORS_ORIGINS` env var, defaulting to `localhost:5001`.

## Code Quality

- [x] **Q1 - Duplicated writing sheet query** — `create_writing_sheet` now calls `select_writing_sheet_candidates()`.
- [x] **Q2 - Duplicated JS utilities** — Extracted `calculateAge`, `formatDate`, `parseDateOnly`, `validateBirthday` to `practice-manage-common.js`. Removed duplicates from `app.js` and `admin.js`. Removed debug `console.log` statements.
- [x] **Q3 - Duplicate function sets in kid_db.py** — Removed unused `init_kid_database()`, `get_kid_connection()`, `delete_kid_database()`, `get_kid_db_path()`.
- [x] **Q4 - Duplicated auth guards** — Extracted `require_parent_auth()` helper, used in 4 parent-settings endpoints.
- [x] **Q5 - Duplicate `created_at`/`parent_added_at` field** — Removed `parent_added_at` from backend responses. Updated frontend to use `card.created_at` directly.

## Performance

- [x] **P1 - Schema re-read on every connection** — Cached `schema.sql` in memory. Track initialized DB paths in `_initialized_dbs` set to skip re-running schema/migrations.
- **P2 - N+1 DB connections in `get_kids()`** — Skipped. Each kid has a separate DuckDB file, so N connections are unavoidable. With P1 fix (schema caching), each connection is now cheap. At family scale (2-5 kids) this is negligible.
- **P3 - No indexes on `session_results`** — Skipped. DuckDB is a columnar engine that handles full scans efficiently. At projected 10-year scale (~150K rows per kid), queries stay well under 10ms without indexes.

## 10-Year Scale Analysis

Projected data per kid after 10 years of daily use:
- cards: ~2,000 rows
- sessions: ~15,000 rows (4/day avg)
- session_results: ~150,000 rows (40/day avg)
- DuckDB file size: ~5-10MB

**No performance concerns.** DuckDB handles this scale trivially. No refactoring needed for foreseeable future.

**Data persistence:** Railway Volume is required for data to survive across deploys (container filesystem is ephemeral without it).

---

# Codebase Review - 2026-02-18

## Bugs

- [x] **B4 - Unsafe `.fetchone()[0]` without null check** — Added null-safe pattern on cursor reads in `ensure_practice_state()` and `plan_deck_practice_selection()`.

- [x] **B5 - Redundant deck seeding on every GET request** — Removed `seed_all_lesson_reading_decks(conn)` and `seed_all_math_decks(conn)` calls from card-list GET and practice-start endpoints. Seeding only runs at startup and on explicit seed endpoints.

## Performance

- [x] **P4 - N+1 queries in `get_kids` endpoint** — Combined `get_today_completed_session_counts()` and `has_ungraded_lesson_reading_results()` into single `get_kid_dashboard_stats()` function sharing one DB connection per kid (halves connection count).

- [x] **P5 - Missing indexes on frequently queried columns** — Added indexes: `cards(deck_id)`, `sessions(type, completed_at)`, `session_results(session_id)`, `session_results(card_id)`.

## Code Cleanup

- [x] **Q6 - Dead code in app.py** — Promoted `min_hard_pct`/`max_hard_pct` to `MIN_HARD_PCT`/`MAX_HARD_PCT` constants. Removed unused `is_parent_authenticated()`, `is_parent_page()`, and dead `enforce_parent_auth` branches. Renamed `require_parent_auth` → `require_family_auth`, `enforce_parent_auth` → `enforce_family_auth`.

## Skipped (Not Issues)

- **SQL injection via f-string**: false positive — only used for `','.join(['?'] * len(ids))` placeholder generation, not user input.
- **Metadata race condition**: file-lock prevents concurrent writes, single-process Flask.
- **In-memory pending sessions**: by design — abandoned sessions cleaned up at startup.
- **P3 indexes revisit**: DuckDB columnar engine still handles projected scale without indexes (see 10-year analysis above).

# Refactor Plan (2026-02-18)

- [x] **R1 - Extract shared practice UI helpers** — Added `practice-ui-common.js` for shared `shuffleCards`, `formatElapsed`, and alert-style error handling helper.
- [x] **R2 - Migrate session pages to shared helpers** — Updated kid Chinese Characters, Writing, Math, and Chinese Reading session scripts to use `practice-ui-common.js` helpers and removed duplicated local shuffle/elapsed/error logic.
- [x] **R3 - Ensure shared script wiring** — Loaded `practice-ui-common.js` in all relevant session HTML pages before page-specific scripts.
- [x] **R4 - Verify duplication reduction** — Re-scanned migrated session files; duplicate local `shuffleSessionCards`, local lesson `formatElapsed`, and alert-logic duplication were removed.

### Phase 2

- [x] **R5 - Extract shared recording visualizer module** — Added `recording-visualizer.js` and switched both `kid-writing-manage.js` and `kid-lesson-reading.js` to shared start/stop/resize waveform rendering.
- [x] **R6 - Simplify session controller scaffolding** — Added `practice-session-flow.js` with shared start/complete helpers and migrated session start flow in all four kid practice scripts (plus complete flow in reading/writing/math).
- [x] **R7 - Consolidate duplicated inline session CSS** — Moved shared practice-page header/back/button/start/session-title styles into `styles.css` and removed duplicated inline blocks from `kid.html`, `kid-writing.html`, `kid-math.html`, and `kid-lesson-reading.html`.
- [x] **R8 - Move backend legacy row fixups out of request path** — Completed in two steps:
  1) moved legacy repair to startup-only flow;
  2) after confirming pre-release/single-family usage, removed the startup legacy-repair hook and deleted related legacy repair helpers/constants from backend.
