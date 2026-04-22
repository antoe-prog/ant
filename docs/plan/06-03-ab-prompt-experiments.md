# 6-3. A/B 테스트·프롬프트 실험

**단계:** 6. 품질 검증·실험 (P~R) — QA·로그·실험

**산출물:**

- [A/B·실험 설계](../product/ab-prompt-experiments-spec.md#ab-prompt-experiments-spec)

## 설계

- 프롬프트 버전(예: v1, v2)을 **기능 플래그**로 나눠 배포하고, 응답 만족도·대화 길이·이탈률을 비교한다.  
- 실험은 **1회 1가설**만 검증한다.

## 상위·하위 정렬

- [3-2 프롬프트](03-02-prompt-system.md): 금지·톤과 **모순** 없는가?  
- [6-2 로그 분석](06-02-log-analytics.md): 지표 **정의**가 같는가?  
- [5-3 배포](05-03-deploy-rollback.md): 롤백·플래그와 **맞는가?**

## 다음 단계

- [7-1 소프트 런칭](07-01-soft-launch.md): 실험을 **제한 사용자**에만 켤지 정한다.

## 완료 체크

- [ ] 가설 1개·지표·윤리(금지 주제)가 적혀 있는가  
- [ ] [ab-prompt-experiments-spec.md](../product/ab-prompt-experiments-spec.md)가 **같은 PR**에서 갱신되었는가  
- [ ] 3-2·6-2·5-3과 **한 번** 대조했는가
