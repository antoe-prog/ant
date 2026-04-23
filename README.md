# Personal Mobile GenAI App Template

Native iOS/Android clients with a backend AI gateway template for personal assistant use cases.

## Monorepo Layout

- `apps/ios`: iOS app skeleton (SwiftUI + MVVM)
- `apps/android`: Android app skeleton (Kotlin + Compose + MVI)
- `apps/admin-web`: **운영 Admin** 반응형 웹 스켈레톤 (Vite + React, 게이트웨이 읽기 전용) — [apps/admin-web/README.md](apps/admin-web/README.md)
- `services/gateway`: FastAPI gateway with provider abstraction
- `infra`: Infrastructure as code templates
- `docs`: Product, architecture, A–Z plan, operations, release — 루트 md는 목차, 상세는 `docs/plan/`, `docs/product/`, `docs/operations/`, `docs/release/`, `docs/architecture/`, 에이전트 연속 작업은 [docs/agent/continuation-playbook.md](docs/agent/continuation-playbook.md)
- `유도관/`: **도장 회원 관리**용 Expo + tRPC + MySQL 앱(표시 이름「유도관」). 루트 네이티브 앱·FastAPI 게이트웨이와는 **별도 스택** — [유도관/README.md](유도관/README.md) 참고.
- `.github/workflows`: CI pipelines

## Quick Start

1. Copy `services/gateway/.env.example` to `services/gateway/.env` and set API keys as needed.
2. **게이트웨이 켜기 (택일):**
   - **Docker 있음:** `cd infra/local && docker compose up -d` — Postgres, Redis, 게이트웨이가 함께 뜸 (`http://localhost:8000/health`).
   - **Docker 없음** (`zsh: command not found: docker`): [Docker Desktop for Mac](https://docs.docker.com/desktop/install/mac-install/) 설치 후 터미널을 다시 열거나, Docker 없이 **`cd services/gateway && python3 -m uvicorn app.main:app --reload --host 0.0.0.0 --port 8000`** 만 실행해도 된다(`/health`, `/v1/product-vision` 등은 DB 없이 동작).
3. Point mobile apps to `http://localhost:8000` (or your machine LAN IP from a device).

4. **운영 Admin (선택):** Admin UI는 **`http://127.0.0.1:5173`** (Vite). `apps/admin-web`에서 `npm install && npm run dev` — API는 기본 **`http://127.0.0.1:8000`**. 주소창에 포트 없이 `127.0.0.1` 만 있으면 연결 거부가 난다. 바탕화면 **모바일GenAI-Admin-개발서버.command**가 서버를 띄운 뒤 브라우저를 연다. 자세한 트러블슈팅은 [apps/admin-web/README.md](apps/admin-web/README.md).

## Deploy gateway (PaaS / Fly.io)

1. Install [flyctl](https://fly.io/docs/hands-on/install-flyctl/), then from `services/gateway`: `fly auth login`.
2. If the name in `fly.toml` is taken, set `app` to a unique name and run `fly apps create <that-name>` (or run `fly launch` and merge settings into this file).
3. Set secrets, for example: `fly secrets set OPENAI_API_KEY=...` (and `ANTHROPIC_API_KEY` if you use Anthropic). Optional URLs for Postgres/Redis on Fly or external DBs can be set the same way to match `app/config.py` env names.
4. Deploy: `fly deploy` (build context is this directory; see `Dockerfile` and `fly.toml`).
5. GitHub Actions: add repository secret `FLY_API_TOKEN`, then run workflow **Deploy gateway (Fly.io)** manually.
6. **Admin 웹**을 같은 오리진이 아닌 URL에 올릴 경우: `fly secrets set CORS_ALLOW_ORIGINS=https://<admin-호스트>,https://<다른-호스트>` 로 게이트웨이 CORS를 맞춘다.

## 자체 회원가입(Self-Auth) 통합

외부 OAuth(Kakao/Instagram/Google) 의존 없이 **이메일 + 비밀번호** 로 양 시스템에서 자체 가입이 가능합니다.

### admin-web ↔ Gateway (FastAPI)

- 엔드포인트(모두 `services/gateway`):
  - `POST /v1/auth/register` — `{email, password(>=8), name}` → `{token, user}`
  - `POST /v1/auth/login`
  - `GET  /v1/auth/me` (Bearer)
  - `POST /v1/auth/password` (Bearer) — `{current_password, new_password}`
  - `POST /v1/auth/logout`
  - `GET  /v1/admin/users` (admin 전용)
- 저장소: `services/gateway/data/users.json` (JSON 파일, `.gitignore` 처리됨)
- 비밀번호 해시: 표준 `hashlib.scrypt`, 토큰: HMAC-SHA256 서명(JWT 호환 구조)
- **첫 가입자는 자동으로 `admin` 역할**이 부여된다. `AUTH_BOOTSTRAP_ADMIN_EMAIL` 로 특정 이메일을 강제 admin 지정 가능.
- 보호된 API: `/v1/product-vision`, `/v1/chat`, `/v1/usage` 는 로그인 필수. `user_id` 가 자기 것이 아니면 admin 만 허용.

### admin-web 실행 / 배포

- **개발**: `cd apps/admin-web && npm run dev` (Vite :5173) + `cd services/gateway && uvicorn app.main:app --reload --host 0.0.0.0 --port 8000`
- **프로덕션 번들 + 단일 서버 서빙**: `cd apps/admin-web && npm run build` → 결과물은 `services/gateway/app/web-dist/` 로 출력되고, gateway 재시작 시 **`http://<호스트>:8000/admin`** 에서 자동 서빙된다(SPA fallback 포함). 이 모드에서 브라우저는 같은 오리진(:8000)으로 API를 호출하므로 CORS 설정 없이 동작한다.

### 유도관 앱 ↔ Gateway 통합

유도관 Expo 앱은 기본적으로 **자체 tRPC 서버**의 이메일/비밀번호 가입을 사용한다. 여기에 `EXPO_PUBLIC_GATEWAY_BASE_URL` 를 설정하면:

1. 유도관 앱에서 회원가입/로그인 성공 시, 동일한 자격증명으로 gateway `/v1/auth/register`(409 → `/login`)를 **미러링 호출**한다.
2. 성공 시 gateway 세션 토큰이 `SecureStore`(native) / `localStorage`(web)에 `gateway_session_token` 로 저장된다.
3. 로그아웃하면 양쪽 세션이 함께 정리된다.
4. gateway 연결 실패/미설정이어도 유도관 앱 동작에는 영향이 없다(조용히 무시).

결과적으로 사용자는 **같은 이메일 + 비밀번호** 한 벌로 admin-web과 유도관 앱 모두에 가입·로그인할 수 있다. 내부적으로는 두 DB(유도관 MySQL, gateway JSON)에 동일 계정이 각각 생성되는 "이중 저장소 + 동일 자격증명" 패턴이다.

## Template Milestones

- A-B: Product scope and architecture
- C-H: Repository bootstrap and app/backend skeleton
- I-O: Prompt/provider/memory/security/cost guardrails
- P-R: Mobile chat/settings/history UX
- S-Z: Testing, CI/CD, infra, docs, release
