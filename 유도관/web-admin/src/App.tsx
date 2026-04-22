import { useCallback, useEffect, useMemo, useState } from "react";
import {
  formatAmount,
  formatDate,
  getBeltLabel,
  getMemberStatusLabel,
  type BeltRank,
  type MemberStatus,
} from "@dojo/lib/judo-utils";
import {
  filterMembers,
  sortMembers,
  type MemberRow,
  type MemberSortKey,
} from "./memberSort";
import { createWebAdminTrpc, getStoredToken, setStoredToken } from "./trpc-client";

const SORT_OPTIONS: { key: MemberSortKey; label: string }[] = [
  { key: "name", label: "이름" },
  { key: "joinDate", label: "입관일" },
  { key: "belt", label: "띠" },
  { key: "fee", label: "회비" },
  { key: "nextPayment", label: "납부일" },
];

const defaultApi = import.meta.env.VITE_API_BASE_URL ?? "http://127.0.0.1:3000";

export default function App() {
  const [apiBase, setApiBase] = useState(defaultApi);
  const [tokenInput, setTokenInput] = useState(getStoredToken);
  const [sortKey, setSortKey] = useState<MemberSortKey>("name");
  const [search, setSearch] = useState("");
  const [rows, setRows] = useState<MemberRow[] | null>(null);
  const [me, setMe] = useState<{ name?: string; role?: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const client = useMemo(() => createWebAdminTrpc(apiBase), [apiBase]);

  useEffect(() => {
    const raw = window.location.hash.replace(/^#/, "");
    if (!raw) return;
    const params = new URLSearchParams(raw);
    const session = params.get("session");
    if (!session) return;
    setStoredToken(session);
    setTokenInput(session);
    window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);
  }, []);

  const displayRows = useMemo(() => {
    if (!rows) return [];
    return sortMembers(filterMembers(rows, search), sortKey);
  }, [rows, search, sortKey]);

  const saveToken = useCallback(() => {
    setStoredToken(tokenInput);
    setError(null);
  }, [tokenInput]);

  const loadMembers = useCallback(async () => {
    setLoading(true);
    setError(null);
    setRows(null);
    setMe(null);
    try {
      const profile = await client.auth.me.query();
      setMe({ name: profile.name ?? undefined, role: profile.role });
      if (profile.role !== "manager" && profile.role !== "admin") {
        setError(
          "현재 계정은 관리자(manager/admin)가 아닙니다. 모바일 앱에서 관리자로 로그인한 뒤 세션 토큰을 사용하세요.",
        );
        return;
      }
      const list = await client.members.list.query();
      setRows(list as MemberRow[]);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(
        `${msg}\n\n· API 서버가 켜져 있는지 확인: cd 유도관 && pnpm dev:server (기본 포트 3000)\n· Bearer 토큰이 맞는지 확인 (모바일과 동일 세션).`,
      );
    } finally {
      setLoading(false);
    }
  }, [client]);

  return (
    <div className="layout">
      <h1>유도관 회원 관리 (웹)</h1>
      <p className="meta">
        모바일 탭 <strong>회원(members)</strong>·<strong>관리(admin)</strong>과 동일한 tRPC
        백엔드(<code>members.list</code>, <code>auth.me</code>)를 사용합니다.
      </p>

      <div className="hint">
        <strong>토큰:</strong> Expo 앱 세션과 동일하게 <code>Authorization: Bearer …</code>를
        붙입니다. 서버에 <code>GOOGLE_CLIENT_*</code>가 있으면 아래 링크로 로그인하면{" "}
        <code>#session=…</code>로 돌아와 자동 저장됩니다(서버{" "}
        <code>WEB_ADMIN_POST_LOGIN_URL</code> 권장).
      </div>

      <div className="panel">
        <div className="row">
          <label htmlFor="api">API 베이스</label>
          <input
            id="api"
            type="text"
            value={apiBase}
            onChange={(e) => setApiBase(e.target.value)}
            placeholder="http://127.0.0.1:3000"
          />
        </div>
        <div className="row">
          <label htmlFor="tok">Bearer 토큰</label>
          <input
            id="tok"
            type="password"
            autoComplete="off"
            className="wide"
            value={tokenInput}
            onChange={(e) => setTokenInput(e.target.value)}
            placeholder="세션 JWT"
          />
          <button type="button" className="secondary" onClick={saveToken}>
            토큰 저장
          </button>
          <a
            className="secondary link-btn"
            href={`${apiBase.replace(/\/$/, "")}/api/oauth/google?return=webadmin`}
          >
            Google로 로그인
          </a>
          <button type="button" onClick={() => void loadMembers()} disabled={loading}>
            {loading ? "불러오는 중…" : "회원 목록 불러오기"}
          </button>
        </div>
        {me ? (
          <p className="meta">
            로그인: {me.name ?? "?"} ({me.role})
          </p>
        ) : null}
        {error ? <p className="err">{error}</p> : null}
      </div>

      <div className="panel">
        <div className="row">
          <label htmlFor="q">검색 (이름·전화)</label>
          <input
            id="q"
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            disabled={!rows?.length}
          />
          <label htmlFor="sort">정렬</label>
          <select
            id="sort"
            value={sortKey}
            onChange={(e) => setSortKey(e.target.value as MemberSortKey)}
            disabled={!rows?.length}
          >
            {SORT_OPTIONS.map((o) => (
              <option key={o.key} value={o.key}>
                {o.label}
              </option>
            ))}
          </select>
        </div>

        {rows && rows.length === 0 ? <p className="meta">등록된 회원이 없습니다.</p> : null}

        {displayRows.length > 0 ? (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>이름</th>
                  <th>띠</th>
                  <th>상태</th>
                  <th>월회비</th>
                  <th>다음 납부</th>
                  <th>입관</th>
                  <th>전화</th>
                </tr>
              </thead>
              <tbody>
                {displayRows.map((m) => (
                  <tr key={m.id}>
                    <td>{m.name}</td>
                    <td>{getBeltLabel(m.beltRank as BeltRank)}</td>
                    <td>{getMemberStatusLabel(m.status as MemberStatus)}</td>
                    <td>{formatAmount(m.monthlyFee)}</td>
                    <td>{m.nextPaymentDate ? formatDate(m.nextPaymentDate) : "—"}</td>
                    <td>{formatDate(m.joinDate)}</td>
                    <td>{m.phone ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </div>
    </div>
  );
}
