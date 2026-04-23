# 2-3. 기술 아키텍처 초안

**단계:** 2. 제품 스펙·아키텍처 설계 (D~F) — 요구사항·경험·구조

**산출물:**

- [모듈 초안 표](../architecture/draft-module-matrix.md#draft-module-matrix) (독립 배포·스케일링·이 레포 경로)
- 다이어그램·경계: [Architecture](../architecture.md) · [system-diagram](../architecture/system-diagram.md) · [boundaries](../architecture/boundaries.md)

## 모듈 쪼개기 (기본 원칙)

- **클라이언트(모바일), API 게이트웨이, LLM 호출 경로, 데이터 스토어, 관측**으로 나누어 본다.  
- **이 템플릿:** **LLM 프록시는 API 게이트웨이와 별 박스로 두지 않고**, 게이트웨이 **내부 책임**으로 둔다(분리 시 산출물 표에 **행 추가**).  
- **벡터 DB / 추가 스토리지**는 RAG·개인화가 **V1 이후**면 표에서 **N/A**로 두거나 행 자체를 삭제한다.
- **운영 Admin:** PC·안드로이드 브라우저로 접근하는 **반응형 웹** 한 벌(`apps/admin-web`)이 합리적 기본선이다. 전용 데스크톱 프로그램은 요구가 증명된 뒤에만 고려한다. Admin은 게이트웨이 HTTPS API를 호출하며, 로컬 개발 시 CORS는 `CORS_ALLOW_ORIGINS`·기본 `localhost:5173`으로 맞춘다.

## 각 모듈 메모

- **독립 배포 가능 여부:** 롤백·릴리스 단위가 분리되는지.  
- **스케일링(수평/수직):** 트래픽 증가 시 **인스턴스 추가** vs **단일 노드 업그레이드** 등 한 줄로 적는다. MVP에서는 과도한 수치 목표는 피한다.

## 상위·하위 정렬

- [2-2 UX](02-02-ux-journey.md)·[첫 가치 표](../product/first-value-journey.md): 여정에 나온 **API·데이터**가 표의 모듈과 **대응**되는가?  
- [2-1 MVP](02-01-mvp-scope.md)·[Product Scope V1](../product-scope.md#v1-mvp-scope): **후순위**로 밀린 모듈이 표에 **몰래 들어오지 않았는가?**  
- [5-1 API·LLM 프록시](05-01-api-llm-proxy.md): 모바일 **직접 LLM 호출 금지**·로그 필드가 경계와 **모순 없는가?**  
- [5-2 관측](05-02-observability.md)·[비기능](../product/non-functional-targets.md): **V1 게이트**로 잡은 최소 관측이 모듈 표·운영 문서와 **맞는가?**

## 다음 단계

- [3-1 LLM·모델 전략](03-01-llm-strategy.md), [3-3 개인화 데이터](03-03-personalization-data.md): 벡터·스토리지 행을 **채울지** 결정한다.  
- [4-1 앱 구조](04-01-mobile-app-structure.md): 클라이언트 행과 **네비·상태**가 맞는지 본다.

## 완료 체크

- [ ] 표에 **게이트웨이 vs LLM 경로**가 이 템플릿 기본선(**게이트웨이 내**)으로 **명확**한가  
- [ ] **벡터 DB** 미사용 시 **N/A** 또는 행 삭제로 **오해**가 없는가  
- [ ] [system-diagram](../architecture/system-diagram.md)·[boundaries](../architecture/boundaries.md)와 **모순**이 없는가  
- [ ] [draft-module-matrix.md](../architecture/draft-module-matrix.md)가 **같은 PR**에서 갱신되었는가  
- [ ] 2-2·2-1·5-1·비기능과 **한 번** 대조했는가
