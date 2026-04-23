# Android App Skeleton

Kotlin + Jetpack Compose + MVI template structure.

게이트웨이 URL: 에뮬레이터 기본 `http://10.0.2.2:8000`, 환경 변수 `GATEWAY_BASE_URL`로 변경 (`ChatViewModel`).

## Suggested Modules

- `app`: composition root
- `feature-chat`: chat UI and state
- `feature-settings`: personalization
- `feature-history`: history/search/export
- `core-network`: Retrofit API layer
- `core-storage`: local DB/cache
