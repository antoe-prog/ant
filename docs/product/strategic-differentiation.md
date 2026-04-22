# 전략적 차별점

`docs/plan/01-01-product-vision.md` 기타 개선 및 [1-3 차별화](../plan/01-03-differentiation.md) 산출물. 경쟁 대비 **한 줄 강점**과 **근거**를 적는다. 경쟁 3사 표는 [competitive-comparison.md](competitive-comparison.md).

## 경쟁 대비 한 줄

범용 모바일 챗/검색형 앱이 **긴 답·넓은 기능**에 치우치는 반면, 이 템플릿은 **틈새 시간**에 **짧은 결론·다음 행동**과 **지난 대화 맥락 이어가기**를 한 세트로 설계한다.

## 경험 차별화 (2개 이상)

1. **짧은 답 + 다음 행동**: 이동 중·한 손 사용을 전제로, 매번 프롬프트를 다듬지 않아도 게이트웨이 기본 정책으로 **읽을 분량과 바로 할 일 한 가지**가 안정적으로 나오게 한다. ([S1](recurring-scenarios.md), [T1](target-segments.md) 정렬)
2. **맥락 이어가기**: “예전에 물어본 것”을 찾아 이어 말하는 흐름을 핵심 루프로 두어, 새 스레드만 쌓이는 경험을 줄인다. ([S2](recurring-scenarios.md), [T2](target-segments.md) 정렬)

## 이 템플릿 기본안 (요약 표)

| 구분 | 내용 |
|------|------|
| 주요 차이 | 위 **경험 차별화 2가지**를 제품·프롬프트·화면 설계의 중심에 둔다 |
| 핵심 강점 | LLM은 **게이트웨이 단일 경유**로 키·정책·로깅을 묶고, **일일 예산·속도 제한**으로 개인 사용 비용을 가드한다 |
| 런타임 연동 | `GET /v1/product-vision` JSON의 `differentiation`·`one_liner`는 `services/gateway/app/product_vision.py`와 동기화한다 |

## 작성란 (포크 시)

| 항목 | 내용 |
|------|------|
| 경쟁 대비 한 줄 | _포크 제품에 맞게 위 한 줄을 교체_ |
| 핵심 강점 2~3개 | _도메인별로 위 표·경험 차별을 수정_ |
| 의도적으로 하지 않는 것 (anti-goals) | **B2B 광고 타깃 데이터 판매 없음**, **의료·법률 최종 판단 대행 없음**(비서·초안 수준), 범용 앱과 **기능 개수 경쟁**은 하지 않음 |

## API `differentiation` 배열과의 대응

`app/product_vision.py`의 `DIFFERENTIATION` 세 문장은 위 **경험 차별 2개 + 게이트웨이·예산 가드(신뢰·리듬)** 순서와 같은 주장을 한다. 문서를 바꾸면 코드도 같은 PR에서 맞출 것.

## SSOT — `differentiation` API 원문 (`check_ssot_docs.py`)

아래 블록은 `services/gateway/app/product_vision.py`의 `DIFFERENTIATION` 항목과 **줄 단위로 동일**해야 한다. 코드를 바꾼 뒤 여기도 같은 PR에서 맞출 것.

<!-- ssot-differentiation-begin -->
틈새 시간·이동 중 사용을 전제로 짧은 결론과 바로 실행할 다음 한 가지를 기본 경험으로 둔다. (S1·비전 정렬)
지난 대화를 찾아 이어가는 맥락 복원을 핵심 루프로 두어 스레드만 쌓이는 경험을 줄인다. (S2·히스토리)
LLM은 게이트웨이 단일 경유로 키·정책·로깅을 묶고, 일일 예산·속도 제한으로 사용 리듬과 비용을 가드한다.
<!-- ssot-differentiation-end -->
