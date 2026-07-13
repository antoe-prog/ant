# 파이널 유도 멀티짐 MVP API 계약

작성일: 2026-06-13
기준 문서: `docs/FINAL_MVP_PRODUCT_SPEC.md`, `docs/BACKEND_DB_SCHEMA.md`
상태: MVP v1 실제 API 전환 기준

## 1. 공통 규칙

- Base URL은 `/api/v1`이다.
- 모든 보호 API는 세션 또는 Bearer 토큰 인증을 요구한다.
- 서버는 클라이언트가 보낸 `branchId`, `memberId`, `role` 값을 신뢰하지 않고 DB 관계에서 최종 스코프를 다시 계산한다.
- 응답 날짜는 ISO 8601 UTC 문자열을 사용한다.
- 금액은 원화 정수 `amountKrw`로 내려준다.
- 목록 API는 기본 `limit=50`, 최대 `limit=100`을 사용한다.
- 민감 조회, 쓰기, 승인, CSV 내보내기는 `audit_logs`에 남긴다.
- 코치 응답 DTO에는 결제 금액을 절대 포함하지 않는다.

## 2. 공통 응답 형식

### 성공

```json
{
  "data": {},
  "meta": {
    "requestId": "req_01HX...",
    "generatedAt": "2026-06-13T11:00:00.000Z"
  }
}
```

### 목록

```json
{
  "data": [],
  "page": {
    "limit": 50,
    "cursor": null,
    "nextCursor": null
  },
  "meta": {
    "requestId": "req_01HX...",
    "generatedAt": "2026-06-13T11:00:00.000Z"
  }
}
```

### 오류

```json
{
  "error": {
    "code": "FORBIDDEN",
    "message": "접근 권한이 없습니다.",
    "details": {
      "resource": "payments",
      "requiredPermission": "payments.read"
    }
  },
  "meta": {
    "requestId": "req_01HX..."
  }
}
```

| HTTP | code | 의미 |
| --- | --- | --- |
| 400 | `VALIDATION_ERROR` | 입력값 오류 |
| 401 | `UNAUTHENTICATED` | 로그인 필요 |
| 403 | `FORBIDDEN` | 역할, 지점, 관계 권한 실패 |
| 404 | `NOT_FOUND` | 리소스 없음 또는 스코프 밖 리소스 |
| 409 | `CONFLICT` | 출석/권한 변경 또는 계정 유일성 충돌 |
| 422 | `BUSINESS_RULE_FAILED` | 정원 초과, self-lockout 등 정책 실패 |
| 500 | `INTERNAL_ERROR` | 서버 오류 |

## 3. 인증/내 계정

| Method | Path | 권한 | 감사 | 설명 |
| --- | --- | --- | --- | --- |
| `POST` | `/auth/login` | 공개 | 예 | 운영 계정 로그인 또는 개발/테스트 역할 로그인 |
| `POST` | `/auth/register` | 공개 | 예 | 휴대폰 성인 회원가입 |
| `POST` | `/auth/logout` | 인증 | 예 | 로그아웃 |
| `POST` | `/auth/password-reset` | 공개 | 예 | 비밀번호 재설정 요청 |
| `POST` | `/auth/invitations/:token/accept` | 공개 | 예 | 초대 가입 수락 |
| `POST` | `/admin/users/:userId/password` | admin | 예 | 임시 비밀번호 발급 |
| `GET` | `/me` | 인증 | 아니오 | 내 계정, 역할, 접근 지점 |
| `GET` | `/me/dashboard` | 인증 | 아니오 | 역할별 홈 요약 |
| `GET` | `/me/notices` | 인증 | 아니오 | 내게 보이는 공지 |
| `POST` | `/me/notices/:noticeId/read` | 인증 + self/relation | 예 | 공지 읽음 처리 |
| `POST` | `/me/notices/bulk-read` | 인증 + self/relation | 예 | 여러 공지 읽음 처리 |

`POST /auth/login`은 `{ "phone": "...", "password": "...", "keepSignedIn": true }` 운영 계정 로그인을 기본 경로로 사용한다. `keepSignedIn`을 보내지 않으면 세션 쿠키는 8시간 유지되고, `true`이면 30일 유지된다. 데모 seed와 파일럿 CSV import 사용자는 서버 저장소에서 PBKDF2 `passwordHash`를 갖지만, 모든 bootstrap/snapshot 응답에서는 `passwordHash`를 제거한다. 파일럿 기본 임시 비밀번호는 `FinalJudoPilot!2026`이며 실제 운영 전 `/app/admin/users` 또는 `POST /admin/users/:userId/password`에서 계정별 값으로 교체한다.

`POST /auth/register`는 이름, 한국 휴대폰 번호, 8자 이상 비밀번호를 받아 UUID 기반 사용자·성인 회원 프로필을 함께 생성한다. 정규화된 휴대폰 번호 범위의 런타임 잠금 안에서 최신 저장소를 다시 확인하므로 같은 번호의 동시 가입은 정확히 한 건만 성공하고 나머지는 `409 CONFLICT`를 반환한다. 병합 후 저장 경계도 휴대폰·이메일 유일성과 사용자·회원 연결을 다시 검증한다.

`POST /admin/users/:userId/password`는 총괄 어드민 전용이다. 요청 본문은 `{ "reason": "..." }`이고, 선택적으로 `{ "temporaryPassword": "..." }`를 보낼 수 있다. 값을 지정하지 않으면 서버가 1회 표시용 임시 비밀번호를 생성해 응답의 `password.temporaryPassword`로 돌려준다. 저장소와 감사 로그에는 원문 비밀번호를 남기지 않고 랜덤 salt PBKDF2 해시, 발급 시각, 발급 사유, `auth.password_reset.complete` 감사 로그만 남긴다.

사용자 수정·역할 변경에서 코치/대표/총괄 역할 또는 담당 지점을 제거하면 해당 사용자의 수업과 담당 회원을 같은 지점의 다른 코치, 대표, 실행 총괄 순으로 자동 인계한다. 변경 기록에는 인계된 수업·회원 건수를 남긴다. 다른 대표가 없는 지점의 단독 대표는 역할 제거, 지점 해제, 계정 삭제를 `422 BUSINESS_RULE_FAILED`로 차단한다. 학부모 역할을 제거하면 회원 `guardianIds`의 역관계와 계정 `childMemberIds`를 함께 정리한다.

`POST /auth/login`의 `{ "role": "coach" }` 역할 선택 데모 로그인은 개발/테스트 환경용이다. production에서는 기본 `403 FORBIDDEN`으로 차단하고, 파일럿 검증 중 명시적으로 필요할 때만 `FINAL_JUDO_ENABLE_DEMO_LOGIN=1`로 허용한다. 세션 쿠키는 `httpOnly`, `sameSite=lax`를 사용하며 기본 8시간, 로그인 상태 유지 선택 시 30일 만료를 적용하고 production에서는 `secure`를 적용한다. production 서버는 `x-user-id` 헤더를 세션 대체 수단으로 인정하지 않는다.

운영 환경 변수 기준은 `.env.example`, `.env.production.example`, `docs/ENVIRONMENT_MATRIX.md`에 고정한다. `npm run test:env-readiness`는 PostgreSQL runtime store, demo/reset 위험 플래그, 결제 provider, webhook secret, VAPID push 변수가 문서와 release gate에 누락되지 않았는지 검증한다.

`GET /me` 응답:

```json
{
  "data": {
    "id": "user-admin",
    "name": "정유진",
    "role": "admin",
    "rbacRole": "super_admin",
    "branchIds": ["branch-gangnam", "branch-songpa"],
    "selectedBranchId": null
  }
}
```

## 4. 지점

| Method | Path | 권한 | 감사 | 설명 |
| --- | --- | --- | --- | --- |
| `GET` | `/branches` | `branches.read` | 아니오 | 접근 가능한 지점 목록 |
| `POST` | `/branches` | `branches.create` | 예 | 지점 생성 |
| `POST` | `/admin/branches` | `branches.create` | 예 | 총괄 지점 생성 및 대표 배정 |
| `PATCH` | `/admin/branches/:branchId` | `branches.update` | 예 | 지점 수정, 운영 설정 변경, 비활성화 |
| `PUT` | `/admin/branches/:branchId/owner` | `branches.update` | 예 | 지점 대표 배정 |

지점 수정은 `reason`을 필수로 받고, `status: inactive`로 비활성화한다. 운영 설정은 출석 수정 사유 정책과 기본 지점 운영값을 포함하며, 요청 기능용 설정값은 화면에 노출하지 않는다.

지점 역할 사용자는 배정된 지점만 받는다. 총괄 어드민은 전체 지점을 받는다.

## 5. 사용자/RBAC

| Method | Path | 권한 | 감사 | 설명 |
| --- | --- | --- | --- | --- |
| `GET` | `/admin/users` | `users.manage` | 민감 필터 시 예 | 전체 사용자 목록 |
| `POST` | `/admin/users/invitations` | `users.manage` 또는 대표 지점 범위 | 예 | 사용자 초대 |
| `PATCH` | `/admin/users/:userId` | `users.manage` | 예 | 사용자 상태/프로필 수정 |
| `GET` | `/admin/roles` | `rbac.manage` | 아니오 | 역할 목록 |
| `GET` | `/admin/roles/:roleId/permissions` | `rbac.manage` | 아니오 | 권한 매트릭스 |
| `PUT` | `/admin/users/:userId/roles` | `rbac.manage` | 예 | 사용자 역할 재배정 |
| `PUT` | `/admin/roles/:roleId/permissions` | `rbac.manage` | 예 | 역할 권한 변경 |
| `GET` | `/admin/audit-logs` | `audit_logs.read` | 예 | 감사 로그 조회 |
| `GET` | `/admin/pilot-readiness` | `admin` | 아니오 | 파일럿 준비 항목과 상태 요약 조회 |
| `PATCH` | `/admin/pilot-readiness` | `admin` | 예 | 파일럿 준비 항목 상태/담당자/증빙 저장 |
| `GET` | `/admin/pilot-incidents` | `admin` | 아니오 | 파일럿 이슈 목록과 상태 요약 조회 |
| `POST` | `/admin/pilot-incidents` | `admin` | 예 | 파일럿 이슈 기록 |
| `PATCH` | `/admin/pilot-incidents/:incidentId` | `admin` | 예 | 파일럿 이슈 담당자/상태/우회책 변경 |
| `GET` | `/admin/pilot-operations` | `admin` | 아니오 | 파일럿 일일 운영 로그와 14일 운영 요약 조회 |
| `POST` | `/admin/pilot-operations` | `admin` | 예 | 파일럿 일일 운영 로그 생성/갱신 |

감사 로그 조회 쿼리:

| Query | 설명 |
| --- | --- |
| `reason` | 필수. 감사 로그 조회 사유 |
| `q` | 메시지, 액션, 행위자, 대상 검색어 |
| `action` | `attendance.update`, `export.create`, `audit_logs.read` 등 액션 필터 |
| `branchId` | `all`, `system`, 또는 지점 ID |
| `result` | `success`, `blocked`, `failed` |
| `from`, `to` | ISO 시각 또는 `YYYY-MM-DD` 범위. 날짜만 전달하면 한국 시간 기준 `from` 00:00:00.000, `to` 23:59:59.999를 포함 |
| `limit` | 1-200 사이 반환 개수 |

감사 로그 조회 자체도 `audit_logs.read` 액션으로 기록한다. 단, 같은 사용자가 동일 필터·동일 사유로 5초 안에 재시도한 요청은 화면 초기화나 네트워크 중복 호출로 보고 한 건으로 합치며, 필터·사유가 다르거나 5초를 지난 조회는 별도 기록한다.
`from`이 `to`보다 늦은 범위는 빈 목록으로 처리하지 않고 `400 VALIDATION_ERROR`로 거부한다.

파일럿 준비 상태 저장 payload:

```json
{
  "checkId": "pilot-mobile-attendance",
  "status": "verified",
  "owner": "코치 리드",
  "evidence": "2026-06-14 현장 기기 2대에서 30초 이내 출석 처리 확인"
}
```

`status`는 `pending`, `verified`, `blocked` 중 하나다. `verified`와 `blocked`는 증빙 텍스트가 필요하며, 저장 시 `pilot_readiness.update` 감사 로그에 before/after 상태를 남긴다.
기본 파일럿 준비 항목에는 지점/계정/데이터/현장 기기/접근성/장애 대응/회고와 함께 `pilot-password-rotation` 보안 체크가 포함된다.

파일럿 이슈 payload:

```json
{
  "branchId": "branch-gangnam",
  "severity": "p0",
  "title": "출석 저장 실패",
  "description": "코치 모바일에서 출석 저장 시 500 오류",
  "role": "coach",
  "screen": "/app/classes",
  "owner": "총괄 PM",
  "workaround": "수기 출석부에 임시 기록"
}
```

`severity`는 `p0`, `p1`, `p2`, `status`는 `open`, `monitoring`, `resolved` 중 하나다. `monitoring` 또는 `resolved` 변경에는 5자 이상의 우회책/조치 메모가 필요하다. 생성은 `pilot_incident.create`, 상태 변경은 `pilot_incident.update` 감사 로그에 남긴다.

파일럿 운영 로그 payload:

```json
{
  "branchId": "branch-gangnam",
  "date": "2026-06-14",
  "status": "verified",
  "owner": "총괄 PM",
  "classesChecked": 3,
  "attendanceRecords": 28,
  "mobileAttendanceDurationSeconds": 22,
  "mobileAttendanceEvidence": "iPhone Safari 현장 출석 22초 확인 기록",
  "paymentChecks": 6,
  "noticeFollowupChecks": 2,
  "noticeChecks": 1,
  "evidence": "D3 실제 수업 3개 출석 저장, 결제 상태 6건 확인",
  "blockerSummary": ""
}
```

같은 `branchId`와 `date` 조합은 갱신으로 처리한다. 날짜는 실제 달력상 가능한 `YYYY-MM-DD` 값이어야 한다. `verified`와 `blocked`는 증빙 메모가 필요하고, `blocked`는 차단/특이사항 기록이 필요하다. `verified`는 출석/결제/공지 후속/공지 중 하나 이상의 운영 수치가 필요하다. 출석 기록 수치가 있는 `verified` 로그는 30초 이하의 `mobileAttendanceDurationSeconds`와 현장 녹화/캡처 링크 등 `mobileAttendanceEvidence`를 함께 기록해야 한다. 저장 시 `pilot_operation.update` 감사 로그에 before/after 상태를 남긴다. 파일럿 종료 후 `preflight:pilot -- --require-retro`는 `pilot-retro` 증빙과 14개 운영일, 실제 출석 기록 수치, 모바일 출석 30초 계측 증빙, 결제 상태 확인 수치를 함께 검사한다.

권한 저장 정책:

- 시스템 기본 역할은 삭제할 수 없다.
- 현재 로그인한 총괄 어드민이 자신의 `super_admin` 권한을 제거할 수 없다.
- 저장 후 `super_admin` 활성 사용자가 0명이 되면 `422 BUSINESS_RULE_FAILED`를 반환한다.
- `rbac.manage`, `payments.refund`, `audit_logs.read`, `exports.create` 변경은 `reason` 필수다.
- 총괄 어드민은 전체 역할을 초대할 수 있다.
- 대표는 배정된 지점 안에서 `coach`, `guardian`, `member`만 초대할 수 있으며 `admin`, `owner` 초대는 `403 FORBIDDEN`으로 차단한다.

## 6. 회원/보호자

| Method | Path | 권한 | 감사 | 설명 |
| --- | --- | --- | --- | --- |
| `GET` | `/branches/:branchId/members` | `members.read.full` 또는 제한 DTO | 민감 필터 시 예 | 지점 회원 목록 |
| `POST` | `/branches/:branchId/members` | `members.write` | 예 | 회원 생성 |
| `GET` | `/members/:memberId` | self/relation/branch | 민감 필드 포함 시 예 | 회원 상세 |
| `PATCH` | `/members/:memberId` | `members.write` 또는 self/relation 연락처 수정 | 예 | 회원 수정 |
| `POST` | `/members/:memberId/guardians` | `guardians.write` | 예 | 보호자 연결 |
| `POST` | `/branches/:branchId/members/:memberId/counseling-notes` | `counseling_notes.write` | 예 | 상담/주의 메모 작성 |
| `GET` | `/me/children` | guardian relation | 아니오 | 연결 자녀 목록 |

코치 회원 DTO는 이름, 띠, 레벨, 나이대, 주의사항, 회원권 상태 요약만 포함한다.

회원 생성은 `createdAt`, `statusChangedAt`을 서버 시각으로 저장하고, 생성 상태가 `withdrawn`이면 `withdrawnAt`도 함께 저장한다. 회원 수정 payload는 운영자 권한에서 `status`, `belt`, `level`, `emergencyContact`, `alerts`를 받는다. 상태가 바뀌면 `statusChangedAt`을 서버 시각으로 갱신하고, `withdrawn` 전환 시 `withdrawnAt`을 저장하며, 다른 상태로 복귀하면 `withdrawnAt`을 비운다. 회원 본인과 학부모는 본인/연결 자녀 관계가 검증된 경우 `emergencyContact`만 변경할 수 있고, 상태/수련 정보/주의사항 변경은 `403 FORBIDDEN`으로 차단한다. 모든 실제 변경은 `member.update` 감사 로그에 before/after diff로 기록한다.

보호자 연결 payload는 `guardianUserId`를 받는다. 서버는 대표/총괄 권한, 회원 지점 스코프, 활성 학부모 계정 여부를 검증하고, 회원의 `guardianIds`와 학부모 계정의 `childMemberIds`를 함께 갱신한다. 중복 연결은 멱등 처리하며 실제 변경은 `member.update` 감사 로그에 남긴다.

상담/주의 메모 payload는 `body`, `noteType`(`general`, `caution`, `progress`, `follow_up`), `visibility`(`staff_only`, `coach_visible`, `guardian_visible`)를 받는다. 코치는 담당 회원에게 `coach_visible`, `guardian_visible` 메모만 작성할 수 있고, 학부모/회원은 `guardian_visible` 메모만 조회한다.

## 7. 수업/출석

| Method | Path | 권한 | 감사 | 설명 |
| --- | --- | --- | --- | --- |
| `GET` | `/branches/:branchId/classes` | `classes.read` | 아니오 | 수업 목록 |
| `POST` | `/branches/:branchId/classes` | `classes.write` | 예 | 수업 생성 |
| `PATCH` | `/classes/:classId` | `classes.write` | 예 | 수업 수정 |
| `GET` | `/branches/:branchId/class-sessions` | `classes.read` | 아니오 | 회차 목록 |
| `GET` | `/branches/:branchId/class-sessions/today` | coach/owner/admin | 아니오 | 오늘 수업 |
| `PUT` | `/class-sessions/:sessionId/attendance` | `attendance.write` | 예 | 출석 일괄 저장 |
| `POST` | `/class-sessions/:sessionId/attendance/:memberId/reason` | `attendance.write` | 예 | 수정 사유 기록 |

출석 저장 요청:

```json
{
  "items": [
    {
      "memberId": "member-jun",
      "status": "present",
      "note": null,
      "clientVersion": 3
    }
  ],
  "reason": "현장 출석 체크"
}
```

`items[].note`가 있으면 해당 회원의 출석 메모로 저장하고, 없으면 최상위 `reason`을 공통 수정 사유로 사용한다. 출석 저장과 별도 사유 기록 모두 `audit_logs.before/after.note`에 이전/변경 사유를 남긴다.

출석 충돌은 `409 CONFLICT`로 반환하고 서버의 최신 상태를 함께 내려준다.

## 8. 요청 기능 삭제

| Method | Path | 권한 | 감사 | 설명 |
| --- | --- | --- | --- | --- |
| `GET/POST` | `/requests`, `/app/requests`, `/api/v1/requests*` | 제공 안 함 | 아니오 | 라우트와 API 파일 삭제, 직접 접근 시 `404` |

앱 라우트 `/app/requests`, `/requests`와 요청 생성/승인/반려 API는 계약에서 제거했다. `npm run build`, `npm run test:routes`, `npm run test:api-auth-order`와 `.data/mobile-builds/ios/requests-route-removed-20260628/evidence.json`이 404 삭제 상태를 검증한다.

## 9. 회원권/결제

| Method | Path | 권한 | 감사 | 설명 |
| --- | --- | --- | --- | --- |
| `GET` | `/branches/:branchId/payments` | `payments.read` | 예 | 결제 목록 |
| `POST` | `/branches/:branchId/members/:memberId/memberships` | `memberships.write` | 예 | 회원권 등록 |
| `POST` | `/branches/:branchId/payments` | `payments.write` | 예 | 수기 결제 기록 |
| `PATCH` | `/payments/:paymentId` | `payments.write` | 예 | 수기 결제 정정 |
| `DELETE` | `/payments/:paymentId` | `payments.write` | 예 | 수기 결제 오등록 삭제 |
| `POST` | `/payments/:paymentId/online-checkout` | `payments.write` | 예 | 온라인 결제 요청 생성 |
| `POST` | `/payments/:paymentId/recurring-agreement` | `payments.write` | 예 | 정기결제 약정 생성 |
| `DELETE` | `/payments/:paymentId/recurring-agreement` | `payments.write` | 예 | 정기결제 약정 해지 |
| `POST` | `/payments/webhook` | provider secret | 예 | provider 결제 성공/실패/환불 webhook |
| `POST` | `/payments/:paymentId/refund` | `payments.refund` | 예 | 환불/취소 처리 |
| `GET` | `/me/payments` | self/relation | 아니오 | 본인/자녀 결제 상태 |
| `GET` | `/exports/payments` | `exports.create` | 예 | 결제 CSV 내보내기 |
| `GET` | `/exports/operations` | `exports.create` | 예 | 지점 운영 리포트 CSV 내보내기 |

수기 결제 기록 payload는 `discountAmount`를 받을 수 있고, 서버는 할인 금액이 결제 금액을 초과하지 않는지, 납부일과 만료일이 실제 달력에 존재하는 `YYYY-MM-DD`인지, 만료일이 납부일보다 앞서지 않는지를 생성·수정에 동일하게 검증한다. 수기 등록 상태는 `scheduled`, `paid`, `overdue`, `cancelled`, `refunded`, `expiringSoon`만 허용하며, 환불액 없는 `partially_refunded` 상태를 직접 만들 수 없다. `cancelled` 또는 `refunded` 상태로 생성할 때는 공백이 아닌 `reason`이 필수이고, 서버는 앞뒤 공백을 제거한 사유와 처리 시각을 결제 레코드, 최초 `statusHistory`, `payment.create` 감사 스냅샷에 저장한다. `refunded` 직접 등록은 결제 금액 전체를 환불액으로 기록한다. 결제 생성은 UUID 기반 ID와 `statusHistory`에 최초 상태, 처리자, 처리 시각, 사유를 저장한다. 클라이언트는 `POST /branches/:branchId/payments`에 16~128자의 `Idempotency-Key`를 보내며, 서버는 처리자·지점 범위의 `payment.create` 감사 기록에 키, 생성 스냅샷과 정규화 payload의 SHA-256 확인값을 보관한다. 취소·환불 완료 생성의 확인값에는 정규화한 사유를 포함하고, 일반 상태 생성은 기존 사유 없는 확인값 형식을 유지한다. 같은 키와 같은 payload의 재시도는 새 결제를 만들지 않고 기존 결과와 `Idempotency-Replayed: true` 응답 헤더를 반환한다. 같은 키에 다른 payload를 보내거나 이미 삭제된 원본을 재시도하면 `409 IDEMPOTENCY_CONFLICT`로 차단한다. 헤더가 없는 기존 호출은 하위 호환을 위해 계속 처리한다. `PATCH /payments/:paymentId`는 회원권명, 상태, 금액, 할인, 납부일, 만료일과 필수 `reason`을 정정하고 `payment.update` 변경 기록을 남긴다. 금액·할인·회원권명·날짜만 정정하면 감사 기록만 남기며, 실제 상태가 바뀐 경우에만 `statusHistory`에 `status_changed`를 추가한다. `DELETE /payments/:paymentId`는 필수 `reason`과 취소 시각·사유·상태 이력을 포함한 삭제 전 스냅샷을 `payment.delete` 변경 기록에 남긴 뒤 오등록 건을 제거한다. 두 API는 대표/총괄과 선택 지점 범위를 확인하며, 온라인 결제·정기결제·환불 금액 이력이 있는 기록은 직접 수정/삭제하지 않고 기존 결제 수명주기 API를 사용한다. 환불 금액이 없는 수기 취소 기록은 사유를 남겨 계속 정정하거나 삭제할 수 있다. 동일 결제의 수기 수정·삭제와 온라인 결제 요청은 공통 mutation lock으로 직렬화하고, 같은 결제 레코드의 stale 동시 변경은 자동 병합하지 않는다. 환불/취소 payload는 `reason`을 필수로 받으며, 부분 환불은 실제 환불 금액과 함께 `partially_refunded`, 전액 환불은 `refunded`, 예정/미납/만료 예정 결제 취소는 `cancelled` 상태로 저장한다. 환불/취소는 결제의 `statusHistory`에 상태 변경 이벤트를 추가하고, 전후 상태와 사유는 `payment.refund` 변경 기록에도 남긴다.

같은 키의 동시 처리는 런타임 저장소 공통 잠금으로 직렬화한다. JSON 개발 저장소는 파일시스템 operation lock과 쓰기 직전 최신 파일 병합을 사용하고, PostgreSQL 운영 저장소는 `app_runtime_state` 테이블·상태 키·요청 범위를 조합한 트랜잭션 advisory lock을 사용해 서로 다른 서버 인스턴스도 같은 결제를 동시에 생성하지 못하게 한다. PostgreSQL 잠금 안의 read/write는 같은 DB 연결과 트랜잭션을 사용해 transaction pooling 환경에서도 커밋·롤백과 함께 잠금이 해제된다.

배포는 선택 헤더와 분산 잠금을 이해하는 서버를 먼저 반영한 뒤 클라이언트를 반영한다. advisory lock은 스키마나 저장 데이터를 변경하지 않으므로 롤백 시 클라이언트를 먼저 이전 버전으로 되돌리고 서버 잠금 코드를 제거해도 DB 마이그레이션 롤백이 필요 없다. `IDEMPOTENCY_CONFLICT`가 비정상적으로 증가하면 클라이언트의 키 재사용 범위를 먼저 확인하고, 저장 완료 여부가 불명확한 결제는 새 키로 자동 재등록하지 않는다.

온라인 결제 요청은 예정/미납/만료 예정/부분 환불 결제에 대해 대표/총괄이 생성한다. `POST /api/v1/payments/{paymentId}/online-checkout`은 provider-neutral `onlinePayment` 메타를 결제에 저장하고 `payment.online_checkout.create` 감사 로그를 남긴다. 운영 PG/VAN 계약 전에는 `FINAL_JUDO_PAYMENT_PROVIDER`가 비어 있으면 mock provider로 동작하며, `FINAL_JUDO_PAYMENT_CHECKOUT_BASE_URL`이 없으면 앱 내부 리허설 URL을 만든다.

```json
{
  "onlinePayment": {
    "provider": "mock",
    "providerPaymentId": "fj_pay-yuna_1781480000000",
    "status": "pending",
    "checkoutUrl": "/app/payments?checkout=fj_pay-yuna_1781480000000",
    "requestedAt": "2026-06-15T10:00:00.000Z",
    "requestedByUserId": "user-owner",
    "amount": 30000
  }
}
```

`POST /api/v1/payments/webhook`은 `x-final-judo-payment-webhook-secret` 헤더를 검증한다. production에서는 `FINAL_JUDO_PAYMENT_WEBHOOK_SECRET`이 없으면 `503 PAYMENT_WEBHOOK_NOT_CONFIGURED`로 차단하고, 개발/테스트에서는 `final-judo-dev-webhook-secret` fallback으로 smoke 테스트를 수행한다. payload는 `{ "providerPaymentId": "...", "providerEventId": "...", "event": "paid" | "failed" | "refunded", "amount": 30000, "receiptId": "...", "receiptUrl": "...", "reason": "..." }` 형태다. provider가 event ID를 body가 아니라 header로 보낼 때는 `x-final-judo-payment-event-id`도 허용한다. 성공 이벤트는 결제 상태를 `paid`로 바꾸고 receipt 메타를 저장하며, 실패 이벤트는 결제 상태를 유지하고 실패 사유를 `onlinePayment.failureReason`에 저장한다. 환불 webhook은 `refundedAmount`, `refundReason`, `statusHistory`와 `payment.webhook` 감사 로그를 남긴다. 이미 처리한 `providerEventId`가 다시 들어오면 상태 이력과 감사 로그를 추가하지 않고 `{ "duplicate": true }`로 idempotent 응답한다.

정기결제 약정은 완료/납부 예정/미납/만료 예정/부분 환불 결제에서 대표/총괄이 생성한다. `POST /api/v1/payments/{paymentId}/recurring-agreement`는 `{ "nextBillingDate": "2026-07-16", "billingDayOfMonth": 16 }`를 선택적으로 받고, 없으면 회원권 `expiresAt` 다음 날과 1-28일 범위의 청구일을 자동 계산한다. mock provider에서는 즉시 `active`, 외부 provider에서는 `pending` 상태로 저장한다. 해지는 `DELETE /api/v1/payments/{paymentId}/recurring-agreement`에 `{ "reason": "..." }`를 보내며 사유가 없으면 `400 VALIDATION_ERROR`로 차단한다. 생성/해지는 `recurringAgreement`, `statusHistory`, `payment.recurring_agreement.create` 또는 `payment.recurring_agreement.cancel` 감사 로그를 남긴다.

```json
{
  "recurringAgreement": {
    "provider": "mock",
    "providerAgreementId": "fj_agreement_pay-yuna_1781480000000",
    "status": "active",
    "interval": "monthly",
    "billingDayOfMonth": 16,
    "nextBillingDate": "2026-07-16",
    "requestedAt": "2026-06-15T10:00:00.000Z",
    "requestedByUserId": "user-owner",
    "activatedAt": "2026-06-15T10:00:00.000Z"
  }
}
```

코치용 수업/회원 응답에 포함되는 결제 정보:

```json
{
  "membershipStatus": "active",
  "expiresAt": "2026-07-18",
  "paymentRisk": "expiringSoon"
}
```

코치 응답에는 `amountKrw`, `paymentMethod`, `discount`, `refund`, `onlinePayment.amount`, `onlinePayment.checkoutUrl`, `recurringAgreement.providerAgreementId`를 포함하지 않는다. 대표/총괄 결제 화면과 결제 CSV는 `status_history_count`, `last_status_changed_at`, `last_status_reason`, `online_payment_status`, `online_provider_payment_id`, `receipt_id`, `receipt_url`, `recurring_status`, `recurring_next_billing_date`로 상태 변경 흐름과 provider 영수증/약정 상태를 확인할 수 있다.

## 10. 공지

| Method | Path | 권한 | 감사 | 설명 |
| --- | --- | --- | --- | --- |
| `GET` | `/branches/:branchId/notices` | branch/self/relation | 아니오 | 공지 목록 |
| `POST` | `/branches/:branchId/notices` | `notices.publish` (owner/admin/coach 담당 범위) | 예 | 공지 작성/발행 |
| `PATCH` | `/notices/:noticeId` | `notices.publish` | 예 | 공지 수정 |
| `POST` | `/me/notices/:noticeId/read` | self/relation | 예 | 읽음 처리 |
| `POST` | `/me/notices/bulk-read` | self/relation | 예 | 여러 공지 읽음 처리 |
| `GET` | `/notifications/push-config` | 인증 | 아니오 | VAPID 공개키/구독 가능 상태 조회. 활성 구독 수는 대표/총괄은 담당 지점 범위, 코치/회원/학부모는 본인 구독 범위로만 반환 |
| `POST` | `/notifications/subscriptions` | 인증 | 예 | 현재 브라우저 PushSubscription 저장. 응답의 활성 구독 수는 역할별 스코프만 반환 |
| `DELETE` | `/notifications/subscriptions` | 인증 | 예 | 현재 사용자 PushSubscription 비활성화. 회원/학부모는 항상 켜짐 정책으로 비활성화하지 않고 `disabledAt: null`과 `enforcedAlwaysOn: true`를 반환하며 활성 구독 수는 본인 범위만 반환 |
| `POST` | `/branches/:branchId/notices/:noticeId/push` | `notices.publish` (owner/admin/coach 담당 범위) | 예 | 공지 대상자 구독에 서버 푸시 발송 |

공지 대상:

```json
{
  "title": "승급 심사 준비 안내",
  "body": "심사 대상자는 출석률과 기본기 체크 항목을 담당 코치와 확인해 주세요.",
  "important": true,
  "audience": ["guardian"],
  "targetClassIds": ["class-kids-am"],
  "targetMemberIds": []
}
```

`important`는 운영자가 즉시 확인해야 하는 공지를 표시하는 선택값이며, UI와 푸시 제목에 중요 상태를 노출한다. `audience`는 역할 대상(`all`, `member`, `guardian`, `coach`, `owner`, `admin`)을 뜻한다. `targetClassIds`가 있으면 해당 반 수강생/보호자/담당 코치 범위로 좁히고, `targetMemberIds`가 있으면 지정 회원 본인/보호자/담당 코치 범위로 좁힌다. 둘 다 없으면 대표/총괄은 선택 지점 전체 역할 대상 공지로 발행하고, 코치는 담당 수업/담당 회원 범위의 회원·학부모 공지로 좁혀 발행한다. 서버는 대상 반/회원이 공지 지점에 속하는지 검증하고, 코치가 담당 범위 밖 반/회원을 지정하면 거부한다. `createdByUserId`는 작성자가 회원/학부모 대상 공지를 발행한 뒤에도 자기 공지 목록에서 계속 볼 수 있게 유지하는 메타데이터다. 학부모/회원 읽음 처리는 관계가 맞는 공지만 허용한다. `POST /me/notices/bulk-read`는 `{ "noticeIds": ["notice-1"] }`를 받아 최대 50건까지 현재 사용자가 읽을 수 있는 공지만 일괄 처리하고, 포함된 공지가 없거나 스코프 밖이면 실패한다.

앱 알림함과 휴대폰 푸시는 같은 대상 산정 결과를 사용한다. 공지는 작성/발행되는 즉시 대상 회원/학부모 알림함에 미확인으로 표시되고, 서버 푸시 환경과 대상 기기 구독이 준비된 경우 같은 요청에서 휴대폰 푸시도 자동 발송한다. `/branches/:branchId/notices/:noticeId/push`는 발행 이후 같은 대상에게 휴대폰 푸시를 다시 보내는 수동 재발송 동작이며, 생성/재발송 응답은 모두 `recipientCount`로 알림함 대상 수를 함께 돌려준다. PWA 서버 푸시는 `FINAL_JUDO_VAPID_PUBLIC_KEY`, `FINAL_JUDO_VAPID_PRIVATE_KEY`, `FINAL_JUDO_VAPID_SUBJECT`를 사용한다. 키가 없거나 대상 기기 구독이 없으면 `/notifications/push-config`와 공지 생성/재발송 응답은 `configured: false` 또는 `attempted: 0` 상태를 반환하고, 앱/API는 “알림함에는 표시됩니다. 휴대폰 푸시는 기기 알림 연결 후 발송할 수 있습니다.”처럼 알림함 표시와 휴대폰 푸시 미발송을 분리해서 안내한다. 구독 저장소는 endpoint, `p256dh`, `auth`, 사용자, 지점 범위, 마지막 발송/실패/비활성화 시각을 보관한다. 활성 구독 수는 전체 시스템 수를 공개하지 않고 대표/총괄은 담당 지점 범위, 코치/회원/학부모는 본인 구독 범위로만 계산한다. 회원/학부모는 알림 설정을 앱 내부에서 항상 켜짐으로 취급하므로 설정 카드와 해지 액션을 노출하지 않으며, 구독 해지 API가 직접 호출되어도 기존 구독을 활성 상태로 유지하고 `notification.unsubscribe` 감사 로그에 `family_notification_always_on` 정책 차단으로 남긴다. 감사 로그에는 원문 endpoint/key 전체를 남기지 않고 endpoint hint, 지점 범위, 발송 건수, 실패/비활성화 건수만 남긴다. 만료되거나 사라진 push endpoint가 404/410을 반환하면 서버가 해당 구독을 비활성화한다.

## 11. 감사 로그/CSV

| Method | Path | 권한 | 감사 | 설명 |
| --- | --- | --- | --- | --- |
| `GET` | `/admin/audit-logs` | `audit_logs.read` | 예 | 감사 로그 목록 |
| `POST` | `/exports` | `exports.create` | 예 | CSV 내보내기 요청 |
| `GET` | `/exports/:exportId` | `exports.create` | 예 | CSV 다운로드 |

결제 CSV는 결제 원장, 할인, 환불/취소 사유, 상태 이력, 온라인 결제 요청 상태, provider 결제 ID, 영수증 ID/URL, 정기결제 약정 상태와 다음 청구일을 포함한다. 운영 리포트 CSV는 지점, 회원 상태 카운트, 수업 수, 출석 처리율, 출석 미처리 슬롯, 확정 매출, 결제 위험 건수/금액, 대표 우선 점수를 지점 스코프별로 포함하고, 두 번째 섹션의 `trend_period` 행으로 수업일/출석 확인/결제 기한/회원 생성일/퇴관일/상태 변경일 기준 기간별 운영 추세를 제공한다. 추세 섹션은 `new_members`, `withdrawn_members`, `net_member_change`, `member_change_events`를 포함해 대표가 신규·이탈·순증과 감사 로그 기반 변경 이벤트를 분리해서 볼 수 있게 한다. CSV 생성 기록은 `resource`/`type`, `filters` 또는 `branchIds`, `rowCount`, `fileId`, `expiresAt`을 감사 로그에 남긴다.
감사 로그 목록은 총괄 어드민 전용이며, `reason` 없는 조회는 `400 VALIDATION_ERROR`로 거절한다.
임시 비밀번호 발급은 `auth.password_reset.complete`로 기록하며, 감사 로그에는 발급 사유와 방식만 남기고 원문 비밀번호는 남기지 않는다.
파일럿 이슈 생성/상태 변경은 `pilot_incident.create`, `pilot_incident.update`로 기록해 장애 대응과 운영 중단 판단 근거를 감사 로그에서 추적한다.

## 12. 프론트 mock API 전환 매핑

| 현재 mock 함수 | 실제 API |
| --- | --- |
| `apiClient.signIn` | `POST /api/v1/auth/login` 이메일/비밀번호 또는 개발/테스트 역할 payload |
| `apiClient.requestPasswordReset` | `POST /api/v1/auth/password-reset` |
| `apiClient.acceptInvitation` | `POST /api/v1/auth/invitations/:token/accept` |
| `apiClient.createInvitation` | `POST /api/v1/admin/users/invitations` |
| `apiClient.resetUserPassword` | `POST /api/v1/admin/users/:userId/password` |
| `apiClient.updatePilotReadiness` | `PATCH /api/v1/admin/pilot-readiness` |
| `apiClient.createPilotIncident` | `POST /api/v1/admin/pilot-incidents` |
| `apiClient.updatePilotIncident` | `PATCH /api/v1/admin/pilot-incidents/:incidentId` |
| `mockApi.getDashboard` | `GET /api/v1/me/dashboard` |
| `mockApi.getClasses` | `GET /api/v1/branches/:branchId/class-sessions` |
| `mockApi.getMembers` | `GET /api/v1/branches/:branchId/members`, `GET /api/v1/me/children` |
| `mockApi.getPayments` | `GET /api/v1/branches/:branchId/payments`, `GET /api/v1/me/payments` |
| `mockApi.getNotices` | `GET /api/v1/branches/:branchId/notices`, `GET /api/v1/me/notices` |
| `upsertAttendance` | `PUT /api/v1/class-sessions/:sessionId/attendance` |
| `markNoticeRead` | `POST /api/v1/me/notices/:noticeId/read` |
| `markNoticeRead` | `POST /api/v1/me/notices/bulk-read` |
| `apiClient.getPushConfig` | `GET /api/v1/notifications/push-config` |
| `apiClient.subscribeToPush` | `POST /api/v1/notifications/subscriptions` |
| `apiClient.unsubscribeFromPush` | `DELETE /api/v1/notifications/subscriptions` |
| `apiClient.dispatchNoticePush` | `POST /api/v1/branches/:branchId/notices/:noticeId/push` |
