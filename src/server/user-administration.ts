import type { AppUser } from "@/lib/domain";

export const userAdministrationLockKey = "user-administration";

export function isActiveAdmin(user: AppUser) {
  return user.role === "admin" && user.invitationStatus !== "pending";
}

export function isAcceptedBranchOwner(user: AppUser, branchId: string) {
  return user.role === "owner" && user.invitationStatus !== "pending" && user.branchIds.includes(branchId);
}
