"""Kid management API routes"""
from flask import Blueprint, request, jsonify, send_from_directory, session
from datetime import datetime, timedelta, timezone
import json
import os
import shutil
import uuid
import time
import threading
import mimetypes
import re
from zoneinfo import ZoneInfo
from werkzeug.utils import secure_filename
from src.db import metadata, kid_db

kids_bp = Blueprint('kids', __name__)

DEFAULT_SESSION_CARD_COUNT = 10
MIN_SESSION_CARD_COUNT = 1
MAX_SESSION_CARD_COUNT = 200
DEFAULT_HARD_CARD_PERCENTAGE = 20
MIN_HARD_CARD_PERCENTAGE = 0
MAX_HARD_CARD_PERCENTAGE = 100
MAX_WRITING_SHEET_ROWS = 10
BACKEND_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(__file__)))
DATA_DIR = os.path.join(BACKEND_ROOT, 'data')
FAMILIES_ROOT = os.path.join(DATA_DIR, 'families')
DEFAULT_MATH_DECK_WITHIN_10_COUNT = 5
DEFAULT_MATH_DECK_WITHIN_20_COUNT = 5
DEFAULT_MATH_DECK_SUB_WITHIN_10_COUNT = 0
DEFAULT_MATH_DECK_SUB_WITHIN_20_COUNT = 0
DEFAULT_LESSON_READING_DECK_COUNT = 0
MATH_DECK_CONFIGS = {
    'within10': {
        'name': 'Math Addition Within 10',
        'description': 'All ordered pairs where a + b is between 0 and 10',
        'tags': ['math', 'within10'],
        'operation': '+',
        'sum_min': 0,
        'sum_max': 10,
        'kid_field': 'mathDeckWithin10Count',
        'default_count': DEFAULT_MATH_DECK_WITHIN_10_COUNT,
        'label': 'Add ≤10',
    },
    'within20': {
        'name': 'Math Addition Within 20',
        'description': 'All ordered pairs where a + b is between 11 and 20',
        'tags': ['math', 'within20'],
        'operation': '+',
        'sum_min': 11,
        'sum_max': 20,
        'kid_field': 'mathDeckWithin20Count',
        'default_count': DEFAULT_MATH_DECK_WITHIN_20_COUNT,
        'label': 'Add 11–20',
    },
    'subWithin10': {
        'name': 'Math Subtraction Within 10',
        'description': 'All ordered pairs where a - b and a is between 0 and 10',
        'tags': ['math', 'subtraction', 'within10'],
        'operation': '-',
        'minuend_min': 0,
        'minuend_max': 10,
        'kid_field': 'mathDeckSubWithin10Count',
        'default_count': DEFAULT_MATH_DECK_SUB_WITHIN_10_COUNT,
        'label': 'Sub ≤10',
    },
    'subWithin20': {
        'name': 'Math Subtraction Within 20',
        'description': 'All ordered pairs where a - b and a is between 11 and 20',
        'tags': ['math', 'subtraction', 'within20'],
        'operation': '-',
        'minuend_min': 11,
        'minuend_max': 20,
        'kid_field': 'mathDeckSubWithin20Count',
        'default_count': DEFAULT_MATH_DECK_SUB_WITHIN_20_COUNT,
        'label': 'Sub 11–20',
    }
}

LESSON_READING_DECK_CONFIGS = {
    'ma3Unit1': {
        'name': 'Chinese Reading Ma3 Unit 1',
        'description': '马三 第一单元 课文读诵',
        'tags': ['lesson_reading', 'maliping', 'ma3', 'unit1'],
        'kid_field': 'lessonReadingDeckMa3Unit1Count',
        'default_count': DEFAULT_LESSON_READING_DECK_COUNT,
        'label': '马三 一单元',
        'cards': [
            ('第1周 《斧子和皮大衣》', '7'),
            ('第1周 《借笔》', '8'),
            ('第1周 《爬到屋顶上去》', '9'),
            ('第2周 《夸孩子》', '15'),
            ('第2周 《萤火虫找朋友》', '16'),
            ('第3周 《盘古开天地》', '21'),
            ('第3周 《画蛇添足》', '22'),
            ('第3周 《还好没有抓住鼻子》', '23'),
            ('第4周 《夸父追日》', '29'),
            ('第4周 《小河流呀流》', '30'),
            ('第5周 《称象》', '32'),
            ('第5周 《盲人摸象》', '34'),
            ('第5周 《称鼻子》', '35'),
            ('第6周 《锯是怎样发明的》', '36'),
            ('第6周 《曾子杀猪》', '38'),
            ('第6周 《汤的汤》', '39'),
            ('第7周 《狐假虎威》', '40'),
            ('第7周 《狐狸请客》', '42'),
            ('第7周 《三个和尚没水喝》', '43'),
            ('第8周 《小马过河》', '44'),
            ('第8周 《谁也骗不了我》', '46'),
            ('第8周 《女娲补天》', '47'),
        ],
    },
    'ma3Unit2': {
        'name': 'Chinese Reading Ma3 Unit 2',
        'description': '马三 第二单元 课文读诵',
        'tags': ['lesson_reading', 'maliping', 'ma3', 'unit2'],
        'kid_field': 'lessonReadingDeckMa3Unit2Count',
        'default_count': DEFAULT_LESSON_READING_DECK_COUNT,
        'label': '马三 二单元',
        'cards': [
            ('第1周 《公鸡蛋》', '50'),
            ('第1周 《女娲造人》', '54'),
            ('第1周 《叶公好龙》', '55'),
            ('第1周 《让水流走》', '56'),
            ('第1周 《狐狸分饼》', '57'),
            ('第1周 《能干的猫和母鸡》', '58'),
            ('第1周 《钱包的用处》', '59'),
            ('第2周 《穷和尚和富和尚》', '60'),
            ('第2周 《太阳山》', '64'),
            ('第2周 《斧头和锯子》', '65'),
            ('第2周 《第三个包子》', '66'),
            ('第2周 《阿凡提借锅》', '67'),
            ('第2周 《曹冲救人（上）》', '68'),
            ('第2周 《曹冲救人（下）》', '69'),
            ('第3周 《要是你在野外迷了路》', '70'),
            ('第3周 《自己害自己》', '73'),
            ('第3周 《方向不对》', '74'),
            ('第3周 《蘑菇长在哪里》', '75'),
            ('第4周 《找骆驼》', '76'),
            ('第4周 《青蛙搬家》', '79'),
            ('第4周 《瞎子和跛子》', '80'),
            ('第4周 《什么叫做丢了东西》', '81'),
            ('第5周 《岳飞学写字》', '82'),
            ('第5周 《猴子学样（上）》', '86'),
            ('第5周 《猴子学样（下）》', '87'),
            ('第5周 《“一”字长大了》', '88'),
            ('第5周 《后羿射日（上）》', '89'),
            ('第5周 《后羿射日（下）》', '90'),
            ('第5周 《五十步笑一百步》', '91'),
        ],
    },
    'ma3Unit3': {
        'name': 'Chinese Reading Ma3 Unit 3',
        'description': '马三 第三单元 课文读诵',
        'tags': ['lesson_reading', 'maliping', 'ma3', 'unit3'],
        'kid_field': 'lessonReadingDeckMa3Unit3Count',
        'default_count': DEFAULT_LESSON_READING_DECK_COUNT,
        'label': '马三 三单元',
        'cards': [
            ('第1周 《光阴一去不复返》', '94'),
            ('第1周 《我有两颗心》', '98'),
            ('第1周 《勇敢的心》', '99'),
            ('第1周 《借钥匙》', '100'),
            ('第1周 《一粒种子》', '101'),
            ('第1周 《太阳神炎帝（上）》', '102'),
            ('第1周 《太阳神炎帝（下）》', '103'),
            ('第1周 《爱惜雨伞／小闹钟》', '104'),
            ('第1周 《猴子和桃子》', '105'),
            ('第2周 《爸爸的老师》', '106'),
            ('第2周 《时间老人的好办法》', '110'),
            ('第2周 《青蛙和牛》', '111'),
            ('第2周 《太阳和彩虹》', '112'),
            ('第2周 《捞月亮》', '113'),
            ('第2周 《西瓜在哪里》', '114'),
            ('第2周 《小花猫找汗》', '115'),
            ('第2周 《站起来跑得更快》', '116'),
            ('第2周 《小蝌蚪找妈妈（上）》', '117'),
            ('第3周 《等一会儿再说》', '118'),
            ('第3周 《蚊子、狮子和蜘蛛》', '120'),
            ('第3周 《金银盾》', '121'),
            ('第3周 《前面也在下雨》', '122'),
            ('第3周 《小蝌蚪找妈妈（下）》', '123'),
            ('第4周 《让我们荡起双桨》', '124'),
            ('第4周 《会动脑筋的孩子》', '126'),
            ('第4周 《自相矛盾》', '127'),
            ('第4周 《比光明》', '128'),
            ('第4周 《美丽的公鸡》', '129'),
            ('第5周 《愚公移山》', '130'),
            ('第5周 《精卫填海》', '134'),
            ('第5周 《挤奶姑娘》', '135'),
            ('第5周 《下雨天》', '136'),
            ('第5周 《井底的青蛙》', '137'),
            ('第5周 《折筷子的故事》', '138'),
            ('第5周 《香味和声音》', '139'),
            ('第5周 《蜗牛的家》', '140'),
            ('第5周 《葡萄是酸的》', '141'),
        ],
    },
}
LESSON_READING_REMOVED_CARDS = {
    ('汉语拼音总结', '31'),
}
PENDING_SESSION_TTL_SECONDS = 60 * 60 * 6
_PENDING_SESSIONS = {}
_PENDING_SESSIONS_LOCK = threading.Lock()


def get_family_root(family_id):
    """Return filesystem root for one family."""
    return os.path.join(FAMILIES_ROOT, f'family_{family_id}')


def get_kid_scoped_db_relpath(kid):
    """Return family-scoped dbFilePath for a kid."""
    family_id = str(kid.get('familyId') or '')
    kid_id = kid.get('id')
    return f"data/families/family_{family_id}/kid_{kid_id}.db"


def get_kid_writing_audio_dir(kid):
    """Get filesystem directory for kid writing prompt audio files."""
    family_id = str(kid.get('familyId') or '')
    kid_id = kid.get('id')
    return os.path.join(get_family_root(family_id), 'writing_audio', f'kid_{kid_id}')


def ensure_writing_audio_dir(kid):
    """Ensure kid writing audio directory exists."""
    path = get_kid_writing_audio_dir(kid)
    os.makedirs(path, exist_ok=True)
    return path


def get_kid_lesson_reading_audio_dir(kid):
    """Get filesystem directory for kid lesson-reading recording files."""
    family_id = str(kid.get('familyId') or '')
    kid_id = kid.get('id')
    return os.path.join(get_family_root(family_id), 'lesson_reading_audio', f'kid_{kid_id}')


def ensure_lesson_reading_audio_dir(kid):
    """Ensure kid lesson-reading audio directory exists."""
    path = get_kid_lesson_reading_audio_dir(kid)
    os.makedirs(path, exist_ok=True)
    return path


def cleanup_lesson_reading_pending_audio_files_by_payload(pending_payload):
    """Delete uploaded lesson-reading files for one pending session payload."""
    if not pending_payload:
        return
    lesson_audio_by_card = pending_payload.get('lesson_audio_by_card')
    if not isinstance(lesson_audio_by_card, dict) or len(lesson_audio_by_card) == 0:
        return
    audio_dir = str(pending_payload.get('lesson_audio_dir') or '').strip()
    if not audio_dir:
        return
    for item in lesson_audio_by_card.values():
        if not isinstance(item, dict):
            continue
        file_name = str(item.get('file_name') or '').strip()
        if not file_name:
            continue
        audio_path = os.path.join(audio_dir, file_name)
        if os.path.exists(audio_path):
            try:
                os.remove(audio_path)
            except Exception:
                pass


def cleanup_lesson_reading_pending_audio_files(kid, pending_payload):
    """Backwards-compatible wrapper for pending lesson-reading cleanup."""
    if pending_payload and not pending_payload.get('lesson_audio_dir') and kid:
        pending_payload = {**pending_payload, 'lesson_audio_dir': get_kid_lesson_reading_audio_dir(kid)}
    cleanup_lesson_reading_pending_audio_files_by_payload(pending_payload)


def current_family_id():
    """Return authenticated family id from session."""
    return str(session.get('family_id') or '')


def get_kid_for_family(kid_id):
    """Get kid scoped to currently logged-in family."""
    family_id = current_family_id()
    if not family_id:
        return None
    return metadata.get_kid_by_id(kid_id, family_id=family_id)


def get_kid_connection_for(kid):
    """Open kid database connection by scoped dbFilePath."""
    rel = kid.get('dbFilePath')
    return kid_db.get_kid_connection_by_path(rel)


def require_critical_password():
    """Require current family password for destructive/critical operations."""
    family_id = current_family_id()
    if not family_id:
        return jsonify({'error': 'Family login required'}), 401

    password = str(request.headers.get('X-Confirm-Password') or '')
    if not password:
        json_data = request.get_json(silent=True)
        if isinstance(json_data, dict):
            password = str(json_data.get('confirmPassword') or '')
    if not password:
        password = str(request.form.get('confirmPassword') or '')
    if not password:
        return jsonify({'error': 'Password confirmation required'}), 400
    if not metadata.verify_family_password(family_id, password):
        return jsonify({'error': 'Invalid password'}), 403
    return None


def normalize_session_card_count(kid):
    """Get validated session card count for a kid."""
    value = kid.get('sessionCardCount', DEFAULT_SESSION_CARD_COUNT)
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        return DEFAULT_SESSION_CARD_COUNT

    if parsed == 0:
        return 0
    if parsed < MIN_SESSION_CARD_COUNT:
        return MIN_SESSION_CARD_COUNT
    if parsed > MAX_SESSION_CARD_COUNT:
        return MAX_SESSION_CARD_COUNT
    return parsed


def normalize_writing_session_card_count(kid):
    """Get validated writing session card count for a kid."""
    value = kid.get('writingSessionCardCount', 0)
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        return 0

    if parsed < 0:
        return 0
    if parsed > MAX_SESSION_CARD_COUNT:
        return MAX_SESSION_CARD_COUNT
    return parsed


def normalize_hard_card_percentage(kid):
    """Get validated hard-card percentage from family global setting."""
    family_id = str(kid.get('familyId') or '')
    if family_id:
        try:
            return metadata.get_family_hard_card_percentage(family_id)
        except Exception:
            pass

    # Legacy fallback for old metadata rows.
    value = kid.get('hardCardPercentage', DEFAULT_HARD_CARD_PERCENTAGE)
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        return DEFAULT_HARD_CARD_PERCENTAGE

    if parsed < MIN_HARD_CARD_PERCENTAGE:
        return MIN_HARD_CARD_PERCENTAGE
    if parsed > MAX_HARD_CARD_PERCENTAGE:
        return MAX_HARD_CARD_PERCENTAGE
    return parsed


def normalize_math_deck_session_count(kid, deck_key):
    """Get validated per-session count for a specific fixed math deck."""
    config = MATH_DECK_CONFIGS.get(deck_key)
    if not config:
        return 0
    raw = kid.get(config['kid_field'], config['default_count'])
    try:
        parsed = int(raw)
    except (TypeError, ValueError):
        return int(config['default_count'])
    if parsed < 0:
        return 0
    if parsed > MAX_SESSION_CARD_COUNT:
        return MAX_SESSION_CARD_COUNT
    return parsed


def normalize_lesson_reading_deck_session_count(kid, deck_key):
    """Get validated per-session count for one lesson-reading preset deck."""
    config = LESSON_READING_DECK_CONFIGS.get(deck_key)
    if not config:
        return 0
    raw = kid.get(config['kid_field'], config['default_count'])
    try:
        parsed = int(raw)
    except (TypeError, ValueError):
        return int(config['default_count'])
    if parsed < 0:
        return 0
    if parsed > MAX_SESSION_CARD_COUNT:
        return MAX_SESSION_CARD_COUNT
    return parsed


def get_kid_dashboard_stats(kid):
    """Get today's completed session counts and ungraded Chinese Reading flag in one connection."""
    default_counts = {'total': 0, 'chinese': 0, 'math': 0, 'writing': 0, 'lesson_reading': 0}
    try:
        conn = get_kid_connection_for(kid)
    except Exception:
        return default_counts, False

    try:
        family_id = str(kid.get('familyId') or '')
        family_timezone = metadata.get_family_timezone(family_id)
        tzinfo = ZoneInfo(family_timezone)
        day_start_local = datetime.now(tzinfo).replace(hour=0, minute=0, second=0, microsecond=0)
        day_end_local = day_start_local + timedelta(days=1)
        day_start_utc = day_start_local.astimezone(timezone.utc).replace(tzinfo=None)
        day_end_utc = day_end_local.astimezone(timezone.utc).replace(tzinfo=None)

        rows = conn.execute(
            """
            SELECT type, COUNT(*)
            FROM sessions
            WHERE completed_at IS NOT NULL
              AND completed_at >= ?
              AND completed_at < ?
              AND type IN ('flashcard', 'math', 'writing', 'lesson_reading')
            GROUP BY type
            """,
            [day_start_utc, day_end_utc]
        ).fetchall()

        chinese = 0
        math = 0
        writing = 0
        lesson_reading = 0
        for row in rows:
            session_type = row[0]
            count = int(row[1] or 0)
            if session_type == 'flashcard':
                chinese = count
            elif session_type == 'math':
                math = count
            elif session_type == 'writing':
                writing = count
            elif session_type == 'lesson_reading':
                lesson_reading = count

        today_counts = {
            'total': chinese + math + writing + lesson_reading,
            'chinese': chinese,
            'math': math,
            'writing': writing,
            'lesson_reading': lesson_reading,
        }

        ungraded_row = conn.execute(
            """
            SELECT 1
            FROM sessions s
            JOIN session_results sr ON sr.session_id = s.id
            WHERE s.type = 'lesson_reading'
              AND s.completed_at IS NOT NULL
              AND sr.correct = 0
            LIMIT 1
            """,
        ).fetchone()
        has_ungraded = bool(ungraded_row)

        return today_counts, has_ungraded
    except Exception:
        return default_counts, False
    finally:
        conn.close()


def with_practice_count_fallbacks(kid):
    """Return kid object with safe count fields for count-based practice visibility."""
    safe_kid = {**kid}

    try:
        reading_count = int(safe_kid.get('sessionCardCount', DEFAULT_SESSION_CARD_COUNT))
    except (TypeError, ValueError):
        reading_count = DEFAULT_SESSION_CARD_COUNT
    reading_count = max(0, min(MAX_SESSION_CARD_COUNT, reading_count))
    safe_kid['sessionCardCount'] = reading_count

    writing_raw = safe_kid.get('writingSessionCardCount')
    if writing_raw is None:
        writing_count = reading_count if bool(safe_kid.get('dailyPracticeWritingEnabled')) else 0
    else:
        try:
            writing_count = int(writing_raw)
        except (TypeError, ValueError):
            writing_count = 0
    safe_kid['writingSessionCardCount'] = max(0, min(MAX_SESSION_CARD_COUNT, writing_count))

    def _normalized_math_count(field_name, fallback_value):
        raw = safe_kid.get(field_name)
        if raw is None:
            return fallback_value if bool(safe_kid.get('dailyPracticeMathEnabled')) else 0
        try:
            value = int(raw)
        except (TypeError, ValueError):
            value = 0
        return max(0, min(MAX_SESSION_CARD_COUNT, value))

    for cfg in MATH_DECK_CONFIGS.values():
        safe_kid[cfg['kid_field']] = _normalized_math_count(cfg['kid_field'], cfg['default_count'])
    for cfg in LESSON_READING_DECK_CONFIGS.values():
        safe_kid[cfg['kid_field']] = _normalized_math_count(cfg['kid_field'], cfg['default_count'])

    return safe_kid


@kids_bp.route('/kids', methods=['GET'])
def get_kids():
    """Get all kids"""
    try:
        family_id = current_family_id()
        if not family_id:
            return jsonify({'error': 'Family login required'}), 401
        kids = metadata.get_all_kids(family_id=family_id)

        kids_with_progress = []
        for kid in kids:
            normalized_kid = with_practice_count_fallbacks(kid)
            today_counts, has_ungraded = get_kid_dashboard_stats(kid)
            kid_with_progress = {
                **normalized_kid,
                'dailyCompletedCountToday': today_counts['total'],
                'dailyCompletedChineseCountToday': today_counts['chinese'],
                'dailyCompletedMathCountToday': today_counts['math'],
                'dailyCompletedWritingCountToday': today_counts['writing'],
                'dailyCompletedLessonReadingCountToday': today_counts.get('lesson_reading', 0),
                'hasChineseReadingToReview': has_ungraded,
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

        family_id = current_family_id()
        if not family_id:
            return jsonify({'error': 'Family login required'}), 401

        # Save to metadata (ID assigned atomically inside the lock)
        kid = metadata.add_kid({
            'familyId': family_id,
            'name': data['name'],
            'birthday': data['birthday'],
            'sessionCardCount': 0,
            'writingSessionCardCount': 0,
            'hardCardPercentage': DEFAULT_HARD_CARD_PERCENTAGE,
            'mathDeckWithin10Count': 10,
            'mathDeckWithin20Count': 0,
            'mathDeckSubWithin10Count': 0,
            'mathDeckSubWithin20Count': 0,
            'lessonReadingDeckMa3Unit1Count': 0,
            'lessonReadingDeckMa3Unit2Count': 0,
            'lessonReadingDeckMa3Unit3Count': 0,
            'dailyPracticeChineseEnabled': False,
            'dailyPracticeMathEnabled': True,
            'dailyPracticeWritingEnabled': False,
            'createdAt': datetime.now().isoformat()
        })
        kid_id = kid['id']
        db_relpath = f"data/families/family_{family_id}/kid_{kid_id}.db"
        metadata.update_kid(kid_id, {'dbFilePath': db_relpath}, family_id)

        # Initialize kid's database
        kid_db.init_kid_database_by_path(db_relpath)
        conn = kid_db.get_kid_connection_by_path(db_relpath)
        seed_all_math_decks(conn)
        seed_all_lesson_reading_decks(conn)
        conn.close()

        return jsonify(kid), 201

    except Exception as e:
        return jsonify({'error': str(e)}), 500


@kids_bp.route('/kids/<kid_id>', methods=['GET'])
def get_kid(kid_id):
    """Get a specific kid"""
    try:
        kid = get_kid_for_family(kid_id)
        if not kid:
            return jsonify({'error': 'Kid not found'}), 404

        normalized_kid = with_practice_count_fallbacks(kid)
        today_counts, has_ungraded = get_kid_dashboard_stats(kid)
        kid_with_progress = {
            **normalized_kid,
            'dailyCompletedCountToday': today_counts['total'],
            'dailyCompletedChineseCountToday': today_counts['chinese'],
            'dailyCompletedMathCountToday': today_counts['math'],
            'dailyCompletedWritingCountToday': today_counts['writing'],
            'dailyCompletedLessonReadingCountToday': today_counts.get('lesson_reading', 0),
            'hasChineseReadingToReview': has_ungraded,
        }

        return jsonify(kid_with_progress), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@kids_bp.route('/kids/<kid_id>/report', methods=['GET'])
def get_kid_report(kid_id):
    """Get one kid's practice history report for parent view."""
    try:
        kid = get_kid_for_family(kid_id)
        if not kid:
            return jsonify({'error': 'Kid not found'}), 404

        conn = get_kid_connection_for(kid)
        rows = conn.execute(
            """
            SELECT
                s.id,
                s.type,
                s.started_at,
                s.completed_at,
                COALESCE(s.planned_count, 0) AS planned_count,
                COUNT(sr.id) AS answer_count,
                COALESCE(SUM(CASE WHEN sr.correct > 0 THEN 1 ELSE 0 END), 0) AS right_count,
                COALESCE(SUM(CASE WHEN sr.correct < 0 THEN 1 ELSE 0 END), 0) AS wrong_count,
                COALESCE(SUM(CASE WHEN sr.response_time_ms IS NULL THEN 0 ELSE sr.response_time_ms END), 0) AS total_response_ms,
                COALESCE(AVG(sr.response_time_ms), 0) AS avg_response_ms
            FROM sessions s
            LEFT JOIN session_results sr ON sr.session_id = s.id
            GROUP BY s.id, s.type, s.started_at, s.completed_at, s.planned_count
            ORDER BY COALESCE(s.completed_at, s.started_at) DESC, s.id DESC
            """
        ).fetchall()
        conn.close()

        sessions = []
        for row in rows:
            sessions.append({
                'id': int(row[0]),
                'type': row[1],
                'started_at': row[2].isoformat() if row[2] else None,
                'completed_at': row[3].isoformat() if row[3] else None,
                'planned_count': int(row[4] or 0),
                'answer_count': int(row[5] or 0),
                'right_count': int(row[6] or 0),
                'wrong_count': int(row[7] or 0),
                'total_response_ms': int(row[8] or 0),
                'avg_response_ms': float(row[9] or 0),
            })

        return jsonify({
            'kid': {
                'id': kid.get('id'),
                'name': kid.get('name'),
            },
            'sessions': sessions
        }), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@kids_bp.route('/kids/<kid_id>/report/sessions/<session_id>', methods=['GET'])
def get_kid_report_session_detail(kid_id, session_id):
    """Get detailed card-level results for one session in parent report view."""
    try:
        kid = get_kid_for_family(kid_id)
        if not kid:
            return jsonify({'error': 'Kid not found'}), 404

        try:
            session_id_int = int(session_id)
        except (TypeError, ValueError):
            return jsonify({'error': 'Invalid session id'}), 400

        conn = get_kid_connection_for(kid)
        session_row = conn.execute(
            """
            SELECT id, type, started_at, completed_at, COALESCE(planned_count, 0)
            FROM sessions
            WHERE id = ?
            """,
            [session_id_int]
        ).fetchone()
        if not session_row:
            conn.close()
            return jsonify({'error': 'Session not found'}), 404

        result_rows = conn.execute(
            """
            SELECT
                sr.id,
                sr.card_id,
                sr.correct,
                COALESCE(sr.response_time_ms, 0) AS response_time_ms,
                sr.timestamp,
                c.front,
                c.back,
                lra.file_name,
                lra.mime_type
            FROM session_results sr
            LEFT JOIN cards c ON c.id = sr.card_id
            LEFT JOIN lesson_reading_audio lra ON lra.result_id = sr.id
            WHERE sr.session_id = ?
            ORDER BY sr.id ASC
            """,
            [session_id_int]
        ).fetchall()
        conn.close()

        answers = []
        right_cards = []
        wrong_cards = []
        for row in result_rows:
            item = {
                'result_id': int(row[0]),
                'card_id': int(row[1]) if row[1] is not None else None,
                'correct_score': int(row[2] or 0),
                'correct': int(row[2] or 0) > 0,
                'response_time_ms': int(row[3] or 0),
                'timestamp': row[4].isoformat() if row[4] else None,
                'front': row[5] or '',
                'back': row[6] or '',
                'grade_status': ('pass' if int(row[2] or 0) > 0 else ('fail' if int(row[2] or 0) < 0 else 'unknown')),
                'audio_file_name': row[7] or None,
                'audio_mime_type': row[8] or None,
                'audio_url': f"/api/kids/{kid_id}/lesson-reading/audio/{row[7]}" if row[7] else None,
            }
            answers.append(item)
            if item['correct_score'] > 0:
                right_cards.append(item)
            elif item['correct_score'] < 0:
                wrong_cards.append(item)

        return jsonify({
            'kid': {
                'id': kid.get('id'),
                'name': kid.get('name'),
            },
            'session': {
                'id': int(session_row[0]),
                'type': session_row[1],
                'started_at': session_row[2].isoformat() if session_row[2] else None,
                'completed_at': session_row[3].isoformat() if session_row[3] else None,
                'planned_count': int(session_row[4] or 0),
                'answer_count': len(answers),
                'right_count': len(right_cards),
                'wrong_count': len(wrong_cards),
            },
            'right_cards': right_cards,
            'wrong_cards': wrong_cards,
            'answers': answers,
        }), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@kids_bp.route('/kids/<kid_id>/report/lesson-reading/next-to-grade', methods=['GET'])
def get_kid_lesson_reading_next_to_grade(kid_id):
    """Return the latest Chinese Reading session that still has ungraded cards."""
    try:
        kid = get_kid_for_family(kid_id)
        if not kid:
            return jsonify({'error': 'Kid not found'}), 404

        conn = get_kid_connection_for(kid)

        ungraded_row = conn.execute(
            """
            SELECT s.id
            FROM sessions s
            JOIN session_results sr ON sr.session_id = s.id
            WHERE s.type = 'lesson_reading'
              AND s.completed_at IS NOT NULL
              AND sr.correct = 0
            GROUP BY s.id, s.completed_at
            ORDER BY s.completed_at DESC, s.id DESC
            LIMIT 1
            """
        ).fetchone()

        latest_row = conn.execute(
            """
            SELECT s.id
            FROM sessions s
            WHERE s.type = 'lesson_reading'
              AND s.completed_at IS NOT NULL
            ORDER BY s.completed_at DESC, s.id DESC
            LIMIT 1
            """
        ).fetchone()
        conn.close()

        return jsonify({
            'session_id': int(ungraded_row[0]) if ungraded_row else None,
            'latest_session_id': int(latest_row[0]) if latest_row else None,
            'has_ungraded': bool(ungraded_row),
        }), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@kids_bp.route('/kids/<kid_id>/report/cards/<card_id>', methods=['GET'])
def get_kid_report_card_detail(kid_id, card_id):
    """Get full practice history for one card in parent report view."""
    try:
        kid = get_kid_for_family(kid_id)
        if not kid:
            return jsonify({'error': 'Kid not found'}), 404

        try:
            card_id_int = int(card_id)
        except (TypeError, ValueError):
            return jsonify({'error': 'Invalid card id'}), 400

        conn = get_kid_connection_for(kid)
        card_row = conn.execute(
            """
            SELECT
                c.id,
                c.front,
                c.back,
                c.created_at,
                COALESCE(c.hardness_score, 0) AS hardness_score,
                d.id,
                d.name
            FROM cards c
            JOIN decks d ON d.id = c.deck_id
            WHERE c.id = ?
            """,
            [card_id_int]
        ).fetchone()
        if not card_row:
            conn.close()
            return jsonify({'error': 'Card not found'}), 404

        attempts_rows = conn.execute(
            """
            SELECT
                sr.id,
                sr.correct,
                COALESCE(sr.response_time_ms, 0) AS response_time_ms,
                sr.timestamp,
                s.id AS session_id,
                s.type AS session_type,
                s.started_at,
                s.completed_at,
                lra.file_name,
                lra.mime_type
            FROM session_results sr
            JOIN sessions s ON s.id = sr.session_id
            LEFT JOIN lesson_reading_audio lra ON lra.result_id = sr.id
            WHERE sr.card_id = ?
            ORDER BY COALESCE(s.completed_at, s.started_at, sr.timestamp) ASC, sr.id ASC
            """,
            [card_id_int]
        ).fetchall()
        conn.close()

        attempts = []
        right_count = 0
        wrong_count = 0
        response_sum_ms = 0
        for row in attempts_rows:
            is_correct = int(row[1] or 0) > 0
            response_ms = int(row[2] or 0)
            attempts.append({
                'result_id': int(row[0]),
                'correct': is_correct,
                'response_time_ms': response_ms,
                'timestamp': row[3].isoformat() if row[3] else None,
                'session_id': int(row[4]) if row[4] is not None else None,
                'session_type': row[5],
                'session_started_at': row[6].isoformat() if row[6] else None,
                'session_completed_at': row[7].isoformat() if row[7] else None,
                'audio_file_name': row[8] or None,
                'audio_mime_type': row[9] or None,
                'audio_url': f"/api/kids/{kid_id}/lesson-reading/audio/{row[8]}" if row[8] else None,
            })
            response_sum_ms += response_ms
            if is_correct:
                right_count += 1
            else:
                wrong_count += 1

        attempts_count = len(attempts)
        avg_response_ms = (response_sum_ms / attempts_count) if attempts_count > 0 else 0
        accuracy_pct = ((right_count * 100.0) / attempts_count) if attempts_count > 0 else 0

        return jsonify({
            'kid': {
                'id': kid.get('id'),
                'name': kid.get('name'),
            },
            'card': {
                'id': int(card_row[0]),
                'front': card_row[1] or '',
                'back': card_row[2] or '',
                'created_at': card_row[3].isoformat() if card_row[3] else None,
                'hardness_score': float(card_row[4] or 0),
                'deck_id': int(card_row[5]) if card_row[5] is not None else None,
                'deck_name': card_row[6] or '',
            },
            'summary': {
                'attempt_count': attempts_count,
                'right_count': right_count,
                'wrong_count': wrong_count,
                'accuracy_pct': accuracy_pct,
                'avg_response_ms': avg_response_ms,
            },
            'attempts': attempts,
        }), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@kids_bp.route('/kids/<kid_id>/report/sessions/<session_id>/results/<result_id>/grade', methods=['PUT'])
def grade_kid_report_session_result(kid_id, session_id, result_id):
    """Persist parent pass/fail grade for one session result row."""
    try:
        kid = get_kid_for_family(kid_id)
        if not kid:
            return jsonify({'error': 'Kid not found'}), 404

        try:
            session_id_int = int(session_id)
            result_id_int = int(result_id)
        except (TypeError, ValueError):
            return jsonify({'error': 'Invalid session id or result id'}), 400

        data = request.get_json() or {}
        review_grade_raw = str(data.get('reviewGrade') or '').strip().lower()
        if review_grade_raw not in ('pass', 'fail'):
            return jsonify({'error': 'reviewGrade must be "pass" or "fail"'}), 400

        conn = get_kid_connection_for(kid)
        target = conn.execute(
            """
            SELECT sr.id, sr.correct
            FROM session_results sr
            JOIN sessions s ON s.id = sr.session_id
            WHERE sr.id = ? AND sr.session_id = ?
              AND s.type = 'lesson_reading'
            LIMIT 1
            """,
            [result_id_int, session_id_int]
        ).fetchone()
        if not target:
            conn.close()
            return jsonify({'error': 'Session result not found'}), 404

        current_correct = int(target[1] or 0)
        if current_correct != 0:
            status = 'pass' if current_correct > 0 else 'fail'
            conn.close()
            return jsonify({
                'error': 'This card has already been graded and cannot be changed.',
                'result_id': result_id_int,
                'grade_status': status,
            }), 409

        mapped_correct = 1 if review_grade_raw == 'pass' else -1
        conn.execute(
            "UPDATE session_results SET correct = ? WHERE id = ?",
            [mapped_correct, result_id_int]
        )
        conn.close()

        return jsonify({
            'result_id': result_id_int,
            'correct_score': mapped_correct,
            'grade_status': review_grade_raw,
        }), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@kids_bp.route('/kids/<kid_id>', methods=['PUT'])
def update_kid(kid_id):
    """Update a specific kid's metadata"""
    try:
        family_id = current_family_id()
        if not family_id:
            return jsonify({'error': 'Family login required'}), 401
        kid = get_kid_for_family(kid_id)
        if not kid:
            return jsonify({'error': 'Kid not found'}), 404

        data = request.get_json() or {}
        updates = {}

        if 'sessionCardCount' in data:
            try:
                session_card_count = int(data['sessionCardCount'])
            except (TypeError, ValueError):
                return jsonify({'error': 'sessionCardCount must be an integer'}), 400

            if session_card_count < 0 or session_card_count > MAX_SESSION_CARD_COUNT:
                return jsonify({'error': f'sessionCardCount must be between 0 and {MAX_SESSION_CARD_COUNT}'}), 400

            updates['sessionCardCount'] = session_card_count

        if 'writingSessionCardCount' in data:
            try:
                writing_session_card_count = int(data['writingSessionCardCount'])
            except (TypeError, ValueError):
                return jsonify({'error': 'writingSessionCardCount must be an integer'}), 400

            if writing_session_card_count < 0 or writing_session_card_count > MAX_SESSION_CARD_COUNT:
                return jsonify({'error': f'writingSessionCardCount must be between 0 and {MAX_SESSION_CARD_COUNT}'}), 400

            updates['writingSessionCardCount'] = writing_session_card_count

        if 'hardCardPercentage' in data:
            try:
                hard_pct = int(data['hardCardPercentage'])
            except (TypeError, ValueError):
                return jsonify({'error': 'hardCardPercentage must be an integer'}), 400

            if hard_pct < MIN_HARD_CARD_PERCENTAGE or hard_pct > MAX_HARD_CARD_PERCENTAGE:
                return jsonify({'error': f'hardCardPercentage must be between {MIN_HARD_CARD_PERCENTAGE} and {MAX_HARD_CARD_PERCENTAGE}'}), 400

            updates['hardCardPercentage'] = hard_pct

        for cfg in MATH_DECK_CONFIGS.values():
            field_name = cfg['kid_field']
            if field_name not in data:
                continue
            try:
                field_count = int(data[field_name])
            except (TypeError, ValueError):
                return jsonify({'error': f'{field_name} must be an integer'}), 400

            if field_count < 0 or field_count > MAX_SESSION_CARD_COUNT:
                return jsonify({'error': f'{field_name} must be between 0 and {MAX_SESSION_CARD_COUNT}'}), 400

            updates[field_name] = field_count

        for cfg in LESSON_READING_DECK_CONFIGS.values():
            field_name = cfg['kid_field']
            if field_name not in data:
                continue
            try:
                field_count = int(data[field_name])
            except (TypeError, ValueError):
                return jsonify({'error': f'{field_name} must be an integer'}), 400

            if field_count < 0 or field_count > MAX_SESSION_CARD_COUNT:
                return jsonify({'error': f'{field_name} must be between 0 and {MAX_SESSION_CARD_COUNT}'}), 400

            updates[field_name] = field_count

        if 'dailyPracticeChineseEnabled' in data:
            if not isinstance(data['dailyPracticeChineseEnabled'], bool):
                return jsonify({'error': 'dailyPracticeChineseEnabled must be a boolean'}), 400
            updates['dailyPracticeChineseEnabled'] = data['dailyPracticeChineseEnabled']

        if 'dailyPracticeMathEnabled' in data:
            if not isinstance(data['dailyPracticeMathEnabled'], bool):
                return jsonify({'error': 'dailyPracticeMathEnabled must be a boolean'}), 400
            updates['dailyPracticeMathEnabled'] = data['dailyPracticeMathEnabled']

        if 'dailyPracticeWritingEnabled' in data:
            if not isinstance(data['dailyPracticeWritingEnabled'], bool):
                return jsonify({'error': 'dailyPracticeWritingEnabled must be a boolean'}), 400
            updates['dailyPracticeWritingEnabled'] = data['dailyPracticeWritingEnabled']

        if not updates:
            return jsonify({'error': 'No supported fields to update'}), 400

        updated_kid = metadata.update_kid(kid_id, updates, family_id=family_id)
        if not updated_kid:
            return jsonify({'error': 'Kid not found'}), 404

        return jsonify(updated_kid), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@kids_bp.route('/kids/<kid_id>', methods=['DELETE'])
def delete_kid(kid_id):
    """Delete a kid and their database"""
    try:
        auth_err = require_critical_password()
        if auth_err:
            return auth_err
        family_id = current_family_id()
        if not family_id:
            return jsonify({'error': 'Family login required'}), 401
        kid = get_kid_for_family(kid_id)
        if not kid:
            return jsonify({'error': 'Kid not found'}), 404

        # Delete database file
        kid_db.delete_kid_database_by_path(kid.get('dbFilePath') or get_kid_scoped_db_relpath(kid))
        audio_dir = get_kid_writing_audio_dir(kid)
        if os.path.exists(audio_dir):
            shutil.rmtree(audio_dir, ignore_errors=True)
        lesson_audio_dir = get_kid_lesson_reading_audio_dir(kid)
        if os.path.exists(lesson_audio_dir):
            shutil.rmtree(lesson_audio_dir, ignore_errors=True)

        # Delete from metadata
        metadata.delete_kid(kid_id, family_id=family_id)

        return jsonify({'message': 'Kid deleted successfully'}), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500


# Card routes

def get_or_create_default_deck(conn):
    """Get or create the default deck for a kid"""
    result = conn.execute("SELECT id FROM decks WHERE name = 'Chinese Characters'").fetchone()

    if result:
        return result[0]

    row = conn.execute(
        """
        INSERT INTO decks (name, description, tags)
        VALUES (?, ?, ?)
        RETURNING id
        """,
        ['Chinese Characters', 'Default deck for Chinese characters', []]
    ).fetchone()

    return row[0]


def get_or_create_math_deck(conn, deck_key):
    """Get or create one fixed math deck by key."""
    config = MATH_DECK_CONFIGS.get(deck_key)
    if not config:
        raise ValueError(f'Unsupported math deck key: {deck_key}')

    result = conn.execute("SELECT id FROM decks WHERE name = ?", [config['name']]).fetchone()
    if result:
        return result[0]

    row = conn.execute(
        """
        INSERT INTO decks (name, description, tags)
        VALUES (?, ?, ?)
        RETURNING id
        """,
        [config['name'], config['description'], config['tags']]
    ).fetchone()
    return row[0]


def get_or_create_math_decks(conn):
    """Ensure all fixed math decks exist and return deck ids keyed by deck key."""
    return {
        deck_key: get_or_create_math_deck(conn, deck_key)
        for deck_key in MATH_DECK_CONFIGS.keys()
    }


def get_or_create_writing_deck(conn):
    """Get or create the default writing deck for a kid."""
    result = conn.execute("SELECT id FROM decks WHERE name = 'Chinese Character Writing'").fetchone()
    if result:
        return result[0]

    row = conn.execute(
        """
        INSERT INTO decks (name, description, tags)
        VALUES (?, ?, ?)
        RETURNING id
        """,
        ['Chinese Character Writing', 'Default deck for Chinese character writing', ['writing']]
    ).fetchone()
    return row[0]


_LESSON_READING_OLD_DECK_NAMES = {
    'ma3Unit1': 'Lesson Reading Ma3 Unit 1',
    'ma3Unit2': 'Lesson Reading Ma3 Unit 2',
    'ma3Unit3': 'Lesson Reading Ma3 Unit 3',
}


def get_or_create_lesson_reading_deck(conn, deck_key):
    """Get or create one preset lesson-reading deck by key."""
    config = LESSON_READING_DECK_CONFIGS.get(deck_key)
    if not config:
        raise ValueError(f'Unsupported lesson-reading deck key: {deck_key}')
    current_name = config['name']
    old_name = _LESSON_READING_OLD_DECK_NAMES.get(deck_key)
    current_row = conn.execute("SELECT id FROM decks WHERE name = ?", [current_name]).fetchone()
    old_row = conn.execute("SELECT id FROM decks WHERE name = ?", [old_name]).fetchone() if old_name else None

    if current_row and old_row:
        # Both exist — keep the old deck (has session history), delete duplicate new deck
        old_id = old_row[0]
        new_id = current_row[0]
        conn.execute("DELETE FROM cards WHERE deck_id = ?", [new_id])
        conn.execute("DELETE FROM practice_state_by_deck WHERE deck_id = ?", [new_id])
        conn.execute("DELETE FROM decks WHERE id = ?", [new_id])
        conn.execute(
            "UPDATE decks SET name = ?, description = ? WHERE id = ?",
            [current_name, config['description'], old_id]
        )
        return old_id

    if current_row:
        return current_row[0]

    # Check for legacy deck name and rename it instead of creating a duplicate
    if old_row:
        conn.execute(
            "UPDATE decks SET name = ?, description = ? WHERE id = ?",
            [current_name, config['description'], old_row[0]]
        )
        return old_row[0]

    row = conn.execute(
        """
        INSERT INTO decks (name, description, tags)
        VALUES (?, ?, ?)
        RETURNING id
        """,
        [config['name'], config['description'], config['tags']]
    ).fetchone()
    return row[0]


def get_or_create_lesson_reading_decks(conn):
    """Ensure lesson-reading preset decks exist and return ids keyed by deck key."""
    return {
        deck_key: get_or_create_lesson_reading_deck(conn, deck_key)
        for deck_key in LESSON_READING_DECK_CONFIGS.keys()
    }


def split_writing_bulk_text(raw_text):
    """Split bulk writing input by non-Chinese chars, preserving Chinese phrase chunks."""
    text = str(raw_text or '')
    # Match contiguous Chinese runs; separators are any non-Chinese chars.
    chunks = re.findall(r'[\u3400-\u9FFF\uF900-\uFAFF]+', text)
    deduped = []
    seen = set()
    for chunk in chunks:
        token = chunk.strip()
        if not token or token in seen:
            continue
        deduped.append(token)
        seen.add(token)
    return deduped


def get_math_pairs_for_sum_range(min_sum, max_sum):
    """Generate ordered pairs (a, b) where a+b is within [min_sum, max_sum]."""
    pairs = []
    for total in range(int(min_sum), int(max_sum) + 1):
        for a in range(0, total + 1):
            b = total - a
            pairs.append((a, b))
    return pairs


def get_math_pairs_for_minuend_range(minuend_min, minuend_max):
    """Generate ordered subtraction pairs (a, b) for minuend range with non-negative answers."""
    pairs = []
    for a in range(int(minuend_min), int(minuend_max) + 1):
        for b in range(0, a + 1):
            pairs.append((a, b))
    return pairs


def build_math_pairs_for_deck(config):
    """Build one deck's fixed ordered operand pairs from config."""
    operation = config.get('operation')
    if operation == '+':
        return get_math_pairs_for_sum_range(config['sum_min'], config['sum_max'])
    if operation == '-':
        return get_math_pairs_for_minuend_range(config['minuend_min'], config['minuend_max'])
    raise ValueError(f"Unsupported math operation in deck config: {operation}")


def seed_math_deck_cards(conn, deck_id, config):
    """Insert fixed math cards for one deck if missing."""
    existing = conn.execute(
        "SELECT front FROM cards WHERE deck_id = ?",
        [deck_id]
    ).fetchall()
    existing_fronts = {row[0] for row in existing}

    operation = config.get('operation', '+')
    new_rows = []
    for a, b in build_math_pairs_for_deck(config):
        front = f"{a} {operation} {b}"
        back = str(a + b) if operation == '+' else str(a - b)
        if front in existing_fronts:
            continue
        new_rows.append((deck_id, front, back))
        existing_fronts.add(front)

    if new_rows:
        conn.executemany(
            "INSERT INTO cards (deck_id, front, back) VALUES (?, ?, ?)",
            new_rows
        )

    total = conn.execute(
        "SELECT COUNT(*) FROM cards WHERE deck_id = ?",
        [deck_id]
    ).fetchone()[0]

    return {'inserted': len(new_rows), 'total': int(total)}


def seed_all_math_decks(conn):
    """Ensure fixed cards exist for all math decks."""
    deck_ids = get_or_create_math_decks(conn)
    results = {}
    for deck_key, deck_id in deck_ids.items():
        cfg = MATH_DECK_CONFIGS[deck_key]
        seeded = seed_math_deck_cards(conn, deck_id, cfg)
        results[deck_key] = {'deck_id': deck_id, **seeded}
    return results


def seed_math_decks_for_all_kids():
    """Ensure full fixed math decks are initialized for every kid at startup."""
    seeded_kids = 0
    total_inserted = 0
    failed_kids = 0

    for kid in metadata.get_all_kids():
        try:
            conn = get_kid_connection_for(kid)
            seed_results = seed_all_math_decks(conn)
            conn.close()
            seeded_kids += 1
            total_inserted += sum(int((item or {}).get('inserted', 0)) for item in seed_results.values())
        except Exception:
            failed_kids += 1

    return {
        'seededKids': seeded_kids,
        'failedKids': failed_kids,
        'insertedCards': total_inserted
    }


def seed_lesson_reading_deck_cards(conn, deck_id, config):
    """Insert preset lesson-reading cards for one deck if missing."""
    existing_rows = conn.execute(
        "SELECT id, front, back FROM cards WHERE deck_id = ?",
        [deck_id]
    ).fetchall()

    # Fast path for fresh DBs: batch-insert all cards at once, skip reconciliation.
    if len(existing_rows) == 0:
        new_rows = []
        for title, page in config.get('cards', []):
            front = str(title or '').strip()
            back = str(page or '').strip()
            if front and back:
                new_rows.append((deck_id, front, back))
        if new_rows:
            conn.executemany(
                "INSERT INTO cards (deck_id, front, back) VALUES (?, ?, ?)",
                new_rows
            )
        return {
            'inserted': len(new_rows), 'updated': 0, 'swapped': 0,
            'removed': 0, 'deduped': 0, 'total': len(new_rows)
        }

    # Existing DB: full reconciliation (swap detection, dedup, rename matching).
    removed = 0
    for front, back in LESSON_READING_REMOVED_CARDS:
        removed += conn.execute(
            """
            DELETE FROM cards
            WHERE deck_id = ? AND front = ? AND back = ?
            """,
            [deck_id, front, back]
        ).rowcount

    if removed > 0:
        existing_rows = conn.execute(
            "SELECT id, front, back FROM cards WHERE deck_id = ?",
            [deck_id]
        ).fetchall()
    desired_front_by_back = {}
    desired_back_by_front = {}
    for title, page in config.get('cards', []):
        front = str(title or '').strip()
        back = str(page or '').strip()
        if front and back:
            desired_front_by_back[back] = front
            desired_back_by_front[front] = back

    swapped = 0

    def _is_page_value(text):
        return bool(re.fullmatch(r'\d+', str(text or '').strip()))

    def _looks_like_lesson_title(text):
        value = str(text or '').strip()
        if not value:
            return False
        # Typical preset titles include week + 《title》, but tolerate variants.
        return ('《' in value and '》' in value) or ('周' in value) or (not _is_page_value(value))

    for row in existing_rows:
        card_id = int(row[0])
        front = str(row[1] or '').strip()
        back = str(row[2] or '').strip()
        # Auto-fix legacy rows where title/page were accidentally stored reversed.
        should_swap_by_mapping = front in desired_front_by_back and desired_back_by_front.get(back) == front
        should_swap_by_shape = _is_page_value(front) and _looks_like_lesson_title(back)
        if should_swap_by_mapping or should_swap_by_shape:
            conn.execute(
                "UPDATE cards SET front = ?, back = ? WHERE id = ?",
                [back, front, card_id]
            )
            swapped += 1

    if swapped > 0:
        existing_rows = conn.execute(
            "SELECT id, front, back FROM cards WHERE deck_id = ?",
            [deck_id]
        ).fetchall()

    updated = 0
    deduped = 0
    # Reconcile by front title first: keep one row per title, enforce desired page.
    rows_by_front = {}
    for row in existing_rows:
        card_id = int(row[0])
        front = str(row[1] or '').strip()
        back = str(row[2] or '').strip()
        if front not in rows_by_front:
            rows_by_front[front] = []
        rows_by_front[front].append((card_id, back))

    for desired_front, desired_back in desired_back_by_front.items():
        candidates = rows_by_front.get(desired_front, [])
        if len(candidates) == 0:
            continue

        keep_id = None
        for card_id, back in candidates:
            if back == desired_back:
                keep_id = card_id
                break
        if keep_id is None:
            keep_id = candidates[0][0]
            conn.execute(
                "UPDATE cards SET back = ? WHERE id = ?",
                [desired_back, keep_id]
            )
            updated += 1

        for card_id, _ in candidates:
            if card_id == keep_id:
                continue
            conn.execute("DELETE FROM cards WHERE id = ?", [card_id])
            deduped += 1

    if updated > 0 or deduped > 0:
        existing_rows = conn.execute(
            "SELECT id, front, back FROM cards WHERE deck_id = ?",
            [deck_id]
        ).fetchall()

    existing_keys = set()
    existing_back_to_id = {}
    for row in existing_rows:
        card_id = int(row[0])
        front = str(row[1] or '')
        back = str(row[2] or '')
        existing_keys.add((front, back))
        if back:
            existing_back_to_id[back] = card_id

    for back, desired_front in desired_front_by_back.items():
        card_id = existing_back_to_id.get(back)
        if not card_id:
            continue
        current_front_row = conn.execute(
            "SELECT front FROM cards WHERE id = ?",
            [card_id]
        ).fetchone()
        current_front = str((current_front_row[0] if current_front_row else '') or '')
        if current_front == desired_front:
            continue
        conn.execute(
            "UPDATE cards SET front = ? WHERE id = ?",
            [desired_front, card_id]
        )
        updated += 1
        existing_keys.discard((current_front, back))
        existing_keys.add((desired_front, back))

    inserted = 0
    for title, page in config.get('cards', []):
        front = str(title or '').strip()
        back = str(page or '').strip()
        if not front or not back:
            continue
        key = (front, back)
        if key in existing_keys:
            continue
        conn.execute(
            """
            INSERT INTO cards (deck_id, front, back)
            VALUES (?, ?, ?)
            """,
            [deck_id, front, back]
        )
        inserted += 1
        existing_keys.add(key)

    total = conn.execute(
        "SELECT COUNT(*) FROM cards WHERE deck_id = ?",
        [deck_id]
    ).fetchone()[0]
    return {
        'inserted': inserted,
        'updated': int(updated),
        'swapped': int(swapped),
        'removed': int(removed),
        'deduped': int(deduped),
        'total': int(total)
    }


def seed_all_lesson_reading_decks(conn):
    """Ensure preset lesson-reading cards exist for all lesson-reading decks."""
    deck_ids = get_or_create_lesson_reading_decks(conn)
    results = {}
    for deck_key, deck_id in deck_ids.items():
        cfg = LESSON_READING_DECK_CONFIGS[deck_key]
        seeded = seed_lesson_reading_deck_cards(conn, deck_id, cfg)
        results[deck_key] = {'deck_id': deck_id, **seeded}
    return results


def seed_lesson_reading_decks_for_all_kids():
    """Ensure lesson-reading preset decks are initialized for every kid at startup."""
    seeded_kids = 0
    total_inserted = 0
    failed_kids = 0

    for kid in metadata.get_all_kids():
        try:
            conn = get_kid_connection_for(kid)
            seed_results = seed_all_lesson_reading_decks(conn)
            conn.close()
            seeded_kids += 1
            total_inserted += sum(int((item or {}).get('inserted', 0)) for item in seed_results.values())
        except Exception:
            failed_kids += 1

    return {
        'seededKids': seeded_kids,
        'failedKids': failed_kids,
        'insertedCards': total_inserted
    }


def cleanup_incomplete_sessions_for_all_kids():
    """Delete incomplete sessions (completed_at IS NULL) across all kid DBs at startup."""
    cleaned_kids = 0
    failed_kids = 0
    deleted_sessions = 0
    deleted_results = 0
    deleted_lesson_audio = 0

    for kid in metadata.get_all_kids():
        conn = None
        try:
            conn = get_kid_connection_for(kid)
            incomplete_ids = [
                int(row[0]) for row in conn.execute(
                    "SELECT id FROM sessions WHERE completed_at IS NULL"
                ).fetchall()
            ]
            if len(incomplete_ids) == 0:
                cleaned_kids += 1
                conn.close()
                conn = None
                continue

            placeholders = ','.join(['?'] * len(incomplete_ids))
            removed_lesson_audio = conn.execute(
                f"""
                DELETE FROM lesson_reading_audio
                WHERE result_id IN (
                    SELECT id FROM session_results WHERE session_id IN ({placeholders})
                )
                RETURNING result_id
                """,
                incomplete_ids
            ).fetchall()
            removed_results = conn.execute(
                f"DELETE FROM session_results WHERE session_id IN ({placeholders}) RETURNING id",
                incomplete_ids
            ).fetchall()
            removed_sessions = conn.execute(
                f"DELETE FROM sessions WHERE id IN ({placeholders}) RETURNING id",
                incomplete_ids
            ).fetchall()

            deleted_lesson_audio += len(removed_lesson_audio)
            deleted_results += len(removed_results)
            deleted_sessions += len(removed_sessions)
            cleaned_kids += 1
            conn.close()
            conn = None
        except Exception:
            failed_kids += 1
            if conn is not None:
                try:
                    conn.close()
                except Exception:
                    pass

    return {
        'cleanedKids': cleaned_kids,
        'failedKids': failed_kids,
        'deletedSessions': deleted_sessions,
        'deletedResults': deleted_results,
        'deletedLessonReadingAudio': deleted_lesson_audio,
    }


def ensure_practice_state(conn, deck_id):
    """Ensure cursor state row exists for a deck."""
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

    # Normalize cursor if cards were deleted
    total = conn.execute(
        "SELECT COUNT(*) FROM cards WHERE deck_id = ?",
        [deck_id]
    ).fetchone()[0]
    if total == 0:
        conn.execute(
            "UPDATE practice_state_by_deck SET queue_cursor = 0 WHERE deck_id = ?",
            [deck_id]
        )
        return

    cursor_row = conn.execute(
        "SELECT queue_cursor FROM practice_state_by_deck WHERE deck_id = ?",
        [deck_id]
    ).fetchone()
    cursor = int(cursor_row[0]) if cursor_row else 0
    normalized = cursor % int(total)
    if normalized != cursor:
        conn.execute(
            "UPDATE practice_state_by_deck SET queue_cursor = ? WHERE deck_id = ?",
            [normalized, deck_id]
        )


def get_session_red_cards(conn, session_id):
    """Get red cards from a specific session."""
    if not session_id:
        return []

    rows = conn.execute(
        """
        SELECT card_id
        FROM session_results
        WHERE session_id = ? AND correct < 0 AND card_id IS NOT NULL
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


def _cleanup_expired_pending_sessions():
    now = time.time()
    expired_keys = [
        key for key, payload in _PENDING_SESSIONS.items()
        if now - float(payload.get('created_at_ts', 0)) > PENDING_SESSION_TTL_SECONDS
    ]
    for key in expired_keys:
        payload = _PENDING_SESSIONS.pop(key, None)
        if not payload:
            continue
        if str(payload.get('session_type')) != 'lesson_reading':
            continue
        cleanup_lesson_reading_pending_audio_files_by_payload(payload)


def create_pending_session(kid_id, session_type, payload):
    """Store one in-memory pending session and return its token."""
    token = uuid.uuid4().hex
    record = {
        **(payload or {}),
        'kid_id': str(kid_id),
        'session_type': str(session_type),
        'created_at_ts': time.time(),
    }
    with _PENDING_SESSIONS_LOCK:
        _cleanup_expired_pending_sessions()
        _PENDING_SESSIONS[token] = record
    return token


def pop_pending_session(token, kid_id, session_type):
    """Pop one pending session token if it matches kid/type."""
    if not token:
        return None
    with _PENDING_SESSIONS_LOCK:
        _cleanup_expired_pending_sessions()
        payload = _PENDING_SESSIONS.pop(str(token), None)
    if not payload:
        return None
    if str(payload.get('kid_id')) != str(kid_id):
        if str(payload.get('session_type')) == 'lesson_reading':
            cleanup_lesson_reading_pending_audio_files_by_payload(payload)
        return None
    if str(payload.get('session_type')) != str(session_type):
        if str(payload.get('session_type')) == 'lesson_reading':
            cleanup_lesson_reading_pending_audio_files_by_payload(payload)
        return None
    return payload


def get_pending_session(token, kid_id, session_type):
    """Get one pending session token without removing it."""
    if not token:
        return None
    with _PENDING_SESSIONS_LOCK:
        _cleanup_expired_pending_sessions()
        payload = _PENDING_SESSIONS.get(str(token))
        if not payload:
            return None
        if str(payload.get('kid_id')) != str(kid_id):
            return None
        if str(payload.get('session_type')) != str(session_type):
            return None
        return payload


def parse_client_started_at(raw_started_at, pending=None):
    """Parse client-provided session start time into naive UTC datetime."""
    dt = None

    if isinstance(raw_started_at, (int, float)):
        try:
            dt = datetime.fromtimestamp(float(raw_started_at) / 1000.0, tz=timezone.utc)
        except Exception:
            dt = None
    elif isinstance(raw_started_at, str):
        text = raw_started_at.strip()
        if text:
            try:
                if re.fullmatch(r'\d+(\.\d+)?', text):
                    dt = datetime.fromtimestamp(float(text) / 1000.0, tz=timezone.utc)
                else:
                    normalized = text.replace('Z', '+00:00')
                    parsed = datetime.fromisoformat(normalized)
                    if parsed.tzinfo is None:
                        dt = parsed.replace(tzinfo=timezone.utc)
                    else:
                        dt = parsed.astimezone(timezone.utc)
            except Exception:
                dt = None

    if dt is None and isinstance(pending, dict):
        created_at_ts = pending.get('created_at_ts')
        try:
            if created_at_ts is not None:
                dt = datetime.fromtimestamp(float(created_at_ts), tz=timezone.utc)
        except Exception:
            dt = None

    if dt is None:
        dt = datetime.now(timezone.utc)

    return dt.replace(tzinfo=None)


def plan_deck_pending_session(conn, kid, kid_id, deck_id, session_type, excluded_card_ids=None, enforce_exact_target=False):
    """Plan one pending deck session without mutating DB state."""
    cards_by_id, selected_ids, queue_ids, cursor, queue_used = plan_deck_practice_selection(
        conn,
        kid,
        deck_id,
        session_type,
        excluded_card_ids=excluded_card_ids,
        enforce_exact_target=enforce_exact_target,
    )
    if len(selected_ids) == 0:
        return None, []

    next_cursor = (cursor + queue_used) % len(queue_ids)
    pending_token = create_pending_session(
        kid_id,
        session_type,
        {
            'kind': 'deck',
            'deck_id': int(deck_id),
            'planned_count': len(selected_ids),
            'next_cursor': int(next_cursor),
        }
    )
    selected_cards = [cards_by_id[card_id] for card_id in selected_ids]
    return pending_token, selected_cards


def preview_deck_practice_order(conn, kid, deck_id, session_type, excluded_card_ids=None, enforce_exact_target=False):
    """Preview exact next session card order without mutating cursor/session."""
    _, selected_ids, _, _, _ = plan_deck_practice_selection(
        conn,
        kid,
        deck_id,
        session_type,
        excluded_card_ids=excluded_card_ids,
        enforce_exact_target=enforce_exact_target,
    )
    return selected_ids


def plan_deck_practice_selection(conn, kid, deck_id, session_type, excluded_card_ids=None, enforce_exact_target=False):
    """Build deterministic card selection order used by session start/preview."""
    ensure_practice_state(conn, deck_id)
    excluded_set = set(excluded_card_ids or [])

    cards = conn.execute(
        """
        SELECT id, front, back, created_at
        FROM cards
        WHERE deck_id = ? AND COALESCE(skip_practice, FALSE) = FALSE
        ORDER BY id ASC
        """,
        [deck_id]
    ).fetchall()

    if len(cards) == 0:
        return {}, [], [], 0, 0

    cards_by_id = {
        row[0]: {
            'id': row[0],
            'front': row[1],
            'back': row[2],
            'created_at': row[3].isoformat() if row[3] else None
        }
        for row in cards
        if row[0] not in excluded_set
    }
    queue_ids = [row[0] for row in cards if row[0] not in excluded_set]

    if len(queue_ids) == 0:
        return {}, [], [], 0, 0

    base_target_count = min(normalize_session_card_count(kid), len(queue_ids))
    if base_target_count <= 0:
        return cards_by_id, [], queue_ids, 0, 0
    last_session_id, last_completed_at = get_last_completed_session(conn, session_type)
    red_card_ids = []
    if last_session_id:
        red_card_ids = [card_id for card_id in get_session_red_cards(conn, last_session_id) if card_id in cards_by_id]

    new_card_ids = []
    if last_completed_at is not None:
        new_rows = conn.execute(
            """
            SELECT id
            FROM cards
            WHERE deck_id = ? AND COALESCE(skip_practice, FALSE) = FALSE AND created_at > ?
            ORDER BY id ASC
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

    if enforce_exact_target:
        target_count = min(len(queue_ids), base_target_count)
    else:
        target_count = min(len(queue_ids), max(base_target_count, len(selected_ids)))

    if len(selected_ids) > target_count:
        selected_ids = selected_ids[:target_count]
        selected_set = set(selected_ids)

    remaining_slots = max(0, target_count - len(selected_ids))
    hard_pct = normalize_hard_card_percentage(kid)
    hard_target = min(remaining_slots, int((remaining_slots * hard_pct) / 100))

    if hard_target > 0:
        placeholders = ','.join(['?'] * len(queue_ids))
        hard_rows = conn.execute(
            f"""
            SELECT id, hardness_score
            FROM cards
            WHERE id IN ({placeholders})
            ORDER BY hardness_score DESC, id ASC
            """,
            queue_ids
        ).fetchall()

        for row in hard_rows:
            if len(selected_ids) >= target_count:
                break
            if hard_target <= 0:
                break
            card_id = row[0]
            if card_id in selected_set:
                continue
            selected_ids.append(card_id)
            selected_set.add(card_id)
            hard_target -= 1

    cursor_row = conn.execute(
        "SELECT queue_cursor FROM practice_state_by_deck WHERE deck_id = ?",
        [deck_id]
    ).fetchone()
    cursor = int(cursor_row[0]) % len(queue_ids) if cursor_row else 0
    queue_used = 0

    offset = 0
    while len(selected_ids) < target_count and offset < len(queue_ids):
        card_id = queue_ids[(cursor + offset) % len(queue_ids)]
        if card_id not in selected_set:
            selected_ids.append(card_id)
            selected_set.add(card_id)
            queue_used += 1
        offset += 1

    return cards_by_id, selected_ids, queue_ids, cursor, queue_used


def complete_session_internal(kid, kid_id, session_type, data):
    """Complete a session by saving all answers in one batch."""
    pending_session_id = data.get('pendingSessionId')
    if not pending_session_id:
        return {'error': 'pendingSessionId is required'}, 400
    answers = data.get('answers')
    if not isinstance(answers, list) or len(answers) == 0:
        return {'error': 'answers must be a non-empty list'}, 400

    pending = pop_pending_session(pending_session_id, kid_id, session_type)
    if not pending:
        return {'error': 'Pending session not found or expired'}, 404
    started_at_utc = parse_client_started_at(data.get('startedAt'), pending)
    completed_at_utc = datetime.now(timezone.utc).replace(tzinfo=None)

    conn = get_kid_connection_for(kid)
    deck_id = pending.get('deck_id') if pending.get('kind') == 'deck' else None
    planned_count = int(pending.get('planned_count') or 0)
    uploaded_lesson_audio = data.get('_uploaded_lesson_audio_by_card') if session_type == 'lesson_reading' else {}
    if not isinstance(uploaded_lesson_audio, dict):
        uploaded_lesson_audio = {}
    pending_lesson_audio = pending.get('lesson_audio_by_card') if session_type == 'lesson_reading' else {}
    if not isinstance(pending_lesson_audio, dict):
        pending_lesson_audio = {}
    written_lesson_audio_paths = []

    # Validate answers before starting transaction
    for answer in answers:
        card_id = answer.get('cardId')
        known = answer.get('known')
        if not card_id or not isinstance(known, bool):
            conn.close()
            if session_type == 'lesson_reading':
                cleanup_lesson_reading_pending_audio_files(kid, pending)
            return {'error': 'Each answer needs cardId (int) and known (bool)'}, 400

    try:
        conn.execute("BEGIN TRANSACTION")

        session_id = conn.execute(
            """
            INSERT INTO sessions (type, deck_id, planned_count, started_at, completed_at)
            VALUES (?, ?, ?, ?, ?)
            RETURNING id
            """,
            [session_type, deck_id, planned_count, started_at_utc, completed_at_utc]
        ).fetchone()[0]

        latest_response_by_card = {}
        touched_card_ids = set()
        consumed_lesson_audio_files = set()
        for answer in answers:
            card_id = answer.get('cardId')
            known = answer.get('known')
            try:
                response_time_ms = int(answer.get('responseTimeMs'))
            except (TypeError, ValueError):
                response_time_ms = 0
            if session_type == 'lesson_reading':
                correct_value = 0
            else:
                correct_value = 1 if bool(known) else -1

            result_row = conn.execute(
                """
                INSERT INTO session_results (session_id, card_id, correct, response_time_ms)
                VALUES (?, ?, ?, ?)
                RETURNING id
                """,
                [session_id, card_id, correct_value, response_time_ms]
            ).fetchone()
            result_id = int(result_row[0])
            latest_response_by_card[card_id] = response_time_ms
            touched_card_ids.add(card_id)

            if session_type == 'lesson_reading':
                uploaded_audio = uploaded_lesson_audio.get(card_id)
                if uploaded_audio is None:
                    uploaded_audio = uploaded_lesson_audio.get(str(card_id))
                if isinstance(uploaded_audio, dict):
                    audio_bytes = uploaded_audio.get('bytes')
                    if not isinstance(audio_bytes, (bytes, bytearray)) or len(audio_bytes) == 0:
                        raise ValueError(f'Uploaded audio for card {card_id} is empty')
                    mime_type = str(uploaded_audio.get('mime_type') or 'application/octet-stream').strip()
                    original_filename = str(uploaded_audio.get('filename') or '').strip()
                    safe_name = secure_filename(original_filename)
                    ext = os.path.splitext(safe_name)[1].lower()
                    if not ext:
                        guessed_ext = mimetypes.guess_extension(mime_type) or ''
                        ext = guessed_ext.lower() if guessed_ext else '.webm'
                    audio_dir = ensure_lesson_reading_audio_dir(kid)
                    file_name = f"lr_{pending_session_id}_{card_id}_{uuid.uuid4().hex}{ext}"
                    file_path = os.path.join(audio_dir, file_name)
                    with open(file_path, 'wb') as f:
                        f.write(bytes(audio_bytes))
                    written_lesson_audio_paths.append(file_path)
                    conn.execute(
                        """
                        INSERT INTO lesson_reading_audio (result_id, file_name, mime_type)
                        VALUES (?, ?, ?)
                        """,
                        [result_id, file_name, mime_type]
                    )
                    consumed_lesson_audio_files.add(file_name)
                else:
                    audio_meta = pending_lesson_audio.get(str(card_id))
                    if isinstance(audio_meta, dict):
                        file_name = str(audio_meta.get('file_name') or '').strip()
                        mime_type = str(audio_meta.get('mime_type') or 'application/octet-stream').strip()
                        if file_name:
                            conn.execute(
                                """
                                INSERT INTO lesson_reading_audio (result_id, file_name, mime_type)
                                VALUES (?, ?, ?)
                                """,
                                [result_id, file_name, mime_type]
                            )
                            consumed_lesson_audio_files.add(file_name)

        if session_type in ('flashcard', 'math', 'lesson_reading'):
            for card_id, latest_ms in latest_response_by_card.items():
                conn.execute(
                    "UPDATE cards SET hardness_score = ? WHERE id = ?",
                    [float(latest_ms or 0), card_id]
                )
        elif session_type == 'writing' and len(touched_card_ids) > 0:
            placeholders = ','.join(['?'] * len(touched_card_ids))
            conn.execute(
                f"""
                UPDATE cards
                SET hardness_score = stats.hardness_score
                FROM (
                    SELECT
                        sr.card_id,
                        COALESCE(100.0 - (100.0 * AVG(CASE WHEN sr.correct > 0 THEN 1.0 ELSE 0.0 END)), 0) AS hardness_score
                    FROM session_results sr
                    JOIN sessions s ON s.id = sr.session_id
                    WHERE s.type = 'writing'
                      AND sr.card_id IN ({placeholders})
                    GROUP BY sr.card_id
                ) AS stats
                WHERE cards.id = stats.card_id
                """,
                list(touched_card_ids)
            )

        if pending.get('kind') == 'deck':
            conn.execute(
                "UPDATE practice_state_by_deck SET queue_cursor = ? WHERE deck_id = ?",
                [int(pending.get('next_cursor') or 0), int(pending.get('deck_id'))]
            )
        elif pending.get('kind') in ('math', 'lesson_reading'):
            for item in pending.get('deck_cursor_updates', []):
                conn.execute(
                    "UPDATE practice_state_by_deck SET queue_cursor = ? WHERE deck_id = ?",
                    [int(item.get('next_cursor') or 0), int(item.get('deck_id'))]
                )

        conn.execute("COMMIT")
    except Exception:
        conn.execute("ROLLBACK")
        conn.close()
        for file_path in written_lesson_audio_paths:
            try:
                if os.path.exists(file_path):
                    os.remove(file_path)
            except Exception:
                pass
        if session_type == 'lesson_reading':
            cleanup_lesson_reading_pending_audio_files(kid, pending)
        raise

    conn.close()
    if session_type == 'lesson_reading' and isinstance(pending_lesson_audio, dict):
        leftovers = {}
        for item in pending_lesson_audio.values():
            if not isinstance(item, dict):
                continue
            file_name = str(item.get('file_name') or '').strip()
            if file_name and file_name not in consumed_lesson_audio_files:
                leftovers[file_name] = item
        if len(leftovers) > 0:
            cleanup_lesson_reading_pending_audio_files(
                kid,
                {
                    'lesson_audio_dir': pending.get('lesson_audio_dir'),
                    'lesson_audio_by_card': {name: meta for name, meta in leftovers.items()},
                }
            )
    return {
        'session_id': session_id,
        'answer_count': len(answers),
        'planned_count': planned_count,
        'completed': True
    }, 200


def delete_card_from_deck_internal(conn, deck_id, card_id):
    """Delete a card and adjust the practice cursor."""
    # Find deleted card's position in id-ordered list
    card_ids = [
        row[0] for row in conn.execute(
            "SELECT id FROM cards WHERE deck_id = ? ORDER BY id ASC",
            [deck_id]
        ).fetchall()
    ]
    cursor_row = conn.execute(
        "SELECT queue_cursor FROM practice_state_by_deck WHERE deck_id = ?",
        [deck_id]
    ).fetchone()
    cursor = int(cursor_row[0]) if cursor_row else 0

    try:
        deleted_index = card_ids.index(card_id)
    except ValueError:
        deleted_index = -1

    conn.execute("DELETE FROM cards WHERE id = ?", [card_id])

    remaining = len(card_ids) - 1
    if remaining == 0:
        conn.execute(
            "UPDATE practice_state_by_deck SET queue_cursor = 0 WHERE deck_id = ?",
            [deck_id]
        )
    else:
        if deleted_index != -1 and deleted_index < cursor:
            cursor -= 1
        conn.execute(
            "UPDATE practice_state_by_deck SET queue_cursor = ? WHERE deck_id = ?",
            [max(0, cursor) % remaining, deck_id]
        )


def get_cards_with_stats(conn, deck_id):
    """Return cards with hardness / attempt / last-seen stats."""
    return conn.execute(
        """
        SELECT
            c.id,
            c.deck_id,
            c.front,
            c.back,
            COALESCE(c.skip_practice, FALSE) AS skip_practice,
            c.hardness_score,
            c.created_at,
            COUNT(sr.id) AS lifetime_attempts,
            MAX(sr.timestamp) AS last_seen_at
        FROM cards c
        LEFT JOIN session_results sr ON c.id = sr.card_id
        WHERE c.deck_id = ?
        GROUP BY c.id, c.deck_id, c.front, c.back, c.skip_practice, c.hardness_score, c.created_at
        ORDER BY c.id ASC
        """,
        [deck_id]
    ).fetchall()


def map_card_row(row, preview_order):
    """Map raw card+stats row to API object."""
    return {
        'id': row[0],
        'deck_id': row[1],
        'front': row[2],
        'back': row[3],
        'skip_practice': bool(row[4]),
        'hardness_score': float(row[5]) if row[5] is not None else 0,
        'created_at': row[6].isoformat() if row[6] else None,
        'next_session_order': preview_order.get(row[0]),
        'lifetime_attempts': int(row[7]) if row[7] is not None else 0,
        'last_seen_at': row[8].isoformat() if row[8] else None
    }


def get_pending_writing_card_ids(conn):
    """Return card ids currently blocked by pending writing sheets."""
    rows = conn.execute(
        """
        SELECT DISTINCT wsc.card_id
        FROM writing_sheet_cards wsc
        JOIN writing_sheets ws ON ws.id = wsc.sheet_id
        WHERE ws.status = 'pending'
        """
    ).fetchall()
    return [int(row[0]) for row in rows]


def refresh_writing_hardness_scores(conn, deck_id):
    """Recompute writing hardness for one deck as 100 - lifetime correct%."""
    conn.execute(
        "UPDATE cards SET hardness_score = 0 WHERE deck_id = ?",
        [deck_id]
    )
    conn.execute(
        """
        UPDATE cards
        SET hardness_score = stats.hardness_score
        FROM (
            SELECT
                sr.card_id,
                COALESCE(100.0 - (100.0 * AVG(CASE WHEN sr.correct > 0 THEN 1.0 ELSE 0.0 END)), 0) AS hardness_score
            FROM session_results sr
            JOIN sessions s ON s.id = sr.session_id
            JOIN cards c2 ON c2.id = sr.card_id
            WHERE s.type = 'writing'
              AND c2.deck_id = ?
            GROUP BY sr.card_id
        ) AS stats
        WHERE cards.id = stats.card_id
        """,
        [deck_id]
    )


@kids_bp.route('/kids/<kid_id>/cards', methods=['GET'])
def get_cards(kid_id):
    """Get all cards for a kid in practice queue order, with timing stats."""
    try:
        kid = get_kid_for_family(kid_id)
        if not kid:
            return jsonify({'error': 'Kid not found'}), 404

        conn = get_kid_connection_for(kid)
        deck_id = get_or_create_default_deck(conn)
        preview_ids = preview_deck_practice_order(conn, kid, deck_id, 'flashcard')
        preview_order = {card_id: i + 1 for i, card_id in enumerate(preview_ids)}

        cards = get_cards_with_stats(conn, deck_id)

        conn.close()

        card_list = [map_card_row(card, preview_order) for card in cards]

        return jsonify({'deck_id': deck_id, 'cards': card_list}), 200

    except Exception as e:
        return jsonify({'error': str(e)}), 500


@kids_bp.route('/kids/<kid_id>/cards', methods=['POST'])
def add_card(kid_id):
    """Add a new card for a kid"""
    try:
        kid = get_kid_for_family(kid_id)
        if not kid:
            return jsonify({'error': 'Kid not found'}), 404

        data = request.get_json()

        if not data.get('front'):
            return jsonify({'error': 'Front text is required'}), 400

        conn = get_kid_connection_for(kid)
        deck_id = get_or_create_default_deck(conn)

        card_id = conn.execute(
            """
            INSERT INTO cards (deck_id, front, back)
            VALUES (?, ?, ?)
            RETURNING id
            """,
            [
                deck_id,
                data['front'],
                data.get('back', '')
            ]
        ).fetchone()[0]

        card = conn.execute(
            """
            SELECT id, deck_id, front, back, created_at
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
            'created_at': card[4].isoformat() if card[4] else None
        }

        return jsonify(card_obj), 201

    except Exception as e:
        return jsonify({'error': str(e)}), 500


@kids_bp.route('/kids/<kid_id>/cards/bulk', methods=['POST'])
def add_cards_bulk(kid_id):
    """Add multiple cards at once"""
    try:
        kid = get_kid_for_family(kid_id)
        if not kid:
            return jsonify({'error': 'Kid not found'}), 404

        data = request.get_json()
        items = data.get('cards', [])

        if not items:
            return jsonify({'error': 'No cards provided'}), 400

        conn = get_kid_connection_for(kid)
        deck_id = get_or_create_default_deck(conn)

        created = []
        for item in items:
            front = (item.get('front') or '').strip()
            if not front:
                continue
            card_id = conn.execute(
                "INSERT INTO cards (deck_id, front, back) VALUES (?, ?, ?) RETURNING id",
                [deck_id, front, item.get('back', '')]
            ).fetchone()[0]
            created.append({'id': card_id, 'front': front})

        conn.close()

        return jsonify({'created': len(created), 'cards': created}), 201

    except Exception as e:
        return jsonify({'error': str(e)}), 500


@kids_bp.route('/kids/<kid_id>/cards/<card_id>', methods=['DELETE'])
def delete_card(kid_id, card_id):
    """Delete a card"""
    try:
        auth_err = require_critical_password()
        if auth_err:
            return auth_err
        kid = get_kid_for_family(kid_id)
        if not kid:
            return jsonify({'error': 'Kid not found'}), 404

        conn = get_kid_connection_for(kid)

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
        kid = get_kid_for_family(kid_id)
        if not kid:
            return jsonify({'error': 'Kid not found'}), 404

        conn = get_kid_connection_for(kid)
        deck_id = get_or_create_default_deck(conn)
        pending_session_id, selected_cards = plan_deck_pending_session(
            conn, kid, kid_id, deck_id, 'flashcard'
        )

        conn.close()
        if not pending_session_id:
            return jsonify({'pending_session_id': None, 'cards': [], 'planned_count': 0}), 200

        return jsonify({
            'pending_session_id': pending_session_id,
            'cards': selected_cards,
            'planned_count': len(selected_cards)
        }), 200

    except Exception as e:
        return jsonify({'error': str(e)}), 500


@kids_bp.route('/kids/<kid_id>/math/cards', methods=['GET'])
def get_math_cards(kid_id):
    """Get fixed-deck math cards for a kid (one selected deck at a time)."""
    try:
        kid = get_kid_for_family(kid_id)
        if not kid:
            return jsonify({'error': 'Kid not found'}), 404

        requested_key = (request.args.get('deck') or 'within10').strip()
        if requested_key not in MATH_DECK_CONFIGS:
            return jsonify({'error': f'Unsupported math deck: {requested_key}'}), 400

        conn = get_kid_connection_for(kid)
        deck_ids = get_or_create_math_decks(conn)
        deck_id = deck_ids[requested_key]

        requested_count = normalize_math_deck_session_count(kid, requested_key)
        preview_kid = {**kid, 'sessionCardCount': requested_count}
        preview_ids = preview_deck_practice_order(
            conn,
            preview_kid,
            deck_id,
            'math',
            enforce_exact_target=True
        )
        preview_order = {card_id: i + 1 for i, card_id in enumerate(preview_ids)}

        cards = get_cards_with_stats(conn, deck_id)
        active_count = int(conn.execute(
            "SELECT COUNT(*) FROM cards WHERE deck_id = ? AND COALESCE(skip_practice, FALSE) = FALSE",
            [deck_id]
        ).fetchone()[0] or 0)
        skipped_count = int(conn.execute(
            "SELECT COUNT(*) FROM cards WHERE deck_id = ? AND COALESCE(skip_practice, FALSE) = TRUE",
            [deck_id]
        ).fetchone()[0] or 0)

        conn.close()

        return jsonify({
            'deck_key': requested_key,
            'deck_label': MATH_DECK_CONFIGS[requested_key]['label'],
            'deck_id': deck_id,
            'session_count': requested_count,
            'active_card_count': active_count,
            'skipped_card_count': skipped_count,
            'cards': [map_card_row(row, preview_order) for row in cards]
        }), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@kids_bp.route('/kids/<kid_id>/math/decks', methods=['GET'])
def get_math_decks(kid_id):
    """Get fixed math deck metadata and configured per-session counts."""
    try:
        kid = get_kid_for_family(kid_id)
        if not kid:
            return jsonify({'error': 'Kid not found'}), 404

        conn = get_kid_connection_for(kid)
        deck_ids = get_or_create_math_decks(conn)

        decks = []
        total_session_count = 0
        for deck_key, cfg in MATH_DECK_CONFIGS.items():
            deck_id = deck_ids[deck_key]
            total_cards = int(conn.execute(
                "SELECT COUNT(*) FROM cards WHERE deck_id = ? AND COALESCE(skip_practice, FALSE) = FALSE",
                [deck_id]
            ).fetchone()[0] or 0)
            session_count = normalize_math_deck_session_count(kid, deck_key)
            total_session_count += session_count
            decks.append({
                'key': deck_key,
                'label': cfg['label'],
                'deck_id': deck_id,
                'total_cards': total_cards,
                'session_count': session_count
            })

        conn.close()
        return jsonify({
            'decks': decks,
            'total_session_count': total_session_count
        }), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@kids_bp.route('/kids/<kid_id>/lesson-reading/cards', methods=['GET'])
def get_lesson_reading_cards(kid_id):
    """Get preset lesson-reading cards for a kid (one selected deck at a time)."""
    try:
        kid = get_kid_for_family(kid_id)
        if not kid:
            return jsonify({'error': 'Kid not found'}), 404

        requested_key = (request.args.get('deck') or 'ma3Unit1').strip()
        if requested_key not in LESSON_READING_DECK_CONFIGS:
            return jsonify({'error': f'Unsupported lesson-reading deck: {requested_key}'}), 400

        conn = get_kid_connection_for(kid)
        deck_ids = get_or_create_lesson_reading_decks(conn)
        deck_id = deck_ids[requested_key]

        requested_count = normalize_lesson_reading_deck_session_count(kid, requested_key)
        preview_kid = {**kid, 'sessionCardCount': requested_count}
        preview_ids = preview_deck_practice_order(
            conn,
            preview_kid,
            deck_id,
            'lesson_reading',
            enforce_exact_target=True
        )
        preview_order = {card_id: i + 1 for i, card_id in enumerate(preview_ids)}

        cards = get_cards_with_stats(conn, deck_id)
        active_count = int(conn.execute(
            "SELECT COUNT(*) FROM cards WHERE deck_id = ? AND COALESCE(skip_practice, FALSE) = FALSE",
            [deck_id]
        ).fetchone()[0] or 0)
        skipped_count = int(conn.execute(
            "SELECT COUNT(*) FROM cards WHERE deck_id = ? AND COALESCE(skip_practice, FALSE) = TRUE",
            [deck_id]
        ).fetchone()[0] or 0)
        conn.close()

        return jsonify({
            'deck_key': requested_key,
            'deck_label': LESSON_READING_DECK_CONFIGS[requested_key]['label'],
            'deck_id': deck_id,
            'session_count': requested_count,
            'active_card_count': active_count,
            'skipped_card_count': skipped_count,
            'cards': [map_card_row(row, preview_order) for row in cards]
        }), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@kids_bp.route('/kids/<kid_id>/lesson-reading/decks', methods=['GET'])
def get_lesson_reading_decks(kid_id):
    """Get preset lesson-reading deck metadata and configured per-session counts."""
    try:
        kid = get_kid_for_family(kid_id)
        if not kid:
            return jsonify({'error': 'Kid not found'}), 404

        conn = get_kid_connection_for(kid)
        deck_ids = get_or_create_lesson_reading_decks(conn)

        decks = []
        total_session_count = 0
        for deck_key, cfg in LESSON_READING_DECK_CONFIGS.items():
            deck_id = deck_ids[deck_key]
            total_cards = int(conn.execute(
                "SELECT COUNT(*) FROM cards WHERE deck_id = ? AND COALESCE(skip_practice, FALSE) = FALSE",
                [deck_id]
            ).fetchone()[0] or 0)
            session_count = normalize_lesson_reading_deck_session_count(kid, deck_key)
            total_session_count += session_count
            decks.append({
                'key': deck_key,
                'label': cfg['label'],
                'deck_id': deck_id,
                'total_cards': total_cards,
                'session_count': session_count
            })

        conn.close()
        return jsonify({
            'decks': decks,
            'total_session_count': total_session_count
        }), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@kids_bp.route('/kids/<kid_id>/lesson-reading/cards/<card_id>/skip', methods=['PUT'])
def update_lesson_reading_card_skip(kid_id, card_id):
    """Mark/unmark one lesson-reading card as skipped for practice."""
    body = request.get_json() or {}
    skipped = body.get('skipped')
    if not isinstance(skipped, bool):
        return jsonify({'error': 'skipped must be a boolean'}), 400
    payload, status = set_lesson_reading_card_skip(kid_id, card_id, skipped)
    return jsonify(payload), status


def set_lesson_reading_card_skip(kid_id, card_id, skipped):
    """Helper to update lesson-reading card skip flag."""
    try:
        kid = get_kid_for_family(kid_id)
        if not kid:
            return {'error': 'Kid not found'}, 404

        conn = get_kid_connection_for(kid)
        deck_ids = set(get_or_create_lesson_reading_decks(conn).values())

        card = conn.execute(
            "SELECT id, deck_id FROM cards WHERE id = ?",
            [card_id]
        ).fetchone()
        if not card:
            conn.close()
            return {'error': 'Lesson-reading card not found'}, 404

        deck_id = card[1]
        if deck_id not in deck_ids:
            conn.close()
            return {'error': 'Lesson-reading card not found'}, 404

        conn.execute(
            "UPDATE cards SET skip_practice = ? WHERE id = ?",
            [bool(skipped), card_id]
        )
        conn.close()
        return {
            'message': 'Lesson-reading card updated successfully',
            'card_id': card_id,
            'skip_practice': bool(skipped)
        }, 200
    except Exception as e:
        return {'error': str(e)}, 500


@kids_bp.route('/kids/<kid_id>/math/seed', methods=['POST'])
def seed_math_cards(kid_id):
    """Seed all fixed math decks for a kid."""
    try:
        kid = get_kid_for_family(kid_id)
        if not kid:
            return jsonify({'error': 'Kid not found'}), 404

        conn = get_kid_connection_for(kid)
        seed_results = seed_all_math_decks(conn)
        conn.close()

        return jsonify({
            'seeded': seed_results
        }), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@kids_bp.route('/kids/<kid_id>/math/cards/<card_id>', methods=['DELETE'])
def delete_math_card(kid_id, card_id):
    """Legacy delete endpoint: map to skip-on behavior for math cards."""
    auth_err = require_critical_password()
    if auth_err:
        return auth_err
    payload, status = set_math_card_skip(kid_id, card_id, True)
    return jsonify(payload), status


@kids_bp.route('/kids/<kid_id>/math/cards/<card_id>/skip', methods=['PUT'])
def update_math_card_skip(kid_id, card_id):
    """Mark/unmark a math card as skipped for practice."""
    body = request.get_json() or {}
    skipped = body.get('skipped')
    if not isinstance(skipped, bool):
        return jsonify({'error': 'skipped must be a boolean'}), 400
    payload, status = set_math_card_skip(kid_id, card_id, skipped)
    return jsonify(payload), status


def set_math_card_skip(kid_id, card_id, skipped):
    """Helper to update math card skip flag."""
    try:
        kid = get_kid_for_family(kid_id)
        if not kid:
            return {'error': 'Kid not found'}, 404

        conn = get_kid_connection_for(kid)
        deck_ids = set(get_or_create_math_decks(conn).values())

        card = conn.execute(
            "SELECT id, deck_id FROM cards WHERE id = ?",
            [card_id]
        ).fetchone()
        if not card:
            conn.close()
            return {'error': 'Math card not found'}, 404

        deck_id = card[1]
        if deck_id not in deck_ids:
            conn.close()
            return {'error': 'Math card not found'}, 404

        conn.execute(
            "UPDATE cards SET skip_practice = ? WHERE id = ?",
            [bool(skipped), card_id]
        )
        conn.close()
        return {
            'message': 'Math card updated successfully',
            'card_id': card_id,
            'skip_practice': bool(skipped)
        }, 200
    except Exception as e:
        return {'error': str(e)}, 500


@kids_bp.route('/kids/<kid_id>/writing/cards', methods=['GET'])
def get_writing_cards(kid_id):
    """Get all writing cards for a kid."""
    try:
        kid = get_kid_for_family(kid_id)
        if not kid:
            return jsonify({'error': 'Kid not found'}), 404

        conn = get_kid_connection_for(kid)
        deck_id = get_or_create_writing_deck(conn)
        pending_card_ids = get_pending_writing_card_ids(conn)
        missing_audio_rows = conn.execute(
            """
            SELECT c.id
            FROM cards c
            LEFT JOIN writing_audio wa ON wa.card_id = c.id
            WHERE c.deck_id = ?
              AND wa.card_id IS NULL
            """,
            [deck_id]
        ).fetchall()
        missing_audio_card_ids = [int(row[0]) for row in missing_audio_rows]
        missing_audio_set = set(missing_audio_card_ids)
        pending_card_set = set(pending_card_ids)
        preview_excluded_ids = list(set(pending_card_ids + missing_audio_card_ids))
        writing_session_count = normalize_writing_session_card_count(kid)
        preview_kid = {**kid, 'sessionCardCount': writing_session_count}
        preview_ids = preview_deck_practice_order(
            conn, preview_kid, deck_id, 'writing', excluded_card_ids=preview_excluded_ids
        )
        preview_order = {card_id: i + 1 for i, card_id in enumerate(preview_ids)}

        rows = conn.execute(
            """
            SELECT
                c.id,
                c.deck_id,
                c.front,
                c.back,
                COALESCE(c.skip_practice, FALSE) AS skip_practice,
                c.hardness_score,
                c.created_at,
                COUNT(sr.id) AS lifetime_attempts,
                MAX(sr.timestamp) AS last_seen_at,
                wa.file_name,
                wa.mime_type
            FROM cards c
            LEFT JOIN session_results sr ON c.id = sr.card_id
            LEFT JOIN writing_audio wa ON c.id = wa.card_id
            WHERE c.deck_id = ?
            GROUP BY c.id, c.deck_id, c.front, c.back, c.skip_practice, c.hardness_score, c.created_at, wa.file_name, wa.mime_type
            ORDER BY c.id ASC
            """,
            [deck_id]
        ).fetchall()
        conn.close()

        cards = []
        for row in rows:
            card = map_card_row(row, preview_order)
            if not card.get('front') and card.get('back'):
                card['front'] = card['back']
            card['pending_sheet'] = int(row[0]) in pending_card_set
            has_audio = row[9] is not None
            card['available_for_practice'] = (not card['pending_sheet']) and has_audio
            card['audio_file_name'] = row[9]
            card['audio_mime_type'] = row[10]
            card['audio_url'] = f"/api/kids/{kid_id}/writing/audio/{row[9]}" if row[9] else None
            card['missing_audio'] = int(row[0]) in missing_audio_set
            cards.append(card)

        return jsonify({'deck_id': deck_id, 'cards': cards}), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@kids_bp.route('/kids/<kid_id>/writing/cards', methods=['POST'])
def add_writing_cards(kid_id):
    """Add one writing card from a voice prompt and raw answer text."""
    try:
        kid = get_kid_for_family(kid_id)
        if not kid:
            return jsonify({'error': 'Kid not found'}), 404

        answer_text = (request.form.get('characters') or '').strip()
        if len(answer_text) == 0:
            return jsonify({'error': 'Please provide answer text'}), 400

        if 'audio' not in request.files:
            return jsonify({'error': 'Audio recording is required'}), 400

        audio_file = request.files['audio']
        if not audio_file or audio_file.filename == '':
            return jsonify({'error': 'Audio recording is required'}), 400

        audio_bytes = audio_file.read()
        if not audio_bytes:
            return jsonify({'error': 'Uploaded audio is empty'}), 400

        conn = get_kid_connection_for(kid)
        deck_id = get_or_create_writing_deck(conn)

        existing = conn.execute(
            """
            SELECT id
            FROM cards
            WHERE deck_id = ? AND back = ?
            LIMIT 1
            """,
            [deck_id, answer_text]
        ).fetchone()
        if existing:
            conn.close()
            return jsonify({'error': 'This Chinese writing answer already exists in the card bank'}), 400

        safe_name = secure_filename(audio_file.filename or '')
        _, original_ext = os.path.splitext(safe_name)
        mime_type = audio_file.mimetype or 'application/octet-stream'
        guessed_ext = mimetypes.guess_extension(mime_type) or ''
        ext = original_ext if original_ext else guessed_ext
        if not ext:
            ext = '.webm'

        audio_dir = ensure_writing_audio_dir(kid)
        card_id = conn.execute(
            """
            INSERT INTO cards (deck_id, front, back)
            VALUES (?, ?, ?)
            RETURNING id
            """,
            [deck_id, answer_text, answer_text]
        ).fetchone()[0]

        file_name = f"{uuid.uuid4().hex}{ext}"
        file_path = os.path.join(audio_dir, file_name)
        with open(file_path, 'wb') as f:
            f.write(audio_bytes)

        conn.execute(
            """
            INSERT INTO writing_audio (card_id, file_name, mime_type)
            VALUES (?, ?, ?)
            """,
            [card_id, file_name, mime_type]
        )

        row = conn.execute(
            """
            SELECT id, deck_id, front, back, created_at
            FROM cards
            WHERE id = ?
            """,
            [card_id]
        ).fetchone()

        conn.close()
        return jsonify({
            'deck_id': deck_id,
            'inserted_count': 1,
            'cards': [{
                'id': row[0],
                'deck_id': row[1],
                'front': row[2],
                'back': row[3],
                'created_at': row[4].isoformat() if row[4] else None,
                'audio_file_name': file_name,
                'audio_mime_type': mime_type,
                'audio_url': f"/api/kids/{kid_id}/writing/audio/{file_name}"
            }]
        }), 201
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@kids_bp.route('/kids/<kid_id>/writing/cards/bulk', methods=['POST'])
def add_writing_cards_bulk(kid_id):
    """Bulk-add writing cards without audio by splitting text on non-Chinese separators."""
    try:
        kid = get_kid_for_family(kid_id)
        if not kid:
            return jsonify({'error': 'Kid not found'}), 404

        payload = request.get_json() or {}
        raw_text = payload.get('text', '')
        tokens = split_writing_bulk_text(raw_text)
        if len(tokens) == 0:
            return jsonify({'error': 'Please paste at least one Chinese word/phrase'}), 400

        conn = get_kid_connection_for(kid)
        deck_id = get_or_create_writing_deck(conn)

        existing_rows = conn.execute(
            "SELECT back FROM cards WHERE deck_id = ?",
            [deck_id]
        ).fetchall()
        existing_set = {str(row[0]) for row in existing_rows}

        created = []
        skipped_existing = 0
        for token in tokens:
            if token in existing_set:
                skipped_existing += 1
                continue

            row = conn.execute(
                """
                INSERT INTO cards (deck_id, front, back)
                VALUES (?, ?, ?)
                RETURNING id, deck_id, front, back, created_at
                """,
                [deck_id, token, token]
            ).fetchone()
            existing_set.add(token)
            created.append({
                'id': int(row[0]),
                'deck_id': int(row[1]),
                'front': row[2],
                'back': row[3],
                'created_at': row[4].isoformat() if row[4] else None,
                'audio_file_name': None,
                'audio_mime_type': None,
                'audio_url': None,
            })

        conn.close()
        return jsonify({
            'deck_id': deck_id,
            'input_token_count': len(tokens),
            'inserted_count': len(created),
            'skipped_existing_count': skipped_existing,
            'cards': created
        }), 201
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@kids_bp.route('/kids/<kid_id>/writing/cards/<card_id>/audio', methods=['POST'])
def upsert_writing_card_audio(kid_id, card_id):
    """Attach or replace audio for an existing writing card."""
    try:
        kid = get_kid_for_family(kid_id)
        if not kid:
            return jsonify({'error': 'Kid not found'}), 404

        if 'audio' not in request.files:
            return jsonify({'error': 'Audio recording is required'}), 400
        audio_file = request.files['audio']
        if not audio_file or audio_file.filename == '':
            return jsonify({'error': 'Audio recording is required'}), 400
        audio_bytes = audio_file.read()
        if not audio_bytes:
            return jsonify({'error': 'Uploaded audio is empty'}), 400

        conn = get_kid_connection_for(kid)
        deck_id = get_or_create_writing_deck(conn)
        card_row = conn.execute(
            "SELECT id, back FROM cards WHERE id = ? AND deck_id = ?",
            [card_id, deck_id]
        ).fetchone()
        if not card_row:
            conn.close()
            return jsonify({'error': 'Writing card not found'}), 404

        existing_audio_row = conn.execute(
            "SELECT file_name FROM writing_audio WHERE card_id = ?",
            [card_id]
        ).fetchone()
        old_file_name = existing_audio_row[0] if existing_audio_row else None

        safe_name = secure_filename(audio_file.filename or '')
        _, original_ext = os.path.splitext(safe_name)
        mime_type = audio_file.mimetype or 'application/octet-stream'
        guessed_ext = mimetypes.guess_extension(mime_type) or ''
        ext = original_ext if original_ext else guessed_ext
        if not ext:
            ext = '.webm'

        audio_dir = ensure_writing_audio_dir(kid)
        file_name = f"{uuid.uuid4().hex}{ext}"
        file_path = os.path.join(audio_dir, file_name)
        with open(file_path, 'wb') as f:
            f.write(audio_bytes)

        conn.execute(
            """
            INSERT INTO writing_audio (card_id, file_name, mime_type)
            VALUES (?, ?, ?)
            ON CONFLICT (card_id) DO UPDATE
            SET file_name = EXCLUDED.file_name, mime_type = EXCLUDED.mime_type
            """,
            [card_id, file_name, mime_type]
        )
        conn.close()

        if old_file_name:
            old_path = os.path.join(audio_dir, old_file_name)
            if old_file_name != file_name and os.path.exists(old_path):
                try:
                    os.remove(old_path)
                except OSError:
                    pass

        return jsonify({
            'card_id': int(card_row[0]),
            'back': card_row[1],
            'audio_file_name': file_name,
            'audio_mime_type': mime_type,
            'audio_url': f"/api/kids/{kid_id}/writing/audio/{file_name}"
        }), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@kids_bp.route('/kids/<kid_id>/writing/audio/<path:file_name>', methods=['GET'])
def get_writing_audio(kid_id, file_name):
    """Serve writing prompt audio file for a kid."""
    try:
        kid = get_kid_for_family(kid_id)
        if not kid:
            return jsonify({'error': 'Kid not found'}), 404

        if file_name != os.path.basename(file_name):
            return jsonify({'error': 'Invalid file name'}), 400

        audio_dir = get_kid_writing_audio_dir(kid)
        audio_path = os.path.join(audio_dir, file_name)
        if not os.path.exists(audio_path):
            return jsonify({'error': 'Audio file not found'}), 404

        conn = get_kid_connection_for(kid)
        deck_id = get_or_create_writing_deck(conn)
        row = conn.execute(
            """
            SELECT wa.mime_type
            FROM writing_audio wa
            JOIN cards c ON c.id = wa.card_id
            WHERE wa.file_name = ? AND c.deck_id = ?
            LIMIT 1
            """,
            [file_name, deck_id]
        ).fetchone()
        conn.close()

        mime_type = row[0] if row and row[0] else None
        return send_from_directory(audio_dir, file_name, as_attachment=False, mimetype=mime_type)
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@kids_bp.route('/kids/<kid_id>/lesson-reading/audio/<path:file_name>', methods=['GET'])
def get_lesson_reading_audio(kid_id, file_name):
    """Serve lesson-reading recording audio file for one kid."""
    try:
        kid = get_kid_for_family(kid_id)
        if not kid:
            return jsonify({'error': 'Kid not found'}), 404

        if file_name != os.path.basename(file_name):
            return jsonify({'error': 'Invalid file name'}), 400

        audio_dir = get_kid_lesson_reading_audio_dir(kid)
        audio_path = os.path.join(audio_dir, file_name)
        if not os.path.exists(audio_path):
            return jsonify({'error': 'Audio file not found'}), 404

        conn = get_kid_connection_for(kid)
        row = conn.execute(
            """
            SELECT lra.mime_type
            FROM lesson_reading_audio lra
            JOIN session_results sr ON sr.id = lra.result_id
            JOIN sessions s ON s.id = sr.session_id
            WHERE lra.file_name = ?
              AND s.type = 'lesson_reading'
            LIMIT 1
            """,
            [file_name]
        ).fetchone()
        conn.close()

        if not row:
            return jsonify({'error': 'Audio file not found'}), 404

        mime_type = row[0] if row and row[0] else None
        return send_from_directory(audio_dir, file_name, as_attachment=False, mimetype=mime_type)
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@kids_bp.route('/kids/<kid_id>/writing/cards/<card_id>/audio', methods=['DELETE'])
def delete_writing_card_audio(kid_id, card_id):
    """Delete audio for an existing writing card."""
    try:
        kid = get_kid_for_family(kid_id)
        if not kid:
            return jsonify({'error': 'Kid not found'}), 404

        conn = get_kid_connection_for(kid)
        deck_id = get_or_create_writing_deck(conn)
        card_row = conn.execute(
            "SELECT id FROM cards WHERE id = ? AND deck_id = ?",
            [card_id, deck_id]
        ).fetchone()
        if not card_row:
            conn.close()
            return jsonify({'error': 'Writing card not found'}), 404

        audio_row = conn.execute(
            "SELECT file_name FROM writing_audio WHERE card_id = ?",
            [card_id]
        ).fetchone()
        if not audio_row:
            conn.close()
            return jsonify({'error': 'No audio found for this writing card'}), 404

        file_name = audio_row[0]
        conn.execute(
            "DELETE FROM writing_audio WHERE card_id = ?",
            [card_id]
        )
        conn.close()

        if file_name:
            audio_path = os.path.join(get_kid_writing_audio_dir(kid), file_name)
            if os.path.exists(audio_path):
                try:
                    os.remove(audio_path)
                except OSError:
                    pass

        return jsonify({'deleted': True, 'card_id': int(card_row[0])}), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@kids_bp.route('/kids/<kid_id>/writing/cards/<card_id>', methods=['DELETE'])
def delete_writing_card(kid_id, card_id):
    """Delete a writing card and its associated audio file."""
    try:
        auth_err = require_critical_password()
        if auth_err:
            return auth_err
        kid = get_kid_for_family(kid_id)
        if not kid:
            return jsonify({'error': 'Kid not found'}), 404

        conn = get_kid_connection_for(kid)
        deck_id = get_or_create_writing_deck(conn)

        row = conn.execute(
            """
            SELECT c.id, wa.file_name
            FROM cards c
            LEFT JOIN writing_audio wa ON wa.card_id = c.id
            WHERE c.id = ? AND c.deck_id = ?
            """,
            [card_id, deck_id]
        ).fetchone()
        if not row:
            conn.close()
            return jsonify({'error': 'Writing card not found'}), 404

        file_name = row[1]
        if file_name:
            audio_path = os.path.join(get_kid_writing_audio_dir(kid), file_name)
            if os.path.exists(audio_path):
                os.remove(audio_path)

        conn.execute("DELETE FROM writing_audio WHERE card_id = ?", [card_id])
        conn.execute("DELETE FROM writing_sheet_cards WHERE card_id = ?", [card_id])
        delete_card_from_deck_internal(conn, deck_id, card_id)
        conn.close()
        return jsonify({'message': 'Writing card deleted successfully'}), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500


def select_writing_sheet_candidates(conn, deck_id, requested_count, excluded_card_ids=None):
    """Select candidate writing cards for sheet generation."""
    excluded = excluded_card_ids or []
    placeholders = ','.join(['?'] * len(excluded)) if excluded else ''
    exclude_clause = ''
    params = [deck_id]
    if excluded:
        exclude_clause = f"AND c.id NOT IN ({placeholders})"
        params.extend(excluded)

    return conn.execute(
        f"""
        WITH latest AS (
            SELECT
                sr.card_id,
                sr.correct,
                ROW_NUMBER() OVER (PARTITION BY sr.card_id ORDER BY sr.timestamp DESC, sr.id DESC) AS rn
            FROM session_results sr
            JOIN sessions s ON s.id = sr.session_id
            WHERE s.type = 'writing'
        ),
        available AS (
            SELECT
                c.id,
                c.front,
                c.back,
                l.correct,
                CASE
                    WHEN l.card_id IS NULL OR l.correct < 0 THEN 0
                    ELSE 1
                END AS priority
            FROM cards c
            LEFT JOIN latest l ON l.card_id = c.id AND l.rn = 1
            WHERE c.deck_id = ?
              {exclude_clause}
        )
        SELECT id, front, back, correct
        FROM available
        ORDER BY
          priority ASC,
          id ASC
        LIMIT ?
        """,
        [*params, requested_count]
    ).fetchall()


@kids_bp.route('/kids/<kid_id>/writing/sheets/preview', methods=['POST'])
def preview_writing_sheet(kid_id):
    """Preview writing sheet cards without persisting a sheet record."""
    try:
        kid = get_kid_for_family(kid_id)
        if not kid:
            return jsonify({'error': 'Kid not found'}), 404

        data = request.get_json() or {}
        try:
            requested_count = int(data.get('count', normalize_writing_session_card_count(kid)))
        except (TypeError, ValueError):
            return jsonify({'error': 'count must be an integer'}), 400
        try:
            requested_rows = int(data.get('rows_per_character', 1))
        except (TypeError, ValueError):
            return jsonify({'error': 'rows_per_character must be an integer'}), 400

        if requested_count < MIN_SESSION_CARD_COUNT or requested_count > MAX_SESSION_CARD_COUNT:
            return jsonify({'error': f'count must be between {MIN_SESSION_CARD_COUNT} and {MAX_SESSION_CARD_COUNT}'}), 400
        if requested_rows < 1 or requested_rows > 10:
            return jsonify({'error': 'rows_per_character must be between 1 and 10'}), 400
        if requested_count * requested_rows > MAX_WRITING_SHEET_ROWS:
            max_cards = max(1, MAX_WRITING_SHEET_ROWS // requested_rows)
            return jsonify({
                'error': (
                    f'Sheet exceeds one-page limit ({MAX_WRITING_SHEET_ROWS} rows). '
                    f'With {requested_rows} row(s) per card, max cards is {max_cards}.'
                )
            }), 400

        conn = get_kid_connection_for(kid)
        deck_id = get_or_create_writing_deck(conn)
        pending_card_ids = get_pending_writing_card_ids(conn)
        candidates = select_writing_sheet_candidates(conn, deck_id, requested_count, pending_card_ids)
        conn.close()

        if len(candidates) == 0:
            return jsonify({
                'preview': False,
                'cards': [],
                'message': 'No cards available to print right now. All writing cards may already be practicing.'
            }), 200

        return jsonify({
            'preview': True,
            'rows_per_character': requested_rows,
            'cards': [{
                'id': int(row[0]),
                'front': row[1],
                'back': row[2]
            } for row in candidates]
        }), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@kids_bp.route('/kids/<kid_id>/writing/sheets/finalize', methods=['POST'])
def finalize_writing_sheet(kid_id):
    """Persist a previously previewed writing sheet once parent confirms print."""
    try:
        kid = get_kid_for_family(kid_id)
        if not kid:
            return jsonify({'error': 'Kid not found'}), 404

        data = request.get_json() or {}
        raw_ids = data.get('card_ids') or []
        try:
            requested_rows = int(data.get('rows_per_character', 1))
        except (TypeError, ValueError):
            return jsonify({'error': 'rows_per_character must be an integer'}), 400

        if not isinstance(raw_ids, list) or len(raw_ids) == 0:
            return jsonify({'error': 'card_ids must be a non-empty list'}), 400
        if requested_rows < 1 or requested_rows > 10:
            return jsonify({'error': 'rows_per_character must be between 1 and 10'}), 400

        normalized_ids = []
        for cid in raw_ids:
            try:
                normalized_ids.append(int(cid))
            except (TypeError, ValueError):
                return jsonify({'error': 'card_ids must contain integers'}), 400
        normalized_ids = list(dict.fromkeys(normalized_ids))

        if len(normalized_ids) * requested_rows > MAX_WRITING_SHEET_ROWS:
            max_cards = max(1, MAX_WRITING_SHEET_ROWS // requested_rows)
            return jsonify({
                'error': (
                    f'Sheet exceeds one-page limit ({MAX_WRITING_SHEET_ROWS} rows). '
                    f'With {requested_rows} row(s) per card, max cards is {max_cards}.'
                )
            }), 400

        conn = get_kid_connection_for(kid)
        deck_id = get_or_create_writing_deck(conn)

        pending_set = set(get_pending_writing_card_ids(conn))
        if any(card_id in pending_set for card_id in normalized_ids):
            conn.close()
            return jsonify({'error': 'Some selected cards are already practicing in another sheet'}), 409

        placeholders = ','.join(['?'] * len(normalized_ids))
        rows = conn.execute(
            f"""
            SELECT id, front, back
            FROM cards
            WHERE deck_id = ?
              AND id IN ({placeholders})
            """,
            [deck_id, *normalized_ids]
        ).fetchall()
        rows_by_id = {int(row[0]): row for row in rows}
        if len(rows_by_id) != len(normalized_ids):
            conn.close()
            return jsonify({'error': 'Some selected cards are no longer available'}), 409

        sheet_id = conn.execute(
            "INSERT INTO writing_sheets (status, practice_rows) VALUES ('pending', ?) RETURNING id",
            [requested_rows]
        ).fetchone()[0]

        for card_id in normalized_ids:
            conn.execute(
                """
                INSERT INTO writing_sheet_cards (sheet_id, card_id)
                VALUES (?, ?)
                """,
                [sheet_id, card_id]
            )

        conn.close()
        return jsonify({
            'created': True,
            'sheet_id': int(sheet_id),
            'rows_per_character': requested_rows,
            'cards': [{
                'id': card_id,
                'front': rows_by_id[card_id][1],
                'back': rows_by_id[card_id][2]
            } for card_id in normalized_ids]
        }), 201
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@kids_bp.route('/kids/<kid_id>/writing/sheets', methods=['POST'])
def create_writing_sheet(kid_id):
    """Create a printable writing sheet from never-seen or latest-wrong cards."""
    try:
        kid = get_kid_for_family(kid_id)
        if not kid:
            return jsonify({'error': 'Kid not found'}), 404

        data = request.get_json() or {}
        try:
            requested_count = int(data.get('count', normalize_writing_session_card_count(kid)))
        except (TypeError, ValueError):
            return jsonify({'error': 'count must be an integer'}), 400
        try:
            requested_rows = int(data.get('rows_per_character', 1))
        except (TypeError, ValueError):
            return jsonify({'error': 'rows_per_character must be an integer'}), 400

        if requested_count < MIN_SESSION_CARD_COUNT or requested_count > MAX_SESSION_CARD_COUNT:
            return jsonify({'error': f'count must be between {MIN_SESSION_CARD_COUNT} and {MAX_SESSION_CARD_COUNT}'}), 400
        if requested_rows < 1 or requested_rows > 10:
            return jsonify({'error': 'rows_per_character must be between 1 and 10'}), 400
        total_rows_requested = requested_count * requested_rows
        if total_rows_requested > MAX_WRITING_SHEET_ROWS:
            max_cards = max(1, MAX_WRITING_SHEET_ROWS // requested_rows)
            return jsonify({
                'error': (
                    f'Sheet exceeds one-page limit ({MAX_WRITING_SHEET_ROWS} rows). '
                    f'With {requested_rows} row(s) per card, max cards is {max_cards}.'
                )
            }), 400

        conn = get_kid_connection_for(kid)
        deck_id = get_or_create_writing_deck(conn)
        pending_card_ids = get_pending_writing_card_ids(conn)

        candidates = select_writing_sheet_candidates(conn, deck_id, requested_count, pending_card_ids)

        if len(candidates) == 0:
            conn.close()
            return jsonify({
                'sheet_id': None,
                'cards': [],
                'created': False,
                'message': 'No cards available to print right now. All writing cards may already be practicing.'
            }), 200

        sheet_id = conn.execute(
            "INSERT INTO writing_sheets (status, practice_rows) VALUES ('pending', ?) RETURNING id",
            [requested_rows]
        ).fetchone()[0]

        for row in candidates:
            conn.execute(
                """
                INSERT INTO writing_sheet_cards (sheet_id, card_id)
                VALUES (?, ?)
                """,
                [sheet_id, row[0]]
            )

        conn.close()
        return jsonify({
            'created': True,
            'sheet_id': int(sheet_id),
            'rows_per_character': requested_rows,
            'cards': [{
                'id': int(row[0]),
                'front': row[1],
                'back': row[2]
            } for row in candidates]
        }), 201
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@kids_bp.route('/kids/<kid_id>/writing/sheets', methods=['GET'])
def get_writing_sheets(kid_id):
    """List all writing sheets with cards."""
    try:
        kid = get_kid_for_family(kid_id)
        if not kid:
            return jsonify({'error': 'Kid not found'}), 404

        conn = get_kid_connection_for(kid)
        rows = conn.execute(
            """
            SELECT
                ws.id,
                ws.status,
                ws.practice_rows,
                ws.created_at,
                ws.completed_at,
                c.id,
                c.front,
                c.back
            FROM writing_sheets ws
            LEFT JOIN writing_sheet_cards wsc ON wsc.sheet_id = ws.id
            LEFT JOIN cards c ON c.id = wsc.card_id
            ORDER BY ws.created_at DESC, c.id ASC
            """
        ).fetchall()
        conn.close()

        sheets_by_id = {}
        ordered_ids = []
        for row in rows:
            sheet_id = int(row[0])
            if sheet_id not in sheets_by_id:
                sheets_by_id[sheet_id] = {
                    'id': sheet_id,
                    'status': row[1],
                    'practice_rows': int(row[2] or 1),
                    'created_at': row[3].isoformat() if row[3] else None,
                    'completed_at': row[4].isoformat() if row[4] else None,
                    'cards': []
                }
                ordered_ids.append(sheet_id)

            if row[5] is not None:
                sheets_by_id[sheet_id]['cards'].append({
                    'id': int(row[5]),
                    'front': row[6],
                    'back': row[7]
                })

        return jsonify({'sheets': [sheets_by_id[sid] for sid in ordered_ids]}), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@kids_bp.route('/kids/<kid_id>/writing/sheets/<sheet_id>', methods=['GET'])
def get_writing_sheet_detail(kid_id, sheet_id):
    """Get one writing sheet with cards."""
    try:
        kid = get_kid_for_family(kid_id)
        if not kid:
            return jsonify({'error': 'Kid not found'}), 404

        conn = get_kid_connection_for(kid)
        rows = conn.execute(
            """
            SELECT
                ws.id,
                ws.status,
                ws.practice_rows,
                ws.created_at,
                ws.completed_at,
                c.id,
                c.front,
                c.back
            FROM writing_sheets ws
            LEFT JOIN writing_sheet_cards wsc ON wsc.sheet_id = ws.id
            LEFT JOIN cards c ON c.id = wsc.card_id
            WHERE ws.id = ?
            ORDER BY c.id ASC
            """,
            [sheet_id]
        ).fetchall()
        conn.close()

        if len(rows) == 0:
            return jsonify({'error': 'Sheet not found'}), 404

        sheet = {
            'id': int(rows[0][0]),
            'status': rows[0][1],
            'practice_rows': int(rows[0][2] or 1),
            'created_at': rows[0][3].isoformat() if rows[0][3] else None,
            'completed_at': rows[0][4].isoformat() if rows[0][4] else None,
            'cards': []
        }
        for row in rows:
            if row[5] is None:
                continue
            sheet['cards'].append({
                'id': int(row[5]),
                'front': row[6],
                'back': row[7]
            })

        return jsonify(sheet), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@kids_bp.route('/kids/<kid_id>/writing/sheets/<sheet_id>/complete', methods=['POST'])
def complete_writing_sheet(kid_id, sheet_id):
    """Mark a writing sheet as done."""
    try:
        kid = get_kid_for_family(kid_id)
        if not kid:
            return jsonify({'error': 'Kid not found'}), 404

        conn = get_kid_connection_for(kid)
        row = conn.execute(
            "SELECT id, status FROM writing_sheets WHERE id = ?",
            [sheet_id]
        ).fetchone()
        if not row:
            conn.close()
            return jsonify({'error': 'Sheet not found'}), 404

        if row[1] != 'done':
            conn.execute(
                """
                UPDATE writing_sheets
                SET status = 'done', completed_at = CURRENT_TIMESTAMP
                WHERE id = ?
                """,
                [sheet_id]
            )
        conn.close()
        return jsonify({'sheet_id': int(sheet_id), 'status': 'done'}), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@kids_bp.route('/kids/<kid_id>/writing/sheets/<sheet_id>/withdraw', methods=['POST'])
def withdraw_writing_sheet(kid_id, sheet_id):
    """Withdraw a pending writing sheet by deleting it."""
    try:
        kid = get_kid_for_family(kid_id)
        if not kid:
            return jsonify({'error': 'Kid not found'}), 404

        conn = get_kid_connection_for(kid)
        row = conn.execute(
            "SELECT id, status FROM writing_sheets WHERE id = ?",
            [sheet_id]
        ).fetchone()
        if not row:
            conn.close()
            return jsonify({'error': 'Sheet not found'}), 404

        status = row[1]
        if status != 'pending':
            conn.close()
            return jsonify({'error': 'Only practicing sheets can be withdrawn'}), 400

        conn.execute(
            "DELETE FROM writing_sheet_cards WHERE sheet_id = ?",
            [sheet_id]
        )
        conn.execute(
            """
            DELETE FROM writing_sheets
            WHERE id = ?
            """,
            [sheet_id]
        )

        conn.close()
        return jsonify({'sheet_id': int(sheet_id), 'deleted': True}), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@kids_bp.route('/kids/<kid_id>/writing/practice/start', methods=['POST'])
def start_writing_practice_session(kid_id):
    """Start a writing practice session."""
    try:
        kid = get_kid_for_family(kid_id)
        if not kid:
            return jsonify({'error': 'Kid not found'}), 404

        conn = get_kid_connection_for(kid)
        deck_id = get_or_create_writing_deck(conn)
        pending_card_ids = get_pending_writing_card_ids(conn)
        missing_audio_rows = conn.execute(
            """
            SELECT c.id
            FROM cards c
            LEFT JOIN writing_audio wa ON wa.card_id = c.id
            WHERE c.deck_id = ?
              AND wa.card_id IS NULL
            """,
            [deck_id]
        ).fetchall()
        missing_audio_card_ids = [int(row[0]) for row in missing_audio_rows]
        excluded_card_ids = pending_card_ids + missing_audio_card_ids
        writing_session_count = normalize_writing_session_card_count(kid)
        if writing_session_count <= 0:
            conn.close()
            return jsonify({'pending_session_id': None, 'cards': [], 'planned_count': 0}), 200
        preview_kid = {**kid, 'sessionCardCount': writing_session_count}
        pending_session_id, selected_cards = plan_deck_pending_session(
            conn, preview_kid, kid_id, deck_id, 'writing', excluded_card_ids=excluded_card_ids
        )
        if not pending_session_id:
            conn.close()
            return jsonify({'pending_session_id': None, 'cards': [], 'planned_count': 0}), 200

        card_ids = [card['id'] for card in selected_cards]
        if not card_ids:
            conn.close()
            return jsonify({'pending_session_id': None, 'cards': [], 'planned_count': 0}), 200
        placeholders = ','.join(['?'] * len(card_ids))
        audio_rows = conn.execute(
            f"""
            SELECT card_id, file_name, mime_type
            FROM writing_audio
            WHERE card_id IN ({placeholders})
            """,
            card_ids
        ).fetchall()
        conn.close()

        audio_by_card = {row[0]: {'file_name': row[1], 'mime_type': row[2]} for row in audio_rows}
        cards_with_audio = []
        for card in selected_cards:
            audio_meta = audio_by_card.get(card['id'])
            cards_with_audio.append({
                **card,
                'audio_file_name': audio_meta['file_name'] if audio_meta else None,
                'audio_mime_type': audio_meta['mime_type'] if audio_meta else None,
                'audio_url': f"/api/kids/{kid_id}/writing/audio/{audio_meta['file_name']}" if audio_meta else None
            })

        return jsonify({
            'pending_session_id': pending_session_id,
            'planned_count': len(cards_with_audio),
            'cards': cards_with_audio
        }), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@kids_bp.route('/kids/<kid_id>/math/practice/start', methods=['POST'])
def start_math_practice_session(kid_id):
    """Start a math session composed from configured fixed decks."""
    try:
        kid = get_kid_for_family(kid_id)
        if not kid:
            return jsonify({'error': 'Kid not found'}), 404

        conn = get_kid_connection_for(kid)
        deck_ids = get_or_create_math_decks(conn)

        selected_cards = []
        deck_cursor_updates = []
        for deck_key in MATH_DECK_CONFIGS.keys():
            per_deck_count = normalize_math_deck_session_count(kid, deck_key)
            if per_deck_count <= 0:
                continue

            preview_kid = {**kid, 'sessionCardCount': per_deck_count}
            cards_by_id, selected_ids, queue_ids, cursor, queue_used = plan_deck_practice_selection(
                conn,
                preview_kid,
                deck_ids[deck_key],
                'math',
                enforce_exact_target=True
            )

            if len(selected_ids) == 0:
                continue

            if len(queue_ids) > 0:
                next_cursor = (cursor + queue_used) % len(queue_ids)
                deck_cursor_updates.append({
                    'deck_id': int(deck_ids[deck_key]),
                    'next_cursor': int(next_cursor),
                })

            for card_id in selected_ids:
                selected_cards.append({
                    **cards_by_id[card_id],
                    'math_deck_key': deck_key
                })

        if len(selected_cards) == 0:
            conn.close()
            return jsonify({'pending_session_id': None, 'cards': [], 'planned_count': 0}), 200

        pending_session_id = create_pending_session(
            kid_id,
            'math',
            {
                'kind': 'math',
                'planned_count': len(selected_cards),
                'deck_cursor_updates': deck_cursor_updates,
            }
        )
        conn.close()

        return jsonify({
            'pending_session_id': pending_session_id,
            'planned_count': len(selected_cards),
            'cards': selected_cards
        }), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@kids_bp.route('/kids/<kid_id>/lesson-reading/practice/start', methods=['POST'])
def start_lesson_reading_practice_session(kid_id):
    """Start a lesson-reading session composed from configured preset decks."""
    try:
        kid = get_kid_for_family(kid_id)
        if not kid:
            return jsonify({'error': 'Kid not found'}), 404

        conn = get_kid_connection_for(kid)
        deck_ids = get_or_create_lesson_reading_decks(conn)

        selected_cards = []
        deck_cursor_updates = []
        for deck_key in LESSON_READING_DECK_CONFIGS.keys():
            per_deck_count = normalize_lesson_reading_deck_session_count(kid, deck_key)
            if per_deck_count <= 0:
                continue

            preview_kid = {**kid, 'sessionCardCount': per_deck_count}
            cards_by_id, selected_ids, queue_ids, cursor, queue_used = plan_deck_practice_selection(
                conn,
                preview_kid,
                deck_ids[deck_key],
                'lesson_reading',
                enforce_exact_target=True
            )
            if len(selected_ids) == 0:
                continue

            if len(queue_ids) > 0:
                next_cursor = (cursor + queue_used) % len(queue_ids)
                deck_cursor_updates.append({
                    'deck_id': int(deck_ids[deck_key]),
                    'next_cursor': int(next_cursor),
                })

            for card_id in selected_ids:
                selected_cards.append({
                    **cards_by_id[card_id],
                    'lesson_deck_key': deck_key
                })

        if len(selected_cards) == 0:
            conn.close()
            return jsonify({'pending_session_id': None, 'cards': [], 'planned_count': 0}), 200

        pending_session_id = create_pending_session(
            kid_id,
            'lesson_reading',
            {
                'kind': 'lesson_reading',
                'planned_count': len(selected_cards),
                'deck_cursor_updates': deck_cursor_updates,
                'cards': [{'id': int(card['id'])} for card in selected_cards],
                'lesson_audio_dir': ensure_lesson_reading_audio_dir(kid),
            }
        )
        conn.close()

        return jsonify({
            'pending_session_id': pending_session_id,
            'planned_count': len(selected_cards),
            'cards': selected_cards
        }), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@kids_bp.route('/kids/<kid_id>/lesson-reading/practice/upload-audio', methods=['POST'])
def upload_lesson_reading_practice_audio(kid_id):
    """Upload one lesson-reading recording clip for an active pending session."""
    try:
        kid = get_kid_for_family(kid_id)
        if not kid:
            return jsonify({'error': 'Kid not found'}), 404

        pending_session_id = str(request.form.get('pendingSessionId') or '').strip()
        card_id_raw = request.form.get('cardId')
        if not pending_session_id:
            return jsonify({'error': 'pendingSessionId is required'}), 400
        try:
            card_id = int(card_id_raw)
        except (TypeError, ValueError):
            return jsonify({'error': 'cardId must be an integer'}), 400
        if 'audio' not in request.files:
            return jsonify({'error': 'Audio recording is required'}), 400

        pending = get_pending_session(pending_session_id, kid_id, 'lesson_reading')
        if not pending:
            return jsonify({'error': 'Pending session not found or expired'}), 404

        planned_ids = set()
        for card in pending.get('cards', []) if isinstance(pending.get('cards'), list) else []:
            try:
                planned_ids.add(int(card.get('id')))
            except Exception:
                continue
        if len(planned_ids) > 0 and card_id not in planned_ids:
            return jsonify({'error': 'cardId is not in this pending session'}), 400

        audio_file = request.files['audio']
        if not audio_file or audio_file.filename == '':
            return jsonify({'error': 'Audio recording is required'}), 400
        audio_bytes = audio_file.read()
        if not audio_bytes:
            return jsonify({'error': 'Uploaded audio is empty'}), 400

        safe_name = secure_filename(audio_file.filename or '')
        ext = os.path.splitext(safe_name)[1].lower()
        if not ext:
            ext = '.webm'
        mime_type = audio_file.mimetype or 'application/octet-stream'

        audio_dir = ensure_lesson_reading_audio_dir(kid)
        file_name = f"lr_{pending_session_id}_{card_id}_{uuid.uuid4().hex}{ext}"
        file_path = os.path.join(audio_dir, file_name)
        with open(file_path, 'wb') as f:
            f.write(audio_bytes)

        old_file_name = None
        with _PENDING_SESSIONS_LOCK:
            live = _PENDING_SESSIONS.get(pending_session_id)
            if (
                not live
                or str(live.get('kid_id')) != str(kid_id)
                or str(live.get('session_type')) != 'lesson_reading'
            ):
                try:
                    os.remove(file_path)
                except Exception:
                    pass
                return jsonify({'error': 'Pending session not found or expired'}), 404

            lesson_audio_by_card = live.get('lesson_audio_by_card')
            if not isinstance(lesson_audio_by_card, dict):
                lesson_audio_by_card = {}
                live['lesson_audio_by_card'] = lesson_audio_by_card
            if not str(live.get('lesson_audio_dir') or '').strip():
                live['lesson_audio_dir'] = audio_dir

            old_meta = lesson_audio_by_card.get(str(card_id))
            if isinstance(old_meta, dict):
                old_file_name = str(old_meta.get('file_name') or '').strip() or None

            lesson_audio_by_card[str(card_id)] = {
                'file_name': file_name,
                'mime_type': mime_type,
            }

        if old_file_name:
            old_path = os.path.join(audio_dir, old_file_name)
            if os.path.exists(old_path):
                try:
                    os.remove(old_path)
                except Exception:
                    pass

        return jsonify({
            'pending_session_id': pending_session_id,
            'card_id': card_id,
            'file_name': file_name,
            'mime_type': mime_type,
            'audio_url': f"/api/kids/{kid_id}/lesson-reading/audio/{file_name}",
        }), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@kids_bp.route('/kids/<kid_id>/math/practice/complete', methods=['POST'])
def complete_math_practice_session(kid_id):
    """Complete a math practice session with all answers."""
    try:
        kid = get_kid_for_family(kid_id)
        if not kid:
            return jsonify({'error': 'Kid not found'}), 404

        payload, status_code = complete_session_internal(
            kid,
            kid_id,
            'math',
            request.get_json() or {}
        )
        return jsonify(payload), status_code
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@kids_bp.route('/kids/<kid_id>/lesson-reading/practice/complete', methods=['POST'])
def complete_lesson_reading_practice_session(kid_id):
    """Complete a lesson-reading practice session with all answers."""
    try:
        kid = get_kid_for_family(kid_id)
        if not kid:
            return jsonify({'error': 'Kid not found'}), 404

        payload_data = None
        content_type = str(request.content_type or '')
        if content_type.startswith('multipart/form-data'):
            pending_session_id = str(request.form.get('pendingSessionId') or '').strip()
            answers_raw = request.form.get('answers')
            started_at = str(request.form.get('startedAt') or '').strip()
            if not pending_session_id:
                return jsonify({'error': 'pendingSessionId is required'}), 400
            if not answers_raw:
                return jsonify({'error': 'answers is required'}), 400
            try:
                answers = json.loads(answers_raw)
            except Exception:
                return jsonify({'error': 'answers must be valid JSON'}), 400

            uploaded_audio_by_card = {}
            for field_name, audio_file in request.files.items():
                if not str(field_name).startswith('audio_'):
                    continue
                card_id_raw = str(field_name).split('_', 1)[1]
                try:
                    card_id = int(card_id_raw)
                except (TypeError, ValueError):
                    continue
                audio_bytes = audio_file.read()
                if not audio_bytes:
                    return jsonify({'error': f'Uploaded audio for card {card_id} is empty'}), 400
                uploaded_audio_by_card[card_id] = {
                    'bytes': audio_bytes,
                    'mime_type': audio_file.mimetype or 'application/octet-stream',
                    'filename': audio_file.filename or '',
                }

            payload_data = {
                'pendingSessionId': pending_session_id,
                'answers': answers,
                'startedAt': started_at or None,
                '_uploaded_lesson_audio_by_card': uploaded_audio_by_card,
            }
        else:
            payload_data = request.get_json() or {}

        payload, status_code = complete_session_internal(
            kid,
            kid_id,
            'lesson_reading',
            payload_data
        )
        return jsonify(payload), status_code
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@kids_bp.route('/kids/<kid_id>/writing/practice/complete', methods=['POST'])
def complete_writing_practice_session(kid_id):
    """Complete a writing practice session with all answers."""
    try:
        kid = get_kid_for_family(kid_id)
        if not kid:
            return jsonify({'error': 'Kid not found'}), 404

        payload, status_code = complete_session_internal(
            kid,
            kid_id,
            'writing',
            request.get_json() or {}
        )
        return jsonify(payload), status_code
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@kids_bp.route('/kids/<kid_id>/practice/complete', methods=['POST'])
def complete_practice_session(kid_id):
    """Complete a Chinese practice session with all answers."""
    try:
        kid = get_kid_for_family(kid_id)
        if not kid:
            return jsonify({'error': 'Kid not found'}), 404

        payload, status_code = complete_session_internal(
            kid,
            kid_id,
            'flashcard',
            request.get_json() or {}
        )
        return jsonify(payload), status_code

    except Exception as e:
        return jsonify({'error': str(e)}), 500
