import type { Branch } from "./domain.ts";

export function isPublicSignupBranch(branch: Pick<Branch, "dataMode" | "status">) {
  return branch.status !== "inactive" && branch.dataMode !== "demo";
}
