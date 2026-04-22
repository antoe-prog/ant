# 관측·알림 (5-2 산출물)

[5-2 계획](../plan/05-02-observability.md)과 [Alerts](../operations/alerts.md)를 맞춘다.

<a id="observability-spec"></a>

## 기본 메트릭

| 메트릭 | 비고 |
|--------|------|
| 요청 수 | 게이트웨이 |
| 에러율 | 5xx·공급자 실패 |
| p95 지연 | 비기능과 동일 정의 사용 |
| 토큰 소비량 | **미수집이면 N/A** 명시 |

## 알림 룰

- [alerts.md](../operations/alerts.md)의 임계와 **동일 주장**인지 PR에서 본다.  
- [2-1 V1 게이트](../product-scope.md#v1-mvp-scope)에 “최소 관측”을 넣었다면 여기·운영 문서에 **반영**한다.
