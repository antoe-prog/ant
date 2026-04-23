# 배포·롤백 (5-3 산출물)

[5-3 계획](../plan/05-03-deploy-rollback.md)에서 **클라·서버·프롬프트** 릴리스 방식을 한눈에 둔다.

<a id="deploy-rollback-spec"></a>

## 클라이언트

- 스토어 **단계별 롤아웃**(TestFlight·내부 트랙·프로덕션) + **기능 플래그**.  
- [4-1](mobile-app-structure-spec.md#mobile-app-structure-spec)과 네비·플래그 기본값이 **모순 없는지** 본다.

## 서버·프롬프트

- **블루/그린 또는 캐나리** 중 팀이 쓰는 방식을 한 줄로 고른다.  
- **프롬프트·모델** 변경은 [3-2](prompt-system-spec.md#prompt-system-spec)·[3-1](llm-model-strategy.md#llm-model-strategy)과 **버전 태그**(git tag·config revision)를 PR에서 맞춘다.

## 롤백

- “한 단계 전으로” 되돌리는 **트리거**(에러율·수동)를 적는다. [Recovery](../operations/recovery-checklist.md)와 링크.
