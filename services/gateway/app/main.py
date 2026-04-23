from pathlib import Path
from typing import Annotated

from fastapi import Depends, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from app.auth.routes import get_current_user, require_role
from app.auth.routes import router as auth_router
from app.config import cors_middleware_kwargs, settings
from app.middleware.request_context import RequestContextMiddleware
from app.product_vision import DIFFERENTIATION, DOC_PATHS, ONE_LINER, SCENARIOS
from app.schemas import ChatRequest, ChatResponse, ProductVisionResponse, ScenarioItem, UsageResponse
from app.services.chat_service import ChatService

app = FastAPI(title="Personal GenAI Gateway", version="0.1.0")
app.add_middleware(RequestContextMiddleware)
app.add_middleware(CORSMiddleware, **cors_middleware_kwargs())
app.include_router(auth_router)
chat_service = ChatService()


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/v1/models")
def list_models() -> dict[str, list[str]]:
    return {"models": ["gpt-4o-mini", "claude-3-5-haiku"]}


@app.get("/v1/product-vision", response_model=ProductVisionResponse)
def product_vision(
    _user: Annotated[dict, Depends(get_current_user)],
) -> ProductVisionResponse:
    """1-1 산출물 스냅샷 — 온보딩/About에서 사용. docs/product/*.md와 내용을 맞출 것."""
    scenarios = [ScenarioItem(**row) for row in SCENARIOS]
    return ProductVisionResponse(
        one_liner=ONE_LINER,
        scenarios=scenarios,
        differentiation=DIFFERENTIATION,
        doc_paths=DOC_PATHS,
    )


@app.post("/v1/chat", response_model=ChatResponse)
async def chat(
    payload: ChatRequest,
    user: Annotated[dict, Depends(get_current_user)],
) -> ChatResponse:
    # 본인이 아닌 user_id로 호출하려면 admin 이어야 함
    if payload.user_id != user["id"] and user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="forbidden_other_user")
    return await chat_service.generate(payload)


@app.get("/v1/usage", response_model=UsageResponse)
def usage(
    user_id: str,
    user: Annotated[dict, Depends(get_current_user)],
) -> UsageResponse:
    if user_id != user["id"] and user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="forbidden_other_user")
    return UsageResponse(
        user_id=user_id,
        daily_budget_usd=settings.daily_budget_usd,
        used_usd=chat_service.budget_guard.used_today(user_id),
    )


@app.get("/v1/admin/users")
def admin_list_users(
    _admin: Annotated[dict, Depends(require_role("admin"))],
) -> dict:
    """admin 전용: 가입된 사용자 요약 목록."""
    from app.auth.routes import _store

    store = _store()
    users = []
    for uid in list(store._users.keys()):  # snapshot under internal lock is fine-grained elsewhere
        u = store.get_by_id(uid)
        if not u:
            continue
        users.append(
            {
                "id": u["id"],
                "email": u["email"],
                "name": u.get("name", ""),
                "role": u.get("role", "member"),
                "createdAt": u.get("createdAt"),
                "lastSignedIn": u.get("lastSignedIn"),
            }
        )
    return {"users": users, "count": len(users)}


# ------------------------------------------------------------------
# admin-web 정적 번들 서빙
# 빌드된 SPA(services/gateway/app/web-dist)를 /admin 경로로 노출한다.
# 번들이 없으면 마운트를 건너뛴다(개발 환경에서는 Vite(:5173)로 접근).
# ------------------------------------------------------------------
_WEB_DIST = Path(__file__).resolve().parent / "web-dist"
if (_WEB_DIST / "index.html").exists():
    app.mount(
        "/admin/assets",
        StaticFiles(directory=str(_WEB_DIST / "assets")),
        name="admin-assets",
    )

    @app.get("/admin")
    @app.get("/admin/{path:path}")
    def admin_spa(path: str = "") -> FileResponse:
        """SPA 라우팅 fallback: 모든 경로를 index.html로 돌려준다."""
        index = _WEB_DIST / "index.html"
        return FileResponse(index)

    @app.get("/")
    def root_redirect() -> FileResponse:
        return FileResponse(_WEB_DIST / "index.html")
