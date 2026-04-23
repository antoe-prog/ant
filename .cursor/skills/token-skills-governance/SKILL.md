---
name: token-skills-governance
description: >-
  Resolves conflicts between token-saving skills and accuracy/safety skills;
  narrows triggers; lists dangerous pairs. Use when many Cursor skills are
  enabled or when editing token-optimization SKILLs. Korean: 스킬 충돌, 우선순위.
---

# 토큰 스킬 거버넌스 (1~4번 규칙)

## 1) 트리거를 좁게

아래 토큰 스킬들은 **description에 WHEN이 이미 박혀 있음**. 새로 쓸 때:

- “항상” 트리거 금지. **한 가지 상황** + 한국어 키워드 2~3개만.  
- `prevent-duplicate-code-conflicts` 등과 **같은 문장 복붙**하지 말 것 (중복 트리거 방지).

## 2) 우선순위 (토큰 < 정확·안전)

충돌 시 **아래가 이긴다**:

1. `genai-gateway-safety-review`  
2. `prevent-duplicate-code-conflicts` · `gateway-api-contract` · `docs-plan-sync-1-1`  
3. `incident-gateway-playbook`  
4. 그 다음에만 `context-budget-first`, `diff-and-search-first`, `tool-output-truncation-hygiene` 등 토큰 절약 스킬.

일부 토큰 스킬 본문의 **우선순위** 절과 이 문서를 같이 본다.

## 3) 개수·합치기

- 동시에 켜 두기 좋은 토큰 스킬 **최대 ~5개** 권장.  
- **적용됨:** `grep-then-read` + `diff-first-debugging` → **[diff-and-search-first](../diff-and-search-first/SKILL.md)** 로 통합(삭제된 스킬 이름은 트리거/북마크만 유지해도 됨).  
- 추가로 겹치면 **하나 삭제**하고 이 절에 “대체 스킬” 한 줄을 남긴다.

## 4) 위험한 조합 (예외 명시)

| 조합 | 이유 | 조치 |
|------|------|------|
| `summarize-long-threads` + 보안/법무 판단 | 증거 누락 | 보안 결론은 **원문 인용 최소 블록** 유지 |
| `single-file-touch-default` + API 브레이킹 | 호출부 누락 | 계약 스킬 열리면 **다파일 허용** |
| `reject-drive-by-docs` + 릴리스 | 체크리스트 누락 | `release-mobile-template` 요청 시 문서 수정 OK |
| `tool-output-truncation` + 미읽 에러 | 원인 오판 | **에러 블록 전체**는 한 번은 유지 |

## 토큰 스킬 인덱스 (9개)

- [context-budget-first](../context-budget-first/SKILL.md)  
- [progressive-disclosure-prompts](../progressive-disclosure-prompts/SKILL.md)  
- [diff-and-search-first](../diff-and-search-first/SKILL.md) — *replaces `diff-first-debugging` + `grep-then-read`*  
- [single-file-touch-default](../single-file-touch-default/SKILL.md)  
- [no-redundant-citations](../no-redundant-citations/SKILL.md)  
- [summarize-long-threads](../summarize-long-threads/SKILL.md)  
- [schema-over-prose-for-apis](../schema-over-prose-for-apis/SKILL.md)  
- [reject-drive-by-docs](../reject-drive-by-docs/SKILL.md)  
- [tool-output-truncation-hygiene](../tool-output-truncation-hygiene/SKILL.md)

## 형제 (정확성 쪽)

- [prevent-duplicate-code-conflicts](../prevent-duplicate-code-conflicts/SKILL.md)
