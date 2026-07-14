"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useState,
  type ReactNode,
} from "react";
import type {
  AppUser,
  AttendanceStatus,
  Member,
  MemberStatus,
  MockDatabase,
  SaveStatus,
  UserRole,
} from "@/lib/domain";
import { createMockData } from "@/lib/mock-data";
import {
  ApiClientError,
  apiClient,
  getAccessibleBranchIds,
  type AdminUserDeletePayload,
  type AdminUserUpdatePayload,
  type AdminPasswordResetPayload,
  type BranchCreatePayload,
  type BranchUpdatePayload,
  type BootstrapPayload,
  type ClassSessionCreatePayload,
  type ClassSessionUpdatePayload,
  type CounselingNoteCreatePayload,
  type GuardianLinkPayload,
  type InvitationCreatePayload,
  type InvitationApprovalResult,
  type LoginCredentials,
  type MemberUpdatePayload,
  type NoticeCreatePayload,
  type NoticeUpdatePayload,
  type ManualPaymentUpdatePayload,
  type PaymentCreatePayload,
  type PaymentDeletePayload,
  type PaymentRefundPayload,
  type PilotIncidentCreatePayload,
  type PilotIncidentUpdatePayload,
  type PilotOperationLogPayload,
  type PilotReadinessUpdatePayload,
  type TournamentPayload,
  type RecurringAgreementPayload,
} from "@/lib/api-client";

type PersistedSession = {
  userId: string;
  selectedBranchId: string | null;
};

type AppState = {
  db: MockDatabase;
  user: AppUser | null;
  selectedBranchId: string | null;
  operationError: OperationError | null;
  attendanceSync: {
    status: SaveStatus;
    message: string;
    updatedAt: string | null;
    pendingCount: number;
    queue: PendingAttendanceUpdate[];
  };
  version: number;
};

type PendingAttendanceUpdate = {
  id: string;
  sessionId: string;
  memberId: string;
  status: AttendanceStatus;
  note?: string;
  actorUserId: string;
  queuedAt: string;
  selectedBranchId: string | null;
};

type OperationError = {
  id: string;
  title: string;
  message: string;
  status?: number;
  code?: string;
  createdAt: string;
};

type AppAction =
  | { type: "bootstrap"; payload: BootstrapPayload }
  | { type: "login"; user: AppUser; selectedBranchId: string | null }
  | { type: "logout" }
  | { type: "selectBranch"; branchId: string | null }
  | { type: "setOperationError"; error: OperationError }
  | { type: "clearOperationError" }
  | { type: "restoreAttendanceQueue"; queue: PendingAttendanceUpdate[] }
  | {
      type: "serverSnapshot";
      payload: BootstrapPayload;
      syncStatus?: SaveStatus;
      message?: string;
      pendingCount?: number;
      clearAttendanceQueue?: boolean;
    }
  | {
      type: "setAttendanceSync";
      syncStatus: SaveStatus;
      message: string;
      pendingCount?: number;
    }
  | {
      type: "markAttendance";
      sessionId: string;
      memberId: string;
      status: AttendanceStatus;
      note?: string;
      actorUserId: string;
      syncStatus: SaveStatus;
      message: string;
      pendingCount: number;
      queuedUpdate?: PendingAttendanceUpdate;
    }
  | {
      type: "markAttendanceBatch";
      sessionId: string;
      memberIds: string[];
      status: AttendanceStatus;
      note?: string;
      syncStatus: SaveStatus;
      message: string;
      pendingCount: number;
      queuedUpdates?: PendingAttendanceUpdate[];
    };

type InvitationAcceptResult = { ok: true } | { ok: false; message: string };
type NoticeCreateResult = { ok: true; message: string } | { ok: false; message: string };
type NoticeDeleteResult = { ok: true; message: string } | { ok: false; message: string };
type PaymentCreateResult = { ok: true; message: string } | { ok: false; message: string };

type AppStore = AppState & {
  hydrated: boolean;
  authPending: boolean;
  authError: string | null;
  operationError: OperationError | null;
  accessibleBranchIds: string[];
  attendanceSync: AppState["attendanceSync"];
  signIn: (payload: UserRole | LoginCredentials) => Promise<boolean>;
  signOut: () => void;
  clearOperationError: () => void;
  selectBranch: (branchId: string | null) => void;
  markAttendance: (sessionId: string, memberId: string, status: AttendanceStatus, note?: string) => void;
  markSessionAttendance: (sessionId: string, memberIds: string[], status: AttendanceStatus, note?: string) => void;
  saveAttendanceReason: (sessionId: string, memberId: string, reason: string) => Promise<boolean>;
  syncPendingAttendance: () => Promise<boolean>;
  markNoticeAsRead: (noticeId: string) => Promise<boolean>;
  markNoticesAsRead: (noticeIds: string[]) => Promise<boolean>;
  createMember: (branchId: string, payload: {
    name: string;
    status: MemberStatus;
    ageGroup: Member["ageGroup"];
    level: string;
    belt: string;
    emergencyContact: string;
    gender?: Member["gender"] | "";
    birthDate?: string;
    address?: string;
  }) => void;
  updateMemberStatus: (memberId: string, status: MemberStatus) => void;
  updateMemberProfile: (memberId: string, payload: MemberUpdatePayload) => Promise<boolean>;
  createCounselingNote: (branchId: string, memberId: string, payload: CounselingNoteCreatePayload) => Promise<boolean>;
  linkGuardian: (memberId: string, payload: GuardianLinkPayload) => Promise<boolean>;
  unlinkGuardian: (memberId: string, payload: GuardianLinkPayload) => Promise<boolean>;
  replaceGuardian: (memberId: string, payload: GuardianLinkPayload) => Promise<boolean>;
  createClassSession: (branchId: string, payload: ClassSessionCreatePayload) => void;
  updateClassSession: (classId: string, payload: ClassSessionUpdatePayload) => void;
  createPayment: (branchId: string, payload: PaymentCreatePayload, idempotencyKey?: string) => Promise<PaymentCreateResult>;
  updateManualPayment: (paymentId: string, payload: ManualPaymentUpdatePayload) => Promise<boolean>;
  deleteManualPayment: (paymentId: string, payload: PaymentDeletePayload) => Promise<boolean>;
  createOnlinePaymentCheckout: (paymentId: string) => Promise<boolean>;
  createRecurringAgreement: (paymentId: string, payload: RecurringAgreementPayload) => Promise<boolean>;
  cancelRecurringAgreement: (paymentId: string, payload: RecurringAgreementPayload) => Promise<boolean>;
  refundPayment: (paymentId: string, payload: PaymentRefundPayload) => Promise<boolean>;
  updateUserRole: (userId: string, role: UserRole, reason: string) => Promise<boolean>;
  updateUser: (userId: string, payload: AdminUserUpdatePayload) => Promise<boolean>;
  deleteUser: (userId: string, payload: AdminUserDeletePayload) => Promise<boolean>;
  createInvitation: (payload: InvitationCreatePayload) => Promise<string | null>;
  reissueInvitationLink: (userId: string) => Promise<string | null>;
  approveInvitation: (userId: string) => Promise<InvitationApprovalResult | null>;
  resetUserPassword: (userId: string, payload: AdminPasswordResetPayload) => Promise<string | null>;
  acceptInvitation: (token: string, password: string) => Promise<InvitationAcceptResult>;
  createBranch: (payload: BranchCreatePayload) => Promise<boolean>;
  updateBranch: (branchId: string, payload: BranchUpdatePayload) => Promise<boolean>;
  assignBranchOwner: (branchId: string, ownerUserId: string) => Promise<boolean>;
  createNotice: (branchId: string, payload: NoticeCreatePayload) => Promise<NoticeCreateResult>;
  updateNotice: (branchId: string, noticeId: string, payload: NoticeUpdatePayload) => Promise<NoticeDeleteResult>;
  createPromotion: (payload: { memberId: string; toBelt: string; examDate: string; note?: string }) => Promise<boolean>;
  updatePromotion: (
    promotionId: string,
    payload: { result: "passed" | "failed" | "cancelled"; score?: number; note?: string },
  ) => Promise<boolean>;
  deleteNotice: (branchId: string, noticeId: string) => Promise<NoticeDeleteResult>;
  createTournament: (payload: TournamentPayload) => Promise<boolean>;
  updateTournament: (tournamentId: string, payload: TournamentPayload) => Promise<boolean>;
  deleteTournament: (tournamentId: string) => Promise<boolean>;
  updatePilotReadiness: (payload: PilotReadinessUpdatePayload) => Promise<boolean>;
  createPilotIncident: (payload: PilotIncidentCreatePayload) => Promise<boolean>;
  updatePilotIncident: (incidentId: string, payload: PilotIncidentUpdatePayload) => Promise<boolean>;
  upsertPilotOperationLog: (payload: PilotOperationLogPayload) => Promise<boolean>;
};

const sessionKey = "final-judo-mvp-session";
const attendanceQueueKey = "final-judo-pending-attendance";
const publicAuthPathnames = new Set(["/signup", "/reset-password"]);

const AppStoreContext = createContext<AppStore | null>(null);

function canSkipBootstrapWithoutLocalSession(pathname: string) {
  // Login and role-switch entry points still try a silent cookie bootstrap so
  // an app restart with only the HttpOnly session cookie can show account switch UI.
  return publicAuthPathnames.has(pathname) || pathname.startsWith("/invite/");
}

function canRestoreCookieOnlySession(pathname: string) {
  return pathname === "/login" || pathname === "/select-role";
}

function getInitialState(): AppState {
  return {
    db: createMockData(),
    user: null,
    selectedBranchId: null,
    operationError: null,
    attendanceSync: {
      status: "idle",
      message: "아직 변경된 출석 기록이 없습니다.",
      updatedAt: null,
      pendingCount: 0,
      queue: [],
    },
    version: 0,
  };
}

function persistSession(session: PersistedSession | null) {
  if (!session) {
    window.localStorage.removeItem(sessionKey);
    return;
  }

  window.localStorage.setItem(sessionKey, JSON.stringify(session));
}

function isPendingAttendanceUpdate(value: unknown): value is PendingAttendanceUpdate {
  if (!value || typeof value !== "object") {
    return false;
  }

  const update = value as Partial<PendingAttendanceUpdate>;

  return (
    typeof update.id === "string" &&
    typeof update.sessionId === "string" &&
    typeof update.memberId === "string" &&
    typeof update.actorUserId === "string" &&
    typeof update.queuedAt === "string" &&
    ["present", "absent", "late", "excused"].includes(update.status ?? "") &&
    (typeof update.selectedBranchId === "string" || update.selectedBranchId === null)
  );
}

function readPendingAttendanceQueue(userId?: string) {
  const raw = window.localStorage.getItem(attendanceQueueKey);

  if (!raw) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw) as unknown;
    const queue = Array.isArray(parsed) ? parsed.filter(isPendingAttendanceUpdate) : [];

    return userId ? queue.filter((item) => item.actorUserId === userId) : queue;
  } catch {
    return [];
  }
}

function persistPendingAttendanceQueue(queue: PendingAttendanceUpdate[]) {
  if (queue.length === 0) {
    window.localStorage.removeItem(attendanceQueueKey);
    return;
  }

  window.localStorage.setItem(attendanceQueueKey, JSON.stringify(queue));
}

function toUserFacingErrorMessage(error: unknown, fallbackMessage: string) {
  if (error instanceof ApiClientError) {
    return error.message || fallbackMessage;
  }

  return fallbackMessage;
}

function createOperationError(error: unknown, fallbackMessage: string): OperationError {
  if (error instanceof ApiClientError) {
    const title =
      error.status === 401
        ? "로그인이 필요합니다"
        : error.status === 403
          ? "권한이 없습니다"
          : error.status === 409
            ? "최신 상태와 충돌했습니다"
            : error.status === 422
              ? "운영 정책을 확인해 주세요"
              : "요청을 처리하지 못했습니다";

    return {
      id: `operation-error-${Date.now()}`,
      title,
      message: toUserFacingErrorMessage(error, fallbackMessage),
      status: error.status,
      code: error.code,
      createdAt: new Date().toISOString(),
    };
  }

  return {
    id: `operation-error-${Date.now()}`,
    title: "요청을 처리하지 못했습니다",
    message: toUserFacingErrorMessage(error, fallbackMessage),
    createdAt: new Date().toISOString(),
  };
}

function upsertLocalAttendance(
  db: MockDatabase,
  sessionId: string,
  memberId: string,
  status: AttendanceStatus,
  note?: string | null,
): MockDatabase {
  const existing = db.attendance.find((record) => record.sessionId === sessionId && record.memberId === memberId);
  const cleanNote = note?.trim();
  const persistedNote = cleanNote || existing?.note;
  const confirmedAt = new Date().toISOString();

  if (existing) {
    return {
      ...db,
      attendance: db.attendance.map((record) =>
        record.id === existing.id ? { ...record, status, confirmedAt, note: persistedNote } : record,
      ),
    };
  }

  return {
    ...db,
    attendance: [
      ...db.attendance,
      {
        id: `att-${sessionId}-${memberId}`,
        sessionId,
        memberId,
        status,
        confirmedAt,
        note: persistedNote,
      },
    ],
  };
}

function reducer(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    case "bootstrap":
      return {
        ...state,
        db: action.payload.db,
        user: action.payload.user,
        selectedBranchId: action.payload.selectedBranchId,
        operationError: null,
        version: state.version + 1,
      };
    case "login":
      return {
        ...state,
        user: action.user,
        selectedBranchId: action.selectedBranchId,
        operationError: null,
      };
    case "logout":
      return {
        ...state,
        user: null,
        selectedBranchId: null,
        attendanceSync: {
          status: "idle",
          message: "아직 변경된 출석 기록이 없습니다.",
          updatedAt: null,
          pendingCount: 0,
          queue: [],
        },
      };
    case "selectBranch":
      return {
        ...state,
        selectedBranchId: action.branchId,
      };
    case "setOperationError":
      return {
        ...state,
        operationError: action.error,
        version: state.version + 1,
      };
    case "clearOperationError":
      return {
        ...state,
        operationError: null,
        version: state.version + 1,
      };
    case "restoreAttendanceQueue": {
      const restoredDb = action.queue.reduce(
        (nextDb, item) => upsertLocalAttendance(nextDb, item.sessionId, item.memberId, item.status, item.note),
        state.db,
      );

      return {
        ...state,
        db: restoredDb,
        attendanceSync: {
          status: "offline",
          message: `저장되지 않은 출석 ${action.queue.length}건을 복구했습니다.`,
          updatedAt: action.queue.at(-1)?.queuedAt ?? new Date().toISOString(),
          pendingCount: action.queue.length,
          queue: action.queue,
        },
        version: state.version + 1,
      };
    }
    case "serverSnapshot": {
      const nextQueue = action.clearAttendanceQueue ? [] : state.attendanceSync.queue;

      return {
        ...state,
        db: action.payload.db,
        user: action.payload.user,
        selectedBranchId: action.payload.selectedBranchId,
        operationError: null,
        attendanceSync: action.syncStatus
          ? {
              status: action.syncStatus,
              message: action.message ?? state.attendanceSync.message,
              updatedAt: new Date().toISOString(),
              pendingCount: action.pendingCount ?? nextQueue.length,
              queue: nextQueue,
            }
          : state.attendanceSync,
        version: state.version + 1,
      };
    }
    case "setAttendanceSync":
      return {
        ...state,
        attendanceSync: {
          ...state.attendanceSync,
          status: action.syncStatus,
          message: action.message,
          updatedAt: new Date().toISOString(),
          pendingCount: action.pendingCount ?? state.attendanceSync.queue.length,
        },
        version: state.version + 1,
      };
    case "markAttendance": {
      if (action.syncStatus === "conflict" || action.syncStatus === "failed") {
        return {
          ...state,
          attendanceSync: {
            ...state.attendanceSync,
            status: action.syncStatus,
            message: action.message,
            updatedAt: new Date().toISOString(),
            pendingCount: Math.max(action.pendingCount, state.attendanceSync.queue.length),
          },
          version: state.version + 1,
        };
      }

      const nextQueue = action.queuedUpdate
        ? [
            ...state.attendanceSync.queue.filter(
              (update) => update.sessionId !== action.sessionId || update.memberId !== action.memberId,
            ),
            action.queuedUpdate,
          ]
        : state.attendanceSync.queue;

      return {
        ...state,
        db: upsertLocalAttendance(state.db, action.sessionId, action.memberId, action.status, action.note),
        operationError: null,
        attendanceSync: {
          status: action.syncStatus,
          message: action.message,
          updatedAt: new Date().toISOString(),
          pendingCount: action.queuedUpdate ? nextQueue.length : action.pendingCount,
          queue: nextQueue,
        },
        version: state.version + 1,
      };
    }
    case "markAttendanceBatch": {
      if (action.syncStatus === "conflict" || action.syncStatus === "failed") {
        return {
          ...state,
          attendanceSync: {
            ...state.attendanceSync,
            status: action.syncStatus,
            message: action.message,
            updatedAt: new Date().toISOString(),
            pendingCount: Math.max(action.pendingCount, state.attendanceSync.queue.length),
          },
          version: state.version + 1,
        };
      }

      const queuedMemberIds = new Set(action.memberIds);
      const nextBatchQueue = action.queuedUpdates
        ? [
            ...state.attendanceSync.queue.filter(
              (update) => update.sessionId !== action.sessionId || !queuedMemberIds.has(update.memberId),
            ),
            ...action.queuedUpdates,
          ]
        : state.attendanceSync.queue;
      const nextBatchDb = action.memberIds.reduce(
        (nextDb, memberId) => upsertLocalAttendance(nextDb, action.sessionId, memberId, action.status, action.note),
        state.db,
      );

      return {
        ...state,
        db: nextBatchDb,
        operationError: null,
        attendanceSync: {
          status: action.syncStatus,
          message: action.message,
          updatedAt: new Date().toISOString(),
          pendingCount: action.queuedUpdates ? nextBatchQueue.length : action.pendingCount,
          queue: nextBatchQueue,
        },
        version: state.version + 1,
      };
    }
    default:
      return state;
  }
}

export function AppStoreProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, undefined, getInitialState);
  const [hydrated, setHydrated] = useState(false);
  const [authPending, setAuthPending] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const reportOperationError = useCallback((error: unknown, fallbackMessage: string) => {
    dispatch({ type: "setOperationError", error: createOperationError(error, fallbackMessage) });
  }, []);

  const clearOperationError = useCallback(() => {
    dispatch({ type: "clearOperationError" });
  }, []);

  useEffect(() => {
    let active = true;

    async function hydrateSession() {
      const raw = window.localStorage.getItem(sessionKey);

      if (!raw && canSkipBootstrapWithoutLocalSession(window.location.pathname)) {
        if (active) {
          setHydrated(true);
        }
        return;
      }

      try {
        const session = raw ? (JSON.parse(raw) as PersistedSession) : null;
        const payload =
          !raw && canRestoreCookieOnlySession(window.location.pathname)
            ? await apiClient.getOptionalBootstrap(null)
            : await apiClient.getBootstrap(session?.selectedBranchId ?? null);

        if (!payload) {
          return;
        }

        if (active) {
          dispatch({ type: "bootstrap", payload });
          const pendingAttendanceQueue = readPendingAttendanceQueue(payload.user.id);
          persistPendingAttendanceQueue(pendingAttendanceQueue);
          if (pendingAttendanceQueue.length > 0) {
            dispatch({ type: "restoreAttendanceQueue", queue: pendingAttendanceQueue });
          }
          persistSession({ userId: payload.user.id, selectedBranchId: payload.selectedBranchId });
        }
      } catch {
        persistSession(null);
      } finally {
        if (active) {
          setHydrated(true);
        }
      }
    }

    void hydrateSession();

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!hydrated) {
      return;
    }

    persistPendingAttendanceQueue(state.attendanceSync.queue);
  }, [hydrated, state.attendanceSync.queue]);

  const accessibleBranchIds = useMemo(() => {
    if (!state.user) {
      return [];
    }

    return getAccessibleBranchIds(state.user, state.db);
  }, [state.db, state.user]);

  const signIn = useCallback(
    async (payload: UserRole | LoginCredentials) => {
      setAuthPending(true);
      setAuthError(null);

      try {
        const nextPayload = await apiClient.signIn(payload);
        const pendingAttendanceQueue = readPendingAttendanceQueue(nextPayload.user.id);

        dispatch({ type: "bootstrap", payload: nextPayload });
        persistPendingAttendanceQueue(pendingAttendanceQueue);
        if (pendingAttendanceQueue.length > 0) {
          dispatch({ type: "restoreAttendanceQueue", queue: pendingAttendanceQueue });
        }
        persistSession({ userId: nextPayload.user.id, selectedBranchId: nextPayload.selectedBranchId });
        return true;
      } catch (error) {
        setAuthError(toUserFacingErrorMessage(error, "로그인 중 문제가 발생했습니다."));
        return false;
      } finally {
        setAuthPending(false);
      }
    },
    [],
  );

  const signOut = useCallback(() => {
    void apiClient.signOut().catch(() => undefined);
    persistSession(null);
    persistPendingAttendanceQueue([]);
    dispatch({ type: "logout" });
  }, []);

  const selectBranch = useCallback(
    (branchId: string | null) => {
      if (!state.user || (branchId && !accessibleBranchIds.includes(branchId))) {
        return;
      }

      dispatch({ type: "selectBranch", branchId });
      persistSession({ userId: state.user.id, selectedBranchId: branchId });
      void apiClient
        .getBootstrap(branchId)
        .then((payload) => {
          dispatch({ type: "serverSnapshot", payload });
          persistSession({ userId: payload.user.id, selectedBranchId: payload.selectedBranchId });
        })
        .catch((error) => reportOperationError(error, "지점 선택을 저장하지 못했습니다."));
    },
    [accessibleBranchIds, reportOperationError, state.user],
  );

  const markAttendance = useCallback(
    (sessionId: string, memberId: string, status: AttendanceStatus, note?: string) => {
      if (!state.user) {
        return;
      }

      const forcedConflict = window.localStorage.getItem("final-judo-force-conflict") === "1";
      const forcedOffline = window.localStorage.getItem("final-judo-force-offline") === "1";
      const offline = forcedOffline || !window.navigator.onLine;
      const syncStatus: SaveStatus = forcedConflict ? "conflict" : offline ? "offline" : "saved";
      const message = forcedConflict
        ? "다른 기기에서 먼저 수정된 출석 기록이 있어 저장하지 않았습니다."
        : offline
          ? "네트워크가 불안정해 이 기기에 저장했고 다시 저장을 기다리고 있습니다."
          : "출석 변경이 저장되었습니다.";

      if (forcedConflict || offline) {
        const queuedUpdate =
          offline && !forcedConflict
            ? {
                id: `attendance-queue-${Date.now()}-${sessionId}-${memberId}`,
                sessionId,
                memberId,
                status,
                note,
                actorUserId: state.user.id,
                queuedAt: new Date().toISOString(),
                selectedBranchId: state.selectedBranchId,
              }
            : undefined;

        dispatch({
          type: "markAttendance",
          sessionId,
          memberId,
          status,
          note,
          actorUserId: state.user.id,
          syncStatus,
          message,
          pendingCount: offline ? 1 : 0,
          queuedUpdate,
        });
        return;
      }

      dispatch({
        type: "setAttendanceSync",
        syncStatus: "saving",
        message: "출석 변경을 저장하고 있습니다.",
        pendingCount: 0,
      });
      void apiClient
        .updateAttendance(sessionId, memberId, status, state.selectedBranchId, note)
        .then((payload) => {
          dispatch({
            type: "serverSnapshot",
            payload,
            syncStatus: "saved",
            message,
            pendingCount: 0,
          });
        })
        .catch((error) => {
          reportOperationError(error, "출석 저장에 실패했습니다.");
          dispatch({
            type: "markAttendance",
            sessionId,
            memberId,
            status,
            note,
            actorUserId: state.user?.id ?? "",
            syncStatus: "failed",
            message: toUserFacingErrorMessage(error, "출석 저장에 실패했습니다."),
            pendingCount: 0,
          });
        });
    },
    [reportOperationError, state.selectedBranchId, state.user],
  );

  const markSessionAttendance = useCallback(
    (sessionId: string, memberIds: string[], status: AttendanceStatus, note?: string) => {
      if (!state.user || memberIds.length === 0) {
        return;
      }

      const actorUserId = state.user.id;
      const forcedConflict = window.localStorage.getItem("final-judo-force-conflict") === "1";
      const forcedOffline = window.localStorage.getItem("final-judo-force-offline") === "1";
      const offline = forcedOffline || !window.navigator.onLine;
      const syncStatus: SaveStatus = forcedConflict ? "conflict" : offline ? "offline" : "saved";
      const message = forcedConflict
        ? "다른 기기에서 먼저 수정된 출석 기록이 있어 일괄 저장하지 않았습니다."
        : offline
          ? `${memberIds.length}명의 출석을 이 기기에 저장했고 다시 저장을 기다리고 있습니다.`
          : `${memberIds.length}명의 출석을 저장했습니다.`;

      if (forcedConflict || offline) {
        const queuedAt = new Date().toISOString();
        const queuedUpdates =
          offline && !forcedConflict
            ? memberIds.map((memberId) => ({
                id: `attendance-queue-${Date.now()}-${sessionId}-${memberId}`,
                sessionId,
                memberId,
                status,
                note,
                actorUserId,
                queuedAt,
                selectedBranchId: state.selectedBranchId,
              }))
            : undefined;

        dispatch({
          type: "markAttendanceBatch",
          sessionId,
          memberIds,
          status,
          note,
          syncStatus,
          message,
          pendingCount: offline ? memberIds.length : 0,
          queuedUpdates,
        });
        return;
      }

      dispatch({
        type: "setAttendanceSync",
        syncStatus: "saving",
        message: `${memberIds.length}명의 출석을 저장하고 있습니다.`,
        pendingCount: 0,
      });
      void apiClient
        .updateAttendanceBatch(
          sessionId,
          memberIds.map((memberId) => ({ memberId, status, ...(note?.trim() ? { note: note.trim() } : {}) })),
          state.selectedBranchId,
          note,
        )
        .then((payload) => {
          dispatch({
            type: "serverSnapshot",
            payload,
            syncStatus: "saved",
            message,
            pendingCount: 0,
          });
        })
        .catch((error) => {
          reportOperationError(error, "출석 일괄 저장에 실패했습니다.");
          dispatch({
            type: "markAttendanceBatch",
            sessionId,
            memberIds,
            status,
            note,
            syncStatus: "failed",
            message: toUserFacingErrorMessage(error, "출석 일괄 저장에 실패했습니다."),
            pendingCount: 0,
          });
        });
    },
    [reportOperationError, state.selectedBranchId, state.user],
  );

  const syncPendingAttendance = useCallback(async () => {
    if (!state.user) {
      return false;
    }

    const queue = state.attendanceSync.queue;

    if (queue.length === 0) {
      return true;
    }

    const forcedOffline = window.localStorage.getItem("final-judo-force-offline") === "1";

    if (forcedOffline || !window.navigator.onLine) {
      dispatch({
        type: "setAttendanceSync",
        syncStatus: "offline",
        message: `네트워크가 아직 연결되지 않아 ${queue.length}건이 대기 중입니다.`,
        pendingCount: queue.length,
      });
      return false;
    }

    dispatch({
      type: "setAttendanceSync",
      syncStatus: "saving",
      message: `대기 출석 ${queue.length}건을 다시 저장하고 있습니다.`,
      pendingCount: queue.length,
    });

    try {
      let nextPayload: BootstrapPayload | null = null;

      for (const item of queue) {
        nextPayload = await apiClient.updateAttendance(
          item.sessionId,
          item.memberId,
          item.status,
          item.selectedBranchId ?? state.selectedBranchId,
          item.note,
        );
      }

      if (nextPayload) {
        dispatch({
          type: "serverSnapshot",
          payload: nextPayload,
          syncStatus: "saved",
          message: `대기 출석 ${queue.length}건을 다시 저장했습니다.`,
          pendingCount: 0,
          clearAttendanceQueue: true,
        });
      }

      return true;
    } catch (error) {
      reportOperationError(error, "대기 출석 다시 저장에 실패했습니다.");
      dispatch({
        type: "setAttendanceSync",
        syncStatus: "failed",
        message: toUserFacingErrorMessage(error, "대기 출석 다시 저장에 실패했습니다."),
        pendingCount: queue.length,
      });
      return false;
    }
  }, [reportOperationError, state.attendanceSync.queue, state.selectedBranchId, state.user]);

  const saveAttendanceReason = useCallback(
    async (sessionId: string, memberId: string, reason: string) => {
      if (!state.user || !reason.trim()) {
        return false;
      }

      try {
        const payload = await apiClient.updateAttendanceReason(sessionId, memberId, reason.trim(), state.selectedBranchId);

        dispatch({ type: "serverSnapshot", payload });
        return true;
      } catch (error) {
        reportOperationError(error, "출석 사유를 저장하지 못했습니다.");
        return false;
      }
    },
    [reportOperationError, state.selectedBranchId, state.user],
  );

  const markNoticeAsRead = useCallback(
    async (noticeId: string) => {
      if (!state.user) {
        return false;
      }

      try {
        const payload = await apiClient.markNoticeAsRead(noticeId, state.selectedBranchId);

        dispatch({ type: "serverSnapshot", payload });
        return true;
      } catch (error) {
        reportOperationError(error, "공지 읽음 상태를 저장하지 못했습니다.");
        return false;
      }
    },
    [reportOperationError, state.selectedBranchId, state.user],
  );

  const markNoticesAsRead = useCallback(
    async (noticeIds: string[]) => {
      if (!state.user || noticeIds.length === 0) {
        return false;
      }

      try {
        const payload = await apiClient.markNoticesAsRead(noticeIds, state.selectedBranchId);

        dispatch({ type: "serverSnapshot", payload });
        return true;
      } catch (error) {
        reportOperationError(error, "공지 일괄 읽음 상태를 저장하지 못했습니다.");
        return false;
      }
    },
    [reportOperationError, state.selectedBranchId, state.user],
  );

  const createMember = useCallback(
    (
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
    ) => {
      if (!state.user) {
        return;
      }

      void apiClient
        .createMember(branchId, payload, state.selectedBranchId)
        .then((nextPayload) => dispatch({ type: "serverSnapshot", payload: nextPayload }))
        .catch((error) => reportOperationError(error, "회원 정보를 저장하지 못했습니다."));
    },
    [reportOperationError, state.selectedBranchId, state.user],
  );

  const updateMemberStatus = useCallback(
    (memberId: string, status: MemberStatus) => {
      if (!state.user) {
        return;
      }

      void apiClient
        .updateMemberStatus(memberId, status, state.selectedBranchId)
        .then((payload) => dispatch({ type: "serverSnapshot", payload }))
        .catch((error) => reportOperationError(error, "회원 상태를 변경하지 못했습니다."));
    },
    [reportOperationError, state.selectedBranchId, state.user],
  );

  const updateMemberProfile = useCallback(
    async (memberId: string, payload: MemberUpdatePayload) => {
      if (!state.user) {
        return false;
      }

      try {
        const nextPayload = await apiClient.updateMember(memberId, payload, state.selectedBranchId);

        dispatch({ type: "serverSnapshot", payload: nextPayload });
        return true;
      } catch (error) {
        reportOperationError(error, "회원 기본 정보를 변경하지 못했습니다.");
        return false;
      }
    },
    [reportOperationError, state.selectedBranchId, state.user],
  );

  const createCounselingNote = useCallback(
    async (branchId: string, memberId: string, payload: CounselingNoteCreatePayload) => {
      if (!state.user) {
        return false;
      }

      try {
        const nextPayload = await apiClient.createCounselingNote(branchId, memberId, payload, state.selectedBranchId);

        dispatch({ type: "serverSnapshot", payload: nextPayload });
        return true;
      } catch (error) {
        reportOperationError(error, "상담/주의 메모를 작성하지 못했습니다.");
        return false;
      }
    },
    [reportOperationError, state.selectedBranchId, state.user],
  );

  const linkGuardian = useCallback(
    async (memberId: string, payload: GuardianLinkPayload) => {
      if (!state.user) {
        return false;
      }

      try {
        const nextPayload = await apiClient.linkGuardian(memberId, payload, state.selectedBranchId);

        dispatch({ type: "serverSnapshot", payload: nextPayload });
        return true;
      } catch (error) {
        reportOperationError(error, "보호자 연결을 저장하지 못했습니다.");
        return false;
      }
    },
    [reportOperationError, state.selectedBranchId, state.user],
  );

  const unlinkGuardian = useCallback(
    async (memberId: string, payload: GuardianLinkPayload) => {
      if (!state.user) {
        return false;
      }

      try {
        const nextPayload = await apiClient.unlinkGuardian(memberId, payload, state.selectedBranchId);

        dispatch({ type: "serverSnapshot", payload: nextPayload });
        return true;
      } catch (error) {
        reportOperationError(error, "보호자 연결을 해제하지 못했습니다.");
        return false;
      }
    },
    [reportOperationError, state.selectedBranchId, state.user],
  );

  const replaceGuardian = useCallback(
    async (memberId: string, payload: GuardianLinkPayload) => {
      if (!state.user) {
        return false;
      }

      try {
        const nextPayload = await apiClient.replaceGuardian(memberId, payload, state.selectedBranchId);

        dispatch({ type: "serverSnapshot", payload: nextPayload });
        return true;
      } catch (error) {
        reportOperationError(error, "보호자 연결을 변경하지 못했습니다.");
        return false;
      }
    },
    [reportOperationError, state.selectedBranchId, state.user],
  );

  const createClassSession = useCallback(
    (branchId: string, payload: ClassSessionCreatePayload) => {
      if (!state.user) {
        return;
      }

      void apiClient
        .createClassSession(branchId, payload, state.selectedBranchId)
        .then((nextPayload) => dispatch({ type: "serverSnapshot", payload: nextPayload }))
        .catch((error) => reportOperationError(error, "수업을 생성하지 못했습니다."));
    },
    [reportOperationError, state.selectedBranchId, state.user],
  );

  const updateClassSession = useCallback(
    (classId: string, payload: ClassSessionUpdatePayload) => {
      if (!state.user) {
        return;
      }

      void apiClient
        .updateClassSession(classId, payload, state.selectedBranchId)
        .then((nextPayload) => dispatch({ type: "serverSnapshot", payload: nextPayload }))
        .catch((error) => reportOperationError(error, "수업 정보를 수정하지 못했습니다."));
    },
    [reportOperationError, state.selectedBranchId, state.user],
  );

  const createPayment = useCallback(
    async (branchId: string, payload: PaymentCreatePayload, idempotencyKey?: string): Promise<PaymentCreateResult> => {
      if (!state.user) {
        return { ok: false, message: "로그인이 필요합니다." };
      }

      try {
        const nextPayload = await apiClient.createPayment(branchId, payload, state.selectedBranchId, idempotencyKey);

        dispatch({ type: "serverSnapshot", payload: nextPayload });
        return { ok: true, message: "수기 결제를 등록했습니다." };
      } catch (error) {
        reportOperationError(error, "결제 기록을 저장하지 못했습니다.");
        return {
          ok: false,
          message: error instanceof ApiClientError ? error.message : "수기 결제를 등록하지 못했습니다.",
        };
      }
    },
    [reportOperationError, state.selectedBranchId, state.user],
  );

  const updateManualPayment = useCallback(
    async (paymentId: string, payload: ManualPaymentUpdatePayload) => {
      if (!state.user) {
        return false;
      }

      try {
        const nextPayload = await apiClient.updateManualPayment(paymentId, payload, state.selectedBranchId);

        dispatch({ type: "serverSnapshot", payload: nextPayload });
        return true;
      } catch (error) {
        reportOperationError(error, "수기 결제 기록을 수정하지 못했습니다.");
        return false;
      }
    },
    [reportOperationError, state.selectedBranchId, state.user],
  );

  const deleteManualPayment = useCallback(
    async (paymentId: string, payload: PaymentDeletePayload) => {
      if (!state.user) {
        return false;
      }

      try {
        const nextPayload = await apiClient.deleteManualPayment(paymentId, payload, state.selectedBranchId);

        dispatch({ type: "serverSnapshot", payload: nextPayload });
        return true;
      } catch (error) {
        reportOperationError(error, "수기 결제 기록을 삭제하지 못했습니다.");
        return false;
      }
    },
    [reportOperationError, state.selectedBranchId, state.user],
  );

  const refundPayment = useCallback(
    async (paymentId: string, payload: PaymentRefundPayload) => {
      if (!state.user) {
        return false;
      }

      try {
        const nextPayload = await apiClient.refundPayment(paymentId, payload, state.selectedBranchId);

        dispatch({ type: "serverSnapshot", payload: nextPayload });
        return true;
      } catch (error) {
        reportOperationError(error, "환불/취소 처리를 저장하지 못했습니다.");
        return false;
      }
    },
    [reportOperationError, state.selectedBranchId, state.user],
  );

  const createOnlinePaymentCheckout = useCallback(
    async (paymentId: string) => {
      if (!state.user) {
        return false;
      }

      try {
        const nextPayload = await apiClient.createOnlinePaymentCheckout(paymentId, state.selectedBranchId);

        dispatch({ type: "serverSnapshot", payload: nextPayload });
        return true;
      } catch (error) {
        reportOperationError(error, "온라인 결제 요청을 생성하지 못했습니다.");
        return false;
      }
    },
    [reportOperationError, state.selectedBranchId, state.user],
  );

  const createRecurringAgreement = useCallback(
    async (paymentId: string, payload: RecurringAgreementPayload) => {
      if (!state.user) {
        return false;
      }

      try {
        const nextPayload = await apiClient.createRecurringAgreement(paymentId, payload, state.selectedBranchId);

        dispatch({ type: "serverSnapshot", payload: nextPayload });
        return true;
      } catch (error) {
        reportOperationError(error, "정기결제 약정을 생성하지 못했습니다.");
        return false;
      }
    },
    [reportOperationError, state.selectedBranchId, state.user],
  );

  const cancelRecurringAgreement = useCallback(
    async (paymentId: string, payload: RecurringAgreementPayload) => {
      if (!state.user) {
        return false;
      }

      try {
        const nextPayload = await apiClient.cancelRecurringAgreement(paymentId, payload, state.selectedBranchId);

        dispatch({ type: "serverSnapshot", payload: nextPayload });
        return true;
      } catch (error) {
        reportOperationError(error, "정기결제 약정을 해지하지 못했습니다.");
        return false;
      }
    },
    [reportOperationError, state.selectedBranchId, state.user],
  );

  const updateUserRole = useCallback(
    async (userId: string, role: UserRole, reason: string) => {
      if (!state.user) {
        return false;
      }

      try {
        const nextPayload = await apiClient.updateUserRole(userId, role, reason, state.selectedBranchId);

        dispatch({ type: "serverSnapshot", payload: nextPayload });
        return true;
      } catch (error) {
        reportOperationError(error, "권한 변경을 저장하지 못했습니다.");
        return false;
      }
    },
    [reportOperationError, state.selectedBranchId, state.user],
  );

  const updateUser = useCallback(
    async (userId: string, payload: AdminUserUpdatePayload) => {
      if (!state.user) {
        return false;
      }

      try {
        const nextPayload = await apiClient.updateUser(userId, payload, state.selectedBranchId);

        dispatch({ type: "serverSnapshot", payload: nextPayload });
        return true;
      } catch (error) {
        reportOperationError(error, "사용자 정보를 수정하지 못했습니다.");
        return false;
      }
    },
    [reportOperationError, state.selectedBranchId, state.user],
  );

  const deleteUser = useCallback(
    async (userId: string, payload: AdminUserDeletePayload) => {
      if (!state.user) {
        return false;
      }

      try {
        const nextPayload = await apiClient.deleteUser(userId, payload, state.selectedBranchId);

        dispatch({ type: "serverSnapshot", payload: nextPayload });
        return true;
      } catch (error) {
        reportOperationError(error, "사용자 계정을 삭제하지 못했습니다.");
        return false;
      }
    },
    [reportOperationError, state.selectedBranchId, state.user],
  );

  const createInvitation = useCallback(
    async (payload: InvitationCreatePayload) => {
      if (!state.user) {
        return null;
      }

      try {
        const nextPayload = await apiClient.createInvitation(payload, state.selectedBranchId);

        dispatch({ type: "serverSnapshot", payload: nextPayload });
        return nextPayload.invitation.path;
      } catch (error) {
        reportOperationError(error, "사용자 초대를 생성하지 못했습니다.");
        return null;
      }
    },
    [reportOperationError, state.selectedBranchId, state.user],
  );

  const reissueInvitationLink = useCallback(
    async (userId: string) => {
      if (!state.user) {
        return null;
      }

      try {
        const nextPayload = await apiClient.reissueInvitationLink(userId, state.selectedBranchId);

        dispatch({ type: "serverSnapshot", payload: nextPayload });
        return nextPayload.invitation.path;
      } catch (error) {
        reportOperationError(error, "초대 링크를 다시 만들지 못했습니다.");
        return null;
      }
    },
    [reportOperationError, state.selectedBranchId, state.user],
  );

  const approveInvitation = useCallback(
    async (userId: string) => {
      if (!state.user) {
        return null;
      }

      try {
        const nextPayload = await apiClient.approveInvitation(userId, state.selectedBranchId);

        dispatch({ type: "serverSnapshot", payload: nextPayload });
        return nextPayload.approval;
      } catch (error) {
        reportOperationError(error, "초대를 승인하지 못했습니다.");
        return null;
      }
    },
    [reportOperationError, state.selectedBranchId, state.user],
  );

  const resetUserPassword = useCallback(
    async (userId: string, payload: AdminPasswordResetPayload) => {
      if (!state.user) {
        return null;
      }

      try {
        const nextPayload = await apiClient.resetUserPassword(userId, payload, state.selectedBranchId);

        dispatch({ type: "serverSnapshot", payload: nextPayload });
        return nextPayload.password.temporaryPassword;
      } catch (error) {
        reportOperationError(error, "비밀번호를 재발급하지 못했습니다.");
        return null;
      }
    },
    [reportOperationError, state.selectedBranchId, state.user],
  );

  const acceptInvitation = useCallback(async (token: string, password: string): Promise<InvitationAcceptResult> => {
    try {
      const payload = await apiClient.acceptInvitation(token, password);

      dispatch({ type: "bootstrap", payload });
      persistSession({ userId: payload.user.id, selectedBranchId: payload.selectedBranchId });
      return { ok: true };
    } catch (error) {
      const message = toUserFacingErrorMessage(error, "초대 수락을 완료하지 못했습니다.");

      reportOperationError(error, "초대 수락을 완료하지 못했습니다.");
      return { ok: false, message };
    }
  }, [reportOperationError]);

  const createBranch = useCallback(
    async (payload: BranchCreatePayload) => {
      if (!state.user) {
        return false;
      }

      try {
        const nextPayload = await apiClient.createBranch(payload, state.selectedBranchId);

        dispatch({ type: "serverSnapshot", payload: nextPayload });
        return true;
      } catch (error) {
        reportOperationError(error, "지점을 생성하지 못했습니다.");
        return false;
      }
    },
    [reportOperationError, state.selectedBranchId, state.user],
  );

  const assignBranchOwner = useCallback(
    async (branchId: string, ownerUserId: string) => {
      if (!state.user) {
        return false;
      }

      try {
        const nextPayload = await apiClient.assignBranchOwner(branchId, ownerUserId, state.selectedBranchId);

        dispatch({ type: "serverSnapshot", payload: nextPayload });
        return true;
      } catch (error) {
        reportOperationError(error, "지점 대표를 배정하지 못했습니다.");
        return false;
      }
    },
    [reportOperationError, state.selectedBranchId, state.user],
  );

  const updateBranch = useCallback(
    async (branchId: string, payload: BranchUpdatePayload) => {
      if (!state.user) {
        return false;
      }

      try {
        const nextPayload = await apiClient.updateBranch(branchId, payload, state.selectedBranchId);

        dispatch({ type: "serverSnapshot", payload: nextPayload });
        return true;
      } catch (error) {
        reportOperationError(error, "지점 정보를 수정하지 못했습니다.");
        return false;
      }
    },
    [reportOperationError, state.selectedBranchId, state.user],
  );

  const createPromotion = useCallback(
    async (payload: { memberId: string; toBelt: string; examDate: string; note?: string }) => {
      if (!state.user) {
        return false;
      }

      try {
        const nextPayload = await apiClient.createPromotion(payload, state.selectedBranchId);

        dispatch({ type: "serverSnapshot", payload: nextPayload });
        return true;
      } catch (error) {
        reportOperationError(error, "승급 심사를 등록하지 못했습니다.");
        return false;
      }
    },
    [reportOperationError, state.selectedBranchId, state.user],
  );

  const createTournament = useCallback(
    async (payload: TournamentPayload) => {
      if (!state.user) {
        return false;
      }

      try {
        const nextPayload = await apiClient.createTournament(payload, state.selectedBranchId);

        dispatch({ type: "serverSnapshot", payload: nextPayload });
        return true;
      } catch (error) {
        reportOperationError(error, "대회 공지를 등록하지 못했습니다.");
        return false;
      }
    },
    [reportOperationError, state.selectedBranchId, state.user],
  );

  const updateTournament = useCallback(
    async (tournamentId: string, payload: TournamentPayload) => {
      if (!state.user) {
        return false;
      }

      try {
        const nextPayload = await apiClient.updateTournament(tournamentId, payload, state.selectedBranchId);

        dispatch({ type: "serverSnapshot", payload: nextPayload });
        return true;
      } catch (error) {
        reportOperationError(error, "대회 공지를 수정하지 못했습니다.");
        return false;
      }
    },
    [reportOperationError, state.selectedBranchId, state.user],
  );

  const deleteTournament = useCallback(
    async (tournamentId: string) => {
      if (!state.user) {
        return false;
      }

      try {
        const nextPayload = await apiClient.deleteTournament(tournamentId, state.selectedBranchId);

        dispatch({ type: "serverSnapshot", payload: nextPayload });
        return true;
      } catch (error) {
        reportOperationError(error, "대회 공지를 삭제하지 못했습니다.");
        return false;
      }
    },
    [reportOperationError, state.selectedBranchId, state.user],
  );

  const updatePromotion = useCallback(
    async (
      promotionId: string,
      payload: { result: "passed" | "failed" | "cancelled"; score?: number; note?: string },
    ) => {
      if (!state.user) {
        return false;
      }

      try {
        const nextPayload = await apiClient.updatePromotion(promotionId, payload, state.selectedBranchId);

        dispatch({ type: "serverSnapshot", payload: nextPayload });
        return true;
      } catch (error) {
        reportOperationError(error, "승급 심사 결과를 기록하지 못했습니다.");
        return false;
      }
    },
    [reportOperationError, state.selectedBranchId, state.user],
  );

  const createNotice = useCallback(
    async (branchId: string, payload: NoticeCreatePayload) => {
      if (!state.user) {
        return { ok: false, message: "로그인이 필요합니다." };
      }

      try {
        const nextPayload = await apiClient.createNotice(branchId, payload, state.selectedBranchId);

        dispatch({ type: "serverSnapshot", payload: nextPayload });
        return { ok: true, message: nextPayload.push.message };
      } catch (error) {
        reportOperationError(error, "공지를 발행하지 못했습니다.");
        return {
          ok: false,
          message: error instanceof ApiClientError ? error.message : "공지를 발행하지 못했습니다.",
        };
      }
    },
    [reportOperationError, state.selectedBranchId, state.user],
  );

  const updateNotice = useCallback(
    async (branchId: string, noticeId: string, payload: NoticeUpdatePayload) => {
      if (!state.user) {
        return { ok: false, message: "로그인이 필요합니다." };
      }

      try {
        const nextPayload = await apiClient.updateNotice(branchId, noticeId, payload, state.selectedBranchId);

        dispatch({ type: "serverSnapshot", payload: nextPayload });
        return { ok: true, message: "공지를 수정했습니다." };
      } catch (error) {
        reportOperationError(error, "공지를 수정하지 못했습니다.");
        return {
          ok: false,
          message: error instanceof ApiClientError ? error.message : "공지를 수정하지 못했습니다.",
        };
      }
    },
    [reportOperationError, state.selectedBranchId, state.user],
  );

  const deleteNotice = useCallback(
    async (branchId: string, noticeId: string) => {
      if (!state.user) {
        return { ok: false, message: "로그인이 필요합니다." };
      }

      try {
        const nextPayload = await apiClient.deleteNotice(branchId, noticeId, state.selectedBranchId);

        dispatch({ type: "serverSnapshot", payload: nextPayload });
        return { ok: true, message: "공지를 삭제했습니다." };
      } catch (error) {
        reportOperationError(error, "공지를 삭제하지 못했습니다.");
        return {
          ok: false,
          message: error instanceof ApiClientError ? error.message : "공지를 삭제하지 못했습니다.",
        };
      }
    },
    [reportOperationError, state.selectedBranchId, state.user],
  );

  const updatePilotReadiness = useCallback(
    async (payload: PilotReadinessUpdatePayload) => {
      if (!state.user) {
        return false;
      }

      try {
        const nextPayload = await apiClient.updatePilotReadiness(payload, state.selectedBranchId);

        dispatch({ type: "serverSnapshot", payload: nextPayload });
        return true;
      } catch (error) {
        reportOperationError(error, "운영 준비 상태를 저장하지 못했습니다.");
        return false;
      }
    },
    [reportOperationError, state.selectedBranchId, state.user],
  );

  const createPilotIncident = useCallback(
    async (payload: PilotIncidentCreatePayload) => {
      if (!state.user) {
        return false;
      }

      try {
        const nextPayload = await apiClient.createPilotIncident(payload, state.selectedBranchId);

        dispatch({ type: "serverSnapshot", payload: nextPayload });
        return true;
      } catch (error) {
        reportOperationError(error, "운영 이슈를 기록하지 못했습니다.");
        return false;
      }
    },
    [reportOperationError, state.selectedBranchId, state.user],
  );

  const updatePilotIncident = useCallback(
    async (incidentId: string, payload: PilotIncidentUpdatePayload) => {
      if (!state.user) {
        return false;
      }

      try {
        const nextPayload = await apiClient.updatePilotIncident(incidentId, payload, state.selectedBranchId);

        dispatch({ type: "serverSnapshot", payload: nextPayload });
        return true;
      } catch (error) {
        reportOperationError(error, "운영 이슈 상태를 변경하지 못했습니다.");
        return false;
      }
    },
    [reportOperationError, state.selectedBranchId, state.user],
  );

  const upsertPilotOperationLog = useCallback(
    async (payload: PilotOperationLogPayload) => {
      if (!state.user) {
        return false;
      }

      try {
        const nextPayload = await apiClient.upsertPilotOperationLog(payload, state.selectedBranchId);

        dispatch({ type: "serverSnapshot", payload: nextPayload });
        return true;
      } catch (error) {
        reportOperationError(error, "운영 기록을 저장하지 못했습니다.");
        return false;
      }
    },
    [reportOperationError, state.selectedBranchId, state.user],
  );

  const value = useMemo<AppStore>(
    () => ({
      ...state,
      hydrated,
      authPending,
      authError,
      accessibleBranchIds,
      signIn,
      signOut,
      clearOperationError,
      selectBranch,
      markAttendance,
      markSessionAttendance,
      saveAttendanceReason,
      syncPendingAttendance,
      markNoticeAsRead,
      markNoticesAsRead,
      createMember,
      updateMemberStatus,
      updateMemberProfile,
      createCounselingNote,
      linkGuardian,
      unlinkGuardian,
      replaceGuardian,
      createClassSession,
      updateClassSession,
      createPayment,
      updateManualPayment,
      deleteManualPayment,
      createOnlinePaymentCheckout,
      createRecurringAgreement,
      cancelRecurringAgreement,
      refundPayment,
      updateUserRole,
      updateUser,
      deleteUser,
      createInvitation,
      reissueInvitationLink,
      approveInvitation,
      resetUserPassword,
      acceptInvitation,
      createBranch,
      updateBranch,
      assignBranchOwner,
      createNotice,
      updateNotice,
      deleteNotice,
      createPromotion,
      updatePromotion,
      createTournament,
      updateTournament,
      deleteTournament,
      updatePilotReadiness,
      createPilotIncident,
      updatePilotIncident,
      upsertPilotOperationLog,
    }),
    [
      accessibleBranchIds,
      acceptInvitation,
      approveInvitation,
      assignBranchOwner,
      authError,
      authPending,
      clearOperationError,
      cancelRecurringAgreement,
      createBranch,
      createCounselingNote,
      createInvitation,
      reissueInvitationLink,
      createMember,
      createClassSession,
      createNotice,
      createOnlinePaymentCheckout,
      createPayment,
      deleteManualPayment,
      createPilotIncident,
      createPromotion,
      createRecurringAgreement,
      createTournament,
      deleteTournament,
      updateTournament,
      updateNotice,
      deleteNotice,
      deleteUser,
      hydrated,
      linkGuardian,
      unlinkGuardian,
      replaceGuardian,
      markAttendance,
      markSessionAttendance,
      saveAttendanceReason,
      markNoticeAsRead,
      markNoticesAsRead,
      resetUserPassword,
      refundPayment,
      selectBranch,
      signIn,
      signOut,
      state,
      syncPendingAttendance,
      updateClassSession,
      updateManualPayment,
      updateMemberProfile,
      updateMemberStatus,
      updateBranch,
      updatePilotIncident,
      updatePromotion,
      upsertPilotOperationLog,
      updatePilotReadiness,
      updateUser,
      updateUserRole,
    ],
  );

  return <AppStoreContext.Provider value={value}>{children}</AppStoreContext.Provider>;
}

export function useAppStore() {
  const context = useContext(AppStoreContext);

  if (!context) {
    throw new Error("useAppStore must be used within AppStoreProvider.");
  }

  return context;
}
