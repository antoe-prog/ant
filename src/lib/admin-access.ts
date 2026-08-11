import type { AppUser, UserRole } from "./domain.ts";

export type AdminAccessActor = Pick<AppUser, "adminScope" | "role">;
type BranchScopedAdminActor = Pick<AppUser, "adminScope" | "branchIds" | "role">;
type AdminManagedUser = Pick<AppUser, "adminScope" | "branchIds" | "role">;
type AdminAssignment = {
  adminScope: AppUser["adminScope"];
  branchIds: string[];
};

export function hasGlobalAdminDataAccess(user: AdminAccessActor) {
  return user.role === "admin" && user.adminScope !== "assigned_branches";
}

export function hasAdminAccessToBranchIds(
  actor: BranchScopedAdminActor,
  branchIds: readonly string[],
) {
  if (actor.role !== "admin") {
    return false;
  }

  if (hasGlobalAdminDataAccess(actor)) {
    return true;
  }

  return branchIds.length > 0 && branchIds.every((branchId) => actor.branchIds.includes(branchId));
}

export function canAdminManageUser(
  actor: BranchScopedAdminActor,
  target: AdminManagedUser,
) {
  if (!hasAdminAccessToBranchIds(actor, target.branchIds)) {
    return false;
  }

  return target.role !== "admin" || !hasGlobalAdminDataAccess(target) || hasGlobalAdminDataAccess(actor);
}

export function getAdminAssignment(
  actor: BranchScopedAdminActor,
  nextRole: UserRole,
  requestedBranchIds: readonly string[],
  allBranchIds: readonly string[],
): AdminAssignment {
  if (nextRole !== "admin") {
    return {
      adminScope: undefined,
      branchIds: [...requestedBranchIds],
    };
  }

  if (hasGlobalAdminDataAccess(actor)) {
    return {
      adminScope: "global" as const,
      branchIds: [...allBranchIds],
    };
  }

  const branchIds = requestedBranchIds.length > 0 ? [...requestedBranchIds] : [...actor.branchIds];
  return {
    adminScope: "assigned_branches" as const,
    branchIds,
  };
}
