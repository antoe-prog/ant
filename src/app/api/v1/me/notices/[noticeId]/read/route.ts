import { NextRequest } from "next/server";
import { canReadNotice, markNoticeRead } from "@/lib/mock-api";
import { noticeStateLockKey } from "@/lib/notices";
import { readServerDb, withServerDbLock, writeServerDb } from "@/server/db";
import { createBootstrapPayload, jsonError, jsonOk, requireSelectedBranchScope, requireSession } from "@/server/api";

export const runtime = "nodejs";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ noticeId: string }> },
) {
  const { noticeId } = await params;
  return withServerDbLock(noticeStateLockKey, async () => {
    const db = await readServerDb();
    const { user, response } = requireSession(request, db);

    if (!user) {
      return response;
    }

    const selectedScope = requireSelectedBranchScope(request, user, db);

    if (selectedScope.response) {
      return selectedScope.response;
    }

    const { branchIds, selectedBranchId } = selectedScope;
    const notice = db.notices.find((item) => item.id === noticeId);

    if (!notice) {
      return jsonError(404, "NOT_FOUND", "공지를 찾을 수 없습니다.");
    }

    if (!canReadNotice(user, db, notice, branchIds)) {
      return jsonError(403, "FORBIDDEN", "읽음 처리할 수 있는 공지가 아닙니다.");
    }

    const nextDb = await writeServerDb(markNoticeRead(db, notice.id, user.id));

    return jsonOk(createBootstrapPayload(nextDb, user, selectedBranchId));
  });
}
