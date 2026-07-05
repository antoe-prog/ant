export const userRoles = ["member", "guardian", "coach", "owner", "admin"] as const;

export type UserRole = (typeof userRoles)[number];

export type BranchStatus = "active" | "inactive";

export type BranchSettings = {
  attendanceEditRequiresReason: boolean;
};

export const defaultBranchSettings: BranchSettings = {
  attendanceEditRequiresReason: true,
};

export const supportedBranchTimezones = [
  { label: "한국 시간", value: "Asia/Seoul" },
] as const;

export function formatBranchTimezone(timezone?: string): string {
  const normalizedTimezone = timezone?.trim() || "Asia/Seoul";
  const supportedTimezone = supportedBranchTimezones.find((option) => option.value === normalizedTimezone);

  return supportedTimezone?.label ?? normalizedTimezone.replaceAll("_", " ");
}

export function normalizeBranchSettings(settings?: Partial<BranchSettings>): BranchSettings {
  return {
    ...defaultBranchSettings,
    ...settings,
  };
}

export type Branch = {
  id: string;
  name: string;
  district: string;
  settings?: BranchSettings;
  status?: BranchStatus;
  timezone?: string;
};

export type AppUser = {
  id: string;
  email?: string;
  name: string;
  passwordHash?: string;
  phone?: string;
  role: UserRole;
  title: string;
  branchIds: string[];
  memberIds?: string[];
  childMemberIds?: string[];
  invitationStatus?: "pending" | "accepted";
  invitationToken?: string;
  invitedAt?: string;
  acceptedAt?: string;
  passwordResetRequestedAt?: string;
  passwordUpdatedAt?: string;
};

export type MemberStatus = "active" | "trial" | "paused" | "withdrawn";

export type MemberGender = "male" | "female";

export const memberGenderLabels: Record<MemberGender, string> = {
  male: "남성",
  female: "여성",
};

export type Member = {
  id: string;
  branchId: string;
  name: string;
  status: MemberStatus;
  ageGroup: "kids" | "teen" | "adult";
  level: string;
  belt: string;
  gender?: MemberGender;
  birthDate?: string;
  address?: string;
  guardianIds: string[];
  primaryCoachId: string;
  emergencyContact: string;
  alerts: string[];
  createdAt?: string;
  statusChangedAt?: string;
  withdrawnAt?: string;
};

export type ClassSession = {
  id: string;
  branchId: string;
  name: string;
  level: string;
  ageGroup: Member["ageGroup"];
  coachId: string;
  startsAt: string;
  endsAt: string;
  room: string;
  capacity: number;
  enrolledMemberIds: string[];
};

export type AttendanceStatus = "present" | "absent" | "late" | "excused";
export type SaveStatus = "idle" | "saving" | "saved" | "offline" | "failed" | "conflict";

export type AttendanceRecord = {
  id: string;
  sessionId: string;
  memberId: string;
  status: AttendanceStatus;
  confirmedAt?: string;
  note?: string;
};

export const judoBelts = ["흰띠", "노란띠", "주황띠", "초록띠", "파란띠", "밤띠", "빨간띠", "검은띠 1단", "검은띠 2단", "검은띠 3단", "검은띠 4단", "검은띠 5단"] as const;

export type BeltPromotionResult = "scheduled" | "passed" | "failed" | "cancelled";

export type BeltPromotion = {
  id: string;
  branchId: string;
  memberId: string;
  fromBelt: string;
  toBelt: string;
  examDate: string;
  result: BeltPromotionResult;
  evaluatorUserId: string;
  score?: number;
  note?: string;
  createdByUserId: string;
  createdAt: string;
  decidedAt?: string;
};

export const beltPromotionResultLabels: Record<BeltPromotionResult, string> = {
  scheduled: "심사 예정",
  passed: "승급",
  failed: "보류",
  cancelled: "취소",
};

export function getNextBelt(currentBelt: string): string | null {
  const index = judoBelts.indexOf(currentBelt as (typeof judoBelts)[number]);

  if (index < 0 || index >= judoBelts.length - 1) {
    return null;
  }

  return judoBelts[index + 1];
}

export type CounselingNoteVisibility = "staff_only" | "coach_visible" | "guardian_visible";

export type CounselingNote = {
  id: string;
  branchId: string;
  memberId: string;
  authorUserId: string;
  body: string;
  createdAt: string;
  noteType: "general" | "caution" | "progress" | "follow_up";
  visibility: CounselingNoteVisibility;
};

export type PaymentStatus =
  | "scheduled"
  | "paid"
  | "overdue"
  | "cancelled"
  | "refunded"
  | "partially_refunded"
  | "expiringSoon";

export type OnlinePaymentStatus = "pending" | "paid" | "failed" | "cancelled" | "refunded";
export type OnlinePaymentProvider = "mock" | "external";
export type RecurringBillingStatus = "pending" | "active" | "cancelled" | "failed";
export type RecurringBillingInterval = "monthly";

export type PaymentReceipt = {
  id: string;
  issuedAt: string;
  providerPaymentId: string;
  receiptUrl?: string;
};

export type OnlinePaymentRequest = {
  provider: OnlinePaymentProvider;
  providerPaymentId: string;
  status: OnlinePaymentStatus;
  checkoutUrl: string;
  requestedAt: string;
  requestedByUserId: string;
  amount: number;
  processedWebhookEventIds?: string[];
  paidAt?: string;
  failedAt?: string;
  failureReason?: string;
  receipt?: PaymentReceipt;
};

export type PaymentRecurringAgreement = {
  provider: OnlinePaymentProvider;
  providerAgreementId: string;
  status: RecurringBillingStatus;
  interval: RecurringBillingInterval;
  billingDayOfMonth: number;
  nextBillingDate: string;
  requestedAt: string;
  requestedByUserId: string;
  activatedAt?: string;
  cancelledAt?: string;
  cancelReason?: string;
  lastFailureReason?: string;
};

export type Payment = {
  id: string;
  branchId: string;
  memberId: string;
  planName: string;
  status: PaymentStatus;
  amount: number;
  discountAmount?: number;
  dueDate: string;
  expiresAt: string;
  refundedAmount?: number;
  refundedAt?: string;
  refundReason?: string;
  onlinePayment?: OnlinePaymentRequest;
  recurringAgreement?: PaymentRecurringAgreement;
  statusHistory?: PaymentStatusHistoryEntry[];
};

export type PaymentStatusHistoryEntry = {
  id: string;
  status: PaymentStatus;
  changedAt: string;
  actorUserId: string;
  reason: string;
  event: "created" | "status_changed" | "refund" | "cancel" | "online_checkout" | "webhook" | "recurring_agreement";
  providerEventId?: string;
};

export type NoticeAudience = UserRole | "all";
export type NoticeTargetType = "branch" | "class" | "member";

export type Notice = {
  id: string;
  branchId: string;
  title: string;
  body: string;
  important?: boolean;
  audience: NoticeAudience[];
  createdAt: string;
  createdByUserId?: string;
  readByUserIds: string[];
  targetClassIds?: string[];
  targetMemberIds?: string[];
};

export type PushSubscriptionRecord = {
  id: string;
  userId: string;
  branchIds: string[];
  endpoint: string;
  keys: {
    auth: string;
    p256dh: string;
  };
  userAgent?: string;
  createdAt: string;
  updatedAt: string;
  disabledAt?: string;
  lastSentAt?: string;
  lastFailureAt?: string;
  lastFailureReason?: string;
};

export type PilotReadinessStatus = "pending" | "verified" | "blocked";

export type PilotReadinessCheck = {
  id: string;
  category: "scope" | "data" | "device" | "accessibility" | "incident" | "operation" | "security";
  label: string;
  status: PilotReadinessStatus;
  evidence: string;
  owner: string;
  checkedAt?: string;
  checkedByUserId?: string;
};

export type PilotIncidentSeverity = "p0" | "p1" | "p2";
export type PilotIncidentStatus = "open" | "monitoring" | "resolved";

export type PilotIncident = {
  id: string;
  branchId: string | null;
  severity: PilotIncidentSeverity;
  status: PilotIncidentStatus;
  title: string;
  description: string;
  role: UserRole | "unknown";
  screen: string;
  workaround: string;
  owner: string;
  reportedByUserId: string;
  createdAt: string;
  updatedAt: string;
  resolvedAt?: string;
};

export type PilotOperationLog = {
  id: string;
  branchId: string | null;
  date: string;
  status: PilotReadinessStatus;
  owner: string;
  evidence: string;
  classesChecked: number;
  attendanceRecords: number;
  paymentChecks: number;
  noticeFollowupChecks: number;
  noticeChecks: number;
  mobileAttendanceDurationSeconds?: number;
  mobileAttendanceEvidence?: string;
  blockerSummary?: string;
  checkedAt?: string;
  checkedByUserId?: string;
};

export type AuditAction =
  | "attendance.update"
  | "notice.create"
  | "notice.delete"
  | "notice.read"
  | "notification.subscribe"
  | "notification.unsubscribe"
  | "notification.dispatch"
  | "member.create"
  | "member.update"
  | "counseling_note.create"
  | "promotion.create"
  | "promotion.update"
  | "class.create"
  | "class.update"
  | "payment.create"
  | "payment.online_checkout.create"
  | "payment.webhook"
  | "payment.recurring_agreement.create"
  | "payment.recurring_agreement.cancel"
  | "payment.refund"
  | "branch.create"
  | "branch.update"
  | "branch.owner.assign"
  | "user.invite.create"
  | "user.invite.approve"
  | "user.update"
  | "user.role.update"
  | "user.delete"
  | "audit_logs.read"
  | "export.create"
  | "pilot_readiness.update"
  | "pilot_incident.create"
  | "pilot_incident.update"
  | "pilot_operation.update"
  | "auth.invite.accept"
  | "auth.password_reset.request"
  | "auth.password_reset.complete"
  | "auth.login"
  | "auth.logout";

export type AuditLog = {
  id: string;
  branchId: string | null;
  actorUserId: string;
  action: AuditAction;
  targetType:
    | "attendance"
    | "notice"
    | "notification"
    | "push_subscription"
    | "member"
    | "counseling_note"
    | "promotion"
    | "class"
    | "payment"
    | "branch"
    | "user"
    | "audit"
    | "export"
    | "pilot_readiness"
    | "pilot_incident"
    | "pilot_operation"
    | "auth";
  targetId: string;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  result: "success" | "blocked" | "failed";
  message: string;
  createdAt: string;
};

export type MockDatabase = {
  branches: Branch[];
  users: AppUser[];
  members: Member[];
  classes: ClassSession[];
  attendance: AttendanceRecord[];
  counselingNotes: CounselingNote[];
  promotions: BeltPromotion[];
  payments: Payment[];
  notices: Notice[];
  pushSubscriptions: PushSubscriptionRecord[];
  pilotReadinessChecks: PilotReadinessCheck[];
  pilotIncidents: PilotIncident[];
  pilotOperationLogs: PilotOperationLog[];
  auditLogs: AuditLog[];
};

export type EnrichedClassSession = ClassSession & {
  branch: Branch;
  coach: AppUser;
  enrolledMembers: Member[];
  attendance: AttendanceRecord[];
};

export type EnrichedPayment = Payment & {
  member: Member;
  branch: Branch;
};

export type DashboardMetric = {
  label: string;
  value: string;
  tone: "neutral" | "good" | "warning" | "critical";
  helper: string;
};

export type DashboardSummary = {
  metrics: DashboardMetric[];
  todaysClasses: EnrichedClassSession[];
  expiringPayments: EnrichedPayment[];
  notices: Notice[];
};
