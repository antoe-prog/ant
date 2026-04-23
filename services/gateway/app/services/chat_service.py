import uuid

from app.config import settings
from app.schemas import ChatRequest, ChatResponse
from app.services.budget_guard import BudgetGuard
from app.services.memory_store import MemoryStore
from app.services.prompt_registry import PromptRegistry
from app.services.provider_adapter import ProviderAdapter
from app.services.rate_limiter import RateLimiter
from app.utils.security import mask_secrets


class ChatService:
    def __init__(self) -> None:
        self.prompt_registry = PromptRegistry()
        self.provider_adapter = ProviderAdapter()
        self.memory_store = MemoryStore()
        self.rate_limiter = RateLimiter()
        self.budget_guard = BudgetGuard(daily_budget_usd=settings.daily_budget_usd)

    async def generate(self, payload: ChatRequest) -> ChatResponse:
        if not self.rate_limiter.check_and_increment(payload.user_id):
            return ChatResponse(
                provider=self.provider_adapter.provider_name,
                model=payload.model or settings.default_model,
                answer="Rate limit exceeded for today.",
                request_id=str(uuid.uuid4()),
            )
        if not self.budget_guard.can_spend(payload.user_id, next_cost=0.01):
            return ChatResponse(
                provider=self.provider_adapter.provider_name,
                model=payload.model or settings.default_model,
                answer="Daily budget reached. Please try again tomorrow.",
                request_id=str(uuid.uuid4()),
            )

        system_prompt = self.prompt_registry.get("default")
        model = payload.model or settings.default_model
        user_text = mask_secrets(payload.message)
        self.memory_store.append(payload.session_id, "user", user_text)
        context = self.memory_store.get_context(payload.session_id)
        enriched_prompt = "\n".join([f"{item['role']}: {item['text']}" for item in context])

        answer = await self.provider_adapter.generate(
            system_prompt=system_prompt,
            user_prompt=enriched_prompt,
            model=model,
            temperature=payload.temperature,
        )
        self.memory_store.append(payload.session_id, "assistant", answer)
        self.budget_guard.add_usage(payload.user_id, amount=0.01)
        return ChatResponse(
            provider=self.provider_adapter.provider_name,
            model=model,
            answer=answer,
            request_id=str(uuid.uuid4()),
        )
