# 안전·프라이버시 — 심화 참고

## 로그 필드 권장(도입 시)

- `request_id`, `user_id` 해시(이미 정책에 있다면 유지), `prompt_chars` 또는 `prompt_sha256`  
- 원문 대신 **길이·언어·도메인 태그**만 남기기

## 정적 검색

```bash
rg 'print\(|logger\.(info|debug).*message' services/gateway/app
rg 'password|api_key|secret' services/gateway/app --glob '!**/tests/**'
```

## 팀 확장

- 데이터 보존 기간, DPA, 지역별 LLM 사용 정책은 **별 문서**로 두고 이 스킬에는 링크만 건다.
