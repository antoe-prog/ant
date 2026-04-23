from app.product_vision import DEFAULT_SYSTEM_PROMPT


class PromptRegistry:
    def __init__(self) -> None:
        self.prompts = {
            "default": DEFAULT_SYSTEM_PROMPT,
            "summary": "Summarize the conversation into actionable bullet points.",
            "translation": "Translate accurately while preserving tone and intent.",
        }

    def get(self, key: str) -> str:
        return self.prompts.get(key, self.prompts["default"])
