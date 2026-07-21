import { NextRequest } from "next/server";
import { getAccessibleBranchIds } from "@/lib/mock-api";
import { attendanceStateLockKey } from "@/server/attendance-policy";
import { createAttendanceQrChallenge } from "@/server/attendance-qr";
import { jsonError, jsonOk, requireSelectedBranchScope, requireSession } from "@/server/api";
import { readServerDb, withServerDbLock, writeServerDb } from "@/server/db";

export const runtime = "nodejs";

type AttendanceQrIssueBody = {
  sessionId: string;
};

function parseBody(value: unknown): AttendanceQrIssueBody | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const sessionId = (value as Record<string, unknown>).sessionId;

  return typeof sessionId === "string" && sessionId.trim().length > 0 && sessionId.length <= 200
    ? { sessionId: sessionId.trim() }
    : null;
}

function canIssueAttendanceQr(role: string) {
  return role === "coach" || role === "owner" || role === "admin";
}

export async function POST(request: NextRequest) {
  const initialDb = await readServerDb();
  const { user: initialUser, response: initialResponse } = requireSession(request, initialDb);

  if (!initialUser) {
    return initialResponse;
  }

  if (!canIssueAttendanceQr(initialUser.role)) {
    return jsonError(403, "FORBIDDEN", "코치·대표·총괄 어드민만 수업 출석 QR을 만들 수 있습니다.");
  }

  const body = parseBody(await request.json().catch(() => null));

  if (!body) {
    return jsonError(400, "VALIDATION_ERROR", "출석 QR을 만들 수업 정보가 올바르지 않습니다.");
  }
  const issueBody = body;

  async function requireIssueContext() {
    const db = await readServerDb();
    const { user, response } = requireSession(request, db);

    if (!user) {
      return { ok: false as const, response };
    }

    if (!canIssueAttendanceQr(user.role)) {
      return {
        ok: false as const,
        response: jsonError(403, "FORBIDDEN", "코치·대표·총괄 어드민만 수업 출석 QR을 만들 수 있습니다."),
      };
    }

    const session = db.classes.find((candidate) => candidate.id === issueBody.sessionId);

    if (!session) {
      return {
        ok: false as const,
        response: jsonError(404, "NOT_FOUND", "선택한 수업을 찾을 수 없습니다."),
      };
    }

    if (!getAccessibleBranchIds(user, db).includes(session.branchId)) {
      return {
        ok: false as const,
        response: jsonError(403, "FORBIDDEN", "선택한 수업의 지점에 접근할 수 없습니다."),
      };
    }

    if (user.role === "coach" && session.coachId !== user.id) {
      return {
        ok: false as const,
        response: jsonError(403, "FORBIDDEN", "담당 수업의 출석 QR만 만들 수 있습니다."),
      };
    }

    const selectedScope = requireSelectedBranchScope(request, user, db);

    if (selectedScope.response) {
      return { ok: false as const, response: selectedScope.response };
    }

    if (selectedScope.selectedBranchId && selectedScope.selectedBranchId !== session.branchId) {
      return {
        ok: false as const,
        response: jsonError(403, "FORBIDDEN", "선택한 지점의 수업 QR만 만들 수 있습니다."),
      };
    }

    return { db, ok: true as const, session, user };
  }

  const initialContext = await requireIssueContext();

  if (!initialContext.ok) {
    return initialContext.response;
  }

  return withServerDbLock(attendanceStateLockKey, async () => {
    const currentContext = await requireIssueContext();

    if (!currentContext.ok) {
      return currentContext.response;
    }

    const { db, session, user } = currentContext;
    const issued = createAttendanceQrChallenge(db, {
      branchId: session.branchId,
      sessionId: session.id,
      userId: user.id,
    });

    await writeServerDb(issued.db);

    return jsonOk({
      className: session.name,
      expiresAt: issued.challenge.expiresAt,
      payload: issued.payload,
    });
  });
}
