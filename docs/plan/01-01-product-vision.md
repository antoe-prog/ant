# 1-1. 제품 비전 정의

**진행 단계:**  
1. 전략 수립 A~C: 목표 설정 · 타깃 구체화 · 차별화 요소 도출

**핵심 산출물:**  
- [한 줄 비전](../product/product-vision-one-liner.md)
- [반복 시나리오](../product/recurring-scenarios.md)
- [비전 검증 체크리스트](../product/vision-validation-checklist.md)
- [전략적 차별점](../product/strategic-differentiation.md)
- [비전 개선 추천 5가지](../product/vision-recommendations.md)
- **구현:** 게이트웨이 `GET /v1/product-vision` — 위 산출물 JSON (온보딩·About 연동용)

---

### Step 1: 문제 정의 및 핵심 가치 제시
- 제품이 개인 사용자의 **일상적인 문제·불편함**을 어떻게 해결하는지, 구체적으로 한 줄로 명확하게 정의합니다.
    - (예: "매일 아침 출퇴근 시간 10분 요약 코치", "실시간 영어 회화 첨삭 튜터" 등)
    - **참고:** [product-vision-one-liner.md](../product/product-vision-one-liner.md)에 템플릿 및 예시 제공

### Step 2: 반복 사용 시나리오 설계
- 사용자가 **매일 1회 이상 반복**할 수 있는 구체적인 사용 시나리오를 **3가지 이상** 도출합니다.
    - 단, 각 시나리오마다 반복 주기·유형·필수 조건을 명시하며, 일상에 자연스럽게 스며들 수 있는 예시를 중점으로 작성합니다.
    - **참고:** [recurring-scenarios.md](../product/recurring-scenarios.md)를 참고하여 요구 필드 및 예외 정의 필수

### 기타 개선
- 전략적 차별점은 [strategic-differentiation.md](../product/strategic-differentiation.md) 및 `GET /v1/product-vision`의 `differentiation` 필드로 관리한다.
- 산출물 링크 목록은 bulleted list로 유지한다.
- 각 단계별 체크포인트와 참고 문서를 연결한다.
