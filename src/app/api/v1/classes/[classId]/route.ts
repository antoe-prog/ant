import { NextRequest } from "next/server";
import type { AuditLog, ClassSession } from "@/lib/domain";
import { getClassInputLimitError } from "@/lib/class-input-policy";
import { isClassAgeGroupCompatible } from "@/lib/class-enrollment-policy";
import { getAccessibleBranchIds } from "@/lib/mock-api";
import { readServerDb, withServerDbLock, writeServerDb } from "@/server/db";
import { createBootstrapPayload, jsonError, jsonOk, requireSelectedBranchScope, requireSession } from "@/server/api";
import { createRuntimeId } from "@/server/runtime-id";

export const runtime = "nodejs";

const ageGroups: ClassSession["ageGroup"][] = ["all", "kids", "teen", "adult"];
const classPatchFields = [
  "name",
  "level",
  "ageGroup",
  "coachId",
  "startsAt",
  "endsAt",
  "room",
  "capacity",
  "enrolledMemberIds",
] as const;

type ClassPatchBody = Partial<Pick<
  ClassSession,
  "name" | "level" | "ageGroup" | "coachId" | "startsAt" | "endsAt" | "room" | "capacity" | "enrolledMemberIds"
>>;

function isValidDateTime(value: string | undefined) {
  return Boolean(value && !Number.isNaN(Date.parse(value)));
}

function getClassPatchBodyTypeError(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return "변경할 수업 정보가 올바른 JSON 객체가 아닙니다.";
  }

  const body = value as Record<string, unknown>;

  for (const field of ["name", "level", "ageGroup", "coachId", "startsAt", "endsAt", "room"] as const) {
    if (body[field] !== undefined && typeof body[field] !== "string") {
      return "변경할 수업 값의 형식이 올바르지 않습니다.";
    }
  }

  if (body.capacity !== undefined && typeof body.capacity !== "number") {
    return "변경할 정원 값의 형식이 올바르지 않습니다.";
  }

  if (
    body.enrolledMemberIds !== undefined &&
    (!Array.isArray(body.enrolledMemberIds) || body.enrolledMemberIds.some((memberId) => typeof memberId !== "string"))
  ) {
    return "변경할 등록 회원 목록의 형식이 올바르지 않습니다.";
  }

  return null;
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ classId: string }> },
) {
  const { classId } = await params;
  const db = await readServerDb();
  const { user, response } = requireSession(request, db);

  if (!user) {
    return response;
  }

  if (!["coach", "owner", "admin"].includes(user.role)) {
    return jsonError(403, "FORBIDDEN", "수업을 수정할 권한이 없습니다.");
  }

  const existing = db.classes.find((candidate) => candidate.id === classId);

  if (!existing) {
    return jsonError(404, "NOT_FOUND", "수업을 찾을 수 없습니다.");
  }

  if (user.role === "coach" && existing.coachId !== user.id) {
    return jsonError(403, "FORBIDDEN", "코치는 본인 담당 수업만 수정할 수 있습니다.");
  }

  if (!getAccessibleBranchIds(user, db).includes(existing.branchId)) {
    return jsonError(403, "FORBIDDEN", "선택한 수업의 지점에 접근할 수 없습니다.");
  }

  const selectedScope = requireSelectedBranchScope(request, user, db);

  if (selectedScope.response) {
    return selectedScope.response;
  }

  if (selectedScope.selectedBranchId && selectedScope.selectedBranchId !== existing.branchId) {
    return jsonError(403, "FORBIDDEN", "선택한 수업의 지점에 접근할 수 없습니다.");
  }

  const rawBody = await request.json().catch(() => null);
  const bodyTypeError = getClassPatchBodyTypeError(rawBody);

  if (bodyTypeError) {
    return jsonError(400, "VALIDATION_ERROR", bodyTypeError);
  }

  const inputLimitError = getClassInputLimitError(rawBody as Record<string, unknown>);

  if (inputLimitError) {
    return jsonError(400, "VALIDATION_ERROR", inputLimitError);
  }

  const body = rawBody as ClassPatchBody;

  if (!classPatchFields.some((field) => Object.hasOwn(body, field))) {
    return jsonError(400, "VALIDATION_ERROR", "변경할 수업 정보가 필요합니다.");
  }

  if (
    [body.name, body.level, body.coachId, body.room].some((value) => value !== undefined && value.trim().length === 0)
  ) {
    return jsonError(400, "VALIDATION_ERROR", "수업명, 레벨, 코치, 장소는 빈 값으로 변경할 수 없습니다.");
  }

  if (
    (body.startsAt !== undefined && !isValidDateTime(body.startsAt)) ||
    (body.endsAt !== undefined && !isValidDateTime(body.endsAt))
  ) {
    return jsonError(400, "VALIDATION_ERROR", "수업 시간이 올바르지 않습니다.");
  }

  return withServerDbLock(`class-mutation:${classId}`, async () => {
    const latestDb = await readServerDb();
    const { user: latestUser, response: latestResponse } = requireSession(request, latestDb);

    if (!latestUser) {
      return latestResponse;
    }

    if (!["coach", "owner", "admin"].includes(latestUser.role)) {
      return jsonError(403, "FORBIDDEN", "수업을 수정할 권한이 없습니다.");
    }

    const latestExisting = latestDb.classes.find((candidate) => candidate.id === classId);

    if (!latestExisting) {
      return jsonError(404, "NOT_FOUND", "수업을 찾을 수 없습니다.");
    }

    if (latestUser.role === "coach" && latestExisting.coachId !== latestUser.id) {
      return jsonError(403, "FORBIDDEN", "코치는 본인 담당 수업만 수정할 수 있습니다.");
    }

    if (!getAccessibleBranchIds(latestUser, latestDb).includes(latestExisting.branchId)) {
      return jsonError(403, "FORBIDDEN", "선택한 수업의 지점에 접근할 수 없습니다.");
    }

    const latestScope = requireSelectedBranchScope(request, latestUser, latestDb);

    if (latestScope.response) {
      return latestScope.response;
    }

    if (latestScope.selectedBranchId && latestScope.selectedBranchId !== latestExisting.branchId) {
      return jsonError(403, "FORBIDDEN", "선택한 수업의 지점에 접근할 수 없습니다.");
    }

    const nextClass: ClassSession = {
      ...latestExisting,
      name: body.name?.trim() || latestExisting.name,
      level: body.level?.trim() || latestExisting.level,
      ageGroup: body.ageGroup ?? latestExisting.ageGroup,
      coachId: body.coachId?.trim() || latestExisting.coachId,
      startsAt: body.startsAt ? new Date(body.startsAt).toISOString() : latestExisting.startsAt,
      endsAt: body.endsAt ? new Date(body.endsAt).toISOString() : latestExisting.endsAt,
      room: body.room?.trim() || latestExisting.room,
      capacity: body.capacity ?? latestExisting.capacity,
      enrolledMemberIds: body.enrolledMemberIds ? [...new Set(body.enrolledMemberIds)] : latestExisting.enrolledMemberIds,
    };

    if (!ageGroups.includes(nextClass.ageGroup)) {
      return jsonError(400, "VALIDATION_ERROR", "연령 그룹이 올바르지 않습니다.");
    }

    if (!isValidDateTime(nextClass.startsAt) || !isValidDateTime(nextClass.endsAt)) {
      return jsonError(400, "VALIDATION_ERROR", "수업 시간이 올바르지 않습니다.");
    }

    if (new Date(nextClass.endsAt).getTime() <= new Date(nextClass.startsAt).getTime()) {
      return jsonError(400, "VALIDATION_ERROR", "종료 시간은 시작 시간보다 늦어야 합니다.");
    }

    if (!Number.isInteger(nextClass.capacity) || nextClass.capacity < 1 || nextClass.capacity > 80) {
      return jsonError(400, "VALIDATION_ERROR", "정원은 1명 이상 80명 이하의 정수여야 합니다.");
    }

    if (nextClass.enrolledMemberIds.length > nextClass.capacity) {
      return jsonError(422, "BUSINESS_RULE_FAILED", "등록 인원이 정원을 초과할 수 없습니다.");
    }

    const coach = latestDb.users.find((candidate) => candidate.id === nextClass.coachId);

    if (
      !coach ||
      !["coach", "owner", "admin"].includes(coach.role) ||
      coach.invitationStatus === "pending" ||
      !coach.branchIds.includes(latestExisting.branchId)
    ) {
      return jsonError(422, "BUSINESS_RULE_FAILED", "선택한 지점에 배정된 코치를 선택해야 합니다.");
    }

    if (latestUser.role === "coach" && nextClass.coachId !== latestUser.id) {
      return jsonError(403, "FORBIDDEN", "코치는 수업 담당자를 변경할 수 없습니다.");
    }

    const addedMemberIds = nextClass.enrolledMemberIds.filter(
      (memberId) => !latestExisting.enrolledMemberIds.includes(memberId),
    );
    const removedMemberIds = latestExisting.enrolledMemberIds.filter(
      (memberId) => !nextClass.enrolledMemberIds.includes(memberId),
    );

    const invalidMemberId = addedMemberIds.find((memberId) => {
      const member = latestDb.members.find((candidate) => candidate.id === memberId);
      return (
        !member ||
        member.branchId !== latestExisting.branchId ||
        (member.status !== "active" && member.status !== "trial") ||
        !isClassAgeGroupCompatible(member, nextClass)
      );
    });

    if (invalidMemberId) {
      return jsonError(422, "BUSINESS_RULE_FAILED", "수업 지점·연령에 맞는 활성 또는 체험 회원만 등록할 수 있습니다.", {
        memberId: invalidMemberId,
      });
    }

    if (body.ageGroup !== undefined) {
      const incompatibleMemberId = nextClass.enrolledMemberIds.find((memberId) => {
        const member = latestDb.members.find((candidate) => candidate.id === memberId);
        return !member || !isClassAgeGroupCompatible(member, nextClass);
      });

      if (incompatibleMemberId) {
        return jsonError(422, "BUSINESS_RULE_FAILED", "등록 회원의 연령과 맞지 않는 수업으로 변경할 수 없습니다.", {
          memberId: incompatibleMemberId,
        });
      }
    }

    const attendedRemovedMemberId = removedMemberIds.find((memberId) =>
      latestDb.attendance.some((record) => record.sessionId === latestExisting.id && record.memberId === memberId),
    );

    if (attendedRemovedMemberId) {
      return jsonError(422, "BUSINESS_RULE_FAILED", "출석 기록이 있는 회원은 수업 명단에서 제거할 수 없습니다.", {
        memberId: attendedRemovedMemberId,
      });
    }

    const auditLog: AuditLog = {
      id: createRuntimeId("audit"),
      branchId: latestExisting.branchId,
      actorUserId: latestUser.id,
      action: "class.update",
      targetType: "class",
      targetId: latestExisting.id,
      before: {
        name: latestExisting.name,
        startsAt: latestExisting.startsAt,
        endsAt: latestExisting.endsAt,
        room: latestExisting.room,
        capacity: latestExisting.capacity,
        enrolledCount: latestExisting.enrolledMemberIds.length,
      },
      after: {
        name: nextClass.name,
        startsAt: nextClass.startsAt,
        endsAt: nextClass.endsAt,
        room: nextClass.room,
        capacity: nextClass.capacity,
        enrolledCount: nextClass.enrolledMemberIds.length,
      },
      result: "success",
      message: "수업 정보를 수정했습니다.",
      createdAt: new Date().toISOString(),
    };
    const nextDb = await writeServerDb({
      ...latestDb,
      classes: latestDb.classes.map((candidate) => (candidate.id === latestExisting.id ? nextClass : candidate)),
      auditLogs: [auditLog, ...latestDb.auditLogs],
    });

    return jsonOk(createBootstrapPayload(nextDb, latestUser, latestScope.selectedBranchId ?? latestExisting.branchId));
  });
}
