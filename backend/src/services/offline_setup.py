"""Create the minimal server-side reservation for an offline package."""
from uuid import uuid4
from src.services.family_auth import get_kid_connection_for
from src.services.offline import repository

MIN_DAYS = 1
MAX_DAYS = 30


def has_active_package(kid):
    return bool(repository.current(kid))


def save_setup(kid, days, device_id):
    if type(days) is not int or not MIN_DAYS <= days <= MAX_DAYS:
        raise ValueError(f'Choose between {MIN_DAYS} and {MAX_DAYS} days')
    if not isinstance(device_id, str) or not 16 <= len(device_id) <= 100:
        raise ValueError('Device identification is missing')
    conn = get_kid_connection_for(kid)
    try:
        repository.ensure(conn)
        conn.execute('BEGIN TRANSACTION')
        if conn.execute('SELECT COUNT(*) FROM offline_packages WHERE completed_at IS NULL').fetchone()[0]:
            raise ValueError(f"{kid['name']} already has an offline package in use")
        package_id = uuid4().hex
        conn.execute('INSERT INTO offline_packages(id, device_id, days) VALUES (?, ?, ?)', [package_id, device_id, days])
        conn.execute('COMMIT')
        return {'id': package_id, 'kidId': str(kid['id']), 'days': days, 'status': 'preparing'}
    except Exception:
        try:
            conn.execute('ROLLBACK')
        except Exception:
            pass
        raise
    finally:
        conn.close()
