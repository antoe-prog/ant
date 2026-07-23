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
| 410 | `BUSINESS_RULE_FAILED` | 만료된 초대 등 더 이상 사용할 수 없는 일회성 리소스 |
| 422 | `BUSINESS_RULE_FAILED` | 정원 초과, self-lockout 등 정책 실패 |
| 429 | `RATE_LIMITED` | 인증·초대 비밀번호 시도 제한, `Retry-After` 포함 |
| 500 | `INTERNAL_ERROR` | 서버 오류 |

## 3. 인증/내 계정

| Method | Path | 권한 | 감사 | 설명 |
| --- | --- | --- | --- | --- |
| `POST` | `/auth/login` | 공개 | 예 | 운영 계정 로그인 또는 개발/테스트 역할 로그인 |
| `POST` | `/auth/register` | 공개 | 예 | 휴대폰 성인 회원가입 |
| `POST` | `/auth/logout` | 인증 | 예 | 로그아웃 |
| `POST` | `/auth/password-reset` | 공개 | 예 | 휴대폰 인증 후 비밀번호 직접 변경 |
| `POST` | `/auth/invitations/:token/accept` | 공개 | 예 | 초대 가입 수락 |
| `POST` | `/admin/users/:userId/password` | admin | 예 | 임시 비밀번호 발급 |
| `GET` | `/me` | 인증 | 아니오 | 내 계정, 역할, 접근 지점 |
| `GET` | `/me/dashboard` | 인증 | 아니오 | 역할별 홈 요약 |
| `GET` | `/me/notices` | 인증 | 아니오 | 내게 보이는 공지 |
| `POST` | `/me/notices/:noticeId/read` | 인증 + self/relation | 예 | 공지 읽음 처리 |
| `POST` | `/me/notices/bulk-read` | 인증 + self/relation | 예 | 여러 공지 읽음 처리 |

`POST /auth/login`은 `{ "phone": "...", "password": "...", "keepSignedIn": true }` 운영 계정 로그인을 기본 경로로 사용한다. 휴대폰·이메일·로그인 ID·비밀번호는 문자열, 로그인 상태 유지는 boolean, 개발 역할은 허용된 역할 값이어야 하며 비문자·배열 payload는 비밀번호 검증이나 세션 변경 전에 `400 VALIDATION_ERROR`로 차단한다. 휴대폰 원문은 40자, 이메일·로그인 ID는 254자, 비밀번호는 256자로 제한해 PBKDF2 검증 전에 초과 입력을 거부한다. `keepSignedIn`을 보내지 않으면 세션 쿠키는 8시간 유지되고, `true`이면 30일 유지된다. 데모 seed와 파일럿 CSV import 사용자는 서버 저장소에서 PBKDF2 `passwordHash`를 갖지만, 모든 bootstrap/snapshot 응답에서는 `passwordHash`를 제거한다. 공용 데모 비밀번호는 로컬 seed 호환용일 뿐 신규 가입·초대·재발급에 사용할 수 없다. 파일럿 전에는 `local-demo:password-rotate`로 격리 JSON 복사본의 계정별 비밀번호를 만들고, production preflight가 salt와 무관하게 공용 비밀번호로 검증되는 해시를 차단한다. 실제 운영 반영과 전달 증빙은 별도 승인 절차로 수행한다.

`GET /auth/register`는 공개 가입에 사용할 수 있는 활성 지점 중 승인된 담당 운영자가 있는 지점의 `id`, `name`, `district`만 반환한다. `POST /auth/register`는 해당 목록에서 사용자가 선택한 `branchId`, 문자열 이름, 한국 휴대폰 번호, 8자 이상 문자열 비밀번호를 받아 UUID 기반 사용자·성인 회원 프로필을 함께 생성한다. 가입 지점 ID는 160자, 이름은 회원 프로필 정책과 같은 30자, 휴대폰 원문은 40자, 비밀번호는 256자로 제한한다. 활성 지점이 하나이면 이전 클라이언트 호환을 위해 `branchId` 생략을 허용하지만, 여러 지점에서는 명시적 선택이 없으면 `400 VALIDATION_ERROR`로 차단한다. 서버는 최신 저장소에서 지점 활성 상태와 담당 운영자를 다시 검증하므로 존재하지 않거나 비활성·운영 불가 지점 ID를 신뢰하지 않는다. 객체·배열 등 잘못된 필드 형식과 초과 입력은 비밀번호 해시와 저장소 잠금 전에 `400 VALIDATION_ERROR`로 차단한다. 정규화된 휴대폰 번호 범위의 런타임 잠금 안에서 최신 저장소를 다시 확인하므로 같은 번호의 동시 가입은 정확히 한 건만 성공하고 나머지는 `409 CONFLICT`를 반환한다. 병합 후 저장 경계도 휴대폰·이메일 유일성과 사용자·회원 연결을 다시 검증한다.

`POST /auth/password-reset`은 같은 경로에서 세 단계를 처리한다. `action=request`는 `{ phone }`으로 6자리 인증번호 발송을 요청하고, 계정 존재 여부와 시간당 요청 제한 도달 여부를 구분하지 않는 `{ "ok": true, "next": "verify" }` 응답을 반환한다. 운영 발송은 `FINAL_JUDO_PASSWORD_RESET_SMS_WEBHOOK_URL`과 bearer secret이 모두 설정된 HTTPS webhook만 사용하며 미설정이면 계정 조회 전에 `503`으로 차단한다. `action=verify`는 `{ phone, code }`를 받아 10분 만료·최대 5회 시도 제한을 적용하고, 성공 시 10분간 한 번만 쓸 수 있는 불투명 `resetToken`을 반환한다. 인증번호는 salted PBKDF2 hash, 재설정 토큰은 SHA-256 hash로만 저장하며 감사 로그에 원문을 남기지 않는다. `action=complete`는 `{ resetToken, password }`를 받아 8자 이상 256자 이하의 새 비밀번호를 저장하고 모든 기존 세션과 남은 인증 챌린지를 폐기한다. 잘못된 본문과 초과 입력은 계정 조회 전에 `400 VALIDATION_ERROR`로 차단한다.

계정별 15분 내 로그인 비밀번호 실패 5회부터 `429`와 `Retry-After`를 반환한다. 차단된 재시도는 감사에는 남지만 제한 종료 시각을 연장하지 않으며 성공 로그인은 이전 실패 창을 초기화한다. 로그인·로그아웃·초대 수락·비밀번호·역할·계정 상태 변경은 같은 보안 잠금 아래 최신 상태를 다시 읽고 세션 발급·폐기를 저장한다. 무작위 세션 원문은 쿠키에만 한 번 제공하고 저장소에는 SHA-256 해시만 남긴다.

`POST /admin/users/invitations`는 256-bit 무작위 base64url 토큰을 생성하고 원문은 해당 생성 응답의 `invitation.token`과 `invitation.path`에서만 한 번 제공한다. 사용자 저장소에는 SHA-256 해시와 `invitedAt`만 남기며 감사 로그에는 토큰 원문·해시를 모두 남기지 않는다. 초대는 발급 후 7일에 만료된다. 원문 링크를 잃어버린 대기 초대는 `POST /admin/users/:userId/invitation-link`로 다시 발급하며, 총괄 또는 담당 지점 대표만 호출할 수 있다. 재발급 응답에서 새 원문을 한 번만 제공하고 저장된 해시를 교체하므로 이전 링크는 즉시 무효가 된다. bootstrap 사용자 목록에는 관리자에게도 초대 토큰 해시를 노출하지 않는다. `POST /auth/invitations/:token/accept`는 인증·사용자 변경과 공유하는 저장소 잠금 아래 최신 상태에서 timing-safe 해시 비교, 만료, `pending` 상태를 확인한 뒤 비밀번호 설정·초대 단일 사용·기존 세션 폐기·새 세션 발급을 한 번에 저장한다. 미일치 토큰은 사용자 대상을 만들거나 PBKDF2를 실행하지 않는다. 해시가 일치한 유효 초대의 비밀번호 정책 실패는 사용자별 최근 15분 감사 기록으로 제한하며 5회 실패 후 `429 RATE_LIMITED`와 `Retry-After`를 반환한다. 비밀번호는 12자 이상 256자 이하이고 앞뒤 공백은 자동 제거하지 않으며 정책 실패는 `400 VALIDATION_ERROR`로 거부한다. 원문 토큰·비밀번호·IP는 실패 감사에 저장하지 않는다.

`POST /admin/users/:userId/password`는 총괄 어드민 전용이다. 요청 본문은 `{ "reason": "..." }`이고, 선택적으로 `{ "temporaryPassword": "..." }`를 보낼 수 있다. 값을 지정하지 않으면 서버가 1회 표시용 임시 비밀번호를 생성해 응답의 `password.temporaryPassword`로 돌려준다. 저장소와 감사 로그에는 원문 비밀번호를 남기지 않고 랜덤 salt PBKDF2 해시, 발급 시각, 발급 사유, `auth.password_reset.complete` 감사 로그만 남긴다.

사용자 수정·역할 변경에서 코치/대표/총괄 역할 또는 담당 지점을 제거하면 해당 사용자의 수업과 담당 회원을 같은 지점의 다른 코치, 대표, 실행 총괄 순으로 자동 인계한다. 변경 기록에는 인계된 수업·회원 건수를 남긴다. 다른 대표가 없는 지점의 단독 대표는 역할 제거, 지점 해제, 계정 삭제를 `422 BUSINESS_RULE_FAILED`로 차단한다. 학부모 역할을 제거하면 회원 `guardianIds`의 역관계와 계정 `childMemberIds`를 함께 정리한다.

사용자 수정·삭제 본문은 JSON 객체여야 하며, 수정에는 실제 지원 필드가 하나 이상 필요하다. 수정의 이름·이메일·휴대폰·역할·설명·사유·비밀번호는 문자열, 지점·회원·자녀 연결은 문자열 배열이어야 한다. 이름은 80자, 이메일은 254자, 휴대폰 원문은 40자, 역할은 32자, 설명은 120자, 사유는 500자, 비밀번호는 256자로 제한한다. 중복 제거 전 지점·회원·자녀 배열은 각각 100개, 각 ID는 200자로 제한한다. 삭제 사유도 문자열 500자 이하여야 하며 숫자·배열·빈 수정 객체, 객체형 선택 필드, 혼합 연결 배열, 초과 입력은 계정·운영 연결·감사 기록을 바꾸지 않고 `400 VALIDATION_ERROR`로 거부한다.

`POST /auth/login`의 `{ "role": "coach" }` 역할 선택 데모 로그인은 개발/테스트 환경용이다. production에서는 기본 `403 FORBIDDEN`으로 차단하고, 파일럿 검증 중 명시적으로 필요할 때만 `FINAL_JUDO_ENABLE_DEMO_LOGIN=1`로 허용한다. 세션 쿠키에는 사용자 ID가 아닌 256-bit 무작위 토큰만 저장하고 서버 저장소에는 SHA-256 토큰 해시·사용자·만료·폐기 상태만 보관한다. 쿠키는 `httpOnly`, `sameSite=lax`를 사용하며 기본 8시간, 로그인 상태 유지 선택 시 30일 만료를 적용하고 production에서는 `secure`를 적용한다. 비밀번호·역할·지점 범위 변경과 계정 삭제 시 기존 세션을 폐기한다. production 서버는 `x-user-id` 헤더를 세션 대체 수단으로 인정하지 않는다.

로컬 개발·Simulator 전용 자동로그인의 `next`는 2,048자 이내의 같은 오리진 절대 경로만 허용한다. 프로토콜 상대 URL, 절대 URL, 역슬래시가 포함된 경로, 길이 초과·파싱 실패 값은 `/app/dashboard`로 대체하며 production에서는 자동로그인 경로를 제공하지 않는다.

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

지점 생성·수정·대표 배정은 인증·총괄 역할·선택 지점을 먼저 확인하고 JSON 본문은 공통 지점 상태 잠금 밖에서 읽는다. 저장 직전에는 같은 잠금 안에서 최신 권한·선택 지점·지점명·대표 계정을 다시 검증한다. 생성·수정 본문은 JSON 객체의 문자열 필드, 운영 설정은 boolean 필드를 받으며 지점명 80자, 지역 100자, 시간대 64자, 수정 사유 500자, 대표 사용자 ID 200자 상한을 적용한다. 객체·배열형 값과 초과 입력은 지점·대표·감사 기록을 바꾸지 않고 `400 VALIDATION_ERROR`로 차단한다. 같은 이름의 동시 생성 또는 생성·이름 변경 교차 요청은 정확히 한 요청만 반영한다. 서로 다른 지점 생성은 모두 보존하며 변경 기록은 UUID 기반 감사 ID를 사용한다.

지점 수정은 `reason`을 필수로 받고, `status: inactive`로 비활성화한다. 운영 설정은 출석 수정 사유 정책과 기본 지점 운영값을 포함하며, 요청 기능용 설정값은 화면에 노출하지 않는다.

지점 역할 사용자는 배정된 지점만 받는다. 총괄 어드민은 전체 지점을 받는다.

## 5. 사용자/RBAC

| Method | Path | 권한 | 감사 | 설명 |
| --- | --- | --- | --- | --- |
| `GET` | `/admin/users` | `users.manage` | 민감 필터 시 예 | 전체 사용자 목록 |
| `POST` | `/admin/users/invitations` | `users.manage` 또는 대표 지점 범위 | 예 | 사용자 초대 |
| `POST` | `/admin/users/:userId/invitation-link` | `users.manage` 또는 대표 지점 범위 | 예 | 대기 초대 링크 재발급 |
| `POST` | `/admin/users/:userId/approve-invitation` | `users.manage` 또는 대표 지점 범위 | 예 | 대기 초대 승인·임시 비밀번호 발급 |
| `PATCH` | `/admin/users/:userId` | `users.manage` | 예 | 사용자 상태/프로필 수정 |
| `DELETE` | `/admin/users/:userId` | `users.manage` | 예 | 사용자 삭제 및 운영 연결 인계 |
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

사용자 초대는 JSON 객체의 문자열 이름·이메일·휴대폰·역할과 문자열 지점 ID 배열만 허용하며 객체·배열형 필드는 저장 전에 `400 VALIDATION_ERROR`로 차단한다. 이름은 80자, 이메일은 254자, 휴대폰 원문은 40자, 역할은 32자, 중복 제거 전 지점 배열은 100개, 지점 ID는 200자로 제한한다. 지점 ID는 길이 검증 후 공백 제거와 중복 정규화를 거쳐 권한·선택 지점 범위를 검사하며, 초대 UI도 이름·이메일·휴대폰에 같은 상한을 사용한다. 사용자·감사 ID는 UUID 기반 런타임 ID를 사용해 서로 다른 동시 초대를 모두 보존하고, 같은 휴대폰 또는 이메일의 동시 초대는 초대 보안 잠금 안에서 정확히 한 요청만 반영한다.

대기 초대 승인은 초대 생성·링크 재발급·수락과 같은 보안 잠금 안에서 최신 승인자 권한, 선택 지점, 대상의 `pending` 상태를 다시 확인한다. 같은 초대의 동시 승인 요청은 정확히 하나만 `200`과 1회 표시 임시 비밀번호를 받고 다른 요청은 `409 BUSINESS_RULE_FAILED`를 반환한다. 성공한 한 건만 UUID 기반 `user.invite.approve` 감사 기록을 남기며 임시 비밀번호 원문은 저장소·감사 로그에 기록하지 않는다.

비밀번호 재발급은 문자열 사유와 선택 문자열 임시 비밀번호, 역할 변경은 문자열 역할·사유와 문자열 지점 ID 배열만 허용한다. 비밀번호 재발급·역할 변경 사유는 500자, 임시 비밀번호는 256자, 역할은 32자, 중복 제거 전 지점 배열은 100개, 지점 ID는 200자로 제한한다. 객체·배열형 값과 초과 입력은 `400 VALIDATION_ERROR`로 차단하고 기존 비밀번호·역할·담당 지점·감사 기록을 변경하지 않는다. 정상 변경은 인증 보안 잠금 안에서 최신 계정·관리자·대표 인계 조건을 다시 확인하고 기존 사용자 세션을 폐기한다.

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
조회 사유는 500자, 검색어는 120자, 실제 지점 ID는 200자로 제한한다. 초과 입력과 허용되지 않은 액션·결과·날짜 범위는 계정 보안 잠금과 지점 조회, `audit_logs.read` 기록 전에 `400 VALIDATION_ERROR`로 거부하며, 변경 기록 화면의 검색 입력도 같은 120자 상한을 사용한다.
`from`이 `to`보다 늦은 범위는 빈 목록으로 처리하지 않고 `400 VALIDATION_ERROR`로 거부한다.
결제·운영 CSV 내보내기와 변경 기록 조회는 계정 보안 잠금 안에서 최신 세션·역할·지점 범위를 다시 확인한다. CSV 내보내기는 각 요청을 별도 감사하고, 같은 변경 기록 조회의 동시 재시도는 잠금 안에서 중복을 판정해 한 건만 남긴다. 감사·내보내기 대상 ID는 UUID 기반 런타임 ID를 사용한다.

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

파일럿 준비·이슈·운영 로그 쓰기 본문은 JSON 객체여야 한다. 식별자·상태·담당자·증빙·설명은 문자열, 운영 수치는 숫자여야 하며 `branchId`는 문자열 또는 `null`만 허용한다. 준비 항목·지점 ID는 200자, 담당자는 80자, 이슈 제목·화면은 120자, 이슈 상세는 2,000자, 준비/운영 확인 메모·우회책·특이사항은 1,000자, 모바일 출석 확인 기록은 500자로 제한한다. 잘못된 타입과 초과 입력은 정규화·공통 파일럿 상태 잠금·지점 조회 전에 `400 VALIDATION_ERROR`로 차단되어 파일럿 상태와 감사 기록을 바꾸지 않는다. 관리자 설정 화면도 같은 상한을 사용한다. 네 쓰기 경로는 공통 파일럿 상태 잠금 안에서 최신 세션·총괄 역할·선택 지점 범위를 다시 확인하고 저장한다. 같은 준비 항목·이슈·지점/일자의 동시 변경은 직렬화하며 이슈·운영 로그·감사 ID는 충돌 방지 런타임 ID를 사용한다.

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
| `PATCH` | `/branches/:branchId/members/:memberId/counseling-notes/:noteId` | 대표/총괄 또는 작성 코치 | 예 | 상담/주의 메모 수정 |
| `DELETE` | `/branches/:branchId/members/:memberId/counseling-notes/:noteId` | 대표/총괄 또는 작성 코치 | 예 | 상담/주의 메모 삭제 |
| `GET` | `/me/children` | guardian relation | 아니오 | 연결 자녀 목록 |

코치 회원 DTO는 이름, 띠, 레벨, 나이대, 주의사항, 회원권 상태 요약만 포함한다.

회원 생성은 본문이 JSON 객체이고 지원 필드가 문자열인지 먼저 확인하며, 생년월일은 실제 달력에 존재하는 `YYYY-MM-DD`인지 검증한다. 잘못된 타입이나 존재하지 않는 날짜는 저장 전에 `400 VALIDATION_ERROR`로 차단한다. 등록·수정은 공통으로 이름·레벨·띠를 30자, 비상 연락처를 40자, 주소를 100자로 제한하고, 주의사항 수정은 8개·항목당 80자로 제한한다. 운영 화면 입력도 같은 상한을 사용한다. 회원·감사 ID는 UUID 기반 런타임 ID를 사용해 같은 지점의 동시 등록도 서로 다른 ID와 감사 기록으로 모두 보존한다. `createdAt`, `statusChangedAt`은 서버 시각으로 저장하고, 생성 상태가 `withdrawn`이면 `withdrawnAt`도 함께 저장한다. 회원 수정 payload는 운영자 권한에서 `status`, `ageGroup`, `name`, `belt`, `level`, `emergencyContact`, `alerts`, `gender`, `birthDate`, `address`를 받으며 문자열 필드와 문자열 주의사항 배열을 정규화 전에 검증한다. 객체형 값이나 존재하지 않는 생년월일은 기존 값을 지우지 않고 `400 VALIDATION_ERROR`로 차단한다. 수정은 회원별 잠금 안에서 최신 세션·지점·본인/자녀 관계와 연결 회원 계정 휴대폰 유일성을 다시 확인하고 직렬화하며 UUID 기반 `member.update` 감사 ID를 사용한다. 상태가 바뀌면 `statusChangedAt`을 서버 시각으로 갱신하고, `withdrawn` 전환 시 `withdrawnAt`을 저장하며, 다른 상태로 복귀하면 `withdrawnAt`을 비운다. 회원 본인과 학부모는 본인/연결 자녀 관계가 검증된 경우 `emergencyContact`만 변경할 수 있고, 상태/수련 정보/주의사항 변경은 `403 FORBIDDEN`으로 차단한다. 현재 사용자가 읽을 수 없는 다른 가족·지점 회원의 수정 대상은 존재하지 않는 회원과 동일한 `404 NOT_FOUND`로 처리하고, 담당 코치처럼 회원을 읽을 수 있지만 수정 권한이 없는 경우에는 `403 FORBIDDEN`을 유지한다. 모든 실제 변경은 `member.update` 감사 로그에 before/after diff로 기록한다.

보호자 연결·변경·해제 payload는 JSON 객체의 200자 이하 문자열 `guardianUserId`를 받으며 객체·배열형 값과 초과 입력은 관계를 변경하지 않고 `400 VALIDATION_ERROR`로 차단한다. 서버는 대표/총괄 권한과 회원 지점 스코프를 본문보다 먼저 확인하고, JSON 본문은 공통 관계 잠금 밖에서 읽는다. 저장 직전에는 잠금 안에서 최신 세션·권한·지점·연령·활성 학부모 상태를 다시 확인한 뒤 회원의 `guardianIds`와 학부모 계정의 `childMemberIds`를 함께 갱신한다. 관리 범위 밖 회원은 존재하지 않는 회원과 같은 `404 NOT_FOUND`, 연결할 수 없는 실재 학부모와 존재하지 않는 학부모는 같은 `422 BUSINESS_RULE_FAILED`로 처리한다. 연결되지 않은 학부모 해제는 계정 존재 여부와 관계없이 멱등 성공해 사용자 ID 오라클을 만들지 않는다. 중복 연결도 멱등 처리하며 실제 변경은 UUID 기반 ID의 `member.update` 감사 로그에 남겨 서로 다른 회원의 동시 연결 기록도 모두 보존한다.

상담/주의 메모 작성은 회원 카드 높이를 바꾸지 않는 독립 다이얼로그에서 진행한다. 대표와 총괄은 관리 지점의 메모를 수정·삭제할 수 있고, 코치는 담당 회원에게 자신이 작성한 메모만 수정·삭제할 수 있다. 변경 시 최신 세션·선택 지점·담당 회원·작성자 권한을 공통 잠금 안에서 다시 확인한다. 감사 로그에는 본문 전문을 저장하지 않고 유형, 공개 범위, 본문 길이와 변경 여부만 기록한다.

상담/주의 메모 payload는 JSON 객체의 2,000자 이하 문자열 `body`, `noteType`(`general`, `caution`, `progress`, `follow_up`), `visibility`(`staff_only`, `coach_visible`, `guardian_visible`, `member_visible`)를 받는다. 객체형 본문, 비문자 유형·공개 범위, 2,000자 초과 본문은 메모·감사 기록을 만들지 않고 `400 VALIDATION_ERROR`로 차단한다. 작성 UI도 동일한 본문 상한을 사용한다. 메모와 감사 ID는 UUID 기반 런타임 ID를 사용해 같은 회원에게 동시에 작성한 메모도 모두 보존한다. 코치는 담당 회원에게 `coach_visible`, `guardian_visible`, `member_visible` 메모를 작성할 수 있다. 회원 계정은 연결된 본인 프로필의 `member_visible` 메모만, 학부모 계정은 자녀 프로필의 `guardian_visible` 메모와 연결된 본인 프로필의 `member_visible` 메모만 조회한다. 감사 로그에는 메모 본문 원문을 저장하지 않는다.

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
| `POST` | `/me/attendance-qr` | coach/owner/admin 담당 수업·지점 범위 | 아니오 | 수업 출석 QR 발급 |
| `POST` | `/attendance-qr/scan` | member 또는 guardian 본인 수련 프로필 | 예 | QR 명단 자동 등록·출석 |
| `POST` | `/promotions` | coach/owner/admin 담당 회원·지점 범위 | 예 | 승급 심사 등록 |
| `PATCH` | `/promotions/:promotionId` | coach/owner/admin 담당 회원·지점 범위 | 예 | 승급 심사 결과 기록 |

수업 생성과 수정은 본문이 JSON 객체인지 확인하고 수업명·레벨·연령·코치·시간·장소는 문자열, 정원은 숫자, 등록 회원 목록은 문자열 배열인지 검증한 뒤 정규화한다. 수업명·장소는 80자, 레벨은 40자, 코치·회원 ID는 200자, 시간 문자열은 64자, 원본 등록 회원 배열은 정원 상한과 같은 80개로 제한한다. 잘못된 타입·길이나 존재하지 않는 날짜·시간은 저장 전에 `400 VALIDATION_ERROR`로 차단하고, 운영 화면의 수업명·레벨·장소 입력도 같은 상한을 사용한다. 수정은 지원 필드가 하나 이상 있어야 하며 필수 문자열을 빈 값으로 바꿀 수 없다. 수업·감사 ID는 UUID 기반 런타임 ID를 사용해 같은 지점의 동시 수업 생성도 서로 다른 ID와 감사 기록으로 모두 보존한다. 같은 수업 수정은 수업별 잠금 안에서 최신 세션·역할·지점·코치·등록 회원 상태를 다시 확인하고 직렬화해 두 정상 요청과 감사 기록을 모두 보존한다.

승급 심사 생성과 결과 기록은 JSON 객체와 문자열·숫자 필드를 정규화 전에 검증하고 객체형 회원 ID·메모나 비유한 점수는 저장 전에 `400 VALIDATION_ERROR`로 차단한다. 회원 ID는 200자, 회원·학부모에게 공개되는 생성·결과 메모는 500자로 제한하며 초과 요청은 심사·회원 띠·감사 기록을 바꾸지 않는다. 생성 시 둘째·넷째 금요일, 현재 띠의 정확한 다음 단계, 담당 회원·지점 범위와 진행 중 심사 중복을 검사한다. 결과 기록은 심사일 도래, 최신 회원 띠, 미처리 상태를 잠금 안에서 다시 확인한다. 승급 심사·감사 ID는 UUID 기반 런타임 ID를 사용해 서로 다른 회원의 동시 등록도 모두 보존하고, 같은 회원의 동시 등록 또는 같은 심사의 동시 결과 기록은 정확히 한 요청만 반영한다.

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

`items`는 1~200개 JSON 객체 배열이며 각 항목의 `memberId`·`status`는 문자열, `note`와 최상위 `reason`은 문자열 또는 `null`이어야 한다. `memberId`는 비어 있지 않은 200자 이하, 회원별 메모·공통 사유·별도 수정 사유는 80자 이하로 제한한다. 같은 회원을 한 요청에 중복해 보낼 수 없으며 잘못된 구조·타입·길이·중복은 기존 출석·감사 기록을 변경하지 않고 `400 VALIDATION_ERROR`로 거부한다. `items[].note`가 있으면 해당 회원의 출석 메모로 저장하고, 없으면 최상위 `reason`을 공통 수정 사유로 사용한다. 출석 저장과 별도 사유 기록 모두 `audit_logs.before/after.note`에 이전/변경 사유를 남긴다.

일괄 출석과 별도 수정 사유 요청은 인증·역할·지점·담당 수업·수업 시작 시각을 먼저 확인한 뒤 JSON 본문을 공용 출석 잠금 밖에서 파싱·검증한다. 실제 저장 직전에는 같은 잠금 안에서 최신 계정 권한과 수업 상태를 다시 확인해 큰 본문이 다른 출석 저장을 막거나 검증과 저장 사이의 권한 변경이 우회되지 않게 한다.

수업 출석 QR은 수업 시작·종료 시각과 관계없이 담당 코치, 대표, 총괄 어드민이 발급할 수 있으며 발급된 QR 자체는 5분 동안 유효하다. 회원 또는 학부모의 성인 본인 수련 프로필이 스캔하면 최신 발급자 권한과 같은 지점의 활성·체험 회원 여부를 다시 확인한다. 수업 명단에 없던 회원은 공용 출석 잠금 안에서 명단에 자동 추가한 뒤 출석과 QR 사용 기록을 함께 저장하며 `class.update`와 `attendance.update` 감사 기록을 남긴다. 다른 회원·자녀 대리 출석, 다른 지점, 비활성 회원, 만료·재사용 QR은 계속 차단한다.

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
| `POST` | `/payments/:paymentId/collection-request` | self/relation | 예 | 성인 회원 본인 또는 학부모의 자녀 납부 요청 접수 |
| `POST` | `/payments/:paymentId/online-checkout` | `payments.write` | 예 | 온라인 결제 요청 생성 |
| `POST` | `/payments/:paymentId/recurring-agreement` | `payments.write` | 예 | 정기결제 약정 생성 |
| `DELETE` | `/payments/:paymentId/recurring-agreement` | `payments.write` | 예 | 정기결제 약정 해지 |
| `POST` | `/payments/webhook` | provider secret | 예 | provider 결제 성공/실패/환불 webhook |
| `POST` | `/payments/:paymentId/refund` | `payments.refund` | 예 | 환불/취소 처리 |
| `GET` | `/me/payments` | self/relation | 아니오 | 본인/자녀 결제 상태 |
| `GET` | `/exports/payments` | `exports.create` | 예 | 결제 CSV 내보내기 |
| `GET` | `/exports/operations` | `exports.create` | 예 | 지점 운영 리포트 CSV 내보내기 |

수기 결제 기록 payload는 `discountAmount`를 받을 수 있고, 서버는 결제·할인 금액이 0원 이상의 안전한 원 단위 정수인지, 할인 금액이 결제 금액을 초과하지 않는지, 납부일과 만료일이 실제 달력에 존재하는 `YYYY-MM-DD`인지, 만료일이 납부일보다 앞서지 않는지를 생성·수정에 동일하게 검증한다. 수기 등록 상태는 `scheduled`, `paid`, `overdue`, `cancelled`, `refunded`, `expiringSoon`만 허용하며, 환불액 없는 `partially_refunded` 상태를 직접 만들 수 없다. `cancelled` 또는 `refunded` 상태로 생성할 때는 공백이 아닌 `reason`이 필수이고, 서버는 앞뒤 공백을 제거한 사유와 처리 시각을 결제의 `refundReason`/`refundedAt`, 최초 `statusHistory`, `payment.create` 감사 스냅샷에 저장한다. 감사용 `reason`은 Payment 루트 필드에 중복 저장하지 않는다. `refunded` 직접 등록은 결제 금액 전체를 환불액으로 기록하고, 금액이 0원이어도 환불 완료 상태 자체를 환불 이력으로 간주해 직접 수정·삭제를 차단한다. 결제 생성은 UUID 기반 ID와 `statusHistory`에 최초 상태, 처리자, 처리 시각, 사유를 저장한다. 클라이언트는 `POST /branches/:branchId/payments`에 16~128자의 `Idempotency-Key`를 반드시 보내며, 헤더가 없거나 형식이 잘못되면 서버가 `400 VALIDATION_ERROR`로 차단한다. 서버는 처리자·지점 범위의 `payment.create` 감사 기록에 키, 생성 스냅샷과 정규화 payload의 SHA-256 확인값을 보관한다. 취소·환불 완료 생성의 확인값에는 정규화한 사유를 포함하고, 일반 상태 생성은 기존 사유 없는 확인값 형식을 유지한다. 같은 키와 같은 payload의 재시도는 새 결제를 만들지 않고 기존 결과와 `Idempotency-Replayed: true` 응답 헤더를 반환한다. 같은 키에 다른 payload를 보내거나 이미 삭제된 원본을 재시도하면 `409 IDEMPOTENCY_CONFLICT`로 차단한다. `PATCH /payments/:paymentId`는 회원권명, 상태, 금액, 할인, 납부일, 만료일과 필수 `reason`을 정정하고 `payment.update` 변경 기록을 남긴다. 금액·할인·회원권명·날짜만 정정하면 감사 기록만 남기며, 실제 상태가 바뀐 경우에만 `statusHistory`에 `status_changed`를 추가한다. `DELETE /payments/:paymentId`는 필수 `reason`과 취소 시각·사유·상태 이력을 포함한 삭제 전 스냅샷을 `payment.delete` 변경 기록에 남긴 뒤 오등록 건을 제거한다. 두 API는 대표/총괄과 선택 지점 범위를 확인하며, 온라인 결제·정기결제·환불 금액 또는 환불 완료/부분 환불 상태 이력이 있는 기록은 직접 수정/삭제하지 않고 기존 결제 수명주기 API를 사용한다. 환불 금액이 없는 수기 취소 기록은 사유를 남겨 계속 정정하거나 삭제할 수 있다. 동일 결제의 수기 수정·삭제, 온라인 결제 요청, 환불은 `payment-mutation:{paymentId}` 잠금으로 직렬화하고 잠금 안에서 최신 결제와 권한을 다시 확인한다. provider webhook은 전역 event ID 유일성을 보장하기 위해 모든 webhook 요청이 공유하는 잠금에서 최신 결제와 처리 이력을 다시 확인한다. 같은 결제 레코드의 남은 stale 동시 변경은 자동 병합하지 않고 `409 CONCURRENT_MODIFICATION`으로 반환한다. 환불/취소 payload는 `reason`을 필수로 받으며, 환불 금액은 1원 이상의 안전한 정수 원화만 허용한다. `paid`·`partially_refunded` 결제만 환불할 수 있고, `scheduled`·`overdue`·`expiringSoon` 결제만 취소할 수 있다. 부분 환불은 실제 환불 금액과 함께 `partially_refunded`, 전액 환불은 `refunded`, 예정/미납/만료 예정 결제 취소는 `cancelled` 상태로 저장한다. 환불/취소는 결제의 `statusHistory`에 상태 변경 이벤트를 추가하고, 전후 상태와 사유는 `payment.refund` 변경 기록에도 남긴다.

수기 결제 등록은 본문이 JSON 객체인지 확인하고 회원·회원권·상태·날짜·사유·회비 상품·혜택 필드는 문자열, 결제·할인 금액은 숫자인지 검증한 뒤 문자열 정규화와 금액 계산을 수행한다. 환불·취소도 사유는 문자열, 금액은 숫자, 취소 여부는 boolean인지 먼저 확인한다. 등록·수정 회원권명은 100자, 등록·수정·삭제·환불/취소 사유는 500자, 회원·회비 상품 식별자는 200자로 제한한다. 객체·배열이나 상한을 초과한 입력은 저장소 잠금과 쓰기 전에 `400 VALIDATION_ERROR`로 차단하며 결제·상태 이력·감사 기록을 변경하지 않는다.

가족 납부 요청도 JSON 객체와 결제자 이름·휴대전화·납부 방법을 먼저 검증하고, 이름 50자·휴대전화 원문 20자·방법 코드 32자·방법명 60자 상한을 초과한 본문은 조용히 자르지 않고 결제·감사 기록을 바꾸지 않은 채 `400 VALIDATION_ERROR`로 거부한다. 인증·역할·지점·본인/자녀 관계·결제 가능 상태를 먼저 확인한 뒤 본문은 결제 잠금 밖에서 파싱·검증하고, 같은 결제의 납부 요청과 운영자 수기 수정·삭제·온라인 요청·환불·정기결제 변경은 모두 `payment-mutation:{paymentId}` 잠금을 공유하며 저장 직전 최신 권한·관계·결제 상태를 다시 확인한다. 따라서 느린 납부 요청 본문이 운영자 정정을 막지 않고, 학부모 요청과 운영자 정정이 동시에 도착해도 두 변경과 각각의 `payment.update` 감사 기록을 보존한다. 본인·자녀 관계가 없는 결제는 존재하지 않는 결제와 동일한 `404 NOT_FOUND`로 처리해 다른 가족의 결제 존재 여부를 노출하지 않는다. 관계가 확인된 유소년·청소년 본인 계정에는 학부모 결제 필요 같은 상태 안내를 계속 제공한다.

provider webhook은 전역 event ID 공유 잠금을 먼저 얻고 그 안에서 `payment-mutation:{paymentId}` 잠금을 얻는다. 이 고정 순서는 같은 event ID의 교차 결제 재사용을 막으면서 웹훅과 수기 수정·환불·온라인 요청·정기결제 변경이 같은 결제 상태를 동시에 덮어쓰지 않게 한다.

같은 키의 동시 처리는 런타임 저장소 공통 잠금으로 직렬화한다. JSON 개발 저장소는 파일시스템 operation lock과 쓰기 직전 최신 파일 병합을 사용하고, PostgreSQL 운영 저장소는 `app_runtime_state` 테이블·상태 키·요청 범위를 조합한 트랜잭션 advisory lock을 사용해 서로 다른 서버 인스턴스도 같은 결제를 동시에 생성하지 못하게 한다. PostgreSQL 잠금 안의 read/write는 같은 DB 연결과 트랜잭션을 사용해 transaction pooling 환경에서도 커밋·롤백과 함께 잠금이 해제된다.

배포는 선택 헤더와 분산 잠금을 이해하는 서버를 먼저 반영한 뒤 클라이언트를 반영한다. advisory lock은 스키마나 저장 데이터를 변경하지 않으므로 롤백 시 클라이언트를 먼저 이전 버전으로 되돌리고 서버 잠금 코드를 제거해도 DB 마이그레이션 롤백이 필요 없다. `IDEMPOTENCY_CONFLICT`가 비정상적으로 증가하면 클라이언트의 키 재사용 범위를 먼저 확인하고, 저장 완료 여부가 불명확한 결제는 새 키로 자동 재등록하지 않는다.

온라인 결제 요청은 예정/미납/만료 예정/부분 환불 결제에 대해 대표/총괄이 생성한다. `POST /api/v1/payments/{paymentId}/online-checkout`은 provider-neutral `onlinePayment` 메타를 결제에 저장하고 `payment.online_checkout.create` 감사 로그를 남긴다. 운영 PG/VAN 계약 전에는 `FINAL_JUDO_PAYMENT_PROVIDER`가 비어 있으면 mock provider로 동작하며, `FINAL_JUDO_PAYMENT_CHECKOUT_BASE_URL`이 없으면 앱 내부 리허설 URL을 만든다. 결제창 기본 주소를 설정하면 경로·쿼리·fragment·자격증명이 없는 HTTPS origin이어야 하며, 형식이 잘못되면 온라인 결제 요청을 저장하지 않고 `503 PAYMENT_RUNTIME_NOT_READY`로 차단한다.

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

`POST /api/v1/payments/webhook`은 `x-final-judo-payment-webhook-secret` 헤더를 검증한다. production에서는 `FINAL_JUDO_PAYMENT_WEBHOOK_SECRET`이 없으면 `503 PAYMENT_WEBHOOK_NOT_CONFIGURED`로 차단하고, 개발/테스트에서는 `final-judo-dev-webhook-secret` fallback으로 smoke 테스트를 수행한다. payload는 `{ "providerPaymentId": "...", "providerEventId": "...", "event": "paid" | "failed" | "refunded", "occurredAt": "2026-07-14T04:00:00.000Z", "amount": 30000, "receiptId": "...", "receiptUrl": "...", "reason": "..." }` 형태다. provider 결제·이벤트·영수증 식별자는 문자열이며 각각 160자 이하로 제한한다. `receiptUrl`은 2048자 이하의 자격증명 없는 HTTPS URL만 허용하고, 형식이 잘못된 메타데이터는 결제 상태·이력·감사 로그를 바꾸지 않고 `400 VALIDATION_ERROR`로 차단한다. `providerEventId`는 모든 이벤트에 필수인 전역 유일값이며 provider가 body가 아니라 header로 보낼 때는 `x-final-judo-payment-event-id`도 허용한다. 같은 결제에 이미 처리한 ID는 상태 이력과 감사 로그를 추가하지 않고 `{ "duplicate": true }`로 응답하며, 다른 결제에 처리된 ID는 `409 PROVIDER_EVENT_CONFLICT`로 차단한다. `paid` 이벤트는 안전한 정수 원화 `amount`가 필수이고 최초 결제 요청 금액과 정확히 일치하지 않으면 `422 PAYMENT_AMOUNT_MISMATCH`로 차단한다. 첫 이벤트 이후의 후속 이벤트는 유효한 `occurredAt`이 필수이며, 이미 처리한 최신 webhook보다 과거이면 `409 OUT_OF_ORDER`로 차단한다. 전액 환불·취소 상태와 환불 이력이 있는 결제는 `paid` 또는 `failed`로 역전할 수 없고 `409 INVALID_TRANSITION`을 반환한다. 성공 이벤트는 결제 상태를 `paid`로 바꾸고 receipt 메타를 저장하며, 실패 이벤트는 결제 상태를 유지하고 실패 사유를 `onlinePayment.failureReason`에 저장한다. 환불 webhook은 안전한 정수 원화 금액만 허용하고 `refundedAmount`, `refundReason`, `statusHistory`와 `payment.webhook` 감사 로그를 남긴다.

정기결제 약정은 완료/납부 예정/미납/만료 예정/부분 환불 결제에서 대표/총괄이 생성한다. `POST /api/v1/payments/{paymentId}/recurring-agreement`는 `{ "nextBillingDate": "2026-07-16", "billingDayOfMonth": 16 }`를 선택적으로 받고, 없으면 회원권 `expiresAt` 다음 날과 1-28일 범위의 청구일을 자동 계산한다. 존재하지 않는 달력 날짜, 1-28 범위 밖 청구일, 비객체 JSON은 `400 VALIDATION_ERROR`로 차단한다. mock provider에서는 즉시 `active`, 외부 provider에서는 `pending` 상태로 저장한다. 해지는 `DELETE /api/v1/payments/{paymentId}/recurring-agreement`에 500자 이내 문자열 `{ "reason": "..." }`를 보내며 사유가 없거나 비문자이면 `400 VALIDATION_ERROR`로 차단한다. 생성/해지는 수기 수정·삭제, 온라인 요청, 환불과 같은 `payment-mutation:{paymentId}` 잠금을 사용하고 잠금 안에서 최신 세션·권한·지점·결제·약정 상태를 다시 확인한다. 동시 생성은 한 건만 성공하고 나머지는 `409`, 동시 해지는 한 건만 성공하고 나머지는 `422`이며 성공한 작업만 `recurringAgreement`, `statusHistory`, `payment.recurring_agreement.create` 또는 `payment.recurring_agreement.cancel` 감사 로그를 한 번 남긴다. 교차 프로세스 저장 충돌은 `409 CONCURRENT_MODIFICATION`으로 반환한다.

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
| `PATCH` | `/notices/:noticeId` | `notices.publish` | 예 | 제목·본문·중요 여부·역할 audience 수정. 대표/총괄은 audience 수정 가능, 코치는 기존 audience 유지. 반·개인 대상은 생성 후 수정 불가 |
| `POST` | `/me/notices/:noticeId/read` | self/relation | 예 | 읽음 처리 |
| `POST` | `/me/notices/bulk-read` | self/relation | 예 | 여러 공지 읽음 처리 |
| `GET` | `/notifications/push-config` | 인증 | 아니오 | VAPID 공개키/구독 가능 상태 조회. 활성 구독 수는 대표/총괄은 담당 지점 범위, 코치/회원/학부모는 본인 구독 범위로만 반환 |
| `POST` | `/notifications/subscriptions` | 인증 | 예 | 현재 브라우저 PushSubscription 저장. HTTPS endpoint(2,048자 이하), key(512자 이하·Base64URL), 만료값, userAgent 타입·길이를 검증하고 응답의 활성 구독 수는 역할별 스코프만 반환 |
| `DELETE` | `/notifications/subscriptions` | 인증 | 예 | 현재 사용자 PushSubscription 비활성화. 등록과 동일하게 HTTPS endpoint 2,048자 상한을 검증한다. 회원/학부모는 항상 켜짐 정책으로 비활성화하지 않고 `disabledAt: null`과 `enforcedAlwaysOn: true`를 반환하며 활성 구독 수는 본인 범위만 반환 |
| `POST` | `/branches/:branchId/notices/:noticeId/push` | `notices.publish` (owner/admin/coach 담당 범위) | 예 | 공지 대상자 구독에 서버 푸시 발송 |
| `GET` | `/internal/notification-outbox` | `Authorization: Bearer CRON_SECRET` | 아니오 | 만료 lease 복구와 대기/재시도 푸시 작업 처리. 일반 사용자 세션으로 호출 불가 |

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

공지 생성 요청은 JSON 객체와 `title`/`body` 문자열, `important` boolean, `audience`/`targetClassIds`/`targetMemberIds` 문자열 배열 형식을 대상 계산과 문자열 정규화 전에 검증한다. 잘못된 타입은 공지·감사 기록·outbox를 만들지 않고 `400 VALIDATION_ERROR`로 거부한다. 공지와 `notice.create`/`notification.dispatch` 감사 ID는 UUID 기반 런타임 ID를 사용해 같은 시각의 동시 생성도 서로 덮어쓰지 않는다.

`important`는 운영자가 즉시 확인해야 하는 공지를 표시하는 선택값이며, UI와 푸시 제목에 중요 상태를 노출한다. `audience`는 역할 대상(`all`, `member`, `guardian`, `coach`, `owner`, `admin`)을 뜻한다. `targetClassIds`가 있으면 해당 반 수강생/보호자/담당 코치 범위로 좁히고, `targetMemberIds`가 있으면 지정 회원 본인/보호자/담당 코치 범위로 좁힌다. 둘 다 없으면 대표/총괄은 선택 지점 전체 역할 대상 공지로 발행하고, 코치는 담당 수업/담당 회원 범위의 회원·학부모 공지로 좁혀 발행한다. 서버는 대상 반/회원이 공지 지점에 속하는지 검증하고, 코치가 담당 범위 밖 반/회원을 지정하면 거부한다. 공지 수정에서 대표/총괄은 역할 `audience`를 바꿀 수 있지만 코치는 기존 audience 집합을 유지해야 한다. 순서와 중복만 다른 같은 집합은 변경으로 보지 않는다. 반·개인 대상은 생성 후 수정하지 않으며 PATCH에 `targetClassIds` 또는 `targetMemberIds`를 보내면 `400 VALIDATION_ERROR`를 반환한다. 제목·본문·중요 여부·audience 중 하나가 실제로 바뀌면 `readByUserIds`를 초기화해 대상자의 알림함에 다시 미확인으로 표시하고, 동일 내용 재저장은 읽음 상태를 보존한다. 공지 수정과 단일/일괄 읽음 쓰기는 같은 저장소 락으로 직렬화해 동시 요청의 마지막 작업과 최종 읽음 상태를 일치시킨다. 잘못된 title/body/audience/important 타입은 `400`으로 거부한다. `notice.update` 감사 로그는 본문 원문을 저장하지 않고 제목, 본문 변경 여부와 길이, 중요 여부, audience, 읽음 수와 초기화 여부만 기록한다. 수정 요청 자체는 휴대폰 푸시를 자동 재발송하지 않으며 재발송은 별도 push API를 사용한다. `createdByUserId`는 작성자가 회원/학부모 대상 공지를 발행한 뒤에도 자기 공지 목록에서 계속 볼 수 있게 유지하는 메타데이터다. 학부모/회원 읽음 처리는 관계가 맞는 공지만 허용한다. `POST /me/notices/bulk-read`는 `{ "noticeIds": ["notice-1"] }`를 받아 최대 50건까지 현재 사용자가 읽을 수 있는 공지만 일괄 처리하고, 포함된 공지가 없거나 스코프 밖이면 실패한다.

공지 작성·수정은 제목 120자, 본문 5,000자, 역할 대상 원본 8개, 수업 대상 100개, 회원 대상 500개, 각 대상 ID 200자로 제한한다. 작성 화면도 같은 제목·본문 상한을 적용하며, 제한을 넘긴 요청은 공지·감사·outbox를 만들거나 기존 공지를 바꾸지 않고 `400 VALIDATION_ERROR`로 거부한다.

단일·일괄 읽음 API는 존재하지 않는 공지와 현재 사용자가 읽을 수 없는 다른 지점·가족·개인 공지를 모두 동일한 `404 NOT_FOUND`로 처리한다. 응답에는 누락·차단 공지 ID를 포함하지 않으며, 일괄 요청에 접근 불가 항목이 하나라도 있으면 어떤 공지도 부분 읽음 처리하지 않는다. 일괄 요청은 중복 제거 전 원본 배열을 최대 50건으로 제한하고 모든 ID가 비어 있지 않은 200자 이하 문자열인지 먼저 검증한다. 비문자 항목을 조용히 버리지 않으며 잘못된 입력과 초과 요청은 어떤 공지도 읽음 처리하지 않는다.

앱 알림함과 휴대폰 푸시는 같은 대상 산정 결과를 사용한다. 공지는 작성/발행되는 즉시 대상 회원/학부모 알림함에 미확인으로 표시된다. 서버는 공지, `dispatchState: requested` 감사 기록, 구독별 durable outbox 작업을 먼저 한 번에 저장한 뒤 외부 푸시를 호출한다. 각 작업은 lease, revision, 지수 backoff, 최대 5회 시도, `sent`/`disabled`/`dead`/`cancelled` 상태를 가지며 요청 중 전송에 실패해도 cron worker가 재처리한다. 발송 직전 현재 공지 내용·대상·사용자·지점·구독 활성 상태와 revision을 다시 확인한다. 공지 수정·삭제는 대기 작업을 취소하고 임대된 작업에는 취소 요청을 기록한다. 제공자 호출 전이면 발송을 중단하지만 호출이 시작된 뒤에는 취소를 보장할 수 없어 `deliveryMayHaveOccurred` 감사 상태로 남긴다. 제공자 호출은 15초 제한을 두며 시간 초과는 전송 결과 불확실 상태로 재시도한다. 늦게 도착한 이전 revision 결과는 현재 작업 상태를 덮어쓰지 않고 거부 감사로 남긴다. 각 시도는 endpoint/key 없이 별도 `notification.dispatch` 감사 행으로 남긴다. Web Push는 제공자 전송 성공 직후 저장 장애에서 exactly-once를 보장할 수 없으므로 at-least-once이며, 재시도는 같은 `final-judo-notice-{noticeId}` tag를 사용해 표시 중복을 줄인다. `/branches/:branchId/notices/:noticeId/push`는 수동 재발송이며 16~128자 `Idempotency-Key`를 권장한다. 서버는 키 원문 대신 digest만 감사 기록에 남기고 같은 키 재시도는 기존 요청 결과를 재사용한다. 헤더가 없는 기존 호출은 5분 호환 구간으로 중복 요청을 합친다. 생성/재발송 응답은 `recipientCount`와 outbox 상태를 반환한다. PWA 서버 푸시는 `FINAL_JUDO_VAPID_PUBLIC_KEY`, `FINAL_JUDO_VAPID_PRIVATE_KEY`, `FINAL_JUDO_VAPID_SUBJECT`를 사용한다. 키가 없거나 대상 기기 구독이 없으면 `configured: false` 또는 `attempted: 0`으로 알림함 표시와 휴대폰 푸시 미발송을 분리 안내한다. 구독 저장소는 endpoint, `p256dh`, `auth`, 사용자, 지점 범위, 마지막 발송/실패/비활성화 시각을 보관한다. 같은 브라우저 endpoint가 다른 계정으로 연결되면 서버는 outbox와 같은 잠금 안에서 소유권을 한 계정으로 이전하고 변경 전후 사용자 ID를 감사 기록에 남긴다. 이전 계정의 provider 호출이 진행 중이면 전송 결과가 확정될 때까지 `409 PUSH_SUBSCRIPTION_TRANSFER_PENDING`으로 이전을 보류한다. 회원/학부모 알림은 항상 켜짐 정책을 유지한다. 감사 로그에는 원문 endpoint/key를 남기지 않으며 404/410 endpoint는 비활성화한다. 기본 Vercel cron은 플랜 호환을 위해 일 1회이고, 더 짧은 재시도 주기는 배포 시점 플랜 또는 외부 스케줄러 확인 후 설정한다.

구독·감사 ID는 UUID 기반 런타임 ID를 사용한다. 구독 해제는 JSON 객체의 문자열 endpoint만 허용하며 객체·배열형 값은 활성 구독을 바꾸지 않고 `400 VALIDATION_ERROR`로 차단한다. 회원·학부모의 정상 해지 요청은 항상 켜짐 정책에 따라 `enforcedAlwaysOn: true`, `disabledAt: null`을 반환하고 차단 감사 기록을 남긴다.

공지 생성·수정·삭제·읽음 처리와 outbox lease·취소·settlement는 같은 `notice-state` 잠금 도메인에서 직렬화한다. 따라서 공지 변경이 저장되는 동안 worker가 이전 내용으로 새 provider 호출을 시작할 수 없으며, 이미 시작된 호출은 앞서 설명한 전송 가능성 감사 경계로 처리한다.

## 10-1. 대회 공지

| Method | Path | 권한 | 감사 | 설명 |
| --- | --- | --- | --- | --- |
| `POST` | `/tournaments` | coach/owner/admin + 지점 범위 | 예 | 전역 또는 지점 대회 공지 등록 |
| `PATCH` | `/tournaments/:tournamentId` | 작성 코치 또는 지점 대표/총괄 | 예 | 대회명·주최·일정·장소·마감일·링크·설명 수정 |
| `DELETE` | `/tournaments/:tournamentId` | 작성 코치 또는 지점 대표/총괄 | 예 | 대회 공지 삭제 |

등록·수정 본문은 JSON 객체와 문자열 필드만 허용하며, 수정은 지원 필드가 하나 이상 있어야 한다. 대회일과 접수 마감일은 실제 달력상 가능한 `YYYY-MM-DD`만 받고 마감일은 대회일보다 늦을 수 없다. 잘못된 타입, 존재하지 않는 날짜, 지원 필드 없는 수정은 변경·감사 기록 없이 `400 VALIDATION_ERROR`로 거부한다. 대회 등록·수정·삭제는 공통 대회 상태 잠금 안에서 최신 세션·역할·지점·작성자 권한을 다시 확인한다. 동시 등록은 모두 보존하고, 같은 대회의 서로 다른 필드 수정은 최신 상태를 이어받아 직렬화한다. 대회와 감사 ID는 UUID 기반 런타임 ID를 사용한다.

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
| `apiClient.requestPasswordResetCode` | `POST /api/v1/auth/password-reset` (`action=request`) |
| `apiClient.verifyPasswordResetCode` | `POST /api/v1/auth/password-reset` (`action=verify`) |
| `apiClient.completePasswordReset` | `POST /api/v1/auth/password-reset` (`action=complete`) |
| `apiClient.acceptInvitation` | `POST /api/v1/auth/invitations/:token/accept` |
| `apiClient.createInvitation` | `POST /api/v1/admin/users/invitations` |
| `apiClient.reissueInvitationLink` | `POST /api/v1/admin/users/:userId/invitation-link` |
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
