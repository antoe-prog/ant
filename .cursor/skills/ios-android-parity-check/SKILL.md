---
name: ios-android-parity-check
description: >-
  When changing apps/ios or apps/android chat, history, or settings, verify the
  other platform for feature parity and API usage. Use after mobile UX or
  gateway contract edits. Korean: iOS Android 맞춤, 패리티.
---

# iOS ↔ Android 패리티

## 관련 스킬

- 채팅 연동: [mobile-chat-client-integration](../mobile-chat-client-integration/SKILL.md)  
- SSOT: [prevent-duplicate-code-conflicts](../prevent-duplicate-code-conflicts/SKILL.md)

## 경로 맵 (이 템플릿)

| 영역 | iOS | Android |
|------|-----|---------|
| 채팅 | `Sources/Features/Chat/ChatViewModel.swift` | `feature/chat/ChatViewModel.kt` |
| 히스토리 | `Features/History/HistoryStore.swift` | `feature/history/HistoryRepository.kt` |
| 설정 | `Features/Settings/SettingsViewModel.swift` | `feature/settings/SettingsState.kt` |

## 체크리스트 (한쪽만 수정 후)

- [ ] 동일 **엔드포인트·JSON 필드**를 쓰는가  
- [ ] **에러·로딩** UX가 대등한가  
- [ ] **베이스 URL** 출처(환경·상수)가 같은 정책인가
