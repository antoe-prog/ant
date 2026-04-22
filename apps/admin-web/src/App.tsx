import { useCallback, useEffect, useState } from "react";

import { mockHealth, mockProductVision } from "./mockGatewaySnapshot";

const gatewayBase = import.meta.env.VITE_GATEWAY_URL ?? "http://127.0.0.1:8000";

function formatLoadError(e: unknown, gateway: string): string {
  const msg = e instanceof Error ? e.message : String(e);
  const networkish =
    msg === "Failed to fetch" ||
    msg.includes("NetworkError") ||
    msg.includes("Load failed");
  if (networkish) {
    return [
      `API에 연결하지 못했습니다: ${gateway}`,
      "",
      "· 게이트웨이가 꺼져 있으면 브라우저에서 연결이 거부됩니다.",
      "  예: cd services/gateway && uvicorn app.main:app --reload --host 0.0.0.0 --port 8000",
      "  또는 infra/local 에서 docker compose up 후 gateway 컨테이너 확인.",
      "",
      "· 주소 혼동: 이 Admin 페이지는 Vite 포트 :5173, API는 보통 :8000 입니다.",
      "  주소창이 http://127.0.0.1 만이면(포트 없음) 다른 프로그램이 아니라 잘못된 URL입니다.",
    ].join("\n");
  }
  return msg;
}

async function fetchJson(path: string): Promise<unknown> {
  const url = `${gatewayBase.replace(/\/$/, "")}${path}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`${res.status} ${res.statusText}`);
  }
  return res.json();
}

export default function App() {
  const [health, setHealth] = useState<unknown>(null);
  const [vision, setVision] = useState<unknown>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [demoMode, setDemoMode] = useState(false);

  const applyDemo = useCallback(() => {
    setDemoMode(true);
    setError(null);
    setHealth(mockHealth);
    setVision(mockProductVision);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setDemoMode(false);
    try {
      const [h, v] = await Promise.all([
        fetchJson("/health"),
        fetchJson("/v1/product-vision"),
      ]);
      setHealth(h);
      setVision(v);
    } catch (e) {
      setHealth(null);
      setVision(null);
      setError(formatLoadError(e, gatewayBase));
    } finally {
      setLoading(false);
    }
  }, [gatewayBase]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="layout">
      <header>
        <h1>운영 Admin (스켈레톤)</h1>
        <p className="meta subnote">
          최종 사용자 앱 UI가 아니라, 개발·운영 중 <strong>게이트웨이 응답을 빨리 확인</strong>하기 위한 최소 화면이다.
          `/health`·`/v1/product-vision` 이 채워지면 이 단계 목표는 달성된 것이다.
        </p>
        <div className="hint" role="note">
          이 화면은 <strong>Vite 개발 서버</strong>입니다. 터미널의{" "}
          <code>Local: http://localhost:5173/</code> 주소로 접속하면 된다(지금처럼
          뜨면 정상). 휴대폰에서는 터미널에 나오는 <strong>Network</strong> 주소(
          <code>192.168…:5173</code>)를 쓴다. 바탕화면{" "}
          <strong>모바일GenAI-Admin-개발서버.command</strong>는 서버를 띄운 뒤 브라우저를
          연다. <code>.webloc</code> 은 서버 없이 누르면 연결이 거부될 수 있다.
        </div>
        <p className="meta">
          API 게이트웨이(데이터 출처): <code>{gatewayBase}</code> — 배포 시{" "}
          <code>VITE_GATEWAY_URL</code> 로 바꿉니다. CORS는 게이트웨이{" "}
          <code>CORS_ALLOW_ORIGINS</code> 에 Admin 출처를 넣습니다.
        </p>
      </header>
      {demoMode ? (
        <div className="warn" role="status">
          게이트웨이에 연결되지 않아 <strong>내장 데모 JSON</strong>을 표시 중입니다. 실제
          API를 쓰려면 터미널에서 게이트웨이를 띄운 뒤 아래 버튼을 누르세요.
        </div>
      ) : null}
      <div className="toolbar">
        <button type="button" onClick={() => void load()} disabled={loading}>
          {loading ? "불러오는 중…" : demoMode ? "실제 API 연결 시도" : "다시 불러오기"}
        </button>
        {error && !demoMode ? (
          <button type="button" onClick={applyDemo} disabled={loading}>
            데모 데이터로 보기
          </button>
        ) : null}
      </div>
      {error && !demoMode ? <p className="err">오류: {error}</p> : null}
      <section className="panel">
        <h2>GET /health</h2>
        <pre>{health ? JSON.stringify(health, null, 2) : "—"}</pre>
      </section>
      <section className="panel">
        <h2>GET /v1/product-vision</h2>
        <pre>{vision ? JSON.stringify(vision, null, 2) : "—"}</pre>
      </section>
    </div>
  );
}
