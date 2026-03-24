"""Startup tasks for kid DBs."""
from pathlib import Path

import duckdb

from src.db import kid_db


def _iter_kid_db_paths():
    """Yield all kid DB files currently present on disk."""
    families_root = Path(kid_db.DATA_DIR) / 'families'
    if not families_root.exists():
        return
    yield from sorted(families_root.glob('family_*/kid_*.db'))


def ensure_kid_db_schema(logger):
    """Apply the current kid DB schema to every existing kid DB at startup."""
    updated_paths = []
    errors = []

    for db_path in _iter_kid_db_paths() or []:
        try:
            kid_db.ensure_kid_database_schema_by_path(str(db_path))
            updated_paths.append(str(db_path))
        except Exception as exc:
            errors.append(f'{db_path}: {exc}')

    if updated_paths:
        logger.info(
            'Applied current kid DB schema to %s DB(s): %s',
            len(updated_paths),
            ', '.join(updated_paths),
        )
    else:
        logger.info('No kid DB files found for startup schema sync.')

    if errors:
        logger.error(
            'Errors while applying current kid DB schema at startup: %s',
            '; '.join(errors),
        )

    # Repair writing cards whose back was corrupted by force_sync_chinese_bank_backs
    _repair_writing_card_backs(logger)


def _repair_writing_card_backs(logger):
    """Reset back=front for writing cards where back contains Latin text (pinyin/EN)."""
    total_fixed = 0
    for db_path in _iter_kid_db_paths() or []:
        try:
            conn = duckdb.connect(str(db_path))
            fixed = conn.execute("""
                UPDATE cards SET back = front
                WHERE deck_id IN (
                    SELECT id FROM decks WHERE list_contains(tags, 'chinese_writing')
                )
                AND regexp_matches(back, '[a-zA-Z]')
            """).fetchone()
            count = fixed[0] if fixed else 0
            if count:
                total_fixed += count
                logger.info('Repaired %s writing card back(s) in %s', count, db_path)
            conn.close()
        except Exception as exc:
            logger.error('Error repairing writing cards in %s: %s', db_path, exc)

    if total_fixed:
        logger.info('Total writing cards repaired: %s', total_fixed)
    else:
        logger.debug('No corrupted writing card backs found.')
