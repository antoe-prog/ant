# 앱 구조·네비 (4-1 산출물)

[4-1 계획](../plan/04-01-mobile-app-structure.md)에서 정한 **스택·상태**를 여기에 둔다. 경로: `apps/ios`, `apps/android`.

<a id="mobile-app-structure-spec"></a>

## 네비게이션 스택

| 영역 | 역할 | 이 템플릿 메모 |
|------|------|----------------|
| 온보딩 / 첫 진입 | 권한·URL 안내 등 | [첫 가치 표](first-value-journey.md)와 **등장 화면만** 맞출 것(Core 밖 이름 남발 금지) |
| 메인 | 채팅 루트 | |
| 상세 | 히스토리 스레드 등 | |
| 설정 | 모델·언어·스타일 | [설정](feature-settings.md) |

## 상태 관리

- **전역 스토어 / 캐시 / 네트워크:** 팀이 선택한 방식(예: Observable, SwiftUI `@StateObject`, Android ViewModel)을 **한 단락**으로 적는다.  
- [2-2 여정](../plan/02-02-ux-journey.md)의 화면 순서와 **모순 없는지** PR에서 본다.
