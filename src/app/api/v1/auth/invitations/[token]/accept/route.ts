import { NextRequest } from "next/server";
import type { AuditLog } from "@/lib/domain";
import { readServerDb, writeServerDb } from "@/server/db";
import { createBootstrapPayload, jsonError, jsonOk, sessionCookieName } from "@/server/api";
import { createSessionCookieOptions } from "@/server/auth-policy";
import { createRandomPasswordHash, defaultPilotPassword } from "@/server/auth-password";

export const runtime = "nodejs";

type InvitationAcceptBody = {
  password?: string;
};

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  const body = (await request.json().catch(() => null)) as InvitationAcceptBody | null;
  const password = body?.password?.trim() ?? "";
  const db = await readServerDb();
  const invitedUser = db.users.find((candidate) => candidate.invitationToken === token);

  if (!invitedUser) {
    return jsonError(404, "NOT_FOUND", "초대 링크를 찾을 수 없습니다.");
  }

  if (invitedUser.invitationStatus === "accepted") {
    return jsonError(409, "BUSINESS_RULE_FAILED", "이미 사용된 초대 링크입니다. 로그인 화면에서 계정 비밀번호로 접속해 주세요.");
  }

  if (password === defaultPilotPassword) {
    return jsonError(422, "BUSINESS_RULE_FAILED", "다른 비밀번호를 입력해 주세요.");
  }

  if (password.length < 12) {
    return jsonError(400, "VALIDATION_ERROR", "비밀번호는 12자 이상이어야 합니다.");
  }

  const now = new Date().toISOString();
  const auditLog: AuditLog = {
    id: `audit-${Date.now()}-${db.auditLogs.length + 1}`,
    branchId: invitedUser.branchIds[0] ?? null,
    actorUserId: invitedUser.id,
    action: "auth.invite.accept",
    targetType: "auth",
    targetId: invitedUser.id,
    before: { invitationStatus: invitedUser.invitationStatus ?? "pending" },
    after: { invitationStatus: "accepted", passwordSet: true },
    result: "success",
    message: "초대 수락과 비밀번호 설정을 완료했습니다.",
    createdAt: now,
  };
  const nextDb = await writeServerDb({
    ...db,
    users: db.users.map((candidate) =>
      candidate.id === invitedUser.id
        ? {
            ...candidate,
            invitationStatus: "accepted",
            acceptedAt: now,
            passwordHash: createRandomPasswordHash(password),
            passwordUpdatedAt: now,
          }
        : candidate,
    ),
    auditLogs: [auditLog, ...db.auditLogs],
  });
  const acceptedUser = nextDb.users.find((candidate) => candidate.id === invitedUser.id) ?? invitedUser;
  const response = jsonOk(createBootstrapPayload(nextDb, acceptedUser, acceptedUser.branchIds[0] ?? null));

  response.cookies.set(sessionCookieName, acceptedUser.id, createSessionCookieOptions());

  return response;
}
