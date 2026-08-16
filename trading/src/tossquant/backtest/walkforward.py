"""워크포워드 검증.

단일 구간 백테스트 한 번으로 파라미터를 고르는 건 검증이 아니다. 같은 데이터로
고르고 같은 데이터로 평가하면 어떤 전략이든 좋아 보인다. SMA 20/60이 잘 나온 게
그 구간에 우연히 맞았기 때문인지, 진짜 작동하는 건지 구분할 방법이 없다.

워크포워드는 이렇게 나눈다:

    [--- 학습 ---][평가]
           [--- 학습 ---][평가]
                  [--- 학습 ---][평가]

각 구간마다 **앞부분에서만** 파라미터를 고르고 **뒤에 오는 한 번도 안 본 구간**에서
평가한다. 평가 구간들을 이어붙인 곡선이 실제로 기대할 수 있는 성과다.

읽을 때 볼 것 두 가지:

1. **성과 유지율 (OOS / IS)** — 아웃오브샘플이 인샘플보다 나쁜 건 정상이다.
   문제는 격차의 크기다. 크게 떨어지면 파라미터가 과거에 맞춰진 것이다.
2. **파라미터 안정성** — 구간마다 최적 파라미터가 널뛰면, 그 '최적값'은
   신호가 아니라 잡음이다. 어느 값을 골라도 근거가 없다는 뜻이다.
"""

from __future__ import annotations

import logging
import math
from collections.abc import Callable
from dataclasses import dataclass, field, replace
from decimal import Decimal
from typing import Any

from ..config import Settings
from ..models import Candle
from ..params import ParamGrid
from ..strategy.base import Strategy
from ..strategy.sma_cross import SmaCrossStrategy
from .metrics import EquityPoint, Metrics, Trade, compute
from .replay import align
from .simulator import BacktestResult, Backtester

log = logging.getLogger(__name__)

StrategyFactory = Callable[[dict[str, Any]], Strategy]

# 목적함수. 무엇을 최적화하느냐가 결과 성격을 바꾼다.
OBJECTIVES: dict[str, Callable[[Metrics], float]] = {
    # 변동성 대비 수익. 기본값 — 수익률만 보면 과최적화로 직행한다.
    "sharpe": lambda m: m.sharpe,
    "sortino": lambda m: m.sortino,
    # 연수익 / 최대낙폭. 낙폭을 직접 벌주므로 실전 감각에 가깝다.
    "calmar": lambda m: m.cagr / m.max_drawdown if m.max_drawdown > 0 else m.cagr,
    "cagr": lambda m: m.cagr,
    "return": lambda m: m.total_return,
}


def sma_grid(fast: list[int], slow: list[int]) -> ParamGrid:
    return ParamGrid(
        values={"fast": fast, "slow": slow},
        valid=lambda p: p["fast"] < p["slow"],
    )


def sma_factory(params: dict[str, Any]) -> Strategy:
    return SmaCrossStrategy(params["fast"], params["slow"])


@dataclass(frozen=True)
class Fold:
    index: int
    train_start: int
    train_end: int  # exclusive
    test_start: int
    test_end: int  # exclusive

    @property
    def train_bars(self) -> int:
        return self.train_end - self.train_start

    @property
    def test_bars(self) -> int:
        return self.test_end - self.test_start


def make_folds(
    total_bars: int,
    train_bars: int,
    test_bars: int,
    *,
    anchored: bool = False,
) -> list[Fold]:
    """구간을 자른다.

    anchored=True면 학습 구간이 처음부터 계속 늘어난다(확장 창). False면 고정
    길이로 미끄러진다(롤링 창). 시장 성격이 변하는 걸 전제하면 롤링이 맞고,
    데이터가 짧으면 확장 창이 낫다.
    """
    if train_bars <= 0 or test_bars <= 0:
        raise ValueError("train_bars와 test_bars는 1 이상이어야 합니다")

    folds: list[Fold] = []
    test_start = train_bars
    while test_start + test_bars <= total_bars:
        folds.append(
            Fold(
                index=len(folds),
                train_start=0 if anchored else test_start - train_bars,
                train_end=test_start,
                test_start=test_start,
                test_end=test_start + test_bars,
            )
        )
        test_start += test_bars

    if not folds:
        raise ValueError(
            f"구간을 만들 수 없습니다: 봉 {total_bars}개로는 "
            f"학습 {train_bars} + 평가 {test_bars}개를 채울 수 없습니다"
        )
    return folds


@dataclass
class FoldResult:
    fold: Fold
    params: dict[str, Any]
    train_score: float
    test_score: float
    train: BacktestResult
    test: BacktestResult
    # 이 구간에서 시도한 모든 조합의 학습 점수. 최적값이 얼마나 뾰족한지 본다.
    candidate_scores: dict[str, float] = field(default_factory=dict)


@dataclass
class WalkForwardResult:
    objective: str
    folds: list[FoldResult]
    curve: list[EquityPoint]
    metrics: Metrics
    # 각 fold가 같은 초기자본으로 독립 실행된 원본 거래가 아니라, 이어붙인 OOS
    # 곡선의 fold별 자본 배율로 가격·손익을 정규화한 비변형 clone이다. 따라서
    # avg/PF 같은 금액 통계가 복리 curve와 같은 자본 단위를 쓴다.
    trades: list[Trade]
    grid_size: int

    @property
    def retention(self) -> float | None:
        """성과 유지율 = 평균 OOS 점수 / 평균 IS 점수.

        1에 가까울수록 인샘플 성과가 밖에서도 유지됐다는 뜻이다. 0.5면 절반은
        과거에 맞춘 것이었고, 양수 IS 대비 음수면 밖에서 손해였다는 뜻이다.
        IS 평균이 0 이하거나 유한하지 않으면 비율의 부호와 크기가
        해석을 뒤집거나 정의되지 않으므로 유지율도 정의하지 않는다.
        """
        train_mean = sum(f.train_score for f in self.folds) / len(self.folds)
        test_mean = sum(f.test_score for f in self.folds) / len(self.folds)
        # zero-risk 곡선의 Sharpe/Sortino는 signed infinity다. 무한 IS를
        # 분모로 둔 유지율이나 +∞/-∞가 섞여 생긴 NaN은 해석할 수 없다.
        if train_mean <= 0 or not math.isfinite(train_mean) or math.isnan(test_mean):
            return None
        return test_mean / train_mean

    @property
    def param_stability(self) -> float:
        """구간별로 고른 파라미터가 얼마나 일관적인지 (0~1).

        가장 많이 뽑힌 조합의 비율. 1이면 항상 같은 값이 뽑혔다는 뜻이고,
        낮으면 '최적 파라미터'가 잡음이라는 신호다.
        """
        picks = [tuple(sorted(f.params.items())) for f in self.folds]
        return max(picks.count(p) for p in set(picks)) / len(picks)

    @property
    def positive_folds(self) -> int:
        return sum(1 for f in self.folds if f.test.metrics.total_return > 0)


def _stitch_with_scales(
    fold_results: list[FoldResult],
    start_cash: Decimal,
) -> tuple[list[EquityPoint], list[Decimal | None]]:
    """평가 구간들의 수익률을 이어붙여 하나의 곡선으로 만든다.

    각 구간은 같은 자본으로 새로 시작하므로 절대금액을 그냥 잇지 못한다. 구간별
    수익률을 복리로 누적한다. 인접 평가 구간은 앞 구간의 마지막 시각을 다음
    구간의 기준점으로 공유하므로 그 점은 한 번만 남긴다. 중복 기준점을 수익률
    표본으로 세면 0% 수익률이 인위적으로 추가돼 Sharpe·변동성·노출이 달라진다.
    """
    curve: list[EquityPoint] = []
    equity = start_cash
    scales: list[Decimal | None] = []

    for result in fold_results:
        fold_curve = result.test.curve
        if not fold_curve:
            scales.append(None)
            continue
        base = fold_curve[0].equity
        if base <= 0:
            scales.append(None)
            continue
        scale = equity / base
        scales.append(scale)
        for point_index, point in enumerate(fold_curve):
            if curve and point.ts <= curve[-1].ts:
                if point_index == 0 and point.ts == curve[-1].ts:
                    # 연속 fold가 공유하는 OOS 기준점. 이전 fold의 끝점이 이미
                    # 같은 누적 자본을 담고 있으므로 다시 내보내지 않는다.
                    continue
                raise ValueError("워크포워드 평가 곡선의 timestamp가 겹치거나 역행합니다")
            scaled = point.equity * scale
            # 투자액을 같은 자본 배율로 옮기고 현금은 차이로 계산해 회계항등을
            # 정확히 유지한다. 두 항을 따로 곱하면 Decimal 반올림으로 합이 어긋날
            # 수 있다.
            scaled_invested = point.invested * scale
            curve.append(
                EquityPoint(
                    ts=point.ts,
                    equity=scaled,
                    cash=scaled - scaled_invested,
                    invested=scaled_invested,
                )
            )
        equity = curve[-1].equity

    return curve, scales


def stitch(fold_results: list[FoldResult], start_cash: Decimal) -> list[EquityPoint]:
    """평가 곡선만 공개한다. fold별 자본 배율은 거래 정규화에 내부 사용한다."""
    curve, _ = _stitch_with_scales(fold_results, start_cash)
    return curve


def _score(result: BacktestResult, objective: str) -> float:
    score = OBJECTIVES[objective](result.metrics)
    if math.isnan(score):
        raise ValueError(f"목적함수 {objective} 점수가 NaN입니다")
    return score


def _slice(
    history: dict[str, list[Candle]], start: int, end: int
) -> dict[str, list[Candle]]:
    return {symbol: candles[start:end] for symbol, candles in history.items()}


def run(
    history: dict[str, list[Candle]],
    settings: Settings,
    *,
    grid: ParamGrid,
    factory: StrategyFactory = sma_factory,
    train_bars: int = 250,
    test_bars: int = 60,
    objective: str = "sharpe",
    anchored: bool = False,
    min_trades: int = 1,
) -> WalkForwardResult:
    if objective not in OBJECTIVES:
        raise ValueError(
            f"알 수 없는 목적함수 '{objective}' (가능: {', '.join(OBJECTIVES)})"
        )

    aligned = align(history)
    if not aligned:
        raise ValueError("검증할 캔들이 없습니다")
    total = len(next(iter(aligned.values())))

    folds = make_folds(total, train_bars, test_bars, anchored=anchored)
    log.info(
        "워크포워드: %d구간 × %d조합 (학습 %d봉 / 평가 %d봉, 목적 %s)",
        len(folds), len(grid), train_bars, test_bars, objective,
    )

    results: list[FoldResult] = []
    for fold in folds:
        best = _optimize(aligned, settings, fold, grid, factory, objective, min_trades)
        if best is None:
            raise ValueError(
                f"워크포워드 구간 {fold.index + 1}에 유효한 결과가 없어 "
                "불완전한 OOS 집계를 만들 수 없습니다"
            )
        results.append(best)

    if not results:
        raise ValueError("어떤 구간에서도 유효한 결과를 얻지 못했습니다")

    curve, fold_scales = _stitch_with_scales(results, settings.paper_cash)
    trades = [
        replace(
            trade,
            entry_price=trade.entry_price * scale,
            exit_price=trade.exit_price * scale,
            pnl=trade.pnl * scale,
        )
        for result, scale in zip(results, fold_scales)
        if scale is not None
        for trade in result.test.trades
    ]

    return WalkForwardResult(
        objective=objective,
        folds=results,
        curve=curve,
        metrics=compute(curve, trades),
        trades=trades,
        grid_size=len(grid),
    )


def _optimize(
    aligned: dict[str, list[Candle]],
    settings: Settings,
    fold: Fold,
    grid: ParamGrid,
    factory: StrategyFactory,
    objective: str,
    min_trades: int,
) -> FoldResult | None:
    """한 구간: 학습 구간에서 최적 조합을 고르고 평가 구간에서 검증한다."""
    train_history = _slice(aligned, fold.train_start, fold.train_end)

    scored: list[tuple[float, dict[str, Any], BacktestResult, Strategy]] = []
    candidate_scores: dict[str, float] = {}

    for params in grid.combinations():
        strategy = factory(params)
        try:
            result = Backtester(
                train_history,
                strategy,
                settings,
                liquidate_at_end=True,
            ).run()
        except ValueError as exc:
            # 워밍업이 학습 구간보다 긴 조합 등. 조용히 건너뛴다.
            log.debug("구간 %d %s 학습 실패: %s", fold.index, params, exc)
            continue
        score = _score(result, objective)
        candidate_scores[_label(params)] = score
        scored.append((score, params, result, strategy))

    if not scored:
        return None

    # 거래가 아예 없는 조합은 '손실이 없으니 좋아 보이는' 착시를 만든다. 실제로
    # 매매를 한 조합이 하나라도 있으면 그것들 중에서 고른다.
    traded = [s for s in scored if s[2].metrics.trades >= min_trades]
    pool = traded or scored

    # 같은 점수에서는 입력 grid 순서가 아니라 정규화된 파라미터 라벨로 고른다.
    # zero-risk 성과의 signed infinity끼리 동점이어도 선택이 재현 가능해야 한다.
    best_score = max(item[0] for item in pool)
    best_score, best_params, train_result, _ = min(
        (item for item in pool if item[0] == best_score),
        key=lambda item: _label(item[1]),
    )

    # 평가 구간 앞에 워밍업 봉을 붙여준다. 안 그러면 평가 구간 초반이 통째로
    # 신호 없이 지나간다.
    strategy = factory(best_params)
    warmup = strategy.warmup_bars
    regime_symbol = settings.regime_symbol.upper()
    if settings.regime_enabled and regime_symbol in aligned:
        # Backtester도 같은 유효 워밍업을 쓰므로, OOS 슬라이스 역시 국면
        # 이동평균을 채울 만큼 앞 구간을 붙여야 평가 시작부터 필터가 작동한다.
        warmup = max(warmup, settings.regime_ma_bars)
    test_history = _slice(
        aligned, max(0, fold.test_start - warmup), fold.test_end
    )
    try:
        test_result = Backtester(
            test_history,
            strategy,
            settings,
            liquidate_at_end=True,
        ).run()
    except ValueError as exc:
        log.warning("구간 %d 평가 실패: %s", fold.index, exc)
        return None

    return FoldResult(
        fold=fold,
        params=best_params,
        train_score=best_score,
        test_score=_score(test_result, objective),
        train=train_result,
        test=test_result,
        candidate_scores=candidate_scores,
    )


def _label(params: dict[str, Any]) -> str:
    return "/".join(str(params[k]) for k in sorted(params))
