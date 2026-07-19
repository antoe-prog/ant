export const userAdministrationInputLimits = {
  branchIdLength: 200,
  branchIds: 100,
  emailLength: 254,
  linkedMemberIdLength: 200,
  linkedMemberIds: 100,
  nameLength: 80,
  passwordLength: 256,
  phoneLength: 40,
  reasonLength: 500,
  roleLength: 32,
  titleLength: 120,
} as const;

export function getUserAdministrationInputLimitError(body: Record<string, unknown>) {
  for (const [field, limit] of [
    ["name", userAdministrationInputLimits.nameLength],
    ["email", userAdministrationInputLimits.emailLength],
    ["phone", userAdministrationInputLimits.phoneLength],
    ["role", userAdministrationInputLimits.roleLength],
    ["reason", userAdministrationInputLimits.reasonLength],
    ["title", userAdministrationInputLimits.titleLength],
    ["password", userAdministrationInputLimits.passwordLength],
    ["temporaryPassword", userAdministrationInputLimits.passwordLength],
  ] as const) {
    const value = body[field];

    if (typeof value === "string" && value.length > limit) {
      return "사용자 입력값이 허용 길이를 초과했습니다.";
    }
  }

  for (const [field, itemLimit, itemLengthLimit, countMessage, itemMessage] of [
    [
      "branchIds",
      userAdministrationInputLimits.branchIds,
      userAdministrationInputLimits.branchIdLength,
      "담당 지점은 최대 100개까지 지정할 수 있습니다.",
      "담당 지점 식별자는 1자 이상 200자 이하여야 합니다.",
    ],
    [
      "memberIds",
      userAdministrationInputLimits.linkedMemberIds,
      userAdministrationInputLimits.linkedMemberIdLength,
      "연결 회원은 최대 100명까지 지정할 수 있습니다.",
      "연결 회원 식별자는 1자 이상 200자 이하여야 합니다.",
    ],
    [
      "childMemberIds",
      userAdministrationInputLimits.linkedMemberIds,
      userAdministrationInputLimits.linkedMemberIdLength,
      "연결 자녀는 최대 100명까지 지정할 수 있습니다.",
      "연결 자녀 식별자는 1자 이상 200자 이하여야 합니다.",
    ],
  ] as const) {
    const values = body[field];

    if (!Array.isArray(values)) {
      continue;
    }

    if (values.length > itemLimit) {
      return countMessage;
    }

    if (
      values.some(
        (value) =>
          typeof value === "string" &&
          (value.trim().length === 0 || value.length > itemLengthLimit),
      )
    ) {
      return itemMessage;
    }
  }

  return null;
}
