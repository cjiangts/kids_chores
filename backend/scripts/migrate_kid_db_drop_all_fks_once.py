#!/usr/bin/env python3
"""Compatibility entrypoint for one-time kid DB migration that drops all FKs."""

from migrate_kid_db_nullable_deck_id import main


if __name__ == "__main__":
    raise SystemExit(main())

