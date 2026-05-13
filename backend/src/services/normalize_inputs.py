"""Tiny, reusable normalizers for caller-supplied collections.

Helpers used across services + routes to turn loosely-typed iterables into
clean, ordered, deduped Python lists. Reject invalid entries silently — the
caller's contract is "best-effort", not "validate-and-raise".

Layout:
  1. Positive-int list normalizer (ids, keys)
  2. Lowercase-string list normalizer (tags, statuses)
"""


# =====================================================================
# === 1. Positive-int list normalizer (ids, keys)
# =====================================================================

def normalize_positive_int_list(values):
    """Return values coerced to positive ints, in input order, deduplicated.

    Drops non-int, non-positive, and duplicate entries. Used to normalize
    caller-supplied deck_ids / card_ids / source_keys.
    """
    normalized = []
    seen = set()
    for raw in list(values or []):
        try:
            number = int(raw)
        except (TypeError, ValueError):
            continue
        if number <= 0 or number in seen:
            continue
        seen.add(number)
        normalized.append(number)
    return normalized


# =====================================================================
# === 2. Lowercase-string list normalizer (tags, statuses)
# =====================================================================

def normalize_lowercase_string_list(values):
    """Return non-empty trimmed-lowercase strings, in input order, deduplicated."""
    normalized = []
    seen = set()
    for raw in list(values or []):
        text = str(raw or '').strip().lower()
        if not text or text in seen:
            continue
        seen.add(text)
        normalized.append(text)
    return normalized
