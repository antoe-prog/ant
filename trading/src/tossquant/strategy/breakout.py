"""돈치안 채널 돌파 (터틀 트레이딩 계열).

N일 신고가를 뚫으면 사고, M일 신저가로 내려오면 판다. 추세의 '시작'을 가격
자체로 정의하므로 이동평균처럼 뒤늦게 따라가지 않는다.

진입 창을 청산 창보다 길게 잡는 게 관례다(20/10). 들어갈 때는 확실한 돌파를
요구하고 나올 때는 빨리 나오기 위해서다.

핵심 주의점: 신고가 비교에서 **현재 봉을 빼야 한다.** 포함하면 '오늘 종가가
오늘을 포함한 최고가보다 높은가'를 묻는 셈이라 돌파가 성립할 수 없다.
`indicators.highest`가 기본으로 현재 봉을 제외한다.
"""

from __future__ import annotations

from ..models import Candle, Position, Signal, SignalAction
from .base import Strategy
from .indicators import highest, lowest


class BreakoutStrategy(Strategy):
    name = "breakout"

    def __init__(self, entry_bars: int, exit_bars: int) -> None:
        if entry_bars <= 0 or exit_bars <= 0:
            raise ValueError("진입·청산 창은 1 이상이어야 합니다")
        self.entry_bars = entry_bars
        self.exit_bars = exit_bars

    @property
    def warmup_bars(self) -> int:
        # 현재 봉을 제외하고 창을 채워야 하므로 +1.
        return max(self.entry_bars, self.exit_bars) + 1

    def on_bar(
        self, symbol: str, candles: list[Candle], position: Position | None
    ) -> Signal | None:
        holding = position is not None and position.quantity > 0
        price = candles[-1].close

        if not holding:
            # 돌파 판정은 고가로 한다. 종가끼리 비교하면 장중 신고가를 놓친다.
            ceiling = highest([c.high for c in candles], self.entry_bars)
            if ceiling is not None and price > ceiling:
                return Signal(
                    symbol=symbol,
                    action=SignalAction.ENTER_LONG,
                    reason=f"{self.entry_bars}일 신고가 돌파: {price:.2f} > {ceiling:.2f}",
                    ref_price=price,
                )
            return None

        floor = lowest([c.low for c in candles], self.exit_bars)
        if floor is not None and price < floor:
            return Signal(
                symbol=symbol,
                action=SignalAction.EXIT,
                reason=f"{self.exit_bars}일 신저가 이탈: {price:.2f} < {floor:.2f}",
                ref_price=price,
            )
        return None
