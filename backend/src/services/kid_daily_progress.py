"""Per-kid daily progress + category stats.

Helpers that read each kid's per-kid SQLite to produce:
  - Today's session counts / star tiers / latest-percent / target-tried-right
    aggregates keyed by category (`get_kid_dashboard_stats`).
  - Opted-in category keys filtered against family access rules.
  - Pending type-III grading queue size.
  - Per-card-per-day attempt aggregates for one category.
  - Active card counts per category (the upper bound on daily targets).
  - Daily practice target counts per category.
  - Plain pass-throughs that project the bundle from `get_kid_dashboard_stats`
    onto a per-category dict for the report payload.

`get_kid_connection_for` is opened lazily when no `conn` is supplied.
No module state.

Layout (search for `# === N. ` banner markers to jump between sections):

    1. Category metadata helpers (kid db path, type-III key set, display name)
    2. Dashboard stats — `get_kid_dashboard_stats` (today's session aggregates)
    3. Opt-in + grading-queue readers
    4. Per-category projections of dashboard stats onto report payload dicts
    5. Active-card counts + daily practice target derivation
    6. Composite progress section builder for the kid report
"""
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from src.db import metadata
from src.routes.kids_constants import (
    DECK_CATEGORY_BEHAVIOR_TYPES,
    DECK_CATEGORY_BEHAVIOR_TYPE_III,
    DECK_CATEGORY_BEHAVIOR_TYPE_IV,
    SESSION_RESULT_PARTIAL,
)
from src.services.deck_source_merge import get_type_iv_total_daily_target_for_category
from src.services.family_auth import (
    can_family_access_deck_category,
    get_kid_connection_for,
    is_super_family_id,
)
from src.services.kid_category_config import (
    get_category_session_card_count_for_kid,
    hydrate_kid_category_config_from_db,
)
from src.services.shared_deck_category import (
    get_session_behavior_type,
    get_shared_deck_category_meta_by_key,
)
from src.services.shared_deck_normalize import normalize_shared_deck_tag


# =====================================================================
# === 1. Category metadata helpers
# =====================================================================
def get_kid_scoped_db_relpath(kid):
    """Return family-scoped dbFilePath for a kid."""
    family_id = str(kid.get('familyId') or '')
    kid_id = kid.get('id')
    return f"data/families/family_{family_id}/kid_{kid_id}.db"


def get_type_iii_category_keys(category_meta_by_key=None):
    """Return normalized deck-category keys that use type-III behavior."""
    meta = (
        category_meta_by_key
        if isinstance(category_meta_by_key, dict)
        else get_shared_deck_category_meta_by_key()
    )
    keys = []
    for raw_key, item in meta.items():
        behavior_type = str((item or {}).get('behavior_type') or '').strip().lower()
        if behavior_type != DECK_CATEGORY_BEHAVIOR_TYPE_III:
            continue
        key = normalize_shared_deck_tag(raw_key)
        if key:
            keys.append(key)
    return sorted(set(keys))


def get_deck_category_display_name(category_key, category_meta_by_key=None):
    """Return one category display name from metadata."""
    key = normalize_shared_deck_tag(category_key)
    if not key:
        return ''
    meta = (
        category_meta_by_key
        if isinstance(category_meta_by_key, dict)
        else get_shared_deck_category_meta_by_key()
    )
    return str((meta.get(key) or {}).get('display_name') or '').strip()


# =====================================================================
# === 2. Dashboard stats — today's session aggregates
# =====================================================================
def get_kid_dashboard_stats(
    kid,
    *,
    category_meta_by_key=None,
    type_iii_category_keys=None,
    include_ungraded_count=True,
    conn=None,
    family_timezone=None,
):
    """Get today's dashboard counts + latest session progress by category in one connection."""
    default_counts = defaultdict(int)
    default_started_counts = defaultdict(int)
    default_star_tiers = defaultdict(list)
    default_latest_percent = defaultdict(float)
    default_latest_target_count = defaultdict(int)
    default_latest_tried_count = defaultdict(int)
    default_latest_right_count = defaultdict(int)
    local_conn = conn
    owns_conn = False
    if local_conn is None:
        try:
            local_conn = get_kid_connection_for(kid, read_only=True)
            owns_conn = True
        except Exception:
            return (
                default_counts,
                default_started_counts,
                default_star_tiers,
                default_latest_percent,
                default_latest_target_count,
                default_latest_tried_count,
                default_latest_right_count,
                False,
            )

    try:
        family_id = str(kid.get('familyId') or '')
        effective_family_timezone = (
            str(family_timezone).strip()
            if str(family_timezone or '').strip()
            else metadata.get_family_timezone(family_id)
        )
        is_super = is_super_family_id(family_id)
        tzinfo = ZoneInfo(effective_family_timezone)
        day_start_local = datetime.now(tzinfo).replace(hour=0, minute=0, second=0, microsecond=0)
        day_end_local = day_start_local + timedelta(days=1)
        day_start_utc = day_start_local.astimezone(timezone.utc).replace(tzinfo=None)
        day_end_utc = day_end_local.astimezone(timezone.utc).replace(tzinfo=None)
        effective_category_meta_by_key = (
            category_meta_by_key
            if isinstance(category_meta_by_key, dict)
            else {
                key: meta
                for key, meta in get_shared_deck_category_meta_by_key().items()
                if can_family_access_deck_category(meta, family_id=family_id, is_super=is_super)
            }
        )

        rows = local_conn.execute(
            """
            WITH todays_sessions AS (
                SELECT
                    id,
                    type,
                    planned_count,
                    completed_at,
                    started_at,
                    CASE
                        WHEN completed_at IS NOT NULL
                         AND completed_at >= ?
                         AND completed_at < ?
                        THEN 1 ELSE 0
                    END AS completed_today,
                    CASE
                        WHEN started_at IS NOT NULL
                         AND started_at >= ?
                         AND started_at < ?
                        THEN 1 ELSE 0
                    END AS started_today
                FROM sessions
                WHERE (
                    completed_at IS NOT NULL
                    AND completed_at >= ?
                    AND completed_at < ?
                ) OR (
                    started_at IS NOT NULL
                    AND started_at >= ?
                    AND started_at < ?
                )
            ),
            unresolved_counts AS (
                SELECT sr.session_id, COUNT(*) AS unresolved_count
                FROM session_results sr
                JOIN todays_sessions ts ON ts.id = sr.session_id
                WHERE sr.card_id IS NOT NULL
                  AND (sr.correct = -1 OR sr.correct = 2)
                GROUP BY sr.session_id
            )
            SELECT
                s.type,
                COALESCE(s.planned_count, 0) AS planned_count,
                COUNT(sr.id) AS answer_count,
                COALESCE(uc.unresolved_count, 0) AS unresolved_count,
                s.completed_today,
                s.started_today
            FROM todays_sessions s
            LEFT JOIN session_results sr ON sr.session_id = s.id
            LEFT JOIN unresolved_counts uc ON uc.session_id = s.id
            GROUP BY
                s.id,
                s.type,
                s.planned_count,
                s.completed_at,
                s.started_at,
                s.completed_today,
                s.started_today,
                uc.unresolved_count
            ORDER BY COALESCE(s.completed_at, s.started_at) ASC, s.id ASC
            """,
            [
                day_start_utc,
                day_end_utc,
                day_start_utc,
                day_end_utc,
                day_start_utc,
                day_end_utc,
                day_start_utc,
                day_end_utc,
            ]
        ).fetchall()

        today_counts = defaultdict(int)
        today_started_counts = defaultdict(int)
        today_star_tiers = defaultdict(list)
        today_latest_percent = defaultdict(float)
        today_latest_target_count = defaultdict(int)
        today_latest_tried_count = defaultdict(int)
        today_latest_right_count = defaultdict(int)
        for row in rows:
            session_type = normalize_shared_deck_tag(row[0])
            if not session_type or session_type not in effective_category_meta_by_key:
                continue
            session_behavior_type = get_session_behavior_type(
                session_type,
                category_meta_by_key=effective_category_meta_by_key,
            )
            planned_count = max(0, int(row[1] or 0))
            answer_count = int(row[2] or 0)
            unresolved_count = max(0, int(row[3] or 0))
            completed_today = int(row[4] or 0) == 1
            started_today = int(row[5] or 0) == 1
            if started_today:
                today_started_counts[session_type] += 1
                today_started_counts['total'] += 1
            if not completed_today:
                continue
            wrong_count = unresolved_count
            right_count = max(0, answer_count - unresolved_count)
            target_answer_count = max(planned_count, answer_count, right_count + wrong_count)
            if target_answer_count <= 0 and planned_count <= 0:
                continue
            is_incomplete = planned_count > 0 and answer_count < planned_count
            if is_incomplete:
                base_tier = 'half_silver'
            else:
                base_tier = 'gold'
            effective_best_total = right_count

            if is_incomplete:
                effective_percent = float(answer_count) * 100.0 / float(max(1, target_answer_count))
            elif session_behavior_type == DECK_CATEGORY_BEHAVIOR_TYPE_III and (right_count + wrong_count) <= 0:
                effective_percent = float(answer_count) * 100.0 / float(max(1, target_answer_count))
            else:
                effective_percent = float(effective_best_total) * 100.0 / float(max(1, target_answer_count))
            today_star_tiers[session_type].append(base_tier)
            today_counts[session_type] += 1
            today_counts['total'] += 1
            today_latest_percent[session_type] = max(0.0, min(100.0, effective_percent))
            today_latest_target_count[session_type] = int(target_answer_count)
            today_latest_tried_count[session_type] = max(0, int(answer_count))
            today_latest_right_count[session_type] = max(
                0,
                min(
                    int(target_answer_count),
                    int(effective_best_total),
                ),
            )

        ungraded_count = 0
        if include_ungraded_count:
            effective_type_iii_category_keys = [
                normalize_shared_deck_tag(item)
                for item in list(
                    type_iii_category_keys
                    if isinstance(type_iii_category_keys, (list, tuple, set))
                    else get_type_iii_category_keys(effective_category_meta_by_key)
                )
            ]
            effective_type_iii_category_keys = [
                key for key in effective_type_iii_category_keys
                if key
            ]
            if effective_type_iii_category_keys:
                placeholders = ', '.join(['?'] * len(effective_type_iii_category_keys))
                ungraded_row = local_conn.execute(
                    f"""
                    SELECT COUNT(*) AS cnt
                    FROM sessions s
                    JOIN session_results sr ON sr.session_id = s.id
                    WHERE s.type IN ({placeholders})
                      AND s.completed_at IS NOT NULL
                      AND sr.correct = 0
                    """,
                    effective_type_iii_category_keys,
                ).fetchone()
                if ungraded_row is not None:
                    try:
                        ungraded_count = int(ungraded_row[0] or 0)
                    except (TypeError, ValueError):
                        ungraded_count = 0

        return (
            today_counts,
            today_started_counts,
            today_star_tiers,
            today_latest_percent,
            today_latest_target_count,
            today_latest_tried_count,
            today_latest_right_count,
            ungraded_count,
        )
    except Exception:
        return (
            default_counts,
            default_started_counts,
            default_star_tiers,
            default_latest_percent,
            default_latest_target_count,
            default_latest_tried_count,
            default_latest_right_count,
            0,
        )
    finally:
        if owns_conn and local_conn is not None:
            local_conn.close()


# =====================================================================
# === 3. Opt-in + grading-queue readers
# =====================================================================
def get_kid_opted_in_deck_category_keys(kid, *, category_meta_by_key=None, conn=None):
    """Return normalized deck-category keys opted in for one kid."""
    try:
        family_id = str(kid.get('familyId') or '').strip()
        is_super = is_super_family_id(family_id)
        effective_category_meta_by_key = (
            category_meta_by_key
            if isinstance(category_meta_by_key, dict)
            else {
                key: meta
                for key, meta in get_shared_deck_category_meta_by_key().items()
                if can_family_access_deck_category(meta, family_id=family_id, is_super=is_super)
            }
        )
        hydrate_kid_category_config_from_db(
            kid,
            category_meta_by_key=effective_category_meta_by_key,
            conn=conn,
        )
        raw_keys = kid.get('optedInDeckCategoryKeys')
        if not isinstance(raw_keys, list):
            return []
        keys = []
        seen = set()
        for raw_key in raw_keys:
            key = normalize_shared_deck_tag(raw_key)
            if not key or key in seen:
                continue
            category_meta = effective_category_meta_by_key.get(key)
            if not can_family_access_deck_category(
                category_meta,
                family_id=family_id,
                is_super=is_super,
            ):
                continue
            seen.add(key)
            keys.append(key)
        return keys
    except Exception:
        return []


def get_kid_ungraded_type_iii_count(kid, *, type_iii_category_keys=None, conn=None):
    """Return number of type-III session result rows awaiting grading."""
    keys = [
        normalize_shared_deck_tag(item)
        for item in list(type_iii_category_keys or [])
    ]
    keys = [key for key in keys if key]
    if not keys:
        return 0
    local_conn = conn
    owns_conn = False
    if local_conn is None:
        try:
            local_conn = get_kid_connection_for(kid, read_only=True)
            owns_conn = True
        except Exception:
            return 0
    try:
        placeholders = ', '.join(['?'] * len(keys))
        row = local_conn.execute(
            f"""
            SELECT COUNT(*) AS cnt
            FROM sessions s
            JOIN session_results sr ON sr.session_id = s.id
            WHERE s.type IN ({placeholders})
              AND s.completed_at IS NOT NULL
              AND sr.correct = 0
            """,
            keys,
        ).fetchone()
        if row is None:
            return 0
        try:
            return int(row[0] or 0)
        except (TypeError, ValueError):
            return 0
    except Exception:
        return 0
    finally:
        if owns_conn and local_conn is not None:
            local_conn.close()


def get_kid_today_session_status_by_deck_category(
    kid,
    opted_in_category_keys,
    *,
    conn=None,
    family_timezone=None,
):
    keys = [normalize_shared_deck_tag(key) for key in list(opted_in_category_keys or [])]
    keys = [key for key in keys if key]
    keys = list(dict.fromkeys(keys))
    status_by_key = {
        key: {
            'status': 'not_started',
            'sessionId': None,
            'wrongCount': 0,
        }
        for key in keys
    }
    if not keys:
        return status_by_key

    local_conn = conn
    owns_conn = False
    if local_conn is None:
        try:
            local_conn = get_kid_connection_for(kid, read_only=True)
            owns_conn = True
        except Exception:
            return status_by_key

    try:
        family_id = str(kid.get('familyId') or '')
        effective_family_timezone = (
            str(family_timezone).strip()
            if str(family_timezone or '').strip()
            else metadata.get_family_timezone(family_id)
        )
        tzinfo = ZoneInfo(effective_family_timezone)
        day_start_local = datetime.now(tzinfo).replace(hour=0, minute=0, second=0, microsecond=0)
        day_end_local = day_start_local + timedelta(days=1)
        day_start_utc = day_start_local.astimezone(timezone.utc).replace(tzinfo=None)
        day_end_utc = day_end_local.astimezone(timezone.utc).replace(tzinfo=None)
        placeholders = ', '.join(['?'] * len(keys))
        rows = local_conn.execute(
            f"""
            SELECT
                s.id,
                s.type,
                COALESCE(s.planned_count, 0) AS planned_count,
                s.completed_at,
                s.started_at,
                COUNT(sr.id) AS answer_count,
                COALESCE(SUM(CASE WHEN sr.correct < 0 OR sr.correct = ? THEN 1 ELSE 0 END), 0) AS wrong_count
            FROM sessions s
            LEFT JOIN session_results sr ON sr.session_id = s.id
            WHERE s.type IN ({placeholders})
              AND (
                (
                    s.started_at IS NOT NULL
                    AND s.started_at >= ?
                    AND s.started_at < ?
                ) OR (
                    s.completed_at IS NOT NULL
                    AND s.completed_at >= ?
                    AND s.completed_at < ?
                )
              )
            GROUP BY
                s.id,
                s.type,
                s.planned_count,
                s.completed_at,
                s.started_at
            ORDER BY COALESCE(s.completed_at, s.started_at) ASC, s.id ASC
            """,
            [
                SESSION_RESULT_PARTIAL,
                *keys,
                day_start_utc,
                day_end_utc,
                day_start_utc,
                day_end_utc,
            ],
        ).fetchall()

        for row in rows:
            session_id = int(row[0] or 0)
            category_key = normalize_shared_deck_tag(row[1])
            if session_id <= 0 or category_key not in status_by_key:
                continue
            planned_count = max(0, int(row[2] or 0))
            completed_at = row[3]
            answer_count = max(0, int(row[5] or 0))
            wrong_count = max(0, int(row[6] or 0))
            done = completed_at is not None and (planned_count <= 0 or answer_count >= planned_count)
            status_by_key[category_key] = {
                'status': 'done' if done else 'in_progress',
                'sessionId': session_id,
                'wrongCount': wrong_count,
            }
        return status_by_key
    except Exception:
        return status_by_key
    finally:
        if owns_conn and local_conn is not None:
            local_conn.close()


# =====================================================================
# === 4. Per-category projections of dashboard stats
# =====================================================================
def get_kid_daily_completed_by_deck_category(kid, opted_in_category_keys, today_counts=None):
    """Build per-category daily completed session counts using practiced card tags."""
    counts = {}
    keys = [normalize_shared_deck_tag(key) for key in list(opted_in_category_keys or [])]
    keys = [key for key in keys if key]
    keys = list(dict.fromkeys(keys))
    if not keys:
        return counts
    if isinstance(today_counts, dict):
        for key in keys:
            counts[key] = int(today_counts.get(key, 0) or 0)
        return counts

    counts = {key: 0 for key in keys}
    conn = None
    try:
        conn = get_kid_connection_for(kid, read_only=True)
        family_id = str(kid.get('familyId') or '')
        family_timezone = metadata.get_family_timezone(family_id)
        tzinfo = ZoneInfo(family_timezone)
        day_start_local = datetime.now(tzinfo).replace(hour=0, minute=0, second=0, microsecond=0)
        day_end_local = day_start_local + timedelta(days=1)
        day_start_utc = day_start_local.astimezone(timezone.utc).replace(tzinfo=None)
        day_end_utc = day_end_local.astimezone(timezone.utc).replace(tzinfo=None)

        placeholders = ', '.join(['?'] * len(keys))
        rows = conn.execute(
            f"""
            SELECT s.type, COUNT(*)
            FROM sessions s
            WHERE s.completed_at IS NOT NULL
              AND s.completed_at >= ?
              AND s.completed_at < ?
              AND s.type IN ({placeholders})
            GROUP BY s.type
            """,
            [day_start_utc, day_end_utc, *keys],
        ).fetchall()
        for row in rows:
            key = normalize_shared_deck_tag(row[0])
            if key in counts:
                counts[key] = int(row[1] or 0)
    except Exception:
        counts = {key: 0 for key in keys}
    finally:
        if conn is not None:
            conn.close()
    return counts


def get_kid_daily_star_tiers_by_deck_category(opted_in_category_keys, today_star_tiers=None):
    """Build per-category daily star tiers list (gold/silver) for one kid."""
    result = {}
    keys = [normalize_shared_deck_tag(key) for key in list(opted_in_category_keys or [])]
    keys = [key for key in keys if key]
    keys = list(dict.fromkeys(keys))
    for key in keys:
        raw_tiers = []
        if isinstance(today_star_tiers, dict):
            raw_tiers = list(today_star_tiers.get(key) or [])
        tiers = []
        for raw in raw_tiers:
            tier = str(raw or '').strip().lower()
            if tier in ('gold', 'silver', 'half_silver'):
                tiers.append(tier)
        result[key] = tiers
    return result


def get_kid_daily_percent_by_deck_category(opted_in_category_keys, today_latest_percent=None):
    """Build per-category latest daily completion percent for one kid."""
    result = {}
    keys = [normalize_shared_deck_tag(key) for key in list(opted_in_category_keys or [])]
    keys = [key for key in keys if key]
    keys = list(dict.fromkeys(keys))
    for key in keys:
        raw_percent = 0.0
        if isinstance(today_latest_percent, dict):
            raw_percent = today_latest_percent.get(key, 0.0)
        try:
            parsed = float(raw_percent)
        except (TypeError, ValueError):
            parsed = 0.0
        result[key] = max(0.0, min(100.0, parsed))
    return result


# =====================================================================
# === 5. Active-card counts + daily practice target
# =====================================================================
def get_kid_active_card_count_by_deck_category(kid, *, conn=None):
    """Return active (non-skipped) card counts keyed by normalized category key.

    Used as the upper bound for daily session card-count targets — parents
    can't set a target larger than the cards available for that category.
    """
    local_conn = conn
    owns_conn = False
    if local_conn is None:
        try:
            local_conn = get_kid_connection_for(kid, read_only=True)
            owns_conn = True
        except Exception:
            return {}
    try:
        rows = local_conn.execute(
            """
            SELECT lower(d.tags[1]) AS category_key, COUNT(c.id) AS active_count
            FROM decks d
            JOIN cards c ON c.deck_id = d.id
            WHERE array_length(d.tags) >= 1
              AND COALESCE(c.skip_practice, FALSE) = FALSE
            GROUP BY lower(d.tags[1])
            """
        ).fetchall()
    except Exception:
        rows = []
    finally:
        if owns_conn and local_conn is not None:
            local_conn.close()
    counts = {}
    for row in rows:
        key = normalize_shared_deck_tag(row[0])
        if not key:
            continue
        try:
            counts[key] = int(row[1] or 0)
        except (TypeError, ValueError):
            counts[key] = 0
    return counts


def get_kid_practice_target_by_deck_category(
    kid,
    opted_in_category_keys,
    category_meta_by_key,
    *,
    conn=None,
):
    """Build per-category daily target counts for one kid."""
    targets = {}
    keys = [normalize_shared_deck_tag(key) for key in list(opted_in_category_keys or [])]
    owned_conn = None
    for key in keys:
        if not key:
            continue
        category_meta = category_meta_by_key.get(key) if isinstance(category_meta_by_key, dict) else None
        behavior_type = str((category_meta or {}).get('behavior_type') or '').strip().lower()
        if behavior_type == DECK_CATEGORY_BEHAVIOR_TYPE_IV:
            target_conn = conn
            if target_conn is None:
                if owned_conn is None:
                    owned_conn = get_kid_connection_for(kid, read_only=True)
                target_conn = owned_conn
            targets[key] = int(get_type_iv_total_daily_target_for_category(target_conn, kid, key))
            continue
        if behavior_type in DECK_CATEGORY_BEHAVIOR_TYPES:
            targets[key] = int(get_category_session_card_count_for_kid(kid, key))
            continue
        targets[key] = 0
    if owned_conn is not None:
        owned_conn.close()
    return targets


# =====================================================================
# === 6. Composite progress section builder
# =====================================================================
def build_kid_daily_progress_section(kid, category_key, *, conn=None):
    """Compute per-card-per-day attempt aggregates + family timezone for one kid+category."""
    family_id = str(kid.get('familyId') or '').strip()
    family_timezone = metadata.get_family_timezone(family_id)
    try:
        tzinfo = ZoneInfo(family_timezone)
    except Exception:
        tzinfo = ZoneInfo('UTC')

    owns_conn = conn is None
    if owns_conn:
        conn = get_kid_connection_for(kid, read_only=True)
    try:
        attempts = conn.execute(
            """
            SELECT sr.card_id, sr.timestamp, sr.correct, COALESCE(sr.response_time_ms, 0)
            FROM session_results sr
            JOIN sessions s ON s.id = sr.session_id
            WHERE LOWER(TRIM(s.type)) = ?
              AND sr.card_id IS NOT NULL
              AND sr.timestamp IS NOT NULL
            ORDER BY sr.timestamp ASC
            """,
            [str(category_key or '').strip().lower()],
        ).fetchall()
    finally:
        if owns_conn:
            conn.close()

    agg = defaultdict(lambda: {'attempts': 0, 'correct': 0, 'correct_response_time_ms_sum': 0, 'correct_response_time_count': 0})
    for row in attempts:
        try:
            card_id_int = int(row[0])
        except (TypeError, ValueError):
            continue
        ts = row[1]
        if not isinstance(ts, datetime):
            continue
        if ts.tzinfo is None:
            ts = ts.replace(tzinfo=timezone.utc)
        local_dt = ts.astimezone(tzinfo)
        date_str = local_dt.strftime('%Y-%m-%d')
        entry = agg[(card_id_int, date_str)]
        entry['attempts'] += 1
        try:
            correct_val = int(row[2])
        except (TypeError, ValueError):
            correct_val = 0
        if correct_val == 1:
            entry['correct'] += 1
            try:
                rt_ms = int(row[3] or 0)
            except (TypeError, ValueError):
                rt_ms = 0
            if rt_ms > 0:
                entry['correct_response_time_ms_sum'] += rt_ms
                entry['correct_response_time_count'] += 1

    rows = [
        {
            'card_id': key[0],
            'date': key[1],
            'attempts': val['attempts'],
            'correct': val['correct'],
            'correct_response_time_ms_sum': val['correct_response_time_ms_sum'],
            'correct_response_time_count': val['correct_response_time_count'],
        }
        for key, val in agg.items()
    ]

    return {
        'family_timezone': family_timezone,
        'daily_progress_rows': rows,
    }
