import type { MockDatabase } from "../lib/domain.ts";
import { normalizePhoneNumber } from "../lib/phone.ts";

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
  "pushSubscriptions",
  "pilotReadinessChecks",
  "pilotIncidents",
  "pilotOperationLogs",
  "auditLogs",
] as const satisfies readonly (keyof MockDatabase)[];

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

function assertReference(condition: boolean, rule: string, targetId: string) {
  if (!condition) {
    throw new RuntimeStateIntegrityError(rule, targetId);
  }
}

function assertUniqueValues(values: Array<{ targetId: string; value: string }>, rule: string) {
  const seen = new Set<string>();

  for (const { targetId, value } of values) {
    if (!value) {
      continue;
    }
    if (seen.has(value)) {
      throw new RuntimeStateIntegrityError(rule, targetId);
    }
    seen.add(value);
  }
}

export function validateRuntimeStateIntegrity(db: MockDatabase): MockDatabase {
  for (const collection of runtimeCollectionKeys) {
    assertUniqueValues(
      db[collection].map((item) => ({ targetId: item.id, value: item.id })),
      `${collection}.id`,
    );
  }

  assertUniqueValues(
    db.users.map((user) => ({ targetId: user.id, value: normalizePhoneNumber(user.phone ?? "") })),
    "users.phone",
  );
  assertUniqueValues(
    db.users.map((user) => ({ targetId: user.id, value: user.email?.trim().toLowerCase() ?? "" })),
    "users.email",
  );

  const branchById = new Map(db.branches.map((branch) => [branch.id, branch]));
  const userById = new Map(db.users.map((user) => [user.id, user]));
  const memberById = new Map(db.members.map((member) => [member.id, member]));
  const classById = new Map(db.classes.map((session) => [session.id, session]));

  for (const user of db.users) {
    for (const branchId of user.branchIds) {
      assertReference(branchById.has(branchId), "users.branchIds", user.id);
    }
    for (const memberId of [...(user.memberIds ?? []), ...(user.childMemberIds ?? [])]) {
      const member = memberById.get(memberId);
      assertReference(Boolean(member && user.branchIds.includes(member.branchId)), "users.memberLinks", user.id);
    }
  }

  for (const member of db.members) {
    assertReference(branchById.has(member.branchId), "members.branchId", member.id);
    if (member.primaryCoachId) {
      const coach = userById.get(member.primaryCoachId);
      assertReference(
        Boolean(coach && ["coach", "owner", "admin"].includes(coach.role) && coach.branchIds.includes(member.branchId)),
        "members.primaryCoachId",
        member.id,
      );
    }
    for (const guardianId of member.guardianIds) {
      const guardian = userById.get(guardianId);
      assertReference(
        Boolean(guardian && guardian.role === "guardian" && guardian.branchIds.includes(member.branchId)),
        "members.guardianIds",
        member.id,
      );
    }
  }

  for (const session of db.classes) {
    const coach = userById.get(session.coachId);
    assertReference(branchById.has(session.branchId), "classes.branchId", session.id);
    assertReference(
      Boolean(coach && ["coach", "owner", "admin"].includes(coach.role) && coach.branchIds.includes(session.branchId)),
      "classes.coachId",
      session.id,
    );
    for (const memberId of session.enrolledMemberIds) {
      assertReference(memberById.get(memberId)?.branchId === session.branchId, "classes.enrolledMemberIds", session.id);
    }
  }

  for (const attendance of db.attendance) {
    const session = classById.get(attendance.sessionId);
    const member = memberById.get(attendance.memberId);
    assertReference(Boolean(session && member && session.branchId === member.branchId), "attendance.references", attendance.id);
  }

  for (const payment of db.payments) {
    assertReference(
      Boolean(branchById.has(payment.branchId) && memberById.get(payment.memberId)?.branchId === payment.branchId),
      "payments.references",
      payment.id,
    );
  }

  for (const notice of db.notices) {
    assertReference(branchById.has(notice.branchId), "notices.branchId", notice.id);
    for (const classId of notice.targetClassIds ?? []) {
      assertReference(classById.get(classId)?.branchId === notice.branchId, "notices.targetClassIds", notice.id);
    }
    for (const memberId of notice.targetMemberIds ?? []) {
      assertReference(memberById.get(memberId)?.branchId === notice.branchId, "notices.targetMemberIds", notice.id);
    }
  }

  for (const subscription of db.pushSubscriptions) {
    assertReference(userById.has(subscription.userId), "pushSubscriptions.userId", subscription.id);
    for (const branchId of subscription.branchIds) {
      assertReference(branchById.has(branchId), "pushSubscriptions.branchIds", subscription.id);
    }
  }

  return db;
}
