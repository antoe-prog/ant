---
name: observability-log-fields
description: >-
  Standard log/metric field names for the gateway: request_id, user hash,
  latency, provider. Use when editing middleware, chat_service logging, or
  alerts docs. Korean: 로그 필드, 메트릭, 관측.
---

# 관측 — 로그·메트릭 필드 표준

## 관련 스킬

- 안전·마스킹: [genai-gateway-safety-review](../genai-gateway-safety-review/SKILL.md)  
- 운영: [incident-gateway-playbook](../incident-gateway-playbook/SKILL.md)

## 권장 필드 (게이트웨이)

| 필드 | 용도 |
|------|------|
| `request_id` | 추적·사용자 메시지와 분리 |
| `user_id` | 가능하면 **해시**만 저장 |
| `session_id` | 대화 단위 |
| `latency_ms` / `provider` / `model` | SLO·알림 |
| `prompt_chars` 또는 해시 | 원문 대신 길이·지문 |

## 문서 연동

- 알림 룰: [docs/operations/alerts.md](../../../docs/operations/alerts.md) 와 필드 이름을 맞춘다.
