# 제품 비전(1-1) 개선 추천 5가지

`docs/plan/01-01-product-vision.md` 분석을 바탕으로 한 실행 권장 사항이다. 아래 항목은 **문서·산출물**로 반영했으며, 게이트웨이 기본 시스템 프롬프트는 비전과 정합되도록 코드에서 맞춘다.

## 1. 산출물 전용 파일과 1-1 연결

- **내용:** 한 줄 비전·반복 시나리오는 계획 본문과 분리해 `docs/product/`에 두고, `01-01`에서는 링크만 유지한다.
- **적용:** [product-vision-one-liner.md](product-vision-one-liner.md), [recurring-scenarios.md](recurring-scenarios.md), [01-01-product-vision.md](../plan/01-01-product-vision.md) 상단 링크.

## 2. 템플릿 스코프와 맞는 기본 한 줄

- **내용:** 예시가 코치/튜터만 있으면 일반 “개인 어시스턴트” 템플릿과 어긋날 수 있으므로, 이 저장소 기본 한 줄을 **기능 나열이 아닌 하루 속 행동**으로 적는다.
- **적용:** [product-vision-one-liner.md](product-vision-one-liner.md)의 “이 템플릿 기본안”.

## 3. 반복 시나리오 공통 필드

- **내용:** 각 시나리오에 `사용 주기` · `트리거` · `첫 행동` · `성공 상태`를 고정하면 이후 MVP·UX(2-1, 2-2)로 내려가기 쉽다.
- **적용:** [recurring-scenarios.md](recurring-scenarios.md) 표 형식.

## 4. “매일 1회” 예외 규칙

- **내용:** 제품 성격에 따라 주간·업무 단위가 맞을 수 있으므로, **명시적 사용 주기**(예: 주 3회 이상)를 허용하는 문구를 둔다.
- **적용:** [product-vision-one-liner.md](product-vision-one-liner.md)의 “사용 주기” 절.

## 5. 비전 검증 체크리스트

- **내용:** 한 줄·시나리오가 “충분한지” 판단할 짧은 질문 세트를 두어 리뷰·반복에 쓴다.
- **적용:** [vision-validation-checklist.md](vision-validation-checklist.md).
