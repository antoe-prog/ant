---
name: genai-gateway-safety-review
description: >-
  Short security and privacy pass for GenAI gateway changes: prompts, logging,
  secrets masking, rate limits, budgets, and error messages. Use when editing
  prompt_registry, chat_service, provider_adapter, security utils, or adding
  new LLM routes. Korean: 보안, 프라이버시, 로그, 마스킹, 프롬프트 주입.
---

# GenAI 게이트웨이 — 안전·프라이버시 리뷰

## 관련 스킬

- SSOT·중복: [prevent-duplicate-code-conflicts](../prevent-duplicate-code-conflicts/SKILL.md)  
- 프롬프트 버전·플래그: [prompt-versioning-flags](../prompt-versioning-flags/SKILL.md)  
- 로그 필드 표준: [observability-log-fields](../observability-log-fields/SKILL.md)

## 빠른 질문 목록

- [ ] 사용자 원문·프롬프트가 **로그에 평문**으로 남지 않는가 (정책에 맞는지)?  
- [ ] `mask_secrets` 등 **비밀·토큰**이 응답/로그로 새지 않는가?  
- [ ] 시스템 프롬프트에 **사용자 입력이 비가공으로 붙지** 않는가 (인젝션·탈옥 완화)?  
- [ ] **속도 제한·일일 예산** 우회 경로(다른 엔드포인트, 배치)는 없는가?  
- [ ] 에러 메시지에 **내부 스택·키 이름**이 과도하게 노출되지 않는가?

## 코드 앵커 (이 레포)

- 마스킹: `services/gateway/app/utils/security.py` (`mask_secrets`)  
- 채팅 파이프라인: `services/gateway/app/services/chat_service.py` (`generate`)  
- 시스템 프롬프트: `services/gateway/app/services/prompt_registry.py`  
- 제공자 호출: `services/gateway/app/services/provider_adapter.py`

## OWASP LLM / GenAI와의 대응(요약)

| 위험 | 이 템플릿에서 볼 곳 |
|------|---------------------|
| 프롬프트 인젝션·탈옥 | 사용자 텍스트가 시스템 지시를 덮지 않는지, `chat_service` 조합 순서 |
| 과다 권한·도구 남용 | (도구 연동 시) 호출 전 검증·허용 목록 |
| 민감정보 노출 | 로그·`ChatResponse.answer`·에러 바디 |
| 비용 남용 | `rate_limiter`, `budget_guard` 우회 경로 |

## 로그에 전문이 꼭 필요할 때 (예외)

- **기본 거부**가 원칙. 불가피하면: (1) 보안·법무 승인 (2) **길이 상한·해시/샘플링** (3) 보존 기간·접근 통제·삭제 절차를 문서에 명시.

## 변경 유형별

| 영역 | 주의 |
|------|------|
| 새 provider | 타임아웃, 재시도, 키 보관 위치 |
| 프롬프트 | 금지 행동·출력 형식·역할 고정 |
| 메모리/세션 | 타 사용자 세션 혼선 없음 |

## 에이전트 지침

- “편의상 로그에 전체 프롬프트” 류는 **기본 거부**; 필요 시 마스킹·길이 제한·샘플링만 제안한다.  
- 규제·팀 정책이 있으면 그에 맞춰 체크리스트를 덧붙인다.

## 추가 참고

- 심화 체크리스트: [reference.md](reference.md)
