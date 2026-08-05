export const familyPaymentRequestInputLimits = {
  methodLabelLength: 60,
  methodLength: 32,
  payerNameLength: 50,
  payerPhoneLength: 20,
} as const;

export const familyPaymentMethodLabels = {
  bankTransfer: ["국민은행", "신한은행", "우리은행", "하나은행", "농협은행", "기업은행", "카카오뱅크", "토스뱅크"],
  card: ["신한카드", "비씨카드", "우리카드", "KB국민카드", "롯데카드", "현대카드", "삼성카드", "NH카드", "하나카드", "씨티카드", "카카오뱅크", "광주카드", "전북카드", "수협카드", "제주카드", "신협카드", "우체국체크카드", "새마을금고", "저축은행카드", "KDB산업체크카드"],
  virtualAccount: ["가상계좌"],
  accountTransfer: ["계좌이체"],
} as const;

export function isValidFamilyPaymentMethodLabel(
  method: keyof typeof familyPaymentMethodLabels,
  label: string,
) {
  return (familyPaymentMethodLabels[method] as readonly string[]).includes(label);
}

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
