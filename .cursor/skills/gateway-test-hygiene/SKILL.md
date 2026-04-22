---
name: gateway-test-hygiene
description: >-
  Pytest patterns for services/gateway: TestClient, new routes get a test,
  mocking providers. Use when editing tests/, adding endpoints, or CI test
  failures. Korean: pytest, 게이트웨이 테스트.
---

# 게이트웨이 테스트 위생

## 관련 스킬

- API 계약: [gateway-api-contract](../gateway-api-contract/SKILL.md)  
- SSOT: [prevent-duplicate-code-conflicts](../prevent-duplicate-code-conflicts/SKILL.md)

## 원칙

1. **새 라우트** → `tests/test_*.py`에 최소 **200 응답 한 개**.  
2. **브레이킹** → 기존 테스트 수정을 **같은 PR**에.  
3. **외부 LLM** 호출은 테스트에서 **mock**; `ProviderAdapter` 단위가 없으면 `TestClient`로 응답 스키마만 검증.

## 실행

`cd services/gateway && pytest -q` (또는 CI와 동일 Python)

## 추가 참고

- OpenAPI 스냅샷 예: [reference.md](reference.md)
