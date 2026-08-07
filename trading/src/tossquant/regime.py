"""시장 국면 필터.

개별 종목 전략은 "이 종목이 오르는가"만 본다. 시장 전체가 무너지는 국면에서는
거의 모든 종목이 같이 빠지므로, 종목별로 아무리 잘 골라도 소용이 없다. 이
필터는 지수가 장기 이동평균 위에 있을 때만 **신규 진입**을 허용한다.

## 진입만 막는다

청산(전략 신호든 손절이든)은 국면과 무관하게 항상 통과시킨다. 하락장에서
빠져나오지 못하게 막는 건 정확히 반대로 가는 짓이다. `risk.py`의 일일 손실
한도와 같은 원칙이다.

## 판단할 수 없으면 통과시킨다 (fail-open)

지수 캔들이 모자라거나 조회에 실패하면 필터를 적용하지 않고 로그만 남긴다.
막아버리면 봇이 매수를 멈춘 이유가 화면 어디에도 드러나지 않아서, 데이터 문제
하나로 몇 주를 날릴 수 있다. 이 필터는 안전장치가 아니라 성과 개선 장치이고,
안전장치는 `stops.py`와 `risk.py`가 따로 맡고 있다.
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
                "%s 지수 캔들이 없어 국면 필터를 건너뜁니다 (매수 허용)", self.symbol
            )
            return RegimeState(risk_on=True, reason=f"{self.symbol} 데이터 없음")

        closes = [c.close for c in candles]
        average = sma(closes, self.ma_bars)
        if average is None:
            log.warning(
                "%s 캔들 부족(%d개, 필요 %d개) — 국면 필터를 건너뜁니다 (매수 허용)",
                self.symbol, len(closes), self.ma_bars,
            )
            return RegimeState(
                risk_on=True, reason=f"{self.symbol} 캔들 부족 {len(closes)}/{self.ma_bars}"
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
