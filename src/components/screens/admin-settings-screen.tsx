"use client";

import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CalendarCheck,
  CheckCircle2,
  ClipboardCheck,
  Clock3,
  Database,
  FileCheck2,
  History,
  ListChecks,
  Settings2,
  ShieldCheck,
} from "lucide-react";
import { useApiContext } from "@/hooks/use-api-context";
import {
  formatBranchTimezone,
  normalizeBranchSettings,
  userRoles,
  type PilotIncident,
  type PilotIncidentSeverity,
  type PilotIncidentStatus,
  type PilotOperationLog,
  type PilotReadinessCheck,
  type PilotReadinessStatus,
  type UserRole,
} from "@/lib/domain";
import { addDaysToDateKey, formatDateKey } from "@/lib/format";
import { roleAccessDescriptions, roleLabels } from "@/lib/roles";
import { useAppStore } from "@/store/app-store";
import { SectionHeader } from "@/components/ui/primitives";

const auditPolicies = [
  "출석 수정과 사유 기록",
  "결제 생성과 내보내기",
  "권한 변경과 사용자 초대",
  "지점 생성/수정/대표 배정",
  "변경 기록 조회",
];

const pilotCategoryLabels: Record<PilotReadinessCheck["category"], string> = {
  accessibility: "접근성",
  data: "입력 자료",
  device: "현장 기기",
  incident: "장애 대응",
  operation: "운영 기록",
  security: "보안",
  scope: "범위 확정",
};

const pilotStatusLabels: Record<PilotReadinessStatus, string> = {
  blocked: "확인 필요",
  pending: "대기",
  verified: "확인",
};

const pilotStatusStyles: Record<PilotReadinessStatus, string> = {
  blocked: "border-red-200 bg-red-50 text-red-700",
  pending: "border-amber-200 bg-amber-50 text-amber-700",
  verified: "border-emerald-200 bg-emerald-50 text-emerald-700",
};

const incidentSeverityLabels: Record<PilotIncidentSeverity, string> = {
  p0: "긴급",
  p1: "우선",
  p2: "개선",
};

const incidentSeverityStyles: Record<PilotIncidentSeverity, string> = {
  p0: "border-red-200 bg-red-50 text-red-700",
  p1: "border-amber-200 bg-amber-50 text-amber-700",
  p2: "border-blue-200 bg-blue-50 text-blue-700",
};

const incidentStatusLabels: Record<PilotIncidentStatus, string> = {
  monitoring: "모니터링",
  open: "열림",
  resolved: "해결",
};

const incidentStatusStyles: Record<PilotIncidentStatus, string> = {
  monitoring: "border-blue-200 bg-blue-50 text-blue-700",
  open: "border-red-200 bg-red-50 text-red-700",
  resolved: "border-emerald-200 bg-emerald-50 text-emerald-700",
};

const pilotOperationRequiredDays = 14;

const pilotNextActionStyles = {
  danger: "border-red-200 bg-red-50 text-red-800",
  neutral: "border-zinc-200 bg-zinc-50 text-zinc-700",
  success: "border-emerald-200 bg-emerald-50 text-emerald-800",
  warning: "border-amber-200 bg-amber-50 text-amber-800",
};

type PilotReadinessDraft = {
  evidence: string;
  owner: string;
  status: PilotReadinessStatus;
};

type PilotIncidentCreateDraft = {
  branchId: string;
  description: string;
  owner: string;
  role: UserRole | "unknown";
  screen: string;
  severity: PilotIncidentSeverity;
  title: string;
  workaround: string;
};

type PilotIncidentUpdateDraft = {
  owner: string;
  status: PilotIncidentStatus;
  workaround: string;
};

type PilotOperationLogDraft = {
  attendanceRecords: number;
  blockerSummary: string;
  branchId: string;
  classesChecked: number;
  date: string;
  evidence: string;
  mobileAttendanceDurationSeconds: number;
  mobileAttendanceEvidence: string;
  noticeChecks: number;
  owner: string;
  paymentChecks: number;
  noticeFollowupChecks: number;
  status: PilotReadinessStatus;
};

type PilotNextAction = {
  detail: string;
  label: string;
  targetLabel: string;
  tone: keyof typeof pilotNextActionStyles;
};

function formatAdminPilotCheckLabel(value: string) {
  if (value.includes("파일럿 지점")) {
    return value.replace("파일럿 지점", "운영 준비 지점");
  }

  if (value.includes("파일럿 계정")) {
    return value.replace("실제 파일럿 계정", "운영 계정").replace("파일럿 계정", "운영 계정");
  }

  if (value.includes("파일럿 종료 후")) {
    return value.replace("파일럿 종료 후", "운영 종료 후");
  }

  if (value.includes("비밀번호 계정별 교체")) {
    return "계정별 비밀번호 교체와 전달 채널 확인";
  }

  if (value.includes("실제 스크린리더와 키보드 운용 확인") || value.includes("스크린리더와 키보드")) {
    return "접근성 현장 확인";
  }

  if (value.includes("test:pilot 재검증")) {
    return value.replace("test:pilot 재검증", "운영 현황 재확인");
  }

  return value;
}

function todayInputValue() {
  return formatDateKey(new Date());
}

function addDaysInputValue(dateInput: string, days: number) {
  return addDaysToDateKey(dateInput, days);
}

export function AdminSettingsScreen() {
  const context = useApiContext();
  const { createPilotIncident, updatePilotIncident, updatePilotReadiness, upsertPilotOperationLog } = useAppStore();
  const [drafts, setDrafts] = useState<Record<string, PilotReadinessDraft>>({});
  const [incidentDraft, setIncidentDraft] = useState<PilotIncidentCreateDraft>({
    branchId: "",
    description: "",
    owner: "총괄 PM",
    role: "unknown",
    screen: "",
    severity: "p1",
    title: "",
    workaround: "",
  });
  const [operationDraft, setOperationDraft] = useState<PilotOperationLogDraft>({
    attendanceRecords: 0,
    blockerSummary: "",
    branchId: "",
    classesChecked: 0,
    date: todayInputValue(),
    evidence: "",
    mobileAttendanceDurationSeconds: 0,
    mobileAttendanceEvidence: "",
    noticeChecks: 0,
    owner: "총괄 PM",
    paymentChecks: 0,
    noticeFollowupChecks: 0,
    status: "verified",
  });
  const [incidentUpdates, setIncidentUpdates] = useState<Record<string, PilotIncidentUpdateDraft>>({});
  const [savingId, setSavingId] = useState<string | null>(null);
  const [incidentSavingId, setIncidentSavingId] = useState<string | null>(null);
  const [operationSaving, setOperationSaving] = useState(false);
  const [readinessEditorOpen, setReadinessEditorOpen] = useState(false);
  const [readinessListOpen, setReadinessListOpen] = useState(false);
  const [operationEditorOpen, setOperationEditorOpen] = useState(false);
  const [incidentCreateOpen, setIncidentCreateOpen] = useState(false);
  const [incidentEditorId, setIncidentEditorId] = useState<string | null>(null);
  const [settingsView, setSettingsView] = useState<"policy" | "operations">("policy");
  const [rolePolicyOpen, setRolePolicyOpen] = useState(false);
  const [branchPolicyOpen, setBranchPolicyOpen] = useState(false);
  const [auditPolicyOpen, setAuditPolicyOpen] = useState(false);
  const [operatorDetailOpen, setOperatorDetailOpen] = useState(false);
  const [operationDetailOpen, setOperationDetailOpen] = useState(false);
  const [incidentListOpen, setIncidentListOpen] = useState(false);

  useEffect(() => {
    const navigateToHashTarget = () => {
      const rawHash = window.location.hash.slice(1);

      if (!rawHash) {
        return;
      }

      if (
        rawHash.startsWith("pilot-") ||
        rawHash.startsWith("admin-settings-readiness") ||
        rawHash.startsWith("admin-settings-operation") ||
        rawHash.startsWith("admin-settings-incident") ||
        rawHash.startsWith("admin-settings-operator")
      ) {
        setSettingsView("operations");
      } else if (rawHash.startsWith("admin-settings-policy")) {
        setSettingsView("policy");
      }

      window.setTimeout(() => {
        const target = document.getElementById(decodeURIComponent(rawHash));

        target?.scrollIntoView({ block: "start", behavior: "auto" });
      }, 0);
    };

    const initialTimer = window.setTimeout(navigateToHashTarget, 0);
    const retryTimer = window.setTimeout(navigateToHashTarget, 250);

    window.addEventListener("hashchange", navigateToHashTarget);

    return () => {
      window.clearTimeout(initialTimer);
      window.clearTimeout(retryTimer);
      window.removeEventListener("hashchange", navigateToHashTarget);
    };
  }, []);

  function selectSettingsView(nextView: "policy" | "operations", focusTab = false) {
    setSettingsView(nextView);
    window.history.replaceState(null, "", `#admin-settings-${nextView}-view`);

    if (focusTab) {
      requestAnimationFrame(() => document.getElementById(`admin-settings-${nextView}-tab`)?.focus());
    }
  }

  function handleSettingsTabKeyDown(event: React.KeyboardEvent<HTMLButtonElement>) {
    const nextView =
      event.key === "ArrowRight" || event.key === "End"
        ? "operations"
        : event.key === "ArrowLeft" || event.key === "Home"
          ? "policy"
          : null;

    if (!nextView) {
      return;
    }

    event.preventDefault();
    selectSettingsView(nextView, true);
  }

  const pilotChecks = context.db.pilotReadinessChecks;
  const pilotIncidents = context.db.pilotIncidents;
  const pilotOperationLogs = context.db.pilotOperationLogs;
  const readinessListVisible = readinessListOpen || readinessEditorOpen;
  const branchPolicySummary = useMemo(() => {
    const settings = context.db.branches.map((branch) => normalizeBranchSettings(branch.settings));
    const reasonRequiredCount = settings.filter((item) => item.attendanceEditRequiresReason).length;

    return {
      branchCount: context.db.branches.length,
      reasonRequiredCount,
    };
  }, [context.db.branches]);
  const pilotSummary = useMemo(
    () => ({
      blocked: pilotChecks.filter((check) => check.status === "blocked").length,
      pending: pilotChecks.filter((check) => check.status === "pending").length,
      verified: pilotChecks.filter((check) => check.status === "verified").length,
      total: pilotChecks.length,
    }),
    [pilotChecks],
  );
  const incidentSummary = useMemo(
    () => ({
      monitoring: pilotIncidents.filter((incident) => incident.status === "monitoring").length,
      open: pilotIncidents.filter((incident) => incident.status === "open").length,
      p0: pilotIncidents.filter((incident) => incident.severity === "p0").length,
      resolved: pilotIncidents.filter((incident) => incident.status === "resolved").length,
      total: pilotIncidents.length,
    }),
    [pilotIncidents],
  );
  const operationSummary = useMemo(() => {
    const verifiedLogs = pilotOperationLogs.filter((log) => log.status === "verified");
    const verifiedDayKeys = new Set(verifiedLogs.map((log) => log.date));

    return {
      blocked: pilotOperationLogs.filter((log) => log.status === "blocked").length,
      pending: pilotOperationLogs.filter((log) => log.status === "pending").length,
      verifiedDays: verifiedDayKeys.size,
      total: pilotOperationLogs.length,
      attendanceRecords: verifiedLogs.reduce((sum, log) => sum + log.attendanceRecords, 0),
      paymentChecks: verifiedLogs.reduce((sum, log) => sum + log.paymentChecks, 0),
    };
  }, [pilotOperationLogs]);
  const operationCoverage = useMemo(() => {
    const verifiedDates = [...new Set(pilotOperationLogs.filter((log) => log.status === "verified").map((log) => log.date))].sort();
    const startDate = verifiedDates[0] ?? operationDraft.date;
    const requiredWindow = Array.from({ length: pilotOperationRequiredDays }, (_, index) => addDaysInputValue(startDate, index));
    const missingDates = requiredWindow.filter((date) => !verifiedDates.includes(date));
    const nextRecommendedDate =
      missingDates[0] ?? (verifiedDates.length > 0 ? addDaysInputValue(verifiedDates[verifiedDates.length - 1], 1) : operationDraft.date);
    const attendanceLogs = pilotOperationLogs.filter((log) => log.status === "verified" && log.attendanceRecords > 0);
    const mobileEvidenceMissingLogs = attendanceLogs.filter(
      (log) =>
        typeof log.mobileAttendanceDurationSeconds !== "number" ||
        log.mobileAttendanceDurationSeconds <= 0 ||
        log.mobileAttendanceDurationSeconds > 30 ||
        (log.mobileAttendanceEvidence?.trim().length ?? 0) < 5,
    );

    return {
      complete: verifiedDates.length >= pilotOperationRequiredDays && mobileEvidenceMissingLogs.length === 0,
      missingDates,
      mobileEvidenceMissingLogs,
      nextRecommendedDate,
      requiredWindow,
      startDate,
      verifiedDates,
    };
  }, [operationDraft.date, pilotOperationLogs]);
  const unresolvedPriorityIncidents = useMemo(
    () =>
      pilotIncidents.filter(
        (incident) => incident.status !== "resolved" && (incident.severity === "p0" || incident.severity === "p1"),
      ),
    [pilotIncidents],
  );
  const mobileAttendanceEvidenceSummary = useMemo(() => {
    const attendanceLogs = pilotOperationLogs.filter((log) => log.status === "verified" && log.attendanceRecords > 0);
    const verifiedEvidenceLogs = attendanceLogs.filter(
      (log) =>
        typeof log.mobileAttendanceDurationSeconds === "number" &&
        log.mobileAttendanceDurationSeconds > 0 &&
        log.mobileAttendanceDurationSeconds <= 30 &&
        (log.mobileAttendanceEvidence?.trim().length ?? 0) >= 5,
    );

    return {
      required: attendanceLogs.length,
      verified: verifiedEvidenceLogs.length,
    };
  }, [pilotOperationLogs]);
  const pilotNextActions = useMemo<PilotNextAction[]>(() => {
    const actions: PilotNextAction[] = [];

    if (pilotSummary.blocked > 0) {
      actions.push({
        detail: `확인 필요 항목 ${pilotSummary.blocked}개를 담당자와 확인 메모까지 정리합니다.`,
        label: "운영 점검 확인",
        targetLabel: "관리자 설정",
        tone: "danger",
      });
    }

    if (pilotSummary.pending > 0) {
      actions.push({
        detail: "대기 중인 점검 항목의 담당자와 확인 메모를 채웁니다.",
        label: "대기 점검 정리",
        targetLabel: "운영 담당자 확인",
        tone: "warning",
      });
    }

    if (unresolvedPriorityIncidents.length > 0) {
      actions.push({
        detail: `긴급 이슈 ${unresolvedPriorityIncidents.length}건의 조치 계획과 담당자를 확정합니다.`,
        label: "긴급 이슈 처리",
        targetLabel: "관리자 설정",
        tone: "danger",
      });
    }

    if (operationSummary.verifiedDays < pilotOperationRequiredDays) {
      actions.push({
        detail: `운영일 ${operationSummary.verifiedDays}/${pilotOperationRequiredDays}일 확인. 출석, 결제, 공지 수치만 저장합니다.`,
        label: "운영일 기록 입력",
        targetLabel: "운영 기록",
        tone: "warning",
      });
    }

    if (mobileAttendanceEvidenceSummary.required > mobileAttendanceEvidenceSummary.verified) {
      actions.push({
        detail: `출석이 기록된 운영일 ${mobileAttendanceEvidenceSummary.required}건 중 ${mobileAttendanceEvidenceSummary.verified}건만 30초 이하 확인 기록을 갖고 있습니다.`,
        label: "모바일 출석 확인 기록 점검",
        targetLabel: "출석 확인 기록",
        tone: "warning",
      });
    }

    actions.push({
      detail: "계정·운영·이슈 상태",
      label: "최종 상태 리포트",
      targetLabel: "운영 상태 확인",
      tone: actions.length === 0 ? "success" : "neutral",
    });

    return actions;
  }, [mobileAttendanceEvidenceSummary, operationSummary, pilotSummary, unresolvedPriorityIncidents]);
  const operationActivityCount =
    operationDraft.classesChecked +
    operationDraft.attendanceRecords +
    operationDraft.paymentChecks +
    operationDraft.noticeFollowupChecks +
    operationDraft.noticeChecks;

  function getDraft(check: PilotReadinessCheck): PilotReadinessDraft {
    return drafts[check.id] ?? { evidence: check.evidence, owner: check.owner, status: check.status };
  }

  function updateDraft(check: PilotReadinessCheck, patch: Partial<PilotReadinessDraft>) {
    setDrafts((current) => ({
      ...current,
      [check.id]: {
        ...(current[check.id] ?? { evidence: check.evidence, owner: check.owner, status: check.status }),
        ...patch,
      },
    }));
  }

  function getIncidentUpdateDraft(incident: PilotIncident): PilotIncidentUpdateDraft {
    return incidentUpdates[incident.id] ?? {
      owner: incident.owner,
      status: incident.status,
      workaround: incident.workaround,
    };
  }

  function updateIncidentDraft(patch: Partial<PilotIncidentCreateDraft>) {
    setIncidentDraft((current) => ({ ...current, ...patch }));
  }

  function updateIncidentUpdateDraft(incident: PilotIncident, patch: Partial<PilotIncidentUpdateDraft>) {
    setIncidentUpdates((current) => ({
      ...current,
      [incident.id]: {
        ...(current[incident.id] ?? {
          owner: incident.owner,
          status: incident.status,
          workaround: incident.workaround,
        }),
        ...patch,
      },
    }));
  }

  function updateOperationDraft(patch: Partial<PilotOperationLogDraft>) {
    setOperationDraft((current) => ({ ...current, ...patch }));
  }

  async function handlePilotCheckSave(check: PilotReadinessCheck) {
    const draft = getDraft(check);

    setSavingId(check.id);
    const ok = await updatePilotReadiness({
      checkId: check.id,
      evidence: draft.evidence,
      owner: draft.owner,
      status: draft.status,
    });
    setSavingId(null);

    if (ok) {
      setDrafts((current) => {
        const next = { ...current };
        delete next[check.id];
        return next;
      });
    }
  }

  async function handlePilotIncidentCreate() {
    setIncidentSavingId("create");
    const ok = await createPilotIncident({
      ...incidentDraft,
      branchId: incidentDraft.branchId || null,
      description: incidentDraft.description.trim(),
      owner: incidentDraft.owner.trim(),
      screen: incidentDraft.screen.trim(),
      title: incidentDraft.title.trim(),
      workaround: incidentDraft.workaround.trim(),
    });
    setIncidentSavingId(null);

    if (ok) {
      setIncidentDraft({
        branchId: "",
        description: "",
        owner: "총괄 PM",
        role: "unknown",
        screen: "",
        severity: "p1",
        title: "",
        workaround: "",
      });
      setIncidentCreateOpen(false);
    }
  }

  async function handlePilotIncidentUpdate(incident: PilotIncident) {
    const draft = getIncidentUpdateDraft(incident);

    setIncidentSavingId(incident.id);
    const ok = await updatePilotIncident(incident.id, {
      owner: draft.owner,
      status: draft.status,
      workaround: draft.workaround,
    });
    setIncidentSavingId(null);

    if (ok) {
      setIncidentUpdates((current) => {
        const next = { ...current };
        delete next[incident.id];
        return next;
      });
      setIncidentEditorId(null);
    }
  }

  async function handlePilotOperationSave() {
    setOperationSaving(true);
    const ok = await upsertPilotOperationLog({
      ...operationDraft,
      branchId: operationDraft.branchId || null,
      blockerSummary: operationDraft.blockerSummary.trim(),
      evidence: operationDraft.evidence.trim(),
      mobileAttendanceDurationSeconds:
        operationDraft.mobileAttendanceDurationSeconds > 0 ? operationDraft.mobileAttendanceDurationSeconds : undefined,
      mobileAttendanceEvidence: operationDraft.mobileAttendanceEvidence.trim(),
      owner: operationDraft.owner.trim(),
    });
    setOperationSaving(false);

    if (ok) {
      setOperationDraft((current) => ({
        ...current,
        attendanceRecords: 0,
        blockerSummary: "",
        classesChecked: 0,
        evidence: "",
        mobileAttendanceDurationSeconds: 0,
        mobileAttendanceEvidence: "",
        noticeChecks: 0,
        paymentChecks: 0,
        noticeFollowupChecks: 0,
      }));
      setOperationEditorOpen(false);
    }
  }

  return (
    <div>
      <SectionHeader title="운영 설정" />

      <section
        className="grid min-h-11 grid-cols-3 overflow-hidden rounded-md border border-zinc-200 bg-white"
        aria-label="운영 설정 요약"
        data-testid="admin-settings-summary-bar"
      >
        <div className="flex min-w-0 flex-col items-center justify-center gap-0.5 px-2 py-1 text-center">
          <p className="truncate text-xs font-medium leading-4 text-zinc-600">역할</p>
          <p className="text-sm font-semibold leading-4 tabular-nums text-zinc-950">{userRoles.length}</p>
        </div>
        <div className="flex min-w-0 flex-col items-center justify-center gap-0.5 border-l border-zinc-200 bg-teal-50 px-2 py-1 text-center">
          <p className="truncate text-xs font-medium leading-4 text-teal-700">지점</p>
          <p className="text-sm font-semibold leading-4 tabular-nums text-zinc-950">{context.db.branches.length}</p>
        </div>
        <div className="flex min-w-0 flex-col items-center justify-center gap-0.5 border-l border-zinc-200 bg-amber-50 px-2 py-1 text-center">
          <p className="truncate text-xs font-medium leading-4 text-amber-700">기록</p>
          <p className="text-sm font-semibold leading-4 tabular-nums text-zinc-950">{auditPolicies.length}</p>
        </div>
      </section>

      <div
        aria-label="운영 설정 보기"
        className="mt-3 grid grid-cols-2 gap-1 rounded-md border border-zinc-200 bg-zinc-100 p-1"
        role="tablist"
      >
        <button
          aria-controls="admin-settings-policy-view"
          aria-selected={settingsView === "policy"}
          className={`min-h-11 rounded px-3 text-sm font-semibold transition ${
            settingsView === "policy" ? "bg-white text-zinc-950 shadow-sm" : "text-zinc-600 hover:bg-white/70"
          }`}
          data-testid="admin-settings-policy-tab"
          id="admin-settings-policy-tab"
          role="tab"
          tabIndex={settingsView === "policy" ? 0 : -1}
          type="button"
          onClick={() => selectSettingsView("policy")}
          onKeyDown={handleSettingsTabKeyDown}
        >
          정책·권한
        </button>
        <button
          aria-controls="admin-settings-operations-view"
          aria-selected={settingsView === "operations"}
          className={`min-h-11 rounded px-3 text-sm font-semibold transition ${
            settingsView === "operations" ? "bg-white text-zinc-950 shadow-sm" : "text-zinc-600 hover:bg-white/70"
          }`}
          data-testid="admin-settings-operations-tab"
          id="admin-settings-operations-tab"
          role="tab"
          tabIndex={settingsView === "operations" ? 0 : -1}
          type="button"
          onClick={() => selectSettingsView("operations")}
          onKeyDown={handleSettingsTabKeyDown}
        >
          현장 운영
        </button>
      </div>

      {settingsView === "policy" ? (
      <div aria-labelledby="admin-settings-policy-tab" data-testid="admin-settings-policy-view" id="admin-settings-policy-view" role="tabpanel">

      <section className="mt-3 grid gap-3 xl:grid-cols-[0.9fr_1.1fr]">
        <div className="rounded-lg border border-zinc-200 bg-white p-3">
          <div className="flex items-start justify-between gap-3">
            <div className="flex min-w-0 items-center gap-2">
              <ShieldCheck className="h-4 w-4 shrink-0 text-teal-700" aria-hidden />
              <h2 className="text-base font-semibold text-zinc-950">역할/권한 기준</h2>
            </div>
            <button
              aria-controls="admin-settings-role-policy-detail"
              aria-expanded={rolePolicyOpen}
              className="inline-flex min-h-11 shrink-0 items-center justify-center rounded-md border border-zinc-200 bg-white px-3 text-sm font-semibold text-zinc-800 transition hover:bg-zinc-50"
              data-testid="admin-settings-role-policy-toggle"
              type="button"
              onClick={() => setRolePolicyOpen((current) => !current)}
            >
              {rolePolicyOpen ? "권한 기준 닫기" : "권한 기준 보기"}
            </button>
          </div>
          <div className="mt-2 grid grid-cols-3 gap-1.5" data-testid="admin-settings-role-policy-summary">
            <div className="rounded-md border border-zinc-200 bg-zinc-50 px-2 py-1.5">
              <p className="text-xs font-semibold text-zinc-500">이용자</p>
              <p className="mt-0.5 text-xs font-semibold text-zinc-950 sm:text-sm">회원/학부모</p>
            </div>
            <div className="rounded-md border border-zinc-200 bg-zinc-50 px-2 py-1.5">
              <p className="text-xs font-semibold text-zinc-500">현장</p>
              <p className="mt-0.5 text-xs font-semibold text-zinc-950 sm:text-sm">코치</p>
            </div>
            <div className="rounded-md border border-zinc-200 bg-zinc-50 px-2 py-1.5">
              <p className="text-xs font-semibold text-zinc-500">관리</p>
              <p className="mt-0.5 text-xs font-semibold text-zinc-950 sm:text-sm">대표/총괄</p>
            </div>
          </div>
          {rolePolicyOpen ? (
            <div className="mt-3 divide-y divide-zinc-100" data-testid="admin-settings-role-policy-detail" id="admin-settings-role-policy-detail">
              {userRoles.map((role) => (
                <div className="grid gap-2 py-3 sm:grid-cols-[0.8fr_1fr]" key={role}>
                  <p className="text-sm font-semibold text-zinc-950">{roleLabels[role]}</p>
                  <p className="text-sm leading-6 text-zinc-600">{roleAccessDescriptions[role]}</p>
                </div>
              ))}
            </div>
          ) : null}
        </div>

        <div className="rounded-lg border border-zinc-200 bg-white p-3">
          <div className="flex items-start justify-between gap-3">
            <div className="flex min-w-0 items-center gap-2">
              <Settings2 className="h-4 w-4 shrink-0 text-teal-700" aria-hidden />
              <h2 className="text-base font-semibold text-zinc-950">지점 운영 정책</h2>
            </div>
            <button
              aria-controls="admin-settings-branch-policy-detail"
              aria-expanded={branchPolicyOpen}
              className="inline-flex min-h-11 shrink-0 items-center justify-center rounded-md border border-zinc-200 bg-white px-3 text-sm font-semibold text-zinc-800 transition hover:bg-zinc-50"
              data-testid="admin-settings-branch-policy-toggle"
              type="button"
              onClick={() => setBranchPolicyOpen((current) => !current)}
            >
              {branchPolicyOpen ? "지점 정책 닫기" : "지점 정책 보기"}
            </button>
          </div>
          <div className="mt-2 grid grid-cols-2 gap-1.5" data-testid="admin-settings-branch-policy-summary">
            <div className="rounded-md border border-zinc-200 bg-zinc-50 px-2 py-1.5">
              <p className="text-xs font-semibold text-zinc-500">지점</p>
              <p className="mt-0.5 text-xs font-semibold text-zinc-950 sm:text-sm">{branchPolicySummary.branchCount}개</p>
            </div>
            <div className="rounded-md border border-zinc-200 bg-zinc-50 px-2 py-1.5">
              <p className="text-xs font-semibold text-zinc-500">사유</p>
              <p className="mt-0.5 text-xs font-semibold text-zinc-950 sm:text-sm">{branchPolicySummary.reasonRequiredCount}개 필수</p>
            </div>
          </div>
          {branchPolicyOpen ? (
            <div className="mt-3 divide-y divide-zinc-100" data-testid="admin-settings-branch-policy-detail" id="admin-settings-branch-policy-detail">
              {context.db.branches.map((branch) => {
                const settings = normalizeBranchSettings(branch.settings);

                return (
                  <article className="grid gap-3 py-4 md:grid-cols-[0.9fr_1.4fr]" key={branch.id}>
                    <div>
                      <p className="font-semibold text-zinc-950">{branch.name}</p>
                      <p className="mt-1 text-sm text-zinc-500">{branch.district}</p>
                    </div>
                    <div className="grid gap-2 text-sm leading-6 text-zinc-600 sm:grid-cols-2">
                      <p>{settings.attendanceEditRequiresReason ? "출석 수정 사유 필수" : "출석 수정 사유 선택"}</p>
                      <p>{formatBranchTimezone(branch.timezone)}</p>
                    </div>
                  </article>
                );
              })}
            </div>
          ) : null}
        </div>
      </section>

      <section className="mt-3 grid gap-3 xl:grid-cols-2">
        <div className="rounded-lg border border-zinc-200 bg-white p-3">
          <div className="flex items-start justify-between gap-3">
            <div className="flex min-w-0 items-center gap-2">
              <History className="h-4 w-4 shrink-0 text-teal-700" aria-hidden />
              <h2 className="text-base font-semibold text-zinc-950">변경 기록 필수 항목</h2>
            </div>
            <button
              aria-controls="admin-settings-audit-policy-detail"
              aria-expanded={auditPolicyOpen}
              className="inline-flex min-h-11 shrink-0 items-center justify-center rounded-md border border-zinc-200 bg-white px-3 text-sm font-semibold text-zinc-800 transition hover:bg-zinc-50"
              data-testid="admin-settings-audit-policy-toggle"
              type="button"
              onClick={() => setAuditPolicyOpen((current) => !current)}
            >
              {auditPolicyOpen ? "기록 항목 닫기" : "기록 항목 보기"}
            </button>
          </div>
          <div className="mt-2 rounded-md border border-zinc-200 bg-zinc-50 px-2 py-1.5" data-testid="admin-settings-audit-policy-summary">
            <p className="text-xs font-semibold text-zinc-950 sm:text-sm">필수 기록 {auditPolicies.length}개</p>
            <p className="mt-0.5 text-[11px] leading-4 text-zinc-600 sm:text-xs">출석, 결제, 권한, 지점 변경은 사유와 함께 남깁니다.</p>
          </div>
          {auditPolicyOpen ? (
            <ul className="mt-3 grid gap-2 text-sm leading-6 text-zinc-600" data-testid="admin-settings-audit-policy-detail" id="admin-settings-audit-policy-detail">
              {auditPolicies.map((policy) => (
                <li className="rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2" key={policy}>
                  {policy}
                </li>
              ))}
            </ul>
          ) : null}
        </div>

        <div className="rounded-lg border border-zinc-200 bg-white p-3">
          <div className="flex items-center gap-2">
            <Database className="h-4 w-4 text-teal-700" aria-hidden />
            <h2 className="text-base font-semibold text-zinc-950">운영 기준</h2>
          </div>
          <div className="mt-2 grid grid-cols-2 gap-1.5 text-[11px] font-semibold leading-4 text-zinc-600 sm:text-xs" data-testid="admin-settings-service-policy-summary">
            <p className="rounded-md border border-zinc-200 bg-zinc-50 px-2 py-1.5">지점별 데이터 분리</p>
            <p className="rounded-md border border-zinc-200 bg-zinc-50 px-2 py-1.5">코치 금액 비노출</p>
            <p className="rounded-md border border-zinc-200 bg-zinc-50 px-2 py-1.5">관리자 승인 기준</p>
            <p className="rounded-md border border-zinc-200 bg-zinc-50 px-2 py-1.5">역할별 정보 제한</p>
          </div>
        </div>
      </section>
      </div>
      ) : null}

      {settingsView === "operations" ? (
      <div aria-labelledby="admin-settings-operations-tab" data-testid="admin-settings-operations-view" id="admin-settings-operations-view" role="tabpanel">

      <section
        className="mt-3 rounded-lg border border-teal-200 bg-teal-50/40 p-4 shadow-sm"
        aria-labelledby="pilot-operator-support-heading"
        data-testid="admin-settings-priority-work"
      >
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div className="flex items-center gap-2">
            <ListChecks className="h-4 w-4 text-teal-700" aria-hidden />
            <div>
              <p className="text-xs font-semibold text-teal-700">현장 운영 관제</p>
              <h2 id="pilot-operator-support-heading" className="mt-0.5 text-lg font-semibold text-zinc-950">
                우선 작업
              </h2>
            </div>
          </div>
          <div className="flex flex-wrap gap-2 text-xs font-semibold">
            <span className="rounded-md border border-zinc-200 bg-white px-2 py-1 text-zinc-700">다음 액션 {pilotNextActions.length}개</span>
            <span className="rounded-md border border-red-200 bg-red-50 px-2 py-1 text-red-700">
              긴급 이슈 {unresolvedPriorityIncidents.length}건
            </span>
          </div>
        </div>

        <div className="mt-3 grid grid-cols-4 gap-2" data-testid="admin-settings-operator-summary">
          <article className="min-w-0 rounded-md border border-zinc-200 bg-zinc-50 px-2 py-2">
            <p className="text-xs font-semibold text-zinc-500">준비 확인</p>
            <p className="mt-1 text-lg font-semibold tabular-nums leading-6 text-zinc-950">
              {pilotSummary.verified}/{pilotSummary.total}
            </p>
          </article>
          <article className="min-w-0 rounded-md border border-zinc-200 bg-zinc-50 px-2 py-2">
            <p className="text-xs font-semibold text-zinc-500">운영일</p>
            <p className="mt-1 text-lg font-semibold tabular-nums leading-6 text-zinc-950">
              {operationSummary.verifiedDays}/{pilotOperationRequiredDays}
            </p>
          </article>
          <article className="min-w-0 rounded-md border border-zinc-200 bg-zinc-50 px-2 py-2">
            <p className="truncate text-xs font-semibold text-zinc-500">모바일</p>
            <p className="mt-1 text-lg font-semibold tabular-nums leading-6 text-zinc-950">
              {mobileAttendanceEvidenceSummary.verified}/{mobileAttendanceEvidenceSummary.required}
            </p>
          </article>
          <article className="min-w-0 rounded-md border border-zinc-200 bg-zinc-50 px-2 py-2">
            <p className="text-xs font-semibold text-zinc-500">이슈</p>
            <p className="mt-1 text-lg font-semibold tabular-nums leading-6 text-zinc-950">{unresolvedPriorityIncidents.length}</p>
          </article>
        </div>

        <div className="mt-3 grid gap-3">
          <ol className="grid gap-2" data-testid="admin-settings-priority-action-list">
            {pilotNextActions.slice(0, 1).map((action, index) => (
              <li
                className={`rounded-md border px-3 py-2.5 ${pilotNextActionStyles[action.tone]}`}
                key={`${action.label}-${action.targetLabel}`}
              >
                <div className="flex min-w-0 items-start gap-2.5">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded bg-white/80 text-xs font-bold tabular-nums text-zinc-700">
                    {index + 1}
                  </span>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold">{action.label}</p>
                    <p className="mt-0.5 text-sm leading-5">{action.detail}</p>
                  </div>
                </div>
              </li>
            ))}
          </ol>
          <button
            aria-controls="admin-settings-operator-detail"
            aria-expanded={operatorDetailOpen}
            className="min-h-11 rounded-md border border-zinc-300 bg-white px-3 text-sm font-semibold text-zinc-900"
            data-testid="admin-settings-operator-detail-toggle"
            type="button"
            onClick={() => setOperatorDetailOpen((current) => !current)}
          >
            {operatorDetailOpen
              ? "전체 관제 상세 닫기"
              : pilotNextActions.length > 1
                ? `나머지 ${pilotNextActions.length - 1}건과 상세 보기`
                : "전체 관제 상세 보기"}
          </button>
        </div>

        {operatorDetailOpen ? (
          <div className="mt-4 grid gap-4 xl:grid-cols-[0.8fr_1.2fr]" data-testid="admin-settings-operator-detail" id="admin-settings-operator-detail">
            <div className="min-w-0 rounded-md border border-zinc-200 bg-zinc-50 p-3">
              <div className="flex items-center gap-2">
                <ClipboardCheck className="h-4 w-4 text-teal-700" aria-hidden />
                <h3 className="text-sm font-semibold text-zinc-950">현재 판단</h3>
              </div>
              <div className="mt-3 grid gap-2 text-sm leading-6 text-zinc-600">
                <p className="rounded-md border border-zinc-200 bg-white px-3 py-2">
                  운영 점검은 {pilotSummary.verified}개 확인, {pilotSummary.pending}개 대기, {pilotSummary.blocked}개 확인 필요입니다.
                </p>
                <p className="rounded-md border border-zinc-200 bg-white px-3 py-2">
                  운영 기록은 {operationSummary.verifiedDays}일 확인되었고 최종 확인 기준은 {pilotOperationRequiredDays}일입니다.
                </p>
                <p className="rounded-md border border-zinc-200 bg-white px-3 py-2">
                  모바일 출석 확인은 출석 기록 운영일 {mobileAttendanceEvidenceSummary.required}건 중 {mobileAttendanceEvidenceSummary.verified}건이 30초 이하 확인 기록을 갖고 있습니다.
                </p>
              </div>
            </div>

            <div className="min-w-0">
              <h3 className="text-sm font-semibold text-zinc-950">다음 액션</h3>
              <ol className="mt-3 grid gap-3">
                {pilotNextActions.map((action, index) => (
                  <li className={`rounded-md border p-3 ${pilotNextActionStyles[action.tone]}`} key={`${action.label}-${action.targetLabel}`}>
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                      <div>
                        <p className="text-sm font-semibold">
                          {index + 1}. {action.label}
                        </p>
                        <p className="mt-1 text-sm leading-6">{action.detail}</p>
                      </div>
                      <span className="block shrink-0 break-words rounded bg-white/70 px-2 py-1 text-xs font-semibold text-zinc-700 sm:max-w-72">
                        {action.targetLabel}
                      </span>
                    </div>
                  </li>
                ))}
              </ol>
            </div>
          </div>
        ) : null}
      </section>

      <section
        className="mt-5 border-t border-zinc-200 px-1 py-4"
        aria-labelledby="pilot-readiness-heading"
        data-operation-tier="secondary"
      >
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div className="flex items-center gap-2">
            <FileCheck2 className="h-4 w-4 text-teal-700" aria-hidden />
            <h2 id="pilot-readiness-heading" className="text-base font-semibold text-zinc-950">
              운영 점검
            </h2>
          </div>
          <div className="flex flex-wrap gap-2 text-xs font-semibold">
            <span className="rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-amber-700">
              대기 {pilotSummary.pending}개
            </span>
            <span className="rounded-md border border-zinc-200 bg-white px-2 py-1 text-zinc-700">
              확인 {pilotSummary.verified}/{pilotSummary.total}
            </span>
          </div>
        </div>

        <div className="mt-3 grid gap-3">
          <div className="grid grid-cols-3 gap-2" data-testid="admin-settings-readiness-summary">
            <div className="min-w-0 rounded-md border border-zinc-200 bg-zinc-50 px-2 py-2 text-center">
              <p className="truncate text-[10px] font-semibold text-zinc-500">확인</p>
              <p className="mt-0.5 text-lg font-semibold leading-6 tabular-nums text-zinc-950">
                {pilotSummary.verified}/{pilotSummary.total}
              </p>
            </div>
            <div className="min-w-0 rounded-md border border-amber-200 bg-amber-50 px-2 py-2 text-center">
              <p className="truncate text-[10px] font-semibold text-amber-700">대기</p>
              <p className="mt-0.5 text-lg font-semibold leading-6 tabular-nums text-zinc-950">{pilotSummary.pending}</p>
            </div>
            <div className="min-w-0 rounded-md border border-red-200 bg-red-50 px-2 py-2 text-center">
              <p className="truncate text-[10px] font-semibold text-red-700">확인 필요</p>
              <p className="mt-0.5 text-lg font-semibold leading-6 tabular-nums text-zinc-950">{pilotSummary.blocked}</p>
            </div>
          </div>

          <div className="min-w-0">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <h3 className="text-sm font-semibold text-zinc-950">운영 전 확인</h3>
              <button
                aria-controls="admin-settings-readiness-list"
                aria-expanded={readinessListVisible}
                className="min-h-11 rounded-md border border-zinc-300 bg-white px-3 text-sm font-semibold text-zinc-900"
                data-testid="admin-settings-readiness-list-toggle"
                type="button"
                onClick={() => {
                  if (!readinessEditorOpen) {
                    setReadinessListOpen((current) => !current);
                  }
                }}
              >
                {readinessEditorOpen ? "수정 화면 표시 중" : readinessListOpen ? "상세 닫기" : "상세 보기"}
              </button>
              <button
                aria-controls="admin-settings-readiness-editor-region"
                aria-expanded={readinessEditorOpen}
                className="min-h-11 rounded-md border border-zinc-300 bg-white px-3 text-sm font-semibold text-zinc-900"
                data-testid="admin-settings-readiness-editor-toggle"
                type="button"
                onClick={() => setReadinessEditorOpen((current) => !current)}
              >
                {readinessEditorOpen ? "수정 닫기" : "점검 수정"}
              </button>
            </div>
            {readinessListVisible ? (
            <div className="mt-3 grid gap-3" data-testid="admin-settings-readiness-list" id="admin-settings-readiness-list">
              {pilotChecks.map((check) => {
                const draft = getDraft(check);
                const StatusIcon = draft.status === "verified" ? CheckCircle2 : draft.status === "blocked" ? AlertTriangle : Clock3;

                return (
                  <article className="rounded-md border border-zinc-200 bg-white p-3" data-testid="admin-settings-readiness-item" key={check.id}>
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="rounded-md border border-zinc-200 bg-zinc-50 px-2 py-1 text-xs font-semibold text-zinc-600">
                            {pilotCategoryLabels[check.category]}
                          </span>
                          <span className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs font-semibold ${pilotStatusStyles[draft.status]}`}>
                            <StatusIcon className="h-3.5 w-3.5" aria-hidden />
                            {pilotStatusLabels[draft.status]}
                          </span>
                        </div>
	                        <p className="mt-2 text-sm font-semibold leading-6 text-zinc-950">{formatAdminPilotCheckLabel(check.label)}</p>
                        {check.checkedAt ? (
                          <p className="mt-1 text-xs leading-5 text-zinc-500">
                            마지막 확인 {new Date(check.checkedAt).toLocaleString("ko-KR")}
                          </p>
                        ) : null}
                      </div>
                    </div>

                    {readinessEditorOpen ? (
                      <div className="mt-3 grid gap-2" data-testid="admin-settings-readiness-editor-list">
                        <label className="grid gap-1 text-xs font-semibold text-zinc-600">
                          상태
                          <select
                            className="min-h-11 rounded-md border border-zinc-300 bg-white px-3 text-sm text-zinc-950"
                            value={draft.status}
                            onChange={(event) => updateDraft(check, { status: event.target.value as PilotReadinessStatus })}
                          >
                            <option value="pending">대기</option>
                            <option value="verified">확인</option>
                            <option value="blocked">확인 필요</option>
                          </select>
                        </label>
                        <label className="grid gap-1 text-xs font-semibold text-zinc-600">
                          담당자
                          <input
                            className="min-h-11 rounded-md border border-zinc-300 px-3 text-sm text-zinc-950"
                            value={draft.owner}
                            onChange={(event) => updateDraft(check, { owner: event.target.value })}
                          />
                        </label>
                        <label className="grid gap-1 text-xs font-semibold text-zinc-600">
                          확인 메모
                          <textarea
                            className="min-h-24 rounded-md border border-zinc-300 px-3 py-2 text-sm leading-6 text-zinc-950"
                            placeholder="확인 일시, 담당자, 기기, 결과를 기록"
                            value={draft.evidence}
                            onChange={(event) => updateDraft(check, { evidence: event.target.value })}
                          />
                        </label>
                        <button
                          className="min-h-11 rounded-md bg-zinc-950 px-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-zinc-300"
                          disabled={savingId === check.id}
                          type="button"
                          onClick={() => void handlePilotCheckSave(check)}
                        >
                          {savingId === check.id ? "저장 중" : "점검 상태 저장"}
                        </button>
                      </div>
                    ) : (
                      <div className="mt-3 grid gap-2" data-testid="admin-settings-readiness-item-summary">
                        <p className="rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs leading-5 text-zinc-600">
                          담당 {draft.owner || "담당자 지정 전"} · {draft.evidence || "확인 메모 전"}
                        </p>
                      </div>
                    )}
                  </article>
                );
              })}
            </div>
            ) : null}
          </div>
        </div>
      </section>

      <section
        className="border-t border-zinc-200 px-1 py-4"
        aria-labelledby="pilot-operation-heading"
        data-operation-tier="secondary"
      >
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div className="flex items-center gap-2">
            <CalendarCheck className="h-4 w-4 text-teal-700" aria-hidden />
            <h2 id="pilot-operation-heading" className="text-base font-semibold text-zinc-950">
              운영 확인
            </h2>
          </div>
          <p
            className="text-xs font-semibold leading-5 text-zinc-600"
            data-testid="admin-settings-operation-header-summary"
          >
            확인 {operationSummary.verifiedDays}/14일 · 대기 {operationSummary.pending}건 · 확인 필요 {operationSummary.blocked}건
          </p>
        </div>

        <div className="mt-3 grid gap-2" data-testid="admin-settings-operation-compact-summary">
          <p className="rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs font-semibold leading-5 text-zinc-700">
            다음 확인 {operationCoverage.nextRecommendedDate.slice(5)} · 누락 {operationCoverage.missingDates.length}일 · 모바일 확인{" "}
            {operationCoverage.mobileEvidenceMissingLogs.length}건
          </p>
          <button
            aria-controls="admin-settings-operation-detail"
            aria-expanded={operationDetailOpen}
            className="min-h-11 rounded-md border border-zinc-300 bg-white px-3 text-sm font-semibold text-zinc-900"
            data-testid="admin-settings-operation-detail-toggle"
            type="button"
            onClick={() => setOperationDetailOpen((current) => !current)}
          >
            {operationDetailOpen ? "운영 상세 닫기" : "운영 상세 보기"}
          </button>
        </div>

        {operationDetailOpen ? (
        <div className="mt-4 grid gap-3 lg:grid-cols-[0.9fr_1.1fr]" data-testid="admin-settings-operation-detail" id="admin-settings-operation-detail">
          <div className="rounded-md border border-teal-200 bg-teal-50 p-3">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <h3 className="text-sm font-semibold text-zinc-950">운영일 누락 점검</h3>
                <p className="mt-1 text-sm leading-6 text-teal-800">
                  운영 점검 기준은 같은 날 여러 번 입력한 기록이 아니라 실제 확인된 운영일 {pilotOperationRequiredDays}일입니다.
                </p>
              </div>
              <span className="inline-flex w-fit rounded-md border border-teal-300 bg-white px-2 py-1 text-xs font-semibold tabular-nums text-teal-800">
                확인 운영일 {operationCoverage.verifiedDates.length}/{pilotOperationRequiredDays}
              </span>
            </div>
            <div className="mt-3 grid gap-2 text-sm leading-6 text-zinc-700">
              <p>
                다음 입력 추천일:{" "}
                <span className="font-semibold tabular-nums text-zinc-950">{operationCoverage.nextRecommendedDate}</span>
              </p>
              <p>
                누락 운영일:{" "}
                <span className="font-semibold text-zinc-950">
                  {operationCoverage.missingDates.length > 0
                    ? operationCoverage.missingDates.slice(0, 5).join(", ")
                    : "누락 없음"}
                </span>
                {operationCoverage.missingDates.length > 5 ? ` 외 ${operationCoverage.missingDates.length - 5}일` : ""}
              </p>
            </div>
            <button
              className="mt-3 min-h-11 rounded-md bg-teal-700 px-3 text-sm font-semibold text-white"
              type="button"
              onClick={() => updateOperationDraft({ date: operationCoverage.nextRecommendedDate })}
            >
              추천일로 입력
            </button>
          </div>

          <div className="rounded-md border border-amber-200 bg-amber-50 p-3">
            <h3 className="text-sm font-semibold text-zinc-950">모바일 출석 확인 누락</h3>
            <p className="mt-1 text-sm leading-6 text-amber-800">
              출석 기록이 있는 확인 기록은 30초 이하 처리 시간과 확인 메모가 있어야 최종 운영 점검을 통과합니다.
            </p>
            <div className="mt-3 flex flex-wrap gap-2 text-xs font-semibold">
              <span className="rounded-md border border-amber-300 bg-white px-2 py-1 text-amber-800">
                누락 {operationCoverage.mobileEvidenceMissingLogs.length}건
              </span>
              <span className="rounded-md border border-zinc-200 bg-white px-2 py-1 text-zinc-700">
                상태 {operationCoverage.complete ? "정상" : "확인 필요"}
              </span>
            </div>
            {operationCoverage.mobileEvidenceMissingLogs.length > 0 ? (
              <ul className="mt-3 grid gap-2 text-sm leading-6 text-zinc-700">
                {operationCoverage.mobileEvidenceMissingLogs.slice(0, 3).map((log) => (
                  <li className="rounded-md border border-amber-200 bg-white px-3 py-2" key={log.id}>
                    <span className="font-semibold tabular-nums text-zinc-950">{log.date}</span> · 출석 {log.attendanceRecords}건 ·{" "}
                    {log.mobileAttendanceDurationSeconds ? `${log.mobileAttendanceDurationSeconds}초` : "처리 시간 기록 전"}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-3 rounded-md border border-emerald-200 bg-white px-3 py-2 text-sm leading-6 text-emerald-800">
                현재 기록된 출석 운영일은 모바일 출석 확인 기록을 갖고 있습니다.
              </p>
            )}
          </div>
        </div>
        ) : null}

        <div className="mt-4 grid gap-4 xl:grid-cols-[0.9fr_1.1fr]">
          <div className="min-w-0 rounded-md border border-zinc-200 bg-zinc-50 p-3">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <h3 className="text-sm font-semibold text-zinc-950">일일 운영 확인 저장</h3>
              <button
                aria-controls="admin-settings-operation-log-form"
                aria-expanded={operationEditorOpen}
                className="min-h-11 rounded-md border border-zinc-300 bg-white px-3 text-sm font-semibold text-zinc-900"
                data-testid="admin-settings-operation-log-toggle"
                type="button"
                onClick={() => setOperationEditorOpen((current) => !current)}
              >
                {operationEditorOpen ? "입력 닫기" : "운영 기록 입력"}
              </button>
            </div>
            {operationEditorOpen ? (
              <div className="mt-3 grid gap-3" data-testid="admin-settings-operation-log-form" id="admin-settings-operation-log-form">
              <div className="grid gap-3 sm:grid-cols-3">
                <label className="grid gap-1 text-xs font-semibold text-zinc-600">
                  운영 일자
                  <input
                    className="min-h-11 rounded-md border border-zinc-300 bg-white px-3 text-sm text-zinc-950"
                    type="date"
                    value={operationDraft.date}
                    onChange={(event) => updateOperationDraft({ date: event.target.value })}
                  />
                </label>
                <label className="grid gap-1 text-xs font-semibold text-zinc-600">
                  지점
                  <select
                    className="min-h-11 rounded-md border border-zinc-300 bg-white px-3 text-sm text-zinc-950"
                    value={operationDraft.branchId}
                    onChange={(event) => updateOperationDraft({ branchId: event.target.value })}
                  >
                    <option value="">전체 지점</option>
                    {context.db.branches.map((branch) => (
                      <option key={branch.id} value={branch.id}>
                        {branch.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="grid gap-1 text-xs font-semibold text-zinc-600">
                  상태
                  <select
                    className="min-h-11 rounded-md border border-zinc-300 bg-white px-3 text-sm text-zinc-950"
                    value={operationDraft.status}
                    onChange={(event) => updateOperationDraft({ status: event.target.value as PilotReadinessStatus })}
                  >
                    <option value="pending">대기</option>
                    <option value="verified">확인</option>
                    <option value="blocked">확인 필요</option>
                  </select>
                </label>
              </div>

              <label className="grid gap-1 text-xs font-semibold text-zinc-600">
                담당자
                <input
                  className="min-h-11 rounded-md border border-zinc-300 bg-white px-3 text-sm text-zinc-950"
                  value={operationDraft.owner}
                  onChange={(event) => updateOperationDraft({ owner: event.target.value })}
                />
              </label>

              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                {[
                  ["classesChecked", "수업 확인"],
                  ["attendanceRecords", "출석 기록"],
                  ["paymentChecks", "결제 확인"],
                  ["noticeFollowupChecks", "공지 후속"],
                  ["noticeChecks", "공지 확인"],
                ].map(([key, label]) => (
                  <label className="grid gap-1 text-xs font-semibold text-zinc-600" key={key}>
                    {label}
                    <input
                      className="min-h-11 rounded-md border border-zinc-300 bg-white px-3 text-sm tabular-nums text-zinc-950"
                      min={0}
                      type="number"
                      value={operationDraft[key as keyof PilotOperationLogDraft] as number}
                      onChange={(event) => updateOperationDraft({ [key]: Number(event.target.value || 0) } as Partial<PilotOperationLogDraft>)}
                    />
                  </label>
                ))}
              </div>

              <div className="grid gap-3 sm:grid-cols-[minmax(0,160px)_1fr]">
                <label className="grid gap-1 text-xs font-semibold text-zinc-600">
                  모바일 출석 시간
                  <input
                    className="min-h-11 rounded-md border border-zinc-300 bg-white px-3 text-sm tabular-nums text-zinc-950"
                    min={0}
                    step={1}
                    type="number"
                    value={operationDraft.mobileAttendanceDurationSeconds}
                    onChange={(event) => updateOperationDraft({ mobileAttendanceDurationSeconds: Number(event.target.value || 0) })}
                  />
                </label>
                <label className="grid gap-1 text-xs font-semibold text-zinc-600">
                  모바일 출석 확인 기록
                  <input
                    className="min-h-11 rounded-md border border-zinc-300 bg-white px-3 text-sm text-zinc-950"
                    placeholder="현장 확인 내용"
                    value={operationDraft.mobileAttendanceEvidence}
                    onChange={(event) => updateOperationDraft({ mobileAttendanceEvidence: event.target.value })}
                  />
                </label>
              </div>

              <label className="grid gap-1 text-xs font-semibold text-zinc-600">
                확인 메모
                <textarea
                  className="min-h-24 rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm leading-6 text-zinc-950"
                  placeholder="수업 확인, 출석 저장, 결제 상태 점검 내용을 기록"
                  value={operationDraft.evidence}
                  onChange={(event) => updateOperationDraft({ evidence: event.target.value })}
                />
              </label>
              <label className="grid gap-1 text-xs font-semibold text-zinc-600">
                확인 필요/특이사항
                <textarea
                  className="min-h-20 rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm leading-6 text-zinc-950"
                  placeholder="확인할 사유와 후속 조치를 기록"
                  value={operationDraft.blockerSummary}
                  onChange={(event) => updateOperationDraft({ blockerSummary: event.target.value })}
                />
              </label>
              <button
                className="min-h-11 rounded-md bg-zinc-950 px-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-zinc-300"
                disabled={
                  operationSaving ||
                  !operationDraft.date ||
                  !operationDraft.owner.trim() ||
                  (operationDraft.status !== "pending" && !operationDraft.evidence.trim()) ||
                  (operationDraft.status === "blocked" && operationDraft.blockerSummary.trim().length < 5) ||
                  (operationDraft.status === "verified" && operationActivityCount === 0) ||
                  (operationDraft.status === "verified" &&
                    operationDraft.attendanceRecords > 0 &&
                    (operationDraft.mobileAttendanceDurationSeconds <= 0 ||
                      operationDraft.mobileAttendanceDurationSeconds > 30 ||
                      operationDraft.mobileAttendanceEvidence.trim().length < 5))
                }
                type="button"
                onClick={() => void handlePilotOperationSave()}
              >
                {operationSaving ? "저장 중" : "운영 기록 저장"}
              </button>
              </div>
            ) : (
              <div
                className="mt-3 flex min-h-11 items-center rounded-md border border-zinc-200 bg-white px-3 py-2 text-xs leading-5 text-zinc-600"
                data-testid="admin-settings-operation-log-summary"
              >
                <p>
                  추천 {operationCoverage.nextRecommendedDate.slice(5)} · 운영일 {operationCoverage.verifiedDates.length}/
                  {pilotOperationRequiredDays}
                </p>
              </div>
            )}
          </div>

          {operationDetailOpen ? (
          <div className="min-w-0" data-testid="admin-settings-operation-record-list">
            <h3 className="text-sm font-semibold text-zinc-950">일일 운영 기록</h3>
            <div className="mt-3 grid gap-3">
              {pilotOperationLogs.length === 0 ? (
                <p className="rounded-md border border-zinc-200 bg-zinc-50 px-3 py-4 text-sm leading-6 text-zinc-600">
                  아직 운영 기록이 없습니다.
                </p>
              ) : (
                pilotOperationLogs.map((log: PilotOperationLog) => {
                  const branch = log.branchId ? context.db.branches.find((candidate) => candidate.id === log.branchId) : null;

                  return (
                    <article className="rounded-md border border-zinc-200 bg-white p-3" key={log.id}>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={`rounded-md border px-2 py-1 text-xs font-semibold ${pilotStatusStyles[log.status]}`}>
                          {pilotStatusLabels[log.status]}
                        </span>
                        <span className="rounded-md border border-zinc-200 bg-zinc-50 px-2 py-1 text-xs font-semibold text-zinc-600">
                          {branch?.name ?? "전체 지점"}
                        </span>
                        <span className="rounded-md border border-zinc-200 bg-white px-2 py-1 text-xs font-semibold tabular-nums text-zinc-700">
                          {log.date}
                        </span>
                      </div>
                      <p className="mt-3 text-sm font-semibold leading-6 text-zinc-950">{log.owner}</p>
                      <p className="mt-1 text-xs leading-5 text-zinc-500">
                        수업 {log.classesChecked} · 출석 {log.attendanceRecords} · 결제 {log.paymentChecks} · 공지 후속{" "}
                        {log.noticeFollowupChecks} · 공지 {log.noticeChecks}
                      </p>
                      {log.mobileAttendanceDurationSeconds ? (
                        <p className="mt-1 text-xs leading-5 text-zinc-500">
                          모바일 출석 {log.mobileAttendanceDurationSeconds}초 · {log.mobileAttendanceEvidence ?? "확인 기록 전"}
                        </p>
                      ) : null}
                      <p className="mt-2 text-sm leading-6 text-zinc-600">{log.evidence || "확인 메모 전"}</p>
                      {log.blockerSummary ? (
                        <p className="mt-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm leading-6 text-amber-800">
                          {log.blockerSummary}
                        </p>
                      ) : null}
                    </article>
                  );
                })
              )}
            </div>
          </div>
          ) : null}
        </div>
      </section>

      <section
        className="border-t border-zinc-200 px-1 py-4"
        aria-labelledby="pilot-incident-heading"
        data-operation-tier="secondary"
      >
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-red-700" aria-hidden />
            <h2 id="pilot-incident-heading" className="text-base font-semibold text-zinc-950">
              운영 이슈
            </h2>
          </div>
          <p className="text-xs font-semibold leading-5 text-zinc-600" data-testid="admin-settings-incident-header-summary">
            긴급 {incidentSummary.p0}건 · 열림 {incidentSummary.open}건 · 모니터링 {incidentSummary.monitoring}건
          </p>
        </div>

        <div className="mt-3 grid gap-3 xl:grid-cols-[0.9fr_1.1fr]">
          <div className="min-w-0 rounded-md border border-zinc-200 bg-zinc-50 p-3">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <h3 className="text-sm font-semibold text-zinc-950">새 이슈 기록</h3>
              <button
                aria-controls="admin-settings-incident-create-form"
                aria-expanded={incidentCreateOpen}
                className="min-h-11 rounded-md border border-zinc-300 bg-white px-3 text-sm font-semibold text-zinc-900"
                data-testid="admin-settings-incident-create-toggle"
                type="button"
                onClick={() => setIncidentCreateOpen((current) => !current)}
              >
                {incidentCreateOpen ? "기록 닫기" : "이슈 기록"}
              </button>
            </div>
            {incidentCreateOpen ? (
              <div className="mt-3 grid gap-3" data-testid="admin-settings-incident-create-form" id="admin-settings-incident-create-form">
              <label className="grid gap-1 text-xs font-semibold text-zinc-600">
                제목
                <input
                  className="min-h-11 rounded-md border border-zinc-300 bg-white px-3 text-sm text-zinc-950"
                  placeholder="이슈 제목 입력"
                  value={incidentDraft.title}
                  onChange={(event) => updateIncidentDraft({ title: event.target.value })}
                />
              </label>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="grid gap-1 text-xs font-semibold text-zinc-600">
                  심각도
                  <select
                    className="min-h-11 rounded-md border border-zinc-300 bg-white px-3 text-sm text-zinc-950"
                    value={incidentDraft.severity}
                    onChange={(event) => updateIncidentDraft({ severity: event.target.value as PilotIncidentSeverity })}
                  >
                    <option value="p0">긴급 운영 중단</option>
                    <option value="p1">당일 수정</option>
                    <option value="p2">개선 후보</option>
                  </select>
                </label>
                <label className="grid gap-1 text-xs font-semibold text-zinc-600">
                  지점
                  <select
                    className="min-h-11 rounded-md border border-zinc-300 bg-white px-3 text-sm text-zinc-950"
                    value={incidentDraft.branchId}
                    onChange={(event) => updateIncidentDraft({ branchId: event.target.value })}
                  >
                    <option value="">전체 지점</option>
                    {context.db.branches.map((branch) => (
                      <option key={branch.id} value={branch.id}>
                        {branch.name}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="grid gap-1 text-xs font-semibold text-zinc-600">
                  역할
                  <select
                    className="min-h-11 rounded-md border border-zinc-300 bg-white px-3 text-sm text-zinc-950"
                    value={incidentDraft.role}
                    onChange={(event) => updateIncidentDraft({ role: event.target.value as UserRole | "unknown" })}
                  >
                    <option value="unknown">역할 선택 전</option>
                    {userRoles.map((role) => (
                      <option key={role} value={role}>
                        {roleLabels[role]}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="grid gap-1 text-xs font-semibold text-zinc-600">
                  화면
                  <input
                    className="min-h-11 rounded-md border border-zinc-300 bg-white px-3 text-sm text-zinc-950"
                    placeholder="관련 화면"
                    value={incidentDraft.screen}
                    onChange={(event) => updateIncidentDraft({ screen: event.target.value })}
                  />
                </label>
              </div>
              <label className="grid gap-1 text-xs font-semibold text-zinc-600">
                담당자
                <input
                  className="min-h-11 rounded-md border border-zinc-300 bg-white px-3 text-sm text-zinc-950"
                  value={incidentDraft.owner}
                  onChange={(event) => updateIncidentDraft({ owner: event.target.value })}
                />
              </label>
              <label className="grid gap-1 text-xs font-semibold text-zinc-600">
                상세/재현 절차
                <textarea
                  className="min-h-24 rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm leading-6 text-zinc-950"
                  placeholder="발생 시간, 상황, 기대한 상태, 실제 상태를 기록"
                  value={incidentDraft.description}
                  onChange={(event) => updateIncidentDraft({ description: event.target.value })}
                />
              </label>
              <label className="grid gap-1 text-xs font-semibold text-zinc-600">
                현장 조치 메모
                <textarea
                  className="min-h-20 rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm leading-6 text-zinc-950"
                  placeholder="현장 조치와 후속 확인 내용을 기록"
                  value={incidentDraft.workaround}
                  onChange={(event) => updateIncidentDraft({ workaround: event.target.value })}
                />
              </label>
              <button
                className="min-h-11 rounded-md bg-zinc-950 px-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-zinc-300"
                disabled={
                  incidentSavingId === "create" ||
                  !incidentDraft.title.trim() ||
                  !incidentDraft.description.trim() ||
                  !incidentDraft.owner.trim()
                }
                type="button"
                onClick={() => void handlePilotIncidentCreate()}
              >
                {incidentSavingId === "create" ? "기록 중" : "이슈 기록"}
              </button>
              </div>
            ) : (
              <div
                className="mt-3 flex min-h-11 items-center rounded-md border border-zinc-200 bg-white px-3 py-2 text-xs leading-5 text-zinc-600"
                data-testid="admin-settings-incident-create-summary"
              >
                <p>새 이슈는 기록 버튼에서 추가</p>
              </div>
            )}
          </div>

          <div className="min-w-0">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <h3 className="text-sm font-semibold text-zinc-950">운영 중 이슈</h3>
              <button
                aria-controls="admin-settings-incident-list"
                aria-expanded={incidentListOpen}
                className="min-h-11 rounded-md border border-zinc-300 bg-white px-3 text-sm font-semibold text-zinc-900"
                data-testid="admin-settings-incident-list-toggle"
                type="button"
                onClick={() => setIncidentListOpen((current) => !current)}
              >
                {incidentListOpen ? "이슈 목록 닫기" : "이슈 목록 보기"}
              </button>
            </div>
            {incidentListOpen ? (
            <div className="mt-3 grid gap-3">
              {pilotIncidents.length === 0 ? (
                <p className="rounded-md border border-zinc-200 bg-zinc-50 px-3 py-4 text-sm leading-6 text-zinc-600">
                  아직 기록된 운영 이슈가 없습니다.
                </p>
              ) : (
                pilotIncidents.map((incident) => {
                  const draft = getIncidentUpdateDraft(incident);
                  const branch = incident.branchId ? context.db.branches.find((candidate) => candidate.id === incident.branchId) : null;
                  const incidentEditorOpen = incidentEditorId === incident.id;

                  return (
                    <article className="rounded-md border border-zinc-200 bg-white p-3" key={incident.id}>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={`rounded-md border px-2 py-1 text-xs font-semibold ${incidentSeverityStyles[incident.severity]}`}>
                          {incidentSeverityLabels[incident.severity]}
                        </span>
                        <span className={`rounded-md border px-2 py-1 text-xs font-semibold ${incidentStatusStyles[draft.status]}`}>
                          {incidentStatusLabels[draft.status]}
                        </span>
                        <span className="rounded-md border border-zinc-200 bg-zinc-50 px-2 py-1 text-xs font-semibold text-zinc-600">
                          {branch?.name ?? "전체 지점"}
                        </span>
                      </div>
                      <p className="mt-3 text-sm font-semibold leading-6 text-zinc-950">{incident.title}</p>
                      <p className="mt-1 text-xs leading-5 text-zinc-500">
                        {roleLabels[incident.role as UserRole] ?? "역할 확인 중"} · {incident.screen || "화면 확인 중"} ·{" "}
                        {new Date(incident.createdAt).toLocaleString("ko-KR")}
                      </p>
                      <p className="mt-2 text-sm leading-6 text-zinc-600">{incident.description}</p>
                      <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                        <p className="text-xs leading-5 text-zinc-500">담당 {draft.owner || "담당자 지정 전"}</p>
                        <button
                          aria-controls={`admin-settings-incident-editor-${incident.id}`}
                          aria-expanded={incidentEditorOpen}
                          className="min-h-11 rounded-md border border-zinc-300 bg-white px-3 text-sm font-semibold text-zinc-900"
                          data-testid="admin-settings-incident-editor-toggle"
                          type="button"
                          onClick={() => setIncidentEditorId((current) => (current === incident.id ? null : incident.id))}
                        >
                          {incidentEditorOpen ? "수정 닫기" : "상태 수정"}
                        </button>
                      </div>
                      {incidentEditorOpen ? (
                        <div className="mt-3 grid gap-2" data-testid="admin-settings-incident-editor-form" id={`admin-settings-incident-editor-${incident.id}`}>
                          <label className="grid gap-1 text-xs font-semibold text-zinc-600">
                            상태
                            <select
                              className="min-h-11 rounded-md border border-zinc-300 bg-white px-3 text-sm text-zinc-950"
                              value={draft.status}
                              onChange={(event) => updateIncidentUpdateDraft(incident, { status: event.target.value as PilotIncidentStatus })}
                            >
                              <option value="open">열림</option>
                              <option value="monitoring">모니터링</option>
                              <option value="resolved">해결</option>
                            </select>
                          </label>
                          <label className="grid gap-1 text-xs font-semibold text-zinc-600">
                            담당자
                            <input
                              className="min-h-11 rounded-md border border-zinc-300 px-3 text-sm text-zinc-950"
                              value={draft.owner}
                              onChange={(event) => updateIncidentUpdateDraft(incident, { owner: event.target.value })}
                            />
                          </label>
                          <label className="grid gap-1 text-xs font-semibold text-zinc-600">
                            우회책/조치 메모
                            <textarea
                              className="min-h-20 rounded-md border border-zinc-300 px-3 py-2 text-sm leading-6 text-zinc-950"
                              value={draft.workaround}
                              onChange={(event) => updateIncidentUpdateDraft(incident, { workaround: event.target.value })}
                            />
                          </label>
                          <button
                            className="min-h-11 rounded-md border border-zinc-300 bg-white px-3 text-sm font-semibold text-zinc-900 disabled:cursor-not-allowed disabled:bg-zinc-100 disabled:text-zinc-400"
                            disabled={incidentSavingId === incident.id}
                            type="button"
                            onClick={() => void handlePilotIncidentUpdate(incident)}
                          >
                            {incidentSavingId === incident.id ? "저장 중" : "이슈 상태 저장"}
                          </button>
                        </div>
                      ) : null}
                    </article>
                  );
                })
              )}
            </div>
            ) : (
              <p className="mt-3 rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm leading-6 text-zinc-600" data-testid="admin-settings-incident-list-summary">
                열린 이슈 {incidentSummary.open}건 · 모니터링 {incidentSummary.monitoring}건 · 해결 {incidentSummary.resolved}/{incidentSummary.total}
              </p>
            )}
          </div>
        </div>
      </section>
      </div>
      ) : null}
    </div>
  );
}
