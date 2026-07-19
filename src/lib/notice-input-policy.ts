export const noticeInputLimits = {
  audienceItems: 8,
  bodyLength: 5_000,
  classTargetItems: 100,
  targetIdLength: 200,
  memberTargetItems: 500,
  titleLength: 120,
} as const;

export function getNoticeTextLimitError({ body, title }: { body?: string; title?: string }) {
  if (title !== undefined && title.length > noticeInputLimits.titleLength) {
    return `공지 제목은 ${noticeInputLimits.titleLength}자 이하로 입력해 주세요.`;
  }

  if (body !== undefined && body.length > noticeInputLimits.bodyLength) {
    return `공지 본문은 ${noticeInputLimits.bodyLength.toLocaleString("ko-KR")}자 이하로 입력해 주세요.`;
  }

  return null;
}

export function getNoticeStringListLimitError(
  value: unknown,
  { label, maximumItems }: { label: string; maximumItems: number },
) {
  if (value === undefined) {
    return null;
  }

  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    return `${label} 목록의 형식이 올바르지 않습니다.`;
  }

  if (value.length > maximumItems) {
    return `${label}은 한 번에 ${maximumItems}개까지 선택할 수 있습니다.`;
  }

  if (value.some((item) => !item.trim() || item.length > noticeInputLimits.targetIdLength)) {
    return `${label} 식별자의 형식이 올바르지 않습니다.`;
  }

  return null;
}
