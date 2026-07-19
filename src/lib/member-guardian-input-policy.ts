export const memberGuardianInputLimits = {
  guardianUserIdLength: 200,
} as const;

export function parseGuardianLinkInput(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { error: "보호자 연결 정보가 올바른 JSON 객체가 아닙니다.", guardianUserId: "" };
  }

  const guardianUserId = (value as Record<string, unknown>).guardianUserId;

  if (guardianUserId !== undefined && typeof guardianUserId !== "string") {
    return { error: "학부모 계정 값의 형식이 올바르지 않습니다.", guardianUserId: "" };
  }

  if (guardianUserId && guardianUserId.length > memberGuardianInputLimits.guardianUserIdLength) {
    return {
      error: `학부모 계정 값은 ${memberGuardianInputLimits.guardianUserIdLength}자 이하이어야 합니다.`,
      guardianUserId: "",
    };
  }

  return { error: null, guardianUserId: guardianUserId?.trim() ?? "" };
}
