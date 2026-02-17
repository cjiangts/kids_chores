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
