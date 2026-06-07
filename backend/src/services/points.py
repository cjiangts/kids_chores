"""Family point rules and kid-local point event helpers."""
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from src.db import metadata
from src.routes.kids_constants import SESSION_RESULT_PARTIAL, SESSION_RESULT_WRONG_UNRESOLVED
from src.services.shared_deck_normalize import normalize_shared_deck_tag

RULE_KIND_IN_APP_CHORE = 'in_app_chore'
RULE_KIND_OFF_APP_CHORE = 'off_app_chore'
RULE_KIND_BONUS_EVENT = 'bonus_event'
RULE_KIND_DEDUCTION_EVENT = 'deduction_event'
RULE_KIND_REDEEMED_REWARD = 'redeemed_reward'
RULE_KINDS = {
    RULE_KIND_IN_APP_CHORE,
    RULE_KIND_OFF_APP_CHORE,
    RULE_KIND_BONUS_EVENT,
    RULE_KIND_DEDUCTION_EVENT,
    RULE_KIND_REDEEMED_REWARD,
}


def _utc_isoformat(value):
    if not value:
        return None
    if isinstance(value, str):
        text = value.strip()
        if not text:
            return None
        try:
            dt = datetime.fromisoformat(text.replace('Z', '+00:00'))
        except ValueError:
            return text if text.endswith('Z') else f'{text}Z'
    elif hasattr(value, 'isoformat'):
        dt = value
    else:
        return None
    if getattr(dt, 'tzinfo', None) is None:
        dt = dt.replace(tzinfo=timezone.utc)
    else:
        dt = dt.astimezone(timezone.utc)
    return dt.isoformat().replace('+00:00', 'Z')


def _utc_now_naive():
    return datetime.now(timezone.utc).replace(tzinfo=None)


def _utc_naive(value):
    if value is None:
        return None
    if isinstance(value, datetime):
        dt = value
    elif isinstance(value, str):
        text = value.strip()
        if not text:
            return None
        dt = datetime.fromisoformat(text.replace('Z', '+00:00'))
    else:
        return None
    if dt.tzinfo is None:
        return dt
    return dt.astimezone(timezone.utc).replace(tzinfo=None)


def normalize_rule_kind(value):
    return str(value or '').strip().lower()


def normalize_reward_type(value):
    normalized = ' '.join(str(value or '').strip().lower().split())
    return normalized[:64]


def reward_type_for_rule(rule):
    if not isinstance(rule, dict) or rule.get('ruleKind') != RULE_KIND_REDEEMED_REWARD:
        return None
    return normalize_reward_type(rule.get('rewardType')) or None


def _event_sign_for_rule_kind(rule_kind):
    normalized = normalize_rule_kind(rule_kind)
    if normalized in {RULE_KIND_DEDUCTION_EVENT, RULE_KIND_REDEEMED_REWARD}:
        return -1
    return 1


def _event_delta_for_rule(rule, *, points_delta=None, field_name='pointsDelta'):
    if not isinstance(rule, dict):
        raise ValueError('Rule not found')
    max_point = rule.get('maxPoint')
    if points_delta is None:
        if max_point is None:
            raise ValueError('Rule maxPoint is not configured')
        amount = int(max_point)
    else:
        amount = _coerce_int(points_delta, field_name=field_name)
    if amount <= 0:
        raise ValueError(f'{field_name} must be positive')
    if max_point is not None and amount > int(max_point):
        raise ValueError(f'{field_name} cannot exceed rule max point')
    return _event_sign_for_rule_kind(rule.get('ruleKind')) * amount


def _coerce_int(value, *, field_name, required=True):
    if value is None or value == '':
        if required:
            raise ValueError(f'{field_name} is required')
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        raise ValueError(f'{field_name} must be an integer')


def _family_id_int(value):
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        parsed = 0
    if parsed <= 0:
        raise ValueError('family_id is required')
    return parsed


def _rule_row_to_payload(row):
    if not row:
        return None
    return {
        'ruleId': int(row[0] or 0),
        'familyId': int(row[1] or 0),
        'name': str(row[2] or ''),
        'emoji': str(row[3] or ''),
        'ruleKind': normalize_rule_kind(row[4]),
        'triggerKey': str(row[5] or ''),
        'maxPoint': int(row[6]) if row[6] is not None else None,
        'rewardType': normalize_reward_type(row[7]),
        'isActive': bool(row[8]),
    }


def _event_row_to_payload(row, rule_lookup=None):
    if not row:
        return None
    rule_id = int(row[1] or 0)
    rule = rule_lookup.get(rule_id) if isinstance(rule_lookup, dict) else None
    created_at = row[4]
    return {
        'eventId': int(row[0] or 0),
        'ruleId': rule_id,
        'pointsDelta': int(row[2] or 0),
        'note': str(row[3] or ''),
        'createdAt': _utc_isoformat(created_at),
        'rule': rule,
    }


def _pending_row_to_payload(row, rule_lookup=None):
    if not row:
        return None
    rule_id = int(row[1] or 0)
    submitted_at = row[2]
    return {
        'pendingId': int(row[0] or 0),
        'ruleId': rule_id,
        'submittedAt': _utc_isoformat(submitted_at),
        'rule': rule_lookup.get(rule_id) if isinstance(rule_lookup, dict) else None,
    }


def _normalize_rule_payload(payload, *, existing=None):
    data = payload if isinstance(payload, dict) else {}
    base = existing if isinstance(existing, dict) else {}
    name = str(data.get('name', base.get('name') or '') or '').strip()
    if not name:
        raise ValueError('name is required')

    rule_kind = normalize_rule_kind(data.get('ruleKind', base.get('ruleKind')))
    if rule_kind not in RULE_KINDS:
        raise ValueError('ruleKind is invalid')

    emoji = str(data.get('emoji', base.get('emoji') or '') or '').strip()
    is_active = bool(data.get('isActive', base.get('isActive', True)))
    trigger_key = ''
    if rule_kind == RULE_KIND_IN_APP_CHORE:
        trigger_key = normalize_shared_deck_tag(data.get('triggerKey', base.get('triggerKey')))
        if not trigger_key:
            raise ValueError('triggerKey is required for in_app_chore rules')

    max_point = _coerce_int(
        data.get('maxPoint', base.get('maxPoint')),
        field_name='maxPoint',
        required=False,
    )
    if max_point is not None and max_point <= 0:
        raise ValueError('maxPoint must be positive')

    reward_type = None
    if rule_kind == RULE_KIND_REDEEMED_REWARD:
        reward_type = normalize_reward_type(data.get('rewardType', base.get('rewardType')))
        if not reward_type:
            raise ValueError('rewardType is required for reward rules')

    return {
        'name': name,
        'emoji': emoji,
        'ruleKind': rule_kind,
        'triggerKey': trigger_key,
        'maxPoint': max_point,
        'rewardType': reward_type,
        'isActive': is_active,
    }


def get_family_rule(conn, family_id, rule_id):
    family_id_int = _family_id_int(family_id)
    row = conn.execute(
        """
        SELECT
          rule_id,
          family_id,
          name,
          emoji,
          rule_kind,
          trigger_key,
          max_point,
          reward_type,
          is_active
        FROM point_rule
        WHERE family_id = ? AND rule_id = ?
        """,
        [family_id_int, int(rule_id or 0)],
    ).fetchone()
    return _rule_row_to_payload(row)


def list_family_rules(conn, family_id, *, rule_kind=None, include_inactive=True):
    family_id_int = _family_id_int(family_id)
    filters = ['family_id = ?']
    params = [family_id_int]
    normalized_kind = normalize_rule_kind(rule_kind)
    if normalized_kind:
        if normalized_kind not in RULE_KINDS:
            raise ValueError('ruleKind is invalid')
        filters.append('rule_kind = ?')
        params.append(normalized_kind)
    if not include_inactive:
        filters.append('is_active = TRUE')
    rows = conn.execute(
        f"""
        SELECT
          rule_id,
          family_id,
          name,
          emoji,
          rule_kind,
          trigger_key,
          max_point,
          reward_type,
          is_active
        FROM point_rule
        WHERE {' AND '.join(filters)}
        ORDER BY rule_kind ASC, is_active DESC, rule_id ASC
        """,
        params,
    ).fetchall()
    return [_rule_row_to_payload(row) for row in rows]


def create_family_rule(conn, family_id, payload):
    family_id_int = _family_id_int(family_id)
    normalized = _normalize_rule_payload(payload)
    row = conn.execute(
        """
        INSERT INTO point_rule (
          family_id,
          name,
          emoji,
          rule_kind,
          trigger_key,
          max_point,
          reward_type,
          is_active
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        RETURNING
          rule_id,
          family_id,
          name,
          emoji,
          rule_kind,
          trigger_key,
          max_point,
          reward_type,
          is_active
        """,
        [
            family_id_int,
            normalized['name'],
            normalized['emoji'],
            normalized['ruleKind'],
            normalized['triggerKey'],
            normalized['maxPoint'],
            normalized['rewardType'],
            normalized['isActive'],
        ],
    ).fetchone()
    return _rule_row_to_payload(row)


def update_family_rule(conn, family_id, rule_id, payload):
    existing = get_family_rule(conn, family_id, rule_id)
    if not existing:
        raise KeyError('Rule not found')
    normalized = _normalize_rule_payload(payload, existing=existing)
    row = conn.execute(
        """
        UPDATE point_rule
        SET
          name = ?,
          emoji = ?,
          rule_kind = ?,
          trigger_key = ?,
          max_point = ?,
          reward_type = ?,
          is_active = ?
        WHERE family_id = ? AND rule_id = ?
        RETURNING
          rule_id,
          family_id,
          name,
          emoji,
          rule_kind,
          trigger_key,
          max_point,
          reward_type,
          is_active
        """,
        [
            normalized['name'],
            normalized['emoji'],
            normalized['ruleKind'],
            normalized['triggerKey'],
            normalized['maxPoint'],
            normalized['rewardType'],
            normalized['isActive'],
            _family_id_int(family_id),
            int(rule_id or 0),
        ],
    ).fetchone()
    return _rule_row_to_payload(row)


def deactivate_family_rule(conn, family_id, rule_id):
    row = conn.execute(
        """
        UPDATE point_rule
        SET is_active = FALSE
        WHERE family_id = ? AND rule_id = ?
        RETURNING
          rule_id,
          family_id,
          name,
          emoji,
          rule_kind,
          trigger_key,
          max_point,
          reward_type,
          is_active
        """,
        [_family_id_int(family_id), int(rule_id or 0)],
    ).fetchone()
    return _rule_row_to_payload(row)


def _load_rule_lookup(conn, family_id, rule_ids):
    ids = sorted({int(item) for item in list(rule_ids or []) if int(item or 0) > 0})
    if not ids:
        return {}
    placeholders = ','.join(['?'] * len(ids))
    rows = conn.execute(
        f"""
        SELECT
          rule_id,
          family_id,
          name,
          emoji,
          rule_kind,
          trigger_key,
          max_point,
          reward_type,
          is_active
        FROM point_rule
        WHERE family_id = ? AND rule_id IN ({placeholders})
        """,
        [_family_id_int(family_id), *ids],
    ).fetchall()
    return {
        int(row[0] or 0): _rule_row_to_payload(row)
        for row in rows
    }


def list_enabled_off_app_chores(kid_conn, shared_conn, family_id):
    rows = kid_conn.execute(
        "SELECT rule_id FROM kid_off_app_chore ORDER BY rule_id ASC"
    ).fetchall()
    rule_ids = [int(row[0] or 0) for row in rows]
    lookup = _load_rule_lookup(shared_conn, family_id, rule_ids)
    return [
        lookup[rule_id]
        for rule_id in rule_ids
        if rule_id in lookup
        and lookup[rule_id]['ruleKind'] == RULE_KIND_OFF_APP_CHORE
        and lookup[rule_id]['isActive']
    ]


def set_enabled_off_app_chores(kid_conn, shared_conn, family_id, rule_ids):
    normalized_ids = []
    for item in list(rule_ids or []):
        rule_id = int(item or 0)
        if rule_id > 0 and rule_id not in normalized_ids:
            normalized_ids.append(rule_id)
    lookup = _load_rule_lookup(shared_conn, family_id, normalized_ids)
    for rule_id in normalized_ids:
        rule = lookup.get(rule_id)
        if not rule or rule['ruleKind'] != RULE_KIND_OFF_APP_CHORE:
            raise ValueError('All enabled off-app chore rules must exist and be off_app_chore')
    kid_conn.execute('BEGIN TRANSACTION')
    try:
        kid_conn.execute('DELETE FROM kid_off_app_chore')
        for rule_id in normalized_ids:
            kid_conn.execute(
                'INSERT INTO kid_off_app_chore (rule_id) VALUES (?)',
                [rule_id],
            )
        kid_conn.execute('COMMIT')
    except Exception:
        kid_conn.execute('ROLLBACK')
        raise
    return list_enabled_off_app_chores(kid_conn, shared_conn, family_id)


def _family_day_bounds_utc(family_id):
    family_timezone = metadata.get_family_timezone(str(family_id))
    tzinfo = ZoneInfo(family_timezone)
    start_local = datetime.now(tzinfo).replace(hour=0, minute=0, second=0, microsecond=0)
    end_local = start_local + timedelta(days=1)
    return (
        start_local.astimezone(timezone.utc).replace(tzinfo=None),
        end_local.astimezone(timezone.utc).replace(tzinfo=None),
    )


def has_point_event_for_rule_today(kid_conn, family_id, rule_id):
    day_start_utc, day_end_utc = _family_day_bounds_utc(family_id)
    row = kid_conn.execute(
        """
        SELECT COUNT(*)
        FROM point_event
        WHERE rule_id = ?
          AND created_at >= ?
          AND created_at < ?
        """,
        [int(rule_id or 0), day_start_utc, day_end_utc],
    ).fetchone()
    return int(row[0] or 0) > 0 if row else False


def list_rule_ids_with_point_events_today(kid_conn, family_id, rule_ids):
    ids = sorted({int(item) for item in list(rule_ids or []) if int(item or 0) > 0})
    if not ids:
        return set()
    day_start_utc, day_end_utc = _family_day_bounds_utc(family_id)
    placeholders = ','.join(['?'] * len(ids))
    rows = kid_conn.execute(
        f"""
        SELECT DISTINCT rule_id
        FROM point_event
        WHERE rule_id IN ({placeholders})
          AND created_at >= ?
          AND created_at < ?
        """,
        [*ids, day_start_utc, day_end_utc],
    ).fetchall()
    return {int(row[0] or 0) for row in rows if row and int(row[0] or 0) > 0}


def list_latest_point_events_today_by_rule(kid_conn, family_id, rule_ids):
    ids = sorted({int(item) for item in list(rule_ids or []) if int(item or 0) > 0})
    if not ids:
        return {}
    day_start_utc, day_end_utc = _family_day_bounds_utc(family_id)
    placeholders = ','.join(['?'] * len(ids))
    rows = kid_conn.execute(
        f"""
        SELECT event_id, rule_id, points_delta, note, created_at
        FROM point_event
        WHERE rule_id IN ({placeholders})
          AND created_at >= ?
          AND created_at < ?
        ORDER BY created_at DESC, event_id DESC
        """,
        [*ids, day_start_utc, day_end_utc],
    ).fetchall()
    events_by_rule = {}
    for row in rows:
        if not row:
            continue
        rule_id = int(row[1] or 0)
        if rule_id > 0 and rule_id not in events_by_rule:
            events_by_rule[rule_id] = _event_row_to_payload(row)
    return events_by_rule


def has_point_event_for_rule_at_timestamp(kid_conn, rule_id, created_at):
    if created_at is None:
        return False
    row = kid_conn.execute(
        """
        SELECT COUNT(*)
        FROM point_event
        WHERE rule_id = ?
          AND created_at = ?
        """,
        [int(rule_id or 0), created_at],
    ).fetchone()
    return int(row[0] or 0) > 0 if row else False


def insert_point_event(kid_conn, rule_id, points_delta, *, note=None, created_at=None):
    created_at_utc = _utc_naive(created_at) or _utc_now_naive()
    row = kid_conn.execute(
        """
        INSERT INTO point_event (rule_id, points_delta, note, created_at)
        VALUES (?, ?, ?, ?)
        RETURNING event_id, rule_id, points_delta, note, created_at
        """,
        [int(rule_id), int(points_delta), str(note or '').strip() or None, created_at_utc],
    ).fetchone()
    return _event_row_to_payload(row)


def update_point_event(kid_conn, event_id, *, points_delta, note=None):
    points_delta_value = _coerce_int(points_delta, field_name='pointsDelta')
    row = kid_conn.execute(
        """
        UPDATE point_event
        SET points_delta = ?, note = ?
        WHERE event_id = ?
        RETURNING event_id, rule_id, points_delta, note, created_at
        """,
        [points_delta_value, str(note or '').strip() or None, int(event_id or 0)],
    ).fetchone()
    return _event_row_to_payload(row)


def list_point_events(kid_conn, shared_conn, family_id, *, limit=100):
    safe_limit = max(1, min(500, int(limit or 100)))
    rows = kid_conn.execute(
        """
        SELECT event_id, rule_id, points_delta, note, created_at
        FROM point_event
        ORDER BY created_at DESC, event_id DESC
        LIMIT ?
        """,
        [safe_limit],
    ).fetchall()
    rule_ids = [int(row[1] or 0) for row in rows]
    lookup = _load_rule_lookup(shared_conn, family_id, rule_ids)
    return [_event_row_to_payload(row, lookup) for row in rows]


def get_point_total(kid_conn):
    row = kid_conn.execute(
        "SELECT COALESCE(SUM(points_delta), 0) FROM point_event"
    ).fetchone()
    return int(row[0] or 0) if row else 0


def get_reward_bucket_totals(kid_conn, shared_conn, family_id):
    rows = kid_conn.execute(
        """
        SELECT rule_id, points_delta
        FROM point_event
        """
    ).fetchall()
    rule_ids = [int(row[0] or 0) for row in rows]
    lookup = _load_rule_lookup(shared_conn, family_id, rule_ids)
    base_points = 0
    buckets = set()
    reward_rules = list_family_rules(
        shared_conn,
        family_id,
        rule_kind=RULE_KIND_REDEEMED_REWARD,
        include_inactive=True,
    )
    for rule in reward_rules:
        bucket = reward_type_for_rule(rule)
        if bucket:
            buckets.add(bucket)
    redeemed_by_bucket = {bucket: 0 for bucket in buckets}
    for row in rows:
        if not row:
            continue
        rule_id = int(row[0] or 0)
        delta = int(row[1] or 0)
        bucket = reward_type_for_rule(lookup.get(rule_id, {}))
        if bucket:
            buckets.add(bucket)
            redeemed_by_bucket.setdefault(bucket, 0)
            redeemed_by_bucket[bucket] += delta
        else:
            base_points += delta
    return {
        bucket: {
            'bucket': bucket,
            'basePoints': base_points,
            'redeemedPoints': redeemed_by_bucket[bucket],
            'totalPoints': base_points + redeemed_by_bucket[bucket],
        }
        for bucket in sorted(buckets)
    }


def delete_point_event(kid_conn, event_id):
    row = kid_conn.execute(
        """
        DELETE FROM point_event
        WHERE event_id = ?
        RETURNING event_id
        """,
        [int(event_id or 0)],
    ).fetchone()
    return bool(row)


def apply_direct_rule_event(kid_conn, shared_conn, family_id, rule_id, *, points_delta=None, note=None):
    rule = get_family_rule(shared_conn, family_id, rule_id)
    if not rule or not rule['isActive']:
        raise ValueError('Rule not found')
    if rule['ruleKind'] not in {
        RULE_KIND_OFF_APP_CHORE,
        RULE_KIND_BONUS_EVENT,
        RULE_KIND_DEDUCTION_EVENT,
        RULE_KIND_REDEEMED_REWARD,
    }:
        raise ValueError('Only off_app_chore, bonus_event, deduction_event, and redeemed_reward rules can be applied directly')
    if rule['ruleKind'] == RULE_KIND_OFF_APP_CHORE:
        enabled = kid_conn.execute(
            "SELECT 1 FROM kid_off_app_chore WHERE rule_id = ?",
            [rule['ruleId']],
        ).fetchone()
        if not enabled:
            raise ValueError('Off-app chore is not enabled for this kid')
    points_delta = _event_delta_for_rule(rule, points_delta=points_delta, field_name='points')
    bucket = reward_type_for_rule(rule)
    if bucket:
        bucket_totals = get_reward_bucket_totals(kid_conn, shared_conn, family_id)
        current_bucket_total = int(bucket_totals.get(bucket, {}).get('totalPoints') or 0)
        if current_bucket_total + points_delta < 0:
            raise ValueError('Not enough points for this reward bucket')
    return insert_point_event(
        kid_conn,
        rule['ruleId'],
        points_delta,
        note=note,
    )


def list_pending_off_app_chores(kid_conn, shared_conn, family_id):
    rows = kid_conn.execute(
        """
        SELECT pending_id, rule_id, submitted_at
        FROM pending_off_app_chore
        ORDER BY submitted_at ASC, pending_id ASC
        """
    ).fetchall()
    rule_ids = [int(row[1] or 0) for row in rows]
    lookup = _load_rule_lookup(shared_conn, family_id, rule_ids)
    return [_pending_row_to_payload(row, lookup) for row in rows]


def count_pending_off_app_chores(kid_conn):
    row = kid_conn.execute(
        "SELECT COUNT(*) FROM pending_off_app_chore"
    ).fetchone()
    return int(row[0] or 0) if row else 0


def submit_off_app_chore(kid_conn, shared_conn, family_id, rule_id):
    rule = get_family_rule(shared_conn, family_id, rule_id)
    if not rule or not rule['isActive'] or rule['ruleKind'] != RULE_KIND_OFF_APP_CHORE:
        raise ValueError('Off-app chore rule not found')
    enabled = kid_conn.execute(
        "SELECT 1 FROM kid_off_app_chore WHERE rule_id = ?",
        [rule['ruleId']],
    ).fetchone()
    if not enabled:
        raise ValueError('Off-app chore is not enabled for this kid')
    pending = kid_conn.execute(
        "SELECT pending_id FROM pending_off_app_chore WHERE rule_id = ? LIMIT 1",
        [rule['ruleId']],
    ).fetchone()
    if pending:
        raise ValueError('Off-app chore is already pending review')
    if has_point_event_for_rule_today(kid_conn, family_id, rule['ruleId']):
        raise ValueError('Off-app chore already has points today')
    row = kid_conn.execute(
        """
        INSERT INTO pending_off_app_chore (rule_id, submitted_at)
        VALUES (?, ?)
        RETURNING pending_id, rule_id, submitted_at
        """,
        [rule['ruleId'], _utc_now_naive()],
    ).fetchone()
    return _pending_row_to_payload(row, {rule['ruleId']: rule})


def review_pending_off_app_chore(kid_conn, shared_conn, family_id, pending_id, rating=None, *, points_delta=None, note=None):
    pending_row = kid_conn.execute(
        """
        SELECT pending_id, rule_id, submitted_at
        FROM pending_off_app_chore
        WHERE pending_id = ?
        """,
        [int(pending_id or 0)],
    ).fetchone()
    if not pending_row:
        raise KeyError('Pending off-app chore not found')
    rule_id = int(pending_row[1] or 0)
    rule = get_family_rule(shared_conn, family_id, rule_id)
    if not rule or rule['ruleKind'] != RULE_KIND_OFF_APP_CHORE:
        raise ValueError('Off-app chore rule not found')
    points_delta_value = _event_delta_for_rule(rule, points_delta=points_delta)
    kid_conn.execute('BEGIN TRANSACTION')
    try:
        event = insert_point_event(kid_conn, rule_id, points_delta_value, note=note)
        kid_conn.execute(
            "DELETE FROM pending_off_app_chore WHERE pending_id = ?",
            [int(pending_id or 0)],
        )
        kid_conn.execute('COMMIT')
    except Exception:
        kid_conn.execute('ROLLBACK')
        raise
    event['rule'] = rule
    return event


def cancel_pending_off_app_chore(kid_conn, shared_conn, family_id, pending_id):
    pending_row = kid_conn.execute(
        """
        SELECT pending_id, rule_id, submitted_at
        FROM pending_off_app_chore
        WHERE pending_id = ?
        """,
        [int(pending_id or 0)],
    ).fetchone()
    if not pending_row:
        raise KeyError('Pending off-app chore not found')
    rule_id = int(pending_row[1] or 0)
    rule = get_family_rule(shared_conn, family_id, rule_id)
    if not rule or rule['ruleKind'] != RULE_KIND_OFF_APP_CHORE:
        raise ValueError('Off-app chore rule not found')
    if has_point_event_for_rule_today(kid_conn, family_id, rule_id):
        raise ValueError('This task has already been checked by a parent today')
    pending = _pending_row_to_payload(pending_row, {rule_id: rule})
    kid_conn.execute(
        "DELETE FROM pending_off_app_chore WHERE pending_id = ?",
        [int(pending_id or 0)],
    )
    return pending


def list_app_category_strictly_done_sessions_today(kid_conn, family_id, category_key, *, limit=None):
    key = normalize_shared_deck_tag(category_key)
    if not key:
        return []
    day_start_utc, day_end_utc = _family_day_bounds_utc(family_id)
    limit_clause = ''
    params = [
        key,
        day_start_utc,
        day_end_utc,
        SESSION_RESULT_WRONG_UNRESOLVED,
        SESSION_RESULT_PARTIAL,
    ]
    if limit is not None:
        limit_clause = 'LIMIT ?'
        params.append(max(1, int(limit or 1)))
    rows = kid_conn.execute(
        f"""
        SELECT s.id,
               s.completed_at
        FROM sessions s
        LEFT JOIN session_results sr ON sr.session_id = s.id
        WHERE s.type = ?
          AND s.completed_at IS NOT NULL
          AND s.completed_at >= ?
          AND s.completed_at < ?
        GROUP BY s.id, s.planned_count, s.completed_at
        HAVING COUNT(sr.id) > 0
           AND (
             COALESCE(s.planned_count, 0) <= 0
             OR COUNT(sr.id) >= COALESCE(s.planned_count, 0)
           )
           AND SUM(CASE WHEN sr.correct = ? OR sr.correct = ? THEN 1 ELSE 0 END) = 0
        ORDER BY s.completed_at ASC, s.id ASC
        {limit_clause}
        """,
        params,
    ).fetchall()
    return [
        {
            'sessionId': int(row[0] or 0),
            'completedAt': row[1],
        }
        for row in rows
        if row and int(row[0] or 0) > 0 and row[1] is not None
    ]


def pull_in_app_chore_events_for_today(kid_conn, shared_conn, family_id, *, trigger_keys=None):
    rules = list_family_rules(
        shared_conn,
        family_id,
        rule_kind=RULE_KIND_IN_APP_CHORE,
        include_inactive=False,
    )
    allowed_keys = None
    if trigger_keys is not None:
        allowed_keys = {
            normalize_shared_deck_tag(key)
            for key in trigger_keys
            if normalize_shared_deck_tag(key)
        }
    awarded = []
    skipped_count = 0
    kid_conn.execute('BEGIN TRANSACTION')
    try:
        for rule in rules:
            if rule.get('maxPoint') is None:
                continue
            if allowed_keys is not None and normalize_shared_deck_tag(rule.get('triggerKey')) not in allowed_keys:
                continue
            points_delta = _event_delta_for_rule(rule)
            sessions = list_app_category_strictly_done_sessions_today(
                kid_conn,
                family_id,
                rule.get('triggerKey'),
            )
            for session in sessions:
                completed_at = session.get('completedAt')
                if has_point_event_for_rule_at_timestamp(kid_conn, rule['ruleId'], completed_at):
                    skipped_count += 1
                    continue
                event = insert_point_event(
                    kid_conn,
                    rule['ruleId'],
                    points_delta,
                    created_at=completed_at,
                )
                event['rule'] = rule
                event['sessionId'] = session['sessionId']
                awarded.append(event)
        kid_conn.execute('COMMIT')
    except Exception:
        kid_conn.execute('ROLLBACK')
        raise
    return {
        'awarded': awarded,
        'awardedCount': len(awarded),
        'skippedCount': skipped_count,
    }


def delete_in_app_chore_events_for_session(kid_conn, shared_conn, family_id, session_type, completed_at):
    """Remove in-app-chore point_events auto-awarded for one deleted session.

    Auto-awarded events have no session FK; they are matched the same way the
    award pairs them — an in-app-chore rule whose trigger is the session's
    category, with created_at equal to the session's completed_at. Returns the
    number of point_events removed.
    """
    if completed_at is None:
        return 0
    key = normalize_shared_deck_tag(session_type)
    if not key:
        return 0
    rules = list_family_rules(
        shared_conn,
        family_id,
        rule_kind=RULE_KIND_IN_APP_CHORE,
        include_inactive=True,
    )
    rule_ids = [
        int(rule['ruleId'])
        for rule in rules
        if rule.get('ruleId') is not None
        and normalize_shared_deck_tag(rule.get('triggerKey')) == key
    ]
    if not rule_ids:
        return 0
    placeholders = ', '.join(['?'] * len(rule_ids))
    rows = kid_conn.execute(
        f"""
        DELETE FROM point_event
        WHERE created_at = ? AND rule_id IN ({placeholders})
        RETURNING event_id
        """,
        [completed_at, *rule_ids],
    ).fetchall()
    return len(rows)
