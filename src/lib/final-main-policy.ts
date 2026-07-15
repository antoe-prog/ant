import type { Branch } from "./domain";

const legacyFinalMainBranchIds = new Set(["branch-gangnam"]);

export function isFinalMainBranch(branch: Pick<Branch, "id" | "name"> | null | undefined): boolean {
  if (!branch) {
    return false;
  }

  return legacyFinalMainBranchIds.has(branch.id) || branch.name.includes("본관");
}
