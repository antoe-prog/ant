# 파이널 유도 멀티짐 MVP 파일럿 운영 Runbook

작성일: 2026-06-13
대상 기간: 파일럿 시작 전 준비 3일 + 실제 운영 2주
기준: `docs/FINAL_MVP_PRODUCT_SPEC.md`, `docs/RELEASE_CHECKLIST.md`

## 1. 파일럿 목표

파일럿의 목표는 운영자가 스프레드시트, 종이 출석부, 단체 채팅방 없이 다음 업무를 2주 동안 처리할 수 있는지 검증하는 것이다.

- 지점별 수업 명단 확인
- 코치 모바일 출석 처리
- 회원/학부모의 일정, 출석, 결제 상태, 공지 확인
- 공지 확인과 결제 상태 후속 확인
- 대표의 회원, 수업, 결제 상태, 공지 관리
- 총괄 어드민의 지점, 사용자, 권한, 감사 로그 관리

## 2. 파일럿 범위 결정표

| 항목 | 결정값 | 담당 | 상태 |
| --- | --- | --- | --- |
| 파일럿 지점 1 | 미정 | 총괄 PM | 확인 필요 |
| 파일럿 지점 2 | 선택 사항 | 총괄 PM | 확인 필요 |
| 운영 기간 | 2주 | 총괄 PM + 지점 대표 | 확인 필요 |
| 운영 시간대 | 평일/주말 실제 수업 기준 | 지점 대표 | 확인 필요 |
| 테스트 데이터 기준일 | 파일럿 시작 전날 마감 데이터 | 지점 대표 | 확인 필요 |
| 장애 보고 채널 | 미정 | 총괄 PM | 확인 필요 |
| 피드백 회고 일정 | 파일럿 종료 다음 영업일 | 총괄 PM | 확인 필요 |

## 3. 테스트 계정 준비

MVP 기본 seed 계정은 PostgreSQL 검증용으로 준비되어 있다. 실제 파일럿 전에는 아래 표를 채워 실제 사용자 또는 테스트용 이메일을 확정한다.

| 역할 | seed 이메일 | 파일럿 이메일 | 지점 범위 | 확인 |
| --- | --- | --- | --- | --- |
| 총괄 어드민 | `admin@finaljudo.kr` | 미정 | 전체 | 확인 필요 |
| 대표 | `owner@finaljudo.kr` | 미정 | 파일럿 지점 | 확인 필요 |
| 코치 | `coach@finaljudo.kr` | 미정 | 담당 수업 지점 | 확인 필요 |
| 학부모 | `guardian@finaljudo.kr` | 미정 | 연결 자녀 | 확인 필요 |
| 회원 | `member@finaljudo.kr` | 미정 | 본인 | 확인 필요 |

계정 생성 절차:

1. 총괄 어드민으로 `/app/admin/roles`에 접속한다.
2. 사용자 초대 폼에서 이름, 이메일, 역할, 지점 범위를 입력한다.
3. 생성된 `/invite/:token` 링크를 대상자에게 전달한다.
4. 대상자가 초대 수락 후 `/app/dashboard` 진입을 확인한다.
5. 감사 로그에서 `user.invite.create`, `auth.invite.accept` 기록을 확인한다.

## 4. 실제 데이터 준비

실제 수업 시간표와 회원권 상태는 `docs/pilot-templates/pilot-data-intake.csv` 형식으로 정리한다. 기본 템플릿은 강남 본관/송파 도장 2개 지점 샘플을 포함해 지점 스코프 회귀 검증에 바로 사용할 수 있다.

필수 데이터:

- 지점명, 주소, 대표
- 수업명, 레벨, 연령대, 요일/시간, 정원, 담당 코치
- 회원명, 상태, 연령대, 레벨, 띠, 주의사항, 긴급 연락처
- 학부모 이름, 연락처, 연결 자녀
- 회원권명, 상태, 결제 금액, 만료일, 미납 여부
- 공지 제목, 대상, 발행일

반입 전 마스킹:

- 주민등록번호, 상세 의료정보, 생체정보는 반입하지 않는다.
- 부상/주의사항은 수업 운영에 필요한 최소 문장만 남긴다.
- 결제 금액은 대표/총괄 검증에 필요한 샘플만 남기고 외부 공유 자료에서는 삭제한다.

반입 전 자동 점검:

```bash
npm run test:pilot
npm run test:pilot-import
npm run test:pilot-prelaunch-draft
npm run test:pilot-launch-package
npm run test:pilot-launch-command
```

다른 CSV 파일을 검증할 때는 다음처럼 실행한다.

```bash
npm run test:pilot -- path/to/pilot-data.csv
```

검증 항목은 필수 컬럼, 5개 역할 계정, 회원/수업/회원권/공지 샘플, 코치/학부모 이름 참조, 수업 시간/정원, 민감정보 반입 금지 패턴이다. `npm run test:pilot-prelaunch-draft`는 `npm run pilot:prelaunch-draft -- --out-dir=.data`가 준비 증빙 CSV, 계정별 비밀번호 교체 CSV, audit launch package, pre-pilot evidence/preflight/status, blocked next action summary를 생성하는지 확인한다. `npm run test:pilot-launch-package`는 CSV 검증, import dry-run, `npm run pilot:prelaunch-draft -- --out-dir=.data`, `npm run pilot:launch-package -- --allow-incomplete --out=.data/pilot-launch-package.json`, 준비 증빙 CSV, 계정별 비밀번호 교체 증빙 CSV, `npm run pilot:evidence -- --out=.data/pilot-evidence.json` pre-pilot JSON, Markdown 리포트, 현장 증빙 manifest 템플릿, 운영 문서의 필수 명령을 함께 확인한다. `npm run test:pilot-launch-command`는 실제 `pilot:launch-package` 명령이 준비 중 audit 모드와 최종 strict 모드의 종료 코드/산출물을 올바르게 남기고 PostgreSQL URL 비밀번호를 보관 패키지에서 redaction하는지 확인한다.

## 5. 현장 모바일 기기 테스트

| 항목 | 기대 결과 | 상태 |
| --- | --- | --- |
| iPhone Safari 390px 내외 | `/app/classes` 출석 버튼 48px 이상, 하단 sticky 저장 상태 표시 | 확인 필요 |
| Android Chrome 390px 내외 | 가로 오버플로 없음, 상태 버튼 탭 가능 | 확인 필요 |
| 태블릿 768px 내외 | 수업 카드와 명단이 읽기 쉬움 | 확인 필요 |
| 네트워크 불안정 | 오프라인 대기 건수 표시, 새로고침 후 대기 상태 복구, 재동기화 버튼으로 서버 저장과 감사 로그 생성 | 확인 필요 |
| 다른 역할 직접 URL | 403 권한 없음 화면 표시 | 확인 필요 |

## 6. 운영 중 장애 대응

운영 중 장애는 총괄 어드민이 `/app/admin/settings`의 파일럿 이슈 로그에 기록한다. 문서/채팅으로 먼저 접수하더라도 P0/P1/P2 심각도, 지점, 역할, 화면, 재현 절차, 우회책, 담당자를 앱에 남겨 `pilot_incident.create`와 `pilot_incident.update` 감사 로그로 추적한다.

| 등급 | 기준 | 대응 |
| --- | --- | --- |
| P0 | 출석 저장 불가, 권한/지점 데이터 노출, 로그인 전체 실패 | 즉시 운영 중단 판단, 총괄 PM 호출 |
| P1 | 특정 수업/회원/결제 쓰기 실패, CSV 실패 | 당일 수정 또는 우회 기록 |
| P2 | UI 겹침, 문구 오류, 느린 조회 | 파일럿 종료 전 개선 후보 |

보고 양식:

```text
[파일럿 장애]
일시:
지점:
역할:
화면:
재현 절차:
기대 결과:
실제 결과:
스크린샷/영상:
임시 우회:
```

상태 전환 기준:

- `open`: 접수 직후, 원인/우회책 확인 전
- `monitoring`: 우회책 또는 수정이 적용되어 현장에서 재확인 중
- `resolved`: 현장 담당자가 정상 처리와 데이터 보정을 확인

## 7. 일일 운영 체크

매 운영일 종료 시 총괄 어드민은 `/app/admin/settings`의 파일럿 14일 운영 로그에 다음 값을 저장한다.

- 운영 일자와 지점
- 수업 확인 수, 출석 기록 수, 결제 상태 확인 수, 요청 처리 수, 공지 확인 수
- 출석 기록이 있으면 모바일 출석 처리 시간(30초 이하)과 현장 녹화/캡처 증빙
- 현장 담당자, 증빙 메모, 차단/특이사항

파일럿 종료 후에는 `NODE_ENV=production npm run preflight:pilot -- --require-retro --out=.data/pilot-preflight.post-pilot.json`로 14개 운영일, 출석 기록 수치, 모바일 출석 30초 계측 증빙, 결제 상태 확인 수치, 회고 증빙을 최종 확인하고 strict preflight 결과를 파일로 보관한다.
준비 초안 전체는 `npm run pilot:prelaunch-draft -- --out-dir=.data`로 생성할 수 있다. 이 명령은 준비 증빙 CSV, 계정별 비밀번호 교체 CSV, audit launch package, pre-pilot evidence/preflight/status, 요약 JSON을 한 번에 남기지만 ready 판정은 하지 않는다. PostgreSQL 운영 DB에서는 `--driver=postgres --state-key=<key> --postgres-url=<url>`를 함께 붙인다.
파일럿 운영 전 준비 증빙은 `npm run pilot:readiness-evidence:draft -- --phase=pre-pilot --out=.data/pilot-readiness-evidence.csv`로 공유 준비 항목 ID 기반 CSV 초안을 만든 뒤 owner/status/evidence를 채운다. PostgreSQL 운영 DB를 쓰는 파일럿은 같은 명령에 `--driver=postgres --state-key=<key> --postgres-url=<url>`를 붙여 현재 `app_runtime_state`의 기존 준비 상태를 초안에 반영한다. `npm run pilot:readiness-evidence -- --file=.data/pilot-readiness-evidence.csv --phase=pre-pilot`가 통과하면 `npm run pilot:readiness-evidence:apply -- --file=.data/pilot-readiness-evidence.csv --phase=pre-pilot --actor-user-id=user-admin` 또는 `/app/admin/settings`로 같은 내용을 반영해 `pilot_readiness.update` 감사 로그를 남긴다. 최종 기준은 앱에 저장된 준비 항목과 감사 로그이며, CSV는 현장 증빙 수집과 사전 검증용이다.
계정별 기본 임시 비밀번호 교체 증빙은 `/app/admin/users`에서 사용자별 임시 비밀번호를 발급한 뒤 `npm run pilot:password-rotation:draft -- --runtime=.data/final-judo-db.json --out=.data/pilot-password-rotation.csv`로 CSV 초안을 만든다. PostgreSQL 운영 DB를 쓰는 파일럿은 `--runtime` 대신 `--driver=postgres --state-key=<key> --postgres-url=<url>`를 붙여 같은 `app_runtime_state` row를 참조한다. 운영자는 전달 채널 증빙 링크와 감사 로그 ID를 확인하되 원문 임시 비밀번호는 CSV에 적지 않는다. `npm run pilot:password-rotation -- --runtime=.data/final-judo-db.json --file=.data/pilot-password-rotation.csv`가 통과해야 파일럿 시작 전 기본 비밀번호 교체 증빙을 완료한 것으로 본다.
파일럿 운영 전 판단 자료는 `npm run pilot:evidence -- --out=.data/pilot-evidence.json`으로 저장한다. 시작 전 산출물을 한 번에 묶으려면 `npm run pilot:launch-package -- --csv=docs/pilot-templates/pilot-data-intake.csv --readiness-evidence=.data/pilot-readiness-evidence.csv --password-rotation=.data/pilot-password-rotation.csv --out=.data/pilot-launch-package.json`을 실행한다. PostgreSQL 운영 DB에서는 같은 명령에 `--driver=postgres --state-key=<key> --postgres-url=<url>`과 필요 시 `--table=<table>`을 붙인다. 이 명령은 CSV 검증, import dry-run, 준비 증빙 CSV, 계정별 비밀번호 교체 증빙 CSV, `.data/pilot-evidence.json`, `.data/pilot-evidence.pre-pilot.md`, `.data/pilot-preflight.pre-pilot.json`, `.data/pilot-launch-package.json` 생성을 수행하고 strict preflight 또는 준비/비밀번호 교체 증빙 차단 조건이 있으면 패키지를 남긴 뒤 실패한다. 보관되는 패키지의 `runtime.connectionString`과 `commands.*`에는 DB URL 비밀번호가 `REDACTED`로만 기록된다. 아직 준비 중인 리허설에는 `--allow-incomplete`를 붙인다. 종료 후에는 `npm run pilot:evidence -- --require-retro --out=.data/pilot-evidence.post-pilot.json`으로 현장 수치 교차 검증용 JSON을 만들고, 회고용 Markdown은 `npm run pilot:evidence -- --require-retro --format=markdown --out=.data/pilot-evidence.md`로 생성한다.
현장 증빙 manifest는 `npm run pilot:field-evidence:draft -- --source-csv=docs/pilot-templates/pilot-data-intake.csv --pre-pilot-evidence=.data/pilot-evidence.json --post-pilot-evidence=.data/pilot-evidence.post-pilot.json --post-pilot-markdown=.data/pilot-evidence.md --out=.data/pilot-field-evidence.json`로 source CSV의 실제 지점/계정과 post-pilot 운영 수치가 채워진 초안을 먼저 만든다. 이후 운영자는 실제 기기, 스크린리더, 계정별 비밀번호 교체/로그인, 14일 출석/결제/공지 후속/공지 운영, 환경 플래그 증빙 링크와 signoff를 채운다. manifest의 `dataImport.sourceCsv`는 실제 import에 사용한 CSV 경로, `dataImport.evidenceReport`는 파일럿 시작 전 생성한 `.data/pilot-evidence.json`, `operations.postPilotEvidenceJson`은 `.data/pilot-evidence.post-pilot.json`, `operations.postPilotEvidenceMarkdown`은 `.data/pilot-evidence.md`로 기록한다. 스크린리더 증빙은 `/app/classes` 출석 상태와 `/app/notices` 공지 읽음 상태 각각의 target, 기대 낭독, 실제 낭독, 이슈 없음 여부, 메모, 녹화/캡처 링크를 기록한다. 파일럿 종료 판단 전 `npm run pilot:field-evidence -- --file=.data/pilot-field-evidence.json --report=.data/pilot-evidence.post-pilot.json`이 통과해야 하며, 이 검증은 source CSV 파일 자체가 pilot CSV 검증을 통과하는지, dry-run/import 명령이 같은 CSV를 참조하는지, manifest의 지점 목록과 계정 email/role/branchScope가 source CSV와 일치하는지, pre-pilot evidence가 ready 상태이고 source CSV의 지점/계정/회원/수업/결제/공지 예상 수와 맞는지, 스크린리더 낭독 품질 기록이 모두 채워졌는지, Markdown 회고 리포트 파일 존재, post-pilot/ready/고유 운영일/검증 운영일/운영 수치 내용, JSON/Markdown 리포트 생성 시각이 파일럿 종료일 이후인지, 총괄 PM signoff가 두 리포트 생성 이후인지 함께 확인한다.
최종 릴리즈 판단 기록은 `npm run pilot:closeout-package -- --field=.data/pilot-field-evidence.json --preflight=.data/pilot-preflight.post-pilot.json --report=.data/pilot-evidence.post-pilot.json --markdown=.data/pilot-evidence.md --out=.data/pilot-closeout-package.json`로 생성해 preflight/JSON/Markdown/manifest 결과를 하나의 ready 패키지로 보관한다. 이어서 `npm run pilot:artifact-manifest -- --preflight-pre=.data/pilot-preflight.pre-pilot.json --evidence-pre=.data/pilot-evidence.json --evidence-pre-markdown=.data/pilot-evidence.pre-pilot.md --readiness-evidence=.data/pilot-readiness-evidence.csv --launch-package=.data/pilot-launch-package.json --password-rotation=.data/pilot-password-rotation.csv --preflight-post=.data/pilot-preflight.post-pilot.json --evidence-post=.data/pilot-evidence.post-pilot.json --evidence-markdown=.data/pilot-evidence.md --field=.data/pilot-field-evidence.json --closeout=.data/pilot-closeout-package.json --out=.data/pilot-artifact-manifest.json`를 실행해 업로드 대상 파일의 SHA-256 해시와 byte size를 함께 보관한다. 그다음 `npm run pilot:archive-artifacts -- --manifest=.data/pilot-artifact-manifest.json --archive-dir=.data/pilot-archives/final-judo-pilot-20260715`를 실행해 원본 파일 해시를 재검증하고 fresh archive 폴더와 `pilot-archive-manifest.json`을 장기 보관 대상으로 고정한다. 장기 보관소 업로드 전후에는 `npm run pilot:storage-receipt:draft -- --archive=.data/pilot-archives/final-judo-pilot-20260715/pilot-archive-manifest.json --out=.data/pilot-storage-receipt.json`로 archive manifest SHA-256/byte size와 산출물별 archivedPath/sha256/sizeBytes가 채워진 receipt 초안을 만든다. 업로드 후에는 실제 보관 위치, 담당자, provider, 증빙, 최소 365일 보존 정책, 산출물별 업로드 위치를 채우고 `npm run pilot:storage-receipt -- --file=.data/pilot-storage-receipt.json --archive=.data/pilot-archives/final-judo-pilot-20260715/pilot-archive-manifest.json`를 통과시켜 최종 증빙으로 남긴다. 마지막 제출 전 `npm run pilot:final-handoff -- --artifact-manifest=.data/pilot-artifact-manifest.json --archive-manifest=.data/pilot-archives/final-judo-pilot-20260715/pilot-archive-manifest.json --storage-receipt=.data/pilot-storage-receipt.json --out=.data/pilot-final-handoff.json`와 `npm run pilot:status -- --strict --out=.data/pilot-status.json`를 실행해 준비 증빙 CSV, 비밀번호 교체 CSV, artifact manifest, archive manifest, storage receipt, final handoff가 같은 산출물 세트를 가리키는지 최종 인수인계 단위로 검증하고 상태 리포트를 보관한다. PostgreSQL 운영 DB에서는 마지막 status에도 `--driver=postgres --state-key=<key> --postgres-url=<url>`을 붙여 운영 runtime row 기준으로 검증한다.

| 일차 | 확인 항목 | 담당 | 상태 |
| --- | --- | --- | --- |
| D-3 | 파일럿 지점/계정/시간표 확정 | 총괄 PM | 확인 필요 |
| D-2 | 실제 데이터 반입/마스킹 확인 | 대표 + 총괄 PM | 확인 필요 |
| D-1 | 코치 모바일 기기 테스트 | 코치 + QA | 확인 필요 |
| D1-D14 | 출석, 결제 상태, 공지 일일 점검 | 지점 대표 | 확인 필요 |
| D7 | 중간 회고, P0/P1 결함 정리 | 총괄 PM | 확인 필요 |
| D15 | 종료 회고, 출시/개선 판단 | 총괄 PM | 확인 필요 |

## 8. 파일럿 종료 피드백

피드백은 `docs/pilot-templates/pilot-feedback-form.md`를 사용한다.

성공 판단:

- P0 결함 0건
- 지점 데이터 섞임 0건
- 코치 출석 처리 30초 이내 가능
- 대표가 미납/만료 예정과 CSV를 확인 가능
- 학부모/회원이 자기 데이터만 확인 가능
- 감사 로그로 주요 변경 추적 가능
