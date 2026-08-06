"""환경변수 기반 설정. 모든 키는 TOSSQUANT_ 접두사를 쓴다."""

from __future__ import annotations

from decimal import Decimal
from enum import Enum
from pathlib import Path

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Mode(str, Enum):
    PAPER = "paper"
    LIVE = "live"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_prefix="TOSSQUANT_",
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # --- 토스증권 Open API ---
    client_id: str = ""
    client_secret: str = ""
    account_id: str = ""
    base_url: str = "https://openapi.tossinvest.com"
    request_timeout: float = 10.0

    # --- 실행 ---
    mode: Mode = Mode.PAPER
    symbols: list[str] = Field(default_factory=lambda: ["AAPL", "MSFT", "NVDA"])
    poll_seconds: int = 60
    candle_interval: str = "1d"
    db_path: Path = Path("tossquant.db")

    # --- 페이퍼 트레이딩 ---
    paper_cash: Decimal = Decimal("10000")
    paper_slippage_bps: Decimal = Decimal("5")
    paper_commission_bps: Decimal = Decimal("7")

    # --- 백테스트 ---
    # 호가 스프레드. paper_slippage_bps(시장충격)와는 별개 비용이므로 둘 다 붙는다.
    backtest_spread_bps: Decimal = Decimal("2")

    # --- 전략 (SMA 크로스) ---
    sma_fast: int = 20
    sma_slow: int = 60

    # --- 리스크 ---
    max_position_pct: Decimal = Decimal("0.25")
    max_positions: int = 4
    max_daily_loss_pct: Decimal = Decimal("0.03")
    max_order_notional: Decimal = Decimal("5000")

    # --- 보호 청산 (0이면 비활성) ---
    # 손절은 기본으로 켜 둔다. 전략 신호만으로 청산하면 급락에 수십 봉 늦는다.
    stop_loss_pct: Decimal = Decimal("0.08")
    trailing_stop_pct: Decimal = Decimal("0")
    take_profit_pct: Decimal = Decimal("0")
    max_holding_days: int = 0
    stop_cooldown_days: int = 3

    # --- 알림 (비우면 비활성) ---
    telegram_bot_token: str = ""
    telegram_chat_id: str = ""
    slack_webhook_url: str = ""
    # 같은 사유의 알림을 다시 보내기까지의 최소 간격. 사이클 오류가 매 분
    # 반복될 때 알림 폭탄을 막는다.
    notify_throttle_seconds: int = 300
    notify_fills: bool = True
    notify_daily_summary: bool = True

    @field_validator("symbols", mode="before")
    @classmethod
    def _split_symbols(cls, v: object) -> object:
        if isinstance(v, str):
            return [s.strip().upper() for s in v.split(",") if s.strip()]
        return v

    @field_validator("sma_slow")
    @classmethod
    def _slow_gt_fast(cls, v: int, info) -> int:
        fast = info.data.get("sma_fast")
        if fast is not None and v <= fast:
            raise ValueError("sma_slow must be greater than sma_fast")
        return v

    def require_credentials(self) -> None:
        missing = [
            name
            for name in ("client_id", "client_secret")
            if not getattr(self, name)
        ]
        if missing:
            raise RuntimeError(
                "토스 Open API 자격증명이 없습니다: "
                + ", ".join(f"TOSSQUANT_{m.upper()}" for m in missing)
                + " — 토스증권 WTS > 설정 > Open API 에서 발급하세요."
            )
