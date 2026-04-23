---
name: release-mobile-template
description: >-
  Release checklist for this template: gateway tests, mobile internal builds,
  API base URL per environment, changelog and docs. Use when shipping a version,
  internal testflight-style build, or "release checklist". Korean: 릴리스,
  배포, 내부 빌드, 체크리스트.
---

# 모바일 GenAI 템플릿 — 릴리스

## 관련 스킬

- SSOT·중복: [prevent-duplicate-code-conflicts](../prevent-duplicate-code-conflicts/SKILL.md)  
- API 계약: [gateway-api-contract](../gateway-api-contract/SKILL.md)

## 문서 진입점

- [docs/release-checklist.md](../../../docs/release-checklist.md) → [docs/release/README.md](../../../docs/release/README.md)

## 권장 순서

1. **Quality gates** — [quality-gates.md](../../../docs/release/quality-gates.md)  
   - 게이트웨이 테스트, 린트, 보안 스캔(팀 도구), p95 목표(정의된 경우).

2. **Mobile delivery** — [mobile-delivery.md](../../../docs/release/mobile-delivery.md)  
   - iOS/Android 내부 빌드, **API base URL**이 대상 환경을 가리키는지.

3. **Documentation** — [documentation.md](../../../docs/release/documentation.md)  
   - 환경 변수, 아키텍처, `CHANGELOG.md`.

## 버전·태그

- 템플릿이면 **semantic version** 또는 날짜 태그 팀 규칙을 따른다.  
- **정합성:** `services/gateway/app/main.py`의 `FastAPI(..., version="…")` ↔ `CHANGELOG.md` 헤더 ↔ Git 태그(예: `v0.1.0`)를 릴리스 전에 한 줄로 대조한다.

## 에이전트 지침

- 릴리스 PR에는 **체크리스트 복사** 또는 링크로 완료 항목을 남긴다.  
- 브레이킹 API 변경 시 `docs/architecture.md` 또는 제품 문서를 같은 PR에서 갱신한다.

## 추가 참고

- 스토어 제출 전 수동 스모크: [reference.md](reference.md)
