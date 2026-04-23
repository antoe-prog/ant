import { useCallback, useEffect, useState } from "react";

type CommonProps = {
  dojoClient: any;
  connected: boolean;
  userRole?: "member" | "manager" | "admin" | string;
};

function LoadError({ err }: { err: string | null }) {
  if (!err) return null;
  return <p className="err">오류: {err}</p>;
}

function normalizeText(v: unknown): string {
  if (v == null) return "";
  return String(v).trim().toLowerCase();
}

function toDate(v: unknown): Date | null {
  if (!v) return null;
  const d = new Date(String(v));
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

function daysUntil(v: unknown): number | null {
  const d = toDate(v);
  if (!d) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  d.setHours(0, 0, 0, 0);
  return Math.floor((d.getTime() - today.getTime()) / 86400000);
}

function StatusBadge({
  tone,
  children,
}: {
  tone: "ok" | "warn" | "danger" | "muted";
  children: string;
}) {
  return <span className={`status-badge ${tone}`}>{children}</span>;
}

function EmptyState({ label }: { label: string }) {
  return <p className="meta empty-state">{label}</p>;
}

function ActionError({
  err,
  onRetry,
}: {
  err: string | null;
  onRetry: (() => Promise<void>) | null;
}) {
  if (!err) return null;
  return (
    <div className="action-feedback">
      <p className="err" style={{ margin: 0 }}>
        {err}
      </p>
      {onRetry ? (
        <button type="button" className="retry-btn" onClick={() => void onRetry()}>
          다시 시도
        </button>
      ) : null}
    </div>
  );
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

export function MembersPage({ dojoClient, connected, userRole }: CommonProps) {
  const [rows, setRows] = useState<any[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [newFee, setNewFee] = useState("150000");
  const [actionErr, setActionErr] = useState<string | null>(null);
  const canManage = userRole === "admin" || userRole === "manager";
  const canDelete = userRole === "admin";

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

  const filtered = rows.filter((m) => {
    const name = normalizeText(m.name);
    const phone = normalizeText(m.phone || m.phoneNumber);
    const belt = normalizeText(m.belt || m.beltLevel);
    const status = normalizeText(m.status || "unknown");
    const q = normalizeText(query);

    const matchQuery =
      q.length === 0 || name.includes(q) || phone.includes(q) || belt.includes(q);
    const matchStatus = statusFilter === "all" || status === statusFilter;
    return matchQuery && matchStatus;
  });

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
      <div className="toolbar">
        <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="신규 회원 이름" />
        <input value={newFee} onChange={(e) => setNewFee(e.target.value)} placeholder="월회비(숫자)" />
        <button
          type="button"
          onClick={async () => {
            if (!newName.trim()) return;
            setCreating(true);
            setActionErr(null);
            try {
              const today = new Date().toISOString().slice(0, 10);
              await dojoClient.members.create.mutate({
                name: newName.trim(),
                joinDate: today,
                monthlyFee: Number(newFee || 0),
                status: "active",
                beltRank: "white",
                beltDegree: 1,
              });
              setNewName("");
              await load();
            } catch (e) {
              setActionErr(e instanceof Error ? e.message : String(e));
            } finally {
              setCreating(false);
            }
          }}
          disabled={!connected || creating || !canManage}
        >
          {creating ? "추가 중..." : "회원 추가"}
        </button>
      </div>
      {!canManage ? <p className="meta">회원 추가는 manager/admin 권한에서만 가능합니다.</p> : null}
      <ActionError err={actionErr} onRetry={canManage ? load : null} />
      <div className="toolbar">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="이름/연락처/띠로 검색"
        />
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="all">전체 상태</option>
          <option value="active">활성</option>
          <option value="inactive">비활성</option>
          <option value="pending">대기</option>
        </select>
      </div>
      <p className="meta toolbar-meta">필터 결과: {filtered.length}명</p>
      <div className="user-table-wrap">
        <table className="user-table">
          <thead>
            <tr>
              <th>이름</th>
              <th>띠</th>
              <th>상태</th>
              <th>월회비</th>
              <th>다음 납부</th>
              <th>관리</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((m) => {
              const status = normalizeText(m.status || "unknown");
              const tone =
                status === "active"
                  ? "ok"
                  : status === "inactive"
                    ? "danger"
                    : "warn";
              return (
              <tr key={m.id}>
                <td>{m.name}</td>
                <td>{m.belt || m.beltLevel || "—"}</td>
                <td>
                  <StatusBadge tone={tone}>{m.status || "unknown"}</StatusBadge>
                </td>
                <td>{Number(m.monthlyFee || 0).toLocaleString()}원</td>
                <td>{m.nextPaymentDate || "—"}</td>
                <td>
                  <button
                    type="button"
                    className="danger-btn"
                    onClick={async () => {
                      if (!window.confirm(`${m.name ?? "해당 회원"}을(를) 삭제할까요?`)) return;
                      try {
                        await dojoClient.members.delete.mutate({ id: m.id });
                        await load();
                      } catch (e) {
                        setActionErr(e instanceof Error ? e.message : String(e));
                      }
                    }}
                    disabled={!connected || !canDelete}
                  >
                    삭제
                  </button>
                </td>
              </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {connected && filtered.length === 0 ? <EmptyState label="조건에 맞는 회원이 없습니다." /> : null}
    </section>
  );
}

export function AttendancePage({ dojoClient, connected }: CommonProps) {
  const [rows, setRows] = useState<any[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [memberIdInput, setMemberIdInput] = useState("");
  const [checkResultInput, setCheckResultInput] = useState("present");
  const [actionErr, setActionErr] = useState<string | null>(null);
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

  const filtered = rows.filter((r) => {
    const q = normalizeText(query);
    const name = normalizeText(r.memberName || r.name);
    const status = normalizeText(r.status || r.result || "present");
    const matchQuery = q.length === 0 || name.includes(q);
    const matchStatus = statusFilter === "all" || status === statusFilter;
    return matchQuery && matchStatus;
  });

  return (
    <section className="panel tab-panel page">
      <div className="page-head">
        <h2>✅ 출석</h2>
        <button type="button" onClick={() => void load()} disabled={!connected}>
          새로고침
        </button>
      </div>
      <LoadError err={err} />
      <div className="toolbar">
        <input
          value={memberIdInput}
          onChange={(e) => setMemberIdInput(e.target.value)}
          placeholder="회원 ID"
        />
        <select value={checkResultInput} onChange={(e) => setCheckResultInput(e.target.value)}>
          <option value="present">출석</option>
          <option value="late">지각</option>
          <option value="absent">결석</option>
        </select>
        <button
          type="button"
          onClick={async () => {
            const memberId = Number(memberIdInput);
            if (!memberId) return;
            try {
              setActionErr(null);
              await dojoClient.attendance.check.mutate({
                memberId,
                attendanceDate: new Date().toISOString().slice(0, 10),
                checkResult: checkResultInput,
                type: "regular",
              });
              setMemberIdInput("");
              await load();
            } catch (e) {
              setActionErr(e instanceof Error ? e.message : String(e));
            }
          }}
          disabled={!connected}
        >
          출석 등록
        </button>
      </div>
      <ActionError err={actionErr} onRetry={load} />
      <div className="toolbar">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="회원명 검색"
        />
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="all">전체 상태</option>
          <option value="present">출석</option>
          <option value="late">지각</option>
          <option value="absent">결석</option>
        </select>
      </div>
      <p className="meta toolbar-meta">오늘 출석 기록: {filtered.length}건</p>
      <div className="user-table-wrap">
        <table className="user-table">
          <thead>
            <tr>
              <th>회원</th>
              <th>상태</th>
              <th>시간</th>
              <th>관리</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((r) => {
              const status = normalizeText(r.status || r.result || "present");
              const tone =
                status === "present" ? "ok" : status === "absent" ? "danger" : "warn";
              return (
                <tr key={r.id ?? `${r.memberId}-${r.checkedAt ?? r.createdAt ?? Math.random()}`}>
                  <td>{r.memberName || r.name || `회원 #${r.memberId ?? "-"}`}</td>
                  <td>
                    <StatusBadge tone={tone}>{r.status || r.result || "present"}</StatusBadge>
                  </td>
                  <td>{r.checkedAt || r.createdAt || "—"}</td>
                  <td>
                    <button
                      type="button"
                      className="danger-btn"
                      disabled={!connected || !r.id}
                      onClick={async () => {
                        if (!r.id) return;
                        try {
                          await dojoClient.attendance.delete.mutate({ id: r.id });
                          await load();
                        } catch (e) {
                          setActionErr(e instanceof Error ? e.message : String(e));
                        }
                      }}
                    >
                      삭제
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {connected && filtered.length === 0 ? <EmptyState label="오늘 출석 데이터가 없습니다." /> : null}
    </section>
  );
}

export function PaymentsPage({ dojoClient, connected, userRole }: CommonProps) {
  const [unpaid, setUnpaid] = useState<any[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [riskFilter, setRiskFilter] = useState("all");
  const [memberIdInput, setMemberIdInput] = useState("");
  const [amountInput, setAmountInput] = useState("");
  const [actionErr, setActionErr] = useState<string | null>(null);
  const canManage = userRole === "admin" || userRole === "manager";
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

  const filtered = unpaid.filter((p) => {
    const q = normalizeText(query);
    const name = normalizeText(p.memberName || p.name);
    const days = daysUntil(p.nextPaymentDate ?? p.dueDate);
    const risk =
      days == null ? "unknown" : days < 0 ? "overdue" : days <= 7 ? "urgent" : "normal";
    const matchQuery = q.length === 0 || name.includes(q);
    const matchRisk = riskFilter === "all" || risk === riskFilter;
    return matchQuery && matchRisk;
  });

  return (
    <section className="panel tab-panel page">
      <div className="page-head">
        <h2>💳 납부</h2>
        <button type="button" onClick={() => void load()} disabled={!connected}>
          새로고침
        </button>
      </div>
      <LoadError err={err} />
      <div className="toolbar">
        <input value={memberIdInput} onChange={(e) => setMemberIdInput(e.target.value)} placeholder="회원 ID" />
        <input value={amountInput} onChange={(e) => setAmountInput(e.target.value)} placeholder="납부 금액" />
        <button
          type="button"
          onClick={async () => {
            const memberId = Number(memberIdInput);
            const amount = Number(amountInput);
            if (!memberId || !amount) return;
            try {
              setActionErr(null);
              await dojoClient.payments.create.mutate({ memberId, amount, method: "cash" });
              setMemberIdInput("");
              setAmountInput("");
              await load();
            } catch (e) {
              setActionErr(e instanceof Error ? e.message : String(e));
            }
          }}
          disabled={!connected || !canManage}
        >
          납부 등록
        </button>
      </div>
      {!canManage ? <p className="meta">납부 등록은 manager/admin 권한에서만 가능합니다.</p> : null}
      <ActionError err={actionErr} onRetry={canManage ? load : null} />
      <div className="toolbar">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="회원명 검색"
        />
        <select value={riskFilter} onChange={(e) => setRiskFilter(e.target.value)}>
          <option value="all">전체 위험도</option>
          <option value="overdue">연체</option>
          <option value="urgent">만료 임박(7일)</option>
          <option value="normal">일반</option>
        </select>
      </div>
      <p className="meta toolbar-meta">미납/주의 회원: {filtered.length}명</p>
      <div className="user-table-wrap">
        <table className="user-table">
          <thead>
            <tr>
              <th>회원</th>
              <th>상태</th>
              <th>미납 금액</th>
              <th>다음 납부일</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((p) => {
              const days = daysUntil(p.nextPaymentDate ?? p.dueDate);
              const tone = days == null ? "muted" : days < 0 ? "danger" : days <= 7 ? "warn" : "ok";
              const label =
                days == null ? "미확인" : days < 0 ? `연체 ${Math.abs(days)}일` : days <= 7 ? `${days}일 남음` : "정상";
              return (
                <tr key={p.id ?? `${p.memberId}-${p.nextPaymentDate ?? p.dueDate ?? Math.random()}`}>
                  <td>{p.memberName || p.name || `회원 #${p.memberId ?? "-"}`}</td>
                  <td>
                    <StatusBadge tone={tone}>{label}</StatusBadge>
                  </td>
                  <td>{Number(p.unpaidAmount || p.amount || 0).toLocaleString()}원</td>
                  <td>{p.nextPaymentDate || p.dueDate || "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {connected && filtered.length === 0 ? <EmptyState label="미납 데이터가 없습니다." /> : null}
    </section>
  );
}

export function PromotionsPage({ dojoClient, connected, userRole }: CommonProps) {
  const [rows, setRows] = useState<any[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [memberIdInput, setMemberIdInput] = useState("");
  const [examDateInput, setExamDateInput] = useState(new Date().toISOString().slice(0, 10));
  const [actionErr, setActionErr] = useState<string | null>(null);
  const canManage = userRole === "admin" || userRole === "manager";
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

  const filtered = rows.filter((r) => {
    const q = normalizeText(query);
    const name = normalizeText(r.memberName || r.name);
    return q.length === 0 || name.includes(q);
  });

  return (
    <section className="panel tab-panel page">
      <div className="page-head">
        <h2>🥋 심사</h2>
        <button type="button" onClick={() => void load()} disabled={!connected}>
          새로고침
        </button>
      </div>
      <LoadError err={err} />
      <div className="toolbar">
        <input value={memberIdInput} onChange={(e) => setMemberIdInput(e.target.value)} placeholder="회원 ID" />
        <input type="date" value={examDateInput} onChange={(e) => setExamDateInput(e.target.value)} />
        <button
          type="button"
          onClick={async () => {
            const memberId = Number(memberIdInput);
            if (!memberId) return;
            try {
              setActionErr(null);
              await dojoClient.promotions.create.mutate({
                memberId,
                examDate: examDateInput,
                currentBelt: "white",
                targetBelt: "yellow",
                result: "pending",
              });
              setMemberIdInput("");
              await load();
            } catch (e) {
              setActionErr(e instanceof Error ? e.message : String(e));
            }
          }}
          disabled={!connected || !canManage}
        >
          심사 등록
        </button>
      </div>
      {!canManage ? <p className="meta">심사 등록은 manager/admin 권한에서만 가능합니다.</p> : null}
      <ActionError err={actionErr} onRetry={canManage ? load : null} />
      <div className="toolbar">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="회원명 검색"
        />
      </div>
      <p className="meta toolbar-meta">30일 내 예정 심사: {filtered.length}건</p>
      <div className="user-table-wrap">
        <table className="user-table">
          <thead>
            <tr>
              <th>회원</th>
              <th>현재 띠</th>
              <th>목표 띠</th>
              <th>심사일</th>
              <th>관리</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((r) => (
              <tr key={r.id ?? `${r.memberId}-${r.examDate ?? r.scheduledDate ?? Math.random()}`}>
                <td>{r.memberName || r.name || `회원 #${r.memberId ?? "-"}`}</td>
                <td>{r.currentBelt || "—"}</td>
                <td>{r.targetBelt || "—"}</td>
                <td>{r.examDate || r.scheduledDate || "—"}</td>
                <td>
                  <button
                    type="button"
                    className="danger-btn"
                    disabled={!connected || !r.id}
                    onClick={async () => {
                      if (!r.id) return;
                      try {
                        await dojoClient.promotions.delete.mutate({ id: r.id });
                        await load();
                      } catch (e) {
                        setActionErr(e instanceof Error ? e.message : String(e));
                      }
                    }}
                    hidden={!canManage}
                  >
                    삭제
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {connected && filtered.length === 0 ? <EmptyState label="예정된 심사가 없습니다." /> : null}
    </section>
  );
}

export function TournamentsPage({ dojoClient, connected, userRole }: CommonProps) {
  const [rows, setRows] = useState<any[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [titleInput, setTitleInput] = useState("");
  const [eventDateInput, setEventDateInput] = useState(new Date().toISOString().slice(0, 10));
  const [actionErr, setActionErr] = useState<string | null>(null);
  const canManage = userRole === "admin" || userRole === "manager";
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

  const filtered = rows.filter((r) => {
    const q = normalizeText(query);
    const title = normalizeText(r.name || r.title);
    return q.length === 0 || title.includes(q);
  });

  return (
    <section className="panel tab-panel page">
      <div className="page-head">
        <h2>🏆 대회</h2>
        <button type="button" onClick={() => void load()} disabled={!connected}>
          새로고침
        </button>
      </div>
      <LoadError err={err} />
      <div className="toolbar">
        <input value={titleInput} onChange={(e) => setTitleInput(e.target.value)} placeholder="대회명" />
        <input type="date" value={eventDateInput} onChange={(e) => setEventDateInput(e.target.value)} />
        <button
          type="button"
          onClick={async () => {
            if (!titleInput.trim()) return;
            try {
              setActionErr(null);
              await dojoClient.tournaments.create.mutate({
                title: titleInput.trim(),
                eventDate: eventDateInput,
                status: "upcoming",
              });
              setTitleInput("");
              await load();
            } catch (e) {
              setActionErr(e instanceof Error ? e.message : String(e));
            }
          }}
          disabled={!connected || !canManage}
        >
          대회 등록
        </button>
      </div>
      {!canManage ? <p className="meta">대회 등록은 manager/admin 권한에서만 가능합니다.</p> : null}
      <ActionError err={actionErr} onRetry={canManage ? load : null} />
      <div className="toolbar">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="대회명 검색"
        />
      </div>
      <p className="meta toolbar-meta">60일 내 예정 대회: {filtered.length}건</p>
      <div className="user-table-wrap">
        <table className="user-table">
          <thead>
            <tr>
              <th>대회명</th>
              <th>상태</th>
              <th>일정</th>
              <th>참가자</th>
              <th>관리</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((r) => {
              const status = normalizeText(r.status || "scheduled");
              const tone = status === "done" ? "muted" : status === "cancelled" ? "danger" : "ok";
              return (
                <tr key={r.id ?? `${r.name}-${r.date ?? r.startDate ?? Math.random()}`}>
                  <td>{r.name || r.title || "이름 없음"}</td>
                  <td>
                    <StatusBadge tone={tone}>{r.status || "scheduled"}</StatusBadge>
                  </td>
                  <td>{r.date || r.startDate || "—"}</td>
                  <td>{r.participantCount ?? r.participants?.length ?? 0}명</td>
                  <td>
                    <button
                      type="button"
                      className="danger-btn"
                      disabled={!connected || !r.id}
                      onClick={async () => {
                        if (!r.id) return;
                        try {
                          await dojoClient.tournaments.delete.mutate({ id: r.id });
                          await load();
                        } catch (e) {
                          setActionErr(e instanceof Error ? e.message : String(e));
                        }
                      }}
                      hidden={!canManage}
                    >
                      삭제
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {connected && filtered.length === 0 ? <EmptyState label="예정된 대회가 없습니다." /> : null}
    </section>
  );
}

export function AnnouncementsPage({ dojoClient, connected, userRole }: CommonProps) {
  const [rows, setRows] = useState<any[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [pinFilter, setPinFilter] = useState("all");
  const [titleInput, setTitleInput] = useState("");
  const [contentInput, setContentInput] = useState("");
  const [actionErr, setActionErr] = useState<string | null>(null);
  const canManage = userRole === "admin" || userRole === "manager";
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

  const filtered = rows.filter((r) => {
    const q = normalizeText(query);
    const title = normalizeText(r.title);
    const body = normalizeText(r.body || r.content);
    const pinned = Boolean(r.pinned || r.isPinned);
    const matchQuery = q.length === 0 || title.includes(q) || body.includes(q);
    const matchPinned =
      pinFilter === "all" || (pinFilter === "pinned" ? pinned : !pinned);
    return matchQuery && matchPinned;
  });

  return (
    <section className="panel tab-panel page">
      <div className="page-head">
        <h2>📢 공지</h2>
        <button type="button" onClick={() => void load()} disabled={!connected}>
          새로고침
        </button>
      </div>
      <LoadError err={err} />
      <div className="toolbar">
        <input value={titleInput} onChange={(e) => setTitleInput(e.target.value)} placeholder="공지 제목" />
        <input value={contentInput} onChange={(e) => setContentInput(e.target.value)} placeholder="공지 내용" />
        <button
          type="button"
          onClick={async () => {
            if (!titleInput.trim() || !contentInput.trim()) return;
            try {
              setActionErr(null);
              await dojoClient.announcements.create.mutate({
                title: titleInput.trim(),
                content: contentInput.trim(),
                isPinned: false,
              });
              setTitleInput("");
              setContentInput("");
              await load();
            } catch (e) {
              setActionErr(e instanceof Error ? e.message : String(e));
            }
          }}
          disabled={!connected || !canManage}
        >
          공지 등록
        </button>
      </div>
      {!canManage ? <p className="meta">공지 등록은 manager/admin 권한에서만 가능합니다.</p> : null}
      <ActionError err={actionErr} onRetry={canManage ? load : null} />
      <div className="toolbar">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="제목/내용 검색"
        />
        <select value={pinFilter} onChange={(e) => setPinFilter(e.target.value)}>
          <option value="all">전체</option>
          <option value="pinned">고정 공지</option>
          <option value="normal">일반 공지</option>
        </select>
      </div>
      <p className="meta toolbar-meta">공지 항목: {filtered.length}개</p>
      <div className="announcement-list">
        {filtered.map((r) => (
          <article className="announcement-card" key={r.id ?? `${r.title}-${r.createdAt ?? Math.random()}`}>
            <div className="announcement-head">
              <strong>{r.title || "제목 없음"}</strong>
              {r.pinned || r.isPinned ? <StatusBadge tone="warn">고정</StatusBadge> : null}
            </div>
            <p>{r.body || r.content || "내용 없음"}</p>
            <p className="meta">{r.createdAt || r.date || "날짜 정보 없음"}</p>
            <div className="row-actions">
              <button
                type="button"
                className="danger-btn"
                disabled={!connected || !r.id}
                onClick={async () => {
                  if (!r.id) return;
                  try {
                    await dojoClient.announcements.delete.mutate({ id: r.id });
                    await load();
                  } catch (e) {
                    setActionErr(e instanceof Error ? e.message : String(e));
                  }
                }}
                hidden={!canManage}
              >
                삭제
              </button>
            </div>
          </article>
        ))}
      </div>
      {connected && filtered.length === 0 ? <EmptyState label="공지 데이터가 없습니다." /> : null}
    </section>
  );
}
