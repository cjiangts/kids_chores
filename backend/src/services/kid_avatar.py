"""Per-kid avatar image storage.

The cropped circular PNG lives next to the kid DB under
``data/families/family_<fid>/kid_<kid_id>_avatar.png``, so the full backup
(which zips all of DATA_DIR) includes and restores it automatically. Only a
``avatarUpdatedAt`` version stamp is kept on the kid metadata record; the
served URL carries that stamp as ``?v=`` so the browser can cache the image
immutably and refetch only when it changes.
"""
import base64
import os
import re
import time

from src.db.metadata import update_kid

DATA_DIR = os.path.join(os.path.dirname(__file__), '../../data')
MAX_AVATAR_BYTES = 600 * 1024
_PNG_MAGIC = b'\x89PNG\r\n\x1a\n'
_DATA_URL_PREFIX_RE = re.compile(r'^data:image/png;base64,', re.IGNORECASE)


def _family_dir(family_id):
    return os.path.join(DATA_DIR, 'families', f'family_{family_id}')


def avatar_path(family_id, kid_id):
    return os.path.join(_family_dir(family_id), f'kid_{kid_id}_avatar.png')


def avatar_url_for_kid(kid):
    """Versioned avatar URL for a kid metadata dict, or None when unset."""
    version = kid.get('avatarUpdatedAt')
    if not version:
        return None
    return f"/api/kids/{kid.get('id')}/avatar?v={version}"


def decode_png_data_url(image_base64):
    raw = str(image_base64 or '').strip()
    if not raw:
        raise ValueError('Image is required.')
    raw = _DATA_URL_PREFIX_RE.sub('', raw)
    if raw.startswith('data:'):
        raise ValueError('Avatar must be a PNG image.')
    try:
        data = base64.b64decode(raw, validate=True)
    except Exception:
        raise ValueError('Invalid image data.')
    if len(data) > MAX_AVATAR_BYTES:
        raise ValueError('Image is too large.')
    if not data.startswith(_PNG_MAGIC):
        raise ValueError('Avatar must be a PNG image.')
    return data


def save_avatar(family_id, kid_id, image_base64):
    """Write the cropped PNG and stamp the kid record. Returns the version."""
    data = decode_png_data_url(image_base64)
    path = avatar_path(family_id, kid_id)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp_path = f'{path}.tmp'
    with open(tmp_path, 'wb') as handle:
        handle.write(data)
    os.replace(tmp_path, path)
    version = int(time.time() * 1000)
    update_kid(kid_id, {'avatarUpdatedAt': version}, family_id=family_id)
    return version


def delete_avatar(family_id, kid_id, *, clear_metadata=True):
    """Remove the avatar file; optionally clear the metadata stamp too."""
    try:
        os.remove(avatar_path(family_id, kid_id))
    except FileNotFoundError:
        pass
    if clear_metadata:
        update_kid(kid_id, {'avatarUpdatedAt': None}, family_id=family_id)
