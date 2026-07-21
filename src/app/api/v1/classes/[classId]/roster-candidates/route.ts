import { NextRequest } from "next/server";
import { isClassAgeGroupCompatible } from "@/lib/class-enrollment-policy";
import { getAccessibleBranchIds } from "@/lib/mock-api";
import { jsonError, jsonOk, requireSelectedBranchScope, requireSession } from "@/server/api";
import { readServerDb } from "@/server/db";

export const runtime = "nodejs";

export async function GET(request: NextRequest, { params }: { params: Promise<{ classId: string }> }) {
  const { classId } = await params;
  const db = await readServerDb();
  const { user, response } = requireSession(request, db);

  if (!user) {
    return response;
  }

  if (!["coach", "owner", "admin"].includes(user.role)) {
    return jsonError(403, "FORBIDDEN", "수업 회원을 배정할 권한이 없습니다.");
  }

  const session = db.classes.find((candidate) => candidate.id === classId);

  if (!session) {
    return jsonError(404, "NOT_FOUND", "수업을 찾을 수 없습니다.");
  }

  if (user.role === "coach" && session.coachId !== user.id) {
    return jsonError(403, "FORBIDDEN", "코치는 본인 담당 수업의 회원만 배정할 수 있습니다.");
  }

  if (!getAccessibleBranchIds(user, db).includes(session.branchId)) {
    return jsonError(403, "FORBIDDEN", "선택한 수업의 지점에 접근할 수 없습니다.");
  }

  const selectedScope = requireSelectedBranchScope(request, user, db);

  if (selectedScope.response) {
    return selectedScope.response;
  }

  if (selectedScope.selectedBranchId && selectedScope.selectedBranchId !== session.branchId) {
    return jsonError(403, "FORBIDDEN", "선택한 지점의 수업 회원만 배정할 수 있습니다.");
  }

  const candidates = db.members
    .filter((member) => {
      const enrolled = session.enrolledMemberIds.includes(member.id);
      return (
        member.branchId === session.branchId &&
        (enrolled || ((member.status === "active" || member.status === "trial") && isClassAgeGroupCompatible(member, session)))
      );
    })
    .sort((left, right) => left.name.localeCompare(right.name, "ko"))
    .map((member) => ({
      id: member.id,
      name: member.name,
      ageGroup: member.ageGroup,
      level: member.level,
      status: member.status,
      enrolled: session.enrolledMemberIds.includes(member.id),
      removalLocked: db.attendance.some((record) => record.sessionId === session.id && record.memberId === member.id),
    }));

  return jsonOk({ classId: session.id, candidates });
}
