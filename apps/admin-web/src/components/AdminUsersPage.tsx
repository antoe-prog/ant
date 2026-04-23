import { useCallback, useEffect, useState } from "react";

import { useAuth } from "../auth/AuthContext";
import { gatewayFetch } from "../gatewayFetch";

type AdminUser = {
  id: string;
  email: string;
  name: string;
  role: string;
  createdAt: number | null;
  lastSignedIn: number | null;
};

type AdminUsersResponse = {
  users: AdminUser[];
  count: number;
};

function formatUnixTs(value: number | null): string {
  if (!value) return "—";
  try {
    return new Date(value * 1000).toLocaleString();
  } catch {
    return "—";
  }
}

export default function AdminUsersPage({ gatewayBase }: { gatewayBase: string }) {
  const { token, logout } = useAuth();
  const [rows, setRows] = useState<AdminUser[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setErr(null);
    try {
      const data = await gatewayFetch<AdminUsersResponse>(gatewayBase, "/v1/admin/users", {
        token,
        onUnauthorized: () => void logout(),
      });
      setRows(data.users);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [gatewayBase, token, logout]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <section className="page">
      <div className="page-head">
        <h2>회원/계정 목록</h2>
        <button type="button" onClick={() => void load()} disabled={loading}>
          {loading ? "불러오는 중…" : "새로고침"}
        </button>
      </div>

      {err ? <p className="err">오류: {err}</p> : null}

      {rows.length === 0 && !loading && !err ? (
        <p className="meta">등록된 계정이 없습니다.</p>
      ) : null}

      <div className="user-table-wrap">
        <table className="user-table">
          <thead>
            <tr>
              <th>이메일</th>
              <th>이름</th>
              <th>역할</th>
              <th>가입일</th>
              <th>최근 로그인</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((u) => (
              <tr key={u.id}>
                <td>{u.email}</td>
                <td>{u.name || "—"}</td>
                <td>
                  <span className={`role-badge role-${u.role}`}>{u.role}</span>
                </td>
                <td>{formatUnixTs(u.createdAt)}</td>
                <td>{formatUnixTs(u.lastSignedIn)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
