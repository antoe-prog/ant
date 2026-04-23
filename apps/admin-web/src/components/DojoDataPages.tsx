import { useCallback, useEffect, useState } from "react";

type CommonProps = {
  dojoClient: any;
  connected: boolean;
};

function LoadError({ err }: { err: string | null }) {
  if (!err) return null;
  return <p className="err">오류: {err}</p>;
}

export function DojoHomePage({ dojoClient, connected }: CommonProps) {
  const [stats, setStats] = useState<any | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!connected) return;
    setErr(null);
    try {
      const s = await dojoClient.dashboard.stats.query();
      setStats(s);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setStats(null);
    }
  }, [connected, dojoClient]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <section className="panel tab-panel page">
      <div className="page-head">
        <h2>🏠 도장 홈</h2>
        <button type="button" onClick={() => void load()} disabled={!connected}>
          새로고침
        </button>
      </div>
      {!connected ? <p className="meta">상단에서 도장 API 로그인을 먼저 진행해 주세요.</p> : null}
      <LoadError err={err} />
      {stats ? (
        <div className="status-meta-grid">
          <div className="status-tile">
            <p className="tile-label">전체 회원</p>
            <p className="tile-value">{stats.totalMembers ?? 0}명</p>
          </div>
          <div className="status-tile">
            <p className="tile-label">활성 회원</p>
            <p className="tile-value">{stats.activeMembers ?? 0}명</p>
          </div>
          <div className="status-tile">
            <p className="tile-label">오늘 출석</p>
            <p className="tile-value">{stats.todayAttendance ?? 0}명</p>
          </div>
        </div>
      ) : null}
    </section>
  );
}

export function MembersPage({ dojoClient, connected }: CommonProps) {
  const [rows, setRows] = useState<any[]>([]);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!connected) return;
    setErr(null);
    try {
      const list = await dojoClient.members.list.query();
      setRows(Array.isArray(list) ? list : []);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setRows([]);
    }
  }, [connected, dojoClient]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <section className="page">
      <div className="page-head">
        <h2>👥 회원</h2>
        <button type="button" onClick={() => void load()} disabled={!connected}>
          새로고침
        </button>
      </div>
      {!connected ? <p className="meta">도장 API 로그인이 필요합니다.</p> : null}
      <LoadError err={err} />
      <div className="user-table-wrap">
        <table className="user-table">
          <thead>
            <tr>
              <th>이름</th>
              <th>상태</th>
              <th>월회비</th>
              <th>다음 납부</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((m) => (
              <tr key={m.id}>
                <td>{m.name}</td>
                <td>{m.status}</td>
                <td>{Number(m.monthlyFee || 0).toLocaleString()}원</td>
                <td>{m.nextPaymentDate || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export function AttendancePage({ dojoClient, connected }: CommonProps) {
  const [rows, setRows] = useState<any[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const load = useCallback(async () => {
    if (!connected) return;
    setErr(null);
    try {
      const list = await dojoClient.attendance.today.query();
      setRows(Array.isArray(list) ? list : []);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setRows([]);
    }
  }, [connected, dojoClient]);
  useEffect(() => {
    void load();
  }, [load]);
  return (
    <section className="panel tab-panel page">
      <div className="page-head">
        <h2>✅ 출석</h2>
        <button type="button" onClick={() => void load()} disabled={!connected}>
          새로고침
        </button>
      </div>
      <LoadError err={err} />
      <p className="meta">오늘 출석 기록: {rows.length}건</p>
    </section>
  );
}

export function PaymentsPage({ dojoClient, connected }: CommonProps) {
  const [unpaid, setUnpaid] = useState<any[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const load = useCallback(async () => {
    if (!connected) return;
    setErr(null);
    try {
      const list = await dojoClient.payments.unpaid.query();
      setUnpaid(Array.isArray(list) ? list : []);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setUnpaid([]);
    }
  }, [connected, dojoClient]);
  useEffect(() => {
    void load();
  }, [load]);
  return (
    <section className="panel tab-panel page">
      <div className="page-head">
        <h2>💳 납부</h2>
        <button type="button" onClick={() => void load()} disabled={!connected}>
          새로고침
        </button>
      </div>
      <LoadError err={err} />
      <p className="meta">미납 회원: {unpaid.length}명</p>
    </section>
  );
}

export function PromotionsPage({ dojoClient, connected }: CommonProps) {
  const [rows, setRows] = useState<any[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const load = useCallback(async () => {
    if (!connected) return;
    setErr(null);
    try {
      const list = await dojoClient.promotions.upcoming.query({ days: 30 });
      setRows(Array.isArray(list) ? list : []);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setRows([]);
    }
  }, [connected, dojoClient]);
  useEffect(() => {
    void load();
  }, [load]);
  return (
    <section className="panel tab-panel page">
      <div className="page-head">
        <h2>🥋 심사</h2>
        <button type="button" onClick={() => void load()} disabled={!connected}>
          새로고침
        </button>
      </div>
      <LoadError err={err} />
      <p className="meta">30일 내 예정 심사: {rows.length}건</p>
    </section>
  );
}

export function TournamentsPage({ dojoClient, connected }: CommonProps) {
  const [rows, setRows] = useState<any[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const load = useCallback(async () => {
    if (!connected) return;
    setErr(null);
    try {
      const list = await dojoClient.tournaments.upcoming.query({ days: 60 });
      setRows(Array.isArray(list) ? list : []);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setRows([]);
    }
  }, [connected, dojoClient]);
  useEffect(() => {
    void load();
  }, [load]);
  return (
    <section className="panel tab-panel page">
      <div className="page-head">
        <h2>🏆 대회</h2>
        <button type="button" onClick={() => void load()} disabled={!connected}>
          새로고침
        </button>
      </div>
      <LoadError err={err} />
      <p className="meta">60일 내 예정 대회: {rows.length}건</p>
    </section>
  );
}

export function AnnouncementsPage({ dojoClient, connected }: CommonProps) {
  const [rows, setRows] = useState<any[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const load = useCallback(async () => {
    if (!connected) return;
    setErr(null);
    try {
      const list = await dojoClient.announcements.list.query();
      setRows(Array.isArray(list) ? list : []);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setRows([]);
    }
  }, [connected, dojoClient]);
  useEffect(() => {
    void load();
  }, [load]);
  return (
    <section className="panel tab-panel page">
      <div className="page-head">
        <h2>📢 공지</h2>
        <button type="button" onClick={() => void load()} disabled={!connected}>
          새로고침
        </button>
      </div>
      <LoadError err={err} />
      <p className="meta">공지 항목: {rows.length}개</p>
    </section>
  );
}
