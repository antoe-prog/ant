type StatusPageProps = {
  oneLiner?: string;
  healthStatus?: string;
  lastUpdatedAt: string | null;
  latencyMs: number | null;
};

export default function StatusPage({
  oneLiner,
  healthStatus,
  lastUpdatedAt,
  latencyMs,
}: StatusPageProps) {
  return (
    <section className="panel tab-panel" role="tabpanel">
      <h2>상태 개요</h2>
      <p className="one-liner">{oneLiner ?? "—"}</p>
      <div className="status-meta-grid">
        <div className="status-tile">
          <p className="tile-label">Gateway</p>
          <p className="tile-value">{healthStatus ?? "연결 대기"}</p>
        </div>
        <div className="status-tile">
          <p className="tile-label">최근 갱신</p>
          <p className="tile-value">{lastUpdatedAt ?? "—"}</p>
        </div>
        <div className="status-tile">
          <p className="tile-label">응답 시간</p>
          <p className="tile-value">
            {latencyMs !== null ? `${latencyMs} ms` : "—"}
          </p>
        </div>
      </div>
    </section>
  );
}
