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

// 링크성 참조(보호자 연결, 회원-계정 연결, 공지 대상 등)는 과거 삭제 흐름이 남긴
// 고아 참조가 운영 데이터에 존재할 수 있다. 이런 참조는 앱 전체를 중단시키는 대신
// 읽기 시점에 정리(warn)하고, 구조적 손상(중복 ID·중복 연락처·삭제된 코치를 참조하는
// 수업 등)만 오류로 거부한다.
function reportHealed(rule: string, targetId: string) {
  console.warn(`[runtime-state-integrity] healed dangling reference ${rule}:${targetId}`);
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

  let healed = false;

  const users = db.users.map((user) => {
    for (const branchId of user.branchIds) {
      assertReference(branchById.has(branchId), "users.branchIds", user.id);
    }

    const isValidMemberLink = (memberId: string) => {
      const member = memberById.get(memberId);
      return Boolean(member && user.branchIds.includes(member.branchId));
    };
    const memberIds = user.memberIds?.filter(isValidMemberLink);
    const childMemberIds = user.childMemberIds?.filter(isValidMemberLink);

    if (
      (user.memberIds?.length ?? 0) === (memberIds?.length ?? 0) &&
      (user.childMemberIds?.length ?? 0) === (childMemberIds?.length ?? 0)
    ) {
      return user;
    }

    healed = true;
    reportHealed("users.memberLinks", user.id);
    return {
      ...user,
      ...(user.memberIds ? { memberIds } : {}),
      ...(user.childMemberIds ? { childMemberIds } : {}),
    };
  });

  const findFallbackCoachId = (branchId: string) => {
    const fallback = db.users.find(
      (candidate) => ["coach", "owner", "admin"].includes(candidate.role) && candidate.branchIds.includes(branchId),
    );
    return fallback?.id ?? "";
  };

  const members = db.members.map((member) => {
    assertReference(branchById.has(member.branchId), "members.branchId", member.id);

    let nextPrimaryCoachId = member.primaryCoachId;
    if (member.primaryCoachId) {
      const coach = userById.get(member.primaryCoachId);
      const coachValid = Boolean(
        coach && ["coach", "owner", "admin"].includes(coach.role) && coach.branchIds.includes(member.branchId),
      );
      if (!coachValid) {
        nextPrimaryCoachId = findFallbackCoachId(member.branchId);
        reportHealed("members.primaryCoachId", member.id);
      }
    }

    const guardianIds = member.guardianIds.filter((guardianId) => {
      const guardian = userById.get(guardianId);
      return Boolean(guardian && guardian.role === "guardian" && guardian.branchIds.includes(member.branchId));
    });

    if (nextPrimaryCoachId === member.primaryCoachId && guardianIds.length === member.guardianIds.length) {
      return member;
    }

    healed = true;
    if (guardianIds.length !== member.guardianIds.length) {
      reportHealed("members.guardianIds", member.id);
    }
    return { ...member, primaryCoachId: nextPrimaryCoachId, guardianIds };
  });

  const classes = db.classes.map((session) => {
    const coach = userById.get(session.coachId);
    assertReference(branchById.has(session.branchId), "classes.branchId", session.id);
    assertReference(
      Boolean(coach && ["coach", "owner", "admin"].includes(coach.role) && coach.branchIds.includes(session.branchId)),
      "classes.coachId",
      session.id,
    );

    const enrolledMemberIds = session.enrolledMemberIds.filter(
      (memberId) => memberById.get(memberId)?.branchId === session.branchId,
    );

    if (enrolledMemberIds.length === session.enrolledMemberIds.length) {
      return session;
    }

    healed = true;
    reportHealed("classes.enrolledMemberIds", session.id);
    return { ...session, enrolledMemberIds };
  });

  for (const attendance of db.attendance) {
    const session = classById.get(attendance.sessionId);
    const member = memberById.get(attendance.memberId);
    if (!session || !member || session.branchId !== member.branchId) {
      // 과거 삭제가 남긴 고아 출석 기록: 이력 데이터라 삭제하지 않고 경고만 남긴다.
      reportHealed("attendance.references", attendance.id);
    }
  }

  for (const payment of db.payments) {
    if (!branchById.has(payment.branchId) || memberById.get(payment.memberId)?.branchId !== payment.branchId) {
      // 결제는 금전 기록이므로 절대 자동 삭제하지 않는다. 경고만 남긴다.
      reportHealed("payments.references", payment.id);
    }
  }

  const notices = db.notices.map((notice) => {
    assertReference(branchById.has(notice.branchId), "notices.branchId", notice.id);

    const targetClassIds = notice.targetClassIds?.filter((classId) => classById.get(classId)?.branchId === notice.branchId);
    const targetMemberIds = notice.targetMemberIds?.filter(
      (memberId) => memberById.get(memberId)?.branchId === notice.branchId,
    );

    if (
      (notice.targetClassIds?.length ?? 0) === (targetClassIds?.length ?? 0) &&
      (notice.targetMemberIds?.length ?? 0) === (targetMemberIds?.length ?? 0)
    ) {
      return notice;
    }

    healed = true;
    reportHealed("notices.targets", notice.id);
    return {
      ...notice,
      ...(notice.targetClassIds ? { targetClassIds } : {}),
      ...(notice.targetMemberIds ? { targetMemberIds } : {}),
    };
  });

  const pushSubscriptions = db.pushSubscriptions.filter((subscription) => {
    if (!userById.has(subscription.userId)) {
      healed = true;
      reportHealed("pushSubscriptions.userId", subscription.id);
      return false;
    }
    return true;
  }).map((subscription) => {
    const branchIds = subscription.branchIds.filter((branchId) => branchById.has(branchId));
    if (branchIds.length === subscription.branchIds.length) {
      return subscription;
    }
    healed = true;
    reportHealed("pushSubscriptions.branchIds", subscription.id);
    return { ...subscription, branchIds };
  });

  if (!healed) {
    return db;
  }

  return {
    ...db,
    users,
    members,
    classes,
    notices,
    pushSubscriptions,
  };
}
