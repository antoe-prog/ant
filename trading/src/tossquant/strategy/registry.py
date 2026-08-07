"""전략 레지스트리.

이름 하나로 전략을 고를 수 있게 모아둔다. 이게 없으면 전략을 추가할 때마다
cli.py의 여러 곳을 손대야 하고, 워크포워드가 탐색할 파라미터 격자도 전략마다
하드코딩된다.

전략을 추가하려면 여기 세 곳만 채우면 된다: BUILDERS, FACTORIES, GRIDS.
"""

from __future__ import annotations

from collections.abc import Callable
from decimal import Decimal
from typing import Any

from ..config import Settings
from ..params import ParamGrid
from .base import Strategy
from .breakout import BreakoutStrategy
from .mean_reversion import MeanReversionStrategy
from .momentum import MomentumStrategy
from .sma_cross import SmaCrossStrategy

# --- 설정에서 만들기 ---------------------------------------------------------

BUILDERS: dict[str, Callable[[Settings], Strategy]] = {
    "sma_cross": lambda s: SmaCrossStrategy(s.sma_fast, s.sma_slow),
    "momentum": lambda s: MomentumStrategy(
        s.momentum_lookback, s.momentum_entry, s.momentum_exit
    ),
    "breakout": lambda s: BreakoutStrategy(s.breakout_entry_bars, s.breakout_exit_bars),
    "mean_reversion": lambda s: MeanReversionStrategy(
        s.meanrev_lookback, s.meanrev_entry_z, s.meanrev_exit_z
    ),
}

# --- 파라미터 딕셔너리에서 만들기 (워크포워드용) ------------------------------

FACTORIES: dict[str, Callable[[dict[str, Any]], Strategy]] = {
    "sma_cross": lambda p: SmaCrossStrategy(p["fast"], p["slow"]),
    "momentum": lambda p: MomentumStrategy(
        p["lookback"], Decimal(str(p["entry"])), Decimal(str(p.get("exit", 0)))
    ),
    "breakout": lambda p: BreakoutStrategy(p["entry_bars"], p["exit_bars"]),
    "mean_reversion": lambda p: MeanReversionStrategy(
        p["lookback"], Decimal(str(p["entry_z"])), Decimal(str(p.get("exit_z", 0)))
    ),
}

# --- 워크포워드 기본 탐색 격자 -----------------------------------------------
#
# 넓게 잡을수록 과최적화가 쉬워진다. 각 전략의 통상 범위를 벗어나지 않게
# 의도적으로 좁게 뒀다.

GRIDS: dict[str, Callable[[], ParamGrid]] = {
    "sma_cross": lambda: ParamGrid(
        values={"fast": [5, 10, 20, 30], "slow": [40, 60, 100, 150]},
        valid=lambda p: p["fast"] < p["slow"],
    ),
    "momentum": lambda: ParamGrid(
        values={"lookback": [20, 60, 120, 250], "entry": [0.02, 0.05, 0.10]},
    ),
    "breakout": lambda: ParamGrid(
        values={"entry_bars": [10, 20, 40, 55], "exit_bars": [5, 10, 20]},
        valid=lambda p: p["exit_bars"] <= p["entry_bars"],
    ),
    "mean_reversion": lambda: ParamGrid(
        values={"lookback": [10, 20, 40], "entry_z": [-1.5, -2.0, -2.5]},
    ),
}

NAMES = tuple(BUILDERS)


def _check(name: str) -> None:
    if name not in BUILDERS:
        raise ValueError(
            f"알 수 없는 전략 '{name}' (가능: {', '.join(NAMES)})"
        )


def build(name: str, settings: Settings) -> Strategy:
    """설정값으로 전략 인스턴스를 만든다."""
    _check(name)
    return BUILDERS[name](settings)


def factory(name: str) -> Callable[[dict[str, Any]], Strategy]:
    """파라미터 딕셔너리를 받는 생성기. 워크포워드가 격자를 돌 때 쓴다."""
    _check(name)
    return FACTORIES[name]


def default_grid(name: str) -> ParamGrid:
    _check(name)
    return GRIDS[name]()
