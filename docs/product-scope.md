# Product Scope

기능·시나리오별 상세는 `docs/product/`에서 파일 단위로 관리한다.

- [Product 문서 목차](product/README.md)

## 한 줄 요약

- **비전·시나리오(문서):** [한 줄 비전](product/product-vision-one-liner.md) · [반복 시나리오](product/recurring-scenarios.md) · [타깃 세분화](product/target-segments.md) · [경쟁 비교](product/competitive-comparison.md) · [차별점](product/strategic-differentiation.md) · [추천 5가지](product/vision-recommendations.md) · [첫 가치 UX 표](product/first-value-journey.md#first-value-journey) · API `GET /v1/product-vision`
- **Core:** AI 채팅, 대화 히스토리(검색·보내기), 모델·언어·응답 스타일 설정
- **NFR:** 짧은 프롬프트 p95 3초 미만, 사용자별 일일 예산, 삭제·비식별 중심 프라이버시
- **모델·비용(문서):** [LLM·모델 전략](product/llm-model-strategy.md#llm-model-strategy) (주력·백업·근거; [3-1](plan/03-01-llm-strategy.md))
- **프롬프트·전처리(문서):** [프롬프트 시스템](product/prompt-system-spec.md#prompt-system-spec) ([3-2](plan/03-02-prompt-system.md))
- **기획·운영 산출물(3-3~7-3):** [Product README — 계획 연계](product/README.md#planning-artifacts)

<a id="v1-mvp-scope"></a>

## V1 MVP·후순위 (2-1)

**기능 1개의 정의:** 사용자가 인지하는 **능력 묶음** 한 덩어리를 1개로 센다(히스토리 내 검색·공유 등은 “대화 히스토리” 1개).

**SSOT:** 위 **한 줄 요약**의 **Core**가 V1 필수 범위의 **문장 계약**이다. 아래 표의 **필수**는 Core와 **항상 같은 범위**를 표로 고정한다. Core를 바꾸면 표·[기능 스펙](product/README.md)을 **같은 PR**에서 맞춘다.

| 구분 | 내용 |
|------|------|
| **필수(5개 이내)** | **Core** 한 줄과 동일하게 둔다. 세부 동작은 [AI 채팅](product/feature-ai-chat.md) · [대화 히스토리](product/feature-conversation-history.md) · [설정](product/feature-settings.md). |
| **후순위** | 없어도 **첫 런칭** 가능한 항목만 적는다. 팀이 유지한다. _(예: 소셜 로그인, 푸시 알림, 멀티 프로필 — 필요 없으면 삭제)_ |
| **횡단** | 성능·예산·프라이버시·관측은 “기능 5개”와 **섞지 않는다.** 정의·목표는 [비기능 목표](product/non-functional-targets.md) 및 [5-x](plan/05-02-observability.md) 등에서 다룬다. **최소 관측**(핵심 오류·지연)·**장애 시 사용자 안내**는 기능 수에 넣지 않되, 팀이 정하면 **V1 출격 조건**으로 비기능·운영 문서에 명시한다. |

계획 절차: [2-1 MVP 범위](plan/02-01-mvp-scope.md) · [2-2 UX](plan/02-02-ux-journey.md) · [첫 가치 표](product/first-value-journey.md#first-value-journey).
