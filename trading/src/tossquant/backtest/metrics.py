"""성과 지표.

수익률만 보면 안 된다. 드로다운과 거래 횟수를 같이 봐야 "운 좋게 한 방 맞은
전략"과 "실제로 작동하는 전략"이 구분된다. 벤치마크(바이앤홀드) 대비 초과수익이
없으면 그 전략은 존재 이유가 없다는 뜻이기도 하다.

무위험수익률은 0으로 둔다. Sharpe를 다른 도구의 값과 직접 비교할 때 주의할 것.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from datetime import datetime
from decimal import Decimal

SECONDS_PER_YEAR = 365.25 * 24 * 3600


@dataclass(frozen=True)
class EquityPoint:
    ts: datetime
    equity: Decimal
    cash: Decimal
    invested: Decimal


@dataclass(frozen=True)
class Trade:
    """라운드트립 한 건 (진입 → 청산)."""

    symbol: str
    entry_ts: datetime
    exit_ts: datetime
    quantity: int
    entry_price: Decimal
    exit_price: Decimal
    pnl: Decimal
    bars_held: int

    @property
    def return_pct(self) -> float:
        cost = self.entry_price * self.quantity
        return float(self.pnl / cost) if cost else 0.0

    @property
    def is_win(self) -> bool:
        return self.pnl > 0


@dataclass(frozen=True)
class Metrics:
    start_equity: Decimal
    end_equity: Decimal
    total_return: float
    cagr: float
    max_drawdown: float
    max_drawdown_bars: int
    volatility: float
    sharpe: float
    sortino: float
    exposure: float
    bars: int
    years: float
    # 거래 통계 (벤치마크에는 없을 수 있다)
    trades: int = 0
    win_rate: float = 0.0
    avg_win: Decimal = Decimal("0")
    avg_loss: Decimal = Decimal("0")
    # 총이익 / 총손실. 거래가 없으면 정의되지 않아 None, 손실 없이 이익만
    # 있으면 양의 무한대다. 둘을 0으로 합치면 최고와 무성과를 뒤집어 표시한다.
    profit_factor: float | None = None


def _returns(curve: list[EquityPoint]) -> list[float]:
    out: list[float] = []
    for prev, cur in zip(curve, curve[1:]):
        if prev.equity <= 0:
            out.append(0.0)
        else:
            out.append(float((cur.equity - prev.equity) / prev.equity))
    return out


def _drawdown(curve: list[EquityPoint]) -> tuple[float, int]:
    """최대 낙폭과 그 낙폭이 회복되지 않고 이어진 최장 봉 수."""
    peak = curve[0].equity
    peak_index = 0
    max_dd = 0.0
    max_duration = 0

    for i, point in enumerate(curve):
        if point.equity >= peak:
            peak = point.equity
            peak_index = i
        elif peak > 0:
            drop = float((peak - point.equity) / peak)
            max_dd = max(max_dd, drop)
            max_duration = max(max_duration, i - peak_index)

    return max_dd, max_duration


def _stdev(values: list[float]) -> float:
    if len(values) < 2:
        return 0.0
    mean = sum(values) / len(values)
    try:
        variance = sum((v - mean) ** 2 for v in values) / (len(values) - 1)
    except OverflowError as exc:
        raise ValueError("유한하지 않은 지표가 계산됐습니다") from exc
    return math.sqrt(variance)


def _downside_deviation(values: list[float], target: float = 0.0) -> float:
    """목표수익률 아래 편차의 제곱평균제곱근.

    음수 표본만 뽑아 표본표준편차를 계산하면 손실이 정확히 한 번일 때 분모가
    0이 된다. Sortino의 downside risk는 음수 표본들끼리의 산포가 아니라
    목표에서 얼마나 아래로 벗어났는지를 전체 관측 수에 대해 측정한다.
    """
    if not values:
        return 0.0
    try:
        return math.sqrt(
            sum(min(value - target, 0.0) ** 2 for value in values) / len(values)
        )
    except OverflowError as exc:
        raise ValueError("유한하지 않은 지표가 계산됐습니다") from exc


def _annualized_ratio(
    mean_return: float,
    denominator: float,
    annualizer: float,
) -> float:
    """0인 위험 분모를 평탄 성과와 같은 0점으로 숨기지 않는다.

    수익률이 매 봉 정확히 같으면 표준편차가 0이다. 이때 양의 수익, 무수익,
    음의 수익은 각각 +∞, 0, -∞로 구분해야 Sharpe/Sortino 최적화가 손실 조합을
    평탄 조합과 동점 처리하지 않는다.
    """
    if denominator > 0:
        return (mean_return / denominator) * annualizer
    if mean_return > 0:
        return math.inf
    if mean_return < 0:
        return -math.inf
    return 0.0


def compute(curve: list[EquityPoint], trades: list[Trade] | None = None) -> Metrics:
    if len(curve) < 2:
        raise ValueError("지표 계산에는 최소 2개의 관측이 필요합니다")

    previous_ts: datetime | None = None
    for index, point in enumerate(curve):
        if (
            not isinstance(point.ts, datetime)
            or point.ts.tzinfo is None
            or point.ts.utcoffset() is None
        ):
            raise ValueError(
                f"timestamp[{index}]는 timezone-aware datetime이어야 합니다"
            )
        if previous_ts is not None and point.ts <= previous_ts:
            raise ValueError("curve timestamp는 엄격히 증가해야 합니다")
        previous_ts = point.ts
        monetary = {
            "equity": point.equity,
            "cash": point.cash,
            "invested": point.invested,
        }
        for name, value in monetary.items():
            if not isinstance(value, Decimal) or not value.is_finite():
                raise ValueError(
                    f"{name}[{index}]는 유한한 Decimal이어야 합니다"
                )
        if point.cash < 0 or point.invested < 0:
            raise ValueError(f"cash/invested[{index}]는 0 이상이어야 합니다")
        try:
            components = point.cash + point.invested
        except ArithmeticError as exc:
            raise ValueError(
                f"cash+invested[{index}] 합계를 계산할 수 없습니다"
            ) from exc
        if components != point.equity:
            raise ValueError(
                f"cash+invested[{index}]가 equity와 일치해야 합니다"
            )
        as_float = float(point.equity)
        if not math.isfinite(as_float) or (as_float == 0.0 and point.equity != 0):
            raise ValueError(
                "유한하지 않은 측정값: "
                f"equity[{index}]가 지표 계산의 유한한 float 범위를 벗어났습니다"
            )

    trades = trades or []
    start = curve[0].equity
    end = curve[-1].equity

    span_seconds = (curve[-1].ts - curve[0].ts).total_seconds()
    years = span_seconds / SECONDS_PER_YEAR

    total_return = float((end - start) / start) if start > 0 else 0.0

    if years > 0 and start > 0 and end > 0:
        try:
            cagr = (float(end) / float(start)) ** (1 / years) - 1
        except OverflowError as exc:
            raise ValueError("유한하지 않은 지표가 계산됐습니다") from exc
    else:
        cagr = 0.0

    returns = _returns(curve)
    # 데이터가 실제로 담고 있는 연간 봉 수. 일봉/분봉을 따로 하드코딩하지 않는다.
    periods_per_year = len(returns) / years if years > 0 else 0.0
    annualizer = math.sqrt(periods_per_year) if periods_per_year > 0 else 0.0

    step_vol = _stdev(returns)
    mean_return = sum(returns) / len(returns) if returns else 0.0
    downside = _downside_deviation(returns)

    volatility = step_vol * annualizer
    sharpe = _annualized_ratio(mean_return, step_vol, annualizer)
    sortino = _annualized_ratio(mean_return, downside, annualizer)

    max_dd, max_dd_bars = _drawdown(curve)
    exposure = sum(1 for p in curve if p.invested > 0) / len(curve)

    calculated = {
        "total_return": total_return,
        "cagr": cagr,
        "max_drawdown": max_dd,
        "volatility": volatility,
        "exposure": exposure,
        "years": years,
    }
    for name, value in calculated.items():
        if not math.isfinite(value):
            raise ValueError(f"유한하지 않은 지표가 계산됐습니다: {name}")
    # 위험이 정확히 0인 비평탄 곡선의 signed infinity는 유효한 도메인 값이다.
    # NaN만은 어떤 성과 순서도 정의하지 못하므로 계속 실패시킨다.
    for name, value in {"sharpe": sharpe, "sortino": sortino}.items():
        if math.isnan(value):
            raise ValueError(f"정의되지 않은 지표가 계산됐습니다: {name}")

    wins = [t for t in trades if t.pnl > 0]
    # 손익 0은 승률에서는 비승리지만 실제 손실 평균의 분모에는 넣지 않는다.
    losses = [t for t in trades if t.pnl < 0]
    gross_profit = sum((t.pnl for t in wins), Decimal("0"))
    gross_loss = -sum((t.pnl for t in losses), Decimal("0"))

    if gross_loss > 0:
        profit_factor_decimal = gross_profit / gross_loss
        profit_factor: float | None = float(profit_factor_decimal)
        if not math.isfinite(profit_factor) or (
            profit_factor == 0.0 and profit_factor_decimal != 0
        ):
            raise ValueError("손익비가 유한한 float 범위를 벗어났습니다")
    elif gross_profit > 0:
        profit_factor = math.inf
    else:
        profit_factor = None

    return Metrics(
        start_equity=start,
        end_equity=end,
        total_return=total_return,
        cagr=cagr,
        max_drawdown=max_dd,
        max_drawdown_bars=max_dd_bars,
        volatility=volatility,
        sharpe=sharpe,
        sortino=sortino,
        exposure=exposure,
        bars=len(curve),
        years=years,
        trades=len(trades),
        win_rate=len(wins) / len(trades) if trades else 0.0,
        avg_win=gross_profit / len(wins) if wins else Decimal("0"),
        avg_loss=-gross_loss / len(losses) if losses else Decimal("0"),
        profit_factor=profit_factor,
    )
