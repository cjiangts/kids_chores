"""Type-I and type-IV answer grading + result-row recording.

Pure functions for normalizing/grading submitted answers, plus DB helpers that
write to the per-kid `type1_result_item` / `type4_result_item` sidecar tables.
DB helpers take an open kid `conn` — no module-level state.

Layout:
  1. Answer normalizers + prompt-audio detection + Type-I/IV grade encoding
  2. Initial result-item inserts (per-card grade row)
  3. Submitted-answer appenders (append to existing result row)
"""
from src.routes.kids_constants import (
    SESSION_RESULT_CORRECT,
    SESSION_RESULT_PARTIAL,
    SESSION_RESULT_WRONG_UNRESOLVED,
    TYPE_I_RESULT_GRADE_IDK,
    TYPE_I_RESULT_GRADE_IDK_AUDIO,
)


# =====================================================================
# === 1. Answer normalizers + prompt-audio detection + Type-I/IV grade encoding
# =====================================================================

def normalize_type_iv_submitted_answer(raw_value):
    """Normalize one submitted generator answer for exact-string grading."""
    if raw_value is None:
        return ''
    return str(raw_value).strip()


def normalize_type_i_submitted_answer(raw_value):
    """Normalize one submitted type-I multiple-choice answer."""
    if raw_value is None:
        return ''
    return str(raw_value).strip()


def normalize_type_i_distractor_answers(raw_values):
    """Normalize one list of type-I multiple-choice distractor answers."""
    normalized = []
    seen = set()
    for raw_value in list(raw_values or []):
        text = normalize_type_i_submitted_answer(raw_value)
        if not text or text in seen:
            continue
        seen.add(text)
        normalized.append(text)
    return normalized


def did_use_type_i_prompt_audio(answer):
    """Return whether one type-I answer used the prompt-audio assist button."""
    if not isinstance(answer, dict):
        return False
    return answer.get('usedPromptAudio') is True


def encode_type1_submitted_grade(grade, *, used_prompt_audio=False):
    """Encode one type-I logged grade, overloading audio-assist usage into the value.

    Values:
      1  -> right, no prompt audio used
     -1  -> wrong, no prompt audio used
      3  -> right, prompt audio used
     -3  -> wrong, prompt audio used
    """
    normalized_grade = SESSION_RESULT_CORRECT if int(grade or 0) > 0 else SESSION_RESULT_WRONG_UNRESOLVED
    if not used_prompt_audio:
        return normalized_grade
    return 3 if normalized_grade > 0 else -3


def build_type1_result_item_payload(answer, grade):
    """Build one optional type-I sidecar payload from a submitted answer."""
    used_prompt_audio = did_use_type_i_prompt_audio(answer)
    if answer.get('idk') is True:
        return {
            'submitted_answer': '',
            'distractor_answers': normalize_type_i_distractor_answers(
                answer.get('distractorAnswers')
            ),
            'grade': TYPE_I_RESULT_GRADE_IDK_AUDIO if used_prompt_audio else TYPE_I_RESULT_GRADE_IDK,
        }
    submitted_answer = normalize_type_i_submitted_answer(answer.get('submittedAnswer'))
    if not submitted_answer:
        return None
    return {
        'submitted_answer': submitted_answer,
        'distractor_answers': normalize_type_i_distractor_answers(
            answer.get('distractorAnswers')
        ),
        'grade': encode_type1_submitted_grade(
            grade,
            used_prompt_audio=used_prompt_audio,
        ),
    }


def grade_type_iv_answer(submitted_answer, expected_answer, validate_fn=None):
    """Grade a type IV answer, returning SESSION_RESULT_CORRECT / PARTIAL / WRONG.

    If a custom validate function is provided, it is called with (submitted, expected).
    Return values: 1 or True = correct, 2 = partial, 0 or False = wrong.
    Falls back to exact string comparison if no validate function.
    """
    if validate_fn is not None:
        try:
            result = validate_fn(submitted_answer, expected_answer)
        except Exception:
            return SESSION_RESULT_WRONG_UNRESOLVED
        if result == 2:
            return SESSION_RESULT_PARTIAL
        if result == 1 or result is True:
            return SESSION_RESULT_CORRECT
        return SESSION_RESULT_WRONG_UNRESOLVED
    if submitted_answer == expected_answer:
        return SESSION_RESULT_CORRECT
    return SESSION_RESULT_WRONG_UNRESOLVED


# =====================================================================
# === 2. Initial result-item inserts (per-card grade row)
# =====================================================================

def insert_type4_result_item(conn, result_id, pending_item, submitted_answer, grade):
    """Insert one generator sidecar row for a saved session result."""
    conn.execute(
        """
        INSERT INTO type4_result_item (result_id, prompt, answer, distractor_answers, submitted_answers, submitted_grades)
        VALUES (?, ?, ?, ?, ?, ?)
        """,
        [
            int(result_id),
            str(pending_item.get('prompt') or ''),
            str(pending_item.get('answer') or ''),
            [str(item) for item in list(pending_item.get('distractor_answers') or [])],
            [normalize_type_iv_submitted_answer(submitted_answer)],
            [int(grade)],
        ],
    )


def insert_type1_result_item(conn, result_id, answer, grade):
    """Insert one optional type-I multiple-choice sidecar row."""
    payload = build_type1_result_item_payload(answer, grade)
    if payload is None:
        return False
    conn.execute(
        """
        INSERT INTO type1_result_item (result_id, distractor_answers, submitted_answers, submitted_grades)
        VALUES (?, ?, ?, ?)
        """,
        [
            int(result_id),
            list(payload['distractor_answers']),
            [payload['submitted_answer']],
            [int(payload['grade'])],
        ],
    )
    return True


# =====================================================================
# === 3. Submitted-answer appenders (append to existing result row)
# =====================================================================

def append_type4_result_submitted_answer(conn, result_id, submitted_answer, grade):
    """Append one submitted answer to an existing generator result sidecar row."""
    row = conn.execute(
        """
        SELECT submitted_answers, submitted_grades
        FROM type4_result_item
        WHERE result_id = ?
        LIMIT 1
        """,
        [int(result_id)],
    ).fetchone()
    if row is None:
        raise ValueError('Generator result details not found')

    submitted_answers = [str(item) for item in list(row[0] or [])]
    submitted_answers.append(normalize_type_iv_submitted_answer(submitted_answer))
    submitted_grades = [int(g) for g in list(row[1] or [])]
    submitted_grades.append(int(grade))
    conn.execute(
        """
        UPDATE type4_result_item
        SET submitted_answers = ?, submitted_grades = ?
        WHERE result_id = ?
        """,
        [submitted_answers, submitted_grades, int(result_id)],
    )


def append_type1_result_submitted_answer(conn, result_id, answer, grade):
    """Append one submitted type-I answer to an existing sidecar row, creating it if needed."""
    payload = build_type1_result_item_payload(answer, grade)
    if payload is None:
        return False

    row = conn.execute(
        """
        SELECT distractor_answers, submitted_answers, submitted_grades
        FROM type1_result_item
        WHERE result_id = ?
        LIMIT 1
        """,
        [int(result_id)],
    ).fetchone()
    if row is None:
        return insert_type1_result_item(conn, result_id, answer, grade)

    distractor_answers = [
        str(item).strip()
        for item in list(row[0] or [])
        if str(item or '').strip()
    ]
    submitted_answers = [str(item) for item in list(row[1] or [])]
    submitted_answers.append(payload['submitted_answer'])
    submitted_grades = [int(g) for g in list(row[2] or [])]
    submitted_grades.append(int(payload['grade']))
    conn.execute(
        """
        UPDATE type1_result_item
        SET distractor_answers = ?, submitted_answers = ?, submitted_grades = ?
        WHERE result_id = ?
        """,
        [
            distractor_answers or list(payload['distractor_answers']),
            submitted_answers,
            submitted_grades,
            int(result_id),
        ],
    )
    return True
