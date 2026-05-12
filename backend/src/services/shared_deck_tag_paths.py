"""Shared-deck tag-path helpers: list, normalize, format, prefix-conflict.

Pure helpers around the `deck.tags` JSON column of `shared_decks.db`. DB helpers
take an open shared-decks `conn`. No module state.
"""
from src.services.shared_deck_normalize import (
    extract_shared_deck_tags_and_labels,
    normalize_shared_deck_tag,
)


def get_all_shared_deck_tag_paths(conn):
    """Return globally unique ordered shared-deck tag paths."""
    rows = conn.execute("SELECT tags FROM deck").fetchall()
    seen_paths = set()
    ordered_paths = []
    for row in rows:
        path, _ = extract_shared_deck_tags_and_labels(row[0])
        if not path:
            continue
        key = tuple(path)
        if key in seen_paths:
            continue
        seen_paths.add(key)
        ordered_paths.append(path)
    ordered_paths.sort(key=lambda items: (items[0], len(items), items))
    return ordered_paths


def get_all_shared_deck_tag_label_paths(conn):
    """Return globally unique ordered shared-deck tag-label paths (with `(comment)` parts)."""
    rows = conn.execute("SELECT tags FROM deck").fetchall()
    seen_paths = set()
    ordered_paths = []
    for row in rows:
        path, labels = extract_shared_deck_tags_and_labels(row[0])
        if not path:
            continue
        key = tuple(path)
        if key in seen_paths:
            continue
        seen_paths.add(key)
        ordered_paths.append(labels)
    ordered_paths.sort(key=lambda items: (items[0], len(items), items))
    return ordered_paths


def normalize_shared_deck_tag_path(tags):
    """Normalize one ordered deck-tag path."""
    normalized = []
    for raw in list(tags or []):
        tag = normalize_shared_deck_tag(raw)
        if not tag:
            continue
        normalized.append(tag)
    return normalized


def find_shared_deck_tag_prefix_conflict(conn, candidate_tags):
    """Return conflicting existing tag path when one path is a strict prefix of the other."""
    candidate = tuple(normalize_shared_deck_tag_path(candidate_tags))
    if not candidate:
        return None

    existing_paths = get_all_shared_deck_tag_paths(conn)
    for raw_path in existing_paths:
        existing = tuple(normalize_shared_deck_tag_path(raw_path))
        if not existing or existing == candidate:
            continue
        common_len = min(len(existing), len(candidate))
        if common_len <= 0:
            continue
        if existing[:common_len] == candidate[:common_len]:
            return list(existing)
    return None


def format_shared_deck_tag_path(tags):
    """Format one tag path for human-readable messages."""
    normalized = normalize_shared_deck_tag_path(tags)
    return '[' + ', '.join(normalized) + ']'
