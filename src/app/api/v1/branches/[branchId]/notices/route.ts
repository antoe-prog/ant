import { NextRequest } from "next/server";
import { createHash } from "node:crypto";
import type { AuditLog, Notice, NoticeAudience } from "@/lib/domain";
import { userRoles } from "@/lib/domain";
import { getAccessibleBranchIds, getAccessibleMemberIds } from "@/lib/mock-api";
import { noticePublisherRoles } from "@/lib/notice-permissions";
import {
  getNoticeStringListLimitError,
  getNoticeTextLimitError,
  noticeInputLimits,
} from "@/lib/notice-input-policy";
import { noticeStateLockKey } from "@/lib/notices";
import { readServerDb, withServerDbLock, writeServerDb } from "@/server/db";
import { createBootstrapPayload, jsonError, jsonOk, requireSelectedBranchScope, requireSession } from "@/server/api";
import {
  createNoticePushDispatchRequestAuditLog,
  getNoticeFamilyRecipientCount,
  getNoticePushSubscriptions,
} from "@/server/push-notifications";
import {
  prepareNoticePushDispatchJobs,
  processNotificationOutbox,
} from "@/server/notification-outbox-runner";
import { getNotificationOutboxDispatchSummary } from "@/server/notification-outbox";
import { createRuntimeId } from "@/server/runtime-id";

export const runtime = "nodejs";

type NoticeCreateBody = {
  title?: string;
  body?: string;
  important?: boolean;
  audience?: NoticeAudience[];
  targetClassIds?: string[];
  targetMemberIds?: string[];
};

const noticeIdempotencyKeyPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{15,127}$/;

function parseNoticeIdempotencyKey(value: string | null) {
  if (value === null) {
    return { ok: true as const, value: null };
  }

  if (value !== value.trim() || !noticeIdempotencyKeyPattern.test(value)) {
    return {
      ok: false as const,
      message: "Idempotency-Key는 16~128자의 영문, 숫자, 점, 밑줄, 콜론 또는 하이픈이어야 합니다.",
    };
  }

  return { ok: true as const, value };
}

function digest(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function createNoticeFingerprint(input: {
  audience: NoticeAudience[];
  body: string;
  important: boolean;
  targetClassIds: string[];
  targetMemberIds: string[];
  title: string;
}) {
  return digest(JSON.stringify({
    audience: [...input.audience].sort(),
    body: input.body,
    important: input.important,
    targetClassIds: [...input.targetClassIds].sort(),
    targetMemberIds: [...input.targetMemberIds].sort(),
    title: input.title,
  }));
}

function isValidAudience(value: string): value is NoticeAudience {
  return value === "all" || userRoles.includes(value as (typeof userRoles)[number]);
}

function getNoticeBodyTypeError(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return "공지 정보가 올바른 JSON 객체가 아닙니다.";
  }

  const body = value as Record<string, unknown>;

  for (const [field, label] of [
    ["title", "공지 제목"],
    ["body", "공지 본문"],
  ] as const) {
    if (body[field] !== undefined && typeof body[field] !== "string") {
      return `${label} 값의 형식이 올바르지 않습니다.`;
    }
  }

  if (body.important !== undefined && typeof body.important !== "boolean") {
    return "중요 공지 여부 값의 형식이 올바르지 않습니다.";
  }

  for (const [field, label] of [
    ["audience", "공지 대상"],
    ["targetClassIds", "대상 수업"],
    ["targetMemberIds", "대상 회원"],
  ] as const) {
    if (body[field] !== undefined && (!Array.isArray(body[field]) || body[field].some((item) => typeof item !== "string"))) {
      return `${label} 목록의 형식이 올바르지 않습니다.`;
    }
  }

  return null;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ branchId: string }> },
) {
  const { branchId } = await params;
  const initialDb = await readServerDb();
  const { user: initialUser, response } = requireSession(request, initialDb);

  if (!initialUser) {
    return response;
  }

  if (!noticePublisherRoles.has(initialUser.role)) {
    return jsonError(403, "FORBIDDEN", "공지 작성 권한이 없습니다.");
  }

  if (!getAccessibleBranchIds(initialUser, initialDb).includes(branchId)) {
    return jsonError(403, "FORBIDDEN", "선택한 지점에 공지를 작성할 수 없습니다.");
  }

  const initialSelectedScope = requireSelectedBranchScope(request, initialUser, initialDb);

  if (initialSelectedScope.response) {
    return initialSelectedScope.response;
  }

  if (initialSelectedScope.selectedBranchId && initialSelectedScope.selectedBranchId !== branchId) {
    return jsonError(403, "FORBIDDEN", "선택한 지점에 공지를 작성할 수 없습니다.");
  }

  const parsedIdempotencyKey = parseNoticeIdempotencyKey(request.headers.get("idempotency-key"));

  if (!parsedIdempotencyKey.ok) {
    return jsonError(400, "INVALID_IDEMPOTENCY_KEY", parsedIdempotencyKey.message);
  }

  const rawBody = await request.json().catch(() => null);
  const bodyTypeError = getNoticeBodyTypeError(rawBody);

  if (bodyTypeError) {
    return jsonError(400, "VALIDATION_ERROR", bodyTypeError);
  }

  const body = rawBody as NoticeCreateBody;
  const title = body.title?.trim() ?? "";
  const noticeBody = body.body?.trim() ?? "";
  const important = body.important === true;

  const inputLimitError =
    getNoticeTextLimitError({ body: noticeBody, title }) ??
    getNoticeStringListLimitError(body.audience, {
      label: "공지 대상",
      maximumItems: noticeInputLimits.audienceItems,
    }) ??
    getNoticeStringListLimitError(body.targetClassIds, {
      label: "대상 수업",
      maximumItems: noticeInputLimits.classTargetItems,
    }) ??
    getNoticeStringListLimitError(body.targetMemberIds, {
      label: "대상 회원",
      maximumItems: noticeInputLimits.memberTargetItems,
    });

  if (inputLimitError) {
    return jsonError(400, "VALIDATION_ERROR", inputLimitError);
  }

  const audience = [...new Set(body.audience ?? [])];
  const targetClassIds = [...new Set(body.targetClassIds ?? [])].filter(Boolean);
  const requestedTargetMemberIds = [...new Set(body.targetMemberIds ?? [])].filter(Boolean);

  if (!title || !noticeBody) {
    return jsonError(400, "VALIDATION_ERROR", "공지 제목과 본문이 필요합니다.");
  }

  if (audience.length === 0 || audience.some((item) => !isValidAudience(item))) {
    return jsonError(400, "VALIDATION_ERROR", "공지 대상이 올바르지 않습니다.");
  }

  const creation = await withServerDbLock(noticeStateLockKey, async () => {
    const db = await readServerDb();
    const { user, response: lockedResponse } = requireSession(request, db);

    if (!user) {
      return lockedResponse;
    }

    if (!noticePublisherRoles.has(user.role)) {
      return jsonError(403, "FORBIDDEN", "공지 작성 권한이 없습니다.");
    }

    if (!getAccessibleBranchIds(user, db).includes(branchId)) {
      return jsonError(403, "FORBIDDEN", "선택한 지점에 공지를 작성할 수 없습니다.");
    }

    const selectedScope = requireSelectedBranchScope(request, user, db);

    if (selectedScope.response) {
      return selectedScope.response;
    }

    if (selectedScope.selectedBranchId && selectedScope.selectedBranchId !== branchId) {
      return jsonError(403, "FORBIDDEN", "선택한 지점에 공지를 작성할 수 없습니다.");
    }

    if (!db.branches.some((candidate) => candidate.id === branchId)) {
      return jsonError(404, "NOT_FOUND", "지점을 찾을 수 없습니다.");
    }

    const invalidClassIds = targetClassIds.filter(
      (classId) => !db.classes.some((session) => session.id === classId && session.branchId === branchId),
    );
    const invalidMemberIds = requestedTargetMemberIds.filter(
      (memberId) => !db.members.some((member) => member.id === memberId && member.branchId === branchId),
    );

    if (invalidClassIds.length > 0 || invalidMemberIds.length > 0) {
      return jsonError(422, "BUSINESS_RULE_FAILED", "공지 대상 반/회원이 선택한 지점에 속하지 않습니다.", {
        invalidClassIds,
        invalidMemberIds,
      });
    }

    let targetMemberIds = requestedTargetMemberIds;

    if (user.role === "coach") {
      const coachClassIds = new Set(
        db.classes
          .filter((session) => session.branchId === branchId && session.coachId === user.id)
          .map((session) => session.id),
      );
      const coachMemberIds = new Set(getAccessibleMemberIds(user, db, [branchId]));
      const outOfScopeClassIds = targetClassIds.filter((classId) => !coachClassIds.has(classId));
      const outOfScopeMemberIds = targetMemberIds.filter((memberId) => !coachMemberIds.has(memberId));

      if (outOfScopeClassIds.length > 0 || outOfScopeMemberIds.length > 0) {
        return jsonError(403, "FORBIDDEN", "담당 수업과 담당 회원에게만 공지를 발행할 수 있습니다.", {
          outOfScopeClassIds,
          outOfScopeMemberIds,
        });
      }

      if (targetClassIds.length === 0 && targetMemberIds.length === 0) {
        targetMemberIds = [...coachMemberIds];
      }

      if (targetClassIds.length === 0 && targetMemberIds.length === 0) {
        return jsonError(422, "BUSINESS_RULE_FAILED", "공지 받을 담당 회원이 없습니다.");
      }
    }

    const idempotencyFingerprint = parsedIdempotencyKey.value
      ? createNoticeFingerprint({
          audience,
          body: noticeBody,
          important,
          targetClassIds,
          targetMemberIds,
          title,
        })
      : null;
    const idempotencyDigest = parsedIdempotencyKey.value ? digest(parsedIdempotencyKey.value) : null;
    const replayCreationAudit = idempotencyDigest
      ? db.auditLogs.find(
          (auditLog) =>
            auditLog.action === "notice.create" &&
            auditLog.actorUserId === user.id &&
            auditLog.branchId === branchId &&
            auditLog.after?.idempotencyDigest === idempotencyDigest,
        )
      : null;

    if (replayCreationAudit) {
      if (replayCreationAudit.after?.idempotencyFingerprint !== idempotencyFingerprint) {
        return jsonError(409, "IDEMPOTENCY_CONFLICT", "같은 요청 키에 다른 공지 내용이 전달되었습니다.");
      }

      const replayNotice = db.notices.find(
        (notice) => notice.id === replayCreationAudit.targetId && notice.branchId === branchId,
      );
      const dispatchAuditLogId = typeof replayCreationAudit.after?.dispatchAuditLogId === "string"
        ? replayCreationAudit.after.dispatchAuditLogId
        : "";
      const replayDispatchAudit = db.auditLogs.find(
        (auditLog) =>
          auditLog.id === dispatchAuditLogId &&
          auditLog.action === "notification.dispatch" &&
          auditLog.targetId === replayCreationAudit.targetId,
      );

      if (!replayNotice || !replayDispatchAudit) {
        return jsonError(409, "IDEMPOTENCY_CONFLICT", "이전 공지 발행 결과가 변경되어 재사용할 수 없습니다.");
      }

      return {
        actorUserId: user.id,
        auditLogId: replayDispatchAudit.id,
        candidateCount: Number(replayDispatchAudit.after?.candidateCount ?? 0),
        noticeId: replayNotice.id,
        recipientCount: Number(replayDispatchAudit.after?.recipientCount ?? 0),
        replayed: true,
        selectedBranchId: selectedScope.selectedBranchId ?? branchId,
      };
    }

    const now = new Date().toISOString();
    const noticeId = createRuntimeId("notice");
    const noticeAuditLogId = createRuntimeId("audit");
    const dispatchAuditLogId = createRuntimeId("audit");
    const nextNotice: Notice = {
      id: noticeId,
      branchId,
      title,
      body: noticeBody,
      important,
      audience,
      createdByUserId: user.id,
      createdAt: now,
      readByUserIds: [],
      ...(targetClassIds.length > 0 ? { targetClassIds } : {}),
      ...(targetMemberIds.length > 0 ? { targetMemberIds } : {}),
    };
    const dbWithNotice = {
      ...db,
      notices: [nextNotice, ...db.notices],
    };
    const recipientCount = getNoticeFamilyRecipientCount(dbWithNotice, nextNotice);
    const candidateCount = getNoticePushSubscriptions(dbWithNotice, nextNotice).length;
    const noticeAuditLog: AuditLog = {
      id: noticeAuditLogId,
      branchId,
      actorUserId: user.id,
      action: "notice.create",
      targetType: "notice",
      targetId: noticeId,
      before: null,
      after: {
        title,
        important,
        audience,
        createdByUserId: user.id,
        targetClassIds,
        targetMemberIds,
        ...(idempotencyDigest && idempotencyFingerprint
          ? { dispatchAuditLogId, idempotencyDigest, idempotencyFingerprint }
          : {}),
      },
      result: "success",
      message: "공지를 작성했습니다.",
      createdAt: now,
    };
    const dispatchRequestAuditLog = createNoticePushDispatchRequestAuditLog({
      auditId: dispatchAuditLogId,
      branchId,
      actorUserId: user.id,
      noticeId,
      candidateCount,
      recipientCount,
      requestedAt: now,
      autoDispatchedOnCreate: true,
    });
    const dbWithAudits = {
      ...dbWithNotice,
      auditLogs: [dispatchRequestAuditLog, noticeAuditLog, ...db.auditLogs],
    };
    const prepared = prepareNoticePushDispatchJobs(dbWithAudits, nextNotice, dispatchRequestAuditLog, now);
    await writeServerDb(prepared.db);

    return {
      actorUserId: user.id,
      auditLogId: dispatchRequestAuditLog.id,
      candidateCount,
      noticeId,
      recipientCount,
      replayed: false,
      selectedBranchId: selectedScope.selectedBranchId ?? branchId,
    };
  });

  if (creation instanceof Response) {
    return creation;
  }

  if (!creation.replayed) {
    try {
      await processNotificationOutbox({ auditLogId: creation.auditLogId, limit: Math.max(creation.candidateCount, 1) });
    } catch {
      // The durable jobs remain pending or leased for the scheduled worker.
    }
  }

  const responseDb = await readServerDb();
  const actor = responseDb.users.find((candidate) => candidate.id === creation.actorUserId) ?? initialUser;
  const summary = getNotificationOutboxDispatchSummary(responseDb, creation.auditLogId);
  const requestAudit = responseDb.auditLogs.find((auditLog) => auditLog.id === creation.auditLogId);

  return jsonOk({
    ...createBootstrapPayload(responseDb, actor, creation.selectedBranchId),
    notice: { id: creation.noticeId },
    idempotency: { replayed: creation.replayed },
    push: {
      ...summary,
      recipientCount: creation.recipientCount,
      message: requestAudit?.message ?? "공지 알림을 대기열에 저장했습니다.",
    },
  }, {
    headers: { "Idempotency-Replayed": String(creation.replayed) },
  });
}
