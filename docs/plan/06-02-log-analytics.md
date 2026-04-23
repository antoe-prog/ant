# 6-2. 로그 기반 분석

**단계:** 6. 품질 검증·실험 (P~R) — QA·로그·실험

**산출물:**

- [로그·분석 KPI](../product/log-analytics-spec.md#log-analytics-spec)

## KPI

- **첫 세션** 내 핵심 행동 도달률(예: 첫 답변 수신까지)을 기본 KPI로 설정한다.  
- 세션당 요청 수, 재방문 일수, **유료 전환 경로**는 [7-3](07-03-growth-monetization.md)과 **같은 정의**를 쓰거나 MVP에서 **N/A**.

## 상위·하위 정렬

- [2-2 UX](02-02-ux-journey.md)·[첫 가치 표](../product/first-value-journey.md): KPI가 **같은 단계**를 가리키는가?  
- [5-1](05-01-api-llm-proxy.md)·[5-2](05-02-observability.md): 로그·메트릭 **필드**가 맞는가?

## 다음 단계

- [6-3 A/B·프롬프트 실험](06-03-ab-prompt-experiments.md): KPI를 **실험 지표**로 재사용한다.

## 완료 체크

- [ ] KPI 정의에 **출처**(이벤트·로그)가 있는가  
- [ ] [log-analytics-spec.md](../product/log-analytics-spec.md)가 **같은 PR**에서 갱신되었는가  
- [ ] 5-1·5-2·2-2와 **한 번** 대조했는가
