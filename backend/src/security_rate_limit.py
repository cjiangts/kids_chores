"""Simple in-process rate limiting helpers for auth-sensitive operations."""

from collections import defaultdict, deque
import threading
import time


class SlidingWindowRateLimiter:
    """Thread-safe sliding-window limiter keyed by arbitrary strings."""

    def __init__(self, max_attempts=5, window_seconds=60):
        self.max_attempts = int(max_attempts)
        self.window_seconds = int(window_seconds)
        self._events_by_key = defaultdict(deque)
        self._lock = threading.Lock()

    def _prune(self, key, now_mono):
        events = self._events_by_key[key]
        cutoff = now_mono - self.window_seconds
        while events and events[0] <= cutoff:
            events.popleft()
        if not events:
            self._events_by_key.pop(key, None)
            return deque()
        return events

    def check(self, key):
        """Record one attempt. Returns (allowed, retry_after_seconds)."""
        now_mono = time.monotonic()
        normalized_key = str(key or '').strip() or 'unknown'
        with self._lock:
            events = self._prune(normalized_key, now_mono)
            if len(events) >= self.max_attempts:
                oldest = events[0]
                retry_after = max(1, int(self.window_seconds - (now_mono - oldest)))
                return False, retry_after
            events.append(now_mono)
            self._events_by_key[normalized_key] = events
            return True, 0

    def reset(self, key):
        normalized_key = str(key or '').strip() or 'unknown'
        with self._lock:
            self._events_by_key.pop(normalized_key, None)


def get_request_ip(req):
    """Best-effort client IP extraction (supports reverse-proxy headers)."""
    x_forwarded_for = str(req.headers.get('X-Forwarded-For') or '').strip()
    if x_forwarded_for:
        first = x_forwarded_for.split(',')[0].strip()
        if first:
            return first
    x_real_ip = str(req.headers.get('X-Real-IP') or '').strip()
    if x_real_ip:
        return x_real_ip
    return str(req.remote_addr or '').strip() or 'unknown'


def build_login_limit_key(req, username=''):
    ip = get_request_ip(req)
    normalized_username = str(username or '').strip().lower() or '-'
    return f'login:{ip}:{normalized_username}'


def build_critical_password_limit_key(req, family_id=''):
    ip = get_request_ip(req)
    normalized_family_id = str(family_id or '').strip() or '-'
    return f'critical:{ip}:{normalized_family_id}'


LOGIN_RATE_LIMITER = SlidingWindowRateLimiter(max_attempts=5, window_seconds=60)
CRITICAL_PASSWORD_RATE_LIMITER = SlidingWindowRateLimiter(max_attempts=5, window_seconds=60)
