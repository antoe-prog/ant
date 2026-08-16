# Plotly 데이터 기업행동 근거

이 폴더의 매니페스트는 가격·거래량 휴리스틱의 출력이 아니라 발행사 자료로
확인한 **같은 심볼의 승수 조정**만 담는다. 가격 불연속이 분사·회사분할·다른
클래스 주식 배부라면 단일 가격 계수를 과거 OHLC에 곱하는 방식으로는 총수익을
복원할 수 없으므로 넣지 않는다.

일반 앱은 Python 3.11 이상을 지원한다. 다만 게시된 증거의 재현·검증 런타임은 Python 3.12.13으로 고정한다.
저장소 루트의 `trading/`에서 두 고정 의존성 파일을
사용하고 프로젝트 설치 시 빌드 격리를 끈다.

```bash
uv venv --python 3.12.13 .venv-evidence
uv pip install --python .venv-evidence/bin/python -r evidence/requirements-build.txt
uv pip install --python .venv-evidence/bin/python -r evidence/requirements-measurement.txt
uv pip install --python .venv-evidence/bin/python -e . --no-deps --no-build-isolation
source .venv-evidence/bin/activate
```

증거 빌더 자체도 반드시 Python isolated mode(`-I`)로 실행한다. 빌더와 빌더가
시작한 scan/sweep은 고정한 `tzdata` wheel만 쓰도록 `PYTHONTZPATH`를 비우고,
검토한 `src/`를 명시적으로 불러온다. 부모 셸의 `PYTHONPATH`, `PYTHONWARNINGS`
같은 설정은 상속하지 않는다. 추적 bundle만 다시 검증할 때는 기존 measurement의
`effective_date`와 `execution_started_at_utc`를 빌더가 직접 읽으므로 날짜 인자를
받지 않는다.

```bash
python -I scripts/build_plotly_evidence.py \
  --output-dir evidence \
  --manifest evidence/plotly-verified-splits.csv \
  --readme README.md \
  --artifact-version v5 \
  --check
```

위 명령은 추적 로그를 다시 실행하지 않는다. 준비 CSV부터 terminal log와 13개
bundle 파일을 실제로 재측정하려면 저장소 산출물을 덮어쓰지 않는 scratch 경로에서
아래 명령을 실행한다. `--effective-date`는 실행 시각이 아니라 결과를 묶는 **사용자
선언 유효일**이며 canonical v5 기준일은 2026-08-09다. 실제 실행 시작 시각은 CLI로
넣을 수 없고 로컬 시스템 시계에서 읽은 UTC `execution_started_at_utc`로 자동 기록된다.
이는 외부 시각 인증 기관의 증명이 아니다. 경로는 논리 토큰으로
정규화되므로 같은 코드·입력·런타임이면 12개 결정적 bundle 파일과 README는 바이트
단위로 같아야 하고, measurement JSON도 실행 영수증 한 필드를 제외하면 같아야 한다.
`./data`는 바로 아래 준비 명령으로 만든 검증 완료 폴더다.

```bash
evidence_scratch="$(mktemp -d)"
cp README.md "$evidence_scratch/README.md"
mkdir "$evidence_scratch/evidence"

python -I scripts/build_plotly_evidence.py \
  --prepared-dir ./data \
  --effective-date 2026-08-09 \
  --output-dir "$evidence_scratch/evidence" \
  --manifest evidence/plotly-verified-splits.csv \
  --readme "$evidence_scratch/README.md" \
  --artifact-version v5

python -I scripts/build_plotly_evidence.py \
  --output-dir "$evidence_scratch/evidence" \
  --manifest evidence/plotly-verified-splits.csv \
  --readme "$evidence_scratch/README.md" \
  --artifact-version v5 \
  --check

for evidence_file in \
  plotly-scan-v5.txt \
  plotly-sweep-sma-raw-v5.txt \
  plotly-sweep-momentum-v5.txt \
  plotly-sweep-breakout-v5.txt \
  plotly-sweep-mean-reversion-v5.txt \
  plotly-sweep-sma-posthoc-exclude-v5.txt \
  plotly-sweep-sma-verified-adjust-posthoc-exclude-v5.txt \
  plotly-sweep-disck-raw-v5.txt \
  plotly-sweep-disck-adjust-v5.txt \
  plotly-cohort-v5.json \
  plotly-preparation-report-v5.json \
  plotly-readme-v5.json
do
  cmp "evidence/$evidence_file" \
    "$evidence_scratch/evidence/$evidence_file"
done
cmp README.md "$evidence_scratch/README.md"

python - "$evidence_scratch/evidence/plotly-measurement-v5.json" <<'PY'
import json
import pathlib
import sys

tracked = json.loads(
    pathlib.Path("evidence/plotly-measurement-v5.json").read_text(encoding="utf-8")
)
scratch = json.loads(pathlib.Path(sys.argv[1]).read_text(encoding="utf-8"))
tracked.pop("execution_started_at_utc")
scratch.pop("execution_started_at_utc")
assert tracked == scratch
PY
```

## 입력 데이터

- Plotly datasets commit:
  `0c447c47b757ad74edecab31f0d72f849d2e67c2`
- `all_stocks_5yr.csv` SHA-256:
  `6aea253cd19de60b568143991aaf1fa482456565c389205658d236e595e716cf`
- 재현 도구: `scripts/prepare_plotly_data.py`. 실행에 사용한 버전과 정확한
  코드 해시는 아래 준비 보고서의 `preparation_tool_version`과
  `preparation_tool_sha256`을 정본으로 삼는다.
- 소비자 코드 `tossquant.backtest.data`와 `tossquant.models`의 정확한 해시도
  아래 준비 보고서에만 기록한다.
- 준비 결과: 505심볼, 원본 619,040행, 출력 619,017행, 제외 23행
  (필수값 누락 11 + 잘못된 OHLCV 12)
- 종목별 CSV 집합의 정확한 SHA-256은 준비 보고서의 `output_sha256`을 정본으로
  삼는다.
- 전체 준비 감사 보고서:
  [`plotly-preparation-report-v5.json`](plotly-preparation-report-v5.json)

```bash
python scripts/prepare_plotly_data.py ./data
python scripts/prepare_plotly_data.py ./data --verify-only
```

`ratio`는 행사일 종가 / 전일 종가가 아니다. 공시된 주식 수 변화에서 도출한
이론 가격 계수 `old_shares / new_shares`다. `date`는 record date나 지급일이
아니라 **post-action 가격으로 처음 거래된 세션 날짜**다. 현재 구현은 이 날짜를
안전하게 매칭할 수 있는 UTC 자정 봉 중, 실제 간격의 80% 이상과 각 행사 경계가
1~4일인 조밀한 일봉만 조정한다. 행사일 OHLC 네 필드도 공시 계수와 각각
대조한다.

기본 sweep의 코호트는 검증된 최장 1,259봉 중 **UTC 자정 timestamp 열까지 완전히
같은 최대 그룹** 461개다. 정확한 심볼·기간·코호트 해시는
[`plotly-cohort-v5.json`](plotly-cohort-v5.json)에 고정했다. 준비 보고서 schema 5는
각 심볼의 전체 timestamp 열 해시와 첫·마지막 timestamp를 보존하므로, 같은 행
수라는 약한 대리값이 아니라 실제 최대 동일 타임라인 그룹·기간·코호트 해시를
독립 재계산할 수 있다. 변환 검증 강화로 한 행이 제외된 종목을 예전 468개
코호트에 그대로 남겨 숫자를 섞지 않는다.

scan 분류, 네 전략의 원본 sweep, 사후 제외 두 실행, 추적한 원본 로그와 해시는
[`plotly-measurement-v5.json`](plotly-measurement-v5.json)에 고정했다. 이 스키마는
준비 보고서·측정 코드 집합·런타임·전체 시뮬레이션 설정·계획/완료 코호트 해시와
DISCK 단독 원본/조정 로그까지 결합한다. 각 로그는 argv·작업 폴더·stdout/stderr
병합 방식·종료 상태를 함께 고정하고, 성공 로그 자체도 `exit_status=0`을 남긴다.
측정 및 빌드 의존성은 각각 `requirements-measurement.txt`와
`requirements-build.txt`에 정확한 버전으로 고정한다. 준비 입력 집합, 스캔
패키지 코드, 측정 코드 집합의 정확한 해시는 이 정적 안내서에 중복하지 않는다.
[`plotly-measurement-v5.json`](plotly-measurement-v5.json)의
`preparation.output_sha256`, `scan.code.sha256`, `measurement_code.sha256`을 각각
정본으로 삼아 코드 재생성 때 함께 갱신·검증한다. 여기서
`posthoc_sensitivity`는 미래 불연속을 본 뒤 종목 전체를 빼는 lookahead 분석이며,
편향 없는 정제 성과가 아니라는 경고도 아티팩트 안에 함께 둔다.

## 적용하는 사건

### DISCK — 첫 post-action 거래일 2014-08-07, 이론 계수 0.5

[Warner Bros. Discovery의 공식 Series C 배당 기록](https://ir.wbd.com/stock-information/cost-basis-and-debt-information/series-c-dividend/default.aspx)과
[`disck-issuer-citation.json`](disck-issuer-citation.json)은
기존 Series C 1주당 같은 Series C 1주를 배부했고, 배부 후 기준 첫 거래일이
2014-08-07이며 거래량가중 평균가격을 쓴 원가 기준 예시에서 기존 주식과 새 주식에
50%씩 배분한다고 설명한다.
따라서 사건의 법적 명칭은 주식분할이 아니라 `same_class_stock_dividend`지만,
같은 심볼의 주식 수가 2배가 되는 경제적 효과에서 과거 가격 계수 0.5를 도출할
수 있다.

인용 레코드에는 2026-08-08에 발행사 Form 8937 PDF를 `Accept-Encoding:
identity`로 두 번 받아 동일했던 1,255,915바이트의 SHA-256을 기록했다. canonical
페이지는 직접 요청에서 Cloudflare 챌린지를 반환했고 원문도 저장소에 보관하지
않았다. 따라서 PDF 해시는 그날 받은 바이트를 식별할 뿐이며, canonical 페이지와
PDF URL 모두 나중에 바뀔 수 있다는 미보관·가변 원본 위험이 남는다.

## 적용하지 않는 휴리스틱 후보

| 심볼 | 관측 후보 | 공식 자료로 확인한 사건 | 단일계수 조정을 하지 않는 이유 |
| --- | ---: | --- | --- |
| A | 0.75 | [Agilent의 Keysight 분사](https://www.investor.agilent.com/news-and-events/news/news-details/2014/Agilent-Technologies-Spins-Off-Its-Electronic-Measurement-Business-Keysight-Technologies/default.aspx) | A 2주당 별도 심볼 KEYS 1주 배부 |
| ARNC | 0.6667 | [Alcoa Corporation 분리](https://investors.alcoa.com/press-releases/press-release-details/2016/Alcoa-Corporation-Launches-as-an-Independent-Industry-Leader-in-Bauxite-Alumina-and-Aluminum-Products/default.aspx) | 독립 회사 분리와 기존 회사의 ARNC 개명이지 공시된 단순 분할비가 아님 |
| DISCA | 0.5 | [Series C 주식 배당](https://ir.wbd.com/stock-information/cost-basis-and-debt-information/series-c-dividend/default.aspx) | DISCA 보유자가 다른 클래스/심볼 DISCK를 받음 |
| HPE | 0.75 | [Enterprise Services 분사·CSC 합병](https://investors.hpe.com/~/media/Files/H/HP-Enterprise-IR/documents/hpe-completes-spin-off-and-merger-of-its-enterprise-services-business-with-csc.pdf) | 별도 심볼 DXC 주식을 배부한 사건 |

이 네 사건을 정확히 모델링하려면 배부된 별도 증권까지 포트폴리오에 넣거나,
신뢰할 수 있는 총수익 조정 시계열을 사용해야 한다. 현재 조정기는 둘 다 하지
않으므로 원본을 그대로 두고 불연속을 보고한다.
