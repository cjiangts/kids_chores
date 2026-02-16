"""Metadata manager for kids/families metadata JSON."""
import json
import os
import tempfile
import threading
from datetime import datetime
from typing import List, Dict, Optional
import fcntl
from werkzeug.security import generate_password_hash, check_password_hash

METADATA_FILE = os.path.join(os.path.dirname(__file__), '../../data/kids.json')
METADATA_LOCK_FILE = f"{METADATA_FILE}.lock"
MAX_FAMILIES = 10
PASSWORD_HASH_METHOD = 'pbkdf2:sha256'
DEFAULT_HARD_CARD_PERCENTAGE = 20
MIN_HARD_CARD_PERCENTAGE = 0
MAX_HARD_CARD_PERCENTAGE = 100
_METADATA_THREAD_LOCK = threading.RLock()
ALLOWED_TOP_LEVEL_KEYS = {'families', 'kids', 'lastUpdated'}
ALLOWED_FAMILY_KEYS = {'id', 'username', 'password', 'hardCardPercentage', 'createdAt'}
ALLOWED_KID_KEYS = {
    'id',
    'name',
    'birthday',
    'dbFilePath',
    'createdAt',
    'familyId',
    'sessionCardCount',
    'writingSessionCardCount',
    'hardCardPercentage',
    'mathDeckWithin10Count',
    'mathDeckWithin20Count',
    'dailyPracticeChineseEnabled',
    'dailyPracticeMathEnabled',
    'dailyPracticeWritingEnabled',
}


def _normalize(data: Dict) -> Dict:
    """Normalize metadata shape in-memory."""
    if 'families' not in data or not isinstance(data.get('families'), list):
        data['families'] = []
    if 'kids' not in data or not isinstance(data.get('kids'), list):
        data['kids'] = []
    for i, family in enumerate(data['families']):
        if not isinstance(family, dict):
            continue
        value = family.get('hardCardPercentage', DEFAULT_HARD_CARD_PERCENTAGE)
        try:
            pct = int(value)
        except (TypeError, ValueError):
            pct = DEFAULT_HARD_CARD_PERCENTAGE
        if pct < MIN_HARD_CARD_PERCENTAGE:
            pct = MIN_HARD_CARD_PERCENTAGE
        if pct > MAX_HARD_CARD_PERCENTAGE:
            pct = MAX_HARD_CARD_PERCENTAGE
        data['families'][i] = {**family, 'hardCardPercentage': pct}
    if 'lastUpdated' not in data:
        data['lastUpdated'] = datetime.now().isoformat()
    return data


def _is_password_hashed(value: str) -> bool:
    """Best-effort check for werkzeug password hash formats."""
    text = str(value or '')
    return text.startswith('pbkdf2:') or text.startswith('scrypt:')

def ensure_metadata_file():
    """Create metadata file if it doesn't exist"""
    os.makedirs(os.path.dirname(METADATA_FILE), exist_ok=True)
    if not os.path.exists(METADATA_FILE):
        # Write initial empty metadata directly to avoid recursion
        initial_data = {'families': [], 'kids': [], 'lastUpdated': datetime.now().isoformat()}
        with open(METADATA_FILE, 'w', encoding='utf-8') as f:
            json.dump(initial_data, f, indent=2, ensure_ascii=False)
    if not os.path.exists(METADATA_LOCK_FILE):
        with open(METADATA_LOCK_FILE, 'a', encoding='utf-8'):
            pass


def _with_file_lock(exclusive: bool, callback):
    """Run callback while holding a process+file lock."""
    ensure_metadata_file()
    lock_mode = fcntl.LOCK_EX if exclusive else fcntl.LOCK_SH
    with _METADATA_THREAD_LOCK:
        with open(METADATA_LOCK_FILE, 'r+', encoding='utf-8') as lock_handle:
            fcntl.flock(lock_handle.fileno(), lock_mode)
            try:
                return callback()
            finally:
                fcntl.flock(lock_handle.fileno(), fcntl.LOCK_UN)


def _write_metadata_atomic(data: Dict):
    """Atomically replace metadata file contents."""
    data = _normalize(data)
    data['lastUpdated'] = datetime.now().isoformat()
    target_dir = os.path.dirname(METADATA_FILE)
    fd, tmp_path = tempfile.mkstemp(prefix='kids_meta_', suffix='.json', dir=target_dir)
    try:
        with os.fdopen(fd, 'w', encoding='utf-8') as tmp_file:
            json.dump(data, tmp_file, indent=2, ensure_ascii=False)
            tmp_file.flush()
            os.fsync(tmp_file.fileno())
        os.replace(tmp_path, METADATA_FILE)
    finally:
        if os.path.exists(tmp_path):
            os.remove(tmp_path)


def _mutate_metadata(mutator):
    """Safely perform read-modify-write metadata updates under one lock."""
    def _op():
        with open(METADATA_FILE, 'r', encoding='utf-8') as f:
            data = _normalize(json.load(f))

        before = json.dumps(data, sort_keys=True, ensure_ascii=False)
        result = mutator(data)
        after = json.dumps(data, sort_keys=True, ensure_ascii=False)
        if before != after:
            _write_metadata_atomic(data)
        return result

    return _with_file_lock(True, _op)

def load_metadata() -> Dict:
    """Load metadata from JSON file."""
    def _op():
        with open(METADATA_FILE, 'r', encoding='utf-8') as f:
            data = json.load(f)
        return _normalize(data)
    return _with_file_lock(False, _op)

def save_metadata(data: Dict):
    """Save metadata to JSON file."""
    _with_file_lock(True, lambda: _write_metadata_atomic(data))

def get_all_kids(family_id: Optional[str] = None) -> List[Dict]:
    """Get kids, optionally filtered by family id."""
    metadata = load_metadata()
    kids = metadata.get('kids', [])
    if family_id is None:
        return kids
    family_id = str(family_id)
    return [k for k in kids if str(k.get('familyId')) == family_id]

def next_kid_id() -> int:
    """Generate the next integer kid ID."""
    kids = get_all_kids(None)
    if not kids:
        return 1
    max_id = max(int(k['id']) for k in kids)
    return max_id + 1

def get_kid_by_id(kid_id, family_id: Optional[str] = None) -> Optional[Dict]:
    """Get a specific kid by ID, optionally constrained to one family."""
    kids = get_all_kids(family_id)
    # Compare as strings to handle both int and str kid_ids
    kid_id_str = str(kid_id)
    return next((k for k in kids if str(k['id']) == kid_id_str), None)

def add_kid(kid: Dict) -> Dict:
    """Add a new kid."""
    def _op(data: Dict):
        kids = data.get('kids', [])
        kids.append(kid)
        data['kids'] = kids
        return kid
    return _mutate_metadata(_op)

def delete_kid(kid_id, family_id: Optional[str] = None) -> bool:
    """Delete a kid, optionally constrained to one family."""
    kid_id_str = str(kid_id)
    def _op(data: Dict):
        kids = data.get('kids', [])
        original_length = len(kids)
        if family_id is None:
            next_kids = [k for k in kids if str(k['id']) != kid_id_str]
        else:
            scoped_family_id = str(family_id)
            next_kids = [k for k in kids if not (str(k['id']) == kid_id_str and str(k.get('familyId')) == scoped_family_id)]
        if len(next_kids) < original_length:
            data['kids'] = next_kids
            return True
        return False
    return _mutate_metadata(_op)

def update_kid(kid_id, updates: Dict, family_id: Optional[str] = None) -> Optional[Dict]:
    """Update fields for a specific kid, optionally constrained to one family."""
    kid_id_str = str(kid_id)
    def _op(data: Dict):
        kids = data.get('kids', [])
        for i, kid in enumerate(kids):
            same_id = str(kid.get('id')) == kid_id_str
            same_family = family_id is None or str(kid.get('familyId')) == str(family_id)
            if same_id and same_family:
                updated_kid = {**kid, **updates}
                kids[i] = updated_kid
                data['kids'] = kids
                return updated_kid
        return None
    return _mutate_metadata(_op)


def get_all_families() -> List[Dict]:
    """Get all families."""
    metadata = load_metadata()
    return metadata.get('families', [])


def get_family_by_id(family_id: str) -> Optional[Dict]:
    """Get one family by id."""
    family_id = str(family_id)
    for family in get_all_families():
        if str(family.get('id')) == family_id:
            return family
    return None


def get_family_by_username(username: str) -> Optional[Dict]:
    """Get one family by username (case-insensitive)."""
    target = str(username or '').strip().lower()
    if not target:
        return None
    for family in get_all_families():
        if str(family.get('username') or '').strip().lower() == target:
            return family
    return None


def register_family(username: str, password: str) -> Dict:
    """Register a new family account."""
    username = str(username or '').strip()
    password = str(password or '')
    if not username:
        raise ValueError('Username is required')
    if not password:
        raise ValueError('Password is required')

    def _op(data: Dict):
        families = data.get('families', [])
        existing = {
            str(f.get('username') or '').strip().lower()
            for f in families
        }
        if len(families) >= MAX_FAMILIES:
            raise ValueError(f'Family limit reached ({MAX_FAMILIES})')
        if username.strip().lower() in existing:
            raise ValueError('Username already exists')

        next_id = 1 if not families else (max(int(f.get('id', 0)) for f in families) + 1)
        family = {
            'id': str(next_id),
            'username': username,
            'password': generate_password_hash(password, method=PASSWORD_HASH_METHOD),
            'hardCardPercentage': DEFAULT_HARD_CARD_PERCENTAGE,
            'createdAt': datetime.now().isoformat()
        }
        families.append(family)
        data['families'] = families
        return family
    return _mutate_metadata(_op)


def authenticate_family(username: str, password: str) -> Optional[Dict]:
    """Authenticate a family by username/password."""
    family = get_family_by_username(username)
    if not family:
        return None
    stored_password = str(family.get('password') or '')
    plain_input = str(password or '')
    if not stored_password:
        return None

    if not _is_password_hashed(stored_password):
        return None
    if not check_password_hash(stored_password, plain_input):
        return None

    return family


def update_family_password(family_id: str, current_password: str, new_password: str) -> bool:
    """Update one family's password after validating current password."""
    family_id = str(family_id or '')
    current_password = str(current_password or '')
    new_password = str(new_password or '')
    if not family_id or not current_password or not new_password:
        return False

    def _op(data: Dict):
        families = data.get('families', [])
        for i, family in enumerate(families):
            if str(family.get('id')) != family_id:
                continue
            stored_password = str(family.get('password') or '')
            if not _is_password_hashed(stored_password):
                return False
            if not check_password_hash(stored_password, current_password):
                return False
            families[i] = {
                **family,
                'password': generate_password_hash(new_password, method=PASSWORD_HASH_METHOD)
            }
            data['families'] = families
            return True
        return False
    return _mutate_metadata(_op)


def get_family_hard_card_percentage(family_id: str) -> int:
    """Get family-level hard-card percentage with safe default."""
    family = get_family_by_id(str(family_id or ''))
    if not family:
        return DEFAULT_HARD_CARD_PERCENTAGE
    value = family.get('hardCardPercentage', DEFAULT_HARD_CARD_PERCENTAGE)
    try:
        pct = int(value)
    except (TypeError, ValueError):
        return DEFAULT_HARD_CARD_PERCENTAGE
    if pct < MIN_HARD_CARD_PERCENTAGE:
        return MIN_HARD_CARD_PERCENTAGE
    if pct > MAX_HARD_CARD_PERCENTAGE:
        return MAX_HARD_CARD_PERCENTAGE
    return pct


def update_family_hard_card_percentage(family_id: str, hard_card_percentage: int) -> bool:
    """Update family-level hard-card percentage."""
    family_id = str(family_id or '')
    if not family_id:
        return False
    try:
        pct = int(hard_card_percentage)
    except (TypeError, ValueError):
        return False
    if pct < MIN_HARD_CARD_PERCENTAGE or pct > MAX_HARD_CARD_PERCENTAGE:
        return False

    def _op(data: Dict):
        families = data.get('families', [])
        for i, family in enumerate(families):
            if str(family.get('id')) != family_id:
                continue
            families[i] = {**family, 'hardCardPercentage': pct}
            data['families'] = families
            return True
        return False
    return _mutate_metadata(_op)


def cleanup_deprecated_metadata_config() -> Dict:
    """Remove deprecated metadata keys and keep only known config fields."""
    def _op(data: Dict):
        removed_top = 0
        removed_family = 0
        removed_kid = 0

        for key in list(data.keys()):
            if key not in ALLOWED_TOP_LEVEL_KEYS:
                data.pop(key, None)
                removed_top += 1

        families = []
        for family in data.get('families', []):
            if not isinstance(family, dict):
                continue
            cleaned_family = {k: v for k, v in family.items() if k in ALLOWED_FAMILY_KEYS}
            removed_family += len(family) - len(cleaned_family)
            families.append(cleaned_family)
        data['families'] = families

        kids = []
        for kid in data.get('kids', []):
            if not isinstance(kid, dict):
                continue
            cleaned_kid = {k: v for k, v in kid.items() if k in ALLOWED_KID_KEYS}
            removed_kid += len(kid) - len(cleaned_kid)
            kids.append(cleaned_kid)
        data['kids'] = kids

        return {
            'removedTopLevelKeys': removed_top,
            'removedFamilyKeys': removed_family,
            'removedKidKeys': removed_kid,
            'updated': (removed_top + removed_family + removed_kid) > 0
        }

    return _mutate_metadata(_op)
