# Boundaries

- Mobile apps handle UI and local interaction state only.
- Gateway owns authentication, model access, prompt policy, and logging.
- LLM provider calls are never made directly from mobile clients.
- **Ops Admin (`apps/admin-web`):** 브라우저에서 게이트웨이 공개 API만 호출한다. 운영자 전용·쓰기 작업은 별도 인증·권한과 함께 게이트웨이(또는 BFF)에만 둔다; Admin은 모바일 앱 바이너리에 포함하지 않는다.
