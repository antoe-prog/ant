import { NextRequest } from "next/server";
import type { Notice } from "@/lib/domain";
import { canReadNotice, markNoticeRead } from "@/lib/mock-api";
import { isNoticeReadByUser } from "@/lib/notices";
import { readServerDb, writeServerDb } from "@/server/db";
import { createBootstrapPayload, jsonError, jsonOk, requireSelectedBranchScope, requireSession } from "@/server/api";

export const runtime = "nodejs";

type BulkReadBody = {
  noticeIds?: unknown;
};

function normalizeNoticeIds(value: unknown) {
  if (!Array.isArray(value)) {
    return null;
  }

  return [
    ...new Set(
      value
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  ];
}

function isNotice(value: Notice | undefined): value is Notice {
  return Boolean(value);
}

export async function POST(request: NextRequest) {
  const db = await readServerDb();
  const { user, response } = requireSession(request, db);

  if (!user) {
    return response;
  }

  const body = (await request.json().catch(() => null)) as BulkReadBody | null;
  const noticeIds = normalizeNoticeIds(body?.noticeIds);

  if (!noticeIds || noticeIds.length === 0) {
    return jsonError(400, "VALIDATION_ERROR", "읽음 처리할 공지를 선택해 주세요.");
  }

  if (noticeIds.length > 50) {
    return jsonError(422, "BUSINESS_RULE_FAILED", "한 번에 읽음 처리할 수 있는 공지는 50건까지입니다.");
  }

  const selectedScope = requireSelectedBranchScope(request, user, db);

  if (selectedScope.response) {
    return selectedScope.response;
  }

  const { branchIds, selectedBranchId } = selectedScope;
  const notices = noticeIds.map((noticeId) => db.notices.find((notice) => notice.id === noticeId));
  const missingNoticeIds = noticeIds.filter((_, index) => !notices[index]);

  if (missingNoticeIds.length > 0) {
    return jsonError(404, "NOT_FOUND", "공지 일부를 찾을 수 없습니다.", { missingNoticeIds });
  }

  const foundNotices = notices.filter(isNotice);
  const forbiddenNoticeIds = foundNotices
    .filter((notice) => !canReadNotice(user, db, notice, branchIds))
    .map((notice) => notice.id);

  if (forbiddenNoticeIds.length > 0) {
    return jsonError(403, "FORBIDDEN", "읽음 처리할 수 없는 공지가 포함되어 있습니다.", { forbiddenNoticeIds });
  }

  const unreadNoticeIds = foundNotices
    .filter((notice) => !isNoticeReadByUser(notice, user.id))
    .map((notice) => notice.id);
  const nextDb = unreadNoticeIds.reduce((currentDb, noticeId) => markNoticeRead(currentDb, noticeId, user.id), db);
  const writtenDb = await writeServerDb(nextDb);

  return jsonOk({
    ...createBootstrapPayload(writtenDb, user, selectedBranchId),
    bulkRead: {
      requested: noticeIds.length,
      updated: unreadNoticeIds.length,
    },
  });
}
