---
name: docs-plan-sync-1-1
description: >-
  Keeps product plan docs (docs/plan/01-01, 01-02, 01-03, docs/product) in sync
  with app/product_vision.py and scripts/check_ssot_docs.py. Use when editing
  01-01 through 01-03 plan files, product-vision-one-liner.md,
  recurring-scenarios.md, target-segments.md, competitive-comparison.md, or
  strategic-differentiation.md, or docs/plan/02-01-mvp-scope.md /
  docs/product-scope.md (V1·후순위), docs/plan/02-02-ux-journey.md /
  docs/product/first-value-journey.md, docs/plan/02-03-tech-architecture-draft.md /
  docs/architecture/draft-module-matrix.md,   docs/plan/03-01-llm-strategy.md /
  docs/product/llm-model-strategy.md,   docs/plan/03-02-prompt-system.md /
  docs/product/prompt-system-spec.md, docs/plan/03-03 through 07-03 and matching
  docs/product/*-spec.md (personalization, mobile, core-ui, performance, api-llm-proxy,
  observability, deploy-rollback, testing, log-analytics, ab-prompt, soft-launch,
  feedback-loop, growth-monetization). Korean: 비전 문서, 1-1~1-3, 2-1~2-3, 3-1~7-3, SSOT 동기화.
---

# 1-1·1-2·1-3 기획 문서 ↔ 코드 동기화 (+ 2-1 MVP · 2-2 UX · 2-3 · 3-1~7-3)

## 관련 스킬

- SSOT·`rg` 패턴: [prevent-duplicate-code-conflicts](../prevent-duplicate-code-conflicts/SKILL.md)  
- 영향 범위: [monorepo-change-blast-radius](../monorepo-change-blast-radius/SKILL.md)

## SSOT

- 런타임·API: `services/gateway/app/product_vision.py`  
- 검증: `services/gateway/scripts/check_ssot_docs.py` (CI에서 실행)  
- 문서: `docs/product/product-vision-one-liner.md`, `recurring-scenarios.md`, `target-segments.md`, `competitive-comparison.md`, `strategic-differentiation.md`, `docs/plan/01-01-product-vision.md`, `docs/plan/01-02-target-segmentation.md`, `docs/plan/01-03-differentiation.md`  
- **1-2·`target-segments.md`**, **1-3·`competitive-comparison.md`**는 코드 SSOT에 없음 — 비전·S1~S3·`DIFFERENTIATION`과 **모순 없이** 표·문장만 맞춘다.

## `01-01-product-vision.md` Step ↔ 산출물 파일

| Step / 항목 | 주로 편집하는 파일 |
|---------------|-------------------|
| Step 1 한 줄 비전 | [product-vision-one-liner.md](../../../docs/product/product-vision-one-liner.md) + `ONE_LINER` in code |
| Step 2 시나리오 | [recurring-scenarios.md](../../../docs/product/recurring-scenarios.md) + `SCENARIOS` |
| 핵심 산출물·차별점 | [strategic-differentiation.md](../../../docs/product/strategic-differentiation.md) + `DIFFERENTIATION` |
| 검증·추천 문서 | `vision-validation-checklist.md`, `vision-recommendations.md` (코드 SSOT 아님) |

## 1-2 타깃 ↔ 비전·시나리오

| 항목 | 파일 |
|------|------|
| 1-2 계획 본문 | [01-02-target-segmentation.md](../../../docs/plan/01-02-target-segmentation.md) |
| 세그먼트·정렬 열 | [target-segments.md](../../../docs/product/target-segments.md) |

`target-segments`의 **비전·시나리오 정렬** 열이 `ONE_LINER`·`SCENARIOS`와 어긋나면 `product_vision.py` 또는 시나리오 md를 먼저 고친다.

## 1-3 차별화 ↔ 비전·타깃·시나리오

| 항목 | 파일 |
|------|------|
| 1-3 계획 본문 | [01-03-differentiation.md](../../../docs/plan/01-03-differentiation.md) |
| 경쟁 3사 표 | [competitive-comparison.md](../../../docs/product/competitive-comparison.md) |
| 경험 차별·강점 표 | [strategic-differentiation.md](../../../docs/product/strategic-differentiation.md) |

차별 문구가 [1-1 비전](../../../docs/product/product-vision-one-liner.md)·[1-2 타깃](../../../docs/product/target-segments.md)·S1~S3와 모순이면 **비전·세그먼트·시나리오**를 먼저 고친 뒤 차별 md·`DIFFERENTIATION`을 맞춘다.

## 2-1 MVP ↔ `product-scope.md`

| 항목 | 파일 |
|------|------|
| 2-1 계획 본문 | [02-01-mvp-scope.md](../../../docs/plan/02-01-mvp-scope.md) |
| V1 필수·후순위·횡단 | [product-scope.md](../../../docs/product-scope.md#v1-mvp-scope) |

- **Core** 한 줄이 V1 필수의 **문장 SSOT**다. 바꿀 때 **필수** 표·[feature 스펙](../../../docs/product/README.md)을 **같은 PR**에서 맞춘다.  
- **최소 관측·장애 시 UX**는 기능 5개 밖이지만 **V1 게이트**에 넣을 수 있다 — [비기능](../../../docs/product/non-functional-targets.md)·[5-2 관측](../../../docs/plan/05-02-observability.md) 등에 반영했는지 PR에서 확인한다.  
- `product_vision.py` SSOT와 직접 검증되지는 않지만, 비전·시나리오·차별 문구와 **모순**이면 1-x 쪽을 먼저 고친다.

## 2-2 UX ↔ `first-value-journey.md`

| 항목 | 파일 |
|------|------|
| 2-2 계획 본문 | [02-02-ux-journey.md](../../../docs/plan/02-02-ux-journey.md) |
| 5~7단계 표·분기 | [first-value-journey.md](../../../docs/product/first-value-journey.md#first-value-journey) |

- 여정의 **등장 기능**은 [2-1](../../../docs/plan/02-01-mvp-scope.md)·[V1 필수](../../../docs/product-scope.md#v1-mvp-scope)와 **같은 PR**에서 맞춘다. **Core**에 있는 세 레이블(`AI 채팅` · `대화 히스토리` · `모델·언어·응답 스타일 설정`) 또는 **공란**(OS 권한만 등)만—`온보딩` 등 Core에 없는 능력명을 새로 쓰지 않는다.  
- **첫 가치**로 고른 시나리오는 [recurring-scenarios.md](../../../docs/product/recurring-scenarios.md)의 S1~S3와 모순 없게 고른다.  
- **첫 세션 vs 재방문** 전제가 [02-02](../../../docs/plan/02-02-ux-journey.md)·[first-value-journey.md](../../../docs/product/first-value-journey.md)에 구분되어 있는지 PR에서 본다.  
- `check_ssot_docs.py`는 이 파일을 검사하지 않는다.

## 2-3 아키텍처 초안 ↔ `draft-module-matrix.md` · diagram

| 항목 | 파일 |
|------|------|
| 2-3 계획 본문 | [02-03-tech-architecture-draft.md](../../../docs/plan/02-03-tech-architecture-draft.md) |
| 모듈·배포·스케일링 표 | [draft-module-matrix.md](../../../docs/architecture/draft-module-matrix.md#draft-module-matrix) |
| 시각·경계 | [system-diagram.md](../../../docs/architecture/system-diagram.md), [boundaries.md](../../../docs/architecture/boundaries.md) |

- **게이트웨이**가 LLM 호출을 **내부**에서 맡는다는 기본선이 표·[mermaid](../../../docs/architecture/system-diagram.md)와 **모순 없는지** PR에서 본다.  
- **벡터 DB** 미사용이면 **N/A** 또는 행 삭제. 도입 시 [3-3](../../../docs/plan/03-03-personalization-data.md)과 같은 PR 또는 후속 이슈로 연결한다.  
- `check_ssot_docs.py`는 이 표를 검사하지 않는다.

## 3-1 LLM·모델 전략 ↔ `llm-model-strategy.md` · 게이트웨이

| 항목 | 파일 |
|------|------|
| 3-1 계획 본문 | [03-01-llm-strategy.md](../../../docs/plan/03-01-llm-strategy.md) |
| 모델 표 | [llm-model-strategy.md](../../../docs/product/llm-model-strategy.md#llm-model-strategy) |

- **주력·백업**이 표에 있고, 특수는 **N/A** 가능. [비기능](../../../docs/product/non-functional-targets.md) p95·예산과 **모순 없는지** PR에서 본다.  
- 백업이 **타 벤더**면 키·로그 필드·데이터 경계가 [5-1](../../../docs/plan/05-01-api-llm-proxy.md)·비기능과 **맞는지** [llm-model-strategy.md](../../../docs/product/llm-model-strategy.md) **비고**에 반영했는지 본다.  
- 모델 ID·허용 목록을 바꾸면 `services/gateway`(예: `ChatRequest`, `/v1/models`)와 **같은 PR**에서 맞춘다.  
- `check_ssot_docs.py`는 이 표를 검사하지 않는다.

## 3-2 프롬프트·시스템 ↔ `prompt-system-spec.md` · `DEFAULT_SYSTEM_PROMPT`

| 항목 | 파일 |
|------|------|
| 3-2 계획 본문 | [03-02-prompt-system.md](../../../docs/plan/03-02-prompt-system.md) |
| 요약·전처리 위치 | [prompt-system-spec.md](../../../docs/product/prompt-system-spec.md#prompt-system-spec) |
| 문자열 SSOT | `services/gateway/app/product_vision.py` (`DEFAULT_SYSTEM_PROMPT`), `services/gateway/app/services/prompt_registry.py` |

- 시스템 프롬프트·레지스트리 문자열을 바꾸면 [비전·차별](../../../docs/product/product-vision-one-liner.md) 및 `ONE_LINER` / `DIFFERENTIATION`과 **같은 주장**인지 PR에서 본다.  
- 전처리를 **서버·클라** 어디에 둘지 [prompt-system-spec.md](../../../docs/product/prompt-system-spec.md)와 구현이 **모순 없는지** 본다.  
- `check_ssot_docs.py`는 **비전 md ↔ `product_vision.py`**만 검사한다 — 프롬프트 본문은 **수동** 대조.

## 3-3 ~ 7-3 계획 ↔ `docs/product/*-spec.md`

| 계획 | 산출물 md |
|------|-----------|
| [03-03](../../../docs/plan/03-03-personalization-data.md) | [personalization-data-spec.md](../../../docs/product/personalization-data-spec.md#personalization-data-spec) |
| [04-01](../../../docs/plan/04-01-mobile-app-structure.md) | [mobile-app-structure-spec.md](../../../docs/product/mobile-app-structure-spec.md#mobile-app-structure-spec) |
| [04-02](../../../docs/plan/04-02-core-ui.md) | [core-ui-spec.md](../../../docs/product/core-ui-spec.md#core-ui-spec) |
| [04-03](../../../docs/plan/04-03-performance-accessibility.md) | [performance-accessibility-spec.md](../../../docs/product/performance-accessibility-spec.md#performance-accessibility-spec) |
| [05-01](../../../docs/plan/05-01-api-llm-proxy.md) | [api-llm-proxy-spec.md](../../../docs/product/api-llm-proxy-spec.md#api-llm-proxy-spec) |
| [05-02](../../../docs/plan/05-02-observability.md) | [observability-spec.md](../../../docs/product/observability-spec.md#observability-spec) |
| [05-03](../../../docs/plan/05-03-deploy-rollback.md) | [deploy-rollback-spec.md](../../../docs/product/deploy-rollback-spec.md#deploy-rollback-spec) |
| [06-01](../../../docs/plan/06-01-testing-strategy.md) | [testing-strategy-spec.md](../../../docs/product/testing-strategy-spec.md#testing-strategy-spec) |
| [06-02](../../../docs/plan/06-02-log-analytics.md) | [log-analytics-spec.md](../../../docs/product/log-analytics-spec.md#log-analytics-spec) |
| [06-03](../../../docs/plan/06-03-ab-prompt-experiments.md) | [ab-prompt-experiments-spec.md](../../../docs/product/ab-prompt-experiments-spec.md#ab-prompt-experiments-spec) |
| [07-01](../../../docs/plan/07-01-soft-launch.md) | [soft-launch-spec.md](../../../docs/product/soft-launch-spec.md#soft-launch-spec) |
| [07-02](../../../docs/plan/07-02-feedback-loop.md) | [feedback-loop-spec.md](../../../docs/product/feedback-loop-spec.md#feedback-loop-spec) |
| [07-03](../../../docs/plan/07-03-growth-monetization.md) | [growth-monetization-spec.md](../../../docs/product/growth-monetization-spec.md#growth-monetization-spec) |

- 각 계획 md의 **완료 체크**와 산출물 표가 **같은 PR**에서 갱신되었는지 본다.  
- `product_vision.py` / `check_ssot_docs.py`는 위 산출물을 **자동 검사하지 않는다.**

## `DIFFERENTIATION` ↔ `strategic-differentiation.md` (수동 동기)

CI는 자동 비교하지 않는다. PR 전에:

- [ ] 코드 `DIFFERENTIATION` 각 bullet이 md 표·본문과 **같은 주장**을 하는가 (표현만 다른 것은 OK)  
- [ ] md에만 있는 경쟁/강점 문장이 코드에 없으면 **의도적 생략인지** PR에 한 줄 메모

## `check_ssot_docs.py` 실패 시 (3단계)

1. 스크립트 stderr 메시지를 읽고 **SSOT가 코드인지 문서인지** 확정한다.  
2. `ONE_LINER` 실패면: `product_vision.py` 또는 md 인용 블록 중 **한쪽을 기준**으로 맞춘 뒤 `*` 제거 후에도 부분 문자열 일치를 확인한다.  
3. `S1` 등 id 실패면: `SCENARIOS`와 [recurring-scenarios.md](../../../docs/product/recurring-scenarios.md) 표의 **ID 열**을 동시에 수정한다.

## 변경 시 순서

1. **비즈니스 문구·시나리오**를 바꿀 주인을 정한다: 보통 `product_vision.py` 먼저.  
2. **md**를 사람이 읽기 좋게 맞춘다(표, 설명).  
3. `cd services/gateway && python scripts/check_ssot_docs.py`.  
4. 차별점은 위 **수동 동기** 체크리스트를 수행한다.

## 에이전트 지침

- `ONE_LINER`를 바꾸면 **인용 블록 안 텍스트**가 `*` 제거 후에도 부분 문자열로 일치해야 CI가 통과한다.  
- 시나리오 `id` (`S1` 등)를 바꾸면 **표와 SCENARIOS** 모두에서 바꾼다.

## 추가 참고

- 표·체크리스트 확장: [reference.md](reference.md)
