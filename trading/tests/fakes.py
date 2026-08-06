from __future__ import annotations

from datetime import datetime, timedelta, timezone
from decimal import Decimal

from tossquant.broker.base import MarketData
from tossquant.models import Candle, Quote


class FakeMarket(MarketData):
    """테스트용 시세 소스. 종가 시퀀스를 직접 주입한다."""

    def __init__(self, closes: dict[str, list[float]], spread: float = 0.02) -> None:
        self.closes = {s: [Decimal(str(c)) for c in v] for s, v in closes.items()}
        self.spread = Decimal(str(spread))
        self.quote_calls = 0

    def get_quote(self, symbol: str) -> Quote:
        self.quote_calls += 1
        last = self.closes[symbol][-1]
        half = self.spread / 2
        return Quote(
            symbol=symbol,
            last=last,
            bid=last - half,
            ask=last + half,
            ts=datetime.now(timezone.utc),
        )

    def get_candles(self, symbol: str, interval: str, count: int) -> list[Candle]:
        series = self.closes[symbol][-count:]
        start = datetime(2026, 1, 2, tzinfo=timezone.utc)
        return [
            Candle(
                symbol=symbol,
                ts=start + timedelta(days=i),
                open=close,
                high=close,
                low=close,
                close=close,
                volume=1000,
            )
            for i, close in enumerate(series)
        ]
