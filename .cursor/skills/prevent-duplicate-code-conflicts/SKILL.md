---
name: prevent-duplicate-code-conflicts
description: >-
  Reduces bugs from duplicated logic, overwritten settings, shadowed handlers,
  and doc–code drift. Use when adding features across layers (mobile + gateway +
  docs), refactoring shared constants, merging branches, or when the user
  mentions duplicates, conflicts, overwriting, double definition, or
  inconsistent sources of truth. Korean triggers: 중복, 충돌, 덮어쓰기,
  이중정의, SSOT, 문서 코드 불일치.
---

# 중복·덮어쓰기·충돌 방지

## 언제 적용하는가

- 동일 개념(비전 문구, 프롬프트, URL, 스키마)을 **여러 파일**에 넣을 때
- 레이어를 넘나드는 변경(클라이언트·게이트웨이·문서·인프라)을 할 때
- 머지 후 “한쪽만 반영”된 것 같을 때
- 설정·DI·라우트가 **두 번 등록**되거나 이전 구현이 남아 있을 때

## 원인 유형 (짧게 분류)

| 유형 | 증상 | 흔한 원인 |
|------|------|-----------|
| **이중 구현** | 같은 검증·매핑이 두 곳에 있고 한쪽만 수정 | 복붙, 레이어 간 책임 미분리 |
| **덮어쓰기** | 나중 로드되는 설정/미들웨어가 앞선 것을 무시 | import 순서, 전역 상태, env 중복 키 |
| **이름·키 충돌** | 라우트/이벤트/리듀서가 같은 키로 등록 | 네이밍 규칙 없음, 자동 등록 스캔 중복 |
| **드리프트** | 문서·상수·API 응답이 서로 다른 “진실” | SSOT 없이 수동 동기화 |

## 예방 원칙

1. **단일 진실 공급원(SSOT)**  
   - 한 도메인 개념은 **한 모듈** 또는 **생성된 스키마**에서만 정의한다. (예: 이 레포의 `app/product_vision.py` — 다른 프로젝트는 팀이 정한 **단일 상수·도메인 패키지**에 해당.) 나머지는 import·참조·빌드 단계로 전파한다.  
   - 불가피한 복제(모바일·서버)면 **동기화 규칙**을 문서에 명시하고(누가 주인인지), 변경 시 **같은 PR**에서 양쪽을 묶는다.

2. **소유권·경계**  
   - “이 타입/검증은 **어느 레이어가 주인**인지” 한 줄로 적는다(폴더 README 또는 모듈 docstring).  
   - 게이트웨이가 주인이면 클라이언트는 **표현만**; 반대로 로컬 전용이면 서버에 같은 이름의 필드를 두지 않는다.

3. **계약 고정**  
   - API는 OpenAPI/스키마 클래스로 **한곳** 정의; 클라이언트는 생성 클라이언트 또는 공유 패키지로 소비.  
   - 상수·enum은 **공유 패키지** 또는 **서버의 구성/비전 등 단일 JSON 엔드포인트**(이 레포 예: `GET /v1/product-vision`)로 맞춘다.

4. **삭제가 완료의 일부**  
   - 새 구현 추가 시 **옛 코드 경로를 같은 변경에서 제거**하거나, 플래그로 분기하면 제거 일정을 이슈에 남긴다.  
   - “주석 처리만 남기기”는 충돌·혼동을 낳으므로 피한다.

5. **머지·리뷰 시 의도적 검색**  
   - 변경한 심볼·문자열로 **전역 검색**해 중복 정의가 없는지 확인한다.  
   - `TODO`/`FIXME`로 남긴 **대체 구현**이 있는지 검색한다.

6. **CI로 드리프트를 잡기 (선택이지만 강력 권장)**  
   - SSOT 모듈·공개 API·문서 경로가 바뀌면, CI에서 **짧은 스크립트** 또는 `rg`/grep으로 “금지 중복 패턴”이나 “문서↔상수 키 목록”을 검증한다.  
   - 목표는 사람의 기억이 아니라 **머지 시점에 한 번이라도 실패**하게 만드는 것이다.  
   - 예시 절차·패턴: [reference.md — CI drift checks](reference.md#ci-drift-checks)

## PR·수정 직전 체크리스트

- [ ] 이 변경의 **주인 파일** 하나를 지정했는가  
- [ ] 같은 의미의 문자열/타입이 **다른 경로에 없는지** 검색했는가  
- [ ] 설정·라우트·미들웨어 **등록이 한 번만**인가 (중복 `@app.` / 이중 `use` 등)  
- [ ] 문서와 코드가 어긋나면 **문서 또는 코드 중 어느 쪽이 SSOT인지** 명시했는가  
- [ ] 브레이킹 시 **호출부 전부**를 같은 PR(또는 연속 PR)에서 갱신했는가  
- [ ] SSOT·공개 계약을 건드렸다면 **CI 검증**(grep/스크립트)을 추가했거나 기존 검증을 갱신했는가  

## 충돌·이상 징후 발견 시 순서

1. **재현 경로**와 **어느 “진실”이 맞는지** 한 문장으로 고정한다.  
2. `git log -p -- 경로`로 **언제 분기**됐는지 본다.  
3. SSOT 한 곳으로 **몰아넣고** 나머지는 thin wrapper 또는 삭제한다.  
4. 회귀 방지를 위해 **해당 경로에 테스트** 또는 **스키마 검증**을 추가한다.

## 에이전트가 코드를 쓸 때 지킬 것

- 새 상수·프롬프트·비전 문구를 추가할 때: **프로젝트의 단일 도메인/상수 모듈**(이 레포: `app/product_vision.py` 등)이 있는지 먼저 확인하고, 있으면 거기만 수정한다.  
- “문서에도 적고 코드에도 적는” 이중 편집이 필요하면: **코드(또는 단일 JSON)를 SSOT**로 두고 문서는 “자동 생성” 또는 “링크만”으로 줄인다.  
- drive-by로 **비슷한 이름의 새 파일**을 만들지 않는다; 기존 모듈 확장을 우선한다.

## 적용하지 않는 것이 나은 경우

- **일회성 스크립트·로컬 PoC**만 건드릴 때 — SSOT 강제는 팀 낭비가 될 수 있다.  
- **완전히 독립된 데모 폴더**에서 문서·CI와 무관하게 실험할 때.  
- **벤더 생성 코드** 전체를 통째로 넣을 때 — 대신 “수정 금지 영역” 주석과 경계만 문서화한다.

## 한계 (이 스킬이 덜 다루는 것)

- **동시 실행·멱등·순서 보장**으로 생기는 “논리적 이중 처리”는 별도 설계가 필요하다.  
- **여러 서비스 간 계약**은 소비자 주도 테스트·스키마 레지스트리까지 확장해야 한다.  
- **바이너리·생성물** 동기화(이미지, 로컬라이즈 테이블)는 텍스트 SSOT 검사만으로는 부족할 수 있다.

## 추가 참고

- 체크리스트·`rg` 패턴·감사 템플릿: [reference.md](reference.md)  
- 토큰 스킬 거버넌스: [token-skills-governance](../token-skills-governance/SKILL.md)  
- 형제 스킬: [mobile-genai-local-dev](../mobile-genai-local-dev/SKILL.md) · [gateway-api-contract](../gateway-api-contract/SKILL.md) · [gateway-test-hygiene](../gateway-test-hygiene/SKILL.md) · [genai-gateway-safety-review](../genai-gateway-safety-review/SKILL.md) · [observability-log-fields](../observability-log-fields/SKILL.md) · [release-mobile-template](../release-mobile-template/SKILL.md) · [monorepo-change-blast-radius](../monorepo-change-blast-radius/SKILL.md) · [infra-terraform-touch](../infra-terraform-touch/SKILL.md) · [prompt-versioning-flags](../prompt-versioning-flags/SKILL.md) · [incident-gateway-playbook](../incident-gateway-playbook/SKILL.md) · [mobile-chat-client-integration](../mobile-chat-client-integration/SKILL.md) · [ios-android-parity-check](../ios-android-parity-check/SKILL.md) · [docs-plan-sync-1-1](../docs-plan-sync-1-1/SKILL.md) · [dependency-upgrade-gateway](../dependency-upgrade-gateway/SKILL.md)
