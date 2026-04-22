// Shared utility functions for the OnboardPro app

export type UserRole = "employee" | "hr" | "manager" | "admin";
export type TaskStatus = "pending" | "in_progress" | "completed" | "skipped";
export type TaskCategory = "document" | "training" | "setup" | "meeting" | "other";
export type TaskPriority = "low" | "medium" | "high";
export type DocumentStatus = "pending" | "under_review" | "approved" | "rejected";
export type ApprovalStatus = "pending" | "approved" | "rejected" | "cancelled";
export type PlanStatus = "not_started" | "in_progress" | "completed" | "on_hold";
export type TrainingStatus = "scheduled" | "completed" | "cancelled" | "rescheduled";

export function getStatusColor(status: TaskStatus | DocumentStatus | ApprovalStatus | PlanStatus | TrainingStatus | string): string {
  switch (status) {
    case "completed":
    case "approved":
      return "#10B981";
    case "in_progress":
    case "under_review":
    case "scheduled":
      return "#F59E0B";
    case "pending":
    case "not_started":
      return "#6B7280";
    case "rejected":
    case "cancelled":
      return "#EF4444";
    case "on_hold":
    case "rescheduled":
      return "#8B5CF6";
    default:
      return "#6B7280";
  }
}

export function getStatusLabel(status: string): string {
  const labels: Record<string, string> = {
    pending: "대기중",
    in_progress: "진행중",
    completed: "완료",
    skipped: "건너뜀",
    not_started: "시작 전",
    on_hold: "보류",
    under_review: "검토중",
    approved: "승인",
    rejected: "반려",
    cancelled: "취소",
    scheduled: "예정",
    rescheduled: "일정변경",
  };
  return labels[status] ?? status;
}

export function getCategoryLabel(category: TaskCategory): string {
  const labels: Record<TaskCategory, string> = {
    document: "서류",
    training: "교육",
    setup: "환경설정",
    meeting: "미팅",
    other: "기타",
  };
  return labels[category];
}

export function getCategoryIcon(category: TaskCategory): string {
  const icons: Record<TaskCategory, string> = {
    document: "doc.fill",
    training: "graduationcap.fill",
    setup: "gearshape.fill",
    meeting: "person.2.fill",
    other: "list.bullet",
  };
  return icons[category];
}

export function getPriorityLabel(priority: TaskPriority): string {
  const labels: Record<TaskPriority, string> = {
    low: "낮음",
    medium: "보통",
    high: "높음",
  };
  return labels[priority];
}

export function getPriorityColor(priority: TaskPriority): string {
  const colors: Record<TaskPriority, string> = {
    low: "#10B981",
    medium: "#F59E0B",
    high: "#EF4444",
  };
  return colors[priority];
}

export function getRoleLabel(role: UserRole): string {
  const labels: Record<UserRole, string> = {
    employee: "신규 입사자",
    hr: "HR 담당자",
    manager: "관리자",
    admin: "시스템 관리자",
  };
  return labels[role];
}

export function formatDate(date: Date | string | null | undefined): string {
  if (!date) return "-";
  const d = typeof date === "string" ? new Date(date) : date;
  return d.toLocaleDateString("ko-KR", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

export function formatDateTime(date: Date | string | null | undefined): string {
  if (!date) return "-";
  const d = typeof date === "string" ? new Date(date) : date;
  return d.toLocaleDateString("ko-KR", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes}분`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m > 0 ? `${h}시간 ${m}분` : `${h}시간`;
}

export function getDaysUntil(date: Date | string | null | undefined): number | null {
  if (!date) return null;
  const d = typeof date === "string" ? new Date(date) : date;
  const now = new Date();
  const diff = d.getTime() - now.getTime();
  return Math.ceil(diff / (1000 * 60 * 60 * 24));
}

export function getInitials(name: string | null | undefined): string {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0]?.slice(0, 2).toUpperCase() ?? "?";
  return (parts[0]?.[0] ?? "") + (parts[parts.length - 1]?.[0] ?? "");
}
