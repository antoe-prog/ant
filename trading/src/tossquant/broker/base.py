"""브로커 인터페이스.

엔진과 전략은 이 인터페이스에만 의존한다. 페이퍼 트레이딩에서 실주문으로
넘어갈 때 바꾸는 것은 구현체 하나뿐이다.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from decimal import Decimal

from ..models import Account, Candle, Order, OrderRequest, Position, Quote


class MarketData(ABC):
    """시세 조회. 페이퍼/실거래 양쪽 모두 실제 시세를 쓴다."""

    @abstractmethod
    def get_quote(self, symbol: str) -> Quote: ...

    @abstractmethod
    def get_candles(self, symbol: str, interval: str, count: int) -> list[Candle]:
        """오래된 것 → 최신 순으로 정렬된 캔들을 반환한다."""


class Broker(MarketData):
    """주문 실행 + 계좌 상태."""

    @abstractmethod
    def place_order(self, request: OrderRequest) -> Order: ...

    @abstractmethod
    def cancel_order(self, order_id: str) -> Order: ...

    @abstractmethod
    def get_positions(self) -> dict[str, Position]: ...

    @abstractmethod
    def get_account(self) -> Account: ...

    @property
    @abstractmethod
    def is_live(self) -> bool:
        """실제 자금이 오가는 브로커인지. 로그/가드에서 사용."""


class BrokerError(RuntimeError):
    pass


class OrderRejected(BrokerError):
    def __init__(self, reason: str, request: OrderRequest) -> None:
        super().__init__(f"order rejected: {reason} ({request.symbol} {request.side} x{request.quantity})")
        self.reason = reason
        self.request = request


class InsufficientFunds(OrderRejected):
    def __init__(self, needed: Decimal, available: Decimal, request: OrderRequest) -> None:
        super().__init__(f"need {needed:.2f} USD but only {available:.2f} available", request)
