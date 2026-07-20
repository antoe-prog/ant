import { NextRequest } from "next/server";
import type { AuditLog, ClassSession, Member } from "@/lib/domain";
import { getClassWeeklyRecurrence, type ClassWeeklyRecurrence } from "@/lib/class-recurrence";
import { getClassInputLimitError } from "@/lib/class-input-policy";
import { isFinalMainClassRegistrationSlot } from "@/lib/final-main-schedule-policy";
import { isFinalMainBranch } from "@/lib/final-main-policy";
import { getAccessibleBranchIds } from "@/lib/mock-api";
import { readServerDb, withServerDbLock, writeServerDb } from "@/server/db";
import { createBootstrapPayload, jsonError, jsonOk, requireSelectedBranchScope, requireSession } from "@/server/api";
import { createRuntimeId } from "@/server/runtime-id";

export const runtime = "nodejs";

const ageGroups: Member["ageGroup"][] = ["kids", "teen", "adult"];

type ClassBody = {
  name?: string;
  level?: string;
  ageGroup?: Member["ageGroup"];
  coachId?: string;
  startsAt?: string;
  endsAt?: string;
  room?: string;
  capacity?: number;
  enrolledMemberIds?: string[];
  recurrence?: unknown;
};

type ValidatedClassPayload =
  | { ok: false; error: string }
  | {
      ok: true;
      payload: {
        name: string;
        level: string;
        ageGroup: Member["ageGroup"];
        coachId: string;
        startsAt: string;
        endsAt: string;
        room: string;
        capacity: number;
        enrolledMemberIds: string[];
        recurrence: ClassWeeklyRecurrence | null;
        occurrences: Array<{ startsAt: string; endsAt: string; weekday: number }>;
      };
    };

function isValidDateTime(value: string | undefined) {
  return Boolean(value && !Number.isNaN(Date.parse(value)));
}

function getClassBodyTypeError(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return "수업 정보가 올바른 JSON 객체가 아닙니다.";
  }

  const body = value as Record<string, unknown>;

  for (const [field, label] of [
    ["name", "수업명"],
    ["level", "레벨"],
    ["ageGroup", "연령 그룹"],
    ["coachId", "코치"],
    ["startsAt", "시작 시간"],
    ["endsAt", "종료 시간"],
    ["room", "장소"],
  ] as const) {
    if (body[field] !== undefined && typeof body[field] !== "string") {
      return `${label} 값의 형식이 올바르지 않습니다.`;
    }
  }

  if (body.capacity !== undefined && typeof body.capacity !== "number") {
    return "정원 값의 형식이 올바르지 않습니다.";
  }

  if (
    body.enrolledMemberIds !== undefined &&
    (!Array.isArray(body.enrolledMemberIds) || body.enrolledMemberIds.some((memberId) => typeof memberId !== "string"))
  ) {
    return "등록 회원 목록의 형식이 올바르지 않습니다.";
  }

  return null;
}

function getValidatedClassPayload(value: unknown): ValidatedClassPayload {
  const bodyTypeError = getClassBodyTypeError(value);

  if (bodyTypeError) {
    return { ok: false, error: bodyTypeError };
  }

  const inputLimitError = getClassInputLimitError(value as Record<string, unknown>);

  if (inputLimitError) {
    return { ok: false, error: inputLimitError };
  }

  const body = value as ClassBody;
  const recurrenceResult = body.recurrence === undefined ? null : getClassWeeklyRecurrence(body.recurrence);

  if (recurrenceResult && !recurrenceResult.ok) {
    return { ok: false, error: recurrenceResult.error };
  }

  if (
    !body?.name?.trim() ||
    !body.level?.trim() ||
    !body.coachId?.trim() ||
    (!recurrenceResult && (!body.startsAt || !body.endsAt)) ||
    !body.room?.trim()
  ) {
    return { ok: false, error: "수업명, 레벨, 코치, 시간, 장소가 필요합니다." };
  }

  if (!body.ageGroup || !ageGroups.includes(body.ageGroup)) {
    return { ok: false, error: "연령 그룹이 올바르지 않습니다." };
  }

  const firstOccurrence = recurrenceResult?.ok ? recurrenceResult.occurrences[0] : null;
  const startsAt = firstOccurrence?.startsAt ?? body.startsAt;
  const endsAt = firstOccurrence?.endsAt ?? body.endsAt;

  if (!startsAt || !endsAt || !isValidDateTime(startsAt) || !isValidDateTime(endsAt)) {
    return { ok: false, error: "수업 시간이 올바르지 않습니다." };
  }

  if (new Date(endsAt).getTime() <= new Date(startsAt).getTime()) {
    return { ok: false, error: "종료 시간은 시작 시간보다 늦어야 합니다." };
  }

  const capacity = body.capacity;

  if (typeof capacity !== "number" || !Number.isInteger(capacity) || capacity < 1 || capacity > 80) {
    return { ok: false, error: "정원은 1명 이상 80명 이하의 정수여야 합니다." };
  }

  return {
    ok: true,
    payload: {
      name: body.name.trim(),
      level: body.level.trim(),
      ageGroup: body.ageGroup,
      coachId: body.coachId.trim(),
      startsAt: new Date(startsAt).toISOString(),
      endsAt: new Date(endsAt).toISOString(),
      room: body.room.trim(),
      capacity,
      enrolledMemberIds: body.enrolledMemberIds ?? [],
      recurrence: recurrenceResult?.ok ? recurrenceResult.recurrence : null,
      occurrences: recurrenceResult?.ok
        ? recurrenceResult.occurrences.map(({ startsAt: occurrenceStartsAt, endsAt: occurrenceEndsAt, weekday }) => ({
            startsAt: occurrenceStartsAt,
            endsAt: occurrenceEndsAt,
            weekday,
          }))
        : [{ startsAt: new Date(startsAt).toISOString(), endsAt: new Date(endsAt).toISOString(), weekday: new Date(startsAt).getDay() }],
    },
  };
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ branchId: string }> },
) {
  const { branchId } = await params;
  const db = await readServerDb();
  const { user, response } = requireSession(request, db);

  if (!user) {
    return response;
  }

  if (!["owner", "admin"].includes(user.role)) {
    return jsonError(403, "FORBIDDEN", "수업을 생성할 권한이 없습니다.");
  }

  if (!getAccessibleBranchIds(user, db).includes(branchId)) {
    return jsonError(403, "FORBIDDEN", "선택한 지점에 수업을 생성할 수 없습니다.");
  }

  const selectedScope = requireSelectedBranchScope(request, user, db);

  if (selectedScope.response) {
    return selectedScope.response;
  }

  if (selectedScope.selectedBranchId && selectedScope.selectedBranchId !== branchId) {
    return jsonError(403, "FORBIDDEN", "선택한 지점에 수업을 생성할 수 없습니다.");
  }

  const body = await request.json().catch(() => null);
  const validated = getValidatedClassPayload(body);

  if (!validated.ok) {
    return jsonError(400, "VALIDATION_ERROR", validated.error);
  }

  const payload = validated.payload;

  return withServerDbLock(`class-create:${branchId}`, async () => {
    const latestDb = await readServerDb();
    const { user: latestUser, response: latestResponse } = requireSession(request, latestDb);

    if (!latestUser) {
      return latestResponse;
    }

    if (!["owner", "admin"].includes(latestUser.role)) {
      return jsonError(403, "FORBIDDEN", "수업을 생성할 권한이 없습니다.");
    }

    if (!getAccessibleBranchIds(latestUser, latestDb).includes(branchId)) {
      return jsonError(403, "FORBIDDEN", "선택한 지점에 수업을 생성할 수 없습니다.");
    }

    const latestScope = requireSelectedBranchScope(request, latestUser, latestDb);

    if (latestScope.response) {
      return latestScope.response;
    }

    if (latestScope.selectedBranchId && latestScope.selectedBranchId !== branchId) {
      return jsonError(403, "FORBIDDEN", "선택한 지점에 수업을 생성할 수 없습니다.");
    }

    const branch = latestDb.branches.find((candidate) => candidate.id === branchId);
    const coach = latestDb.users.find((candidate) => candidate.id === payload.coachId);

    if (!branch) {
      return jsonError(404, "NOT_FOUND", "지점을 찾을 수 없습니다.");
    }

    if (
      !coach ||
      !["coach", "owner", "admin"].includes(coach.role) ||
      coach.invitationStatus === "pending" ||
      !coach.branchIds.includes(branchId)
    ) {
      return jsonError(422, "BUSINESS_RULE_FAILED", "선택한 지점에 배정된 코치를 선택해야 합니다.");
    }

    const enrolledMemberIds = [...new Set(payload.enrolledMemberIds)];

    if (enrolledMemberIds.length > payload.capacity) {
      return jsonError(422, "BUSINESS_RULE_FAILED", "등록 인원이 정원을 초과할 수 없습니다.");
    }

    const invalidMemberId = enrolledMemberIds.find((memberId) => {
      const member = latestDb.members.find((candidate) => candidate.id === memberId);
      return !member || member.branchId !== branchId || member.status === "withdrawn";
    });

    if (invalidMemberId) {
      return jsonError(422, "BUSINESS_RULE_FAILED", "수업 지점에 속한 활성 회원만 등록할 수 있습니다.", {
        memberId: invalidMemberId,
      });
    }

    if (
      payload.recurrence &&
      isFinalMainBranch(branch) &&
      payload.recurrence.weekdays.some(
        (weekday) =>
          !isFinalMainClassRegistrationSlot(
            weekday,
            payload.recurrence?.startTime ?? "",
            payload.recurrence?.endTime ?? "",
          ),
      )
    ) {
      return jsonError(422, "BUSINESS_RULE_FAILED", "본관 요일 고정 수업은 등록된 시간표의 요일과 시간만 선택할 수 있습니다.");
    }

    const duplicateOccurrence = payload.occurrences.find((occurrence) =>
      latestDb.classes.some(
        (session) =>
          session.branchId === branchId &&
          session.name === payload.name &&
          session.startsAt === occurrence.startsAt,
      ),
    );

    if (duplicateOccurrence) {
      return jsonError(409, "CONFLICT", "같은 날짜와 시간에 동일한 이름의 수업이 이미 있습니다.", {
        startsAt: duplicateOccurrence.startsAt,
      });
    }

    const nextClasses: ClassSession[] = payload.occurrences.map((occurrence) => ({
      id: createRuntimeId("class"),
      branchId,
      name: payload.name,
      level: payload.level,
      ageGroup: payload.ageGroup,
      coachId: payload.coachId,
      startsAt: occurrence.startsAt,
      endsAt: occurrence.endsAt,
      room: payload.room,
      capacity: payload.capacity,
      enrolledMemberIds,
    }));
    const createdAt = new Date().toISOString();
    const auditLogs: AuditLog[] = nextClasses.map((nextClass) => ({
      id: createRuntimeId("audit"),
      branchId,
      actorUserId: latestUser.id,
      action: "class.create",
      targetType: "class",
      targetId: nextClass.id,
      before: null,
      after: {
        name: nextClass.name,
        startsAt: nextClass.startsAt,
        capacity: nextClass.capacity,
        enrolledCount: nextClass.enrolledMemberIds.length,
        scheduleMode: payload.recurrence ? "weekly" : "single",
      },
      result: "success",
      message: payload.recurrence ? "요일 고정 수업을 생성했습니다." : "수업을 생성했습니다.",
      createdAt,
    }));
    const nextDb = await writeServerDb({
      ...latestDb,
      classes: [...nextClasses, ...latestDb.classes],
      auditLogs: [...auditLogs, ...latestDb.auditLogs],
    });

    return jsonOk(createBootstrapPayload(nextDb, latestUser, latestScope.selectedBranchId ?? branchId));
  });
}
