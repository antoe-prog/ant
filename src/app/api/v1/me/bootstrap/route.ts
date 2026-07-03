import { NextRequest } from "next/server";
import { readServerDb } from "@/server/db";
import { createBootstrapPayload, jsonOk, requireSelectedBranchScope, requireSession } from "@/server/api";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const db = await readServerDb();
  const { user, response } = requireSession(request, db);

  if (!user) {
    return response;
  }

  const selectedScope = requireSelectedBranchScope(request, user, db);

  if (selectedScope.response) {
    return selectedScope.response;
  }

  return jsonOk(createBootstrapPayload(db, user, selectedScope.selectedBranchId));
}
