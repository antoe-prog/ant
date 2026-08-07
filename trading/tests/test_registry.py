"""전략 레지스트리 테스트.

전략을 추가할 때 세 군데(BUILDERS/FACTORIES/GRIDS) 중 하나만 빠뜨리기 쉽다.
그러면 백테스트는 되는데 워크포워드에서만 터지는 식으로 늦게 드러난다.
"""

from __future__ import annotations

import pytest

from tossquant.config import Settings
from tossquant.strategy import registry
from tossquant.strategy.base import Strategy


@pytest.fixture
def settings() -> Settings:
    return Settings(_env_file=None, client_id="x", client_secret="y")


@pytest.mark.parametrize("name", registry.NAMES)
def test_every_strategy_builds_from_settings(name, settings):
    assert isinstance(registry.build(name, settings), Strategy)


@pytest.mark.parametrize("name", registry.NAMES)
def test_every_strategy_has_a_factory_and_grid(name):
    """세 딕셔너리가 어긋나면 워크포워드에서만 터진다."""
    assert name in registry.FACTORIES
    assert name in registry.GRIDS


@pytest.mark.parametrize("name", registry.NAMES)
def test_default_grid_is_not_empty(name):
    assert len(registry.default_grid(name)) > 0


@pytest.mark.parametrize("name", registry.NAMES)
def test_factory_accepts_every_combination_in_its_grid(name):
    """기본 격자의 모든 조합이 실제로 만들어져야 한다."""
    factory = registry.factory(name)
    for params in registry.default_grid(name).combinations():
        assert isinstance(factory(params), Strategy)


@pytest.mark.parametrize("name", registry.NAMES)
def test_warmup_is_positive(name, settings):
    assert registry.build(name, settings).warmup_bars > 0


@pytest.mark.parametrize("name", registry.NAMES)
def test_strategy_reports_its_own_name(name, settings):
    assert registry.build(name, settings).name == name


def test_unknown_strategy_is_rejected_everywhere(settings):
    for call in (
        lambda: registry.build("없는전략", settings),
        lambda: registry.factory("없는전략"),
        lambda: registry.default_grid("없는전략"),
    ):
        with pytest.raises(ValueError, match="알 수 없는 전략"):
            call()


def test_error_message_lists_available_strategies(settings):
    with pytest.raises(ValueError) as exc:
        registry.build("없는전략", settings)
    for name in registry.NAMES:
        assert name in str(exc.value)


def test_settings_select_the_strategy(settings):
    settings.strategy = "breakout"
    assert registry.build(settings.strategy, settings).name == "breakout"


def test_sma_cross_is_the_default(settings):
    assert settings.strategy == "sma_cross"
