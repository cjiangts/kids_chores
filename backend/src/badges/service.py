"""Badge evaluation and payload assembly for kid reward system."""
from __future__ import annotations

from collections import Counter, defaultdict
from datetime import datetime, timedelta, timezone
import json
from typing import Dict, List, Optional, Sequence, Set, Tuple
from zoneinfo import ZoneInfo

from src.badges import BadgeAchievementDefinition, DAY_ONE_BADGE_ACHIEVEMENTS

DEFAULT_BADGE_THEME = 'generic'


def _normalize_category_key(value) -> str:
    return str(value or '').strip().lower()


def _coerce_utc_naive_datetime(value) -> Optional[datetime]:
    """Parse one DB/python timestamp into naive UTC datetime."""
    if value is None:
        return None
    if isinstance(value, datetime):
        if value.tzinfo is None:
            return value
        return value.astimezone(timezone.utc).replace(tzinfo=None)

    text = str(value or '').strip()
    if not text:
        return None
    if text.endswith('Z'):
        text = f"{text[:-1]}+00:00"
    try:
        parsed = datetime.fromisoformat(text)
    except ValueError:
        return None
    if parsed.tzinfo is None:
        return parsed
    return parsed.astimezone(timezone.utc).replace(tzinfo=None)


def _to_iso(value) -> Optional[str]:
    dt = _coerce_utc_naive_datetime(value)
    return dt.isoformat() if dt else None


def _to_local_date(value, tz_name: str):
    dt = _coerce_utc_naive_datetime(value)
    if dt is None:
        return None
    try:
        tzinfo = ZoneInfo(str(tz_name or 'America/New_York'))
    except Exception:
        tzinfo = ZoneInfo('America/New_York')
    return dt.replace(tzinfo=timezone.utc).astimezone(tzinfo).date()


def _load_assigned_categories(kid_conn) -> Set[str]:
    """Return category keys currently assigned (>0 target and opted in)."""
    try:
        rows = kid_conn.execute(
            """
            SELECT category_key
            FROM deck_category_opt_in
            WHERE COALESCE(is_opted_in, FALSE) = TRUE
              AND COALESCE(session_card_count, 0) > 0
            """
        ).fetchall()
    except Exception:
        return set()

    keys: Set[str] = set()
    for row in rows:
        key = _normalize_category_key(row[0] if row else '')
        if key:
            keys.add(key)
    return keys


def _load_badge_art_catalog(shared_conn):
    rows = shared_conn.execute(
        """
        SELECT badge_art_id, theme_key, image_path, source_url, license
        FROM badge_art
        WHERE COALESCE(is_active, TRUE) = TRUE
        ORDER BY badge_art_id ASC
        """
    ).fetchall()

    art_by_id: Dict[int, Dict] = {}
    art_ids_by_theme: Dict[str, List[int]] = defaultdict(list)
    for row in rows:
        art_id = int(row[0])
        theme_key = str(row[1] or DEFAULT_BADGE_THEME).strip().lower() or DEFAULT_BADGE_THEME
        image_path = str(row[2] or '').strip()
        art_by_id[art_id] = {
            'badgeArtId': art_id,
            'themeKey': theme_key,
            'imagePath': image_path,
            'imageUrl': f"/{image_path.lstrip('/')}" if image_path else '',
            'sourceUrl': str(row[3] or '').strip(),
            'license': str(row[4] or '').strip(),
        }
        art_ids_by_theme[theme_key].append(art_id)
    return art_by_id, art_ids_by_theme


def _resolve_badge_art_id_for_definition(
    shared_conn,
    definition: BadgeAchievementDefinition,
    art_by_id: Dict[int, Dict],
    art_ids_by_theme: Dict[str, List[int]],
    *,
    allow_mapping_mutation: bool = True,
) -> Optional[int]:
    """Resolve one badge_art_id only from the explicit assignment table."""
    del art_ids_by_theme, allow_mapping_mutation
    achievement_key = str(definition.achievement_key or '').strip()
    category_key = _normalize_category_key(definition.category_key)
    if not achievement_key:
        return None

    row = shared_conn.execute(
        """
        SELECT badge_art_id
        FROM achievement_badge_art
        WHERE achievement_key = ? AND category_key = ?
        LIMIT 1
        """,
        [achievement_key, category_key],
    ).fetchone()
    if row is not None:
        mapped_id = int(row[0] or 0)
        if mapped_id in art_by_id:
            return mapped_id
    return None


def _load_session_rows_since(kid_conn, tracking_start_dt: datetime):
    return kid_conn.execute(
        """
        SELECT
            s.id,
            COALESCE(s.type, '') AS session_type,
            COALESCE(s.planned_count, 0) AS planned_count,
            COALESCE(s.retry_count, 0) AS retry_count,
            COALESCE(s.retry_best_rety_correct_count, 0) AS retry_best_correct_count,
            s.completed_at
        FROM sessions s
        WHERE s.completed_at IS NOT NULL
          AND s.completed_at >= ?
        ORDER BY s.completed_at ASC, s.id ASC
        """,
        [tracking_start_dt],
    ).fetchall()


def _load_session_accuracy_by_id(kid_conn, tracking_start_dt: datetime):
    rows = kid_conn.execute(
        """
        SELECT
            s.id,
            COALESCE(SUM(CASE WHEN sr.correct > 0 THEN 1 ELSE 0 END), 0) AS correct_count,
            COUNT(sr.id) AS total_count,
            COALESCE(SUM(COALESCE(sr.response_time_ms, 0)), 0) AS total_response_ms
        FROM sessions s
        LEFT JOIN session_results sr ON sr.session_id = s.id
        WHERE s.completed_at IS NOT NULL
          AND s.completed_at >= ?
        GROUP BY s.id
        """,
        [tracking_start_dt],
    ).fetchall()
    data: Dict[int, Dict[str, int]] = {}
    for row in rows:
        session_id = int(row[0] or 0)
        data[session_id] = {
            'correct_count': int(row[1] or 0),
            'total_count': int(row[2] or 0),
            'total_response_ms': int(row[3] or 0),
        }
    return data


def _is_session_strict_gold(*, planned_count: int, retry_count: int, total_count: int, correct_count: int) -> bool:
    if retry_count > 0:
        return False
    if total_count <= 0 or correct_count != total_count:
        return False

    planned_target = max(0, int(planned_count or 0))
    if planned_target > 0 and total_count < planned_target:
        return False
    return True


def _compute_max_streak(practice_dates) -> int:
    if not practice_dates:
        return 0
    sorted_days = sorted(practice_dates)
    best = 1
    current = 1
    for idx in range(1, len(sorted_days)):
        prev_day = sorted_days[idx - 1]
        day = sorted_days[idx]
        if day == prev_day + timedelta(days=1):
            current += 1
            if current > best:
                best = current
            continue
        current = 1
    return best


def _collect_metrics(kid_conn, tracking_start_dt: datetime, family_timezone: str, assigned_categories: Set[str]):
    session_rows = _load_session_rows_since(kid_conn, tracking_start_dt)
    accuracy_by_session = _load_session_accuracy_by_id(kid_conn, tracking_start_dt)

    completed_by_category: Counter = Counter()
    gold_by_category: Counter = Counter()
    practice_dates = set()
    categories_done_by_day = defaultdict(set)
    retry_comebacks = 0
    total_gold = 0
    total_active_ms = 0

    for row in session_rows:
        session_id = int(row[0] or 0)
        category_key = _normalize_category_key(row[1])
        planned_count = int(row[2] or 0)
        retry_count = int(row[3] or 0)
        retry_best = int(row[4] or 0)
        completed_at = row[5]

        if category_key:
            completed_by_category[category_key] += 1

        local_day = _to_local_date(completed_at, family_timezone)
        if local_day is not None:
            practice_dates.add(local_day)
            if category_key:
                categories_done_by_day[local_day].add(category_key)

        session_accuracy = accuracy_by_session.get(session_id, {})
        total_count = int(session_accuracy.get('total_count') or 0)
        correct_count = int(session_accuracy.get('correct_count') or 0)
        response_ms = int(session_accuracy.get('total_response_ms') or 0)
        total_active_ms += max(0, response_ms)

        if _is_session_strict_gold(
            planned_count=planned_count,
            retry_count=retry_count,
            total_count=total_count,
            correct_count=correct_count,
        ):
            total_gold += 1
            if category_key:
                gold_by_category[category_key] += 1

        if retry_count > 0 and retry_best > 0:
            retry_comebacks += 1

    # If session_results are empty, fallback to retry time aggregate.
    if total_active_ms <= 0:
        retry_total_row = kid_conn.execute(
            """
            SELECT COALESCE(SUM(COALESCE(s.retry_total_response_ms, 0)), 0)
            FROM sessions s
            WHERE s.completed_at IS NOT NULL
              AND s.completed_at >= ?
            """,
            [tracking_start_dt],
        ).fetchone()
        total_active_ms = int(retry_total_row[0] or 0) if retry_total_row else 0

    if assigned_categories:
        full_completion_days = {
            day
            for day in practice_dates
            if assigned_categories.issubset(categories_done_by_day.get(day, set()))
        }
    else:
        full_completion_days = set()

    return {
        'total_completed_sessions': int(len(session_rows)),
        'completed_sessions_in_category': completed_by_category,
        'total_active_minutes': max(0.0, total_active_ms / 60000.0),
        'completion_streak_days': int(_compute_max_streak(full_completion_days)),
        'all_assigned_done_days': int(len(full_completion_days)),
        'total_gold_sessions': int(total_gold),
        'gold_sessions_in_category': gold_by_category,
        'retry_comebacks': int(retry_comebacks),
        'practice_days_total': int(len(practice_dates)),
    }


def _metric_value_for_definition(metrics: Dict, definition: BadgeAchievementDefinition) -> float:
    rule_type = str(definition.rule_type or '').strip().lower()
    category_key = _normalize_category_key(definition.category_key)
    if rule_type == 'completed_sessions_in_category':
        return float(metrics['completed_sessions_in_category'].get(category_key, 0))
    if rule_type == 'gold_sessions_in_category':
        return float(metrics['gold_sessions_in_category'].get(category_key, 0))
    if rule_type == 'total_completed_sessions':
        return float(metrics['total_completed_sessions'])
    if rule_type == 'total_active_minutes':
        return float(metrics['total_active_minutes'])
    if rule_type == 'completion_streak_days':
        return float(metrics['completion_streak_days'])
    if rule_type == 'all_assigned_done_days':
        return float(metrics['all_assigned_done_days'])
    if rule_type == 'total_gold_sessions':
        return float(metrics['total_gold_sessions'])
    if rule_type == 'retry_comebacks':
        return float(metrics['retry_comebacks'])
    if rule_type == 'practice_days_total':
        return float(metrics['practice_days_total'])
    return 0.0


def _load_award_rows(kid_conn):
    return kid_conn.execute(
        """
        SELECT
            award_id,
            achievement_key,
            COALESCE(category_key, ''),
            badge_art_id,
            reason_text,
            evidence_json,
            awarded_at,
            celebration_seen_at
        FROM kid_badge_award
        ORDER BY awarded_at DESC, award_id DESC
        """
    ).fetchall()


def _load_pending_award_rows(kid_conn):
    return kid_conn.execute(
        """
        SELECT
            award_id,
            achievement_key,
            COALESCE(category_key, ''),
            badge_art_id,
            reason_text,
            evidence_json,
            awarded_at,
            celebration_seen_at
        FROM kid_badge_award
        WHERE celebration_seen_at IS NULL
        ORDER BY awarded_at ASC, award_id ASC
        """
    ).fetchall()


def _load_award_summary_counts(kid_conn):
    row = kid_conn.execute(
        """
        SELECT
            COUNT(*) AS earned_count,
            COALESCE(SUM(CASE WHEN celebration_seen_at IS NULL THEN 1 ELSE 0 END), 0) AS pending_celebration_count
        FROM kid_badge_award
        """
    ).fetchone()
    if row is None:
        return {
            'earnedCount': 0,
            'pendingCelebrationCount': 0,
        }
    return {
        'earnedCount': int(row[0] or 0),
        'pendingCelebrationCount': int(row[1] or 0),
    }


def _build_award_lookup(award_rows):
    award_lookup = {}
    for row in award_rows:
        achievement_key = str(row[1] or '').strip()
        category_key = _normalize_category_key(row[2])
        if achievement_key:
            award_lookup[(achievement_key, category_key)] = row
    return award_lookup


def _safe_parse_evidence_json(text: str):
    try:
        value = json.loads(str(text or ''))
        if isinstance(value, dict):
            return value
    except Exception:
        pass
    return {}


def _award_definition_if_needed(
    kid_conn,
    shared_conn,
    definition: BadgeAchievementDefinition,
    metric_value: float,
    art_by_id: Dict[int, Dict],
    art_ids_by_theme: Dict[str, List[int]],
    existing_award_lookup: Dict[Tuple[str, str], tuple],
) -> bool:
    achievement_key = str(definition.achievement_key or '').strip()
    category_key = _normalize_category_key(definition.category_key)
    if not achievement_key:
        return False
    award_key = (achievement_key, category_key)
    if award_key in existing_award_lookup:
        return False
    threshold = int(definition.threshold_value or 0)
    if metric_value < threshold:
        return False

    badge_art_id = _resolve_badge_art_id_for_definition(
        shared_conn,
        definition,
        art_by_id,
        art_ids_by_theme,
        allow_mapping_mutation=True,
    )
    if badge_art_id is None:
        return False

    evidence_json = json.dumps({
        'rule_type': str(definition.rule_type or ''),
        'threshold': threshold,
        'value': metric_value,
        'category_key': category_key,
    }, ensure_ascii=False, sort_keys=True)
    kid_conn.execute(
        """
        INSERT INTO kid_badge_award (
            achievement_key,
            category_key,
            badge_art_id,
            reason_text,
            evidence_json
        )
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT (achievement_key, category_key) DO NOTHING
        """,
        [
            achievement_key,
            category_key,
            int(badge_art_id),
            str(definition.reason_text or '').strip() or str(definition.title or '').strip(),
            evidence_json,
        ],
    )
    row = kid_conn.execute(
        """
        SELECT
            award_id,
            achievement_key,
            COALESCE(category_key, ''),
            badge_art_id,
            reason_text,
            evidence_json,
            awarded_at,
            celebration_seen_at
        FROM kid_badge_award
        WHERE achievement_key = ? AND category_key = ?
        LIMIT 1
        """,
        [achievement_key, category_key],
    ).fetchone()
    if row is None:
        return False
    existing_award_lookup[award_key] = row
    return True


def _serialize_badge_item(
    definition: BadgeAchievementDefinition,
    award_row,
    art_meta: Dict,
    progress_value: float,
):
    threshold_value = int(definition.threshold_value or 0)
    is_earned = award_row is not None
    evidence = {}
    if award_row is not None:
        evidence = _safe_parse_evidence_json(award_row[5])
    return {
        'awardId': int(award_row[0]) if award_row is not None else None,
        'achievementKey': str(definition.achievement_key or ''),
        'categoryKey': _normalize_category_key(definition.category_key),
        'title': str(definition.title or ''),
        'themeKey': str(definition.theme_key or DEFAULT_BADGE_THEME),
        'ruleType': str(definition.rule_type or ''),
        'thresholdValue': threshold_value,
        'progressValue': max(0.0, float(progress_value)),
        'isEarned': bool(is_earned),
        'reasonText': str(award_row[4] or '') if award_row is not None else '',
        'goalText': str(definition.goal_text or ''),
        'awardedAt': _to_iso(award_row[6]) if award_row is not None else None,
        'celebrationSeenAt': _to_iso(award_row[7]) if award_row is not None else None,
        'badgeArtId': int(art_meta.get('badgeArtId') or 0),
        'badgeImagePath': str(art_meta.get('imagePath') or ''),
        'badgeImageUrl': str(art_meta.get('imageUrl') or ''),
        'badgeSourceUrl': str(art_meta.get('sourceUrl') or ''),
        'badgeLicense': str(art_meta.get('license') or ''),
        'evidence': evidence,
    }


def _badge_definition_lookup() -> Dict[Tuple[str, str], BadgeAchievementDefinition]:
    lookup: Dict[Tuple[str, str], BadgeAchievementDefinition] = {}
    for definition in DAY_ONE_BADGE_ACHIEVEMENTS:
        achievement_key = str(definition.achievement_key or '').strip()
        if not achievement_key:
            continue
        lookup[(achievement_key, _normalize_category_key(definition.category_key))] = definition
    return lookup


def _load_badge_art_meta_by_ids(shared_conn, badge_art_ids: Sequence[int]) -> Dict[int, Dict]:
    normalized_ids = sorted({
        int(value)
        for value in (badge_art_ids or [])
        if int(value or 0) > 0
    })
    if not normalized_ids:
        return {}
    placeholders = ', '.join(['?'] * len(normalized_ids))
    rows = shared_conn.execute(
        f"""
        SELECT badge_art_id, theme_key, image_path, source_url, license
        FROM badge_art
        WHERE badge_art_id IN ({placeholders})
        """,
        normalized_ids,
    ).fetchall()
    art_by_id: Dict[int, Dict] = {}
    for row in rows:
        art_id = int(row[0] or 0)
        image_path = str(row[2] or '').strip()
        art_by_id[art_id] = {
            'badgeArtId': art_id,
            'themeKey': str(row[1] or DEFAULT_BADGE_THEME).strip().lower() or DEFAULT_BADGE_THEME,
            'imagePath': image_path,
            'imageUrl': f"/{image_path.lstrip('/')}" if image_path else '',
            'sourceUrl': str(row[3] or '').strip(),
            'license': str(row[4] or '').strip(),
        }
    return art_by_id


def build_kid_badge_payload(
    kid_conn,
    shared_conn,
    *,
    family_timezone: str,
    tracking_started_at: Optional[str],
    allow_award_mutation: bool = False,
):
    """Evaluate rewards and build one kid badge payload."""
    assigned_categories = _load_assigned_categories(kid_conn)
    tracking_start_dt = _coerce_utc_naive_datetime(tracking_started_at)
    tracking_enabled = tracking_start_dt is not None

    award_rows = _load_award_rows(kid_conn)
    award_lookup = _build_award_lookup(award_rows)
    art_by_id, art_ids_by_theme = _load_badge_art_catalog(shared_conn)

    metrics = {
        'total_completed_sessions': 0,
        'completed_sessions_in_category': Counter(),
        'total_active_minutes': 0.0,
        'completion_streak_days': 0,
        'all_assigned_done_days': 0,
        'total_gold_sessions': 0,
        'gold_sessions_in_category': Counter(),
        'retry_comebacks': 0,
        'practice_days_total': 0,
    }
    new_award_count = 0

    relevant_definitions = list(DAY_ONE_BADGE_ACHIEVEMENTS)

    if tracking_enabled:
        metrics = _collect_metrics(kid_conn, tracking_start_dt, family_timezone, assigned_categories)
    if tracking_enabled and allow_award_mutation:
        for definition in relevant_definitions:
            metric_value = _metric_value_for_definition(metrics, definition)
            created = _award_definition_if_needed(
                kid_conn,
                shared_conn,
                definition,
                metric_value,
                art_by_id,
                art_ids_by_theme,
                award_lookup,
            )
            if created:
                new_award_count += 1
        award_rows = _load_award_rows(kid_conn)
        award_lookup = _build_award_lookup(award_rows)

    earned_badges = []
    coming_next = []
    pending_celebrations = []

    for definition in relevant_definitions:
        key = (
            str(definition.achievement_key or '').strip(),
            _normalize_category_key(definition.category_key),
        )
        award_row = award_lookup.get(key)
        art_id = _resolve_badge_art_id_for_definition(
            shared_conn,
            definition,
            art_by_id,
            art_ids_by_theme,
            allow_mapping_mutation=allow_award_mutation,
        )
        if art_id is None:
            continue
        art_meta = art_by_id.get(int(art_id or 0), {
            'badgeArtId': 0,
            'imagePath': '',
            'imageUrl': '',
            'sourceUrl': '',
            'license': '',
        })
        progress_value = _metric_value_for_definition(metrics, definition) if tracking_enabled else 0.0
        item = _serialize_badge_item(definition, award_row, art_meta, progress_value)
        if award_row is not None:
            earned_badges.append(item)
            if not item['celebrationSeenAt']:
                pending_celebrations.append(item)
        else:
            coming_next.append(item)

    earned_badges.sort(
        key=lambda item: (
            str(item.get('awardedAt') or ''),
            int(item.get('awardId') or 0),
        ),
        reverse=True,
    )
    pending_celebrations.sort(
        key=lambda item: (
            str(item.get('awardedAt') or ''),
            int(item.get('awardId') or 0),
        )
    )
    coming_next.sort(
        key=lambda item: (
            int(item.get('thresholdValue') or 0),
            str(item.get('achievementKey') or ''),
            str(item.get('categoryKey') or ''),
        )
    )

    return {
        'trackingEnabled': tracking_enabled,
        'trackingStartedAt': _to_iso(tracking_start_dt) if tracking_enabled else None,
        'assignedCategoryKeys': sorted(assigned_categories),
        'metrics': {
            'totalCompletedSessions': int(metrics['total_completed_sessions']),
            'totalActiveMinutes': float(metrics['total_active_minutes']),
            'completionStreakDays': int(metrics['completion_streak_days']),
            'allAssignedDoneDays': int(metrics['all_assigned_done_days']),
            'totalGoldSessions': int(metrics['total_gold_sessions']),
            'retryComebacks': int(metrics['retry_comebacks']),
            'practiceDaysTotal': int(metrics['practice_days_total']),
        },
        'summary': {
            'earnedCount': len(earned_badges),
            'comingCount': len(coming_next),
            'pendingCelebrationCount': len(pending_celebrations),
            'newAwardCount': int(new_award_count),
        },
        'earned': earned_badges,
        'comingNext': coming_next,
        'pendingCelebrations': pending_celebrations,
    }


def build_kid_badge_summary_payload(
    kid_conn,
    *,
    tracking_started_at: Optional[str],
):
    tracking_start_dt = _coerce_utc_naive_datetime(tracking_started_at)
    tracking_enabled = tracking_start_dt is not None
    counts = _load_award_summary_counts(kid_conn)
    return {
        'trackingEnabled': tracking_enabled,
        'trackingStartedAt': _to_iso(tracking_start_dt) if tracking_enabled else None,
        'summary': {
            'earnedCount': int(counts['earnedCount']),
            'pendingCelebrationCount': int(counts['pendingCelebrationCount']),
        },
    }


def build_kid_pending_celebrations_payload(
    kid_conn,
    shared_conn,
    *,
    tracking_started_at: Optional[str],
    summary_payload: Optional[Dict] = None,
):
    summary_payload = summary_payload or build_kid_badge_summary_payload(
        kid_conn,
        tracking_started_at=tracking_started_at,
    )
    tracking_enabled = bool(summary_payload.get('trackingEnabled'))
    pending_count = int((summary_payload.get('summary') or {}).get('pendingCelebrationCount', 0))
    if not tracking_enabled or pending_count <= 0:
        return {
            **summary_payload,
            'pendingCelebrations': [],
        }

    definition_lookup = _badge_definition_lookup()
    pending_rows = _load_pending_award_rows(kid_conn)
    art_by_id = _load_badge_art_meta_by_ids(
        shared_conn,
        [int(row[3] or 0) for row in pending_rows],
    )
    pending_celebrations = []
    for award_row in pending_rows:
        key = (
            str(award_row[1] or '').strip(),
            _normalize_category_key(award_row[2]),
        )
        definition = definition_lookup.get(key)
        if definition is None:
            continue
        art_meta = art_by_id.get(int(award_row[3] or 0), {
            'badgeArtId': 0,
            'imagePath': '',
            'imageUrl': '',
            'sourceUrl': '',
            'license': '',
        })
        pending_celebrations.append(
            _serialize_badge_item(
                definition,
                award_row,
                art_meta,
                float(definition.threshold_value or 0),
            )
        )

    return {
        **summary_payload,
        'summary': {
            **(summary_payload.get('summary') or {}),
            'pendingCelebrationCount': len(pending_celebrations),
        },
        'pendingCelebrations': pending_celebrations,
    }


def sync_kid_badges_awards(
    kid_conn,
    shared_conn,
    *,
    family_timezone: str,
    tracking_started_at: Optional[str],
):
    """Write-side badge sync used by session-complete flows."""
    payload = build_kid_badge_payload(
        kid_conn,
        shared_conn,
        family_timezone=family_timezone,
        tracking_started_at=tracking_started_at,
        allow_award_mutation=True,
    )
    summary = payload.get('summary') if isinstance(payload, dict) else {}
    return {
        'newAwardCount': int((summary or {}).get('newAwardCount', 0)),
        'pendingCelebrationCount': int((summary or {}).get('pendingCelebrationCount', 0)),
    }


def mark_celebrations_seen(kid_conn, award_ids: Optional[Sequence[int]] = None) -> int:
    """Mark one or all unseen badge celebrations as seen."""
    ids = [
        int(value)
        for value in (award_ids or [])
        if str(value).strip() and str(value).strip().lstrip('-').isdigit()
    ]
    if ids:
        placeholders = ', '.join(['?'] * len(ids))
        row = kid_conn.execute(
            f"""
            UPDATE kid_badge_award
            SET celebration_seen_at = CURRENT_TIMESTAMP
            WHERE celebration_seen_at IS NULL
              AND award_id IN ({placeholders})
            RETURNING award_id
            """,
            ids,
        ).fetchall()
        return len(row)

    row = kid_conn.execute(
        """
        UPDATE kid_badge_award
        SET celebration_seen_at = CURRENT_TIMESTAMP
        WHERE celebration_seen_at IS NULL
        RETURNING award_id
        """
    ).fetchall()
    return len(row)
