"""Type-IV (math generator) session planning + payload helpers.

Pure helpers that:
  - Build multiple-choice option lists for one generator item.
  - Map pending items to kid-facing response cards.
  - Run generator code to produce pending items for opted-in sources.
  - Allocate per-source question counts (initial + continue/retry).
  - Read unresolved generator retry rows from the per-kid DB.

No module state. The retry-rows helper takes a kid `conn`; everything else is
pure.
"""
import math
import random
import time

from src.routes.kids_constants import (
    SESSION_RESULT_PARTIAL,
    SESSION_RESULT_WRONG_UNRESOLVED,
    TYPE_IV_PRACTICE_MODE_MULTI,
)
from src.services.practice_mode import normalize_type_iv_practice_mode
from src.services.session_grading import normalize_type_iv_submitted_answer
from src.type4_generator_preview import run_type4_generator


def build_type_iv_choice_options(answer, distractor_answers, seed):
    """Return one shuffled multiple-choice option list for a generator item."""
    correct_answer = normalize_type_iv_submitted_answer(answer)
    seen = set()
    options = []
    for text in [correct_answer, *list(distractor_answers or [])]:
        normalized = normalize_type_iv_submitted_answer(text)
        if not normalized or normalized in seen:
            continue
        seen.add(normalized)
        options.append(normalized)
    rng = random.Random(int(seed or 0))
    rng.shuffle(options)
    return options


def map_type_iv_pending_item_to_response_card(item, practice_mode):
    """Map one pending generator item to the kid-facing practice payload."""
    is_multichoice_only = bool(item.get('is_multichoice_only'))
    use_multi_choice = (
        is_multichoice_only
        or normalize_type_iv_practice_mode(practice_mode) == TYPE_IV_PRACTICE_MODE_MULTI
    )
    response_card = {
        'id': int(item.get('id') or 0),
        'front': str(item.get('prompt') or ''),
        'isMultichoiceOnly': bool(is_multichoice_only),
    }
    previous_answers = item.get('previous_answers')
    if previous_answers:
        response_card['previousAnswers'] = list(previous_answers)
    previous_grades = item.get('previous_grades')
    if previous_grades:
        response_card['previousGrades'] = list(previous_grades)
    if use_multi_choice:
        response_card['choices'] = build_type_iv_choice_options(
            item.get('answer'),
            item.get('distractor_answers') or [],
            seed=int(item.get('id') or 0),
        )
    return response_card


def build_type_iv_pending_items_for_sources(
    practice_sources,
    count_by_source_key,
    practice_mode,
    *,
    pending_id_start=1,
    seed_base=None,
):
    """Generate pending in-memory practice items from configured generator decks."""
    pending_items = []
    response_cards = []
    next_pending_id = max(1, int(pending_id_start or 1))
    try:
        next_seed_base = int(seed_base)
    except (TypeError, ValueError):
        next_seed_base = int(time.time_ns() % 2_000_000_000)

    for source in list(practice_sources or []):
        local_deck_id = int(source.get('local_deck_id') or 0)
        source_key = int(source.get('source_key') or source.get('representative_card_id') or 0)
        sample_count = max(0, int((count_by_source_key or {}).get(source_key, 0) or 0))
        if local_deck_id <= 0 or sample_count <= 0:
            continue
        samples = run_type4_generator(
            source.get('generator_code'),
            sample_count=sample_count,
            seed_base=next_seed_base,
        )
        next_seed_base += sample_count + 97
        for sample in samples:
            pending_item = {
                'id': next_pending_id,
                'representative_card_id': int(source.get('representative_card_id') or 0),
                'deck_id': local_deck_id,
                'prompt': str(sample.get('prompt') or ''),
                'answer': str(sample.get('answer') or ''),
                'distractor_answers': [str(item) for item in list(sample.get('distractors') or [])],
                'is_multichoice_only': bool(source.get('is_multichoice_only')),
            }
            if sample.get('validate') is not None:
                pending_item['validate'] = sample['validate']
            pending_items.append(pending_item)
            response_cards.append(
                map_type_iv_pending_item_to_response_card(pending_item, practice_mode)
            )
            next_pending_id += 1

    return pending_items, response_cards


def distribute_type_iv_random_count_across_sources(source_keys, total_count, rng):
    """Spread one generator count randomly across source keys with minimal repetition."""
    normalized_keys = []
    seen = set()
    for raw_key in list(source_keys or []):
        try:
            key = int(raw_key)
        except (TypeError, ValueError):
            continue
        if key <= 0 or key in seen:
            continue
        seen.add(key)
        normalized_keys.append(key)
    if total_count <= 0 or not normalized_keys:
        return {}

    allocations = {key: 0 for key in normalized_keys}
    shuffled_keys = list(normalized_keys)
    rng.shuffle(shuffled_keys)
    full_cycles, remainder = divmod(int(total_count), len(shuffled_keys))
    if full_cycles > 0:
        for key in shuffled_keys:
            allocations[key] += full_cycles
    if remainder > 0:
        rng.shuffle(shuffled_keys)
        for key in shuffled_keys[:remainder]:
            allocations[key] += 1
    return {
        int(key): int(count)
        for key, count in allocations.items()
        if int(count or 0) > 0
    }


def build_type_iv_initial_count_by_source_key(practice_sources):
    """Build one configured per-source count map for a fresh generator session."""
    allocations = {}
    orphan_source_keys_by_deck_id = {}
    orphan_daily_target_by_deck_id = {}

    for source in list(practice_sources or []):
        local_deck_id = int(source.get('local_deck_id') or 0)
        source_key = int(source.get('source_key') or source.get('representative_card_id') or 0)
        daily_target_count = max(0, int(source.get('daily_target_count') or 0))
        if local_deck_id <= 0 or source_key <= 0 or daily_target_count <= 0:
            continue
        if bool(source.get('is_orphan')):
            orphan_source_keys_by_deck_id.setdefault(local_deck_id, []).append(source_key)
            orphan_daily_target_by_deck_id[local_deck_id] = daily_target_count
            continue
        allocations[source_key] = daily_target_count

    rng = random.Random(int(time.time_ns() % 2_000_000_000))
    for local_deck_id, source_keys in orphan_source_keys_by_deck_id.items():
        orphan_allocations = distribute_type_iv_random_count_across_sources(
            source_keys,
            int(orphan_daily_target_by_deck_id.get(local_deck_id) or 0),
            rng,
        )
        for source_key, count in orphan_allocations.items():
            allocations[int(source_key)] = int(count)

    return allocations


def build_type_iv_continue_count_by_source_key(practice_sources, target_count):
    """Redistribute unfinished generator questions across current generator sources."""
    remaining_count = max(0, int(target_count or 0))
    if remaining_count <= 0:
        return {}

    grouped_entries_by_key = {}
    for source in list(practice_sources or []):
        local_deck_id = int(source.get('local_deck_id') or 0)
        source_key = int(source.get('source_key') or source.get('representative_card_id') or 0)
        if local_deck_id <= 0 or source_key <= 0:
            continue
        is_orphan = bool(source.get('is_orphan'))
        group_key = f"orphan_{local_deck_id}" if is_orphan else f"source_{source_key}"
        entry = grouped_entries_by_key.get(group_key)
        if entry is None:
            entry = {
                'group_key': group_key,
                'weight': max(0, int(source.get('daily_target_count') or 0)),
                'source_keys': [],
                'is_orphan': is_orphan,
            }
            grouped_entries_by_key[group_key] = entry
        entry['weight'] = max(entry['weight'], max(0, int(source.get('daily_target_count') or 0)))
        entry['source_keys'].append(source_key)

    all_entries = [
        entry for entry in grouped_entries_by_key.values()
        if list(entry.get('source_keys') or [])
    ]
    if not all_entries:
        return {}

    weighted_entries = [
        entry for entry in all_entries
        if int(entry.get('weight') or 0) > 0
    ]
    if not weighted_entries:
        weighted_entries = list(all_entries)

    source_entries = [{
        'group_key': str(entry.get('group_key') or ''),
        'weight': max(1, int(entry.get('weight') or 0)),
        'source_keys': [int(key) for key in list(entry.get('source_keys') or []) if int(key) > 0],
        'is_orphan': bool(entry.get('is_orphan')),
    } for entry in weighted_entries]
    if not source_entries:
        return {}

    total_weight = sum(entry['weight'] for entry in source_entries)
    allocations = {entry['group_key']: 0 for entry in source_entries}
    fractional_entries = []
    allocated_count = 0
    for entry in source_entries:
        exact_share = (remaining_count * entry['weight']) / float(max(1, total_weight))
        base_share = int(math.floor(exact_share))
        allocations[entry['group_key']] = base_share
        allocated_count += base_share
        fractional_entries.append({
            'group_key': entry['group_key'],
            'weight': entry['weight'],
            'fractional': exact_share - float(base_share),
        })

    remainder = max(0, remaining_count - allocated_count)
    fractional_entries.sort(
        key=lambda entry: (-entry['fractional'], -entry['weight'], entry['group_key'])
    )
    while remainder > 0 and fractional_entries:
        for entry in fractional_entries:
            allocations[entry['group_key']] += 1
            remainder -= 1
            if remainder <= 0:
                break

    rng = random.Random(int(time.time_ns() % 2_000_000_000))
    expanded_allocations = {}
    for entry in source_entries:
        allocated = int(allocations.get(entry['group_key']) or 0)
        if allocated <= 0:
            continue
        if bool(entry.get('is_orphan')):
            orphan_allocations = distribute_type_iv_random_count_across_sources(
                entry.get('source_keys') or [],
                allocated,
                rng,
            )
            for source_key, count in orphan_allocations.items():
                expanded_allocations[int(source_key)] = int(count)
            continue
        first_source_key = int((entry.get('source_keys') or [0])[0] or 0)
        if first_source_key > 0:
            expanded_allocations[first_source_key] = allocated

    return expanded_allocations


def get_type_iv_retry_source_result_rows(conn, source_session_id, allowed_representative_card_ids):
    """Return unresolved generator retry rows for one source session."""
    normalized_card_ids = []
    seen = set()
    for raw_card_id in list(allowed_representative_card_ids or []):
        try:
            card_id = int(raw_card_id)
        except (TypeError, ValueError):
            continue
        if card_id <= 0 or card_id in seen:
            continue
        seen.add(card_id)
        normalized_card_ids.append(card_id)
    if not normalized_card_ids:
        return []

    placeholders = ','.join(['?'] * len(normalized_card_ids))
    rows = conn.execute(
        f"""
        SELECT
            sr.id,
            sr.card_id,
            t4.prompt,
            t4.answer,
            t4.distractor_answers,
            t4.submitted_answers,
            t4.submitted_grades
        FROM session_results sr
        JOIN type4_result_item t4 ON t4.result_id = sr.id
        WHERE sr.session_id = ?
          AND sr.correct IN (?, ?)
          AND sr.card_id IN ({placeholders})
        ORDER BY sr.timestamp ASC, sr.id ASC
        """,
        [int(source_session_id), SESSION_RESULT_WRONG_UNRESOLVED, SESSION_RESULT_PARTIAL, *normalized_card_ids],
    ).fetchall()

    result_rows = []
    for row in rows:
        result_id = int(row[0] or 0)
        representative_card_id = int(row[1] or 0)
        prompt = str(row[2] or '').strip()
        answer = str(row[3] or '').strip()
        if result_id <= 0 or representative_card_id <= 0 or not prompt or not answer:
            continue
        result_rows.append({
            'result_id': result_id,
            'representative_card_id': representative_card_id,
            'prompt': prompt,
            'answer': answer,
            'distractor_answers': [str(item) for item in list(row[4] or []) if str(item or '').strip()],
            'submitted_answers': [str(item) for item in list(row[5] or [])],
            'submitted_grades': [int(g) for g in list(row[6] or [])],
        })
    return result_rows
