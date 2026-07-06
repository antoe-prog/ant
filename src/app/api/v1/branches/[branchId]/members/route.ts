import { NextRequest } from "next/server";
import type { AuditLog, Member, MemberStatus } from "@/lib/domain";
import { getAccessibleBranchIds } from "@/lib/mock-api";
import { readServerDb, writeServerDb } from "@/server/db";
import { createBootstrapPayload, jsonError, jsonOk, requireSelectedBranchScope, requireSession } from "@/server/api";

export const runtime = "nodejs";

const memberStatuses: MemberStatus[] = ["active", "trial", "paused", "withdrawn"];
const ageGroups: Member["ageGroup"][] = ["kids", "teen", "adult"];

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
    return jsonError(403, "FORBIDDEN", "회원 등록 권한이 없습니다.");
  }

  if (!getAccessibleBranchIds(user, db).includes(branchId)) {
    return jsonError(403, "FORBIDDEN", "선택한 지점에 회원을 등록할 수 없습니다.");
  }

  const selectedScope = requireSelectedBranchScope(request, user, db);

  if (selectedScope.response) {
    return selectedScope.response;
  }

  if (selectedScope.selectedBranchId && selectedScope.selectedBranchId !== branchId) {
    return jsonError(403, "FORBIDDEN", "선택한 지점에 회원을 등록할 수 없습니다.");
  }

  const body = (await request.json().catch(() => null)) as
    | {
        name?: string;
        status?: MemberStatus;
        ageGroup?: Member["ageGroup"];
        level?: string;
        belt?: string;
        emergencyContact?: string;
        gender?: Member["gender"] | "";
        birthDate?: string;
        address?: string;
      }
    | null;

  if (!body?.name?.trim() || !body.level?.trim() || !body.belt?.trim() || !body.emergencyContact?.trim()) {
    return jsonError(400, "VALIDATION_ERROR", "회원명, 레벨, 띠, 비상 연락처가 필요합니다.");
  }

  if (!body.ageGroup || !ageGroups.includes(body.ageGroup)) {
    return jsonError(400, "VALIDATION_ERROR", "연령 그룹이 올바르지 않습니다.");
  }

  if (body.status && !memberStatuses.includes(body.status)) {
    return jsonError(400, "VALIDATION_ERROR", "회원 상태가 올바르지 않습니다.");
  }

  const gender = body.gender === "male" || body.gender === "female" ? body.gender : undefined;

  if (body.gender && !gender) {
    return jsonError(400, "VALIDATION_ERROR", "성별 값이 올바르지 않습니다.");
  }

  const birthDate = body.birthDate?.trim() || undefined;

  if (birthDate !== undefined) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(birthDate) || Number.isNaN(Date.parse(birthDate))) {
      return jsonError(400, "VALIDATION_ERROR", "생년월일은 YYYY-MM-DD 형식으로 입력해 주세요.");
    }

    if (Date.parse(birthDate) > Date.now()) {
      return jsonError(400, "VALIDATION_ERROR", "생년월일은 오늘 이전 날짜여야 합니다.");
    }
  }

  const address = body.address?.trim() || undefined;

  if (address !== undefined && address.length > 100) {
    return jsonError(400, "VALIDATION_ERROR", "주소는 100자 이내로 입력해 주세요.");
  }

  const branchCoach = db.users.find((candidate) => candidate.role === "coach" && candidate.branchIds.includes(branchId));
  const memberId = `member-${Date.now()}`;
  const now = new Date().toISOString();
  const nextMember: Member = {
    id: memberId,
    branchId,
    name: body.name.trim(),
    status: body.status ?? "active",
    ageGroup: body.ageGroup,
    level: body.level.trim(),
    belt: body.belt.trim(),
    gender,
    birthDate,
    address,
    guardianIds: [],
    primaryCoachId: branchCoach?.id ?? user.id,
    emergencyContact: body.emergencyContact.trim(),
    alerts: [],
    createdAt: now,
    statusChangedAt: now,
    withdrawnAt: body.status === "withdrawn" ? now : undefined,
  };
  const auditLog: AuditLog = {
    id: `audit-${Date.now()}-${db.auditLogs.length + 1}`,
    branchId,
    actorUserId: user.id,
    action: "member.create",
    targetType: "member",
    targetId: memberId,
    before: null,
    after: {
      name: nextMember.name,
      status: nextMember.status,
      ageGroup: nextMember.ageGroup,
      createdAt: nextMember.createdAt,
      statusChangedAt: nextMember.statusChangedAt,
      withdrawnAt: nextMember.withdrawnAt,
    },
    result: "success",
    message: "회원을 등록했습니다.",
    createdAt: now,
  };
  const nextDb = await writeServerDb({
    ...db,
    members: [nextMember, ...db.members],
    auditLogs: [auditLog, ...db.auditLogs],
  });

  return jsonOk(createBootstrapPayload(nextDb, user, selectedScope.selectedBranchId ?? branchId));
}
