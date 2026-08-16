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
        if not isinstance(self.symbol, str) or not self.symbol.strip():
            raise ValueError("symbol must not be blank")
        if not isinstance(self.client_order_id, str) or not self.client_order_id.strip():
            raise ValueError("client_order_id must not be blank")
        if not isinstance(self.side, Side):
            raise ValueError(f"side must be a Side enum, got {self.side!r}")
        if not isinstance(self.order_type, OrderType):
            raise ValueError(
                f"order_type must be an OrderType enum, got {self.order_type!r}"
            )
        if type(self.quantity) is not int or self.quantity <= 0:
            raise ValueError(
                f"quantity must be a positive integer, got {self.quantity!r}"
            )
        if self.order_type is OrderType.MARKET:
            if self.limit_price is not None:
                raise ValueError("MARKET order must not include limit_price")
            return
        if (
            not isinstance(self.limit_price, Decimal)
            or not self.limit_price.is_finite()
            or self.limit_price <= 0
        ):
            raise ValueError(
                "LIMIT limit_price must be a finite positive Decimal"
            )


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
    # 전략이 아니라 보호 장치(손절 등)가 낸 신호. 청산 후 쿨다운 대상이 된다.
    protective: bool = False

    def __post_init__(self) -> None:
        self.assert_valid()

    def assert_valid(self) -> None:
        """Validate the runtime boundary, not merely the type annotations.

        Strategies are replaceable Python code.  A lookalike string such as
        ``"ENTER_LONG"`` must never reach identity-based order routing where it
        would be interpreted as a sell.
        """
        if not isinstance(self.symbol, str) or not self.symbol.strip():
            raise ValueError("signal symbol must be a nonblank string")
        if not isinstance(self.action, SignalAction):
            raise ValueError(
                f"signal action must be a SignalAction enum, got {self.action!r}"
            )
        if not isinstance(self.reason, str) or not self.reason.strip():
            raise ValueError("signal reason must be a nonblank string")
        if (
            not isinstance(self.ref_price, Decimal)
            or not self.ref_price.is_finite()
            or self.ref_price <= 0
        ):
            raise ValueError(
                "signal ref_price must be a finite positive Decimal"
            )
        if type(self.protective) is not bool:
            raise ValueError("signal protective must be an actual bool")
