import { NextRequest } from "next/server";
import { getClassRegistrationBlockReason } from "@/lib/class-enrollment-policy";
import { formatDateKey } from "@/lib/format";
import { getAccessibleMemberIds } from "@/lib/mock-api";
import { jsonError, jsonOk, requireSelectedBranchScope, requireSession } from "@/server/api";
import { readServerDb } from "@/server/db";

export const runtime = "nodejs";

const monthPattern = /^\d{4}-(0[1-9]|1[0-2])$/;

export async function GET(request: NextRequest) {
  const db = await readServerDb();
  const { user, response } = requireSession(request, db);

  if (!user) {
    return response;
  }

  if (user.role !== "member" && user.role !== "guardian") {
    return jsonError(403, "FORBIDDEN", "회원 또는 학부모 계정에서만 신청 가능한 수업을 조회할 수 있습니다.");
  }

  const { searchParams } = new URL(request.url);
  const memberId = searchParams.get("memberId")?.trim() ?? "";
  const month = searchParams.get("month")?.trim() ?? "";

  if (!memberId || memberId.length > 200 || !monthPattern.test(month)) {
    return jsonError(400, "VALIDATION_ERROR", "조회할 회원과 월 정보를 확인해 주세요.");
  }

  const selectedScope = requireSelectedBranchScope(request, user, db);

  if (selectedScope.response) {
    return selectedScope.response;
  }

  const member = db.members.find((candidate) => candidate.id === memberId);
  const accessibleMemberIds = getAccessibleMemberIds(user, db, selectedScope.branchIds);

  if (!member || !accessibleMemberIds.includes(member.id)) {
    return jsonError(404, "NOT_FOUND", "회원을 찾을 수 없습니다.");
  }

  if (selectedScope.selectedBranchId && selectedScope.selectedBranchId !== member.branchId) {
    return jsonError(403, "FORBIDDEN", "선택한 회원의 지점에 접근할 수 없습니다.");
  }

  const now = new Date();
  const options = db.classes
    .filter(
      (session) =>
        session.branchId === member.branchId &&
        formatDateKey(session.startsAt).startsWith(`${month}-`) &&
        Date.parse(session.startsAt) > now.getTime(),
    )
    .sort((left, right) => left.startsAt.localeCompare(right.startsAt))
    .slice(0, 200)
    .map((session) => {
      const branch = db.branches.find((candidate) => candidate.id === session.branchId);
      const coach = db.users.find((candidate) => candidate.id === session.coachId);
      const isEnrolled = session.enrolledMemberIds.includes(member.id);
      const unavailableReason = isEnrolled ? null : getClassRegistrationBlockReason(db, member, session, now);

      return {
        id: session.id,
        branchId: session.branchId,
        branchName: branch?.name ?? "지점",
        name: session.name,
        level: session.level,
        ageGroup: session.ageGroup,
        coachName: coach?.name ?? "담당 코치",
        startsAt: session.startsAt,
        endsAt: session.endsAt,
        room: session.room,
        capacity: session.capacity,
        enrolledCount: session.enrolledMemberIds.length,
        isEnrolled,
        canRegister: !isEnrolled && unavailableReason === null,
        canCancel: isEnrolled,
        unavailableReason,
      };
    });

  return jsonOk({ memberId: member.id, month, options });
}
