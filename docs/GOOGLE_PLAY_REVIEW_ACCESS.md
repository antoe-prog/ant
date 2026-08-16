# Google Play 검토 접근 운영

스토어 심사자에게 실제 운영자 계정을 제공하지 않는다. 일반 화면 문구를 사용하는 격리된 `강서 중앙관` 데이터와 역할별 계정을 사용한다.

## 계정 구성

- Member: 본인 수업, 출석, 결제, 승급, 대회, 공지
- Guardian: 학부모 본인과 합성 자녀 선택 흐름
- Coach: 합성 수업, 회원, 출석, 상담 메모
- Branch Owner: 합성 지점의 회원, 결제, 공지, 리포트
- System Admin: 일반 총괄과 동일한 RBAC를 적용하되 합성 지점에만 배정. 배정 지점의 운영 기능은 사용할 수 있고 전역·다른 지점 작업은 차단

심사 계정임을 나타내는 사용자 속성이나 권한 분기는 두지 않는다. 메뉴, API 권한, 읽기·쓰기 가능 여부는 모든 계정과 동일하게 역할, `adminScope`, 배정 지점으로만 판단한다. 격리 지점의 `dataMode`는 공개 회원가입 대상에서 제외하는 데에만 사용한다. 수업·출석·결제·공지·승급·대회 날짜는 고정된 데모 데이터이며 접속일이나 심사 시점에 맞춰 다시 쓰지 않는다.

## 검증

```bash
npm run test:google-play-review-access
npm run test:google-play-review-api
```

두 검증은 역할별 로그인, 일반 RBAC와의 동등성, 합성 지점 쓰기, 실제 회원 비노출, 전역·교차 지점 쓰기 차단, 프로비저닝 실행 날짜에 따른 데이터 불변성, iPhone/iPad·지역·TestFlight 헤더에 따른 응답 불변성, 영문 안내문 길이, 비밀번호 비출력을 확인한다.

## 운영 프로비저닝

신규 소스가 production에 배포되고 production smoke를 통과한 뒤에만 실행한다. PostgreSQL URL을 CLI 인자로 넘기지 않는다.

```bash
npm run google-play:review:provision -- --origin=https://final-judo.vercel.app
npm run google-play:review:provision -- --apply --origin=https://final-judo.vercel.app
```

첫 명령은 설치 식별자와 무결성을 확인하는 dry-run이다. `--apply`는 지점·계정·합성 데이터를 멱등적으로 생성하고 기존 검토 세션을 폐기한다. 비밀번호가 포함된 Play Console 입력 자료는 기본적으로 `.data/google-play-review-access.json`에 `0600` 권한으로 생성되며 Git에 추가하지 않는다.

## Play Console 등록

`consoleEntries` 배열의 `name`, `username`, `password`, `otherAccessInformation`을 역할별로 하나씩 추가한다. 다섯 계정 모두 OTP, SMS 인증, 위치 제한, 유료 결제 없이 재사용 가능해야 한다. 심사 완료 전에 비밀번호를 변경하거나 계정을 비활성화하지 않는다.
