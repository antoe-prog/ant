# A/B·프롬프트 실험 (6-3 산출물)

[6-3 계획](../plan/06-03-ab-prompt-experiments.md)을 **가설·지표·윤리**까지 한 페이지로 고정한다.

<a id="ab-prompt-experiments-spec"></a>

## 설계 규칙

- **실험 1회 = 가설 1개.** 프롬프트 v1 vs v2는 **기능 플래그** 또는 서버 설정으로 분기.  
- 비교 지표: **응답 만족도**(설문·엄지)·대화 길이·이탈률 중 팀이 고른 **최소 1개**를 표에 적는다. 미수집이면 **N/A**.

## 윤리·안전

- 민감 주제·아동·의료 등은 **실험 제외** 또는 별도 검토. [3-2 금지 축](prompt-system-spec.md#prompt-system-spec)과 모순 없게.

## 연계

- [3-2](prompt-system-spec.md) · [5-3](deploy-rollback-spec.md) (롤백)
