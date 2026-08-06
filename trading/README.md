# tossquant

토스증권 Open API 기반 미국주식 자동매매 시스템. **페이퍼 트레이딩이 기본값**이고,
실주문은 명시적으로 켜야 동작한다.

---

## ⚠️ 먼저 읽을 것

**엔드포인트 경로와 응답 필드명은 아직 실제 응답으로 검증되지 않았다.**

토스 Open API 공식 문서(`developers.tossinvest.com`)는 개발 환경의 네트워크 정책에
막혀 있어 스펙을 직접 확인하지 못했다. 그래서 `src/tossquant/broker/toss.py`는
문서와 어긋나도 고칠 곳이 두 군데로만 좁혀지도록 만들어져 있다:

1. 파일 상단의 `ENDPOINTS` 딕셔너리 — 경로
2. `_pick(...)` 호출부 — 응답 필드명 (여러 후보를 이미 넣어 두었다)

**설정 후 가장 먼저 `tossquant verify`를 실행할 것.** 실제 응답을 그대로 찍어주므로
어긋난 부분이 바로 드러난다.

그 외 확인된 제약:

- **WebSocket 실시간 시세는 아직 제공되지 않는다.** 시세는 REST 폴링뿐이라
  초단타 전략은 구조적으로 불가능하다. 이 프로젝트가 일봉/분봉 기반인 이유.
- **호출 한도가 빡빡하다.** 계좌 조회는 초당 1회 수준으로 알려져 있다.
  `ratelimit.py`에서 엔드포인트 그룹별 토큰 버킷으로 제한하고 있고, 429가
  계속 뜨면 `RateLimiter.toss_defaults()`의 수치를 먼저 낮출 것.
- **모의투자(샌드박스) 서버는 없다.** 이 프로젝트의 `PaperBroker`가 그 역할을
  대신한다 — 시세는 실제 API에서 받고 체결만 가상으로 처리한다.

---

## 설치

```bash
cd trading
uv venv --python 3.11
uv pip install -e ".[dev]"
```

## 설정

토스증권 WTS → 설정 → Open API 에서 `client_id` / `client_secret`을 발급받는다.

```bash
cp .env.example .env
$EDITOR .env
```

| 키 | 설명 |
| --- | --- |
| `TOSSQUANT_CLIENT_ID` / `_SECRET` | Open API 자격증명 |
| `TOSSQUANT_ACCOUNT_ID` | 주문 계좌 (`verify`로 확인) |
| `TOSSQUANT_MODE` | `paper`(기본) 또는 `live` |
| `TOSSQUANT_SYMBOLS` | 대상 종목, 쉼표 구분 |
| `TOSSQUANT_MAX_POSITION_PCT` | 종목당 평가액 비중 상한 |
| `TOSSQUANT_MAX_DAILY_LOSS_PCT` | 일일 손실 한도 |

## 사용법

```bash
# 1. 연결 확인 — 반드시 여기서 시작
tossquant verify

# 2. 한 사이클만 돌려보기
tossquant run --once -v

# 3. 상시 실행 (페이퍼)
tossquant run

# 상태 확인
tossquant status

# 페이퍼 상태 초기화
tossquant reset
```

---

## 구조

```
전략(Strategy) ──신호──▶ 리스크(RiskManager) ──수량──▶ 브로커(Broker)
   방향만 결정              사이징 + 한도 검사           체결
```

| 파일 | 역할 |
| --- | --- |
| `models.py` | 도메인 타입. 브로커 응답과 전략 로직의 경계 |
| `config.py` | 환경변수 설정 (`TOSSQUANT_` 접두사) |
| `ratelimit.py` | 엔드포인트 그룹별 토큰 버킷 |
| `calendar_us.py` | 미국 정규장 개장 판정 (휴장일·조기폐장 포함) |
| `broker/toss.py` | 토스 REST 클라이언트 (OAuth2, 재시도, 백오프) |
| `broker/paper.py` | 가상 체결 브로커 |
| `strategy/sma_cross.py` | 샘플 전략 (SMA 골든/데드크로스) |
| `risk.py` | 사이징과 모든 한도 검사 |
| `engine.py` | 매매 루프 |
| `store.py` | SQLite 영속화 (재시작해도 상태 유지) |

**설계상 중요한 분리 두 가지:**

- 전략은 수량을 정하지 않는다. 방향만 내고 사이징은 `risk.py`가 한다. 그래서
  전략을 아무리 갈아끼워도 계좌를 날릴 수 있는 경로는 `risk.py` 하나뿐이다.
- 엔진과 전략은 `Broker` 인터페이스에만 의존한다. 페이퍼 → 실주문 전환은
  `cli.py`에서 구현체 하나 바꾸는 것으로 끝난다.

## 리스크 한도

`risk.py`가 강제하는 것:

- 종목당 평가액 비중 (`max_position_pct`)
- 동시 보유 종목 수 (`max_positions`)
- 1회 주문 명목금액 (`max_order_notional`)
- 일일 손실 한도 (`max_daily_loss_pct`) — 초과 시 **신규 진입만 차단하고
  청산은 계속 허용한다.** 손절이 막히면 안 되기 때문이다.
- 공매도 없음 — 보유 수량을 초과하는 매도는 거부된다.

일일 기준선은 SQLite에 거래일과 함께 저장되므로, 봇을 재시작해도 손실 한도가
리셋되지 않는다.

## 전략 교체

`strategy/base.py`의 `Strategy`를 상속하고 `cli.py:_build()`에서 갈아끼운다.

```python
class MyStrategy(Strategy):
    name = "my_strategy"

    @property
    def warmup_bars(self) -> int:
        return 50

    def on_bar(self, symbol, candles, position) -> Signal | None:
        ...  # 방향만 반환. 수량은 리스크 계층이 정한다.
```

## 테스트

```bash
pytest        # 74개
```

토스 클라이언트 테스트는 `respx`로 HTTP를 모킹한다. 응답 스키마가 확정되지 않았으므로
토큰 재발급·429 재시도·헤더·파싱 내성처럼 스키마와 무관하게 중요한 동작을 검증한다.

---

## 실주문 전환 체크리스트

`TOSSQUANT_MODE=live`로 바꾸기 전에:

- [ ] `tossquant verify`가 5단계 모두 통과
- [ ] 페이퍼로 최소 몇 주간 운용해 체결·손익 기록 확인
- [ ] `max_daily_loss_pct`, `max_order_notional`을 감당 가능한 수준으로 설정
- [ ] 첫 실주문은 `max_order_notional`을 아주 작게(예: 100 USD) 잡고 시작
- [ ] `.env`가 git에 올라가지 않는지 확인 (`.gitignore`에 포함되어 있음)

`run`은 live 모드에서 실행 전 확인을 한 번 받는다.

## 알려진 한계

- 페이퍼 체결은 호가 잔량과 거래량을 무시한다. 성과는 **상단 추정치**로 볼 것.
- 백테스트 엔진은 아직 없다. 현재는 실시간 페이퍼 운용만 가능하다.
- 환전을 다루지 않는다. 계좌에 USD가 있다고 가정한다.
- 휴장일 목록(`calendar_us.py`)은 2027년까지만 들어 있다. 매년 갱신 필요.
