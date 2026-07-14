import { createMockData } from "@/lib/mock-data";
import { jsonError, jsonOk } from "@/server/api";
import { resetServerDb, serverDbPaths } from "@/server/db";
import { canResetDevData } from "@/server/dev-reset-policy";
import { hasValidSmokeDataOwnership, hasValidSmokeOwnershipToken } from "@/server/smoke-server-attestation";

export async function POST(request: Request) {
  if (
    !canResetDevData() ||
    !hasValidSmokeOwnershipToken(request.headers) ||
    !(await hasValidSmokeDataOwnership(process.env, serverDbPaths?.dataFile))
  ) {
    return jsonError(404, "NOT_FOUND", "요청한 리소스를 찾을 수 없습니다.");
  }

  const db = await resetServerDb();
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
