export const classInputLimits = {
  coachIdLength: 200,
  dateTimeLength: 64,
  enrolledMemberIds: 80,
  levelLength: 40,
  memberIdLength: 200,
  nameLength: 80,
  roomLength: 80,
} as const;

export function getClassInputLimitError(body: Record<string, unknown>) {
  for (const [field, limit] of [
    ["name", classInputLimits.nameLength],
    ["level", classInputLimits.levelLength],
    ["room", classInputLimits.roomLength],
  ] as const) {
    const value = body[field];

    if (typeof value === "string" && value.length > limit) {
      return "수업명은 80자, 레벨은 40자, 장소는 80자 이내로 입력해 주세요.";
    }
  }

  if (typeof body.coachId === "string" && body.coachId.length > classInputLimits.coachIdLength) {
    return "코치 식별자가 너무 깁니다.";
  }

  if (
    [body.startsAt, body.endsAt].some(
      (value) => typeof value === "string" && value.length > classInputLimits.dateTimeLength,
    )
  ) {
    return "수업 시간 값이 너무 깁니다.";
  }

  if (!Array.isArray(body.enrolledMemberIds)) {
    return null;
  }

  if (body.enrolledMemberIds.length > classInputLimits.enrolledMemberIds) {
    return "등록 회원은 최대 80명까지 지정할 수 있습니다.";
  }

  if (
    body.enrolledMemberIds.some(
      (memberId) =>
        typeof memberId === "string" &&
        (memberId.trim().length === 0 || memberId.length > classInputLimits.memberIdLength),
    )
  ) {
    return "등록 회원 식별자는 1자 이상 200자 이하여야 합니다.";
  }

  return null;
}
