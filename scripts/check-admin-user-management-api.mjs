import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import net from "node:net";

import { assertFreshNextBuild } from "./lib/next-build-readiness.mjs";

const nextBin = "node_modules/next/dist/bin/next";
const defaultPilotPassword = "FinalJudoPilot!2026";
const stamp = Date.now();
const stampPhoneSuffix = String(stamp % 100000000).padStart(8, "0");

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();

    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : null;

      server.close(() => {
        if (!port) {
          reject(new Error("Could not allocate a free localhost port."));
          return;
        }

        resolve(port);
      });
    });
  });
}

async function waitForServer(baseUrl, child, timeoutMs = 30000) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    if (child.exitCode !== null) {
      throw new Error(`Admin user API test server exited before ${baseUrl} became reachable.`);
    }

    try {
      const response = await fetch(baseUrl, { method: "GET", redirect: "manual" });

      if (response.status >= 200 && response.status < 500) {
        return;
      }
    } catch {
      // Wait until Next start finishes binding the port.
    }

    await sleep(500);
  }

  throw new Error(`Timed out waiting for admin user API test server at ${baseUrl}. Run npm run build before this check.`);
}

async function stopServer(child) {
  if (child.exitCode !== null) {
    return;
  }

  await new Promise((resolve) => {
    const timer = setTimeout(() => {
      if (child.exitCode === null) {
        child.kill("SIGTERM");
      }
      resolve();
    }, 5000);

    child.once("close", () => {
      clearTimeout(timer);
      resolve();
    });
    child.kill("SIGINT");
  });
}

function createClient(baseUrl) {
  let cookie = "";

  return {
    async request(pathname, init = {}, options = {}) {
      const response = await fetch(`${baseUrl}${pathname}`, {
        ...init,
        headers: {
          "Content-Type": "application/json",
          ...(cookie ? { Cookie: cookie } : {}),
          ...(init.headers ?? {}),
        },
      });
      const setCookie = response.headers.get("set-cookie");

      if (setCookie) {
        cookie = setCookie.split(";")[0];
      }

      const payload = await response.json().catch(() => ({}));

      if (!options.allowError && !response.ok) {
        throw new Error(`${response.status} ${payload.error?.code ?? ""} ${payload.error?.message ?? ""}`.trim());
      }

      return { payload, response };
    },
  };
}

function assertCookieMaxAge(result, expectedMaxAge, label) {
  const setCookie = result.response.headers.get("set-cookie") ?? "";

  assert(
    setCookie.includes(`Max-Age=${expectedMaxAge}`),
    `${label} must set session cookie Max-Age=${expectedMaxAge}; received ${setCookie}`,
  );
}

async function loginRole(client, role) {
  const result = await client.request("/api/v1/auth/login", {
    method: "POST",
    body: JSON.stringify({ role }),
  });

  assert.equal(result.payload.data.user.role, role, `${role} role login mismatch`);
  assert(!result.payload.data.user.passwordHash, `${role} login must not expose password hash`);
  assertCookieMaxAge(result, 60 * 60 * 8, `${role} role login`);

  return result.payload.data;
}

async function loginCredentials(client, phone, password, options = {}) {
  const result = await client.request("/api/v1/auth/login", {
    method: "POST",
    body: JSON.stringify({ phone, password, ...(options.keepSignedIn ? { keepSignedIn: true } : {}) }),
  });

  assert.equal(result.payload.data.user.phone, phone, `${phone} credential login mismatch`);
  assert(!result.payload.data.user.passwordHash, `${phone} login must not expose password hash`);
  assertCookieMaxAge(
    result,
    options.keepSignedIn ? 60 * 60 * 24 * 30 : 60 * 60 * 8,
    `${phone} credential login`,
  );

  return result.payload.data;
}

async function runAssertions(baseUrl) {
  const anonymous = createClient(baseUrl);
  const admin = createClient(baseUrl);
  await loginRole(admin, "admin");

  const owner = createClient(baseUrl);
  await loginRole(owner, "owner");

  const member = createClient(baseUrl);
  await loginRole(member, "member");

  const coach = createClient(baseUrl);
  await loginRole(coach, "coach");
  const coachBootstrap = await coach.request("/api/v1/me/bootstrap?selectedBranchId=branch-gangnam");
  assert.equal(coachBootstrap.payload.data.db.payments.length, 0, "coach bootstrap must not include payment records");

  const publicSignupClient = createClient(baseUrl);
  const publicRegisterPhone = `010${stampPhoneSuffix}`;
  const publicRegister = await publicSignupClient.request(
    "/api/v1/auth/register",
    {
      method: "POST",
      body: JSON.stringify({
        name: "휴대폰 가입 확인",
        password: `FJ-Public-${stamp}!`,
        phone: publicRegisterPhone,
      }),
    },
  );
  assert.equal(publicRegister.response.status, 200, "public register API must create phone signup accounts");
  assert.equal(publicRegister.payload.data?.ok, true, "public register API must return success");
  assert(publicRegister.payload.data?.userId, "public register API must return a user id");
  assert(publicRegister.payload.data?.memberId, "public register API must return a linked member id");

  const publicRegisterLogin = await publicSignupClient.request("/api/v1/auth/login", {
    method: "POST",
    body: JSON.stringify({
      keepSignedIn: true,
      password: `FJ-Public-${stamp}!`,
      phone: publicRegisterPhone,
    }),
  });
  assert.equal(publicRegisterLogin.response.status, 200, "phone signup user must be able to log in with the same password");
  assertCookieMaxAge(publicRegisterLogin, 60 * 60 * 24 * 30, "phone signup remembered login");

  const concurrentPhoneSuffix = String((Number(stampPhoneSuffix) + 3) % 100000000).padStart(8, "0");
  const concurrentRegisterPhone = `010${concurrentPhoneSuffix}`;
  const concurrentRegisterBody = JSON.stringify({
    name: "동시 가입 확인",
    password: `FJ-Concurrent-${stamp}!`,
    phone: concurrentRegisterPhone,
  });
  const concurrentRegisterClients = [createClient(baseUrl), createClient(baseUrl)];
  const concurrentRegisterResults = await Promise.all(
    concurrentRegisterClients.map((client) =>
      client.request(
        "/api/v1/auth/register",
        { method: "POST", body: concurrentRegisterBody },
        { allowError: true },
      ),
    ),
  );
  assert.deepEqual(
    concurrentRegisterResults.map((result) => result.response.status).sort((left, right) => left - right),
    [200, 409],
    "concurrent registration for one phone must create exactly one account and reject the duplicate",
  );
  assert.equal(
    concurrentRegisterResults.find((result) => result.response.status === 409)?.payload.error?.code,
    "CONFLICT",
    "concurrent duplicate registration must return the stable conflict code",
  );
  const concurrentRegisterBootstrap = await admin.request("/api/v1/me/bootstrap");
  const concurrentPhoneUsers = concurrentRegisterBootstrap.payload.data.db.users.filter(
    (candidate) => candidate.phone === concurrentRegisterPhone,
  );
  assert.equal(concurrentPhoneUsers.length, 1, "concurrent registration must persist one user for the phone");
  assert.equal(
    concurrentRegisterBootstrap.payload.data.db.members.filter(
      (candidate) => candidate.id === concurrentPhoneUsers[0]?.memberIds?.[0],
    ).length,
    1,
    "concurrent registration must persist one linked member profile",
  );

  const unauthenticatedUpdate = await anonymous.request(
    "/api/v1/admin/users/user-member",
    {
      method: "PATCH",
      body: JSON.stringify({}),
    },
    { allowError: true },
  );
  assert.equal(unauthenticatedUpdate.response.status, 401, "unauthenticated admin user update must require login before validation");

  const unauthenticatedPasswordIssue = await anonymous.request(
    "/api/v1/admin/users/user-member/password",
    {
      method: "POST",
      body: JSON.stringify({ temporaryPassword: "short" }),
    },
    { allowError: true },
  );
  assert.equal(
    unauthenticatedPasswordIssue.response.status,
    401,
    "unauthenticated admin password issue must require login before validation",
  );

  const unauthenticatedRoleUpdate = await anonymous.request(
    "/api/v1/admin/users/user-member/roles",
    {
      method: "PUT",
      body: JSON.stringify({}),
    },
    { allowError: true },
  );
  assert.equal(unauthenticatedRoleUpdate.response.status, 401, "unauthenticated role update must require login before validation");

  const unauthenticatedInvitation = await anonymous.request(
    "/api/v1/admin/users/invitations",
    {
      method: "POST",
      body: JSON.stringify({}),
    },
    { allowError: true },
  );
  assert.equal(unauthenticatedInvitation.response.status, 401, "unauthenticated user invitation must require login before validation");

  const ownerRoleUpdate = await owner.request(
    "/api/v1/admin/users/user-member/roles",
    {
      method: "PUT",
      body: JSON.stringify({}),
    },
    { allowError: true },
  );
  assert.equal(ownerRoleUpdate.response.status, 403, "owner must not reach role update validation through admin roles API");

  const memberInvitation = await member.request(
    "/api/v1/admin/users/invitations",
    {
      method: "POST",
      body: JSON.stringify({}),
    },
    { allowError: true },
  );
  assert.equal(memberInvitation.response.status, 403, "member must not reach invitation validation through admin invitation API");

  const unauthenticatedBranchCreate = await anonymous.request(
    "/api/v1/admin/branches",
    {
      method: "POST",
      body: JSON.stringify({}),
    },
    { allowError: true },
  );
  assert.equal(unauthenticatedBranchCreate.response.status, 401, "unauthenticated branch create must require login before validation");

  const unauthenticatedBranchUpdate = await anonymous.request(
    "/api/v1/admin/branches/branch-gangnam",
    {
      method: "PATCH",
      body: JSON.stringify({}),
    },
    { allowError: true },
  );
  assert.equal(unauthenticatedBranchUpdate.response.status, 401, "unauthenticated branch update must require login before validation");

  const unauthenticatedBranchOwner = await anonymous.request(
    "/api/v1/admin/branches/branch-gangnam/owner",
    {
      method: "PUT",
      body: JSON.stringify({}),
    },
    { allowError: true },
  );
  assert.equal(unauthenticatedBranchOwner.response.status, 401, "unauthenticated branch owner assign must require login before validation");

  const ownerBranchCreate = await owner.request(
    "/api/v1/admin/branches",
    {
      method: "POST",
      body: JSON.stringify({}),
    },
    { allowError: true },
  );
  assert.equal(ownerBranchCreate.response.status, 403, "owner must not reach branch create validation through admin branch API");

  const ownerBranchUpdate = await owner.request(
    "/api/v1/admin/branches/branch-gangnam",
    {
      method: "PATCH",
      body: JSON.stringify({}),
    },
    { allowError: true },
  );
  assert.equal(ownerBranchUpdate.response.status, 403, "owner must not reach branch update validation through admin branch API");

  const ownerBranchOwnerAssign = await owner.request(
    "/api/v1/admin/branches/branch-gangnam/owner",
    {
      method: "PUT",
      body: JSON.stringify({}),
    },
    { allowError: true },
  );
  assert.equal(ownerBranchOwnerAssign.response.status, 403, "owner must not reach branch owner validation through admin branch API");

  const inviteEmail = `admin-user-api-${stamp}@example.com`;
  const invitePhone = `011${stampPhoneSuffix}`;
  let result = await admin.request("/api/v1/admin/users/invitations?selectedBranchId=branch-gangnam", {
    method: "POST",
    body: JSON.stringify({
      branchIds: ["branch-gangnam"],
      email: inviteEmail,
      name: `관리 테스트 ${stamp}`,
      phone: invitePhone,
      role: "member",
    }),
  });
  const invitedUserId = result.payload.data.invitation.userId;
  const inviteToken = result.payload.data.invitation.token;

  assert(invitedUserId, "admin invitation must return a user id");
  assert(inviteToken, "admin invitation must return an invitation token");

  const pendingInviteeLogin = await inviteeLoginBeforeAccept(baseUrl, invitePhone, `FJ-Pending-${stamp}!`);
  assert.equal(pendingInviteeLogin.response.status, 403, "pending invited user login must not look like a password failure");
  assert.equal(
    pendingInviteeLogin.payload.error?.code,
    "ACCOUNT_PENDING",
    "pending invited user login must return account-pending status",
  );

  const acceptedPassword = `FJ-Accept-${stamp}!`;
  const invitee = createClient(baseUrl);
  result = await invitee.request(`/api/v1/auth/invitations/${inviteToken}/accept`, {
    method: "POST",
    body: JSON.stringify({ password: acceptedPassword }),
  });
  assert.equal(result.payload.data.user.id, invitedUserId, "accepted invitation user mismatch");

  const approvalEmail = `admin-user-approve-${stamp}@example.com`;
  const approvalPhone = `010${String((Number(String(stamp).slice(-8)) + 2) % 100000000).padStart(8, "0")}`;
  result = await admin.request("/api/v1/admin/users/invitations?selectedBranchId=branch-gangnam", {
    method: "POST",
    body: JSON.stringify({
      branchIds: ["branch-gangnam"],
      email: approvalEmail,
      name: `승인 테스트 ${stamp}`,
      phone: approvalPhone,
      role: "member",
    }),
  });
  const approvalUserId = result.payload.data.invitation.userId;
  const approvalPendingLogin = await inviteeLoginBeforeAccept(baseUrl, approvalPhone, `FJ-Approve-Pending-${stamp}!`);

  assert.equal(approvalPendingLogin.response.status, 403, "pending approval user login must be blocked before admin approval");
  assert.equal(approvalPendingLogin.payload.error?.code, "ACCOUNT_PENDING", "pending approval user login must return ACCOUNT_PENDING");

  const memberApproval = await member.request(
    `/api/v1/admin/users/${approvalUserId}/approve-invitation?selectedBranchId=branch-gangnam`,
    { method: "POST" },
    { allowError: true },
  );
  assert.equal(memberApproval.response.status, 403, "member must not approve invitations");

  const invalidApprovalScope = await admin.request(
    `/api/v1/admin/users/${approvalUserId}/approve-invitation?selectedBranchId=branch-missing`,
    { method: "POST" },
    { allowError: true },
  );
  assert.equal(invalidApprovalScope.response.status, 403, "invitation approval must reject invalid selectedBranchId");

  result = await admin.request(`/api/v1/admin/users/${approvalUserId}/approve-invitation?selectedBranchId=branch-gangnam`, {
    method: "POST",
  });
  const approval = result.payload.data.approval;
  const approvedUser = result.payload.data.db.users.find((user) => user.id === approvalUserId);
  const approveAudit = result.payload.data.db.auditLogs.find(
    (log) => log.action === "user.invite.approve" && log.targetId === approvalUserId,
  );
  const approveResponseText = JSON.stringify(result.payload);

  assert.equal(approval.userId, approvalUserId, "invitation approval must return approved user id");
  assert(approval.temporaryPassword, "invitation approval must return a temporary password for token-only invites");
  assert(approval.temporaryPassword.length >= 12, "invitation approval temporary password must be 12+ characters");
  assert(approvedUser, "invitation approval must return approved user in snapshot");
  assert(approveAudit, "invitation approval audit log missing");
  assert.equal(approvedUser?.invitationStatus, "accepted", "invitation approval must persist accepted status");
  assert(approvedUser?.acceptedAt, "invitation approval must set accepted timestamp");
  assert(!approvedUser?.invitationToken, "invitation approval snapshot must clear invitation token");
  assert(!("passwordHash" in approvedUser), "invitation approval response must not expose password hash");
  assert(!approveResponseText.includes("passwordHash"), "invitation approval response must not include passwordHash keys");
  assert.equal(approveAudit?.after?.passwordIssued, true, "invitation approval audit must record password issuance");
  assert(!("temporaryPassword" in approveAudit.after), "invitation approval audit must not expose temporary password");

  const approvedLogin = createClient(baseUrl);
  const approvedBootstrap = await loginCredentials(approvedLogin, approvalPhone, approval.temporaryPassword);
  assert.equal(approvedBootstrap.user.id, approvalUserId, "approved invited user must log in with generated temporary password");

  const repeatApproval = await admin.request(
    `/api/v1/admin/users/${approvalUserId}/approve-invitation?selectedBranchId=branch-gangnam`,
    { method: "POST" },
    { allowError: true },
  );
  assert.equal(repeatApproval.response.status, 409, "accepted invitation must not be approved twice");

  const shortPasswordUpdate = await admin.request(
    `/api/v1/admin/users/${invitedUserId}?selectedBranchId=branch-gangnam`,
    {
      method: "PATCH",
      body: JSON.stringify({
        branchIds: ["branch-gangnam"],
        email: inviteEmail,
        name: `관리 테스트 ${stamp}`,
        password: "short",
        phone: invitePhone,
        reason: `short password check ${stamp}`,
        role: "member",
        title: "비밀번호 검증 대상",
      }),
    },
    { allowError: true },
  );
  assert.equal(shortPasswordUpdate.response.status, 400, "short admin-updated password must be rejected");

  const defaultPasswordUpdate = await admin.request(
    `/api/v1/admin/users/${invitedUserId}?selectedBranchId=branch-gangnam`,
    {
      method: "PATCH",
      body: JSON.stringify({
        branchIds: ["branch-gangnam"],
        email: inviteEmail,
        name: `관리 테스트 ${stamp}`,
        password: defaultPilotPassword,
        phone: invitePhone,
        reason: `default password check ${stamp}`,
        role: "member",
        title: "비밀번호 검증 대상",
      }),
    },
    { allowError: true },
  );
  assert.equal(defaultPasswordUpdate.response.status, 422, "default pilot password must be rejected for admin update");

  const updatedEmail = `admin-user-api-updated-${stamp}@example.com`;
  const updatedPhoneSuffix = String((Number(String(stamp).slice(-8)) + 1) % 100000000).padStart(8, "0");
  const updatedPhone = `010${updatedPhoneSuffix}`;
  const updatedPassword = `FJ-Updated-${stamp}!`;
  const updateReason = `admin user api update ${stamp}`;

  const invalidMemberLinkUpdate = await admin.request(
    `/api/v1/admin/users/${invitedUserId}`,
    {
      method: "PATCH",
      body: JSON.stringify({
        branchIds: ["branch-songpa"],
        email: updatedEmail,
        memberIds: ["member-minjae"],
        name: `관리 수정 ${stamp}`,
        phone: updatedPhone,
        reason: `invalid member link ${stamp}`,
        role: "member",
        title: "수정된 회원",
      }),
    },
    { allowError: true },
  );
  assert.equal(invalidMemberLinkUpdate.response.status, 422, "admin user update must reject member links outside assigned branches");

  const invalidAdultGuardianChildUpdate = await admin.request(
    "/api/v1/admin/users/user-guardian?selectedBranchId=branch-gangnam",
    {
      method: "PATCH",
      body: JSON.stringify({
        branchIds: ["branch-gangnam"],
        childMemberIds: ["member-jiho"],
        email: "guardian@finaljudo.kr",
        name: "이하린",
        phone: "01072483619",
        reason: `invalid adult guardian child ${stamp}`,
        role: "guardian",
        title: "학부모",
      }),
    },
    { allowError: true },
  );
  assert.equal(
    invalidAdultGuardianChildUpdate.response.status,
    422,
    "admin user update must reject adult member ids as guardian children",
  );
  assert.match(
    invalidAdultGuardianChildUpdate.payload.error?.message ?? "",
    /성인 회원/,
    "admin user adult guardian-child rejection must explain the age policy",
  );

  result = await admin.request(`/api/v1/admin/users/${invitedUserId}`, {
    method: "PATCH",
    body: JSON.stringify({
      branchIds: ["branch-songpa"],
      email: updatedEmail,
      memberIds: ["member-harin"],
      name: `관리 수정 ${stamp}`,
      password: updatedPassword,
      phone: updatedPhone,
      reason: updateReason,
      role: "member",
      title: "수정된 회원",
    }),
  });

  const responseText = JSON.stringify(result.payload);
  const updatedUser = result.payload.data.db.users.find((user) => user.id === invitedUserId);
  const updateAudit = result.payload.data.db.auditLogs.find(
    (log) => log.action === "user.update" && log.targetId === invitedUserId,
  );

  assert.equal(updatedUser?.email, updatedEmail, "admin user update must persist email");
  assert.equal(updatedUser?.phone, updatedPhone, "admin user update must persist phone");
  assert.equal(updatedUser?.name, `관리 수정 ${stamp}`, "admin user update must persist name");
  assert.equal(updatedUser?.role, "member", "admin user update must persist role");
  assert.deepEqual(updatedUser?.branchIds, ["branch-songpa"], "admin user update must persist branch ids");
  assert.deepEqual(updatedUser?.memberIds, ["member-harin"], "admin user update must persist member app links");
  assert(updatedUser?.passwordUpdatedAt, "admin user password update must persist timestamp");
  assert(!("passwordHash" in updatedUser), "admin user update response must not expose password hash");
  assert(!responseText.includes(updatedPassword), "admin user update response must not expose raw password");
  assert(!responseText.includes("passwordHash"), "admin user update response must not include passwordHash keys");
  assert.equal(updateAudit?.after?.reason, updateReason, "admin user update audit must include reason");
  assert.equal(updateAudit?.after?.passwordUpdated, true, "admin user update audit must mark password update");
  assert.equal(updateAudit?.after?.email, "a***@example.com", "admin user update audit must mask email");
  assert.equal(
    updateAudit?.after?.phone,
    `010-****-${updatedPhone.slice(-4)}`,
    "admin user update audit must mask phone",
  );
  assert.notEqual(updateAudit?.before?.email, inviteEmail, "admin user update audit must not retain the previous raw email");
  assert.notEqual(updateAudit?.before?.phone, invitePhone, "admin user update audit must not retain the previous raw phone");
  assert(!("password" in updateAudit.after), "admin user update audit must not expose raw password");
  assert(!("passwordHash" in updateAudit.after), "admin user update audit must not expose password hash");

  const updatedLogin = createClient(baseUrl);
  const updatedBootstrap = await loginCredentials(updatedLogin, updatedPhone, updatedPassword);
  assert.equal(updatedBootstrap.user.id, invitedUserId, "admin-updated password must allow login");
  assert.deepEqual(updatedBootstrap.user.memberIds, ["member-harin"], "linked member ids must be present after credential login");
  assert(
    updatedBootstrap.db.members.some(
      (member) => member.id === "member-harin" && member.name === `관리 수정 ${stamp}` && member.emergencyContact === updatedPhone,
    ),
    "linked member data must be included in member app bootstrap with synced profile",
  );

  const ownerPasswordIssue = await owner.request(
    `/api/v1/admin/users/${invitedUserId}/password`,
    {
      method: "POST",
      body: JSON.stringify({
        reason: `owner blocked password issue ${stamp}`,
        temporaryPassword: "short",
      }),
    },
    { allowError: true },
  );
  assert.equal(ownerPasswordIssue.response.status, 403, "owner must not reach admin password validation through password API");

  const reissuedPassword = `FJ-Reissued-${stamp}!`;
  result = await admin.request(`/api/v1/admin/users/${invitedUserId}/password?selectedBranchId=branch-songpa`, {
    method: "POST",
    body: JSON.stringify({
      reason: `admin password issue ${stamp}`,
      temporaryPassword: reissuedPassword,
    }),
  });
  const passwordIssueText = JSON.stringify(result.payload);
  const passwordIssueAudit = result.payload.data.db.auditLogs.find(
    (log) => log.action === "auth.password_reset.complete" && log.targetId === invitedUserId,
  );

  assert.equal(result.payload.data.password.temporaryPassword, reissuedPassword, "admin password issue must return temporary password once");
  assert(!passwordIssueText.includes("passwordHash"), "admin password issue response must not include passwordHash keys");
  assert(passwordIssueAudit, "admin password issue must create an audit log");
  assert.equal(passwordIssueAudit?.after?.mode, "manual", "admin password issue audit must record manual mode");
  assert(!("temporaryPassword" in passwordIssueAudit.after), "admin password issue audit must not expose temporary password");
  assert(!("passwordHash" in passwordIssueAudit.after), "admin password issue audit must not expose password hash");

  const reissuedLogin = createClient(baseUrl);
  const reissuedBootstrap = await loginCredentials(reissuedLogin, updatedPhone, reissuedPassword);
  assert.equal(reissuedBootstrap.user.id, invitedUserId, "admin-reissued password must allow login");

  result = await admin.request(`/api/v1/admin/users/${invitedUserId}/roles?selectedBranchId=branch-songpa`, {
    method: "PUT",
    body: JSON.stringify({ role: "coach", reason: `temporary coach assignment ${stamp}` }),
  });
  assert.equal(
    result.payload.data.db.users.find((candidate) => candidate.id === invitedUserId)?.role,
    "coach",
    "role update must allow an assigned branch user to become a coach",
  );
  const classStart = new Date(Date.now() + 24 * 60 * 60 * 1000);
  const classEnd = new Date(classStart.getTime() + 60 * 60 * 1000);
  const assignedClass = await admin.request(
    "/api/v1/branches/branch-songpa/classes?selectedBranchId=branch-songpa",
    {
      method: "POST",
      body: JSON.stringify({
        ageGroup: "adult",
        capacity: 10,
        coachId: invitedUserId,
        endsAt: classEnd.toISOString(),
        enrolledMemberIds: [],
        level: "입문",
        name: `역할 인계 검증 ${stamp}`,
        room: "송파관",
        startsAt: classStart.toISOString(),
      }),
    },
  );
  const assignedClassId = assignedClass.payload.data.db.classes.find(
    (session) => session.name === `역할 인계 검증 ${stamp}`,
  )?.id;
  assert(assignedClassId, "role reassignment test must create a class for the temporary coach");
  result = await admin.request(`/api/v1/admin/users/${invitedUserId}/roles?selectedBranchId=branch-songpa`, {
    method: "PUT",
    body: JSON.stringify({ role: "member", reason: `temporary coach removal ${stamp}` }),
  });
  assert.notEqual(
    result.payload.data.db.classes.find((session) => session.id === assignedClassId)?.coachId,
    invitedUserId,
    "removing the coach role must reassign assigned classes",
  );
  const roleReassignmentAudit = result.payload.data.db.auditLogs.find(
    (log) => log.action === "user.role.update" && log.targetId === invitedUserId && log.after?.role === "member",
  );
  assert.equal(
    roleReassignmentAudit?.after?.reassignedClassCount,
    1,
    "role update audit must record reassigned class count",
  );

  const soleOwnerDemotion = await admin.request(
    "/api/v1/admin/users/user-owner/roles?selectedBranchId=branch-songpa",
    {
      method: "PUT",
      body: JSON.stringify({ role: "member", reason: `sole owner protection ${stamp}` }),
    },
    { allowError: true },
  );
  assert.equal(soleOwnerDemotion.response.status, 422, "sole branch owner role removal must be blocked");

  const ownerUpdate = await owner.request(
    `/api/v1/admin/users/${invitedUserId}`,
    {
      method: "PATCH",
      body: JSON.stringify({
        branchIds: ["branch-gangnam"],
        email: updatedEmail,
        name: "대표 수정 차단",
        phone: updatedPhone,
        reason: `owner blocked update ${stamp}`,
        role: "member",
        title: "대표 수정 차단",
      }),
    },
    { allowError: true },
  );
  assert.equal(ownerUpdate.response.status, 403, "owner must not update users through admin user API");

  const selfDemotion = await admin.request(
    "/api/v1/admin/users/user-admin",
    {
      method: "PATCH",
      body: JSON.stringify({
        branchIds: ["branch-gangnam"],
        email: "admin@finaljudo.kr",
        name: "정유진",
        phone: "01028476013",
        reason: `self demotion block ${stamp}`,
        role: "owner",
        title: "총괄 운영 관리자",
      }),
    },
    { allowError: true },
  );
  assert.equal(selfDemotion.response.status, 422, "admin self-demotion must be blocked");

  const selfDelete = await admin.request(
    "/api/v1/admin/users/user-admin",
    {
      method: "DELETE",
      body: JSON.stringify({ reason: `self delete block ${stamp}` }),
    },
    { allowError: true },
  );
  assert.equal(selfDelete.response.status, 422, "admin self-delete must be blocked");

  const isolatedBranchName = `인계 차단 지점 ${stamp}`;
  const isolatedBranchCreate = await admin.request("/api/v1/admin/branches", {
    method: "POST",
    body: JSON.stringify({
      district: "서울 인계 테스트",
      name: isolatedBranchName,
    }),
  });
  const isolatedBranchId = isolatedBranchCreate.payload.data.db.branches.find(
    (branch) => branch.name === isolatedBranchName,
  )?.id;
  assert(isolatedBranchId, "reassignment blocker test must create an isolated branch");
  assert(
    !isolatedBranchCreate.payload.data.db.users
      .find((candidate) => candidate.id === "user-admin")
      ?.branchIds.includes(isolatedBranchId),
    "creating a branch must not implicitly make the acting admin an assigned fallback",
  );

  const isolatedCoachPhone = `010${String((Number(stampPhoneSuffix) + 4) % 100000000).padStart(8, "0")}`;
  const isolatedCoachEmail = `isolated-coach-${stamp}@example.com`;
  const isolatedCoachInvite = await admin.request("/api/v1/admin/users/invitations", {
    method: "POST",
    body: JSON.stringify({
      branchIds: [isolatedBranchId],
      email: isolatedCoachEmail,
      name: `고립 코치 ${stamp}`,
      phone: isolatedCoachPhone,
      role: "coach",
    }),
  });
  const isolatedCoachId = isolatedCoachInvite.payload.data.invitation.userId;
  assert(isolatedCoachId, "reassignment blocker test must create an isolated coach");
  const pendingOperatorMemberCreate = await admin.request(
    `/api/v1/branches/${isolatedBranchId}/members`,
    {
      method: "POST",
      body: JSON.stringify({
        ageGroup: "adult",
        belt: "흰띠",
        emergencyContact: isolatedCoachPhone,
        level: "입문",
        name: `승인 전 차단 회원 ${stamp}`,
        status: "active",
      }),
    },
    { allowError: true },
  );
  assert.equal(
    pendingOperatorMemberCreate.response.status,
    422,
    "member creation must fail when the branch has no accepted operator",
  );
  const afterPendingOperatorBlock = await admin.request("/api/v1/me/bootstrap");
  assert(
    !afterPendingOperatorBlock.payload.data.db.members.some(
      (member) => member.name === `승인 전 차단 회원 ${stamp}`,
    ),
    "blocked member creation must not persist an empty operator assignment",
  );
  await admin.request(
    `/api/v1/admin/users/${isolatedCoachId}/approve-invitation?selectedBranchId=${isolatedBranchId}`,
    { method: "POST" },
  );

  const isolatedMemberCreate = await admin.request(`/api/v1/branches/${isolatedBranchId}/members`, {
    method: "POST",
    body: JSON.stringify({
      ageGroup: "adult",
      belt: "흰띠",
      emergencyContact: isolatedCoachPhone,
      level: "입문",
      name: `인계 차단 회원 ${stamp}`,
      status: "active",
    }),
  });
  const isolatedMemberId = isolatedMemberCreate.payload.data.db.members.find(
    (member) => member.name === `인계 차단 회원 ${stamp}`,
  )?.id;
  assert(isolatedMemberId, "reassignment blocker test must create an assigned member");
  assert.equal(
    isolatedMemberCreate.payload.data.db.members.find((member) => member.id === isolatedMemberId)?.primaryCoachId,
    isolatedCoachId,
    "isolated member must start assigned to the target coach",
  );

  const isolatedClassStart = new Date(Date.now() + 48 * 60 * 60 * 1000);
  const isolatedClassEnd = new Date(isolatedClassStart.getTime() + 60 * 60 * 1000);
  const isolatedClassCreate = await admin.request(`/api/v1/branches/${isolatedBranchId}/classes`, {
    method: "POST",
    body: JSON.stringify({
      ageGroup: "adult",
      capacity: 10,
      coachId: isolatedCoachId,
      endsAt: isolatedClassEnd.toISOString(),
      enrolledMemberIds: [isolatedMemberId],
      level: "입문",
      name: `인계 차단 수업 ${stamp}`,
      room: "테스트관",
      startsAt: isolatedClassStart.toISOString(),
    }),
  });
  const isolatedClassId = isolatedClassCreate.payload.data.db.classes.find(
    (session) => session.name === `인계 차단 수업 ${stamp}`,
  )?.id;
  assert(isolatedClassId, "reassignment blocker test must create an assigned class");

  const auditCountBeforeBlockedRequests = isolatedClassCreate.payload.data.db.auditLogs.length;
  const blockedProfileUpdate = await admin.request(
    `/api/v1/admin/users/${isolatedCoachId}`,
    {
      method: "PATCH",
      body: JSON.stringify({
        branchIds: [isolatedBranchId],
        email: isolatedCoachEmail,
        name: `차단 후 변경 이름 ${stamp}`,
        phone: isolatedCoachPhone,
        reason: `no fallback profile block ${stamp}`,
        role: "member",
        title: "차단되어야 하는 변경",
      }),
    },
    { allowError: true },
  );
  assert.equal(blockedProfileUpdate.response.status, 422, "profile update must fail when any operational link lacks a fallback");
  assert.deepEqual(
    blockedProfileUpdate.payload.error?.details?.branches,
    [{ branchName: isolatedBranchName, classCount: 1, memberCount: 1 }],
    "profile update blocker response must expose only branch names and link counts",
  );
  assert.equal(blockedProfileUpdate.payload.error?.details?.blockedClassCount, 1, "profile update must count blocked classes");
  assert.equal(blockedProfileUpdate.payload.error?.details?.blockedMemberCount, 1, "profile update must count blocked members");
  assert(
    !JSON.stringify(blockedProfileUpdate.payload.error?.details).includes(isolatedCoachId),
    "profile update blocker details must not expose internal user ids",
  );
  assert(
    !JSON.stringify(blockedProfileUpdate.payload.error?.details).includes(isolatedClassId),
    "profile update blocker details must not expose internal class ids",
  );
  assert(
    !JSON.stringify(blockedProfileUpdate.payload.error?.details).includes(isolatedMemberId),
    "profile update blocker details must not expose internal member ids",
  );

  const blockedRoleUpdate = await admin.request(
    `/api/v1/admin/users/${isolatedCoachId}/roles`,
    {
      method: "PUT",
      body: JSON.stringify({ role: "member", reason: `no fallback role block ${stamp}` }),
    },
    { allowError: true },
  );
  assert.equal(blockedRoleUpdate.response.status, 422, "role update must fail when any operational link lacks a fallback");

  const blockedDelete = await admin.request(
    `/api/v1/admin/users/${isolatedCoachId}`,
    {
      method: "DELETE",
      body: JSON.stringify({ reason: `no fallback delete block ${stamp}` }),
    },
    { allowError: true },
  );
  assert.equal(blockedDelete.response.status, 422, "delete must fail when any operational link lacks a fallback");

  const afterBlockedBootstrap = await admin.request("/api/v1/me/bootstrap");
  const afterBlockedDb = afterBlockedBootstrap.payload.data.db;
  assert.equal(
    afterBlockedDb.users.find((candidate) => candidate.id === isolatedCoachId)?.role,
    "coach",
    "blocked user requests must preserve the target role",
  );
  assert.equal(
    afterBlockedDb.users.find((candidate) => candidate.id === isolatedCoachId)?.name,
    `고립 코치 ${stamp}`,
    "blocked profile update must preserve the target profile",
  );
  assert.equal(
    afterBlockedDb.classes.find((session) => session.id === isolatedClassId)?.coachId,
    isolatedCoachId,
    "blocked user requests must preserve class assignment",
  );
  assert.equal(
    afterBlockedDb.members.find((member) => member.id === isolatedMemberId)?.primaryCoachId,
    isolatedCoachId,
    "blocked user requests must preserve member assignment",
  );
  assert.equal(
    afterBlockedDb.auditLogs.length,
    auditCountBeforeBlockedRequests,
    "blocked user requests must not persist audit or domain writes",
  );

  const adminBranchAssignment = await admin.request("/api/v1/admin/users/user-admin", {
    method: "PATCH",
    body: JSON.stringify({
      branchIds: ["branch-gangnam", "branch-songpa", isolatedBranchId],
      email: "admin@finaljudo.kr",
      name: "정유진",
      phone: "01028476013",
      reason: `same branch admin fallback ${stamp}`,
      role: "admin",
      title: "총괄 운영 관리자",
    }),
  });
  assert(
    adminBranchAssignment.payload.data.db.users
      .find((candidate) => candidate.id === "user-admin")
      ?.branchIds.includes(isolatedBranchId),
    "admin fallback test must explicitly assign the admin to the isolated branch",
  );

  const adminFallbackDelete = await admin.request(`/api/v1/admin/users/${isolatedCoachId}`, {
    method: "DELETE",
    body: JSON.stringify({ reason: `same branch admin fallback delete ${stamp}` }),
  });
  assert.equal(
    adminFallbackDelete.payload.data.db.classes.find((session) => session.id === isolatedClassId)?.coachId,
    "user-admin",
    "same-branch admin must receive linked classes when no coach or owner is available",
  );
  assert.equal(
    adminFallbackDelete.payload.data.db.members.find((member) => member.id === isolatedMemberId)?.primaryCoachId,
    "user-admin",
    "same-branch admin must receive linked members when no coach or owner is available",
  );
  const adminFallbackAudit = adminFallbackDelete.payload.data.db.auditLogs.find(
    (log) => log.action === "user.delete" && log.targetId === isolatedCoachId,
  );
  assert.equal(
    adminFallbackAudit?.after?.reassignedClassCount,
    1,
    "same-branch admin fallback audit must record the reassigned class count",
  );
  assert.equal(
    adminFallbackAudit?.after?.reassignedMemberCount,
    1,
    "same-branch admin fallback audit must record the reassigned member count",
  );
  assert(
    adminFallbackDelete.payload.data.db.classes.every((session) => session.coachId !== ""),
    "admin fallback must never persist an empty class coach id",
  );
  assert(
    adminFallbackDelete.payload.data.db.members.every((member) => member.primaryCoachId !== ""),
    "admin fallback must never persist an empty member coach id",
  );

  // 담당 수업·회원이 남은 코치도 삭제 가능해야 하며, 연결은 같은 지점의 다른 코치/대표에게 자동 인계된다.
  const linkedCoachDelete = await admin.request("/api/v1/admin/users/user-coach", {
    method: "DELETE",
    body: JSON.stringify({ reason: `linked coach cascade delete ${stamp}` }),
  });
  assert(
    !linkedCoachDelete.payload.data.db.users.some((candidate) => candidate.id === "user-coach"),
    "linked coach delete must remove the coach account",
  );
  assert(
    !linkedCoachDelete.payload.data.db.classes.some((session) => session.coachId === "user-coach"),
    "deleted coach classes must be reassigned to another coach or owner",
  );
  assert(
    !linkedCoachDelete.payload.data.db.members.some((member) => member.primaryCoachId === "user-coach"),
    "deleted coach members must be reassigned to another coach or owner",
  );
  const coachCascadeAudit = linkedCoachDelete.payload.data.db.auditLogs.find(
    (log) => log.action === "user.delete" && log.targetId === "user-coach",
  );
  assert(
    (coachCascadeAudit?.after?.reassignedClassCount ?? 0) >= 1,
    "coach cascade delete audit must record the reassigned class count",
  );

  const ownerDelete = await owner.request(
    `/api/v1/admin/users/${invitedUserId}`,
    {
      method: "DELETE",
      body: JSON.stringify({ reason: `owner blocked delete ${stamp}` }),
    },
    { allowError: true },
  );
  assert.equal(ownerDelete.response.status, 403, "owner must not delete users through admin user API");

  const deleteReason = `admin user api delete ${stamp}`;
  result = await admin.request(`/api/v1/admin/users/${invitedUserId}?selectedBranchId=branch-songpa`, {
    method: "DELETE",
    body: JSON.stringify({ reason: deleteReason }),
  });

  const deleteAudit = result.payload.data.db.auditLogs.find(
    (log) => log.action === "user.delete" && log.targetId === invitedUserId,
  );

  assert(!result.payload.data.db.users.some((user) => user.id === invitedUserId), "admin user delete must remove target user");
  assert.equal(deleteAudit?.after?.reason, deleteReason, "admin user delete audit must include reason");

  return [
    "admin-only user update/delete",
    "authentication-first admin user API guards",
    "coach bootstrap payment record exclusion",
    "public register API phone signup login flow",
    "concurrent phone signup uniqueness",
    "authentication-first admin user role and invitation guards",
    "authentication-first admin branch API guards",
    "admin invitation approval login flow",
    "user update profile and branch assignment",
    "member app link update and bootstrap visibility",
    "adult members are rejected as guardian children",
    "optional password update login",
    "dedicated password issue login and audit redaction",
    "password hash and raw password redaction",
    "audit phone and email masking",
    "short/default password rejection",
    "self-demotion and self-delete protection",
    "same-branch admin operational reassignment",
    "member creation requires an accepted same-branch operator",
    "cross-branch actor fallback rejection and atomic 422 blocking",
    "role change operational reassignment and sole owner protection",
    "linked coach delete protection",
    "user.update and user.delete audit logs",
  ];
}

async function inviteeLoginBeforeAccept(baseUrl, phone, password) {
  const invitee = createClient(baseUrl);

  return invitee.request(
    "/api/v1/auth/login",
    {
      method: "POST",
      body: JSON.stringify({ phone, password }),
    },
    { allowError: true },
  );
}

async function main() {
  const initialBuild = await assertFreshNextBuild();
  const tempDir = await mkdtemp(path.join(tmpdir(), "final-judo-admin-user-api-"));
  const port = await getFreePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const dbFile = path.join(tempDir, "runtime-db.json");
  const child = spawn(process.execPath, [nextBin, "start", "--port", String(port), "--hostname", "127.0.0.1"], {
    env: {
      ...process.env,
      FINAL_JUDO_ENABLE_DEMO_LOGIN: "1",
      PILOT_DB_FILE: dbFile,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const serverOutput = [];

  child.stdout.on("data", (chunk) => {
    serverOutput.push(chunk.toString());
  });
  child.stderr.on("data", (chunk) => {
    serverOutput.push(chunk.toString());
  });

  try {
    await waitForServer(baseUrl, child);
    const checked = await runAssertions(baseUrl);
    await assertFreshNextBuild(process.cwd(), initialBuild);

    console.log(
      JSON.stringify(
        {
          ok: true,
          baseUrl,
          checked,
        },
        null,
        2,
      ),
    );
  } catch (error) {
    const output = serverOutput.join("").trim();

    if (output) {
      console.error(output);
    }

    throw error;
  } finally {
    await stopServer(child);
    await rm(tempDir, { force: true, recursive: true });
  }
}

await main();
