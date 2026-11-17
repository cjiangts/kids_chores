"""Minimal server record: device binding and two lifecycle timestamps."""
from src.services.family_auth import get_kid_connection_for


def ensure(conn):
    conn.execute('''CREATE TABLE IF NOT EXISTS offline_packages (
        id VARCHAR PRIMARY KEY, device_id VARCHAR NOT NULL, days INTEGER NOT NULL,
        activated_at TIMESTAMP, completed_at TIMESTAMP
    )''')


def status(activated_at, completed_at):
    if completed_at is not None:
        return 'completed'
    return 'active' if activated_at is not None else 'preparing'


def current(kid, conn=None):
    owns_connection = conn is None
    if owns_connection:
        conn = get_kid_connection_for(kid, read_only=True)
    try:
        exists = conn.execute("SELECT COUNT(*) FROM information_schema.tables WHERE table_name='offline_packages'").fetchone()[0]
        if not exists:
            return None
        row = conn.execute('SELECT id, device_id, activated_at FROM offline_packages WHERE completed_at IS NULL LIMIT 1').fetchone()
        return {'id': row[0], 'deviceId': row[1], 'status': status(row[2], None),
                'activatedAt': row[2].isoformat() + 'Z' if row[2] else None} if row else None
    finally:
        if owns_connection:
            conn.close()


def load(conn, package_id, device_id):
    row = conn.execute('SELECT id, device_id, days, activated_at, completed_at FROM offline_packages WHERE id=?', [package_id]).fetchone()
    if not row:
        raise LookupError('This offline package has been deleted from the server. It can no longer be uploaded. Local results have been kept on this device.')
    if row[1] != device_id:
        raise ValueError('Offline package does not belong to this device')
    return {'id': row[0], 'deviceId': row[1], 'days': row[2],
            'status': status(row[3], row[4]), 'activatedAt': row[3], 'completedAt': row[4]}
