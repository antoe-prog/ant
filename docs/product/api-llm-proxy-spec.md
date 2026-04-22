# API·LLM 프록시 (5-1 산출물)

[5-1 계획](../plan/05-01-api-llm-proxy.md)과 [boundaries](../architecture/boundaries.md)를 맞춘다. 구현: `services/gateway`.

<a id="api-llm-proxy-spec"></a>

## 원칙

- 모바일이 **공급자 API 키로 LLM을 직접** 호출하지 않는다.  
- 모든 LLM 호출은 **게이트웨이**를 경유한다.

## 로그·필드 (목표)

요청 단위로 아래를 **남기는 것을 목표**로 한다. 미구현 필드는 **N/A**로 표시하고 이슈로 남긴다.

| 필드 | 설명 |
|------|------|
| user_id (해시) | 사용자 식별 |
| session_id | 대화 세션 |
| 프롬프트 길이 | 토큰 또는 문자 수 |
| 응답 시간 | LLM 구간 또는 E2E |
| 에러 코드 | HTTP·공급자 코드 |

현재 미들웨어는 `request_id`, `path`, `status_code`, `duration_ms` 등을 남긴다 — 위 표와 **같은 PR**에서 확장할 때 이 md를 갱신한다.

## 연계

- [5-2 관측](observability-spec.md#observability-spec) · [3-2 프롬프트](prompt-system-spec.md#prompt-system-spec) · [비기능](non-functional-targets.md)
