"""Audio-IO helpers: download filename sanitizer + ffmpeg path resolver.

Pure helpers used by lesson-reading and other audio download paths to:
  - Sanitize a user-facing filename stem while preserving Unicode and
    stripping path separators / control chars / leading dots.
  - Resolve the ffmpeg binary path (env override > system > bundled
    imageio_ffmpeg fallback) for environments without system ffmpeg.

No DB, no Flask, no module state.
"""
import os
import re
import shutil


def sanitize_download_filename_stem(raw_name, fallback='recording'):
    """Return safe user-facing filename stem while preserving Unicode text."""
    text = str(raw_name or '').strip()
    if not text:
        text = fallback
    text = re.sub(r'[\x00-\x1f\x7f]+', '', text)
    text = text.replace('/', '／').replace('\\', '＼')
    text = text.strip().strip('.')
    if not text:
        text = fallback
    # Keep names reasonable for browser download dialogs.
    return text[:120]


def resolve_ffmpeg_executable():
    """Resolve ffmpeg binary path for environments without system ffmpeg."""
    configured = str(os.environ.get('FFMPEG_BIN') or '').strip()
    if configured:
        return configured

    system_ffmpeg = shutil.which('ffmpeg')
    if system_ffmpeg:
        return system_ffmpeg

    try:
        import imageio_ffmpeg  # type: ignore
        bundled = str(imageio_ffmpeg.get_ffmpeg_exe() or '').strip()
        if bundled:
            return bundled
    except Exception:
        return ''

    return ''
