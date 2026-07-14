# 운영 복구 런북

이 문서는 운영 PostgreSQL 오연결, 관리자 자격 증명 분실, 배포 회귀에 대응하는 절차다. 연결 문자열, 비밀번호, 암호화 키는 CLI 인자·git·증빙 JSON에 기록하지 않고 환경 변수 또는 승인된 secret store에서만 읽는다.

## 1. 운영 상태 사전 점검

1. 운영 연결 문자열과 `FINAL_JUDO_INSTALLATION_ID`를 현재 셸에 주입한다.
2. `npm run production:runtime:preflight`를 실행한다.
3. 읽기 전용 트랜잭션, 설치 식별자, runtime fingerprint, revision, 최소 데이터 개수, 관리자 자격 증명, 공용 기본 비밀번호 제거가 모두 통과했는지 확인한다.
4. 출력된 fingerprint와 revision을 배포 복구 manifest의 기준값으로 사용한다. 연결 문자열과 사용자별 데이터는 저장하지 않는다.

빈 DB, 다른 설치 식별자, 누락된 `mvp` 행은 복구 대상이지 자동 시드 대상이 아니다. 운영 앱은 이 상태에서 테이블 또는 기본 데이터를 만들지 않는다.

## 2. 암호화 백업

1. 운영과 같은 PostgreSQL 메이저 버전의 공식 `pg_dump`를 사용해 custom-format dump를 만든다.
2. dump를 즉시 AES-256 암호화하고 평문 파일을 삭제한다. 암호화 키는 OS Keychain 또는 승인된 secret manager에만 보관한다.
3. 암호화 파일은 `.data/production-backups/`에 두고 권한을 `0600`으로 제한한 뒤 별도 외부 저장소에 복제한다.
4. SHA-256을 기록하고 복호화 스트림에 `pg_restore --list`를 실행해 `app_runtime_state`와 필수 업무 테이블을 확인한다.
5. 복구 리허설은 운영이 아닌 새 Neon branch에서 수행한다. 데이터 개수와 `production:runtime:preflight`가 일치한 뒤에만 운영 전환 승인을 요청한다.

## 3. 관리자 자격 증명 복구

`FINAL_JUDO_RECOVERY_PASSWORD`는 최소 12자이며 공용 데모 비밀번호를 사용할 수 없다. actor·target은 잠긴 상태 행 안의 승인된 관리자여야 한다.

1. 운영 preflight에서 runtime fingerprint와 최신 revision을 확인한다.
2. actor, target, 사유, 예상 revision을 설정하고 `npm run production:admin:recover`를 실행한다. 기본값은 validate-only이며 DB 변경 없이 잠금·역할·식별자·revision을 검증한다.
3. 결과 검토와 명시적 승인 후에만 `-- --apply --approve-admin-credential-recovery`를 추가한다.
4. 성공 시 대상 관리자 비밀번호 변경, 기존 세션 폐기, actor·사유·revision 감사 기록이 하나의 원자적 갱신으로 저장됐는지 확인한다.
5. 새 비밀번호로 로그인·bootstrap·logout·폐기 세션 401을 확인한다. 비밀번호는 증빙에 기록하지 않는다.

## 4. 배포 및 롤백

1. 전체 release gate와 운영 DB preflight를 통과한다.
2. preview 배포와 smoke를 완료한 뒤 production으로 명시 승격한다.
3. `npm run production:recovery:manifest`로 배포 ID, source SHA, build ID, Neon project/branch, runtime identity/revision/count, smoke 증빙 ID를 `.data`에 원자적으로 기록한다.
4. 롤백 전 배포 플랫폼의 실제 롤백 가능 범위와 Neon branch 상태를 다시 확인한다. 앱 배포와 DB 상태를 독립적으로 되돌리지 않는다.
5. 롤백 후 로그인 페이지 200, 오입력 401, 비로그인 보호 API 401을 확인한다. 지정된 비관리자 smoke 계정이 있을 때만 정상 로그인을 검사한다.
