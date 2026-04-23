from collections import defaultdict
from datetime import date


class RateLimiter:
    def __init__(self, max_requests_per_day: int = 100) -> None:
        self.max_requests_per_day = max_requests_per_day
        self._counts: dict[tuple[str, date], int] = defaultdict(int)

    def check_and_increment(self, user_id: str) -> bool:
        key = (user_id, date.today())
        self._counts[key] += 1
        return self._counts[key] <= self.max_requests_per_day
