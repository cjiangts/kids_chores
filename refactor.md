# Refactor Plan — Line-Count Audit & Context-Friendly Splits

> Goal: shrink files that are too large for an agent to read & reason about in a single pass. Target: keep individual source files under ~1,500 lines (hard ceiling ~2,000), so an agent can load full context without truncation. **Plan only — no code changes yet.**

---

## 1. Audit summary (top files by line count)

Across `backend/`, `frontend/`, `shared/` (excluding `node_modules`, `__pycache__`, etc.) **~73,780 lines** of Python/TS/JS/HTML/CSS. The distribution is heavily skewed — the top 12 files alone hold ~50,000 lines.

| Rank | File | Lines | Severity |
|------|------|-------|----------|
| 1 | [backend/src/routes/kids.py](backend/src/routes/kids.py) | **16,136** | 🔴 Critical |
| 2 | [frontend/kid-card-manage.html](frontend/kid-card-manage.html) | 6,131 | 🔴 Critical |
| 3 | [frontend/kid-card-manage.js](frontend/kid-card-manage.js) | 5,957 | 🔴 Critical |
| 4 | [frontend/kid-practice.js](frontend/kid-practice.js) | 3,273 | 🟠 High |
| 5 | [frontend/kid-writing-sheet-manage.js](frontend/kid-writing-sheet-manage.js) | 2,685 | 🟠 High |
| 6 | [frontend/styles.css](frontend/styles.css) | 2,386 | 🟠 High |
| 7 | [frontend/parent-settings.js](frontend/parent-settings.js) | 2,168 | 🟠 High |
| 8 | [frontend/deck-view.js](frontend/deck-view.js) | 1,805 | 🟡 Medium |
| 9 | [frontend/home-redesign-v4.css](frontend/home-redesign-v4.css) | 1,755 | 🟡 Medium |
| 10 | [frontend/practice-manage-common.js](frontend/practice-manage-common.js) | 1,533 | 🟡 Medium |
| 11 | [frontend/deck-create.js](frontend/deck-create.js) | 1,334 | 🟡 Medium |
| 12 | [frontend/kid-writing-sheet-manage.html](frontend/kid-writing-sheet-manage.html) | 1,255 | 🟡 Medium |
| 13 | [backend/src/badges/service.py](backend/src/badges/service.py) | 920 | 🟢 Low |
| 14 | [frontend/kid-practice-home.js](frontend/kid-practice-home.js) | 909 | 🟢 Low |
| 15 | [frontend/math-sheet-print.js](frontend/math-sheet-print.js) | 901 | 🟢 Low |

Severity bands: 🔴 must-split (>3k lines blows context budget), 🟠 should-split (>2k), 🟡 nice-to-split (>1.2k), 🟢 monitor only.

---

## 2. Critical: `backend/src/routes/kids.py` (16,136 lines)

### Why it's a problem
- Single Flask blueprint holds **84 routes** + **343 helper functions** + **~2,750 lines of module-level constants/helpers** before the first route appears.
- An agent cannot read this file end-to-end. Even targeted edits cost massive context.
- All four "deck behavior types" (Type I/II/III/IV), shared decks, kid CRUD, audio handling, sheets, practice sessions, and chinese-bank live together.

### Route topology (already neatly grouped by URL prefix)

| URL prefix | Count | Line range | Suggested module |
|---|---|---|---|
| `/shared-decks/...` | 23 | 2755–4423 | `routes/kids/shared_decks.py` |
| `/kids/...` (CRUD, report, deck-categories) | ~30 | 5146–6553 | `routes/kids/kids_core.py` |
| `/kids/.../cards`, `/kids/.../<scope>/...` (personal/shared opt-in) | ~10 | 8759–11765 | `routes/kids/kid_decks.py` |
| `/kids/.../type2/...` (cards + audio + chinese sheets) | ~10 | 13470–15032 | `routes/kids/type2.py` |
| `/kids/.../type4/...` (math sheets + generator) | ~10 | 13031–14725 | `routes/kids/type4.py` |
| `/kids/.../lesson-reading/...` | 4 | 13941–15627 | `routes/kids/lesson_reading.py` |
| `/kids/.../*/practice/...` (start/complete) | ~8 | 15032–15721 | `routes/kids/practice.py` |
| `/chinese-bank/...` | 4 | 15751–16135 | `routes/kids/chinese_bank.py` |

### Helper topology (lines 36–2754)
This pre-route block is essentially a kitchen-sink utility module. Group by concern:

1. **Constants & config** (lines 36–180) → `routes/kids/_constants.py`
2. **Audio path/meta builders** (lines 199–469) → `services/writing_audio.py` (already partially shared with `audio_cleanup.py`)
3. **Family/auth/session helpers** (lines 470–546) → reuse existing or move to `routes/kids/_auth.py`
4. **Shared-deck tag/category normalizers** (lines 547–1148) → `services/shared_deck_normalize.py`
5. **Materialized shared-deck sync** (lines 1148–1422) → `services/shared_deck_materialize.py`
6. **Kid category config hydration** (lines 1422–1612) → `services/kid_category_config.py`
7. **Source-deck merging / card-count summaries** (lines 1613–1855) → `services/deck_source_merge.py`
8. **Type-IV print-sheet layout math** (lines 674–2754, scattered) → `services/type4_print_layout.py` (sibling to existing `type4_generator_preview.py`)

### Proposed structure
```
backend/src/routes/kids/
  __init__.py            # re-exports kids_bp, registers all sub-blueprints
  _constants.py          # all module-level constants
  _shared.py             # current_family_id, get_kid_for_family, common decorators
  shared_decks.py        # 23 routes
  kids_core.py           # CRUD + report
  kid_decks.py           # personal + shared opt-in + scoped decks
  type2.py
  type4.py
  lesson_reading.py
  practice.py
  chinese_bank.py
backend/src/services/
  writing_audio.py
  shared_deck_normalize.py
  shared_deck_materialize.py
  kid_category_config.py
  deck_source_merge.py
  type4_print_layout.py
```

### Migration approach (low-risk, incremental)
1. **Phase 0 — prep**: introduce `routes/kids/__init__.py` that simply `from .legacy import kids_bp` (file rename only). Verify all imports still resolve via `from src.routes.kids import kids_bp`.
2. **Phase 1 — extract constants**: move pure constants to `_constants.py`, import back. ~180 lines moved.
3. **Phase 2 — extract pure helpers**: move stateless normalizers/builders into `services/`. Each one round-trips through tests if any exist; otherwise smoke-test via dev server.
4. **Phase 3 — extract route groups**: one URL prefix at a time. Each group becomes its own blueprint registered onto `kids_bp` (Flask supports nested blueprints) **or** simply moved into a sibling module that imports the shared `kids_bp` instance. Per the user's "no backward-compat shims" rule, do clean cuts — no aliasing back to the old path.
5. **Phase 4 — delete `kids.py`**: once empty, remove.

**Expected end state:** no individual file > ~1,500 lines; each concern reads independently.

---

## 3. Critical: `kid-card-manage.{html,js}` (6,131 + 5,957 = 12,088 lines)

### HTML (6,131 lines)
- Lines 11–5,749 are a single inline `<style>` block (~5,738 lines of CSS!).
- Real markup is only ~370 lines (5,750–6,131).

**Action:**
1. Extract the inline `<style>` to `frontend/kid-card-manage.css` and link via `<link rel="stylesheet">`.
2. Audit the extracted CSS for rules that duplicate `styles.css` and consolidate.
- **Result:** HTML drops to ~400 lines; CSS becomes an isolated, ~5.7k-line file (still big but only loaded by tooling that needs CSS, not by JS-edit context).
3. Optional Phase 2: split the new CSS by section (modal styles / type4-generator UI / deck-setup panel / card list) into 3–4 files of ~1,500 lines each.

### JS (5,957 lines)
The file is one giant page controller mixing many concerns. Breakdown by feature area (estimated from function clusters):

| Concern | Approx. lines | Suggested module |
|---|---|---|
| Bootstrap, nav, kid loading, page title | ~400 | `kid-card-manage-core.js` |
| Type-IV generator (Ace editor, preview, samples, modal) | ~1,000 | `kid-card-manage-type4-generator.js` |
| Type-IV deck daily-count modal & calculations | ~500 | `kid-card-manage-type4-counts.js` |
| Type-IV print cell design + sheet layout UI | ~800 | `kid-card-manage-type4-print.js` |
| Shared-deck opt-in/out, deck setup summary | ~700 | `kid-card-manage-deck-setup.js` |
| Card list rendering, sort/filter, bulk actions | ~900 | `kid-card-manage-cards.js` |
| Personal deck CRUD modal (Type II/III bulk add) | ~600 | `kid-card-manage-personal-deck.js` |
| Tag editor, rename, category emoji | ~500 | `kid-card-manage-tags.js` |
| Misc helpers (escape, modal backdrop, status messages) | ~400 | already largely duplicated in other files → consolidate into existing `practice-manage-common.js` instead of new file |

**Migration approach:** ES modules are NOT used by this codebase (script tags only), so split via additional `<script>` tags. Use a top-level `window.kidCardManage = { ... }` namespace as a shared bag if cross-module function calls are needed. The user's `feedback_no_legacy_db_compat.md` rule is about DB schema; for JS, prefer the same spirit — clean cut, no compatibility shim for the old file.

---

## 4. High: `kid-practice.js` (3,273 lines)

A page controller for the practice runtime spanning all four behavior types + drill mode.

Split candidates:
- `kid-practice-core.js` — page bootstrap, kid load, nav cache, judge-mode picker, drill toggle (~700)
- `kid-practice-type1.js` — Type-I (chinese/non-chinese) flow + audio prompts (~700)
- `kid-practice-type2.js` — Type-II flow (~500)
- `kid-practice-type3.js` — Type-III lesson-reading + recording (~500)
- `kid-practice-type4.js` — Type-IV input/multi modes + generator preview consumption (~700)
- `kid-practice-session.js` — session start/complete API plumbing, retry chains (~400)

Page-controller pattern: each module attaches its handlers conditionally based on the active behavior type. Functions already namespaced by `BEHAVIOR_TYPE_*` constants — splits map cleanly.

---

## 5. High: `kid-writing-sheet-manage.js` (2,685) & matching HTML (1,255)

- Duplicates a lot of the math-sheet print-config logic (cell design, paper layout) that also lives in `math-sheet-print.js` (901) and the Type-IV print code in `kids.py`.
- **Plan:** extract a shared `frontend/print-cell-design-common.js` (~600 lines) that both this file and `math-sheet-print.js` consume. Resulting `kid-writing-sheet-manage.js` shrinks to ~1,800 → split further into `…-core.js` + `…-sheets-list.js` (~900 each).
- HTML at 1,255 lines: same pattern as `kid-card-manage.html` — likely a large inline `<style>`. Extract to a sibling `.css` file.

---

## 6. High: `parent-settings.js` (2,168)

Function clusters: badge-art studio (~900), rewards tracking (~300), password change (~150), timezone/family settings (~300), badge achievement render helpers (~500).

Split:
- `parent-settings-core.js` — bootstrap + family/timezone/password (~600)
- `parent-settings-rewards.js` — rewards tracking UI (~300)
- `parent-settings-badges.js` — badge-art studio + assignment dirty tracking (~1,200)

---

## 7. High: `frontend/styles.css` (2,386)

Has only 3 large section comments (`manage-page titles`, `Toggle switch row`, `Report pages`). The file is a global stylesheet imported by ~all pages.

**Plan:**
1. Identify per-page rules vs truly global rules (buttons, nav, modal base, typography).
2. Move per-page rules out to existing per-page CSS (e.g. report styles → `kid-report.css`, toggle-switch → `components/toggle-switch.css`).
3. Keep `styles.css` as the global base only (~1,000 lines).

`home-redesign-v4.css` (1,755) is page-scoped to one redesign — leave alone unless it grows further. Mark as "monitor."

---

## 8. Medium: `deck-view.js` (1,805) & `deck-create.js` (1,334)

Both share large blocks for tags, type-IV generator code editor, CSV preview/apply. Extract a `frontend/deck-form-common.js` for the shared editor + tag/CSV logic. Each page controller then drops to ~1,000 lines.

---

## 9. Medium: `practice-manage-common.js` (1,533)

Currently a true "shared utilities" module — but at 1.5k lines it's becoming a dumping ground. Audit and split by concern:
- `practice-format-common.js` — escapeHtml, math rendering, text helpers
- `practice-card-render-common.js` — card markup builders
- `practice-star-badge-common.js` already exists (111 lines) — keep
- `practice-judge-mode.js` already exists (112 lines) — keep

Estimate: this file shrinks to ~600 lines after split.

---

## 10. Low / monitor only

- [backend/src/badges/service.py](backend/src/badges/service.py) (920) — internally well-organized; split only if it crosses ~1,500.
- [frontend/kid-practice-home.js](frontend/kid-practice-home.js) (909) — fine.
- [frontend/math-sheet-print.js](frontend/math-sheet-print.js) (901) — will benefit from the shared `print-cell-design-common.js` extraction (Section 5).
- [frontend/deck-create-bulk.js](frontend/deck-create-bulk.js) (848), [frontend/kid-report-common.js](frontend/kid-report-common.js) (847), [frontend/kid-card-report.js](frontend/kid-card-report.js) (804) — all under threshold.

---

## 11. Suggested execution order

Ordered by **highest agent-pain-relief per unit of effort**:

1. **Extract inline `<style>` blocks** from `kid-card-manage.html` and `kid-writing-sheet-manage.html` → fastest win, near-zero risk.
2. **Split `routes/kids.py` Phase 0–2** (rename + constants + pure helpers extraction). Adds new files but each route still works.
3. **Split `routes/kids.py` Phase 3** by URL prefix — one prefix per PR.
4. **Split `kid-card-manage.js`** by feature area.
5. **Split `kid-practice.js`** by behavior type.
6. **Extract shared print-design module** (covers `kid-writing-sheet-manage.js` + `math-sheet-print.js` + parts of `kids.py`).
7. **Split `parent-settings.js`** and `deck-view.js`/`deck-create.js`.
8. **Audit `styles.css`** for per-page rule extraction (do last — touches every page).

Do steps 1–4 before any new feature work; they unblock all future agent-driven edits in the manage/practice flows. After steps 1–7 the largest remaining file should be under ~2,000 lines.

---

## 12. Validation per step

For each extraction, verify before committing:
- App boots locally (`./start-local.sh`).
- Each affected page loads without console errors.
- Smoke-test one round-trip per feature area touched (e.g. open card-manage, run a Type-IV generator preview, complete a practice session).
- `grep` for the moved symbol's old import path to confirm no callers were missed.

No backwards-compat shims, per `feedback_no_legacy_db_compat.md` — clean cuts, update all callers in the same change.
