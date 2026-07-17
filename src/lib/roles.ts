import type { UserRole } from "@/lib/domain";

export type AppRouteId =
  | "dashboard"
  | "classes"
  | "members"
  | "payments"
  | "promotions"
  | "tournaments"
  | "notices"
  | "account"
  | "ownerBranches"
  | "ownerReports"
  | "adminBranches"
  | "adminUsers"
  | "adminRoles"
  | "adminAuditLogs"
  | "adminSettings";
export type RbacRoleCode = "member" | "guardian" | "coach" | "branch_owner" | "super_admin";

export type AppRouteConfig = {
  id: AppRouteId;
  href: string;
  aliases?: string[];
  label: string;
  labelsByRole?: Partial<Record<UserRole, string>>;
  description: string;
  roles: UserRole[];
  showInNav?: boolean;
};

export const roleLabels: Record<UserRole, string> = {
  member: "회원",
  guardian: "학부모",
  coach: "코치",
  owner: "대표",
  admin: "총괄 어드민",
};

export const roleToRbacRole: Record<UserRole, RbacRoleCode> = {
  member: "member",
  guardian: "guardian",
  coach: "coach",
  owner: "branch_owner",
  admin: "super_admin",
};

export const rbacRoleToRole: Record<RbacRoleCode, UserRole> = {
  member: "member",
  guardian: "guardian",
  coach: "coach",
  branch_owner: "owner",
  super_admin: "admin",
};

export const rbacRoleLabels: Record<RbacRoleCode, string> = {
  member: "회원",
  guardian: "학부모",
  coach: "코치",
  branch_owner: "대표",
  super_admin: "총괄 어드민",
};

export const roleAccessDescriptions: Record<UserRole, string> = {
  admin: "전체 지점, 사용자, 권한, 운영 기준 관리",
  coach: "담당 수업, 출석, 상담 메모, 보호자 안내",
  guardian: "자녀 수업, 출석, 결제 상태, 공지 확인",
  member: "내 수업, 출석, 결제 상태, 공지 확인",
  owner: "담당 지점 운영 현황, 결제/공지/리포트 확인",
};

export const roleManagementScopeLabels: Record<UserRole, string> = {
  admin: "전체 지점/사용자",
  coach: "담당 수업/출석",
  guardian: "자녀 확인",
  member: "본인 정보",
  owner: "담당 지점 운영",
};

export const appRoutes: AppRouteConfig[] = [
  {
    id: "dashboard",
    href: "/app/dashboard",
    label: "대시보드",
    labelsByRole: {
      coach: "홈",
      guardian: "홈",
      member: "홈",
    },
    description: "오늘 확인할 주요 정보",
    roles: ["member", "guardian", "coach", "owner", "admin"],
  },
  {
    id: "classes",
    href: "/app/classes",
    label: "수업/출석",
    labelsByRole: {
      guardian: "수업",
      member: "수업",
    },
    description: "오늘 수업, 명단, 출석 체크",
    roles: ["member", "guardian", "coach", "owner", "admin"],
  },
  {
    id: "members",
    href: "/app/members",
    label: "회원",
    labelsByRole: {
      guardian: "자녀",
      member: "내 정보",
    },
    description: "회원/자녀/담당 수련자 정보",
    roles: ["member", "guardian", "coach", "owner", "admin"],
  },
  {
    id: "payments",
    href: "/app/payments",
    label: "결제",
    description: "회원권, 미납, 만료 예정",
    roles: ["member", "guardian", "owner", "admin"],
  },
  {
    id: "promotions",
    href: "/app/promotions",
    label: "승급 심사",
    labelsByRole: {
      guardian: "승급",
      member: "승급",
    },
    description: "승급 심사 일정, 결과, 띠 이력",
    roles: ["member", "guardian", "coach", "owner", "admin"],
  },
  {
    id: "tournaments",
    href: "/app/tournaments",
    label: "대회",
    description: "대한유도회 등 외부 단체 대회 공지",
    roles: ["member", "guardian", "coach", "owner", "admin"],
  },
  {
    id: "notices",
    href: "/app/notices",
    aliases: ["/app/notifications"],
    label: "공지",
    description: "공지 목록과 읽음 상태",
    roles: ["member", "guardian", "coach", "owner", "admin"],
  },
  {
    id: "account",
    href: "/app/account",
    label: "내 계정",
    description: "내 계정과 이용 지점",
    roles: ["member", "guardian", "coach", "owner", "admin"],
    showInNav: false,
  },
  {
    id: "ownerBranches",
    href: "/app/owner/branches",
    label: "내 지점",
    description: "대표 지점 운영 상태",
    roles: ["owner"],
  },
  {
    id: "ownerReports",
    href: "/app/owner/reports",
    label: "리포트",
    description: "지점별 운영 리포트",
    roles: ["owner"],
  },
  {
    id: "adminBranches",
    href: "/app/admin/branches",
    label: "지점",
    description: "전체 지점 관리",
    roles: ["admin"],
  },
  {
    id: "adminUsers",
    href: "/app/admin/users",
    label: "사용자",
    description: "전체 사용자 관리",
    roles: ["admin"],
  },
  {
    id: "adminRoles",
    href: "/app/admin/roles",
    label: "권한",
    description: "총괄 권한 관리",
    roles: ["admin"],
  },
  {
    id: "adminAuditLogs",
    href: "/app/admin/audit-logs",
    label: "변경 기록",
    description: "운영 변경 기록 조회",
    roles: ["admin"],
  },
  {
    id: "adminSettings",
    href: "/app/admin/settings",
    label: "설정",
    description: "기본 설정",
    roles: ["admin"],
  },
];

export function getVisibleRoutes(role: UserRole) {
  return appRoutes.filter((route) => route.roles.includes(role) && route.showInNav !== false);
}

const mobileNavRouteIdsByRole: Record<UserRole, AppRouteId[]> = {
  admin: ["dashboard", "adminBranches", "adminUsers", "notices", "adminSettings"],
  coach: ["dashboard", "classes", "members", "promotions", "notices"],
  // 회원/학부모 하단 내비의 알림은 헤더 종 아이콘과 중복이라 대회 메뉴로 대체한다.
  guardian: ["dashboard", "classes", "members", "payments", "tournaments"],
  member: ["dashboard", "classes", "members", "payments", "tournaments"],
  owner: ["dashboard", "members", "payments", "notices", "ownerReports"],
};

const mobileSecondaryRouteIdsByRole: Record<UserRole, AppRouteId[]> = {
  admin: ["members", "adminRoles", "adminAuditLogs"],
  coach: ["tournaments"],
  guardian: ["promotions"],
  member: ["promotions"],
  owner: ["classes", "promotions", "tournaments", "ownerBranches"],
};

export function getMobileVisibleRoutes(role: UserRole, pathname?: string) {
  void pathname;
  const visibleRoutesById = new Map(getVisibleRoutes(role).map((route) => [route.id, route]));

  return mobileNavRouteIdsByRole[role].flatMap((routeId) => {
    const route = visibleRoutesById.get(routeId);
    return route ? [route] : [];
  });
}

export function getMobileSecondaryRoutes(role: UserRole) {
  const visibleRoutesById = new Map(getVisibleRoutes(role).map((route) => [route.id, route]));

  return mobileSecondaryRouteIdsByRole[role].flatMap((routeId) => {
    const route = visibleRoutesById.get(routeId);
    return route ? [route] : [];
  });
}

export function getRouteLabel(route: AppRouteConfig, role: UserRole) {
  return route.labelsByRole?.[role] ?? route.label;
}

export function getRouteByPath(pathname: string) {
  return appRoutes.find((route) =>
    [route.href, ...(route.aliases ?? [])].some((href) => pathname === href || pathname.startsWith(`${href}/`)),
  );
}

export function isRouteActive(route: AppRouteConfig, pathname: string) {
  return [route.href, ...(route.aliases ?? [])].some((href) => pathname === href || pathname.startsWith(`${href}/`));
}

export function canAccessPath(role: UserRole, pathname: string) {
  const route = getRouteByPath(pathname);
  return route ? route.roles.includes(role) : true;
}

export function getDefaultRoute(role: UserRole) {
  return getVisibleRoutes(role)[0]?.href ?? "/app/dashboard";
}

export function getRbacRole(role: UserRole) {
  return roleToRbacRole[role];
}

export function getUiRole(role: RbacRoleCode) {
  return rbacRoleToRole[role];
}

export const memberStatusLabels = {
  active: "활성",
  trial: "체험중",
  paused: "휴회",
  withdrawn: "퇴회",
} as const;

export const attendanceStatusLabels = {
  present: "출석",
  absent: "결석",
  late: "지각",
  excused: "사유 있음",
} as const;

export const paymentStatusLabels = {
  paid: "완료",
  scheduled: "예정",
  overdue: "미납",
  cancelled: "취소",
  refunded: "환불",
  partially_refunded: "부분 환불",
  expiringSoon: "만료 예정",
} as const;
