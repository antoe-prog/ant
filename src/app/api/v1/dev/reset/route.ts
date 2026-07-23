import { createMockData } from "@/lib/mock-data";
import type { MockDatabase, UserRole } from "@/lib/domain";
import { jsonError, jsonOk } from "@/server/api";
import { resetServerDb, serverDbPaths, writeServerDb } from "@/server/db";
import { createRandomPasswordHash, defaultPilotPassword } from "@/server/auth-password";
import { canResetDevData } from "@/server/dev-reset-policy";
import { hasValidSmokeDataOwnership, hasValidSmokeOwnershipToken } from "@/server/smoke-server-attestation";

const smokePasswordEnvByRole: Record<UserRole, keyof NodeJS.ProcessEnv> = {
  admin: "SMOKE_ADMIN_PASSWORD",
  owner: "SMOKE_OWNER_PASSWORD",
  coach: "SMOKE_COACH_PASSWORD",
  guardian: "SMOKE_GUARDIAN_PASSWORD",
  member: "SMOKE_MEMBER_PASSWORD",
};

async function applyIsolatedSmokePasswords(db: MockDatabase) {
  const rolePasswords = Object.fromEntries(
    Object.entries(smokePasswordEnvByRole).map(([role, envKey]) => [role, process.env[envKey]?.trim() ?? ""]),
  ) as Record<UserRole, string>;
  const configuredPasswords = Object.values(rolePasswords).filter(Boolean);

  if (configuredPasswords.length === 0) {
    return db;
  }

  if (
    configuredPasswords.length !== Object.keys(smokePasswordEnvByRole).length ||
    configuredPasswords.some((password) => password.length < 12 || password === defaultPilotPassword)
  ) {
    throw new Error("Isolated smoke role credentials are incomplete or invalid.");
  }

  return writeServerDb({
    ...db,
    authSessions: [],
    passwordResetChallenges: [],
    users: db.users.map((user) => ({
      ...user,
      passwordHash: createRandomPasswordHash(rolePasswords[user.role]),
    })),
  });
}

export async function POST(request: Request) {
  if (
    !canResetDevData() ||
    !hasValidSmokeOwnershipToken(request.headers) ||
    !(await hasValidSmokeDataOwnership(process.env, serverDbPaths?.dataFile))
  ) {
    return jsonError(404, "NOT_FOUND", "요청한 리소스를 찾을 수 없습니다.");
  }

  const db = await applyIsolatedSmokePasswords(await resetServerDb());
  const baseline = createMockData();

  return jsonOk({
    ok: true,
    counts: {
      branches: db.branches.length,
      users: db.users.length,
      members: db.members.length,
      classes: db.classes.length,
      payments: db.payments.length,
      notices: db.notices.length,
    },
    baselineCounts: {
      branches: baseline.branches.length,
      users: baseline.users.length,
      members: baseline.members.length,
      classes: baseline.classes.length,
      payments: baseline.payments.length,
      notices: baseline.notices.length,
    },
  });
}
