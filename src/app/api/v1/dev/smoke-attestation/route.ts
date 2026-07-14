import { jsonError, jsonOk } from "@/server/api";
import { serverDbPaths } from "@/server/db";
import { canResetDevData } from "@/server/dev-reset-policy";
import { getSmokeOwnershipDigest, hasValidSmokeDataOwnership } from "@/server/smoke-server-attestation";

export async function GET() {
  const ownershipDigest = getSmokeOwnershipDigest();

  if (
    !canResetDevData() ||
    !ownershipDigest ||
    !(await hasValidSmokeDataOwnership(process.env, serverDbPaths?.dataFile))
  ) {
    return jsonError(404, "NOT_FOUND", "요청한 리소스를 찾을 수 없습니다.");
  }

  return jsonOk({ ownershipDigest });
}
