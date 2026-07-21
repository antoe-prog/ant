import { NextRequest } from "next/server";
import type { AuditLog } from "@/lib/domain";
import { getAccessibleBranchIds, upsertAttendance } from "@/lib/mock-api";
import { attendanceStateLockKey } from "@/server/attendance-policy";
import {
  attendanceQrPayloadMaxLength,
  findAttendanceQrChallenge,
  redeemAttendanceQrChallenge,
} from "@/server/attendance-qr";
import { createBootstrapPayload, jsonError, jsonOk, requireSelectedBranchScope, requireSession } from "@/server/api";
import { readServerDb, withServerDbLock, writeServerDb } from "@/server/db";
import { createRuntimeId } from "@/server/runtime-id";

export const runtime = "nodejs";

type AttendanceQrScanBody = {
  payload: string;
  memberId: string;
};

function parseBody(value: unknown): AttendanceQrScanBody | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const candidate = value as Record<string, unknown>;
  const payload = typeof candidate.payload === "string" ? candidate.payload.trim() : "";
  const memberId = typeof candidate.memberId === "string" ? candidate.memberId.trim() : "";

  return payload && payload.length <= attendanceQrPayloadMaxLength && memberId && memberId.length <= 200
    ? { payload, memberId }
    : null;
}

function lookupError(reason: "expired" | "invalid") {
  if (reason === "expired") {
    return jsonError(410, "QR_EXPIRED", "QR 유효시간이 지났습니다. 코치에게 새 QR을 요청해 주세요.");
  }

  return jsonError(400, "INVALID_QR", "파이널 유도 수업 출석 QR이 아닙니다.");
}

export async function POST(request: NextRequest) {
  const initialDb = await readServerDb();
  const { user: initialUser, response: initialResponse } = requireSession(request, initialDb);

  if (!initialUser) {
    return initialResponse;
  }

  if (initialUser.role !== "member" && initialUser.role !== "guardian") {
    return jsonError(403, "FORBIDDEN", "회원 본인 또는 학부모의 본인 수련 프로필만 QR 출석할 수 있습니다.");
  }

  const body = parseBody(await request.json().catch(() => null));

  if (!body) {
    return jsonError(400, "VALIDATION_ERROR", "QR 또는 회원 정보가 올바르지 않습니다.");
  }
  const scanBody = body;

  async function requireScanContext() {
    const db = await readServerDb();
    const { user, response } = requireSession(request, db);

    if (!user) {
      return { ok: false as const, response };
    }

    if (user.role !== "member" && user.role !== "guardian") {
      return {
        ok: false as const,
        response: jsonError(403, "FORBIDDEN", "회원 본인 또는 학부모의 본인 수련 프로필만 QR 출석할 수 있습니다."),
      };
    }

    if (!user.memberIds?.includes(scanBody.memberId)) {
      return {
        ok: false as const,
        response: jsonError(403, "FORBIDDEN", "본인에게 연결된 회원의 출석만 처리할 수 있습니다."),
      };
    }

    const member = db.members.find((candidate) => candidate.id === scanBody.memberId);

    if (!member) {
      return {
        ok: false as const,
        response: jsonError(404, "NOT_FOUND", "연결된 회원 정보를 찾을 수 없습니다."),
      };
    }

    if (user.role === "guardian" && member.ageGroup !== "adult") {
      return {
        ok: false as const,
        response: jsonError(403, "FORBIDDEN", "자녀 대신 QR 출석할 수 없습니다. 학부모 본인의 성인 수련 프로필만 가능합니다."),
      };
    }

    if (!getAccessibleBranchIds(user, db).includes(member.branchId)) {
      return {
        ok: false as const,
        response: jsonError(403, "FORBIDDEN", "회원 지점에 접근할 수 없습니다."),
      };
    }

    if (member.status !== "active" && member.status !== "trial") {
      return {
        ok: false as const,
        response: jsonError(422, "BUSINESS_RULE_FAILED", "활성 또는 체험 회원만 QR 출석할 수 있습니다."),
      };
    }

    const selectedScope = requireSelectedBranchScope(request, user, db);

    if (selectedScope.response) {
      return { ok: false as const, response: selectedScope.response };
    }

    if (selectedScope.selectedBranchId && selectedScope.selectedBranchId !== member.branchId) {
      return {
        ok: false as const,
        response: jsonError(403, "FORBIDDEN", "선택한 지점의 회원 출석만 처리할 수 있습니다."),
      };
    }

    return {
      db,
      member,
      ok: true as const,
      selectedBranchId: selectedScope.selectedBranchId ?? member.branchId,
      user,
    };
  }

  const initialContext = await requireScanContext();

  if (!initialContext.ok) {
    return initialContext.response;
  }

  return withServerDbLock(attendanceStateLockKey, async () => {
    const currentContext = await requireScanContext();

    if (!currentContext.ok) {
      return currentContext.response;
    }

    const { db, member, selectedBranchId, user } = currentContext;
    const lookup = findAttendanceQrChallenge(db, scanBody.payload);

    if (!lookup.ok) {
      return lookupError(lookup.reason);
    }

    const session = db.classes.find((candidate) => candidate.id === lookup.challenge.sessionId);
    const issuingUser = db.users.find((candidate) => candidate.id === lookup.challenge.userId);

    if (!session || !issuingUser || !["coach", "owner", "admin"].includes(issuingUser.role)) {
      return jsonError(422, "BUSINESS_RULE_FAILED", "현재 사용할 수 없는 수업 QR입니다.");
    }

    if (!getAccessibleBranchIds(issuingUser, db).includes(session.branchId)) {
      return jsonError(422, "BUSINESS_RULE_FAILED", "발급자의 지점 권한이 변경되어 사용할 수 없는 QR입니다.");
    }

    if (issuingUser.role === "coach" && session.coachId !== issuingUser.id) {
      return jsonError(422, "BUSINESS_RULE_FAILED", "현재 담당 코치가 발급한 QR이 아닙니다.");
    }

    if (member.branchId !== session.branchId || lookup.challenge.branchId !== session.branchId) {
      return jsonError(422, "BUSINESS_RULE_FAILED", "수업과 회원의 지점이 다릅니다.");
    }

    if (lookup.challenge.redeemedMemberIds.includes(member.id)) {
      return jsonError(409, "QR_ALREADY_USED", "이미 이 QR로 출석 처리했습니다.");
    }

    const autoEnrolled = !session.enrolledMemberIds.includes(member.id);
    const enrollmentAudit: AuditLog | null = autoEnrolled
      ? {
          id: createRuntimeId("audit"),
          branchId: session.branchId,
          actorUserId: user.id,
          action: "class.update",
          targetType: "class",
          targetId: session.id,
          before: { enrolledCount: session.enrolledMemberIds.length },
          after: {
            enrolledCount: session.enrolledMemberIds.length + 1,
            memberId: member.id,
            operation: "register",
            source: "attendance_qr",
          },
          result: "success",
          message: "QR 출석으로 수업 명단에 자동 추가했습니다.",
          createdAt: new Date().toISOString(),
        }
      : null;
    const enrollmentDb = autoEnrolled
      ? {
          ...db,
          classes: db.classes.map((candidate) =>
            candidate.id === session.id
              ? { ...candidate, enrolledMemberIds: [...candidate.enrolledMemberIds, member.id] }
              : candidate,
          ),
          auditLogs: enrollmentAudit ? [enrollmentAudit, ...db.auditLogs] : db.auditLogs,
        }
      : db;
    const existing = db.attendance.find(
      (record) => record.sessionId === session.id && record.memberId === member.id,
    );
    const alreadyRecorded = existing?.status === "present" || existing?.status === "late";
    const attendanceDb = alreadyRecorded
      ? enrollmentDb
      : upsertAttendance(
          enrollmentDb,
          session.id,
          member.id,
          "present",
          user.id,
          autoEnrolled ? "회원 QR 현장 등록 및 출석" : "회원 QR 출석",
        );
    const nextDb = redeemAttendanceQrChallenge(attendanceDb, lookup.challenge.id, member.id);
    const persisted = await writeServerDb(nextDb);

    return jsonOk({
      ...createBootstrapPayload(persisted, user, selectedBranchId),
      scan: {
        alreadyRecorded,
        autoEnrolled,
        className: session.name,
        memberId: member.id,
        memberName: member.name,
        status: alreadyRecorded && existing ? existing.status : "present",
      },
    });
  });
}
