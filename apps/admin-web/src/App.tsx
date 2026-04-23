import { useCallback, useEffect, useMemo, useState } from "react";
import { NavLink, Navigate, Route, Routes } from "react-router-dom";

import LoginPage from "./auth/LoginPage";
import { useAuth } from "./auth/AuthContext";
import {
  AnnouncementsPage,
  AttendancePage,
  DojoHomePage,
  MembersPage,
  PaymentsPage,
  PromotionsPage,
  TournamentsPage,
} from "./components/DojoDataPages";
import SettingsPage from "./components/SettingsPage";
import SummaryCards from "./components/SummaryCards";
import {
  createDojoTrpcClient,
  readDojoApiBase,
  readDojoToken,
  writeDojoApiBase,
  writeDojoToken,
} from "./dojoClient";
import { resolveGatewayBase } from "./gateway";
import { gatewayFetch } from "./gatewayFetch";
import type { HealthResponse } from "./types";

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
    ].join("\n");
  }
  return msg;
}

function formatDateKo(d: Date): string {
  return `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일`;
}

function getGreeting(d: Date): string {
  const h = d.getHours();
  if (h < 6) return "새벽까지 수고하세요";
  if (h < 12) return "좋은 아침이에요";
  if (h < 18) return "안녕하세요";
  return "수고하셨어요";
}

function initialsOf(user: { name?: string; email: string }): string {
  const src = (user.name || user.email || "").trim();
  if (!src) return "?";
  return src.slice(0, 1).toUpperCase();
}

export default function App() {
  const gatewayBase = resolveGatewayBase();
  const { ready, user, token, logout } = useAuth();
  const isAdmin = user?.role === "admin";
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [userCount, setUserCount] = useState(0);
  const [adminCount, setAdminCount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<string | null>(null);
  const [latencyMs, setLatencyMs] = useState<number | null>(null);
  const [dojoApiBase, setDojoApiBase] = useState(readDojoApiBase);
  const [dojoToken, setDojoToken] = useState(readDojoToken);
  const [dojoEmail, setDojoEmail] = useState("");
  const [dojoPassword, setDojoPassword] = useState("");
  const [dojoLoading, setDojoLoading] = useState(false);
  const [dojoError, setDojoError] = useState<string | null>(null);

  const dojoClient = useMemo(
    () => createDojoTrpcClient(dojoApiBase, dojoToken),
    [dojoApiBase, dojoToken],
  );
  const dojoConnected = dojoToken.trim().length > 0;

  const load = useCallback(async () => {
    const start = performance.now();
    setLoading(true);
    setError(null);
    try {
      const h = await gatewayFetch<HealthResponse>(gatewayBase, "/health");
      setHealth(h);
      if (isAdmin && token) {
        const data = await gatewayFetch<{
          users: Array<{ role: string }>;
          count: number;
        }>(gatewayBase, "/v1/admin/users", {
          token,
          onUnauthorized: () => void logout(),
        });
        setUserCount(data.count);
        setAdminCount(data.users.filter((u) => u.role === "admin").length);
      } else {
        setUserCount(0);
        setAdminCount(0);
      }
      setLastUpdatedAt(new Date().toLocaleTimeString());
      setLatencyMs(Math.round(performance.now() - start));
    } catch (e) {
      setHealth(null);
      setUserCount(0);
      setAdminCount(0);
      setError(formatLoadError(e, gatewayBase));
      setLatencyMs(Math.round(performance.now() - start));
    } finally {
      setLoading(false);
    }
  }, [gatewayBase, isAdmin, logout, token]);

  useEffect(() => {
    if (user) void load();
  }, [load, user]);

  const now = useMemo(() => new Date(), [lastUpdatedAt]);

  const saveDojoApiBase = useCallback(() => {
    writeDojoApiBase(dojoApiBase);
    setDojoError(null);
  }, [dojoApiBase]);

  const dojoLogin = useCallback(async () => {
    setDojoLoading(true);
    setDojoError(null);
    try {
      const loginClient = createDojoTrpcClient(dojoApiBase, "") as any;
      const result = await loginClient.auth.login.mutate({
        email: dojoEmail.trim().toLowerCase(),
        password: dojoPassword,
      });
      const token = result?.app_session_id || "";
      if (!token) throw new Error("도장 세션 토큰을 받지 못했습니다.");
      setDojoToken(token);
      writeDojoToken(token);
      setDojoPassword("");
    } catch (e) {
      setDojoError(e instanceof Error ? e.message : String(e));
    } finally {
      setDojoLoading(false);
    }
  }, [dojoApiBase, dojoEmail, dojoPassword]);

  const dojoLogout = useCallback(() => {
    setDojoToken("");
    writeDojoToken("");
    setDojoError(null);
  }, []);

  if (!ready) {
    return (
      <div className="auth-shell">
        <div className="auth-card">
          <p className="meta">세션 확인 중…</p>
        </div>
      </div>
    );
  }

  if (!user) {
    return <LoginPage gatewayBase={gatewayBase} />;
  }

  const isHealthy = health?.status === "ok";
  const greetingName = user.name?.trim() || user.email.split("@")[0] || "운영자";

  return (
    <div className="layout">
      <header className="topbar">
        <div className="topbar-left">
          <p className="topbar-date">{formatDateKo(now)}</p>
          <h1 className="topbar-greeting">
            {getGreeting(now)}, {greetingName}님 👋
          </h1>
          <span className="topbar-meta" aria-live="polite">
            <span className={`live-dot ${isHealthy ? "" : "pending"}`} />
            {lastUpdatedAt
              ? `${lastUpdatedAt} 업데이트`
              : loading
                ? "불러오는 중…"
                : "연결 대기"}
          </span>
        </div>
        <div className="topbar-right">
          <button
            type="button"
            className="reload-btn"
            onClick={() => void load()}
            disabled={loading}
            aria-label="다시 불러오기"
          >
            <span aria-hidden="true">🔄</span>
            {loading ? "불러오는 중" : "다시 불러오기"}
          </button>
          <div className="user-chip">
            <span className="avatar" aria-hidden="true">
              {initialsOf(user)}
            </span>
            <span>
              <span className="user-name">
                {user.name || user.email.split("@")[0]}
              </span>
              <br />
              <span className="user-role">{user.role}</span>
            </span>
            <button
              type="button"
              className="logout-btn"
              onClick={() => void logout()}
            >
              로그아웃
            </button>
          </div>
        </div>
      </header>

      {error ? (
        <div className="banner err" role="alert">
          <span className="banner-icon" aria-hidden="true">
            🚫
          </span>
          <div className="banner-body">
            <p className="banner-title">API 연결 실패</p>
            <p className="banner-desc">{error}</p>
          </div>
        </div>
      ) : null}

      <SummaryCards
        healthStatus={health?.status}
        userCount={userCount}
        adminCount={adminCount}
        latencyMs={latencyMs}
      />

      <section className="panel page" style={{ marginBottom: 14 }}>
        <div className="page-head">
          <h2>도장 데이터 연결</h2>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
          <input
            value={dojoApiBase}
            onChange={(e) => setDojoApiBase(e.target.value)}
            placeholder="도장 API 베이스 (예: http://127.0.0.1:3000)"
            style={{ flex: "1 1 320px", padding: "10px 12px", borderRadius: 10, border: "1px solid #cbd5e1" }}
          />
          <button type="button" className="reload-btn" onClick={saveDojoApiBase}>
            API 저장
          </button>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 6 }}>
          <input
            type="email"
            value={dojoEmail}
            onChange={(e) => setDojoEmail(e.target.value)}
            placeholder="도장 관리자 이메일"
            style={{ flex: "1 1 220px", padding: "10px 12px", borderRadius: 10, border: "1px solid #cbd5e1" }}
          />
          <input
            type="password"
            value={dojoPassword}
            onChange={(e) => setDojoPassword(e.target.value)}
            placeholder="도장 비밀번호"
            style={{ flex: "1 1 220px", padding: "10px 12px", borderRadius: 10, border: "1px solid #cbd5e1" }}
          />
          <button type="button" className="reload-btn" onClick={() => void dojoLogin()} disabled={dojoLoading}>
            {dojoLoading ? "로그인 중…" : "도장 로그인"}
          </button>
          {dojoConnected ? (
            <button type="button" className="reload-btn" onClick={dojoLogout}>
              도장 로그아웃
            </button>
          ) : null}
        </div>
        <p className="meta" style={{ margin: 0 }}>
          상태: {dojoConnected ? "연결됨" : "미연결"}
        </p>
        {dojoError ? <p className="err">{dojoError}</p> : null}
      </section>

      <p className="section-title">빠른 메뉴</p>
      <nav className="quick-grid" aria-label="빠른 메뉴">
        <NavLink to="/home" className="quick-tile" data-tone="blue">
          <span className="quick-icon" aria-hidden="true">
            🏠
          </span>
          홈
        </NavLink>
        <NavLink to="/members" className="quick-tile" data-tone="green">
          <span className="quick-icon" aria-hidden="true">
            👥
          </span>
          회원
        </NavLink>
        <NavLink to="/attendance" className="quick-tile" data-tone="purple">
          <span className="quick-icon" aria-hidden="true">
            ✅
          </span>
          출석
        </NavLink>
        <NavLink to="/payments" className="quick-tile" data-tone="orange">
          <span className="quick-icon" aria-hidden="true">
            💳
          </span>
          납부
        </NavLink>
      </nav>

      <p className="section-title">도장 메뉴</p>
      <nav className="tab-row top-nav" aria-label="도장 메뉴">
        <NavLink
          to="/home"
          className={({ isActive }) =>
            `tab-button ${isActive ? "active" : ""}`
          }
        >
          홈
        </NavLink>
        <NavLink
          to="/members"
          className={({ isActive }) =>
            `tab-button ${isActive ? "active" : ""}`
          }
        >
          회원
        </NavLink>
        <NavLink
          to="/attendance"
          className={({ isActive }) =>
            `tab-button ${isActive ? "active" : ""}`
          }
        >
          출석
        </NavLink>
        <NavLink
          to="/payments"
          className={({ isActive }) =>
            `tab-button ${isActive ? "active" : ""}`
          }
        >
          납부
        </NavLink>
        <NavLink
          to="/promotions"
          className={({ isActive }) =>
            `tab-button ${isActive ? "active" : ""}`
          }
        >
          심사
        </NavLink>
        <NavLink
          to="/tournaments"
          className={({ isActive }) =>
            `tab-button ${isActive ? "active" : ""}`
          }
        >
          대회
        </NavLink>
        <NavLink
          to="/announcements"
          className={({ isActive }) =>
            `tab-button ${isActive ? "active" : ""}`
          }
        >
          공지
        </NavLink>
        <NavLink
          to="/settings"
          className={({ isActive }) =>
            `tab-button ${isActive ? "active" : ""}`
          }
        >
          설정
        </NavLink>
      </nav>

      <Routes>
        <Route
          path="/home"
          element={<DojoHomePage dojoClient={dojoClient} connected={dojoConnected} />}
        />
        <Route
          path="/members"
          element={<MembersPage dojoClient={dojoClient} connected={dojoConnected} />}
        />
        <Route
          path="/attendance"
          element={<AttendancePage dojoClient={dojoClient} connected={dojoConnected} />}
        />
        <Route
          path="/payments"
          element={<PaymentsPage dojoClient={dojoClient} connected={dojoConnected} />}
        />
        <Route
          path="/promotions"
          element={<PromotionsPage dojoClient={dojoClient} connected={dojoConnected} />}
        />
        <Route
          path="/tournaments"
          element={<TournamentsPage dojoClient={dojoClient} connected={dojoConnected} />}
        />
        <Route
          path="/announcements"
          element={<AnnouncementsPage dojoClient={dojoClient} connected={dojoConnected} />}
        />
        <Route
          path="/settings"
          element={<SettingsPage gatewayBase={gatewayBase} />}
        />
        <Route path="*" element={<Navigate to="/home" replace />} />
      </Routes>

      <nav className="bottom-nav" aria-label="모바일 하단 네비게이션">
        <NavLink
          to="/home"
          className={({ isActive }) =>
            `bottom-item ${isActive ? "active" : ""}`
          }
        >
          <span className="bi-icon" aria-hidden="true">
            🏠
          </span>
          홈
        </NavLink>
        <NavLink
          to="/members"
          className={({ isActive }) =>
            `bottom-item ${isActive ? "active" : ""}`
          }
        >
          <span className="bi-icon" aria-hidden="true">
            👥
          </span>
          회원
        </NavLink>
        <NavLink
          to="/attendance"
          className={({ isActive }) =>
            `bottom-item ${isActive ? "active" : ""}`
          }
        >
          <span className="bi-icon" aria-hidden="true">
            ✅
          </span>
          출석
        </NavLink>
        <NavLink
          to="/payments"
          className={({ isActive }) =>
            `bottom-item ${isActive ? "active" : ""}`
          }
        >
          <span className="bi-icon" aria-hidden="true">
            💳
          </span>
          납부
        </NavLink>
        <NavLink
          to="/settings"
          className={({ isActive }) =>
            `bottom-item ${isActive ? "active" : ""}`
          }
        >
          <span className="bi-icon" aria-hidden="true">
            ⚙️
          </span>
          설정
        </NavLink>
      </nav>
    </div>
  );
}
