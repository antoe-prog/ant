"use client";

import { type FormEvent, useMemo, useState } from "react";
import { AlertTriangle, CalendarPlus, CheckCheck, ChevronDown, ChevronUp, ClipboardList, RefreshCw, Save, Search, Undo2, X } from "lucide-react";
import type {
  AttendanceRecord,
  AttendanceStatus,
  ClassSession,
  CounselingNote,
  EnrichedClassSession,
  Member,
  SaveStatus,
} from "@/lib/domain";
import { useApiContext } from "@/hooks/use-api-context";
import { useResource } from "@/hooks/use-resource";
import { apiClient } from "@/lib/api-client";
import { formatCompactTimeRange, formatDate, formatDateTime } from "@/lib/format";
import { attendanceStatusLabels } from "@/lib/roles";
import { useAppStore } from "@/store/app-store";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/state-blocks";
import { AttendanceStatusBadge, AttendanceStatusButton, Button, SectionHeader } from "@/components/ui/primitives";

const attendanceOptions: AttendanceStatus[] = ["present", "late", "absent", "excused"];
const attendanceSummaryLabels: Array<{ status: AttendanceStatus; label: string }> = [
  { status: "present", label: "출석" },
  { status: "late", label: "지각" },
  { status: "absent", label: "결석" },
  { status: "excused", label: "사유" },
];
type AttendanceStatusFilter = "all" | AttendanceStatus;
const attendanceNotePresets = [
  { id: "late-arrival", label: "늦게 도착" },
  { id: "guardian-contact", label: "보호자 연락" },
  { id: "condition-check", label: "컨디션 확인" },
];
const coachReasonRequiredStatuses: AttendanceStatus[] = ["late", "absent", "excused"];
const ageGroupOptions: Array<{ value: Member["ageGroup"]; label: string }> = [
  { value: "kids", label: "유소년" },
  { value: "teen", label: "청소년" },
  { value: "adult", label: "성인" },
];

type AttendanceUndoSnapshot = {
  sessionId: string;
  memberId: string;
  sessionName: string;
  memberName: string;
  previousStatus: AttendanceStatus;
  nextStatus: AttendanceStatus;
  changedAt: string;
};

function toDatetimeLocalValue(date: Date) {
  const localDate = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);

  return localDate.toISOString().slice(0, 16);
}

function createInitialStartAt() {
  const date = new Date();
  date.setHours(18, 0, 0, 0);

  return toDatetimeLocalValue(date);
}

function addMinutes(value: string, minutes: number) {
  if (!value) {
    return "";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  date.setMinutes(date.getMinutes() + minutes);

  return toDatetimeLocalValue(date);
}

function getAttendanceRecord(session: EnrichedClassSession, memberId: string): AttendanceRecord | undefined {
  return session.attendance.find((record) => record.memberId === memberId);
}

function getAttendanceProgress(session: EnrichedClassSession) {
  const enrolledCount = session.enrolledMemberIds.length;
  const checkedCount = session.enrolledMemberIds.filter((memberId) => Boolean(getAttendanceRecord(session, memberId))).length;
  const uncheckedCount = Math.max(enrolledCount - checkedCount, 0);
  const checkedPercent = enrolledCount > 0 ? Math.round((checkedCount / enrolledCount) * 100) : 0;

  return { checkedCount, checkedPercent, enrolledCount, uncheckedCount };
}

function getAttendanceNoteKey(sessionId: string, memberId: string) {
  return `${sessionId}:${memberId}`;
}

function needsAttendanceReason(record: AttendanceRecord | undefined) {
  return Boolean(record && coachReasonRequiredStatuses.includes(record.status) && !record.note?.trim());
}

function applyAttendanceNotePresetValue(currentValue: string, preset: string) {
  const cleanValue = currentValue.trim();

  if (!cleanValue) {
    return preset;
  }

  if (cleanValue.includes(preset)) {
    return cleanValue;
  }

  return `${cleanValue} · ${preset}`.slice(0, 80);
}

function normalizeAttendanceSearch(value: string) {
  return value.trim().toLocaleLowerCase("ko-KR");
}

function memberMatchesAttendanceSearch(member: Member, searchTerm: string) {
  if (!searchTerm) {
    return true;
  }

  return [member.name, member.belt, member.level, ...member.alerts]
    .map((value) => value.toLocaleLowerCase("ko-KR"))
    .some((value) => value.includes(searchTerm));
}

function getVisibleAttendanceMembers(
  session: EnrichedClassSession,
  showUncheckedOnly: boolean,
  showReasonRequiredOnly: boolean,
  searchTerm: string,
  statusFilter: AttendanceStatusFilter,
) {
  return session.enrolledMembers.filter((member) => {
    const attendanceRecord = getAttendanceRecord(session, member.id);

    if (showUncheckedOnly && attendanceRecord) {
      return false;
    }

    if (showReasonRequiredOnly && !needsAttendanceReason(attendanceRecord)) {
      return false;
    }

    if (statusFilter !== "all" && attendanceRecord?.status !== statusFilter) {
      return false;
    }

    return memberMatchesAttendanceSearch(member, searchTerm);
  });
}

function isCoachVisibleCounselingNote(note: CounselingNote) {
  return note.visibility === "coach_visible";
}

const syncStatusLabels: Record<SaveStatus, string> = {
  idle: "정상",
  saving: "저장 중",
  saved: "저장됨",
  offline: "저장 대기",
  failed: "저장 실패",
  conflict: "충돌",
};

const syncStatusClasses: Record<SaveStatus, string> = {
  idle: "border-zinc-200 bg-zinc-50 text-zinc-600",
  saving: "border-blue-200 bg-blue-50 text-blue-700",
  saved: "border-emerald-200 bg-emerald-50 text-emerald-700",
  offline: "border-amber-200 bg-amber-50 text-amber-700",
  failed: "border-red-200 bg-red-50 text-red-700",
  conflict: "border-red-200 bg-red-50 text-red-700",
};

function coachQuickActionClass(active: boolean, tone: "amber" | "teal" = "teal") {
  const activeClass =
    tone === "amber"
      ? "border-amber-700 bg-amber-700 text-white hover:border-amber-800 hover:bg-amber-800"
      : "border-teal-700 bg-teal-700 text-white hover:border-teal-800 hover:bg-teal-800";

  return `inline-flex min-h-11 w-full min-w-0 items-center justify-center gap-1 rounded-md border px-1 text-[11px] font-semibold transition disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto sm:gap-2 sm:px-3 sm:text-sm ${
    active ? activeClass : "border-zinc-200 bg-white text-zinc-700 hover:border-zinc-300 hover:bg-zinc-50"
  }`;
}

export function ClassesScreen() {
  const context = useApiContext();
  const { attendanceSync, createClassSession, markAttendance, markSessionAttendance, saveAttendanceReason, syncPendingAttendance, updateClassSession } = useAppStore();
  const [reasonSavingKey, setReasonSavingKey] = useState<string | null>(null);
  const [reasonSavedKey, setReasonSavedKey] = useState<string | null>(null);
  const canEditAttendance = ["coach", "owner", "admin"].includes(context.user.role);
  const canManageClasses = context.user.role === "owner" || context.user.role === "admin";
  const isFamilyRole = context.user.role === "member" || context.user.role === "guardian";
  const showClassesScreenHeader = context.user.role !== "member" && context.user.role !== "guardian";
  const [newClassBranchId, setNewClassBranchId] = useState("");
  const [newClassName, setNewClassName] = useState("");
  const [newClassAgeGroup, setNewClassAgeGroup] = useState<Member["ageGroup"]>("kids");
  const [newClassLevel, setNewClassLevel] = useState("입문-초급");
  const [newClassCoachId, setNewClassCoachId] = useState("");
  const [newClassStartsAt, setNewClassStartsAt] = useState(createInitialStartAt);
  const [newClassEndsAt, setNewClassEndsAt] = useState(() => addMinutes(createInitialStartAt(), 50));
  const [newClassRoom, setNewClassRoom] = useState("매트 A");
  const [newClassCapacity, setNewClassCapacity] = useState("12");
  const [newClassMemberIds, setNewClassMemberIds] = useState<string[]>([]);
  const [classCreateFormOpen, setClassCreateFormOpen] = useState(false);
  const [classEdits, setClassEdits] = useState<Record<string, { room: string; capacity: string }>>({});
  const [attendanceNotes, setAttendanceNotes] = useState<Record<string, string>>({});
  const [attendanceNoteEditorOpenByKey, setAttendanceNoteEditorOpenByKey] = useState<Record<string, boolean>>({});
  const [showUncheckedOnly, setShowUncheckedOnly] = useState(false);
  const [showReasonRequiredOnly, setShowReasonRequiredOnly] = useState(false);
  const [attendanceSearch, setAttendanceSearch] = useState("");
  const [attendanceSearchOpen, setAttendanceSearchOpen] = useState(false);
  const [attendanceStatusFilter, setAttendanceStatusFilter] = useState<AttendanceStatusFilter>("all");
  const [lastAttendanceChange, setLastAttendanceChange] = useState<AttendanceUndoSnapshot | null>(null);
  const [coachClassRosterOpenById, setCoachClassRosterOpenById] = useState<Record<string, boolean>>({});
  const [coachClassListExpanded, setCoachClassListExpanded] = useState(false);
  const [attendanceHistoryOpen, setAttendanceHistoryOpen] = useState(false);
  const { data, loading, error, reload } = useResource(
    () => apiClient.getClasses(context),
    [context.user.id, context.selectedBranchId, context.version],
  );
  const isCoachRole = context.user.role === "coach";
  const selectedCreateBranchId = newClassBranchId || context.selectedBranchId || context.db.branches[0]?.id || "";
  const branchCoaches = useMemo(
    () =>
      context.db.users.filter(
        (user) => ["coach", "admin"].includes(user.role) && selectedCreateBranchId && user.branchIds.includes(selectedCreateBranchId),
      ),
    [context.db.users, selectedCreateBranchId],
  );
  const selectedCoachId = branchCoaches.some((coach) => coach.id === newClassCoachId)
    ? newClassCoachId
    : branchCoaches[0]?.id ?? "";
  const branchMembers = useMemo(
    () =>
      context.db.members.filter(
        (member) => member.branchId === selectedCreateBranchId && member.status !== "withdrawn",
      ),
    [context.db.members, selectedCreateBranchId],
  );

  function handleCreateClass(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const capacity = Number(newClassCapacity);
    const startsAt = new Date(newClassStartsAt);
    const endsAt = new Date(newClassEndsAt);

    if (
      !selectedCreateBranchId ||
      !selectedCoachId ||
      !newClassName.trim() ||
      !Number.isInteger(capacity) ||
      Number.isNaN(startsAt.getTime()) ||
      Number.isNaN(endsAt.getTime())
    ) {
      return;
    }

    createClassSession(selectedCreateBranchId, {
      name: newClassName.trim(),
      level: newClassLevel.trim() || "입문-초급",
      ageGroup: newClassAgeGroup,
      coachId: selectedCoachId,
      startsAt: startsAt.toISOString(),
      endsAt: endsAt.toISOString(),
      room: newClassRoom.trim() || "매트 A",
      capacity,
      enrolledMemberIds: newClassMemberIds,
    });
    setNewClassName("");
    setNewClassMemberIds([]);
  }

  function toggleNewClassMember(memberId: string) {
    setNewClassMemberIds((current) =>
      current.includes(memberId) ? current.filter((id) => id !== memberId) : [...current, memberId],
    );
  }

  function getClassEdit(session: ClassSession) {
    return classEdits[session.id] ?? { room: session.room, capacity: String(session.capacity) };
  }

  function updateClassEdit(session: ClassSession, key: "room" | "capacity", value: string) {
    setClassEdits((current) => ({
      ...current,
      [session.id]: {
        room: current[session.id]?.room ?? session.room,
        capacity: current[session.id]?.capacity ?? String(session.capacity),
        [key]: value,
      },
    }));
  }

  function handleUpdateClass(event: FormEvent<HTMLFormElement>, session: ClassSession) {
    event.preventDefault();

    const edit = getClassEdit(session);
    const capacity = Number(edit.capacity);

    if (!edit.room.trim() || !Number.isInteger(capacity)) {
      return;
    }

    updateClassSession(session.id, {
      room: edit.room.trim(),
      capacity,
    });
  }

  function applyAttendanceNotePreset(noteKey: string, currentValue: string, preset: string) {
    setAttendanceNotes((current) => ({
      ...current,
      [noteKey]: applyAttendanceNotePresetValue(current[noteKey] ?? currentValue, preset),
    }));
    setAttendanceNoteEditorOpenByKey((current) => ({
      ...current,
      [noteKey]: true,
    }));
  }

  function handleAttendanceSelect(
    session: EnrichedClassSession,
    member: Member,
    previousRecord: AttendanceRecord | undefined,
    nextStatus: AttendanceStatus,
    noteValue: string,
  ) {
    if (previousRecord?.status && previousRecord.status !== nextStatus) {
      setLastAttendanceChange({
        sessionId: session.id,
        memberId: member.id,
        sessionName: session.name,
        memberName: member.name,
        previousStatus: previousRecord.status,
        nextStatus,
        changedAt: new Date().toISOString(),
      });
    }

    markAttendance(session.id, member.id, nextStatus, noteValue);
  }

  // 상태 변경 없이 사유만 저장 (이미 출석 기록이 있는 회원 대상)
  async function handleSaveAttendanceReason(noteKey: string, sessionId: string, memberId: string, reason: string) {
    if (!reason.trim() || reasonSavingKey) {
      return;
    }

    setReasonSavingKey(noteKey);
    setReasonSavedKey(null);

    const ok = await saveAttendanceReason(sessionId, memberId, reason);

    setReasonSavingKey(null);
    setReasonSavedKey(ok ? noteKey : null);
  }

  function handleUndoLastAttendanceChange() {
    if (!lastAttendanceChange || attendanceSyncPending) {
      return;
    }

    markAttendance(lastAttendanceChange.sessionId, lastAttendanceChange.memberId, lastAttendanceChange.previousStatus);
    setLastAttendanceChange(null);
  }

  function toggleCoachClassRoster(sessionId: string, defaultOpen: boolean) {
    setCoachClassRosterOpenById((current) => ({
      ...current,
      [sessionId]: !(current[sessionId] ?? defaultOpen),
    }));
  }

  function setAttendanceNoteEditorOpen(noteKey: string, open: boolean) {
    setAttendanceNoteEditorOpenByKey((current) => ({
      ...current,
      [noteKey]: open,
    }));
  }

  if (loading) {
    return <LoadingState />;
  }

  if (error || !data) {
    return <ErrorState description={error ?? "수업과 출석 명단을 불러오지 못했습니다."} onRetry={reload} />;
  }

  const totalEnrolled = data.reduce((sum, session) => sum + session.enrolledMembers.length, 0);
  const totalChecked = data.reduce((sum, session) => sum + getAttendanceProgress(session).checkedCount, 0);
  const totalUnchecked = Math.max(totalEnrolled - totalChecked, 0);
  const totalCheckedPercent = totalEnrolled > 0 ? Math.round((totalChecked / totalEnrolled) * 100) : 0;
  const attendanceSearchTerm = normalizeAttendanceSearch(attendanceSearch);
  const reasonRequiredCount = data.reduce((sum, session) => sum + session.attendance.filter(needsAttendanceReason).length, 0);
  const filteredRosterCount = data.reduce(
    (sum, session) =>
      sum + getVisibleAttendanceMembers(session, showUncheckedOnly, showReasonRequiredOnly, attendanceSearchTerm, attendanceStatusFilter).length,
    0,
  );
  const hasAttendanceRosterFilter = showUncheckedOnly || showReasonRequiredOnly || Boolean(attendanceSearchTerm) || attendanceStatusFilter !== "all";
  const coachClassMobileVisibleLimit = 1;
  const coachClassListCollapsible = isCoachRole && !hasAttendanceRosterFilter && data.length > coachClassMobileVisibleLimit;
  const hiddenCoachClassCount = coachClassListCollapsible ? data.length - coachClassMobileVisibleLimit : 0;
  const defaultOpenCoachClassId =
    hasAttendanceRosterFilter
      ? data.find((session) => getVisibleAttendanceMembers(session, showUncheckedOnly, showReasonRequiredOnly, attendanceSearchTerm, attendanceStatusFilter).length > 0)?.id ?? null
      : null;
  const attendanceCounts = attendanceSummaryLabels.map(({ status, label }) => ({
    status,
    label,
    count: data.reduce(
      (sum, session) => sum + session.attendance.filter((record) => record.status === status).length,
      0,
    ),
  }));
  const visibleAttendanceStatusFilters = [
    { status: "all" as const, label: "전체", count: totalEnrolled },
    ...attendanceCounts.filter((item) => item.count > 0 || attendanceStatusFilter === item.status),
  ];
  const selectedAttendanceStatusLabel =
    showReasonRequiredOnly ? "사유 필요" : attendanceStatusFilter === "all" ? "전체" : attendanceStatusLabels[attendanceStatusFilter];
  const selectedAttendanceStatusCount =
    showReasonRequiredOnly
      ? reasonRequiredCount
      : attendanceStatusFilter === "all"
      ? totalEnrolled
      : attendanceCounts.find((item) => item.status === attendanceStatusFilter)?.count ?? 0;
  const recentAttendanceAuditLogs = context.db.auditLogs
    .filter((log) => log.targetType === "attendance")
    .filter((log) => !context.selectedBranchId || log.branchId === context.selectedBranchId)
    .slice(0, 3);
  const latestAttendanceAuditLog = recentAttendanceAuditLogs[0] ?? null;
  const attendanceHistoryNeedsAttention = recentAttendanceAuditLogs.some((log) => log.result !== "success");
  const attendanceHistoryDetailsOpen = attendanceHistoryOpen || attendanceHistoryNeedsAttention;
  const latestAttendanceAuditActor = latestAttendanceAuditLog
    ? context.db.users.find((user) => user.id === latestAttendanceAuditLog.actorUserId)
    : null;
  const latestAttendanceAuditResultLabel =
    latestAttendanceAuditLog?.result === "success" ? "완료" : latestAttendanceAuditLog?.result === "blocked" ? "확인 필요" : "실패";
  const hasPendingAttendance = canEditAttendance && attendanceSync.pendingCount > 0;
  const attendanceSyncPending = attendanceSync.status === "saving";
  const shouldShowMobileSaveStatusPanel =
    canEditAttendance && (hasPendingAttendance || attendanceSyncPending || Boolean(lastAttendanceChange));
  const coachVisibleMembers = Array.from(
    new Map(data.flatMap((session) => session.enrolledMembers.map((member) => [member.id, member]))).values(),
  );
  const coachVisibleMemberIds = new Set(coachVisibleMembers.map((member) => member.id));
  const coachAttentionMembers = coachVisibleMembers.filter((member) => member.alerts.length > 0);
  const coachVisibleCounselingNotes = (context.db.counselingNotes ?? []).filter(
    (note) => coachVisibleMemberIds.has(note.memberId) && isCoachVisibleCounselingNote(note),
  );
  const coachCounselingMemberIds = new Set(coachVisibleCounselingNotes.map((note) => note.memberId));
  const coachAttentionMemberCount = new Set([
    ...coachAttentionMembers.map((member) => member.id),
    ...coachVisibleCounselingNotes.map((note) => note.memberId),
  ]).size;
  const coachReasonRequiredRecords = data.flatMap((session) =>
    session.attendance
      .filter((record) => needsAttendanceReason(record))
      .map((record) => ({ record, session, member: session.enrolledMembers.find((member) => member.id === record.memberId) })),
  );
  const firstAttentionMember = coachAttentionMembers[0] ?? coachVisibleMembers.find((member) => coachCounselingMemberIds.has(member.id));
  const coachAttentionFilterActive = Boolean(
    firstAttentionMember &&
      attendanceSearchOpen &&
      attendanceSearchTerm === normalizeAttendanceSearch(firstAttentionMember.name) &&
      !showUncheckedOnly &&
      !showReasonRequiredOnly &&
      attendanceStatusFilter === "all",
  );
  const coachMobileSpeedSummaryText = [
    `사유 필요 ${coachReasonRequiredRecords.length}명`,
    `미처리 ${totalUnchecked}명`,
    `주의 ${coachAttentionMemberCount}명`,
    hasPendingAttendance ? `저장 ${attendanceSync.pendingCount}건 대기` : "저장 정상",
  ].join(" · ");
  const showAttendanceControlMeta =
    hasAttendanceRosterFilter ||
    attendanceStatusFilter !== "all" ||
    attendanceSync.status !== "idle" ||
    attendanceSync.pendingCount > 0 ||
    Boolean(attendanceSync.updatedAt);
  const showAttendanceSearchInput = attendanceSearchOpen || Boolean(attendanceSearch);
  const coachPreClassFlowSummary = [
    `명단 ${totalEnrolled}명`,
    `주의 ${coachAttentionMemberCount}명`,
    "확인",
  ].join(" · ");
  const coachPostClassFlowSummary = [
    `마감 ${totalUnchecked}명`,
    `사유 ${coachReasonRequiredRecords.length}건`,
    hasPendingAttendance ? `저장 ${attendanceSync.pendingCount}건` : "저장 정상",
  ].join(" · ");

  return (
    <div className={`relative ${canEditAttendance ? "pb-36 lg:pb-0" : ""}`}>
      {showClassesScreenHeader ? <SectionHeader title="수업/출석" /> : null}

      {canManageClasses ? (
        <section className="mb-3 rounded-lg border border-zinc-200 bg-white p-3" data-testid="class-create-panel">
          <div className="flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-2">
              <CalendarPlus className="h-4 w-4 shrink-0 text-teal-700" aria-hidden />
              <h2 className="min-w-0 truncate text-base font-semibold text-zinc-950">수업 생성</h2>
            </div>
            <Button
              aria-controls="class-create-form"
              aria-expanded={classCreateFormOpen}
              data-testid="class-create-toggle"
              size="lg"
              type="button"
              variant="secondary"
              onClick={() => setClassCreateFormOpen((open) => !open)}
            >
              {classCreateFormOpen ? "닫기" : "열기"}
            </Button>
          </div>
          {classCreateFormOpen ? (
            <form
              className="mt-3 grid gap-3 lg:grid-cols-[0.9fr_1.2fr_0.8fr_0.8fr_0.8fr_0.8fr]"
              data-testid="class-create-form"
              id="class-create-form"
              onSubmit={handleCreateClass}
            >
              {context.db.branches.length > 1 ? (
                <label>
                  <span className="mb-1 block text-xs font-semibold text-zinc-500">지점</span>
                  <select
                    className="h-11 w-full rounded-md border border-zinc-200 bg-white px-3 text-sm outline-none transition focus:border-teal-500"
                    data-testid="class-create-field"
                    value={selectedCreateBranchId}
                    onChange={(event) => {
                      setNewClassBranchId(event.target.value);
                      setNewClassCoachId("");
                      setNewClassMemberIds([]);
                    }}
                  >
                    {context.db.branches.map((branch) => (
                      <option key={branch.id} value={branch.id}>
                        {branch.name}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
              <label>
                <span className="mb-1 block text-xs font-semibold text-zinc-500">수업명</span>
                <input
                  className="h-11 w-full rounded-md border border-zinc-200 bg-white px-3 text-sm outline-none transition placeholder:text-zinc-400 focus:border-teal-500"
                  data-testid="class-create-field"
                  placeholder="수업명 입력"
                  value={newClassName}
                  onChange={(event) => setNewClassName(event.target.value)}
                />
              </label>
              <label>
                <span className="mb-1 block text-xs font-semibold text-zinc-500">연령</span>
                <select
                  className="h-11 w-full rounded-md border border-zinc-200 bg-white px-3 text-sm outline-none transition focus:border-teal-500"
                  data-testid="class-create-field"
                  value={newClassAgeGroup}
                  onChange={(event) => setNewClassAgeGroup(event.target.value as Member["ageGroup"])}
                >
                  {ageGroupOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span className="mb-1 block text-xs font-semibold text-zinc-500">레벨</span>
                <input
                  className="h-11 w-full rounded-md border border-zinc-200 bg-white px-3 text-sm outline-none transition focus:border-teal-500"
                  data-testid="class-create-field"
                  value={newClassLevel}
                  onChange={(event) => setNewClassLevel(event.target.value)}
                />
              </label>
              <label>
                <span className="mb-1 block text-xs font-semibold text-zinc-500">코치</span>
                <select
                  className="h-11 w-full rounded-md border border-zinc-200 bg-white px-3 text-sm outline-none transition focus:border-teal-500"
                  data-testid="class-create-field"
                  value={selectedCoachId}
                  onChange={(event) => setNewClassCoachId(event.target.value)}
                >
                  {branchCoaches.map((coach) => (
                    <option key={coach.id} value={coach.id}>
                      {coach.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span className="mb-1 block text-xs font-semibold text-zinc-500">정원</span>
                <input
                  className="h-11 w-full rounded-md border border-zinc-200 bg-white px-3 text-sm outline-none transition focus:border-teal-500"
                  data-testid="class-create-field"
                  min={1}
                  max={80}
                  type="number"
                  value={newClassCapacity}
                  onChange={(event) => setNewClassCapacity(event.target.value)}
                />
              </label>
              <label>
                <span className="mb-1 block text-xs font-semibold text-zinc-500">시작</span>
                <input
                  className="h-11 w-full rounded-md border border-zinc-200 bg-white px-3 text-sm outline-none transition focus:border-teal-500"
                  data-testid="class-create-field"
                  type="datetime-local"
                  value={newClassStartsAt}
                  onChange={(event) => {
                    setNewClassStartsAt(event.target.value);
                    setNewClassEndsAt(addMinutes(event.target.value, 50));
                  }}
                />
              </label>
              <label>
                <span className="mb-1 block text-xs font-semibold text-zinc-500">종료</span>
                <input
                  className="h-11 w-full rounded-md border border-zinc-200 bg-white px-3 text-sm outline-none transition focus:border-teal-500"
                  data-testid="class-create-field"
                  type="datetime-local"
                  value={newClassEndsAt}
                  onChange={(event) => setNewClassEndsAt(event.target.value)}
                />
              </label>
              <label>
                <span className="mb-1 block text-xs font-semibold text-zinc-500">장소</span>
                <input
                  className="h-11 w-full rounded-md border border-zinc-200 bg-white px-3 text-sm outline-none transition focus:border-teal-500"
                  data-testid="class-create-field"
                  value={newClassRoom}
                  onChange={(event) => setNewClassRoom(event.target.value)}
                />
              </label>
              <div className="lg:col-span-3">
                <span className="mb-1 block text-xs font-semibold text-zinc-500">등록 회원</span>
                <div className="grid max-h-32 gap-2 overflow-auto rounded-md border border-zinc-200 bg-zinc-50 p-2 sm:grid-cols-2">
                  {branchMembers.length > 0 ? (
                    branchMembers.map((member) => (
                      <label className="flex min-h-11 items-center gap-2 rounded-md bg-white px-2 text-sm text-zinc-700" key={member.id}>
                        <input
                          checked={newClassMemberIds.includes(member.id)}
                          className="h-5 w-5 rounded border-zinc-300 text-teal-600 focus:ring-teal-500"
                          type="checkbox"
                          onChange={() => toggleNewClassMember(member.id)}
                        />
                        <span className="truncate">{member.name}</span>
                      </label>
                    ))
                  ) : (
                    <p className="px-2 py-1 text-sm text-zinc-500">이 지점에 등록 가능한 회원이 없습니다.</p>
                  )}
                </div>
              </div>
              <button
                className="inline-flex h-11 items-center justify-center gap-2 self-end rounded-md bg-zinc-950 px-3 text-sm font-semibold text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-60"
                data-testid="class-create-submit"
                disabled={!selectedCreateBranchId || !selectedCoachId || !newClassName.trim()}
                type="submit"
              >
                생성
              </button>
            </form>
          ) : null}
        </section>
      ) : null}

      {data.length === 0 ? (
        <EmptyState title="예정 수업이 없습니다" />
      ) : (
        <>
          {canEditAttendance ? (
            <section
              aria-label="출석 처리 요약"
              className="mb-2 rounded-lg border border-zinc-200 bg-white p-1.5"
              data-testid="coach-attendance-control-panel"
            >
              <div className="grid gap-1">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0">
                    <h2 className="truncate text-sm font-semibold leading-5 text-zinc-950">
                      출석 처리 {totalChecked}/{totalEnrolled} · 미처리 {totalUnchecked} · {totalCheckedPercent}%
                    </h2>
                  </div>
	                  <span
                      className={`inline-flex shrink-0 rounded-md border px-2 py-1 text-xs font-semibold ${syncStatusClasses[attendanceSync.status]}`}
                      data-attendance-sync-state={attendanceSync.status}
                      data-testid="attendance-sync-status"
                    >
	                    {syncStatusLabels[attendanceSync.status]}
	                  </span>
	                </div>
                <div className="flex min-w-0 items-center gap-1">
	                  <label className="inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-md border border-zinc-200 bg-white px-2 text-xs font-semibold text-zinc-700 sm:gap-2 sm:px-3 sm:text-sm">
		                    <input
		                      checked={showUncheckedOnly}
		                      className="h-7 w-7 rounded border-zinc-300 text-teal-600 focus:ring-teal-500"
		                      data-testid="attendance-unchecked-filter"
		                      type="checkbox"
	                      onChange={(event) => {
                          setShowReasonRequiredOnly(false);
                          setShowUncheckedOnly(event.target.checked);
                        }}
	                    />
	                    <span className="whitespace-nowrap">미처리</span>
	                  </label>
	                  <div
	                    aria-labelledby="attendance-status-filter-label"
	                    className="min-w-0 flex-1"
	                    data-testid="attendance-status-filter-group"
	                  >
	                    <p className="sr-only" id="attendance-status-filter-label">
	                      상태 빠른 필터
	                    </p>
		                    <div className="flex gap-1 overflow-x-auto pb-0.5 sm:flex-wrap sm:gap-2 sm:overflow-visible sm:pb-0">
		                      {visibleAttendanceStatusFilters.map((item) => {
		                        const selected = attendanceStatusFilter === item.status;

		                        return (
	                          <button
	                            aria-pressed={selected}
	                            className={`inline-flex min-h-11 min-w-0 items-center justify-center gap-1 rounded-md border px-1.5 text-xs font-semibold transition sm:min-w-16 sm:px-3 sm:text-sm ${
	                              selected
	                                ? "border-teal-600 bg-teal-50 text-teal-800"
	                                : "border-zinc-200 bg-white text-zinc-700 hover:border-zinc-300 hover:bg-zinc-50"
	                            }`}
	                            data-testid={`attendance-status-filter-${item.status}`}
	                            key={item.status}
	                            type="button"
	                            onClick={() => {
                              setShowReasonRequiredOnly(false);
                              setAttendanceStatusFilter(item.status);
                            }}
	                          >
	                            <span>{item.label}</span>
	                            <span className="tabular-nums text-zinc-500">{item.count}</span>
	                          </button>
	                        );
	                      })}
	                    </div>
	                  </div>
                  {!showAttendanceSearchInput ? (
                    <button
                      aria-label="출석 명단 검색 열기"
                      className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-md border border-zinc-200 bg-white text-zinc-600 transition hover:border-zinc-300 hover:bg-zinc-50"
                      data-testid="attendance-roster-search-toggle"
                      type="button"
                      onClick={() => setAttendanceSearchOpen(true)}
                    >
                      <Search className="h-4 w-4" aria-hidden />
                    </button>
                  ) : null}
	                </div>
                {showAttendanceSearchInput || showAttendanceControlMeta ? (
                  <div className="grid gap-1">
		                  <label className="sr-only" htmlFor="attendance-roster-search">
		                    명단 검색
		                  </label>
                    {showAttendanceSearchInput ? (
	                    <div className="relative">
	                      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" aria-hidden />
		                      <input
		                        className="h-11 w-full rounded-md border border-zinc-200 bg-white py-2 pl-9 pr-12 text-sm text-zinc-900 outline-none transition placeholder:text-zinc-400 focus:border-teal-500 focus:ring-2 focus:ring-teal-500/10"
		                        data-testid="attendance-roster-search"
		                        id="attendance-roster-search"
		                        placeholder="이름, 띠, 레벨 검색"
	                        type="search"
	                        value={attendanceSearch}
	                        onChange={(event) => setAttendanceSearch(event.target.value)}
	                      />
		                      <button
		                        aria-label={attendanceSearch ? "출석 명단 검색어 지우기" : "출석 명단 검색 닫기"}
		                        className="absolute right-0 top-1/2 inline-flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-md text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-900"
		                        data-testid="attendance-roster-search-clear"
		                        type="button"
	                        onClick={() => {
                            if (attendanceSearch) {
                              setAttendanceSearch("");
                              return;
                            }

                            setAttendanceSearchOpen(false);
                          }}
	                      >
	                        <X className="h-4 w-4" aria-hidden />
	                      </button>
	                    </div>
                    ) : null}
		                  {showAttendanceControlMeta ? (
		                    <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-0.5 text-[11px] leading-4 text-zinc-500">
		                      <p data-testid="attendance-roster-search-count">
		                        {showReasonRequiredOnly
                              ? `사유 필요 ${filteredRosterCount}/${reasonRequiredCount}명`
                              : hasAttendanceRosterFilter
                                ? `표시 ${filteredRosterCount}/${totalEnrolled}명`
                                : `전체 ${totalEnrolled}명`}
		                      </p>
		                      <p data-testid="attendance-status-filter-count">
		                        {showReasonRequiredOnly
                              ? `사유 필요 ${selectedAttendanceStatusCount}명`
                              : attendanceStatusFilter === "all"
		                          ? `전체 ${selectedAttendanceStatusCount}명`
		                          : `${selectedAttendanceStatusLabel} ${selectedAttendanceStatusCount}명`}
		                      </p>
		                      <span>
		                        {attendanceSync.updatedAt ? `${formatDateTime(attendanceSync.updatedAt)} · ` : ""}
		                        {attendanceSync.status === "idle" && !attendanceSync.updatedAt ? "변경 없음" : attendanceSync.message}
		                        {attendanceSync.pendingCount > 0 ? ` · 대기 ${attendanceSync.pendingCount}건` : ""}
		                      </span>
		                    </div>
		                  ) : null}
	                </div>
                ) : null}
	                {lastAttendanceChange ? (
	                  <div
	                    className="flex min-h-11 flex-wrap items-center gap-2 rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-900"
	                    data-testid="attendance-undo-panel"
	                  >
	                    <span className="font-semibold">
	                      최근 변경: {lastAttendanceChange.memberName} · {attendanceStatusLabels[lastAttendanceChange.nextStatus]}
	                    </span>
	                    <button
	                      className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md border border-blue-300 bg-white px-3 text-sm font-semibold text-blue-800 transition hover:bg-blue-100 disabled:cursor-not-allowed disabled:opacity-60"
	                      data-testid="attendance-undo-last"
	                      disabled={attendanceSyncPending}
	                      type="button"
	                      onClick={handleUndoLastAttendanceChange}
	                    >
	                      <Undo2 className="h-4 w-4" aria-hidden />
	                      {attendanceStatusLabels[lastAttendanceChange.previousStatus]}로 되돌리기
	                    </button>
	                  </div>
	                ) : null}
	                {hasPendingAttendance ? (
	                  <button
	                    aria-label="대기 출석 저장 재시도"
	                    className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md border border-amber-300 bg-white px-3 text-sm font-semibold text-amber-800 transition hover:bg-amber-50 disabled:cursor-not-allowed disabled:opacity-60"
	                    disabled={attendanceSyncPending}
	                    type="button"
	                    onClick={() => void syncPendingAttendance()}
	                  >
	                    <RefreshCw className={`h-4 w-4 ${attendanceSyncPending ? "animate-spin" : ""}`} aria-hidden />
	                    저장 재시도
	                  </button>
	                ) : null}
	                <div className="hidden grid-cols-3 gap-2 sm:grid sm:grid-cols-5">
	                  {attendanceCounts.map((item) => (
	                    <div className="rounded-md bg-zinc-50 px-3 py-2 text-center" key={item.label}>
	                      <p className="text-xs text-zinc-500">{item.label}</p>
	                      <p className="text-sm font-semibold tabular-nums text-zinc-950">{item.count}</p>
	                    </div>
	                  ))}
	                </div>
	              </div>
	            </section>
	          ) : null}

          {context.user.role === "coach" && canEditAttendance ? (
            <>
              <section
                aria-label="빠른 조치"
                className="mb-2 rounded-lg border border-teal-200 bg-teal-50/40 p-1.5 sm:p-4"
                data-testid="coach-mobile-speed-panel"
              >
                <p className="sr-only" data-testid="coach-mobile-speed-summary-line">
                  {coachMobileSpeedSummaryText}
                </p>
                <div className={`grid gap-1 sm:flex sm:flex-wrap ${hasAttendanceRosterFilter ? "grid-cols-4" : "grid-cols-3"}`}>
	                  <button
                    aria-label="미처리 명단만 보기"
                    aria-pressed={showUncheckedOnly}
                    className={coachQuickActionClass(showUncheckedOnly)}
                    data-testid="coach-mobile-speed-unchecked-action"
                    type="button"
                    onClick={() => {
                      setAttendanceSearch("");
                      setAttendanceSearchOpen(false);
                      setShowReasonRequiredOnly(false);
                      setAttendanceStatusFilter("all");
                      setShowUncheckedOnly(true);
                    }}
                  >
                    <ClipboardList className="h-3.5 w-3.5 shrink-0 sm:h-4 sm:w-4" aria-hidden />
                    <span className="whitespace-nowrap">미처리 {totalUnchecked}</span>
                  </button>
                  <button
                    aria-label="사유 입력 대상 보기"
                    className={coachQuickActionClass(showReasonRequiredOnly, "amber")}
                    data-testid="coach-mobile-speed-reason-action"
                    disabled={coachReasonRequiredRecords.length === 0}
                    aria-pressed={showReasonRequiredOnly}
                    type="button"
                    onClick={() => {
                      setAttendanceSearch("");
                      setAttendanceSearchOpen(false);
                      setShowUncheckedOnly(false);
                      setAttendanceStatusFilter("all");
                      setShowReasonRequiredOnly(true);
                    }}
                  >
                    <AlertTriangle className="h-3.5 w-3.5 shrink-0 sm:h-4 sm:w-4" aria-hidden />
                    <span className="whitespace-nowrap">사유 필요 {coachReasonRequiredRecords.length}</span>
                  </button>
                  <button
                    aria-label="주의 회원 찾기"
                    aria-pressed={coachAttentionFilterActive}
                    className={coachQuickActionClass(coachAttentionFilterActive)}
                    data-testid="coach-mobile-speed-attention-action"
                    disabled={!firstAttentionMember}
                    type="button"
                    onClick={() => {
                      setShowUncheckedOnly(false);
                      setShowReasonRequiredOnly(false);
                      setAttendanceStatusFilter("all");
                      setAttendanceSearch(firstAttentionMember?.name ?? "");
                      setAttendanceSearchOpen(true);
                    }}
                  >
                    <Search className="h-3.5 w-3.5 shrink-0 sm:h-4 sm:w-4" aria-hidden />
                    <span className="whitespace-nowrap">주의 {coachAttentionMemberCount}</span>
                  </button>
                  {hasAttendanceRosterFilter ? (
                    <button
                      aria-label="출석 필터 초기화"
	                      className="inline-flex min-h-11 w-full min-w-0 items-center justify-center gap-1 rounded-md border border-zinc-200 bg-white px-1 text-[11px] font-semibold text-zinc-700 transition hover:border-zinc-300 hover:bg-zinc-50 sm:w-auto sm:gap-2 sm:px-3 sm:text-sm"
                      data-testid="coach-mobile-speed-reset-action"
                      type="button"
                      onClick={() => {
                        setAttendanceSearch("");
                        setAttendanceSearchOpen(false);
                        setShowReasonRequiredOnly(false);
                        setAttendanceStatusFilter("all");
                        setShowUncheckedOnly(false);
                      }}
                    >
                      <X className="h-3.5 w-3.5 shrink-0 sm:h-4 sm:w-4" aria-hidden />
	                    <span className="whitespace-nowrap">초기화</span>
	                  </button>
                  ) : null}
	                </div>
	              </section>
              <section
                aria-label="수업 진행"
                className="mb-2 rounded-lg border border-zinc-200 bg-white px-2 py-1.5"
                data-testid="coach-field-flow-panel"
              >
                <div className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)_minmax(0,1fr)] items-stretch gap-1" data-testid="coach-field-flow-compact-grid">
                  <div className="flex min-w-0 flex-col justify-center rounded-md border border-teal-200 bg-teal-50 px-2 py-1">
                    <span className="text-[10px] font-semibold leading-3 text-teal-700">진행</span>
                    <span className="text-xs font-semibold leading-4 text-teal-900">
                      {totalCheckedPercent}% 완료
                    </span>
                  </div>
                  <article className="min-w-0 rounded-md bg-zinc-50/80 px-2 py-1" data-testid="coach-field-flow-compact-column">
                    <div className="flex min-w-0 items-center justify-between gap-2">
                      <div className="flex min-w-0 items-center gap-1.5">
                        <ClipboardList className="h-3.5 w-3.5 shrink-0 text-teal-700" aria-hidden />
                        <h3 className="text-xs font-semibold text-zinc-950">수업 전</h3>
                      </div>
                      <span className="shrink-0 text-xs font-semibold tabular-nums text-zinc-700">{totalEnrolled}명</span>
                    </div>
                    <p className="mt-0.5 truncate text-[11px] font-medium leading-4 text-zinc-500" data-testid="coach-field-flow-compact-summary">
                      {coachPreClassFlowSummary}
                    </p>
                  </article>
                  <article className="min-w-0 rounded-md bg-zinc-50/80 px-2 py-1" data-testid="coach-field-flow-compact-column">
                    <div className="flex min-w-0 items-center justify-between gap-2">
                      <div className="flex min-w-0 items-center gap-1.5">
                        <CheckCheck className="h-3.5 w-3.5 shrink-0 text-teal-700" aria-hidden />
                        <h3 className="text-xs font-semibold text-zinc-950">수업 후</h3>
                      </div>
                      <span className="shrink-0 text-xs font-semibold tabular-nums text-zinc-700">{totalUnchecked}명</span>
                    </div>
                    <p className="mt-0.5 truncate text-[11px] font-medium leading-4 text-zinc-500" data-testid="coach-field-flow-compact-summary">
                      {coachPostClassFlowSummary}
                    </p>
                  </article>
                </div>
              </section>
            </>
          ) : null}

          <div className={isFamilyRole ? "grid gap-3" : "grid gap-4"}>
            {data.map((session, sessionIndex) => {
              const allMemberIds = session.enrolledMemberIds;
              const attendanceProgress = getAttendanceProgress(session);
              const visibleMembers = canEditAttendance
                ? getVisibleAttendanceMembers(session, showUncheckedOnly, showReasonRequiredOnly, attendanceSearchTerm, attendanceStatusFilter)
                : session.enrolledMembers;
              const defaultCoachRosterOpen = session.id === defaultOpenCoachClassId;
              const coachRosterOpen = !isCoachRole || (coachClassRosterOpenById[session.id] ?? defaultCoachRosterOpen);
              const coachClassCollapsedOnMobile =
                coachClassListCollapsible && !coachClassListExpanded && sessionIndex >= coachClassMobileVisibleLimit;
              const allPresent =
                allMemberIds.length > 0 &&
                allMemberIds.every((memberId) => getAttendanceRecord(session, memberId)?.status === "present");

	              return (
	              <article
		                className={`rounded-lg border border-zinc-200 bg-white ${isFamilyRole ? "px-2.5 py-2" : isCoachRole ? "px-3 py-2" : "p-3"} ${
                    coachClassCollapsedOnMobile ? "hidden lg:block" : ""
                  }`}
                  data-coach-class-mobile-state={isCoachRole ? (coachClassCollapsedOnMobile ? "hidden" : "visible") : undefined}
	                data-testid={isFamilyRole ? `family-class-card-${session.id}` : isCoachRole ? `coach-class-card-${session.id}` : undefined}
	                key={session.id}
		              >
		                <div
		                  className={`sm:flex-row sm:items-start sm:justify-between ${
		                    isFamilyRole
		                      ? "flex flex-col gap-1.5 pb-1.5"
		                      : isCoachRole
		                        ? "grid grid-cols-[minmax(0,1fr)_11rem] items-start gap-2 border-b border-zinc-100 pb-1.5"
		                        : "flex flex-col gap-2 border-b border-zinc-100 pb-3"
		                  }`}
		                >
		                  <div className="min-w-0">
		                    <h2 className={`${isFamilyRole || isCoachRole ? "text-[15px] leading-5" : "text-base leading-6"} font-semibold text-zinc-950`}>{session.name}</h2>
		                    <p className={`${isFamilyRole || isCoachRole ? "text-[11px] leading-4" : "text-sm leading-5"} mt-0.5 text-zinc-600`}>
	                      {formatDate(session.startsAt)} · {formatCompactTimeRange(session.startsAt, session.endsAt)}
	                      {isFamilyRole ? "" : ` · ${session.room}`}
	                      {isCoachRole ? ` · ${session.level}` : ""}
	                    </p>
	                    {isCoachRole ? null : (
	                      <p className={`mt-0.5 font-medium text-zinc-500 ${isFamilyRole ? "text-[11px] leading-4" : "text-xs"}`}>
	                        {isFamilyRole
	                          ? `${session.room} · ${session.coach.name} 코치 · ${session.level}`
	                          : `${session.branch.name} · ${session.coach.name} 코치 · ${session.level}`}
	                      </p>
	                    )}
	                  </div>
	                  {canEditAttendance ? (
	                    <div
	                      className={
	                        isCoachRole
	                          ? "grid w-full grid-cols-[6rem_minmax(0,1fr)] items-stretch gap-1.5 sm:min-w-44 sm:max-w-48"
	                          : "grid w-full gap-1.5 sm:min-w-44 sm:max-w-48"
	                      }
                    >
                      <button
	                        className="inline-flex min-h-11 w-full items-center justify-center gap-1 rounded-md border border-emerald-300 bg-white px-1.5 text-xs font-semibold text-emerald-800 transition hover:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-60"
                        disabled={allMemberIds.length === 0 || allPresent || attendanceSyncPending}
                        type="button"
                        onClick={() => {
                          setLastAttendanceChange(null);
                          markSessionAttendance(session.id, allMemberIds, "present");
                        }}
	                      >
		                        <CheckCheck className="h-3.5 w-3.5 shrink-0" aria-hidden />
		                        <span className="whitespace-nowrap">전체 출석</span>
	                      </button>
		                      <div
		                        className={`flex min-w-0 flex-col justify-center rounded-md bg-zinc-50 px-2 text-zinc-600 ${
		                          isCoachRole ? "h-11" : "min-h-11"
		                        } ${
		                          isCoachRole ? "py-1 text-[10px] leading-3" : "py-1.5 text-[11px] leading-4"
		                        }`}
		                        data-testid={`coach-class-attendance-summary-${session.id}`}
		                      >
		                        {isCoachRole ? (
		                          <div className="flex min-w-0 items-center justify-between gap-1">
		                            <span className="min-w-0 truncate">
		                              <strong className="font-semibold text-zinc-950">{attendanceProgress.checkedCount}</strong>/{session.enrolledMemberIds.length}
		                            </span>
		                            <span className="shrink-0 text-amber-700">
		                              미{" "}
                              <strong
                                aria-label={`미처리 ${attendanceProgress.uncheckedCount}명`}
                                className="font-semibold text-amber-900"
                                data-testid={`attendance-unchecked-${session.id}`}
                              >
		                                {attendanceProgress.uncheckedCount}
		                              </strong>
		                            </span>
		                          </div>
		                        ) : (
		                          <div className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5">
		                            <span className="shrink-0">
		                              정원 <strong className="font-semibold text-zinc-950">{session.enrolledMemberIds.length}/{session.capacity}</strong>
		                            </span>
		                            <span className="shrink-0">
		                              처리 <strong className="font-semibold text-zinc-950">{attendanceProgress.checkedCount}명</strong>
		                            </span>
		                            <span className="shrink-0 text-amber-700">
		                              미처리{" "}
                              <strong
                                aria-label={`미처리 ${attendanceProgress.uncheckedCount}명`}
                                className="font-semibold text-amber-900"
                                data-testid={`attendance-unchecked-${session.id}`}
                              >
		                                {attendanceProgress.uncheckedCount}명
		                              </strong>
		                            </span>
		                          </div>
		                        )}
	                        <div className="mt-1 h-1.5 rounded-full bg-zinc-100" aria-label={`${session.name} 출석 처리율 ${attendanceProgress.checkedPercent}%`}>
	                          <div
	                            className="h-1.5 rounded-full bg-teal-600 transition-[width]"
	                            role="progressbar"
	                            aria-valuemax={100}
	                            aria-valuemin={0}
	                            aria-valuenow={attendanceProgress.checkedPercent}
	                            data-testid={`attendance-progress-${session.id}`}
	                            style={{ width: `${attendanceProgress.checkedPercent}%` }}
	                          />
	                        </div>
	                      </div>
	                    </div>
	                  ) : null}
                </div>

                {canManageClasses ? (
                  <form
                    className="mt-3 grid gap-3 border-b border-zinc-100 pb-4 sm:grid-cols-[1fr_0.5fr_auto]"
                    data-testid="class-edit-form"
                    onSubmit={(event) => handleUpdateClass(event, session)}
                  >
                    <label>
                      <span className="mb-1 block text-xs font-semibold text-zinc-500">장소 수정</span>
                      <input
                        className="h-11 w-full rounded-md border border-zinc-200 bg-white px-3 text-sm outline-none transition focus:border-teal-500"
                        data-testid="class-edit-input"
                        value={getClassEdit(session).room}
                        onChange={(event) => updateClassEdit(session, "room", event.target.value)}
                      />
                    </label>
                    <label>
                      <span className="mb-1 block text-xs font-semibold text-zinc-500">정원 수정</span>
                      <input
                        className="h-11 w-full rounded-md border border-zinc-200 bg-white px-3 text-sm outline-none transition focus:border-teal-500"
                        data-testid="class-edit-input"
                        min={session.enrolledMemberIds.length}
                        max={80}
                        type="number"
                        value={getClassEdit(session).capacity}
                        onChange={(event) => updateClassEdit(session, "capacity", event.target.value)}
                      />
                    </label>
                    <button
                      className="inline-flex h-11 items-center justify-center gap-2 self-end rounded-md border border-zinc-300 bg-white px-3 text-sm font-semibold text-zinc-900 transition hover:bg-zinc-50"
                      data-testid="class-edit-submit"
                      type="submit"
                    >
                      <Save className="h-4 w-4" aria-hidden />
                      저장
                    </button>
                  </form>
                ) : null}

                {canEditAttendance ? (
                  <>
	                    {isCoachRole ? (
	                      <button
	                        aria-controls={`coach-class-roster-panel-${session.id}`}
	                        aria-expanded={coachRosterOpen}
	                        className="mt-1 inline-flex min-h-11 w-full items-center justify-between gap-3 rounded-md border border-zinc-200 bg-white px-2.5 text-left text-sm font-semibold text-zinc-800 transition hover:bg-zinc-50"
                        data-coach-class-roster-state={coachRosterOpen ? "open" : "closed"}
                        data-testid={`coach-class-roster-toggle-${session.id}`}
                        type="button"
                        onClick={() => toggleCoachClassRoster(session.id, defaultCoachRosterOpen)}
	                      >
	                        <span className="min-w-0">
	                          명단 {visibleMembers.length}/{session.enrolledMembers.length}
	                        </span>
	                        <span className="inline-flex shrink-0 items-center gap-2">
	                          {!coachRosterOpen ? (
	                            <span className="rounded-full bg-zinc-50 px-2 py-1 text-xs font-semibold text-zinc-600 ring-1 ring-inset ring-zinc-200">
	                              {attendanceProgress.uncheckedCount > 0
	                                ? `미처리 ${attendanceProgress.uncheckedCount}`
	                                : "출석 완료"}
	                            </span>
	                          ) : null}
                          <span className="text-teal-700">{coachRosterOpen ? "접기" : "열기"}</span>
                        </span>
                      </button>
                    ) : null}
                    {coachRosterOpen ? (
                      <div
                        className="divide-y divide-zinc-100"
                        data-coach-class-roster-state="open"
                        data-testid={`coach-class-roster-panel-${session.id}`}
                        id={`coach-class-roster-panel-${session.id}`}
                      >
                        {visibleMembers.length > 0 ? (
                        visibleMembers.map((member) => {
                          const attendanceRecord = getAttendanceRecord(session, member.id);
                          const status = attendanceRecord?.status;
                          const attendanceNoteKey = getAttendanceNoteKey(session.id, member.id);
                          const noteValue = attendanceNotes[attendanceNoteKey] ?? attendanceRecord?.note ?? "";
                          const noteEditorOpen = Boolean(noteValue.trim()) || Boolean(attendanceNoteEditorOpenByKey[attendanceNoteKey]);

                          return (
                            <div className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between" key={member.id}>
                              <div className="min-w-0">
                                <p className="font-semibold text-zinc-950">{member.name}</p>
                                <p className="mt-1 text-sm text-zinc-600">
                                  {member.belt} · {member.level}
                                  {member.alerts.length > 0 ? ` · ${member.alerts[0]}` : ""}
                                </p>
                              </div>

                              {canEditAttendance ? (
                                <div className="w-full sm:max-w-xl">
                                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
                                    {attendanceOptions.map((option) => {
                                      const selected = status === option;

                                      return (
                                        <AttendanceStatusButton
                                          key={option}
                                          status={option}
                                          selected={selected}
                                          testId={`attendance-${session.id}-${member.id}-${option}`}
                                          onSelect={(nextStatus) => {
                                            if (coachReasonRequiredStatuses.includes(nextStatus)) {
                                              setAttendanceNoteEditorOpen(attendanceNoteKey, true);
                                            }
                                            handleAttendanceSelect(session, member, attendanceRecord, nextStatus, noteValue);
                                          }}
                                        />
                                      );
                                    })}
                                  </div>
                                  <button
                                    aria-controls={`attendance-note-editor-${attendanceNoteKey}`}
                                    aria-expanded={noteEditorOpen}
                                    className="mt-2 inline-flex min-h-11 w-full items-center justify-center rounded-md border border-zinc-200 bg-white px-3 text-xs font-semibold text-zinc-700 transition hover:border-zinc-300 hover:bg-zinc-50"
                                    data-testid={`attendance-note-toggle-${session.id}-${member.id}`}
                                    type="button"
                                    onClick={() => setAttendanceNoteEditorOpen(attendanceNoteKey, !noteEditorOpen)}
                                  >
                                    {noteValue.trim() ? "메모 있음" : noteEditorOpen ? "메모 닫기" : "메모"}
                                  </button>
                                  {noteEditorOpen ? (
                                    <div data-testid={`attendance-note-editor-${session.id}-${member.id}`} id={`attendance-note-editor-${attendanceNoteKey}`}>
                                      <label className="sr-only" htmlFor={`attendance-note-${attendanceNoteKey}`}>
                                        출석 수정 사유
                                      </label>
                                      <input
                                        data-testid={`attendance-note-${session.id}-${member.id}`}
                                        className="mt-2 h-11 w-full rounded-md border border-zinc-300 bg-white px-3 text-sm text-zinc-900 outline-none transition placeholder:text-zinc-400 focus:border-zinc-900 focus:ring-2 focus:ring-zinc-900/10"
                                        id={`attendance-note-${attendanceNoteKey}`}
                                        maxLength={80}
                                        onChange={(event) =>
                                          setAttendanceNotes((current) => ({
                                            ...current,
                                            [attendanceNoteKey]: event.target.value,
                                          }))
                                        }
                                        onKeyDown={(event) => {
                                          // 이미 출석 기록이 있으면 Enter로 사유만 즉시 저장 (현장 한 손 조작 편의)
                                          if (event.key === "Enter" && attendanceRecord && noteValue.trim()) {
                                            event.preventDefault();
                                            void handleSaveAttendanceReason(attendanceNoteKey, session.id, member.id, noteValue);
                                          }
                                        }}
                                        placeholder="현장 메모"
                                        value={noteValue}
                                      />
                                      <div className="mt-2 flex flex-wrap gap-2" aria-label={`${member.name} 빠른 메모`}>
                                        {attendanceNotePresets.map((preset) => (
                                          <button
                                            className="inline-flex min-h-11 items-center justify-center rounded-md border border-zinc-200 bg-white px-2.5 text-xs font-semibold text-zinc-700 transition hover:border-zinc-300 hover:bg-zinc-50"
                                            data-testid={`attendance-note-preset-${session.id}-${member.id}-${preset.id}`}
                                            key={preset.id}
                                            type="button"
                                            onClick={() => applyAttendanceNotePreset(attendanceNoteKey, noteValue, preset.label)}
                                          >
                                            {preset.label}
                                          </button>
                                        ))}
                                        {attendanceRecord ? (
                                          <button
                                            className="inline-flex min-h-11 items-center justify-center rounded-md bg-zinc-900 px-3 text-xs font-semibold text-white transition hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-50"
                                            data-testid={`attendance-note-save-${session.id}-${member.id}`}
                                            disabled={!noteValue.trim() || reasonSavingKey === attendanceNoteKey}
                                            type="button"
                                            onClick={() =>
                                              void handleSaveAttendanceReason(attendanceNoteKey, session.id, member.id, noteValue)
                                            }
                                          >
                                            {reasonSavingKey === attendanceNoteKey
                                              ? "저장 중..."
                                              : reasonSavedKey === attendanceNoteKey
                                                ? "사유 저장됨"
                                                : "사유 저장"}
                                          </button>
                                        ) : null}
                                      </div>
                                    </div>
                                  ) : null}
                                </div>
                              ) : (
                                <div className="flex flex-col items-start gap-1 sm:items-end">
                                  {status ? (
                                    <AttendanceStatusBadge status={status} />
                                  ) : (
                                    <span className="inline-flex w-fit rounded-md border border-zinc-200 bg-zinc-50 px-2 py-1 text-xs font-semibold text-zinc-600">
                                      예정
                                    </span>
                                  )}
                                  {attendanceRecord?.note ? (
                                    <p className="max-w-xs text-xs text-zinc-500">{attendanceRecord.note}</p>
                                  ) : null}
                                </div>
                              )}
                            </div>
                          );
                        })
                        ) : (
                          <div
                            className="rounded-md bg-zinc-50 px-3 py-4 text-sm font-semibold text-zinc-600"
                            data-testid={`attendance-filter-empty-${session.id}`}
                          >
                            {attendanceSearchTerm
                              ? "검색 조건에 맞는 회원 없음"
                              : showReasonRequiredOnly
                                ? "사유 입력 대상 없음"
                              : attendanceStatusFilter !== "all"
                                ? `${selectedAttendanceStatusLabel} 상태 회원 없음`
                                : showUncheckedOnly
                                  ? "미처리 인원 없음"
                                  : "출석 명단 없음"}
                          </div>
                        )}
                      </div>
                    ) : (
                      <div
                        className="sr-only"
                        data-coach-class-roster-state="closed"
                        data-testid={`coach-class-roster-collapsed-${session.id}`}
                        id={`coach-class-roster-panel-${session.id}`}
                      >
                        {attendanceProgress.uncheckedCount > 0
                          ? `미처리 ${attendanceProgress.uncheckedCount}명`
                          : "출석 완료"}
                      </div>
                    )}
                  </>
                ) : (
                  <div
                    className={`grid gap-1 pt-1 ${visibleMembers.length > 1 ? "grid-cols-2" : "grid-cols-1"}`}
                    data-testid={`family-attendance-chip-grid-${session.id}`}
                  >
                    {visibleMembers.map((member) => {
                      const attendanceRecord = getAttendanceRecord(session, member.id);
                      const status = attendanceRecord?.status;

                      return (
                        <article
                          className="min-w-0 rounded-md border border-zinc-100 bg-zinc-50 px-2 py-1.5"
                          data-testid={`family-attendance-chip-${session.id}-${member.id}`}
                          key={member.id}
                        >
                          <div className="flex min-w-0 items-center justify-between gap-1.5">
                            <div className="min-w-0">
                              <p className="truncate text-[13px] font-semibold leading-4 text-zinc-950">{member.name}</p>
                              <p className="mt-0.5 truncate text-[11px] leading-4 text-zinc-600">
                                {member.belt} · {member.level}
                              </p>
                            </div>
                            {status ? (
                              <AttendanceStatusBadge status={status} />
                            ) : (
                              <span className="inline-flex w-fit shrink-0 rounded-md border border-zinc-200 bg-white px-2 py-1 text-xs font-semibold text-zinc-600">
                                예정
                              </span>
                            )}
                          </div>
                        </article>
                      );
                    })}
                  </div>
                )}
              </article>
              );
            })}
          </div>

          {hiddenCoachClassCount > 0 ? (
            <button
              aria-expanded={coachClassListExpanded}
              className="mt-3 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-md border border-zinc-200 bg-white px-3 text-sm font-semibold text-zinc-800 transition hover:bg-zinc-50 lg:hidden"
              data-testid="coach-class-list-toggle"
              type="button"
              onClick={() => setCoachClassListExpanded((current) => !current)}
            >
              {coachClassListExpanded ? "수업 접기" : `오늘 수업 ${hiddenCoachClassCount}개 더 보기`}
            </button>
          ) : null}

          {canEditAttendance && latestAttendanceAuditLog ? (
            <section
              aria-label="최근 출석 저장 내역"
              className="mt-4 rounded-lg border border-zinc-200 bg-white p-3"
              data-attendance-history-state={attendanceHistoryDetailsOpen ? "open" : "closed"}
              data-testid="attendance-history-panel"
            >
              <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-zinc-950">최근 저장 · {latestAttendanceAuditResultLabel}</p>
                  <p className="mt-0.5 truncate text-xs text-zinc-500">
                    {formatDateTime(latestAttendanceAuditLog.createdAt)} · {latestAttendanceAuditActor?.name ?? "처리자 확인 중"}
                  </p>
                </div>
                <button
                  aria-expanded={attendanceHistoryDetailsOpen}
                  aria-label={attendanceHistoryDetailsOpen ? "최근 출석 저장 내역 닫기" : "최근 출석 저장 내역 열기"}
                  className="inline-flex min-h-11 shrink-0 items-center justify-center gap-1 rounded-md border border-zinc-200 bg-white px-3 text-sm font-semibold text-teal-700 transition hover:border-teal-200 hover:bg-teal-50"
                  data-testid="attendance-history-toggle"
                  type="button"
                  onClick={() => setAttendanceHistoryOpen((current) => !current)}
                >
                  {attendanceHistoryDetailsOpen ? <ChevronUp className="h-4 w-4" aria-hidden /> : <ChevronDown className="h-4 w-4" aria-hidden />}
                  {attendanceHistoryDetailsOpen ? "닫기" : "열기"}
                </button>
              </div>
              {attendanceHistoryDetailsOpen ? (
                <div className="mt-2 divide-y divide-zinc-100" data-testid="attendance-history-detail-list">
                  {recentAttendanceAuditLogs.map((log) => {
                    const actor = context.db.users.find((user) => user.id === log.actorUserId);
                    const resultLabel = log.result === "success" ? "완료" : log.result === "blocked" ? "확인 필요" : "실패";

                    return (
                      <article className="py-2 first:pt-0 last:pb-0" data-testid="attendance-history-detail-row" key={log.id}>
                        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-2">
                          <p className="min-w-0 text-sm font-semibold text-zinc-950">{log.message}</p>
                          <span
                            className={`inline-flex shrink-0 rounded-md border px-2 py-0.5 text-xs font-semibold ${
                              log.result === "success"
                                ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                                : "border-amber-200 bg-amber-50 text-amber-700"
                            }`}
                          >
                            {resultLabel}
                          </span>
                        </div>
                        <p className="mt-1 text-xs text-zinc-500">
                          {formatDateTime(log.createdAt)} · {actor?.name ?? "처리자 확인 중"}
                        </p>
                      </article>
                    );
                  })}
                </div>
              ) : null}
            </section>
          ) : null}

          {shouldShowMobileSaveStatusPanel ? (
            <div
              className="fixed inset-x-2 bottom-[calc(6.5rem+env(safe-area-inset-bottom))] z-20 rounded-md border border-zinc-200 bg-white px-3 py-2 shadow-[0_10px_28px_rgba(15,23,42,0.16)] lg:hidden"
              data-testid="coach-mobile-save-status-panel"
            >
              <div className="flex min-h-11 items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-zinc-950">
                    출석 {totalChecked}/{totalEnrolled} · 미처리 {totalUnchecked}
                  </p>
                  <p className={`mt-0.5 truncate text-xs font-semibold ${hasPendingAttendance ? "text-amber-700" : "text-zinc-500"}`}>
                    {hasPendingAttendance ? `저장 대기 ${attendanceSync.pendingCount}건` : "저장 대기 없음"} · 처리율 {totalCheckedPercent}%
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {hasPendingAttendance ? (
                    <button
                      aria-label="대기 출석 재시도"
                      className="inline-flex min-h-11 items-center justify-center gap-1 rounded-md border border-amber-300 bg-white px-2 text-sm font-semibold text-amber-800 transition hover:bg-amber-50 disabled:cursor-not-allowed disabled:opacity-60"
                      data-testid="attendance-retry-mobile"
                      disabled={attendanceSyncPending}
                      type="button"
                      onClick={() => void syncPendingAttendance()}
                    >
                      <RefreshCw className={`h-4 w-4 ${attendanceSyncPending ? "animate-spin" : ""}`} aria-hidden />
                      재시도
                    </button>
                  ) : null}
                  <span
                    className={`inline-flex min-h-11 items-center rounded-md border px-2 text-sm font-semibold ${syncStatusClasses[attendanceSync.status]}`}
                    data-attendance-sync-state={attendanceSync.status}
                    data-testid="attendance-sync-status-mobile"
                  >
                    {syncStatusLabels[attendanceSync.status]}
                  </span>
                </div>
              </div>
              {lastAttendanceChange ? (
                <div className="mt-2 grid gap-2 rounded-md border border-blue-200 bg-blue-50 px-3 py-2" aria-live="polite">
                  <p className="truncate text-xs font-semibold text-blue-900">
                    최근 변경 {lastAttendanceChange.memberName} · {attendanceStatusLabels[lastAttendanceChange.nextStatus]}
                  </p>
                  <button
                    className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-md border border-blue-300 bg-white px-3 text-sm font-semibold text-blue-800 transition hover:bg-blue-100 disabled:cursor-not-allowed disabled:opacity-60"
                    data-testid="attendance-undo-last-mobile"
                    disabled={attendanceSyncPending}
                    type="button"
                    onClick={handleUndoLastAttendanceChange}
                  >
                    <Undo2 className="h-4 w-4" aria-hidden />
                    {attendanceStatusLabels[lastAttendanceChange.previousStatus]}로 되돌리기
                  </button>
                </div>
              ) : null}
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
