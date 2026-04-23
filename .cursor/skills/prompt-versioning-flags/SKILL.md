---
name: prompt-versioning-flags
description: >-
  Versions prompts and models behind flags, logs experiment IDs, and plans
  rollback for GenAI gateway. Use when changing prompt_registry, A/B prompts,
  feature flags for models, or observability for prompt variants. Korean:
  프롬프트 버전, 플래그, 롤백, 실험.
---

# 프롬프트·모델 버전과 플래그

## 관련 스킬

- SSOT·중복: [prevent-duplicate-code-conflicts](../prevent-duplicate-code-conflicts/SKILL.md)  
- 안전·로그: [genai-gateway-safety-review](../genai-gateway-safety-review/SKILL.md)

## 이 레포 현황

- 전용 **기능 플래그 모듈은 아직 없음**. A/B·롤백을 도입할 때는 `app/config.py`(pydantic-settings) 등에 예: `PROMPT_VARIANT=default|v2`, `EXPERIMENT_ID`를 추가하고, `chat_service`에서만 분기하도록 한 곳에 모은다.

## 원칙

- **기본 모델·시스템 프롬프트**는 한 곳(SSOT)에서 읽고, 실험 분기는 **플래그 또는 설정 키**로만 나눈다.  
- 요청/응답 로그에 **프롬프트 버전·플래그 값·실험 ID**를 남길 수 있으면 나중에 롤백·분석이 쉽다.

## 로그·메트릭 필드 이름(표준안)

- `prompt_key` (예: `default`, `summary`)  
- `model`  
- `experiment_id` 또는 `prompt_variant` (없으면 `control`)

## `prompt_registry` 키 네이밍

- **소문자·케밥 없음·영문 단어**: `default`, `summary`, `translation` 처럼 짧은 slug.  
- **제품 비전 문장과 동일한 키**를 만들지 않는다(비전은 `product_vision`, 프롬프트는 별 키).  
- 실험 전용은 접두사: `exp_summarize_v2` 또는 `ab_prompt_b` 등 팀 규칙 하나로 통일.

## 변경 시 체크리스트

- [ ] 새 프롬프트 키를 `prompt_registry`(또는 SSOT 모듈)에 추가했는가, 기본 키와 **충돌하지 않는가**  
- [ ] 기본 동작이 **플래그 off와 동일**한가 (실수로 실험만 켜지지 않는가)  
- [ ] 롤백: 플래그만 끄면 **이전 프롬프트/모델**로 돌아가는가  
- [ ] 대시보드/알림에서 구분할 **태그**(예: `prompt_version=v2`)를 메트릭에 넣을 수 있는가

## 에이전트 지침

- “인라인으로 긴 시스템 프롬프트 추가”보다 **레지스트리 키 + 짧은 설명**을 우선한다.  
- `product_vision`의 톤과 **충돌하는** 시스템 문구가 생기지 않게 조정한다.

## 추가 참고

- 설정 플레이스홀더·예시: [reference.md](reference.md)
