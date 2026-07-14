import assert from "node:assert/strict";
import { resetOwnedSmokeServer } from "./lib/release-smoke-environment.mjs";

const baseUrl = process.env.SMOKE_BASE_URL ?? "http://localhost:3000";
const skipDevReset = process.env.SMOKE_SKIP_DEV_RESET === "1";
const stamp = Date.now();
const defaultPilotPassword = "FinalJudoPilot!2026";
const roleEmails = {
  admin: process.env.SMOKE_ADMIN_EMAIL ?? "admin@finaljudo.kr",
  owner: "owner@finaljudo.kr",
  coach: "coach@finaljudo.kr",
  guardian: "guardian@finaljudo.kr",
  member: "member@finaljudo.kr",
};
const rolePasswords = {
  admin: process.env.SMOKE_ADMIN_PASSWORD ?? defaultPilotPassword,
  owner: process.env.SMOKE_OWNER_PASSWORD ?? defaultPilotPassword,
  coach: process.env.SMOKE_COACH_PASSWORD ?? defaultPilotPassword,
  guardian: process.env.SMOKE_GUARDIAN_PASSWORD ?? defaultPilotPassword,
  member: process.env.SMOKE_MEMBER_PASSWORD ?? defaultPilotPassword,
};

function createSmokePhone(offset) {
  const suffix = String((Number(String(stamp).slice(-8)) + offset) % 100000000).padStart(8, "0");

  return `010${suffix}`;
}

function createClient() {
  let cookie = "";

  return {
    async request(path, init = {}, options = {}) {
      const response = await fetch(`${baseUrl}${path}`, {
        ...init,
        headers: {
          "Content-Type": "application/json",
          ...(cookie ? { Cookie: cookie } : {}),
          ...(init.headers ?? {}),
        },
      }).catch((error) => {
        throw new Error(`Cannot reach ${baseUrl}. Start the app with npm run dev before running smoke tests. ${error.message}`);
      });
      const setCookie = response.headers.get("set-cookie");

      if (setCookie) {
        cookie = setCookie.split(";")[0];
      }

      const payload = options.responseType === "text"
        ? await response.text()
        : await response.json().catch(() => ({}));

      if (!options.allowError && !response.ok) {
        throw new Error(`${response.status} ${payload.error?.code ?? ""} ${payload.error?.message ?? ""}`.trim());
      }

      return { response, payload };
    },
  };
}

function getUnreadNoticeCount(bootstrapData) {
  const userId = bootstrapData.user?.id;

  assert(userId, "bootstrap payload must include the current user id");

  return bootstrapData.db.notices.filter((notice) => !(notice.readByUserIds ?? []).includes(userId)).length;
}

function assertUnreadNoticeVisible(bootstrapData, title, label) {
  const userId = bootstrapData.user?.id;
  const notice = bootstrapData.db.notices.find((item) => item.title === title);

  assert(userId, `${label} bootstrap payload must include the current user id`);
  assert(notice, `${label} notice must be visible in the recipient bootstrap`);
  assert(!(notice.readByUserIds ?? []).includes(userId), `${label} notice must start unread for the recipient`);

  return notice;
}

function assertUnreadNoticeCountIncreased(previousCount, bootstrapData, title, label) {
  assertUnreadNoticeVisible(bootstrapData, title, label);
  assert.equal(
    getUnreadNoticeCount(bootstrapData),
    previousCount + 1,
    `${label} unread notice count must increase for the recipient notification badge`,
  );
}

function assertNoticeCreateDeliveryFeedback(data, minimumRecipientCount, label) {
  assert(data.push, `${label} notice create must return delivery feedback`);
  assert(data.push.recipientCount >= minimumRecipientCount, `${label} notice create must count app inbox recipients`);
  assert(data.push.message.includes("알림함"), `${label} notice create feedback must clarify app inbox delivery`);
  assert(
    data.db.auditLogs.some(
      (log) =>
        log.action === "notification.dispatch" &&
        log.targetId === data.notice?.id &&
        log.after?.autoDispatchedOnCreate === true,
    ),
    `${label} notice create must audit automatic notification dispatch`,
  );
}

async function resetDemoData(phase) {
  if (skipDevReset) {
    return;
  }

  const response = await resetOwnedSmokeServer({
    baseUrl,
    env: process.env,
    label: `${phase} smoke reset`,
  }).catch((error) => {
    throw new Error(`Cannot reset demo data ${phase} smoke tests. ${error.message}`);
  });
  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(
      `Cannot reset demo data ${phase} smoke tests: ${response.status} ${payload.error?.code ?? ""} ${payload.error?.message ?? ""}`.trim(),
    );
  }

  assert(payload.data?.counts?.branches === 2, `demo data reset ${phase} smoke tests did not restore baseline branches`);
}

async function login(client, role) {
  const email = roleEmails[role];
  const password = rolePasswords[role];

  assert(email, `${role} login email is not configured`);

  const body = password ? { email, password } : { role };
  const { response, payload } = await client.request("/api/v1/auth/login", {
    method: "POST",
    body: JSON.stringify(body),
  });

  assert(response.ok, `${role} login failed`);
  assert(payload.data.user.role === role, `${role} login role mismatch`);
  return payload.data;
}

async function loginWithCredentials(client, email, password) {
  const { response, payload } = await client.request("/api/v1/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });

  assert(response.ok, `${email} credential login failed`);
  return payload.data;
}

async function assertCsvExportBlockedForRole(client, role) {
  for (const exportPath of ["/api/v1/exports/payments", "/api/v1/exports/operations"]) {
    const result = await client.request(
      `${exportPath}?selectedBranchId=branch-gangnam`,
      {},
      { allowError: true, responseType: "text" },
    );

    assert(result.response.status === 403, `${role} must not access ${exportPath} CSV export`);
    assert(
      !result.response.headers.get("content-type")?.includes("text/csv"),
      `${role} blocked CSV export must not return CSV content`,
    );
  }
}

async function assertFamilyPushSubscriptionAlwaysOn(client, role, offset) {
  const endpoint = `https://push.example.test/${role}-always-on-${stamp}-${offset}`;

  let result = await client.request("/api/v1/notifications/subscriptions", {
    method: "POST",
    body: JSON.stringify({
      subscription: {
        endpoint,
        keys: {
          auth: `${role}-smoke-auth-key`,
          p256dh: `${role}-smoke-p256dh-key`,
        },
      },
      userAgent: `${role}-smoke-api`,
    }),
  });

  assert(result.payload.data.subscription.disabledAt === null, `${role} push subscription must start active`);
  assert(result.payload.data.activeSubscriptionCount === 1, `${role} push subscription count must be scoped to the current user`);

  result = await client.request("/api/v1/notifications/push-config");
  assert(result.payload.data.currentUserSubscribed === true, `${role} push config must expose current user subscription state`);
  assert(result.payload.data.activeSubscriptionCount === 1, `${role} push config must not expose global subscription counts`);

  result = await client.request("/api/v1/notifications/subscriptions", {
    method: "DELETE",
    body: JSON.stringify({ endpoint }),
  });

  assert(result.payload.data.enforcedAlwaysOn === true, `${role} push unsubscribe must enforce always-on policy`);
  assert(result.payload.data.subscription.disabledAt === null, `${role} push unsubscribe must keep subscription active`);
  assert(result.payload.data.activeSubscriptionCount === 1, `${role} push unsubscribe must keep only current user count visible`);
}

async function assertCsvExportRejectsInvalidBranch(client, role) {
  for (const exportPath of ["/api/v1/exports/payments", "/api/v1/exports/operations"]) {
    const result = await client.request(
      `${exportPath}?selectedBranchId=branch-missing`,
      {},
      { allowError: true },
    );

    assert(result.response.status === 403, `${role} must not export CSV for an invalid selected branch`);
    assert(result.payload.error?.code === "FORBIDDEN", `${role} invalid branch export must return a forbidden error`);
    assert(
      !result.response.headers.get("content-type")?.includes("text/csv"),
      `${role} invalid branch export must not return CSV content`,
    );
  }
}

async function run() {
  const anonymous = createClient();
  const unauthenticated = await anonymous.request("/api/v1/me/bootstrap", {}, { allowError: true });

  assert(unauthenticated.response.status === 401, "protected bootstrap must require authentication");

  const unauthenticatedMemberUpdate = await anonymous.request(
    "/api/v1/members/member-jun?selectedBranchId=branch-gangnam",
    {
      method: "PATCH",
      body: JSON.stringify({}),
    },
    { allowError: true },
  );
  assert(unauthenticatedMemberUpdate.response.status === 401, "member update must require login before validation");

  const unauthenticatedGuardianLink = await anonymous.request(
    "/api/v1/members/member-jun/guardians?selectedBranchId=branch-gangnam",
    {
      method: "POST",
      body: JSON.stringify({}),
    },
    { allowError: true },
  );
  assert(unauthenticatedGuardianLink.response.status === 401, "guardian link must require login before validation");

  const unauthenticatedCounselingNote = await anonymous.request(
    "/api/v1/branches/branch-gangnam/members/member-jun/counseling-notes?selectedBranchId=branch-gangnam",
    {
      method: "POST",
      body: JSON.stringify({}),
    },
    { allowError: true },
  );
  assert(unauthenticatedCounselingNote.response.status === 401, "counseling note create must require login before validation");

  const unauthenticatedAttendanceUpdate = await anonymous.request(
    "/api/v1/class-sessions/class-kids-am/attendance?selectedBranchId=branch-gangnam",
    {
      method: "PUT",
      body: JSON.stringify({}),
    },
    { allowError: true },
  );
  assert(unauthenticatedAttendanceUpdate.response.status === 401, "attendance update must require login before validation");

  const unauthenticatedAttendanceReason = await anonymous.request(
    "/api/v1/class-sessions/class-kids-am/attendance/member-jun/reason?selectedBranchId=branch-gangnam",
    {
      method: "POST",
      body: JSON.stringify({}),
    },
    { allowError: true },
  );
  assert(unauthenticatedAttendanceReason.response.status === 401, "attendance reason must require login before validation");

  const unauthenticatedClassCreate = await anonymous.request(
    "/api/v1/branches/branch-gangnam/classes?selectedBranchId=branch-gangnam",
    {
      method: "POST",
      body: JSON.stringify({}),
    },
    { allowError: true },
  );
  assert(unauthenticatedClassCreate.response.status === 401, "class create must require login before validation");

  const unauthenticatedClassUpdate = await anonymous.request(
    "/api/v1/classes/class-kids-am?selectedBranchId=branch-gangnam",
    {
      method: "PATCH",
      body: JSON.stringify({}),
    },
    { allowError: true },
  );
  assert(unauthenticatedClassUpdate.response.status === 401, "class update must require login before validation");

  const unauthenticatedNoticeBulkRead = await anonymous.request(
    "/api/v1/me/notices/bulk-read?selectedBranchId=branch-gangnam",
    {
      method: "POST",
      body: JSON.stringify({}),
    },
    { allowError: true },
  );
  assert(unauthenticatedNoticeBulkRead.response.status === 401, "notice bulk read must require login before validation");

  const unauthenticatedNoticeCreate = await anonymous.request(
    "/api/v1/branches/branch-gangnam/notices?selectedBranchId=branch-gangnam",
    {
      method: "POST",
      body: JSON.stringify({}),
    },
    { allowError: true },
  );
  assert(unauthenticatedNoticeCreate.response.status === 401, "notice create must require login before validation");

  const unauthenticatedPushSubscribe = await anonymous.request(
    "/api/v1/notifications/subscriptions",
    {
      method: "POST",
      body: JSON.stringify({}),
    },
    { allowError: true },
  );
  assert(unauthenticatedPushSubscribe.response.status === 401, "push subscription create must require login before validation");

  const unauthenticatedPushUnsubscribe = await anonymous.request(
    "/api/v1/notifications/subscriptions",
    {
      method: "DELETE",
      body: JSON.stringify({}),
    },
    { allowError: true },
  );
  assert(unauthenticatedPushUnsubscribe.response.status === 401, "push subscription delete must require login before validation");

  for (const deletedRequestApiPath of [
    "/api/v1/requests?selectedBranchId=branch-gangnam",
    "/api/v1/requests/deleted-request/approve?selectedBranchId=branch-gangnam",
    "/api/v1/requests/deleted-request/reject?selectedBranchId=branch-gangnam",
  ]) {
    const deletedRequestApi = await anonymous.request(
      deletedRequestApiPath,
      {
        method: "POST",
        body: JSON.stringify({}),
      },
      { allowError: true },
    );

    assert(
      deletedRequestApi.response.status === 404,
      `${deletedRequestApiPath} must stay deleted and return 404, got ${deletedRequestApi.response.status}`,
    );
  }

  const unauthenticatedMemberCreate = await anonymous.request(
    "/api/v1/branches/branch-gangnam/members?selectedBranchId=branch-gangnam",
    {
      method: "POST",
      body: JSON.stringify({}),
    },
    { allowError: true },
  );
  assert(unauthenticatedMemberCreate.response.status === 401, "member create must require login before validation");

  const unauthenticatedPilotIncidentCreate = await anonymous.request(
    "/api/v1/admin/pilot-incidents",
    {
      method: "POST",
      body: JSON.stringify({}),
    },
    { allowError: true },
  );
  assert(unauthenticatedPilotIncidentCreate.response.status === 401, "pilot incident create must require login before validation");

  const unauthenticatedPilotIncidentUpdate = await anonymous.request(
    "/api/v1/admin/pilot-incidents/pilot-incident-missing",
    {
      method: "PATCH",
      body: JSON.stringify({}),
    },
    { allowError: true },
  );
  assert(unauthenticatedPilotIncidentUpdate.response.status === 401, "pilot incident update must require login before validation");

  const unauthenticatedPilotOperation = await anonymous.request(
    "/api/v1/admin/pilot-operations",
    {
      method: "POST",
      body: JSON.stringify({}),
    },
    { allowError: true },
  );
  assert(unauthenticatedPilotOperation.response.status === 401, "pilot operation update must require login before validation");

  const unauthenticatedPilotReadiness = await anonymous.request(
    "/api/v1/admin/pilot-readiness",
    {
      method: "PATCH",
      body: JSON.stringify({}),
    },
    { allowError: true },
  );
  assert(unauthenticatedPilotReadiness.response.status === 401, "pilot readiness update must require login before validation");

  const credentialRole = "admin";
  const credentialClient = createClient();
  const credentialBootstrap = await loginWithCredentials(
    credentialClient,
    roleEmails[credentialRole],
    rolePasswords[credentialRole],
  );
  assert(credentialBootstrap.user.role === credentialRole, "credential login role mismatch");
  assert(!credentialBootstrap.user.passwordHash, "credential login must not expose user password hash");
  assert(
    credentialBootstrap.db.users.every((candidate) => !candidate.passwordHash),
    "credential login snapshot must not expose user password hashes",
  );

  const blockedCredentialLogin = await anonymous.request(
    "/api/v1/auth/login",
    {
      method: "POST",
      body: JSON.stringify({ email: roleEmails.admin, password: "wrong-password" }),
    },
    { allowError: true },
  );
  assert(blockedCredentialLogin.response.status === 401, "wrong credential login must fail");

  const coach = createClient();
  const coachBootstrap = await login(coach, "coach");

  assert(coachBootstrap.user.role === "coach", "coach bootstrap role mismatch");
  assert.equal(coachBootstrap.db.payments.length, 0, "coach bootstrap must not include payment records");
  assert(coachBootstrap.db.classes.every((session) => session.coachId === "user-coach"), "coach must only see assigned classes");
  assert(
    coachBootstrap.db.auditLogs.every((log) => log.actorUserId === "user-coach"),
    "coach bootstrap must not include branch audit logs created by other roles",
  );

  const blockedCoachMemberUpdate = await coach.request(
    "/api/v1/members/member-jun?selectedBranchId=branch-gangnam",
    {
      method: "PATCH",
      body: JSON.stringify({}),
    },
    { allowError: true },
  );
  assert(blockedCoachMemberUpdate.response.status === 403, "coach must not reach member update validation");

  const blockedCoachGuardianLink = await coach.request(
    "/api/v1/members/member-jun/guardians?selectedBranchId=branch-gangnam",
    {
      method: "POST",
      body: JSON.stringify({}),
    },
    { allowError: true },
  );
  assert(blockedCoachGuardianLink.response.status === 403, "coach must not reach guardian link validation");

  const blockedCoachClassCreate = await coach.request(
    "/api/v1/branches/branch-gangnam/classes?selectedBranchId=branch-gangnam",
    {
      method: "POST",
      body: JSON.stringify({}),
    },
    { allowError: true },
  );
  assert(blockedCoachClassCreate.response.status === 403, "coach must not reach class create validation");

  const blockedCoachClassUpdate = await coach.request(
    "/api/v1/classes/class-kids-am?selectedBranchId=branch-gangnam",
    {
      method: "PATCH",
      body: JSON.stringify({}),
    },
    { allowError: true },
  );
  assert(blockedCoachClassUpdate.response.status === 403, "coach must not reach class update validation");

  const invalidCoachNoticeCreate = await coach.request(
    "/api/v1/branches/branch-gangnam/notices?selectedBranchId=branch-gangnam",
    {
      method: "POST",
      body: JSON.stringify({}),
    },
    { allowError: true },
  );
  assert(invalidCoachNoticeCreate.response.status === 400, "coach notice create must reach validation inside assigned branch");

  const blockedCoachMemberCreate = await coach.request(
    "/api/v1/branches/branch-gangnam/members?selectedBranchId=branch-gangnam",
    {
      method: "POST",
      body: JSON.stringify({}),
    },
    { allowError: true },
  );
  assert(blockedCoachMemberCreate.response.status === 403, "coach must not reach member create validation");

  const blockedCoachPilotIncidentCreate = await coach.request(
    "/api/v1/admin/pilot-incidents",
    {
      method: "POST",
      body: JSON.stringify({}),
    },
    { allowError: true },
  );
  assert(blockedCoachPilotIncidentCreate.response.status === 403, "coach must not reach pilot incident create validation");

  const blockedCoachPilotIncidentUpdate = await coach.request(
    "/api/v1/admin/pilot-incidents/pilot-incident-missing",
    {
      method: "PATCH",
      body: JSON.stringify({}),
    },
    { allowError: true },
  );
  assert(blockedCoachPilotIncidentUpdate.response.status === 403, "coach must not reach pilot incident update validation");

  const blockedCoachPilotOperation = await coach.request(
    "/api/v1/admin/pilot-operations",
    {
      method: "POST",
      body: JSON.stringify({}),
    },
    { allowError: true },
  );
  assert(blockedCoachPilotOperation.response.status === 403, "coach must not reach pilot operation validation");

  const blockedAttendance = await coach.request(
    "/api/v1/class-sessions/class-songpa-kids/attendance?selectedBranchId=branch-songpa",
    {
      method: "PUT",
      body: JSON.stringify({ items: [{ memberId: "member-harin", status: "present" }] }),
    },
    { allowError: true },
  );

  assert(blockedAttendance.response.status === 403, "coach must not update another branch attendance");

  const attendanceNote = `Smoke attendance note ${stamp}`;
  let result = await coach.request(
    "/api/v1/class-sessions/class-kids-am/attendance?selectedBranchId=branch-missing",
    {
      method: "PUT",
      body: JSON.stringify({}),
    },
    { allowError: true },
  );
  assert(result.response.status === 403, "attendance update must reject an invalid selected branch before validation");
  assert(result.payload.error?.code === "FORBIDDEN", "attendance invalid selected branch must return FORBIDDEN");

  result = await coach.request("/api/v1/class-sessions/class-kids-am/attendance?selectedBranchId=branch-gangnam", {
    method: "PUT",
    body: JSON.stringify({
      items: [{ memberId: "member-jun", status: "present", note: attendanceNote }],
      reason: `Smoke attendance reason ${stamp}`,
    }),
  });
  const attendanceRecord = result.payload.data.db.attendance.find(
    (record) => record.sessionId === "class-kids-am" && record.memberId === "member-jun",
  );
  assert(attendanceRecord?.note === attendanceNote, "attendance note missing");
  assert(
    result.payload.data.db.auditLogs.some(
      (log) => log.action === "attendance.update" && log.after?.note === attendanceNote,
    ),
    "attendance update audit note missing",
  );
  const attendanceReason = `Smoke attendance reason update ${stamp}`;
  result = await coach.request(
    "/api/v1/class-sessions/class-kids-am/attendance/member-jun/reason?selectedBranchId=branch-missing",
    {
      method: "POST",
      body: JSON.stringify({}),
    },
    { allowError: true },
  );
  assert(result.response.status === 403, "attendance reason must reject an invalid selected branch before validation");

  result = await coach.request(
    "/api/v1/class-sessions/class-kids-am/attendance/member-jun/reason?selectedBranchId=branch-gangnam",
    {
      method: "POST",
      body: JSON.stringify({ reason: attendanceReason }),
    },
  );
  const reasonRecord = result.payload.data.db.attendance.find(
    (record) => record.sessionId === "class-kids-am" && record.memberId === "member-jun",
  );
  assert(reasonRecord?.note === attendanceReason, "attendance reason route did not update note");
  assert(
    result.payload.data.db.auditLogs.some(
      (log) => log.action === "attendance.update" && log.after?.note === attendanceReason,
    ),
    "attendance reason audit note missing",
  );

  const counselingBody = `Smoke counseling note ${stamp}`;
  result = await coach.request(
    "/api/v1/branches/branch-gangnam/members/member-jun/counseling-notes?selectedBranchId=branch-missing",
    {
      method: "POST",
      body: JSON.stringify({}),
    },
    { allowError: true },
  );
  assert(result.response.status === 403, "counseling note create must reject an invalid selected branch before validation");

  result = await coach.request(
    "/api/v1/branches/branch-gangnam/members/member-jun/counseling-notes?selectedBranchId=branch-gangnam",
    {
      method: "POST",
      body: JSON.stringify({
        body: counselingBody,
        noteType: "caution",
        visibility: "coach_visible",
      }),
    },
  );
  const counselingNote = result.payload.data.db.counselingNotes.find((note) => note.body === counselingBody);

  assert(counselingNote?.visibility === "coach_visible", "coach counseling note create did not persist");
  assert(
    result.payload.data.db.auditLogs.some(
      (log) => log.action === "counseling_note.create" && log.targetId === counselingNote.id,
    ),
    "counseling note create audit missing",
  );

  const guardianVisibleBody = `Smoke guardian-visible counseling note ${stamp}`;
  result = await coach.request(
    "/api/v1/branches/branch-gangnam/members/member-seo/counseling-notes?selectedBranchId=branch-gangnam",
    {
      method: "POST",
      body: JSON.stringify({
        body: guardianVisibleBody,
        noteType: "progress",
        visibility: "guardian_visible",
      }),
    },
  );
  assert(
    result.payload.data.db.counselingNotes.some((note) => note.body === guardianVisibleBody),
    "guardian-visible counseling note create did not persist",
  );

  const blockedStaffOnlyNote = await coach.request(
    "/api/v1/branches/branch-gangnam/members/member-jun/counseling-notes?selectedBranchId=branch-gangnam",
    {
      method: "POST",
      body: JSON.stringify({
        body: `Blocked staff-only note ${stamp}`,
        noteType: "follow_up",
        visibility: "staff_only",
      }),
    },
    { allowError: true },
  );
  assert(blockedStaffOnlyNote.response.status === 403, "coach must not create staff-only counseling notes");

  const guardian = createClient();
  result = await login(guardian, "guardian");
  await assertCsvExportBlockedForRole(guardian, "guardian");
  await assertFamilyPushSubscriptionAlwaysOn(guardian, "guardian", 10);
  assert(
    result.db.auditLogs.every((log) => log.actorUserId === "user-guardian"),
    "guardian bootstrap must not include coach branch audit logs",
  );
  const blockedGuardianAttendanceUpdate = await guardian.request(
    "/api/v1/class-sessions/class-kids-am/attendance?selectedBranchId=branch-gangnam",
    {
      method: "PUT",
      body: JSON.stringify({}),
    },
    { allowError: true },
  );
  assert(blockedGuardianAttendanceUpdate.response.status === 403, "guardian must not reach attendance update validation");

  const blockedGuardianAttendanceReason = await guardian.request(
    "/api/v1/class-sessions/class-kids-am/attendance/member-jun/reason?selectedBranchId=branch-gangnam",
    {
      method: "POST",
      body: JSON.stringify({}),
    },
    { allowError: true },
  );
  assert(blockedGuardianAttendanceReason.response.status === 403, "guardian must not reach attendance reason validation");

  const blockedGuardianCounselingNote = await guardian.request(
    "/api/v1/branches/branch-gangnam/members/member-jun/counseling-notes?selectedBranchId=branch-gangnam",
    {
      method: "POST",
      body: JSON.stringify({}),
    },
    { allowError: true },
  );
  assert(blockedGuardianCounselingNote.response.status === 403, "guardian must not reach counseling note validation");
  const guardianMemberIds = result.db.members.map((member) => member.id);
  assert(
    guardianMemberIds.includes("member-jun") && guardianMemberIds.includes("member-seo"),
    "guardian must see baseline linked child members",
  );
  assert(
    result.db.members.every((member) => member.guardianIds.includes("user-guardian")),
    "guardian must only see linked child members",
  );
  assert(
    result.db.counselingNotes.every((note) => note.visibility === "guardian_visible"),
    "guardian must only see guardian-visible counseling notes",
  );
  assert(
    result.db.counselingNotes.some((note) => note.body === guardianVisibleBody) &&
      result.db.counselingNotes.every((note) => note.body !== counselingBody),
    "guardian counseling note visibility filter failed",
  );
  const owner = createClient();
  await login(owner, "owner");
  result = await owner.request("/api/v1/me/bootstrap?selectedBranchId=branch-songpa");
  assert(
    result.payload.data.db.members.every((member) => member.branchId === "branch-songpa"),
    "owner selected branch scope must only include selected branch members",
  );
  result = await owner.request("/api/v1/me/bootstrap?selectedBranchId=branch-missing", {}, { allowError: true });
  assert(result.response.status === 403, "bootstrap must reject an invalid selected branch");
  assert(result.payload.error?.code === "FORBIDDEN", "bootstrap invalid selected branch must return FORBIDDEN");

  const mismatchCounselingBody = `Smoke mismatch counseling note ${stamp}`;
  result = await owner.request(
    "/api/v1/branches/branch-gangnam/members/member-jun/counseling-notes?selectedBranchId=branch-songpa",
    {
      method: "POST",
      body: JSON.stringify({
        body: mismatchCounselingBody,
        noteType: "progress",
        visibility: "guardian_visible",
      }),
    },
    { allowError: true },
  );
  assert(result.response.status === 403, "counseling note create must reject a selected branch mismatch before validation");
  result = await owner.request("/api/v1/me/bootstrap?selectedBranchId=branch-gangnam");
  assert(
    !result.payload.data.db.counselingNotes.some((note) => note.body === mismatchCounselingBody),
    "selected branch mismatch must not create the counseling note",
  );

  const ownerProfilePhone = createSmokePhone(40);
  const mismatchOwnerProfilePhone = createSmokePhone(41);

  result = await owner.request("/api/v1/members/member-minjae?selectedBranchId=branch-songpa", {
    method: "PATCH",
    body: JSON.stringify({
      emergencyContact: mismatchOwnerProfilePhone,
    }),
  }, { allowError: true });
  assert(result.response.status === 403, "member update must reject a selected branch mismatch before validation");
  result = await owner.request("/api/v1/me/bootstrap?selectedBranchId=branch-gangnam");
  assert(
    result.payload.data.db.members.find((member) => member.id === "member-minjae")?.emergencyContact !== mismatchOwnerProfilePhone,
    "selected branch mismatch must not update the member",
  );

  result = await owner.request("/api/v1/members/member-minjae?selectedBranchId=branch-gangnam", {
    method: "PATCH",
    body: JSON.stringify({
      ageGroup: "teen",
      emergencyContact: ownerProfilePhone,
      name: `Smoke Member ${stamp}`,
    }),
  });
  assert(
    result.payload.data.db.members.find((member) => member.id === "member-minjae")?.ageGroup === "teen",
    "owner member age group update did not persist",
  );
  assert(
    result.payload.data.db.members.find((member) => member.id === "member-minjae")?.name === `Smoke Member ${stamp}`,
    "owner member name update did not persist",
  );
  assert(
    result.payload.data.db.members.find((member) => member.id === "member-minjae")?.emergencyContact === ownerProfilePhone,
    "owner member emergency contact update did not persist",
  );
  assert(
    result.payload.data.db.users.find((user) => user.id === "user-member")?.name === `Smoke Member ${stamp}`,
    "owner member profile update did not sync linked user name",
  );
  assert(
    result.payload.data.db.users.find((user) => user.id === "user-member")?.phone === ownerProfilePhone,
    "owner member profile update did not sync linked user phone",
  );
  assert(
    result.payload.data.db.auditLogs.some(
      (log) =>
        log.action === "member.update" &&
        log.after?.ageGroup === "teen" &&
        log.after?.name === `Smoke Member ${stamp}` &&
        log.after?.syncedUserIds?.includes("user-member"),
    ),
    "owner member profile update audit log missing linked user sync",
  );

  result = await owner.request("/api/v1/admin/users/invitations?selectedBranchId=branch-gangnam", {
    method: "POST",
    body: JSON.stringify({
      name: `Owner Invite ${stamp}`,
      email: `owner-invite-${stamp}@example.com`,
      phone: createSmokePhone(10),
      role: "coach",
      branchIds: ["branch-gangnam"],
    }),
  });
  assert(result.payload.data.invitation?.path?.startsWith("/invite/"), "owner branch invitation did not return invite path");
  assert(
    result.payload.data.db.auditLogs.some((log) => log.action === "user.invite.create"),
    "owner branch invitation audit log missing",
  );

  const blockedOwnerAdminInvite = await owner.request(
    "/api/v1/admin/users/invitations?selectedBranchId=branch-gangnam",
    {
      method: "POST",
      body: JSON.stringify({
        name: `Blocked Admin Invite ${stamp}`,
        email: `blocked-admin-${stamp}@example.com`,
        phone: createSmokePhone(11),
        role: "admin",
        branchIds: [],
      }),
    },
    { allowError: true },
  );
  assert(blockedOwnerAdminInvite.response.status === 403, "owner must not invite admin users");

  const guardianLinkTargetMemberId = "member-jiho";

  result = await owner.request(
    `/api/v1/members/${guardianLinkTargetMemberId}/guardians?selectedBranchId=branch-missing`,
    {
      method: "POST",
      body: JSON.stringify({}),
    },
    { allowError: true },
  );
  assert(result.response.status === 403, "guardian link must reject an invalid selected branch before validation");

  result = await owner.request(
    `/api/v1/members/${guardianLinkTargetMemberId}/guardians?selectedBranchId=branch-songpa`,
    {
      method: "POST",
      body: JSON.stringify({
        guardianUserId: "user-guardian",
      }),
    },
    { allowError: true },
  );
  assert(result.response.status === 403, "guardian link must reject a selected branch mismatch before validation");
  result = await owner.request("/api/v1/me/bootstrap?selectedBranchId=branch-gangnam");
  assert(
    !result.payload.data.db.members.find((member) => member.id === guardianLinkTargetMemberId)?.guardianIds.includes("user-guardian"),
    "selected branch mismatch must not link the guardian",
  );

  const adultGuardianLink = await owner.request(
    `/api/v1/members/${guardianLinkTargetMemberId}/guardians?selectedBranchId=branch-gangnam`,
    {
      method: "POST",
      body: JSON.stringify({
        guardianUserId: "user-guardian",
      }),
    },
    { allowError: true },
  );
  assert.equal(adultGuardianLink.response.status, 422, "adult member guardian link must be rejected");
  assert.match(
    adultGuardianLink.payload.error?.message ?? "",
    /성인 회원/,
    "adult member guardian link rejection must explain the age policy",
  );
  result = await owner.request("/api/v1/me/bootstrap?selectedBranchId=branch-gangnam");
  assert(
    !result.payload.data.db.members.find((member) => member.id === guardianLinkTargetMemberId)?.guardianIds.includes("user-guardian"),
    "adult member guardian link rejection must not mutate guardian ids",
  );

  result = await owner.request(`/api/v1/members/${guardianLinkTargetMemberId}?selectedBranchId=branch-gangnam`, {
    method: "PATCH",
    body: JSON.stringify({
      ageGroup: "teen",
    }),
  });
  assert(
    result.payload.data.db.members.find((member) => member.id === guardianLinkTargetMemberId)?.ageGroup === "teen",
    "guardian link target age group must be changed to teen before guardian linking",
  );

  result = await owner.request(`/api/v1/members/${guardianLinkTargetMemberId}/guardians?selectedBranchId=branch-gangnam`, {
    method: "POST",
    body: JSON.stringify({
      guardianUserId: "user-guardian",
    }),
  });
  assert(
    result.payload.data.db.members.find((member) => member.id === guardianLinkTargetMemberId)?.guardianIds.includes("user-guardian"),
    "guardian link did not update member guardian ids",
  );
  assert(
    result.payload.data.db.users.find((user) => user.id === "user-guardian")?.childMemberIds?.includes(guardianLinkTargetMemberId),
    "guardian link did not update guardian child ids",
  );
  assert(
    result.payload.data.db.auditLogs.some(
      (log) => log.action === "member.update" && log.after?.guardianUserId === "user-guardian",
    ),
    "guardian link audit log missing",
  );

  const relinkGuardian = await owner.request(
    `/api/v1/members/${guardianLinkTargetMemberId}/guardians?selectedBranchId=branch-gangnam`,
    {
      method: "POST",
      body: JSON.stringify({
        guardianUserId: "user-guardian",
      }),
    },
  );
  assert(
    relinkGuardian.payload.data.db.members.find((member) => member.id === guardianLinkTargetMemberId)?.guardianIds.filter((id) => id === "user-guardian").length === 1,
    "guardian link must be idempotent",
  );

  const replaceGuardian = await owner.request(
    `/api/v1/members/${guardianLinkTargetMemberId}/guardians?selectedBranchId=branch-gangnam`,
    {
      method: "PUT",
      body: JSON.stringify({
        guardianUserId: "user-songpa-guardian",
      }),
    },
  );
  assert(
    replaceGuardian.payload.data.db.members.find((member) => member.id === guardianLinkTargetMemberId)?.guardianIds.join(",") === "user-songpa-guardian",
    "guardian replace must atomically replace member guardian ids",
  );
  assert(
    !replaceGuardian.payload.data.db.users.find((user) => user.id === "user-guardian")?.childMemberIds?.includes(guardianLinkTargetMemberId),
    "guardian replace must remove previous guardian child ids",
  );
  assert(
    replaceGuardian.payload.data.db.users.find((user) => user.id === "user-songpa-guardian")?.childMemberIds?.includes(guardianLinkTargetMemberId),
    "guardian replace must update next guardian child ids",
  );
  assert(
    replaceGuardian.payload.data.db.auditLogs.some(
      (log) =>
        log.action === "member.update" &&
        log.after?.guardianUserId === "user-songpa-guardian" &&
        Array.isArray(log.after?.guardianIds) &&
        log.after.guardianIds.join(",") === "user-songpa-guardian",
    ),
    "guardian replace audit log missing",
  );

  const replaceGuardianBack = await owner.request(
    `/api/v1/members/${guardianLinkTargetMemberId}/guardians?selectedBranchId=branch-gangnam`,
    {
      method: "PUT",
      body: JSON.stringify({
        guardianUserId: "user-guardian",
      }),
    },
  );
  assert(
    replaceGuardianBack.payload.data.db.members.find((member) => member.id === guardianLinkTargetMemberId)?.guardianIds.join(",") === "user-guardian",
    "guardian replace back did not restore member guardian ids",
  );
  assert(
    !replaceGuardianBack.payload.data.db.users.find((user) => user.id === "user-songpa-guardian")?.childMemberIds?.includes(guardianLinkTargetMemberId),
    "guardian replace back must remove temporary guardian child ids",
  );

  const unlinkGuardian = await owner.request(
    `/api/v1/members/${guardianLinkTargetMemberId}/guardians?selectedBranchId=branch-gangnam`,
    {
      method: "DELETE",
      body: JSON.stringify({
        guardianUserId: "user-guardian",
      }),
    },
  );
  assert(
    !unlinkGuardian.payload.data.db.members.find((member) => member.id === guardianLinkTargetMemberId)?.guardianIds.includes("user-guardian"),
    "guardian unlink did not update member guardian ids",
  );
  assert(
    !unlinkGuardian.payload.data.db.users.find((user) => user.id === "user-guardian")?.childMemberIds?.includes(guardianLinkTargetMemberId),
    "guardian unlink did not update guardian child ids",
  );
  assert(
    unlinkGuardian.payload.data.db.auditLogs.some(
      (log) =>
        log.action === "member.update" &&
        log.after?.guardianUserId === "user-guardian" &&
        Array.isArray(log.after?.guardianIds) &&
        !log.after.guardianIds.includes("user-guardian"),
    ),
    "guardian unlink audit log missing",
  );

  result = await owner.request(`/api/v1/members/${guardianLinkTargetMemberId}/guardians?selectedBranchId=branch-gangnam`, {
    method: "POST",
    body: JSON.stringify({
      guardianUserId: "user-guardian",
    }),
  });
  assert(
    result.payload.data.db.members.find((member) => member.id === guardianLinkTargetMemberId)?.guardianIds.includes("user-guardian"),
    "guardian relink after unlink did not update member guardian ids",
  );

  const guardianAfterLink = createClient();
  result = await login(guardianAfterLink, "guardian");
  assert(
    result.db.auditLogs.every((log) => log.actorUserId === "user-guardian"),
    "guardian bootstrap must only include guardian-authored audit logs",
  );
  assert(
    result.db.members.some((member) => member.id === guardianLinkTargetMemberId),
    "linked guardian must see newly connected member",
  );
  const guardianContact = `010-7700-${String(stamp).slice(-4)}`;

  result = await guardianAfterLink.request(`/api/v1/members/${guardianLinkTargetMemberId}?selectedBranchId=branch-gangnam`, {
    method: "PATCH",
    body: JSON.stringify({
      emergencyContact: guardianContact,
    }),
  });
  assert(
    result.payload.data.db.members.find((member) => member.id === guardianLinkTargetMemberId)?.emergencyContact === guardianContact,
    "guardian linked member emergency contact update did not persist",
  );
  assert(
    result.payload.data.db.auditLogs.some(
      (log) =>
        log.action === "member.update" &&
        log.after?.emergencyContact === `010-****-${guardianContact.slice(-4)}`,
    ),
    "guardian linked member emergency contact audit log must retain a masked change record",
  );

  const blockedGuardianStatus = await guardianAfterLink.request(
    `/api/v1/members/${guardianLinkTargetMemberId}?selectedBranchId=branch-gangnam`,
    {
      method: "PATCH",
      body: JSON.stringify({
        status: "withdrawn",
      }),
    },
    { allowError: true },
  );
  assert(blockedGuardianStatus.response.status === 403, "guardian must not update linked member status");

  const blockedGuardianAgeGroup = await guardianAfterLink.request(
    `/api/v1/members/${guardianLinkTargetMemberId}?selectedBranchId=branch-gangnam`,
    {
      method: "PATCH",
      body: JSON.stringify({
        ageGroup: "adult",
      }),
    },
    { allowError: true },
  );
  assert(blockedGuardianAgeGroup.response.status === 403, "guardian must not update linked member age group");

  const memberClient = createClient();
  result = await login(memberClient, "member");
  await assertCsvExportBlockedForRole(memberClient, "member");
  await assertFamilyPushSubscriptionAlwaysOn(memberClient, "member", 20);
  assert(
    !result.user.invitationToken &&
      !result.user.invitedAt &&
      !result.user.acceptedAt &&
      !result.user.passwordResetRequestedAt &&
      !result.user.passwordUpdatedAt,
    "member bootstrap user must not expose account operation fields",
  );
  assert(
    result.db.users.every(
      (candidate) =>
        !candidate.invitationToken &&
        !candidate.invitedAt &&
        !candidate.acceptedAt &&
        !candidate.passwordResetRequestedAt &&
        !candidate.passwordUpdatedAt,
    ),
    "member bootstrap snapshot must not expose account operation fields",
  );
  assert(
    result.db.auditLogs.every((log) => log.actorUserId === "user-member"),
    "member bootstrap must not include branch audit logs created by staff or guardians",
  );
  assert(
    result.db.members.length === 1 && result.db.members[0].id === "member-minjae",
    "member must only see own member profile",
  );
  const memberContact = `010-8800-${String(stamp).slice(-4)}`;

  result = await memberClient.request("/api/v1/members/member-minjae?selectedBranchId=branch-missing", {
    method: "PATCH",
    body: JSON.stringify({}),
  }, { allowError: true });
  assert(result.response.status === 403, "member update must reject an invalid selected branch before validation");

  result = await memberClient.request("/api/v1/members/member-minjae?selectedBranchId=branch-gangnam", {
    method: "PATCH",
    body: JSON.stringify({
      emergencyContact: memberContact,
    }),
  });
  assert(
    result.payload.data.db.members.find((member) => member.id === "member-minjae")?.emergencyContact === memberContact,
    "member emergency contact update did not persist",
  );
  assert(
    result.payload.data.db.users.find((user) => user.id === "user-member")?.phone === memberContact.replace(/\D/g, ""),
    "member emergency contact update did not sync linked user phone",
  );

  result = await owner.request("/api/v1/branches/branch-gangnam/members?selectedBranchId=branch-missing", {
    method: "POST",
    body: JSON.stringify({}),
  }, { allowError: true });
  assert(result.response.status === 403, "member create must reject an invalid selected branch before validation");

  const mismatchMemberName = `Smoke Mismatch Member ${stamp}`;
  result = await owner.request(
    "/api/v1/branches/branch-gangnam/members?selectedBranchId=branch-songpa",
    {
      method: "POST",
      body: JSON.stringify({
        name: mismatchMemberName,
        status: "trial",
        ageGroup: "kids",
        level: "입문",
        belt: "흰띠",
        emergencyContact: "010-3482-6159",
      }),
    },
    { allowError: true },
  );
  assert(result.response.status === 403, "member create must reject a selected branch mismatch before validation");
  result = await owner.request("/api/v1/me/bootstrap?selectedBranchId=branch-gangnam");
  assert(
    !result.payload.data.db.members.some((member) => member.name === mismatchMemberName),
    "selected branch mismatch must not create the member",
  );

  result = await owner.request("/api/v1/branches/branch-gangnam/members?selectedBranchId=branch-gangnam", {
    method: "POST",
    body: JSON.stringify({
      name: `Smoke Member ${stamp}`,
      status: "trial",
      ageGroup: "kids",
      level: "입문",
      belt: "흰띠",
      emergencyContact: "010-3482-6159",
    }),
  });
  const createdMember = result.payload.data.db.members.find((member) => member.name === `Smoke Member ${stamp}`);

  assert(createdMember, "member create did not return created member");
  assert(createdMember.createdAt, "member create did not persist createdAt");
  assert(createdMember.statusChangedAt, "member create did not persist statusChangedAt");

  result = await owner.request(`/api/v1/members/${createdMember.id}?selectedBranchId=branch-gangnam`, {
    method: "PATCH",
    body: JSON.stringify({ status: "paused" }),
  });
  const pausedMember = result.payload.data.db.members.find((member) => member.id === createdMember.id);

  assert(pausedMember?.status === "paused", "member status update did not persist");
  assert(
    pausedMember?.statusChangedAt && Date.parse(pausedMember.statusChangedAt) >= Date.parse(createdMember.statusChangedAt),
    "member status update did not refresh statusChangedAt",
  );

  const startsAt = new Date(stamp + 3 * 60 * 60 * 1000).toISOString();
  const endsAt = new Date(stamp + 4 * 60 * 60 * 1000).toISOString();

  result = await owner.request(
    "/api/v1/branches/branch-gangnam/classes?selectedBranchId=branch-missing",
    {
      method: "POST",
      body: JSON.stringify({}),
    },
    { allowError: true },
  );
  assert(result.response.status === 403, "class create must reject an invalid selected branch before validation");

  const mismatchClassName = `Smoke Mismatch Class ${stamp}`;
  result = await owner.request(
    "/api/v1/branches/branch-gangnam/classes?selectedBranchId=branch-songpa",
    {
      method: "POST",
      body: JSON.stringify({
        name: mismatchClassName,
        level: "초급",
        ageGroup: "kids",
        coachId: "user-coach",
        startsAt,
        endsAt,
        room: "매트 C",
        capacity: 8,
        enrolledMemberIds: ["member-jun"],
      }),
    },
    { allowError: true },
  );
  assert(result.response.status === 403, "class create must reject a selected branch mismatch before validation");
  result = await owner.request("/api/v1/me/bootstrap?selectedBranchId=branch-gangnam");
  assert(
    !result.payload.data.db.classes.some((item) => item.name === mismatchClassName),
    "selected branch mismatch must not create the class",
  );

  result = await owner.request("/api/v1/branches/branch-gangnam/classes?selectedBranchId=branch-gangnam", {
    method: "POST",
    body: JSON.stringify({
      name: `Smoke Class ${stamp}`,
      level: "초급",
      ageGroup: "kids",
      coachId: "user-coach",
      startsAt,
      endsAt,
      room: "매트 C",
      capacity: 8,
      enrolledMemberIds: ["member-jun"],
    }),
  });
  const createdClass = result.payload.data.db.classes.find((item) => item.name === `Smoke Class ${stamp}`);

  assert(createdClass, "class create did not return created class");

  result = await owner.request(
    `/api/v1/classes/${createdClass.id}?selectedBranchId=branch-missing`,
    {
      method: "PATCH",
      body: JSON.stringify({}),
    },
    { allowError: true },
  );
  assert(result.response.status === 403, "class update must reject an invalid selected branch before validation");

  result = await owner.request(
    `/api/v1/classes/${createdClass.id}?selectedBranchId=branch-songpa`,
    {
      method: "PATCH",
      body: JSON.stringify({ room: "매트 Z", capacity: 10 }),
    },
    { allowError: true },
  );
  assert(result.response.status === 403, "class update must reject a selected branch mismatch before validation");
  result = await owner.request("/api/v1/me/bootstrap?selectedBranchId=branch-gangnam");
  assert(
    result.payload.data.db.classes.find((item) => item.id === createdClass.id)?.room !== "매트 Z",
    "selected branch mismatch must not update the class",
  );

  result = await owner.request(`/api/v1/classes/${createdClass.id}?selectedBranchId=branch-gangnam`, {
    method: "PATCH",
    body: JSON.stringify({ room: "매트 D", capacity: 9 }),
  });
  const updatedClass = result.payload.data.db.classes.find((item) => item.id === createdClass.id);

  assert(updatedClass?.room === "매트 D" && updatedClass.capacity === 9, "class update did not persist");

  result = await owner.request(
    "/api/v1/branches/branch-gangnam/payments?selectedBranchId=branch-missing",
    {
      method: "POST",
      body: JSON.stringify({}),
    },
    { allowError: true },
  );
  assert(result.response.status === 403, "payment create must reject an invalid selected branch before validation");

  const mismatchPlanName = `Smoke Mismatch Plan ${stamp}`;
  result = await owner.request(
    "/api/v1/branches/branch-gangnam/payments?selectedBranchId=branch-songpa",
    {
      method: "POST",
      body: JSON.stringify({
        memberId: "member-jun",
        planName: mismatchPlanName,
        status: "paid",
        amount: 190000,
        discountAmount: 10000,
        dueDate: "2026-06-13",
        expiresAt: "2026-07-13",
      }),
    },
    { allowError: true },
  );
  assert(result.response.status === 403, "payment create must reject a selected branch mismatch before validation");
  result = await owner.request("/api/v1/me/bootstrap?selectedBranchId=branch-gangnam");
  assert(
    !result.payload.data.db.payments.some((payment) => payment.planName === mismatchPlanName),
    "selected branch mismatch must not create the payment",
  );

  const reversedDatePlanName = `Smoke Reversed Dates ${stamp}`;
  result = await owner.request(
    "/api/v1/branches/branch-gangnam/payments?selectedBranchId=branch-gangnam",
    {
      method: "POST",
      body: JSON.stringify({
        memberId: "member-jun",
        planName: reversedDatePlanName,
        status: "scheduled",
        amount: 190000,
        discountAmount: 10000,
        dueDate: "2026-07-14",
        expiresAt: "2026-07-13",
      }),
    },
    { allowError: true },
  );
  assert(result.response.status === 400, "payment create must reject an expiry before the due date");

  const impossibleDatePlanName = `Smoke Impossible Date ${stamp}`;
  result = await owner.request(
    "/api/v1/branches/branch-gangnam/payments?selectedBranchId=branch-gangnam",
    {
      method: "POST",
      body: JSON.stringify({
        memberId: "member-jun",
        planName: impossibleDatePlanName,
        status: "scheduled",
        amount: 190000,
        discountAmount: 10000,
        dueDate: "2026-02-29",
        expiresAt: "2026-03-29",
      }),
    },
    { allowError: true },
  );
  assert(result.response.status === 400, "payment create must reject a date outside the real calendar");

  for (const terminalStatus of ["cancelled", "refunded"]) {
    result = await owner.request(
      "/api/v1/branches/branch-gangnam/payments?selectedBranchId=branch-gangnam",
      {
        method: "POST",
        body: JSON.stringify({
          memberId: "member-jun",
          planName: `Smoke Reason Required ${terminalStatus} ${stamp}`,
          status: terminalStatus,
          amount: 190000,
          discountAmount: 10000,
          dueDate: "2026-06-13",
          expiresAt: "2026-07-13",
        }),
      },
      { allowError: true },
    );
    assert(result.response.status === 400, `manual ${terminalStatus} creation must require a reason`);
  }

  const cancelledCreatePlanName = `Smoke Cancelled Create ${stamp}`;
  const cancelledCreateReason = `Smoke duplicate cancellation ${stamp}`;
  result = await owner.request(
    "/api/v1/branches/branch-gangnam/payments?selectedBranchId=branch-gangnam",
    {
      method: "POST",
      body: JSON.stringify({
        memberId: "member-jun",
        planName: cancelledCreatePlanName,
        status: "cancelled",
        amount: 190000,
        discountAmount: 10000,
        dueDate: "2026-06-13",
        expiresAt: "2026-07-13",
        reason: `  ${cancelledCreateReason}  `,
      }),
    },
  );
  const cancelledCreatePayment = result.payload.data.db.payments.find(
    (payment) => payment.planName === cancelledCreatePlanName,
  );
  assert(cancelledCreatePayment, "cancelled manual payment with a reason must be created");
  assert(
    cancelledCreatePayment.refundReason === cancelledCreateReason && Boolean(cancelledCreatePayment.refundedAt),
    "cancelled manual payment creation must persist the normalized reason and cancellation time",
  );
  assert(
    !Object.prototype.hasOwnProperty.call(cancelledCreatePayment, "reason"),
    "cancelled manual payment creation must not duplicate the audit reason outside the payment schema",
  );
  assert(
    cancelledCreatePayment.statusHistory?.some(
      (entry) => entry.event === "created" && entry.reason.includes(cancelledCreateReason),
    ),
    "cancelled manual payment creation must persist its reason in status history",
  );
  assert(
    result.payload.data.db.auditLogs.some(
      (log) => log.action === "payment.create" && log.targetId === cancelledCreatePayment.id && log.after?.reason === cancelledCreateReason,
    ),
    "cancelled manual payment creation must persist its reason in the audit snapshot",
  );
  result = await owner.request(
    `/api/v1/payments/${cancelledCreatePayment.id}?selectedBranchId=branch-gangnam`,
    {
      method: "DELETE",
      body: JSON.stringify({ reason: `Smoke cleanup ${stamp}` }),
    },
  );
  assert(
    !result.payload.data.db.payments.some((payment) => payment.id === cancelledCreatePayment.id),
    "cancelled manual payment reason fixture must be removable after verification",
  );

  const zeroRefundedPlanName = `Smoke Zero Refunded Create ${stamp}`;
  const zeroRefundedReason = `Smoke zero refund completion ${stamp}`;
  result = await owner.request(
    "/api/v1/branches/branch-gangnam/payments?selectedBranchId=branch-gangnam",
    {
      method: "POST",
      body: JSON.stringify({
        memberId: "member-jun",
        planName: zeroRefundedPlanName,
        status: "refunded",
        amount: 0,
        discountAmount: 0,
        dueDate: "2026-06-13",
        expiresAt: "2026-07-13",
        reason: `  ${zeroRefundedReason}  `,
      }),
    },
  );
  const zeroRefundedPayment = result.payload.data.db.payments.find(
    (payment) => payment.planName === zeroRefundedPlanName,
  );
  assert(zeroRefundedPayment, "zero-amount refunded manual payment must be created for integrity verification");
  assert(
    zeroRefundedPayment.status === "refunded" &&
      zeroRefundedPayment.refundedAmount === 0 &&
      zeroRefundedPayment.refundReason === zeroRefundedReason &&
      Boolean(zeroRefundedPayment.refundedAt),
    "zero-amount refunded manual payment must persist canonical refund metadata",
  );
  assert(
    !Object.prototype.hasOwnProperty.call(zeroRefundedPayment, "reason"),
    "refunded manual payment must not duplicate the audit reason outside the payment schema",
  );
  result = await owner.request(
    `/api/v1/payments/${zeroRefundedPayment.id}?selectedBranchId=branch-gangnam`,
    {
      method: "PATCH",
      body: JSON.stringify({
        amount: 0,
        discountAmount: 0,
        dueDate: "2026-06-13",
        expiresAt: "2026-07-13",
        planName: `${zeroRefundedPlanName} changed`,
        reason: `Smoke invalid zero refund edit ${stamp}`,
        status: "paid",
      }),
    },
    { allowError: true },
  );
  assert(result.response.status === 422, "zero-amount refunded manual payment must not be editable");
  result = await owner.request(
    `/api/v1/payments/${zeroRefundedPayment.id}?selectedBranchId=branch-gangnam`,
    {
      method: "DELETE",
      body: JSON.stringify({ reason: `Smoke invalid zero refund delete ${stamp}` }),
    },
    { allowError: true },
  );
  assert(result.response.status === 422, "zero-amount refunded manual payment must not be deletable");

  const idempotencyKey = `manual.smoke.${stamp}`;
  const idempotentPlanName = `Smoke Idempotent Plan ${stamp}`;
  const idempotentPaymentBody = {
    memberId: "member-seo",
    planName: idempotentPlanName,
    status: "scheduled",
    amount: 175000,
    discountAmount: 5000,
    dueDate: "2026-06-18",
    expiresAt: "2026-07-18",
  };
  const createIdempotentPayment = () =>
    owner.request("/api/v1/branches/branch-gangnam/payments?selectedBranchId=branch-gangnam", {
      method: "POST",
      headers: { "Idempotency-Key": idempotencyKey },
      body: JSON.stringify(idempotentPaymentBody),
    });
  const [idempotentFirstResult, idempotentReplayResult] = await Promise.all([
    createIdempotentPayment(),
    createIdempotentPayment(),
  ]);
  const idempotentPayments = idempotentReplayResult.payload.data.db.payments.filter(
    (payment) => payment.planName === idempotentPlanName,
  );

  assert.equal(idempotentPayments.length, 1, "concurrent payment retries with the same key must create exactly one record");
  assert(
    [idempotentFirstResult, idempotentReplayResult].some(
      ({ response }) => response.headers.get("idempotency-replayed") === "true",
    ),
    "an idempotent payment retry must identify the replayed response",
  );
  assert.equal(
    idempotentReplayResult.payload.data.db.auditLogs.filter(
      (log) => log.action === "payment.create" && log.after?.idempotencyKey === idempotencyKey,
    ).length,
    1,
    "idempotent payment retries must create one payment.create audit log",
  );

  result = await owner.request(
    "/api/v1/branches/branch-gangnam/payments?selectedBranchId=branch-gangnam",
    {
      method: "POST",
      headers: { "Idempotency-Key": idempotencyKey },
      body: JSON.stringify({ ...idempotentPaymentBody, amount: idempotentPaymentBody.amount + 1000 }),
    },
    { allowError: true },
  );
  assert(result.response.status === 409, "a payment idempotency key must reject a different payload");
  assert(result.payload.error?.code === "IDEMPOTENCY_CONFLICT", "payment idempotency conflicts must use a stable error code");

  const idempotentPayment = idempotentPayments[0];
  result = await owner.request(
    `/api/v1/payments/${idempotentPayment.id}?selectedBranchId=branch-gangnam`,
    {
      method: "DELETE",
      body: JSON.stringify({ reason: `Smoke idempotency deletion ${stamp}` }),
    },
  );
  assert(!result.payload.data.db.payments.some((payment) => payment.id === idempotentPayment.id), "idempotency fixture deletion must persist");

  result = await owner.request(
    "/api/v1/branches/branch-gangnam/payments?selectedBranchId=branch-gangnam",
    {
      method: "POST",
      headers: { "Idempotency-Key": idempotencyKey },
      body: JSON.stringify(idempotentPaymentBody),
    },
    { allowError: true },
  );
  assert(result.response.status === 409, "a stale retry must not recreate a deleted payment");

  result = await owner.request("/api/v1/branches/branch-gangnam/payments?selectedBranchId=branch-gangnam", {
    method: "POST",
    body: JSON.stringify({
      memberId: "member-jun",
      planName: `Smoke Plan ${stamp}`,
      status: "scheduled",
      amount: 190000,
      discountAmount: 10000,
      dueDate: "2026-06-13",
      expiresAt: "2026-07-13",
    }),
  });
  const createdPayment = result.payload.data.db.payments.find((payment) => payment.planName === `Smoke Plan ${stamp}`);

  assert(createdPayment, "payment create did not return created payment");
  assert(createdPayment.discountAmount === 10000, "payment discount amount did not persist");
  assert(
    createdPayment.statusHistory?.some((entry) => entry.status === "scheduled" && entry.event === "created"),
    "payment create must persist status history",
  );
  const createdPaymentHistoryCount = createdPayment.statusHistory?.length ?? 0;

  result = await owner.request(
    `/api/v1/payments/${createdPayment.id}?selectedBranchId=branch-missing`,
    {
      method: "PATCH",
      body: JSON.stringify({}),
    },
    { allowError: true },
  );
  assert(result.response.status === 403, "manual payment update must reject an invalid selected branch before validation");

  result = await owner.request(
    `/api/v1/payments/${createdPayment.id}?selectedBranchId=branch-songpa`,
    {
      method: "PATCH",
      body: JSON.stringify({
        amount: 200000,
        discountAmount: 15000,
        dueDate: "2026-06-14",
        expiresAt: "2026-07-14",
        planName: `Smoke Plan Revised ${stamp}`,
        reason: `Smoke correction ${stamp}`,
        status: "scheduled",
      }),
    },
    { allowError: true },
  );
  assert(result.response.status === 403, "manual payment update must reject a selected branch mismatch before validation");

  result = await owner.request(
    `/api/v1/payments/${createdPayment.id}?selectedBranchId=branch-gangnam`,
    {
      method: "PATCH",
      body: JSON.stringify({
        amount: 200000,
        discountAmount: 15000,
        dueDate: "2026-07-15",
        expiresAt: "2026-07-14",
        planName: `Smoke Plan Revised ${stamp}`,
        reason: `Smoke reversed date correction ${stamp}`,
        status: "scheduled",
      }),
    },
    { allowError: true },
  );
  assert(result.response.status === 400, "manual payment update must reject an expiry before the due date");

  result = await owner.request(
    `/api/v1/payments/${createdPayment.id}?selectedBranchId=branch-gangnam`,
    {
      method: "PATCH",
      body: JSON.stringify({
        amount: 200000,
        discountAmount: 15000,
        dueDate: "2026-04-30",
        expiresAt: "2026-04-31",
        planName: `Smoke Plan Revised ${stamp}`,
        reason: `Smoke impossible date correction ${stamp}`,
        status: "scheduled",
      }),
    },
    { allowError: true },
  );
  assert(result.response.status === 400, "manual payment update must reject a date outside the real calendar");

  result = await owner.request(`/api/v1/payments/${createdPayment.id}?selectedBranchId=branch-gangnam`, {
    method: "PATCH",
    body: JSON.stringify({
      amount: 200000,
      discountAmount: 15000,
      dueDate: "2026-06-14",
      expiresAt: "2026-07-14",
      planName: `Smoke Plan Revised ${stamp}`,
      reason: `Smoke correction ${stamp}`,
      status: "scheduled",
    }),
  });
  const updatedManualPayment = result.payload.data.db.payments.find((payment) => payment.id === createdPayment.id);
  assert(
    updatedManualPayment?.planName === `Smoke Plan Revised ${stamp}` &&
      updatedManualPayment.amount === 200000 &&
      updatedManualPayment.discountAmount === 15000 &&
      updatedManualPayment.dueDate === "2026-06-14" &&
      updatedManualPayment.expiresAt === "2026-07-14",
    "manual payment update must persist editable fields",
  );
  assert(
    (updatedManualPayment?.statusHistory?.length ?? 0) === createdPaymentHistoryCount &&
      !updatedManualPayment?.statusHistory?.some(
        (entry) => entry.event === "status_changed" && entry.reason.includes(`Smoke correction ${stamp}`),
      ),
    "manual payment detail update must not append false status history",
  );
  assert(
    result.payload.data.db.auditLogs.some(
      (log) => log.action === "payment.update" && log.targetId === createdPayment.id && log.after?.reason === `Smoke correction ${stamp}`,
    ),
    "manual payment update audit log missing",
  );

  result = await owner.request(`/api/v1/payments/${createdPayment.id}?selectedBranchId=branch-gangnam`, {
    method: "PATCH",
    body: JSON.stringify({
      amount: 200000,
      discountAmount: 15000,
      dueDate: "2026-06-14",
      expiresAt: "2026-07-14",
      planName: `Smoke Plan Revised ${stamp}`,
      reason: `Smoke status correction ${stamp}`,
      status: "paid",
    }),
  });
  const statusUpdatedManualPayment = result.payload.data.db.payments.find((payment) => payment.id === createdPayment.id);
  assert(statusUpdatedManualPayment?.status === "paid", "manual payment status update must persist the new status");
  assert(
    statusUpdatedManualPayment.statusHistory?.some(
      (entry) => entry.event === "status_changed" && entry.reason.includes(`Smoke status correction ${stamp}`),
    ),
    "manual payment status update must append status history",
  );

  result = await owner.request(
    `/api/v1/payments/${createdPayment.id}/refund?selectedBranchId=branch-missing`,
    {
      method: "POST",
      body: JSON.stringify({}),
    },
    { allowError: true },
  );
  assert(result.response.status === 403, "payment refund must reject an invalid selected branch before validation");

  result = await owner.request(`/api/v1/payments/${createdPayment.id}/refund?selectedBranchId=branch-songpa`, {
    method: "POST",
    body: JSON.stringify({
      amount: 40000,
      reason: `Smoke mismatch refund ${stamp}`,
    }),
  }, { allowError: true });
  assert(result.response.status === 403, "payment refund must reject a selected branch mismatch before validation");
  result = await owner.request("/api/v1/me/bootstrap?selectedBranchId=branch-gangnam");
  assert(
    result.payload.data.db.payments.find((payment) => payment.id === createdPayment.id)?.refundedAmount !== 40000,
    "selected branch mismatch must not refund the payment",
  );

  result = await owner.request(`/api/v1/payments/${createdPayment.id}/refund?selectedBranchId=branch-gangnam`, {
    method: "POST",
    body: JSON.stringify({
      amount: 40000,
      reason: `Smoke partial refund ${stamp}`,
    }),
  });
  const partiallyRefundedPayment = result.payload.data.db.payments.find((payment) => payment.id === createdPayment.id);

  assert(partiallyRefundedPayment?.status === "partially_refunded", "partial refund status did not persist");
  assert(partiallyRefundedPayment.refundedAmount === 40000, "partial refund amount did not persist");
  assert(
    partiallyRefundedPayment.statusHistory?.some(
      (entry) => entry.status === "partially_refunded" && entry.reason === `Smoke partial refund ${stamp}`,
    ),
    "payment refund must append status history",
  );
  assert(
    result.payload.data.db.auditLogs.some((log) => log.action === "payment.refund" && log.after?.refundedAmount === 40000),
    "payment refund audit log missing",
  );

  result = await owner.request(
    `/api/v1/payments/${createdPayment.id}?selectedBranchId=branch-gangnam`,
    {
      method: "DELETE",
      body: JSON.stringify({ reason: `Smoke invalid refunded delete ${stamp}` }),
    },
    { allowError: true },
  );
  assert(result.response.status === 422, "manual payment deletion must block records with refund history");

  result = await owner.request("/api/v1/branches/branch-gangnam/payments?selectedBranchId=branch-gangnam", {
    method: "POST",
    body: JSON.stringify({
      memberId: "member-seo",
      planName: `Smoke Cancel Plan ${stamp}`,
      status: "scheduled",
      amount: 150000,
      dueDate: "2026-06-20",
      expiresAt: "2026-07-20",
    }),
  });
  const cancelPayment = result.payload.data.db.payments.find((payment) => payment.planName === `Smoke Cancel Plan ${stamp}`);

  assert(cancelPayment, "payment create for cancellation did not return created payment");
  result = await owner.request(`/api/v1/payments/${cancelPayment.id}/refund?selectedBranchId=branch-gangnam`, {
    method: "POST",
    body: JSON.stringify({
      cancel: true,
      reason: `Smoke cancellation ${stamp}`,
    }),
  });
  const cancelledPayment = result.payload.data.db.payments.find((payment) => payment.id === cancelPayment.id);
  assert(cancelledPayment?.status === "cancelled", "payment cancellation status did not persist");
  assert(
    cancelledPayment.statusHistory?.some((entry) => entry.status === "cancelled" && entry.reason === `Smoke cancellation ${stamp}`),
    "payment cancellation must append status history",
  );

  result = await owner.request(
    `/api/v1/payments/${cancelPayment.id}?selectedBranchId=branch-gangnam`,
    {
      method: "DELETE",
      body: JSON.stringify({ reason: `Smoke cancelled manual delete ${stamp}` }),
    },
  );
  assert(
    !result.payload.data.db.payments.some((payment) => payment.id === cancelPayment.id),
    "cancelled manual payment deletion must remove the record when no refund amount exists",
  );
  assert(
    result.payload.data.db.auditLogs.some(
      (log) =>
        log.action === "payment.delete" &&
        log.targetId === cancelPayment.id &&
        log.after?.reason === `Smoke cancelled manual delete ${stamp}`,
    ),
    "cancelled manual payment deletion audit log missing",
  );

  result = await owner.request("/api/v1/branches/branch-gangnam/payments?selectedBranchId=branch-gangnam", {
    method: "POST",
    body: JSON.stringify({
      memberId: "member-seo",
      planName: `Smoke Delete Plan ${stamp}`,
      status: "scheduled",
      amount: 140000,
      discountAmount: 0,
      dueDate: "2026-06-22",
      expiresAt: "2026-07-22",
    }),
  });
  const deletePaymentCandidate = result.payload.data.db.payments.find(
    (payment) => payment.planName === `Smoke Delete Plan ${stamp}`,
  );
  assert(deletePaymentCandidate, "payment create for manual deletion did not return created payment");

  result = await coach.request(
    `/api/v1/payments/${deletePaymentCandidate.id}?selectedBranchId=branch-gangnam`,
    {
      method: "DELETE",
      body: JSON.stringify({ reason: `Smoke forbidden delete ${stamp}` }),
    },
    { allowError: true },
  );
  assert(result.response.status === 403, "coach must not delete manual payment records");

  result = await owner.request(
    `/api/v1/payments/${deletePaymentCandidate.id}?selectedBranchId=branch-gangnam`,
    {
      method: "DELETE",
      body: JSON.stringify({ reason: `Smoke duplicate correction ${stamp}` }),
    },
  );
  assert(
    !result.payload.data.db.payments.some((payment) => payment.id === deletePaymentCandidate.id),
    "manual payment deletion must remove the record",
  );
  assert(
    result.payload.data.db.auditLogs.some(
      (log) =>
        log.action === "payment.delete" &&
        log.targetId === deletePaymentCandidate.id &&
        log.after?.reason === `Smoke duplicate correction ${stamp}`,
    ),
    "manual payment deletion audit log missing",
  );

  result = await owner.request("/api/v1/branches/branch-gangnam/payments?selectedBranchId=branch-gangnam", {
    method: "POST",
    body: JSON.stringify({
      memberId: "member-seo",
      planName: `Smoke Online Plan ${stamp}`,
      status: "scheduled",
      amount: 160000,
      discountAmount: 10000,
      dueDate: "2026-06-21",
      expiresAt: "2026-07-21",
    }),
  });
  const onlinePaymentSeed = result.payload.data.db.payments.find((payment) => payment.planName === `Smoke Online Plan ${stamp}`);

  assert(onlinePaymentSeed, "payment create for online checkout did not return created payment");
  result = await owner.request(`/api/v1/payments/${onlinePaymentSeed.id}/online-checkout?selectedBranchId=branch-missing`, {
    method: "POST",
    body: JSON.stringify({}),
  }, { allowError: true });
  assert(result.response.status === 403, "online checkout must reject an invalid selected branch before provider preparation");

  result = await owner.request(`/api/v1/payments/${onlinePaymentSeed.id}/online-checkout?selectedBranchId=branch-songpa`, {
    method: "POST",
    body: JSON.stringify({}),
  }, { allowError: true });
  assert(result.response.status === 403, "online checkout must reject a selected branch mismatch before provider preparation");
  result = await owner.request("/api/v1/me/bootstrap?selectedBranchId=branch-gangnam");
  assert(
    !result.payload.data.db.payments.find((payment) => payment.id === onlinePaymentSeed.id)?.onlinePayment,
    "selected branch mismatch must not create an online checkout",
  );

  result = await owner.request(`/api/v1/payments/${onlinePaymentSeed.id}/online-checkout?selectedBranchId=branch-gangnam`, {
    method: "POST",
    body: JSON.stringify({}),
  });
  const onlineCheckoutPayment = result.payload.data.db.payments.find((payment) => payment.id === onlinePaymentSeed.id);
  const providerPaymentId = onlineCheckoutPayment?.onlinePayment?.providerPaymentId;

  assert(providerPaymentId, "online checkout must persist provider payment id");
  assert(onlineCheckoutPayment.onlinePayment.amount === 150000, "online checkout must persist net charge amount");
  assert(
    result.payload.data.db.auditLogs.some((log) => log.action === "payment.online_checkout.create" && log.targetId === onlinePaymentSeed.id),
    "online checkout audit log missing",
  );
  result = await owner.request(
    `/api/v1/payments/${onlinePaymentSeed.id}?selectedBranchId=branch-gangnam`,
    {
      method: "DELETE",
      body: JSON.stringify({ reason: `Smoke invalid online delete ${stamp}` }),
    },
    { allowError: true },
  );
  assert(result.response.status === 422, "manual payment deletion must block records with online payment history");

  const providerEventId = `evt-paid-${stamp}`;
  const webhookResult = await owner.request("/api/v1/payments/webhook", {
    method: "POST",
    headers: {
      "x-final-judo-payment-webhook-secret": "final-judo-dev-webhook-secret",
    },
    body: JSON.stringify({
      event: "paid",
      providerEventId,
      providerPaymentId,
      receiptId: `receipt-${stamp}`,
      receiptUrl: `https://payments.finaljudo.test/receipts/${stamp}`,
    }),
  });
  const webhookPayment = webhookResult.payload.data.payment;

  assert(webhookPayment?.status === "paid", "payment webhook must mark payment paid");
  assert(webhookPayment.onlinePayment?.status === "paid", "payment webhook must mark online payment paid");
  assert(webhookPayment.onlinePayment?.receipt?.id === `receipt-${stamp}`, "payment webhook must persist receipt");
  assert(
    webhookPayment.onlinePayment?.processedWebhookEventIds?.includes(providerEventId),
    "payment webhook must persist provider event id",
  );
  assert(
    webhookPayment.statusHistory?.some(
      (entry) => entry.event === "webhook" && entry.status === "paid" && entry.providerEventId === providerEventId,
    ),
    "payment webhook must append status history with provider event id",
  );
  result = await owner.request("/api/v1/me/bootstrap?selectedBranchId=branch-gangnam");
  const webhookAuditCount = result.payload.data.db.auditLogs.filter(
    (log) => log.action === "payment.webhook" && log.targetId === onlinePaymentSeed.id,
  ).length;
  assert(
    webhookAuditCount === 1,
    "payment webhook audit log missing",
  );

  const duplicateWebhookResult = await owner.request("/api/v1/payments/webhook", {
    method: "POST",
    headers: {
      "x-final-judo-payment-webhook-secret": "final-judo-dev-webhook-secret",
      "x-final-judo-payment-event-id": providerEventId,
    },
    body: JSON.stringify({
      event: "paid",
      providerPaymentId,
      receiptId: `receipt-${stamp}`,
      receiptUrl: `https://payments.finaljudo.test/receipts/${stamp}`,
    }),
  });
  assert(duplicateWebhookResult.payload.data.duplicate === true, "duplicate provider webhook event must be idempotent");
  assert(
    duplicateWebhookResult.payload.data.payment.statusHistory.length === webhookPayment.statusHistory.length,
    "duplicate provider webhook event must not append status history",
  );
  result = await owner.request("/api/v1/me/bootstrap?selectedBranchId=branch-gangnam");
  assert(
    result.payload.data.db.auditLogs.filter(
      (log) => log.action === "payment.webhook" && log.targetId === onlinePaymentSeed.id,
    ).length === webhookAuditCount,
    "duplicate provider webhook event must not append audit log",
  );

  result = await owner.request(`/api/v1/payments/${onlinePaymentSeed.id}/recurring-agreement?selectedBranchId=branch-missing`, {
    method: "POST",
    body: JSON.stringify({}),
  }, { allowError: true });
  assert(result.response.status === 403, "recurring agreement create must reject an invalid selected branch before validation");

  result = await owner.request(`/api/v1/payments/${onlinePaymentSeed.id}/recurring-agreement?selectedBranchId=branch-songpa`, {
    method: "POST",
    body: JSON.stringify({
      nextBillingDate: "2026-07-22",
    }),
  }, { allowError: true });
  assert(result.response.status === 403, "recurring agreement create must reject a selected branch mismatch before validation");
  result = await owner.request("/api/v1/me/bootstrap?selectedBranchId=branch-gangnam");
  assert(
    !result.payload.data.db.payments.find((payment) => payment.id === onlinePaymentSeed.id)?.recurringAgreement,
    "selected branch mismatch must not create a recurring agreement",
  );

  result = await owner.request(`/api/v1/payments/${onlinePaymentSeed.id}/recurring-agreement?selectedBranchId=branch-gangnam`, {
    method: "POST",
    body: JSON.stringify({
      nextBillingDate: "2026-07-22",
    }),
  });
  const recurringPayment = result.payload.data.db.payments.find((payment) => payment.id === onlinePaymentSeed.id);
  const expectedRecurringStatus = process.env.FINAL_JUDO_PAYMENT_PROVIDER?.trim() ? "pending" : "active";

  assert(
    recurringPayment?.recurringAgreement?.status === expectedRecurringStatus,
    `recurring agreement must be ${expectedRecurringStatus} for the configured provider`,
  );
  assert(recurringPayment.recurringAgreement.nextBillingDate === "2026-07-22", "recurring agreement next billing date missing");
  assert(
    recurringPayment.statusHistory?.some((entry) => entry.event === "recurring_agreement"),
    "recurring agreement must append status history",
  );
  assert(
    result.payload.data.db.auditLogs.some(
      (log) => log.action === "payment.recurring_agreement.create" && log.targetId === onlinePaymentSeed.id,
    ),
    "recurring agreement create audit log missing",
  );

  result = await owner.request(`/api/v1/payments/${onlinePaymentSeed.id}/recurring-agreement?selectedBranchId=branch-missing`, {
    method: "DELETE",
    body: JSON.stringify({}),
  }, { allowError: true });
  assert(result.response.status === 403, "recurring agreement cancel must reject an invalid selected branch before validation");

  result = await owner.request(`/api/v1/payments/${onlinePaymentSeed.id}/recurring-agreement?selectedBranchId=branch-songpa`, {
    method: "DELETE",
    body: JSON.stringify({
      reason: `Smoke recurring mismatch cancellation ${stamp}`,
    }),
  }, { allowError: true });
  assert(result.response.status === 403, "recurring agreement cancel must reject a selected branch mismatch before validation");
  result = await owner.request("/api/v1/me/bootstrap?selectedBranchId=branch-gangnam");
  assert(
    result.payload.data.db.payments.find((payment) => payment.id === onlinePaymentSeed.id)?.recurringAgreement?.status ===
      expectedRecurringStatus,
    "selected branch mismatch must not cancel the recurring agreement",
  );

  result = await owner.request(`/api/v1/payments/${onlinePaymentSeed.id}/recurring-agreement?selectedBranchId=branch-gangnam`, {
    method: "DELETE",
    body: JSON.stringify({
      reason: `Smoke recurring cancellation ${stamp}`,
    }),
  });
  const cancelledRecurringPayment = result.payload.data.db.payments.find((payment) => payment.id === onlinePaymentSeed.id);

  assert(cancelledRecurringPayment?.recurringAgreement?.status === "cancelled", "recurring agreement cancellation did not persist");
  assert(
    cancelledRecurringPayment.recurringAgreement.cancelReason === `Smoke recurring cancellation ${stamp}`,
    "recurring agreement cancellation reason missing",
  );
  assert(
    result.payload.data.db.auditLogs.some(
      (log) => log.action === "payment.recurring_agreement.cancel" && log.targetId === onlinePaymentSeed.id,
    ),
    "recurring agreement cancel audit log missing",
  );

  const coachAfterOnlinePayment = await coach.request("/api/v1/me/bootstrap?selectedBranchId=branch-gangnam");
  assert.equal(
    coachAfterOnlinePayment.payload.data.db.payments.length,
    0,
    "coach bootstrap must not include online payment or recurring agreement records",
  );

  const exportResult = await owner.request(
    "/api/v1/exports/payments?selectedBranchId=branch-gangnam",
    {},
    { responseType: "text" },
  );
  const exportedCsv = exportResult.payload;

  assert(exportResult.response.headers.get("content-type")?.includes("text/csv"), "payment export must return CSV");
  assert(
    exportedCsv.includes("branch,member,plan,status,amount_krw,discount_krw,refunded_krw,refund_reason,due_date,expires_at,status_history_count,last_status_changed_at,last_status_reason,online_payment_status,online_provider_payment_id,online_requested_at,online_paid_at,receipt_id,receipt_url,recurring_status,recurring_provider_agreement_id,recurring_next_billing_date,recurring_cancelled_at,recurring_cancel_reason"),
    "payment export CSV header missing",
  );

  const operationsExportResult = await owner.request(
    "/api/v1/exports/operations?selectedBranchId=branch-gangnam",
    {},
    { responseType: "text" },
  );
  const exportedOperationsCsv = operationsExportResult.payload;

  assert(operationsExportResult.response.headers.get("content-type")?.includes("text/csv"), "operations export must return CSV");
  assert(
    exportedOperationsCsv.includes("branch,district,status,active_members,trial_members,paused_members,withdrawn_members,classes,enrolled_slots,attendance_records,attendance_rate_percent,attendance_gap_slots,paid_revenue_krw,overdue_payments,expiring_payments,payment_risk_count,payment_risk_krw,pilot_priority_score"),
    "operations export CSV header missing",
  );
  assert(
    exportedOperationsCsv.includes("trend_period,period_label,classes,enrolled_slots,attendance_records,attendance_rate_percent,paid_revenue_krw,payment_risk_count,new_members,withdrawn_members,net_member_change,member_change_events"),
    "operations export trend CSV header missing",
  );
  assert(exportedOperationsCsv.includes("강남 본관"), "operations export must include scoped branch row");
  await assertCsvExportRejectsInvalidBranch(owner, "owner");
  result = await owner.request("/api/v1/me/bootstrap?selectedBranchId=branch-gangnam");
  assert(
    result.payload.data.db.auditLogs.some((log) => log.action === "export.create" && log.after?.type === "operations"),
    "operations export audit log missing",
  );

  result = await owner.request("/api/v1/branches/branch-gangnam/notices?selectedBranchId=branch-missing", {
    method: "POST",
    body: JSON.stringify({}),
  }, { allowError: true });
  assert(result.response.status === 403, "notice create must reject an invalid selected branch before validation");

  const mismatchNoticeTitle = `Smoke Notice Mismatch ${stamp}`;
  result = await owner.request(
    "/api/v1/branches/branch-gangnam/notices?selectedBranchId=branch-songpa",
    {
      method: "POST",
      body: JSON.stringify({
        title: mismatchNoticeTitle,
        body: "Smoke mismatch notice body",
        audience: ["all"],
      }),
    },
    { allowError: true },
  );
  assert(result.response.status === 403, "notice create must reject a selected branch mismatch before validation");
  result = await owner.request("/api/v1/me/bootstrap?selectedBranchId=branch-gangnam");
  assert(
    !result.payload.data.db.notices.some((notice) => notice.title === mismatchNoticeTitle),
    "selected branch mismatch must not create the notice",
  );

  result = await owner.request("/api/v1/branches/branch-gangnam/notices?selectedBranchId=branch-gangnam", {
    method: "POST",
    body: JSON.stringify({
      title: `Smoke Notice ${stamp}`,
      body: "Smoke notice body",
      important: true,
      audience: ["all"],
    }),
  });
  const createdNotice = result.payload.data.db.notices.find((notice) => notice.title === `Smoke Notice ${stamp}`);

  assert(createdNotice, "notice create did not return created notice");
  assert(createdNotice.important === true, "important notice flag did not persist");
  assertNoticeCreateDeliveryFeedback(result.payload.data, 1, "important all-audience");
  assert(
    result.payload.data.db.auditLogs.some((log) => log.action === "notice.create" && log.after?.important === true),
    "important notice audit flag missing",
  );

  result = await owner.request(
    `/api/v1/me/notices/${createdNotice.id}/read?selectedBranchId=branch-missing`,
    {
      method: "POST",
      body: JSON.stringify({}),
    },
    { allowError: true },
  );
  assert(result.response.status === 403, "notice read must reject an invalid selected branch");

  result = await owner.request(`/api/v1/me/notices/${createdNotice.id}/read?selectedBranchId=branch-gangnam`, {
    method: "POST",
    body: JSON.stringify({}),
  });
  assert(
    result.payload.data.db.notices.find((notice) => notice.id === createdNotice.id)?.readByUserIds.includes("user-owner"),
    "notice read did not persist",
  );

  result = await owner.request("/api/v1/notifications/push-config");
  assert(typeof result.payload.data.configured === "boolean", "push config did not return configured state");
  const pushConfigured = result.payload.data.configured;

  const pushEndpoint = `https://push.example.test/${stamp}`;
  result = await owner.request("/api/v1/notifications/subscriptions", {
    method: "POST",
    body: JSON.stringify({
      subscription: {
        endpoint: pushEndpoint,
        keys: {
          auth: "smoke-auth-key",
          p256dh: "smoke-p256dh-key",
        },
      },
      userAgent: "smoke-api",
    }),
  });
  assert(result.payload.data.activeSubscriptionCount >= 1, "push subscription did not persist");
  assert(
    result.payload.data.subscription.endpointHint.endsWith(String(stamp)),
    "push subscription response must mask endpoint with a stable hint",
  );

  result = await owner.request(
    `/api/v1/branches/branch-gangnam/notices/${createdNotice.id}/push?selectedBranchId=branch-missing`,
    {
      method: "POST",
      body: JSON.stringify({}),
    },
    { allowError: true },
  );
  assert(result.response.status === 403, "notice push must reject an invalid selected branch before dispatch");

  result = await owner.request("/api/v1/me/bootstrap?selectedBranchId=branch-gangnam");
  const dispatchLogCountBeforeMismatch = result.payload.data.db.auditLogs.length;
  result = await owner.request(
    `/api/v1/branches/branch-gangnam/notices/${createdNotice.id}/push?selectedBranchId=branch-songpa`,
    {
      method: "POST",
      body: JSON.stringify({}),
    },
    { allowError: true },
  );
  assert(result.response.status === 403, "notice push must reject a selected branch mismatch before dispatch");
  result = await owner.request("/api/v1/me/bootstrap?selectedBranchId=branch-gangnam");
  assert(
    result.payload.data.db.auditLogs.length === dispatchLogCountBeforeMismatch,
    "selected branch mismatch must not append a notice push dispatch audit log",
  );

  if (!pushConfigured) {
    result = await owner.request(`/api/v1/branches/branch-gangnam/notices/${createdNotice.id}/push?selectedBranchId=branch-gangnam`, {
      method: "POST",
      body: JSON.stringify({}),
    });
    assert(result.payload.data.push.configured === false, "notice push dispatch must expose missing VAPID configuration");
    assert.equal(result.payload.data.push.attempted, 0, "missing VAPID must not count a provider delivery attempt");
    const blockedDispatchAudit = result.payload.data.db.auditLogs.find(
      (log) => log.action === "notification.dispatch" && log.targetId === createdNotice.id && log.result === "blocked",
    );
    assert(blockedDispatchAudit, "notice push dispatch must audit missing VAPID state");
    assert(
      Number(blockedDispatchAudit.after?.candidateCount ?? 0) >= 1,
      "notice push dispatch audit must preserve the target subscription count",
    );
  }

  result = await owner.request("/api/v1/notifications/subscriptions", {
    method: "DELETE",
    body: JSON.stringify({ endpoint: pushEndpoint }),
  });
  assert(result.payload.data.subscription.disabledAt, "push unsubscribe did not mark subscription disabled");

  result = await owner.request(
    `/api/v1/branches/branch-gangnam/notices/${createdNotice.id}?selectedBranchId=branch-missing`,
    {
      method: "DELETE",
      body: JSON.stringify({}),
    },
    { allowError: true },
  );
  assert(result.response.status === 403, "notice delete must reject an invalid selected branch before deletion");

  result = await owner.request(
    `/api/v1/branches/branch-gangnam/notices/${createdNotice.id}?selectedBranchId=branch-songpa`,
    {
      method: "DELETE",
      body: JSON.stringify({}),
    },
    { allowError: true },
  );
  assert(result.response.status === 403, "notice delete must reject a selected branch mismatch before deletion");
  result = await owner.request("/api/v1/me/bootstrap?selectedBranchId=branch-gangnam");
  assert(
    result.payload.data.db.notices.some((notice) => notice.id === createdNotice.id),
    "selected branch mismatch must not delete the notice",
  );

  result = await memberClient.request(
    `/api/v1/branches/branch-gangnam/notices/${createdNotice.id}?selectedBranchId=branch-gangnam`,
    {
      method: "DELETE",
      body: JSON.stringify({}),
    },
    { allowError: true },
  );
  assert(result.response.status === 403, "member must not delete notices");

  result = await coach.request(
    `/api/v1/branches/branch-gangnam/notices/${createdNotice.id}?selectedBranchId=branch-gangnam`,
    {
      method: "DELETE",
      body: JSON.stringify({}),
    },
    { allowError: true },
  );
  assert(result.response.status === 403, "coach must not delete notices created by another publisher");

  result = await owner.request(`/api/v1/branches/branch-gangnam/notices/${createdNotice.id}?selectedBranchId=branch-gangnam`, {
    method: "DELETE",
    body: JSON.stringify({}),
  });
  assert.equal(result.payload.data.notice?.id, createdNotice.id, "notice delete response must identify deleted notice");
  assert(
    !result.payload.data.db.notices.some((notice) => notice.id === createdNotice.id),
    "notice delete did not remove the notice",
  );
  result = await memberClient.request("/api/v1/me/bootstrap?selectedBranchId=branch-gangnam");
  assert(
    !result.payload.data.db.notices.some((notice) => notice.id === createdNotice.id),
    "notice delete must remove the notice from member bootstrap",
  );
  result = await guardianAfterLink.request("/api/v1/me/bootstrap?selectedBranchId=branch-gangnam");
  assert(
    !result.payload.data.db.notices.some((notice) => notice.id === createdNotice.id),
    "notice delete must remove the notice from guardian bootstrap",
  );
  result = await owner.request("/api/v1/me/bootstrap?selectedBranchId=branch-gangnam");
  assert(
    result.payload.data.db.auditLogs.some((log) => log.action === "notice.delete" && log.targetId === createdNotice.id),
    "notice delete audit log missing",
  );

  result = await guardianAfterLink.request("/api/v1/me/bootstrap?selectedBranchId=branch-gangnam");
  const guardianClassUnreadBefore = getUnreadNoticeCount(result.payload.data);
  result = await memberClient.request("/api/v1/me/bootstrap?selectedBranchId=branch-gangnam");
  const memberClassUnreadBefore = getUnreadNoticeCount(result.payload.data);

  const classNoticeTitle = `Smoke Class Notice ${stamp}`;
  result = await owner.request("/api/v1/branches/branch-gangnam/notices?selectedBranchId=branch-gangnam", {
    method: "POST",
    body: JSON.stringify({
      title: classNoticeTitle,
      body: "Smoke class notice body",
      audience: ["guardian"],
      targetClassIds: ["class-kids-am"],
    }),
  });
  const classNotice = result.payload.data.db.notices.find((notice) => notice.title === classNoticeTitle);

  assert(classNotice?.targetClassIds?.includes("class-kids-am"), "class-targeted notice did not persist target class");
  assertNoticeCreateDeliveryFeedback(result.payload.data, 1, "class-targeted guardian");
  assert(
    result.payload.data.db.auditLogs.some(
      (log) => log.action === "notice.create" && Array.isArray(log.after?.targetClassIds) && log.after.targetClassIds.includes("class-kids-am"),
    ),
    "class-targeted notice audit target missing",
  );

  result = await guardianAfterLink.request("/api/v1/me/bootstrap?selectedBranchId=branch-gangnam");
  assertUnreadNoticeCountIncreased(
    guardianClassUnreadBefore,
    result.payload.data,
    classNoticeTitle,
    "guardian class-targeted child",
  );

  result = await memberClient.request("/api/v1/me/bootstrap?selectedBranchId=branch-gangnam");
  assert(
    !result.payload.data.db.notices.some((notice) => notice.title === classNoticeTitle),
    "unrelated member must not see guardian class-targeted notice",
  );
  assert.equal(
    getUnreadNoticeCount(result.payload.data),
    memberClassUnreadBefore,
    "unrelated member unread notice count must not change for guardian class-targeted notice",
  );

  const guardianMemberNoticeUnreadBefore = getUnreadNoticeCount(
    (await guardianAfterLink.request("/api/v1/me/bootstrap?selectedBranchId=branch-gangnam")).payload.data,
  );
  const memberNoticeUnreadBefore = getUnreadNoticeCount(result.payload.data);
  const memberNoticeTitle = `Smoke Member Notice ${stamp}`;
  result = await owner.request("/api/v1/branches/branch-gangnam/notices?selectedBranchId=branch-gangnam", {
    method: "POST",
    body: JSON.stringify({
      title: memberNoticeTitle,
      body: "Smoke member notice body",
      audience: ["member"],
      targetMemberIds: ["member-minjae"],
    }),
  });
  const memberNotice = result.payload.data.db.notices.find((notice) => notice.title === memberNoticeTitle);

  assert(memberNotice?.targetMemberIds?.includes("member-minjae"), "member-targeted notice did not persist target member");
  assertNoticeCreateDeliveryFeedback(result.payload.data, 1, "personal member-targeted");
  result = await memberClient.request("/api/v1/me/bootstrap?selectedBranchId=branch-gangnam");
  assertUnreadNoticeCountIncreased(
    memberNoticeUnreadBefore,
    result.payload.data,
    memberNoticeTitle,
    "member personal target",
  );
  result = await guardianAfterLink.request("/api/v1/me/bootstrap?selectedBranchId=branch-gangnam");
  assert(
    !result.payload.data.db.notices.some((notice) => notice.title === memberNoticeTitle),
    "guardian must not see member-targeted notice for another member",
  );
  assert.equal(
    getUnreadNoticeCount(result.payload.data),
    guardianMemberNoticeUnreadBefore,
    "guardian unread notice count must not change for another member personal notice",
  );
  const blockedMemberNoticeBulkRead = await guardianAfterLink.request(
    "/api/v1/me/notices/bulk-read?selectedBranchId=branch-gangnam",
    {
      method: "POST",
      body: JSON.stringify({ noticeIds: [memberNotice.id] }),
    },
    { allowError: true },
  );
  assert(blockedMemberNoticeBulkRead.response.status === 403, "guardian must not bulk-read another member notice");
  result = await memberClient.request(
    "/api/v1/me/notices/bulk-read?selectedBranchId=branch-missing",
    {
      method: "POST",
      body: JSON.stringify({ noticeIds: [memberNotice.id] }),
    },
    { allowError: true },
  );
  assert(result.response.status === 403, "notice bulk read must reject an invalid selected branch");

  result = await memberClient.request("/api/v1/me/notices/bulk-read?selectedBranchId=branch-gangnam", {
    method: "POST",
    body: JSON.stringify({ noticeIds: [memberNotice.id] }),
  });
  assert(result.payload.data.bulkRead?.updated === 1, "member-targeted notice bulk read did not update one notice");
  assert(
    result.payload.data.db.notices.find((notice) => notice.id === memberNotice.id)?.readByUserIds.includes("user-member"),
    "member-targeted notice bulk read did not persist",
  );
  assert.equal(
    getUnreadNoticeCount(result.payload.data),
    memberNoticeUnreadBefore,
    "member-targeted notice bulk read must remove that notice from the unread count",
  );

  result = await owner.request("/api/v1/members/member-minjae/guardians?selectedBranchId=branch-gangnam", {
    method: "POST",
    body: JSON.stringify({
      guardianUserId: "user-guardian",
    }),
  });
  assert(
    result.payload.data.db.members.find((member) => member.id === "member-minjae")?.guardianIds.includes("user-guardian"),
    "family notice setup did not link guardian to the member account",
  );

  result = await guardianAfterLink.request("/api/v1/me/bootstrap?selectedBranchId=branch-gangnam");
  const familyGuardianNoticeUnreadBefore = getUnreadNoticeCount(result.payload.data);
  result = await memberClient.request("/api/v1/me/bootstrap?selectedBranchId=branch-gangnam");
  const familyMemberNoticeUnreadBefore = getUnreadNoticeCount(result.payload.data);

  const familyPersonalNoticeTitle = `Smoke Family Personal Notice ${stamp}`;
  result = await owner.request("/api/v1/branches/branch-gangnam/notices?selectedBranchId=branch-gangnam", {
    method: "POST",
    body: JSON.stringify({
      title: familyPersonalNoticeTitle,
      body: "Smoke family personal notice body",
      audience: ["member", "guardian"],
      targetMemberIds: ["member-minjae"],
    }),
  });
  const familyPersonalNotice = result.payload.data.db.notices.find((notice) => notice.title === familyPersonalNoticeTitle);

  assert(familyPersonalNotice?.targetMemberIds?.includes("member-minjae"), "member+guardian personal notice did not persist target member");
  assertNoticeCreateDeliveryFeedback(result.payload.data, 2, "member+guardian personal notice");
  assert(
    result.payload.data.push.recipientCount >= 2,
    "member+guardian personal notice must count both family recipients in the app inbox",
  );

  result = await guardianAfterLink.request("/api/v1/me/bootstrap?selectedBranchId=branch-gangnam");
  assertUnreadNoticeCountIncreased(
    familyGuardianNoticeUnreadBefore,
    result.payload.data,
    familyPersonalNoticeTitle,
    "guardian member+guardian personal target",
  );

  result = await memberClient.request("/api/v1/me/bootstrap?selectedBranchId=branch-gangnam");
  assertUnreadNoticeCountIncreased(
    familyMemberNoticeUnreadBefore,
    result.payload.data,
    familyPersonalNoticeTitle,
    "member member+guardian personal target",
  );

  result = await guardianAfterLink.request("/api/v1/me/notices/bulk-read?selectedBranchId=branch-gangnam", {
    method: "POST",
    body: JSON.stringify({ noticeIds: [familyPersonalNotice.id] }),
  });
  assert(result.payload.data.bulkRead?.updated === 1, "guardian family personal notice bulk read did not update one notice");
  assert(
    result.payload.data.db.notices.find((notice) => notice.id === familyPersonalNotice.id)?.readByUserIds.includes("user-guardian"),
    "guardian family personal notice read did not persist",
  );
  assert.equal(
    getUnreadNoticeCount(result.payload.data),
    familyGuardianNoticeUnreadBefore,
    "guardian family personal notice read must remove that notice from the unread count",
  );

  result = await memberClient.request("/api/v1/me/bootstrap?selectedBranchId=branch-gangnam");
  assertUnreadNoticeCountIncreased(
    familyMemberNoticeUnreadBefore,
    result.payload.data,
    familyPersonalNoticeTitle,
    "member family personal target must remain unread until member confirms",
  );

  result = await memberClient.request("/api/v1/me/notices/bulk-read?selectedBranchId=branch-gangnam", {
    method: "POST",
    body: JSON.stringify({ noticeIds: [familyPersonalNotice.id] }),
  });
  assert(result.payload.data.bulkRead?.updated === 1, "member family personal notice bulk read did not update one notice");
  assert(
    result.payload.data.db.notices.find((notice) => notice.id === familyPersonalNotice.id)?.readByUserIds.includes("user-member"),
    "member family personal notice read did not persist independently from guardian read",
  );
  assert.equal(
    getUnreadNoticeCount(result.payload.data),
    familyMemberNoticeUnreadBefore,
    "member family personal notice read must remove that notice from the unread count",
  );

  result = await guardianAfterLink.request("/api/v1/me/bootstrap?selectedBranchId=branch-gangnam");
  const guardianCoachPersonalUnreadBefore = getUnreadNoticeCount(result.payload.data);
  result = await memberClient.request("/api/v1/me/bootstrap?selectedBranchId=branch-gangnam");
  const memberCoachPersonalUnreadBefore = getUnreadNoticeCount(result.payload.data);

  const coachPersonalNoticeTitle = `Smoke Coach Personal Notice ${stamp}`;
  result = await coach.request("/api/v1/branches/branch-gangnam/notices?selectedBranchId=branch-gangnam", {
    method: "POST",
    body: JSON.stringify({
      title: coachPersonalNoticeTitle,
      body: "Smoke coach personal notice body",
      audience: ["member", "guardian"],
      targetMemberIds: ["member-jun"],
    }),
  });
  const coachPersonalNotice = result.payload.data.db.notices.find((notice) => notice.title === coachPersonalNoticeTitle);

  assert(coachPersonalNotice, "coach personal notice create did not return created notice");
  assert.deepEqual(coachPersonalNotice.targetMemberIds, ["member-jun"], "coach personal notice must persist exactly one searched member target");
  assertNoticeCreateDeliveryFeedback(result.payload.data, 1, "coach personal searched-member");
  assert(
    result.payload.data.db.auditLogs.some(
      (log) =>
        log.action === "notice.create" &&
        log.after?.createdByUserId === "user-coach" &&
        Array.isArray(log.after?.targetMemberIds) &&
        log.after.targetMemberIds.length === 1 &&
        log.after.targetMemberIds.includes("member-jun"),
    ),
    "coach personal notice audit target must stay limited to the searched member",
  );

  result = await guardianAfterLink.request("/api/v1/me/bootstrap?selectedBranchId=branch-gangnam");
  assertUnreadNoticeCountIncreased(
    guardianCoachPersonalUnreadBefore,
    result.payload.data,
    coachPersonalNoticeTitle,
    "guardian coach personal child",
  );

  result = await memberClient.request("/api/v1/me/bootstrap?selectedBranchId=branch-gangnam");
  assert(
    !result.payload.data.db.notices.some((notice) => notice.title === coachPersonalNoticeTitle),
    "unrelated adult member must not see coach personal notice for another member",
  );
  assert.equal(
    getUnreadNoticeCount(result.payload.data),
    memberCoachPersonalUnreadBefore,
    "unrelated adult member unread notice count must not change for coach personal notice",
  );

  result = await guardianAfterLink.request("/api/v1/me/bootstrap?selectedBranchId=branch-gangnam");
  const guardianCoachBranchUnreadBefore = getUnreadNoticeCount(result.payload.data);
  result = await memberClient.request("/api/v1/me/bootstrap?selectedBranchId=branch-gangnam");
  const memberCoachBranchUnreadBefore = getUnreadNoticeCount(result.payload.data);

  const coachNoticeTitle = `Smoke Coach Notice ${stamp}`;
  result = await coach.request("/api/v1/branches/branch-gangnam/notices?selectedBranchId=branch-gangnam", {
    method: "POST",
    body: JSON.stringify({
      title: coachNoticeTitle,
      body: "Smoke coach notice body",
      audience: ["member", "guardian"],
    }),
  });
  const coachNotice = result.payload.data.db.notices.find((notice) => notice.title === coachNoticeTitle);

  assert(coachNotice, "coach notice create did not return created notice");
  assert(coachNotice.createdByUserId === "user-coach", "coach notice must persist creator metadata");
  assert(coachNotice.targetMemberIds?.includes("member-jun"), "coach notice must target coached youth member");
  assert(coachNotice.targetMemberIds?.includes("member-minjae"), "coach notice must target coached adult member");
  assertNoticeCreateDeliveryFeedback(result.payload.data, 2, "coach assigned-members");

  result = await guardianAfterLink.request("/api/v1/me/bootstrap?selectedBranchId=branch-gangnam");
  assertUnreadNoticeCountIncreased(
    guardianCoachBranchUnreadBefore,
    result.payload.data,
    coachNoticeTitle,
    "guardian coach assigned child",
  );

  result = await memberClient.request("/api/v1/me/bootstrap?selectedBranchId=branch-gangnam");
  assertUnreadNoticeCountIncreased(
    memberCoachBranchUnreadBefore,
    result.payload.data,
    coachNoticeTitle,
    "member coach assigned self",
  );

  result = await coach.request(`/api/v1/branches/branch-gangnam/notices/${coachNotice.id}/push?selectedBranchId=branch-gangnam`, {
    method: "POST",
    body: JSON.stringify({}),
  });
  assert(result.payload.data.push.recipientCount >= 2, "coach notice push feedback must count family app inbox recipients");
  assert(result.payload.data.push.message.includes("알림함"), "coach notice push feedback must clarify app inbox delivery");

  result = await coach.request(`/api/v1/branches/branch-gangnam/notices/${coachNotice.id}?selectedBranchId=branch-gangnam`, {
    method: "DELETE",
    body: JSON.stringify({}),
  });
  assert.equal(result.payload.data.notice?.id, coachNotice.id, "coach notice delete response must identify deleted own notice");
  assert(
    !result.payload.data.db.notices.some((notice) => notice.id === coachNotice.id),
    "coach notice delete must remove the coach-owned notice",
  );
  assert(
    result.payload.data.db.auditLogs.some(
      (log) => log.action === "notice.delete" && log.targetId === coachNotice.id && log.actorUserId === "user-coach",
    ),
    "coach notice delete audit log missing",
  );

  const admin = createClient();
  await login(admin, "admin");
  const invalidAdminBranchCreate = await admin.request(
    "/api/v1/admin/branches?selectedBranchId=branch-missing",
    {
      method: "POST",
      body: JSON.stringify({}),
    },
    { allowError: true },
  );
  assert(invalidAdminBranchCreate.response.status === 403, "admin branch create must reject invalid selectedBranchId");

  result = await admin.request("/api/v1/admin/branches", {
    method: "POST",
    body: JSON.stringify({
      name: `Smoke Branch ${stamp}`,
      district: "테스트 구역",
      ownerUserId: "user-owner",
    }),
  });
  const createdBranch = result.payload.data.db.branches.find((branch) => branch.name === `Smoke Branch ${stamp}`);

  assert(createdBranch, "branch create did not return created branch");
  assert(
    result.payload.data.db.users.find((user) => user.id === "user-owner")?.branchIds.includes(createdBranch.id),
    "branch owner assignment did not attach owner to branch",
  );

  const invalidAdminBranchUpdate = await admin.request(
    `/api/v1/admin/branches/${createdBranch.id}?selectedBranchId=branch-missing`,
    {
      method: "PATCH",
      body: JSON.stringify({}),
    },
    { allowError: true },
  );
  assert(invalidAdminBranchUpdate.response.status === 403, "admin branch update must reject invalid selectedBranchId");

  const mismatchAdminBranchName = `Smoke Branch Mismatch ${stamp}`;
  const mismatchAdminBranchUpdate = await admin.request(
    `/api/v1/admin/branches/${createdBranch.id}?selectedBranchId=branch-gangnam`,
    {
      method: "PATCH",
      body: JSON.stringify({
        name: mismatchAdminBranchName,
        district: "테스트 불일치",
        reason: `Smoke branch mismatch ${stamp}`,
      }),
    },
    { allowError: true },
  );
  assert(mismatchAdminBranchUpdate.response.status === 403, "admin branch update must reject a selected branch mismatch");
  result = await admin.request("/api/v1/me/bootstrap");
  assert(
    !result.payload.data.db.branches.some((branch) => branch.id === createdBranch.id && branch.name === mismatchAdminBranchName),
    "selected branch mismatch must not update the admin branch",
  );

  result = await admin.request(`/api/v1/admin/branches/${createdBranch.id}`, {
    method: "PATCH",
    body: JSON.stringify({
      name: `Smoke Branch Updated ${stamp}`,
      district: "테스트 수정",
      status: "inactive",
      timezone: "Asia/Seoul",
      settings: {
        attendanceEditRequiresReason: true,
      },
      reason: `Smoke branch settings ${stamp}`,
    }),
  });
  const updatedBranch = result.payload.data.db.branches.find((branch) => branch.id === createdBranch.id);

  assert(updatedBranch?.name === `Smoke Branch Updated ${stamp}`, "branch update did not persist name");
  assert(updatedBranch?.status === "inactive", "branch update did not persist inactive status");
  assert(updatedBranch?.settings?.attendanceEditRequiresReason === true, "branch update did not persist settings");

  const invalidAdminBranchOwnerAssign = await admin.request(
    `/api/v1/admin/branches/${createdBranch.id}/owner?selectedBranchId=branch-missing`,
    {
      method: "PUT",
      body: JSON.stringify({}),
    },
    { allowError: true },
  );
  assert(
    invalidAdminBranchOwnerAssign.response.status === 403,
    "admin branch owner assignment must reject invalid selectedBranchId",
  );

  result = await admin.request("/api/v1/me/bootstrap");
  const ownerAssignAuditCountBeforeMismatch = result.payload.data.db.auditLogs.filter(
    (log) => log.action === "branch.owner.assign" && log.targetId === createdBranch.id,
  ).length;
  const mismatchAdminBranchOwnerAssign = await admin.request(
    `/api/v1/admin/branches/${createdBranch.id}/owner?selectedBranchId=branch-gangnam`,
    {
      method: "PUT",
      body: JSON.stringify({ ownerUserId: "user-owner" }),
    },
    { allowError: true },
  );
  assert(
    mismatchAdminBranchOwnerAssign.response.status === 403,
    "admin branch owner assignment must reject a selected branch mismatch",
  );
  result = await admin.request("/api/v1/me/bootstrap");
  assert(
    result.payload.data.db.auditLogs.filter((log) => log.action === "branch.owner.assign" && log.targetId === createdBranch.id)
      .length === ownerAssignAuditCountBeforeMismatch,
    "selected branch mismatch must not assign the branch owner",
  );

  result = await admin.request(`/api/v1/admin/branches/${createdBranch.id}/owner`, {
    method: "PUT",
    body: JSON.stringify({ ownerUserId: "user-owner" }),
  });
  assert(
    result.payload.data.db.users.find((user) => user.id === "user-owner")?.branchIds.includes(createdBranch.id),
    "branch owner reassignment did not persist",
  );

  const invalidAdminInvitation = await admin.request(
    "/api/v1/admin/users/invitations?selectedBranchId=branch-missing",
    {
      method: "POST",
      body: JSON.stringify({}),
    },
    { allowError: true },
  );
  assert(invalidAdminInvitation.response.status === 403, "admin invitation create must reject invalid selectedBranchId");

  const mismatchInvitationEmail = `smoke-invite-mismatch-${stamp}@example.com`;
  const mismatchAdminInvitation = await admin.request(
    "/api/v1/admin/users/invitations?selectedBranchId=branch-gangnam",
    {
      method: "POST",
      body: JSON.stringify({
        name: `Smoke Invite Mismatch ${stamp}`,
        email: mismatchInvitationEmail,
        phone: createSmokePhone(21),
        role: "coach",
        branchIds: ["branch-songpa"],
      }),
    },
    { allowError: true },
  );
  assert(mismatchAdminInvitation.response.status === 403, "admin invitation create must reject a selected branch mismatch");
  result = await admin.request("/api/v1/me/bootstrap");
  assert(
    !result.payload.data.db.users.some((user) => user.email === mismatchInvitationEmail),
    "selected branch mismatch must not create the invitation",
  );

  result = await admin.request("/api/v1/admin/users/invitations", {
    method: "POST",
    body: JSON.stringify({
      name: `Smoke Invite ${stamp}`,
      email: `smoke-invite-${stamp}@example.com`,
      phone: createSmokePhone(20),
      role: "coach",
      branchIds: ["branch-gangnam"],
    }),
  });
  const invitedUser = result.payload.data.db.users.find((user) => user.email === `smoke-invite-${stamp}@example.com`);
  const invitation = result.payload.data.invitation;

  assert(invitedUser?.invitationStatus === "pending", "invitation create did not return pending user");
  assert(invitation?.token && invitation.path === `/invite/${invitation.token}`, "invitation payload missing token path");

  result = await anonymous.request("/api/v1/auth/password-reset", {
    method: "POST",
    body: JSON.stringify({ identifier: `smoke-invite-${stamp}@example.com` }),
  });
  assert(result.payload.data.ok === true, "password reset request must return ok");

  const invitee = createClient();
  result = await invitee.request(
    `/api/v1/auth/invitations/${invitation.token}/accept`,
    {
      method: "POST",
      body: JSON.stringify({}),
    },
    { allowError: true },
  );
  assert(result.response.status === 400, "invitation accept must require an initial password");

  result = await invitee.request(
    `/api/v1/auth/invitations/${invitation.token}/accept`,
    {
      method: "POST",
      body: JSON.stringify({ password: defaultPilotPassword }),
    },
    { allowError: true },
  );
  assert(result.response.status === 422, "invitation accept must block the default pilot password");

  const invitePassword = `FJ-Invite-${stamp}!`;
  result = await invitee.request(`/api/v1/auth/invitations/${invitation.token}/accept`, {
    method: "POST",
    body: JSON.stringify({ password: invitePassword }),
  });
  assert(result.payload.data.user.id === invitedUser.id, "invitation accept must sign in invited user");
  assert(result.payload.data.user.invitationStatus === "accepted", "invitation accept did not persist accepted status");
  assert(!result.payload.data.user.passwordHash, "invitation accept must not expose password hash");
  assert(
    !result.payload.data.user.invitationToken &&
      !result.payload.data.user.invitedAt &&
      !result.payload.data.user.acceptedAt &&
      !result.payload.data.user.passwordResetRequestedAt &&
      !result.payload.data.user.passwordUpdatedAt,
    "invitation accept user payload must not expose account operation fields",
  );
  assert(
    result.payload.data.db.auditLogs.some(
      (log) =>
        log.action === "auth.invite.accept" &&
        log.targetId === invitedUser.id &&
        log.after?.passwordSet === true &&
        !("password" in log.after),
    ),
    "invitation accept audit log missing passwordSet marker or leaked password",
  );

  const acceptedLogin = createClient();
  const acceptedBootstrap = await loginWithCredentials(acceptedLogin, invitedUser.email, invitePassword);
  assert(acceptedBootstrap.user.id === invitedUser.id, "invited user must log in with invite-time password");

  result = await createClient().request(
    `/api/v1/auth/invitations/${invitation.token}/accept`,
    {
      method: "POST",
      body: JSON.stringify({ password: `FJ-Reuse-${stamp}!` }),
    },
    { allowError: true },
  );
  assert(result.response.status === 409, "accepted invitation token must not create a new login session");

  const invalidAdminInvitationApprove = await admin.request(
    `/api/v1/admin/users/${invitedUser.id}/approve-invitation?selectedBranchId=branch-missing`,
    {
      method: "POST",
    },
    { allowError: true },
  );
  assert(invalidAdminInvitationApprove.response.status === 403, "admin invitation approval must reject invalid selectedBranchId");

  const mismatchAdminInvitationApprove = await admin.request(
    `/api/v1/admin/users/${invitedUser.id}/approve-invitation?selectedBranchId=branch-songpa`,
    {
      method: "POST",
    },
    { allowError: true },
  );
  assert(mismatchAdminInvitationApprove.response.status === 403, "admin invitation approval must reject a selected branch mismatch");

  const passwordIssueReason = `Smoke temporary password issue ${stamp}`;
  const invalidAdminPasswordIssue = await admin.request(
    `/api/v1/admin/users/${invitedUser.id}/password?selectedBranchId=branch-missing`,
    {
      method: "POST",
      body: JSON.stringify({}),
    },
    { allowError: true },
  );
  assert(invalidAdminPasswordIssue.response.status === 403, "admin password issue must reject invalid selectedBranchId");

  const mismatchPasswordIssueReason = `Smoke temporary password mismatch ${stamp}`;
  const mismatchAdminPasswordIssue = await admin.request(
    `/api/v1/admin/users/${invitedUser.id}/password?selectedBranchId=branch-songpa`,
    {
      method: "POST",
      body: JSON.stringify({ reason: mismatchPasswordIssueReason, temporaryPassword: `FJ-Mismatch-${stamp}!` }),
    },
    { allowError: true },
  );
  assert(mismatchAdminPasswordIssue.response.status === 403, "admin password issue must reject a selected branch mismatch");
  result = await admin.request("/api/v1/me/bootstrap?selectedBranchId=branch-gangnam");
  assert(
    !result.payload.data.db.auditLogs.some((log) => log.after?.reason === mismatchPasswordIssueReason),
    "selected branch mismatch must not issue a password",
  );

  result = await admin.request(`/api/v1/admin/users/${invitedUser.id}/password`, {
    method: "POST",
    body: JSON.stringify({ reason: passwordIssueReason }),
  });
  const issuedPassword = result.payload.data.password?.temporaryPassword;
  const resetInvitee = result.payload.data.db.users.find((user) => user.id === invitedUser.id);

  assert(issuedPassword && issuedPassword.length >= 12, "admin password issue must return a temporary password");
  assert(issuedPassword !== defaultPilotPassword, "admin password issue must not reuse the default pilot password");
  assert(!resetInvitee?.passwordHash, "admin password issue snapshot must not expose password hash");
  assert(resetInvitee?.passwordUpdatedAt, "admin password issue must return password updated timestamp");
  assert(
    result.payload.data.db.auditLogs.some(
      (log) =>
        log.action === "auth.password_reset.complete" &&
        log.targetId === invitedUser.id &&
        log.after?.reason === passwordIssueReason &&
        !("temporaryPassword" in log.after),
    ),
    "admin password issue audit log missing or leaked temporary password",
  );

  const resetLogin = createClient();
  const resetBootstrap = await loginWithCredentials(resetLogin, invitedUser.email, issuedPassword);
  assert(resetBootstrap.user.id === invitedUser.id, "invited user must log in with admin-issued temporary password");

  const userUpdateReason = `Smoke user profile update ${stamp}`;
  const updatedUserPassword = `FJ-Updated-${stamp}!`;
  const invalidAdminUserUpdate = await admin.request(
    `/api/v1/admin/users/${invitedUser.id}?selectedBranchId=branch-missing`,
    {
      method: "PATCH",
      body: JSON.stringify({}),
    },
    { allowError: true },
  );
  assert(invalidAdminUserUpdate.response.status === 403, "admin user update must reject invalid selectedBranchId");

  const mismatchAdminUserUpdate = await admin.request(
    `/api/v1/admin/users/${invitedUser.id}?selectedBranchId=branch-gangnam`,
    {
      method: "PATCH",
      body: JSON.stringify({
        name: `Smoke Invite Mismatch Updated ${stamp}`,
        email: `smoke-invite-mismatch-updated-${stamp}@example.com`,
        title: `Smoke mismatch member ${stamp}`,
        role: "member",
        branchIds: ["branch-songpa"],
        reason: `Smoke user mismatch ${stamp}`,
      }),
    },
    { allowError: true },
  );
  assert(mismatchAdminUserUpdate.response.status === 403, "admin user update must reject a selected branch mismatch");
  result = await admin.request("/api/v1/me/bootstrap?selectedBranchId=branch-gangnam");
  assert(
    result.payload.data.db.users.find((user) => user.id === invitedUser.id)?.email !==
      `smoke-invite-mismatch-updated-${stamp}@example.com`,
    "selected branch mismatch must not update the admin user",
  );

  result = await admin.request(`/api/v1/admin/users/${invitedUser.id}`, {
    method: "PATCH",
    body: JSON.stringify({
      name: `Smoke Invite Updated ${stamp}`,
      email: `smoke-invite-updated-${stamp}@example.com`,
      title: `Smoke updated member ${stamp}`,
      role: "member",
      branchIds: ["branch-songpa"],
      password: updatedUserPassword,
      reason: userUpdateReason,
    }),
  });
  const updatedInvitedUser = result.payload.data.db.users.find((user) => user.id === invitedUser.id);

  assert(updatedInvitedUser?.name === `Smoke Invite Updated ${stamp}`, "admin user update did not persist name");
  assert(updatedInvitedUser?.email === `smoke-invite-updated-${stamp}@example.com`, "admin user update did not persist email");
  assert(updatedInvitedUser?.title === `Smoke updated member ${stamp}`, "admin user update did not persist title");
  assert(updatedInvitedUser?.role === "member", "admin user update did not persist role");
  assert(updatedInvitedUser?.passwordUpdatedAt, "admin user update with password must persist password updated timestamp");
  assert(
    JSON.stringify(updatedInvitedUser?.branchIds) === JSON.stringify(["branch-songpa"]),
    "admin user update did not persist branch assignment",
  );
  assert(!updatedInvitedUser?.passwordHash, "admin user update snapshot must not expose password hash");
  assert(
    result.payload.data.db.auditLogs.some(
      (log) =>
        log.action === "user.update" &&
        log.targetId === invitedUser.id &&
        log.after?.reason === userUpdateReason &&
        log.after?.passwordUpdated === true &&
        !("password" in log.after) &&
        !("passwordHash" in log.after),
    ),
    "admin user update audit log missing or leaked password data",
  );

  const updatedLogin = createClient();
  const updatedBootstrap = await loginWithCredentials(updatedLogin, updatedInvitedUser.email, updatedUserPassword);
  assert(updatedBootstrap.user.id === invitedUser.id, "invited user must log in with admin-updated password");

  const invalidAdminUserDelete = await admin.request(
    "/api/v1/admin/users/user-coach?selectedBranchId=branch-missing",
    {
      method: "DELETE",
      body: JSON.stringify({}),
    },
    { allowError: true },
  );
  assert(invalidAdminUserDelete.response.status === 403, "admin user delete must reject invalid selectedBranchId");

  const selfDelete = await admin.request(
    "/api/v1/admin/users/user-admin",
    {
      method: "DELETE",
      body: JSON.stringify({ reason: `Smoke self delete block ${stamp}` }),
    },
    { allowError: true },
  );
  assert(selfDelete.response.status === 422, "self delete must be blocked with 422");

  // 담당 수업·회원 연결은 더 이상 삭제를 막지 않는다(자동 인계 — check-admin-user-management-api가 검증).
  // 남은 안전 규칙인 "지점 유일 대표 삭제 차단"을 비파괴적으로 확인한다.
  const soleOwnerDelete = await admin.request(
    "/api/v1/admin/users/user-owner",
    {
      method: "DELETE",
      body: JSON.stringify({ reason: `Smoke sole owner delete block ${stamp}` }),
    },
    { allowError: true },
  );
  assert(soleOwnerDelete.response.status === 422, "sole branch owner delete must be blocked with 422");

  const userDeleteReason = `Smoke user delete ${stamp}`;
  const mismatchAdminUserDelete = await admin.request(
    `/api/v1/admin/users/${invitedUser.id}?selectedBranchId=branch-gangnam`,
    {
      method: "DELETE",
      body: JSON.stringify({ reason: `Smoke user delete mismatch ${stamp}` }),
    },
    { allowError: true },
  );
  assert(mismatchAdminUserDelete.response.status === 403, "admin user delete must reject a selected branch mismatch");
  result = await admin.request("/api/v1/me/bootstrap");
  assert(
    result.payload.data.db.users.some((user) => user.id === invitedUser.id),
    "selected branch mismatch must not delete the user",
  );

  const mismatchAdminRoleUpdateForInvite = await admin.request(
    `/api/v1/admin/users/${invitedUser.id}/roles?selectedBranchId=branch-gangnam`,
    {
      method: "PUT",
      body: JSON.stringify({ role: "coach", reason: `Smoke role mismatch ${stamp}` }),
    },
    { allowError: true },
  );
  assert(mismatchAdminRoleUpdateForInvite.response.status === 403, "admin role update must reject a selected branch mismatch");
  result = await admin.request("/api/v1/me/bootstrap");
  assert(
    result.payload.data.db.users.find((user) => user.id === invitedUser.id)?.role === "member",
    "selected branch mismatch must not update the user role",
  );

  result = await admin.request(`/api/v1/admin/users/${invitedUser.id}/roles?selectedBranchId=branch-songpa`, {
    method: "PUT",
    body: JSON.stringify({ role: "coach", reason: `Smoke invited user role update ${stamp}` }),
  });
  assert(
    result.payload.data.db.users.find((user) => user.id === invitedUser.id)?.role === "coach",
    "admin role update did not persist for an eligible invited user",
  );

  result = await admin.request(`/api/v1/admin/users/${invitedUser.id}?selectedBranchId=branch-songpa`, {
    method: "DELETE",
    body: JSON.stringify({ reason: userDeleteReason }),
  });
  assert(!result.payload.data.db.users.some((user) => user.id === invitedUser.id), "admin user delete did not remove the user");
  assert(
    result.payload.data.db.auditLogs.some(
      (log) => log.action === "user.delete" && log.targetId === invitedUser.id && log.after?.reason === userDeleteReason,
    ),
    "admin user delete audit log missing",
  );

  const selfLockout = await admin.request(
    "/api/v1/admin/users/user-admin/roles",
    {
      method: "PUT",
      body: JSON.stringify({ role: "owner", reason: "smoke self-lockout" }),
    },
    { allowError: true },
  );

  assert(selfLockout.response.status === 422, "self-lockout must be blocked with 422");

  const invalidAdminRoleUpdate = await admin.request(
    "/api/v1/admin/users/user-owner/roles?selectedBranchId=branch-missing",
    {
      method: "PUT",
      body: JSON.stringify({}),
    },
    { allowError: true },
  );
  assert(invalidAdminRoleUpdate.response.status === 403, "admin role update must reject invalid selectedBranchId");

  const soleOwnerRoleDowngrade = await admin.request(
    "/api/v1/admin/users/user-owner/roles?selectedBranchId=branch-gangnam",
    {
      method: "PUT",
      body: JSON.stringify({ role: "coach", reason: "smoke sole owner role downgrade" }),
    },
    { allowError: true },
  );
  assert(soleOwnerRoleDowngrade.response.status === 422, "sole branch owner role downgrade must be blocked with 422");
  result = await admin.request("/api/v1/me/bootstrap");
  assert(
    result.payload.data.db.users.find((user) => user.id === "user-owner")?.role === "owner",
    "blocked sole owner role downgrade must preserve the owner role",
  );

  const pilotEvidence = `Smoke pilot readiness evidence ${stamp}`;
  result = await admin.request("/api/v1/admin/pilot-readiness");
  assert(
    result.payload.data.checks.some((check) => check.id === "pilot-password-rotation"),
    "pilot readiness must include default password rotation check",
  );

  const invalidPilotReadiness = await admin.request(
    "/api/v1/admin/pilot-readiness?selectedBranchId=branch-missing",
    {
      method: "PATCH",
      body: JSON.stringify({}),
    },
    { allowError: true },
  );
  assert(invalidPilotReadiness.response.status === 403, "pilot readiness update must reject invalid selectedBranchId");

  result = await admin.request("/api/v1/admin/pilot-readiness", {
    method: "PATCH",
    body: JSON.stringify({
      checkId: "pilot-mobile-attendance",
      evidence: pilotEvidence,
      owner: "Smoke QA",
      status: "verified",
    }),
  });
  const pilotCheck = result.payload.data.db.pilotReadinessChecks.find((check) => check.id === "pilot-mobile-attendance");
  assert(pilotCheck?.status === "verified", "pilot readiness status did not persist");
  assert(pilotCheck?.evidence === pilotEvidence, "pilot readiness evidence did not persist");
  assert(
    result.payload.data.db.auditLogs.some(
      (log) => log.action === "pilot_readiness.update" && log.targetId === "pilot-mobile-attendance",
    ),
    "pilot readiness audit log missing",
  );

  const blockedPilotReadiness = await coach.request(
    "/api/v1/admin/pilot-readiness",
    {
      method: "PATCH",
      body: JSON.stringify({
        checkId: "pilot-mobile-attendance",
        evidence: "blocked coach evidence",
        owner: "coach",
        status: "verified",
      }),
    },
    { allowError: true },
  );
  assert(blockedPilotReadiness.response.status === 403, "coach must not update pilot readiness");

  const incidentTitle = `Smoke pilot incident ${stamp}`;
  const invalidPilotIncidentCreate = await admin.request(
    "/api/v1/admin/pilot-incidents?selectedBranchId=branch-missing",
    {
      method: "POST",
      body: JSON.stringify({}),
    },
    { allowError: true },
  );
  assert(invalidPilotIncidentCreate.response.status === 403, "pilot incident create must reject invalid selectedBranchId");

  result = await admin.request("/api/v1/admin/pilot-incidents", {
    method: "POST",
    body: JSON.stringify({
      branchId: "branch-gangnam",
      description: `Smoke incident reproduction ${stamp}`,
      owner: "Smoke PM",
      role: "coach",
      screen: "/app/classes",
      severity: "p0",
      title: incidentTitle,
      workaround: "수기 출석부로 임시 기록",
    }),
  });
  const createdIncident = result.payload.data.db.pilotIncidents.find((incident) => incident.title === incidentTitle);

  assert(createdIncident?.status === "open", "pilot incident create must persist open incident");
  assert(createdIncident?.severity === "p0", "pilot incident severity must persist");
  assert(
    result.payload.data.db.auditLogs.some(
      (log) => log.action === "pilot_incident.create" && log.targetId === createdIncident.id,
    ),
    "pilot incident create audit log missing",
  );

  const invalidPilotIncidentUpdate = await admin.request(
    `/api/v1/admin/pilot-incidents/${createdIncident.id}?selectedBranchId=branch-missing`,
    {
      method: "PATCH",
      body: JSON.stringify({}),
    },
    { allowError: true },
  );
  assert(invalidPilotIncidentUpdate.response.status === 403, "pilot incident update must reject invalid selectedBranchId");

  result = await admin.request(`/api/v1/admin/pilot-incidents/${createdIncident.id}`, {
    method: "PATCH",
    body: JSON.stringify({
      owner: "Smoke PM",
      status: "resolved",
      workaround: "출석 저장 재시도 후 정상 확인",
    }),
  });
  const resolvedIncident = result.payload.data.db.pilotIncidents.find((incident) => incident.id === createdIncident.id);

  assert(resolvedIncident?.status === "resolved", "pilot incident update must persist resolved status");
  assert(resolvedIncident?.resolvedAt, "pilot incident resolved status must persist resolvedAt");
  assert(
    result.payload.data.db.auditLogs.some(
      (log) => log.action === "pilot_incident.update" && log.targetId === createdIncident.id,
    ),
    "pilot incident update audit log missing",
  );

  const blockedPilotIncident = await coach.request(
    "/api/v1/admin/pilot-incidents",
    {
      method: "POST",
      body: JSON.stringify({
        branchId: "branch-gangnam",
        description: "blocked coach incident",
        owner: "coach",
        role: "coach",
        screen: "/app/classes",
        severity: "p2",
        title: "Blocked coach incident",
        workaround: "",
      }),
    },
    { allowError: true },
  );
  assert(blockedPilotIncident.response.status === 403, "coach must not create pilot incidents");

  const operationEvidence = `Smoke pilot operation evidence ${stamp}`;
  const mobileOperationEvidence = `Smoke mobile attendance 22s evidence ${stamp}`;
  const invalidPilotOperation = await admin.request(
    "/api/v1/admin/pilot-operations?selectedBranchId=branch-missing",
    {
      method: "POST",
      body: JSON.stringify({}),
    },
    { allowError: true },
  );
  assert(invalidPilotOperation.response.status === 403, "pilot operation update must reject invalid selectedBranchId");

  result = await admin.request("/api/v1/admin/pilot-operations", {
    method: "POST",
    body: JSON.stringify({
      attendanceRecords: 12,
      branchId: "branch-gangnam",
      classesChecked: 3,
      date: "2026-06-14",
      evidence: operationEvidence,
      mobileAttendanceDurationSeconds: 22,
      mobileAttendanceEvidence: mobileOperationEvidence,
      noticeChecks: 1,
      owner: "Smoke PM",
      paymentChecks: 2,
      noticeFollowupChecks: 1,
      status: "verified",
    }),
  });
  const operationLog = result.payload.data.db.pilotOperationLogs.find((log) => log.evidence === operationEvidence);

  assert(operationLog?.status === "verified", "pilot operation log must persist verified status");
  assert(operationLog?.attendanceRecords === 12, "pilot operation log must persist attendance count");
  assert(operationLog?.paymentChecks === 2, "pilot operation log must persist payment check count");
  assert(operationLog?.mobileAttendanceDurationSeconds === 22, "pilot operation log must persist mobile attendance duration");
  assert(operationLog?.mobileAttendanceEvidence === mobileOperationEvidence, "pilot operation log must persist mobile attendance evidence");
  assert(
    result.payload.data.db.auditLogs.some(
      (log) => log.action === "pilot_operation.update" && log.targetId === operationLog.id,
    ),
    "pilot operation audit log missing",
  );

  const missingMobilePilotOperation = await admin.request(
    "/api/v1/admin/pilot-operations",
    {
      method: "POST",
      body: JSON.stringify({
        attendanceRecords: 1,
        branchId: "branch-gangnam",
        classesChecked: 1,
        date: "2026-06-17",
        evidence: "missing mobile operation evidence",
        noticeChecks: 0,
        owner: "Smoke PM",
        paymentChecks: 1,
        noticeFollowupChecks: 0,
        status: "verified",
      }),
    },
    { allowError: true },
  );
  assert(missingMobilePilotOperation.response.status === 400, "verified attendance operation logs must require mobile timing evidence");

  const invalidPilotOperationDate = await admin.request(
    "/api/v1/admin/pilot-operations",
    {
      method: "POST",
      body: JSON.stringify({
        attendanceRecords: 1,
        branchId: "branch-gangnam",
        classesChecked: 1,
        date: "2026-02-31",
        evidence: "invalid operation date evidence",
        mobileAttendanceDurationSeconds: 22,
        mobileAttendanceEvidence: "invalid operation mobile evidence",
        noticeChecks: 0,
        owner: "Smoke PM",
        paymentChecks: 1,
        noticeFollowupChecks: 0,
        status: "verified",
      }),
    },
    { allowError: true },
  );
  assert(invalidPilotOperationDate.response.status === 400, "impossible pilot operation dates must be rejected");

  const invalidBlockedPilotOperation = await admin.request(
    "/api/v1/admin/pilot-operations",
    {
      method: "POST",
      body: JSON.stringify({
        attendanceRecords: 0,
        branchId: "branch-gangnam",
        classesChecked: 0,
        date: "2026-06-16",
        evidence: "blocked operation evidence",
        noticeChecks: 0,
        owner: "Smoke PM",
        paymentChecks: 0,
        noticeFollowupChecks: 0,
        status: "blocked",
      }),
    },
    { allowError: true },
  );
  assert(invalidBlockedPilotOperation.response.status === 400, "blocked pilot operation logs must require blocker summary");

  const blockedPilotOperation = await coach.request(
    "/api/v1/admin/pilot-operations",
    {
      method: "POST",
      body: JSON.stringify({
        attendanceRecords: 1,
        branchId: "branch-gangnam",
        classesChecked: 1,
        date: "2026-06-15",
        evidence: "blocked coach operation evidence",
        mobileAttendanceDurationSeconds: 22,
        mobileAttendanceEvidence: "blocked coach mobile evidence",
        noticeChecks: 0,
        owner: "coach",
        paymentChecks: 1,
        noticeFollowupChecks: 0,
        status: "verified",
      }),
    },
    { allowError: true },
  );
  assert(blockedPilotOperation.response.status === 403, "coach must not create pilot operation logs");

  result = await admin.request(
    `/api/v1/admin/audit-logs?action=export.create&reason=${encodeURIComponent(`Smoke audit log review ${stamp}`)}`,
  );
  assert(result.payload.data.logs.some((log) => log.action === "export.create"), "audit log query must return export logs");
  assert(result.payload.data.summary.exportCount >= 1, "audit log summary must count exports");

  const reversedAuditDateRange = await admin.request(
    `/api/v1/admin/audit-logs?from=2026-07-14&to=2026-07-13&reason=${encodeURIComponent(`Smoke reversed audit range ${stamp}`)}`,
    {},
    { allowError: true },
  );
  assert(reversedAuditDateRange.response.status === 400, "audit log query must reject a start date after the end date");
  assert.match(
    reversedAuditDateRange.payload.error?.message ?? "",
    /시작일은 종료일보다 늦을 수 없습니다/,
    "reversed audit date range must explain the chronology error",
  );

  const missingAuditReason = await admin.request(
    "/api/v1/admin/audit-logs",
    {},
    { allowError: true },
  );
  assert(missingAuditReason.response.status === 400, "audit log query without reason must fail");

  const blockedAuditRead = await coach.request(
    `/api/v1/admin/audit-logs?reason=${encodeURIComponent(`Smoke forbidden audit read ${stamp}`)}`,
    {},
    { allowError: true },
  );
  assert(blockedAuditRead.response.status === 403, "coach must not read admin audit logs");

  result = await admin.request("/api/v1/me/bootstrap");
  assert(
    result.payload.data.db.auditLogs.some((log) => log.action === "audit_logs.read"),
    "audit log read audit missing",
  );

  const actions = new Set(result.payload.data.db.auditLogs.map((log) => log.action));

  for (const action of [
    "attendance.update",
    "member.create",
    "member.update",
    "class.create",
    "class.update",
    "payment.create",
    "payment.update",
    "payment.delete",
    "payment.online_checkout.create",
    "payment.webhook",
    "payment.recurring_agreement.create",
    "payment.recurring_agreement.cancel",
    "payment.refund",
    "export.create",
    "notice.create",
    "notice.read",
    "notification.subscribe",
    "notification.unsubscribe",
    ...(!pushConfigured ? ["notification.dispatch"] : []),
    "counseling_note.create",
    "branch.create",
    "branch.update",
    "branch.owner.assign",
    "user.invite.create",
    "auth.password_reset.request",
    "auth.password_reset.complete",
    "auth.invite.accept",
    "user.role.update",
    "pilot_readiness.update",
    "pilot_incident.create",
    "pilot_incident.update",
    "pilot_operation.update",
    "audit_logs.read",
  ]) {
    assert(actions.has(action), `${action} audit log missing`);
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        baseUrl,
        checked: [
          "coach payment redaction",
          "credential login and password hash redaction",
          "role scoped bootstrap",
          "bootstrap invalid selectedBranchId API 403",
          "401 protected API",
          "member profile APIs require authentication and role before validation",
          "attendance and class APIs require authentication and role before validation",
          "notice and notification APIs require authentication and role before validation",
          "deleted request APIs are no longer exposed",
          "member create and pilot readiness/operations APIs require authentication and role before validation",
          "branch scope 403",
          "attendance update audit note",
          "attendance/class/payment invalid selectedBranchId API 403",
          "attendance reason route",
          "counseling note create/scope/audit",
          "member guardian counseling notice invalid selectedBranchId API 403",
          "member create/update/profile/guardian link and adult guardian-link block",
          "class create/update",
          "payment calendar validity and chronology, canonical terminal-state metadata without root reason duplication, zero-amount refund immutability, detail-only correction history integrity, status changes, delete/refund/cancel lifecycle, online webhook receipt/idempotency, and recurring agreement create/cancel",
          "online and recurring payment invalid selectedBranchId API 403",
          "member/guardian CSV export API 403",
          "CSV export invalid selectedBranchId API 403",
          "payment/operations CSV export audit",
          "important notice create/read/bulk-read targeted audit",
          "recipient notice unread count and badge scope",
          "member and guardian personal notice inbox/read scope",
          "coach personal notice targets exactly one searched member",
          "notice read invalid selectedBranchId API 403",
          "push subscription/unsubscribe and missing VAPID dispatch audit",
          "notice delete permissions, recipient removal, coach-owned delete, and audit log",
          "admin branch user and pilot invalid selectedBranchId API 403",
          "branch create/update/owner assignment",
          "owner branch-scoped invitation",
          "invite create/initial password/reuse block and admin password issue audit",
          "admin self-lockout",
          "role update audit logs",
          "pilot readiness password rotation check",
          "pilot readiness status/audit logs",
          "pilot incident create/update/audit logs",
          "pilot operation 14-day log mobile timing/audit logs",
          "audit log query/filter/reason/read audit",
        ],
      },
      null,
      2,
    ),
  );
}

async function main() {
  await resetDemoData("before");

  try {
    await run();
  } finally {
    await resetDemoData("after");
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : error);
  process.exit(1);
});
