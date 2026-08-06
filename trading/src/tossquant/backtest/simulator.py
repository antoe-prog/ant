"""백테스트 시뮬레이터.

실시간 엔진과 **같은 전략·같은 리스크 계층·같은 체결 로직**을 탄다. 바뀌는 건
시세 소스뿐이다(ReplayMarket). 그래서 백테스트에서 나온 숫자가 라이브 동작과
어긋날 여지가 구조적으로 줄어든다.

한 봉의 처리 순서:
  1. 현재 봉 종가로 평가액 기록
  2. 전략에 현재 봉까지의 캔들을 넘겨 신호를 받음
  3. 리스크 계층이 수량 결정
  4. **다음 봉 시가**에 체결

마지막 봉에서는 체결할 다음 봉이 없으므로 주문을 내지 않는다.
"""

from __future__ import annotations

import logging
from collections import Counter
from dataclasses import dataclass, field
from datetime import datetime
from decimal import Decimal

from ..broker.base import OrderRejected
from ..broker.paper import PaperBroker
from ..config import Settings
from ..models import Candle, Order, OrderRequest, OrderType, Side, SignalAction
from ..risk import RiskManager
from ..store import Store
from ..strategy.base import Strategy
from .metrics import EquityPoint, Metrics, Trade, compute
from .replay import ReplayMarket

log = logging.getLogger(__name__)

CANDLE_LOOKBACK_SLACK = 20


@dataclass
class BacktestResult:
    strategy_name: str
    symbols: list[str]
    interval: str
    curve: list[EquityPoint]
    trades: list[Trade]
    metrics: Metrics
    benchmark_curve: list[EquityPoint]
    benchmark_metrics: Metrics
    rejections: Counter[str]

    @property
    def excess_return(self) -> float:
        """벤치마크 대비 초과 수익률. 이게 음수면 전략을 쓸 이유가 없다."""
        return self.metrics.total_return - self.benchmark_metrics.total_return


@dataclass
class _Lot:
    """보유 중인 포지션의 진입 정보. 라운드트립 손익 계산용."""

    entry_ts: datetime
    entry_bar: int
    quantity: int
    price: Decimal
    commission: Decimal

    def merge(self, quantity: int, price: Decimal, commission: Decimal) -> None:
        total = self.quantity + quantity
        self.price = (self.price * self.quantity + price * quantity) / total
        self.quantity = total
        self.commission += commission


class Backtester:
    def __init__(
        self,
        history: dict[str, list[Candle]],
        strategy: Strategy,
        settings: Settings,
    ) -> None:
        self.market = ReplayMarket(history, spread_bps=settings.backtest_spread_bps)
        self.strategy = strategy
        self.settings = settings

    def run(self) -> BacktestResult:
        warmup = self.strategy.warmup_bars
        first_bar = warmup - 1
        if first_bar >= self.market.length - 1:
            raise ValueError(
                f"캔들이 부족합니다: {self.market.length}개 수신, "
                f"전략 워밍업에 {warmup}개 + 체결용 1개가 필요합니다"
            )

        # 인메모리 SQLite — 백테스트가 실거래 상태 파일을 건드리지 않게 한다.
        store = Store(":memory:")
        broker = PaperBroker(self.market, store, self.settings)
        risk = RiskManager(
            store,
            max_position_pct=self.settings.max_position_pct,
            max_positions=self.settings.max_positions,
            max_daily_loss_pct=self.settings.max_daily_loss_pct,
            max_order_notional=self.settings.max_order_notional,
        )

        curve: list[EquityPoint] = []
        trades: list[Trade] = []
        lots: dict[str, _Lot] = {}
        rejections: Counter[str] = Counter()
        benchmark = _BuyAndHold(self.settings.paper_cash)

        for index in range(first_bar, self.market.length):
            self.market.seek(index)
            ts = self.market.timestamp()
            marks = self.market.marks()

            account = broker.get_account()
            equity = account.equity(marks)
            risk.day_baseline(equity, ts)
            curve.append(
                EquityPoint(
                    ts=ts, equity=equity, cash=account.cash, invested=equity - account.cash
                )
            )
            benchmark.observe(self.market, index == first_bar)

            if not self.market.has_next():
                break  # 체결할 다음 봉이 없다

            for symbol in self.market.symbols:
                candles = self.market.get_candles(
                    symbol, self.settings.candle_interval, warmup + CANDLE_LOOKBACK_SLACK
                )
                signal = self.strategy.on_bar(
                    symbol, candles, account.positions.get(symbol)
                )
                if signal is None:
                    continue

                # 사이징은 실제 체결가(다음 봉 시가)로 한다. 신호 봉 종가로
                # 계산하면 갭이 큰 날 잔고를 초과하는 주문이 나간다.
                quote = self.market.get_quote(symbol)
                exec_price = (
                    quote.ask if signal.action is SignalAction.ENTER_LONG else quote.bid
                )
                decision = risk.evaluate(signal, account, marks, ts, exec_price=exec_price)
                if not decision.approved:
                    rejections[decision.code] += 1
                    continue

                side = Side.BUY if signal.action is SignalAction.ENTER_LONG else Side.SELL
                try:
                    order = broker.place_order(
                        OrderRequest(
                            symbol=symbol,
                            side=side,
                            quantity=decision.quantity,
                            order_type=OrderType.MARKET,
                        )
                    )
                except OrderRejected as exc:
                    rejections[f"broker:{exc.reason.split(',')[0]}"] += 1
                    continue

                self._record(order, store, lots, trades, index + 1)
                account = broker.get_account()

        store.close()

        if len(curve) < 2:
            raise ValueError("평가 구간이 너무 짧아 지표를 계산할 수 없습니다")

        benchmark_curve = benchmark.curve
        return BacktestResult(
            strategy_name=self.strategy.name,
            symbols=self.market.symbols,
            interval=self.settings.candle_interval,
            curve=curve,
            trades=trades,
            metrics=compute(curve, trades),
            benchmark_curve=benchmark_curve,
            benchmark_metrics=compute(benchmark_curve),
            rejections=rejections,
        )

    def _record(
        self,
        order: Order,
        store: Store,
        lots: dict[str, _Lot],
        trades: list[Trade],
        fill_bar: int,
    ) -> None:
        """체결을 라운드트립 장부에 반영한다."""
        commission = store.order_commission(order.order_id)
        fill_ts = self.market.next_timestamp()
        quantity = order.filled_quantity
        if quantity <= 0:
            return

        if order.side is Side.BUY:
            lot = lots.get(order.symbol)
            if lot is None:
                lots[order.symbol] = _Lot(
                    entry_ts=fill_ts,
                    entry_bar=fill_bar,
                    quantity=quantity,
                    price=order.avg_fill_price,
                    commission=commission,
                )
            else:
                lot.merge(quantity, order.avg_fill_price, commission)
            return

        lot = lots.get(order.symbol)
        if lot is None:
            log.warning("진입 기록 없는 매도: %s", order.symbol)
            return

        # 부분 청산이면 진입 수수료를 수량 비례로 배분한다.
        share = Decimal(quantity) / lot.quantity
        entry_commission = lot.commission * share
        gross = (order.avg_fill_price - lot.price) * quantity

        trades.append(
            Trade(
                symbol=order.symbol,
                entry_ts=lot.entry_ts,
                exit_ts=fill_ts,
                quantity=quantity,
                entry_price=lot.price,
                exit_price=order.avg_fill_price,
                pnl=gross - entry_commission - commission,
                bars_held=fill_bar - lot.entry_bar,
            )
        )

        remaining = lot.quantity - quantity
        if remaining <= 0:
            lots.pop(order.symbol, None)
        else:
            lot.quantity = remaining
            lot.commission -= entry_commission


class _BuyAndHold:
    """동일가중 바이앤홀드 벤치마크.

    전략과 같은 시점·같은 자본으로 시작해 끝까지 들고 간다. 전략이 이걸 못 이기면
    수수료와 복잡성만 더한 셈이다.
    """

    def __init__(self, cash: Decimal) -> None:
        self.start_cash = cash
        self.cash = cash
        self.shares: dict[str, int] = {}
        self.curve: list[EquityPoint] = []

    def observe(self, market: ReplayMarket, is_first: bool) -> None:
        # 전략과 동일한 순서: 먼저 현재 보유 기준으로 평가액을 찍고, 매수는
        # 다음 봉 시가에 체결된다. 그래야 벤치마크가 한 봉 앞서지 않는다.
        invested = sum(
            (market.close_price(s) * q for s, q in self.shares.items()), Decimal("0")
        )
        self.curve.append(
            EquityPoint(
                ts=market.timestamp(),
                equity=self.cash + invested,
                cash=self.cash,
                invested=invested,
            )
        )

        if is_first and market.has_next():
            budget = self.start_cash / len(market.symbols)
            for symbol in market.symbols:
                price = market.get_quote(symbol).ask  # 다음 봉 시가 + 반스프레드
                quantity = int(budget / price) if price > 0 else 0
                if quantity:
                    self.shares[symbol] = quantity
                    self.cash -= price * quantity
