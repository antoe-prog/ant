"""매매 루프.

한 사이클 = 시세 수집 → 전략 신호 → 리스크 심사 → 주문. 사이클 하나는
run_once()로 떼어 두어 테스트에서 시간을 직접 넣어 돌릴 수 있게 했다.
"""

from __future__ import annotations

import logging
import threading
import time
import unicodedata
from dataclasses import dataclass
from datetime import datetime, timezone
from decimal import Decimal
from hashlib import sha256

import httpx

from .broker.base import Broker, BrokerError, OrderRejected
from .broker.paper import PaperBroker
from .calendar_us import describe, is_market_open, minutes_to_close, to_ny
from .config import Settings
from .models import (
    Candle,
    Order,
    OrderRequest,
    OrderStatus,
    OrderType,
    Position,
    Side,
    Signal,
    SignalAction,
)
from .notify import Level, Notification, Notifier, NullNotifier
from .regime import RegimeFilter, RegimeState
from .risk import RiskManager
from .stops import StopManager
from .store import Store, StoreConflict
from .strategy.base import Strategy

log = logging.getLogger(__name__)

# 워밍업에 여유를 둬서 휴장일·결측 캔들로 신호가 안 나오는 상황을 피한다.
CANDLE_BUFFER = 20


@dataclass
class SignalBatch:
    """이번 사이클의 신호와, 국면 필터가 걷어낸 진입 수."""

    signals: list[Signal]
    suppressed_entries: int = 0


def _validated_strategy_signal(
    candidate: object, expected_symbol: str | None = None
) -> Signal | None:
    """Return only a structurally valid signal for the symbol being evaluated."""
    if not isinstance(candidate, Signal):
        log.error("전략이 Signal이 아닌 값을 반환했습니다: %r", candidate)
        return None
    try:
        # Call the class implementation directly so a hostile subclass cannot
        # override the boundary check that protects order routing.
        Signal.assert_valid(candidate)
    except ValueError as exc:
        log.error("전략이 잘못된 Signal을 반환했습니다: %s", exc)
        return None
    if expected_symbol is not None and candidate.symbol != expected_symbol:
        log.error(
            "%s 전략 평가가 다른 종목 %s의 신호를 반환해 폐기합니다",
            expected_symbol,
            candidate.symbol,
        )
        return None
    return candidate


def collect_signals(
    symbols: list[str],
    strategy: Strategy,
    stops: StopManager,
    positions: dict[str, Position],
    marks: dict[str, Decimal],
    candles: dict[str, list[Candle]],
    now: datetime,
    *,
    allow_entries: bool = True,
) -> SignalBatch:
    """이번 사이클에 처리할 신호 목록.

    실시간 엔진과 백테스트가 **같은 함수**를 쓴다. 신호 우선순위가 두 곳에서
    갈리면 백테스트 결과를 믿을 수 없게 되므로 여기 한 곳에만 둔다.

    우선순위:
    1. 보호 청산이 전략보다 앞선다. 손절이 걸린 종목은 그 사이클에 전략 신호를
       아예 묻지 않는다 — 같은 봉에서 손절과 전략 매수가 동시에 나오는 걸 막는다.
    2. `allow_entries=False`(시장 국면 위험)면 **신규 진입만** 걷어낸다.
       청산은 국면과 무관하게 통과시킨다 — 하락장에서 못 빠져나오게 막는 건
       정확히 반대로 가는 짓이다.
    """
    protective = stops.exits(positions, marks, now)
    stopped = {signal.symbol for signal in protective}
    signals = list(protective)
    suppressed = 0

    for symbol in symbols:
        if symbol in stopped:
            continue
        rows = candles.get(symbol)
        if not rows:
            continue
        try:
            signal = strategy.on_bar(symbol, rows, positions.get(symbol))
        except Exception:  # 전략 버그가 루프 전체를 죽이지 않게 한다
            log.exception("%s 전략 평가 중 오류", symbol)
            continue
        if signal is None:
            continue
        signal = _validated_strategy_signal(signal, expected_symbol=symbol)
        if signal is None:
            continue
        if not allow_entries and signal.action is SignalAction.ENTER_LONG:
            suppressed += 1
            continue
        signals.append(signal)

    return SignalBatch(signals=signals, suppressed_entries=suppressed)


class TradingEngine:
    def __init__(
        self,
        broker: Broker,
        strategy: Strategy,
        risk: RiskManager,
        store: Store,
        settings: Settings,
        stops: StopManager | None = None,
        notifier: Notifier | None = None,
        regime: RegimeFilter | None = None,
    ) -> None:
        self.broker = broker
        self.strategy = strategy
        self.risk = risk
        self.store = store
        self.settings = settings
        self.notifier = notifier or NullNotifier()
        self.stops = stops or StopManager(
            store,
            stop_loss_pct=settings.stop_loss_pct,
            trailing_stop_pct=settings.trailing_stop_pct,
            take_profit_pct=settings.take_profit_pct,
            max_holding_days=settings.max_holding_days,
            cooldown_days=settings.stop_cooldown_days,
        )
        self.regime = regime or RegimeFilter(
            settings.regime_symbol,
            settings.regime_ma_bars,
            enabled=settings.regime_enabled,
        )
        self._stopped = False
        self._halt_signal_batch = False
        self._run_lock = threading.Lock()

    # --- 한 사이클 ----------------------------------------------------------

    def run_once(self, now: datetime | None = None) -> list[Order]:
        if not self._run_lock.acquire(blocking=False):
            log.error("이 TradingEngine의 이전 실행 사이클이 아직 진행 중입니다")
            return []
        try:
            return self._run_once(now)
        finally:
            self._run_lock.release()

    def _run_once(self, now: datetime | None = None) -> list[Order]:
        moment = now or datetime.now(timezone.utc)

        if not is_market_open(moment):
            log.debug("장외 — 건너뜀 (%s)", describe(moment))
            return []

        if isinstance(self.broker, PaperBroker):
            for order in self.broker.poll_open_orders():
                log.info("미체결 지정가 체결됨: %s", order.order_id)

        account = self.broker.get_account()
        held_symbols = [
            symbol
            for symbol, position in account.positions.items()
            if position.quantity > 0
        ]
        market_symbols = list(dict.fromkeys([*self.settings.symbols, *held_symbols]))
        candles = self._collect_candles(market_symbols)
        uncovered_holdings = set(held_symbols) - set(candles)
        if uncovered_holdings:
            self._notify_holding_coverage(uncovered_holdings)
        if not candles:
            log.warning("사용 가능한 캔들이 없어 이번 사이클을 건너뜁니다")
            return []

        marks = {
            symbol: rows[-1].close for symbol, rows in candles.items() if rows
        }
        if uncovered_holdings:
            # Account.equity는 mark가 없으면 avg_price를 쓰므로 여기서 호출하면
            # 거짓 평가액과 일일 손실 기준선을 영속화한다. 커버리지가 회복될
            # 때까지 평가·손실·마감 요약은 모두 생략한다.
            log.error(
                "보유종목 시세 누락으로 평가 기록을 건너뜁니다: %s",
                ", ".join(sorted(uncovered_holdings)),
            )
        else:
            equity = account.equity(marks)
            self.store.record_equity(equity, account.cash, moment)
            # 신호가 없는 날에도 매 사이클 호출해야 당일 기준선이 장 시작 시점
            # 평가액으로 잡힌다. 첫 신호가 뜰 때까지 미루면 기준선이 그날 중간
            # 어딘가로 잡혀 일일 손실 한도가 헐거워진다.
            baseline = self.risk.day_baseline(equity, moment)
            self._notify_daily_loss(equity, baseline, moment)
            self._notify_daily_summary(
                equity, baseline, moment, account.positions
            )

        state = self._evaluate_regime()
        if not state.known:
            log.error("시장 국면 판단 불가 — 신규 진입 차단 (%s)", state.reason)
        elif not state.risk_on:
            log.info("시장 국면 위험 — 신규 진입 차단 (%s)", state.reason)
        self._notify_regime(state, moment)

        batch = collect_signals(
            self.settings.symbols,
            self.strategy,
            self.stops,
            account.positions,
            marks,
            candles,
            moment,
            allow_entries=state.risk_on and not uncovered_holdings,
        )
        if batch.suppressed_entries:
            log.info("국면 필터가 진입 신호 %d건을 걷어냈습니다", batch.suppressed_entries)

        executed: list[Order] = []
        self._halt_signal_batch = False
        for signal in batch.signals:
            # 동일한 완결 봉을 여러 poll cycle/process가 읽어도 live client key가
            # 같아야 한다. wall-clock 경계가 아니라 실제 의사결정 봉을 전달한다.
            decision_ts = candles[signal.symbol][-1].ts
            order = self._act(
                signal,
                account,
                marks,
                moment,
                decision_ts=decision_ts,
            )
            if order is not None:
                executed.append(order)
            if order is not None or self._halt_signal_batch:
                # 체결 또는 미확정 제출로 현금·포지션이 바뀌었을 수 있으므로
                # 다음 심사/다음 사이클 전에 반드시 새 스냅샷을 받는다.
                account = self.broker.get_account()
            if self._halt_signal_batch:
                log.error("미확정 라이브 주문으로 이번 신호 배치를 중단합니다")
                break

        return executed

    def _collect_candles(
        self, symbols: list[str] | None = None
    ) -> dict[str, list[Candle]]:
        need = self.strategy.warmup_bars + CANDLE_BUFFER
        collected: dict[str, list[Candle]] = {}
        for symbol in symbols if symbols is not None else self.settings.symbols:
            try:
                rows = self.broker.get_candles(symbol, self.settings.candle_interval, need)
            except BrokerError as exc:
                log.error("%s 캔들 조회 실패: %s", symbol, exc)
                continue
            if len(rows) < self.strategy.warmup_bars:
                log.warning(
                    "%s 캔들 부족: %d개 (필요 %d개)",
                    symbol, len(rows), self.strategy.warmup_bars,
                )
                continue
            collected[symbol] = rows
        return collected

    def _regime_candles(self) -> list[Candle] | None:
        """국면 판정용 지수 캔들. 매매 대상이 아니라 데이터로만 쓴다."""
        if not self.regime.enabled:
            return None
        try:
            return self.broker.get_candles(
                self.regime.symbol,
                self.settings.candle_interval,
                self.regime.warmup_bars + CANDLE_BUFFER,
            )
        except BrokerError as exc:
            log.warning("%s 지수 캔들 조회 실패: %s", self.regime.symbol, exc)
            return None

    def _evaluate_regime(self) -> RegimeState:
        try:
            return self.regime.evaluate(self._regime_candles())
        except Exception as exc:
            # 지수 데이터/지표 계산 결함은 전략·청산 루프를 죽이지 않되, 켜진
            # 필터를 정상으로 꾸며 신규 주문을 보내지도 않는다.
            log.exception("%s 시장 국면 평가 실패", self.regime.symbol)
            return RegimeState(
                risk_on=False,
                known=False,
                reason=f"{self.regime.symbol} 평가 실패: {exc}",
            )

    def _exec_price(self, signal: Signal) -> Decimal | None:
        """주문이 실제로 체결될 가격. 사이징 기준을 종가가 아닌 현재 호가로 잡는다.

        신호가 났을 때만 호출되므로 시세 한도를 크게 먹지 않는다. 조회 실패는
        None으로 표현한다. 페이퍼 경로는 종가 폴백을 쓸 수 있지만, 실제 체결가가
        크게 벌어질 수 있는 라이브 신규 진입은 `_act`에서 fail-closed 처리한다.
        """
        try:
            quote = self.broker.get_quote(signal.symbol)
        except BrokerError as exc:
            log.warning("%s 호가 조회 실패: %s", signal.symbol, exc)
            return None
        price = quote.ask if signal.action is SignalAction.ENTER_LONG else quote.bid
        if not price.is_finite() or price <= 0:
            log.warning("%s 호가가 유효하지 않습니다: %s", signal.symbol, price)
            return None
        return price

    def _act(
        self,
        signal: Signal,
        account,
        marks: dict[str, Decimal],
        moment: datetime,
        *,
        decision_ts: datetime | None = None,
    ) -> Order | None:
        signal = _validated_strategy_signal(signal)
        if signal is None:
            return None
        if self.broker.is_live:
            try:
                account_scope = self._live_account_scope()
                self.store.acquire_live_account_lease(account_scope)
            except (BrokerError, StoreConflict, ValueError) as exc:
                log.error("라이브 계좌 소유권 획득 실패 %s: %s", signal.symbol, exc)
                self._notify_order_problem("주문 보류", signal, exc)
                return None
            # 값싼 advisory preflight다. 이 조회 직후 상태가 바뀔 수 있으므로
            # 제출 권한은 아래 lifecycle lease 안의 claim이 다시 판정한다.
            same_symbol = self.store.unresolved_live_order(signal.symbol)
            if same_symbol is not None:
                exc = BrokerError(
                    f"미확정 주문 {same_symbol['order_id']} "
                    f"({same_symbol['status']})이 남아 있습니다. 토스에서 상태를 "
                    "확인하고 로컬 주문 기록을 정리하기 전에는 자동 재주문하지 않습니다."
                )
                log.error("주문 보류 %s: %s", signal.symbol, exc)
                self._notify_order_problem("주문 보류", signal, exc)
                return None
            if signal.action is SignalAction.ENTER_LONG:
                unresolved = self.store.unresolved_live_order()
                if unresolved is not None:
                    exc = BrokerError(
                        f"다른 종목의 미확정 주문 {unresolved['order_id']} "
                        f"({unresolved['symbol']} {unresolved['status']}) 때문에 "
                        "계좌 현금·포지션을 확정할 수 없어 신규 진입을 전역 차단합니다."
                    )
                    log.error("주문 보류 %s: %s", signal.symbol, exc)
                    self._notify_order_problem("주문 보류", signal, exc)
                    return None
            try:
                # 이 lease는 SQLite transaction이 아니다. quote/risk/claim부터
                # broker 응답 영속화와 intent 정리까지 제출 수명주기만 OS 수준에서
                # 직렬화한다. BUY는 전역 진입+종목, SELL은 종목 lease만 사용한다.
                with self.store.live_submission_lease(
                    signal.symbol,
                    is_entry=signal.action is SignalAction.ENTER_LONG,
                    account_scope=account_scope,
                ):
                    try:
                        # account was first read before strategy evaluation. A
                        # different Engine/process may have completed an order
                        # while this cycle waited for the account-scoped lease.
                        # Re-read inside the lease before any risk decision.
                        current_account = self.broker.get_account()
                    except BrokerError as exc:
                        self._halt_signal_batch = True
                        log.error("계좌 재조회 실패 %s: %s", signal.symbol, exc)
                        self._notify_order_problem("주문 보류", signal, exc)
                        return None
                    return self._act_under_submission_lease(
                        signal, current_account, marks, moment, decision_ts
                    )
            except StoreConflict as exc:
                log.error("주문 보류 %s: %s", signal.symbol, exc)
                self._notify_order_problem("주문 보류", signal, exc)
                return None
        return self._act_under_submission_lease(
            signal, account, marks, moment, decision_ts
        )

    def _live_account_scope(self) -> str:
        """Return a non-secret key shared by processes trading one account."""
        raw_base_url = self.settings.base_url.strip()
        account_id = unicodedata.normalize(
            "NFC", self.settings.account_id.strip()
        )
        if not raw_base_url or not account_id:
            raise BrokerError(
                "라이브 계좌 주문 잠금을 만들 base_url/account_id가 모두 필요합니다"
            )
        try:
            url = httpx.URL(raw_base_url)
        except (httpx.InvalidURL, ValueError) as exc:
            raise BrokerError(f"라이브 base_url이 올바른 URL이 아닙니다: {exc}") from exc
        if url.scheme not in {"http", "https"} or not url.raw_host:
            raise BrokerError("라이브 base_url은 host가 있는 http/https URL이어야 합니다")
        if url.username or url.password or url.query or url.fragment:
            raise BrokerError(
                "라이브 base_url에는 userinfo, query, fragment를 넣을 수 없습니다"
            )
        if any(
            ord(character) < 32 or ord(character) == 127
            for character in account_id
        ):
            raise BrokerError("라이브 account_id에는 제어 문자를 넣을 수 없습니다")

        host = url.raw_host.decode("ascii").lower().rstrip(".")
        if not host or "%" in host:
            raise BrokerError("라이브 base_url host가 올바르지 않습니다")
        if ":" in host:  # IPv6 literal
            host = f"[{host}]"
        parsed_port = url.port
        if parsed_port is not None and not 1 <= parsed_port <= 65535:
            raise BrokerError("라이브 base_url port는 1..65535 범위여야 합니다")
        port = f":{parsed_port}" if parsed_port is not None else ""
        # Decode percent aliases and conservatively merge duplicate separators.
        # If an upstream treats those spellings differently, sharing a safety
        # lock over-serializes them; keeping aliases separate could double-submit.
        decoded_path = unicodedata.normalize("NFC", url.path).replace("\\", "/")
        if any(
            ord(character) < 32 or ord(character) == 127
            for character in decoded_path
        ):
            raise BrokerError("라이브 base_url path에는 제어 문자를 넣을 수 없습니다")
        segments: list[str] = []
        for segment in decoded_path.split("/"):
            if not segment or segment == ".":
                continue
            if segment == "..":
                if segments:
                    segments.pop()
                continue
            segments.append(segment)
        path = f"/{'/'.join(segments)}" if segments else ""
        base_url = f"{url.scheme}://{host}{port}{path}"
        # Credential rotation must not silently create a different lock domain,
        # so client_id/secret are deliberately excluded from the identity.
        return f"{base_url}\0{account_id}"

    def _act_under_submission_lease(
        self,
        signal: Signal,
        account,
        marks: dict[str, Decimal],
        moment: datetime,
        decision_ts: datetime | None,
    ) -> Order | None:
        """검증부터 응답 영속화까지 한 live submission lease 안에서 실행한다."""

        if signal.action is SignalAction.ENTER_LONG and self.stops.is_blocked(
            signal.symbol, moment
        ):
            log.info("신호 기각 %s ENTER_LONG — 보호 청산 쿨다운 중", signal.symbol)
            return None

        exec_price = self._exec_price(signal)
        if (
            self.broker.is_live
            and signal.action is SignalAction.ENTER_LONG
            and exec_price is None
        ):
            exc = BrokerError(
                "현재 매수 호가를 확인하지 못해 라이브 주문 한도를 안전하게 "
                "계산할 수 없습니다"
            )
            log.error("신호 기각 %s ENTER_LONG — %s", signal.symbol, exc)
            self._notify_order_problem("주문 보류", signal, exc)
            return None

        decision = self.risk.evaluate(
            signal, account, marks, moment, exec_price=exec_price
        )
        if not decision.approved:
            log.info("신호 기각 %s %s — %s", signal.symbol, signal.action.value, decision.reason)
            return None

        side = Side.BUY if signal.action is SignalAction.ENTER_LONG else Side.SELL
        request_args = {
            "symbol": signal.symbol,
            "side": side,
            "quantity": decision.quantity,
            "order_type": OrderType.MARKET,
        }
        if self.broker.is_live:
            request_args["client_order_id"] = self._live_client_order_id(
                signal.symbol, side, decision_ts or moment
            )
        request = OrderRequest(**request_args)
        log.info(
            "주문 %s %s x%d — 신호: %s / 사이징: %s",
            request.symbol, request.side.value, request.quantity,
            signal.reason, decision.reason,
        )
        if self.broker.is_live:
            try:
                # 권위 fence는 여러 thread/Store가 함께 쓰는 DB에서 check+INSERT를
                # 짧은 트랜잭션으로 수행한다. broker network call 전 commit된다.
                self.store.claim_live_intent(request, moment)
            except StoreConflict as exc:
                log.error("주문 보류 %s: %s", signal.symbol, exc)
                self._notify_order_problem("주문 보류", signal, exc)
                return None
        try:
            order = self.broker.place_order(request)
        except OrderRejected as exc:
            if self.broker.is_live:
                self.store.reject_order_intent(
                    request.client_order_id,
                    reason=str(exc),
                    ts=moment,
                )
            log.error("주문 거부: %s", exc)
            self._notify_order_problem("주문 거부", signal, exc)
            return None
        except BrokerError as exc:
            if self.broker.is_live:
                self._halt_signal_batch = True
            log.error("주문 실패: %s", exc)
            self._notify_order_problem("주문 실패", signal, exc)
            return None

        if self.broker.is_live:
            # ``intent:`` is the local pre-submit ledger namespace.  Treat a
            # broker response that enters it as ambiguous instead of silently
            # turning the fence row into an apparent external order.  The same
            # boundary also prevents a buggy Broker implementation from
            # clearing the request's intent with a mismatched response.
            response_mismatch = None
            if not isinstance(order, Order):
                response_mismatch = "Order 객체가 아닙니다"
            elif (
                not isinstance(order.order_id, str)
                or not order.order_id.strip()
            ):
                response_mismatch = "order_id가 비어 있거나 문자열이 아닙니다"
            elif order.order_id.startswith("intent:"):
                response_mismatch = "order_id가 로컬 intent 예약공간을 침범했습니다"
            elif order.client_order_id != request.client_order_id:
                response_mismatch = "client_order_id가 요청과 다릅니다"
            elif order.symbol != request.symbol:
                response_mismatch = "symbol이 요청과 다릅니다"
            elif order.side is not request.side:
                response_mismatch = "side가 요청과 다릅니다"
            elif order.quantity != request.quantity:
                response_mismatch = "quantity가 요청과 다릅니다"
            if response_mismatch is not None:
                self._halt_signal_batch = True
                exc = BrokerError(
                    f"라이브 주문 응답을 요청과 대사할 수 없습니다: "
                    f"{response_mismatch} — reconciliation required"
                )
                log.error("주문 응답 불일치 %s: %s", signal.symbol, exc)
                self._notify_order_problem("주문 실패", signal, exc)
                # The committed intent deliberately remains NEW.  The broker
                # may have accepted the order, so automatic retry is unsafe.
                return None

            # 실제 주문 행을 먼저 커밋한다. 그 뒤 intent 삭제 전 죽으면 중복 행이
            # 잠시 남을 뿐 재주문은 계속 차단되는 fail-closed 상태다.
            self.store.save_order(order, origin="live")
            if order.order_id != self.store.intent_order_id(request.client_order_id):
                self.store.clear_order_intent(request.client_order_id)

        if (
            order.status is not OrderStatus.FILLED
            or order.filled_quantity != order.quantity
        ):
            if self.broker.is_live and (
                order.filled_quantity > 0
                or order.status in {
                    OrderStatus.NEW,
                    OrderStatus.PARTIALLY_FILLED,
                }
            ):
                # CANCELED도 일부 체결 수량이 있으면 현금·포지션은 바뀌었다.
                # terminal이라 unresolved fence에는 남지 않으므로 이 배치를
                # 즉시 끊고 아래 run_once 경계에서 새 계좌를 받아야 한다.
                self._halt_signal_batch = True
            exc = BrokerError(
                f"주문 {order.order_id} 상태가 {order.status.value}, "
                f"체결 {order.filled_quantity}/{order.quantity}입니다. 토스에서 "
                "최종 상태를 확인하기 전에는 후속 주문을 보내지 않습니다."
            )
            log.error("주문 미확정 %s: %s", signal.symbol, exc)
            self._notify_order_problem("주문 미확정", signal, exc)
            return None

        if signal.action is SignalAction.EXIT:
            self.stops.on_exit(signal.symbol, moment, protective=signal.protective)
        self._notify_fill(order, signal)
        return order

    def _live_client_order_id(
        self, symbol: str, side: Side, decision_ts: datetime
    ) -> str:
        """같은 의사결정 봉의 같은 action이 공유하는 외부 idempotency key."""
        if (
            not isinstance(decision_ts, datetime)
            or decision_ts.tzinfo is None
            or decision_ts.utcoffset() is None
        ):
            raise ValueError("live decision timestamp must be timezone-aware")
        decision_key = decision_ts.astimezone(timezone.utc).isoformat()
        account_scope = sha256(
            self._live_account_scope().encode("utf-8")
        ).hexdigest()
        material = (
            f"tossquant-live-v2\0{account_scope}\0"
            f"{symbol.strip().upper()}\0{side.value}\0"
            f"{decision_key}"
        )
        # 기존 UUID와 같은 32자 hex로 유지해 API 길이 가정을 넓히지 않는다.
        return sha256(material.encode("utf-8")).hexdigest()[:32]

    # --- 알림 ---------------------------------------------------------------

    def _notify_holding_coverage(self, symbols: set[str]) -> None:
        ordered = sorted(symbols)
        self.notifier.notify(
            Notification(
                title="보유종목 관리 불가 — 신규 진입 차단",
                lines=[
                    f"시세·캔들 미확보: {', '.join(ordered)}",
                    "평가액·당일 손실 기준·마감 요약을 기록하지 않습니다.",
                    "가격이 확보된 다른 보유종목의 청산은 계속 처리합니다.",
                ],
                level=Level.ERROR,
                dedup_key=f"holding-coverage:{','.join(ordered)}",
            )
        )

    def _notify_fill(self, order: Order, signal: Signal) -> None:
        if not self.settings.notify_fills:
            return
        kind = "보호 청산" if signal.protective else signal.action.value
        notional = order.avg_fill_price * order.filled_quantity
        self.notifier.notify(
            Notification(
                title=f"{order.symbol} {order.side.value} {order.filled_quantity}주 체결",
                lines=[
                    f"체결가 {order.avg_fill_price:,.2f} USD (총 {notional:,.2f})",
                    f"사유 [{kind}] {signal.reason}",
                    f"모드 {'실주문' if self.broker.is_live else '페이퍼'}",
                ],
                level=Level.WARN if signal.protective else Level.INFO,
            )
        )

    def _notify_order_problem(self, title: str, signal: Signal, exc: Exception) -> None:
        self.notifier.notify(
            Notification(
                title=f"{title}: {signal.symbol}",
                lines=[str(exc)],
                level=Level.ERROR,
                # 같은 종목의 같은 문제가 매 사이클 반복되는 걸 막는다.
                dedup_key=f"order-problem:{signal.symbol}:{title}",
            )
        )

    def _notify_regime(self, state, moment: datetime) -> None:
        """국면이 바뀔 때만 알린다.

        매 사이클 보내면 하루 종일 같은 메시지가 쌓인다. 전환은 드물게 일어나고
        일어날 때는 반드시 알아야 하는 사건이라 SQLite에 직전 상태를 남긴다.
        """
        if not self.regime.enabled:
            return
        if not state.known:
            self.notifier.notify(
                Notification(
                    title="시장 국면 판단 불가 — 신규 진입 차단",
                    lines=[
                        state.reason,
                        "정상/위험 상태를 확정할 때까지 신규 진입을 보내지 않습니다.",
                        "보유 포지션 청산은 계속 허용됩니다.",
                    ],
                    level=Level.ERROR,
                    dedup_key=f"regime-unknown:{self.regime.symbol}",
                )
            )
            # UNKNOWN은 bool 상태가 아니다. 마지막으로 확인된 정상/위험 값을
            # 덮지 않아야 복구 뒤 실제 전이만 정확히 알릴 수 있다.
            return
        previous = self.store.get_state("regime.risk_on")
        pending_key = "notify.regime_transition"
        if previous is None:
            # 첫 관측은 전환이 아니다. 이전 실행이 남긴 수상한 pending도
            # 첫 관측 알림으로 둔갑시키지 않는다.
            self.store.set_state(pending_key, None)
            self.store.set_state("regime.risk_on", state.risk_on)
            return
        if previous != state.risk_on:
            # outbox를 먼저 쓰면 그 다음 상태 저장이나 프로세스가 실패해도
            # 전환 알림을 잃지 않는다. 다음 정상 관측에서 최신 상태로 대사한다.
            self.store.set_state(
                pending_key,
                {"risk_on": state.risk_on, "reason": state.reason},
            )
            self.store.set_state("regime.risk_on", state.risk_on)
        else:
            pending = self.store.get_state(pending_key)
            if (
                isinstance(pending, dict)
                and pending.get("risk_on") != state.risk_on
            ):
                # pending 저장 뒤 관측 상태 저장이 실패했고, 그 사이 실제
                # 국면이 되돌아온 경우 오래된 전환을 보내면 안 된다.
                self.store.set_state(pending_key, None)

        self._deliver_pending_regime_transition()

    def _deliver_pending_regime_transition(self) -> None:
        pending_key = "notify.regime_transition"
        pending = self.store.get_state(pending_key)
        if pending is None:
            return
        if (
            not isinstance(pending, dict)
            or not isinstance(pending.get("risk_on"), bool)
            or not isinstance(pending.get("reason"), str)
        ):
            log.error("국면 전환 알림 outbox 형식이 잘못되었습니다: %r", pending)
            return

        risk_on = pending["risk_on"]
        delivered = self.notifier.notify(
            Notification(
                title=(
                    "시장 국면 → 위험 (신규 진입 차단)"
                    if not risk_on
                    else "시장 국면 → 정상 (신규 진입 재개)"
                ),
                lines=[
                    pending["reason"],
                    "보유 포지션 청산은 국면과 무관하게 계속됩니다.",
                ],
                level=Level.WARN if not risk_on else Level.INFO,
            )
        )
        if delivered and self.store.get_state(pending_key) == pending:
            # 성공 뒤 종료되면 중복 전달은 가능하지만, 실패를 성공으로 기록해
            # 영원히 잃는 것보다 at-least-once가 안전하다.
            self.store.set_state(pending_key, None)

    def _notify_daily_loss(
        self, equity: Decimal, baseline: Decimal, moment: datetime
    ) -> None:
        """일일 손실 한도 도달을 하루 한 번만 알린다.

        한도는 한번 걸리면 그날 내내 유지되는 조건이라 스로틀(기본 5분)로는
        온종일 알림이 반복된다. 전송 여부를 날짜와 함께 SQLite에 남겨서 하루
        한 번을 보장하고, 재시작해도 중복되지 않게 한다.
        """
        if self.settings.max_daily_loss_pct <= 0:
            return
        if baseline <= 0 or equity >= baseline:
            return
        drawdown = (baseline - equity) / baseline
        if drawdown < self.settings.max_daily_loss_pct:
            return

        today = to_ny(moment).date().isoformat()
        if self.store.get_state("notify.daily_loss_date") == today:
            return
        delivered = self.notifier.notify(
            Notification(
                title="일일 손실 한도 도달 — 신규 진입 차단",
                lines=[
                    f"평가액 {equity:,.2f} / 기준 {baseline:,.2f} ({-drawdown * 100:.2f}%)",
                    f"한도 {self.settings.max_daily_loss_pct * 100:.2f}%",
                    "보유 포지션 청산은 계속 허용됩니다.",
                ],
                level=Level.WARN,
            )
        )
        if delivered:
            self.store.set_state("notify.daily_loss_date", today)

    def _notify_daily_summary(
        self,
        equity: Decimal,
        baseline: Decimal,
        moment: datetime,
        positions: dict[str, Position],
    ) -> None:
        """폐장 직전에 하루를 정리해 보낸다.

        시세가 있어야 하므로 장중(폐장 5분 전)에 보낸다. 폴링 주기가 1분이면
        기회가 다섯 번 있으므로 한 사이클을 놓쳐도 괜찮다. 전송 여부를 날짜와
        함께 SQLite에 남겨 하루 한 번을 보장한다 — 재시작해도 중복되지 않는다.
        """
        if not self.settings.notify_daily_summary:
            return
        remaining = minutes_to_close(moment)
        if remaining is None or remaining > 5:
            return

        today = to_ny(moment).date().isoformat()
        if self.store.get_state("notify.summary_date") == today:
            return

        change = (equity - baseline) / baseline * 100 if baseline > 0 else Decimal("0")
        holdings = (
            [f"{p.symbol} {p.quantity}주 @ {p.avg_price:,.2f}" for p in positions.values()]
            if positions
            else ["보유 없음"]
        )

        delivered = self.notifier.notify(
            Notification(
                title=f"{today} 장 마감 요약",
                lines=[
                    f"평가액 {equity:,.2f} USD ({change:+.2f}%)",
                    *holdings,
                ],
                level=Level.INFO,
            )
        )
        if delivered:
            self.store.set_state("notify.summary_date", today)

    # --- 상시 루프 ----------------------------------------------------------

    def stop(self) -> None:
        self._stopped = True

    def run_forever(self, sleep=time.sleep) -> None:
        mode = "실주문" if self.broker.is_live else "페이퍼"
        log.info(
            "엔진 시작 [%s] 전략=%s 종목=%s 주기=%ds",
            mode, self.strategy.name, ",".join(self.settings.symbols),
            self.settings.poll_seconds,
        )
        startup = [
            f"전략 {self.strategy.name} (SMA {self.settings.sma_fast}/{self.settings.sma_slow})",
            f"종목 {', '.join(self.settings.symbols)}",
            f"손절 {self._protection_line()}",
        ]
        # 키 만료는 시작할 때 알려야 의미가 있다. 만료되고 나면 토큰 발급부터
        # 실패해서 봇이 통째로 멈추고, 그때는 이미 늦다.
        expiry = self.settings.key_expiry_warning()
        if expiry:
            startup.append(f"⚠ {expiry}")
            log.warning(expiry)
        self.notifier.notify(
            Notification(
                title=f"봇 시작 [{mode}]",
                lines=startup,
                level=Level.WARN if expiry else Level.INFO,
            )
        )

        failures = 0
        while not self._stopped:
            try:
                self.run_once()
                failures = 0
            except KeyboardInterrupt:
                raise
            except Exception as exc:
                # 한 사이클 실패로 봇이 죽으면 안 된다. 다음 주기에 재시도.
                failures += 1
                log.exception("사이클 실패 — 다음 주기에 재시도합니다")
                self.notifier.notify(
                    Notification(
                        title=f"사이클 실패 ({failures}회 연속)",
                        lines=[f"{type(exc).__name__}: {exc}", "다음 주기에 재시도합니다."],
                        level=Level.ERROR,
                        dedup_key="cycle-failure",
                    )
                )
            sleep(self.settings.poll_seconds)

        log.info("엔진 종료")
        self.notifier.notify(Notification(title="봇 종료", level=Level.WARN))

    def _protection_line(self) -> str:
        s = self.settings
        if s.stop_loss_pct <= 0:
            return "없음 (!)"
        parts = [f"{float(s.stop_loss_pct) * 100:g}%"]
        if s.trailing_stop_pct > 0:
            parts.append(f"트레일링 {float(s.trailing_stop_pct) * 100:g}%")
        return " / ".join(parts)
