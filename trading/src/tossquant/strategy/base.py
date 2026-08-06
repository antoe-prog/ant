"""전략 인터페이스.

전략은 "얼마를 살지"를 정하지 않는다. 방향(진입/청산)만 내고 수량은 리스크
계층이 계좌 상태를 보고 정한다. 이 분리를 지켜야 전략을 갈아끼워도 리스크
한도가 그대로 유지된다.
"""

from __future__ import annotations

from abc import ABC, abstractmethod

from ..models import Candle, Position, Signal


class Strategy(ABC):
    name: str = "strategy"

    @property
    @abstractmethod
    def warmup_bars(self) -> int:
        """신호를 내기 위해 필요한 최소 캔들 개수."""

    @abstractmethod
    def on_bar(
        self,
        symbol: str,
        candles: list[Candle],
        position: Position | None,
    ) -> Signal | None:
        """캔들은 오래된 것 → 최신 순. 신호가 없으면 None."""
