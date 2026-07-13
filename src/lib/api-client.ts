import type {
  AppUser,
  AuditAction,
  AuditLog,
  Branch,
  BranchSettings,
  BranchStatus,
  AttendanceStatus,
  ClassSession,
  CounselingNote,
  CounselingNoteVisibility,
  Member,
  MemberStatus,
  MockDatabase,
  NoticeAudience,
  OnlinePaymentRequest,
  PaymentRecurringAgreement,
  PilotReadinessStatus,
  PilotIncidentSeverity,
  PilotIncidentStatus,
  PilotOperationLog,
  Payment,
  PaymentStatus,
  UserRole,
} from "@/lib/domain";
import { getAccessibleBranchIds, getAccessibleMemberIds, getSelectedBranchIds, mockApi } from "@/lib/mock-api";
import type { ManualPaymentUpdatePayload } from "@/lib/manual-payment-management";

export type { ManualPaymentUpdatePayload };

export { getAccessibleBranchIds, getAccessibleMemberIds, getSelectedBranchIds };

export type BootstrapPayload = {
  user: AppUser;
  selectedBranchId: string | null;
  db: MockDatabase;
};

type ApiEnvelope<T> = {
  data?: T;
  error?: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
  };
};

const apiRequestTimeoutMs = 12_000;

export class ApiClientError extends Error {
  status: number;
  code: string;
  details?: Record<string, unknown>;

  constructor(message: string, { status, code, details }: { status: number; code: string; details?: Record<string, unknown> }) {
    super(message);
    this.name = "ApiClientError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

function createNetworkError(error: unknown) {
  return new ApiClientError("연결이 불안정합니다. 잠시 후 다시 시도해 주세요.", {
    status: 0,
    code: "NETWORK_ERROR",
    details: {
      cause: error instanceof Error ? error.message : String(error),
    },
  });
}

function createRequestTimeoutSignal(init?: RequestInit) {
  if (init?.signal) {
    return { signal: init.signal, clear: () => undefined };
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), apiRequestTimeoutMs);

  return {
    signal: controller.signal,
    clear: () => clearTimeout(timeoutId),
  };
}

export type ClassSessionCreatePayload = Pick<
  ClassSession,
  "name" | "level" | "ageGroup" | "coachId" | "startsAt" | "endsAt" | "room" | "capacity" | "enrolledMemberIds"
>;

export type ClassSessionUpdatePayload = Partial<ClassSessionCreatePayload>;

export type PaymentCreatePayload = Pick<Payment, "memberId" | "planName" | "amount" | "dueDate" | "expiresAt"> & {
  discountAmount?: number;
  reason?: string;
  status: PaymentStatus;
};

export type PaymentRefundPayload = {
  amount?: number;
  cancel?: boolean;
  reason: string;
};

export type PaymentDeletePayload = {
  reason: string;
};

export type OnlinePaymentCheckoutPayload = BootstrapPayload & {
  checkout: OnlinePaymentRequest;
};

export type RecurringAgreementPayload = {
  billingDayOfMonth?: number;
  nextBillingDate?: string;
  reason?: string;
};

export type RecurringAgreementResponse = BootstrapPayload & {
  recurringAgreement: PaymentRecurringAgreement;
};

export type BranchCreatePayload = {
  name: string;
  district: string;
  ownerUserId?: string;
};

export type BranchUpdatePayload = {
  district: string;
  name: string;
  reason: string;
  settings: BranchSettings;
  status: BranchStatus;
  timezone: NonNullable<Branch["timezone"]>;
};

export type NoticeCreatePayload = {
  title: string;
  body: string;
  important?: boolean;
  audience: NoticeAudience[];
  targetClassIds?: string[];
  targetMemberIds?: string[];
};

export type NoticeDispatchSummaryPayload = {
  attempted: number;
  configured: boolean;
  disabled: number;
  failed: number;
  recipientCount: number;
  message: string;
  sent: number;
};

export type PushConfigPayload = {
  activeSubscriptionCount: number;
  configured: boolean;
  currentUserSubscribed: boolean;
  publicKey: string | null;
  subject: string | null;
};

export type PushSubscriptionPayload = {
  activeSubscriptionCount: number;
  subscription: {
    disabledAt: string | null;
    endpointHint: string;
    id: string;
  };
};

export type NoticePushPayload = BootstrapPayload & {
  push: NoticeDispatchSummaryPayload;
};

export type NoticeCreateResponsePayload = BootstrapPayload & {
  notice: {
    id: string;
  };
  push: NoticeDispatchSummaryPayload;
};

export type NoticeDeleteResponsePayload = BootstrapPayload & {
  notice: {
    deletedAt: string;
    id: string;
  };
};

export type NoticeUpdatePayload = {
  title?: string;
  body?: string;
  important?: boolean;
  audience?: NoticeAudience[];
};

export type NoticeUpdateResponsePayload = BootstrapPayload & {
  notice: {
    id: string;
    updatedAt: string;
  };
};

export type CounselingNoteCreatePayload = {
  body: string;
  noteType: CounselingNote["noteType"];
  visibility: CounselingNoteVisibility;
};

export type GuardianLinkPayload = {
  guardianUserId: string;
};

export type TournamentPayload = {
  title: string;
  organizer: string;
  eventDate: string;
  location?: string;
  registrationDeadline?: string;
  sourceUrl?: string;
  description?: string;
};

export type MemberUpdatePayload = Partial<
  Pick<Member, "ageGroup" | "alerts" | "belt" | "emergencyContact" | "level" | "name" | "status">
> & {
  // 빈 문자열은 값 지우기를 의미한다 (서버에서 undefined로 정리).
  gender?: Member["gender"] | "";
  birthDate?: string;
  address?: string;
};

export type InvitationCreatePayload = {
  name: string;
  email?: string;
  phone: string;
  role: UserRole;
  branchIds: string[];
};

export type AdminUserUpdatePayload = {
  name: string;
  email?: string;
  phone: string;
  title: string;
  role: UserRole;
  branchIds: string[];
  memberIds?: string[];
  childMemberIds?: string[];
  reason: string;
  password?: string;
};

export type AdminUserDeletePayload = {
  reason: string;
};

export type AdminPasswordResetPayload = {
  reason: string;
  temporaryPassword?: string;
};

export type LoginCredentials = {
  keepSignedIn?: boolean;
  phone: string;
  password: string;
};

export type PhoneSignupPayload = {
  name: string;
  password: string;
  phone: string;
};

type PhoneSignupResponse = {
  memberId: string;
  ok: boolean;
  userId: string;
};

type InvitationPayload = BootstrapPayload & {
  invitation: {
    userId: string;
    token: string;
    path: string;
  };
};

export type InvitationApprovalResult = {
  userId: string;
  temporaryPassword: string | null;
  approvedAt: string;
};

type InvitationApprovalResponse = BootstrapPayload & {
  approval: InvitationApprovalResult;
};

type AdminPasswordResetResponse = BootstrapPayload & {
  password: {
    userId: string;
    temporaryPassword: string;
    issuedAt: string;
  };
};

export type AuditLogsQuery = {
  action?: AuditAction | "all";
  branchId?: string;
  from?: string;
  limit?: number;
  q?: string;
  reason?: string;
  result?: AuditLog["result"] | "all";
  to?: string;
};

export type AuditLogsPayload = {
  filters: {
    action: AuditAction | null;
    branchId: string;
    from: string | null;
    limit: number;
    query: string;
    result: AuditLog["result"] | null;
    to: string | null;
  };
  logs: AuditLog[];
  summary: {
    blockedCount: number;
    exportCount: number;
    failedCount: number;
    filteredCount: number;
    returnedCount: number;
    successCount: number;
    totalCount: number;
  };
};

export type PilotReadinessUpdatePayload = {
  checkId: string;
  evidence: string;
  owner: string;
  status: PilotReadinessStatus;
};

export type PilotIncidentCreatePayload = {
  branchId: string | null;
  description: string;
  owner: string;
  role: UserRole | "unknown";
  screen: string;
  severity: PilotIncidentSeverity;
  title: string;
  workaround: string;
};

export type PilotIncidentUpdatePayload = {
  owner?: string;
  status?: PilotIncidentStatus;
  workaround?: string;
};

export type PilotOperationLogPayload = {
  attendanceRecords: number;
  blockerSummary?: string;
  branchId: string | null;
  classesChecked: number;
  date: string;
  evidence: string;
  mobileAttendanceDurationSeconds?: number;
  mobileAttendanceEvidence?: string;
  noticeChecks: number;
  owner: string;
  paymentChecks: number;
  noticeFollowupChecks: number;
  status: PilotOperationLog["status"];
};

function selectedBranchQuery(selectedBranchId: string | null | undefined) {
  if (!selectedBranchId) {
    return "";
  }

  return `?selectedBranchId=${encodeURIComponent(selectedBranchId)}`;
}

function bootstrapQuery(selectedBranchId: string | null | undefined, { optional = false } = {}) {
  const searchParams = new URLSearchParams();

  if (selectedBranchId) {
    searchParams.set("selectedBranchId", selectedBranchId);
  }

  if (optional) {
    searchParams.set("optional", "1");
  }

  const query = searchParams.toString();

  return query ? `?${query}` : "";
}

function createAuditLogQuery(query: AuditLogsQuery) {
  const searchParams = new URLSearchParams();

  if (query.action && query.action !== "all") {
    searchParams.set("action", query.action);
  }

  if (query.branchId && query.branchId !== "all") {
    searchParams.set("branchId", query.branchId);
  }

  if (query.from) {
    searchParams.set("from", query.from);
  }

  if (query.limit) {
    searchParams.set("limit", String(query.limit));
  }

  if (query.q?.trim()) {
    searchParams.set("q", query.q.trim());
  }

  searchParams.set("reason", query.reason?.trim() || "변경 기록 조회");

  if (query.result && query.result !== "all") {
    searchParams.set("result", query.result);
  }

  if (query.to) {
    searchParams.set("to", query.to);
  }

  const serialized = searchParams.toString();

  return serialized ? `?${serialized}` : "";
}

function getStoredUserId(): string | null {
  try {
    const raw = typeof window !== "undefined" ? window.localStorage.getItem("final-judo-mvp-session") : null;
    if (!raw) return null;
    const session = JSON.parse(raw) as { userId?: string };
    return session?.userId ?? null;
  } catch {
    return null;
  }
}

function canSendStoredUserHeader() {
  return process.env.NODE_ENV !== "production";
}

async function apiRequest<T>(path: string, init?: RequestInit) {
  let response: Response;
  const timeout = createRequestTimeoutSignal(init);
  const storedUserId = canSendStoredUserHeader() ? getStoredUserId() : null;
  const headers = new Headers(init?.headers);

  if (!headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  if (storedUserId) {
    headers.set("x-user-id", storedUserId);
  }

  try {
    response = await fetch(path, {
      credentials: "same-origin",
      ...init,
      headers,
      signal: timeout.signal,
    });
  } catch (error) {
    throw createNetworkError(error);
  } finally {
    timeout.clear();
  }

  const payload = (await response.json().catch(() => ({}))) as ApiEnvelope<T>;

  if (!response.ok || payload.data === undefined) {
    throw new ApiClientError(payload.error?.message ?? "요청을 처리하지 못했습니다.", {
      status: response.status,
      code: payload.error?.code ?? (response.ok ? "INVALID_RESPONSE" : "HTTP_ERROR"),
      details: payload.error?.details,
    });
  }

  return payload.data;
}

async function textRequest(path: string, init?: RequestInit) {
  let response: Response;
  const timeout = createRequestTimeoutSignal(init);
  const storedUserId = canSendStoredUserHeader() ? getStoredUserId() : null;

  try {
    response = await fetch(path, {
      credentials: "same-origin",
      headers: {
        ...(storedUserId ? { "x-user-id": storedUserId } : {}),
        ...(init?.headers ?? {}),
      },
      ...init,
      signal: timeout.signal,
    });
  } catch (error) {
    throw createNetworkError(error);
  } finally {
    timeout.clear();
  }

  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as ApiEnvelope<never>;
    throw new ApiClientError(payload.error?.message ?? "요청을 처리하지 못했습니다.", {
      status: response.status,
      code: payload.error?.code ?? "HTTP_ERROR",
      details: payload.error?.details,
    });
  }

  return response.text();
}

export const apiClient = {
  signIn(payload: UserRole | LoginCredentials) {
    const body = typeof payload === "string" ? { role: payload } : payload;

    return apiRequest<BootstrapPayload>("/api/v1/auth/login", {
      method: "POST",
      body: JSON.stringify(body),
    });
  },

  registerWithPhone(payload: PhoneSignupPayload) {
    return apiRequest<PhoneSignupResponse>("/api/v1/auth/register", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },

  signOut() {
    return apiRequest<{ ok: boolean }>("/api/v1/auth/logout", {
      method: "POST",
      body: JSON.stringify({}),
    });
  },

  getBootstrap(selectedBranchId: string | null) {
    return apiRequest<BootstrapPayload>(`/api/v1/me/bootstrap${bootstrapQuery(selectedBranchId)}`);
  },

  getOptionalBootstrap(selectedBranchId: string | null) {
    return apiRequest<BootstrapPayload | null>(`/api/v1/me/bootstrap${bootstrapQuery(selectedBranchId, { optional: true })}`);
  },

  updateAttendanceBatch(
    sessionId: string,
    items: Array<{ memberId: string; status: AttendanceStatus; note?: string }>,
    selectedBranchId: string | null,
    reason?: string,
  ) {
    const cleanReason = reason?.trim();

    return apiRequest<BootstrapPayload>(
      `/api/v1/class-sessions/${encodeURIComponent(sessionId)}/attendance${selectedBranchQuery(selectedBranchId)}`,
      {
        method: "PUT",
        body: JSON.stringify({
          items: items.map((item) => {
            const cleanNote = item.note?.trim();

            return {
              memberId: item.memberId,
              status: item.status,
              ...(cleanNote ? { note: cleanNote } : {}),
            };
          }),
          ...(cleanReason ? { reason: cleanReason } : {}),
        }),
      },
    );
  },

  updateAttendance(
    sessionId: string,
    memberId: string,
    status: AttendanceStatus,
    selectedBranchId: string | null,
    note?: string,
  ) {
    const cleanNote = note?.trim();

    return this.updateAttendanceBatch(
      sessionId,
      [{ memberId, status, ...(cleanNote ? { note: cleanNote } : {}) }],
      selectedBranchId,
      cleanNote,
    );
  },

  updateAttendanceReason(sessionId: string, memberId: string, reason: string, selectedBranchId: string | null) {
    return apiRequest<BootstrapPayload>(
      `/api/v1/class-sessions/${encodeURIComponent(sessionId)}/attendance/${encodeURIComponent(memberId)}/reason${selectedBranchQuery(selectedBranchId)}`,
      {
        method: "POST",
        body: JSON.stringify({ reason }),
      },
    );
  },

  markNoticeAsRead(noticeId: string, selectedBranchId: string | null) {
    return apiRequest<BootstrapPayload>(
      `/api/v1/me/notices/${encodeURIComponent(noticeId)}/read${selectedBranchQuery(selectedBranchId)}`,
      {
        method: "POST",
        body: JSON.stringify({}),
      },
    );
  },

  markNoticesAsRead(noticeIds: string[], selectedBranchId: string | null) {
    return apiRequest<BootstrapPayload & { bulkRead: { requested: number; updated: number } }>(
      `/api/v1/me/notices/bulk-read${selectedBranchQuery(selectedBranchId)}`,
      {
        method: "POST",
        body: JSON.stringify({ noticeIds }),
      },
    );
  },

  createMember(
    branchId: string,
    payload: {
      name: string;
      status: MemberStatus;
      ageGroup: Member["ageGroup"];
      level: string;
      belt: string;
      emergencyContact: string;
      gender?: Member["gender"] | "";
      birthDate?: string;
      address?: string;
    },
    selectedBranchId: string | null,
  ) {
    return apiRequest<BootstrapPayload>(
      `/api/v1/branches/${encodeURIComponent(branchId)}/members${selectedBranchQuery(selectedBranchId)}`,
      {
        method: "POST",
        body: JSON.stringify(payload),
      },
    );
  },

  updateMember(memberId: string, payload: MemberUpdatePayload, selectedBranchId: string | null) {
    return apiRequest<BootstrapPayload>(
      `/api/v1/members/${encodeURIComponent(memberId)}${selectedBranchQuery(selectedBranchId)}`,
      {
        method: "PATCH",
        body: JSON.stringify(payload),
      },
    );
  },

  updateMemberStatus(memberId: string, status: MemberStatus, selectedBranchId: string | null) {
    return this.updateMember(memberId, { status }, selectedBranchId);
  },

  createCounselingNote(
    branchId: string,
    memberId: string,
    payload: CounselingNoteCreatePayload,
    selectedBranchId: string | null,
  ) {
    return apiRequest<BootstrapPayload>(
      `/api/v1/branches/${encodeURIComponent(branchId)}/members/${encodeURIComponent(memberId)}/counseling-notes${selectedBranchQuery(selectedBranchId)}`,
      {
        method: "POST",
        body: JSON.stringify(payload),
      },
    );
  },

  linkGuardian(memberId: string, payload: GuardianLinkPayload, selectedBranchId: string | null) {
    return apiRequest<BootstrapPayload>(
      `/api/v1/members/${encodeURIComponent(memberId)}/guardians${selectedBranchQuery(selectedBranchId)}`,
      {
        method: "POST",
        body: JSON.stringify(payload),
      },
    );
  },

  unlinkGuardian(memberId: string, payload: GuardianLinkPayload, selectedBranchId: string | null) {
    return apiRequest<BootstrapPayload>(
      `/api/v1/members/${encodeURIComponent(memberId)}/guardians${selectedBranchQuery(selectedBranchId)}`,
      {
        method: "DELETE",
        body: JSON.stringify(payload),
      },
    );
  },

  replaceGuardian(memberId: string, payload: GuardianLinkPayload, selectedBranchId: string | null) {
    return apiRequest<BootstrapPayload>(
      `/api/v1/members/${encodeURIComponent(memberId)}/guardians${selectedBranchQuery(selectedBranchId)}`,
      {
        method: "PUT",
        body: JSON.stringify(payload),
      },
    );
  },

  createClassSession(branchId: string, payload: ClassSessionCreatePayload, selectedBranchId: string | null) {
    return apiRequest<BootstrapPayload>(
      `/api/v1/branches/${encodeURIComponent(branchId)}/classes${selectedBranchQuery(selectedBranchId)}`,
      {
        method: "POST",
        body: JSON.stringify(payload),
      },
    );
  },

  updateClassSession(classId: string, payload: ClassSessionUpdatePayload, selectedBranchId: string | null) {
    return apiRequest<BootstrapPayload>(
      `/api/v1/classes/${encodeURIComponent(classId)}${selectedBranchQuery(selectedBranchId)}`,
      {
        method: "PATCH",
        body: JSON.stringify(payload),
      },
    );
  },

  createPayment(
    branchId: string,
    payload: PaymentCreatePayload,
    selectedBranchId: string | null,
    idempotencyKey?: string,
  ) {
    return apiRequest<BootstrapPayload>(
      `/api/v1/branches/${encodeURIComponent(branchId)}/payments${selectedBranchQuery(selectedBranchId)}`,
      {
        method: "POST",
        ...(idempotencyKey ? { headers: { "Idempotency-Key": idempotencyKey } } : {}),
        body: JSON.stringify(payload),
      },
    );
  },

  updateManualPayment(paymentId: string, payload: ManualPaymentUpdatePayload, selectedBranchId: string | null) {
    return apiRequest<BootstrapPayload>(
      `/api/v1/payments/${encodeURIComponent(paymentId)}${selectedBranchQuery(selectedBranchId)}`,
      {
        method: "PATCH",
        body: JSON.stringify(payload),
      },
    );
  },

  deleteManualPayment(paymentId: string, payload: PaymentDeletePayload, selectedBranchId: string | null) {
    return apiRequest<BootstrapPayload>(
      `/api/v1/payments/${encodeURIComponent(paymentId)}${selectedBranchQuery(selectedBranchId)}`,
      {
        method: "DELETE",
        body: JSON.stringify(payload),
      },
    );
  },

  refundPayment(paymentId: string, payload: PaymentRefundPayload, selectedBranchId: string | null) {
    return apiRequest<BootstrapPayload>(
      `/api/v1/payments/${encodeURIComponent(paymentId)}/refund${selectedBranchQuery(selectedBranchId)}`,
      {
        method: "POST",
        body: JSON.stringify(payload),
      },
    );
  },

  createOnlinePaymentCheckout(paymentId: string, selectedBranchId: string | null) {
    return apiRequest<OnlinePaymentCheckoutPayload>(
      `/api/v1/payments/${encodeURIComponent(paymentId)}/online-checkout${selectedBranchQuery(selectedBranchId)}`,
      {
        method: "POST",
        body: JSON.stringify({}),
      },
    );
  },

  createRecurringAgreement(paymentId: string, payload: RecurringAgreementPayload, selectedBranchId: string | null) {
    return apiRequest<RecurringAgreementResponse>(
      `/api/v1/payments/${encodeURIComponent(paymentId)}/recurring-agreement${selectedBranchQuery(selectedBranchId)}`,
      {
        method: "POST",
        body: JSON.stringify(payload),
      },
    );
  },

  cancelRecurringAgreement(paymentId: string, payload: RecurringAgreementPayload, selectedBranchId: string | null) {
    return apiRequest<RecurringAgreementResponse>(
      `/api/v1/payments/${encodeURIComponent(paymentId)}/recurring-agreement${selectedBranchQuery(selectedBranchId)}`,
      {
        method: "DELETE",
        body: JSON.stringify(payload),
      },
    );
  },

  updateUserRole(userId: string, role: UserRole, reason: string, selectedBranchId: string | null) {
    return apiRequest<BootstrapPayload>(
      `/api/v1/admin/users/${encodeURIComponent(userId)}/roles${selectedBranchQuery(selectedBranchId)}`,
      {
        method: "PUT",
        body: JSON.stringify({ role, reason }),
      },
    );
  },

  updateUser(userId: string, payload: AdminUserUpdatePayload, selectedBranchId: string | null) {
    return apiRequest<BootstrapPayload>(
      `/api/v1/admin/users/${encodeURIComponent(userId)}${selectedBranchQuery(selectedBranchId)}`,
      {
        method: "PATCH",
        body: JSON.stringify(payload),
      },
    );
  },

  deleteUser(userId: string, payload: AdminUserDeletePayload, selectedBranchId: string | null) {
    return apiRequest<BootstrapPayload>(
      `/api/v1/admin/users/${encodeURIComponent(userId)}${selectedBranchQuery(selectedBranchId)}`,
      {
        method: "DELETE",
        body: JSON.stringify(payload),
      },
    );
  },

  createInvitation(payload: InvitationCreatePayload, selectedBranchId: string | null) {
    return apiRequest<InvitationPayload>(`/api/v1/admin/users/invitations${selectedBranchQuery(selectedBranchId)}`, {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },

  approveInvitation(userId: string, selectedBranchId: string | null) {
    return apiRequest<InvitationApprovalResponse>(
      `/api/v1/admin/users/${encodeURIComponent(userId)}/approve-invitation${selectedBranchQuery(selectedBranchId)}`,
      {
        method: "POST",
      },
    );
  },

  resetUserPassword(userId: string, payload: AdminPasswordResetPayload, selectedBranchId: string | null) {
    return apiRequest<AdminPasswordResetResponse>(
      `/api/v1/admin/users/${encodeURIComponent(userId)}/password${selectedBranchQuery(selectedBranchId)}`,
      {
        method: "POST",
        body: JSON.stringify(payload),
      },
    );
  },

  requestPasswordReset(identifier: string) {
    return apiRequest<{ ok: boolean }>("/api/v1/auth/password-reset", {
      method: "POST",
      body: JSON.stringify({ identifier }),
    });
  },

  acceptInvitation(token: string, password: string) {
    return apiRequest<BootstrapPayload>(`/api/v1/auth/invitations/${encodeURIComponent(token)}/accept`, {
      method: "POST",
      body: JSON.stringify({ password }),
    });
  },

  createBranch(payload: BranchCreatePayload, selectedBranchId: string | null) {
    return apiRequest<BootstrapPayload>(`/api/v1/admin/branches${selectedBranchQuery(selectedBranchId)}`, {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },

  updateBranch(branchId: string, payload: BranchUpdatePayload, selectedBranchId: string | null) {
    return apiRequest<BootstrapPayload>(
      `/api/v1/admin/branches/${encodeURIComponent(branchId)}${selectedBranchQuery(selectedBranchId)}`,
      {
        method: "PATCH",
        body: JSON.stringify(payload),
      },
    );
  },

  assignBranchOwner(branchId: string, ownerUserId: string, selectedBranchId: string | null) {
    return apiRequest<BootstrapPayload>(
      `/api/v1/admin/branches/${encodeURIComponent(branchId)}/owner${selectedBranchQuery(selectedBranchId)}`,
      {
        method: "PUT",
        body: JSON.stringify({ ownerUserId }),
      },
    );
  },

  getAuditLogs(query: AuditLogsQuery = {}) {
    return apiRequest<AuditLogsPayload>(`/api/v1/admin/audit-logs${createAuditLogQuery(query)}`);
  },

  updatePilotReadiness(payload: PilotReadinessUpdatePayload, selectedBranchId: string | null) {
    return apiRequest<BootstrapPayload>(`/api/v1/admin/pilot-readiness${selectedBranchQuery(selectedBranchId)}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    });
  },

  createPilotIncident(payload: PilotIncidentCreatePayload, selectedBranchId: string | null) {
    return apiRequest<BootstrapPayload>(`/api/v1/admin/pilot-incidents${selectedBranchQuery(selectedBranchId)}`, {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },

  updatePilotIncident(incidentId: string, payload: PilotIncidentUpdatePayload, selectedBranchId: string | null) {
    return apiRequest<BootstrapPayload>(
      `/api/v1/admin/pilot-incidents/${encodeURIComponent(incidentId)}${selectedBranchQuery(selectedBranchId)}`,
      {
        method: "PATCH",
        body: JSON.stringify(payload),
      },
    );
  },

  upsertPilotOperationLog(payload: PilotOperationLogPayload, selectedBranchId: string | null) {
    return apiRequest<BootstrapPayload>(`/api/v1/admin/pilot-operations${selectedBranchQuery(selectedBranchId)}`, {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },

  exportPaymentsCsv(selectedBranchId: string | null) {
    return textRequest(`/api/v1/exports/payments${selectedBranchQuery(selectedBranchId)}`);
  },

  exportOperationsCsv(selectedBranchId: string | null) {
    return textRequest(`/api/v1/exports/operations${selectedBranchQuery(selectedBranchId)}`);
  },

  createPromotion(
    payload: { memberId: string; toBelt: string; examDate: string; note?: string },
    selectedBranchId: string | null,
  ) {
    return apiRequest<BootstrapPayload>(`/api/v1/promotions${selectedBranchQuery(selectedBranchId)}`, {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },

  updatePromotion(
    promotionId: string,
    payload: { result: "passed" | "failed" | "cancelled"; score?: number; note?: string },
    selectedBranchId: string | null,
  ) {
    return apiRequest<BootstrapPayload>(
      `/api/v1/promotions/${encodeURIComponent(promotionId)}${selectedBranchQuery(selectedBranchId)}`,
      {
        method: "PATCH",
        body: JSON.stringify(payload),
      },
    );
  },

  createTournament(payload: TournamentPayload, selectedBranchId: string | null) {
    return apiRequest<BootstrapPayload>(`/api/v1/tournaments${selectedBranchQuery(selectedBranchId)}`, {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },

  updateTournament(tournamentId: string, payload: TournamentPayload, selectedBranchId: string | null) {
    return apiRequest<BootstrapPayload>(
      `/api/v1/tournaments/${encodeURIComponent(tournamentId)}${selectedBranchQuery(selectedBranchId)}`,
      {
        method: "PATCH",
        body: JSON.stringify(payload),
      },
    );
  },

  deleteTournament(tournamentId: string, selectedBranchId: string | null) {
    return apiRequest<BootstrapPayload>(
      `/api/v1/tournaments/${encodeURIComponent(tournamentId)}${selectedBranchQuery(selectedBranchId)}`,
      {
        method: "DELETE",
      },
    );
  },

  createNotice(branchId: string, payload: NoticeCreatePayload, selectedBranchId: string | null) {
    return apiRequest<NoticeCreateResponsePayload>(
      `/api/v1/branches/${encodeURIComponent(branchId)}/notices${selectedBranchQuery(selectedBranchId)}`,
      {
        method: "POST",
        body: JSON.stringify(payload),
      },
    );
  },

  updateNotice(branchId: string, noticeId: string, payload: NoticeUpdatePayload, selectedBranchId: string | null) {
    return apiRequest<NoticeUpdateResponsePayload>(
      `/api/v1/branches/${encodeURIComponent(branchId)}/notices/${encodeURIComponent(noticeId)}${selectedBranchQuery(selectedBranchId)}`,
      {
        method: "PATCH",
        body: JSON.stringify(payload),
      },
    );
  },

  deleteNotice(branchId: string, noticeId: string, selectedBranchId: string | null) {
    return apiRequest<NoticeDeleteResponsePayload>(
      `/api/v1/branches/${encodeURIComponent(branchId)}/notices/${encodeURIComponent(noticeId)}${selectedBranchQuery(selectedBranchId)}`,
      {
        method: "DELETE",
        body: JSON.stringify({}),
      },
    );
  },

  getPushConfig() {
    return apiRequest<PushConfigPayload>("/api/v1/notifications/push-config");
  },

  subscribeToPush(subscription: PushSubscriptionJSON, userAgent: string) {
    return apiRequest<PushSubscriptionPayload>("/api/v1/notifications/subscriptions", {
      method: "POST",
      body: JSON.stringify({ subscription, userAgent }),
    });
  },

  unsubscribeFromPush(endpoint: string) {
    return apiRequest<PushSubscriptionPayload>("/api/v1/notifications/subscriptions", {
      method: "DELETE",
      body: JSON.stringify({ endpoint }),
    });
  },

  dispatchNoticePush(branchId: string, noticeId: string, selectedBranchId: string | null) {
    return apiRequest<NoticePushPayload>(
      `/api/v1/branches/${encodeURIComponent(branchId)}/notices/${encodeURIComponent(noticeId)}/push${selectedBranchQuery(selectedBranchId)}`,
      {
        method: "POST",
        body: JSON.stringify({}),
      },
    );
  },

  getDashboard: mockApi.getDashboard,
  getClasses: mockApi.getClasses,
  getMembers: mockApi.getMembers,
  getPayments: mockApi.getPayments,
  getNotices: mockApi.getNotices,
};
