"""Shared MP3 materialization for playback and daily recording maintenance."""
from contextlib import contextmanager
import fcntl
import os
import subprocess
import threading
import uuid

from src.services.audio_io import resolve_ffmpeg_executable


_LOCKS = {}
_LOCKS_GUARD = threading.Lock()


def recording_file_names(file_name):
    """Primary upload and its optional cached MP3, without duplicate names."""
    return {file_name, f'{os.path.splitext(file_name)[0]}.mp3'}


@contextmanager
def recording_audio_lock(audio_dir):
    """Serialize file conversion/removal with playback, including other workers."""
    key = os.path.abspath(audio_dir)
    with _LOCKS_GUARD:
        lock = _LOCKS.setdefault(key, threading.Lock())
    with lock:
        with open(os.path.join(key, '.recording-audio.lock'), 'a') as handle:
            fcntl.flock(handle.fileno(), fcntl.LOCK_EX)
            try:
                yield
            finally:
                fcntl.flock(handle.fileno(), fcntl.LOCK_UN)


def _valid_mp3(ffmpeg, path):
    if not os.path.isfile(path) or os.path.getsize(path) == 0:
        return False
    result = subprocess.run(
        [ffmpeg, '-v', 'error', '-xerror', '-i', path,
         '-map', '0:a:0', '-f', 'null', '-'],
        stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, timeout=120,
    )
    return result.returncode == 0


def ensure_recording_mp3(audio_dir, file_name, *, validate_existing=False):
    """Materialize a nonempty MP3 atomically. Caller holds recording_audio_lock.

    Daily maintenance validates existing caches before retiring the original.
    This function never deletes the original or changes recording metadata.
    """
    if not file_name or os.path.basename(file_name) != file_name:
        raise ValueError('Invalid recording file name')
    sibling_name = f'{os.path.splitext(file_name)[0]}.mp3'
    sibling_path = os.path.join(audio_dir, sibling_name)
    if os.path.islink(os.path.join(audio_dir, file_name)) or os.path.islink(sibling_path):
        raise ValueError('Recording paths must not be symlinks')
    ffmpeg = resolve_ffmpeg_executable()
    if os.path.isfile(sibling_path) and os.path.getsize(sibling_path) > 0:
        if not validate_existing:
            return sibling_name
        if not ffmpeg:
            raise RuntimeError('FFmpeg is unavailable; original recording retained')
        if _valid_mp3(ffmpeg, sibling_path):
            return sibling_name
    if not ffmpeg:
        raise RuntimeError('FFmpeg is unavailable; original recording retained')
    if file_name == sibling_name:
        raise RuntimeError('Existing MP3 recording is invalid')

    temp_path = f'{sibling_path}.{uuid.uuid4().hex}.tmp'
    try:
        result = subprocess.run(
            [ffmpeg, '-v', 'error', '-xerror', '-i', os.path.join(audio_dir, file_name),
             '-map', '0:a:0', '-vn', '-c:a', 'libmp3lame', '-b:a', '160k',
             '-f', 'mp3', temp_path],
            stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, timeout=120,
        )
        if result.returncode != 0 or not os.path.isfile(temp_path) or os.path.getsize(temp_path) == 0:
            raise RuntimeError('MP3 conversion failed; original recording retained')
        os.replace(temp_path, sibling_path)
        return sibling_name
    finally:
        if os.path.exists(temp_path):
            os.remove(temp_path)
