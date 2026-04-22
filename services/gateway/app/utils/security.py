import re


def mask_secrets(text: str) -> str:
    masked = re.sub(r"(sk-[A-Za-z0-9_-]{10,})", "***redacted***", text)
    masked = re.sub(r"([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})", "***email***", masked)
    return masked
