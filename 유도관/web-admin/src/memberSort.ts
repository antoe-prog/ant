import {
  digitsOnly,
  getBeltOrder,
  type BeltRank,
} from "@dojo/lib/judo-utils";

export type MemberSortKey = "name" | "joinDate" | "belt" | "fee" | "nextPayment";

export type MemberRow = {
  id: number;
  name: string;
  beltRank: string;
  status: string;
  phone?: string | null;
  email?: string | null;
  joinDate: string;
  monthlyFee: number;
  nextPaymentDate?: string | null;
  notes?: string | null;
};

export function sortMembers(rows: MemberRow[], sortKey: MemberSortKey): MemberRow[] {
  return [...rows].sort((a, b) => {
    switch (sortKey) {
      case "name":
        return a.name.localeCompare(b.name, "ko");
      case "joinDate":
        return b.joinDate.localeCompare(a.joinDate);
      case "belt":
        return (
          getBeltOrder(a.beltRank as BeltRank) - getBeltOrder(b.beltRank as BeltRank)
        );
      case "fee":
        return b.monthlyFee - a.monthlyFee;
      case "nextPayment": {
        const na = a.nextPaymentDate ?? "9999-12-31";
        const nb = b.nextPaymentDate ?? "9999-12-31";
        return na.localeCompare(nb);
      }
      default:
        return 0;
    }
  });
}

export function filterMembers(rows: MemberRow[], search: string): MemberRow[] {
  const q = search.trim();
  if (!q) return rows;
  const qLower = q.toLowerCase();
  const qDigits = digitsOnly(q);
  return rows.filter((m) => {
    const mail = (m.email ?? "").toLowerCase();
    return (
      m.name.toLowerCase().includes(qLower) ||
      mail.includes(qLower) ||
      (qDigits.length > 0 && m.phone ? digitsOnly(m.phone).includes(qDigits) : false)
    );
  });
}
