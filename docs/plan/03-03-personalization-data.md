# 3-3. 개인화 데이터 전략

**단계:** 3. 모델·프롬프트·데이터 설계 (G~I) — 품질·안정성·비용

**산출물:**

- [개인화·데이터 경계 표](../product/personalization-data-spec.md#personalization-data-spec)

**선행:** [3-2 프롬프트·시스템](03-02-prompt-system.md) · [프롬프트 요약](../product/prompt-system-spec.md#prompt-system-spec)에서 **시스템·전처리**를 정한 뒤, 어떤 데이터가 프롬프트에 **주입**되는지 맞춘다.

## 원칙

- 기기 내 저장(온디바이스) vs 서버 저장(클라우드) 기준을 **민감도**(개인정보/취향/로그)로 나눠 정의한다.  
- “데이터 **삭제** / **보내기(Export)**” 플로우를 필수로 설계한다. MVP에서 Export를 안 하면 산출물에 **N/A**와 이유를 적는다.

## 상위·하위 정렬

- [2-1 MVP](02-01-mvp-scope.md)·[Product Scope V1](../product-scope.md#v1-mvp-scope): 후순위로 밀 **프로필·RAG**가 표에 **몰래 들어오지 않았는가?**  
- [비기능 목표](../product/non-functional-targets.md): 삭제·비식별과 **모순** 없는가?  
- [5-1 API·LLM 프록시](05-01-api-llm-proxy.md): 로그에 남는 필드와 **모순** 없는가?

## 다음 단계

- [4-1 앱 구조](04-01-mobile-app-structure.md): 로컬 저장소·동기화 UI가 데이터 정책과 **맞는지** 본다.

## 완료 체크

- [ ] 민감도별 **온디바이스 vs 서버**가 표에 적혀 있는가  
- [ ] 삭제·Export(또는 N/A)가 **한 경로**로 설명되는가  
- [ ] [personalization-data-spec.md](../product/personalization-data-spec.md)가 **같은 PR**에서 갱신되었는가  
- [ ] 3-2·비기능·5-1과 **한 번** 대조했는가
