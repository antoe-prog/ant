# admin-web

비즈니스·운영 데이터를 다루는 **반응형 웹 Admin** 스켈레톤 (PC·Android 브라우저). 첫 화면은 게이트웨이 `GET /health` · `GET /v1/product-vision` 읽기 전용 조회.

## 요구사항

- Node 20+
- 로컬에서 게이트웨이가 떠 있고, `services/gateway`에 `CORS_ALLOW_ORIGINS` 가 비어 있으면 기본으로 `http://localhost:5173` 이 허용된다.

## 실행

```bash
cd apps/admin-web
cp .env.example .env   # 필요 시 VITE_GATEWAY_URL 수정
npm install
npm run dev
```

정상 기동이면 터미널에 `Local: http://localhost:5173/` 가 보인다. **이 상태가 맞다** — 브라우저에서 그 주소로 들어가면 Admin 화면이 뜬다. 같은 Wi-Fi의 휴대폰에서 열려면 터미널에 이어 나오는 **Network** 줄의 `http://192.168.x.x:5173` 주소를 쓰면 된다(`vite.config.ts`의 `server.host: true` 설정).

빌드: `npm run build` → `dist/` 정적 배포 (S3, Netlify, Fly static 등).

## 연결 거부(ERR_CONNECTION_REFUSED)일 때

| 증상 | 원인 | 조치 |
|------|------|------|
| `127.0.0.1` 만 있고 **포트가 없음** | 브라우저가 **80번**으로 접속 | Admin은 **`http://127.0.0.1:5173`** (Vite) |
| `:5173` 인데 거부 | **Vite 미실행** | `npm run dev` 또는 바탕화면 **모바일GenAI-Admin-개발서버.command** |
| Admin은 뜨는데 API 오류 | **게이트웨이 미실행** | `http://127.0.0.1:8000` 에 `uvicorn` 또는 docker compose |
| 당장 백엔드 없이 화면만 보고 싶음 | — | 화면에서 **「데모 데이터로 보기」** — `src/mockGatewaySnapshot.ts` 스냅샷 표시 |

`.webloc` 은 **주소만** 엽니다. 서버를 같이 띄우려면 **`.command`** 를 사용하세요.

## 바탕화면 바로가기 (macOS)

저장소에서:

```bash
cd apps/admin-web/desktop
chmod +x install-desktop-shortcuts.sh   # 최초 1회
./install-desktop-shortcuts.sh
```

바탕화면에 다음이 생긴다.

- **모바일GenAI-Admin.webloc** — `http://127.0.0.1:5173` 을 기본 브라우저로 연다 (Vite가 떠 있어야 함).
- **모바일GenAI-Admin-개발서버.command** — 이 클론의 `apps/admin-web`으로 이동해 `npm install` 후 `npm run dev` 를 실행하고, 같은 URL을 연다.

다른 경로에 클론했다면 스크립트를 **그 클론 안에서** 다시 실행해 `.command` 안의 절대 경로를 갱신한다. 바탕화면 폴더가 다르면 `DESKTOP_DIR=... ./install-desktop-shortcuts.sh` 로 지정한다.

## 바탕화면 바로가기 (Windows)

저장소에서 PowerShell 실행:

```powershell
cd apps/admin-web/desktop
powershell -ExecutionPolicy Bypass -File .\install-desktop-shortcuts.ps1
```

원하는 폴더에 만들려면:

```powershell
powershell -ExecutionPolicy Bypass -File .\install-desktop-shortcuts.ps1 -DesktopDir "C:\Users\<사용자>\Desktop"
```

생성 파일:

- **MobileGenAI-Admin.url** — `http://127.0.0.1:5173/` 주소만 열기 (Vite가 떠 있어야 함)
- **MobileGenAI-Admin-DevServer.cmd** — 이 클론의 `apps/admin-web`로 이동해 `npm install` 후 `npm run dev` 실행
