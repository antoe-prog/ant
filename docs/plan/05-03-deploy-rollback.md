# 5-3. 배포·롤백 전략

**단계:** 5. 백엔드·MLOps·관측 (M~O) — 안정 운영

**산출물:**

- [배포·롤백 요약](../product/deploy-rollback-spec.md#deploy-rollback-spec)

## 클라이언트

- 점진적 배포(스토어 단계별 롤아웃)와 **기능 플래그**를 함께 쓴다.

## 서버·프롬프트

- 블루/그린 또는 캐나리 중 팀이 쓰는 방식과 **버전 태깅**(서버·프롬프트)을 [3-2](../product/prompt-system-spec.md)·[deploy-rollback-spec](../product/deploy-rollback-spec.md)에 맞춘다.

## 상위·하위 정렬

- [5-2 관측](05-02-observability.md): 캐나리 중 **알림 임계**와 맞는가?  
- [4-1 앱 구조](04-01-mobile-app-structure.md): 플래그 기본값이 **모순** 없는가?

## 다음 단계

- [6-1 테스트 전략](06-01-testing-strategy.md): 배포 파이프라인에 **스모크**를 붙인다.

## 완료 체크

- [ ] 클라·서버·프롬프트 **롤백 트리거**가 적혀 있는가  
- [ ] [deploy-rollback-spec.md](../product/deploy-rollback-spec.md)가 **같은 PR**에서 갱신되었는가  
- [ ] 5-2·4-1과 **한 번** 대조했는가
