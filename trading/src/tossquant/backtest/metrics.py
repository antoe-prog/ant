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
    profit_factor: float = 0.0


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
        if point.equity > peak:
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
    variance = sum((v - mean) ** 2 for v in values) / (len(values) - 1)
    return math.sqrt(variance)


def compute(curve: list[EquityPoint], trades: list[Trade] | None = None) -> Metrics:
    if len(curve) < 2:
        raise ValueError("지표 계산에는 최소 2개의 관측이 필요합니다")

    trades = trades or []
    start = curve[0].equity
    end = curve[-1].equity

    span_seconds = (curve[-1].ts - curve[0].ts).total_seconds()
    years = span_seconds / SECONDS_PER_YEAR

    total_return = float((end - start) / start) if start > 0 else 0.0

    if years > 0 and start > 0 and end > 0:
        cagr = (float(end) / float(start)) ** (1 / years) - 1
    else:
        cagr = 0.0

    returns = _returns(curve)
    # 데이터가 실제로 담고 있는 연간 봉 수. 일봉/분봉을 따로 하드코딩하지 않는다.
    periods_per_year = len(returns) / years if years > 0 else 0.0
    annualizer = math.sqrt(periods_per_year) if periods_per_year > 0 else 0.0

    step_vol = _stdev(returns)
    mean_return = sum(returns) / len(returns) if returns else 0.0
    downside = _stdev([r for r in returns if r < 0])

    volatility = step_vol * annualizer
    sharpe = (mean_return / step_vol) * annualizer if step_vol > 0 else 0.0
    sortino = (mean_return / downside) * annualizer if downside > 0 else 0.0

    max_dd, max_dd_bars = _drawdown(curve)
    exposure = sum(1 for p in curve if p.invested > 0) / len(curve)

    wins = [t for t in trades if t.is_win]
    losses = [t for t in trades if not t.is_win]
    gross_profit = sum((t.pnl for t in wins), Decimal("0"))
    gross_loss = -sum((t.pnl for t in losses), Decimal("0"))

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
        profit_factor=float(gross_profit / gross_loss) if gross_loss > 0 else 0.0,
    )
