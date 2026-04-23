export type HealthResponse = {
  status: string;
};

export type ScenarioItem = {
  id: string;
  summary: string;
  cadence: string;
  scenario_type: string;
  preconditions: string;
  trigger: string;
  first_action: string;
  success: string;
};

export type ProductVisionResponse = {
  one_liner: string;
  scenarios: ScenarioItem[];
  differentiation: string[];
  doc_paths: Record<string, string>;
};
