"""Preparation reserves the child; activation is acknowledged after durable download."""
from pathlib import Path
from threading import RLock
from src.db.shared_deck_db import get_shared_decks_connection
from src.services.family_auth import get_kid_connection_for
from . import repository, handoff, planning

LOCK = RLock()
FRONTEND = Path(__file__).resolve().parents[4] / 'frontend'


def assets():
    result = set()
    queue = ['/offline/home.html', '/offline/practice-data.js', '/offline/practice-api.js', '/offline/parent-api.js', '/admin.html', '/kid-session-report.html', '/kid-practice-home.html', '/kid-practice.html', '/writing-sheet-print.html', '/math-sheet-print.html']
    import re
    while queue:
        url = queue.pop()
        path = FRONTEND / url.lstrip('/').split('?', 1)[0]
        if url in result or not path.is_file():
            continue
        result.add(url)
        if path.suffix not in ('.html', '.css', '.js'):
            continue
        text = path.read_text()
        refs = re.findall(r'(?:src|href)=["\']([^"\']+)["\']', text) if path.suffix == '.html' else []
        refs += re.findall(r'url\(["\']?([^\)"\']+)', text) if path.suffix == '.css' else []
        for ref in refs:
            if ref.startswith(('http:', 'https:', 'data:', '#')):
                continue
            from posixpath import normpath, join, dirname
            target = normpath(ref if ref.startswith('/') else join(dirname(url), ref)).split('?', 1)[0]
            if target.startswith('/'):
                queue.append(target)
    return sorted(result)


def prepare(kid, package_id, device_id, parent_auth):
    with LOCK:
        conn = get_kid_connection_for(kid)
        shared = None
        try:
            shared = get_shared_decks_connection(read_only=True)
            package = repository.load(conn, package_id, device_id)
            if package['status'] != 'preparing':
                raise ValueError('This package is already being prepared or used')
            report = handoff.inspect(conn, kid)
            handoff.require_ready(report)
            manifest = planning.build(conn, shared, kid, package, report)
            manifest['parentAuth'] = parent_auth
            manifest['assets'] = list(dict.fromkeys(manifest['assets'] + assets()))
            manifest['deviceId'] = device_id
            return {'id': package_id, 'kidId': str(kid['id']), 'days': package['days'], 'status': 'preparing', 'manifest': manifest}
        except Exception:
            conn.execute("DELETE FROM offline_packages WHERE id=? AND activated_at IS NULL AND completed_at IS NULL", [package_id])
            raise
        finally:
            try:
                if shared is not None:
                    shared.close()
            finally:
                conn.close()


def activate(kid, package_id, device_id, handoff_hash):
    with LOCK:
        conn = get_kid_connection_for(kid)
        try:
            package = repository.load(conn, package_id, device_id)
            if package['status'] == 'active':
                return {'status': 'active'}
            if package['status'] != 'preparing':
                raise ValueError('Offline package is not ready')
            report = handoff.inspect(conn, kid)
            handoff.require_ready(report)
            if handoff_hash != planning.fingerprint(report):
                raise ValueError('Today’s chores changed or the date changed. Cancel preparation and create a new package.')
            conn.execute("UPDATE offline_packages SET activated_at=CURRENT_TIMESTAMP WHERE id=?", [package_id])
            return {'status': 'active'}
        finally:
            conn.close()
