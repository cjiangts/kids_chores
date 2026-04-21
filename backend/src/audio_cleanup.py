"""Retention cleanup for kid lesson-reading recording audio."""
from datetime import datetime, timedelta, timezone
import fcntl
import logging
import os
import threading
import time

from src.db import kid_db, metadata


KID_AUDIO_RETENTION_DAYS = 14
_CLEANUP_LOCK_FILE = os.path.join(kid_db.DATA_DIR, 'kid_audio_cleanup.lock')
_SCHEDULER_LOCK = threading.Lock()
_SCHEDULER_STARTED = False


_AUDIO_ROWS_SQL = """
SELECT
    lra.result_id,
    sr.card_id,
    lra.file_name,
    COALESCE(lra.created_at, sr.timestamp, s.completed_at, s.started_at) AS recorded_at
FROM lesson_reading_audio lra
JOIN session_results sr ON sr.id = lra.result_id
LEFT JOIN sessions s ON s.id = sr.session_id
WHERE lra.file_name IS NOT NULL
  AND TRIM(lra.file_name) <> ''
  AND sr.card_id IS NOT NULL
ORDER BY
    sr.card_id ASC,
    recorded_at DESC NULLS LAST,
    lra.result_id DESC
"""


def _logger(logger):
    return logger or logging.getLogger(__name__)


def _utc_naive(value):
    """Return a UTC-naive datetime for DuckDB TIMESTAMP comparisons."""
    if value is None:
        return None
    if value.tzinfo is not None:
        return value.astimezone(timezone.utc).replace(tzinfo=None)
    return value


def _kid_type3_audio_dir(kid):
    family_id = str(kid.get('familyId') or '').strip()
    kid_id = str(kid.get('id') or '').strip()
    if not family_id or not kid_id:
        return ''
    return os.path.abspath(
        os.path.join(
            kid_db.DATA_DIR,
            'families',
            f'family_{family_id}',
            'lesson_reading_audio',
            f'kid_{kid_id}',
        )
    )


def _safe_audio_path(audio_dir, file_name):
    file_name = str(file_name or '').strip()
    if not audio_dir or not file_name or os.path.basename(file_name) != file_name:
        return None
    audio_dir_abs = os.path.abspath(audio_dir)
    candidate = os.path.abspath(os.path.join(audio_dir_abs, file_name))
    try:
        if os.path.commonpath([audio_dir_abs, candidate]) != audio_dir_abs:
            return None
    except ValueError:
        return None
    return candidate


def _acquire_cleanup_lock():
    os.makedirs(kid_db.DATA_DIR, exist_ok=True)
    handle = open(_CLEANUP_LOCK_FILE, 'a+', encoding='utf-8')
    try:
        fcntl.flock(handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        return handle
    except BlockingIOError:
        handle.close()
        return None


def _delete_metadata_rows(conn, result_ids):
    if not result_ids:
        return 0
    conn.execute('BEGIN TRANSACTION')
    try:
        for result_id in result_ids:
            conn.execute(
                'DELETE FROM lesson_reading_audio WHERE result_id = ?',
                [int(result_id)],
            )
        conn.execute('COMMIT')
    except Exception:
        try:
            conn.execute('ROLLBACK')
        except Exception:
            pass
        raise
    return len(result_ids)


def cleanup_old_kid_audio(logger=None, *, now=None, retention_days=KID_AUDIO_RETENTION_DAYS):
    """Delete old type-III kid recordings when a newer recording exists for the same card."""
    log = _logger(logger)
    lock_handle = _acquire_cleanup_lock()
    if lock_handle is None:
        log.info('Kid audio cleanup skipped because another cleanup is already running.')
        return {
            'skippedDueToLock': True,
            'retentionDays': int(retention_days),
        }

    started_at = time.perf_counter()
    cutoff = _utc_naive(now or datetime.now(timezone.utc)) - timedelta(
        days=int(retention_days)
    )
    stats = {
        'skippedDueToLock': False,
        'retentionDays': int(retention_days),
        'cutoffUtc': cutoff.replace(tzinfo=timezone.utc).isoformat(),
        'kidsScanned': 0,
        'kidsSkippedNoDb': 0,
        'candidateFiles': 0,
        'deletedFiles': 0,
        'deletedBytes': 0,
        'missingFiles': 0,
        'deletedMetadataRows': 0,
        'unsafeFileNames': 0,
        'errors': [],
    }

    try:
        try:
            kids = metadata.get_all_kids()
        except Exception as exc:
            stats['errors'].append(f'load kids metadata: {exc}')
            kids = []
        stats['kidsScanned'] = len(kids)

        for kid in kids:
            kid_id = str(kid.get('id') or '').strip()
            db_file_path = str(kid.get('dbFilePath') or '').strip()
            if not db_file_path:
                stats['kidsSkippedNoDb'] += 1
                continue

            try:
                db_abs_path = kid_db.get_absolute_db_path(db_file_path)
            except Exception as exc:
                stats['kidsSkippedNoDb'] += 1
                stats['errors'].append(f'kid {kid_id}: invalid db path: {exc}')
                continue
            if not os.path.exists(db_abs_path):
                stats['kidsSkippedNoDb'] += 1
                continue

            audio_dir = _kid_type3_audio_dir(kid)
            metadata_delete_result_ids = []
            newer_existing_cards = set()
            conn = None
            try:
                conn = kid_db.get_kid_connection_by_path(db_file_path)
                rows = conn.execute(_AUDIO_ROWS_SQL).fetchall()

                for row in rows:
                    result_id = int(row[0])
                    card_id = int(row[1])
                    file_name = str(row[2] or '').strip()
                    recorded_at = _utc_naive(row[3])
                    audio_path = _safe_audio_path(audio_dir, file_name)
                    file_exists = bool(audio_path and os.path.exists(audio_path))

                    if (
                        recorded_at is not None
                        and recorded_at < cutoff
                        and card_id in newer_existing_cards
                    ):
                        stats['candidateFiles'] += 1
                        if audio_path is None:
                            stats['unsafeFileNames'] += 1
                            stats['errors'].append(
                                f'kid {kid_id}: unsafe audio filename for result {result_id}: {file_name}'
                            )
                            continue

                        if file_exists:
                            try:
                                size_bytes = int(os.path.getsize(audio_path))
                            except Exception:
                                size_bytes = 0
                            try:
                                os.remove(audio_path)
                                stats['deletedFiles'] += 1
                                stats['deletedBytes'] += max(0, size_bytes)
                                metadata_delete_result_ids.append(result_id)
                            except Exception as exc:
                                stats['errors'].append(
                                    f'kid {kid_id}: failed deleting {file_name}: {exc}'
                                )
                                continue
                        else:
                            stats['missingFiles'] += 1
                            metadata_delete_result_ids.append(result_id)
                            continue

                    if file_exists:
                        newer_existing_cards.add(card_id)

                if metadata_delete_result_ids:
                    stats['deletedMetadataRows'] += _delete_metadata_rows(
                        conn,
                        metadata_delete_result_ids,
                    )
            except Exception as exc:
                stats['errors'].append(f'kid {kid_id}: {exc}')
            finally:
                if conn is not None:
                    try:
                        conn.close()
                    except Exception:
                        pass

        duration_ms = (time.perf_counter() - started_at) * 1000.0
        log.info(
            'Kid audio cleanup finished: kids=%s candidates=%s files_deleted=%s '
            'bytes_deleted=%s metadata_deleted=%s missing=%s unsafe=%s errors=%s duration_ms=%.1f',
            stats['kidsScanned'],
            stats['candidateFiles'],
            stats['deletedFiles'],
            stats['deletedBytes'],
            stats['deletedMetadataRows'],
            stats['missingFiles'],
            stats['unsafeFileNames'],
            len(stats['errors']),
            duration_ms,
        )
        if stats['errors']:
            log.warning('Kid audio cleanup errors: %s', '; '.join(stats['errors'][:20]))
        return stats
    finally:
        try:
            fcntl.flock(lock_handle.fileno(), fcntl.LOCK_UN)
        finally:
            lock_handle.close()


def _seconds_until_next_midnight_utc():
    now = datetime.now(timezone.utc)
    next_midnight = (now + timedelta(days=1)).replace(
        hour=0,
        minute=0,
        second=0,
        microsecond=0,
    )
    return max(1.0, (next_midnight - now).total_seconds())


def _run_cleanup_with_log_guard(logger):
    try:
        cleanup_old_kid_audio(logger)
    except Exception:
        _logger(logger).exception('Kid audio cleanup crashed unexpectedly.')


def _cleanup_scheduler_loop(logger):
    _run_cleanup_with_log_guard(logger)
    while True:
        time.sleep(_seconds_until_next_midnight_utc())
        _run_cleanup_with_log_guard(logger)


def start_kid_audio_cleanup_scheduler(logger=None):
    """Start the startup-and-midnight UTC kid audio cleanup thread once per process."""
    global _SCHEDULER_STARTED
    with _SCHEDULER_LOCK:
        if _SCHEDULER_STARTED:
            return False
        thread = threading.Thread(
            target=_cleanup_scheduler_loop,
            args=(_logger(logger),),
            name='kid-audio-cleanup',
            daemon=True,
        )
        thread.start()
        _SCHEDULER_STARTED = True
        return True
