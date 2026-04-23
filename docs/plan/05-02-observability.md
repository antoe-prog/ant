# 5-2. 관측·알림 연동

**단계:** 5. 백엔드·MLOps·관측 (M~O) — 안정 운영

**산출물:**

- [관측·알림 요약](../product/observability-spec.md#observability-spec) · [Alerts](../operations/alerts.md)

## 메트릭

- 요청 수, 에러율, p95 지연, 토큰 소비량을 **기본**으로 수집한다. 토큰 소비가 **아직 없으면 N/A** 명시.

## 알림

- 5xx 비율 / LLM 실패율 / 일일 예산 기준으로 [alerts.md](../operations/alerts.md) 룰과 **연결**한다.  
- [2-1 V1 게이트](../product-scope.md#v1-mvp-scope)에 최소 관측을 넣었다면 여기·운영 문서에 **반영**한다.

## 상위·하위 정렬

- [5-1 API·LLM 프록시](05-01-api-llm-proxy.md): 로그 필드와 **모순** 없는가?  
- [비기능 목표](../product/non-functional-targets.md): 예산·지연과 **맞는가?**

## 다음 단계

- [5-3 배포·롤백](05-03-deploy-rollback.md): 릴리스와 알림 **에스컬레이션**을 맞춘다.

## 완료 체크

- [ ] 메트릭·알림 표가 **alerts.md**와 같은 주장을 하는가  
- [ ] [observability-spec.md](../product/observability-spec.md)가 **같은 PR**에서 갱신되었는가  
- [ ] 5-1·비기능과 **한 번** 대조했는가
