import { NextRequest } from "next/server";
import type { AuditLog, ClassSession, Member } from "@/lib/domain";
import { getAccessibleBranchIds } from "@/lib/mock-api";
import { readServerDb, writeServerDb } from "@/server/db";
import { createBootstrapPayload, jsonError, jsonOk, requireSelectedBranchScope, requireSession } from "@/server/api";

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
      };
    };

function isValidDateTime(value: string | undefined) {
  return Boolean(value && !Number.isNaN(Date.parse(value)));
}

function getValidatedClassPayload(body: ClassBody | null): ValidatedClassPayload {
  if (
    !body?.name?.trim() ||
    !body.level?.trim() ||
    !body.coachId?.trim() ||
    !body.startsAt ||
    !body.endsAt ||
    !body.room?.trim()
  ) {
    return { ok: false, error: "수업명, 레벨, 코치, 시간, 장소가 필요합니다." };
  }

  if (!body.ageGroup || !ageGroups.includes(body.ageGroup)) {
    return { ok: false, error: "연령 그룹이 올바르지 않습니다." };
  }

  if (!isValidDateTime(body.startsAt) || !isValidDateTime(body.endsAt)) {
    return { ok: false, error: "수업 시간이 올바르지 않습니다." };
  }

  if (new Date(body.endsAt).getTime() <= new Date(body.startsAt).getTime()) {
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
      startsAt: new Date(body.startsAt).toISOString(),
      endsAt: new Date(body.endsAt).toISOString(),
      room: body.room.trim(),
      capacity,
      enrolledMemberIds: body.enrolledMemberIds ?? [],
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

  const body = (await request.json().catch(() => null)) as ClassBody | null;
  const validated = getValidatedClassPayload(body);

  if (!validated.ok) {
    return jsonError(400, "VALIDATION_ERROR", validated.error);
  }

  const payload = validated.payload;
  const branch = db.branches.find((candidate) => candidate.id === branchId);
  const coach = db.users.find((candidate) => candidate.id === payload.coachId);

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
    const member = db.members.find((candidate) => candidate.id === memberId);
    return !member || member.branchId !== branchId || member.status === "withdrawn";
  });

  if (invalidMemberId) {
    return jsonError(422, "BUSINESS_RULE_FAILED", "수업 지점에 속한 활성 회원만 등록할 수 있습니다.", {
      memberId: invalidMemberId,
    });
  }

  const classId = `class-${Date.now()}`;
  const nextClass: ClassSession = {
    id: classId,
    branchId,
    ...payload,
    enrolledMemberIds,
  };
  const auditLog: AuditLog = {
    id: `audit-${Date.now()}-${db.auditLogs.length + 1}`,
    branchId,
    actorUserId: user.id,
    action: "class.create",
    targetType: "class",
    targetId: classId,
    before: null,
    after: {
      name: nextClass.name,
      startsAt: nextClass.startsAt,
      capacity: nextClass.capacity,
      enrolledCount: nextClass.enrolledMemberIds.length,
    },
    result: "success",
    message: "수업을 생성했습니다.",
    createdAt: new Date().toISOString(),
  };
  const nextDb = await writeServerDb({
    ...db,
    classes: [nextClass, ...db.classes],
    auditLogs: [auditLog, ...db.auditLogs],
  });

  return jsonOk(createBootstrapPayload(nextDb, user, selectedScope.selectedBranchId ?? branchId));
}
