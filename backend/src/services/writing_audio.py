"""Audio path / metadata / synthesis helpers for kid writing flows.

Pure helpers extracted from `src.routes.kids` Phase 2 refactor.

Layout:
  1. Shared writing-audio dir + text/language normalizers
  2. TTS text builders + bulk-format helpers
  3. Audio file naming (writing + Type-I prompt)
  4. Meta + payload builders (writing + Type-I Chinese)
  5. TTS synthesis (writes shared audio files)
  6. Type-III per-kid audio dir + pending/uncommitted cleanup
"""
import hashlib
import mimetypes
import os
import re
import uuid
from urllib.parse import quote

from src.routes.kids_constants import (
    DATA_DIR,
    FAMILIES_ROOT,
    WRITING_AUDIO_EXTENSION,
    WRITING_AUDIO_FILE_NAME_MAX_BYTES,
    WRITING_TTS_LANGUAGE_EN,
    WRITING_TTS_LANGUAGE_ZH,
)


# =====================================================================
# === 1. Shared writing-audio dir + text/language normalizers
# =====================================================================

def get_shared_writing_audio_dir():
    """Get global shared directory for auto-generated writing prompt audio."""
    return os.path.join(DATA_DIR, 'shared', 'writing_audio')


def ensure_shared_writing_audio_dir():
    """Ensure global shared writing-audio directory exists."""
    path = get_shared_writing_audio_dir()
    os.makedirs(path, exist_ok=True)
    return path


def normalize_writing_audio_text(front_text):
    """Normalize card front text used for deterministic TTS filenames."""
    text = re.sub(r'\s+', ' ', str(front_text or '').strip())
    return text


def get_writing_tts_language(has_chinese_specific_logic=True):
    """Choose type-II TTS language from category mode."""
    return WRITING_TTS_LANGUAGE_ZH if bool(has_chinese_specific_logic) else WRITING_TTS_LANGUAGE_EN


# =====================================================================
# === 2. TTS text builders + bulk-format helpers
# =====================================================================

def build_writing_front_tts_text(front_text, back_text):
    """Build spoken text for front prompt clip."""
    front_norm = normalize_writing_audio_text(front_text)
    back_norm = normalize_writing_audio_text(back_text)
    if not front_norm:
        return ''
    if back_norm and back_norm != front_norm:
        return f"{front_norm}, {back_norm}"
    return front_norm


def format_type2_bulk_card_text(front_text, back_text, has_chinese_specific_logic):
    """Return one user-facing card label for type-II bulk-add status messages."""
    front = str(front_text or '').strip()
    back = str(back_text or '').strip()
    if bool(has_chinese_specific_logic) or not back or back == front:
        return front or back
    return f'{front} -> {back}'


# =====================================================================
# === 3. Audio file naming (writing + Type-I prompt)
# =====================================================================

def build_shared_writing_audio_file_name(front_text, back_text):
    """Build deterministic shared audio filename keyed on the (front, back) pair.

    Different cards that happen to share a front but have different backs must
    produce different audio files — the spoken clip is "{front}, {back}" so the
    content differs and they cannot share an mp3.
    """
    normalized_front = normalize_writing_audio_text(front_text)
    if not normalized_front:
        return ''
    normalized_back = normalize_writing_audio_text(back_text)

    safe = normalized_front.replace('/', '／').replace('\\', '＼').replace('\x00', '')
    safe = safe.strip().strip('.')
    if not safe:
        safe = 'tts'

    digest = hashlib.sha1(
        f"{normalized_front}\x1f{normalized_back}".encode('utf-8')
    ).hexdigest()[:8]

    file_name = f"{safe}_{digest}{WRITING_AUDIO_EXTENSION}"
    if len(file_name.encode('utf-8')) <= WRITING_AUDIO_FILE_NAME_MAX_BYTES:
        return file_name

    prefix = safe[:40].strip() or 'tts'
    return f"{prefix}_{digest}{WRITING_AUDIO_EXTENSION}"


def build_shared_type1_prompt_audio_file_name(front_text):
    """Build deterministic shared audio filename for type-I Chinese prompt speech."""
    normalized = normalize_writing_audio_text(front_text)
    if not normalized:
        return ''

    safe = normalized.replace('/', '／').replace('\\', '＼').replace('\x00', '')
    safe = safe.strip().strip('.')
    if not safe:
        safe = 'type1_prompt'

    file_name = f"type1_prompt_{safe}{WRITING_AUDIO_EXTENSION}"
    if len(file_name.encode('utf-8')) <= WRITING_AUDIO_FILE_NAME_MAX_BYTES:
        return file_name

    digest = hashlib.sha1(normalized.encode('utf-8')).hexdigest()[:12]
    prefix = f"type1_prompt_{safe[:24].strip() or 'tts'}"
    return f"{prefix}_{digest}{WRITING_AUDIO_EXTENSION}"


# =====================================================================
# === 4. Meta + payload builders (writing + Type-I Chinese)
# =====================================================================

def build_writing_audio_meta_for_card(
    kid_id,
    front_text,
    back_text,
    *,
    category_key,
):
    """Build writing audio metadata payload for one (front, back) card."""
    file_name = build_shared_writing_audio_file_name(front_text, back_text)
    if not file_name:
        return {
            'audio_file_name': None,
            'audio_mime_type': None,
            'audio_url': None,
        }

    mime_type = mimetypes.guess_type(file_name)[0] or 'audio/mpeg'
    query = (
        f"?categoryKey={quote(str(category_key).strip(), safe='')}"
        if str(category_key or '').strip()
        else ''
    )
    encoded_file_name = quote(file_name, safe='')
    return {
        'audio_file_name': file_name,
        'audio_mime_type': mime_type,
        'audio_url': f"/api/kids/{kid_id}/type2/audio/{encoded_file_name}{query}",
    }


def build_writing_prompt_audio_payload(
    kid_id,
    front_text,
    back_text,
    *,
    category_key,
):
    """Build writing prompt audio payload for one (front, back) card."""
    meta = build_writing_audio_meta_for_card(
        kid_id,
        front_text,
        back_text,
        category_key=category_key,
    )

    return {
        'audio_file_name': meta.get('audio_file_name'),
        'audio_mime_type': meta.get('audio_mime_type'),
        'audio_url': meta.get('audio_url'),
        'prompt_audio_url': meta.get('audio_url'),
    }


def build_type_i_chinese_audio_meta_for_front(
    kid_id,
    front_text,
    *,
    category_key,
):
    """Build type-I Chinese prompt audio metadata for one front text."""
    file_name = build_shared_type1_prompt_audio_file_name(front_text)
    if not file_name:
        return {
            'audio_file_name': None,
            'audio_mime_type': None,
            'audio_url': None,
        }

    mime_type = mimetypes.guess_type(file_name)[0] or 'audio/mpeg'
    query = (
        f"?categoryKey={quote(str(category_key).strip(), safe='')}"
        if str(category_key or '').strip()
        else ''
    )
    encoded_file_name = quote(file_name, safe='')
    return {
        'audio_file_name': file_name,
        'audio_mime_type': mime_type,
        'audio_url': f"/api/kids/{kid_id}/cards/audio/{encoded_file_name}{query}",
    }


def build_type_i_chinese_prompt_audio_payload(
    kid_id,
    front_text,
    *,
    category_key,
):
    """Build type-I Chinese prompt audio payload using the spoken front text only."""
    front_meta = build_type_i_chinese_audio_meta_for_front(
        kid_id,
        front_text,
        category_key=category_key,
    )
    return {
        'audio_file_name': front_meta.get('audio_file_name'),
        'audio_mime_type': front_meta.get('audio_mime_type'),
        'audio_url': front_meta.get('audio_url'),
        'prompt_audio_url': front_meta.get('audio_url'),
    }


# =====================================================================
# === 5. TTS synthesis (writes shared audio files)
# =====================================================================

def synthesize_shared_writing_audio(
    file_name,
    spoken_text,
    *,
    has_chinese_specific_logic=True,
    overwrite=False,
):
    """Generate shared TTS clip for `spoken_text` into `file_name`."""
    file_name = str(file_name or '').strip()
    if not file_name:
        raise ValueError('Audio file name is empty')

    normalized_spoken = normalize_writing_audio_text(spoken_text)
    if not normalized_spoken:
        raise ValueError('Card prompt text is empty, cannot generate audio')

    tts_language = get_writing_tts_language(has_chinese_specific_logic)

    audio_dir = ensure_shared_writing_audio_dir()
    audio_path = os.path.join(audio_dir, file_name)
    if (not overwrite) and os.path.exists(audio_path):
        return file_name, False

    temp_path = f"{audio_path}.{uuid.uuid4().hex}.tmp"
    try:
        from gtts import gTTS
        tts = gTTS(text=normalized_spoken, lang=tts_language, slow=False)
        tts.save(temp_path)
        if (not os.path.exists(temp_path)) or os.path.getsize(temp_path) == 0:
            raise RuntimeError('gTTS produced an empty audio file')
        os.replace(temp_path, audio_path)
        return file_name, True
    except Exception as gtts_exc:
        raise RuntimeError(f'Auto TTS failed (gTTS): {gtts_exc}') from gtts_exc
    finally:
        if os.path.exists(temp_path):
            try:
                os.remove(temp_path)
            except OSError:
                pass


# =====================================================================
# === 6. Type-III per-kid audio dir + pending/uncommitted cleanup
# =====================================================================

def get_kid_type3_audio_dir(kid):
    """Get filesystem directory for kid type-III recording files."""
    family_id = str(kid.get('familyId') or '')
    kid_id = kid.get('id')
    family_root = os.path.join(FAMILIES_ROOT, f'family_{family_id}')
    return os.path.join(family_root, 'lesson_reading_audio', f'kid_{kid_id}')


def ensure_type3_audio_dir(kid):
    """Ensure kid type-III audio directory exists."""
    path = get_kid_type3_audio_dir(kid)
    os.makedirs(path, exist_ok=True)
    return path


def cleanup_type3_pending_audio_files_by_payload(pending_payload):
    """Delete uploaded type-III recording files for one pending session payload."""
    if not pending_payload:
        return
    type3_audio_by_card = pending_payload.get('type3_audio_by_card')
    if not isinstance(type3_audio_by_card, dict) or len(type3_audio_by_card) == 0:
        return
    audio_dir = str(pending_payload.get('type3_audio_dir') or '').strip()
    if not audio_dir:
        return
    for item in type3_audio_by_card.values():
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


def cleanup_uncommitted_type3_audio(written_paths, pending_payload):
    """Cleanup audio files created/queued for an uncommitted type-III session."""
    for file_path in list(written_paths or []):
        try:
            if os.path.exists(file_path):
                os.remove(file_path)
        except Exception:
            pass
    cleanup_type3_pending_audio_files_by_payload(pending_payload)
