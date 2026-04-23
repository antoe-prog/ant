# 3-2. 프롬프트·시스템 설계

**단계:** 3. 모델·프롬프트·데이터 설계 (G~I) — 품질·안정성·비용

**산출물:**

- [프롬프트·시스템 요약](../product/prompt-system-spec.md#prompt-system-spec) (네 축·전처리 위치·코드 SSOT)
- 구현 SSOT: `services/gateway/app/product_vision.py` (`DEFAULT_SYSTEM_PROMPT`), `services/gateway/app/services/prompt_registry.py`

**선행:** [3-1 LLM·모델 전략](03-01-llm-strategy.md) · [모델 표](../product/llm-model-strategy.md#llm-model-strategy)에서 **주력 모델**을 정한 뒤 프롬프트를 맞춘다.

## 시스템 프롬프트

- **역할·톤·금지사항·출력 포맷** 네 가지만 **명확히** 적는다(추가 섹션 남발 금지).  
- [한 줄 비전](../product/product-vision-one-liner.md)·[차별](../product/strategic-differentiation.md)·코드 `ONE_LINER` / `DIFFERENTIATION`과 **같은 주장**인지 본다.

## 사용자 입력 전처리

- **언어 감지, 길이 제한, 금칙어 필터링** 등 **계층을 둔다** — 기본은 **[게이트웨이](02-03-tech-architecture-draft.md)**에서 정책·로깅과 맞추고, 클라이언트는 **UX 보조**만 둔다(이중 검사 피하기).  
- 금칙어·고급 언어 처리를 **아직 안 쓰면** 산출물에 **N/A**로 명시한다.

## 상위·하위 정렬

- [3-1](03-01-llm-strategy.md): 주력 모델 톤·컨텍스트 길이와 시스템 프롬프트가 **맞는가?**  
- [5-1 API·LLM 프록시](05-01-api-llm-proxy.md): 프롬프트 길이 로깅·직접 호출 금지와 **모순** 없는가?  
- [비기능 목표](../product/non-functional-targets.md): 길이·지연·예산과 **모순** 없는가?

## 다음 단계

- [3-3 개인화 데이터](03-03-personalization-data.md): 히스토리·취향이 **시스템·전처리**와 어떻게 만나는지 정한다.

## 완료 체크

- [ ] 네 축이 **코드 `DEFAULT_SYSTEM_PROMPT`** 및 산출물 표와 **같은 PR**에서 맞는가  
- [ ] 전처리 **주된 위치(서버 vs 클라)**가 산출물에 **적혀 있는가**  
- [ ] 금칙어 등 **미사용 항목은 N/A**로 남았는가  
- [3-1](03-01-llm-strategy.md)·비기능·5-1과 **한 번** 대조했는가
