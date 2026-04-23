import type { ScenarioItem } from "../types";

type ScenariosPageProps = {
  scenarios: ScenarioItem[];
};

export default function ScenariosPage({ scenarios }: ScenariosPageProps) {
  return (
    <section className="panel tab-panel" role="tabpanel">
      <h2>핵심 시나리오</h2>
      <div className="scenario-list">
        {scenarios.map((scenario) => (
          <div className="scenario-item" key={scenario.id}>
            <p className="scenario-title">
              {scenario.id} · {scenario.summary}
            </p>
            <p className="meta">
              주기: {scenario.cadence} / 유형: {scenario.scenario_type}
            </p>
          </div>
        ))}
        {!scenarios.length ? <p className="meta">표시할 데이터가 없습니다.</p> : null}
      </div>
    </section>
  );
}
