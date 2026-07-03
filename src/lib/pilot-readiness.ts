import type { PilotReadinessCheck } from "@/lib/domain";

type PilotReadinessDefinition = Pick<PilotReadinessCheck, "category" | "id" | "label" | "owner">;

export const pilotReadinessDefinitions = [
  {
    id: "pilot-branches",
    category: "scope",
    label: "운영 준비 지점 1-2곳과 2주 기간 확정",
    owner: "총괄 PM",
  },
  {
    id: "pilot-accounts",
    category: "scope",
    label: "대표/코치/학부모/회원 운영 계정 확정",
    owner: "총괄 어드민",
  },
  {
    id: "pilot-password-rotation",
    category: "security",
    label: "계정별 비밀번호 교체와 전달 채널 확인",
    owner: "총괄 어드민",
  },
  {
    id: "pilot-data",
    category: "data",
    label: "실제 시간표, 회원권, 결제 상태 입력 후 운영 현황 재확인",
    owner: "운영 담당자",
  },
  {
    id: "pilot-mobile-attendance",
    category: "device",
    label: "현장 코치 모바일 기기에서 수업별 출석 30초 처리 계측",
    owner: "코치 리드",
  },
  {
    id: "pilot-screenreader",
    category: "accessibility",
    label: "접근성 현장 확인",
    owner: "접근성 담당",
  },
  {
    id: "pilot-incident-channel",
    category: "incident",
    label: "장애 보고 채널과 운영 중단 기준 확정",
    owner: "총괄 PM",
  },
  {
    id: "pilot-retro",
    category: "operation",
    label: "운영 종료 후 피드백 기록과 개선 우선순위 확정",
    owner: "총괄 PM",
  },
] as const satisfies readonly PilotReadinessDefinition[];

export const prePilotReadinessIds = pilotReadinessDefinitions
  .filter((definition) => definition.id !== "pilot-retro")
  .map((definition) => definition.id);

export function createDefaultPilotReadinessChecks(): PilotReadinessCheck[] {
  return pilotReadinessDefinitions.map((definition) => ({
    ...definition,
    status: "pending",
    evidence: "",
  }));
}
