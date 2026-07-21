import assert from "node:assert/strict";
import { resetOwnedSmokeServer } from "./lib/release-smoke-environment.mjs";

const baseUrl = process.env.SMOKE_BASE_URL ?? "http://localhost:3000";
const skipDevReset = process.env.SMOKE_SKIP_DEV_RESET === "1";
const stamp = Date.now();
let paymentCreateRequestSequence = 0;

function createPaymentRequestHeaders(label) {
  paymentCreateRequestSequence += 1;
  return { "Idempotency-Key": `manual.smoke.${label}.${stamp}.${paymentCreateRequestSequence}` };
}

function wait(durationMs) {
  return new Promise((resolve) => setTimeout(resolve, durationMs));
}
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

function assertNoticeCreateDeliveryFeedback(data, minimumRecipientCount, label, auditLogs = data.db.auditLogs) {
  assert(data.push, `${label} notice create must return delivery feedback`);
  assert(data.push.recipientCount >= minimumRecipientCount, `${label} notice create must count app inbox recipients`);
  assert(data.push.message.includes("알림함"), `${label} notice create feedback must clarify app inbox delivery`);
  assert(
    auditLogs.some(
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
  const oversizedEndpoint = `https://push.example.test/${"x".repeat(2_100)}`;

  let result = await client.request(
    "/api/v1/notifications/subscriptions",
    {
      method: "POST",
      body: JSON.stringify({
        subscription: {
          endpoint: `https://push.example.test/${role}-invalid-metadata-${stamp}`,
          keys: { auth: "valid-auth", p256dh: "valid-p256dh" },
        },
        userAgent: { malformed: true },
      }),
    },
    { allowError: true },
  );
  assert(result.response.status === 400, `${role} malformed push metadata must fail without a server error`);

  result = await client.request(
    "/api/v1/notifications/subscriptions",
    {
      method: "POST",
      body: JSON.stringify({
        subscription: {
          endpoint: `http://push.example.test/${role}-insecure-${stamp}`,
          keys: { auth: "valid-auth", p256dh: "valid-p256dh" },
        },
      }),
    },
    { allowError: true },
  );
  assert(result.response.status === 400, `${role} insecure push endpoint must be rejected`);

  result = await client.request(
    "/api/v1/notifications/subscriptions",
    {
      method: "POST",
      body: JSON.stringify({
        subscription: {
          endpoint: oversizedEndpoint,
          keys: { auth: "valid-auth", p256dh: "valid-p256dh" },
        },
      }),
    },
    { allowError: true },
  );
  assert(result.response.status === 400, `${role} oversized push endpoint must be rejected`);

  result = await client.request(
    "/api/v1/notifications/subscriptions",
    {
      method: "POST",
      body: JSON.stringify({
        subscription: {
          endpoint: `https://push.example.test/${role}-oversized-key-${stamp}`,
          keys: { auth: "a".repeat(513), p256dh: "valid-p256dh" },
        },
      }),
    },
    { allowError: true },
  );
  assert(result.response.status === 400, `${role} oversized push key must be rejected`);

  result = await client.request("/api/v1/notifications/subscriptions", {
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

  const malformedUnsubscribe = await client.request(
    "/api/v1/notifications/subscriptions",
    {
      method: "DELETE",
      body: JSON.stringify({ endpoint: { invalid: true } }),
    },
    { allowError: true },
  );
  assert.equal(malformedUnsubscribe.response.status, 400, `${role} malformed push unsubscribe must be rejected`);

  const oversizedUnsubscribe = await client.request(
    "/api/v1/notifications/subscriptions",
    {
      method: "DELETE",
      body: JSON.stringify({ endpoint: oversizedEndpoint }),
    },
    { allowError: true },
  );
  assert.equal(oversizedUnsubscribe.response.status, 400, `${role} oversized push unsubscribe must be rejected`);
  result = await client.request("/api/v1/notifications/push-config");
  assert(result.payload.data.currentUserSubscribed === true, `${role} invalid unsubscribe must preserve the active subscription`);
  assert(result.payload.data.activeSubscriptionCount === 1, `${role} invalid unsubscribe must preserve the scoped count`);

  result = await client.request("/api/v1/notifications/subscriptions", {
    method: "DELETE",
    body: JSON.stringify({ endpoint }),
  });

  assert(result.payload.data.enforcedAlwaysOn === true, `${role} push unsubscribe must enforce always-on policy`);
  assert(result.payload.data.subscription.disabledAt === null, `${role} push unsubscribe must keep subscription active`);
  assert(result.payload.data.activeSubscriptionCount === 1, `${role} push unsubscribe must keep only current user count visible`);
}

async function assertFamilyPushSubscriptionOwnershipTransfer({
  adminClient,
  nextClient,
  nextUserId,
  previousClient,
  previousUserId,
}) {
  const endpoint = `https://push.example.test/account-transfer-${stamp}`;
  const endpointHint = endpoint.length <= 16 ? endpoint : `...${endpoint.slice(-16)}`;

  await previousClient.request("/api/v1/notifications/subscriptions", {
    method: "POST",
    body: JSON.stringify({
      subscription: {
        endpoint,
        keys: { auth: "transfer-previous-auth", p256dh: "transfer-previous-p256dh" },
      },
      userAgent: "family-transfer-previous",
    }),
  });
  await nextClient.request("/api/v1/notifications/subscriptions", {
    method: "POST",
    body: JSON.stringify({
      subscription: {
        endpoint,
        keys: { auth: "transfer-next-auth", p256dh: "transfer-next-p256dh" },
      },
      userAgent: "family-transfer-next",
    }),
  });

  const snapshot = await adminClient.request("/api/v1/me/bootstrap");
  const transferredSubscriptions = snapshot.payload.data.db.pushSubscriptions.filter(
    (subscription) => subscription.endpoint === endpointHint,
  );
  assert.equal(transferredSubscriptions.length, 1, "one browser endpoint must have exactly one current account owner");
  assert.equal(transferredSubscriptions[0].userId, nextUserId, "browser push subscription must transfer to the current account");
  assert(
    snapshot.payload.data.db.auditLogs.some(
      (log) =>
        log.action === "notification.subscribe" &&
        log.targetId === transferredSubscriptions[0].id &&
        log.before?.userId === previousUserId &&
        log.after?.userId === nextUserId,
    ),
    "push subscription account transfer must retain an ownership audit trail",
  );
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

  const unauthenticatedAttendanceQrIssue = await anonymous.request(
    "/api/v1/me/attendance-qr?selectedBranchId=branch-gangnam",
    {
      method: "POST",
      body: JSON.stringify({}),
    },
    { allowError: true },
  );
  assert.equal(unauthenticatedAttendanceQrIssue.response.status, 401, "attendance QR issue must require login");

  const unauthenticatedAttendanceQrScan = await anonymous.request(
    "/api/v1/attendance-qr/scan?selectedBranchId=branch-gangnam",
    {
      method: "POST",
      body: JSON.stringify({}),
    },
    { allowError: true },
  );
  assert.equal(unauthenticatedAttendanceQrScan.response.status, 401, "attendance QR scan must require login");

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
  const blockedSelectedBranchAttendance = await credentialClient.request(
    "/api/v1/class-sessions/class-songpa-kids/attendance?selectedBranchId=branch-gangnam",
    {
      method: "PUT",
      body: JSON.stringify({ items: [{ memberId: "member-harin", status: "present" }] }),
    },
    { allowError: true },
  );
  assert(
    blockedSelectedBranchAttendance.response.status === 403,
    "attendance mutation must reject a selected branch that differs from the class branch",
  );
  const attendanceFixtureWindow = {
    endsAt: new Date(Date.now() + 58 * 60_000).toISOString(),
    startsAt: new Date(Date.now() - 2 * 60_000).toISOString(),
  };
  const attendanceFixture = await credentialClient.request(
    "/api/v1/classes/class-kids-am?selectedBranchId=branch-gangnam",
    {
      method: "PATCH",
      body: JSON.stringify(attendanceFixtureWindow),
    },
  );
  const preparedAttendanceClass = attendanceFixture.payload.data.db.classes.find(
    (session) => session.id === "class-kids-am",
  );
  assert.equal(
    preparedAttendanceClass?.startsAt,
    attendanceFixtureWindow.startsAt,
    "isolated API smoke must prepare a deterministic started attendance session",
  );

  const malformedCredentialLogin = await anonymous.request(
    "/api/v1/auth/login",
    {
      method: "POST",
      body: JSON.stringify({ phone: {}, password: "wrong-password" }),
    },
    { allowError: true },
  );
  assert(malformedCredentialLogin.response.status === 400, "malformed credential login must fail without a server error");

  const malformedRegistration = await anonymous.request(
    "/api/v1/auth/register",
    {
      method: "POST",
      body: JSON.stringify({ name: {}, phone: "01012345678", password: "SafePassword!2026" }),
    },
    { allowError: true },
  );
  assert(malformedRegistration.response.status === 400, "malformed registration must fail without a server error");

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
    coachBootstrap.db.auditLogs.every(
      (log) => log.actorUserId === "user-coach" && log.targetType === "attendance" && log.branchId === "branch-gangnam",
    ),
    "coach bootstrap must only include own attendance audit logs in the selected branch",
  );
  const blockedFutureAttendance = await coach.request(
    "/api/v1/class-sessions/class-kids-tomorrow/attendance?selectedBranchId=branch-gangnam",
    {
      method: "PUT",
      body: JSON.stringify({ items: [{ memberId: "member-jun", status: "present" }] }),
    },
    { allowError: true },
  );
  assert(blockedFutureAttendance.response.status === 422, "attendance mutation must reject future class sessions");

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

  const invalidCoachClassCreate = await coach.request(
    "/api/v1/branches/branch-gangnam/classes?selectedBranchId=branch-gangnam",
    {
      method: "POST",
      body: JSON.stringify({}),
    },
    { allowError: true },
  );
  assert(invalidCoachClassCreate.response.status === 400, "coach class create must reach validation inside an assigned branch");

  const invalidCoachClassUpdate = await coach.request(
    "/api/v1/classes/class-kids-am?selectedBranchId=branch-gangnam",
    {
      method: "PATCH",
      body: JSON.stringify({}),
    },
    { allowError: true },
  );
  assert(invalidCoachClassUpdate.response.status === 400, "coach must update an assigned class through validated input");

  const coachClassStartsAt = new Date(stamp + 24 * 60 * 60 * 1000).toISOString();
  const coachClassEndsAt = new Date(stamp + 25 * 60 * 60 * 1000).toISOString();
  const coachCreatedClassResult = await coach.request(
    "/api/v1/branches/branch-gangnam/classes?selectedBranchId=branch-gangnam",
    {
      method: "POST",
      body: JSON.stringify({
        name: `Coach Created Class ${stamp}`,
        level: "초급",
        ageGroup: "all",
        coachId: "user-coach",
        startsAt: coachClassStartsAt,
        endsAt: coachClassEndsAt,
        room: "매트 C",
        capacity: 10,
        enrolledMemberIds: [],
      }),
    },
  );
  const coachCreatedClass = coachCreatedClassResult.payload.data.db.classes.find(
    (session) => session.name === `Coach Created Class ${stamp}`,
  );
  assert(coachCreatedClass, "coach must be able to create a class assigned to self");

  const coachClassUpdateResult = await coach.request(
    `/api/v1/classes/${coachCreatedClass.id}?selectedBranchId=branch-gangnam`,
    {
      method: "PATCH",
      body: JSON.stringify({ room: "매트 D" }),
    },
  );
  assert.equal(
    coachClassUpdateResult.payload.data.db.classes.find((session) => session.id === coachCreatedClass.id)?.room,
    "매트 D",
    "coach must be able to update an assigned class",
  );

  const blockedCoachReassignment = await coach.request(
    `/api/v1/classes/${coachCreatedClass.id}?selectedBranchId=branch-gangnam`,
    {
      method: "PATCH",
      body: JSON.stringify({ coachId: "user-owner" }),
    },
    { allowError: true },
  );
  assert.equal(blockedCoachReassignment.response.status, 403, "coach must not reassign an owned class to another operator");

  const coachRosterCandidates = await coach.request(
    `/api/v1/classes/${coachCreatedClass.id}/roster-candidates?selectedBranchId=branch-gangnam`,
  );
  assert(
    coachRosterCandidates.payload.data.candidates.some((candidate) => candidate.id === "member-jun"),
    "coach must be able to search same-branch roster candidates for an assigned class",
  );

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

  const attendanceBeforeInvalidInput = await coach.request(
    "/api/v1/me/bootstrap?selectedBranchId=branch-gangnam",
  );
  const attendanceSnapshotBeforeInvalidInput = JSON.stringify(
    attendanceBeforeInvalidInput.payload.data.db.attendance.filter((record) => record.sessionId === "class-kids-am"),
  );
  const attendanceAuditCountBeforeInvalidInput = attendanceBeforeInvalidInput.payload.data.db.auditLogs.filter(
    (log) => log.action === "attendance.update",
  ).length;
  for (const invalidBody of [
    { items: { length: 1 } },
    { items: [null] },
    { items: [{ memberId: "x".repeat(201), status: "present" }] },
    { items: [{ memberId: "member-jun", status: "present", note: "x".repeat(81) }] },
    { items: [{ memberId: "member-jun", status: "present" }], reason: "x".repeat(81) },
    {
      items: [
        { memberId: "member-jun", status: "present" },
        { memberId: "member-jun", status: "absent" },
      ],
    },
  ]) {
    const invalidAttendanceResult = await coach.request(
      "/api/v1/class-sessions/class-kids-am/attendance?selectedBranchId=branch-gangnam",
      { method: "PUT", body: JSON.stringify(invalidBody) },
      { allowError: true },
    );
    assert.equal(invalidAttendanceResult.response.status, 400, "malformed or duplicate batch attendance must return 400");
  }
  const attendanceAfterInvalidInput = await coach.request(
    "/api/v1/me/bootstrap?selectedBranchId=branch-gangnam",
  );
  assert.equal(
    JSON.stringify(attendanceAfterInvalidInput.payload.data.db.attendance.filter((record) => record.sessionId === "class-kids-am")),
    attendanceSnapshotBeforeInvalidInput,
    "invalid batch attendance must not change existing records",
  );
  assert.equal(
    attendanceAfterInvalidInput.payload.data.db.auditLogs.filter((log) => log.action === "attendance.update").length,
    attendanceAuditCountBeforeInvalidInput,
    "invalid batch attendance must not append audit records",
  );

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
  const attendanceLockProbeReason = `Smoke attendance lock probe ${stamp}`;
  let releaseSlowAttendanceBody = () => {};
  const slowAttendanceBody = new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode('{"items":['));
      releaseSlowAttendanceBody = () => {
        controller.enqueue(new TextEncoder().encode("]}"));
        controller.close();
      };
    },
  });
  const slowAttendanceRequest = coach.request(
    "/api/v1/class-sessions/class-kids-am/attendance?selectedBranchId=branch-gangnam",
    {
      body: slowAttendanceBody,
      duplex: "half",
      method: "PUT",
    },
    { allowError: true },
  );
  await wait(250);
  const attendanceReasonDuringSlowBody = coach.request(
    "/api/v1/class-sessions/class-kids-am/attendance/member-jun/reason?selectedBranchId=branch-gangnam",
    {
      method: "POST",
      body: JSON.stringify({ reason: attendanceLockProbeReason }),
    },
  );
  const lockProbeOutcome = await Promise.race([
    attendanceReasonDuringSlowBody.then((response) => ({ response, timedOut: false })),
    wait(1_000).then(() => ({ response: null, timedOut: true })),
  ]);
  releaseSlowAttendanceBody();
  const [slowAttendanceResult, completedLockProbe] = await Promise.all([
    slowAttendanceRequest,
    attendanceReasonDuringSlowBody,
  ]);
  assert.equal(slowAttendanceResult.response.status, 400, "incomplete attendance stream must finish as invalid input");
  assert.equal(lockProbeOutcome.timedOut, false, "slow attendance body parsing must not hold the shared attendance lock");
  assert.equal(
    completedLockProbe.payload.data.db.attendance.find(
      (record) => record.sessionId === "class-kids-am" && record.memberId === "member-jun",
    )?.note,
    attendanceLockProbeReason,
    "attendance reason must persist while another request body is still streaming",
  );
  const attendanceBeforeOversizedReason = JSON.stringify(
    completedLockProbe.payload.data.db.attendance.find(
      (record) => record.sessionId === "class-kids-am" && record.memberId === "member-jun",
    ),
  );
  const attendanceAuditCountBeforeOversizedReason = completedLockProbe.payload.data.db.auditLogs.filter(
    (log) => log.action === "attendance.update",
  ).length;
  const oversizedAttendanceReason = await coach.request(
    "/api/v1/class-sessions/class-kids-am/attendance/member-jun/reason?selectedBranchId=branch-gangnam",
    {
      method: "POST",
      body: JSON.stringify({ reason: "x".repeat(81) }),
    },
    { allowError: true },
  );
  assert.equal(oversizedAttendanceReason.response.status, 400, "oversized attendance reason must return 400");
  const attendanceAfterOversizedReason = await coach.request(
    "/api/v1/me/bootstrap?selectedBranchId=branch-gangnam",
  );
  assert.equal(
    JSON.stringify(
      attendanceAfterOversizedReason.payload.data.db.attendance.find(
        (record) => record.sessionId === "class-kids-am" && record.memberId === "member-jun",
      ),
    ),
    attendanceBeforeOversizedReason,
    "oversized attendance reason must not change the existing attendance record",
  );
  assert.equal(
    attendanceAfterOversizedReason.payload.data.db.auditLogs.filter((log) => log.action === "attendance.update").length,
    attendanceAuditCountBeforeOversizedReason,
    "oversized attendance reason must not append an audit record",
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

  const malformedCounselingNote = await coach.request(
    "/api/v1/branches/branch-gangnam/members/member-jun/counseling-notes?selectedBranchId=branch-gangnam",
    {
      method: "POST",
      body: JSON.stringify({ body: { invalid: true }, noteType: "caution", visibility: "coach_visible" }),
    },
    { allowError: true },
  );
  assert.equal(malformedCounselingNote.response.status, 400, "malformed counseling note bodies must be rejected");
  let counselingSnapshot = await credentialClient.request("/api/v1/me/bootstrap?selectedBranchId=branch-gangnam");
  assert(
    !counselingSnapshot.payload.data.db.counselingNotes.some((note) => note.body === "[object Object]"),
    "malformed counseling notes must not persist",
  );

  const counselingNoteCountBeforeOversized = counselingSnapshot.payload.data.db.counselingNotes.length;
  const counselingAuditCountBeforeOversized = counselingSnapshot.payload.data.db.auditLogs.filter(
    (log) => log.action === "counseling_note.create",
  ).length;
  const oversizedCounselingNote = await coach.request(
    "/api/v1/branches/branch-gangnam/members/member-jun/counseling-notes?selectedBranchId=branch-gangnam",
    {
      method: "POST",
      body: JSON.stringify({ body: "x".repeat(2_001), noteType: "caution", visibility: "coach_visible" }),
    },
    { allowError: true },
  );
  assert.equal(oversizedCounselingNote.response.status, 400, "oversized counseling note bodies must be rejected");
  counselingSnapshot = await credentialClient.request("/api/v1/me/bootstrap?selectedBranchId=branch-gangnam");
  assert.equal(
    counselingSnapshot.payload.data.db.counselingNotes.length,
    counselingNoteCountBeforeOversized,
    "oversized counseling notes must not persist",
  );
  assert.equal(
    counselingSnapshot.payload.data.db.auditLogs.filter((log) => log.action === "counseling_note.create").length,
    counselingAuditCountBeforeOversized,
    "oversized counseling notes must not create audit records",
  );

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
    !result.payload.data.db.auditLogs.some((log) => log.action === "counseling_note.create"),
    "coach counseling note response must not expose internal counseling audit logs",
  );
  const counselingAuditSnapshot = await credentialClient.request(
    "/api/v1/me/bootstrap?selectedBranchId=branch-gangnam",
  );
  assert(
    counselingAuditSnapshot.payload.data.db.auditLogs.some(
      (log) => log.action === "counseling_note.create" && log.targetId === counselingNote.id,
    ),
    "counseling note create audit missing",
  );

  const concurrentCounselingBodies = [
    `Concurrent counseling note A ${stamp}`,
    `Concurrent counseling note B ${stamp}`,
  ];
  const concurrentCounselingResults = await Promise.all(
    concurrentCounselingBodies.map((body) =>
      coach.request(
        "/api/v1/branches/branch-gangnam/members/member-jun/counseling-notes?selectedBranchId=branch-gangnam",
        {
          method: "POST",
          body: JSON.stringify({ body, noteType: "follow_up", visibility: "coach_visible" }),
        },
      ),
    ),
  );
  assert(
    concurrentCounselingResults.every(({ response }) => response.status === 200),
    "concurrent counseling notes must both succeed",
  );
  counselingSnapshot = await credentialClient.request("/api/v1/me/bootstrap?selectedBranchId=branch-gangnam");
  const concurrentCounselingNotes = counselingSnapshot.payload.data.db.counselingNotes.filter((note) =>
    concurrentCounselingBodies.includes(note.body),
  );
  assert.equal(concurrentCounselingNotes.length, 2, "concurrent counseling notes must both persist");
  assert.equal(new Set(concurrentCounselingNotes.map((note) => note.id)).size, 2, "concurrent counseling note IDs must be unique");
  const concurrentCounselingAuditIds = counselingSnapshot.payload.data.db.auditLogs
    .filter(
      (log) =>
        log.action === "counseling_note.create" &&
        concurrentCounselingNotes.some((note) => note.id === log.targetId),
    )
    .map((log) => log.id);
  assert.equal(concurrentCounselingAuditIds.length, 2, "concurrent counseling note audits must both persist");
  assert.equal(new Set(concurrentCounselingAuditIds).size, 2, "concurrent counseling note audit IDs must be unique");

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
  const guardianUserId = result.user.id;
  await assertCsvExportBlockedForRole(guardian, "guardian");
  await assertFamilyPushSubscriptionAlwaysOn(guardian, "guardian", 10);
  assert(
    result.db.auditLogs.length === 0,
    "guardian bootstrap must not include internal audit logs",
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

  let releaseSlowGuardianBody = () => {};
  const slowGuardianBody = new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode('{"guardianUserId":'));
      releaseSlowGuardianBody = () => {
        controller.enqueue(new TextEncoder().encode("}"));
        controller.close();
      };
    },
  });
  const slowGuardianRequest = owner.request(
    `/api/v1/members/${guardianLinkTargetMemberId}/guardians?selectedBranchId=branch-gangnam`,
    {
      body: slowGuardianBody,
      duplex: "half",
      method: "POST",
    },
    { allowError: true },
  );
  await wait(250);
  const guardianLinkDuringSlowBody = owner.request(
    "/api/v1/members/member-minjae/guardians?selectedBranchId=branch-gangnam",
    {
      method: "DELETE",
      body: JSON.stringify({ guardianUserId: "user-guardian" }),
    },
  );
  const guardianLockProbeOutcome = await Promise.race([
    guardianLinkDuringSlowBody.then((response) => ({ response, timedOut: false })),
    wait(1_000).then(() => ({ response: null, timedOut: true })),
  ]);
  releaseSlowGuardianBody();
  const [slowGuardianResult, completedGuardianLockProbe] = await Promise.all([
    slowGuardianRequest,
    guardianLinkDuringSlowBody,
  ]);
  assert.equal(slowGuardianResult.response.status, 400, "incomplete guardian stream must finish as invalid input");
  assert.equal(
    guardianLockProbeOutcome.timedOut,
    false,
    "slow guardian body parsing must not hold the shared guardian link lock",
  );
  assert.equal(completedGuardianLockProbe.response.status, 200, "guardian lock probe must complete successfully");

  const malformedGuardianLink = await owner.request(
    `/api/v1/members/${guardianLinkTargetMemberId}/guardians?selectedBranchId=branch-gangnam`,
    {
      method: "POST",
      body: JSON.stringify({ guardianUserId: { invalid: true } }),
    },
    { allowError: true },
  );
  assert.equal(malformedGuardianLink.response.status, 400, "malformed guardian links must be rejected before normalization");
  const oversizedGuardianLink = await owner.request(
    `/api/v1/members/${guardianLinkTargetMemberId}/guardians?selectedBranchId=branch-gangnam`,
    {
      method: "POST",
      body: JSON.stringify({ guardianUserId: "x".repeat(201) }),
    },
    { allowError: true },
  );
  assert.equal(oversizedGuardianLink.response.status, 400, "oversized guardian links must be rejected");
  result = await owner.request("/api/v1/me/bootstrap?selectedBranchId=branch-gangnam");
  assert(
    !result.payload.data.db.members.find((member) => member.id === guardianLinkTargetMemberId)?.guardianIds.includes("user-guardian"),
    "malformed guardian links must not mutate member guardian ids",
  );

  const concurrentGuardianMemberId = "member-minjae";
  assert(
    result.payload.data.db.members.find((member) => member.id === concurrentGuardianMemberId)?.ageGroup === "teen",
    "concurrent guardian link target must remain a youth member before guardian linking",
  );

  const concurrentGuardianLinks = await Promise.all(
    [guardianLinkTargetMemberId, concurrentGuardianMemberId].map((memberId) =>
      owner.request(`/api/v1/members/${memberId}/guardians?selectedBranchId=branch-gangnam`, {
        method: "POST",
        body: JSON.stringify({ guardianUserId: "user-guardian" }),
      }),
    ),
  );
  assert(
    concurrentGuardianLinks.every((linkResult) => linkResult.response.status === 200),
    "concurrent guardian links must both succeed",
  );
  result = await owner.request("/api/v1/me/bootstrap?selectedBranchId=branch-gangnam");
  assert(
    [guardianLinkTargetMemberId, concurrentGuardianMemberId].every((memberId) =>
      result.payload.data.db.members
        .find((member) => member.id === memberId)
        ?.guardianIds.includes("user-guardian"),
    ),
    "concurrent guardian links must preserve both member links",
  );
  assert(
    [guardianLinkTargetMemberId, concurrentGuardianMemberId].every((memberId) =>
      result.payload.data.db.users
        .find((user) => user.id === "user-guardian")
        ?.childMemberIds?.includes(memberId),
    ),
    "concurrent guardian links must preserve both guardian child links",
  );
  assert(
    [guardianLinkTargetMemberId, concurrentGuardianMemberId].every((memberId) =>
      result.payload.data.db.auditLogs.some(
        (log) =>
          log.action === "member.update" &&
          log.targetId === memberId &&
          log.after?.guardianUserId === "user-guardian",
      ),
    ),
    "concurrent guardian links must preserve both audit records",
  );
  const concurrentGuardianAuditIds = result.payload.data.db.auditLogs
    .filter(
      (log) =>
        log.action === "member.update" &&
        [guardianLinkTargetMemberId, concurrentGuardianMemberId].includes(log.targetId) &&
        log.after?.guardianUserId === "user-guardian",
    )
    .map((log) => log.id);
  assert.equal(new Set(concurrentGuardianAuditIds).size, 2, "concurrent guardian link audit IDs must be unique");

  for (const method of ["PUT", "DELETE"]) {
    const malformedMutation = await owner.request(
      `/api/v1/members/${guardianLinkTargetMemberId}/guardians?selectedBranchId=branch-gangnam`,
      {
        method,
        body: JSON.stringify({ guardianUserId: ["user-guardian"] }),
      },
      { allowError: true },
    );
    assert.equal(malformedMutation.response.status, 400, `malformed guardian ${method} must be rejected`);
  }
  result = await owner.request("/api/v1/me/bootstrap?selectedBranchId=branch-gangnam");
  assert(
    result.payload.data.db.members.find((member) => member.id === guardianLinkTargetMemberId)?.guardianIds.includes("user-guardian"),
    "malformed guardian replace/unlink must preserve the existing relationship",
  );

  await owner.request(`/api/v1/members/${concurrentGuardianMemberId}/guardians?selectedBranchId=branch-gangnam`, {
    method: "DELETE",
    body: JSON.stringify({ guardianUserId: "user-guardian" }),
  });

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

  const blockedCrossBranchGuardian = await owner.request(
    `/api/v1/members/${guardianLinkTargetMemberId}/guardians?selectedBranchId=branch-gangnam`,
    {
      method: "PUT",
      body: JSON.stringify({
        guardianUserId: "user-songpa-guardian",
      }),
    },
    { allowError: true },
  );
  assert.equal(
    blockedCrossBranchGuardian.response.status,
    422,
    "owner must not connect a guardian who is outside the member branch",
  );
  const missingGuardianReplacement = await owner.request(
    `/api/v1/members/${guardianLinkTargetMemberId}/guardians?selectedBranchId=branch-gangnam`,
    {
      method: "PUT",
      body: JSON.stringify({ guardianUserId: `missing-guardian-${stamp}` }),
    },
    { allowError: true },
  );
  assert.deepEqual(
    blockedCrossBranchGuardian.payload.error,
    missingGuardianReplacement.payload.error,
    "guardian replacement must not disclose whether an unavailable guardian account exists",
  );
  result = await owner.request("/api/v1/me/bootstrap?selectedBranchId=branch-gangnam");
  assert(
    result.payload.data.db.members.find((member) => member.id === guardianLinkTargetMemberId)?.guardianIds.join(",") === "user-guardian",
    "blocked cross-branch guardian replacement must not mutate member guardian ids",
  );
  assert(
    !result.payload.data.db.users.find((user) => user.id === "user-songpa-guardian")?.childMemberIds?.includes(guardianLinkTargetMemberId),
    "blocked cross-branch guardian replacement must not mutate guardian child ids",
  );
  for (const guardianUserId of ["user-songpa-guardian", `missing-guardian-${stamp}`]) {
    const unlinkedGuardianDelete = await owner.request(
      `/api/v1/members/${guardianLinkTargetMemberId}/guardians?selectedBranchId=branch-gangnam`,
      {
        method: "DELETE",
        body: JSON.stringify({ guardianUserId }),
      },
    );
    assert.equal(
      unlinkedGuardianDelete.response.status,
      200,
      "guardian unlink must be idempotent without disclosing an unlinked account's existence",
    );
  }

  const guardianAdmin = createClient();
  await login(guardianAdmin, "admin");
  const replaceGuardian = await guardianAdmin.request(
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
    result.db.auditLogs.length === 0,
    "guardian bootstrap must keep internal audit logs hidden after linking",
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
  assert.equal(
    result.payload.data.db.auditLogs.length,
    0,
    "guardian linked member update response must keep internal audit logs hidden",
  );
  const guardianContactAuditSnapshot = await credentialClient.request(
    "/api/v1/me/bootstrap?selectedBranchId=branch-gangnam",
  );
  assert(
    guardianContactAuditSnapshot.payload.data.db.auditLogs.some(
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

  const inaccessibleMemberUpdate = await guardianAfterLink.request(
    "/api/v1/members/member-minjae?selectedBranchId=branch-gangnam",
    {
      method: "PATCH",
      body: JSON.stringify({ emergencyContact: "010-7000-0000" }),
    },
    { allowError: true },
  );
  const missingMemberUpdate = await guardianAfterLink.request(
    `/api/v1/members/missing-member-${stamp}?selectedBranchId=branch-gangnam`,
    {
      method: "PATCH",
      body: JSON.stringify({ emergencyContact: "010-7000-0000" }),
    },
    { allowError: true },
  );
  assert.equal(inaccessibleMemberUpdate.response.status, 404, "guardian must not discover another family member profile");
  assert.deepEqual(
    inaccessibleMemberUpdate.payload.error,
    missingMemberUpdate.payload.error,
    "member update must not disclose whether an inaccessible member exists",
  );

  const memberClient = createClient();
  result = await login(memberClient, "member");
  const memberUserId = result.user.id;
  await assertCsvExportBlockedForRole(memberClient, "member");
  await assertFamilyPushSubscriptionAlwaysOn(memberClient, "member", 20);
  await assertFamilyPushSubscriptionOwnershipTransfer({
    adminClient: credentialClient,
    nextClient: memberClient,
    nextUserId: memberUserId,
    previousClient: guardian,
    previousUserId: guardianUserId,
  });
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
    result.db.auditLogs.length === 0,
    "member bootstrap must not include internal audit logs",
  );
  assert(
    result.db.members.length === 1 && result.db.members[0].id === "member-minjae",
    "member must only see own member profile",
  );

  const guardianAttendanceQrIssue = await guardian.request(
    "/api/v1/me/attendance-qr?selectedBranchId=branch-gangnam",
    {
      method: "POST",
      body: JSON.stringify({ sessionId: "class-kids-am" }),
    },
    { allowError: true },
  );
  assert.equal(guardianAttendanceQrIssue.response.status, 403, "guardian must not issue a class attendance QR");

  const memberAttendanceQrIssue = await memberClient.request(
    "/api/v1/me/attendance-qr?selectedBranchId=branch-gangnam",
    {
      method: "POST",
      body: JSON.stringify({ sessionId: "class-kids-am" }),
    },
    { allowError: true },
  );
  assert.equal(memberAttendanceQrIssue.response.status, 403, "member must not issue a class attendance QR");

  const qrClassName = `QR Attendance Class ${stamp}`;
  const qrClassStartsAt = new Date(Date.now() + 180 * 24 * 60 * 60_000).toISOString();
  const qrClassEndsAt = new Date(Date.now() + 180 * 24 * 60 * 60_000 + 60 * 60_000).toISOString();
  const qrClassCreate = await owner.request(
    "/api/v1/branches/branch-gangnam/classes?selectedBranchId=branch-gangnam",
    {
      method: "POST",
      body: JSON.stringify({
        name: qrClassName,
        level: "초급",
        ageGroup: "all",
        coachId: "user-coach",
        startsAt: qrClassStartsAt,
        endsAt: qrClassEndsAt,
        room: "QR 검증 매트",
        capacity: 8,
        enrolledMemberIds: ["member-minjae"],
      }),
    },
  );
  const qrClass = qrClassCreate.payload.data.db.classes.find((session) => session.name === qrClassName);

  assert(qrClass, "attendance QR smoke class was not created");

  const nonEnrolledClassQrIssue = await coach.request(
    "/api/v1/me/attendance-qr?selectedBranchId=branch-gangnam",
    {
      method: "POST",
      body: JSON.stringify({ sessionId: "class-kids-am" }),
    },
  );
  const nonEnrolledClassQrScan = await memberClient.request(
    "/api/v1/attendance-qr/scan?selectedBranchId=branch-gangnam",
    {
      method: "POST",
      body: JSON.stringify({ memberId: "member-minjae", payload: nonEnrolledClassQrIssue.payload.data.payload }),
    },
  );
  assert.equal(nonEnrolledClassQrScan.payload.data.scan.autoEnrolled, true, "QR scan must auto-enroll an unregistered member");
  assert(
    nonEnrolledClassQrScan.payload.data.db.classes
      .find((session) => session.id === "class-kids-am")
      ?.enrolledMemberIds.includes("member-minjae"),
    "QR scan must persist the auto-enrolled member on the class roster",
  );
  assert(
    nonEnrolledClassQrScan.payload.data.db.attendance.some(
      (record) => record.sessionId === "class-kids-am" && record.memberId === "member-minjae" && record.status === "present",
    ),
    "QR scan must record attendance for an auto-enrolled member",
  );
  const ownerBootstrapAfterQrAutoEnrollment = await owner.request(
    "/api/v1/me/bootstrap?selectedBranchId=branch-gangnam",
  );
  const qrAutoEnrollmentAudit = ownerBootstrapAfterQrAutoEnrollment.payload.data.db.auditLogs.find(
    (log) =>
      log.action === "class.update" &&
      log.targetId === "class-kids-am" &&
      log.after?.memberId === "member-minjae" &&
      log.after?.source === "attendance_qr",
  );
  assert(qrAutoEnrollmentAudit, "QR auto-enrollment audit log missing");
  assert.equal(qrAutoEnrollmentAudit.actorUserId, "user-member", "QR auto-enrollment audit actor mismatch");

  const attendanceQrIssue = await coach.request(
    "/api/v1/me/attendance-qr?selectedBranchId=branch-gangnam",
    {
      method: "POST",
      body: JSON.stringify({ sessionId: qrClass.id }),
    },
  );
  const attendanceQrPayload = attendanceQrIssue.payload.data.payload;

  assert.match(
    attendanceQrPayload,
    /^final-judo:attendance:[A-Za-z0-9_-]{40,64}$/,
    "coach class attendance QR must use the opaque FINAL payload format",
  );

  const memberBootstrapAfterQrIssue = await memberClient.request(
    "/api/v1/me/bootstrap?selectedBranchId=branch-gangnam",
  );
  assert.deepEqual(
    memberBootstrapAfterQrIssue.payload.data.db.attendanceQrChallenges,
    [],
    "bootstrap must redact attendance QR challenge hashes",
  );

  const guardianAttendanceQrScan = await guardian.request(
    "/api/v1/attendance-qr/scan?selectedBranchId=branch-gangnam",
    {
      method: "POST",
      body: JSON.stringify({ memberId: "member-minjae", payload: attendanceQrPayload }),
    },
    { allowError: true },
  );
  assert.equal(guardianAttendanceQrScan.response.status, 403, "guardian must not scan a member attendance QR");

  const coachAttendanceQrScan = await coach.request(
    "/api/v1/attendance-qr/scan?selectedBranchId=branch-gangnam",
    {
      method: "POST",
      body: JSON.stringify({ memberId: "member-minjae", payload: attendanceQrPayload }),
    },
    { allowError: true },
  );
  assert.equal(coachAttendanceQrScan.response.status, 403, "coach must not scan a member attendance QR");

  const unrelatedMemberAttendanceQrScan = await memberClient.request(
    "/api/v1/attendance-qr/scan?selectedBranchId=branch-gangnam",
    {
      method: "POST",
      body: JSON.stringify({ memberId: "member-jun", payload: attendanceQrPayload }),
    },
    { allowError: true },
  );
  assert.equal(unrelatedMemberAttendanceQrScan.response.status, 403, "member must not scan attendance for another member");

  const attendanceQrScan = await memberClient.request(
    "/api/v1/attendance-qr/scan?selectedBranchId=branch-gangnam",
    {
      method: "POST",
      body: JSON.stringify({ memberId: "member-minjae", payload: attendanceQrPayload }),
    },
  );
  assert.equal(attendanceQrScan.payload.data.scan.memberId, "member-minjae", "attendance QR scan member mismatch");
  assert.equal(attendanceQrScan.payload.data.scan.status, "present", "attendance QR scan must record present status");
  assert.equal(attendanceQrScan.payload.data.scan.autoEnrolled, false, "pre-enrolled QR scan must not report auto-enrollment");
  assert(
    attendanceQrScan.payload.data.db.attendance.some(
      (record) =>
        record.sessionId === qrClass.id && record.memberId === "member-minjae" && record.status === "present",
    ),
    "attendance QR scan did not persist attendance",
  );
  const ownerBootstrapAfterAttendanceQrScan = await owner.request(
    "/api/v1/me/bootstrap?selectedBranchId=branch-gangnam",
  );
  const attendanceQrAudit = ownerBootstrapAfterAttendanceQrScan.payload.data.db.auditLogs.find(
    (log) => log.action === "attendance.update" && log.targetId === `att-${qrClass.id}-member-minjae`,
  );
  assert(attendanceQrAudit, "attendance QR scan audit log missing");
  assert.equal(attendanceQrAudit.actorUserId, "user-member", "attendance QR audit actor mismatch");
  assert.equal(attendanceQrAudit.after?.note, "회원 QR 출석", "attendance QR audit must identify the scan path");

  const replayedAttendanceQrScan = await memberClient.request(
    "/api/v1/attendance-qr/scan?selectedBranchId=branch-gangnam",
    {
      method: "POST",
      body: JSON.stringify({ memberId: "member-minjae", payload: attendanceQrPayload }),
    },
    { allowError: true },
  );
  assert.equal(replayedAttendanceQrScan.response.status, 409, "attendance QR must be single-use per member");
  assert.equal(replayedAttendanceQrScan.payload.error?.code, "QR_ALREADY_USED", "QR replay error code mismatch");

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

  result = await owner.request(
    "/api/v1/branches/branch-gangnam/members?selectedBranchId=branch-gangnam",
    {
      method: "POST",
      body: JSON.stringify({
        name: { unexpected: true },
        status: "trial",
        ageGroup: "kids",
        level: "입문",
        belt: "흰띠",
        emergencyContact: "010-3482-6159",
      }),
    },
    { allowError: true },
  );
  assert.equal(result.response.status, 400, "malformed member create fields must fail without a server error");

  result = await owner.request(
    "/api/v1/branches/branch-gangnam/members?selectedBranchId=branch-gangnam",
    {
      method: "POST",
      body: JSON.stringify({
        name: `Invalid DOB ${stamp}`,
        status: "trial",
        ageGroup: "kids",
        level: "입문",
        belt: "흰띠",
        birthDate: "2026-02-30",
        emergencyContact: "010-3482-6159",
      }),
    },
    { allowError: true },
  );
  assert.equal(result.response.status, 400, "member create must reject impossible calendar birth dates");

  const memberSnapshotBeforeLengthRejections = await owner.request(
    "/api/v1/me/bootstrap?selectedBranchId=branch-gangnam",
  );
  const memberCountBeforeLengthRejections = memberSnapshotBeforeLengthRejections.payload.data.db.members.length;
  const memberAuditCountBeforeLengthRejections = memberSnapshotBeforeLengthRejections.payload.data.db.auditLogs.filter(
    (log) => log.action === "member.create",
  ).length;
  for (const oversizedField of [
    { name: "가".repeat(31) },
    { level: "급".repeat(31) },
    { belt: "띠".repeat(31) },
    { emergencyContact: "1".repeat(41) },
  ]) {
    const oversizedMemberCreate = await owner.request(
      "/api/v1/branches/branch-gangnam/members?selectedBranchId=branch-gangnam",
      {
        method: "POST",
        body: JSON.stringify({
          name: `길이 제한 회원 ${stamp}`,
          status: "trial",
          ageGroup: "kids",
          level: "입문",
          belt: "흰띠",
          emergencyContact: "010-3482-6159",
          ...oversizedField,
        }),
      },
      { allowError: true },
    );
    assert.equal(oversizedMemberCreate.response.status, 400, "oversized member create input must be rejected");
  }
  result = await owner.request("/api/v1/me/bootstrap?selectedBranchId=branch-gangnam");
  assert.equal(result.payload.data.db.members.length, memberCountBeforeLengthRejections, "oversized member input must not create records");
  assert.equal(
    result.payload.data.db.auditLogs.filter((log) => log.action === "member.create").length,
    memberAuditCountBeforeLengthRejections,
    "oversized member create input must not create audit records",
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

  const concurrentMemberNames = [`Concurrent A ${stamp}`, `Concurrent B ${stamp}`];
  const createConcurrentMember = (name) =>
    owner.request("/api/v1/branches/branch-gangnam/members?selectedBranchId=branch-gangnam", {
      method: "POST",
      body: JSON.stringify({
        name,
        status: "trial",
        ageGroup: "adult",
        level: "입문",
        belt: "흰띠",
        emergencyContact: "010-3482-6159",
      }),
    });
  await Promise.all(concurrentMemberNames.map(createConcurrentMember));
  result = await owner.request("/api/v1/me/bootstrap?selectedBranchId=branch-gangnam");
  const concurrentMembers = result.payload.data.db.members.filter((member) => concurrentMemberNames.includes(member.name));
  assert.equal(concurrentMembers.length, 2, "concurrent member creation must preserve both records");
  assert.equal(new Set(concurrentMembers.map((member) => member.id)).size, 2, "concurrent member IDs must be unique");
  assert.equal(
    result.payload.data.db.auditLogs.filter(
      (log) => log.action === "member.create" && concurrentMembers.some((member) => member.id === log.targetId),
    ).length,
    2,
    "concurrent member creation must preserve both audit logs",
  );

  const malformedMemberUpdate = await owner.request(
    `/api/v1/members/${createdMember.id}?selectedBranchId=branch-gangnam`,
    {
      method: "PATCH",
      body: JSON.stringify({ birthDate: { unexpected: true } }),
    },
    { allowError: true },
  );
  assert.equal(malformedMemberUpdate.response.status, 400, "malformed member update fields must fail without a server error");
  const invalidMemberBirthDateUpdate = await owner.request(
    `/api/v1/members/${createdMember.id}?selectedBranchId=branch-gangnam`,
    {
      method: "PATCH",
      body: JSON.stringify({ birthDate: "2026-02-30" }),
    },
    { allowError: true },
  );
  assert.equal(invalidMemberBirthDateUpdate.response.status, 400, "member update must reject impossible calendar birth dates");
  result = await owner.request("/api/v1/me/bootstrap?selectedBranchId=branch-gangnam");
  assert.equal(
    result.payload.data.db.members.find((member) => member.id === createdMember.id)?.birthDate,
    createdMember.birthDate,
    "invalid member updates must preserve the existing birth date",
  );

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

  const memberUpdateAuditCountBeforeConcurrent = result.payload.data.db.auditLogs.filter(
    (log) => log.action === "member.update" && log.targetId === createdMember.id,
  ).length;
  const concurrentMemberStatuses = ["active", "trial"];
  const concurrentMemberUpdateResults = await Promise.all(
    concurrentMemberStatuses.map((status) =>
      owner.request(`/api/v1/members/${createdMember.id}?selectedBranchId=branch-gangnam`, {
        method: "PATCH",
        body: JSON.stringify({ status }),
      }),
    ),
  );
  assert(
    concurrentMemberUpdateResults.every(({ response }) => response.status === 200),
    "concurrent member updates must both succeed",
  );
  result = await owner.request("/api/v1/me/bootstrap?selectedBranchId=branch-gangnam");
  const concurrentlyUpdatedMember = result.payload.data.db.members.find((member) => member.id === createdMember.id);
  assert(
    concurrentMemberStatuses.includes(concurrentlyUpdatedMember?.status),
    "concurrent member updates must persist the final serialized status",
  );
  const concurrentMemberUpdateAudits = result.payload.data.db.auditLogs.filter(
    (log) => log.action === "member.update" && log.targetId === createdMember.id,
  );
  assert.equal(
    concurrentMemberUpdateAudits.length,
    memberUpdateAuditCountBeforeConcurrent + 2,
    "concurrent member updates must preserve both audit logs",
  );
  assert.equal(
    new Set(concurrentMemberUpdateAudits.map((log) => log.id)).size,
    concurrentMemberUpdateAudits.length,
    "concurrent member update audit IDs must be unique",
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

  result = await owner.request(
    "/api/v1/branches/branch-gangnam/classes?selectedBranchId=branch-gangnam",
    {
      method: "POST",
      body: JSON.stringify({
        name: { unexpected: true },
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
  assert.equal(result.response.status, 400, "malformed class create fields must fail without a server error");

  result = await owner.request("/api/v1/me/bootstrap?selectedBranchId=branch-gangnam");
  const classCountBeforeLengthRejections = result.payload.data.db.classes.length;
  const classCreateAuditCountBeforeLengthRejections = result.payload.data.db.auditLogs.filter(
    (log) => log.action === "class.create",
  ).length;
  const oversizedClassCreateFields = [
    { name: "수".repeat(81) },
    { level: "급".repeat(41) },
    { room: "장".repeat(81) },
    { coachId: "c".repeat(201) },
    { startsAt: "2".repeat(65) },
    { enrolledMemberIds: Array.from({ length: 81 }, (_, index) => `member-${index}`) },
    { enrolledMemberIds: ["m".repeat(201)] },
  ];

  for (const oversizedField of oversizedClassCreateFields) {
    const oversizedClassCreate = await owner.request(
      "/api/v1/branches/branch-gangnam/classes?selectedBranchId=branch-gangnam",
      {
        method: "POST",
        body: JSON.stringify({
          name: `Length Class ${stamp}`,
          level: "초급",
          ageGroup: "kids",
          coachId: "user-coach",
          startsAt,
          endsAt,
          room: "매트 C",
          capacity: 80,
          enrolledMemberIds: [],
          ...oversizedField,
        }),
      },
      { allowError: true },
    );

    assert.equal(oversizedClassCreate.response.status, 400, "oversized class create input must be rejected");
  }

  result = await owner.request("/api/v1/me/bootstrap?selectedBranchId=branch-gangnam");
  assert.equal(result.payload.data.db.classes.length, classCountBeforeLengthRejections, "oversized class input must not create records");
  assert.equal(
    result.payload.data.db.auditLogs.filter((log) => log.action === "class.create").length,
    classCreateAuditCountBeforeLengthRejections,
    "oversized class create input must not create audit records",
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

  const registrationMonthParts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      year: "numeric",
      month: "2-digit",
      timeZone: "Asia/Seoul",
    }).formatToParts(new Date(startsAt)).map((part) => [part.type, part.value]),
  );
  const registrationMonth = `${registrationMonthParts.year}-${registrationMonthParts.month}`;
  const unauthenticatedRegistrationOptions = await anonymous.request(
    `/api/v1/classes/registration-options?memberId=member-seo&month=${registrationMonth}&selectedBranchId=branch-gangnam`,
    {},
    { allowError: true },
  );
  assert.equal(unauthenticatedRegistrationOptions.response.status, 401, "class registration options must authenticate first");

  const blockedOperatorSelfRegistration = await owner.request(
    `/api/v1/classes/${createdClass.id}/enrollment?selectedBranchId=branch-gangnam`,
    {
      method: "POST",
      body: JSON.stringify({ memberId: "member-seo" }),
    },
    { allowError: true },
  );
  assert.equal(blockedOperatorSelfRegistration.response.status, 403, "operators must use roster management instead of family self-registration");

  const inaccessibleFamilyRegistrationOptions = await guardian.request(
    `/api/v1/classes/registration-options?memberId=member-minjae&month=${registrationMonth}&selectedBranchId=branch-gangnam`,
    {},
    { allowError: true },
  );
  assert.equal(inaccessibleFamilyRegistrationOptions.response.status, 404, "guardian must not inspect another family member's registration options");

  const guardianRegistrationOptions = await guardian.request(
    `/api/v1/classes/registration-options?memberId=member-seo&month=${registrationMonth}&selectedBranchId=branch-gangnam`,
  );
  const guardianCreatedClassOption = guardianRegistrationOptions.payload.data.options.find(
    (option) => option.id === createdClass.id,
  );
  assert(guardianCreatedClassOption?.canRegister, "guardian must see a compatible future class as registerable");
  assert(
    !JSON.stringify(guardianRegistrationOptions.payload.data).includes("enrolledMemberIds"),
    "class registration options must not expose another member roster",
  );

  const guardianRegistration = await guardian.request(
    `/api/v1/classes/${createdClass.id}/enrollment?selectedBranchId=branch-gangnam`,
    {
      method: "POST",
      body: JSON.stringify({ memberId: "member-seo" }),
    },
  );
  assert.equal(guardianRegistration.payload.data.enrollment.status, "registered", "guardian class registration must succeed");
  const duplicateGuardianRegistration = await guardian.request(
    `/api/v1/classes/${createdClass.id}/enrollment?selectedBranchId=branch-gangnam`,
    {
      method: "POST",
      body: JSON.stringify({ memberId: "member-seo" }),
    },
  );
  assert.equal(duplicateGuardianRegistration.payload.data.enrollment.unchanged, true, "duplicate class registration must be idempotent");
  result = await owner.request("/api/v1/me/bootstrap?selectedBranchId=branch-gangnam");
  assert(
    result.payload.data.db.classes.find((session) => session.id === createdClass.id)?.enrolledMemberIds.includes("member-seo"),
    "family registration must persist in the operator roster",
  );
  const guardianRegisteredClass = guardianRegistration.payload.data.db.classes.find((session) => session.id === createdClass.id);
  assert(
    guardianRegisteredClass?.enrolledMemberIds.every((memberId) => ["member-jun", "member-seo", "member-yuna"].includes(memberId)),
    "family registration bootstrap must not expose unrelated member IDs",
  );

  const guardianCancellation = await guardian.request(
    `/api/v1/classes/${createdClass.id}/enrollment?selectedBranchId=branch-gangnam`,
    {
      method: "DELETE",
      body: JSON.stringify({ memberId: "member-seo" }),
    },
  );
  assert.equal(guardianCancellation.payload.data.enrollment.status, "cancelled", "guardian must cancel a future class registration");

  const adultRegistrationStartsAt = new Date(stamp + 7 * 60 * 60 * 1000).toISOString();
  const adultRegistrationEndsAt = new Date(stamp + 8 * 60 * 60 * 1000).toISOString();
  result = await owner.request("/api/v1/branches/branch-gangnam/classes?selectedBranchId=branch-gangnam", {
    method: "POST",
    body: JSON.stringify({
      name: `Member Self Registration ${stamp}`,
      level: "중급",
      ageGroup: "all",
      coachId: "user-coach",
      startsAt: adultRegistrationStartsAt,
      endsAt: adultRegistrationEndsAt,
      room: "매트 B",
      capacity: 4,
      enrolledMemberIds: [],
    }),
  });
  const adultRegistrationClass = result.payload.data.db.classes.find(
    (session) => session.name === `Member Self Registration ${stamp}`,
  );
  assert(adultRegistrationClass, "adult self-registration class must be created");
  const memberSelfRegistration = await memberClient.request(
    `/api/v1/classes/${adultRegistrationClass.id}/enrollment?selectedBranchId=branch-gangnam`,
    {
      method: "POST",
      body: JSON.stringify({ memberId: "member-minjae" }),
    },
  );
  assert.equal(memberSelfRegistration.payload.data.enrollment.status, "registered", "adult member must register directly");
  await memberClient.request(
    `/api/v1/classes/${adultRegistrationClass.id}/enrollment?selectedBranchId=branch-gangnam`,
    {
      method: "DELETE",
      body: JSON.stringify({ memberId: "member-minjae" }),
    },
  );

  const capacityRaceStartsAt = new Date(stamp + 30 * 60 * 60 * 1000).toISOString();
  const capacityRaceEndsAt = new Date(stamp + 31 * 60 * 60 * 1000).toISOString();
  result = await owner.request("/api/v1/branches/branch-gangnam/classes?selectedBranchId=branch-gangnam", {
    method: "POST",
    body: JSON.stringify({
      name: `Capacity Race Class ${stamp}`,
      level: "초급",
      ageGroup: "kids",
      coachId: "user-coach",
      startsAt: capacityRaceStartsAt,
      endsAt: capacityRaceEndsAt,
      room: "매트 C",
      capacity: 1,
      enrolledMemberIds: [],
    }),
  });
  const capacityRaceClass = result.payload.data.db.classes.find((session) => session.name === `Capacity Race Class ${stamp}`);
  assert(capacityRaceClass, "capacity race class must be created");
  const capacityRaceResults = await Promise.all(
    ["member-jun", "member-seo"].map((memberId) =>
      guardian.request(
        `/api/v1/classes/${capacityRaceClass.id}/enrollment?selectedBranchId=branch-gangnam`,
        {
          method: "POST",
          body: JSON.stringify({ memberId }),
        },
        { allowError: true },
      ),
    ),
  );
  assert.deepEqual(
    capacityRaceResults.map(({ response }) => response.status).sort(),
    [200, 422],
    "concurrent class registrations must serialize at capacity",
  );
  result = await owner.request("/api/v1/me/bootstrap?selectedBranchId=branch-gangnam");
  assert.equal(
    result.payload.data.db.classes.find((session) => session.id === capacityRaceClass.id)?.enrolledMemberIds.length,
    1,
    "concurrent class registration must never exceed capacity",
  );

  const recurringClassName = `Smoke Weekly Class ${stamp}`;
  const recurringClassPayload = {
    name: recurringClassName,
    level: "초급",
    ageGroup: "all",
    coachId: "user-coach",
    room: "매트 D",
    capacity: 8,
    enrolledMemberIds: [],
    recurrence: {
      mode: "weekly",
      startsOn: "2026-07-20",
      endsOn: "2026-07-31",
      weekdays: [1, 3],
      startTime: "18:00",
      endTime: "19:00",
    },
  };
  result = await owner.request("/api/v1/branches/branch-gangnam/classes?selectedBranchId=branch-gangnam", {
    method: "POST",
    body: JSON.stringify(recurringClassPayload),
  });
  const recurringClasses = result.payload.data.db.classes.filter((item) => item.name === recurringClassName);
  assert.equal(recurringClasses.length, 4, "weekly class creation must persist every selected weekday occurrence");
  assert(
    recurringClasses.every((item) => item.ageGroup === "all"),
    "weekly all-age class creation must persist the unrestricted age group",
  );
  assert.deepEqual(
    recurringClasses.map((item) => item.startsAt).sort(),
    [
      "2026-07-20T09:00:00.000Z",
      "2026-07-22T09:00:00.000Z",
      "2026-07-27T09:00:00.000Z",
      "2026-07-29T09:00:00.000Z",
    ],
    "weekly class creation must use stable Korea timetable instants",
  );
  assert.equal(
    result.payload.data.db.auditLogs.filter(
      (log) => log.action === "class.create" && recurringClasses.some((item) => item.id === log.targetId),
    ).length,
    4,
    "weekly class creation must preserve one audit record per generated class",
  );

  const duplicateRecurringClass = await owner.request(
    "/api/v1/branches/branch-gangnam/classes?selectedBranchId=branch-gangnam",
    {
      method: "POST",
      body: JSON.stringify(recurringClassPayload),
    },
    { allowError: true },
  );
  assert.equal(duplicateRecurringClass.response.status, 409, "duplicate weekly class creation must fail atomically");

  const invalidMainScheduleClass = await owner.request(
    "/api/v1/branches/branch-gangnam/classes?selectedBranchId=branch-gangnam",
    {
      method: "POST",
      body: JSON.stringify({
        ...recurringClassPayload,
        name: `Smoke Invalid Main Slot ${stamp}`,
        recurrence: {
          ...recurringClassPayload.recurrence,
          weekdays: [5],
          startTime: "22:00",
          endTime: "23:00",
        },
      }),
    },
    { allowError: true },
  );
  assert.equal(invalidMainScheduleClass.response.status, 422, "main weekly classes must match the registered timetable");

  const concurrentClassNames = [`Smoke Concurrent Class A ${stamp}`, `Smoke Concurrent Class B ${stamp}`];
  const createConcurrentClass = (name) =>
    owner.request("/api/v1/branches/branch-gangnam/classes?selectedBranchId=branch-gangnam", {
      method: "POST",
      body: JSON.stringify({
        name,
        level: "초급",
        ageGroup: "adult",
        coachId: "user-coach",
        startsAt,
        endsAt,
        room: "매트 D",
        capacity: 8,
        enrolledMemberIds: [],
      }),
    });
  await Promise.all(concurrentClassNames.map(createConcurrentClass));
  result = await owner.request("/api/v1/me/bootstrap?selectedBranchId=branch-gangnam");
  const concurrentClasses = result.payload.data.db.classes.filter((item) => concurrentClassNames.includes(item.name));
  assert.equal(concurrentClasses.length, 2, "concurrent class creation must preserve both records");
  assert.equal(new Set(concurrentClasses.map((item) => item.id)).size, 2, "concurrent class IDs must be unique");
  assert.equal(
    result.payload.data.db.auditLogs.filter(
      (log) => log.action === "class.create" && concurrentClasses.some((item) => item.id === log.targetId),
    ).length,
    2,
    "concurrent class creation must preserve both audit logs",
  );

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

  const malformedClassUpdate = await owner.request(
    `/api/v1/classes/${createdClass.id}?selectedBranchId=branch-gangnam`,
    {
      method: "PATCH",
      body: JSON.stringify({ room: { unexpected: true } }),
    },
    { allowError: true },
  );
  assert.equal(malformedClassUpdate.response.status, 400, "malformed class update fields must fail without a server error");
  const invalidDateClassUpdate = await owner.request(
    `/api/v1/classes/${createdClass.id}?selectedBranchId=branch-gangnam`,
    {
      method: "PATCH",
      body: JSON.stringify({ startsAt: "not-a-date" }),
    },
    { allowError: true },
  );
  assert.equal(invalidDateClassUpdate.response.status, 400, "invalid class update dates must fail without a server error");
  result = await owner.request("/api/v1/me/bootstrap?selectedBranchId=branch-gangnam");
  const classBeforeValidUpdate = result.payload.data.db.classes.find((item) => item.id === createdClass.id);
  const classUpdateAuditCountBeforeLengthRejections = result.payload.data.db.auditLogs.filter(
    (log) => log.action === "class.update" && log.targetId === createdClass.id,
  ).length;
  assert.equal(classBeforeValidUpdate?.room, createdClass.room, "invalid class updates must preserve the existing room");
  assert.equal(classBeforeValidUpdate?.startsAt, createdClass.startsAt, "invalid class updates must preserve the existing start time");

  for (const oversizedPatch of [
    { name: "수".repeat(81) },
    { level: "급".repeat(41) },
    { room: "장".repeat(81) },
    { enrolledMemberIds: Array.from({ length: 81 }, (_, index) => `member-${index}`) },
  ]) {
    const oversizedClassUpdate = await owner.request(
      `/api/v1/classes/${createdClass.id}?selectedBranchId=branch-gangnam`,
      {
        method: "PATCH",
        body: JSON.stringify(oversizedPatch),
      },
      { allowError: true },
    );

    assert.equal(oversizedClassUpdate.response.status, 400, "oversized class update input must be rejected");
  }

  result = await owner.request("/api/v1/me/bootstrap?selectedBranchId=branch-gangnam");
  assert.deepEqual(
    result.payload.data.db.classes.find((item) => item.id === createdClass.id),
    classBeforeValidUpdate,
    "oversized class updates must preserve the existing class",
  );
  assert.equal(
    result.payload.data.db.auditLogs.filter((log) => log.action === "class.update" && log.targetId === createdClass.id).length,
    classUpdateAuditCountBeforeLengthRejections,
    "oversized class updates must not create audit records",
  );

  result = await owner.request(`/api/v1/classes/${createdClass.id}?selectedBranchId=branch-gangnam`, {
    method: "PATCH",
    body: JSON.stringify({ room: "매트 D", capacity: 9 }),
  });
  const updatedClass = result.payload.data.db.classes.find((item) => item.id === createdClass.id);

  assert(updatedClass?.room === "매트 D" && updatedClass.capacity === 9, "class update did not persist");

  const classUpdateAuditCountBeforeConcurrent = result.payload.data.db.auditLogs.filter(
    (log) => log.action === "class.update" && log.targetId === createdClass.id,
  ).length;
  const concurrentClassUpdateRooms = ["매트 E", "매트 F"];
  const concurrentClassUpdateResults = await Promise.all(
    concurrentClassUpdateRooms.map((room) =>
      owner.request(`/api/v1/classes/${createdClass.id}?selectedBranchId=branch-gangnam`, {
        method: "PATCH",
        body: JSON.stringify({ room }),
      }),
    ),
  );
  assert(
    concurrentClassUpdateResults.every(({ response }) => response.status === 200),
    "concurrent class updates must both succeed",
  );
  result = await owner.request("/api/v1/me/bootstrap?selectedBranchId=branch-gangnam");
  const concurrentlyUpdatedClass = result.payload.data.db.classes.find((item) => item.id === createdClass.id);
  assert(
    concurrentClassUpdateRooms.includes(concurrentlyUpdatedClass?.room),
    "concurrent class updates must persist the final serialized room",
  );
  const concurrentClassUpdateAudits = result.payload.data.db.auditLogs.filter(
    (log) => log.action === "class.update" && log.targetId === createdClass.id,
  );
  assert.equal(
    concurrentClassUpdateAudits.length,
    classUpdateAuditCountBeforeConcurrent + 2,
    "concurrent class updates must preserve both audit logs",
  );
  assert.equal(
    new Set(concurrentClassUpdateAudits.map((log) => log.id)).size,
    concurrentClassUpdateAudits.length,
    "concurrent class update audit IDs must be unique",
  );

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

  result = await owner.request(
    "/api/v1/branches/branch-gangnam/payments?selectedBranchId=branch-gangnam",
    {
      method: "POST",
      body: JSON.stringify({
        memberId: "member-jun",
        planName: `Smoke Missing Idempotency ${stamp}`,
        status: "scheduled",
        amount: 190000,
        discountAmount: 0,
        dueDate: "2026-06-13",
        expiresAt: "2026-07-13",
      }),
    },
    { allowError: true },
  );
  assert(result.response.status === 400, "manual payment creation must require an idempotency key");

  result = await owner.request(
    "/api/v1/branches/branch-gangnam/payments?selectedBranchId=branch-gangnam",
    {
      method: "POST",
      headers: createPaymentRequestHeaders("unsafe-amount"),
      body: JSON.stringify({
        memberId: "member-jun",
        planName: `Smoke Unsafe Amount ${stamp}`,
        status: "scheduled",
        amount: Number.MAX_SAFE_INTEGER + 1,
        discountAmount: 0,
        dueDate: "2026-06-13",
        expiresAt: "2026-07-13",
      }),
    },
    { allowError: true },
  );
  assert(result.response.status === 400, "manual payment creation must reject unsafe integer amounts");

  const malformedPaymentCreate = await owner.request(
    "/api/v1/branches/branch-gangnam/payments?selectedBranchId=branch-gangnam",
    {
      method: "POST",
      headers: createPaymentRequestHeaders("malformed-body"),
      body: JSON.stringify({
        memberId: { unexpected: true },
        planName: "Malformed payment",
        status: "scheduled",
        amount: 1000,
        dueDate: "2026-07-01",
        expiresAt: "2026-08-01",
      }),
    },
    { allowError: true },
  );
  assert.equal(
    malformedPaymentCreate.response.status,
    400,
    "malformed manual payment fields must fail without a server error",
  );

  result = await owner.request("/api/v1/me/bootstrap?selectedBranchId=branch-gangnam");
  let familyCollectionPayment = result.payload.data.db.payments.find((payment) => payment.id === "pay-seo");

  assert(familyCollectionPayment, "family collection concurrency fixture payment missing");
  assert(!familyCollectionPayment.collectionRequest, "family collection concurrency fixture must start without a request");
  const collectionLockProbePlanName = `${familyCollectionPayment.planName} lock probe ${stamp}`;
  let releaseSlowCollectionBody = () => {};
  const slowCollectionBody = new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode('{"payerName":'));
      releaseSlowCollectionBody = () => {
        controller.enqueue(new TextEncoder().encode("null}"));
        controller.close();
      };
    },
  });
  const slowCollectionRequest = guardianAfterLink.request(
    `/api/v1/payments/${familyCollectionPayment.id}/collection-request?selectedBranchId=branch-gangnam`,
    {
      body: slowCollectionBody,
      duplex: "half",
      method: "POST",
    },
    { allowError: true },
  );
  await wait(250);
  const operatorUpdateDuringSlowCollection = owner.request(
    `/api/v1/payments/${familyCollectionPayment.id}?selectedBranchId=branch-gangnam`,
    {
      method: "PATCH",
      body: JSON.stringify({
        amount: familyCollectionPayment.amount,
        discountAmount: familyCollectionPayment.discountAmount ?? 0,
        dueDate: familyCollectionPayment.dueDate,
        expiresAt: familyCollectionPayment.expiresAt,
        planName: collectionLockProbePlanName,
        reason: `Smoke slow collection lock probe ${stamp}`,
        status: familyCollectionPayment.status,
      }),
    },
  );
  const collectionLockProbeOutcome = await Promise.race([
    operatorUpdateDuringSlowCollection.then((response) => ({ response, timedOut: false })),
    wait(1_000).then(() => ({ response: null, timedOut: true })),
  ]);
  releaseSlowCollectionBody();
  const [slowCollectionResult, completedCollectionLockProbe] = await Promise.all([
    slowCollectionRequest,
    operatorUpdateDuringSlowCollection,
  ]);
  assert.equal(slowCollectionResult.response.status, 400, "incomplete collection stream must finish as invalid input");
  assert.equal(
    collectionLockProbeOutcome.timedOut,
    false,
    "slow family collection body parsing must not hold the payment mutation lock",
  );
  assert.equal(
    completedCollectionLockProbe.payload.data.db.payments.find(
      (payment) => payment.id === familyCollectionPayment.id,
    )?.planName,
    collectionLockProbePlanName,
    "operator payment update must persist while a family collection body is still streaming",
  );
  result = await owner.request("/api/v1/me/bootstrap?selectedBranchId=branch-gangnam");
  familyCollectionPayment = result.payload.data.db.payments.find((payment) => payment.id === "pay-seo");
  assert(familyCollectionPayment, "family collection fixture must remain after the slow-body lock probe");
  const familyCollectionAuditCountBefore = result.payload.data.db.auditLogs.filter(
    (log) => log.action === "payment.update" && log.targetId === familyCollectionPayment.id,
  ).length;
  const inaccessibleCollectionRequest = await guardianAfterLink.request(
    "/api/v1/payments/pay-minjae/collection-request?selectedBranchId=branch-gangnam",
    {
      method: "POST",
      body: JSON.stringify({
        method: "bankTransfer",
        methodLabel: "무통장입금",
        payerName: "이하린",
        payerPhone: "01072483619",
      }),
    },
    { allowError: true },
  );
  const missingCollectionRequest = await guardianAfterLink.request(
    `/api/v1/payments/missing-payment-${stamp}/collection-request?selectedBranchId=branch-gangnam`,
    {
      method: "POST",
      body: JSON.stringify({
        method: "bankTransfer",
        methodLabel: "무통장입금",
        payerName: "이하린",
        payerPhone: "01072483619",
      }),
    },
    { allowError: true },
  );
  assert.equal(inaccessibleCollectionRequest.response.status, 404, "guardian must not discover another family payment");
  assert.deepEqual(
    inaccessibleCollectionRequest.payload.error,
    missingCollectionRequest.payload.error,
    "family collection requests must not disclose whether an unrelated payment exists",
  );
  const malformedCollectionRequest = await guardianAfterLink.request(
    `/api/v1/payments/${familyCollectionPayment.id}/collection-request?selectedBranchId=branch-gangnam`,
    {
      method: "POST",
      body: "null",
    },
    { allowError: true },
  );
  const oversizedCollectionRequest = await guardianAfterLink.request(
    `/api/v1/payments/${familyCollectionPayment.id}/collection-request?selectedBranchId=branch-gangnam`,
    {
      method: "POST",
      body: JSON.stringify({
        method: "bankTransfer",
        methodLabel: "무통장입금",
        payerName: "x".repeat(51),
        payerPhone: "01072483619",
      }),
    },
    { allowError: true },
  );

  assert.equal(malformedCollectionRequest.response.status, 400, "null collection request bodies must fail without a server error");
  assert.equal(oversizedCollectionRequest.response.status, 400, "oversized collection request fields must return 400");
  result = await owner.request("/api/v1/me/bootstrap?selectedBranchId=branch-gangnam");
  assert(
    !result.payload.data.db.payments.find((payment) => payment.id === familyCollectionPayment.id)?.collectionRequest &&
      result.payload.data.db.auditLogs.filter(
        (log) => log.action === "payment.update" && log.targetId === familyCollectionPayment.id,
      ).length === familyCollectionAuditCountBefore,
    "malformed collection requests must not mutate the payment or audit history",
  );

  const concurrentCollectionPlanName = `${familyCollectionPayment.planName} concurrent ${stamp}`;
  const [collectionRequestResult, concurrentPaymentUpdateResult] = await Promise.all([
    guardianAfterLink.request(
      `/api/v1/payments/${familyCollectionPayment.id}/collection-request?selectedBranchId=branch-gangnam`,
      {
        method: "POST",
        body: JSON.stringify({
          method: "bankTransfer",
          methodLabel: "무통장입금",
          payerName: "이하린",
          payerPhone: "01072483619",
        }),
      },
    ),
    owner.request(`/api/v1/payments/${familyCollectionPayment.id}?selectedBranchId=branch-gangnam`, {
      method: "PATCH",
      body: JSON.stringify({
        amount: familyCollectionPayment.amount,
        discountAmount: familyCollectionPayment.discountAmount ?? 0,
        dueDate: familyCollectionPayment.dueDate,
        expiresAt: familyCollectionPayment.expiresAt,
        planName: concurrentCollectionPlanName,
        reason: `Smoke concurrent collection update ${stamp}`,
        status: familyCollectionPayment.status,
      }),
    }),
  ]);

  assert.equal(collectionRequestResult.response.status, 200, "family collection request must succeed during an operator update");
  assert.equal(concurrentPaymentUpdateResult.response.status, 200, "operator payment update must succeed during a family request");
  result = await owner.request("/api/v1/me/bootstrap?selectedBranchId=branch-gangnam");
  const concurrentlyUpdatedPayment = result.payload.data.db.payments.find(
    (payment) => payment.id === familyCollectionPayment.id,
  );
  const concurrentPaymentAudits = result.payload.data.db.auditLogs.filter(
    (log) => log.action === "payment.update" && log.targetId === familyCollectionPayment.id,
  );

  assert(
    concurrentlyUpdatedPayment?.planName === concurrentCollectionPlanName &&
      concurrentlyUpdatedPayment.collectionRequest?.status === "pending" &&
      concurrentlyUpdatedPayment.collectionRequest.requestedByUserId === guardianUserId,
    "concurrent family and operator payment updates must preserve both changes",
  );
  assert.equal(
    concurrentPaymentAudits.length,
    familyCollectionAuditCountBefore + 2,
    "concurrent family and operator payment updates must preserve both audit records",
  );
  assert(
    concurrentPaymentAudits.some((log) => log.message === "회원 납부 요청을 접수했습니다.") &&
      concurrentPaymentAudits.some((log) => log.after?.reason === `Smoke concurrent collection update ${stamp}`),
    "concurrent family and operator payment updates must retain distinct audit evidence",
  );

  const smokeDiscountReason = `Smoke operator discount evidence ${stamp}`;
  const reversedDatePlanName = `Smoke Reversed Dates ${stamp}`;
  result = await owner.request(
    "/api/v1/branches/branch-gangnam/payments?selectedBranchId=branch-gangnam",
    {
      method: "POST",
      headers: createPaymentRequestHeaders("reversed-dates"),
      body: JSON.stringify({
        memberId: "member-jun",
        planName: reversedDatePlanName,
        status: "scheduled",
        amount: 190000,
        discountAmount: 10000,
        discountReason: smokeDiscountReason,
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
      headers: createPaymentRequestHeaders("impossible-date"),
      body: JSON.stringify({
        memberId: "member-jun",
        planName: impossibleDatePlanName,
        status: "scheduled",
        amount: 190000,
        discountAmount: 10000,
        discountReason: smokeDiscountReason,
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
        headers: createPaymentRequestHeaders(`reason-required-${terminalStatus}`),
        body: JSON.stringify({
          memberId: "member-jun",
          planName: `Smoke Reason Required ${terminalStatus} ${stamp}`,
          status: terminalStatus,
          amount: 190000,
          discountAmount: 10000,
          discountReason: smokeDiscountReason,
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
      headers: createPaymentRequestHeaders("cancelled-create"),
      body: JSON.stringify({
        memberId: "member-jun",
        planName: cancelledCreatePlanName,
        status: "cancelled",
        amount: 190000,
        discountAmount: 10000,
        discountReason: smokeDiscountReason,
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
      headers: createPaymentRequestHeaders("zero-refunded"),
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
    discountReason: smokeDiscountReason,
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
    headers: createPaymentRequestHeaders("scheduled-create"),
    body: JSON.stringify({
      memberId: "member-jun",
      planName: `Smoke Plan ${stamp}`,
      status: "scheduled",
      amount: 190000,
      discountAmount: 10000,
      discountReason: smokeDiscountReason,
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
    "/api/v1/branches/branch-gangnam/payments?selectedBranchId=branch-gangnam",
    {
      method: "POST",
      headers: createPaymentRequestHeaders("oversized-plan-create"),
      body: JSON.stringify({
        memberId: "member-jun",
        planName: "가".repeat(101),
        status: "scheduled",
        amount: 190000,
        dueDate: "2026-06-13",
        expiresAt: "2026-07-13",
      }),
    },
    { allowError: true },
  );
  assert(result.response.status === 400, "manual payment create must reject an oversized plan name");

  result = await owner.request(
    "/api/v1/branches/branch-gangnam/payments?selectedBranchId=branch-gangnam",
    {
      method: "POST",
      headers: createPaymentRequestHeaders("oversized-reason-create"),
      body: JSON.stringify({
        memberId: "member-jun",
        planName: `Smoke Oversized Reason ${stamp}`,
        status: "cancelled",
        amount: 190000,
        dueDate: "2026-06-13",
        expiresAt: "2026-07-13",
        reason: "가".repeat(501),
      }),
    },
    { allowError: true },
  );
  assert(result.response.status === 400, "manual payment create must reject an oversized audit reason");

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

  result = await owner.request(
    `/api/v1/payments/${createdPayment.id}?selectedBranchId=branch-gangnam`,
    {
      method: "PATCH",
      body: JSON.stringify({
        amount: 200000,
        discountAmount: 15000,
        dueDate: "2026-06-14",
        expiresAt: "2026-07-14",
        planName: "가".repeat(101),
        reason: `Smoke oversized plan ${stamp}`,
        status: "scheduled",
      }),
    },
    { allowError: true },
  );
  assert(result.response.status === 400, "manual payment update must reject an oversized plan name");

  result = await owner.request(
    `/api/v1/payments/${createdPayment.id}?selectedBranchId=branch-gangnam`,
    {
      method: "PATCH",
      body: JSON.stringify({
        amount: 200000,
        discountAmount: 15000,
        dueDate: "2026-06-14",
        expiresAt: "2026-07-14",
        planName: `Smoke Plan Revised ${stamp}`,
        reason: "가".repeat(501),
        status: "scheduled",
      }),
    },
    { allowError: true },
  );
  assert(result.response.status === 400, "manual payment update must reject an oversized audit reason");

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
    `/api/v1/payments/${createdPayment.id}/refund?selectedBranchId=branch-gangnam`,
    {
      method: "POST",
      body: JSON.stringify({ amount: 40000, reason: "가".repeat(501) }),
    },
    { allowError: true },
  );
  assert(result.response.status === 400, "payment refund must reject an oversized audit reason");

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

  result = await owner.request(
    `/api/v1/payments/${createdPayment.id}/refund?selectedBranchId=branch-gangnam`,
    {
      method: "POST",
      body: JSON.stringify({
        amount: 40000,
        reason: { unexpected: true },
      }),
    },
    { allowError: true },
  );
  assert.equal(result.response.status, 400, "malformed payment refund fields must fail without a server error");
  result = await owner.request("/api/v1/me/bootstrap?selectedBranchId=branch-gangnam");
  assert.equal(
    result.payload.data.db.payments.find((payment) => payment.id === createdPayment.id)?.refundedAmount ?? 0,
    0,
    "malformed payment refund fields must not change the payment",
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
    headers: createPaymentRequestHeaders("cancel-create"),
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
      amount: 1000,
      reason: `Smoke invalid unpaid refund ${stamp}`,
    }),
  }, { allowError: true });
  assert(result.response.status === 422, "scheduled payments must not be refundable before payment completion");
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
    headers: createPaymentRequestHeaders("delete-create"),
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
      body: JSON.stringify({ reason: "가".repeat(501) }),
    },
    { allowError: true },
  );
  assert(result.response.status === 400, "manual payment deletion must reject an oversized audit reason");
  result = await owner.request("/api/v1/me/bootstrap?selectedBranchId=branch-gangnam");
  assert(
    result.payload.data.db.payments.some((payment) => payment.id === deletePaymentCandidate.id),
    "an oversized deletion reason must not remove the payment",
  );

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
    headers: createPaymentRequestHeaders("online-create"),
    body: JSON.stringify({
      memberId: "member-seo",
      planName: `Smoke Online Plan ${stamp}`,
      status: "scheduled",
      amount: 160000,
      discountAmount: 10000,
      discountReason: smokeDiscountReason,
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
  result = await owner.request("/api/v1/payments/webhook", {
    method: "POST",
    headers: {
      "x-final-judo-payment-webhook-secret": "final-judo-dev-webhook-secret",
    },
    body: JSON.stringify({
      amount: 150000,
      event: "paid",
      providerPaymentId,
    }),
  }, { allowError: true });
  assert(result.response.status === 400, "payment webhook must require a provider event id");

  result = await owner.request("/api/v1/payments/webhook", {
    method: "POST",
    headers: {
      "x-final-judo-payment-webhook-secret": "final-judo-dev-webhook-secret",
    },
    body: JSON.stringify({
      amount: 150000,
      event: "paid",
      providerEventId: `evt-malformed-provider-${stamp}`,
      providerPaymentId: {},
    }),
  }, { allowError: true });
  assert(result.response.status === 400, "payment webhook must reject non-string provider payment ids without a server error");

  result = await owner.request("/api/v1/payments/webhook", {
    method: "POST",
    headers: {
      "x-final-judo-payment-webhook-secret": "final-judo-dev-webhook-secret",
    },
    body: JSON.stringify({
      amount: 150000,
      event: "paid",
      providerEventId: `evt-malformed-receipt-${stamp}`,
      providerPaymentId,
      receiptId: {},
    }),
  }, { allowError: true });
  assert(result.response.status === 400, "payment webhook must reject non-string receipt ids without a server error");

  result = await owner.request("/api/v1/payments/webhook", {
    method: "POST",
    headers: {
      "x-final-judo-payment-webhook-secret": "final-judo-dev-webhook-secret",
    },
    body: JSON.stringify({
      amount: 150000,
      event: "paid",
      providerEventId: `evt-unsafe-receipt-url-${stamp}`,
      providerPaymentId,
      receiptId: `receipt-unsafe-${stamp}`,
      receiptUrl: "javascript:alert(1)",
    }),
  }, { allowError: true });
  assert(result.response.status === 400, "payment webhook must reject non-HTTPS receipt URLs");

  result = await owner.request("/api/v1/me/bootstrap?selectedBranchId=branch-gangnam");
  const paymentAfterInvalidReceiptMetadata = result.payload.data.db.payments.find(
    (payment) => payment.id === onlinePaymentSeed.id,
  );
  assert(paymentAfterInvalidReceiptMetadata?.status === "scheduled", "invalid receipt metadata must not change payment status");
  assert(
    paymentAfterInvalidReceiptMetadata?.statusHistory?.length === onlineCheckoutPayment.statusHistory?.length,
    "invalid receipt metadata must not append payment status history",
  );
  assert(
    !result.payload.data.db.auditLogs.some(
      (log) => log.action === "payment.webhook" && log.targetId === onlinePaymentSeed.id,
    ),
    "invalid receipt metadata must not append a payment webhook audit log",
  );

  result = await owner.request("/api/v1/payments/webhook", {
    method: "POST",
    headers: {
      "x-final-judo-payment-webhook-secret": "final-judo-dev-webhook-secret",
    },
    body: JSON.stringify({
      amount: 149999,
      event: "paid",
      providerEventId: `evt-paid-mismatch-${stamp}`,
      providerPaymentId,
    }),
  }, { allowError: true });
  assert(result.response.status === 422, "payment webhook must reject a paid amount mismatch");

  const webhookResult = await owner.request("/api/v1/payments/webhook", {
    method: "POST",
    headers: {
      "x-final-judo-payment-webhook-secret": "final-judo-dev-webhook-secret",
    },
    body: JSON.stringify({
      amount: 150000,
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

  const missingRefundEventId = `evt-refund-missing-amount-${stamp}`;
  result = await owner.request(
    "/api/v1/payments/webhook",
    {
      method: "POST",
      headers: {
        "x-final-judo-payment-webhook-secret": "final-judo-dev-webhook-secret",
      },
      body: JSON.stringify({
        event: "refunded",
        occurredAt: new Date().toISOString(),
        providerEventId: missingRefundEventId,
        providerPaymentId,
      }),
    },
    { allowError: true },
  );
  assert(result.response.status === 400, "payment refund webhook must require an explicit refund amount");
  result = await owner.request("/api/v1/me/bootstrap?selectedBranchId=branch-gangnam");
  const paymentAfterMissingRefundAmount = result.payload.data.db.payments.find(
    (payment) => payment.id === onlinePaymentSeed.id,
  );
  assert(paymentAfterMissingRefundAmount?.status === "paid", "missing refund amount must not change payment status");
  assert((paymentAfterMissingRefundAmount?.refundedAmount ?? 0) === 0, "missing refund amount must not change refunded amount");
  assert(
    !paymentAfterMissingRefundAmount?.onlinePayment?.processedWebhookEventIds?.includes(missingRefundEventId),
    "missing refund amount must not consume the provider event id",
  );
  assert(
    paymentAfterMissingRefundAmount?.statusHistory?.length === webhookPayment.statusHistory.length,
    "missing refund amount must not append payment status history",
  );
  assert(
    result.payload.data.db.auditLogs.filter(
      (log) => log.action === "payment.webhook" && log.targetId === onlinePaymentSeed.id,
    ).length === webhookAuditCount,
    "missing refund amount must not append a payment webhook audit log",
  );

  const duplicateWebhookResult = await owner.request("/api/v1/payments/webhook", {
    method: "POST",
    headers: {
      "x-final-judo-payment-webhook-secret": "final-judo-dev-webhook-secret",
      "x-final-judo-payment-event-id": providerEventId,
    },
    body: JSON.stringify({
      amount: 150000,
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

  result = await owner.request("/api/v1/branches/branch-gangnam/payments?selectedBranchId=branch-gangnam", {
    method: "POST",
    headers: createPaymentRequestHeaders("provider-event-conflict-create"),
    body: JSON.stringify({
      memberId: "member-seo",
      planName: `Smoke Provider Event Conflict ${stamp}`,
      status: "scheduled",
      amount: 150000,
      discountAmount: 0,
      dueDate: "2026-06-22",
      expiresAt: "2026-07-22",
    }),
  });
  const providerEventConflictSeed = result.payload.data.db.payments.find(
    (payment) => payment.planName === `Smoke Provider Event Conflict ${stamp}`,
  );
  assert(providerEventConflictSeed, "cross-payment provider event conflict fixture must be created");

  result = await owner.request(
    `/api/v1/payments/${providerEventConflictSeed.id}/online-checkout?selectedBranchId=branch-gangnam`,
    { method: "POST", body: JSON.stringify({}) },
  );
  const providerEventConflictPayment = result.payload.data.db.payments.find(
    (payment) => payment.id === providerEventConflictSeed.id,
  );
  const providerEventConflictPaymentId = providerEventConflictPayment?.onlinePayment?.providerPaymentId;
  assert(providerEventConflictPaymentId, "cross-payment provider event conflict fixture must have a provider payment id");
  const providerEventConflictAuditCount = result.payload.data.db.auditLogs.filter(
    (log) => log.action === "payment.webhook" && log.targetId === providerEventConflictSeed.id,
  ).length;

  result = await owner.request(
    "/api/v1/payments/webhook",
    {
      method: "POST",
      headers: {
        "x-final-judo-payment-webhook-secret": "final-judo-dev-webhook-secret",
      },
      body: JSON.stringify({
        amount: 150000,
        event: "paid",
        providerEventId,
        providerPaymentId: providerEventConflictPaymentId,
      }),
    },
    { allowError: true },
  );
  assert(result.response.status === 409, "provider event id must not be reusable across payments");
  assert(result.payload.error?.code === "PROVIDER_EVENT_CONFLICT", "cross-payment provider event reuse must expose a stable conflict code");

  result = await owner.request("/api/v1/me/bootstrap?selectedBranchId=branch-gangnam");
  const paymentAfterProviderEventConflict = result.payload.data.db.payments.find(
    (payment) => payment.id === providerEventConflictSeed.id,
  );
  assert(paymentAfterProviderEventConflict?.status === "scheduled", "cross-payment provider event conflict must not mutate the second payment");
  assert(paymentAfterProviderEventConflict?.onlinePayment?.status === "pending", "cross-payment provider event conflict must keep checkout pending");
  assert(
    !paymentAfterProviderEventConflict?.statusHistory?.some((entry) => entry.providerEventId === providerEventId),
    "cross-payment provider event conflict must not append status history",
  );
  assert(
    result.payload.data.db.auditLogs.filter(
      (log) => log.action === "payment.webhook" && log.targetId === providerEventConflictSeed.id,
    ).length === providerEventConflictAuditCount,
    "cross-payment provider event conflict must not append an audit log",
  );

  result = await owner.request("/api/v1/branches/branch-gangnam/payments?selectedBranchId=branch-gangnam", {
    method: "POST",
    headers: createPaymentRequestHeaders("provider-event-concurrency-create"),
    body: JSON.stringify({
      memberId: "member-seo",
      planName: `Smoke Provider Event Concurrency ${stamp}`,
      status: "scheduled",
      amount: 150000,
      discountAmount: 0,
      dueDate: "2026-06-23",
      expiresAt: "2026-07-23",
    }),
  });
  const providerEventConcurrencySeed = result.payload.data.db.payments.find(
    (payment) => payment.planName === `Smoke Provider Event Concurrency ${stamp}`,
  );
  assert(providerEventConcurrencySeed, "concurrent provider event fixture must be created");

  result = await owner.request(
    `/api/v1/payments/${providerEventConcurrencySeed.id}/online-checkout?selectedBranchId=branch-gangnam`,
    { method: "POST", body: JSON.stringify({}) },
  );
  const providerEventConcurrencyPayment = result.payload.data.db.payments.find(
    (payment) => payment.id === providerEventConcurrencySeed.id,
  );
  const providerEventConcurrencyPaymentId = providerEventConcurrencyPayment?.onlinePayment?.providerPaymentId;
  assert(providerEventConcurrencyPaymentId, "concurrent provider event fixture must have a provider payment id");

  const concurrentProviderEventId = `evt-paid-concurrent-${stamp}`;
  const concurrentWebhookRequest = (candidateProviderPaymentId) => owner.request(
    "/api/v1/payments/webhook",
    {
      method: "POST",
      headers: {
        "x-final-judo-payment-webhook-secret": "final-judo-dev-webhook-secret",
      },
      body: JSON.stringify({
        amount: 150000,
        event: "paid",
        providerEventId: concurrentProviderEventId,
        providerPaymentId: candidateProviderPaymentId,
      }),
    },
    { allowError: true },
  );
  const concurrentWebhookResults = await Promise.all([
    concurrentWebhookRequest(providerEventConflictPaymentId),
    concurrentWebhookRequest(providerEventConcurrencyPaymentId),
  ]);
  assert.deepEqual(
    concurrentWebhookResults.map(({ response }) => response.status).sort((left, right) => left - right),
    [200, 409],
    "concurrent provider event reuse must allow exactly one payment mutation",
  );
  assert(
    concurrentWebhookResults.find(({ response }) => response.status === 409)?.payload.error?.code ===
      "PROVIDER_EVENT_CONFLICT",
    "concurrent provider event reuse must expose a stable conflict code",
  );

  result = await owner.request("/api/v1/me/bootstrap?selectedBranchId=branch-gangnam");
  const concurrentProviderEventPayments = result.payload.data.db.payments.filter((payment) =>
    [providerEventConflictSeed.id, providerEventConcurrencySeed.id].includes(payment.id),
  );
  assert(
    concurrentProviderEventPayments.filter((payment) => payment.status === "paid").length === 1 &&
      concurrentProviderEventPayments.filter((payment) => payment.status === "scheduled").length === 1,
    "concurrent provider event reuse must leave exactly one payment paid and one pending",
  );
  assert(
    concurrentProviderEventPayments.filter((payment) =>
      payment.statusHistory?.some((entry) => entry.providerEventId === concurrentProviderEventId),
    ).length === 1,
    "concurrent provider event reuse must persist the event id on exactly one payment",
  );
  assert(
    result.payload.data.db.auditLogs.filter(
      (log) =>
        log.action === "payment.webhook" &&
        [providerEventConflictSeed.id, providerEventConcurrencySeed.id].includes(log.targetId) &&
        log.after?.onlinePayment?.processedWebhookEventIds?.includes(concurrentProviderEventId),
    ).length === 1,
    "concurrent provider event reuse must append exactly one audit log",
  );

  const crossMutationPayment = concurrentProviderEventPayments.find((payment) => payment.status === "scheduled");
  const crossMutationProviderEventId = `evt-cross-mutation-${stamp}`;
  assert(crossMutationPayment?.onlinePayment, "cross-mutation payment must retain a pending online payment request");
  const crossMutationResults = await Promise.all([
    owner.request("/api/v1/payments/webhook", {
      method: "POST",
      headers: {
        "x-final-judo-payment-webhook-secret": "final-judo-dev-webhook-secret",
      },
      body: JSON.stringify({
        amount: crossMutationPayment.onlinePayment.amount,
        event: "paid",
        occurredAt: new Date().toISOString(),
        providerEventId: crossMutationProviderEventId,
        providerPaymentId: crossMutationPayment.onlinePayment.providerPaymentId,
      }),
    }, { allowError: true }),
    owner.request(`/api/v1/payments/${crossMutationPayment.id}/recurring-agreement?selectedBranchId=branch-gangnam`, {
      method: "POST",
      body: JSON.stringify({ nextBillingDate: "2026-08-22" }),
    }, { allowError: true }),
  ]);
  assert.deepEqual(
    crossMutationResults.map(({ response }) => response.status).sort((left, right) => left - right),
    [200, 200],
    "concurrent webhook and recurring agreement creation must both preserve their mutation",
  );
  result = await owner.request("/api/v1/me/bootstrap?selectedBranchId=branch-gangnam");
  const crossMutationFinalPayment = result.payload.data.db.payments.find((payment) => payment.id === crossMutationPayment.id);
  assert(
    crossMutationFinalPayment?.status === "paid" &&
      crossMutationFinalPayment.onlinePayment?.status === "paid" &&
      crossMutationFinalPayment.recurringAgreement,
    "concurrent webhook and recurring agreement creation must preserve both final states",
  );
  assert(
    crossMutationFinalPayment.statusHistory?.filter((entry) => entry.providerEventId === crossMutationProviderEventId).length === 1 &&
      crossMutationFinalPayment.statusHistory?.filter((entry) => entry.event === "recurring_agreement").length === 1,
    "concurrent webhook and recurring agreement creation must append both history events once",
  );
  assert(
    result.payload.data.db.auditLogs.filter(
      (log) => log.targetId === crossMutationPayment.id &&
        (log.action === "payment.webhook" || log.action === "payment.recurring_agreement.create"),
    ).length === 2,
    "concurrent webhook and recurring agreement creation must append both audit logs once",
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
      nextBillingDate: "2026-02-30",
    }),
  }, { allowError: true });
  assert(result.response.status === 400, "recurring agreement create must reject impossible calendar dates");

  result = await owner.request(`/api/v1/payments/${onlinePaymentSeed.id}/recurring-agreement?selectedBranchId=branch-gangnam`, {
    method: "POST",
    body: JSON.stringify({
      billingDayOfMonth: 29,
    }),
  }, { allowError: true });
  assert(result.response.status === 400, "recurring agreement create must reject billing days outside 1-28");

  result = await owner.request(`/api/v1/payments/${onlinePaymentSeed.id}/recurring-agreement?selectedBranchId=branch-gangnam`, {
    method: "POST",
    body: JSON.stringify([]),
  }, { allowError: true });
  assert(result.response.status === 400, "recurring agreement create must reject non-object payloads");

  const recurringCreateRequest = () => owner.request(
    `/api/v1/payments/${onlinePaymentSeed.id}/recurring-agreement?selectedBranchId=branch-gangnam`,
    {
      method: "POST",
      body: JSON.stringify({ nextBillingDate: "2026-07-22" }),
    },
    { allowError: true },
  );
  const recurringCreateResults = await Promise.all([recurringCreateRequest(), recurringCreateRequest()]);
  assert.deepEqual(
    recurringCreateResults.map(({ response }) => response.status).sort((left, right) => left - right),
    [200, 409],
    "concurrent recurring agreement creation must persist exactly one agreement",
  );
  assert(
    recurringCreateResults.find(({ response }) => response.status === 409)?.payload.error?.code === "BUSINESS_RULE_FAILED",
    "duplicate recurring agreement creation must expose a stable business conflict code",
  );
  result = recurringCreateResults.find(({ response }) => response.status === 200);
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
    result.payload.data.db.auditLogs.filter(
      (log) => log.action === "payment.recurring_agreement.create" && log.targetId === onlinePaymentSeed.id,
    ).length === 1,
    "concurrent recurring agreement creation must append one audit log",
  );
  assert(
    recurringPayment.statusHistory?.filter((entry) => entry.event === "recurring_agreement").length === 1,
    "concurrent recurring agreement creation must append one status history event",
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
      reason: { text: `Smoke recurring cancellation ${stamp}` },
    }),
  }, { allowError: true });
  assert(result.response.status === 400, "recurring agreement cancel must reject a non-string reason without a server error");

  const recurringCancelReason = `Smoke recurring cancellation ${stamp}`;
  const recurringCancelRequest = () => owner.request(
    `/api/v1/payments/${onlinePaymentSeed.id}/recurring-agreement?selectedBranchId=branch-gangnam`,
    {
      method: "DELETE",
      body: JSON.stringify({ reason: recurringCancelReason }),
    },
    { allowError: true },
  );
  const recurringCancelResults = await Promise.all([recurringCancelRequest(), recurringCancelRequest()]);
  assert.deepEqual(
    recurringCancelResults.map(({ response }) => response.status).sort((left, right) => left - right),
    [200, 422],
    "concurrent recurring agreement cancellation must persist exactly one cancellation",
  );
  result = recurringCancelResults.find(({ response }) => response.status === 200);
  const cancelledRecurringPayment = result.payload.data.db.payments.find((payment) => payment.id === onlinePaymentSeed.id);

  assert(cancelledRecurringPayment?.recurringAgreement?.status === "cancelled", "recurring agreement cancellation did not persist");
  assert(
    cancelledRecurringPayment.recurringAgreement.cancelReason === recurringCancelReason,
    "recurring agreement cancellation reason missing",
  );
  assert(
    result.payload.data.db.auditLogs.filter(
      (log) => log.action === "payment.recurring_agreement.cancel" && log.targetId === onlinePaymentSeed.id,
    ).length === 1,
    "concurrent recurring agreement cancellation must append one audit log",
  );
  assert(
    cancelledRecurringPayment.statusHistory?.filter((entry) => entry.event === "recurring_agreement").length === 2,
    "recurring agreement lifecycle must contain one create and one cancel history event",
  );

  const coachAfterOnlinePayment = await coach.request("/api/v1/me/bootstrap?selectedBranchId=branch-gangnam");
  assert.equal(
    coachAfterOnlinePayment.payload.data.db.payments.length,
    0,
    "coach bootstrap must not include online payment or recurring agreement records",
  );

  const exportAuditBefore = await owner.request("/api/v1/me/bootstrap?selectedBranchId=branch-gangnam");
  const previousExportAuditIds = new Set(
    exportAuditBefore.payload.data.db.auditLogs
      .filter((log) => log.action === "export.create")
      .map((log) => log.id),
  );
  const [exportResult, secondPaymentExportResult, operationsExportResult, secondOperationsExportResult] =
    await Promise.all([
      owner.request(
        "/api/v1/exports/payments?selectedBranchId=branch-gangnam",
        {},
        { responseType: "text" },
      ),
      owner.request(
        "/api/v1/exports/payments?selectedBranchId=branch-gangnam",
        {},
        { responseType: "text" },
      ),
      owner.request(
        "/api/v1/exports/operations?selectedBranchId=branch-gangnam",
        {},
        { responseType: "text" },
      ),
      owner.request(
        "/api/v1/exports/operations?selectedBranchId=branch-gangnam",
        {},
        { responseType: "text" },
      ),
    ]);
  const exportedCsv = exportResult.payload;

  assert(exportResult.response.headers.get("content-type")?.includes("text/csv"), "payment export must return CSV");
  assert(secondPaymentExportResult.response.ok, "concurrent payment export must succeed");
  assert(
    exportedCsv.includes("branch,member,plan,status,amount_krw,discount_krw,refunded_krw,refund_reason,due_date,expires_at,status_history_count,last_status_changed_at,last_status_reason,online_payment_status,online_provider_payment_id,online_requested_at,online_paid_at,receipt_id,receipt_url,recurring_status,recurring_provider_agreement_id,recurring_next_billing_date,recurring_cancelled_at,recurring_cancel_reason"),
    "payment export CSV header missing",
  );

  const exportedOperationsCsv = operationsExportResult.payload;

  assert(operationsExportResult.response.headers.get("content-type")?.includes("text/csv"), "operations export must return CSV");
  assert(secondOperationsExportResult.response.ok, "concurrent operations export must succeed");
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
  const newExportAudits = result.payload.data.db.auditLogs.filter(
    (log) => log.action === "export.create" && !previousExportAuditIds.has(log.id),
  );
  assert.equal(newExportAudits.length, 4, "concurrent payment and operations exports must preserve all four audit records");
  assert.equal(new Set(newExportAudits.map((log) => log.id)).size, 4, "concurrent export audit IDs must be unique");
  assert.equal(new Set(newExportAudits.map((log) => log.targetId)).size, 4, "concurrent export target IDs must be unique");
  assert.equal(
    newExportAudits.filter((log) => log.after?.type === "payments").length,
    2,
    "concurrent payment exports must each be audited",
  );
  assert.equal(
    newExportAudits.filter((log) => log.after?.type === "operations").length,
    2,
    "concurrent operations exports must each be audited",
  );
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

  result = await owner.request(
    "/api/v1/branches/branch-gangnam/notices?selectedBranchId=branch-gangnam",
    {
      method: "POST",
      body: JSON.stringify({
        title: { unexpected: true },
        body: "Malformed notice body",
        audience: ["all"],
      }),
    },
    { allowError: true },
  );
  assert.equal(result.response.status, 400, "malformed notice create fields must fail without a server error");

  const noticeSnapshotBeforeLimitRejections = await owner.request(
    "/api/v1/me/bootstrap?selectedBranchId=branch-gangnam",
  );
  const noticeCountBeforeLimitRejections = noticeSnapshotBeforeLimitRejections.payload.data.db.notices.length;
  const noticeAuditCountBeforeLimitRejections = noticeSnapshotBeforeLimitRejections.payload.data.db.auditLogs.filter(
    (log) => log.action === "notice.create",
  ).length;
  for (const invalidNoticeBody of [
    { audience: ["all"], body: "본문", title: "가".repeat(121) },
    { audience: ["all"], body: "가".repeat(5_001), title: "본문 초과 공지" },
    {
      audience: ["member"],
      body: "대상 제한 공지",
      targetMemberIds: Array.from({ length: 501 }, () => "member-minjae"),
      title: "대상 제한 공지",
    },
  ]) {
    const limitedNoticeCreate = await owner.request(
      "/api/v1/branches/branch-gangnam/notices?selectedBranchId=branch-gangnam",
      { method: "POST", body: JSON.stringify(invalidNoticeBody) },
      { allowError: true },
    );
    assert.equal(limitedNoticeCreate.response.status, 400, "oversized notice create input must be rejected");
  }
  result = await owner.request("/api/v1/me/bootstrap?selectedBranchId=branch-gangnam");
  assert.equal(result.payload.data.db.notices.length, noticeCountBeforeLimitRejections, "oversized notice input must not create records");
  assert.equal(
    result.payload.data.db.auditLogs.filter((log) => log.action === "notice.create").length,
    noticeAuditCountBeforeLimitRejections,
    "oversized notice input must not create audit records",
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

  const oversizedNoticeUpdate = await owner.request(
    `/api/v1/branches/branch-gangnam/notices/${createdNotice.id}?selectedBranchId=branch-gangnam`,
    { method: "PATCH", body: JSON.stringify({ title: "수".repeat(121) }) },
    { allowError: true },
  );
  assert.equal(oversizedNoticeUpdate.response.status, 400, "oversized notice updates must be rejected");
  result = await owner.request("/api/v1/me/bootstrap?selectedBranchId=branch-gangnam");
  assert.equal(
    result.payload.data.db.notices.find((notice) => notice.id === createdNotice.id)?.title,
    createdNotice.title,
    "oversized notice updates must preserve the existing notice",
  );

  const concurrentNoticeTitles = [`Smoke Concurrent Notice A ${stamp}`, `Smoke Concurrent Notice B ${stamp}`];
  const createConcurrentNotice = (title) =>
    owner.request("/api/v1/branches/branch-gangnam/notices?selectedBranchId=branch-gangnam", {
      method: "POST",
      body: JSON.stringify({
        title,
        body: "Concurrent operator notice",
        audience: ["owner"],
      }),
    });
  await Promise.all(concurrentNoticeTitles.map(createConcurrentNotice));
  result = await owner.request("/api/v1/me/bootstrap?selectedBranchId=branch-gangnam");
  const concurrentNotices = result.payload.data.db.notices.filter((notice) => concurrentNoticeTitles.includes(notice.title));
  assert.equal(concurrentNotices.length, 2, "concurrent notice creation must preserve both records");
  assert.equal(new Set(concurrentNotices.map((notice) => notice.id)).size, 2, "concurrent notice IDs must be unique");
  assert.equal(
    result.payload.data.db.auditLogs.filter(
      (log) => log.action === "notice.create" && concurrentNotices.some((notice) => notice.id === log.targetId),
    ).length,
    2,
    "concurrent notice creation must preserve both create audit logs",
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
  assert(blockedMemberNoticeBulkRead.response.status === 404, "guardian must not discover or bulk-read another member notice");
  const missingNoticeBulkRead = await guardianAfterLink.request(
    "/api/v1/me/notices/bulk-read?selectedBranchId=branch-gangnam",
    {
      method: "POST",
      body: JSON.stringify({ noticeIds: [`missing-notice-${stamp}`] }),
    },
    { allowError: true },
  );
  assert.deepEqual(
    blockedMemberNoticeBulkRead.payload.error,
    missingNoticeBulkRead.payload.error,
    "bulk read must not disclose whether an inaccessible notice exists",
  );
  const blockedMemberNoticeRead = await guardianAfterLink.request(
    `/api/v1/me/notices/${memberNotice.id}/read?selectedBranchId=branch-gangnam`,
    { method: "POST", body: JSON.stringify({}) },
    { allowError: true },
  );
  const missingNoticeRead = await guardianAfterLink.request(
    `/api/v1/me/notices/missing-notice-${stamp}/read?selectedBranchId=branch-gangnam`,
    { method: "POST", body: JSON.stringify({}) },
    { allowError: true },
  );
  assert.equal(blockedMemberNoticeRead.response.status, 404, "guardian must not discover or read another member notice");
  assert.deepEqual(
    blockedMemberNoticeRead.payload.error,
    missingNoticeRead.payload.error,
    "single read must not disclose whether an inaccessible notice exists",
  );
  const malformedNoticeBulkRead = await memberClient.request(
    "/api/v1/me/notices/bulk-read?selectedBranchId=branch-gangnam",
    {
      method: "POST",
      body: JSON.stringify({ noticeIds: [memberNotice.id, { invalid: true }] }),
    },
    { allowError: true },
  );
  assert.equal(malformedNoticeBulkRead.response.status, 400, "mixed-type notice batches must be rejected");
  const oversizedNoticeBulkRead = await memberClient.request(
    "/api/v1/me/notices/bulk-read?selectedBranchId=branch-gangnam",
    {
      method: "POST",
      body: JSON.stringify({ noticeIds: Array.from({ length: 51 }, () => memberNotice.id) }),
    },
    { allowError: true },
  );
  assert.equal(
    oversizedNoticeBulkRead.response.status,
    422,
    "raw notice batches over 50 items must be rejected before deduplication",
  );
  result = await memberClient.request("/api/v1/me/bootstrap?selectedBranchId=branch-gangnam");
  assert(
    !result.payload.data.db.notices.find((notice) => notice.id === memberNotice.id)?.readByUserIds.includes("user-member"),
    "invalid notice batches must not partially mark readable notices as read",
  );
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
  assert(
    !result.payload.data.db.auditLogs.some((log) => ["notice.create", "notification.dispatch"].includes(log.action)),
    "coach personal notice response must keep internal notice audit logs hidden",
  );
  const coachPersonalNoticeAuditSnapshot = await credentialClient.request(
    "/api/v1/me/bootstrap?selectedBranchId=branch-gangnam",
  );
  assertNoticeCreateDeliveryFeedback(
    result.payload.data,
    1,
    "coach personal searched-member",
    coachPersonalNoticeAuditSnapshot.payload.data.db.auditLogs,
  );
  assert(
    coachPersonalNoticeAuditSnapshot.payload.data.db.auditLogs.some(
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
  const coachNoticeAuditSnapshot = await credentialClient.request(
    "/api/v1/me/bootstrap?selectedBranchId=branch-gangnam",
  );
  assertNoticeCreateDeliveryFeedback(
    result.payload.data,
    2,
    "coach assigned-members",
    coachNoticeAuditSnapshot.payload.data.db.auditLogs,
  );

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
    !result.payload.data.db.auditLogs.some((log) => log.action === "notice.delete"),
    "coach notice delete response must keep internal notice audit logs hidden",
  );
  const coachNoticeDeleteAuditSnapshot = await credentialClient.request(
    "/api/v1/me/bootstrap?selectedBranchId=branch-gangnam",
  );
  assert(
    coachNoticeDeleteAuditSnapshot.payload.data.db.auditLogs.some(
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

  const malformedAdminBranchCreate = await admin.request(
    "/api/v1/admin/branches",
    {
      method: "POST",
      body: JSON.stringify({ name: { invalid: true }, district: "테스트 구역" }),
    },
    { allowError: true },
  );
  assert.equal(malformedAdminBranchCreate.response.status, 400, "malformed branch create values must be rejected");

  const branchCountBeforeOversizedCreate = (await admin.request("/api/v1/me/bootstrap")).payload.data.db.branches.length;
  for (const oversizedField of [
    { name: "지".repeat(81), district: "테스트 구역" },
    { name: `길이 제한 지점 ${stamp}`, district: "구".repeat(101) },
    { name: `대표 제한 지점 ${stamp}`, district: "테스트 구역", ownerUserId: "u".repeat(201) },
  ]) {
    const oversizedBranchCreate = await admin.request(
      "/api/v1/admin/branches",
      { method: "POST", body: JSON.stringify(oversizedField) },
      { allowError: true },
    );
    assert.equal(oversizedBranchCreate.response.status, 400, "oversized branch create values must be rejected");
  }
  result = await admin.request("/api/v1/me/bootstrap");
  assert.equal(
    result.payload.data.db.branches.length,
    branchCountBeforeOversizedCreate,
    "oversized branch creates must not persist branches",
  );

  async function assertSlowBranchBodyDoesNotHoldLock({
    label,
    probeBody,
    probeMethod,
    probePath,
    slowMethod,
    slowPath,
  }) {
    let releaseSlowBody = () => {};
    const slowBody = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('{"incomplete":'));
        releaseSlowBody = () => {
          controller.enqueue(new TextEncoder().encode("}"));
          controller.close();
        };
      },
    });
    const slowRequest = admin.request(
      slowPath,
      { body: slowBody, duplex: "half", method: slowMethod },
      { allowError: true },
    );
    await wait(250);
    const probeRequest = admin.request(probePath, {
      method: probeMethod,
      body: JSON.stringify(probeBody),
    });
    const probeOutcome = await Promise.race([
      probeRequest.then((response) => ({ response, timedOut: false })),
      wait(1_000).then(() => ({ response: null, timedOut: true })),
    ]);
    releaseSlowBody();
    const [slowResult, completedProbe] = await Promise.all([slowRequest, probeRequest]);

    assert.equal(slowResult.response.status, 400, `${label} incomplete stream must finish as invalid input`);
    assert.equal(probeOutcome.timedOut, false, `${label} slow body parsing must not hold the shared branch lock`);
    assert.equal(completedProbe.response.status, 200, `${label} branch lock probe must complete successfully`);
  }

  await assertSlowBranchBodyDoesNotHoldLock({
    label: "branch create",
    probeBody: { reason: `Slow create lock probe ${stamp}` },
    probeMethod: "PATCH",
    probePath: "/api/v1/admin/branches/branch-gangnam",
    slowMethod: "POST",
    slowPath: "/api/v1/admin/branches",
  });
  await assertSlowBranchBodyDoesNotHoldLock({
    label: "branch update",
    probeBody: { ownerUserId: "user-owner" },
    probeMethod: "PUT",
    probePath: "/api/v1/admin/branches/branch-gangnam/owner",
    slowMethod: "PATCH",
    slowPath: "/api/v1/admin/branches/branch-gangnam",
  });
  await assertSlowBranchBodyDoesNotHoldLock({
    label: "branch owner assignment",
    probeBody: { district: "잠금 점검 구역", name: `Smoke Lock Probe ${stamp}` },
    probeMethod: "POST",
    probePath: "/api/v1/admin/branches",
    slowMethod: "PUT",
    slowPath: "/api/v1/admin/branches/branch-gangnam/owner",
  });

  const duplicateBranchName = `Smoke Concurrent Duplicate ${stamp}`;
  const duplicateBranchCreates = await Promise.all([
    admin.request(
      "/api/v1/admin/branches",
      { method: "POST", body: JSON.stringify({ name: duplicateBranchName, district: "동시 구역" }) },
      { allowError: true },
    ),
    admin.request(
      "/api/v1/admin/branches",
      { method: "POST", body: JSON.stringify({ name: duplicateBranchName, district: "동시 구역" }) },
      { allowError: true },
    ),
  ]);
  assert.deepEqual(
    duplicateBranchCreates.map(({ response }) => response.status).sort(),
    [200, 409],
    "concurrent duplicate branch creates must commit exactly once",
  );
  result = await admin.request("/api/v1/me/bootstrap");
  assert.equal(
    result.payload.data.db.branches.filter((branch) => branch.name === duplicateBranchName).length,
    1,
    "concurrent duplicate branch creates must persist one branch",
  );

  const distinctBranchNames = [`Smoke Concurrent A ${stamp}`, `Smoke Concurrent B ${stamp}`];
  const distinctBranchCreates = await Promise.all(
    distinctBranchNames.map((name) =>
      admin.request("/api/v1/admin/branches", {
        method: "POST",
        body: JSON.stringify({ name, district: "동시 구역" }),
      }),
    ),
  );
  assert(
    distinctBranchCreates.every(({ response }) => response.status === 200),
    "concurrent distinct branch creates must both succeed",
  );
  result = await admin.request("/api/v1/me/bootstrap");
  const distinctBranches = result.payload.data.db.branches.filter((branch) => distinctBranchNames.includes(branch.name));
  assert.equal(distinctBranches.length, 2, "concurrent distinct branches must both persist");
  assert.equal(new Set(distinctBranches.map((branch) => branch.id)).size, 2, "concurrent branch IDs must be unique");
  const distinctBranchAuditIds = result.payload.data.db.auditLogs
    .filter((log) => log.action === "branch.create" && distinctBranches.some((branch) => branch.id === log.targetId))
    .map((log) => log.id);
  assert.equal(distinctBranchAuditIds.length, 2, "concurrent branch create audits must both persist");
  assert.equal(new Set(distinctBranchAuditIds).size, 2, "concurrent branch create audit IDs must be unique");

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

  const malformedAdminBranchUpdate = await admin.request(
    `/api/v1/admin/branches/${createdBranch.id}`,
    {
      method: "PATCH",
      body: JSON.stringify({ name: ["잘못된 지점명"], reason: `Malformed branch update ${stamp}` }),
    },
    { allowError: true },
  );
  assert.equal(malformedAdminBranchUpdate.response.status, 400, "malformed branch updates must be rejected");

  const branchMutationSnapshotBeforeLengthRejections = await admin.request("/api/v1/me/bootstrap");
  const branchBeforeLengthRejections = branchMutationSnapshotBeforeLengthRejections.payload.data.db.branches.find(
    (branch) => branch.id === createdBranch.id,
  );
  const branchAuditCountBeforeLengthRejections = branchMutationSnapshotBeforeLengthRejections.payload.data.db.auditLogs.filter(
    (log) => ["branch.update", "branch.owner.assign"].includes(log.action) && log.targetId === createdBranch.id,
  ).length;
  for (const oversizedField of [
    { name: "지".repeat(81), reason: `Oversized branch name ${stamp}` },
    { district: "구".repeat(101), reason: `Oversized branch district ${stamp}` },
    { reason: "사".repeat(501) },
    { reason: `Oversized branch timezone ${stamp}`, timezone: "t".repeat(65) },
  ]) {
    const oversizedBranchUpdate = await admin.request(
      `/api/v1/admin/branches/${createdBranch.id}`,
      { method: "PATCH", body: JSON.stringify(oversizedField) },
      { allowError: true },
    );
    assert.equal(oversizedBranchUpdate.response.status, 400, "oversized branch update values must be rejected");
  }
  const oversizedBranchOwner = await admin.request(
    `/api/v1/admin/branches/${createdBranch.id}/owner`,
    { method: "PUT", body: JSON.stringify({ ownerUserId: "u".repeat(201) }) },
    { allowError: true },
  );
  assert.equal(oversizedBranchOwner.response.status, 400, "oversized branch owner values must be rejected");
  result = await admin.request("/api/v1/me/bootstrap");
  assert.deepEqual(
    result.payload.data.db.branches.find((branch) => branch.id === createdBranch.id),
    branchBeforeLengthRejections,
    "oversized branch mutations must preserve the branch",
  );
  assert.equal(
    result.payload.data.db.auditLogs.filter(
      (log) => ["branch.update", "branch.owner.assign"].includes(log.action) && log.targetId === createdBranch.id,
    ).length,
    branchAuditCountBeforeLengthRejections,
    "oversized branch mutations must not append audit records",
  );

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

  const crossMutationBranchName = `Smoke Cross Mutation ${stamp}`;
  const crossBranchMutations = await Promise.all([
    admin.request(
      `/api/v1/admin/branches/${createdBranch.id}`,
      {
        method: "PATCH",
        body: JSON.stringify({ name: crossMutationBranchName, reason: `Concurrent branch rename ${stamp}` }),
      },
      { allowError: true },
    ),
    admin.request(
      "/api/v1/admin/branches",
      {
        method: "POST",
        body: JSON.stringify({ name: crossMutationBranchName, district: "교차 구역" }),
      },
      { allowError: true },
    ),
  ]);
  assert.deepEqual(
    crossBranchMutations.map(({ response }) => response.status).sort(),
    [200, 409],
    "concurrent branch create and rename must preserve unique names",
  );
  result = await admin.request("/api/v1/me/bootstrap");
  assert.equal(
    result.payload.data.db.branches.filter((branch) => branch.name === crossMutationBranchName).length,
    1,
    "concurrent branch create and rename must persist one matching name",
  );

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

  const malformedAdminBranchOwnerAssign = await admin.request(
    `/api/v1/admin/branches/${createdBranch.id}/owner`,
    {
      method: "PUT",
      body: JSON.stringify({ ownerUserId: { invalid: true } }),
    },
    { allowError: true },
  );
  assert.equal(malformedAdminBranchOwnerAssign.response.status, 400, "malformed branch owner values must be rejected");

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

  const malformedPasswordReset = await anonymous.request(
    "/api/v1/auth/password-reset",
    {
      method: "POST",
      body: JSON.stringify({ identifier: {} }),
    },
    { allowError: true },
  );
  assert(malformedPasswordReset.response.status === 400, "malformed password reset must fail without a server error");

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
  assert.equal(
    result.payload.data.db.auditLogs.length,
    0,
    "invited user response must keep internal invitation audit logs hidden",
  );
  const invitationAcceptAuditSnapshot = await credentialClient.request("/api/v1/me/bootstrap");
  assert(
    invitationAcceptAuditSnapshot.payload.data.db.auditLogs.some(
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
      body: JSON.stringify({ role: "coach", branchIds: ["branch-songpa"], reason: `Smoke role mismatch ${stamp}` }),
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
    body: JSON.stringify({ role: "coach", branchIds: ["branch-songpa"], reason: `Smoke invited user role update ${stamp}` }),
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
      body: JSON.stringify({ role: "owner", branchIds: ["branch-gangnam", "branch-songpa"], reason: "smoke self-lockout" }),
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
      body: JSON.stringify({ role: "coach", branchIds: ["branch-gangnam"], reason: "smoke sole owner role downgrade" }),
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

  result = await admin.request("/api/v1/me/bootstrap");
  const readinessBeforeMalformed = result.payload.data.db.pilotReadinessChecks.find(
    (check) => check.id === "pilot-mobile-attendance",
  );
  const malformedPilotReadiness = await admin.request(
    "/api/v1/admin/pilot-readiness",
    {
      method: "PATCH",
      body: JSON.stringify({
        checkId: { unexpected: true },
        status: "pending",
      }),
    },
    { allowError: true },
  );
  assert.equal(malformedPilotReadiness.response.status, 400, "malformed pilot readiness fields must fail without a server error");
  result = await admin.request("/api/v1/me/bootstrap");
  assert.deepEqual(
    result.payload.data.db.pilotReadinessChecks.find((check) => check.id === "pilot-mobile-attendance"),
    readinessBeforeMalformed,
    "malformed pilot readiness fields must not change readiness state",
  );
  const readinessAuditCountBeforeOversized = result.payload.data.db.auditLogs.filter(
    (log) => log.action === "pilot_readiness.update" && log.targetId === "pilot-mobile-attendance",
  ).length;
  const oversizedPilotReadiness = await admin.request(
    "/api/v1/admin/pilot-readiness",
    {
      method: "PATCH",
      body: JSON.stringify({
        checkId: "pilot-mobile-attendance",
        evidence: "가".repeat(1_001),
        owner: "Smoke QA",
        status: "verified",
      }),
    },
    { allowError: true },
  );
  assert.equal(oversizedPilotReadiness.response.status, 400, "oversized pilot readiness evidence must be rejected");
  result = await admin.request("/api/v1/me/bootstrap");
  assert.deepEqual(
    result.payload.data.db.pilotReadinessChecks.find((check) => check.id === "pilot-mobile-attendance"),
    readinessBeforeMalformed,
    "oversized pilot readiness evidence must not change readiness state",
  );
  assert.equal(
    result.payload.data.db.auditLogs.filter(
      (log) => log.action === "pilot_readiness.update" && log.targetId === "pilot-mobile-attendance",
    ).length,
    readinessAuditCountBeforeOversized,
    "oversized pilot readiness evidence must not create an audit log",
  );

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

  const readinessAuditCountBeforeConcurrent = result.payload.data.db.auditLogs.filter(
    (log) => log.action === "pilot_readiness.update" && log.targetId === "pilot-mobile-attendance",
  ).length;
  const concurrentReadinessResults = await Promise.all([
    admin.request("/api/v1/admin/pilot-readiness", {
      method: "PATCH",
      body: JSON.stringify({
        checkId: "pilot-mobile-attendance",
        evidence: `Concurrent blocked readiness ${stamp}`,
        owner: "Smoke QA A",
        status: "blocked",
      }),
    }),
    admin.request("/api/v1/admin/pilot-readiness", {
      method: "PATCH",
      body: JSON.stringify({
        checkId: "pilot-mobile-attendance",
        evidence: `Concurrent verified readiness ${stamp}`,
        owner: "Smoke QA B",
        status: "verified",
      }),
    }),
  ]);
  assert(
    concurrentReadinessResults.every(({ response }) => response.status === 200),
    "concurrent readiness updates must both succeed",
  );
  result = await admin.request("/api/v1/me/bootstrap");
  const concurrentReadinessAudits = result.payload.data.db.auditLogs.filter(
    (log) => log.action === "pilot_readiness.update" && log.targetId === "pilot-mobile-attendance",
  );
  assert.equal(
    concurrentReadinessAudits.length,
    readinessAuditCountBeforeConcurrent + 2,
    "concurrent readiness updates must preserve both audit logs",
  );
  assert.equal(
    new Set(concurrentReadinessAudits.map((log) => log.id)).size,
    concurrentReadinessAudits.length,
    "concurrent readiness audit IDs must be unique",
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

  result = await admin.request("/api/v1/admin/pilot-incidents");
  const pilotIncidentCountBeforeMalformed = result.payload.data.incidents.length;
  const malformedPilotIncidentCreate = await admin.request(
    "/api/v1/admin/pilot-incidents",
    {
      method: "POST",
      body: JSON.stringify({
        branchId: "branch-gangnam",
        description: "Malformed incident must not persist",
        owner: "Smoke PM",
        role: "coach",
        severity: "p2",
        title: { unexpected: true },
      }),
    },
    { allowError: true },
  );
  assert.equal(malformedPilotIncidentCreate.response.status, 400, "malformed pilot incident fields must fail without a server error");
  result = await admin.request("/api/v1/admin/pilot-incidents");
  assert.equal(
    result.payload.data.incidents.length,
    pilotIncidentCountBeforeMalformed,
    "malformed pilot incident fields must not create an incident",
  );
  result = await admin.request("/api/v1/me/bootstrap");
  const pilotIncidentCreateAuditCountBeforeOversized = result.payload.data.db.auditLogs.filter(
    (log) => log.action === "pilot_incident.create",
  ).length;
  const oversizedPilotIncidentCreate = await admin.request(
    "/api/v1/admin/pilot-incidents",
    {
      method: "POST",
      body: JSON.stringify({
        branchId: "branch-gangnam",
        description: "가".repeat(2_001),
        owner: "Smoke PM",
        role: "coach",
        severity: "p2",
        title: "Oversized incident",
      }),
    },
    { allowError: true },
  );
  assert.equal(oversizedPilotIncidentCreate.response.status, 400, "oversized pilot incident description must be rejected");
  result = await admin.request("/api/v1/me/bootstrap");
  assert.equal(
    result.payload.data.db.pilotIncidents.length,
    pilotIncidentCountBeforeMalformed,
    "oversized pilot incident description must not create an incident",
  );
  assert.equal(
    result.payload.data.db.auditLogs.filter((log) => log.action === "pilot_incident.create").length,
    pilotIncidentCreateAuditCountBeforeOversized,
    "oversized pilot incident description must not create an audit log",
  );

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

  const concurrentIncidentTitles = [`Smoke pilot incident A ${stamp}`, `Smoke pilot incident B ${stamp}`];
  const concurrentIncidentResults = await Promise.all(
    concurrentIncidentTitles.map((title) =>
      admin.request("/api/v1/admin/pilot-incidents", {
        method: "POST",
        body: JSON.stringify({
          branchId: "branch-gangnam",
          description: `Concurrent incident ${title}`,
          owner: "Smoke PM",
          role: "coach",
          severity: "p2",
          title,
          workaround: "현장 담당자에게 즉시 공유",
        }),
      }),
    ),
  );
  assert(
    concurrentIncidentResults.every(({ response }) => response.status === 200),
    "concurrent pilot incident creates must both succeed",
  );
  result = await admin.request("/api/v1/me/bootstrap");
  const concurrentIncidents = result.payload.data.db.pilotIncidents.filter((incident) =>
    concurrentIncidentTitles.includes(incident.title),
  );
  assert.equal(concurrentIncidents.length, 2, "concurrent pilot incident creates must preserve both incidents");
  assert.equal(new Set(concurrentIncidents.map((incident) => incident.id)).size, 2, "concurrent pilot incident IDs must be unique");
  const concurrentIncidentAudits = result.payload.data.db.auditLogs.filter(
    (log) => log.action === "pilot_incident.create" && concurrentIncidents.some((incident) => incident.id === log.targetId),
  );
  assert.equal(concurrentIncidentAudits.length, 2, "concurrent pilot incident creates must preserve both audit logs");
  assert.equal(new Set(concurrentIncidentAudits.map((log) => log.id)).size, 2, "concurrent pilot incident audit IDs must be unique");

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

  const malformedPilotIncidentUpdate = await admin.request(
    `/api/v1/admin/pilot-incidents/${createdIncident.id}`,
    {
      method: "PATCH",
      body: JSON.stringify({ owner: { unexpected: true }, status: "open" }),
    },
    { allowError: true },
  );
  assert.equal(malformedPilotIncidentUpdate.response.status, 400, "malformed pilot incident update fields must fail without a server error");
  result = await admin.request("/api/v1/me/bootstrap");
  assert.equal(
    result.payload.data.db.pilotIncidents.find((incident) => incident.id === createdIncident.id)?.status,
    "resolved",
    "malformed pilot incident update fields must preserve incident state",
  );
  const incidentUpdateAuditCountBeforeOversized = result.payload.data.db.auditLogs.filter(
    (log) => log.action === "pilot_incident.update" && log.targetId === createdIncident.id,
  ).length;
  const oversizedPilotIncidentUpdate = await admin.request(
    `/api/v1/admin/pilot-incidents/${createdIncident.id}`,
    {
      method: "PATCH",
      body: JSON.stringify({ status: "monitoring", workaround: "가".repeat(1_001) }),
    },
    { allowError: true },
  );
  assert.equal(oversizedPilotIncidentUpdate.response.status, 400, "oversized pilot incident workaround must be rejected");
  result = await admin.request("/api/v1/me/bootstrap");
  assert.equal(
    result.payload.data.db.pilotIncidents.find((incident) => incident.id === createdIncident.id)?.status,
    "resolved",
    "oversized pilot incident update must preserve incident state",
  );
  assert.equal(
    result.payload.data.db.auditLogs.filter(
      (log) => log.action === "pilot_incident.update" && log.targetId === createdIncident.id,
    ).length,
    incidentUpdateAuditCountBeforeOversized,
    "oversized pilot incident update must not create an audit log",
  );

  const incidentAuditCountBeforeConcurrent = result.payload.data.db.auditLogs.filter(
    (log) => log.action === "pilot_incident.update" && log.targetId === createdIncident.id,
  ).length;
  const concurrentIncidentUpdateResults = await Promise.all([
    admin.request(`/api/v1/admin/pilot-incidents/${createdIncident.id}`, {
      method: "PATCH",
      body: JSON.stringify({
        owner: "Smoke PM A",
        status: "monitoring",
        workaround: "동시 갱신 A 조치 확인",
      }),
    }),
    admin.request(`/api/v1/admin/pilot-incidents/${createdIncident.id}`, {
      method: "PATCH",
      body: JSON.stringify({
        owner: "Smoke PM B",
        status: "resolved",
        workaround: "동시 갱신 B 조치 확인",
      }),
    }),
  ]);
  assert(
    concurrentIncidentUpdateResults.every(({ response }) => response.status === 200),
    "concurrent pilot incident updates must both succeed",
  );
  result = await admin.request("/api/v1/me/bootstrap");
  const concurrentIncidentUpdateAudits = result.payload.data.db.auditLogs.filter(
    (log) => log.action === "pilot_incident.update" && log.targetId === createdIncident.id,
  );
  assert.equal(
    concurrentIncidentUpdateAudits.length,
    incidentAuditCountBeforeConcurrent + 2,
    "concurrent pilot incident updates must preserve both audit logs",
  );
  assert.equal(
    new Set(concurrentIncidentUpdateAudits.map((log) => log.id)).size,
    concurrentIncidentUpdateAudits.length,
    "concurrent pilot incident update audit IDs must be unique",
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

  const malformedPilotOperation = await admin.request(
    "/api/v1/admin/pilot-operations",
    {
      method: "POST",
      body: JSON.stringify({
        attendanceRecords: 0,
        branchId: "branch-gangnam",
        classesChecked: 0,
        date: "2026-06-19",
        noticeChecks: 0,
        noticeFollowupChecks: 0,
        owner: { unexpected: true },
        paymentChecks: 0,
        status: "pending",
      }),
    },
    { allowError: true },
  );
  assert.equal(malformedPilotOperation.response.status, 400, "malformed pilot operation fields must fail without a server error");
  result = await admin.request("/api/v1/me/bootstrap");
  assert(
    !result.payload.data.db.pilotOperationLogs.some((log) => log.date === "2026-06-19" && log.branchId === "branch-gangnam"),
    "malformed pilot operation fields must not create an operation log",
  );
  const pilotOperationAuditCountBeforeOversized = result.payload.data.db.auditLogs.filter(
    (log) => log.action === "pilot_operation.update",
  ).length;
  const oversizedPilotOperation = await admin.request(
    "/api/v1/admin/pilot-operations",
    {
      method: "POST",
      body: JSON.stringify({
        attendanceRecords: 0,
        branchId: "branch-gangnam",
        classesChecked: 0,
        date: "2026-06-19",
        mobileAttendanceEvidence: "가".repeat(501),
        noticeChecks: 0,
        noticeFollowupChecks: 0,
        owner: "Smoke PM",
        paymentChecks: 0,
        status: "pending",
      }),
    },
    { allowError: true },
  );
  assert.equal(oversizedPilotOperation.response.status, 400, "oversized pilot operation evidence must be rejected");
  result = await admin.request("/api/v1/me/bootstrap");
  assert(
    !result.payload.data.db.pilotOperationLogs.some((log) => log.date === "2026-06-19" && log.branchId === "branch-gangnam"),
    "oversized pilot operation evidence must not create an operation log",
  );
  assert.equal(
    result.payload.data.db.auditLogs.filter((log) => log.action === "pilot_operation.update").length,
    pilotOperationAuditCountBeforeOversized,
    "oversized pilot operation evidence must not create an audit log",
  );

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

  const concurrentOperationDate = "2026-06-18";
  const concurrentOperationResults = await Promise.all([
    admin.request("/api/v1/admin/pilot-operations", {
      method: "POST",
      body: JSON.stringify({
        attendanceRecords: 0,
        branchId: "branch-gangnam",
        classesChecked: 1,
        date: concurrentOperationDate,
        noticeChecks: 0,
        noticeFollowupChecks: 0,
        owner: "Smoke PM A",
        paymentChecks: 0,
        status: "pending",
      }),
    }),
    admin.request("/api/v1/admin/pilot-operations", {
      method: "POST",
      body: JSON.stringify({
        attendanceRecords: 0,
        branchId: "branch-gangnam",
        classesChecked: 2,
        date: concurrentOperationDate,
        noticeChecks: 1,
        noticeFollowupChecks: 0,
        owner: "Smoke PM B",
        paymentChecks: 0,
        status: "pending",
      }),
    }),
  ]);
  assert(
    concurrentOperationResults.every(({ response }) => response.status === 200),
    "concurrent pilot operation updates must both succeed",
  );
  result = await admin.request("/api/v1/me/bootstrap");
  const concurrentOperationLogs = result.payload.data.db.pilotOperationLogs.filter(
    (log) => log.date === concurrentOperationDate && log.branchId === "branch-gangnam",
  );
  assert.equal(concurrentOperationLogs.length, 1, "concurrent pilot operation updates must retain one log per branch and date");
  const concurrentOperationAudits = result.payload.data.db.auditLogs.filter(
    (log) => log.action === "pilot_operation.update" && log.targetId === concurrentOperationLogs[0].id,
  );
  assert.equal(concurrentOperationAudits.length, 2, "concurrent pilot operation updates must preserve both audit logs");
  assert.equal(new Set(concurrentOperationAudits.map((log) => log.id)).size, 2, "concurrent pilot operation audit IDs must be unique");

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

  const concurrentAuditQuery = `Smoke concurrent audit read ${stamp}`;
  const concurrentAuditReason = `Smoke concurrent audit retry ${stamp}`;
  const concurrentAuditPath = `/api/v1/admin/audit-logs?q=${encodeURIComponent(concurrentAuditQuery)}&reason=${encodeURIComponent(concurrentAuditReason)}`;
  const concurrentAuditReads = await Promise.all([
    admin.request(concurrentAuditPath),
    admin.request(concurrentAuditPath),
  ]);
  assert.deepEqual(
    concurrentAuditReads.map(({ response }) => response.status),
    [200, 200],
    "concurrent identical audit reads must both succeed",
  );
  const concurrentAuditInspection = await admin.request(
    `/api/v1/admin/audit-logs?action=audit_logs.read&limit=200&reason=${encodeURIComponent(`Smoke concurrent audit inspection ${stamp}`)}`,
  );
  const matchingConcurrentReadAudits = concurrentAuditInspection.payload.data.logs.filter(
    (log) => log.after?.query === concurrentAuditQuery.toLowerCase() && log.after?.reason === concurrentAuditReason,
  );
  assert.equal(
    matchingConcurrentReadAudits.length,
    1,
    "concurrent identical audit reads must persist one deduplicated audit record",
  );

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
          "isolated started-session attendance setup",
          "attendance batch type/size/length safety, unlocked body parsing, and update audit note",
          "attendance/class/payment invalid selectedBranchId API 403",
          "attendance reason route",
          "coach class QR issue and member scan authorization, unrestricted timing, auto-enrollment, per-member replay, audit, and snapshot redaction",
          "counseling note create/type and length safety/concurrency/scope/audit",
          "member guardian counseling notice invalid selectedBranchId API 403",
          "member create/update type/length safety, concurrency, profile/existence concealment, guardian input/length/unlocked-body/concurrency safety, reciprocal guardian links, and adult guardian-link block",
          "class create/update input safety and concurrency",
          "payment calendar validity and chronology, family collection input/length/unlocked-body/concurrency/existence concealment, canonical terminal-state metadata without root reason duplication, zero-amount refund immutability, detail-only correction history integrity, status changes, delete/refund/cancel lifecycle, online webhook receipt/idempotency, and recurring agreement create/cancel",
          "online and recurring payment invalid selectedBranchId API 403",
          "member/guardian CSV export API 403",
          "CSV export invalid selectedBranchId API 403",
          "payment/operations CSV export audit and concurrent audit preservation",
          "important notice create/update/read/bulk-read input limits, targeted audit, and inaccessible notice existence concealment",
          "recipient notice unread count and badge scope",
          "member and guardian personal notice inbox/read scope",
          "coach personal notice targets exactly one searched member",
          "notice read invalid selectedBranchId API 403",
          "push subscription/unsubscribe and missing VAPID dispatch audit",
          "notice delete permissions, recipient removal, coach-owned delete, and audit log",
          "admin branch user and pilot invalid selectedBranchId API 403",
          "branch create/update/owner input/length/unlocked-body safety and cross-mutation serialization",
          "owner branch-scoped invitation",
          "invite create/initial password/reuse block and admin password issue audit",
          "admin self-lockout",
          "role update audit logs",
          "pilot readiness password rotation check",
          "pilot readiness input safety/concurrent update/audit logs",
          "pilot incident create/update input safety/concurrency/audit logs",
          "pilot operation input safety/concurrent same-day update/mobile timing/audit logs",
          "audit log query/filter/reason/read audit and concurrent deduplication",
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
