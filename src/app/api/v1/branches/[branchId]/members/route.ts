import { NextRequest } from "next/server";
import type { AuditLog, Member, MemberStatus } from "@/lib/domain";
import { memberInputLimits } from "@/lib/member-input-policy";
import { getAccessibleBranchIds } from "@/lib/mock-api";
import { readServerDb, writeServerDb } from "@/server/db";
import { createBootstrapPayload, jsonError, jsonOk, requireSelectedBranchScope, requireSession } from "@/server/api";
import { createRuntimeId } from "@/server/runtime-id";
import { findAcceptedBranchOperatorId } from "@/server/user-operational-reassignment";

export const runtime = "nodejs";

const memberStatuses: MemberStatus[] = ["active", "trial", "paused", "withdrawn"];
const ageGroups: Member["ageGroup"][] = ["kids", "teen", "adult"];

type MemberBody = {
  name?: string;
  status?: MemberStatus;
  ageGroup?: Member["ageGroup"];
  level?: string;
  belt?: string;
  emergencyContact?: string;
  gender?: Member["gender"] | "";
  birthDate?: string;
  address?: string;
};

function getMemberBodyTypeError(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return "회원 등록 정보가 올바른 JSON 객체가 아닙니다.";
  }

  const body = value as Record<string, unknown>;
  const fields = [
    ["name", "회원명"],
    ["status", "회원 상태"],
    ["ageGroup", "연령 그룹"],
    ["level", "레벨"],
    ["belt", "띠"],
    ["emergencyContact", "비상 연락처"],
    ["gender", "성별"],
    ["birthDate", "생년월일"],
    ["address", "주소"],
  ] as const;

  for (const [field, label] of fields) {
    if (body[field] !== undefined && typeof body[field] !== "string") {
      return `${label} 값의 형식이 올바르지 않습니다.`;
    }
  }

  return null;
}

function isDateOnly(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);

  if (!match) {
    return false;
  }

  const [, year, month, day] = match;
  const parsed = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));

  return (
    parsed.getUTCFullYear() === Number(year) &&
    parsed.getUTCMonth() === Number(month) - 1 &&
    parsed.getUTCDate() === Number(day)
  );
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

  const rawBody = await request.json().catch(() => null);
  const bodyTypeError = getMemberBodyTypeError(rawBody);

  if (bodyTypeError) {
    return jsonError(400, "VALIDATION_ERROR", bodyTypeError);
  }

  const body = rawBody as MemberBody;
  const name = body.name?.trim() ?? "";
  const level = body.level?.trim() ?? "";
  const belt = body.belt?.trim() ?? "";
  const emergencyContact = body.emergencyContact?.trim() ?? "";

  if (!name || !level || !belt || !emergencyContact) {
    return jsonError(400, "VALIDATION_ERROR", "회원명, 레벨, 띠, 비상 연락처가 필요합니다.");
  }

  if (
    name.length > memberInputLimits.nameLength ||
    level.length > memberInputLimits.levelLength ||
    belt.length > memberInputLimits.beltLength ||
    emergencyContact.length > memberInputLimits.emergencyContactLength
  ) {
    return jsonError(400, "VALIDATION_ERROR", "회원명·레벨·띠는 30자, 비상 연락처는 40자 이내로 입력해 주세요.");
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
    if (!isDateOnly(birthDate)) {
      return jsonError(400, "VALIDATION_ERROR", "생년월일은 YYYY-MM-DD 형식으로 입력해 주세요.");
    }

    if (Date.parse(birthDate) > Date.now()) {
      return jsonError(400, "VALIDATION_ERROR", "생년월일은 오늘 이전 날짜여야 합니다.");
    }
  }

  const address = body.address?.trim() || undefined;

  if (address !== undefined && address.length > memberInputLimits.addressLength) {
    return jsonError(400, "VALIDATION_ERROR", "주소는 100자 이내로 입력해 주세요.");
  }

  const branchOperatorId = findAcceptedBranchOperatorId(db, branchId);

  if (!branchOperatorId) {
    return jsonError(422, "BUSINESS_RULE_FAILED", "같은 지점의 승인된 코치, 대표 또는 어드민을 먼저 배정해 주세요.");
  }
  const memberId = createRuntimeId("member");
  const now = new Date().toISOString();
  const nextMember: Member = {
    id: memberId,
    branchId,
    name,
    status: body.status ?? "active",
    ageGroup: body.ageGroup,
    level,
    belt,
    gender,
    birthDate,
    address,
    guardianIds: [],
    primaryCoachId: branchOperatorId,
    emergencyContact,
    alerts: [],
    createdAt: now,
    statusChangedAt: now,
    withdrawnAt: body.status === "withdrawn" ? now : undefined,
  };
  const auditLog: AuditLog = {
    id: createRuntimeId("audit"),
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
