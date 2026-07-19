import { NextRequest } from "next/server";
import type { AuditLog, Branch } from "@/lib/domain";
import { defaultBranchSettings } from "@/lib/domain";
import { getBranchCreateBodyError, type BranchCreateInput } from "@/lib/branch-input-policy";
import { branchManagementStateLockKey } from "@/server/branch-management";
import { readServerDb, withServerDbLock, writeServerDb } from "@/server/db";
import { createBootstrapPayload, jsonError, jsonOk, requireSelectedBranchScope, requireSession } from "@/server/api";
import { createRuntimeId } from "@/server/runtime-id";

export const runtime = "nodejs";

function slugifyBranchId(name: string) {
  const ascii = name
    .toLowerCase()
    .replace(/[^a-z0-9가-힣]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);

  return `branch-${ascii || Date.now()}`;
}

function createUniqueBranchId(name: string, existingIds: Set<string>) {
  const baseId = slugifyBranchId(name);
  let id = baseId;
  let index = 2;

  while (existingIds.has(id)) {
    id = `${baseId}-${index}`;
    index += 1;
  }

  return id;
}

async function requireBranchCreateRequestContext(request: NextRequest) {
  const db = await readServerDb();
  const { user, response } = requireSession(request, db);

  if (!user) {
    return { context: null, response };
  }

  if (user.role !== "admin") {
    return {
      context: null,
      response: jsonError(403, "FORBIDDEN", "총괄 어드민만 지점을 생성할 수 있습니다."),
    };
  }

  const selectedScope = requireSelectedBranchScope(request, user, db);

  if (selectedScope.response) {
    return { context: null, response: selectedScope.response };
  }

  return {
    context: { db, selectedBranchId: selectedScope.selectedBranchId, user },
    response: null,
  };
}

async function createBranch(request: NextRequest, body: BranchCreateInput) {
  const currentContext = await requireBranchCreateRequestContext(request);

  if (!currentContext.context) {
    return currentContext.response;
  }

  const { db, selectedBranchId, user } = currentContext.context;

  const name = body?.name?.trim() ?? "";
  const district = body?.district?.trim() ?? "";
  const ownerUserId = body?.ownerUserId?.trim() ?? "";

  if (!name || !district) {
    return jsonError(400, "VALIDATION_ERROR", "지점명과 지역이 필요합니다.");
  }

  if (db.branches.some((branch) => branch.name === name)) {
    return jsonError(409, "CONFLICT", "같은 이름의 지점이 이미 있습니다.");
  }

  const owner = ownerUserId ? db.users.find((candidate) => candidate.id === ownerUserId) : null;

  if (ownerUserId && !owner) {
    return jsonError(404, "NOT_FOUND", "대표로 배정할 사용자를 찾을 수 없습니다.");
  }

  if (owner && owner.role !== "owner") {
    return jsonError(422, "BUSINESS_RULE_FAILED", "대표 역할 사용자만 지점 대표로 배정할 수 있습니다.");
  }

  const branchId = createUniqueBranchId(name, new Set(db.branches.map((branch) => branch.id)));
  const nextBranch: Branch = {
    id: branchId,
    name,
    district,
    settings: defaultBranchSettings,
    status: "active",
    timezone: "Asia/Seoul",
  };
  const now = new Date().toISOString();
  const branchCreateLog: AuditLog = {
    id: createRuntimeId("audit"),
    branchId,
    actorUserId: user.id,
    action: "branch.create",
    targetType: "branch",
    targetId: branchId,
    before: null,
    after: { name, district, settings: defaultBranchSettings, status: "active", timezone: "Asia/Seoul" },
    result: "success",
    message: "지점을 생성했습니다.",
    createdAt: now,
  };
  const ownerAssignLog: AuditLog | null = owner
    ? {
        id: createRuntimeId("audit"),
        branchId,
        actorUserId: user.id,
        action: "branch.owner.assign",
        targetType: "branch",
        targetId: branchId,
        before: { ownerUserId: null },
        after: { ownerUserId: owner.id },
        result: "success",
        message: "지점 대표를 배정했습니다.",
        createdAt: now,
      }
    : null;
  const nextUsers = owner
    ? db.users.map((candidate) =>
        candidate.id === owner.id
          ? { ...candidate, branchIds: [...new Set([...candidate.branchIds, branchId])] }
          : candidate,
      )
    : db.users;
  const nextDb = await writeServerDb({
    ...db,
    branches: [...db.branches, nextBranch],
    users: nextUsers,
    auditLogs: [branchCreateLog, ...(ownerAssignLog ? [ownerAssignLog] : []), ...db.auditLogs],
  });

  return jsonOk(createBootstrapPayload(nextDb, user, selectedBranchId));
}

export async function POST(request: NextRequest) {
  const initialContext = await requireBranchCreateRequestContext(request);

  if (!initialContext.context) {
    return initialContext.response;
  }

  const rawBody = await request.json().catch(() => null);
  const bodyError = getBranchCreateBodyError(rawBody);

  if (bodyError) {
    return jsonError(400, "VALIDATION_ERROR", bodyError);
  }

  const body = rawBody as BranchCreateInput;
  const name = body.name?.trim() ?? "";
  const district = body.district?.trim() ?? "";

  if (!name || !district) {
    return jsonError(400, "VALIDATION_ERROR", "지점명과 지역이 필요합니다.");
  }

  return withServerDbLock(branchManagementStateLockKey, () => createBranch(request, body));
}
