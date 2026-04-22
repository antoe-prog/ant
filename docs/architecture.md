# System Architecture

상세는 주제별 파일로 나누어 두었다.

- [Architecture 목차](architecture/README.md)
- [System diagram](architecture/system-diagram.md)
- [Boundaries](architecture/boundaries.md)
- **운영 Admin:** 반응형 웹 `apps/admin-web` — PC·모바일 브라우저로 게이트웨이 읽기 전용 조회(확장 시 인증·쓰기 API). 전용 데스크톱 앱은 불필요할 때가 많다.
- [2-3 모듈 초안 표](architecture/draft-module-matrix.md#draft-module-matrix)
- **별도 스택:** 저장소 루트 [`유도관/`](../유도관/README.md) — 도장 회원 관리용 Expo + tRPC + MySQL(본 템플릿의 `apps/*`·`services/gateway`와 다른 클라이언트·백엔드)
