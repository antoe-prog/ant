export const pilotOperationsInputLimits = {
  blockerSummary: 1_000,
  branchId: 200,
  checkId: 200,
  description: 2_000,
  evidence: 1_000,
  mobileAttendanceEvidence: 500,
  owner: 80,
  screen: 120,
  title: 120,
  workaround: 1_000,
} as const;

export function exceedsPilotInputLimit(value: string | null | undefined, limit: number) {
  return typeof value === "string" && value.length > limit;
}
