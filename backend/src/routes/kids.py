"""Kid management API routes"""
from flask import Blueprint, request, jsonify
from datetime import datetime, timedelta
import uuid

from src.db import metadata, kid_db

kids_bp = Blueprint('kids', __name__)

DEFAULT_SESSION_CARD_COUNT = 10
MIN_SESSION_CARD_COUNT = 1
MAX_SESSION_CARD_COUNT = 200


def normalize_session_card_count(kid):
    """Get validated session card count for a kid."""
    value = kid.get('sessionCardCount', DEFAULT_SESSION_CARD_COUNT)
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        return DEFAULT_SESSION_CARD_COUNT

    if parsed < MIN_SESSION_CARD_COUNT:
        return MIN_SESSION_CARD_COUNT
    if parsed > MAX_SESSION_CARD_COUNT:
        return MAX_SESSION_CARD_COUNT
    return parsed


def get_today_completed_session_counts(kid_id):
    """Get number of completed practice sessions for today by type."""
    try:
        conn = kid_db.get_kid_connection(kid_id)
    except Exception:
        return {'total': 0, 'chinese': 0, 'math': 0}

    try:
        day_start = datetime.now().replace(hour=0, minute=0, second=0, microsecond=0)
        day_end = day_start + timedelta(days=1)

        rows = conn.execute(
            """
            SELECT type, COUNT(*)
            FROM sessions
            WHERE completed_at IS NOT NULL
              AND completed_at >= ?
              AND completed_at < ?
              AND type IN ('flashcard', 'math')
            GROUP BY type
            """
            ,
            [day_start, day_end]
        ).fetchall()

        chinese = 0
        math = 0
        for row in rows:
            session_type = row[0]
            count = int(row[1] or 0)
            if session_type == 'flashcard':
                chinese = count
            elif session_type == 'math':
                math = count

        return {'total': chinese + math, 'chinese': chinese, 'math': math}
    except Exception:
        return {'total': 0, 'chinese': 0, 'math': 0}
    finally:
        conn.close()


@kids_bp.route('/kids', methods=['GET'])
def get_kids():
    """Get all kids"""
    try:
        kids = metadata.get_all_kids()

        kids_with_progress = []
        for kid in kids:
            if 'dailyPracticeChineseEnabled' not in kid:
                if 'dailyPracticeEnabled' in kid:
                    kid = {**kid, 'dailyPracticeChineseEnabled': bool(kid.get('dailyPracticeEnabled'))}
                else:
                    kid = {**kid, 'dailyPracticeChineseEnabled': True}

            if 'dailyPracticeMathEnabled' not in kid:
                kid = {**kid, 'dailyPracticeMathEnabled': False}

            today_counts = get_today_completed_session_counts(kid['id'])
            kid_with_progress = {
                **kid,
                'dailyCompletedCountToday': today_counts['total'],
                'dailyCompletedChineseCountToday': today_counts['chinese'],
                'dailyCompletedMathCountToday': today_counts['math']
            }
            kids_with_progress.append(kid_with_progress)

        return jsonify(kids_with_progress), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@kids_bp.route('/kids', methods=['POST'])
def create_kid():
    """Create a new kid"""
    try:
        data = request.get_json()

        # Validate required fields
        if not data.get('name'):
            return jsonify({'error': 'Name is required'}), 400

        if not data.get('birthday'):
            return jsonify({'error': 'Birthday is required'}), 400

        # Create kid object
        kid_id = str(uuid.uuid4())
        kid = {
            'id': kid_id,
            'name': data['name'],
            'birthday': data['birthday'],
            'sessionCardCount': DEFAULT_SESSION_CARD_COUNT,
            'dailyPracticeChineseEnabled': True,
            'dailyPracticeMathEnabled': False,
            'dbFilePath': f'data/kid_{kid_id}.db',
            'createdAt': datetime.now().isoformat()
        }

        # Initialize kid's database
        kid_db.init_kid_database(kid_id)

        # Save to metadata
        metadata.add_kid(kid)

        return jsonify(kid), 201

    except Exception as e:
        return jsonify({'error': str(e)}), 500


@kids_bp.route('/kids/<kid_id>', methods=['GET'])
def get_kid(kid_id):
    """Get a specific kid"""
    try:
        kid = metadata.get_kid_by_id(kid_id)
        if not kid:
            return jsonify({'error': 'Kid not found'}), 404

        # Backfill defaults for older kid metadata.
        backfill_updates = {}
        if 'sessionCardCount' not in kid:
            backfill_updates['sessionCardCount'] = DEFAULT_SESSION_CARD_COUNT
        if 'dailyPracticeChineseEnabled' not in kid:
            if 'dailyPracticeEnabled' in kid:
                backfill_updates['dailyPracticeChineseEnabled'] = bool(kid.get('dailyPracticeEnabled'))
            else:
                backfill_updates['dailyPracticeChineseEnabled'] = True
        if 'dailyPracticeMathEnabled' not in kid:
            backfill_updates['dailyPracticeMathEnabled'] = False
        if backfill_updates:
            kid = metadata.update_kid(kid_id, backfill_updates)

        today_counts = get_today_completed_session_counts(kid_id)
        kid_with_progress = {
            **kid,
            'dailyCompletedCountToday': today_counts['total'],
            'dailyCompletedChineseCountToday': today_counts['chinese'],
            'dailyCompletedMathCountToday': today_counts['math']
        }

        return jsonify(kid_with_progress), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@kids_bp.route('/kids/<kid_id>', methods=['PUT'])
def update_kid(kid_id):
    """Update a specific kid's metadata"""
    try:
        kid = metadata.get_kid_by_id(kid_id)
        if not kid:
            return jsonify({'error': 'Kid not found'}), 404

        data = request.get_json() or {}
        updates = {}

        if 'sessionCardCount' in data:
            try:
                session_card_count = int(data['sessionCardCount'])
            except (TypeError, ValueError):
                return jsonify({'error': 'sessionCardCount must be an integer'}), 400

            if session_card_count < MIN_SESSION_CARD_COUNT or session_card_count > MAX_SESSION_CARD_COUNT:
                return jsonify({'error': f'sessionCardCount must be between {MIN_SESSION_CARD_COUNT} and {MAX_SESSION_CARD_COUNT}'}), 400

            updates['sessionCardCount'] = session_card_count

        if 'dailyPracticeChineseEnabled' in data:
            if not isinstance(data['dailyPracticeChineseEnabled'], bool):
                return jsonify({'error': 'dailyPracticeChineseEnabled must be a boolean'}), 400
            updates['dailyPracticeChineseEnabled'] = data['dailyPracticeChineseEnabled']

        if 'dailyPracticeMathEnabled' in data:
            if not isinstance(data['dailyPracticeMathEnabled'], bool):
                return jsonify({'error': 'dailyPracticeMathEnabled must be a boolean'}), 400
            updates['dailyPracticeMathEnabled'] = data['dailyPracticeMathEnabled']

        if not updates:
            return jsonify({'error': 'No supported fields to update'}), 400

        updated_kid = metadata.update_kid(kid_id, updates)
        if not updated_kid:
            return jsonify({'error': 'Kid not found'}), 404

        return jsonify(updated_kid), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@kids_bp.route('/kids/<kid_id>', methods=['DELETE'])
def delete_kid(kid_id):
    """Delete a kid and their database"""
    try:
        kid = metadata.get_kid_by_id(kid_id)
        if not kid:
            return jsonify({'error': 'Kid not found'}), 404

        # Delete database file
        kid_db.delete_kid_database(kid_id)

        # Delete from metadata
        metadata.delete_kid(kid_id)

        return jsonify({'message': 'Kid deleted successfully'}), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500


# Card routes

def get_or_create_default_deck(conn):
    """Get or create the default deck for a kid"""
    result = conn.execute("SELECT id FROM decks WHERE name = 'Chinese Characters'").fetchone()

    if result:
        return result[0]

    deck_id = str(uuid.uuid4())
    conn.execute(
        """
        INSERT INTO decks (id, name, description, tags)
        VALUES (?, ?, ?, ?)
        """,
        [deck_id, 'Chinese Characters', 'Default deck for Chinese characters', []]
    )

    return deck_id


def get_or_create_math_deck(conn):
    """Get or create the default math deck for a kid."""
    result = conn.execute("SELECT id FROM decks WHERE name = 'Math Practice'").fetchone()
    if result:
        return result[0]

    deck_id = str(uuid.uuid4())
    conn.execute(
        """
        INSERT INTO decks (id, name, description, tags)
        VALUES (?, ?, ?, ?)
        """,
        [deck_id, 'Math Practice', 'Default deck for math practice', ['math']]
    )
    return deck_id


def get_starter_math_pairs():
    """Starter set: 20 single-digit addition exercises."""
    return [
        (1, 1), (1, 2), (1, 3), (2, 2), (2, 3),
        (2, 4), (3, 3), (3, 4), (3, 5), (4, 4),
        (4, 5), (4, 6), (5, 5), (5, 6), (5, 7),
        (6, 6), (6, 7), (7, 7), (8, 1), (9, 0)
    ]


def seed_starter_math_cards(conn, deck_id):
    """Insert starter math cards if they are not already present."""
    existing = conn.execute(
        "SELECT front FROM cards WHERE deck_id = ?",
        [deck_id]
    ).fetchall()
    existing_fronts = {row[0] for row in existing}

    inserted = 0
    for a, b in get_starter_math_pairs():
        front = f"{a} + {b}"
        back = str(a + b)
        if front in existing_fronts:
            continue

        card_id = str(uuid.uuid4())
        conn.execute(
            """
            INSERT INTO cards (id, deck_id, front, back, front_lang, back_lang)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            [card_id, deck_id, front, back, 'math', 'math']
        )
        inserted += 1
        existing_fronts.add(front)

    total = conn.execute(
        "SELECT COUNT(*) FROM cards WHERE deck_id = ?",
        [deck_id]
    ).fetchone()[0]

    return {'inserted': inserted, 'total': int(total)}


def ensure_practice_queue(conn, deck_id):
    """Ensure queue/state tables are consistent with cards."""
    conn.execute(
        """
        INSERT INTO practice_state_by_deck (deck_id, queue_cursor)
        SELECT ?, 0
        WHERE NOT EXISTS (
            SELECT 1 FROM practice_state_by_deck WHERE deck_id = ?
        )
        """,
        [deck_id, deck_id]
    )

    conn.execute(
        """
        DELETE FROM practice_queue
        WHERE deck_id = ?
          AND card_id NOT IN (SELECT id FROM cards WHERE deck_id = ?)
        """,
        [deck_id, deck_id]
    )

    max_order_row = conn.execute(
        "SELECT COALESCE(MAX(queue_order), -1) FROM practice_queue WHERE deck_id = ?",
        [deck_id]
    ).fetchone()
    next_order = int(max_order_row[0]) + 1

    missing_cards = conn.execute(
        """
        SELECT c.id
        FROM cards c
        LEFT JOIN practice_queue q ON c.id = q.card_id AND q.deck_id = c.deck_id
        WHERE c.deck_id = ? AND q.card_id IS NULL
        ORDER BY c.created_at ASC
        """,
        [deck_id]
    ).fetchall()

    for row in missing_cards:
        conn.execute(
            "INSERT INTO practice_queue (deck_id, card_id, queue_order) VALUES (?, ?, ?)",
            [deck_id, row[0], next_order]
        )
        next_order += 1

    total_queue = conn.execute(
        "SELECT COUNT(*) FROM practice_queue WHERE deck_id = ?",
        [deck_id]
    ).fetchone()[0]
    if total_queue == 0:
        conn.execute(
            "UPDATE practice_state_by_deck SET queue_cursor = 0 WHERE deck_id = ?",
            [deck_id]
        )
        return

    cursor = conn.execute(
        "SELECT queue_cursor FROM practice_state_by_deck WHERE deck_id = ?",
        [deck_id]
    ).fetchone()[0]
    normalized_cursor = int(cursor) % int(total_queue)
    if normalized_cursor != cursor:
        conn.execute(
            "UPDATE practice_state_by_deck SET queue_cursor = ? WHERE deck_id = ?",
            [normalized_cursor, deck_id]
        )


def insert_card_to_queue_front(conn, deck_id, card_id):
    """Put newly-added card at front while preserving old FIFO pointer."""
    cursor_row = conn.execute(
        "SELECT queue_cursor FROM practice_state_by_deck WHERE deck_id = ?",
        [deck_id]
    ).fetchone()
    current_cursor = int(cursor_row[0]) if cursor_row else 0
    total_before = int(
        conn.execute(
            "SELECT COUNT(*) FROM practice_queue WHERE deck_id = ?",
            [deck_id]
        ).fetchone()[0]
    )

    min_order_row = conn.execute(
        "SELECT MIN(queue_order) FROM practice_queue WHERE deck_id = ?",
        [deck_id]
    ).fetchone()
    min_order = min_order_row[0]
    new_order = 0 if min_order is None else int(min_order) - 1

    conn.execute(
        "INSERT INTO practice_queue (deck_id, card_id, queue_order) VALUES (?, ?, ?)",
        [deck_id, card_id, new_order]
    )

    # Keep pointing to the same logical "next old card" after front insertion.
    if total_before == 0:
        conn.execute(
            "UPDATE practice_state_by_deck SET queue_cursor = 0 WHERE deck_id = ?",
            [deck_id]
        )
    else:
        new_total = total_before + 1
        new_cursor = (current_cursor + 1) % new_total
        conn.execute(
            "UPDATE practice_state_by_deck SET queue_cursor = ? WHERE deck_id = ?",
            [new_cursor, deck_id]
        )


def get_session_red_cards(conn, session_id):
    """Get red cards from a specific session."""
    if not session_id:
        return []

    rows = conn.execute(
        """
        SELECT card_id
        FROM session_results
        WHERE session_id = ? AND correct = FALSE AND card_id IS NOT NULL
        ORDER BY timestamp ASC
        """,
        [session_id]
    ).fetchall()

    red_cards = []
    seen = set()
    for row in rows:
        card_id = row[0]
        if card_id and card_id not in seen:
            red_cards.append(card_id)
            seen.add(card_id)

    return red_cards


def get_last_completed_session(conn, session_type):
    """Return latest completed session id and completed timestamp by type."""
    row = conn.execute(
        """
        SELECT id, completed_at
        FROM sessions
        WHERE type = ? AND completed_at IS NOT NULL
        ORDER BY completed_at DESC
        LIMIT 1
        """,
        [session_type]
    ).fetchone()

    if not row:
        return None, None
    return row[0], row[1]


def start_deck_practice_session(conn, kid, deck_id, session_type):
    """Shared queue-based session planner for a deck."""
    ensure_practice_queue(conn, deck_id)

    cards = conn.execute(
        """
        SELECT c.id, c.front, c.back, c.front_lang, c.back_lang, c.created_at
        FROM cards c
        JOIN practice_queue q ON c.id = q.card_id AND q.deck_id = c.deck_id
        WHERE c.deck_id = ?
        ORDER BY q.queue_order ASC
        """,
        [deck_id]
    ).fetchall()

    if len(cards) == 0:
        return None, []

    cards_by_id = {
        row[0]: {
            'id': row[0],
            'front': row[1],
            'back': row[2],
            'front_lang': row[3],
            'back_lang': row[4],
            'created_at': row[5].isoformat() if row[5] else None
        }
        for row in cards
    }
    queue_ids = [row[0] for row in cards]

    base_target_count = min(normalize_session_card_count(kid), len(queue_ids))
    last_session_id, last_completed_at = get_last_completed_session(conn, session_type)
    red_card_ids = []
    if last_session_id:
        red_card_ids = [card_id for card_id in get_session_red_cards(conn, last_session_id) if card_id in cards_by_id]

    new_card_ids = []
    if last_completed_at is not None:
        new_rows = conn.execute(
            """
            SELECT c.id
            FROM cards c
            JOIN practice_queue q ON c.id = q.card_id AND q.deck_id = c.deck_id
            WHERE c.deck_id = ? AND c.created_at > ?
            ORDER BY q.queue_order ASC
            """,
            [deck_id, last_completed_at]
        ).fetchall()
        new_card_ids = [row[0] for row in new_rows]

    selected_ids = []
    selected_set = set()

    for card_id in red_card_ids:
        if card_id not in selected_set:
            selected_ids.append(card_id)
            selected_set.add(card_id)

    for card_id in new_card_ids:
        if card_id in cards_by_id and card_id not in selected_set:
            selected_ids.append(card_id)
            selected_set.add(card_id)

    target_count = min(len(queue_ids), max(base_target_count, len(selected_ids)))

    cursor = conn.execute(
        "SELECT queue_cursor FROM practice_state_by_deck WHERE deck_id = ?",
        [deck_id]
    ).fetchone()[0]
    cursor = int(cursor) % len(queue_ids)
    queue_used = 0

    offset = 0
    while len(selected_ids) < target_count and offset < len(queue_ids):
        card_id = queue_ids[(cursor + offset) % len(queue_ids)]
        if card_id not in selected_set:
            selected_ids.append(card_id)
            selected_set.add(card_id)
            queue_used += 1
        offset += 1

    next_cursor = (cursor + queue_used) % len(queue_ids)
    conn.execute(
        "UPDATE practice_state_by_deck SET queue_cursor = ? WHERE deck_id = ?",
        [next_cursor, deck_id]
    )

    session_id = str(uuid.uuid4())
    conn.execute(
        """
        INSERT INTO sessions (id, type, deck_id, planned_count)
        VALUES (?, ?, ?, ?)
        """,
        [session_id, session_type, deck_id, len(selected_ids)]
    )

    selected_cards = [cards_by_id[card_id] for card_id in selected_ids]
    return session_id, selected_cards


def submit_practice_answer_internal(kid_id, session_type, data):
    """Shared answer logging for both chinese and math practice."""
    session_id = data.get('sessionId')
    card_id = data.get('cardId')
    known = data.get('known')
    response_time_ms = data.get('responseTimeMs')

    if not session_id:
        return {'error': 'sessionId is required'}, 400
    if not card_id:
        return {'error': 'cardId is required'}, 400
    if not isinstance(known, bool):
        return {'error': 'known must be a boolean'}, 400

    try:
        response_time_ms = int(response_time_ms)
    except (TypeError, ValueError):
        return {'error': 'responseTimeMs must be an integer'}, 400

    if response_time_ms < 0 or response_time_ms > 600000:
        return {'error': 'responseTimeMs must be between 0 and 600000'}, 400

    conn = kid_db.get_kid_connection(kid_id)

    session = conn.execute(
        """
        SELECT id, planned_count, completed_at
        FROM sessions
        WHERE id = ? AND type = ?
        """,
        [session_id, session_type]
    ).fetchone()

    if not session:
        conn.close()
        return {'error': 'Session not found'}, 404
    if session[2] is not None:
        conn.close()
        return {'error': 'Session already completed'}, 400

    card = conn.execute(
        "SELECT id, front FROM cards WHERE id = ?",
        [card_id]
    ).fetchone()
    if not card:
        conn.close()
        return {'error': 'Card not found'}, 404

    existing_result = conn.execute(
        "SELECT id FROM session_results WHERE session_id = ? AND card_id = ?",
        [session_id, card_id]
    ).fetchone()
    if existing_result:
        conn.close()
        return {'error': 'Card already answered in this session'}, 409

    result_id = str(uuid.uuid4())
    conn.execute(
        """
        INSERT INTO session_results (
            id, session_id, card_id, question, user_answer, correct, response_time_ms
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
        """,
        [
            result_id,
            session_id,
            card_id,
            card[1],
            'green' if known else 'red',
            known,
            response_time_ms
        ]
    )

    answer_count = conn.execute(
        "SELECT COUNT(*) FROM session_results WHERE session_id = ?",
        [session_id]
    ).fetchone()[0]

    planned_count = int(session[1] or 0)
    completed = False
    if planned_count > 0 and answer_count >= planned_count:
        conn.execute(
            "UPDATE sessions SET completed_at = CURRENT_TIMESTAMP WHERE id = ?",
            [session_id]
        )
        completed = True

    conn.close()
    return {
        'session_id': session_id,
        'answer_count': int(answer_count),
        'planned_count': planned_count,
        'completed': completed
    }, 200


def delete_card_from_deck_internal(conn, deck_id, card_id):
    """Shared queue-safe delete for a card in a specific deck."""
    queue_ids_before = [
        row[0] for row in conn.execute(
            "SELECT card_id FROM practice_queue WHERE deck_id = ? ORDER BY queue_order ASC",
            [deck_id]
        ).fetchall()
    ]
    cursor_row = conn.execute(
        "SELECT queue_cursor FROM practice_state_by_deck WHERE deck_id = ?",
        [deck_id]
    ).fetchone()
    cursor = int(cursor_row[0]) if cursor_row else 0

    deleted_index = -1
    try:
        deleted_index = queue_ids_before.index(card_id)
    except ValueError:
        deleted_index = -1

    conn.execute("DELETE FROM practice_queue WHERE deck_id = ? AND card_id = ?", [deck_id, card_id])
    conn.execute("DELETE FROM cards WHERE id = ?", [card_id])

    queue_count = conn.execute(
        "SELECT COUNT(*) FROM practice_queue WHERE deck_id = ?",
        [deck_id]
    ).fetchone()[0]
    if queue_count == 0:
        conn.execute(
            "UPDATE practice_state_by_deck SET queue_cursor = 0 WHERE deck_id = ?",
            [deck_id]
        )
    else:
        if deleted_index != -1 and deleted_index < cursor:
            cursor -= 1
        if cursor < 0:
            cursor = 0
        conn.execute(
            "UPDATE practice_state_by_deck SET queue_cursor = ? WHERE deck_id = ?",
            [int(cursor) % int(queue_count), deck_id]
        )


@kids_bp.route('/kids/<kid_id>/cards', methods=['GET'])
def get_cards(kid_id):
    """Get all cards for a kid in practice queue order, with timing stats."""
    try:
        kid = metadata.get_kid_by_id(kid_id)
        if not kid:
            return jsonify({'error': 'Kid not found'}), 404

        conn = kid_db.get_kid_connection(kid_id)
        deck_id = get_or_create_default_deck(conn)
        ensure_practice_queue(conn, deck_id)

        cards = conn.execute(
            """
            SELECT
                c.id,
                c.deck_id,
                c.front,
                c.back,
                c.front_lang,
                c.back_lang,
                c.created_at,
                q.queue_order,
                AVG(CASE WHEN sr.correct = TRUE AND sr.response_time_ms IS NOT NULL THEN sr.response_time_ms END) AS avg_green_ms,
                COUNT(sr.id) AS lifetime_attempts,
                MAX(sr.timestamp) AS last_seen_at
            FROM cards c
            LEFT JOIN practice_queue q ON c.id = q.card_id AND q.deck_id = c.deck_id
            LEFT JOIN session_results sr ON c.id = sr.card_id
            WHERE c.deck_id = ?
            GROUP BY c.id, c.deck_id, c.front, c.back, c.front_lang, c.back_lang, c.created_at, q.queue_order
            ORDER BY q.queue_order ASC, c.created_at DESC
            """,
            [deck_id]
        ).fetchall()

        conn.close()

        card_list = [{
            'id': card[0],
            'deck_id': card[1],
            'front': card[2],
            'back': card[3],
            'front_lang': card[4],
            'back_lang': card[5],
            'created_at': card[6].isoformat() if card[6] else None,
            'parent_added_at': card[6].isoformat() if card[6] else None,
            'queue_order': int(card[7]) if card[7] is not None else None,
            'avg_green_ms': float(card[8]) if card[8] is not None else None,
            'lifetime_attempts': int(card[9]) if card[9] is not None else 0,
            'last_seen_at': card[10].isoformat() if card[10] else None
        } for card in cards]

        return jsonify({'deck_id': deck_id, 'cards': card_list}), 200

    except Exception as e:
        return jsonify({'error': str(e)}), 500


@kids_bp.route('/kids/<kid_id>/cards', methods=['POST'])
def add_card(kid_id):
    """Add a new card for a kid"""
    try:
        kid = metadata.get_kid_by_id(kid_id)
        if not kid:
            return jsonify({'error': 'Kid not found'}), 404

        data = request.get_json()

        if not data.get('front'):
            return jsonify({'error': 'Front text is required'}), 400

        conn = kid_db.get_kid_connection(kid_id)
        deck_id = get_or_create_default_deck(conn)
        ensure_practice_queue(conn, deck_id)

        card_id = str(uuid.uuid4())
        conn.execute(
            """
            INSERT INTO cards (id, deck_id, front, back, front_lang, back_lang)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            [
                card_id,
                deck_id,
                data['front'],
                data.get('back', ''),
                data.get('front_lang', 'zh'),
                data.get('back_lang', 'en')
            ]
        )

        insert_card_to_queue_front(conn, deck_id, card_id)

        card = conn.execute(
            """
            SELECT id, deck_id, front, back, front_lang, back_lang, created_at
            FROM cards
            WHERE id = ?
            """,
            [card_id]
        ).fetchone()

        conn.close()

        card_obj = {
            'id': card[0],
            'deck_id': card[1],
            'front': card[2],
            'back': card[3],
            'front_lang': card[4],
            'back_lang': card[5],
            'created_at': card[6].isoformat() if card[6] else None,
            'parent_added_at': card[6].isoformat() if card[6] else None
        }

        return jsonify(card_obj), 201

    except Exception as e:
        return jsonify({'error': str(e)}), 500


@kids_bp.route('/kids/<kid_id>/cards/<card_id>', methods=['DELETE'])
def delete_card(kid_id, card_id):
    """Delete a card"""
    try:
        kid = metadata.get_kid_by_id(kid_id)
        if not kid:
            return jsonify({'error': 'Kid not found'}), 404

        conn = kid_db.get_kid_connection(kid_id)

        card = conn.execute("SELECT id, deck_id FROM cards WHERE id = ?", [card_id]).fetchone()
        if not card:
            conn.close()
            return jsonify({'error': 'Card not found'}), 404
        deck_id = card[1]
        delete_card_from_deck_internal(conn, deck_id, card_id)

        conn.close()

        return jsonify({'message': 'Card deleted successfully'}), 200

    except Exception as e:
        return jsonify({'error': str(e)}), 500


@kids_bp.route('/kids/<kid_id>/practice/start', methods=['POST'])
def start_practice_session(kid_id):
    """Start a practice session with last-session reds + queue-based FIFO rotation."""
    try:
        kid = metadata.get_kid_by_id(kid_id)
        if not kid:
            return jsonify({'error': 'Kid not found'}), 404

        conn = kid_db.get_kid_connection(kid_id)
        deck_id = get_or_create_default_deck(conn)
        session_id, selected_cards = start_deck_practice_session(conn, kid, deck_id, 'flashcard')

        conn.close()
        if not session_id:
            return jsonify({'session_id': None, 'cards': [], 'planned_count': 0}), 200

        return jsonify({
            'session_id': session_id,
            'cards': selected_cards,
            'planned_count': len(selected_cards)
        }), 200

    except Exception as e:
        return jsonify({'error': str(e)}), 500


@kids_bp.route('/kids/<kid_id>/math/cards', methods=['GET'])
def get_math_cards(kid_id):
    """Get all math cards for a kid."""
    try:
        kid = metadata.get_kid_by_id(kid_id)
        if not kid:
            return jsonify({'error': 'Kid not found'}), 404

        conn = kid_db.get_kid_connection(kid_id)
        deck_id = get_or_create_math_deck(conn)
        ensure_practice_queue(conn, deck_id)

        cards = conn.execute(
            """
            SELECT
                c.id,
                c.deck_id,
                c.front,
                c.back,
                c.created_at,
                q.queue_order,
                AVG(CASE WHEN sr.correct = TRUE AND sr.response_time_ms IS NOT NULL THEN sr.response_time_ms END) AS avg_green_ms,
                COUNT(sr.id) AS lifetime_attempts,
                MAX(sr.timestamp) AS last_seen_at
            FROM cards c
            LEFT JOIN practice_queue q ON c.id = q.card_id AND q.deck_id = c.deck_id
            LEFT JOIN session_results sr ON c.id = sr.card_id
            WHERE c.deck_id = ?
            GROUP BY c.id, c.deck_id, c.front, c.back, c.created_at, q.queue_order
            ORDER BY q.queue_order ASC, c.created_at DESC
            """,
            [deck_id]
        ).fetchall()

        conn.close()

        return jsonify({
            'deck_id': deck_id,
            'cards': [{
                'id': row[0],
                'deck_id': row[1],
                'front': row[2],
                'back': row[3],
                'created_at': row[4].isoformat() if row[4] else None,
                'parent_added_at': row[4].isoformat() if row[4] else None,
                'queue_order': int(row[5]) if row[5] is not None else None,
                'avg_green_ms': float(row[6]) if row[6] is not None else None,
                'lifetime_attempts': int(row[7]) if row[7] is not None else 0,
                'last_seen_at': row[8].isoformat() if row[8] else None
            } for row in cards]
        }), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@kids_bp.route('/kids/<kid_id>/math/seed', methods=['POST'])
def seed_math_cards(kid_id):
    """Insert starter 20 math cards for a kid."""
    try:
        kid = metadata.get_kid_by_id(kid_id)
        if not kid:
            return jsonify({'error': 'Kid not found'}), 404

        conn = kid_db.get_kid_connection(kid_id)
        deck_id = get_or_create_math_deck(conn)
        seed_result = seed_starter_math_cards(conn, deck_id)
        conn.close()

        return jsonify({
            'deck_id': deck_id,
            'inserted': seed_result['inserted'],
            'total': seed_result['total']
        }), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@kids_bp.route('/kids/<kid_id>/math/cards/<card_id>', methods=['DELETE'])
def delete_math_card(kid_id, card_id):
    """Delete a math card."""
    try:
        kid = metadata.get_kid_by_id(kid_id)
        if not kid:
            return jsonify({'error': 'Kid not found'}), 404

        conn = kid_db.get_kid_connection(kid_id)
        deck_id = get_or_create_math_deck(conn)

        card = conn.execute(
            "SELECT id FROM cards WHERE id = ? AND deck_id = ?",
            [card_id, deck_id]
        ).fetchone()
        if not card:
            conn.close()
            return jsonify({'error': 'Math card not found'}), 404

        delete_card_from_deck_internal(conn, deck_id, card_id)
        conn.close()
        return jsonify({'message': 'Math card deleted successfully'}), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@kids_bp.route('/kids/<kid_id>/math/practice/start', methods=['POST'])
def start_math_practice_session(kid_id):
    """Start a math practice session."""
    try:
        kid = metadata.get_kid_by_id(kid_id)
        if not kid:
            return jsonify({'error': 'Kid not found'}), 404

        conn = kid_db.get_kid_connection(kid_id)
        deck_id = get_or_create_math_deck(conn)

        # Ensure starter exists if math deck is empty.
        count_before = conn.execute(
            "SELECT COUNT(*) FROM cards WHERE deck_id = ?",
            [deck_id]
        ).fetchone()[0]
        if int(count_before) == 0:
            seed_starter_math_cards(conn, deck_id)

        session_id, selected_cards = start_deck_practice_session(conn, kid, deck_id, 'math')
        conn.close()

        if not session_id:
            return jsonify({'session_id': None, 'cards': [], 'planned_count': 0}), 200

        return jsonify({
            'session_id': session_id,
            'planned_count': len(selected_cards),
            'cards': selected_cards
        }), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@kids_bp.route('/kids/<kid_id>/math/practice/answer', methods=['POST'])
def submit_math_practice_answer(kid_id):
    """Store math answer and response time for one card in a session."""
    try:
        kid = metadata.get_kid_by_id(kid_id)
        if not kid:
            return jsonify({'error': 'Kid not found'}), 404

        payload, status_code = submit_practice_answer_internal(
            kid_id,
            'math',
            request.get_json() or {}
        )
        return jsonify(payload), status_code
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@kids_bp.route('/kids/<kid_id>/practice/answer', methods=['POST'])
def submit_practice_answer(kid_id):
    """Store answer and response time for one card in a session."""
    try:
        kid = metadata.get_kid_by_id(kid_id)
        if not kid:
            return jsonify({'error': 'Kid not found'}), 404

        payload, status_code = submit_practice_answer_internal(
            kid_id,
            'flashcard',
            request.get_json() or {}
        )
        return jsonify(payload), status_code

    except Exception as e:
        return jsonify({'error': str(e)}), 500
