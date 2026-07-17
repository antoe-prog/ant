import type { AppUser, MockDatabase } from "./domain.ts";
import { formatCurrency } from "./format.ts";
import { canReadNotice, getAccessibleBranchIds, getAccessibleMemberIds } from "./mock-api.ts";
import { matchesMemberSearch } from "./notice-member-search.ts";
import { getRouteLabel, getVisibleRoutes, paymentStatusLabels } from "./roles.ts";

export type GlobalSearchKind = "menu" | "user" | "member" | "payment" | "notice";

export type GlobalSearchResult = {
  description: string;
  href: string;
  id: string;
  kind: GlobalSearchKind;
  title: string;
};

type GlobalSearchInput = {
  db: MockDatabase;
  query: string;
  selectedBranchId: string | null;
  user: AppUser;
};

const resultLimits: Record<GlobalSearchKind, number> = {
  menu: 6,
  user: 4,
  member: 5,
  payment: 4,
  notice: 4,
};

function appendQuery(pathname: string, query: Record<string, string>) {
  const searchParams = new URLSearchParams(query);

  return `${pathname}?${searchParams.toString()}`;
}

function takeResults(results: GlobalSearchResult[], kind: GlobalSearchKind) {
  return results.slice(0, resultLimits[kind]);
}

export function buildGlobalSearchResults({ db, query, selectedBranchId, user }: GlobalSearchInput) {
  const keyword = query.trim();
  const visibleRoutes = getVisibleRoutes(user.role);
  const visibleRouteIds = new Set(visibleRoutes.map((route) => route.id));
  const accessibleBranchIds = getAccessibleBranchIds(user, db);
  const scopedBranchIds =
    selectedBranchId && accessibleBranchIds.includes(selectedBranchId) ? [selectedBranchId] : accessibleBranchIds;
  const scopedBranchIdSet = new Set(scopedBranchIds);
  const accessibleMemberIdSet = new Set(getAccessibleMemberIds(user, db, scopedBranchIds));
  const branchesById = new Map(db.branches.map((branch) => [branch.id, branch]));
  const membersById = new Map(db.members.map((member) => [member.id, member]));
  const usersById = new Map(db.users.map((candidate) => [candidate.id, candidate]));

  const menuResults = takeResults(
    visibleRoutes
      .filter((route) =>
        keyword ? matchesMemberSearch(keyword, [getRouteLabel(route, user.role), route.description]) : true,
      )
      .map((route) => ({
        description: route.description,
        href: route.href,
        id: `menu-${route.id}`,
        kind: "menu" as const,
        title: getRouteLabel(route, user.role),
      })),
    "menu",
  );

  if (!keyword) {
    return menuResults;
  }

  const userResults = visibleRouteIds.has("adminUsers")
    ? takeResults(
        db.users
          .filter(
            (candidate) =>
              !selectedBranchId || candidate.role === "admin" || candidate.branchIds.includes(selectedBranchId),
          )
          .filter((candidate) =>
            matchesMemberSearch(keyword, [
              candidate.name,
              candidate.phone,
              candidate.email,
              candidate.title,
              candidate.role,
              ...candidate.branchIds.map((branchId) => branchesById.get(branchId)?.name),
            ]),
          )
          .sort((left, right) => left.name.localeCompare(right.name, "ko"))
          .map((candidate) => ({
            description: `${candidate.title} · ${
              candidate.role === "admin"
                ? "전체 지점"
                : candidate.branchIds.map((branchId) => branchesById.get(branchId)?.name).filter(Boolean).join(", ") ||
                  "지점 미지정"
            }`,
            href: appendQuery("/app/admin/users", { q: candidate.name }),
            id: `user-${candidate.id}`,
            kind: "user" as const,
            title: candidate.name,
          })),
        "user",
      )
    : [];

  const memberResults = visibleRouteIds.has("members")
    ? takeResults(
        db.members
          .filter((member) => scopedBranchIdSet.has(member.branchId) && accessibleMemberIdSet.has(member.id))
          .filter((member) => {
            const guardianDetails = member.guardianIds.flatMap((guardianId) => {
              const guardian = usersById.get(guardianId);

              if (!guardian) {
                return [];
              }

              return user.role === "member" || user.role === "guardian"
                ? [guardian.name]
                : [guardian.name, guardian.phone, guardian.email];
            });

            return matchesMemberSearch(keyword, [
              member.name,
              member.emergencyContact,
              member.level,
              member.belt,
              branchesById.get(member.branchId)?.name,
              ...guardianDetails,
            ]);
          })
          .sort((left, right) => left.name.localeCompare(right.name, "ko"))
          .map((member) => ({
            description: `${branchesById.get(member.branchId)?.name ?? "지점 미지정"} · ${member.belt} · ${member.level}`,
            href: appendQuery("/app/members", { q: member.name, memberId: member.id }),
            id: `member-${member.id}`,
            kind: "member" as const,
            title: member.name,
          })),
        "member",
      )
    : [];

  const paymentResults = visibleRouteIds.has("payments")
    ? takeResults(
        db.payments
          .filter((payment) => scopedBranchIdSet.has(payment.branchId) && accessibleMemberIdSet.has(payment.memberId))
          .sort((left, right) => right.dueDate.localeCompare(left.dueDate))
          .flatMap((payment) => {
            const member = membersById.get(payment.memberId);
            const branch = branchesById.get(payment.branchId);

            if (
              !member ||
              !matchesMemberSearch(keyword, [
                member.name,
                member.emergencyContact,
                payment.planName,
                paymentStatusLabels[payment.status],
                branch?.name,
              ])
            ) {
              return [];
            }

            return [
              {
                description: `${branch?.name ?? "지점 미지정"} · ${paymentStatusLabels[payment.status]} · ${formatCurrency(
                  Math.max(payment.amount - (payment.discountAmount ?? 0), 0),
                )}`,
                href: appendQuery("/app/payments", { q: member.name }),
                id: `payment-${payment.id}`,
                kind: "payment" as const,
                title: `${member.name} · ${payment.planName}`,
              },
            ];
          }),
        "payment",
      )
    : [];

  const noticeResults = visibleRouteIds.has("notices")
    ? takeResults(
        db.notices
          .filter((notice) => scopedBranchIdSet.has(notice.branchId) && canReadNotice(user, db, notice, scopedBranchIds))
          .filter((notice) =>
            matchesMemberSearch(keyword, [
              notice.title,
              notice.body,
              branchesById.get(notice.branchId)?.name,
            ]),
          )
          .sort(
            (left, right) =>
              Number(Boolean(right.important)) - Number(Boolean(left.important)) ||
              right.createdAt.localeCompare(left.createdAt),
          )
          .map((notice) => ({
            description: `${branchesById.get(notice.branchId)?.name ?? "지점 미지정"}${notice.important ? " · 중요" : ""}`,
            href: appendQuery("/app/notices", { highlight: notice.id, q: notice.title }),
            id: `notice-${notice.id}`,
            kind: "notice" as const,
            title: notice.title,
          })),
        "notice",
      )
    : [];

  return [...menuResults, ...userResults, ...memberResults, ...paymentResults, ...noticeResults];
}
