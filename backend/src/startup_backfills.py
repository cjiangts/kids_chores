"""Startup tasks for kid DBs."""
from pathlib import Path

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
