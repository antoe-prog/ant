"""과거 캔들을 시세 소스인 척 재생한다.

이 클래스의 존재 이유는 하나다: **미래 정보 누출(look-ahead bias)을 구조적으로
불가능하게 만드는 것.**

- `get_candles()`는 커서까지의 봉만 돌려준다. 전략은 아직 안 온 봉을 볼 방법이 없다.
- `get_quote()`는 **다음 봉의 시가**를 돌려준다. i번 봉 종가를 보고 낸 신호는
  i+1번 봉 시가에 체결된다 — 같은 봉 종가에 체결하는 흔한 실수를 막는다.

MarketData 인터페이스를 구현하므로 PaperBroker를 그대로 얹을 수 있다. 즉 체결·
수수료·평단 계산은 실시간 페이퍼 트레이딩과 똑같은 코드를 탄다.
"""

from __future__ import annotations

import logging
from datetime import datetime
from decimal import Decimal

from ..broker.base import MarketData
from ..models import Candle, Quote

log = logging.getLogger(__name__)

BPS = Decimal("10000")


def align(history: dict[str, list[Candle]]) -> dict[str, list[Candle]]:
    """종목별 캔들을 공통 타임스탬프로 맞춘다.

    미국 주식은 같은 거래일 달력을 쓰므로 보통 그대로 맞지만, 상장일이 다르거나
    데이터에 구멍이 있으면 교집합만 남긴다. 버려지는 봉이 있으면 로그로 알린다.
    """
    if not history:
        return {}

    common: set[datetime] | None = None
    for candles in history.values():
        stamps = {c.ts for c in candles}
        common = stamps if common is None else common & stamps
    assert common is not None

    aligned = {
        symbol: sorted((c for c in candles if c.ts in common), key=lambda c: c.ts)
        for symbol, candles in history.items()
    }
    for symbol, candles in history.items():
        dropped = len(candles) - len(aligned[symbol])
        if dropped:
            log.warning("%s: 타임스탬프 정렬로 %d개 봉 제외", symbol, dropped)
    return aligned


class ReplayMarket(MarketData):
    def __init__(
        self,
        history: dict[str, list[Candle]],
        spread_bps: Decimal = Decimal("2"),
    ) -> None:
        self._history = align(history)
        if not self._history:
            raise ValueError("백테스트할 캔들이 없습니다")

        lengths = {len(v) for v in self._history.values()}
        if len(lengths) != 1:
            raise ValueError(f"정렬 후에도 길이가 다릅니다: {lengths}")

        self._length = lengths.pop()
        if self._length < 2:
            raise ValueError("봉이 2개 미만이면 체결을 시뮬레이션할 수 없습니다")

        self._spread = spread_bps / BPS
        self._cursor = 0

    # --- 커서 ---------------------------------------------------------------

    @property
    def length(self) -> int:
        return self._length

    @property
    def cursor(self) -> int:
        return self._cursor

    @property
    def symbols(self) -> list[str]:
        return list(self._history)

    def seek(self, index: int) -> None:
        if not 0 <= index < self._length:
            raise IndexError(f"cursor {index} out of range [0, {self._length})")
        self._cursor = index

    def has_next(self) -> bool:
        return self._cursor + 1 < self._length

    def timestamp(self) -> datetime:
        return next(iter(self._history.values()))[self._cursor].ts

    def next_timestamp(self) -> datetime:
        """체결이 일어나는 봉의 시각."""
        index = self._cursor + 1 if self.has_next() else self._cursor
        return next(iter(self._history.values()))[index].ts

    def close_price(self, symbol: str) -> Decimal:
        return self._history[symbol][self._cursor].close

    def marks(self) -> dict[str, Decimal]:
        """현재 봉 종가 기준 평가용 가격."""
        return {symbol: self.close_price(symbol) for symbol in self._history}

    # --- MarketData ---------------------------------------------------------

    def get_candles(self, symbol: str, interval: str, count: int) -> list[Candle]:
        visible = self._history[symbol][: self._cursor + 1]
        return visible[-count:]

    def get_quote(self, symbol: str) -> Quote:
        """체결 기준가. 다음 봉 시가에 스프레드를 씌운다."""
        candles = self._history[symbol]
        if self.has_next():
            reference = candles[self._cursor + 1]
            price = reference.open
        else:
            # 마지막 봉에서는 체결할 다음 봉이 없다. 시뮬레이터가 이 시점에
            # 주문을 내지 않도록 막고 있으므로 평가용 값으로만 쓰인다.
            reference = candles[self._cursor]
            price = reference.close

        half = price * self._spread / 2
        return Quote(
            symbol=symbol,
            last=price,
            bid=price - half,
            ask=price + half,
            ts=reference.ts,
        )
