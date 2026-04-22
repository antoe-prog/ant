# 4-2. 핵심 화면 UI·인터랙션

**단계:** 4. 모바일 앱 구조·UI 구현 (J~L) — 성능·UX·접근성

**산출물:**

- [핵심 UI 요약](../product/core-ui-spec.md#core-ui-spec)

## 범위

- **채팅**(스트리밍·에러)·**히스토리**·**설정**에 애니메이션·로딩 피드백을 **과하지 않게** 넣는다. 소셜 **피드**는 Core에 없으면 **범위에서 제외**한다.  
- 요청 중/완료 상태를 명확히 보이게 하고, **취소·재시도**를 노출한다([2-1 V1 게이트](../product-scope.md#v1-mvp-scope)).

## 상위·하위 정렬

- [4-1 앱 구조](04-01-mobile-app-structure.md): 네비·상태와 **모순** 없는가?  
- [AI 채팅](../product/feature-ai-chat.md)·[비기능](../product/non-functional-targets.md): 지연·예산 메시지와 **맞는가?**

## 다음 단계

- [4-3 성능·접근성](04-03-performance-accessibility.md): 목표 수치·a11y 체크를 고정한다.

## 완료 체크

- [ ] 채팅 경로에 **로딩·실패·재시도**가 빠지지 않았는가  
- [ ] [core-ui-spec.md](../product/core-ui-spec.md)가 **같은 PR**에서 갱신되었는가  
- [ ] 4-1·feature-ai-chat과 **한 번** 대조했는가
