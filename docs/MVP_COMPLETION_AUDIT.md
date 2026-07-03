# 파이널 유도 멀티짐 MVP 완료 감사

작성일: 2026-06-14
기준 문서: `docs/FINAL_MVP_PRODUCT_SPEC.md`, `MVP_SCOPE.md`, `docs/IMPLEMENTATION_BACKLOG.md`
판정: P0 개발 구현 및 로컬 검증 완료, 파일럿 현장 운영 확인은 남음

## 1. 감사 범위

이 문서는 최종 MVP 설계서의 릴리즈 통과 기준을 현재 코드, 문서, 자동 검증, 브라우저 확인 결과와 대조한다.

현재 앱은 Next.js 16 Route Handler와 JSON-backed 저장소로 운영 흐름을 구현했고, `FINAL_JUDO_DB_DRIVER=postgres` 설정 시 PostgreSQL `app_runtime_state` JSONB 런타임 저장소를 사용할 수 있다. PostgreSQL SQL migration/seed는 `npm run test:db`로, runtime store는 `npm run test:postgres-store`로 적용 검증했다. 파일럿 JSON 저장소는 원자적 쓰기, 최신 스냅샷 백업, primary JSON 복구, 기본 collection shape 검증을 포함한다. iOS/Android 홈 화면 설치를 위한 PWA manifest, 앱 아이콘, standalone 시작 경로, iOS web app metadata, 모바일 viewport/theme color, production 서비스 워커 등록, 오프라인 앱 셸 캐시, API 응답 캐시 금지 정책은 `npm run test:mobile-install`로 검증한다.
운영 로그인은 이메일/임시 비밀번호를 기본 경로로 사용하며, 초대 가입은 12자 이상 초기 비밀번호 설정 후 완료된다. 총괄 어드민은 사용자별 임시 비밀번호를 발급할 수 있다. 서버 저장소의 `passwordHash`는 bootstrap/snapshot 응답에서 제거하고, 원문 비밀번호는 저장소/감사 로그에 남기지 않는다.

## 2. 릴리즈 조건별 증거

| 조건 | 현재 판정 | 증거 |
| --- | --- | --- |
| 총괄 어드민이 지점을 만들고 대표를 배정할 수 있다. | 충족 | `/api/v1/admin/branches`, `/api/v1/admin/branches/:branchId/owner`, `/app/admin/branches`, `npm run test:smoke`의 `branch create/update/owner assignment` |
| 대표가 회원, 학부모, 코치, 수업, 회원권을 생성/수정할 수 있다. | 충족 | 회원 생성/수정, 보호자 연결, 대표 지점 범위 초대, 수업 생성/수정, 수기 결제/회원권 상태 등록을 `npm run test:smoke`가 검증 |
| 코치가 모바일에서 수업별 출석을 30초 이내 처리할 수 있다. | 부분 충족 | `/app/classes` 모바일 출석 UI, 수업 단위 `전체 출석` 일괄 저장 버튼, 48px 개별 출석 버튼, sticky 저장 상태, 새로고침 후 복구되는 오프라인 대기 큐와 재동기화 액션, `npm run test:attendance-speed`의 담당 수업 전체 명단 30초 게이트와 감사 로그 검증, `npm run test:e2e`의 390px Chrome 코치 운영 계정 로그인/전체 출석/개별 출석/오프라인 복구/재동기화 검증. 실제 현장 기기/사람 계측은 파일럿 테스트 필요 |
| 회원/학부모가 일정, 출석, 결제 상태, 공지를 확인할 수 있다. | 충족 | 역할별 bootstrap 스코프, 회원/학부모 화면, 공지 읽음/대상 스모크, `npm run test:smoke`의 member/guardian scope |
| 요청 기능은 앱에서 노출되지 않고 서버 변이를 만들지 않는다. | 충족 | `/app/requests`, `/requests`, `/api/v1/requests*`가 404이며 요청 생성/승인/반려 route 파일이 삭제됨을 `npm run build`, `npm run test:routes`, `npm run test:api-auth-order`가 검증 |
| 결제 상태가 회원별로 표시되고 미납/만료 예정자를 필터링할 수 있다. | 충족 | `/app/payments` 상태 필터, 위험 결제 재계산, 수기 결제/환불/취소 스모크 |
| 코치는 결제 금액을 볼 수 없고, 대표는 자기 지점 데이터만 볼 수 있다. | 충족 | 서버 snapshot 코치 결제 금액 마스킹, 코치 payments 직접 URL 403, 대표 selected branch scope를 `npm run test:smoke`와 route smoke가 검증 |
| 총괄 어드민의 전체 접근과 주요 변경은 감사 로그에 남는다. | 충족 | `audit_logs.read`, 권한 변경, 임시 비밀번호 발급, 지점/회원/수업/결제/공지/출석/CSV 이벤트를 `npm run test:smoke`가 검증 |
| 지점 간 데이터가 섞이지 않는다. | 충족 | `createSafeSnapshot`, branch scope 403, representative selected branch scope, PostgreSQL branch_id schema, `npm run test:smoke` |
| 핵심 데이터는 CSV로 내보낼 수 있다. | 충족 | `/api/v1/exports/payments`, `/api/v1/exports/operations`, `export.create` 감사 로그를 `npm run test:smoke`가 검증 |
| 관리자, 코치, 학부모 모바일 화면에서 주요 업무가 깨지지 않는다. | 충족 | 브라우저 390px 검증 기록: `/app/classes`, `/app/members`, `/app/payments`, `/app/notices`, `/app/notifications`, `/app/admin/*`, `/app/owner/*`, `/select-role` 가로 overflow 없음. `/app/requests`와 `/requests`는 제공하지 않고 404로 처리한다. `npm run test:mobile-install`로 iOS/Android 홈 화면 설치용 manifest, standalone `/app` 시작 경로, 192/512 앱 아이콘, iOS web app metadata, 모바일 viewport/theme color, production 서비스 워커 등록, 오프라인 앱 셸 캐시, API 응답 캐시 금지 검증 |
| 파일럿 지점에서 최소 2주 동안 실제 출석과 결제 상태를 운영할 수 있다. | 현장 확인 필요 | `docs/PILOT_OPERATIONS_RUNBOOK.md`, `docs/RELEASE_CHECKLIST.md`, `/app/admin/settings` 파일럿 준비 게이트와 상태/담당자/증빙 트래커, 파일럿 이슈 로그, 14일 운영 로그, 기본 임시 비밀번호 교체 보안 체크, 2개 지점 파일럿 데이터 intake/피드백 양식, 현장 증빙 manifest 템플릿, `npm run test:pilot`, `npm run test:pilot-import`, `npm run test:pilot-prelaunch-draft`, `npm run test:pilot-launch-package`, `npm run test:pilot-launch-command`, `npm run test:pilot-readiness-evidence`, `npm run test:pilot-readiness-evidence-apply`, `npm run test:pilot-password-rotation`, `npm run pilot:prelaunch-draft -- --out-dir=.data`, `npm run pilot:readiness-evidence:draft -- --phase=pre-pilot --out=.data/pilot-readiness-evidence.csv`, `npm run pilot:readiness-evidence -- --file=.data/pilot-readiness-evidence.csv --phase=pre-pilot`, `npm run pilot:readiness-evidence:apply -- --file=.data/pilot-readiness-evidence.csv --phase=pre-pilot --actor-user-id=user-admin`, `npm run pilot:password-rotation:draft -- --runtime=.data/final-judo-db.json --out=.data/pilot-password-rotation.csv`, `npm run pilot:password-rotation -- --runtime=.data/final-judo-db.json --file=.data/pilot-password-rotation.csv`, `npm run pilot:import -- <csv>`, `npm run pilot:import:postgres -- <csv>`, `npm run pilot:launch-package -- --csv=docs/pilot-templates/pilot-data-intake.csv --readiness-evidence=.data/pilot-readiness-evidence.csv --password-rotation=.data/pilot-password-rotation.csv --out=.data/pilot-launch-package.json`, `NODE_ENV=production npm run preflight:pilot -- --out=.data/pilot-preflight.pre-pilot.json`, `NODE_ENV=production npm run preflight:pilot -- --require-retro --out=.data/pilot-preflight.post-pilot.json`, `npm run pilot:evidence -- --require-retro --out=.data/pilot-evidence.post-pilot.json`, `npm run pilot:evidence -- --require-retro --format=markdown --out=.data/pilot-evidence.md`, `npm run pilot:field-evidence:draft -- --source-csv=docs/pilot-templates/pilot-data-intake.csv --pre-pilot-evidence=.data/pilot-evidence.json --post-pilot-evidence=.data/pilot-evidence.post-pilot.json --post-pilot-markdown=.data/pilot-evidence.md --out=.data/pilot-field-evidence.json`, `npm run pilot:field-evidence -- --file=.data/pilot-field-evidence.json --report=.data/pilot-evidence.post-pilot.json`, `npm run pilot:closeout-package -- --field=.data/pilot-field-evidence.json --preflight=.data/pilot-preflight.post-pilot.json --report=.data/pilot-evidence.post-pilot.json --markdown=.data/pilot-evidence.md --out=.data/pilot-closeout-package.json`, `npm run pilot:artifact-manifest -- --preflight-pre=.data/pilot-preflight.pre-pilot.json --evidence-pre=.data/pilot-evidence.json --evidence-pre-markdown=.data/pilot-evidence.pre-pilot.md --readiness-evidence=.data/pilot-readiness-evidence.csv --launch-package=.data/pilot-launch-package.json --password-rotation=.data/pilot-password-rotation.csv --preflight-post=.data/pilot-preflight.post-pilot.json --evidence-post=.data/pilot-evidence.post-pilot.json --evidence-markdown=.data/pilot-evidence.md --field=.data/pilot-field-evidence.json --closeout=.data/pilot-closeout-package.json --out=.data/pilot-artifact-manifest.json`, `npm run pilot:archive-artifacts -- --manifest=.data/pilot-artifact-manifest.json --archive-dir=.data/pilot-archives/final-judo-pilot-20260715`, `npm run pilot:storage-receipt:draft -- --archive=.data/pilot-archives/final-judo-pilot-20260715/pilot-archive-manifest.json --out=.data/pilot-storage-receipt.json`, `npm run pilot:storage-receipt -- --file=.data/pilot-storage-receipt.json --archive=.data/pilot-archives/final-judo-pilot-20260715/pilot-archive-manifest.json`, `npm run pilot:final-handoff -- --artifact-manifest=.data/pilot-artifact-manifest.json --archive-manifest=.data/pilot-archives/final-judo-pilot-20260715/pilot-archive-manifest.json --storage-receipt=.data/pilot-storage-receipt.json --out=.data/pilot-final-handoff.json`, `npm run pilot:status -- --strict --out=.data/pilot-status.json` 준비. 실제 지점/계정/기기/2주 운영과 장기 보관소 업로드 receipt/final handoff 작성은 외부 운영 단계 |

## 3. 최신 검증 결과

| 명령/검증 | 결과 |
| --- | --- |
| `npm run test:release` | 통과. `npm audit --audit-level=moderate`, `test:mobile-install`, `test:preflight`, 파일럿 readiness evidence/password rotation/field evidence draft/artifact manifest/archive/storage receipt draft/storage receipt/final handoff/status 게이트 포함 |
| `npm run lint` | 통과 |
| `npm run build` | 통과 |
| `npm audit --audit-level=moderate` | 통과. 취약점 0건 |
| `npm run test:unit` | 통과. 역할/RBAC 매핑, 메뉴 접근, 지점/회원 스코프, 공지 대상 지정 규칙 검증 |
| `npm run test:store` | 통과. JSON 저장소 기본 생성, 원자적 쓰기, 백업 pruning, 깨진 JSON/shape 복구 검증 |
| `npm run test:auth-production-guard` | 통과. production 데모 역할 로그인 기본 차단, `FINAL_JUDO_ENABLE_DEMO_LOGIN=1` 명시 허용, secure/httpOnly session cookie, 기본 임시 비밀번호 해시 검증 |
| `npm run test:dev-reset-guard` | 통과. production reset API 기본 차단, `FINAL_JUDO_ENABLE_DEV_RESET=1` 명시 허용 검증 |
| `npm run test:mobile-install` | 통과. iOS/Android 홈 화면 설치용 manifest, standalone `/app` start URL, 192/512 앱 아이콘, iOS apple web app, 모바일 viewport/theme color, production 서비스 워커 등록, 오프라인 앱 셸 캐시, API 응답 캐시 금지 검증 |
| `npm run test:e2e` | 통과. 390px Chrome 코치 운영 계정 로그인, 전체 출석 일괄 저장, 개별 출석 변경, 새로고침 후 오프라인 대기 큐 복구와 재동기화, sticky 저장 상태, 감사 로그, 코치 결제 금액 마스킹 검증 |
| `npm run test:routes` | 통과 |
| `npm run test:smoke` | 통과. 파일럿 운영 로그 생성/감사 로그와 불가능한 운영일·차단 사유 누락 거절 검증 포함 |
| 운영 계정 로그인 smoke | 통과. `admin@finaljudo.test` / 기본 임시 비밀번호 로그인, 잘못된 비밀번호 401, 초대 수락 초기 비밀번호 설정과 기본 비밀번호/링크 재사용 차단, 사용자별 임시 비밀번호 발급 후 신규 비밀번호 로그인, `passwordHash` 응답 마스킹과 원문 비밀번호 감사 로그 미저장 검증 |
| `npm run test:db` | 통과 |
| `npm run test:postgres-store` | 통과. Docker PostgreSQL runtime store 연결, reset/write/read, revision, JSONB row, 파일럿 CSV import, 준비 증빙 CSV draft/apply, 계정별 비밀번호 교체 CSV 검증, `pilot_readiness.update` 감사 로그, PostgreSQL 파일럿 prelaunch draft/launch package/evidence/status와 DB URL 비밀번호 redaction 검증 |
| `npm run test:pilot` | 통과. 강남 본관/송파 도장 2개 지점 샘플, warnings 0건 |
| `npm run test:pilot-readiness-contract` | 통과. 기본 파일럿 준비 항목, 파일럿 import 생성 항목, production preflight 필수 항목의 ID/문구/담당자 정합성 검증 |
| `npm run test:pilot-import` | 통과. 파일럿 CSV를 dry-run으로 운영 DB shape 변환, 지점 2/사용자 8/회원 3/수업 2/회원권 3/공지 2 확인 |
| `npm run test:pilot-prelaunch-draft` | 통과. 준비 증빙 CSV, 계정별 비밀번호 교체 CSV, audit launch package, pre-pilot evidence/preflight/status, blocked next action summary 생성 검증 |
| `npm run test:pilot-launch-package` | 통과. 파일럿 시작 전 CSV 검증, import dry-run, pre-pilot evidence JSON/Markdown, 현장 증빙 manifest 템플릿, README/런북/릴리즈 체크리스트/QA 명령 안내 검증 |
| `npm run test:pilot-launch-command` | 통과. `pilot:launch-package` audit/strict 종료 코드, blocked launch package 보존, pre-pilot evidence/preflight/Markdown/readiness evidence/password rotation 산출물 요약 생성, archived commands의 PostgreSQL URL 비밀번호 redaction을 검증 |
| `npm run test:pilot-readiness-evidence` | 통과. 공유 readiness 계약 기반 준비 증빙 CSV 초안, pre-pilot retro 제외, pending collection template, verified 증빙, placeholder/unknown/missing ID 차단 검증 |
| `npm run test:pilot-readiness-evidence-apply` | 통과. 검증된 준비 증빙 CSV의 dry-run/write, pre-pilot readiness 런타임 반영, `pilot_readiness.update` 감사 로그, retro 유지, idempotent 재실행, pending/non-admin/invalid checkedAt 차단 검증 |
| `npm run test:pilot-password-rotation` | 통과. 계정별 비밀번호 교체 CSV 초안, 기본 임시 비밀번호 잔존, 계정 누락, 감사 로그 누락, 원문 임시 비밀번호 노출 차단 검증 |
| `npm run test:preflight` | 통과. 운영 전 preflight의 통과 fixture와 `--out` JSON 아티팩트 저장, 기본 임시 비밀번호/증빙/P0 이슈/production 플래그/깨진 사용자·회원·수업·공지·상담 메모 참조/런타임 민감정보/불가능한 운영일/차단 사유 없는 운영 로그/모바일 출석 30초 계측 증빙 누락 차단/post-pilot 14일 운영 로그 fixture 검증 |
| `npm run test:preflight-runtime` | 통과. 현재 런타임 `.data` preflight 감사 결과에서 남아 있는 데모 기본 비밀번호 blocker, warning/count와 참조 오류, 민감정보, 운영 로그 오류 없음 검증 |
| `npm run test:pilot-evidence` | 통과. 파일럿 증빙 JSON/Markdown 리포트가 runtime/preflight/준비 항목/이슈/출석·결제·공지 후속·공지 운영 로그 요약과 post-pilot 차단 조건을 포함하는지 검증 |
| `npm run test:pilot-field-evidence-draft` | 통과. source CSV와 pre/post evidence 리포트에서 현장 증빙 manifest 초안의 지점/계정/명령/운영 수치를 자동 반영하고, placeholder 초안 차단과 운영자가 채운 manifest의 validator 통과를 검증 |
| `npm run test:pilot-field-evidence` | 통과. 현장 증빙 manifest 검증기의 템플릿 shape, 통과 fixture, source CSV 검증과 dry-run/import 명령 CSV 참조, manifest 지점/계정 email·role·branchScope 대조, pre-pilot evidence readiness와 source CSV count 대조, 스크린리더 출석 상태/공지 읽음 상태의 기대·실제 낭독과 이슈 없음 기록, Markdown 파일 존재, 실패 fixture와 모바일 기기/데이터 import/14일 고유 운영일/검증 운영일/공지 후속/공지/P0 blocker/post-pilot 리포트 수치·경로·freshness·signoff chronology·Markdown 내용 불일치를 검증 |
| `npm run test:pilot-closeout-package` | 통과. post-pilot strict preflight JSON, `pilot:evidence` JSON, Markdown 회고 리포트, 현장 증빙 manifest를 하나의 ready 판단 패키지로 묶고 blocked preflight/Markdown 누락 fixture를 차단하는지 검증 |
| `npm run test:pilot-artifact-manifest` | 통과. pre/post preflight, `pilot:evidence` JSON/Markdown, launch package, password rotation CSV, 현장 manifest, closeout package의 ready 상태와 SHA-256 해시 manifest 생성, 변조된 launch package/closeout 및 누락 파일 차단 검증 |
| `npm run test:pilot-archive-artifacts` | 통과. ready artifact manifest 원본 파일의 SHA-256/byte size 재검증, fresh archive 복사, 복사본 해시 검증, archive manifest 생성, 변조 파일/blocked manifest/기존 archive 폴더/placeholder 경로 차단 검증 |
| `npm run test:pilot-storage-receipt-draft` | 통과. archive manifest에서 장기 보관 receipt 초안의 archive manifest SHA-256/byte size와 산출물별 archivedPath/sha256/sizeBytes를 자동 반영하고, placeholder 초안 차단과 운영자가 채운 receipt의 validator 통과를 검증 |
| `npm run test:pilot-storage-receipt` | 통과. archive manifest와 장기 보관 업로드 receipt의 보관 URI, 업로드 담당자/provider/evidence, 최소 365일 보존 정책, 산출물별 경로/해시/byte size/storage location, archive copy 해시 대조와 placeholder/누락/시간순서/변조 차단 검증 |
| `npm run test:pilot-final-handoff` | 통과. artifact manifest, archive manifest, storage receipt가 같은 산출물 경로/해시/byte size를 가리키는지, storage receipt 검증이 ready인지, 누락 archive 항목/변조 archive 파일/blocked manifest fixture를 차단하는지 검증 |
| `npm run test:pilot-status` | 통과. 파일럿 런타임, pre/post preflight/evidence, pre-pilot Markdown, 준비 증빙 CSV, 비밀번호 교체 CSV, launch package, 현장 manifest, closeout, artifact/archive manifest, storage receipt, final handoff 단계별 ready 판정과 다음 액션, runtime waiting/readiness evidence missing의 prelaunch draft 우선 안내, readiness/password rotation CSV 누락 전용 액션, missing/waiting/blocked non-ready blocker 목록, ready/blocked status JSON 출력 저장, strict final handoff 재검증, 변조 archive 실패 fixture 검증. PostgreSQL runtime source status는 `npm run test:postgres-store`에서 검증 |
| `npm run test:release-docs` | 통과. `test:release` 실행 목록의 package script와 README, QA 계획, 릴리즈 체크리스트 안내가 누락 없는지 검증 |
| `npm run test:admin-settings-gates` | 통과. `/app/admin/settings` 자동 검증 명령과 `test:release` 실행 목록 정합성 검증 |
| `npm run preflight:pilot -- --allow-incomplete` | 통과. 현재 데모 런타임 기준 운영 전 차단 조건 감사 리포트 생성 가능. 실제 파일럿 데이터와 production 환경에서는 strict 모드로 실행 필요 |
| `npm run test:attendance-speed` | 통과 |
| `npm run test:a11y-static` | 통과 |
| 스모크 테스트 데이터 격리 | `test:smoke`, `test:attendance-speed`, `test:release` 후 `.data`가 지점 2개/출석 3건/감사 로그 0건 기준 상태 유지 |
| Browser 390px `/app/classes` | 전체 출석 버튼 4개 표시, 버튼 높이 44px, 개별 출석 상태 버튼 35개, `documentScrollWidth=390`, 출석 요약과 sticky 저장 상태 표시 |
| Browser 390px `/select-role` | 역할 선택 버튼 5개, 최소 96px 터치 영역, 가로 overflow 없음 |
| Browser 390px `/app/notices` | 지점 전체/반/개인 대상 UI, 대상 선택, 가로 overflow 없음 |
| Browser 390px `/app/admin/settings` | 지점 2개 기준 데이터, 파일럿 준비 게이트, 자동 검증 명령, 보안 audit, 런타임 preflight 감사, 파일럿 증빙 리포트, 파일럿 준비 계약 검사, 현장 확인 필요 항목과 상태/담당자/증빙 입력, 파일럿 이슈 로그, 14일 운영 로그 표시. `documentScrollWidth=390`, 하단 모바일 메뉴 외 페이지 가로 오버플로 없음 |

## 4. 남은 외부 확인

- 파일럿 지점 1-2곳 확정
- 대표/코치/학부모/회원 실제 파일럿 계정 확정
- 실제 시간표, 회원권 상태, 결제 상태 데이터 입력과 `npm run test:pilot` 재검증
- 실제 파일럿 CSV의 `npm run test:pilot-import` dry-run, `npm run test:pilot-launch-package`, `npm run test:pilot-launch-command` 확인 후 JSON 운영은 `npm run pilot:import -- <csv>`, PostgreSQL 운영은 `npm run pilot:import:postgres -- <csv>` 반영
- `npm run pilot:prelaunch-draft -- --out-dir=.data`로 준비 증빙 CSV, 계정별 비밀번호 교체 CSV, audit launch package, pre-pilot evidence/preflight/status, 요약 JSON 초안을 한 번에 생성. PostgreSQL 운영 DB에서는 `--driver=postgres --state-key=<key> --postgres-url=<url>`을 함께 사용
- `npm run pilot:readiness-evidence:draft -- --phase=pre-pilot --out=.data/pilot-readiness-evidence.csv`로 준비 증빙 CSV 초안을 만들고 owner/status/evidence를 채운 뒤 `npm run pilot:readiness-evidence -- --file=.data/pilot-readiness-evidence.csv --phase=pre-pilot` 통과. PostgreSQL 운영 DB에서는 draft/apply 모두 `--driver=postgres --state-key=<key> --postgres-url=<url>`로 같은 runtime state를 참조한다. 검증된 내용은 `npm run pilot:readiness-evidence:apply -- --file=.data/pilot-readiness-evidence.csv --phase=pre-pilot --actor-user-id=user-admin` 또는 `/app/admin/settings`로 반영해 감사 로그를 남겨야 함
- `/app/admin/users`에서 계정별 임시 비밀번호를 발급하고 `npm run pilot:password-rotation:draft -- --runtime=.data/final-judo-db.json --out=.data/pilot-password-rotation.csv`, `npm run pilot:password-rotation -- --runtime=.data/final-judo-db.json --file=.data/pilot-password-rotation.csv` 통과. CSV에는 감사 로그 ID와 전달 채널 증빙만 남기고 원문 임시 비밀번호는 남기지 않아야 함
- 현장 코치 모바일 기기에서 출석 30초 처리 계측 후 `/app/admin/settings` 일일 운영 로그에 처리 시간과 녹화/캡처 증빙 기록
- 실제 iOS/Android 기기에서 홈 화면 설치 후 standalone 실행, `/app` 시작 경로, 로그인 유지, 하단 내비게이션 safe area 표시를 확인하고 증빙 기록
- 접근성 현장 확인. 정적 가드레일은 `npm run test:a11y-static`으로 통과했고, 스크린리더 기대/실제 낭독 기록과 이슈 없음 증빙은 `npm run test:pilot-field-evidence`가 차단 조건으로 검증
- 장애 보고 채널과 파일럿 운영 중단 기준 확정, 담당자가 `/app/admin/settings` 파일럿 이슈 로그를 운영할지 최종 확인
- `/app/admin/settings`의 파일럿 준비 게이트, 파일럿 이슈 로그, 14일 운영 로그에서 자동 검증, 현장 확인 상태/담당자/증빙, 운영 중 이슈 상태, 일일 출석/결제 확인 수치 최종 대조
- 실제 파일럿 데이터 반영 후 `NODE_ENV=production npm run preflight:pilot -- --out=.data/pilot-preflight.pre-pilot.json` strict 모드 통과 및 결과 파일 보관
- 파일럿 시작 전 `npm run pilot:launch-package -- --csv=docs/pilot-templates/pilot-data-intake.csv --readiness-evidence=.data/pilot-readiness-evidence.csv --password-rotation=.data/pilot-password-rotation.csv --out=.data/pilot-launch-package.json` strict 모드 통과 및 `.data/pilot-launch-package.json`, `.data/pilot-evidence.json`, `.data/pilot-evidence.pre-pilot.md`, `.data/pilot-preflight.pre-pilot.json`, `.data/pilot-readiness-evidence.csv`, `.data/pilot-password-rotation.csv` 보관. PostgreSQL 운영 DB에서는 `--driver=postgres --state-key=<key> --postgres-url=<url>`을 함께 사용하고, 패키지의 runtime/commands에 DB URL 비밀번호가 `REDACTED`로만 기록되는지 확인. 준비 중 리허설은 `--allow-incomplete`로 blocked 패키지를 보관
- 파일럿 운영 전/후 `npm run pilot:evidence -- --out=.data/pilot-evidence.json`, `npm run pilot:evidence -- --require-retro --out=.data/pilot-evidence.post-pilot.json`, 또는 Markdown 리포트 생성 및 보관
- 파일럿 2주 운영과 회고 후 `NODE_ENV=production npm run preflight:pilot -- --require-retro --out=.data/pilot-preflight.post-pilot.json` post-pilot strict 모드 통과. 출석 기록이 있는 verified 운영 로그에는 모바일 30초 계측 증빙 필요
- `npm run pilot:field-evidence:draft -- --source-csv=docs/pilot-templates/pilot-data-intake.csv --pre-pilot-evidence=.data/pilot-evidence.json --post-pilot-evidence=.data/pilot-evidence.post-pilot.json --post-pilot-markdown=.data/pilot-evidence.md --out=.data/pilot-field-evidence.json`로 source CSV 지점/계정과 post-pilot 운영 수치가 채워진 field evidence 초안 생성
- `.data/pilot-field-evidence.json`을 실제 증빙 링크와 담당자 signoff, 스크린리더 기대/실제 낭독, 계정별 비밀번호 교체/로그인, 현장 기기, 환경 플래그 증빙으로 채운 뒤 `npm run pilot:field-evidence -- --file=.data/pilot-field-evidence.json --report=.data/pilot-evidence.post-pilot.json` 통과. source CSV는 실제 파일로 존재하고 pilot CSV 검증을 통과해야 하며 dry-run/import 명령이 같은 CSV를 참조해야 한다. manifest 지점 목록과 계정 email/role/branchScope는 source CSV와 일치해야 한다. 스크린리더는 출석 상태와 공지 읽음 상태 각각의 route/target/기대 낭독/실제 낭독/이슈 없음/메모/증빙 링크를 포함해야 한다. pre-pilot JSON은 파일럿 시작 전 생성된 ready 리포트이고 source CSV의 지점/계정/회원/수업/결제/공지 예상 수와 맞아야 하며, JSON/Markdown 회고 파일은 존재하고 post-pilot/ready/고유 운영일/검증 운영일/운영 수치가 manifest와 맞아야 하며, 생성 시각이 파일럿 종료일 이후이고 총괄 PM signoff가 리포트 생성 이후여야 함
- post-pilot strict preflight, JSON/Markdown 회고 리포트, 현장 증빙 manifest가 모두 준비되면 `npm run pilot:closeout-package -- --field=.data/pilot-field-evidence.json --preflight=.data/pilot-preflight.post-pilot.json --report=.data/pilot-evidence.post-pilot.json --markdown=.data/pilot-evidence.md --out=.data/pilot-closeout-package.json` 통과 및 `.data/pilot-closeout-package.json` 보관
- closeout package까지 ready 상태이면 `npm run pilot:artifact-manifest -- --preflight-pre=.data/pilot-preflight.pre-pilot.json --evidence-pre=.data/pilot-evidence.json --evidence-pre-markdown=.data/pilot-evidence.pre-pilot.md --readiness-evidence=.data/pilot-readiness-evidence.csv --launch-package=.data/pilot-launch-package.json --password-rotation=.data/pilot-password-rotation.csv --preflight-post=.data/pilot-preflight.post-pilot.json --evidence-post=.data/pilot-evidence.post-pilot.json --evidence-markdown=.data/pilot-evidence.md --field=.data/pilot-field-evidence.json --closeout=.data/pilot-closeout-package.json --out=.data/pilot-artifact-manifest.json` 통과 및 `.data/pilot-artifact-manifest.json` 보관
- artifact manifest까지 ready 상태이면 `npm run pilot:archive-artifacts -- --manifest=.data/pilot-artifact-manifest.json --archive-dir=.data/pilot-archives/final-judo-pilot-20260715` 통과 및 archive 폴더/`pilot-archive-manifest.json` 장기 보관
- archive manifest가 ready 상태이면 `npm run pilot:storage-receipt:draft -- --archive=.data/pilot-archives/final-judo-pilot-20260715/pilot-archive-manifest.json --out=.data/pilot-storage-receipt.json`로 장기 보관 receipt 초안 생성. archive manifest SHA-256/byte size와 산출물별 archivedPath/sha256/sizeBytes는 자동 반영되어야 함
- 장기 보관소 업로드 후 `docs/pilot-templates/pilot-storage-receipt.template.json`을 `.data/pilot-storage-receipt.json`으로 채우고 `npm run pilot:storage-receipt -- --file=.data/pilot-storage-receipt.json --archive=.data/pilot-archives/final-judo-pilot-20260715/pilot-archive-manifest.json` 통과 및 receipt 보관
- 최종 제출 전 `npm run pilot:final-handoff -- --artifact-manifest=.data/pilot-artifact-manifest.json --archive-manifest=.data/pilot-archives/final-judo-pilot-20260715/pilot-archive-manifest.json --storage-receipt=.data/pilot-storage-receipt.json --out=.data/pilot-final-handoff.json` 통과 및 `.data/pilot-final-handoff.json` 보관
- 최종 제출 전 `npm run pilot:status -- --strict --out=.data/pilot-status.json` 통과 및 `.data/pilot-status.json` 보관. PostgreSQL 운영 DB에서는 `--driver=postgres --state-key=<key> --postgres-url=<url>`을 함께 사용. 런타임, 준비 증빙 CSV, 비밀번호 교체 CSV, pre/post 증빙, 보관 receipt, final handoff 단계가 모두 ready이고 현재 archive 해시와 저장된 handoff JSON이 일치해야 하며, blocked 리포트에서는 missing/waiting/blocked non-ready 항목이 `blockers`에 남아야 함
- production 운영 환경에서 `FINAL_JUDO_ENABLE_DEMO_LOGIN`이 불필요하게 설정되지 않았는지 배포 전 확인
- production 운영 환경에서 `FINAL_JUDO_ENABLE_DEV_RESET`이 설정되지 않았는지 배포 전 확인
- 기본 임시 비밀번호 `FinalJudoPilot!2026`을 `/app/admin/users`에서 실제 파일럿 계정별 값으로 교체하고 `/app/admin/settings` 보안 체크에 증빙을 남겼는지 배포 전 확인

## 5. 결론

현재 저장소 기준 P0 개발 구현, 문서화, 로컬 자동 검증은 완료 상태다. 단, 최종 릴리즈 조건 중 "파일럿 지점 2주 실제 운영"은 코드로 증명할 수 없는 외부 운영 단계이므로, 파일럿 운영 후 별도 결과 기록이 필요하다.
