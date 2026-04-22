# 4-3. 성능·접근성 최소 기준

**단계:** 4. 모바일 앱 구조·UI 구현 (J~L) — 성능·UX·접근성

**산출물:**

- [성능·접근성 표](../product/performance-accessibility-spec.md#performance-accessibility-spec)

## 목표 (층 분리)

- **클라이언트 UX:** 첫 화면 렌더링 **약 2초 이내**, 주요 액션 응답 **약 1초 이내**를 **기기 측** 목표로 둔다.  
- **API·LLM p95**는 [비기능 목표](../product/non-functional-targets.md)의 **게이트웨이 기준**과 혼동하지 않는다 — 산출물 표에 **둘 다** 적는다.

## 접근성

- 폰트 크기, 색 대비, VoiceOver/TalkBack 레이블 등 **최소 체크리스트**를 산출물에 적는다. 음성 피드백은 **필요 시 N/A**.

## 상위·하위 정렬

- [4-2 핵심 UI](04-02-core-ui.md): 애니메이션이 성능 목표와 **모순** 없는가?

## 다음 단계

- [5-1 API·LLM 프록시](05-01-api-llm-proxy.md): 지연·로그가 **같은 숫자 언어**를 쓰는지 본다.

## 완료 체크

- [ ] 클라 목표 vs **게이트웨이 p95**가 표에서 **구분**되는가  
- [ ] [performance-accessibility-spec.md](../product/performance-accessibility-spec.md)가 **같은 PR**에서 갱신되었는가  
- [ ] 비기능·4-2와 **한 번** 대조했는가
