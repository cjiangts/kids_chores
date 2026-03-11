"""Reward admin helpers for family-level tracking start and reset."""
from __future__ import annotations

import os
from typing import Dict, Tuple

from src.badges import DAY_ONE_BADGE_ACHIEVEMENTS
from src.db import kid_db, metadata


def _family_timezone_info(family_id: str) -> str:
    return metadata.get_family_timezone(str(family_id or ''))


def build_reward_tracking_status(
    family_id: str,
) -> Dict[str, object]:
    family_id = str(family_id or '').strip()
    family_timezone = _family_timezone_info(family_id)
    started_at = metadata.get_family_badge_tracking_started_at(family_id)
    status = {
        'started': bool(started_at),
        'startedAt': started_at or None,
        'familyTimezone': family_timezone,
    }
    return status


def clear_family_kid_badge_awards(family_id: str) -> Dict[str, int]:
    family_id = str(family_id or '').strip()
    deleted_award_count = 0
    touched_kid_count = 0

    for kid in metadata.get_all_kids(family_id):
        db_file_path = str(kid.get('dbFilePath') or '').strip()
        if not db_file_path:
            continue
        conn = None
        try:
            conn = kid_db.get_kid_connection_by_path(db_file_path)
            touched_kid_count += 1
            row = conn.execute("SELECT COUNT(*) FROM kid_badge_award").fetchone()
            deleted_award_count += int(row[0] or 0) if row else 0
            conn.execute("DELETE FROM kid_badge_award")
        except Exception:
            continue
        finally:
            if conn is not None:
                conn.close()

    return {
        'deletedAwardCount': deleted_award_count,
        'touchedKidCount': touched_kid_count,
    }


def _normalize_category_key(value) -> str:
    return str(value or '').strip().lower()


def _label_from_image_path(image_path: str) -> str:
    base_name = os.path.basename(str(image_path or '').strip())
    stem, _ = os.path.splitext(base_name)
    if stem.startswith('noto-'):
        stem = stem[5:]
    words = [part for part in stem.replace('_', '-').split('-') if part]
    if not words:
        return 'Badge Art'
    return ' '.join(word.capitalize() for word in words)


def list_noto_badge_art_catalog(shared_conn):
    rows = shared_conn.execute(
        """
        SELECT badge_art_id, image_path, source_url, license
        FROM badge_art
        WHERE COALESCE(is_active, TRUE) = TRUE
          AND image_path LIKE 'assets/badges-noto/noto-%.png'
        ORDER BY image_path ASC, badge_art_id ASC
        """
    ).fetchall()

    items = []
    for row in rows:
        image_path = str(row[1] or '').strip()
        label = _label_from_image_path(image_path)
        items.append({
            'badgeArtId': int(row[0] or 0),
            'imagePath': image_path,
            'imageUrl': f"/{image_path.lstrip('/')}" if image_path else '',
            'label': label,
            'searchText': f"{label} {image_path}".strip().lower(),
            'sourceUrl': str(row[2] or '').strip(),
            'license': str(row[3] or '').strip(),
        })
    return items


def list_badge_art_assignments(shared_conn):
    mapping_rows = shared_conn.execute(
        """
        SELECT
            aba.achievement_key,
            COALESCE(aba.category_key, ''),
            aba.badge_art_id,
            ba.image_path,
            ba.source_url,
            ba.license
        FROM achievement_badge_art aba
        LEFT JOIN badge_art ba ON ba.badge_art_id = aba.badge_art_id
        """
    ).fetchall()

    mapping_by_key = {}
    for row in mapping_rows:
        achievement_key = str(row[0] or '').strip()
        category_key = _normalize_category_key(row[1])
        if not achievement_key:
            continue
        image_path = str(row[3] or '').strip()
        mapping_by_key[(achievement_key, category_key)] = {
            'badgeArtId': int(row[2] or 0),
            'imagePath': image_path,
            'imageUrl': f"/{image_path.lstrip('/')}" if image_path else '',
            'label': _label_from_image_path(image_path),
            'sourceUrl': str(row[4] or '').strip(),
            'license': str(row[5] or '').strip(),
        }

    achievements = []
    for definition in DAY_ONE_BADGE_ACHIEVEMENTS:
        key = (
            str(definition.achievement_key or '').strip(),
            _normalize_category_key(definition.category_key),
        )
        current_art = mapping_by_key.get(key, {
            'badgeArtId': 0,
            'imagePath': '',
            'imageUrl': '',
            'label': '',
            'sourceUrl': '',
            'license': '',
        })
        achievements.append({
            'achievementKey': key[0],
            'categoryKey': key[1],
            'title': str(definition.title or '').strip(),
            'themeKey': str(definition.theme_key or '').strip(),
            'thresholdValue': int(definition.threshold_value or 0),
            'goalText': str(definition.goal_text or '').strip(),
            'reasonText': str(definition.reason_text or '').strip(),
            'currentBadgeArtId': int(current_art.get('badgeArtId') or 0),
            'currentImagePath': str(current_art.get('imagePath') or ''),
            'currentImageUrl': str(current_art.get('imageUrl') or ''),
            'currentImageLabel': str(current_art.get('label') or ''),
            'currentBadgeSourceUrl': str(current_art.get('sourceUrl') or ''),
            'currentBadgeLicense': str(current_art.get('license') or ''),
        })
    return achievements


def build_super_family_badge_art_payload(shared_conn):
    return {
        'achievements': list_badge_art_assignments(shared_conn),
        'artCatalog': list_noto_badge_art_catalog(shared_conn),
    }


def _valid_badge_definition_keys():
    return {
        (
            str(definition.achievement_key or '').strip(),
            _normalize_category_key(definition.category_key),
        )
        for definition in DAY_ONE_BADGE_ACHIEVEMENTS
    }


def _normalize_badge_assignment_target(achievement_key: str, category_key: str) -> Tuple[str, str]:
    normalized_achievement_key = str(achievement_key or '').strip()
    normalized_category_key = _normalize_category_key(category_key)
    if (normalized_achievement_key, normalized_category_key) not in _valid_badge_definition_keys():
        raise ValueError('Unknown achievement mapping target')
    return normalized_achievement_key, normalized_category_key


def _normalize_active_noto_badge_art_id(shared_conn, badge_art_id: int) -> int:
    try:
        normalized_badge_art_id = int(badge_art_id)
    except Exception as exc:
        raise ValueError('badgeArtId must be an integer') from exc

    row = shared_conn.execute(
        """
        SELECT badge_art_id
        FROM badge_art
        WHERE badge_art_id = ?
          AND COALESCE(is_active, TRUE) = TRUE
          AND image_path LIKE 'assets/badges-noto/noto-%.png'
        LIMIT 1
        """,
        [normalized_badge_art_id],
    ).fetchone()
    if row is None:
        raise ValueError('badgeArtId must point to an active Noto badge image')
    return normalized_badge_art_id


def replace_badge_art_assignments(shared_conn, assignments):
    normalized_rows = []
    seen_targets = set()
    seen_badge_art_ids = {}

    for raw_item in assignments:
        if not isinstance(raw_item, dict):
            raise ValueError('Each assignment must be an object')
        normalized_achievement_key, normalized_category_key = _normalize_badge_assignment_target(
            raw_item.get('achievementKey'),
            raw_item.get('categoryKey'),
        )
        normalized_badge_art_id = _normalize_active_noto_badge_art_id(
            shared_conn,
            raw_item.get('badgeArtId'),
        )
        target_key = (normalized_achievement_key, normalized_category_key)
        if target_key in seen_targets:
            raise ValueError('Duplicate achievement mapping in save payload')
        if normalized_badge_art_id in seen_badge_art_ids:
            previous_target = seen_badge_art_ids[normalized_badge_art_id]
            raise ValueError(
                f'Badge art {normalized_badge_art_id} is assigned more than once: '
                f'{previous_target[0]} and {normalized_achievement_key}'
            )
        seen_targets.add(target_key)
        seen_badge_art_ids[normalized_badge_art_id] = target_key
        normalized_rows.append((normalized_achievement_key, normalized_category_key, normalized_badge_art_id))

    try:
        shared_conn.execute("BEGIN TRANSACTION")
        shared_conn.execute("DELETE FROM achievement_badge_art")
        for normalized_achievement_key, normalized_category_key, normalized_badge_art_id in normalized_rows:
            shared_conn.execute(
                """
                INSERT INTO achievement_badge_art (achievement_key, category_key, badge_art_id)
                VALUES (?, ?, ?)
                """,
                [normalized_achievement_key, normalized_category_key, normalized_badge_art_id],
            )
        shared_conn.execute("COMMIT")
    except Exception:
        try:
            shared_conn.execute("ROLLBACK")
        except Exception:
            pass
        raise

    return {
        'savedAssignmentCount': len(normalized_rows),
    }
