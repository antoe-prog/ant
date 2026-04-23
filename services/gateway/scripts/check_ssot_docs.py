#!/usr/bin/env python3
"""Verify docs/product/*.md stay aligned with app/product_vision.py (SSOT).

Run from services/gateway: python scripts/check_ssot_docs.py
See .cursor/skills/prevent-duplicate-code-conflicts/reference.md#ci-drift-checks
"""
from __future__ import annotations

import sys
from pathlib import Path

_GATEWAY = Path(__file__).resolve().parents[1]  # services/gateway
_REPO = _GATEWAY.parent.parent  # monorepo root

_SSOT_DIFF_BEGIN = "<!-- ssot-differentiation-begin -->"
_SSOT_DIFF_END = "<!-- ssot-differentiation-end -->"


def _strip_md_emphasis(text: str) -> str:
    return text.replace("*", "")


def _parse_ssot_differentiation_block(md: str) -> list[str] | None:
    start = md.find(_SSOT_DIFF_BEGIN)
    end = md.find(_SSOT_DIFF_END)
    if start == -1 or end == -1 or end <= start:
        return None
    inner = md[start + len(_SSOT_DIFF_BEGIN) : end]
    lines = [ln.strip() for ln in inner.splitlines() if ln.strip()]
    return lines or None


def main() -> int:
    sys.path.insert(0, str(_GATEWAY))
    from app.product_vision import DIFFERENTIATION, ONE_LINER, SCENARIOS

    one_path = _REPO / "docs" / "product" / "product-vision-one-liner.md"
    scen_path = _REPO / "docs" / "product" / "recurring-scenarios.md"
    strat_path = _REPO / "docs" / "product" / "strategic-differentiation.md"

    if not one_path.is_file() or not scen_path.is_file() or not strat_path.is_file():
        print("check_ssot_docs: doc paths missing", file=sys.stderr)
        return 1

    one_text = _strip_md_emphasis(one_path.read_text(encoding="utf-8"))
    if ONE_LINER not in one_text:
        print(
            "SSOT mismatch: ONE_LINER from app/product_vision.py not found in "
            "docs/product/product-vision-one-liner.md (after stripping '*').\n"
            "  Fix: update the markdown blockquote or ONE_LINER so they match.",
            file=sys.stderr,
        )
        return 1

    scen_text = scen_path.read_text(encoding="utf-8")
    for row in SCENARIOS:
        sid = row["id"]
        if sid not in scen_text:
            print(
                f"SSOT mismatch: scenario id {sid!r} missing from docs/product/recurring-scenarios.md.\n"
                "  Fix: add the row to the table or update SCENARIOS in app/product_vision.py.",
                file=sys.stderr,
            )
            return 1

    strat_text = strat_path.read_text(encoding="utf-8")
    doc_lines = _parse_ssot_differentiation_block(strat_text)
    if doc_lines is None:
        print(
            "SSOT mismatch: strategic-differentiation.md missing "
            f"{_SSOT_DIFF_BEGIN!r} … {_SSOT_DIFF_END!r} block with differentiation lines.\n"
            "  Fix: restore the block or sync with app/product_vision.py DIFFERENTIATION.",
            file=sys.stderr,
        )
        return 1
    if doc_lines != list(DIFFERENTIATION):
        print(
            "SSOT mismatch: DIFFERENTIATION in app/product_vision.py does not match "
            "the ssot-differentiation block in docs/product/strategic-differentiation.md.\n"
            f"  Python: {list(DIFFERENTIATION)!r}\n"
            f"  Docs:   {doc_lines!r}",
            file=sys.stderr,
        )
        return 1

    comp_path = _REPO / "docs" / "product" / "competitive-comparison.md"
    if not comp_path.is_file():
        print("check_ssot_docs: competitive-comparison.md missing", file=sys.stderr)
        return 1
    comp_text = comp_path.read_text(encoding="utf-8")
    for needle in ("ChatGPT", "Gemini", "Perplexity"):
        if needle not in comp_text:
            print(
                f"SSOT: docs/product/competitive-comparison.md must include {needle!r} "
                "(1-3 three-app comparison table).\n"
                "  Fix: fill the table in competitive-comparison.md.",
                file=sys.stderr,
            )
            return 1

    print("SSOT docs check OK (product_vision.py vs docs/product)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
