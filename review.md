# Code Review — Round 3 (2026-03-04)

## Progress since last review

- `resolve_kid_category_with_mode` (L2062) now exists as a single dispatcher — all three type resolvers delegate to it ✓
- `dispatch_shared_deck_scope_operation` + `SHARED_DECK_OPERATION_HANDLERS` collapses 18 routes to 6 parameterized routes ✓
- `get_or_create_category_orphan_deck` unified helper in place (L874) ✓
- `buildCardMarkup` common builder in `kid-card-manage.js` — the three thin wrappers all delegate to it ✓
- `escapeHtml` defined once in `practice-manage-common.js` L1, loaded globally in all pages that need it ✓
- `kid-practice.js` unifies type-I, type-II, type-III practice into one file with a dispatch pattern ✓

---

## Current sizes

| File | Lines |
|------|-------|
| `backend/src/routes/kids.py` | 7309 |
| `frontend/kid-practice.js` | 1866 |
| `frontend/kid-card-manage.js` | 1766 |
| `frontend/practice-manage-common.js` | 1257 |

---

## Security

### 1. No rate limiting on login or password verification (High)

`app.py` login endpoint and `require_critical_password()` (kids.py L300) call `metadata.verify_family_password()` with no attempt tracking, delay, or lockout.

**Attack:** An attacker who knows a family ID can brute-force the password at full request speed. Family IDs are sequential integers and returned in API responses to authenticated users, so they aren't secret.

**Fix options (pick one):**
- Flask-Limiter: `@limiter.limit("5 per minute")` on the login route and any route using `require_critical_password()`.
- In-process: a `collections.defaultdict(deque)` keyed by IP + family_id, tracking timestamps of failed attempts, rejecting after N failures in a window.

Destructive operations (delete kid, restore backup, deck opt-out) all go through `require_critical_password()` so they're all exposed.

### 2. CSRF — partial protection only (Medium)

`SESSION_COOKIE_SAMESITE = 'Lax'` (app.py L28) prevents most cross-site POST attacks because browsers don't send Lax cookies on cross-site POSTs. However:
- SameSite=Lax does NOT protect cross-site navigations that result in GET requests
- iOS/older Safari has SameSite bugs
- No CSRF token is validated anywhere

For a family app on a private domain this risk is low, but the `X-Confirm-Password` header acts as an implicit CSRF token for destructive operations, which is reasonable.

**Recommendation:** Document this explicitly in README. No immediate code change required, but add `SESSION_COOKIE_SECURE = True` unconditionally (not gated on FLASK_ENV) since Railway always serves over HTTPS.

### 3. `SESSION_COOKIE_SECURE` gated on env var (Low)

```python
# app.py L29
app.config['SESSION_COOKIE_SECURE'] = os.environ.get('FLASK_ENV') == 'production'
```

If `FLASK_ENV` is not set (or misspelled), cookies are sent over HTTP. On Railway this doesn't matter because the platform enforces HTTPS, but it's fragile. Set it unconditionally to `True` in production Docker builds or use a `RAILWAY_ENVIRONMENT` check.

### 4. Audio path validation is correct — note for future (Informational)

Both audio serve endpoints (L6510, L6589) correctly check `file_name != os.path.basename(file_name)` before calling `send_from_directory`. This is the right pattern. If new audio endpoints are added, they must follow the same pattern.

---

## Likely dead endpoint

### `complete_practice_session` at L7588

Route: `POST /kids/<kid_id>/practice/complete`

The current frontend (`kid-practice.js`) hits:
- `/kids/<kid_id>/cards/practice/complete` (type-I)
- `/kids/<kid_id>/type2/practice/complete` (type-II)
- `/kids/<kid_id>/lesson-reading/practice/complete` (type-III)

No frontend code calls `/kids/<kid_id>/practice/complete`. This endpoint resolves `resolve_kid_type_i_chinese_category_key` with `allow_default=True`, which suggests it was the old generic Chinese-characters endpoint.

**Verify:** Grep all frontend `.js` files for `/practice/complete` — if nothing hits the bare `/kids/<kid_id>/practice/complete` path, delete this route and the function. Dead route handlers are maintenance burden and attack surface.

---

## Performance

### 5. N+1 query in `get_kid_daily_completed_by_deck_category` (Low)

`kids.py` L2166–2208: one SQL query per opted-in category key in a loop.

```python
for key in keys:
    row = conn.execute(
        "SELECT COUNT(*) FROM sessions WHERE type = ? AND ...",
        [day_start_utc, day_end_utc, key]
    ).fetchone()
```

For a typical kid with 2–4 opted-in categories this is fine. But it could be one query:

```sql
SELECT type, COUNT(*) FROM sessions
WHERE type = ANY(?) AND completed_at >= ? AND completed_at < ?
GROUP BY type
```

Not urgent, but straightforward to fix and future-proof if category count grows.

### 6. Audio synthesis runs synchronously on the request path (Low)

`synthesize_shared_writing_audio()` (L175) is called during the card-serve request if the audio file doesn't exist. It calls gTTS or edge-tts, which makes an outbound HTTP/WebSocket call, blocking the Flask worker for the full TTS round-trip.

**Risk:** One slow TTS call blocks a Flask worker thread for several seconds. Under concurrent load, this can exhaust the worker pool.

**Fix:** Pre-generate audio on card creation, not on first serve. The bulk import and card-add routes already call synthesis — verify that audio is always synthesized eagerly at write time so the serve path never needs to synthesize.

### 7. DuckDB connection opened fresh per request (Informational)

Every route opens a new DuckDB connection via `get_kid_connection_for(kid)` and closes it in a `try/finally`. This is normal for DuckDB (it's an embedded DB, not a connection-pool server). The pattern is correct as long as every code path reaches the `finally`. Spot-check: any early `return` before the `try` block would leak a connection. The helper at L294–297 wraps this so it's consistent — no action needed.

---

## Code quality and architecture

### 8. `kids.py` at 7309 lines is a maintenance liability

55 routes and 246 functions in one file. When a bug appears or a new feature is added, it's hard to know where to look, and the entire file must be parsed by any reader (including this review agent).

Natural split points along existing internal module boundaries:

| Proposed file | Current home | Approx lines |
|---------------|-------------|-------------|
| `routes/shared_decks.py` | Shared deck CRUD, category CRUD | ~1200 |
| `routes/writing.py` | Type-II cards, sheets, audio, practice | ~1100 |
| `routes/lesson_reading.py` | Type-III audio, practice | ~400 |
| `routes/practice.py` | Session start/complete, card selection | ~600 |
| `routes/kids_core.py` | Kid CRUD, deck categories, reports | ~800 |
| `routes/kids_helpers.py` | Internal helpers, normalization fns | ~3200 |

This is the single highest-leverage structural improvement remaining. It doesn't change any behavior.

### 9. Three URL builders in `kid-practice.js` are inconsistent (Low)

```javascript
function buildType1ApiUrl(pathSuffix) {
    return `${API_BASE}/kids/${kidId}/cards/${cleanSuffix}`;   // base: /cards/
}
function buildType3ApiUrl(pathSuffix) {
    return `${API_BASE}/kids/${kidId}/lesson-reading/${cleanSuffix}`;  // base: /lesson-reading/
}
function buildType2ApiUrl(path) {
    return window.DeckCategoryCommon.buildType2ApiUrl(...);  // delegates to external helper
}
```

Type-II delegates to an external helper in `DeckCategoryCommon` while type-I and type-III are inline. This is because type-II routes are under `/kids/<kid_id>/type2/` while type-I uses `/kids/<kid_id>/cards/`. If you ever normalize the backend route structure (e.g., `/kids/<kid_id>/practice/<type>/...`), the URL builder pattern will unify naturally. For now it's acceptable — just document why type-II is different.

### 10. `get_shared_type1_cards` (L4990) is now a handler, not a route — but still named confusingly

The function was converted from a registered route to a dispatch handler. Its name starts with `get_shared_` which implies it was once a route handler. Now that it's an internal handler function, renaming to `_get_type1_shared_cards_payload` (or similar) would clarify its role. Same applies to similar functions in the dispatch table.

### 11. Missing index for session completion time range queries

`schema.sql` has:
```sql
CREATE INDEX IF NOT EXISTS idx_sessions_type_completed ON sessions(type, completed_at);
```

The daily completed count query filters `WHERE type = ? AND completed_at >= ? AND completed_at < ?`. This index covers it — good. But `session_results` only has `idx_session_results_card_id` and `idx_session_results_session_id`. If report queries do `WHERE session_id IN (...)` with a large subquery, the existing index is fine. No action needed — just confirm report queries don't filter `session_results` by timestamp directly without going through `sessions`.

---

## Action plan (updated)

| # | Task | Priority | Category |
|---|------|----------|----------|
| 1 | Add rate limiting to login + `require_critical_password()` | 🔴 High | Security |
| 2 | Set `SESSION_COOKIE_SECURE = True` unconditionally | 🟡 Medium | Security |
| 3 | Verify and delete `complete_practice_session` L7588 if dead | 🟡 Medium | Dead code |
| 4 | Split `kids.py` (7309 lines) into 5–6 route files | 🟡 Medium | Architecture |
| 5 | Replace N+1 loop in `get_kid_daily_completed_by_deck_category` with GROUP BY | 🟢 Low | Performance |
| 6 | Verify audio is always synthesized at write time (not lazily at serve time) | 🟢 Low | Performance |
| 7 | Rename dispatch handler functions to internal naming convention (`_`) | 🟢 Low | Code quality |
| 8 | Document type-II URL builder divergence in a comment | 🟢 Low | Code quality |
