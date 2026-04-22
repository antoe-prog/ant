from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8")

    app_env: str = "local"
    log_level: str = "INFO"
    database_url: str = "postgresql+psycopg://postgres:postgres@localhost:5432/genai_template"
    redis_url: str = "redis://localhost:6379/0"
    openai_api_key: str = ""
    anthropic_api_key: str = ""
    default_provider: str = "openai"
    default_model: str = "gpt-4o-mini"
    daily_budget_usd: float = 2.0
    # Comma-separated origins for browser clients (e.g. apps/admin-web). Empty = local dev defaults.
    cors_allow_origins: str = ""


settings = Settings()


def cors_origins() -> list[str]:
    raw = settings.cors_allow_origins.strip()
    if not raw:
        return [
            "http://localhost:5173",
            "http://127.0.0.1:5173",
        ]
    return [o.strip() for o in raw.split(",") if o.strip()]


def cors_middleware_kwargs() -> dict:
    """CORSMiddleware 인자. CORS_ALLOW_ORIGINS 미설정 시 LAN에서 Vite(:5173) 접속 허용."""
    kw: dict = {
        "allow_origins": cors_origins(),
        "allow_credentials": True,
        "allow_methods": ["*"],
        "allow_headers": ["*"],
    }
    if not settings.cors_allow_origins.strip():
        kw["allow_origin_regex"] = (
            r"http://(192\.168\.\d{1,3}\.\d{1,3}|10\.\d{1,3}\.\d{1,3}\.\d{1,3}):5173$"
        )
    return kw
