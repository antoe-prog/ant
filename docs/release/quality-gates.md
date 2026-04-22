# Release — Quality Gates

- [ ] Gateway tests pass
- [ ] Lint checks pass
- [ ] Security scan clear for critical issues
- [ ] Performance p95 target met
- [ ] 스테이징(또는 후보 빌드)에서 **스모크:** `services/gateway/scripts/smoke_gateway.sh https://<게이트웨이-호스트>` 또는 동일 요청을 수동으로 (`GET /health`, `GET /v1/product-vision`, `differentiation`·`doc_paths` 키 확인)
- [ ] `apps/admin-web`을 쓰는 경우: 배포 URL에서 `VITE_GATEWAY_URL`이 스테이징 게이트웨이를 가리키고, 게이트웨이 `CORS_ALLOW_ORIGINS`에 Admin 출처가 포함되는가
