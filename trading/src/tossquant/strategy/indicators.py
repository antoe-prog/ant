"""지표 계산.

전략마다 따로 구현하면 미묘하게 어긋난다 — 특히 '오늘 봉을 포함하느냐'가
전략별로 다르면 백테스트 결과를 비교할 수 없게 된다. 여기 한 곳에 모으고
포함 여부를 인자로 명시한다.

모두 Decimal로 계산한다. 가격이 Decimal이라 중간에 float로 내려가면 반올림
오차가 체결가·수량에 그대로 흘러든다.
"""

from __future__ import annotations

from decimal import Decimal


def sma(values: list[Decimal], window: int) -> Decimal | None:
    """마지막 window개의 단순 이동평균. 데이터가 모자라면 None."""
    if window <= 0 or len(values) < window:
        return None
    return sum(values[-window:]) / window


def stdev(values: list[Decimal], window: int) -> Decimal | None:
    """표본 표준편차 (n-1). 데이터가 모자라면 None."""
    if window <= 1 or len(values) < window:
        return None
    sample = values[-window:]
    mean = sum(sample) / window
    variance = sum((v - mean) ** 2 for v in sample) / (window - 1)
    return variance.sqrt()


def zscore(values: list[Decimal], window: int) -> Decimal | None:
    """현재 값이 이동평균에서 몇 표준편차 떨어져 있는지.

    변동성이 0이면(가격이 완전히 붙어 있으면) 정의되지 않으므로 None.
    """
    mean = sma(values, window)
    deviation = stdev(values, window)
    if mean is None or deviation is None or deviation == 0:
        return None
    return (values[-1] - mean) / deviation


def roc(values: list[Decimal], lookback: int) -> Decimal | None:
    """lookback 봉 전 대비 수익률. 0.05 = +5%."""
    if lookback <= 0 or len(values) < lookback + 1:
        return None
    past = values[-(lookback + 1)]
    if past <= 0:
        return None
    return values[-1] / past - 1


def highest(values: list[Decimal], window: int, *, exclude_last: bool = True) -> Decimal | None:
    """최근 window개의 최고값.

    exclude_last=True면 현재 봉을 빼고 본다. 돌파 전략에서 이게 핵심이다 —
    현재 봉을 포함하면 '오늘 고가가 오늘 고가보다 높은가'를 묻는 셈이라
    돌파가 절대 성립하지 않는다.
    """
    series = values[:-1] if exclude_last else values
    if window <= 0 or len(series) < window:
        return None
    return max(series[-window:])


def lowest(values: list[Decimal], window: int, *, exclude_last: bool = True) -> Decimal | None:
    """최근 window개의 최저값. highest와 같은 이유로 현재 봉을 기본 제외한다."""
    series = values[:-1] if exclude_last else values
    if window <= 0 or len(series) < window:
        return None
    return min(series[-window:])
