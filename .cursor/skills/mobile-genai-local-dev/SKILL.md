---
name: mobile-genai-local-dev
description: >-
  Boots this monorepo locally: gateway PYTHONPATH, docker compose, .env from
  examples, and mobile base URL checks. Use when the user asks for local setup,
  first run, "gateway won't start", iOS/Android cannot reach API, or environment
  variables. Korean: 로컬 실행, 세팅, 게이트웨이 안 됨.
---

# 모바일 GenAI 템플릿 — 로컬 개발

## 관련 스킬

- SSOT·중복·드리프트: [prevent-duplicate-code-conflicts](../prevent-duplicate-code-conflicts/SKILL.md)

## 전제

- 저장소 루트: `mobile-genai-template`
- 게이트웨이: `services/gateway`
- 인프라 예시: [`infra/local/docker-compose.yml`](../../../infra/local/docker-compose.yml) — Postgres **5432**, Redis **6379** 호스트 바인딩.

## 권장 순서

1. **게이트웨이 `.env`**  
   - `services/gateway/.env.example`를 복사해 `.env` 생성.  
   - API 키·`DAILY_BUDGET_USD` 등 필수 키가 비어 있지 않은지 확인.

2. **의존성**  
   - `cd services/gateway && python -m venv .venv && source .venv/bin/activate` (Windows는 `Activate.ps1`).  
   - `pip install -r requirements.txt`

3. **DB/캐시 등**  
   - `cd infra/local && docker compose up -d` (Postgres·Redis 기동). 게이트웨이가 이 DB/Redis를 쓰도록 설정했는지 확인(템플릿 기본은 미연결일 수 있음).

4. **게이트웨이 실행**  
   - 작업 디렉터리 `services/gateway`.  
   - 테스트·도구: `PYTHONPATH=.` 또는 `pytest.ini`의 `pythonpath`가 있으면 `pytest -q`.  
   - 서버: `uvicorn app.main:app --reload` (프로젝트 관례에 따름).

5. **모바일 → 게이트웨이**  
   - 에뮬레이터/실기에서 접근 가능한 호스트 사용 (`10.0.2.2` 등 Android, Mac IP for iOS Simulator).  
   - 앱의 base URL이 README·`docs/product`에 적힌 환경과 동일한지 확인.

## 문제 나누기

| 증상 | 먼저 볼 곳 |
|------|------------|
| `ModuleNotFoundError: app` | `cwd`가 `services/gateway`인지, `pytest.ini` / `PYTHONPATH=.` |
| 401/403 없이 연결 실패 | 호스트·포트·HTTPS 여부, 방화벽 |
| LLM 오류 | `.env` 키, provider 이름, `services/gateway` 로그 |

## 에이전트 지침

- 사용자 OS를 가정하지 말고, **한 플랫폼씩** 명령을 나눈다.  
- 새 의존성을 추가하면 `requirements.txt`와 한 줄 README/문서를 같이 갱신한다.

## 추가 참고

- 에뮬레이터 호스트·`curl` 예시: [reference.md](reference.md)
