# 로컬 개발 — 참고

## 모바일 → 호스트 PC의 게이트웨이

| 환경 | 게이트웨이 URL 예시 (호스트에서 `uvicorn`이 `0.0.0.0:8000`일 때) |
|------|------------------------------------------------------------------|
| Android 에뮬레이터 | `http://10.0.2.2:8000` |
| iOS 시뮬레이터 (맥) | `http://127.0.0.1:8000` |
| 실기기 (같은 Wi‑Fi) | `http://<맥/PC의 LAN IP>:8000` |

HTTPS·자체서명은 팀 정책에 맞게 별도 설정.

## 검증용 curl (게이트웨이 기동 후)

```bash
curl -sS http://127.0.0.1:8000/health
curl -sS http://127.0.0.1:8000/v1/product-vision | head -c 400
```

`POST /v1/chat` 예시는 [mobile-chat-client-integration/reference.md](../mobile-chat-client-integration/reference.md) 참고.
