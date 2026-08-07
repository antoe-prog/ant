#!/usr/bin/env python
"""종목별 전략 vs 바이앤홀드 분포.

두세 종목만 보고 내린 결론은 대개 종목 선택의 산물이다. 같은 전략을 전 종목에
돌려 '몇 %에서 이겼나'를 봐야 전략 자체의 성질이 드러난다.

사용:
    python scripts/sweep.py <csv폴더> [--fast 20 --slow 60 --limit 100]

CSV는 `<폴더>/<종목>.csv`, 헤더는 date,open,high,low,close,volume.
"""

from __future__ import annotations

import argparse
import logging
import pathlib
import statistics
import sys
from decimal import Decimal

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent / "src"))

from tossquant.backtest.data import CsvSource, load_history  # noqa: E402
from tossquant.backtest.simulator import Backtester  # noqa: E402
from tossquant.config import Settings  # noqa: E402
from tossquant.strategy import registry  # noqa: E402


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("csv_dir", type=pathlib.Path)
    p.add_argument("--strategy", default="sma_cross", choices=registry.NAMES)
    p.add_argument("--fast", type=int, default=20)
    p.add_argument("--slow", type=int, default=60)
    p.add_argument("--limit", type=int, default=0, help="종목 수 제한 (0=전체)")
    p.add_argument("--min-bars", type=int, default=0, help="이 봉 수 미만은 제외")
    p.add_argument("--stop-loss", type=float, default=0.08)
    return p.parse_args()


def bar_count(path: pathlib.Path) -> int:
    with path.open() as fh:
        return sum(1 for _ in fh) - 1


def main() -> None:
    args = parse_args()
    logging.disable(logging.CRITICAL)  # 종목마다 쏟아지는 손절 로그를 막는다

    files = sorted(args.csv_dir.glob("*.csv"))
    if not files:
        sys.exit(f"{args.csv_dir} 에 CSV가 없습니다")

    # 기간이 다른 종목을 섞으면 비교가 무의미해진다. 기본은 최장 기간만 남긴다.
    counts = {f.stem: bar_count(f) for f in files}
    threshold = args.min_bars or max(counts.values())
    symbols = [s for s, n in sorted(counts.items()) if n >= threshold]
    if args.limit:
        symbols = symbols[: args.limit]

    settings = Settings(
        _env_file=None,
        client_id="x",
        client_secret="y",
        paper_cash=Decimal("10000"),
        max_position_pct=Decimal("1"),
        max_positions=1,
        stop_loss_pct=Decimal(str(args.stop_loss)),
        strategy=args.strategy,
        sma_fast=args.fast,
        sma_slow=args.slow,
    )
    strategy = registry.build(args.strategy, settings)
    source = CsvSource(args.csv_dir)

    rows = []
    for symbol in symbols:
        try:
            history = load_history([symbol], "1d", source, count=0)
            result = Backtester(history, strategy, settings).run()
        except (ValueError, KeyError):
            continue  # 봉이 부족한 종목은 건너뛴다
        rows.append(
            (
                symbol,
                result.metrics.total_return,
                result.benchmark_metrics.total_return,
                result.metrics.max_drawdown,
                result.benchmark_metrics.max_drawdown,
                result.metrics.sharpe,
                result.benchmark_metrics.sharpe,
                result.metrics.trades,
            )
        )

    if not rows:
        sys.exit("유효한 결과가 없습니다")
    report(rows, args, threshold)


def report(rows: list[tuple], args: argparse.Namespace, bars: int) -> None:
    def col(i: int) -> list[float]:
        return [r[i] for r in rows]

    def pct(values: list[float]) -> list[float]:
        return [v * 100 for v in values]

    wins = sum(1 for r in rows if r[1] > r[2])
    total = len(rows)

    print(
        f"종목 {total}개 × {bars}봉 · 전략 {args.strategy} · "
        f"손절 {args.stop_loss * 100:g}%\n"
    )
    print(f"{'':20} {'전략':>10} {'바이앤홀드':>12}")
    for label, index in (("총수익률 중앙값", 1), ("MDD 중앙값", 3)):
        strategy, benchmark = col(index), col(index + 1)
        print(
            f"{label:20} {statistics.median(pct(strategy)):9.1f}% "
            f"{statistics.median(pct(benchmark)):11.1f}%"
        )
    print(
        f"{'Sharpe 중앙값':20} {statistics.median(col(5)):10.2f} "
        f"{statistics.median(col(6)):12.2f}"
    )

    print(f"\n바이앤홀드를 이긴 종목  {wins}/{total} ({wins / total * 100:.1f}%)")
    print(f"수익이 난 종목          {sum(1 for x in col(1) if x > 0)}/{total}")
    print(f"평균 거래 횟수          {statistics.mean(col(7)):.1f}")

    ranked = sorted(rows, key=lambda r: r[1] - r[2], reverse=True)
    for title, subset in (("초과수익 상위 5", ranked[:5]), ("초과수익 하위 5", ranked[-5:])):
        print(f"\n{title}")
        for symbol, strategy, benchmark, *_ in subset:
            print(
                f"  {symbol:6} 전략 {strategy * 100:+8.1f}%  "
                f"벤치 {benchmark * 100:+8.1f}%  차이 {(strategy - benchmark) * 100:+9.1f}%p"
            )


if __name__ == "__main__":
    main()
