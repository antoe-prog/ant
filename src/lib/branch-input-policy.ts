import type { BranchSettings } from "@/lib/domain";

export const branchInputLimits = {
  districtLength: 100,
  nameLength: 80,
  reasonLength: 500,
  timezoneLength: 64,
  userIdLength: 200,
} as const;

export type BranchCreateInput = {
  district?: string;
  name?: string;
  ownerUserId?: string;
};

export type BranchUpdateInput = {
  district?: unknown;
  name?: unknown;
  reason?: unknown;
  settings?: Partial<Record<keyof BranchSettings, unknown>>;
  status?: unknown;
  timezone?: unknown;
};

function getOptionalStringError(label: string, value: unknown, maxLength: number) {
  if (value === undefined) {
    return null;
  }

  if (typeof value !== "string" || value.length > maxLength) {
    return `${label}은 ${maxLength}자 이하의 문자열이어야 합니다.`;
  }

  return null;
}

export function getBranchCreateBodyError(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return "지점 정보가 올바른 JSON 객체가 아닙니다.";
  }

  const body = value as Record<string, unknown>;

  return (
    getOptionalStringError("지점명", body.name, branchInputLimits.nameLength) ??
    getOptionalStringError("지역", body.district, branchInputLimits.districtLength) ??
    getOptionalStringError("대표 사용자", body.ownerUserId, branchInputLimits.userIdLength)
  );
}

export function getBranchUpdateBodyError(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return "지점 수정 정보가 올바른 JSON 객체가 아닙니다.";
  }

  const body = value as Record<string, unknown>;
  const stringError =
    getOptionalStringError("지점명", body.name, branchInputLimits.nameLength) ??
    getOptionalStringError("지역", body.district, branchInputLimits.districtLength) ??
    getOptionalStringError("변경 사유", body.reason, branchInputLimits.reasonLength) ??
    getOptionalStringError("지점 상태", body.status, 32) ??
    getOptionalStringError("시간대", body.timezone, branchInputLimits.timezoneLength);

  if (stringError) {
    return stringError;
  }

  if (body.settings !== undefined) {
    if (!body.settings || typeof body.settings !== "object" || Array.isArray(body.settings)) {
      return "지점 설정 값의 형식이 올바르지 않습니다.";
    }

    const settings = body.settings as Record<string, unknown>;

    if (
      settings.attendanceEditRequiresReason !== undefined &&
      typeof settings.attendanceEditRequiresReason !== "boolean"
    ) {
      return "출석 수정 사유 설정 값의 형식이 올바르지 않습니다.";
    }
  }

  return null;
}

export function getBranchOwnerBodyError(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return "대표 배정 정보가 올바른 JSON 객체가 아닙니다.";
  }

  return getOptionalStringError(
    "대표 사용자",
    (value as Record<string, unknown>).ownerUserId,
    branchInputLimits.userIdLength,
  );
}
