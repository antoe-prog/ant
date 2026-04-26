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

const BELT_RANK_OPTIONS: { value: string; label: string }[] = [
  { value: "white", label: "흰띠" },
  { value: "yellow", label: "노란띠" },
  { value: "orange", label: "주황띠" },
  { value: "green", label: "초록띠" },
  { value: "blue", label: "파란띠" },
  { value: "brown", label: "갈색띠" },
  { value: "black", label: "검은띠" },
];

const MEMBER_STATUS_OPTIONS: { value: string; label: string }[] = [
  { value: "active", label: "활성" },
  { value: "suspended", label: "정지" },
  { value: "withdrawn", label: "탈퇴" },
];

function beltLabel(rank: unknown): string {
  const r = String(rank ?? "");
  const o = BELT_RANK_OPTIONS.find((x) => x.value === r);
  return (o?.label ?? r) || "—";
}

/** 쉼표·줄바꿈·공백으로 구분된 회원 ID 목록 파싱 */
function parseMemberIdList(text: string): number[] {
  const raw = text
    .split(/[\s,;]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const nums = raw.map((s) => parseInt(s, 10)).filter((n) => Number.isFinite(n) && n > 0);
  return [...new Set(nums)];
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

export function DojoHomePage({ dojoClient, connected, userRole }: CommonProps) {
  const [stats, setStats] = useState<any | null>(null);
  const [monthlyStats, setMonthlyStats] = useState<any[]>([]);
  const [dailyStats, setDailyStats] = useState<any[]>([]);
  const [monthlyWindow, setMonthlyWindow] = useState("6");
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [seeding, setSeeding] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const canManage = userRole === "admin" || userRole === "manager";

  const load = useCallback(async () => {
    if (!connected) return;
    setErr(null);
    try {
      const [s, ms, ds] = await Promise.all([
        dojoClient.dashboard.stats.query(),
        dojoClient.dashboard.monthlyStats.query(),
        dojoClient.dashboard.dailyAttendance.query(),
      ]);
      setStats(s);
      setMonthlyStats(Array.isArray(ms) ? ms : []);
      setDailyStats(Array.isArray(ds) ? ds : []);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setStats(null);
      setMonthlyStats([]);
      setDailyStats([]);
    }
  }, [connected, dojoClient]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!autoRefresh || !connected) return;
    const id = setInterval(() => {
      void load();
    }, 30000);
    return () => clearInterval(id);
  }, [autoRefresh, connected, load]);

  const monthlyWindowed = monthlyStats.slice(-Math.max(1, Number(monthlyWindow) || 6));
  const avgAttendanceRate =
    monthlyWindowed.length > 0
      ? Math.round(
          monthlyWindowed.reduce((sum, r) => sum + Number(r.attendanceRate || 0), 0) /
            monthlyWindowed.length,
        )
      : 0;
  const totalRecentRevenue = monthlyWindowed.reduce((sum, r) => sum + Number(r.revenue || 0), 0);
  const todayStr = new Date().toISOString().slice(0, 10);
  const todayAttendance = dailyStats.find((d) => String(d.date).slice(0, 10) === todayStr);

  return (
    <section className="panel tab-panel page">
      <div className="page-head">
        <h2>🏠 도장 홈</h2>
        <div className="row-actions-inline">
          <button type="button" onClick={() => void load()} disabled={!connected}>
            새로고침
          </button>
          <label className="member-edit-check" style={{ margin: 0 }}>
            <input
              type="checkbox"
              checked={autoRefresh}
              onChange={(e) => setAutoRefresh(e.target.checked)}
            />
            <span>30초 자동 새로고침</span>
          </label>
          <select value={monthlyWindow} onChange={(e) => setMonthlyWindow(e.target.value)}>
            <option value="3">최근 3개월</option>
            <option value="6">최근 6개월</option>
          </select>
          <button
            type="button"
            className="secondary-btn"
            disabled={!canManage || seeding}
            onClick={async () => {
              setSeeding(true);
              setErr(null);
              try {
                await dojoClient.dashboard.seed.mutate();
                await load();
              } catch (e) {
                setErr(e instanceof Error ? e.message : String(e));
              } finally {
                setSeeding(false);
              }
            }}
          >
            {seeding ? "시드 생성 중..." : "데모 데이터 시드"}
          </button>
        </div>
      </div>
      {!connected ? <p className="meta">상단에서 도장 API 로그인을 먼저 진행해 주세요.</p> : null}
      <LoadError err={err} />
      {stats ? (
        <>
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
            <div className="status-tile">
              <p className="tile-label">미납 회원</p>
              <p className="tile-value">{stats.unpaidCount ?? 0}명</p>
            </div>
            <div className="status-tile">
              <p className="tile-label">최근 월평균 출석률</p>
              <p className="tile-value">{avgAttendanceRate}%</p>
            </div>
            <div className="status-tile">
              <p className="tile-label">최근 기간 매출 합계</p>
              <p className="tile-value">{Number(totalRecentRevenue || 0).toLocaleString()}원</p>
            </div>
          </div>

          <h3 className="subsection-title">월간 추이 ({monthlyWindow}개월)</h3>
          <div className="toolbar">
            <button
              type="button"
              className="secondary-btn"
              disabled={monthlyWindowed.length === 0}
              onClick={() => {
                const headers = ["year", "month", "revenue", "attendance", "attendanceRate"];
                const lines = monthlyWindowed.map((r) =>
                  [r.year, r.month, r.revenue ?? 0, r.attendance ?? 0, r.attendanceRate ?? 0].join(","),
                );
                const csv = [headers.join(","), ...lines].join("\n");
                const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
                const url = URL.createObjectURL(blob);
                const a = document.createElement("a");
                a.href = url;
                a.download = `dashboard-monthly-${new Date().toISOString().slice(0, 10)}.csv`;
                document.body.appendChild(a);
                a.click();
                a.remove();
                URL.revokeObjectURL(url);
              }}
            >
              월간 CSV
            </button>
          </div>
          <div className="user-table-wrap">
            <table className="user-table">
              <thead>
                <tr>
                  <th>연-월</th>
                  <th>매출</th>
                  <th>출석건수</th>
                  <th>출석률</th>
                </tr>
              </thead>
              <tbody>
                {monthlyWindowed.map((r) => (
                  <tr key={`${r.year}-${r.month}`}>
                    <td>{r.year}-{String(r.month).padStart(2, "0")}</td>
                    <td>{Number(r.revenue || 0).toLocaleString()}원</td>
                    <td>{Number(r.attendance || 0).toLocaleString()}건</td>
                    <td>{Number(r.attendanceRate || 0)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <h3 className="subsection-title">일별 출석(이번 달)</h3>
          <p className="meta toolbar-meta">
            오늘 집계: {todayAttendance ? `${todayAttendance.attendance ?? 0}건` : "데이터 없음"}
          </p>
          <div className="toolbar">
            <button
              type="button"
              className="secondary-btn"
              disabled={dailyStats.length === 0}
              onClick={() => {
                const headers = ["date", "attendance"];
                const lines = dailyStats.map((r) => [String(r.date).slice(0, 10), r.attendance ?? 0].join(","));
                const csv = [headers.join(","), ...lines].join("\n");
                const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
                const url = URL.createObjectURL(blob);
                const a = document.createElement("a");
                a.href = url;
                a.download = `dashboard-daily-${new Date().toISOString().slice(0, 10)}.csv`;
                document.body.appendChild(a);
                a.click();
                a.remove();
                URL.revokeObjectURL(url);
              }}
            >
              일별 CSV
            </button>
          </div>
          <div className="user-table-wrap">
            <table className="user-table">
              <thead>
                <tr>
                  <th>날짜</th>
                  <th>출석 건수</th>
                </tr>
              </thead>
              <tbody>
                {dailyStats.map((r) => (
                  <tr key={String(r.date)}>
                    <td>{String(r.date).slice(0, 10)}</td>
                    <td>{Number(r.attendance || 0).toLocaleString()}건</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : null}
    </section>
  );
}

export function MembersPage({ dojoClient, connected, userRole }: CommonProps) {
  const [rows, setRows] = useState<any[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [sortOrder, setSortOrder] = useState("nameAsc");
  const [minFeeFilter, setMinFeeFilter] = useState("");
  const [maxFeeFilter, setMaxFeeFilter] = useState("");
  const [dueFromFilter, setDueFromFilter] = useState("");
  const [dueToFilter, setDueToFilter] = useState("");
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [newFee, setNewFee] = useState("150000");
  const [newJoinDate, setNewJoinDate] = useState(new Date().toISOString().slice(0, 10));
  const [selectedMemberIds, setSelectedMemberIds] = useState<Record<number, boolean>>({});
  const [bulkStatus, setBulkStatus] = useState("active");
  const [bulkNextPaymentDate, setBulkNextPaymentDate] = useState("");
  const [actionErr, setActionErr] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<{
    id: number;
    beltRank: string;
    beltDegree: string;
    monthlyFee: string;
    status: string;
    nextPaymentDate: string;
  } | null>(null);
  const [savingEdit, setSavingEdit] = useState(false);
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

  const filtered = rows
    .filter((m) => {
      const name = normalizeText(m.name);
      const phone = normalizeText(m.phone || m.phoneNumber);
      const belt = normalizeText(m.beltRank || m.belt || m.beltLevel);
      const status = normalizeText(m.status || "unknown");
      const q = normalizeText(query);
      const fee = Number(m.monthlyFee || 0);
      const due = String(m.nextPaymentDate || "");

      const matchQuery =
        q.length === 0 || name.includes(q) || phone.includes(q) || belt.includes(q);
      const matchStatus = statusFilter === "all" || status === statusFilter;
      const matchMinFee = minFeeFilter.trim() === "" || fee >= Number(minFeeFilter || 0);
      const matchMaxFee = maxFeeFilter.trim() === "" || fee <= Number(maxFeeFilter || Number.MAX_SAFE_INTEGER);
      const matchDueFrom = dueFromFilter.trim() === "" || (due && due >= dueFromFilter);
      const matchDueTo = dueToFilter.trim() === "" || (due && due <= dueToFilter);
      return matchQuery && matchStatus && matchMinFee && matchMaxFee && matchDueFrom && matchDueTo;
    })
    .sort((a, b) => {
      const an = normalizeText(a.name);
      const bn = normalizeText(b.name);
      if (sortOrder === "nameDesc") return bn.localeCompare(an, "ko");
      if (sortOrder === "feeDesc") return Number(b.monthlyFee || 0) - Number(a.monthlyFee || 0);
      if (sortOrder === "feeAsc") return Number(a.monthlyFee || 0) - Number(b.monthlyFee || 0);
      if (sortOrder === "dueAsc") return String(a.nextPaymentDate || "9999-12-31").localeCompare(String(b.nextPaymentDate || "9999-12-31"));
      if (sortOrder === "dueDesc") return String(b.nextPaymentDate || "0000-00-00").localeCompare(String(a.nextPaymentDate || "0000-00-00"));
      return an.localeCompare(bn, "ko");
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
        <input type="date" value={newJoinDate} onChange={(e) => setNewJoinDate(e.target.value)} />
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
                joinDate: newJoinDate || today,
                monthlyFee: Number(newFee || 0),
                status: "active",
                beltRank: "white",
                beltDegree: 1,
              });
              setNewName("");
              setNewJoinDate(today);
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
          {MEMBER_STATUS_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <select value={sortOrder} onChange={(e) => setSortOrder(e.target.value)}>
          <option value="nameAsc">이름 오름차순</option>
          <option value="nameDesc">이름 내림차순</option>
          <option value="feeDesc">회비 높은순</option>
          <option value="feeAsc">회비 낮은순</option>
          <option value="dueAsc">납부일 빠른순</option>
          <option value="dueDesc">납부일 늦은순</option>
        </select>
        <input value={minFeeFilter} onChange={(e) => setMinFeeFilter(e.target.value)} placeholder="최소 회비" />
        <input value={maxFeeFilter} onChange={(e) => setMaxFeeFilter(e.target.value)} placeholder="최대 회비" />
        <input type="date" value={dueFromFilter} onChange={(e) => setDueFromFilter(e.target.value)} />
        <input type="date" value={dueToFilter} onChange={(e) => setDueToFilter(e.target.value)} />
        <button
          type="button"
          className="secondary-btn"
          onClick={() => {
            setMinFeeFilter("");
            setMaxFeeFilter("");
            setDueFromFilter("");
            setDueToFilter("");
            setSortOrder("nameAsc");
          }}
        >
          필터 초기화
        </button>
        <button
          type="button"
          className="secondary-btn"
          disabled={filtered.length === 0}
          onClick={() => {
            const headers = ["id", "name", "status", "beltRank", "beltDegree", "monthlyFee", "nextPaymentDate"];
            const lines = filtered.map((m) =>
              [
                m.id,
                `"${String(m.name || "").replace(/"/g, "\"\"")}"`,
                m.status || "",
                m.beltRank || m.belt || "",
                m.beltDegree ?? "",
                m.monthlyFee ?? "",
                m.nextPaymentDate ?? "",
              ].join(","),
            );
            const csv = [headers.join(","), ...lines].join("\n");
            const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = `members-${new Date().toISOString().slice(0, 10)}.csv`;
            document.body.appendChild(a);
            a.click();
            a.remove();
            URL.revokeObjectURL(url);
          }}
        >
          CSV 내보내기
        </button>
      </div>
      <p className="meta toolbar-meta">필터 결과: {filtered.length}명</p>
      <div className="status-meta-grid" style={{ marginBottom: 10 }}>
        <div className="status-tile">
          <p className="tile-label">활성</p>
          <p className="tile-value">{rows.filter((m) => normalizeText(m.status) === "active").length}명</p>
        </div>
        <div className="status-tile">
          <p className="tile-label">정지</p>
          <p className="tile-value">{rows.filter((m) => normalizeText(m.status) === "suspended").length}명</p>
        </div>
        <div className="status-tile">
          <p className="tile-label">탈퇴</p>
          <p className="tile-value">{rows.filter((m) => normalizeText(m.status) === "withdrawn").length}명</p>
        </div>
      </div>
      <div className="toolbar">
        <select value={bulkStatus} onChange={(e) => setBulkStatus(e.target.value)}>
          {MEMBER_STATUS_OPTIONS.map((o) => (
            <option key={`bulk-member-${o.value}`} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <input type="date" value={bulkNextPaymentDate} onChange={(e) => setBulkNextPaymentDate(e.target.value)} />
        <button
          type="button"
          className="primary-btn"
          disabled={!canManage || Object.values(selectedMemberIds).every((v) => !v)}
          onClick={async () => {
            const ids = Object.entries(selectedMemberIds)
              .filter(([, checked]) => checked)
              .map(([id]) => Number(id));
            if (ids.length === 0) return;
            setActionErr(null);
            try {
              await Promise.all(
                ids.map((id) =>
                  dojoClient.members.update.mutate({
                    id,
                    status: bulkStatus,
                    nextPaymentDate: bulkNextPaymentDate.trim() || undefined,
                  }),
                ),
              );
              setSelectedMemberIds({});
              await load();
            } catch (e) {
              setActionErr(e instanceof Error ? e.message : String(e));
            }
          }}
        >
          선택 회원 일괄 적용
        </button>
      </div>
      <div className="user-table-wrap">
        <table className="user-table">
          <thead>
            <tr>
              <th>선택</th>
              <th>ID</th>
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
                  : status === "withdrawn"
                    ? "danger"
                    : "warn";
              const statusLabel =
                MEMBER_STATUS_OPTIONS.find((o) => o.value === status)?.label ?? (m.status || "—");
              return (
              <tr key={m.id}>
                <td>
                  <input
                    type="checkbox"
                    checked={Boolean(selectedMemberIds[Number(m.id)])}
                    onChange={(e) => setSelectedMemberIds((prev) => ({ ...prev, [Number(m.id)]: e.target.checked }))}
                    disabled={!canManage}
                  />
                </td>
                <td>
                  <button
                    type="button"
                    className="secondary-btn"
                    onClick={async () => {
                      try {
                        await navigator.clipboard.writeText(String(m.id));
                      } catch {
                        // clipboard unsupported; ignore silently
                      }
                    }}
                  >
                    #{m.id}
                  </button>
                </td>
                <td>{m.name}</td>
                <td>{beltLabel(m.beltRank || m.belt || m.beltLevel)}</td>
                <td>
                  <StatusBadge tone={tone}>{statusLabel}</StatusBadge>
                </td>
                <td>{Number(m.monthlyFee || 0).toLocaleString()}원</td>
                <td>{m.nextPaymentDate || "—"}</td>
                <td>
                  <div className="row-actions-inline">
                    <button
                      type="button"
                      className="edit-btn"
                      onClick={() => {
                        setActionErr(null);
                        const rank = String(m.beltRank || m.belt || "white");
                        const validRank = BELT_RANK_OPTIONS.some((o) => o.value === rank)
                          ? rank
                          : "white";
                        setEditDraft({
                          id: m.id,
                          beltRank: validRank,
                          beltDegree: String(Math.min(9, Math.max(1, Number(m.beltDegree ?? 1)))),
                          monthlyFee: String(m.monthlyFee ?? 0),
                          status: MEMBER_STATUS_OPTIONS.some((o) => o.value === m.status)
                            ? m.status
                            : "active",
                          nextPaymentDate: m.nextPaymentDate
                            ? String(m.nextPaymentDate).slice(0, 10)
                            : "",
                        });
                      }}
                      disabled={!connected || !canManage}
                    >
                      수정
                    </button>
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
                  </div>
                </td>
              </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {connected && filtered.length === 0 ? <EmptyState label="조건에 맞는 회원이 없습니다." /> : null}

      {editDraft ? (
        <div
          className="modal-backdrop"
          role="presentation"
          onClick={(e) => {
            if (e.target === e.currentTarget && !savingEdit) setEditDraft(null);
          }}
        >
          <div className="modal-panel" role="dialog" aria-labelledby="member-edit-title">
            <h3 id="member-edit-title" className="modal-title">
              회원 정보 수정
            </h3>
            <p className="meta" style={{ marginTop: 0 }}>
              띠·단(1~9)·월회비·상태·다음 납부일을 저장합니다.
            </p>
            <div className="member-edit-form">
              <label className="member-edit-field">
                <span>띠</span>
                <select
                  value={editDraft.beltRank}
                  onChange={(e) => setEditDraft((d) => (d ? { ...d, beltRank: e.target.value } : d))}
                  disabled={savingEdit}
                >
                  {BELT_RANK_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="member-edit-field">
                <span>단 (1~9)</span>
                <input
                  type="number"
                  min={1}
                  max={9}
                  value={editDraft.beltDegree}
                  onChange={(e) => setEditDraft((d) => (d ? { ...d, beltDegree: e.target.value } : d))}
                  disabled={savingEdit}
                />
              </label>
              <label className="member-edit-field">
                <span>월회비 (원)</span>
                <input
                  type="number"
                  min={0}
                  value={editDraft.monthlyFee}
                  onChange={(e) => setEditDraft((d) => (d ? { ...d, monthlyFee: e.target.value } : d))}
                  disabled={savingEdit}
                />
              </label>
              <label className="member-edit-field">
                <span>상태</span>
                <select
                  value={editDraft.status}
                  onChange={(e) => setEditDraft((d) => (d ? { ...d, status: e.target.value } : d))}
                  disabled={savingEdit}
                >
                  {MEMBER_STATUS_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="member-edit-field">
                <span>다음 납부일</span>
                <input
                  type="date"
                  value={editDraft.nextPaymentDate}
                  onChange={(e) => setEditDraft((d) => (d ? { ...d, nextPaymentDate: e.target.value } : d))}
                  disabled={savingEdit}
                />
              </label>
            </div>
            <div className="modal-actions">
              <button type="button" className="secondary-btn" disabled={savingEdit} onClick={() => setEditDraft(null)}>
                취소
              </button>
              <button
                type="button"
                className="primary-btn"
                disabled={savingEdit}
                onClick={async () => {
                  const deg = Math.min(9, Math.max(1, parseInt(editDraft.beltDegree, 10) || 1));
                  const fee = Math.max(0, Math.floor(Number(editDraft.monthlyFee) || 0));
                  setSavingEdit(true);
                  setActionErr(null);
                  try {
                    await dojoClient.members.update.mutate({
                      id: editDraft.id,
                      beltRank: editDraft.beltRank,
                      beltDegree: deg,
                      monthlyFee: fee,
                      status: editDraft.status,
                      nextPaymentDate: editDraft.nextPaymentDate.trim() === "" ? null : editDraft.nextPaymentDate,
                    });
                    setEditDraft(null);
                    await load();
                  } catch (e) {
                    setActionErr(e instanceof Error ? e.message : String(e));
                  } finally {
                    setSavingEdit(false);
                  }
                }}
              >
                {savingEdit ? "저장 중..." : "저장"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}

export function AttendancePage({ dojoClient, connected, userRole }: CommonProps) {
  const [rows, setRows] = useState<any[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [sortOrder, setSortOrder] = useState("latest");
  const [memberIdInput, setMemberIdInput] = useState("");
  const [attendanceDateInput, setAttendanceDateInput] = useState(() => new Date().toISOString().slice(0, 10));
  const [attendanceTypeInput, setAttendanceTypeInput] = useState("regular");
  const [checkResultInput, setCheckResultInput] = useState("present");
  const [singleNotesInput, setSingleNotesInput] = useState("");
  const [actionErr, setActionErr] = useState<string | null>(null);
  const [selectedAttendanceIds, setSelectedAttendanceIds] = useState<Record<number, boolean>>({});
  const [bulkIdsText, setBulkIdsText] = useState("");
  const [bulkDate, setBulkDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [bulkType, setBulkType] = useState("regular");
  const [bulkCheckResult, setBulkCheckResult] = useState("present");
  const [bulkNotes, setBulkNotes] = useState("");
  const [bulkPreset, setBulkPreset] = useState("none");
  const [bulkSaving, setBulkSaving] = useState(false);
  const [bulkFeedback, setBulkFeedback] = useState<string | null>(null);
  const [monthlyYear, setMonthlyYear] = useState(String(new Date().getFullYear()));
  const [monthlyMonth, setMonthlyMonth] = useState(String(new Date().getMonth() + 1));
  const [monthlyRows, setMonthlyRows] = useState<any[]>([]);
  const [monthlySort, setMonthlySort] = useState("countDesc");
  const [monthlyTopN, setMonthlyTopN] = useState("20");
  const [loadingMonthly, setLoadingMonthly] = useState(false);
  const canManage = userRole === "admin" || userRole === "manager";
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

  const filtered = rows
    .filter((r) => {
      const q = normalizeText(query);
      const name = normalizeText(r.memberName || r.name);
      const status = normalizeText(r.status || r.result || "present");
      const matchQuery = q.length === 0 || name.includes(q);
      const matchStatus = statusFilter === "all" || status === statusFilter;
      return matchQuery && matchStatus;
    })
    .sort((a, b) => {
      const at = new Date(String(a.checkedAt || a.createdAt || 0)).getTime();
      const bt = new Date(String(b.checkedAt || b.createdAt || 0)).getTime();
      if (sortOrder === "oldest") return at - bt;
      return bt - at;
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
        <input
          type="date"
          value={attendanceDateInput}
          onChange={(e) => setAttendanceDateInput(e.target.value)}
        />
        <select value={attendanceTypeInput} onChange={(e) => setAttendanceTypeInput(e.target.value)}>
          <option value="regular">일반</option>
          <option value="makeup">보강</option>
          <option value="trial">체험</option>
        </select>
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
                attendanceDate: attendanceDateInput,
                checkResult: checkResultInput,
                type: attendanceTypeInput,
                notes: singleNotesInput.trim() || undefined,
              });
              setMemberIdInput("");
              setSingleNotesInput("");
              await load();
            } catch (e) {
              setActionErr(e instanceof Error ? e.message : String(e));
            }
          }}
          disabled={!connected || !canManage}
        >
          출석 등록
        </button>
        <button
          type="button"
          className="secondary-btn"
          onClick={() => setAttendanceDateInput(new Date().toISOString().slice(0, 10))}
        >
          오늘
        </button>
      </div>
      <div className="toolbar">
        <input
          value={singleNotesInput}
          onChange={(e) => setSingleNotesInput(e.target.value)}
          placeholder="단건 출석 메모 (선택)"
        />
      </div>
      {!canManage ? <p className="meta">출석 등록·일괄 처리는 manager/admin 권한에서만 가능합니다.</p> : null}
      <div className="toolbar bulk-attendance-toolbar">
        <textarea
          className="bulk-id-textarea"
          rows={3}
          value={bulkIdsText}
          onChange={(e) => setBulkIdsText(e.target.value)}
          placeholder="일괄 처리할 회원 ID (쉼표·줄바꿈·공백 구분)"
          disabled={!connected || !canManage}
        />
        <div className="bulk-attendance-controls">
          <select
            value={bulkPreset}
            onChange={(e) => {
              const v = e.target.value;
              setBulkPreset(v);
              if (v === "todayPresent") {
                setBulkDate(new Date().toISOString().slice(0, 10));
                setBulkType("regular");
                setBulkCheckResult("present");
              } else if (v === "todayLate") {
                setBulkDate(new Date().toISOString().slice(0, 10));
                setBulkType("regular");
                setBulkCheckResult("late");
              } else if (v === "todayAbsent") {
                setBulkDate(new Date().toISOString().slice(0, 10));
                setBulkType("regular");
                setBulkCheckResult("absent");
              }
            }}
            disabled={!connected || !canManage}
          >
            <option value="none">프리셋 선택</option>
            <option value="todayPresent">오늘 출석</option>
            <option value="todayLate">오늘 지각</option>
            <option value="todayAbsent">오늘 결석</option>
          </select>
          <input
            type="date"
            value={bulkDate}
            onChange={(e) => setBulkDate(e.target.value)}
            disabled={!connected || !canManage}
          />
          <select value={bulkType} onChange={(e) => setBulkType(e.target.value)} disabled={!connected || !canManage}>
            <option value="regular">일반</option>
            <option value="makeup">보강</option>
            <option value="trial">체험</option>
          </select>
          <select
            value={bulkCheckResult}
            onChange={(e) => setBulkCheckResult(e.target.value)}
            disabled={!connected || !canManage}
          >
            <option value="present">출석</option>
            <option value="late">지각</option>
            <option value="absent">결석</option>
          </select>
          <input
            value={bulkNotes}
            onChange={(e) => setBulkNotes(e.target.value)}
            placeholder="일괄 메모 (선택)"
            disabled={!connected || !canManage}
          />
          <button
            type="button"
            className="primary-btn"
            disabled={!connected || !canManage || bulkSaving}
            onClick={async () => {
              const memberIds = parseMemberIdList(bulkIdsText);
              if (memberIds.length === 0) {
                setBulkFeedback("유효한 회원 ID를 한 개 이상 입력해 주세요.");
                return;
              }
              setBulkSaving(true);
              setActionErr(null);
              setBulkFeedback(null);
              try {
                const res = await dojoClient.attendance.checkBulk.mutate({
                  memberIds,
                  attendanceDate: bulkDate,
                  type: bulkType,
                  checkResult: bulkCheckResult,
                  notes: bulkNotes.trim() || undefined,
                });
                setBulkFeedback(
                  `처리 완료: 성공 ${res.succeeded ?? 0}건 / 실패 ${res.failed ?? 0}건 (총 ${res.total ?? memberIds.length}명)`,
                );
                setBulkIdsText("");
                setBulkNotes("");
                await load();
              } catch (e) {
                setActionErr(e instanceof Error ? e.message : String(e));
              } finally {
                setBulkSaving(false);
              }
            }}
          >
            {bulkSaving ? "일괄 처리 중..." : "일괄 출석 처리"}
          </button>
        </div>
      </div>
      {bulkFeedback ? <p className="meta ok-inline">{bulkFeedback}</p> : null}
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
        <select value={sortOrder} onChange={(e) => setSortOrder(e.target.value)}>
          <option value="latest">최신순</option>
          <option value="oldest">오래된순</option>
        </select>
        <button
          type="button"
          className="secondary-btn"
          disabled={filtered.length === 0}
          onClick={() => {
            const headers = ["id", "memberId", "memberName", "status", "checkedAt", "notes"];
            const lines = filtered.map((r) =>
              [
                r.id ?? "",
                r.memberId ?? "",
                `"${String(r.memberName || r.name || "").replace(/"/g, "\"\"")}"`,
                r.status || r.result || "",
                r.checkedAt || r.createdAt || "",
                `"${String(r.notes || "").replace(/"/g, "\"\"")}"`,
              ].join(","),
            );
            const csv = [headers.join(","), ...lines].join("\n");
            const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = `attendance-${new Date().toISOString().slice(0, 10)}.csv`;
            document.body.appendChild(a);
            a.click();
            a.remove();
            URL.revokeObjectURL(url);
          }}
        >
          CSV 내보내기
        </button>
      </div>
      <p className="meta toolbar-meta">오늘 출석 기록: {filtered.length}건</p>
      <p className="meta toolbar-meta">
        선택됨: {Object.values(selectedAttendanceIds).filter(Boolean).length}건
      </p>
      <div className="status-meta-grid" style={{ marginBottom: 10 }}>
        <div className="status-tile">
          <p className="tile-label">출석</p>
          <p className="tile-value">{rows.filter((r) => normalizeText(r.status || r.result) === "present").length}건</p>
        </div>
        <div className="status-tile">
          <p className="tile-label">지각</p>
          <p className="tile-value">{rows.filter((r) => normalizeText(r.status || r.result) === "late").length}건</p>
        </div>
        <div className="status-tile">
          <p className="tile-label">결석</p>
          <p className="tile-value">{rows.filter((r) => normalizeText(r.status || r.result) === "absent").length}건</p>
        </div>
      </div>
      <div className="toolbar">
        <button
          type="button"
          className="danger-btn"
          disabled={!canManage || Object.values(selectedAttendanceIds).every((v) => !v)}
          onClick={async () => {
            const ids = Object.entries(selectedAttendanceIds)
              .filter(([, checked]) => checked)
              .map(([id]) => Number(id));
            if (ids.length === 0) return;
            if (!window.confirm(`선택한 출석 기록 ${ids.length}건을 삭제할까요?`)) return;
            setActionErr(null);
            try {
              await Promise.all(ids.map((id) => dojoClient.attendance.delete.mutate({ id })));
              setSelectedAttendanceIds({});
              await load();
            } catch (e) {
              setActionErr(e instanceof Error ? e.message : String(e));
            }
          }}
        >
          선택 삭제
        </button>
        <button
          type="button"
          className="secondary-btn"
          onClick={() => {
            const next: Record<number, boolean> = {};
            filtered.forEach((r) => {
              const id = Number(r.id);
              if (id) next[id] = true;
            });
            setSelectedAttendanceIds(next);
          }}
        >
          필터 결과 전체 선택
        </button>
        <button type="button" className="secondary-btn" onClick={() => setSelectedAttendanceIds({})}>
          선택 해제
        </button>
        <input
          type="number"
          min={2020}
          max={2100}
          value={monthlyYear}
          onChange={(e) => setMonthlyYear(e.target.value)}
          placeholder="연도"
        />
        <input
          type="number"
          min={1}
          max={12}
          value={monthlyMonth}
          onChange={(e) => setMonthlyMonth(e.target.value)}
          placeholder="월"
        />
        <button
          type="button"
          className="primary-btn"
          disabled={!connected || !canManage || loadingMonthly}
          onClick={async () => {
            const year = Number(monthlyYear);
            const month = Number(monthlyMonth);
            if (!year || month < 1 || month > 12) return;
            setLoadingMonthly(true);
            setActionErr(null);
            try {
              const data = await dojoClient.attendance.monthlyCount.query({ year, month });
              setMonthlyRows(Array.isArray(data) ? data : []);
            } catch (e) {
              setActionErr(e instanceof Error ? e.message : String(e));
              setMonthlyRows([]);
            } finally {
              setLoadingMonthly(false);
            }
          }}
        >
          월간 요약 조회
        </button>
        <select value={monthlySort} onChange={(e) => setMonthlySort(e.target.value)}>
          <option value="countDesc">출석 많은순</option>
          <option value="countAsc">출석 적은순</option>
          <option value="memberIdAsc">회원ID 오름차순</option>
        </select>
        <select value={monthlyTopN} onChange={(e) => setMonthlyTopN(e.target.value)}>
          <option value="10">상위 10명</option>
          <option value="20">상위 20명</option>
          <option value="50">상위 50명</option>
          <option value="all">전체</option>
        </select>
        <button
          type="button"
          className="secondary-btn"
          disabled={monthlyRows.length === 0}
          onClick={() => {
            const headers = ["memberId", "count"];
            const rows = monthlyRows.map((r) => [r.memberId ?? "", r.count ?? 0].join(","));
            const csv = [headers.join(","), ...rows].join("\n");
            const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = `attendance-monthly-${monthlyYear}-${monthlyMonth}.csv`;
            document.body.appendChild(a);
            a.click();
            a.remove();
            URL.revokeObjectURL(url);
          }}
        >
          월간 CSV
        </button>
      </div>
      {monthlyRows.length > 0 ? (
        <div className="user-table-wrap">
          <table className="user-table">
            <thead>
              <tr>
                <th>회원 ID</th>
                <th>출석 건수</th>
              </tr>
            </thead>
            <tbody>
              {monthlyRows
                .slice()
                .sort((a, b) => {
                  if (monthlySort === "countAsc") return Number(a.count || 0) - Number(b.count || 0);
                  if (monthlySort === "memberIdAsc") return Number(a.memberId || 0) - Number(b.memberId || 0);
                  return Number(b.count || 0) - Number(a.count || 0);
                })
                .slice(0, monthlyTopN === "all" ? undefined : Number(monthlyTopN))
                .map((r, idx) => (
                <tr key={`m-${idx}-${r.memberId}`}>
                  <td>{r.memberId ?? "-"}</td>
                  <td>{r.count ?? 0}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      <div className="user-table-wrap">
        <table className="user-table">
          <thead>
            <tr>
              <th>선택</th>
              <th>회원</th>
              <th>상태</th>
              <th>시간</th>
              <th>메모</th>
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
                  <td>
                    <input
                      type="checkbox"
                      checked={Boolean(selectedAttendanceIds[Number(r.id)])}
                      onChange={(e) =>
                        setSelectedAttendanceIds((prev) => ({ ...prev, [Number(r.id)]: e.target.checked }))
                      }
                      disabled={!canManage || !r.id}
                    />
                  </td>
                  <td>{r.memberName || r.name || `회원 #${r.memberId ?? "-"}`}</td>
                  <td>
                    <StatusBadge tone={tone}>{r.status || r.result || "present"}</StatusBadge>
                  </td>
                  <td>{r.checkedAt || r.createdAt || "—"}</td>
                  <td>{r.notes || "—"}</td>
                  <td>
                    <div className="row-actions-inline">
                      <button
                        type="button"
                        className="secondary-btn"
                        disabled={!r.memberId}
                        onClick={async () => {
                          try {
                            await navigator.clipboard.writeText(String(r.memberId ?? ""));
                          } catch {
                            // ignore clipboard error
                          }
                        }}
                      >
                        회원ID 복사
                      </button>
                      <button
                        type="button"
                        className="danger-btn"
                        disabled={!connected || !r.id || !canManage}
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
                    </div>
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
  const [recent, setRecent] = useState<any[]>([]);
  const [expiringSoon, setExpiringSoon] = useState<any[]>([]);
  const [monthlyReport, setMonthlyReport] = useState<any | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [riskFilter, setRiskFilter] = useState("all");
  const [memberIdInput, setMemberIdInput] = useState("");
  const [amountInput, setAmountInput] = useState("");
  const [methodInput, setMethodInput] = useState("cash");
  const [paymentNotesInput, setPaymentNotesInput] = useState("");
  const [recentQuery, setRecentQuery] = useState("");
  const [recentMethodFilter, setRecentMethodFilter] = useState("all");
  const [recentLimit, setRecentLimit] = useState("40");
  const [recentSortOrder, setRecentSortOrder] = useState("latest");
  const [reportYear, setReportYear] = useState(String(new Date().getFullYear()));
  const [reportMonth, setReportMonth] = useState(String(new Date().getMonth() + 1));
  const [loadingReport, setLoadingReport] = useState(false);
  const [actionErr, setActionErr] = useState<string | null>(null);
  const canManage = userRole === "admin" || userRole === "manager";
  const load = useCallback(async () => {
    if (!connected) return;
    setErr(null);
    try {
      const [list, recentList, expiring] = await Promise.all([
        dojoClient.payments.unpaid.query(),
        dojoClient.payments.recent.query({ limit: Number(recentLimit) || 40 }),
        dojoClient.payments.expiringSoon.query({ days: 7 }),
      ]);
      setUnpaid(Array.isArray(list) ? list : []);
      setRecent(Array.isArray(recentList) ? recentList : []);
      setExpiringSoon(Array.isArray(expiring) ? expiring : []);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setUnpaid([]);
      setRecent([]);
      setExpiringSoon([]);
    }
  }, [connected, dojoClient, recentLimit]);
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
        <select value={methodInput} onChange={(e) => setMethodInput(e.target.value)}>
          <option value="cash">현금</option>
          <option value="card">카드</option>
          <option value="transfer">계좌이체</option>
        </select>
        <button
          type="button"
          onClick={async () => {
            const memberId = Number(memberIdInput);
            const amount = Number(amountInput);
            if (!memberId || !amount) return;
            try {
              setActionErr(null);
              await dojoClient.payments.create.mutate({
                memberId,
                amount,
                method: methodInput,
                notes: paymentNotesInput.trim() || undefined,
              });
              setMemberIdInput("");
              setAmountInput("");
              setPaymentNotesInput("");
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
      <div className="toolbar">
        <input
          value={paymentNotesInput}
          onChange={(e) => setPaymentNotesInput(e.target.value)}
          placeholder="납부 메모 (선택)"
        />
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
      <p className="meta toolbar-meta">7일 내 만료 예정: {expiringSoon.length}명</p>
      {expiringSoon.length > 0 ? (
        <div className="user-table-wrap" style={{ marginBottom: 10 }}>
          <table className="user-table">
            <thead>
              <tr>
                <th>만료 임박 회원</th>
                <th>다음 납부일</th>
              </tr>
            </thead>
            <tbody>
              {expiringSoon.map((p) => (
                <tr key={`exp-${p.id ?? p.memberId}`}>
                  <td>{p.name || p.memberName || `회원 #${p.memberId ?? p.id ?? "-"}`}</td>
                  <td>{p.nextPaymentDate || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
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

      <h3 className="subsection-title">월간 납부 리포트</h3>
      <div className="toolbar">
        <input
          type="number"
          min={2020}
          max={2100}
          value={reportYear}
          onChange={(e) => setReportYear(e.target.value)}
          placeholder="연도"
        />
        <input
          type="number"
          min={1}
          max={12}
          value={reportMonth}
          onChange={(e) => setReportMonth(e.target.value)}
          placeholder="월"
        />
        <button
          type="button"
          className="secondary-btn"
          onClick={() => {
            const now = new Date();
            setReportYear(String(now.getFullYear()));
            setReportMonth(String(now.getMonth() + 1));
          }}
        >
          이번달 설정
        </button>
        <button
          type="button"
          className="primary-btn"
          disabled={!connected || !canManage || loadingReport}
          onClick={async () => {
            const year = Number(reportYear);
            const month = Number(reportMonth);
            if (!year || month < 1 || month > 12) return;
            setLoadingReport(true);
            setActionErr(null);
            try {
              const report = await dojoClient.payments.monthlyReport.query({ year, month });
              setMonthlyReport(report);
            } catch (e) {
              setActionErr(e instanceof Error ? e.message : String(e));
              setMonthlyReport(null);
            } finally {
              setLoadingReport(false);
            }
          }}
        >
          {loadingReport ? "조회 중..." : "리포트 조회"}
        </button>
        <button
          type="button"
          className="secondary-btn"
          disabled={!monthlyReport || !Array.isArray(monthlyReport.payments)}
          onClick={() => {
            if (!monthlyReport || !Array.isArray(monthlyReport.payments)) return;
            const headers = ["id", "memberId", "amount", "method", "paidAt", "notes"];
            const lines = monthlyReport.payments.map((p: any) =>
              [
                p.id,
                p.memberId,
                p.amount,
                p.method,
                p.paidAt ?? "",
                `"${String(p.notes ?? "").replace(/"/g, "\"\"")}"`,
              ].join(","),
            );
            const csv = [headers.join(","), ...lines].join("\n");
            const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = `payments-report-${reportYear}-${reportMonth}.csv`;
            document.body.appendChild(a);
            a.click();
            a.remove();
            URL.revokeObjectURL(url);
          }}
        >
          리포트 CSV
        </button>
      </div>
      {monthlyReport ? (
        <>
          <div className="status-meta-grid" style={{ marginBottom: 10 }}>
            <div className="status-tile">
              <p className="tile-label">총 매출</p>
              <p className="tile-value">{Number(monthlyReport.totalRevenue || 0).toLocaleString()}원</p>
            </div>
            <div className="status-tile">
              <p className="tile-label">납부 건수</p>
              <p className="tile-value">{Array.isArray(monthlyReport.payments) ? monthlyReport.payments.length : 0}건</p>
            </div>
            <div className="status-tile">
              <p className="tile-label">평균 결제액</p>
              <p className="tile-value">
                {Array.isArray(monthlyReport.payments) && monthlyReport.payments.length > 0
                  ? Math.round(Number(monthlyReport.totalRevenue || 0) / monthlyReport.payments.length).toLocaleString()
                  : "0"}
                원
              </p>
            </div>
          </div>
          <div className="status-meta-grid" style={{ marginBottom: 10 }}>
            <div className="status-tile">
              <p className="tile-label">현금</p>
              <p className="tile-value">{Number(monthlyReport.byMethod?.cash || 0).toLocaleString()}원</p>
            </div>
            <div className="status-tile">
              <p className="tile-label">카드</p>
              <p className="tile-value">{Number(monthlyReport.byMethod?.card || 0).toLocaleString()}원</p>
            </div>
            <div className="status-tile">
              <p className="tile-label">계좌이체</p>
              <p className="tile-value">{Number(monthlyReport.byMethod?.transfer || 0).toLocaleString()}원</p>
            </div>
          </div>
        </>
      ) : null}

      <h3 className="subsection-title">최근 납부 기록</h3>
      <p className="meta toolbar-meta">잘못 등록된 건은 삭제할 수 있습니다. (회원 다음 납부일은 되돌리지 않으니 필요 시 회원 화면에서 조정하세요.)</p>
      <div className="toolbar">
        <input
          value={recentQuery}
          onChange={(e) => setRecentQuery(e.target.value)}
          placeholder="최근 기록 검색(회원ID/메모)"
        />
        <select value={recentMethodFilter} onChange={(e) => setRecentMethodFilter(e.target.value)}>
          <option value="all">결제수단 전체</option>
          <option value="cash">현금</option>
          <option value="card">카드</option>
          <option value="transfer">계좌이체</option>
        </select>
        <select value={recentLimit} onChange={(e) => setRecentLimit(e.target.value)}>
          <option value="20">최근 20건</option>
          <option value="40">최근 40건</option>
          <option value="80">최근 80건</option>
          <option value="120">최근 120건</option>
        </select>
        <select value={recentSortOrder} onChange={(e) => setRecentSortOrder(e.target.value)}>
          <option value="latest">최신순</option>
          <option value="oldest">오래된순</option>
          <option value="amountDesc">금액 높은순</option>
          <option value="amountAsc">금액 낮은순</option>
        </select>
        <button
          type="button"
          className="secondary-btn"
          disabled={recent.length === 0}
          onClick={() => {
            const headers = ["id", "memberId", "amount", "method", "paidAt", "notes"];
            const lines = recent.map((p) =>
              [
                p.id,
                p.memberId,
                p.amount,
                p.method,
                p.paidAt ?? "",
                `"${String(p.notes ?? "").replace(/"/g, "\"\"")}"`,
              ].join(","),
            );
            const csv = [headers.join(","), ...lines].join("\n");
            const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = `payments-recent-${new Date().toISOString().slice(0, 10)}.csv`;
            document.body.appendChild(a);
            a.click();
            a.remove();
            URL.revokeObjectURL(url);
          }}
        >
          최근기록 CSV
        </button>
      </div>
      <div className="user-table-wrap">
        <table className="user-table">
          <thead>
            <tr>
              <th>ID</th>
              <th>회원 ID</th>
              <th>금액</th>
              <th>방법</th>
              <th>납부 시각</th>
              <th>메모</th>
              <th>관리</th>
            </tr>
          </thead>
          <tbody>
            {recent
              .filter((p) => {
                const q = normalizeText(recentQuery);
                const matchQuery =
                  q.length === 0 ||
                  normalizeText(p.memberId).includes(q) ||
                  normalizeText(p.notes).includes(q);
                const method = normalizeText(p.method || "");
                const matchMethod = recentMethodFilter === "all" || method === recentMethodFilter;
                return matchQuery && matchMethod;
              })
              .sort((a, b) => {
                const at = new Date(String(a.paidAt || 0)).getTime();
                const bt = new Date(String(b.paidAt || 0)).getTime();
                if (recentSortOrder === "oldest") return at - bt;
                if (recentSortOrder === "amountDesc") return Number(b.amount || 0) - Number(a.amount || 0);
                if (recentSortOrder === "amountAsc") return Number(a.amount || 0) - Number(b.amount || 0);
                return bt - at;
              })
              .map((p) => (
              <tr key={p.id}>
                <td>{p.id}</td>
                <td>{p.memberId}</td>
                <td>
                  {Number(p.amount || 0).toLocaleString()}원
                  {Number(p.amount || 0) >= 300000 ? (
                    <span className="pay-amount-badge">고액</span>
                  ) : null}
                </td>
                <td>{p.method || "—"}</td>
                <td>{p.paidAt ? String(p.paidAt) : "—"}</td>
                <td>{p.notes || "—"}</td>
                <td>
                  <button
                    type="button"
                    className="danger-btn"
                    disabled={!connected || !canManage || !p.id}
                    onClick={async () => {
                      if (!p.id) return;
                      if (!window.confirm(`납부 기록 #${p.id} (${Number(p.amount).toLocaleString()}원)을 삭제할까요?`)) return;
                      try {
                        setActionErr(null);
                        await dojoClient.payments.delete.mutate({ id: p.id });
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
            ))}
          </tbody>
        </table>
      </div>
      {connected && recent.length === 0 ? <EmptyState label="납부 기록이 없습니다." /> : null}
    </section>
  );
}

const PROMO_RESULT_OPTIONS: { value: string; label: string }[] = [
  { value: "pending", label: "대기" },
  { value: "passed", label: "합격" },
  { value: "failed", label: "불합격" },
];

const TOURNAMENT_STATUS_OPTIONS: { value: string; label: string }[] = [
  { value: "upcoming", label: "예정" },
  { value: "ongoing", label: "진행 중" },
  { value: "completed", label: "완료" },
  { value: "cancelled", label: "취소" },
];

const TOURNAMENT_RESULT_OPTIONS: { value: string; label: string }[] = [
  { value: "pending", label: "예정" },
  { value: "participated", label: "참가" },
  { value: "gold", label: "금메달" },
  { value: "silver", label: "은메달" },
  { value: "bronze", label: "동메달" },
  { value: "absent", label: "불참" },
];

export function PromotionsPage({ dojoClient, connected, userRole }: CommonProps) {
  const [rows, setRows] = useState<any[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [memberIdInput, setMemberIdInput] = useState("");
  const [bulkMemberIdsInput, setBulkMemberIdsInput] = useState("");
  const [examDateInput, setExamDateInput] = useState(new Date().toISOString().slice(0, 10));
  const [currentBeltInput, setCurrentBeltInput] = useState("white");
  const [targetBeltInput, setTargetBeltInput] = useState("yellow");
  const [resultFilter, setResultFilter] = useState("all");
  const [sortOrder, setSortOrder] = useState("nearest");
  const [examFromFilter, setExamFromFilter] = useState("");
  const [examToFilter, setExamToFilter] = useState("");
  const [windowDays, setWindowDays] = useState("all");
  const [bulkCurrentBeltInput, setBulkCurrentBeltInput] = useState("white");
  const [bulkTargetBeltInput, setBulkTargetBeltInput] = useState("yellow");
  const [resultNotesDraft, setResultNotesDraft] = useState<Record<number, string>>({});
  const [selectedPromotionIds, setSelectedPromotionIds] = useState<Record<number, boolean>>({});
  const [bulkResultInput, setBulkResultInput] = useState("passed");
  const [actionErr, setActionErr] = useState<string | null>(null);
  const [promoResultPick, setPromoResultPick] = useState<Record<number, string>>({});
  const [promoSavingId, setPromoSavingId] = useState<number | null>(null);
  const canManage = userRole === "admin" || userRole === "manager";
  const load = useCallback(async () => {
    if (!connected) return;
    setErr(null);
    try {
      const list = await dojoClient.promotions.list.query();
      setRows(Array.isArray(list) ? list : []);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setRows([]);
    }
  }, [connected, dojoClient]);
  useEffect(() => {
    void load();
  }, [load]);

  const filtered = rows
    .filter((r) => {
      const q = normalizeText(query);
      const name = normalizeText(r.memberName || r.name);
      const result = normalizeText(r.result || "pending");
      const examDate = String(r.examDate || r.scheduledDate || "");
      const matchQuery = q.length === 0 || name.includes(q);
      const matchResult = resultFilter === "all" || result === resultFilter;
      const matchFrom = examFromFilter.trim() === "" || (examDate && examDate >= examFromFilter);
      const matchTo = examToFilter.trim() === "" || (examDate && examDate <= examToFilter);
      const matchWindow =
        windowDays === "all" ||
        (() => {
          if (!examDate) return false;
          const d = new Date(examDate);
          const today = new Date();
          today.setHours(0, 0, 0, 0);
          d.setHours(0, 0, 0, 0);
          const diff = Math.floor((d.getTime() - today.getTime()) / 86400000);
          return diff >= 0 && diff <= Number(windowDays);
        })();
      return matchQuery && matchResult && matchFrom && matchTo && matchWindow;
    })
    .sort((a, b) => {
      const ad = new Date(String(a.examDate || a.scheduledDate || 0)).getTime();
      const bd = new Date(String(b.examDate || b.scheduledDate || 0)).getTime();
      if (sortOrder === "latest") return bd - ad;
      if (sortOrder === "nameAsc") return normalizeText(a.memberName || a.name).localeCompare(normalizeText(b.memberName || b.name), "ko");
      if (sortOrder === "nameDesc") return normalizeText(b.memberName || b.name).localeCompare(normalizeText(a.memberName || a.name), "ko");
      return ad - bd;
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
        <select value={currentBeltInput} onChange={(e) => setCurrentBeltInput(e.target.value)}>
          {BELT_RANK_OPTIONS.map((o) => (
            <option key={`cur-${o.value}`} value={o.value}>{o.label}</option>
          ))}
        </select>
        <select value={targetBeltInput} onChange={(e) => setTargetBeltInput(e.target.value)}>
          {BELT_RANK_OPTIONS.map((o) => (
            <option key={`target-${o.value}`} value={o.value}>{o.label}</option>
          ))}
        </select>
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
                currentBelt: currentBeltInput,
                targetBelt: targetBeltInput,
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
        <button
          type="button"
          className="secondary-btn"
          onClick={() => {
            const d = new Date();
            d.setDate(d.getDate() + 14);
            setExamDateInput(d.toISOString().slice(0, 10));
          }}
        >
          +14일
        </button>
      </div>
      <div className="toolbar">
        <input
          value={bulkMemberIdsInput}
          onChange={(e) => setBulkMemberIdsInput(e.target.value)}
          placeholder="일괄 등록 회원 ID (쉼표/공백/줄바꿈)"
        />
        <select value={bulkCurrentBeltInput} onChange={(e) => setBulkCurrentBeltInput(e.target.value)}>
          {BELT_RANK_OPTIONS.map((o) => (
            <option key={`bulk-cur-${o.value}`} value={o.value}>{o.label}</option>
          ))}
        </select>
        <select value={bulkTargetBeltInput} onChange={(e) => setBulkTargetBeltInput(e.target.value)}>
          {BELT_RANK_OPTIONS.map((o) => (
            <option key={`bulk-target-${o.value}`} value={o.value}>{o.label}</option>
          ))}
        </select>
        <button
          type="button"
          className="secondary-btn"
          disabled={!connected || !canManage}
          onClick={async () => {
            const memberIds = parseMemberIdList(bulkMemberIdsInput);
            if (memberIds.length === 0) return;
            setActionErr(null);
            try {
              await Promise.all(
                memberIds.map((memberId) =>
                  dojoClient.promotions.create.mutate({
                    memberId,
                    examDate: examDateInput,
                    currentBelt: bulkCurrentBeltInput,
                    targetBelt: bulkTargetBeltInput,
                    result: "pending",
                  }),
                ),
              );
              setBulkMemberIdsInput("");
              await load();
            } catch (e) {
              setActionErr(e instanceof Error ? e.message : String(e));
            }
          }}
        >
          심사 일괄 등록
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
        <select value={resultFilter} onChange={(e) => setResultFilter(e.target.value)}>
          <option value="all">결과 전체</option>
          {PROMO_RESULT_OPTIONS.map((o) => (
            <option key={`f-${o.value}`} value={o.value}>{o.label}</option>
          ))}
        </select>
        <select value={sortOrder} onChange={(e) => setSortOrder(e.target.value)}>
          <option value="nearest">심사일 빠른순</option>
          <option value="latest">심사일 늦은순</option>
          <option value="nameAsc">이름 오름차순</option>
          <option value="nameDesc">이름 내림차순</option>
        </select>
        <input type="date" value={examFromFilter} onChange={(e) => setExamFromFilter(e.target.value)} />
        <input type="date" value={examToFilter} onChange={(e) => setExamToFilter(e.target.value)} />
        <select value={windowDays} onChange={(e) => setWindowDays(e.target.value)}>
          <option value="all">기간 제한 없음</option>
          <option value="7">7일 내</option>
          <option value="14">14일 내</option>
          <option value="30">30일 내</option>
          <option value="60">60일 내</option>
        </select>
        <button
          type="button"
          className="secondary-btn"
          disabled={filtered.length === 0}
          onClick={() => {
            const headers = ["id", "memberId", "memberName", "examDate", "currentBelt", "targetBelt", "result", "notes"];
            const lines = filtered.map((r) =>
              [
                r.id,
                r.memberId,
                `"${String(r.memberName || r.name || "").replace(/"/g, "\"\"")}"`,
                r.examDate || r.scheduledDate || "",
                r.currentBelt || "",
                r.targetBelt || "",
                r.result || "",
                `"${String(r.notes || "").replace(/"/g, "\"\"")}"`,
              ].join(","),
            );
            const csv = [headers.join(","), ...lines].join("\n");
            const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = `promotions-${new Date().toISOString().slice(0, 10)}.csv`;
            document.body.appendChild(a);
            a.click();
            a.remove();
            URL.revokeObjectURL(url);
          }}
        >
          CSV 내보내기
        </button>
        <button
          type="button"
          className="secondary-btn"
          onClick={() => {
            setQuery("");
            setResultFilter("all");
            setSortOrder("nearest");
            setExamFromFilter("");
            setExamToFilter("");
            setWindowDays("all");
          }}
        >
          필터 초기화
        </button>
      </div>
      <div className="status-meta-grid" style={{ marginBottom: 10 }}>
        <div className="status-tile">
          <p className="tile-label">대기</p>
          <p className="tile-value">{rows.filter((r) => normalizeText(r.result) === "pending").length}건</p>
        </div>
        <div className="status-tile">
          <p className="tile-label">합격</p>
          <p className="tile-value">{rows.filter((r) => normalizeText(r.result) === "passed").length}건</p>
        </div>
        <div className="status-tile">
          <p className="tile-label">불합격</p>
          <p className="tile-value">{rows.filter((r) => normalizeText(r.result) === "failed").length}건</p>
        </div>
      </div>
      <div className="toolbar">
        <select value={bulkResultInput} onChange={(e) => setBulkResultInput(e.target.value)}>
          {PROMO_RESULT_OPTIONS.map((o) => (
            <option key={`bulk-${o.value}`} value={o.value}>{o.label}</option>
          ))}
        </select>
        <button
          type="button"
          className="primary-btn"
          disabled={!canManage || Object.values(selectedPromotionIds).every((v) => !v)}
          onClick={async () => {
            const ids = Object.entries(selectedPromotionIds)
              .filter(([, checked]) => checked)
              .map(([id]) => Number(id));
            if (ids.length === 0) return;
            setActionErr(null);
            try {
              await Promise.all(
                ids.map((id) =>
                  dojoClient.promotions.updateResult.mutate({
                    id,
                    result: bulkResultInput as "pending" | "passed" | "failed",
                  }),
                ),
              );
              setSelectedPromotionIds({});
              await load();
            } catch (e) {
              setActionErr(e instanceof Error ? e.message : String(e));
            }
          }}
        >
          선택 항목 결과 일괄 적용
        </button>
        <button
          type="button"
          className="secondary-btn"
          onClick={() => {
            const next: Record<number, boolean> = {};
            filtered.forEach((r) => {
              const id = Number(r.id);
              if (id) next[id] = true;
            });
            setSelectedPromotionIds(next);
          }}
        >
          필터 결과 전체 선택
        </button>
        <button type="button" className="secondary-btn" onClick={() => setSelectedPromotionIds({})}>
          선택 해제
        </button>
      </div>
      <p className="meta toolbar-meta">30일 내 예정 심사: {filtered.length}건</p>
      <div className="toolbar">
        <button
          type="button"
          className="danger-btn"
          disabled={!canManage || Object.values(selectedPromotionIds).every((v) => !v)}
          onClick={async () => {
            const ids = Object.entries(selectedPromotionIds)
              .filter(([, checked]) => checked)
              .map(([id]) => Number(id));
            if (ids.length === 0) return;
            if (!window.confirm(`선택한 심사 ${ids.length}건을 삭제할까요?`)) return;
            setActionErr(null);
            try {
              await Promise.all(ids.map((id) => dojoClient.promotions.delete.mutate({ id })));
              setSelectedPromotionIds({});
              await load();
            } catch (e) {
              setActionErr(e instanceof Error ? e.message : String(e));
            }
          }}
        >
          선택 삭제
        </button>
      </div>
      <div className="user-table-wrap">
        <table className="user-table">
          <thead>
            <tr>
              <th>선택</th>
              <th>회원</th>
              <th>현재 띠</th>
              <th>목표 띠</th>
              <th>심사일</th>
              <th>결과</th>
              <th>메모</th>
              <th>관리</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((r) => {
              const rid = r.id as number;
              const pick = promoResultPick[rid] ?? r.result ?? "pending";
              return (
              <tr key={r.id ?? `${r.memberId}-${r.examDate ?? r.scheduledDate ?? Math.random()}`}>
                <td>
                  <input
                    type="checkbox"
                    checked={Boolean(selectedPromotionIds[rid])}
                    onChange={(e) => setSelectedPromotionIds((prev) => ({ ...prev, [rid]: e.target.checked }))}
                    disabled={!canManage}
                  />
                </td>
                <td>{r.memberName || r.name || `회원 #${r.memberId ?? "-"}`}</td>
                <td>{beltLabel(r.currentBelt)}</td>
                <td>{beltLabel(r.targetBelt)}</td>
                <td>{r.examDate || r.scheduledDate || "—"}</td>
                <td>
                  <select
                    className="table-inline-select"
                    value={pick}
                    onChange={(e) =>
                      setPromoResultPick((prev) => ({ ...prev, [rid]: e.target.value }))
                    }
                    disabled={!connected || !canManage || !rid}
                  >
                    {PROMO_RESULT_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </td>
                <td>
                  <input
                    value={resultNotesDraft[rid] ?? r.notes ?? ""}
                    onChange={(e) => setResultNotesDraft((prev) => ({ ...prev, [rid]: e.target.value }))}
                    placeholder="결과 메모"
                    disabled={!connected || !canManage || !rid}
                  />
                </td>
                <td>
                  <div className="row-actions-inline">
                    <button
                      type="button"
                      className="secondary-btn"
                      onClick={async () => {
                        try {
                          await navigator.clipboard.writeText(String(r.id ?? ""));
                        } catch {
                          // ignore clipboard error
                        }
                      }}
                      disabled={!r.id}
                    >
                      ID 복사
                    </button>
                    <button
                      type="button"
                      className="secondary-btn"
                      onClick={() => {
                        setMemberIdInput(String(r.memberId ?? ""));
                        setExamDateInput(String(r.examDate || "").slice(0, 10));
                        setCurrentBeltInput(String(r.currentBelt || "white"));
                        setTargetBeltInput(String(r.targetBelt || "yellow"));
                      }}
                    >
                      복제
                    </button>
                    <button
                      type="button"
                      className="edit-btn"
                      disabled={!connected || !canManage || !rid || promoSavingId === rid}
                      onClick={async () => {
                        if (!rid) return;
                        const result = promoResultPick[rid] ?? r.result ?? "pending";
                        if (result === "passed") {
                          if (
                            !window.confirm(
                              "합격 처리 시 회원 띠가 목표 띠로 자동 갱신됩니다. 진행할까요?",
                            )
                          ) {
                            return;
                          }
                        }
                        setPromoSavingId(rid);
                        setActionErr(null);
                        try {
                          await dojoClient.promotions.updateResult.mutate({
                            id: rid,
                            result: result as "pending" | "passed" | "failed",
                            notes: (resultNotesDraft[rid] ?? r.notes ?? "").trim() || undefined,
                          });
                          setPromoResultPick((prev) => {
                            const next = { ...prev };
                            delete next[rid];
                            return next;
                          });
                          await load();
                        } catch (e) {
                          setActionErr(e instanceof Error ? e.message : String(e));
                        } finally {
                          setPromoSavingId(null);
                        }
                      }}
                    >
                      {promoSavingId === rid ? "저장 중..." : "결과 저장"}
                    </button>
                    <button
                      type="button"
                      className="danger-btn"
                      disabled={!connected || !canManage || !rid}
                      onClick={async () => {
                        if (!rid) return;
                        try {
                          await dojoClient.promotions.delete.mutate({ id: rid });
                          await load();
                        } catch (e) {
                          setActionErr(e instanceof Error ? e.message : String(e));
                        }
                      }}
                    >
                      삭제
                    </button>
                  </div>
                </td>
              </tr>
              );
            })}
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
  const [locationInput, setLocationInput] = useState("");
  const [deadlineInput, setDeadlineInput] = useState("");
  const [descriptionInput, setDescriptionInput] = useState("");
  const [createStatusInput, setCreateStatusInput] = useState("upcoming");
  const [statusFilter, setStatusFilter] = useState("all");
  const [sortOrder, setSortOrder] = useState("dateAsc");
  const [windowDays, setWindowDays] = useState("60");
  const [locationFilter, setLocationFilter] = useState("");
  const [startDateFilter, setStartDateFilter] = useState("");
  const [endDateFilter, setEndDateFilter] = useState("");
  const [selectedTournamentIds, setSelectedTournamentIds] = useState<Record<number, boolean>>({});
  const [bulkTournamentStatus, setBulkTournamentStatus] = useState("upcoming");
  const [bulkRegistrationDeadline, setBulkRegistrationDeadline] = useState("");
  const [statusDraft, setStatusDraft] = useState<Record<number, string>>({});
  const [statusSavingId, setStatusSavingId] = useState<number | null>(null);
  const [detail, setDetail] = useState<any | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [refreshingDetail, setRefreshingDetail] = useState(false);
  const [detailErr, setDetailErr] = useState<string | null>(null);
  const [participantMemberId, setParticipantMemberId] = useState("");
  const [participantBulkIds, setParticipantBulkIds] = useState("");
  const [participantSearch, setParticipantSearch] = useState("");
  const [participantResultFilter, setParticipantResultFilter] = useState("all");
  const [selectedParticipantIds, setSelectedParticipantIds] = useState<Record<number, boolean>>({});
  const [participantBulkResult, setParticipantBulkResult] = useState("participated");
  const [participantWeightClass, setParticipantWeightClass] = useState("");
  const [participantDivision, setParticipantDivision] = useState("");
  const [participantResultDraft, setParticipantResultDraft] = useState<Record<number, string>>({});
  const [participantSavingKey, setParticipantSavingKey] = useState<string | null>(null);
  const [editTournament, setEditTournament] = useState<{
    id: number;
    title: string;
    eventDate: string;
    location: string;
    registrationDeadline: string;
    description: string;
    status: string;
  } | null>(null);
  const [savingTournament, setSavingTournament] = useState(false);
  const [actionErr, setActionErr] = useState<string | null>(null);
  const canManage = userRole === "admin" || userRole === "manager";
  const load = useCallback(async () => {
    if (!connected) return;
    setErr(null);
    try {
      const list = await dojoClient.tournaments.upcoming.query({ days: Number(windowDays) || 60 });
      setRows(Array.isArray(list) ? list : []);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setRows([]);
    }
  }, [connected, dojoClient, windowDays]);
  useEffect(() => {
    void load();
  }, [load]);

  const filtered = rows
    .filter((r) => {
      const q = normalizeText(query);
      const title = normalizeText(r.name || r.title);
      const location = normalizeText(r.location);
      const status = normalizeText(r.status || "upcoming");
      const matchQuery = q.length === 0 || title.includes(q);
      const matchLocation = locationFilter.trim() === "" || location.includes(normalizeText(locationFilter));
      const matchStatus = statusFilter === "all" || status === statusFilter;
      const eventDate = String(r.eventDate || r.date || r.startDate || "");
      const matchStart = !startDateFilter || eventDate >= startDateFilter;
      const matchEnd = !endDateFilter || eventDate <= endDateFilter;
      return matchQuery && matchLocation && matchStatus && matchStart && matchEnd;
    })
    .sort((a, b) => {
      const ad = String(a.eventDate || a.date || "9999-12-31");
      const bd = String(b.eventDate || b.date || "9999-12-31");
      if (sortOrder === "dateDesc") return bd.localeCompare(ad);
      if (sortOrder === "participantsDesc") return Number(b.participantCount || 0) - Number(a.participantCount || 0);
      if (sortOrder === "participantsAsc") return Number(a.participantCount || 0) - Number(b.participantCount || 0);
      return ad.localeCompare(bd);
    });

  return (
    <section className="panel tab-panel page">
      <div className="page-head">
        <h2>🏆 대회</h2>
        <div className="row-actions-inline">
          <button type="button" onClick={() => void load()} disabled={!connected}>
            새로고침
          </button>
          <select value={windowDays} onChange={(e) => setWindowDays(e.target.value)}>
            <option value="30">최근 30일</option>
            <option value="60">최근 60일</option>
            <option value="90">최근 90일</option>
            <option value="180">최근 180일</option>
          </select>
        </div>
      </div>
      <LoadError err={err} />
      <div className="toolbar">
        <input value={titleInput} onChange={(e) => setTitleInput(e.target.value)} placeholder="대회명" />
        <input type="date" value={eventDateInput} onChange={(e) => setEventDateInput(e.target.value)} />
        <input value={locationInput} onChange={(e) => setLocationInput(e.target.value)} placeholder="장소 (선택)" />
        <input type="date" value={deadlineInput} onChange={(e) => setDeadlineInput(e.target.value)} />
        <select value={createStatusInput} onChange={(e) => setCreateStatusInput(e.target.value)}>
          {TOURNAMENT_STATUS_OPTIONS.map((o) => (
            <option key={`create-status-${o.value}`} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="secondary-btn"
          onClick={() => {
            const d = new Date();
            d.setDate(d.getDate() + 7);
            setEventDateInput(d.toISOString().slice(0, 10));
          }}
        >
          +7일
        </button>
        <button
          type="button"
          onClick={async () => {
            if (!titleInput.trim()) return;
            try {
              setActionErr(null);
              await dojoClient.tournaments.create.mutate({
                title: titleInput.trim(),
                eventDate: eventDateInput,
                location: locationInput.trim() || undefined,
                registrationDeadline: deadlineInput.trim() || undefined,
                description: descriptionInput.trim() || undefined,
                status: createStatusInput,
              });
              setTitleInput("");
              setLocationInput("");
              setDeadlineInput("");
              setDescriptionInput("");
              setCreateStatusInput("upcoming");
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
      <div className="toolbar">
        <input
          value={descriptionInput}
          onChange={(e) => setDescriptionInput(e.target.value)}
          placeholder="대회 설명 (선택)"
        />
      </div>
      {!canManage ? <p className="meta">대회 등록은 manager/admin 권한에서만 가능합니다.</p> : null}
      <ActionError err={actionErr} onRetry={canManage ? load : null} />
      <div className="toolbar">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="대회명 검색"
        />
        <input
          value={locationFilter}
          onChange={(e) => setLocationFilter(e.target.value)}
          placeholder="장소 검색"
        />
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="all">전체 상태</option>
          {TOURNAMENT_STATUS_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <input
          type="date"
          value={startDateFilter}
          onChange={(e) => setStartDateFilter(e.target.value)}
          placeholder="시작일"
        />
        <input
          type="date"
          value={endDateFilter}
          onChange={(e) => setEndDateFilter(e.target.value)}
          placeholder="종료일"
        />
        <select value={sortOrder} onChange={(e) => setSortOrder(e.target.value)}>
          <option value="dateAsc">일정 빠른순</option>
          <option value="dateDesc">일정 늦은순</option>
          <option value="participantsDesc">참가자 많은순</option>
          <option value="participantsAsc">참가자 적은순</option>
        </select>
        <button
          type="button"
          className="secondary-btn"
          disabled={filtered.length === 0}
          onClick={() => {
            const headers = ["id", "title", "eventDate", "status", "participantCount", "location", "registrationDeadline"];
            const lines = filtered.map((r) =>
              [
                r.id ?? "",
                `"${String(r.title || r.name || "").replace(/"/g, "\"\"")}"`,
                r.eventDate || r.date || "",
                r.status || "",
                r.participantCount ?? 0,
                `"${String(r.location || "").replace(/"/g, "\"\"")}"`,
                r.registrationDeadline || "",
              ].join(","),
            );
            const csv = [headers.join(","), ...lines].join("\n");
            const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = `tournaments-${new Date().toISOString().slice(0, 10)}.csv`;
            document.body.appendChild(a);
            a.click();
            a.remove();
            URL.revokeObjectURL(url);
          }}
        >
          CSV 내보내기
        </button>
        <button
          type="button"
          className="secondary-btn"
          onClick={() => {
            setQuery("");
            setLocationFilter("");
            setStatusFilter("all");
            setStartDateFilter("");
            setEndDateFilter("");
            setSortOrder("dateAsc");
          }}
        >
          필터 초기화
        </button>
        <button type="button" className="secondary-btn" onClick={() => setStatusFilter("upcoming")}>
          예정만
        </button>
        <button type="button" className="secondary-btn" onClick={() => setStatusFilter("ongoing")}>
          진행만
        </button>
        <button type="button" className="secondary-btn" onClick={() => setStatusFilter("completed")}>
          완료만
        </button>
      </div>
      <p className="meta toolbar-meta">최근 {windowDays}일 내 예정 대회: {filtered.length}건</p>
      <div className="status-meta-grid" style={{ marginBottom: 10 }}>
        <div className="status-tile">
          <p className="tile-label">예정</p>
          <p className="tile-value">{rows.filter((r) => normalizeText(r.status) === "upcoming").length}건</p>
        </div>
        <div className="status-tile">
          <p className="tile-label">진행</p>
          <p className="tile-value">{rows.filter((r) => normalizeText(r.status) === "ongoing").length}건</p>
        </div>
        <div className="status-tile">
          <p className="tile-label">완료</p>
          <p className="tile-value">{rows.filter((r) => normalizeText(r.status) === "completed").length}건</p>
        </div>
      </div>
      <div className="toolbar">
        <select value={bulkTournamentStatus} onChange={(e) => setBulkTournamentStatus(e.target.value)}>
          {TOURNAMENT_STATUS_OPTIONS.map((o) => (
            <option key={`bulk-tour-${o.value}`} value={o.value}>{o.label}</option>
          ))}
        </select>
        <button
          type="button"
          className="primary-btn"
          disabled={!canManage || Object.values(selectedTournamentIds).every((v) => !v)}
          onClick={async () => {
            const ids = Object.entries(selectedTournamentIds)
              .filter(([, checked]) => checked)
              .map(([id]) => Number(id));
            if (ids.length === 0) return;
            setActionErr(null);
            try {
              await Promise.all(
                ids.map((id) => dojoClient.tournaments.update.mutate({ id, status: bulkTournamentStatus })),
              );
              setSelectedTournamentIds({});
              await load();
            } catch (e) {
              setActionErr(e instanceof Error ? e.message : String(e));
            }
          }}
        >
          선택 대회 상태 일괄 적용
        </button>
        <input
          type="date"
          value={bulkRegistrationDeadline}
          onChange={(e) => setBulkRegistrationDeadline(e.target.value)}
        />
        <button
          type="button"
          className="secondary-btn"
          disabled={!canManage || Object.values(selectedTournamentIds).every((v) => !v)}
          onClick={async () => {
            const ids = Object.entries(selectedTournamentIds)
              .filter(([, checked]) => checked)
              .map(([id]) => Number(id));
            if (ids.length === 0) return;
            setActionErr(null);
            try {
              await Promise.all(
                ids.map((id) =>
                  dojoClient.tournaments.update.mutate({
                    id,
                    registrationDeadline: bulkRegistrationDeadline.trim() || null,
                  }),
                ),
              );
              await load();
            } catch (e) {
              setActionErr(e instanceof Error ? e.message : String(e));
            }
          }}
        >
          선택 접수마감 일괄 적용
        </button>
        <button
          type="button"
          className="secondary-btn"
          onClick={() => {
            const next: Record<number, boolean> = {};
            filtered.forEach((r) => {
              const rid = Number(r.id);
              if (rid) next[rid] = true;
            });
            setSelectedTournamentIds(next);
          }}
        >
          필터 결과 전체 선택
        </button>
        <button type="button" className="secondary-btn" onClick={() => setSelectedTournamentIds({})}>
          선택 해제
        </button>
        <button
          type="button"
          className="danger-btn"
          disabled={!canManage || Object.values(selectedTournamentIds).every((v) => !v)}
          onClick={async () => {
            const ids = Object.entries(selectedTournamentIds)
              .filter(([, checked]) => checked)
              .map(([id]) => Number(id));
            if (ids.length === 0) return;
            if (!window.confirm(`선택한 대회 ${ids.length}건을 삭제할까요?`)) return;
            setActionErr(null);
            try {
              await Promise.all(ids.map((id) => dojoClient.tournaments.delete.mutate({ id })));
              setSelectedTournamentIds({});
              await load();
            } catch (e) {
              setActionErr(e instanceof Error ? e.message : String(e));
            }
          }}
        >
          선택 삭제
        </button>
      </div>
      <div className="user-table-wrap">
        <table className="user-table">
          <thead>
            <tr>
              <th>선택</th>
              <th>대회명</th>
              <th>상태</th>
              <th>일정</th>
              <th>참가자</th>
              <th>상태 전환</th>
              <th>관리</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((r) => {
              const rid = Number(r.id);
              const status = normalizeText(r.status || "upcoming");
              const tone = status === "completed" ? "muted" : status === "cancelled" ? "danger" : "ok";
              const statusLabel = TOURNAMENT_STATUS_OPTIONS.find((o) => o.value === status)?.label ?? (r.status || "예정");
              const pick = statusDraft[rid] ?? status;
              return (
                <tr key={r.id ?? `${r.name}-${r.date ?? r.startDate ?? Math.random()}`}>
                  <td>
                    <input
                      type="checkbox"
                      checked={Boolean(selectedTournamentIds[rid])}
                      onChange={(e) => setSelectedTournamentIds((prev) => ({ ...prev, [rid]: e.target.checked }))}
                      disabled={!canManage}
                    />
                  </td>
                  <td>{r.name || r.title || "이름 없음"}</td>
                  <td>
                    <StatusBadge tone={tone}>{statusLabel}</StatusBadge>
                  </td>
                  <td>{r.eventDate || r.date || r.startDate || "—"}</td>
                  <td>{r.participantCount ?? r.participants?.length ?? 0}명</td>
                  <td>
                    <div className="row-actions-inline">
                      <select
                        className="table-inline-select"
                        value={pick}
                        onChange={(e) => setStatusDraft((prev) => ({ ...prev, [rid]: e.target.value }))}
                        disabled={!connected || !canManage || !rid}
                      >
                        {TOURNAMENT_STATUS_OPTIONS.map((o) => (
                          <option key={o.value} value={o.value}>
                            {o.label}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        className="edit-btn"
                        disabled={!connected || !canManage || !rid || statusSavingId === rid}
                        onClick={async () => {
                          if (!rid) return;
                          setStatusSavingId(rid);
                          setActionErr(null);
                          try {
                            await dojoClient.tournaments.update.mutate({
                              id: rid,
                              status: pick,
                            });
                            setStatusDraft((prev) => {
                              const next = { ...prev };
                              delete next[rid];
                              return next;
                            });
                            await load();
                            if (detail?.id === rid) {
                              const nextDetail = await dojoClient.tournaments.byId.query({ id: rid });
                              setDetail(nextDetail);
                            }
                          } catch (e) {
                            setActionErr(e instanceof Error ? e.message : String(e));
                          } finally {
                            setStatusSavingId(null);
                          }
                        }}
                      >
                        {statusSavingId === rid ? "저장 중..." : "상태 저장"}
                      </button>
                    </div>
                  </td>
                  <td>
                    <div className="row-actions-inline">
                      <button
                        type="button"
                        className="secondary-btn"
                        onClick={async () => {
                          try {
                            await navigator.clipboard.writeText(String(r.id ?? ""));
                          } catch {
                            // ignore clipboard error
                          }
                        }}
                        disabled={!r.id}
                      >
                        ID 복사
                      </button>
                      <button
                        type="button"
                        className="edit-btn"
                        disabled={!connected || !canManage || !rid}
                        onClick={async () => {
                          if (!rid) return;
                          setLoadingDetail(true);
                          setDetailErr(null);
                          setActionErr(null);
                          try {
                            const found = await dojoClient.tournaments.byId.query({ id: rid });
                            setDetail(found);
                            setParticipantMemberId("");
                            setParticipantWeightClass("");
                            setParticipantDivision("");
                            setParticipantResultDraft({});
                          } catch (e) {
                            setDetailErr(e instanceof Error ? e.message : String(e));
                          } finally {
                            setLoadingDetail(false);
                          }
                        }}
                      >
                        {loadingDetail && detail?.id !== rid ? "불러오는 중..." : "상세"}
                      </button>
                      <button
                        type="button"
                        className="edit-btn"
                        disabled={!connected || !canManage || !rid}
                        onClick={() => {
                          setEditTournament({
                            id: rid,
                            title: String(r.title || r.name || ""),
                            eventDate: String(r.eventDate || r.date || "").slice(0, 10),
                            location: String(r.location || ""),
                            registrationDeadline: String(r.registrationDeadline || "").slice(0, 10),
                            description: String(r.description || ""),
                            status: String(r.status || "upcoming"),
                          });
                        }}
                      >
                        수정
                      </button>
                      <button
                        type="button"
                        className="secondary-btn"
                        disabled={!canManage}
                        onClick={() => {
                          setTitleInput(String(r.title || r.name || ""));
                          setEventDateInput(String(r.eventDate || r.date || "").slice(0, 10));
                          setLocationInput(String(r.location || ""));
                          setDeadlineInput(String(r.registrationDeadline || "").slice(0, 10));
                          setDescriptionInput(String(r.description || ""));
                          window.scrollTo({ top: 0, behavior: "smooth" });
                        }}
                      >
                        복제
                      </button>
                      <button
                        type="button"
                        className="danger-btn"
                        disabled={!connected || !canManage || !r.id}
                        onClick={async () => {
                          if (!r.id) return;
                          try {
                            await dojoClient.tournaments.delete.mutate({ id: r.id });
                            await load();
                            if (detail?.id === r.id) setDetail(null);
                          } catch (e) {
                            setActionErr(e instanceof Error ? e.message : String(e));
                          }
                        }}
                      >
                        삭제
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {connected && filtered.length === 0 ? <EmptyState label="예정된 대회가 없습니다." /> : null}

      {detailErr ? <p className="err">{detailErr}</p> : null}
      {detail ? (
        <div className="tournament-detail-card">
          <div className="tournament-detail-head">
            <h3>{detail.title || "대회 상세"}</h3>
            <div className="row-actions-inline">
              <button
                type="button"
                className="edit-btn"
                disabled={!connected || refreshingDetail}
                onClick={async () => {
                  setRefreshingDetail(true);
                  setDetailErr(null);
                  try {
                    const nextDetail = await dojoClient.tournaments.byId.query({ id: detail.id });
                    setDetail(nextDetail);
                  } catch (e) {
                    setDetailErr(e instanceof Error ? e.message : String(e));
                  } finally {
                    setRefreshingDetail(false);
                  }
                }}
              >
                {refreshingDetail ? "새로고침 중..." : "상세 새로고침"}
              </button>
              <button type="button" className="secondary-btn" onClick={() => setDetail(null)}>
                닫기
              </button>
            </div>
          </div>
          <p className="meta">
            일정: {detail.eventDate || "—"} / 장소: {detail.location || "미정"} / 접수 마감: {detail.registrationDeadline || "미정"}
          </p>
          <p className="meta" style={{ marginBottom: 12 }}>
            상태: {TOURNAMENT_STATUS_OPTIONS.find((o) => o.value === detail.status)?.label ?? detail.status}
          </p>

          <div className="toolbar">
            <input
              value={participantMemberId}
              onChange={(e) => setParticipantMemberId(e.target.value)}
              placeholder="참가자 회원 ID"
            />
            <input
              value={participantWeightClass}
              onChange={(e) => setParticipantWeightClass(e.target.value)}
              placeholder="체급 (예: -81kg)"
            />
            <input
              value={participantDivision}
              onChange={(e) => setParticipantDivision(e.target.value)}
              placeholder="부문 (예: 성인 남자)"
            />
            <button
              type="button"
              className="primary-btn"
              disabled={!connected || !canManage}
              onClick={async () => {
                const memberId = Number(participantMemberId);
                if (!memberId) return;
                setActionErr(null);
                try {
                  await dojoClient.tournaments.registerParticipant.mutate({
                    tournamentId: detail.id,
                    memberId,
                    weightClass: participantWeightClass.trim() || undefined,
                    division: participantDivision.trim() || undefined,
                  });
                  const nextDetail = await dojoClient.tournaments.byId.query({ id: detail.id });
                  setDetail(nextDetail);
                  setParticipantMemberId("");
                } catch (e) {
                  setActionErr(e instanceof Error ? e.message : String(e));
                }
              }}
            >
              참가자 등록
            </button>
          </div>
          <div className="toolbar">
            <input
              value={participantBulkIds}
              onChange={(e) => setParticipantBulkIds(e.target.value)}
              placeholder="일괄 등록 회원 ID (쉼표/공백/줄바꿈)"
            />
            <button
              type="button"
              className="secondary-btn"
              disabled={!connected || !canManage}
              onClick={async () => {
                const ids = parseMemberIdList(participantBulkIds);
                if (ids.length === 0) return;
                setActionErr(null);
                try {
                  await Promise.all(
                    ids.map((memberId) =>
                      dojoClient.tournaments.registerParticipant.mutate({
                        tournamentId: detail.id,
                        memberId,
                        weightClass: participantWeightClass.trim() || undefined,
                        division: participantDivision.trim() || undefined,
                      }),
                    ),
                  );
                  const nextDetail = await dojoClient.tournaments.byId.query({ id: detail.id });
                  setDetail(nextDetail);
                  setParticipantBulkIds("");
                } catch (e) {
                  setActionErr(e instanceof Error ? e.message : String(e));
                }
              }}
            >
              일괄 등록
            </button>
            <input
              value={participantSearch}
              onChange={(e) => setParticipantSearch(e.target.value)}
              placeholder="참가자 검색(이름/ID)"
            />
            <select
              value={participantResultFilter}
              onChange={(e) => setParticipantResultFilter(e.target.value)}
            >
              <option value="all">결과 전체</option>
              {TOURNAMENT_RESULT_OPTIONS.map((o) => (
                <option key={`prf-${o.value}`} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="secondary-btn"
              onClick={() => {
                const next: Record<number, boolean> = {};
                (detail.participants || []).forEach((p: any) => {
                  const q = normalizeText(participantSearch);
                  const name = normalizeText(p.memberName || p.name);
                  const idText = normalizeText(p.memberId);
                  const result = normalizeText(p.result || "pending");
                  const matchQuery = !q || name.includes(q) || idText.includes(q);
                  const matchResult = participantResultFilter === "all" || result === participantResultFilter;
                  if (matchQuery && matchResult) next[Number(p.memberId)] = true;
                });
                setSelectedParticipantIds(next);
              }}
            >
              필터 결과 선택
            </button>
            <button type="button" className="secondary-btn" onClick={() => setSelectedParticipantIds({})}>
              참가자 선택 해제
            </button>
            <p className="meta toolbar-meta" style={{ margin: 0 }}>
              필터 결과 {(detail.participants || [])
                .filter((p: any) => {
                  const q = normalizeText(participantSearch);
                  const result = normalizeText(p.result || "pending");
                  const matchResult = participantResultFilter === "all" || result === participantResultFilter;
                  if (!q) return matchResult;
                  const name = normalizeText(p.memberName || p.name);
                  const idText = normalizeText(p.memberId);
                  return (name.includes(q) || idText.includes(q)) && matchResult;
                }).length}명
            </p>
            <button
              type="button"
              className="secondary-btn"
              onClick={() => {
                const participants = (detail.participants || []) as any[];
                if (participants.length === 0) return;
                const headers = ["memberId", "name", "weightClass", "division", "result"];
                const lines = participants.map((p) =>
                  [
                    p.memberId,
                    `"${String(p.memberName || p.name || "").replace(/"/g, "\"\"")}"`,
                    `"${String(p.weightClass || "").replace(/"/g, "\"\"")}"`,
                    `"${String(p.division || "").replace(/"/g, "\"\"")}"`,
                    p.result || "pending",
                  ].join(","),
                );
                const csv = [headers.join(","), ...lines].join("\n");
                const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
                const url = URL.createObjectURL(blob);
                const a = document.createElement("a");
                a.href = url;
                a.download = `tournament-${detail.id}-participants.csv`;
                document.body.appendChild(a);
                a.click();
                a.remove();
                URL.revokeObjectURL(url);
              }}
            >
              참가자 CSV
            </button>
            <select
              value={participantBulkResult}
              onChange={(e) => setParticipantBulkResult(e.target.value)}
            >
              {TOURNAMENT_RESULT_OPTIONS.map((o) => (
                <option key={`pbulk-${o.value}`} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="primary-btn"
              disabled={!canManage || Object.values(selectedParticipantIds).every((v) => !v)}
              onClick={async () => {
                const memberIds = Object.entries(selectedParticipantIds)
                  .filter(([, checked]) => checked)
                  .map(([id]) => Number(id));
                if (memberIds.length === 0) return;
                setActionErr(null);
                try {
                  await Promise.all(
                    memberIds.map((memberId) =>
                      dojoClient.tournaments.updateParticipantResult.mutate({
                        tournamentId: detail.id,
                        memberId,
                        result: participantBulkResult as
                          | "pending"
                          | "participated"
                          | "gold"
                          | "silver"
                          | "bronze"
                          | "absent",
                      }),
                    ),
                  );
                  const nextDetail = await dojoClient.tournaments.byId.query({ id: detail.id });
                  setDetail(nextDetail);
                  setSelectedParticipantIds({});
                } catch (e) {
                  setActionErr(e instanceof Error ? e.message : String(e));
                }
              }}
            >
              선택 참가자 결과 일괄
            </button>
            <button
              type="button"
              className="secondary-btn"
              disabled={!canManage || Object.values(selectedParticipantIds).every((v) => !v)}
              onClick={() => {
                const memberIds = Object.entries(selectedParticipantIds)
                  .filter(([, checked]) => checked)
                  .map(([id]) => Number(id));
                if (memberIds.length === 0) return;
                const selectedLines = (detail.participants || [])
                  .filter((p: any) => memberIds.includes(Number(p.memberId)))
                  .map((p: any) =>
                    [
                      p.memberId,
                      `"${String(p.memberName || p.name || "").replace(/"/g, "\"\"")}"`,
                      p.result || "pending",
                    ].join(","),
                  );
                const csv = [["memberId", "name", "result"].join(","), ...selectedLines].join("\n");
                const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
                const url = URL.createObjectURL(blob);
                const a = document.createElement("a");
                a.href = url;
                a.download = `tournament-${detail.id}-selected-participants.csv`;
                document.body.appendChild(a);
                a.click();
                a.remove();
                URL.revokeObjectURL(url);
              }}
            >
              선택 참가자 CSV
            </button>
            <button
              type="button"
              className="danger-btn"
              disabled={!canManage || Object.values(selectedParticipantIds).every((v) => !v)}
              onClick={async () => {
                const memberIds = Object.entries(selectedParticipantIds)
                  .filter(([, checked]) => checked)
                  .map(([id]) => Number(id));
                if (memberIds.length === 0) return;
                if (!window.confirm(`선택한 참가자 ${memberIds.length}명을 해제할까요?`)) return;
                setActionErr(null);
                try {
                  await Promise.all(
                    memberIds.map((memberId) =>
                      dojoClient.tournaments.removeParticipant.mutate({
                        tournamentId: detail.id,
                        memberId,
                      }),
                    ),
                  );
                  const nextDetail = await dojoClient.tournaments.byId.query({ id: detail.id });
                  setDetail(nextDetail);
                  setSelectedParticipantIds({});
                } catch (e) {
                  setActionErr(e instanceof Error ? e.message : String(e));
                }
              }}
            >
              선택 참가자 해제
            </button>
          </div>

          <div className="user-table-wrap">
            <table className="user-table">
              <thead>
                <tr>
                  <th>선택</th>
                  <th>회원</th>
                  <th>체급</th>
                  <th>부문</th>
                  <th>결과</th>
                  <th>관리</th>
                </tr>
              </thead>
              <tbody>
                {(detail.participants || [])
                  .filter((p: any) => {
                    const q = normalizeText(participantSearch);
                    const result = normalizeText(p.result || "pending");
                    const matchResult = participantResultFilter === "all" || result === participantResultFilter;
                    if (!q) return matchResult;
                    const name = normalizeText(p.memberName || p.name);
                    const idText = normalizeText(p.memberId);
                    return (name.includes(q) || idText.includes(q)) && matchResult;
                  })
                  .sort((a: any, b: any) => {
                    const an = normalizeText(a.memberName || a.name);
                    const bn = normalizeText(b.memberName || b.name);
                    if (an && bn) return an.localeCompare(bn, "ko");
                    return Number(a.memberId || 0) - Number(b.memberId || 0);
                  })
                  .map((p: any) => {
                  const memberId = Number(p.memberId);
                  const key = `${detail.id}:${memberId}`;
                  const result = participantResultDraft[memberId] ?? p.result ?? "pending";
                  return (
                    <tr key={key}>
                      <td>
                        <input
                          type="checkbox"
                          checked={Boolean(selectedParticipantIds[memberId])}
                          onChange={(e) =>
                            setSelectedParticipantIds((prev) => ({ ...prev, [memberId]: e.target.checked }))
                          }
                          disabled={!canManage}
                        />
                      </td>
                      <td>
                        <div className="row-actions-inline">
                          <span>{p.memberName || p.name || `회원 #${memberId}`}</span>
                          <button
                            type="button"
                            className="secondary-btn"
                            onClick={async () => {
                              try {
                                await navigator.clipboard.writeText(String(memberId));
                              } catch {
                                // ignore clipboard error
                              }
                            }}
                          >
                            ID 복사
                          </button>
                        </div>
                      </td>
                      <td>{p.weightClass || "—"}</td>
                      <td>{p.division || "—"}</td>
                      <td>
                        <select
                          className="table-inline-select"
                          value={result}
                          onChange={(e) => setParticipantResultDraft((prev) => ({ ...prev, [memberId]: e.target.value }))}
                          disabled={!connected || !canManage}
                        >
                          {TOURNAMENT_RESULT_OPTIONS.map((o) => (
                            <option key={o.value} value={o.value}>
                              {o.label}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td>
                        <div className="row-actions-inline">
                          <button
                            type="button"
                            className="edit-btn"
                            disabled={!connected || !canManage || participantSavingKey === key}
                            onClick={async () => {
                              setParticipantSavingKey(key);
                              setActionErr(null);
                              try {
                                await dojoClient.tournaments.updateParticipantResult.mutate({
                                  tournamentId: detail.id,
                                  memberId,
                                  result,
                                });
                                const nextDetail = await dojoClient.tournaments.byId.query({ id: detail.id });
                                setDetail(nextDetail);
                              } catch (e) {
                                setActionErr(e instanceof Error ? e.message : String(e));
                              } finally {
                                setParticipantSavingKey(null);
                              }
                            }}
                          >
                            {participantSavingKey === key ? "저장 중..." : "결과 저장"}
                          </button>
                          <button
                            type="button"
                            className="danger-btn"
                            disabled={!connected || !canManage || participantSavingKey === key}
                            onClick={async () => {
                              if (!window.confirm("해당 참가자를 대회에서 해제할까요?")) return;
                              setParticipantSavingKey(key);
                              setActionErr(null);
                              try {
                                await dojoClient.tournaments.removeParticipant.mutate({
                                  tournamentId: detail.id,
                                  memberId,
                                });
                                const nextDetail = await dojoClient.tournaments.byId.query({ id: detail.id });
                                setDetail(nextDetail);
                              } catch (e) {
                                setActionErr(e instanceof Error ? e.message : String(e));
                              } finally {
                                setParticipantSavingKey(null);
                              }
                            }}
                          >
                            해제
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {(detail.participants || []).length === 0 ? (
            <EmptyState label="등록된 참가자가 없습니다." />
          ) : null}
        </div>
      ) : null}

      {editTournament ? (
        <div
          className="modal-backdrop"
          role="presentation"
          onClick={(e) => {
            if (e.target === e.currentTarget && !savingTournament) setEditTournament(null);
          }}
        >
          <div className="modal-panel" role="dialog" aria-labelledby="tour-edit-title">
            <h3 id="tour-edit-title" className="modal-title">
              대회 정보 수정
            </h3>
            <div className="member-edit-form">
              <label className="member-edit-field">
                <span>대회명</span>
                <input
                  value={editTournament.title}
                  onChange={(e) => setEditTournament((s) => (s ? { ...s, title: e.target.value } : s))}
                  disabled={savingTournament}
                />
              </label>
              <label className="member-edit-field">
                <span>일정</span>
                <input
                  type="date"
                  value={editTournament.eventDate}
                  onChange={(e) => setEditTournament((s) => (s ? { ...s, eventDate: e.target.value } : s))}
                  disabled={savingTournament}
                />
              </label>
              <label className="member-edit-field">
                <span>장소</span>
                <input
                  value={editTournament.location}
                  onChange={(e) => setEditTournament((s) => (s ? { ...s, location: e.target.value } : s))}
                  disabled={savingTournament}
                />
              </label>
              <label className="member-edit-field">
                <span>접수 마감일</span>
                <input
                  type="date"
                  value={editTournament.registrationDeadline}
                  onChange={(e) =>
                    setEditTournament((s) => (s ? { ...s, registrationDeadline: e.target.value } : s))
                  }
                  disabled={savingTournament}
                />
              </label>
              <label className="member-edit-field">
                <span>상태</span>
                <select
                  value={editTournament.status}
                  onChange={(e) => setEditTournament((s) => (s ? { ...s, status: e.target.value } : s))}
                  disabled={savingTournament}
                >
                  {TOURNAMENT_STATUS_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="member-edit-field">
                <span>설명</span>
                <textarea
                  className="announcement-edit-textarea"
                  rows={4}
                  value={editTournament.description}
                  onChange={(e) => setEditTournament((s) => (s ? { ...s, description: e.target.value } : s))}
                  disabled={savingTournament}
                />
              </label>
            </div>
            <div className="modal-actions">
              <button
                type="button"
                className="secondary-btn"
                disabled={savingTournament}
                onClick={() => setEditTournament(null)}
              >
                취소
              </button>
              <button
                type="button"
                className="primary-btn"
                disabled={savingTournament}
                onClick={async () => {
                  if (!editTournament.title.trim() || !editTournament.eventDate) return;
                  setSavingTournament(true);
                  setActionErr(null);
                  try {
                    await dojoClient.tournaments.update.mutate({
                      id: editTournament.id,
                      title: editTournament.title.trim(),
                      eventDate: editTournament.eventDate,
                      location: editTournament.location.trim() || null,
                      registrationDeadline: editTournament.registrationDeadline.trim() || null,
                      description: editTournament.description.trim() || null,
                      status: editTournament.status,
                    });
                    setEditTournament(null);
                    await load();
                    if (detail?.id === editTournament.id) {
                      const nextDetail = await dojoClient.tournaments.byId.query({ id: editTournament.id });
                      setDetail(nextDetail);
                    }
                  } catch (e) {
                    setActionErr(e instanceof Error ? e.message : String(e));
                  } finally {
                    setSavingTournament(false);
                  }
                }}
              >
                {savingTournament ? "저장 중..." : "저장"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}

export function AnnouncementsPage({ dojoClient, connected, userRole }: CommonProps) {
  const [rows, setRows] = useState<any[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [pinFilter, setPinFilter] = useState("all");
  const [readFilter, setReadFilter] = useState("all");
  const [sortOrder, setSortOrder] = useState("latest");
  const [titleInput, setTitleInput] = useState("");
  const [contentInput, setContentInput] = useState("");
  const [createPinned, setCreatePinned] = useState(false);
  const [createPinnedUntil, setCreatePinnedUntil] = useState("");
  const [templateInput, setTemplateInput] = useState("custom");
  const [bulkPinnedUntil, setBulkPinnedUntil] = useState("");
  const [selectedIds, setSelectedIds] = useState<Record<number, boolean>>({});
  const [actionErr, setActionErr] = useState<string | null>(null);
  const [editAnnouncement, setEditAnnouncement] = useState<{
    id: number;
    title: string;
    content: string;
    isPinned: boolean;
    pinnedUntil: string;
  } | null>(null);
  const [savingAnnouncement, setSavingAnnouncement] = useState(false);
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

  const filtered = rows
    .filter((r) => {
      const q = normalizeText(query);
      const title = normalizeText(r.title);
      const body = normalizeText(r.body || r.content);
      const pinned = Boolean(r.pinned || r.isPinned);
      const read = Boolean(r.readAt);
      const matchQuery = q.length === 0 || title.includes(q) || body.includes(q);
      const matchPinned =
        pinFilter === "all" || (pinFilter === "pinned" ? pinned : !pinned);
      const matchRead = readFilter === "all" || (readFilter === "read" ? read : !read);
      return matchQuery && matchPinned && matchRead;
    })
    .sort((a, b) => {
      const ad = new Date(String(a.createdAt || 0)).getTime();
      const bd = new Date(String(b.createdAt || 0)).getTime();
      return sortOrder === "latest" ? bd - ad : ad - bd;
    });

  const unreadCount = rows.filter((r) => !r.readAt).length;
  const pinnedCount = rows.filter((r) => Boolean(r.pinned || r.isPinned)).length;
  const selectedCount = Object.values(selectedIds).filter(Boolean).length;

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
        <select
          value={templateInput}
          onChange={(e) => {
            const v = e.target.value;
            setTemplateInput(v);
            if (v === "custom") return;
            if (v === "notice-class-change") {
              setTitleInput("수업 시간 변경 안내");
              setContentInput("이번 주 수업 시간이 임시로 변경됩니다. 앱 공지를 확인해 주세요.");
            } else if (v === "notice-holiday") {
              setTitleInput("휴관 안내");
              setContentInput("공휴일로 인해 도장이 휴관합니다. 일정 확인 부탁드립니다.");
            } else if (v === "notice-tournament") {
              setTitleInput("대회 참가 안내");
              setContentInput("대회 참가 대상자 및 준비물 안내입니다. 세부 내용은 본문을 확인해 주세요.");
            }
          }}
        >
          <option value="custom">템플릿 선택(직접 작성)</option>
          <option value="notice-class-change">수업시간 변경</option>
          <option value="notice-holiday">휴관 안내</option>
          <option value="notice-tournament">대회 참가 안내</option>
        </select>
        <input value={titleInput} onChange={(e) => setTitleInput(e.target.value)} placeholder="공지 제목" />
        <label className="member-edit-field member-edit-check" style={{ minHeight: 38 }}>
          <input
            type="checkbox"
            checked={createPinned}
            onChange={(e) => setCreatePinned(e.target.checked)}
          />
          <span>상단 고정</span>
        </label>
        {createPinned ? (
          <input
            type="date"
            value={createPinnedUntil}
            onChange={(e) => setCreatePinnedUntil(e.target.value)}
          />
        ) : null}
        <button
          type="button"
          onClick={async () => {
            if (!titleInput.trim() || !contentInput.trim()) return;
            if (createPinned && createPinnedUntil) {
              const picked = new Date(createPinnedUntil);
              const today = new Date();
              today.setHours(0, 0, 0, 0);
              if (picked < today) {
                setActionErr("고정 만료일은 오늘 이후 날짜로 선택해 주세요.");
                return;
              }
            }
            try {
              setActionErr(null);
              await dojoClient.announcements.create.mutate({
                title: titleInput.trim(),
                content: contentInput.trim(),
                isPinned: createPinned,
                pinnedUntil: createPinned ? (createPinnedUntil.trim() || null) : null,
              });
              setTitleInput("");
              setContentInput("");
              setCreatePinned(false);
              setCreatePinnedUntil("");
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
      <div className="toolbar">
        <textarea
          className="announcement-edit-textarea"
          rows={3}
          value={contentInput}
          onChange={(e) => setContentInput(e.target.value)}
          placeholder="공지 내용"
        />
      </div>
      <p className="meta toolbar-meta">본문 길이: {contentInput.length}자</p>
      <div className="status-meta-grid" style={{ marginBottom: 10 }}>
        <div className="status-tile">
          <p className="tile-label">전체 공지</p>
          <p className="tile-value">{rows.length}개</p>
        </div>
        <div className="status-tile">
          <p className="tile-label">안읽음</p>
          <p className="tile-value">{unreadCount}개</p>
        </div>
        <div className="status-tile">
          <p className="tile-label">고정 공지</p>
          <p className="tile-value">{pinnedCount}개</p>
        </div>
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
        <select value={readFilter} onChange={(e) => setReadFilter(e.target.value)}>
          <option value="all">읽음 상태 전체</option>
          <option value="unread">안읽음</option>
          <option value="read">읽음</option>
        </select>
        <select value={sortOrder} onChange={(e) => setSortOrder(e.target.value)}>
          <option value="latest">최신순</option>
          <option value="oldest">오래된순</option>
        </select>
        <button
          type="button"
          className="danger-btn"
          disabled={!canManage || Object.values(selectedIds).every((v) => !v)}
          onClick={async () => {
            const ids = Object.entries(selectedIds)
              .filter(([, checked]) => checked)
              .map(([id]) => Number(id))
              .filter((id) => Number.isFinite(id));
            if (ids.length === 0) return;
            if (!window.confirm(`선택한 공지 ${ids.length}개를 삭제할까요?`)) return;
            setActionErr(null);
            try {
              await Promise.all(ids.map((id) => dojoClient.announcements.delete.mutate({ id })));
              setSelectedIds({});
              await load();
            } catch (e) {
              setActionErr(e instanceof Error ? e.message : String(e));
            }
          }}
        >
          선택 삭제
        </button>
        <input
          type="date"
          value={bulkPinnedUntil}
          onChange={(e) => setBulkPinnedUntil(e.target.value)}
        />
        <button
          type="button"
          className="secondary-btn"
          disabled={!canManage || selectedCount === 0}
          onClick={async () => {
            const ids = Object.entries(selectedIds)
              .filter(([, checked]) => checked)
              .map(([id]) => Number(id))
              .filter((id) => Number.isFinite(id));
            if (ids.length === 0) return;
            setActionErr(null);
            try {
              await Promise.all(
                ids.map((id) =>
                  dojoClient.announcements.update.mutate({
                    id,
                    isPinned: true,
                    pinnedUntil: bulkPinnedUntil.trim() || null,
                  }),
                ),
              );
              await load();
            } catch (e) {
              setActionErr(e instanceof Error ? e.message : String(e));
            }
          }}
        >
          선택 고정
        </button>
        <button
          type="button"
          className="secondary-btn"
          disabled={!canManage || selectedCount === 0}
          onClick={async () => {
            const ids = Object.entries(selectedIds)
              .filter(([, checked]) => checked)
              .map(([id]) => Number(id))
              .filter((id) => Number.isFinite(id));
            if (ids.length === 0) return;
            setActionErr(null);
            try {
              await Promise.all(
                ids.map((id) =>
                  dojoClient.announcements.update.mutate({
                    id,
                    isPinned: false,
                    pinnedUntil: null,
                  }),
                ),
              );
              await load();
            } catch (e) {
              setActionErr(e instanceof Error ? e.message : String(e));
            }
          }}
        >
          선택 고정 해제
        </button>
        <button
          type="button"
          className="secondary-btn"
          onClick={() => {
            const next: Record<number, boolean> = {};
            filtered.forEach((r) => {
              if (r.id) next[Number(r.id)] = true;
            });
            setSelectedIds(next);
          }}
        >
          필터 결과 전체 선택
        </button>
        <button
          type="button"
          className="secondary-btn"
          onClick={() => setSelectedIds({})}
        >
          선택 해제
        </button>
        <button
          type="button"
          className="secondary-btn"
          disabled={filtered.length === 0}
          onClick={() => {
            const headers = ["id", "title", "isPinned", "pinnedUntil", "readAt", "createdAt"];
            const lines = filtered.map((r) =>
              [
                r.id ?? "",
                `"${String(r.title || "").replace(/"/g, "\"\"")}"`,
                Boolean(r.isPinned ?? r.pinned),
                r.pinnedUntil ?? "",
                r.readAt ?? "",
                r.createdAt ?? "",
              ].join(","),
            );
            const csv = [headers.join(","), ...lines].join("\n");
            const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = `announcements-${new Date().toISOString().slice(0, 10)}.csv`;
            document.body.appendChild(a);
            a.click();
            a.remove();
            URL.revokeObjectURL(url);
          }}
        >
          CSV 내보내기
        </button>
      </div>
      <p className="meta toolbar-meta">공지 항목: {filtered.length}개</p>
      <div className="announcement-list">
        {filtered.map((r) => (
          <article className="announcement-card" key={r.id ?? `${r.title}-${r.createdAt ?? Math.random()}`}>
            <div className="announcement-head">
              <label className="member-edit-check">
                <input
                  type="checkbox"
                  checked={Boolean(selectedIds[Number(r.id)])}
                  onChange={(e) =>
                    setSelectedIds((prev) => ({ ...prev, [Number(r.id)]: e.target.checked }))
                  }
                  disabled={!canManage || !r.id}
                />
                <span className="meta">선택</span>
              </label>
              <strong>{r.title || "제목 없음"}</strong>
              {r.pinned || r.isPinned ? (
                <StatusBadge tone="warn">
                  {r.pinnedUntil ? `고정(~${String(r.pinnedUntil).slice(0, 10)})` : "고정"}
                </StatusBadge>
              ) : null}
              {r.readAt ? <StatusBadge tone="ok">읽음</StatusBadge> : <StatusBadge tone="muted">안읽음</StatusBadge>}
            </div>
            <p>{r.body || r.content || "내용 없음"}</p>
            <p className="meta">{r.createdAt || r.date || "날짜 정보 없음"}</p>
            <div className="row-actions">
              <button
                type="button"
                className="edit-btn"
                disabled={!connected || !canManage || !r.id}
                onClick={() => {
                  setActionErr(null);
                  setEditAnnouncement({
                    id: r.id,
                    title: String(r.title ?? ""),
                    content: String(r.body ?? r.content ?? ""),
                    isPinned: Boolean(r.isPinned ?? r.pinned),
                    pinnedUntil: r.pinnedUntil ? String(r.pinnedUntil).slice(0, 10) : "",
                  });
                }}
              >
                수정
              </button>
              <button
                type="button"
                className="secondary-btn"
                disabled={!connected || !canManage}
                onClick={() => {
                  setTitleInput(String(r.title ?? ""));
                  setContentInput(String(r.body ?? r.content ?? ""));
                  setCreatePinned(Boolean(r.isPinned ?? r.pinned));
                  setCreatePinnedUntil(r.pinnedUntil ? String(r.pinnedUntil).slice(0, 10) : "");
                }}
              >
                복제
              </button>
              <button
                type="button"
                className="secondary-btn"
                disabled={!connected || !r.id || Boolean(r.readAt)}
                onClick={async () => {
                  if (!r.id) return;
                  try {
                    await dojoClient.announcements.markRead.mutate({ announcementId: r.id });
                    await load();
                  } catch (e) {
                    setActionErr(e instanceof Error ? e.message : String(e));
                  }
                }}
              >
                읽음 처리
              </button>
              <button
                type="button"
                className="danger-btn"
                disabled={!connected || !canManage || !r.id}
                onClick={async () => {
                  if (!r.id) return;
                  try {
                    await dojoClient.announcements.delete.mutate({ id: r.id });
                    await load();
                  } catch (e) {
                    setActionErr(e instanceof Error ? e.message : String(e));
                  }
                }}
              >
                삭제
              </button>
            </div>
          </article>
        ))}
      </div>
      {connected && filtered.length === 0 ? <EmptyState label="공지 데이터가 없습니다." /> : null}

      {editAnnouncement ? (
        <div
          className="modal-backdrop"
          role="presentation"
          onClick={(e) => {
            if (e.target === e.currentTarget && !savingAnnouncement) setEditAnnouncement(null);
          }}
        >
          <div className="modal-panel" role="dialog" aria-labelledby="ann-edit-title">
            <h3 id="ann-edit-title" className="modal-title">
              공지 수정
            </h3>
            <div className="member-edit-form">
              <label className="member-edit-field">
                <span>제목</span>
                <input
                  value={editAnnouncement.title}
                  onChange={(e) =>
                    setEditAnnouncement((s) => (s ? { ...s, title: e.target.value } : s))
                  }
                  disabled={savingAnnouncement}
                />
              </label>
              <label className="member-edit-field">
                <span>내용</span>
                <textarea
                  className="announcement-edit-textarea"
                  rows={5}
                  value={editAnnouncement.content}
                  onChange={(e) =>
                    setEditAnnouncement((s) => (s ? { ...s, content: e.target.value } : s))
                  }
                  disabled={savingAnnouncement}
                />
              </label>
              <label className="member-edit-field member-edit-check">
                <input
                  type="checkbox"
                  checked={editAnnouncement.isPinned}
                  onChange={(e) =>
                    setEditAnnouncement((s) => (s ? { ...s, isPinned: e.target.checked } : s))
                  }
                  disabled={savingAnnouncement}
                />
                <span>상단 고정</span>
              </label>
              {editAnnouncement.isPinned ? (
                <label className="member-edit-field">
                  <span>고정 만료일 (비우면 무기한)</span>
                  <input
                    type="date"
                    value={editAnnouncement.pinnedUntil}
                    onChange={(e) =>
                      setEditAnnouncement((s) => (s ? { ...s, pinnedUntil: e.target.value } : s))
                    }
                    disabled={savingAnnouncement}
                  />
                </label>
              ) : null}
            </div>
            <div className="modal-actions">
              <button
                type="button"
                className="secondary-btn"
                disabled={savingAnnouncement}
                onClick={() => setEditAnnouncement(null)}
              >
                취소
              </button>
              <button
                type="button"
                className="primary-btn"
                disabled={savingAnnouncement}
                onClick={async () => {
                  if (!editAnnouncement.title.trim() || !editAnnouncement.content.trim()) return;
                  setSavingAnnouncement(true);
                  setActionErr(null);
                  try {
                    await dojoClient.announcements.update.mutate({
                      id: editAnnouncement.id,
                      title: editAnnouncement.title.trim(),
                      content: editAnnouncement.content.trim(),
                      isPinned: editAnnouncement.isPinned,
                      pinnedUntil: editAnnouncement.isPinned
                        ? editAnnouncement.pinnedUntil.trim() === ""
                          ? null
                          : editAnnouncement.pinnedUntil.trim()
                        : null,
                    });
                    setEditAnnouncement(null);
                    await load();
                  } catch (e) {
                    setActionErr(e instanceof Error ? e.message : String(e));
                  } finally {
                    setSavingAnnouncement(false);
                  }
                }}
              >
                {savingAnnouncement ? "저장 중..." : "저장"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
