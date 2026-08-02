"use client";

import Link from "next/link";
import { Fragment, type FormEvent, useEffect, useMemo, useState } from "react";
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
import { ChildSwitcher } from "@/components/domain/child-switcher";
import { ClassRegistrationPanel } from "@/components/domain/class-registration-panel";
import { ClassRosterEditor } from "@/components/domain/class-roster-editor";
import { FamilyClassCalendar } from "@/components/domain/family-class-calendar";
import { FinalMainScheduleReference } from "@/components/domain/final-main-schedule-reference";
import { useApiContext } from "@/hooks/use-api-context";
import { useFamilyMemberSelection } from "@/hooks/use-guardian-child-selection";
import { useResource } from "@/hooks/use-resource";
import { apiClient } from "@/lib/api-client";
import { attendanceInputLimits, hasAttendanceWindowOpened } from "@/lib/attendance-policy";
import { classWeekdayOptions, getClassWeeklyRecurrence } from "@/lib/class-recurrence";
import { classInputLimits } from "@/lib/class-input-policy";
import { finalMainClassRegistrationSlots } from "@/lib/final-main-schedule-policy";
import { formatCompactTimeRange, formatDate, formatDateKey, formatDateTime } from "@/lib/format";
import { getFamilyMemberRelationLabel, getGuardianFamilyMembers, getGuardianMemberRelation } from "@/lib/family-members";
import { isFinalMainBranch } from "@/lib/final-main-policy";
import { getChildSwitcherPresentation } from "@/lib/member-presentation";
import { attendanceStatusLabels } from "@/lib/roles";
import { getTournamentDateKeys } from "@/lib/tournament-dates";
import { canViewTournament } from "@/lib/tournament-policy";
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
const ageGroupOptions: Array<{ value: ClassSession["ageGroup"]; label: string }> = [
  { value: "all", label: "무관 (모두 가능)" },
  { value: "kids", label: "유소년" },
  { value: "teen", label: "청소년" },
  { value: "adult", label: "성인" },
];
type ClassCreateScheduleMode = "single" | "weekly";

const weekdayLabelByValue = new Map<number, string>(classWeekdayOptions.map((option) => [option.value, option.label]));
const finalMainClassTimeOptions = Array.from(
  finalMainClassRegistrationSlots.reduce(
    (options, slot) => {
      const value = `${slot.startTime}-${slot.endTime}`;
      const existing = options.get(value);

      if (existing) {
        existing.weekdays.push(slot.weekday);
      } else {
        options.set(value, {
          value,
          startTime: slot.startTime,
          endTime: slot.endTime,
          weekdays: [slot.weekday],
        });
      }

      return options;
    },
    new Map<string, { value: string; startTime: string; endTime: string; weekdays: number[] }>(),
  ).values(),
).map((option) => ({
  ...option,
  label: `${option.startTime}–${option.endTime} · ${option.weekdays.map((weekday) => weekdayLabelByValue.get(weekday)).join("·")}`,
}));

type AttendanceUndoSnapshot = {
  sessionId: string;
  memberId: string;
  sessionName: string;
  memberName: string;
  previousStatus: AttendanceStatus | null;
  previousNote: string;
  nextStatus: AttendanceStatus;
  changedAt: string;
};

type AttendanceBatchChangeSnapshot = {
  memberId: string;
  memberName: string;
  previousStatus: AttendanceStatus | null;
  previousNote: string;
};

type AttendanceBatchSnapshot = {
  sessionId: string;
  sessionName: string;
  changes: AttendanceBatchChangeSnapshot[];
  alreadyPresentCount: number;
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

function createInitialDateKey() {
  return createInitialStartAt().slice(0, 10);
}

function addDaysToDateKey(value: string, days: number) {
  const date = new Date(`${value}T00:00:00Z`);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
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

function isPastClassSession(session: EnrichedClassSession, referenceTime: number) {
  return new Date(session.endsAt).getTime() < referenceTime;
}

function sortFamilyClassSessions(sessions: EnrichedClassSession[], referenceTime: number) {
  return [...sessions].sort((left, right) => {
    const leftIsPast = isPastClassSession(left, referenceTime);
    const rightIsPast = isPastClassSession(right, referenceTime);

    if (leftIsPast !== rightIsPast) {
      return leftIsPast ? 1 : -1;
    }

    return leftIsPast
      ? right.startsAt.localeCompare(left.startsAt)
      : left.startsAt.localeCompare(right.startsAt);
  });
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

  return `inline-flex min-h-11 w-auto min-w-[72px] shrink-0 items-center justify-center gap-1 rounded-md border px-2 text-[11px] font-semibold transition disabled:cursor-not-allowed disabled:opacity-60 sm:gap-2 sm:px-3 sm:text-sm ${
    active ? activeClass : "border-zinc-200 bg-white text-zinc-700 hover:border-zinc-300 hover:bg-zinc-50"
  }`;
}

export function ClassesScreen() {
  const context = useApiContext();
  const { attendanceSync, cancelClassRegistration, clearAttendance, createClassSession, markAttendance, markSessionAttendance, registerForClass, saveAttendanceReason, syncPendingAttendance, updateClassSession } = useAppStore();
  const [reasonSavingKey, setReasonSavingKey] = useState<string | null>(null);
  const [reasonSavedKey, setReasonSavedKey] = useState<string | null>(null);
  const canEditAttendance = ["coach", "owner", "admin"].includes(context.user.role);
  const canManageClasses = ["coach", "owner", "admin"].includes(context.user.role);
  const isFamilyRole = context.user.role === "member" || context.user.role === "guardian";
  const showClassesScreenHeader = context.user.role !== "member" && context.user.role !== "guardian";
  const guardianChildren =
    context.user.role === "guardian"
      ? getGuardianFamilyMembers(context.user, context.db)
      : [];
  const guardianChildIds = guardianChildren.map((member) => member.id);
  const [selectedChildId, setSelectedChildId] = useFamilyMemberSelection(
    context.user.id,
    context.user.role === "guardian" ? guardianChildIds : undefined,
  );
  const [newClassBranchId, setNewClassBranchId] = useState("");
  const [newClassName, setNewClassName] = useState("");
  const [newClassAgeGroup, setNewClassAgeGroup] = useState<ClassSession["ageGroup"]>("kids");
  const [newClassLevel, setNewClassLevel] = useState("입문-초급");
  const [newClassCoachId, setNewClassCoachId] = useState("");
  const [newClassStartsAt, setNewClassStartsAt] = useState(createInitialStartAt);
  const [newClassEndsAt, setNewClassEndsAt] = useState(() => addMinutes(createInitialStartAt(), 50));
  const [newClassScheduleMode, setNewClassScheduleMode] = useState<ClassCreateScheduleMode>("single");
  const [newClassRepeatStartsOn, setNewClassRepeatStartsOn] = useState(createInitialDateKey);
  const [newClassRepeatEndsOn, setNewClassRepeatEndsOn] = useState(() => addDaysToDateKey(createInitialDateKey(), 27));
  const [newClassWeekdays, setNewClassWeekdays] = useState<number[]>(() => {
    const weekday = new Date(`${createInitialDateKey()}T00:00:00Z`).getUTCDay();
    return [weekday === 0 ? 1 : weekday];
  });
  const [newClassFixedStartTime, setNewClassFixedStartTime] = useState("18:00");
  const [newClassFixedEndTime, setNewClassFixedEndTime] = useState("19:00");
  const [newClassMainTimeKey, setNewClassMainTimeKey] = useState("18:00-19:00");
  const [newClassRoom, setNewClassRoom] = useState("매트 A");
  const [newClassCapacity, setNewClassCapacity] = useState("12");
  const [newClassMemberIds, setNewClassMemberIds] = useState<string[]>([]);
  const [classCreateFormOpen, setClassCreateFormOpen] = useState(false);
  const [classCreatePending, setClassCreatePending] = useState(false);
  const [classCreateFeedback, setClassCreateFeedback] = useState<string | null>(null);
  const [classEdits, setClassEdits] = useState<Record<string, { room: string; capacity: string }>>({});
  const [attendanceNotes, setAttendanceNotes] = useState<Record<string, string>>({});
  const [attendanceNoteEditorOpenByKey, setAttendanceNoteEditorOpenByKey] = useState<Record<string, boolean>>({});
  const [showUncheckedOnly, setShowUncheckedOnly] = useState(false);
  const [showReasonRequiredOnly, setShowReasonRequiredOnly] = useState(false);
  const [attendanceSearch, setAttendanceSearch] = useState("");
  const [attendanceSearchOpen, setAttendanceSearchOpen] = useState(false);
  const [attendanceStatusFilter, setAttendanceStatusFilter] = useState<AttendanceStatusFilter>("all");
  const [lastAttendanceChange, setLastAttendanceChange] = useState<AttendanceUndoSnapshot | null>(null);
  const [attendanceBatchConfirmation, setAttendanceBatchConfirmation] = useState<AttendanceBatchSnapshot | null>(null);
  const [lastAttendanceBatchChange, setLastAttendanceBatchChange] = useState<AttendanceBatchSnapshot | null>(null);
  const [coachClassRosterOpenById, setCoachClassRosterOpenById] = useState<Record<string, boolean>>({});
  const [coachClassListExpanded, setCoachClassListExpanded] = useState(false);
  const [coachToolsOpen, setCoachToolsOpen] = useState(false);
  const [attendanceHistoryOpen, setAttendanceHistoryOpen] = useState(false);
  const [otherDateClassesOpen, setOtherDateClassesOpen] = useState(false);
  const [screenReferenceTime, setScreenReferenceTime] = useState(() => Date.now());
  const [familyCalendarMonth, setFamilyCalendarMonth] = useState(() => formatDateKey(new Date()).slice(0, 7));
  const [selectedFamilyDateKey, setSelectedFamilyDateKey] = useState<string | null>(null);
  const [classRegistrationPendingId, setClassRegistrationPendingId] = useState<string | null>(null);
  const [classRegistrationFeedback, setClassRegistrationFeedback] = useState<string | null>(null);
  const { data, loading, error, reload } = useResource(
    () => apiClient.getClasses(context),
    [context.user.id, context.selectedBranchId, context.version],
  );
  const selectedRegistrationMemberId =
    context.user.role === "guardian"
      ? selectedChildId
      : context.user.role === "member"
        ? context.user.memberIds?.[0] ?? null
        : null;
  const selectedRegistrationMember = selectedRegistrationMemberId
    ? context.db.members.find((member) => member.id === selectedRegistrationMemberId) ?? null
    : null;
  const {
    data: registrationData,
    loading: registrationLoading,
    error: registrationError,
    reload: reloadRegistration,
  } = useResource(
    () =>
      isFamilyRole && selectedRegistrationMemberId
        ? apiClient.getClassRegistrationOptions(
            selectedRegistrationMemberId,
            familyCalendarMonth,
            context.selectedBranchId,
          )
        : Promise.resolve({ memberId: "", month: familyCalendarMonth, options: [] }),
    [
      context.selectedBranchId,
      context.user.id,
      context.version,
      familyCalendarMonth,
      isFamilyRole,
      selectedRegistrationMemberId,
    ],
  );
  const isCoachRole = context.user.role === "coach";

  useEffect(() => {
    const interval = window.setInterval(() => setScreenReferenceTime(Date.now()), 30_000);

    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!classCreateFormOpen) {
      return;
    }

    const previousOverflow = document.body.style.overflow;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !classCreatePending) {
        setClassCreateFormOpen(false);
      }
    };

    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [classCreateFormOpen, classCreatePending]);

  const selectedCreateBranchId = newClassBranchId || context.selectedBranchId || context.db.branches[0]?.id || "";
  const selectedCreateBranch = context.db.branches.find((branch) => branch.id === selectedCreateBranchId) ?? null;
  const usesFinalMainSchedule = isFinalMainBranch(selectedCreateBranch);
  const selectedMainTimeOption =
    finalMainClassTimeOptions.find((option) => option.value === newClassMainTimeKey) ?? finalMainClassTimeOptions[0] ?? null;
  const recurringStartTime = usesFinalMainSchedule
    ? selectedMainTimeOption?.startTime ?? ""
    : newClassFixedStartTime;
  const recurringEndTime = usesFinalMainSchedule
    ? selectedMainTimeOption?.endTime ?? ""
    : newClassFixedEndTime;
  const classRecurrenceResult = getClassWeeklyRecurrence({
    mode: "weekly",
    startsOn: newClassRepeatStartsOn,
    endsOn: newClassRepeatEndsOn,
    weekdays: newClassWeekdays,
    startTime: recurringStartTime,
    endTime: recurringEndTime,
  });
  const hasInvalidFinalMainWeekday = Boolean(
    usesFinalMainSchedule &&
      selectedMainTimeOption &&
      newClassWeekdays.some((weekday) => !selectedMainTimeOption.weekdays.includes(weekday)),
  );
  const classRecurrenceError =
    newClassScheduleMode === "weekly"
      ? hasInvalidFinalMainWeekday
        ? "선택한 시간에 운영하는 요일만 고를 수 있습니다."
        : classRecurrenceResult.ok
          ? null
          : classRecurrenceResult.error
      : null;
  const recurringClassCount = classRecurrenceResult.ok && !hasInvalidFinalMainWeekday
    ? classRecurrenceResult.occurrences.length
    : 0;
  const activePolicyBranch = context.selectedBranchId
    ? context.db.branches.find((branch) => branch.id === context.selectedBranchId) ?? null
    : context.user.branchIds.length === 1
      ? context.db.branches.find((branch) => branch.id === context.user.branchIds[0]) ?? null
      : null;
  const branchCoaches = useMemo(
    () =>
      context.db.users.filter(
        (user) =>
          ["coach", "owner", "admin"].includes(user.role) &&
          user.invitationStatus !== "pending" &&
          selectedCreateBranchId &&
          user.branchIds.includes(selectedCreateBranchId) &&
          (context.user.role !== "coach" || user.id === context.user.id),
      ),
    [context.db.users, context.user.id, context.user.role, selectedCreateBranchId],
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

  async function handleCreateClass(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const capacity = Number(newClassCapacity);
    const recurrence = newClassScheduleMode === "weekly" && classRecurrenceResult.ok && !hasInvalidFinalMainWeekday
      ? classRecurrenceResult
      : null;
    const startsAt = recurrence
      ? new Date(recurrence.occurrences[0].startsAt)
      : new Date(newClassStartsAt);
    const endsAt = recurrence
      ? new Date(recurrence.occurrences[0].endsAt)
      : new Date(newClassEndsAt);

    if (
      !selectedCreateBranchId ||
      !selectedCoachId ||
      !newClassName.trim() ||
      (newClassScheduleMode === "weekly" && !recurrence) ||
      !Number.isInteger(capacity) ||
      Number.isNaN(startsAt.getTime()) ||
      Number.isNaN(endsAt.getTime())
    ) {
      return;
    }

    setClassCreatePending(true);
    setClassCreateFeedback(null);

    const created = await createClassSession(selectedCreateBranchId, {
      name: newClassName.trim(),
      level: newClassLevel.trim() || "입문-초급",
      ageGroup: newClassAgeGroup,
      coachId: selectedCoachId,
      startsAt: startsAt.toISOString(),
      endsAt: endsAt.toISOString(),
      room: newClassRoom.trim() || "매트 A",
      capacity,
      enrolledMemberIds: newClassMemberIds,
      ...(recurrence ? { recurrence: recurrence.recurrence } : {}),
    });

    setClassCreatePending(false);

    if (!created) {
      return;
    }

    const createdCount = recurrence?.occurrences.length ?? 1;
    setClassCreateFeedback(
      newClassScheduleMode === "weekly"
        ? `${createdCount}회의 요일 고정 수업을 등록했습니다.`
        : "수업을 등록했습니다.",
    );
    setNewClassName("");
    setNewClassMemberIds([]);
  }

  function toggleNewClassWeekday(weekday: number) {
    setClassCreateFeedback(null);
    setNewClassWeekdays((current) =>
      current.includes(weekday) ? current.filter((value) => value !== weekday) : [...current, weekday].sort(),
    );
  }

  function keepAvailableMainWeekdays(option: (typeof finalMainClassTimeOptions)[number] | null) {
    if (!option) {
      return;
    }

    setNewClassWeekdays((current) => {
      const available = current.filter((weekday) => option.weekdays.includes(weekday));
      return available.length > 0 ? available : [option.weekdays[0] ?? 1];
    });
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

    void updateClassSession(session.id, {
      room: edit.room.trim(),
      capacity,
    });
  }

  async function handleClassRegistration(classId: string, operation: "register" | "cancel") {
    if (!selectedRegistrationMemberId || classRegistrationPendingId) {
      return;
    }

    setClassRegistrationPendingId(classId);
    setClassRegistrationFeedback(null);
    const result = operation === "register"
      ? await registerForClass(classId, selectedRegistrationMemberId)
      : await cancelClassRegistration(classId, selectedRegistrationMemberId);
    setClassRegistrationFeedback(result.message);
    setClassRegistrationPendingId(null);
    reloadRegistration();
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
    setReasonSavedKey(null);
  }

  function handleAttendanceSelect(
    session: EnrichedClassSession,
    member: Member,
    previousRecord: AttendanceRecord | undefined,
    nextStatus: AttendanceStatus,
    noteValue: string,
  ) {
    if (!hasAttendanceWindowOpened(session.startsAt)) {
      return;
    }

    if (previousRecord?.status !== nextStatus) {
      setLastAttendanceBatchChange(null);
      setLastAttendanceChange({
        sessionId: session.id,
        memberId: member.id,
        sessionName: session.name,
        memberName: member.name,
        previousStatus: previousRecord?.status ?? null,
        previousNote: previousRecord?.note ?? "",
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

    if (lastAttendanceChange.previousStatus) {
      markAttendance(
        lastAttendanceChange.sessionId,
        lastAttendanceChange.memberId,
        lastAttendanceChange.previousStatus,
        lastAttendanceChange.previousNote,
      );
    } else {
      clearAttendance(lastAttendanceChange.sessionId, lastAttendanceChange.memberId);
    }
    setLastAttendanceChange(null);
  }

  function requestSessionAttendanceConfirmation(session: EnrichedClassSession) {
    if (!hasAttendanceWindowOpened(session.startsAt)) {
      return;
    }

    const changes = session.enrolledMembers.flatMap((member) => {
      const previousRecord = getAttendanceRecord(session, member.id);

      if (previousRecord?.status === "present") {
        return [];
      }

      return [{
        memberId: member.id,
        memberName: member.name,
        previousStatus: previousRecord?.status ?? null,
        previousNote: previousRecord?.note ?? "",
      }];
    });

    if (changes.length === 0) {
      return;
    }

    setAttendanceBatchConfirmation({
      sessionId: session.id,
      sessionName: session.name,
      changes,
      alreadyPresentCount: session.enrolledMemberIds.length - changes.length,
      changedAt: new Date().toISOString(),
    });
  }

  function confirmSessionAttendance() {
    if (!attendanceBatchConfirmation || attendanceSyncPending) {
      return;
    }

    setLastAttendanceChange(null);
    setLastAttendanceBatchChange(attendanceBatchConfirmation);
    markSessionAttendance(
      attendanceBatchConfirmation.sessionId,
      attendanceBatchConfirmation.changes.map((change) => change.memberId),
      "present",
    );
    setAttendanceBatchConfirmation(null);
  }

  function handleUndoLastAttendanceBatchChange() {
    if (!lastAttendanceBatchChange || attendanceSyncPending) {
      return;
    }

    const snapshot = lastAttendanceBatchChange;
    setLastAttendanceBatchChange(null);
    setLastAttendanceChange(null);

    for (const change of snapshot.changes) {
      if (change.previousStatus) {
        markAttendance(
          snapshot.sessionId,
          change.memberId,
          change.previousStatus,
          change.previousNote,
        );
      } else {
        clearAttendance(snapshot.sessionId, change.memberId);
      }
    }
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

  const selectedFamilyMemberIds =
    context.user.role === "guardian"
      ? selectedChildId
        ? [selectedChildId]
        : []
      : context.user.role === "member"
        ? context.user.memberIds ?? []
        : [];
  const selectedFamilyMemberIdSet = new Set(selectedFamilyMemberIds);
  const scopedSessions = isFamilyRole
    ? data
        .filter((session) => session.enrolledMemberIds.some((memberId) => selectedFamilyMemberIdSet.has(memberId)))
        .map((session) => ({
          ...session,
          attendance: session.attendance.filter((record) => selectedFamilyMemberIdSet.has(record.memberId)),
          enrolledMemberIds: session.enrolledMemberIds.filter((memberId) => selectedFamilyMemberIdSet.has(memberId)),
          enrolledMembers: session.enrolledMembers.filter((member) => selectedFamilyMemberIdSet.has(member.id)),
        }))
    : data;
  const todayDateKey = formatDateKey(new Date());
  const familySortedSessions = isFamilyRole ? sortFamilyClassSessions(scopedSessions, screenReferenceTime) : scopedSessions;
  const visibleSessions = isCoachRole
    ? scopedSessions
        .filter((session) => formatDateKey(session.startsAt) === todayDateKey)
        .sort((left, right) => {
          const completionOrder = Number(getAttendanceProgress(left).uncheckedCount === 0)
            - Number(getAttendanceProgress(right).uncheckedCount === 0);

          return completionOrder || left.startsAt.localeCompare(right.startsAt);
        })
    : familySortedSessions;
  const familySessionsByDate = new Map<string, EnrichedClassSession[]>();
  for (const session of visibleSessions) {
    const dateKey = formatDateKey(session.startsAt);
    familySessionsByDate.set(dateKey, [...(familySessionsByDate.get(dateKey) ?? []), session]);
  }
  const familyMonthDateKeys = [...familySessionsByDate.keys()]
    .filter((dateKey) => dateKey.startsWith(`${familyCalendarMonth}-`))
    .sort();
  const relevantRegistrationOptions = (registrationData?.options ?? []).filter(
    (option) => Date.parse(option.startsAt) > screenReferenceTime && (option.isEnrolled || option.canRegister),
  );
  const registrationDateKeys = [
    ...new Set(relevantRegistrationOptions.map((option) => formatDateKey(option.startsAt))),
  ].sort();
  const familyTournaments =
    isFamilyRole && selectedRegistrationMember
      ? (context.db.tournaments ?? []).filter((tournament) =>
          canViewTournament(tournament, [selectedRegistrationMember.branchId]),
        )
      : [];
  const familyTournamentDateKeys = [
    ...new Set(
      familyTournaments
        .flatMap(getTournamentDateKeys)
        .filter((dateKey) => dateKey.startsWith(`${familyCalendarMonth}-`)),
    ),
  ].sort();
  const familySelectableDateKeys = [
    ...new Set([...familyMonthDateKeys, ...registrationDateKeys, ...familyTournamentDateKeys]),
  ];
  const activeFamilyDateKey =
    selectedFamilyDateKey && familySelectableDateKeys.includes(selectedFamilyDateKey)
      ? selectedFamilyDateKey
      : null;
  const familySelectedDateSessions = activeFamilyDateKey ? familySessionsByDate.get(activeFamilyDateKey) ?? [] : [];
  const selectedDateRegistrationOptions = activeFamilyDateKey
    ? relevantRegistrationOptions.filter((option) => formatDateKey(option.startsAt) === activeFamilyDateKey)
    : [];
  const selectedDateUsesRegistrationPanel = selectedDateRegistrationOptions.length > 0;
  const renderedSessions = isFamilyRole
    ? selectedDateUsesRegistrationPanel
      ? []
      : familySelectedDateSessions
    : visibleSessions;
  const hasFamilyCalendarContent =
    visibleSessions.length > 0 ||
    registrationDateKeys.length > 0 ||
    familyTournamentDateKeys.length > 0 ||
    registrationLoading;
  const otherDateCoachSessions = isCoachRole
    ? scopedSessions.filter((session) => formatDateKey(session.startsAt) !== todayDateKey)
    : [];
  const childSwitcherItems = guardianChildren.map((member) => ({
    id: member.id,
    name: member.name,
    relationLabel: getFamilyMemberRelationLabel(getGuardianMemberRelation(context.user, member)),
    ...getChildSwitcherPresentation(member),
  }));
  const totalEnrolled = visibleSessions.reduce((sum, session) => sum + session.enrolledMembers.length, 0);
  const totalChecked = visibleSessions.reduce((sum, session) => sum + getAttendanceProgress(session).checkedCount, 0);
  const totalUnchecked = Math.max(totalEnrolled - totalChecked, 0);
  const totalCheckedPercent = totalEnrolled > 0 ? Math.round((totalChecked / totalEnrolled) * 100) : 0;
  const attendanceSearchTerm = normalizeAttendanceSearch(attendanceSearch);
  const reasonRequiredCount = visibleSessions.reduce((sum, session) => sum + session.attendance.filter(needsAttendanceReason).length, 0);
  const filteredRosterCount = visibleSessions.reduce(
    (sum, session) =>
      sum + getVisibleAttendanceMembers(session, showUncheckedOnly, showReasonRequiredOnly, attendanceSearchTerm, attendanceStatusFilter).length,
    0,
  );
  const hasAttendanceRosterFilter = showUncheckedOnly || showReasonRequiredOnly || Boolean(attendanceSearchTerm) || attendanceStatusFilter !== "all";
  const coachClassMobileVisibleLimit = 1;
  const coachClassListCollapsible = isCoachRole && !hasAttendanceRosterFilter && visibleSessions.length > coachClassMobileVisibleLimit;
  const hiddenCoachClassCount = coachClassListCollapsible ? visibleSessions.length - coachClassMobileVisibleLimit : 0;
  const defaultOpenCoachClassId =
    hasAttendanceRosterFilter
      ? visibleSessions.find((session) => getVisibleAttendanceMembers(session, showUncheckedOnly, showReasonRequiredOnly, attendanceSearchTerm, attendanceStatusFilter).length > 0)?.id ?? null
      : visibleSessions.find((session) => getAttendanceProgress(session).uncheckedCount > 0)?.id ?? null;
  const attendanceCounts = attendanceSummaryLabels.map(({ status, label }) => ({
    status,
    label,
    count: visibleSessions.reduce(
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
  const attendanceSyncFailed = attendanceSync.status === "failed";
  const shouldShowMobileSaveStatusPanel =
    canEditAttendance &&
    (hasPendingAttendance || attendanceSyncPending || attendanceSyncFailed || Boolean(lastAttendanceChange) || Boolean(lastAttendanceBatchChange));
  const coachVisibleMembers = Array.from(
    new Map(visibleSessions.flatMap((session) => session.enrolledMembers.map((member) => [member.id, member]))).values(),
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
  const coachReasonRequiredRecords = visibleSessions.flatMap((session) =>
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
    `명단 ${totalEnrolled}`,
    `주의 ${coachAttentionMemberCount}`,
  ].join(" · ");
  const coachPostClassFlowSummary = [
    `미처리 ${totalUnchecked}`,
    hasPendingAttendance ? `저장 ${attendanceSync.pendingCount}` : "저장됨",
  ].join(" · ");

  return (
    <div className={`relative ${canEditAttendance ? "pb-36 lg:pb-0" : ""}`}>
      {showClassesScreenHeader ? <SectionHeader title="수업/출석" /> : null}

      {attendanceBatchConfirmation ? (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/45 p-3 sm:items-center"
          data-testid="attendance-bulk-confirm-overlay"
          role="presentation"
          onMouseDown={(event) => {
            if (event.currentTarget === event.target) {
              setAttendanceBatchConfirmation(null);
            }
          }}
        >
          <section
            aria-describedby="attendance-bulk-confirm-description"
            aria-labelledby="attendance-bulk-confirm-title"
            aria-modal="true"
            className="w-full max-w-md rounded-lg bg-white p-4 shadow-xl"
            data-testid="attendance-bulk-confirm-dialog"
            role="dialog"
          >
            <div className="flex items-start gap-3">
              <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-emerald-50 text-emerald-700">
                <CheckCheck className="h-5 w-5" aria-hidden />
              </span>
              <div className="min-w-0">
                <h2 className="text-base font-semibold text-zinc-950" id="attendance-bulk-confirm-title">
                  전체 출석을 적용할까요?
                </h2>
                <p className="mt-1 text-sm text-zinc-600" id="attendance-bulk-confirm-description">
                  {attendanceBatchConfirmation.sessionName}의 {attendanceBatchConfirmation.changes.length}명을 출석으로 변경합니다.
                </p>
              </div>
            </div>
            <dl className="mt-4 grid grid-cols-2 gap-2 text-sm" data-testid="attendance-bulk-confirm-impact">
              <div className="rounded-md bg-emerald-50 px-3 py-2">
                <dt className="text-xs font-medium text-emerald-700">변경 인원</dt>
                <dd className="mt-0.5 font-semibold text-emerald-950">{attendanceBatchConfirmation.changes.length}명</dd>
              </div>
              <div className="rounded-md bg-zinc-50 px-3 py-2">
                <dt className="text-xs font-medium text-zinc-500">기존 출석 유지</dt>
                <dd className="mt-0.5 font-semibold text-zinc-950">{attendanceBatchConfirmation.alreadyPresentCount}명</dd>
              </div>
            </dl>
            {attendanceBatchConfirmation.changes.some((change) => change.previousStatus) ? (
              <p className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-medium text-amber-900">
                지각·결석·사유 상태도 출석으로 바뀌며, 실행 후 한 번에 되돌릴 수 있습니다.
              </p>
            ) : (
              <p className="mt-3 text-sm text-zinc-600">미처리 인원만 변경되며 기존 출석 기록은 유지됩니다.</p>
            )}
            <div className="mt-4 grid grid-cols-2 gap-2">
              <button
                autoFocus
                className="inline-flex min-h-11 items-center justify-center rounded-md border border-zinc-200 bg-white px-3 text-sm font-semibold text-zinc-700 transition hover:bg-zinc-50"
                data-testid="attendance-bulk-confirm-cancel"
                type="button"
                onClick={() => setAttendanceBatchConfirmation(null)}
              >
                취소
              </button>
              <button
                className="inline-flex min-h-11 items-center justify-center rounded-md bg-emerald-700 px-3 text-sm font-semibold text-white transition hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-60"
                data-testid="attendance-bulk-confirm-submit"
                disabled={attendanceSyncPending}
                type="button"
                onClick={confirmSessionAttendance}
              >
                {attendanceBatchConfirmation.changes.length}명 출석 처리
              </button>
            </div>
          </section>
        </div>
      ) : null}

      {context.user.role === "guardian" ? (
        <ChildSwitcher
          items={childSwitcherItems}
          selectedChildId={selectedChildId}
          onSelect={(memberId) => {
            setSelectedChildId(memberId);
            setFamilyCalendarMonth(formatDateKey(new Date()).slice(0, 7));
            setSelectedFamilyDateKey(null);
          }}
        />
      ) : null}

      {canManageClasses ? (
        <section className="mb-3 rounded-lg border border-zinc-200 bg-white p-3" data-testid="class-create-panel">
          <div className="flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-2">
              <CalendarPlus className="h-4 w-4 shrink-0 text-teal-700" aria-hidden />
              <h2 className="min-w-0 truncate text-base font-semibold text-zinc-950">수업 생성</h2>
            </div>
            <Button
              aria-controls="class-create-dialog"
              aria-expanded={classCreateFormOpen}
              data-testid="class-create-toggle"
              size="lg"
              type="button"
              variant="secondary"
              onClick={() => setClassCreateFormOpen(true)}
            >
              열기
            </Button>
          </div>
          {classCreateFormOpen ? (
            <div
              className="fixed inset-0 z-50 flex items-end justify-center bg-zinc-950/55 p-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] sm:items-center"
              data-testid="class-create-overlay"
              role="presentation"
              onMouseDown={(event) => {
                if (event.currentTarget === event.target && !classCreatePending) {
                  setClassCreateFormOpen(false);
                }
              }}
            >
              <section
                aria-labelledby="class-create-title"
                aria-modal="true"
                className="max-h-[calc(100dvh-1.5rem-env(safe-area-inset-top)-env(safe-area-inset-bottom))] w-full max-w-3xl overflow-y-auto rounded-lg bg-white shadow-xl"
                data-testid="class-create-dialog"
                id="class-create-dialog"
                role="dialog"
              >
                <div className="sticky top-0 z-10 flex items-start justify-between gap-3 border-b border-zinc-200 bg-white px-4 py-4">
                  <div className="min-w-0">
                    <h2 className="text-lg font-semibold text-zinc-950" id="class-create-title">
                      수업 생성
                    </h2>
                    <p className="mt-1 text-sm text-zinc-600">수업 일정과 담당 코치, 참여 회원을 등록합니다.</p>
                  </div>
                  <button
                    aria-label="수업 생성 창 닫기"
                    className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-md border border-zinc-200 text-zinc-600 transition hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-50"
                    data-testid="class-create-close"
                    disabled={classCreatePending}
                    type="button"
                    onClick={() => setClassCreateFormOpen(false)}
                  >
                    <X className="h-5 w-5" aria-hidden />
                  </button>
                </div>
                <form
                  className="grid gap-3 p-4 lg:grid-cols-[0.9fr_1.2fr_0.8fr_0.8fr_0.8fr_0.8fr]"
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
                      const nextBranchId = event.target.value;
                      const nextBranch = context.db.branches.find((branch) => branch.id === nextBranchId);
                      setNewClassBranchId(nextBranchId);
                      setNewClassCoachId("");
                      setNewClassMemberIds([]);
                      setClassCreateFeedback(null);
                      if (newClassScheduleMode === "weekly" && isFinalMainBranch(nextBranch)) {
                        keepAvailableMainWeekdays(selectedMainTimeOption);
                      }
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
                  maxLength={classInputLimits.nameLength}
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
                  data-class-create-control="age-group"
                  value={newClassAgeGroup}
                  onChange={(event) => setNewClassAgeGroup(event.target.value as ClassSession["ageGroup"])}
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
                  maxLength={classInputLimits.levelLength}
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
              <fieldset className="lg:col-span-2">
                <legend className="mb-1 block text-xs font-semibold text-zinc-500">등록 방식</legend>
                <div className="grid grid-cols-2 rounded-md border border-zinc-200 bg-zinc-50 p-1" data-testid="class-create-schedule-mode">
                  {([
                    { label: "1회 등록", value: "single" },
                    { label: "요일 고정", value: "weekly" },
                  ] as const).map((option) => (
                    <button
                      aria-pressed={newClassScheduleMode === option.value}
                      className={`min-h-11 rounded-md px-3 text-sm font-semibold transition ${
                        newClassScheduleMode === option.value
                          ? "bg-zinc-950 text-white shadow-sm"
                          : "text-zinc-600 hover:bg-white"
                      }`}
                      data-testid={`class-create-mode-${option.value}`}
                      key={option.value}
                      type="button"
                      onClick={() => {
                        setNewClassScheduleMode(option.value);
                        setClassCreateFeedback(null);
                        if (option.value === "weekly" && usesFinalMainSchedule) {
                          keepAvailableMainWeekdays(selectedMainTimeOption);
                        }
                      }}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </fieldset>
              {newClassScheduleMode === "single" ? (
                <>
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
                        setClassCreateFeedback(null);
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
                      onChange={(event) => {
                        setNewClassEndsAt(event.target.value);
                        setClassCreateFeedback(null);
                      }}
                    />
                  </label>
                </>
              ) : (
                <>
                  <label>
                    <span className="mb-1 block text-xs font-semibold text-zinc-500">시작일</span>
                    <input
                      className="h-11 w-full rounded-md border border-zinc-200 bg-white px-3 text-sm outline-none transition focus:border-teal-500"
                      data-testid="class-create-field"
                      type="date"
                      value={newClassRepeatStartsOn}
                      onChange={(event) => {
                        const nextStart = event.target.value;
                        setNewClassRepeatStartsOn(nextStart);
                        if (newClassRepeatEndsOn < nextStart) {
                          setNewClassRepeatEndsOn(addDaysToDateKey(nextStart, 27));
                        }
                        setClassCreateFeedback(null);
                      }}
                    />
                  </label>
                  <label>
                    <span className="mb-1 block text-xs font-semibold text-zinc-500">종료일</span>
                    <input
                      className="h-11 w-full rounded-md border border-zinc-200 bg-white px-3 text-sm outline-none transition focus:border-teal-500"
                      data-testid="class-create-field"
                      min={newClassRepeatStartsOn}
                      type="date"
                      value={newClassRepeatEndsOn}
                      onChange={(event) => {
                        setNewClassRepeatEndsOn(event.target.value);
                        setClassCreateFeedback(null);
                      }}
                    />
                  </label>
                  {usesFinalMainSchedule ? (
                    <label className="lg:col-span-2">
                      <span className="mb-1 block text-xs font-semibold text-zinc-500">본관 시간표</span>
                      <select
                        className="h-11 w-full rounded-md border border-zinc-200 bg-white px-3 text-sm outline-none transition focus:border-teal-500"
                        data-testid="class-create-main-schedule"
                        value={selectedMainTimeOption?.value ?? ""}
                        onChange={(event) => {
                          const nextTimeKey = event.target.value;
                          const nextTimeOption = finalMainClassTimeOptions.find((option) => option.value === nextTimeKey) ?? null;
                          setNewClassMainTimeKey(nextTimeKey);
                          keepAvailableMainWeekdays(nextTimeOption);
                          setClassCreateFeedback(null);
                        }}
                      >
                        {finalMainClassTimeOptions.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </label>
                  ) : (
                    <>
                      <label>
                        <span className="mb-1 block text-xs font-semibold text-zinc-500">고정 시작</span>
                        <input
                          className="h-11 w-full rounded-md border border-zinc-200 bg-white px-3 text-sm outline-none transition focus:border-teal-500"
                          data-testid="class-create-field"
                          type="time"
                          value={newClassFixedStartTime}
                          onChange={(event) => {
                            setNewClassFixedStartTime(event.target.value);
                            setClassCreateFeedback(null);
                          }}
                        />
                      </label>
                      <label>
                        <span className="mb-1 block text-xs font-semibold text-zinc-500">고정 종료</span>
                        <input
                          className="h-11 w-full rounded-md border border-zinc-200 bg-white px-3 text-sm outline-none transition focus:border-teal-500"
                          data-testid="class-create-field"
                          type="time"
                          value={newClassFixedEndTime}
                          onChange={(event) => {
                            setNewClassFixedEndTime(event.target.value);
                            setClassCreateFeedback(null);
                          }}
                        />
                      </label>
                    </>
                  )}
                  <fieldset className="lg:col-span-3" data-testid="class-create-weekdays">
                    <legend className="mb-1 block text-xs font-semibold text-zinc-500">반복 요일</legend>
                    <div className="grid grid-cols-7 gap-1">
                      {classWeekdayOptions.map((option) => {
                        const unavailable = Boolean(
                          usesFinalMainSchedule &&
                            selectedMainTimeOption &&
                            !selectedMainTimeOption.weekdays.includes(option.value),
                        );
                        const selected = newClassWeekdays.includes(option.value);

                        return (
                          <button
                            aria-label={`${option.label}요일`}
                            aria-pressed={selected}
                            className={`min-h-11 rounded-md border text-sm font-bold transition ${
                              selected
                                ? "border-teal-700 bg-teal-700 text-white"
                                : "border-zinc-200 bg-white text-zinc-600 hover:border-zinc-300"
                            } disabled:cursor-not-allowed disabled:bg-zinc-100 disabled:text-zinc-300`}
                            data-testid="class-create-weekday"
                            disabled={unavailable}
                            key={option.value}
                            type="button"
                            onClick={() => toggleNewClassWeekday(option.value)}
                          >
                            {option.label}
                          </button>
                        );
                      })}
                    </div>
                  </fieldset>
                  <div className="lg:col-span-3" aria-live="polite">
                    {classRecurrenceError ? (
                      <p className="text-sm font-medium text-red-700" role="alert">{classRecurrenceError}</p>
                    ) : (
                      <p className="text-sm font-medium text-teal-700">선택한 기간에 {recurringClassCount}회 수업을 등록합니다.</p>
                    )}
                  </div>
                </>
              )}
              <label>
                <span className="mb-1 block text-xs font-semibold text-zinc-500">장소</span>
                <input
                  className="h-11 w-full rounded-md border border-zinc-200 bg-white px-3 text-sm outline-none transition focus:border-teal-500"
                  data-testid="class-create-field"
                  maxLength={classInputLimits.roomLength}
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
                disabled={
                  classCreatePending ||
                  !selectedCreateBranchId ||
                  !selectedCoachId ||
                  !newClassName.trim() ||
                  (newClassScheduleMode === "weekly" && recurringClassCount === 0)
                }
                type="submit"
              >
                {classCreatePending
                  ? "등록 중"
                  : newClassScheduleMode === "weekly"
                    ? `${recurringClassCount}회 등록`
                    : "등록"}
              </button>
              {classCreateFeedback ? (
                <p className="self-center text-sm font-medium text-emerald-700 lg:col-span-2" data-testid="class-create-feedback" role="status">
                  {classCreateFeedback}
                </p>
              ) : null}
                </form>
              </section>
            </div>
          ) : null}
        </section>
      ) : null}

      {!isFamilyRole && visibleSessions.length === 0 ? (
        <EmptyState title="예정 수업이 없습니다" />
      ) : (
        <>
          {isFamilyRole && hasFamilyCalendarContent ? (
            <FamilyClassCalendar
              availableDateKeys={registrationDateKeys}
              monthKey={familyCalendarMonth}
              referenceTime={screenReferenceTime}
              selectedDateKey={activeFamilyDateKey}
              sessions={visibleSessions}
              tournaments={familyTournaments}
              onMonthChange={(monthKey) => {
                setFamilyCalendarMonth(monthKey);
                setSelectedFamilyDateKey(null);
              }}
              onSelectDate={(dateKey) => {
                setSelectedFamilyDateKey((current) => current === dateKey ? null : dateKey);
                setClassRegistrationFeedback(null);
              }}
            />
          ) : null}
          {isFamilyRole && !hasFamilyCalendarContent ? <EmptyState title="등록된 수업이 없습니다" /> : null}
          {isFamilyRole && activeFamilyDateKey && selectedRegistrationMember && selectedDateUsesRegistrationPanel ? (
            <ClassRegistrationPanel
              error={registrationError}
              feedback={classRegistrationFeedback}
              loading={registrationLoading}
              memberName={selectedRegistrationMember.name}
              options={selectedDateRegistrationOptions}
              pendingClassId={classRegistrationPendingId}
              selectedDateKey={activeFamilyDateKey}
              onCancel={(classId) => void handleClassRegistration(classId, "cancel")}
              onRegister={(classId) => void handleClassRegistration(classId, "register")}
              onRetry={reloadRegistration}
            />
          ) : null}
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
                      {lastAttendanceChange.previousStatus
                        ? `${attendanceStatusLabels[lastAttendanceChange.previousStatus]}로 되돌리기`
                        : "미처리로 되돌리기"}
	                    </button>
	                  </div>
		                ) : null}
		                {lastAttendanceBatchChange ? (
		                  <div
		                    className="flex min-h-11 flex-wrap items-center gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-950"
		                    data-testid="attendance-bulk-undo-panel"
		                  >
		                    <span className="font-semibold">
		                      일괄 변경: {lastAttendanceBatchChange.sessionName} · {lastAttendanceBatchChange.changes.length}명
		                    </span>
		                    <button
		                      className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md border border-emerald-300 bg-white px-3 text-sm font-semibold text-emerald-800 transition hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-60"
		                      data-testid="attendance-bulk-undo"
		                      disabled={attendanceSyncPending}
		                      type="button"
		                      onClick={handleUndoLastAttendanceBatchChange}
		                    >
		                      <Undo2 className="h-4 w-4" aria-hidden />
		                      일괄 변경 되돌리기
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
            <div className="mb-2" data-testid="coach-mobile-tools">
              <button
                aria-controls="coach-mobile-tools-details"
                aria-expanded={coachToolsOpen}
                className="flex min-h-11 w-full items-center justify-between gap-2 rounded-md border border-zinc-200 bg-white px-3 text-left text-sm font-semibold text-zinc-800 transition hover:bg-zinc-50 sm:hidden"
                data-testid="coach-mobile-tools-toggle"
                type="button"
                onClick={() => setCoachToolsOpen((current) => !current)}
              >
                <span className="inline-flex min-w-0 items-center gap-2">
                  <ClipboardList className="h-4 w-4 shrink-0 text-teal-700" aria-hidden />
                  <span className="truncate">출석 보조 도구</span>
                </span>
                <span className="inline-flex shrink-0 items-center gap-1 text-xs font-semibold text-teal-800">
                  미처리 {totalUnchecked} · 사유 {coachReasonRequiredRecords.length}
                  <ChevronDown className={`h-4 w-4 transition-transform ${coachToolsOpen ? "rotate-180" : ""}`} aria-hidden />
                </span>
              </button>
              <div
                className={`${coachToolsOpen ? "grid" : "hidden"} gap-2 pt-2 sm:grid sm:pt-0`}
                data-testid="coach-mobile-tools-details"
                id="coach-mobile-tools-details"
              >
              <section
                aria-label="빠른 조치"
                className="rounded-lg border border-teal-200 bg-teal-50/40 p-0.5 sm:p-2"
                data-testid="coach-mobile-speed-panel"
              >
                <p className="sr-only" data-testid="coach-mobile-speed-summary-line">
                  {coachMobileSpeedSummaryText}
                </p>
                <div className="flex gap-1 overflow-x-auto sm:flex-wrap sm:gap-2">
	                  <button
                    aria-label="미처리 명단만 보기"
                    aria-pressed={showUncheckedOnly}
                    className={`${coachQuickActionClass(showUncheckedOnly)} shrink-0 sm:shrink`}
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
                    className={`${coachQuickActionClass(showReasonRequiredOnly, "amber")} shrink-0 sm:shrink`}
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
                    className={`${coachQuickActionClass(coachAttentionFilterActive)} shrink-0 sm:shrink`}
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
                      className="inline-flex min-h-11 shrink-0 items-center justify-center gap-1 rounded-md border border-zinc-200 bg-white px-2 text-[11px] font-semibold text-zinc-700 transition hover:border-zinc-300 hover:bg-zinc-50 sm:w-auto sm:gap-2 sm:px-3 sm:text-sm"
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
                className="rounded-lg border border-zinc-200 bg-white px-2 py-0.5"
                data-testid="coach-field-flow-panel"
              >
                <div className="flex min-h-11 items-center justify-between gap-2 px-1 text-sm font-semibold text-zinc-800">
                  <span className="inline-flex min-w-0 items-center gap-2">
                    <ClipboardList className="h-4 w-4 shrink-0 text-teal-700" aria-hidden />
                    <span className="truncate">수업 진행</span>
                  </span>
                  <span className="shrink-0 text-xs font-semibold text-teal-800">{totalCheckedPercent}% 완료</span>
                </div>
                <div
                  className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)_minmax(0,1fr)] items-stretch gap-1"
                  data-testid="coach-field-flow-compact-grid"
                >
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
              </div>
            </div>
          ) : null}

          {isFamilyRole && !selectedDateUsesRegistrationPanel ? (
            activeFamilyDateKey && familySelectedDateSessions.length > 0 ? (
              <div className="mb-2 flex items-end justify-between gap-3" data-testid="family-selected-date-heading">
                <div className="min-w-0">
                  <h2 className="text-base font-semibold text-zinc-950">{formatDate(`${activeFamilyDateKey}T12:00:00+09:00`)} 수업</h2>
                  <p className="mt-0.5 text-xs text-zinc-500">선택한 날짜의 출석 상태와 수업 정보</p>
                </div>
                <span className="shrink-0 text-xs font-semibold tabular-nums text-zinc-500">{familySelectedDateSessions.length}개</span>
              </div>
            ) : null
          ) : null}

          <div className={isFamilyRole ? "grid gap-3" : "grid gap-4"}>
            {renderedSessions.map((session, sessionIndex) => {
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
              const attendanceWindowOpen = hasAttendanceWindowOpened(session.startsAt, new Date(screenReferenceTime));
              const familySessionPast = isFamilyRole && isPastClassSession(session, screenReferenceTime);

		              return (
		              <Fragment key={session.id}>
		              <article
		                className={`rounded-lg border border-zinc-200 bg-white ${isFamilyRole ? "px-2.5 py-2" : isCoachRole ? "px-3 py-2" : "p-3"} ${
                    coachClassCollapsedOnMobile ? "hidden lg:block" : ""
                  }`}
                  data-coach-class-mobile-state={isCoachRole ? (coachClassCollapsedOnMobile ? "hidden" : "visible") : undefined}
		                data-family-class-period={isFamilyRole ? (familySessionPast ? "past" : "upcoming") : undefined}
		                data-testid={isFamilyRole ? `family-class-card-${session.id}` : isCoachRole ? `coach-class-card-${session.id}` : undefined}
			              >
		                <div
		                  className={
		                    isFamilyRole
		                      ? "flex flex-col gap-1.5 pb-1.5 sm:flex-row sm:items-start sm:justify-between"
		                      : isCoachRole
		                        ? "grid grid-cols-1 items-start gap-2 border-b border-zinc-100 pb-1.5 sm:grid-cols-[minmax(0,1fr)_11rem]"
		                        : "flex flex-col gap-2 border-b border-zinc-100 pb-3 sm:flex-row sm:items-start sm:justify-between"
		                  }
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
	                          ? "grid w-full grid-cols-2 items-stretch gap-1.5 sm:min-w-44 sm:max-w-48"
	                          : "grid w-full gap-1.5 sm:min-w-44 sm:max-w-48"
	                      }
                    >
                      <button
		                        aria-describedby={!attendanceWindowOpen ? `attendance-window-${session.id}` : undefined}
		                        className="inline-flex min-h-11 w-full items-center justify-center gap-1 rounded-md border border-emerald-300 bg-white px-1.5 text-xs font-semibold text-emerald-800 transition hover:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-60"
	                        disabled={!attendanceWindowOpen || allMemberIds.length === 0 || allPresent || attendanceSyncPending}
                        data-testid={`attendance-bulk-request-${session.id}`}
                        type="button"
                        onClick={() => requestSessionAttendanceConfirmation(session)}
	                      >
		                        <CheckCheck className="h-3.5 w-3.5 shrink-0" aria-hidden />
		                        <span className="whitespace-nowrap">{attendanceWindowOpen ? "전체 출석" : "출석 시작 전"}</span>
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
	                        <div className="mt-1 h-1.5 rounded-full bg-zinc-100">
	                          <div
	                            aria-label={`${session.name} 출석 처리율 ${attendanceProgress.checkedPercent}%`}
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
		                {canEditAttendance && !attendanceWindowOpen ? (
		                  <p className="sr-only" data-testid={`attendance-window-pending-${session.id}`} id={`attendance-window-${session.id}`}>
		                    수업 시작 후 출석을 처리할 수 있습니다.
		                  </p>
		                ) : null}

                {canManageClasses ? (
                  <>
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
                          maxLength={classInputLimits.roomLength}
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
                    <ClassRosterEditor
                      capacity={session.capacity}
                      classId={session.id}
                      enrolledMemberIds={session.enrolledMemberIds}
                      selectedBranchId={context.selectedBranchId}
                      onSave={(memberIds) => updateClassSession(session.id, { enrolledMemberIds: memberIds })}
                    />
                  </>
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
	                                          disabled={!attendanceWindowOpen || attendanceSyncPending}
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
	                                  disabled={!attendanceWindowOpen || attendanceSyncPending}
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
                                        maxLength={attendanceInputLimits.noteLength}
	                                      disabled={!attendanceWindowOpen || attendanceSyncPending}
                                        onChange={(event) => {
                                          setReasonSavedKey(null);
                                          setAttendanceNotes((current) => ({
                                            ...current,
                                            [attendanceNoteKey]: event.target.value,
                                          }));
                                        }}
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
	                                          disabled={!attendanceWindowOpen || attendanceSyncPending}
                                            key={preset.id}
                                            type="button"
                                            onClick={() => applyAttendanceNotePreset(attendanceNoteKey, noteValue, preset.label)}
                                          >
                                            {preset.label}
                                          </button>
                                        ))}
                                        <button
                                          className="inline-flex min-h-11 items-center justify-center rounded-md bg-zinc-900 px-3 text-xs font-semibold text-white transition hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-50"
                                          data-testid={`attendance-note-save-${session.id}-${member.id}`}
	                                        disabled={
	                                          !attendanceWindowOpen ||
	                                          attendanceSyncPending ||
	                                          !attendanceRecord ||
	                                          !noteValue.trim() ||
	                                          reasonSavingKey === attendanceNoteKey
	                                        }
                                          type="button"
                                          onClick={() => {
                                            if (!attendanceRecord) {
                                              return;
                                            }

                                            void handleSaveAttendanceReason(attendanceNoteKey, session.id, member.id, noteValue);
                                          }}
                                        >
                                          {!attendanceRecord
                                            ? "출석 선택 후 저장"
                                            : reasonSavingKey === attendanceNoteKey
                                              ? "저장 중..."
                                              : reasonSavedKey === attendanceNoteKey
                                                ? "사유 저장됨"
                                                : "사유 저장"}
                                        </button>
                                      </div>
                                    </div>
                                  ) : null}
                                  {isCoachRole && (status === "late" || status === "absent" || status === "excused" || member.alerts.length > 0) ? (
                                    <div className="mt-2 grid grid-cols-2 gap-2" data-testid={`attendance-follow-up-${session.id}-${member.id}`}>
                                      <Link
                                        className="inline-flex min-h-11 items-center justify-center rounded-md border border-zinc-200 bg-white px-2 text-xs font-semibold text-zinc-700 transition hover:border-teal-300 hover:bg-teal-50"
                                        href={`/app/members?memberId=${encodeURIComponent(member.id)}&q=${encodeURIComponent(member.name)}`}
                                      >
                                        회원 기록
                                      </Link>
                                      <Link
                                        className="inline-flex min-h-11 items-center justify-center rounded-md border border-teal-200 bg-teal-50 px-2 text-xs font-semibold text-teal-800 transition hover:bg-teal-100"
                                        href={`/app/notices?noticeCompose=1&noticeTarget=member&noticeTargetMemberId=${encodeURIComponent(member.id)}&noticeMemberSearch=${encodeURIComponent(member.name)}${member.ageGroup !== "adult" && member.guardianIds.length > 0 ? "&noticeAudience=guardian" : ""}`}
                                      >
                                        {member.ageGroup !== "adult" && member.guardianIds.length > 0 ? "보호자 안내" : "회원 안내"}
                                      </Link>
                                    </div>
                                  ) : null}
                                </div>
                              ) : (
                                <div className="flex flex-col items-start gap-1 sm:items-end">
                                  {status ? (
                                    <AttendanceStatusBadge status={status} />
                                  ) : (
                                    <span
                                      className={`inline-flex w-fit rounded-md border px-2 py-1 text-xs font-semibold ${
                                        familySessionPast
                                          ? "border-amber-200 bg-amber-50 text-amber-800"
                                          : "border-zinc-200 bg-zinc-50 text-zinc-600"
                                      }`}
                                      data-testid={`family-attendance-status-${session.id}-${member.id}`}
                                    >
                                      {familySessionPast ? "미기록 · 확인 필요" : "예정"}
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
                              <span
                                className={`inline-flex w-fit shrink-0 rounded-md border px-2 py-1 text-xs font-semibold ${
                                  familySessionPast
                                    ? "border-amber-200 bg-amber-50 text-amber-800"
                                    : "border-zinc-200 bg-white text-zinc-600"
                                }`}
                                data-testid={`family-attendance-status-${session.id}-${member.id}`}
                              >
                                {familySessionPast ? "미기록 · 확인 필요" : "예정"}
                              </span>
                            )}
                          </div>
                        </article>
                      );
                    })}
                  </div>
                )}
			              </article>
                    {sessionIndex === 0 && hiddenCoachClassCount > 0 ? (
                      <button
                        aria-expanded={coachClassListExpanded}
                        className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-md border border-zinc-200 bg-white px-3 text-sm font-semibold text-zinc-800 transition hover:bg-zinc-50 lg:hidden"
                        data-testid="coach-class-list-toggle"
                        type="button"
                        onClick={() => setCoachClassListExpanded((current) => !current)}
                      >
                        {coachClassListExpanded ? "추가 수업 접기" : `오늘 수업 ${hiddenCoachClassCount}개 더 보기`}
                      </button>
                    ) : null}
			              </Fragment>
              );
            })}
          </div>

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
                  <p className={`mt-0.5 truncate text-xs font-semibold ${attendanceSyncFailed ? "text-red-700" : hasPendingAttendance ? "text-amber-700" : "text-zinc-500"}`}>
                    {attendanceSyncFailed
                      ? `저장 실패 · ${attendanceSync.pendingCount}건 대기`
                      : hasPendingAttendance
                        ? `저장 대기 ${attendanceSync.pendingCount}건`
                        : "저장 대기 없음"} · 처리율 {totalCheckedPercent}%
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
                    {lastAttendanceChange.previousStatus
                      ? `${attendanceStatusLabels[lastAttendanceChange.previousStatus]}로 되돌리기`
                      : "미처리로 되돌리기"}
                  </button>
                </div>
              ) : null}
              {lastAttendanceBatchChange ? (
                <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2" data-testid="attendance-bulk-undo-panel-mobile">
                  <p className="min-w-0 truncate text-xs font-semibold text-emerald-800">
                    전체 출석 {lastAttendanceBatchChange.changes.length}명
                  </p>
                  <button
                    className="inline-flex min-h-11 items-center justify-center gap-1 rounded-md border border-emerald-300 bg-white px-2 text-xs font-semibold text-emerald-800 transition hover:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-60"
                    data-testid="attendance-bulk-undo-mobile"
                    disabled={attendanceSyncPending}
                    type="button"
                    onClick={handleUndoLastAttendanceBatchChange}
                  >
                    <Undo2 className="h-4 w-4" aria-hidden />
                    모두 되돌리기
                  </button>
                </div>
              ) : null}
            </div>
          ) : null}
        </>
      )}

      {otherDateCoachSessions.length > 0 ? (
        <section className="mt-4 rounded-lg border border-zinc-200 bg-white p-3" aria-labelledby="coach-other-date-classes-title">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <h2 className="text-sm font-semibold text-zinc-950" id="coach-other-date-classes-title">다른 날짜 수업</h2>
              <p className="mt-0.5 text-xs text-zinc-500">일정 확인만 가능 · {otherDateCoachSessions.length}개</p>
            </div>
            <button
              aria-controls="coach-other-date-classes-list"
              aria-expanded={otherDateClassesOpen}
              className="inline-flex min-h-11 shrink-0 items-center justify-center gap-1 rounded-md border border-zinc-200 bg-white px-3 text-sm font-semibold text-zinc-800 transition hover:bg-zinc-50"
              data-testid="coach-other-date-classes-toggle"
              type="button"
              onClick={() => setOtherDateClassesOpen((current) => !current)}
            >
              {otherDateClassesOpen ? <ChevronUp className="h-4 w-4" aria-hidden /> : <ChevronDown className="h-4 w-4" aria-hidden />}
              {otherDateClassesOpen ? "감추기" : "보기"}
            </button>
          </div>
          {otherDateClassesOpen ? (
            <div className="mt-2 divide-y divide-zinc-100" id="coach-other-date-classes-list">
              {otherDateCoachSessions.map((session) => (
                <article className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 py-2 first:pt-0 last:pb-0" key={session.id}>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-zinc-900">{session.name}</p>
                    <p className="mt-0.5 truncate text-xs text-zinc-500">{session.room} · {session.enrolledMemberIds.length}명</p>
                  </div>
                  <p className="shrink-0 text-right text-xs font-semibold text-zinc-700">
                    {formatDate(session.startsAt)} · {formatCompactTimeRange(session.startsAt, session.endsAt)}
                  </p>
                </article>
              ))}
            </div>
          ) : null}
        </section>
      ) : null}

      {activePolicyBranch && isFinalMainBranch(activePolicyBranch) ? (
        <FinalMainScheduleReference branchName={activePolicyBranch.name} />
      ) : null}
    </div>
  );
}
