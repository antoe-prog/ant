import type { AuditAction, AuditLog } from "@/lib/domain";

export const auditActionLabels: Record<AuditAction, string> = {
  "attendance.update": "출석 변경",
  "notice.create": "공지 작성",
  "notice.update": "공지 수정",
  "notice.delete": "공지 삭제",
  "notice.read": "공지 읽음",
  "notification.subscribe": "알림 수신 등록",
  "notification.unsubscribe": "알림 수신 해제",
  "notification.dispatch": "공지 알림 발송",
  "member.create": "회원 등록",
  "member.update": "회원 정보 변경",
  "counseling_note.create": "상담 메모 작성",
  "promotion.create": "승급 심사 등록",
  "promotion.update": "승급 심사 결과",
  "tournament.create": "대회 공지 등록",
  "tournament.update": "대회 공지 수정",
  "tournament.delete": "대회 공지 삭제",
  "class.create": "수업 생성",
  "class.update": "수업 변경",
  "payment.create": "결제 등록",
  "payment.update": "수기 결제 수정",
  "payment.delete": "수기 결제 삭제",
  "payment.online_checkout.create": "온라인 결제 요청",
  "payment.webhook": "결제 상태 반영",
  "payment.recurring_agreement.create": "정기결제 약정",
  "payment.recurring_agreement.cancel": "정기결제 해지",
  "payment.refund": "환불/취소",
  "branch.create": "지점 생성",
  "branch.update": "지점 변경",
  "branch.owner.assign": "대표 배정",
  "user.invite.create": "사용자 초대",
  "user.invite.approve": "초대 승인",
  "user.update": "사용자 수정",
  "user.role.update": "권한 변경",
  "user.delete": "사용자 삭제",
  "audit_logs.read": "변경 기록 조회",
  "export.create": "내보내기",
  "pilot_readiness.update": "운영 준비 변경",
  "pilot_incident.create": "운영 이슈 등록",
  "pilot_incident.update": "운영 이슈 변경",
  "pilot_operation.update": "운영 기록 변경",
  "system.integrity.repair": "데이터 무결성 정정",
  "auth.invite.accept": "초대 수락",
  "auth.password_reset.request": "비밀번호 재설정 요청",
  "auth.password_reset.verify": "비밀번호 변경 본인 확인",
  "auth.password_reset.complete": "비밀번호 변경",
  "auth.login": "로그인",
  "auth.logout": "로그아웃",
};

export const auditActions = Object.keys(auditActionLabels) as AuditAction[];

export const auditResultLabels: Record<AuditLog["result"], string> = {
  blocked: "확인 필요",
  failed: "실패",
  success: "완료",
};

export const auditResults = Object.keys(auditResultLabels) as AuditLog["result"][];

export const auditTargetTypeLabels: Record<AuditLog["targetType"], string> = {
  attendance: "출석",
  auth: "로그인",
  audit: "변경 기록",
  branch: "지점",
  class: "수업",
  counseling_note: "상담",
  promotion: "승급 심사",
  tournament: "대회 공지",
  export: "내보내기",
  member: "회원",
  notice: "공지",
  notification: "알림",
  payment: "결제",
  pilot_incident: "운영 이슈",
  pilot_operation: "운영 기록",
  pilot_readiness: "운영 준비",
  push_subscription: "알림 등록",
  user: "사용자",
};

export const auditPayloadFieldLabels: Record<string, string> = {
  accountCreated: "계정 생성",
  action: "처리 항목",
  ageGroup: "연령 구분",
  amount: "결제 금액",
  assignedUserId: "담당자",
  approvedByUserId: "승인 담당자",
  attempted: "발송 시도",
  attendanceRecords: "출석 기록",
  audience: "공지 대상",
  benefitCode: "적용 혜택",
  autoDispatchedOnCreate: "작성 즉시 발송",
  branchId: "지점",
  branchIds: "담당 지점",
  branchCount: "지점 수",
  cancel: "해지 정보",
  capacity: "정원",
  childMemberIds: "연결 자녀",
  childMemberCount: "연결 자녀 수",
  classTargetCount: "대상 수업 수",
  classesChecked: "확인 수업",
  configured: "설정 상태",
  createdAt: "등록 일시",
  createdByUserId: "등록 담당자",
  date: "운영일",
  deletedAt: "삭제 일시",
  disabled: "수신 해제",
  disabledAt: "해제 일시",
  discountAmount: "할인 금액",
  district: "지역",
  email: "이메일",
  emergencyContact: "비상 연락처",
  endpointHint: "알림 기기",
  endsAt: "종료 시각",
  enrolledCount: "등록 인원",
  enrolledMemberCount: "등록 회원 수",
  event: "변경 유형",
  eventDate: "행사일",
  evidence: "확인 자료",
  examDate: "심사일",
  expiresAt: "만료일",
  feeProductId: "공통 회비 상품",
  idempotencyKey: "중복 방지 요청 키",
  failed: "실패 건수",
  from: "시작",
  fromBelt: "변경 전 띠",
  guardianCount: "보호자 수",
  guardianChildMemberIds: "학부모 연결 자녀",
  guardianIds: "연결 학부모",
  guardianUserId: "학부모 계정",
  identifier: "계정 식별값",
  important: "중요 공지",
  invitationStatus: "초대 상태",
  issuedAt: "발급 일시",
  limit: "조회 건수",
  memberId: "회원",
  memberIds: "연결 회원",
  memberCount: "연결 회원 수",
  memberTargetCount: "대상 회원 수",
  mobileAttendanceDurationSeconds: "모바일 출석 시간",
  mobileAttendanceEvidence: "모바일 출석 확인 자료",
  mode: "처리 방식",
  name: "이름",
  noteType: "메모 유형",
  noticeChecks: "공지 확인",
  noticeFollowupChecks: "공지 후속 확인",
  onlinePayment: "온라인 결제",
  organizer: "주최",
  owner: "담당자",
  ownerUserId: "대표",
  ownerUserIds: "기존 대표",
  passwordIssued: "임시 비밀번호 발급",
  passwordResetRequestedAt: "재설정 요청 일시",
  passwordSet: "비밀번호 설정",
  passwordUpdated: "비밀번호 변경",
  passwordUpdatedAt: "비밀번호 변경 일시",
  paymentChecks: "결제 확인",
  phone: "휴대폰 번호",
  planName: "회원권명",
  policyVersion: "정책 기준",
  policy: "운영 정책",
  query: "검색어",
  readByUserIds: "확인 사용자",
  reason: "처리 사유",
  rule: "정정 규칙",
  recipientCount: "수신 인원",
  recurringAgreement: "정기결제 약정",
  refundReason: "환불 사유",
  refundedAmount: "환불 금액",
  registeredMonths: "등록 개월",
  result: "결과",
  role: "역할",
  room: "장소",
  rowCount: "처리 건수",
  screen: "조회 화면",
  sent: "발송 완료",
  settings: "운영 설정",
  severity: "중요도",
  startsAt: "시작 시각",
  serviceMonths: "이용 개월",
  status: "상태",
  statusChangedAt: "상태 변경 일시",
  statusHistory: "상태 변경 이력",
  syncedMemberIds: "동기화 회원",
  syncedUserIds: "동기화 계정",
  targetClassIds: "대상 수업",
  targetMemberIds: "대상 회원",
  timezone: "시간대",
  title: "제목",
  to: "종료",
  toBelt: "변경 후 띠",
  trendPeriods: "집계 기간",
  type: "유형",
  userAgent: "접속 환경",
  visibility: "공개 범위",
  withdrawnAt: "퇴관 일시",
  workaround: "임시 조치",
};

const auditPayloadValueLabels: Record<string, string> = {
  accepted: "승인됨",
  active: "활성",
  admin: "총괄 어드민",
  adult: "성인",
  all: "전체",
  absent: "결석",
  archived: "보관",
  blocked: "확인 필요",
  cancelled: "취소",
  coach: "코치",
  completed: "완료",
  draft: "작성 중",
  excused: "사유 인정",
  expiringSoon: "만료 예정",
  fail: "불합격",
  failed: "실패",
  generated: "자동 발급",
  guardian: "학부모",
  inactive: "비활성",
  late: "지각",
  manual: "수동",
  member: "회원",
  monitoring: "확인 중",
  overdue: "미납",
  owner: "대표",
  paid: "납부 완료",
  partially_refunded: "부분 환불",
  "public-service-one-plus-one": "경찰·군인·소방 1+1 기간",
  pass: "합격",
  paused: "일시 중지",
  pending: "대기",
  present: "출석",
  published: "게시",
  rejected: "반려",
  refunded: "환불",
  resolved: "해결",
  scheduled: "예정",
  staff_only: "운영진만",
  success: "완료",
  suspended: "정지",
  verified: "확인 완료",
  withdrawn: "퇴관",
};

const countFieldKeys = new Set([
  "attempted",
  "attendanceRecords",
  "classesChecked",
  "failed",
  "limit",
  "noticeChecks",
  "noticeFollowupChecks",
  "paymentChecks",
  "recipientCount",
  "rowCount",
]);
const memberCountFieldKeys = new Set(["capacity", "enrolledCount"]);
const moneyFieldKeys = new Set(["amount", "discountAmount", "refundedAmount"]);
const hiddenAuditPayloadFieldKeys = new Set(["idempotencyFingerprint"]);

function formatAuditDate(value: string) {
  const dateOnly = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);

  if (dateOnly) {
    return `${dateOnly[1]}. ${Number(dateOnly[2])}. ${Number(dateOnly[3])}.`;
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("ko-KR", {
    dateStyle: "medium",
    hour12: false,
    timeStyle: "short",
  }).format(date);
}

function isDateField(key: string) {
  return (
    key === "date" ||
    key.endsWith("At") ||
    key.endsWith("Date") ||
    key === "expiresAt" ||
    key === "from" ||
    key === "to"
  );
}

function formatAuditPayloadValue(key: string, value: unknown): string {
  if (value === null || value === undefined || value === "") {
    return "없음";
  }

  if (typeof value === "boolean") {
    return value ? "예" : "아니오";
  }

  if (typeof value === "number") {
    if (moneyFieldKeys.has(key)) {
      return `₩${value.toLocaleString("ko-KR")}`;
    }

    if (key === "mobileAttendanceDurationSeconds") {
      return `${value.toLocaleString("ko-KR")}초`;
    }

    if (memberCountFieldKeys.has(key)) {
      return `${value.toLocaleString("ko-KR")}명`;
    }

    if (countFieldKeys.has(key)) {
      return `${value.toLocaleString("ko-KR")}건`;
    }

    return value.toLocaleString("ko-KR");
  }

  if (typeof value === "string") {
    if (value === "[보호됨]") {
      return "보호됨";
    }

    if (value.startsWith("[민감 내용")) {
      return value.slice(1, -1);
    }

    if (isDateField(key)) {
      return formatAuditDate(value);
    }

    return auditPayloadValueLabels[value] ?? value;
  }

  if (Array.isArray(value)) {
    if (value.length === 0) {
      return "없음";
    }

    if (value.some((item) => item && typeof item === "object")) {
      return `${value.length}건`;
    }

    const values = value.slice(0, 3).map((item) => formatAuditPayloadValue(key, item));
    return value.length > 3 ? `${values.join(", ")} 외 ${value.length - 3}건` : values.join(", ");
  }

  if (typeof value === "object") {
    const entries = Object.entries(value);

    if (entries.length === 0) {
      return "없음";
    }

    const details = entries.slice(0, 4).map(([entryKey, entryValue], index) => {
      const label = auditPayloadFieldLabels[entryKey] ?? `세부 정보 ${index + 1}`;
      return `${label} ${formatAuditPayloadValue(entryKey, entryValue)}`;
    });

    return entries.length > 4 ? `${details.join(" · ")} 외 ${entries.length - 4}건` : details.join(" · ");
  }

  return String(value);
}

export type AuditPayloadChange = {
  after: string;
  before: string;
  key: string;
  label: string;
};

export function getAuditPayloadChanges(
  before: AuditLog["before"],
  after: AuditLog["after"],
): AuditPayloadChange[] {
  const beforePayload = before ?? {};
  const afterPayload = after ?? {};
  const keys = [...new Set([...Object.keys(beforePayload), ...Object.keys(afterPayload)])];

  return keys
    .filter((key) => !hiddenAuditPayloadFieldKeys.has(key))
    .filter((key) => JSON.stringify(beforePayload[key]) !== JSON.stringify(afterPayload[key]))
    .map((key, index) => ({
      after: formatAuditPayloadValue(key, afterPayload[key]),
      before: formatAuditPayloadValue(key, beforePayload[key]),
      key,
      label: auditPayloadFieldLabels[key] ?? `추가 정보 ${index + 1}`,
    }));
}
