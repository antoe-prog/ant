"""가격 불연속 감지와 검증된 액면분할 조정.

미조정 데이터에는 실제로 일어나지 않은 급락이 섞여 있다. EBAY의 PayPal 분사는
하루 -57%로 찍히고, 7:1 액면분할은 -86%로 찍힌다. 이걸 그대로 백테스트에 넣으면:

- **손절이 발동해** 전략이 '폭락을 피한' 것처럼 보인다
- **바이앤홀드는** 회복하지 못할 손실을 떠안는다

## 이 모듈이 주장하는 것과 하지 않는 것

**주장한다:** 하루 만에 가격이 크게 점프했다. 이건 데이터에서 확실히 보인다.

**주장하지 않는다:** 그게 분할인지 진짜 폭락인지. 외부 코퍼레이트 액션
데이터 없이는 확정할 수 없다. 2008년 리먼은 진짜로 하루에 -90% 갔다.

그래서 기본 동작은 **경고**다. 가격·거래량 휴리스틱은 분할 *후보*만 만들며,
자동 조정은 날짜·비율·출처가 기록된 검증 매니페스트의 분할만 적용한다.
"""

from __future__ import annotations

import csv
import io
import logging
import math
from dataclasses import dataclass, replace
from datetime import date, datetime, timedelta
from decimal import Decimal, DecimalException, ROUND_HALF_UP
from pathlib import Path

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
# 하루짜리 잘못된 값은 점프를 **두 개** 만든다: 내려갔다가 다음날 되돌아온다.
# 되돌아오는 쪽은 지속성 검사를 통과해서 분할과 구분이 안 되므로, 5봉 이내의
# 다음 큰 점프가 실제 시작 가격대로 돌아오면 둘 다 오류로 본다.
# 실제로 LNT는 -49.4% 다음날 +101%, MRO는 +34.5% 다음날 -25.1%였다.
ROUNDTRIP_TOLERANCE = Decimal("0.08")
ROUNDTRIP_MAX_BARS = PERSISTENCE_BARS
# 조정 뒤에도 감지 임계(25%) 이상의 경계가 남으면 잘못된 공시 계수나 날짜다.
# 같은 날 실제 시장 움직임일 가능성은 있지만 자동 성과 측정에서는 실패시켜
# 별도 확인을 요구하는 편이 조용히 수익률을 재작성하는 것보다 안전하다.
MAX_POST_ADJUSTMENT_GAP = Decimal("0.25")
MIN_ADJUSTMENT_FACTOR = Decimal("0.0001")
MAX_ADJUSTMENT_FACTOR = Decimal("10000")
SQLITE_INTEGER_MAX = 2**63 - 1
ADJUSTMENT_TYPES = frozenset({"split", "reverse_split", "same_class_stock_dividend"})
# 파일명이나 CLI의 interval 문자열만으로는 실제 봉 주기를 증명할 수 없다. 검증
# 조정은 날짜 경계를 사용하므로, 인접 간격의 80% 이상이 미국 일봉의 통상적인
# 주말·연휴 범위(1~4일)이고 행사 경계 자체도 그 범위일 때만 일봉으로 인정한다.
# 드문 장기 휴장은 전체 비율을 망치지 않지만, 바로 그 경계의 조정은 모호하므로
# 보수적으로 실패시킨다.
MAX_ORDINARY_DAILY_GAP_DAYS = 4
MIN_ORDINARY_DAILY_GAP_NUMERATOR = 4
MIN_ORDINARY_DAILY_GAP_DENOMINATOR = 5


@dataclass(frozen=True)
class VerifiedSplit:
    """외부 공시로 확인된 동일 심볼 승수 조정 한 건.

    ratio는 관측 종가비가 아니라 공시된 주식 수 변화가 뜻하는 이론 가격 계수
    (old_shares / new_shares)다. effective_date는 record/payment date가 아니라
    post-action 가격으로 처음 거래된 세션 날짜다. source에는 확인 가능한 공시
    URL이나 내부 근거 식별자를 남겨 가격 데이터만으로 원인을 확정한 것처럼
    보이지 않게 한다. 같은 클래스의 주식배당은 경제적으로 분할과 같은 조정이
    가능하지만, 법적 사건명을 숨기지 않도록 event_type을 별도로 기록한다.
    """

    symbol: str
    effective_date: date
    ratio: Decimal
    source: str
    event_type: str = "split"

    def __post_init__(self) -> None:
        symbol = (self.symbol or "").strip().upper()
        source = (self.source or "").strip()
        event_type = (self.event_type or "").strip().lower()
        if not symbol:
            raise ValueError("검증 분할의 symbol이 비어 있습니다")
        if not self.ratio.is_finite() or self.ratio <= 0 or self.ratio == 1:
            raise ValueError("검증 분할 ratio는 0보다 크고 1이 아닌 유한값이어야 합니다")
        if not MIN_ADJUSTMENT_FACTOR <= self.ratio <= MAX_ADJUSTMENT_FACTOR:
            raise ValueError(
                "검증 분할 ratio는 지원 범위 "
                f"[{MIN_ADJUSTMENT_FACTOR}, {MAX_ADJUSTMENT_FACTOR}] 안이어야 합니다"
            )
        if not source:
            raise ValueError("검증 분할에는 source가 필요합니다")
        if event_type not in ADJUSTMENT_TYPES:
            raise ValueError(
                "검증 조정 event_type은 split | reverse_split | "
                "same_class_stock_dividend 중 하나여야 합니다"
            )
        if event_type == "reverse_split" and self.ratio <= 1:
            raise ValueError("reverse_split ratio는 1보다 커야 합니다")
        if event_type in {"split", "same_class_stock_dividend"} and self.ratio >= 1:
            raise ValueError(f"{event_type} ratio는 1보다 작아야 합니다")
        object.__setattr__(self, "symbol", symbol)
        object.__setattr__(self, "source", source)
        object.__setattr__(self, "event_type", event_type)


def _parse_ratio(raw: str | None) -> Decimal:
    if raw is None:
        raise ValueError("잘못된 분할 ratio: None")
    text = raw.strip()
    try:
        if "/" in text:
            numerator, denominator = text.split("/", 1)
            return Decimal(numerator.strip()) / Decimal(denominator.strip())
        return Decimal(text)
    except (DecimalException, ZeroDivisionError) as exc:
        raise ValueError(f"잘못된 분할 ratio: {raw!r}") from exc


def _read_verified_splits(handle, manifest: str) -> dict[str, list[VerifiedSplit]]:
    required = {"symbol", "date", "ratio", "event_type", "source"}
    result: dict[str, list[VerifiedSplit]] = {}
    seen: set[tuple[str, date]] = set()
    try:
        reader = csv.DictReader(handle, strict=True)
        headers = list(reader.fieldnames or ())
        normalized = [header.strip().lower() for header in headers]
        duplicates = sorted(
            {header for header in normalized if normalized.count(header) > 1}
        )
        if duplicates:
            raise ValueError(
                f"{manifest}: 중복 검증 분할 헤더: {', '.join(duplicates)}"
            )
        actual = set(headers)
        missing = required - actual
        extra = actual - required
        if missing or extra:
            details: list[str] = []
            if missing:
                details.append(f"누락: {', '.join(sorted(missing))}")
            if extra:
                details.append(f"추가: {', '.join(sorted(extra))}")
            raise ValueError(
                f"{manifest}: 검증 분할 헤더 불일치 ({'; '.join(details)})"
            )
        for line_number, row in enumerate(reader, start=2):
            if None in row:
                raise ValueError(
                    f"{manifest}:{line_number}: CSV 헤더보다 값이 더 많습니다"
                )
            try:
                action = VerifiedSplit(
                    symbol=row.get("symbol") or "",
                    effective_date=date.fromisoformat(
                        (row.get("date") or "").strip()
                    ),
                    ratio=_parse_ratio(row.get("ratio")),
                    source=row.get("source") or "",
                    event_type=row.get("event_type") or "",
                )
            except (KeyError, TypeError, ValueError) as exc:
                raise ValueError(f"{manifest}:{line_number}: {exc}") from exc
            key = (action.symbol, action.effective_date)
            if key in seen:
                raise ValueError(
                    f"{manifest}:{line_number}: 중복 검증 분할 {action.symbol} "
                    f"{action.effective_date}"
                )
            seen.add(key)
            result.setdefault(action.symbol, []).append(action)
    except csv.Error as exc:
        raise ValueError(f"{manifest}: CSV 파싱 실패: {exc}") from exc

    for actions in result.values():
        actions.sort(key=lambda item: item.effective_date)
    return result


def load_verified_splits(path: Path | str) -> dict[str, list[VerifiedSplit]]:
    """검증된 동일 심볼 조정 CSV를 읽어 종목별로 반환한다."""
    manifest = Path(path)
    try:
        with manifest.open(newline="", encoding="utf-8-sig") as handle:
            return _read_verified_splits(handle, str(manifest))
    except OSError as exc:
        raise ValueError(f"검증 분할 파일을 읽을 수 없습니다: {manifest}") from exc


def load_verified_splits_bytes(
    content: bytes,
    *,
    source_name: str = "<verified-splits snapshot>",
) -> dict[str, list[VerifiedSplit]]:
    """한 번 고정한 매니페스트 바이트를 파싱한다.

    측정 도구가 파일을 파싱한 뒤 다시 열어 해시하면 그 사이 경로가 바뀌어
    실제 적용값과 보고된 해시가 달라질 수 있다. 호출자가 같은 bytes를 해시하고
    이 함수에 넘기면 그 TOCTOU가 사라진다.
    """
    try:
        text = content.decode("utf-8-sig")
    except UnicodeDecodeError as exc:
        raise ValueError(f"{source_name}: UTF-8 CSV가 아닙니다") from exc
    with io.StringIO(text, newline="") as handle:
        return _read_verified_splits(handle, source_name)


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
    persists: bool | None     # 유지=True, 복귀=False, 미래 봉 부족=None
    round_trip: bool = False  # 5봉 이내 반대 점프가 시작 가격대로 복귀하는지

    @property
    def change_pct(self) -> Decimal:
        return (self.ratio - 1) * 100

    @property
    def looks_like_split(self) -> bool:
        """가격 데이터만 보면 분할 후보로 볼 근거가 셋 다 있는가.

        비율만으로는 부족하다. 진짜 폭락이 우연히 -50%일 수 있고, 하루짜리
        데이터 오류도 -50%로 찍힌다. 셋을 모두 요구한다:
        깔끔한 분할 비율 + 거래량이 반대로 점프 + 새 가격대가 유지됨.
        """
        return (
            self.split_ratio is not None
            and self.volume_confirms
            and self.persists is True
            and not self.round_trip
        )

    @property
    def distorts_backtest(self) -> bool:
        """백테스트를 왜곡할 가능성이 높은 불연속인가.

        왕복·일시 불연속은 방향과 무관하게 민감도 플래그를 붙인다. 그 밖에는
        원인 불명 하락만 포함한다. 가짜 하락에서 손절이 발동하면 전략이 폭락을
        피한 것처럼 보일 수 있기 때문이다. 지속 상승 갭도 원인은 미확인이지만,
        이를 전부 빼면 고변동 승자를 사후 선택해 제거하는 반대 편향이 생긴다.
        """
        return self.looks_like_bad_bar or self.ratio < 1

    @property
    def looks_like_bad_bar(self) -> bool:
        """하루짜리 데이터 오류로 보이는가.

        되돌아오거나(지속성 실패), 5봉 이내 반대 점프와 짝을 이루면 그렇다.
        """
        return self.round_trip or self.persists is False

    def describe(self) -> str:
        if self.round_trip:
            kind = "왕복 불연속 (단기 가격대 복귀)"
        elif self.persists is False:
            kind = "일시 불연속 (곧 이전 가격대로 복귀)"
        elif self.persists is None:
            kind = "지속성 확인 불가 (미래 봉 부족)"
        elif self.looks_like_split:
            kind = f"분할비 후보 {self.split_ratio:.4f} (외부 확인 필요)"
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


def _persists(candles: list[Candle], index: int) -> bool | None:
    """점프 이후 새 가격대가 유지되는가.

    분할이면 유지되고, 하루짜리 데이터 오류면 다음날 되돌아온다. 뒤이은 봉이
    부족하면 판단할 수 없으므로 None을 반환한다. 증거 부재를 양성 증거로 바꾸지
    않는다.
    """
    following = candles[index + 1 : index + 1 + PERSISTENCE_BARS]
    if len(following) < PERSISTENCE_BARS:
        return None
    base = candles[index].close
    previous = candles[index - 1].close
    if base <= 0 or previous <= 0:
        return False
    # 이후 봉 중앙값이 이전 가격대보다 새 가격대에 더 가까운지 본다. 새 가격대에서
    # 같은 방향으로 더 움직인 경우를 단순 데이터 오류로 오인하지 않도록 로그 거리를
    # 사용한다.
    closes = sorted(c.close for c in following)
    median = closes[len(closes) // 2]
    if not median.is_finite() or median <= 0:
        return False
    # Decimal을 float로 좁히면 1e-10000 같은 유효한 값이 0으로 언더플로해
    # math.log가 실패한다. 가격 경계에서 허용한 정밀도를 여기서 버리지 않는다.
    to_new = abs((median / base).ln())
    to_old = abs((median / previous).ln())
    return to_new < to_old


def detect(
    candles: list[Candle], threshold: Decimal = Decimal("0.25")
) -> list[PriceBreak]:
    """전일 종가 대비 threshold 이상 변한 지점을 찾는다.

    기본 25%는 큰 사건 후보를 줄이는 정책값이다. 알려진 분할비 자체가 threshold
    이상 움직이는 비율이면, 당일 정상 변동 때문에 관측 변화가 조금 작아져도
    비율 허용오차 안에서는 후보 근거를 계산한다.
    """
    if not threshold.is_finite() or threshold <= 0:
        raise ValueError("불연속 threshold는 0보다 큰 유한값이어야 합니다")

    try:
        return _detect_decimal(candles, threshold)
    except DecimalException as exc:
        symbol = candles[0].symbol if candles else "?"
        raise ValueError(
            f"{symbol}: 가격 비율 계산이 Decimal 지원 범위를 벗어났습니다"
        ) from exc


def _detect_decimal(
    candles: list[Candle], threshold: Decimal
) -> list[PriceBreak]:
    breaks: list[PriceBreak] = []
    for index, (previous, current) in enumerate(zip(candles, candles[1:]), start=1):
        if not previous.close.is_finite() or not current.close.is_finite():
            raise ValueError(f"{current.symbol} {current.ts:%Y-%m-%d}: 유한하지 않은 종가")
        if previous.close <= 0:
            continue
        ratio = current.close / previous.close
        split_ratio = _match_split_ratio(ratio)
        volume_confirms = (
            _volume_confirms(previous, current, ratio)
            if split_ratio is not None
            else False
        )
        persists = _persists(candles, index)
        # 4:3(0.75)처럼 임계 경계에 있는 분할은 당일의 작은 정상 움직임 때문에
        # 25% 아래로 내려갈 수 있다. 이 예외는 비율뿐 아니라 거래량과 지속성도
        # 확인된 경우에만 허용한다. 비율 하나만으로 hard threshold를 우회하면
        # 평범한 24.9% 움직임까지 오염 민감도 표본에서 사후 제외되기 때문이다.
        if abs(ratio - 1) < threshold:
            if (
                split_ratio is None
                or abs(split_ratio - 1) < threshold
                or not volume_confirms
                or persists is not True
            ):
                continue
        breaks.append(
            PriceBreak(
                index=index,
                ts=current.ts,
                prev_close=previous.close,
                close=current.close,
                ratio=ratio,
                split_ratio=split_ratio,
                volume_confirms=volume_confirms,
                persists=persists,
            )
        )
    return _mark_round_trips(breaks)


def _mark_round_trips(breaks: list[PriceBreak]) -> list[PriceBreak]:
    """5봉 이내의 다음 점프가 시작 가격대로 돌아오면 둘 다 오류로 표시한다.

    비율을 곱해 1에 가까우면 왕복이다. 이걸 안 하면 되돌아오는 쪽이 지속성
    검사를 통과해 분할로 오인되고, 그대로 조정하면 원본보다 나빠진다.
    """
    flagged = set()
    for first, second in zip(breaks, breaks[1:]):
        if second.index - first.index > ROUNDTRIP_MAX_BARS:
            continue
        restored = second.close / first.prev_close
        if abs(restored - 1) <= ROUNDTRIP_TOLERANCE:
            flagged.update({first.index, second.index})

    if not flagged:
        return breaks
    return [
        replace(b, round_trip=True) if b.index in flagged else b for b in breaks
    ]


def _validate_daily_adjustment_evidence(
    symbol: str,
    dates: list[date],
    action_indexes: set[int],
) -> None:
    """날짜 매니페스트를 적용할 만큼 실제 시계열이 일봉에 가까운지 확인한다."""
    actionable = sorted(index for index in action_indexes if index > 0)
    if not actionable:
        # 첫 행의 행사는 이 표본 안에서 조정할 과거 봉이 없다.
        return

    gaps = [(current - previous).days for previous, current in zip(dates, dates[1:])]
    ordinary = sum(gap <= MAX_ORDINARY_DAILY_GAP_DAYS for gap in gaps)
    if (
        ordinary * MIN_ORDINARY_DAILY_GAP_DENOMINATOR
        < len(gaps) * MIN_ORDINARY_DAILY_GAP_NUMERATOR
    ):
        raise ValueError(
            f"{symbol}: 검증 조정에 필요한 일봉 주기 증거가 부족합니다 "
            f"(1~{MAX_ORDINARY_DAILY_GAP_DAYS}일 간격 {ordinary}/{len(gaps)})"
        )

    for index in actionable:
        boundary_gap = gaps[index - 1]
        if boundary_gap > MAX_ORDINARY_DAILY_GAP_DAYS:
            raise ValueError(
                f"{symbol} {dates[index]}: 행사 경계 간격 {boundary_gap}일은 "
                "검증 가능한 일봉 주기가 아닙니다"
            )


def back_adjust(
    candles: list[Candle], splits: list[VerifiedSplit]
) -> list[Candle]:
    """검증된 분할 지점의 **이전** 가격을 비율만큼 낮춰 연속으로 만든다.

    'adjusted close'가 하는 일과 같다. 최신 가격을 기준으로 두고 과거를 맞추므로
    현재 시점의 절대 가격은 바뀌지 않는다. 거래량은 반대로 곱한다.

    휴리스틱 PriceBreak는 받지 않는다. 분사 가치를 모르면 올바른 조정 계수를
    계산할 수 없고, 틀린 계수로 고치면 원본보다 나빠지기 때문이다.
    """
    if not candles or not splits:
        return list(candles)

    symbol = candles[0].symbol.upper()
    if any(c.symbol.upper() != symbol for c in candles):
        raise ValueError("한 번에 한 종목의 캔들만 소급 조정할 수 있습니다")

    # CSV 매니페스트의 date를 정확한 경계로 쓸 수 있는 계약만 허용한다. intraday는
    # 같은 날짜의 어느 봉이 첫 post-action 봉인지 알 수 없고, KST 자정 일봉을 UTC로
    # 바꾸면 날짜가 전날로 이동한다. 거래 세션 날짜/시간대가 모델에 추가되기 전에는
    # UTC 자정의 일봉만 안전하게 조정할 수 있다.
    dates: list[date] = []
    for candle in candles:
        if (
            candle.ts.tzinfo is None
            or candle.ts.utcoffset() != timedelta(0)
            or any(
                (candle.ts.hour, candle.ts.minute, candle.ts.second, candle.ts.microsecond)
            )
        ):
            raise ValueError(
                "검증 조정은 거래 세션 날짜가 명확한 UTC 자정 일봉에만 적용할 수 있습니다"
            )
        dates.append(candle.ts.date())
    if len(set(dates)) != len(dates) or dates != sorted(dates):
        raise ValueError("검증 조정의 UTC 자정 일봉 날짜는 중복 없이 오름차순이어야 합니다")

    index_by_date = {c.ts.date(): index for index, c in enumerate(candles)}
    first_date, last_date = candles[0].ts.date(), candles[-1].ts.date()
    actions_by_index: dict[int, VerifiedSplit] = {}
    for split in splits:
        if split.symbol != symbol:
            raise ValueError(f"{symbol} 캔들에 {split.symbol} 분할을 적용할 수 없습니다")
        index = index_by_date.get(split.effective_date)
        if index is None:
            if first_date <= split.effective_date <= last_date:
                raise ValueError(
                    f"{symbol} {split.effective_date}: 검증 분할 날짜의 캔들이 없습니다"
                )
            continue
        if index in actions_by_index:
            raise ValueError(f"{symbol} {split.effective_date}: 검증 분할이 중복됐습니다")
        actions_by_index[index] = split

    if not actions_by_index:
        return list(candles)

    _validate_daily_adjustment_evidence(symbol, dates, set(actions_by_index))

    # 종가만 이어진다고 데이터 전체가 같은 스케일인 것은 아니다. 체결은 다음 시가,
    # 돌파 전략은 고가·저가를 사용하므로 행사일 OHLC 모두가 공시 계수와 양립해야 한다.
    for index, split in actions_by_index.items():
        if index == 0:
            continue
        try:
            expected = candles[index - 1].close * split.ratio
            if expected <= 0 or not expected.is_finite():
                raise ValueError(
                    f"{symbol} {split.effective_date}: 검증 계수의 기준 가격이 유효하지 않습니다"
                )
            residual_gaps = {
                field: abs(getattr(candles[index], field) / expected - 1)
                for field in ("open", "high", "low", "close")
            }
            oversized_gaps = [
                (field, residual_gap)
                for field, residual_gap in residual_gaps.items()
                if residual_gap >= MAX_POST_ADJUSTMENT_GAP
            ]
        except DecimalException as exc:
            raise ValueError(
                f"{symbol} {split.effective_date}: 검증 계수 산술이 범위를 벗어납니다"
            ) from exc

        if oversized_gaps:
            field, residual_gap = oversized_gaps[0]
            raise ValueError(
                f"{symbol} {split.effective_date}: 검증 계수 {split.ratio} 적용 후 "
                f"행사일 {field} 잔여 갭 {residual_gap:.1%}가 너무 큽니다; "
                "날짜·공시 계수·OHLC 스케일을 확인하세요"
            )

    # 각 봉에 적용할 누적 계수. 뒤에서 앞으로 오면서 곱해 나간다.
    factors = [Decimal(1)] * len(candles)
    cumulative = Decimal(1)
    for index in range(len(candles) - 1, -1, -1):
        factors[index] = cumulative
        if split := actions_by_index.get(index):
            try:
                cumulative *= split.ratio
            except DecimalException as exc:
                raise ValueError(
                    f"{symbol} {split.effective_date}: 누적 검증 계수가 범위를 벗어납니다"
                ) from exc

    adjusted: list[Candle] = []
    for candle, factor in zip(candles, factors):
        if factor == 1:
            adjusted.append(candle)
            continue
        try:
            prices = {
                "open": candle.open * factor,
                "high": candle.high * factor,
                "low": candle.low * factor,
                "close": candle.close * factor,
            }
            volume = int(
                (Decimal(candle.volume) / factor).to_integral_value(
                    rounding=ROUND_HALF_UP
                )
            )
        except (DecimalException, OverflowError) as exc:
            raise ValueError(
                f"{symbol} {candle.ts.date()}: 소급 조정 산술이 범위를 벗어납니다"
            ) from exc
        if any(not value.is_finite() or value <= 0 for value in prices.values()):
            raise ValueError(
                f"{symbol} {candle.ts.date()}: 조정 후 OHLC는 "
                "0보다 큰 유한값이어야 합니다"
            )
        if not (
            prices["low"] <= prices["open"] <= prices["high"]
            and prices["low"] <= prices["close"] <= prices["high"]
        ):
            raise ValueError(
                f"{symbol} {candle.ts.date()}: 조정 후 OHLC 범위가 모순됩니다"
            )
        if volume < 0 or volume > SQLITE_INTEGER_MAX:
            raise ValueError(
                f"{symbol} {candle.ts.date()}: 조정 후 거래량이 "
                "SQLite INTEGER 범위를 벗어납니다"
            )
        adjusted.append(
            Candle(
                symbol=candle.symbol,
                ts=candle.ts,
                open=prices["open"],
                high=prices["high"],
                low=prices["low"],
                close=prices["close"],
                volume=volume,
            )
        )
    return adjusted
