export const authInputLimits = {
  branchIdLength: 160,
  identifierLength: 254,
  passwordLength: 256,
  phoneLength: 40,
  resetCodeLength: 12,
  resetTokenLength: 128,
  registrationNameLength: 30,
} as const;

export function getAuthInputLimitError(body: Record<string, unknown>) {
  for (const [field, limit] of [
    ["branchId", authInputLimits.branchIdLength],
    ["email", authInputLimits.identifierLength],
    ["identifier", authInputLimits.identifierLength],
    ["loginId", authInputLimits.identifierLength],
    ["name", authInputLimits.registrationNameLength],
    ["password", authInputLimits.passwordLength],
    ["phone", authInputLimits.phoneLength],
    ["code", authInputLimits.resetCodeLength],
    ["resetToken", authInputLimits.resetTokenLength],
  ] as const) {
    const value = body[field];

    if (typeof value === "string" && value.length > limit) {
      return "인증 입력값이 허용 길이를 초과했습니다.";
    }
  }

  return null;
}
