from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import cors_middleware_kwargs, settings
from app.middleware.request_context import RequestContextMiddleware
from app.product_vision import DIFFERENTIATION, DOC_PATHS, ONE_LINER, SCENARIOS
from app.schemas import ChatRequest, ChatResponse, ProductVisionResponse, ScenarioItem, UsageResponse
from app.services.chat_service import ChatService

app = FastAPI(title="Personal GenAI Gateway", version="0.1.0")
app.add_middleware(RequestContextMiddleware)
app.add_middleware(CORSMiddleware, **cors_middleware_kwargs())
chat_service = ChatService()


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/v1/models")
def list_models() -> dict[str, list[str]]:
    return {"models": ["gpt-4o-mini", "claude-3-5-haiku"]}


@app.get("/v1/product-vision", response_model=ProductVisionResponse)
def product_vision() -> ProductVisionResponse:
    """1-1 산출물 스냅샷 — 온보딩/About에서 사용. docs/product/*.md와 내용을 맞출 것."""
    scenarios = [ScenarioItem(**row) for row in SCENARIOS]
    return ProductVisionResponse(
        one_liner=ONE_LINER,
        scenarios=scenarios,
        differentiation=DIFFERENTIATION,
        doc_paths=DOC_PATHS,
    )


@app.post("/v1/chat", response_model=ChatResponse)
async def chat(payload: ChatRequest) -> ChatResponse:
    return await chat_service.generate(payload)


@app.get("/v1/usage", response_model=UsageResponse)
def usage(user_id: str) -> UsageResponse:
    return UsageResponse(
        user_id=user_id,
        daily_budget_usd=settings.daily_budget_usd,
        used_usd=chat_service.budget_guard.used_today(user_id),
    )
