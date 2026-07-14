# 파이널 유도 멀티짐 환경 변수 매트릭스

작성일: 2026-06-15

이 문서는 개발, 파일럿, 운영 배포에서 사용하는 환경 변수를 한곳에 고정한다. 실제 비밀값은 `.env.example`이나 문서에 넣지 않고 배포 플랫폼 secret store, 로컬 `.env.local`, CI secret으로만 관리한다.

## 파일

| 파일 | 용도 | 커밋 여부 |
| --- | --- | --- |
| `.env.example` | 로컬 개발/테스트 기본값과 mock provider 리허설 | 커밋 |
| `.env.production.example` | 파일럿/운영 배포 전 secret checklist | 커밋 |
| `.env.local` | 개인 로컬 secret | 커밋 금지 |
| 배포 플랫폼 secret store | 운영 secret | 커밋 금지 |

## Runtime Storage

| 변수 | 개발 | 파일럿/운영 | 설명 |
| --- | --- | --- | --- |
| `FINAL_JUDO_DB_DRIVER` | `json` | `postgres` | `postgres`이면 `app_runtime_state` JSONB 저장소를 사용한다. |
| `FINAL_JUDO_DATA_DIR` | `.data` | 비움 권장 | JSON 런타임 디렉터리. `PILOT_DB_FILE`이 있으면 파일 경로가 우선한다. |
| `PILOT_DB_FILE` | `.data/final-judo-db.json` | 비움 권장 | JSON 런타임 파일 경로. 운영 preflight에서는 JSON driver가 blocker가 된다. |
| `FINAL_JUDO_POSTGRES_URL` | 선택 | 필수 | PostgreSQL 연결 문자열. 문서/패키지에는 실제 비밀번호를 남기지 않는다. |
| `DATABASE_URL` | 선택 | 선택 | `FINAL_JUDO_POSTGRES_URL` fallback. 둘 중 하나는 운영에 필요하다. |
| `FINAL_JUDO_POSTGRES_STATE_KEY` | `mvp` | 운영별 key | 같은 DB에서 여러 runtime row를 분리한다. |
| `FINAL_JUDO_POSTGRES_TABLE` | `app_runtime_state` | `app_runtime_state` | runtime JSONB 테이블명. |

## Production Safety Flags

| 변수 | 운영 기본값 | 설명 |
| --- | --- | --- |
| `FINAL_JUDO_ENABLE_DEMO_LOGIN` | `0` 또는 미설정 | production 역할 선택 데모 로그인을 여는 위험 플래그다. 파일럿 리허설 작업창 외에는 사용하지 않는다. |
| `FINAL_JUDO_ENABLE_DEV_RESET` | `0` 또는 미설정 | production `/api/v1/dev/reset` 허용 조건 중 하나다. helper 발급 실행별 토큰, run-owned 임시 JSON 마커, 실제 `PILOT_DB_FILE` 대상이 모두 일치해야 하며 공유·심볼릭 링크·PostgreSQL·운영 사용자 데이터에는 사용하지 않는다. |
| `FINAL_JUDO_SMOKE_OWNERSHIP_TOKEN` | 미설정 | 격리 테스트 서버·reset 호출자·임시 JSON 저장소 마커를 묶는 256비트 소유권 토큰이다. 테스트 러너가 임의 생성하며 저장·공유하지 않는다. 임의 문자열이나 약한 고정값은 거부한다. |
| `ENABLE_DEMO_LOGIN` | 미설정 | legacy 호환 플래그. 새 배포에서는 사용하지 않는다. |
| `ENABLE_DEV_RESET` | 미설정 | legacy 호환 플래그. 새 배포에서는 사용하지 않는다. |

## Payments

| 변수 | 개발 | 파일럿/운영 | 설명 |
| --- | --- | --- | --- |
| `FINAL_JUDO_PAYMENT_PROVIDER` | 비움 | `external` | 비어 있으면 mock provider로 동작한다. |
| `FINAL_JUDO_PAYMENT_CHECKOUT_BASE_URL` | 비움 | provider checkout origin | 외부 provider 결제 요청 URL base. |
| `FINAL_JUDO_PAYMENT_WEBHOOK_SECRET` | 비움 가능 | 필수 | production webhook 인증 secret. 비어 있으면 webhook route는 `503`으로 차단한다. |

Provider event ID는 body의 `providerEventId` 또는 `x-final-judo-payment-event-id` header에서 받는다. 같은 event ID 재전송은 상태 이력과 감사 로그를 중복 생성하지 않는다. 실제 provider 연결 전에는 provider의 event ID 필드, 서명 header, 영수증 URL 필드를 최종 매핑해야 한다.

## Push Notifications

| 변수 | 개발 | 파일럿/운영 | 설명 |
| --- | --- | --- | --- |
| `FINAL_JUDO_VAPID_PUBLIC_KEY` | 비움 가능 | 필수 | 브라우저 PushSubscription용 public key. |
| `FINAL_JUDO_VAPID_PRIVATE_KEY` | 비움 가능 | 필수 | 서버 푸시 발송용 private key. |
| `FINAL_JUDO_VAPID_SUBJECT` | `mailto:ops@finaljudo.test` | 운영 연락처 | VAPID subject. |
| `CRON_SECRET` | 비움 가능 | 필수 | 푸시 outbox 재시도 endpoint를 보호하는 무작위 Bearer secret. 원문은 배포 플랫폼 secret store에만 둔다. |

VAPID 키가 없으면 UI와 API는 `configured: false`를 보여주고 실제 push 발송 대신 구성 필요 상태를 기록한다. `vercel.json`의 일일 cron은 모든 Vercel 플랜에서 배포 가능한 안전한 기본값이며, 더 짧은 재시도 주기는 배포 시점의 플랜 제한을 확인한 뒤 조정한다.

## Test And Pilot Commands

| 변수 | 용도 |
| --- | --- |
| `SMOKE_BASE_URL` | smoke/route 테스트 대상 URL |
| `SMOKE_SKIP_DEV_RESET` | smoke 실행 전후 dev reset 생략 |
| `E2E_CHROME_EXECUTABLE` | 로컬 Chrome 경로 override |
| `E2E_SKIP_DEV_RESET` | 모바일 E2E dev reset 생략 |
| `ATTENDANCE_SPEED_LIMIT_MS` | 출석 속도 게이트 기준 |
| `ATTENDANCE_SPEED_SESSION_ID` | 출석 속도 테스트 대상 수업 |
| `ATTENDANCE_SPEED_BRANCH_ID` | 출석 속도 테스트 지점 |
| `ATTENDANCE_SPEED_SKIP_DEV_RESET` | 출석 속도 테스트 dev reset 생략 |
| `PILOT_DATA_FILE` | 파일럿 CSV 경로 override |
| `POSTGRES_IMAGE`, `POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_PASSWORD` | PostgreSQL smoke 컨테이너 설정 |

## 검증

```bash
npm run test:env-readiness
npm run test:deployment-handoff-draft
npm run test:deployment-handoff
npm run test:auth-production-guard
npm run test:dev-reset-guard
NODE_ENV=production npm run preflight:pilot -- --out=.data/pilot-preflight.pre-pilot.json
```

`npm run test:env-readiness`는 env 예시 파일, production 위험 플래그 기본값, 운영 필수 변수 placeholder, 문서/README/QA/릴리즈 체크리스트/release gate 포함 여부를 정적으로 검증한다.
`npm run test:deployment-handoff-draft`는 운영 env와 production preflight 리포트에서 `.data/deployment-handoff.json` 초안을 만들되 PostgreSQL URL, webhook secret, VAPID private key 원문을 JSON에 남기지 않는지 검증한다.
`npm run test:deployment-handoff`는 `docs/deployment-handoff.template.json` 기준으로 운영 배포 manifest가 production origin, 배포 플랫폼 secret store, PostgreSQL runtime store, 결제 provider, VAPID push, production preflight, release gate, signoff 증빙을 갖추는지 검증한다. 실제 운영 배포 직전에는 `.data/deployment-handoff.json`에 secret 값이 아니라 secret 이름, 보관 위치, 증빙만 기록하고 `npm run deployment:handoff -- --file=.data/deployment-handoff.json --out=.data/deployment-handoff.report.json`로 ready/blocked 리포트를 보관한다.
