import { NextRequest } from "next/server";
import type { AuditLog, ClassSession, Member } from "@/lib/domain";
import { getAccessibleBranchIds } from "@/lib/mock-api";
import { readServerDb, writeServerDb } from "@/server/db";
import { createBootstrapPayload, jsonError, jsonOk, requireSelectedBranchScope, requireSession } from "@/server/api";

export const runtime = "nodejs";

const ageGroups: Member["ageGroup"][] = ["kids", "teen", "adult"];

type ClassPatchBody = Partial<Pick<
  ClassSession,
  "name" | "level" | "ageGroup" | "coachId" | "startsAt" | "endsAt" | "room" | "capacity" | "enrolledMemberIds"
>>;

function isValidDateTime(value: string | undefined) {
  return Boolean(value && !Number.isNaN(Date.parse(value)));
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

  if (!["owner", "admin"].includes(user.role)) {
    return jsonError(403, "FORBIDDEN", "수업을 수정할 권한이 없습니다.");
  }

  const existing = db.classes.find((candidate) => candidate.id === classId);

  if (!existing) {
    return jsonError(404, "NOT_FOUND", "수업을 찾을 수 없습니다.");
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

  const body = (await request.json().catch(() => null)) as ClassPatchBody | null;

  if (!body || Object.keys(body).length === 0) {
    return jsonError(400, "VALIDATION_ERROR", "변경할 수업 정보가 필요합니다.");
  }

  const nextClass: ClassSession = {
    ...existing,
    name: body.name?.trim() || existing.name,
    level: body.level?.trim() || existing.level,
    ageGroup: body.ageGroup ?? existing.ageGroup,
    coachId: body.coachId?.trim() || existing.coachId,
    startsAt: body.startsAt ? new Date(body.startsAt).toISOString() : existing.startsAt,
    endsAt: body.endsAt ? new Date(body.endsAt).toISOString() : existing.endsAt,
    room: body.room?.trim() || existing.room,
    capacity: body.capacity ?? existing.capacity,
    enrolledMemberIds: body.enrolledMemberIds ? [...new Set(body.enrolledMemberIds)] : existing.enrolledMemberIds,
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

  const coach = db.users.find((candidate) => candidate.id === nextClass.coachId);

  if (!coach || !["coach", "admin"].includes(coach.role) || !coach.branchIds.includes(existing.branchId)) {
    return jsonError(422, "BUSINESS_RULE_FAILED", "선택한 지점에 배정된 코치를 선택해야 합니다.");
  }

  const invalidMemberId = nextClass.enrolledMemberIds.find((memberId) => {
    const member = db.members.find((candidate) => candidate.id === memberId);
    return !member || member.branchId !== existing.branchId || member.status === "withdrawn";
  });

  if (invalidMemberId) {
    return jsonError(422, "BUSINESS_RULE_FAILED", "수업 지점에 속한 활성 회원만 등록할 수 있습니다.", {
      memberId: invalidMemberId,
    });
  }

  const auditLog: AuditLog = {
    id: `audit-${Date.now()}-${db.auditLogs.length + 1}`,
    branchId: existing.branchId,
    actorUserId: user.id,
    action: "class.update",
    targetType: "class",
    targetId: existing.id,
    before: {
      name: existing.name,
      startsAt: existing.startsAt,
      endsAt: existing.endsAt,
      room: existing.room,
      capacity: existing.capacity,
      enrolledCount: existing.enrolledMemberIds.length,
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
    ...db,
    classes: db.classes.map((candidate) => (candidate.id === existing.id ? nextClass : candidate)),
    auditLogs: [auditLog, ...db.auditLogs],
  });

  return jsonOk(createBootstrapPayload(nextDb, user, selectedScope.selectedBranchId ?? existing.branchId));
}
