"""평균회귀 (z-score).

앞의 둘과 정반대 방향이다. 추세추종은 오르는 걸 사지만, 이건 **과도하게 빠진
걸** 사서 평균으로 돌아올 때 판다. 그래서 강세장에서 추세추종이 약할 때
보완이 될 수 있는지 비교 대상으로 의미가 있다.

위험도 반대다. 추세추종은 조금씩 여러 번 잃고 크게 한 번 먹는 반면, 평균회귀는
자주 조금씩 먹다가 추세가 꺾이지 않고 계속 빠지면 크게 물린다 — '떨어지는 칼날'
문제다. `stops.py`의 손절이 이 전략에서 특히 중요한 이유다.
"""

from __future__ import annotations

from decimal import Decimal

from ..models import Candle, Position, Signal, SignalAction
from .base import Strategy
from .indicators import zscore


class MeanReversionStrategy(Strategy):
    name = "mean_reversion"

    def __init__(
        self, lookback: int, entry_z: Decimal, exit_z: Decimal
    ) -> None:
        if type(lookback) is not int:
            raise ValueError(f"lookback은 integer여야 합니다: {lookback!r}")
        if lookback <= 1:
            raise ValueError(f"lookback은 2 이상이어야 합니다: {lookback}")
        for name, value in (("entry_z", entry_z), ("exit_z", exit_z)):
            if not isinstance(value, Decimal) or not value.is_finite():
                raise ValueError(f"{name}은 유한한 Decimal이어야 합니다: {value!r}")
        if entry_z >= 0:
            raise ValueError(
                f"진입 z는 음수여야 합니다(과매도에서 매수): {entry_z}"
            )
        if exit_z < entry_z:
            raise ValueError(
                f"청산 z({exit_z})가 진입 z({entry_z})보다 낮으면 회귀를 못 기다립니다"
            )
        self.lookback = lookback
        self.entry_z = entry_z
        self.exit_z = exit_z

    @property
    def warmup_bars(self) -> int:
        return self.lookback + 1

    def on_bar(
        self, symbol: str, candles: list[Candle], position: Position | None
    ) -> Signal | None:
        closes = [c.close for c in candles]
        z = zscore(closes, self.lookback)
        if z is None:
            return None

        holding = position is not None and position.quantity > 0
        price = closes[-1]

        if not holding and z <= self.entry_z:
            return Signal(
                symbol=symbol,
                action=SignalAction.ENTER_LONG,
                reason=f"{self.lookback}일 z={z:+.2f} <= {self.entry_z:+.2f} (과매도)",
                ref_price=price,
            )
        if holding and z >= self.exit_z:
            return Signal(
                symbol=symbol,
                action=SignalAction.EXIT,
                reason=f"{self.lookback}일 z={z:+.2f} >= {self.exit_z:+.2f} (평균 회귀)",
                ref_price=price,
            )
        return None
