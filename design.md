# Kids Reward Badge System Design

## Goal

Add a long-term reward system that sits above the existing daily star system.

The existing stars answer:

- How did the kid do today?
- Did they finish the assigned practice?
- Did they push extra after the required work?

The new badge system should answer:

- What meaningful milestones has the kid reached over time?
- What habits are they building?
- What accomplishments can they look back on and feel proud of?

This should feel more like Apple Watch achievements than like a daily progress meter.

## Core Product Decision

Keep **daily stars** and **badges** as two separate systems.

Reason:

- Stars are short-term and reset every day.
- Badges are long-term and permanent.
- Mixing them will make both systems harder to explain and harder to evolve.

Proposed mental model:

- `Stars`: daily effort + completion + bonus work
- `Badges`: milestone trophies

## Product Principles

1. A kid should understand that badges are special and persistent.
2. A parent should understand why each badge was awarded.
3. The first version should be simple and hardcoded.
4. The internal model should still be clean enough to support later customization.
5. Badge art and milestone logic should be separate concerns.

## High-Level System Shape

The badge system should have 3 layers:

1. **Achievement definitions**
2. **Badge art bank**
3. **Award records**

These should not be collapsed together.

### 1. Achievement Definitions

This defines the logic for when something is earned.

Examples:

- first completed math session
- 5 completed math sessions
- first day with all assigned subjects done
- 3-day streak
- 100 total active minutes
- 50 mastered cards
- first retry comeback

This layer answers:

- what happened?
- when should an award fire?
- what reason text should be shown?

### 2. Badge Art Bank

This is a catalog of visuals that can be attached to achievements.

Each badge art should have metadata:

- `badge_art_id`
- `title`
- `theme`
- `image_path`
- `source_url`
- `license`
- `attribution_text`
- `is_active`

Themes could include:

- `math`
- `writing`
- `reading`
- `consistency`
- `all_subjects`
- `effort`
- `time_spent`
- `mastery`
- `retry`

Important constraint:

- Do not just collect random internet art without license tracking.
- Even if the art is free pixel art, source and license need to be stored.

### 3. Award Records

This is what the kid actually earned.

Each award record should store:

- `award_id`
- `kid_id`
- `achievement_key`
- `badge_art_id`
- `awarded_at`
- `reason_text`
- `theme`
- `evidence_json`

`evidence_json` is important for debugging and for parent trust.

Example:

```json
{
  "category_key": "math",
  "threshold": 5,
  "session_count": 5
}
```

## Badge Assignment Strategy

Do **not** make badge assignment globally random.

Bad idea:

- “kid completed 5 math sessions and randomly got a whale badge”

Better idea:

- each achievement belongs to a `theme`
- when a kid earns that achievement, pick a random unused badge from that theme

This preserves surprise without losing meaning.

Proposed rule:

- achievement chooses a `theme`
- award logic selects a random unused badge art from that theme
- if no unused badge exists, either:
  - allow duplicate art, or
  - allow tiered re-use, or
  - fall back to a generic theme badge

For MVP, the simplest version is:

- if theme has unused art, pick one randomly
- otherwise allow duplicates

## Visible vs Hidden Achievements

The system should support both:

- **Visible achievements**: kids can see them and aim for them
- **Hidden achievements**: kids discover them as surprises

Reason:

- visible achievements create goals
- hidden achievements create delight

Examples:

- visible: 3-day streak, 100 total minutes, 5 math sessions
- hidden: first retry comeback, first full-completion day, first weekend practice

## First Version Scope

Do **not** start with parent-defined arbitrary logic.

That becomes a rule engine very quickly:

- boolean logic
- filters
- thresholds
- repeat rules
- calendar rules
- category scoping

This is high complexity and will produce poor UI if done too early.

Instead:

- first build hardcoded achievement types
- later allow parents to configure parameters
- much later allow custom achievement creation from templates

## Achievement Taxonomy

The achievement system should be expressed in a small set of achievement types.

Suggested types:

- `complete_first_session`
- `complete_n_sessions`
- `complete_all_subjects_in_one_day`
- `streak_n_days`
- `total_active_minutes`
- `master_n_cards`
- `complete_n_sessions_in_category`
- `gold_star_n_times`
- `retry_comeback_n_times`

This gives good coverage without making the logic messy.

## Recommended MVP Achievement Set

Start with these 6 achievements:

1. `first_completed_session_any`
2. `first_completed_session_per_category`
3. `complete_5_sessions_in_category`
4. `complete_all_assigned_subjects_in_one_day`
5. `streak_3_days`
6. `total_active_minutes_100`

Why this set:

- easy to explain
- spans categories
- includes both effort and consistency
- can be computed from data the app already tracks

## Good Achievement Categories

Over time, badges should come from a few human-friendly categories.

### Session Milestones

- first practice session
- first session in math
- first session in writing
- first session in reading
- 5 sessions in math
- 10 sessions in writing

### Consistency

- 3-day streak
- 7-day streak
- 30-day streak
- finished all assigned subjects today
- finished all assigned subjects for 5 different days

### Effort

- 100 total active minutes
- 500 total active minutes
- 1000 total active minutes

### Mastery

- 25 cards mastered
- 50 cards mastered
- 100 cards mastered

### Recovery / Grit

- first retry comeback
- 5 retry comebacks
- turned silver into gold 10 times

### Special / Surprise

- first weekend practice
- first practice before breakfast
- first day with all categories finished and bonus work done

Some of these can wait until later.

## Definition of “Why”

Every awarded badge should have a concise human-readable reason.

Example reason texts:

- `Completed your first math practice session.`
- `Finished all assigned subjects in one day.`
- `Reached 100 total active minutes.`
- `Kept a 3-day practice streak.`

This reason text should be stored with the award record at award time.

Do not reconstruct it dynamically later from logic only.

Reason:

- logic may evolve
- stored reason keeps old awards stable and auditable

## Parent Configuration Strategy

The system should eventually let parents customize milestones, but not with free-form logic.

Recommended future model:

- parent chooses from a list of achievement templates
- parent can enable / disable them
- parent can set threshold numbers
- parent can optionally scope to a category

Examples:

- `Complete N sessions`
  - category: math
  - threshold: 5
- `Total active minutes`
  - threshold: 300
- `Streak`
  - threshold: 7 days

This is much safer than letting parents define arbitrary formulas.

## Repeatability Rules

Need a clear policy for whether achievements can fire more than once.

Suggested model:

- Some achievements are one-time only:
  - first session ever
  - first math session
- Some are threshold ladders:
  - 100 total minutes
  - 500 total minutes
  - 1000 total minutes
- Some can repeat:
  - all subjects done today
  - 7-day streak

Recommendation:

- For MVP, keep most achievements **one-time only**
- Add repeatable achievements later only if there is clear UX value

Reason:

- repeated awards complicate the gallery
- repeated awards complicate badge art assignment
- repeated awards can feel spammy if not designed well

## Data Model Proposal

Exact schema can change, but the separation should remain.

### `badge_art`

- `badge_art_id`
- `title`
- `theme`
- `image_path`
- `source_url`
- `license`
- `attribution_text`
- `is_active`
- `sort_order`

### `achievement_definition`

- `achievement_key`
- `title`
- `description`
- `theme`
- `rule_type`
- `category_key` nullable
- `threshold_value` nullable
- `is_hidden`
- `is_repeatable`
- `is_active`
- `reason_template`

For MVP, these definitions can be hardcoded in code rather than stored in DB. The conceptual model is still useful.

### `kid_badge_award`

- `award_id`
- `kid_id`
- `achievement_key`
- `badge_art_id`
- `awarded_at`
- `reason_text`
- `theme`
- `evidence_json`

### Optional Future Table: `family_achievement_config`

- `family_id`
- `achievement_key`
- `enabled`
- `category_key` nullable
- `threshold_override` nullable

Not needed for MVP.

## Award Timing

Awards should be evaluated at predictable event boundaries.

Likely trigger points:

- session completion
- end of retry flow
- daily summary generation
- login / home-page load as a backfill guard

Recommended rule:

- primary evaluation on session completion
- secondary idempotent backfill on kid home load

Reason:

- keeps badges timely
- avoids losing awards if an earlier trigger missed

Badge awarding logic must be idempotent.

If an achievement is one-time-only, checking it multiple times should still create at most one award.

## Kid-Facing Pages

### 1. Badge Gallery

Purpose:

- visual, fun, collectible

Display:

- large badge art grid
- title under each badge
- grouped by theme or sorted newest-first

Behavior:

- tapping a badge opens detail view

### 2. Badge Journal

Purpose:

- readable timeline of what was earned and why

Display:

- newest first
- badge image
- title
- date earned
- reason text

This is especially useful for parents.

### 3. New Badge Moment

When a badge is newly earned, the UI should celebrate it.

Possible MVP behavior:

- show a lightweight modal / toast / reward card after session completion
- show badge art
- show badge title
- show short reason text

This matters. If the badge is awarded silently, most of the motivational value is lost.

## Parent-Facing UX

The parent should eventually have a badge settings page, but not in MVP.

Possible future sections:

- enabled achievement families
- threshold settings
- category-specific badge settings
- badge art library preview

For MVP, parent UX can be limited to:

- viewing earned badges
- understanding why they were awarded

## Badge Naming Guidance

Do not let the art carry all the meaning.

Each achievement should have a stable human-readable title.

Examples:

- `Math Explorer`
- `Writing Starter`
- `Reading Finisher`
- `3-Day Helper`
- `All-Subjects Champion`
- `100-Minute Builder`

The art is decorative and collectible, but the title carries the meaning.

## Art Direction Guidance

Pixel art can work well, especially for kids, but only if the set feels coherent.

Recommendation:

- use a small consistent art style
- avoid mixing unrelated styles from many different sources if possible
- tag each art with theme

If art consistency becomes hard, it may be better to use:

- a unified icon set
- recolored variants
- themed sticker-style badges

instead of a random internet pixel art mix.

## Randomness Strategy

Randomness should be controlled.

Good:

- kid gets a random badge from the `math` theme for a math milestone

Bad:

- math milestone gets a random badge from all themes

Potential rule:

- visible achievement defines a logical title and theme
- art selection is random only within that theme

This preserves meaning while keeping awards fresh.

## Why This System Should Start Hardcoded

Hardcoded first version is the right call because:

- faster to ship
- easier to validate with real families
- easier to debug
- avoids premature rule-engine complexity

But the code should still be written with clean structure:

- achievement evaluator separated from UI
- achievement evaluator separated from art choice
- award records persistent and auditable

## Suggested Rollout Plan

### Phase 1: Hardcoded MVP

- hardcoded achievement definitions in backend code
- fixed badge art catalog
- award records persisted
- kid badge gallery page
- simple award popup after earning

### Phase 2: Parent Configurable Parameters

- enable / disable achievement types
- threshold overrides
- category selection for applicable rule types

### Phase 3: Template-Based Parent Custom Rules

- parent chooses from a list of templates
- parent sets parameters
- still no arbitrary boolean logic

## Edge Cases to Decide Later

These need explicit policy before implementation.

### 1. Can the same achievement fire more than once?

Examples:

- `all_subjects_done_today`
- `7_day_streak`

Need decision:

- one-time only?
- repeatable with separate award entries?
- repeatable but same art reused?

### 2. If a kid crosses multiple thresholds at once, do we award multiple badges?

Example:

- kid jumps from 95 total minutes to 130 total minutes

Need decision:

- award only the highest threshold reached?
- award every threshold crossed?

Recommended default:

- award every threshold crossed, but sequence them cleanly

### 3. Should badges be family-global or per-kid only?

Likely answer:

- per-kid only

### 4. Should hidden badges appear as silhouettes before earned?

Possible options:

- fully hidden
- shown as mystery slots
- visible only after same-theme badge exists

## Recommended MVP UX Summary

Ship this first:

- long-term badge system separate from stars
- 6 hardcoded achievements
- themed badge art bank
- one random unused art pick within theme
- kid badge gallery
- parent-readable award reason
- award popup after earning

Do **not** ship yet:

- arbitrary parent-defined achievement logic
- fully repeatable badge ladders
- complex hidden badge systems
- cross-family shared badge configuration

## Suggested Example MVP Achievements

These are concrete candidates.

### Any Category

- `first_session_any`
  - title: `First Steps`
  - reason: `Completed your first practice session.`

### Category-Specific

- `first_session_math`
  - title: `Math Explorer`
  - reason: `Completed your first math practice session.`

- `first_session_writing`
  - title: `Writing Starter`
  - reason: `Completed your first writing practice session.`

- `first_session_reading`
  - title: `Reading Starter`
  - reason: `Completed your first reading practice session.`

### Consistency

- `all_subjects_done_one_day`
  - title: `Daily Champion`
  - reason: `Finished all assigned subjects in one day.`

- `streak_3_days`
  - title: `3-Day Helper`
  - reason: `Kept your practice streak for 3 days.`

### Effort

- `active_minutes_100`
  - title: `100-Minute Builder`
  - reason: `Reached 100 total active minutes.`

## Open Questions

These are the main product choices still worth discussing before implementation.

1. Should repeated daily achievements award multiple badges or a single tracked badge?
2. How much of the achievement list should be visible to the kid in advance?
3. Should art be purely cosmetic, or should certain titles always map to fixed art?
4. Should parents be able to disable achievements they do not care about?
5. Should “bonus work” achievements exist separately from required daily completion achievements?
6. Should retry / comeback behavior be rewarded explicitly or left as part of stars only?

## Recommended Next Step

Before implementation, finalize these three things:

1. MVP achievement list
2. badge art sourcing strategy
3. repeatability policy

Once those are fixed, backend and UI design become much simpler.

## Decision Log

This section records product decisions as they are finalized so the design process stays traceable.

### 2026-03-09

#### Badge system starts from zero for legacy users

Decision:

- existing kids do **not** get retroactive badges
- badge progress starts fresh
- old practice history remains in reports and history pages
- badge logic only counts activity on or after badge-system start

Reason:

- kids should get the excitement of unlocking badges one by one
- avoids dumping a confusing pile of old rewards on day 1
- keeps launch logic simple and auditable

Recommended rollout detail:

- use a kid-level or family-level `badge_tracking_start_date`
- start on a clean local day boundary

#### v1 badge list is fixed

Decision:

- v1 uses the following achievements:
  - `first_session_any`
  - `first_session_in_category`
  - `first_gold_star`
  - `all_assigned_done_one_day`
  - `streak_3_days`
  - `streak_7_days`
  - `active_minutes_100`
  - `active_minutes_300`
  - `active_minutes_1000`

Details:

- `first_session_in_category` is awarded once per category
- this includes custom categories
- `active_minutes` uses lifetime active time after badge tracking begins

#### v1 badges are visible, not hidden

Decision:

- all v1 badges are visible to the kid
- no hidden surprise badges in v1

Reason:

- clearer goals
- easier for parents to understand
- easier to validate the system before adding surprise behavior

Additional rule:

- category starter badges should only show for categories relevant to that kid

#### Badge art should be random within a theme

Decision:

- achievement meaning stays fixed
- title stays fixed
- reason text stays fixed
- badge art is randomized only within the assigned theme

Reason:

- randomness is fun
- but fully random cross-theme assignment would make the system feel arbitrary

v1 selection rule:

- choose a random unused badge art within the theme
- if theme inventory is exhausted, duplicates are allowed

#### v1 badges are one-time milestones

Decision:

- all v1 badges are one-time milestones
- `first_session_in_category` is awarded once per category
- threshold ladders award each threshold once

Applies to:

- `first_session_any`: once total
- `first_session_in_category`: once per category
- `first_gold_star`: once total
- `all_assigned_done_one_day`: once total
- `streak_3_days`: once total
- `streak_7_days`: once total
- `active_minutes_100`: once total
- `active_minutes_300`: once total
- `active_minutes_1000`: once total

Threshold rule:

- if a kid crosses multiple thresholds at once, award all thresholds crossed
- present them in ascending order

Reason:

- keeps v1 badges feeling like trophies rather than daily stamps
- avoids flooding the kid with too many awards
- avoids burning through the art bank too quickly

#### Legacy rollout starts on a clean next-day boundary

Decision:

- no retroactive badge awards for legacy users
- badge tracking starts on the next local day
- old practice history remains intact for reports and history views
- badge logic only counts activity on or after badge tracking start

Reason:

- avoids confusing retroactive badge floods
- preserves the excitement of earning badges one by one
- avoids mid-day boundary confusion for daily completion and streak logic

Parent launch UX:

- show a one-time intro message before badge tracking starts
- message should explain that old history is still saved
- message should explain that badges will start fresh tomorrow

Kid launch UX:

- show a one-time welcome message after badge tracking begins
- keep the message short and non-technical

Badge gallery initial state:

- `Earned` section is empty at launch
- visible locked badges appear in a `Coming Next` section

Implementation note:

- badge tracking should be anchored by a `badge_tracking_start_date`

#### Badge art should be built from consistent ingredients, not random finished badges

Decision:

- do not source random finished badge artworks from many unrelated places
- v1 should use a consistent in-house badge frame / plate / border system
- the collectible visual variation should come from themed emblem ingredients placed inside that consistent frame

Reason:

- keeps the badge gallery visually coherent
- makes theme-based randomness feel intentional instead of messy
- makes licensing easier to track

Approved sourcing strategy for v1:

- source pixel-art emblem ingredients only from explicit-license sources
- preferred source types:
  - Kenney assets
  - CC0 assets from OpenGameArt
  - CC0 assets from itch.io creators
- Lospec should be used for palette inspiration and style research, not as a direct asset source unless licensing is explicit

What to avoid:

- random Google image results
- Pinterest
- reposted art with unclear provenance
- any asset without explicit license terms

Implementation guidance:

- each imported emblem should carry source metadata
- badge visuals should be composed from:
  - a custom badge frame
  - a custom background / plate
  - a themed emblem

Suggested v1 inventory approach:

- create a small but sufficient art bank per theme rather than trying to gather a huge number of badges upfront

#### Badge system should have one canonical kid-specific page

Decision:

- the badge system should live on a dedicated kid-specific page
- there should be one canonical badge page per kid rather than separate kid and parent implementations
- both kid flow and parent flow should link to the same underlying page

Recommended route shape:

- a dedicated page such as `kid-badges.html`
- page is parameterized by `kid_id`

Reason:

- avoids duplicate frontend implementations
- keeps the badge system feeling important rather than buried
- makes it easier to evolve the gallery and journal without touching many pages

Kid entry points:

- family main page should give a clear way to open each kid's badge page
- kid practice home page should also provide a direct path to badges

Parent entry points:

- parent should be able to open the same kid badge page from the admin/kid-management flow

v1 page structure:

- one badge page per kid
- same core content for both kid and parent
- page contains:
  - `Earned`
  - `Coming Next`
  - badge detail view when a badge is tapped

What not to do in v1:

- do not create separate kid and parent badge pages
- do not overload the family main page with a full badge gallery
- do not add large badge previews to already crowded summary cards

Preview strategy:

- family main page may show a small lightweight badge summary later
- but the full experience should live in the dedicated badge page

Implementation guidance:

- the dedicated badge page should be the source of truth
- any future small badge previews elsewhere should link into it, not re-implement gallery logic

#### Badge detail should open as a modal / sheet, not a separate page

Decision:

- tapping a badge opens a modal / sheet on top of the dedicated badge page
- do not navigate to a separate badge-detail page in v1

Reason:

- keeps the gallery feeling fast and collectible
- reduces routing and navigation complexity
- works well for both kid and parent viewing
- avoids page churn for a simple detail interaction

v1 detail contents:

- larger badge art
- badge title
- earned date or locked state
- reason text for earned badges
- goal text for locked badges

Implementation guidance:

- use the dedicated badge page as the background context
- detail modal should be dismissible and return the user to the same scroll position in the gallery
