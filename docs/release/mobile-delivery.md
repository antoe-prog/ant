# Release — Mobile Delivery

- [ ] iOS internal build generated
- [ ] Android internal build generated
- [ ] API base URL points to target environment

## Fastlane 템플릿

네이티브 앱 디렉터리에 최소 Fastlane 스캐폴드가 있습니다.

- iOS: `apps/ios/fastlane/` — `cd apps/ios && fastlane ios info`
- Android: `apps/android/fastlane/` — `cd apps/android && fastlane android info`

Xcode 프로젝트·Gradle 앱 모듈이 생기면 각 `Fastfile` 주석의 `beta` / `internal` 예시를 채워 스토어 업로드에 맞게 조정합니다.
