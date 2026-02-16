"""Metadata manager for kids/families metadata JSON."""
import json
import os
from datetime import datetime
from typing import List, Dict, Optional
from werkzeug.security import generate_password_hash, check_password_hash

METADATA_FILE = os.path.join(os.path.dirname(__file__), '../../data/kids.json')
MAX_FAMILIES = 10
PASSWORD_HASH_METHOD = 'pbkdf2:sha256'


def _normalize(data: Dict) -> Dict:
    """Normalize metadata shape in-memory."""
    if 'families' not in data or not isinstance(data.get('families'), list):
        data['families'] = []
    if 'kids' not in data or not isinstance(data.get('kids'), list):
        data['kids'] = []
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

def load_metadata() -> Dict:
    """Load metadata from JSON file."""
    ensure_metadata_file()
    with open(METADATA_FILE, 'r', encoding='utf-8') as f:
        data = json.load(f)

    before = json.dumps(data, sort_keys=True, ensure_ascii=False)
    normalized = _normalize(data)
    after = json.dumps(normalized, sort_keys=True, ensure_ascii=False)
    if before != after:
        save_metadata(normalized)
    return normalized

def save_metadata(data: Dict):
    """Save metadata to JSON file."""
    ensure_metadata_file()
    data = _normalize(data)
    data['lastUpdated'] = datetime.now().isoformat()
    with open(METADATA_FILE, 'w', encoding='utf-8') as f:
        json.dump(data, f, indent=2, ensure_ascii=False)

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
    metadata = load_metadata()
    kids = metadata.get('kids', [])
    kids.append(kid)
    metadata['kids'] = kids
    save_metadata(metadata)
    return kid

def delete_kid(kid_id, family_id: Optional[str] = None) -> bool:
    """Delete a kid, optionally constrained to one family."""
    metadata = load_metadata()
    kids = metadata.get('kids', [])
    original_length = len(kids)
    kid_id_str = str(kid_id)
    if family_id is None:
        kids = [k for k in kids if str(k['id']) != kid_id_str]
    else:
        family_id = str(family_id)
        kids = [k for k in kids if not (str(k['id']) == kid_id_str and str(k.get('familyId')) == family_id)]
    if len(kids) < original_length:
        metadata['kids'] = kids
        save_metadata(metadata)
        return True
    return False

def update_kid(kid_id, updates: Dict, family_id: Optional[str] = None) -> Optional[Dict]:
    """Update fields for a specific kid, optionally constrained to one family."""
    metadata = load_metadata()
    kids = metadata.get('kids', [])
    kid_id_str = str(kid_id)

    for i, kid in enumerate(kids):
        same_id = str(kid.get('id')) == kid_id_str
        same_family = family_id is None or str(kid.get('familyId')) == str(family_id)
        if same_id and same_family:
            updated_kid = {**kid, **updates}
            kids[i] = updated_kid
            metadata['kids'] = kids
            save_metadata(metadata)
            return updated_kid

    return None


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

    metadata = load_metadata()
    families = metadata.get('families', [])
    if len(families) >= MAX_FAMILIES:
        raise ValueError(f'Family limit reached ({MAX_FAMILIES})')
    if get_family_by_username(username):
        raise ValueError('Username already exists')

    next_id = 1 if not families else (max(int(f.get('id', 0)) for f in families) + 1)
    family = {
        'id': str(next_id),
        'username': username,
        'password': generate_password_hash(password, method=PASSWORD_HASH_METHOD),
        'createdAt': datetime.now().isoformat()
    }
    families.append(family)
    metadata['families'] = families
    save_metadata(metadata)
    return family


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

    metadata = load_metadata()
    families = metadata.get('families', [])
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
        metadata['families'] = families
        save_metadata(metadata)
        return True
    return False
