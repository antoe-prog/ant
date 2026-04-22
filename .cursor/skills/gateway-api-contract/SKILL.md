---
name: gateway-api-contract
description: >-
  Keeps FastAPI gateway contracts consistent: schemas, routes, tests, and client
  TODOs when /v1/chat, /v1/product-vision, or usage APIs change. Use when editing
  services/gateway/app/schemas.py, main.py routes, or request/response shapes.
  Korean: API 변경, 스키마, 계약, 브레이킹.
---

# 게이트웨이 API 계약

## 관련 스킬

- SSOT·중복·드리프트: [prevent-duplicate-code-conflicts](../prevent-duplicate-code-conflicts/SKILL.md)  
- 모바일 연동: [mobile-chat-client-integration](../mobile-chat-client-integration/SKILL.md)  
- 테스트: [gateway-test-hygiene](../gateway-test-hygiene/SKILL.md)

## SSOT

- 요청/응답 모델: `services/gateway/app/schemas.py`  
- 라우트: `services/gateway/app/main.py`  
- 비즈니스 로직: `services/gateway/app/services/*`

## 변경 시 체크리스트

- [ ] `schemas.py` 필드 추가/삭제/이름 변경 시 **모든** `ChatRequest`/`ChatResponse`/기타 소비 코드 갱신  
- [ ] `tests/test_*.py`에 최소 한 개 **성공 경로** 또는 **검증 실패** 케이스 추가  
- [ ] 모바일 앱에 TODO로만 남아 있으면, PR 설명에 **클라이언트 후속 작업** 명시  
- [ ] 문서(`docs/product`, `docs/architecture`)에 엔드포인트·필드 설명이 있으면 동시 수정

## 브레이킹 시

- 전역 검색: 이전 필드명·JSON 키 문자열.  
- `GET /v1/product-vision` 등 **외부에 노출된 JSON 키** 변경은 앱·스크립트 소비자에게 브레이킹.

## 에이전트 지침

- 새 엔드포인트는 **스키마 클래스 + 라우트 한 쌍**으로 추가하고, 테스트를 같은 변경에 넣는다.  
- `Optional` vs `str | None` 등은 저장소의 Python 버전(예: CI 3.11)에 맞춘다.  
- 계약 스냅샷: 로컬에서 `GET /openapi.json`으로 필드 검토([reference.md](reference.md)).

## 추가 참고

- 필드 표·검색 힌트·OpenAPI: [reference.md](reference.md)
