"""시장 국면 필터.

개별 종목 전략은 "이 종목이 오르는가"만 본다. 시장 전체가 무너지는 국면에서는
거의 모든 종목이 같이 빠지므로, 종목별로 아무리 잘 골라도 소용이 없다. 이
필터는 지수가 장기 이동평균 위에 있을 때만 **신규 진입**을 허용한다.

## 진입만 막는다

청산(전략 신호든 손절이든)은 국면과 무관하게 항상 통과시킨다. 하락장에서
빠져나오지 못하게 막는 건 정확히 반대로 가는 짓이다. `risk.py`의 일일 손실
한도와 같은 원칙이다.

## 판단할 수 없으면 신규 진입을 막는다

사용자가 필터를 켠 상태에서 지수 캔들이 모자라거나 조회·평가에 실패하면 그
상태는 위험도 정상도 아닌 UNKNOWN이다. UNKNOWN은 신규 진입을 막고 오류 알림을
내지만, 보유 포지션 청산은 계속 허용한다. 필터를 명시적으로 끈 경우에만 데이터
없이 진입을 허용한다.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from decimal import Decimal

from .models import Candle
from .strategy.indicators import sma

log = logging.getLogger(__name__)


@dataclass(frozen=True)
class RegimeState:
    risk_on: bool
    known: bool = True
    price: Decimal | None = None
    average: Decimal | None = None
    reason: str = ""

    def __str__(self) -> str:
        return self.reason


class RegimeFilter:
    def __init__(self, symbol: str, ma_bars: int, *, enabled: bool = True) -> None:
        if ma_bars <= 0:
            raise ValueError(f"ma_bars는 1 이상이어야 합니다: {ma_bars}")
        self.symbol = symbol.upper()
        self.ma_bars = ma_bars
        self.enabled = enabled and bool(symbol)

    @property
    def warmup_bars(self) -> int:
        return self.ma_bars

    def evaluate(self, candles: list[Candle] | None) -> RegimeState:
        """지수 캔들로 현재 국면을 판정한다."""
        if not self.enabled:
            return RegimeState(risk_on=True, reason="필터 꺼짐")

        if not candles:
            log.warning(
                "%s 지수 캔들이 없어 국면을 판단할 수 없습니다 (매수 차단)",
                self.symbol,
            )
            return RegimeState(
                risk_on=False,
                known=False,
                reason=f"{self.symbol} 데이터 없음",
            )

        closes = [c.close for c in candles]
        average = sma(closes, self.ma_bars)
        if average is None:
            log.warning(
                "%s 캔들 부족(%d개, 필요 %d개) — 국면 판단 불가 (매수 차단)",
                self.symbol, len(closes), self.ma_bars,
            )
            return RegimeState(
                risk_on=False,
                known=False,
                reason=f"{self.symbol} 캔들 부족 {len(closes)}/{self.ma_bars}",
            )

        price = closes[-1]
        risk_on = price > average
        gap = (price / average - 1) * 100 if average > 0 else Decimal("0")
        return RegimeState(
            risk_on=risk_on,
            price=price,
            average=average,
            reason=(
                f"{self.symbol} {price:.2f} "
                f"{'>' if risk_on else '<='} {self.ma_bars}일선 {average:.2f} "
                f"({gap:+.1f}%)"
            ),
        )

    def allows_entry(self, candles: list[Candle] | None) -> bool:
        return self.evaluate(candles).risk_on
