# 게이트웨이 API 계약 — 필드 표

`services/gateway/app/schemas.py` 기준(변경 시 본 표·테스트·문서를 함께 수정).

## POST `/v1/chat`

**Body (`ChatRequest`)**

| 필드 | 타입 | 제약 |
|------|------|------|
| `user_id` | string | 필수 |
| `session_id` | string | 필수 |
| `message` | string | 1~4000자 |
| `model` | string \| null | 선택 |
| `temperature` | number | 0.0~1.0, 기본 0.4 |

**Response (`ChatResponse`)**

| 필드 | 타입 |
|------|------|
| `provider` | string |
| `model` | string |
| `answer` | string |
| `request_id` | string |

## GET `/v1/product-vision`

**Response (`ProductVisionResponse`)**

| 필드 | 타입 |
|------|------|
| `one_liner` | string |
| `scenarios` | `ScenarioItem[]` |
| `differentiation` | string[] |
| `doc_paths` | object (키→경로 문자열) |

`ScenarioItem`: `id`, `summary`, `cadence`, `scenario_type`, `preconditions`, `trigger`, `first_action`, `success`.

## GET `/v1/usage?user_id=…`

**Response (`UsageResponse`)**

| 필드 | 타입 |
|------|------|
| `user_id` | string |
| `daily_budget_usd` | number |
| `used_usd` | number |

## GET `/v1/models`

JSON: `{ "models": string[] }` (스키마 클래스 없음 — 변경 시 `main.py`와 클라이언트 동시 확인).

## 브레이킹 후 전역 검색 힌트

- 필드명·JSON 키: `rg 'request_id|session_id|one_liner' services/gateway apps docs`  
- 엔드포인트 문자열: `rg '/v1/' services/gateway apps docs .github`

## OpenAPI

로컬에서 스키마 덤프: 게이트웨이 실행 후 `curl -s http://127.0.0.1:8000/openapi.json` (계약 리뷰·클라이언트 생성에 활용).

## CI 아이디어

- `openapi.json`을 아티팩트로 저장하거나, 이전 메인과 **diff**만 보는 스텝(팀 규모에 맞게).
