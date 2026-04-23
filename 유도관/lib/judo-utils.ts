// ─── 타입 정의 ────────────────────────────────────────────────────────────────
export type UserRole = "member" | "manager" | "admin";
export type BeltRank = "white" | "yellow" | "orange" | "green" | "blue" | "brown" | "black";
export type MemberStatus = "active" | "suspended" | "withdrawn";
export type AttendanceType = "regular" | "makeup" | "trial";
export type PaymentMethod = "cash" | "card" | "transfer";

// ─── 띠 등급 ──────────────────────────────────────────────────────────────────
export const BELT_COLORS: Record<BeltRank, string> = {
  white:  "#FFFFFF",
  yellow: "#FFD700",
  orange: "#FF8C00",
  green:  "#228B22",
  blue:   "#1565C0",
  brown:  "#6D4C41",
  black:  "#212121",
};

export const BELT_BORDER_COLORS: Record<BeltRank, string> = {
  white:  "#BDBDBD",
  yellow: "#F9A825",
  orange: "#E65100",
  green:  "#1B5E20",
  blue:   "#0D47A1",
  brown:  "#4E342E",
  black:  "#000000",
};

export const BELT_TEXT_COLORS: Record<BeltRank, string> = {
  white:  "#212121",
  yellow: "#212121",
  orange: "#FFFFFF",
  green:  "#FFFFFF",
  blue:   "#FFFFFF",
  brown:  "#FFFFFF",
  black:  "#FFFFFF",
};

export function getBeltColor(rank: BeltRank): string {
  return BELT_COLORS[rank] ?? "#FFFFFF";
}

export function getBeltLabel(rank: BeltRank): string {
  const labels: Record<BeltRank, string> = {
    white:  "흰띠",
    yellow: "노란띠",
    orange: "주황띠",
    green:  "초록띠",
    blue:   "파란띠",
    brown:  "갈색띠",
    black:  "검은띠",
  };
  return labels[rank] ?? rank;
}

export function getBeltOrder(rank: BeltRank): number {
  const order: Record<BeltRank, number> = {
    white: 0, yellow: 1, orange: 2, green: 3, blue: 4, brown: 5, black: 6,
  };
  return order[rank] ?? 0;
}

/** 전화 등 검색용: 숫자만 남김 */
export function digitsOnly(s: string): string {
  return s.replace(/\D/g, "");
}

// ─── 회원 상태 ────────────────────────────────────────────────────────────────
export function getMemberStatusLabel(status: MemberStatus): string {
  const labels: Record<MemberStatus, string> = {
    active:    "활성",
    suspended: "휴회",
    withdrawn: "탈퇴",
  };
  return labels[status] ?? status;
}

export function getMemberStatusColor(status: MemberStatus): string {
  const colors: Record<MemberStatus, string> = {
    active:    "#2DA44E",
    suspended: "#F4A261",
    withdrawn: "#CF222E",
  };
  return colors[status] ?? "#8B949E";
}

// ─── 출석 유형 ────────────────────────────────────────────────────────────────
export function getAttendanceTypeLabel(type: AttendanceType): string {
  const labels: Record<AttendanceType, string> = {
    regular: "정규",
    makeup:  "보강",
    trial:   "체험",
  };
  return labels[type] ?? type;
}

export type CheckResult = "present" | "late" | "absent";

export function getCheckResultLabel(result: CheckResult): string {
  const labels: Record<CheckResult, string> = {
    present: "정시",
    late: "지각",
    absent: "결석",
  };
  return labels[result] ?? result;
}

export type PromotionResult = "pending" | "passed" | "failed";

export function getPromotionResultLabel(result: PromotionResult): string {
  const labels: Record<PromotionResult, string> = {
    pending: "대기",
    passed: "합격",
    failed: "불합격",
  };
  return labels[result] ?? result;
}

/** 상단 고정이 오늘(YYYY-MM-DD) 기준으로 유효한지 — 만료일이 지나면 목록에서 고정으로 취급하지 않음 */
export function isAnnouncementPinnedEffective(
  isPinned: boolean,
  pinnedUntil: string | null | undefined,
  todayYmd: string
): boolean {
  if (!isPinned) return false;
  if (pinnedUntil == null || pinnedUntil === "") return true;
  return pinnedUntil >= todayYmd;
}

/** 활성(또는 전체) 대비 참여 비율, 0~100 정수 */
export function calcParticipationRate(part: number, total: number): number {
  if (total <= 0 || !Number.isFinite(part)) return 0;
  return Math.min(100, Math.max(0, Math.round((part / total) * 100)));
}

// ─── 납부 방법 ────────────────────────────────────────────────────────────────
export function getPaymentMethodLabel(method: PaymentMethod): string {
  const labels: Record<PaymentMethod, string> = {
    cash:     "현금",
    card:     "카드",
    transfer: "계좌이체",
  };
  return labels[method] ?? method;
}

// ─── 역할 ─────────────────────────────────────────────────────────────────────
export function getRoleLabel(role: UserRole): string {
  const labels: Record<UserRole, string> = {
    member:  "회원",
    manager: "관리자",
    admin:   "원장",
  };
  return labels[role] ?? role;
}

// ─── 날짜 포맷 ────────────────────────────────────────────────────────────────
export function formatDate(date: Date | string | null | undefined): string {
  if (!date) return "-";
  const d = typeof date === "string" ? new Date(date) : date;
  if (isNaN(d.getTime())) return "-";
  return d.toLocaleDateString("ko-KR", { year: "numeric", month: "2-digit", day: "2-digit" });
}

export function formatDateShort(date: Date | string | null | undefined): string {
  if (!date) return "-";
  const d = typeof date === "string" ? new Date(date) : date;
  if (isNaN(d.getTime())) return "-";
  return d.toLocaleDateString("ko-KR", { month: "2-digit", day: "2-digit" });
}

export function formatAmount(amount: number): string {
  return amount.toLocaleString("ko-KR") + "원";
}

export function formatDateTime(date: Date | string | null | undefined): string {
  if (!date) return "-";
  const d = typeof date === "string" ? new Date(date) : date;
  if (isNaN(d.getTime())) return "-";
  return d.toLocaleDateString("ko-KR", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

export function getInitials(name: string | null | undefined): string {
  if (!name) return "?";
  return name.slice(0, 2);
}

export function getDaysUntil(date: Date | string | null | undefined): number | null {
  if (!date) return null;
  // YYYY-MM-DD 문자열은 로컬 자정으로 파싱 (UTC 자정 방지)
  let d: Date;
  if (typeof date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(date)) {
    const [y, m, day] = date.split("-").map(Number);
    d = new Date(y, m - 1, day, 0, 0, 0, 0);
  } else {
    d = typeof date === "string" ? new Date(date) : date;
  }
  if (isNaN(d.getTime())) return null;
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const diff = d.getTime() - now.getTime();
  return Math.ceil(diff / (1000 * 60 * 60 * 24));
}

export function getAge(birthDate: Date | string | null | undefined): number | null {
  if (!birthDate) return null;
  const d = typeof birthDate === "string" ? new Date(birthDate) : birthDate;
  if (isNaN(d.getTime())) return null;
  const now = new Date();
  let age = now.getFullYear() - d.getFullYear();
  const m = now.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < d.getDate())) age--;
  return age;
}

// ─── 출석률 계산 ──────────────────────────────────────────────────────────────
export function calcAttendanceRate(attended: number, total: number): number {
  if (total === 0) return 0;
  return Math.round((attended / total) * 100);
}

function formatLocalYmd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * `nextPaymentDate`가 비어 있을 때 월회비 다음 청구일을 추정합니다.
 * 우선순위: DB `nextPaymentDate` → 최근 납부 `periodEnd` 이후 → 최근 `paidAt` +1개월 → 입관일 기준 매월 같은 일.
 */
export function suggestNextPaymentDate(input: {
  joinDate: string;
  nextPaymentDate: string | null | undefined;
  lastPaidAt?: Date | string | null;
  lastPeriodEnd?: string | null;
}): string | null {
  if (input.nextPaymentDate) return input.nextPaymentDate;
  if (input.lastPeriodEnd) {
    const d = new Date(input.lastPeriodEnd + "T12:00:00");
    if (!Number.isNaN(d.getTime())) {
      const n = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1);
      const endOfNextMonth = new Date(n.getFullYear(), n.getMonth() + 2, 0);
      return formatLocalYmd(endOfNextMonth);
    }
  }
  if (input.lastPaidAt) {
    const d = new Date(input.lastPaidAt);
    if (!Number.isNaN(d.getTime())) {
      const n = new Date(d.getFullYear(), d.getMonth() + 1, d.getDate());
      return formatLocalYmd(n);
    }
  }
  const join = new Date(input.joinDate + "T12:00:00");
  if (Number.isNaN(join.getTime())) return null;
  const day = join.getDate();
  const now = new Date();
  let y = now.getFullYear();
  let mo = now.getMonth();
  const lastDom = (yy: number, mm: number) => new Date(yy, mm + 1, 0).getDate();
  let dom = Math.min(day, lastDom(y, mo));
  let candidate = new Date(y, mo, dom);
  if (candidate <= now) {
    mo += 1;
    if (mo > 11) {
      mo = 0;
      y += 1;
    }
    dom = Math.min(day, lastDom(y, mo));
    candidate = new Date(y, mo, dom);
  }
  return formatLocalYmd(candidate);
}

// ─── 이번 달 날짜 범위 ────────────────────────────────────────────────────────
export function getCurrentMonthRange(): { start: string; end: string } {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  return {
    start: formatLocalYmd(start),
    end: formatLocalYmd(end),
  };
}

export function getTodayString(): string {
  return new Date().toISOString().split("T")[0];
}
