# Refactor TODO (Practice Pages / Naming / Shared UI)

## Current Context (Do Not Forget)

- Chinese Characters practice was redesigned to v2 (shared deck opt-in + orphan deck).
- Early finish exists on all kid practice pages now:
  - Chinese Characters
  - Math
  - Chinese Writing
  - Chinese Reading (lesson reading)
- Early finish confirm logic is already shared in `frontend/practice-ui-common.js` via:
  - `confirmEarlyFinish(...)`
  - `createEarlyFinishController(...)`
- Practice mode (`Kids Self` vs `Parent Assisted`) is shared for Math + Chinese Characters in `frontend/practice-judge-mode.js`.

## In-Progress Naming Cleanup (Local Changes)

- Renamed `frontend/kid.html` -> `frontend/kid-practice-home.html`
- Renamed `frontend/kid-reading.js` -> `frontend/kid-chinese-characters.js`
- All `/kid.html` references were updated to `/kid-practice-home.html`
- Compatibility redirect was intentionally removed (no backward compatibility needed)

## Why Refactor

- File names are misleading (`kid-reading.js` was actually Chinese Characters practice).
- Kid practice pages duplicate a lot of session UI/controller logic.
- Small features (early finish, judge mode, back-confirm) require touching many files.
- Future changes will be slower/riskier unless shared logic is extracted further.

## Low-Risk Refactor Plan (Recommended First)

1. Extract shared flashcard session helper (Math + Chinese Characters first)
- Scope:
  - session progress text/progress bar updates
  - reveal/judge state transitions
  - early finish wiring
  - end-of-session summary formatting hooks
- Keep page-specific parts injected as callbacks/config:
  - fetch start/complete endpoints
  - card rendering (`front/back` vs `question/answer`)
  - summary labels (`Known/Wrong`, etc.)

2. Standardize common DOM ids for flashcard pages
- Align Math + Chinese Characters DOM structure as much as possible
- Goal: enable more shared JS without brittle page-specific selectors

3. Extract shared practice-page navigation guard
- Current duplication:
  - back button confirm when session in progress
- Move to shared helper in `practice-ui-common.js`

4. Extract shared session result screen helper
- Common patterns:
  - hide session screen
  - show result screen
  - clear pending session marker
  - reload kid info

## Medium-Risk Refactor Plan (Later)

1. Shared controller for "single-card linear sessions"
- Apply to:
  - Chinese Writing
  - Chinese Reading (lesson reading)
- These pages differ due to audio/recording flow, but still share:
  - start/reset session state
  - early finish lifecycle
  - result completion plumbing
  - pending-session handling

2. Split page JS into feature modules
- Example:
  - `practice-session-common.js`
  - `practice-nav-guard.js`
  - `practice-result-screen.js`
  - `practice-flashcard-controller.js`

## Naming Cleanup Follow-Ups

1. Audit `kid-reading-manage.*`
- It is the Chinese Characters admin/manage page, so name is misleading.
- Candidate rename:
  - `kid-chinese-characters-manage.html`
  - `kid-chinese-characters-manage.js`

2. Audit route names vs feature names
- Ensure frontend labels and filenames consistently say:
  - `Chinese Characters`
  - `Chinese Reading` (lesson reading)
- Avoid `reading` ambiguity

## Shared CSS / UI Consistency Follow-Ups

1. Move any page-local duplicated button styles into `frontend/styles.css`
- Especially practice buttons that repeat across pages

2. Keep `touch-action: manipulation` in shared CSS
- Prevent accidental mobile zoom on taps without disabling pinch zoom

## Testing Checklist After Refactor

1. Chinese Characters practice
- Start session
- Kids Self mode / Parent Assisted mode
- Finish Early (with >0 recorded)
- Complete full session

2. Math practice
- Same checks as above

3. Chinese Writing practice
- Prompt playback
- Reveal -> judge
- Finish Early

4. Chinese Reading practice
- Record / stop / replay / continue
- Finish Early while idle
- Finish Early disabled while recording/uploading

5. Practice home navigation
- All "Back to my chores" links point to `/kid-practice-home.html?id=<kidId>`

## Non-Goals (For This Refactor)

- No backend behavior changes unless required by frontend rename
- No DB schema/migration work
- No compatibility redirects unless explicitly requested

## Deferred: Schema Cleanup (Not Today)

1. Remove unused column `decks.updated_at` from kid DB schema
- Confirmed no runtime reads/writes of this column in backend routes.

2. Remove unused column `lesson_reading_audio.created_at` from kid DB schema
- Confirmed no runtime reads/writes of this column in backend routes.

3. Optional: remove `decks.description` after tiny route updates
- Current code still writes this field in three `INSERT INTO decks (name, description, tags)` paths.
- If removing it, update those inserts in:
  - `backend/src/routes/kids.py` (orphan deck create)
  - `backend/src/routes/kids.py` (type-I shared deck materialization)
  - `backend/src/routes/kids.py` (type-II/III shared deck materialization)
