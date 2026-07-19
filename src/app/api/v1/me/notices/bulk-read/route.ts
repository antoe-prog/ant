import { NextRequest } from "next/server";
import type { Notice } from "@/lib/domain";
import { canReadNotice, markNoticeRead } from "@/lib/mock-api";
import { isNoticeReadByUser, noticeStateLockKey } from "@/lib/notices";
import { readServerDb, withServerDbLock, writeServerDb } from "@/server/db";
import { createBootstrapPayload, jsonError, jsonOk, requireSelectedBranchScope, requireSession } from "@/server/api";

export const runtime = "nodejs";

type BulkReadBody = {
  noticeIds?: unknown;
};

const maximumNoticeBatchSize = 50;
const maximumNoticeIdLength = 200;

function normalizeNoticeIds(value: unknown) {
  if (!Array.isArray(value)) {
    return { error: "invalid" as const, noticeIds: [] };
  }

  if (value.length > maximumNoticeBatchSize) {
    return { error: "limit" as const, noticeIds: [] };
  }

  if (value.length === 0 || value.some((item) => typeof item !== "string")) {
    return { error: "invalid" as const, noticeIds: [] };
  }

  const normalizedIds = value.map((item) => item.trim());

  if (normalizedIds.some((noticeId) => !noticeId || noticeId.length > maximumNoticeIdLength)) {
    return { error: "invalid" as const, noticeIds: [] };
  }

  return { error: null, noticeIds: [...new Set(normalizedIds)] };
}

function isNotice(value: Notice | undefined): value is Notice {
  return Boolean(value);
}

export async function POST(request: NextRequest) {
  const initialDb = await readServerDb();
  const { user: initialUser, response } = requireSession(request, initialDb);

  if (!initialUser) {
    return response;
  }

  const body = (await request.json().catch(() => null)) as BulkReadBody | null;
  const parsedNoticeIds = normalizeNoticeIds(body?.noticeIds);

  if (parsedNoticeIds.error === "limit") {
    return jsonError(422, "BUSINESS_RULE_FAILED", "한 번에 읽음 처리할 수 있는 공지는 50건까지입니다.");
  }

  if (parsedNoticeIds.error || parsedNoticeIds.noticeIds.length === 0) {
    return jsonError(400, "VALIDATION_ERROR", "읽음 처리할 공지를 선택해 주세요.");
  }

  const noticeIds = parsedNoticeIds.noticeIds;

  return withServerDbLock(noticeStateLockKey, async () => {
    const db = await readServerDb();
    const { user, response: lockedResponse } = requireSession(request, db);

    if (!user) {
      return lockedResponse;
    }

    const selectedScope = requireSelectedBranchScope(request, user, db);

    if (selectedScope.response) {
      return selectedScope.response;
    }

    const { branchIds, selectedBranchId } = selectedScope;
    const notices = noticeIds.map((noticeId) =>
      db.notices.find(
        (notice) => notice.id === noticeId && canReadNotice(user, db, notice, branchIds),
      ),
    );

    if (notices.some((notice) => !notice)) {
      return jsonError(404, "NOT_FOUND", "공지 일부를 찾을 수 없습니다.");
    }

    const foundNotices = notices.filter(isNotice);
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
  });
}
