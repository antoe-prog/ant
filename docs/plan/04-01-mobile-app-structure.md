# 4-1. 앱 구조 정의

**단계:** 4. 모바일 앱 구조·UI 구현 (J~L) — 성능·UX·접근성

**산출물:**

- [앱 구조·네비 표](../product/mobile-app-structure-spec.md#mobile-app-structure-spec)

## 네비게이션

- 네비게이션 스택(온보딩, 메인, 상세, 설정)을 **먼저** 정의한 후 화면을 설계한다.  
- 온보딩은 [첫 가치 표](../product/first-value-journey.md)의 **Core 레이블**만 등장하게 맞춘다.

## 상태 관리

- 전역 스토어, 캐시, 네트워크 상태 전략을 **한 단락**이라도 문서화한다.

## 상위·하위 정렬

- [2-2 UX](02-02-ux-journey.md): 화면 순서·재방문 단축이 **모순** 없는가?  
- [2-3 아키텍처](02-03-tech-architecture-draft.md): 클라이언트 행과 **경로**가 맞는가?

## 다음 단계

- [4-2 핵심 UI](04-02-core-ui.md): 정의한 스택 위에 **채팅·로딩**을 올린다.

## 완료 체크

- [ ] 스택 표에 **메인·설정·히스토리**가 빠지지 않았는가  
- [ ] [mobile-app-structure-spec.md](../product/mobile-app-structure-spec.md)가 **같은 PR**에서 갱신되었는가  
- [ ] 2-2·2-3과 **한 번** 대조했는가
