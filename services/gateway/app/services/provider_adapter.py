from app.config import settings


class ProviderAdapter:
    def __init__(self) -> None:
        self.provider_name = settings.default_provider

    async def generate(
        self,
        system_prompt: str,
        user_prompt: str,
        model: str,
        temperature: float,
    ) -> str:
        # Template response. Replace with real provider SDK calls.
        return f"[{model}] {system_prompt} | {user_prompt} (temp={temperature})"
