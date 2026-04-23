# 6-1. 테스트 전략

**단계:** 6. 품질 검증·실험 (P~R) — QA·로그·실험

**산출물:**

- [테스트 전략 표](../product/testing-strategy-spec.md#testing-strategy-spec)

## 모바일

- **단위 테스트:** 핵심 로직(ViewModel·파서 등).  
- **e2e:** 로그인·가입이 **V1 필수**일 때만 “가입→첫 사용→재방문”. 그렇지 않으면 **[첫 가치 여정](../product/first-value-journey.md)** 기준으로 **첫 실행→첫 가치→재방문**을 적는다.

## LLM

- 대표 프롬프트 세트에 대한 **자동/반자동** 평가 스크립트를 둔다. 없으면 산출물에 **N/A**.

## 상위·하위 정렬

- [5-3 배포](05-03-deploy-rollback.md): 스모크가 **롤백 조건**과 맞는가?  
- `services/gateway` — `pytest`·OpenAPI 테스트가 CI에 있는가?

## 다음 단계

- [6-2 로그 분석](06-02-log-analytics.md): 테스트가 깨지면 **어느 KPI**가 먼저 반응하는지 정한다.

## 완료 체크

- [ ] e2e 전제가 **MVP·첫 가치 표**와 맞는가  
- [ ] [testing-strategy-spec.md](../product/testing-strategy-spec.md)가 **같은 PR**에서 갱신되었는가  
- [ ] 게이트웨이 CI와 **한 번** 대조했는가
