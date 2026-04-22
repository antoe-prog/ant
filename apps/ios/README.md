# iOS App Skeleton

SwiftUI + MVVM template structure.

## Suggested Structure

- `Sources/App`: App entry and dependency container
- `Sources/Features/Chat`: chat screen and view model
- `Sources/Features/Settings`: settings screen
- `Sources/Features/History`: history screen
- `Sources/Shared/Networking`: API client
- `Sources/Shared/Storage`: local cache

## API Base URL

기본값은 시뮬레이터용 `http://127.0.0.1:8000`이다. 환경 변수 `GATEWAY_BASE_URL`로 덮어쓸 수 있다 (`ChatViewModel`).
