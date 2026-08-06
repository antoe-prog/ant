"""리스크 계층.

전략이 낸 신호를 실제 주문으로 바꾸는 유일한 통로다. 사이징과 한도 검사가
여기 모여 있으므로, 전략을 아무리 바꿔도 계좌를 날릴 수 있는 경로는 이 파일
하나뿐이다.

한도:
  - 종목당 평가액 비중 (max_position_pct)
  - 동시 보유 종목 수 (max_positions)
  - 1회 주문 명목금액 (max_order_notional)
  - 일일 손실 한도 (max_daily_loss_pct) — 초과 시 신규 진입 차단, 청산은 허용
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import datetime
from decimal import Decimal

from .calendar_us import to_ny
from .models import Account, Signal, SignalAction
from .store import Store

log = logging.getLogger(__name__)

DAY_BASELINE_KEY = "risk.day_baseline"

# 주문 가능 현금을 전부 쓰지 않고 남겨두는 비율. 신호 시점 가격과 실제 체결가
# 사이에는 항상 간극이 있고(시장가 주문, 갭 상승, 수수료), 이 여유분이 없으면
# 체결 직전에 잔고 부족으로 주문이 통째로 거부된다.
CASH_BUFFER = Decimal("0.99")


@dataclass(frozen=True)
class Decision:
    approved: bool
    quantity: int
    reason: str
    code: str = "approved"

    @classmethod
    def reject(cls, code: str, reason: str) -> Decision:
        """code는 집계용 안정 키, reason은 사람이 읽는 설명."""
        return cls(approved=False, quantity=0, reason=reason, code=code)


class RiskManager:
    def __init__(
        self,
        store: Store,
        *,
        max_position_pct: Decimal,
        max_positions: int,
        max_daily_loss_pct: Decimal,
        max_order_notional: Decimal,
    ) -> None:
        self._store = store
        self.max_position_pct = max_position_pct
        self.max_positions = max_positions
        self.max_daily_loss_pct = max_daily_loss_pct
        self.max_order_notional = max_order_notional

    # --- 일일 손실 한도 -----------------------------------------------------

    def day_baseline(self, equity: Decimal, now: datetime) -> Decimal:
        """당일 첫 관측 평가액. 거래일이 바뀌면 새로 잡는다."""
        today = to_ny(now).date().isoformat()
        saved = self._store.get_state(DAY_BASELINE_KEY)
        if saved and saved.get("date") == today:
            return Decimal(saved["equity"])
        self._store.set_state(DAY_BASELINE_KEY, {"date": today, "equity": str(equity)})
        log.debug("당일 기준 평가액 설정: %s (%s)", equity, today)
        return equity

    def daily_loss_breached(self, equity: Decimal, now: datetime) -> bool:
        baseline = self.day_baseline(equity, now)
        if baseline <= 0:
            return False
        drawdown = (baseline - equity) / baseline
        if drawdown >= self.max_daily_loss_pct:
            log.warning(
                "일일 손실 한도 도달: -%.2f%% (한도 %.2f%%) — 신규 진입 차단",
                drawdown * 100, self.max_daily_loss_pct * 100,
            )
            return True
        return False

    # --- 신호 심사 ----------------------------------------------------------

    def evaluate(
        self,
        signal: Signal,
        account: Account,
        marks: dict[str, Decimal],
        now: datetime,
        exec_price: Decimal | None = None,
    ) -> Decision:
        """신호를 주문 수량으로 바꾼다.

        marks는 평가액 계산용(종가 기준), exec_price는 사이징용(실제 체결이
        일어날 가격)이다. 둘을 구분하지 않으면 종가로 계산한 수량이 다음 날
        시가에서 잔고를 초과하는 사고가 난다.
        """
        position = account.positions.get(signal.symbol)

        if signal.action is SignalAction.EXIT:
            if position is None or position.quantity <= 0:
                return Decision.reject("no_position", "보유 수량 없음")
            return Decision(True, position.quantity, "전량 청산")

        # --- 이하 신규 진입 ---
        equity = account.equity(marks)
        if equity <= 0:
            return Decision.reject("equity_depleted", "평가액이 0 이하")

        if self.daily_loss_breached(equity, now):
            return Decision.reject("daily_loss_limit", "일일 손실 한도 초과")

        if position is not None and position.quantity > 0:
            return Decision.reject("already_held", "이미 보유 중")

        if len(account.positions) >= self.max_positions:
            return Decision.reject(
                "max_positions", f"동시 보유 한도 {self.max_positions}종목 도달"
            )

        price = exec_price or marks.get(signal.symbol) or signal.ref_price
        if price <= 0:
            return Decision.reject("no_price", "유효한 가격 없음")

        budget = min(
            equity * self.max_position_pct,
            self.max_order_notional,
            account.cash * CASH_BUFFER,
        )
        quantity = int(budget / price)
        if quantity < 1:
            return Decision.reject(
                "budget_below_one_share",
                f"주문 가능 예산 {budget:.2f} USD < 1주 가격 {price:.2f} USD",
            )

        return Decision(
            True,
            quantity,
            f"예산 {budget:.2f} USD / 가격 {price:.2f} USD → {quantity}주",
        )
