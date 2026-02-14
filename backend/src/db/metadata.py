"""Metadata manager for kids.json"""
import json
import os
from datetime import datetime
from typing import List, Dict, Optional

METADATA_FILE = os.path.join(os.path.dirname(__file__), '../../data/kids.json')

def ensure_metadata_file():
    """Create metadata file if it doesn't exist"""
    os.makedirs(os.path.dirname(METADATA_FILE), exist_ok=True)
    if not os.path.exists(METADATA_FILE):
        # Write initial empty metadata directly to avoid recursion
        initial_data = {'kids': [], 'lastUpdated': datetime.now().isoformat()}
        with open(METADATA_FILE, 'w', encoding='utf-8') as f:
            json.dump(initial_data, f, indent=2, ensure_ascii=False)

def load_metadata() -> Dict:
    """Load kids metadata from JSON file"""
    ensure_metadata_file()
    with open(METADATA_FILE, 'r', encoding='utf-8') as f:
        return json.load(f)

def save_metadata(data: Dict):
    """Save kids metadata to JSON file"""
    ensure_metadata_file()
    data['lastUpdated'] = datetime.now().isoformat()
    with open(METADATA_FILE, 'w', encoding='utf-8') as f:
        json.dump(data, f, indent=2, ensure_ascii=False)

def get_all_kids() -> List[Dict]:
    """Get all kids"""
    metadata = load_metadata()
    return metadata.get('kids', [])

def get_kid_by_id(kid_id: str) -> Optional[Dict]:
    """Get a specific kid by ID"""
    kids = get_all_kids()
    return next((k for k in kids if k['id'] == kid_id), None)

def add_kid(kid: Dict) -> Dict:
    """Add a new kid"""
    metadata = load_metadata()
    kids = metadata.get('kids', [])
    kids.append(kid)
    metadata['kids'] = kids
    save_metadata(metadata)
    return kid

def delete_kid(kid_id: str) -> bool:
    """Delete a kid"""
    metadata = load_metadata()
    kids = metadata.get('kids', [])
    original_length = len(kids)
    kids = [k for k in kids if k['id'] != kid_id]
    if len(kids) < original_length:
        metadata['kids'] = kids
        save_metadata(metadata)
        return True
    return False

def update_kid(kid_id: str, updates: Dict) -> Optional[Dict]:
    """Update fields for a specific kid"""
    metadata = load_metadata()
    kids = metadata.get('kids', [])

    for i, kid in enumerate(kids):
        if kid.get('id') == kid_id:
            updated_kid = {**kid, **updates}
            kids[i] = updated_kid
            metadata['kids'] = kids
            save_metadata(metadata)
            return updated_kid

    return None
