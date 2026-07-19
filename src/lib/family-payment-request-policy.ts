export const familyPaymentRequestInputLimits = {
  methodLabelLength: 60,
  methodLength: 32,
  payerNameLength: 50,
  payerPhoneLength: 20,
} as const;

export function getFamilyPaymentRequestBodyTypeError(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return "납부 요청 정보가 올바른 JSON 객체가 아닙니다.";
  }

  const body = value as Record<string, unknown>;
  const fields = [
    ["결제자 이름", body.payerName, familyPaymentRequestInputLimits.payerNameLength],
    ["휴대전화", body.payerPhone, familyPaymentRequestInputLimits.payerPhoneLength],
    ["납부 방법", body.method, familyPaymentRequestInputLimits.methodLength],
    ["납부 방법명", body.methodLabel, familyPaymentRequestInputLimits.methodLabelLength],
  ] as const;

  for (const [label, candidate, maxLength] of fields) {
    if (candidate !== undefined && (typeof candidate !== "string" || candidate.length > maxLength)) {
      return `${label}은 ${maxLength}자 이하의 문자열이어야 합니다.`;
    }
  }

  return null;
}
