# 기능: AI 채팅 (일상 어시스턴트)

**Product scope:** Core scenario 1 (시나리오 S1 — [recurring-scenarios.md](recurring-scenarios.md))

AI chat for daily personal assistant tasks. 게이트웨이 기본 시스템 프롬프트는 [한 줄 비전](product-vision-one-liner.md)과 정합되도록 `app/product_vision.py`의 `DEFAULT_SYSTEM_PROMPT`를 `PromptRegistry`가 사용한다. 클라이언트는 온보딩 문구용으로 `GET /v1/product-vision`을 호출할 수 있다.
