"""환경변수 기반 설정. 모든 키는 TOSSQUANT_ 접두사를 쓴다."""

from __future__ import annotations

from datetime import date
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
        validate_assignment=True,
    )

    # --- 토스증권 Open API ---
    client_id: str = ""
    client_secret: str = ""
    account_id: str = ""
    base_url: str = "https://openapi.tossinvest.com"
    request_timeout: float = Field(default=10.0, gt=0, allow_inf_nan=False)
    # WTS의 Open API 화면에 찍힌 만료일. API가 남은 기간을 알려주지 않으므로
    # 여기 적어두지 않으면 만료 당일 봇이 인증 실패로 조용히 멈춘다.
    key_expires_at: date | None = None
    key_expiry_warn_days: int = 30

    # --- 실행 ---
    mode: Mode = Mode.PAPER
    symbols: list[str] = Field(default_factory=lambda: ["AAPL", "MSFT", "NVDA"])
    poll_seconds: int = Field(default=60, gt=0)
    candle_interval: str = "1d"
    db_path: Path = Path("tossquant.db")

    # --- 페이퍼 트레이딩 ---
    paper_cash: Decimal = Field(
        default=Decimal("10000"), gt=0, allow_inf_nan=False
    )
    paper_slippage_bps: Decimal = Field(
        default=Decimal("5"), ge=0, lt=10000, allow_inf_nan=False
    )
    paper_commission_bps: Decimal = Field(
        default=Decimal("7"), ge=0, allow_inf_nan=False
    )

    # --- 백테스트 ---
    # 호가 스프레드. paper_slippage_bps(시장충격)와는 별개 비용이므로 둘 다 붙는다.
    backtest_spread_bps: Decimal = Field(
        default=Decimal("2"), ge=0, lt=20000, allow_inf_nan=False
    )

    # --- 전략 ---
    # sma_cross | momentum | breakout | mean_reversion
    strategy: str = "sma_cross"

    sma_fast: int = Field(default=20, gt=0)
    # fast만 지정한 초기화에서도 기본 slow가 교차 검증을 타야 한다.
    sma_slow: int = Field(default=60, gt=0, validate_default=True)

    momentum_lookback: int = Field(default=60, gt=0)
    momentum_entry: Decimal = Field(
        default=Decimal("0.05"), allow_inf_nan=False
    )
    momentum_exit: Decimal = Field(
        default=Decimal("0"), allow_inf_nan=False, validate_default=True
    )

    breakout_entry_bars: int = Field(default=20, gt=0)
    breakout_exit_bars: int = Field(default=10, gt=0)

    meanrev_lookback: int = Field(default=20, gt=1)
    meanrev_entry_z: Decimal = Field(
        default=Decimal("-2"), allow_inf_nan=False
    )
    meanrev_exit_z: Decimal = Field(
        default=Decimal("0"), allow_inf_nan=False, validate_default=True
    )

    # --- 시장 국면 필터 ---
    # 지수가 장기선 아래면 신규 진입만 막는다 (청산은 항상 허용).
    # 기본은 꺼둔다 — 지수 캔들이 없으면 아무 일도 안 하므로 켤 때 확인이 필요하다.
    regime_enabled: bool = False
    regime_symbol: str = "SPY"
    regime_ma_bars: int = Field(default=200, gt=0)

    # --- 리스크 ---
    max_position_pct: Decimal = Field(
        default=Decimal("0.25"), gt=0, le=1, allow_inf_nan=False
    )
    max_positions: int = Field(default=4, gt=0)
    max_daily_loss_pct: Decimal = Field(
        default=Decimal("0.03"), ge=0, lt=1, allow_inf_nan=False
    )
    max_order_notional: Decimal = Field(
        default=Decimal("5000"), gt=0, allow_inf_nan=False
    )

    # --- 보호 청산 (0이면 비활성) ---
    # 손절은 기본으로 켜 둔다. 전략 신호만으로 청산하면 급락에 수십 봉 늦는다.
    stop_loss_pct: Decimal = Field(
        default=Decimal("0.08"), ge=0, lt=1, allow_inf_nan=False
    )
    trailing_stop_pct: Decimal = Field(
        default=Decimal("0"), ge=0, lt=1, allow_inf_nan=False
    )
    # 이익 목표는 100%를 넘을 수 있으므로 손절과 달리 상한을 두지 않는다.
    take_profit_pct: Decimal = Field(
        default=Decimal("0"), ge=0, allow_inf_nan=False
    )
    max_holding_days: int = Field(default=0, ge=0)
    stop_cooldown_days: int = Field(default=3, ge=0)

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
            values = v.split(",")
        elif isinstance(v, (list, tuple)):
            values = v
        else:
            return v
        normalized: list[str] = []
        for value in values:
            if not isinstance(value, str):
                return v
            symbol = value.strip().upper()
            if symbol and symbol not in normalized:
                normalized.append(symbol)
        return normalized

    @field_validator("regime_symbol", mode="before")
    @classmethod
    def _canonical_regime_symbol(cls, v: object) -> object:
        if not isinstance(v, str):
            return v
        symbol = v.strip().upper()
        if not symbol:
            raise ValueError("regime_symbol must not be blank")
        return symbol

    @field_validator("sma_fast")
    @classmethod
    def _fast_lt_slow(cls, v: int, info) -> int:
        # 초기화 때 slow는 아직 없지만 assignment 때는 기존 값이 들어온다.
        slow = info.data.get("sma_slow")
        if slow is not None and v >= slow:
            raise ValueError("sma_fast must be smaller than sma_slow")
        return v

    @field_validator("sma_slow")
    @classmethod
    def _slow_gt_fast(cls, v: int, info) -> int:
        fast = info.data.get("sma_fast")
        if fast is not None and v <= fast:
            raise ValueError("sma_slow must be greater than sma_fast")
        return v

    @field_validator("momentum_entry")
    @classmethod
    def _momentum_entry_gte_exit(cls, v: Decimal, info) -> Decimal:
        exit_threshold = info.data.get("momentum_exit")
        if exit_threshold is not None and v < exit_threshold:
            raise ValueError("momentum_entry must be >= momentum_exit")
        return v

    @field_validator("momentum_exit")
    @classmethod
    def _momentum_exit_lte_entry(cls, v: Decimal, info) -> Decimal:
        entry_threshold = info.data.get("momentum_entry")
        if entry_threshold is not None and v > entry_threshold:
            raise ValueError("momentum_exit must be <= momentum_entry")
        return v

    @field_validator("meanrev_entry_z")
    @classmethod
    def _meanrev_entry_is_negative(cls, v: Decimal, info) -> Decimal:
        if v >= 0:
            raise ValueError("meanrev_entry_z must be negative")
        exit_threshold = info.data.get("meanrev_exit_z")
        if exit_threshold is not None and v > exit_threshold:
            raise ValueError("meanrev_entry_z must be <= meanrev_exit_z")
        return v

    @field_validator("meanrev_exit_z")
    @classmethod
    def _meanrev_exit_gte_entry(cls, v: Decimal, info) -> Decimal:
        entry_threshold = info.data.get("meanrev_entry_z")
        if entry_threshold is not None and v < entry_threshold:
            raise ValueError("meanrev_exit_z must be >= meanrev_entry_z")
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

    def days_until_key_expiry(self, today: date | None = None) -> int | None:
        """키 만료까지 남은 일수. 만료일을 설정하지 않았으면 None."""
        if self.key_expires_at is None:
            return None
        return (self.key_expires_at - (today or date.today())).days

    def key_expiry_warning(self, today: date | None = None) -> str | None:
        """경고가 필요하면 사람이 읽을 문장, 아니면 None.

        만료된 키로는 토큰 발급 자체가 안 되므로 봇이 통째로 멈춘다. 미리
        알려주지 않으면 1년 뒤 원인 모를 인증 실패로 나타난다.
        """
        remaining = self.days_until_key_expiry(today)
        if remaining is None:
            return None
        if remaining < 0:
            return (
                f"API 키가 {-remaining}일 전에 만료됐습니다 ({self.key_expires_at}). "
                "토스증권 WTS > 설정 > Open API 에서 재발급하세요."
            )
        if remaining == 0:
            return f"API 키가 오늘 만료됩니다 ({self.key_expires_at}). 지금 재발급하세요."
        if remaining <= self.key_expiry_warn_days:
            return (
                f"API 키가 {remaining}일 뒤 만료됩니다 ({self.key_expires_at}). "
                "미리 재발급해 두세요."
            )
        return None
