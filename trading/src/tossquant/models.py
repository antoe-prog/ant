"""도메인 모델. 브로커 응답 스키마와 전략 로직 사이의 경계 역할을 한다."""

from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from datetime import datetime
from decimal import Decimal
from enum import Enum


class Side(str, Enum):
    BUY = "BUY"
    SELL = "SELL"


class OrderType(str, Enum):
    MARKET = "MARKET"
    LIMIT = "LIMIT"


class OrderStatus(str, Enum):
    NEW = "NEW"
    FILLED = "FILLED"
    PARTIALLY_FILLED = "PARTIALLY_FILLED"
    CANCELED = "CANCELED"
    REJECTED = "REJECTED"


@dataclass(frozen=True)
class Quote:
    symbol: str
    last: Decimal
    bid: Decimal
    ask: Decimal
    ts: datetime

    @property
    def mid(self) -> Decimal:
        if self.bid > 0 and self.ask > 0:
            return (self.bid + self.ask) / 2
        return self.last


@dataclass(frozen=True)
class Candle:
    symbol: str
    ts: datetime
    open: Decimal
    high: Decimal
    low: Decimal
    close: Decimal
    volume: int


@dataclass(frozen=True)
class OrderRequest:
    symbol: str
    side: Side
    quantity: int
    order_type: OrderType = OrderType.MARKET
    limit_price: Decimal | None = None
    client_order_id: str = field(default_factory=lambda: uuid.uuid4().hex)

    def __post_init__(self) -> None:
        if self.quantity <= 0:
            raise ValueError(f"quantity must be positive, got {self.quantity}")
        if self.order_type is OrderType.LIMIT and self.limit_price is None:
            raise ValueError("limit_price is required for LIMIT orders")


@dataclass(frozen=True)
class Order:
    order_id: str
    client_order_id: str
    symbol: str
    side: Side
    quantity: int
    filled_quantity: int
    avg_fill_price: Decimal
    status: OrderStatus
    ts: datetime
    reject_reason: str | None = None


@dataclass(frozen=True)
class Position:
    symbol: str
    quantity: int
    avg_price: Decimal

    @property
    def cost_basis(self) -> Decimal:
        return self.avg_price * self.quantity


@dataclass(frozen=True)
class Account:
    """현금 및 평가액. 미국주식만 다루므로 통화는 USD 고정."""

    cash: Decimal
    positions: dict[str, Position]

    def equity(self, marks: dict[str, Decimal]) -> Decimal:
        """marks(종목별 현재가)를 반영한 총 평가액."""
        total = self.cash
        for symbol, pos in self.positions.items():
            mark = marks.get(symbol, pos.avg_price)
            total += mark * pos.quantity
        return total


class SignalAction(str, Enum):
    ENTER_LONG = "ENTER_LONG"
    EXIT = "EXIT"


@dataclass(frozen=True)
class Signal:
    """전략의 출력. 수량은 정하지 않는다 — 사이징은 리스크 계층의 책임."""

    symbol: str
    action: SignalAction
    reason: str
    ref_price: Decimal
