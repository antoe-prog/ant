"""모멘텀 (Rate of Change).

"최근에 오른 게 더 오른다"에 거는 전략. SMA 크로스와 같은 추세추종 계열이지만
반응이 다르다. 크로스는 두 이동평균이 교차하는 **순간**에만 신호를 내서 늦고,
이건 룩백 수익률이 임계를 넘어 **있는 동안**을 본다.

진입과 청산 임계를 따로 둔 이유는 히스테리시스다. 하나로 두면 임계 근처에서
가격이 오르내릴 때마다 사고팔며 수수료만 나간다.
"""

from __future__ import annotations

from decimal import Decimal

from ..models import Candle, Position, Signal, SignalAction
from .base import Strategy
from .indicators import roc


class MomentumStrategy(Strategy):
    name = "momentum"

    def __init__(
        self,
        lookback: int,
        entry_threshold: Decimal,
        exit_threshold: Decimal,
    ) -> None:
        if lookback <= 0:
            raise ValueError(f"lookback은 1 이상이어야 합니다: {lookback}")
        if exit_threshold > entry_threshold:
            raise ValueError(
                f"청산 임계({exit_threshold})가 진입 임계({entry_threshold})보다 크면 "
                "사자마자 팔게 됩니다"
            )
        self.lookback = lookback
        self.entry_threshold = entry_threshold
        self.exit_threshold = exit_threshold

    @property
    def warmup_bars(self) -> int:
        return self.lookback + 1

    def on_bar(
        self, symbol: str, candles: list[Candle], position: Position | None
    ) -> Signal | None:
        closes = [c.close for c in candles]
        momentum = roc(closes, self.lookback)
        if momentum is None:
            return None

        holding = position is not None and position.quantity > 0
        price = closes[-1]

        if not holding and momentum >= self.entry_threshold:
            return Signal(
                symbol=symbol,
                action=SignalAction.ENTER_LONG,
                reason=f"{self.lookback}일 모멘텀 {momentum * 100:+.1f}% >= {self.entry_threshold * 100:+.1f}%",
                ref_price=price,
            )
        if holding and momentum <= self.exit_threshold:
            return Signal(
                symbol=symbol,
                action=SignalAction.EXIT,
                reason=f"{self.lookback}일 모멘텀 {momentum * 100:+.1f}% <= {self.exit_threshold * 100:+.1f}%",
                ref_price=price,
            )
        return None
