# 개인 모바일 생성형 AI 앱 템플릿 A–Z 실행 계획

단계별 상세는 아래 파일로 나누어 두었다. 편집할 때는 해당 번호만 열면 된다.

## 1. 전략 수립 (A~C)

- [1-1 제품 비전](01-01-product-vision.md) — 산출물: [한 줄 비전](../product/product-vision-one-liner.md), [시나리오](../product/recurring-scenarios.md), [검증](../product/vision-validation-checklist.md), [차별점](../product/strategic-differentiation.md), `GET /v1/product-vision`
- [1-2 핵심 타깃 세분화](01-02-target-segmentation.md) — 산출물: [타깃 세그먼트](../product/target-segments.md) (비전·S1~S3 정렬 열 포함)
- [1-3 차별화 포인트](01-03-differentiation.md) — 산출물: [경쟁 비교](../product/competitive-comparison.md), [전략적 차별점](../product/strategic-differentiation.md), `DIFFERENTIATION` / `GET /v1/product-vision`

## 2. 제품 스펙·아키텍처 (D~F)

- [2-1 MVP 범위](02-01-mvp-scope.md) — 산출물: [Product Scope V1·후순위](../product-scope.md#v1-mvp-scope), 기능 스펙 `feature-*`, [비기능](../product/non-functional-targets.md)
- [2-2 UX 플로우](02-02-ux-journey.md) — 산출물: [첫 실행~첫 가치 표](../product/first-value-journey.md#first-value-journey)
- [2-3 기술 아키텍처 초안](02-03-tech-architecture-draft.md) — 산출물: [모듈 표](../architecture/draft-module-matrix.md#draft-module-matrix), [diagram·boundaries](../architecture.md)

## 3. 모델·프롬프트·데이터 (G~I)

- [3-1 LLM·모델 전략](03-01-llm-strategy.md) — 산출물: [모델 전략 표](../product/llm-model-strategy.md#llm-model-strategy), 게이트웨이 `ChatRequest`·`/v1/models`
- [3-2 프롬프트·시스템](03-02-prompt-system.md) — 산출물: [프롬프트 시스템](../product/prompt-system-spec.md#prompt-system-spec), `DEFAULT_SYSTEM_PROMPT`·`prompt_registry.py`
- [3-3 개인화 데이터](03-03-personalization-data.md) — 산출물: [데이터 경계](../product/personalization-data-spec.md#personalization-data-spec)

## 4. 모바일 앱·UI (J~L)

- [4-1 앱 구조](04-01-mobile-app-structure.md) — 산출물: [앱 구조·네비](../product/mobile-app-structure-spec.md#mobile-app-structure-spec)
- [4-2 핵심 UI](04-02-core-ui.md) — 산출물: [핵심 UI](../product/core-ui-spec.md#core-ui-spec)
- [4-3 성능·접근성](04-03-performance-accessibility.md) — 산출물: [성능·a11y](../product/performance-accessibility-spec.md#performance-accessibility-spec)

## 5. 백엔드·관측 (M~O)

- [5-1 API·LLM 프록시](05-01-api-llm-proxy.md) — 산출물: [프록시·로그](../product/api-llm-proxy-spec.md#api-llm-proxy-spec), `services/gateway`
- [5-2 관측·알림](05-02-observability.md) — 산출물: [관측](../product/observability-spec.md#observability-spec), [Alerts](../operations/alerts.md)
- [5-3 배포·롤백](05-03-deploy-rollback.md) — 산출물: [배포·롤백](../product/deploy-rollback-spec.md#deploy-rollback-spec)

## 6. 품질·실험 (P~R)

- [6-1 테스트 전략](06-01-testing-strategy.md) — 산출물: [테스트 전략](../product/testing-strategy-spec.md#testing-strategy-spec), `pytest`·OpenAPI
- [6-2 로그 분석](06-02-log-analytics.md) — 산출물: [로그 KPI](../product/log-analytics-spec.md#log-analytics-spec)
- [6-3 A/B·프롬프트 실험](06-03-ab-prompt-experiments.md) — 산출물: [A/B·실험](../product/ab-prompt-experiments-spec.md#ab-prompt-experiments-spec)

## 7. 출시·운영 (S~Z)

- [7-1 소프트 런칭](07-01-soft-launch.md) — 산출물: [소프트 런칭](../product/soft-launch-spec.md#soft-launch-spec), [Incident](../operations/incident-response.md)
- [7-2 피드백 루프](07-02-feedback-loop.md) — 산출물: [피드백 루프](../product/feedback-loop-spec.md#feedback-loop-spec)
- [7-3 고도화·비즈니스](07-03-growth-monetization.md) — 산출물: [성장·수익](../product/growth-monetization-spec.md#growth-monetization-spec)

## 8. 반복 검증

- [5회 반복 검증 방식](08-five-iterations.md)
