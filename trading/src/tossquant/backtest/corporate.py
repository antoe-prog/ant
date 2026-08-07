"""가격 불연속 감지 — 액면분할·분사 탐지.

미조정 데이터에는 실제로 일어나지 않은 급락이 섞여 있다. EBAY의 PayPal 분사는
하루 -57%로 찍히고, 7:1 액면분할은 -86%로 찍힌다. 이걸 그대로 백테스트에 넣으면:

- **손절이 발동해** 전략이 '폭락을 피한' 것처럼 보인다
- **바이앤홀드는** 회복하지 못할 손실을 떠안는다

즉 전략이 실제보다 좋아 보이고 벤치마크는 나빠 보인다. 실측에서 S&P 500
468종목 중 13종목이 오염됐고, 그중 8종목이 '전략 승'으로 잘못 집계됐다.

## 이 모듈이 주장하는 것과 하지 않는 것

**주장한다:** 하루 만에 가격이 크게 점프했다. 이건 데이터에서 확실히 보인다.

**주장하지 않는다:** 그게 분할인지 진짜 폭락인지. 외부 코퍼레이트 액션
데이터 없이는 확정할 수 없다. 2008년 리먼은 진짜로 하루에 -90% 갔다.

그래서 기본 동작은 **경고**이고, 자동 조정은 분할로 볼 근거가 두 개 이상일
때만(깔끔한 분할 비율 + 거래량 반대 방향 점프) 적용한다.
"""

from __future__ import annotations

import logging
import math
from dataclasses import dataclass, replace
from datetime import datetime
from decimal import Decimal

from ..models import Candle

log = logging.getLogger(__name__)

# 흔한 액면분할의 가격 비율 (분할 후 가격 / 분할 전 가격).
# 2:1 분할이면 가격은 절반이 되므로 0.5. 병합(reverse split)은 1보다 크다.
SPLIT_RATIOS: tuple[Decimal, ...] = (
    Decimal("0.5"),      # 2:1
    Decimal("1") / 3,    # 3:1
    Decimal("0.25"),     # 4:1
    Decimal("0.2"),      # 5:1
    Decimal("1") / 7,    # 7:1
    Decimal("0.1"),      # 10:1
    Decimal("2") / 3,    # 3:2
    Decimal("0.75"),     # 4:3
    Decimal("1.5"),      # 2:3 병합
    Decimal("2"),        # 1:2 병합
    Decimal("3"),
    Decimal("5"),
    Decimal("10"),
)

# 분할 비율로 인정할 오차. 분할 자체는 정확하지만 그날 주가도 함께 움직인다.
SPLIT_TOLERANCE = Decimal("0.03")

# 거래량 확인: 2:1 분할이면 주식 수가 2배가 되니 거래량도 대략 그만큼 늘어난다.
# 노이즈가 커서 밴드는 넓게 두되, **거래량이 실제로 움직였을 것**을 요구한다.
# 밴드만 쓰면 2:1 분할의 허용 범위가 [1배, 4배]가 되어 '변화 없음'까지 통과한다.
VOLUME_CONFIRM_BAND = (Decimal("0.5"), Decimal("2"))

# 지속성 확인에 볼 봉 수. 분할은 새 가격대가 유지되지만, 데이터 오류는 다음날
# 원래대로 돌아온다. 실제로 LNT는 -49% 다음날 +101%로 되돌아왔다 — 분할이
# 아니라 하루짜리 잘못된 값이었고, 비율만 보면 2:1 분할로 오인된다.
PERSISTENCE_BARS = 5
PERSISTENCE_TOLERANCE = Decimal("0.15")

# 하루짜리 잘못된 값은 점프를 **두 개** 만든다: 내려갔다가 다음날 되돌아온다.
# 되돌아오는 쪽은 지속성 검사를 통과해서 분할과 구분이 안 되므로, 인접한 두
# 점프의 비율을 곱해 1에 가까우면 둘 다 오류로 본다.
# 실제로 LNT는 -49.4% 다음날 +101%, MRO는 +34.5% 다음날 -25.1%였다.
ROUNDTRIP_TOLERANCE = Decimal("0.08")


@dataclass(frozen=True)
class PriceBreak:
    """하루 만에 임계 이상 점프한 지점."""

    index: int
    ts: datetime
    prev_close: Decimal
    close: Decimal
    ratio: Decimal            # close / prev_close
    split_ratio: Decimal | None  # 깔끔한 분할 비율로 해석되면 그 값
    volume_confirms: bool     # 거래량이 분할과 맞는 방향·크기로 움직였는지
    persists: bool            # 새 가격대가 이후에도 유지되는지
    round_trip: bool = False  # 인접한 반대 점프와 짝을 이루는지 (하루짜리 오류)

    @property
    def change_pct(self) -> Decimal:
        return (self.ratio - 1) * 100

    @property
    def looks_like_split(self) -> bool:
        """분할로 볼 근거가 셋 다 있는가.

        비율만으로는 부족하다. 진짜 폭락이 우연히 -50%일 수 있고, 하루짜리
        데이터 오류도 -50%로 찍힌다. 셋을 모두 요구한다:
        깔끔한 분할 비율 + 거래량이 반대로 점프 + 새 가격대가 유지됨.
        """
        return (
            self.split_ratio is not None
            and self.volume_confirms
            and self.persists
            and not self.round_trip
        )

    @property
    def distorts_backtest(self) -> bool:
        """백테스트를 왜곡할 가능성이 높은 불연속인가.

        원인 불명 **하락** 갭만 해당한다. 분사는 항상 아래로 찍히고, 그 가짜
        급락에서 손절이 발동해 전략이 폭락을 피한 것처럼 보인다.

        위로 튄 것은 거의 다 진짜 뉴스다 — 실적 서프라이즈, 임상 성공, 피인수.
        VRTX +62%(임상), FB +30%(실적), NVDA +30%(실적)가 전부 실제 움직임이라
        오염으로 묶으면 고변동 승자를 골라 빼는 새로운 편향이 생긴다.
        """
        return (
            not self.looks_like_split
            and not self.looks_like_bad_bar
            and self.ratio < 1
        )

    @property
    def looks_like_bad_bar(self) -> bool:
        """하루짜리 데이터 오류로 보이는가.

        되돌아오거나(지속성 실패), 인접한 반대 점프와 짝을 이루면 그렇다.
        """
        return self.round_trip or not self.persists

    def describe(self) -> str:
        if self.looks_like_split:
            kind = f"분할 추정 {self.split_ratio:.4f}"
        elif self.round_trip:
            kind = "데이터 오류 의심 (인접 봉과 왕복)"
        elif not self.persists:
            kind = "데이터 오류 의심 (곧 원래 가격대로 복귀)"
        elif self.split_ratio:
            kind = "분할 비율 일치(거래량 불일치)"
        else:
            kind = "원인 불명"
        return (
            f"{self.ts:%Y-%m-%d} {self.prev_close:.2f} → {self.close:.2f} "
            f"({self.change_pct:+.1f}%) — {kind}"
        )


def _match_split_ratio(ratio: Decimal) -> Decimal | None:
    for candidate in SPLIT_RATIOS:
        if abs(ratio - candidate) <= candidate * SPLIT_TOLERANCE:
            return candidate
    return None


def _volume_confirms(previous: Candle, current: Candle, ratio: Decimal) -> bool:
    """가격이 1/n이 되면 거래량은 대략 n배가 된다.

    밴드 안에 드는 것만으로는 부족하다. 관측된 거래량 비가 '변화 없음(1배)'보다
    '기대치'에 더 가까워야 한다 — 그래야 거래량이 실제로 분할 방향으로 움직였다고
    말할 수 있다.
    """
    if previous.volume <= 0 or current.volume <= 0 or ratio <= 0:
        return False

    expected = 1 / ratio
    observed = Decimal(current.volume) / Decimal(previous.volume)

    low, high = VOLUME_CONFIRM_BAND
    if not (expected * low <= observed <= expected * high):
        return False

    # 로그 거리로 비교해야 배수 관계가 대칭으로 다뤄진다.
    to_expected = abs(math.log(float(observed / expected)))
    to_unchanged = abs(math.log(float(observed)))
    return to_expected < to_unchanged


def _persists(candles: list[Candle], index: int, ratio: Decimal) -> bool:
    """점프 이후 새 가격대가 유지되는가.

    분할이면 유지되고, 하루짜리 데이터 오류면 다음날 되돌아온다. 뒤이은 봉이
    없으면(시리즈 끝) 판단할 수 없으므로 유지된 것으로 본다 — 마지막 봉 하나
    때문에 전체를 조정 대상에서 빼는 게 더 나쁘다.
    """
    following = candles[index + 1 : index + 1 + PERSISTENCE_BARS]
    if not following:
        return True
    base = candles[index].close
    if base <= 0:
        return False
    # 이후 봉들의 중앙값이 새 가격대 근처에 머무는지 본다.
    closes = sorted(c.close for c in following)
    median = closes[len(closes) // 2]
    return abs(median / base - 1) <= PERSISTENCE_TOLERANCE


def detect(
    candles: list[Candle], threshold: Decimal = Decimal("0.25")
) -> list[PriceBreak]:
    """전일 종가 대비 threshold 이상 변한 지점을 찾는다.

    기본 25%는 개별 종목의 실적 쇼크(-20% 수준)는 통과시키고 분할·분사만
    걸리도록 잡은 값이다. 낮추면 진짜 급락까지 잡힌다.
    """
    breaks: list[PriceBreak] = []
    for index, (previous, current) in enumerate(zip(candles, candles[1:]), start=1):
        if previous.close <= 0:
            continue
        ratio = current.close / previous.close
        if abs(ratio - 1) < threshold:
            continue
        split_ratio = _match_split_ratio(ratio)
        breaks.append(
            PriceBreak(
                index=index,
                ts=current.ts,
                prev_close=previous.close,
                close=current.close,
                ratio=ratio,
                split_ratio=split_ratio,
                volume_confirms=(
                    _volume_confirms(previous, current, ratio)
                    if split_ratio is not None
                    else False
                ),
                persists=_persists(candles, index, ratio),
            )
        )
    return _mark_round_trips(breaks)


def _mark_round_trips(breaks: list[PriceBreak]) -> list[PriceBreak]:
    """인접한 두 점프가 서로를 되돌리면 둘 다 데이터 오류로 표시한다.

    비율을 곱해 1에 가까우면 왕복이다. 이걸 안 하면 되돌아오는 쪽이 지속성
    검사를 통과해 분할로 오인되고, 그대로 조정하면 원본보다 나빠진다.
    """
    flagged = set()
    for first, second in zip(breaks, breaks[1:]):
        if second.index - first.index > 2:
            continue
        if abs(first.ratio * second.ratio - 1) <= ROUNDTRIP_TOLERANCE:
            flagged.update({first.index, second.index})

    if not flagged:
        return breaks
    return [
        replace(b, round_trip=True) if b.index in flagged else b for b in breaks
    ]


def back_adjust(candles: list[Candle], breaks: list[PriceBreak]) -> list[Candle]:
    """분할로 판정된 지점의 **이전** 가격을 비율만큼 낮춰 연속으로 만든다.

    'adjusted close'가 하는 일과 같다. 최신 가격을 기준으로 두고 과거를 맞추므로
    현재 시점의 절대 가격은 바뀌지 않는다. 거래량은 반대로 곱한다.

    분할로 확신할 수 없는 불연속(분사 등)은 건드리지 않는다 — 분사 가치를
    모르면 올바른 조정 계수를 계산할 수 없고, 틀린 계수로 고치면 원본보다
    나빠진다.
    """
    splits = [b for b in breaks if b.looks_like_split]
    if not splits:
        return list(candles)

    # 각 봉에 적용할 누적 계수. 뒤에서 앞으로 오면서 곱해 나간다.
    factors = [Decimal(1)] * len(candles)
    cumulative = Decimal(1)
    for index in range(len(candles) - 1, -1, -1):
        factors[index] = cumulative
        for split in splits:
            if split.index == index:
                cumulative *= split.split_ratio

    adjusted: list[Candle] = []
    for candle, factor in zip(candles, factors):
        if factor == 1:
            adjusted.append(candle)
            continue
        adjusted.append(
            Candle(
                symbol=candle.symbol,
                ts=candle.ts,
                open=candle.open * factor,
                high=candle.high * factor,
                low=candle.low * factor,
                close=candle.close * factor,
                volume=int(Decimal(candle.volume) / factor) if factor > 0 else candle.volume,
            )
        )
    return adjusted
