# 테스트 전략 (6-1 산출물)

[6-1 계획](../plan/06-01-testing-strategy.md)을 표와 체크로 고정한다.

<a id="testing-strategy-spec"></a>

## 모바일

| 층 | 범위 |
|----|------|
| 단위 | ViewModel·파서 등 **핵심 로직** |
| e2e | **로그인 MVP가 있을 때만** “가입→첫 사용→재방문”. 없으면 **[첫 가치 여정](first-value-journey.md#first-value-journey)** 기준: 첫 실행→첫 가치→재방문 |

## LLM·게이트웨이

- 대표 프롬프트 세트에 대한 **스냅샷 또는 반자동** 평가.  
- `services/gateway` — `pytest`, OpenAPI 스키마([test_openapi](../../services/gateway/tests/test_openapi.py) 등)를 **CI에 포함**한다.

