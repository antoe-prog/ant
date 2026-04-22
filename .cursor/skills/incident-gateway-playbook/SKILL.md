---
name: incident-gateway-playbook
description: >-
  Operational response for this gateway: health checks, provider fallback,
  rate limits, budget alerts, and comms. Use when production errors, 5xx spikes,
  LLM provider outages, daily budget exhaustion, or reading docs/operations.
  Korean: 장애, 인시던트, 알림, 복구.
---

# 게이트웨이 인시던트 플레이북

## 관련 스킬

- SSOT·문서: [prevent-duplicate-code-conflicts](../prevent-duplicate-code-conflicts/SKILL.md)  
- 안전·로그: [genai-gateway-safety-review](../genai-gateway-safety-review/SKILL.md)

## 문서 진입점

- [docs/operations-playbook.md](../../../docs/operations-playbook.md)  
- [Alerts](../../../docs/operations/alerts.md) · [Incident Response](../../../docs/operations/incident-response.md) · [Recovery Checklist](../../../docs/operations/recovery-checklist.md)

## 권장 순서 (요약)

1. **`/health`** 와 최근 에러 로그(가능하면 request id).  
2. **업스트림 LLM** 장애 시 fallback 모델·provider 전환(팀 절차에 따름).  
3. **남용·비용** 이슈면 임시 rate limit·예산 상한 확인.  
4. **상태 공유** — 팀 채널에 영향·ETA(Recovery 체크리스트 참고).

## 에스컬레이션 (온콜 없을 때 기본)

1. 변경한 사람 / 가장 가까운 백엔드 담당에게 스레드 남김  
2. **15분** 내 응답 없으면 채널 `@here` 또는 팀 규칙의 다음 단계  
3. 외부 업스트림 장애면 **상태 페이지 링크**와 함께 사용자 공지 문구 초안까지

## 에이전트 지침

- 코드 변경 전에 **운영 문서와 충돌하지 않는지** 확인한다.  
- 새 알림 조건을 코드에 넣으면 [alerts.md](../../../docs/operations/alerts.md)에 **한 줄** 반영한다.

## 추가 참고

- 포스트모템 질문 템플릿: [reference.md](reference.md)
