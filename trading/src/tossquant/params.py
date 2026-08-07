"""파라미터 격자.

워크포워드와 전략 레지스트리 양쪽이 쓴다. 어느 한쪽에 두면 순환 임포트가
생기므로 아무것도 의존하지 않는 자리에 둔다.
"""

from __future__ import annotations

from collections.abc import Callable, Iterator
from dataclasses import dataclass
from itertools import product
from typing import Any


@dataclass(frozen=True)
class ParamGrid:
    """탐색할 파라미터 조합.

    `valid`로 말이 안 되는 조합(단기선 >= 장기선 등)을 걸러낸다.
    """

    values: dict[str, list[Any]]
    valid: Callable[[dict[str, Any]], bool] | None = None

    def combinations(self) -> Iterator[dict[str, Any]]:
        keys = list(self.values)
        for combo in product(*(self.values[k] for k in keys)):
            params = dict(zip(keys, combo))
            if self.valid is None or self.valid(params):
                yield params

    def __len__(self) -> int:
        return sum(1 for _ in self.combinations())
