# 5-1. API·LLM 프록시

**단계:** 5. 백엔드·MLOps·관측 (M~O) — 안정 운영

**산출물:**

- [API·LLM 프록시 요약](../product/api-llm-proxy-spec.md#api-llm-proxy-spec)
- 구현: `services/gateway` (예: `ChatRequest`, 미들웨어 로깅)

## 원칙

- 모바일에서 직접 LLM을 호출하지 않고, **서버 측 프록시**(게이트웨이)를 둔다.  
- 요청 로그에 **user_id 해시, 세션ID, 프롬프트 길이, 응답 시간, 에러 코드**를 남기는 것을 **목표**로 한다 — 미구현은 산출물에 **N/A**.

## 상위·하위 정렬

- [2-3 아키텍처](02-03-tech-architecture-draft.md)·[boundaries](../architecture/boundaries.md): **직접 호출 금지**와 모순 없는가?  
- [3-2 프롬프트](03-02-prompt-system.md): 전처리·길이 제한과 **맞는가?**  
- [5-2 관측](05-02-observability.md): 메트릭·알림과 **필드 이름**이 맞는가?

## 다음 단계

- [5-2 관측·알림](05-02-observability.md): 수집·알림 룰을 연결한다.

## 완료 체크

- [ ] 산출물 표의 필드가 **구현 또는 N/A**로 채워졌는가  
- [ ] [api-llm-proxy-spec.md](../product/api-llm-proxy-spec.md)가 **같은 PR**에서 갱신되었는가  
- [ ] boundaries·3-2와 **한 번** 대조했는가
