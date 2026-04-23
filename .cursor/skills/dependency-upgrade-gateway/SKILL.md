---
name: dependency-upgrade-gateway
description: >-
  Upgrades Python dependencies for services/gateway safely: requirements.txt,
  CI Python version in .github/workflows, deprecated APIs, and pytest. Use when
  bumping FastAPI, Pydantic, httpx, or Python runtime for the gateway. Korean:
  의존성 업그레이드, 파이썬 버전.
---

# 게이트웨이 의존성·런타임 업그레이드

## 관련 스킬

- SSOT·CI: [prevent-duplicate-code-conflicts](../prevent-duplicate-code-conflicts/SKILL.md)  
- 로컬 부팅: [mobile-genai-local-dev](../mobile-genai-local-dev/SKILL.md)

## 런타임 기준 (이 레포)

- CI: [`.github/workflows/ci.yml`](../../../.github/workflows/ci.yml)의 **`python-version: "3.11"`** 과 로컬을 맞춘다.  
- 타입 힌트: 3.11 기준으로 `str | None` 등을 써도 되나, pydantic·호환 목적이면 `Optional[str]` 유지도 가능.

## 파일 묶음

- `services/gateway/requirements.txt`  
- `.github/workflows/ci.yml` — `python-version`  
- `services/gateway/pytest.ini` — `pythonpath`  
- (있으면) `Dockerfile`, 루트 `README`의 Python 안내

## 락 전략 (팀이 선택)

- **단순:** `requirements.txt`에 상한 없이 범위 고정 + 주기적 업그레이드 PR.  
- **엄격:** `pip-tools`의 `pip-compile`로 `requirements.in` → `requirements.txt` 고정.  
- **uv 사용 시:** `uv lock` / `uv sync`로 재현 가능한 락파일을 저장하고 CI에서 `uv run pytest`.

## 순서

1. **목표 버전**을 정하고 로컬에서 상향 후 **`pytest`** (같은 Python 마이너).  
2. **Pydantic v1→v2** 등 메이저면 `schemas.py`·`Field`·validator 문법을 일괄 확인.  
3. **FastAPI** 메이저면 lifespan 등 [공식 마이그레이션](reference.md)을 따른다.  
4. CI의 **Python 마이너**를 `ci.yml`과 로컬 모두 갱신한다.

## 체크리스트

- [ ] `requirements.txt`에 **상한/고정** 정책이 팀과 맞는가  
- [ ] `Optional` / `Union` / `str | None` 이 **CI Python**에서 유효한가  
- [ ] 보안 패치만 올릴 때는 **최소 diff**와 changelog 한 줄

## 에이전트 지침

- 업그레이드 PR에는 **실패한 테스트 수정**을 같은 PR에 포함한다.  
- `pytest.ini`의 `pythonpath` 등 **부트스트랩** 설정을 깨뜨리지 않는다.

## 추가 참고

- 공식 마이그레이션 링크 모음: [reference.md](reference.md)
