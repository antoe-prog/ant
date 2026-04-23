---
name: single-file-touch-default
description: >-
  Default to one file or one directory per change unless user expands scope.
  Use for small fixes and agent-driven edits. Korean: 한 파일, 범위.
---

# 기본: 한 파일(또는 한 디렉터리)

## 우선순위

API 계약·SSOT 동기화가 필요하면 **다파일 수정이 정답**이다. ([token-skills-governance](../token-skills-governance/SKILL.md))

## 지침

1. PR/작업 단위로 **한 파일**을 고치고, 연쇄 수정이 필요하면 사용자에게 **한 문장**으로 범위 확대를 제안한다.  
2. drive-by로 여러 모듈을 훑지 않는다.  
3. 예외: 동일 버그의 **테스트+구현** 한 쌍은 허용.
