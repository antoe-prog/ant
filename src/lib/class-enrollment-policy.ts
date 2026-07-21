import type { ClassSession, Member, MockDatabase } from "./domain.ts";

export function isClassAgeGroupCompatible(
  member: Pick<Member, "ageGroup">,
  session: Pick<ClassSession, "ageGroup">,
) {
  return session.ageGroup === "all" || session.ageGroup === member.ageGroup;
}

export function findOverlappingClassEnrollment(
  db: Pick<MockDatabase, "classes">,
  memberId: string,
  targetSession: Pick<ClassSession, "id" | "startsAt" | "endsAt">,
) {
  const targetStartsAt = Date.parse(targetSession.startsAt);
  const targetEndsAt = Date.parse(targetSession.endsAt);

  if (!Number.isFinite(targetStartsAt) || !Number.isFinite(targetEndsAt)) {
    return null;
  }

  return db.classes.find((session) => {
    if (session.id === targetSession.id || !session.enrolledMemberIds.includes(memberId)) {
      return false;
    }

    const startsAt = Date.parse(session.startsAt);
    const endsAt = Date.parse(session.endsAt);
    return Number.isFinite(startsAt) && Number.isFinite(endsAt) && startsAt < targetEndsAt && endsAt > targetStartsAt;
  }) ?? null;
}

export function getClassRegistrationBlockReason(
  db: Pick<MockDatabase, "classes">,
  member: Pick<Member, "id" | "branchId" | "status" | "ageGroup">,
  session: Pick<ClassSession, "id" | "branchId" | "startsAt" | "endsAt" | "ageGroup" | "capacity" | "enrolledMemberIds">,
  now = new Date(),
) {
  if (member.branchId !== session.branchId) {
    return "회원과 수업의 지점이 다릅니다.";
  }

  if (member.status !== "active" && member.status !== "trial") {
    return "활성 또는 체험 회원만 수업을 신청할 수 있습니다.";
  }

  if (!isClassAgeGroupCompatible(member, session)) {
    return "회원 연령에 맞지 않는 수업입니다.";
  }

  if (Date.parse(session.startsAt) <= now.getTime()) {
    return "시작된 수업은 신청할 수 없습니다.";
  }

  if (session.enrolledMemberIds.length >= session.capacity) {
    return "수업 정원이 마감되었습니다.";
  }

  const overlappingSession = findOverlappingClassEnrollment(db, member.id, session);
  if (overlappingSession) {
    return "같은 시간에 이미 신청한 수업이 있습니다.";
  }

  return null;
}
