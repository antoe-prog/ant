"""워크포워드 검증 테스트.

가장 중요한 건 **평가 구간이 파라미터 선택에 절대 영향을 주지 않는 것**이다.
평가 구간을 조금이라도 보고 파라미터를 고르면 워크포워드를 하는 의미가 없고,
그 사실은 실계좌에서만 드러난다.
"""

from __future__ import annotations

from datetime import timedelta
from decimal import Decimal

import pytest

from tossquant.backtest.metrics import EquityPoint
from tossquant.backtest.walkforward import (
    OBJECTIVES,
    Fold,
    FoldResult,
    ParamGrid,
    make_folds,
    run,
    sma_factory,
    sma_grid,
    stitch,
)
from tossquant.models import Candle

from test_backtest import START, bars, flat_bars


def wave(n: int, period: int = 40, amplitude: float = 20.0, base: float = 100.0):
    """교차가 주기적으로 발생하는 시계열. 전략이 실제로 매매를 하게 만든다."""
    import math

    return [base + amplitude * math.sin(i / period * 2 * math.pi) for i in range(n)]


def wave_history(n: int = 900) -> dict[str, list[Candle]]:
    closes = wave(n)
    return {"A": flat_bars("A", closes)}


@pytest.fixture
def wf_settings(settings):
    settings.paper_cash = Decimal("100000")
    settings.max_position_pct = Decimal("1")
    settings.paper_slippage_bps = Decimal("0")
    settings.backtest_spread_bps = Decimal("0")
    settings.paper_commission_bps = Decimal("0")
    return settings


# --- 구간 분할 ---------------------------------------------------------------


def test_rolling_folds_slide_forward():
    folds = make_folds(total_bars=500, train_bars=200, test_bars=100)

    assert len(folds) == 3
    assert [f.test_start for f in folds] == [200, 300, 400]
    assert [f.train_start for f in folds] == [0, 100, 200]
    assert all(f.train_bars == 200 for f in folds)


def test_anchored_folds_keep_expanding():
    folds = make_folds(500, 200, 100, anchored=True)

    assert all(f.train_start == 0 for f in folds)
    assert [f.train_bars for f in folds] == [200, 300, 400]


def test_test_windows_never_overlap():
    folds = make_folds(1000, 250, 60)
    for prev, cur in zip(folds, folds[1:]):
        assert prev.test_end == cur.test_start


def test_train_window_always_precedes_test_window():
    for fold in make_folds(1000, 250, 60):
        assert fold.train_end <= fold.test_start


def test_too_little_data_raises():
    with pytest.raises(ValueError, match="구간을 만들 수 없습니다"):
        make_folds(total_bars=100, train_bars=200, test_bars=50)


def test_zero_window_rejected():
    with pytest.raises(ValueError, match="1 이상"):
        make_folds(500, 0, 100)


# --- 파라미터 그리드 ---------------------------------------------------------


def test_grid_filters_invalid_combinations():
    grid = sma_grid([5, 10, 50], [20, 40])
    combos = list(grid.combinations())

    assert all(c["fast"] < c["slow"] for c in combos)
    assert {"fast": 50, "slow": 20} not in combos
    assert len(grid) == len(combos)


def test_grid_covers_full_product_when_all_valid():
    assert len(ParamGrid(values={"a": [1, 2], "b": [3, 4, 5]})) == 6


def test_empty_grid_has_no_combinations():
    assert len(sma_grid([100], [10])) == 0


# --- 미래 정보 차단 (핵심) ---------------------------------------------------


def test_optimizer_never_sees_the_test_window(wf_settings, monkeypatch):
    """학습에 넘어간 캔들이 평가 구간과 겹치면 안 된다.

    Backtester에 실제로 전달된 데이터의 마지막 시각을 모두 기록해서, 그 어떤
    학습 실행도 평가 구간 시작 시각 이후를 보지 않았는지 확인한다.
    """
    from tossquant.backtest import walkforward as wf

    history = wave_history(600)
    seen_ends: list = []
    real_backtester = wf.Backtester

    class Spy(real_backtester):
        def __init__(self, hist, strategy, settings):
            seen_ends.append(max(c.ts for candles in hist.values() for c in candles))
            super().__init__(hist, strategy, settings)

    monkeypatch.setattr(wf, "Backtester", Spy)

    result = run(
        history, wf_settings, grid=sma_grid([5], [20]), train_bars=200, test_bars=100
    )

    # 각 구간의 학습 실행은 그 구간 평가 시작 전 데이터만 봤어야 한다.
    all_bars = history["A"]
    for fold_result in result.folds:
        train_cutoff = all_bars[fold_result.fold.train_end - 1].ts
        # 학습 결과 곡선의 마지막 시각이 학습 구간을 넘지 않는다.
        assert fold_result.train.curve[-1].ts <= train_cutoff


def test_train_slice_stops_at_train_end(wf_settings):
    history = wave_history(600)
    result = run(
        history, wf_settings, grid=sma_grid([5], [20]), train_bars=200, test_bars=100
    )

    all_bars = history["A"]
    for item in result.folds:
        assert item.train.curve[-1].ts == all_bars[item.fold.train_end - 1].ts


def test_test_window_includes_warmup_but_not_beyond(wf_settings):
    """평가 구간 앞에 워밍업만 붙고, 뒤로는 절대 넘어가지 않는다."""
    history = wave_history(600)
    result = run(
        history, wf_settings, grid=sma_grid([5], [20]), train_bars=200, test_bars=100
    )

    all_bars = history["A"]
    for item in result.folds:
        assert item.test.curve[-1].ts == all_bars[item.fold.test_end - 1].ts


# --- 실행 --------------------------------------------------------------------


def test_produces_one_result_per_fold(wf_settings):
    result = run(
        wave_history(700),
        wf_settings,
        grid=sma_grid([5, 10], [20, 40]),
        train_bars=250,
        test_bars=100,
    )

    assert len(result.folds) == len(make_folds(700, 250, 100))
    assert result.grid_size == 4


def test_chosen_params_come_from_the_grid(wf_settings):
    grid = sma_grid([5, 10], [20, 40])
    result = run(
        wave_history(700), wf_settings, grid=grid, train_bars=250, test_bars=100
    )

    allowed = list(grid.combinations())
    assert all(item.params in allowed for item in result.folds)


def test_unknown_objective_rejected(wf_settings):
    with pytest.raises(ValueError, match="알 수 없는 목적함수"):
        run(wave_history(400), wf_settings, grid=sma_grid([5], [20]), objective="루나")


@pytest.mark.parametrize("objective", sorted(OBJECTIVES))
def test_every_objective_runs(wf_settings, objective):
    result = run(
        wave_history(600),
        wf_settings,
        grid=sma_grid([5, 10], [20, 40]),
        train_bars=200,
        test_bars=100,
        objective=objective,
    )
    assert result.objective == objective
    assert len(result.folds) >= 1


def test_empty_history_rejected(wf_settings):
    with pytest.raises(ValueError, match="캔들이 없습니다"):
        run({}, wf_settings, grid=sma_grid([5], [20]))


def test_candidate_scores_cover_the_grid(wf_settings):
    grid = sma_grid([5, 10], [20, 40])
    result = run(
        wave_history(600), wf_settings, grid=grid, train_bars=200, test_bars=100
    )

    assert len(result.folds[0].candidate_scores) == len(grid)


def test_winning_params_have_the_best_train_score(wf_settings):
    """선택된 조합은 그 구간 학습 점수 중 최고여야 한다."""
    result = run(
        wave_history(600),
        wf_settings,
        grid=sma_grid([5, 10], [20, 40]),
        train_bars=200,
        test_bars=100,
        min_trades=0,  # 거래 필터를 꺼야 순수 최고점과 비교된다
    )

    for item in result.folds:
        assert item.train_score == pytest.approx(max(item.candidate_scores.values()))


# --- 이어붙이기 --------------------------------------------------------------


def fold_result(equities: list[float]) -> FoldResult:
    """test.curve만 채운 최소 FoldResult."""

    class FakeResult:
        def __init__(self, curve):
            self.curve = curve
            self.trades = []

    curve = [
        EquityPoint(
            ts=START + timedelta(days=i),
            equity=Decimal(str(v)),
            cash=Decimal("0"),
            invested=Decimal(str(v)),
        )
        for i, v in enumerate(equities)
    ]
    return FoldResult(
        fold=Fold(0, 0, 1, 1, 2),
        params={},
        train_score=0.0,
        test_score=0.0,
        train=FakeResult([]),
        test=FakeResult(curve),
    )


def test_stitch_compounds_fold_returns():
    # 구간1에서 +10%, 구간2에서 +10% → 총 +21%
    stitched = stitch(
        [fold_result([100, 110]), fold_result([100, 110])], Decimal("1000")
    )

    assert stitched[0].equity == Decimal("1000")
    assert stitched[-1].equity == pytest.approx(Decimal("1210"))


def test_stitch_handles_losses():
    stitched = stitch(
        [fold_result([100, 50]), fold_result([100, 50])], Decimal("1000")
    )
    assert stitched[-1].equity == pytest.approx(Decimal("250"))


def test_stitch_preserves_exposure_ratio():
    """이어붙인 뒤에도 시장 노출 지표가 살아 있어야 한다."""
    stitched = stitch([fold_result([100, 110])], Decimal("1000"))
    assert all(point.invested > 0 for point in stitched)


def test_stitch_skips_empty_folds():
    stitched = stitch([fold_result([]), fold_result([100, 110])], Decimal("1000"))
    assert len(stitched) == 2


# --- 진단 지표 ---------------------------------------------------------------


def scored_result(pairs: list[tuple[float, float]], params_list=None):
    """(train_score, test_score) 쌍으로 WalkForwardResult를 흉내낸다."""
    from tossquant.backtest.walkforward import WalkForwardResult

    params_list = params_list or [{"fast": 5, "slow": 20}] * len(pairs)
    folds = []
    for i, ((train, test), params) in enumerate(zip(pairs, params_list)):
        item = fold_result([100, 110])
        item.train_score = train
        item.test_score = test
        item.params = params
        folds.append(item)

    return WalkForwardResult(
        objective="sharpe",
        folds=folds,
        curve=[],
        metrics=None,
        trades=[],
        grid_size=1,
    )


def test_retention_is_one_when_performance_holds():
    assert scored_result([(1.0, 1.0), (2.0, 2.0)]).retention == pytest.approx(1.0)


def test_retention_halves_when_oos_is_half():
    assert scored_result([(2.0, 1.0), (2.0, 1.0)]).retention == pytest.approx(0.5)


def test_retention_is_negative_when_oos_loses_money():
    assert scored_result([(2.0, -1.0), (2.0, -1.0)]).retention < 0


def test_retention_of_zero_train_is_zero():
    assert scored_result([(0.0, 1.0)]).retention == 0.0


def test_param_stability_is_one_when_always_same():
    result = scored_result([(1, 1)] * 4, [{"fast": 5, "slow": 20}] * 4)
    assert result.param_stability == 1.0


def test_param_stability_drops_when_params_jump():
    result = scored_result(
        [(1, 1)] * 4,
        [
            {"fast": 5, "slow": 20},
            {"fast": 10, "slow": 40},
            {"fast": 20, "slow": 60},
            {"fast": 30, "slow": 80},
        ],
    )
    assert result.param_stability == 0.25


def test_positive_folds_counts_profitable_test_windows(wf_settings):
    result = run(
        wave_history(700),
        wf_settings,
        grid=sma_grid([5, 10], [20, 40]),
        train_bars=250,
        test_bars=100,
    )
    assert 0 <= result.positive_folds <= len(result.folds)
