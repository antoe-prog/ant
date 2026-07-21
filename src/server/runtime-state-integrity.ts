import type { AuditLog, MockDatabase, UserRole } from "../lib/domain.ts";
import { normalizePhoneNumber } from "../lib/phone.ts";
import { createRuntimeId } from "./runtime-id.ts";
import { isAcceptedBranchOwner, isActiveAdmin } from "./user-administration.ts";
import { findAcceptedBranchOperatorId } from "./user-operational-reassignment.ts";

const runtimeCollectionKeys = [
  "branches",
  "users",
  "members",
  "classes",
  "attendance",
  "counselingNotes",
  "promotions",
  "tournaments",
  "payments",
  "notices",
  "authSessions",
  "attendanceQrChallenges",
  "pushSubscriptions",
  "pushDispatchJobs",
  "pilotReadinessChecks",
  "pilotIncidents",
  "pilotOperationLogs",
  "auditLogs",
] as const satisfies readonly (keyof MockDatabase)[];

const operationalRoles = ["coach", "owner", "admin"] as const satisfies readonly UserRole[];

export type RuntimeStateIntegrityIssue = {
  fingerprint: string;
  repairable: boolean;
  rule: string;
  severity: "blocker" | "warning";
  targetId: string;
  details: Record<string, unknown>;
};

export type RuntimeStateIntegrityRepair = {
  branchId: string | null;
  targetId: string;
  targetType: AuditLog["targetType"];
  rule: string;
  before: Record<string, unknown>;
  after: Record<string, unknown>;
};

export class RuntimeStateIntegrityError extends Error {
  rule: string;
  targetId: string;

  constructor(rule: string, targetId: string) {
    super(`Runtime state integrity violation in ${rule}:${targetId}`);
    this.name = "RuntimeStateIntegrityError";
    this.rule = rule;
    this.targetId = targetId;
  }
}

export class RuntimeStateWriteIntegrityError extends RuntimeStateIntegrityError {
  issues: RuntimeStateIntegrityIssue[];

  constructor(issues: RuntimeStateIntegrityIssue[]) {
    super(issues[0]?.rule ?? "unknown", issues[0]?.targetId ?? "unknown");
    this.name = "RuntimeStateWriteIntegrityError";
    this.issues = issues;
  }
}

function assertUniqueValues(
  values: Array<{ targetId: string; value: string }>,
  rule: string,
  { allowEmpty = false }: { allowEmpty?: boolean } = {},
) {
  const seen = new Set<string>();

  for (const { targetId, value } of values) {
    if (!value) {
      if (allowEmpty) {
        continue;
      }
      throw new RuntimeStateIntegrityError(rule, targetId);
    }
    if (seen.has(value)) {
      throw new RuntimeStateIntegrityError(rule, targetId);
    }
    seen.add(value);
  }
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(stableValue);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, stableValue(nested)]),
    );
  }
  return value;
}

function createIssue(
  rule: string,
  targetId: string,
  severity: RuntimeStateIntegrityIssue["severity"],
  repairable: boolean,
  details: Record<string, unknown>,
): RuntimeStateIntegrityIssue {
  const normalizedDetails = stableValue(details) as Record<string, unknown>;
  return {
    fingerprint: `${rule}:${targetId}:${JSON.stringify(normalizedDetails)}`,
    repairable,
    rule,
    severity,
    targetId,
    details: normalizedDetails,
  };
}

function isValidOperator(
  user: MockDatabase["users"][number] | undefined,
  branchId: string,
) {
  return Boolean(
    user &&
      user.invitationStatus !== "pending" &&
      operationalRoles.includes(user.role as (typeof operationalRoles)[number]) &&
      user.branchIds.includes(branchId),
  );
}

// This validator must never repair data. Reads may contain known legacy dangling
// references; those are reported by inspectRuntimeStateIntegrity and reconciled explicitly.
export function validateRuntimeStateIntegrity(db: MockDatabase): MockDatabase {
  for (const collection of runtimeCollectionKeys) {
    assertUniqueValues(
      (db[collection] ?? []).map((item) => ({ targetId: item.id, value: item.id })),
      `${collection}.id`,
    );
  }

  assertUniqueValues(
    db.users.map((user) => ({ targetId: user.id, value: normalizePhoneNumber(user.phone ?? "") })),
    "users.phone",
    { allowEmpty: true },
  );
  assertUniqueValues(
    db.users.map((user) => ({ targetId: user.id, value: user.email?.trim().toLowerCase() ?? "" })),
    "users.email",
    { allowEmpty: true },
  );

  assertUniqueValues(
    db.authSessions.map((session) => ({ targetId: session.id, value: session.tokenHash })),
    "authSessions.tokenHash",
  );

  for (const session of db.authSessions) {
    if (
      !/^[a-f0-9]{64}$/.test(session.tokenHash) ||
      !Number.isFinite(Date.parse(session.expiresAt)) ||
      !db.users.some((user) => user.id === session.userId)
    ) {
      throw new RuntimeStateIntegrityError("authSessions.format", session.id);
    }
  }

  assertUniqueValues(
    (db.attendanceQrChallenges ?? []).map((challenge) => ({ targetId: challenge.id, value: challenge.tokenHash })),
    "attendanceQrChallenges.tokenHash",
  );

  for (const challenge of db.attendanceQrChallenges ?? []) {
    if (
      !/^[a-f0-9]{64}$/.test(challenge.tokenHash) ||
      !challenge.userId ||
      !challenge.branchId ||
      !challenge.sessionId ||
      !Array.isArray(challenge.redeemedMemberIds) ||
      new Set(challenge.redeemedMemberIds).size !== challenge.redeemedMemberIds.length ||
      challenge.redeemedMemberIds.some((memberId) => typeof memberId !== "string" || memberId.length === 0) ||
      !Number.isFinite(Date.parse(challenge.createdAt)) ||
      !Number.isFinite(Date.parse(challenge.expiresAt)) ||
      Date.parse(challenge.expiresAt) <= Date.parse(challenge.createdAt)
    ) {
      throw new RuntimeStateIntegrityError("attendanceQrChallenges.format", challenge.id);
    }
  }

  return db;
}

export function inspectRuntimeStateIntegrity(db: MockDatabase): RuntimeStateIntegrityIssue[] {
  const issues: RuntimeStateIntegrityIssue[] = [];
  const branchIds = new Set(db.branches.map((branch) => branch.id));
  const userById = new Map(db.users.map((user) => [user.id, user]));
  const memberById = new Map(db.members.map((member) => [member.id, member]));
  const classById = new Map(db.classes.map((session) => [session.id, session]));

  if (db.users.length > 0 && !db.users.some(isActiveAdmin)) {
    issues.push(createIssue("users.activeAdminCoverage", "global", "blocker", false, {}));
  }

  for (const user of db.users) {
    const validBranchIds = user.branchIds.filter((branchId) => branchIds.has(branchId));
    for (const branchId of user.branchIds.filter((branchId) => !branchIds.has(branchId))) {
      issues.push(createIssue("users.branchIds", user.id, "blocker", true, { branchId }));
    }
    if (user.role !== "admin" && validBranchIds.length === 0) {
      issues.push(createIssue("users.branchScope", user.id, "blocker", false, { role: user.role }));
    }
    for (const [field, memberIds] of [
      ["memberIds", user.memberIds ?? []],
      ["childMemberIds", user.childMemberIds ?? []],
    ] as const) {
      for (const memberId of memberIds) {
        const member = memberById.get(memberId);
        if (member && user.branchIds.includes(member.branchId)) {
          continue;
        }
        issues.push(createIssue("users.memberLinks", user.id, "warning", true, {
          field,
          memberId,
        }));
      }
    }
  }

  for (const member of db.members) {
    if (!branchIds.has(member.branchId)) {
      issues.push(createIssue("members.branchId", member.id, "blocker", false, {
        branchId: member.branchId,
      }));
    }
    if (!isValidOperator(userById.get(member.primaryCoachId), member.branchId)) {
      issues.push(createIssue("members.primaryCoachId", member.id, "blocker", Boolean(findAcceptedBranchOperatorId(db, member.branchId)), {
        assignedUserId: member.primaryCoachId,
        branchId: member.branchId,
      }));
    }

    for (const guardianId of member.guardianIds) {
      const guardian = userById.get(guardianId);
      if (guardian && guardian.role === "guardian" && guardian.branchIds.includes(member.branchId)) {
        continue;
      }
      issues.push(createIssue("members.guardianIds", member.id, "warning", true, {
        branchId: member.branchId,
        guardianId,
      }));
    }
  }

  for (const session of db.classes) {
    if (!branchIds.has(session.branchId)) {
      issues.push(createIssue("classes.branchId", session.id, "blocker", false, {
        branchId: session.branchId,
      }));
    }
    if (!isValidOperator(userById.get(session.coachId), session.branchId)) {
      issues.push(createIssue("classes.coachId", session.id, "blocker", Boolean(findAcceptedBranchOperatorId(db, session.branchId)), {
        assignedUserId: session.coachId,
        branchId: session.branchId,
      }));
    }

    for (const memberId of session.enrolledMemberIds) {
      if (memberById.get(memberId)?.branchId === session.branchId) {
        continue;
      }
      issues.push(createIssue("classes.enrolledMemberIds", session.id, "warning", true, {
        branchId: session.branchId,
        memberId,
      }));
    }
  }

  for (const attendance of db.attendance) {
    const session = classById.get(attendance.sessionId);
    const member = memberById.get(attendance.memberId);
    if (!session || !member || session.branchId !== member.branchId) {
      issues.push(createIssue("attendance.references", attendance.id, "warning", false, {
        memberId: attendance.memberId,
        sessionId: attendance.sessionId,
      }));
    }
  }

  for (const payment of db.payments) {
    if (!branchIds.has(payment.branchId) || memberById.get(payment.memberId)?.branchId !== payment.branchId) {
      issues.push(createIssue("payments.references", payment.id, "blocker", false, {
        branchId: payment.branchId,
        memberId: payment.memberId,
      }));
    }
  }

  for (const notice of db.notices) {
    if (!branchIds.has(notice.branchId)) {
      issues.push(createIssue("notices.branchId", notice.id, "blocker", false, {
        branchId: notice.branchId,
      }));
    }
    for (const classId of notice.targetClassIds ?? []) {
      if (classById.get(classId)?.branchId === notice.branchId) {
        continue;
      }
      issues.push(createIssue("notices.targets", notice.id, "warning", true, {
        branchId: notice.branchId,
        classId,
        field: "targetClassIds",
      }));
    }
    for (const memberId of notice.targetMemberIds ?? []) {
      if (memberById.get(memberId)?.branchId === notice.branchId) {
        continue;
      }
      issues.push(createIssue("notices.targets", notice.id, "warning", true, {
        branchId: notice.branchId,
        field: "targetMemberIds",
        memberId,
      }));
    }
  }

  for (const subscription of db.pushSubscriptions) {
    if (!userById.has(subscription.userId)) {
      issues.push(createIssue("pushSubscriptions.userId", subscription.id, "warning", true, {
        userId: subscription.userId,
      }));
      continue;
    }
    for (const branchId of subscription.branchIds.filter((branchId) => !branchIds.has(branchId))) {
      issues.push(createIssue("pushSubscriptions.branchIds", subscription.id, "warning", true, {
        branchId,
      }));
    }
  }

  return issues;
}

export function assertNoNewRuntimeStateIntegrityIssues(
  previous: MockDatabase | null,
  next: MockDatabase,
): MockDatabase {
  const previousFingerprintCounts = new Map<string, number>();
  for (const issue of previous ? inspectRuntimeStateIntegrity(previous) : []) {
    previousFingerprintCounts.set(issue.fingerprint, (previousFingerprintCounts.get(issue.fingerprint) ?? 0) + 1);
  }
  const seenNextFingerprintCounts = new Map<string, number>();
  const newIssues = inspectRuntimeStateIntegrity(next).filter((issue) => {
    const nextCount = (seenNextFingerprintCounts.get(issue.fingerprint) ?? 0) + 1;
    seenNextFingerprintCounts.set(issue.fingerprint, nextCount);
    return nextCount > (previousFingerprintCounts.get(issue.fingerprint) ?? 0);
  });

  if (previous) {
    if (
      previous.users.some(isActiveAdmin) &&
      !next.users.some(isActiveAdmin) &&
      !newIssues.some((issue) => issue.rule === "users.activeAdminCoverage")
    ) {
      newIssues.push(createIssue("users.activeAdminCoverage", "global", "blocker", false, {}));
    }

    const nextBranchIds = new Set(next.branches.map((branch) => branch.id));
    for (const branch of previous.branches) {
      if (
        nextBranchIds.has(branch.id) &&
        previous.users.some((user) => isAcceptedBranchOwner(user, branch.id)) &&
        !next.users.some((user) => isAcceptedBranchOwner(user, branch.id))
      ) {
        newIssues.push(createIssue("users.branchOwnerCoverage", branch.id, "blocker", false, {}));
      }
    }
  }

  if (newIssues.length > 0) {
    throw new RuntimeStateWriteIntegrityError(newIssues);
  }

  return next;
}

export function reconcileRuntimeStateIntegrity(
  db: MockDatabase,
  options: {
    actorUserId: string;
    createId?: () => string;
    now?: string;
  },
) {
  const repairs: RuntimeStateIntegrityRepair[] = [];
  const userById = new Map(db.users.map((user) => [user.id, user]));
  const memberById = new Map(db.members.map((member) => [member.id, member]));
  const classById = new Map(db.classes.map((session) => [session.id, session]));
  const branchIds = new Set(db.branches.map((branch) => branch.id));
  const addRepair = (repair: RuntimeStateIntegrityRepair) => repairs.push(repair);
  const auditActor = userById.get(options.actorUserId);

  if (!auditActor || auditActor.role !== "admin" || auditActor.invitationStatus === "pending") {
    throw new RuntimeStateIntegrityError("auditLogs.actorUserId", options.actorUserId);
  }

  const users = db.users.map((user) => {
    const validBranchIds = user.branchIds.filter((branchId) => branchIds.has(branchId));
    if (validBranchIds.length !== user.branchIds.length) {
      addRepair({
        branchId: validBranchIds[0] ?? null,
        targetId: user.id,
        targetType: "user",
        rule: "users.branchIds",
        before: { branchCount: user.branchIds.length },
        after: { branchCount: validBranchIds.length },
      });
    }
    const memberIds = user.memberIds?.filter((memberId) => {
      const member = memberById.get(memberId);
      return Boolean(member && validBranchIds.includes(member.branchId));
    });
    const childMemberIds = user.childMemberIds?.filter((memberId) => {
      const member = memberById.get(memberId);
      return Boolean(member && validBranchIds.includes(member.branchId));
    });
    const memberLinksChanged =
      (memberIds?.length ?? 0) !== (user.memberIds?.length ?? 0) ||
      (childMemberIds?.length ?? 0) !== (user.childMemberIds?.length ?? 0);
    if (memberLinksChanged) {
      addRepair({
        branchId: validBranchIds[0] ?? null,
        targetId: user.id,
        targetType: "user",
        rule: "users.memberLinks",
        before: { childMemberCount: user.childMemberIds?.length ?? 0, memberCount: user.memberIds?.length ?? 0 },
        after: { childMemberCount: childMemberIds?.length ?? 0, memberCount: memberIds?.length ?? 0 },
      });
    }
    if (validBranchIds.length === user.branchIds.length && !memberLinksChanged) {
      return user;
    }
    return {
      ...user,
      branchIds: validBranchIds,
      ...(user.memberIds ? { memberIds } : {}),
      ...(user.childMemberIds ? { childMemberIds } : {}),
    };
  });

  const members = db.members.map((member) => {
    let primaryCoachId = member.primaryCoachId;
    if (!isValidOperator(userById.get(primaryCoachId), member.branchId)) {
      const fallbackUserId = findAcceptedBranchOperatorId(db, member.branchId);
      if (fallbackUserId) {
        addRepair({
          branchId: member.branchId,
          targetId: member.id,
          targetType: "member",
          rule: "members.primaryCoachId",
          before: { assignedUserId: primaryCoachId },
          after: { assignedUserId: fallbackUserId },
        });
        primaryCoachId = fallbackUserId;
      }
    }
    const guardianIds = member.guardianIds.filter((guardianId) => {
      const guardian = userById.get(guardianId);
      return Boolean(guardian && guardian.role === "guardian" && guardian.branchIds.includes(member.branchId));
    });
    if (guardianIds.length !== member.guardianIds.length) {
      addRepair({
        branchId: member.branchId,
        targetId: member.id,
        targetType: "member",
        rule: "members.guardianIds",
        before: { guardianCount: member.guardianIds.length },
        after: { guardianCount: guardianIds.length },
      });
    }
    return primaryCoachId === member.primaryCoachId && guardianIds.length === member.guardianIds.length
      ? member
      : { ...member, primaryCoachId, guardianIds };
  });

  const classes = db.classes.map((session) => {
    let coachId = session.coachId;
    if (!isValidOperator(userById.get(coachId), session.branchId)) {
      const fallbackUserId = findAcceptedBranchOperatorId(db, session.branchId);
      if (fallbackUserId) {
        addRepair({
          branchId: session.branchId,
          targetId: session.id,
          targetType: "class",
          rule: "classes.coachId",
          before: { assignedUserId: coachId },
          after: { assignedUserId: fallbackUserId },
        });
        coachId = fallbackUserId;
      }
    }
    const enrolledMemberIds = session.enrolledMemberIds.filter(
      (memberId) => memberById.get(memberId)?.branchId === session.branchId,
    );
    if (enrolledMemberIds.length !== session.enrolledMemberIds.length) {
      addRepair({
        branchId: session.branchId,
        targetId: session.id,
        targetType: "class",
        rule: "classes.enrolledMemberIds",
        before: { enrolledMemberCount: session.enrolledMemberIds.length },
        after: { enrolledMemberCount: enrolledMemberIds.length },
      });
    }
    return coachId === session.coachId && enrolledMemberIds.length === session.enrolledMemberIds.length
      ? session
      : { ...session, coachId, enrolledMemberIds };
  });

  const notices = db.notices.map((notice) => {
    const targetClassIds = notice.targetClassIds?.filter((classId) => classById.get(classId)?.branchId === notice.branchId);
    const targetMemberIds = notice.targetMemberIds?.filter((memberId) => memberById.get(memberId)?.branchId === notice.branchId);
    if ((targetClassIds?.length ?? 0) === (notice.targetClassIds?.length ?? 0) && (targetMemberIds?.length ?? 0) === (notice.targetMemberIds?.length ?? 0)) {
      return notice;
    }
    addRepair({
      branchId: notice.branchId,
      targetId: notice.id,
      targetType: "notice",
      rule: "notices.targets",
      before: { classTargetCount: notice.targetClassIds?.length ?? 0, memberTargetCount: notice.targetMemberIds?.length ?? 0 },
      after: { classTargetCount: targetClassIds?.length ?? 0, memberTargetCount: targetMemberIds?.length ?? 0 },
    });
    return {
      ...notice,
      ...(notice.targetClassIds ? { targetClassIds } : {}),
      ...(notice.targetMemberIds ? { targetMemberIds } : {}),
    };
  });

  const pushSubscriptions = db.pushSubscriptions.flatMap((subscription) => {
    if (!userById.has(subscription.userId)) {
      addRepair({
        branchId: subscription.branchIds.find((branchId) => branchIds.has(branchId)) ?? null,
        targetId: subscription.id,
        targetType: "push_subscription",
        rule: "pushSubscriptions.userId",
        before: { present: true },
        after: { present: false },
      });
      return [];
    }
    const validBranchIds = subscription.branchIds.filter((branchId) => branchIds.has(branchId));
    if (validBranchIds.length === subscription.branchIds.length) {
      return [subscription];
    }
    addRepair({
      branchId: validBranchIds[0] ?? null,
      targetId: subscription.id,
      targetType: "push_subscription",
      rule: "pushSubscriptions.branchIds",
      before: { branchCount: subscription.branchIds.length },
      after: { branchCount: validBranchIds.length },
    });
    return [{ ...subscription, branchIds: validBranchIds }];
  });

  const reconciled = repairs.length === 0
    ? db
    : { ...db, users, members, classes, notices, pushSubscriptions };
  const createdAt = options.now ?? new Date().toISOString();
  const auditLogs: AuditLog[] = repairs.map((repair) => ({
    id: options.createId?.() ?? createRuntimeId("audit"),
    branchId: repair.branchId,
    actorUserId: options.actorUserId,
    action: "system.integrity.repair",
    targetType: repair.targetType,
    targetId: repair.targetId,
    before: { rule: repair.rule, ...repair.before },
    after: { rule: repair.rule, ...repair.after },
    result: "success",
    message: "런타임 데이터 참조를 정정했습니다.",
    createdAt,
  }));
  const dbWithAudit = auditLogs.length > 0
    ? { ...reconciled, auditLogs: [...auditLogs, ...reconciled.auditLogs] }
    : reconciled;

  return {
    db: dbWithAudit,
    issues: inspectRuntimeStateIntegrity(db),
    repairs,
    unresolvedIssues: inspectRuntimeStateIntegrity(dbWithAudit),
  };
}
