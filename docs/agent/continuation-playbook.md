# 에이전트 연속 작업 · 승인 플레이북

멈추지 않고 진행하되, **비용·보안·프로덕션**에 닿는 변경은 짧은 승인 한 줄로 넘긴다.

## 기본 원칙

1. **승인 없이 진행:** 문서·테스트·로컬 개발용 스크립트·CI 설정·스테이징과 동일한 패턴의 코드.
2. **한 번 확인 후 진행:** 시크릿 이름·도메인·비용이 드는 외부 API 호출량, `fly secrets set`, 스토어 제출 메타데이터.
3. **반드시 사람 승인:** 프로덕션 DB 마이그레이션 파괴적 변경, 결제·PII 처리 방식 변경, 새 제3자 데이터 수탁.

## 채팅에서 쓰는 승인 문구 (예시)

- `승인: Fly 프로덕션에 CORS_ALLOW_ORIGINS 반영`
- `승인: admin-web 정적 호스트 URL 이 주소로 배포`
- `승인: 유도관 EAS 프로덕션 프로필 빌드`

에이전트는 위와 같이 **범위가 한정된** 문장이 있으면 해당 작업만 실행하고, 범위 밖은 하지 않는다.

## 작업 큐 (복붙용)

다음 메시지에 아래 블록을 붙이고 원하는 줄만 남기면 된다.

```text
[x] gateway: 스테이징 스모크 스크립트 (`services/gateway/scripts/smoke_gateway.sh`)
[x] check_ssot: competitive 표 필수 문구 검사 (`check_ssot_docs.py`)
[x] 유도관: eas.json 채널·`EXPO_PUBLIC_APP_ENV` 프로필 분리 + CI 타입체크·`web-admin` 빌드
[ ] admin-web (GenAI): OIDC 로그인 초안
[ ] iOS/Android: Fastlane 업로드 초안
[ ] 유도관 web-admin: 웹 OAuth 로그인(토큰 수동 입력 제거)
```

## 저장소 내 참고

- Admin 바로가기: `apps/admin-web/desktop/install-desktop-shortcuts.sh`
- 릴리스 게이트: [quality-gates.md](../release/quality-gates.md)
