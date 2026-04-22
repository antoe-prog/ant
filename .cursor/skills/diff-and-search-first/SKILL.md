---
name: diff-and-search-first
description: >-
  Saves tokens for debugging and exploration: git diff, short repro, and stack
  tops for bugs/CI; rg/grep then partial Read for unknown code. Replaces
  diff-first-debugging and grep-then-read. Korean: diff, 검색 후 읽기, 재현.
---

# Diff·검색 우선

## 우선순위

보안 증거·민감 로그는 **사용자 동의 없이 잘라내지 않는다**. ([token-skills-governance](../token-skills-governance/SKILL.md))

## 디버깅 (버그·회귀·CI)

1. `git diff`, 실패 로그 **상단 80줄**, 재현 **3줄**을 먼저 본다.  
2. 전체 파일 Read는 **검색으로 구간 확정 후**만.

## 탐색 (낯선 영역)

1. 넓은 Read 대신 **rg/grep**으로 파일·줄을 좁힌다.  
2. Read는 **offset + limit**로 구간만.  
3. 결과가 0건이면 검색어를 **한 번만** 바꿔 재시도한다.

## 공통

- 사용자가 전체 파일을 붙였으면 **관련 구간만** 인용한다.
