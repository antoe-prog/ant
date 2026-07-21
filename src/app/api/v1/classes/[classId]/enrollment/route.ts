import { NextRequest } from "next/server";
import type { AuditLog, MockDatabase } from "@/lib/domain";
import { getClassRegistrationBlockReason } from "@/lib/class-enrollment-policy";
import { getAccessibleMemberIds } from "@/lib/mock-api";
import { createBootstrapPayload, jsonError, jsonOk, requireSelectedBranchScope, requireSession } from "@/server/api";
import { readServerDb, withServerDbLock, writeServerDb } from "@/server/db";
import { createRuntimeId } from "@/server/runtime-id";

export const runtime = "nodejs";

type EnrollmentBody = { memberId: string };

function parseEnrollmentBody(value: unknown): EnrollmentBody | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const body = value as Record<string, unknown>;
  const keys = Object.keys(body);

  if (keys.length !== 1 || keys[0] !== "memberId" || typeof body.memberId !== "string") {
    return null;
  }

  const memberId = body.memberId.trim();
  return memberId && memberId.length <= 200 ? { memberId } : null;
}

function getEnrollmentContext(request: NextRequest, db: MockDatabase, classId: string, memberId: string) {
  const { user, response } = requireSession(request, db);

  if (!user) {
    return { ok: false as const, response };
  }

  if (user.role !== "member" && user.role !== "guardian") {
    return {
      ok: false as const,
      response: jsonError(403, "FORBIDDEN", "회원 또는 학부모 계정에서만 수업을 직접 신청할 수 있습니다."),
    };
  }

  const selectedScope = requireSelectedBranchScope(request, user, db);

  if (selectedScope.response) {
    return { ok: false as const, response: selectedScope.response };
  }

  const member = db.members.find((candidate) => candidate.id === memberId);
  const accessibleMemberIds = getAccessibleMemberIds(user, db, selectedScope.branchIds);

  if (!member || !accessibleMemberIds.includes(member.id)) {
    return { ok: false as const, response: jsonError(404, "NOT_FOUND", "회원을 찾을 수 없습니다.") };
  }

  const session = db.classes.find((candidate) => candidate.id === classId);

  if (!session || session.branchId !== member.branchId) {
    return { ok: false as const, response: jsonError(404, "NOT_FOUND", "수업을 찾을 수 없습니다.") };
  }

  if (selectedScope.selectedBranchId && selectedScope.selectedBranchId !== session.branchId) {
    return {
      ok: false as const,
      response: jsonError(403, "FORBIDDEN", "선택한 지점의 수업만 신청할 수 있습니다."),
    };
  }

  return { db, member, ok: true as const, selectedBranchId: selectedScope.selectedBranchId, session, user };
}

async function updateEnrollment(
  request: NextRequest,
  classId: string,
  body: EnrollmentBody,
  operation: "register" | "cancel",
) {
  const initialDb = await readServerDb();
  const initialContext = getEnrollmentContext(request, initialDb, classId, body.memberId);

  if (!initialContext.ok) {
    return initialContext.response;
  }

  return withServerDbLock(`class-mutation:${classId}`, async () => {
    const db = await readServerDb();
    const context = getEnrollmentContext(request, db, classId, body.memberId);

    if (!context.ok) {
      return context.response;
    }

    const { member, selectedBranchId, session, user } = context;
    const alreadyEnrolled = session.enrolledMemberIds.includes(member.id);

    if (operation === "register" && alreadyEnrolled) {
      return jsonOk({
        ...createBootstrapPayload(db, user, selectedBranchId ?? session.branchId),
        enrollment: { classId: session.id, memberId: member.id, status: "registered", unchanged: true },
      });
    }

    if (operation === "cancel" && !alreadyEnrolled) {
      return jsonOk({
        ...createBootstrapPayload(db, user, selectedBranchId ?? session.branchId),
        enrollment: { classId: session.id, memberId: member.id, status: "cancelled", unchanged: true },
      });
    }

    if (operation === "register") {
      const blockReason = getClassRegistrationBlockReason(db, member, session);

      if (blockReason) {
        return jsonError(422, "BUSINESS_RULE_FAILED", blockReason);
      }
    } else {
      if (Date.parse(session.startsAt) <= Date.now()) {
        return jsonError(422, "BUSINESS_RULE_FAILED", "시작된 수업은 신청을 취소할 수 없습니다.");
      }

      if (db.attendance.some((record) => record.sessionId === session.id && record.memberId === member.id)) {
        return jsonError(422, "BUSINESS_RULE_FAILED", "출석 기록이 있는 수업은 신청을 취소할 수 없습니다.");
      }
    }

    const nextMemberIds = operation === "register"
      ? [...session.enrolledMemberIds, member.id]
      : session.enrolledMemberIds.filter((memberId) => memberId !== member.id);
    const now = new Date().toISOString();
    const auditLog: AuditLog = {
      id: createRuntimeId("audit"),
      branchId: session.branchId,
      actorUserId: user.id,
      action: "class.update",
      targetType: "class",
      targetId: session.id,
      before: { enrolledCount: session.enrolledMemberIds.length },
      after: {
        enrolledCount: nextMemberIds.length,
        memberId: member.id,
        source: "self_registration",
        operation,
      },
      result: "success",
      message: operation === "register" ? "수업을 신청했습니다." : "수업 신청을 취소했습니다.",
      createdAt: now,
    };
    const nextDb = await writeServerDb({
      ...db,
      classes: db.classes.map((candidate) =>
        candidate.id === session.id ? { ...candidate, enrolledMemberIds: nextMemberIds } : candidate,
      ),
      auditLogs: [auditLog, ...db.auditLogs],
    });

    return jsonOk({
      ...createBootstrapPayload(nextDb, user, selectedBranchId ?? session.branchId),
      enrollment: {
        classId: session.id,
        memberId: member.id,
        status: operation === "register" ? "registered" : "cancelled",
        unchanged: false,
      },
    });
  });
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ classId: string }> }) {
  const initialDb = await readServerDb();
  const { user, response } = requireSession(request, initialDb);

  if (!user) {
    return response;
  }

  const body = parseEnrollmentBody(await request.json().catch(() => null));

  if (!body) {
    return jsonError(400, "VALIDATION_ERROR", "신청할 회원 정보가 올바르지 않습니다.");
  }

  const { classId } = await params;
  return updateEnrollment(request, classId, body, "register");
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ classId: string }> }) {
  const initialDb = await readServerDb();
  const { user, response } = requireSession(request, initialDb);

  if (!user) {
    return response;
  }

  const body = parseEnrollmentBody(await request.json().catch(() => null));

  if (!body) {
    return jsonError(400, "VALIDATION_ERROR", "취소할 회원 정보가 올바르지 않습니다.");
  }

  const { classId } = await params;
  return updateEnrollment(request, classId, body, "cancel");
}
