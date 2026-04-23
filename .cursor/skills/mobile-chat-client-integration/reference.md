# POST `/v1/chat` — JSON 예시

**Request**

```json
{
  "user_id": "local-user-1",
  "session_id": "session-abc",
  "message": "hello",
  "temperature": 0.3
}
```

**Response (예)**

```json
{
  "provider": "openai",
  "model": "gpt-4o-mini",
  "answer": "…",
  "request_id": "…"
}
```

## 의사코드 (ViewModel에 맞춤)

**iOS (`ChatViewModel.send`)**

1. `POST {baseURL}/v1/chat`, `Content-Type: application/json`  
2. `JSONEncoder`로 body 인코딩  
3. `dataTask` 완료 후 `ChatResponse` 디코딩 → `messages`에 assistant 한 줄 추가  
4. `URLError` / HTTP 4xx·5xx → 사용자용 짧은 문구 + `request_id`는 로그만

**Android (`ChatViewModel.send`)**

1. OkHttp `RequestBody.create(json, MediaType)`  
2. `enqueue` 또는 코루틴 `suspend`로 응답 파싱  
3. 실패 시 `_uiState`에 에러 플래그(선택)

## HTTP 코드 → 사용자 vs 로그

| 상황 | 사용자에게 | 로그/디버그 |
|------|------------|-------------|
| 200 | 답변 표시 | `request_id` 저장(선택) |
| 429 | “잠시 후 다시 시도” | 전체 응답 본문 주의(민감정보 없게) |
| 5xx | “일시적 오류” | status, `request_id`, 엔드포인트 |
| 네트워크 끊김 | “연결을 확인” | throwable 메시지 |
