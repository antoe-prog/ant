import { NextRequest } from "next/server";
import type { AuditLog, Member, MemberStatus } from "@/lib/domain";
import { getAccessibleBranchIds, getAccessibleMemberIds } from "@/lib/mock-api";
import { isValidKoreanMobileNumber, normalizePhoneNumber, samePhoneNumber } from "@/lib/phone";
import { readServerDb, writeServerDb } from "@/server/db";
import { createBootstrapPayload, jsonError, jsonOk, requireSelectedBranchScope, requireSession } from "@/server/api";

export const runtime = "nodejs";

const memberStatuses: MemberStatus[] = ["active", "trial", "paused", "withdrawn"];
const ageGroups: Member["ageGroup"][] = ["kids", "teen", "adult"];
const memberGenders: NonNullable<Member["gender"]>[] = ["male", "female"];
type MemberPatchPayload = Partial<Pick<Member, "ageGroup" | "alerts" | "belt" | "emergencyContact" | "level" | "name" | "status">> & {
  gender?: Member["gender"] | "";
  birthDate?: string;
  address?: string;
};

function cleanText(value: unknown) {
  return typeof value === "string" ? value.trim() : null;
}

function hasRestrictedProfileFields(body: MemberPatchPayload) {
  return (
    body.status !== undefined ||
    body.ageGroup !== undefined ||
    body.name !== undefined ||
    body.level !== undefined ||
    body.belt !== undefined ||
    body.alerts !== undefined ||
    body.gender !== undefined ||
    body.birthDate !== undefined ||
    body.address !== undefined
  );
}

function getLinkedMemberAccountUsers(
  db: Awaited<ReturnType<typeof readServerDb>>,
  memberId: string,
) {
  return db.users.filter((candidate) => candidate.role === "member" && (candidate.memberIds ?? []).includes(memberId));
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ memberId: string }> },
) {
  const { memberId } = await params;
  const db = await readServerDb();
  const { user, response } = requireSession(request, db);

  if (!user) {
    return response;
  }

  const member = db.members.find((candidate) => candidate.id === memberId);

  if (!member) {
    return jsonError(404, "NOT_FOUND", "회원을 찾을 수 없습니다.");
  }

  if (!getAccessibleBranchIds(user, db).includes(member.branchId)) {
    return jsonError(403, "FORBIDDEN", "선택한 회원의 지점에 접근할 수 없습니다.");
  }

  const selectedScope = requireSelectedBranchScope(request, user, db);

  if (selectedScope.response) {
    return selectedScope.response;
  }

  if (selectedScope.selectedBranchId && selectedScope.selectedBranchId !== member.branchId) {
    return jsonError(403, "FORBIDDEN", "선택한 회원의 지점에 접근할 수 없습니다.");
  }

  const canManageMember = user.role === "owner" || user.role === "admin";
  const canUpdateOwnContact =
    (user.role === "member" && (user.memberIds ?? []).includes(member.id)) ||
    (user.role === "guardian" && getAccessibleMemberIds(user, db, [member.branchId]).includes(member.id));

  if (!canManageMember && !canUpdateOwnContact) {
    return jsonError(403, "FORBIDDEN", "회원 정보를 변경할 권한이 없습니다.");
  }

  const body = (await request.json().catch(() => null)) as MemberPatchPayload | null;

  if (!body || Object.keys(body).length === 0) {
    return jsonError(400, "VALIDATION_ERROR", "변경할 회원 정보가 없습니다.");
  }

  if (!canManageMember && hasRestrictedProfileFields(body)) {
    return jsonError(403, "FORBIDDEN", "회원/학부모는 긴급 연락처만 변경할 수 있습니다.");
  }

  const patch: Partial<Member> = {};
  const now = new Date().toISOString();

  if (body.status !== undefined) {
    if (!memberStatuses.includes(body.status)) {
      return jsonError(400, "VALIDATION_ERROR", "변경할 회원 상태가 올바르지 않습니다.");
    }

    patch.status = body.status;

    if (body.status !== member.status) {
      patch.statusChangedAt = now;
      patch.withdrawnAt = body.status === "withdrawn" ? now : undefined;
    }
  }

  if (body.ageGroup !== undefined) {
    if (!ageGroups.includes(body.ageGroup)) {
      return jsonError(400, "VALIDATION_ERROR", "연령 그룹이 올바르지 않습니다.");
    }

    patch.ageGroup = body.ageGroup;
  }

  if (body.name !== undefined) {
    const name = cleanText(body.name);

    if (!name || name.length > 30) {
      return jsonError(400, "VALIDATION_ERROR", "회원 이름을 30자 이내로 입력해 주세요.");
    }

    patch.name = name;
  }

  if (body.emergencyContact !== undefined) {
    const emergencyContact = cleanText(body.emergencyContact);

    if (!emergencyContact || emergencyContact.length > 40) {
      return jsonError(400, "VALIDATION_ERROR", "긴급 연락처를 40자 이내로 입력해 주세요.");
    }

    patch.emergencyContact = emergencyContact;
  }

  if (body.level !== undefined) {
    const level = cleanText(body.level);

    if (!level || level.length > 30) {
      return jsonError(400, "VALIDATION_ERROR", "레벨을 30자 이내로 입력해 주세요.");
    }

    patch.level = level;
  }

  if (body.belt !== undefined) {
    const belt = cleanText(body.belt);

    if (!belt || belt.length > 30) {
      return jsonError(400, "VALIDATION_ERROR", "띠 정보를 30자 이내로 입력해 주세요.");
    }

    patch.belt = belt;
  }

  if (body.gender !== undefined) {
    if (body.gender === "") {
      patch.gender = undefined;
    } else if (!memberGenders.includes(body.gender)) {
      return jsonError(400, "VALIDATION_ERROR", "성별 값이 올바르지 않습니다.");
    } else {
      patch.gender = body.gender;
    }
  }

  if (body.birthDate !== undefined) {
    const birthDate = cleanText(body.birthDate) ?? "";

    if (birthDate === "") {
      patch.birthDate = undefined;
    } else if (!/^\d{4}-\d{2}-\d{2}$/.test(birthDate) || Number.isNaN(Date.parse(birthDate))) {
      return jsonError(400, "VALIDATION_ERROR", "생년월일은 YYYY-MM-DD 형식으로 입력해 주세요.");
    } else if (Date.parse(birthDate) > Date.now()) {
      return jsonError(400, "VALIDATION_ERROR", "생년월일은 오늘 이전 날짜여야 합니다.");
    } else {
      patch.birthDate = birthDate;
    }
  }

  if (body.address !== undefined) {
    const address = cleanText(body.address) ?? "";

    if (address.length > 100) {
      return jsonError(400, "VALIDATION_ERROR", "주소는 100자 이내로 입력해 주세요.");
    }

    patch.address = address === "" ? undefined : address;
  }

  if (body.alerts !== undefined) {
    if (!Array.isArray(body.alerts)) {
      return jsonError(400, "VALIDATION_ERROR", "주의사항은 목록 형식이어야 합니다.");
    }

    const alerts = body.alerts
      .map((alert) => cleanText(alert))
      .filter((alert): alert is string => Boolean(alert));

    if (alerts.length > 8 || alerts.some((alert) => alert.length > 80)) {
      return jsonError(400, "VALIDATION_ERROR", "주의사항은 8개 이하, 항목당 80자 이내로 입력해 주세요.");
    }

    patch.alerts = alerts;
  }

  if (Object.keys(patch).length === 0) {
    return jsonError(400, "VALIDATION_ERROR", "변경 가능한 회원 정보가 없습니다.");
  }

  const shouldSyncLinkedMemberAccount =
    canManageMember || (user.role === "member" && (user.memberIds ?? []).includes(member.id));
  const linkedMemberAccountUsers = shouldSyncLinkedMemberAccount ? getLinkedMemberAccountUsers(db, member.id) : [];
  const linkedMemberAccountUserIds = linkedMemberAccountUsers.map((candidate) => candidate.id);
  const linkedMemberAccountUserIdSet = new Set(linkedMemberAccountUserIds);
  const syncedPhone = patch.emergencyContact !== undefined ? normalizePhoneNumber(patch.emergencyContact) : null;

  if (linkedMemberAccountUsers.length > 0 && syncedPhone !== null) {
    if (!isValidKoreanMobileNumber(syncedPhone)) {
      return jsonError(400, "VALIDATION_ERROR", "회원 앱 계정 연락처는 휴대폰 번호 형식이어야 합니다.");
    }

    if (db.users.some((candidate) => !linkedMemberAccountUserIdSet.has(candidate.id) && samePhoneNumber(candidate.phone, syncedPhone))) {
      return jsonError(409, "CONFLICT", "이미 등록된 휴대폰 번호입니다.");
    }
  }

  const before = Object.fromEntries(
    Object.keys(patch).map((key) => [key, member[key as keyof Member]]),
  );
  const nextMember = { ...member, ...patch };
  const after = Object.fromEntries(
    Object.keys(patch).map((key) => [key, nextMember[key as keyof Member]]),
  );
  const nextUsers = linkedMemberAccountUsers.length > 0
    ? db.users.map((candidate) =>
        linkedMemberAccountUserIdSet.has(candidate.id)
          ? {
              ...candidate,
              ...(patch.name !== undefined ? { name: nextMember.name } : {}),
              ...(syncedPhone !== null ? { phone: syncedPhone } : {}),
            }
          : candidate,
      )
    : db.users;

  const auditLog: AuditLog = {
    id: `audit-${Date.now()}-${db.auditLogs.length + 1}`,
    branchId: member.branchId,
    actorUserId: user.id,
    action: "member.update",
    targetType: "member",
    targetId: member.id,
    before,
    after: {
      ...after,
      ...(linkedMemberAccountUserIds.length > 0 ? { syncedUserIds: linkedMemberAccountUserIds } : {}),
    },
    result: "success",
    message: canManageMember ? "회원 정보를 변경했습니다." : "회원 긴급 연락처를 변경했습니다.",
    createdAt: now,
  };
  const nextDb = await writeServerDb({
    ...db,
    members: db.members.map((candidate) =>
      candidate.id === member.id ? nextMember : candidate,
    ),
    users: nextUsers,
    auditLogs: [auditLog, ...db.auditLogs],
  });

  return jsonOk(createBootstrapPayload(nextDb, user, selectedScope.selectedBranchId ?? member.branchId));
}
