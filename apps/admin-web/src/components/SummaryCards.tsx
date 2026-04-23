type Tone = "blue" | "green" | "purple" | "orange" | "red";

type SummaryCardsProps = {
  healthStatus?: string;
  userCount: number;
  adminCount: number;
  latencyMs?: number | null;
};

type StatCard = {
  key: string;
  label: string;
  value: string;
  unit?: string;
  hint: string;
  tone: Tone;
  icon: string;
};

export default function SummaryCards({
  healthStatus,
  userCount,
  adminCount,
  latencyMs,
}: SummaryCardsProps) {
  const isHealthy = healthStatus === "ok";

  const cards: StatCard[] = [
    {
      key: "gateway",
      label: "Gateway 상태",
      value: isHealthy ? "정상" : healthStatus ? "지연" : "대기",
      hint: "GET /health",
      tone: isHealthy ? "green" : "orange",
      icon: isHealthy ? "🟢" : "🟡",
    },
    {
      key: "users",
      label: "등록 계정",
      value: String(userCount),
      unit: "개",
      hint: "도장 웹 로그인 계정",
      tone: "blue",
      icon: "👥",
    },
    {
      key: "admins",
      label: "관리자 계정",
      value: String(adminCount),
      unit: "개",
      hint: "admin 권한 기준",
      tone: "purple",
      icon: "🛡️",
    },
    {
      key: "latency",
      label: "응답 시간",
      value: latencyMs != null ? String(latencyMs) : "—",
      unit: latencyMs != null ? "ms" : undefined,
      hint: "마지막 갱신 기준",
      tone:
        latencyMs == null
          ? "orange"
          : latencyMs < 300
            ? "green"
            : latencyMs < 800
              ? "orange"
              : "red",
      icon: "⚡",
    },
  ];

  return (
    <section className="summary-grid" aria-label="주요 지표">
      {cards.map((c) => (
        <article key={c.key} className="stat-card" data-tone={c.tone}>
          <div className="stat-head">
            <p className="stat-label">{c.label}</p>
            <span className="stat-badge" aria-hidden="true">
              {c.icon}
            </span>
          </div>
          <div className="stat-value-row">
            <span className="stat-value">{c.value}</span>
            {c.unit ? <span className="stat-unit">{c.unit}</span> : null}
          </div>
          <p className="stat-hint">{c.hint}</p>
        </article>
      ))}
    </section>
  );
}
