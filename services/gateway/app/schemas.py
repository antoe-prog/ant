from typing import Optional

from pydantic import BaseModel, Field


class ChatRequest(BaseModel):
    user_id: str
    session_id: str
    message: str = Field(min_length=1, max_length=4000)
    model: Optional[str] = None
    temperature: float = Field(default=0.4, ge=0.0, le=1.0)


class ChatResponse(BaseModel):
    provider: str
    model: str
    answer: str
    request_id: str


class UsageResponse(BaseModel):
    user_id: str
    daily_budget_usd: float
    used_usd: float


class ScenarioItem(BaseModel):
    id: str
    summary: str
    cadence: str
    scenario_type: str
    preconditions: str
    trigger: str
    first_action: str
    success: str


class ProductVisionResponse(BaseModel):
    one_liner: str
    scenarios: list[ScenarioItem]
    differentiation: list[str]
    doc_paths: dict[str, str]
