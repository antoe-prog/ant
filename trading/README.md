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
- **IP 화이트리스트를 쓴다.** 등록된 IP에서만 인증된다 (아래 참고).
- **키에 만료일이 있다** (발급일 기준 1년). 만료되면 토큰 발급부터 실패한다.

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
| `TOSSQUANT_STOP_LOSS_PCT` | 손절 비율 (기본 0.08) |
| `TOSSQUANT_KEY_EXPIRES_AT` | 키 만료일 `YYYY-MM-DD` (만료 전 경고용) |
| `TOSSQUANT_TELEGRAM_*` | 알림 채널 (선택) |

## 사용법

```bash
# 1. 연결 확인 — 반드시 여기서 시작
tossquant verify

# 2. 알림 설정 확인
tossquant notify-test

# 3. 과거 데이터로 전략 검증
tossquant backtest --source csv --csv-dir data --symbols AAPL,MSFT

# 3-1. 과최적화 여부 교차 확인 — 실주문 전에 반드시
tossquant walkforward --source csv --csv-dir data --symbols AAPL,MSFT

# 4. 한 사이클만 돌려보기
tossquant run --once -v

# 5. 상시 실행 (페이퍼)
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
| `stops.py` | 손절·트레일링·익절·최대보유 (전략과 무관하게 동작) |
| `notify.py` | 텔레그램·Slack 알림 (실패해도 매매를 막지 않음) |
| `engine.py` | 매매 루프 |
| `store.py` | SQLite 영속화 (재시작해도 상태 유지) |
| `backtest/replay.py` | 과거 캔들을 시세 소스로 재생 (미래 정보 차단) |
| `backtest/simulator.py` | 백테스트 루프 + 라운드트립 장부 |
| `backtest/metrics.py` | CAGR·MDD·Sharpe·승률·손익비 |
| `backtest/data.py` | CSV / 토스 API 소스 + 캔들 캐시 |
| `backtest/walkforward.py` | 구간 분할 최적화 + 과최적화 진단 |

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
- 강제 청산은 `stops.py`가 따로 담당한다 (아래 참고).

일일 기준선은 SQLite에 거래일과 함께 저장되므로, 봇을 재시작해도 손실 한도가
리셋되지 않는다.

## 보호 청산 (`stops.py`)

전략과 **완전히 분리**된 강제 청산 장치다. 전략을 갈아끼워도 그대로 남는다.

이게 필요한 이유: SMA 크로스 같은 추세추종은 데드크로스가 나야 팔기 때문에
급락에 수십 봉 늦게 반응한다. 60일선을 쓰면 -30% 물린 뒤에야 청산 신호가 난다.
일일 손실 한도는 신규 진입만 막고 보유 포지션은 건드리지 않으므로, 이 장치가
없으면 **빠져나올 방법 자체가 없다.**

| 설정 | 기본값 | 동작 |
| --- | --- | --- |
| `stop_loss_pct` | **0.08** | 평단 대비 -8%에 청산 |
| `trailing_stop_pct` | 0 (꺼짐) | 보유 중 고점 대비 -X%에 청산 |
| `take_profit_pct` | 0 (꺼짐) | 평단 대비 +X%에 청산 (상승분을 잘라내므로 신중히) |
| `max_holding_days` | 0 (꺼짐) | X일 넘게 들고 있으면 청산 |
| `stop_cooldown_days` | 3 | 보호 청산 후 같은 종목 재진입 차단 |

발동 순서는 손절 → 트레일링 → 최대보유 → 익절. 손실 방어가 먼저다.
보호 청산이 걸린 종목은 그 사이클에 전략 신호를 아예 묻지 않는다.

### 체결 모델 — 거래소 stop order가 아니다

이건 폴링 봇이 매 사이클 관측 가격을 보고 조건이 맞으면 **시장가를 내는** 방식이다.
거래소에 미리 걸어두는 stop order가 아니라서:

- 반응 속도가 캔들 주기와 `poll_seconds`에 묶인다. 일봉으로 돌리면 장중 스파이크로
  잠깐 스톱선을 뚫었다 회복한 경우 발동하지 않는다.
- **갭 하락하면 스톱선보다 한참 아래에서 체결된다.** 실제 손실은 설정값보다 커진다.
- 봇이 죽어 있으면 아무것도 안 걸린다.

백테스트도 정확히 같은 모델(관측 종가로 판정, 다음 봉 시가에 체결)을 쓰므로
백테스트와 실제 동작이 어긋나지 않는다.

### 효과 측정

`--no-stops`로 끄고 돌려 직접 비교할 수 있다.

```bash
tossquant backtest --no-stops
tossquant backtest --stop-loss 0.08
tossquant backtest --stop-loss 0 --trailing 0.12
```

합성 데이터(완만한 랜덤워크)로는 8% 손절이 아예 발동하지 않아 결과가 동일했고,
급락 구간을 넣은 데이터에서 MDD 9.00% → 8.42%, Sharpe 0.35 → 0.43 정도의 개선이
나왔다. **실제 데이터로 다시 측정할 것** — 손절의 진짜 값어치는 이동평균이 절대
따라잡지 못하는 단일 종목 급락(실적 쇼크 등)에서 나오는데, 그건 합성 데이터로는
재현되지 않는다.

## 인증이 막히는 두 가지 원인

자격증명이 멀쩡한데도 봇이 멈추는 경로가 둘 있다. 원인을 잘못 짚으면 멀쩡한 키를
재발급하며 시간을 버리므로, 클라이언트가 둘을 구분해서 알려준다.

### IP 화이트리스트

토스 Open API는 등록된 IP에서만 인증된다 (WTS > 설정 > Open API > 허용 IP 관리).

- **집 인터넷은 대개 유동 IP다.** IP가 바뀌면 자격증명이 멀쩡해도 인증이 통째로
  막힌다 — 밤새 돌던 봇이 조용히 죽는 흔한 원인이다.
- 클라우드 VM에 올릴 거면 그 서버의 고정 IP를 따로 등록해야 한다. 장기 운영이라면
  이쪽이 맞다.

403 응답이나 본문의 IP 관련 문구를 잡아 `IPNotAllowed`로 올리고, **현재 공인 IP를
같이 찍어준다** — 등록해야 할 값을 바로 알 수 있게. `verify`는 시작할 때부터 현재
IP를 보여준다.

토큰이 캐시된 뒤 IP가 바뀌는 경우도 있어서, 데이터 엔드포인트의 403도 같은 진단을
탄다. 403은 재시도해도 절대 풀리지 않으므로 호출 한도만 낭비하지 않도록 즉시
올린다.

오진 방지가 이 진단의 핵심이다. 본문에서 IP 힌트를 찾을 때 맨 `ip`로 검색하면
`error_description` 같은 흔한 단어에 걸려 자격증명 오류를 IP 문제로 오진한다.
단어 경계를 지키는 정규식을 쓰고, 양쪽 케이스를 테스트로 못 박았다.

### 키 만료

키는 발급일 기준 1년짜리다. **API가 남은 기간을 알려주지 않으므로** 만료일을
`.env`에 적어두지 않으면 1년 뒤 원인 모를 인증 실패로 나타난다.

```
TOSSQUANT_KEY_EXPIRES_AT=2027-08-04
TOSSQUANT_KEY_EXPIRY_WARN_DAYS=30
```

`verify`에서 남은 일수를 보여주고, 만료가 가까우면 **봇 시작 알림에 경고를 실어
보낸다.** 만료된 뒤에 알면 이미 늦기 때문이다.

## 알림 (`notify.py`)

밤 11시 반에 도는 봇이라 로그를 실시간으로 볼 수 없다. 손절이 발동했는지, 주문이
거부됐는지, 봇이 죽었는지를 손에 들고 있는 기기로 받아야 한다.

텔레그램과 Slack을 지원하고, 둘 다 설정하면 양쪽으로 간다. 설정이 없으면 조용히
비활성 상태로 동작한다(`NullNotifier`).

```bash
# 설정 후 반드시 확인 — 알림이 안 오는 걸 사고 난 뒤에 알면 늦는다
tossquant notify-test
```

**텔레그램 설정:** `@BotFather`로 봇을 만들어 토큰을 받고, 그 봇에게 아무 메시지나
보낸 뒤 `curl https://api.telegram.org/bot<TOKEN>/getUpdates`로 chat_id를 확인해
`.env`에 넣는다.

### 무엇을 알리나

| 이벤트 | 레벨 | 빈도 제어 |
| --- | --- | --- |
| 체결 (매수/매도) | INFO | 매번 (`notify_fills=false`로 끔) |
| 보호 청산 체결 | WARN | 매번 |
| 주문 거부·실패 | ERROR | 종목·사유별 스로틀 |
| 일일 손실 한도 도달 | WARN | **하루 한 번** (SQLite 기록) |
| 장 마감 요약 | INFO | **하루 한 번** (폐장 5분 전) |
| 사이클 실패 | ERROR | 스로틀 (연속 실패 횟수 포함) |
| 봇 시작·종료 | INFO / WARN | 매번 |

### 설계 원칙 세 가지

1. **알림 실패는 절대 매매를 막지 않는다.** `notify()`는 어떤 경우에도 예외를 던지지
   않는다. 텔레그램이 죽어도 봇은 계속 돈다. 이게 이 계층의 존재 조건이라
   `test_notifier_failure_does_not_break_trading`으로 못 박아 두었다.
2. **스팸 방지.** 사이클 오류는 매 분 반복될 수 있으므로 `dedup_key`가 같은 알림은
   throttle 구간(기본 5분) 안에서 한 번만 나간다. 반면 하루 종일 지속되는 조건
   (일일 손실 한도)은 스로틀로는 부족해서 날짜를 SQLite에 기록해 하루 한 번을
   보장한다.
3. **짧은 타임아웃.** 전송은 동기 호출이라 매매 루프를 붙잡는다. 5초로 끊는다.

## 백테스트

```bash
# CSV 데이터로 (기본). data/AAPL.csv, data/MSFT.csv 형태
tossquant backtest --source csv --csv-dir data --symbols AAPL,MSFT

# 토스 API에서 캔들을 받아서 (첫 실행 후 candles.db에 캐시된다)
tossquant backtest --source toss --symbols AAPL --count 500

# 파라미터 바꿔가며 비교
tossquant backtest --fast 10 --slow 40 --from 2024-01-01 --to 2026-01-01

# 결과를 CSV로
tossquant backtest --export ./out
```

CSV는 `<폴더>/<종목>.csv` 형태로 두면 되고, 헤더는 `date,open,high,low,close,volume`
(및 `timestamp` / `Adj Close` / `일자,시가,…` 같은 흔한 별칭)을 인식한다.

### 미래 정보 누출을 막는 방식

백테스트가 미래를 조금이라도 보면 결과는 전부 거짓말이 되고, 그 거짓말은 실계좌
에서만 드러난다. 그래서 구조적으로 불가능하게 만들었다:

- `ReplayMarket.get_candles()`는 **커서까지의 봉만** 돌려준다. 전략에 아직 오지
  않은 봉을 넘길 방법 자체가 없다.
- 신호는 봉 종가에서 나오고 **체결은 다음 봉 시가**에서 일어난다. 같은 봉 종가에
  체결하는 흔한 실수를 막는다.
- 마지막 봉에서는 체결할 다음 봉이 없으므로 주문을 내지 않는다.

`tests/test_backtest.py`가 이 세 가지를 각각 테스트로 못 박아 두고 있다.

또한 백테스트는 **실시간과 같은 전략·리스크·체결 코드**를 탄다. 바뀌는 건 시세
소스뿐이라(`ReplayMarket`), 백테스트 결과와 라이브 동작이 어긋날 여지가 줄어든다.

### 결과 읽기

수익률만 보면 안 된다. 출력에 항상 **동일가중 바이앤홀드 벤치마크**를 나란히
찍는데, 여기서 초과수익이 안 나오면 그 전략은 수수료와 복잡성만 더한 셈이다.

| 지표 | 의미 |
| --- | --- |
| MDD | 최대 낙폭. 실제로 버틸 수 있는 수준인지가 수익률보다 중요하다 |
| Sharpe / Sortino | 변동성 대비 수익. 무위험수익률은 0으로 둔다 |
| 시장 노출 | 포지션을 들고 있던 시간 비율. 낮은데 수익이 비슷하면 좋은 신호 |
| 손익비 (PF) | 총이익 / 총손실. 1 미만이면 손해 |
| 신호 기각 사유 | 거래가 안 나올 때 어느 리스크 한도가 막았는지 |

비용은 세 겹으로 붙는다: 호가 스프레드(`backtest_spread_bps`), 시장충격
(`paper_slippage_bps`), 수수료(`paper_commission_bps`). 그래도 호가 잔량은
무시하므로 결과는 **상단 추정치**다.

## 워크포워드 검증 (`backtest/walkforward.py`)

**단일 구간 백테스트로 파라미터를 고르는 건 검증이 아니다.** 같은 데이터로 고르고
같은 데이터로 평가하면 어떤 전략이든 좋아 보인다. SMA 20/60이 잘 나온 게 그 구간에
우연히 맞았기 때문인지 진짜 작동하는 건지 구분할 방법이 없다.

```
[--- 학습 ---][평가]
       [--- 학습 ---][평가]
              [--- 학습 ---][평가]
```

각 구간마다 **앞부분에서만** 파라미터를 고르고 **한 번도 안 본 뒤 구간**에서 평가한다.
평가 구간들을 이어붙인 곡선이 실제로 기대할 수 있는 성과다.

```bash
tossquant walkforward --source csv --csv-dir data --symbols AAPL,MSFT

# 학습 300봉 / 평가 100봉, 낙폭을 벌주는 목적함수로
tossquant walkforward --train-bars 300 --test-bars 100 --objective calmar

# 탐색 범위 지정, 확장 창(학습 구간이 계속 늘어남)
tossquant walkforward --fast-range 5,10,20 --slow-range 60,120 --anchored
```

목적함수는 `sharpe`(기본) / `sortino` / `calmar` / `cagr` / `return`. **`return`은
피하는 게 좋다** — 수익률만 최대화하면 낙폭을 무시하고 과최적화로 직행한다.

### 두 숫자만 보면 된다

출력 맨 아래 "과최적화 점검"에 해석까지 같이 찍는다.

| 지표 | 의미 |
| --- | --- |
| **성과 유지율 (OOS/IS)** | 인샘플 성과가 밖에서 얼마나 남았나. 떨어지는 건 정상이고 격차의 크기가 문제다. 음수면 인샘플 우승 조합이 밖에선 손해였다는 뜻 |
| **파라미터 안정성** | 구간마다 같은 파라미터가 뽑히는 비율. 널뛰면 그 '최적값'은 신호가 아니라 잡음이다 |

수익 구간 개수(예: `2/6`)도 같이 본다. 한 구간이 전체 수익을 다 만들었다면 그건
전략이 아니라 운이다.

### 미래 정보 차단

학습에는 `[train_start, train_end)` 구간만 넘어간다. 평가 구간에는 앞에 워밍업 봉만
붙이고 뒤로는 절대 넘어가지 않는다. `test_walkforward.py`가 실제로 `Backtester`에
전달된 데이터의 시각 범위를 검사해서 이걸 못 박는다 — 일부러 누출을 주입하면 두 개의
테스트가 즉시 깨지는 것을 확인했다.

### 실측 예시

합성 랜덤워크 데이터(6년치, AAPL/MSFT)에 SMA 크로스를 돌린 결과:

```
성과 유지율 (OOS/IS)   -0.14   인샘플 우승 조합이 밖에서는 손해였습니다.
파라미터 안정성         0.29   구간마다 최적값이 널뜁니다 — 잡음일 수 있습니다.
수익 구간               2/6
```

랜덤워크에 추세추종을 돌렸으니 당연한 결과다. **이 도구는 이런 결론을 내는 게
목적이다** — 실제 데이터에서도 이런 숫자가 나오면 그 전략은 쓰면 안 된다.

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
pytest        # 281개
```

토스 클라이언트 테스트는 `respx`로 HTTP를 모킹한다. 응답 스키마가 확정되지 않았으므로
토큰 재발급·429 재시도·헤더·파싱 내성처럼 스키마와 무관하게 중요한 동작을 검증한다.

---

## 실주문 전환 체크리스트

`TOSSQUANT_MODE=live`로 바꾸기 전에:

- [ ] `tossquant verify`가 5단계 모두 통과
- [ ] 봇을 돌릴 기기의 공인 IP가 토스 허용 IP 목록에 등록됨
      (`verify` 출력 상단의 '현재 공인 IP' 확인)
- [ ] `TOSSQUANT_KEY_EXPIRES_AT` 설정 — 1년 뒤 조용히 멈추는 걸 막는다
- [ ] 페이퍼로 최소 몇 주간 운용해 체결·손익 기록 확인
- [ ] `stop_loss_pct`가 0이 아닌지 확인 — 끄고 실주문을 돌리지 말 것
- [ ] `tossquant notify-test` 통과 — 알림 없이 실주문을 돌리지 말 것
- [ ] `tossquant walkforward`에서 성과 유지율·파라미터 안정성 확인
      (유지율이 음수거나 안정성이 0.4 미만이면 그 파라미터는 근거가 없다)
- [ ] `max_daily_loss_pct`, `max_order_notional`을 감당 가능한 수준으로 설정
- [ ] 첫 실주문은 `max_order_notional`을 아주 작게(예: 100 USD) 잡고 시작
- [ ] `.env`가 git에 올라가지 않는지 확인 (`.gitignore`에 포함되어 있음)

`run`은 live 모드에서 실행 전 확인을 한 번 받는다.

## 알려진 한계

- 페이퍼·백테스트 체결 모두 호가 잔량과 거래량을 무시한다. 대량 주문일수록 낙관적
  이므로 성과는 **상단 추정치**로 볼 것.
- 파라미터 탐색은 격자 전수 탐색뿐이다. 조합이 많아지면 느리고, 애초에 넓은
  격자를 뒤지는 것 자체가 과최적화를 부른다 — 워크포워드로 반드시 교차 확인할 것.
- 환전을 다루지 않는다. 계좌에 USD가 있다고 가정한다.
- IP가 바뀌었는지 **미리** 감지하지는 못한다. 실제로 막혀서 403이 온 뒤에야
  알 수 있다 (알림은 간다).
- 휴장일 목록(`calendar_us.py`)은 2027년까지만 들어 있다. 매년 갱신 필요.
