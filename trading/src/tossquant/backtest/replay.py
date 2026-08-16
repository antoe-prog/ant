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
        data_only: frozenset[str] = frozenset(),
    ) -> None:
        """data_only 심볼은 정렬·커서에는 참여하지만 매매 대상은 아니다.

        시장 국면 판정용 지수가 그렇다. 같은 정렬을 타야 커서가 어긋나지 않고,
        무엇보다 지수도 `get_candles`의 커서 제한을 받아 **미래를 못 본다.**
        """
        if (
            not isinstance(spread_bps, Decimal)
            or not spread_bps.is_finite()
            or spread_bps < 0
            or spread_bps >= BPS * 2
        ):
            raise ValueError("spread_bps는 0 이상 20000 미만의 유한 Decimal이어야 합니다")
        self._history = align(history)
        self._data_only = frozenset(s.upper() for s in data_only)
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
        """매매 대상 심볼. 지수 같은 참고용 데이터는 빠진다."""
        return [s for s in self._history if s not in self._data_only]

    @property
    def all_symbols(self) -> list[str]:
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
        """현재 봉 종가 기준 평가용 가격. 매매 대상만."""
        return {symbol: self.close_price(symbol) for symbol in self.symbols}

    def open_marks(self) -> dict[str, Decimal]:
        """현재 봉 시가 기준 평가 가격. 세션 시작 평가액 고정용."""
        return {
            symbol: self._history[symbol][self._cursor].open
            for symbol in self.symbols
        }

    def next_open_marks(self) -> dict[str, Decimal]:
        """다음 봉 시가 기준 평가 가격. 다음 세션 주문 전 기준선용."""
        if not self.has_next():
            raise IndexError("다음 봉이 없어 시가 평가액을 계산할 수 없습니다")
        return {
            symbol: self._history[symbol][self._cursor + 1].open
            for symbol in self.symbols
        }

    def current_quote(self, symbol: str) -> Quote:
        """현재 봉 종가에 같은 스프레드를 적용한 결정 시점 호가.

        주문 예약액은 아직 보이지 않는 다음 봉 시가가 아니라 이 호가로 고정한다.
        실제 체결용 :meth:`get_quote`와 정보 경계를 명시적으로 분리한다.
        """
        candle = self._history[symbol][self._cursor]
        return self._quote(symbol, candle.close, candle.ts)

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

        return self._quote(symbol, price, reference.ts)

    def _quote(self, symbol: str, price: Decimal, ts: datetime) -> Quote:
        half = price * self._spread / 2
        return Quote(
            symbol=symbol,
            last=price,
            bid=price - half,
            ask=price + half,
            ts=ts,
        )
