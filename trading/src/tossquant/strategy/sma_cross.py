"""이동평균 교차 전략 (골든크로스 진입 / 데드크로스 청산).

샘플이자 기준선이다. 단순 교차는 횡보장에서 휩쏘가 심하므로 그대로 실전에
쓰기보다, 여기 구조를 두고 전략을 교체하는 출발점으로 삼을 것.
"""

from __future__ import annotations

from decimal import Decimal

from ..models import Candle, Position, Signal, SignalAction
from .base import Strategy


def sma(values: list[Decimal], window: int) -> Decimal | None:
    if window <= 0 or len(values) < window:
        return None
    return sum(values[-window:]) / window


class SmaCrossStrategy(Strategy):
    name = "sma_cross"

    def __init__(self, fast: int, slow: int) -> None:
        if type(fast) is not int or type(slow) is not int:
            raise ValueError(
                f"fast와 slow는 integer window여야 합니다: fast={fast!r}, slow={slow!r}"
            )
        if fast <= 0 or slow <= 0:
            raise ValueError(
                f"fast와 slow는 positive window여야 합니다: fast={fast}, slow={slow}"
            )
        if fast >= slow:
            raise ValueError(f"fast({fast}) must be smaller than slow({slow})")
        self.fast = fast
        self.slow = slow

    @property
    def warmup_bars(self) -> int:
        # 직전 봉과 비교해 "교차 시점"을 잡아야 하므로 한 개 더 받는다.
        return self.slow + 1

    def on_bar(
        self,
        symbol: str,
        candles: list[Candle],
        position: Position | None,
    ) -> Signal | None:
        if len(candles) < self.warmup_bars:
            return None

        closes = [c.close for c in candles]
        fast_now = sma(closes, self.fast)
        slow_now = sma(closes, self.slow)
        fast_prev = sma(closes[:-1], self.fast)
        slow_prev = sma(closes[:-1], self.slow)
        if None in (fast_now, slow_now, fast_prev, slow_prev):
            return None

        holding = position is not None and position.quantity > 0
        price = closes[-1]

        golden = fast_prev <= slow_prev and fast_now > slow_now
        dead = fast_prev >= slow_prev and fast_now < slow_now

        if golden and not holding:
            return Signal(
                symbol=symbol,
                action=SignalAction.ENTER_LONG,
                reason=f"golden cross SMA{self.fast}({fast_now:.2f}) > SMA{self.slow}({slow_now:.2f})",
                ref_price=price,
            )
        if dead and holding:
            return Signal(
                symbol=symbol,
                action=SignalAction.EXIT,
                reason=f"dead cross SMA{self.fast}({fast_now:.2f}) < SMA{self.slow}({slow_now:.2f})",
                ref_price=price,
            )
        return None
