"""보호 청산 테스트.

여기가 무너지면 급락장에서 빠져나올 방법이 없다. 각 규칙이 발동하는 조건과
**발동하지 않는** 조건을 둘 다 못 박는다 — 과민한 손절은 전략을 망가뜨린다.
"""

from __future__ import annotations

from datetime import datetime, timedelta
from decimal import Decimal

import pytest

from tossquant.calendar_us import NY
from tossquant.models import Position, SignalAction
from tossquant.stops import StopManager
from tossquant.store import Store

NOW = datetime(2026, 8, 6, 10, 0, tzinfo=NY)


def manager(
    store,
    *,
    stop_loss="0",
    trailing="0",
    take_profit="0",
    max_holding=0,
    cooldown=3,
) -> StopManager:
    return StopManager(
        store,
        stop_loss_pct=Decimal(stop_loss),
        trailing_stop_pct=Decimal(trailing),
        take_profit_pct=Decimal(take_profit),
        max_holding_days=max_holding,
        cooldown_days=cooldown,
    )


def held(symbol="AAPL", quantity=10, avg="100") -> dict[str, Position]:
    return {symbol: Position(symbol, quantity, Decimal(avg))}


def mark(price: str, symbol="AAPL") -> dict[str, Decimal]:
    return {symbol: Decimal(price)}


# --- 고정 손절 ---------------------------------------------------------------


def test_stop_loss_fires_below_threshold(store):
    stops = manager(store, stop_loss="0.08")

    signals = stops.exits(held(), mark("91"), NOW)

    assert len(signals) == 1
    assert signals[0].action is SignalAction.EXIT
    assert signals[0].protective is True
    assert "손절" in signals[0].reason


def test_stop_loss_silent_above_threshold(store):
    stops = manager(store, stop_loss="0.08")
    assert stops.exits(held(), mark("93"), NOW) == []


def test_stop_loss_fires_exactly_at_threshold(store):
    stops = manager(store, stop_loss="0.10")
    assert len(stops.exits(held(), mark("90"), NOW)) == 1


def test_stop_loss_uses_average_price_not_market(store):
    """물타기로 평단이 내려갔으면 손절선도 같이 내려가야 한다."""
    stops = manager(store, stop_loss="0.10")
    assert stops.exits(held(avg="50"), mark("46"), NOW) == []
    assert len(stops.exits(held(avg="50"), mark("44"), NOW)) == 1


# --- 트레일링 스톱 -----------------------------------------------------------


def test_trailing_stop_tracks_high_water_not_entry(store):
    stops = manager(store, trailing="0.10")

    stops.exits(held(), mark("150"), NOW)  # 고점 150 기록
    signals = stops.exits(held(), mark("134"), NOW)

    assert len(signals) == 1
    assert "트레일링" in signals[0].reason
    # 진입가 100 대비로는 +34%라 고정 손절로는 절대 안 걸리는 지점이다.


def test_trailing_stop_silent_within_band(store):
    stops = manager(store, trailing="0.10")

    stops.exits(held(), mark("150"), NOW)
    assert stops.exits(held(), mark("136"), NOW) == []


def test_high_water_only_ratchets_up(store):
    stops = manager(store, trailing="0.20")

    stops.exits(held(), mark("200"), NOW)
    stops.exits(held(), mark("170"), NOW)  # 고점은 200 유지
    signals = stops.exits(held(), mark("159"), NOW)

    assert len(signals) == 1  # 200 * 0.8 = 160 아래


def test_high_water_starts_at_entry_for_underwater_position(store):
    stops = manager(store, trailing="0.10")
    # 진입 직후 바로 하락한 경우, 고점은 진입가로 잡혀야 한다.
    assert len(stops.exits(held(avg="100"), mark("89"), NOW)) == 1


def test_high_water_survives_restart(store, tmp_path):
    path = tmp_path / "stops.db"
    store_a = Store(path)
    manager(store_a, trailing="0.10").exits(held(), mark("150"), NOW)
    store_a.close()

    store_b = Store(path)
    signals = manager(store_b, trailing="0.10").exits(held(), mark("134"), NOW)
    store_b.close()

    assert len(signals) == 1


# --- 익절 / 최대 보유 --------------------------------------------------------


def test_take_profit_fires(store):
    stops = manager(store, take_profit="0.20")
    signals = stops.exits(held(), mark("121"), NOW)
    assert len(signals) == 1
    assert "익절" in signals[0].reason


def test_max_holding_days(store):
    stops = manager(store, max_holding=5)
    stops.exits(held(), mark("100"), NOW)  # 진입 시각 기록

    assert stops.exits(held(), mark("100"), NOW + timedelta(days=4)) == []
    late = stops.exits(held(), mark("100"), NOW + timedelta(days=5))
    assert len(late) == 1
    assert "최대 보유" in late[0].reason


# --- 우선순위 / 비활성 -------------------------------------------------------


def test_stop_loss_wins_over_take_profit(store):
    """둘 다 설정돼 있어도 손실 방어가 먼저다."""
    stops = manager(store, stop_loss="0.05", take_profit="0.05")
    signals = stops.exits(held(), mark("94"), NOW)
    assert "손절" in signals[0].reason


def test_all_zero_means_disabled(store):
    stops = manager(store)
    assert stops.enabled is False
    assert stops.exits(held(), mark("1"), NOW) == []


def test_no_exit_without_position(store):
    stops = manager(store, stop_loss="0.01")
    assert stops.exits({}, mark("1"), NOW) == []


def test_missing_mark_is_skipped(store):
    stops = manager(store, stop_loss="0.01")
    assert stops.exits(held(), {}, NOW) == []


def test_zero_price_is_skipped(store):
    stops = manager(store, stop_loss="0.01")
    assert stops.exits(held(), mark("0"), NOW) == []


# --- 쿨다운 ------------------------------------------------------------------


def test_protective_exit_blocks_reentry(store):
    stops = manager(store, stop_loss="0.08", cooldown=3)
    stops.exits(held(), mark("91"), NOW)

    stops.on_exit("AAPL", NOW, protective=True)

    assert stops.is_blocked("AAPL", NOW + timedelta(days=1)) is True
    assert stops.is_blocked("AAPL", NOW + timedelta(days=4)) is False


def test_strategy_exit_does_not_block(store):
    stops = manager(store, stop_loss="0.08", cooldown=3)
    stops.exits(held(), mark("100"), NOW)

    stops.on_exit("AAPL", NOW, protective=False)

    assert stops.is_blocked("AAPL", NOW + timedelta(days=1)) is False


def test_zero_cooldown_never_blocks(store):
    stops = manager(store, stop_loss="0.08", cooldown=0)
    stops.on_exit("AAPL", NOW, protective=True)
    assert stops.is_blocked("AAPL", NOW) is False


def test_unknown_symbol_is_not_blocked(store):
    assert manager(store).is_blocked("NOPE", NOW) is False


def test_cooldown_row_is_cleaned_up_after_expiry(store):
    stops = manager(store, stop_loss="0.08", cooldown=2)
    stops.on_exit("AAPL", NOW, protective=True)
    assert store.load_tracking("AAPL") is not None

    stops.exits({}, {}, NOW + timedelta(days=3))

    assert store.load_tracking("AAPL") is None


# --- 추적 상태 정리 ----------------------------------------------------------


def test_tracking_cleared_when_position_disappears(store):
    stops = manager(store, trailing="0.10")
    stops.exits(held(), mark("150"), NOW)
    assert store.load_tracking("AAPL") is not None

    stops.exits({}, {}, NOW)  # 외부에서 매도된 상황

    assert store.load_tracking("AAPL") is None


def test_high_water_resets_on_reentry(store):
    stops = manager(store, trailing="0.10")
    stops.exits(held(), mark("150"), NOW)
    stops.exits({}, {}, NOW)  # 청산

    # 재진입: 고점이 150에서 이어지면 안 된다.
    assert stops.exits(held(avg="100"), mark("105"), NOW) == []
