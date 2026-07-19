export const counselingNoteInputLimits = {
  bodyLength: 2_000,
} as const;

export function getCounselingNoteBodyLimitError(body: string | undefined) {
  if (body !== undefined && body.length > counselingNoteInputLimits.bodyLength) {
    return `상담/주의 메모는 ${counselingNoteInputLimits.bodyLength.toLocaleString("ko-KR")}자 이하로 입력해 주세요.`;
  }

  return null;
}
