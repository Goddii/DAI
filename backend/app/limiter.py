"""A tiny in-memory sliding-window rate limiter.

Used for the login endpoint to slow credential guessing. `limit` and
`window_seconds` may be plain ints or zero-arg callables (resolved on each
call), so app config can change per environment (e.g. relaxed in tests).

In-memory means it resets on restart and is per-process — acceptable for a
single-instance MVP; swap for a shared store (Redis) before scaling out.
"""

import time
from collections import defaultdict, deque
from threading import Lock


def _resolve(value):
    return value() if callable(value) else value


class SlidingWindowLimiter:
    def __init__(self, limit=10, window_seconds=300):
        self.limit = limit
        self.window_seconds = window_seconds
        self._hits: dict[str, deque] = defaultdict(deque)
        self._lock = Lock()

    def allow(self, key: str) -> tuple[bool, int]:
        """Return (allowed, retry_after_seconds). Records the attempt."""
        now = time.monotonic()
        limit = _resolve(self.limit)
        window = _resolve(self.window_seconds)
        with self._lock:
            hits = self._hits[key]
            while hits and now - hits[0] > window:
                hits.popleft()
            if len(hits) >= limit:
                retry_after = int(window - (now - hits[0])) + 1
                return False, max(retry_after, 1)
            hits.append(now)
            return True, 0

    def reset(self, key: str) -> None:
        with self._lock:
            self._hits.pop(key, None)
