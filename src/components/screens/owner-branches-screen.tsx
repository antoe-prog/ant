"use client";

import Link from "next/link";
import { useState } from "react";
import { CalendarCheck, CreditCard, Settings2, Users } from "lucide-react";
import { useApiContext } from "@/hooks/use-api-context";
import { formatBranchTimezone, normalizeBranchSettings } from "@/lib/domain";
import { formatCurrency } from "@/lib/format";
import { SectionHeader } from "@/components/ui/primitives";
import { EmptyState } from "@/components/ui/state-blocks";

export function OwnerBranchesScreen() {
  const context = useApiContext();
  const [openPolicyBranchIds, setOpenPolicyBranchIds] = useState<string[]>([]);
  const [openActionBranchIds, setOpenActionBranchIds] = useState<string[]>([]);
  const accessibleBranchIds = context.user.branchIds;
  const branches = context.db.branches.filter((branch) => accessibleBranchIds.includes(branch.id));

  function togglePolicy(branchId: string) {
    setOpenPolicyBranchIds((current) =>
      current.includes(branchId) ? current.filter((currentBranchId) => currentBranchId !== branchId) : [...current, branchId],
    );
  }

  function toggleActions(branchId: string) {
    setOpenActionBranchIds((current) =>
      current.includes(branchId) ? current.filter((currentBranchId) => currentBranchId !== branchId) : [...current, branchId],
    );
  }

  return (
    <div>
      <SectionHeader title="내 지점" />

      {branches.length === 0 ? (
        <EmptyState title="배정된 지점이 없습니다" />
      ) : (
        <section className="grid min-w-0 gap-3 xl:grid-cols-2" aria-label="대표 지점 목록">
          {branches.map((branch) => {
            const settings = normalizeBranchSettings(branch.settings);
            const members = context.db.members.filter((member) => member.branchId === branch.id);
            const activeMembers = members.filter((member) => member.status === "active");
            const classes = context.db.classes.filter((session) => session.branchId === branch.id);
            const payments = context.db.payments.filter((payment) => payment.branchId === branch.id);
            const riskPayments = payments.filter((payment) => payment.status === "overdue" || payment.status === "expiringSoon");
            const capacity = classes.reduce((sum, session) => sum + session.capacity, 0);
            const enrolled = classes.reduce((sum, session) => sum + session.enrolledMemberIds.length, 0);
            const fillRate = capacity > 0 ? Math.min(100, Math.round((enrolled / capacity) * 100)) : 0;
            const riskAmount = riskPayments.reduce((sum, payment) => sum + payment.amount, 0);
            const policyOpen = openPolicyBranchIds.includes(branch.id);
            const actionsOpen = openActionBranchIds.includes(branch.id);
            const policyDetailId = `owner-branch-policy-${branch.id}`;
            const healthRows = [
              {
                icon: Users,
                label: "회원 유지",
                meta: `활성 ${activeMembers.length} / 전체 ${members.length}`,
                value: members.length > 0 ? Math.round((activeMembers.length / members.length) * 100) : 0,
                tone: "bg-emerald-500",
              },
              {
                icon: CalendarCheck,
                label: "수업 채움",
                meta: `${enrolled} / ${capacity}명`,
                value: fillRate,
                tone: "bg-blue-500",
              },
              {
                icon: CreditCard,
                label: "결제 위험",
                meta: `${riskPayments.length}건 · ${formatCurrency(riskAmount)}`,
                value: payments.length > 0 ? Math.min(100, Math.round((riskPayments.length / payments.length) * 100)) : 0,
                tone: riskPayments.length > 0 ? "bg-amber-500" : "bg-zinc-300",
              },
            ];
            const actionLinks = [
              {
                href: "/app/payments",
                label: "결제",
                priority: riskPayments.length > 0 ? 0 : 3,
                signal: riskPayments.length > 0 ? `${riskPayments.length}건 위험` : "정상",
              },
              {
                href: "/app/classes",
                label: "수업",
                priority: fillRate < 50 ? 2 : 5,
                signal: `${fillRate}% 채움`,
              },
              {
                href: "/app/members",
                label: "회원",
                priority: members.length - activeMembers.length > 0 ? 2 : 6,
                signal: `${activeMembers.length}/${members.length}명`,
              },
            ].sort((left, right) => left.priority - right.priority || left.label.localeCompare(right.label));
            const visibleActionLinks = actionsOpen ? actionLinks : actionLinks.slice(0, 2);

            return (
              <article className="min-w-0 overflow-hidden rounded-lg border border-zinc-200 bg-white p-3" key={branch.id}>
                <div className="flex min-w-0 items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-xs font-semibold text-teal-700">{branch.district}</p>
                    <h2 className="mt-0.5 truncate text-base font-semibold text-zinc-950">{branch.name}</h2>
                    <p className="mt-0.5 text-xs text-zinc-600">{formatBranchTimezone(branch.timezone)}</p>
                  </div>
                  <span
                    className={`shrink-0 rounded-md border px-2 py-1 text-xs font-semibold ${
                      branch.status === "inactive"
                        ? "border-zinc-200 bg-zinc-50 text-zinc-600"
                        : "border-emerald-200 bg-emerald-50 text-emerald-700"
                    }`}
                  >
                    {branch.status === "inactive" ? "비활성" : "운영 중"}
                  </span>
                </div>

                <div className="mt-2 grid gap-1 rounded-md border border-zinc-200 bg-zinc-50 px-2 py-1.5" data-testid="owner-branch-health-graph">
                  {healthRows.map((row) => {
                    const Icon = row.icon;

                    return (
                      <div
                        className="grid min-w-0 grid-cols-[minmax(4.25rem,5rem)_minmax(0,1fr)_minmax(3.75rem,auto)] items-center gap-1.5 py-0.5"
                        data-testid="owner-branch-health-row"
                        key={row.label}
                      >
                        <div className="flex min-w-0 items-center gap-1.5">
                          <Icon className="h-3.5 w-3.5 shrink-0 text-zinc-500" aria-hidden />
                          <span className="min-w-0 truncate text-xs font-semibold text-zinc-700">{row.label}</span>
                        </div>
                        <div className="h-1.5 overflow-hidden rounded-full bg-white">
                          <div className={`h-full rounded-full ${row.tone}`} style={{ width: `${row.value}%` }} />
                        </div>
                        <span className="min-w-0 truncate text-right text-xs font-semibold tabular-nums text-zinc-950">{row.meta}</span>
                      </div>
                    );
                  })}
                </div>

                <div className="mt-3 border-t border-zinc-100 pt-2">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-1.5 text-zinc-950">
                      <Settings2 className="h-4 w-4 shrink-0 text-teal-700" aria-hidden />
                      <div className="min-w-0" data-testid="owner-branch-policy-summary">
                        <h3 className="text-sm font-semibold text-zinc-950">운영 정책</h3>
                        <p className="mt-0.5 truncate text-xs text-zinc-500">{settings.attendanceEditRequiresReason ? "출석 수정 사유 필수" : "출석 수정 사유 선택"}</p>
                      </div>
                    </div>
                    <button
                      aria-controls={policyDetailId}
                      aria-expanded={policyOpen}
                      className="inline-flex min-h-11 shrink-0 items-center justify-center rounded-md border border-zinc-200 bg-white px-3 text-xs font-semibold text-zinc-700 transition hover:bg-zinc-50"
                      data-testid="owner-branch-policy-toggle"
                      type="button"
                      onClick={() => togglePolicy(branch.id)}
                    >
                      {policyOpen ? "접기" : "정책 보기"}
                    </button>
                  </div>
                  {policyOpen ? (
                    <div
                      className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1.5 rounded-md bg-zinc-50 p-3 text-xs leading-5 text-zinc-600"
                      data-testid="owner-branch-policy-detail"
                      id={policyDetailId}
                    >
                      <p className="min-w-0 break-words">{settings.attendanceEditRequiresReason ? "수정 사유 필수" : "수정 사유 선택"}</p>
                      <p className="min-w-0 break-words">{formatBranchTimezone(branch.timezone)}</p>
                    </div>
                  ) : null}
                </div>

                <div className="mt-2 grid grid-cols-[1fr_auto] items-stretch gap-1.5" data-testid="owner-branch-action-grid">
                  <div className="grid min-w-0 grid-cols-2 gap-1.5">
                    {visibleActionLinks.map((action) => (
                      <Link
                        className="inline-flex min-h-11 min-w-0 flex-col items-center justify-center rounded-md border border-zinc-200 px-2 text-xs font-semibold text-zinc-700 transition hover:bg-zinc-50"
                        data-testid="owner-branch-action-link"
                        href={action.href}
                        key={action.label}
                      >
                        <span>{action.label}</span>
                        <span className="mt-0.5 max-w-full truncate text-[10px] leading-3 text-zinc-500">{action.signal}</span>
                      </Link>
                    ))}
                  </div>
                  <button
                    aria-expanded={actionsOpen}
                    className="inline-flex min-h-11 min-w-14 items-center justify-center rounded-md border border-zinc-200 bg-white px-2 text-xs font-semibold text-zinc-700 transition hover:bg-zinc-50"
                    data-testid="owner-branch-action-toggle"
                    type="button"
                    onClick={() => toggleActions(branch.id)}
                  >
                    {actionsOpen ? "접기" : "더 보기"}
                  </button>
                </div>
              </article>
            );
          })}
        </section>
      )}
    </div>
  );
}
