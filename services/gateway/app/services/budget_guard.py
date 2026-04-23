from collections import defaultdict
from datetime import date


class BudgetGuard:
    def __init__(self, daily_budget_usd: float) -> None:
        self.daily_budget_usd = daily_budget_usd
        self._usage: dict[tuple[str, date], float] = defaultdict(float)

    def can_spend(self, user_id: str, next_cost: float) -> bool:
        key = (user_id, date.today())
        return (self._usage[key] + next_cost) <= self.daily_budget_usd

    def add_usage(self, user_id: str, amount: float) -> None:
        key = (user_id, date.today())
        self._usage[key] += amount

    def used_today(self, user_id: str) -> float:
        key = (user_id, date.today())
        return self._usage[key]
