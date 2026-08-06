# 파이널 유도 멀티짐 MVP 파일럿 릴리즈 체크리스트

작성일: 2026-06-13
대상: 파일럿 운영 전 최종 확인

## 1. 빌드/품질

- [x] `npm run lint` 통과
- [x] `npm run build` 통과
- [x] `npm run lint`와 `npm run build`가 `node_modules/.bin` shim 없이도 직접 package entrypoint로 실행 가능
- [x] Next production build trace에서 `.data` 런타임/증빙 산출물 제외
- [x] `npm audit --audit-level=moderate` 취약점 0건
- [x] `npm run test:unit` 도메인 규칙 단위 테스트 통과
- [x] `npm run test:adversarial-design-fixes` 역할별 모바일 화면의 우선순위·지점 식별·공지 본문·출석 명단·학부모 행동·대표 리포트·내비게이션 회귀 검증 통과
- [x] `npm run test:final-common-fee-policy` 공통 회비 상품·할인·1+1 연장 규칙과 유효 날짜 경계 통과
- [x] `npm run test:final-main-schedule-policy` 본관 전용 수업 시간표·훈련 프로그램과 전 지점 공통 정책 분리 통과
- [x] `npm run test:final-common-promotion-policy` 전 지점 공통 승급 기간·월 수련시간·1일 최대 인정시간·심사일·정확한 다음 띠·코치 범위 통과
- [x] `npm run test:promotion-api-integrity` 격리 저장소·서버 기반 잘못된 생성·결과 본문과 201자 회원 ID·501자 공개 메모 무변경 차단, 서버·UI 500자 공개 메모 상한, 비심사일 등록, 미래 결과, 띠 건너뛰기, 지점·코치 범위, 동시 등록 고유 ID와 같은 대상 중복 반영 차단 통과
- [x] `npm run test:final-policy-ui` 회비·본관 시간표·승급 기준의 역할별 UI 연결과 정책 원문 정합성 통과
- [x] `npm run test:role-csv-export-gates` 회원/학부모 CSV 내보내기 비노출, 대표/총괄 export API/UI 전용 가드, 최신 계정·지점 권한 재검사, 동시 CSV 감사 보존, 회원/학부모 CSV export API 403 smoke 증거 통과
- [x] `npm run test:deleted-request-surface` 삭제된 `/app/requests`, `/requests`, 요청 생성/승인/반려 API, 보강 메뉴/카드/알림 링크 재유입 차단과 release runner/문서 등록 검증 통과
- [x] `npm run test:store` JSON 저장소 백업/복구, 동일 키 operation lock, 서로 다른 인스턴스·Node 프로세스의 stale 파일 병합, 휴대폰·이메일 유일성과 핵심 참조 무결성, 같은 결제·동일 필드 충돌 차단, 비직렬화 메타와 stale demo seed 날짜 보정 테스트 통과
- [x] `npm run test:store-write-validation`, `npm run test:runtime-state-integrity`, `npm run test:runtime-state-tools` 통과. 읽기 검증은 기존 데이터를 자동 변경하지 않고, 쓰기는 기존 스냅샷과 비교해 새 무결성 결함만 차단하며, 명시적 복구는 변경마다 `system.integrity.repair` 감사 기록을 남긴다. 출석·결제 이력은 자동 삭제하지 않고 운영 복제본 검사는 레코드 식별자·개인정보를 출력하지 않는다.
- [x] `npm run test:auth-production-guard`, `npm run test:phone-signup-security`, `npm run test:phone-signup-login-flow` production 데모 로그인 차단/세션 쿠키 정책, 로그인·초대 수락·재설정 요청의 서버/UI 입력 상한, 휴대폰 직접 가입의 지점 검증·번호별 잠금·원문 비저장·기존 계정 중립 오류·동시 요청 단일 성공, 390px 가입/로그인 흐름과 로컬 자동로그인 `next`의 같은 오리진·길이 제한 통과
- [x] `npm run test:google-play-review-access`, `npm run test:google-play-review-api` Google Play 검토 지점·역할별 합성 계정 5개, 총괄 계정의 실제 지점/회원/변경 기록 비노출, 전역 관리자 쓰기 차단, URL 조작 교차 지점 변경 차단, 영문 500자 이내 Play Console 안내문, 비밀번호 출력 금지·`0600` 로컬 보고서 보관 통과
- [x] `npm run test:auth-session-security`, `npm run test:password-reset-security`, `npm run test:admin-user-management-api` 원시 사용자 ID 쿠키 차단, 불투명 토큰 해시 저장, 만료·단일/전체 세션 폐기, 로그인·회원가입·비밀번호 재설정 payload 런타임 타입 검증, 로그인·로그아웃·계정 보안 변경 공통 잠금, 로그인과 재설정 인증번호의 미등록·대기·손상·비활성 대상 더미 PBKDF2 검증, 제한 계정·미등록 계정의 동일 로그인 `401` 응답과 `Retry-After` 비노출, 직접 가입의 기존 번호 중립 오류와 재설정 요청의 기존/미등록/제한 계정 비용·응답 중립화 및 운영 webhook 응답 후 발송, reset token 단일 사용과 비밀번호 변경 시 세션·이전 기기 푸시 폐기, 차단 재시도 잠금 연장 방지·내부 감사 유지, 정상 자격증명 로그인 복구, 미일치 로그아웃 쓰기 방지 검증 통과
- [x] `npm run test:invitation-token-security` 256-bit 초대 원문 1회 응답, SHA-256 저장, 7일 만료, timing-safe 비교, 사용자별 비밀번호 실패 제한, 257자 비밀번호 해시 전 차단·원문 미저장, `Retry-After`, 동시 수락 단일 성공, 권한·지점 범위 재발급과 이전 링크 무효화, bootstrap 해시·비밀정보 미노출 검증 통과
- [x] `npm run test:local-demo-password-rotation` 격리 JSON 계정별 비밀번호 회전과 원본/비밀정보 보호 검증 통과
- [x] `npm run test:dev-reset-guard` production reset API 기본 차단 정책 통과
- [x] `npm run test:env-readiness` 개발/운영 env 예시, 환경 변수 매트릭스, 위험 플래그, PostgreSQL/결제/푸시 필수 변수 문서 정합성 통과
- [x] `npm run test:deployment-handoff-draft` 운영 env/preflight 기반 배포 handoff 초안 생성, 원문 secret 미보관, strict handoff 연결 fixture 검증 통과
- [x] `npm run test:deployment-handoff` 운영 배포 handoff manifest, secret store, production preflight/release, HTTPS/provider URI 증빙, ISO 생성/승인 시각과 생성 이후 승인 순서, `localhost`/`.example`/TODO 운영 origin·checkout·mailto subject 차단, 원문 secret 미보관 fixture 검증 통과
- [x] `npm run test:e2e` 모바일 출석, 수업별 처리율/미처리 인원, 명단 검색/검색 빈 상태, 출석 상태 빠른 필터/상태별 빈 상태, 빠른 메모 칩/메모 조합, 미처리만 보기 필터/빈 상태, 최근 변경 되돌리기, 계정 액션, 미읽음 공지 배지, 공지 미읽음/중요 필터, 확인할 공지, 보이는 공지 읽음 처리, 하단 네비게이션 safe area/활성 메뉴 브라우저 E2E 통과
- [x] `npm run test:release` 통합 릴리즈 검증 통과, `npm audit --audit-level=moderate`와 `test:preflight` 포함
- [x] `npm run test:smoke` 통과. 회원 등록·수정의 잘못된 본문/날짜·공통 필드 길이 400·동시 생성/수정·고유 감사 ID 보존, 보호자 연결·변경·해제의 잘못된 본문·201자 ID 400·잠금 밖 본문 파싱·양방향 관계/동시 감사 ID 보존, 상담/주의 메모 작성, 출석 저장/사유 기록, 수업 생성·수정의 잘못된 본문/시간/공통 필드·원본 등록회원 길이 400·동시 수정 직렬화·고유 감사 ID 보존, 가족 납부 요청의 잘못된 본문 무변경과 운영자 결제 정정 교차 동시성·감사 기록 보존, 삭제된 요청 화면/API 404, 공지 작성의 잘못된 본문 400·동시 생성 ID/감사 보존·일괄 읽음, 알림 구독/해지, 파일럿 준비 상태/운영 이슈/로그 API의 인증·역할·지점 선확인과 잘못된 본문·초과 확인 메모/상세/우회책/모바일 증빙 400 무변경·동시 생성/갱신 직렬화·고유 감사 ID 보존 포함
- [x] `npm run test:smoke`, `npm run test:member-profile-guardian-edit`, `npm run test:member-management-touch-targets` 상담/주의 메모 2,000자 서버·UI 공통 상한, 2,001자 요청 `400`·메모/감사 무변경, 정상 저장·공개 범위 회귀, 390px 입력·터치·오버플로 검증 통과
- [x] `/app/dashboard` smoke 통과
- [x] `npm run test:pilot` 파일럿 데이터 intake 템플릿 검증 통과, 2개 지점 샘플 포함
- [x] `npm run test:pilot-readiness-contract` 파일럿 준비 항목/import/preflight 계약, 준비·이슈·운영 저장 문자열 상한, 잠금 전 차단, 관리자 설정 `maxLength` 정합성 통과
- [x] `npm run test:pilot-import` 파일럿 CSV import dry-run 통과
- [x] `npm run test:pilot-prelaunch-draft` 파일럿 준비 초안 workspace 생성과 blocked next action summary 검증 통과
- [x] `npm run test:pilot-launch-package` 파일럿 시작 전 CSV/import/evidence/manifest 템플릿/운영 문서 명령 묶음 검증 통과
- [x] `npm run test:pilot-launch-command` `pilot:launch-package` audit/strict 종료 코드, pre-pilot 산출물 생성, PostgreSQL URL 비밀번호 redaction 검증 통과
- [x] `npm run test:pilot-readiness-evidence` 파일럿 준비 증빙 CSV 초안, pre-pilot retro 제외, verified/blocked 증빙 누락과 unknown/missing ID 차단 검증 통과
- [x] `npm run test:pilot-readiness-evidence-apply` 검증된 준비 증빙 CSV의 dry-run/write, 런타임 반영, `pilot_readiness.update` 변경 기록, pending/non-admin/invalid checkedAt 차단 검증 통과
- [x] `npm run test:pilot-password-rotation` 계정별 비밀번호 교체 CSV 초안, 기본 임시 비밀번호 잔존, 변경 기록 누락, 계정 누락, 원문 임시 비밀번호 노출 차단 검증 통과
- [x] `npm run test:preflight` 운영 전 preflight 로직 회귀 테스트 통과
- [x] `npm run test:preflight-runtime` 현재 운영 데이터 점검 결과의 비예상 blocker/warning/count drift 차단
- [x] `npm run test:pilot-evidence` 파일럿 증빙 리포트와 출석/결제/공지 후속/공지 post-pilot 차단 조건 생성 검증 통과
- [x] `npm run test:pilot-field-evidence-draft` source CSV와 pre/post evidence 리포트 기반 현장 증빙 manifest 초안 생성, strict 차단, 운영자 입력 완료 fixture 검증 통과
- [x] `npm run test:pilot-field-evidence` 현장 증빙 manifest 검증기 통과/실패 fixture, source CSV 검증/명령 참조/지점·계정 email·role·branchScope/pre-pilot evidence count 대조, 공지 후속/공지 누락, post-pilot 리포트 수치 불일치 차단 검증 통과
- [x] `npm run test:pilot-closeout-package` post-pilot preflight/JSON/Markdown/field manifest ready 판단 패키지와 실패 fixture 검증 통과
- [x] `npm run test:pilot-artifact-manifest` 파일럿 시작/종료 산출물 ready 상태, SHA-256 해시 manifest, launch package/closeout 변조와 누락 실패 fixture 검증 통과
- [x] `npm run test:pilot-archive-artifacts` 파일럿 종료 산출물 archive 복사, SHA-256 재검증, 복사본 해시 검증, 변조/blocked/existing archive/placeholder 경로 실패 fixture 검증 통과
- [x] `npm run test:pilot-storage-receipt-draft` archive manifest 기반 장기 보관 receipt 초안 생성, 산출물별 해시/byte size 자동 반영, placeholder 초안 차단과 최종 receipt 통과 fixture 검증
- [x] `npm run test:pilot-storage-receipt` 파일럿 archive 장기 보관 receipt, 보관 URI/해시/byte size/보존 정책/산출물 coverage와 placeholder/누락/시간순서/변조 실패 fixture 검증 통과
- [x] `npm run test:pilot-final-handoff` 최종 artifact manifest/archive manifest/storage receipt의 ready 상태, 경로/해시/byte size 정합성, 누락/변조/blocked fixture 검증 통과
- [x] `npm run test:pilot-status` 파일럿 런타임/pre-post 증빙/archive/storage/final handoff 단계 요약, strict final handoff 재검증, 변조 archive 실패 fixture, ready/blocked JSON 출력 저장 검증 통과
- [x] `npm run test:pilot-operator-support` `/app/admin/settings` 현장 운영 관제, 고유 운영일 기준 누락 점검, 다음 입력 추천일, 모바일 30초 증빙 누락, status/prelaunch 명령 안내 검증 통과
- [x] `npm run test:postgres-doctor` Docker CLI/daemon ready/daemon-down/CLI-missing fixture, production Postgres env strict fixture, Postgres URL redaction, JSON/Markdown 산출물 검증 통과
- [x] `npm run test:p1-handoff-draft` P1 6개 handoff/IPA 초안/blocked 리포트, Android doctor Markdown, iOS IPA doctor/build report, P1 readiness 감사 리포트 workspace 생성, operator-facing next action 한국어 안내, 원문 secret 미기록 fixture 검증 통과
- [x] `npm run test:p1-handoff-checklist` P1 6개 handoff/IPA blocked 리포트의 JSON/CSV/Markdown action checklist, 6인 팀 action brief, 담당자별 Markdown brief/package index/package 생성, 담당자/증빙 초안/strict 명령/다음 액션, 원문 secret 미기록 fixture 검증 통과
- [x] `npm run test:p1-handoff-bundle` P1 handoff 담당자별 brief/package index/package 폴더와 `team-agent-prompts.md`의 SHA-256/byte size bundle manifest 생성, P1 release blocked 상태와 bundle ready 상태 분리, 원문 secret-like 값 유입 차단 fixture 검증 통과
- [x] `npm run test:p1-handoff-dispatch` P1 handoff bundle 이후 담당자별 package 전달 JSON/Markdown/CSV receipt 초안, 6개 owner acknowledgement 완료 fixture, package manifest hash 보존, 원문 secret-like 값 차단 fixture 검증 통과
- [x] `npm run test:p1-handoff-dispatch-apply-csv` draft에서 생성된 dispatch CSV 차단, 운영자가 채운 dispatch CSV를 completed receipt JSON/Markdown으로 적용하고 strict verifier 통과, TODO/row 변조/pending acknowledgement/시간 역전/non-ISO timestamp/non-reference evidence/secret-like 값 차단 fixture 검증 통과
- [x] `npm run test:p1-handoff-issues` P1 handoff dispatch receipt 기반 GitHub/Slack issue draft Markdown 6개, index, JSON manifest, JSON/CSV 등록 결과 템플릿, strict 명령/완료 기준 보존, pending/ready 판정, blocked publish guard 한국어 안내, 원문 secret-like 값 차단 fixture 검증 통과
- [x] `npm run test:p1-github-connector-readiness` GitHub connector payload repo와 local origin 일치, connector tool name, issue draft publish 상태, `github-connector-runbook.md` repo/publishReady/publishGuard/response target/body SHA-256 정합성, blocked `publishGuard` 한국어 안내, issue payload별 repo/title/labels/body 계약 검증 통과. `.data/p1-github-connector-access.json`이 있으면 `_get_repo` live access repo/default branch/권한 증빙도 검증
- [x] `npm run test:p1-handoff-issue-receipt` P1 handoff issue draft 기반 외부 GitHub/Slack 등록 receipt, blocked issue draft의 dispatch acknowledgement 전 외부 이슈 등록 금지 next action, CSV/JSON results 적용, GitHub connector REST/normalized/GraphQL-style 응답 정규화, URL/담당자/labels/body hash/acknowledgement 증빙, JSON/CSV row mismatch·HTTP URL·non-ISO timestamp·pending ack·시간 역전·원문 secret-like 값 차단, draft 변조 차단 fixture 검증 통과
- [x] `npm run test:p1-evidence-intake-draft` P1 readiness 7개 최종 요구사항의 6인 팀+iOS lane별 JSON/CSV/Markdown 증빙 입력표, blocker/strict 명령/TODO 필드, 원문 secret-like 값 차단 fixture 검증 통과
- [x] `npm run test:p1-evidence-intake-apply-csv` 운영자가 채운 P1 증빙 CSV의 owner/evidence URL/checkedAt/signoff만 completed JSON으로 적용하고 TODO/row 변조/secret-like 값/invalid evidence URL/checkedAt/signoff 차단 fixture 검증 통과
- [x] `npm run test:p1-evidence-intake` ready P1 readiness 기반 6인 팀 증빙 입력표의 owner/evidence URL/checkedAt/signoff, row 계약, readiness 경로, 원문 secret-like 값 차단 fixture 검증 통과
- [x] `npm run test:p1-readiness` 운영 배포, Android release, 결제 provider, 운영 푸시, P1 handoff issue registration receipt, 파일럿 최종 status 리포트 집계 검증기 fixture 통과
- [x] `npm run test:p1-operator-status` P1 readiness/Android doctor Markdown/iOS IPA doctor JSON/Markdown/action checklist/bundle/dispatch/GitHub connector access receipt/payload/대표 의사결정 등록표/evidence intake/release package/archive/storage receipt 기반 운영자 상태판, Markdown GitHub Connector 섹션(repo/checkedAt/default branch/권한/publish 상태), iOS Local Profile Inventory 섹션(profile 파일 수, Team ID/bundle id/export method 매칭 수, App Store profile 수, UDID 원문 미기록), 실제 미해결 origin/profile만 표시하는 Deferred External Prep 섹션, Markdown Owner Decision Register 섹션, Markdown Release Custody 섹션(prerequisite/package/archive/storage receipt/next action), readiness/evidence intake blocked 상태에서 release custody prerequisite sequencing, 담당 영역별 `externalBlockers`, dispatch/issue registration/storage receipt 한국어 next action, publish/보관 가능 여부, publishable payload의 access receipt 필수 조건, Android doctor Markdown 누락/형식 불일치, iOS IPA doctor blocked/누락, storage receipt placeholder, secret-like 값 차단 fixture 통과
- [x] `npm run test:p1-operator-status-apply-external-blockers-csv` 운영자가 채운 7개 externalBlockers CSV row를 completed JSON/Markdown으로 적용하고 고정 열 변조, TODO/placeholder, HTTP 증빙 URL, non-ISO timestamp, secret-like 값 차단 fixture 통과
- [x] `npm run test:p1-completion-evidence` P1 완료 기준 10개를 P0 회귀, 회원/학부모 CSV 비노출, 모바일 계정/PWA, Android, 대표 리포트, 결제, 공지/알림, 파일럿 운영, 권한/감사, 문서/빌드 증거와 `externalBlockers`에 매핑해 내부 완료와 외부 증빙 대기를 구분하는 JSON/Markdown/CSV 매트릭스 fixture 통과
- [x] `npm run test:p1-completion-evidence-apply-csv` 운영자가 채운 완료 기준 CSV를 completed JSON/Markdown으로 적용하고 고정 열 변조, TODO/placeholder, HTTP 증빙 URL, non-ISO timestamp, secret-like 값 차단 fixture 통과
- [x] `npm run test:pilot-operator-support` `/app/admin/settings` P1 최종 배포 준비 안내에서 `.data/p1-github-connector-access.json`, `_get_repo` access receipt, default branch/권한 검증 명령, `GitHub connector access ready`, `.data/android-twa-doctor.md` Android doctor Markdown support artifact, Markdown GitHub Connector 섹션, Markdown Release Custody 섹션, release custody prerequisite 상태판 항목 노출 검증 통과
- [x] `npm run test:p1-release-package` 최종 P1 readiness, P1 evidence intake report, 7개 필수 readiness 리포트와 P1 evidence intake까지 포함한 release package manifest fixture 검증 통과
- [x] `npm run test:p1-release-archive` ready P1 release package와 9개 필수 리포트 원본 파일 해시 재검증, fresh archive 복사, 복사본 해시 검증, 변조/blocked/existing/placeholder/secret fixture 검증 통과
- [x] `npm run test:p1-release-storage-receipt` P1 release archive 장기 보관 receipt 초안/검증, package+8개 리포트 업로드 coverage, HTTPS/provider URI 보관 위치와 증빙, ISO uploadedAt, 보존 정책, 변조/누락/시간순서/HTTP storage/non-reference evidence/secret fixture 검증 통과
- [x] `npm run test:owner-report-trends` `/app/owner/reports` 기간별 운영 추세, 대표 오늘 우선순위, 신규·이탈·순증 회원 변화, 운영 CSV `trend_period` 행과 `new_members/withdrawn_members/net_member_change` 컬럼 검증 통과
- [x] 대표 리포트 다운로드 버튼은 앱 화면에서 `운영 내보내기`/`결제 내보내기`로 표시하고, CSV 파일 생성과 `export.create` 감사 기록은 유지
- [x] `npm run test:owner-progress-report` [docs/P1_OWNER_PROGRESS_REPORT.md](docs/P1_OWNER_PROGRESS_REPORT.md) 비개발자 대표 보고서가 MVP 완료/P1 운영 준비 단계, 완료 항목, 남은 외부 준비, 대표 결정 필요 항목, 과장 금지 문구, 원문 secret 미기록을 유지하는지 검증 통과
- [x] `npm run test:owner-progress-report-draft` `owner:progress-report:draft -- --workspace=.data --allow-pending --out=.data/p1-owner-progress-report.md --json=.data/p1-owner-progress-report.json`가 P1 operator status와 completion evidence에서 대표 의사결정 등록표 상태를 포함한 대표 공유용 Markdown/JSON 초안을 생성하고 pending/ready/secret-like fixture와 문서 참조를 검증 통과
- [x] `npm run test:owner-decision-register` `owner:decision-register -- --workspace=.data --out=.data/p1-owner-decision-register.json --markdown=.data/p1-owner-decision-register.md --csv=.data/p1-owner-decision-register.csv --guide=.data/p1-owner-decision-register.guide.md`가 대표 결정 문항, 담당 lane, 필수 증빙, 검증 명령, 담당자/기한/증빙 입력 열과 CSV 작성 안내 guide를 생성하고 missing/secret-like fixture를 차단
- [x] `npm run test:owner-decision-register-apply-csv` `owner:decision-register:apply-csv -- --workspace=.data --csv=.data/p1-owner-decision-register.csv --json=.data/p1-owner-decision-register.json --out=.data/p1-owner-decision-register.completed.json --markdown=.data/p1-owner-decision-register.completed.md`가 대표가 채운 담당자/기한/증빙 책임자 입력을 별도 completed JSON/Markdown으로 적용하고 고정 열 변조, placeholder, 잘못된 날짜, HTTP 증빙 URL, secret-like fixture를 차단
- [x] `npm run test:owner-briefing-package` `owner:briefing-package -- --workspace=.data --out=.data/p1-owner-briefing-package.json --markdown=.data/p1-owner-briefing-package.md --package-dir=.data/p1-owner-briefing-package`가 대표 보고서, [docs/TEAM_AGENT_PROMPTS.md](docs/TEAM_AGENT_PROMPTS.md) P1 6인 팀 목표 프롬프트, 현재 초안, 대표 의사결정 등록표와 `.data/p1-owner-decision-register.guide.md`, optional `.data/p1-owner-decision-register.completed.*`, 운영자 상태판, 완료 기준 매트릭스, 외부 blocker CSV, 패키지 README와 한국어 대표 요약 Markdown을 SHA-256/byte size manifest로 묶고 누락/secret-like fixture를 차단
- [x] `npm run test:payment-lifecycle` 결제 생성 `Idempotency-Key`의 처리자·지점 범위 재시도/충돌/삭제 원본 보호, 등록·환불·취소 본문 필드 타입 선검증과 잘못된 객체·배열 입력 400·무변경 차단, 회원권명 100자와 등록·수정·삭제·환불/취소 사유 500자 공통 상한, 일반 상태 확인값 하위 호환, 취소·환불 완료 등록 사유 필수와 상태 이력·감사 스냅샷 반영, Payment 루트 감사 사유 중복 방지, 0원 환불 완료/환불액 누락 부분 환불 수정·삭제 차단, UUID 식별자, 수기 부분 환불 직접 생성 차단, 실제 달력 날짜·납부일/만료일 순서 검증, 동일 결제 수기 변경·온라인 요청 직렬화, 삭제 전 취소·상태 이력 감사 스냅샷, 수기 결제 수정·삭제/환불/취소 결제 상태 이력, 인증·지점 범위·외부/환불 이력 보호, `/app/payments` 사유 기반 수정·삭제 확인과 결제 CSV lifecycle 컬럼 검증 통과
- [x] `npm run test:online-payments` provider-neutral 온라인 결제 요청, webhook secret 상수 시간 비교와 32바이트·placeholder 차단, body/header provider event ID 일치·전역 중복 처리, 결제 요청·수신 시각 기준 webhook 허용 오차, 전역 event 잠금 뒤 결제별 잠금을 얻는 동일 결제 웹훅·운영 변경 직렬화, HTTPS 결제창 origin·영수증 메타 검증, 결제 CSV provider 컬럼, 코치 금액/링크 마스킹, production provider/checkout/webhook secret 누락·오설정 차단 검증 통과
- [x] `npm run test:family-payment-checkout` 회원/학부모 결제 카드에서 내부 결제 준비 화면 이동, 성인 회원 직접 결제 허용, 유소년/청소년 회원 직접 결제 차단과 학부모 자녀 결제 허용, 납부 요청 JSON 객체·이름 50자·연락처 원문 20자·방법 코드 32자·방법명 60자 검증, 본문 잠금 밖 처리·잠금 안 최신 권한 재확인, 타 가족 결제 존재 은닉·운영 결제 변경 공통 잠금 계약, 실 PG/API 미연결 상태 및 iOS Simulator 증빙 검증 통과
- [x] `npm run test:payment-checkout-method-flow` 성인 회원/학부모 결제 상세의 compact 납부 요약, 결제자 정보 필수 입력, 주소·일반전화·이메일 추가 영역 기본 접힘/펼침, 이메일 placeholder, 무통장입금/신용카드/가상계좌/계좌이체 선택, 카드사 그리드, 우리WON페이 모달, 학부모 자녀 결제 화면이 390px 모바일에서 overflow/콘솔 오류 없이 동작하고 `납부 정보 확인` 버튼/`온라인 결제 준비` 안내가 하단 고정 내비게이션에 가리지 않으며 실제 PG/API 호출이 없는지 검증 통과
- [x] `npm run test:tournament-access` 역할·지점별 대회 조회/관리 권한, 본문 타입·실제 달력 날짜, 동시 등록·수정 보존과 UUID 감사 ID 계약 검증 통과
- [x] `npm run test:payment-create-touch-targets` 대표/총괄 수기 결제 등록 폼의 기본 접힘, 회원 검색 결과 선택, 취소·환불 완료 상태의 44px 사유 입력과 빈 사유 제출 차단, 등록 중 중복 제출 차단, 저장 후 응답 유실 시 동일 `Idempotency-Key` 재시도와 정확히 1건 목록 반영, 수정 사유·날짜 검증, 삭제 사유·완료 안내 교체, overflow 0, 콘솔 오류 없음 390px 모바일 검증 통과. iPhone 16e 네이티브 등록·정정·삭제 증빙은 `.data/mobile-builds/ios/manual-payment-management-20260713/simulator-summary.json`, 취소 상태 조건부 사유 증빙은 `.data/mobile-builds/ios/manual-payment-create-audit-reason-20260713/simulator-summary.json`에 보관하며 실 PG·운영 데이터·IPA 준비 완료를 의미하지 않음
- [x] `npm run test:class-management-touch-targets` 대표/총괄 수업 생성/수정 입력과 코치 출석 메모 토글/입력/빠른 메모/사유 저장 44px 터치 목표, 수업명 80자·레벨 40자·장소 80자·출석 메모 80자 UI 상한, overflow 0, 콘솔 오류 없음 390px 모바일 검증 통과
- [x] `npm run test:member-management-touch-targets` 대표 회원 관리 컨트롤 44px, 회원 상세 결제·회원권 요약의 가족 금액 비노출·코치 비노출, 학부모 자녀·결제 딥링크와 이후 수동 자녀 선택 유지, overflow 0, 콘솔 오류 없음, iPhone 16e 네이티브 셸 검증 통과
- [x] `npm run test:admin-user-management-touch-targets` 총괄 사용자 관리의 초대 폼 기본 접힘, 초대 이름 80자·휴대폰 40자·이메일 254자, 수정 설명 120자·비밀번호 256자, 삭제·재발급 사유 500자 상한, 목록 액션, 초대/수정/삭제/비밀번호 재발급 입력과 저장 버튼 44px 터치 목표, 하단 내비 clearance, overflow 0, 콘솔 오류 없음, iOS Simulator 앱 chrome 증빙 검증 통과
- [x] `npm run test:operator-list-search` 운영자 결제 목록과 공지함 `q` 검색 딥링크/검색어 지우기, 0건 검색 빈 상태, 공지 0건 상태의 읽음 처리 액션 숨김, 검색 입력/인라인 지우기/빈 상태 지우기 44px 터치 목표와 하단 내비 clearance가 390px 모바일에서 표시 건수, 목록 축소, overflow 0, 콘솔 오류 없음 상태를 유지하는지 검증 통과
- [x] `npm run test:global-search` 대표/총괄 상단 통합 검색의 메뉴·회원·결제·공지·사용자 권한 범위, 코치 민감 결제/사용자 결과 차단, 실제 목록 검색 딥링크 연결 검증 통과
- [x] `npm run test:admin-role-search` 총괄 권한 관리 `q` 검색 딥링크, 검색 입력/인라인 지우기/0건 검색 빈 상태 `전체 보기` 44px 액션, 검색 중 부가 패널 숨김, 하단 safe-area spacer와 내비 clearance, 표시 건수, 목록 축소, overflow 0, 콘솔 오류 없음 상태 유지 검증 통과
- [x] `npm run test:admin-user-search` 총괄 사용자 관리 `role`+`q` 검색 딥링크, 검색어 지우기 시 역할 필터 보존, 0건 검색 빈 상태 `전체 보기` q/role 복구, 검색 입력/인라인 지우기/필터 초기화/빈 상태 초기화 44px 터치 목표와 하단 내비 clearance, 표시 건수, 목록 축소, overflow 0, 콘솔 오류 없음 상태 유지 검증 통과
- [x] `npm run test:admin-audit-search` 총괄 변경 기록 `q` 검색·`detail` 상세 딥링크 복원, 검색 입력 120자 상한, 상세 열기/닫기·검색어 지우기·`전체 보기` URL 동기화, 0건 검색 빈 상태 초기화, 필터 입력/지우기/적용/초기화 44px 터치 목표와 하단 내비 clearance, 목록 축소, overflow 0, 콘솔 오류 없음, 공통 처리/결과 라벨, 승급 심사·대회 공지 API 필터 허용, 검색어 121자·사유 501자·지점 ID 201자 잠금 전 400 무감사 차단, 동일 조회 5초 중복 저장 방지와 동시 재시도 1건 보존, 한국 시간 종료일 전체 포함과 역전 날짜 범위 차단 검증 통과
- [x] `npm run test:audit-action-contract` 앱 `AuditAction`, 공통 표시 라벨, API 사용값, PostgreSQL `audit_action` 마이그레이션, DB 스키마 문서 완전성 검증 통과
- [x] `npm run test:audit-log-privacy` 변경 기록 개인정보·자격 증명·민감 메모 최소화, 중앙 저장 정책, 원문 JSON 없는 한국어 변경 전후 비교 검증 통과
- [x] `npm run test:recurring-billing` provider-neutral 정기결제 약정 생성/해지, 인증·지점 권한 선확인, 실제 달력 날짜·1-28 청구일·문자열 해지 사유 검증, 공통 결제 잠금과 최신 권한·상태 재검증, 저장 충돌 409 매핑, 다음 청구일 계산, 결제 CSV 정기결제 컬럼, 코치 provider 약정 ID 마스킹 검증 통과. 격리 `test:smoke`의 동시 생성 `200/409`, 동시 해지 `200/422`, 단일 이력·감사 기록도 통과
- [x] `npm run test:payment-provider-handoff-draft` 실 PG/VAN handoff 초안 생성, env 추론, 원문 webhook secret 미기록, pending/ready/missing mapping fixture 검증 통과
- [x] `npm run test:payment-provider-handoff` 실 PG/VAN provider handoff manifest, webhook 서명/idempotency, checkout/영수증/정기결제 보관 정책, HTTPS/provider URI 증빙, 템플릿 `*_EVIDENCE_URI` placeholder, `localhost`/`.example`/TODO checkout origin 차단, ISO 생성/승인 시각과 생성 이후 승인 순서, 원문 secret 미보관 fixture 검증 통과
- [x] `npm run test:next-build-readiness` 현재 Next dist의 `BUILD_ID`·빌드 입력 SHA-256 지문 누락/불일치와 빌드 후 수정·삭제·이름 변경, 격리 dist의 기본 `.next` manifest 덮어쓰기를 차단하고, 검증 시작·종료에 같은 최신 빌드만 `next start` 기반 개별 게이트에 허용
- [x] `npm run test:release-smoke-isolation` 빈 로컬 포트·run-owned 임시 JSON 디렉터리/실제 `PILOT_DB_FILE`/마커 강제, 상속 토큰 교체, 공유/심볼릭 링크 경로·원격/기존 서버 재사용 차단, 임시 데이터 정리를 행동 검증
- [x] `npm run test:admin-user-management-api` 최신 production build 확인 후 임시 DB와 임시 `next start` 서버에서 공개 가입 지점 최소 필드 목록, 복수 지점 선택 필수, 위조 지점 차단, 선택 지점 귀속, 동시 휴대폰 가입 유일성, 총괄 사용자 수정/삭제/역할 변경의 숫자·배열·빈 본문과 객체형 계정 필드·혼합 연결 배열·사유/비밀번호 초과 입력 400·무변경, 초대 본문 타입·계정 필드/원본 지점 배열 길이·동시 사용자/감사 ID·휴대폰 유일성, 비밀번호 재발급·역할 변경의 잘못된 본문과 사유/비밀번호/원본 지점 배열 길이 무변경, 계정 단위 로그인 제한 중 정상 비밀번호 복구, 코치 역할 제거 시 수업·회원 자동 인계, 단독 대표 보호, 선택 비밀번호 변경, 원문 비밀번호/password hash 미노출, `user.update`/`user.delete`/`user.role.update` 변경 기록 검증 통과
- [x] iPhone 16e Simulator에서 사용자 삭제 API 실패 시 폼을 유지하고 현재 계정·총괄 유지·지점 대표 배정 상태 확인 안내가 하단 내비게이션 위에 완전히 표시됨 (`.data/mobile-builds/ios/admin-user-policy-feedback-20260713/summary.json`, 내부 QA 전용)
- [x] `npm run test:dashboard-priority-kpi` 총괄 대시보드 첫 화면 KPI가 내부 변경 기록 요약으로 회귀하지 않고 대기 초대와 사용자 관리 액션을 우선 표시하는지 검증 통과
- [x] `npm run test:member-profile-guardian-edit` 운영자 회원 상세 연령 수정 저장 요약, 보호자 검색 기반 변경/해제 UI, 보호자 ID 200자 상한, 인증·지점 선검사, 잠금 밖 본문 파싱과 잠금 안 최신 권한 재검사, 보호자-자녀 양방향 링크·동시 감사 ID 갱신, 접근 불가 회원 수정 대상 404와 연결 불가 학부모 계정 존재 은닉 API 회귀 범위 검증 통과
- [x] `npm run test:guardian-age-policy-ui` 운영자 회원 상세 연령 정책, 보호자 연결 후보 렌더링, 회원 검색 지우기 44px 터치 목표 검증 통과
- [x] `npm run test:admin-user-guardian-bottom-safe-area` 관리자 사용자 목록 액션 버튼과 상세 보호자 연결 편집/해제 화면의 모바일 하단 내비 안전 여백 검증 통과
- [x] `npm run test:api-auth-order` 보호 API route handler 본문 읽기 전 세션 확인 순서, 보호자 연결 공통 컨텍스트의 세션 검사, 공개 body route allowlist 검증 통과
- [x] `npm run test:attendance-mutation-safety` 출석 변경의 공통 잠금, 선택 지점 일치, 수업 시작 전 차단, 본문 잠금 밖 검증과 잠금 안 최신 권한 재확인, 느린 일괄 본문 중 별도 출석 사유 선완료 통합 회귀, 일괄 저장 JSON 구조·항목 타입·200건 상한·회원 ID 200자·메모/사유 80자·회원 중복 차단, 저장 실패 재시도 큐 계약 검증 통과
- [x] `npm run test:login-keep-signed-in` 로그인 상태 유지 30일 쿠키, 기본 8시간 쿠키, 390px 로그인 화면 터치 영역/overflow 검증 통과
- [x] `npm run test:public-legal-pages` 공개 개인정보처리방침과 계정·데이터 삭제 요청 페이지, 운영자·수탁사·보유기간·법정 보관 예외, 회원가입/내 계정 링크, 비로그인 bootstrap 억제, 390px/1440px overflow·콘솔 오류 없음 검증 통과
- [x] `npm run test:implementation-backlog` 구현 백로그 ID 중복, 섹션 번호 불일치, 그룹별 순번 누락, 빈 작업/완료 기준, 상태 값 drift, `바로 다음 작업` 운영 순서 번호 중복/누락 검증 통과
- [x] `npm run test:qa-plan` QA 시나리오 ID 중복, 빈 실행/기대 결과, 문서 내 `npm run` 스크립트 오타 검증 통과
- [x] `npm run test:release-docs` 릴리즈 명령/package script/문서 정합성과 README `검증` 명령 블록 순서 검증 통과
- [x] `npm run test:admin-settings-gates` 관리자 자동 검증 게이트와 release runner 정합성 통과
- [x] `npm run test:p4-simulator-rehearsal` P4 실제 사용 환경 검증 통과. 앱 UI에는 P4 내부 상태판을 노출하지 않고, `.data/mobile-builds/ios/p4-simulator-screenshots` 관리자 대시보드/관리자 설정 운영 확인 화면/코치/회원/학부모 캡처 5개를 확인하고, P1 readiness 7개 중 iOS 1개 ready·6개 blocked 상태와 iOS IPA App Store Connect 업로드 ready 상태를 유지해 iOS Simulator 성공을 IPA ready로 보지 않음
- [x] `npm run test:p5-p10-internal-readiness` P5~P10 내부 readiness audit 통과 대상: 앱 UI 내부 release/audit 카드 비노출, `.data/p5-p10-internal-audit.json`, `.data/p5-p10-internal-audit.md`, `.data/mobile-builds/ios/p5-p10-simulator-screenshots` 관리자 설정/코치/회원/학부모 캡처 4개, `.data/mobile-builds/ios/visible-text-audit-20260621-recheck` 관리자 변경 기록/코치 회원 화면 recheck 캡처, P1 외부 요구사항 7개 중 iOS 1개 ready·6개 blocked, Android release blocker와 iOS App Store Connect 업로드 ready 상태, 코치 모바일 저장 상태 패널 safe area 배치와 기본 상태 한 줄 요약, 코치 회원 화면 최근 상담/주의 메모 1건 요약과 빈 주의사항/빈 메모 문구 비노출, 관리자/대표/코치/회원/학부모 회원 상세의 빈 주의사항/상담/코치 피드백 문구 반복 비노출, Next 개발 표시 배지 비활성화, 역할별 `autoLogin` deep link 실제 서비스 화면 진입, 로그인 `quickLogin=1` hydration mismatch/빈 화면 방지, 예시 이메일 placeholder와 `010-0000-0000` 같은 더미 연락처 placeholder, 로그인 클라이언트의 `.test` seed 이메일/공통 비밀번호/계정 채우기 UI 및 직접 접근 차단/사용자 목록/초대/공지 작성 화면의 내부 권한·지점 범위 표현 비노출, README/QA/릴리즈/백로그 문서 정합성. `npm run p5-p10:internal-audit`는 감사 산출물만 재생성한다. 이 내부 audit는 출시 완료, IPA ready, 운영 ready가 아니며 iOS Simulator 성공을 IPA ready로 보지 않음
- [x] `npm run test:notice-delete-ui` 공지 삭제 권한, 공지 단일 읽음 피드백/저장 중 상태, 삭제 후 목록/알림 상태, 실제 수정 후 읽음 초기화, 동일 내용 재저장 읽음 유지, 코치 audience 변경 차단, 반·개인 대상 변경/잘못된 타입 거부, 읽음·수정 직렬화, 감사 로그 본문 미저장 회귀 검증 통과
- [x] `npm run test:notice-compose-safety` 공지 작성 대상·확인 단계와 중복 발행 방지 계약 검증 통과
- [x] `npm run test:visible-app-copy-stability` 390px 모바일 실제 화면에서 로그인/회원가입/비밀번호 재설정/초대 수락/계정 전환 진입 화면과 역할별 앱 화면이 FINAL 벡터 로고, 필수 폼/계정 전환 버튼, 콘솔 에러 없음, 더미/샘플/테스트 계정/릴리즈 내부 문구 비노출, 가로 overflow 없음, runtime error 없음 상태를 유지하고 로그인/회원가입/초대 수락 비밀번호 표시 토글 44px 터치 목표와 입력 우측 여백을 검증 통과. 회원/학부모 계정 화면은 불필요한 활성 상태 카드 없이 계정 전환/로그아웃 44px 액션을 검증한다. 관리자 사용자 목록 수정/삭제/비밀번호 재발급 액션은 compact 세로 스택으로 보이며 수정 폼의 선택 비밀번호 입력 2개와 수정/삭제/재발급 폼 접힘/토글 상태를 검증하고, 관리자 지점 생성 폼 열림 상태는 패널 160px 이하, 폼 112px 이하, 생성 버튼 44px 이상을 유지한다. 대표/총괄 `/app/notices`는 공지 목록과 읽음 처리가 먼저 보이고 `공지 작성` 폼은 44px `작성 열기` 토글 뒤에 접힌 상태로 유지한다. 관리자/대표/코치/회원/학부모 회원 상세는 빈 주의사항/상담/코치 피드백 문구를 반복하지 않고, 코치 회원 화면은 최근 메모 1건만 기본 노출하고 44px 더보기로 확장되며 상태 필터·개인 공지 액션·비상 연락처 전화 액션이 44px 터치 높이를 유지한다. 회원/학부모 회원 화면의 비상 연락처 전화 액션도 44px 터치 목표를 유지한다. 대표 대시보드 `오늘/7일/30일` 기간 필터, 관리자 대시보드 `오늘 수업 보기`, 사용자 관리 `회원 등록`/`초대`, 변경 기록 `새로고침`도 44px 터치 높이를 유지한다. 코치 수업 화면은 내부 P3 운영 패널과 코드형 마감 문구가 실제 앱 DOM에 노출되지 않음을 확인한다. 대표 리포트는 지점별 회원/출석/위험/매출 그래프와 내부 P3 운영 패널/코드형 운영 확인 문구 비노출을 확인하고, 대표 내 지점은 지점별 회원 유지/수업 채움/결제 위험 그래프와 44px 액션 버튼을 확인하며, 회원 `/app/notifications` alias는 공지 필터/읽음 액션을 함께 확인
- [x] 대표 대시보드 지점 비교 카드는 390px 모바일에서 위험 알림보다 먼저 보이고 하단 내비게이션과 24px 이상 여백을 유지하며, compact 위험 알림 요약도 하단 내비게이션에 가리지 않는다. `test:visible-app-copy-stability`의 `ownerBranchComparison*BottomNavClearance`와 `ownerDashboardRiskSummaryBottomNavOverlap` 측정으로 회귀를 차단한다.
- [x] `npm run preflight:pilot -- --allow-incomplete` 운영 직전 차단 조건 감사 명령 준비
- [x] `npm run test:attendance-speed` 코치 수업별 출석 30초 게이트 통과
- [x] `npm run test:a11y-static` 접근성 정적 확인 기준 통과
- [x] `npm run test:mobile-install` iOS/Android 홈 화면 설치용 manifest, 아이콘, apple web app, 모바일 viewport/theme color, production 서비스 워커 등록, 계정 화면 홈 화면 추가 액션, beforeinstallprompt 설치 프롬프트, standalone/iOS 설치 상태, 오프라인 앱 셸 캐시, API 응답 캐시 금지 검증 통과. Android 내부 설치용 리포트가 있으면 현장 설치 우선 파일 `INSTALL_ONLY_final-judo-native-webview-debug.apk`의 SHA-256/byte size, 동등본 `final-judo-native-webview-debug.apk`, APK 내부 런처 아이콘 proof, `INSTALL_ANDROID_WEBVIEW_APK.txt` 설치 가이드, TWA/Bubblewrap `app-debug.apk` 설치 금지 경로, `DO_NOT_INSTALL_FOR_FIELD_WEBVIEW.txt` 오설치 방지 마커와 주소창 없는 WebView 설치 경고도 검증
- [x] `npm run test:android-packaging` P1 Android TWA/Bubblewrap 전략, assetlinks 템플릿, PWA manifest 호환성, Android 런처/splash의 `public/icons/final-judo-icon-512.png` 검정 FINAL 심볼 PNG 원본 생성, `android:twa:prepare`의 `buildReady/buildBlockers`, `android:twa:doctor -- --markdown` 공유 리포트와 macOS/환경변수/CI 설치 힌트, Java/keytool/sdkmanager/adb/npx/Android SDK home 가드, `localhost`/`.example`/TODO origin과 API-only `api.*` origin 차단, GitHub Actions 수동 패키징 workflow, APK/AAB 외부 차단 조건 검증 통과
- [x] `npm run test:android-play-release-artifacts` 최신 Play release report `.data/mobile-builds/android-play-release-20260805092723/google-play-release-report.json`, `versionCode 45`/`versionName 1.0.44`, Android Capacitor 운영 로그인 URL, timestamped AAB/APK, Desktop AAB/APK 복사본, jarsigner/apksigner 검증, APK badging, AAB TWA 런타임 미포함 대조 통과
- [x] `npm run test:android-role-apks` 역할별 APK 4개 build report, 현재 워크스페이스 경로, SHA-256/크기, signer verification, assetlinks 역할 coverage 검증 통과. 이 게이트는 파일럿 설치 APK 무결성 확인이며 Android release handoff ready 판정은 아님
- [x] `npm run android:twa:doctor` Android TWA 로컬/CI 빌드 준비 상태 JSON 확인. 담당자 공유용 점검표와 설치 힌트가 필요하면 `--markdown=.data/android-twa-doctor.md`를 함께 지정
- [x] `npm run test:ios-capacitor-connection` iOS Capacitor 브릿지가 실제 서비스 `/app/dashboard`를 열고, localhost Simulator 연결을 IPA 배포 ready로 처리하지 않으며, 생성 config의 `api.*` server.url을 unverified API origin으로 차단하는지 검증 통과
- [x] `npm run test:ios-ipa-doctor` iOS IPA doctor가 운영 origin 누락 또는 API-only `api.*` origin 입력 시 blocked를 유지하고, App Store Connect profile과 기기 등록이 필요한 Development/Ad Hoc profile을 구분하며, release config fallback, strict 재실행, Local Profile Inventory의 `matching provisioning profile`과 등록 기기 포함 profile 수, UDID 원문 미기록을 JSON/Markdown에 남기는지 검증 통과
- [x] `npm run ios:ipa:doctor -- --out=.data/mobile-builds/ios/ios-ipa-doctor.json --markdown=.data/mobile-builds/ios/ios-ipa-doctor.md` Team ID `CA7A5SP5G5`, bundle id `kr.co.finaljudo.multigym`, export method `app-store-connect`에 맞는 배포 profile 1개를 확인해 ready 판정
- [x] `npm run test:ios-provisioning-runbook` [docs/IOS_IPA_PROVISIONING_RUNBOOK.md](docs/IOS_IPA_PROVISIONING_RUNBOOK.md)가 Apple 계정 `roehf45@naver.com`, Team ID `CA7A5SP5G5`, bundle id `kr.co.finaljudo.multigym`, `FINAL_JUDO_IOS_SERVER_URL`, export method별 profile 요구사항, Xcode Download Manual Profiles, strict doctor/build 명령, UDID·비밀정보 미기록 규칙을 유지하는지 검증 통과
- [x] `npm run test:android-release-handoff-draft` Android APK/AAB handoff 초안 해시/크기 자동 생성 검증 통과
- [x] `npm run test:android-release-handoff` Android APK/AAB handoff manifest ready/blocked fixture, 주소창/공유/더보기 브라우저 UI 비노출 smoke, HTTPS/provider URI 증빙, 템플릿 `*_EVIDENCE_URI` placeholder, ISO 생성/승인 시각과 생성 이후 승인 순서 검증 통과
- [ ] GitHub Actions `Android TWA Package` 수동 workflow에서 실제 운영 `production_origin`, `release_sha256`, `build_artifacts` 입력으로 strict doctor/TWA 입력 파일 artifact를 생성하고, 실제 APK/AAB 필요 시 `build_artifacts=true`로 빌드 산출물 업로드 확인. `localhost`, `.example`, TODO origin은 사용 금지
- [ ] 실제 APK/AAB 생성 직전 `npm run android:twa:doctor -- --strict --origin=<https-origin> --sha256=<fingerprint> --out=.data/android-twa-doctor.json --markdown=.data/android-twa-doctor.md` 통과 및 증빙 보관. `<https-origin>`은 `/login`과 `/app/dashboard`를 서빙하는 확정 운영 웹앱 도메인으로 교체해야 하며 예시/임시/API-only origin은 차단된다
- [ ] 실제 APK/AAB 생성 후 `npm run android:release-handoff:draft -- --out=.data/android-release-handoff.json`로 해시/크기 초안을 만들고 HTTPS/provider URI 운영 증빙, ISO 생성/승인 시각, 생성 이후 승인 순서를 채운 뒤 `npm run android:release-handoff -- --file=.data/android-release-handoff.json --out=.data/android-release-handoff.report.json` 통과 및 증빙 보관
- [x] [docs/IOS_IPA_PROVISIONING_RUNBOOK.md](docs/IOS_IPA_PROVISIONING_RUNBOOK.md)에 따라 운영 HTTPS 웹앱 origin, Team ID `CA7A5SP5G5`, bundle id `kr.co.finaljudo.multigym`, App Store Connect 배포 profile을 확인하고 `app-store-connect` archive/export와 업로드 완료. `.data/mobile-builds/ios/app-store/1.0-1/upload-result.md`에 버전 `1.0`, build `1`, codesign, IPA SHA-256, `Upload succeeded` 증빙 보관. 모바일 앱 배포 상태에서 `Simulator 성공과 IPA 배포 가능 상태`를 분리하며 API 전용 origin, UDID 원문, 계정 비밀번호·private key는 보관하지 않는다. 나머지 외부 증빙이 사용자 보류이면 전체 출시 판단은 보류 상태를 유지한다
- [ ] 실제 PG/VAN 계약 후 `npm run payment-provider:handoff:draft -- --out=.data/payment-provider-handoff.json`로 초안을 만들고 provider/checkout/webhook/recurring/signoff HTTPS/provider URI 증빙, ISO 생성/승인 시각, 생성 이후 승인 순서를 채운 뒤 `npm run payment-provider:handoff -- --file=.data/payment-provider-handoff.json --out=.data/payment-provider-handoff.report.json` 통과 및 증빙 보관
- [x] `npm run test:notification-push-handoff-draft` 운영 푸시 handoff 초안, 원문 VAPID private key 미기록, strict 통과 fixture 검증 통과
- [x] `npm run test:notification-push-handoff` 운영 푸시 handoff ready/blocked fixture, Android 실기기 필수 HTTPS/provider URI 증빙, 템플릿 `*_EVIDENCE_URI` placeholder, `localhost`/`.example`/TODO production origin·VAPID subject 차단, ISO 생성/승인 시각과 생성 이후 승인 순서, 원문 secret 차단 검증 통과
- [x] `npm run test:team-agent-prompts` [docs/TEAM_AGENT_PROMPTS.md](docs/TEAM_AGENT_PROMPTS.md)가 11팀 60명 책임 체계와 11팀 현장 운영 인수 경계, 기존 P1 6개 handoff lane 호환성을 유지하고 Android APK artifact/iOS Simulator와 IPA ready 분리, Team ID/bundle id, 7개 외부 blocker, P1 필수 검증 명령을 누락하지 않는지 검증 통과
- [ ] 운영 VAPID 설정 후 `npm run notification-push:handoff:draft -- --out=.data/notification-push-handoff.json`로 초안을 만들고 Android 실기기 수신/클릭/공지 발송 변경 기록 HTTPS/provider URI 증빙, ISO 생성/승인 시각, 생성 이후 승인 순서를 채운 뒤 `npm run notification-push:handoff -- --file=.data/notification-push-handoff.json --out=.data/notification-push-handoff.report.json` 통과 및 증빙 보관
- [x] `/app/admin/settings`의 `P1 최종 배포 준비` 자료에서 운영 배포, Android release, 결제 provider, 운영 푸시, P1 handoff issue registration receipt, 파일럿 최종 status 리포트, 담당 영역별 외부 증빙 입력 지도, 모바일 앱 배포 상태, `npm run test:ios-capacitor-connection`, `npm run ios:ipa:doctor`, [docs/IOS_IPA_PROVISIONING_RUNBOOK.md](docs/IOS_IPA_PROVISIONING_RUNBOOK.md) iOS IPA provisioning 런북과 `npm run test:ios-provisioning-runbook`, 외부 증빙 수집 확인, 증빙 형식 가드, `.data/postgres-docker-readiness.md` Postgres/Docker doctor, `.data/mobile-builds/ios/ios-ipa-doctor.md` iOS IPA doctor Markdown, [docs/P1_OWNER_PROGRESS_REPORT.md](docs/P1_OWNER_PROGRESS_REPORT.md) 대표 진행 보고서와 `npm run test:owner-progress-report`, `.data/p1-owner-progress-report.md` 대표 진행 보고서 초안과 `npm run owner:progress-report:draft`, `.data/p1-owner-decision-register.*` 대표 의사결정 등록표와 `npm run owner:decision-register`, `.data/p1-owner-decision-register.completed.*` completed 등록표와 `npm run owner:decision-register:apply-csv`, `.data/p1-owner-briefing-package.json` 대표 공유 패키지와 `npm run owner:briefing-package`, 운영자 상태판 Markdown GitHub Connector 섹션과 Release Custody 섹션, release custody prerequisite 안내, `npm run p1:operator-status:apply-external-blockers-csv`, `npm run test:p1-operator-status-apply-external-blockers-csv`, `npm run p1:completion-evidence`, `npm run p1:completion-evidence:apply-csv`, `npm run test:p1-completion-evidence`, `npm run test:p1-completion-evidence-apply-csv`, `npm run postgres:doctor`, `npm run test:postgres-doctor`, 초안 workspace/readiness 감사/최종/package 보관 명령을 확인한다. iOS는 App Store Connect 업로드 성공 증빙으로 ready지만 전체 P1은 나머지 6개 외부 blocker가 해소될 때까지 blocked다.
- [x] 같은 패널의 `보류 중인 외부 준비` 섹션은 운영 웹앱 origin 또는 선택한 export method용 provisioning profile이 실제로 미해결일 때만 표시한다. App Store Connect 업로드 성공 증빙이 있으면 iOS 항목은 ready로 제거하며, 나머지 외부 blocker만 전체 출시 판단을 blocked로 유지한다.
- [x] 같은 화면의 `P2 개발 착수 상태` 섹션에서 `P1 external-blocked / P2 development open`, `P1은 출시 완료가 아닙니다`, `P2 내부 작업 목록`, `P2 일일 운영 체크리스트`, `P2 진행/QA 상태판`, P2 완료 8/8, P2 내부 작업 완료, P2 QA 검증 묶음, 추천 운영일, 모바일 출석 30초 증빙, P2 개선 후보, 파일럿 최종 승인 상태, 회원/학부모 CSV 내보내기 노출 금지, 실 결제 연동 증빙 전 준비 상태, P1 release blocked 유지를 분리 표시한다. `/app/classes`의 코치 모바일 빠른 조치 패널은 사유 빠른 입력, 수업 상태, 상담/주의 회원, 결제 금액 비노출 유지를 390px에서 제공한다. `/app/dashboard`의 회원/학부모 핵심 상태 패널은 다음 수업, 출석, 결제 상태, 상담/공지 확인을 본인 또는 선택 자녀 기준으로 우선 노출한다. `/app/payments`의 `P2 결제/회원권 운영 보드`는 미납 회수, 만료/재등록, 환불/할인 점검, 상태 이력, 실 결제 연동 증빙 전 준비 상태를 대표/총괄 기준으로 분리 표시한다. `/app/owner/reports`의 `대표 운영 판단 보드`는 기간 필터 기준 회원 증감, 출석률 변화, 결제 위험 변화, 매출 추이, 지점 비교를 대표 운영 판단 기준으로 묶고 CSV는 대표/총괄만 유지한다. `/app/notices`의 `공지 요약`은 중요 공지, 미확인 공지, 읽음 확인, 알림 수신을 현재 필터 기준으로 분리하고 운영 푸시 외부 증빙은 P1 blocker로 유지한다. P2 작업은 진행해도 P1 외부 증빙 항목은 ready 처리하지 않으며 P2 개선 후보와 P2 진행률을 release blocker/ready 판정으로 승격하지 않는다.
- [x] `npm run test:p3-operations` P3 운영 고도화 정적 검증 통과 대상: `/app/admin/settings`의 P3 운영 고도화 상태와 `P3 다음 작업과 남은 위험`, `P3 반복 운영 자동화`, `P3 서비스 품질 신호판`, `P3 피드백 트리아지 루프`, `P3 피드백 접수 보드`, `P3 피드백 QA 반영 캘린더`, `P3 피드백 SLA 레인`, `P3 운영 기록 갱신`, `P3 운영 자동화 실행`, `P3 운영 자동화 실패 복구 보드`, `/app/owner/reports`의 장기 추세/위험 회원/재등록 후보/결제 회수 우선순위/지점별 액션 추천/`P3 지점 액션 실행표`/`P3 지점 비교 액션 매트릭스`/`P3 지점 주간 리스크 스코어카드`/`P3 주간 운영 약속 보드`/`P3 월간 운영 리듬 보드`/`P3 운영 결정 추적 보드`/`P3 이번 주 운영 결정 큐`/`P3 지점 운영 실험 큐`/`P3 회원 유지/회수 액션 플래너`/`P3 재등록/회수 코호트 보드`, `/app/classes`의 `P3 코치 1탭 현장 레일`/코치 수업 전/후 체크리스트/`P3 코치 현장 후속 조치 큐`/`P3 코치 수업 전환 리듬`/`P3 코치 수업 확인 보드`/`P3 코치 현장 마감 우선순위 보드`/`P3 코치 3분 마감 루틴 보드`, `/app/dashboard`의 회원/학부모 다음 행동 큐, `P3 회원/학부모 오늘 확인 브리프`, `P3 회원/학부모 주간 확인 리듬`, `P3 회원/학부모 오늘 복귀 안내 레일`, `P3 회원/학부모 수업 전 준비 보드`, `P3 회원/학부모 우선순위 타임라인`, `P3 회원/학부모 확인 마감 슬롯`, `P3 회원/학부모 7일 유지 신호`, `P3 회원/학부모 재방문 약속 큐`, `P3 회원/학부모 확인 누락 방지 보드`, `P3 회원/학부모 유지 루틴`. 지점 액션 실행표는 담당자/확인 지표/다음 확인을 반복 운영 루틴으로 연결하고, 지점 비교 액션 매트릭스는 기준 지점 대비 출석 격차, 위험 금액 비중, 추세 압력, 추천 액션, 다음 운영 리뷰를 묶어 지점별 운영 비교와 액션 추천 개선에 사용한다. 지점 주간 리스크 스코어카드는 출석 마감 누락, 출석 확인, 결제 위험, 회원 순감 신호를 주간 리스크 점수, 리뷰 트리거, 담당자, 다음 주간 리뷰로 고정하고 P1 release readiness와 분리한다. 주간 운영 약속 보드는 주간 리스크 점수를 이번 주 약속, 마감, 증빙 기준, 검증 명령으로 바꿔 운영 리뷰에서 바로 확인하게 한다. 월간 운영 리듬 보드는 장기 추세 점검, 위험 회원/결제 회수, 재등록 후보 상담, 지점 비교/액션 리뷰를 1~4주차 의사결정, 운영 증거, 확인 기준, 검증 명령으로 묶고 P1 release readiness와 분리한다. 운영 결정 추적 보드는 장기 추세, 위험 회원, 재등록 후보, 결제 회수 우선순위, 지점 비교 결과를 결정 기록, 운영 신호, 운영 증거, 다음 재확인, 검증 명령으로 묶고 P1 release readiness와 분리한다. 이번 주 운영 결정 큐는 장기 추세, 결제 회수, 재등록 상담, 지점 액션을 이번 주 결정, 결정 트리거, 결정 마감, 운영 증거, 검증 명령으로 압축하고 P1 release readiness와 분리한다. 지점 운영 실험 큐는 지점별 액션 추천을 운영 실험 가설, 성공 지표, 회고 시점, 중단 신호, 검증 명령으로 바꾸고 다음 운영 리뷰와 P1 release readiness 분리를 함께 표시한다. 회원 유지/회수 액션 플래너는 위험 회원, 재등록 후보, 결제 회수 우선순위를 오늘 연락 대상, 담당자, 연락 채널, 다음 확인으로 바꾸며 CSV 내보내기 권한은 대표/총괄만 유지한다. 재등록/회수 코호트 보드는 재등록 후보 코호트, 결제 회수 코호트, 위험 회원 코호트, 장기 추세 코호트를 정렬 기준, 담당자, 다음 운영 리뷰, 검증 명령으로 묶고 P1 release readiness와 분리한다. 코치 1탭 현장 레일은 모바일 출석/상담/주의 회원 처리를 미처리 명단 좁히기, 사유 대상 바로 보기, 주의 회원 찾기, 저장 마감으로 단축하며 코치 결제 금액 비노출을 유지한다. 코치 현장 후속 조치 큐는 사유 메모/주의 확인/상담 후속을 수업 전/후 1분 점검으로 정렬한다. 코치 수업 전환 리듬은 다음 수업 전환 전에 출석 마감, 현장 메모, 보호자 안내, 저장 상태를 묶고 결제 금액 비노출을 유지한다. 코치 수업 확인 보드는 수업 사이 확인의 출석 마감, 사유 메모, 보호자 안내, 저장 상태를 담당, 확인 마감, 운영 증거, 검증 명령으로 묶고 누락 방지와 코치 화면 금액 미노출을 유지한다. 코치 현장 마감 우선순위 보드는 출석 마감 우선순위, 사유 메모 우선순위, 주의/상담 우선순위, 저장 마감 우선순위를 바로 실행, 마감 기준, 운영 증거, 검증 명령으로 묶고 코치 화면 금액 미노출 및 P1 release readiness 분리를 유지한다. 코치 3분 마감 루틴 보드는 1분 출석, 1분 사유, 30초 보호자 안내, 30초 저장을 마감 순서, 현장 실행, 운영 증거, 검증 명령으로 묶고 결제 금액 비노출 유지 및 P1 release readiness 분리를 유지한다. 회원/학부모 오늘 확인 브리프는 공지/결제/상담/수업 준비를 10분 점검, 확인 마감, 확인 증거로 압축하고 내보내기 액션 없이 P1 release readiness와 분리한다. 회원/학부모 주간 확인 리듬은 같은 항목을 주간 확인 리듬, 다음 확인, 운영 증거로 묶고 내보내기 액션 없이 P1 release readiness와 분리한다. 회원/학부모 오늘 복귀 안내 레일은 공지 먼저, 결제 상태 확인, 출석 안내 확인, 상담 안내 확인, 수업 전 준비를 오늘 복귀 안내, 다음 행동, 확인 증거, 검증 명령으로 묶고 내보내기 액션 없이 P1 release readiness와 분리한다. 회원/학부모 수업 전 준비 보드는 공지 준비, 결제 준비, 출석 준비, 상담 준비, 수업 준비를 수업 전 준비, 준비 마감, 확인 증거, 다음 행동으로 묶고 내보내기 액션 없이 P1 release readiness와 분리한다. 회원/학부모 우선순위 타임라인은 공지, 결제 상태, 출석 안내, 상담 안내, 다음 수업 준비를 마감 맥락과 다음 확인 순서로 보여주고, 회원/학부모 확인 마감 슬롯은 같은 항목을 오늘 마감, 이번 주 마감, 수업 전 마감, 확인 방법, 다음 확인으로 정렬하며 내보내기 액션을 노출하지 않는다. 회원/학부모 7일 유지 신호는 공지 미확인, 결제 상태, 출석 확인, 상담 안내, 다음 수업 준비를 재방문 위험과 다음 확인으로 정렬하며 내보내기 액션을 노출하지 않는다. 회원/학부모 재방문 약속 큐는 같은 항목을 재방문 약속, 보호자/회원 안내, 검증 명령, P1 release readiness 분리 상태로 묶고 다음 확인을 노출한다. 회원/학부모 확인 누락 방지 보드는 공지 확인 누락, 결제 상태 누락, 출석 안내 누락, 상담 안내 누락, 수업 준비 누락을 보호자/회원 재확인, 다음 확인 증거, 검증 명령으로 묶고 내보내기 액션을 노출하지 않는다. 회원/학부모 유지 루틴은 같은 항목을 하루 점검 순서로 정렬하며 내보내기 액션을 노출하지 않는다. 서비스 품질 신호판은 출석 마감 속도, 공지 미확인, 출석 확인, 결제 위험 후속, 상담/주의 후속을 반복 점검 신호로 묶고 P1 release readiness와 분리한다. 운영 증거 갱신 큐는 운영일 마감, 대표 주간 리뷰, 모바일 역할 가드, 릴리즈 오판 방지 명령을 내부 품질 증거로 고정하고 readiness 7개 중 iOS 1개 ready·6개 blocked 상태와 P1 blocked guard를 함께 표시한다. 운영 자동화 실행 큐는 운영일 마감 자동 점검, 지점 주간 운영 리뷰, 모바일 역할 가드, 배포 readiness 재확인을 담당, 실행 주기, 증거, 확인 기준, 검증 명령으로 묶고 P3 진행률만 갱신하며 iOS Simulator 성공을 IPA ready로 보지 않는다. 운영 자동화 실패 복구 보드는 반복 운영 명령 실패를 실패 신호, 복구 담당, 재시도 창, 복구 증거, 에스컬레이션, 검증 명령으로 묶고 P3 진행률만 갱신하며 P1 release readiness와 분리한다. 운영일 마감 루틴, 지점 운영 리뷰, 서비스 품질 회고, 배포 readiness 재확인은 P3 운영 자동화 후보이며, 현장 피드백은 접수/우선순위/QA 반영/회고 순서로 P3 백로그 후보에 반영한다. 피드백 접수 보드는 개선 후보/버그/운영 차단/외부 보류를 출처, 다음 확인, 담당자, 검증 명령으로 고정하고 릴리즈 분리 상태를 표시한다. 피드백 QA 반영 캘린더는 현장 피드백을 재현 경로, QA 계획 반영, 백로그 반영, 다음 회고 순서와 검증 명령으로 연결하고 P1 release readiness와 분리한다. 피드백 재발 방지 보드는 실행 검증 이후 재발 신호, 방지 확인, 다음 점검, QA 명령을 묶고 외부 보류는 P1 readiness blocked 유지 사유로만 보관한다. 피드백 SLA 레인은 개선 후보/버그/운영 차단/외부 보류를 접수 1영업일, 버그 2영업일, 운영 차단 당일, 외부 보류 별도 보관으로 나누고 담당자와 검증 명령을 표시한다. 운영 웹앱 origin 보류, Android release handoff 미완, PG/운영 푸시/이슈 receipt/파일럿 최종 status 미완은 P1 release blocked 위험으로 남긴다.
- [x] 현재 관리자 설정 화면의 앱용 표시는 주간 리뷰 액션 추적, 주간 리뷰 효과 확인, 운영 자동화 실패 복구, 현장 피드백 분류, 피드백 정리 흐름, 피드백 접수, 피드백 QA 반영 일정, 피드백 증거 묶음, 피드백 회고 액션, 피드백 운영 반영, 피드백 실행 확인, 피드백 재발 방지, 피드백 응답 기준, 피드백 운영 지표, 분류별 운영 지표, 노화 창, 백로그 신호, 운영 판단을 기준으로 하며 `P3 ... 보드`, `SLA 레인`, `증거 패킷`, `P3 백로그 후보` 표현은 앱 화면에서 쓰지 않는다.
- [x] `/app/dashboard`의 회원/학부모 화면은 내부 3분 복귀 체크 보드를 노출하지 않고 공지, 결제 상태, 출석, 상담/공지, 수업 준비를 사용자용 핵심 상태 카드로만 보여주며 회원/학부모 내보내기 액션 비노출과 P1 release readiness 분리를 유지한다.
- [x] `/app/admin/settings`의 `P3 피드백 운영 반영`는 개선 후보, 버그, 운영 차단, 외부 보류를 반영 액션, 반영 위치, 다음 회고, 검증 명령으로 묶고 외부 보류는 P1 readiness blocked 유지로 분리한다.
- [x] `/app/admin/settings`의 `P3 피드백 실행 검증 보드`는 개선 후보, 버그, 운영 차단, 외부 보류를 실행 상태, 확인 증거, 재검증 시점, 검증 명령으로 묶고 외부 보류는 P1 readiness blocked 증거로만 보관한다.
- [x] `/app/admin/settings`의 `P3 피드백 재발 방지 보드`는 개선 후보, 버그, 운영 차단, 외부 보류를 재발 신호, 방지 확인, 다음 점검, QA 명령으로 묶고 외부 보류는 P1 readiness blocked 유지 사유로만 보관한다.
- [x] `/app/admin/settings`의 `P3 운영 자동화 실행`는 운영일 마감 자동 점검, 지점 주간 운영 리뷰, 모바일 역할 가드, 배포 readiness 재확인을 담당, 실행 주기, 증거, 확인 기준, 검증 명령으로 묶고, P3 진행률만 갱신하며 iOS Simulator 성공을 IPA ready로 보지 않는다.
- [x] `/app/admin/settings`의 `P3 운영 자동화 실패 복구 보드`는 반복 운영 명령 실패를 실패 신호, 복구 담당, 재시도 창, 복구 증거, 에스컬레이션, 검증 명령으로 묶고, P3 진행률만 갱신하며 P1 release readiness와 분리한다.
- [x] `/app/admin/settings`의 `P3 운영 검증 매트릭스`는 운영 데이터, 코치 현장, 회원/학부모, 파일럿 피드백, 관리자 상태판을 영역별 검증 상태, 증거 화면, 다음 재확인, 검증 명령으로 묶고 P1 외부 blocker와 분리한다.
- [x] `/app/admin/settings`의 `P3 주간 운영 리뷰 패킷`은 대표 운영 리뷰, 코치 현장 회고, 회원/학부모 유지 리뷰, 파일럿 피드백 회고, 릴리즈 오판 방지 리뷰를 회의 증거 묶음, 결정 산출물, 후속 확인, 검증 명령으로 묶고 P1 release blocked 상태와 분리한다.
- [x] `/app/admin/settings`는 운영 확인 화면만 유지하고 P4 내부 상태판은 표시하지 않는다. `npm run test:p4-simulator-rehearsal`은 `.data/mobile-builds/ios/p4-simulator-screenshots` 증거와 P1 readiness 7개 중 iOS 1개 ready·6개 blocked 상태를 확인하며, iPhone 16e Simulator 캡처는 실제 서비스 화면 연결 증거로 보관하지만 iOS Simulator 성공을 IPA ready로 보지 않음 상태를 유지한다.
- [x] P5~P10 내부 readiness audit와 외부 blocker 문구는 실제 앱 UI에 표시하지 않고 `.data/p5-p10-internal-audit.json`, `.data/p5-p10-internal-audit.md`, `.data/mobile-builds/ios/p5-p10-simulator-screenshots`, `.data/mobile-builds/ios/visible-copy-expanded`, `.data/mobile-builds/ios/visible-text-audit-20260621-recheck`에만 보관한다. 모바일 하단 내비게이션은 active 메뉴를 자동으로 화면 안쪽에 맞추고, 코치 모바일 저장 상태 패널은 하단 내비게이션과 iOS safe area 위로 배치하되 기본 상태에서는 한 줄 출석 요약과 저장 대기/처리율만 표시해 출석 조작을 덜 가리며, Next 개발 표시 배지는 개발 검증 캡처에서 하단 내비게이션을 가리지 않도록 비활성화한다. 역할별 `autoLogin` deep link는 같은 역할 세션에서도 로그인 화면이 아닌 실제 서비스 화면으로 이동한다. 직접 접근 차단/비밀번호 재설정/사용자 목록/초대/공지 작성 화면은 예시 이메일, 더미 연락처, 내부 권한·지점 범위 표현을 노출하지 않는다. 관리자 변경 기록 화면은 stale runtime 기록이 있더라도 `변경 기록을 조회했습니다.`로 표시하고 이전 내부 표현을 렌더링하지 않는다. 41개 역할/경로 확장 visible copy 캡처는 비어 있지 않은 앱 화면이어야 한다. P1 외부 blocker는 별도 blocked 항목으로 유지하고 출시 완료, IPA ready, 운영 ready로 보지 않는다.
- [x] `/app/admin/settings`의 `P3 주간 리뷰 액션 추적 보드`는 주간 리뷰 액션을 액션 담당, 마감 창, 업데이트 증거, 검증 명령으로 닫고 P1 release blocked 분리 상태를 유지한다.
- [x] `/app/admin/settings`의 `P3 주간 리뷰 효과 측정 보드`는 닫은 주간 리뷰 액션을 효과 신호, 측정 창, 업데이트 증거, 다음 판단, 검증 명령으로 재확인하고 P1 release blocked 유지를 분리한다.
- [x] `/app/dashboard`의 회원 화면은 `회원 홈`/`오늘 요약` 같은 보조 제목 없이 핵심 상태를 단일 패널로 유지하고, 학부모 화면은 `학부모 홈` 소개문 없이 자녀별 학습 리포트에서 단계/피드백/심사/대회 정보를 우선 보여주며 긴 공지/피드백 본문은 모바일 카드 기준으로 축약한다. 다음 행동 큐/오늘 확인 브리프/주간 확인 리듬/복귀 안내 레일/수업 전 준비 보드/확인 리마인드 큐/24시간 팔로업 큐/오늘 마감 액션 보드 같은 내부 운영 안내와 회원/학부모 CSV 내보내기 액션을 노출하지 않는다. `npm run test:e2e`, `npm run test:p3-operations`, `npm run test:role-csv-export-gates`, `npm run test:p5-p10-internal-readiness`가 이 기준을 검증한다.
- [x] 회원/학부모 `/app/requests`와 `/requests`는 제공하지 않고 요청 카드/작성 폼/승인 흐름을 노출하지 않는다. 요청 생성/승인/반려 API 라우트도 제공하지 않으며 직접 접근은 `404`다. `npm run build`, `npm run test:routes`, `npm run test:api-auth-order`, `npm run test:deleted-request-surface`, `npm run test:notification-readiness`, `npm run test:p5-p10-internal-readiness`가 검증한다.
- [x] 대표/총괄 `/app/notices`의 공지 작성은 전용 공지 메뉴 안에서만 제공하고, 모바일 기본 화면에서는 공지 확인/읽음 처리가 먼저 보이도록 작성 폼을 접어 둔다. `작성 열기` 토글은 44px 터치 높이를 유지하고, 열린 폼의 제목/내용/대상/발행 입력도 44px 터치 기준과 가로 overflow 0을 유지한다. 증빙은 `.data/mobile-builds/ios/notice-create-collapse-20260626`에 보관한다.
- [x] 회원/학부모 `/app/payments`는 금액 중심 요약 카드, 운영 액션 큐, CSV 내보내기 없이 회원권 상태 리스트만 보여주고 납부일/만료일 중심으로 확인하게 한다. 대표/총괄의 결제 운영 보드, 금액, 결제 내보내기, 환불/취소/정기결제 관리는 기존 권한 범위에서 유지한다. `npm run test:role-csv-export-gates`, `npm run test:p5-p10-internal-readiness`, 모바일 브라우저와 iPhone 16e Simulator 캡처가 검증한다.
- [x] `/app/classes`의 `P3 코치 보호자 안내 마감 큐`는 보호자 안내 마감, 저장 마감, 운영 증거 확인을 수업 후 운영 증거와 `npm run test:p3-operations` 검증 명령으로 묶고, 결제 금액 비노출 유지와 P1 release readiness 분리를 함께 표시한다.
- [x] `/app/classes`의 `P3 코치 수업 후 24시간 후속 큐`는 사유 메모, 보호자 안내, 주의/상담, 저장 기록을 후속 트리거, 후속 행동, 완료 증거, 재확인 시점으로 묶고, 코치 화면 금액 미노출과 P1 release readiness 분리를 함께 표시한다.
- [x] `/app/classes`의 `P3 코치 3분 마감 루틴 보드`는 1분 출석, 1분 사유, 30초 보호자 안내, 30초 저장을 마감 순서, 현장 실행, 운영 증거, 검증 명령으로 묶고, 결제 금액 비노출 유지와 P1 release readiness 분리를 함께 표시한다.
- [x] `/app/classes`의 `P3 코치 수업 확인 보드`는 출석 마감, 사유 메모, 보호자 안내, 저장 상태를 수업 사이 확인, 담당, 확인 마감, 운영 증거, 검증 명령으로 묶고, 누락 방지와 결제 금액 비노출 유지 및 P1 release readiness 분리를 함께 표시한다.
- [x] `/app/classes`의 `P3 코치 수업 전 준비 큐`는 출석 명단 선확인, 주의/상담 선확인, 사유 메모 준비, 저장 상태 확인을 수업 전 준비, 준비 신호, 현장 실행, 준비 마감, 운영 증거, 검증 명령으로 묶고, 결제 금액 비노출 유지와 P1 release readiness 분리를 함께 표시한다.
- [x] `/app/classes`의 `P3 코치 수업 전 5분 준비 보드`는 명단 위험, 사유 누락, 상담/보호자 안내, 저장 상태를 5분 준비, 현장 실행, 다음 재확인, 운영 증거, 검증 명령으로 묶고, 코치 화면 금액 미노출과 P1 release readiness 분리를 함께 표시한다.
- [x] `/app/admin/settings`의 `P3 피드백 회고 액션 보드`는 개선 후보 회고, 버그 회고, 운영 차단 회고, 외부 보류 회고를 담당자, 완료 기준, 재확인 시점, 검증 명령으로 묶고, P1 release readiness와 분리한다.
- [x] `/app/admin/settings`의 `P3 피드백 증거 패킷 보드`는 피드백 증거 패킷을 개선 후보, 버그, 운영 차단, 외부 보류로 분류하고 증거 묶음, 재현/영향, QA/백로그 반영, `npm run test:p3-operations` 검증 명령으로 묶으며, P1 외부 blocker와 섞지 않고 P1 release readiness와 분리한다.
- [x] `/app/admin/settings`의 `P3 피드백 운영 지표 보드`는 개선 후보, 버그, 운영 차단, 외부 보류를 분류별 운영 지표, 노화 창, 백로그 신호, 운영 판단, 검증 명령으로 묶고, 외부 보류는 P1 release blocked 유지 사유로만 보관한다.
- [x] `/app/owner/reports`의 `P3 지점 조기 경보 보드`는 출석률 하락, 결제 위험 증가, 출석 확인, 회원 순감, 매출 하락을 조기 경보 점수, 감지 신호, 1차 대응, 확인 창, 검증 명령으로 묶고, P1 release readiness와 분리한다.
- [x] `/app/owner/reports`의 `P3 지점 유지율 경보 큐`는 회원 순감, 출석률 하락, 휴면 회원, 결제 위험, 출석 확인을 유지율 경보, 감지 신호, 우선 대응, 확인 마감, 운영 증거, 검증 명령으로 묶고, P1 release readiness와 분리한다.
- [x] `/app/owner/reports`의 `P3 유지율 후속 기록 보드`는 유지율 경보 이후 후속 대상, 담당자, 변경 기록, 재확인 시점, 닫힘 기준, 검증 명령을 표시하고, P1 release readiness와 분리한다.
- [x] `/app/owner/reports`의 `P3 지점 조치 효과 리뷰 보드`는 지점별 운영 실험을 기준 신호, 기대 변화, 리뷰 지표, 다음 결정, 증빙 기준으로 묶고, P1 release readiness와 분리한다.
- [x] `/app/owner/reports`의 `P3 지점 액션 닫힘 점검 보드`는 지점 액션 실행 이후 닫힘 신호, 점검 증거, 닫힘 창, 다음 점검을 검증 명령과 함께 묶고, P3 진행률만 갱신하며 P1 release readiness와 분리한다.
- [x] `/app/owner/reports`의 `P3 지점 액션 표준화 보드`는 닫힌 지점 액션을 표준화 액션, 적용 조건, 확산 대상, 표준화 증거, 다음 표준 리뷰로 바꾸고, P3 진행률만 갱신하며 P1 release readiness와 분리한다.
- [x] `/app/owner/reports`의 `P3 지점 표준 확산 추적 보드`는 표준화된 지점 액션을 확산 상태, 적용 지점, 교육/공유 패킷, 적용 신호, 다음 확산 리뷰로 추적하고, P3 진행률만 갱신하며 P1 release readiness와 분리한다.
- [x] `/app/owner/reports`의 `P3 지점 표준 품질 점검 보드`는 확산된 표준 운영을 품질 점검, 보정 액션, 점검 창, 품질 증거, 다음 품질 리뷰로 재확인하고, P3 진행률만 갱신하며 P1 release readiness와 분리한다.
- [x] `/app/owner/reports`의 `P3 지점 표준 재교육 큐`는 품질 점검에서 흔들린 표준 운영을 재교육 트리거, 재교육 담당, 재교육 패킷, 재교육 마감, 수용 신호, 다음 재교육 리뷰로 닫고, P3 진행률만 갱신하며 P1 release readiness와 분리한다.
- [x] `/app/owner/reports`의 `P3 지점 표준 재교육 효과 검증 보드`는 재교육 이후 표준 운영을 효과 신호, 측정 창, 효과 증거, 정착 액션, 재발 방지, 다음 효과 리뷰로 재확인하고, P3 진행률만 갱신하며 P1 release readiness와 분리한다.
- [x] `/app/owner/reports`의 `P3 지점 표준 운영 정착 보드`는 재교육 효과가 확인된 표준 운영을 정착 기준, 운영 주기, 정착 증거, 담당 고정, 재발 감시, 다음 정착 리뷰로 고정하고, P3 진행률만 갱신하며 P1 release readiness와 분리한다.
- [x] `/app/owner/reports`의 `P3 지점 표준 성과 리포트 보드`는 정착된 표준 운영을 성과 지표, 보고 주기, 성과 증거, 대표 판단, 공유 대상, 다음 성과 리뷰로 묶고, P3 진행률만 갱신하며 P1 release readiness와 분리한다.
- [x] `/app/owner/reports`의 `P3 지점 표준 성과 액션 추적 보드`는 성과 리포트의 대표 판단을 후속 액션, 액션 담당, 액션 마감, 액션 증거, 에스컬레이션, 다음 액션 리뷰로 추적하고, P3 진행률만 갱신하며 P1 release readiness와 분리한다.
- [x] `/app/owner/reports`의 `P3 월간 운영 리듬 보드`는 장기 추세 점검, 위험 회원/결제 회수, 재등록 후보 상담, 지점 비교/액션 리뷰를 1~4주차 의사결정, 운영 증거, 확인 기준, 검증 명령으로 묶고, P1 release readiness와 분리한다.
- [x] `/app/owner/reports`의 `P3 운영 결정 추적 보드`는 장기 추세, 위험 회원, 재등록 후보, 결제 회수 우선순위, 지점 비교 결과를 결정 기록, 운영 신호, 운영 증거, 다음 재확인, 검증 명령으로 묶고, P1 release readiness와 분리한다.
- [x] `/app/owner/reports`의 `P3 이번 주 운영 결정 큐`는 장기 추세, 결제 회수, 재등록 상담, 지점 액션을 이번 주 결정, 결정 트리거, 결정 마감, 운영 증거, 검증 명령으로 묶고, P1 release readiness와 분리한다.
- [x] `/app/owner/reports`의 `P3 다음 주 지점 운영 준비 보드`는 이번 주 결정 큐를 준비 항목, 다음 주 신호, 담당자, 준비 마감, 운영 증거, 검증 명령으로 바꾸고, 회원/학부모 내보내기 액션 없음과 대표/총괄 CSV 권한 가드 및 P1 release readiness 분리를 유지한다.
- [x] `/app/classes`의 `P3 코치 예외 처리 라우팅 보드`는 모바일 출석, 사유 메모, 상담/주의, 저장 예외를 현장 신호별로 즉시 처리, 보호자 안내, 대표 확인, 다음 수업 전 재확인으로 분리하고, 검증 명령, 결제 금액 비노출 유지, P1 release readiness 분리를 함께 표시한다.
- [x] `/app/classes`의 `P3 코치 현장 기록 압축 보드`는 사유/상담, 보호자 안내, 저장 기록을 기록 압축, 현장 기록, 기록 마감, 다음 재확인, 검증 명령으로 묶고, 코치 화면 금액 미노출과 P1 release readiness 분리를 함께 표시한다.
- [ ] 실제 PostgreSQL smoke 전 `npm run postgres:doctor -- --strict --out=.data/postgres-docker-readiness.json --markdown=.data/postgres-docker-readiness.md`를 실행해 Docker CLI/daemon ready 상태와 Postgres URL redaction을 보관하고, 운영 DB 환경까지 점검할 때는 `--require-postgres-env`를 추가해 `.data/postgres-docker-readiness.md`를 함께 보관
- [ ] 실제 운영값 입력 전 `npm run p1:handoff-draft -- --out-dir=.data`로 6개 handoff/IPA 초안과 blocked 리포트, `.data/postgres-docker-readiness.md` Postgres/Docker 점검표, `.data/android-twa-doctor.md` 공유 점검표, `.data/mobile-builds/ios/ios-ipa-doctor.md` iOS IPA 점검표, 담당자별 JSON/CSV/Markdown action checklist, 6인 팀 action brief, 담당자별 Markdown brief/package index/package 폴더, bundle manifest, dispatch receipt 초안/blocked 리포트, issue draft, GitHub CLI 등록 명령, GitHub connector payload, GitHub JSON/CSV 등록 결과 템플릿, issue registration plan, issue registration receipt 초안/blocked 리포트, P1 readiness 감사 리포트, P1 final evidence intake JSON/CSV/Markdown 생성 및 `.data/p1-handoff-draft-workspace.json`, `.data/postgres-docker-readiness.*`, `.data/p1-handoff-action-checklist.*`, `.data/p1-handoff-action-brief.md`, `.data/p1-handoff-owner-briefs/*.md`, `.data/p1-handoff-owner-package-index.md`, `.data/p1-handoff-owner-packages/*`, `.data/p1-handoff-bundle-manifest.json`, `.data/p1-handoff-dispatch-report.json`, `.data/p1-handoff-issue-drafts/*`, `.data/p1-handoff-issue-registration-report.json`, `.data/p1-readiness.json`, `.data/p1-evidence-intake-draft.*` 보관. GitHub repo는 `--github-repo`, `GITHUB_REPOSITORY`, 로컬 `git remote origin` 순서로 결정되며 connector payload의 repo가 실제 저장소인지 확인
- [ ] handoff blocked 리포트 갱신 후 `npm run p1:handoff-checklist -- --workspace=.data`로 담당자별 JSON/CSV/Markdown action checklist, 6인 팀 action brief, 담당자별 Markdown brief/package index/package 재생성 및 각 package의 `team-agent-prompts.md`, `.data/p1-handoff-action-checklist.*`, `.data/p1-handoff-action-brief.md`, `.data/p1-handoff-owner-briefs/*.md`, `.data/p1-handoff-owner-package-index.md`, `.data/p1-handoff-owner-packages/*` 보관
- [ ] 담당자 전달 전 `npm run p1:handoff-bundle -- --workspace=.data --out=.data/p1-handoff-bundle-manifest.json`로 bundle manifest 생성, owner package 6개와 각 `team-agent-prompts.md` SHA-256/byte size, 원문 secret-like 값 미기록 검증 및 `.data/p1-handoff-bundle-manifest.json` 보관
- [ ] 담당자 전달 시 `npm run p1:handoff-dispatch:draft -- --bundle=.data/p1-handoff-bundle-manifest.json --out=.data/p1-handoff-dispatch-receipt.json --markdown=.data/p1-handoff-dispatch-receipt.md --csv=.data/p1-handoff-dispatch-receipt.csv`로 JSON/Markdown/CSV receipt 초안을 만들고 `.data/p1-handoff-dispatch-receipt.csv`의 담당자/채널, ISO due date, URL/보관 경로 assignment evidence, acknowledgement 증빙을 채운 뒤 `npm run p1:handoff-dispatch:apply-csv -- --receipt=.data/p1-handoff-dispatch-receipt.json --csv=.data/p1-handoff-dispatch-receipt.csv --out=.data/p1-handoff-dispatch-receipt.completed.json --markdown=.data/p1-handoff-dispatch-receipt.completed.md`로 completed receipt를 생성한다. 이후 `npm run p1:handoff-dispatch -- --file=.data/p1-handoff-dispatch-receipt.completed.json --bundle=.data/p1-handoff-bundle-manifest.json --out=.data/p1-handoff-dispatch-report.json` 통과 및 증빙 보관
- [ ] 담당자별 업무 등록 전 `npm run p1:handoff-issues:draft -- --receipt=.data/p1-handoff-dispatch-receipt.completed.json --out-dir=.data/p1-handoff-issue-drafts`로 owner별 GitHub/Slack issue draft Markdown, index, JSON manifest, GitHub CLI command file, `github-connector-issue-payloads.json`, `github-connector-issue-responses.template.json`, `github-connector-runbook.md`, `github-issue-create-results.template.json`, `github-issue-create-results.template.csv`, registration plan 생성 및 검토. `issue-drafts.json`과 runbook의 `publishReady=true` 확인 후에만 `github-issue-create-commands.sh`, GitHub connector payload/runbook, 또는 동등한 외부 workflow로 실제 이슈/메시지를 등록한다. 저장소를 강제로 지정해야 하면 `--github-repo=<owner/repo>`를 붙인다.
- [ ] 외부 이슈/메시지 등록 후 `github-issue-create-results.template.csv`을 `.data/p1-handoff-issue-drafts/github-issue-create-results.csv`로 채우고 HTTPS URL, ISO `postedAt`/`acknowledgedAt`, `acknowledged` 상태를 확인한 뒤 `npm run p1:handoff-issue-receipt:apply-results-csv -- --issue-drafts=.data/p1-handoff-issue-drafts/issue-drafts.json --csv=.data/p1-handoff-issue-drafts/github-issue-create-results.csv --out=.data/p1-handoff-issue-registration-receipt.json --markdown=.data/p1-handoff-issue-registration-receipt.md`로 receipt를 생성한다. GitHub connector `_create_issue` 응답을 사용하면 `.data/p1-handoff-issue-drafts/github-connector-issue-responses.json`에 응답 원본과 row별 `acknowledgement.status`/`acknowledgement.acknowledgedAt`/`acknowledgement.evidence`를 보관하고 `acknowledged` row는 HTTPS 증빙, ISO timestamp, issue 생성 이후 시간을 채운 뒤 `npm run p1:handoff-issue-receipt:connector-results -- --issue-drafts=.data/p1-handoff-issue-drafts/issue-drafts.json --responses=.data/p1-handoff-issue-drafts/github-connector-issue-responses.json --out=.data/p1-handoff-issue-drafts/github-issue-create-results.json`로 results JSON을 만든다. 자동 연동이 이미 JSON을 내보내면 `github-issue-create-results.template.json`을 `.data/p1-handoff-issue-drafts/github-issue-create-results.json`로 채우고 `npm run p1:handoff-issue-receipt:apply-results -- --issue-drafts=.data/p1-handoff-issue-drafts/issue-drafts.json --results=.data/p1-handoff-issue-drafts/github-issue-create-results.json --out=.data/p1-handoff-issue-registration-receipt.json --markdown=.data/p1-handoff-issue-registration-receipt.md`를 사용한다. 직접 입력이 필요하면 `npm run p1:handoff-issue-receipt:draft -- --issue-drafts=.data/p1-handoff-issue-drafts/issue-drafts.json --out=.data/p1-handoff-issue-registration-receipt.json --markdown=.data/p1-handoff-issue-registration-receipt.md`로 receipt 초안을 만들고 URL/담당자/body hash/acknowledgement 증빙을 채운 뒤 `npm run p1:handoff-issue-receipt -- --file=.data/p1-handoff-issue-registration-receipt.json --issue-drafts=.data/p1-handoff-issue-drafts/issue-drafts.json --out=.data/p1-handoff-issue-registration-report.json` 통과 및 증빙 보관
- [ ] 최종 외부 증빙 입력 직전 `npm run p1:evidence-intake:draft -- --workspace=.data --readiness=.data/p1-readiness.json`로 담당 영역별 blocker, 필수 증빙, strict 명령, TODO 입력 필드를 담은 `.data/p1-evidence-intake-draft.json`, `.data/p1-evidence-intake-draft.csv`, `.data/p1-evidence-intake-draft.md` 생성 및 원문 secret-like 값 미기록 확인
- [ ] 운영자가 `.data/p1-evidence-intake-draft.csv`의 `evidenceOwner`, URL/보관 경로 형태의 `evidenceUrl`, ISO `checkedAt`, URL/보관 경로 형태의 `signoff`를 채운 뒤 `npm run p1:evidence-intake:apply-csv -- --csv=.data/p1-evidence-intake-draft.csv --json=.data/p1-evidence-intake-draft.json --out=.data/p1-evidence-intake.completed.json` 통과 및 `.data/p1-evidence-intake.completed.json` 보관
- [ ] P1 readiness가 ready가 된 뒤 `npm run p1:evidence-intake -- --file=.data/p1-evidence-intake.completed.json --readiness=.data/p1-readiness.json --out=.data/p1-evidence-intake-report.json` 통과 및 `.data/p1-evidence-intake-report.json` 보관
- [ ] 외부 증빙 입력 중간 점검 시 `npm run p1:operator-status -- --workspace=.data --allow-pending --out=.data/p1-operator-status.json --markdown=.data/p1-operator-status.md --external-blockers-csv=.data/p1-operator-status-external-blockers.csv`로 ready 요구사항, Android doctor Markdown, `.data/mobile-builds/ios/ios-ipa-doctor.md` iOS IPA doctor Markdown, iOS Local Profile Inventory(profile 파일 수, Team ID/bundle id 매칭 수, 등록 기기 포함 profile 수, UDID 원문 미기록), 남은 owner action, 담당 영역별 `externalBlockers`, 외부 blocker CSV의 `evidenceOwner`/`evidenceUrl`/`checkedAt`/`signoff` 입력 열, GitHub Connector Markdown 섹션의 repo/checkedAt/default branch/권한/payload publish 상태, Evidence Format Guardrails 섹션의 HTTPS/provider URI, ISO timestamp, 승인 시간순서, TODO/placeholder/example origin 제거, 원문 secret 금지 규칙, Deferred External Prep 섹션의 운영 웹앱 origin/iOS 실제 iPhone provisioning 사용자 보류와 readiness blocked 유지 사유, Release Custody Markdown 섹션의 release package/archive/storage receipt 보관 상태와 readiness/evidence intake prerequisite, 다음 액션을 JSON/Markdown/CSV로 보관
- [ ] 운영자가 `.data/p1-operator-status-external-blockers.csv`의 7개 row에 `evidenceOwner`, HTTPS URL/provider URI 형태의 `evidenceUrl`, ISO `checkedAt`, HTTPS URL/provider URI 형태의 `signoff`를 채운 뒤 `npm run p1:operator-status:apply-external-blockers-csv -- --csv=.data/p1-operator-status-external-blockers.csv --json=.data/p1-operator-status.json --out=.data/p1-operator-status-external-blockers.completed.json --markdown=.data/p1-operator-status-external-blockers.completed.md` 통과 및 completed JSON/Markdown 보관
- [ ] P1 완료 기준 감사 시 `npm run p1:completion-evidence -- --workspace=.data --allow-pending --out=.data/p1-completion-evidence.json --markdown=.data/p1-completion-evidence.md --csv=.data/p1-completion-evidence.csv`로 10개 완료 기준별 증거 명령, 회원/학부모 CSV 비노출 게이트, Android/iOS doctor support artifact, `externalBlockers`, Release Custody 상태, 다음 액션과 `evidenceOwner`/`evidenceUrl`/`checkedAt`/`signoff` 입력 열을 JSON/Markdown/CSV 매트릭스로 보관. Android TWA doctor/iOS IPA doctor가 운영 웹앱 origin, release signing, 실제 iPhone provisioning profile 같은 외부 조건으로 blocked이면 진단 상태는 남기되 내부 미완이 아니라 외부 증빙 대기로 분류한다.
- [ ] 운영자가 `.data/p1-completion-evidence.csv`의 10개 row에 `evidenceOwner`, HTTPS URL/provider URI 형태의 `evidenceUrl`, ISO `checkedAt`, HTTPS URL/provider URI 형태의 `signoff`를 채운 뒤 `npm run p1:completion-evidence:apply-csv -- --csv=.data/p1-completion-evidence.csv --json=.data/p1-completion-evidence.json --out=.data/p1-completion-evidence.completed.json --markdown=.data/p1-completion-evidence.completed.md` 통과 및 completed JSON/Markdown 보관
- [ ] 운영 배포, Android release, iOS IPA build/provisioning, 결제 provider, 운영 푸시, P1 handoff issue registration receipt, 파일럿 최종 status 리포트가 모두 준비된 뒤 `npm run p1:readiness -- --workspace=.data --out=.data/p1-readiness.json --markdown=.data/p1-readiness.md` 통과 및 최종 P1 readiness JSON/Markdown 리포트 보관
- [ ] 최종 P1 readiness와 evidence intake 통과 후 `npm run p1:release-package -- --workspace=.data --out=.data/p1-release-package.json`로 P1 readiness, P1 evidence intake report, 7개 필수 readiness 리포트의 SHA-256/byte size 포함 release package manifest 보관
- [ ] 최종 P1 release package 생성 후 `npm run p1:release-archive -- --package=.data/p1-release-package.json --archive-dir=.data/p1-release-archives/final-judo-p1-20260715`로 package와 9개 필수 리포트 원본 해시를 재검증하고 fresh archive 폴더/`p1-release-archive-manifest.json` 보관
- [ ] P1 release archive 업로드 전 `npm run p1:release-storage-receipt:draft -- --archive=.data/p1-release-archives/final-judo-p1-20260715/p1-release-archive-manifest.json --out=.data/p1-release-storage-receipt.json`로 장기 보관 receipt 초안을 생성하고, ISO uploadedAt, HTTPS/provider URI 업로드 위치, 담당자, HTTPS/provider URI 업로드 증빙, 보존 정책 증빙을 채운 뒤 `npm run p1:release-storage-receipt -- --file=.data/p1-release-storage-receipt.json --archive=.data/p1-release-archives/final-judo-p1-20260715/p1-release-archive-manifest.json` 통과 및 receipt 보관
- [x] `npm run test:notification-readiness` 공지 화면 알림 권한 UI, VAPID 구성 상태, PushSubscription 저장/해지 API, 잘못된 해지 타입 무변경, 회원·학부모 항상 켜짐, 역할별 활성 구독 수 스코프, 동일 endpoint 계정 이전 잠금·진행 중 발송 보호·감사 기록, 공지별 push dispatch API, 중요 공지 발행/배지/푸시 제목, 작성·수정 제목/본문·대상 개수 입력 제한, 공지함 미읽음/중요 필터와 빈 상태, 보이는 공지 읽음 처리, 일괄 읽음 원본 50건·문자열 ID 입력 제한과 무부분변경, 접근 불가 공지 존재·식별자 목록 비노출, 확인할 공지, AppShell 상단 공지 버튼 미읽음 배지, 테스트 알림 표시, push/click 경로, 브라우저/서비스 워커 구현 문구 비노출 검증 통과
- [x] `npm run test:smoke` 및 `npm run test:notification-readiness` 푸시 구독 endpoint의 HTTPS·2,048자 상한과 key의 Base64URL·512자 상한, 초과 등록·해지 `400`, 기존 활성 구독 무변경, 회원·학부모 항상 켜짐 회귀 검증 통과
- [x] `npm run test:mobile-notification-inbox` 회원·학부모 모바일 알림함에서 권한 요청부터 PushSubscription 서버 저장까지의 연결 흐름, 44px 터치 영역, 가로 오버플로 0, 공지 읽음 톤다운 검증 통과
- [x] `npm run test:notification-outbox` 및 `npm run test:notification-outbox-integration` 구독별 durable 작업, lease/revision/backoff/dead letter, provider 시작 전 sent/failed 정산 거부, provider 호출 전·후 취소 결과의 `not_started`/`uncertain` 구분과 완료 시각·bounded fence 보존, 재시도별 provider fence 초기화·전송 중 소유권 변경 차단·누적 전달 불확실성 보존, timeout 뒤 원래 lease 만료까지 재시도·구독 소유권/키 변경을 막는 bounded provider fence, 404/410 만료 구독의 같은 기기 잔여 작업 취소와 병렬 provider 호출 불확실성 보존, 일부 발송·일부 취소 요청의 확인 필요 감사, 수동 재발송 멱등 digest, 공지 변경 전송 취소 경계, provider timeout·불확실 전송·stale settlement 감사, 발송 직전 권한 재검증, 시도별 감사 기록, CRON_SECRET 보호 검증 통과
- [x] 스모크 테스트 실행 전후 JSON 데모 데이터 기준 상태 복구
- [x] 데모 역할 로그인 production 기본 비활성화와 명시 플래그 허용 검증
- [x] 이메일/임시 비밀번호 운영 로그인과 `passwordHash` 응답 마스킹 smoke 검증
- [x] `/api/v1/dev/reset` production 기본 비활성화, 명시 플래그·helper 발급 실행별 소유권 토큰·run-owned 임시 JSON 마커·실제 `PILOT_DB_FILE` 일치 조건, 기존 서버/공유·심볼릭 링크 저장소/PostgreSQL reset 거부 검증
- [x] `/app/classes` 모바일 출석 smoke 통과
- [x] 모바일 출석 E2E와 출석 속도 smoke가 코치 운영 계정 로그인 경로 사용
- [x] 모바일 전체 출석 일괄 저장과 회원별 변경 기록 E2E 통과
- [x] 모바일 수업별 처리율/미처리 인원과 전체 출석 후 100%/0명 갱신 E2E 통과
- [x] 모바일 출석 상태 빠른 필터, 빠른 메모 칩, 미처리만 보기 필터, 완료 회원 숨김, 완료/상태별 빈 상태 E2E 통과. 390px 코치 화면에서는 상태 필터를 가로 칩 레일로 유지하고 중복 상태 요약 카드는 숨기며 기본 저장 문구는 한 줄로 압축한다.
- [x] 모바일 공지 미읽음/중요 필터, 표시 건수, pressed 상태, 확인할 공지, 보이는 공지 읽음 처리, 터치 영역 E2E 통과
- [x] 모바일 출석 오프라인 대기 큐 새로고침 복구와 재동기화 E2E 통과
- [x] 총괄 어드민 임시 비밀번호 발급 API/UI와 `auth.password_reset.complete` smoke 검증. 대기 초대 동시 승인은 `200/409`, 1회 표시 임시 비밀번호·`user.invite.approve` 감사 기록 각 한 건으로 직렬화
- [x] `/app/admin/branches` 총괄 지점 관리 smoke 통과
- [x] `/app/admin/roles` 총괄 어드민 smoke 통과
- [x] `/app/notices`, `/app/account`, `/app/notifications`, `/select-role` 역할 선택 IA route smoke 통과
- [x] `/app/owner/branches`, `/app/owner/reports`, `/app/admin/users`, `/app/admin/settings` 전용 IA route smoke 통과
- [x] `/app/admin/settings` 파일럿 준비 게이트 표시, 상태/담당자/증빙 저장, 변경 기록 기록
- [x] `/app/admin/settings` 현장 운영 관제 표시, 준비 확인/고유 운영일/미해결 P0/P1/모바일 출석 증빙과 다음 액션 안내
- [x] `/app/admin/settings` 자동 검증 게이트에 보안 audit, 운영 데이터 점검, 파일럿 증빙 리포트, 파일럿 준비 계약 검사 표시
- [x] `/app/admin/settings` 파일럿 준비 게이트에 계정별 임시 비밀번호 교체 보안 체크 포함
- [x] `/app/admin/settings` 파일럿 이슈 로그 표시, 생성/상태 변경, 변경 기록 기록
- [x] `/app/admin/settings` 파일럿 14일 운영 로그 표시, 고유 운영일 기준 누락일/다음 입력 추천일/모바일 30초 증빙 누락, 일일 운영 수치/증빙 저장, 변경 기록 기록
- [x] 모바일 앱 shell에서 현재 계정/역할/지점 요약, 계정 전환, 로그아웃 액션이 390px E2E로 검증
- [x] 파일럿 운영 로그의 불가능한 날짜와 차단 사유 없는 `blocked` 상태 API/preflight 차단
- [x] `docs/QA_TEST_PLAN.md`의 P0 시나리오 수동 실행 기록 작성
- [x] axe 또는 Lighthouse 접근성 검사 실행
- [x] 버튼 이름/폼 라벨/이미지 alt/tabIndex 정적 검사 실행

- [x] stale settlement 거부 감사가 claimed/current 작업의 이전 `deliveryMayHaveOccurred`를 보존해 현재 시도의 확정 실패가 누적 불확실성을 덮지 않는지 통합 게이트로 검증

## 2. 인증/권한

- [x] 실제 로그인/로그아웃 route handler 연결
- [x] 운영 계정 이메일/임시 비밀번호 로그인 연결
- [x] `/login`의 회원가입 진입은 `/signup`에서 공개 가능한 활성 지점 중 가입 지점과 이름·휴대폰 번호·비밀번호를 받아 같은 지점의 성인 회원 사용자·회원 프로필을 생성하고 같은 비밀번호로 로그인 가능. 서버는 복수 지점 미선택과 위조·비활성·운영자 미배정 지점, 이름 30자·비밀번호 256자 등 공개 인증 입력 상한 초과를 저장·PBKDF2 전에 차단하며 초대 수락은 `/invite/:token`에만 남긴다
- [x] 비밀번호 재설정 또는 초대 가입 플로우 연결. 초대 수락은 12자 이상 초기 비밀번호 설정이 필요하고 기본 임시 비밀번호/사용된 링크 재사용을 차단
- [x] 총괄 어드민 사용자별 임시 비밀번호 발급과 원문 비밀번호 변경 기록 미저장 검증
- [x] 5개 역할의 메뉴/스코프 smoke 검증
- [x] 비인가 직접 URL 403 검증
- [x] 자기 계정 보호 서버 검증
- [x] 권한 변경 변경 기록 검증

## 3. 지점/데이터 스코프

- [x] 대표가 배정 지점만 조회하는지 검증
- [x] 코치가 담당 지점/수업만 조회하는지 검증
- [x] 학부모가 연결 자녀만 조회하는지 검증
- [x] 회원이 본인 리소스만 조회하는지 검증
- [x] 서버 API에서 클라이언트 `branchId` 변조를 무시하는지 검증

## 4. 운영 기능

- [x] 총괄 지점 생성/수정/비활성화/대표 배정의 잘못된 타입·지점명 81자·지역 101자·시간대 65자·사유 501자·대표 ID 201자 무변경, 인증·선택 지점 선검사, 잠금 밖 본문 파싱과 잠금 안 최신 상태 재검사, 느린 본문 중 다른 지점 변경 선완료, UUID 감사 ID, 같은 이름 동시 생성과 생성·이름 변경 교차 요청 직렬화 서버 API 검증
- [x] 대표 지점 범위 코치/학부모/회원 초대 서버/UI 검증
- [x] 코치 전체 출석 일괄 저장/개별 저장/수정 사유/충돌/오프라인 대기 큐 복구/재동기화 검증
- [x] 대표/총괄 회원 등록/상태 변경 서버 API, 등록 필드 타입·실제 달력 생년월일·이름/레벨/띠/연락처 길이 400 차단, UUID 기반 동시 회원 등록 2건과 감사 기록 보존 검증
- [x] 대표/총괄 보호자-자녀 연결 서버/UI 검증
- [x] 대표/총괄 수업 생성/수정 서버 API, 생성 필드 타입과 공통 텍스트·식별자·원본 등록회원 길이 400 차단, UUID 기반 동시 수업 등록 2건과 감사 기록 보존 검증
- [x] 대표/총괄 수기 결제 등록·취소/환불 완료 등록 사유·사유 기반 수정·삭제 서버 API와 iPhone 16e 네이티브 흐름 검증
- [x] 대표/총괄 결제 할인/환불/취소 처리와 사유 변경 기록 검증
- [x] 대표/총괄 결제 상태 이력, 확인할 결제, CSV lifecycle 컬럼 검증
- [x] 대표/총괄 온라인 결제 요청, provider webhook 성공/실패/환불 상태 반영, 전역 event ID 멱등·교차 결제 순차/동시 재사용 차단, 영수증 메타, 코치 금액/결제 링크 비노출 검증
- [x] 요청 생성/승인/반려 API 라우트 삭제, `404`, 데이터 무변경 검증
- [x] 상담/주의 메모 작성과 공개 범위 서버/UI 검증
- [x] 공지 작성/중요 공지/지점 전체/반/개인 대상 지정/읽음 처리/보이는 공지 읽음 처리/확인할 공지/미읽음·중요 필터 검증
- [x] AppShell 상단 공지 버튼 미읽음 배지와 접근성 이름 검증. 모바일 하단 요청 메뉴는 제거되어 공지 배지를 붙일 대상이 없음
- [x] 결제 상태 등록/미납/만료 예정 표시 검증
- [x] 코치 DTO에서 결제 금액 미노출 검증
- [x] 변경 기록에 출석/공지/파일럿 운영 기록 검증
- [x] 변경 기록에 회원/수업/결제/권한/지점 변경 기록 검증
- [x] 총괄 변경 기록 검색/필터와 조회 변경 기록 검증
- [x] 총괄 파일럿 준비 상태/증빙 저장과 `pilot_readiness.update` 변경 기록 검증
- [x] 총괄 파일럿 이슈 생성/상태 변경과 `pilot_incident.create/update` 변경 기록 검증
- [x] 총괄 파일럿 일일 운영 로그 저장, 모바일 출석 30초 계측 증빙, `pilot_operation.update` 변경 기록 검증

## 5. DB/API 전환

- [x] `db/migrations/*.sql` 정렬 순서 전체 실제 PostgreSQL 적용 테스트
- [x] `db/seeds/seed_mvp.sql` 적용 테스트
- [x] `docs/API_CONTRACT.md` 기준 핵심 엔드포인트 route handler 구현
- [x] mock `apiClient`를 HTTP API client로 교체
- [x] JSON 저장소 원자적 쓰기, 최신 스냅샷 백업, 깨진 primary 복구, stale demo seed 날짜 보정 검증
- [x] `npm run test:routes`로 보호 앱 경로와 호환 라우트 검증
- [x] API 오류, 401, 403, 409, 422 UI 처리 검증
- [x] 결제/운영 리포트 CSV 내보내기와 변경 기록 검증
- [x] 회원/학부모 결제 상태 화면에는 CSV 내보내기 버튼이 없고 `test:smoke`의 회원/학부모 CSV export API 403 런타임 요청에서 `/api/v1/exports/payments`, `/api/v1/exports/operations`가 대표/총괄 외 403으로 제한되는지 검증
- [x] 대표 운영 리포트 기간별 운영 추세, 오늘 우선순위, 회원 신규·이탈·순증과 CSV 추세 행 검증
- [x] `app_runtime_state` PostgreSQL 런타임 저장소 migration 검증
- [x] `npm run test:postgres-store` PostgreSQL 런타임 저장소 연결/쓰기/읽기, 서로 다른 store 인스턴스의 동일 키 advisory lock, 한 transaction의 전역→세부 중첩 lock과 경쟁 직렬화, 커밋/롤백, stale snapshot merge, 임시 Next 서버의 비밀번호 reset token 동시 완료 `200/400`·새 비밀번호 로그인, 동시 결제 route 1건 저장과 결제·출석 교차 도메인 동시 변경 보존, 파일럿 import/준비 증빙 apply/비밀번호 교체 CSV/변경 기록/prelaunch draft/launch package/증빙 리포트/status 요약 검증
- [x] 파일럿 준비 항목이 JSON/PostgreSQL runtime store와 파일럿 import DB shape에 포함되는지 검증
- [x] 파일럿 이슈 로그가 JSON/PostgreSQL runtime store와 파일럿 import DB shape에 포함되는지 검증
- [x] 파일럿 운영 로그가 JSON/PostgreSQL runtime store와 파일럿 import DB shape에 포함되는지 검증

## 6. 파일럿 운영 준비

- [ ] 파일럿 지점 1-2곳 확정
- [ ] 대표/코치/학부모/회원 테스트 계정 준비
- [ ] 실제 수업 시간표와 회원권 상태 샘플 데이터 준비
- [ ] 실제 파일럿 CSV dry-run 확인 후 `npm run pilot:import -- <csv>` 반영
- [ ] PostgreSQL 파일럿 운영 시 `npm run pilot:import:postgres -- <csv>` 반영 후 `npm run pilot:evidence -- --driver=postgres --state-key=<key> --postgres-url=<url> --out=.data/pilot-evidence.json` 생성
- [ ] `/app/admin/settings`에서 파일럿 준비 항목별 담당자, 상태, 증빙 기록
- [ ] `npm run pilot:prelaunch-draft -- --out-dir=.data`로 준비 증빙 CSV, 계정별 비밀번호 교체 CSV, audit launch package, pre-pilot evidence/preflight/status, 요약 JSON 초안을 한 번에 생성. 이 명령은 blocked 초안을 남기는 용도이며, ready 판정 전에는 아래 strict 검증을 별도로 통과해야 한다. PostgreSQL 운영 DB에서는 `--driver=postgres --state-key=<key> --postgres-url=<url>`을 함께 사용한다.
- [ ] `npm run pilot:readiness-evidence:draft -- --phase=pre-pilot --out=.data/pilot-readiness-evidence.csv`로 준비 증빙 CSV 초안을 만들고 owner/status/evidence를 채운 뒤 `npm run pilot:readiness-evidence -- --file=.data/pilot-readiness-evidence.csv --phase=pre-pilot` 통과. PostgreSQL 운영 DB에서는 draft/apply 모두 `--driver=postgres --state-key=<key> --postgres-url=<url>`로 같은 runtime state를 참조한다. 검증된 내용은 `npm run pilot:readiness-evidence:apply -- --file=.data/pilot-readiness-evidence.csv --phase=pre-pilot --actor-user-id=user-admin` 또는 `/app/admin/settings`로 반영하고 `pilot_readiness.update` 변경 기록을 남긴다.
- [ ] 기본 임시 비밀번호를 계정별 값으로 교체하고 `npm run pilot:password-rotation:draft -- --runtime=.data/final-judo-db.json --out=.data/pilot-password-rotation.csv`, `npm run pilot:password-rotation -- --runtime=.data/final-judo-db.json --file=.data/pilot-password-rotation.csv`로 전달 채널 증빙과 변경 기록을 검증. PostgreSQL 운영 DB에서는 두 명령 모두 `--driver=postgres --state-key=<key> --postgres-url=<url>`로 같은 runtime state를 참조한다.
- [ ] `npm run pilot:launch-package -- --csv=docs/pilot-templates/pilot-data-intake.csv --readiness-evidence=.data/pilot-readiness-evidence.csv --password-rotation=.data/pilot-password-rotation.csv --out=.data/pilot-launch-package.json` strict 실행으로 CSV 검증, import dry-run, 파일럿 준비 증빙, 계정별 비밀번호 교체 증빙, pre-pilot evidence JSON/Markdown, production preflight JSON, launch package JSON 생성 및 통과. PostgreSQL 운영 DB에서는 `--driver=postgres --state-key=<key> --postgres-url=<url>`을 함께 사용하고, 보관되는 패키지에 DB URL 비밀번호가 `REDACTED`로만 기록되는지 확인. 준비 중 리허설은 `--allow-incomplete` 사용
- [ ] 준비 중 차단 상태를 기록해야 할 때는 `npm run pilot:launch-package -- --allow-incomplete --out=.data/pilot-launch-package.json`로 blocked launch package를 보관
- [ ] 실제 데이터 반영 후 `NODE_ENV=production npm run preflight:pilot -- --out=.data/pilot-preflight.pre-pilot.json` 통과 및 결과 파일 보관
- [ ] 운영 배포 전 승인된 운영 데이터 복제본을 별도 격리 경로에 준비하고 `npm run preflight:runtime-snapshot -- --file=<snapshot> --out=.data/runtime-snapshot-preflight.json` 통과. 원본 운영 DB에 직접 실행하지 않으며, 정정이 필요하면 먼저 `npm run runtime:integrity:reconcile -- --file=<snapshot> --actor-user-id=<admin-user-id>` dry-run 결과와 백업·롤백 계획을 검토한 뒤 별도 승인된 반영 절차를 사용한다. 감사 actor는 복제본에 존재하는 승인 완료 총괄 어드민이어야 한다.
- [ ] 현장 코치 모바일 기기 테스트
- [ ] 개인정보/결제 데이터 마스킹 정책 확인
- [ ] 운영 중 장애 보고 채널 확정 및 `/app/admin/settings` 파일럿 이슈 로그 운영 담당자 지정
- [ ] 파일럿 2주 동안 `/app/admin/settings` 일일 운영 로그 14개 운영일 기록. 출석 기록이 있는 `verified` 로그는 모바일 출석 처리 시간(30초 이하)과 현장 녹화/캡처 증빙 포함
- [ ] `npm run pilot:evidence -- --out=.data/pilot-evidence.json` pre-pilot JSON 생성
- [ ] `npm run pilot:evidence -- --require-retro --out=.data/pilot-evidence.post-pilot.json` post-pilot JSON 생성
- [ ] `npm run pilot:evidence -- --require-retro --format=markdown --out=.data/pilot-evidence.md` 회고 자료 생성
- [ ] 파일럿 종료 후 `NODE_ENV=production npm run preflight:pilot -- --require-retro --out=.data/pilot-preflight.post-pilot.json` 통과. 14개 운영일, 출석 수치, 모바일 출석 30초 계측 증빙, 결제 확인 수치 포함
- [ ] `npm run pilot:field-evidence:draft -- --source-csv=docs/pilot-templates/pilot-data-intake.csv --pre-pilot-evidence=.data/pilot-evidence.json --post-pilot-evidence=.data/pilot-evidence.post-pilot.json --post-pilot-markdown=.data/pilot-evidence.md --out=.data/pilot-field-evidence.json`로 source CSV 지점/계정과 post-pilot 운영 수치가 반영된 현장 증빙 manifest 초안 생성
- [ ] `docs/pilot-templates/pilot-field-evidence.template.json`을 `.data/pilot-field-evidence.json`으로 채우고 `dataImport.sourceCsv`, `dataImport.evidenceReport`, `operations.postPilotEvidenceJson`/`operations.postPilotEvidenceMarkdown`과 출석/결제/공지 후속/공지 운영 증빙 포함 후 `npm run pilot:field-evidence -- --file=.data/pilot-field-evidence.json --report=.data/pilot-evidence.post-pilot.json` 통과. source CSV는 실제 파일로 존재하고 pilot CSV 검증을 통과해야 하며 dry-run/import 명령이 같은 CSV를 참조해야 한다. manifest의 지점 목록과 계정 email/role/branchScope는 source CSV와 일치해야 한다. 스크린리더 증빙은 출석 상태와 공지 읽음 상태 각각의 route, target, 기대 낭독, 실제 낭독, 이슈 없음, 메모, 증빙 링크를 포함해야 한다. pre-pilot JSON은 파일럿 시작 전 생성된 ready 리포트이고 source CSV의 지점/계정/회원/수업/결제/공지 예상 수와 맞아야 하며, JSON/Markdown 회고 파일은 존재하고 post-pilot/ready/고유 운영일/검증 운영일/운영 수치가 manifest와 맞아야 하며, 생성 시각이 파일럿 종료일 이후이고 총괄 PM signoff가 리포트 생성 이후여야 한다.
- [ ] `npm run pilot:closeout-package -- --field=.data/pilot-field-evidence.json --preflight=.data/pilot-preflight.post-pilot.json --report=.data/pilot-evidence.post-pilot.json --markdown=.data/pilot-evidence.md --out=.data/pilot-closeout-package.json` 통과 및 결과 파일 보관
- [ ] `npm run pilot:artifact-manifest -- --preflight-pre=.data/pilot-preflight.pre-pilot.json --evidence-pre=.data/pilot-evidence.json --evidence-pre-markdown=.data/pilot-evidence.pre-pilot.md --readiness-evidence=.data/pilot-readiness-evidence.csv --launch-package=.data/pilot-launch-package.json --password-rotation=.data/pilot-password-rotation.csv --preflight-post=.data/pilot-preflight.post-pilot.json --evidence-post=.data/pilot-evidence.post-pilot.json --evidence-markdown=.data/pilot-evidence.md --field=.data/pilot-field-evidence.json --closeout=.data/pilot-closeout-package.json --out=.data/pilot-artifact-manifest.json` 통과 및 산출물 해시 manifest 보관
- [ ] `npm run pilot:archive-artifacts -- --manifest=.data/pilot-artifact-manifest.json --archive-dir=.data/pilot-archives/final-judo-pilot-20260715` 통과 및 fresh archive 폴더/`pilot-archive-manifest.json` 장기 보관
- [ ] `npm run pilot:storage-receipt:draft -- --archive=.data/pilot-archives/final-judo-pilot-20260715/pilot-archive-manifest.json --out=.data/pilot-storage-receipt.json`로 장기 보관 receipt 초안을 생성하고 archive manifest SHA-256/byte size와 산출물별 archivedPath/sha256/sizeBytes 자동 반영 확인
- [ ] `docs/pilot-templates/pilot-storage-receipt.template.json`을 `.data/pilot-storage-receipt.json`으로 채우고 `npm run pilot:storage-receipt -- --file=.data/pilot-storage-receipt.json --archive=.data/pilot-archives/final-judo-pilot-20260715/pilot-archive-manifest.json` 통과. 장기 보관소 URI, 업로드 담당자/provider/evidence, 최소 365일 보존 정책, 산출물별 업로드 위치/해시/byte size가 archive manifest와 일치해야 한다.
- [ ] `npm run pilot:final-handoff -- --artifact-manifest=.data/pilot-artifact-manifest.json --archive-manifest=.data/pilot-archives/final-judo-pilot-20260715/pilot-archive-manifest.json --storage-receipt=.data/pilot-storage-receipt.json --out=.data/pilot-final-handoff.json` 통과 및 최종 인수인계 JSON 보관
- [ ] `npm run pilot:status -- --strict --out=.data/pilot-status.json` 실행으로 준비 증빙 CSV, 비밀번호 교체 CSV와 최종 handoff까지 모든 산출물이 ready 상태이고 현재 archive 해시와 저장된 handoff JSON이 일치하는지 확인 및 상태 리포트 보관. PostgreSQL 운영 DB에서는 `--driver=postgres --state-key=<key> --postgres-url=<url>`을 함께 사용한다. 차단 리포트에서는 missing/waiting/blocked non-ready 항목이 모두 `blockers`에 남아야 한다.
- [ ] production 운영 중 `FINAL_JUDO_ENABLE_DEMO_LOGIN` 미설정 또는 파일럿 작업창 후 제거 확인
- [ ] production 운영 중 `FINAL_JUDO_ENABLE_DEV_RESET` 미설정 확인
- [ ] `.env.production.example`과 `docs/ENVIRONMENT_MATRIX.md` 기준으로 배포 플랫폼 secret store의 PostgreSQL, 결제, VAPID 변수가 실제 운영값으로 채워졌는지 확인
- [x] `npm run test:production-runtime-environment`로 Vercel production 빌드와 서버 런타임이 PostgreSQL 설정 누락·JSON driver·placeholder URL·unsafe table을 차단하고 연결 문자열을 출력하지 않는지 검증
- [x] `npm run test:postgres-runtime-identity`로 운영 상태 행·설치 식별자가 없거나 불일치할 때 DDL·시드 삽입 없이 실패하고 로컬/테스트 자동 생성만 유지되며, 중첩 도메인 잠금이 한 PostgreSQL transaction에서 advisory key를 모두 획득하는지 검증
- [x] `npm run test:live-production-runtime`로 운영 DB 읽기 전용 preflight의 식별자·revision·최소 데이터·관리자 자격증명·비밀정보 비노출 검증
- [x] `npm run test:production-recovery-manifest`로 배포·소스·빌드·Neon·런타임·스모크 allowlist와 0600 원자적 산출물 검증
- [x] `npm run test:admin-credential-recovery`로 명시적 승인·revision·설치 식별자·advisory lock 기반 관리자 자격증명 복구와 세션 폐기·감사 기록 검증
- [ ] 기존 운영 `app_runtime_state`의 `mvp` 행에 안정적인 `FINAL_JUDO_INSTALLATION_ID`를 결속하고 Vercel production에 같은 값을 설정한 뒤 `npm run production:runtime:preflight` 통과
- [ ] 배포 직전 암호화 PostgreSQL dump를 외부 보관 위치에 생성하고 복호화 스트림의 `pg_restore --list`·SHA-256·필수 테이블을 확인. 평문 dump와 비밀정보는 `.data`·문서·로그에 남기지 않음
- [ ] production smoke 통과 후 `npm run production:recovery:manifest`로 배포 ID·source SHA·build ID·Neon project/branch·runtime revision/fingerprint를 기록하고 롤백 대상 배포와 DB branch를 함께 확인
- [ ] 운영 secret 설정, production preflight, release gate 통과 후 `npm run deployment:handoff:draft -- --out=.data/deployment-handoff.json --preflight-report=.data/pilot-preflight.pre-pilot.json`로 secret 원문 없는 초안을 만들고 HTTPS/provider URI 증빙 필드, ISO 생성/승인 시각, 생성 이후 승인 순서를 채운 뒤 `npm run deployment:handoff -- --file=.data/deployment-handoff.json --out=.data/deployment-handoff.report.json` 통과 및 증빙 보관
- [x] 파일럿 데이터 intake 템플릿에 5개 역할과 2개 지점 샘플 계정 준비
- [x] 파일럿 종료 후 피드백 수집 양식 준비

준비 문서:

- `docs/MVP_COMPLETION_AUDIT.md`
- `docs/PILOT_OPERATIONS_RUNBOOK.md`
- `docs/pilot-templates/pilot-data-intake.csv`
- `docs/pilot-templates/pilot-feedback-form.md`
- `scripts/import-pilot-data.mjs`

운영 화면:

- `/app/admin/settings` 파일럿 준비 게이트, 증빙 트래커, 파일럿 이슈 로그, 14일 운영 로그

파일럿 직전 최종 명령:

```bash
npm run dev
npm run test:pilot-launch-package
npm run test:pilot-launch-command
npm run test:release
```

`test:release`는 smoke/E2E 구간에서 빈 로컬 포트와 임시 JSON 저장소를 할당해 직전에 지문을 확인한 production build를 `next start`로 직접 실행하고 종료 후 데이터를 정리한다. 데모 로그인·reset 허용 플래그는 이 격리 자식 프로세스에만 적용한다. `SMOKE_BASE_URL`을 지정한 경우에도 서버가 없는 로컬 HTTP origin만 허용하며, 이미 응답하는 소유 불명 서버·원격 origin·실행 중인 개발 서버는 재사용하거나 종료하지 않는다. Docker Desktop은 DB smoke를 위해 별도로 실행 중이어야 한다.

## 7. 현재 남은 주요 리스크

- MVP 앱 런타임은 Next.js Route Handler와 JSON 파일 저장소를 기본값으로 사용한다. `FINAL_JUDO_DB_DRIVER=postgres` 설정 시 PostgreSQL `app_runtime_state` JSONB 저장소를 사용할 수 있다.
- JSON 파일 저장소는 파일럿 검증용이며 원자적 쓰기/최신 백업/primary 복구 확인 기준을 갖췄다. 다중 인스턴스 운영은 PostgreSQL runtime store 사용을 권장한다.
- SQL 마이그레이션/seed와 PostgreSQL runtime store는 Docker PostgreSQL 16에서 `npm run test:db`, `npm run test:postgres-store`로 검증했다. 서로 다른 runtime store 인스턴스의 동일 결제 요청 advisory lock, stale snapshot 3-way merge, 결제·출석 교차 도메인 동시 변경 보존, PostgreSQL 파일럿 import, 준비 증빙 apply, 계정별 비밀번호 교체 CSV 검증, 변경 기록, prelaunch draft, launch package 생성과 DB URL 비밀번호 redaction, 증빙 리포트 생성, status 요약도 `test:postgres-store`에 포함된다.
- API smoke, 저장소 복구, 도메인 규칙 단위 테스트, 출석 30초 게이트, 모바일 전체 출석/개별 출석 브라우저 E2E와 오프라인 대기 큐 복구/재동기화 자동화를 추가했다.
- 개발/테스트 전용 reset API는 production에서 기본 차단되며 `FINAL_JUDO_ENABLE_DEV_RESET=1` 명시 플래그가 있을 때만 열리도록 자동 검증한다.
- 데모 역할 로그인은 production에서 기본 차단되며 `FINAL_JUDO_ENABLE_DEMO_LOGIN=1` 명시 플래그, 기본 8시간/로그인 상태 유지 30일 secure/httpOnly session cookie 정책, production `x-user-id` 헤더 인증 우회 차단을 자동 검증한다.
- 환경 변수 매트릭스는 `docs/ENVIRONMENT_MATRIX.md`, `.env.example`, `.env.production.example`에 고정되어 있고 `npm run test:env-readiness`가 위험 플래그 기본값, PostgreSQL/결제/푸시 placeholder, release/admin/docs gate 포함 여부를 검증한다. 실제 운영 secret 값은 배포 플랫폼 secret store에서만 관리하며, `npm run test:deployment-handoff-draft`, `npm run test:deployment-handoff`, `npm run deployment:handoff:draft -- --out=.data/deployment-handoff.json --preflight-report=.data/pilot-preflight.pre-pilot.json`, `npm run deployment:handoff -- --file=.data/deployment-handoff.json --out=.data/deployment-handoff.report.json`가 secret 이름/보관 위치/증빙만 기록하고 원문 secret 값을 차단한다. `localhost`, `.example`, `.test`, `.local`, TODO/placeholder origin과 mailto subject는 최종 운영 handoff에서 ready로 인정하지 않는다.
- 운영 계정 로그인은 휴대폰 번호/임시 비밀번호를 기본 경로로 사용하고, 로그인 상태 유지 선택 시 30일 자동로그인 쿠키가 설정되며 bootstrap/snapshot 응답에서 `passwordHash` 마스킹을 자동 검증한다. 초대 가입은 사용자가 12자 이상 초기 비밀번호를 설정해야 완료되며 기본 임시 비밀번호와 사용된 초대 링크 재사용은 차단된다. 총괄 어드민은 `/app/admin/users`에서 사용자별 임시 비밀번호를 재발급할 수 있으며 원문 비밀번호는 저장소/변경 기록에 남기지 않는다.
- 주요 자동 smoke/E2E는 기본 운영 계정 로그인 경로를 사용하며, 데모 역할 로그인은 별도 production guard에서만 정책 검증한다.
- Next 16.2.9가 번들한 `postcss`는 `overrides`로 8.5.10을 고정해 `npm audit --audit-level=moderate` 0건을 확인했다.
- 파일럿 CSV 템플릿은 2개 지점 샘플로 `npm run test:pilot`, `npm run test:pilot-import`, `npm run test:postgres-store`의 PostgreSQL import/증빙 리포트 검증을 통과한다. 실제 파일럿 CSV 반영과 마스킹 최종 확인은 운영 담당자 확인이 필요하다.
- 파일럿 전 기본 임시 비밀번호 `FinalJudoPilot!2026`은 `/app/admin/users`에서 계정별 값으로 교체하고 `/app/admin/settings`의 보안 체크에 증빙을 남겨야 한다.
- 운영 직전 `preflight:pilot`은 production 데모 로그인/reset API, production 온라인 결제 provider/checkout/webhook secret, 기본 임시 비밀번호 잔존, 파일럿 준비 증빙, 미해결 P0 파일럿 이슈, 사용자 지점/자녀/본인 회원 범위와 수업/출석/결제/공지/상담 메모/파일럿 운영 로그 참조 무결성, 파일럿 운영 로그 날짜/차단 사유, 주민등록번호/상세 의료정보/생체정보 패턴을 함께 검사한다. 현장 증빙이 아직 비어 있는 데모 상태에서는 `--allow-incomplete`로 감사 리포트만 확인한다. 파일럿 종료 후에는 `--require-retro`로 14개 운영일과 출석/결제 확인 수치를 추가 확인한다.
- 파일럿 종료 산출물은 `pilot:artifact-manifest` 생성 후 `pilot:archive-artifacts`로 원본 파일 해시를 다시 검증하고 fresh archive 폴더에 복사한 뒤 복사본 해시까지 재검증해야 한다. `TODO`, `YYYYMMDD` 같은 placeholder archive 경로는 차단된다. 실제 클라우드/배포 플랫폼 업로드는 이 archive 폴더와 `pilot-archive-manifest.json`을 기준으로 수행하고, `pilot:storage-receipt:draft`로 해시/byte size가 채워진 receipt 초안을 만든 뒤 `pilot:storage-receipt`로 업로드 위치/해시/byte size/보존 정책 receipt까지 검증해야 한다. 최종 제출 전 `pilot:final-handoff`와 `pilot:status -- --strict --out=.data/pilot-status.json`로 준비 증빙 CSV, 비밀번호 교체 CSV, artifact manifest, archive manifest, storage receipt, final handoff가 같은 산출물 세트를 가리키는지 한 번 더 확인하고 상태 리포트를 보관한다.
- Lighthouse 자동 접근성 검사와 정적 접근성 확인 기준은 통과했다. 실제 스크린리더 실행은 현장 단계에 남아 있으며, 출석 상태/공지 읽음 상태의 기대·실제 낭독과 이슈 없음 기록은 `npm run test:pilot-field-evidence`가 누락 시 차단한다.
- 파일럿 지점, 실제 계정, 현장 기기, 장애 보고 채널은 운영 담당자 확인이 필요하다.
- 온라인 결제는 P1에서 provider-neutral 요청, webhook 상태 반영, provider event ID 중복 처리, 영수증 메타, CSV provider 컬럼, 코치 금액/결제 링크 마스킹까지 준비했다. 정기결제도 provider-neutral 약정 생성/해지, 다음 청구일, CSV 컬럼, 변경 기록, 코치 provider 약정 ID 마스킹까지 준비했다. 실제 PG/VAN 승인, 자동청구 billing key/mandate 보관 정책, 운영 provider event ID 필드/서명 매핑, 실 영수증 URL 검증은 운영 provider 확정 후 진행한다. 알림톡은 아직 제외 범위이며, P1 서버 푸시는 VAPID 키 상태, PushSubscription 저장/해지, 공지별 dispatch API와 만료 구독 비활성화까지 준비했으므로 실제 기기 수신 검증은 운영 VAPID 키와 HTTPS 도메인 설정 후 진행한다.
- 회원/학부모 앱 릴리즈 기준: 회원 `/app/dashboard`는 보조 제목 없이 핵심 상태를 단일 패널로 유지하고, 학부모 `/app/dashboard`는 자녀 학습 리포트를 우선 보여주되 긴 공지/피드백 본문은 모바일 카드 안에서 축약한다. 다음 행동 큐/오늘 확인 브리프/주간 확인 리듬/복귀 안내 레일/수업 전 준비 보드/확인 리마인드 큐 같은 내부 운영 안내는 회원/학부모 화면에 노출하지 않는다.
