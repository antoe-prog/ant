---
name: mobile-chat-client-integration
description: >-
  Integrates iOS and Android chat UIs with the gateway POST /v1/chat: base URL,
  JSON body (user_id, session_id, message), timeouts, cancel, and optional
  streaming TODOs. Use when replacing template echo responses or wiring mobile
  to FastAPI. Korean: 채팅 연동, URLSession, OkHttp, 게이트웨이.
---

# 모바일 ↔ 게이트웨이 채팅 연동

## 관련 스킬

- SSOT·URL: [prevent-duplicate-code-conflicts](../prevent-duplicate-code-conflicts/SKILL.md)  
- 로컬 호스트: [mobile-genai-local-dev](../mobile-genai-local-dev/SKILL.md)  
- API 필드: [gateway-api-contract](../gateway-api-contract/SKILL.md)  
- iOS/Android 맞춤: [ios-android-parity-check](../ios-android-parity-check/SKILL.md)

## 계약 (게이트웨이 기준)

- `POST /v1/chat` — body: `user_id`, `session_id`, `message`, 선택 `model`, `temperature`.  
- 응답: `answer`, `provider`, `model`, `request_id` 등 (`schemas.ChatResponse`).

## iOS (`apps/ios`)

- `URLSession` 비동기 호출, **베이스 URL**은 빌드 설정 또는 `Info.plist`/xcconfig.  
- 타임아웃·취소(`Task.cancel`)·로딩 상태는 `ChatViewModel`과 일치시킨다.  
- 에러 시 사용자 메시지와 **로그용 request_id**(있으면) 구분.

## Android (`apps/android`)

- OkHttp 또는 Ktor 등 팀 표준으로 동일 JSON 계약.  
- `viewModelScope`와 **중복 전송 방지**(로딩 중 버튼 비활성 등).

## 체크리스트

- [ ] HTTP **S** 와 개발용 자체서명 정책이 정리되었는가  
- [ ] 세션 ID가 **대화 단위**로 안정적인가  
- [ ] 429/5xx 시 **재시도·백오프** 정책이 한 줄이라도 있는가

## 에이전트 지침

- 하드코딩 URL 금지는 **SSOT/환경** 스킬과 맞춘다.  
- 스트리밍은 별 계약이면 게이트웨이·스키마를 **먼저** 확정한 뒤 클라이언트를 맞춘다.

## 추가 참고

- JSON 예시·의사코드·HTTP→UI 매핑: [reference.md](reference.md)
