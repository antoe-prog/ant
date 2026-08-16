"""보호 청산 (손절·트레일링·익절·최대보유).

전략과 **완전히 분리**되어 있다. 전략을 아무리 갈아끼워도 이 장치는 그대로
남는다. SMA 크로스 같은 추세추종은 급락에 수십 봉 늦게 반응하는데, 그동안
포지션을 들고 있을 이유가 없다.

리스크 계층과의 역할 분담:
  - `risk.py`   진입을 얼마나 할지 (사이징 + 한도)
  - `stops.py`  들고 있는 걸 언제 강제로 접을지

## 체결 모델에 대한 정직한 설명

이건 거래소에 걸어두는 stop order가 **아니다.** 폴링 봇이 매 사이클 관측 가격을
보고 조건이 맞으면 시장가를 내는 방식이다. 따라서:

- 반응 속도는 캔들 주기와 `poll_seconds`에 묶인다. 일봉으로 돌리면 하루 중
  스파이크로 잠깐 스톱선을 뚫었다가 회복한 경우 발동하지 않는다.
- 갭 하락하면 스톱선보다 한참 아래에서 체결된다. 손실은 설정값보다 커질 수 있다.
- 봇이 죽어 있으면 아무것도 안 걸린다.

백테스트도 관측 종가로 판정하고 다음 봉 시가의 PaperBroker 체결로 근사한다.
실거래는 현재 호가·주문 생명주기·호가 잔량의 영향을 받으므로 결과가 어긋날 수
있다. 둘 다 거래소 stop order가 아니며, 백테스트 체결은 보수성의 보장이 아니다.
"""

from __future__ import annotations

import logging
from datetime import datetime, timedelta
from decimal import Decimal

from .models import Position, Signal, SignalAction
from .store import Store

log = logging.getLogger(__name__)


class StopManager:
    def __init__(
        self,
        store: Store,
        *,
        stop_loss_pct: Decimal,
        trailing_stop_pct: Decimal,
        take_profit_pct: Decimal,
        max_holding_days: int,
        cooldown_days: int,
    ) -> None:
        self._store = store
        self.stop_loss_pct = stop_loss_pct
        self.trailing_stop_pct = trailing_stop_pct
        self.take_profit_pct = take_profit_pct
        self.max_holding_days = max_holding_days
        self.cooldown_days = cooldown_days

    @property
    def enabled(self) -> bool:
        return any(
            (
                self.stop_loss_pct > 0,
                self.trailing_stop_pct > 0,
                self.take_profit_pct > 0,
                self.max_holding_days > 0,
            )
        )

    # --- 공개 API -----------------------------------------------------------

    def exits(
        self,
        positions: dict[str, Position],
        marks: dict[str, Decimal],
        now: datetime,
    ) -> list[Signal]:
        """강제 청산 신호. 전략 신호보다 우선한다."""
        self._sync(positions, marks, now)
        if not self.enabled:
            return []

        signals: list[Signal] = []
        for symbol, position in positions.items():
            price = marks.get(symbol)
            if price is None or price <= 0 or position.quantity <= 0:
                continue
            reason = self._check(symbol, position, price, now)
            if reason:
                log.warning("보호 청산 %s — %s", symbol, reason)
                signals.append(
                    Signal(
                        symbol=symbol,
                        action=SignalAction.EXIT,
                        reason=reason,
                        ref_price=price,
                        protective=True,
                    )
                )
        return signals

    def is_blocked(self, symbol: str, now: datetime) -> bool:
        """보호 청산 직후 쿨다운 중인지. 같은 자리에서 바로 재진입하는 걸 막는다."""
        row = self._store.load_tracking(symbol)
        if row is None or not row["blocked_until"]:
            return False
        return now < datetime.fromisoformat(row["blocked_until"])

    def on_exit(self, symbol: str, now: datetime, *, protective: bool) -> None:
        """청산 후 추적 상태를 정리한다. 보호 청산이었으면 쿨다운을 건다."""
        blocked_until = (
            now + timedelta(days=self.cooldown_days)
            if protective and self.cooldown_days > 0
            else None
        )
        if blocked_until is None:
            self._store.delete_tracking(symbol)
        else:
            self._store.save_tracking(
                symbol, high_water=None, opened_at=None, blocked_until=blocked_until
            )
            log.info("%s 재진입 차단 ~%s", symbol, blocked_until.date())

    # --- 내부 ---------------------------------------------------------------

    def _sync(
        self,
        positions: dict[str, Position],
        marks: dict[str, Decimal],
        now: datetime,
    ) -> None:
        """포지션 등장·소멸을 반영하고 고점을 갱신한다."""
        for symbol, position in positions.items():
            if position.quantity <= 0:
                continue
            price = marks.get(symbol, position.avg_price)
            row = self._store.load_tracking(symbol)
            blocked_until = (
                datetime.fromisoformat(row["blocked_until"])
                if row and row["blocked_until"]
                else None
            )

            if row is None or not row["opened_at"]:
                # 새로 관측된 포지션. 봇이 재시작됐거나 외부에서 산 경우도
                # 여기로 들어오므로, opened_at은 '실제 매수 시점'이 아니라
                # '봇이 처음 본 시점'이다 — max_holding_days 해석에 주의.
                self._store.save_tracking(
                    symbol,
                    high_water=max(price, position.avg_price),
                    opened_at=now,
                    blocked_until=blocked_until,
                )
                continue

            high_water = Decimal(row["high_water"]) if row["high_water"] else price
            if price > high_water:
                self._store.save_tracking(
                    symbol,
                    high_water=price,
                    opened_at=datetime.fromisoformat(row["opened_at"]),
                    blocked_until=blocked_until,
                )

        # 포지션이 사라졌는데 추적만 남아 있으면(외부 매도 등) 정리한다.
        for row in self._store.all_tracking():
            symbol = row["symbol"]
            if symbol in positions and positions[symbol].quantity > 0:
                continue

            blocked_until = (
                datetime.fromisoformat(row["blocked_until"])
                if row["blocked_until"]
                else None
            )
            if blocked_until is not None and now < blocked_until:
                # 쿨다운은 살려두되 고점·진입시각은 지운다.
                if row["opened_at"] or row["high_water"]:
                    self._store.save_tracking(
                        symbol,
                        high_water=None,
                        opened_at=None,
                        blocked_until=blocked_until,
                    )
                continue

            self._store.delete_tracking(symbol)

    def _check(
        self, symbol: str, position: Position, price: Decimal, now: datetime
    ) -> str | None:
        """발동한 규칙의 설명을 돌려준다. 손실 방어를 먼저 본다."""
        entry = position.avg_price

        if self.stop_loss_pct > 0 and entry > 0:
            floor = entry * (1 - self.stop_loss_pct)
            if price <= floor:
                loss = (price - entry) / entry * 100
                return (
                    f"손절: {price:.2f} <= {floor:.2f} "
                    f"(진입 {entry:.2f}, {loss:+.1f}%)"
                )

        row = self._store.load_tracking(symbol)

        if self.trailing_stop_pct > 0 and row and row["high_water"]:
            high_water = Decimal(row["high_water"])
            floor = high_water * (1 - self.trailing_stop_pct)
            if price <= floor and high_water > 0:
                drop = (price - high_water) / high_water * 100
                return (
                    f"트레일링 스톱: {price:.2f} <= {floor:.2f} "
                    f"(고점 {high_water:.2f}, {drop:+.1f}%)"
                )

        if self.max_holding_days > 0 and row and row["opened_at"]:
            held = (now - datetime.fromisoformat(row["opened_at"])).days
            if held >= self.max_holding_days:
                return f"최대 보유 기간 초과: {held}일 >= {self.max_holding_days}일"

        if self.take_profit_pct > 0 and entry > 0:
            target = entry * (1 + self.take_profit_pct)
            if price >= target:
                gain = (price - entry) / entry * 100
                return (
                    f"익절: {price:.2f} >= {target:.2f} "
                    f"(진입 {entry:.2f}, {gain:+.1f}%)"
                )

        return None
