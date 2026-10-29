"""Type-IV (math generator) session planning + payload helpers.

Pure helpers that:
  - Build multiple-choice option lists for one generator item.
  - Map pending items to kid-facing response cards.
  - Run generator code to produce pending items for opted-in sources.
  - Allocate per-source question counts (initial + continue/retry).
  - Read unresolved generator retry rows from the per-kid DB.

No module state. The retry-rows helper takes a kid `conn`; everything else is
pure.

Layout:
  1. Choice options + pending-item → response card
  2. Generator pending-item build for opted-in sources
  3. Count distribution + initial/continue allocation
  4. Retry source result rows (per-kid DB read)
"""
import random
import time

from src.routes.kids_constants import (
    SESSION_RESULT_PARTIAL,
    SESSION_RESULT_WRONG_UNRESOLVED,
    TYPE_IV_PRACTICE_MODE_MULTI,
)
from src.services.normalize_inputs import normalize_positive_int_list
from src.services.practice_mode import normalize_type_iv_practice_mode
from src.services.session_grading import normalize_type_iv_submitted_answer
from src.type4_generator_preview import run_type4_generator


# =====================================================================
# === 1. Choice options + pending-item → response card
# =====================================================================

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


# =====================================================================
# === 2. Generator pending-item build for opted-in sources
# =====================================================================

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
        current_seed_base = next_seed_base
        next_seed_base += sample_count + 97
        generator_code = str(source.get('generator_code') or '')
        for sample_index, sample in enumerate(samples):
            sample_seed = current_seed_base + sample_index
            pending_item = {
                'id': next_pending_id,
                'representative_card_id': int(source.get('representative_card_id') or 0),
                'deck_id': local_deck_id,
                'prompt': str(sample.get('prompt') or ''),
                'answer': str(sample.get('answer') or ''),
                'distractor_answers': [str(item) for item in list(sample.get('distractors') or [])],
                'is_multichoice_only': bool(source.get('is_multichoice_only')),
                'has_validate': bool(sample.get('validate') is not None),
            }
            if sample.get('validate') is not None:
                pending_item['validate'] = sample['validate']
                pending_item['validate_seed'] = int(sample_seed)
                pending_item['validate_generator_code'] = generator_code
            pending_items.append(pending_item)
            response_cards.append(
                map_type_iv_pending_item_to_response_card(pending_item, practice_mode)
            )
            next_pending_id += 1

    return pending_items, response_cards


# =====================================================================
# === 3. Count distribution + initial/continue allocation
# =====================================================================

def distribute_type_iv_count_across_sources(practice_sources, target_count):
    """Split the subject total evenly; assign the remainder to the last cards."""
    source_keys = list(dict.fromkeys(
        int(source.get('source_key') or source.get('representative_card_id') or 0)
        for source in list(practice_sources or [])
        if int(source.get('local_deck_id') or 0) > 0
        and int(source.get('source_key') or source.get('representative_card_id') or 0) > 0
    ))
    total = max(0, int(target_count or 0))
    if not source_keys or total == 0:
        return {}
    base, remainder = divmod(total, len(source_keys))
    return {
        key: count
        for index, key in enumerate(source_keys)
        if (count := base + int(remainder > 0 and index >= len(source_keys) - remainder)) > 0
    }


# =====================================================================
# === 4. Retry source result rows (per-kid DB read)
# =====================================================================

def get_type_iv_retry_source_result_rows(conn, source_session_id, allowed_representative_card_ids):
    """Return unresolved generator retry rows for one source session."""
    normalized_card_ids = normalize_positive_int_list(allowed_representative_card_ids)
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
