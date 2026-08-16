import type { UserRole } from "../lib/domain.ts";

export const demoAccessBranchId = "branch-demo-gangseo-central";

export const demoAccessUserIds = {
  admin: "user-demo-gangseo-admin",
  coach: "user-demo-gangseo-coach",
  guardian: "user-demo-gangseo-guardian",
  member: "user-demo-gangseo-member",
  owner: "user-demo-gangseo-owner",
} as const satisfies Record<UserRole, string>;

export const demoAccessPhones = {
  admin: "01000009105",
  coach: "01000009103",
  guardian: "01000009102",
  member: "01000009101",
  owner: "01000009104",
} as const satisfies Record<UserRole, string>;

export const demoAccessMemberIds = {
  adult: "member-demo-gangseo-adult",
  child: "member-demo-gangseo-child",
  guardian: "member-demo-gangseo-guardian",
} as const;
